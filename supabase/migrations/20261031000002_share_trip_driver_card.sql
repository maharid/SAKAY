-- ============================================================================
-- SHARE LIVE TRIP: THE DRIVER'S PICTURE AND PHONE NUMBER (panel comment, decision D-P2; changes Rule 26.1)
-- ============================================================================
-- The panel: the driver's phone number, profile picture and plate number should be easy to see, "especially in the Share Live Trip". The page used to show the
-- driver's first name and the plate only. From now on, WHILE THE TRIP IS ON, the person who received the link also gets:
--   * the driver's mobile number (driver_phone), to call; it is null once the trip has ended or the link has expired (the link already ends 15 minutes after the
--     trip, never later than 4 hours, and can be switched off by the passenger);
--   * driver_has_photo: whether the driver has a profile picture the page may ask for. The picture itself is not in this answer (a file is in Storage, which an
--     anonymous visitor cannot read): the page asks the SAKAY server, which calls get_shared_trip_photo_path() below and signs that one file for a minute.
-- Still never in the answer: the passenger's name, phone number or fare, or the driver's surname.
--
--   get_shared_trip_view(token)        the 20261026000001 function with the two new fields; still the ONE function a visitor without an account may call
--   _shared_trip_photo_path(driver)    the driver's picture path, but only when it lies inside the driver's own folder of the profiles bucket (a driver cannot
--                                      point the page at somebody else's file); internal
--   get_shared_trip_photo_path(token)  the path for a live link and a live trip, otherwise NULL; callable by the server only (service_role), never by a browser
-- Forward-only. Safe to run twice.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._shared_trip_photo_path(p_driver public.driver)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $f$
    SELECT CASE
        WHEN p_driver.auth_user_id IS NOT NULL
         AND NULLIF(btrim(COALESCE(p_driver.profile_photo_url, '')), '') IS NOT NULL
         AND left(btrim(p_driver.profile_photo_url), length(p_driver.auth_user_id::TEXT) + 1) = p_driver.auth_user_id::TEXT || '/'
         AND position('..' IN p_driver.profile_photo_url) = 0
        THEN btrim(p_driver.profile_photo_url)
    END;
$f$;

CREATE OR REPLACE FUNCTION public.get_shared_trip_view(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_l public.trip_share_link;
    v_b public.booking;
    v_d public.driver;
    v_phase TEXT;
    v_exp TIMESTAMPTZ;
    v_live BOOLEAN;
BEGIN
    IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN
        RETURN jsonb_build_object('found', FALSE);
    END IF;
    SELECT * INTO v_l FROM public.trip_share_link WHERE token_hash = public._share_hash(p_token) AND revoked_at IS NULL;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('found', FALSE);
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = v_l.booking_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('found', FALSE);
    END IF;
    v_exp := public._trip_share_expires_at(v_l.created_at, v_b);
    IF clock_timestamp() >= v_exp THEN
        RETURN jsonb_build_object('found', FALSE);
    END IF;
    v_phase := public._booking_phase(v_b.booking_status);
    v_live := v_phase IN ('assigned', 'arrived', 'ongoing', 'at_destination');
    SELECT * INTO v_d FROM public.driver WHERE driver_id = v_b.driver_id;
    RETURN jsonb_build_object(
        'found', TRUE,
        'state', v_phase,
        'ended', NOT v_live,
        'status_en', CASE v_phase WHEN 'assigned' THEN 'On the way to the pickup' WHEN 'arrived' THEN 'The driver has arrived at the pickup' WHEN 'ongoing' THEN 'The trip is in progress'
                                  WHEN 'at_destination' THEN 'Arrived at the destination' WHEN 'completed' THEN 'The trip has ended' ELSE 'The trip was cancelled' END,
        'status_tl', CASE v_phase WHEN 'assigned' THEN 'Papunta sa sasakay' WHEN 'arrived' THEN 'Dumating na ang drayber sa sasakyan' WHEN 'ongoing' THEN 'Nasa biyahe'
                                  WHEN 'at_destination' THEN 'Nakarating na sa destinasyon' WHEN 'completed' THEN 'Tapos na ang biyahe' ELSE 'Nakansela ang biyahe' END,
        'pickup_address', v_b.pickup_address,
        'dropoff_address', v_b.dropoff_address,
        'pickup', jsonb_build_object('lat', v_b.pickup_latitude, 'lng', v_b.pickup_longitude),
        'dropoff', jsonb_build_object('lat', v_b.dropoff_latitude, 'lng', v_b.dropoff_longitude),
        'driver_first_name', CASE WHEN v_d.driver_id IS NOT NULL THEN public.passenger_first_name(v_d.full_name) END,
        'plate_number', v_d.plate_number,
        'driver_phone', CASE WHEN v_live THEN NULLIF(btrim(COALESCE(v_d.contact_number, '')), '') END,
        'driver_has_photo', v_live AND public._shared_trip_photo_path(v_d) IS NOT NULL,
        'driver_position', CASE WHEN v_live AND v_d.current_latitude IS NOT NULL AND v_d.current_longitude IS NOT NULL
                                THEN jsonb_build_object('lat', v_d.current_latitude, 'lng', v_d.current_longitude,
                                                        'age_seconds', GREATEST(0, floor(EXTRACT(EPOCH FROM (clock_timestamp() - v_d.last_location_update)))::INTEGER)) END,
        'progress_pct', CASE WHEN v_phase = 'ongoing' THEN public._trip_progress_pct(v_b.booking_id) END,
        'expires_at', v_exp,
        'server_now', clock_timestamp());
END;
$$;

CREATE OR REPLACE FUNCTION public.get_shared_trip_photo_path(p_token TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_l public.trip_share_link;
    v_b public.booking;
    v_d public.driver;
BEGIN
    IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_l FROM public.trip_share_link WHERE token_hash = public._share_hash(p_token) AND revoked_at IS NULL;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = v_l.booking_id;
    IF NOT FOUND OR clock_timestamp() >= public._trip_share_expires_at(v_l.created_at, v_b) THEN
        RETURN NULL;
    END IF;
    -- the same test as the page's "live": a picture is shown only while the trip is on
    IF public._booking_phase(v_b.booking_status) NOT IN ('assigned', 'arrived', 'ongoing', 'at_destination') THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_d FROM public.driver WHERE driver_id = v_b.driver_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    RETURN public._shared_trip_photo_path(v_d);
END;
$$;

REVOKE EXECUTE ON FUNCTION public._shared_trip_photo_path(public.driver) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_shared_trip_photo_path(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_shared_trip_photo_path(TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_shared_trip_view(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_trip_view(TEXT) TO anon, authenticated, service_role;

DO $$
BEGIN
    IF NOT has_function_privilege('anon', 'public.get_shared_trip_view(text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'get_shared_trip_view must stay callable by a visitor without an account';
    END IF;
    IF has_function_privilege('anon', 'public.get_shared_trip_photo_path(text)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.get_shared_trip_photo_path(text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'get_shared_trip_photo_path must be callable by the server only';
    END IF;
    IF position('driver_phone' IN pg_get_functiondef('public.get_shared_trip_view(text)'::regprocedure)) = 0 THEN
        RAISE EXCEPTION 'get_shared_trip_view does not carry the driver phone';
    END IF;
END $$;
