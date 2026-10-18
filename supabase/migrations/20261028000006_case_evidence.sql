-- ============================================================================
-- Migration: 20261028000006_case_evidence.sql
-- Photos for an appeal and for a fare dispute (Rules 25.2 and 18.4).
--
--   Rule 25.2   "justification and evidence": exemption_request.evidence_urls existed, but nothing could fill it from a screen and the database accepted any text.
--   Rule 18.4   a party may add supporting information to a fare dispute: only words could be added.
--
--   1. A private storage bucket 'case-evidence': at most 3 photos per submission, 5 MB each (JPEG, PNG or WebP), in the submitter's own folder "<auth uid>/<file>".
--      The submitter, the LGU Administrator, and the TODA Administrator who reviews the case can open a photo: nobody else, not even the other party of a dispute.
--   2. fare_dispute_note.evidence_paths, and submit_fare_dispute_statement(dispute, text, paths): the note and its photos in one call.
--   3. A guard on exemption_request: a new appeal may carry at most 3 photos, each in the requester's own folder (the column took any text before).
--   4. get_fare_disputes() returns the photo paths of each note (the administrators open them through signed links).
--
-- Forward-only. submit_fare_dispute_note() is unchanged (words only).
-- ============================================================================

-- 1. The bucket and who may use it -------------------------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('case-evidence', 'case-evidence', FALSE, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
   SET public = FALSE, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- the one test of what a case-evidence path looks like (a time, a number, the extension of the format; always inside the submitter's own folder)
CREATE OR REPLACE FUNCTION public._is_case_evidence_path(p_owner UUID, p_path TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT p_owner IS NOT NULL AND p_path IS NOT NULL AND p_path ~ ('^' || p_owner::TEXT || '/[0-9]+-[0-9]+\.(jpg|jpeg|png|webp)$');
$$;
REVOKE ALL ON FUNCTION public._is_case_evidence_path(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._is_case_evidence_path(UUID, TEXT) TO service_role;

-- 2. The notes of a fare dispute can carry photos ----------------------------------------------------------------------------------
ALTER TABLE public.fare_dispute_note ADD COLUMN IF NOT EXISTS evidence_paths TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.fare_dispute_note DROP CONSTRAINT IF EXISTS fare_dispute_note_evidence_max;
ALTER TABLE public.fare_dispute_note ADD CONSTRAINT fare_dispute_note_evidence_max CHECK (cardinality(evidence_paths) <= 3);

-- 3. Who can open a photo besides the one who sent it and the LGU ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.storage_can_read_case_evidence(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        -- an appeal of a driver: the TODA Administrator who reviews it (a passenger's appeal is the LGU's alone, Rule 25.5)
        SELECT 1
          FROM public.exemption_request r
         WHERE r.subject_type = 'driver'
           AND r.evidence_urls @> to_jsonb(p_name)
           AND ((r.toda_id IS NOT NULL AND r.toda_id = public.get_current_toda_admin_toda_id())
                OR public.is_toda_admin_for_driver(r.subject_id))
    ) OR EXISTS (
        -- a statement in a fare dispute: the TODA Administrator of the trip's TODA
        SELECT 1
          FROM public.fare_dispute_note n
          JOIN public.fare_dispute d ON d.dispute_id = n.dispute_id
         WHERE p_name = ANY (n.evidence_paths)
           AND ((d.toda_id IS NOT NULL AND d.toda_id = public.get_current_toda_admin_toda_id())
                OR public.rls_booking_in_my_toda(d.booking_id))
    );
$$;
REVOKE ALL ON FUNCTION public.storage_can_read_case_evidence(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_can_read_case_evidence(TEXT) TO authenticated, service_role;

DROP POLICY IF EXISTS case_evidence_select ON storage.objects;
DROP POLICY IF EXISTS case_evidence_insert ON storage.objects;
DROP POLICY IF EXISTS case_evidence_update ON storage.objects;
DROP POLICY IF EXISTS case_evidence_delete ON storage.objects;
CREATE POLICY case_evidence_select ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'case-evidence'
           AND ((storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
                OR (SELECT public.is_lgu_admin())
                OR public.storage_can_read_case_evidence(name)));
CREATE POLICY case_evidence_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'case-evidence' AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT);
CREATE POLICY case_evidence_update ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'case-evidence' AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT)
    WITH CHECK (bucket_id = 'case-evidence' AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT);
-- a submitted photo is evidence: only the LGU Administrator removes one
CREATE POLICY case_evidence_delete ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'case-evidence' AND (SELECT public.is_lgu_admin()));

-- 4. An appeal carries at most 3 photos, each in the requester's own folder ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exemption_request_evidence_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_item JSONB;
BEGIN
    NEW.evidence_urls := COALESCE(NEW.evidence_urls, '[]'::JSONB);
    IF jsonb_typeof(NEW.evidence_urls) <> 'array' THEN
        RAISE EXCEPTION 'ERR_EVIDENCE: Hindi tamang anyo ng ebidensya. (The evidence must be a list of photos.)';
    END IF;
    IF jsonb_array_length(NEW.evidence_urls) > 3 THEN
        RAISE EXCEPTION 'ERR_EVIDENCE: Hanggang 3 larawan lamang. (At most 3 photos.)';
    END IF;
    FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.evidence_urls) LOOP
        IF jsonb_typeof(v_item) <> 'string' OR NOT public._is_case_evidence_path(NEW.requested_by, v_item #>> '{}') THEN
            RAISE EXCEPTION 'ERR_EVIDENCE: Hindi tamang lokasyon ng larawan. (Each photo must be one you uploaded to your own folder.)';
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.exemption_request_evidence_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trigger_exemption_request_evidence_guard ON public.exemption_request;
CREATE TRIGGER trigger_exemption_request_evidence_guard
    BEFORE INSERT ON public.exemption_request
    FOR EACH ROW EXECUTE FUNCTION public.exemption_request_evidence_guard();

-- 5. A statement in a fare dispute: words and up to 3 photos in one call (Rule 18.4) --------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_fare_dispute_statement(p_dispute_id UUID, p_text TEXT, p_evidence_paths TEXT[] DEFAULT '{}')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_pax UUID := public.get_current_passenger_id();
    v_drv UUID := public.get_current_driver_id();
    v_d public.fare_dispute;
    v_b public.booking;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_party TEXT;
    v_author UUID;
    v_paths TEXT[] := COALESCE(p_evidence_paths, '{}');
BEGIN
    IF p_text IS NULL OR length(btrim(p_text)) < 3 OR length(btrim(p_text)) > 1000 THEN
        RETURN public._trip_end_error('ERR_NOTE_TEXT', 'Isulat ang impormasyon (3 hanggang 1000 titik). (Write the information: 3 to 1000 characters.)');
    END IF;
    IF cardinality(v_paths) > 3 THEN
        RETURN public._trip_end_error('ERR_EVIDENCE', 'Hanggang 3 larawan lamang. (At most 3 photos.)');
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_paths) p WHERE NOT public._is_case_evidence_path(v_uid, p)) THEN
        RETURN public._trip_end_error('ERR_EVIDENCE', 'Hindi tamang lokasyon ng larawan. (Each photo must be one you uploaded to your own folder.)');
    END IF;
    SELECT * INTO v_d FROM public.fare_dispute WHERE dispute_id = p_dispute_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN public._trip_end_error('ERR_DISPUTE_NOT_FOUND', 'The dispute was not found.');
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = v_d.booking_id;
    IF v_pax IS NOT NULL AND v_b.passenger_id = v_pax THEN
        v_party := 'passenger'; v_author := v_pax;
    ELSIF v_drv IS NOT NULL AND v_b.driver_id = v_drv THEN
        v_party := 'driver'; v_author := v_drv;
    ELSE
        RETURN public._trip_end_error('ERR_NOT_YOUR_DISPUTE', 'This dispute is not yours.');
    END IF;
    IF v_d.status = 'Resolved' THEN
        RETURN public._trip_end_error('ERR_DISPUTE_RESOLVED', 'Nasuri na ang hindi pagkakasundo. (The dispute has been resolved.)');
    END IF;
    PERFORM set_config('sakay.internal_context', 'true', true);
    INSERT INTO public.fare_dispute_note (dispute_id, party, author_id, note, evidence_paths) VALUES (p_dispute_id, v_party, v_author, btrim(p_text), v_paths);
    PERFORM public.record_policy_audit('FARE_DISPUTE_NOTE', p_dispute_id::TEXT, NULL, 'Fare Disputes',
        'The ' || v_party || ' added supporting information to the dispute (Rule 18.4)' ||
        CASE WHEN cardinality(v_paths) > 0 THEN ', with ' || cardinality(v_paths) || ' photo(s).' ELSE '.' END,
        NULL, jsonb_build_object('dispute_id', p_dispute_id, 'booking_id', v_d.booking_id, 'party', v_party, 'photos', cardinality(v_paths)));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_fare_dispute_statement(UUID, TEXT, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_fare_dispute_statement(UUID, TEXT, TEXT[]) TO authenticated, service_role;

-- 6. The administrators' dispute list now carries the photo paths of each note -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_fare_disputes(p_status TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_lgu BOOLEAN := COALESCE(public.is_lgu_admin(), FALSE);
    v_toda UUID := public.get_current_toda_admin_toda_id();
BEGIN
    IF NOT v_lgu AND v_toda IS NULL THEN
        RAISE EXCEPTION 'Access Denied: Only a TODA or LGU administrator can see the fare disputes.';
    END IF;
    IF p_status IS NOT NULL AND p_status NOT IN ('Open', 'Escalated', 'Resolved') THEN
        RAISE EXCEPTION 'ERR_DISPUTE_STATUS: The status must be Open, Escalated or Resolved.';
    END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(x.j ORDER BY x.resolved, x.due_at, x.created_at DESC)
          FROM (
            SELECT (d.status = 'Resolved') AS resolved, d.due_at, d.created_at,
                   jsonb_build_object(
                       'dispute_id', d.dispute_id, 'booking_id', d.booking_id, 'kind', d.kind, 'status', d.status, 'assigned_role', d.assigned_role,
                       'opened_by', d.opened_by, 'late', d.late, 'claimed_amount', d.claimed_amount, 'system_fare', d.system_fare,
                       'resolved_fare', d.resolved_fare, 'outcome', d.outcome, 'resolution_note', d.resolution_note,
                       'due_at', d.due_at, 'overdue', (d.status <> 'Resolved' AND d.due_at < clock_timestamp()),
                       'created_at', d.created_at, 'escalated_at', d.escalated_at, 'escalation_reason', d.escalation_reason, 'resolved_at', d.resolved_at,
                       'booking_status', b.booking_status, 'payment_status', b.payment_status, 'actual_fare', b.actual_fare, 'estimated_fare', b.estimated_fare,
                       'early_end_kind', b.early_end_kind, 'early_end_reason', b.early_end_reason, 'fare_unconfirmed', b.fare_unconfirmed,
                       'pickup_address', b.pickup_address, 'dropoff_address', b.dropoff_address, 'trip_completed_at', b.trip_completed_at,
                       'passenger_name', p.full_name, 'passenger_phone', p.contact_number,
                       'driver_id', dr.driver_id, 'driver_name', dr.full_name, 'driver_phone', dr.contact_number, 'plate_number', dr.plate_number,
                       'toda_name', t.toda_name,
                       'notes', COALESCE((SELECT jsonb_agg(jsonb_build_object('party', n.party, 'note', n.note, 'created_at', n.created_at, 'evidence_paths', n.evidence_paths) ORDER BY n.created_at)
                                            FROM public.fare_dispute_note n WHERE n.dispute_id = d.dispute_id), '[]'::JSONB)
                   ) AS j
              FROM public.fare_dispute d
              JOIN public.booking b ON b.booking_id = d.booking_id
              LEFT JOIN public.passenger p ON p.passenger_id = b.passenger_id
              LEFT JOIN public.driver dr ON dr.driver_id = b.driver_id
              LEFT JOIN public.toda t ON t.toda_id = d.toda_id
             WHERE (p_status IS NULL OR d.status = p_status)
               AND (v_lgu OR d.toda_id = v_toda OR public.rls_booking_in_my_toda(d.booking_id))
             ORDER BY (d.status = 'Resolved'), d.due_at, d.created_at DESC
             LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
          ) x), '[]'::JSONB);
END;
$$;

-- 7. Self-check ---------------------------------------------------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'case-evidence' AND public = FALSE) THEN
        RAISE EXCEPTION 'the case-evidence bucket is missing or public';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'case_evidence_select') THEN
        RAISE EXCEPTION 'the case evidence storage policy is missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.exemption_request'::regclass AND tgname = 'trigger_exemption_request_evidence_guard') THEN
        RAISE EXCEPTION 'trigger_exemption_request_evidence_guard is missing';
    END IF;
END $$;
