// Batch 9 (20261024000001), part 4: a completed trip is read-only (Rule 16.3, required test T6), what is recorded automatically (16.2), incident reports after the
// trip except emergencies (16.5, D9-12), the change-refusal complaints (18.7), the counterfeit referral (18.8: nothing automatic), and the trip left at the destination (PI-15):
// the administrator closes it. Whole migration chain on the local emulator (never Supabase).
const { setup, ID, DRIVERS, attempt, check, summary } = require('../b9fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, as } = s;
  const L = ID.L_AUTH, T1 = ID.T_AUTH, T2 = ID.T2_AUTH;
  const REASON = 'The driver and the passenger were reached by phone';

  const completedTrip = async () => {
    const b = await s.atDestination('D1', 'P1');
    await s.paxCall('P1', 'passenger_confirm_fare($1)', [b.booking_id]);
    await s.drvCall('D1', 'driver_confirm_payment_received($1)', [b.booking_id]);
    return s.bk(b.booking_id);
  };
  const file = (uid, bookingId, category, by = 'Passenger') => s.writeAs(uid,
    `INSERT INTO incident_report (booking_id, reported_by, category, description) VALUES ($1, $2, $3, 'Something happened during the trip that needs a look') RETURNING incident_id`, [bookingId, by, category]);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('S1 Rule 16.3 (T6): a completed trip is read-only - for the passenger, the driver and every administrator who writes the table');
  let b = await completedTrip();
  check('(setup) the trip is Completed and Paid', b.booking_status === 'Completed' && b.payment_status === 'Paid');
  const edits = [
    ['the passenger', ID.P_AUTH, `UPDATE booking SET cancellation_reason = 'edited' WHERE booking_id = $1 RETURNING booking_id`],
    ['the passenger', ID.P_AUTH, `UPDATE booking SET fare_confirmation_status = 'Flagged for Review' WHERE booking_id = $1 RETURNING booking_id`],
    ['the driver', ID.D_AUTH, `UPDATE booking SET cancellation_reason = 'edited' WHERE booking_id = $1 RETURNING booking_id`],
    ['the driver', ID.D_AUTH, `UPDATE booking SET fare_confirmation_status = 'Flagged for Review' WHERE booking_id = $1 RETURNING booking_id`],
    ['the LGU Administrator', L, `UPDATE booking SET cancellation_reason = 'edited' WHERE booking_id = $1 RETURNING booking_id`],
    ['the LGU Administrator', L, `UPDATE booking SET fare_confirmation_status = 'Flagged for Review' WHERE booking_id = $1 RETURNING booking_id`],
    ['the LGU Administrator (a status change)', L, `UPDATE booking SET booking_status = 'Cancelled' WHERE booking_id = $1 RETURNING booking_id`],
    ['the LGU Administrator (a delete)', L, `DELETE FROM booking WHERE booking_id = $1 RETURNING booking_id`],
    ['the TODA Administrator', T1, `UPDATE booking SET cancellation_reason = 'edited' WHERE booking_id = $1 RETURNING booking_id`],
  ];
  for (const [who, uid, sql] of edits) {
    const r = await s.writeAs(uid, sql, [b.booking_id]);
    check(`${who} cannot change a completed trip (${sql.split(' WHERE')[0].replace(/ RETURNING.*/, '').slice(0, 56)})`, (!r.ok && /ERR_TRIP_COMPLETED_READ_ONLY|permission denied|row-level security/i.test(r.error)) || (r.ok && r.value.rows.length === 0), r.ok ? r.value.rows : r.error);
  }
  const keep = await s.bk(b.booking_id);
  check('the row is exactly as it was after all of those', keep.cancellation_reason === null && keep.fare_confirmation_status === 'Matched' && keep.booking_status === 'Completed' && keep.payment_status === 'Paid');
  const same = await s.writeAs(ID.P_AUTH, `UPDATE booking SET cancellation_reason = cancellation_reason WHERE booking_id = $1 RETURNING booking_id`, [b.booking_id]);
  check('writing the same values back is not a change and is allowed', same.ok && same.value.rows.length === 1, same);
  const sys = await attempt(() => internal(`UPDATE booking SET cancellation_reason = 'repaired by the system' WHERE booking_id = '${b.booking_id}'`));
  check('the system (service role, internal functions, a direct database session) is not held to it: repairs and the audited functions work', sys.ok && (await s.bk(b.booking_id)).cancellation_reason === 'repaired by the system', sys);
  const svcw = await attempt(() => s.svc((tx) => tx.query(`UPDATE booking SET cancellation_reason = 'service' WHERE booking_id = $1`, [b.booking_id])));
  check('...including the service role of the server', svcw.ok, svcw);
  const fix = await attempt(() => s.lguCall('admin_correct_completed_trip($1,$2,$3,$4)', [b.booking_id, 60, null, 'The distance was measured with a bad GPS: agreed with the driver']));
  check('the approved administrative action works on it and is audited (admin_correct_completed_trip)', fix.ok && (await s.audit('COMPLETED_TRIP_CORRECTED', b.booking_id)).length === 1 && Number((await s.bk(b.booking_id)).actual_fare) === 60, fix);
  const lgu2 = await s.writeAs(L, `UPDATE booking SET actual_fare = 1 WHERE booking_id = $1`, [b.booking_id]);
  check('while a plain fare edit by the LGU Administrator through the table is refused (the fare lock names it)', !lgu2.ok && /ERR_FARE_LOCKED/.test(lgu2.error), lgu2);
  await s.reset();

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS2 Rule 16.2: the system records the trip by itself, in order: the times, the distance, the fare, the route');
  b = await s.startTrip('D1', 'P1');
  await s.track(b.booking_id, 'D1', 67);                                           // 66 x 50 m = 3.3 km: the track reaches the destination
  await s.driverEnds('D1', b.booking_id);
  await s.paxCall('P1', 'passenger_confirm_fare($1)', [b.booking_id]);
  await s.drvCall('D1', 'driver_confirm_payment_received($1)', [b.booking_id]);
  const rec = await s.bk(b.booking_id);
  const ts = ['accepted_at', 'arrived_at', 'trip_started_at', 'fare_locked_at', 'confirm_fare_at', 'payment_received_at', 'trip_completed_at'].map((k) => rec[k]);
  check('every moment is recorded (accepted, arrived at the pickup, trip started, fare locked, fare confirmed, payment received, completed), all by the server and in order',
    ts.every((x) => x instanceof Date) && ts.every((x, i) => i === 0 || x >= ts[i - 1] || Math.abs(x - ts[i - 1]) < 1000), ts);
  const dur = (rec.trip_completed_at - rec.trip_started_at) / 1000;
  check('the duration is derivable from them (positive, a few seconds in the test) and the recorded distance is the GPS track (3.3 km), the fare the system\'s',
    dur >= 0 && dur < 600 && Number(rec.actual_distance_km) > 3.2 && Number(rec.actual_distance_km) < 3.4 && Number(rec.actual_fare) === 65, { dur, km: rec.actual_distance_km, fare: rec.actual_fare });
  check('the route history is the trip\'s GPS rows (kept against the booking)', Number((await one(`SELECT count(*)::int AS n FROM gps_log WHERE booking_id = '${b.booking_id}'`)).n) >= 67);
  await s.reset();

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS3 Rule 16.5 / D9-12: an incident report needs a Completed trip, except an emergency (Emergency, Safety Concern, Accident)');
  b = await s.atDestination('D1', 'P1');
  let r = await file(ID.P_AUTH, b.booking_id, 'Rude Behavior');
  check('a report about a trip that has not been completed is refused (the passenger)', !r.ok && /ERR_INCIDENT_AFTER_TRIP/.test(r.error), r);
  r = await file(ID.D_AUTH, b.booking_id, 'Rude Behavior', 'Driver');
  check('...and so is the driver\'s', !r.ok && /ERR_INCIDENT_AFTER_TRIP/.test(r.error), r);
  for (const cat of ['Emergency', 'Safety Concern', 'Accident']) {
    r = await file(ID.P_AUTH, b.booking_id, cat);
    check(`an emergency report is allowed during the trip: ${cat}`, r.ok === true, r);
  }
  await s.paxCall('P1', 'passenger_confirm_fare($1)', [b.booking_id]);
  await s.drvCall('D1', 'driver_confirm_payment_received($1)', [b.booking_id]);
  r = await file(ID.P_AUTH, b.booking_id, 'Rude Behavior');
  check('once the trip is Completed the ordinary report is accepted', r.ok === true, r);
  r = await file(ID.D_AUTH, b.booking_id, 'Rude Behavior', 'Driver');
  check('...for the driver too', r.ok === true, r);
  await s.reset();
  b = await s.startTrip('D1', 'P1');
  r = await file(ID.P_AUTH, b.booking_id, 'Overcharging Attempt');
  check('a trip still in progress: refused as well', !r.ok && /ERR_INCIDENT_AFTER_TRIP/.test(r.error), r);
  r = await file(ID.P_AUTH, b.booking_id, 'Emergency');
  check('...but an emergency is reported at once', r.ok === true, r);
  await s.reset();

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS4 Rule 18.7 / 18.8: repeated change-refusal complaints go to the TODA Administrator; a counterfeit allegation triggers nothing automatic');
  const done1 = await s.mkBooking(ID.P1, 'Completed', ID.D1), done2 = await s.mkBooking(ID.P1, 'Completed', ID.D1), done3 = await s.mkBooking(ID.P1, 'Completed', ID.D1);
  await file(ID.P_AUTH, done1, 'Change Refusal');
  await file(ID.P_AUTH, done2, 'Rude Behavior');
  check('one change-refusal complaint (and one other report): no flag', (await s.flags('DRIVER_CHANGE_REFUSAL_PATTERN', ID.D1)).length === 0);
  await file(ID.P_AUTH, done2, 'Change Refusal');
  check('two complaints: still no flag', (await s.flags('DRIVER_CHANGE_REFUSAL_PATTERN', ID.D1)).length === 0);
  await file(ID.P_AUTH, done3, 'Change Refusal');
  const cf = await s.flags('DRIVER_CHANGE_REFUSAL_PATTERN', ID.D1);
  check('the third in 30 days: ONE review flag for the driver\'s TODA Administrator, no strike', cf.length === 1 && cf[0].assigned_role === 'toda_admin' && cf[0].details.count === 3 && (await s.ledgerStrikes(ID.D1)).length === 0, cf);
  await file(ID.P_AUTH, done1, 'Change Refusal');
  check('a fourth does not open a second flag', (await s.flags('DRIVER_CHANGE_REFUSAL_PATTERN', ID.D1)).length === 1);
  await file(ID.P_AUTH, done1, 'Counterfeit Currency');
  check('Rule 18.8: a counterfeit-currency allegation is a report for the TODA Administrator and the police: no strike, no flag, nothing automatic',
    (await s.ledgerStrikes(ID.D1)).length === 0 && (await s.ledgerStrikes(ID.P1)).length === 0 && (await s.flags('DRIVER_CHANGE_REFUSAL_PATTERN', ID.D1)).length === 1);
  await s.reset();

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS5 PI-15: a trip left at the destination - the TODA Administrator closes it after 30 minutes, the LGU Administrator at any time');
  await internal(`UPDATE admin_review_flag SET status = 'Resolved' WHERE flag_type = 'PAYMENT_STUCK_RECONCILIATION'`);
  b = await s.atDestination('D1', 'P1');
  let cl = await attempt(() => s.todaCall('admin_close_unfinished_trip($1,$2,$3)', [b.booking_id, 'Paid', REASON]));
  check('a TODA Administrator cannot close a trip that has only just reached the destination (the driver can still finish it)', !cl.ok && /ERR_NOT_STUCK/.test(cl.error), cl);
  await s.lockedAgo(b.booking_id, 31 * 60);
  await s.sweep();
  check('after 31 minutes the sweep has flagged it for the TODA Administrator', (await s.flags('PAYMENT_STUCK_RECONCILIATION', ID.D1)).length === 1);
  cl = await attempt(() => s.todaCall('admin_close_unfinished_trip($1,$2,$3)', [b.booking_id, 'Paid', REASON], T2));
  check('another TODA\'s administrator cannot close it', !cl.ok && /Access Denied/.test(cl.error), cl);
  cl = await attempt(() => s.paxCall('P1', 'admin_close_unfinished_trip($1,$2,$3)', [b.booking_id, 'Paid', REASON]));
  check('nor the passenger', !cl.ok && /Access Denied/.test(cl.error), cl);
  cl = await attempt(() => s.todaCall('admin_close_unfinished_trip($1,$2,$3)', [b.booking_id, 'Payment Disputed', REASON]));
  check('it is closed as Paid or Waived only', !cl.ok && /ERR_CLOSE_PAYMENT/.test(cl.error), cl);
  cl = await attempt(() => s.todaCall('admin_close_unfinished_trip($1,$2,$3)', [b.booking_id, 'Paid', 'short']));
  check('the reason (who was reached, what they said) is mandatory', !cl.ok && /ERR_CLOSE_REASON/.test(cl.error), cl);
  cl = await attempt(() => s.todaCall('admin_close_unfinished_trip($1,$2,$3)', [b.booking_id, 'Paid', REASON]));
  let bk = await s.bk(b.booking_id);
  check('the driver\'s TODA Administrator closes it as Paid: Completed, Paid, the moment recorded, marked as unconfirmed by the passenger, the driver free',
    cl.ok && bk.booking_status === 'Completed' && bk.payment_status === 'Paid' && bk.payment_received_at !== null && bk.fare_unconfirmed === true
    && (await one(`SELECT public.driver_has_open_accepted_booking('${ID.D1}') AS o`)).o === false, { cl, bk });
  check('the stuck-trip flag is resolved, both parties are told, and it is audited with the before and after',
    (await s.flags('PAYMENT_STUCK_RECONCILIATION', ID.D1)).length === 0 && (await s.notices('TRIP_CLOSED_BY_ADMIN', b.booking_id)).length === 2
    && (await s.audit('UNFINISHED_TRIP_CLOSED', b.booking_id)).length === 1 && (await s.audit('UNFINISHED_TRIP_CLOSED', b.booking_id))[0].before_state.booking_status === 'Arrived at Destination');
  cl = await attempt(() => s.todaCall('admin_close_unfinished_trip($1,$2,$3)', [b.booking_id, 'Paid', REASON]));
  check('a trip that is no longer waiting cannot be closed again', !cl.ok && /ERR_NOT_AT_DESTINATION/.test(cl.error), cl);
  await s.reset();

  b = await s.atDestination('D1', 'P1');
  cl = await attempt(() => s.lguCall('admin_close_unfinished_trip($1,$2,$3)', [b.booking_id, 'Waived', 'Nobody was paid and the driver agreed to waive the fare']));
  bk = await s.bk(b.booking_id);
  const lg = await s.ledger(b.booking_id);
  check('the LGU Administrator can close it at any time; Waived: the fare 0, the ledger row ADMIN_CORRECTION 65 -> 0',
    cl.ok && bk.booking_status === 'Completed' && bk.payment_status === 'Waived' && Number(bk.actual_fare) === 0 && lg.length === 1 && lg[0].reason_code === 'ADMIN_CORRECTION' && Number(lg[0].previous_fare) === 65 && Number(lg[0].new_fare) === 0, { cl, bk, lg });
  await s.reset();

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
