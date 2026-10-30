-- ============================================================================
-- NO PASSENGER CANCELLATION ONCE THE DRIVER IS ON THE WAY (panel comment, decision D-P1)
-- ============================================================================
-- The panel at the previous defense: "bawal na magcancel kapag otw na ang driver". Until now a passenger could cancel a booking in every phase before the trip
-- started: after the driver tapped "I am on my way" (status In Transit) and even after the driver had arrived, at the price of one strike (Rule 12.2).
--
-- From now on the database refuses a passenger cancellation when the booking is
--   * In Transit / Driver En Route / Heading to Passenger  (the driver is on the way), or
--   * Driver Arrived / Arrived at Pickup                   (the driver is at the pickup; a passenger who does not come out is a No-Show, Rule 10.4)
-- with ERR_DRIVER_ON_THE_WAY. Still allowed, exactly as before:
--   * while the booking is searching, and from No Driver Found (Rule 7.4, no penalty);
--   * after a driver accepted but before the driver is on the way (Accepted / Driver Assigned): free inside the first 60 s, one strike after (Rules 12.1 / 12.2);
--   * while the booking carries the Driver Unreachable mark (Rule 9.2, decision D7-6): not struck, as before;
--   * everything the SYSTEM does (stall, unreachable and connectivity timers, No Driver Found, no-show) and an LGU administrator's audited override: they are not
--     passenger writes and never reach this check.
-- A passenger whose driver is on the way and who is unsafe uses the Urgent Safety Report; a driver who never arrives is cancelled by the timers.
--
-- Only booking_status_guard() changes: it is the 20261024000001 version with the one block above added to the passenger branch. Forward-only. Safe to run twice.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.booking_status_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

        -- Rule 9.5: the connection was lost during this trip; the driver must say what became of it before it can be finished.
        IF v_old = 'ongoing' AND NEW.booking_status = 'Arrived at Destination'
           AND EXISTS (SELECT 1 FROM public.trip_connectivity_event e
                        WHERE e.booking_id = OLD.booking_id AND e.phase = 'ongoing' AND e.reconfirmed_at IS NULL AND e.ended_reason IS NULL) THEN
            RAISE EXCEPTION 'ERR_RECONFIRM_TRIP: Nawalan ng koneksyon ang biyaheng ito. Kumpirmahin muna ng drayber ang kalagayan ng biyahe bago ito matapos. (The connection was lost during this trip: the driver must re-confirm the trip status before it can be finished.)' USING ERRCODE = 'P0001';
        END IF;

        IF v_is_driver THEN
            IF NEW.booking_status = 'Cancelled' THEN
                RAISE EXCEPTION 'ERR_USE_DRIVER_CANCEL: Gamitin ang Cancel Booking button (a driver cancels through driver_cancel_booking(), which records the reason and finds another driver).' USING ERRCODE = 'P0001';
            END IF;
            -- Rule 10.1 / PI-06 (Batch 8): Arrived means AT THE PICKUP. Whichever screen sends it, the database looks at the driver's own
            -- fix (fresh, accurate, within the zone); a tap from anywhere else is refused, so the passenger's wait can never run while the
            -- driver is still on the road.
            IF v_old = 'assigned' AND v_new = 'arrived' AND NOT public._driver_within_pickup_zone(OLD.driver_id, OLD.booking_id) THEN
                RAISE EXCEPTION 'ERR_NOT_AT_PICKUP: Wala ka pa sa pickup point, o hindi pa malinaw ang GPS mo. Lumapit sa pin at subukang muli. (You are not at the pickup point yet, or your GPS is not clear enough. Move closer to the pin, into the open if needed, and tap Arrived again.)' USING ERRCODE = 'P0001';
            END IF;
            -- Rule 11.1 (Batch 8): the trip does not start before the driver has checked the passenger's first name against the booking
            IF v_old = 'arrived' AND v_new = 'ongoing' AND OLD.boarding_verified_at IS NULL THEN
                RAISE EXCEPTION 'ERR_VERIFY_PASSENGER: Tiyakin muna ang unang pangalan ng pasahero bago simulan ang biyahe. (Check the passenger''s first name against the booking first, then tap "I checked the first name".)' USING ERRCODE = 'P0001';
            END IF;
            v_allowed := (v_old = 'assigned' AND NEW.booking_status = 'In Transit')
                      OR (v_old IN ('assigned', 'arrived') AND v_new = 'arrived')
                      OR (v_old = 'arrived' AND v_new = 'ongoing')
                      OR (v_old = 'ongoing' AND NEW.booking_status = 'Arrived at Destination');
            -- Rule 18.3 (Batch 9): a trip is Completed only by the driver's Payment Received (driver_confirm_payment_received), which waits for the
            -- passenger's Confirm Fare / Report Fare Discrepancy or the confirmation time (Rule 16.6, completion_confirm_timeout_seconds)
            IF v_old = 'at_destination' AND NEW.booking_status = 'Completed' THEN
                RAISE EXCEPTION 'ERR_USE_PAYMENT_RECEIVED: Pindutin ang "Payment Received" para tapusin ang biyahe. (Tap "Payment Received" to finish the trip: a trip is completed by that button only.)' USING ERRCODE = 'P0001';
            END IF;
        ELSIF v_is_pax THEN
            IF NEW.booking_status = 'Cancelled' AND v_old = 'ongoing' THEN
                RAISE EXCEPTION 'ERR_TRIP_IN_PROGRESS: Hindi maaaring ikansela ang biyaheng nagpapatuloy. (A trip in progress cannot be cancelled.)' USING ERRCODE = 'P0001';
            END IF;
            -- Panel comment (P1, decision D-P1): once the driver is ON THE WAY ("I am on my way" = In Transit) or has arrived, the passenger can no longer cancel.
            -- Before that (searching, no driver found, accepted but not yet moving) the cancel rules of Rules 12.1 / 12.2 are unchanged. The one exception is a driver the
            -- system has marked Unreachable (Rule 9.2, decision D7-6): the passenger is leaving a driver who cannot be reached. A trip that is not going well is reported
            -- (Urgent Safety Report / incident report); one that never starts is cancelled by the stall and unreachable timers, which are trusted callers and never pass here.
            IF NEW.booking_status = 'Cancelled'
               AND (OLD.booking_status IN ('In Transit', 'Driver En Route', 'Heading to Passenger') OR v_old = 'arrived')
               AND OLD.driver_unreachable_since IS NULL THEN
                RAISE EXCEPTION 'ERR_DRIVER_ON_THE_WAY: Papunta na ang drayber, kaya hindi na maaaring ikansela ang booking. (Your driver is already on the way, so this booking can no longer be cancelled. If something is wrong, use the Urgent Safety Report or report the driver after the trip.)' USING ERRCODE = 'P0001';
            END IF;
            -- Rules 13.2 / 18.2 (Batch 9, decision D9-6): the passenger neither ends the trip nor completes it by writing the status. Outside the destination
            -- gate End Trip (Early) is a REQUEST (passenger_request_early_end) that unlocks the DRIVER's End Trip; the fare is confirmed with
            -- passenger_confirm_fare (or a discrepancy is documented with passenger_report_fare_discrepancy).
            IF v_old = 'ongoing' AND NEW.booking_status = 'Arrived at Destination' THEN
                RAISE EXCEPTION 'ERR_USE_EARLY_END: Ang drayber ang nagtatapos ng biyahe. Pindutin ang End Trip (Early) para humiling. (The driver ends the trip; tap End Trip (Early) to ask for it.)' USING ERRCODE = 'P0001';
            END IF;
            IF v_old = 'at_destination' AND NEW.booking_status = 'Completed' THEN
                RAISE EXCEPTION 'ERR_USE_CONFIRM_FARE: Pindutin ang Confirm Fare o i-report ang pamasahe. (Tap Confirm Fare, or report a discrepancy: the driver completes the trip with Payment Received.)' USING ERRCODE = 'P0001';
            END IF;
            v_allowed := (NEW.booking_status = 'Cancelled' AND v_old IN ('searching', 'assigned', 'arrived', 'no_driver'));
        END IF;

        IF NOT v_allowed THEN
            RAISE EXCEPTION 'ERR_BOOKING_TRANSITION: A booking cannot go from "%" to "%".', OLD.booking_status, NEW.booking_status USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- An LGU Administrator who moves a booking through the table (support, an override) leaves an audit row (Rule 16.3 / D9-2: audited admin override)
    IF NOT v_trusted AND v_is_lgu THEN
        PERFORM public.record_policy_audit('ADMIN_BOOKING_STATUS_OVERRIDE', OLD.booking_id::TEXT, NULL, 'Booking Lifecycle',
            'An LGU administrator changed the status of a booking directly.', jsonb_build_object('booking_status', OLD.booking_status),
            jsonb_build_object('booking_status', NEW.booking_status));
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
    -- Rule 12.4 / PI-02: the priority of a redispatched booking lasts only while it is searching (accepted, cancelled or ended clears it)
    IF v_new IS DISTINCT FROM 'searching' THEN
        NEW.redispatch_priority_at := NULL;
    END IF;
    RETURN NEW;
END;
$$;


REVOKE EXECUTE ON FUNCTION public.booking_status_guard() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
    IF position('ERR_DRIVER_ON_THE_WAY' IN pg_get_functiondef('public.booking_status_guard()'::regprocedure)) = 0 THEN
        RAISE EXCEPTION 'booking_status_guard() does not carry the on-the-way rule';
    END IF;
    IF has_function_privilege('authenticated', 'public.booking_status_guard()', 'EXECUTE') THEN
        RAISE EXCEPTION 'booking_status_guard() must stay internal';
    END IF;
END $$;
