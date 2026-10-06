-- ============================================================================
-- Migration: 20261012000001_incident_report_pipeline.sql
-- Makes the incident-report pipeline work end to end (passenger or driver files a report -> TODA and LGU review it).
--
-- What was wrong:
--   * The Passenger app inserted columns that do not exist (severity) and left out two required ones (booking_id, reported_by), so
--     every insert failed; the app swallowed the error and kept the report only on the phone.
--   * A report had no place for the evidence photo, and the TODA administrator could not read a photo even if one existed.
--   * The TODA portal wrote the boolean `true` into reviewed_by_toda (a UUID), so "Resolve" and "Escalate" always failed.
--
-- What this migration adds (nothing is removed, nothing existing is rewritten):
--   1. incident_report.evidence_paths TEXT[]     storage paths in the private bucket 'incident-evidence' (at most 3, own folder)
--   2. incident_report.cancellation_reason TEXT  why the passenger withdrew a still-unreviewed report
--   3. incident_report_guard() trigger           BEFORE INSERT: the driver, the TODA, the reporter's role, the starting status and the
--                                                timestamp come from the BOOKING and the signed-in user, never from the request, so a report
--                                                cannot be pointed at somebody else's driver or created already "Resolved".
--                                                BEFORE UPDATE: the facts of a report (who, which trip, what category, what was written,
--                                                evidence) never change; a TODA / LGU administrator is stamped as the reviewer; the reporting
--                                                passenger can only withdraw a report that is still Pending.
--   4. storage_can_read_incident_evidence()      lets the TODA administrator of the reported driver read the photo (the reporter and the
--                                                LGU already could); the storage SELECT policy gains that one condition.
--
-- Trusted callers (the service role, policy-engine functions, a direct database session) pass the guard unchanged.
-- Forward-only. Safe to run twice.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Columns
-- ----------------------------------------------------------------------------
ALTER TABLE public.incident_report ADD COLUMN IF NOT EXISTS evidence_paths TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.incident_report ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- ----------------------------------------------------------------------------
-- 2. The guard
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.incident_report_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_trusted BOOLEAN := COALESCE(public.is_trusted_session(), FALSE);
    v_uid     UUID := auth.uid();
    v_pax     UUID;
    v_drv     UUID;
    v_b       public.booking;
    v_toda    UUID;
    v_lgu     UUID;
    v_tadmin  UUID;
BEGIN
    -- ===================== INSERT =====================
    IF TG_OP = 'INSERT' THEN
        NEW.category    := btrim(COALESCE(NEW.category, ''));
        NEW.description := btrim(COALESCE(NEW.description, ''));
        IF v_trusted THEN
            RETURN NEW;
        END IF;

        IF NEW.category = '' OR length(NEW.category) > 100 THEN
            RAISE EXCEPTION 'ERR_INCIDENT_INVALID: Pumili ng uri ng insidente. (Choose an incident category.)';
        END IF;
        IF NEW.description = '' OR length(NEW.description) > 2000 THEN
            RAISE EXCEPTION 'ERR_INCIDENT_INVALID: Isulat ang detalye ng insidente (hanggang 2000 na titik). (Describe the incident, up to 2000 characters.)';
        END IF;

        SELECT * INTO v_b FROM public.booking WHERE booking_id = NEW.booking_id;
        IF v_b.booking_id IS NULL THEN
            RAISE EXCEPTION 'ERR_INCIDENT_BOOKING: Hindi nahanap ang biyahe. (The trip was not found.)';
        END IF;

        v_pax := public.get_current_passenger_id();
        v_drv := public.get_current_driver_id();
        IF v_pax IS NOT NULL AND v_b.passenger_id = v_pax THEN
            NEW.reported_by := 'Passenger';
            NEW.passenger_id := v_pax;
            NEW.driver_id := v_b.driver_id;
        ELSIF v_drv IS NOT NULL AND v_b.driver_id = v_drv THEN
            NEW.reported_by := 'Driver';
            NEW.driver_id := v_drv;
            NEW.passenger_id := v_b.passenger_id;
        ELSE
            RAISE EXCEPTION 'ERR_INCIDENT_NOT_PARTICIPANT: Makapag-uulat ka lamang tungkol sa biyaheng sinakyan o minaneho mo. (You can only report a trip you took part in.)';
        END IF;

        IF NEW.driver_id IS NULL THEN
            RAISE EXCEPTION 'ERR_INCIDENT_NO_DRIVER: Walang drayber ang biyaheng ito. (This trip never had a driver.)';
        END IF;

        SELECT d.toda_id INTO v_toda FROM public.driver d WHERE d.driver_id = NEW.driver_id;
        NEW.reported_toda_id := COALESCE(v_toda, v_b.toda_id);

        -- The review state always starts empty, whatever the request said.
        NEW.status := 'Pending';
        NEW.reviewed_by_toda := NULL;
        NEW.reviewed_by_lgu := NULL;
        NEW.resolution := NULL;
        NEW.resolution_notes := NULL;
        NEW.resolved_at := NULL;
        NEW.cancellation_reason := NULL;
        NEW.created_at := CURRENT_TIMESTAMP;

        -- Evidence: at most 3 files, every one inside the reporter's own storage folder.
        NEW.evidence_paths := COALESCE(NEW.evidence_paths, '{}');
        IF cardinality(NEW.evidence_paths) > 3 THEN
            RAISE EXCEPTION 'ERR_INCIDENT_EVIDENCE: Hanggang 3 larawan lamang. (At most 3 photos.)';
        END IF;
        IF EXISTS (SELECT 1 FROM unnest(NEW.evidence_paths) p
                    WHERE p NOT LIKE v_uid::TEXT || '/%' OR p LIKE '%..%') THEN
            RAISE EXCEPTION 'ERR_INCIDENT_EVIDENCE: Hindi tamang lokasyon ng larawan. (The photo must be in your own folder.)';
        END IF;
        RETURN NEW;
    END IF;

    -- ===================== UPDATE =====================
    IF v_trusted THEN
        RETURN NEW;
    END IF;

    -- The facts of a report never change, for anybody. Administrators change only the review fields.
    IF NEW.incident_id IS DISTINCT FROM OLD.incident_id
       OR NEW.booking_id IS DISTINCT FROM OLD.booking_id
       OR NEW.passenger_id IS DISTINCT FROM OLD.passenger_id
       OR NEW.driver_id IS DISTINCT FROM OLD.driver_id
       OR NEW.reported_by IS DISTINCT FROM OLD.reported_by
       OR NEW.reported_toda_id IS DISTINCT FROM OLD.reported_toda_id
       OR NEW.category IS DISTINCT FROM OLD.category
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.evidence_paths IS DISTINCT FROM OLD.evidence_paths
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'ERR_INCIDENT_LOCKED: Hindi na maaaring baguhin ang nilalaman ng ulat. (A submitted report cannot be edited.)';
    END IF;

    IF public.is_lgu_admin() THEN
        SELECT a.admin_id INTO v_lgu FROM public.lgu_admin a WHERE a.auth_user_id = v_uid LIMIT 1;
        NEW.reviewed_by_lgu := COALESCE(v_lgu, OLD.reviewed_by_lgu);
        NEW.reviewed_by_toda := OLD.reviewed_by_toda;
        RETURN NEW;
    END IF;

    IF public.is_toda_admin() THEN
        SELECT a.admin_id INTO v_tadmin FROM public.toda_admin a WHERE a.auth_user_id = v_uid LIMIT 1;
        NEW.reviewed_by_toda := COALESCE(v_tadmin, OLD.reviewed_by_toda);
        NEW.reviewed_by_lgu := OLD.reviewed_by_lgu;
        RETURN NEW;
    END IF;

    -- Anybody else who got past the row policy is the reporting passenger: the only change allowed is withdrawing a Pending report.
    IF OLD.status = 'Pending'
       AND NEW.status = 'Cancelled'
       AND btrim(COALESCE(NEW.cancellation_reason, '')) <> ''
       AND NEW.resolution IS NOT DISTINCT FROM OLD.resolution
       AND NEW.resolution_notes IS NOT DISTINCT FROM OLD.resolution_notes
       AND NEW.reviewed_by_toda IS NOT DISTINCT FROM OLD.reviewed_by_toda
       AND NEW.reviewed_by_lgu IS NOT DISTINCT FROM OLD.reviewed_by_lgu
       AND NEW.resolved_at IS NOT DISTINCT FROM OLD.resolved_at THEN
        NEW.cancellation_reason := btrim(NEW.cancellation_reason);
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'ERR_INCIDENT_LOCKED: Maaari mo lamang bawiin ang ulat na hindi pa nasusuri. (Only a report that has not been reviewed yet can be withdrawn.)';
END;
$$;

DROP TRIGGER IF EXISTS trigger_incident_report_guard ON public.incident_report;
CREATE TRIGGER trigger_incident_report_guard
    BEFORE INSERT OR UPDATE ON public.incident_report
    FOR EACH ROW EXECUTE FUNCTION public.incident_report_guard();

REVOKE ALL ON FUNCTION public.incident_report_guard() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. The reported driver's TODA administrator can read the evidence photo
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.storage_can_read_incident_evidence(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.incident_report r
         WHERE p_name = ANY (r.evidence_paths)
           AND ((r.reported_toda_id IS NOT NULL AND r.reported_toda_id = public.get_current_toda_admin_toda_id())
                OR (r.driver_id IS NOT NULL AND public.is_toda_admin_for_driver(r.driver_id)))
    );
$$;

REVOKE ALL ON FUNCTION public.storage_can_read_incident_evidence(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_can_read_incident_evidence(TEXT) TO authenticated, service_role;

DROP POLICY IF EXISTS perimeter_incident_evidence_select ON storage.objects;
CREATE POLICY perimeter_incident_evidence_select ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'incident-evidence'
           AND ((storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
                OR (SELECT public.is_lgu_admin())
                OR public.storage_can_read_incident_evidence(name)));

-- ----------------------------------------------------------------------------
-- 4. Self-check
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'incident_report' AND column_name = 'evidence_paths') THEN
        RAISE EXCEPTION 'incident_report.evidence_paths is missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.incident_report'::regclass AND tgname = 'trigger_incident_report_guard') THEN
        RAISE EXCEPTION 'trigger_incident_report_guard is missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                    AND policyname = 'perimeter_incident_evidence_select') THEN
        RAISE EXCEPTION 'the incident evidence storage policy is missing';
    END IF;
END $$;
