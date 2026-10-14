-- ============================================================================
-- Migration: 20261025000001_batch10_ride_sharing.sql
-- Batch 10 - Ride-sharing: the Shared Trip pairing (Section 14; Rules 6.5, 12.5, 29.17, 4.4).
--
-- Until now nothing created a Shared Trip pairing: the table existed, the fare engine could settle a pair, and a cancellation closed one, but no
-- booking was ever matched. This migration adds the matching, in the database (the only authoritative place), and changes nothing that already
-- complies:
--
--   1. shared_trip_constant(): every number of the matching in ONE place (mirrored in policyConfig.ts; the drift test keeps both equal)
--   2. shared_trip_match: the columns of a proposal, a status vocabulary, unique "one open pairing per booking" indexes, a guard (<= 2 bookings,
--      <= 4 passengers, never the same passenger, both bookings Shared); passengers no longer read the table (they use the disclosure RPC)
--   3. the engine: a Shared booking that is searching is tried against the Shared Trips under way (Rules 14.2, 6.5): progress STRICTLY below 50%
--      (PI-10 A), pickup separation, bearing and added detour (F10.3 - F10.5), capacity, never the same passenger. Deterministic ranking.
--   4. the approvals, driver first (Rule 14.3, N2) then the first passenger (Rule 14.5): Accept / Decline, windows from the database, a timeout counts
--      as a Decline, no strike for anybody. The booking returns to the standard search when the proposal ends.
--   5. the disclosure RPC (Rule 14.2.1): only the permitted fields of the OTHER passenger and the driver block; nothing else leaves the database
--   6. the driver is attached to the second booking by ONE function (a flag-gated exception to "one open booking per driver")
--   7. per-leg rules (Rules 14.6, 12.5): the Batch 8 cancellation hook also closes a proposal; a driver who loses a booking closes its pairing
--   8. the fare (Rules 14.7, 6.1.3 - 6.1.5, PI-04 B): a matched leg is settled by allocate_shared_fares() from where each booking boarded and alighted
--      along the vehicle's route, capped at the booking's own Solo (Maximum Unmatched) fare; the Batch 5 estimate remains the fallback
--   9. the passenger-count report (Rules 14.7, 29.17): the driver reports a mismatch before the trip is finished; the fare is recomputed and the LGU
--      Administrator is flagged (strike PAX_UNDER_DECLARED_COUNT only after that administrator confirms)
--  10. the review flag for repeated declines of Shared requests (Rule 14.3, F10.7): review only, a strike (DRV_REPEATED_REFUSAL) only after an
--      administrator confirms
--
-- Functions replaced (verbatim copies of the newest definitions with the marked "Batch 10" additions): _dispatch_advance, dispatch_sweep,
-- booking_identity_guard, booking_fare_update_guard, admin_confirm_flagged_violation, _trip_track_summary (two optional arguments),
-- booking_shared_partner_on_cancel, block_driver_double_booking, _log_trip_fix.
-- Forward-only, ASCII only, safe to run twice.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. THE NUMBERS (one place)
-- ----------------------------------------------------------------------------
-- Code constants, mirrored in packages/shared/src/config/policyConfig.ts. The seat capacity (4) is NOT repeated here: fare_policy_constant('seat_capacity')
-- is its one source. The driver's response window is NOT repeated either: dispatch_constant('offer_window_seconds') (+ 'offer_grace_seconds').
CREATE OR REPLACE FUNCTION public.shared_trip_constant(p_key TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE p_key
        WHEN 'max_bookings'               THEN 2     -- Rule 14.1: a Shared Trip is at most two independently booked parties
        WHEN 'cutoff_progress_pct'        THEN 50    -- Rules 14.2 / 6.5, PI-10 Option A: matching only while the on-board progress is STRICTLY LESS than this
        WHEN 'pickup_separation_m'        THEN 600   -- F10.3: straight line from the first party's next stop to the second pickup
        WHEN 'detour_max_pct'             THEN 30    -- F10.4: added in-vehicle distance, percent of each party's own solo route ...
        WHEN 'detour_max_m'               THEN 1000  -- F10.4: ... and never more than this many metres
        WHEN 'bearing_max_deg'            THEN 45    -- F10.5: destination bearings may differ by at most this ...
        WHEN 'bearing_min_trip_m'         THEN 500   -- F10.5: ... when both trips are longer than this (straight line)
        WHEN 'passenger_response_seconds' THEN 20    -- F10.6: the first passenger's window; no answer counts as Decline (no strike)
        WHEN 'decline_flag_count'         THEN 3     -- F10.7: declines or timeouts of Shared requests in the window that raise a review flag (no strike)
        WHEN 'decline_flag_window_hours'  THEN 24    -- F10.7
        ELSE NULL
    END;
$$;

-- ----------------------------------------------------------------------------
-- 2. THE PAIRING TABLE
-- ----------------------------------------------------------------------------
-- One row per PROPOSAL (kept after it ends: declined proposals are the history the fraud checks of Rule 27.4 read). primary_booking_id is the
-- booking that already has the driver (the host), additional_booking_id the proposed second booking.
ALTER TABLE public.shared_trip_match
    ADD COLUMN IF NOT EXISTS host_driver_id UUID REFERENCES public.driver(driver_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS dispatch_cycle INTEGER,
    ADD COLUMN IF NOT EXISTS driver_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS driver_responded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS first_passenger_response VARCHAR(20),
    ADD COLUMN IF NOT EXISTS passenger_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS first_passenger_responded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pickup_gap_m INTEGER,
    ADD COLUMN IF NOT EXISTS bearing_diff_deg INTEGER,
    ADD COLUMN IF NOT EXISTS first_added_m INTEGER,
    ADD COLUMN IF NOT EXISTS second_added_m INTEGER,
    ADD COLUMN IF NOT EXISTS stop_order TEXT,
    ADD COLUMN IF NOT EXISTS closed_reason VARCHAR(40),
    ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

ALTER TABLE public.shared_trip_match DROP CONSTRAINT IF EXISTS shared_trip_match_status_check;
ALTER TABLE public.shared_trip_match ADD CONSTRAINT shared_trip_match_status_check
    CHECK (match_status IN ('Searching', 'Awaiting Driver', 'Awaiting Passenger', 'Matched', 'Declined', 'Expired', 'Cancelled'));
ALTER TABLE public.shared_trip_match DROP CONSTRAINT IF EXISTS shared_trip_match_driver_response_check;
ALTER TABLE public.shared_trip_match ADD CONSTRAINT shared_trip_match_driver_response_check
    CHECK (driver_response_status IN ('Pending', 'Accepted', 'Declined', 'Expired'));
ALTER TABLE public.shared_trip_match DROP CONSTRAINT IF EXISTS shared_trip_match_first_response_check;
ALTER TABLE public.shared_trip_match ADD CONSTRAINT shared_trip_match_first_response_check
    CHECK (first_passenger_response IS NULL OR first_passenger_response IN ('Pending', 'Accepted', 'Declined', 'Expired'));

-- A booking is in at most ONE open pairing (a late or repeated event cannot match it twice); the guard below adds the cross-role case
CREATE UNIQUE INDEX IF NOT EXISTS uq_shared_match_open_primary ON public.shared_trip_match (primary_booking_id)
    WHERE match_status IN ('Awaiting Driver', 'Awaiting Passenger', 'Matched');
CREATE UNIQUE INDEX IF NOT EXISTS uq_shared_match_open_additional ON public.shared_trip_match (additional_booking_id)
    WHERE additional_booking_id IS NOT NULL AND match_status IN ('Awaiting Driver', 'Awaiting Passenger', 'Matched');
CREATE INDEX IF NOT EXISTS idx_shared_match_live ON public.shared_trip_match (match_status)
    WHERE match_status IN ('Awaiting Driver', 'Awaiting Passenger');
CREATE INDEX IF NOT EXISTS idx_shared_match_host_driver ON public.shared_trip_match (host_driver_id, created_at DESC);
-- the sweep looks only at the Shared bookings that are still searching (the literal status list lets the database use this partial index)
CREATE INDEX IF NOT EXISTS idx_booking_shared_searching ON public.booking (booking_id)
    WHERE is_shared_trip AND booking_status IN ('Pending', 'Searching Driver');

-- Passengers (and drivers) no longer read pairing rows: what they may know is given by get_shared_match_state() / get_my_shared_request(), field by
-- field (Rule 14.2.1). The administrators keep reading the rows (the TODA's own bookings, the LGU all).
DROP POLICY IF EXISTS shared_trip_match_select_scoped ON public.shared_trip_match;
DROP POLICY IF EXISTS shared_trip_match_select_admin ON public.shared_trip_match;
CREATE POLICY shared_trip_match_select_admin ON public.shared_trip_match FOR SELECT TO authenticated
    USING (COALESCE(public.is_lgu_admin(), FALSE)
           OR public.rls_booking_in_my_toda(primary_booking_id)
           OR (additional_booking_id IS NOT NULL AND public.rls_booking_in_my_toda(additional_booking_id)));

-- The driver's report of a passenger count that differs from the declared one (Rules 14.7, 29.17). Written only by driver_report_passenger_count().
CREATE TABLE IF NOT EXISTS public.passenger_count_report (
    report_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES public.booking(booking_id) ON DELETE CASCADE,
    driver_id UUID REFERENCES public.driver(driver_id) ON DELETE SET NULL,
    declared_count INTEGER NOT NULL CHECK (declared_count BETWEEN 1 AND 4),
    actual_count INTEGER NOT NULL CHECK (actual_count BETWEEN 1 AND 10),
    note TEXT,
    phase VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- (a later report may put the count back to the declared one: the record is the history of the driver's corrections; the function refuses a report
-- that changes nothing)
CREATE INDEX IF NOT EXISTS idx_passenger_count_report_booking ON public.passenger_count_report (booking_id, created_at DESC);
ALTER TABLE public.passenger_count_report ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS passenger_count_report_select ON public.passenger_count_report;
CREATE POLICY passenger_count_report_select ON public.passenger_count_report FOR SELECT TO authenticated
    USING (public.rls_booking_visible(booking_id));
-- (no insert / update / delete policy: nobody writes this table from a browser)

-- ----------------------------------------------------------------------------
-- 3. SMALL GEOGRAPHIC HELPERS
-- ----------------------------------------------------------------------------
-- The barangays of Calapan City: the SAME list as packages/shared/src/config/calapanBarangays.ts (the drift test compares the two).
CREATE OR REPLACE FUNCTION public.calapan_barangays()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT ARRAY[
        'Balingayan', 'Balite', 'Baruyan', 'Batino', 'Bayanan I', 'Bayanan II', 'Biga', 'Bondoc', 'Bucayao', 'Buhuan',
        'Bulusan', 'Calero', 'Camansihan', 'Camilmil', 'Canubing I', 'Canubing II', 'Comunal', 'Guinobatan', 'Gulod',
        'Gutad', 'Ibaba East', 'Ibaba West', 'Ilaya', 'Lalud', 'Lazareto', 'Lumangbayan', 'Mahlabang', 'Malad',
        'Malamig', 'Managpi', 'Masipit', 'Navotas', 'Pachoca', 'Palhi', 'Panggalaan', 'Parang', 'Patas', 'Personas',
        'Puting Tubig', 'San Antonio', 'San Vicente Central', 'San Vicente East', 'San Vicente North', 'San Vicente South',
        'San Vicente West', 'Sapul', 'Silonay', 'Sta. Cruz', 'Sta. Isabel', 'Sta. Maria Village', 'Suqui', 'Tawiran', 'Tibag', 'Wawa'
    ]::TEXT[];
$$;

-- The Calapan barangay named in an address, or NULL: what the Passenger PWA may show as "approximate pickup area" (Rule 14.2.1). Same matching as
-- barangayOfAddress() in transportAnalytics.ts (whole-word, longest name first). The address itself never leaves the database.
CREATE OR REPLACE FUNCTION public._area_of_address(p_address TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
    SELECT n
      FROM unnest(public.calapan_barangays()) AS n
     WHERE lower(COALESCE(p_address, '')) ~ ('(^|[^a-z0-9])' || regexp_replace(lower(n), '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '($|[^a-z0-9])')
     ORDER BY length(n) DESC, n
     LIMIT 1;
$fn$;

-- The initial bearing from one point to another, degrees clockwise from north in [0, 360): the formula of bearingDegrees() in heading.ts
CREATE OR REPLACE FUNCTION public._bearing_deg(p_lat1 DOUBLE PRECISION, p_lng1 DOUBLE PRECISION, p_lat2 DOUBLE PRECISION, p_lng2 DOUBLE PRECISION)
RETURNS DOUBLE PRECISION
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT mod((degrees(atan2(sin(radians(p_lng2 - p_lng1)) * cos(radians(p_lat2)),
                              cos(radians(p_lat1)) * sin(radians(p_lat2)) - sin(radians(p_lat1)) * cos(radians(p_lat2)) * cos(radians(p_lng2 - p_lng1)))) + 360)::NUMERIC, 360)::DOUBLE PRECISION;
$$;

-- "General destination direction" (Rule 14.2.1): one of eight compass points
CREATE OR REPLACE FUNCTION public._compass_8(p_bearing DOUBLE PRECISION)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT (ARRAY['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'])[1 + (floor((p_bearing + 22.5) / 45.0)::INTEGER % 8)];
$$;

-- A road-distance estimate between two points, in metres: the straight line times the winding factor the dispatch already uses (eta_winding_percent)
CREATE OR REPLACE FUNCTION public._shared_road_m(p_lat1 DOUBLE PRECISION, p_lng1 DOUBLE PRECISION, p_lat2 DOUBLE PRECISION, p_lng2 DOUBLE PRECISION)
RETURNS DOUBLE PRECISION
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT public.calculate_haversine_distance_km(p_lat1, p_lng1, p_lat2, p_lng2) * 1000.0 * public.dispatch_constant('eta_winding_percent') / 100.0;
$$;



-- ----------------------------------------------------------------------------
-- 2b. THE TRACK REPLAY WITH A MOMENT AND A PARTNER (replaces 20261007000003; the Batch 5 behaviour is unchanged when both new arguments are NULL)
-- ----------------------------------------------------------------------------
-- A function whose argument list grows is a NEW function: the old three-argument one is dropped first (every caller passes at most three arguments and
-- still resolves, because the new ones have defaults).
DROP FUNCTION IF EXISTS public._trip_track_summary(UUID, DOUBLE PRECISION, DOUBLE PRECISION);
CREATE OR REPLACE FUNCTION public._trip_track_summary(
    p_booking_id UUID,
    p_dest_lat DOUBLE PRECISION DEFAULT NULL,
    p_dest_lng DOUBLE PRECISION DEFAULT NULL,
    p_until TIMESTAMPTZ DEFAULT NULL,
    p_partner_booking_id UUID DEFAULT NULL
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
        WHERE (g.booking_id = p_booking_id OR g.booking_id = p_partner_booking_id)          -- Batch 10: the partner's track too (a Shared Trip's route; a fix logged on both trips adds no distance: the same point twice is inside the dead-band)
          AND (p_until IS NULL OR g.recorded_at <= p_until)                                  -- Batch 10: up to a moment
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
-- 4. THE ENGINE (all internal: no client can call these; the apps use the RPCs of section 5)
-- ----------------------------------------------------------------------------
-- The progress the cutoff is measured on (PI-10, decision N3): the ON-BOARD progress, whole percent, the figure the apps and the finish gate already
-- use (_trip_progress_pct: straight line, the best the trip has reached). It is 0 until the first passenger has boarded, so matching stays open through
-- the approach; 100 once the trip has arrived.
CREATE OR REPLACE FUNCTION public._shared_progress_pct(p_booking public.booking)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_phase TEXT := public._booking_phase(p_booking.booking_status);
BEGIN
    RETURN CASE
        WHEN v_phase IN ('searching', 'assigned', 'arrived') THEN 0
        WHEN v_phase = 'ongoing' THEN COALESCE(public._trip_progress_pct(p_booking.booking_id), 0)
        WHEN v_phase IN ('at_destination', 'completed') THEN 100
        ELSE NULL
    END;
END;
$$;

-- Are a host trip and a searching booking compatible? A deterministic, explainable test (figures F10.3 - F10.5), no network:
--   F10.3  the second pickup is within pickup_separation_m (straight line) of the first party's next stop: the first pickup while that party has not
--          boarded, the vehicle's position once they have;
--   F10.5  when both trips are longer than bearing_min_trip_m, their destination bearings differ by at most bearing_max_deg;
--   F10.4  in the best stop order in which both are on board together, nobody's added in-vehicle distance exceeds detour_max_pct of their own solo
--          route or detour_max_m (road distances are straight lines times the dispatch's winding factor).
-- Returns {ok, reason, gap_m, bearing_diff_deg, first_added_m, second_added_m, order}.
CREATE OR REPLACE FUNCTION public._shared_evaluate(p_host public.booking, p_cand public.booking, p_vlat DOUBLE PRECISION, p_vlng DOUBLE PRECISION)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_boarded BOOLEAN := public._booking_phase(p_host.booking_status) = 'ongoing';
    v_sep INTEGER := public.shared_trip_constant('pickup_separation_m');
    v_pct INTEGER := public.shared_trip_constant('detour_max_pct');
    v_cap_m INTEGER := public.shared_trip_constant('detour_max_m');
    v_bmax INTEGER := public.shared_trip_constant('bearing_max_deg');
    v_bmin INTEGER := public.shared_trip_constant('bearing_min_trip_m');
    -- the five points: 1 the vehicle, 2 the host's pickup, 3 the host's destination, 4 the second pickup, 5 the second destination
    v_lat DOUBLE PRECISION[] := ARRAY[p_vlat, p_host.pickup_latitude, p_host.dropoff_latitude, p_cand.pickup_latitude, p_cand.dropoff_latitude];
    v_lng DOUBLE PRECISION[] := ARRAY[p_vlng, p_host.pickup_longitude, p_host.dropoff_longitude, p_cand.pickup_longitude, p_cand.dropoff_longitude];
    v_names TEXT[] := ARRAY['V', 'AP', 'AD', 'BP', 'BD'];
    v_next INTEGER := CASE WHEN v_boarded THEN 1 ELSE 2 END;
    v_gap DOUBLE PRECISION;
    v_len1 DOUBLE PRECISION;
    v_len2 DOUBLE PRECISION;
    v_diff DOUBLE PRECISION := NULL;
    v_solo1 DOUBLE PRECISION;
    v_solo2 DOUBLE PRECISION;
    v_base1 DOUBLE PRECISION;
    -- the stop orders in which BOTH are on board together at some moment (an order with no overlap shares nothing)
    v_seqs INTEGER[] := CASE WHEN v_boarded
        THEN ARRAY[[4, 3, 5], [4, 5, 3]]
        ELSE ARRAY[[2, 4, 3, 5], [2, 4, 5, 3], [4, 2, 3, 5], [4, 2, 5, 3]] END;
    v_i INTEGER;
    v_j INTEGER;
    v_prev INTEGER;
    v_cum DOUBLE PRECISION;
    v_pos DOUBLE PRECISION[];
    v_s INTEGER;
    v_f1 DOUBLE PRECISION;
    v_f2 DOUBLE PRECISION;
    v_best_i INTEGER := NULL;
    v_best_score DOUBLE PRECISION := NULL;
    v_best_f1 DOUBLE PRECISION;
    v_best_f2 DOUBLE PRECISION;
    v_ord TEXT;
    v_lim1 DOUBLE PRECISION;
    v_lim2 DOUBLE PRECISION;
BEGIN
    IF p_vlat IS NULL OR p_vlng IS NULL THEN
        RETURN jsonb_build_object('ok', FALSE, 'reason', 'no_vehicle_position');
    END IF;

    -- F10.3
    v_gap := public.calculate_haversine_distance_km(v_lat[v_next], v_lng[v_next], v_lat[4], v_lng[4]) * 1000.0;
    IF v_gap > v_sep THEN
        RETURN jsonb_build_object('ok', FALSE, 'reason', 'pickup_too_far', 'gap_m', round(v_gap::NUMERIC));
    END IF;

    -- F10.5
    v_len1 := public.calculate_haversine_distance_km(v_lat[v_next], v_lng[v_next], v_lat[3], v_lng[3]) * 1000.0;
    v_len2 := public.calculate_haversine_distance_km(v_lat[4], v_lng[4], v_lat[5], v_lng[5]) * 1000.0;
    IF v_len1 > v_bmin AND v_len2 > v_bmin THEN
        v_diff := abs(public._bearing_deg(v_lat[v_next], v_lng[v_next], v_lat[3], v_lng[3]) - public._bearing_deg(v_lat[4], v_lng[4], v_lat[5], v_lng[5]));
        IF v_diff > 180 THEN
            v_diff := 360 - v_diff;
        END IF;
        IF v_diff > v_bmax THEN
            RETURN jsonb_build_object('ok', FALSE, 'reason', 'direction', 'gap_m', round(v_gap::NUMERIC), 'bearing_diff_deg', round(v_diff::NUMERIC));
        END IF;
    END IF;

    -- F10.4
    v_solo1 := public._shared_road_m(v_lat[2], v_lng[2], v_lat[3], v_lng[3]);
    v_solo2 := public._shared_road_m(v_lat[4], v_lng[4], v_lat[5], v_lng[5]);
    v_base1 := CASE WHEN v_boarded THEN public._shared_road_m(v_lat[1], v_lng[1], v_lat[3], v_lng[3]) ELSE v_solo1 END;
    v_lim1 := LEAST(v_cap_m::DOUBLE PRECISION, v_solo1 * v_pct / 100.0);
    v_lim2 := LEAST(v_cap_m::DOUBLE PRECISION, v_solo2 * v_pct / 100.0);
    FOR v_i IN 1..array_length(v_seqs, 1) LOOP
        v_prev := 1;
        v_cum := 0;
        v_pos := ARRAY[0, 0, 0, 0, 0]::DOUBLE PRECISION[];
        FOR v_j IN 1..array_length(v_seqs, 2) LOOP
            v_s := v_seqs[v_i][v_j];
            v_cum := v_cum + public._shared_road_m(v_lat[v_prev], v_lng[v_prev], v_lat[v_s], v_lng[v_s]);
            v_pos[v_s] := v_cum;
            v_prev := v_s;
        END LOOP;
        v_f1 := GREATEST(0, (v_pos[3] - CASE WHEN v_boarded THEN 0 ELSE v_pos[2] END) - v_base1);
        v_f2 := GREATEST(0, (v_pos[5] - v_pos[4]) - v_solo2);
        IF v_f1 <= v_lim1 AND v_f2 <= v_lim2 AND (v_best_score IS NULL OR v_f1 + v_f2 < v_best_score) THEN
            v_best_i := v_i;
            v_best_score := v_f1 + v_f2;
            v_best_f1 := v_f1;
            v_best_f2 := v_f2;
        END IF;
    END LOOP;
    IF v_best_i IS NULL THEN
        RETURN jsonb_build_object('ok', FALSE, 'reason', 'detour', 'gap_m', round(v_gap::NUMERIC),
                                  'bearing_diff_deg', CASE WHEN v_diff IS NULL THEN NULL ELSE round(v_diff::NUMERIC) END);
    END IF;
    SELECT string_agg(v_names[v_seqs[v_best_i][k]], '>' ORDER BY k) INTO v_ord FROM generate_series(1, array_length(v_seqs, 2)) AS k;
    RETURN jsonb_build_object('ok', TRUE, 'reason', NULL, 'gap_m', round(v_gap::NUMERIC),
                              'bearing_diff_deg', CASE WHEN v_diff IS NULL THEN NULL ELSE round(v_diff::NUMERIC) END,
                              'first_added_m', round(v_best_f1::NUMERIC), 'second_added_m', round(v_best_f2::NUMERIC), 'order', v_ord);
END;
$$;

-- The best Shared Trip under way for a searching Shared booking, or NULL. A host is a Shared booking that HAS a driver, is on its way, at the pickup or
-- under way (progress strictly below the cutoff), whose driver is working and located, that has no open pairing, whose passenger did not opt out of
-- sharing (a Decline closes the matching of that trip for good, decision N7), and that is not the same passenger (decision N5). The same driver is not
-- asked about the same booking twice in one search cycle. The best = the smallest added detour; a tie goes to the host accepted first, then the lowest id.
CREATE OR REPLACE FUNCTION public._shared_best_host(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_b public.booking;
    v_a public.booking;
    v_cap INTEGER := public.fare_policy_constant('seat_capacity');
    v_cut INTEGER := public.shared_trip_constant('cutoff_progress_pct');
    r RECORD;
    v_prog INTEGER;
    v_ev JSONB;
    v_score DOUBLE PRECISION;
    v_best JSONB := NULL;
    v_best_score DOUBLE PRECISION := NULL;
    v_best_acc TIMESTAMPTZ := NULL;
    v_best_id UUID := NULL;
BEGIN
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    FOR r IN
        SELECT a.booking_id AS host_id, d.driver_id AS host_driver, d.current_latitude AS vlat, d.current_longitude AS vlng
          FROM public.booking a
          JOIN public.driver d ON d.driver_id = a.driver_id
         WHERE a.is_shared_trip
           AND a.driver_id IS NOT NULL
           AND public._booking_phase(a.booking_status) IN ('assigned', 'arrived', 'ongoing')
           AND a.passenger_id IS DISTINCT FROM v_b.passenger_id
           AND a.passenger_count + v_b.passenger_count <= v_cap
           AND d.availability_status <> 'Offline'
           AND d.account_status = 'Verified'
           AND d.current_latitude IS NOT NULL AND d.current_longitude IS NOT NULL
           AND public.driver_has_fresh_location(d.driver_id)
           AND NOT COALESCE((public.account_restriction_state('driver', d.driver_id)->>'restricted')::BOOLEAN, FALSE)
           AND NOT EXISTS (SELECT 1 FROM public.shared_trip_match m
                            WHERE (m.primary_booking_id = a.booking_id OR m.additional_booking_id = a.booking_id)
                              AND m.match_status IN ('Awaiting Driver', 'Awaiting Passenger', 'Matched'))
           AND NOT EXISTS (SELECT 1 FROM public.shared_trip_match m                      -- the first passenger said No (or did not answer): this trip stays Solo
                            WHERE m.primary_booking_id = a.booking_id AND m.first_passenger_response IN ('Declined', 'Expired'))
           AND NOT EXISTS (SELECT 1 FROM public.shared_trip_match m                      -- already tried for this booking in this search cycle
                            WHERE m.additional_booking_id = v_b.booking_id AND m.dispatch_cycle IS NOT DISTINCT FROM v_b.dispatch_cycle
                              AND (m.primary_booking_id = a.booking_id OR m.host_driver_id = a.driver_id)
                              AND m.match_status IN ('Declined', 'Expired', 'Cancelled'))
           AND NOT EXISTS (SELECT 1 FROM public.shared_trip_match m                      -- a driver who cancelled this booking is not offered it again by a pairing
                            WHERE (m.primary_booking_id = v_b.booking_id OR m.additional_booking_id = v_b.booking_id)
                              AND m.host_driver_id = a.driver_id AND m.closed_reason = 'driver_cancelled')
         ORDER BY a.booking_id
    LOOP
        SELECT * INTO v_a FROM public.booking WHERE booking_id = r.host_id;
        v_prog := public._shared_progress_pct(v_a);
        CONTINUE WHEN v_prog IS NULL OR v_prog >= v_cut;                                 -- PI-10 A: strictly below the cutoff
        v_ev := public._shared_evaluate(v_a, v_b, r.vlat, r.vlng);
        CONTINUE WHEN NOT COALESCE((v_ev->>'ok')::BOOLEAN, FALSE);
        v_score := (v_ev->>'first_added_m')::DOUBLE PRECISION + (v_ev->>'second_added_m')::DOUBLE PRECISION;
        IF v_best IS NULL OR v_score < v_best_score
           OR (v_score = v_best_score AND (v_a.accepted_at < v_best_acc OR (v_a.accepted_at IS NOT DISTINCT FROM v_best_acc AND v_a.booking_id < v_best_id))) THEN
            v_best := v_ev || jsonb_build_object('host_booking_id', v_a.booking_id, 'host_driver_id', r.host_driver, 'progress_pct', v_prog);
            v_best_score := v_score;
            v_best_acc := v_a.accepted_at;
            v_best_id := v_a.booking_id;
        END IF;
    END LOOP;
    RETURN v_best;
END;
$$;

-- Why a proposal is no longer good (NULL = it still is). Checked by the sweep, by the standard search and by both answers.
CREATE OR REPLACE FUNCTION public._shared_stale_reason(p_m public.shared_trip_match, p_now TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_a public.booking;
    v_b public.booking;
BEGIN
    SELECT * INTO v_a FROM public.booking WHERE booking_id = p_m.primary_booking_id;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_m.additional_booking_id;
    IF v_a.booking_id IS NULL OR public._booking_phase(v_a.booking_status) NOT IN ('assigned', 'arrived', 'ongoing')
       OR v_a.driver_id IS DISTINCT FROM p_m.host_driver_id THEN
        RETURN 'host_ended';
    END IF;
    IF v_b.booking_id IS NULL OR NOT public._booking_is_searching(v_b.booking_status) THEN
        RETURN 'booking_ended';
    END IF;
    IF COALESCE(public._shared_progress_pct(v_a), 100) >= public.shared_trip_constant('cutoff_progress_pct') THEN
        RETURN 'cutoff';                                                                 -- the matching window of this trip has closed
    END IF;
    IF p_m.match_status = 'Awaiting Driver' AND p_m.driver_expires_at <= p_now THEN
        RETURN 'driver_timeout';
    END IF;
    IF p_m.match_status = 'Awaiting Passenger' AND p_m.passenger_expires_at <= p_now THEN
        RETURN 'passenger_timeout';
    END IF;
    RETURN NULL;
END;
$$;

-- A driver who declines or ignores several Shared requests in the window is flagged for review (Rule 14.3, F10.7). A flag only: a strike
-- (DRV_REPEATED_REFUSAL) needs the administrator's confirmation (admin_confirm_flagged_violation).
CREATE OR REPLACE FUNCTION public._shared_decline_flag(p_driver_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_window INTERVAL := make_interval(hours => public.shared_trip_constant('decline_flag_window_hours'));
    v_n INTEGER;
BEGIN
    IF p_driver_id IS NULL THEN
        RETURN;
    END IF;
    SELECT count(*) INTO v_n FROM public.shared_trip_match m
     WHERE m.host_driver_id = p_driver_id AND m.driver_response_status IN ('Declined', 'Expired')
       AND COALESCE(m.closed_at, m.created_at) >= clock_timestamp() - v_window;
    IF v_n >= public.shared_trip_constant('decline_flag_count') THEN
        PERFORM public._presence_flag('DRIVER_SHARED_REQUEST_DECLINES', p_driver_id, 'Rule 14.3',
            jsonb_build_object('declines_in_window', v_n, 'window_hours', public.shared_trip_constant('decline_flag_window_hours'),
                               'note', 'Review flag only. A strike (DRV_REPEATED_REFUSAL) needs the administrator''s confirmation after checking whether the driver refused compatible Shared requests without a valid operational reason while available (Rule 14.3).'));
    END IF;
END;
$$;

-- The booking goes back to the standard search NOW (its hold, if any, is over)
CREATE OR REPLACE FUNCTION public._shared_release_booking(p_booking_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
BEGIN
    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.booking SET dispatch_next_action_at = clock_timestamp()
     WHERE booking_id = p_booking_id AND booking_status IN ('Pending', 'Searching Driver');
    IF FOUND THEN
        BEGIN
            PERFORM public._dispatch_advance(p_booking_id);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'shared match: booking % could not return to the search (%); the sweep will advance it', p_booking_id, SQLERRM;
        END;
    END IF;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
END;
$$;

-- Ends a pairing (or a proposal) for ONE reason, once. The caller holds the locks (the bookings first, then the row: the order every function of this
-- migration uses). p_release: the second booking goes straight back to the standard search if it is still searching.
--   driver_declined / driver_timeout / passenger_declined / passenger_timeout -> Declined   (no strike for anybody; Rules 14.3, 14.5)
--   cutoff / host_ended / booking_ended                                       -> Expired
--   party_cancelled / driver_cancelled                                        -> Cancelled  (Rules 12.5, 14.6)
CREATE OR REPLACE FUNCTION public._shared_close_match(p_match_id UUID, p_reason TEXT, p_release BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_m public.shared_trip_match;
    v_status TEXT;
    v_prev TEXT := current_setting('sakay.internal_context', true);
BEGIN
    SELECT * INTO v_m FROM public.shared_trip_match WHERE match_id = p_match_id FOR UPDATE;
    IF NOT FOUND OR v_m.match_status NOT IN ('Awaiting Driver', 'Awaiting Passenger', 'Matched') THEN
        RETURN FALSE;                                                                   -- already ended: a repeated or late event does nothing
    END IF;
    v_status := CASE
        WHEN p_reason IN ('driver_declined', 'driver_timeout', 'passenger_declined', 'passenger_timeout') THEN 'Declined'
        WHEN p_reason IN ('party_cancelled', 'driver_cancelled') THEN 'Cancelled'
        ELSE 'Expired' END;
    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.shared_trip_match
       SET match_status = v_status,
           closed_reason = p_reason,
           closed_at = clock_timestamp(),
           driver_response_status = CASE p_reason WHEN 'driver_declined' THEN 'Declined' WHEN 'driver_timeout' THEN 'Expired' ELSE driver_response_status END,
           driver_responded_at = CASE WHEN p_reason = 'driver_declined' THEN clock_timestamp() ELSE driver_responded_at END,
           first_passenger_response = CASE p_reason WHEN 'passenger_declined' THEN 'Declined' WHEN 'passenger_timeout' THEN 'Expired' ELSE first_passenger_response END,
           first_passenger_responded_at = CASE WHEN p_reason = 'passenger_declined' THEN clock_timestamp() ELSE first_passenger_responded_at END
     WHERE match_id = p_match_id;
    PERFORM public.record_policy_audit('SHARED_MATCH_CLOSED', p_match_id::TEXT, NULL, 'Shared Trips',
        'A shared-trip pairing or proposal ended: ' || p_reason || '. No strike for any party.', jsonb_build_object('match_status', v_m.match_status),
        jsonb_build_object('match_status', v_status, 'reason', p_reason, 'primary_booking_id', v_m.primary_booking_id, 'additional_booking_id', v_m.additional_booking_id));
    IF p_reason IN ('driver_declined', 'driver_timeout') THEN
        PERFORM public._shared_decline_flag(v_m.host_driver_id);
    END IF;
    IF p_release AND v_m.additional_booking_id IS NOT NULL AND v_m.match_status IN ('Awaiting Driver', 'Awaiting Passenger') THEN
        PERFORM public._shared_release_booking(v_m.additional_booking_id);
    END IF;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN TRUE;
END;
$$;

-- Called by the standard search before it offers the booking to anybody: TRUE while a live proposal holds the booking (Rules 14.3, 14.5: the booking
-- returns to the standard search when the proposal ends). A proposal that has run out is closed here, without waiting for any lock somebody else holds.
CREATE OR REPLACE FUNCTION public._shared_proposal_blocks(p_booking_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_m public.shared_trip_match;
    v_reason TEXT;
BEGIN
    SELECT * INTO v_m FROM public.shared_trip_match
     WHERE additional_booking_id = p_booking_id AND match_status IN ('Awaiting Driver', 'Awaiting Passenger')
     ORDER BY created_at DESC LIMIT 1;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    v_reason := public._shared_stale_reason(v_m, clock_timestamp());
    IF v_reason IS NULL THEN
        RETURN TRUE;
    END IF;
    PERFORM 1 FROM public.booking WHERE booking_id = v_m.primary_booking_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN
        RETURN TRUE;                                                                    -- somebody is answering it right now
    END IF;
    PERFORM 1 FROM public.shared_trip_match WHERE match_id = v_m.match_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN
        RETURN TRUE;
    END IF;
    PERFORM public._shared_close_match(v_m.match_id, v_reason, FALSE);                 -- the caller carries on with the standard search itself
    RETURN FALSE;
END;
$$;

-- Tries a searching Shared booking against the trips under way. TRUE = a proposal now holds the booking.
CREATE OR REPLACE FUNCTION public._shared_try_propose(p_booking_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_b public.booking;
    v_best JSONB;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_exp TIMESTAMPTZ;
    v_id UUID;
    v_prev TEXT := current_setting('sakay.internal_context', true);
BEGIN
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id;
    IF NOT FOUND OR NOT v_b.is_shared_trip OR NOT public._booking_is_searching(v_b.booking_status)
       OR v_b.passenger_count >= public.fare_policy_constant('seat_capacity') THEN
        RETURN FALSE;                                                                   -- a booking of 4 never matches (decision N4)
    END IF;
    IF EXISTS (SELECT 1 FROM public.shared_trip_match m
                WHERE (m.additional_booking_id = p_booking_id OR m.primary_booking_id = p_booking_id)
                  AND m.match_status IN ('Awaiting Driver', 'Awaiting Passenger', 'Matched')) THEN
        RETURN FALSE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.dispatch_attempt a                                   -- a standard offer is out: one at a time
                WHERE a.booking_id = p_booking_id AND a.response_status = 'Pending' AND (a.expires_at IS NULL OR a.expires_at > v_now)) THEN
        RETURN FALSE;
    END IF;
    v_best := public._shared_best_host(p_booking_id);
    IF v_best IS NULL THEN
        RETURN FALSE;
    END IF;
    v_exp := v_now + make_interval(secs => public.dispatch_constant('offer_window_seconds') + public.dispatch_constant('offer_grace_seconds'));
    BEGIN
        PERFORM set_config('sakay.internal_context', 'true', true);
        INSERT INTO public.shared_trip_match (
            primary_booking_id, additional_booking_id, host_driver_id, dispatch_cycle, route_progress_at_request,
            driver_response_status, match_status, driver_expires_at, pickup_gap_m, bearing_diff_deg, first_added_m, second_added_m, stop_order
        ) VALUES (
            (v_best->>'host_booking_id')::UUID, p_booking_id, (v_best->>'host_driver_id')::UUID, v_b.dispatch_cycle, (v_best->>'progress_pct')::NUMERIC,
            'Pending', 'Awaiting Driver', v_exp, (v_best->>'gap_m')::INTEGER, (v_best->>'bearing_diff_deg')::INTEGER,
            (v_best->>'first_added_m')::INTEGER, (v_best->>'second_added_m')::INTEGER, v_best->>'order'
        ) RETURNING match_id INTO v_id;
        UPDATE public.booking SET dispatch_next_action_at = v_exp WHERE booking_id = p_booking_id;
        PERFORM public.record_policy_audit('SHARED_MATCH_PROPOSED', v_id::TEXT, NULL, 'Shared Trips',
            'A compatible Shared booking was proposed to the driver of a Shared Trip under way (Rules 14.2, 14.3).', NULL,
            jsonb_build_object('match_id', v_id, 'primary_booking_id', v_best->>'host_booking_id', 'additional_booking_id', p_booking_id,
                               'progress_pct', v_best->'progress_pct', 'pickup_gap_m', v_best->'gap_m', 'bearing_diff_deg', v_best->'bearing_diff_deg',
                               'first_added_m', v_best->'first_added_m', 'second_added_m', v_best->'second_added_m', 'order', v_best->'order'));
        PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
        RETURN TRUE;
    EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
        RAISE WARNING 'shared match: booking % could not be proposed (%)', p_booking_id, SQLERRM;
        RETURN FALSE;                                                                   -- e.g. another booking took the same host a moment ago
    END;
END;
$$;

-- Run by dispatch_sweep() every few seconds (and by every online driver's poll): proposals that ran out of time or of cutoff are closed, and every
-- searching Shared booking is tried against the trips under way ("actively searching", Rule 14.2).
CREATE OR REPLACE FUNCTION public.shared_match_sweep()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    r RECORD;
    v_m public.shared_trip_match;
    v_n INTEGER := 0;
    v_locked INTEGER;
    v_reason TEXT;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_lim INTEGER := public.dispatch_constant('sweep_batch_limit');
BEGIN
    PERFORM set_config('sakay.internal_context', 'true', true);
    FOR r IN
        SELECT m.match_id, m.primary_booking_id, m.additional_booking_id
          FROM public.shared_trip_match m
         WHERE m.match_status IN ('Awaiting Driver', 'Awaiting Passenger')
         ORDER BY m.created_at
         LIMIT v_lim
    LOOP
        BEGIN
            SELECT count(*) INTO v_locked FROM (
                SELECT 1 FROM public.booking WHERE booking_id IN (r.primary_booking_id, r.additional_booking_id)
                 ORDER BY booking_id FOR UPDATE SKIP LOCKED) x;
            CONTINUE WHEN v_locked < 2;                                                 -- somebody is working on it: next time
            PERFORM 1 FROM public.shared_trip_match WHERE match_id = r.match_id FOR UPDATE SKIP LOCKED;
            CONTINUE WHEN NOT FOUND;
            SELECT * INTO v_m FROM public.shared_trip_match WHERE match_id = r.match_id;
            CONTINUE WHEN v_m.match_status NOT IN ('Awaiting Driver', 'Awaiting Passenger');
            v_reason := public._shared_stale_reason(v_m, clock_timestamp());
            IF v_reason IS NOT NULL AND public._shared_close_match(v_m.match_id, v_reason, TRUE) THEN
                v_n := v_n + 1;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'shared match sweep: proposal % could not be closed (%)', r.match_id, SQLERRM;
        END;
    END LOOP;

    FOR r IN
        SELECT b.booking_id
          FROM public.booking b
         WHERE b.is_shared_trip AND b.booking_status IN ('Pending', 'Searching Driver')   -- the literal list: idx_booking_shared_searching
         ORDER BY b.created_at
         LIMIT v_lim
    LOOP
        BEGIN
            PERFORM 1 FROM public.booking WHERE booking_id = r.booking_id FOR UPDATE SKIP LOCKED;
            CONTINUE WHEN NOT FOUND;
            IF public._shared_try_propose(r.booking_id) THEN
                v_n := v_n + 1;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'shared match sweep: booking % could not be tried (%)', r.booking_id, SQLERRM;
        END;
    END LOOP;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN v_n;
END;
$$;



-- ----------------------------------------------------------------------------
-- 5. WHAT THE APPS CALL
-- ----------------------------------------------------------------------------
-- 5.1 The driver's Additional Shared Passenger Request (Rule 14.3): the one unanswered, unexpired request of this driver, or NULL. The driver is
-- shown what the offer screen shows (first name only, Rule 11.1) plus what the pairing means for the trip under way.
CREATE OR REPLACE FUNCTION public.get_my_shared_request()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_driver UUID := public.get_current_driver_id();
    v_m public.shared_trip_match;
    v_a public.booking;
    v_b public.booking;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_window INTEGER := public.dispatch_constant('offer_window_seconds');
BEGIN
    IF v_driver IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_m FROM public.shared_trip_match m
     WHERE m.host_driver_id = v_driver AND m.match_status = 'Awaiting Driver' AND m.driver_expires_at > v_now
     ORDER BY m.created_at DESC LIMIT 1;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_a FROM public.booking WHERE booking_id = v_m.primary_booking_id;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = v_m.additional_booking_id;
    IF NOT FOUND OR v_a.driver_id IS DISTINCT FROM v_driver OR NOT public._booking_is_searching(v_b.booking_status) THEN
        RETURN NULL;
    END IF;
    RETURN jsonb_build_object(
        'match_id', v_m.match_id,
        'booking_id', v_b.booking_id,
        'passenger_first_name', (SELECT public.passenger_first_name(p.full_name) FROM public.passenger p WHERE p.passenger_id = v_b.passenger_id),
        'passenger_count', v_b.passenger_count,
        'pickup_address', v_b.pickup_address,
        'pickup_latitude', v_b.pickup_latitude,
        'pickup_longitude', v_b.pickup_longitude,
        'dropoff_address', v_b.dropoff_address,
        'dropoff_latitude', v_b.dropoff_latitude,
        'dropoff_longitude', v_b.dropoff_longitude,
        'estimated_distance_km', v_b.estimated_distance_km,
        'current_party_size', v_a.passenger_count,
        'host_progress_pct', v_m.route_progress_at_request,
        'pickup_gap_m', v_m.pickup_gap_m,
        'first_added_m', v_m.first_added_m,
        'second_added_m', v_m.second_added_m,
        'window_seconds', v_window,
        'seconds_remaining', GREATEST(0, LEAST(v_window, ceil(EXTRACT(EPOCH FROM (v_m.driver_expires_at - v_now))))),
        'expires_at', v_m.driver_expires_at,
        'server_time', v_now
    );
END;
$$;

-- 5.2 The driver's answer (Rule 14.3). Accept sends the request on to the first passenger; Decline costs nothing and returns the booking to the
-- standard search. A repeated tap changes nothing. Locks: the bookings (ascending), then the pairing row.
CREATE OR REPLACE FUNCTION public.driver_respond_shared_request(p_match_id UUID, p_accept BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_driver UUID := public.get_current_driver_id();
    v_m public.shared_trip_match;
    v_a public.booking;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_reason TEXT;
    v_exp TIMESTAMPTZ;
    v_result JSONB;
BEGIN
    IF v_driver IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_A_DRIVER', 'error', 'Only a driver can answer a shared-passenger request.');
    END IF;
    IF p_accept IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_INVALID_ANSWER', 'error', 'Answer Accept or Decline.');
    END IF;
    SELECT * INTO v_m FROM public.shared_trip_match WHERE match_id = p_match_id AND host_driver_id = v_driver;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_REQUEST_NOT_FOUND', 'error', 'This request does not exist.');
    END IF;
    PERFORM 1 FROM public.booking WHERE booking_id IN (v_m.primary_booking_id, v_m.additional_booking_id) ORDER BY booking_id FOR UPDATE;
    SELECT * INTO v_m FROM public.shared_trip_match WHERE match_id = p_match_id FOR UPDATE;

    IF p_accept AND v_m.match_status IN ('Awaiting Passenger', 'Matched') AND v_m.driver_response_status = 'Accepted' THEN
        RETURN jsonb_build_object('success', TRUE, 'already_answered', TRUE, 'state', CASE WHEN v_m.match_status = 'Matched' THEN 'matched' ELSE 'awaiting_passenger' END);
    END IF;
    IF NOT p_accept AND v_m.match_status = 'Declined' AND v_m.driver_response_status = 'Declined' THEN
        RETURN jsonb_build_object('success', TRUE, 'already_answered', TRUE, 'state', 'declined');
    END IF;
    IF v_m.match_status <> 'Awaiting Driver' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_REQUEST_CLOSED', 'error', 'This request is no longer open.');
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    v_reason := public._shared_stale_reason(v_m, v_now);
    IF v_reason IS NOT NULL THEN
        PERFORM public._shared_close_match(v_m.match_id, v_reason, TRUE);
        v_result := jsonb_build_object('success', FALSE, 'error_code', CASE WHEN v_reason = 'driver_timeout' THEN 'ERR_REQUEST_EXPIRED' ELSE 'ERR_MATCHING_CLOSED' END,
                                       'error', 'The time to answer this request has ended, or the shared trip can no longer take another passenger.');
    ELSIF NOT p_accept THEN
        PERFORM public._shared_close_match(v_m.match_id, 'driver_declined', TRUE);
        v_result := jsonb_build_object('success', TRUE, 'state', 'declined');
    ELSE
        v_exp := v_now + make_interval(secs => public.shared_trip_constant('passenger_response_seconds'));
        UPDATE public.shared_trip_match
           SET match_status = 'Awaiting Passenger', driver_response_status = 'Accepted', driver_responded_at = v_now,
               first_passenger_response = 'Pending', passenger_expires_at = v_exp
         WHERE match_id = v_m.match_id;
        UPDATE public.booking SET dispatch_next_action_at = v_exp + interval '5 seconds' WHERE booking_id = v_m.additional_booking_id;
        SELECT * INTO v_a FROM public.booking WHERE booking_id = v_m.primary_booking_id;
        PERFORM public._notify_subject('passenger', v_a.passenger_id, 'SHARED_MATCH_REQUEST',
            'May gustong sumabay sa biyahe mo (A passenger may share your ride)',
            'A compatible passenger can share this ride. Open the app to Accept or Decline the Shared Match; you have ' || public.shared_trip_constant('passenger_response_seconds')
            || ' seconds. Declining is free and the trip stays Solo. (May pasaherong puwedeng sumabay. Buksan ang app para tanggapin o tanggihan; '
            || public.shared_trip_constant('passenger_response_seconds') || ' segundo ang oras. Libre ang tumanggi at mananatiling Solo ang biyahe.)',
            v_m.match_id::TEXT, 1);
        PERFORM public.record_policy_audit('SHARED_MATCH_DRIVER_ACCEPTED', v_m.match_id::TEXT, NULL, 'Shared Trips',
            'The driver accepted an Additional Shared Passenger Request (Rule 14.3); the first passenger is asked (Rule 14.5).', NULL,
            jsonb_build_object('match_id', v_m.match_id, 'driver_id', v_driver));
        v_result := jsonb_build_object('success', TRUE, 'state', 'awaiting_passenger', 'passenger_expires_at', v_exp);
    END IF;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN v_result;
END;
$$;

-- 5.3 The first passenger's answer (Rule 14.5): Accept Shared Match / Decline Shared Match. Decline (or no answer) keeps the trip Solo at the
-- Maximum Unmatched Fare, returns the second booking to the standard search, and strikes nobody. Accept attaches the second booking to the driver in
-- ONE transaction, after checking again that matching is still open and the tricycle still has room.
CREATE OR REPLACE FUNCTION public.passenger_respond_shared_match(p_match_id UUID, p_accept BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_pax UUID := public.get_current_passenger_id();
    v_m public.shared_trip_match;
    v_a public.booking;
    v_b public.booking;
    v_d public.driver;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_reason TEXT;
    v_result JSONB;
BEGIN
    IF v_pax IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_A_PASSENGER', 'error', 'Only a passenger can answer a shared match.');
    END IF;
    IF p_accept IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_INVALID_ANSWER', 'error', 'Answer Accept or Decline.');
    END IF;
    SELECT * INTO v_m FROM public.shared_trip_match WHERE match_id = p_match_id;
    IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.booking x WHERE x.booking_id = v_m.primary_booking_id AND x.passenger_id = v_pax) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_MATCH_NOT_FOUND', 'error', 'This shared match does not exist.');
    END IF;
    PERFORM 1 FROM public.booking WHERE booking_id IN (v_m.primary_booking_id, v_m.additional_booking_id) ORDER BY booking_id FOR UPDATE;
    SELECT * INTO v_m FROM public.shared_trip_match WHERE match_id = p_match_id FOR UPDATE;

    IF p_accept AND v_m.match_status = 'Matched' THEN
        RETURN jsonb_build_object('success', TRUE, 'already_answered', TRUE, 'state', 'matched');
    END IF;
    IF NOT p_accept AND v_m.match_status = 'Declined' AND v_m.first_passenger_response = 'Declined' THEN
        RETURN jsonb_build_object('success', TRUE, 'already_answered', TRUE, 'state', 'declined');
    END IF;
    IF v_m.match_status <> 'Awaiting Passenger' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_MATCH_CLOSED', 'error', 'This shared match is no longer open.');
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    v_reason := public._shared_stale_reason(v_m, v_now);
    IF v_reason IS NOT NULL THEN
        PERFORM public._shared_close_match(v_m.match_id, v_reason, TRUE);
        PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
        RETURN jsonb_build_object('success', FALSE, 'error_code', CASE WHEN v_reason = 'passenger_timeout' THEN 'ERR_RESPONSE_EXPIRED' ELSE 'ERR_MATCHING_CLOSED' END,
                                  'error', 'The time to answer has ended, or this trip can no longer take another passenger. Your trip continues as it was.');
    END IF;

    IF NOT p_accept THEN
        PERFORM public._shared_close_match(v_m.match_id, 'passenger_declined', TRUE);
        PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
        RETURN jsonb_build_object('success', TRUE, 'state', 'declined');
    END IF;

    BEGIN
        SELECT * INTO v_a FROM public.booking WHERE booking_id = v_m.primary_booking_id;
        SELECT * INTO v_b FROM public.booking WHERE booking_id = v_m.additional_booking_id;
        IF v_a.passenger_count + v_b.passenger_count > public.fare_policy_constant('seat_capacity') THEN
            RAISE EXCEPTION 'ERR_SHARED_CAPACITY_EXCEEDED: Lampas sa 4 ang pasahero. (More than 4 passengers.)';
        END IF;
        SELECT * INTO v_d FROM public.driver WHERE driver_id = v_a.driver_id FOR UPDATE;
        PERFORM set_config('sakay.shared_attach', v_m.match_id::TEXT, true);            -- the one exception to "one open booking per driver" (block_driver_double_booking)
        UPDATE public.booking
           SET driver_id = v_a.driver_id,
               booking_status = 'Accepted',
               accepted_at = v_now,
               accept_latitude = v_d.current_latitude,
               accept_longitude = v_d.current_longitude,
               accept_accuracy_m = v_d.last_location_accuracy_m,
               stall_anchor_latitude = v_d.current_latitude,
               stall_anchor_longitude = v_d.current_longitude,
               stall_anchor_at = v_now,
               dispatch_ended_reason = 'accepted',
               shared_trip_match_id = v_m.match_id
         WHERE booking_id = v_b.booking_id;
        UPDATE public.booking SET shared_trip_match_id = v_m.match_id WHERE booking_id = v_a.booking_id;
        UPDATE public.shared_trip_match
           SET match_status = 'Matched', first_passenger_response = 'Accepted', first_passenger_responded_at = v_now, matched_at = v_now
         WHERE match_id = v_m.match_id;
        PERFORM set_config('sakay.shared_attach', '', true);
        PERFORM public._notify_subject('passenger', v_b.passenger_id, 'SHARED_MATCH_CONFIRMED',
            'May kasabay ka na (You are sharing a ride)',
            'Your shared ride is confirmed: the driver is on the way. The fare conditions you accepted when booking apply (Matched Shared Fare, never more than the Maximum Unmatched Fare). '
            || '(Kumpirmado ang shared ride mo: papunta na ang drayber.)', v_m.match_id::TEXT, 2);
        PERFORM public._notify_subject('passenger', v_a.passenger_id, 'SHARED_MATCH_CONFIRMED',
            'Kumpirmado ang kasabay (Shared ride confirmed)',
            'Another passenger will share this ride. The driver will pick them up on the way. (May kasabay ka sa biyaheng ito; susunduin sila ng drayber.)', v_m.match_id::TEXT, 2);
        PERFORM public.record_policy_audit('SHARED_MATCH_CONFIRMED', v_m.match_id::TEXT, NULL, 'Shared Trips',
            'The first passenger accepted the Shared Match (Rule 14.5); the second booking was attached to the same driver.', NULL,
            jsonb_build_object('match_id', v_m.match_id, 'primary_booking_id', v_a.booking_id, 'additional_booking_id', v_b.booking_id, 'driver_id', v_a.driver_id));
        v_result := jsonb_build_object('success', TRUE, 'state', 'matched');
    EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('sakay.shared_attach', '', true);
        v_reason := SQLERRM;
        -- the match cannot be made (the driver became restricted, the booking was cancelled in the same moment...): it ends without any fault of the passenger
        PERFORM public._shared_close_match(v_m.match_id, 'host_ended', TRUE);
        v_result := jsonb_build_object('success', FALSE, 'error_code', COALESCE(substring(v_reason FROM '^(ERR_[A-Z_]+)'), 'ERR_CANNOT_MATCH'), 'error', v_reason);
    END;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN v_result;
END;
$$;

-- 5.4 What a passenger may know (Rule 14.2.1). For the passenger's OWN booking: whether matching is still open, where a proposal stands, and - only
-- while a match awaits consent or is confirmed - the limited facts about the OTHER passenger and the driver block. NEVER: a name, a phone number, an
-- address, a coordinate, the other booking's id. This function is the only way the apps learn any of it.
CREATE OR REPLACE FUNCTION public.get_shared_match_state(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_me UUID := public.get_current_passenger_id();
    v_b public.booking;
    v_m public.shared_trip_match;
    v_o public.booking;
    v_pass public.passenger;
    v_drv public.driver;
    v_role TEXT := NULL;
    v_state TEXT := 'none';
    v_now TIMESTAMPTZ := clock_timestamp();
    v_cut INTEGER := public.shared_trip_constant('cutoff_progress_pct');
    v_progress INTEGER;
    v_open BOOLEAN := FALSE;
    v_other JSONB := NULL;
    v_driver JSONB := NULL;
    v_exp TIMESTAMPTZ := NULL;
    v_secs INTEGER := NULL;
    v_found BOOLEAN;
BEGIN
    IF v_me IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_A_PASSENGER', 'error', 'Only a passenger can look at a shared match.');
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id AND passenger_id = v_me;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_YOUR_BOOKING', 'error', 'This booking does not belong to you.');
    END IF;

    -- the live pairing of this booking, else the latest one that ended
    SELECT * INTO v_m FROM public.shared_trip_match m
     WHERE m.primary_booking_id = p_booking_id OR m.additional_booking_id = p_booking_id
     ORDER BY (m.match_status IN ('Awaiting Driver', 'Awaiting Passenger', 'Matched')) DESC, m.created_at DESC LIMIT 1;
    v_found := FOUND;
    IF v_found THEN
        v_role := CASE WHEN v_m.primary_booking_id = p_booking_id THEN 'first' ELSE 'second' END;
        v_state := CASE v_m.match_status
            WHEN 'Awaiting Driver' THEN CASE WHEN v_role = 'second' THEN 'proposed' ELSE 'none' END     -- the first passenger is asked only once the driver has agreed
            WHEN 'Awaiting Passenger' THEN CASE WHEN v_role = 'first' THEN 'awaiting_my_consent' ELSE 'awaiting_first_passenger' END
            WHEN 'Matched' THEN 'matched'
            ELSE 'closed' END;
        IF v_m.match_status = 'Awaiting Passenger' THEN
            v_exp := v_m.passenger_expires_at;
            v_secs := GREATEST(0, ceil(EXTRACT(EPOCH FROM (v_exp - v_now))))::INTEGER;
        END IF;
        IF v_state IN ('awaiting_my_consent', 'awaiting_first_passenger', 'matched') THEN
            SELECT * INTO v_o FROM public.booking
             WHERE booking_id = CASE WHEN v_role = 'first' THEN v_m.additional_booking_id ELSE v_m.primary_booking_id END;
            SELECT * INTO v_pass FROM public.passenger WHERE passenger_id = v_o.passenger_id;
            v_other := jsonb_build_object(
                'mobile_verified', COALESCE(v_pass.account_status = 'Active', FALSE),
                'party_size', v_o.passenger_count,
                'pickup_area', public._area_of_address(v_o.pickup_address),
                'direction', public._compass_8(public._bearing_deg(v_o.pickup_latitude, v_o.pickup_longitude, v_o.dropoff_latitude, v_o.dropoff_longitude)));
            SELECT * INTO v_drv FROM public.driver WHERE driver_id = v_m.host_driver_id;
            v_driver := jsonb_build_object(
                'name', v_drv.full_name,
                'vehicle', 'Tricycle',
                'plate_number', v_drv.plate_number,
                'franchise_number', v_drv.franchise_number);
        END IF;
    END IF;

    -- is the system still looking for a second passenger for this booking? (the cutoff screen of Rule 6.5)
    v_progress := public._shared_progress_pct(v_b);
    v_open := v_b.is_shared_trip AND v_b.driver_id IS NOT NULL
              AND public._booking_phase(v_b.booking_status) IN ('assigned', 'arrived', 'ongoing')
              AND COALESCE(v_progress, 100) < v_cut
              AND v_b.passenger_count < public.fare_policy_constant('seat_capacity')
              AND NOT EXISTS (SELECT 1 FROM public.shared_trip_match x
                               WHERE (x.primary_booking_id = p_booking_id OR x.additional_booking_id = p_booking_id)
                                 AND x.match_status IN ('Awaiting Driver', 'Awaiting Passenger', 'Matched'))
              AND NOT EXISTS (SELECT 1 FROM public.shared_trip_match x
                               WHERE x.primary_booking_id = p_booking_id AND x.first_passenger_response IN ('Declined', 'Expired'));

    RETURN jsonb_build_object(
        'success', TRUE,
        'booking_id', p_booking_id,
        'is_shared_trip', v_b.is_shared_trip,
        'role', v_role,
        'state', v_state,
        'match_id', CASE WHEN v_state IN ('proposed', 'awaiting_my_consent', 'awaiting_first_passenger', 'matched') THEN v_m.match_id END,
        'closed_reason', CASE WHEN v_state = 'closed' AND v_role = 'first' THEN v_m.closed_reason END,
        'matching_open', v_open,
        'progress_pct', v_progress,
        'cutoff_pct', v_cut,
        'expires_at', v_exp,
        'seconds_remaining', v_secs,
        'other', v_other,
        'driver', v_driver,
        'server_time', v_now
    );
END;
$$;



-- ----------------------------------------------------------------------------
-- 6. THE GUARDS AND HOOKS
-- ----------------------------------------------------------------------------
-- 6.1 Capacity and identity of a pairing, enforced for every writer (a client cannot write the table at all; the server and the engine pass here too).
--     Rule 14.1: two bookings, at most 4 passengers together, both Shared; decision N5: never the same passenger; a booking is in one open pairing.
CREATE OR REPLACE FUNCTION public.shared_trip_match_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_a public.booking;
    v_b public.booking;
BEGIN
    IF NEW.additional_booking_id IS NULL THEN
        RETURN NEW;                                                                      -- a row without a second booking pairs nobody
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.primary_booking_id = OLD.primary_booking_id
       AND NEW.additional_booking_id IS NOT DISTINCT FROM OLD.additional_booking_id
       AND NEW.match_status IN ('Declined', 'Expired', 'Cancelled') THEN
        RETURN NEW;                                                                      -- ending a pairing needs no checks
    END IF;
    IF NEW.primary_booking_id = NEW.additional_booking_id THEN
        RAISE EXCEPTION 'ERR_SHARED_SAME_BOOKING: A booking cannot be paired with itself.' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO v_a FROM public.booking WHERE booking_id = NEW.primary_booking_id;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = NEW.additional_booking_id;
    IF v_a.booking_id IS NULL OR v_b.booking_id IS NULL OR NOT v_a.is_shared_trip OR NOT v_b.is_shared_trip THEN
        RAISE EXCEPTION 'ERR_SHARED_NOT_SHARED: Only two Shared bookings can be paired.' USING ERRCODE = 'P0001';
    END IF;
    IF v_a.passenger_id IS NOT NULL AND v_a.passenger_id IS NOT DISTINCT FROM v_b.passenger_id THEN
        RAISE EXCEPTION 'ERR_SHARED_SAME_PASSENGER: Two bookings of the same passenger cannot share a trip.' USING ERRCODE = 'P0001';
    END IF;
    IF v_a.passenger_count + v_b.passenger_count > public.fare_policy_constant('seat_capacity') THEN
        RAISE EXCEPTION 'ERR_SHARED_CAPACITY_EXCEEDED: Lampas sa % ang pasahero ng Shared Trip. (A Shared Trip carries at most % passengers together.)',
            public.fare_policy_constant('seat_capacity'), public.fare_policy_constant('seat_capacity') USING ERRCODE = 'P0001';
    END IF;
    IF NEW.match_status IN ('Awaiting Driver', 'Awaiting Passenger', 'Matched') AND EXISTS (
        SELECT 1 FROM public.shared_trip_match m
         WHERE m.match_id <> NEW.match_id AND m.match_status IN ('Awaiting Driver', 'Awaiting Passenger', 'Matched')
           AND (m.primary_booking_id IN (v_a.booking_id, v_b.booking_id) OR m.additional_booking_id IN (v_a.booking_id, v_b.booking_id))) THEN
        RAISE EXCEPTION 'ERR_SHARED_ALREADY_PAIRED: A booking is in one shared pairing at a time (at most % bookings per Shared Trip).', public.shared_trip_constant('max_bookings') USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_shared_trip_match_guard ON public.shared_trip_match;
CREATE TRIGGER trigger_shared_trip_match_guard BEFORE INSERT OR UPDATE ON public.shared_trip_match
    FOR EACH ROW EXECUTE FUNCTION public.shared_trip_match_guard();

-- 6.2 One open booking per driver (replaces 20261014000002) - with ONE exception: passenger_respond_shared_match() attaches the second booking of an
-- accepted pairing to the driver of the first. It names the pairing in a transaction-local setting; the exception holds only when that pairing is in
-- the state of the acceptance, the driver is the host's driver, the host is the ONLY other open booking of the driver, and the booking is the pairing's
-- additional booking. Nothing else can attach a second booking.
CREATE OR REPLACE FUNCTION public.block_driver_double_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_attach TEXT := COALESCE(current_setting('sakay.shared_attach', true), '');
BEGIN
    IF OLD.driver_id IS NULL AND NEW.driver_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.booking b
                    WHERE b.driver_id = NEW.driver_id AND b.booking_id <> NEW.booking_id
                      AND public._booking_is_open_accepted(b.booking_status)) THEN
        IF v_attach <> '' AND EXISTS (
               SELECT 1 FROM public.shared_trip_match m
                 JOIN public.booking a ON a.booking_id = m.primary_booking_id
                WHERE m.match_id::TEXT = v_attach AND m.match_status = 'Awaiting Passenger'
                  AND m.additional_booking_id = NEW.booking_id AND a.driver_id = NEW.driver_id)
           AND NOT EXISTS (
               SELECT 1 FROM public.booking b
                 JOIN public.shared_trip_match m ON m.match_id::TEXT = v_attach
                WHERE b.driver_id = NEW.driver_id AND b.booking_id <> NEW.booking_id AND b.booking_id <> m.primary_booking_id
                  AND public._booking_is_open_accepted(b.booking_status)) THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'ERR_DRIVER_HAS_OPEN_BOOKING: You already have a booking in progress. Finish it before taking another.' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

-- 6.3 A party of a pairing cancels before the pickup (Rules 12.5, 14.6; replaces 20261023000001): only the cancelling party is evaluated (the status
-- triggers read that booking alone). A proposal that is still out ends; a Matched pairing is closed, so the fare guard bills the remaining booking
-- the Solo (Maximum Unmatched) fare it accepted when booking, without a new confirmation, and - because the remaining booking again has a driver, no
-- open pairing and progress below the cutoff - the engine looks for a replacement until the cutoff.
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
    v_was TEXT;
    v_prev TEXT := current_setting('sakay.internal_context', true);
BEGIN
    IF public._booking_phase(OLD.booking_status) NOT IN ('searching', 'assigned', 'arrived') THEN
        RETURN NULL;                                          -- after the pickup a party cannot cancel; only before it (Rule 12.5)
    END IF;
    FOR v_m IN
        SELECT * FROM public.shared_trip_match m
         WHERE m.match_status IN ('Awaiting Driver', 'Awaiting Passenger', 'Matched')
           AND (m.primary_booking_id = NEW.booking_id OR m.additional_booking_id = NEW.booking_id)
         ORDER BY m.created_at
    LOOP
        v_partner_id := CASE WHEN v_m.primary_booking_id = NEW.booking_id THEN v_m.additional_booking_id ELSE v_m.primary_booking_id END;
        v_was := v_m.match_status;
        PERFORM set_config('sakay.internal_context', 'true', true);
        IF public._shared_close_match(v_m.match_id, 'party_cancelled', TRUE) AND v_was = 'Matched' THEN
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
        END IF;
        PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    END LOOP;
    RETURN NULL;
END;
$$;

-- 6.4 A booking that loses its driver (the driver cancelled it before the pickup, Rules 12.3 / 12.4, and it goes back to the search) leaves its pairing:
-- a proposal ends, a Matched pairing closes, the other party continues Solo (Rule 14.6: the legs are independent).
CREATE OR REPLACE FUNCTION public.booking_shared_release_on_driver_loss()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_m public.shared_trip_match;
    v_partner_id UUID;
    v_partner public.booking;
    v_was TEXT;
    v_prev TEXT := current_setting('sakay.internal_context', true);
BEGIN
    FOR v_m IN
        SELECT * FROM public.shared_trip_match m
         WHERE m.match_status IN ('Awaiting Driver', 'Awaiting Passenger', 'Matched')
           AND (m.primary_booking_id = NEW.booking_id OR m.additional_booking_id = NEW.booking_id)
         ORDER BY m.created_at
    LOOP
        v_partner_id := CASE WHEN v_m.primary_booking_id = NEW.booking_id THEN v_m.additional_booking_id ELSE v_m.primary_booking_id END;
        v_was := v_m.match_status;
        PERFORM set_config('sakay.internal_context', 'true', true);
        IF public._shared_close_match(v_m.match_id, 'driver_cancelled', TRUE) AND v_was = 'Matched' AND v_partner_id IS NOT NULL THEN
            SELECT * INTO v_partner FROM public.booking WHERE booking_id = v_partner_id;
            IF FOUND AND v_partner.passenger_id IS NOT NULL AND v_partner.booking_status NOT IN ('Cancelled', 'Completed') THEN
                PERFORM public._notify_subject('passenger', v_partner.passenger_id, 'SHARED_PARTNER_CANCELLED',
                    'Nagbago ang kasama mo sa shared trip (Your shared-trip partner changed)',
                    'Your trip continues. Because no one is sharing it now, it is charged the Solo fare you accepted when you booked; you do not need to confirm anything. '
                    || '(Tuloy ang biyahe mo. Dahil walang kasabay, ang Solo fare na pinayagan mo noong nag-book ka ang sisingilin.)',
                    v_partner.booking_id::TEXT, 2);
            END IF;
        END IF;
        PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    END LOOP;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trigger_booking_shared_release_on_driver_loss ON public.booking;
CREATE TRIGGER trigger_booking_shared_release_on_driver_loss AFTER UPDATE OF driver_id ON public.booking
    FOR EACH ROW WHEN (OLD.driver_id IS NOT NULL AND NEW.driver_id IS NULL AND OLD.is_shared_trip)
    EXECUTE FUNCTION public.booking_shared_release_on_driver_loss();

-- 6.5 The driver's published fix is logged against every trip he carries (replaces 20261007000003). Batch 10: the second leg of a Shared Trip is not
-- judged "stalled" (Rules 8.2 - 8.4) while the vehicle is at the first passenger's pickup or carrying the first passenger: its stall clock restarts at
-- every fix, so a driver who waits for the first passenger is never cancelled and struck for the second.
CREATE OR REPLACE FUNCTION public._log_trip_fix(
    p_driver_id UUID,
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_accuracy_m DOUBLE PRECISION
)
RETURNS VOID AS $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
BEGIN
    INSERT INTO public.gps_log (booking_id, driver_id, latitude, longitude, accuracy, sync_status)
    SELECT b.booking_id, p_driver_id, p_latitude, p_longitude, p_accuracy_m, 'Synced'
    FROM public.booking b
    WHERE b.driver_id = p_driver_id
      AND public._booking_trip_in_progress(b.booking_status)
      AND b.fare_locked_at IS NULL;

    IF EXISTS (SELECT 1 FROM public.booking b
                WHERE b.driver_id = p_driver_id AND b.is_shared_trip AND public._booking_phase(b.booking_status) = 'assigned'
                  AND b.shared_trip_match_id IS NOT NULL) THEN
        PERFORM set_config('sakay.internal_context', 'true', true);
        UPDATE public.booking b
           SET stall_anchor_latitude = p_latitude, stall_anchor_longitude = p_longitude, stall_anchor_at = clock_timestamp(),
               stall_anchor_accuracy_m = p_accuracy_m, stall_warned_at = NULL
         WHERE b.driver_id = p_driver_id AND public._booking_phase(b.booking_status) = 'assigned'
           AND EXISTS (SELECT 1 FROM public.shared_trip_match m JOIN public.booking a ON a.booking_id = m.primary_booking_id
                        WHERE m.additional_booking_id = b.booking_id AND m.match_status = 'Matched'
                          AND public._booking_phase(a.booking_status) IN ('arrived', 'ongoing'));
        PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;



-- ----------------------------------------------------------------------------
-- 6.6 THE SYSTEM'S COLUMNS (replaces 20261023000001): the pairing id joins the list the people on the booking cannot edit
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

    -- Batch 10: which pairing a booking belongs to is the system's alone (the fare of a matched trip depends on it)
    IF NEW.shared_trip_match_id IS DISTINCT FROM OLD.shared_trip_match_id THEN
        RAISE EXCEPTION 'ERR_MATCH_LOCKED: The shared-trip pairing is managed by the system and cannot be edited.' USING ERRCODE = '42501';
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
-- 6.7 THE ORCHESTRATOR OF THE SEARCH (replaces 20261019000001; two additions marked "Batch 10")
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._dispatch_advance(p_booking_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_b public.booking;
    v_att public.dispatch_attempt;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_now TIMESTAMPTZ;
    v_loops INTEGER := 0;
    v_tier SMALLINT;
    v_tier_started TIMESTAMPTZ;
    v_reached3 TIMESTAMPTZ;
    v_radius INTEGER;
    v_max INTEGER := public.dispatch_constant('tier3_max_seconds');
    v_refresh INTEGER := public.dispatch_constant('tier3_refresh_seconds');
    v_hold INTEGER := public.dispatch_constant('offer_window_seconds') + public.dispatch_constant('offer_grace_seconds');
    v_expiry TIMESTAMPTZ;
    v_next TIMESTAMPTZ;
    v_result TEXT := 'inactive';
    v_online BOOLEAN;
BEGIN
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND OR NOT public._booking_is_searching(v_b.booking_status) THEN
        RETURN 'inactive';
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);

    -- Batch 10 (Rules 14.3, 14.5): while a shared-match proposal is out for this booking the standard search waits; it carries on when the proposal ends
    IF v_b.is_shared_trip AND public._shared_proposal_blocks(p_booking_id) THEN
        PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
        RETURN 'shared_hold';
    END IF;

    v_tier := COALESCE(v_b.dispatch_tier, 1);
    v_tier_started := COALESCE(v_b.dispatch_tier_started_at, v_b.dispatch_cycle_started_at, v_b.search_restarted_at, v_b.created_at);
    v_reached3 := v_b.dispatch_reached_tier3_at;

    LOOP
        v_loops := v_loops + 1;
        IF v_loops > 12 THEN                                  -- cannot happen; a guard against a runaway loop
            v_next := clock_timestamp() + interval '1 second';
            v_result := 'waiting';
            EXIT;
        END IF;
        v_now := clock_timestamp();

        -- An offer is out for this cycle.
        SELECT * INTO v_att FROM public.dispatch_attempt a
         WHERE a.booking_id = p_booking_id AND a.response_status = 'Pending' AND (a.cycle = v_b.dispatch_cycle OR a.cycle IS NULL)
         ORDER BY a.notification_sent_at DESC LIMIT 1;
        IF FOUND THEN
            v_expiry := COALESCE(v_att.expires_at, v_att.notification_sent_at + make_interval(secs => v_hold));
            SELECT (d.availability_status = 'Available') INTO v_online FROM public.driver d WHERE d.driver_id = v_att.driver_id;
            IF NOT COALESCE(v_online, FALSE) THEN
                -- The driver went Offline (or was set Busy) while holding the offer: it is withdrawn, not counted as ignored.
                UPDATE public.dispatch_attempt SET response_status = 'Expired', responded_at = v_now WHERE attempt_id = v_att.attempt_id;
                CONTINUE;
            ELSIF v_expiry > v_now THEN
                v_next := v_expiry;
                v_result := 'offer_pending';
                EXIT;
            END IF;
            -- The window ended with no answer: closed as unanswered (responded_at stays empty), then the next driver.
            UPDATE public.dispatch_attempt SET response_status = 'Expired' WHERE attempt_id = v_att.attempt_id AND response_status = 'Pending';
            CONTINUE;
        END IF;

        -- Batch 10 (Rules 14.2, 6.5): before the next driver of the standard search is offered this booking, a Shared booking is tried against the Shared
        -- Trips under way. A proposal holds the booking until the driver and the first passenger have answered (or the time has run out).
        IF v_b.is_shared_trip AND public._shared_try_propose(p_booking_id) THEN
            SELECT m.driver_expires_at INTO v_next FROM public.shared_trip_match m
             WHERE m.additional_booking_id = p_booking_id AND m.match_status = 'Awaiting Driver' ORDER BY m.created_at DESC LIMIT 1;
            v_result := 'shared_proposed';
            EXIT;
        END IF;

        IF v_tier = 1 THEN
            IF v_b.priority_toda_id IS NOT NULL
               AND public._dispatch_offer_next(p_booking_id, 1::SMALLINT, v_b.priority_toda_id, public.dispatch_constant('tier1_radius_m')) THEN
                v_next := v_now + make_interval(secs => v_hold);
                v_result := 'offer_sent';
                EXIT;
            END IF;
            v_tier := 2;                                      -- nobody in Tier 1: straight on to Tier 2, no waiting (spec s.4)
            v_tier_started := v_now;
            CONTINUE;
        ELSIF v_tier = 2 THEN
            IF public._dispatch_offer_next(p_booking_id, 2::SMALLINT, NULL, public.dispatch_constant('tier2_radius_m')) THEN
                v_next := v_now + make_interval(secs => v_hold);
                v_result := 'offer_sent';
                EXIT;
            END IF;
            v_tier := 3;                                      -- the live search begins; the maximum time is counted from here
            v_tier_started := v_now;
            v_reached3 := COALESCE(v_reached3, v_now);
            CONTINUE;
        ELSE
            v_radius := public.dispatch_tier3_radius_m(EXTRACT(EPOCH FROM (v_now - v_tier_started)));
            IF v_radius IS NULL THEN
                v_result := 'no_driver_found';
                EXIT;
            END IF;
            IF public._dispatch_offer_next(p_booking_id, 3::SMALLINT, NULL, v_radius) THEN
                v_next := v_now + make_interval(secs => v_hold);
                v_result := 'offer_sent';
                EXIT;
            END IF;
            -- Nobody right now: look again at the next pool refresh, or when the maximum time ends, whichever is first.
            v_next := LEAST(v_now + make_interval(secs => v_refresh), v_tier_started + make_interval(secs => v_max));
            v_result := 'waiting';
            EXIT;
        END IF;
    END LOOP;

    IF v_result = 'no_driver_found' THEN
        UPDATE public.booking
           SET booking_status = 'No Driver Found',
               dispatch_tier = v_tier,
               dispatch_tier_started_at = v_tier_started,
               dispatch_reached_tier3_at = v_reached3,
               dispatch_next_action_at = NULL,
               dispatch_ended_reason = 'no_driver_found',
               dispatch_ended_at = clock_timestamp()                                    -- Phase B
         WHERE booking_id = p_booking_id;
        PERFORM public._dispatch_notify_passenger(v_b, 'NO_DRIVER_FOUND',
            'Walang available na drayber (No driver available)',
            'We could not find a driver near you. You can search again or cancel without any penalty. '
            || '(Walang nahanap na drayber. Maaari kang mag-search muli o kanselahin nang walang parusa.)');
        PERFORM public.record_policy_audit('DISPATCH_NO_DRIVER_FOUND', p_booking_id::TEXT, NULL, 'Dispatch',
            'No driver accepted within the maximum search time (cycle ' || v_b.dispatch_cycle || ').', NULL,
            jsonb_build_object('cycle', v_b.dispatch_cycle, 'tier', v_tier, 'reached_tier3_at', v_reached3));
        PERFORM public._dispatch_check_coverage_gap(p_booking_id);                     -- Phase B (Rule 7.10)
    ELSE
        UPDATE public.booking
           SET dispatch_tier = v_tier,
               dispatch_tier_started_at = v_tier_started,
               dispatch_reached_tier3_at = v_reached3,
               dispatch_pool_refreshed_at = CASE WHEN v_result = 'waiting' THEN v_now ELSE dispatch_pool_refreshed_at END,
               dispatch_next_action_at = v_next
         WHERE booking_id = p_booking_id
           AND (dispatch_tier IS DISTINCT FROM v_tier OR dispatch_tier_started_at IS DISTINCT FROM v_tier_started
                OR dispatch_reached_tier3_at IS DISTINCT FROM v_reached3 OR dispatch_next_action_at IS DISTINCT FROM v_next
                OR v_result = 'waiting');
        IF v_b.dispatch_reached_tier3_at IS NULL AND v_reached3 IS NOT NULL THEN       -- Phase B: the booking has just reached the live search
            PERFORM public._dispatch_check_coverage_gap(p_booking_id);
        END IF;
    END IF;

    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN v_result;
END;
$$;


-- ----------------------------------------------------------------------------
-- 6.8 THE SEARCH SWEEP (replaces 20261024000001)
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
    -- Batch 10 (Rules 14.2, 14.3, 14.5): shared-match proposals that ran out of time or of cutoff end; searching Shared bookings are tried against the trips under way
    BEGIN
        PERFORM public.shared_match_sweep();
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'dispatch sweep: the shared-match sweep could not run (%)', SQLERRM;
    END;
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
    -- PI-15 (Batch 9): a trip left at the destination without Payment Received is flagged once for the TODA Administrator.
    BEGIN
        PERFORM public._booking_payment_sweep();
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'dispatch sweep: the payment sweep could not run (%)', SQLERRM;
    END;
    RETURN v_n;
END;
$$;


-- ----------------------------------------------------------------------------
-- 7.1 THE FARE GUARD (replaces 20261024000001; three additions marked "Batch 10")
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
    v_early BOOLEAN := FALSE;
    v_pt JSONB;
    v_shared_leg JSONB := NULL;
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

    -- 1b. (Batch 9) The payment and early-termination columns are the system's too: written only by the functions of 20261024000001 (Rules 13, 18).
    IF NOT COALESCE(public.is_service_context(), FALSE) THEN
        IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
           OR NEW.confirm_fare_at IS DISTINCT FROM OLD.confirm_fare_at
           OR NEW.fare_discrepancy_at IS DISTINCT FROM OLD.fare_discrepancy_at
           OR NEW.payment_received_at IS DISTINCT FROM OLD.payment_received_at
           OR NEW.fare_unconfirmed IS DISTINCT FROM OLD.fare_unconfirmed
           OR NEW.payment_stuck_flagged_at IS DISTINCT FROM OLD.payment_stuck_flagged_at
           OR NEW.early_end_kind IS DISTINCT FROM OLD.early_end_kind
           OR NEW.early_end_reason IS DISTINCT FROM OLD.early_end_reason
           OR NEW.early_end_requested_at IS DISTINCT FROM OLD.early_end_requested_at
           OR NEW.early_end_at IS DISTINCT FROM OLD.early_end_at
           OR NEW.early_end_latitude IS DISTINCT FROM OLD.early_end_latitude
           OR NEW.early_end_longitude IS DISTINCT FROM OLD.early_end_longitude
           OR NEW.early_end_accuracy_m IS DISTINCT FROM OLD.early_end_accuracy_m THEN
            RAISE EXCEPTION 'ERR_PAYMENT_LOCKED: Ang bayad at ang maagang pagtatapos ng biyahe ay itinatala ng sistema. (The payment status and the early-termination record are written by the system: use the buttons of the trip.)';
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
        -- An early end has no destination to measure against: the track ends where the passenger got down (Rule 13.5)
        v_track := public._trip_track_summary(NEW.booking_id,
            CASE WHEN NEW.early_end_kind IS NULL THEN NEW.dropoff_latitude END,
            CASE WHEN NEW.early_end_kind IS NULL THEN NEW.dropoff_longitude END);
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

        -- (Batch 9) Rules 13.4 / 13.5 / 13.7: an early end is billed on the distance really travelled to the approved early point, recorded here with
        -- its GPS position and time. Without a usable track the straight line from the pickup to that point stands in for a Safety Concern or a driver's
        -- stop (never more than the passenger could owe); a personal end then keeps the estimate, which is its floor anyway.
        IF NEW.early_end_kind IS NOT NULL THEN
            v_early := TRUE;
            v_deviation := FALSE;                                   -- an early end is its own recorded adjustment, not a Rule 6.2.3 deviation
            v_pt := public._early_end_point(NEW.driver_id, NEW.booking_id);
            NEW.early_end_at := v_now;
            NEW.early_end_latitude := (v_pt->>'lat')::DOUBLE PRECISION;
            NEW.early_end_longitude := (v_pt->>'lng')::DOUBLE PRECISION;
            NEW.early_end_accuracy_m := (v_pt->>'acc')::DOUBLE PRECISION;
            IF v_rec IS NOT NULL THEN
                v_billed := v_rec;  v_distance_basis := 'actual_distance_to_early_point';
            ELSIF v_pt IS NOT NULL AND NEW.early_end_kind <> 'PERSONAL' THEN
                v_billed := round(public.calculate_haversine_distance_km(NEW.pickup_latitude, NEW.pickup_longitude,
                                  (v_pt->>'lat')::DOUBLE PRECISION, (v_pt->>'lng')::DOUBLE PRECISION)::NUMERIC, 3);
                v_distance_basis := 'straight_line_to_early_point_no_track';
            ELSE
                v_billed := v_est;  v_distance_basis := 'estimate_no_track';
            END IF;
        END IF;

        -- Which fare applies (Rules 6.1.2, 6.5, 14.4).
        v_matched := NEW.is_shared_trip
            AND NEW.shared_trip_match_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM public.shared_trip_match m WHERE m.match_id = NEW.shared_trip_match_id AND m.match_status = 'Matched'
                           AND (m.primary_booking_id = NEW.booking_id OR m.additional_booking_id = NEW.booking_id));   -- Batch 10: the pairing must be this booking's own
        v_basis := CASE
            WHEN NOT NEW.is_shared_trip THEN 'solo'
            WHEN v_matched THEN 'matched_estimate_pending_segments'   -- Batch 10 supplies the legs for allocate_shared_fares()
            ELSE 'unmatched_solo'                                      -- no partner: Maximum Unmatched Fare, no strike, no compensation
        END;

        v_calc := public.calculate_fare(v_billed, CASE WHEN v_matched THEN 'Shared' ELSE 'Solo' END, NEW.passenger_count, v_base, v_base_km, v_rate, v_cap);
        v_final := CASE WHEN v_matched THEN (v_calc->>'shared_matched_estimate') ELSE (v_calc->>'solo_fare') END::NUMERIC;
        v_components := CASE WHEN v_matched THEN v_calc->'shared_components' ELSE v_calc->'solo_components' END;

        -- Batch 10 (Rules 14.7, 6.1.3 - 6.1.5, PI-04 B): a matched leg is settled by allocate_shared_fares() from where each booking boarded and alighted
        -- along the vehicle's route, never above its own Solo (Maximum Unmatched) fare. Without a measurable route the matched estimate above stands.
        IF v_matched THEN
            v_shared_leg := public._shared_leg_fare(NEW, v_billed, v_base, v_base_km, v_rate, v_cap, v_now);
            IF v_shared_leg IS NOT NULL THEN
                v_final := (v_shared_leg->>'fare')::NUMERIC;
                v_components := v_shared_leg->'components';
                v_basis := 'shared_allocated';
            END IF;
        END IF;

        IF v_early THEN
            -- the accepted estimate, priced on the same basis (Rule 13.4: the fare displayed and accepted at booking confirmation)
            v_prev_calc := public.calculate_fare(v_est, CASE WHEN v_matched THEN 'Shared' ELSE 'Solo' END, NEW.passenger_count, v_base, v_base_km, v_rate, v_cap);
            v_prev := CASE WHEN v_matched THEN (v_prev_calc->>'shared_matched_estimate') ELSE (v_prev_calc->>'solo_fare') END::NUMERIC;
            IF NEW.early_end_kind = 'PERSONAL' AND v_prev > v_final THEN
                v_calc := v_prev_calc;                              -- Rule 13.4: the GREATER of the accepted estimate and the actual-distance fare
                v_final := v_prev;
                v_components := CASE WHEN v_matched THEN v_calc->'shared_components' ELSE v_calc->'solo_components' END;
                v_billed := v_est;
                v_distance_basis := 'estimate_is_greater_than_actual';
            END IF;
            INSERT INTO public.fare_adjustment_history (
                booking_id, reason_code, previous_fare, new_fare, estimated_distance_km, actual_distance_km, tolerance_km, details, actor_role
            ) VALUES (
                NEW.booking_id, CASE WHEN NEW.early_end_kind = 'SAFETY' THEN 'SAFETY_EARLY_TERMINATION' ELSE 'EARLY_TERMINATION' END,
                v_prev, v_final, v_est, v_rec, NULL,
                jsonb_build_object('kind', NEW.early_end_kind, 'reason', NEW.early_end_reason, 'provisional', NEW.early_end_kind = 'SAFETY',
                                   'distance_basis', v_distance_basis, 'billed_distance_km', v_billed,
                                   'early_end_at', v_now, 'early_end_latitude', NEW.early_end_latitude, 'early_end_longitude', NEW.early_end_longitude,
                                   'early_end_accuracy_m', NEW.early_end_accuracy_m, 'track', v_track),
                'system'
            );
        END IF;

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
        ) || CASE WHEN v_shared_leg IS NOT NULL THEN jsonb_build_object('shared_leg', v_shared_leg) ELSE '{}'::JSONB END
          || CASE WHEN v_early THEN jsonb_build_object('early_end', jsonb_build_object(
                'kind', NEW.early_end_kind, 'reason', NEW.early_end_reason, 'requested_at', NEW.early_end_requested_at, 'ended_at', v_now,
                'latitude', NEW.early_end_latitude, 'longitude', NEW.early_end_longitude, 'accuracy_m', NEW.early_end_accuracy_m,
                'provisional', NEW.early_end_kind = 'SAFETY', 'accepted_estimate_fare', v_prev, 'actual_distance_km', v_rec))
            ELSE '{}'::JSONB END, TRUE);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;


-- ----------------------------------------------------------------------------
-- 8.1 CONFIRMING A FLAGGED VIOLATION (replaces 20261024000001: two more flag types)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_confirm_flagged_violation(p_flag_id UUID, p_booking_id UUID, p_reason TEXT, p_points INTEGER DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_f public.admin_review_flag;
    v_b public.booking;
    v_code TEXT;
    v_type TEXT;
    v_subject UUID;
    v_strike JSONB;
BEGIN
    IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
        RAISE EXCEPTION 'ERR_CONFIRM_REASON: Write why the violation is confirmed (at least 10 characters).';
    END IF;
    SELECT * INTO v_f FROM public.admin_review_flag WHERE flag_id = p_flag_id AND status IN ('Open', 'Under Review') FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_FLAG_NOT_OPEN: The review flag was not found or is already closed.';
    END IF;
    IF v_f.flag_type = 'PASSENGER_EARLY_END_PATTERN' THEN
        IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
            RAISE EXCEPTION 'Access Denied: Only the LGU Administrator can confirm a passenger strike.';
        END IF;
        v_code := 'PAX_FARE_AVOIDANCE'; v_type := 'passenger'; v_subject := v_f.subject_id::UUID;
    ELSIF v_f.flag_type = 'DRIVER_EARLY_STOP_REVIEW' THEN
        SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id;
        IF NOT FOUND OR v_b.early_end_kind IS DISTINCT FROM 'DRIVER' OR v_b.driver_id::TEXT IS DISTINCT FROM v_f.subject_id THEN
            RAISE EXCEPTION 'ERR_NOT_AN_EARLY_STOP: The booking is not an early stop by this driver.';
        END IF;
        IF public._early_stop_reason_is_valid(v_b.early_end_reason) THEN
            RAISE EXCEPTION 'ERR_VALID_REASON: The driver stopped for a breakdown, a safety concern or an emergency: no strike (decision D9-8).';
        END IF;
        v_code := 'DRV_EARLY_STOP'; v_type := 'driver'; v_subject := v_b.driver_id;
    -- Batch 10 (Rules 14.7, 29.17): an under-declared passenger count; the LGU Administrator decides (passenger strikes are the LGU's). The points default to
    -- the severity the report recommended.
    ELSIF v_f.flag_type = 'PASSENGER_COUNT_UNDER_DECLARED' THEN
        IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
            RAISE EXCEPTION 'Access Denied: Only the LGU Administrator can confirm a passenger strike.';
        END IF;
        v_code := 'PAX_UNDER_DECLARED_COUNT'; v_type := 'passenger'; v_subject := v_f.subject_id::UUID;
        p_booking_id := COALESCE(p_booking_id, NULLIF(v_f.details->>'booking_id', '')::UUID);
        p_points := COALESCE(p_points, NULLIF(v_f.details->>'recommended_points', '')::INTEGER);
    -- Batch 10 (Rule 14.3): repeated, unjustified refusal of compatible Shared requests; only after the administrator has reviewed the pattern
    ELSIF v_f.flag_type = 'DRIVER_SHARED_REQUEST_DECLINES' THEN
        v_code := 'DRV_REPEATED_REFUSAL'; v_type := 'driver'; v_subject := v_f.subject_id::UUID;
    ELSE
        RAISE EXCEPTION 'ERR_FLAG_NOT_CONFIRMABLE: A strike cannot be confirmed from a % flag.', v_f.flag_type;
    END IF;
    v_strike := public.issue_strike(v_type, v_subject, v_code, p_points, p_booking_id, NULL,
        'FLAG_VIOLATION:' || p_flag_id::TEXT || ':' || v_code || ':' || COALESCE(p_booking_id::TEXT, '-'), NULL, btrim(p_reason), NULL,
        jsonb_build_object('flag_id', p_flag_id, 'flag_type', v_f.flag_type, 'rule', v_f.source_rule));
    PERFORM public.resolve_admin_review_flag(p_flag_id, 'Resolved', 'Violation confirmed (' || v_code || '): ' || btrim(p_reason));
    RETURN jsonb_build_object('success', TRUE, 'strike', v_strike);
END;
$$;


-- ----------------------------------------------------------------------------
-- 7. THE FARE OF A MATCHED LEG (Rules 14.7, 6.1.3 - 6.1.5; PI-04 Option B; decisions N8, N9)
-- ----------------------------------------------------------------------------
-- The vehicle's route distance (km) from the first boarding up to a moment: the F5.1-filtered replay of the logged fixes of the booking and of its
-- partner (each published fix is logged against every trip the driver carries, so the two tracks overlap and are de-duplicated). NULL = no usable track.
CREATE OR REPLACE FUNCTION public._trip_odometer_km(p_booking_id UUID, p_partner_id UUID, p_until TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_s JSONB := public._trip_track_summary(p_booking_id, NULL, NULL, p_until, p_partner_id);
BEGIN
    IF COALESCE((v_s->>'fixes_usable')::INTEGER, 0) < 2 THEN
        RETURN NULL;
    END IF;
    RETURN (v_s->>'distance_km')::NUMERIC;
END;
$$;

-- What a matched leg pays, from where each booking boarded and alighted along the vehicle's route (allocate_shared_fares, the Option B model), capped
-- at the booking's OWN Solo (Maximum Unmatched) fare so that neither party ever pays more than Solo (decision D10-3). Returns NULL when the legs cannot be
-- measured (no usable track, an impossible head-count): the caller then bills the Batch 5 matched estimate, never more than the passenger accepted.
--   * the leg that ends FIRST is locked using the other leg's REMAINING estimated distance (the other is still on board);
--   * the leg that ends SECOND is locked from the whole actual route (the first leg's figures were stored when it ended);
--   * the other leg not yet on board: this leg rode alone, so its fare is the vehicle fare of the route it travelled.
-- A head-count the driver reported (passenger_count_report) replaces the declared one (Rules 14.7, 29.17).
CREATE OR REPLACE FUNCTION public._shared_leg_fare(
    p_b public.booking, p_billed NUMERIC, p_base NUMERIC, p_base_km NUMERIC, p_rate NUMERIC, p_cap INTEGER, p_now TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_m public.shared_trip_match;
    v_o public.booking;
    v_o_id UUID;
    v_this_pax INTEGER;
    v_o_pax INTEGER;
    v_first_id UUID;
    v_odo_now NUMERIC;
    v_this_board NUMERIC;
    v_this_alight NUMERIC;
    v_o_board NUMERIC;
    v_o_alight NUMERIC;
    v_o_boarded BOOLEAN;
    v_o_projected BOOLEAN := FALSE;
    v_rem NUMERIC;
    v_stored JSONB;
    v_legs JSONB;
    v_alloc JSONB;
    v_row JSONB;
    v_solo NUMERIC;
    v_raw NUMERIC;
    v_fare NUMERIC;
    v_pool NUMERIC;
    v_route NUMERIC;
    v_pool_base NUMERIC;
    v_pool_total NUMERIC;
    v_c_base NUMERIC;
    v_c_dist NUMERIC;
BEGIN
    SELECT * INTO v_m FROM public.shared_trip_match
     WHERE match_id = p_b.shared_trip_match_id AND match_status = 'Matched'
       AND (primary_booking_id = p_b.booking_id OR additional_booking_id = p_b.booking_id);
    IF NOT FOUND OR v_m.additional_booking_id IS NULL OR p_b.trip_started_at IS NULL THEN
        RETURN NULL;
    END IF;
    v_o_id := CASE WHEN v_m.primary_booking_id = p_b.booking_id THEN v_m.additional_booking_id ELSE v_m.primary_booking_id END;
    SELECT * INTO v_o FROM public.booking WHERE booking_id = v_o_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    v_this_pax := COALESCE((SELECT r.actual_count FROM public.passenger_count_report r WHERE r.booking_id = p_b.booking_id ORDER BY r.created_at DESC LIMIT 1), p_b.passenger_count);
    v_o_pax := COALESCE((SELECT r.actual_count FROM public.passenger_count_report r WHERE r.booking_id = v_o.booking_id ORDER BY r.created_at DESC LIMIT 1), v_o.passenger_count);
    v_o_boarded := v_o.trip_started_at IS NOT NULL;
    v_first_id := CASE WHEN NOT v_o_boarded OR p_b.trip_started_at <= v_o.trip_started_at THEN p_b.booking_id ELSE v_o.booking_id END;

    v_odo_now := public._trip_odometer_km(p_b.booking_id, v_o_id, p_now);
    IF v_odo_now IS NULL THEN
        RETURN NULL;
    END IF;
    v_this_board := CASE WHEN v_first_id = p_b.booking_id THEN 0 ELSE COALESCE(public._trip_odometer_km(p_b.booking_id, v_o_id, p_b.trip_started_at), 0) END;
    v_this_alight := GREATEST(v_odo_now, v_this_board + 0.01);

    IF v_o_boarded THEN
        v_o_board := CASE WHEN v_first_id = v_o.booking_id THEN 0 ELSE COALESCE(public._trip_odometer_km(p_b.booking_id, v_o_id, v_o.trip_started_at), 0) END;
        IF v_o.fare_locked_at IS NOT NULL THEN
            v_stored := v_o.fare_breakdown #> '{final,shared_leg}';
            IF v_stored IS NOT NULL AND (v_stored->>'alight_km') IS NOT NULL THEN
                v_o_board := (v_stored->>'board_km')::NUMERIC;
                v_o_alight := (v_stored->>'alight_km')::NUMERIC;
            ELSE
                v_o_alight := COALESCE(public._trip_odometer_km(p_b.booking_id, v_o_id, v_o.fare_locked_at), v_odo_now);
            END IF;
        ELSE
            v_o_projected := TRUE;                                  -- still on board: the rest of its own estimated route
            v_rem := GREATEST(0.05, COALESCE(v_o.estimated_distance_km, 0)::NUMERIC
                                    - COALESCE((public._trip_track_summary(v_o.booking_id)->>'distance_km')::NUMERIC, 0));
            v_o_alight := v_odo_now + v_rem;
        END IF;
        v_o_alight := GREATEST(v_o_alight, v_o_board + 0.01);
        v_legs := jsonb_build_array(
            jsonb_build_object('booking_id', p_b.booking_id, 'passenger_count', v_this_pax, 'board_km', v_this_board, 'alight_km', v_this_alight),
            jsonb_build_object('booking_id', v_o.booking_id, 'passenger_count', v_o_pax, 'board_km', v_o_board, 'alight_km', v_o_alight));
    ELSE
        v_legs := jsonb_build_array(
            jsonb_build_object('booking_id', p_b.booking_id, 'passenger_count', v_this_pax, 'board_km', v_this_board, 'alight_km', v_this_alight));
    END IF;

    BEGIN
        v_alloc := public.allocate_shared_fares(v_legs, p_base, p_base_km, p_rate, p_cap);
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'shared fare: booking % could not be allocated (%); the matched estimate stands', p_b.booking_id, SQLERRM;
        RETURN NULL;
    END;
    SELECT e INTO v_row FROM jsonb_array_elements(v_alloc->'bookings') AS e WHERE e->>'booking_id' = p_b.booking_id::TEXT;
    IF v_row IS NULL THEN
        RETURN NULL;
    END IF;
    v_raw := (v_row->>'raw_fare')::NUMERIC;
    v_fare := (v_row->>'fare')::NUMERIC;
    v_solo := ((public.calculate_fare(p_billed, 'Solo', LEAST(v_this_pax, p_cap), p_base, p_base_km, p_rate, p_cap))->>'solo_fare')::NUMERIC;
    v_pool := (v_alloc->>'pool_fare')::NUMERIC;
    v_route := (v_alloc->>'route_km')::NUMERIC;
    v_pool_base := p_base * p_cap;
    v_pool_total := GREATEST(v_pool, 0.01);
    v_c_base := round(LEAST(v_fare, v_solo) * v_pool_base / v_pool_total, 2);
    v_c_dist := round(LEAST(v_fare, v_solo) * GREATEST(0, v_pool - v_pool_base) / v_pool_total, 2);
    RETURN jsonb_build_object(
        'fare', LEAST(v_fare, v_solo),
        'raw_fare', v_raw,
        'allocated_fare', v_fare,
        'capped_at_solo', v_fare > v_solo,
        'solo_cap', v_solo,
        'route_km', v_route,
        'pool_fare', v_pool,
        'per_km_cost', v_alloc->'per_km_cost',
        'passenger_count', v_this_pax,
        'board_km', v_this_board,
        'alight_km', v_this_alight,
        'other_passenger_count', v_o_pax,
        'other_board_km', v_o_board,
        'other_alight_km', v_o_alight,
        'other_projected', v_o_projected,
        'segments', v_row->'segments',
        'components', jsonb_build_object('base', v_c_base, 'distance', v_c_dist, 'adjustment', LEAST(v_fare, v_solo) - v_c_base - v_c_dist)
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. THE PASSENGER COUNT (Rules 14.7, 29.17; decision N8)
-- ----------------------------------------------------------------------------
-- The driver finds more (or fewer) passengers than the booking declared and reports it BEFORE the trip is finished (before the fare is locked). The
-- report is the correction: from then on the reported count is the one the fare uses (a Solo fare never depends on the head-count; a matched leg does),
-- the change is written to the fare ledger (DECLARED_PASSENGER_MISMATCH), the passengers concerned are told, and when the booking was UNDER-declared
-- the LGU Administrator gets a review flag with the recommended severity. A strike (PAX_UNDER_DECLARED_COUNT) exists only after that administrator
-- confirms it (admin_confirm_flagged_violation). The driver's right to refuse to start until the booking is corrected is his: nothing here forces it.
CREATE OR REPLACE FUNCTION public.driver_report_passenger_count(p_booking_id UUID, p_actual_count INTEGER, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_driver UUID := public.get_current_driver_id();
    v_b public.booking;
    v_o public.booking;
    v_phase TEXT;
    v_cap INTEGER := public.fare_policy_constant('seat_capacity');
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_excess INTEGER;
    v_other_count INTEGER := 0;
    v_over BOOLEAN;
    v_repeat INTEGER;
    v_points INTEGER;
    v_old_est NUMERIC;
    v_new_est NUMERIC;
    v_flag UUID := NULL;
    v_rule public.fare_matrix;
    v_report UUID;
BEGIN
    IF v_driver IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_A_DRIVER', 'error', 'Only a driver can report a passenger count.');
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_b.driver_id IS DISTINCT FROM v_driver THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_YOUR_BOOKING', 'error', 'This booking is not yours.');
    END IF;
    v_phase := public._booking_phase(v_b.booking_status);
    IF v_phase NOT IN ('assigned', 'arrived', 'ongoing') OR v_b.fare_locked_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_TOO_LATE', 'error', 'A passenger count is reported before the trip is finished: after that, report a fare problem instead.');
    END IF;
    IF p_actual_count IS NULL OR p_actual_count < 1 OR p_actual_count > 10 THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_INVALID_COUNT', 'error', 'Enter the number of passengers on board, from 1 to 10.');
    END IF;
    IF p_actual_count = COALESCE((SELECT r.actual_count FROM public.passenger_count_report r WHERE r.booking_id = p_booking_id ORDER BY r.created_at DESC LIMIT 1), v_b.passenger_count) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NO_MISMATCH', 'error', 'That is the count already on record for this booking.');
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    INSERT INTO public.passenger_count_report (booking_id, driver_id, declared_count, actual_count, note, phase)
    VALUES (p_booking_id, v_driver, v_b.passenger_count, p_actual_count, NULLIF(btrim(COALESCE(p_note, '')), ''), v_phase)
    RETURNING report_id INTO v_report;
    v_excess := p_actual_count - v_b.passenger_count;

    -- the head-count of the other leg, to say whether the tricycle is now over its capacity
    IF v_b.shared_trip_match_id IS NOT NULL THEN
        SELECT o.* INTO v_o FROM public.shared_trip_match m
          JOIN public.booking o ON o.booking_id = CASE WHEN m.primary_booking_id = p_booking_id THEN m.additional_booking_id ELSE m.primary_booking_id END
         WHERE m.match_id = v_b.shared_trip_match_id AND m.match_status = 'Matched';
        IF FOUND THEN
            v_other_count := COALESCE((SELECT r.actual_count FROM public.passenger_count_report r WHERE r.booking_id = v_o.booking_id ORDER BY r.created_at DESC LIMIT 1), v_o.passenger_count);
        END IF;
    END IF;
    v_over := p_actual_count + v_other_count > v_cap;

    -- the fare estimate recomputed with the reported count (a Solo fare is the whole vehicle: it does not change); the final fare uses the same count
    v_old_est := v_b.estimated_fare;
    v_new_est := v_b.estimated_fare;
    IF v_b.is_shared_trip AND v_b.estimated_distance_km IS NOT NULL AND v_b.fare_breakdown #>> '{rule,base_fare}' IS NOT NULL AND p_actual_count <= v_cap THEN
        v_new_est := ((public.calculate_fare(round(v_b.estimated_distance_km::NUMERIC, 3), 'Shared', p_actual_count,
                          (v_b.fare_breakdown #>> '{rule,base_fare}')::NUMERIC, (v_b.fare_breakdown #>> '{rule,base_distance_km}')::NUMERIC,
                          (v_b.fare_breakdown #>> '{rule,succeeding_rate}')::NUMERIC, v_cap))->>'shared_matched_estimate')::NUMERIC;
    END IF;
    INSERT INTO public.fare_adjustment_history (booking_id, reason_code, previous_fare, new_fare, estimated_distance_km, details, actor_id, actor_role)
    VALUES (p_booking_id, 'DECLARED_PASSENGER_MISMATCH', COALESCE(v_old_est, 0), COALESCE(v_new_est, 0), v_b.estimated_distance_km,
            jsonb_build_object('declared_count', v_b.passenger_count, 'actual_count', p_actual_count, 'excess', v_excess, 'over_capacity', v_over,
                               'is_shared_trip', v_b.is_shared_trip, 'matched', v_other_count > 0, 'report_id', v_report,
                               'note', 'The matched fare uses the reported count; a Solo fare does not depend on the head-count.'),
            v_driver, 'driver');

    PERFORM public.record_policy_audit('PASSENGER_COUNT_REPORTED', p_booking_id::TEXT, NULL, 'Shared Trips',
        'The driver reported ' || p_actual_count || ' passenger(s) against ' || v_b.passenger_count || ' declared (Rules 14.7, 29.17).', NULL,
        jsonb_build_object('booking_id', p_booking_id, 'declared_count', v_b.passenger_count, 'actual_count', p_actual_count, 'over_capacity', v_over, 'report_id', v_report));

    -- under-declared: the LGU Administrator decides (passenger strikes are the LGU's; the flag carries the recommended severity)
    IF v_excess > 0 AND v_b.passenger_id IS NOT NULL THEN
        SELECT count(*) INTO v_repeat FROM public.passenger_count_report r JOIN public.booking x ON x.booking_id = r.booking_id
         WHERE x.passenger_id = v_b.passenger_id AND r.actual_count > r.declared_count AND r.report_id <> v_report
           AND r.created_at >= clock_timestamp() - interval '90 days';
        v_points := CASE WHEN v_excess >= 2 OR v_repeat > 0 OR v_over OR p_actual_count > v_cap THEN 2 ELSE 1 END;
        v_flag := public.create_admin_review_flag('PASSENGER_COUNT_UNDER_DECLARED', 'passenger', v_b.passenger_id::TEXT, 'Rules 14.7, 29.17', 'lgu_admin',
            jsonb_build_object('booking_id', p_booking_id, 'declared_count', v_b.passenger_count, 'actual_count', p_actual_count, 'excess', v_excess,
                               'repeat_in_90_days', v_repeat, 'over_capacity', v_over OR p_actual_count > v_cap, 'recommended_points', v_points,
                               'note', 'Review flag only. One strike for one extra passenger on a first occurrence; two for two or more extra, a repeat within 90 days, or more than the seats. A strike exists only after the LGU Administrator confirms it.'));
        PERFORM public._notify_subject('passenger', v_b.passenger_id, 'PASSENGER_COUNT_CORRECTED',
            'Itinama ang bilang ng pasahero (Passenger count corrected)',
            'The driver recorded ' || p_actual_count || ' passenger(s) on this trip instead of ' || v_b.passenger_count || '. The fare of a shared trip uses the corrected count. '
            || 'Declaring the right number is required; a repeated or deliberate under-declaration can lead to a strike. (Itinala ng drayber ang ' || p_actual_count || ' pasahero sa halip na '
            || v_b.passenger_count || '. Ang tamang bilang ang gagamitin sa pamasahe.)', v_report::TEXT, 1);
    END IF;
    IF v_o.booking_id IS NOT NULL AND v_o.passenger_id IS NOT NULL THEN
        PERFORM public._notify_subject('passenger', v_o.passenger_id, 'PASSENGER_COUNT_CORRECTED',
            'Binago ang bilang sa shared trip (Head-count changed on your shared trip)',
            'The driver corrected the number of passengers of the other party on your shared trip. Your fare share uses the recorded counts. (Itinama ng drayber ang bilang ng kasabay mo; ang itinalang bilang ang gagamitin sa hatian.)',
            v_report::TEXT, 2);
    END IF;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'report_id', v_report, 'declared_count', v_b.passenger_count, 'actual_count', p_actual_count,
                              'over_capacity', v_over, 'previous_estimate', v_old_est, 'new_estimate', v_new_est, 'flag_id', v_flag);
END;
$$;



-- ----------------------------------------------------------------------------
-- 9. PRIVILEGES
-- ----------------------------------------------------------------------------
-- The apps call five functions; everything else is the database's own.
REVOKE EXECUTE ON FUNCTION public.get_my_shared_request() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.driver_respond_shared_request(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.passenger_respond_shared_match(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_shared_match_state(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.driver_report_passenger_count(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_shared_request() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_respond_shared_request(UUID, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.passenger_respond_shared_match(UUID, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_shared_match_state(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_report_passenger_count(UUID, INTEGER, TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.shared_trip_constant(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.calapan_barangays() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._area_of_address(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._bearing_deg(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._compass_8(DOUBLE PRECISION) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._shared_road_m(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._shared_progress_pct(public.booking) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._shared_evaluate(public.booking, public.booking, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._shared_best_host(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._shared_stale_reason(public.shared_trip_match, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._shared_decline_flag(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._shared_release_booking(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._shared_close_match(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._shared_proposal_blocks(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._shared_try_propose(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shared_match_sweep() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shared_trip_match_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.booking_shared_release_on_driver_loss() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._trip_odometer_km(UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._shared_leg_fare(public.booking, NUMERIC, NUMERIC, NUMERIC, NUMERIC, INTEGER, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._trip_track_summary(UUID, DOUBLE PRECISION, DOUBLE PRECISION, TIMESTAMPTZ, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.booking_shared_partner_on_cancel() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.block_driver_double_booking() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._log_trip_fix(UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._dispatch_advance(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.dispatch_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_sweep() TO service_role;
REVOKE EXECUTE ON FUNCTION public.booking_identity_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.booking_fare_update_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shared_trip_constant(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_confirm_flagged_violation(UUID, UUID, TEXT, INTEGER) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 10. SELF-CHECK (the migration fails, and nothing is applied, if any of this is not true)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF public.shared_trip_constant('cutoff_progress_pct') <> 50 OR public.shared_trip_constant('max_bookings') <> 2 OR public.fare_policy_constant('seat_capacity') <> 4 THEN
        RAISE EXCEPTION 'the shared-trip constants are wrong';
    END IF;
    IF pg_get_functiondef('public._dispatch_advance(uuid)'::regprocedure) NOT LIKE '%_shared_proposal_blocks%'
       OR pg_get_functiondef('public._dispatch_advance(uuid)'::regprocedure) NOT LIKE '%_shared_try_propose%' THEN
        RAISE EXCEPTION '_dispatch_advance() was not replaced';
    END IF;
    IF pg_get_functiondef('public.dispatch_sweep()'::regprocedure) NOT LIKE '%shared_match_sweep%' THEN
        RAISE EXCEPTION 'dispatch_sweep() was not replaced';
    END IF;
    IF pg_get_functiondef('public.booking_fare_update_guard()'::regprocedure) NOT LIKE '%_shared_leg_fare%' THEN
        RAISE EXCEPTION 'booking_fare_update_guard() was not replaced';
    END IF;
    IF pg_get_functiondef('public.block_driver_double_booking()'::regprocedure) NOT LIKE '%sakay.shared_attach%' THEN
        RAISE EXCEPTION 'block_driver_double_booking() was not replaced';
    END IF;
    IF pg_get_functiondef('public.booking_identity_guard()'::regprocedure) NOT LIKE '%ERR_MATCH_LOCKED%' THEN
        RAISE EXCEPTION 'booking_identity_guard() was not replaced';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('uq_shared_match_open_primary')) THEN
        RAISE EXCEPTION 'the one-open-pairing index is missing';
    END IF;
    IF has_function_privilege('authenticated', 'public._shared_try_propose(uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.shared_match_sweep()', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public._shared_leg_fare(public.booking, numeric, numeric, numeric, numeric, integer, timestamptz)', 'EXECUTE') THEN
        RAISE EXCEPTION 'a signed-in user can run an internal shared-trip function';
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.get_shared_match_state(uuid)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.passenger_respond_shared_match(uuid, boolean)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.driver_respond_shared_request(uuid, boolean)', 'EXECUTE') THEN
        RAISE EXCEPTION 'the apps cannot call the shared-trip functions';
    END IF;
    IF has_function_privilege('anon', 'public.get_shared_match_state(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'an anonymous caller can read a shared match';
    END IF;
END $$;
