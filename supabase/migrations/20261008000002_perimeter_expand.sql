-- ============================================================================
-- Migration: 20261008000002_perimeter_expand.sql
-- PERIMETER LOCKDOWN, stage S1 (EXPAND). Additive: nothing that works today is switched off here.
--
-- S1 adds what the locked-down system needs, so the apps can move to it BEFORE the open doors are shut (S2 functions, S3 row
-- policies, S4 storage):
--   1. Policy helper functions (rls_*). Row policies that look at ANOTHER table must go through SECURITY DEFINER helpers, otherwise
--      the second table's own policies apply to the caller and two tables can end up in an infinite policy recursion.
--   2. New RPCs that replace direct table reads the lockdown removes:
--        list_accredited_todas()            the public TODA directory (registration picker, dispatch priority TODA); no documents
--        find_candidate_drivers(booking)    who the passenger's dispatcher may offer a booking to (driver id + rounded distance only)
--        get_booking_counterparties(ids)    the other party of a booking (name; phone only while the trip is live)
--        get_assigned_driver_details(id)    REWRITTEN: caller must be the booking's passenger (or staff); live position only while live
--        get_my_toda_affiliations()         the driver's own affiliations with each TODA's display fields (name, status, expiry)
--        register_toda_with_admin(...)      REWRITTEN: same signature, identity is auth.uid() (the p_auth_user_id parameter can no longer
--                                           name somebody else), one administrator account administers one TODA
--   3. Guards that make an own-row insert / update unable to grant itself authority:
--        passenger / driver / driver_verification INSERT   a registrant can only create a Pending record (status, counters, reviewer fields)
--        booking INSERT / UPDATE                            passenger_id is fixed, driver_id may only go from NULL to the caller's own id
--        toda_admin, lgu_admin UPDATE                       cannot re-point their own TODA, account or status
--        toda UPDATE                                        a TODA administrator cannot mark their own TODA accredited (account_status)
--        audit_log INSERT                                   the actor columns are stamped from the signed-in user (they cannot be forged)
--   4. protect_read_only_columns(): the driver_verification branch compared two columns that do not exist, so EVERY update of a driver's
--      own verification row failed with a "record new has no field" error. It now checks the real decision columns. (The
--      Pending -> Active passenger carve-out is removed in S3, together with the client change that stops relying on it.)
--
-- "Trusted" callers of the guards: the service role (the Express server), policy-engine functions (internal context), and a DIRECT
-- database session (the owner running a migration, a data fix or the SQL editor), see is_trusted_session().
--
-- Forward-only. Safe to run twice. Every new function has its privileges set explicitly (no PUBLIC, no anon unless stated).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. WHO THE GUARDS LET THROUGH UNCHANGED
-- ----------------------------------------------------------------------------
-- The service role, policy-engine functions, and a direct database session. A direct session never goes through the API's role switch,
-- so its `role` setting is 'none'; every request that arrives through the API runs as anon / authenticated / service_role (the role
-- setting is read as well as the JWT claim, so the service role is recognised even if the claim cannot be parsed).
CREATE OR REPLACE FUNCTION public.is_trusted_session()
RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(public.is_service_context(), FALSE)
        OR COALESCE(NULLIF(current_setting('role', true), ''), 'none') IN ('none', 'service_role');
$$;

-- ----------------------------------------------------------------------------
-- 1. POLICY HELPERS (SECURITY DEFINER: they read the other table without that table's row policies)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rls_booking_is_mine(p_booking_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.booking b
         WHERE b.booking_id = p_booking_id
           AND b.passenger_id IS NOT NULL
           AND b.passenger_id = public.get_current_passenger_id()
    );
$$;

CREATE OR REPLACE FUNCTION public.rls_booking_open_and_mine(p_booking_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.booking b
         WHERE b.booking_id = p_booking_id
           AND b.passenger_id IS NOT NULL
           AND b.passenger_id = public.get_current_passenger_id()
           AND b.booking_status IN ('Pending', 'Searching Driver')
    );
$$;

CREATE OR REPLACE FUNCTION public.rls_booking_assigned_to_me(p_booking_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.booking b
         WHERE b.booking_id = p_booking_id
           AND b.driver_id IS NOT NULL
           AND b.driver_id = public.get_current_driver_id()
    );
$$;

-- The caller is a driver who has been offered this booking and has not answered yet.
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
    );
$$;

-- The caller may take this booking: it is still open, nobody has it, and the caller holds a pending offer for it.
CREATE OR REPLACE FUNCTION public.rls_driver_can_claim_booking(p_booking_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.booking b
         WHERE b.booking_id = p_booking_id
           AND b.driver_id IS NULL
           AND b.booking_status IN ('Pending', 'Searching Driver')
    ) AND public.rls_driver_has_pending_offer(p_booking_id);
$$;

-- The caller administers a TODA that this booking belongs to (its toda_id, or its driver's TODA).
CREATE OR REPLACE FUNCTION public.rls_booking_in_my_toda(p_booking_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT COALESCE((
        SELECT public.get_current_toda_admin_toda_id() IS NOT NULL
           AND (b.toda_id = public.get_current_toda_admin_toda_id()
                OR d.toda_id = public.get_current_toda_admin_toda_id())
          FROM public.booking b
          LEFT JOIN public.driver d ON d.driver_id = b.driver_id
         WHERE b.booking_id = p_booking_id
    ), FALSE);
$$;

-- Anyone who legitimately sees a booking: its passenger, its driver, a staff member of its TODA, or the LGU.
CREATE OR REPLACE FUNCTION public.rls_booking_visible(p_booking_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT public.rls_booking_is_mine(p_booking_id)
        OR public.rls_booking_assigned_to_me(p_booking_id)
        OR public.rls_booking_in_my_toda(p_booking_id)
        OR COALESCE(public.is_lgu_admin(), FALSE);
$$;

-- ----------------------------------------------------------------------------
-- 2. RPCs
-- ----------------------------------------------------------------------------

-- 2.1 The public directory of accredited TODAs. Same visibility the old anonymous policy gave (Active), without the document
--     links, certificate data or officer details that sit in the same table.
CREATE OR REPLACE FUNCTION public.list_accredited_todas()
RETURNS TABLE (
    toda_id UUID,
    toda_name TEXT,
    toda_acronym TEXT,
    barangay TEXT,
    service_coverage_area TEXT,
    terminal_latitude DOUBLE PRECISION,
    terminal_longitude DOUBLE PRECISION
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT t.toda_id, t.toda_name::TEXT, t.toda_acronym::TEXT, t.barangay::TEXT, t.service_coverage_area::TEXT,
           t.terminal_latitude, t.terminal_longitude
      FROM public.toda t
     WHERE t.account_status = 'Active' OR t.toda_status = 'Active'
     ORDER BY t.toda_name;
$$;

-- 2.2 Candidate drivers for the passenger's dispatcher (Batch 6 replaces the passenger-driven dispatch with a server-side one).
--     Only the passenger of an OPEN booking may ask, distance is measured from THAT booking's pickup point, drivers that already
--     received an offer for it are left out, and only an id, a TODA and a rounded distance come back.
CREATE OR REPLACE FUNCTION public.find_candidate_drivers(
    p_booking_id UUID,
    p_max_km DOUBLE PRECISION DEFAULT 100,
    p_limit INTEGER DEFAULT 25
)
RETURNS TABLE (driver_id UUID, toda_id UUID, distance_km DOUBLE PRECISION)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_b public.booking;
    v_me UUID := public.get_current_passenger_id();
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'ERR_NOT_A_PASSENGER: Only a registered passenger can look for a driver.' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_b FROM public.booking b WHERE b.booking_id = p_booking_id;
    IF NOT FOUND OR v_b.passenger_id IS DISTINCT FROM v_me THEN
        RAISE EXCEPTION 'ERR_NOT_YOUR_BOOKING: This booking does not belong to you.' USING ERRCODE = '42501';
    END IF;
    IF v_b.booking_status NOT IN ('Pending', 'Searching Driver') THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT d.driver_id,
           d.toda_id,
           round(x.dist::NUMERIC, 1)::DOUBLE PRECISION
      FROM public.driver d
     CROSS JOIN LATERAL (
            SELECT public.calculate_haversine_distance_km(
                       v_b.pickup_latitude, v_b.pickup_longitude, d.current_latitude, d.current_longitude) AS dist
     ) x
     WHERE d.availability_status = 'Available'
       AND d.account_status = 'Verified'
       AND NOT EXISTS (SELECT 1 FROM public.dispatch_attempt a
                        WHERE a.booking_id = p_booking_id AND a.driver_id = d.driver_id)
       AND (x.dist IS NULL OR x.dist <= COALESCE(p_max_km, 100))
     ORDER BY x.dist NULLS LAST, d.driver_id
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50);
END;
$$;

-- 2.3 The other party of one or more bookings.
--     passenger of the booking   -> the driver (name, vehicle, TODA; phone while the trip is live)
--     driver of the booking      -> the passenger (name always; phone while the trip is live)
--     driver holding an offer    -> the passenger's name only until the offer is accepted
--     TODA admin of the booking  -> both parties, with phones (they handle incidents)       LGU admin -> everything
CREATE OR REPLACE FUNCTION public.get_booking_counterparties(p_booking_ids UUID[])
RETURNS TABLE (
    booking_id UUID,
    passenger_id UUID,
    passenger_name TEXT,
    passenger_phone TEXT,
    driver_id UUID,
    driver_name TEXT,
    driver_phone TEXT,
    plate_number TEXT,
    franchise_number TEXT,
    toda_name TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_pax UUID := public.get_current_passenger_id();
    v_drv UUID := public.get_current_driver_id();
    v_toda UUID := public.get_current_toda_admin_toda_id();
    v_lgu BOOLEAN := COALESCE(public.is_lgu_admin(), FALSE);
BEGIN
    IF p_booking_ids IS NULL OR cardinality(p_booking_ids) = 0 THEN
        RETURN;
    END IF;
    IF cardinality(p_booking_ids) > 200 THEN
        RAISE EXCEPTION 'ERR_TOO_MANY_BOOKINGS: Ask for at most 200 bookings at a time.' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT f.booking_id,
           f.passenger_id,
           CASE WHEN f.sees_passenger THEN f.p_name END,
           CASE WHEN f.sees_passenger_phone THEN f.p_phone END,
           CASE WHEN f.sees_driver THEN f.driver_id END,
           CASE WHEN f.sees_driver THEN f.d_name END,
           CASE WHEN f.sees_driver_phone THEN f.d_phone END,
           CASE WHEN f.sees_driver THEN f.d_plate END,
           CASE WHEN f.sees_driver THEN f.d_franchise END,
           CASE WHEN f.sees_driver THEN f.t_name END
      FROM (
        SELECT g.booking_id, g.passenger_id, g.driver_id, g.p_name, g.p_phone, g.d_name, g.d_phone, g.d_plate, g.d_franchise, g.t_name,
               (g.is_staff OR g.is_pax OR g.is_drv OR g.has_offer) AS sees_passenger,
               (g.is_staff OR g.is_pax OR (g.is_drv AND g.live)) AS sees_passenger_phone,
               (g.driver_id IS NOT NULL AND (g.is_staff OR g.is_pax OR g.is_drv)) AS sees_driver,
               (g.driver_id IS NOT NULL AND (g.is_staff OR g.is_drv OR (g.is_pax AND g.live))) AS sees_driver_phone
          FROM (
            SELECT b.booking_id,
                   b.passenger_id,
                   b.driver_id,
                   p.full_name::TEXT AS p_name,
                   p.contact_number::TEXT AS p_phone,
                   d.full_name::TEXT AS d_name,
                   d.contact_number::TEXT AS d_phone,
                   d.plate_number::TEXT AS d_plate,
                   d.franchise_number::TEXT AS d_franchise,
                   t.toda_name::TEXT AS t_name,
                   (v_lgu OR (v_toda IS NOT NULL AND (b.toda_id = v_toda OR d.toda_id = v_toda))) AS is_staff,
                   (v_pax IS NOT NULL AND b.passenger_id = v_pax) AS is_pax,
                   (v_drv IS NOT NULL AND b.driver_id = v_drv) AS is_drv,
                   (v_drv IS NOT NULL AND b.driver_id IS NULL AND public.rls_driver_has_pending_offer(b.booking_id)) AS has_offer,
                   public._booking_is_open_accepted(b.booking_status::TEXT) AS live
              FROM unnest(p_booking_ids) AS ids(id)
              JOIN public.booking b ON b.booking_id = ids.id
              LEFT JOIN public.passenger p ON p.passenger_id = b.passenger_id
              LEFT JOIN public.driver d ON d.driver_id = b.driver_id
              LEFT JOIN public.toda t ON t.toda_id = d.toda_id
          ) g
      ) f
     WHERE f.sees_passenger OR f.sees_driver;
END;
$$;

-- 2.4 The driver assigned to the caller's booking. REWRITTEN. It used to answer for any booking id from anyone, including the
--     driver's live coordinates. The return type changes, so the old function is dropped first.
DROP FUNCTION IF EXISTS public.get_assigned_driver_details(UUID);
CREATE FUNCTION public.get_assigned_driver_details(p_booking_id UUID)
RETURNS TABLE (
    driver_id UUID,
    full_name TEXT,
    contact_number TEXT,
    franchise_number TEXT,
    plate_number TEXT,
    toda_name TEXT,
    weighted_average_rating NUMERIC,
    current_latitude DOUBLE PRECISION,
    current_longitude DOUBLE PRECISION,
    last_location_update TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_b public.booking;
    v_pax UUID := public.get_current_passenger_id();
    v_ok BOOLEAN;
    v_live BOOLEAN;
BEGIN
    SELECT * INTO v_b FROM public.booking b WHERE b.booking_id = p_booking_id;
    IF NOT FOUND OR v_b.driver_id IS NULL THEN
        RETURN;
    END IF;
    v_ok := (v_pax IS NOT NULL AND v_b.passenger_id = v_pax)
         OR COALESCE(public.is_lgu_admin(), FALSE)
         OR public.rls_booking_in_my_toda(p_booking_id);
    IF NOT v_ok THEN
        RETURN;                                   -- not your booking: an empty answer, nothing to learn
    END IF;
    -- The driver's position is shared only while the trip is live; afterwards the passenger keeps the name and vehicle only.
    v_live := public._booking_is_open_accepted(v_b.booking_status::TEXT);

    RETURN QUERY
    SELECT d.driver_id,
           d.full_name::TEXT,
           d.contact_number::TEXT,
           d.franchise_number::TEXT,
           d.plate_number::TEXT,
           t.toda_name::TEXT,
           d.weighted_average_rating,
           CASE WHEN v_live THEN d.current_latitude END,
           CASE WHEN v_live THEN d.current_longitude END,
           CASE WHEN v_live THEN d.last_location_update END
      FROM public.driver d
      LEFT JOIN public.toda t ON t.toda_id = d.toda_id
     WHERE d.driver_id = v_b.driver_id;
END;
$$;

-- 2.4b The signed-in driver's OWN TODA affiliations, each with the display fields of its TODA. The affiliation picker needs the name,
--      acronym, status and accreditation expiry of the TODAs the driver belongs to, but the toda table itself (documents, officer
--      details) is not readable by drivers any more, so the embed `toda:toda_id(...)` the picker used to make would come back empty
--      and every affiliation would look "inactive". Only the caller's own rows come back, and only these fields.
CREATE OR REPLACE FUNCTION public.get_my_toda_affiliations()
RETURNS TABLE (
    affiliation_id UUID,
    toda_id UUID,
    toda_endorsement_status TEXT,
    lgu_verification_status TEXT,
    is_active_selection BOOLEAN,
    submitted_at TIMESTAMPTZ,
    toda_name TEXT,
    toda_acronym TEXT,
    toda_status TEXT,
    certificate_expiry TIMESTAMPTZ,
    service_coverage_area TEXT,
    barangay TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT a.affiliation_id, a.toda_id, a.toda_endorsement_status::TEXT, a.lgu_verification_status::TEXT,
           a.is_active_selection, a.submitted_at,
           t.toda_name::TEXT, t.toda_acronym::TEXT, t.toda_status::TEXT, t.certificate_expiry,
           t.service_coverage_area::TEXT, t.barangay::TEXT
      FROM public.driver_toda_affiliation a
      JOIN public.toda t ON t.toda_id = a.toda_id
     WHERE a.driver_id = public.get_current_driver_id()
     ORDER BY a.submitted_at;
$$;

-- 2.5 TODA registration. SAME SIGNATURE (existing callers keep working), new rules:
--       * the caller must be signed in, and p_auth_user_id (kept for compatibility) may only be null or the caller's own id
--       * a user who already administers a TODA cannot register another and is never re-pointed at a new one
--       * the audit entry carries the caller
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
-- 3. GUARDS
-- ----------------------------------------------------------------------------

-- 3.1 A registrant creates only a Pending passenger (the server activates it after the code is verified).
CREATE OR REPLACE FUNCTION public.passenger_insert_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    IF public.is_trusted_session() OR COALESCE(public.is_lgu_admin(), FALSE) THEN
        RETURN NEW;
    END IF;
    IF NEW.account_status IS DISTINCT FROM 'Pending OTP Verification' THEN
        RAISE EXCEPTION 'ERR_PASSENGER_PENDING_ONLY: A new passenger account always starts as Pending OTP Verification; the server activates it after the code is verified.'
            USING ERRCODE = '42501';
    END IF;
    NEW.strikes_count := 0;
    NEW.suspension_reason := NULL;  NEW.suspended_at := NULL;  NEW.suspended_until := NULL;
    NEW.suspension_kind := NULL;  NEW.suspension_trigger_strike_id := NULL;  NEW.suspension_threshold := NULL;
    NEW.deactivated_at := NULL;  NEW.closed_at := NULL;
    NEW.failed_otp_attempts := 0;  NEW.last_otp_failed_at := NULL;
    NEW.otp_last_sent_at := NULL;  NEW.otp_daily_count := 0;  NEW.otp_daily_reset_at := NULL;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_passenger_insert_guard ON public.passenger;
CREATE TRIGGER trigger_passenger_insert_guard BEFORE INSERT ON public.passenger
    FOR EACH ROW EXECUTE FUNCTION public.passenger_insert_guard();

-- 3.2 A registrant creates only a Pending, Offline, unrated, unreviewed driver.
CREATE OR REPLACE FUNCTION public.driver_insert_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    IF public.is_trusted_session() OR COALESCE(public.is_lgu_admin(), FALSE) THEN
        RETURN NEW;
    END IF;
    IF NEW.account_status IS DISTINCT FROM 'Pending Verification' THEN
        RAISE EXCEPTION 'ERR_DRIVER_PENDING_ONLY: A new driver account always starts as Pending Verification; only the LGU Administrator verifies it.'
            USING ERRCODE = '42501';
    END IF;
    NEW.availability_status := 'Offline';
    NEW.weighted_average_rating := 4.00;
    NEW.strikes_count := 0;
    NEW.suspension_reason := NULL;  NEW.suspended_at := NULL;  NEW.suspended_until := NULL;
    NEW.suspension_kind := NULL;  NEW.suspension_trigger_strike_id := NULL;  NEW.suspension_threshold := NULL;
    NEW.deactivated_at := NULL;  NEW.closed_at := NULL;
    NEW.is_permanently_disqualified := FALSE;  NEW.disqualification_reason := NULL;
    NEW.disqualified_at := NULL;  NEW.disqualified_by := NULL;
    NEW.rejection_reason := NULL;  NEW.rejection_comment := NULL;  NEW.rejected_by := NULL;  NEW.rejected_at := NULL;
    NEW.endorsed_at := NULL;  NEW.lgu_approved_at := NULL;
    NEW.current_latitude := NULL;  NEW.current_longitude := NULL;
    NEW.last_location_update := NULL;  NEW.last_location_accuracy_m := NULL;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_driver_insert_guard ON public.driver;
CREATE TRIGGER trigger_driver_insert_guard BEFORE INSERT ON public.driver
    FOR EACH ROW EXECUTE FUNCTION public.driver_insert_guard();

-- 3.3 A driver submits documents; the decision columns of a verification are the reviewers' (TODA admin of that driver, LGU).
CREATE OR REPLACE FUNCTION public.driver_verification_insert_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    IF public.is_trusted_session()
       OR COALESCE(public.is_lgu_admin(), FALSE)
       OR COALESCE(public.is_toda_admin_for_driver(NEW.driver_id), FALSE) THEN
        RETURN NEW;
    END IF;
    NEW.verification_status := 'Pending';
    NEW.reviewed_by := NULL;  NEW.reviewed_by_lgu := NULL;  NEW.reviewed_at := NULL;
    NEW.rejection_reason := NULL;  NEW.rejection_comment := NULL;  NEW.rejected_by := NULL;  NEW.rejected_at := NULL;
    NEW.endorsed_at := NULL;  NEW.lgu_approved_at := NULL;
    NEW.renewal_status := NULL;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_driver_verification_insert_guard ON public.driver_verification;
CREATE TRIGGER trigger_driver_verification_insert_guard BEFORE INSERT ON public.driver_verification
    FOR EACH ROW EXECUTE FUNCTION public.driver_verification_insert_guard();

-- 3.4 A booking belongs to its passenger for life; a driver can only attach THEMSELVES to a booking nobody has yet.
--     (Fare columns are guarded by the Batch 5 triggers; this adds identity and the state a new booking may start in.)
CREATE OR REPLACE FUNCTION public.booking_identity_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_me_driver UUID;
BEGIN
    IF public.is_trusted_session() OR COALESCE(public.is_lgu_admin(), FALSE) THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        NEW.accepted_at := NULL;  NEW.arrived_at := NULL;  NEW.trip_started_at := NULL;  NEW.trip_completed_at := NULL;
        NEW.cancelled_at := NULL;  NEW.cancelled_by := NULL;  NEW.cancellation_reason := NULL;
        NEW.shared_trip_match_id := NULL;
        RETURN NEW;
    END IF;

    IF NEW.passenger_id IS DISTINCT FROM OLD.passenger_id THEN
        RAISE EXCEPTION 'ERR_BOOKING_OWNER_LOCKED: The passenger of a booking cannot be changed.' USING ERRCODE = '42501';
    END IF;
    IF NEW.toda_id IS DISTINCT FROM OLD.toda_id THEN
        RAISE EXCEPTION 'ERR_BOOKING_TODA_LOCKED: The TODA of a booking cannot be changed by the people on it.' USING ERRCODE = '42501';
    END IF;
    IF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
        v_me_driver := public.get_current_driver_id();
        IF NOT (OLD.driver_id IS NULL AND NEW.driver_id IS NOT NULL AND v_me_driver IS NOT NULL AND NEW.driver_id = v_me_driver) THEN
            RAISE EXCEPTION 'ERR_BOOKING_DRIVER_LOCKED: A driver can only take an unassigned booking for themselves.' USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_booking_identity_guard ON public.booking;
CREATE TRIGGER trigger_booking_identity_guard BEFORE INSERT OR UPDATE ON public.booking
    FOR EACH ROW EXECUTE FUNCTION public.booking_identity_guard();

-- 3.5 TODA administrators and LGU administrators cannot move or reinstate themselves with an update of their own row.
CREATE OR REPLACE FUNCTION public.toda_admin_protect_columns()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    IF public.is_trusted_session() OR COALESCE(public.is_lgu_admin(), FALSE) THEN
        RETURN NEW;
    END IF;
    IF NEW.admin_id IS DISTINCT FROM OLD.admin_id
       OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
       OR NEW.toda_id IS DISTINCT FROM OLD.toda_id
       OR NEW.account_status IS DISTINCT FROM OLD.account_status THEN
        RAISE EXCEPTION 'Access Denied: A TODA administrator cannot change their own account, TODA or status; the LGU Administrator does that.'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_toda_admin_protect_columns ON public.toda_admin;
CREATE TRIGGER trigger_toda_admin_protect_columns BEFORE UPDATE ON public.toda_admin
    FOR EACH ROW EXECUTE FUNCTION public.toda_admin_protect_columns();

CREATE OR REPLACE FUNCTION public.lgu_admin_protect_columns()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    IF public.is_trusted_session() THEN
        RETURN NEW;
    END IF;
    IF NEW.admin_id IS DISTINCT FROM OLD.admin_id OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id THEN
        RAISE EXCEPTION 'Access Denied: An administrator account cannot be re-pointed at another login.' USING ERRCODE = '42501';
    END IF;
    -- Own row: no self-service status change (a Suspended administrator must not be able to reinstate themselves).
    IF OLD.auth_user_id = auth.uid() AND NEW.account_status IS DISTINCT FROM OLD.account_status THEN
        RAISE EXCEPTION 'Access Denied: An administrator cannot change the status of their own account.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_lgu_admin_protect_columns ON public.lgu_admin;
CREATE TRIGGER trigger_lgu_admin_protect_columns BEFORE UPDATE ON public.lgu_admin
    FOR EACH ROW EXECUTE FUNCTION public.lgu_admin_protect_columns();

-- 3.6 toda: also protect account_status (the directory and several screens treat account_status = 'Active' as accredited) and the
--     certificate number. Same trusted callers as before; the trusted-caller test is the NULL-safe helper.
CREATE OR REPLACE FUNCTION public.protect_toda_read_only_columns()
RETURNS TRIGGER AS $$
BEGIN
    IF COALESCE(public.is_lgu_admin(), FALSE)
       OR COALESCE(public.is_service_context(), FALSE) THEN
        RETURN NEW;
    END IF;

    IF NEW.terminal_latitude IS DISTINCT FROM OLD.terminal_latitude
       OR NEW.terminal_longitude IS DISTINCT FROM OLD.terminal_longitude
       OR NEW.certificate_expiry IS DISTINCT FROM OLD.certificate_expiry
       OR NEW.certificate_number IS DISTINCT FROM OLD.certificate_number
       OR NEW.account_status IS DISTINCT FROM OLD.account_status
       OR NEW.toda_status IS DISTINCT FROM OLD.toda_status THEN
        RAISE EXCEPTION 'Access Denied: Terminal coordinates, certificate data, and TODA status can only be modified by LGU Administrators or through authorized RPCs.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3.7 audit_log: the actor is whoever is signed in, not what the browser says.
CREATE OR REPLACE FUNCTION public.audit_log_stamp_actor()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_lgu UUID;
    v_toda UUID;
BEGIN
    IF COALESCE(public.is_service_context(), FALSE) OR v_uid IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT l.admin_id INTO v_lgu FROM public.lgu_admin l WHERE l.auth_user_id = v_uid AND l.account_status = 'Active' LIMIT 1;
    SELECT t.admin_id INTO v_toda FROM public.toda_admin t WHERE t.auth_user_id = v_uid AND t.account_status = 'Active' LIMIT 1;
    NEW.actor_id := v_uid;
    NEW.actor_role := CASE WHEN v_lgu IS NOT NULL THEN 'lgu_admin' WHEN v_toda IS NOT NULL THEN 'toda_admin' ELSE 'user' END;
    NEW.lgu_admin_id := v_lgu;
    NEW.toda_admin_id := v_toda;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_audit_log_stamp_actor ON public.audit_log;
CREATE TRIGGER trigger_audit_log_stamp_actor BEFORE INSERT ON public.audit_log
    FOR EACH ROW EXECUTE FUNCTION public.audit_log_stamp_actor();

-- ----------------------------------------------------------------------------
-- 4. protect_read_only_columns(): fix the driver_verification branch (S1) - everything else is the 20261007000004 text
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_read_only_columns()
RETURNS TRIGGER AS $$
DECLARE
    v_role TEXT;
    v_claims JSONB;
BEGIN
    BEGIN
        v_role := auth.role();
    EXCEPTION WHEN OTHERS THEN
        v_role := NULL;
    END;
    IF v_role IS NULL THEN
        BEGIN
            v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::JSONB;
            v_role := v_claims->>'role';
        EXCEPTION WHEN OTHERS THEN
            v_role := current_setting('request.jwt.claim.role', true);
        END;
    END IF;

    -- Batch 3: strike / suspension / deactivation state is engine-only.
    IF TG_TABLE_NAME IN ('passenger', 'driver') THEN
        IF NOT COALESCE(public.is_service_context(), FALSE) THEN
            IF NEW.strikes_count IS DISTINCT FROM OLD.strikes_count
               OR NEW.suspended_until IS DISTINCT FROM OLD.suspended_until
               OR NEW.suspension_kind IS DISTINCT FROM OLD.suspension_kind
               OR NEW.suspension_reason IS DISTINCT FROM OLD.suspension_reason
               OR NEW.suspended_at IS DISTINCT FROM OLD.suspended_at
               OR NEW.suspension_trigger_strike_id IS DISTINCT FROM OLD.suspension_trigger_strike_id
               OR NEW.suspension_threshold IS DISTINCT FROM OLD.suspension_threshold
               OR NEW.deactivated_at IS DISTINCT FROM OLD.deactivated_at
               OR NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
                RAISE EXCEPTION 'Access Denied: Strike, suspension and deactivation state can only be changed by the policy engine.';
            END IF;
        END IF;
    END IF;

    IF v_role = 'service_role'
       OR current_setting('sakay.internal_context', true) = 'true'
       OR public.is_lgu_admin() THEN
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'passenger' THEN
        IF OLD.account_status = 'Pending OTP Verification' AND NEW.account_status = 'Active' THEN
            RETURN NEW;
        END IF;
        IF NEW.account_status IS DISTINCT FROM OLD.account_status THEN
            RAISE EXCEPTION 'Access Denied: Passengers cannot modify their own account_status.';
        END IF;
    END IF;

    IF TG_TABLE_NAME = 'driver' THEN
        IF NEW.account_status IS DISTINCT FROM OLD.account_status THEN
            RAISE EXCEPTION 'Access Denied: Only LGU Administrators can modify driver account_status.';
        END IF;

        IF NEW.license_expiry IS DISTINCT FROM OLD.license_expiry OR NEW.mtop_expiry IS DISTINCT FROM OLD.mtop_expiry THEN
            RAISE EXCEPTION 'Access Denied: Expiry dates can only be updated by LGU Administrators upon verified renewal.';
        END IF;

        IF NEW.toda_id IS DISTINCT FROM OLD.toda_id THEN
            RAISE EXCEPTION 'Access Denied: Active TODA affiliation must be selected through select_active_driver_affiliation RPC.';
        END IF;

        IF NEW.weighted_average_rating IS DISTINCT FROM OLD.weighted_average_rating THEN
            RAISE EXCEPTION 'Access Denied: Cannot modify weighted_average_rating.';
        END IF;

        IF NEW.is_permanently_disqualified IS DISTINCT FROM OLD.is_permanently_disqualified THEN
            RAISE EXCEPTION 'Access Denied: Only LGU Administrators can permanently disqualify drivers.';
        END IF;
    END IF;

    IF TG_TABLE_NAME = 'driver_verification' THEN
        IF EXISTS (
            SELECT 1 FROM public.driver d
            WHERE d.driver_id = OLD.driver_id
            AND d.auth_user_id = (SELECT auth.uid())
        ) THEN
            -- S1 fix: the old branch compared two columns that do not exist in this table, so every update of a driver's own
            -- verification row failed with a 'record new has no field' error. These are the real decision columns.
            IF NEW.verification_status IS DISTINCT FROM OLD.verification_status
               OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
               OR NEW.reviewed_by_lgu IS DISTINCT FROM OLD.reviewed_by_lgu
               OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
               OR NEW.endorsed_at IS DISTINCT FROM OLD.endorsed_at
               OR NEW.lgu_approved_at IS DISTINCT FROM OLD.lgu_approved_at
               OR NEW.rejected_by IS DISTINCT FROM OLD.rejected_by
               OR NEW.rejected_at IS DISTINCT FROM OLD.rejected_at
               OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
               OR NEW.rejection_comment IS DISTINCT FROM OLD.rejection_comment THEN
                RAISE EXCEPTION 'Access Denied: Drivers cannot modify verification status.';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 5. PRIVILEGES (explicit: nothing here is granted by default)
-- ----------------------------------------------------------------------------
-- policy helpers: executed by the querying role while a policy is evaluated, so authenticated needs EXECUTE; nobody else does
REVOKE ALL ON FUNCTION public.rls_booking_is_mine(UUID),
                       public.rls_booking_open_and_mine(UUID),
                       public.rls_booking_assigned_to_me(UUID),
                       public.rls_driver_has_pending_offer(UUID),
                       public.rls_driver_can_claim_booking(UUID),
                       public.rls_booking_in_my_toda(UUID),
                       public.rls_booking_visible(UUID)
       FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rls_booking_is_mine(UUID),
                          public.rls_booking_open_and_mine(UUID),
                          public.rls_booking_assigned_to_me(UUID),
                          public.rls_driver_has_pending_offer(UUID),
                          public.rls_driver_can_claim_booking(UUID),
                          public.rls_booking_in_my_toda(UUID),
                          public.rls_booking_visible(UUID)
       TO authenticated, service_role;

-- the one function an unauthenticated visitor may call: the directory of accredited TODAs
REVOKE ALL ON FUNCTION public.list_accredited_todas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_accredited_todas() TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.find_candidate_drivers(UUID, DOUBLE PRECISION, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_candidate_drivers(UUID, DOUBLE PRECISION, INTEGER) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_booking_counterparties(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_booking_counterparties(UUID[]) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_assigned_driver_details(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_assigned_driver_details(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_my_toda_affiliations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_toda_affiliations() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.register_toda_with_admin(VARCHAR, VARCHAR, VARCHAR, DATE, INTEGER, INTEGER, DOUBLE PRECISION, DOUBLE PRECISION, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR, TEXT, TEXT, UUID)
       FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_toda_with_admin(VARCHAR, VARCHAR, VARCHAR, DATE, INTEGER, INTEGER, DOUBLE PRECISION, DOUBLE PRECISION, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR, TEXT, TEXT, UUID)
       TO authenticated, service_role;

-- guards are trigger functions (and their helper): no client may call them
REVOKE ALL ON FUNCTION public.is_trusted_session(),
                       public.passenger_insert_guard(), public.driver_insert_guard(), public.driver_verification_insert_guard(),
                       public.booking_identity_guard(), public.toda_admin_protect_columns(), public.lgu_admin_protect_columns(),
                       public.audit_log_stamp_actor()
       FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. SELF-CHECK
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF has_function_privilege('anon', 'public.find_candidate_drivers(uuid, double precision, integer)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.get_booking_counterparties(uuid[])', 'EXECUTE')
       OR has_function_privilege('anon', 'public.get_assigned_driver_details(uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.get_my_toda_affiliations()', 'EXECUTE')
       OR has_function_privilege('anon', 'public.rls_booking_is_mine(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'a new function is executable by anon';
    END IF;
    IF NOT has_function_privilege('anon', 'public.list_accredited_todas()', 'EXECUTE') THEN
        RAISE EXCEPTION 'list_accredited_todas() must stay callable by anon (registration picker)';
    END IF;
    IF position('stage2_reviewed' IN regexp_replace(pg_get_functiondef('public.protect_read_only_columns()'::regprocedure), '--[^\n]*', '', 'g')) > 0 THEN
        RAISE EXCEPTION 'protect_read_only_columns() still references the missing stage2 columns';
    END IF;
END $$;
