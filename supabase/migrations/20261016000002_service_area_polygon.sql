-- ============================================================================
-- Migration: 20261016000002_service_area_polygon.sql
-- The service area is the REAL boundary of Calapan City, not a circle.
--
-- Until now the service area was a 16 km circle around Calapan City Hall (PI-01 Option C, a temporary testing variant). A circle covers the
-- nearer parts of neighbouring municipalities (Baco Poblacion is 10.7 km from the centre) and cuts off the far corners of the city. SAKAY serves
-- Calapan City only, so the gate now tests the point against the city's limits: both ends of a trip (20261016000001) must be inside the polygon.
--
--   * service_area_config gets boundary_geojson (a GeoJSON Polygon / MultiPolygon, [longitude, latitude] pairs) and boundary_source.
--     A row without a boundary is still a circle (centre + radius_km), which is what set_pilot_service_area() creates for a pilot narrowing.
--   * service_area_contains(config, lat, lng) is the one question every caller asks: a cheap distance test first (the polygon always lies inside
--     the row's radius_km), then the point-in-polygon test (ray casting; a Polygon's holes and every part of a MultiPolygon are honoured).
--   * check_booking_service_area_gate() uses it for the pickup (ERR_OUT_OF_SERVICE_AREA) and the destination (ERR_DESTINATION_OUT_OF_SERVICE_AREA).
--   * The row 'Calapan City (city limits)' is loaded and made the active service area. The old circle stays, inactive, as history.
--   * use_city_service_area() lets an LGU administrator go back to the whole city after a pilot narrowing (audited).
--
-- DATA: OpenStreetMap relation 15077332 ("Calapan, Oriental Mindoro", boundary=administrative), fetched 2026-10-07 through Nominatim at full
-- resolution (369 vertices, coordinates rounded to 6 decimals, about 0.1 m). Data (c) OpenStreetMap contributors, ODbL 1.0
-- (https://www.openstreetmap.org/copyright). The polygon follows the municipal limits INCLUDING the municipal waters off the coast (about 559 km2
-- in all, against the city's 250 km2 of land), which is harmless for a pin on land. Where the official LGU boundary file differs from the
-- OpenStreetMap one, load the official one: insert it as a new row with the same shape and call use_city_service_area() or activate it directly.
--
-- Forward-only. Safe to run twice (the row is loaded once, the self-check always runs).
-- ============================================================================

ALTER TABLE public.service_area_config
    ADD COLUMN IF NOT EXISTS boundary_geojson JSONB,
    ADD COLUMN IF NOT EXISTS boundary_source TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_area_config_boundary_type_check') THEN
        ALTER TABLE public.service_area_config
            ADD CONSTRAINT service_area_config_boundary_type_check
            CHECK (boundary_geojson IS NULL OR boundary_geojson->>'type' IN ('Polygon', 'MultiPolygon'));
    END IF;
END $$;

COMMENT ON COLUMN public.service_area_config.boundary_geojson IS 'GeoJSON Polygon or MultiPolygon ([longitude, latitude] pairs). When set it IS the service area; center / radius_km are then only a cheap bounding test (the polygon lies inside that circle). NULL = the area is the circle.';

-- ----------------------------------------------------------------------------
-- 1. POINT IN POLYGON
-- ----------------------------------------------------------------------------
-- One ring (an array of [longitude, latitude]): true when the point is inside it (ray casting). A point exactly on an edge may go either way.
CREATE OR REPLACE FUNCTION public._ring_contains_point(p_ring JSONB, p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $f$
DECLARE
    n INTEGER := COALESCE(jsonb_array_length(p_ring), 0);
    i INTEGER;
    j INTEGER;
    xi DOUBLE PRECISION; yi DOUBLE PRECISION; xj DOUBLE PRECISION; yj DOUBLE PRECISION;
    v_inside BOOLEAN := FALSE;
BEGIN
    IF n < 3 THEN
        RETURN FALSE;
    END IF;
    j := n - 1;
    FOR i IN 0 .. n - 1 LOOP
        xi := (p_ring -> i ->> 0)::DOUBLE PRECISION;
        yi := (p_ring -> i ->> 1)::DOUBLE PRECISION;
        xj := (p_ring -> j ->> 0)::DOUBLE PRECISION;
        yj := (p_ring -> j ->> 1)::DOUBLE PRECISION;
        IF ((yi > p_lat) <> (yj > p_lat)) AND (p_lng < (xj - xi) * (p_lat - yi) / (yj - yi) + xi) THEN
            v_inside := NOT v_inside;
        END IF;
        j := i;
    END LOOP;
    RETURN v_inside;
END;
$f$;

-- A GeoJSON Polygon (outer ring first, then holes) or MultiPolygon.
CREATE OR REPLACE FUNCTION public.geojson_contains_point(p_geom JSONB, p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $f$
DECLARE
    v_poly JSONB;
    v_in BOOLEAN;
BEGIN
    IF p_geom IS NULL OR p_lat IS NULL OR p_lng IS NULL THEN
        RETURN FALSE;
    END IF;
    IF p_geom ->> 'type' = 'Polygon' THEN
        v_poly := p_geom -> 'coordinates';
        IF NOT public._ring_contains_point(v_poly -> 0, p_lat, p_lng) THEN
            RETURN FALSE;
        END IF;
        RETURN NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_poly) WITH ORDINALITY AS t(r, ord)
             WHERE ord > 1 AND public._ring_contains_point(t.r, p_lat, p_lng));
    ELSIF p_geom ->> 'type' = 'MultiPolygon' THEN
        FOR v_poly IN SELECT * FROM jsonb_array_elements(p_geom -> 'coordinates') LOOP
            v_in := public.geojson_contains_point(jsonb_build_object('type', 'Polygon', 'coordinates', v_poly), p_lat, p_lng);
            IF v_in THEN
                RETURN TRUE;
            END IF;
        END LOOP;
        RETURN FALSE;
    END IF;
    RETURN FALSE;
END;
$f$;

-- The one question: is this point inside the service area in this row?
CREATE OR REPLACE FUNCTION public.service_area_contains(p_config public.service_area_config, p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $f$
BEGIN
    IF p_config.config_id IS NULL OR p_lat IS NULL OR p_lng IS NULL THEN
        RETURN FALSE;
    END IF;
    -- cheap test first: nothing beyond radius_km of the centre is inside (for a polygon row the radius is its circumscribed circle)
    IF public.calculate_haversine_distance_km(p_config.center_latitude, p_config.center_longitude, p_lat, p_lng) > p_config.radius_km THEN
        RETURN FALSE;
    END IF;
    IF p_config.boundary_geojson IS NULL THEN
        RETURN TRUE;                                    -- a circle: the distance test was the whole test
    END IF;
    RETURN public.geojson_contains_point(p_config.boundary_geojson, p_lat, p_lng);
END;
$f$;

-- ----------------------------------------------------------------------------
-- 2. THE GATE USES IT (both ends of the trip)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_booking_service_area_gate()
RETURNS TRIGGER AS $$
DECLARE
    v_config public.service_area_config;
BEGIN
    SELECT * INTO v_config FROM public.service_area_config WHERE is_active = TRUE LIMIT 1;
    IF v_config.config_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.pickup_latitude IS NOT NULL AND NEW.pickup_longitude IS NOT NULL
       AND NOT public.service_area_contains(v_config, NEW.pickup_latitude, NEW.pickup_longitude) THEN
        RAISE EXCEPTION 'ERR_OUT_OF_SERVICE_AREA: Ang lokasyon ng pickup ay nasa labas ng opisyal na nasasakupan ng SAKAY (%). Pumili ng lokasyon sa loob ng lungsod.', v_config.area_name;
    END IF;

    IF NEW.dropoff_latitude IS NOT NULL AND NEW.dropoff_longitude IS NOT NULL
       AND NOT public.service_area_contains(v_config, NEW.dropoff_latitude, NEW.dropoff_longitude) THEN
        RAISE EXCEPTION 'ERR_DESTINATION_OUT_OF_SERVICE_AREA: Ang destinasyon ay nasa labas ng opisyal na nasasakupan ng SAKAY (%). Pumili ng destinasyon sa loob ng lungsod.', v_config.area_name;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 3. THE CITY LIMITS, LOADED AND ACTIVE
-- ----------------------------------------------------------------------------
DO $load$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.service_area_config WHERE area_name = 'Calapan City (city limits)') THEN
        UPDATE public.service_area_config SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE is_active;
        INSERT INTO public.service_area_config (area_name, center_latitude, center_longitude, radius_km, is_active, notes, boundary_geojson, boundary_source)
        VALUES (
            'Calapan City (city limits)',
            13.4117, 121.1803, 23,
            TRUE,
            'The whole of Calapan City, by its boundary. center / radius_km are only a cheap bounding test (the polygon lies inside that circle). Use set_pilot_service_area() to narrow to a pilot terminal and use_city_service_area() to come back to this.',
            $geo${"type":"Polygon","coordinates":[[[121.097806,13.47496],[121.120097,13.450897],[121.142402,13.438728],[121.141862,13.420549],[121.141669,13.411052],[121.141576,13.409037],[121.141048,13.407462],[121.140564,13.406486],[121.138971,13.406056],[121.138627,13.405976],[121.138401,13.405855],[121.138202,13.405645],[121.138034,13.405435],[121.137815,13.405239],[121.137515,13.405124],[121.137159,13.404957],[121.136748,13.404767],[121.136546,13.404639],[121.136374,13.404489],[121.136219,13.404276],[121.136101,13.404037],[121.136027,13.403749],[121.13601,13.403444],[121.136078,13.403097],[121.136155,13.402665],[121.136186,13.402399],[121.136186,13.402177],[121.136122,13.401968],[121.136021,13.401652],[121.13597,13.401352],[121.135965,13.401095],[121.135998,13.400926],[121.136178,13.400642],[121.136335,13.400419],[121.13638,13.400179],[121.136385,13.399972],[121.136312,13.399775],[121.13615,13.399568],[121.135858,13.399257],[121.135566,13.39888],[121.135432,13.398662],[121.135365,13.398531],[121.135269,13.398488],[121.135151,13.39845],[121.134983,13.398433],[121.134664,13.398384],[121.134417,13.39828],[121.134209,13.398117],[121.13389,13.397822],[121.133665,13.397631],[121.133604,13.39756],[121.133525,13.397277],[121.133363,13.396606],[121.133256,13.396257],[121.132046,13.396043],[121.131074,13.396036],[121.129237,13.396244],[121.128482,13.394007],[121.12568,13.392677],[121.126641,13.390369],[121.124359,13.389641],[121.120488,13.389409],[121.120049,13.389459],[121.117022,13.389046],[121.117147,13.388815],[121.117392,13.388308],[121.1176,13.387732],[121.117698,13.387213],[121.117892,13.386061],[121.118059,13.385363],[121.118115,13.384681],[121.118083,13.383588],[121.11804,13.382625],[121.117945,13.381942],[121.117855,13.38097],[121.117841,13.380489],[121.117827,13.379893],[121.117798,13.378978],[121.11777,13.37864],[121.11766,13.378319],[121.117411,13.377888],[121.117132,13.377411],[121.116968,13.377112],[121.116827,13.376743],[121.116727,13.376283],[121.116687,13.375684],[121.116599,13.375215],[121.116529,13.374736],[121.116459,13.374203],[121.116499,13.37398],[121.116605,13.373778],[121.116841,13.373409],[121.116992,13.373069],[121.117071,13.372591],[121.117059,13.372349],[121.117029,13.37195],[121.117071,13.371629],[121.117125,13.371376],[121.117302,13.371172],[121.117609,13.370928],[121.118194,13.370053],[121.118444,13.369466],[121.118909,13.368659],[121.119395,13.368023],[121.119602,13.36753],[121.119711,13.367244],[121.119767,13.366901],[121.119799,13.366618],[121.119784,13.366197],[121.119812,13.365539],[121.119896,13.365173],[121.12001,13.36488],[121.120137,13.364605],[121.120366,13.364286],[121.120717,13.363891],[121.121244,13.363382],[121.121984,13.362629],[121.12233,13.362387],[121.122794,13.362098],[121.123035,13.361834],[121.123181,13.361639],[121.123491,13.361113],[121.123727,13.360555],[121.123838,13.360296],[121.123883,13.360004],[121.123978,13.359709],[121.124114,13.359414],[121.124516,13.358796],[121.124927,13.358174],[121.12497,13.358044],[121.12493,13.357898],[121.124818,13.35777],[121.124662,13.35772],[121.12449,13.357734],[121.124169,13.357778],[121.123382,13.357925],[121.122768,13.358008],[121.122283,13.358041],[121.121839,13.358002],[121.12133,13.357936],[121.120824,13.35779],[121.120529,13.357672],[121.120346,13.357575],[121.120229,13.357438],[121.120164,13.357239],[121.120177,13.357044],[121.120284,13.356784],[121.120341,13.356523],[121.120447,13.356096],[121.120397,13.355803],[121.120351,13.355576],[121.120312,13.355377],[121.120317,13.35502],[121.120417,13.354737],[121.120484,13.354462],[121.120452,13.3542],[121.120358,13.353943],[121.120217,13.353701],[121.120084,13.353519],[121.119948,13.353382],[121.119801,13.353282],[121.119597,13.353197],[121.119109,13.353187],[121.118669,13.353197],[121.118229,13.35315],[121.117695,13.352983],[121.117162,13.352873],[121.116116,13.352576],[121.115731,13.352115],[121.115687,13.351697],[121.116157,13.350758],[121.116234,13.350307],[121.115957,13.349855],[121.115676,13.349733],[121.115301,13.349893],[121.114786,13.350542],[121.114377,13.350818],[121.114059,13.351033],[121.113509,13.351419],[121.112871,13.351698],[121.112337,13.351747],[121.111771,13.351558],[121.111384,13.351086],[121.111389,13.350436],[121.111668,13.349859],[121.112416,13.349377],[121.112837,13.348924],[121.113024,13.348595],[121.113165,13.348247],[121.113168,13.347826],[121.112797,13.347668],[121.11206,13.347398],[121.111945,13.347148],[121.11213,13.346793],[121.112602,13.34661],[121.113303,13.34641],[121.113679,13.346245],[121.114271,13.345757],[121.114312,13.345425],[121.114322,13.345041],[121.114228,13.344137],[121.114467,13.343377],[121.114859,13.343196],[121.115314,13.343049],[121.115576,13.342816],[121.115675,13.342503],[121.115575,13.342171],[121.115433,13.341459],[121.115403,13.340704],[121.115578,13.340164],[121.116127,13.339876],[121.116537,13.33923],[121.116549,13.338466],[121.116518,13.338162],[121.116329,13.337894],[121.115788,13.337631],[121.115011,13.337334],[121.114586,13.337038],[121.114367,13.33668],[121.114296,13.336062],[121.114677,13.334435],[121.114797,13.333557],[121.115039,13.332493],[121.115521,13.331507],[121.115702,13.331178],[121.115659,13.330846],[121.115307,13.330758],[121.114564,13.330572],[121.113454,13.329985],[121.112817,13.329006],[121.112246,13.328675],[121.111388,13.328669],[121.110784,13.328284],[121.110259,13.328075],[121.109886,13.327656],[121.109762,13.326714],[121.110054,13.326283],[121.111331,13.325809],[121.112253,13.325414],[121.112531,13.325193],[121.112753,13.324916],[121.11289,13.324489],[121.112773,13.323809],[121.112615,13.32322],[121.112372,13.322802],[121.111824,13.32262],[121.111481,13.322729],[121.110802,13.323131],[121.110239,13.323481],[121.109626,13.323401],[121.108837,13.323175],[121.108406,13.3227],[121.108216,13.32205],[121.108246,13.321733],[121.108275,13.321415],[121.108356,13.320998],[121.108422,13.320773],[121.108528,13.320373],[121.108706,13.319538],[121.108698,13.318786],[121.108844,13.318136],[121.10864,13.3175],[121.108136,13.317018],[121.107486,13.316785],[121.107011,13.316836],[121.106581,13.31731],[121.106172,13.317909],[121.105799,13.317968],[121.105346,13.317807],[121.10466,13.317186],[121.104207,13.316858],[121.104295,13.316588],[121.104667,13.316317],[121.104704,13.31585],[121.103937,13.315134],[121.103367,13.314952],[121.102864,13.315229],[121.102038,13.315229],[121.101753,13.315112],[121.101352,13.31447],[121.101323,13.313666],[121.101534,13.313279],[121.101936,13.313075],[121.10217,13.312819],[121.102761,13.311899],[121.102856,13.311286],[121.102476,13.310453],[121.101907,13.310307],[121.101213,13.309979],[121.100848,13.309686],[121.100607,13.30927],[121.10041,13.30862],[121.100395,13.307802],[121.100775,13.307152],[121.100972,13.306743],[121.100965,13.305889],[121.100855,13.305385],[121.100169,13.303559],[121.100198,13.302939],[121.10043,13.302094],[121.100788,13.301388],[121.101583,13.301133],[121.102203,13.301213],[121.102862,13.301498],[121.103214,13.302267],[121.103499,13.302956],[121.103721,13.303532],[121.104121,13.303742],[121.104584,13.303716],[121.105,13.303506],[121.105244,13.303114],[121.105441,13.302581],[121.10556,13.302001],[121.105563,13.30151],[121.105252,13.301113],[121.104853,13.301047],[121.103779,13.300866],[121.103179,13.300486],[121.102586,13.299742],[121.111412,13.299927],[121.122493,13.299953],[121.122592,13.29994],[121.126445,13.299926],[121.126556,13.299923],[121.1334,13.299934],[121.137397,13.300279],[121.167224,13.299925],[121.200651,13.299897],[121.20535,13.299924],[121.214929,13.300092],[121.23982,13.314855],[121.24845,13.320017],[121.256676,13.32518],[121.258538,13.326052],[121.259064,13.326694],[121.260543,13.327614],[121.261174,13.327834],[121.267151,13.331812],[121.274412,13.336355],[121.27631,13.337171],[121.277499,13.340141],[121.28162,13.345519],[121.301658,13.345503],[121.382991,13.454961],[121.382846,13.45506],[121.378829,13.457712],[121.378303,13.458046],[121.376118,13.459407],[121.374824,13.460195],[121.374817,13.460184],[121.373951,13.460695],[121.369739,13.463521],[121.366731,13.465353],[121.365394,13.466183],[121.365363,13.466203],[121.361394,13.468771],[121.358943,13.470278],[121.358678,13.47044],[121.357707,13.475242],[121.356633,13.479653],[121.318925,13.49693],[121.263478,13.516652],[121.260596,13.5189],[121.206113,13.554153],[121.175649,13.562726],[121.169327,13.561991],[121.139269,13.515369],[121.117324,13.494044],[121.097806,13.47496]]]}$geo$::jsonb,
            'OpenStreetMap relation 15077332 (Calapan, Oriental Mindoro, boundary=administrative), fetched 2026-10-07 via Nominatim, 369 vertices. (c) OpenStreetMap contributors, ODbL 1.0. Replace with the official LGU boundary file when available.'
        );
        PERFORM public.record_policy_audit('SERVICE_AREA_CHANGED', 'service_area_config', 'Calapan City (city limits)', 'Service Area',
            'The service area is now the boundary of Calapan City (a polygon), replacing the 16 km testing circle.', NULL, NULL);
    END IF;
END
$load$;

-- ----------------------------------------------------------------------------
-- 4. BACK TO THE WHOLE CITY (after a pilot narrowing)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.use_city_service_area()
RETURNS JSONB AS $$
DECLARE
    v_city public.service_area_config;
    v_before TEXT;
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Access Denied: Only LGU Administrators can update the service area.');
    END IF;
    SELECT * INTO v_city FROM public.service_area_config
     WHERE area_name = 'Calapan City (city limits)' AND boundary_geojson IS NOT NULL
     ORDER BY updated_at DESC LIMIT 1;
    IF v_city.config_id IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'The Calapan City boundary is not loaded.');
    END IF;
    SELECT area_name INTO v_before FROM public.service_area_config WHERE is_active LIMIT 1;
    UPDATE public.service_area_config SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE is_active AND config_id <> v_city.config_id;
    UPDATE public.service_area_config SET is_active = TRUE, updated_at = CURRENT_TIMESTAMP WHERE config_id = v_city.config_id;
    PERFORM public.record_policy_audit('SERVICE_AREA_CHANGED', v_city.config_id::TEXT, v_city.area_name, 'Service Area',
        'The service area was set back to the whole of Calapan City (its boundary).',
        jsonb_build_object('area', v_before), jsonb_build_object('area', v_city.area_name));
    RETURN jsonb_build_object('success', TRUE, 'message', 'The service area is the whole of Calapan City.', 'previous', v_before);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 5. PRIVILEGES (new functions get none by default since the perimeter lockdown)
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._ring_contains_point(JSONB, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.geojson_contains_point(JSONB, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.service_area_contains(public.service_area_config, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_area_contains(public.service_area_config, DOUBLE PRECISION, DOUBLE PRECISION) TO service_role;
GRANT EXECUTE ON FUNCTION public.geojson_contains_point(JSONB, DOUBLE PRECISION, DOUBLE PRECISION) TO service_role;
REVOKE EXECUTE ON FUNCTION public.use_city_service_area() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.use_city_service_area() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. SELF-CHECK (always runs; checks the city row itself, so it still holds after a pilot narrowing)
-- ----------------------------------------------------------------------------
DO $check$
DECLARE
    v_city public.service_area_config;
    v_n INTEGER;
BEGIN
    SELECT * INTO v_city FROM public.service_area_config WHERE area_name = 'Calapan City (city limits)' LIMIT 1;
    IF v_city.config_id IS NULL OR v_city.boundary_geojson IS NULL THEN
        RAISE EXCEPTION 'self-check failed: the Calapan City boundary is not loaded';
    END IF;
    v_n := jsonb_array_length(v_city.boundary_geojson -> 'coordinates' -> 0);
    IF v_n < 100 OR (v_city.boundary_geojson -> 'coordinates' -> 0 -> 0) IS DISTINCT FROM (v_city.boundary_geojson -> 'coordinates' -> 0 -> (v_n - 1)) THEN
        RAISE EXCEPTION 'self-check failed: the boundary ring is too short or not closed (% vertices)', v_n;
    END IF;
    IF (SELECT count(*) FROM public.service_area_config WHERE is_active) <> 1 THEN
        RAISE EXCEPTION 'self-check failed: exactly one service area must be active';
    END IF;
    IF NOT public.service_area_contains(v_city, 13.4117, 121.1803) THEN RAISE EXCEPTION 'self-check failed: Calapan City Hall must be inside'; END IF;
    IF NOT public.service_area_contains(v_city, 13.4228, 121.1789) THEN RAISE EXCEPTION 'self-check failed: Calapan Port must be inside'; END IF;
    IF public.service_area_contains(v_city, 13.5018, 120.9546) THEN RAISE EXCEPTION 'self-check failed: Puerto Galera must be outside'; END IF;
    IF public.service_area_contains(v_city, 13.3586, 121.0983) THEN RAISE EXCEPTION 'self-check failed: Baco Poblacion must be outside'; END IF;
    IF public.service_area_contains(v_city, 13.3236, 121.3034) THEN RAISE EXCEPTION 'self-check failed: Naujan Poblacion must be outside'; END IF;
    IF public.service_area_contains(v_city, 14.5995, 120.9842) THEN RAISE EXCEPTION 'self-check failed: Manila must be outside'; END IF;
END
$check$;
