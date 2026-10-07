-- ============================================================================
-- Migration: 20261015000005_batch6_booking_timers.sql
-- Batch 6, part 5 of 5: the clocks that keep an ACCEPTED booking honest (Rules 8, 9 and 10).
--
-- Until now, once a driver accepted, nothing watched him. A driver who never started, or whose phone died, left the passenger waiting for
-- ever; a passenger who never came left the driver waiting for ever (the apps kept their own countdowns and the database kept none). The
-- database now owns these clocks and the sweep (every 5 seconds, see part 4) runs them:
--
--   Rule 8.2 / 8.3  no movement toward the pickup: a warning at 2 minutes, then cancelled on the driver's behalf at 3 minutes: 1 strike
--                   (DRV_STALL), the driver is excluded from that booking, the booking is offered to the next driver at once
--   Rule 8.4        the same after 5 continuous minutes standing still on the way, unless the driver reported traffic / a road closure
--   Rule 8.5        the approach phase only: once the driver has arrived (or is already at the pickup) the stall rule does not apply
--   Rule 9.2        no location for 3 minutes: Driver Unreachable, the passenger is told
--   Rule 9.3        no location for 5 minutes before the driver arrived: cancelled, a provisional strike (DRV_CONNECTIVITY_FAILURE, which
--                   the driver may have waived within 48 hours), the booking goes to the next driver
--   Rule 9.5        silence during a trip: the trip is NEVER cancelled; it is marked Connectivity Interrupted and, after 30 minutes, goes
--                   to the TODA administrator for manual reconciliation
--   Rule 10.1-10.4  the no-show wait runs from the moment the driver arrived (server time); the passenger may add 2 minutes once; the
--                   driver can report a no-show only when the time is up AND he is at the pickup: the booking is cancelled, the passenger
--                   gets 2 strikes, the driver is first in line (on an exact tie) for his next offer
--   Rule 12.6       none of the system cancellations above ever strikes the passenger
--
-- Forward-only. Safe to run twice.
-- ============================================================================

-- The timers look at bookings with a driver committed and the trip not yet at its destination, so index exactly those.
CREATE INDEX IF NOT EXISTS idx_booking_open_accepted
    ON public.booking (booking_id)
    WHERE driver_id IS NOT NULL
      AND booking_status IN ('Accepted', 'Assigned', 'Driver Assigned', 'Driver En Route', 'Heading to Passenger', 'In Transit',
                             'Driver Arrived', 'Arrived at Pickup', 'Trip Ongoing', 'Ongoing');

-- ----------------------------------------------------------------------------
-- 1. IS THE DRIVER AT THE PICKUP? (one answer for 8.5, 10.1 and the Passenger No-Show button; decision PI-06 = A)
-- ----------------------------------------------------------------------------
-- A fix counts only if it is fresh and its reported accuracy is good enough (zone_max_accuracy_m); the driver is "at the pickup" when the
-- circle of the fix's accuracy reaches the zone (distance minus accuracy <= no_show_radius_m). A bad fix is ignored, not guessed at.
CREATE OR REPLACE FUNCTION public._driver_within_pickup_zone(p_driver_id UUID, p_booking_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT COALESCE((
        SELECT d.current_latitude IS NOT NULL AND d.current_longitude IS NOT NULL
           AND d.last_location_update >= clock_timestamp() - make_interval(secs => public.driver_presence_constant('location_max_age_seconds'))
           AND d.last_location_accuracy_m IS NOT NULL
           AND d.last_location_accuracy_m <= public.dispatch_constant('zone_max_accuracy_m')
           AND GREATEST(0, public.calculate_haversine_distance_km(d.current_latitude, d.current_longitude, b.pickup_latitude, b.pickup_longitude) * 1000.0
                           - d.last_location_accuracy_m) <= public.dispatch_constant('no_show_radius_m')
          FROM public.driver d, public.booking b
         WHERE d.driver_id = p_driver_id AND b.booking_id = p_booking_id
    ), FALSE);
$$;

-- ----------------------------------------------------------------------------
-- 2. A SYSTEM CANCELLATION ON THE DRIVER'S BEHALF (Rules 8.3, 8.4, 9.3)
-- ----------------------------------------------------------------------------
-- One path for all of them: the driver's strike (idempotent per assignment), a note to the driver, the audit row, and the booking goes back
-- to the SAME search with this driver excluded (Rule 12.8's three-in-a-row limit applies to these too). The passenger is never struck (12.6).
CREATE OR REPLACE FUNCTION public._booking_timer_cancel(
    p_booking_id UUID, p_driver_id UUID, p_code TEXT, p_rule TEXT, p_reason TEXT, p_driver_notice TEXT, p_passenger_notice TEXT
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_b public.booking;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_result TEXT;
BEGIN
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_b.driver_id IS DISTINCT FROM p_driver_id OR public._booking_phase(v_b.booking_status) <> 'assigned' THEN
        RETURN 'not_applicable';
    END IF;
    PERFORM set_config('sakay.internal_context', 'true', true);

    PERFORM public.issue_strike('driver', p_driver_id, p_code, NULL, p_booking_id, NULL,
        p_code || ':' || p_booking_id::TEXT || ':' || v_b.dispatch_cycle || ':' || (v_b.accepted_driver_cancel_count + 1),
        NULL, p_reason, NULL,
        jsonb_build_object('rule', p_rule, 'booking_id', p_booking_id, 'system_cancelled', TRUE));
    PERFORM public._notify_subject('driver', p_driver_id, 'BOOKING_AUTO_CANCELLED', 'Nakansela ang booking (Booking cancelled)', p_driver_notice,
        p_booking_id::TEXT, v_b.dispatch_cycle * 100 + v_b.accepted_driver_cancel_count);
    PERFORM public.record_policy_audit('BOOKING_SYSTEM_CANCELLED', p_booking_id::TEXT, NULL, 'Dispatch', p_reason, NULL,
        jsonb_build_object('rule', p_rule, 'violation_code', p_code, 'driver_id', p_driver_id, 'cycle', v_b.dispatch_cycle));

    v_result := public._dispatch_redispatch(p_booking_id, p_driver_id, 'system', p_reason, p_passenger_notice);
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN v_result;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. THE SWEEP FOR ACCEPTED BOOKINGS (Rules 8.2-8.5, 9.2, 9.3, 9.5)
-- ----------------------------------------------------------------------------
-- Idempotent: every action is guarded by the state it creates (a flag set once, a booking that has left the phase), so it can run twice,
-- late, or from two places. A booking another transaction holds is skipped this time and picked up the next. Called by dispatch_sweep().
CREATE OR REPLACE FUNCTION public.booking_timers_sweep()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    r RECORD;
    v_b public.booking;
    v_d public.driver;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_now TIMESTAMPTZ := clock_timestamp();
    v_phase TEXT;
    v_heard TIMESTAMPTZ;
    v_silent DOUBLE PRECISION;
    v_fresh BOOLEAN;
    v_moved DOUBLE PRECISION;
    v_idle DOUBLE PRECISION;
    v_never BOOLEAN;
    v_n INTEGER := 0;
    v_tag INTEGER;
BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtextextended('sakay.booking_timers', 0)) THEN
        RETURN 0;
    END IF;
    PERFORM set_config('sakay.internal_context', 'true', true);

    FOR r IN
        SELECT b.booking_id
          FROM public.booking b
         -- the literal list of the statuses with a driver committed and the trip not yet at its destination (assigned, arrived, ongoing), the
         -- same list as idx_booking_open_accepted: only a literal lets the database use that partial index instead of reading every trip ever made
         WHERE b.driver_id IS NOT NULL
           AND b.booking_status IN ('Accepted', 'Assigned', 'Driver Assigned', 'Driver En Route', 'Heading to Passenger', 'In Transit',
                                    'Driver Arrived', 'Arrived at Pickup', 'Trip Ongoing', 'Ongoing')
    LOOP
        BEGIN
            SELECT * INTO v_b FROM public.booking WHERE booking_id = r.booking_id FOR UPDATE SKIP LOCKED;
            CONTINUE WHEN NOT FOUND OR v_b.driver_id IS NULL;
            v_phase := public._booking_phase(v_b.booking_status);
            CONTINUE WHEN v_phase NOT IN ('assigned', 'arrived', 'ongoing');
            SELECT * INTO v_d FROM public.driver WHERE driver_id = v_b.driver_id;
            CONTINUE WHEN NOT FOUND;
            v_tag := v_b.dispatch_cycle * 100 + v_b.accepted_driver_cancel_count;

            -- ---- Rule 9: has the driver been heard from? (a location update is the only thing that counts)
            v_heard := GREATEST(COALESCE(v_d.last_location_update, '-infinity'::TIMESTAMPTZ), COALESCE(v_b.accepted_at, v_now));
            v_silent := EXTRACT(EPOCH FROM (v_now - v_heard));

            IF v_silent >= public.dispatch_constant('unreachable_warn_seconds') THEN
                IF v_b.driver_unreachable_since IS NULL THEN                                   -- Rule 9.2 / 9.5: marked once, the passenger is told
                    UPDATE public.booking SET driver_unreachable_since = v_now WHERE booking_id = v_b.booking_id RETURNING * INTO v_b;
                    PERFORM public._dispatch_notify_passenger(v_b, 'DRIVER_UNREACHABLE',
                        'Walang signal ang iyong drayber (Driver connection lost)',
                        'Your driver appears to be experiencing a connectivity issue. We''ll keep trying to reach them. '
                        || '(Mukhang may problema sa koneksyon ang iyong drayber. Patuloy kaming susubok na makontak siya.)');
                    v_n := v_n + 1;
                END IF;

                IF v_phase = 'assigned' AND v_silent >= public.dispatch_constant('unreachable_cancel_seconds') THEN
                    PERFORM public._booking_timer_cancel(v_b.booking_id, v_b.driver_id, 'DRV_CONNECTIVITY_FAILURE', 'Rule 9.3',
                        'No location update from the driver for ' || public.dispatch_constant('unreachable_cancel_seconds') / 60 || ' minutes before arriving at the pickup.',
                        'We could not reach you for 5 minutes, so this booking was cancelled and given to another driver. A provisional strike was recorded; '
                        || 'if the cause was outside your control (dead battery, no signal, a damaged phone), you may ask your TODA administrator to waive it within 48 hours.',
                        'We lost contact with your driver, so we are finding you another driver. '
                        || '(Nawalan kami ng kontak sa iyong drayber, kaya naghahanap kami ng ibang drayber.)');
                    v_n := v_n + 1;
                ELSIF v_phase = 'ongoing'
                      AND v_now - v_b.driver_unreachable_since >= make_interval(secs => public.dispatch_constant('ongoing_reconcile_seconds')) THEN
                    -- Rule 9.5: a boarded passenger is never stranded: the trip stays open and the TODA administrator reconciles it by phone.
                    PERFORM public._presence_flag('TRIP_MANUAL_RECONCILIATION', v_b.driver_id, 'Rule 9.5',
                        jsonb_build_object('booking_id', v_b.booking_id, 'connectivity_interrupted_since', v_b.driver_unreachable_since,
                            'last_known_latitude', v_d.current_latitude, 'last_known_longitude', v_d.current_longitude,
                            'note', 'The driver has been unreachable for 30 minutes during a trip. Contact both parties and confirm the outcome and fare before closing the record.'));
                END IF;
                CONTINUE;                                   -- an unreachable driver is not judged on movement
            ELSIF v_b.driver_unreachable_since IS NOT NULL THEN
                UPDATE public.booking SET driver_unreachable_since = NULL WHERE booking_id = v_b.booking_id RETURNING * INTO v_b;   -- he is back
            END IF;

            -- ---- Rule 8: movement toward the pickup (the approach phase only: Rule 8.5)
            CONTINUE WHEN v_phase <> 'assigned';
            v_fresh := v_d.current_latitude IS NOT NULL AND v_d.current_longitude IS NOT NULL
                       AND v_d.last_location_update >= v_now - make_interval(secs => public.driver_presence_constant('location_max_age_seconds'));
            CONTINUE WHEN NOT v_fresh;                      -- no usable fix right now: neither the warning nor the cancellation is based on a guess
            CONTINUE WHEN public._driver_within_pickup_zone(v_b.driver_id, v_b.booking_id);    -- already there: he only has to tap Arrived

            IF v_b.stall_anchor_at IS NULL THEN
                -- A booking accepted before this clock existed (a trip in flight when the migration was deployed): the driver is judged from
                -- NOW, not from an acceptance long ago, so a deploy can never cancel and strike anybody. The five-minute rule (8.4) applies
                -- from this moment; the 2 / 3 minute rule (8.2 / 8.3) is only for a booking whose acceptance this clock saw.
                UPDATE public.booking
                   SET stall_anchor_latitude = v_d.current_latitude, stall_anchor_longitude = v_d.current_longitude, stall_anchor_at = v_now
                 WHERE booking_id = v_b.booking_id RETURNING * INTO v_b;
            END IF;

            -- Movement = how far the driver is from where he last moved, less the fix's own error (GPS noise is not a journey).
            v_moved := GREATEST(0, public.calculate_haversine_distance_km(v_b.stall_anchor_latitude, v_b.stall_anchor_longitude,
                                                                        v_d.current_latitude, v_d.current_longitude) * 1000.0
                                   - COALESCE(v_d.last_location_accuracy_m, 0));
            IF v_moved >= public.dispatch_constant('stall_min_movement_m') THEN
                UPDATE public.booking
                   SET stall_anchor_latitude = v_d.current_latitude, stall_anchor_longitude = v_d.current_longitude, stall_anchor_at = v_now,
                       stall_warned_at = NULL
                 WHERE booking_id = v_b.booking_id;
                CONTINUE;
            END IF;

            v_never := v_b.stall_anchor_at <= COALESCE(v_b.accepted_at, v_b.stall_anchor_at);        -- he has not moved at all since accepting
            IF v_never THEN
                v_idle := EXTRACT(EPOCH FROM (v_now - v_b.stall_anchor_at));
                IF v_idle >= public.dispatch_constant('stall_cancel_seconds') THEN                  -- Rule 8.3
                    PERFORM public._booking_timer_cancel(v_b.booking_id, v_b.driver_id, 'DRV_STALL', 'Rule 8.3',
                        'The driver did not start traveling toward the passenger within ' || public.dispatch_constant('stall_cancel_seconds') / 60 || ' minutes of accepting.',
                        'You did not start traveling toward the passenger, so the booking was cancelled and given to another driver. One strike was recorded. '
                        || 'If a road obstruction, a breakdown or a GPS fault stopped you, you may appeal through the Exemption & Appeal process.',
                        'Your driver was unable to proceed. We''re finding you another driver. '
                        || '(Hindi nakapagpatuloy ang iyong drayber. Naghahanap kami ng ibang drayber.)');
                    v_n := v_n + 1;
                ELSIF v_idle >= public.dispatch_constant('stall_warn_seconds') AND v_b.stall_warned_at IS NULL THEN   -- Rule 8.2
                    UPDATE public.booking SET stall_warned_at = v_now WHERE booking_id = v_b.booking_id;
                    PERFORM public._notify_subject('driver', v_b.driver_id, 'STALL_WARNING', 'Hindi ka pa gumagalaw (You have not started)',
                        'You have not started traveling toward the passenger. Please proceed or cancel the booking. '
                        || '(Hindi ka pa nagsisimulang pumunta sa pasahero. Pakisimulan o ikansela ang booking.)',
                        v_b.booking_id::TEXT, v_tag);
                    v_n := v_n + 1;
                END IF;
            ELSE
                -- Rule 8.4: he moved, then stood still. A reported delay (traffic, a road closure) restarts the five minutes.
                v_idle := EXTRACT(EPOCH FROM (v_now - GREATEST(v_b.stall_anchor_at, COALESCE(v_b.stall_delay_reported_at, v_b.stall_anchor_at))));
                IF v_idle >= public.dispatch_constant('stall_en_route_seconds') THEN
                    PERFORM public._booking_timer_cancel(v_b.booking_id, v_b.driver_id, 'DRV_STALL', 'Rule 8.4',
                        'The driver stopped on the way to the pickup for ' || public.dispatch_constant('stall_en_route_seconds') / 60 || ' minutes without reporting a reason.',
                        'You stopped on the way to the passenger for 5 minutes without reporting traffic or a road closure, so the booking was cancelled and given to another driver. '
                        || 'One strike was recorded. You may appeal through the Exemption & Appeal process.',
                        'Your driver was unable to proceed. We''re finding you another driver. '
                        || '(Hindi nakapagpatuloy ang iyong drayber. Naghahanap kami ng ibang drayber.)');
                    v_n := v_n + 1;
                END IF;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'booking timers: booking % could not be checked (%)', r.booking_id, SQLERRM;
        END;
    END LOOP;

    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN v_n;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. A REPORTED DELAY (Rule 8.4's "traffic / road closure" message)
-- ----------------------------------------------------------------------------
-- Restarts the five-minute stand-still window, twice at most per booking. It does not excuse a driver who has not started at all (Rule 8.3).
CREATE OR REPLACE FUNCTION public.driver_report_delay(p_booking_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_driver UUID := public.get_current_driver_id();
    v_b public.booking;
    v_prev TEXT := current_setting('sakay.internal_context', true);
BEGIN
    IF v_driver IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_A_DRIVER', 'error', 'Only a driver can report a delay.');
    END IF;
    IF p_reason IS NULL OR p_reason NOT IN ('traffic', 'road_closure') THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_DELAY_REASON', 'error', 'Choose traffic or a road closure.');
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_b.driver_id IS DISTINCT FROM v_driver OR public._booking_phase(v_b.booking_status) <> 'assigned' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_ON_THE_WAY', 'error', 'You can report a delay only while you are on the way to the pickup.');
    END IF;
    IF v_b.stall_anchor_at IS NULL OR v_b.stall_anchor_at <= COALESCE(v_b.accepted_at, v_b.stall_anchor_at) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_STARTED',
            'error', 'Start traveling toward the passenger first. A delay can be reported only after you have set off.');
    END IF;
    IF v_b.stall_delay_reports >= 2 THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_TOO_MANY_DELAY_REPORTS',
            'error', 'You have already reported two delays for this booking. Please proceed, or cancel the booking.');
    END IF;
    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.booking SET stall_delay_reported_at = clock_timestamp(), stall_delay_reports = stall_delay_reports + 1 WHERE booking_id = p_booking_id;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'reports', v_b.stall_delay_reports + 1, 'reports_left', 1 - v_b.stall_delay_reports);
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. THE ARRIVAL WAIT, SERVER CLOCK (Rule 10.1 - 10.3)
-- ----------------------------------------------------------------------------
-- What both screens show. The deadline is arrived_at + 5 minutes (+ 2 once the passenger has asked): the phones only draw the countdown.
-- The passenger learns only booleans about the driver's position; the driver gets "can I report a no-show" computed here.
CREATE OR REPLACE FUNCTION public.get_arrival_wait_status(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_b public.booking;
    v_me_driver UUID := public.get_current_driver_id();
    v_me_pax UUID := public.get_current_passenger_id();
    v_now TIMESTAMPTZ := clock_timestamp();
    v_base INTEGER := public.dispatch_constant('no_show_wait_seconds');
    v_ext INTEGER := public.dispatch_constant('no_show_extension_seconds');
    v_deadline TIMESTAMPTZ;
    v_remaining INTEGER;
    v_arrived BOOLEAN;
    v_is_driver BOOLEAN;
    v_in_zone BOOLEAN;
BEGIN
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id;
    IF NOT FOUND OR NOT ((v_me_driver IS NOT NULL AND v_b.driver_id = v_me_driver) OR (v_me_pax IS NOT NULL AND v_b.passenger_id = v_me_pax)) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_YOUR_BOOKING', 'error', 'This booking is not yours.');
    END IF;
    v_is_driver := v_me_driver IS NOT NULL AND v_b.driver_id = v_me_driver;
    v_arrived := public._booking_phase(v_b.booking_status) = 'arrived' AND v_b.arrived_at IS NOT NULL;
    IF NOT v_arrived THEN
        RETURN jsonb_build_object('success', TRUE, 'waiting', FALSE, 'booking_status', v_b.booking_status, 'server_time', v_now);
    END IF;
    v_deadline := v_b.arrived_at + make_interval(secs => v_base + CASE WHEN v_b.wait_extended_at IS NOT NULL THEN v_ext ELSE 0 END);
    v_remaining := GREATEST(0, ceil(EXTRACT(EPOCH FROM (v_deadline - v_now))))::INTEGER;
    v_in_zone := CASE WHEN v_is_driver THEN public._driver_within_pickup_zone(v_b.driver_id, p_booking_id) END;
    RETURN jsonb_build_object(
        'success', TRUE, 'waiting', TRUE, 'booking_status', v_b.booking_status,
        'arrived_at', v_b.arrived_at, 'deadline', v_deadline, 'seconds_remaining', v_remaining,
        'wait_total_seconds', v_base + CASE WHEN v_b.wait_extended_at IS NOT NULL THEN v_ext ELSE 0 END,
        'extended', v_b.wait_extended_at IS NOT NULL,
        'can_extend', v_me_pax IS NOT NULL AND v_b.wait_extended_at IS NULL AND v_now < v_b.arrived_at + make_interval(secs => v_base),
        'driver_in_zone', v_in_zone,
        'can_report_no_show', v_is_driver AND v_remaining = 0 AND COALESCE(v_in_zone, FALSE),
        'server_time', v_now);
END;
$$;

-- "I'm Almost There" (Rule 10.3): once, while the first five minutes are still running; adds exactly two minutes.
CREATE OR REPLACE FUNCTION public.passenger_extend_wait(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_me UUID := public.get_current_passenger_id();
    v_b public.booking;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_prev TEXT := current_setting('sakay.internal_context', true);
BEGIN
    IF v_me IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_A_PASSENGER', 'error', 'Only the passenger can ask for more time.');
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id AND passenger_id = v_me FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_YOUR_BOOKING', 'error', 'This booking does not belong to you.');
    END IF;
    IF public._booking_phase(v_b.booking_status) <> 'arrived' OR v_b.arrived_at IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_DRIVER_NOT_ARRIVED', 'error', 'Your driver has not arrived yet.');
    END IF;
    IF v_b.wait_extended_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ALREADY_EXTENDED', 'error', 'You have already used "I''m Almost There" for this booking.');
    END IF;
    IF v_now >= v_b.arrived_at + make_interval(secs => public.dispatch_constant('no_show_wait_seconds')) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_WAIT_OVER', 'error', 'The waiting time is already over, so it can no longer be extended.');
    END IF;
    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.booking SET wait_extended_at = v_now WHERE booking_id = p_booking_id;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN public.get_arrival_wait_status(p_booking_id);
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. PASSENGER NO-SHOW (Rule 10.4)
-- ----------------------------------------------------------------------------
-- Only when ALL of Rule 10.1 holds: the driver has arrived, the whole wait (with the extension, if used) has passed on the server's clock,
-- and the driver is at the pickup on a fix good enough to prove it. Then, in one transaction: the booking is cancelled (it cannot be
-- reinstated, 10.5: the passenger books again), the passenger gets 2 strikes, the driver gets the single-use, session-scoped redispatch
-- credit (decision PI-02 = A: it only ever breaks an exact ETA tie), and nothing makes him return to the terminal first.
CREATE OR REPLACE FUNCTION public.driver_report_no_show(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_driver UUID := public.get_current_driver_id();
    v_b public.booking;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_deadline TIMESTAMPTZ;
    v_prev TEXT := current_setting('sakay.internal_context', true);
BEGIN
    IF v_driver IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_A_DRIVER', 'error', 'Only the driver can report a no-show.');
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_b.driver_id IS DISTINCT FROM v_driver THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_YOUR_BOOKING', 'error', 'This booking is not assigned to you.');
    END IF;
    IF v_b.booking_status = 'Cancelled' AND v_b.cancellation_reason = 'PASSENGER_NO_SHOW' THEN
        RETURN jsonb_build_object('success', TRUE, 'already_reported', TRUE, 'booking_id', p_booking_id);        -- a double tap
    END IF;
    IF public._booking_phase(v_b.booking_status) <> 'arrived' OR v_b.arrived_at IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_ARRIVED', 'error', 'Tap Arrived at the pickup first. A no-show can be reported only after you have arrived.');
    END IF;
    v_deadline := v_b.arrived_at + make_interval(secs => public.dispatch_constant('no_show_wait_seconds')
                                                         + CASE WHEN v_b.wait_extended_at IS NOT NULL THEN public.dispatch_constant('no_show_extension_seconds') ELSE 0 END);
    IF v_now < v_deadline THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_WAIT_NOT_OVER',
            'error', 'The passenger still has time to board.', 'seconds_remaining', ceil(EXTRACT(EPOCH FROM (v_deadline - v_now)))::INTEGER);
    END IF;
    IF NOT public._driver_within_pickup_zone(v_driver, p_booking_id) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_AT_PICKUP',
            'error', 'You must be at the pickup point, with a clear GPS signal, to report a no-show.');
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.booking
       SET booking_status = 'Cancelled', cancelled_by = 'driver', cancellation_reason = 'PASSENGER_NO_SHOW', cancelled_at = v_now
     WHERE booking_id = p_booking_id;
    IF v_b.passenger_id IS NOT NULL THEN
        PERFORM public.issue_strike('passenger', v_b.passenger_id, 'PAX_NO_SHOW', NULL, p_booking_id, NULL,
            'PAX_NO_SHOW:' || p_booking_id::TEXT, NULL, 'Did not board within the waiting time after the driver arrived.', NULL,
            jsonb_build_object('rule', 'Rule 10.4', 'arrived_at', v_b.arrived_at, 'extended', v_b.wait_extended_at IS NOT NULL));
        PERFORM public._dispatch_notify_passenger(v_b, 'PASSENGER_NO_SHOW',
            'Nakansela ang booking mo (Your booking was cancelled)',
            'You did not board within the waiting time, so the booking was cancelled as a no-show and 2 strikes were recorded. You may book again. '
            || '(Hindi ka sumakay sa loob ng oras ng paghihintay, kaya nakansela ang booking at 2 strike ang naitala. Maaari kang mag-book muli.)');
    END IF;
    UPDATE public.driver_online_session SET redispatch_credit = TRUE WHERE driver_id = v_driver AND ended_at IS NULL;
    PERFORM public.record_policy_audit('PASSENGER_NO_SHOW', p_booking_id::TEXT, NULL, 'Dispatch',
        'The driver reported a passenger no-show after the full waiting time; 2 strikes, booking cancelled.', NULL,
        jsonb_build_object('driver_id', v_driver, 'passenger_id', v_b.passenger_id, 'arrived_at', v_b.arrived_at, 'deadline', v_deadline));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'booking_id', p_booking_id);
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. PRIVILEGES
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._driver_within_pickup_zone(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._booking_timer_cancel(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.booking_timers_sweep() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.driver_report_delay(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_arrival_wait_status(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.passenger_extend_wait(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.driver_report_no_show(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_report_delay(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_arrival_wait_status(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.passenger_extend_wait(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_report_no_show(UUID) TO authenticated, service_role;
