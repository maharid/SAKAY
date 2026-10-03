-- ============================================================================
-- Migration: 20261007000002_batch5_fare_engine.sql
-- Batch 5 (Step 2): the ONE fare function.
--
--   Rule 6.1.1  Seat Fare   = base fare + excess km x per-km rate        (excess = 0 up to the base distance)
--   Rule 6.1.2  Solo Fare   = Seat Fare x 4, whatever the headcount
--   Rule 6.1.3  Shared      = the vehicle fare split by passengers on board (decision D2, PI-04 Option B)
--   Rule 6.1.5  d. no booking is charged less than the base fare
--               e. one rounding per booking: nearest whole peso, .50 up
--   Rule 6.5    Matched Shared Fare Estimate + Maximum Unmatched Fare
--
-- Everything is exact NUMERIC arithmetic (no floating point) and every booking is divided
-- exactly once, at the very end, so a true .50 can never fall to .4999999.
--
-- Vehicle fare ("pool") of a route of R km = (base fare + max(0, R - base km) x rate) x seat capacity,
-- i.e. a Solo fare for the whole route. Each kilometre costs pool / R and is shared by the
-- passengers on board during that kilometre, by passenger count. Kilometres travelled by one
-- booking alone are therefore charged to that booking (Rules 6.1.3 - 6.1.5 b).
--
-- Callers: the booking guards (migration 3), quote_fare() for the apps, and the tests.
-- Nothing else in the repository holds a fare formula.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. calculate_fare: estimate figures for one booking, from explicit rule values
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_fare(
    p_distance_km NUMERIC,
    p_trip_type TEXT,
    p_passenger_count INTEGER,
    p_base_fare NUMERIC,
    p_base_distance_km NUMERIC,
    p_succeeding_rate NUMERIC,
    p_capacity INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_cap INTEGER := COALESCE(p_capacity, public.fare_policy_constant('seat_capacity'));
    v_partner INTEGER := public.fare_policy_constant('partner_assumption_pax');
    v_min NUMERIC;
    v_excess NUMERIC;
    v_seat NUMERIC;
    v_pool NUMERIC;
    v_solo NUMERIC;
    v_total_pax INTEGER;
    v_shared NUMERIC;
    v_solo_base NUMERIC;
    v_solo_dist NUMERIC;
    v_sh_base NUMERIC;
    v_sh_dist NUMERIC;
BEGIN
    IF p_trip_type IS NULL OR p_trip_type NOT IN ('Solo', 'Shared') THEN
        RAISE EXCEPTION 'ERR_INVALID_TRIP_TYPE: Ang trip type ay Solo o Shared. (Trip type must be Solo or Shared.)';
    END IF;
    IF p_distance_km IS NULL OR p_distance_km < 0 THEN
        RAISE EXCEPTION 'ERR_INVALID_DISTANCE: Hindi wasto ang distansya. (Invalid distance.)';
    END IF;
    IF p_passenger_count IS NULL OR p_passenger_count < 1 OR p_passenger_count > v_cap THEN
        RAISE EXCEPTION 'ERR_INVALID_PASSENGER_COUNT: Ang bilang ng pasahero ay 1 hanggang %. (Passenger count must be between 1 and %.)', v_cap, v_cap;
    END IF;
    IF p_base_fare IS NULL OR p_base_distance_km IS NULL OR p_succeeding_rate IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_FARE_RULE: Kulang ang fare rule. (Incomplete fare rule.)';
    END IF;

    v_min := round(p_base_fare, 0);                                   -- 6.1.5 d (a whole-peso fare cannot be below the base fare)
    v_excess := GREATEST(0, p_distance_km - p_base_distance_km);      -- 6.1.1: 0 up to the base distance
    v_seat := p_base_fare + v_excess * p_succeeding_rate;
    v_pool := v_seat * v_cap;                                         -- the vehicle fare for this route

    v_solo := GREATEST(round(v_pool, 0), v_min);                      -- 6.1.2 (+ 6.1.5 d, e)

    -- Matched Shared Fare Estimate: one more 1-passenger partner on the same route (D2c).
    -- The tricycle cannot hold more than its capacity, so the total is capped there.
    v_total_pax := LEAST(p_passenger_count + v_partner, v_cap);
    v_shared := GREATEST(round(v_pool * p_passenger_count / v_total_pax, 0), v_min);

    v_solo_base := round(p_base_fare * v_cap, 2);
    v_solo_dist := round(v_excess * p_succeeding_rate * v_cap, 2);
    v_sh_base := round(p_base_fare * v_cap * p_passenger_count / v_total_pax, 2);
    v_sh_dist := round(v_excess * p_succeeding_rate * v_cap * p_passenger_count / v_total_pax, 2);

    RETURN jsonb_build_object(
        'trip_type', p_trip_type,
        'distance_km', p_distance_km,
        'excess_km', v_excess,
        'passenger_count', p_passenger_count,
        'seat_capacity', v_cap,
        'seat_fare', v_seat,
        'minimum_fare', v_min,
        'solo_fare', v_solo,
        'max_unmatched_fare', v_solo,                                 -- 6.5: what a Shared booking pays if nobody is matched
        'shared_matched_estimate', v_shared,
        'partner_assumption_passengers', v_partner,
        'estimated_fare', CASE p_trip_type WHEN 'Solo' THEN v_solo ELSE v_shared END,
        'solo_components', jsonb_build_object('base', v_solo_base, 'distance', v_solo_dist, 'adjustment', v_solo - v_solo_base - v_solo_dist),
        'shared_components', jsonb_build_object('base', v_sh_base, 'distance', v_sh_dist, 'adjustment', v_shared - v_sh_base - v_sh_dist)
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. allocate_shared_fares: settle a matched Shared Trip from where each booking boarded / alighted
-- ----------------------------------------------------------------------------
-- p_legs: [{"booking_id": "...", "passenger_count": 1, "board_km": 0, "alight_km": 6}, ...]
-- board_km / alight_km are positions along the vehicle's route (Batch 10 supplies them from the
-- confirmed route). Elementary intervals between consecutive positions are classified by who is on
-- board; an interval no booking occupies costs nothing.
CREATE OR REPLACE FUNCTION public._shared_segments(p_legs JSONB)
RETURNS TABLE (seg_start NUMERIC, seg_end NUMERIC, seg_len NUMERIC, pax_on INTEGER)
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    WITH legs AS (
        SELECT (e->>'passenger_count')::INTEGER AS pax,
               (e->>'board_km')::NUMERIC AS b,
               (e->>'alight_km')::NUMERIC AS a
        FROM jsonb_array_elements(p_legs) AS e
    ),
    pts AS (
        SELECT DISTINCT x FROM legs, LATERAL (VALUES (legs.b), (legs.a)) AS v(x)
    ),
    elem AS (
        SELECT x AS s, lead(x) OVER (ORDER BY x) AS e FROM pts
    )
    SELECT elem.s, elem.e, elem.e - elem.s,
           (SELECT COALESCE(SUM(l.pax), 0)::INTEGER FROM legs l WHERE l.b <= elem.s AND l.a >= elem.e)
    FROM elem
    WHERE elem.e IS NOT NULL
    ORDER BY elem.s;
$$;

CREATE OR REPLACE FUNCTION public.allocate_shared_fares(
    p_legs JSONB,
    p_base_fare NUMERIC,
    p_base_distance_km NUMERIC,
    p_succeeding_rate NUMERIC,
    p_capacity INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_cap INTEGER := COALESCE(p_capacity, public.fare_policy_constant('seat_capacity'));
    v_lcm INTEGER := 1;
    v_i INTEGER;
    v_min NUMERIC := round(p_base_fare, 0);
    v_route NUMERIC;
    v_max_on INTEGER;
    v_pool NUMERIC;
    v_leg RECORD;
    v_seg RECORD;
    v_num NUMERIC;
    v_raw NUMERIC;
    v_fare NUMERIC;
    v_segs JSONB;
    v_out JSONB := '[]'::JSONB;
BEGIN
    IF p_legs IS NULL OR jsonb_typeof(p_legs) <> 'array' OR jsonb_array_length(p_legs) = 0 THEN
        RAISE EXCEPTION 'ERR_INVALID_LEGS: Walang laman ang listahan ng mga biyahe. (The list of legs is empty.)';
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_legs) AS e
        WHERE (e->>'booking_id') IS NULL OR (e->>'passenger_count') IS NULL
           OR (e->>'board_km') IS NULL OR (e->>'alight_km') IS NULL
    ) THEN
        RAISE EXCEPTION 'ERR_INVALID_LEGS: Bawat leg ay kailangan ng booking_id, passenger_count, board_km at alight_km. (Each leg needs booking_id, passenger_count, board_km and alight_km.)';
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_legs) AS e
        WHERE (e->>'passenger_count')::INTEGER < 1 OR (e->>'passenger_count')::INTEGER > v_cap
           OR (e->>'board_km')::NUMERIC < 0
           OR (e->>'alight_km')::NUMERIC <= (e->>'board_km')::NUMERIC
    ) THEN
        RAISE EXCEPTION 'ERR_INVALID_LEGS: Hindi wasto ang bilang ng pasahero o ang posisyon ng sakay/baba. (Invalid passenger count or boarding/alighting position.)';
    END IF;

    -- lcm(1..capacity): every per-kilometre share has a denominator that divides it, so all
    -- shares can be added as exact integers-over-one-denominator and divided once.
    FOR v_i IN 2..v_cap LOOP
        v_lcm := v_lcm / gcd(v_lcm, v_i) * v_i;
    END LOOP;

    SELECT SUM(s.seg_len), MAX(s.pax_on) INTO v_route, v_max_on
    FROM public._shared_segments(p_legs) s WHERE s.pax_on > 0;
    IF v_route IS NULL OR v_route <= 0 THEN
        RAISE EXCEPTION 'ERR_INVALID_LEGS: Walang distansyang may sakay. (No distance is occupied.)';
    END IF;
    IF v_max_on > v_cap THEN
        RAISE EXCEPTION 'ERR_CAPACITY_EXCEEDED: Lampas sa % ang sabay-sabay na pasahero. (More than % passengers on board at once.)', v_cap, v_cap;
    END IF;

    v_pool := (p_base_fare + GREATEST(0, v_route - p_base_distance_km) * p_succeeding_rate) * v_cap;

    FOR v_leg IN
        SELECT (e->>'booking_id') AS booking_id,
               (e->>'passenger_count')::INTEGER AS pax,
               (e->>'board_km')::NUMERIC AS b,
               (e->>'alight_km')::NUMERIC AS a,
               t.ord
        FROM jsonb_array_elements(p_legs) WITH ORDINALITY AS t(e, ord)
        ORDER BY t.ord
    LOOP
        v_num := 0;
        v_segs := '[]'::JSONB;
        FOR v_seg IN
            SELECT s.seg_start, s.seg_end, s.seg_len, s.pax_on
            FROM public._shared_segments(p_legs) s
            WHERE s.pax_on > 0 AND v_leg.b <= s.seg_start AND v_leg.a >= s.seg_end
            ORDER BY s.seg_start
        LOOP
            v_num := v_num + v_seg.seg_len * v_pool * v_leg.pax * (v_lcm / v_seg.pax_on);
            v_segs := v_segs || jsonb_build_array(jsonb_build_object(
                'from_km', v_seg.seg_start,
                'to_km', v_seg.seg_end,
                'length_km', v_seg.seg_len,
                'passengers_on_board', v_seg.pax_on,
                'type', CASE WHEN v_seg.pax_on > v_leg.pax THEN 'common' ELSE 'exclusive' END,
                'cost', round((v_seg.seg_len * v_pool * v_leg.pax) / (v_route * v_seg.pax_on), 4)
            ));
        END LOOP;

        v_raw := v_num / (v_route * v_lcm);                          -- the only division for this booking
        v_fare := GREATEST(round(v_raw, 0), v_min);                  -- one rounding, then the 6.1.5 d minimum

        v_out := v_out || jsonb_build_array(jsonb_build_object(
            'booking_id', v_leg.booking_id,
            'passenger_count', v_leg.pax,
            'board_km', v_leg.b,
            'alight_km', v_leg.a,
            'distance_km', v_leg.a - v_leg.b,
            'raw_fare', round(v_raw, 4),
            'fare', v_fare,
            'minimum_applied', round(v_raw, 0) < v_min,
            'segments', v_segs
        ));
    END LOOP;

    RETURN jsonb_build_object(
        'route_km', v_route,
        'pool_fare', round(v_pool, 2),
        'per_km_cost', round(v_pool / v_route, 4),
        'bookings', v_out
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. quote_fare: what the apps call. The rule in force NOW, no formula in the client.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.quote_fare(
    p_distance_km NUMERIC,
    p_passenger_count INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_rule public.fare_matrix;
    v_calc JSONB;
BEGIN
    IF p_distance_km IS NULL OR p_distance_km <= 0 OR p_distance_km > 1000 THEN
        RAISE EXCEPTION 'ERR_INVALID_DISTANCE: Hindi wasto ang distansya. (Invalid distance.)';
    END IF;

    v_rule := public.fare_rule_in_force(clock_timestamp());
    v_calc := public.calculate_fare(
        round(p_distance_km, 3), 'Solo', COALESCE(p_passenger_count, 1),
        v_rule.base_fare, v_rule.base_distance_km, v_rule.succeeding_rate
    );

    -- Both trip types are returned (solo_fare / shared_matched_estimate); the app picks one.
    RETURN (v_calc - 'estimated_fare' - 'trip_type') || jsonb_build_object('rule', public._fare_rule_json(v_rule));
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. PRIVILEGES
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.calculate_fare(NUMERIC, TEXT, INTEGER, NUMERIC, NUMERIC, NUMERIC, INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._shared_segments(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.allocate_shared_fares(JSONB, NUMERIC, NUMERIC, NUMERIC, INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.quote_fare(NUMERIC, INTEGER) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.calculate_fare(NUMERIC, TEXT, INTEGER, NUMERIC, NUMERIC, NUMERIC, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.allocate_shared_fares(JSONB, NUMERIC, NUMERIC, NUMERIC, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.quote_fare(NUMERIC, INTEGER) TO authenticated, service_role;
