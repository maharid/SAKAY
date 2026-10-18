-- ============================================================================
-- Migration: 20261028000002_passenger_session_in_database.sql
-- Rules 4.5 and 29.1: one active login session per passenger, enforced by the database for the one thing the rule exists to protect.
--
-- The rule says a second login ends the first, "to prevent duplicate booking activity". For passengers the app tried to do it alone: at login it
-- wrote a token to passenger.session_id and on each screen change it compared that with the token kept on the phone. But NO migration ever created
-- the column passenger.session_id (only drivers have one), so the write failed unnoticed, the comparison read nothing, and a second login ended
-- nothing: Rule 4.5 was not enforced for passengers at all. And even where the column exists, a phone that is not running that check (an older
-- build, a script, a stale tab that never navigates) keeps a perfectly valid login and can create a booking. Drivers were already enforced in the
-- database (ERR_SESSION_SUPERSEDED on going Online / heartbeat).
--
-- What this adds:
--   * passenger.auth_session_id   the id of the Supabase auth session (the `session_id` claim of the login token) that is the passenger's
--                                 CURRENT one. Only register_passenger_session() can set it.
--   * register_passenger_session()   called by the app right after every login: it records this login as the current one, rotates the
--                                    app's session token (what the app used to write directly) and returns the token.
--   * booking_passenger_session_guard()   BEFORE INSERT ON booking: a booking made with a login that is no longer the current one is refused
--                                    (ERR_SESSION_SUPERSEDED). The stale phone's other screens are signed out by the app's own check, as before.
--
-- Deliberately lenient where the database cannot know: a login token without a session_id claim, a passenger who has not registered a session
-- yet, and trusted server code are not refused. So an older app that does not call register_passenger_session() keeps working exactly as
-- before; once the new app has registered, every older session of that passenger is refused at booking.
--
-- Forward-only. Safe to run twice.
-- ============================================================================

ALTER TABLE public.passenger
    ADD COLUMN IF NOT EXISTS session_id UUID,
    ADD COLUMN IF NOT EXISTS auth_session_id UUID;

COMMENT ON COLUMN public.passenger.session_id IS 'Rules 4.5 / 29.1: the token the Passenger app keeps on the phone of the current login; rotated by register_passenger_session() at every login.';

COMMENT ON COLUMN public.passenger.auth_session_id IS 'Rules 4.5 / 29.1: the Supabase auth session (the session_id claim of the login token) that is this passenger''s current login. Set only by register_passenger_session(); a booking from any other session is refused.';

-- The auth session of the current request: the `session_id` claim of the login token, or NULL when there is none (or it is not a UUID).
CREATE OR REPLACE FUNCTION public._request_auth_session_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_claim TEXT;
BEGIN
    BEGIN
        v_claim := auth.jwt() ->> 'session_id';
    EXCEPTION WHEN OTHERS THEN
        RETURN NULL;
    END;
    IF v_claim ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN v_claim::UUID;
    END IF;
    RETURN NULL;
END;
$$;

-- Only the function below (a trusted write) may change the column.
CREATE OR REPLACE FUNCTION public.passenger_auth_session_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.auth_session_id IS DISTINCT FROM OLD.auth_session_id AND NOT COALESCE(public.is_trusted_session(), FALSE) THEN
        RAISE EXCEPTION 'ERR_SESSION_LOCKED: The login session of an account is recorded by the system at login.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_passenger_auth_session_guard ON public.passenger;
CREATE TRIGGER trigger_passenger_auth_session_guard BEFORE UPDATE OF auth_session_id ON public.passenger
    FOR EACH ROW EXECUTE FUNCTION public.passenger_auth_session_guard();

-- Called by the Passenger app right after every login (the password login and the one that follows the OTP).
CREATE OR REPLACE FUNCTION public.register_passenger_session()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_passenger UUID := public.get_current_passenger_id();
    v_token UUID := gen_random_uuid();
    v_auth UUID := public._request_auth_session_id();
    v_prev TEXT := current_setting('sakay.internal_context', true);
BEGIN
    IF v_passenger IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_A_PASSENGER', 'error', 'Only a passenger has a passenger session.');
    END IF;
    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.passenger SET session_id = v_token, auth_session_id = v_auth WHERE passenger_id = v_passenger;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'session_token', v_token, 'enforced', v_auth IS NOT NULL);
END;
$$;

-- A booking from a login that is no longer the current one is refused.
CREATE OR REPLACE FUNCTION public.booking_passenger_session_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_claim UUID;
    v_current UUID;
BEGIN
    IF COALESCE(public.is_trusted_session(), FALSE) OR NEW.passenger_id IS NULL THEN
        RETURN NEW;
    END IF;
    v_claim := public._request_auth_session_id();
    IF v_claim IS NULL THEN
        RETURN NEW;                       -- a token without a session claim: the database cannot tell, so it does not refuse
    END IF;
    SELECT p.auth_session_id INTO v_current FROM public.passenger p WHERE p.passenger_id = NEW.passenger_id;
    IF v_current IS NOT NULL AND v_current <> v_claim THEN
        RAISE EXCEPTION 'ERR_SESSION_SUPERSEDED: Nag-login ang iyong account sa ibang device. Mag-login muli bago mag-book. (Your account signed in on another device. Please log in again before booking.)'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_booking_a_passenger_session ON public.booking;
CREATE TRIGGER trigger_booking_a_passenger_session BEFORE INSERT ON public.booking
    FOR EACH ROW EXECUTE FUNCTION public.booking_passenger_session_guard();

-- Privileges (functions created from now on get none by default)
REVOKE EXECUTE ON FUNCTION public._request_auth_session_id() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.passenger_auth_session_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.booking_passenger_session_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.register_passenger_session() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_passenger_session() TO authenticated, service_role;
