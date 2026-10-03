-- ============================================================================
-- Migration: 20261007000004_security_null_safe_service_context.sql
-- SECURITY PATCH. Trust checks that failed OPEN.
--
-- Found by the Batch 5 live dry run. public.is_service_context() (Batch 3) answered NULL, not FALSE, in a database
-- session that had never set the custom setting sakay.internal_context:
--
--     RETURN v_role = 'service_role' OR current_setting('sakay.internal_context', true) = 'true';
--            FALSE                      OR NULL                                          = NULL
--
-- and  IF NOT NULL THEN ...  is NULL, which PL/pgSQL treats as false, so every guard written as
-- IF NOT is_service_context() silently SKIPPED its protection. A session that has not run a policy-engine function yet
-- is exactly what a freshly opened pooled connection is, so the protection depended on which connection a request landed
-- on. Every test passed because the test sessions always had the setting defined.
--
-- What was unprotected in such a session (all verified in a fresh database session before and after this patch,
-- scripts/db-tests/security/):
--   * protect_read_only_columns()          strike, suspension and deactivation columns of passengers and drivers
--   * protect_strike_pause_config()        the strike pause switch (outside set_strike_accrual_pause())
--   * check_driver_online_eligibility()    going Available without driver_go_online(); going Offline with an open booking
--   * protect_verified_vehicle()           plate and franchise number of a verified vehicle
--   * classify_dispatch_attempt_response() the unanswered / resolved columns of an offer
--   * create_admin_review_flag()           any signed-in user could create review flags
--   * sweep_strike_state(), sweep_driver_presence()   service-only sweeps (not callable by clients: EXECUTE is revoked)
--   * booking_fare_insert_guard(), booking_fare_update_guard()   (Batch 5; already written NULL-safe)
--
-- The fix:
--   1. is_service_context() answers TRUE or FALSE, never NULL. This repairs every caller at once.
--   2. protect_read_only_columns() carried its own inline copy of the check; that one line now uses the helper.
--   Everything else in both functions is unchanged (same attributes, same body, same privileges).
--
-- Forward-only. Safe to run twice. Ends with a self-check that fails the migration if the helper can still answer NULL.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. THE HELPER: strictly TRUE or FALSE
-- ----------------------------------------------------------------------------
-- True for the service role, or inside a policy-engine function that set the internal-context flag.
-- Same signature and attributes as the Batch 3 version (STABLE, not SECURITY DEFINER, same search_path).
CREATE OR REPLACE FUNCTION public.is_service_context()
RETURNS BOOLEAN AS $$
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
    -- Both operands are made non-NULL: an unknown role is "not the service role" and a setting that was never set is
    -- "not true". Unknown means not trusted.
    RETURN COALESCE(v_role = 'service_role', FALSE)
        OR COALESCE(current_setting('sakay.internal_context', true), '') = 'true';
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 2. protect_read_only_columns(): the one inline copy of the check (Batch 3, copied verbatim except for one line)
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
        -- Security patch (20261007000004): this was  IF NOT (v_role = 'service_role' OR current_setting(...) = 'true')  which is
        -- NULL, not TRUE, in a database session that never set sakay.internal_context, so the whole block was skipped.
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
        IF OLD.account_status = 'Pending OTP Verification' AND NEW.account_status = 'Active' THEN
            RETURN NEW;
        END IF;
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
            IF NEW.verification_status IS DISTINCT FROM OLD.verification_status OR
               NEW.stage2_reviewed_by IS DISTINCT FROM OLD.stage2_reviewed_by OR
               NEW.stage2_reviewed_at IS DISTINCT FROM OLD.stage2_reviewed_at THEN
                RAISE EXCEPTION 'Access Denied: Drivers cannot modify verification status.';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 3. SELF-CHECK
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF public.is_service_context() IS NULL THEN
        RAISE EXCEPTION 'is_service_context() must never answer NULL';
    END IF;
END $$;
