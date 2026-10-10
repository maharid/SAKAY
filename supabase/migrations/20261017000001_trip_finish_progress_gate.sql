-- ============================================================================
-- Migration: 20261017000001_trip_finish_progress_gate.sql
-- The driver may finish a trip at 90% progress, and the DATABASE enforces it.
--
-- Until now the only thing standing between a driver and "Arrived at Destination" was the Driver app: its Complete Trip button was enabled
-- within 50 m of the destination pin (a check on the phone), while booking_status_guard() let the assigned driver move a trip from
-- "Trip Ongoing" to "Arrived at Destination" with no check of position at all. A destination pin that sits inside an establishment (a market,
-- a school) can be farther than 50 m from where a tricycle can stop, so a real trip stayed at 95% and could not be finished.
--
-- What this adds (forward-only, safe to run twice):
--   1. dispatch_constant(): trip_finish_min_progress_pct (90), trip_progress_near_destination_m (80), trip_progress_cap_pct (95),
--      trip_progress_floor_pct (5), mirrored in packages/shared/src/config/policyConfig.ts (the drift test fails if either side changes alone)
--   2. _trip_progress_km() / _trip_progress_pct(): the SAME straight-line progress the apps compute (utils/tripProgress.ts), from the fixes the
--      database logged for the trip (gps_log). The figure is the best (highest) the trip has reached, as the screens show it.
--   3. get_trip_progress(): what the passenger's and the driver's screens read, so both show the figure the database will check.
--   4. booking_trip_progress_guard(): the assigned driver cannot move a trip to "Arrived at Destination" below that progress. Checked on the
--      server for every caller except trusted server code and an LGU administrator (support), exactly like booking_status_guard().
--
-- Not changed: who may make the move (booking_status_guard), the passenger's own "Slide to Finish Trip" (the passenger is on board and says so),
-- the fare lock (it still runs once, on the first arrival), and Rule 16.6 (the driver ends the trip after the passenger's confirmation time).
-- A second "finish" while the trip has already arrived is not a status change: it does nothing, so the fare is never settled twice.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. THE NUMBERS (one place: dispatch_constant)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispatch_constant(p_key TEXT)
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE p_key
        WHEN 'offer_window_seconds'      THEN COALESCE((SELECT s.setting_value FROM public.dispatch_setting s WHERE s.setting_key = 'offer_window_seconds'), 15)
        WHEN 'tier3_max_seconds'         THEN COALESCE((SELECT s.setting_value FROM public.dispatch_setting s WHERE s.setting_key = 'tier3_max_seconds'), 300)
        WHEN 'offer_grace_seconds'       THEN 5      -- the phone needs a moment to receive an offer; the driver still gets the whole window
        WHEN 'tier1_radius_m'            THEN 600    -- spec s.4: Priority TODA geofence
        WHEN 'tier2_radius_m'            THEN 2000   -- spec s.5
        WHEN 'tier3_refresh_seconds'     THEN 30     -- spec s.6: pool refresh
        WHEN 'accepted_cancel_limit'     THEN 3      -- Rule 12.8: consecutive accepted drivers who cancel the same booking
        WHEN 'eta_speed_kmh'             THEN 20     -- the fixed travel speed the apps already use for an estimated arrival
        WHEN 'eta_winding_percent'       THEN 130    -- straight line x 1.3 (the apps' road estimate)
        WHEN 'passenger_cancel_grace_seconds' THEN 60   -- Rule 12.1
        WHEN 'driver_travel_threshold_m' THEN 50     -- Rules 12.3 / 12.4
        WHEN 'stall_warn_seconds'        THEN 120    -- Rule 8.2: no movement toward the pickup this long after accepting: warn the driver
        WHEN 'stall_cancel_seconds'      THEN 180    -- Rule 8.3: still not moving (3 minutes in all): cancelled on the driver's behalf and redispatched
        WHEN 'stall_min_movement_m'      THEN 20     -- Rules 8.2 / 8.3: less movement than this counts as not moving
        WHEN 'stall_en_route_seconds'    THEN 300    -- Rule 8.4: a driver who has moved but then stands still this long (approach phase) is stalled
        WHEN 'ongoing_reconcile_seconds' THEN 1800   -- Rule 9.5: an Ongoing trip silent this long goes to the TODA administrator for manual reconciliation
        WHEN 'unreachable_warn_seconds'  THEN 180    -- Rule 9.2: no location from an accepted driver this long: Driver Unreachable, passenger told
        WHEN 'unreachable_cancel_seconds' THEN 300   -- Rule 9.3: five minutes in all: cancelled, provisional strike, redispatched
        WHEN 'no_show_wait_seconds'      THEN 300    -- Rule 10.1: the passenger has this long after the driver arrived
        WHEN 'no_show_extension_seconds' THEN 120    -- Rule 10.3: "I'm Almost There", once: 2 more minutes (7 in all)
        WHEN 'zone_max_accuracy_m'       THEN 50     -- PI-06: a fix less accurate than this is ignored when asking "is the driver at the pickup?"
        WHEN 'no_show_radius_m'          THEN 15     -- Rule 10.1: the driver must be this close to the pickup to report a no-show (figure F8.3; 15 m allows for GPS error)
        WHEN 'completion_confirm_timeout_seconds' THEN 120   -- Rule 16.6: the passenger's confirmation prompt; then the driver may end the trip
        WHEN 'repeat_cancel_flag_count'  THEN 3      -- Rules 12.7 / 12.9: cancellations in the window that raise a review flag (no strike)
        WHEN 'repeat_cancel_window_hours' THEN 24
        WHEN 'decline_flag_count'        THEN 5      -- Rule 7.9 pattern flag (review only, no strike); pilot value
        WHEN 'decline_flag_window_hours' THEN 24
        WHEN 'sweep_batch_limit'         THEN 50     -- bookings advanced per sweep call
        WHEN 'trip_finish_min_progress_pct'     THEN 90    -- the driver may finish the trip from this progress up (the destination pin can sit inside a building the tricycle cannot enter)
        WHEN 'trip_progress_near_destination_m' THEN 80    -- within this distance of the destination pin the progress reads its maximum
        WHEN 'trip_progress_cap_pct'            THEN 95    -- progress while the passenger is on board never reads more than this (100 belongs to a trip that has arrived)
        WHEN 'trip_progress_floor_pct'          THEN 5     -- ... and never less than this
        ELSE NULL
    END;
$$;

-- ----------------------------------------------------------------------------
-- 2. THE PROGRESS (the apps' formula, so the percentage on screen is the percentage enforced here)
-- ----------------------------------------------------------------------------
-- The apps measure a straight line with locationUtils.calculateDistanceKm: kilometres per degree 110.574 (north) and 108.29 (east, at
-- Calapan's latitude), rounded to 10 m. The same arithmetic here, not a haversine, so that the two never disagree at the 90% boundary.
CREATE OR REPLACE FUNCTION public._trip_progress_km(
    p_lat1 DOUBLE PRECISION, p_lng1 DOUBLE PRECISION, p_lat2 DOUBLE PRECISION, p_lng2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT (round((sqrt(power((p_lat2 - p_lat1) * 110.574, 2) + power((p_lng2 - p_lng1) * 108.29, 2)) * 100)::NUMERIC) / 100.0)::DOUBLE PRECISION;
$$;

-- The highest progress (whole percent, floor..cap) the trip has reached, from the driver's published fixes logged while the passenger was on
-- board. NULL when there is no usable fix yet (nothing is guessed). The fix accuracy limit is the one a heartbeat already needs to publish.
CREATE OR REPLACE FUNCTION public._trip_progress_pct(p_booking_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    b public.booking;
    v_total DOUBLE PRECISION;
    v_near DOUBLE PRECISION := public.dispatch_constant('trip_progress_near_destination_m') / 1000.0;
    v_cap INTEGER := public.dispatch_constant('trip_progress_cap_pct');
    v_floor INTEGER := public.dispatch_constant('trip_progress_floor_pct');
    v_max_acc INTEGER := public.driver_presence_constant('location_max_accuracy_m');
    v_best INTEGER;
BEGIN
    SELECT * INTO b FROM public.booking WHERE booking_id = p_booking_id;
    IF NOT FOUND OR b.pickup_latitude IS NULL OR b.pickup_longitude IS NULL OR b.dropoff_latitude IS NULL OR b.dropoff_longitude IS NULL THEN
        RETURN NULL;
    END IF;
    v_total := public._trip_progress_km(b.pickup_latitude, b.pickup_longitude, b.dropoff_latitude, b.dropoff_longitude);

    SELECT MAX(LEAST(v_cap,
               CASE
                   WHEN d.km <= v_near THEN v_cap
                   WHEN v_total > 0 THEN GREATEST(v_floor, round(((v_total - d.km) / v_total * 100.0)::NUMERIC)::INTEGER)
                   ELSE 50
               END))
      INTO v_best
      FROM (
            SELECT public._trip_progress_km(g.latitude, g.longitude, b.dropoff_latitude, b.dropoff_longitude) AS km
              FROM public.gps_log g
             WHERE g.booking_id = p_booking_id
               AND g.accuracy IS NOT NULL AND g.accuracy >= 0 AND g.accuracy <= v_max_acc
           ) d;
    RETURN v_best;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. WHAT THE SCREENS READ
-- ----------------------------------------------------------------------------
-- Either person on the booking may ask. Before the passenger is on board the progress is 0; once the trip has arrived it is 100.
CREATE OR REPLACE FUNCTION public.get_trip_progress(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_b public.booking;
    v_me_driver UUID := public.get_current_driver_id();
    v_me_pax UUID := public.get_current_passenger_id();
    v_phase TEXT;
    v_min INTEGER := public.dispatch_constant('trip_finish_min_progress_pct');
    v_pct INTEGER;
BEGIN
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id;
    IF NOT FOUND OR NOT ((v_me_driver IS NOT NULL AND v_b.driver_id = v_me_driver) OR (v_me_pax IS NOT NULL AND v_b.passenger_id = v_me_pax)) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_YOUR_BOOKING', 'error', 'This booking is not yours.');
    END IF;
    v_phase := public._booking_phase(v_b.booking_status);
    v_pct := CASE
        WHEN v_phase IN ('at_destination', 'completed') THEN 100
        WHEN v_phase = 'ongoing' THEN public._trip_progress_pct(p_booking_id)
        WHEN v_phase IN ('searching', 'assigned', 'arrived') THEN 0
        ELSE NULL
    END;
    RETURN jsonb_build_object(
        'success', TRUE, 'booking_status', v_b.booking_status, 'phase', v_phase,
        'progress_pct', v_pct, 'min_finish_pct', v_min,
        'can_finish', v_phase = 'ongoing' AND v_pct IS NOT NULL AND v_pct >= v_min);
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. THE GUARD
-- ----------------------------------------------------------------------------
-- Runs after booking_status_guard() (trigger names run in alphabetical order: "status" before "trip"), which has already decided that this
-- caller may make this move at all. Only the assigned driver's "Trip Ongoing" -> "Arrived at Destination" is checked here.
CREATE OR REPLACE FUNCTION public.booking_trip_progress_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_min INTEGER := public.dispatch_constant('trip_finish_min_progress_pct');
    v_pct INTEGER;
BEGIN
    IF public._booking_phase(OLD.booking_status) IS DISTINCT FROM 'ongoing'
       OR NEW.booking_status IS DISTINCT FROM 'Arrived at Destination'
       OR COALESCE(public.is_trusted_session(), FALSE)
       OR COALESCE(public.is_lgu_admin(), FALSE)
       OR OLD.driver_id IS NULL OR OLD.driver_id IS DISTINCT FROM public.get_current_driver_id() THEN
        RETURN NEW;
    END IF;

    v_pct := public._trip_progress_pct(OLD.booking_id);
    IF v_pct IS NULL THEN
        RAISE EXCEPTION 'ERR_TRIP_POSITION_UNKNOWN: Wala pang naitalang lokasyon ng biyahe. Siguraduhing bukas ang Location at subukang muli. (Your position on this trip has not been recorded yet. Keep Location on and try again in a few seconds.)' USING ERRCODE = 'P0001';
    ELSIF v_pct < v_min THEN
        RAISE EXCEPTION 'ERR_TRIP_NOT_FAR_ENOUGH: Malayo pa sa destinasyon (% ng biyahe). Maaaring tapusin ang biyahe mula % ng biyahe. (You can finish the trip once it is at least % complete; it is at % now.)', v_pct || '%', v_min || '%', v_min || '%', v_pct || '%' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_booking_trip_progress_guard ON public.booking;
CREATE TRIGGER trigger_booking_trip_progress_guard BEFORE UPDATE OF booking_status ON public.booking
    FOR EACH ROW WHEN (NEW.booking_status = 'Arrived at Destination' AND OLD.booking_status IS DISTINCT FROM NEW.booking_status)
    EXECUTE FUNCTION public.booking_trip_progress_guard();

-- ----------------------------------------------------------------------------
-- 5. PRIVILEGES
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._trip_progress_km(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._trip_progress_pct(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.booking_trip_progress_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_trip_progress(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_trip_progress(UUID) TO authenticated, service_role;

DO $$
BEGIN
    IF public.dispatch_constant('trip_finish_min_progress_pct') <> 90 OR public.dispatch_constant('trip_progress_near_destination_m') <> 80
       OR public.dispatch_constant('trip_progress_cap_pct') <> 95 OR public.dispatch_constant('trip_progress_floor_pct') <> 5 THEN
        RAISE EXCEPTION 'dispatch_constant() does not return the trip progress values';
    END IF;
    IF public.dispatch_constant('offer_window_seconds') <> 15 OR public.dispatch_constant('completion_confirm_timeout_seconds') <> 120 THEN
        RAISE EXCEPTION 'dispatch_constant() lost an existing value';
    END IF;
END $$;
