// Batch 5 / T4 + T5: the booking row is bound to the fare rules by the database.
//   T4  the final fare, the estimate, pickup and destination cannot be edited by passenger or driver
//   T5  a scheduled / future booking is rejected
//   plus: the estimate is the database's (a tampered or stale fare is refused), the rule is snapshotted,
//         and the final fare is computed once, by the database, when the trip arrives.
const { setup, check, summary } = require('../b5fixtures');

(async () => {
  const t = await setup();
  const { as, anon, svc, q, one, book, quote, getBooking, assign, setStatus, attempt, num, ID, PICKUP, DROPOFF } = t;
  const R1 = (await one(`SELECT fare_matrix_id FROM public.fare_matrix`)).fare_matrix_id;
  // Finish a booking so the passenger can book again (Batch 2: one open booking per passenger).
  const done = (id) => svc((tx) => tx.query(`UPDATE public.booking SET booking_status = 'Completed' WHERE booking_id = $1`, [id]));
  const err = (a) => (a.ok ? 'no error' : a.error);

  console.log('The estimate is the database\'s (Rules 6.2, 6.3, 6.5)');
  let b = await book(ID.P_AUTH, ID.P1, { km: 5 });
  check('a Solo booking of 5 km: estimate 72, rule R1 snapshotted, no final fare yet, not locked',
    num(b.estimated_fare) === 72 && b.fare_matrix_id === R1 && b.actual_fare === null && b.actual_distance_km === null && b.fare_locked_at === null && b.booking_type === 'Immediate', b);
  check('the snapshot carries the rule values and the estimate breakdown (what a receipt prints)',
    num(b.fare_breakdown.rule.base_fare) === 15 && num(b.fare_breakdown.rule.succeeding_rate) === 1 && num(b.fare_breakdown.estimate.solo_fare) === 72 && num(b.fare_breakdown.estimate.seat_fare) === 18 && b.fare_breakdown.final === null, b.fare_breakdown);
  await done(b.booking_id);

  let a = await attempt(() => book(ID.P_AUTH, ID.P1, { km: 5, extra: { actual_fare: 1, created_at: '2020-01-01T00:00:00Z' } }));
  check('a client-supplied actual_fare is discarded and created_at is the server clock, not the device\'s',
    a.ok && a.value.actual_fare === null && Math.abs(Date.now() - new Date(a.value.created_at).getTime()) < 60000 && Math.abs(Date.now() - new Date(a.value.requested_at).getTime()) < 60000, a.ok ? a.value : a);
  if (a.ok) await done(a.value.booking_id);

  a = await attempt(() => book(ID.P_AUTH, ID.P1, { km: 5, fare: 1 }));
  check('a tampered estimate (1.00 for a 72 trip) is refused (ERR_FARE_MISMATCH)', !a.ok && /ERR_FARE_MISMATCH/.test(a.error) && /expected=72/.test(a.error), err(a));
  a = await attempt(() => book(ID.P_AUTH, ID.P1, { km: 5, fare: 73 }));
  check('...and so is a fare that is merely a peso off', !a.ok && /ERR_FARE_MISMATCH/.test(a.error), err(a));
  check('nothing was inserted by the refused bookings', (await one(`SELECT count(*)::int n FROM public.booking WHERE booking_status NOT IN ('Completed')`)).n === 0);

  b = await book(ID.P_AUTH, ID.P1, { km: 5, shared: true });
  check('a Shared booking stores the Matched Shared Fare Estimate (36) and the Maximum Unmatched Fare (72)',
    num(b.estimated_fare) === 36 && num(b.fare_breakdown.estimate.max_unmatched_fare) === 72 && num(b.fare_breakdown.estimate.shared_matched_estimate) === 36 && b.is_shared_trip === true, b.fare_breakdown);
  await done(b.booking_id);
  b = await book(ID.P_AUTH, ID.P1, { km: 5, pax: 2 });
  check('a 2-passenger Solo booking is still the whole tricycle: 72', num(b.estimated_fare) === 72, b);
  await done(b.booking_id);

  console.log('\nT5  No scheduled or future bookings (Rule 6.6)');
  a = await attempt(() => book(ID.P_AUTH, ID.P1, { km: 5, type: 'Scheduled' }));
  check('booking_type = Scheduled is rejected', !a.ok && /ERR_SCHEDULED_BOOKING_NOT_SUPPORTED/.test(a.error), err(a));
  a = await attempt(() => svc((tx) => tx.query(`INSERT INTO public.booking (passenger_id, booking_type, passenger_count, pickup_address, pickup_latitude, pickup_longitude, dropoff_address, dropoff_latitude, dropoff_longitude, booking_status) VALUES ($1, 'Scheduled', 1, 'A', 13.4115, 121.1803, 'B', 13.42, 121.19, 'Completed')`, [ID.P1])));
  check('...even from trusted server code', !a.ok && /ERR_SCHEDULED_BOOKING_NOT_SUPPORTED/.test(a.error), err(a));
  a = await attempt(() => book(ID.P_AUTH, ID.P1, { km: 5, extra: { requested_at: new Date(Date.now() + 86400000).toISOString() } }));
  check('a pickup requested for tomorrow is rejected', !a.ok && /ERR_FUTURE_BOOKING_NOT_SUPPORTED/.test(a.error), err(a));
  a = await attempt(() => book(ID.P_AUTH, ID.P1, { km: 5, extra: { requested_at: new Date(Date.now() + 60000).toISOString() } }));
  check('a request time one minute ahead (clock skew) is accepted and replaced by the server time', a.ok && new Date(a.value.requested_at).getTime() <= Date.now() + 1000, err(a));
  if (a.ok) await done(a.value.booking_id);
  check('there is no way to store anything but Immediate (CHECK constraint as a backstop)',
    (await one(`SELECT count(*)::int n FROM pg_constraint WHERE conname = 'booking_type_immediate_only' AND convalidated`)).n === 1);

  console.log('\nA booking needs a real route distance (decision D5) and it must be plausible');
  a = await attempt(() => book(ID.P_AUTH, ID.P1, { noDistance: true, fare: 72 }));
  check('no distance: refused (ERR_DISTANCE_REQUIRED)', !a.ok && /ERR_DISTANCE_REQUIRED/.test(a.error), err(a));
  a = await attempt(() => book(ID.P_AUTH, ID.P1, { km: 0, fare: 60 }));
  check('zero distance: refused', !a.ok && /ERR_DISTANCE_REQUIRED/.test(a.error), err(a));
  a = await attempt(() => book(ID.P_AUTH, ID.P1, { km: 0.4, fare: 60 }));
  check('0.4 km between points 3.3 km apart: implausible (a road is never that much shorter than the straight line)', !a.ok && /ERR_DISTANCE_IMPLAUSIBLE/.test(a.error), err(a));
  a = await attempt(() => book(ID.P_AUTH, ID.P1, { km: 40, fare: 200 }));
  check('40 km between points 3.3 km apart: implausible', !a.ok && /ERR_DISTANCE_IMPLAUSIBLE/.test(a.error), err(a));
  a = await attempt(() => book(ID.P_AUTH, ID.P1, { km: 3.0 }));
  check('3.0 km (a road a little shorter than the 3.34 km straight line, within the snapping slack) is accepted', a.ok, err(a));
  if (a.ok) await done(a.value.booking_id);
  a = await attempt(() => book(ID.P_AUTH, ID.P1, { km: 10.4 }));
  check('10.4 km (about 3x the straight line) is accepted', a.ok, err(a));
  if (a.ok) await done(a.value.booking_id);
  a = await attempt(() => svc((tx) => tx.query(`INSERT INTO public.booking (passenger_id, passenger_count, pickup_address, pickup_latitude, pickup_longitude, dropoff_address, dropoff_latitude, dropoff_longitude, booking_status) VALUES ($1, 1, 'A', 13.4115, 121.1803, 'B', 13.42, 121.19, 'Completed') RETURNING fare_breakdown, estimated_fare`, [ID.P1])));
  check('trusted server code (imports, repairs) may still insert a row without a quote; it carries no fare', a.ok && a.value.rows[0].fare_breakdown === null && a.value.rows[0].estimated_fare === null, err(a));

  console.log('\nT4  Nobody can edit the fare, the estimate, pickup or destination afterwards');
  const B = await book(ID.P_AUTH, ID.P1, { km: 5 });
  await assign(B.booking_id, ID.D1);
  const roles = [
    ['the booking\'s passenger', (fn) => as(ID.P_AUTH, fn)],
    ['another passenger', (fn) => as(ID.P2_AUTH, fn)],
    ['the assigned driver', (fn) => as(ID.D_AUTH, fn)],
    ['an unrelated driver', (fn) => as(ID.D2_AUTH, fn)],
    ['a TODA administrator', (fn) => as(ID.T_AUTH, fn)],
    ['the LGU administrator', (fn) => as(ID.L_AUTH, fn)],
    ['an anonymous caller', (fn) => anon(fn)],
  ];
  const edits = [
    ['estimated_fare', 'estimated_fare = 1', 'ERR_BOOKING_LOCKED'],
    ['pickup_latitude', 'pickup_latitude = 13.0', 'ERR_BOOKING_LOCKED'],
    ['pickup_longitude', 'pickup_longitude = 121.0', 'ERR_BOOKING_LOCKED'],
    ['pickup_address', `pickup_address = 'Elsewhere'`, 'ERR_BOOKING_LOCKED'],
    ['dropoff_latitude', 'dropoff_latitude = 13.1', 'ERR_BOOKING_LOCKED'],
    ['dropoff_longitude', 'dropoff_longitude = 121.0', 'ERR_BOOKING_LOCKED'],
    ['dropoff_address', `dropoff_address = 'Elsewhere'`, 'ERR_BOOKING_LOCKED'],
    ['estimated_distance_km', 'estimated_distance_km = 0.5', 'ERR_BOOKING_LOCKED'],
    ['passenger_count', 'passenger_count = 3', 'ERR_BOOKING_LOCKED'],
    ['is_shared_trip', 'is_shared_trip = NOT is_shared_trip', 'ERR_BOOKING_LOCKED'],
    ['booking_type', `booking_type = 'Scheduled'`, 'ERR_BOOKING_LOCKED'],
    ['fare_matrix_id', 'fare_matrix_id = NULL', 'ERR_BOOKING_LOCKED'],
    ['fare_breakdown', `fare_breakdown = '{}'::jsonb`, 'ERR_BOOKING_LOCKED'],
    ['actual_fare', 'actual_fare = 1', 'ERR_FARE_LOCKED'],
    ['actual_distance_km', 'actual_distance_km = 0.1', 'ERR_FARE_LOCKED'],
    ['fare_locked_at', 'fare_locked_at = now()', 'ERR_FARE_LOCKED'],
  ];
  const snapshot = async () => JSON.stringify(await getBooking(B.booking_id));
  const before = await snapshot();
  for (const [label, run] of roles) {
    const failures = [];
    for (const [col, set, code] of edits) {
      const r = await attempt(() => run((tx) => tx.query(`UPDATE public.booking SET ${set} WHERE booking_id = $1`, [B.booking_id])));
      if (r.ok || !r.error.includes(code)) failures.push({ col, got: err(r) });
    }
    check(`${label} cannot change any of the ${edits.length} locked columns`, failures.length === 0, failures);
  }
  check('the booking row is byte-for-byte unchanged after all those attempts', (await snapshot()) === before);

  let r = await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`UPDATE public.booking SET estimated_fare = estimated_fare, pickup_latitude = pickup_latitude WHERE booking_id = $1`, [B.booking_id])));
  check('writing the same values back is not a change and is allowed', r.ok, err(r));
  r = await attempt(() => as(ID.D_AUTH, (tx) => tx.query(`UPDATE public.booking SET booking_status = 'Trip Ongoing', trip_started_at = now() WHERE booking_id = $1 RETURNING booking_status`, [B.booking_id])));
  check('what the apps legitimately write (status, trip_started_at) still works', r.ok && r.value.rows[0].booking_status === 'Trip Ongoing', err(r));
  r = await attempt(() => svc((tx) => tx.query(`UPDATE public.booking SET pickup_address = 'Corrected by an administrator tool' WHERE booking_id = $1 RETURNING pickup_address`, [B.booking_id])));
  check('trusted server code (service role) can still repair data', r.ok && r.value.rows[0].pickup_address.startsWith('Corrected'), err(r));
  await svc((tx) => tx.query(`UPDATE public.booking SET pickup_address = 'A' WHERE booking_id = $1`, [B.booking_id]));

  console.log('\nThe final fare is computed once, by the database, when the trip arrives (Rule 6.2)');
  const arrived = await setStatus(ID.D_AUTH, B.booking_id, 'Arrived at Destination');
  check('the driver slides "Arrived": the database writes actual_fare 72 and locks it',
    num(arrived.actual_fare) === 72 && arrived.fare_locked_at !== null && arrived.actual_distance_km === null, arrived);
  const fin = arrived.fare_breakdown.final;
  check('with no GPS track the estimate stands (basis: estimate_no_track), and the breakdown has base 60 + distance 12',
    fin.distance_basis === 'estimate_no_track' && fin.basis === 'solo' && fin.deviation === false && num(fin.components.base) === 60 && num(fin.components.distance) === 12 && num(fin.billed_distance_km) === 5, fin);
  const lockedAt = arrived.fare_locked_at;
  const completed = await setStatus(ID.P_AUTH, B.booking_id, 'Completed');
  check('the passenger confirms payment (Completed): the fare and the lock are exactly as they were (computed once)',
    num(completed.actual_fare) === 72 && JSON.stringify(completed.fare_locked_at) === JSON.stringify(lockedAt) && JSON.stringify(completed.fare_breakdown) === JSON.stringify(arrived.fare_breakdown), completed);
  check('both parties read the same figure from the same row', num((await getBooking(B.booking_id)).actual_fare) === 72);
  r = await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`UPDATE public.booking SET actual_fare = 1 WHERE booking_id = $1`, [B.booking_id])));
  check('after the lock the passenger still cannot change it', !r.ok && /ERR_FARE_LOCKED/.test(r.error), err(r));
  r = await attempt(() => as(ID.L_AUTH, (tx) => tx.query(`UPDATE public.booking SET actual_fare = 1 WHERE booking_id = $1`, [B.booking_id])));
  check('...nor the LGU administrator (corrections will go through an audited function, Batch 9)', !r.ok && /ERR_FARE_LOCKED/.test(r.error), err(r));

  console.log('\nA Shared booking that is never matched is billed Solo (Rules 6.5, 14.4)');
  const S = await book(ID.P2_AUTH, ID.P2, { km: 5, shared: true });
  await assign(S.booking_id, ID.D2);
  await setStatus(ID.D2_AUTH, S.booking_id, 'Trip Ongoing');
  const sArr = await setStatus(ID.D2_AUTH, S.booking_id, 'Arrived at Destination');
  check('estimate was 36; with no partner the final is the Maximum Unmatched Fare, 72 (basis: unmatched_solo)',
    num(S.estimated_fare) === 36 && num(sArr.actual_fare) === 72 && sArr.fare_breakdown.final.basis === 'unmatched_solo', sArr.fare_breakdown.final);
  check('...with no strike for either side', (await one(`SELECT count(*)::int n FROM public.strikes_ledger`)).n === 0);
  await done(S.booking_id);

  console.log('\nA matched Shared booking is never billed above the estimate it accepted (until Batch 10 supplies the legs)');
  const M = await book(ID.P_AUTH, ID.P1, { km: 5, shared: true });
  await assign(M.booking_id, ID.D1);
  const match = await svc((tx) => tx.query(`INSERT INTO public.shared_trip_match (primary_booking_id, match_status) VALUES ($1, 'Matched') RETURNING match_id`, [M.booking_id]));
  await svc((tx) => tx.query(`UPDATE public.booking SET shared_trip_match_id = $2 WHERE booking_id = $1`, [M.booking_id, match.rows[0].match_id]));
  await setStatus(ID.D_AUTH, M.booking_id, 'Trip Ongoing');
  const mArr = await setStatus(ID.D_AUTH, M.booking_id, 'Arrived at Destination');
  check('matched: final 36 = the Matched Shared Fare Estimate (basis: matched_estimate_pending_segments)',
    num(mArr.actual_fare) === 36 && mArr.fare_breakdown.final.basis === 'matched_estimate_pending_segments', mArr.fare_breakdown.final);
  await done(M.booking_id);

  console.log('\nBookings made before this batch (no rule snapshot) are still settled');
  const L = await book(ID.P2_AUTH, ID.P2, { km: 5 });
  await svc((tx) => tx.query(`UPDATE public.booking SET fare_breakdown = NULL, fare_matrix_id = NULL WHERE booking_id = $1`, [L.booking_id]));
  await assign(L.booking_id, ID.D2);
  const lArr = await setStatus(ID.D2_AUTH, L.booking_id, 'Arrived at Destination');
  check('the rule in force when the booking was created is used (72) and recorded', num(lArr.actual_fare) === 72 && lArr.fare_matrix_id === R1 && lArr.fare_breakdown.legacy_rule_lookup === true, lArr);
  await done(L.booking_id);
  const N = await attempt(() => svc((tx) => tx.query(`INSERT INTO public.booking (passenger_id, passenger_count, pickup_address, pickup_latitude, pickup_longitude, dropoff_address, dropoff_latitude, dropoff_longitude, booking_status) VALUES ($1, 1, 'A', 13.4115, 121.1803, 'B', 13.42, 121.19, 'Trip Ongoing') RETURNING booking_id`, [ID.P1])));
  const nArr = await setStatus(ID.D_AUTH, N.value.rows[0].booking_id, 'Arrived at Destination');
  check('a row with no distance at all just gets locked: nothing is invented', nArr.actual_fare === null && nArr.fare_locked_at !== null, nArr);

  console.log('\nThe earlier booking rules still speak for themselves');
  a = await attempt(() => book(ID.P_AUTH, ID.P1, { km: 5, pickup: { lat: 14.9, lng: 121.9 }, dropoff: { lat: 14.93, lng: 121.9 }, fare: 72 }));
  check('an out-of-area pickup with a correct fare is still refused for its own reason (Batch 1 service-area gate)', !a.ok && /ERR_OUT_OF_SERVICE_AREA/.test(a.error), err(a));

  // Found by the live dry run: Batch 3's is_service_context() answers NULL (not FALSE) in a database session that has
  // never set sakay.internal_context, and "IF NOT NULL" skips a guard silently. These emulator sessions always had the
  // setting defined, so the suite could not see it. Simulate exactly that answer and require the guards to hold.
  // (Keep this section last: it replaces the helper for the rest of this database.)
  console.log('\nFail-closed: a session that never set the internal-context setting (is_service_context() answers NULL)');
  await t.db.exec(`CREATE OR REPLACE FUNCTION public.is_service_context() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$ SELECT NULL::BOOLEAN $$`);
  check('(setup) the helper now answers NULL, as in a fresh session', (await one(`SELECT public.is_service_context() IS NULL AS n`)).n === true);
  a = await attempt(() => book(ID.P2_AUTH, ID.P2, { km: 5, extra: { actual_fare: 1, actual_distance_km: 0.1, created_at: '2020-01-01T00:00:00Z' } }));
  check('...a client-supplied actual_fare, distance and created_at are still discarded at insert',
    a.ok && a.value.actual_fare === null && a.value.actual_distance_km === null && Math.abs(Date.now() - new Date(a.value.created_at).getTime()) < 60000, err(a));
  const F = a.value;
  await assign(F.booking_id, ID.D2);
  const nullRoles = [
    ['the booking\'s passenger', (fn) => as(ID.P2_AUTH, fn)],
    ['the assigned driver', (fn) => as(ID.D2_AUTH, fn)],
    ['an anonymous caller', (fn) => anon(fn)],
  ];
  for (const [label, run] of nullRoles) {
    const failures = [];
    for (const [col, set, code] of edits) {
      const r2 = await attempt(() => run((tx) => tx.query(`UPDATE public.booking SET ${set} WHERE booking_id = $1`, [F.booking_id])));
      if (r2.ok || !r2.error.includes(code)) failures.push({ col, got: err(r2) });
    }
    check(`...${label} still cannot change any of the ${edits.length} locked columns`, failures.length === 0, failures);
  }
  const fArr = await setStatus(ID.D2_AUTH, F.booking_id, 'Arrived at Destination');
  check('...and the final fare is still computed and locked by the database on arrival', num(fArr.actual_fare) === 72 && fArr.fare_locked_at !== null, fArr);
  r = await attempt(() => as(ID.P2_AUTH, (tx) => tx.query(`UPDATE public.booking SET actual_fare = 1 WHERE booking_id = $1`, [F.booking_id])));
  check('...after which the passenger still cannot touch it (ERR_FARE_LOCKED)', !r.ok && /ERR_FARE_LOCKED/.test(r.error), err(r));

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
