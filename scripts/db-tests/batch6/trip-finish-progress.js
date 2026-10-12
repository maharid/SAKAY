// The driver may finish a trip at 90% progress, and the DATABASE enforces it (migration 20261017000001).
//   - progress is the apps' straight-line figure (packages/shared/src/utils/tripProgress.ts), from the fixes logged while the passenger is on board
//   - the boundary is inclusive and on the whole percent: 89 is refused, 90 is accepted, 95 is accepted, an arrived trip reads 100
//   - a driver cannot finish a trip the database has no position for; a position far away reads the floor
//   - repeating the finish does nothing: the fare is locked once, nothing is settled twice
//   - the LGU administrator and trusted server code are not changed by this gate; since Batch 9 neither is a driver whose passenger has asked to end the trip early
//     (the passenger's own "we have arrived" no longer exists: End Trip (Early) is a request)
// Whole migration chain on the local emulator (never Supabase).
const { setup, ID, DRIVERS, attempt, check, summary } = require('../b6fixtures');
const { DROPOFF } = require('../b5fixtures');

// The same straight-line distance the apps use (locationUtils.calculateDistanceKm), written out: km per degree 110.574 north and 108.29 east,
// rounded to 10 m. Golden values below are computed with that formula; the unit test server/test/tripProgress.test.ts checks the TypeScript
// function against the same table, so the two sides cannot drift apart.
const GOLDEN = [
  [[13.4115, 121.1803, 13.4415, 121.1803], 3.32],
  [[13.4115, 121.1803, 13.4115, 121.1903], 1.08],
  [[13.4117, 121.1803, 13.418, 121.185], 0.86],
  [[13.4115, 121.1803, 13.4116, 121.1803], 0.01],
  [[13.0, 121.0, 13.4415, 121.1803], 52.58],
];
const KM_PER_DEG_LAT = 110.574;

(async () => {
  const s = await setup();
  const { q, one, internal, as, rpc, PICKUP } = s;
  const driverSets = s.driverSets;
  const paxSets = (pax, bookingId, status) =>
    attempt(() => as(s.PAX[pax].uid, (tx) => tx.query(`UPDATE booking SET booking_status=$2 WHERE booking_id=$1 RETURNING *`, [bookingId, status])));
  const bookAndAccept = async (key = 'D1', pax = 'P1') => {
    const b = await s.bookAs(pax);
    const o = await s.pendingOffer(b.booking_id);
    if (!o || o.driver_id !== DRIVERS[key].id) throw new Error('expected an offer to ' + key + ': ' + JSON.stringify(o));
    const r = await s.accept(key, o.attempt_id);
    if (!r.success) throw new Error('accept failed ' + JSON.stringify(r));
    return s.booking(b.booking_id);
  };
  const boardedTrip = async () => {
    await s.online('D1', 300);
    const b = await bookAndAccept('D1', 'P1');
    for (const st of ['In Transit', 'Driver Arrived', 'Arrived at Pickup', 'Trip Ongoing']) {
      const r = await driverSets('D1', b.booking_id, st);
      if (!r.ok) throw new Error('walk to ' + st + ': ' + r.error);
    }
    return b;
  };
  const endTrip = async (b) => {
    await s.finish(b.booking_id);
    if ((await s.status(DRIVERS.D1.id)) !== 'Offline') await s.goOffline(DRIVERS.D1.uid);
  };
  // The driver's app publishes a fix that is `km` kilometres from the destination (south of it, on the same meridian): the real path, a heartbeat.
  const publishAt = (km, accuracy = 10) => rpc(DRIVERS.D1.uid, 'driver_heartbeat', [DROPOFF.lat - km / KM_PER_DEG_LAT, DROPOFF.lng, accuracy]);
  const progressOf = async (b) => (await one(`SELECT public._trip_progress_pct($1::uuid) AS p`, [b.booking_id])).p;
  const readAs = (uid, bookingId) => as(uid, (tx) => tx.query(`SELECT public.get_trip_progress($1) AS r`, [bookingId])).then((r) => r.rows[0].r);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('S1 the straight-line distance is the apps\' (golden values shared with the TypeScript unit test)');
  for (const [[a, b, c, d], km] of GOLDEN) {
    const db = (await one(`SELECT public._trip_progress_km($1::float8, $2::float8, $3::float8, $4::float8) AS v`, [a, b, c, d])).v;
    check(`_trip_progress_km(${a}, ${b} -> ${c}, ${d}) = ${km} km, as the apps compute it`, Math.abs(db - km) < 1e-9, db);
  }
  const TOTAL_KM = 3.32; // the pickup and the destination of these bookings

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS2 the numbers and the boundary: 89% is refused, 90% is accepted');
  let b = await boardedTrip();
  check('the trip is ongoing and the database has no fix of it yet: no progress is invented', (await progressOf(b)) === null);
  const noFix = await driverSets('D1', b.booking_id, 'Arrived at Destination');
  check('the driver cannot finish a trip whose position the database does not know', !noFix.ok && /ERR_TRIP_POSITION_UNKNOWN/.test(noFix.error), noFix);
  check('...and the booking is untouched (still Trip Ongoing, the fare not locked)', (await s.booking(b.booking_id)).booking_status === 'Trip Ongoing' && (await s.booking(b.booking_id)).fare_locked_at === null);

  await publishAt(0.36);                       // (3.32 - 0.36) / 3.32 = 89.2%
  check('a fix 0.36 km from the destination reads 89%', (await progressOf(b)) === 89, await progressOf(b));
  const r89 = await driverSets('D1', b.booking_id, 'Arrived at Destination');
  check('at 89% the driver cannot finish (the database says how far the trip is and what is needed)',
    !r89.ok && /ERR_TRIP_NOT_FAR_ENOUGH/.test(r89.error) && /89%/.test(r89.error) && /90%/.test(r89.error), r89);
  check('...and the booking is untouched (still Trip Ongoing, the fare not locked)', (await s.booking(b.booking_id)).booking_status === 'Trip Ongoing' && (await s.booking(b.booking_id)).fare_locked_at === null);
  check('get_trip_progress agrees for the driver and the passenger: 89%, not finishable', await (async () => {
    const d = await readAs(DRIVERS.D1.uid, b.booking_id);
    const p = await readAs(s.PAX.P1.uid, b.booking_id);
    return d.progress_pct === 89 && d.min_finish_pct === 90 && d.can_finish === false && p.progress_pct === 89 && p.can_finish === false && d.phase === 'ongoing';
  })());

  await publishAt(0.33);                       // (3.32 - 0.33) / 3.32 = 90.06%
  check('a fix 0.33 km from the destination reads 90%', (await progressOf(b)) === 90, await progressOf(b));
  check('get_trip_progress says the driver may finish', (await readAs(DRIVERS.D1.uid, b.booking_id)).can_finish === true);
  const r90 = await driverSets('D1', b.booking_id, 'Arrived at Destination');
  check('at exactly 90% the driver can finish; the final fare is locked by the database in the same update',
    r90.ok && r90.value.rows[0].booking_status === 'Arrived at Destination' && r90.value.rows[0].fare_locked_at !== null && r90.value.rows[0].actual_fare !== null, r90.ok ? r90.value.rows[0] : r90.error);
  check('an arrived trip reads 100% for both screens', (await readAs(DRIVERS.D1.uid, b.booking_id)).progress_pct === 100 && (await readAs(s.PAX.P1.uid, b.booking_id)).progress_pct === 100);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS3 repeated finishing does nothing: the fare is locked once and nothing is settled twice');
  const locked = await s.booking(b.booking_id);
  const ledgerBefore = (await q(`SELECT count(*)::int AS n FROM fare_adjustment_history WHERE booking_id='${b.booking_id}'`))[0].n;
  const again = [];
  for (let i = 0; i < 3; i++) again.push(await driverSets('D1', b.booking_id, 'Arrived at Destination'));
  const after = await s.booking(b.booking_id);
  check('three more "finish" requests are accepted as no-ops', again.every((r) => r.ok && r.value.rows[0].booking_status === 'Arrived at Destination'), again.map((r) => r.ok || r.error));
  check('the fare, its lock time and the breakdown are exactly as the first finish left them',
    String(after.fare_locked_at) === String(locked.fare_locked_at) && Number(after.actual_fare) === Number(locked.actual_fare)
    && JSON.stringify(after.fare_breakdown) === JSON.stringify(locked.fare_breakdown), { before: locked.fare_locked_at, after: after.fare_locked_at });
  check('no second fare adjustment was recorded', (await q(`SELECT count(*)::int AS n FROM fare_adjustment_history WHERE booking_id='${b.booking_id}'`))[0].n === ledgerBefore);
  const early1 = await driverSets('D1', b.booking_id, 'Completed');
  const early2 = await driverSets('D1', b.booking_id, 'Completed');
  check('the driver cannot complete the trip by writing the status, however often he asks (Batch 9: Completed is the Payment Received tap, which waits for the passenger)',
    !early1.ok && !early2.ok && /ERR_USE_PAYMENT_RECEIVED/.test(early1.error) && /ERR_USE_PAYMENT_RECEIVED/.test(early2.error), { early1, early2 });
  const confirmed = await s.rpcAs(s.PAX.P1.uid, 'public.passenger_confirm_fare($1)', [b.booking_id]);
  const paid = await s.rpcAs(s.DRIVERS.D1.uid, 'public.driver_confirm_payment_received($1)', [b.booking_id]);
  const completedAt = (await s.booking(b.booking_id)).trip_completed_at;
  const paidAgain = await s.rpcAs(s.DRIVERS.D1.uid, 'public.driver_confirm_payment_received($1)', [b.booking_id]);
  const afterPaid = await s.booking(b.booking_id);
  check('the passenger confirms the fare and the driver taps Payment Received once (Completed); a second tap changes nothing (the completion time and the fare stay)',
    confirmed.success && paid.success && paidAgain.success && paidAgain.already_received === true && String(afterPaid.trip_completed_at) === String(completedAt) && Number(afterPaid.actual_fare) === Number(locked.actual_fare), { confirmed, paid, paidAgain });
  check('a finished trip cannot be finished again as a new arrival (it cannot go back to the destination from Completed)',
    !(await driverSets('D1', b.booking_id, 'Arrived at Destination')).ok);
  await endTrip(b);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS4 95% (within the near-destination distance) and the floor');
  b = await boardedTrip();
  await publishAt(20);                         // 20 km away: far past the pickup, the floor
  check('a position far from the destination reads the floor (5%), not a negative figure', (await progressOf(b)) === 5, await progressOf(b));
  const far = await driverSets('D1', b.booking_id, 'Arrived at Destination');
  check('and the driver cannot finish from there', !far.ok && /ERR_TRIP_NOT_FAR_ENOUGH/.test(far.error) && /5%/.test(far.error), far);
  await publishAt(0.07);                       // inside 80 m of the pin
  check('within 80 m of the pin the progress reads its maximum while the trip is on: 95% (100% is only for an arrived trip)', (await progressOf(b)) === 95, await progressOf(b));
  const r95 = await driverSets('D1', b.booking_id, 'Arrived at Destination');
  check('at 95% the driver can finish', r95.ok && r95.value.rows[0].fare_locked_at !== null, r95);
  await endTrip(b);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS5 the progress the trip has reached is kept; fixes the heartbeat would not publish do not count');
  b = await boardedTrip();
  await publishAt(0.2);                        // 93.98 -> 94%
  await publishAt(1.5);                        // the tricycle drives off to park elsewhere: 54.8 -> 55%
  check('the best progress is kept when the position later moves away (the screens show it the same way)', (await progressOf(b)) === 94, await progressOf(b));
  const bad = await publishAt(0.05, 120);      // a fix worse than 100 m accuracy is not published and not logged (Batch 4)
  check('a fix worse than 100 m is not published, so it cannot raise the progress', bad.location_accepted === false && (await progressOf(b)) === 94, bad);
  await internal(`DELETE FROM gps_log WHERE booking_id='${b.booking_id}'`);
  await internal(`INSERT INTO gps_log (booking_id, driver_id, latitude, longitude, accuracy, recorded_at)
                  VALUES ('${b.booking_id}', '${ID.D1}', ${DROPOFF.lat}, ${DROPOFF.lng}, 150, now())`);
  check('a fix with accuracy over 100 m is never trusted for the finish, even if one were somehow in the log', (await progressOf(b)) === null, await progressOf(b));
  const noTrust = await driverSets('D1', b.booking_id, 'Arrived at Destination');
  check('so the driver cannot finish on it', !noTrust.ok && /ERR_TRIP_POSITION_UNKNOWN/.test(noTrust.error), noTrust);
  await endTrip(b);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS6 who is NOT held to the gate');
  b = await boardedTrip();
  const paxFinish = await paxSets('P1', b.booking_id, 'Arrived at Destination');
  check('the passenger no longer ends the trip by writing the status (Batch 9, D9-6: End Trip (Early) is a REQUEST)', !paxFinish.ok && /ERR_USE_EARLY_END/.test(paxFinish.error), paxFinish);
  const asked = await s.rpcAs(s.PAX.P1.uid, 'public.passenger_request_early_end($1,$2,$3)', [b.booking_id, 'changed_plans', null]);
  check('...but once the passenger has asked, the driver is not held to the gate: before any fix he can end the trip (Rule 13.2)', asked.success && (await driverSets('D1', b.booking_id, 'Arrived at Destination')).ok, asked);
  await endTrip(b);
  b = await boardedTrip();
  const lgu = await attempt(() => as(ID.L_AUTH, (tx) => tx.query(`UPDATE booking SET booking_status='Arrived at Destination' WHERE booking_id=$1 RETURNING booking_status`, [b.booking_id])));
  check('an LGU administrator (support) can move a stuck trip', lgu.ok && lgu.value.rows[0].booking_status === 'Arrived at Destination', lgu);
  await endTrip(b);
  b = await boardedTrip();
  const trusted = await attempt(() => internal(`UPDATE booking SET booking_status='Arrived at Destination' WHERE booking_id='${b.booking_id}'`));
  check('trusted server code can too', trusted.ok === true, trusted);
  await endTrip(b);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS7 who may read the progress');
  b = await boardedTrip();
  await publishAt(0.33);
  const stranger = await readAs(s.PAX.P2.uid, b.booking_id);
  check('somebody who is not on the booking gets nothing', stranger.success === false && stranger.progress_pct === undefined, stranger);
  const otherDriver = await readAs(DRIVERS.D2.uid, b.booking_id);
  check('nor does another driver', otherDriver.success === false, otherDriver);
  const anon = await attempt(() => s.anon((tx) => tx.query(`SELECT public.get_trip_progress($1)`, [b.booking_id])));
  check('nor a caller who is not signed in', !anon.ok, anon);
  const direct = await attempt(() => as(DRIVERS.D1.uid, (tx) => tx.query(`SELECT public._trip_progress_pct($1)`, [b.booking_id])));
  check('the internal progress function cannot be called from the app directly', !direct.ok && /permission denied/.test(direct.error), direct);
  await endTrip(b);

  console.log('\nS8 a booking that is not on board reads 0');
  await s.online('D1', 300);
  const early = await bookAndAccept('D1', 'P1');
  const zero = await readAs(DRIVERS.D1.uid, early.booking_id);
  check('before the passenger is on board the progress is 0 and the trip cannot be finished', zero.progress_pct === 0 && zero.can_finish === false && zero.phase === 'assigned', zero);
  await endTrip(early);

  console.log(`\n(pickup ${PICKUP.lat},${PICKUP.lng} -> destination ${DROPOFF.lat},${DROPOFF.lng}: ${TOTAL_KM} km)`);
  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
