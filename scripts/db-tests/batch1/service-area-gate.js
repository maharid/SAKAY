// The service area is the REAL boundary of Calapan City (a polygon), and the booking gate checks BOTH ends of a trip against it.
// 20261016000001: the gate also looks at the destination (before, only the pickup: a Puerto Galera destination was accepted).
// 20261016000002: the area is the city limits (OpenStreetMap relation 15077332), not a 16 km circle that cut off corners of the city and let in
//                 the nearer parts of neighbouring municipalities (Baco Poblacion was 10.7 km from the centre).
// Whole migration chain on the local emulator (never Supabase). Needs Node 22.18+ (it loads the shared .ts geometry directly).
const fs = require('fs');
const path = require('path');
const { setup, ID, attempt, check, summary, PICKUP } = require('../b6fixtures');
const { serviceAreaContains } = require('../../../packages/shared/src/utils/serviceAreaUtils.ts');

const PLACES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'calapan-places.json'), 'utf8')).places;

(async () => {
  const s = await setup();
  const { q, one, as } = s;
  const err = (r) => (r.ok ? 'booking was accepted' : r.error);
  const straightKm = (a, b) => {
    const rad = (d) => (d * Math.PI) / 180;
    const x = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  };
  // The fare guard (Batch 5) runs first and wants a road distance that is plausible for the two points, as the app's OSRM route would be.
  const bookAt = async (pickup, dropoff, who = 'P1') => {
    const km = Math.max(0.5, Math.round(straightKm(pickup, dropoff) * 1.15 * 100) / 100);
    const r = await attempt(() => s.book(who === 'P1' ? ID.P_AUTH : ID.P2_AUTH, who === 'P1' ? ID.P1 : ID.P2, { km, pickup, dropoff }));
    if (r.ok) await s.finish(r.value.booking_id);                // so the next attempt is not stopped by Rule 4.4
    return r;
  };
  const inArea = async (lat, lng) => (await one(`SELECT public.service_area_contains(c, $1::float8, $2::float8) AS r FROM public.service_area_config c WHERE c.is_active`, [lat, lng])).r;
  const CITY_HALL = { lat: 13.4117, lng: 121.1803 };
  const PORT = { lat: 13.4228, lng: 121.1789 };
  const PUERTO_GALERA = { lat: 13.5018, lng: 120.9546 };
  const BACO = { lat: 13.3586, lng: 121.0983 };

  console.log('The service area in force: the boundary of Calapan City');
  const area = await one(`SELECT * FROM service_area_config WHERE is_active`);
  const ring = area.boundary_geojson?.coordinates?.[0] ?? [];
  check('one active service area: "Calapan City (city limits)", with a boundary', area.area_name === 'Calapan City (city limits)' && area.boundary_geojson?.type === 'Polygon', area.area_name);
  check('the boundary is a closed ring of several hundred vertices, not a handful', ring.length >= 300 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1], ring.length);
  check('its source is recorded (OpenStreetMap relation 15077332, ODbL)', /relation 15077332/.test(area.boundary_source) && /ODbL/.test(area.boundary_source), area.boundary_source);
  const maxVertexKm = Math.max(...ring.map(([lng, lat]) => straightKm({ lat: Number(area.center_latitude), lng: Number(area.center_longitude) }, { lat, lng })));
  check('the bounding circle really contains the whole polygon (it is only a cheap first test)', maxVertexKm <= Number(area.radius_km), { maxVertexKm, radius: area.radius_km });
  check('the old 16 km testing circle is kept, inactive, as history', (await q(`SELECT 1 FROM service_area_config WHERE NOT is_active AND boundary_geojson IS NULL AND radius_km = 16`)).length === 1);
  const badType = await attempt(() => s.db.query(`INSERT INTO service_area_config (area_name, center_latitude, center_longitude, radius_km, is_active, boundary_geojson) VALUES ('x', 13, 121, 5, FALSE, '{"type":"Point","coordinates":[121,13]}')`));
  check('a boundary has to be a Polygon or MultiPolygon', !badType.ok && /boundary_type_check/.test(badType.error), badType.error);

  console.log('\nAll of Calapan is inside: places OpenStreetMap locates in the city (independent of this polygon)');
  const missed = [];
  for (const p of PLACES) if (!(await inArea(p.lat, p.lng))) missed.push(p.name);
  check(`all ${PLACES.length} barangays that OpenStreetMap locates in Calapan are inside the boundary`, missed.length === 0, missed);
  const beyondOldCircle = PLACES.filter((p) => straightKm(CITY_HALL, p) > 16);
  console.log(`   (${beyondOldCircle.length} of them are further than 16 km from City Hall: ${beyondOldCircle.map((p) => p.name).join(', ') || 'none'})`);
  for (const p of beyondOldCircle.slice(0, 2)) {
    const r = await bookAt(PICKUP, { lat: p.lat, lng: p.lng });
    check(`a trip to ${p.name} (${straightKm(CITY_HALL, p).toFixed(1)} km out, inside Calapan) is accepted: the circle would have refused it`, r.ok === true, err(r));
  }
  check('Calapan City Hall and the port are inside', (await inArea(CITY_HALL.lat, CITY_HALL.lng)) && (await inArea(PORT.lat, PORT.lng)));

  console.log('\nNowhere else is: neighbouring municipalities and the rest of the country');
  const OUTSIDE = { 'Puerto Galera': PUERTO_GALERA, 'Baco Poblacion': BACO, 'Naujan Poblacion': { lat: 13.3236, lng: 121.3034 },
    'Victoria Poblacion': { lat: 13.179, lng: 121.276 }, 'Socorro': { lat: 13.05, lng: 121.404 }, 'Pola': { lat: 13.17, lng: 121.43 },
    'Roxas': { lat: 12.5879, lng: 121.5253 }, 'Manila': { lat: 14.5995, lng: 120.9842 } };
  for (const [name, p] of Object.entries(OUTSIDE)) check(`${name} is outside`, (await inArea(p.lat, p.lng)) === false);

  console.log('\nBoth ends of a trip are checked, each with its own code');
  let r = await bookAt(CITY_HALL, PORT);
  check('City Hall to the port is accepted', r.ok === true, err(r));
  r = await bookAt(PICKUP, PUERTO_GALERA);
  check('a destination in Puerto Galera is refused (the reported bug)', !r.ok && /ERR_DESTINATION_OUT_OF_SERVICE_AREA/.test(r.error), err(r));
  check('...with a Tagalog message that names the area', /destinasyon/i.test(r.error || '') && /Calapan City \(city limits\)/.test(r.error || ''), r.error);
  r = await bookAt(PICKUP, BACO);
  check('a destination in Baco Poblacion, 10.7 km away and so inside the old circle, is now refused', !r.ok && /ERR_DESTINATION_OUT_OF_SERVICE_AREA/.test(r.error), err(r));
  r = await bookAt(BACO, PICKUP);
  check('a pickup in Baco Poblacion is refused with the pickup code', !r.ok && /ERR_OUT_OF_SERVICE_AREA/.test(r.error) && !/DESTINATION/.test(r.error), err(r));
  r = await bookAt(PUERTO_GALERA, { lat: 13.51, lng: 120.96 });
  check('a trip wholly outside is refused on the pickup first', !r.ok && /ERR_OUT_OF_SERVICE_AREA/.test(r.error) && !/DESTINATION/.test(r.error), err(r));

  console.log('\nThe database and the apps give the same answer for every point (shared/serviceAreaUtils.ts)');
  const shape = { centerLat: Number(area.center_latitude), centerLng: Number(area.center_longitude), radiusKm: Number(area.radius_km), boundary: area.boundary_geojson };
  const grid = await q(`SELECT g.lat::float8 AS lat, g.lng::float8 AS lng, public.service_area_contains(c, g.lat::float8, g.lng::float8) AS r
                          FROM public.service_area_config c,
                               (SELECT 13.20 + a * 0.004 AS lat, lng.v AS lng FROM generate_series(0, 100) a,
                                       LATERAL (SELECT 121.00 + b * 0.004 AS v FROM generate_series(0, 120) b) lng) g
                         WHERE c.is_active`);
  const disagree = grid.filter((p) => serviceAreaContains(shape, p.lat, p.lng) !== p.r);
  const insideCount = grid.filter((p) => p.r).length;
  check(`${grid.length} points over the city and its surroundings: ${insideCount} inside, ${grid.length - insideCount} outside, and the app and the database never disagree`, disagree.length === 0 && insideCount > 1000 && insideCount < grid.length - 1000, { disagree: disagree.slice(0, 5), insideCount });
  const circle = { centerLat: 13.4117, centerLng: 121.1803, radiusKm: 16, boundary: null };
  check('the same logic answers for a circle row (a pilot narrowing): inside 1.5 km, outside 1.6 km', serviceAreaContains({ ...circle, radiusKm: 1.5 }, 13.4117 + 1.4 / 111.195, 121.1803) && !serviceAreaContains({ ...circle, radiusKm: 1.5 }, 13.4117 + 1.6 / 111.195, 121.1803));
  const donut = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] };
  const multi = { type: 'MultiPolygon', coordinates: [[[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]], [[[5, 5], [7, 5], [7, 7], [5, 7], [5, 5]]]] };
  const geo = async (g, lat, lng) => (await one(`SELECT public.geojson_contains_point($1::jsonb, $2::float8, $3::float8) AS r`, [JSON.stringify(g), lat, lng])).r;
  check('a polygon with a hole: inside the ring is in, inside the hole is out (database and app)',
    (await geo(donut, 2, 2)) === true && (await geo(donut, 5, 5)) === false && (await geo(donut, 20, 5)) === false
    && (await geo(donut, 2, 2)) === serviceAreaContains({ centerLat: 5, centerLng: 5, radiusKm: 99999, boundary: donut }, 2, 2));
  check('a MultiPolygon: either part counts, the gap between them does not (database and app)',
    (await geo(multi, 1, 1)) === true && (await geo(multi, 6, 6)) === true && (await geo(multi, 3.5, 3.5)) === false
    && serviceAreaContains({ centerLat: 3, centerLng: 3, radiusKm: 99999, boundary: multi }, 6, 6) === true
    && serviceAreaContains({ centerLat: 3, centerLng: 3, radiusKm: 99999, boundary: multi }, 3.5, 3.5) === false);

  console.log('\nA pilot narrowing still works (a circle row has no boundary), and the LGU can come back to the whole city');
  const narrowed = (await as(ID.L_AUTH, (tx) => tx.query(`SELECT public.set_pilot_service_area($1, 1.5) AS r`, [ID.TODA1]))).rows[0].r;
  check('the LGU administrator can narrow the service area to a pilot terminal', narrowed.success === true, narrowed);
  r = await bookAt(PICKUP, { lat: PICKUP.lat + 0.03, lng: PICKUP.lng });
  check('with a 1.5 km pilot area, a trip that ends 3.3 km away (inside the city) is refused at the destination', !r.ok && /ERR_DESTINATION_OUT_OF_SERVICE_AREA/.test(r.error), err(r));
  r = await bookAt(PICKUP, { lat: PICKUP.lat + 0.004, lng: PICKUP.lng });
  check('a short trip inside the pilot area is accepted', r.ok === true, err(r));
  const paxBack = (await as(ID.P_AUTH, (tx) => tx.query(`SELECT public.use_city_service_area() AS r`))).rows[0].r;
  check('a passenger cannot switch the service area', paxBack.success === false && /Access Denied/.test(paxBack.error), paxBack);
  const lguBack = (await as(ID.L_AUTH, (tx) => tx.query(`SELECT public.use_city_service_area() AS r`))).rows[0].r;
  check('the LGU administrator switches it back to the whole city', lguBack.success === true, lguBack);
  const act = await q(`SELECT area_name FROM service_area_config WHERE is_active`);
  check('exactly one service area is active again: the city limits', act.length === 1 && act[0].area_name === 'Calapan City (city limits)', act);
  r = await bookAt(PICKUP, { lat: PICKUP.lat + 0.03, lng: PICKUP.lng });
  check('and the 3.3 km trip is accepted again', r.ok === true, err(r));
  r = await bookAt(PICKUP, BACO);
  check('while Baco Poblacion is refused again', !r.ok && /ERR_DESTINATION_OUT_OF_SERVICE_AREA/.test(r.error), err(r));
  check('both changes are in the audit log', (await q(`SELECT 1 FROM audit_log WHERE action_type = 'SERVICE_AREA_CHANGED'`)).length >= 2);

  console.log('\nOnly an administrator can change the area');
  await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`UPDATE service_area_config SET is_active = FALSE`)));
  await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`UPDATE service_area_config SET boundary_geojson = NULL, radius_km = 500`)));
  const after = await one(`SELECT count(*) FILTER (WHERE is_active)::int AS active, bool_or(boundary_geojson IS NOT NULL AND is_active) AS polygon_active FROM service_area_config`);
  check('a passenger cannot deactivate the area or replace its boundary (no row changes)', after.active === 1 && after.polygon_active === true, after);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
