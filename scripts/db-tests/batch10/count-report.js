// Batch 10 / Rules 14.7, 29.17 and T6: the driver finds more passengers than were declared and reports it BEFORE the trip is finished.
//   S1  T6  an under-declared passenger of a matched trip: the report is recorded, the fare is recomputed with the real head-count, the strike path is open
//   S2  the severity the report recommends (decision N8) and the administrator's confirmation (the only way to a strike)
//   S3  who may report, and when
//   S4  a Solo booking: the head-count never changes a Solo fare (it is the whole tricycle), the report is still recorded and flagged
//   S5  an overloaded tricycle: the fare lock never fails; the matched estimate stands and the case is flagged
const { setup, ID, DRIVERS, check, summary } = require('../b10fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, at } = s;
  const finalOf = (b) => b.fare_breakdown && b.fare_breakdown.final;
  const pair = async ({ countA = 1, countB = 1 } = {}) => {
    const A0 = await s.host({ stage: 'ongoing', count: countA, o: { dropoff: at(3000) } });
    await s.startedAt(A0.booking_id, s.trackTime(0));
    await s.online('D2', 400);
    const p = await s.propose({ count: countB, pickupNorth: 100, dropNorth: 3000 });
    if (!p.m) throw new Error('pair: no proposal');
    await s.agree(p.m);
    for (const st of ['In Transit', 'Driver Arrived', 'Trip Ongoing']) { const r = await s.driverSets('D1', p.b.booking_id, st); if (!r.ok) throw new Error(st + ': ' + r.error); }
    await s.startedAt(p.b.booking_id, s.trackTime(1));
    await s.track([A0.booking_id], 'D1', 0, 0);
    await s.track([A0.booking_id, p.b.booking_id], 'D1', 1, 30);
    return { A: await s.bk(A0.booking_id), B: await s.bk(p.b.booking_id), m: p.m };
  };
  const finish = async (t) => { await s.driverEnds('D1', t.A.booking_id); await s.driverEnds('D1', t.B.booking_id); return { a: await s.bk(t.A.booking_id), b: await s.bk(t.B.booking_id) }; };

  console.log('S1 T6: the driver reports that the second booking carries 2 passengers, not the 1 declared');
  let t = await pair();
  const withDeclared = await (async () => {                                   // what B would pay with the declared head-count (the same legs)
    const legs = [{ booking_id: t.A.booking_id, passenger_count: 1, board_km: 0, alight_km: 3.0 }, { booking_id: t.B.booking_id, passenger_count: 1, board_km: 0.1, alight_km: 3.0 }];
    return (await s.allocate(legs)).bookings;
  })();
  let r = await s.report('D1', t.B.booking_id, 2, 'Two adults boarded');
  check('the report is accepted and says what changed', r.success === true && r.declared_count === 1 && r.actual_count === 2 && r.over_capacity === false, r);
  const rep = await q(`SELECT * FROM passenger_count_report WHERE booking_id = '${t.B.booking_id}'`);
  check('it is recorded: who, the declared and the real count, the note, the phase', rep.length === 1 && rep[0].driver_id === ID.D1 && rep[0].declared_count === 1 && rep[0].actual_count === 2 && rep[0].note === 'Two adults boarded' && rep[0].phase === 'ongoing', rep);
  const led = await s.ledger(t.B.booking_id);
  check('the fare ledger has the recomputation (DECLARED_PASSENGER_MISMATCH): the estimate with 1 passenger and with 2', led.length === 1 && led[0].reason_code === 'DECLARED_PASSENGER_MISMATCH' && Number(led[0].new_fare) > Number(led[0].previous_fare) && led[0].details.actual_count === 2 && led[0].details.excess === 1, led);
  check('the declared count on the booking is untouched (it is locked); the report is the correction', (await s.bk(t.B.booking_id)).passenger_count === 1);
  check('the passenger concerned is told (English and Filipino)', (await q(`SELECT message FROM notification WHERE recipient_id = '${ID.P2}' AND notification_type = 'PASSENGER_COUNT_CORRECTED'`)).length === 1);
  check('the other passenger is told that the head-count of the other party changed', (await q(`SELECT 1 FROM notification WHERE recipient_id = '${ID.P1}' AND notification_type = 'PASSENGER_COUNT_CORRECTED'`)).length === 1);
  const flags = await s.flags('PASSENGER_COUNT_UNDER_DECLARED', ID.P2);
  check('the LGU Administrator has a review flag (passenger strikes are the LGU\'s), with the recommended severity: one strike for one extra passenger on a first occurrence',
    flags.length === 1 && flags[0].assigned_role === 'lgu_admin' && flags[0].details.recommended_points === 1 && flags[0].details.excess === 1 && flags[0].details.booking_id === t.B.booking_id, flags);
  check('NO strike exists yet: the strike path is open, nothing is sanctioned until the administrator confirms', (await s.strikesOf(ID.P2)).length === 0 && (await s.strikesOf(ID.P1)).length === 0);
  const { a, b } = await finish(t);
  const lb = finalOf(b).shared_leg;
  check('the fare of the matched trip uses the REAL head-count (2 on the second booking, 1 on the first)', lb.passenger_count === 2 && lb.other_passenger_count === 1, lb);
  check('...so the second booking pays MORE than it would have with one passenger, and the first pays LESS than it would have (the proportional split by head-count)',
    Number(b.actual_fare) > withDeclared[1].fare && Number(a.actual_fare) < withDeclared[0].fare, { b: b.actual_fare, bDeclared: withDeclared[1].fare, a: a.actual_fare, aDeclared: withDeclared[0].fare });
  check('...and neither above its own Solo fare', Number(a.actual_fare) <= Number((await s.fare(Number(a.estimated_distance_km), 'Solo', 1)).solo_fare) && Number(b.actual_fare) <= Number((await s.fare(Number(b.estimated_distance_km), 'Solo', 1)).solo_fare));
  check('the report is audited', (await q(`SELECT 1 FROM audit_log WHERE action_type = 'PASSENGER_COUNT_REPORTED' AND target_id = '${t.B.booking_id}'`)).length === 1);
  await s.reset();

  console.log('\nS2 the severity the report recommends (N8) and the strike only after confirmation');
  const conf = (flagId, reason = 'Two adults rode on a booking declared for one passenger.') => s.lguCall('admin_confirm_flagged_violation($1, NULL, $2, NULL)', [flagId, reason]);
  await internal(`DELETE FROM admin_review_flag; DELETE FROM passenger_count_report`);
  t = await pair();
  await s.report('D1', t.B.booking_id, 2);
  let f1 = (await s.flags('PASSENGER_COUNT_UNDER_DECLARED', ID.P2))[0];
  let c = await s.attempt(() => s.todaCall('admin_confirm_flagged_violation($1, NULL, $2, NULL)', [f1.flag_id, 'The TODA tries to confirm a passenger strike.']));
  check('a TODA Administrator cannot confirm a passenger strike (Access Denied: only the LGU Administrator)', !c.ok && /Access Denied/.test(c.error) && /LGU Administrator/.test(c.error), c);
  c = await s.attempt(() => conf(f1.flag_id, 'too short'));
  check('confirming needs a written reason', !c.ok && /ERR_CONFIRM_REASON/.test(c.error), c);
  c = await s.attempt(() => conf(f1.flag_id));
  const sk = await s.strikesOf(ID.P2);
  check('the LGU Administrator confirms: ONE strike, PAX_UNDER_DECLARED_COUNT (the existing catalog code), the points the report recommended', c.ok && c.value.success === true && sk.length === 1 && sk[0].violation_code === 'PAX_UNDER_DECLARED_COUNT' && sk[0].points_active === 1, { c, sk });
  check('the flag is resolved and the confirmation is audited', (await s.flags('PASSENGER_COUNT_UNDER_DECLARED', ID.P2)).length === 0);
  c = await s.attempt(() => conf(f1.flag_id));
  check('a second confirmation of the same flag is refused (one strike per flag)', !c.ok && /ERR_FLAG_NOT_OPEN/.test(c.error) && (await s.strikesOf(ID.P2)).length === 1, c);
  await s.reset();
  // a REPEAT within 90 days is 2 points, and so is an excess of two
  t = await pair();
  await s.report('D1', t.B.booking_id, 2);
  const f2 = (await s.flags('PASSENGER_COUNT_UNDER_DECLARED', ID.P2))[0];
  check('a second under-declaration within 90 days: recommended severity 2 (a repeat)', f2.details.repeat_in_90_days === 1 && f2.details.recommended_points === 2, f2.details);
  c = await s.attempt(() => conf(f2.flag_id));
  check('...and the confirmed strike carries the 2 points', c.ok && (await s.strikesOf(ID.P2)).map((x) => x.points_active).sort().join() === '1,2' || (await s.strikesOf(ID.P2)).length === 2, await s.strikesOf(ID.P2));
  await s.reset(); await s.clearStrikes();
  await internal(`DELETE FROM admin_review_flag; DELETE FROM passenger_count_report`);
  t = await pair();
  await s.report('D1', t.B.booking_id, 3);
  check('an excess of TWO passengers: recommended severity 2', (await s.flags('PASSENGER_COUNT_UNDER_DECLARED', ID.P2))[0].details.recommended_points === 2);
  await s.reset();
  await internal(`DELETE FROM admin_review_flag; DELETE FROM passenger_count_report`);
  t = await pair({ countA: 2, countB: 1 });
  r = await s.report('D1', t.B.booking_id, 3);
  check('an excess that overloads the tricycle (2 + 3 = 5 on board): recommended severity 2, and the report says so', r.over_capacity === true && (await s.flags('PASSENGER_COUNT_UNDER_DECLARED', ID.P2))[0].details.recommended_points === 2, r);
  await s.reset();
  await internal(`DELETE FROM admin_review_flag; DELETE FROM passenger_count_report`);

  console.log('\nS3 who may report, and when');
  t = await pair();
  r = await s.rpc(ID.P2_AUTH, 'driver_report_passenger_count($1, $2, $3)', [t.B.booking_id, 2, null]);
  check('a passenger cannot report a count (ERR_NOT_A_DRIVER)', r.success === false && r.error_code === 'ERR_NOT_A_DRIVER', r);
  r = await s.report('D2', t.B.booking_id, 2);
  check('another driver cannot (ERR_NOT_YOUR_BOOKING)', r.success === false && r.error_code === 'ERR_NOT_YOUR_BOOKING', r);
  r = await s.report('D1', t.B.booking_id, 1);
  check('the same count as declared is not a mismatch (ERR_NO_MISMATCH)', r.success === false && r.error_code === 'ERR_NO_MISMATCH', r);
  r = await s.report('D1', t.B.booking_id, 0);
  check('0 passengers is not a count (ERR_INVALID_COUNT)', r.success === false && r.error_code === 'ERR_INVALID_COUNT', r);
  r = await s.report('D1', t.B.booking_id, 11);
  check('11 passengers is not a count either', r.success === false && r.error_code === 'ERR_INVALID_COUNT', r);
  r = await s.report('D1', t.B.booking_id, 2);
  check('(a valid report)', r.success === true, r);
  r = await s.report('D1', t.B.booking_id, 2);
  check('reporting the count already on record is refused: one record per correction', r.success === false && r.error_code === 'ERR_NO_MISMATCH', r);
  r = await s.report('D1', t.B.booking_id, 1);
  check('the driver may correct himself: back to the declared count is a change of the record (and an over-declaration needs no flag)', r.success === true && (await s.flags('PASSENGER_COUNT_UNDER_DECLARED', ID.P2)).length === 1);
  const w = await s.attempt(() => s.as(ID.D_AUTH, (tx) => tx.query(`INSERT INTO passenger_count_report (booking_id, driver_id, declared_count, actual_count) VALUES ('${t.B.booking_id}', '${ID.D1}', 1, 3)`)));
  check('nobody writes the report table from a browser', !w.ok, w);
  await finish(t);
  r = await s.report('D1', t.B.booking_id, 2);
  check('after the trip has arrived the fare is locked: a count can no longer be reported (a fare problem goes through the dispute instead)', r.success === false && r.error_code === 'ERR_TOO_LATE', r);
  await s.reset(); await s.clearStrikes();
  await internal(`DELETE FROM admin_review_flag; DELETE FROM passenger_count_report`);

  console.log('\nS4 a SOLO booking: the head-count never changes a Solo fare, the report is recorded and flagged');
  const solo = await s.startTrip('D1', 'P1', { pax: 1 });
  await s.track([solo.booking_id], 'D1', 0, 33);
  r = await s.report('D1', solo.booking_id, 3);
  const ls = await s.ledger(solo.booking_id);
  check('the report is accepted; the ledger shows the Solo estimate UNCHANGED (the whole tricycle is the fare)', r.success === true && ls.length === 1 && Number(ls[0].previous_fare) === Number(ls[0].new_fare), { r, ls });
  check('the passenger is flagged for the LGU Administrator (2 extra passengers: severity 2)', (await s.flags('PASSENGER_COUNT_UNDER_DECLARED', ID.P1))[0]?.details.recommended_points === 2);
  await s.driverEnds('D1', solo.booking_id);
  const sb = await s.bk(solo.booking_id);
  check('the Solo trip ends at the Solo fare, whatever the head-count', finalOf(sb).basis === 'solo' && Number(sb.actual_fare) === Number((await s.fare(Number(sb.estimated_distance_km), 'Solo', 1)).solo_fare), finalOf(sb) && finalOf(sb).basis);
  await s.reset(); await s.clearStrikes();
  await internal(`DELETE FROM admin_review_flag; DELETE FROM passenger_count_report`);

  console.log('\nS5 an overloaded tricycle: the fare lock never fails');
  t = await pair({ countA: 2, countB: 1 });
  r = await s.report('D1', t.B.booking_id, 3);
  check('(2 + 3 on board)', r.success === true && r.over_capacity === true, r);
  const done = await s.attempt(() => finish(t));
  check('both trips can still end: the allocation cannot carry 5 passengers, so the matched estimate stands (never more than the passengers accepted) and the case stays flagged',
    done.ok && finalOf(done.value.b).basis === 'matched_estimate_pending_segments' && (await s.flags('PASSENGER_COUNT_UNDER_DECLARED', ID.P2)).length === 1, done.ok ? finalOf(done.value.b).basis : done.error);
  await s.reset();

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
