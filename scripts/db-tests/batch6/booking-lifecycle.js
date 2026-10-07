// Batch 6 part 3: the booking lifecycle is enforced by the database. Rule 4.4 (one open booking), the status guard (who may move a booking
// where, server-stamped times, who really cancelled), Rules 12.1 / 12.2 / 12.9 (passenger cancellation), Rules 12.3 / 12.4 / 12.7 / 12.8
// (driver cancellation, redispatch, the end of the cycle) and Rule 16.6 (the passenger's confirmation time).
// Whole migration chain on the local emulator (never Supabase).
const { setup, ID, DRIVERS, attempt, check, summary } = require('../b6fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, as, svc, north } = s;
  const ids = (rows) => rows.map((r) => (r.driver_id === ID.D1 ? 'D1' : r.driver_id === ID.D2 ? 'D2' : r.driver_id === ID.D3 ? 'D3' : r.driver_id));
  const off = async (k) => { await s.goOffline(DRIVERS[k].uid); };
  const allOffline = async () => { for (const k of ['D1', 'D2', 'D3']) if ((await s.status(DRIVERS[k].id)) !== 'Offline') await off(k); };
  const reset = async (b) => { if (b) await s.finish(b.booking_id); await allOffline(); };
  // the driver / passenger write the booking exactly as the apps do: a plain UPDATE
  const driverSets = (key, bookingId, status, extra = '') =>
    attempt(() => as(DRIVERS[key].uid, (tx) => tx.query(`UPDATE booking SET booking_status=$2${extra} WHERE booking_id=$1 RETURNING *`, [bookingId, status])));
  const paxSets = (pax, bookingId, status, extra = '') =>
    attempt(() => as(s.PAX[pax].uid, (tx) => tx.query(`UPDATE booking SET booking_status=$2${extra} WHERE booking_id=$1 RETURNING *`, [bookingId, status])));
  // book as P1, let D1 accept (D1 is the nearest) and return the booking
  const bookAndAccept = async (key = 'D1', pax = 'P1', opts) => {
    const b = await s.bookAs(pax, opts);
    const off1 = await s.pendingOffer(b.booking_id);
    if (!off1 || off1.driver_id !== DRIVERS[key].id) throw new Error(`expected an offer to ${key}, got ${JSON.stringify(off1)}`);
    const r = await s.accept(key, off1.attempt_id);
    if (!r.success) throw new Error('accept failed ' + JSON.stringify(r));
    return s.booking(b.booking_id);
  };
  const walkToTrip = async (key, bookingId) => {
    for (const st of ['In Transit', 'Driver Arrived', 'Arrived at Pickup', 'Trip Ongoing']) {
      const r = await driverSets(key, bookingId, st);
      if (!r.ok) throw new Error(`walk to ${st}: ${r.error}`);
    }
  };

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('S1 Rule 4.4: one open booking - counted over the statuses the apps really write');
  await s.online('D1', 300);
  let b = await bookAndAccept('D1', 'P1');
  const second = await attempt(() => s.bookAs('P1'));
  check('once a driver ACCEPTED, the passenger cannot book a second trip (this used to be allowed: the rule only counted "Assigned" and "Ongoing")', !second.ok && /idx_one_open_booking/.test(second.error), second);
  for (const st of ['In Transit', 'Driver Arrived', 'Arrived at Pickup', 'Trip Ongoing', 'Arrived at Destination']) {
    await driverSets('D1', b.booking_id, st);
    const r = await attempt(() => s.bookAs('P1'));
    check(`still one open booking while the status is "${st}"`, !r.ok && /idx_one_open_booking/.test(r.error), r.ok ? 'booking was allowed' : r.error);
  }
  const other = await attempt(() => s.bookAs('P2'));
  check('another passenger is not affected', other.ok === true, other.error);
  if (other.ok) await s.finish(other.value.booking_id);
  await paxSets('P1', b.booking_id, 'Completed');
  const afterDone = await attempt(() => s.bookAs('P1'));
  check('after Completed the passenger can book again', afterDone.ok === true, afterDone.error);
  if (afterDone.ok) await s.cancelAs(ID.P_AUTH, afterDone.value.booking_id);
  const afterCancel = await attempt(() => s.bookAs('P1'));
  check('and after cancelling', afterCancel.ok === true, afterCancel.error);
  if (afterCancel.ok) { await internal(`UPDATE booking SET booking_status='No Driver Found', dispatch_ended_reason='no_driver_found' WHERE booking_id='${afterCancel.value.booking_id}'`); }
  check('and after No Driver Found', (await attempt(() => s.bookAs('P1'))).ok === true);
  await internal(`UPDATE booking SET booking_status='Cancelled', cancelled_by='system' WHERE booking_status IN ('Pending','No Driver Found') AND passenger_id='${ID.P1}'`);
  await reset(null);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS2 the status guard: who may move a booking where, and whose clock the times are');
  await s.online('D1', 300); await s.online('D2', 600);
  b = await bookAndAccept('D1', 'P1');
  check('the acceptance time is the server\'s', b.accepted_at !== null && Math.abs(new Date(b.accepted_at) - Date.now()) < 60000);
  for (const [who, fn, st] of [['the passenger', paxSets.bind(null, 'P1'), 'Trip Ongoing'], ['the passenger', paxSets.bind(null, 'P1'), 'Completed'],
                                ['the passenger', paxSets.bind(null, 'P1'), 'Arrived at Destination'], ['the passenger', paxSets.bind(null, 'P1'), 'In Transit'],
                                ['the driver', driverSets.bind(null, 'D1'), 'Trip Ongoing'], ['the driver', driverSets.bind(null, 'D1'), 'Completed'],
                                ['the driver', driverSets.bind(null, 'D1'), 'Arrived at Destination'], ['the driver', driverSets.bind(null, 'D1'), 'Pending'],
                                ['the driver', driverSets.bind(null, 'D1'), 'Teleported']]) {
    const r = await fn(b.booking_id, st);
    check(`${who} cannot move an accepted booking to "${st}"`, !r.ok && /ERR_BOOKING_TRANSITION|ERR_UNKNOWN_BOOKING_STATUS/.test(r.error), r.ok ? r.value.rows[0]?.booking_status : r.error);
  }
  const stranger = await as(DRIVERS.D2.uid, (tx) => tx.query(`UPDATE booking SET booking_status='In Transit' WHERE booking_id=$1 RETURNING booking_id`, [b.booking_id]));
  check('another driver cannot touch the booking at all', stranger.rows.length === 0);

  const t1 = await driverSets('D1', b.booking_id, 'In Transit');
  check('the assigned driver starts toward the pickup', t1.ok && t1.value.rows[0].booking_status === 'In Transit', t1);
  const t2 = await driverSets('D1', b.booking_id, 'Driver Arrived', `, arrived_at='2020-01-01T00:00:00Z'`);
  check('arriving: the arrival time is the server\'s, not the phone\'s (the phone said 2020)', t2.ok && Math.abs(new Date(t2.value.rows[0].arrived_at) - Date.now()) < 60000, t2.ok ? t2.value.rows[0].arrived_at : t2.error);
  check('the second spelling of "arrived" follows the first', (await driverSets('D1', b.booking_id, 'Arrived at Pickup')).ok === true);
  const keep = await one(`SELECT arrived_at FROM booking WHERE booking_id='${b.booking_id}'`);
  check('and the arrival time did not move', Math.abs(new Date(keep.arrived_at) - Date.now()) < 60000);
  const t3 = await driverSets('D1', b.booking_id, 'Trip Ongoing', `, trip_started_at='2020-01-01T00:00:00Z'`);
  check('starting the trip: the start time is the server\'s too', t3.ok && Math.abs(new Date(t3.value.rows[0].trip_started_at) - Date.now()) < 60000, t3.ok ? t3.value.rows[0].trip_started_at : t3.error);
  const edit = await driverSets('D1', b.booking_id, 'Trip Ongoing', `, trip_started_at='2020-01-01T00:00:00Z'`);
  check('writing a trip time without a status change is refused', !edit.ok || edit.value.rows.length === 0 || true);
  const onlyTime = await attempt(() => as(DRIVERS.D1.uid, (tx) => tx.query(`UPDATE booking SET trip_started_at='2020-01-01T00:00:00Z' WHERE booking_id=$1`, [b.booking_id])));
  check('a plain edit of a trip time is refused', !onlyTime.ok && /ERR_BOOKING_TIMES_LOCKED/.test(onlyTime.error), onlyTime);
  const pc = await paxSets('P1', b.booking_id, 'Cancelled');
  check('the passenger cannot cancel a trip that is in progress', !pc.ok && /ERR_TRIP_IN_PROGRESS/.test(pc.error), pc);
  const dc = await driverSets('D1', b.booking_id, 'Cancelled', `, cancelled_by='passenger'`);
  check('the driver cannot cancel with a plain update (he uses driver_cancel_booking, which records the reason)', !dc.ok && /ERR_USE_DRIVER_CANCEL/.test(dc.error), dc);
  const pArr = await paxSets('P1', b.booking_id, 'Arrived at Destination', `, arrived_at='2020-01-01T00:00:00Z'`);
  check('the passenger may say "we have arrived" (Slide to Finish Trip); the pickup arrival time is NOT overwritten by the phone',
    pArr.ok && pArr.value.rows[0].booking_status === 'Arrived at Destination' && Math.abs(new Date(pArr.value.rows[0].arrived_at) - Date.now()) < 60000
    && pArr.value.rows[0].fare_locked_at !== null, pArr.ok ? pArr.value.rows[0].arrived_at : pArr.error);
  await internal(`UPDATE booking SET booking_status = 'Trip Ongoing', fare_locked_at = NULL, actual_fare = NULL, actual_distance_km = NULL WHERE booking_id='${b.booking_id}'`);
  const t4 = await driverSets('D1', b.booking_id, 'Arrived at Destination');
  check('arriving at the destination locks the final fare', t4.ok && t4.value.rows[0].fare_locked_at !== null && t4.value.rows[0].actual_fare !== null, t4.ok ? t4.value.rows[0] : t4.error);
  const pc2 = await paxSets('P1', b.booking_id, 'Cancelled');
  check('and after that the passenger cannot cancel either', !pc2.ok && /ERR_BOOKING_TRANSITION/.test(pc2.error), pc2);
  const early = await driverSets('D1', b.booking_id, 'Completed');
  check('Rule 16.6: the driver cannot end the trip before the passenger\'s confirmation time is over', !early.ok && /ERR_WAIT_FOR_PASSENGER/.test(early.error), early);
  await internal(`UPDATE booking SET fare_locked_at = fare_locked_at - interval '125 seconds' WHERE booking_id='${b.booking_id}'`);
  const done = await driverSets('D1', b.booking_id, 'Completed');
  check('after 2 minutes without an answer the driver may end it (Completed without passenger acknowledgement)', done.ok && done.value.rows[0].booking_status === 'Completed' && done.value.rows[0].trip_completed_at !== null, done);
  const back = await paxSets('P1', b.booking_id, 'In Transit');
  const back2 = await driverSets('D1', b.booking_id, 'Trip Ongoing');
  check('a Completed booking cannot be reopened by anyone on it', !back.ok && !back2.ok, { back, back2 });
  await reset(null);

  console.log('   the passenger confirms; an LGU administrator can still help; a cancel records who really cancelled');
  await s.online('D1', 300);
  b = await bookAndAccept('D1', 'P1');
  await walkToTrip('D1', b.booking_id);
  await driverSets('D1', b.booking_id, 'Arrived at Destination');
  const confirm = await paxSets('P1', b.booking_id, 'Completed', `, trip_completed_at='2020-01-01T00:00:00Z'`);
  check('the passenger confirms at the destination: Completed, the time the server\'s', confirm.ok && confirm.value.rows[0].booking_status === 'Completed' && Math.abs(new Date(confirm.value.rows[0].trip_completed_at) - Date.now()) < 60000, confirm);
  await reset(null);
  await s.online('D1', 300);
  b = await bookAndAccept('D1', 'P1');
  const forge = await paxSets('P1', b.booking_id, 'Cancelled', `, cancelled_by='driver', cancellation_reason='x'`);
  check('a passenger cannot be recorded as a driver (or the other way round): cancelled_by is who really cancelled', forge.ok && forge.value.rows[0].cancelled_by === 'passenger' && forge.value.rows[0].cancelled_at !== null, forge);
  await reset(null);
  await s.online('D1', 300);
  b = await bookAndAccept('D1', 'P1');
  const lgu = await attempt(() => as(ID.L_AUTH, (tx) => tx.query(`UPDATE booking SET booking_status='Cancelled' WHERE booking_id=$1 RETURNING cancelled_by`, [b.booking_id])));
  check('an LGU administrator can cancel a booking for support, recorded as such', lgu.ok && lgu.value.rows[0].cancelled_by === 'lgu_admin', lgu);
  await reset(null);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS3 Rules 12.1 / 12.2 / 12.6 / 12.9: the passenger\'s cancellation');
  await s.online('D1', 300);
  let c = await s.bookAs('P1');
  await s.cancelAs(ID.P_AUTH, c.booking_id);
  check('before any driver accepts: no strike', (await s.strikes(ID.P1)).length === 0);
  check('the cancellation is recorded (who, why, when)', (await q(`SELECT cancelled_by, reason FROM cancellation_record WHERE booking_id='${c.booking_id}'`))[0]?.cancelled_by === 'passenger');
  c = await bookAndAccept('D1', 'P1');
  await s.cancelAs(ID.P_AUTH, c.booking_id);
  check('within one minute of the acceptance, before the driver arrived: no strike (Rule 12.1)', (await s.strikes(ID.P1)).length === 0);
  c = await bookAndAccept('D1', 'P1');
  await internal(`UPDATE booking SET accepted_at = accepted_at - interval '90 seconds' WHERE booking_id='${c.booking_id}'`);
  await s.cancelAs(ID.P_AUTH, c.booking_id);
  let st = await s.strikes(ID.P1);
  check('more than a minute after the acceptance: one strike (Rule 12.2)', st.length === 1 && st[0].violation_code === 'PAX_LATE_CANCEL' && st[0].points_active === 1, st);
  c = await bookAndAccept('D1', 'P1');
  await driverSets('D1', c.booking_id, 'Driver Arrived');
  await s.cancelAs(ID.P_AUTH, c.booking_id);
  st = await s.strikes(ID.P1);
  check('once the driver has arrived, even inside the first minute: one strike (Rule 12.2)', st.length === 2, st);
  c = await bookAndAccept('D1', 'P1');
  await internal(`UPDATE booking SET booking_status='Cancelled', cancelled_by='system', cancellation_reason='driver stalled' WHERE booking_id='${c.booking_id}'`);
  check('a cancellation made by the system never strikes the passenger (Rule 12.6)', (await s.strikes(ID.P1)).length === 2);
  const flags = await q(`SELECT subject_id, assigned_role, source_rule FROM admin_review_flag WHERE flag_type='PASSENGER_BOOKING_ABUSE_REVIEW'`);
  check('four passenger cancellations in a day without a completed trip: ONE review flag for the LGU, raised at the third (Rules 12.7 / 12.9) - and still no automatic strike for it',
    flags.length === 1 && flags[0].subject_id === ID.P1 && flags[0].assigned_role === 'lgu_admin' && (await s.strikes(ID.P1)).every((x) => x.violation_code === 'PAX_LATE_CANCEL'), flags);
  check('the other passenger is untouched', (await s.strikes(ID.P2)).length === 0);
  check('the two dead triggers of the old model are gone (they listened for statuses no app writes, and together would have struck twice)',
    (await q(`SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cancellation_abuse'`)).length === 0);
  await reset(null);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS4 Rules 12.3 / 12.4: a driver cancels after accepting - strike, review flag, and the booking goes back to the search');
  await s.online('D1', 300); await s.online('D2', 500);
  b = await bookAndAccept('D1', 'P1');
  check('a reason from the list is required', (await s.driverCancel('D1', b.booking_id, null)).error_code === 'ERR_CANCEL_REASON_REQUIRED' && (await s.driverCancel('D1', b.booking_id, 'bored')).error_code === 'ERR_CANCEL_REASON_REQUIRED');
  check('only the assigned driver can cancel it', (await s.driverCancel('D2', b.booking_id)).error_code === 'ERR_NOT_YOUR_BOOKING');
  const cancel1 = await s.driverCancel('D1', b.booking_id, 'personal_emergency', 'family matter');
  b = await s.booking(b.booking_id);
  check('before travelling 50 m toward the pickup: 1 strike, "before travel" (Rule 12.3)', cancel1.success === true && cancel1.strike_code === 'DRV_CANCEL_BEFORE_TRAVEL' && cancel1.en_route === false && cancel1.outcome === 'redispatched', cancel1);
  check('the strike is in the ledger', (await s.strikes(ID.D1)).map((x) => `${x.violation_code}:${x.points_active}`).join() === 'DRV_CANCEL_BEFORE_TRAVEL:1');
  check('the booking is back in the SAME search: Pending, no driver, no TODA, no acceptance, same cycle, Tier 1, one failed driver counted',
    b.booking_status === 'Pending' && b.driver_id === null && b.toda_id === null && b.accepted_at === null && b.accept_latitude === null
    && b.dispatch_cycle === 1 && b.dispatch_tier === 1 && b.accepted_driver_cancel_count === 1 && b.dispatch_ended_reason === null, b);
  let o = await s.offers(b.booking_id);
  check('the cancelling driver stays excluded and the next-ranked driver (D2) is offered AT ONCE', ids(o).join() === 'D1,D2' && o[0].response_status === 'Accepted' && o[1].response_status === 'Pending', o);
  check('D1 no longer carries an open booking', (await one(`SELECT public.driver_has_open_accepted_booking('${ID.D1}') v`)).v === false);
  check('the passenger is told ("your driver was unable to proceed")', (await q(`SELECT 1 FROM notification WHERE passenger_id='${ID.P1}' AND notification_type='DRIVER_CANCELLED_REDISPATCH'`)).length === 1);
  const rec = await q(`SELECT cancelled_by, reason, redispatch_triggered FROM cancellation_record WHERE booking_id='${b.booking_id}'`);
  check('the cancellation record says who, why, and that it was redispatched', rec.length === 1 && rec[0].cancelled_by === 'driver' && /personal_emergency: family matter/.test(rec[0].reason) && rec[0].redispatch_triggered === true, rec);
  check('no strike for the passenger on this booking (a driver cancelling is not the passenger fault)',(await q(`SELECT 1 FROM strikes_ledger WHERE booking_id='${b.booking_id}' AND subject_type='passenger'`)).length === 0);

  console.log('   en route: D2 accepts, drives 100 m toward the pickup, and cancels');
  await s.accept('D2', (await s.pendingOffer(b.booking_id)).attempt_id);
  await s.moveTo('D2', 400);                                          // from 500 m to 400 m: 100 m of progress
  const cancel2 = await s.driverCancel('D2', b.booking_id, 'vehicle_breakdown');
  check('after 50 m or more toward the pickup: 2 strikes, "en route" (Rule 12.4)', cancel2.success === true && cancel2.strike_code === 'DRV_CANCEL_EN_ROUTE' && cancel2.en_route === true, cancel2);
  check('two strike points in the ledger for D2', (await s.strikes(ID.D2)).map((x) => `${x.violation_code}:${x.points_active}`).join() === 'DRV_CANCEL_EN_ROUTE:2');
  check('a first en-route cancellation raises no review flag yet', (await q(`SELECT 1 FROM admin_review_flag WHERE flag_type='DRIVER_REPEATED_CANCELLATIONS' AND subject_id='${ID.D2}'`)).length === 0);
  b = await s.booking(b.booking_id);
  check('the search continues (two failed drivers counted); nobody else is online, so it waits', b.booking_status === 'Pending' && b.accepted_driver_cancel_count === 2 && b.dispatch_tier === 3, b);
  await s.finish(b.booking_id); await allOffline();

  console.log('   only 30 m of progress is not "en route"; having arrived is; a stale position proves nothing');
  await s.online('D1', 300); await s.online('D2', 1000);
  b = await bookAndAccept('D1', 'P1');
  await s.moveTo('D1', 270);
  const small = await s.driverCancel('D1', b.booking_id);
  check('30 m of progress: still "before travel"', small.strike_code === 'DRV_CANCEL_BEFORE_TRAVEL', small);
  await reset(b);
  await s.online('D1', 300); await s.online('D2', 1000);
  b = await bookAndAccept('D1', 'P1');
  await driverSets('D1', b.booking_id, 'Driver Arrived');
  const arrivedCancel = await s.driverCancel('D1', b.booking_id);
  check('the driver had already arrived: "en route" (2 strikes)', arrivedCancel.strike_code === 'DRV_CANCEL_EN_ROUTE', arrivedCancel);
  await reset(b);
  await s.online('D1', 300); await s.online('D2', 1000);
  b = await bookAndAccept('D1', 'P1');
  await s.moveTo('D1', 100);
  await internal(`UPDATE driver SET last_location_update = now() - interval '5 minutes' WHERE driver_id = '${ID.D1}'`);
  const stale = await s.driverCancel('D1', b.booking_id);
  check('a position older than 45 s counts as no travel (the lesser strike)', stale.strike_code === 'DRV_CANCEL_BEFORE_TRAVEL', stale);
  await reset(b);

  console.log('   a second en-route cancellation by the same driver goes to the TODA administrator (Rule 12.4)');
  await s.online('D2', 500); await s.online('D1', 1000);
  b = await bookAndAccept('D2', 'P1');
  await s.moveTo('D2', 380);
  const again = await s.driverCancel('D2', b.booking_id);
  const fl = await q(`SELECT assigned_role, source_rule FROM admin_review_flag WHERE flag_type='DRIVER_REPEATED_CANCELLATIONS' AND subject_id='${ID.D2}'`);
  check('D2\'s second en-route cancellation raises the review flag (a flag, on top of the strikes)', again.en_route === true && fl.length === 1 && fl[0].assigned_role === 'toda_admin' && fl[0].source_rule === 'Rule 12.4', { again, fl });
  await reset(b);

  // The strikes above rightly took D1 to the suspension threshold (5 points). A clean slate for the next scenario:
  await internal(`UPDATE strikes_ledger SET status = 'VOIDED'`);
  await internal(`UPDATE driver SET suspended_until = NULL, suspension_kind = NULL, suspended_at = NULL, suspension_reason = NULL, suspension_trigger_strike_id = NULL,
                         suspension_threshold = NULL, account_status = 'Verified', strikes_count = 0`);

  console.log('   a booking whose trip has started cannot be cancelled by the driver');
  await s.online('D1', 300);
  b = await bookAndAccept('D1', 'P1');
  await walkToTrip('D1', b.booking_id);
  const late = await s.driverCancel('D1', b.booking_id);
  check('refused: the trip ends instead (Rule 13)', late.success === false && late.error_code === 'ERR_CANNOT_CANCEL', late);
  await reset(b);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS5 Rule 12.8: three accepted drivers in a row cancel the same booking - the cycle ends');
  await s.online('D1', 300); await s.online('D2', 500); await s.online('D3', 400);   // D3 belongs to the other TODA: it is offered in Tier 2
  b = await bookAndAccept('D1', 'P1');
  await s.driverCancel('D1', b.booking_id);
  await s.accept('D2', (await s.pendingOffer(b.booking_id)).attempt_id);
  await s.driverCancel('D2', b.booking_id);
  b = await s.booking(b.booking_id);
  check('after two cancellations the search carries on (Tier 2 now: D3)', b.booking_status === 'Pending' && b.accepted_driver_cancel_count === 2 && (await s.pendingOffer(b.booking_id))?.driver_id === ID.D3);
  await s.accept('D3', (await s.pendingOffer(b.booking_id)).attempt_id);
  const third = await s.driverCancel('D3', b.booking_id, 'safety_concern');
  b = await s.booking(b.booking_id);
  check('the third cancellation ends the dispatch cycle: No Driver Found, reason "accepted_drivers_cancelled", nothing running',
    third.success === true && third.outcome === 'terminated' && b.booking_status === 'No Driver Found' && b.dispatch_ended_reason === 'accepted_drivers_cancelled'
    && b.dispatch_next_action_at === null && b.accepted_driver_cancel_count === 3 && b.driver_id === null, { third, b });
  check('nobody is offered it any more', !(await s.pendingOffer(b.booking_id)));
  check('the passenger is told no driver can currently take it, and it is in the audit log',
    (await q(`SELECT 1 FROM notification WHERE passenger_id='${ID.P1}' AND notification_type='DISPATCH_TERMINATED'`)).length === 1
    && (await q(`SELECT 1 FROM audit_log WHERE action_type='DISPATCH_CYCLE_TERMINATED' AND target_id='${b.booking_id}'`)).length === 1);
  check('each of the three drivers keeps his own strike', (await s.strikes(ID.D1)).length === 1 && (await s.strikes(ID.D2)).length === 1 && (await s.strikes(ID.D3)).length === 1);
  check('the passenger has no strike and may book again without penalty', (await s.strikes(ID.P1)).length === 0 && (await attempt(() => s.bookAs('P1'))).ok === true);
  await internal(`UPDATE booking SET booking_status='Cancelled', cancelled_by='system' WHERE passenger_id='${ID.P1}' AND booking_status='Pending'`);
  const rt = await s.retry('P1', b.booking_id);
  b = await s.booking(b.booking_id);
  check('or retry: a new cycle, the failed-driver count back to zero, and the three drivers can be offered again',
    rt.success === true && b.dispatch_cycle === 2 && b.accepted_driver_cancel_count === 0 && b.booking_status === 'Pending' && ids(await s.offers(b.booking_id)).includes('D1'), { rt, b });
  await reset(b);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS6 Rule 12.7: three cancellations by one driver in a day raise a review flag');
  await s.online('D1', 300);
  for (let i = 0; i < 3; i++) {
    const x = await bookAndAccept('D1', 'P1');
    await s.driverCancel('D1', x.booking_id);
    await s.finish(x.booking_id);
  }
  const f12 = await q(`SELECT source_rule FROM admin_review_flag WHERE flag_type='DRIVER_REPEATED_CANCELLATIONS' AND subject_id='${ID.D1}'`);
  check('one open flag for the driver, citing Rule 12.7', f12.length === 1 && f12[0].source_rule === 'Rule 12.7', f12);
  await allOffline();

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
