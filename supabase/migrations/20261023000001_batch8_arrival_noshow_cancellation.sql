-- ============================================================================
-- Migration: 20261023000001_batch8_arrival_noshow_cancellation.sql
-- Batch 8: driver arrival, the passenger no-show, passenger verification, every cancellation rule and the pickup change
-- (Rules 10, 11, 12, 29.8, 29.9).
--
-- What the audit found (Phase A, 2026-10-12) and what this file changes:
--
--   Rule 10.1 / PI-06   "at the pickup" had three meanings and the Arrived tap had none: a driver could tap Arrived from anywhere and the
--                       5-minute clock ran while he was still driving. ONE zone now serves 8.5, the Arrived tap and the No-Show: a fix at
--                       most 45 s old, accuracy at most 30 m, plain distance at most 25 m (no credit for the fix's own error). The
--                       status guard refuses Arrived from outside it (ERR_NOT_AT_PICKUP) whichever screen sends it.
--   Rule 10.2           the passenger's wait is PAUSED while the driver is outside the tolerance band (more than 25 + 5 m, or more than
--                       25 m for more than 15 s): wait_zone_left_at / wait_sampled_at / wait_paused_seconds, sampled by the 5-second sweep.
--                       The No-Show stays blocked while he is outside.
--   Rule 11.1 - 11.4    drivers see the passenger's FIRST NAME only (passenger_first_name); the trip cannot start before the driver has
--                       confirmed it (driver_confirm_passenger -> boarding_verified_at, enforced by the status guard).
--   Rules 12.1 - 12.6   ONE decision function (_cancellation_decision) for every cancellation: who is struck, with which code, whether the
--                       strike is provisional, whether the booking is redispatched with priority. The passenger trigger, the driver's
--                       cancellation and the No-Show all ask it. "Arrived" is the phase OR the driver being inside the zone (29.8); the
--                       progress toward the pickup is net progress minus the error of BOTH fixes (accept_accuracy_m); a Vehicle Breakdown
--                       strike is provisional (the TODA Administrator may waive it within 48 hours).
--   Rule 12.4 / PI-02   booking.redispatch_priority_at: an en-route cancellation marks the booking, dispatch_sweep serves marked bookings
--                       first, the marker is cleared when the booking is accepted or ends. The one deliberate exception to "no priority".
--   Rules 12.7 / 12.9   two counters (rolling 24 h): 12.7 counts every confirmed cancellation, 12.9 only those since the last completed trip.
--   Rule 12.5           a cancelling party of a Matched shared trip is evaluated alone; the match is closed, so the remaining booking is
--                       billed the Solo (Maximum Unmatched) fare it already accepted, without any new confirmation.
--   Rule 29.9           passenger_update_pickup(): the pickup may change only while the booking is still searching; it re-quotes, checks
--                       the service area, withdraws the offers and starts a new search cycle. After acceptance it is refused.
--
-- Replaces (CREATE OR REPLACE; the earlier files are NOT edited): dispatch_constant, booking_identity_guard, booking_status_guard,
-- booking_timers_sweep, _dispatch_redispatch, accept_booking_offer, dispatch_sweep, get_my_pending_offer, get_booking_counterparties,
-- strike_on_passenger_cancellation, driver_cancel_booking, _driver_within_pickup_zone, get_arrival_wait_status, passenger_extend_wait,
-- driver_report_no_show.
-- ASCII only (a character outside ASCII is written as a Unicode escape or chr()): a hand-applied file cannot be re-encoded.
-- Forward-only. Safe to run twice.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. WHAT THE BOOKING REMEMBERS (system columns: the people on the booking cannot write them, see booking_identity_guard)
-- ----------------------------------------------------------------------------
ALTER TABLE public.booking
    ADD COLUMN IF NOT EXISTS accept_accuracy_m      DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS wait_zone_left_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS wait_sampled_at        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS wait_paused_seconds    DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS redispatch_priority_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS boarding_verified_at   TIMESTAMPTZ;
COMMENT ON COLUMN public.booking.accept_accuracy_m IS 'Rules 12.3 / 12.4 / 29.8: the reported accuracy (m) of the driver''s fix at acceptance (accept_latitude / accept_longitude). System only.';
COMMENT ON COLUMN public.booking.wait_zone_left_at IS 'Rule 10.2: when the driver was first seen outside the pickup zone since he arrived (NULL while he is inside). System only.';
COMMENT ON COLUMN public.booking.wait_sampled_at IS 'Rule 10.2: the last time the sweep counted pause time for this booking. System only.';
COMMENT ON COLUMN public.booking.wait_paused_seconds IS 'Rule 10.2: seconds of the passenger''s wait that did not count because the driver was outside the tolerance band. System only.';
COMMENT ON COLUMN public.booking.redispatch_priority_at IS 'Rule 12.4 / PI-02: set when an en-route driver cancels; dispatch_sweep serves marked bookings first. Cleared when the booking is accepted or ends. System only.';
COMMENT ON COLUMN public.booking.boarding_verified_at IS 'Rule 11.1: when the driver confirmed the passenger''s first name against the booking; the trip cannot start before. Set by driver_confirm_passenger() only.';


-- ----------------------------------------------------------------------------
-- 2. THE NUMBERS (dispatch_constant: every key of 20261021000001; the zone is now 25 m / 30 m, plus the Rule 10.2 tolerance)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispatch_constant(p_key TEXT)
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE p_key
        WHEN 'offer_window_seconds'      THEN COALESCE((SELECT s.setting_value FROM public.dispatch_setting s WHERE s.setting_key = 'offer_window_seconds'), public.dispatch_setting_default('offer_window_seconds'))
        WHEN 'tier3_max_seconds'         THEN COALESCE((SELECT s.setting_value FROM public.dispatch_setting s WHERE s.setting_key = 'tier3_max_seconds'), public.dispatch_setting_default('tier3_max_seconds'))
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
        WHEN 'zone_max_accuracy_m'       THEN 30     -- PI-06 / D8-ZONE (F8.3): a fix less accurate than this is ignored when asking "is the driver at the pickup?"
        WHEN 'no_show_radius_m'          THEN 25     -- PI-06 / D8-ZONE (F8.3): ONE pickup zone for Rules 8.5, 10.1 and the Arrived tap: plain distance, the fix's own error earns no credit
        WHEN 'arrival_zone_tolerance_m'       THEN 5     -- Rule 10.2: the driver may be this far beyond the zone ...
        WHEN 'arrival_zone_tolerance_seconds' THEN 15    -- ... for this long (and up to the radius for this long) without pausing the passenger's wait
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
        -- Phase B of Batch 6 (2026-10-11)
        WHEN 'retry_max_age_minutes'     THEN 60     -- D-4: a No Driver Found booking older than this cannot be retried (the pickup is probably not where the passenger is)
        WHEN 'coverage_gap_count'        THEN 5      -- Rule 7.10 / PI-11 = A, figure F6.9: bookings of one zone reaching Tier 3 or ending as No Driver Found ...
        WHEN 'coverage_gap_window_hours' THEN 24     -- ... within this many hours are logged as a Coverage Gap Indicator (analysis only)
        WHEN 'decline_history_days'      THEN 30     -- Rule 7.9: how far back the TODA administrator's decline history reads by default
        WHEN 'osrm_timeout_ms'           THEN 2000   -- D-1 / F6.10: one request to the routing engine may take this long
        WHEN 'osrm_cache_seconds'        THEN 15     -- F6.10: an ETA from the routing engine is reused this long
        WHEN 'osrm_failure_limit'        THEN 3      -- F6.10: this many failed requests in a row open the circuit breaker ...
        WHEN 'osrm_breaker_seconds'      THEN 60     -- ... and the routing engine is not asked for this long (the labelled straight-line estimate is used)
        WHEN 'osrm_max_candidates'       THEN 15     -- the nearest candidates (straight line) of a tier that are ranked by the routing engine in one request
        WHEN 'osrm_calls_per_transaction' THEN 2     -- one ranking may make at most this many requests (the primary and one retry on the second server)
        WHEN 'cron_log_retention_days'   THEN 2      -- the daily housekeeping job keeps this many days of pg_cron run details and OSRM cache rows
        -- Batch 7 (2026-10-12)
        WHEN 'stall_en_route_warn_seconds' THEN 240  -- Rule 8.4, decision D7-7: the driver who stands still on the way is warned this long into the stand-still (1 minute before the cancellation), with the Rule 8.2 text
        WHEN 'gps_area_cell_millidegrees' THEN 5     -- Rule 17.5: determinations are grouped into squares of this many thousandths of a degree (0.005 degrees, about 550 m)
        WHEN 'gps_area_flag_count'       THEN 3      -- Rule 17.5: determinations of one square within the window that are worth reporting (the policy says "repeatedly"; provisional pilot value)
        WHEN 'gps_area_window_days'      THEN 30     -- Rule 17.5: how far back the determinations are counted
        ELSE NULL
    END;
$$;


-- ----------------------------------------------------------------------------
-- 3. ONE ZONE: "is the driver at the pickup?" (Rules 8.5, 10.1, 10.2, the Arrived tap; decision PI-06 = A, D8-ZONE)
-- ----------------------------------------------------------------------------
-- A fix counts only if it is fresh (location_max_age_seconds, 45 s) and its reported accuracy is good enough (zone_max_accuracy_m, 30 m).
-- The driver is "at the pickup" when that fix is within no_show_radius_m (25 m) of it: plain distance, the fix's own error earns no credit
-- (a fix with 30 m of error 60 m away used to pass). A fix that is not good enough is ignored, never guessed at: no distance, no zone.
CREATE OR REPLACE FUNCTION public._driver_pickup_distance_m(p_driver_id UUID, p_booking_id UUID)
RETURNS DOUBLE PRECISION
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT CASE
        WHEN d.current_latitude IS NOT NULL AND d.current_longitude IS NOT NULL
             AND d.last_location_update >= clock_timestamp() - make_interval(secs => public.driver_presence_constant('location_max_age_seconds'))
             AND d.last_location_accuracy_m IS NOT NULL
             AND d.last_location_accuracy_m <= public.dispatch_constant('zone_max_accuracy_m')
        THEN public.calculate_haversine_distance_km(d.current_latitude, d.current_longitude, b.pickup_latitude, b.pickup_longitude) * 1000.0
    END
      FROM public.driver d, public.booking b
     WHERE d.driver_id = p_driver_id AND b.booking_id = p_booking_id;
$$;

CREATE OR REPLACE FUNCTION public._driver_within_pickup_zone(p_driver_id UUID, p_booking_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(public._driver_pickup_distance_m(p_driver_id, p_booking_id) <= public.dispatch_constant('no_show_radius_m'), FALSE);
$$;

-- ----------------------------------------------------------------------------
-- 4. HOW FAR TOWARD THE PICKUP HAS THE DRIVER COME SINCE ACCEPTING? (Rules 12.3, 12.4, 29.8; figure F8.5)
-- ----------------------------------------------------------------------------
-- Net progress by GPS, never by taps: how much closer to the pickup the driver's newest fix is than the fix he accepted from, less the
-- reported error of BOTH fixes (the same dead-band the stall and the fare rules use: two fixes whose error circles overlap prove nothing).
-- A driver who drove away and came back, or turned around (the 29.8 U-turn), has made the progress he really made. NULL = nothing can be said
-- (no acceptance fix, or no fix fresh and accurate enough): the caller treats that as no progress (the lesser strike).
CREATE OR REPLACE FUNCTION public._driver_progress_toward_pickup_m(p_b public.booking)
RETURNS DOUBLE PRECISION
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_d public.driver;
    v_start_m DOUBLE PRECISION;
    v_now_m DOUBLE PRECISION;
BEGIN
    IF p_b.driver_id IS NULL OR p_b.accept_latitude IS NULL OR p_b.accept_longitude IS NULL
       OR NOT public.driver_has_fresh_location(p_b.driver_id) THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_d FROM public.driver WHERE driver_id = p_b.driver_id;
    v_start_m := public.calculate_haversine_distance_km(p_b.accept_latitude, p_b.accept_longitude, p_b.pickup_latitude, p_b.pickup_longitude) * 1000.0;
    v_now_m := public.calculate_haversine_distance_km(v_d.current_latitude, v_d.current_longitude, p_b.pickup_latitude, p_b.pickup_longitude) * 1000.0;
    RETURN GREATEST(0, (v_start_m - v_now_m) - COALESCE(p_b.accept_accuracy_m, 0) - COALESCE(v_d.last_location_accuracy_m, 0));
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. THE PASSENGER'S WAIT STOPS COUNTING WHILE THE DRIVER IS AWAY (Rule 10.2; decision D8-X1 = Pause)
-- ----------------------------------------------------------------------------
-- Called by the 5-second sweep for a booking whose driver has arrived. Inside the zone nothing is written. The first sample outside the zone
-- opens an excursion (wait_zone_left_at). From then on, every sampled interval is added to wait_paused_seconds when the driver is MORE than
-- tolerance metres beyond the radius (25 + 5 m), or when the excursion has already lasted more than the tolerance time (15 s): up to 5 m
-- and 15 s outside is the tolerance of Rule 10.2 and costs the passenger nothing. A sample without a usable fix changes nothing. The
-- deadline of the wait (arrived_at + 5 min + the extension) moves back by wait_paused_seconds, and No-Show stays blocked while the driver
-- is outside the zone (driver_report_no_show). The caller holds the booking's lock and the internal context.
CREATE OR REPLACE FUNCTION public._booking_wait_track(p_b public.booking, p_now TIMESTAMPTZ)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_dist DOUBLE PRECISION := public._driver_pickup_distance_m(p_b.driver_id, p_b.booking_id);
    v_radius INTEGER := public.dispatch_constant('no_show_radius_m');
    v_tol_m INTEGER := public.dispatch_constant('arrival_zone_tolerance_m');
    v_tol_s INTEGER := public.dispatch_constant('arrival_zone_tolerance_seconds');
    v_dt DOUBLE PRECISION;
    v_age DOUBLE PRECISION;
    v_paused DOUBLE PRECISION := p_b.wait_paused_seconds;
BEGIN
    IF v_dist IS NULL THEN
        RETURN;                                            -- no usable fix: nothing is judged on a guess
    END IF;
    IF v_dist <= v_radius THEN
        IF p_b.wait_zone_left_at IS NOT NULL THEN          -- he is back: the excursion is over
            UPDATE public.booking SET wait_zone_left_at = NULL, wait_sampled_at = p_now WHERE booking_id = p_b.booking_id;
        END IF;
        RETURN;
    END IF;
    IF p_b.wait_zone_left_at IS NULL THEN                  -- the excursion begins: nothing is counted for this sample
        UPDATE public.booking SET wait_zone_left_at = p_now, wait_sampled_at = p_now WHERE booking_id = p_b.booking_id;
        RETURN;
    END IF;
    v_dt := GREATEST(0, EXTRACT(EPOCH FROM (p_now - COALESCE(p_b.wait_sampled_at, p_b.wait_zone_left_at))));
    v_age := EXTRACT(EPOCH FROM (p_now - p_b.wait_zone_left_at));
    IF v_dist > v_radius + v_tol_m THEN
        v_paused := v_paused + v_dt;                       -- beyond the tolerance band: none of this time counts
    ELSIF v_age > v_tol_s THEN
        v_paused := v_paused + LEAST(v_dt, v_age - v_tol_s);   -- inside the band but for longer than the tolerance time: only the part beyond it
    END IF;
    UPDATE public.booking SET wait_paused_seconds = v_paused, wait_sampled_at = p_now WHERE booking_id = p_b.booking_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. THE FIRST NAME (Rule 11.1; decision D8-X10 = A)
-- ----------------------------------------------------------------------------
-- What the driver sees of the passenger before boarding. The passenger table keeps one full_name, so the first name is read out of it: the
-- first word, skipping a title ("Mr.", "Dr."), keeping "Ma." with the word after it ("Ma. Cristina"), and reading "Dela Cruz, Juan" as Juan.
-- It is a display aid for the driver's check, not an identity document.
CREATE OR REPLACE FUNCTION public.passenger_first_name(p_full_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_name TEXT := btrim(regexp_replace(COALESCE(p_full_name, ''), '\s+', ' ', 'g'));
    v_tokens TEXT[];
    v_i INTEGER := 1;
    v_first TEXT;
BEGIN
    IF v_name = '' THEN
        RETURN 'Passenger';
    END IF;
    IF position(',' IN v_name) > 0 THEN
        v_name := btrim(substr(v_name, position(',' IN v_name) + 1));
        IF v_name = '' THEN
            RETURN 'Passenger';
        END IF;
    END IF;
    v_tokens := string_to_array(v_name, ' ');
    WHILE v_i < array_length(v_tokens, 1)
          AND lower(regexp_replace(v_tokens[v_i], '\.$', '')) IN ('mr', 'mrs', 'ms', 'miss', 'sir', 'dr', 'engr', 'atty', 'prof', 'hon') LOOP
        v_i := v_i + 1;
    END LOOP;
    v_first := v_tokens[v_i];
    IF lower(regexp_replace(v_first, '\.$', '')) = 'ma' AND v_i < array_length(v_tokens, 1) THEN
        v_first := v_first || ' ' || v_tokens[v_i + 1];
    END IF;
    RETURN v_first;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. THE REVIEW FLAGS OF REPEATED CANCELLATIONS: TWO COUNTERS (Rules 12.7 and 12.9; decision X3)
-- ----------------------------------------------------------------------------
-- A review flag only, never a strike, over a rolling window (repeat_cancel_window_hours, 24).
--   Rule 12.7  a driver or a passenger who cancels repeat_cancel_flag_count (3) or more CONFIRMED bookings in the window, whatever the reasons
--              and whatever happened in between. Driver: his cancellation strikes. Passenger: the bookings he cancelled himself (a No Driver
--              Found booking, a cycle the system ended and every system cancellation are not his cancellations).
--   Rule 12.9  a passenger whose cancellations in the window have no completed trip between them (the count restarts after his last
--              completed trip): possible booking abuse. The LGU Administrator decides: confirm PAX_BOOKING_ABUSE (2 strikes) and / or
--              suspend with admin_suspend_account (audited). Nothing is restricted automatically (decision PI-09 g).
CREATE OR REPLACE FUNCTION public._check_repeat_cancellations(p_subject_type TEXT, p_subject_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_limit INTEGER := public.dispatch_constant('repeat_cancel_flag_count');
    v_hours INTEGER := public.dispatch_constant('repeat_cancel_window_hours');
    v_start TIMESTAMPTZ := clock_timestamp() - make_interval(hours => public.dispatch_constant('repeat_cancel_window_hours'));
    v_n INTEGER;
    v_last_done TIMESTAMPTZ;
BEGIN
    IF p_subject_type = 'driver' THEN
        SELECT count(*) INTO v_n FROM public.strikes_ledger s
         WHERE s.subject_type = 'driver' AND s.subject_id = p_subject_id
           AND s.violation_code IN ('DRV_CANCEL_EN_ROUTE', 'DRV_CANCEL_BEFORE_TRAVEL')
           AND s.status <> 'VOIDED' AND s.issued_at > v_start;
        IF v_n >= v_limit THEN
            PERFORM public._presence_flag('DRIVER_REPEATED_CANCELLATIONS', p_subject_id, 'Rule 12.7',
                jsonb_build_object('cancellations_in_window', v_n, 'window_hours', v_hours));
        END IF;
        RETURN;
    END IF;

    SELECT count(*) INTO v_n FROM public.booking b
     WHERE b.passenger_id = p_subject_id AND b.booking_status = 'Cancelled' AND b.cancelled_by = 'passenger'
       AND b.dispatch_ended_reason IS DISTINCT FROM 'no_driver_found'
       AND b.dispatch_ended_reason IS DISTINCT FROM 'accepted_drivers_cancelled'
       AND b.cancelled_at > v_start;
    IF v_n >= v_limit THEN
        PERFORM public.create_admin_review_flag('PASSENGER_REPEATED_CANCELLATIONS', 'passenger', p_subject_id::TEXT, 'Rule 12.7', 'lgu_admin',
            jsonb_build_object('cancelled_bookings_in_window', v_n, 'window_hours', v_hours,
                'note', 'Review flag only (Rule 12.7): three or more confirmed bookings cancelled in 24 hours, whatever the reasons.'));
    END IF;

    SELECT max(b.trip_completed_at) INTO v_last_done FROM public.booking b
     WHERE b.passenger_id = p_subject_id AND b.booking_status = 'Completed';
    SELECT count(*) INTO v_n FROM public.booking b
     WHERE b.passenger_id = p_subject_id AND b.booking_status = 'Cancelled' AND b.cancelled_by = 'passenger'
       AND b.dispatch_ended_reason IS DISTINCT FROM 'no_driver_found'
       AND b.dispatch_ended_reason IS DISTINCT FROM 'accepted_drivers_cancelled'
       AND b.cancelled_at > GREATEST(v_start, COALESCE(v_last_done, '-infinity'::TIMESTAMPTZ));
    IF v_n >= v_limit THEN
        PERFORM public.create_admin_review_flag('PASSENGER_BOOKING_ABUSE_REVIEW', 'passenger', p_subject_id::TEXT, 'Rules 12.7 / 12.9', 'lgu_admin',
            jsonb_build_object('cancelled_bookings_in_window', v_n, 'window_hours', v_hours,
                'note', 'Review flag only (Rule 12.9). The LGU Administrator may confirm PAX_BOOKING_ABUSE (2 strikes) and / or suspend the account (admin_suspend_account); nothing is restricted automatically.'));
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. THE ONE DECISION FUNCTION for every cancellation (Rules 10.4, 12.1 - 12.6, 29.8; requirement B2)
-- ----------------------------------------------------------------------------
-- Pure: it reads the booking row it is given (the row AS IT WAS before the cancellation) and the driver's newest fix, and answers what the policy
-- says: who is struck (and with which code), whether the strike is provisional, whether the booking goes back to the search, whether it goes
-- back with priority, whether a repeat is flagged. The callers carry it out through the one strike entry point (issue_strike) and the one
-- redispatch entry point (_dispatch_redispatch). Nothing about the rules is decided anywhere else.
--   actor 'passenger'  12.1 / 12.2: no strike before acceptance or within the grace minute while the driver has not arrived; one strike after
--                      that or once the driver has arrived. "Arrived" = the phase OR the driver inside the pickup zone on a good fix (29.8: GPS,
--                      not taps). No strike while the driver is unreachable (decision D7-6).
--   actor 'driver'     12.3 / 12.4 / 29.8: net progress toward the pickup below 50 m: 1 strike; 50 m or more: 2 strikes, a flag when it is not
--                      the first, redispatched with priority. A Vehicle Breakdown strike is provisional (waivable within 48 h).
--   actor 'no_show'    10.4: the passenger gets 2 strikes, the driver the redispatch credit, the booking is not redispatched.
--   actor 'system'     12.6: never a passenger strike; the driver's strikes are the business of Sections 8 and 9.
CREATE OR REPLACE FUNCTION public._cancellation_decision(p_b public.booking, p_actor TEXT, p_reason_code TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_phase TEXT := public._booking_phase(p_b.booking_status);
    v_now TIMESTAMPTZ := clock_timestamp();
    v_arrived BOOLEAN;
    v_progress DOUBLE PRECISION;
    v_en_route BOOLEAN;
    v_prior INTEGER := 0;
BEGIN
    IF p_actor = 'passenger' THEN
        IF v_phase NOT IN ('assigned', 'arrived') THEN
            RETURN jsonb_build_object('actor', p_actor, 'rule', 'Rule 12.1', 'strike_subject', NULL, 'waived_reason', 'before_acceptance');
        END IF;
        v_arrived := v_phase = 'arrived' OR public._driver_within_pickup_zone(p_b.driver_id, p_b.booking_id);
        IF p_b.driver_unreachable_since IS NOT NULL THEN
            RETURN jsonb_build_object('actor', p_actor, 'rule', 'Rule 9.2 / D7-6', 'strike_subject', NULL, 'waived_reason', 'driver_unreachable',
                                      'arrived_by_gps', v_arrived);
        END IF;
        IF NOT v_arrived AND p_b.accepted_at IS NOT NULL
           AND v_now <= p_b.accepted_at + make_interval(secs => public.dispatch_constant('passenger_cancel_grace_seconds')) THEN
            RETURN jsonb_build_object('actor', p_actor, 'rule', 'Rule 12.1', 'strike_subject', NULL, 'waived_reason', 'grace', 'arrived_by_gps', v_arrived);
        END IF;
        RETURN jsonb_build_object('actor', p_actor, 'rule', 'Rule 12.2', 'strike_subject', 'passenger', 'violation_code', 'PAX_LATE_CANCEL',
                                  'provisional', FALSE, 'arrived_by_gps', v_arrived, 'redispatch', FALSE, 'priority', FALSE);
    ELSIF p_actor = 'driver' THEN
        v_progress := public._driver_progress_toward_pickup_m(p_b);
        v_en_route := COALESCE(v_progress, 0) >= public.dispatch_constant('driver_travel_threshold_m');
        IF v_en_route THEN
            SELECT count(*) INTO v_prior FROM public.strikes_ledger
             WHERE subject_type = 'driver' AND subject_id = p_b.driver_id AND violation_code = 'DRV_CANCEL_EN_ROUTE' AND status <> 'VOIDED';
        END IF;
        RETURN jsonb_build_object('actor', p_actor, 'rule', CASE WHEN v_en_route THEN 'Rule 12.4' ELSE 'Rule 12.3' END,
                                  'strike_subject', 'driver',
                                  'violation_code', CASE WHEN v_en_route THEN 'DRV_CANCEL_EN_ROUTE' ELSE 'DRV_CANCEL_BEFORE_TRAVEL' END,
                                  'provisional', COALESCE(p_reason_code = 'vehicle_breakdown', FALSE),
                                  'en_route', v_en_route, 'progress_m', v_progress,
                                  'redispatch', TRUE, 'priority', v_en_route, 'flag_on_repeat', v_en_route AND v_prior > 0);
    ELSIF p_actor = 'no_show' THEN
        RETURN jsonb_build_object('actor', p_actor, 'rule', 'Rule 10.4', 'strike_subject', 'passenger', 'violation_code', 'PAX_NO_SHOW',
                                  'provisional', FALSE, 'redispatch', FALSE, 'priority', FALSE, 'driver_credit', TRUE);
    ELSIF p_actor = 'system' THEN
        RETURN jsonb_build_object('actor', p_actor, 'rule', 'Rule 12.6', 'strike_subject', NULL, 'redispatch', TRUE, 'priority', FALSE);
    END IF;
    RAISE EXCEPTION 'Unknown cancellation actor %', p_actor;
END;
$$;


-- ----------------------------------------------------------------------------
-- 9. THE PASSENGER'S CANCELLATION (Rules 12.1, 12.2, 12.6, 12.7, 12.9; replaces 20261021000001)
-- ----------------------------------------------------------------------------
-- The trigger no longer decides anything: it asks _cancellation_decision() about the booking AS IT WAS and carries the answer out through the
-- one strike entry point. Same key as before (PAX_LATE_CANCEL:<booking>), so a repeated run changes nothing.
CREATE OR REPLACE FUNCTION public.strike_on_passenger_cancellation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_dec JSONB;
BEGIN
    IF NEW.cancelled_by IS DISTINCT FROM 'passenger' OR NEW.passenger_id IS NULL OR OLD.booking_status = 'No Driver Found' THEN
        RETURN NEW;
    END IF;
    PERFORM set_config('sakay.internal_context', 'true', true);

    v_dec := public._cancellation_decision(OLD, 'passenger', NEW.cancellation_reason);
    IF v_dec->>'strike_subject' = 'passenger' THEN
        PERFORM public.issue_strike('passenger', NEW.passenger_id, v_dec->>'violation_code', NULL, NEW.booking_id, NULL,
            (v_dec->>'violation_code') || ':' || NEW.booking_id::TEXT, NULL,
            COALESCE(NEW.cancellation_reason, 'Cancelled after the driver accepted'), NULL,
            jsonb_build_object('rule', v_dec->>'rule', 'arrived_by_gps', v_dec->'arrived_by_gps'));
    ELSIF v_dec->>'waived_reason' = 'driver_unreachable' THEN
        -- Rule 9.2 / decision D7-6: the passenger is leaving a driver who cannot be reached; that is not a late cancellation
        PERFORM public.record_policy_audit('PASSENGER_CANCEL_NO_STRIKE_DRIVER_UNREACHABLE', NEW.booking_id::TEXT, NULL, 'Dispatch',
            'The passenger cancelled while the driver was unreachable; no late-cancellation strike was issued.', NULL,
            jsonb_build_object('booking_id', NEW.booking_id, 'passenger_id', NEW.passenger_id, 'driver_unreachable_since', OLD.driver_unreachable_since));
    END IF;

    PERFORM public._check_repeat_cancellations('passenger', NEW.passenger_id);
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. A SHARED-TRIP PARTY CANCELS BEFORE PICKUP (Rule 12.5; decision X12)
-- ----------------------------------------------------------------------------
-- Only the cancelling party is evaluated (the trigger above reads that booking alone). The Matched pairing is closed, so the fare guard no
-- longer finds a match for the remaining booking and bills it the Solo (Maximum Unmatched) fare, which the passenger acknowledged and accepted
-- when booking: there is no new fare confirmation. The remaining passenger is told. Re-pairing and what the driver does with the remaining
-- booking belong to the ride-sharing batch (Rule 6.5 / 14); this is only the cancellation's part.
CREATE OR REPLACE FUNCTION public.booking_shared_partner_on_cancel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_m public.shared_trip_match;
    v_partner public.booking;
    v_partner_id UUID;
    v_prev TEXT := current_setting('sakay.internal_context', true);
BEGIN
    IF public._booking_phase(OLD.booking_status) NOT IN ('searching', 'assigned', 'arrived') THEN
        RETURN NULL;                                          -- after the pickup a party cannot cancel; only before it (Rule 12.5)
    END IF;
    SELECT * INTO v_m FROM public.shared_trip_match
     WHERE match_status = 'Matched' AND (primary_booking_id = NEW.booking_id OR additional_booking_id = NEW.booking_id)
     ORDER BY matched_at DESC NULLS LAST LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    v_partner_id := CASE WHEN v_m.primary_booking_id = NEW.booking_id THEN v_m.additional_booking_id ELSE v_m.primary_booking_id END;

    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.shared_trip_match SET match_status = 'Cancelled' WHERE match_id = v_m.match_id;
    IF v_partner_id IS NOT NULL THEN
        SELECT * INTO v_partner FROM public.booking WHERE booking_id = v_partner_id;
        IF FOUND AND v_partner.passenger_id IS NOT NULL AND v_partner.booking_status NOT IN ('Cancelled', 'Completed') THEN
            PERFORM public._notify_subject('passenger', v_partner.passenger_id, 'SHARED_PARTNER_CANCELLED',
                'Nakansela ang kasama mo sa shared trip (Your shared-trip partner cancelled)',
                'Your trip continues. Because no one is sharing it now, it is charged the Solo fare you accepted when you booked; you do not need to confirm anything. '
                || '(Tuloy ang biyahe mo. Dahil walang kasabay, ang Solo fare na pinayagan mo noong nag-book ka ang sisingilin; wala ka nang kailangang kumpirmahin.)',
                v_partner.booking_id::TEXT, 1);
        END IF;
    END IF;
    PERFORM public.record_policy_audit('SHARED_MATCH_CLOSED_ON_CANCEL', v_m.match_id::TEXT, NULL, 'Shared Trips',
        'One party of a matched shared trip cancelled before pickup (Rule 12.5); the match was closed and the remaining booking continues at the Solo (Maximum Unmatched) fare.', NULL,
        jsonb_build_object('match_id', v_m.match_id, 'cancelled_booking_id', NEW.booking_id, 'remaining_booking_id', v_partner_id));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trigger_booking_shared_partner_on_cancel ON public.booking;
CREATE TRIGGER trigger_booking_shared_partner_on_cancel AFTER UPDATE OF booking_status ON public.booking
    FOR EACH ROW WHEN (NEW.booking_status = 'Cancelled' AND OLD.booking_status IS DISTINCT FROM 'Cancelled' AND OLD.is_shared_trip)
    EXECUTE FUNCTION public.booking_shared_partner_on_cancel();

-- ----------------------------------------------------------------------------
-- 11. THE DRIVER'S CANCELLATION (Rules 12.3, 12.4, 12.7, 12.8, 15.1, 29.8; replaces 20261015000003)
-- ----------------------------------------------------------------------------
-- The ONLY way a driver gives a booking back after accepting it. The reason comes from a fixed list. _cancellation_decision() says what
-- the policy says: net GPS progress toward the pickup (minus the error of both fixes) below 50 m is 1 strike, 50 m or more is 2 strikes, a
-- flag when it is not the first, and the booking is redispatched WITH PRIORITY (redispatch_priority_at: dispatch_sweep serves it first, PI-02).
-- Having tapped Arrived no longer counts as having travelled (29.8): only the GPS does. A Vehicle Breakdown strike is PROVISIONAL: the
-- driver may ask the TODA Administrator to waive it within the exemption window (48 h). After three accepted drivers in a row the cycle ends
-- (12.8). Three cancellations in the window raise a review flag (12.7).
CREATE OR REPLACE FUNCTION public.driver_cancel_booking(p_booking_id UUID, p_reason_code TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_driver UUID := public.get_current_driver_id();
    v_b public.booking;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_phase TEXT;
    v_reason TEXT;
    v_dec JSONB;
    v_en_route BOOLEAN;
    v_code TEXT;
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

    v_reason := p_reason_code || CASE WHEN p_note IS NOT NULL AND length(btrim(p_note)) > 0 THEN ': ' || left(btrim(p_note), 300) ELSE '' END;
    v_dec := public._cancellation_decision(v_b, 'driver', p_reason_code);
    v_en_route := (v_dec->>'en_route')::BOOLEAN;
    v_code := v_dec->>'violation_code';

    PERFORM set_config('sakay.internal_context', 'true', true);
    PERFORM public.issue_strike('driver', v_driver, v_code, NULL, p_booking_id, NULL,
        'DRV_CANCEL:' || p_booking_id::TEXT || ':' || v_b.dispatch_cycle || ':' || (v_b.accepted_driver_cancel_count + 1),
        CASE WHEN (v_dec->>'provisional')::BOOLEAN THEN TRUE END, v_reason, NULL,
        jsonb_build_object('reason_code', p_reason_code, 'en_route', v_en_route, 'rule', v_dec->>'rule',
                           'progress_toward_pickup_m', CASE WHEN v_dec->>'progress_m' IS NOT NULL THEN round((v_dec->>'progress_m')::NUMERIC) END,
                           'provisional', (v_dec->>'provisional')::BOOLEAN));

    IF (v_dec->>'flag_on_repeat')::BOOLEAN THEN                           -- Rule 12.4: not the first instance
        PERFORM public._presence_flag('DRIVER_REPEATED_CANCELLATIONS', v_driver, 'Rule 12.4',
            jsonb_build_object('booking_id', p_booking_id, 'note', 'An en-route cancellation that is not the first (Rule 12.4).'));
    END IF;
    PERFORM public._check_repeat_cancellations('driver', v_driver);       -- Rule 12.7

    v_result := public._dispatch_redispatch(p_booking_id, v_driver, 'driver', v_reason);
    IF v_result = 'redispatched' AND (v_dec->>'priority')::BOOLEAN THEN
        -- Rule 12.4 / PI-02: the booking was delayed by a driver who had already set off; it is served first in the search (cleared when accepted or ended)
        UPDATE public.booking SET redispatch_priority_at = clock_timestamp() WHERE booking_id = p_booking_id;
        PERFORM public.record_policy_audit('BOOKING_REDISPATCH_PRIORITY', p_booking_id::TEXT, NULL, 'Dispatch',
            'The driver cancelled after travelling toward the pickup (Rule 12.4); the booking is redispatched with priority.', NULL,
            jsonb_build_object('booking_id', p_booking_id, 'driver_id', v_driver, 'progress_m', v_dec->'progress_m'));
    END IF;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);

    RETURN jsonb_build_object('success', TRUE, 'booking_id', p_booking_id, 'outcome', v_result,
                              'strike_code', v_code, 'en_route', v_en_route, 'priority', COALESCE((v_dec->>'priority')::BOOLEAN, FALSE) AND v_result = 'redispatched',
                              'provisional', COALESCE((v_dec->>'provisional')::BOOLEAN, FALSE));
END;
$$;


-- ----------------------------------------------------------------------------
-- 12. THE SYSTEM'S COLUMNS (replaces 20261021000001: the six new columns join the list the people on the booking cannot edit)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.booking_identity_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
        NEW.accept_accuracy_m := NULL;  NEW.wait_zone_left_at := NULL;  NEW.wait_sampled_at := NULL;  NEW.wait_paused_seconds := 0;
        NEW.redispatch_priority_at := NULL;  NEW.boarding_verified_at := NULL;
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
       OR NEW.dispatch_ended_at IS DISTINCT FROM OLD.dispatch_ended_at
       OR NEW.priority_toda_id IS DISTINCT FROM OLD.priority_toda_id
       OR NEW.accepted_driver_cancel_count IS DISTINCT FROM OLD.accepted_driver_cancel_count
       OR NEW.accept_latitude IS DISTINCT FROM OLD.accept_latitude
       OR NEW.accept_longitude IS DISTINCT FROM OLD.accept_longitude
       OR NEW.stall_anchor_latitude IS DISTINCT FROM OLD.stall_anchor_latitude
       OR NEW.stall_anchor_longitude IS DISTINCT FROM OLD.stall_anchor_longitude
       OR NEW.stall_anchor_at IS DISTINCT FROM OLD.stall_anchor_at
       OR NEW.stall_anchor_accuracy_m IS DISTINCT FROM OLD.stall_anchor_accuracy_m
       OR NEW.stall_delay_reported_at IS DISTINCT FROM OLD.stall_delay_reported_at
       OR NEW.stall_delay_reports IS DISTINCT FROM OLD.stall_delay_reports
       OR NEW.stall_delay_reason IS DISTINCT FROM OLD.stall_delay_reason
       OR NEW.stall_warned_at IS DISTINCT FROM OLD.stall_warned_at
       OR NEW.driver_unreachable_since IS DISTINCT FROM OLD.driver_unreachable_since
       OR NEW.wait_extended_at IS DISTINCT FROM OLD.wait_extended_at
       OR NEW.accept_accuracy_m IS DISTINCT FROM OLD.accept_accuracy_m
       OR NEW.wait_zone_left_at IS DISTINCT FROM OLD.wait_zone_left_at
       OR NEW.wait_sampled_at IS DISTINCT FROM OLD.wait_sampled_at
       OR NEW.wait_paused_seconds IS DISTINCT FROM OLD.wait_paused_seconds
       OR NEW.redispatch_priority_at IS DISTINCT FROM OLD.redispatch_priority_at
       OR NEW.boarding_verified_at IS DISTINCT FROM OLD.boarding_verified_at
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
-- 13. THE STATUS GUARD (replaces 20261021000001): Arrived only at the pickup, no start before the first name is checked, the priority marker
-- ----------------------------------------------------------------------------
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
            v_allowed := (NEW.booking_status = 'Cancelled' AND v_old IN ('searching', 'assigned', 'arrived', 'no_driver'))
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
    -- Rule 12.4 / PI-02: the priority of a redispatched booking lasts only while it is searching (accepted, cancelled or ended clears it)
    IF v_new IS DISTINCT FROM 'searching' THEN
        NEW.redispatch_priority_at := NULL;
    END IF;
    RETURN NEW;
END;
$$;


-- ----------------------------------------------------------------------------
-- 14. THE ONE RE-ENTRY POINT (replaces 20261019000001: the next driver starts with a clean wait, a clean verification and no acceptance fix)
-- (redispatch_priority_at is NOT cleared here: the booking stays marked until a driver accepts it or it ends)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._dispatch_redispatch(p_booking_id UUID, p_driver_id UUID, p_cancelled_by TEXT, p_reason TEXT, p_notice TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_b public.booking;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_now TIMESTAMPTZ := clock_timestamp();
    v_count INTEGER;
    v_limit INTEGER := public.dispatch_constant('accepted_cancel_limit');
    v_result TEXT;
BEGIN
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_b.driver_id IS DISTINCT FROM p_driver_id OR NOT public._booking_is_open_accepted(v_b.booking_status)
       OR public._booking_trip_in_progress(v_b.booking_status) OR v_b.booking_status = 'Arrived at Destination' THEN
        RETURN 'not_redispatchable';
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    v_count := v_b.accepted_driver_cancel_count + 1;

    INSERT INTO public.cancellation_record (booking_id, cancelled_by, reason, redispatch_triggered, cancelled_at)
    VALUES (p_booking_id, p_cancelled_by, p_reason, v_count < v_limit, v_now);

    UPDATE public.booking
       SET driver_id = NULL,
           toda_id = NULL,                                  -- the next driver's TODA is stamped when they accept
           accepted_at = NULL,
           arrived_at = NULL,
           accept_latitude = NULL,
           accept_longitude = NULL,
           stall_anchor_latitude = NULL,
           stall_anchor_longitude = NULL,
           stall_anchor_at = NULL,
           stall_delay_reported_at = NULL,
           stall_delay_reports = 0,
           stall_warned_at = NULL,
           driver_unreachable_since = NULL,
           wait_extended_at = NULL,
           wait_zone_left_at = NULL, wait_sampled_at = NULL, wait_paused_seconds = 0, boarding_verified_at = NULL, accept_accuracy_m = NULL,
           accepted_driver_cancel_count = v_count,
           booking_status = CASE WHEN v_count >= v_limit THEN 'No Driver Found' ELSE 'Pending' END,
           dispatch_tier = CASE WHEN v_count >= v_limit THEN dispatch_tier ELSE 1 END,
           dispatch_tier_started_at = v_now,
           dispatch_pool_refreshed_at = NULL,
           dispatch_next_action_at = CASE WHEN v_count >= v_limit THEN NULL ELSE v_now END,
           dispatch_ended_reason = CASE WHEN v_count >= v_limit THEN 'accepted_drivers_cancelled' ELSE NULL END,
           dispatch_ended_at = CASE WHEN v_count >= v_limit THEN v_now ELSE NULL END
     WHERE booking_id = p_booking_id
     RETURNING * INTO v_b;

    IF v_count >= v_limit THEN
        PERFORM public._dispatch_notify_passenger(v_b, 'DISPATCH_TERMINATED',
            'Walang available na drayber sa ngayon (No driver available right now)',
            'No driver is currently able to take your booking. You can search again or book again without any penalty. '
            || '(Walang drayber na kasalukuyang makakasundo ng booking. Maaari kang mag-search muli nang walang parusa.)');
        PERFORM public.record_policy_audit('DISPATCH_CYCLE_TERMINATED', p_booking_id::TEXT, NULL, 'Dispatch',
            'Three accepted drivers in a row could not take the booking (Rule 12.8); the dispatch cycle ended.', NULL,
            jsonb_build_object('cycle', v_b.dispatch_cycle, 'accepted_driver_cancel_count', v_count, 'last_reason', p_reason));
        PERFORM public._dispatch_check_coverage_gap(p_booking_id);
        v_result := 'terminated';
    ELSE
        PERFORM public._dispatch_notify_passenger(v_b, 'DRIVER_CANCELLED_REDISPATCH',
            'Hindi nakapunta ang iyong drayber (Your driver could not proceed)',
            COALESCE(p_notice, 'Your driver was unable to proceed. We''re finding you another driver. '
            || '(Hindi nakapagpatuloy ang iyong drayber. Naghahanap kami ng ibang drayber.)'));
        PERFORM public._dispatch_advance(p_booking_id);
        v_result := 'redispatched';
    END IF;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN v_result;
END;
$$;


-- ----------------------------------------------------------------------------
-- 15. THE SWEEP FOR ACCEPTED BOOKINGS (replaces 20261021000001): the only change is the Rule 10.2 sampling of an arrived driver
-- (the em dash of the passenger's notice title is written as a Unicode escape: this file is ASCII only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.booking_timers_sweep()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    r RECORD;
    v_b public.booking;
    v_d public.driver;
    v_ev public.trip_connectivity_event;
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
    v_rows INTEGER;
    v_flag UUID;
    v_res TEXT;
BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtextextended('sakay.booking_timers', 0)) THEN
        RETURN 0;
    END IF;
    PERFORM set_config('sakay.internal_context', 'true', true);

    -- A silence whose booking has ended or changed hands (a cancellation, a reconciliation by an administrator) is closed.
    UPDATE public.trip_connectivity_event e
       SET ended_reason = 'booking_ended'
      FROM public.booking b
     WHERE b.booking_id = e.booking_id
       AND e.restored_at IS NULL AND e.ended_reason IS NULL
       AND (b.driver_id IS DISTINCT FROM e.driver_id OR NOT public._booking_is_open_accepted(b.booking_status));

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
                    -- the record of this silence, with the last confirmed point (decision D7-9)
                    INSERT INTO public.trip_connectivity_event (booking_id, driver_id, phase, started_at,
                                                                last_fix_latitude, last_fix_longitude, last_fix_accuracy_m, last_fix_at)
                    VALUES (v_b.booking_id, v_b.driver_id, v_phase, v_now,
                            v_d.current_latitude, v_d.current_longitude, v_d.last_location_accuracy_m, v_d.last_location_update)
                    ON CONFLICT (booking_id) WHERE restored_at IS NULL AND ended_reason IS NULL DO NOTHING;
                    PERFORM public._dispatch_notify_passenger(v_b, 'DRIVER_UNREACHABLE',
                        U&'Connection lost \2014 reconnecting... (Nawalan ng koneksyon)',
                        'Your driver appears to be experiencing a connectivity issue. We''ll keep trying to reach them. '
                        || '(Mukhang may problema sa koneksyon ang iyong drayber. Patuloy kaming susubok na makontak siya.)');
                    PERFORM public.record_policy_audit('CONNECTIVITY_INTERRUPTED', v_b.booking_id::TEXT, v_d.full_name, 'Dispatch',
                        'No location update from the driver for more than ' || public.dispatch_constant('unreachable_warn_seconds') / 60
                        || ' minutes (Rule 9.2); trip phase: ' || v_phase || '.', NULL,
                        jsonb_build_object('booking_id', v_b.booking_id, 'driver_id', v_b.driver_id, 'phase', v_phase,
                                           'last_fix_at', v_d.last_location_update));
                    v_n := v_n + 1;
                ELSE
                    -- already marked: make sure the silence has its record (a mark made before this table existed)
                    INSERT INTO public.trip_connectivity_event (booking_id, driver_id, phase, started_at,
                                                                last_fix_latitude, last_fix_longitude, last_fix_accuracy_m, last_fix_at)
                    VALUES (v_b.booking_id, v_b.driver_id, v_phase, v_b.driver_unreachable_since,
                            v_d.current_latitude, v_d.current_longitude, v_d.last_location_accuracy_m, v_d.last_location_update)
                    ON CONFLICT (booking_id) WHERE restored_at IS NULL AND ended_reason IS NULL DO NOTHING;
                END IF;

                IF v_phase = 'assigned' AND v_silent >= public.dispatch_constant('unreachable_cancel_seconds') THEN
                    v_res := public._booking_timer_cancel(v_b.booking_id, v_b.driver_id, 'DRV_CONNECTIVITY_FAILURE', 'Rule 9.3',
                        'No location update from the driver for ' || public.dispatch_constant('unreachable_cancel_seconds') / 60 || ' minutes before arriving at the pickup.',
                        'We could not reach you for 5 minutes, so this booking was cancelled and given to another driver. A provisional strike was recorded; '
                        || 'if the cause was outside your control (dead battery, no signal, a damaged phone), you may ask your TODA administrator to waive it within 48 hours.',
                        'We lost contact with your driver, so we are finding you another driver. '
                        || '(Nawalan kami ng kontak sa iyong drayber, kaya naghahanap kami ng ibang drayber.)');
                    IF v_res IN ('redispatched', 'terminated') THEN
                        UPDATE public.trip_connectivity_event SET ended_reason = 'auto_cancelled'
                         WHERE booking_id = v_b.booking_id AND restored_at IS NULL AND ended_reason IS NULL;
                    END IF;
                    v_n := v_n + 1;
                ELSIF v_phase = 'ongoing'
                      AND v_now - v_b.driver_unreachable_since >= make_interval(secs => public.dispatch_constant('ongoing_reconcile_seconds')) THEN
                    -- Rule 9.5: a boarded passenger is never stranded: the trip stays open and the TODA administrator reconciles it by phone.
                    SELECT * INTO v_ev FROM public.trip_connectivity_event
                     WHERE booking_id = v_b.booking_id AND restored_at IS NULL AND ended_reason IS NULL
                     ORDER BY started_at DESC LIMIT 1;
                    IF FOUND AND v_ev.reconcile_flagged_at IS NULL THEN
                        v_flag := public._presence_flag('TRIP_MANUAL_RECONCILIATION', v_b.driver_id, 'Rule 9.5',
                            jsonb_build_object('booking_id', v_b.booking_id, 'event_id', v_ev.event_id,
                                'connectivity_interrupted_since', v_b.driver_unreachable_since,
                                'last_known_latitude', v_ev.last_fix_latitude, 'last_known_longitude', v_ev.last_fix_longitude,
                                'last_known_at', v_ev.last_fix_at,
                                'note', 'The driver has been unreachable for 30 minutes during a trip. Contact both parties and confirm the outcome and fare before closing the record.'));
                        UPDATE public.trip_connectivity_event SET reconcile_flagged_at = v_now, reconcile_flag_id = v_flag WHERE event_id = v_ev.event_id;
                        PERFORM public.record_policy_audit('TRIP_RECONCILIATION_REQUIRED', v_b.booking_id::TEXT, v_d.full_name, 'Dispatch',
                            'The trip has been without a location from the driver for 30 minutes (Rule 9.5): it is waiting for manual reconciliation by the TODA Administrator.', NULL,
                            jsonb_build_object('booking_id', v_b.booking_id, 'event_id', v_ev.event_id, 'flag_id', v_flag));
                        v_n := v_n + 1;
                    END IF;
                END IF;
                CONTINUE;                                   -- an unreachable driver is not judged on movement
            ELSIF v_b.driver_unreachable_since IS NOT NULL THEN
                UPDATE public.booking SET driver_unreachable_since = NULL WHERE booking_id = v_b.booking_id RETURNING * INTO v_b;   -- he is back
                UPDATE public.trip_connectivity_event SET restored_at = v_now
                 WHERE booking_id = v_b.booking_id AND restored_at IS NULL AND ended_reason IS NULL;
                GET DIAGNOSTICS v_rows = ROW_COUNT;
                IF v_rows > 0 THEN
                    PERFORM public.record_policy_audit('CONNECTIVITY_RESTORED', v_b.booking_id::TEXT, v_d.full_name, 'Dispatch',
                        'Location updates from the driver resumed (trip phase: ' || v_phase || ').', NULL,
                        jsonb_build_object('booking_id', v_b.booking_id, 'driver_id', v_b.driver_id, 'phase', v_phase));
                END IF;
            END IF;

            -- ---- Rule 10.2 (Batch 8): once the driver has arrived, the passenger's wait does not count while he is away from the pickup
            IF v_phase = 'arrived' THEN
                PERFORM public._booking_wait_track(v_b, v_now);
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

            -- Movement = how far the driver is from where he last moved, less the error of BOTH fixes (decision D7-8: GPS noise is not a journey;
            -- a fix whose error circle overlaps the anchor's cannot show that the vehicle moved).
            v_moved := GREATEST(0, public.calculate_haversine_distance_km(v_b.stall_anchor_latitude, v_b.stall_anchor_longitude,
                                                                        v_d.current_latitude, v_d.current_longitude) * 1000.0
                                   - COALESCE(v_b.stall_anchor_accuracy_m, 0) - COALESCE(v_d.last_location_accuracy_m, 0));
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
                ELSIF v_idle >= public.dispatch_constant('stall_en_route_warn_seconds') AND v_b.stall_warned_at IS NULL THEN   -- Rule 8.4 warning (decision D7-7)
                    UPDATE public.booking SET stall_warned_at = v_now WHERE booking_id = v_b.booking_id;
                    -- the Rule 8.2 text; its own key per delay report, so a restarted stand-still can be warned again
                    PERFORM public._notify_subject('driver', v_b.driver_id, 'STALL_WARNING', 'Hindi ka pa gumagalaw (You have not started)',
                        'You have not started traveling toward the passenger. Please proceed or cancel the booking. '
                        || '(Hindi ka pa nagsisimulang pumunta sa pasahero. Pakisimulan o ikansela ang booking.)',
                        v_b.booking_id::TEXT, 1000000 + v_tag * 10 + v_b.stall_delay_reports);
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
-- 16. THE ARRIVAL WAIT, SERVER CLOCK (Rules 10.1 - 10.3; replaces 20261015000005)
-- ----------------------------------------------------------------------------
-- The deadline is arrived_at + 5 minutes + the seconds the wait was paused (Rule 10.2) + 2 minutes once the passenger has asked: the phones only
-- draw the countdown. The passenger learns only booleans about the driver's position; the driver gets "can I report a no-show" computed here.
-- New: paused_seconds, boarding_verified (the driver has confirmed the first name, Rule 11.1).
CREATE OR REPLACE FUNCTION public.get_arrival_wait_status(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_b public.booking;
    v_me_driver UUID := public.get_current_driver_id();
    v_me_pax UUID := public.get_current_passenger_id();
    v_now TIMESTAMPTZ := clock_timestamp();
    v_base INTEGER := public.dispatch_constant('no_show_wait_seconds');
    v_ext INTEGER := public.dispatch_constant('no_show_extension_seconds');
    v_first_end TIMESTAMPTZ;
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
    v_first_end := v_b.arrived_at + make_interval(secs => v_base + v_b.wait_paused_seconds);
    v_deadline := v_first_end + make_interval(secs => CASE WHEN v_b.wait_extended_at IS NOT NULL THEN v_ext ELSE 0 END);
    v_remaining := GREATEST(0, ceil(EXTRACT(EPOCH FROM (v_deadline - v_now))))::INTEGER;
    v_in_zone := CASE WHEN v_is_driver THEN public._driver_within_pickup_zone(v_b.driver_id, p_booking_id) END;
    RETURN jsonb_build_object(
        'success', TRUE, 'waiting', TRUE, 'booking_status', v_b.booking_status,
        'arrived_at', v_b.arrived_at, 'deadline', v_deadline, 'seconds_remaining', v_remaining,
        'wait_total_seconds', v_base + round(v_b.wait_paused_seconds)::INTEGER + CASE WHEN v_b.wait_extended_at IS NOT NULL THEN v_ext ELSE 0 END,
        'paused_seconds', round(v_b.wait_paused_seconds)::INTEGER,
        'extended', v_b.wait_extended_at IS NOT NULL,
        'can_extend', v_me_pax IS NOT NULL AND v_b.wait_extended_at IS NULL AND v_now < v_first_end,
        'boarding_verified', v_b.boarding_verified_at IS NOT NULL,
        'driver_in_zone', v_in_zone,
        'can_report_no_show', v_is_driver AND v_remaining = 0 AND COALESCE(v_in_zone, FALSE),
        'server_time', v_now);
END;
$$;

-- "I'm Almost There" (Rule 10.3): once, while the first five minutes (and any paused time) are still running; adds exactly two minutes.
CREATE OR REPLACE FUNCTION public.passenger_extend_wait(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
    IF v_now >= v_b.arrived_at + make_interval(secs => public.dispatch_constant('no_show_wait_seconds') + v_b.wait_paused_seconds) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_WAIT_OVER', 'error', 'The waiting time is already over, so it can no longer be extended.');
    END IF;
    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.booking SET wait_extended_at = v_now WHERE booking_id = p_booking_id;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN public.get_arrival_wait_status(p_booking_id);
END;
$$;

-- ----------------------------------------------------------------------------
-- 17. PASSENGER NO-SHOW (Rules 10.1, 10.4, 10.5; replaces 20261015000005)
-- ----------------------------------------------------------------------------
-- Only when ALL of Rule 10.1 holds: the driver has arrived, the whole wait (paused time and the extension, if used, included) has passed on
-- the server's clock, and the driver is inside the zone on a fix good enough to prove it (so never while he is away from the pickup). Then,
-- in one transaction: the booking is cancelled (it cannot be reinstated, 10.5: the passenger books again), the passenger gets the 2 strikes
-- _cancellation_decision() names, the driver gets the single-use, session-scoped redispatch credit (decision PI-02 = A: it only ever breaks an
-- exact ETA tie), and nothing makes him return to the terminal first.
CREATE OR REPLACE FUNCTION public.driver_report_no_show(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_driver UUID := public.get_current_driver_id();
    v_b public.booking;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_deadline TIMESTAMPTZ;
    v_dec JSONB;
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
    v_deadline := v_b.arrived_at + make_interval(secs => public.dispatch_constant('no_show_wait_seconds') + v_b.wait_paused_seconds
                                                         + CASE WHEN v_b.wait_extended_at IS NOT NULL THEN public.dispatch_constant('no_show_extension_seconds') ELSE 0 END);
    IF v_now < v_deadline THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_WAIT_NOT_OVER',
            'error', 'The passenger still has time to board.', 'seconds_remaining', ceil(EXTRACT(EPOCH FROM (v_deadline - v_now)))::INTEGER);
    END IF;
    IF NOT public._driver_within_pickup_zone(v_driver, p_booking_id) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_AT_PICKUP',
            'error', 'You must be within ' || public.dispatch_constant('no_show_radius_m') || ' m of the pickup point, with a clear GPS signal, to report a no-show.');
    END IF;

    v_dec := public._cancellation_decision(v_b, 'no_show');
    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.booking
       SET booking_status = 'Cancelled', cancelled_by = 'driver', cancellation_reason = 'PASSENGER_NO_SHOW', cancelled_at = v_now
     WHERE booking_id = p_booking_id;
    IF v_b.passenger_id IS NOT NULL THEN
        PERFORM public.issue_strike('passenger', v_b.passenger_id, v_dec->>'violation_code', NULL, p_booking_id, NULL,
            (v_dec->>'violation_code') || ':' || p_booking_id::TEXT, NULL, 'Did not board within the waiting time after the driver arrived.', NULL,
            jsonb_build_object('rule', 'Rule 10.4', 'arrived_at', v_b.arrived_at, 'extended', v_b.wait_extended_at IS NOT NULL,
                               'paused_seconds', round(v_b.wait_paused_seconds)::INTEGER));
        PERFORM public._dispatch_notify_passenger(v_b, 'PASSENGER_NO_SHOW',
            'Nakansela ang booking mo (Your booking was cancelled)',
            'You did not board within the waiting time, so the booking was cancelled as a no-show and 2 strikes were recorded. You may book again. '
            || '(Hindi ka sumakay sa loob ng oras ng paghihintay, kaya nakansela ang booking at 2 strike ang naitala. Maaari kang mag-book muli.)');
    END IF;
    IF (v_dec->>'driver_credit')::BOOLEAN THEN
        UPDATE public.driver_online_session SET redispatch_credit = TRUE WHERE driver_id = v_driver AND ended_at IS NULL;
    END IF;
    PERFORM public.record_policy_audit('PASSENGER_NO_SHOW', p_booking_id::TEXT, NULL, 'Dispatch',
        'The driver reported a passenger no-show after the full waiting time; 2 strikes, booking cancelled.', NULL,
        jsonb_build_object('driver_id', v_driver, 'passenger_id', v_b.passenger_id, 'arrived_at', v_b.arrived_at, 'deadline', v_deadline,
                           'paused_seconds', round(v_b.wait_paused_seconds)::INTEGER));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'booking_id', p_booking_id);
END;
$$;

-- ----------------------------------------------------------------------------
-- 18. "I CHECKED THE FIRST NAME" (Rule 11.1; decision D8-X9 = V2)
-- ----------------------------------------------------------------------------
-- The driver has the passenger's first name (get_booking_counterparties / the offer) and checks it with the person at the pickup against the
-- booking. This records that he did, when: the status guard refuses to start the trip before it (ERR_VERIFY_PASSENGER). Idempotent. It cannot see
-- who actually boards: Rules 11.2 - 11.4 remain the driver's procedure, with the guidance and the messages in the Driver app.
CREATE OR REPLACE FUNCTION public.driver_confirm_passenger(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_driver UUID := public.get_current_driver_id();
    v_b public.booking;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_first TEXT;
BEGIN
    IF v_driver IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_A_DRIVER', 'error', 'Only the driver can confirm the passenger.');
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_b.driver_id IS DISTINCT FROM v_driver THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_YOUR_BOOKING', 'error', 'This booking is not assigned to you.');
    END IF;
    IF public._booking_phase(v_b.booking_status) <> 'arrived' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_ARRIVED', 'error', 'Tap Arrived at the pickup first. The passenger is checked at the pickup.');
    END IF;
    SELECT public.passenger_first_name(p.full_name) INTO v_first FROM public.passenger p WHERE p.passenger_id = v_b.passenger_id;
    IF v_b.boarding_verified_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', TRUE, 'already_confirmed', TRUE, 'booking_id', p_booking_id, 'passenger_first_name', v_first);
    END IF;
    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.booking SET boarding_verified_at = clock_timestamp() WHERE booking_id = p_booking_id;
    PERFORM public.record_policy_audit('PASSENGER_NAME_CONFIRMED', p_booking_id::TEXT, NULL, 'Boarding',
        'The driver confirmed the passenger''s first name against the booking before boarding (Rule 11.1).', NULL,
        jsonb_build_object('booking_id', p_booking_id, 'driver_id', v_driver, 'passenger_first_name', v_first));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'booking_id', p_booking_id, 'passenger_first_name', v_first);
END;
$$;


-- ----------------------------------------------------------------------------
-- 19. ACCEPT (replaces 20261015000002): the acceptance fix keeps its reported accuracy (Rules 12.3 / 12.4 subtract it from the progress)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_booking_offer(p_attempt_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_driver UUID := public.get_current_driver_id();
    v_booking_id UUID;
    v_att public.dispatch_attempt;
    v_b public.booking;
    v_d public.driver;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_now TIMESTAMPTZ;
    v_expiry TIMESTAMPTZ;
BEGIN
    IF v_driver IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_A_DRIVER', 'error', 'Only a driver can accept a booking.');
    END IF;

    SELECT a.booking_id INTO v_booking_id FROM public.dispatch_attempt a WHERE a.attempt_id = p_attempt_id AND a.driver_id = v_driver;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_OFFER_NOT_FOUND', 'error', 'This offer does not exist.');
    END IF;

    SELECT * INTO v_b FROM public.booking WHERE booking_id = v_booking_id FOR UPDATE;      -- serializes everything about this booking
    SELECT * INTO v_att FROM public.dispatch_attempt WHERE attempt_id = p_attempt_id FOR UPDATE;
    v_now := clock_timestamp();

    IF v_att.response_status = 'Accepted' AND v_b.driver_id = v_driver THEN
        RETURN jsonb_build_object('success', TRUE, 'booking_id', v_booking_id, 'already_accepted', TRUE);   -- a double tap
    END IF;
    IF v_att.response_status <> 'Pending' OR v_b.driver_id IS NOT NULL OR NOT public._booking_is_searching(v_b.booking_status) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_BOOKING_UNAVAILABLE',
            'error', 'This booking is no longer available (cancelled, taken, or the offer ran out).');
    END IF;
    v_expiry := COALESCE(v_att.expires_at, v_att.notification_sent_at
                 + make_interval(secs => public.dispatch_constant('offer_window_seconds') + public.dispatch_constant('offer_grace_seconds')));
    IF v_expiry <= v_now THEN
        PERFORM set_config('sakay.internal_context', 'true', true);
        UPDATE public.dispatch_attempt SET response_status = 'Expired' WHERE attempt_id = p_attempt_id AND response_status = 'Pending';
        PERFORM public._dispatch_advance(v_booking_id);
        PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_OFFER_EXPIRED', 'error', 'The response time for this offer has ended.');
    END IF;

    SELECT * INTO v_d FROM public.driver WHERE driver_id = v_driver FOR UPDATE;
    IF v_d.availability_status <> 'Available' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_ONLINE', 'error', 'You must be Online and Available to accept a booking.');
    END IF;

    BEGIN
        PERFORM set_config('sakay.internal_context', 'true', true);
        -- The offer first, then the booking: the booking's own triggers withdraw any OTHER offer still out, and must not touch this one.
        UPDATE public.dispatch_attempt SET response_status = 'Accepted', responded_at = v_now WHERE attempt_id = p_attempt_id;
        UPDATE public.booking
           SET driver_id = v_driver,
               booking_status = 'Accepted',
               accepted_at = v_now,
               accept_latitude = v_d.current_latitude,
               accept_longitude = v_d.current_longitude,
               accept_accuracy_m = v_d.last_location_accuracy_m,
               stall_anchor_latitude = v_d.current_latitude,
               stall_anchor_longitude = v_d.current_longitude,
               stall_anchor_at = v_now,
               dispatch_ended_reason = 'accepted'
         WHERE booking_id = v_booking_id;
        PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
        -- the driver is restricted, or already carries a booking: the guards say so in plain words
        RETURN jsonb_build_object('success', FALSE,
            'error_code', COALESCE(substring(SQLERRM FROM '^(ERR_[A-Z_]+)'), 'ERR_CANNOT_ACCEPT'),
            'error', SQLERRM);
    END;

    RETURN jsonb_build_object('success', TRUE, 'booking_id', v_booking_id);
END;
$$;


-- ----------------------------------------------------------------------------
-- 20. THE SEARCH SWEEP (replaces 20261015000002): bookings marked with redispatch priority are advanced first
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispatch_sweep()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    r RECORD;
    v_n INTEGER := 0;
BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtextextended('sakay.dispatch_sweep', 0)) THEN
        RETURN 0;
    END IF;
    FOR r IN
        SELECT b.booking_id
          FROM public.booking b
         -- the literal status list (not _booking_is_searching()): only a literal lets the database use the partial index idx_booking_dispatch_due,
         -- so a sweep does not read every trip ever made
         WHERE b.booking_status IN ('Pending', 'Searching Driver')
           AND (COALESCE(b.dispatch_next_action_at, b.created_at) <= clock_timestamp()
                -- an offer whose driver went Offline (or Busy) is not waited out: the search moves on at once
                OR EXISTS (SELECT 1 FROM public.dispatch_attempt a JOIN public.driver d ON d.driver_id = a.driver_id
                            WHERE a.booking_id = b.booking_id AND a.response_status = 'Pending' AND d.availability_status <> 'Available'))
         -- Rule 12.4 / PI-02: a booking redispatched with priority is served before the others that are due (the one deliberate exception)
         ORDER BY (b.redispatch_priority_at IS NULL), COALESCE(b.dispatch_next_action_at, b.created_at)
         LIMIT public.dispatch_constant('sweep_batch_limit')
           FOR UPDATE OF b SKIP LOCKED
    LOOP
        BEGIN
            PERFORM public._dispatch_advance(r.booking_id);
            v_n := v_n + 1;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'dispatch sweep: booking % could not be advanced (%)', r.booking_id, SQLERRM;
        END;
    END LOOP;
    -- The same wake-ups also keep the accepted bookings honest (a driver who never moves, a driver who goes silent): see booking_timers_sweep().
    BEGIN
        PERFORM public.booking_timers_sweep();
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'dispatch sweep: the booking timers could not run (%)', SQLERRM;
    END;
    RETURN v_n;
END;
$$;


-- ----------------------------------------------------------------------------
-- 21. THE DRIVER'S OFFER (replaces 20261015000002): the passenger is shown to the driver by FIRST NAME only (Rule 11.1; key passenger_first_name)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_pending_offer()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_driver UUID := public.get_current_driver_id();
    v_att public.dispatch_attempt;
    v_b public.booking;
    v_now TIMESTAMPTZ;
    v_window INTEGER := public.dispatch_constant('offer_window_seconds');
BEGIN
    IF v_driver IS NULL THEN
        RETURN NULL;
    END IF;
    PERFORM public.dispatch_sweep();
    v_now := clock_timestamp();

    SELECT * INTO v_att FROM public.dispatch_attempt a
     WHERE a.driver_id = v_driver AND a.response_status = 'Pending' AND (a.expires_at IS NULL OR a.expires_at > v_now)
     ORDER BY a.notification_sent_at DESC LIMIT 1;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = v_att.booking_id;
    IF NOT FOUND OR NOT public._booking_is_searching(v_b.booking_status) THEN
        RETURN NULL;
    END IF;

    RETURN jsonb_build_object(
        'attempt_id', v_att.attempt_id,
        'booking_id', v_b.booking_id,
        'passenger_first_name', (SELECT public.passenger_first_name(p.full_name) FROM public.passenger p WHERE p.passenger_id = v_b.passenger_id),
        'passenger_count', v_b.passenger_count,
        'is_shared_trip', v_b.is_shared_trip,
        'pickup_address', v_b.pickup_address,
        'pickup_latitude', v_b.pickup_latitude,
        'pickup_longitude', v_b.pickup_longitude,
        'dropoff_address', v_b.dropoff_address,
        'dropoff_latitude', v_b.dropoff_latitude,
        'dropoff_longitude', v_b.dropoff_longitude,
        'estimated_distance_km', v_b.estimated_distance_km,
        'estimated_fare', v_b.estimated_fare,
        'eta_seconds', v_att.eta_seconds,
        'eta_source', v_att.eta_source,
        'distance_m', v_att.distance_m,
        'window_seconds', v_window,
        'seconds_remaining', GREATEST(0, LEAST(v_window, ceil(EXTRACT(EPOCH FROM (COALESCE(v_att.expires_at, v_att.notification_sent_at + make_interval(secs => v_window)) - v_now))))),
        'expires_at', v_att.expires_at,
        'created_at', v_b.created_at,
        'server_time', v_now
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- 22. THE OTHER PARTY OF A BOOKING (replaces 20261008000002): a DRIVER (the booking's or one holding its offer) gets the passenger's first name
-- only, as passenger_name; the passenger himself and the administrators still get the full name (Rule 11.1; no more personal data than needed)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_booking_counterparties(p_booking_ids UUID[])
RETURNS TABLE (
    booking_id UUID,
    passenger_id UUID,
    passenger_name TEXT,
    passenger_phone TEXT,
    driver_id UUID,
    driver_name TEXT,
    driver_phone TEXT,
    plate_number TEXT,
    franchise_number TEXT,
    toda_name TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_pax UUID := public.get_current_passenger_id();
    v_drv UUID := public.get_current_driver_id();
    v_toda UUID := public.get_current_toda_admin_toda_id();
    v_lgu BOOLEAN := COALESCE(public.is_lgu_admin(), FALSE);
BEGIN
    IF p_booking_ids IS NULL OR cardinality(p_booking_ids) = 0 THEN
        RETURN;
    END IF;
    IF cardinality(p_booking_ids) > 200 THEN
        RAISE EXCEPTION 'ERR_TOO_MANY_BOOKINGS: Ask for at most 200 bookings at a time.' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT f.booking_id,
           f.passenger_id,
           CASE WHEN f.sees_passenger THEN CASE WHEN f.is_staff OR f.is_pax THEN f.p_name ELSE public.passenger_first_name(f.p_name) END END,
           CASE WHEN f.sees_passenger_phone THEN f.p_phone END,
           CASE WHEN f.sees_driver THEN f.driver_id END,
           CASE WHEN f.sees_driver THEN f.d_name END,
           CASE WHEN f.sees_driver_phone THEN f.d_phone END,
           CASE WHEN f.sees_driver THEN f.d_plate END,
           CASE WHEN f.sees_driver THEN f.d_franchise END,
           CASE WHEN f.sees_driver THEN f.t_name END
      FROM (
        SELECT g.booking_id, g.passenger_id, g.driver_id, g.p_name, g.p_phone, g.d_name, g.d_phone, g.d_plate, g.d_franchise, g.t_name,
               g.is_staff, g.is_pax,
               (g.is_staff OR g.is_pax OR g.is_drv OR g.has_offer) AS sees_passenger,
               (g.is_staff OR g.is_pax OR (g.is_drv AND g.live)) AS sees_passenger_phone,
               (g.driver_id IS NOT NULL AND (g.is_staff OR g.is_pax OR g.is_drv)) AS sees_driver,
               (g.driver_id IS NOT NULL AND (g.is_staff OR g.is_drv OR (g.is_pax AND g.live))) AS sees_driver_phone
          FROM (
            SELECT b.booking_id,
                   b.passenger_id,
                   b.driver_id,
                   p.full_name::TEXT AS p_name,
                   p.contact_number::TEXT AS p_phone,
                   d.full_name::TEXT AS d_name,
                   d.contact_number::TEXT AS d_phone,
                   d.plate_number::TEXT AS d_plate,
                   d.franchise_number::TEXT AS d_franchise,
                   t.toda_name::TEXT AS t_name,
                   (v_lgu OR (v_toda IS NOT NULL AND (b.toda_id = v_toda OR d.toda_id = v_toda))) AS is_staff,
                   (v_pax IS NOT NULL AND b.passenger_id = v_pax) AS is_pax,
                   (v_drv IS NOT NULL AND b.driver_id = v_drv) AS is_drv,
                   (v_drv IS NOT NULL AND b.driver_id IS NULL AND public.rls_driver_has_pending_offer(b.booking_id)) AS has_offer,
                   public._booking_is_open_accepted(b.booking_status::TEXT) AS live
              FROM unnest(p_booking_ids) AS ids(id)
              JOIN public.booking b ON b.booking_id = ids.id
              LEFT JOIN public.passenger p ON p.passenger_id = b.passenger_id
              LEFT JOIN public.driver d ON d.driver_id = b.driver_id
              LEFT JOIN public.toda t ON t.toda_id = d.toda_id
          ) g
      ) f
     WHERE f.sees_passenger OR f.sees_driver;
END;
$$;


-- ----------------------------------------------------------------------------
-- 23. CHANGING THE PICKUP, BEFORE A DRIVER ACCEPTS (Rule 29.9; decision D8-PICKUP = build it)
-- ----------------------------------------------------------------------------
-- Since Batch 5 no client can edit a booking's pickup (booking_fare_update_guard, ERR_BOOKING_LOCKED): that stays, for every direct write, at every
-- stage. This is the ONE door, and it opens only while the booking is still SEARCHING and no driver is attached. It does what a new booking does,
-- on the same booking: the new place must be inside the service area; the route distance is sanity-checked against the straight line and the fare
-- is quoted again by the database (the passenger confirms the figure he was shown, or is told the new one: ERR_FARE_MISMATCH with expected_fare);
-- the offers that are out are withdrawn; the search starts again from Tier 1 as a new cycle, with the Priority TODA of the NEW pickup. After
-- acceptance, or once the booking has ended, it is refused (ERR_PICKUP_LOCKED). Audited with the before and after.
CREATE OR REPLACE FUNCTION public.passenger_update_pickup(
    p_booking_id UUID,
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_address TEXT,
    p_distance_km NUMERIC,
    p_expected_fare NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_me UUID := public.get_current_passenger_id();
    v_b public.booking;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_now TIMESTAMPTZ := clock_timestamp();
    v_cfg public.service_area_config;
    v_rule public.fare_matrix;
    v_calc JSONB;
    v_expected NUMERIC;
    v_dist NUMERIC;
    v_straight_km NUMERIC;
    v_lo NUMERIC;
    v_hi NUMERIC;
    v_address TEXT := btrim(COALESCE(p_address, ''));
BEGIN
    IF v_me IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_A_PASSENGER', 'error', 'Only a passenger can change a pickup.');
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id AND passenger_id = v_me FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_YOUR_BOOKING', 'error', 'This booking does not belong to you.');
    END IF;
    IF NOT public._booking_is_searching(v_b.booking_status) OR v_b.driver_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_PICKUP_LOCKED',
            'error', 'Hindi na mababago ang pickup pagkatapos tumanggap ng drayber. Maaari kang magkansela nang walang parusa kung wala pang tumatanggap, at mag-book muli. (The pickup can be changed only before a driver accepts.)');
    END IF;
    IF p_latitude IS NULL OR p_longitude IS NULL OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 OR v_address = '' OR length(v_address) > 300 THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_PICKUP_INVALID', 'error', 'Choose a pickup place on the map or from the search.');
    END IF;

    SELECT * INTO v_cfg FROM public.service_area_config WHERE is_active = TRUE LIMIT 1;
    IF v_cfg.config_id IS NOT NULL AND NOT public.service_area_contains(v_cfg, p_latitude, p_longitude) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_OUT_OF_SERVICE_AREA',
            'error', 'Ang lokasyon ng pickup ay nasa labas ng opisyal na nasasakupan ng SAKAY (' || v_cfg.area_name || '). Pumili ng lokasyon sa loob ng lungsod.');
    END IF;

    v_dist := round(COALESCE(p_distance_km, 0), 3);
    IF v_dist <= 0 THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_DISTANCE_REQUIRED', 'error', 'A route distance is required to change the pickup.');
    END IF;
    v_straight_km := public.calculate_haversine_distance_km(p_latitude, p_longitude, v_b.dropoff_latitude, v_b.dropoff_longitude)::NUMERIC;
    v_lo := v_straight_km * public.fare_policy_constant('distance_min_pct_of_straight') / 100.0 - public.fare_policy_constant('distance_min_slack_m') / 1000.0;
    v_hi := v_straight_km * public.fare_policy_constant('distance_max_factor') + public.fare_policy_constant('distance_max_slack_m') / 1000.0;
    IF v_dist < v_lo OR v_dist > v_hi THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_DISTANCE_IMPLAUSIBLE',
            'error', 'The route distance does not match the new pickup and the destination. Please try again.');
    END IF;

    v_rule := public.fare_rule_in_force(v_now);
    v_calc := public.calculate_fare(v_dist, CASE WHEN v_b.is_shared_trip THEN 'Shared' ELSE 'Solo' END, v_b.passenger_count,
                                    v_rule.base_fare, v_rule.base_distance_km, v_rule.succeeding_rate);
    v_expected := (v_calc->>'estimated_fare')::NUMERIC;
    IF p_expected_fare IS DISTINCT FROM v_expected THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_FARE_MISMATCH',
            'error', 'The fare for the new pickup is different. Please review it before confirming.',
            'expected_fare', v_expected, 'estimated_distance_km', v_dist, 'current_fare', v_b.estimated_fare);
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.dispatch_attempt SET response_status = 'Expired', responded_at = v_now
     WHERE booking_id = p_booking_id AND response_status = 'Pending';          -- a withdrawal, not an ignored offer (responded_at is set)
    UPDATE public.booking
       SET pickup_address = v_address,
           pickup_latitude = p_latitude,
           pickup_longitude = p_longitude,
           estimated_distance_km = v_dist,
           estimated_fare = v_expected,
           fare_matrix_id = v_rule.fare_matrix_id,
           fare_breakdown = jsonb_build_object('version', 1, 'rule', public._fare_rule_json(v_rule), 'estimate', v_calc, 'final', NULL),
           dispatch_cycle = dispatch_cycle + 1,
           dispatch_tier = 1,
           dispatch_cycle_started_at = v_now,
           dispatch_tier_started_at = v_now,
           dispatch_pool_refreshed_at = NULL,
           dispatch_reached_tier3_at = NULL,
           dispatch_next_action_at = v_now,
           dispatch_ended_reason = NULL,
           dispatch_ended_at = NULL,
           accepted_driver_cancel_count = 0,
           search_restarted_at = v_now,
           priority_toda_id = public._dispatch_priority_toda(p_latitude, p_longitude)
     WHERE booking_id = p_booking_id;
    PERFORM public.record_policy_audit('BOOKING_PICKUP_CHANGED', p_booking_id::TEXT, NULL, 'Booking',
        'The passenger changed the pickup before a driver accepted (Rule 29.9); the fare was quoted again and the search started over.',
        jsonb_build_object('pickup_address', v_b.pickup_address, 'pickup_latitude', v_b.pickup_latitude, 'pickup_longitude', v_b.pickup_longitude,
                           'estimated_distance_km', v_b.estimated_distance_km, 'estimated_fare', v_b.estimated_fare),
        jsonb_build_object('pickup_address', v_address, 'pickup_latitude', p_latitude, 'pickup_longitude', p_longitude,
                           'estimated_distance_km', v_dist, 'estimated_fare', v_expected));
    PERFORM public._dispatch_advance(p_booking_id);
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'booking_id', p_booking_id, 'pickup_address', v_address,
                              'estimated_distance_km', v_dist, 'estimated_fare', v_expected, 'fare_changed', v_expected IS DISTINCT FROM v_b.estimated_fare);
END;
$$;


-- ----------------------------------------------------------------------------
-- 24. PRIVILEGES
-- ----------------------------------------------------------------------------
-- The helpers are run by the database's own functions only. The two calls the apps make are the driver's confirmation of the first name and the
-- passenger's pickup change. Everything else keeps the privileges it had (CREATE OR REPLACE keeps them).
REVOKE EXECUTE ON FUNCTION public._driver_pickup_distance_m(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._driver_within_pickup_zone(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._driver_progress_toward_pickup_m(public.booking) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._booking_wait_track(public.booking, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.passenger_first_name(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._check_repeat_cancellations(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._cancellation_decision(public.booking, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.booking_shared_partner_on_cancel() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.driver_confirm_passenger(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_confirm_passenger(UUID) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.passenger_update_pickup(UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, NUMERIC, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.passenger_update_pickup(UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, NUMERIC, NUMERIC) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 25. SELF-CHECK
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF public.dispatch_constant('no_show_radius_m') <> 25 OR public.dispatch_constant('zone_max_accuracy_m') <> 30
       OR public.dispatch_constant('arrival_zone_tolerance_m') <> 5 OR public.dispatch_constant('arrival_zone_tolerance_seconds') <> 15 THEN
        RAISE EXCEPTION 'the pickup zone constants are not 25 m / 30 m / 5 m / 15 s';
    END IF;
    IF public.dispatch_constant('no_show_wait_seconds') <> 300 OR public.dispatch_constant('no_show_extension_seconds') <> 120
       OR public.dispatch_constant('passenger_cancel_grace_seconds') <> 60 OR public.dispatch_constant('driver_travel_threshold_m') <> 50
       OR public.dispatch_constant('repeat_cancel_flag_count') <> 3 OR public.dispatch_constant('repeat_cancel_window_hours') <> 24
       OR public.dispatch_constant('osrm_timeout_ms') <> 2000 OR public.dispatch_constant('gps_area_window_days') <> 30 THEN
        RAISE EXCEPTION 'dispatch_constant lost or changed a figure the policy fixes';
    END IF;
    IF public.passenger_first_name('Juan Dela Cruz') <> 'Juan' OR public.passenger_first_name('  Ma.   Cristina Santos ') <> 'Ma. Cristina'
       OR public.passenger_first_name('Dela Cruz, Juan Carlos') <> 'Juan' OR public.passenger_first_name('Dr. Ana Reyes') <> 'Ana'
       OR public.passenger_first_name('Pedro') <> 'Pedro' OR public.passenger_first_name(NULL) <> 'Passenger' THEN
        RAISE EXCEPTION 'passenger_first_name() does not read first names correctly';
    END IF;
    IF has_function_privilege('authenticated', 'public._cancellation_decision(public.booking, text, text)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.passenger_first_name(text)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.driver_confirm_passenger(uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.passenger_update_pickup(uuid, double precision, double precision, text, numeric, numeric)', 'EXECUTE') THEN
        RAISE EXCEPTION 'the privileges of the Batch 8 functions are not what they should be';
    END IF;
END $$;
