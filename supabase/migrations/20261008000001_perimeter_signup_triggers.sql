-- ============================================================================
-- Migration: 20261008000001_perimeter_signup_triggers.sql
-- PERIMETER LOCKDOWN, stage S0 (HOT-FIX). A sign-up must never be able to grant itself an administrator role.
--
-- The flaw (found in the Perimeter Lockdown Phase A audit, reproduced on the local emulator, live function bodies read):
-- two SECURITY DEFINER triggers on auth.users read the role from raw_user_meta_data. That field is whatever the browser sends in
-- supabase.auth.signUp({ options: { data: { ... } } }), i.e. the caller chooses it. Sign-ups are open and auto-confirmed on the hosted
-- project, so one request was enough:
--
--   * handle_new_user_signup():          role = 'lgu_admin'                      -> an ACTIVE public.lgu_admin row
--                                        (is_lgu_admin() is the root of trust of about 25 row policies and of every admin RPC)
--   * handle_new_toda_admin_user():      role = 'toda_admin' + a public acronym  -> an ACTIVE public.toda_admin of that TODA
--   * handle_user_auth_update():         any confirmed phone flips a Pending passenger to Active, even when it is not the number on
--                                        the passenger row
--
-- Nothing in the database (RLS, grants, storage) can compensate for this, because SECURITY DEFINER code bypasses RLS.
--
-- What this migration does
--   1. handle_new_user_signup(): passenger and driver branches only (they create PENDING rows, which carry no authority). The
--      lgu_admin branch is gone. Any other role in the metadata is ignored.
--   2. handle_new_toda_admin_user() and its trigger are dropped. A TODA administrator is created only by the registration RPC
--      (public.register_toda_with_admin, rewritten in S1 to use auth.uid()) or by an LGU administrator.
--   3. handle_user_auth_update(): a confirmed phone activates a Pending passenger only when it IS the number on the passenger row
--      (compared on the last 10 digits), and it declares itself the policy engine for that one status change (S3 stops a
--      passenger from making that change on their own row).
--   4. EXECUTE on the two trigger functions is revoked from PUBLIC / anon / authenticated (a trigger needs no EXECUTE at fire time).
--
-- Not touched: existing rows (no account is deleted or changed), trg_auto_confirm_synthetic_users, on_auth_user_created itself.
-- Forward-only. Safe to run twice. Ends with a self-check that fails the migration if any trigger on auth.users can still write an
-- administrator table.
--
-- Rule for all future SQL: never authorise from user_metadata / raw_user_meta_data. It is user-editable. Use role tables keyed by
-- auth.uid(), or raw_app_meta_data (set only by the server).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Sign-up trigger: passenger and driver rows only, always Pending
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user_signup()
RETURNS TRIGGER AS $$
DECLARE
    user_role TEXT;
    user_full_name TEXT;
    user_contact_number TEXT;
    user_toda_id UUID;
BEGIN
    -- The role below is chosen by the person signing up. It may only ever produce a PENDING passenger or driver record.
    -- Administrator roles are never created from sign-up metadata (see the header of this migration).
    user_role := NEW.raw_user_meta_data->>'role';
    user_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(COALESCE(NEW.email, ''), '@', 1));
    user_contact_number := NULLIF(COALESCE(NEW.phone, NEW.raw_user_meta_data->>'contact_number', ''), '');

    IF user_role = 'passenger' THEN
        INSERT INTO public.passenger (
            auth_user_id,
            full_name,
            contact_number,
            email,
            profile_photo_url,
            date_of_birth,
            residential_address,
            account_status
        ) VALUES (
            NEW.id,
            user_full_name,
            user_contact_number,
            NEW.email,
            NEW.raw_user_meta_data->>'profile_photo_url',
            NULLIF(NEW.raw_user_meta_data->>'date_of_birth', '')::DATE,
            NEW.raw_user_meta_data->>'residential_address',
            'Pending OTP Verification'
        ) ON CONFLICT (auth_user_id) DO NOTHING;

    ELSIF user_role = 'driver' THEN
        user_toda_id := NULLIF(NEW.raw_user_meta_data->>'toda_id', '')::UUID;
        INSERT INTO public.driver (
            auth_user_id,
            toda_id,
            full_name,
            contact_number,
            email,
            profile_photo_url,
            date_of_birth,
            residential_address,
            toda_membership_number,
            license_number,
            license_expiry,
            franchise_number,
            plate_number,
            assigned_terminal,
            barangay_service_area,
            account_status,
            availability_status
        ) VALUES (
            NEW.id,
            user_toda_id,
            user_full_name,
            user_contact_number,
            NEW.email,
            NEW.raw_user_meta_data->>'profile_photo_url',
            NULLIF(NEW.raw_user_meta_data->>'date_of_birth', '')::DATE,
            NEW.raw_user_meta_data->>'residential_address',
            NEW.raw_user_meta_data->>'toda_membership_number',
            NEW.raw_user_meta_data->>'license_number',
            NULLIF(NEW.raw_user_meta_data->>'license_expiry', '')::DATE,
            NEW.raw_user_meta_data->>'franchise_number',
            NEW.raw_user_meta_data->>'plate_number',
            NEW.raw_user_meta_data->>'assigned_terminal',
            NEW.raw_user_meta_data->>'barangay_service_area',
            'Pending Verification',
            'Offline'
        ) ON CONFLICT (auth_user_id) DO NOTHING;
    END IF;

    -- Any other value, or no role at all (a user created from the dashboard), creates nothing.
    -- The auth user itself is still created.
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 2. The TODA-administrator-from-metadata trigger is removed
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_on_auth_user_created_toda_admin ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_toda_admin_user();

-- ----------------------------------------------------------------------------
-- 3. Phone confirmation activates only the passenger whose number was confirmed
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_user_auth_update()
RETURNS TRIGGER AS $$
DECLARE
    v_confirmed TEXT;
BEGIN
    IF NEW.phone_confirmed_at IS NOT NULL AND OLD.phone_confirmed_at IS NULL AND NEW.phone IS NOT NULL THEN
        v_confirmed := right(regexp_replace(NEW.phone, '\D', '', 'g'), 10);
        IF length(v_confirmed) = 10 THEN
            -- This is the one place that may move a passenger from Pending to Active outside the server: the identity provider
            -- itself has just proven that the holder of THIS number controls it. Declare the policy-engine context for that
            -- single statement (S3 stops a passenger from making this change on their own row).
            PERFORM set_config('sakay.internal_context', 'true', true);
            UPDATE public.passenger
               SET account_status = 'Active'
             WHERE auth_user_id = NEW.id
               AND account_status = 'Pending OTP Verification'
               AND right(regexp_replace(COALESCE(contact_number, ''), '\D', '', 'g'), 10) = v_confirmed;
            PERFORM set_config('sakay.internal_context', '', true);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 4. Trigger functions are not part of any client-callable surface
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.handle_new_user_signup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_user_auth_update() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. SELF-CHECK: no trigger on auth.users may be able to write an administrator table
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
BEGIN
    -- Looks at the function text with its comments removed: any INSERT / UPDATE / MERGE / DELETE that targets an administrator table.
    FOR r IN
        SELECT t.tgname, p.proname,
               regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') AS def
          FROM pg_trigger t
          JOIN pg_proc p ON p.oid = t.tgfoid
         WHERE t.tgrelid = 'auth.users'::regclass AND NOT t.tgisinternal
    LOOP
        IF r.def ~* '(insert\s+into|update|merge\s+into|delete\s+from)\s+(public\.)?(lgu_admin|toda_admin)\M' THEN
            RAISE EXCEPTION 'trigger % on auth.users (function %) can still write an administrator table', r.tgname, r.proname;
        END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'handle_new_toda_admin_user') THEN
        RAISE EXCEPTION 'handle_new_toda_admin_user() must be gone';
    END IF;
END $$;
