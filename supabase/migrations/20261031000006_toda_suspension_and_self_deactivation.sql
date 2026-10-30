-- ============================================================================
-- Migration 20261031000006 - TODA suspension and self-service account deactivation (panel comments 7 and 12, decision D-P5).
--
--   Panel: "Kapag suspended ang TODA, hindi na dapat makabiyahe ang mga driver nito."   "Deactivation of account."
--
-- 1. A TODA can be SUSPENDED (and reinstated) by the LGU, with a reason and an optional end date. Until now the only button set the status to Deactivated, which is the end
--    of an accreditation, not a pause. While a TODA is suspended its drivers
--      - are put Offline at once (a driver who is on a trip finishes that trip, then goes Offline),
--      - lose any offer they had not answered (the search moves on to the next driver at once, without a missed-offer count against them),
--      - cannot go Online, cannot be offered a booking, cannot accept one, and are not paired onto another passenger's trip,
--      - are told why, with the end date when there is one; the driver app shows the same reason.
--    Reinstating (or the end date arriving) puts the TODA back to Active; its drivers go Online again by themselves, nothing is lost.
-- 2. A passenger or a driver can DEACTIVATE THEIR OWN ACCOUNT, and bring it back by signing in and choosing Reactivate. It is a pause that the account holder owns:
--    it is not the penalty deactivation of Rule 22.2 (that one needs the LGU) and it never overrides one. It is refused while the person has a booking or trip in
--    progress or an open dispute, incident or review. Nothing is deleted (the retention rules of Rule 28 still apply); the account just cannot book, be offered, or go Online.
--
-- The functions that already guard bookings, offers and going Online are REPLACED here with the same bodies plus the new check (they are copied from the migration that
-- last defined them): _restriction_message, account_restriction_state, block_restricted_driver_offer, check_driver_online_eligibility, driver_go_online,
-- _driver_presence_state and _shared_best_host. Forward-only; nothing is dropped.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Columns
-- ----------------------------------------------------------------------------
ALTER TABLE public.toda
    ADD COLUMN IF NOT EXISTS suspension_reason  TEXT,
    ADD COLUMN IF NOT EXISTS suspended_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS suspended_until    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reinstated_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reinstatement_note TEXT;

ALTER TABLE public.passenger
    ADD COLUMN IF NOT EXISTS self_deactivated_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS self_deactivation_reason TEXT;
ALTER TABLE public.driver
    ADD COLUMN IF NOT EXISTS self_deactivated_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS self_deactivation_reason TEXT;

-- ----------------------------------------------------------------------------
-- 2. Helpers
-- ----------------------------------------------------------------------------
-- The suspension that applies to a driver (the TODA the driver is working under is suspended), or NULL
CREATE OR REPLACE FUNCTION public._driver_toda_suspension(p_driver_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT jsonb_build_object('toda_id', t.toda_id, 'toda_name', t.toda_name, 'reason', t.suspension_reason,
                              'since', t.suspended_at, 'until', t.suspended_until)
      FROM public.driver d
      JOIN public.toda t ON t.toda_id = d.toda_id
     WHERE d.driver_id = p_driver_id AND t.toda_status = 'Suspended';
$$;

CREATE OR REPLACE FUNCTION public._toda_suspension_message(p_s JSONB)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_until TIMESTAMPTZ := NULLIF(p_s->>'until', '')::TIMESTAMPTZ;
    v_reason TEXT := COALESCE(NULLIF(p_s->>'reason', ''), 'no reason recorded');
BEGIN
    RETURN 'ERR_TODA_SUSPENDED: Suspendido ng LGU ang ' || COALESCE(p_s->>'toda_name', 'inyong TODA') || ', kaya hindi muna kayo maaaring mag-Online o tumanggap ng biyahe'
        || CASE WHEN v_until IS NOT NULL THEN ' hanggang ' || public._fmt_manila(v_until) ELSE '' END || '. Dahilan: ' || v_reason
        || '. (Your TODA, ' || COALESCE(p_s->>'toda_name', 'your TODA') || ', is suspended by the LGU, so you cannot go online or take trips'
        || CASE WHEN v_until IS NOT NULL THEN ' until ' || public._fmt_manila(v_until) ELSE ' until the LGU reinstates it' END
        || '. Reason: ' || v_reason || '.)';
END;
$$;

-- The unanswered offers of a driver end (as "Expired" WITH a response time, so they do not count as missed offers); returns the bookings that need the next driver
CREATE OR REPLACE FUNCTION public._driver_withdraw_pending_offers(p_driver_id UUID)
RETURNS UUID[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ids UUID[];
BEGIN
    WITH w AS (
        UPDATE public.dispatch_attempt
           SET response_status = 'Expired', responded_at = clock_timestamp()
         WHERE driver_id = p_driver_id AND response_status = 'Pending'
        RETURNING booking_id
    )
    SELECT COALESCE(array_agg(booking_id), ARRAY[]::UUID[]) INTO v_ids FROM w;
    RETURN v_ids;
END;
$$;

-- What the driver app reads: is my TODA suspended, why, until when
CREATE OR REPLACE FUNCTION public.get_my_toda_suspension()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_driver UUID;
    v_s JSONB;
BEGIN
    SELECT driver_id INTO v_driver FROM public.driver WHERE auth_user_id = auth.uid();
    IF v_driver IS NULL THEN
        RETURN jsonb_build_object('suspended', FALSE);
    END IF;
    v_s := public._driver_toda_suspension(v_driver);
    IF v_s IS NULL THEN
        RETURN jsonb_build_object('suspended', FALSE);
    END IF;
    RETURN jsonb_build_object('suspended', TRUE) || v_s || jsonb_build_object('message', public._toda_suspension_message(v_s));
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. suspend_toda / reinstate_toda
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.suspend_toda(
    p_toda_id UUID,
    p_reason  TEXT,
    p_until   TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_old     public.toda;
    v_new     public.toda;
    v_reason  TEXT := btrim(COALESCE(p_reason, ''));
    v_prev    TEXT;
    r         RECORD;
    v_ids     UUID[];
    v_all     UUID[] := ARRAY[]::UUID[];
    v_bid     UUID;
    v_offline INTEGER := 0;
    v_on_trip INTEGER := 0;
    v_told    INTEGER := 0;
    v_stamp   TEXT;
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Access Denied: Only the LGU Administrator can suspend a TODA.');
    END IF;
    SELECT * INTO v_old FROM public.toda WHERE toda_id = p_toda_id FOR UPDATE;
    IF v_old.toda_id IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'TODA record not found in database');
    END IF;
    IF v_old.toda_status = 'Suspended' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ALREADY_SUSPENDED', 'error', 'This TODA is already suspended.');
    END IF;
    IF v_old.toda_status <> 'Active' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_TODA_NOT_ACTIVE',
            'error', 'Only an accredited (Active) TODA can be suspended. This TODA is: ' || v_old.toda_status || '.');
    END IF;
    IF length(v_reason) < 10 OR length(v_reason) > 500 THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_SUSPENSION_REASON',
            'error', 'Write the reason for the suspension (10 to 500 characters). The TODA and its drivers read it.');
    END IF;
    IF p_until IS NOT NULL AND (p_until <= CURRENT_TIMESTAMP OR p_until > CURRENT_TIMESTAMP + INTERVAL '366 days') THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_SUSPENSION_END',
            'error', 'The end date of a suspension must be in the future and within one year. Leave it empty to suspend until the LGU reinstates the TODA.');
    END IF;

    v_prev := current_setting('sakay.internal_context', true);
    PERFORM set_config('sakay.internal_context', 'true', true);

    UPDATE public.toda
       SET toda_status = 'Suspended',
           suspension_reason = v_reason,
           suspended_at = clock_timestamp(),
           suspended_until = p_until,
           reinstated_at = NULL,
           reinstatement_note = NULL
     WHERE toda_id = p_toda_id
    RETURNING * INTO v_new;
    v_stamp := to_char(v_new.suspended_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS');

    -- Pairings still waiting for these drivers' answer end (the passenger keeps the standard search)
    FOR r IN
        SELECT m.match_id FROM public.shared_trip_match m
          JOIN public.driver d ON d.driver_id = m.host_driver_id
         WHERE d.toda_id = p_toda_id AND m.match_status = 'Awaiting Driver'
    LOOP
        PERFORM public._shared_close_match(r.match_id, 'toda_suspended', TRUE);
    END LOOP;

    FOR r IN SELECT d.driver_id, d.availability_status FROM public.driver d WHERE d.toda_id = p_toda_id ORDER BY d.driver_id LOOP
        v_ids := public._driver_withdraw_pending_offers(r.driver_id);
        v_all := v_all || v_ids;
        IF r.availability_status <> 'Offline' THEN
            IF public.driver_has_open_accepted_booking(r.driver_id) THEN
                -- the trip the driver already accepted is finished; the driver goes Offline the moment it ends
                UPDATE public.driver_online_session SET offline_pending_reason = 'system' WHERE driver_id = r.driver_id AND ended_at IS NULL;
                v_on_trip := v_on_trip + 1;
            ELSE
                PERFORM public._presence_set_offline(r.driver_id, 'system');
                v_offline := v_offline + 1;
            END IF;
        END IF;
        PERFORM public._notify_subject('driver', r.driver_id, 'TODA_SUSPENDED', 'Your TODA has been suspended',
            'Ang ' || v_new.toda_name || ' ay sinuspinde ng LGU' || CASE WHEN p_until IS NOT NULL THEN ' hanggang ' || public._fmt_manila(p_until) ELSE '' END
            || '. Hindi muna kayo makakapag-Online o makakatanggap ng biyahe; matatapos ninyo ang biyaheng natanggap na. Dahilan: ' || v_reason
            || '. (The LGU suspended ' || v_new.toda_name || CASE WHEN p_until IS NOT NULL THEN ' until ' || public._fmt_manila(p_until) ELSE '' END
            || '. You cannot go Online or take new trips; a trip you already accepted can be finished.)',
            p_toda_id::TEXT || ':' || v_stamp, NULL);
        v_told := v_told + 1;
    END LOOP;

    -- the bookings that were waiting on one of these drivers move on to the next driver now, not when the offer would have run out
    FOREACH v_bid IN ARRAY v_all LOOP
        PERFORM public._dispatch_advance(v_bid);
    END LOOP;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);

    PERFORM public.record_policy_audit('TODA_SUSPENDED', p_toda_id::TEXT, v_new.toda_name, 'Accreditation',
        'Suspended ' || v_new.toda_name || CASE WHEN p_until IS NOT NULL THEN ' until ' || public._fmt_manila(p_until) ELSE ' until the LGU reinstates it' END
        || '. Reason: ' || v_reason || '. Drivers put Offline: ' || v_offline || '; finishing a trip first: ' || v_on_trip || '; offers withdrawn: ' || cardinality(v_all) || '.',
        jsonb_build_object('toda_status', v_old.toda_status),
        jsonb_build_object('toda_status', v_new.toda_status, 'suspension_reason', v_reason, 'suspended_until', p_until));

    RETURN jsonb_build_object('success', TRUE, 'data', to_jsonb(v_new), 'drivers_set_offline', v_offline, 'drivers_finishing_trip', v_on_trip,
                              'offers_withdrawn', cardinality(v_all), 'drivers_notified', v_told);
END;
$$;

-- The work of ending a suspension, used by the LGU's button and by the end date (p_by_system)
CREATE OR REPLACE FUNCTION public._toda_lift_suspension(p_toda_id UUID, p_note TEXT, p_by_system BOOLEAN)
RETURNS public.toda
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_old  public.toda;
    v_new  public.toda;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    r      RECORD;
BEGIN
    SELECT * INTO v_old FROM public.toda WHERE toda_id = p_toda_id FOR UPDATE;
    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.toda
       SET toda_status = 'Active',
           suspension_reason = NULL,
           suspended_at = NULL,
           suspended_until = NULL,
           reinstated_at = clock_timestamp(),
           reinstatement_note = p_note
     WHERE toda_id = p_toda_id
    RETURNING * INTO v_new;
    FOR r IN SELECT d.driver_id FROM public.driver d WHERE d.toda_id = p_toda_id LOOP
        PERFORM public._notify_subject('driver', r.driver_id, 'TODA_REINSTATED', 'Your TODA is active again',
            'Aktibo na muli ang ' || v_new.toda_name || '. Maaari na kayong mag-Online at tumanggap ng biyahe. (' || v_new.toda_name
            || ' is active again. You can go Online and take trips.)',
            p_toda_id::TEXT || ':' || to_char(v_new.reinstated_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS'), NULL);
    END LOOP;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);

    PERFORM public.record_policy_audit(CASE WHEN p_by_system THEN 'TODA_SUSPENSION_ENDED' ELSE 'TODA_REINSTATED' END, p_toda_id::TEXT, v_new.toda_name, 'Accreditation',
        CASE WHEN p_by_system THEN 'The suspension of ' || v_new.toda_name || ' ended on its end date. ' ELSE 'Reinstated ' || v_new.toda_name || '. ' END || 'Note: ' || p_note,
        jsonb_build_object('toda_status', v_old.toda_status, 'suspension_reason', v_old.suspension_reason, 'suspended_until', v_old.suspended_until),
        jsonb_build_object('toda_status', v_new.toda_status));
    RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION public.reinstate_toda(p_toda_id UUID, p_note TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_toda public.toda;
    v_note TEXT := btrim(COALESCE(p_note, ''));
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Access Denied: Only the LGU Administrator can reinstate a TODA.');
    END IF;
    SELECT * INTO v_toda FROM public.toda WHERE toda_id = p_toda_id;
    IF v_toda.toda_id IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'TODA record not found in database');
    END IF;
    IF v_toda.toda_status <> 'Suspended' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_SUSPENDED', 'error', 'This TODA is not suspended (it is: ' || v_toda.toda_status || ').');
    END IF;
    IF length(v_note) < 10 OR length(v_note) > 500 THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_DECISION_NOTE', 'error', 'Write the reason for reinstating (10 to 500 characters). The TODA reads it.');
    END IF;
    RETURN jsonb_build_object('success', TRUE, 'data', to_jsonb(public._toda_lift_suspension(p_toda_id, v_note, FALSE)));
END;
$$;

-- A suspension with an end date ends by itself (the clock decides, not a person)
CREATE OR REPLACE FUNCTION public.lift_expired_toda_suspensions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    r RECORD;
    v_n INTEGER := 0;
BEGIN
    FOR r IN SELECT toda_id, suspended_until FROM public.toda WHERE toda_status = 'Suspended' AND suspended_until IS NOT NULL AND suspended_until <= CURRENT_TIMESTAMP LOOP
        PERFORM public._toda_lift_suspension(r.toda_id, 'The suspension period set by the LGU ended on ' || public._fmt_manila(r.suspended_until) || '.', TRUE);
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END;
$$;

-- The suspension columns change only through those functions
CREATE OR REPLACE FUNCTION public.protect_toda_suspension_columns()
RETURNS TRIGGER AS $$
BEGIN
    IF COALESCE(public.is_lgu_admin(), FALSE) OR COALESCE(public.is_service_context(), FALSE) THEN
        RETURN NEW;
    END IF;
    IF NEW.suspension_reason IS DISTINCT FROM OLD.suspension_reason
       OR NEW.suspended_at IS DISTINCT FROM OLD.suspended_at
       OR NEW.suspended_until IS DISTINCT FROM OLD.suspended_until
       OR NEW.reinstated_at IS DISTINCT FROM OLD.reinstated_at
       OR NEW.reinstatement_note IS DISTINCT FROM OLD.reinstatement_note THEN
        RAISE EXCEPTION 'Access Denied: a TODA is suspended and reinstated by the LGU Administrator.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_protect_toda_suspension_columns ON public.toda;
CREATE TRIGGER trigger_protect_toda_suspension_columns
    BEFORE UPDATE ON public.toda
    FOR EACH ROW EXECUTE FUNCTION public.protect_toda_suspension_columns();

-- ----------------------------------------------------------------------------
-- 4. The guards: a driver of a suspended TODA is not offered, cannot accept, cannot go Online, goes Offline after the trip, and is not paired
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.block_restricted_driver_offer()
RETURNS TRIGGER AS $$
DECLARE
    v_state JSONB;
    v_toda JSONB;
BEGIN
    IF NEW.driver_id IS NULL THEN
        RETURN NEW;
    END IF;
    v_state := public.account_restriction_state('driver', NEW.driver_id);
    IF COALESCE((v_state->>'restricted')::BOOLEAN, FALSE) THEN
        RAISE EXCEPTION '%', public._restriction_message(v_state) USING ERRCODE = 'P0001';
    END IF;
    v_toda := public._driver_toda_suspension(NEW.driver_id);
    IF v_toda IS NOT NULL THEN
        RAISE EXCEPTION '%', public._toda_suspension_message(v_toda) USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.check_driver_online_eligibility()
RETURNS TRIGGER AS $$
DECLARE
    v_res JSONB;
    v_state JSONB;
    v_toda JSONB;
    v_requested TEXT := NEW.availability_status;   -- before the forced-Offline conversion below
BEGIN
    IF (OLD.availability_status = 'Offline' AND NEW.availability_status IN ('Available', 'Busy')) THEN
        v_state := public.account_restriction_state('driver', NEW.driver_id);
        IF COALESCE((v_state->>'restricted')::BOOLEAN, FALSE) THEN
            RAISE EXCEPTION '%', public._restriction_message(v_state) USING ERRCODE = 'P0001';
        END IF;

        v_toda := public._driver_toda_suspension(NEW.driver_id);
        IF v_toda IS NOT NULL THEN
            RAISE EXCEPTION '%', public._toda_suspension_message(v_toda) USING ERRCODE = 'P0001';
        END IF;

        IF NEW.account_status != 'Verified' THEN
            RAISE EXCEPTION 'ERR_DRIVER_NOT_VERIFIED: Hindi maaaring mag-online hangga''t hindi ganap na aprubado ng LGU ang account (Driver must be Verified by LGU before going online).';
        END IF;

        v_res := public.is_driver_documentarily_restricted(NEW.driver_id);
        IF (v_res->>'is_restricted')::BOOLEAN = TRUE THEN
            RAISE EXCEPTION 'ERR_DOCUMENT_EXPIRED: Hindi maaaring mag-online dahil sa expired o kulang na dokumento: %', v_res->>'reasons';
        END IF;

        IF NOT (public.is_service_context() OR public._in_presence_context()) THEN
            RAISE EXCEPTION 'ERR_USE_GO_ONLINE: Gamitin ang Go Online button para mag-online (Going online must go through driver_go_online()).';
        END IF;
    END IF;

    IF (OLD.availability_status = 'Busy' AND NEW.availability_status = 'Available') THEN
        v_state := public.account_restriction_state('driver', NEW.driver_id);
        v_res := public.is_driver_documentarily_restricted(NEW.driver_id);
        IF COALESCE((v_state->>'restricted')::BOOLEAN, FALSE) OR (v_res->>'is_restricted')::BOOLEAN = TRUE
           OR public._driver_toda_suspension(NEW.driver_id) IS NOT NULL THEN
            NEW.availability_status := 'Offline';
        END IF;
    END IF;

    IF (OLD.availability_status <> 'Offline' AND v_requested = 'Offline')
       AND NOT (public.is_service_context() OR public._in_presence_context()) THEN
        IF public.driver_has_open_accepted_booking(NEW.driver_id) THEN
            RAISE EXCEPTION 'ERR_OPEN_BOOKING: Hindi ka maaaring mag-Offline habang may bukas na tinanggap na booking. Tapusin o ipaalam muna ang booking. (You cannot go Offline while you have an open accepted booking.)';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;


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

        IF (v_eligible IS NULL OR cardinality(v_eligible) = 0) AND public._driver_toda_suspension(v_driver.driver_id) IS NOT NULL THEN
            RETURN public._presence_fail('ERR_TODA_SUSPENDED', public._toda_suspension_message(public._driver_toda_suspension(v_driver.driver_id)));
        END IF;
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
        'toda_suspension', public._driver_toda_suspension(p_driver_id),
        'bookings_paused_until', CASE WHEN v_driver.bookings_paused_until > CURRENT_TIMESTAMP THEN v_driver.bookings_paused_until END,
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
           AND public._driver_toda_suspension(d.driver_id) IS NULL                      -- a suspended TODA's driver is not paired onto another passenger
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

-- ----------------------------------------------------------------------------
-- 5. Self-service deactivation
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._restriction_message(p_state JSONB)
RETURNS TEXT AS $$
DECLARE
    v_kind TEXT := p_state->>'kind';
    v_until TIMESTAMPTZ := NULLIF(p_state->>'until', '')::TIMESTAMPTZ;
BEGIN
    IF v_kind = 'SELF_DEACTIVATED' THEN
        RETURN 'ERR_ACCOUNT_SELF_DEACTIVATED: Na-deactivate mo ang iyong account. Mag-sign in at piliin ang Reactivate para magamit itong muli. ' ||
               '(You deactivated your account. Sign in and choose Reactivate to use it again.) [kind=SELF_DEACTIVATED]';
    ELSIF v_kind IN ('DEACTIVATED', 'CLOSED') THEN
        RETURN 'ERR_ACCOUNT_DEACTIVATED: Na-deactivate ang iyong account at nangangailangan ng pagsusuri ng LGU. ' ||
               '(Your account is deactivated and requires LGU review.) [kind=' || v_kind || ']';
    ELSIF v_until IS NOT NULL THEN
        RETURN 'ERR_ACCOUNT_SUSPENDED: Suspendido ang iyong account hanggang ' || public._fmt_manila(v_until) ||
               '. (Your account is suspended until ' || public._fmt_manila(v_until) || '.) [kind=' || v_kind ||
               ' until=' || to_char(v_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || ']';
    END IF;
    RETURN 'ERR_ACCOUNT_SUSPENDED: Pansamantalang sinuspinde ang iyong account habang may imbestigasyon. ' ||
           '(Your account is suspended pending investigation.) [kind=' || COALESCE(v_kind, 'SUSPENDED') || ']';
END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp;


CREATE OR REPLACE FUNCTION public.account_restriction_state(p_subject_type TEXT, p_subject_id UUID)
RETURNS JSONB AS $$
DECLARE
    v RECORD;
    v_kind TEXT;
BEGIN
    IF p_subject_id IS NULL THEN
        RETURN jsonb_build_object('restricted', FALSE);
    END IF;

    IF p_subject_type = 'passenger' THEN
        SELECT account_status, suspended_until, suspension_kind, deactivated_at, closed_at, suspension_reason, self_deactivated_at
          INTO v FROM public.passenger WHERE passenger_id = p_subject_id;
    ELSIF p_subject_type = 'driver' THEN
        SELECT account_status, suspended_until, suspension_kind, deactivated_at, closed_at, suspension_reason, self_deactivated_at
          INTO v FROM public.driver WHERE driver_id = p_subject_id;
    ELSE
        RAISE EXCEPTION 'Unknown subject type %', p_subject_type;
    END IF;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('restricted', FALSE);
    END IF;

    IF v.closed_at IS NOT NULL THEN
        v_kind := 'CLOSED';
    ELSIF v.deactivated_at IS NOT NULL OR v.account_status = 'Deactivated' THEN
        v_kind := 'DEACTIVATED';
    ELSIF v.suspension_kind = 'INVESTIGATION' THEN
        v_kind := 'INVESTIGATION';
    ELSIF v.suspended_until IS NOT NULL AND v.suspended_until > CURRENT_TIMESTAMP THEN
        v_kind := 'SUSPENDED';
    ELSIF v.account_status = 'Suspended' AND v.suspension_kind IS NULL AND v.suspended_until IS NULL THEN
        v_kind := 'SUSPENDED';   -- legacy row written outside the engine
    ELSIF v.self_deactivated_at IS NOT NULL THEN
        v_kind := 'SELF_DEACTIVATED';   -- the account holder paused it; any penalty above wins, and reactivating never lifts one
    END IF;

    RETURN jsonb_build_object(
        'restricted', v_kind IS NOT NULL,
        'kind', v_kind,
        'until', v.suspended_until,
        'reason', v.suspension_reason,
        'since', v.self_deactivated_at
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;


CREATE OR REPLACE FUNCTION public.protect_self_deactivation_columns()
RETURNS TRIGGER AS $$
BEGIN
    IF COALESCE(public.is_service_context(), FALSE) THEN
        RETURN NEW;
    END IF;
    IF NEW.self_deactivated_at IS DISTINCT FROM OLD.self_deactivated_at OR NEW.self_deactivation_reason IS DISTINCT FROM OLD.self_deactivation_reason THEN
        RAISE EXCEPTION 'Access Denied: an account is deactivated and reactivated with deactivate_my_account() and reactivate_my_account().';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_protect_passenger_self_deactivation ON public.passenger;
CREATE TRIGGER trigger_protect_passenger_self_deactivation
    BEFORE UPDATE ON public.passenger
    FOR EACH ROW EXECUTE FUNCTION public.protect_self_deactivation_columns();
DROP TRIGGER IF EXISTS trigger_protect_driver_self_deactivation ON public.driver;
CREATE TRIGGER trigger_protect_driver_self_deactivation
    BEFORE UPDATE ON public.driver
    FOR EACH ROW EXECUTE FUNCTION public.protect_self_deactivation_columns();

CREATE OR REPLACE FUNCTION public.deactivate_my_account(p_role TEXT, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid    UUID := auth.uid();
    v_id     UUID;
    v_name   TEXT;
    v_state  JSONB;
    v_reason TEXT := NULLIF(left(btrim(COALESCE(p_reason, '')), 300), '');
    v_prev   TEXT;
    v_ids    UUID[];
    v_bid    UUID;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_SIGNED_IN', 'error', 'Sign in first.');
    END IF;
    IF p_role = 'passenger' THEN
        SELECT passenger_id, full_name INTO v_id, v_name FROM public.passenger WHERE auth_user_id = v_uid;
    ELSIF p_role = 'driver' THEN
        SELECT driver_id, full_name INTO v_id, v_name FROM public.driver WHERE auth_user_id = v_uid;
    ELSE
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROLE', 'error', 'Choose passenger or driver.');
    END IF;
    IF v_id IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NO_ACCOUNT', 'error', 'There is no ' || p_role || ' account for this sign-in.');
    END IF;

    v_state := public.account_restriction_state(p_role, v_id);
    IF COALESCE((v_state->>'restricted')::BOOLEAN, FALSE) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ALREADY_RESTRICTED', 'error', 'Your account is already deactivated or suspended.');
    END IF;

    IF p_role = 'passenger' THEN
        IF EXISTS (SELECT 1 FROM public.booking b WHERE b.passenger_id = v_id
                    AND public._booking_phase(b.booking_status) IN ('searching', 'assigned', 'arrived', 'ongoing', 'at_destination')) THEN
            RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_OPEN_BOOKING',
                'error', 'You have a booking or trip in progress. Finish or cancel it first, then deactivate your account.');
        END IF;
    ELSE
        IF public.driver_has_open_accepted_booking(v_id) OR EXISTS (SELECT 1 FROM public.driver d WHERE d.driver_id = v_id AND d.availability_status = 'Busy') THEN
            RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_OPEN_BOOKING',
                'error', 'You have a trip in progress. Finish it first, then deactivate your account.');
        END IF;
    END IF;
    IF public._subject_is_held(p_role, v_id) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_OPEN_CASE',
            'error', 'You have an open dispute, report or review. Your account can be deactivated once it is closed.');
    END IF;

    v_prev := current_setting('sakay.internal_context', true);
    PERFORM set_config('sakay.internal_context', 'true', true);
    IF p_role = 'passenger' THEN
        UPDATE public.passenger SET self_deactivated_at = clock_timestamp(), self_deactivation_reason = v_reason WHERE passenger_id = v_id;
    ELSE
        UPDATE public.driver SET self_deactivated_at = clock_timestamp(), self_deactivation_reason = v_reason WHERE driver_id = v_id;
        v_ids := public._driver_withdraw_pending_offers(v_id);
        PERFORM public._presence_set_offline(v_id, 'system');
        FOREACH v_bid IN ARRAY v_ids LOOP
            PERFORM public._dispatch_advance(v_bid);
        END LOOP;
    END IF;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);

    PERFORM public.record_policy_audit('ACCOUNT_SELF_DEACTIVATED', v_id::TEXT, v_name, 'Account',
        'The ' || p_role || ' deactivated their own account.' || COALESCE(' Reason given: ' || v_reason, ''),
        jsonb_build_object('self_deactivated', FALSE), jsonb_build_object('self_deactivated', TRUE));
    RETURN jsonb_build_object('success', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.reactivate_my_account(p_role TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid   UUID := auth.uid();
    v_id    UUID;
    v_name  TEXT;
    v_since TIMESTAMPTZ;
    v_prev  TEXT;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_SIGNED_IN', 'error', 'Sign in first.');
    END IF;
    IF p_role = 'passenger' THEN
        SELECT passenger_id, full_name, self_deactivated_at INTO v_id, v_name, v_since FROM public.passenger WHERE auth_user_id = v_uid;
    ELSIF p_role = 'driver' THEN
        SELECT driver_id, full_name, self_deactivated_at INTO v_id, v_name, v_since FROM public.driver WHERE auth_user_id = v_uid;
    ELSE
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROLE', 'error', 'Choose passenger or driver.');
    END IF;
    IF v_id IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NO_ACCOUNT', 'error', 'There is no ' || p_role || ' account for this sign-in.');
    END IF;
    IF v_since IS NULL THEN
        RETURN jsonb_build_object('success', TRUE, 'already_active', TRUE) || jsonb_build_object('restriction', public.account_restriction_state(p_role, v_id));
    END IF;

    v_prev := current_setting('sakay.internal_context', true);
    PERFORM set_config('sakay.internal_context', 'true', true);
    IF p_role = 'passenger' THEN
        UPDATE public.passenger SET self_deactivated_at = NULL, self_deactivation_reason = NULL WHERE passenger_id = v_id;
    ELSE
        UPDATE public.driver SET self_deactivated_at = NULL, self_deactivation_reason = NULL WHERE driver_id = v_id;
    END IF;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);

    PERFORM public.record_policy_audit('ACCOUNT_SELF_REACTIVATED', v_id::TEXT, v_name, 'Account',
        'The ' || p_role || ' reactivated their own account (deactivated since ' || public._fmt_manila(v_since) || ').',
        jsonb_build_object('self_deactivated', TRUE), jsonb_build_object('self_deactivated', FALSE));
    -- an LGU suspension or deactivation that applies in the meantime is NOT lifted by this: the answer says what still applies
    RETURN jsonb_build_object('success', TRUE, 'restriction', public.account_restriction_state(p_role, v_id));
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. The end dates are watched every minute
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_toda_suspension_job()
RETURNS INTEGER AS $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_n INTEGER;
BEGIN
    PERFORM set_config('sakay.internal_context', 'true', true);
    v_n := public.lift_expired_toda_suspensions();
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN v_n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
        CREATE EXTENSION IF NOT EXISTS pg_cron;
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'sakay-toda-suspension-end';
        PERFORM cron.schedule('sakay-toda-suspension-end', '* * * * *', 'SELECT public.run_toda_suspension_job()');
    ELSE
        RAISE NOTICE 'pg_cron is not available in this database: the end dates of TODA suspensions are NOT watched here. Enable pg_cron and re-run this block.';
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 7. Privileges
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._driver_toda_suspension(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._toda_suspension_message(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._driver_withdraw_pending_offers(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._toda_lift_suspension(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lift_expired_toda_suspensions() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.run_toda_suspension_job() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_toda_suspension_columns() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_self_deactivation_columns() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_toda_suspension() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.suspend_toda(UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reinstate_toda(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.deactivate_my_account(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reactivate_my_account(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_toda_suspension() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.suspend_toda(UUID, TEXT, TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reinstate_toda(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_my_account(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reactivate_my_account(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lift_expired_toda_suspensions() TO service_role;
GRANT EXECUTE ON FUNCTION public.run_toda_suspension_job() TO service_role;

-- ----------------------------------------------------------------------------
-- 8. SELF-CHECK (the migration fails, and nothing is applied, if any of this is not true)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF pg_get_functiondef('public.driver_go_online(double precision, double precision, double precision, integer, uuid)'::regprocedure) NOT LIKE '%ERR_TODA_SUSPENDED%' THEN
        RAISE EXCEPTION 'driver_go_online() does not refuse a suspended TODA';
    END IF;
    IF pg_get_functiondef('public.check_driver_online_eligibility()'::regprocedure) NOT LIKE '%_driver_toda_suspension%' THEN
        RAISE EXCEPTION 'check_driver_online_eligibility() does not check the TODA';
    END IF;
    IF pg_get_functiondef('public.block_restricted_driver_offer()'::regprocedure) NOT LIKE '%_driver_toda_suspension%' THEN
        RAISE EXCEPTION 'block_restricted_driver_offer() does not check the TODA';
    END IF;
    IF pg_get_functiondef('public._shared_best_host(uuid)'::regprocedure) NOT LIKE '%_driver_toda_suspension%' THEN
        RAISE EXCEPTION '_shared_best_host() does not skip a suspended TODA';
    END IF;
    IF pg_get_functiondef('public._driver_presence_state(uuid)'::regprocedure) NOT LIKE '%toda_suspension%' THEN
        RAISE EXCEPTION '_driver_presence_state() does not report the suspension';
    END IF;
    IF pg_get_functiondef('public.account_restriction_state(text, uuid)'::regprocedure) NOT LIKE '%SELF_DEACTIVATED%'
       OR pg_get_functiondef('public._restriction_message(jsonb)'::regprocedure) NOT LIKE '%SELF_DEACTIVATED%' THEN
        RAISE EXCEPTION 'the restriction state does not know a self-deactivated account';
    END IF;
    IF has_function_privilege('authenticated', 'public._driver_toda_suspension(uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public._toda_lift_suspension(uuid, text, boolean)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.lift_expired_toda_suspensions()', 'EXECUTE') THEN
        RAISE EXCEPTION 'a signed-in user can run an internal suspension function';
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.suspend_toda(uuid, text, timestamptz)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.deactivate_my_account(text, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'a signed-in user cannot run the public functions';
    END IF;
END $$;
