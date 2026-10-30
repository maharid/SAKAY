-- ============================================================================
-- THE TERMINAL IS A PIN ON THE MAP, AND MOVING IT NEEDS THE LGU (panel comment, decision D-P4)
-- ============================================================================
-- The panel: a TODA's terminal coordinates must not be typed by hand; they come from a pin on a map, and a change is approved by the LGU as well.
--
-- The apps now take the coordinates only from the map picker (which keeps the pin on a road, inside the city). This is the database's side, so a modified app cannot get
-- around it:
--
--   _terminal_point_problem(lat, lng)       NULL when the point is a usable terminal: real numbers, inside the active service area and not in the sea
--                                           (service_area_contains, panel comment D-P3); otherwise the reason in words. Internal.
--   register_toda_with_admin(...)           the 20261008000002 function, unchanged except that it refuses a terminal that is not usable (ERR_TERMINAL_LOCATION)
--   request_terminal_relocation(...)        same signature. Now: only the TODA's own administrator (or the LGU); the TODA has to be Active; the new point has to be
--                                           usable and at least 25 m from the current terminal (otherwise there is nothing to move); a reason of at least 10 characters
--                                           and a name for the place are required; a newer request replaces an open one; the request is audited with who and why
--   approve_terminal_relocation(...)        the LGU's own words are required (at least 10 characters, no more "Approved by LGU Transport Board" typed by the app); the
--                                           point is checked again; the decision, its words and its time are kept on the TODA so the TODA can read them
--   reject_terminal_relocation(...)         the same: a reason of at least 10 characters, kept and shown to the TODA; only an open request can be rejected
--   protect_toda_relocation_columns()       the request and decision columns change only through those functions (or the LGU), never by a table update from an app
--
-- The current terminal stays in force until the LGU approves. Forward-only. Safe to run twice.
-- ============================================================================

ALTER TABLE public.toda
    ADD COLUMN IF NOT EXISTS pending_terminal_reason TEXT,
    ADD COLUMN IF NOT EXISTS terminal_relocation_decision_note TEXT,
    ADD COLUMN IF NOT EXISTS terminal_relocation_decided_at TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- 1. Is this point a usable terminal?
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._terminal_point_problem(p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $f$
DECLARE
    v_config public.service_area_config;
BEGIN
    IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
        RETURN 'The terminal has to be a pin on the map: choose the place with Pin on Map.';
    END IF;
    SELECT * INTO v_config FROM public.service_area_config WHERE is_active = TRUE LIMIT 1;
    IF v_config.config_id IS NOT NULL AND NOT public.service_area_contains(v_config, p_lat, p_lng) THEN
        RETURN 'That place is outside the area SAKAY serves (' || v_config.area_name || ') or in the sea. Pin the terminal on a road inside the city.';
    END IF;
    RETURN NULL;
END;
$f$;

-- ----------------------------------------------------------------------------
-- 2. Registration refuses an unusable terminal
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_toda_with_admin(
    p_toda_name VARCHAR,
    p_toda_acronym VARCHAR,
    p_registration_number VARCHAR,
    p_date_established DATE,
    p_active_drivers INTEGER,
    p_registered_tricycles INTEGER,
    p_terminal_latitude DOUBLE PRECISION,
    p_terminal_longitude DOUBLE PRECISION,
    p_terminal_location_name VARCHAR,
    p_barangay VARCHAR,
    p_service_coverage_area TEXT,
    p_president_name VARCHAR,
    p_admin_email VARCHAR,
    p_admin_contact_number VARCHAR,
    p_barangay_clearance_url TEXT DEFAULT NULL,
    p_accredited_drivers_url TEXT DEFAULT NULL,
    p_auth_user_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_toda_id UUID;
    v_problem TEXT;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ERR_AUTH_REQUIRED: Sign in before registering a TODA.' USING ERRCODE = '28000';
    END IF;
    IF p_auth_user_id IS NOT NULL AND p_auth_user_id <> v_uid THEN
        RAISE EXCEPTION 'ERR_IDENTITY_MISMATCH: A TODA can only be registered for the account that is signed in.' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.toda_admin ta WHERE ta.auth_user_id = v_uid) THEN
        RAISE EXCEPTION 'ERR_ALREADY_TODA_ADMIN: This account already administers a TODA.' USING ERRCODE = '23505';
    END IF;
    -- Panel comment (D-P4): the terminal is a pin on the map, inside Calapan City and not in the sea. A typed or tampered coordinate is refused here too.
    v_problem := public._terminal_point_problem(p_terminal_latitude, p_terminal_longitude);
    IF v_problem IS NOT NULL THEN
        RAISE EXCEPTION 'ERR_TERMINAL_LOCATION: %', v_problem USING ERRCODE = 'P0001';
    END IF;

    -- The rows below are created by the registration itself (the policy engine), not by the caller's own privileges.
    PERFORM set_config('sakay.internal_context', 'true', true);

    INSERT INTO public.toda (
        toda_name, toda_acronym, registration_number, date_established, active_driver_count, registered_tricycle_count,
        terminal_latitude, terminal_longitude, barangay, service_coverage_area, president_name, president_contact,
        account_status, barangay_clearance_url, accredited_drivers_url
    ) VALUES (
        p_toda_name, p_toda_acronym, p_registration_number, p_date_established, p_active_drivers, p_registered_tricycles,
        p_terminal_latitude, p_terminal_longitude, p_barangay, p_service_coverage_area, p_president_name, p_admin_contact_number,
        'Pending Verification', p_barangay_clearance_url, p_accredited_drivers_url
    ) RETURNING toda_id INTO v_toda_id;

    INSERT INTO public.toda_admin (auth_user_id, toda_id, full_name, email, contact_number, account_status)
    VALUES (v_uid, v_toda_id, p_president_name, p_admin_email, p_admin_contact_number, 'Active');

    INSERT INTO public.audit_log (action_type, target_id, details, performed_at, actor_id, actor_role)
    VALUES (
        'TODA_REGISTRATION_SUBMITTED',
        v_toda_id::TEXT,
        'Submitted new accreditation application for ' || p_toda_name || ' (' || COALESCE(p_toda_acronym, 'N/A') || ') in Brgy. ' || p_barangay,
        now(), v_uid, 'toda_admin'
    );

    PERFORM set_config('sakay.internal_context', '', true);
    RETURN v_toda_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Asking to move the terminal
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_terminal_relocation(
    p_toda_id UUID,
    p_new_latitude DOUBLE PRECISION,
    p_new_longitude DOUBLE PRECISION,
    p_new_location TEXT,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_toda    public.toda;
    v_is_lgu  BOOLEAN := COALESCE(public.is_lgu_admin(), FALSE);
    v_name    TEXT := btrim(COALESCE(p_new_location, ''));
    v_reason  TEXT := btrim(COALESCE(p_reason, ''));
    v_problem TEXT;
    v_prev    TEXT;
BEGIN
    IF NOT (v_is_lgu OR (public.get_current_toda_admin_toda_id() IS NOT NULL AND p_toda_id = public.get_current_toda_admin_toda_id())) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_YOUR_TODA', 'error', 'Access Denied: You may only request relocation for your own TODA.');
    END IF;
    SELECT * INTO v_toda FROM public.toda WHERE toda_id = p_toda_id;
    IF v_toda.toda_id IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_YOUR_TODA', 'error', 'That TODA was not found.');
    END IF;
    IF NOT v_is_lgu AND v_toda.toda_status IS DISTINCT FROM 'Active' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_TODA_NOT_ACTIVE', 'error', 'The terminal can be moved only while the TODA is accredited (Active).');
    END IF;
    v_problem := public._terminal_point_problem(p_new_latitude, p_new_longitude);
    IF v_problem IS NOT NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_TERMINAL_LOCATION', 'error', v_problem);
    END IF;
    IF v_toda.terminal_latitude IS NOT NULL AND v_toda.terminal_longitude IS NOT NULL
       AND public.calculate_haversine_distance_km(v_toda.terminal_latitude, v_toda.terminal_longitude, p_new_latitude, p_new_longitude) * 1000.0 < 25 THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_RELOCATION_SAME_PLACE', 'error', 'The new pin is the same place as the current terminal (less than 25 m away). Move the pin to where the terminal will be.');
    END IF;
    IF length(v_name) < 2 OR length(v_name) > 200 THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_RELOCATION_LOCATION_NAME', 'error', 'Name the new place (street and barangay), 2 to 200 characters.');
    END IF;
    IF length(v_reason) < 10 OR length(v_reason) > 500 THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_RELOCATION_REASON', 'error', 'Say why the terminal is moving (10 to 500 characters). The LGU reads it before it decides.');
    END IF;

    v_prev := current_setting('sakay.internal_context', true);
    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.toda
       SET pending_terminal_latitude = p_new_latitude,
           pending_terminal_longitude = p_new_longitude,
           pending_terminal_location = v_name,
           pending_terminal_reason = v_reason,
           terminal_relocation_status = 'Pending LGU Re-approval',
           terminal_relocation_requested_at = CURRENT_TIMESTAMP,
           terminal_relocation_decision_note = NULL,
           terminal_relocation_decided_at = NULL
     WHERE toda_id = p_toda_id;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);

    PERFORM public.record_policy_audit('TODA_TERMINAL_RELOCATION_REQUESTED', p_toda_id::TEXT, v_toda.toda_name, 'Accreditation',
        'Requested to move the terminal to ' || v_name || '. Reason: ' || v_reason,
        jsonb_build_object('latitude', v_toda.terminal_latitude, 'longitude', v_toda.terminal_longitude, 'location', v_toda.service_coverage_area),
        jsonb_build_object('latitude', p_new_latitude, 'longitude', p_new_longitude, 'location', v_name));

    RETURN jsonb_build_object('success', TRUE);
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. The LGU decides, in its own words
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_terminal_relocation(
    p_toda_id UUID,
    p_remarks TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_toda    public.toda;
    v_new     public.toda;
    v_remarks TEXT := btrim(COALESCE(p_remarks, ''));
    v_problem TEXT;
    v_prev    TEXT;
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Access Denied: Only LGU Administrators can approve terminal relocation.');
    END IF;
    SELECT * INTO v_toda FROM public.toda WHERE toda_id = p_toda_id;
    IF v_toda.toda_id IS NULL OR v_toda.terminal_relocation_status IS DISTINCT FROM 'Pending LGU Re-approval' THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'No pending terminal relocation found for this TODA.');
    END IF;
    IF length(v_remarks) < 10 OR length(v_remarks) > 500 THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_DECISION_NOTE', 'error', 'Write the reason for approving (10 to 500 characters). The TODA reads it.');
    END IF;
    v_problem := public._terminal_point_problem(v_toda.pending_terminal_latitude, v_toda.pending_terminal_longitude);
    IF v_problem IS NOT NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_TERMINAL_LOCATION', 'error', v_problem);
    END IF;

    v_prev := current_setting('sakay.internal_context', true);
    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.toda
       SET terminal_latitude = pending_terminal_latitude,
           terminal_longitude = pending_terminal_longitude,
           service_coverage_area = COALESCE(pending_terminal_location, service_coverage_area),
           pending_terminal_latitude = NULL,
           pending_terminal_longitude = NULL,
           pending_terminal_location = NULL,
           pending_terminal_reason = NULL,
           terminal_relocation_status = 'Approved',
           terminal_relocation_decision_note = v_remarks,
           terminal_relocation_decided_at = CURRENT_TIMESTAMP
     WHERE toda_id = p_toda_id
    RETURNING * INTO v_new;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);

    PERFORM public.record_policy_audit('TODA_TERMINAL_RELOCATION_APPROVED', p_toda_id::TEXT, v_toda.toda_name, 'Accreditation',
        'Approved the terminal relocation for ' || v_toda.toda_name || '. Reason: ' || v_remarks,
        jsonb_build_object('latitude', v_toda.terminal_latitude, 'longitude', v_toda.terminal_longitude, 'location', v_toda.service_coverage_area),
        jsonb_build_object('latitude', v_new.terminal_latitude, 'longitude', v_new.terminal_longitude, 'location', v_new.service_coverage_area));

    RETURN jsonb_build_object('success', TRUE, 'data', to_jsonb(v_new));
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_terminal_relocation(
    p_toda_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_toda   public.toda;
    v_reason TEXT := btrim(COALESCE(p_reason, ''));
    v_prev   TEXT;
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Access Denied.');
    END IF;
    SELECT * INTO v_toda FROM public.toda WHERE toda_id = p_toda_id;
    IF v_toda.toda_id IS NULL OR v_toda.terminal_relocation_status IS DISTINCT FROM 'Pending LGU Re-approval' THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'No pending terminal relocation found for this TODA.');
    END IF;
    IF length(v_reason) < 10 OR length(v_reason) > 500 THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_DECISION_NOTE', 'error', 'Write the reason for rejecting (10 to 500 characters). The TODA reads it.');
    END IF;

    v_prev := current_setting('sakay.internal_context', true);
    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.toda
       SET pending_terminal_latitude = NULL,
           pending_terminal_longitude = NULL,
           pending_terminal_location = NULL,
           pending_terminal_reason = NULL,
           terminal_relocation_status = 'Rejected',
           terminal_relocation_decision_note = v_reason,
           terminal_relocation_decided_at = CURRENT_TIMESTAMP
     WHERE toda_id = p_toda_id;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);

    PERFORM public.record_policy_audit('TODA_TERMINAL_RELOCATION_REJECTED', p_toda_id::TEXT, v_toda.toda_name, 'Accreditation',
        'Rejected the terminal relocation of ' || v_toda.toda_name || '. Reason: ' || v_reason,
        jsonb_build_object('latitude', v_toda.pending_terminal_latitude, 'longitude', v_toda.pending_terminal_longitude, 'location', v_toda.pending_terminal_location),
        jsonb_build_object('latitude', v_toda.terminal_latitude, 'longitude', v_toda.terminal_longitude, 'location', v_toda.service_coverage_area));

    RETURN jsonb_build_object('success', TRUE);
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. The request and the decision change only through those functions
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_toda_relocation_columns()
RETURNS TRIGGER AS $$
BEGIN
    IF COALESCE(public.is_lgu_admin(), FALSE) OR COALESCE(public.is_service_context(), FALSE) THEN
        RETURN NEW;
    END IF;
    IF NEW.pending_terminal_latitude IS DISTINCT FROM OLD.pending_terminal_latitude
       OR NEW.pending_terminal_longitude IS DISTINCT FROM OLD.pending_terminal_longitude
       OR NEW.pending_terminal_location IS DISTINCT FROM OLD.pending_terminal_location
       OR NEW.pending_terminal_reason IS DISTINCT FROM OLD.pending_terminal_reason
       OR NEW.terminal_relocation_status IS DISTINCT FROM OLD.terminal_relocation_status
       OR NEW.terminal_relocation_requested_at IS DISTINCT FROM OLD.terminal_relocation_requested_at
       OR NEW.terminal_relocation_decision_note IS DISTINCT FROM OLD.terminal_relocation_decision_note
       OR NEW.terminal_relocation_decided_at IS DISTINCT FROM OLD.terminal_relocation_decided_at THEN
        RAISE EXCEPTION 'Access Denied: a terminal relocation is requested with request_terminal_relocation() and decided by the LGU Administrator.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_protect_toda_relocation_columns ON public.toda;
CREATE TRIGGER trigger_protect_toda_relocation_columns
    BEFORE UPDATE ON public.toda
    FOR EACH ROW EXECUTE FUNCTION public.protect_toda_relocation_columns();

-- ----------------------------------------------------------------------------
-- 6. Privileges
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._terminal_point_problem(DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_toda_relocation_columns() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.request_terminal_relocation(UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.approve_terminal_relocation(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reject_terminal_relocation(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_terminal_relocation(UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_terminal_relocation(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_terminal_relocation(UUID, TEXT) TO authenticated, service_role;

DO $$
BEGIN
    IF has_function_privilege('anon', 'public.request_terminal_relocation(uuid,double precision,double precision,text,text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.approve_terminal_relocation(uuid,text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.reject_terminal_relocation(uuid,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'the relocation functions must not be callable by anon';
    END IF;
    IF has_function_privilege('authenticated', 'public._terminal_point_problem(double precision,double precision)', 'EXECUTE') THEN
        RAISE EXCEPTION '_terminal_point_problem must stay internal';
    END IF;
    IF position('_terminal_point_problem' IN pg_get_functiondef('public.register_toda_with_admin(character varying,character varying,character varying,date,integer,integer,double precision,double precision,character varying,character varying,text,character varying,character varying,character varying,text,text,uuid)'::regprocedure)) = 0 THEN
        RAISE EXCEPTION 'register_toda_with_admin does not check the terminal';
    END IF;
END $$;
