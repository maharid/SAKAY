-- ============================================================================
-- Migration 20261031000007 - approved documents cannot be silently replaced or deleted by whoever uploaded them
-- (panel comment 15, decision D-P7: "secure uploaded documents").
--
-- The buckets are private and every read goes through a short-lived signed link (migration 20261008000005). What was still open: the uploader could OVERWRITE
-- (an upload with upsert, or an UPDATE) or DELETE a file that the TODA or the LGU had already looked at and approved, and the record would keep pointing to the same path.
-- Nothing would show that the document had changed after approval.
--
-- storage_object_is_locked(bucket, name) says when a file may no longer be changed by its uploader:
--   * TODA documents (barangay-clearances, toda-accredited-driver-lists, toda-bylaws): ALWAYS. The apps put every upload under a new name (<uid>/<time>_<file>), so a
--     correction or a renewal is a new file and the old one stays as the record of what was submitted.
--   * incident-evidence: ALWAYS. Evidence is added, never changed (the app already uploads without overwrite).
--   * driver documents (driver-licenses, mtop-permits, tricycle-photos): once the driver is no longer Pending Verification / Resubmission Required / Rejected, that is,
--     from the moment the LGU has accepted them. While the LGU has the documents open or returned for correction, the driver can still replace them.
-- The uploader's UPDATE and DELETE policies get "AND NOT locked"; the LGU Administrator can still delete (its policy is separate). Profile photos are not locked:
-- changing one is normal.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.storage_object_is_locked(p_bucket TEXT, p_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID;
BEGIN
    IF p_bucket IN ('barangay-clearances', 'toda-accredited-driver-lists', 'toda-bylaws', 'incident-evidence') THEN
        RETURN TRUE;
    END IF;
    IF p_bucket IN ('driver-licenses', 'mtop-permits', 'tricycle-photos') THEN
        BEGIN
            v_uid := split_part(COALESCE(p_name, ''), '/', 1)::UUID;
        EXCEPTION WHEN invalid_text_representation THEN
            RETURN FALSE;   -- not in a driver's folder: the insert policy does not allow such a name anyway
        END;
        RETURN EXISTS (SELECT 1 FROM public.driver d
                        WHERE d.auth_user_id = v_uid
                          AND d.account_status NOT IN ('Pending Verification', 'Resubmission Required', 'Rejected'));
    END IF;
    RETURN FALSE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.storage_object_is_locked(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_object_is_locked(TEXT, TEXT) TO authenticated, service_role;

-- ---- driver documents ----
DROP POLICY IF EXISTS perimeter_driver_docs_update ON storage.objects;
CREATE POLICY perimeter_driver_docs_update ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id IN ('driver-licenses', 'mtop-permits', 'tricycle-photos')
           AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
           AND NOT public.storage_object_is_locked(bucket_id, name))
    WITH CHECK (bucket_id IN ('driver-licenses', 'mtop-permits', 'tricycle-photos')
                AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
                AND NOT public.storage_object_is_locked(bucket_id, name));
DROP POLICY IF EXISTS perimeter_driver_docs_delete ON storage.objects;
CREATE POLICY perimeter_driver_docs_delete ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id IN ('driver-licenses', 'mtop-permits', 'tricycle-photos')
           AND (((storage.foldername(name))[1] = (SELECT auth.uid())::TEXT AND NOT public.storage_object_is_locked(bucket_id, name))
                OR (SELECT public.is_lgu_admin())));

-- ---- TODA registration documents ----
DROP POLICY IF EXISTS perimeter_toda_docs_update ON storage.objects;
CREATE POLICY perimeter_toda_docs_update ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id IN ('barangay-clearances', 'toda-accredited-driver-lists', 'toda-bylaws')
           AND ((storage.foldername(name))[1] = (SELECT auth.uid())::TEXT OR owner = (SELECT auth.uid()))
           AND NOT public.storage_object_is_locked(bucket_id, name))
    WITH CHECK (bucket_id IN ('barangay-clearances', 'toda-accredited-driver-lists', 'toda-bylaws')
                AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
                AND NOT public.storage_object_is_locked(bucket_id, name));
DROP POLICY IF EXISTS perimeter_toda_docs_delete ON storage.objects;
CREATE POLICY perimeter_toda_docs_delete ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id IN ('barangay-clearances', 'toda-accredited-driver-lists', 'toda-bylaws')
           AND ((((storage.foldername(name))[1] = (SELECT auth.uid())::TEXT OR owner = (SELECT auth.uid())) AND NOT public.storage_object_is_locked(bucket_id, name))
                OR (SELECT public.is_lgu_admin())));

-- ---- incident evidence ----
DROP POLICY IF EXISTS perimeter_incident_evidence_update ON storage.objects;
CREATE POLICY perimeter_incident_evidence_update ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'incident-evidence' AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT AND NOT public.storage_object_is_locked(bucket_id, name))
    WITH CHECK (bucket_id = 'incident-evidence' AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT AND NOT public.storage_object_is_locked(bucket_id, name));

-- ----------------------------------------------------------------------------
-- SELF-CHECK
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_name TEXT;
BEGIN
    FOREACH v_name IN ARRAY ARRAY['perimeter_driver_docs_update', 'perimeter_driver_docs_delete', 'perimeter_toda_docs_update', 'perimeter_toda_docs_delete', 'perimeter_incident_evidence_update'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = v_name
                          AND COALESCE(qual, '') LIKE '%storage_object_is_locked%') THEN
            RAISE EXCEPTION 'storage policy % does not check whether the file is locked', v_name;
        END IF;
    END LOOP;
    IF NOT public.storage_object_is_locked('toda-bylaws', 'x/y.pdf') OR public.storage_object_is_locked('profiles', 'x/y.jpg') THEN
        RAISE EXCEPTION 'storage_object_is_locked() gives the wrong answer for a TODA document or a profile photo';
    END IF;
END $$;
