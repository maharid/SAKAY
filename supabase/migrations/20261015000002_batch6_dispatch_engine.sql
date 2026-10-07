-- ============================================================================
-- Migration: 20261015000002_batch6_dispatch_engine.sql
-- Batch 6 (Intelligent Driver Dispatch), part 2 of 4: the engine.
--
-- ONE of each (spec sections 19-20):
--   dispatch_eligible_drivers()   base eligibility, the only place the conditions are written
--   _dispatch_offer_next()        tier filter + ranking + the offer
--   _dispatch_advance()           the orchestrator: what the search does next for one booking (idempotent, row-locked)
--   _dispatch_redispatch()        the ONE re-entry point for a booking that lost its driver (Rules 8.3, 9.3, 12.3, 12.4, 12.8)
--   accept_booking_offer()        the ONLY way a driver gets a booking (atomic, backend-authoritative)
--   decline_booking_offer()       an explicit decline with its reason (Rule 7.9)
--   retry_driver_search()         Retry after No Driver Found: a new cycle that restarts at Tier 1
--   dispatch_sweep()              advances every search whose deadline has passed
--   get_dispatch_status()         what the passenger's screen shows; also nudges a due search
--   get_my_pending_offer()        what the driver's screen shows; also keeps the searches moving
--
-- WHO MOVES THE CLOCK. Deadlines live in the database (booking.dispatch_next_action_at, dispatch_attempt.expires_at), so the search no longer
-- depends on any phone. They are acted on by whichever of these comes first: the scheduled job (part 4), any Online driver's poll
-- (get_my_pending_offer), the passenger's poll (get_dispatch_status), or the driver's own accept / decline. Each of them runs the same
-- idempotent _dispatch_advance() under a row lock, so two of them at once can never start two cycles or send two offers.
--
-- ETA. The specification ranks by the routing engine's ETA. A database cannot call OSRM, and the Express server sleeps on the free plan, so
-- the ETA stored with each offer is an ESTIMATE from the straight-line distance (x 1.3 winding, at 20 km/h: the figures the apps already
-- use) and is labelled eta_source = 'straight_line_estimate'. Nothing is faked: the label says what it is. Ranking is therefore the same
-- order as the straight-line distance. See docs/policy-decisions.md section 13.
--
-- Forward-only. Safe to run twice.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. SMALL HELPERS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._booking_is_searching(p_status TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT p_status IN ('Pending', 'Searching Driver');
$$;

-- An offer the driver can still act on (the offer is theirs, pending, and not past its expiry).
CREATE OR REPLACE FUNCTION public.rls_driver_has_pending_offer(p_booking_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.dispatch_attempt a
         WHERE a.booking_id = p_booking_id
           AND a.driver_id IS NOT NULL
           AND a.driver_id = public.get_current_driver_id()
           AND a.response_status = 'Pending'
           AND (a.expires_at IS NULL OR a.expires_at > clock_timestamp())
    );
$$;

-- The accredited TODA whose terminal is nearest the pickup (the Priority TODA, spec s.4): active, certificate not expired, with a terminal.
CREATE OR REPLACE FUNCTION public._dispatch_priority_toda(p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT t.toda_id
      FROM public.toda t
     WHERE t.toda_status = 'Active'
       AND (t.certificate_expiry IS NULL
            OR (t.certificate_expiry AT TIME ZONE 'Asia/Manila')::DATE >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::DATE)
       AND t.terminal_latitude IS NOT NULL AND t.terminal_longitude IS NOT NULL
     ORDER BY public.calculate_haversine_distance_km(p_lat, p_lng, t.terminal_latitude, t.terminal_longitude), t.toda_id
     LIMIT 1;
$$;

-- Tell the booking's passenger something (one row per event: the key carries the cycle and the cancellation count).
CREATE OR REPLACE FUNCTION public._dispatch_notify_passenger(p_booking public.booking, p_type TEXT, p_title TEXT, p_message TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_booking.passenger_id IS NULL THEN
        RETURN;
    END IF;
    PERFORM public._notify_subject('passenger', p_booking.passenger_id, p_type, p_title, p_message,
        p_booking.booking_id::TEXT, p_booking.dispatch_cycle * 100 + p_booking.accepted_driver_cancel_count);
END;
$$;

-- ----------------------------------------------------------------------------
-- 1. BASE ELIGIBILITY (spec s.3): the only place these conditions are written
-- ----------------------------------------------------------------------------
-- A driver is a candidate for a booking only if ALL of these hold:
--   Online (open session) and Available; Verified; not suspended / deactivated; documents not expired; an active, endorsed and approved
--   affiliation with an active accredited TODA (the one that is the driver's active selection); a fresh and accurate GPS fix;
--   not paused; not on a trip; not already holding another unanswered offer; not offered THIS booking in the current cycle
--   (a decline, a timeout and a cancellation all count: the offer row stays).
-- p_max_distance_m limits the search area (NULL = no limit). The caller applies the tier's own restriction (Priority TODA).
-- Not callable by clients: it returns driver positions.
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
           AND NOT EXISTS (                                                           -- already holding an unanswered offer for another booking
                 SELECT 1 FROM public.dispatch_attempt y
                  WHERE y.driver_id = d.driver_id AND y.response_status = 'Pending' AND y.booking_id <> p_booking_id
                    AND (y.expires_at IS NULL OR y.expires_at > clock_timestamp()))
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
-- 2. THE OFFER: tier filter, ranking, one driver at a time (spec s.7, s.8)
-- ----------------------------------------------------------------------------
-- Ranking (Rule 7.2.1), in this exact order: shortest ETA; [a driver's single-use redispatch credit after a passenger no-show, Rule 10.4 /
-- decision PI-02 = A, only ever breaks an exact ETA tie]; shortest road distance; longest continuous available time (the earliest
-- "available since"); earliest account approval; lowest driver id. Nothing else (no rating, no score, no boost tokens).
-- Offers the best-ranked candidate inside the radius (and, in Tier 1, of the Priority TODA). If the insert is refused (the driver became
-- busy or restricted between the check and the insert) the next candidate is tried. TRUE when an offer was sent.
CREATE OR REPLACE FUNCTION public._dispatch_offer_next(p_booking_id UUID, p_tier SMALLINT, p_toda_id UUID, p_radius_m INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_b public.booking;
    c RECORD;
    v_rank INTEGER;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_hold INTEGER := public.dispatch_constant('offer_window_seconds') + public.dispatch_constant('offer_grace_seconds');
BEGIN
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id;
    SELECT count(*) + 1 INTO v_rank FROM public.dispatch_attempt WHERE booking_id = p_booking_id AND cycle = v_b.dispatch_cycle;

    FOR c IN
        SELECT e.driver_id, e.distance_m, e.eta_seconds, e.redispatch_credit
          FROM public.dispatch_eligible_drivers(p_booking_id, p_radius_m) e
         WHERE (p_toda_id IS NULL OR e.toda_id = p_toda_id)
         ORDER BY e.eta_seconds, e.redispatch_credit DESC, e.distance_m, e.available_since, e.approved_at, e.driver_id
    LOOP
        BEGIN
            INSERT INTO public.dispatch_attempt (
                booking_id, driver_id, dispatch_method, driver_rank, response_status, notification_sent_at,
                cycle, tier, expires_at, eta_seconds, eta_source, distance_m
            ) VALUES (
                p_booking_id, c.driver_id, 'Sequential Tiered', v_rank, 'Pending', v_now,
                v_b.dispatch_cycle, p_tier, v_now + make_interval(secs => v_hold), c.eta_seconds, 'straight_line_estimate', c.distance_m
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
-- 3. THE ORCHESTRATOR (spec s.1, s.4 - s.8)
-- ----------------------------------------------------------------------------
-- Does whatever the search for ONE booking has to do now and stops at the next thing to wait for. Safe to call at any time, from anywhere,
-- any number of times: it locks the booking row, and it does nothing unless something is due.
--   an offer ran out            -> it is closed as unanswered (Rules 7.6 - 7.8 count it) and the next driver is offered at once
--   no offer is out             -> Tier 1 (Priority TODA, 600 m); nobody there: Tier 2 (2 km, any TODA) with no waiting;
--                                  nobody there: Tier 3 (live search, the radius grows, the pool is looked at again every 30 s)
--   the Tier 3 time is up       -> No Driver Found
-- Returns what it did: inactive | offer_pending | offer_sent | waiting | no_driver_found.
CREATE OR REPLACE FUNCTION public._dispatch_advance(p_booking_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
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
               dispatch_ended_reason = 'no_driver_found'
         WHERE booking_id = p_booking_id;
        PERFORM public._dispatch_notify_passenger(v_b, 'NO_DRIVER_FOUND',
            'Walang available na drayber (No driver available)',
            'We could not find a driver near you. You can search again or cancel without any penalty. '
            || '(Walang nahanap na drayber. Maaari kang mag-search muli o kanselahin nang walang parusa.)');
        PERFORM public.record_policy_audit('DISPATCH_NO_DRIVER_FOUND', p_booking_id::TEXT, NULL, 'Dispatch',
            'No driver accepted within the maximum search time (cycle ' || v_b.dispatch_cycle || ').', NULL,
            jsonb_build_object('cycle', v_b.dispatch_cycle, 'tier', v_tier, 'reached_tier3_at', v_reached3));
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
    END IF;

    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN v_result;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. STARTING A SEARCH: it begins when the booking exists, whatever the app does
-- ----------------------------------------------------------------------------
-- BEFORE INSERT: the search state of a new booking is the server's (a client cannot start a booking in Tier 3, with a chosen Priority TODA,
-- or with a cycle number of its choosing). Runs after trigger_booking_identity_guard (triggers fire in name order).
CREATE OR REPLACE FUNCTION public.booking_dispatch_init()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.dispatch_cycle := 1;
    NEW.dispatch_reached_tier3_at := NULL;
    NEW.dispatch_pool_refreshed_at := NULL;
    NEW.dispatch_ended_reason := NULL;
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
DROP TRIGGER IF EXISTS trigger_booking_start_dispatch_init ON public.booking;
CREATE TRIGGER trigger_booking_start_dispatch_init BEFORE INSERT ON public.booking
    FOR EACH ROW EXECUTE FUNCTION public.booking_dispatch_init();

-- AFTER INSERT: the first offer goes out inside the booking's own transaction. It can never stop the booking from being made: if it fails,
-- the booking is kept (already marked due) and the sweep retries it within seconds.
CREATE OR REPLACE FUNCTION public.booking_dispatch_first_advance()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    IF public._booking_is_searching(NEW.booking_status) THEN
        BEGIN
            PERFORM public._dispatch_advance(NEW.booking_id);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'dispatch could not start for booking % (%); the sweep will retry it', NEW.booking_id, SQLERRM;
        END;
    END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trigger_booking_start_dispatch ON public.booking;
CREATE TRIGGER trigger_booking_start_dispatch AFTER INSERT ON public.booking
    FOR EACH ROW EXECUTE FUNCTION public.booking_dispatch_first_advance();

-- ----------------------------------------------------------------------------
-- 5. A SEARCH THAT ENDS CLOSES ITS OFFERS
-- ----------------------------------------------------------------------------
-- BEFORE: the clocks stop and the reason is recorded. AFTER: any offer still out (the booking was cancelled, or taken some other way) is
-- withdrawn so no driver is left looking at a booking that is gone. A withdrawal is not an ignored offer (responded_at is set).
CREATE OR REPLACE FUNCTION public.booking_dispatch_close()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    IF public._booking_is_searching(OLD.booking_status) AND NOT public._booking_is_searching(NEW.booking_status) THEN
        NEW.dispatch_next_action_at := NULL;
        NEW.dispatch_ended_reason := COALESCE(NEW.dispatch_ended_reason, CASE NEW.booking_status
            WHEN 'Cancelled' THEN 'cancelled'
            WHEN 'No Driver Found' THEN 'no_driver_found'
            ELSE 'accepted' END);
    END IF;
    RETURN NEW;
END;
$$;
-- (the name matters: BEFORE triggers fire in name order and this one must run AFTER trigger_booking_identity_guard, which refuses a client
-- session that changes the search columns; here the SYSTEM changes them as a consequence of the status the client was allowed to set)
DROP TRIGGER IF EXISTS trigger_booking_dispatch_close ON public.booking;
DROP TRIGGER IF EXISTS trigger_booking_status_dispatch_close ON public.booking;
CREATE TRIGGER trigger_booking_status_dispatch_close BEFORE UPDATE OF booking_status ON public.booking
    FOR EACH ROW WHEN (OLD.booking_status IS DISTINCT FROM NEW.booking_status)
    EXECUTE FUNCTION public.booking_dispatch_close();

CREATE OR REPLACE FUNCTION public.booking_dispatch_withdraw_offers()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    IF public._booking_is_searching(OLD.booking_status) AND NOT public._booking_is_searching(NEW.booking_status) THEN
        UPDATE public.dispatch_attempt
           SET response_status = 'Expired', responded_at = clock_timestamp()
         WHERE booking_id = NEW.booking_id AND response_status = 'Pending';
    END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trigger_booking_dispatch_withdraw_offers ON public.booking;
CREATE TRIGGER trigger_booking_dispatch_withdraw_offers AFTER UPDATE OF booking_status ON public.booking
    FOR EACH ROW WHEN (OLD.booking_status IS DISTINCT FROM NEW.booking_status)
    EXECUTE FUNCTION public.booking_dispatch_withdraw_offers();

-- ----------------------------------------------------------------------------
-- 6. THE SWEEP: advance every search whose deadline has passed
-- ----------------------------------------------------------------------------
-- Called by the scheduled job (part 4), by every Online driver's poll and by the passenger's poll. Idempotent and cheap when nothing is due;
-- the advisory lock lets one caller at a time do the work, the others return at once. Returns how many searches it advanced.
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
         ORDER BY COALESCE(b.dispatch_next_action_at, b.created_at)
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
-- 7. WHAT THE PASSENGER'S SCREEN SHOWS
-- ----------------------------------------------------------------------------
-- phase: nearby (Tiers 1-2: the area around the pickup), widening (Tier 3: the live search), ended. The tier numbers are not shown to the
-- passenger (spec W9). It also nudges its own booking if something is due, so the screen moves even if every other clock is quiet.
CREATE OR REPLACE FUNCTION public.get_dispatch_status(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_b public.booking;
    v_me UUID := public.get_current_passenger_id();
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF v_me IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_A_PASSENGER', 'error', 'Only a passenger can look at a search.');
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id AND passenger_id = v_me;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_YOUR_BOOKING', 'error', 'This booking does not belong to you.');
    END IF;

    IF public._booking_is_searching(v_b.booking_status) AND COALESCE(v_b.dispatch_next_action_at, v_b.created_at) <= v_now THEN
        BEGIN
            PERFORM public._dispatch_advance(p_booking_id);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'get_dispatch_status: booking % could not be advanced (%)', p_booking_id, SQLERRM;
        END;
        SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id;
    END IF;

    RETURN jsonb_build_object(
        'success', TRUE,
        'booking_status', v_b.booking_status,
        'phase', CASE WHEN NOT public._booking_is_searching(v_b.booking_status) THEN 'ended'
                      WHEN COALESCE(v_b.dispatch_tier, 1) >= 3 THEN 'widening'
                      ELSE 'nearby' END,
        'cycle', v_b.dispatch_cycle,
        'search_seconds', GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(v_b.dispatch_cycle_started_at, v_b.search_restarted_at, v_b.created_at))))),
        'widening_seconds', CASE WHEN COALESCE(v_b.dispatch_tier, 1) >= 3 AND public._booking_is_searching(v_b.booking_status)
                                 THEN GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - v_b.dispatch_tier_started_at)))) END,
        'ended_reason', v_b.dispatch_ended_reason,
        'driver_assigned', v_b.driver_id IS NOT NULL,
        'driver_unreachable_since', v_b.driver_unreachable_since,
        'accepted_driver_cancel_count', v_b.accepted_driver_cancel_count,
        'server_time', v_now
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. WHAT THE DRIVER'S SCREEN SHOWS
-- ----------------------------------------------------------------------------
-- The driver's one unanswered, unexpired offer with what the offer screen needs, or NULL. seconds_remaining is computed HERE (no clock
-- skew with the phone): the driver always gets the whole response window from the moment the offer reaches them, up to the hard expiry.
-- Every Online driver's poll also keeps the searches moving (dispatch_sweep), so offers expire on time even if no scheduled job runs.
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
        'passenger_name', (SELECT p.full_name FROM public.passenger p WHERE p.passenger_id = v_b.passenger_id),
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
-- 9. ACCEPT: the only way a driver gets a booking (spec s.9: atomic, the backend decides)
-- ----------------------------------------------------------------------------
-- Everything is decided under the booking's row lock, so two drivers accepting at the same moment (or an accept racing a cancellation or an
-- expiry) are serialized: exactly one wins, the other gets a clean "no longer available". The offer must be the caller's own, still pending
-- and not expired. The driver's position is recorded as the starting point (Rules 12.3 / 12.4 measure travel from it).
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
-- 10. DECLINE (Rule 7.9): with a reason, no strike, the next driver at once
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decline_booking_offer(p_attempt_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_driver UUID := public.get_current_driver_id();
    v_booking_id UUID;
    v_att public.dispatch_attempt;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_declines INTEGER;
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
       AND responded_at > clock_timestamp() - make_interval(hours => public.dispatch_constant('decline_flag_window_hours'));
    IF v_declines >= public.dispatch_constant('decline_flag_count') THEN
        PERFORM public._presence_flag('DRIVER_REPEATED_DECLINES', v_driver, 'Rule 7.9',
            jsonb_build_object('declines_in_window', v_declines, 'window_hours', public.dispatch_constant('decline_flag_window_hours'),
                               'latest_reason', p_reason, 'note', 'Review flag only. A strike needs the administrator''s confirmation (Rule 7.9).'));
    END IF;

    PERFORM public._dispatch_advance(v_booking_id);                    -- the next-ranked driver, immediately
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'booking_id', v_booking_id);
END;
$$;

-- ----------------------------------------------------------------------------
-- 11. RETRY after No Driver Found: a NEW cycle that restarts at Tier 1 (spec s.6, Rule 7.4)
-- ----------------------------------------------------------------------------
-- Replaces the function of the same name from 20261014000002 (same signature, so its grants stay). It reuses the single open booking (no
-- second one), clears who was offered what (a new cycle), and is idempotent: retrying a search that is already running changes nothing.
CREATE OR REPLACE FUNCTION public.retry_driver_search(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
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
-- 12. THE ONE RE-ENTRY POINT for a booking that lost its driver (spec D12; Rules 8.3, 9.3, 12.3, 12.4, 12.8)
-- ----------------------------------------------------------------------------
-- A driver who had accepted can no longer take the booking (they cancelled, stalled, or went silent): the booking goes back to the SAME
-- search, in the SAME cycle, so that driver stays excluded; it restarts at Tier 1 with a fresh clock. When three accepted drivers in a row
-- have failed the same booking the cycle ENDS (Rule 12.8): the booking becomes No Driver Found and the passenger may Retry or book again
-- without penalty. Strikes for the driver are the caller's business (each rule has its own).
CREATE OR REPLACE FUNCTION public._dispatch_redispatch(p_booking_id UUID, p_driver_id UUID, p_cancelled_by TEXT, p_reason TEXT, p_notice TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
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
           dispatch_ended_reason = CASE WHEN v_count >= v_limit THEN 'accepted_drivers_cancelled' ELSE NULL END
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
-- 13. PRIVILEGES
-- ----------------------------------------------------------------------------
-- Internal: never callable from an app (they return driver positions or move a search without a caller to check).
REVOKE EXECUTE ON FUNCTION public._booking_is_searching(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._dispatch_priority_toda(DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._dispatch_notify_passenger(public.booking, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.dispatch_eligible_drivers(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._dispatch_offer_next(UUID, SMALLINT, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._dispatch_advance(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._dispatch_redispatch(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.booking_dispatch_init() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.booking_dispatch_first_advance() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.booking_dispatch_close() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.booking_dispatch_withdraw_offers() FROM PUBLIC, anon, authenticated;

-- For the apps (each checks who is calling).
REVOKE EXECUTE ON FUNCTION public.accept_booking_offer(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.decline_booking_offer(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_pending_offer() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_dispatch_status(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dispatch_sweep() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.retry_driver_search(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_booking_offer(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decline_booking_offer(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_pending_offer() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_dispatch_status(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dispatch_sweep() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.retry_driver_search(UUID) TO authenticated, service_role;
