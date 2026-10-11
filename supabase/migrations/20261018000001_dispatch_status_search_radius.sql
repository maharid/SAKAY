-- ============================================================================
-- Migration: 20261018000001_dispatch_status_search_radius.sql
-- get_dispatch_status() also reports HOW FAR the search is looking right now (radius_m), so the passenger's map can draw the area the
-- database is really searching instead of guessing one.
--
-- Nothing about the search changes: who is eligible, how tiers advance, the offers and the trip states are exactly as before. This only
-- READS what the engine already applies (_dispatch_advance):
--     Tier 1  dispatch_constant('tier1_radius_m')   600 m, the Priority TODA's drivers
--     Tier 2  dispatch_constant('tier2_radius_m')   2000 m, any accredited TODA
--     Tier 3  dispatch_tier3_radius_m(seconds since Tier 3 began)   2000 m growing to 3500 m (NULL once the maximum time has passed)
-- and NULL when the search is not running (accepted, cancelled, nobody found). The tier NUMBER is deliberately not added: the passenger sees
-- a distance, never the internals (see scripts/db-tests/batch6/dispatch-engine.js).
--
-- Forward-only. Safe to run twice (CREATE OR REPLACE keeps the existing grants).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_dispatch_status(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_b public.booking;
    v_me UUID := public.get_current_passenger_id();
    v_now TIMESTAMPTZ := clock_timestamp();
    v_searching BOOLEAN;
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

    v_searching := public._booking_is_searching(v_b.booking_status);

    RETURN jsonb_build_object(
        'success', TRUE,
        'booking_status', v_b.booking_status,
        'phase', CASE WHEN NOT v_searching THEN 'ended'
                      WHEN COALESCE(v_b.dispatch_tier, 1) >= 3 THEN 'widening'
                      ELSE 'nearby' END,
        'cycle', v_b.dispatch_cycle,
        'search_seconds', GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(v_b.dispatch_cycle_started_at, v_b.search_restarted_at, v_b.created_at))))),
        'widening_seconds', CASE WHEN COALESCE(v_b.dispatch_tier, 1) >= 3 AND v_searching
                                 THEN GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - v_b.dispatch_tier_started_at)))) END,
        -- How far the search is looking right now, in metres: the very values _dispatch_advance applies for the current tier
        'radius_m', CASE WHEN NOT v_searching THEN NULL
                         WHEN COALESCE(v_b.dispatch_tier, 1) = 1 THEN public.dispatch_constant('tier1_radius_m')
                         WHEN COALESCE(v_b.dispatch_tier, 1) = 2 THEN public.dispatch_constant('tier2_radius_m')
                         ELSE public.dispatch_tier3_radius_m(EXTRACT(EPOCH FROM (v_now - v_b.dispatch_tier_started_at))) END,
        'ended_reason', v_b.dispatch_ended_reason,
        'driver_assigned', v_b.driver_id IS NOT NULL,
        'driver_unreachable_since', v_b.driver_unreachable_since,
        'accepted_driver_cancel_count', v_b.accepted_driver_cancel_count,
        'server_time', v_now
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_dispatch_status(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dispatch_status(UUID) TO authenticated, service_role;
