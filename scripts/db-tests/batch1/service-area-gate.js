// The service-area gate (Batch 1, PI-01) checks BOTH ends of a trip. Before 20261016000001 it checked only the pickup, so a destination in
// Puerto Galera (about 26 km from the centre of the service area) was accepted and priced. SAKAY serves Calapan City only: a trip must start
// and end inside the active service area. Whole migration chain on the local emulator (never Supabase).
const { setup, ID, attempt, check, summary, PICKUP } = require('../b6fixtures');

(async () => {
  const s = await setup();
  const { q, one, as, internal } = s;
  const err = (r) => (r.ok ? 'booking was accepted' : r.error);
  // A point `km` kilometres due north of the active service area's centre (a degree of latitude is 6371 * pi / 180 km).
  const area = await one(`SELECT center_latitude AS lat, center_longitude AS lng, radius_km AS km FROM service_area_config WHERE is_active`);
  const northOfCentre = (km) => ({ lat: area.lat + km / ((6371 * Math.PI) / 180), lng: area.lng });
  // The fare guard (Batch 5) runs first and wants a road distance that is plausible for the two points, as the app's OSRM route would be.
  const straightKm = (a, b) => {
    const rad = (d) => (d * Math.PI) / 180;
    const x = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  };
  const bookAt = async (pickup, dropoff, who = 'P1') => {
    const km = Math.round(straightKm(pickup, dropoff) * 1.15 * 100) / 100;
    const r = await attempt(() => s.book(who === 'P1' ? ID.P_AUTH : ID.P2_AUTH, who === 'P1' ? ID.P1 : ID.P2, { km, pickup, dropoff }));
    if (r.ok) await s.finish(r.value.booking_id);                // so the next attempt is not stopped by Rule 4.4
    return r;
  };

  console.log('The service area in force');
  check('one active service area exists: Calapan City, a 16 km circle (PI-01 Option C, a temporary variant)', Number(area.km) === 16 && Math.abs(area.lat - 13.4117) < 0.01 && Math.abs(area.lng - 121.1803) < 0.01, area);

  console.log('\nThe destination is checked (this is the reported bug)');
  const PUERTO_GALERA = { lat: 13.5018, lng: 120.9546 };
  let r = await bookAt(PICKUP, PUERTO_GALERA);
  check('a pickup in Calapan with a destination in Puerto Galera is refused', !r.ok && /ERR_DESTINATION_OUT_OF_SERVICE_AREA/.test(r.error), err(r));
  check('...and the message is Tagalog and says how far outside it is', /destinasyon/i.test(r.error || '') && /limitasyon: 16/.test(r.error || ''), r.error);
  r = await bookAt(PICKUP, { lat: 14.5995, lng: 120.9842 });
  check('a destination in Manila is refused too', !r.ok && /ERR_DESTINATION_OUT_OF_SERVICE_AREA/.test(r.error), err(r));
  r = await bookAt(PICKUP, northOfCentre(16.2));
  check('a destination just outside the circle (16.2 km) is refused', !r.ok && /ERR_DESTINATION_OUT_OF_SERVICE_AREA/.test(r.error), err(r));
  r = await bookAt(PICKUP, northOfCentre(15.8));
  check('a destination just inside it (15.8 km) is accepted', r.ok === true, err(r));
  r = await bookAt(PICKUP, { lat: PICKUP.lat + 0.03, lng: PICKUP.lng });
  check('an ordinary trip inside Calapan (3.3 km) is accepted', r.ok === true, err(r));

  console.log('\nThe pickup is still checked, with its own code');
  r = await bookAt(PUERTO_GALERA, PICKUP);
  check('a pickup in Puerto Galera is refused with the pickup code (unchanged)', !r.ok && /ERR_OUT_OF_SERVICE_AREA/.test(r.error) && !/DESTINATION/.test(r.error), err(r));
  r = await bookAt(PUERTO_GALERA, { lat: 13.51, lng: 120.96 });
  check('a trip that is wholly outside is refused on the pickup first', !r.ok && /ERR_OUT_OF_SERVICE_AREA/.test(r.error) && !/DESTINATION/.test(r.error), err(r));

  console.log('\nThe gate follows the configured area, not a fixed number');
  // The LGU administrator narrows the area to the pilot: a 1.5 km circle around TODA One's terminal (set_pilot_service_area).
  const narrowed = (await as(ID.L_AUTH, (tx) => tx.query(`SELECT public.set_pilot_service_area($1, 1.5) AS r`, [ID.TODA1]))).rows[0].r;
  check('the LGU administrator can narrow the service area to a pilot terminal', narrowed.success === true, narrowed);
  r = await bookAt(PICKUP, { lat: PICKUP.lat + 0.03, lng: PICKUP.lng });
  check('with a 1.5 km area, a trip that ends 3.3 km away (still inside the city) is refused at the destination', !r.ok && /ERR_DESTINATION_OUT_OF_SERVICE_AREA/.test(r.error), err(r));
  r = await bookAt(PICKUP, { lat: PICKUP.lat + 0.004, lng: PICKUP.lng });
  check('a short trip inside the pilot area is accepted', r.ok === true, err(r));
  const act = await q(`SELECT count(*)::int AS n FROM service_area_config WHERE is_active`);
  check('there is still exactly one active service area', act[0].n === 1, act);

  console.log('\nOnly the booking insert is gated, and a stranger cannot widen the area');
  const widen = await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`UPDATE service_area_config SET radius_km = 500 WHERE is_active`)));
  const after = await one(`SELECT radius_km FROM service_area_config WHERE is_active`);
  check('a passenger cannot widen the service area (no row changes)', Number(after.radius_km) === 1.5, { widen, after });
  void internal;

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
