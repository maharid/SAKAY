-- ============================================================================
-- Migration: 20261015000003_batch6_booking_lifecycle.sql
-- Batch 6, part 3 of 4: the booking lifecycle is enforced by the database, and the dispatch tables are closed to the apps.
--
-- Until now the apps moved a booking along with plain UPDATEs and the database accepted almost anything: a passenger could write
-- "Trip Ongoing", a driver could take any booking he could read, a client could mark itself "cancelled by driver", the arrival and completion
-- times came from the phone's clock, and both strike triggers for a cancelling passenger listened for statuses ('Assigned', 'Ongoing') that no
-- app ever writes, so a passenger never got a strike. This part fixes the whole booking path behind the search:
--
--   1. _booking_phase()               one place that says which phase a status is in
--   2. booking_status_guard()         who may move a booking from where it is to where it is asked to go; the server stamps the times
--   3. booking_identity_guard()       a driver is attached only by accept_booking_offer(); the search state is the server's
--   4. check_one_open_booking()       Rule 4.4 now counts the statuses the apps really write (Accepted, In Transit, ...)
--   5. passenger cancellation         Rules 12.1 / 12.2 (grace, then one strike) and 12.9 (review flag); the dead triggers are removed
--   6. driver_cancel_booking()        Rules 12.3 / 12.4 / 12.7: strike, review flag, and the booking goes back to the search (Rule 12.8)
--   7. set_dispatch_setting()         the LGU administrator changes the offer window / the Tier 3 maximum
--   8. closing the doors              the apps can no longer write offers; find_candidate_drivers() (driver positions) is removed
--
-- Forward-only. Safe to run twice.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. WHICH PHASE A STATUS IS IN
-- ----------------------------------------------------------------------------
-- The apps write several spellings of the same moment ('Driver Arrived' and 'Arrived at Pickup'; 'In Transit' means "on the way to the
-- pickup"; the older names are kept). The rules below talk about phases, not spellings. NULL = not a status the booking may have.
CREATE OR REPLACE FUNCTION public._booking_phase(p_status TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE
        WHEN p_status IN ('Pending', 'Searching Driver') THEN 'searching'
        WHEN p_status IN ('Accepted', 'Assigned', 'Driver Assigned', 'Driver En Route', 'Heading to Passenger', 'In Transit') THEN 'assigned'
        WHEN p_status IN ('Driver Arrived', 'Arrived at Pickup') THEN 'arrived'
        WHEN p_status IN ('Trip Ongoing', 'Ongoing') THEN 'ongoing'
        WHEN p_status = 'Arrived at Destination' THEN 'at_destination'
        WHEN p_status = 'Completed' THEN 'completed'
        WHEN p_status = 'Cancelled' THEN 'cancelled'
        WHEN p_status = 'No Driver Found' THEN 'no_driver'
    END;
$$;

-- ----------------------------------------------------------------------------
-- 2. THE STATUS GUARD
-- ----------------------------------------------------------------------------
-- Allowed for the people on the booking (the service role, the policy engine and a direct database session are trusted and unrestricted):
--   the assigned driver   on the way -> arrived -> trip started -> arrived at the destination; and, once the passenger has had the
--                         confirmation time (Rule 16.6) without answering, Completed. He cannot cancel here: driver_cancel_booking().
--   the passenger         cancel while searching, assigned or the driver has arrived (Rule 12); confirm the fare at the destination
--                         (Completed). A trip in progress cannot be cancelled (Rule 13: it ends early instead).
--   an LGU administrator  anything (support)
-- The times are the SERVER's: a phone's clock cannot decide when a trip started or when a driver arrived. `cancelled_by` is who really made
-- the change, not what the caller wrote (so a driver cannot be recorded as a passenger to dodge a strike).
CREATE OR REPLACE FUNCTION public.booking_status_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_old TEXT := public._booking_phase(OLD.booking_status);
    v_new TEXT := public._booking_phase(NEW.booking_status);
    v_trusted BOOLEAN := public.is_trusted_session();
    v_now TIMESTAMPTZ := clock_timestamp();
    v_is_driver BOOLEAN;
    v_is_pax BOOLEAN;
    v_is_lgu BOOLEAN;
    v_allowed BOOLEAN := FALSE;
    v_timeout INTEGER := public.dispatch_constant('completion_confirm_timeout_seconds');
BEGIN
    IF NEW.booking_status IS NOT DISTINCT FROM OLD.booking_status THEN
        RETURN NEW;
    END IF;

    v_is_driver := OLD.driver_id IS NOT NULL AND OLD.driver_id = public.get_current_driver_id();
    v_is_pax := OLD.passenger_id IS NOT NULL AND OLD.passenger_id = public.get_current_passenger_id();
    v_is_lgu := COALESCE(public.is_lgu_admin(), FALSE);

    IF NOT v_trusted AND NOT v_is_lgu THEN
        IF v_new IS NULL THEN
            RAISE EXCEPTION 'ERR_UNKNOWN_BOOKING_STATUS: "%" is not a booking status.', NEW.booking_status USING ERRCODE = 'P0001';
        END IF;

        IF v_is_driver THEN
            IF NEW.booking_status = 'Cancelled' THEN
                RAISE EXCEPTION 'ERR_USE_DRIVER_CANCEL: Gamitin ang Cancel Booking button (a driver cancels through driver_cancel_booking(), which records the reason and finds another driver).' USING ERRCODE = 'P0001';
            END IF;
            v_allowed := (v_old = 'assigned' AND NEW.booking_status = 'In Transit')
                      OR (v_old IN ('assigned', 'arrived') AND v_new = 'arrived')
                      OR (v_old = 'arrived' AND v_new = 'ongoing')
                      OR (v_old = 'ongoing' AND NEW.booking_status = 'Arrived at Destination');
            IF NOT v_allowed AND v_old = 'at_destination' AND NEW.booking_status = 'Completed' THEN
                IF OLD.fare_locked_at IS NOT NULL AND v_now >= OLD.fare_locked_at + make_interval(secs => v_timeout) THEN
                    v_allowed := TRUE;                         -- Rule 16.6: the passenger did not confirm within the confirmation time
                ELSE
                    RAISE EXCEPTION 'ERR_WAIT_FOR_PASSENGER: Hintayin muna ang kumpirmasyon ng pasahero. (Wait for the passenger to confirm the fare; you can end the trip % seconds after arrival if they do not.)', v_timeout USING ERRCODE = 'P0001';
                END IF;
            END IF;
        ELSIF v_is_pax THEN
            IF NEW.booking_status = 'Cancelled' AND v_old = 'ongoing' THEN
                RAISE EXCEPTION 'ERR_TRIP_IN_PROGRESS: Hindi maaaring ikansela ang biyaheng nagpapatuloy. (A trip in progress cannot be cancelled.)' USING ERRCODE = 'P0001';
            END IF;
            -- A passenger may also say "we have arrived" (Slide to Finish Trip) when the driver has not: the fare lock then runs exactly as
            -- if the driver had, and a track that stops short of the destination cannot lower the fare (booking_fare_update_guard).
            v_allowed := (NEW.booking_status = 'Cancelled' AND v_old IN ('searching', 'assigned', 'arrived'))
                      OR (v_old = 'ongoing' AND NEW.booking_status = 'Arrived at Destination')
                      OR (v_old = 'at_destination' AND NEW.booking_status = 'Completed');
        END IF;

        IF NOT v_allowed THEN
            RAISE EXCEPTION 'ERR_BOOKING_TRANSITION: A booking cannot go from "%" to "%".', OLD.booking_status, NEW.booking_status USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- A phone cannot write a moment this transition does not own (the passenger's "arrived" call used to carry its own arrived_at).
    IF NOT v_trusted THEN
        IF NOT (v_new = 'assigned' AND v_old = 'searching') THEN NEW.accepted_at := OLD.accepted_at; END IF;
        IF v_new IS DISTINCT FROM 'arrived' THEN NEW.arrived_at := OLD.arrived_at; END IF;
        IF v_new IS DISTINCT FROM 'ongoing' THEN NEW.trip_started_at := OLD.trip_started_at; END IF;
        IF v_new IS DISTINCT FROM 'completed' THEN NEW.trip_completed_at := OLD.trip_completed_at; END IF;
        IF v_new IS DISTINCT FROM 'cancelled' THEN NEW.cancelled_at := OLD.cancelled_at; NEW.cancelled_by := OLD.cancelled_by; END IF;
    END IF;

    -- The server's clock for every moment of the trip (trusted callers may supply their own, a phone may not).
    IF v_new = 'assigned' AND v_old = 'searching' THEN
        NEW.accepted_at := COALESCE(CASE WHEN v_trusted THEN NEW.accepted_at END, v_now);
    ELSIF v_new = 'arrived' THEN
        NEW.arrived_at := COALESCE(OLD.arrived_at, CASE WHEN v_trusted THEN NEW.arrived_at END, v_now);
    ELSIF v_new = 'ongoing' THEN
        NEW.trip_started_at := COALESCE(OLD.trip_started_at, CASE WHEN v_trusted THEN NEW.trip_started_at END, v_now);
    ELSIF v_new = 'completed' THEN
        NEW.trip_completed_at := COALESCE(CASE WHEN v_trusted THEN NEW.trip_completed_at END, v_now);
    ELSIF v_new = 'cancelled' THEN
        NEW.cancelled_at := COALESCE(CASE WHEN v_trusted THEN NEW.cancelled_at END, v_now);
        NEW.cancelled_by := CASE
            WHEN v_is_pax THEN 'passenger'
            WHEN v_is_driver THEN 'driver'
            WHEN v_is_lgu AND NOT v_trusted THEN 'lgu_admin'
            ELSE COALESCE(NEW.cancelled_by, 'system') END;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_booking_status_guard ON public.booking;
CREATE TRIGGER trigger_booking_status_guard BEFORE UPDATE OF booking_status ON public.booking
    FOR EACH ROW EXECUTE FUNCTION public.booking_status_guard();

-- Every cancellation leaves a record (the table existed and nothing wrote to it).
CREATE OR REPLACE FUNCTION public.booking_log_cancellation()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.cancellation_record (booking_id, cancelled_by, reason, redispatch_triggered, cancelled_at)
    VALUES (NEW.booking_id, COALESCE(NEW.cancelled_by, 'system'), NEW.cancellation_reason, FALSE, COALESCE(NEW.cancelled_at, clock_timestamp()));
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trigger_booking_log_cancellation ON public.booking;
CREATE TRIGGER trigger_booking_log_cancellation AFTER UPDATE OF booking_status ON public.booking
    FOR EACH ROW WHEN (NEW.booking_status = 'Cancelled' AND OLD.booking_status IS DISTINCT FROM 'Cancelled')
    EXECUTE FUNCTION public.booking_log_cancellation();

-- ----------------------------------------------------------------------------
-- 3. THE IDENTITY GUARD (replaces 20261009000001): the driver and the search belong to the server
-- ----------------------------------------------------------------------------
-- Same as before, except: a driver is attached (or removed) only by accept_booking_offer() / the redispatch, not by the driver's own UPDATE;
-- the search state, the Priority TODA and the acceptance position cannot be written by the people on the booking; and the moments of the
-- trip cannot be edited by a plain update (the status guard stamps them when the status changes).
CREATE OR REPLACE FUNCTION public.booking_identity_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    IF public.is_trusted_session() OR COALESCE(public.is_lgu_admin(), FALSE) THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        NEW.accepted_at := NULL;  NEW.arrived_at := NULL;  NEW.trip_started_at := NULL;  NEW.trip_completed_at := NULL;
        NEW.cancelled_at := NULL;  NEW.cancelled_by := NULL;  NEW.cancellation_reason := NULL;
        NEW.shared_trip_match_id := NULL;
        NEW.search_restarted_at := NULL;
        RETURN NEW;
    END IF;

    IF NEW.passenger_id IS DISTINCT FROM OLD.passenger_id THEN
        -- The only legitimate change: the foreign key nulling the link after the passenger row was deleted.
        IF NOT (NEW.passenger_id IS NULL
                AND OLD.passenger_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM public.passenger p WHERE p.passenger_id = OLD.passenger_id)) THEN
            RAISE EXCEPTION 'ERR_BOOKING_OWNER_LOCKED: The passenger of a booking cannot be changed.' USING ERRCODE = '42501';
        END IF;
    END IF;
    IF NEW.toda_id IS DISTINCT FROM OLD.toda_id THEN
        RAISE EXCEPTION 'ERR_BOOKING_TODA_LOCKED: The TODA of a booking cannot be changed by the people on it.' USING ERRCODE = '42501';
    END IF;
    IF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
        -- Likewise the only change a client session may see: the foreign key nulling the link after the driver row was deleted.
        IF NOT (NEW.driver_id IS NULL
                AND OLD.driver_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM public.driver d WHERE d.driver_id = OLD.driver_id)) THEN
            RAISE EXCEPTION 'ERR_BOOKING_DRIVER_LOCKED: A driver is attached to a booking only by accepting an offer (accept_booking_offer).' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF NEW.dispatch_cycle IS DISTINCT FROM OLD.dispatch_cycle
       OR NEW.dispatch_tier IS DISTINCT FROM OLD.dispatch_tier
       OR NEW.dispatch_cycle_started_at IS DISTINCT FROM OLD.dispatch_cycle_started_at
       OR NEW.dispatch_tier_started_at IS DISTINCT FROM OLD.dispatch_tier_started_at
       OR NEW.dispatch_pool_refreshed_at IS DISTINCT FROM OLD.dispatch_pool_refreshed_at
       OR NEW.dispatch_next_action_at IS DISTINCT FROM OLD.dispatch_next_action_at
       OR NEW.dispatch_reached_tier3_at IS DISTINCT FROM OLD.dispatch_reached_tier3_at
       OR NEW.dispatch_ended_reason IS DISTINCT FROM OLD.dispatch_ended_reason
       OR NEW.priority_toda_id IS DISTINCT FROM OLD.priority_toda_id
       OR NEW.accepted_driver_cancel_count IS DISTINCT FROM OLD.accepted_driver_cancel_count
       OR NEW.accept_latitude IS DISTINCT FROM OLD.accept_latitude
       OR NEW.accept_longitude IS DISTINCT FROM OLD.accept_longitude
       OR NEW.stall_anchor_latitude IS DISTINCT FROM OLD.stall_anchor_latitude
       OR NEW.stall_anchor_longitude IS DISTINCT FROM OLD.stall_anchor_longitude
       OR NEW.stall_anchor_at IS DISTINCT FROM OLD.stall_anchor_at
       OR NEW.stall_delay_reported_at IS DISTINCT FROM OLD.stall_delay_reported_at
       OR NEW.stall_delay_reports IS DISTINCT FROM OLD.stall_delay_reports
       OR NEW.stall_warned_at IS DISTINCT FROM OLD.stall_warned_at
       OR NEW.driver_unreachable_since IS DISTINCT FROM OLD.driver_unreachable_since
       OR NEW.wait_extended_at IS DISTINCT FROM OLD.wait_extended_at
       OR NEW.search_restarted_at IS DISTINCT FROM OLD.search_restarted_at THEN
        RAISE EXCEPTION 'ERR_DISPATCH_LOCKED: The search for a driver is managed by the system and cannot be edited.' USING ERRCODE = '42501';
    END IF;

    -- The moments of the trip and who cancelled change only together with the status (the status guard stamps them).
    IF NEW.booking_status IS NOT DISTINCT FROM OLD.booking_status
       AND (NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
            OR NEW.arrived_at IS DISTINCT FROM OLD.arrived_at
            OR NEW.trip_started_at IS DISTINCT FROM OLD.trip_started_at
            OR NEW.trip_completed_at IS DISTINCT FROM OLD.trip_completed_at
            OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
            OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by) THEN
        RAISE EXCEPTION 'ERR_BOOKING_TIMES_LOCKED: The times of a trip are recorded by the system.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. RULE 4.4: ONE OPEN BOOKING (counts what the apps really write)
-- ----------------------------------------------------------------------------
-- It counted only 'Pending', 'Searching Driver', 'Assigned' and 'Ongoing', so once a driver ACCEPTED ('Accepted', 'In Transit', ...) the
-- passenger could book a second trip. Open = searching, or accepted and not yet finished. No Driver Found is not open (the passenger may
-- book again). The shared-trip exception is kept exactly as it was (Batch 10 owns Shared Trip matching).
CREATE OR REPLACE FUNCTION public.check_one_open_booking()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_open_count INTEGER;
    v_shared_primary_count INTEGER;
BEGIN
    IF NEW.passenger_id IS NULL OR NOT public._booking_is_searching(NEW.booking_status) THEN
        RETURN NEW;
    END IF;

    SELECT count(*) INTO v_open_count
      FROM public.booking b
     WHERE b.passenger_id = NEW.passenger_id
       AND (public._booking_is_searching(b.booking_status) OR public._booking_is_open_accepted(b.booking_status));
    IF v_open_count = 0 THEN
        RETURN NEW;
    END IF;

    SELECT count(*) INTO v_shared_primary_count
      FROM public.booking b
     WHERE b.passenger_id = NEW.passenger_id
       AND b.is_shared_trip = TRUE
       AND b.booking_status = 'Searching Driver';
    IF v_shared_primary_count = v_open_count AND NEW.is_shared_trip = TRUE THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'idx_one_open_booking: passenger already has an active booking' USING ERRCODE = '23505';
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. PASSENGER CANCELLATION (Rules 12.1, 12.2, 12.6, 12.9)
-- ----------------------------------------------------------------------------
-- No strike before a driver accepts, or within one minute after, as long as the driver has not arrived (12.1). After that, or once the driver
-- has arrived: one strike (12.2). Only a cancellation the PASSENGER made counts (system cancellations never strike, 12.6). Three or more
-- cancelled bookings in 24 hours without a completed trip between them raise a review flag, not a strike (12.9; the violation catalog says
-- "detection raises a review flag"). This replaces strike_on_passenger_cancellation() from Batch 3 and the earlier PI-09 trigger: both
-- tested statuses no app writes, so neither ever fired, and together they would have struck twice.
DROP TRIGGER IF EXISTS trg_cancellation_abuse ON public.booking;
DROP FUNCTION IF EXISTS public.check_cancellation_abuse();

CREATE OR REPLACE FUNCTION public.strike_on_passenger_cancellation()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_grace INTEGER := public.dispatch_constant('passenger_cancel_grace_seconds');
    v_in_grace BOOLEAN;
    v_window INTERVAL := make_interval(hours => public.dispatch_constant('repeat_cancel_window_hours'));
    v_last_done TIMESTAMPTZ;
    v_recent INTEGER;
BEGIN
    IF NEW.cancelled_by IS DISTINCT FROM 'passenger' OR NEW.passenger_id IS NULL THEN
        RETURN NEW;
    END IF;
    PERFORM set_config('sakay.internal_context', 'true', true);

    IF public._booking_is_open_accepted(OLD.booking_status) THEN
        v_in_grace := OLD.accepted_at IS NOT NULL
                  AND public._booking_phase(OLD.booking_status) = 'assigned'
                  AND clock_timestamp() <= OLD.accepted_at + make_interval(secs => v_grace);
        IF NOT v_in_grace THEN
            PERFORM public.issue_strike('passenger', NEW.passenger_id, 'PAX_LATE_CANCEL', NULL, NEW.booking_id, NULL,
                'PAX_LATE_CANCEL:' || NEW.booking_id::TEXT, NULL,
                COALESCE(NEW.cancellation_reason, 'Cancelled after the driver accepted'), NULL, NULL);
        END IF;
    END IF;

    SELECT max(b.trip_completed_at) INTO v_last_done FROM public.booking b
     WHERE b.passenger_id = NEW.passenger_id AND b.booking_status = 'Completed';
    SELECT count(*) INTO v_recent FROM public.booking b
     WHERE b.passenger_id = NEW.passenger_id AND b.booking_status = 'Cancelled' AND b.cancelled_by = 'passenger'
       AND b.cancelled_at > GREATEST(clock_timestamp() - v_window, COALESCE(v_last_done, '-infinity'::TIMESTAMPTZ));
    IF v_recent >= public.dispatch_constant('repeat_cancel_flag_count') THEN
        PERFORM public.create_admin_review_flag('PASSENGER_BOOKING_ABUSE_REVIEW', 'passenger', NEW.passenger_id::TEXT, 'Rules 12.7 / 12.9',
            'lgu_admin', jsonb_build_object('cancelled_bookings_in_window', v_recent,
                'window_hours', public.dispatch_constant('repeat_cancel_window_hours'),
                'note', 'Review flag only. The passenger may be restricted only after the administrator reviews it (Rule 12.9).'));
    END IF;

    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. DRIVER CANCELLATION (Rules 12.3, 12.4, 12.7, 12.8, 15.1)
-- ----------------------------------------------------------------------------
-- The ONLY way a driver gives a booking back after accepting it. The reason comes from a fixed list. Before the driver has travelled 50 m
-- toward the pickup: 1 strike (12.3); after: 2 strikes, and a review flag if it is not the first time (12.4); the booking goes straight
-- back to the search with this driver excluded; after three accepted drivers in a row the cycle ends (12.8). Three cancellations by one driver
-- in a day raise a review flag (12.7). A cancellation once the trip has started is not possible here (the trip ends instead, Rule 13).
CREATE OR REPLACE FUNCTION public.driver_cancel_booking(p_booking_id UUID, p_reason_code TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_driver UUID := public.get_current_driver_id();
    v_b public.booking;
    v_d public.driver;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_phase TEXT;
    v_reason TEXT;
    v_d_accept DOUBLE PRECISION;
    v_d_now DOUBLE PRECISION;
    v_en_route BOOLEAN;
    v_code TEXT;
    v_prior INTEGER;
    v_today INTEGER;
    v_result TEXT;
BEGIN
    IF v_driver IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_A_DRIVER', 'error', 'Only a driver can cancel an accepted booking.');
    END IF;
    IF p_reason_code IS NULL OR p_reason_code NOT IN ('vehicle_breakdown', 'personal_emergency', 'passenger_unreachable',
                                                       'wrong_pickup_location', 'safety_concern', 'road_closure_or_traffic', 'other') THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_CANCEL_REASON_REQUIRED', 'error', 'Choose a reason for cancelling.');
    END IF;

    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_b.driver_id IS DISTINCT FROM v_driver THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_YOUR_BOOKING', 'error', 'This booking is not assigned to you.');
    END IF;
    v_phase := public._booking_phase(v_b.booking_status);
    IF v_phase NOT IN ('assigned', 'arrived') THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_CANNOT_CANCEL',
            'error', 'This booking can no longer be cancelled (the trip has started or it has already ended).');
    END IF;

    SELECT * INTO v_d FROM public.driver WHERE driver_id = v_driver;
    v_reason := p_reason_code || CASE WHEN p_note IS NOT NULL AND length(btrim(p_note)) > 0 THEN ': ' || left(btrim(p_note), 300) ELSE '' END;

    -- How far toward the pickup the driver has come since accepting (Rules 12.3 / 12.4). Arrived counts as travelled; an unknown or
    -- stale position counts as no travel (the lesser strike).
    v_d_accept := CASE WHEN v_b.accept_latitude IS NOT NULL
                       THEN public.calculate_haversine_distance_km(v_b.accept_latitude, v_b.accept_longitude, v_b.pickup_latitude, v_b.pickup_longitude) END;
    v_d_now := CASE WHEN public.driver_has_fresh_location(v_driver)
                    THEN public.calculate_haversine_distance_km(v_d.current_latitude, v_d.current_longitude, v_b.pickup_latitude, v_b.pickup_longitude) END;
    v_en_route := v_phase = 'arrived'
               OR (v_d_accept IS NOT NULL AND v_d_now IS NOT NULL
                   AND (v_d_accept - v_d_now) * 1000.0 >= public.dispatch_constant('driver_travel_threshold_m'));
    v_code := CASE WHEN v_en_route THEN 'DRV_CANCEL_EN_ROUTE' ELSE 'DRV_CANCEL_BEFORE_TRAVEL' END;

    PERFORM set_config('sakay.internal_context', 'true', true);

    SELECT count(*) INTO v_prior FROM public.strikes_ledger
     WHERE subject_type = 'driver' AND subject_id = v_driver AND violation_code = 'DRV_CANCEL_EN_ROUTE' AND status <> 'VOIDED';

    PERFORM public.issue_strike('driver', v_driver, v_code, NULL, p_booking_id, NULL,
        'DRV_CANCEL:' || p_booking_id::TEXT || ':' || v_b.dispatch_cycle || ':' || (v_b.accepted_driver_cancel_count + 1),
        NULL, v_reason, NULL,
        jsonb_build_object('reason_code', p_reason_code, 'en_route', v_en_route,
                           'progress_toward_pickup_m', CASE WHEN v_d_accept IS NOT NULL AND v_d_now IS NOT NULL THEN round(((v_d_accept - v_d_now) * 1000.0)::NUMERIC) END));

    IF v_en_route AND v_prior > 0 THEN                              -- Rule 12.4: not the first instance
        PERFORM public._presence_flag('DRIVER_REPEATED_CANCELLATIONS', v_driver, 'Rule 12.4',
            jsonb_build_object('en_route_cancellations_before', v_prior, 'booking_id', p_booking_id));
    END IF;
    -- Rule 12.7: three or more cancellations by this driver in the window (this one's strike is already in the ledger).
    SELECT count(*) INTO v_today FROM public.strikes_ledger s
     WHERE s.subject_type = 'driver' AND s.subject_id = v_driver AND s.violation_code IN ('DRV_CANCEL_EN_ROUTE', 'DRV_CANCEL_BEFORE_TRAVEL')
       AND s.status <> 'VOIDED'
       AND s.issued_at > clock_timestamp() - make_interval(hours => public.dispatch_constant('repeat_cancel_window_hours'));
    IF v_today >= public.dispatch_constant('repeat_cancel_flag_count') THEN
        PERFORM public._presence_flag('DRIVER_REPEATED_CANCELLATIONS', v_driver, 'Rule 12.7',
            jsonb_build_object('cancellations_in_window', v_today, 'window_hours', public.dispatch_constant('repeat_cancel_window_hours')));
    END IF;

    v_result := public._dispatch_redispatch(p_booking_id, v_driver, 'driver', v_reason);
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);

    RETURN jsonb_build_object('success', TRUE, 'booking_id', p_booking_id, 'outcome', v_result,
                              'strike_code', v_code, 'en_route', v_en_route);
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. THE LGU ADMINISTRATOR'S TWO SETTINGS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_dispatch_settings()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RAISE EXCEPTION 'Access Denied: Only an LGU administrator can read the dispatch settings.' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object(
        'offer_window_seconds', public.dispatch_constant('offer_window_seconds'),
        'tier3_max_seconds', public.dispatch_constant('tier3_max_seconds'),
        'defaults', jsonb_build_object('offer_window_seconds', 15, 'tier3_max_seconds', 300),
        'limits', jsonb_build_object('offer_window_seconds', jsonb_build_array(10, 60), 'tier3_max_seconds', jsonb_build_array(60, 1800)));
END;
$$;

CREATE OR REPLACE FUNCTION public.set_dispatch_setting(p_key TEXT, p_value INTEGER)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_admin UUID;
    v_before INTEGER;
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RAISE EXCEPTION 'Access Denied: Only an LGU administrator can change the dispatch settings.' USING ERRCODE = '42501';
    END IF;
    IF p_key NOT IN ('offer_window_seconds', 'tier3_max_seconds') THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_UNKNOWN_SETTING', 'error', 'Unknown setting.');
    END IF;
    IF p_value IS NULL
       OR (p_key = 'offer_window_seconds' AND p_value NOT BETWEEN 10 AND 60)
       OR (p_key = 'tier3_max_seconds' AND p_value NOT BETWEEN 60 AND 1800) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_OUT_OF_RANGE',
            'error', CASE p_key WHEN 'offer_window_seconds' THEN 'The offer window must be 10 to 60 seconds.'
                                ELSE 'The maximum search time must be 60 to 1800 seconds.' END);
    END IF;

    SELECT admin_id INTO v_admin FROM public.lgu_admin WHERE auth_user_id = auth.uid() AND account_status = 'Active' LIMIT 1;
    v_before := public.dispatch_constant(p_key);
    INSERT INTO public.dispatch_setting (setting_key, setting_value, updated_by, updated_at)
    VALUES (p_key, p_value, v_admin, CURRENT_TIMESTAMP)
    ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;

    PERFORM public.record_policy_audit('DISPATCH_SETTING_CHANGED', p_key, NULL, 'Dispatch',
        'The ' || p_key || ' setting was changed from ' || v_before || ' to ' || p_value || '.',
        jsonb_build_object('value', v_before), jsonb_build_object('value', p_value));
    RETURN jsonb_build_object('success', TRUE, 'key', p_key, 'value', p_value, 'previous', v_before);
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. CLOSING THE DOORS
-- ----------------------------------------------------------------------------
-- (a) Offers are written by the engine only. The passenger could insert offers for any driver and mark any offer unanswered; a driver could
--     answer it any way he liked. Now the apps read their offers and use accept_booking_offer() / decline_booking_offer().
DROP POLICY IF EXISTS dispatch_attempt_insert_own_booking ON public.dispatch_attempt;
DROP POLICY IF EXISTS dispatch_attempt_update_scoped ON public.dispatch_attempt;
REVOKE INSERT, UPDATE, TRUNCATE ON public.dispatch_attempt FROM anon, authenticated;

-- (b) A passenger does not need to see which drivers were offered the booking, and when (privacy): only the driver's own offers and the LGU.
DROP POLICY IF EXISTS dispatch_attempt_select_scoped ON public.dispatch_attempt;
CREATE POLICY dispatch_attempt_select_scoped ON public.dispatch_attempt FOR SELECT TO authenticated
    USING ((driver_id IS NOT NULL AND driver_id = (SELECT public.get_current_driver_id()))
           OR (SELECT public.is_lgu_admin()));

-- (c) A driver no longer updates a booking he does not have yet.
DROP POLICY IF EXISTS booking_update_participants ON public.booking;
CREATE POLICY booking_update_participants ON public.booking FOR UPDATE TO authenticated
    USING ((passenger_id IS NOT NULL AND passenger_id = (SELECT public.get_current_passenger_id()))
           OR (driver_id IS NOT NULL AND driver_id = (SELECT public.get_current_driver_id()))
           OR (SELECT public.is_lgu_admin()))
    WITH CHECK ((passenger_id IS NOT NULL AND passenger_id = (SELECT public.get_current_passenger_id()))
           OR (driver_id IS NOT NULL AND driver_id = (SELECT public.get_current_driver_id()))
           OR (SELECT public.is_lgu_admin()));

-- (d) The two helpers of the old model, and the passenger-callable list of nearby drivers (a passenger could read every online driver's
--     position, rounded to 0.1 km, one booking at a time), are gone: the engine reads positions itself.
DROP FUNCTION IF EXISTS public.find_candidate_drivers(UUID, DOUBLE PRECISION, INTEGER);
DROP FUNCTION IF EXISTS public.rls_driver_can_claim_booking(UUID);
DROP FUNCTION IF EXISTS public.rls_booking_open_and_mine(UUID);

-- ----------------------------------------------------------------------------
-- 9. PRIVILEGES AND SELF-CHECK
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._booking_phase(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.booking_status_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.booking_log_cancellation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.strike_on_passenger_cancellation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.driver_cancel_booking(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_dispatch_settings() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_dispatch_setting(TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_cancel_booking(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_dispatch_settings() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_dispatch_setting(TEXT, INTEGER) TO authenticated, service_role;

DO $$
BEGIN
    IF public._booking_phase('Accepted') <> 'assigned' OR public._booking_phase('Trip Ongoing') <> 'ongoing'
       OR public._booking_phase('Arrived at Destination') <> 'at_destination' OR public._booking_phase('Nonsense') IS NOT NULL THEN
        RAISE EXCEPTION '_booking_phase() does not classify the statuses correctly';
    END IF;
    IF has_table_privilege('authenticated', 'public.dispatch_attempt', 'INSERT')
       OR has_table_privilege('authenticated', 'public.dispatch_attempt', 'UPDATE') THEN
        RAISE EXCEPTION 'the apps can still write offers';
    END IF;
END $$;
