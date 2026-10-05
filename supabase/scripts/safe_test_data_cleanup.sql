-- ============================================================================
-- SAKAY CAPSTONE PROJECT — SAFE TEST DATA CLEANUP SCRIPT
-- ============================================================================
-- Purpose:
--   Safely removes TEST passenger / driver registrations (and, for one mobile number, everything that hangs off them, including the
--   Supabase Auth login) while STRICTLY PRESERVING:
--     1. TODA Organizations (CCTODA, BLTODA, SVTODA) and their roster entries
--     2. TODA Association Admins
--     3. City LGU Admins (admin@gmail.com)
--     4. Fare Matrix & Tariff Ordinances
--     5. Platform Audit Trails (audit_log is never touched)
--
-- Run it in the Supabase SQL editor, one numbered part at a time (select the part, then Run).
--   PART 1  preview of every driver (read-only)
--   PART 2  OPTIONAL, commented out: wipe EVERY driver. Only for a project that holds nothing but test drivers.
--   PART 3  preview, for ONE mobile number, of what part 4 would delete (read-only)
--   PART 4  ordered, all-or-nothing delete of ONE mobile number (passenger and / or driver, with the login). DRY RUN by default.
--
-- Run supabase/migrations/20261009000001_fk_consistency_booking_passenger.sql first (it removes the booking.passenger_id contradiction
-- that made deleting a passenger with trips fail). Part 4 does not depend on it: it deletes the bookings itself, before the passenger.
-- ============================================================================


-- ============================================================================
-- PART 1. PREVIEW TEST DRIVERS (read-only)
-- ============================================================================
SELECT
    d.driver_id,
    d.full_name,
    d.contact_number,
    d.account_status,
    d.created_at,
    v.verification_status,
    v.submitted_license_number,
    (SELECT count(*) FROM public.driver_toda_affiliation a WHERE a.driver_id = d.driver_id) AS affiliations
FROM public.driver d
LEFT JOIN public.driver_verification v ON d.driver_id = v.driver_id
ORDER BY d.created_at DESC;


-- ============================================================================
-- PART 2. OPTIONAL: WIPE EVERY DRIVER (commented out on purpose)
-- ============================================================================
-- Deleting a driver does not delete the driver's Supabase Auth login (e-mail driver_63<number>@sakay.ph). A login that is left behind
-- makes the registration screen answer "mobile number already registered" for that number. Use PART 4 per number to remove the
-- login too, or delete the matching users in Authentication > Users (never an administrator).
/*
BEGIN;

DELETE FROM public.driver_toda_affiliation WHERE driver_id IN (SELECT driver_id FROM public.driver);
DELETE FROM public.driver_verification     WHERE driver_id IN (SELECT driver_id FROM public.driver);
DELETE FROM public.driver;

COMMIT;
*/


-- ============================================================================
-- PART 3. PREVIEW FOR ONE MOBILE NUMBER (read-only)
--   Replace 9XXXXXXXXX (last ten digits, starting with 9) in the first line. Spelling does not matter: +63..., 63..., 09... all match.
-- ============================================================================
WITH p AS (SELECT '9XXXXXXXXX'::TEXT AS sub),
pax AS (
    SELECT x.passenger_id, x.auth_user_id
      FROM public.passenger x, p
     WHERE right(regexp_replace(COALESCE(x.contact_number, ''), '\D', '', 'g'), 10) = p.sub
),
drv AS (
    SELECT x.driver_id, x.auth_user_id
      FROM public.driver x, p
     WHERE right(regexp_replace(COALESCE(x.contact_number, ''), '\D', '', 'g'), 10) = p.sub
),
persons AS (SELECT passenger_id AS id FROM pax UNION SELECT driver_id FROM drv),
logins AS (
    SELECT u.id, u.email
      FROM auth.users u, p
     WHERE u.id IN (SELECT auth_user_id FROM pax UNION SELECT auth_user_id FROM drv)
        OR right(regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g'), 10) = p.sub
        OR u.email ~* ('^((passenger|test|driver)_)?\+?(63|0)?' || p.sub || '@(sakay\.ph|driver\.sakay\.internal|sakay\.internal|sakay\.local)$')
)
SELECT 'passenger rows'                 AS what, count(*) AS n FROM pax
UNION ALL SELECT 'driver rows',                  count(*) FROM drv
UNION ALL SELECT 'auth.users logins',            count(*) FROM logins
UNION ALL SELECT '  ...of which administrators', count(*) FROM logins
                  WHERE id IN (SELECT auth_user_id FROM public.lgu_admin UNION SELECT auth_user_id FROM public.toda_admin)
UNION ALL SELECT 'booking',                      count(*) FROM public.booking b
                  WHERE b.passenger_id IN (SELECT passenger_id FROM pax) OR b.driver_id IN (SELECT driver_id FROM drv)
UNION ALL SELECT 'dispatch_attempt',             count(*) FROM public.dispatch_attempt WHERE driver_id IN (SELECT driver_id FROM drv)
UNION ALL SELECT 'gps_log',                      count(*) FROM public.gps_log WHERE driver_id IN (SELECT driver_id FROM drv)
UNION ALL SELECT 'rating (rater or ratee)',      count(*) FROM public.rating
                  WHERE rater_id IN (SELECT id FROM persons) OR ratee_id IN (SELECT id FROM persons)
UNION ALL SELECT 'incident_report',              count(*) FROM public.incident_report
                  WHERE passenger_id IN (SELECT passenger_id FROM pax) OR driver_id IN (SELECT driver_id FROM drv)
UNION ALL SELECT 'notification',                 count(*) FROM public.notification
                  WHERE passenger_id IN (SELECT passenger_id FROM pax) OR driver_id IN (SELECT driver_id FROM drv)
                     OR recipient_id IN (SELECT id::TEXT FROM persons)
UNION ALL SELECT 'strikes_ledger',               count(*) FROM public.strikes_ledger WHERE subject_id IN (SELECT id FROM persons)
UNION ALL SELECT 'exemption_request',            count(*) FROM public.exemption_request WHERE subject_id IN (SELECT id FROM persons)
UNION ALL SELECT 'driver_document',              count(*) FROM public.driver_document WHERE driver_id IN (SELECT driver_id FROM drv)
UNION ALL SELECT 'document_review_history',      count(*) FROM public.document_review_history WHERE driver_id IN (SELECT driver_id FROM drv)
UNION ALL SELECT 'driver_toda_affiliation',      count(*) FROM public.driver_toda_affiliation WHERE driver_id IN (SELECT driver_id FROM drv)
UNION ALL SELECT 'driver_verification',          count(*) FROM public.driver_verification WHERE driver_id IN (SELECT driver_id FROM drv)
UNION ALL SELECT 'driver_online_session',        count(*) FROM public.driver_online_session WHERE driver_id IN (SELECT driver_id FROM drv);

-- The logins themselves (look at is_admin: PART 4 refuses to run if any of them is an administrator)
WITH p AS (SELECT '9XXXXXXXXX'::TEXT AS sub)
SELECT u.id, u.email, u.phone, u.created_at, u.deleted_at,
       EXISTS (SELECT 1 FROM public.driver    d WHERE d.auth_user_id = u.id) AS has_driver_row,
       EXISTS (SELECT 1 FROM public.passenger x WHERE x.auth_user_id = u.id) AS has_passenger_row,
       (EXISTS (SELECT 1 FROM public.lgu_admin l WHERE l.auth_user_id = u.id)
        OR EXISTS (SELECT 1 FROM public.toda_admin t WHERE t.auth_user_id = u.id)) AS is_admin
  FROM auth.users u, p
 WHERE u.id IN (SELECT auth_user_id FROM public.passenger WHERE right(regexp_replace(COALESCE(contact_number, ''), '\D', '', 'g'), 10) = p.sub
                UNION SELECT auth_user_id FROM public.driver WHERE right(regexp_replace(COALESCE(contact_number, ''), '\D', '', 'g'), 10) = p.sub)
    OR right(regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g'), 10) = p.sub
    OR u.email ~* ('^((passenger|test|driver)_)?\+?(63|0)?' || p.sub || '@(sakay\.ph|driver\.sakay\.internal|sakay\.internal|sakay\.local)$');


-- ============================================================================
-- PART 4. DELETE ONE MOBILE NUMBER: passenger and / or driver, every child row, and the Supabase Auth login
-- ============================================================================
-- Edit the three constants below, run it once as a DRY RUN (v_apply = FALSE): it deletes, counts, then deliberately ends with an
-- error that ROLLS EVERYTHING BACK and lists what it would have deleted. When the list is what you expect, set v_apply = TRUE and run
-- it again. The whole DO block is one transaction: it either deletes everything or nothing.
--
-- What it will NOT do (it stops with an error and deletes nothing):
--   * any login it would delete that is an LGU administrator or a TODA administrator
--   * any login it would delete that also owns a passenger / driver record outside this clean-up (another number, or the other role
--     when v_role is not 'both')
-- What it never touches: toda, toda_admin, lgu_admin, toda_roster_entry, fare_matrix, audit_log, system / service-area configuration,
--   and the files in Storage (delete a test driver's folder <auth user id>/ in Storage > driver-licenses / mtop-permits /
--   tricycle-photos / profiles in the dashboard; direct SQL deletes of storage objects are blocked by Supabase).
-- Bookings: a passenger's bookings are deleted. For a DRIVER, only the bookings that have no other passenger (or a passenger that is
--   being deleted too) are deleted; a trip a test driver gave to a REAL passenger is kept and simply loses its driver link.
--
-- Order (children first; every table below exists in supabase/migrations/):
--   fare_adjustment_history, gps_log, dispatch_attempt, cancellation_record, shared_trip_match, rating, incident_report,
--   exemption_request, strikes_ledger, admin_review_flag, notification, driver_online_session, document_review_history,
--   driver_document, driver_toda_affiliation, driver_verification, booking, driver, passenger, auth.identities, auth.users
-- Types: ids in rating / strikes_ledger / exemption_request are uuid; admin_review_flag.subject_id and notification.recipient_id /
--   subject_id are TEXT (compared as text); audit_log is left alone.
DO $$
DECLARE
    -- ===== EDIT THESE THREE LINES ===================================================================================
    v_sub   CONSTANT TEXT    := '9XXXXXXXXX';   -- the last ten digits of the number, starting with 9
    v_role  CONSTANT TEXT    := 'both';         -- 'passenger' | 'driver' | 'both'
    v_apply CONSTANT BOOLEAN := FALSE;          -- FALSE = dry run (rolls back, lists the counts)   TRUE = really delete
    -- ================================================================================================================
    v_pax_ids      UUID[] := ARRAY[]::UUID[];
    v_drv_ids      UUID[] := ARRAY[]::UUID[];
    v_person_ids   UUID[];
    v_aff_ids      UUID[];
    v_ref_texts    TEXT[];
    v_auth_ids     UUID[];
    v_booking_ids  UUID[];
    v_prefixes     TEXT;
    v_admins       TEXT;
    v_cross        TEXT;
    v_n            BIGINT;
    v_counts       JSONB := '{}'::JSONB;
    v_lgu_before   BIGINT;
    v_toda_before  BIGINT;
    v_toda_org_before BIGINT;
BEGIN
    IF v_sub !~ '^9[0-9]{9}$' THEN
        RAISE EXCEPTION 'v_sub must be exactly ten digits starting with 9 (the number without +63 / 0), got "%"', v_sub;
    END IF;
    IF v_role NOT IN ('passenger', 'driver', 'both') THEN
        RAISE EXCEPTION 'v_role must be passenger, driver or both';
    END IF;

    -- This is an administrator's maintenance session: the database guards that protect rows from the apps treat it as the policy engine.
    PERFORM set_config('sakay.internal_context', 'true', TRUE);

    SELECT count(*) INTO v_lgu_before      FROM public.lgu_admin;
    SELECT count(*) INTO v_toda_before     FROM public.toda_admin;
    SELECT count(*) INTO v_toda_org_before FROM public.toda;

    -- 1. WHO: the records whose contact number ends in v_sub (compared on digits only: +63, 63, 0 prefixes and spaces do not matter)
    IF v_role IN ('passenger', 'both') THEN
        v_pax_ids := COALESCE((SELECT array_agg(x.passenger_id) FROM public.passenger x
                                WHERE right(regexp_replace(COALESCE(x.contact_number, ''), '\D', '', 'g'), 10) = v_sub), ARRAY[]::UUID[]);
    END IF;
    IF v_role IN ('driver', 'both') THEN
        v_drv_ids := COALESCE((SELECT array_agg(x.driver_id) FROM public.driver x
                                WHERE right(regexp_replace(COALESCE(x.contact_number, ''), '\D', '', 'g'), 10) = v_sub), ARRAY[]::UUID[]);
    END IF;
    v_person_ids := v_pax_ids || v_drv_ids;
    v_aff_ids := COALESCE((SELECT array_agg(a.affiliation_id) FROM public.driver_toda_affiliation a WHERE a.driver_id = ANY (v_drv_ids)), ARRAY[]::UUID[]);
    v_ref_texts := COALESCE((SELECT array_agg(t::TEXT) FROM unnest(v_person_ids || v_aff_ids) AS t), ARRAY[]::TEXT[]);

    -- 2. THE LOGINS: the ones linked to those records, plus ORPHANS (a login with no record) found by phone or by the e-mail alias
    --    the apps create (driver_63<number>@sakay.ph, passenger_63<number>@sakay.ph, and the older spellings).
    v_prefixes := CASE v_role WHEN 'passenger' THEN 'passenger|test' WHEN 'driver' THEN 'driver' ELSE 'passenger|test|driver' END;
    v_auth_ids := COALESCE((
        SELECT array_agg(DISTINCT x.id) FROM (
            SELECT p.auth_user_id AS id FROM public.passenger p WHERE p.passenger_id = ANY (v_pax_ids)
            UNION
            SELECT d.auth_user_id       FROM public.driver d    WHERE d.driver_id    = ANY (v_drv_ids)
            UNION
            SELECT u.id FROM auth.users u
             WHERE right(regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g'), 10) = v_sub
                OR u.email ~* ('^((' || v_prefixes || ')_)?\+?(63|0)?' || v_sub || '@(sakay\.ph|driver\.sakay\.internal|sakay\.internal|sakay\.local)$')
        ) x WHERE x.id IS NOT NULL
    ), ARRAY[]::UUID[]);

    IF cardinality(v_person_ids) = 0 AND cardinality(v_auth_ids) = 0 THEN
        RAISE NOTICE 'Nothing found for number ending % (role %). Nothing to delete.', v_sub, v_role;
        RETURN;
    END IF;

    -- 3. GUARDS: never an administrator, never a login that also owns a record outside this clean-up
    SELECT string_agg(x.id::TEXT || ' (' || x.what || ')', ', ') INTO v_admins FROM (
        SELECT a.auth_user_id AS id, 'lgu_admin'  AS what FROM public.lgu_admin  a WHERE a.auth_user_id = ANY (v_auth_ids)
        UNION ALL
        SELECT a.auth_user_id,       'toda_admin'         FROM public.toda_admin a WHERE a.auth_user_id = ANY (v_auth_ids)
    ) x;
    IF v_admins IS NOT NULL THEN
        RAISE EXCEPTION 'REFUSED, nothing deleted: these logins are administrators: %', v_admins;
    END IF;

    SELECT string_agg(x.id::TEXT || ' (' || x.what || ')', ', ') INTO v_cross FROM (
        SELECT p.auth_user_id AS id, 'passenger ' || p.passenger_id::TEXT AS what FROM public.passenger p
         WHERE p.auth_user_id = ANY (v_auth_ids) AND NOT (p.passenger_id = ANY (v_pax_ids))
        UNION ALL
        SELECT d.auth_user_id, 'driver ' || d.driver_id::TEXT FROM public.driver d
         WHERE d.auth_user_id = ANY (v_auth_ids) AND NOT (d.driver_id = ANY (v_drv_ids))
    ) x;
    IF v_cross IS NOT NULL THEN
        RAISE EXCEPTION 'REFUSED, nothing deleted: the login(s) also own records outside this clean-up (other number or other role): %. Use v_role = ''both'' or clean those records first.', v_cross;
    END IF;

    -- 4. WHICH BOOKINGS: all of a passenger's; for a driver only the ones without another (real) passenger
    v_booking_ids := COALESCE((
        SELECT array_agg(b.booking_id) FROM public.booking b
         WHERE b.passenger_id = ANY (v_pax_ids)
            OR (b.driver_id = ANY (v_drv_ids) AND (b.passenger_id IS NULL OR b.passenger_id = ANY (v_pax_ids)))
    ), ARRAY[]::UUID[]);
    SELECT count(*) INTO v_n FROM public.booking b WHERE b.driver_id = ANY (v_drv_ids) AND NOT (b.booking_id = ANY (v_booking_ids));
    v_counts := v_counts || jsonb_build_object('bookings_kept_driver_link_removed', v_n);

    -- 5. DELETE, children first
    DELETE FROM public.fare_adjustment_history WHERE booking_id = ANY (v_booking_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('fare_adjustment_history', v_n);

    DELETE FROM public.gps_log WHERE booking_id = ANY (v_booking_ids) OR driver_id = ANY (v_drv_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('gps_log', v_n);

    DELETE FROM public.dispatch_attempt WHERE booking_id = ANY (v_booking_ids) OR driver_id = ANY (v_drv_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('dispatch_attempt', v_n);

    DELETE FROM public.cancellation_record WHERE booking_id = ANY (v_booking_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('cancellation_record', v_n);

    DELETE FROM public.shared_trip_match WHERE primary_booking_id = ANY (v_booking_ids) OR additional_booking_id = ANY (v_booking_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('shared_trip_match', v_n);

    DELETE FROM public.rating
     WHERE booking_id = ANY (v_booking_ids) OR rater_id = ANY (v_person_ids) OR ratee_id = ANY (v_person_ids);   -- uuid columns
    GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('rating', v_n);

    DELETE FROM public.incident_report
     WHERE booking_id = ANY (v_booking_ids) OR passenger_id = ANY (v_pax_ids) OR driver_id = ANY (v_drv_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('incident_report', v_n);

    DELETE FROM public.exemption_request WHERE subject_id = ANY (v_person_ids);                                 -- uuid
    GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('exemption_request', v_n);

    DELETE FROM public.strikes_ledger WHERE subject_id = ANY (v_person_ids);                                    -- uuid
    GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('strikes_ledger', v_n);

    DELETE FROM public.admin_review_flag WHERE subject_id = ANY (v_ref_texts);                                  -- TEXT
    GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('admin_review_flag', v_n);

    DELETE FROM public.notification
     WHERE passenger_id = ANY (v_pax_ids) OR driver_id = ANY (v_drv_ids)
        OR recipient_id = ANY (v_ref_texts) OR subject_id = ANY (v_ref_texts);                                  -- TEXT columns
    GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('notification', v_n);

    DELETE FROM public.driver_online_session WHERE driver_id = ANY (v_drv_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('driver_online_session', v_n);

    DELETE FROM public.document_review_history WHERE driver_id = ANY (v_drv_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('document_review_history', v_n);

    DELETE FROM public.driver_document WHERE driver_id = ANY (v_drv_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('driver_document', v_n);

    DELETE FROM public.driver_toda_affiliation WHERE driver_id = ANY (v_drv_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('driver_toda_affiliation', v_n);

    DELETE FROM public.driver_verification WHERE driver_id = ANY (v_drv_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('driver_verification', v_n);

    DELETE FROM public.booking WHERE booking_id = ANY (v_booking_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('booking', v_n);

    DELETE FROM public.driver WHERE driver_id = ANY (v_drv_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('driver', v_n);

    DELETE FROM public.passenger WHERE passenger_id = ANY (v_pax_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('passenger', v_n);

    DELETE FROM auth.identities WHERE user_id = ANY (v_auth_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('auth.identities', v_n);

    DELETE FROM auth.users WHERE id = ANY (v_auth_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('auth.users', v_n);

    -- 6. VERIFY: the number is gone everywhere it was looked for, and no administrator or TODA was lost
    IF EXISTS (SELECT 1 FROM public.passenger WHERE passenger_id = ANY (v_pax_ids))
       OR EXISTS (SELECT 1 FROM public.driver WHERE driver_id = ANY (v_drv_ids))
       OR EXISTS (SELECT 1 FROM auth.users WHERE id = ANY (v_auth_ids)) THEN
        RAISE EXCEPTION 'Verification failed: some of the records are still there. Nothing was committed.';
    END IF;
    IF (SELECT count(*) FROM public.lgu_admin) <> v_lgu_before
       OR (SELECT count(*) FROM public.toda_admin) <> v_toda_before
       OR (SELECT count(*) FROM public.toda) <> v_toda_org_before THEN
        RAISE EXCEPTION 'Verification failed: the number of LGU administrators, TODA administrators or TODAs changed. Nothing was committed.';
    END IF;

    IF v_apply THEN
        RAISE NOTICE 'DELETED for number ending % (role %): %', v_sub, v_role, v_counts;
    ELSE
        RAISE EXCEPTION 'DRY RUN, nothing was deleted (this error rolls everything back on purpose). For the number ending % (role %) it WOULD delete: %. Set v_apply to TRUE and run again to delete.',
            v_sub, v_role, v_counts;
    END IF;
END $$;

-- After a real run (v_apply = TRUE), run PART 3 again with the same number: every count must be 0.
-- Then delete the person's files in Storage (folder <auth user id>/) if they uploaded documents.
