-- ============================================================================
-- Migration: 20261005000002_batch4_presence_rpcs.sql
-- Batch 4 (Step 2): the functions the Driver PWA and the scheduler call.
--
--   get_my_driver_presence()               server truth for refresh / reopen
--   driver_go_online(lat, lng, acc, age)   every precondition, atomically
--   driver_go_offline()                    Rule 5.5
--   driver_heartbeat(lat, lng, acc)        the ONE location publisher
--   driver_report_location_unavailable()   Rule 17.7 (+ PI-B4-2 deferral)
--   sweep_driver_presence()                scheduler: stale heartbeat -> Offline
--   report_driver_availability_violation() Rules 5.3 / 5.7 reporting path
--   confirm_driver_availability_violation() administrator confirmation -> strike
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Shared state snapshot (internal)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._driver_presence_state(p_driver_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_driver public.driver;
    v_session public.driver_online_session;
    v_last public.driver_online_session;
    v_aff UUID;
BEGIN
    SELECT * INTO v_driver FROM public.driver WHERE driver_id = p_driver_id;
    IF v_driver.driver_id IS NULL THEN
        RETURN jsonb_build_object('online', FALSE);
    END IF;

    SELECT * INTO v_session FROM public.driver_online_session
    WHERE driver_id = p_driver_id AND ended_at IS NULL;

    SELECT * INTO v_last FROM public.driver_online_session
    WHERE driver_id = p_driver_id AND ended_at IS NOT NULL
    ORDER BY ended_at DESC LIMIT 1;

    SELECT affiliation_id INTO v_aff FROM public.driver_toda_affiliation
    WHERE driver_id = p_driver_id AND is_active_selection = TRUE LIMIT 1;

    RETURN jsonb_build_object(
        'online', v_driver.availability_status <> 'Offline',
        'availability_status', v_driver.availability_status,
        'active_toda_id', v_driver.toda_id,
        'active_affiliation_id', v_aff,
        'open_booking', public.driver_has_open_accepted_booking(p_driver_id),
        'session', CASE WHEN v_session.session_id IS NULL THEN NULL ELSE jsonb_build_object(
            'session_id', v_session.session_id,
            'started_at', v_session.started_at,
            'last_heartbeat_at', v_session.last_heartbeat_at,
            'unanswered_streak', v_session.unanswered_streak,
            'reminder_sent_at', v_session.reminder_sent_at,
            'offline_pending_reason', v_session.offline_pending_reason) END,
        'last_session_end', CASE WHEN v_last.session_id IS NULL THEN NULL ELSE jsonb_build_object(
            'reason', v_last.end_reason, 'ended_at', v_last.ended_at) END,
        'server_time', CURRENT_TIMESTAMP
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public._presence_fail(p_code TEXT, p_message TEXT)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT jsonb_build_object('success', FALSE, 'error_code', p_code, 'error', p_message);
$$;

-- ----------------------------------------------------------------------------
-- get_my_driver_presence: what the server believes (used on mount / refresh)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_driver_presence()
RETURNS JSONB AS $$
DECLARE
    v_id UUID;
BEGIN
    SELECT driver_id INTO v_id FROM public.driver WHERE auth_user_id = auth.uid();
    IF v_id IS NULL THEN
        RETURN public._presence_fail('ERR_NOT_A_DRIVER', 'No driver account for this login.');
    END IF;
    RETURN jsonb_build_object('success', TRUE) || public._driver_presence_state(v_id);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- driver_go_online
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_go_online(
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_accuracy_m DOUBLE PRECISION,
    p_position_age_ms INTEGER DEFAULT 0
)
RETURNS JSONB AS $$
DECLARE
    v_driver public.driver;
    v_state JSONB;
    v_res JSONB;
    v_active public.driver_toda_affiliation;
    v_active_ok BOOLEAN := FALSE;
    v_eligible UUID[];
    v_sel JSONB;
    v_prev TEXT := current_setting('sakay.presence_context', true);
    v_prev_internal TEXT := current_setting('sakay.internal_context', true);
    v_max_acc INTEGER := public.driver_presence_constant('location_max_accuracy_m');
    v_max_age INTEGER := public.driver_presence_constant('location_max_age_seconds');
BEGIN
    SELECT * INTO v_driver FROM public.driver WHERE auth_user_id = auth.uid() FOR UPDATE;
    IF v_driver.driver_id IS NULL THEN
        RETURN public._presence_fail('ERR_NOT_A_DRIVER', 'No driver account for this login.');
    END IF;

    -- Idempotent: a second tap / second tab does not create a second session.
    IF v_driver.availability_status <> 'Offline' THEN
        RETURN jsonb_build_object('success', TRUE, 'already_online', TRUE) || public._driver_presence_state(v_driver.driver_id);
    END IF;

    v_state := public.account_restriction_state('driver', v_driver.driver_id);
    IF COALESCE((v_state->>'restricted')::BOOLEAN, FALSE) THEN
        RETURN public._presence_fail(
            COALESCE(substring(public._restriction_message(v_state) FROM '^(ERR_[A-Z_]+)'), 'ERR_ACCOUNT_RESTRICTED'),
            public._restriction_message(v_state));
    END IF;

    IF v_driver.account_status <> 'Verified' THEN
        RETURN public._presence_fail('ERR_DRIVER_NOT_VERIFIED',
            'Hindi maaaring mag-online hangga''t hindi ganap na aprubado ng LGU ang account. (Your account must be verified by the LGU before you can go online.)');
    END IF;

    -- Rules 3.1 / 3.10: exactly one verified affiliation is active before Online.
    SELECT * INTO v_active FROM public.driver_toda_affiliation
    WHERE driver_id = v_driver.driver_id AND is_active_selection = TRUE LIMIT 1;
    IF v_active.affiliation_id IS NOT NULL THEN
        v_active_ok := v_active.toda_endorsement_status = 'Endorsed' AND v_active.lgu_verification_status = 'Approved'
            AND EXISTS (SELECT 1 FROM public.toda t WHERE t.toda_id = v_active.toda_id AND t.toda_status = 'Active'
                        AND (t.certificate_expiry IS NULL
                             OR (t.certificate_expiry AT TIME ZONE 'Asia/Manila')::DATE >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::DATE));
    END IF;

    IF NOT v_active_ok THEN
        SELECT array_agg(a.affiliation_id) INTO v_eligible
        FROM public.driver_toda_affiliation a
        JOIN public.toda t ON t.toda_id = a.toda_id
        WHERE a.driver_id = v_driver.driver_id
          AND a.toda_endorsement_status = 'Endorsed' AND a.lgu_verification_status = 'Approved'
          AND t.toda_status = 'Active'
          AND (t.certificate_expiry IS NULL
               OR (t.certificate_expiry AT TIME ZONE 'Asia/Manila')::DATE >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::DATE);

        IF v_eligible IS NULL OR cardinality(v_eligible) = 0 THEN
            RETURN public._presence_fail('ERR_NO_VERIFIED_AFFILIATION',
                'Wala kang aprubadong TODA affiliation na maaaring gamitin. (You have no verified TODA affiliation to go online with.)');
        ELSIF cardinality(v_eligible) > 1 THEN
            RETURN public._presence_fail('ERR_SELECT_AFFILIATION',
                'Pumili muna ng isang aktibong TODA bago mag-Online. (Select one active TODA before going online.)');
        END IF;
        -- Exactly one verified affiliation: it is the active one (Rule 3.1).
        -- select_active_driver_affiliation leaves the internal-context flag set for the rest
        -- of the transaction, so restore it: the rest of this function runs as the driver.
        v_sel := public.select_active_driver_affiliation(v_eligible[1]);
        PERFORM set_config('sakay.internal_context', COALESCE(v_prev_internal, ''), true);
        IF COALESCE((v_sel->>'success')::BOOLEAN, FALSE) IS NOT TRUE THEN
            RETURN public._presence_fail('ERR_SELECT_AFFILIATION', COALESCE(v_sel->>'error', 'Could not select the TODA affiliation.'));
        END IF;
    END IF;

    v_res := public.is_driver_documentarily_restricted(v_driver.driver_id);
    IF (v_res->>'is_restricted')::BOOLEAN = TRUE THEN
        RETURN public._presence_fail('ERR_DOCUMENT_EXPIRED',
            'Hindi maaaring mag-online dahil sa expired o kulang na dokumento: ' || (v_res->>'reasons'));
    END IF;

    -- Rule 17.7: a usable, recent position is the proof that permission is granted.
    IF p_latitude IS NULL OR p_longitude IS NULL
       OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN
        RETURN public._presence_fail('ERR_LOCATION_REQUIRED',
            'Kailangan ang location permission para mag-Online. (Location permission is required to go online.)');
    END IF;
    IF p_accuracy_m IS NULL OR p_accuracy_m < 0 OR p_accuracy_m > v_max_acc THEN
        RETURN public._presence_fail('ERR_LOCATION_INACCURATE',
            'Hindi sapat ang linaw ng iyong GPS (higit sa ' || v_max_acc || ' m). Pumunta sa bukas na lugar at subukan muli. (GPS accuracy is too low.)');
    END IF;
    IF COALESCE(p_position_age_ms, 0) > v_max_age * 1000 THEN
        RETURN public._presence_fail('ERR_LOCATION_STALE',
            'Luma na ang iyong location. Subukan muli. (Your location fix is too old.)');
    END IF;

    PERFORM set_config('sakay.presence_context', 'true', true);
    UPDATE public.driver
    SET availability_status = 'Available',
        current_latitude = p_latitude,
        current_longitude = p_longitude,
        last_location_update = CURRENT_TIMESTAMP,
        last_location_accuracy_m = p_accuracy_m
    WHERE driver_id = v_driver.driver_id;
    PERFORM set_config('sakay.presence_context', COALESCE(v_prev, ''), true);

    PERFORM public.record_policy_audit(
        'DRIVER_WENT_ONLINE', v_driver.driver_id::TEXT, v_driver.full_name, 'Driver Presence',
        'Driver went Online.', NULL,
        jsonb_build_object('toda_id', (SELECT toda_id FROM public.driver WHERE driver_id = v_driver.driver_id), 'accuracy_m', p_accuracy_m)
    );

    RETURN jsonb_build_object('success', TRUE) || public._driver_presence_state(v_driver.driver_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- driver_go_offline (Rule 5.5: always allowed, never penalized, unless a booking is open)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_go_offline()
RETURNS JSONB AS $$
DECLARE
    v_driver public.driver;
BEGIN
    SELECT * INTO v_driver FROM public.driver WHERE auth_user_id = auth.uid() FOR UPDATE;
    IF v_driver.driver_id IS NULL THEN
        RETURN public._presence_fail('ERR_NOT_A_DRIVER', 'No driver account for this login.');
    END IF;

    IF v_driver.availability_status = 'Offline' THEN
        RETURN jsonb_build_object('success', TRUE, 'already_offline', TRUE) || public._driver_presence_state(v_driver.driver_id);
    END IF;

    IF public.driver_has_open_accepted_booking(v_driver.driver_id) THEN
        RETURN public._presence_fail('ERR_OPEN_BOOKING',
            'Hindi ka maaaring mag-Offline habang may bukas na tinanggap na booking. (You cannot go Offline while you have an open accepted booking.)');
    END IF;

    PERFORM public._presence_set_offline(v_driver.driver_id, 'manual');
    RETURN jsonb_build_object('success', TRUE) || public._driver_presence_state(v_driver.driver_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- driver_heartbeat: the single location publisher and presence proof
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_heartbeat(
    p_latitude DOUBLE PRECISION DEFAULT NULL,
    p_longitude DOUBLE PRECISION DEFAULT NULL,
    p_accuracy_m DOUBLE PRECISION DEFAULT NULL
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
    END IF;

    UPDATE public.driver_online_session SET last_heartbeat_at = CURRENT_TIMESTAMP
    WHERE driver_id = v_driver.driver_id AND ended_at IS NULL;

    RETURN jsonb_build_object('success', TRUE, 'location_accepted', v_publish, 'location_rejected_reason', v_reason)
        || public._driver_presence_state(v_driver.driver_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- driver_report_location_unavailable (Rule 17.7, PI-B4-2)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_report_location_unavailable(p_detail TEXT DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
    v_driver public.driver;
BEGIN
    SELECT * INTO v_driver FROM public.driver WHERE auth_user_id = auth.uid() FOR UPDATE;
    IF v_driver.driver_id IS NULL THEN
        RETURN public._presence_fail('ERR_NOT_A_DRIVER', 'No driver account for this login.');
    END IF;
    IF v_driver.availability_status = 'Offline' THEN
        RETURN jsonb_build_object('success', TRUE, 'reauth_required', TRUE) || public._driver_presence_state(v_driver.driver_id);
    END IF;

    IF public.driver_has_open_accepted_booking(v_driver.driver_id) THEN
        -- Never abandon a passenger mid-trip: record it and go Offline when the booking ends.
        UPDATE public.driver_online_session SET offline_pending_reason = 'location_permission_revoked'
        WHERE driver_id = v_driver.driver_id AND ended_at IS NULL;
        PERFORM public.record_policy_audit(
            'DRIVER_LOCATION_PERMISSION_LOST', v_driver.driver_id::TEXT, v_driver.full_name, 'Driver Presence',
            'Location permission was lost during an open booking; the driver goes Offline when it ends.', NULL,
            jsonb_build_object('detail', p_detail, 'deferred', TRUE));
        RETURN jsonb_build_object('success', TRUE, 'deferred', TRUE, 'reauth_required', TRUE) || public._driver_presence_state(v_driver.driver_id);
    END IF;

    PERFORM public._presence_set_offline(v_driver.driver_id, 'location_permission_revoked');
    PERFORM public.record_policy_audit(
        'DRIVER_LOCATION_PERMISSION_LOST', v_driver.driver_id::TEXT, v_driver.full_name, 'Driver Presence',
        'Location permission was revoked; the driver was set Offline (Rule 17.7).', NULL,
        jsonb_build_object('detail', p_detail, 'deferred', FALSE));
    RETURN jsonb_build_object('success', TRUE, 'reauth_required', TRUE) || public._driver_presence_state(v_driver.driver_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- sweep_driver_presence: drivers whose app stopped reporting (scheduler, service role)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sweep_driver_presence()
RETURNS JSONB AS $$
DECLARE
    v_row RECORD;
    v_closed INTEGER := 0;
    v_skipped INTEGER := 0;
BEGIN
    IF NOT public.is_service_context() THEN
        RAISE EXCEPTION 'Access Denied: only the system may run the presence sweep.';
    END IF;

    FOR v_row IN
        SELECT s.driver_id, s.session_id, d.full_name
        FROM public.driver_online_session s
        JOIN public.driver d ON d.driver_id = s.driver_id
        WHERE s.ended_at IS NULL
          AND s.last_heartbeat_at < CURRENT_TIMESTAMP - make_interval(secs => public.driver_presence_constant('heartbeat_stale_seconds'))
    LOOP
        -- A driver with an open booking is handled by the unreachable-driver rules (Section 9).
        IF public.driver_has_open_accepted_booking(v_row.driver_id) THEN
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;
        IF public._presence_set_offline(v_row.driver_id, 'stale_heartbeat') THEN
            v_closed := v_closed + 1;
            PERFORM public.record_policy_audit(
                'DRIVER_AUTO_OFFLINE_STALE', v_row.driver_id::TEXT, v_row.full_name, 'Driver Presence',
                'Driver set Offline: the app stopped reporting. No strike applied.', NULL,
                jsonb_build_object('session_id', v_row.session_id));
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', TRUE, 'set_offline', v_closed, 'skipped_open_booking', v_skipped);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- Rules 5.3 / 5.7: report, then administrator confirmation, then strike
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_driver_availability_violation(
    p_driver_id UUID,
    p_kind TEXT,
    p_booking_id UUID DEFAULT NULL,
    p_description TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_driver public.driver;
    v_reporter TEXT;
    v_passenger UUID;
    v_flag_type TEXT;
    v_rule TEXT;
    v_flag UUID;
BEGIN
    IF p_kind NOT IN ('QUEUE_CONFLICT', 'AVAILABILITY_VIOLATION') THEN
        RAISE EXCEPTION 'Unknown report kind %', p_kind;
    END IF;
    IF p_description IS NULL OR length(btrim(p_description)) = 0 THEN
        RAISE EXCEPTION 'A description of what was observed is required.';
    END IF;

    SELECT * INTO v_driver FROM public.driver WHERE driver_id = p_driver_id;
    IF v_driver.driver_id IS NULL THEN
        RAISE EXCEPTION 'Driver not found.';
    END IF;

    IF public.is_lgu_admin() THEN
        v_reporter := 'lgu_admin';
    ELSIF public.is_toda_admin() AND v_driver.toda_id IS NOT NULL AND v_driver.toda_id = public.get_current_toda_admin_toda_id() THEN
        v_reporter := 'toda_admin';
    ELSE
        -- A passenger may report only a driver who served one of their own bookings.
        v_passenger := public.get_current_passenger_id();
        IF v_passenger IS NULL OR p_booking_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.booking b
            WHERE b.booking_id = p_booking_id AND b.passenger_id = v_passenger AND b.driver_id = p_driver_id
        ) THEN
            RAISE EXCEPTION 'Access Denied: you cannot report this driver.';
        END IF;
        v_reporter := 'passenger';
    END IF;

    v_flag_type := CASE p_kind WHEN 'QUEUE_CONFLICT' THEN 'DRIVER_QUEUE_CONFLICT_REPORT' ELSE 'DRIVER_AVAILABILITY_VIOLATION_REPORT' END;
    v_rule := CASE p_kind WHEN 'QUEUE_CONFLICT' THEN 'Rule 5.3' ELSE 'Rule 5.7' END;

    v_flag := public._presence_flag(v_flag_type, p_driver_id, v_rule,
        jsonb_build_object('reported_by', v_reporter, 'booking_id', p_booking_id, 'description', btrim(p_description),
                           'note', 'A strike is issued only when an administrator confirms the instance.'));

    PERFORM public.record_policy_audit(
        'DRIVER_AVAILABILITY_REPORT', p_driver_id::TEXT, v_driver.full_name, 'Driver Presence',
        v_rule || ' report filed by ' || v_reporter || '.', NULL,
        jsonb_build_object('flag_id', v_flag, 'kind', p_kind, 'booking_id', p_booking_id));

    RETURN jsonb_build_object('success', TRUE, 'flag_id', v_flag);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.confirm_driver_availability_violation(p_flag_id UUID, p_reason TEXT)
RETURNS JSONB AS $$
DECLARE
    v_flag public.admin_review_flag;
    v_code TEXT;
    v_booking UUID;
    v_result JSONB;
BEGIN
    SELECT * INTO v_flag FROM public.admin_review_flag WHERE flag_id = p_flag_id FOR UPDATE;
    IF v_flag.flag_id IS NULL OR v_flag.flag_type NOT IN ('DRIVER_QUEUE_CONFLICT_REPORT', 'DRIVER_AVAILABILITY_VIOLATION_REPORT') THEN
        RAISE EXCEPTION 'Availability report not found.';
    END IF;
    IF v_flag.status NOT IN ('Open', 'Under Review') THEN
        RAISE EXCEPTION 'This report is already %.', lower(v_flag.status);
    END IF;

    v_code := CASE v_flag.flag_type WHEN 'DRIVER_QUEUE_CONFLICT_REPORT' THEN 'DRV_QUEUE_CONFLICT' ELSE 'DRV_AVAILABILITY_VIOLATION' END;
    v_booking := NULLIF(v_flag.details->>'booking_id', '')::UUID;

    -- issue_strike enforces who may confirm (LGU admin, or the driver's TODA admin)
    -- and that a reason is given; the idempotency key makes a second click a no-op.
    v_result := public.issue_strike(
        'driver', v_flag.subject_id::UUID, v_code, NULL, v_booking, NULL,
        'AVAILABILITY_REPORT:' || p_flag_id::TEXT, NULL, p_reason, NULL,
        jsonb_build_object('flag_id', p_flag_id));

    PERFORM public.resolve_admin_review_flag(p_flag_id, 'Resolved', 'Confirmed: ' || p_reason);
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- PRIVILEGES
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._driver_presence_state(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._presence_fail(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_my_driver_presence() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.driver_go_online(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.driver_go_offline() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.driver_heartbeat(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.driver_report_location_unavailable(TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sweep_driver_presence() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.report_driver_availability_violation(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.confirm_driver_availability_violation(UUID, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_my_driver_presence() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_go_online(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_go_offline() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_heartbeat(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_report_location_unavailable(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sweep_driver_presence() TO service_role;
GRANT EXECUTE ON FUNCTION public.report_driver_availability_violation(UUID, TEXT, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_driver_availability_violation(UUID, TEXT) TO authenticated, service_role;
