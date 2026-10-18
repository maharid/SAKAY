-- ============================================================================
-- Migration: 20261028000003_password_recovery.sql
-- Rule 4.2: a second registration with a number that is already taken "is blocked and the user is directed to password recovery instead".
-- There was no password recovery: both apps showed a "temporarily unavailable" page (the first version texted a code to any number and then
-- accepted any code, so it was switched off). This is the database half of the real one. The server (POST /api/password-reset/request and
-- /confirm) texts a code to the number of an EXISTING account, checks it, and only then sets the new password.
--
-- It follows the OTP rules that already exist for registration:
--   Rule 4.6   a code is valid for five (5) minutes, then a new one must be requested
--   Rule 4.7   five (5) consecutive wrong codes lock requests AND entries for fifteen (15) minutes
--   F2.4       at least 30 seconds between two codes, at most 5 codes per number per day
-- but, unlike the registration code (which lives in the memory of a web server that sleeps and restarts), the code, the counters and the lock are
-- kept HERE, so a restart cannot hand an attacker a fresh set of tries, and nothing is lost between asking for the code and typing it.
--
-- What this adds (everything is for the SERVER only: the service role; nobody signed in or anonymous can read or call any of it):
--   * password_reset_challenge            one row per (app, mobile number): the hash of the code, its expiry, the wrong-entry count, the send counters
--   * reserve_password_reset_code()       checks lock / cooldown / daily cap and, if allowed, counts the send and stores the code's hash (atomic)
--   * release_password_reset_code()       undoes that when the SMS could not be sent (the person did nothing wrong)
--   * verify_password_reset_code()        checks the typed code: expiry, five tries, the lock; a right code is used up
--   * find_recovery_account()             the one account of an app that has this number (passenger or driver), or nothing
--   * finish_password_reset()             after the password changed: every older login of that account stops working (Rules 4.5 / 29.1), and the
--                                         reset is written to the audit log (no number, no code in it)
--
-- Only the HASH of a code is stored, never the code. The throttle applies to any well-formed number, registered or not, so the server's answers
-- do not say which numbers have an account.
--
-- Forward-only. Safe to run twice.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.password_reset_challenge (
    account_role    TEXT        NOT NULL CHECK (account_role IN ('passenger', 'driver')),
    subscriber      TEXT        NOT NULL CHECK (subscriber ~ '^9[0-9]{9}$'),
    code_hash       TEXT,
    code_expires_at TIMESTAMPTZ,
    failed_count    INT         NOT NULL DEFAULT 0,
    last_failed_at  TIMESTAMPTZ,
    last_sent_at    TIMESTAMPTZ,
    sent_day        DATE,
    sent_count      INT         NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (account_role, subscriber)
);

COMMENT ON TABLE public.password_reset_challenge IS 'Rules 4.2 / 4.6 / 4.7: the pending password-recovery code of a mobile number (hash only), its expiry, the wrong-entry lock and the send counters. Server (service role) only.';

CREATE INDEX IF NOT EXISTS idx_password_reset_challenge_touched
    ON public.password_reset_challenge ((COALESCE(last_sent_at, created_at)));

ALTER TABLE public.password_reset_challenge ENABLE ROW LEVEL SECURITY;           -- and no policy: only the service role (which bypasses row security) reads it
REVOKE ALL ON TABLE public.password_reset_challenge FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.password_reset_challenge TO service_role;

-- The subscriber part of a Philippine mobile number (the last ten digits, 9XXXXXXXXX), or NULL when the text is not one.
CREATE OR REPLACE FUNCTION public._recovery_subscriber(p_phone TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE
        WHEN length(regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g')) >= 10
         AND right(regexp_replace(p_phone, '[^0-9]', '', 'g'), 10) ~ '^9[0-9]{9}$'
        THEN right(regexp_replace(p_phone, '[^0-9]', '', 'g'), 10)
        ELSE NULL
    END;
$$;

-- Ask for a code. Atomic: the checks and the count happen under one row lock, so two requests at the same moment cannot both pass.
--   p_code_hash  the hash of the code about to be texted; NULL when no code will be sent (the number has no account), so that the throttle
--                still applies in the same way and the answer does not tell the two apart.
CREATE OR REPLACE FUNCTION public.reserve_password_reset_code(p_role TEXT, p_phone TEXT, p_code_hash TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_sub   TEXT := public._recovery_subscriber(p_phone);
    v_today DATE := (now() AT TIME ZONE 'UTC')::date;
    r       public.password_reset_challenge%ROWTYPE;
BEGIN
    IF p_role NOT IN ('passenger', 'driver') OR v_sub IS NULL THEN
        RETURN jsonb_build_object('allowed', FALSE, 'reason', 'invalid');
    END IF;

    -- old, idle rows (numbers nobody came back for) are cleared as we go; nothing here is worth keeping
    DELETE FROM public.password_reset_challenge
     WHERE COALESCE(last_sent_at, created_at) < now() - INTERVAL '2 days'
       AND NOT (account_role = p_role AND subscriber = v_sub);

    INSERT INTO public.password_reset_challenge (account_role, subscriber) VALUES (p_role, v_sub) ON CONFLICT DO NOTHING;
    SELECT * INTO r FROM public.password_reset_challenge WHERE account_role = p_role AND subscriber = v_sub FOR UPDATE;

    -- Rule 4.7: five wrong codes lock the number for fifteen minutes
    IF r.failed_count >= 5 AND r.last_failed_at IS NOT NULL AND r.last_failed_at > now() - INTERVAL '15 minutes' THEN
        RETURN jsonb_build_object('allowed', FALSE, 'reason', 'locked',
            'minutes_remaining', ROUND(EXTRACT(EPOCH FROM (r.last_failed_at + INTERVAL '15 minutes' - now())) / 60, 1));
    END IF;
    -- F2.4: 30 seconds between two codes
    IF r.last_sent_at IS NOT NULL AND r.last_sent_at > now() - INTERVAL '30 seconds' THEN
        RETURN jsonb_build_object('allowed', FALSE, 'reason', 'cooldown',
            'wait_seconds', CEIL(EXTRACT(EPOCH FROM (r.last_sent_at + INTERVAL '30 seconds' - now()))));
    END IF;
    -- F2.4: five codes a day
    IF r.sent_day = v_today AND r.sent_count >= 5 THEN
        RETURN jsonb_build_object('allowed', FALSE, 'reason', 'daily');
    END IF;

    UPDATE public.password_reset_challenge
       SET last_sent_at    = now(),
           sent_day        = v_today,
           sent_count      = CASE WHEN sent_day = v_today THEN sent_count + 1 ELSE 1 END,
           code_hash       = CASE WHEN p_code_hash IS NULL THEN code_hash       ELSE p_code_hash END,
           code_expires_at = CASE WHEN p_code_hash IS NULL THEN code_expires_at ELSE now() + INTERVAL '5 minutes' END,   -- Rule 4.6
           failed_count    = CASE WHEN p_code_hash IS NULL THEN failed_count    ELSE 0 END,                               -- a new code starts with a clean count
           last_failed_at  = CASE WHEN p_code_hash IS NULL THEN last_failed_at  ELSE NULL END
     WHERE account_role = p_role AND subscriber = v_sub;

    RETURN jsonb_build_object('allowed', TRUE);
END;
$$;

-- The SMS could not be sent: give the person back the send and forget the code that never reached them.
CREATE OR REPLACE FUNCTION public.release_password_reset_code(p_role TEXT, p_phone TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_sub TEXT := public._recovery_subscriber(p_phone);
BEGIN
    IF p_role NOT IN ('passenger', 'driver') OR v_sub IS NULL THEN RETURN; END IF;
    UPDATE public.password_reset_challenge
       SET last_sent_at    = NULL,
           sent_count      = GREATEST(sent_count - 1, 0),
           code_hash       = NULL,
           code_expires_at = NULL
     WHERE account_role = p_role AND subscriber = v_sub;
END;
$$;

-- Check a typed code. { ok, reason, minutes_remaining?, attempts_left? }
--   reason  locked | not_found | expired | wrong
-- A right code is used up (it works once). Only a WRONG code counts towards the lock: "no code" and "expired" are not guesses.
CREATE OR REPLACE FUNCTION public.verify_password_reset_code(p_role TEXT, p_phone TEXT, p_code_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_sub   TEXT := public._recovery_subscriber(p_phone);
    r       public.password_reset_challenge%ROWTYPE;
    v_count INT;
BEGIN
    IF p_role NOT IN ('passenger', 'driver') OR v_sub IS NULL OR p_code_hash IS NULL THEN
        RETURN jsonb_build_object('ok', FALSE, 'reason', 'not_found');
    END IF;
    SELECT * INTO r FROM public.password_reset_challenge WHERE account_role = p_role AND subscriber = v_sub FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', FALSE, 'reason', 'not_found');
    END IF;

    IF r.failed_count >= 5 AND r.last_failed_at IS NOT NULL AND r.last_failed_at > now() - INTERVAL '15 minutes' THEN
        RETURN jsonb_build_object('ok', FALSE, 'reason', 'locked',
            'minutes_remaining', ROUND(EXTRACT(EPOCH FROM (r.last_failed_at + INTERVAL '15 minutes' - now())) / 60, 1));
    END IF;
    IF r.code_hash IS NULL THEN
        RETURN jsonb_build_object('ok', FALSE, 'reason', 'not_found');
    END IF;
    IF r.code_expires_at IS NULL OR r.code_expires_at < now() THEN
        UPDATE public.password_reset_challenge SET code_hash = NULL, code_expires_at = NULL WHERE account_role = p_role AND subscriber = v_sub;
        RETURN jsonb_build_object('ok', FALSE, 'reason', 'expired');
    END IF;

    IF r.code_hash = p_code_hash THEN
        UPDATE public.password_reset_challenge
           SET code_hash = NULL, code_expires_at = NULL, failed_count = 0, last_failed_at = NULL
         WHERE account_role = p_role AND subscriber = v_sub;
        RETURN jsonb_build_object('ok', TRUE);
    END IF;

    -- a wrong code. A failure more than 15 minutes after the previous one starts a new count (as for the registration code).
    v_count := CASE WHEN r.last_failed_at IS NULL OR r.last_failed_at < now() - INTERVAL '15 minutes' THEN 1 ELSE r.failed_count + 1 END;
    IF v_count >= 5 THEN
        UPDATE public.password_reset_challenge
           SET failed_count = v_count, last_failed_at = now(), code_hash = NULL, code_expires_at = NULL      -- the fifth wrong code throws the code away too
         WHERE account_role = p_role AND subscriber = v_sub;
        RETURN jsonb_build_object('ok', FALSE, 'reason', 'locked', 'minutes_remaining', 15);
    END IF;
    UPDATE public.password_reset_challenge SET failed_count = v_count, last_failed_at = now() WHERE account_role = p_role AND subscriber = v_sub;
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'wrong', 'attempts_left', 5 - v_count);
END;
$$;

-- The one account of this app that has this number: { found, account_id, auth_user_id, account_status }. Nothing when there is none, or when
-- (which the unique constraints should make impossible) there are several: a password is never set on a guess.
CREATE OR REPLACE FUNCTION public.find_recovery_account(p_role TEXT, p_phone TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_sub  TEXT := public._recovery_subscriber(p_phone);
    v_n    INT;
    v_id   UUID;
    v_auth UUID;
    v_stat TEXT;
BEGIN
    IF v_sub IS NULL THEN RETURN jsonb_build_object('found', FALSE); END IF;
    IF p_role = 'passenger' THEN
        SELECT count(*), min(passenger_id::text)::uuid, min(auth_user_id::text)::uuid, min(account_status)
          INTO v_n, v_id, v_auth, v_stat
          FROM public.passenger
         WHERE contact_number IN ('+63' || v_sub, '0' || v_sub, '63' || v_sub, v_sub) AND auth_user_id IS NOT NULL;
    ELSIF p_role = 'driver' THEN
        SELECT count(*), min(driver_id::text)::uuid, min(auth_user_id::text)::uuid, min(account_status)
          INTO v_n, v_id, v_auth, v_stat
          FROM public.driver
         WHERE contact_number IN ('+63' || v_sub, '0' || v_sub, '63' || v_sub, v_sub) AND auth_user_id IS NOT NULL;
    ELSE
        RETURN jsonb_build_object('found', FALSE);
    END IF;
    IF v_n <> 1 THEN RETURN jsonb_build_object('found', FALSE); END IF;
    RETURN jsonb_build_object('found', TRUE, 'account_id', v_id, 'auth_user_id', v_auth, 'account_status', v_stat);
END;
$$;

-- After the password was changed: the audit entry, and every login of the account made before now stops working for what the rules protect.
--   * the app-level session (Rules 4.5 / 29.1) is replaced, so an older phone is signed out by its own check and its bookings / going Online are
--     refused by the database (ERR_SESSION_SUPERSEDED);
--   * the Supabase auth sessions of the login are deleted, so the older phone cannot even refresh its token. That part is best effort: if this
--     database does not let the function reach the auth schema, the password change still stands and the answer says so.
CREATE OR REPLACE FUNCTION public.finish_password_reset(p_role TEXT, p_account_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_prev    TEXT := current_setting('sakay.internal_context', true);
    v_auth    UUID;
    v_deleted INT := NULL;
BEGIN
    PERFORM set_config('sakay.internal_context', 'true', true);
    IF p_role = 'passenger' THEN
        UPDATE public.passenger SET session_id = gen_random_uuid(), auth_session_id = gen_random_uuid()
         WHERE passenger_id = p_account_id RETURNING auth_user_id INTO v_auth;
    ELSIF p_role = 'driver' THEN
        UPDATE public.driver SET session_id = gen_random_uuid()
         WHERE driver_id = p_account_id RETURNING auth_user_id INTO v_auth;
    END IF;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);

    IF v_auth IS NOT NULL THEN
        -- the one audit writer (stamps the actor: here the system, the server acting for a person who proved the number with the code)
        PERFORM public.record_policy_audit('ACCOUNT_PASSWORD_RESET', p_account_id::TEXT, public._subject_name(p_role, p_account_id), 'User Oversight',
            format('A %s account''s password was reset with a code sent to its mobile number; its earlier logins were ended.', p_role));
    END IF;

    IF v_auth IS NOT NULL AND to_regclass('auth.sessions') IS NOT NULL THEN
        BEGIN
            EXECUTE 'DELETE FROM auth.sessions WHERE user_id = $1' USING v_auth;
            GET DIAGNOSTICS v_deleted = ROW_COUNT;
        EXCEPTION WHEN OTHERS THEN
            v_deleted := NULL;
        END;
    END IF;
    RETURN jsonb_build_object('app_session_replaced', v_auth IS NOT NULL, 'auth_sessions_deleted', v_deleted);
END;
$$;

-- Privileges: functions created from now on get none by default; these are for the server (service role) only.
REVOKE EXECUTE ON FUNCTION public._recovery_subscriber(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_password_reset_code(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_password_reset_code(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_password_reset_code(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.find_recovery_account(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finish_password_reset(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._recovery_subscriber(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_password_reset_code(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_password_reset_code(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_password_reset_code(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.find_recovery_account(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_password_reset(TEXT, UUID) TO service_role;
