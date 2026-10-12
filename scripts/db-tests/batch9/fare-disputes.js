// Batch 9 (20261024000001), part 3: the fare dispute from the passenger's report to the administrator's decision. Rules 13.5, 18.4 - 18.6, decisions D9-5, D9-13 / D9-14
// (the TODA Administrator first, the LGU Administrator on escalation), F9.5 (2 / 3 business days, shown as overdue, never auto-resolved), W4 (the strikes only through
// issue_strike, as the administrator who confirms). Required test T2 (Report Fare Discrepancy -> Payment Disputed -> documented -> TODA review -> resolved).
// Whole migration chain on the local emulator (never Supabase).
const { setup, ID, DRIVERS, attempt, check, summary } = require('../b9fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, as } = s;
  const BIG = 'The driver asked me for 90 pesos but the app says 65';

  // a trip with a documented fare discrepancy; the driver has tapped Payment Received (Completed, Payment Disputed)
  const disputed = async (o = {}) => {
    const b = await s.atDestination('D1', 'P1');
    const r = await s.paxCall('P1', 'passenger_report_fare_discrepancy($1,$2,$3)', [b.booking_id, 90, BIG]);
    if (!r.success) throw new Error('report failed ' + JSON.stringify(r));
    if (o.finish !== false) {
      const f = await s.drvCall('D1', 'driver_confirm_payment_received($1)', [b.booking_id]);
      if (!f.success) throw new Error('finish failed ' + JSON.stringify(f));
    }
    return { b, dispute: await s.dispute(b.booking_id) };
  };
  const resolve = (uid, id, outcome, fare, reason, strike = null) => attempt(() => s.rpcAs(uid, 'public.resolve_fare_dispute($1,$2,$3,$4,$5)', [id, outcome, fare, reason, strike]));
  const REASON = 'Reviewed with both parties after the trip';
  const T1 = ID.T_AUTH, T2 = ID.T2_AUTH, L = ID.L_AUTH;

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('S1 who sees a dispute: the parties, the TODA Administrator of the driver, the LGU Administrator');
  let { b, dispute: d } = await disputed();
  let list = await s.todaCall('get_fare_disputes($1,$2)', [null, 100]);
  check('the driver\'s TODA Administrator sees it, with the names, the fare, the claim and the passenger\'s statement',
    list.length === 1 && list[0].dispute_id === d.dispute_id && list[0].passenger_name === 'Pax One' && list[0].driver_name === 'Driver One' && Number(list[0].claimed_amount) === 90
    && Number(list[0].system_fare) === 65 && list[0].payment_status === 'Payment Disputed' && list[0].notes.length === 1 && list[0].overdue === false && list[0].status === 'Open', list);
  const other = await s.todaCall('get_fare_disputes($1,$2)', [null, 100], T2);
  check('another TODA\'s administrator sees nothing of it', Array.isArray(other) && other.length === 0, other);
  const lgu = await s.lguCall('get_fare_disputes($1,$2)', ['Open', 100]);
  check('the LGU Administrator sees all of them (and can filter by status)', lgu.length === 1 && (await s.lguCall('get_fare_disputes($1,$2)', ['Resolved', 100])).length === 0);
  const asPax = await attempt(() => s.paxCall('P1', 'get_fare_disputes($1,$2)', [null, 100]));
  check('a passenger cannot use the administrators\' queue', !asPax.ok && /Access Denied/.test(asPax.error), asPax);
  const rows = (uid) => attempt(() => as(uid, (tx) => tx.query(`SELECT dispute_id FROM fare_dispute`)));
  const rP1 = await rows(ID.P_AUTH), rP2 = await rows(ID.P2_AUTH), rD1 = await rows(ID.D_AUTH), rD2 = await rows(ID.D2_AUTH), rT2 = await rows(T2);
  check('row security: the passenger and the driver of the trip read the dispute; another passenger, another driver and another TODA do not',
    rP1.ok && rP1.value.rows.length === 1 && rD1.ok && rD1.value.rows.length === 1 && rP2.ok && rP2.value.rows.length === 0 && rD2.ok && rD2.value.rows.length === 0 && rT2.ok && rT2.value.rows.length === 0, { rP1, rP2, rD1, rD2, rT2 });
  const wr = await s.writeAs(ID.P_AUTH, `UPDATE fare_dispute SET status = 'Resolved', outcome = 'FARE_WAIVED', resolved_fare = 0 WHERE dispute_id = $1`, [d.dispute_id]);
  const wr2 = await s.writeAs(ID.D_AUTH, `INSERT INTO fare_dispute_note (dispute_id, party, note) VALUES ($1, 'driver', 'x')`, [d.dispute_id]);
  const wr3 = await s.writeAs(T1, `DELETE FROM fare_dispute WHERE dispute_id = $1`, [d.dispute_id]);
  check('nobody writes the dispute tables directly (not the passenger, the driver or the TODA Administrator)', !wr.ok && !wr2.ok && !wr3.ok, { wr, wr2, wr3 });
  const anon = await attempt(() => s.anon((tx) => tx.query(`SELECT 1 FROM fare_dispute`)));
  check('anonymous visitors read nothing', !anon.ok && /permission denied/i.test(anon.error), anon);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS2 Rule 18.4: either party may add supporting information while the dispute is open');
  let r = await s.drvCall('D1', 'submit_fare_dispute_note($1,$2)', [d.dispute_id, 'The passenger asked me to carry two sacks; the extra 25 pesos was for that.']);
  check('the driver adds his side', r.success === true, r);
  r = await s.paxCall('P1', 'submit_fare_dispute_note($1,$2)', [d.dispute_id, 'I never asked for any sack to be carried.']);
  check('the passenger adds hers', r.success === true, r);
  r = await s.paxCall('P2', 'submit_fare_dispute_note($1,$2)', [d.dispute_id, 'I was not even there, but here is my opinion']);
  check('a stranger cannot', r.success === false && r.error_code === 'ERR_NOT_YOUR_DISPUTE', r);
  r = await s.paxCall('P1', 'submit_fare_dispute_note($1,$2)', [d.dispute_id, 'x']);
  check('an empty note is refused', r.success === false && r.error_code === 'ERR_NOTE_TEXT', r);
  list = await s.todaCall('get_fare_disputes($1,$2)', [null, 100]);
  check('the administrator reads the three statements in order (passenger, driver, passenger)', list[0].notes.length === 3 && list[0].notes.map((n) => n.party).join() === 'passenger,driver,passenger', list[0].notes);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS3 F9.5: 2 business days for the TODA Administrator, 3 for the LGU after an escalation - shown as overdue, never resolved by itself');
  await internal(`UPDATE fare_dispute SET due_at = clock_timestamp() - interval '1 hour' WHERE dispute_id = '${d.dispute_id}'`);
  list = await s.todaCall('get_fare_disputes($1,$2)', [null, 100]);
  check('past its due time the dispute is shown OVERDUE', list[0].overdue === true && list[0].status === 'Open', list[0]);
  await s.sweep(); await s.sweep();
  check('the sweeps never resolve or change it (nothing is automatic)', (await s.dispute(b.booking_id)).status === 'Open' && (await s.bk(b.booking_id)).payment_status === 'Payment Disputed');
  let esc = await attempt(() => s.todaCall('escalate_fare_dispute($1,$2)', [d.dispute_id, 'The driver says the sacks were extra and I cannot decide'], T2));
  check('another TODA\'s administrator cannot escalate it', !esc.ok && /Access Denied/.test(esc.error), esc);
  esc = await attempt(() => s.todaCall('escalate_fare_dispute($1,$2)', [d.dispute_id, 'short']));
  check('the escalation needs a written reason', !esc.ok && /ERR_ESCALATION_REASON/.test(esc.error), esc);
  esc = await attempt(() => s.lguCall('escalate_fare_dispute($1,$2)', [d.dispute_id, 'The LGU decides directly instead']));
  check('the LGU Administrator does not escalate (it resolves directly)', !esc.ok && /Access Denied/.test(esc.error), esc);
  esc = await attempt(() => s.todaCall('escalate_fare_dispute($1,$2)', [d.dispute_id, 'The driver says the sacks were extra and I cannot decide']));
  d = await s.dispute(b.booking_id);
  check('the TODA Administrator escalates: Escalated, the LGU queue, the LGU target starts (3 business days), a note and an audit row, both parties told',
    esc.ok && esc.value.status === 'Escalated' && d.status === 'Escalated' && d.assigned_role === 'lgu_admin' && d.escalation_reason !== null && new Date(d.due_at) > new Date(Date.now() + 24 * 3600 * 1000)
    && (await s.audit('FARE_DISPUTE_ESCALATED', d.dispute_id)).length === 1 && (await s.notices('FARE_DISPUTE_ESCALATED', d.dispute_id)).length === 2, { esc, d });
  esc = await attempt(() => s.todaCall('escalate_fare_dispute($1,$2)', [d.dispute_id, 'The driver says the sacks were extra and I cannot decide']));
  check('escalating twice is a no-op', esc.ok && esc.value.already === true, esc);
  let rs = await resolve(T1, d.dispute_id, 'FARE_CONFIRMED', null, REASON);
  check('after the escalation the TODA Administrator can no longer decide it (the LGU Administrator does)', !rs.ok && /Access Denied/.test(rs.error), rs);
  check('...but still sees it', (await s.todaCall('get_fare_disputes($1,$2)', ['Escalated', 100])).length === 1);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS4 T2: the decision - confirmed, reduced, waived, adjusted; the payment becomes Paid or Waived; the ledger and the audit trail; never above the system\'s fare');
  rs = await resolve(L, d.dispute_id, 'FARE_CONFIRMED', null, 'short');
  check('the decision needs a written reason', !rs.ok && /ERR_RESOLUTION_REASON/.test(rs.error), rs);
  rs = await resolve(L, d.dispute_id, 'NON_PAYMENT_UPHELD', null, REASON);
  check('an outcome of another kind of dispute is refused', !rs.ok && /ERR_RESOLUTION_OUTCOME/.test(rs.error), rs);
  rs = await resolve(L, d.dispute_id, 'FARE_REDUCED', 70, REASON);
  check('a "reduction" above the system\'s fare is refused (Rule 18.1: nobody raises the fare)', !rs.ok && /ERR_RESOLUTION_FARE/.test(rs.error), rs);
  rs = await resolve(L, d.dispute_id, 'FARE_ADJUSTED', 70, REASON);
  check('an "adjustment" above the system\'s fare is refused too (the other outcome that carries a figure: found by mutation, a ceiling that only FARE_REDUCED checked)', !rs.ok && /ERR_RESOLUTION_FARE/.test(rs.error), rs);
  rs = await resolve(L, d.dispute_id, 'FARE_ADJUSTED', -5, REASON);
  check('...and a negative figure', !rs.ok && /ERR_RESOLUTION_FARE/.test(rs.error), rs);
  rs = await resolve(L, d.dispute_id, 'FARE_REDUCED', 65, REASON);
  check('...and so is one that is not lower', !rs.ok && /ERR_RESOLUTION_FARE/.test(rs.error), rs);
  rs = await resolve(L, d.dispute_id, 'FARE_REDUCED', null, REASON);
  check('...and one with no figure', !rs.ok && /ERR_RESOLUTION_FARE/.test(rs.error), rs);
  check('nothing changed by the refused decisions', (await s.dispute(b.booking_id)).status === 'Escalated' && (await s.bk(b.booking_id)).payment_status === 'Payment Disputed' && (await s.ledger(b.booking_id)).length === 0);
  rs = await resolve(L, d.dispute_id, 'FARE_CONFIRMED', null, REASON);
  let bk = await s.bk(b.booking_id);
  d = await s.dispute(b.booking_id);
  check('FARE_CONFIRMED by the LGU Administrator: the fare stands (PHP 65), the payment is Paid, the dispute Resolved with the decision and the reviewer',
    rs.ok && rs.value.success && Number(bk.actual_fare) === 65 && bk.payment_status === 'Paid' && bk.booking_status === 'Completed'
    && d.status === 'Resolved' && d.outcome === 'FARE_CONFIRMED' && Number(d.resolved_fare) === 65 && d.resolved_by_role === 'lgu_admin' && d.resolved_at !== null, { rs, bk, d });
  check('no ledger row (the fare did not change); the audit has the decision with before and after; both parties are told; the breakdown carries the resolution',
    (await s.ledger(b.booking_id)).length === 0 && (await s.audit('FARE_DISPUTE_RESOLVED', d.dispute_id)).length === 1 && (await s.notices('FARE_DISPUTE_RESOLVED', d.dispute_id)).length === 2
    && bk.fare_breakdown.resolution.outcome === 'FARE_CONFIRMED' && bk.fare_breakdown.resolution.source === 'fare_dispute');
  const aud = (await s.audit('FARE_DISPUTE_RESOLVED', d.dispute_id))[0];
  check('the audit row names the actor and holds the before and after states', aud.actor_role === 'lgu_admin' && aud.before_state.payment_status === 'Payment Disputed' && aud.after_state.payment_status === 'Paid' && aud.after_state.outcome === 'FARE_CONFIRMED', aud);
  rs = await resolve(L, d.dispute_id, 'FARE_WAIVED', null, REASON);
  check('deciding a resolved dispute again is a no-op (the first decision stands)', rs.ok && rs.value.already_resolved === true && (await s.bk(b.booking_id)).payment_status === 'Paid');
  await s.clearStrikes(); await s.reset();

  // reduced by the TODA Administrator (the first stop)
  ({ b, dispute: d } = await disputed());
  rs = await resolve(T2, d.dispute_id, 'FARE_REDUCED', 50, REASON);
  check('another TODA\'s administrator cannot decide it', !rs.ok && /Access Denied/.test(rs.error), rs);
  rs = await resolve(T1, d.dispute_id, 'FARE_REDUCED', 50, REASON);
  bk = await s.bk(b.booking_id);
  let lg = await s.ledger(b.booking_id);
  check('FARE_REDUCED to PHP 50 by the TODA Administrator: the fare is 50, Paid, ONE ledger row DISPUTE_RESOLUTION 65 -> 50 by the TODA administrator',
    rs.ok && Number(bk.actual_fare) === 50 && bk.payment_status === 'Paid' && lg.length === 1 && lg[0].reason_code === 'DISPUTE_RESOLUTION' && Number(lg[0].previous_fare) === 65 && Number(lg[0].new_fare) === 50
    && (await q(`SELECT actor_role FROM fare_adjustment_history WHERE booking_id = '${b.booking_id}'`))[0].actor_role === 'toda_admin', { rs, bk, lg });
  check('the trip history now reads the corrected fare and the completed trip is otherwise untouched', Number(bk.estimated_fare) === 65 && bk.booking_status === 'Completed' && bk.fare_breakdown.resolution.final_fare === 50);
  await s.reset();

  ({ b, dispute: d } = await disputed());
  rs = await resolve(T1, d.dispute_id, 'FARE_WAIVED', null, REASON);
  bk = await s.bk(b.booking_id);
  check('FARE_WAIVED: the fare is 0 and the payment Waived; the ledger row 65 -> 0', rs.ok && Number(bk.actual_fare) === 0 && bk.payment_status === 'Waived' && (await s.ledger(b.booking_id)).length === 1 && Number((await s.ledger(b.booking_id))[0].new_fare) === 0, { rs, bk });
  await s.reset();

  ({ b, dispute: d } = await disputed());
  rs = await resolve(T1, d.dispute_id, 'FARE_ADJUSTED', 40, REASON);
  bk = await s.bk(b.booking_id);
  check('FARE_ADJUSTED to PHP 40: the fare is 40, Paid', rs.ok && Number(bk.actual_fare) === 40 && bk.payment_status === 'Paid', { rs, bk });
  await s.reset();

  // a dispute on a trip the driver has not finished: closed first
  ({ b, dispute: d } = await disputed({ finish: false }));
  rs = await resolve(T1, d.dispute_id, 'FARE_CONFIRMED', null, REASON);
  check('a dispute cannot be decided while the driver has not finished the trip (close it first)', !rs.ok && /ERR_TRIP_NOT_FINISHED/.test(rs.error), rs);
  await s.reset();

  // a Safety Concern review: the payment is not disputed; waived by the LGU
  b = await s.startTrip('D1', 'P1');
  await s.track(b.booking_id, 'D1', 21); await s.driverAt('D1', 1000, 10);
  await s.paxCall('P1', 'passenger_request_early_end($1,$2,$3)', [b.booking_id, 'safety_concern', 'The driver was racing']);
  await s.driverSets('D1', b.booking_id, 'Arrived at Destination');
  await s.paxCall('P1', 'passenger_confirm_fare($1)', [b.booking_id]);
  await s.drvCall('D1', 'driver_confirm_payment_received($1)', [b.booking_id]);
  await s.paxCall('P1', 'request_safety_fare_review($1,$2)', [b.booking_id, 'I did not feel safe, please review the fare']);
  d = await s.dispute(b.booking_id);
  check('13.5: a Safety Concern trip, Paid at the provisional PHP 60, has an open review (the payment is not disputed)', d.kind === 'SAFETY_REVIEW' && (await s.bk(b.booking_id)).payment_status === 'Paid' && Number((await s.bk(b.booking_id)).actual_fare) === 60);
  rs = await resolve(L, d.dispute_id, 'FARE_WAIVED', null, 'The driver was reported for racing: no fare');
  bk = await s.bk(b.booking_id);
  check('the LGU Administrator WAIVES the provisional fare: the fare 0, the payment Waived, the ledger 60 -> 0', rs.ok && Number(bk.actual_fare) === 0 && bk.payment_status === 'Waived'
    && (await s.ledger(b.booking_id)).some((x) => x.reason_code === 'DISPUTE_RESOLUTION' && Number(x.previous_fare) === 60 && Number(x.new_fare) === 0), { rs, bk });
  await s.reset();

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS5 Rules 18.4 / 18.5: the strikes are the administrator\'s to confirm, issued as that administrator, only for the right dispute');
  ({ b, dispute: d } = await disputed());
  rs = await resolve(T1, d.dispute_id, 'FARE_CONFIRMED', null, REASON, 'PAX_UNFOUNDED_DISPUTE');
  check('the TODA Administrator cannot strike a passenger: refused BEFORE anything is written (escalate to the LGU Administrator)', !rs.ok && /ERR_LGU_ONLY_STRIKE/.test(rs.error) && (await s.dispute(b.booking_id)).status === 'Open' && (await s.ledgerStrikes(ID.P1)).length === 0, rs);
  rs = await resolve(T1, d.dispute_id, 'FARE_CONFIRMED', null, REASON, 'PAX_REFUSAL_TO_PAY');
  check('a strike for another kind of dispute is refused', !rs.ok && /ERR_STRIKE_NOT_FOR_THIS_DISPUTE/.test(rs.error), rs);
  rs = await resolve(L, d.dispute_id, 'FARE_REDUCED', 50, REASON, 'PAX_UNFOUNDED_DISPUTE');
  check('a dispute that changed the fare is not an unfounded dispute', !rs.ok && /ERR_STRIKE_NOT_FOR_THIS_DISPUTE/.test(rs.error), rs);
  rs = await resolve(T1, d.dispute_id, 'FARE_CONFIRMED', null, REASON, 'DRV_OVERCHARGING');
  let ds = await s.ledgerStrikes(ID.D1);
  check('Rule 18.5: the TODA Administrator confirms the driver\'s Overcharging Attempt: ONE DRV_OVERCHARGING (2 points), issued by the TODA administrator; the passenger unharmed',
    rs.ok && ds.length === 1 && ds[0].violation_code === 'DRV_OVERCHARGING' && ds[0].points_active === 2 && ds[0].issued_by_role === 'toda_admin' && (await s.ledgerStrikes(ID.P1)).length === 0 && (await s.bk(b.booking_id)).payment_status === 'Paid', { rs, ds });
  await s.clearStrikes(); await s.reset();

  ({ b, dispute: d } = await disputed());
  rs = await resolve(L, d.dispute_id, 'FARE_CONFIRMED', null, 'Nothing was wrong: the fare shown was right, the claim was made in bad faith', 'PAX_UNFOUNDED_DISPUTE');
  const ps = await s.ledgerStrikes(ID.P1);
  check('Rule 18.4: the LGU Administrator confirms a bad-faith dispute: ONE PAX_UNFOUNDED_DISPUTE (1 point), issued by the LGU administrator', rs.ok && ps.length === 1 && ps[0].violation_code === 'PAX_UNFOUNDED_DISPUTE' && ps[0].points_active === 1 && ps[0].issued_by_role === 'lgu_admin', { rs, ps });
  await s.clearStrikes(); await s.reset();

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS6 Rule 18.6: "the passenger did not pay" - reported by the driver, decided by the administrators; the Passenger Payment Refusal is the LGU Administrator\'s to confirm');
  b = await s.atDestination('D1', 'P1');
  r = await s.drvCall('D1', 'driver_report_non_payment($1,$2)', [b.booking_id, 'The passenger got off and walked away']);
  check('before the passenger has answered (and before the time is up) the driver must wait', r.success === false && r.error_code === 'ERR_WAIT_FOR_PASSENGER', r);
  await s.paxCall('P1', 'passenger_confirm_fare($1)', [b.booking_id]);
  r = await s.drvCall('D1', 'driver_report_non_payment($1,$2)', [b.booking_id, 'short']);
  check('the report needs 10 characters of explanation', r.success === false && r.error_code === 'ERR_NON_PAYMENT_NOTE', r);
  r = await s.drvCall('D2', 'driver_report_non_payment($1,$2)', [b.booking_id, 'The passenger got off and walked away']);
  check('another driver cannot report it', r.success === false && r.error_code === 'ERR_NOT_YOUR_BOOKING', r);
  r = await s.drvCall('D1', 'driver_report_non_payment($1,$2)', [b.booking_id, 'The passenger got off and walked away']);
  bk = await s.bk(b.booking_id);
  d = await s.dispute(b.booking_id);
  check('after Confirm Fare the driver reports it: the trip is closed (the driver is free), the payment is Payment Disputed (no payment was received), a NON_PAYMENT dispute is opened for the TODA Administrator',
    r.success && bk.booking_status === 'Completed' && bk.payment_status === 'Payment Disputed' && bk.payment_received_at === null && d.kind === 'NON_PAYMENT' && d.opened_by === 'driver' && d.assigned_role === 'toda_admin'
    && (await one(`SELECT public.driver_has_open_accepted_booking('${ID.D1}') AS o`)).o === false, { r, bk, d });
  check('the passenger is told and may add her side', (await s.notices('NON_PAYMENT_REPORTED', b.booking_id)).length === 1 && (await s.paxCall('P1', 'submit_fare_dispute_note($1,$2)', [d.dispute_id, 'I paid the driver in cash at the gate.'])).success === true);
  rs = await resolve(T1, d.dispute_id, 'FARE_CONFIRMED', null, REASON);
  check('a fare outcome is refused for a non-payment dispute', !rs.ok && /ERR_RESOLUTION_OUTCOME/.test(rs.error), rs);
  rs = await resolve(T1, d.dispute_id, 'NON_PAYMENT_UPHELD', null, REASON, 'PAX_REFUSAL_TO_PAY');
  check('the TODA Administrator cannot confirm the Passenger Payment Refusal', !rs.ok && /ERR_LGU_ONLY_STRIKE/.test(rs.error) && (await s.dispute(b.booking_id)).status === 'Open', rs);
  rs = await resolve(L, d.dispute_id, 'NON_PAYMENT_UPHELD', null, 'The passenger admitted she did not pay the confirmed fare', 'PAX_REFUSAL_TO_PAY');
  const pr = await s.ledgerStrikes(ID.P1);
  bk = await s.bk(b.booking_id);
  check('upheld by the LGU Administrator: ONE PAX_REFUSAL_TO_PAY (2 points) and the payment recorded as Unpaid', rs.ok && pr.length === 1 && pr[0].violation_code === 'PAX_REFUSAL_TO_PAY' && pr[0].points_active === 2 && bk.payment_status === 'Unpaid', { rs, pr, bk });
  await s.clearStrikes(); await s.reset();

  b = await s.atDestination('D1', 'P1');
  await s.lockedAgo(b.booking_id, 125);
  r = await s.drvCall('D1', 'driver_report_non_payment($1,$2)', [b.booking_id, 'The passenger never answered and did not pay']);
  d = await s.dispute(b.booking_id);
  check('when the confirmation time ran out unanswered the driver can report it too', r.success && d && d.kind === 'NON_PAYMENT', r);
  rs = await resolve(T1, d.dispute_id, 'NON_PAYMENT_REJECTED', null, 'The passenger showed that she paid in cash');
  bk = await s.bk(b.booking_id);
  check('rejected (she did pay): the payment is Paid (determined by the administrator), no strike for anybody', rs.ok && bk.payment_status === 'Paid' && bk.payment_received_at !== null && bk.fare_unconfirmed === true && (await s.ledgerStrikes(ID.P1)).length === 0, { rs, bk });
  await s.reset();

  b = await s.atDestination('D1', 'P1');
  await s.paxCall('P1', 'passenger_report_fare_discrepancy($1,$2,$3)', [b.booking_id, 90, BIG]);
  r = await s.drvCall('D1', 'driver_report_non_payment($1,$2)', [b.booking_id, 'The passenger reported the fare instead of paying']);
  check('a documented discrepancy is not a refusal: the fare is in review', r.success === false && r.error_code === 'ERR_DISPUTE_OPEN', r);
  await s.reset();

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS7 Rule 16.3: the audited administrator correction of a completed trip');
  b = await s.atDestination('D1', 'P1');
  await s.paxCall('P1', 'passenger_confirm_fare($1)', [b.booking_id]);
  await s.drvCall('D1', 'driver_confirm_payment_received($1)', [b.booking_id]);
  let cr = await attempt(() => s.todaCall('admin_correct_completed_trip($1,$2,$3,$4)', [b.booking_id, 55, null, REASON]));
  check('a TODA Administrator cannot use the correction (the LGU Administrator only)', !cr.ok && /Access Denied/.test(cr.error), cr);
  cr = await attempt(() => s.paxCall('P1', 'admin_correct_completed_trip($1,$2,$3,$4)', [b.booking_id, 55, null, REASON]));
  check('nor a passenger', !cr.ok && /Access Denied/.test(cr.error), cr);
  cr = await attempt(() => s.lguCall('admin_correct_completed_trip($1,$2,$3,$4)', [b.booking_id, 55, null, 'short']));
  check('the reason is mandatory', !cr.ok && /ERR_CORRECTION_REASON/.test(cr.error), cr);
  cr = await attempt(() => s.lguCall('admin_correct_completed_trip($1,$2,$3,$4)', [b.booking_id, 70, null, REASON]));
  check('a fare above the system\'s is refused', !cr.ok && /ERR_CORRECTION_FARE/.test(cr.error), cr);
  cr = await attempt(() => s.lguCall('admin_correct_completed_trip($1,$2,$3,$4)', [b.booking_id, null, null, REASON]));
  check('a correction that changes nothing is refused', !cr.ok && /ERR_CORRECTION_EMPTY/.test(cr.error), cr);
  cr = await attempt(() => s.lguCall('admin_correct_completed_trip($1,$2,$3,$4)', [b.booking_id, null, 'Maybe', REASON]));
  check('an unknown payment status is refused', !cr.ok && /ERR_CORRECTION_PAYMENT/.test(cr.error), cr);
  cr = await attempt(() => s.lguCall('admin_correct_completed_trip($1,$2,$3,$4)', [b.booking_id, 55, null, 'The meter of the fare was wrong: agreed with both parties']));
  bk = await s.bk(b.booking_id);
  lg = await s.ledger(b.booking_id);
  check('the LGU Administrator corrects the fare to PHP 55: the fare changes, ONE ledger row ADMIN_CORRECTION 65 -> 55, the audit has the before and after, both parties are told',
    cr.ok && Number(bk.actual_fare) === 55 && lg.length === 1 && lg[0].reason_code === 'ADMIN_CORRECTION' && Number(lg[0].previous_fare) === 65 && Number(lg[0].new_fare) === 55
    && (await s.audit('COMPLETED_TRIP_CORRECTED', b.booking_id)).length === 1 && (await s.audit('COMPLETED_TRIP_CORRECTED', b.booking_id))[0].before_state.actual_fare == 65 && (await s.notices('TRIP_CORRECTED', b.booking_id)).length === 2, { cr, bk, lg });
  check('the route, the times and the people are untouched', Number(bk.estimated_fare) === 65 && bk.booking_status === 'Completed' && bk.passenger_id === ID.P1 && bk.driver_id === ID.D1 && bk.dropoff_latitude === s.DROPOFF.lat);
  await s.reset();
  const notDone = await s.atDestination('D1', 'P1');
  cr = await attempt(() => s.lguCall('admin_correct_completed_trip($1,$2,$3,$4)', [notDone.booking_id, 55, null, REASON]));
  check('only a completed trip is corrected here', !cr.ok && /ERR_NOT_COMPLETED/.test(cr.error), cr);
  await s.reset();

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
