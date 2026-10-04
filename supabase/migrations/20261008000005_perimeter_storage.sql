-- ============================================================================
-- Migration: 20261008000005_perimeter_storage.sql
-- PERIMETER LOCKDOWN, stage S4 (CONTRACT, storage). All ten buckets become private; files are reached through signed URLs that
-- only people who may read the file can obtain.
--
-- What the Phase A audit found
--   * All 10 buckets had public = true, so every file was downloadable by anybody who knew (or listed) its address, with no policy
--     involved at all (a public bucket skips storage.objects policies for reads).
--   * Four policies on storage.objects without any bucket condition (storage_objects_select_all / insert_all / update_all for anon and
--     authenticated, plus delete for the owner or the LGU): anybody could list every bucket, upload anywhere and OVERWRITE any existing
--     file, for example replace a driver's licence photo.
--   * 97 objects in 5 buckets (driver-licenses 33, mtop-permits 28, barangay-clearances 16, toda-accredited-driver-lists 15, toda-bylaws 5);
--     six values in public.toda (2 rows x 3 document columns) stored a full public URL instead of a storage path.
--
-- The rules from here on (path convention: <auth uid>/<file name>)
--   driver-licenses, mtop-permits, tricycle-photos      write: the driver, in their own folder.
--                                                       read: the driver, the LGU, the TODA administrator of that driver's TODA.
--   barangay-clearances, toda-accredited-driver-lists,  write: a signed-in user, in their own folder (a TODA registrant signs up first).
--   toda-bylaws                                         read: the uploader, the LGU, the administrator of the TODA whose record points at it.
--                                                       (older files have flat names: they stay where they are and are read through the
--                                                        TODA record, or by the LGU)
--   profiles, profile-photos                            write: the owner, in their own folder.
--                                                       read: the owner, the LGU, the TODA administrator of that driver, and the other
--                                                       party of an open trip.
--   incident-evidence                                   write / read: the uploader (own folder) and the LGU.
--   reports                                             write / read: the LGU, and a TODA administrator in their own folder.
--
-- Clients ask for a signed URL (createSignedUrl): Storage evaluates the SELECT policy for the signed-in user, so no server is involved
-- and a URL cannot be minted for a file the user may not read. The apps keep only storage paths in the database.
--
-- Also: the six stored full URLs in public.toda are rewritten to storage paths (a public URL stops working the moment the bucket is private).
-- Forward-only. Safe to run twice.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Helpers for the read rules (SECURITY DEFINER: they look at tables the storage role may not read)
-- ----------------------------------------------------------------------------
-- The caller may read documents that belong to the driver whose auth user id is p_folder.
CREATE OR REPLACE FUNCTION public.storage_can_read_driver_folder(p_folder TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(public.is_lgu_admin(), FALSE)
        OR EXISTS (
            SELECT 1 FROM public.driver d
             WHERE d.auth_user_id::TEXT = p_folder
               AND d.toda_id IS NOT NULL
               AND d.toda_id = public.get_current_toda_admin_toda_id()
        );
$$;

-- The caller may read a TODA registration document: the LGU, or the administrator of the TODA whose record points at the file.
CREATE OR REPLACE FUNCTION public.storage_can_read_toda_document(p_bucket TEXT, p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(public.is_lgu_admin(), FALSE)
        OR EXISTS (
            SELECT 1 FROM public.toda t
             WHERE t.toda_id = public.get_current_toda_admin_toda_id()
               AND p_name IN (t.barangay_clearance_url, t.accredited_drivers_url, t.bylaws_url,
                              p_bucket || '/' || t.barangay_clearance_url, p_bucket || '/' || t.accredited_drivers_url, p_bucket || '/' || t.bylaws_url)
        );
$$;

-- The caller may see the profile photo of the user whose auth user id is p_folder: the LGU, the TODA administrator of that driver,
-- or the other party of a trip that is live right now.
CREATE OR REPLACE FUNCTION public.storage_can_read_profile_folder(p_folder TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT public.storage_can_read_driver_folder(p_folder)
        OR EXISTS (
            SELECT 1 FROM public.booking b
              JOIN public.driver d ON d.driver_id = b.driver_id
             WHERE d.auth_user_id::TEXT = p_folder
               AND b.passenger_id IS NOT NULL AND b.passenger_id = public.get_current_passenger_id()
               AND public._booking_is_open_accepted(b.booking_status::TEXT)
        )
        OR EXISTS (
            SELECT 1 FROM public.booking b
              JOIN public.passenger p ON p.passenger_id = b.passenger_id
             WHERE p.auth_user_id::TEXT = p_folder
               AND b.driver_id IS NOT NULL AND b.driver_id = public.get_current_driver_id()
               AND public._booking_is_open_accepted(b.booking_status::TEXT)
        );
$$;

REVOKE ALL ON FUNCTION public.storage_can_read_driver_folder(TEXT),
                       public.storage_can_read_toda_document(TEXT, TEXT),
                       public.storage_can_read_profile_folder(TEXT)
       FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_can_read_driver_folder(TEXT),
                          public.storage_can_read_toda_document(TEXT, TEXT),
                          public.storage_can_read_profile_folder(TEXT)
       TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. The buckets become private
-- ----------------------------------------------------------------------------
UPDATE storage.buckets
   SET public = FALSE
 WHERE id IN ('barangay-clearances', 'driver-licenses', 'incident-evidence', 'mtop-permits', 'profile-photos',
              'profiles', 'reports', 'toda-accredited-driver-lists', 'toda-bylaws', 'tricycle-photos');

-- ----------------------------------------------------------------------------
-- 3. The open policies go; one rule set per bucket group replaces them
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS storage_objects_select_all ON storage.objects;
DROP POLICY IF EXISTS storage_objects_insert_all ON storage.objects;
DROP POLICY IF EXISTS storage_objects_update_all ON storage.objects;
DROP POLICY IF EXISTS storage_objects_delete_policy ON storage.objects;

-- anything else on storage.objects that names anon / public (hand-made policies) goes too
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT policyname FROM pg_policies
              WHERE schemaname = 'storage' AND tablename = 'objects' AND (roles && ARRAY['anon', 'public']::NAME[])
    LOOP
        RAISE NOTICE 'dropping storage.objects policy % (it named anon / public)', r.policyname;
        EXECUTE format('DROP POLICY %I ON storage.objects', r.policyname);
    END LOOP;
END $$;

-- ---- 3.1 driver documents: driver-licenses, mtop-permits, tricycle-photos ----
DROP POLICY IF EXISTS perimeter_driver_docs_select ON storage.objects;
DROP POLICY IF EXISTS perimeter_driver_docs_insert ON storage.objects;
DROP POLICY IF EXISTS perimeter_driver_docs_update ON storage.objects;
DROP POLICY IF EXISTS perimeter_driver_docs_delete ON storage.objects;
CREATE POLICY perimeter_driver_docs_select ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id IN ('driver-licenses', 'mtop-permits', 'tricycle-photos')
           AND ((storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
                OR public.storage_can_read_driver_folder((storage.foldername(name))[1])));
CREATE POLICY perimeter_driver_docs_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id IN ('driver-licenses', 'mtop-permits', 'tricycle-photos')
                AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT);
CREATE POLICY perimeter_driver_docs_update ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id IN ('driver-licenses', 'mtop-permits', 'tricycle-photos')
           AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT)
    WITH CHECK (bucket_id IN ('driver-licenses', 'mtop-permits', 'tricycle-photos')
                AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT);
CREATE POLICY perimeter_driver_docs_delete ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id IN ('driver-licenses', 'mtop-permits', 'tricycle-photos')
           AND ((storage.foldername(name))[1] = (SELECT auth.uid())::TEXT OR (SELECT public.is_lgu_admin())));

-- ---- 3.2 TODA registration documents: barangay-clearances, toda-accredited-driver-lists, toda-bylaws ----
DROP POLICY IF EXISTS perimeter_toda_docs_select ON storage.objects;
DROP POLICY IF EXISTS perimeter_toda_docs_insert ON storage.objects;
DROP POLICY IF EXISTS perimeter_toda_docs_update ON storage.objects;
DROP POLICY IF EXISTS perimeter_toda_docs_delete ON storage.objects;
CREATE POLICY perimeter_toda_docs_select ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id IN ('barangay-clearances', 'toda-accredited-driver-lists', 'toda-bylaws')
           AND ((storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
                OR owner = (SELECT auth.uid())
                OR public.storage_can_read_toda_document(bucket_id, name)));
CREATE POLICY perimeter_toda_docs_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id IN ('barangay-clearances', 'toda-accredited-driver-lists', 'toda-bylaws')
                AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT);
CREATE POLICY perimeter_toda_docs_update ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id IN ('barangay-clearances', 'toda-accredited-driver-lists', 'toda-bylaws')
           AND ((storage.foldername(name))[1] = (SELECT auth.uid())::TEXT OR owner = (SELECT auth.uid())))
    WITH CHECK (bucket_id IN ('barangay-clearances', 'toda-accredited-driver-lists', 'toda-bylaws')
                AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT);
CREATE POLICY perimeter_toda_docs_delete ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id IN ('barangay-clearances', 'toda-accredited-driver-lists', 'toda-bylaws')
           AND ((storage.foldername(name))[1] = (SELECT auth.uid())::TEXT OR owner = (SELECT auth.uid()) OR (SELECT public.is_lgu_admin())));

-- ---- 3.3 profile images: profiles, profile-photos ----
DROP POLICY IF EXISTS perimeter_profile_images_select ON storage.objects;
DROP POLICY IF EXISTS perimeter_profile_images_insert ON storage.objects;
DROP POLICY IF EXISTS perimeter_profile_images_update ON storage.objects;
DROP POLICY IF EXISTS perimeter_profile_images_delete ON storage.objects;
CREATE POLICY perimeter_profile_images_select ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id IN ('profiles', 'profile-photos')
           AND ((storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
                OR public.storage_can_read_profile_folder((storage.foldername(name))[1])));
CREATE POLICY perimeter_profile_images_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id IN ('profiles', 'profile-photos') AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT);
CREATE POLICY perimeter_profile_images_update ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id IN ('profiles', 'profile-photos') AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT)
    WITH CHECK (bucket_id IN ('profiles', 'profile-photos') AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT);
CREATE POLICY perimeter_profile_images_delete ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id IN ('profiles', 'profile-photos')
           AND ((storage.foldername(name))[1] = (SELECT auth.uid())::TEXT OR (SELECT public.is_lgu_admin())));

-- ---- 3.4 incident evidence ----
DROP POLICY IF EXISTS perimeter_incident_evidence_select ON storage.objects;
DROP POLICY IF EXISTS perimeter_incident_evidence_insert ON storage.objects;
DROP POLICY IF EXISTS perimeter_incident_evidence_update ON storage.objects;
DROP POLICY IF EXISTS perimeter_incident_evidence_delete ON storage.objects;
CREATE POLICY perimeter_incident_evidence_select ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'incident-evidence'
           AND ((storage.foldername(name))[1] = (SELECT auth.uid())::TEXT OR (SELECT public.is_lgu_admin())));
CREATE POLICY perimeter_incident_evidence_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'incident-evidence' AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT);
CREATE POLICY perimeter_incident_evidence_update ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'incident-evidence' AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT)
    WITH CHECK (bucket_id = 'incident-evidence' AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT);
CREATE POLICY perimeter_incident_evidence_delete ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'incident-evidence' AND (SELECT public.is_lgu_admin()));

-- ---- 3.5 generated reports ----
DROP POLICY IF EXISTS perimeter_reports_select ON storage.objects;
DROP POLICY IF EXISTS perimeter_reports_insert ON storage.objects;
DROP POLICY IF EXISTS perimeter_reports_update ON storage.objects;
DROP POLICY IF EXISTS perimeter_reports_delete ON storage.objects;
CREATE POLICY perimeter_reports_select ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'reports'
           AND ((SELECT public.is_lgu_admin())
                OR ((SELECT public.is_toda_admin()) AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT)));
CREATE POLICY perimeter_reports_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'reports'
                AND ((SELECT public.is_lgu_admin())
                     OR ((SELECT public.is_toda_admin()) AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT)));
CREATE POLICY perimeter_reports_update ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'reports' AND (SELECT public.is_lgu_admin()))
    WITH CHECK (bucket_id = 'reports' AND (SELECT public.is_lgu_admin()));
CREATE POLICY perimeter_reports_delete ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'reports' AND (SELECT public.is_lgu_admin()));

-- ----------------------------------------------------------------------------
-- 4. Stored public URLs become storage paths (a public URL is dead once its bucket is private)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
    v_pairs TEXT[][] := ARRAY[['barangay_clearance_url', 'barangay-clearances'],
                              ['accredited_drivers_url', 'toda-accredited-driver-lists'],
                              ['bylaws_url', 'toda-bylaws']];
    i INTEGER;
    v_old TEXT;
    v_new TEXT;
    v_hex TEXT;
BEGIN
    FOR i IN 1 .. array_length(v_pairs, 1) LOOP
        FOR r IN EXECUTE format('SELECT toda_id, %I AS v FROM public.toda WHERE %I ~* ''^https?://''', v_pairs[i][1], v_pairs[i][1]) LOOP
            v_old := r.v;
            -- .../storage/v1/object/(public|sign|authenticated)/<bucket>/<path>[?query]
            v_new := regexp_replace(v_old, '^https?://[^/]+/storage/v1/object/(public|sign|authenticated)/' || v_pairs[i][2] || '/', '', 'i');
            IF v_new = v_old THEN
                RAISE NOTICE 'public.toda % column % holds a URL that is not in bucket %: left unchanged', r.toda_id, v_pairs[i][1], v_pairs[i][2];
                CONTINUE;
            END IF;
            v_new := regexp_replace(v_new, '\?.*$', '');
            -- decode %XX (ASCII only; anything else is left encoded and reported)
            WHILE v_new ~ '%[0-9A-Fa-f]{2}' LOOP
                v_hex := substring(v_new FROM '%([0-9A-Fa-f]{2})');
                IF ('x' || v_hex)::BIT(8)::INTEGER >= 128 THEN
                    RAISE NOTICE 'public.toda % column %: non-ASCII escape %% % kept as is', r.toda_id, v_pairs[i][1], v_hex;
                    EXIT;
                END IF;
                v_new := replace(v_new, '%' || v_hex, chr(('x' || v_hex)::BIT(8)::INTEGER));
            END LOOP;
            EXECUTE format('UPDATE public.toda SET %I = $1 WHERE toda_id = $2', v_pairs[i][1]) USING v_new, r.toda_id;
        END LOOP;
    END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 5. SELF-CHECK
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_bad TEXT;
BEGIN
    SELECT string_agg(id, ', ') INTO v_bad FROM storage.buckets WHERE public;
    IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'buckets still public: %', v_bad; END IF;

    SELECT string_agg(policyname, ', ') INTO v_bad FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND (roles && ARRAY['anon', 'public']::NAME[] OR policyname IN ('storage_objects_select_all', 'storage_objects_insert_all', 'storage_objects_update_all'));
    IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'open storage.objects policies remain: %', v_bad; END IF;

    IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'perimeter\_%') < 20 THEN
        RAISE EXCEPTION 'the per-bucket storage policies are missing';
    END IF;

    SELECT string_agg(toda_id::TEXT, ', ') INTO v_bad FROM public.toda
     WHERE barangay_clearance_url ~* '/storage/v1/object/' OR accredited_drivers_url ~* '/storage/v1/object/' OR bylaws_url ~* '/storage/v1/object/';
    IF v_bad IS NOT NULL THEN
        -- not a security problem (the link simply will not open), so it is reported, not fatal
        RAISE NOTICE 'these TODAs still store a storage URL instead of a path (it points outside the expected bucket): %', v_bad;
    END IF;
END $$;
