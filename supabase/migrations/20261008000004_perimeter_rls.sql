-- ============================================================================
-- Migration: 20261008000004_perimeter_rls.sql
-- PERIMETER LOCKDOWN, stage S3 (CONTRACT, row-level security and table privileges).
--
-- Row policies are OR-ed: one `USING (true)` policy cancels every careful policy next to it. Forty policies in public (and the four on
-- storage.objects, see S4) were open to anon or to every signed-in user. Because sign-ups are open and auto-confirmed, "signed in" means
-- "anyone on the internet", so the model from here on is:
--
--   * anon has NO table privilege in public at all (revoked below), and no policy that names anon / public survives (cleanup at the end)
--   * a signed-in user sees and writes only their own rows, plus what their role needs:
--        LGU administrator   everything the LGU portal manages
--        TODA administrator  the drivers, applicants, bookings and incidents of their own TODA
--        passenger / driver  their own record, the bookings they are on, the offers made to them
--   * other people's data reaches the apps through small RPCs (S1): get_booking_counterparties, get_assigned_driver_details,
--     find_candidate_drivers, list_accredited_todas
--   * a row policy that needs ANOTHER table goes through a SECURITY DEFINER helper (rls_*), never a direct sub-select
--
-- Also here:
--   * protect_read_only_columns(): the Pending -> Active carve-out for passengers is removed. Activation is the server's job (it checks
--     the OTP, then uses the service role); a passenger can no longer activate their own account by editing their row.
--   * authenticated loses TRUNCATE / REFERENCES / TRIGGER (TRUNCATE ignores row security); new tables are created without anon grants
--     and with SELECT / INSERT / UPDATE / DELETE only for authenticated.
--
-- Forward-only. Safe to run twice. Ends with a self-check over every policy and table privilege in public.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. The passenger Pending -> Active carve-out goes (everything else is the S1 text of protect_read_only_columns)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_read_only_columns()
RETURNS TRIGGER AS $$
DECLARE
    v_role TEXT;
    v_claims JSONB;
BEGIN
    BEGIN
        v_role := auth.role();
    EXCEPTION WHEN OTHERS THEN
        v_role := NULL;
    END;
    IF v_role IS NULL THEN
        BEGIN
            v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::JSONB;
            v_role := v_claims->>'role';
        EXCEPTION WHEN OTHERS THEN
            v_role := current_setting('request.jwt.claim.role', true);
        END;
    END IF;

    -- Batch 3: strike / suspension / deactivation state is engine-only.
    IF TG_TABLE_NAME IN ('passenger', 'driver') THEN
        IF NOT COALESCE(public.is_service_context(), FALSE) THEN
            IF NEW.strikes_count IS DISTINCT FROM OLD.strikes_count
               OR NEW.suspended_until IS DISTINCT FROM OLD.suspended_until
               OR NEW.suspension_kind IS DISTINCT FROM OLD.suspension_kind
               OR NEW.suspension_reason IS DISTINCT FROM OLD.suspension_reason
               OR NEW.suspended_at IS DISTINCT FROM OLD.suspended_at
               OR NEW.suspension_trigger_strike_id IS DISTINCT FROM OLD.suspension_trigger_strike_id
               OR NEW.suspension_threshold IS DISTINCT FROM OLD.suspension_threshold
               OR NEW.deactivated_at IS DISTINCT FROM OLD.deactivated_at
               OR NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
                RAISE EXCEPTION 'Access Denied: Strike, suspension and deactivation state can only be changed by the policy engine.';
            END IF;
        END IF;
    END IF;

    IF v_role = 'service_role'
       OR current_setting('sakay.internal_context', true) = 'true'
       OR public.is_lgu_admin() THEN
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'passenger' THEN
        -- S3: no carve-out. A passenger is activated by the server after it verified the OTP (service role), never by the passenger.
        IF NEW.account_status IS DISTINCT FROM OLD.account_status THEN
            RAISE EXCEPTION 'Access Denied: Passengers cannot modify their own account_status.';
        END IF;
    END IF;

    IF TG_TABLE_NAME = 'driver' THEN
        IF NEW.account_status IS DISTINCT FROM OLD.account_status THEN
            RAISE EXCEPTION 'Access Denied: Only LGU Administrators can modify driver account_status.';
        END IF;

        IF NEW.license_expiry IS DISTINCT FROM OLD.license_expiry OR NEW.mtop_expiry IS DISTINCT FROM OLD.mtop_expiry THEN
            RAISE EXCEPTION 'Access Denied: Expiry dates can only be updated by LGU Administrators upon verified renewal.';
        END IF;

        IF NEW.toda_id IS DISTINCT FROM OLD.toda_id THEN
            RAISE EXCEPTION 'Access Denied: Active TODA affiliation must be selected through select_active_driver_affiliation RPC.';
        END IF;

        IF NEW.weighted_average_rating IS DISTINCT FROM OLD.weighted_average_rating THEN
            RAISE EXCEPTION 'Access Denied: Cannot modify weighted_average_rating.';
        END IF;

        IF NEW.is_permanently_disqualified IS DISTINCT FROM OLD.is_permanently_disqualified THEN
            RAISE EXCEPTION 'Access Denied: Only LGU Administrators can permanently disqualify drivers.';
        END IF;
    END IF;

    IF TG_TABLE_NAME = 'driver_verification' THEN
        IF EXISTS (
            SELECT 1 FROM public.driver d
            WHERE d.driver_id = OLD.driver_id
            AND d.auth_user_id = (SELECT auth.uid())
        ) THEN
            IF NEW.verification_status IS DISTINCT FROM OLD.verification_status
               OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
               OR NEW.reviewed_by_lgu IS DISTINCT FROM OLD.reviewed_by_lgu
               OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
               OR NEW.endorsed_at IS DISTINCT FROM OLD.endorsed_at
               OR NEW.lgu_approved_at IS DISTINCT FROM OLD.lgu_approved_at
               OR NEW.rejected_by IS DISTINCT FROM OLD.rejected_by
               OR NEW.rejected_at IS DISTINCT FROM OLD.rejected_at
               OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
               OR NEW.rejection_comment IS DISTINCT FROM OLD.rejection_comment THEN
                RAISE EXCEPTION 'Access Denied: Drivers cannot modify verification status.';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 1. passenger
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS passenger_select_policy ON public.passenger;
DROP POLICY IF EXISTS passenger_insert_policy ON public.passenger;
DROP POLICY IF EXISTS passenger_update_policy ON public.passenger;
DROP POLICY IF EXISTS passenger_select_scoped ON public.passenger;
DROP POLICY IF EXISTS passenger_insert_self ON public.passenger;
DROP POLICY IF EXISTS passenger_update_scoped ON public.passenger;

CREATE POLICY passenger_select_scoped ON public.passenger FOR SELECT TO authenticated
    USING (auth_user_id = (SELECT auth.uid()) OR (SELECT public.is_lgu_admin()));
-- The insert guard (S1) makes the row Pending whatever the caller sends; this only says WHOSE row it is.
CREATE POLICY passenger_insert_self ON public.passenger FOR INSERT TO authenticated
    WITH CHECK (auth_user_id = (SELECT auth.uid()));
CREATE POLICY passenger_update_scoped ON public.passenger FOR UPDATE TO authenticated
    USING (auth_user_id = (SELECT auth.uid()) OR (SELECT public.is_lgu_admin()))
    WITH CHECK (auth_user_id = (SELECT auth.uid()) OR (SELECT public.is_lgu_admin()));
-- passenger_delete_policy (LGU) is kept.

-- ----------------------------------------------------------------------------
-- 2. driver
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS driver_select_policy ON public.driver;
DROP POLICY IF EXISTS driver_insert_policy ON public.driver;
DROP POLICY IF EXISTS driver_update_policy ON public.driver;
DROP POLICY IF EXISTS driver_select_scoped ON public.driver;
DROP POLICY IF EXISTS driver_insert_self ON public.driver;
DROP POLICY IF EXISTS driver_update_scoped ON public.driver;

CREATE POLICY driver_select_scoped ON public.driver FOR SELECT TO authenticated
    USING (auth_user_id = (SELECT auth.uid())
           OR (SELECT public.is_lgu_admin())
           OR (toda_id IS NOT NULL AND toda_id = (SELECT public.get_current_toda_admin_toda_id())));
CREATE POLICY driver_insert_self ON public.driver FOR INSERT TO authenticated
    WITH CHECK (auth_user_id = (SELECT auth.uid()));
CREATE POLICY driver_update_scoped ON public.driver FOR UPDATE TO authenticated
    USING (auth_user_id = (SELECT auth.uid())
           OR (toda_id IS NOT NULL AND toda_id = (SELECT public.get_current_toda_admin_toda_id()))
           OR (SELECT public.is_lgu_admin()))
    WITH CHECK (auth_user_id = (SELECT auth.uid())
           OR (toda_id IS NOT NULL AND toda_id = (SELECT public.get_current_toda_admin_toda_id()))
           OR (SELECT public.is_lgu_admin()));
-- driver_delete_policy (TODA / LGU) is kept.

-- ----------------------------------------------------------------------------
-- 3. booking
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS booking_select_policy ON public.booking;
DROP POLICY IF EXISTS booking_insert_policy ON public.booking;
DROP POLICY IF EXISTS booking_update_policy ON public.booking;
DROP POLICY IF EXISTS booking_select_scoped ON public.booking;
DROP POLICY IF EXISTS booking_insert_own ON public.booking;
DROP POLICY IF EXISTS booking_update_participants ON public.booking;

CREATE POLICY booking_select_scoped ON public.booking FOR SELECT TO authenticated
    USING ((passenger_id IS NOT NULL AND passenger_id = (SELECT public.get_current_passenger_id()))
           OR (driver_id IS NOT NULL AND driver_id = (SELECT public.get_current_driver_id()))
           OR (SELECT public.is_lgu_admin())
           OR (toda_id IS NOT NULL AND toda_id = (SELECT public.get_current_toda_admin_toda_id()))
           OR (driver_id IS NOT NULL AND public.is_toda_admin_for_driver(driver_id))
           OR public.rls_driver_has_pending_offer(booking_id));
CREATE POLICY booking_insert_own ON public.booking FOR INSERT TO authenticated
    WITH CHECK (passenger_id = (SELECT public.get_current_passenger_id())
                AND driver_id IS NULL
                AND booking_status IN ('Pending', 'Searching Driver'));
-- The passenger, the assigned driver, or a driver taking an offered booking (driver_id NULL -> self; the identity guard allows nothing else).
CREATE POLICY booking_update_participants ON public.booking FOR UPDATE TO authenticated
    USING ((passenger_id IS NOT NULL AND passenger_id = (SELECT public.get_current_passenger_id()))
           OR (driver_id IS NOT NULL AND driver_id = (SELECT public.get_current_driver_id()))
           OR public.rls_driver_can_claim_booking(booking_id)
           OR (SELECT public.is_lgu_admin()))
    WITH CHECK ((passenger_id IS NOT NULL AND passenger_id = (SELECT public.get_current_passenger_id()))
           OR (driver_id IS NOT NULL AND driver_id = (SELECT public.get_current_driver_id()))
           OR (SELECT public.is_lgu_admin()));
-- booking_delete_policy (LGU) is kept.

-- ----------------------------------------------------------------------------
-- 4. dispatch_attempt (the passenger's dispatcher writes offers; the driver answers them)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS dispatch_attempt_select_policy ON public.dispatch_attempt;
DROP POLICY IF EXISTS dispatch_attempt_insert_policy ON public.dispatch_attempt;
DROP POLICY IF EXISTS dispatch_attempt_update_policy ON public.dispatch_attempt;
DROP POLICY IF EXISTS dispatch_attempt_select_scoped ON public.dispatch_attempt;
DROP POLICY IF EXISTS dispatch_attempt_insert_own_booking ON public.dispatch_attempt;
DROP POLICY IF EXISTS dispatch_attempt_update_scoped ON public.dispatch_attempt;

CREATE POLICY dispatch_attempt_select_scoped ON public.dispatch_attempt FOR SELECT TO authenticated
    USING ((driver_id IS NOT NULL AND driver_id = (SELECT public.get_current_driver_id()))
           OR public.rls_booking_is_mine(booking_id)
           OR (SELECT public.is_lgu_admin()));
CREATE POLICY dispatch_attempt_insert_own_booking ON public.dispatch_attempt FOR INSERT TO authenticated
    WITH CHECK (public.rls_booking_open_and_mine(booking_id) AND response_status = 'Pending');
CREATE POLICY dispatch_attempt_update_scoped ON public.dispatch_attempt FOR UPDATE TO authenticated
    USING ((driver_id IS NOT NULL AND driver_id = (SELECT public.get_current_driver_id()))
           OR public.rls_booking_is_mine(booking_id)
           OR (SELECT public.is_lgu_admin()))
    WITH CHECK ((driver_id IS NOT NULL AND driver_id = (SELECT public.get_current_driver_id()))
           OR public.rls_booking_is_mine(booking_id)
           OR (SELECT public.is_lgu_admin()));
-- dispatch_attempt_delete_policy (LGU) is kept.

-- ----------------------------------------------------------------------------
-- 5. driver_verification (documents and the review decision)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS driver_verification_select_policy ON public.driver_verification;
DROP POLICY IF EXISTS driver_verification_insert_policy ON public.driver_verification;
DROP POLICY IF EXISTS driver_verification_update_policy ON public.driver_verification;
DROP POLICY IF EXISTS driver_verification_select_scoped ON public.driver_verification;
DROP POLICY IF EXISTS driver_verification_insert_scoped ON public.driver_verification;
DROP POLICY IF EXISTS driver_verification_update_scoped ON public.driver_verification;

CREATE POLICY driver_verification_select_scoped ON public.driver_verification FOR SELECT TO authenticated
    USING (driver_id = (SELECT public.get_current_driver_id())
           OR (SELECT public.is_lgu_admin())
           OR public.is_toda_admin_for_driver(driver_id));
CREATE POLICY driver_verification_insert_scoped ON public.driver_verification FOR INSERT TO authenticated
    WITH CHECK (driver_id = (SELECT public.get_current_driver_id())
           OR (SELECT public.is_lgu_admin())
           OR public.is_toda_admin_for_driver(driver_id));
CREATE POLICY driver_verification_update_scoped ON public.driver_verification FOR UPDATE TO authenticated
    USING (driver_id = (SELECT public.get_current_driver_id())
           OR (SELECT public.is_lgu_admin())
           OR public.is_toda_admin_for_driver(driver_id))
    WITH CHECK (driver_id = (SELECT public.get_current_driver_id())
           OR (SELECT public.is_lgu_admin())
           OR public.is_toda_admin_for_driver(driver_id));
-- driver_verification_delete_policy (LGU) is kept.

-- ----------------------------------------------------------------------------
-- 6. notification
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS notification_select_policy ON public.notification;
DROP POLICY IF EXISTS notification_insert_policy ON public.notification;
DROP POLICY IF EXISTS notification_update_policy ON public.notification;
DROP POLICY IF EXISTS notification_select_scoped ON public.notification;
DROP POLICY IF EXISTS notification_insert_own ON public.notification;

-- recipient_id is text: a driver id, a passenger id, 'toda_<toda id>' (TODA administrators) or an LGU address (LGU sees all).
CREATE POLICY notification_select_scoped ON public.notification FOR SELECT TO authenticated
    USING ((passenger_id IS NOT NULL AND passenger_id = (SELECT public.get_current_passenger_id()))
           OR (driver_id IS NOT NULL AND driver_id = (SELECT public.get_current_driver_id()))
           OR (recipient_id IS NOT NULL AND recipient_id = (SELECT public.get_current_driver_id())::TEXT)
           OR (recipient_id IS NOT NULL AND recipient_id = (SELECT public.get_current_passenger_id())::TEXT)
           OR (recipient_id IS NOT NULL AND recipient_id = 'toda_' || (SELECT public.get_current_toda_admin_toda_id())::TEXT)
           OR (SELECT public.is_lgu_admin()));
-- A driver may leave a note about their own application; everything else is written by the server or by database functions.
CREATE POLICY notification_insert_own ON public.notification FOR INSERT TO authenticated
    WITH CHECK (driver_id IS NOT NULL AND driver_id = (SELECT public.get_current_driver_id()) AND passenger_id IS NULL
                AND (recipient_id IS NULL OR recipient_id = (SELECT public.get_current_driver_id())::TEXT));
-- notification_update_lgu, notification_delete_owner, notification_delete_policy are kept.

-- ----------------------------------------------------------------------------
-- 7. incident_report, rating, cancellation_record, shared_trip_match
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS incident_report_insert_policy ON public.incident_report;
DROP POLICY IF EXISTS incident_report_select_policy ON public.incident_report;
DROP POLICY IF EXISTS incident_report_select_scoped ON public.incident_report;
DROP POLICY IF EXISTS incident_report_insert_driver ON public.incident_report;
DROP POLICY IF EXISTS incident_report_insert_passenger ON public.incident_report;

CREATE POLICY incident_report_select_scoped ON public.incident_report FOR SELECT TO authenticated
    USING ((passenger_id IS NOT NULL AND passenger_id = (SELECT public.get_current_passenger_id()))
           OR (driver_id IS NOT NULL AND driver_id = (SELECT public.get_current_driver_id()))
           OR (SELECT public.is_lgu_admin())
           OR (reported_toda_id IS NOT NULL AND reported_toda_id = (SELECT public.get_current_toda_admin_toda_id()))
           OR (driver_id IS NOT NULL AND public.is_toda_admin_for_driver(driver_id))
           OR public.rls_booking_in_my_toda(booking_id));
-- A report is filed about a booking the reporter was on.
CREATE POLICY incident_report_insert_driver ON public.incident_report FOR INSERT TO authenticated
    WITH CHECK (driver_id = (SELECT public.get_current_driver_id()) AND public.rls_booking_assigned_to_me(booking_id));
CREATE POLICY incident_report_insert_passenger ON public.incident_report FOR INSERT TO authenticated
    WITH CHECK (passenger_id = (SELECT public.get_current_passenger_id()) AND public.rls_booking_is_mine(booking_id));
-- incident_report_update_*, incident_report_delete_policy are kept.

DROP POLICY IF EXISTS rating_insert_policy ON public.rating;
DROP POLICY IF EXISTS rating_select_policy ON public.rating;
DROP POLICY IF EXISTS rating_select_lgu ON public.rating;
CREATE POLICY rating_select_lgu ON public.rating FOR SELECT TO authenticated USING ((SELECT public.is_lgu_admin()));
-- rating_insert_participant and rating_select_participants are kept (they already existed, the open policies cancelled them).

DROP POLICY IF EXISTS cancellation_record_insert_policy ON public.cancellation_record;
DROP POLICY IF EXISTS cancellation_record_select_policy ON public.cancellation_record;
DROP POLICY IF EXISTS cancellation_record_select_scoped ON public.cancellation_record;
CREATE POLICY cancellation_record_select_scoped ON public.cancellation_record FOR SELECT TO authenticated
    USING (public.rls_booking_visible(booking_id));
-- nobody inserts a cancellation record from a browser; no insert policy.

DROP POLICY IF EXISTS shared_trip_match_insert_policy ON public.shared_trip_match;
DROP POLICY IF EXISTS shared_trip_match_select_policy ON public.shared_trip_match;
DROP POLICY IF EXISTS shared_trip_match_update_policy ON public.shared_trip_match;
DROP POLICY IF EXISTS shared_trip_match_select_scoped ON public.shared_trip_match;
CREATE POLICY shared_trip_match_select_scoped ON public.shared_trip_match FOR SELECT TO authenticated
    USING (public.rls_booking_visible(primary_booking_id)
           OR (additional_booking_id IS NOT NULL AND public.rls_booking_visible(additional_booking_id)));

-- ----------------------------------------------------------------------------
-- 8. toda, toda_admin (a TODA is registered through register_toda_with_admin(), never by a table insert)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS toda_insert_policy ON public.toda;
DROP POLICY IF EXISTS toda_select_policy ON public.toda;
DROP POLICY IF EXISTS toda_select_scoped ON public.toda;
DROP POLICY IF EXISTS toda_insert_lgu ON public.toda;
CREATE POLICY toda_select_scoped ON public.toda FOR SELECT TO authenticated
    USING ((SELECT public.is_lgu_admin()) OR toda_id = (SELECT public.get_current_toda_admin_toda_id()));
CREATE POLICY toda_insert_lgu ON public.toda FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.is_lgu_admin()));
-- toda_update_policy and toda_delete_policy are kept.

DROP POLICY IF EXISTS allow_anon_toda_admin_registration ON public.toda_admin;
DROP POLICY IF EXISTS toda_admin_insert_policy ON public.toda_admin;
DROP POLICY IF EXISTS allow_toda_admin_read ON public.toda_admin;
DROP POLICY IF EXISTS toda_admin_select_policy ON public.toda_admin;
DROP POLICY IF EXISTS toda_admin_select_scoped ON public.toda_admin;
DROP POLICY IF EXISTS toda_admin_insert_lgu ON public.toda_admin;
CREATE POLICY toda_admin_select_scoped ON public.toda_admin FOR SELECT TO authenticated
    USING (auth_user_id = (SELECT auth.uid())
           OR (SELECT public.is_lgu_admin())
           OR toda_id = (SELECT public.get_current_toda_admin_toda_id()));
CREATE POLICY toda_admin_insert_lgu ON public.toda_admin FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.is_lgu_admin()));
-- toda_admin_update_policy and toda_admin_delete_policy are kept (the S1 trigger stops a TODA administrator moving or reinstating themselves).

-- ----------------------------------------------------------------------------
-- 9. audit_log
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS audit_log_insert_policy ON public.audit_log;
DROP POLICY IF EXISTS audit_log_select_policy ON public.audit_log;
DROP POLICY IF EXISTS audit_log_insert_staff ON public.audit_log;
DROP POLICY IF EXISTS audit_log_select_scoped ON public.audit_log;
CREATE POLICY audit_log_insert_staff ON public.audit_log FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.is_lgu_admin()) OR (SELECT public.is_toda_admin()));
CREATE POLICY audit_log_select_scoped ON public.audit_log FOR SELECT TO authenticated
    USING ((SELECT public.is_lgu_admin())
           OR (toda_admin_id IS NOT NULL AND toda_admin_id = (SELECT t.admin_id FROM public.toda_admin t WHERE t.auth_user_id = (SELECT auth.uid()))));
-- audit_log_manage_lgu is kept.

-- ----------------------------------------------------------------------------
-- 10. reference data: readable by signed-in users only
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS announcement_select_policy ON public.announcement;
CREATE POLICY announcement_select_policy ON public.announcement FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS fare_matrix_select_policy ON public.fare_matrix;
CREATE POLICY fare_matrix_select_policy ON public.fare_matrix FOR SELECT TO authenticated
    USING (is_active = true OR (SELECT public.is_lgu_admin()));

DROP POLICY IF EXISTS service_area_config_select ON public.service_area_config;
CREATE POLICY service_area_config_select ON public.service_area_config FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS system_policy_config_select ON public.system_policy_config;
CREATE POLICY system_policy_config_select ON public.system_policy_config FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS analytics_log_select_policy ON public.analytics_log;
CREATE POLICY analytics_log_select_policy ON public.analytics_log FOR SELECT TO authenticated
    USING ((SELECT public.is_lgu_admin()) OR (SELECT public.is_toda_admin()));

-- ----------------------------------------------------------------------------
-- 11. Anything else in public that names anon / public goes (hand-made policies the repo never knew about)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies
              WHERE schemaname = 'public' AND (roles && ARRAY['anon', 'public']::NAME[])
    LOOP
        RAISE NOTICE 'dropping policy %.% (it named anon / public)', r.tablename, r.policyname;
        EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 12. TABLE PRIVILEGES
-- ----------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;
DO $$
BEGIN
    -- PostgreSQL 17+ has MAINTAIN (VACUUM / ANALYZE / LOCK on a table); older servers do not know the word.
    BEGIN
        EXECUTE 'REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM authenticated';
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;
END $$;

-- tables and sequences created from now on: nothing for anon; select / insert / update / delete for authenticated (row policies decide)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

-- ----------------------------------------------------------------------------
-- 13. SELF-CHECK
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_bad TEXT;
BEGIN
    SELECT string_agg(tablename || '.' || policyname, ', ') INTO v_bad
      FROM pg_policies WHERE schemaname = 'public' AND (roles && ARRAY['anon', 'public']::NAME[]);
    IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'policies still open to anon / public: %', v_bad; END IF;

    SELECT string_agg(c.relname, ', ') INTO v_bad
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v', 'm', 'p')
       AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'INSERT')
            OR has_table_privilege('anon', c.oid, 'UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE')
            OR has_table_privilege('anon', c.oid, 'TRUNCATE'));
    IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'anon still holds table privileges on: %', v_bad; END IF;

    SELECT string_agg(c.relname, ', ') INTO v_bad
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
       AND (has_table_privilege('authenticated', c.oid, 'TRUNCATE') OR has_table_privilege('authenticated', c.oid, 'REFERENCES')
            OR has_table_privilege('authenticated', c.oid, 'TRIGGER'));
    IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'authenticated still holds TRUNCATE / REFERENCES / TRIGGER on: %', v_bad; END IF;

    -- every table in public must have row security on
    SELECT string_agg(c.relname, ', ') INTO v_bad
      FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity;
    IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'row-level security is off on: %', v_bad; END IF;

    IF position('Pending OTP Verification'' AND NEW.account_status = ''Active' IN pg_get_functiondef('public.protect_read_only_columns()'::regprocedure)) > 0 THEN
        RAISE EXCEPTION 'the passenger self-activation carve-out is still in protect_read_only_columns()';
    END IF;
END $$;
