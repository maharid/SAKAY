-- ============================================================================
-- Migration: 20261028000004_vehicle_substitution.sql
-- Rule 29.18: "Drivers shall only operate the verified vehicle registered under their approved account. Substituting another vehicle without prior approval
-- from the TODA Administrator and LGU Administrator is prohibited."
--
-- The verified vehicle (plate and franchise number) is locked: the driver cannot change it (protect_verified_vehicle, Batch 4) and only the LGU Administrator or
-- the system can. But there was no way to ASK: a driver whose tricycle broke down could not lawfully borrow another, and the administrators had no record of an
-- approval. This adds the request and the two approvals, in the order of the policy (TODA Administrator first, then LGU Administrator), as a TEMPORARY
-- substitution:
--   * request_vehicle_substitution()       the driver names the substitute plate and franchise number, why, and for how many days (1 to 7)
--   * decide_vehicle_substitution_toda()   the driver's TODA Administrator approves (it goes to the LGU) or denies (with the reason)
--   * decide_vehicle_substitution_lgu()    the LGU Administrator approves (the substitute becomes the driver's vehicle for the days asked) or denies
--   * end_vehicle_substitution()           the driver, the TODA Administrator or the LGU Administrator ends an active substitution early
--   * withdraw_vehicle_substitution()      the driver withdraws a request that is still waiting
--   * end_expired_vehicle_substitutions()  the hourly sweep puts the registered vehicle back when the days are over
-- While a substitution is active the driver's plate and franchise number ARE the substitute's, so every screen that shows the vehicle (the passenger's trip, the
-- TODA roster, the LGU lists) shows the one actually driven, and the registered vehicle returns by itself: nothing is left to remember. A change is never made, and
-- the registered vehicle is never put back, while the driver has an open booking (the change waits until the trip is over). One request at a time per driver.
-- A driver with no TODA goes straight to the LGU Administrator. Every step is audited and tells the driver.
--
-- Forward-only. Safe to run twice.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.vehicle_substitution (
    substitution_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id            UUID NOT NULL REFERENCES public.driver(driver_id) ON DELETE CASCADE,
    toda_id              UUID,
    substitute_plate     VARCHAR(50) NOT NULL,
    substitute_franchise VARCHAR(50) NOT NULL,
    reason               TEXT NOT NULL CHECK (length(btrim(reason)) >= 10),
    requested_days       INTEGER NOT NULL CHECK (requested_days BETWEEN 1 AND 7),
    status               TEXT NOT NULL CHECK (status IN ('Pending TODA Approval', 'Pending LGU Approval', 'Active', 'Ended', 'Denied', 'Withdrawn')),
    original_plate       VARCHAR(50),
    original_franchise   VARCHAR(50),
    toda_decided_at      TIMESTAMPTZ,
    toda_decision_note   TEXT,
    lgu_decided_at       TIMESTAMPTZ,
    lgu_decision_note    TEXT,
    denied_by_role       TEXT,
    denial_reason        TEXT,
    activated_at         TIMESTAMPTZ,
    ends_at              TIMESTAMPTZ,
    ended_at             TIMESTAMPTZ,
    end_reason           TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.vehicle_substitution IS 'Rule 29.18: a driver''s request to use another vehicle for 1-7 days, approved first by the TODA Administrator, then by the LGU Administrator. While Active, driver.plate_number / franchise_number are the substitute''s; they are put back when it ends.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_substitution_one_open
    ON public.vehicle_substitution (driver_id)
    WHERE status IN ('Pending TODA Approval', 'Pending LGU Approval', 'Active');
CREATE INDEX IF NOT EXISTS idx_vehicle_substitution_queue ON public.vehicle_substitution (status, created_at);
CREATE INDEX IF NOT EXISTS idx_vehicle_substitution_ends ON public.vehicle_substitution (ends_at) WHERE status = 'Active';

ALTER TABLE public.vehicle_substitution ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vehicle_substitution FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vehicle_substitution TO authenticated;
GRANT ALL ON TABLE public.vehicle_substitution TO service_role;

-- read only: the driver sees their own, a TODA Administrator the requests of their TODA's drivers, the LGU Administrator all; nobody writes directly
DROP POLICY IF EXISTS vehicle_substitution_select ON public.vehicle_substitution;
CREATE POLICY vehicle_substitution_select ON public.vehicle_substitution
    FOR SELECT TO authenticated
    USING (
        driver_id = public.get_current_driver_id()
        OR public.is_lgu_admin()
        OR (public.is_toda_admin() AND toda_id IS NOT NULL AND toda_id = public.get_current_toda_admin_toda_id())
    );

-- ----------------------------------------------------------------------------
-- internal: put the registered vehicle back (called by the three ways a substitution ends)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._revert_vehicle_substitution(p_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_s    public.vehicle_substitution;
    v_prev TEXT := current_setting('sakay.internal_context', true);
BEGIN
    SELECT * INTO v_s FROM public.vehicle_substitution WHERE substitution_id = p_id FOR UPDATE;
    IF NOT FOUND OR v_s.status <> 'Active' THEN RETURN; END IF;
    PERFORM set_config('sakay.internal_context', 'true', true);
    -- only if the vehicle is still the substitute (an administrator may have changed it since)
    UPDATE public.driver
       SET plate_number = v_s.original_plate, franchise_number = v_s.original_franchise
     WHERE driver_id = v_s.driver_id AND plate_number = v_s.substitute_plate AND franchise_number = v_s.substitute_franchise;
    UPDATE public.vehicle_substitution SET status = 'Ended', ended_at = now(), end_reason = p_reason WHERE substitution_id = p_id;
    PERFORM public.record_policy_audit('VEHICLE_SUBSTITUTION_ENDED', v_s.driver_id::TEXT, public._subject_name('driver', v_s.driver_id), 'User Oversight',
        'The substitute vehicle ' || v_s.substitute_plate || ' ended (' || p_reason || '); the registered vehicle ' || COALESCE(v_s.original_plate, '-') || ' is back.',
        to_jsonb(v_s), jsonb_build_object('status', 'Ended'));
    PERFORM public._notify_subject('driver', v_s.driver_id, 'VEHICLE_SUBSTITUTION_ENDED', 'Bumalik na ang rehistradong sasakyan mo (Your registered vehicle is back)',
        'The substitute vehicle ' || v_s.substitute_plate || ' is no longer approved. Your registered vehicle ' || COALESCE(v_s.original_plate, '-') || ' is your vehicle again.', p_id::TEXT, NULL);
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
END;
$$;

-- ----------------------------------------------------------------------------
-- the driver asks
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_vehicle_substitution(p_plate TEXT, p_franchise TEXT, p_reason TEXT, p_days INTEGER)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_driver_id UUID := public.get_current_driver_id();
    v_d         public.driver;
    v_plate     TEXT := upper(btrim(COALESCE(p_plate, '')));
    v_fran      TEXT := upper(btrim(COALESCE(p_franchise, '')));
    v_status    TEXT;
    v_id        UUID;
BEGIN
    IF v_driver_id IS NULL THEN
        RAISE EXCEPTION 'ERR_NOT_A_DRIVER: Only a driver can ask to use another vehicle.';
    END IF;
    SELECT * INTO v_d FROM public.driver WHERE driver_id = v_driver_id;
    IF v_d.account_status <> 'Verified' THEN
        RAISE EXCEPTION 'ERR_NOT_VERIFIED: Only a verified driver can ask to use another vehicle.';
    END IF;
    IF v_plate !~ '^[A-Z0-9][A-Z0-9 -]{2,19}$' THEN
        RAISE EXCEPTION 'ERR_PLATE: Enter the plate number of the vehicle you want to use (letters, numbers, space or dash).';
    END IF;
    IF length(v_fran) < 2 THEN
        RAISE EXCEPTION 'ERR_FRANCHISE: Enter the franchise (MTOP) number of the vehicle you want to use.';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
        RAISE EXCEPTION 'ERR_REASON: Say why you need another vehicle (at least 10 characters).';
    END IF;
    IF p_days IS NULL OR p_days < 1 OR p_days > 7 THEN
        RAISE EXCEPTION 'ERR_DAYS: A substitute vehicle can be approved for 1 to 7 days.';
    END IF;
    IF upper(btrim(COALESCE(v_d.plate_number, ''))) = v_plate THEN
        RAISE EXCEPTION 'ERR_SAME_VEHICLE: That is already your registered vehicle.';
    END IF;
    IF public.driver_has_open_accepted_booking(v_driver_id) THEN
        RAISE EXCEPTION 'ERR_OPEN_BOOKING: Finish your open booking first.';
    END IF;

    v_status := CASE WHEN v_d.toda_id IS NULL THEN 'Pending LGU Approval' ELSE 'Pending TODA Approval' END;
    BEGIN
        INSERT INTO public.vehicle_substitution (driver_id, toda_id, substitute_plate, substitute_franchise, reason, requested_days, status)
        VALUES (v_driver_id, v_d.toda_id, v_plate, v_fran, btrim(p_reason), p_days, v_status)
        RETURNING substitution_id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'ERR_REQUEST_OPEN: You already have a vehicle request waiting or active.';
    END;

    PERFORM public.record_policy_audit('VEHICLE_SUBSTITUTION_REQUESTED', v_driver_id::TEXT, v_d.full_name, 'User Oversight',
        'The driver asked to use vehicle ' || v_plate || ' (franchise ' || v_fran || ') for ' || p_days || ' day(s): ' || btrim(p_reason),
        jsonb_build_object('registered_plate', v_d.plate_number), jsonb_build_object('substitution_id', v_id, 'status', v_status));
    RETURN jsonb_build_object('success', TRUE, 'substitution_id', v_id, 'status', v_status);
END;
$$;

-- ----------------------------------------------------------------------------
-- the TODA Administrator decides first
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decide_vehicle_substitution_toda(p_id UUID, p_approve BOOLEAN, p_note TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_s    public.vehicle_substitution;
    v_note TEXT := btrim(COALESCE(p_note, ''));
BEGIN
    SELECT * INTO v_s FROM public.vehicle_substitution WHERE substitution_id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_NOT_FOUND: The request was not found.';
    END IF;
    IF NOT (COALESCE(public.is_toda_admin(), FALSE) AND v_s.toda_id IS NOT NULL AND v_s.toda_id = public.get_current_toda_admin_toda_id()) THEN
        RAISE EXCEPTION 'Access Denied: Only the TODA Administrator of this driver can decide this request.';
    END IF;
    IF v_s.status <> 'Pending TODA Approval' THEN
        RAISE EXCEPTION 'ERR_NOT_WAITING: This request is not waiting for the TODA Administrator (%).', v_s.status;
    END IF;
    IF p_approve IS NULL THEN
        RAISE EXCEPTION 'ERR_CHOICE: Approve or deny the request.';
    END IF;
    IF NOT p_approve AND length(v_note) < 5 THEN
        RAISE EXCEPTION 'ERR_REASON: Give the reason for denying (the driver is told).';
    END IF;

    IF p_approve THEN
        UPDATE public.vehicle_substitution SET status = 'Pending LGU Approval', toda_decided_at = now(), toda_decision_note = NULLIF(v_note, '') WHERE substitution_id = p_id;
        PERFORM public.record_policy_audit('VEHICLE_SUBSTITUTION_TODA_APPROVED', v_s.driver_id::TEXT, public._subject_name('driver', v_s.driver_id), 'User Oversight',
            'The TODA Administrator approved the substitute vehicle ' || v_s.substitute_plate || '; it now waits for the LGU Administrator.' || CASE WHEN v_note <> '' THEN ' ' || v_note ELSE '' END,
            jsonb_build_object('status', v_s.status), jsonb_build_object('status', 'Pending LGU Approval'));
        PERFORM public._notify_subject('driver', v_s.driver_id, 'VEHICLE_SUBSTITUTION_FORWARDED', 'Aprubado ng TODA, hinihintay ang LGU (Approved by your TODA, waiting for the LGU)',
            'Your TODA Administrator approved the substitute vehicle ' || v_s.substitute_plate || '. It now needs the LGU Administrator. Do not use it before it is approved.', p_id::TEXT, NULL);
        RETURN jsonb_build_object('success', TRUE, 'status', 'Pending LGU Approval');
    END IF;

    UPDATE public.vehicle_substitution SET status = 'Denied', toda_decided_at = now(), toda_decision_note = v_note, denied_by_role = 'toda_admin', denial_reason = v_note WHERE substitution_id = p_id;
    PERFORM public.record_policy_audit('VEHICLE_SUBSTITUTION_DENIED', v_s.driver_id::TEXT, public._subject_name('driver', v_s.driver_id), 'User Oversight',
        'The TODA Administrator denied the substitute vehicle ' || v_s.substitute_plate || ': ' || v_note, jsonb_build_object('status', v_s.status), jsonb_build_object('status', 'Denied'));
    PERFORM public._notify_subject('driver', v_s.driver_id, 'VEHICLE_SUBSTITUTION_DENIED', 'Hindi inaprubahan ang ibang sasakyan (The substitute vehicle was not approved)',
        'Your TODA Administrator did not approve the substitute vehicle ' || v_s.substitute_plate || ': ' || v_note, p_id::TEXT, NULL);
    RETURN jsonb_build_object('success', TRUE, 'status', 'Denied');
END;
$$;

-- ----------------------------------------------------------------------------
-- the LGU Administrator decides last; approving puts the substitute in place
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decide_vehicle_substitution_lgu(p_id UUID, p_approve BOOLEAN, p_note TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_s    public.vehicle_substitution;
    v_d    public.driver;
    v_note TEXT := btrim(COALESCE(p_note, ''));
    v_ends TIMESTAMPTZ;
    v_prev TEXT := current_setting('sakay.internal_context', true);
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RAISE EXCEPTION 'Access Denied: Only the LGU Administrator can give this approval.';
    END IF;
    SELECT * INTO v_s FROM public.vehicle_substitution WHERE substitution_id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_NOT_FOUND: The request was not found.';
    END IF;
    IF v_s.status <> 'Pending LGU Approval' THEN
        RAISE EXCEPTION 'ERR_NOT_WAITING: This request is not waiting for the LGU Administrator (%). A request goes to the TODA Administrator first.', v_s.status;
    END IF;
    IF p_approve IS NULL THEN
        RAISE EXCEPTION 'ERR_CHOICE: Approve or deny the request.';
    END IF;
    IF NOT p_approve AND length(v_note) < 5 THEN
        RAISE EXCEPTION 'ERR_REASON: Give the reason for denying (the driver is told).';
    END IF;

    IF NOT p_approve THEN
        UPDATE public.vehicle_substitution SET status = 'Denied', lgu_decided_at = now(), lgu_decision_note = v_note, denied_by_role = 'lgu_admin', denial_reason = v_note WHERE substitution_id = p_id;
        PERFORM public.record_policy_audit('VEHICLE_SUBSTITUTION_DENIED', v_s.driver_id::TEXT, public._subject_name('driver', v_s.driver_id), 'User Oversight',
            'The LGU Administrator denied the substitute vehicle ' || v_s.substitute_plate || ': ' || v_note, jsonb_build_object('status', v_s.status), jsonb_build_object('status', 'Denied'));
        PERFORM public._notify_subject('driver', v_s.driver_id, 'VEHICLE_SUBSTITUTION_DENIED', 'Hindi inaprubahan ang ibang sasakyan (The substitute vehicle was not approved)',
            'The LGU Administrator did not approve the substitute vehicle ' || v_s.substitute_plate || ': ' || v_note, p_id::TEXT, NULL);
        RETURN jsonb_build_object('success', TRUE, 'status', 'Denied');
    END IF;

    SELECT * INTO v_d FROM public.driver WHERE driver_id = v_s.driver_id FOR UPDATE;
    IF v_d.account_status <> 'Verified' THEN
        RAISE EXCEPTION 'ERR_NOT_VERIFIED: The driver is not a verified driver any more.';
    END IF;
    IF public.driver_has_open_accepted_booking(v_s.driver_id) THEN
        RAISE EXCEPTION 'ERR_OPEN_BOOKING: The driver has an open booking. The vehicle cannot be changed during a trip: approve it when the trip is over.';
    END IF;

    v_ends := now() + make_interval(days => v_s.requested_days);
    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.driver SET plate_number = v_s.substitute_plate, franchise_number = v_s.substitute_franchise WHERE driver_id = v_s.driver_id;
    UPDATE public.vehicle_substitution
       SET status = 'Active', lgu_decided_at = now(), lgu_decision_note = NULLIF(v_note, ''),
           original_plate = v_d.plate_number, original_franchise = v_d.franchise_number, activated_at = now(), ends_at = v_ends
     WHERE substitution_id = p_id;
    PERFORM public.record_policy_audit('VEHICLE_SUBSTITUTION_APPROVED', v_s.driver_id::TEXT, v_d.full_name, 'User Oversight',
        'The LGU Administrator approved the substitute vehicle ' || v_s.substitute_plate || ' (franchise ' || v_s.substitute_franchise || ') until ' || public._fmt_manila(v_ends)
        || '.' || CASE WHEN v_note <> '' THEN ' ' || v_note ELSE '' END,
        jsonb_build_object('plate_number', v_d.plate_number, 'franchise_number', v_d.franchise_number),
        jsonb_build_object('plate_number', v_s.substitute_plate, 'franchise_number', v_s.substitute_franchise, 'ends_at', v_ends));
    PERFORM public._notify_subject('driver', v_s.driver_id, 'VEHICLE_SUBSTITUTION_ACTIVE', 'Aprubado ang ibang sasakyan (The substitute vehicle is approved)',
        'You may use ' || v_s.substitute_plate || ' until ' || public._fmt_manila(v_ends) || '. Your registered vehicle comes back on its own after that.', p_id::TEXT, NULL);
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'status', 'Active', 'ends_at', v_ends);
END;
$$;

-- ----------------------------------------------------------------------------
-- ending early, withdrawing, and the sweep
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.end_vehicle_substitution(p_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_s      public.vehicle_substitution;
    v_driver UUID := public.get_current_driver_id();
    v_role   TEXT;
    v_reason TEXT := btrim(COALESCE(p_reason, ''));
BEGIN
    SELECT * INTO v_s FROM public.vehicle_substitution WHERE substitution_id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_NOT_FOUND: The request was not found.';
    END IF;
    IF COALESCE(public.is_lgu_admin(), FALSE) THEN
        v_role := 'the LGU Administrator';
    ELSIF COALESCE(public.is_toda_admin(), FALSE) AND v_s.toda_id IS NOT NULL AND v_s.toda_id = public.get_current_toda_admin_toda_id() THEN
        v_role := 'the TODA Administrator';
    ELSIF v_driver IS NOT NULL AND v_driver = v_s.driver_id THEN
        v_role := 'the driver';
    ELSE
        RAISE EXCEPTION 'Access Denied: You cannot end this substitution.';
    END IF;
    IF v_s.status <> 'Active' THEN
        RAISE EXCEPTION 'ERR_NOT_ACTIVE: This substitution is not active (%).', v_s.status;
    END IF;
    IF v_role <> 'the driver' AND length(v_reason) < 5 THEN
        RAISE EXCEPTION 'ERR_REASON: Give the reason for ending it (the driver is told).';
    END IF;
    IF public.driver_has_open_accepted_booking(v_s.driver_id) THEN
        RAISE EXCEPTION 'ERR_OPEN_BOOKING: The driver has an open booking. The registered vehicle is put back when the trip is over.';
    END IF;
    PERFORM public._revert_vehicle_substitution(p_id, 'ended early by ' || v_role || CASE WHEN v_reason <> '' THEN ': ' || v_reason ELSE '' END);
    RETURN jsonb_build_object('success', TRUE, 'status', 'Ended');
END;
$$;

CREATE OR REPLACE FUNCTION public.withdraw_vehicle_substitution(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_s public.vehicle_substitution;
BEGIN
    SELECT * INTO v_s FROM public.vehicle_substitution WHERE substitution_id = p_id FOR UPDATE;
    IF NOT FOUND OR v_s.driver_id IS DISTINCT FROM public.get_current_driver_id() THEN
        RAISE EXCEPTION 'Access Denied: You can only withdraw your own request.';
    END IF;
    IF v_s.status NOT IN ('Pending TODA Approval', 'Pending LGU Approval') THEN
        RAISE EXCEPTION 'ERR_NOT_WAITING: Only a request that is still waiting can be withdrawn (%).', v_s.status;
    END IF;
    UPDATE public.vehicle_substitution SET status = 'Withdrawn', ended_at = now(), end_reason = 'withdrawn by the driver' WHERE substitution_id = p_id;
    PERFORM public.record_policy_audit('VEHICLE_SUBSTITUTION_WITHDRAWN', v_s.driver_id::TEXT, public._subject_name('driver', v_s.driver_id), 'User Oversight',
        'The driver withdrew the request for vehicle ' || v_s.substitute_plate || '.', jsonb_build_object('status', v_s.status), jsonb_build_object('status', 'Withdrawn'));
    RETURN jsonb_build_object('success', TRUE, 'status', 'Withdrawn');
END;
$$;

-- The hourly sweep: every active substitution whose days are over is ended, unless the driver is on a trip (it is ended at the next run after the trip).
CREATE OR REPLACE FUNCTION public.end_expired_vehicle_substitutions()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    r RECORD;
    v_n INTEGER := 0;
BEGIN
    FOR r IN SELECT substitution_id, driver_id FROM public.vehicle_substitution WHERE status = 'Active' AND ends_at <= now() ORDER BY ends_at LOOP
        CONTINUE WHEN public.driver_has_open_accepted_booking(r.driver_id);
        PERFORM public._revert_vehicle_substitution(r.substitution_id, 'the approved days are over');
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END;
$$;

-- The hourly job of 20261028000001 gains a third duty (each on its own, so one failing never stops the others).
CREATE OR REPLACE FUNCTION public.run_policy_sweeps_job()
RETURNS JSONB AS $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_cascade JSONB;
    v_strikes JSONB;
    v_vehicles INTEGER;
    v_errors JSONB := '[]'::jsonb;
BEGIN
    PERFORM set_config('sakay.internal_context', 'true', true);

    BEGIN
        v_cascade := public.run_scheduled_sla_and_expiry_cascade();
    EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors || jsonb_build_array('SLA and expiry cascade: ' || SQLERRM);
        RAISE WARNING 'policy sweeps: the SLA and expiry cascade failed (%)', SQLERRM;
    END;

    BEGIN
        v_strikes := public.sweep_strike_state();
    EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors || jsonb_build_array('Strike sweep: ' || SQLERRM);
        RAISE WARNING 'policy sweeps: the strike sweep failed (%)', SQLERRM;
    END;

    BEGIN
        v_vehicles := public.end_expired_vehicle_substitutions();
    EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors || jsonb_build_array('Vehicle substitutions: ' || SQLERRM);
        RAISE WARNING 'policy sweeps: ending expired vehicle substitutions failed (%)', SQLERRM;
    END;

    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('cascade', v_cascade, 'strike_sweep', v_strikes, 'vehicle_substitutions_ended', v_vehicles, 'errors', v_errors);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Privileges (functions created from now on get none by default)
REVOKE EXECUTE ON FUNCTION public._revert_vehicle_substitution(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.end_expired_vehicle_substitutions() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.run_policy_sweeps_job() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.request_vehicle_substitution(TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.decide_vehicle_substitution_toda(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.decide_vehicle_substitution_lgu(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.end_vehicle_substitution(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.withdraw_vehicle_substitution(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._revert_vehicle_substitution(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.end_expired_vehicle_substitutions() TO service_role;
GRANT EXECUTE ON FUNCTION public.run_policy_sweeps_job() TO service_role;
GRANT EXECUTE ON FUNCTION public.request_vehicle_substitution(TEXT, TEXT, TEXT, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decide_vehicle_substitution_toda(UUID, BOOLEAN, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decide_vehicle_substitution_lgu(UUID, BOOLEAN, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.end_vehicle_substitution(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.withdraw_vehicle_substitution(UUID) TO authenticated, service_role;
