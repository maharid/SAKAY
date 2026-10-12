-- ============================================================================
-- Migration: 20261020000001_batch6_leftover_offers_fix.sql
-- Batch 6 follow-up: the leftover-offer fix reaches the hosted project.
--
-- 20261019000001 was applied to the hosted project BEFORE its section 3 (the clean-up of leftover offers) and its section 5A (the corrected
-- eligibility test) were added to the file, and a migration file that has been applied does not run again when it changes. The health check of
-- 2026-10-12 showed it: "leftover-offer fix is in the eligibility function: NO". This migration carries exactly those two pieces, copied from
-- that file, so a database that has the earlier version of it ends the same as one that has the whole file. Forward-only. Safe to run twice, and
-- a no-op where the pieces already exist.
--
--   1  leftover offers   every offer still Pending on a booking that is no longer being searched is closed
--   2  eligibility       dispatch_eligible_drivers() counts only an offer the driver can still act on (Pending, its booking still searched,
--                        inside its window), so a leftover can never again keep a driver out of every search
--
-- Decision D-DS-24, docs/policy-decisions.md section 12.1.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. LEFTOVER OFFERS
-- ----------------------------------------------------------------------------
-- A leftover offer: still 'Pending' although its booking is no longer being searched (accepted by someone else, cancelled, completed). The old browser
-- dispatcher wrote offers with no expiry, and the trigger that withdraws offers when a booking ends (20261015000002) only covers bookings that end
-- after it. dispatch_eligible_drivers() read such an offer as "this driver is holding an unanswered offer" for ever, so the driver was passed over by
-- every search (section 2 below stops that too). Closed here; the driver's phone never showed them (get_my_pending_offer() ignores a finished booking).
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

-- ----------------------------------------------------------------------------
-- 2. WHO CAN BE OFFERED A BOOKING (replaces the function of 20261015000002 and of 20261019000001: ONE clause corrected, nothing else)
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

REVOKE EXECUTE ON FUNCTION public.dispatch_eligible_drivers(UUID, INTEGER) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. SELF-CHECK
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF pg_get_functiondef('public.dispatch_eligible_drivers(uuid, integer)'::regprocedure) NOT LIKE '%yb.booking_status%' THEN
        RAISE EXCEPTION 'dispatch_eligible_drivers() was not replaced';
    END IF;
    IF has_function_privilege('authenticated', 'public.dispatch_eligible_drivers(uuid, integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'a signed-in user can run dispatch_eligible_drivers(), which returns driver positions';
    END IF;
    IF EXISTS (SELECT 1 FROM public.dispatch_attempt a JOIN public.booking b ON b.booking_id = a.booking_id
                WHERE a.response_status = 'Pending' AND NOT public._booking_is_searching(b.booking_status)) THEN
        RAISE EXCEPTION 'an unanswered offer of a finished booking is still there';
    END IF;
END $$;
