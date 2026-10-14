// Shared helpers for the Batch 10 (ride-sharing) suites. They run the WHOLE migration chain on the Batch 9 fixtures (users, two TODAs, drivers placed N metres
// from the pickup, an LGU administrator and one TODA administrator per TODA) and add: two more passengers, a Shared Trip under way (the "host"), a second
// Shared booking beside it, the calls the apps make for the pairing (the driver's and the first passenger's answers, the disclosure), the GPS track of a
// vehicle that carries both, and clocks that can be wound back (the database holds every deadline).
const base = require('./b9fixtures');

const { ID, DRIVERS, PAX, attempt, check, summary, asUser, north } = base;

const EXTRA = {
  P3: { id: 'a0000000-0000-0000-0000-000000000003', uid: '10000000-0000-0000-0000-000000000003', name: 'Pax Three', phone: '+639170000003' },
  P4: { id: 'a0000000-0000-0000-0000-000000000004', uid: '10000000-0000-0000-0000-000000000004', name: 'Pax Four', phone: '+639170000004' },
};
const ALL_PAX = { ...PAX, P3: EXTRA.P3, P4: EXTRA.P4 };

// One degree of latitude is ~111.195 km (the same figure b6fixtures uses)
const DEG_PER_M = 1 / 111195;

async function setup(until = null) {
  const s = await base.setup(until);
  const { q, one, internal, as, svc, db } = s;

  await internal(`
    INSERT INTO auth.users(id, email) VALUES ('${EXTRA.P3.uid}', 'u8@x.com'), ('${EXTRA.P4.uid}', 'u9@x.com');
    INSERT INTO public.passenger(passenger_id, auth_user_id, full_name, contact_number, account_status) VALUES
      ('${EXTRA.P3.id}', '${EXTRA.P3.uid}', '${EXTRA.P3.name}', '${EXTRA.P3.phone}', 'Active'),
      ('${EXTRA.P4.id}', '${EXTRA.P4.uid}', '${EXTRA.P4.name}', '${EXTRA.P4.phone}', 'Active')`);
  // a plate and a franchise for the driver block of the disclosure
  await internal(`UPDATE public.driver SET plate_number = 'ABC-1234', franchise_number = 'FR-0001' WHERE driver_id = '${ID.D1}';
                  UPDATE public.driver SET plate_number = 'XYZ-9876', franchise_number = 'FR-0002' WHERE driver_id = '${ID.D2}'`);

  const rpc = (uid, sql, args = []) => s.rpcAs(uid, `public.${sql}`, args);
  // A Shared booking exactly as the app inserts it (the quote is the database's). o: km, pax, pickup, dropoff, extra
  // The route distance of a booking whose points are not the standard pair: the straight line between them plus 10 % (the database refuses a distance that
  // does not fit the points, so the screen's OSRM figure is imitated).
  const straightKm = (p1, p2) => {
    const dy = (p2.lat - p1.lat) * 111195;
    const dx = (p2.lng - p1.lng) * 111195 * Math.cos(p1.lat * Math.PI / 180);
    return Math.sqrt(dx * dx + dy * dy) / 1000;
  };
  const kmFor = (o) => (o.km !== undefined ? o.km : (o.pickup || o.dropoff) ? Number((straightKm(o.pickup ?? s.PICKUP, o.dropoff ?? s.DROPOFF) * 1.1).toFixed(3)) : 3.3);
  const sharedBook = (pax, o = {}) => s.book(ALL_PAX[pax].uid, ALL_PAX[pax].id, { shared: true, ...o, km: kmFor(o) });
  const soloBook = (pax, o = {}) => s.book(ALL_PAX[pax].uid, ALL_PAX[pax].id, { shared: false, fare: undefined, ...o, km: kmFor(o) });
  const at = (northM, eastM = 0) => ({ lat: s.PICKUP.lat + northM * DEG_PER_M, lng: s.PICKUP.lng + eastM * DEG_PER_M / Math.cos(s.PICKUP.lat * Math.PI / 180) });
  const match = (id) => one(`SELECT * FROM shared_trip_match WHERE match_id = '${id}'`);
  const matchOf = (bookingId) => one(`SELECT * FROM shared_trip_match WHERE primary_booking_id = '${bookingId}' OR additional_booking_id = '${bookingId}' ORDER BY created_at DESC LIMIT 1`);
  const matchesOf = (bookingId) => q(`SELECT * FROM shared_trip_match WHERE primary_booking_id = '${bookingId}' OR additional_booking_id = '${bookingId}' ORDER BY created_at`);
  const bk = (id) => one(`SELECT * FROM booking WHERE booking_id = '${id}'`);

  // The Shared Trip under way: `driver` (online `driverNorth` m from the pickup) has accepted a Shared booking of `pax`; `stage` says how far it is:
  // 'assigned' (on the way to the pickup), 'arrived' or 'ongoing' (the passenger is on board).
  const host = async ({ driver = 'D1', pax = 'P1', driverNorth = 300, stage = 'assigned', count = 1, o = {} } = {}) => {
    await s.online(driver, driverNorth);
    const b = await sharedBook(pax, { pax: count, ...o });
    const offer = await s.pendingOffer(b.booking_id);
    if (!offer || offer.driver_id !== DRIVERS[driver].id) throw new Error('host: expected an offer to ' + driver + ', got ' + JSON.stringify(offer));
    const r = await s.accept(driver, offer.attempt_id);
    if (!r.success) throw new Error('host: accept failed ' + JSON.stringify(r));
    if (stage === 'arrived' || stage === 'ongoing') {
      for (const st of ['In Transit', 'Driver Arrived'].concat(stage === 'ongoing' ? ['Trip Ongoing'] : [])) {
        const w = await s.driverSets(driver, b.booking_id, st);
        if (!w.ok) throw new Error('host: ' + st + ': ' + w.error);
      }
    }
    return s.booking(b.booking_id);
  };
  // The sweep (what the scheduled job and every online driver's poll run)
  const sweep = () => s.sweep();
  // The driver's pending shared request, the driver's answer, the passenger's answer, the disclosure
  const myRequest = (key) => rpc(DRIVERS[key].uid, 'get_my_shared_request()');
  const driverAnswer = (key, matchId, accept) => rpc(DRIVERS[key].uid, 'driver_respond_shared_request($1, $2)', [matchId, accept]);
  const paxAnswer = (pax, matchId, accept) => rpc(ALL_PAX[pax].uid, 'passenger_respond_shared_match($1, $2)', [matchId, accept]);
  const state = (pax, bookingId) => rpc(ALL_PAX[pax].uid, 'get_shared_match_state($1)', [bookingId]);
  const report = (key, bookingId, actual, note = null) => rpc(DRIVERS[key].uid, 'driver_report_passenger_count($1, $2, $3)', [bookingId, actual, note]);

  // Wind the proposal's clocks back by `sec` seconds (the database holds the deadlines)
  const matchAgo = (matchId, sec) => internal(`UPDATE shared_trip_match SET driver_expires_at = driver_expires_at - interval '${sec} seconds',
      passenger_expires_at = passenger_expires_at - interval '${sec} seconds' WHERE match_id = '${matchId}';
    UPDATE booking SET dispatch_next_action_at = dispatch_next_action_at - interval '${sec} seconds'
     WHERE booking_id = (SELECT additional_booking_id FROM shared_trip_match WHERE match_id = '${matchId}')`);

  // A proposal for a second booking beside the host: books it and returns the pairing the engine proposed (or undefined).
  const propose = async ({ pax = 'P2', pickupNorth = 150, dropNorth = null, count = 1, o = {} } = {}) => {
    const dropoff = dropNorth === null ? s.DROPOFF : at(dropNorth);
    const b = await sharedBook(pax, { pax: count, pickup: at(pickupNorth), dropoff, ...o });
    return { b, m: await matchOf(b.booking_id) };
  };
  // The whole agreement: driver Accept, first passenger Accept
  const agree = async (m, { driver = 'D1', first = 'P1' } = {}) => {
    const d = await driverAnswer(driver, m.match_id, true);
    if (!d.success) throw new Error('driver answer: ' + JSON.stringify(d));
    const p = await paxAnswer(first, m.match_id, true);
    if (!p.success) throw new Error('passenger answer: ' + JSON.stringify(p));
    return match(m.match_id);
  };

  // Write the GPS fixes of a vehicle that is carrying `bookingIds` (a published fix is logged against every trip in progress): from the pickup northwards,
  // `from`..`to` fixes (inclusive), 100 m and 5 s apart, from `startAt`. The accuracy is 10 m. Returns the km of the span (about 0.1 per step).
  const STEP_DEG = 0.0009;
  const track = async (bookingIds, driverKey, from, to, { startAt = '2026-10-07T01:00:00Z', accuracy = 10 } = {}) => {
    for (const id of bookingIds) {
      await db.query(
        `INSERT INTO public.gps_log (booking_id, driver_id, latitude, longitude, accuracy, recorded_at)
         SELECT $1, $2, $3::float8 + i * $4::float8, $5::float8, $6::float8, $7::timestamptz + (i * 5) * interval '1 second'
           FROM generate_series($8::int, $9::int) AS i`,
        [id, DRIVERS[driverKey].id, s.PICKUP.lat, STEP_DEG, s.PICKUP.lng, accuracy, startAt, from, to]);
    }
  };
  // when the fix number i was recorded
  const trackTime = (i, startAt = '2026-10-07T01:00:00Z') => new Date(new Date(startAt).getTime() + i * 5000).toISOString();
  // set the recorded start of a trip (the status guard stamps the real clock; the track lives in the past)
  const startedAt = (bookingId, ts) => internal(`UPDATE booking SET trip_started_at = '${ts}' WHERE booking_id = '${bookingId}'`);
  // The driver's own position (the fix the sweep and the matching read)
  const driverIsAt = (key, northM, acc = 10) => internal(`UPDATE driver SET current_latitude = ${s.PICKUP.lat + northM * DEG_PER_M}, current_longitude = ${s.PICKUP.lng},
        last_location_update = clock_timestamp(), last_location_accuracy_m = ${acc} WHERE driver_id = '${DRIVERS[key].id}'`);
  // Raise the progress the database holds for a booking to exactly `pct` (a fix on the straight line pickup -> destination; the figure only goes up)
  const setProgress = async (bookingId, driverKey, pct) => {
    const b = await bk(bookingId);
    const f = pct / 100;
    const lat = Number(b.pickup_latitude) + f * (Number(b.dropoff_latitude) - Number(b.pickup_latitude));
    await db.query(`INSERT INTO public.gps_log (booking_id, driver_id, latitude, longitude, accuracy, recorded_at) VALUES ($1, $2, $3, $4, 10, clock_timestamp())`,
      [bookingId, DRIVERS[driverKey].id, lat, Number(b.pickup_longitude)]);
    await internal(`UPDATE driver SET current_latitude = ${lat}, current_longitude = ${Number(b.pickup_longitude)}, last_location_update = clock_timestamp(), last_location_accuracy_m = 10
                     WHERE driver_id = '${DRIVERS[driverKey].id}'`);
    return (await one(`SELECT public._trip_progress_pct('${bookingId}'::uuid) AS p`)).p;
  };
  const strikesOf = (subjectId) => q(`SELECT violation_code, status, points_active FROM strikes_ledger WHERE subject_id = '${subjectId}' AND status <> 'VOIDED' ORDER BY issued_at`);

  return { ...s, EXTRA, ALL_PAX, DEG_PER_M, rpc, sharedBook, soloBook, at, match, matchOf, matchesOf, bk, host, sweep, myRequest, driverAnswer, paxAnswer, state, report,
           matchAgo, propose, agree, track, trackTime, startedAt, driverIsAt, setProgress, strikesOf, STEP_DEG };
}

module.exports = { setup, ID, DRIVERS, PAX, ALL_PAX, EXTRA, north, attempt, check, summary, asUser };
