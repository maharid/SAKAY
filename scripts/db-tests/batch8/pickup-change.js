// Batch 8 (20261023000001), part 3: Rule 29.9 (T6) - the pickup may be changed ONLY before a driver accepts, and only through passenger_update_pickup().
// Every direct write of the pickup stays refused at every stage (ERR_BOOKING_LOCKED, Batch 5); the one door re-quotes the fare, checks the service area, withdraws
// the offers that are out and starts a new search cycle. After acceptance (or once the booking has ended) the door is shut: ERR_PICKUP_LOCKED.
// Whole migration chain on the local emulator (never Supabase).
const { setup, ID, DRIVERS, attempt, check, summary, PICKUP } = require('../b6fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, as } = s;
  const paxRpc = (pax, sql, args) => s.rpcAs(s.PAX[pax].uid, sql, args);
  const change = (pax, id, lat, lng, addr, km, fare) => paxRpc(pax, 'public.passenger_update_pickup($1, $2, $3, $4, $5, $6)', [id, lat, lng, addr, km, fare]);
  const north = (m) => PICKUP.lat + m / 111195;

  console.log('S1 before any driver accepts: the pickup can be changed, the fare is quoted again and the search starts over');
  await s.online('D1', 300);
  let b = await s.bookAs('P1');
  const offer1 = await s.pendingOffer(b.booking_id);
  check('the booking is searching and D1 has the offer', b.booking_status === 'Pending' && !!offer1 && offer1.driver_id === ID.D1, offer1);
  const fare33 = Number((await s.quote(s.PAX.P1.uid, 3.3, 1)).solo_fare);
  const fare45 = Number((await s.quote(s.PAX.P1.uid, 4.5, 1)).solo_fare);
  check('(the two quotes differ, so a changed pickup really changes the fare)', fare45 > fare33, { fare33, fare45 });

  let r = await change('P1', b.booking_id, north(120), PICKUP.lng, 'Corner of Rizal St', 4.5, fare33);
  check('the fare of the old figure is refused: ERR_FARE_MISMATCH, with the fare the database quotes for the new pickup', r.success === false && r.error_code === 'ERR_FARE_MISMATCH' && Number(r.expected_fare) === fare45 && Number(r.current_fare) === fare33, r);
  let cur = await s.booking(b.booking_id);
  check('...and nothing changed (same pickup, same search cycle, the offer is still out)', Number(cur.pickup_latitude) === PICKUP.lat && cur.dispatch_cycle === b.dispatch_cycle && !!(await s.pendingOffer(b.booking_id)), cur);

  r = await change('P1', b.booking_id, north(120), PICKUP.lng, 'Corner of Rizal St', 4.5, fare45);
  cur = await s.booking(b.booking_id);
  check('with the confirmed fare it succeeds', r.success === true && r.fare_changed === true && Number(r.estimated_fare) === fare45, r);
  check('the booking holds the new pickup, distance and fare', Math.abs(Number(cur.pickup_latitude) - north(120)) < 1e-9 && cur.pickup_address === 'Corner of Rizal St' && Number(cur.estimated_distance_km) === 4.5 && Number(cur.estimated_fare) === fare45, cur);
  check('the fare breakdown is the new quote (rule snapshot and estimate)', cur.fare_breakdown && cur.fare_breakdown.estimate && Number(cur.fare_breakdown.estimate.estimated_fare) === fare45 && cur.fare_breakdown.final === null && cur.fare_matrix_id !== null, cur.fare_breakdown);
  check('a NEW search cycle started from Tier 1', cur.dispatch_cycle === b.dispatch_cycle + 1 && cur.dispatch_tier === 1 && cur.driver_id === null && (cur.booking_status === 'Pending' || cur.booking_status === 'Searching Driver'), cur);
  const oldRow = await one(`SELECT response_status, responded_at FROM dispatch_attempt WHERE attempt_id = '${offer1.attempt_id}'`);
  check('the offer that was out is withdrawn (Expired, with an answer time: not an ignored offer)', oldRow.response_status === 'Expired' && oldRow.responded_at !== null, oldRow);
  const offer2 = await s.pendingOffer(b.booking_id);
  check('and the driver is offered the booking again in the new cycle, with the new pickup', !!offer2 && offer2.driver_id === ID.D1 && offer2.attempt_id !== offer1.attempt_id && Number((await s.myOffer('D1')).pickup_latitude) === north(120), offer2);
  const audit = await q(`SELECT before_state, after_state FROM audit_log WHERE action_type = 'BOOKING_PICKUP_CHANGED' AND target_id = '${b.booking_id}'`);
  check('the change is audited with the before and the after', audit.length === 1 && audit[0].before_state.pickup_address === 'A' && audit[0].after_state.pickup_address === 'Corner of Rizal St' && Number(audit[0].after_state.estimated_fare) === fare45, audit);
  check('the Priority TODA was worked out again for the new place', cur.priority_toda_id !== null);

  r = await change('P1', b.booking_id, north(60), PICKUP.lng, 'Rizal St near the church', 3.3, fare33);
  check('it can be changed again (back to the first fare)', r.success === true && Number((await s.booking(b.booking_id)).estimated_fare) === fare33 && (await s.booking(b.booking_id)).dispatch_cycle === b.dispatch_cycle + 2, r);

  console.log('\nS2 what it refuses');
  r = await change('P1', b.booking_id, 13.5, 120.95, 'Puerto Galera', 4.5, fare45);
  check('a pickup outside the service area: ERR_OUT_OF_SERVICE_AREA', r.success === false && r.error_code === 'ERR_OUT_OF_SERVICE_AREA', r);
  r = await change('P1', b.booking_id, north(50), PICKUP.lng, 'Somewhere', 30, fare45);
  check('a route distance that does not fit the new pickup and the destination: ERR_DISTANCE_IMPLAUSIBLE', r.success === false && r.error_code === 'ERR_DISTANCE_IMPLAUSIBLE', r);
  r = await change('P1', b.booking_id, north(50), PICKUP.lng, 'Somewhere', 0, fare45);
  check('no route distance: ERR_DISTANCE_REQUIRED', r.success === false && r.error_code === 'ERR_DISTANCE_REQUIRED', r);
  r = await change('P1', b.booking_id, north(50), PICKUP.lng, '   ', 3.3, fare33);
  check('no address: ERR_PICKUP_INVALID', r.success === false && r.error_code === 'ERR_PICKUP_INVALID', r);
  r = await change('P1', b.booking_id, 95, PICKUP.lng, 'Nowhere', 3.3, fare33);
  check('a latitude that does not exist: ERR_PICKUP_INVALID', r.success === false && r.error_code === 'ERR_PICKUP_INVALID', r);
  r = await change('P2', b.booking_id, north(50), PICKUP.lng, 'Mine now', 3.3, fare33);
  check('another passenger cannot change it', r.success === false && r.error_code === 'ERR_NOT_YOUR_BOOKING', r);
  r = await s.rpcAs(DRIVERS.D1.uid, 'public.passenger_update_pickup($1, $2, $3, $4, $5, $6)', [b.booking_id, north(50), PICKUP.lng, 'Driver\'s idea', 3.3, fare33]);
  check('a driver cannot', r.success === false && r.error_code === 'ERR_NOT_A_PASSENGER', r);
  const anon = await attempt(() => s.anon((tx) => tx.query(`SELECT public.passenger_update_pickup('${b.booking_id}', ${north(50)}, ${PICKUP.lng}, 'Anon', 3.3, ${fare33})`)));
  check('nor an anonymous caller', !anon.ok && /permission denied/.test(anon.error), anon);
  cur = await s.booking(b.booking_id);
  check('none of that changed the booking', cur.pickup_address === 'Rizal St near the church' && cur.dispatch_cycle === b.dispatch_cycle + 2, cur);

  console.log('\nS3 Rule 29.9 (T6): a direct write of the pickup is refused at every stage; the door is shut after acceptance');
  const direct = async (uid, id, col = `pickup_latitude = ${north(5)}`) => attempt(() => as(uid, (tx) => tx.query(`UPDATE booking SET ${col} WHERE booking_id = $1 RETURNING *`, [id])));
  let x = await direct(s.PAX.P1.uid, b.booking_id);
  check('while searching, the passenger cannot edit the pickup with a plain UPDATE either (the RPC is the only way)', !x.ok && /ERR_BOOKING_LOCKED/.test(x.error), x);
  x = await direct(s.PAX.P1.uid, b.booking_id, `pickup_address = 'Somewhere else'`);
  check('...nor its address', !x.ok && /ERR_BOOKING_LOCKED/.test(x.error), x);

  const acc = await s.accept('D1', (await s.pendingOffer(b.booking_id)).attempt_id);
  check('D1 accepts the booking', acc.success === true, acc);
  r = await change('P1', b.booking_id, north(40), PICKUP.lng, 'Too late', 3.3, fare33);
  check('after acceptance the RPC refuses (ERR_PICKUP_LOCKED), in both languages', r.success === false && r.error_code === 'ERR_PICKUP_LOCKED' && /Hindi na mababago ang pickup/.test(r.error) && /before a driver accepts/.test(r.error), r);
  x = await direct(s.PAX.P1.uid, b.booking_id);
  check('and a plain UPDATE by the passenger is refused (T6, API level)', !x.ok && /ERR_BOOKING_LOCKED/.test(x.error), x);
  x = await direct(DRIVERS.D1.uid, b.booking_id);
  check('and by the driver', !x.ok && /ERR_BOOKING_LOCKED/.test(x.error), x);
  cur = await s.booking(b.booking_id);
  check('the pickup is exactly what it was', cur.pickup_address === 'Rizal St near the church' && Math.abs(Number(cur.pickup_latitude) - north(60)) < 1e-9, cur);
  await s.driverSets('D1', b.booking_id, 'In Transit'); await s.driverSets('D1', b.booking_id, 'Driver Arrived');
  r = await change('P1', b.booking_id, north(40), PICKUP.lng, 'Too late', 3.3, fare33);
  check('after the driver has arrived: still refused', r.success === false && r.error_code === 'ERR_PICKUP_LOCKED', r);
  await s.finish(b.booking_id); await s.goOffline(DRIVERS.D1.uid);
  r = await change('P1', b.booking_id, north(40), PICKUP.lng, 'Too late', 3.3, fare33);
  check('after the booking has ended: refused', r.success === false && r.error_code === 'ERR_PICKUP_LOCKED', r);

  await s.online('D1', 300);
  b = await s.bookAs('P1');
  await internal(`UPDATE booking SET booking_status = 'No Driver Found', dispatch_ended_reason = 'no_driver_found' WHERE booking_id = '${b.booking_id}'`);
  r = await change('P1', b.booking_id, north(40), PICKUP.lng, 'After the search ended', 3.3, fare33);
  check('a search that ended with No Driver Found is not "searching": the passenger retries or cancels (free), he does not edit', r.success === false && r.error_code === 'ERR_PICKUP_LOCKED', r);
  await s.finish(b.booking_id);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
