-- ============================================================================
-- Migration: 20261016000001_service_area_destination_gate.sql
-- The service-area gate (Batch 1, PI-01) checked only the PICKUP.
--
-- A passenger could pin a destination in Puerto Galera (about 26 km from the centre of the service area, which is a 16 km circle around Calapan
-- City Hall), get a route and a fare, and book: the booking was accepted because the pickup was inside. SAKAY serves Calapan City only (the policy
-- excludes neighbouring municipalities), so a trip must START and END inside the service area.
--
-- check_booking_service_area_gate() now tests the destination as well, with the same active service_area_config row and the same distance
-- formula. The pickup message and error code are unchanged (ERR_OUT_OF_SERVICE_AREA); the destination has its own code
-- (ERR_DESTINATION_OUT_OF_SERVICE_AREA) so the app can say which end is the problem. The booking's pickup and destination cannot be changed
-- after it is created (booking_fare_update_guard), so checking at insert is enough.
--
-- NOT changed here: the shape of the area. It is still the circle that PI-01 (Option C, a temporary testing variant) approved; a circle around
-- the city centre also covers the nearer parts of neighbouring municipalities (Baco Poblacion is about 10.6 km away). Narrowing it to the
-- pilot area, or replacing it with the real city limits, is a decision for the owner (set_pilot_service_area() / service_area_config).
--
-- Forward-only. Safe to run twice.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_booking_service_area_gate()
RETURNS TRIGGER AS $$
DECLARE
    v_config public.service_area_config;
    v_dist DOUBLE PRECISION;
BEGIN
    SELECT * INTO v_config
    FROM public.service_area_config
    WHERE is_active = TRUE
    LIMIT 1;

    IF v_config.config_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- The pickup
    IF NEW.pickup_latitude IS NOT NULL AND NEW.pickup_longitude IS NOT NULL THEN
        v_dist := public.calculate_haversine_distance_km(
            v_config.center_latitude, v_config.center_longitude, NEW.pickup_latitude, NEW.pickup_longitude);
        IF v_dist > v_config.radius_km THEN
            RAISE EXCEPTION 'ERR_OUT_OF_SERVICE_AREA: Ang lokasyon ng pickup ay nasa labas ng opisyal na nasasakupan ng SAKAY sa Lungsod ng Calapan (% km mula sa sentro, limitasyon: % km).',
                round(v_dist::numeric, 2), round(v_config.radius_km::numeric, 2);
        END IF;
    END IF;

    -- The destination: a trip has to end inside the service area too
    IF NEW.dropoff_latitude IS NOT NULL AND NEW.dropoff_longitude IS NOT NULL THEN
        v_dist := public.calculate_haversine_distance_km(
            v_config.center_latitude, v_config.center_longitude, NEW.dropoff_latitude, NEW.dropoff_longitude);
        IF v_dist > v_config.radius_km THEN
            RAISE EXCEPTION 'ERR_DESTINATION_OUT_OF_SERVICE_AREA: Ang destinasyon ay nasa labas ng opisyal na nasasakupan ng SAKAY sa Lungsod ng Calapan (% km mula sa sentro, limitasyon: % km).',
                round(v_dist::numeric, 2), round(v_config.radius_km::numeric, 2);
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- The trigger itself (BEFORE INSERT ON booking) is unchanged; CREATE OR REPLACE keeps the function's privileges.
