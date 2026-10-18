-- ============================================================================
-- Migration: 20261028000005_insights_and_controls.sql
-- Four small gaps between the policy and the database, found while building the screens for them:
--
--   1. Rule 7.10  get_coverage_gaps(days)   The Coverage Gap Indicator was written to the audit log (an LGU-only table for the TODA) and nothing could read it as the
--                                           "TODA and LGU operational analysis" the rule names. Now an LGU Administrator reads every zone, a TODA Administrator its own.
--   2. Rule 7.9   admin_confirm_flagged_violation()   The review flag DRIVER_REPEATED_DECLINES (a pattern of refused offers while Online) existed but could not be
--                                           confirmed: "only upon administrative confirmation may the appropriate sanctions ... be imposed" had no way to happen. It now
--                                           confirms DRV_REPEATED_REFUSAL (the same code as the Shared Trip refusals), for the driver's TODA Administrator or the LGU.
--   3. Rule 3.9   permanently_disqualify_driver()     Required no reason at all (a NULL reason made an empty audit line). It now needs at least 10 characters,
--                                           and a driver that does not exist is an answer, not a silent no-op.
--   4. PI-01      set_pilot_service_area()  Narrowing the service area decides who can book, but it checked no radius (0 or 5000 km passed) and wrote no audit entry.
--                                           It now accepts 0.5 to 15 km and writes SERVICE_AREA_CHANGED, like use_city_service_area() does.
--
-- Each replaces a function of the same name and arguments (the grants stay), copied from its newest definition with only the change described. Forward-only.
-- ============================================================================

-- 1. ---------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_coverage_gaps(p_days INTEGER DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_days  INTEGER := LEAST(180, GREATEST(1, COALESCE(p_days, 30)));
    v_lgu   BOOLEAN := COALESCE(public.is_lgu_admin(), FALSE);
    v_toda  UUID := public.get_current_toda_admin_toda_id();
    v_zone  TEXT;
    v_since TIMESTAMPTZ := clock_timestamp() - make_interval(days => LEAST(180, GREATEST(1, COALESCE(p_days, 30))));
BEGIN
    IF NOT v_lgu AND v_toda IS NULL THEN
        RAISE EXCEPTION 'Access Denied: Only a TODA or LGU administrator can read the coverage gap indicators.' USING ERRCODE = '42501';
    END IF;
    IF NOT v_lgu THEN
        v_zone := public._dispatch_zone_key(v_toda);          -- a TODA Administrator reads the zone of their own TODA only
    END IF;
    RETURN jsonb_build_object(
        'success', TRUE,
        'window_days', v_days,
        'zones', COALESCE((
            SELECT jsonb_agg(q.z ORDER BY q.last_at DESC)
              FROM (SELECT a.target_id AS zone, max(a.performed_at) AS last_at,
                           jsonb_build_object('zone', a.target_id, 'times_logged', count(*), 'last_logged_at', max(a.performed_at),
                                              'most_bookings', max(COALESCE((a.after_state->>'bookings')::INTEGER, 0))) AS z
                      FROM public.audit_log a
                     WHERE a.action_type = 'COVERAGE_GAP_INDICATOR' AND a.performed_at >= v_since AND (v_lgu OR a.target_id = v_zone)
                     GROUP BY a.target_id) q), '[]'::jsonb),
        'events', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('logged_at', e.performed_at, 'zone', e.target_id,
                                                'bookings', COALESCE((e.after_state->>'bookings')::INTEGER, 0),
                                                'threshold', COALESCE((e.after_state->>'threshold')::INTEGER, public.dispatch_constant('coverage_gap_count')),
                                                'window_hours', COALESCE((e.after_state->>'window_hours')::INTEGER, public.dispatch_constant('coverage_gap_window_hours')))
                             ORDER BY e.performed_at DESC)
              FROM (SELECT a.* FROM public.audit_log a
                     WHERE a.action_type = 'COVERAGE_GAP_INDICATOR' AND a.performed_at >= v_since AND (v_lgu OR a.target_id = v_zone)
                     ORDER BY a.performed_at DESC LIMIT 100) e), '[]'::jsonb));
END;
$$;

-- 2. ---------------------------------------------------------------------------------------------------------------------------
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
    v_admin_confirm BOOLEAN := FALSE;
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
    -- Rule 7.9 (20261028000005): repeated, unjustified refusal of booking OFFERS while Online and Available; "only upon administrative confirmation" after the TODA
    -- Administrator weighed the stated reasons and the history (get_driver_decline_history). The driver's TODA Administrator or the LGU Administrator.
    ELSIF v_f.flag_type = 'DRIVER_REPEATED_DECLINES' THEN
        IF NOT (COALESCE(public.is_lgu_admin(), FALSE) OR COALESCE(public.is_toda_admin_for_driver(v_f.subject_id::UUID), FALSE)) THEN
            RAISE EXCEPTION 'Access Denied: Only the driver''s TODA Administrator or the LGU Administrator can confirm this strike.';
        END IF;
        v_code := 'DRV_REPEATED_REFUSAL'; v_type := 'driver'; v_subject := v_f.subject_id::UUID;
    -- Batch 11 (PI-11B): the administrator found that a safe reason was misused: the strike the reason was meant to avoid is confirmed, for the booking of the event
    ELSIF v_f.flag_type = 'DRIVER_SAFE_REASON_REVIEW' THEN
        IF NOT (COALESCE(public.is_lgu_admin(), FALSE) OR COALESCE(public.is_toda_admin_for_driver(v_f.subject_id::UUID), FALSE)) THEN
            RAISE EXCEPTION 'Access Denied: Only the driver''s TODA Administrator or the LGU Administrator can confirm this strike.';
        END IF;
        SELECT s.violation_code INTO v_code FROM public.strikes_ledger s
         WHERE s.subject_type = 'driver' AND s.subject_id = v_f.subject_id::UUID AND s.booking_id = p_booking_id AND s.status = 'AUTO_WAIVED'
           AND s.exempt_reason IS NOT NULL AND s.violation_code IN ('DRV_CANCEL_BEFORE_TRAVEL', 'DRV_CANCEL_EN_ROUTE', 'DRV_EARLY_STOP')
         ORDER BY s.issued_at DESC LIMIT 1;
        IF v_code IS NULL THEN
            RAISE EXCEPTION 'ERR_NOT_A_SAFE_REASON_EVENT: The booking is not a cancellation or stop of this driver that was waived for a safe reason.';
        END IF;
        v_type := 'driver'; v_subject := v_f.subject_id::UUID;
        v_admin_confirm := TRUE;
    ELSE
        RAISE EXCEPTION 'ERR_FLAG_NOT_CONFIRMABLE: A strike cannot be confirmed from a % flag.', v_f.flag_type;
    END IF;
    PERFORM set_config('sakay.admin_confirm', CASE WHEN v_admin_confirm THEN 'true' ELSE '' END, true);
    v_strike := public.issue_strike(v_type, v_subject, v_code, p_points, p_booking_id, NULL,
        'FLAG_VIOLATION:' || p_flag_id::TEXT || ':' || v_code || ':' || COALESCE(p_booking_id::TEXT, '-'), NULL, btrim(p_reason), NULL,
        jsonb_build_object('flag_id', p_flag_id, 'flag_type', v_f.flag_type, 'rule', v_f.source_rule));
    PERFORM set_config('sakay.admin_confirm', '', true);
    PERFORM public.resolve_admin_review_flag(p_flag_id, 'Resolved', 'Violation confirmed (' || v_code || '): ' || btrim(p_reason));
    RETURN jsonb_build_object('success', TRUE, 'strike', v_strike);
END;
$$;

-- 3. ---------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.permanently_disqualify_driver(
    p_driver_id UUID,
    p_reason TEXT
)
RETURNS JSONB AS $$
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Access Denied: Only LGU Administrators can issue permanent disqualification.');
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
        RETURN jsonb_build_object('success', false, 'error', 'ERR_REASON_REQUIRED: A reason of at least 10 characters is required to disqualify an applicant for good. It is written to the audit log.');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.driver WHERE driver_id = p_driver_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Driver not found.');
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);

    UPDATE public.driver
    SET is_permanently_disqualified = TRUE,
        disqualification_reason = btrim(p_reason),
        disqualified_at = CURRENT_TIMESTAMP,
        disqualified_by = (SELECT admin_id FROM public.lgu_admin WHERE auth_user_id = (SELECT auth.uid()) LIMIT 1),
        account_status = 'Rejected',
        availability_status = 'Offline'
    WHERE driver_id = p_driver_id;

    UPDATE public.driver_toda_affiliation
    SET lgu_verification_status = 'Rejected',
        lgu_rejection_reason = 'Permanently disqualified: ' || btrim(p_reason)
    WHERE driver_id = p_driver_id;

    INSERT INTO public.audit_log (
        action_type, target_id, actor_id, actor_role, details, performed_at
    ) VALUES (
        'DRIVER_PERMANENTLY_DISQUALIFIED',
        p_driver_id::TEXT,
        auth.uid(),
        'lgu_admin',
        'Permanently disqualified driver. Reason: ' || btrim(p_reason),
        CURRENT_TIMESTAMP
    );

    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 4. ---------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_pilot_service_area(
    p_toda_id UUID,
    p_radius_km DOUBLE PRECISION DEFAULT 1.5
)
RETURNS JSONB AS $$
DECLARE
    v_toda   public.toda;
    v_before TEXT;
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Access Denied: Only LGU Administrators can update the service area.');
    END IF;
    IF p_radius_km IS NULL OR p_radius_km < 0.5 OR p_radius_km > 15 THEN
        RETURN jsonb_build_object('success', false, 'error', 'ERR_RADIUS: The pilot radius must be from 0.5 to 15 km.');
    END IF;

    SELECT * INTO v_toda FROM public.toda WHERE toda_id = p_toda_id;
    IF v_toda.toda_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'TODA not found.');
    END IF;
    IF v_toda.terminal_latitude IS NULL OR v_toda.terminal_longitude IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Selected TODA has no terminal coordinates configured.');
    END IF;

    SELECT area_name INTO v_before FROM public.service_area_config WHERE is_active LIMIT 1;
    UPDATE public.service_area_config SET is_active = FALSE WHERE is_active = TRUE;

    INSERT INTO public.service_area_config (area_name, center_latitude, center_longitude, radius_km, is_active, notes)
    VALUES ('Pilot Area: ' || v_toda.toda_name, v_toda.terminal_latitude, v_toda.terminal_longitude, p_radius_km, TRUE,
            'Configured pilot area around ' || v_toda.toda_name || ' terminal.');

    PERFORM public.record_policy_audit('SERVICE_AREA_CHANGED', p_toda_id::TEXT, 'Pilot Area: ' || v_toda.toda_name, 'Service Area',
        'The service area was narrowed to ' || p_radius_km || ' km around the terminal of ' || v_toda.toda_name || '.',
        jsonb_build_object('area', v_before), jsonb_build_object('area', 'Pilot Area: ' || v_toda.toda_name, 'radius_km', p_radius_km));

    RETURN jsonb_build_object('success', true, 'message', 'Pilot service area configured successfully.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Privileges: the two replaced RPCs keep theirs; the new one is for administrators (each answer is limited inside the function)
REVOKE EXECUTE ON FUNCTION public.get_coverage_gaps(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_coverage_gaps(INTEGER) TO authenticated, service_role;

