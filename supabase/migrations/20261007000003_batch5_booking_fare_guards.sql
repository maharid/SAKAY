-- ============================================================================
-- Migration: 20261007000003_batch5_booking_fare_guards.sql
-- Batch 5 (Step 3): bind every booking to the fare rules, in the database.
--
--   Rule 6.2     the estimate comes from the confirmed route; the final fare is computed from
--                the ACTUAL recorded distance and cannot be edited by passenger or driver
--   Rule 6.2.1   pickup and destination are locked once the booking is confirmed
--   Rule 6.2.3/4 route deviations are recorded (fare_adjustment_history)
--   Rule 6.3     a booking is billed at the rule in force when it was CONFIRMED
--   Rule 6.5     the Maximum Unmatched Fare is stored with the estimate; a Shared booking that
--                is not matched is billed Solo
--   Rule 6.6     no scheduled / future bookings
--
-- How it works
--   INSERT  booking_fare_insert_guard   re-computes the estimate with calculate_fare() from the rule in
--                                       force right now, refuses a fare that does not match, refuses
--                                       scheduled bookings, snapshots the rule on the row.
--   UPDATE  booking_fare_update_guard   no client can change the route, the estimate, the rule snapshot,
--                                       the final fare or the lock. When a booking first reaches
--                                       'Arrived at Destination' / 'Completed' the database computes the
--                                       final fare from the snapshot and the recorded GPS track and locks it.
--   TRACK   driver_heartbeat            while the driver's booking is 'Trip Ongoing' every published fix is
--                                       logged to gps_log (the only writer); the trip distance is replayed
--                                       from that log with the F5.1 filters when the booking is finalized.
--
-- Decisions applied: D1 (PI-03 A), D2 (PI-04 B), D5 (no booking without an OSRM distance), D6 (F5.1 / F5.2),
-- D8 (fare_adjustment_history). Forward-only: Batches 1-4 are not edited; the one Batch 4 function that
-- needs a hook (driver_heartbeat) is replaced with its body unchanged except for one added call.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. COLUMNS
-- ----------------------------------------------------------------------------
ALTER TABLE public.booking
    ADD COLUMN IF NOT EXISTS fare_matrix_id UUID REFERENCES public.fare_matrix(fare_matrix_id),
    ADD COLUMN IF NOT EXISTS fare_breakdown JSONB,
    ADD COLUMN IF NOT EXISTS fare_locked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_booking_fare_matrix_id ON public.booking (fare_matrix_id);

-- Rule 6.6: every booking is for immediate pickup. (Nothing in the apps ever wrote anything else.)
UPDATE public.booking SET booking_type = 'Immediate' WHERE booking_type IS DISTINCT FROM 'Immediate';
ALTER TABLE public.booking DROP CONSTRAINT IF EXISTS booking_type_immediate_only;
ALTER TABLE public.booking ADD CONSTRAINT booking_type_immediate_only CHECK (booking_type = 'Immediate');

-- ----------------------------------------------------------------------------
-- 2. FARE ADJUSTMENT LEDGER (Rules 6.2.4, 13.5; Batch 9 adds its own reason codes)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fare_adjustment_history (
    adjustment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES public.booking(booking_id) ON DELETE CASCADE,
    reason_code VARCHAR(40) NOT NULL
        CHECK (reason_code IN ('ROUTE_DEVIATION', 'DECLARED_PASSENGER_MISMATCH', 'EARLY_TERMINATION', 'DISPUTE_RESOLUTION', 'ADMIN_CORRECTION')),
    previous_fare NUMERIC(10,2) NOT NULL,
    new_fare NUMERIC(10,2) NOT NULL,
    estimated_distance_km NUMERIC(8,3),
    actual_distance_km NUMERIC(8,3),
    tolerance_km NUMERIC(8,3),
    details JSONB NOT NULL DEFAULT '{}'::JSONB,
    actor_id UUID,
    actor_role VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fare_adjustment_history_booking
    ON public.fare_adjustment_history (booking_id, created_at DESC);

ALTER TABLE public.fare_adjustment_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fare_adjustment_history_select" ON public.fare_adjustment_history;
CREATE POLICY "fare_adjustment_history_select" ON public.fare_adjustment_history
    FOR SELECT TO authenticated
    USING (
        public.is_lgu_admin()
        OR EXISTS (
            SELECT 1 FROM public.booking b
            WHERE b.booking_id = fare_adjustment_history.booking_id
              AND (
                  b.passenger_id = public.get_current_passenger_id()
                  OR b.driver_id = public.get_current_driver_id()
                  OR (public.is_toda_admin() AND b.toda_id = public.get_current_toda_admin_toda_id())
              )
        )
    );

-- Written only by the guards below (and by Batch 9's audited functions).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.fare_adjustment_history FROM anon, authenticated;
REVOKE SELECT ON public.fare_adjustment_history FROM anon;

-- ----------------------------------------------------------------------------
-- 3. THE GPS TRACK: a trusted table, written only by the database
-- ----------------------------------------------------------------------------
-- gps_log used to accept writes from anybody (even without a login) and be read by everybody.
-- Trip distance is billed from it, and it now holds real trip routes, so both are closed.
DROP POLICY IF EXISTS "gps_log_select_policy" ON public.gps_log;
DROP POLICY IF EXISTS "gps_log_insert_policy" ON public.gps_log;
DROP POLICY IF EXISTS "gps_log_update_policy" ON public.gps_log;
DROP POLICY IF EXISTS "gps_log_delete_policy" ON public.gps_log;

CREATE POLICY "gps_log_select_policy" ON public.gps_log
    FOR SELECT TO authenticated
    USING (
        driver_id = public.get_current_driver_id()
        OR public.is_lgu_admin()
        OR EXISTS (
            SELECT 1 FROM public.booking b
            WHERE b.booking_id = gps_log.booking_id
              AND (
                  b.passenger_id = public.get_current_passenger_id()
                  OR (public.is_toda_admin() AND b.toda_id = public.get_current_toda_admin_toda_id())
              )
        )
    );

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.gps_log FROM anon, authenticated;
REVOKE SELECT ON public.gps_log FROM anon;

CREATE INDEX IF NOT EXISTS idx_gps_log_booking_time ON public.gps_log (booking_id, recorded_at);

-- ----------------------------------------------------------------------------
-- 4. HELPERS
-- ----------------------------------------------------------------------------
-- A passenger is on board. (The apps write 'Trip Ongoing'; 'Ongoing' is the older spelling.)
CREATE OR REPLACE FUNCTION public._booking_trip_in_progress(p_status TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT p_status IN ('Trip Ongoing', 'Ongoing');
$$;

-- Log the driver's published fix against every booking they are carrying right now.
CREATE OR REPLACE FUNCTION public._log_trip_fix(
    p_driver_id UUID,
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_accuracy_m DOUBLE PRECISION
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO public.gps_log (booking_id, driver_id, latitude, longitude, accuracy, sync_status)
    SELECT b.booking_id, p_driver_id, p_latitude, p_longitude, p_accuracy_m, 'Synced'
    FROM public.booking b
    WHERE b.driver_id = p_driver_id
      AND public._booking_trip_in_progress(b.booking_status)
      AND b.fare_locked_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Replay a booking's logged fixes with the F5.1 filters and return the trip distance.
--   1. accuracy: a fix worse than gps_max_accuracy_m is ignored
--   2. teleport: a fix implying more than gps_max_speed_kmh from the last good fix is discarded; after
--      gps_reanchor_after_rejects in a row the reference point itself is assumed wrong and replaced
--   3. dead-band: movement smaller than max(gps_deadband_m, accuracy of the last counted point + accuracy
--      of this fix) from the last counted point is jitter and adds nothing: two fixes whose error circles
--      overlap cannot show the vehicle moved (slow crawls accumulate until they clear it). Measuring
--      against the fix's own accuracy alone let +-11 m jitter add 0.2 - 1.8 km while standing still
--      (simulated, 10 minutes of beats; see scripts/db-tests/batch5/trip-distance.js).
--   4. gaps: the longest silence between good fixes is reported; over gps_gap_flag_seconds flags the track
-- A pure function of the logged rows, so it can be re-run at any time and gives the same answer.
CREATE OR REPLACE FUNCTION public._trip_track_summary(
    p_booking_id UUID,
    p_dest_lat DOUBLE PRECISION DEFAULT NULL,
    p_dest_lng DOUBLE PRECISION DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_max_acc DOUBLE PRECISION := public.fare_policy_constant('gps_max_accuracy_m');
    v_max_ms DOUBLE PRECISION := public.fare_policy_constant('gps_max_speed_kmh') / 3.6;
    v_deadband DOUBLE PRECISION := public.fare_policy_constant('gps_deadband_m');
    v_gap_flag INTEGER := public.fare_policy_constant('gps_gap_flag_seconds');
    v_reanchor INTEGER := public.fare_policy_constant('gps_reanchor_after_rejects');
    r RECORD;
    v_have_ref BOOLEAN := FALSE;
    v_ref_lat DOUBLE PRECISION;
    v_ref_lng DOUBLE PRECISION;
    v_ref_at TIMESTAMPTZ;
    v_anc_lat DOUBLE PRECISION;
    v_anc_lng DOUBLE PRECISION;
    v_anc_acc DOUBLE PRECISION;
    v_dist_m DOUBLE PRECISION := 0;
    v_total INTEGER := 0;
    v_usable INTEGER := 0;
    v_counted INTEGER := 0;
    v_rej_acc INTEGER := 0;
    v_rej_speed INTEGER := 0;
    v_streak INTEGER := 0;
    v_max_gap DOUBLE PRECISION := 0;
    v_jump_m DOUBLE PRECISION;
    v_dt DOUBLE PRECISION;
    v_step_m DOUBLE PRECISION;
    v_end_m DOUBLE PRECISION := NULL;
BEGIN
    FOR r IN
        SELECT g.latitude, g.longitude, g.accuracy, g.recorded_at
        FROM public.gps_log g
        WHERE g.booking_id = p_booking_id
        ORDER BY g.recorded_at, g.log_id
    LOOP
        v_total := v_total + 1;

        IF r.accuracy IS NULL OR r.accuracy < 0 OR r.accuracy > v_max_acc THEN
            v_rej_acc := v_rej_acc + 1;
            CONTINUE;
        END IF;

        IF NOT v_have_ref THEN
            v_have_ref := TRUE;
            v_ref_lat := r.latitude;  v_ref_lng := r.longitude;  v_ref_at := r.recorded_at;
            v_anc_lat := r.latitude;  v_anc_lng := r.longitude;  v_anc_acc := r.accuracy;
            v_usable := 1;
            v_counted := 1;
            CONTINUE;
        END IF;

        v_jump_m := public.calculate_haversine_distance_km(v_ref_lat, v_ref_lng, r.latitude, r.longitude) * 1000.0;
        v_dt := GREATEST(EXTRACT(EPOCH FROM (r.recorded_at - v_ref_at)), 1.0);
        IF v_jump_m / v_dt > v_max_ms THEN
            v_rej_speed := v_rej_speed + 1;
            v_streak := v_streak + 1;
            IF v_streak >= v_reanchor THEN
                v_ref_lat := r.latitude;  v_ref_lng := r.longitude;  v_ref_at := r.recorded_at;
                v_anc_lat := r.latitude;  v_anc_lng := r.longitude;  v_anc_acc := r.accuracy;
                v_streak := 0;
            END IF;
            CONTINUE;
        END IF;
        v_streak := 0;

        v_max_gap := GREATEST(v_max_gap, EXTRACT(EPOCH FROM (r.recorded_at - v_ref_at)));
        v_ref_lat := r.latitude;  v_ref_lng := r.longitude;  v_ref_at := r.recorded_at;
        v_usable := v_usable + 1;

        v_step_m := public.calculate_haversine_distance_km(v_anc_lat, v_anc_lng, r.latitude, r.longitude) * 1000.0;
        IF v_step_m >= GREATEST(v_deadband, v_anc_acc + r.accuracy) THEN
            v_dist_m := v_dist_m + v_step_m;
            v_anc_lat := r.latitude;  v_anc_lng := r.longitude;  v_anc_acc := r.accuracy;
            v_counted := v_counted + 1;
        END IF;
    END LOOP;

    IF v_have_ref AND p_dest_lat IS NOT NULL AND p_dest_lng IS NOT NULL THEN
        v_end_m := public.calculate_haversine_distance_km(v_ref_lat, v_ref_lng, p_dest_lat, p_dest_lng) * 1000.0;
    END IF;

    RETURN jsonb_build_object(
        'distance_km', round((v_dist_m / 1000.0)::NUMERIC, 3),
        'fixes_total', v_total,
        'fixes_usable', v_usable,
        'fixes_counted', v_counted,
        'rejected_accuracy', v_rej_acc,
        'rejected_speed', v_rej_speed,
        'max_gap_seconds', round(v_max_gap::NUMERIC, 1),
        'gap_flag', v_max_gap > v_gap_flag,
        'end_distance_to_destination_m', CASE WHEN v_end_m IS NULL THEN NULL ELSE round(v_end_m::NUMERIC, 1) END
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 5. driver_heartbeat: unchanged (Batch 4) except that a published fix is also logged
--    against the driver's trip in progress.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_heartbeat(
    p_latitude DOUBLE PRECISION DEFAULT NULL,
    p_longitude DOUBLE PRECISION DEFAULT NULL,
    p_accuracy_m DOUBLE PRECISION DEFAULT NULL,
    p_session_token UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_driver public.driver;
    v_publish BOOLEAN;
    v_reason TEXT := NULL;
    v_max_acc INTEGER := public.driver_presence_constant('location_max_accuracy_m');
BEGIN
    SELECT * INTO v_driver FROM public.driver WHERE auth_user_id = auth.uid();
    IF v_driver.driver_id IS NULL THEN
        RETURN public._presence_fail('ERR_NOT_A_DRIVER', 'No driver account for this login.');
    END IF;

    -- A device signed out by a newer login must not keep the session alive or publish a position.
    IF NOT public._login_session_current(v_driver.session_id, p_session_token) THEN
        RETURN public._presence_superseded();
    END IF;

    -- The server ended the session (auto-Offline, suspension, expiry...): tell the app.
    IF v_driver.availability_status = 'Offline' THEN
        RETURN jsonb_build_object('success', TRUE, 'location_accepted', FALSE) || public._driver_presence_state(v_driver.driver_id);
    END IF;

    v_publish := p_latitude IS NOT NULL AND p_longitude IS NOT NULL
        AND p_latitude BETWEEN -90 AND 90 AND p_longitude BETWEEN -180 AND 180;
    IF NOT v_publish THEN
        v_reason := 'no_position';
    ELSIF p_accuracy_m IS NULL OR p_accuracy_m < 0 OR p_accuracy_m > v_max_acc THEN
        v_publish := FALSE;
        v_reason := 'low_accuracy';      -- keep the last good fix; the heartbeat still counts as presence
    END IF;

    IF v_publish THEN
        UPDATE public.driver
        SET current_latitude = p_latitude,
            current_longitude = p_longitude,
            last_location_update = CURRENT_TIMESTAMP,
            last_location_accuracy_m = p_accuracy_m
        WHERE driver_id = v_driver.driver_id;

        -- Batch 5: the trip's recorded distance is replayed from these rows (Rule 6.2).
        PERFORM public._log_trip_fix(v_driver.driver_id, p_latitude, p_longitude, p_accuracy_m);
    END IF;

    UPDATE public.driver_online_session SET last_heartbeat_at = CURRENT_TIMESTAMP
    WHERE driver_id = v_driver.driver_id AND ended_at IS NULL;

    RETURN jsonb_build_object('success', TRUE, 'location_accepted', v_publish, 'location_rejected_reason', v_reason)
        || public._driver_presence_state(v_driver.driver_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 6. INSERT GUARD: the estimate is the database's, not the browser's
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.booking_fare_insert_guard()
RETURNS TRIGGER AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    -- is_service_context() (Batch 3) answers NULL, not FALSE, in a database session that has never set
    -- sakay.internal_context; "NOT NULL" is NULL, which would silently skip every lock below. Unknown = not trusted.
    v_service BOOLEAN := COALESCE(public.is_service_context(), FALSE);
    v_slack INTEGER := public.fare_policy_constant('future_request_slack_seconds');
    v_at TIMESTAMPTZ;
    v_rule public.fare_matrix;
    v_dist NUMERIC;
    v_straight_km NUMERIC;
    v_lo NUMERIC;
    v_hi NUMERIC;
    v_calc JSONB;
    v_expected NUMERIC;
BEGIN
    -- Rule 6.6: immediate pickup only.
    IF NEW.booking_type IS DISTINCT FROM 'Immediate' THEN
        RAISE EXCEPTION 'ERR_SCHEDULED_BOOKING_NOT_SUPPORTED: Hindi tumatanggap ang SAKAY ng naka-iskedyul na booking; para lamang ito sa agarang sakay. (Scheduled bookings are not supported; every booking is for immediate pickup.)';
    END IF;
    IF NEW.requested_at IS NOT NULL AND NEW.requested_at > v_now + make_interval(secs => v_slack) THEN
        RAISE EXCEPTION 'ERR_FUTURE_BOOKING_NOT_SUPPORTED: Hindi maaaring mag-book para sa hinaharap na oras. (A booking cannot be requested for a future time.)';
    END IF;

    -- The confirmation moment is the server's clock, never the device's.
    IF NOT v_service THEN
        NEW.requested_at := v_now;
        NEW.created_at := v_now;
    END IF;
    v_at := COALESCE(NEW.created_at, v_now);

    -- Trusted server code (imports, repairs, test data) may insert a booking without a quote.
    IF v_service AND NEW.estimated_distance_km IS NULL THEN
        RETURN NEW;
    END IF;

    -- D5: a booking needs a real route distance.
    v_dist := round(COALESCE(NEW.estimated_distance_km, 0)::NUMERIC, 3);
    IF v_dist <= 0 THEN
        RAISE EXCEPTION 'ERR_DISTANCE_REQUIRED: Kailangan ng distansya ng ruta bago makapag-book. (A route distance is required to book.)';
    END IF;

    -- The OSRM distance comes from the phone, so it is sanity-checked against the straight line
    -- between pickup and destination: a road is never meaningfully shorter, and rarely over 3x longer.
    v_straight_km := public.calculate_haversine_distance_km(
        NEW.pickup_latitude, NEW.pickup_longitude, NEW.dropoff_latitude, NEW.dropoff_longitude)::NUMERIC;
    v_lo := v_straight_km * public.fare_policy_constant('distance_min_pct_of_straight') / 100.0
            - public.fare_policy_constant('distance_min_slack_m') / 1000.0;
    v_hi := v_straight_km * public.fare_policy_constant('distance_max_factor')
            + public.fare_policy_constant('distance_max_slack_m') / 1000.0;
    IF v_dist < v_lo OR v_dist > v_hi THEN
        RAISE EXCEPTION 'ERR_DISTANCE_IMPLAUSIBLE: Hindi tugma ang distansya ng ruta sa pagitan ng pickup at destinasyon. Subukang muli. (The route distance does not match the pickup and destination.)';
    END IF;

    -- Rule 6.3: the rule in force when the booking is confirmed.
    v_rule := public.fare_rule_in_force(v_at);
    v_calc := public.calculate_fare(
        v_dist,
        CASE WHEN NEW.is_shared_trip THEN 'Shared' ELSE 'Solo' END,
        NEW.passenger_count,
        v_rule.base_fare, v_rule.base_distance_km, v_rule.succeeding_rate
    );
    v_expected := (v_calc->>'estimated_fare')::NUMERIC;

    -- The passenger confirms the fare they were shown (Rule 6.5). If a rate change landed in between,
    -- or the figure was tampered with, the booking is refused and the app re-quotes.
    IF NEW.estimated_fare IS NOT NULL AND NEW.estimated_fare IS DISTINCT FROM v_expected THEN
        RAISE EXCEPTION 'ERR_FARE_MISMATCH: Nagbago ang pamasahe. Pakisuri ang bagong halaga bago mag-book. (The fare has changed; please review the updated fare before booking.) [expected=%]', v_expected;
    END IF;

    NEW.estimated_fare := v_expected;
    IF NOT v_service THEN
        NEW.actual_fare := NULL;            -- the final fare does not exist until the trip ends
        NEW.actual_distance_km := NULL;
    END IF;
    NEW.fare_matrix_id := v_rule.fare_matrix_id;
    NEW.fare_locked_at := NULL;
    NEW.fare_breakdown := jsonb_build_object(
        'version', 1,
        'rule', public._fare_rule_json(v_rule),
        'estimate', v_calc,
        'final', NULL
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trigger_booking_fare_insert_guard ON public.booking;
CREATE TRIGGER trigger_booking_fare_insert_guard
    BEFORE INSERT ON public.booking
    FOR EACH ROW
    EXECUTE FUNCTION public.booking_fare_insert_guard();

-- ----------------------------------------------------------------------------
-- 7. UPDATE GUARD: locked inputs, system-owned fare, and the final-fare computation
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.booking_fare_update_guard()
RETURNS TRIGGER AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_snapshot JSONB;
    v_row public.fare_matrix;
    v_base NUMERIC;
    v_base_km NUMERIC;
    v_rate NUMERIC;
    v_cap INTEGER;
    v_est NUMERIC;
    v_track JSONB;
    v_usable INTEGER;
    v_rec NUMERIC;
    v_tol NUMERIC;
    v_billed NUMERIC;
    v_distance_basis TEXT;
    v_deviation BOOLEAN := FALSE;
    v_incomplete BOOLEAN;
    v_matched BOOLEAN;
    v_basis TEXT;
    v_calc JSONB;
    v_prev_calc JSONB;
    v_final NUMERIC;
    v_prev NUMERIC;
    v_components JSONB;
BEGIN
    -- 1. What nobody but trusted server code may change (Rules 6.2, 6.2.1).
    --    COALESCE: is_service_context() can answer NULL in a session that never set the internal-context setting,
    --    and "IF NOT NULL" would skip these locks (found by the live dry run). Unknown = not trusted.
    IF NOT COALESCE(public.is_service_context(), FALSE) THEN
        IF NEW.booking_type IS DISTINCT FROM OLD.booking_type
           OR NEW.is_shared_trip IS DISTINCT FROM OLD.is_shared_trip
           OR NEW.passenger_count IS DISTINCT FROM OLD.passenger_count
           OR NEW.pickup_address IS DISTINCT FROM OLD.pickup_address
           OR NEW.pickup_latitude IS DISTINCT FROM OLD.pickup_latitude
           OR NEW.pickup_longitude IS DISTINCT FROM OLD.pickup_longitude
           OR NEW.dropoff_address IS DISTINCT FROM OLD.dropoff_address
           OR NEW.dropoff_latitude IS DISTINCT FROM OLD.dropoff_latitude
           OR NEW.dropoff_longitude IS DISTINCT FROM OLD.dropoff_longitude
           OR NEW.estimated_distance_km IS DISTINCT FROM OLD.estimated_distance_km
           OR NEW.estimated_fare IS DISTINCT FROM OLD.estimated_fare
           OR NEW.fare_matrix_id IS DISTINCT FROM OLD.fare_matrix_id
           OR NEW.fare_breakdown IS DISTINCT FROM OLD.fare_breakdown THEN
            RAISE EXCEPTION 'ERR_BOOKING_LOCKED: Naka-lock na ang pickup, destinasyon at pamasahe ng booking na ito. (The pickup, destination and estimated fare are locked once a booking is confirmed.)';
        END IF;
        IF NEW.actual_fare IS DISTINCT FROM OLD.actual_fare
           OR NEW.actual_distance_km IS DISTINCT FROM OLD.actual_distance_km
           OR NEW.fare_locked_at IS DISTINCT FROM OLD.fare_locked_at THEN
            RAISE EXCEPTION 'ERR_FARE_LOCKED: Ang pinal na pamasahe ay kinakalkula ng sistema at hindi maaaring baguhin ninuman. (The final fare is computed by the system and cannot be edited by the passenger or the driver.)';
        END IF;
    END IF;

    -- 2. First arrival: compute and lock the final fare (Rule 6.2). Runs once.
    IF NEW.booking_status IN ('Arrived at Destination', 'Completed')
       AND OLD.booking_status IS DISTINCT FROM NEW.booking_status
       AND OLD.fare_locked_at IS NULL
       AND NEW.fare_locked_at IS NULL THEN

        IF NEW.estimated_distance_km IS NULL THEN
            NEW.fare_locked_at := v_now;           -- a row created without a quote: nothing to compute
            RETURN NEW;
        END IF;

        v_snapshot := NEW.fare_breakdown;
        IF v_snapshot IS NULL OR v_snapshot->'rule' IS NULL THEN
            -- A booking made before this batch: use the rule that was in force when it was created.
            v_row := public._fare_rule_row(COALESCE(NEW.created_at, v_now));
            IF v_row.fare_matrix_id IS NULL THEN
                NEW.fare_locked_at := v_now;
                RETURN NEW;
            END IF;
            NEW.fare_matrix_id := v_row.fare_matrix_id;
            v_snapshot := jsonb_build_object('version', 1, 'rule', public._fare_rule_json(v_row), 'estimate', NULL, 'final', NULL, 'legacy_rule_lookup', TRUE);
        END IF;

        v_base := (v_snapshot #>> '{rule,base_fare}')::NUMERIC;
        v_base_km := (v_snapshot #>> '{rule,base_distance_km}')::NUMERIC;
        v_rate := (v_snapshot #>> '{rule,succeeding_rate}')::NUMERIC;
        v_cap := COALESCE((v_snapshot #>> '{rule,seat_capacity}')::INTEGER, public.fare_policy_constant('seat_capacity'));
        v_est := round(NEW.estimated_distance_km::NUMERIC, 3);

        -- Which distance is billed (F5.2).
        v_track := public._trip_track_summary(NEW.booking_id, NEW.dropoff_latitude, NEW.dropoff_longitude);
        v_usable := (v_track->>'fixes_usable')::INTEGER;
        v_rec := CASE WHEN v_usable >= 2 THEN (v_track->>'distance_km')::NUMERIC ELSE NULL END;
        v_tol := GREATEST(
            public.fare_policy_constant('deviation_tolerance_m')::NUMERIC / 1000.0,
            v_est * public.fare_policy_constant('deviation_tolerance_pct') / 100.0
        );
        -- A track that has holes or stops short of the destination cannot prove the trip was SHORTER.
        v_incomplete := COALESCE((v_track->>'gap_flag')::BOOLEAN, FALSE)
            OR COALESCE((v_track->>'end_distance_to_destination_m')::NUMERIC > public.fare_policy_constant('gps_arrival_radius_m'), FALSE);

        IF v_rec IS NULL THEN
            v_billed := v_est;  v_distance_basis := 'estimate_no_track';
        ELSIF abs(v_rec - v_est) <= v_tol THEN
            v_billed := v_est;  v_distance_basis := 'estimate_within_tolerance';
        ELSIF v_rec < v_est AND v_incomplete THEN
            v_billed := v_est;  v_distance_basis := 'estimate_kept_incomplete_track';
        ELSE
            v_billed := v_rec;  v_distance_basis := 'actual_distance';  v_deviation := TRUE;
        END IF;

        -- Which fare applies (Rules 6.1.2, 6.5, 14.4).
        v_matched := NEW.is_shared_trip
            AND NEW.shared_trip_match_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM public.shared_trip_match m WHERE m.match_id = NEW.shared_trip_match_id AND m.match_status = 'Matched');
        v_basis := CASE
            WHEN NOT NEW.is_shared_trip THEN 'solo'
            WHEN v_matched THEN 'matched_estimate_pending_segments'   -- Batch 10 supplies the legs for allocate_shared_fares()
            ELSE 'unmatched_solo'                                      -- no partner: Maximum Unmatched Fare, no strike, no compensation
        END;

        v_calc := public.calculate_fare(v_billed, CASE WHEN v_matched THEN 'Shared' ELSE 'Solo' END, NEW.passenger_count, v_base, v_base_km, v_rate, v_cap);
        v_final := CASE WHEN v_matched THEN (v_calc->>'shared_matched_estimate') ELSE (v_calc->>'solo_fare') END::NUMERIC;
        v_components := CASE WHEN v_matched THEN v_calc->'shared_components' ELSE v_calc->'solo_components' END;

        IF v_deviation THEN
            v_prev_calc := public.calculate_fare(v_est, CASE WHEN v_matched THEN 'Shared' ELSE 'Solo' END, NEW.passenger_count, v_base, v_base_km, v_rate, v_cap);
            v_prev := CASE WHEN v_matched THEN (v_prev_calc->>'shared_matched_estimate') ELSE (v_prev_calc->>'solo_fare') END::NUMERIC;
            -- Rule 6.2.4: every deviation is recorded for audit.
            INSERT INTO public.fare_adjustment_history (
                booking_id, reason_code, previous_fare, new_fare,
                estimated_distance_km, actual_distance_km, tolerance_km, details, actor_role
            ) VALUES (
                NEW.booking_id, 'ROUTE_DEVIATION', v_prev, v_final,
                v_est, v_rec, round(v_tol, 3),
                jsonb_build_object(
                    'direction', CASE WHEN v_rec > v_est THEN 'longer' ELSE 'shorter' END,
                    'distance_basis', v_distance_basis,
                    'track', v_track
                ),
                'system'
            );
        END IF;

        NEW.actual_distance_km := v_rec::DOUBLE PRECISION;
        NEW.actual_fare := v_final;
        NEW.fare_locked_at := v_now;
        NEW.fare_breakdown := jsonb_set(v_snapshot, '{final}', jsonb_build_object(
            'basis', v_basis,
            'distance_basis', v_distance_basis,
            'billed_distance_km', v_billed,
            'estimated_distance_km', v_est,
            'recorded_distance_km', v_rec,
            'tolerance_km', round(v_tol, 3),
            'deviation', v_deviation,
            'track', v_track,
            'seat_fare', v_calc->'seat_fare',
            'excess_km', v_calc->'excess_km',
            'seat_capacity', v_cap,
            'components', v_components,
            'minimum_fare', v_calc->'minimum_fare',
            'actual_fare', v_final,
            'finalized_at', v_now
        ), TRUE);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trigger_booking_fare_update_guard ON public.booking;
CREATE TRIGGER trigger_booking_fare_update_guard
    BEFORE UPDATE ON public.booking
    FOR EACH ROW
    EXECUTE FUNCTION public.booking_fare_update_guard();

-- ----------------------------------------------------------------------------
-- 8. PRIVILEGES
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._booking_trip_in_progress(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._log_trip_fix(UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._trip_track_summary(UUID, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.booking_fare_insert_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.booking_fare_update_guard() FROM PUBLIC, anon, authenticated;
