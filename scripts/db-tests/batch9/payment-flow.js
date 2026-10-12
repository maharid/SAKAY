// Batch 9 (20261024000001), part 1: the end of the trip and the payment. Rules 16.1, 16.2, 16.6, 18.1 - 18.4, PI-08 / PI-13 (one merged prompt, one 120 s timer),
// PI-14 / PI-15 (the disputed flow, the passenger released), 29.5 (two taps at once). Required tests T1, T5 (sequential: the emulator has one connection), T7.
// The database holds every deadline, so the suite moves the stored timestamps back instead of waiting. Whole migration chain on the local emulator (never Supabase).
const { setup, ID, DRIVERS, attempt, check, summary } = require('../b9fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal } = s;
  const P1 = ID.P1;

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('S1 Rule 18.1 / 16.1: the driver ends the trip, the fare is locked and shown identically to both; nobody can complete the trip by writing the status');
  let b = await s.atDestination('D1', 'P1');
  check('End Trip at the destination: the booking is at the destination, unpaid, with a locked system fare', b.booking_status === 'Arrived at Destination' && b.payment_status === 'Unpaid' && b.fare_locked_at !== null && Number(b.actual_fare) === 65, b);
  const stP = await s.paxCall('P1', 'get_trip_end_state($1)', [b.booking_id]);
  const stD = await s.drvCall('D1', 'get_trip_end_state($1)', [b.booking_id]);
  check('Rule 18.1: the passenger and the driver read the SAME final fare from the same place', stP.success && stD.success && Number(stP.actual_fare) === 65 && Number(stD.actual_fare) === 65 && stP.fare_locked_at === stD.fare_locked_at, { stP, stD });
  check('the confirmation timer is the database\'s: 120 s in all, close to all of it left now', stP.timeout_seconds === 120 && stP.seconds_left >= 115 && stP.seconds_left <= 120 && stP.can_confirm_fare === true && stP.can_receive_payment === false, stP);
  const paxDone = await s.writeAs(ID.P_AUTH, `UPDATE booking SET booking_status = 'Completed' WHERE booking_id = $1 RETURNING booking_status`, [b.booking_id]);
  check('the passenger can no longer write Completed (the old "I Paid" tap): refused with the way to do it', !paxDone.ok && /ERR_USE_CONFIRM_FARE/.test(paxDone.error), paxDone);
  let drvDone = await s.driverSets('D1', b.booking_id, 'Completed');
  check('the driver cannot write Completed either', !drvDone.ok && /ERR_USE_PAYMENT_RECEIVED/.test(drvDone.error), drvDone);
  await s.lockedAgo(b.booking_id, 130);
  drvDone = await s.driverSets('D1', b.booking_id, 'Completed');
  check('...not even after the confirmation time (the Batch 6 "end after 120 s" is replaced by Payment Received)', !drvDone.ok && /ERR_USE_PAYMENT_RECEIVED/.test(drvDone.error), drvDone);
  await internal(`UPDATE booking SET fare_locked_at = clock_timestamp() WHERE booking_id = '${b.booking_id}'`);
  const lguDone = await s.writeAs(ID.L_AUTH, `UPDATE booking SET booking_status = 'Completed' WHERE booking_id = $1 RETURNING booking_status`, [b.booking_id]);
  check('an LGU administrator still can (support), and it is audited (decision D9-2: audited admin override)',
    lguDone.ok && (await s.audit('ADMIN_BOOKING_STATUS_OVERRIDE', b.booking_id)).length === 1, lguDone);
  await s.reset();

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS2 Rules 18.2 / 18.3 (T1): Payment Received cannot come before Confirm Fare / Report Fare Discrepancy; Paid needs BOTH');
  b = await s.atDestination('D1', 'P1');
  let r = await s.drvCall('D1', 'driver_confirm_payment_received($1)', [b.booking_id]);
  check('Payment Received before the passenger has answered: refused, with the seconds left', r.success === false && r.error_code === 'ERR_WAIT_FOR_PASSENGER' && r.seconds_left > 100, r);
  check('...and nothing changed: the trip is still at the destination, unpaid', (await s.bk(b.booking_id)).booking_status === 'Arrived at Destination' && (await s.bk(b.booking_id)).payment_status === 'Unpaid');
  const wrongPax = await s.paxCall('P2', 'passenger_confirm_fare($1)', [b.booking_id]);
  check('another passenger cannot confirm this fare', wrongPax.success === false && wrongPax.error_code === 'ERR_NOT_YOUR_BOOKING', wrongPax);
  const wrongDrv = await s.drvCall('D2', 'driver_confirm_payment_received($1)', [b.booking_id]);
  check('another driver cannot tap Payment Received', wrongDrv.success === false && wrongDrv.error_code === 'ERR_NOT_YOUR_BOOKING', wrongDrv);
  r = await s.paxCall('P1', 'passenger_confirm_fare($1)', [b.booking_id]);
  const c1 = await s.bk(b.booking_id);
  check('Confirm Fare: recorded with the server\'s time; the trip is NOT paid or completed yet (Paid needs both taps)',
    r.success && c1.confirm_fare_at !== null && c1.payment_status === 'Unpaid' && c1.booking_status === 'Arrived at Destination' && c1.payment_received_at === null, { r, c1 });
  const again = await s.paxCall('P1', 'passenger_confirm_fare($1)', [b.booking_id]);
  check('a second Confirm Fare is a no-op (the first time stands)', again.success && again.already_confirmed === true && (await s.bk(b.booking_id)).confirm_fare_at.getTime() === c1.confirm_fare_at.getTime(), again);
  const stD2 = await s.drvCall('D1', 'get_trip_end_state($1)', [b.booking_id]);
  check('the driver\'s Payment Received is enabled now', stD2.can_receive_payment === true && stD2.can_confirm_fare === false, stD2);
  const noReport = await s.paxCall('P1', 'passenger_report_fare_discrepancy($1,$2,$3)', [b.booking_id, 90, 'The driver asked for 90 pesos']);
  check('after confirming, the passenger cannot report a discrepancy for the same fare', noReport.success === false && noReport.error_code === 'ERR_FARE_ALREADY_CONFIRMED', noReport);
  r = await s.drvCall('D1', 'driver_confirm_payment_received($1)', [b.booking_id]);
  const c2 = await s.bk(b.booking_id);
  check('Payment Received after the confirmation: Paid, Completed, both moments recorded, the completion time the server\'s',
    r.success && c2.booking_status === 'Completed' && c2.payment_status === 'Paid' && c2.payment_received_at !== null && c2.confirm_fare_at !== null
    && c2.fare_unconfirmed === false && Math.abs(c2.trip_completed_at - Date.now()) < 60000, { r, c2 });
  const twice = await s.drvCall('D1', 'driver_confirm_payment_received($1)', [b.booking_id]);
  const c3 = await s.bk(b.booking_id);
  check('a second Payment Received is harmless: the same payment time, still one completion', twice.success && twice.already_received === true && c3.payment_received_at.getTime() === c2.payment_received_at.getTime() && c3.trip_completed_at.getTime() === c2.trip_completed_at.getTime(), twice);
  check('the audit trail has the two taps', (await s.audit('FARE_CONFIRMED', b.booking_id)).length === 1 && (await s.audit('PAYMENT_RECEIVED', b.booking_id)).length === 1);
  check('and the driver and the passenger are free again (no open booking)',
    (await one(`SELECT public.driver_has_open_accepted_booking('${ID.D1}') AS o`)).o === false && (await attempt(() => s.bookAs('P1'))).ok === true);
  const badPaid = await attempt(() => internal(`UPDATE booking SET payment_status = 'Paid', payment_received_at = NULL WHERE booking_id = '${b.booking_id}'`));
  check('the database itself refuses a Paid booking with no Payment Received (CHECK booking_paid_needs_both_check)', !badPaid.ok && /booking_paid_needs_both_check/.test(badPaid.error), badPaid);
  await s.reset();

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS3 Rule 16.6 / PI-08 (T7): no answer for 2 minutes - the driver may finish; "Paid - fare unconfirmed"; no strike; the late dispute window');
  b = await s.atDestination('D1', 'P1');
  await s.lockedAgo(b.booking_id, 110);
  r = await s.drvCall('D1', 'driver_confirm_payment_received($1)', [b.booking_id]);
  check('110 s after the fare was shown the driver still has to wait (about 10 s)', r.success === false && r.error_code === 'ERR_WAIT_FOR_PASSENGER' && r.seconds_left >= 1 && r.seconds_left <= 10, r);
  await s.lockedAgo(b.booking_id, 12);
  r = await s.drvCall('D1', 'driver_confirm_payment_received($1)', [b.booking_id]);
  const t1 = await s.bk(b.booking_id);
  check('after 120 s without an answer: Payment Received works; recorded Paid with the fare UNCONFIRMED (Completed without the passenger\'s acknowledgement)',
    r.success && r.basis === 'timeout' && t1.booking_status === 'Completed' && t1.payment_status === 'Paid' && t1.fare_unconfirmed === true && t1.confirm_fare_at === null, { r, t1 });
  check('this is not a strike for anybody (not a Passenger Payment Refusal)', (await s.ledgerStrikes(ID.P1)).length === 0 && (await s.ledgerStrikes(ID.D1)).length === 0);
  const dp0 = await s.paxCall('P1', 'get_trip_end_state($1)', [b.booking_id]);
  check('the passenger can still report the fare for 24 hours', dp0.late_dispute_open === true && dp0.can_report_discrepancy === true, dp0);
  const late = await s.paxCall('P1', 'passenger_report_fare_discrepancy($1,$2,$3)', [b.booking_id, 100, 'The driver took 100 pesos from me']);
  const t2 = await s.bk(b.booking_id);
  const d2 = await s.dispute(b.booking_id);
  check('the late report: the payment becomes Payment Disputed, the trip stays Completed, a LATE dispute is opened',
    late.success && late.late === true && t2.payment_status === 'Payment Disputed' && t2.booking_status === 'Completed' && d2 && d2.late === true && d2.kind === 'FARE_DISCREPANCY', { late, t2, d2 });
  await s.reset();

  b = await s.atDestination('D1', 'P1');
  await s.lockedAgo(b.booking_id, 130);
  await s.drvCall('D1', 'driver_confirm_payment_received($1)', [b.booking_id]);
  await s.paidAgo(b.booking_id, 25 * 3600);
  const closed = await s.paxCall('P1', 'passenger_report_fare_discrepancy($1,$2,$3)', [b.booking_id, 100, 'The driver took 100 pesos from me']);
  check('25 hours later the window is closed', closed.success === false && closed.error_code === 'ERR_LATE_WINDOW_CLOSED', closed);
  await s.reset();

  b = await s.atDestination('D1', 'P1');
  await s.paxCall('P1', 'passenger_confirm_fare($1)', [b.booking_id]);
  await s.drvCall('D1', 'driver_confirm_payment_received($1)', [b.booking_id]);
  const confirmedLate = await s.paxCall('P1', 'passenger_report_fare_discrepancy($1,$2,$3)', [b.booking_id, 100, 'The driver took 100 pesos from me']);
  check('a fare the passenger CONFIRMED cannot be reopened as a fare dispute (it goes through an incident report)', confirmedLate.success === false, confirmedLate);
  await s.reset();

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS4 Rule 18.4 / PI-14 (T2, the part before the review): Report Fare Discrepancy -> Payment Disputed -> documented; the driver can finish; the passenger is free');
  b = await s.atDestination('D1', 'P1');
  let bad = await s.paxCall('P1', 'passenger_report_fare_discrepancy($1,$2,$3)', [b.booking_id, null, 'The driver asked for more than the fare shown']);
  check('a discrepancy needs the amount the driver asked for', bad.success === false && bad.error_code === 'ERR_DISCREPANCY_AMOUNT', bad);
  bad = await s.paxCall('P1', 'passenger_report_fare_discrepancy($1,$2,$3)', [b.booking_id, 90, 'too short']);
  check('...and a reason of at least 10 characters (documented = amount + reason saved)', bad.success === false && bad.error_code === 'ERR_DISCREPANCY_REASON', bad);
  check('nothing was recorded by the refused attempts', (await s.bk(b.booking_id)).payment_status === 'Unpaid' && (await s.dispute(b.booking_id)) === undefined);
  const secondOpen = await attempt(() => s.bookAs('P1'));
  check('before the passenger has answered the booking is still open for the passenger (Rule 4.4)', !secondOpen.ok && /idx_one_open_booking/.test(secondOpen.error), secondOpen);
  r = await s.paxCall('P1', 'passenger_report_fare_discrepancy($1,$2,$3)', [b.booking_id, 90, 'The driver asked me for 90 pesos but the app says 65']);
  const e1 = await s.bk(b.booking_id);
  const dsp = await s.dispute(b.booking_id);
  check('Report Fare Discrepancy: the booking is Payment Disputed (not Paid), the dispute is documented (amount, reason, system fare, the TODA queue, 2 business days)',
    r.success && e1.payment_status === 'Payment Disputed' && e1.fare_discrepancy_at !== null && e1.booking_status === 'Arrived at Destination'
    && dsp && Number(dsp.claimed_amount) === 90 && Number(dsp.system_fare) === 65 && dsp.assigned_role === 'toda_admin' && dsp.toda_id === ID.TODA1 && dsp.status === 'Open', { r, e1, dsp });
  const noteRows = await q(`SELECT party, note FROM fare_dispute_note WHERE dispute_id = '${dsp.dispute_id}'`);
  check('the passenger\'s statement is the first note', noteRows.length === 1 && noteRows[0].party === 'passenger' && /asked me for 90/.test(noteRows[0].note), noteRows);
  const dueDays = (await one(`SELECT (SELECT due_at FROM fare_dispute WHERE booking_id = '${b.booking_id}') > clock_timestamp() + interval '1 day' AS ok`)).ok;
  check('the review is due in 2 business days (more than a day away, at most 4 calendar days)', dueDays === true);
  const rep2 = await s.paxCall('P1', 'passenger_report_fare_discrepancy($1,$2,$3)', [b.booking_id, 90, 'The driver asked me for 90 pesos but the app says 65']);
  check('reporting twice is idempotent: the same dispute, no second one', rep2.success && rep2.already_reported === true && rep2.dispute_id === dsp.dispute_id && (await q(`SELECT 1 FROM fare_dispute WHERE booking_id = '${b.booking_id}'`)).length === 1, rep2);
  const confirmAfter = await s.paxCall('P1', 'passenger_confirm_fare($1)', [b.booking_id]);
  check('after reporting, Confirm Fare is refused (it was one or the other)', confirmAfter.success === false && confirmAfter.error_code === 'ERR_DISCREPANCY_REPORTED', confirmAfter);
  check('the driver is told', (await s.notices('FARE_DISCREPANCY_REPORTED', b.booking_id)).length === 1);
  const nb = await attempt(() => s.bookAs('P1'));
  check('PI-15: the passenger who documented a discrepancy is free to book again while the driver has not tapped yet', nb.ok === true, nb.error);
  if (nb.ok) await s.finish(nb.value.booking_id);
  r = await s.drvCall('D1', 'driver_confirm_payment_received($1)', [b.booking_id]);
  const e2 = await s.bk(b.booking_id);
  check('the driver can tap Payment Received (once documented): the trip completes, the payment STAYS disputed', r.success && r.basis === 'disputed' && e2.booking_status === 'Completed' && e2.payment_status === 'Payment Disputed' && e2.fare_unconfirmed === false, { r, e2 });
  await s.reset();

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS5 PI-15: who is released, and the trip left at the destination');
  b = await s.atDestination('D1', 'P1');
  await s.paxCall('P1', 'passenger_confirm_fare($1)', [b.booking_id]);
  const free = await attempt(() => s.bookAs('P1'));
  check('a passenger who confirmed the fare can book again before the driver taps Payment Received', free.ok === true, free.error);
  if (free.ok) await s.finish(free.value.booking_id);
  check('the DRIVER stays Busy until Payment Received (his booking is still open)', (await s.status(DRIVERS.D1.id)) === 'Busy' || (await one(`SELECT public.driver_has_open_accepted_booking('${ID.D1}') AS o`)).o === true);
  await s.lockedAgo(b.booking_id, 31 * 60);
  const n1 = await s.sweep();
  const fl = await s.flags('PAYMENT_STUCK_RECONCILIATION', ID.D1);
  check('30 minutes at the destination: ONE review flag for the TODA Administrator, the booking marked as flagged',
    fl.length === 1 && fl[0].assigned_role === 'toda_admin' && fl[0].details.booking_id === b.booking_id && (await s.bk(b.booking_id)).payment_stuck_flagged_at !== null, fl);
  await s.sweep(); await s.sweep();
  check('the sweep never flags it twice', (await s.flags('PAYMENT_STUCK_RECONCILIATION', ID.D1)).length === 1 && (await s.audit('PAYMENT_STUCK_FLAGGED', b.booking_id)).length === 1);
  await s.reset();
  await internal(`UPDATE admin_review_flag SET status = 'Resolved' WHERE flag_type = 'PAYMENT_STUCK_RECONCILIATION'`);
  b = await s.atDestination('D1', 'P1');
  await s.lockedAgo(b.booking_id, 25 * 60);
  await s.sweep();
  check('25 minutes: no flag yet', (await s.flags('PAYMENT_STUCK_RECONCILIATION', ID.D1)).length === 0 && (await s.bk(b.booking_id)).payment_stuck_flagged_at === null);
  await s.reset();

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS6 Rule 29.5 (T5): two taps at once - one wins, the result is the same, nothing is done twice (sequential: the emulator has one connection)');
  b = await s.startTrip('D1', 'P1');
  await s.reachDestination(b.booking_id);
  const passengerFirst = await s.paxCall('P1', 'passenger_request_early_end($1,$2,$3)', [b.booking_id, 'changed_plans', null]);
  check('the passenger taps End Trip (Early) at the destination: nothing to unlock (the driver can already end it)', passengerFirst.success && passengerFirst.at_gate === true, passengerFirst);
  const d1 = await s.driverSets('D1', b.booking_id, 'Arrived at Destination');
  const ledgerAfter = (await s.ledger(b.booking_id)).length;
  const lockAt = (await s.bk(b.booking_id)).fare_locked_at.getTime();
  const lateTap = await s.paxCall('P1', 'passenger_request_early_end($1,$2,$3)', [b.booking_id, 'changed_plans', null]);
  const d2b = await s.driverSets('D1', b.booking_id, 'Arrived at Destination');
  const after = await s.bk(b.booking_id);
  check('the driver ends it; the passenger\'s late tap and the driver\'s second tap change nothing: one fare lock, the same fare, no second ledger row, no early end recorded',
    d1.ok && lateTap.success && lateTap.already_ended === true && d2b.ok && after.fare_locked_at.getTime() === lockAt && Number(after.actual_fare) === 65 && (await s.ledger(b.booking_id)).length === ledgerAfter && after.early_end_kind === null, { lateTap, after });
  await s.reset();

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
