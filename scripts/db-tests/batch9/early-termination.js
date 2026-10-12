// Batch 9 (20261024000001), part 2: ending a trip before the destination. Rules 13.2 - 13.10, 29.3, decisions D9-6 (End Trip (Early) is a request; the driver holds the
// transition), D9-7 (the distance is the recorded GPS track), D9-8 (a driver's early stop: actual distance only, a review flag, no automatic strike),
// D9-9 (personal and Safety Concern ends are counted apart). Required tests T3 (personal = greater of; safety = provisional + history + review), T4 (driver stop).
// The estimate of the test trip is 3.3 km = PHP 65 (Solo); a 1.0 km track is PHP 60 (the base-fare floor), a 4.93 km track is PHP 72.
// Whole migration chain on the local emulator (never Supabase).
const { setup, ID, DRIVERS, attempt, check, summary } = require('../b9fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, PICKUP } = s;
  const near = (v, lo, hi) => typeof v === 'number' && v >= lo && v <= hi;
  const DEG = 1 / 111195;

  // a trip with the driver 1 km north of the pickup (30 % of the 3.3 km), a 1.0 km recorded track behind him
  const tripAt1km = async (o = {}) => {
    const b = await s.startTrip('D1', 'P1');
    if (o.track !== false) await s.track(b.booking_id, 'D1', 21);
    await s.driverAt('D1', 1000, 10);
    return b;
  };
  const endBy = (bookingId) => s.driverSets('D1', bookingId, 'Arrived at Destination');
  const request = (bookingId, reason, note = null) => s.paxCall('P1', 'passenger_request_early_end($1,$2,$3)', [bookingId, reason, note]);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('S1 Rule 13.2 / D9-6: End Trip (Early) is a REQUEST; the driver holds the End Trip transition, which the request unlocks');
  let b = await tripAt1km();
  const gated = await endBy(b.booking_id);
  check('without a request the driver cannot end the trip at 30 % of the route (the 90 % gate is unchanged)', !gated.ok && /ERR_TRIP_NOT_FAR_ENOUGH/.test(gated.error), gated);
  const paxEnds = await s.writeAs(ID.P_AUTH, `UPDATE booking SET booking_status = 'Arrived at Destination' WHERE booking_id = $1 RETURNING booking_status`, [b.booking_id]);
  check('the passenger can no longer end the trip by writing the status (it used to work from anywhere)', !paxEnds.ok && /ERR_USE_EARLY_END/.test(paxEnds.error), paxEnds);
  let r = await request(b.booking_id, 'no_such_reason');
  check('a reason from the list is required', r.success === false && r.error_code === 'ERR_EARLY_REASON_REQUIRED', r);
  r = await s.paxCall('P2', 'passenger_request_early_end($1,$2,$3)', [b.booking_id, 'changed_plans', null]);
  check('another passenger cannot ask for this trip', r.success === false && r.error_code === 'ERR_NOT_YOUR_BOOKING', r);
  r = await s.drvCall('D1', 'passenger_request_early_end($1,$2,$3)', [b.booking_id, 'changed_plans', null]);
  check('a driver cannot make the passenger\'s request', r.success === false && r.error_code === 'ERR_NOT_A_PASSENGER', r);
  r = await request(b.booking_id, 'changed_plans', 'I will walk from here');
  let bk = await s.bk(b.booking_id);
  check('the request is recorded (personal, the time, the reason with the note) and the trip goes on: it is NOT a cancellation',
    r.success && r.kind === 'PERSONAL' && bk.early_end_kind === 'PERSONAL' && bk.early_end_requested_at !== null && /changed_plans: I will walk/.test(bk.early_end_reason)
    && bk.booking_status === 'Trip Ongoing' && bk.early_end_at === null && bk.cancelled_at === null, { r, bk });
  check('no cancellation record, no strike for either party (Rule 13.6)',
    (await q(`SELECT 1 FROM cancellation_record WHERE booking_id = '${b.booking_id}'`)).length === 0 && (await s.ledgerStrikes(ID.P1)).length === 0 && (await s.ledgerStrikes(ID.D1)).length === 0);
  check('the driver is told, with the reminder to stop in a safe place (Rule 13.3), and the request is audited',
    (await s.notices('EARLY_END_REQUESTED', b.booking_id)).length === 1 && (await s.audit('EARLY_END_REQUESTED', b.booking_id)).length === 1);
  r = await request(b.booking_id, 'changed_plans', 'I will walk from here');
  check('a second tap is a no-op', r.success && r.already_requested === true && (await s.notices('EARLY_END_REQUESTED', b.booking_id)).length === 1, r);
  const forged = await s.writeAs(ID.P_AUTH, `UPDATE booking SET early_end_kind = 'PERSONAL', early_end_requested_at = now() WHERE booking_id = $1 RETURNING booking_id`, [b.booking_id]);
  const forged2 = await s.writeAs(ID.D_AUTH, `UPDATE booking SET early_end_latitude = 13.5, early_end_at = now() WHERE booking_id = $1 RETURNING booking_id`, [b.booking_id]);
  check('neither the passenger nor the driver can write the early-end columns themselves', !forged.ok && /ERR_PAYMENT_LOCKED/.test(forged.error) && !forged2.ok && /ERR_PAYMENT_LOCKED/.test(forged2.error), { forged, forged2 });
  r = await request(b.booking_id, 'safety_concern');
  bk = await s.bk(b.booking_id);
  check('the passenger can raise it to a Safety Concern (and the first request time is kept)', r.success && r.kind === 'SAFETY' && bk.early_end_kind === 'SAFETY', { r, bk });
  r = await request(b.booking_id, 'changed_plans');
  check('a Safety Concern is never downgraded to a personal end', r.success && r.already_requested === true && (await s.bk(b.booking_id)).early_end_kind === 'SAFETY', r);
  const ended = await endBy(b.booking_id);
  check('the request unlocks the driver\'s End Trip outside the gate (no GPS position is required of the driver: Rule 13.3, his judgment)', ended.ok && ended.value.rows[0].booking_status === 'Arrived at Destination', ended);
  await s.reset();

  b = await tripAt1km();
  await request(b.booking_id, 'earlier_dropoff');
  r = await s.paxCall('P1', 'passenger_withdraw_early_end($1)', [b.booking_id]);
  bk = await s.bk(b.booking_id);
  check('the passenger can withdraw the request before the driver ends the trip', r.success && r.withdrawn === true && bk.early_end_kind === null && bk.early_end_requested_at === null && bk.early_end_reason === null, { r, bk });
  const blockedAgain = await endBy(b.booking_id);
  check('...and the driver is gated again', !blockedAgain.ok && /ERR_TRIP_NOT_FAR_ENOUGH/.test(blockedAgain.error), blockedAgain);
  r = await s.paxCall('P1', 'passenger_withdraw_early_end($1)', [b.booking_id]);
  check('withdrawing nothing is harmless', r.success && r.nothing_to_withdraw === true, r);
  await s.reset();

  b = await s.startTrip('D1', 'P1');
  r = await request(b.booking_id, 'changed_plans');
  check('(control) a trip that has only just started: the request is recorded like any other', r.success && r.kind === 'PERSONAL', r);
  await s.reset();
  await s.online('D1', 300);
  const assigned = await s.bookAndAccept('D1', 'P1');
  r = await request(assigned.booking_id, 'changed_plans');
  check('before the trip starts there is nothing to end early (that is a cancellation, Section 12)', r.success === false && r.error_code === 'ERR_TRIP_NOT_ONGOING', r);
  await s.reset();

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS2 Rules 13.4 / 13.5 (T3): the fare of an early end - personal: the GREATER of the estimate and the actual distance; Safety Concern: the actual distance, provisional');
  b = await tripAt1km();
  await request(b.booking_id, 'changed_plans');
  r = await endBy(b.booking_id);
  bk = await s.bk(b.booking_id);
  let lg = await s.ledger(b.booking_id);
  check('PERSONAL, 1.0 km travelled (PHP 60) of a PHP 65 estimate: charged PHP 65 (the accepted estimate is the greater)', r.ok && Number(bk.actual_fare) === 65 && bk.early_end_kind === 'PERSONAL', { fare: bk.actual_fare, kind: bk.early_end_kind });
  check('the approved early point is recorded: the driver\'s fix (about 1 km north of the pickup, 10 m accuracy) and the time',
    near(bk.early_end_latitude, PICKUP.lat + 995 * DEG, PICKUP.lat + 1005 * DEG) && bk.early_end_longitude === PICKUP.lng && bk.early_end_accuracy_m === 10
    && bk.early_end_at !== null && Math.abs(bk.early_end_at - Date.now()) < 60000, bk);
  check('the recorded distance is the GPS track (about 1.0 km), the final breakdown names the early end and its basis',
    near(Number(bk.actual_distance_km), 0.99, 1.02) && bk.fare_breakdown.final.early_end.kind === 'PERSONAL' && bk.fare_breakdown.final.distance_basis === 'estimate_is_greater_than_actual'
    && bk.fare_breakdown.final.early_end.provisional === false, bk.fare_breakdown && bk.fare_breakdown.final);
  check('one ledger row EARLY_TERMINATION: 65 -> 65, not a route deviation', lg.length === 1 && lg[0].reason_code === 'EARLY_TERMINATION' && Number(lg[0].previous_fare) === 65 && Number(lg[0].new_fare) === 65 && lg[0].details.kind === 'PERSONAL', lg);
  check('Rule 13.8: both parties still do the standard flow - the fare is shown, Confirm Fare, Payment Received, Paid',
    (await s.paxCall('P1', 'passenger_confirm_fare($1)', [b.booking_id])).success
    && (await s.drvCall('D1', 'driver_confirm_payment_received($1)', [b.booking_id])).payment_status === 'Paid' && (await s.bk(b.booking_id)).booking_status === 'Completed');
  check('and Rule 13.6: no strike, no cancellation', (await s.ledgerStrikes(ID.P1)).length === 0 && (await s.ledgerStrikes(ID.D1)).length === 0);
  await s.reset();

  // a longer ride than the estimate: 4.93 km east, never near the destination
  b = await s.startTrip('D1', 'P1');
  await s.track(b.booking_id, 'D1', 100, { stepDeg: 0, lngDeg: 0.00046 });
  await internal(`UPDATE driver SET current_latitude = ${PICKUP.lat}, current_longitude = ${PICKUP.lng + 99 * 0.00046}, last_location_update = clock_timestamp(), last_location_accuracy_m = 10 WHERE driver_id = '${ID.D1}'`);
  await request(b.booking_id, 'walk_rest');
  r = await endBy(b.booking_id);
  bk = await s.bk(b.booking_id);
  lg = await s.ledger(b.booking_id);
  check('PERSONAL, 4.93 km travelled (more than estimated): charged the actual-distance fare PHP 72', r.ok && Number(bk.actual_fare) === 72 && bk.fare_breakdown.final.distance_basis === 'actual_distance_to_early_point', { r, fare: bk.actual_fare, basis: bk.fare_breakdown && bk.fare_breakdown.final.distance_basis });
  check('the ledger shows 65 -> 72', lg.length === 1 && Number(lg[0].previous_fare) === 65 && Number(lg[0].new_fare) === 72, lg);
  await s.reset();

  b = await tripAt1km();
  await request(b.booking_id, 'safety_concern', 'The driver was driving dangerously');
  r = await endBy(b.booking_id);
  bk = await s.bk(b.booking_id);
  lg = await s.ledger(b.booking_id);
  check('SAFETY CONCERN, 1.0 km travelled: the provisional actual-distance fare PHP 60 (NOT raised to the estimate)', r.ok && Number(bk.actual_fare) === 60 && bk.early_end_kind === 'SAFETY' && bk.fare_breakdown.final.early_end.provisional === true, { fare: bk.actual_fare });
  check('the approved early point (GPS and time) is recorded for the review', bk.early_end_latitude !== null && bk.early_end_longitude !== null && bk.early_end_at !== null);
  check('a fare_adjustment_history row with the reason "Safety Early Termination" (SAFETY_EARLY_TERMINATION): 65 -> 60, provisional',
    lg.length === 1 && lg[0].reason_code === 'SAFETY_EARLY_TERMINATION' && Number(lg[0].previous_fare) === 65 && Number(lg[0].new_fare) === 60 && lg[0].details.provisional === true, lg);
  check('it is NOT automatically a fare dispute: no dispute record, the payment is not disputed', (await s.dispute(b.booking_id)) === undefined && bk.payment_status === 'Unpaid' && bk.fare_discrepancy_at === null);
  r = await s.paxCall('P1', 'request_safety_fare_review($1,$2)', [b.booking_id, 'I did not feel safe, please review the fare']);
  const sd = await s.dispute(b.booking_id);
  check('the passenger can ask for an administrative review: a SAFETY_REVIEW for the TODA Administrator, the payment still untouched',
    r.success && sd && sd.kind === 'SAFETY_REVIEW' && sd.assigned_role === 'toda_admin' && sd.status === 'Open' && (await s.bk(b.booking_id)).payment_status === 'Unpaid', { r, sd });
  r = await s.paxCall('P1', 'request_safety_fare_review($1,$2)', [b.booking_id, 'I did not feel safe, please review the fare']);
  check('asking twice does not open a second review', r.success && r.dispute_id === sd.dispute_id && (await q(`SELECT 1 FROM fare_dispute WHERE booking_id = '${b.booking_id}'`)).length === 1, r);
  await s.reset();
  b = await tripAt1km();
  await request(b.booking_id, 'changed_plans');
  await endBy(b.booking_id);
  r = await s.paxCall('P1', 'request_safety_fare_review($1,$2)', [b.booking_id, 'I want the fare reviewed anyway please']);
  check('the review is only for a Safety Concern end', r.success === false && r.error_code === 'ERR_NOT_A_SAFETY_END', r);
  await s.reset();

  console.log('\n   without a usable track the fare is never guessed upward against the passenger');
  b = await s.startTrip('D1', 'P1');
  await internal(`UPDATE driver SET current_latitude = ${PICKUP.lat + 1000 * DEG}, current_longitude = ${PICKUP.lng}, last_location_update = clock_timestamp(), last_location_accuracy_m = 10 WHERE driver_id = '${ID.D1}'`);
  await request(b.booking_id, 'safety_concern');
  await endBy(b.booking_id);
  bk = await s.bk(b.booking_id);
  check('SAFETY with no track: the straight line from the pickup to the early point (1 km = PHP 60), labelled', Number(bk.actual_fare) === 60 && bk.fare_breakdown.final.distance_basis === 'straight_line_to_early_point_no_track', bk.fare_breakdown && bk.fare_breakdown.final);
  await s.reset();
  b = await s.startTrip('D1', 'P1');
  await internal(`UPDATE driver SET current_latitude = ${PICKUP.lat + 1000 * DEG}, current_longitude = ${PICKUP.lng}, last_location_update = clock_timestamp(), last_location_accuracy_m = 10 WHERE driver_id = '${ID.D1}'`);
  await request(b.booking_id, 'changed_plans');
  await endBy(b.booking_id);
  bk = await s.bk(b.booking_id);
  check('PERSONAL with no track: the estimate (its floor anyway), labelled', Number(bk.actual_fare) === 65 && bk.fare_breakdown.final.distance_basis === 'estimate_no_track', bk.fare_breakdown && bk.fare_breakdown.final);
  await s.reset();
  b = await s.startTrip('D1', 'P1');
  await internal(`UPDATE driver SET last_location_update = clock_timestamp() - interval '10 minutes' WHERE driver_id = '${ID.D1}'`);
  await request(b.booking_id, 'safety_concern');
  await endBy(b.booking_id);
  bk = await s.bk(b.booking_id);
  check('no usable position at all: the point is left empty (nothing is guessed), the provisional fare is the estimate, for the review',
    bk.early_end_latitude === null && bk.early_end_at !== null && Number(bk.actual_fare) === 65 && bk.fare_breakdown.final.distance_basis === 'estimate_no_track', bk);
  await s.reset();

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS3 Rules 13.7 / 29.3 (T4): the DRIVER ends the trip early - actual distance only, a TODA review flag, no automatic strike');
  b = await tripAt1km();
  r = await s.drvCall('D1', 'driver_stop_trip_early($1,$2,$3)', [b.booking_id, 'no_such_reason', null]);
  check('a reason from the list is required', r.success === false && r.error_code === 'ERR_EARLY_REASON_REQUIRED', r);
  r = await s.drvCall('D2', 'driver_stop_trip_early($1,$2,$3)', [b.booking_id, 'vehicle_breakdown', null]);
  check('only the trip\'s own driver can stop it', r.success === false && r.error_code === 'ERR_NOT_YOUR_BOOKING', r);
  const asPax = await s.paxCall('P1', 'driver_stop_trip_early($1,$2,$3)', [b.booking_id, 'vehicle_breakdown', null]);
  check('a passenger cannot call it', asPax.success === false && asPax.error_code === 'ERR_NOT_A_DRIVER', asPax);
  r = await s.drvCall('D1', 'driver_stop_trip_early($1,$2,$3)', [b.booking_id, 'vehicle_breakdown', 'a flat tire']);
  bk = await s.bk(b.booking_id);
  lg = await s.ledger(b.booking_id);
  check('the trip ends at the driver\'s stop: the passenger is charged the ACTUAL-distance fare only (PHP 60, not the PHP 65 estimate)',
    r.success && r.valid_reason === true && bk.booking_status === 'Arrived at Destination' && bk.early_end_kind === 'DRIVER' && Number(bk.actual_fare) === 60, { r, fare: bk.actual_fare });
  check('the approved point and time are recorded, the ledger has the row', bk.early_end_latitude !== null && bk.early_end_at !== null && lg.length === 1 && lg[0].reason_code === 'EARLY_TERMINATION'
    && Number(lg[0].previous_fare) === 65 && Number(lg[0].new_fare) === 60 && lg[0].details.kind === 'DRIVER', lg);
  check('no automatic strike for the driver (a breakdown is also a waived reason), the passenger is not struck, and it is not a cancellation',
    (await s.ledgerStrikes(ID.D1)).length === 0 && (await s.ledgerStrikes(ID.P1)).length === 0 && bk.cancelled_at === null);
  const fl = await s.flags('DRIVER_EARLY_STOP_REVIEW', ID.D1);
  check('a TODA review flag is raised (Rule 13.7: review for a possible incident or violation), naming the booking and that the reason is valid',
    fl.length === 1 && fl[0].assigned_role === 'toda_admin' && fl[0].details.booking_id === b.booking_id && fl[0].details.valid_reason === true, fl);
  check('the passenger is told and the stop is audited', (await s.notices('DRIVER_STOPPED_TRIP', b.booking_id)).length === 1 && (await s.audit('DRIVER_EARLY_STOP', b.booking_id)).length === 1);
  r = await s.drvCall('D1', 'driver_stop_trip_early($1,$2,$3)', [b.booking_id, 'vehicle_breakdown', null]);
  check('a second tap is a no-op', r.success && r.already_ended === true && (await s.ledger(b.booking_id)).length === 1, r);
  const cant = await s.drvCall('D1', 'driver_cancel_booking($1,$2,$3)', [b.booking_id, 'vehicle_breakdown', null]);
  check('the driver cannot turn it into a cancellation after the trip has started (Section 12 is for the approach)', cant.success === false, cant);
  console.log('   the driver\'s confirmation of a violation (never for a breakdown, a safety concern or an emergency)');
  let conf = await attempt(() => s.todaCall('admin_confirm_flagged_violation($1,$2,$3,$4)', [fl[0].flag_id, b.booking_id, 'Confirmed after review of the reasons', null]));
  check('DRV_EARLY_STOP is refused for a breakdown', !conf.ok && /ERR_VALID_REASON/.test(conf.error), conf);
  await s.todaCall('resolve_admin_review_flag($1,$2,$3)', [fl[0].flag_id, 'Dismissed', 'A breakdown: no violation']);
  await s.reset();

  b = await tripAt1km();
  r = await s.drvCall('D1', 'driver_stop_trip_early($1,$2,$3)', [b.booking_id, 'passenger_dispute', 'We argued about the fare, I stopped']);
  const fl2 = await s.flags('DRIVER_EARLY_STOP_REVIEW', ID.D1);
  check('29.3: refusing to continue after boarding (a dispute) is a stop with an invalid reason: flagged, still no automatic strike',
    r.success && r.valid_reason === false && fl2.length === 1 && fl2[0].details.valid_reason === false && (await s.ledgerStrikes(ID.D1)).length === 0, { r, fl2 });
  conf = await attempt(() => s.todaCall('admin_confirm_flagged_violation($1,$2,$3,$4)', [fl2[0].flag_id, b.booking_id, 'Confirmed after review of the reasons', null], ID.T2_AUTH));
  check('the other TODA\'s administrator cannot confirm a strike on this driver', !conf.ok, conf);
  conf = await attempt(() => s.todaCall('admin_confirm_flagged_violation($1,$2,$3,$4)', [fl2[0].flag_id, b.booking_id, 'short', null]));
  check('the confirmation needs a written reason', !conf.ok && /ERR_CONFIRM_REASON/.test(conf.error), conf);
  conf = await attempt(() => s.todaCall('admin_confirm_flagged_violation($1,$2,$3,$4)', [fl2[0].flag_id, b.booking_id, 'Confirmed after review: no valid reason', null]));
  const st = await s.ledgerStrikes(ID.D1);
  check('the driver\'s own TODA Administrator confirms: ONE DRV_EARLY_STOP (1 point), issued by the TODA administrator, the flag resolved',
    conf.ok && st.length === 1 && st[0].violation_code === 'DRV_EARLY_STOP' && st[0].points_active === 1 && st[0].issued_by_role === 'toda_admin' && (await s.flags('DRIVER_EARLY_STOP_REVIEW', ID.D1)).length === 0, { conf, st });
  conf = await attempt(() => s.todaCall('admin_confirm_flagged_violation($1,$2,$3,$4)', [fl2[0].flag_id, b.booking_id, 'Confirmed after review: no valid reason', null]));
  check('confirming again changes nothing (the flag is closed)', !conf.ok && /ERR_FLAG_NOT_OPEN/.test(conf.error) && (await s.ledgerStrikes(ID.D1)).length === 1, conf);
  await s.clearStrikes(); await s.reset();

  b = await tripAt1km();
  await request(b.booking_id, 'changed_plans');
  r = await s.drvCall('D1', 'driver_stop_trip_early($1,$2,$3)', [b.booking_id, 'vehicle_breakdown', null]);
  check('when the passenger has already asked, the driver ends it with End Trip (no second record)', r.success === false && r.error_code === 'ERR_USE_END_TRIP', r);
  await s.reset();

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS4 Rule 13.6 / D9-9: early ends are counted - 3 personal ends in 30 days flag a possible fare-avoidance pattern; Safety Concern ends are counted apart');
  // end to end: the early ends of S2 were made through the real trip flow by P1 (4 personal, 3 Safety Concern): the counters already fired by themselves
  check('end to end: the third personal early end of S2 (through the real trip flow) raised the fare-avoidance review flag, and the third Safety Concern end the SEPARATE safety flag; each once',
    (await s.flags('PASSENGER_EARLY_END_PATTERN', ID.P1)).length === 1 && (await s.flags('PASSENGER_SAFETY_END_PATTERN', ID.P1)).length === 1);
  console.log('   the same counters, isolated, for a passenger with no history (P2), the rows written directly');
  const earlyEnd = async (kind, ageDays = 0) => {
    const id = await s.mkBooking(ID.P2, 'Completed', ID.D1);
    await internal(`UPDATE booking SET early_end_kind = '${kind}', early_end_reason = 'x', early_end_at = clock_timestamp() - interval '${ageDays} days' WHERE booking_id = '${id}'`);
    return id;
  };
  await earlyEnd('PERSONAL'); await earlyEnd('PERSONAL');
  check('two personal early ends: no flag', (await s.flags('PASSENGER_EARLY_END_PATTERN', ID.P2)).length === 0);
  await earlyEnd('SAFETY'); await earlyEnd('SAFETY');
  check('two safety ends on top: still no flag of either kind (the counters are separate)', (await s.flags('PASSENGER_EARLY_END_PATTERN', ID.P2)).length === 0 && (await s.flags('PASSENGER_SAFETY_END_PATTERN', ID.P2)).length === 0);
  await earlyEnd('PERSONAL', 31);
  check('a personal end 31 days old does not count', (await s.flags('PASSENGER_EARLY_END_PATTERN', ID.P2)).length === 0);
  await earlyEnd('PERSONAL');
  let pf = await s.flags('PASSENGER_EARLY_END_PATTERN', ID.P2);
  check('the third personal end in 30 days: ONE review flag for the LGU Administrator (the passenger has no TODA), with the three trips',
    pf.length === 1 && pf[0].assigned_role === 'lgu_admin' && pf[0].details.count === 3 && pf[0].details.trips.length === 3 && pf[0].source_rule === 'Rule 13.6', pf);
  await earlyEnd('PERSONAL');
  check('a fourth does not open a second flag', (await s.flags('PASSENGER_EARLY_END_PATTERN', ID.P2)).length === 1);
  check('nothing is automatic: the passenger has no strike', (await s.ledgerStrikes(ID.P2)).length === 0);
  await earlyEnd('SAFETY');
  const sf = await s.flags('PASSENGER_SAFETY_END_PATTERN', ID.P2);
  check('the third Safety Concern end raises the SEPARATE safety-pattern flag', sf.length === 1 && sf[0].assigned_role === 'lgu_admin' && sf[0].details.kind === 'SAFETY', sf);
  let cf = await attempt(() => s.todaCall('admin_confirm_flagged_violation($1,$2,$3,$4)', [pf[0].flag_id, null, 'Confirmed after review of the trips', null]));
  check('a TODA Administrator cannot confirm a passenger strike (Rule 13.6: the LGU Administrator does)', !cf.ok && /Access Denied/.test(cf.error), cf);
  cf = await attempt(() => s.lguCall('admin_confirm_flagged_violation($1,$2,$3,$4)', [sf[0].flag_id, null, 'Confirmed after review of the trips', null]));
  check('a safety-pattern flag has no strike to confirm', !cf.ok && /ERR_FLAG_NOT_CONFIRMABLE/.test(cf.error), cf);
  cf = await attempt(() => s.lguCall('admin_confirm_flagged_violation($1,$2,$3,$4)', [pf[0].flag_id, null, 'Confirmed after review of the trips', null]));
  const ps = await s.ledgerStrikes(ID.P2);
  check('the LGU Administrator confirms: ONE PAX_FARE_AVOIDANCE (1 point), the flag resolved',
    cf.ok && ps.length === 1 && ps[0].violation_code === 'PAX_FARE_AVOIDANCE' && ps[0].points_active === 1 && ps[0].issued_by_role === 'lgu_admin' && (await s.flags('PASSENGER_EARLY_END_PATTERN', ID.P2)).length === 0, { cf, ps });
  await s.clearStrikes();

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS5 Rules 13.9 / 13.10 / 29.4: no destination change, no stopover repricing - nothing silently re-prices a confirmed booking');
  await s.reset();
  b = await tripAt1km();
  const dest = await s.writeAs(ID.P_AUTH, `UPDATE booking SET dropoff_latitude = 13.5, dropoff_longitude = 121.3 WHERE booking_id = $1 RETURNING booking_id`, [b.booking_id]);
  check('the passenger cannot change the destination during the trip', !dest.ok && /ERR_BOOKING_LOCKED/.test(dest.error), dest);
  await request(b.booking_id, 'changed_plans');
  const dest2 = await s.writeAs(ID.P_AUTH, `UPDATE booking SET dropoff_address = 'somewhere else', estimated_fare = 20 WHERE booking_id = $1 RETURNING booking_id`, [b.booking_id]);
  const dest3 = await s.writeAs(ID.D_AUTH, `UPDATE booking SET dropoff_latitude = 13.5 WHERE booking_id = $1 RETURNING booking_id`, [b.booking_id]);
  check('...nor after an early-end request, and the driver cannot either (the estimate stays what was accepted)', !dest2.ok && /ERR_BOOKING_LOCKED/.test(dest2.error) && !dest3.ok && /ERR_BOOKING_LOCKED/.test(dest3.error), { dest2, dest3 });
  const fareWrite = await s.writeAs(ID.D_AUTH, `UPDATE booking SET actual_fare = 10 WHERE booking_id = $1 RETURNING booking_id`, [b.booking_id]);
  check('nobody can edit the fare (Rule 18.1)', !fareWrite.ok && /ERR_FARE_LOCKED/.test(fareWrite.error), fareWrite);
  await s.reset();

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
