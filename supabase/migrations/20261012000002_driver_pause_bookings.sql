-- ============================================================================
-- Migration: 20261012000002_driver_pause_bookings.sql
-- Checklist (Driver > Manage Availability): "Pause bookings temporarily" and "Resume bookings".
--
-- A driver who is Online can stop receiving NEW booking offers for a short while (a rest, a meal, a terminal passenger) without going
-- Offline. Offline is a different thing: it ends the online session and the driver must go through the Online checks again.
--
--   * driver.bookings_paused_until   NULL = receiving offers; a time in the future = paused until then. A pause ends by itself when
--                                    the time passes, so a forgotten pause cannot keep a driver out of dispatch.
--   * driver_pause_bookings(minutes) Online only; 5 to 60 minutes (default 15). The app keeps sending its location heartbeat.
--   * driver_resume_bookings()       ends the pause at once.
--   * Going Offline (or coming Online) always clears the pause.
--   * find_candidate_drivers()       does not return a paused driver (the one dispatcher that exists today; Batch 6 must keep this rule).
--   * trigger on dispatch_attempt    refuses an offer to a paused driver, whatever sent it (a race between the pause and the offer).
--   * A booking the driver already accepted is not affected.
--   * A paused driver is not "ignoring offers": no offer reaches them, so the inactivity counters (Rules 7.6 to 7.8) do not move.
--
-- Limits (5, 15, 60 minutes) are code constants next to the other presence constants and mirrored in policyConfig.ts.
-- Forward-only. Safe to run twice.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Column
-- ----------------------------------------------------------------------------
ALTER TABLE public.driver ADD COLUMN IF NOT EXISTS bookings_paused_until TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- 2. Constants (the existing function plus three keys; every earlier value is unchanged)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_presence_constant(p_key TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE p_key
        WHEN 'reminder_after_unanswered'     THEN 3     -- Rule 7.6
        WHEN 'auto_offline_after_unanswered' THEN 5     -- Rule 7.7 (3 + 2 more)
        WHEN 'review_window_days'            THEN 30    -- Rule 7.8
        WHEN 'review_auto_offline_count'     THEN 3     -- Rule 7.8
        WHEN 'offline_after_decline_seconds' THEN 60    -- Rule 29.7 ("immediately")
        WHEN 'offline_after_decline_count'   THEN 3     -- Rule 29.7
        WHEN 'heartbeat_stale_seconds'       THEN 300   -- presence sweep (approved extra, 5 min)
        WHEN 'location_max_accuracy_m'       THEN 100   -- F4.7: min accuracy to publish / dispatch
        WHEN 'location_max_age_seconds'      THEN 45    -- F4.6: max GPS age for dispatch
        WHEN 'pause_min_minutes'             THEN 5     -- checklist: pause bookings temporarily
        WHEN 'pause_default_minutes'         THEN 15
        WHEN 'pause_max_minutes'             THEN 60
        ELSE NULL
    END;
$$;

-- ----------------------------------------------------------------------------
-- 3. The state snapshot the app reads after every presence call now includes the pause
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._driver_presence_state(p_driver_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_driver public.driver;
    v_session public.driver_online_session;
    v_last public.driver_online_session;
    v_aff UUID;
BEGIN
    SELECT * INTO v_driver FROM public.driver WHERE driver_id = p_driver_id;
    IF v_driver.driver_id IS NULL THEN
        RETURN jsonb_build_object('online', FALSE);
    END IF;

    SELECT * INTO v_session FROM public.driver_online_session
    WHERE driver_id = p_driver_id AND ended_at IS NULL;

    SELECT * INTO v_last FROM public.driver_online_session
    WHERE driver_id = p_driver_id AND ended_at IS NOT NULL
    ORDER BY ended_at DESC LIMIT 1;

    SELECT affiliation_id INTO v_aff FROM public.driver_toda_affiliation
    WHERE driver_id = p_driver_id AND is_active_selection = TRUE LIMIT 1;

    RETURN jsonb_build_object(
        'online', v_driver.availability_status <> 'Offline',
        'availability_status', v_driver.availability_status,
        'active_toda_id', v_driver.toda_id,
        'active_affiliation_id', v_aff,
        'open_booking', public.driver_has_open_accepted_booking(p_driver_id),
        'bookings_paused_until', CASE WHEN v_driver.bookings_paused_until > CURRENT_TIMESTAMP THEN v_driver.bookings_paused_until END,
        'session', CASE WHEN v_session.session_id IS NULL THEN NULL ELSE jsonb_build_object(
            'session_id', v_session.session_id,
            'started_at', v_session.started_at,
            'last_heartbeat_at', v_session.last_heartbeat_at,
            'unanswered_streak', v_session.unanswered_streak,
            'reminder_sent_at', v_session.reminder_sent_at,
            'offline_pending_reason', v_session.offline_pending_reason) END,
        'last_session_end', CASE WHEN v_last.session_id IS NULL THEN NULL ELSE jsonb_build_object(
            'reason', v_last.end_reason, 'ended_at', v_last.ended_at) END,
        'server_time', CURRENT_TIMESTAMP
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 4. Pause and resume
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_pause_bookings(p_minutes INTEGER DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
    v_driver  public.driver;
    v_min     INTEGER := public.driver_presence_constant('pause_min_minutes');
    v_max     INTEGER := public.driver_presence_constant('pause_max_minutes');
    v_minutes INTEGER := COALESCE(p_minutes, public.driver_presence_constant('pause_default_minutes'));
    v_until   TIMESTAMPTZ;
BEGIN
    SELECT * INTO v_driver FROM public.driver WHERE auth_user_id = auth.uid() FOR UPDATE;
    IF v_driver.driver_id IS NULL THEN
        RETURN public._presence_fail('ERR_NOT_A_DRIVER', 'No driver account for this login.');
    END IF;
    IF v_driver.availability_status = 'Offline' THEN
        RETURN public._presence_fail('ERR_NOT_ONLINE',
            'Mag-Online muna bago i-pause ang mga booking. (Go Online before pausing bookings.)');
    END IF;
    IF v_minutes < v_min OR v_minutes > v_max THEN
        RETURN public._presence_fail('ERR_PAUSE_MINUTES',
            'Ang pahinga ay dapat ' || v_min || ' hanggang ' || v_max || ' minuto. (A pause must be ' || v_min || ' to ' || v_max || ' minutes.)');
    END IF;

    v_until := CURRENT_TIMESTAMP + make_interval(mins => v_minutes);
    UPDATE public.driver SET bookings_paused_until = v_until WHERE driver_id = v_driver.driver_id;

    PERFORM public.record_policy_audit(
        'DRIVER_BOOKINGS_PAUSED', v_driver.driver_id::TEXT, v_driver.full_name, 'Driver Presence',
        'Driver paused new bookings for ' || v_minutes || ' minutes.', NULL,
        jsonb_build_object('paused_until', v_until, 'minutes', v_minutes));

    RETURN jsonb_build_object('success', TRUE) || public._driver_presence_state(v_driver.driver_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.driver_resume_bookings()
RETURNS JSONB AS $$
DECLARE
    v_driver public.driver;
BEGIN
    SELECT * INTO v_driver FROM public.driver WHERE auth_user_id = auth.uid() FOR UPDATE;
    IF v_driver.driver_id IS NULL THEN
        RETURN public._presence_fail('ERR_NOT_A_DRIVER', 'No driver account for this login.');
    END IF;

    IF v_driver.bookings_paused_until IS NOT NULL THEN
        UPDATE public.driver SET bookings_paused_until = NULL WHERE driver_id = v_driver.driver_id;
        IF v_driver.bookings_paused_until > CURRENT_TIMESTAMP THEN
            PERFORM public.record_policy_audit(
                'DRIVER_BOOKINGS_RESUMED', v_driver.driver_id::TEXT, v_driver.full_name, 'Driver Presence',
                'Driver resumed receiving bookings.', jsonb_build_object('paused_until', v_driver.bookings_paused_until), NULL);
        END IF;
    END IF;

    RETURN jsonb_build_object('success', TRUE) || public._driver_presence_state(v_driver.driver_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.driver_pause_bookings(INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.driver_resume_bookings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_pause_bookings(INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_resume_bookings() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. A pause belongs to one online period: going Offline (or coming Online) clears it
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clear_driver_pause_on_presence_change()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.availability_status IS DISTINCT FROM OLD.availability_status
       AND (NEW.availability_status = 'Offline' OR OLD.availability_status = 'Offline') THEN
        NEW.bookings_paused_until := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trigger_clear_driver_pause_on_presence_change ON public.driver;
CREATE TRIGGER trigger_clear_driver_pause_on_presence_change
    BEFORE UPDATE OF availability_status ON public.driver
    FOR EACH ROW EXECUTE FUNCTION public.clear_driver_pause_on_presence_change();

-- ----------------------------------------------------------------------------
-- 6. Dispatch never offers a booking to a paused driver
-- ----------------------------------------------------------------------------
-- (a) the candidate list: the existing function with ONE added condition (same signature, so its privileges stay)
CREATE OR REPLACE FUNCTION public.find_candidate_drivers(p_booking_id UUID, p_max_km DOUBLE PRECISION DEFAULT 100, p_limit INTEGER DEFAULT 25)
RETURNS TABLE (driver_id UUID, toda_id UUID, distance_km DOUBLE PRECISION)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_b public.booking;
    v_me UUID := public.get_current_passenger_id();
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'ERR_NOT_A_PASSENGER: Only a registered passenger can look for a driver.' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_b FROM public.booking b WHERE b.booking_id = p_booking_id;
    IF NOT FOUND OR v_b.passenger_id IS DISTINCT FROM v_me THEN
        RAISE EXCEPTION 'ERR_NOT_YOUR_BOOKING: This booking does not belong to you.' USING ERRCODE = '42501';
    END IF;
    IF v_b.booking_status NOT IN ('Pending', 'Searching Driver') THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT d.driver_id,
           d.toda_id,
           round(x.dist::NUMERIC, 1)::DOUBLE PRECISION
      FROM public.driver d
     CROSS JOIN LATERAL (
            SELECT public.calculate_haversine_distance_km(
                       v_b.pickup_latitude, v_b.pickup_longitude, d.current_latitude, d.current_longitude) AS dist
     ) x
     WHERE d.availability_status = 'Available'
       AND d.account_status = 'Verified'
       AND (d.bookings_paused_until IS NULL OR d.bookings_paused_until <= CURRENT_TIMESTAMP)
       AND NOT EXISTS (SELECT 1 FROM public.dispatch_attempt a
                        WHERE a.booking_id = p_booking_id AND a.driver_id = d.driver_id)
       AND (x.dist IS NULL OR x.dist <= COALESCE(p_max_km, 100))
     ORDER BY x.dist NULLS LAST, d.driver_id
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50);
END;
$$;

-- (b) the safety net: an offer cannot be inserted for a paused driver (the dispatcher skips a failed offer and tries the next driver)
CREATE OR REPLACE FUNCTION public.block_offer_to_paused_driver()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.driver d
                WHERE d.driver_id = NEW.driver_id AND d.bookings_paused_until > CURRENT_TIMESTAMP) THEN
        RAISE EXCEPTION 'ERR_DRIVER_PAUSED: This driver has paused new bookings.' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_block_offer_to_paused_driver ON public.dispatch_attempt;
CREATE TRIGGER trigger_block_offer_to_paused_driver
    BEFORE INSERT ON public.dispatch_attempt
    FOR EACH ROW EXECUTE FUNCTION public.block_offer_to_paused_driver();

REVOKE ALL ON FUNCTION public.block_offer_to_paused_driver() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_driver_pause_on_presence_change() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. Self-check
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF public.driver_presence_constant('pause_min_minutes') <> 5
       OR public.driver_presence_constant('pause_default_minutes') <> 15
       OR public.driver_presence_constant('pause_max_minutes') <> 60
       OR public.driver_presence_constant('reminder_after_unanswered') <> 3
       OR public.driver_presence_constant('location_max_age_seconds') <> 45 THEN
        RAISE EXCEPTION 'driver_presence_constant: a value is wrong';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_block_offer_to_paused_driver')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_clear_driver_pause_on_presence_change') THEN
        RAISE EXCEPTION 'a pause trigger is missing';
    END IF;
END $$;
