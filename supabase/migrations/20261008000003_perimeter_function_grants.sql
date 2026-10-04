-- ============================================================================
-- Migration: 20261008000003_perimeter_function_grants.sql
-- PERIMETER LOCKDOWN, stage S2 (CONTRACT, functions). Nobody who is not signed in may execute a database function, except the one
-- public directory lookup; the OTP bookkeeping functions are for the server only.
--
-- Found by the Phase A audit: 43 functions in public were executable by anon (32 SECURITY DEFINER), through two grants at once: the
-- implicit PUBLIC grant every new function gets, and the explicit anon grant of Supabase's default privileges. Among them:
--   * activate_passenger_otp(phone)        flips any passenger with that number to Active, with no proof of the code
--   * increment_failed_otp / reset_failed_otp / check_otp_lockout    let anybody lock out, or probe, any passenger
--   * get_assigned_driver_details          (rewritten in S1) handed out a driver's live position
--   * every LGU / TODA workflow function (verify_driver_affiliation, approve_toda_accreditation, ...) - each checks the caller inside,
--     but they should never have been reachable without a login in the first place
--
-- What this migration does
--   1. For EVERY function in schema public (extension members excluded): remove EXECUTE from PUBLIC, anon and authenticated, give the
--      service role EXECUTE, then give `authenticated` back exactly what it had before - except the five server-only functions below.
--   2. The one function an unauthenticated visitor may call stays callable by anon: list_accredited_todas() (the registration picker).
--   3. Server-only (service_role): activate_passenger_otp, check_otp_lockout, increment_failed_otp, reset_failed_otp,
--      check_toda_excess_incidents. The Express server counts OTP failures and activates accounts itself (after it verified the code);
--      a signed-in browser has no business calling any of them.
--   4. Fail closed for the future: functions created from now on by the migration role get NO grants at all (not PUBLIC, not anon,
--      not authenticated). A migration that adds a client-callable function must GRANT it explicitly, as the Batch 3-5 migrations did.
--      (If a future migration installs an extension as the migration role, grant its functions to the roles that need them.)
--
-- Forward-only. Safe to run twice. Ends with a self-check over the whole schema.
-- ============================================================================

DO $$
DECLARE
    r RECORD;
    v_auth_had BOOLEAN;
    v_server_only TEXT[] := ARRAY['activate_passenger_otp', 'check_otp_lockout', 'increment_failed_otp', 'reset_failed_otp', 'check_toda_excess_incidents'];
    v_public_allowlist TEXT[] := ARRAY['list_accredited_todas'];
BEGIN
    FOR r IN
        SELECT p.oid, p.proname, p.oid::regprocedure AS sig
          FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace
           AND p.prokind IN ('f', 'p')
           AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    LOOP
        BEGIN
            v_auth_had := has_function_privilege('authenticated', r.oid, 'EXECUTE');

            EXECUTE format('REVOKE ALL ON ROUTINE %s FROM PUBLIC, anon, authenticated', r.sig);
            EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO service_role', r.sig);

            IF v_auth_had AND NOT (r.proname = ANY (v_server_only)) THEN
                EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO authenticated', r.sig);
            END IF;
            IF r.proname = ANY (v_public_allowlist) THEN
                EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO anon, authenticated', r.sig);
            END IF;
        EXCEPTION WHEN insufficient_privilege THEN
            -- a function owned by another role: reported here, and the self-check below fails if it is still exposed
            RAISE WARNING 'cannot change the privileges of % (owned by another role)', r.sig;
        END;
    END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Functions created from now on are closed until a migration opens them on purpose
-- ----------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- SELF-CHECK
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_bad TEXT;
BEGIN
    SELECT string_agg(p.proname, ', ') INTO v_bad
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
       AND p.proname <> 'list_accredited_todas'
       AND (has_function_privilege('anon', p.oid, 'EXECUTE')
            OR EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'));
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'functions still executable by anon / PUBLIC: %', v_bad;
    END IF;

    IF NOT has_function_privilege('anon', 'public.list_accredited_todas()', 'EXECUTE') THEN
        RAISE EXCEPTION 'list_accredited_todas() must stay callable by anon';
    END IF;

    SELECT string_agg(p.proname, ', ') INTO v_bad
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('activate_passenger_otp', 'check_otp_lockout', 'increment_failed_otp', 'reset_failed_otp', 'check_toda_excess_incidents')
       AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE'));
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'server-only functions must be callable by service_role only: %', v_bad;
    END IF;

    -- the helpers that row policies call as the querying role must still be executable by signed-in users
    IF NOT (has_function_privilege('authenticated', 'public.is_lgu_admin()', 'EXECUTE')
        AND has_function_privilege('authenticated', 'public.is_toda_admin()', 'EXECUTE')
        AND has_function_privilege('authenticated', 'public.get_current_passenger_id()', 'EXECUTE')
        AND has_function_privilege('authenticated', 'public.get_current_driver_id()', 'EXECUTE')
        AND has_function_privilege('authenticated', 'public.get_current_toda_admin_toda_id()', 'EXECUTE')
        AND has_function_privilege('authenticated', 'public.is_toda_admin_for_driver(uuid)', 'EXECUTE')
        AND has_function_privilege('authenticated', 'public.is_service_context()', 'EXECUTE')) THEN
        RAISE EXCEPTION 'a helper used by the row policies lost EXECUTE for authenticated';
    END IF;
END $$;
