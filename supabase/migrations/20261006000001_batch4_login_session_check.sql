-- ============================================================================
-- Migration: 20261006000001_batch4_login_session_check.sql
-- Batch 4 (W12 / Rule 29.1): one active driver login session, enforced by the database.
--
-- Batch 2 rotates driver.session_id on every login and checks it in the app shell (client only).
-- Here the presence functions check it too, so a device that has been signed out by a newer
-- login can no longer go Online, keep a session alive, or publish a position.
--
--   * The app sends the token it stored at login (sakay_driver_session_token).
--   * driver.session_id IS NULL (never rotated)  -> no check (nothing to compare).
--   * otherwise the token must equal driver.session_id; a missing or different token is refused
--     with ERR_SESSION_SUPERSEDED, exactly like the shell's existing check.
--   * Going Offline stays allowed from any device (Rule 5.5) and does not take a token.
--
-- The three functions gain one trailing parameter with a default, so the old signatures are dropped
-- first (otherwise PostgREST would see two overloads). Forward-only; the earlier migration is untouched.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_my_driver_presence();
DROP FUNCTION IF EXISTS public.driver_go_online(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER);
DROP FUNCTION IF EXISTS public.driver_heartbeat(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION);

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._login_session_current(p_db_session UUID, p_token UUID)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    -- COALESCE: a missing token compares as NULL, which must count as "does not match", never as "unknown = allowed".
    SELECT p_db_session IS NULL OR COALESCE(p_db_session = p_token, FALSE);
$$;

CREATE OR REPLACE FUNCTION public._presence_superseded()
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT jsonb_build_object(
        'success', FALSE,
        'error_code', 'ERR_SESSION_SUPERSEDED',
        'error', 'Nag-login ang iyong account sa ibang device. Mag-login muli. (Your account signed in on another device. Please log in again.)'
    );
$$;

-- ----------------------------------------------------------------------------
-- get_my_driver_presence
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_driver_presence(p_session_token UUID DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
    v_id UUID;
    v_session UUID;
BEGIN
    SELECT driver_id, session_id INTO v_id, v_session FROM public.driver WHERE auth_user_id = auth.uid();
    IF v_id IS NULL THEN
        RETURN public._presence_fail('ERR_NOT_A_DRIVER', 'No driver account for this login.');
    END IF;
    IF NOT public._login_session_current(v_session, p_session_token) THEN
        RETURN public._presence_superseded();
    END IF;
    RETURN jsonb_build_object('success', TRUE) || public._driver_presence_state(v_id);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- driver_go_online (unchanged except for the session check)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_go_online(
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_accuracy_m DOUBLE PRECISION,
    p_position_age_ms INTEGER DEFAULT 0,
    p_session_token UUID DEFAULT NULL
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

    -- Rule 29.1: only the device holding the current login session may act.
    IF NOT public._login_session_current(v_driver.session_id, p_session_token) THEN
        RETURN public._presence_superseded();
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
-- driver_heartbeat (unchanged except for the session check, done BEFORE any write)
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
    END IF;

    UPDATE public.driver_online_session SET last_heartbeat_at = CURRENT_TIMESTAMP
    WHERE driver_id = v_driver.driver_id AND ended_at IS NULL;

    RETURN jsonb_build_object('success', TRUE, 'location_accepted', v_publish, 'location_rejected_reason', v_reason)
        || public._driver_presence_state(v_driver.driver_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- PRIVILEGES
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._login_session_current(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._presence_superseded() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_my_driver_presence(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.driver_go_online(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.driver_heartbeat(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_my_driver_presence(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_go_online(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_heartbeat(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, UUID) TO authenticated, service_role;
