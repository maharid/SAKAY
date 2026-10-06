-- ============================================================================
-- Migration: 20261014000002_solo_trip_hardening.sql
-- Found by replaying a whole solo trip (scripts/db-tests/e2e/solo-trip.js) exactly as the apps do it, as each signed-in user:
--
--   1. A driver who already had a trip was still OFFERED new bookings and could accept a second one (nothing ever sets a driver Busy
--      and find_candidate_drivers() only looked at "Available"). A driver is now excluded from the candidates, an offer cannot be inserted
--      for them, and a second booking cannot be attached to them, while they hold an open accepted booking.
--   2. The passenger app rates the driver with an upsert on (booking_id, rater_role), but no such unique rule existed, so the
--      database refused every passenger rating (the app only logged a warning). The rule now exists (one rating per rater per trip), and
--      a rating can only be written by a party of a finished trip, as themselves, about the other party.
--   3. A booking never got its TODA when a driver accepted it (toda_id stayed empty), so the policies that let a TODA administrator read
--      the ratings of their trips (they look at booking.toda_id) saw nothing. The TODA is now stamped when the driver takes the booking:
--      the TODA the driver is Online for, else the driver's TODA.
--   4. "Retry search" after No Driver Found could never reach the same driver again: it asked to DELETE the old offers (a passenger
--      cannot) and the candidate search skipped every driver ever offered this booking. A new search round now starts through
--      retry_driver_search(): offers of earlier rounds no longer exclude anyone, and old unanswered offers are closed.
-- Forward-only. Safe to run twice.
-- ============================================================================

ALTER TABLE public.booking ADD COLUMN IF NOT EXISTS search_restarted_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------- 1. one trip at a time
CREATE OR REPLACE FUNCTION public.find_candidate_drivers(p_booking_id UUID, p_max_km DOUBLE PRECISION DEFAULT 100, p_limit INTEGER DEFAULT 25)
RETURNS TABLE (driver_id UUID, toda_id UUID, distance_km DOUBLE PRECISION)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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
       AND (d.bookings_paused_until IS NULL OR d.bookings_paused_until <= CURRENT_TIMESTAMP)
       AND NOT public.driver_has_open_accepted_booking(d.driver_id)
       -- only offers of the CURRENT search round exclude a driver (a retry starts a new round)
       AND NOT EXISTS (SELECT 1 FROM public.dispatch_attempt a
                        WHERE a.booking_id = p_booking_id AND a.driver_id = d.driver_id
                          AND a.notification_sent_at >= COALESCE(v_b.search_restarted_at, v_b.created_at))
       AND (x.dist IS NULL OR x.dist <= COALESCE(p_max_km, 100))
     ORDER BY x.dist NULLS LAST, d.driver_id
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50);
END;
$$;

-- Starts a new search round for the passenger's own booking that found nobody (or is still searching)
CREATE OR REPLACE FUNCTION public.retry_driver_search(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_me UUID := public.get_current_passenger_id();
    v_b  public.booking;
BEGIN
    IF v_me IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_A_PASSENGER', 'error', 'Only a passenger can search for a driver.');
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id AND passenger_id = v_me FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_YOUR_BOOKING', 'error', 'This booking does not belong to you.');
    END IF;
    IF v_b.booking_status NOT IN ('No Driver Found', 'Pending', 'Searching Driver') THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_SEARCHING', 'error', 'This booking is no longer looking for a driver.');
    END IF;

    -- offers nobody answered in the earlier round are closed so a driver does not see a stale request
    UPDATE public.dispatch_attempt
       SET response_status = 'Expired', responded_at = COALESCE(responded_at, CURRENT_TIMESTAMP)
     WHERE booking_id = p_booking_id AND response_status = 'Pending';

    UPDATE public.booking
       SET booking_status = 'Pending', search_restarted_at = CURRENT_TIMESTAMP
     WHERE booking_id = p_booking_id;

    RETURN jsonb_build_object('success', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.retry_driver_search(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_driver_search(UUID) TO authenticated, service_role;

-- an offer cannot be inserted for a driver who is on a trip (the dispatcher skips a failed offer and tries the next driver)
CREATE OR REPLACE FUNCTION public.block_offer_to_busy_driver()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF public.driver_has_open_accepted_booking(NEW.driver_id) THEN
        RAISE EXCEPTION 'ERR_DRIVER_BUSY: This driver is already on a trip.' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_block_offer_to_busy_driver ON public.dispatch_attempt;
CREATE TRIGGER trigger_block_offer_to_busy_driver
    BEFORE INSERT ON public.dispatch_attempt
    FOR EACH ROW EXECUTE FUNCTION public.block_offer_to_busy_driver();

-- a second booking cannot be attached to a driver who has an open one (applies to everybody, the server included)
CREATE OR REPLACE FUNCTION public.block_driver_double_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.driver_id IS NULL AND NEW.driver_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.booking b
                    WHERE b.driver_id = NEW.driver_id AND b.booking_id <> NEW.booking_id
                      AND public._booking_is_open_accepted(b.booking_status)) THEN
        RAISE EXCEPTION 'ERR_DRIVER_HAS_OPEN_BOOKING: You already have a booking in progress. Finish it before taking another.' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_booking_block_double_booking ON public.booking;
CREATE TRIGGER trigger_booking_block_double_booking
    BEFORE UPDATE OF driver_id ON public.booking
    FOR EACH ROW EXECUTE FUNCTION public.block_driver_double_booking();

-- ---------------------------------------------------------------------------- 3. the TODA of a booking
-- Runs after trigger_booking_identity_guard (alphabetical order), which stops the people on a booking from writing toda_id themselves.
CREATE OR REPLACE FUNCTION public.stamp_booking_toda()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.driver_id IS NULL AND NEW.driver_id IS NOT NULL AND NEW.toda_id IS NULL THEN
        NEW.toda_id := COALESCE(
            (SELECT s.toda_id FROM public.driver_online_session s WHERE s.driver_id = NEW.driver_id AND s.ended_at IS NULL LIMIT 1),
            (SELECT d.toda_id FROM public.driver d WHERE d.driver_id = NEW.driver_id));
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_booking_stamp_toda ON public.booking;
CREATE TRIGGER trigger_booking_stamp_toda
    BEFORE UPDATE OF driver_id ON public.booking
    FOR EACH ROW EXECUTE FUNCTION public.stamp_booking_toda();

-- ---------------------------------------------------------------------------- 2. ratings
DELETE FROM public.rating a
 USING public.rating b
 WHERE a.booking_id = b.booking_id AND a.rater_role = b.rater_role
   AND (a.created_at < b.created_at OR (a.created_at = b.created_at AND a.rating_id < b.rating_id));

CREATE UNIQUE INDEX IF NOT EXISTS uq_rating_booking_rater ON public.rating (booking_id, rater_role);

DROP POLICY IF EXISTS rating_insert_participant ON public.rating;
CREATE POLICY rating_insert_participant ON public.rating FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.booking b
         WHERE b.booking_id = rating.booking_id
           AND b.booking_status IN ('Arrived at Destination', 'Completed')
           AND ((rating.rater_role = 'Passenger'
                 AND b.passenger_id IS NOT NULL AND b.passenger_id = public.get_current_passenger_id()
                 AND rating.rater_id = b.passenger_id AND rating.ratee_id IS NOT DISTINCT FROM b.driver_id)
             OR (rating.rater_role = 'Driver'
                 AND b.driver_id IS NOT NULL AND b.driver_id = public.get_current_driver_id()
                 AND rating.rater_id = b.driver_id AND rating.ratee_id IS NOT DISTINCT FROM b.passenger_id))
    ));

REVOKE ALL ON FUNCTION public.block_offer_to_busy_driver(), public.block_driver_double_booking(), public.stamp_booking_toda() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_rating_booking_rater') THEN
        RAISE EXCEPTION 'the rating uniqueness rule is missing';
    END IF;
    IF has_function_privilege('anon', 'public.find_candidate_drivers(uuid,double precision,integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'find_candidate_drivers must not be callable by anon';
    END IF;
END $$;
