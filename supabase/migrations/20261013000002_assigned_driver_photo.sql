-- ============================================================================
-- Migration: 20261013000002_assigned_driver_photo.sql
-- Checklist (Passenger > Trip Monitoring): the passenger sees the assigned driver's photo, name, vehicle and plate.
--
-- The storage rule already lets the passenger of a LIVE booking open the driver's photo (storage_can_read_profile_folder), but the
-- passenger has no way to learn WHICH file it is: the driver table is not readable by a passenger and get_assigned_driver_details
-- (which is tested and in use) does not return it. This small function answers exactly that, and only that:
--   * the caller must be the passenger of the booking (never another passenger, never a driver);
--   * only while the trip is live (accepted, on the way, arrived, in transit): after the trip the passenger no longer gets the photo,
--     the same moment the storage rule stops letting them open it;
--   * the answer is the storage path of the photo (or NULL when the driver has none); the app asks Storage for a short-lived link.
-- Forward-only. Safe to run twice.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_assigned_driver_photo(p_booking_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_pax UUID := public.get_current_passenger_id();
    v_path TEXT;
BEGIN
    IF v_pax IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT d.profile_photo_url INTO v_path
      FROM public.booking b
      JOIN public.driver d ON d.driver_id = b.driver_id
     WHERE b.booking_id = p_booking_id
       AND b.passenger_id = v_pax
       AND public._booking_is_open_accepted(b.booking_status::TEXT);

    RETURN NULLIF(btrim(COALESCE(v_path, '')), '');
END;
$$;

REVOKE ALL ON FUNCTION public.get_assigned_driver_photo(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_assigned_driver_photo(UUID) TO authenticated, service_role;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_assigned_driver_photo' AND pronamespace = 'public'::regnamespace) THEN
        RAISE EXCEPTION 'get_assigned_driver_photo is missing';
    END IF;
    IF has_function_privilege('anon', 'public.get_assigned_driver_photo(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'get_assigned_driver_photo must not be callable by anon';
    END IF;
END $$;
