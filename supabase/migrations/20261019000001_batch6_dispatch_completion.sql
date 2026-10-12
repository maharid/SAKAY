-- ============================================================================
-- Migration: 20261019000001_batch6_dispatch_completion.sql
-- Batch 6 (Intelligent Driver Dispatch), Phase B: what the re-audit of 2026-10-11 found missing or wrong. ONE forward-only migration; the
-- earlier Batch 6 migrations (20261015000001 - 20261018000001) are untouched and already live. Decisions: docs/policy-decisions.md section 12.1.
--
--   1  dispatch_setting_default()   the default of the two editable settings in ONE place; the Tier 3 maximum is 600 s (10 minutes) as the
--                                   specification and Section 30 criterion 8 say (D-2; it was 300). The LGU administrator can still change it.
--   2  dispatch_constant()          replaced (same keys + the new ones below) and the new numbers mirrored in packages/shared/.../policyConfig.ts
--   3  ETA from the routing engine  (D-1) OSRM through the `http` extension when it is installed, with a short timeout, a 15 s cache and a circuit
--                                   breaker; the straight-line estimate otherwise, labelled as such. Never throws, never fakes: eta_source says which.
--   4  Rule 4.4 for Retry           (M1) retry_driver_search() refuses while the passenger has another open booking; one shared definition of
--                                   "open booking" for the booking insert and for Retry; and a No Driver Found older than 60 minutes cannot be retried (D-4)
--   5  hardening                    (M2) one Pending offer per booking is a unique index; response_status has a CHECK; dispatch_sweep() is no longer
--                                   callable by signed-in users (the scheduled job and the database's own functions run it)
--   6  audit and Rule 7.9           (M3) every offer records the driver's position, accuracy and fix age at ranking time; the review flag carries the
--                                   decline reasons; get_driver_decline_history() lets the TODA administrator read them
--   7  Coverage Gap Indicator       (M5, PI-11 = A, D-3) 5 or more bookings of one zone reaching Tier 3 or ending as No Driver Found within 24 hours
--                                   are logged once a day per zone through record_policy_audit (analysis only: no penalty, no ranking change)
--   8  No Driver Found -> Cancelled (H9) the passenger may close the booking, never a strike and never counted as booking abuse
--   9  housekeeping                 a daily job removes old pg_cron run details and OSRM cache rows
--  10  leftover offers              an offer still marked Pending on a booking that is no longer being searched (the old browser dispatcher wrote offers
--                                   with no expiry and nothing closed them) kept its driver out of EVERY search for good, with nothing on the driver's phone and
--                                   nothing on the passenger's screen: they are closed here, and dispatch_eligible_drivers() now counts only an offer
--                                   the driver can still act on
--
-- Forward-only. Safe to run twice. Nothing here calls the network unless the `http` extension is installed.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. THE DEFAULTS OF THE TWO EDITABLE SETTINGS (one place)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispatch_setting_default(p_key TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE p_key
        WHEN 'offer_window_seconds' THEN 15     -- Rule 7.3 (initial pilot value)
        WHEN 'tier3_max_seconds'    THEN 600    -- appendix section 6, Section 30 criterion 8; decision D-2 of 2026-10-11 (the earlier default was 300)
        ELSE NULL
    END;
$$;
REVOKE EXECUTE ON FUNCTION public.dispatch_setting_default(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_setting_default(TEXT) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. THE NUMBERS (dispatch_constant: same keys as 20261017000001, plus the new ones at the end)
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
        -- Phase B (2026-10-11)
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
        ELSE NULL
    END;
$$;

-- ----------------------------------------------------------------------------
-- 3. SCHEMA: what the new rules need (and nothing else)
-- ----------------------------------------------------------------------------
-- booking.dispatch_ended_at: when the search ended (accepted, cancelled, No Driver Found). The booking had no such moment (and no updated_at):
-- the Retry freshness limit (D-4) and the Coverage Gap window (D-3) both need it. NULL while a search runs; a booking that ended before this
-- migration has NULL and is dated by its created_at.
ALTER TABLE public.booking
    ADD COLUMN IF NOT EXISTS dispatch_ended_at TIMESTAMPTZ;
COMMENT ON COLUMN public.booking.dispatch_ended_at IS 'When the search for a driver last ended (accepted, cancelled, No Driver Found, Rule 12.8). NULL while it runs. Set by the system only.';

CREATE INDEX IF NOT EXISTS idx_booking_coverage_gap_ended
    ON public.booking (dispatch_ended_at)
    WHERE dispatch_ended_reason IN ('no_driver_found', 'accepted_drivers_cancelled');
CREATE INDEX IF NOT EXISTS idx_booking_coverage_gap_tier3
    ON public.booking (dispatch_reached_tier3_at)
    WHERE dispatch_reached_tier3_at IS NOT NULL;

-- dispatch_attempt: the inputs of the ranking, so a decision can be explained afterwards (specification W12; Rule 7.2.1 "reproducible").
ALTER TABLE public.dispatch_attempt
    ADD COLUMN IF NOT EXISTS driver_lat      DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS driver_lng      DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS gps_accuracy_m  DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS gps_age_seconds INTEGER;
COMMENT ON COLUMN public.dispatch_attempt.driver_lat IS 'The driver''s last published position when this offer was ranked and sent (with driver_lng, gps_accuracy_m, gps_age_seconds).';
COMMENT ON COLUMN public.dispatch_attempt.eta_source IS 'osrm = the routing engine''s duration and road distance; straight_line_estimate = the labelled estimate used when the routing engine was not available.';

-- A leftover offer: still 'Pending' although its booking is no longer being searched (accepted by someone else, cancelled, completed). The old browser
-- dispatcher wrote offers with no expiry, and the trigger that withdraws offers when a booking ends (20261015000002) only covers bookings that end
-- after it. dispatch_eligible_drivers() read such an offer as "this driver is holding an unanswered offer" for ever, so the driver was passed over by
-- every search (section 5A stops that too). Closed here; the driver's phone never showed them (get_my_pending_offer() ignores a finished booking).
DO $$
DECLARE
    v_left INTEGER;
BEGIN
    UPDATE public.dispatch_attempt a
       SET response_status = 'Expired', responded_at = COALESCE(a.responded_at, clock_timestamp())
      FROM public.booking b
     WHERE b.booking_id = a.booking_id
       AND a.response_status = 'Pending'
       AND NOT public._booking_is_searching(b.booking_status);
    GET DIAGNOSTICS v_left = ROW_COUNT;
    IF v_left > 0 THEN
        RAISE NOTICE '% leftover Pending offer(s) of finished bookings were closed.', v_left;
    END IF;
END $$;

-- At most ONE unanswered offer per booking, enforced by the database (the engine already offers one at a time under the booking's row lock).
-- Any duplicate that already exists (it can only be a leftover of the old browser dispatcher) is closed first, keeping the newest.
DO $$
DECLARE
    v_closed INTEGER;
BEGIN
    WITH ranked AS (
        SELECT attempt_id,
               row_number() OVER (PARTITION BY booking_id ORDER BY notification_sent_at DESC, attempt_id DESC) AS rn
          FROM public.dispatch_attempt
         WHERE response_status = 'Pending'
    )
    UPDATE public.dispatch_attempt a
       SET response_status = 'Expired', responded_at = COALESCE(a.responded_at, clock_timestamp())
      FROM ranked r
     WHERE a.attempt_id = r.attempt_id AND r.rn > 1;
    GET DIAGNOSTICS v_closed = ROW_COUNT;
    IF v_closed > 0 THEN
        RAISE NOTICE '% duplicate Pending offer(s) were closed (the newest of each booking was kept) before the unique index was created.', v_closed;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dispatch_attempt_one_pending_per_booking
    ON public.dispatch_attempt (booking_id)
    WHERE response_status = 'Pending';

-- The words an offer may have. NOT VALID: rows written before this migration are not re-checked (they may hold an old spelling); every new
-- row and every update must use these.
ALTER TABLE public.dispatch_attempt DROP CONSTRAINT IF EXISTS dispatch_attempt_response_status_check;
ALTER TABLE public.dispatch_attempt ADD CONSTRAINT dispatch_attempt_response_status_check
    CHECK (response_status IN ('Pending', 'Accepted', 'Declined', 'Expired')) NOT VALID;
ALTER TABLE public.dispatch_attempt DROP CONSTRAINT IF EXISTS dispatch_attempt_eta_source_check;
ALTER TABLE public.dispatch_attempt ADD CONSTRAINT dispatch_attempt_eta_source_check
    CHECK (eta_source IS NULL OR eta_source IN ('osrm', 'straight_line_estimate')) NOT VALID;

-- The routing engine's answers, reused for a few seconds (D-1), and its health (the circuit breaker). Internal tables: no policy, no grant.
CREATE TABLE IF NOT EXISTS public.osrm_eta_cache (
    booking_id       UUID NOT NULL REFERENCES public.booking(booking_id) ON DELETE CASCADE,
    driver_id        UUID NOT NULL REFERENCES public.driver(driver_id) ON DELETE CASCADE,
    eta_seconds      INTEGER NOT NULL,
    route_distance_m INTEGER,
    driver_lat       DOUBLE PRECISION NOT NULL,
    driver_lng       DOUBLE PRECISION NOT NULL,
    computed_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (booking_id, driver_id)
);
CREATE INDEX IF NOT EXISTS idx_osrm_eta_cache_computed_at ON public.osrm_eta_cache (computed_at);

CREATE TABLE IF NOT EXISTS public.osrm_eta_state (
    singleton            BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    open_until           TIMESTAMPTZ,
    last_success_at      TIMESTAMPTZ,
    last_failure_at      TIMESTAMPTZ,
    last_error           TEXT,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.osrm_eta_state (singleton) VALUES (TRUE) ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.osrm_eta_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.osrm_eta_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.osrm_eta_cache FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.osrm_eta_state FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. ETA FROM THE ROUTING ENGINE (D-1)
-- ----------------------------------------------------------------------------
-- The servers (mirrored as OSRM_BASE_URLS in policyConfig.ts; the drift test fails if they differ).
CREATE OR REPLACE FUNCTION public._osrm_base_url(p_n INTEGER)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE p_n
        WHEN 1 THEN 'https://router.project-osrm.org'
        WHEN 2 THEN 'https://routing.openstreetmap.de/routed-car'
    END;
$$;

-- The ONLY place the database talks to the network. Returns the response body of a GET (status 200), NULL when this database has no way to
-- make the request (the `http` extension is not installed: the local emulator, or a project that has not enabled it), and raises on any
-- failure (a timeout, no connection, another status). A test replaces this one function. The extension is looked up by name, so it works
-- whichever schema it was installed in; the timeout is set for this request only.
CREATE OR REPLACE FUNCTION public._osrm_http_get(p_url TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_schema TEXT;
    v_status INTEGER;
    v_body TEXT;
    v_timeout_ms INTEGER := public.dispatch_constant('osrm_timeout_ms');
BEGIN
    SELECT n.nspname INTO v_schema
      FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
     WHERE e.extname = 'http';
    IF v_schema IS NULL THEN
        RETURN NULL;
    END IF;

    BEGIN
        PERFORM set_config('http.timeout_msec', v_timeout_ms::TEXT, TRUE);          -- older versions of the extension read this setting
        BEGIN
            EXECUTE format('SELECT %I.http_set_curlopt(%L, %L)', v_schema, 'CURLOPT_TIMEOUT_MS', v_timeout_ms::TEXT);
        EXCEPTION WHEN OTHERS THEN
            EXECUTE format('SELECT %I.http_set_curlopt(%L, %L)', v_schema, 'CURLOPT_TIMEOUT', GREATEST(1, ceil(v_timeout_ms / 1000.0))::TEXT);
        END;
        EXECUTE format('SELECT status, content FROM %I.http_get(%L)', v_schema, p_url) INTO v_status, v_body;
        EXECUTE format('SELECT %I.http_reset_curlopt()', v_schema);
    EXCEPTION WHEN OTHERS THEN
        BEGIN
            EXECUTE format('SELECT %I.http_reset_curlopt()', v_schema);
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
        RAISE;
    END;

    IF v_status IS DISTINCT FROM 200 THEN
        RAISE EXCEPTION 'osrm_http_status_%', COALESCE(v_status::TEXT, 'none');
    END IF;
    RETURN v_body;
END;
$$;

-- The routing engine's duration and road distance from each asked-for driver to the booking's pickup, as {driver_id: {"eta": s, "dist": m}}.
-- Only drivers with an answer appear; the caller ranks by the routing engine only when EVERY driver has one (a ranking never mixes the two
-- scales). One `table` request covers all the drivers that have no fresh cached answer. NEVER raises: any failure leaves the drivers out.
--   * a cached answer is reused for osrm_cache_seconds (15 s);
--   * a request may take osrm_timeout_ms (2 s); a failure is retried once on the second server; one ranking makes at most
--     osrm_calls_per_transaction (2) requests;
--   * osrm_failure_limit (3) failed rankings in a row open the circuit breaker: for osrm_breaker_seconds (60 s) nothing is asked.
CREATE OR REPLACE FUNCTION public._dispatch_osrm_etas(p_booking_id UUID, p_driver_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ttl INTERVAL := make_interval(secs => public.dispatch_constant('osrm_cache_seconds'));
    v_budget INTEGER := public.dispatch_constant('osrm_calls_per_transaction');
    v_limit INTEGER := public.dispatch_constant('osrm_failure_limit');
    v_pickup_lat DOUBLE PRECISION;
    v_pickup_lng DOUBLE PRECISION;
    v_missing UUID[];
    v_ids UUID[];
    v_coords TEXT;
    v_n INTEGER;
    v_calls INTEGER;
    v_open_until TIMESTAMPTZ;
    v_attempt INTEGER;
    v_url TEXT;
    v_body TEXT;
    v_json JSONB;
    v_i INTEGER;
    v_dur NUMERIC;
    v_dist NUMERIC;
    v_done BOOLEAN := FALSE;
    v_tried BOOLEAN := FALSE;
    v_no_transport BOOLEAN := FALSE;
    v_err TEXT;
    v_result JSONB;
BEGIN
    IF p_driver_ids IS NULL OR cardinality(p_driver_ids) = 0 THEN
        RETURN '{}'::JSONB;
    END IF;

    BEGIN
        SELECT COALESCE(array_agg(x), ARRAY[]::UUID[]) INTO v_missing
          FROM unnest(p_driver_ids) AS x
         WHERE NOT EXISTS (SELECT 1 FROM public.osrm_eta_cache c
                            WHERE c.booking_id = p_booking_id AND c.driver_id = x AND c.computed_at > clock_timestamp() - v_ttl);

        IF cardinality(v_missing) > 0 THEN
            SELECT b.pickup_latitude, b.pickup_longitude INTO v_pickup_lat, v_pickup_lng FROM public.booking b WHERE b.booking_id = p_booking_id;
            SELECT s.open_until INTO v_open_until FROM public.osrm_eta_state s WHERE s.singleton;
            v_calls := COALESCE(NULLIF(current_setting('sakay.osrm_calls', TRUE), '')::INTEGER, 0);

            IF v_pickup_lat IS NOT NULL AND (v_open_until IS NULL OR v_open_until <= clock_timestamp()) THEN
                SELECT string_agg(round(d.current_longitude::NUMERIC, 6)::TEXT || ',' || round(d.current_latitude::NUMERIC, 6)::TEXT, ';' ORDER BY d.driver_id),
                       array_agg(d.driver_id ORDER BY d.driver_id)
                  INTO v_coords, v_ids
                  FROM public.driver d
                 WHERE d.driver_id = ANY (v_missing) AND d.current_latitude IS NOT NULL AND d.current_longitude IS NOT NULL;
                v_n := COALESCE(cardinality(v_ids), 0);

                IF v_n > 0 THEN
                    -- the drivers are the sources (0 .. n-1), the pickup is the one destination (n)
                    v_coords := v_coords || ';' || round(v_pickup_lng::NUMERIC, 6)::TEXT || ',' || round(v_pickup_lat::NUMERIC, 6)::TEXT;
                    FOR v_attempt IN 1..2 LOOP
                        EXIT WHEN v_calls >= v_budget;
                        v_url := public._osrm_base_url(v_attempt) || '/table/v1/driving/' || v_coords
                              || '?sources=' || (SELECT string_agg(g::TEXT, ';' ORDER BY g) FROM generate_series(0, v_n - 1) g)
                              || '&destinations=' || v_n::TEXT || '&annotations=duration,distance';
                        v_calls := v_calls + 1;
                        v_tried := TRUE;
                        BEGIN
                            v_body := public._osrm_http_get(v_url);
                            IF v_body IS NULL THEN                    -- this database cannot make the request: not a failure of the routing engine
                                v_no_transport := TRUE;
                                v_calls := v_calls - 1;
                                EXIT;
                            END IF;
                            v_json := v_body::JSONB;
                            IF v_json ->> 'code' IS DISTINCT FROM 'Ok' THEN
                                RAISE EXCEPTION 'osrm_code_%', COALESCE(v_json ->> 'code', 'none');
                            END IF;
                            FOR v_i IN 1..v_n LOOP
                                v_dur  := (v_json #>> ARRAY['durations',  (v_i - 1)::TEXT, '0'])::NUMERIC;
                                v_dist := (v_json #>> ARRAY['distances', (v_i - 1)::TEXT, '0'])::NUMERIC;
                                IF v_dur IS NOT NULL AND v_dur >= 0 THEN
                                    INSERT INTO public.osrm_eta_cache (booking_id, driver_id, eta_seconds, route_distance_m, driver_lat, driver_lng, computed_at)
                                    SELECT p_booking_id, d.driver_id, round(v_dur)::INTEGER,
                                           CASE WHEN v_dist IS NOT NULL AND v_dist >= 0 THEN round(v_dist)::INTEGER END,
                                           d.current_latitude, d.current_longitude, clock_timestamp()
                                      FROM public.driver d WHERE d.driver_id = v_ids[v_i]
                                    ON CONFLICT (booking_id, driver_id) DO UPDATE
                                       SET eta_seconds = EXCLUDED.eta_seconds, route_distance_m = EXCLUDED.route_distance_m,
                                           driver_lat = EXCLUDED.driver_lat, driver_lng = EXCLUDED.driver_lng, computed_at = EXCLUDED.computed_at;
                                END IF;
                            END LOOP;
                            v_done := TRUE;
                            EXIT;
                        EXCEPTION WHEN OTHERS THEN
                            v_err := left(SQLERRM, 300);
                        END;
                    END LOOP;

                    PERFORM set_config('sakay.osrm_calls', v_calls::TEXT, TRUE);
                    IF v_done THEN
                        UPDATE public.osrm_eta_state
                           SET consecutive_failures = 0, open_until = NULL, last_success_at = clock_timestamp(), updated_at = clock_timestamp()
                         WHERE singleton;
                    ELSIF v_tried AND NOT v_no_transport AND v_err IS NOT NULL THEN
                        UPDATE public.osrm_eta_state
                           SET consecutive_failures = consecutive_failures + 1,
                               last_failure_at = clock_timestamp(),
                               last_error = v_err,
                               open_until = CASE WHEN consecutive_failures + 1 >= v_limit
                                                 THEN clock_timestamp() + make_interval(secs => public.dispatch_constant('osrm_breaker_seconds'))
                                                 ELSE open_until END,
                               updated_at = clock_timestamp()
                         WHERE singleton;
                    END IF;
                END IF;
            END IF;
        END IF;

        SELECT COALESCE(jsonb_object_agg(c.driver_id::TEXT, jsonb_build_object('eta', c.eta_seconds, 'dist', c.route_distance_m)), '{}'::JSONB)
          INTO v_result
          FROM public.osrm_eta_cache c
         WHERE c.booking_id = p_booking_id AND c.driver_id = ANY (p_driver_ids) AND c.computed_at > clock_timestamp() - v_ttl;
        RETURN v_result;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'dispatch: the routing engine step failed for booking % (%); the straight-line estimate is used', p_booking_id, SQLERRM;
        RETURN '{}'::JSONB;
    END;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. THE OFFER (replaces the function of 20261015000002: same signature, same ranking, plus the routing engine and the audit snapshot)
-- ----------------------------------------------------------------------------
-- Ranking (Rule 7.2.1), in this exact order: shortest ETA; [a driver's single-use redispatch credit, PI-02 = A, only ever breaks an exact ETA
-- tie]; shortest road distance; longest continuous available time; earliest account approval; lowest driver id. Nothing else.
-- The ETA and the distance are the routing engine's (eta_source 'osrm') when it answered for EVERY candidate of this ranking; otherwise
-- they are all the straight-line estimate (eta_source 'straight_line_estimate'): a ranking never mixes the two scales.
-- The routing engine is asked about the nearest osrm_max_candidates (15) candidates of the tier by straight line, so one request covers them;
-- any further candidates are ranked in a later round, after these have been offered.
CREATE OR REPLACE FUNCTION public._dispatch_offer_next(p_booking_id UUID, p_tier SMALLINT, p_toda_id UUID, p_radius_m INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_b public.booking;
    c RECORD;
    v_snap RECORD;
    v_rank INTEGER;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_hold INTEGER := public.dispatch_constant('offer_window_seconds') + public.dispatch_constant('offer_grace_seconds');
    v_cands JSONB;
    v_ids UUID[];
    v_osrm JSONB;
    v_use_osrm BOOLEAN;
    v_source TEXT;
BEGIN
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id;
    SELECT count(*) + 1 INTO v_rank FROM public.dispatch_attempt WHERE booking_id = p_booking_id AND cycle = v_b.dispatch_cycle;

    SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::JSONB) INTO v_cands
      FROM (SELECT e.*
              FROM public.dispatch_eligible_drivers(p_booking_id, p_radius_m) e
             WHERE (p_toda_id IS NULL OR e.toda_id = p_toda_id)
             ORDER BY e.distance_m, e.driver_id
             LIMIT public.dispatch_constant('osrm_max_candidates')) s;
    IF jsonb_array_length(v_cands) = 0 THEN
        RETURN FALSE;
    END IF;

    SELECT array_agg((x ->> 'driver_id')::UUID) INTO v_ids FROM jsonb_array_elements(v_cands) x;
    v_osrm := public._dispatch_osrm_etas(p_booking_id, v_ids);
    v_use_osrm := (SELECT count(*) FROM jsonb_object_keys(v_osrm)) = cardinality(v_ids);
    v_source := CASE WHEN v_use_osrm THEN 'osrm' ELSE 'straight_line_estimate' END;

    FOR c IN
        SELECT x.driver_id,
               x.redispatch_credit,
               CASE WHEN v_use_osrm THEN (v_osrm -> x.driver_id::TEXT ->> 'eta')::INTEGER ELSE x.eta_seconds END AS eta,
               CASE WHEN v_use_osrm THEN COALESCE((v_osrm -> x.driver_id::TEXT ->> 'dist')::INTEGER, x.distance_m) ELSE x.distance_m END AS dist
          FROM jsonb_to_recordset(v_cands) AS x(driver_id UUID, toda_id UUID, distance_m INTEGER, eta_seconds INTEGER,
                                                available_since TIMESTAMPTZ, approved_at TIMESTAMPTZ, redispatch_credit BOOLEAN)
         ORDER BY eta, x.redispatch_credit DESC, dist, x.available_since, x.approved_at, x.driver_id
    LOOP
        BEGIN
            SELECT d.current_latitude AS lat, d.current_longitude AS lng, d.last_location_accuracy_m AS acc,
                   GREATEST(0, round(EXTRACT(EPOCH FROM (v_now - d.last_location_update))))::INTEGER AS age
              INTO v_snap
              FROM public.driver d WHERE d.driver_id = c.driver_id;

            INSERT INTO public.dispatch_attempt (
                booking_id, driver_id, dispatch_method, driver_rank, response_status, notification_sent_at,
                cycle, tier, expires_at, eta_seconds, eta_source, distance_m,
                driver_lat, driver_lng, gps_accuracy_m, gps_age_seconds
            ) VALUES (
                p_booking_id, c.driver_id, 'Sequential Tiered', v_rank, 'Pending', v_now,
                v_b.dispatch_cycle, p_tier, v_now + make_interval(secs => v_hold), c.eta, v_source, c.dist,
                v_snap.lat, v_snap.lng, v_snap.acc, v_snap.age
            );
            IF c.redispatch_credit THEN                               -- single use: the credit is spent by the offer it ranked ahead for
                UPDATE public.driver_online_session SET redispatch_credit = FALSE WHERE driver_id = c.driver_id AND ended_at IS NULL;
            END IF;
            RETURN TRUE;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'dispatch: offer to driver % for booking % refused (%), trying the next driver', c.driver_id, p_booking_id, SQLERRM;
        END;
    END LOOP;
    RETURN FALSE;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5A. WHO CAN BE OFFERED A BOOKING (replaces the function of 20261015000002: ONE clause corrected, nothing else)
-- ----------------------------------------------------------------------------
-- The conditions are those of 20261015000002 (spec s.3). The one that changed is "already holding an unanswered offer for another booking": it
-- counted an offer with no expiry as unanswered for ever, and never asked whether that other booking is still being searched, so a leftover offer
-- of the old browser dispatcher (section 3 closes them) kept its driver out of every search without anybody seeing it. It now counts only an offer
-- the driver can still act on: Pending, of a booking that is still being searched, and inside its window (an offer with no expiry recorded gets the
-- offer window from the moment it was sent, as _dispatch_advance() reads it). Not callable by clients: it returns driver positions.
CREATE OR REPLACE FUNCTION public.dispatch_eligible_drivers(p_booking_id UUID, p_max_distance_m INTEGER DEFAULT NULL)
RETURNS TABLE (
    driver_id UUID,
    toda_id UUID,
    distance_m INTEGER,
    eta_seconds INTEGER,
    available_since TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    redispatch_credit BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_b public.booking;
    v_speed NUMERIC := public.dispatch_constant('eta_speed_kmh');
    v_winding NUMERIC := public.dispatch_constant('eta_winding_percent') / 100.0;
    v_hold INTEGER := public.dispatch_constant('offer_window_seconds') + public.dispatch_constant('offer_grace_seconds');
BEGIN
    SELECT * INTO v_b FROM public.booking b WHERE b.booking_id = p_booking_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH cheap AS MATERIALIZED (
        SELECT d.driver_id AS c_driver_id,
               d.toda_id AS c_toda_id,
               public.calculate_haversine_distance_km(v_b.pickup_latitude, v_b.pickup_longitude, d.current_latitude, d.current_longitude) * 1000.0 AS dist_m,
               s.started_at AS session_started_at,
               s.redispatch_credit AS credit,
               COALESCE(a.lgu_verified_at, d.created_at) AS approved
          FROM public.driver d
          JOIN public.driver_online_session s ON s.driver_id = d.driver_id AND s.ended_at IS NULL
          JOIN public.driver_toda_affiliation a ON a.driver_id = d.driver_id AND a.toda_id = d.toda_id AND a.is_active_selection
                AND a.toda_endorsement_status = 'Endorsed' AND a.lgu_verification_status = 'Approved'
          JOIN public.toda t ON t.toda_id = a.toda_id AND t.toda_status = 'Active'
                AND (t.certificate_expiry IS NULL
                     OR (t.certificate_expiry AT TIME ZONE 'Asia/Manila')::DATE >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::DATE)
         WHERE d.availability_status = 'Available'
           AND d.account_status = 'Verified'
           AND d.current_latitude IS NOT NULL AND d.current_longitude IS NOT NULL     -- calculate_haversine_distance_km() answers 0 for a missing position: never rank an unknown one first
           AND (d.bookings_paused_until IS NULL OR d.bookings_paused_until <= clock_timestamp())
           AND NOT EXISTS (                                                           -- already offered this booking in this cycle
                 SELECT 1 FROM public.dispatch_attempt x
                  WHERE x.booking_id = p_booking_id AND x.driver_id = d.driver_id
                    AND (x.cycle = v_b.dispatch_cycle
                         OR (x.cycle IS NULL AND x.notification_sent_at >= COALESCE(v_b.dispatch_cycle_started_at, v_b.search_restarted_at, v_b.created_at))))
           AND NOT EXISTS (                                                           -- already holding an unanswered offer for another booking (one the driver can still act on)
                 SELECT 1 FROM public.dispatch_attempt y
                   JOIN public.booking yb ON yb.booking_id = y.booking_id
                  WHERE y.driver_id = d.driver_id AND y.response_status = 'Pending' AND y.booking_id <> p_booking_id
                    AND public._booking_is_searching(yb.booking_status)
                    AND COALESCE(y.expires_at, y.notification_sent_at + make_interval(secs => v_hold)) > clock_timestamp())
    )
    SELECT c.c_driver_id,
           c.c_toda_id,
           round(c.dist_m)::INTEGER,
           round(c.dist_m / 1000.0 * v_winding / v_speed * 3600.0)::INTEGER,
           GREATEST(c.session_started_at,
                    COALESCE((SELECT max(COALESCE(pb.trip_completed_at, pb.cancelled_at))
                                FROM public.booking pb
                               WHERE pb.driver_id = c.c_driver_id AND pb.booking_status IN ('Completed', 'Cancelled')),
                             c.session_started_at)),
           c.approved,
           c.credit
      FROM cheap c
     WHERE (p_max_distance_m IS NULL OR c.dist_m <= p_max_distance_m)
       AND public.driver_has_fresh_location(c.c_driver_id)
       AND NOT public.driver_has_open_accepted_booking(c.c_driver_id)
       AND NOT COALESCE((public.account_restriction_state('driver', c.c_driver_id)->>'restricted')::BOOLEAN, FALSE)
       AND NOT COALESCE((public.is_driver_documentarily_restricted(c.c_driver_id)->>'is_restricted')::BOOLEAN, FALSE);
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. COVERAGE GAP INDICATOR (Rule 7.10, PI-11 = A, D-3): analysis only
-- ----------------------------------------------------------------------------
-- The zone of a booking = the barangay of its Priority TODA (else that TODA's name); 'Unzoned' when the booking has no Priority TODA.
-- Server-derived: no client value is trusted, and no barangay boundary file is needed.
CREATE OR REPLACE FUNCTION public._dispatch_zone_key(p_toda_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(
        (SELECT COALESCE(NULLIF(btrim(t.barangay), ''), NULLIF(btrim(t.toda_name), '')) FROM public.toda t WHERE t.toda_id = p_toda_id),
        'Unzoned');
$$;

-- Called when a booking first reaches Tier 3 and when a search ends as No Driver Found. When coverage_gap_count (5) or more bookings of the
-- booking's zone reached Tier 3 or ended as No Driver Found within coverage_gap_window_hours (24), ONE audit row per zone per window is written.
-- It changes nothing else: no penalty, no ranking, no fare, no service zone. It never raises (analysis must not stop a search).
CREATE OR REPLACE FUNCTION public._dispatch_check_coverage_gap(p_booking_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_zone TEXT;
    v_window INTERVAL := make_interval(hours => public.dispatch_constant('coverage_gap_window_hours'));
    v_threshold INTEGER := public.dispatch_constant('coverage_gap_count');
    v_n INTEGER;
    v_ids UUID[];
BEGIN
    SELECT public._dispatch_zone_key(b.priority_toda_id) INTO v_zone FROM public.booking b WHERE b.booking_id = p_booking_id;
    IF v_zone IS NULL THEN
        RETURN;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('sakay.coverage_gap:' || v_zone, 0));

    WITH recent AS MATERIALIZED (
        SELECT b.booking_id, b.priority_toda_id,
               COALESCE(b.dispatch_reached_tier3_at, b.dispatch_ended_at, b.created_at) AS at
          FROM public.booking b
         WHERE b.dispatch_reached_tier3_at > clock_timestamp() - v_window
            OR (b.dispatch_ended_reason IN ('no_driver_found', 'accepted_drivers_cancelled')
                AND COALESCE(b.dispatch_ended_at, b.created_at) > clock_timestamp() - v_window)
    )
    SELECT count(*), array_agg(r.booking_id ORDER BY r.at) INTO v_n, v_ids
      FROM recent r
     WHERE public._dispatch_zone_key(r.priority_toda_id) = v_zone;

    IF v_n >= v_threshold
       AND NOT EXISTS (SELECT 1 FROM public.audit_log a
                        WHERE a.action_type = 'COVERAGE_GAP_INDICATOR' AND a.target_id = v_zone
                          AND a.performed_at > clock_timestamp() - v_window) THEN
        PERFORM public.record_policy_audit('COVERAGE_GAP_INDICATOR', v_zone, v_zone, 'Dispatch',
            v_n || ' bookings from the zone "' || v_zone || '" reached the live search or ended as No Driver Found within '
                || public.dispatch_constant('coverage_gap_window_hours') || ' hours (the indicator is logged at ' || v_threshold
                || '). For TODA and LGU analysis only: no penalty, no change to ranking, fares or service zones (Rule 7.10).',
            NULL,
            jsonb_build_object('zone', v_zone, 'bookings', v_n, 'threshold', v_threshold,
                               'window_hours', public.dispatch_constant('coverage_gap_window_hours'), 'booking_ids', to_jsonb(v_ids)));
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'dispatch: the coverage gap check for booking % failed (%)', p_booking_id, SQLERRM;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. THE ORCHESTRATOR (replaces the function of 20261015000002; two additions marked "Phase B")
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
-- 8. THE START AND THE END OF A SEARCH (replace the functions of 20261015000002: one more column each)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.booking_dispatch_init()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.dispatch_cycle := 1;
    NEW.dispatch_reached_tier3_at := NULL;
    NEW.dispatch_pool_refreshed_at := NULL;
    NEW.dispatch_ended_reason := NULL;
    NEW.dispatch_ended_at := NULL;
    NEW.accepted_driver_cancel_count := 0;
    NEW.accept_latitude := NULL;
    NEW.accept_longitude := NULL;
    IF public._booking_is_searching(NEW.booking_status) THEN
        NEW.dispatch_tier := 1;
        NEW.dispatch_cycle_started_at := clock_timestamp();
        NEW.dispatch_tier_started_at := NEW.dispatch_cycle_started_at;
        NEW.dispatch_next_action_at := NEW.dispatch_cycle_started_at;          -- due at once: if the first advance below fails, the sweep picks it up
        NEW.priority_toda_id := public._dispatch_priority_toda(NEW.pickup_latitude, NEW.pickup_longitude);
    ELSE
        NEW.dispatch_tier := NULL;
        NEW.dispatch_cycle_started_at := NULL;
        NEW.dispatch_tier_started_at := NULL;
        NEW.dispatch_next_action_at := NULL;
        NEW.priority_toda_id := NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.booking_dispatch_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF public._booking_is_searching(OLD.booking_status) AND NOT public._booking_is_searching(NEW.booking_status) THEN
        NEW.dispatch_next_action_at := NULL;
        NEW.dispatch_ended_at := COALESCE(NEW.dispatch_ended_at, clock_timestamp());
        NEW.dispatch_ended_reason := COALESCE(NEW.dispatch_ended_reason, CASE NEW.booking_status
            WHEN 'Cancelled' THEN 'cancelled'
            WHEN 'No Driver Found' THEN 'no_driver_found'
            ELSE 'accepted' END);
    END IF;
    RETURN NEW;
END;
$$;

-- The system's search columns cannot be edited by the people on the booking (replaces 20261015000003: dispatch_ended_at joins the list).
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
-- 9. RULE 4.4: ONE DEFINITION OF "OPEN BOOKING", USED BY THE BOOKING INSERT AND BY RETRY (M1)
-- ----------------------------------------------------------------------------
-- TRUE when the passenger already has another open booking and this one may not be opened beside it. Open = searching, or accepted and not yet
-- finished (No Driver Found is not open). The shared-trip exception is exactly the one of 20261015000003. It takes a per-passenger lock for
-- the rest of the transaction, so two attempts of the same passenger (an insert and a Retry, or two Retries) cannot both pass.
CREATE OR REPLACE FUNCTION public._passenger_open_booking_conflict(p_passenger_id UUID, p_is_shared BOOLEAN, p_except_booking_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_open INTEGER;
    v_shared_primary INTEGER;
BEGIN
    IF p_passenger_id IS NULL THEN
        RETURN FALSE;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('sakay.open_booking:' || p_passenger_id::TEXT, 0));

    SELECT count(*) INTO v_open
      FROM public.booking b
     WHERE b.passenger_id = p_passenger_id
       AND b.booking_id IS DISTINCT FROM p_except_booking_id
       AND (public._booking_is_searching(b.booking_status) OR public._booking_is_open_accepted(b.booking_status));
    IF v_open = 0 THEN
        RETURN FALSE;
    END IF;

    SELECT count(*) INTO v_shared_primary
      FROM public.booking b
     WHERE b.passenger_id = p_passenger_id
       AND b.booking_id IS DISTINCT FROM p_except_booking_id
       AND b.is_shared_trip = TRUE
       AND b.booking_status = 'Searching Driver';
    RETURN NOT (v_shared_primary = v_open AND COALESCE(p_is_shared, FALSE));
END;
$$;

CREATE OR REPLACE FUNCTION public.check_one_open_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.passenger_id IS NULL OR NOT public._booking_is_searching(NEW.booking_status) THEN
        RETURN NEW;
    END IF;
    IF public._passenger_open_booking_conflict(NEW.passenger_id, NEW.is_shared_trip, NULL) THEN
        RAISE EXCEPTION 'idx_one_open_booking: passenger already has an active booking' USING ERRCODE = '23505';
    END IF;
    RETURN NEW;
END;
$$;

-- Retry after No Driver Found (replaces 20261015000002): a NEW cycle on the same booking from Tier 1, idempotent while a search runs.
-- New: it refuses (a) a booking that ended more than retry_max_age_minutes (60) ago, because the pickup is probably not where the passenger
-- is any more (D-4), and (b) while the passenger has another open booking (Rule 4.4, M1).
CREATE OR REPLACE FUNCTION public.retry_driver_search(p_booking_id UUID)
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
BEGIN
    IF v_me IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_A_PASSENGER', 'error', 'Only a passenger can search for a driver.');
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id AND passenger_id = v_me FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_YOUR_BOOKING', 'error', 'This booking does not belong to you.');
    END IF;
    IF public._booking_is_searching(v_b.booking_status) THEN
        RETURN jsonb_build_object('success', TRUE, 'already_searching', TRUE);       -- idempotent: never a second cycle
    END IF;
    IF v_b.booking_status <> 'No Driver Found' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_SEARCHING', 'error', 'This booking is no longer looking for a driver.');
    END IF;
    IF v_now - COALESCE(v_b.dispatch_ended_at, v_b.created_at) > make_interval(mins => public.dispatch_constant('retry_max_age_minutes')) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_RETRY_EXPIRED',
            'error', 'This search ended too long ago to be restarted. Please make a new booking.');
    END IF;
    IF public._passenger_open_booking_conflict(v_me, v_b.is_shared_trip, v_b.booking_id) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_OPEN_BOOKING_EXISTS',
            'error', 'You already have another open booking. Finish or cancel it first.');
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.booking
       SET booking_status = 'Pending',
           driver_id = NULL,
           dispatch_cycle = dispatch_cycle + 1,
           dispatch_tier = 1,
           dispatch_cycle_started_at = v_now,
           dispatch_tier_started_at = v_now,
           dispatch_pool_refreshed_at = NULL,
           dispatch_next_action_at = v_now,
           dispatch_ended_reason = NULL,
           dispatch_ended_at = NULL,
           accepted_driver_cancel_count = 0,
           search_restarted_at = v_now,
           priority_toda_id = public._dispatch_priority_toda(pickup_latitude, pickup_longitude)
     WHERE booking_id = p_booking_id;
    PERFORM public._dispatch_advance(p_booking_id);
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE);
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. THE ONE RE-ENTRY POINT (replaces 20261015000002: it stamps the end of a terminated cycle and checks the Coverage Gap)
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
-- 11. NO DRIVER FOUND -> CANCELLED (H9) and the rule that it is never a penalty
-- ----------------------------------------------------------------------------
-- Replaces booking_status_guard() of 20261015000003. The only change: the passenger may also cancel from "No Driver Found" (Rule 7.4,
-- "Cancel without penalty"), so the screen's way out and the database agree.
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
    RETURN NEW;
END;
$$;

-- Replaces strike_on_passenger_cancellation() of 20261015000003. New: closing a booking that was already No Driver Found is NOT a cancellation
-- the passenger is judged by (Rule 7.4: without penalty): no strike (there never was one for it) and it is not counted toward the three
-- cancellations in 24 hours that raise a booking-abuse review flag (Rule 12.9), nor are bookings the system ended for lack of a driver.
CREATE OR REPLACE FUNCTION public.strike_on_passenger_cancellation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_grace INTEGER := public.dispatch_constant('passenger_cancel_grace_seconds');
    v_in_grace BOOLEAN;
    v_window INTERVAL := make_interval(hours => public.dispatch_constant('repeat_cancel_window_hours'));
    v_last_done TIMESTAMPTZ;
    v_recent INTEGER;
BEGIN
    IF NEW.cancelled_by IS DISTINCT FROM 'passenger' OR NEW.passenger_id IS NULL OR OLD.booking_status = 'No Driver Found' THEN
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
       AND b.dispatch_ended_reason IS DISTINCT FROM 'no_driver_found'
       AND b.dispatch_ended_reason IS DISTINCT FROM 'accepted_drivers_cancelled'
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
-- 12. RULE 7.9: THE REASONS GO WITH THE FLAG, AND THE TODA ADMINISTRATOR CAN READ THE HISTORY (M3)
-- ----------------------------------------------------------------------------
-- Replaces decline_booking_offer() of 20261015000002: identical, except that the review flag carries the breakdown of the decline reasons.
-- (A flag that is already open is not rewritten by a later decline: get_driver_decline_history() below always reads the live figures.)
CREATE OR REPLACE FUNCTION public.decline_booking_offer(p_attempt_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_driver UUID := public.get_current_driver_id();
    v_booking_id UUID;
    v_att public.dispatch_attempt;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_declines INTEGER;
    v_window INTERVAL := make_interval(hours => public.dispatch_constant('decline_flag_window_hours'));
    v_by_reason JSONB;
BEGIN
    IF v_driver IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_A_DRIVER', 'error', 'Only a driver can decline a booking.');
    END IF;
    IF p_reason IS NULL OR p_reason NOT IN ('vehicle_issue', 'personal_emergency', 'safety_concern', 'end_of_shift', 'other') THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_DECLINE_REASON_REQUIRED',
            'error', 'Choose why you are declining: vehicle issue, personal emergency, safety concern, end of shift, or other.');
    END IF;
    SELECT a.booking_id INTO v_booking_id FROM public.dispatch_attempt a WHERE a.attempt_id = p_attempt_id AND a.driver_id = v_driver;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_OFFER_NOT_FOUND', 'error', 'This offer does not exist.');
    END IF;

    PERFORM 1 FROM public.booking WHERE booking_id = v_booking_id FOR UPDATE;
    SELECT * INTO v_att FROM public.dispatch_attempt WHERE attempt_id = p_attempt_id FOR UPDATE;
    IF v_att.response_status <> 'Pending' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_OFFER_CLOSED', 'error', 'This offer is already closed.');
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.dispatch_attempt
       SET response_status = 'Declined', responded_at = clock_timestamp(), decline_reason = p_reason
     WHERE attempt_id = p_attempt_id;

    -- Rule 7.9: a repeated pattern of refusals while Online and Available is flagged for the TODA administrator. A flag only: no strike.
    SELECT count(*) INTO v_declines FROM public.dispatch_attempt
     WHERE driver_id = v_driver AND response_status = 'Declined' AND responded_at IS NOT NULL
       AND responded_at > clock_timestamp() - v_window;
    IF v_declines >= public.dispatch_constant('decline_flag_count') THEN
        SELECT COALESCE(jsonb_object_agg(r.reason, r.n), '{}'::JSONB) INTO v_by_reason
          FROM (SELECT COALESCE(a.decline_reason, 'not_given') AS reason, count(*) AS n
                  FROM public.dispatch_attempt a
                 WHERE a.driver_id = v_driver AND a.response_status = 'Declined' AND a.responded_at IS NOT NULL
                   AND a.responded_at > clock_timestamp() - v_window
                 GROUP BY COALESCE(a.decline_reason, 'not_given')) r;
        PERFORM public._presence_flag('DRIVER_REPEATED_DECLINES', v_driver, 'Rule 7.9',
            jsonb_build_object('declines_in_window', v_declines, 'window_hours', public.dispatch_constant('decline_flag_window_hours'),
                               'latest_reason', p_reason, 'reasons', v_by_reason,
                               'note', 'Review flag only. A strike needs the administrator''s confirmation (Rule 7.9). The history is in get_driver_decline_history().'));
    END IF;

    PERFORM public._dispatch_advance(v_booking_id);                    -- the next-ranked driver, immediately
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'booking_id', v_booking_id);
END;
$$;

-- What the TODA administrator needs to decide whether refusals are "repeated unjustified booking refusals" (Rule 7.9): the stated reasons, the
-- offers and what became of them, and the driver's circumstances. The administrator of a TODA the driver belongs to, and the LGU administrator.
-- No passenger is named.
CREATE OR REPLACE FUNCTION public.get_driver_decline_history(p_driver_id UUID, p_days INTEGER DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_days INTEGER := LEAST(180, GREATEST(1, COALESCE(p_days, public.dispatch_constant('decline_history_days'))));
    v_since TIMESTAMPTZ;
    v_my_toda UUID := public.get_current_toda_admin_toda_id();
    v_driver public.driver;
    v_summary JSONB;
    v_by_reason JSONB;
    v_declines JSONB;
BEGIN
    SELECT * INTO v_driver FROM public.driver WHERE driver_id = p_driver_id;
    IF NOT FOUND
       OR NOT (COALESCE(public.is_lgu_admin(), FALSE)
               OR (v_my_toda IS NOT NULL AND (v_driver.toda_id = v_my_toda OR COALESCE(public.toda_admin_has_affiliation_with_driver(p_driver_id), FALSE)))) THEN
        RAISE EXCEPTION 'Access Denied: Only an administrator of this driver''s TODA, or the LGU administrator, can read this history.' USING ERRCODE = '42501';
    END IF;
    v_since := clock_timestamp() - make_interval(days => v_days);

    SELECT jsonb_build_object(
               'offers',     count(*),
               'accepted',   count(*) FILTER (WHERE a.response_status = 'Accepted'),
               'declined',   count(*) FILTER (WHERE a.response_status = 'Declined' AND a.responded_at IS NOT NULL),
               'unanswered', count(*) FILTER (WHERE a.unanswered),
               'withdrawn',  count(*) FILTER (WHERE a.response_status = 'Expired' AND a.responded_at IS NOT NULL))
      INTO v_summary
      FROM public.dispatch_attempt a
     WHERE a.driver_id = p_driver_id AND a.notification_sent_at >= v_since;

    SELECT COALESCE(jsonb_object_agg(r.reason, r.n), '{}'::JSONB) INTO v_by_reason
      FROM (SELECT COALESCE(a.decline_reason, 'not_given') AS reason, count(*) AS n
              FROM public.dispatch_attempt a
             WHERE a.driver_id = p_driver_id AND a.response_status = 'Declined' AND a.responded_at IS NOT NULL AND a.notification_sent_at >= v_since
             GROUP BY COALESCE(a.decline_reason, 'not_given')) r;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'attempt_id', t.attempt_id, 'booking_id', t.booking_id, 'declined_at', t.responded_at, 'reason', t.decline_reason,
               'tier', t.tier, 'cycle', t.cycle, 'eta_seconds', t.eta_seconds, 'distance_m', t.distance_m) ORDER BY t.responded_at DESC), '[]'::JSONB)
      INTO v_declines
      FROM (SELECT a.* FROM public.dispatch_attempt a
             WHERE a.driver_id = p_driver_id AND a.response_status = 'Declined' AND a.responded_at IS NOT NULL AND a.notification_sent_at >= v_since
             ORDER BY a.responded_at DESC LIMIT 100) t;

    RETURN jsonb_build_object(
        'success', TRUE,
        'driver_id', p_driver_id,
        'window_days', v_days,
        'since', v_since,
        'summary', v_summary,
        'by_reason', v_by_reason,
        'declines', v_declines,
        'completed_trips', (SELECT count(*) FROM public.booking b WHERE b.driver_id = p_driver_id AND b.booking_status = 'Completed' AND b.created_at >= v_since),
        'availability_status', v_driver.availability_status,
        'bookings_paused_until', v_driver.bookings_paused_until,
        'open_review_flags', (SELECT count(*) FROM public.admin_review_flag f
                               WHERE f.subject_type = 'driver' AND f.subject_id = p_driver_id::TEXT AND f.flag_type = 'DRIVER_REPEATED_DECLINES'
                                 AND f.status IN ('Open', 'Under Review')));
END;
$$;

-- ----------------------------------------------------------------------------
-- 13. SETTINGS DEFAULTS READ FROM THE ONE PLACE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_dispatch_settings()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RAISE EXCEPTION 'Access Denied: Only an LGU administrator can read the dispatch settings.' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object(
        'offer_window_seconds', public.dispatch_constant('offer_window_seconds'),
        'tier3_max_seconds', public.dispatch_constant('tier3_max_seconds'),
        'defaults', jsonb_build_object('offer_window_seconds', public.dispatch_setting_default('offer_window_seconds'),
                                       'tier3_max_seconds', public.dispatch_setting_default('tier3_max_seconds')),
        'limits', jsonb_build_object('offer_window_seconds', jsonb_build_array(10, 60), 'tier3_max_seconds', jsonb_build_array(60, 1800)));
END;
$$;

-- ----------------------------------------------------------------------------
-- 14. HOUSEKEEPING: a daily job removes old pg_cron run details and OSRM cache rows
-- ----------------------------------------------------------------------------
-- The dispatch sweep runs every 5 seconds: about 17,000 rows a day in cron.job_run_details, which nothing removes by itself.
CREATE OR REPLACE FUNCTION public.purge_dispatch_logs()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_days INTEGER := public.dispatch_constant('cron_log_retention_days');
    v_cron BIGINT := 0;
    v_cache BIGINT := 0;
BEGIN
    DELETE FROM public.osrm_eta_cache WHERE computed_at < clock_timestamp() - make_interval(days => v_days);
    GET DIAGNOSTICS v_cache = ROW_COUNT;
    IF to_regclass('cron.job_run_details') IS NOT NULL THEN
        EXECUTE format('DELETE FROM cron.job_run_details WHERE end_time < clock_timestamp() - make_interval(days => %s)', v_days);
        GET DIAGNOSTICS v_cron = ROW_COUNT;
    END IF;
    RETURN jsonb_build_object('cron_run_details_removed', v_cron, 'osrm_cache_rows_removed', v_cache, 'kept_days', v_days);
END;
$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
        CREATE EXTENSION IF NOT EXISTS pg_cron;
        -- Replace any earlier job of the same name so a re-run never creates a duplicate schedule. 19:17 UTC is 03:17 in Manila.
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'sakay-dispatch-log-purge';
        PERFORM cron.schedule('sakay-dispatch-log-purge', '17 19 * * *', 'SELECT public.purge_dispatch_logs()');
    ELSE
        RAISE NOTICE 'pg_cron is not available in this database: the daily purge of old cron run details is NOT scheduled here.';
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 15. PRIVILEGES AND SELF-CHECK
-- ----------------------------------------------------------------------------
-- Internal: the database's own functions call them; no app may.
REVOKE EXECUTE ON FUNCTION public.dispatch_eligible_drivers(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._osrm_base_url(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._osrm_http_get(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._dispatch_osrm_etas(UUID, UUID[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._dispatch_zone_key(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._dispatch_check_coverage_gap(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._passenger_open_booking_conflict(UUID, BOOLEAN, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.purge_dispatch_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_dispatch_logs() TO service_role;

-- M2: the sweep is run by the scheduled job and by the database's own functions (get_my_pending_offer, get_dispatch_status): a signed-in user
-- has no reason to call it directly (and every signed-in user could).
REVOKE EXECUTE ON FUNCTION public.dispatch_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_sweep() TO service_role;

-- For the apps (each checks who is calling).
REVOKE EXECUTE ON FUNCTION public.get_driver_decline_history(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_driver_decline_history(UUID, INTEGER) TO authenticated, service_role;

DO $$
BEGIN
    IF public.dispatch_setting_default('tier3_max_seconds') <> 600 OR public.dispatch_setting_default('offer_window_seconds') <> 15 THEN
        RAISE EXCEPTION 'dispatch_setting_default() does not return the specified values';
    END IF;
    IF public.dispatch_constant('tier1_radius_m') <> 600 OR public.dispatch_constant('tier2_radius_m') <> 2000
       OR public.dispatch_constant('trip_finish_min_progress_pct') <> 90 OR public.dispatch_constant('osrm_timeout_ms') <> 2000
       OR public.dispatch_constant('coverage_gap_count') <> 5 OR public.dispatch_constant('retry_max_age_minutes') <> 60 THEN
        RAISE EXCEPTION 'dispatch_constant() does not return the specified values';
    END IF;
    IF public._osrm_base_url(1) IS NULL OR public._osrm_base_url(2) IS NULL OR public._osrm_base_url(3) IS NOT NULL THEN
        RAISE EXCEPTION '_osrm_base_url() is wrong';
    END IF;
    IF has_function_privilege('authenticated', 'public.dispatch_sweep()', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.dispatch_eligible_drivers(uuid, integer)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public._dispatch_osrm_etas(uuid, uuid[])', 'EXECUTE')
       OR has_table_privilege('authenticated', 'public.osrm_eta_cache', 'SELECT')
       OR has_table_privilege('anon', 'public.osrm_eta_state', 'SELECT') THEN
        RAISE EXCEPTION 'a signed-in user can reach something that is internal';
    END IF;
END $$;
