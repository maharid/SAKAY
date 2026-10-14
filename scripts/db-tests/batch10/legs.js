// Batch 10 / Rules 14.6, 12.5 and T5: the cancellation, no-show and driver rules apply to each leg of a Shared Trip independently; the remaining leg converts to Solo
// (Maximum Unmatched Fare, no new confirmation) and the engine looks for a replacement until the cutoff.
//   S1  a party cancels while the proposal is still out (nobody is struck, nothing else changes)
//   S2  T5  the second passenger cancels after the match, before the pickup: only that party is evaluated, the first continues Solo
//   S3  the FIRST passenger cancels after the match: the second keeps the driver and continues Solo
//   S4  the driver cancels one leg: the pairing ends, the other leg is untouched
//   S5  a no-show of one leg ends that leg only
//   S6  a replacement is looked for until the cutoff (Rule 6.5), never after it
//   S7  the second leg is not "stalled" while the vehicle serves the first (Rules 8.2 - 8.4)
const { setup, ID, check, summary } = require('../b10fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, at } = s;
  const solo = async () => Number((await s.fare(3.3, 'Solo', 1)).solo_fare);
  const acceptedAgo = (bookingId, sec) => internal(`UPDATE booking SET accepted_at = clock_timestamp() - interval '${sec} seconds' WHERE booking_id = '${bookingId}'`);
  const matched = async (hostOpts = {}) => {
    const A = await s.host(hostOpts);
    const { b: B, m } = await s.propose();
    const M = await s.agree(m);
    return { A: await s.bk(A.booking_id), B: await s.bk(B.booking_id), M };
  };
  const cancel = (pax, bookingId) => s.cancelAs(s.ALL_PAX[pax].uid, bookingId);

  console.log('S1 a party cancels while the proposal is still out: it ends, nobody is struck, the other side is not disturbed');
  let A = await s.host();
  await s.online('D2', 400);
  let { b: B, m: M } = await s.propose();
  await cancel('P2', B.booking_id);
  let m1 = await s.match(M.match_id);
  check('the second passenger cancels while the DRIVER is being asked: the proposal ends (Cancelled / party_cancelled)', m1.match_status === 'Cancelled' && m1.closed_reason === 'party_cancelled', m1);
  check('...the driver no longer has a request, the first passenger heard nothing, nobody is struck', (await s.myRequest('D1')) === null && (await q(`SELECT 1 FROM notification WHERE recipient_id = '${ID.P1}' AND notification_type LIKE 'SHARED%'`)).length === 0
    && (await s.strikesOf(ID.P2)).length === 0 && (await s.strikesOf(ID.P1)).length === 0 && (await s.strikesOf(ID.D1)).length === 0);
  check('...and the first booking is untouched', (await s.bk(A.booking_id)).booking_status === 'Accepted' && (await s.bk(A.booking_id)).driver_id === ID.D1);
  ({ b: B, m: M } = await s.propose());
  await s.driverAnswer('D1', M.match_id, true);
  await cancel('P2', B.booking_id);
  m1 = await s.match(M.match_id);
  check('the second passenger cancels while the FIRST PASSENGER is being asked: the proposal ends, the consent screen goes away', m1.match_status === 'Cancelled' && (await s.state('P1', A.booking_id)).state === 'closed');
  ({ b: B, m: M } = await s.propose());
  await s.driverAnswer('D1', M.match_id, true);
  await cancel('P1', A.booking_id);
  m1 = await s.match(M.match_id);
  check('the FIRST passenger cancels while he is being asked: the proposal ends and the second booking goes back to the standard search', m1.match_status === 'Cancelled'
    && ['Pending', 'Searching Driver'].includes((await s.bk(B.booking_id)).booking_status) && (await s.bk(B.booking_id)).driver_id === null && !!(await s.pendingOffer(B.booking_id)));
  await s.reset();

  console.log('\nS2 T5 (Rule 12.5): the second passenger cancels after the match, before the pickup');
  await s.clearStrikes();
  let mm = await matched();
  await s.online('D2', 400);
  await cancel('P2', mm.B.booking_id);                                      // inside the first minute of the assignment
  m1 = await s.match(mm.M.match_id);
  check('only the cancelling party is evaluated (Rule 12.1: inside the grace minute, no strike); the other party is not struck', (await s.strikesOf(ID.P2)).length === 0 && (await s.strikesOf(ID.P1)).length === 0);
  check('the pairing is closed (Cancelled) and audited', m1.match_status === 'Cancelled' && m1.closed_reason === 'party_cancelled' && (await q(`SELECT 1 FROM audit_log WHERE action_type = 'SHARED_MATCH_CLOSED_ON_CANCEL' AND target_id = '${m1.match_id}'`)).length === 1);
  const note = await q(`SELECT title, message FROM notification WHERE recipient_id = '${ID.P1}' AND notification_type = 'SHARED_PARTNER_CANCELLED' AND subject_id = '${mm.A.booking_id}'`);
  check('the first passenger is told: the trip continues, charged the Solo fare he accepted when booking, nothing to confirm', note.length === 1 && /Solo fare/.test(note[0].message) && /do not need to confirm/.test(note[0].message), note);
  const aAfter = await s.bk(mm.A.booking_id);
  check('the first booking keeps the driver and goes on', aAfter.booking_status === 'Accepted' && aAfter.driver_id === ID.D1);
  await s.walkToTrip('D1', mm.A.booking_id);
  const ended = await s.driverEnds('D1', mm.A.booking_id);
  const endA = await s.bk(mm.A.booking_id);
  check('the first booking is finally billed as an UNMATCHED SOLO trip, the Maximum Unmatched Fare, with NO new fare confirmation',
    ended.ok && endA.fare_breakdown.final.basis === 'unmatched_solo' && Number(endA.actual_fare) === (await solo()) && endA.confirm_fare_at === null, { basis: endA.fare_breakdown.final.basis, fare: endA.actual_fare });
  await s.reset();

  // the same, but the second passenger cancels late (after the grace minute): ONLY he is struck, once
  await s.clearStrikes();
  mm = await matched();
  await acceptedAgo(mm.B.booking_id, 90);
  await cancel('P2', mm.B.booking_id);
  const sk = await s.strikesOf(ID.P2);
  check('a late cancellation (90 s after the assignment): ONE strike, for the cancelling party only', sk.length === 1 && sk[0].violation_code === 'PAX_LATE_CANCEL' && (await s.strikesOf(ID.P1)).length === 0 && (await s.strikesOf(ID.D1)).length === 0, sk);
  check('...and the other party\'s booking continues untouched', (await s.bk(mm.A.booking_id)).booking_status === 'Accepted');
  await s.clearStrikes(); await s.reset();

  console.log('\nS3 the FIRST passenger cancels after the match: the second keeps the driver and continues Solo');
  mm = await matched();
  await cancel('P1', mm.A.booking_id);
  m1 = await s.match(mm.M.match_id);
  const bAfter = await s.bk(mm.B.booking_id);
  check('the pairing is closed; only the first passenger is evaluated (grace minute: no strike); the second is not struck', m1.match_status === 'Cancelled' && (await s.strikesOf(ID.P1)).length === 0 && (await s.strikesOf(ID.P2)).length === 0);
  check('the second booking KEEPS the same driver and goes on', bAfter.driver_id === ID.D1 && bAfter.booking_status === 'Accepted');
  check('...and is told it continues at the Solo fare it accepted', (await q(`SELECT 1 FROM notification WHERE recipient_id = '${ID.P2}' AND notification_type = 'SHARED_PARTNER_CANCELLED' AND subject_id = '${mm.B.booking_id}'`)).length === 1);
  await s.walkToTrip('D1', mm.B.booking_id);
  const endedB = await s.driverEnds('D1', mm.B.booking_id);
  const endB = await s.bk(mm.B.booking_id);
  check('...billed as an unmatched Solo trip (the second booking was Shared, never matched in the end)', endedB.ok && endB.fare_breakdown.final.basis === 'unmatched_solo' && Number(endB.actual_fare) === Number((await s.fare(Number(endB.estimated_distance_km), 'Solo', 1)).solo_fare), endB.fare_breakdown && endB.fare_breakdown.final.basis);
  await s.reset();

  console.log('\nS4 Rules 12.3 / 12.4 / 14.6: the driver cancels ONE leg before the pickup: the pairing ends, the other leg is untouched');
  mm = await matched();
  await s.online('D2', 400);
  const dc = await s.driverCancel('D1', mm.B.booking_id, 'personal_emergency');
  check('(the driver\'s cancellation of the second booking is accepted)', dc.success === true, dc);
  m1 = await s.match(mm.M.match_id);
  check('the pairing is closed (driver_cancelled)', m1.match_status === 'Cancelled' && m1.closed_reason === 'driver_cancelled', m1);
  check('the first booking keeps the driver and is told it continues Solo', (await s.bk(mm.A.booking_id)).driver_id === ID.D1 && (await q(`SELECT 1 FROM notification WHERE recipient_id = '${ID.P1}' AND notification_type = 'SHARED_PARTNER_CANCELLED' AND subject_id = '${mm.A.booking_id}'`)).length === 1);
  const bBack = await s.bk(mm.B.booking_id);
  check('the second booking is back on the search (no driver)', bBack.driver_id === null && ['Pending', 'Searching Driver'].includes(bBack.booking_status), bBack.booking_status);
  await s.sweep(); await s.sweep();
  check('...and is NOT offered again to the driver who cancelled it, by a pairing', (await s.matchesOf(mm.B.booking_id)).every((x) => x.match_id === mm.M.match_id));
  // a new search round (a Retry after No Driver Found, say), with nobody holding an offer for the booking: only the pairing's own memory can keep it from the driver who cancelled
  await internal(`UPDATE dispatch_attempt SET response_status = 'Expired' WHERE booking_id = '${mm.B.booking_id}' AND response_status = 'Pending';
                  UPDATE booking SET dispatch_cycle = dispatch_cycle + 1, dispatch_next_action_at = clock_timestamp() WHERE booking_id = '${mm.B.booking_id}'`);
  await s.sweep(); await s.sweep();
  check('...not even in a later search round: the driver who cancelled it is never offered it again by a pairing', (await s.matchesOf(mm.B.booking_id)).every((x) => x.match_id === mm.M.match_id), (await s.matchesOf(mm.B.booking_id)).length);
  await s.reset(); await s.clearStrikes();

  console.log('\nS5 Rule 10 / 14.6: a no-show of the second passenger ends that leg only; the first trip goes on');
  mm = await matched();
  for (const st of ['In Transit', 'Driver Arrived', 'Trip Ongoing']) { const r = await s.driverSets('D1', mm.A.booking_id, st); if (!r.ok) throw new Error(st + ': ' + r.error); }
  for (const st of ['In Transit', 'Driver Arrived']) { const r = await s.driverSets('D1', mm.B.booking_id, st); if (!r.ok) throw new Error('B ' + st + ': ' + r.error); }
  await internal(`UPDATE booking SET arrived_at = arrived_at - interval '310 seconds' WHERE booking_id = '${mm.B.booking_id}'`);
  await s.moveTo('D1', 160, 10);
  const nb = await s.rpcAs(s.DRIVERS.D1.uid, 'public.driver_report_no_show($1)', [mm.B.booking_id]);
  check('(the driver reports the no-show of the second passenger at his pickup)', nb.success === true, nb);
  const bNS = await s.bk(mm.B.booking_id);
  check('the second leg ends (Cancelled) and ONLY its passenger is evaluated: the no-show strikes', bNS.booking_status === 'Cancelled' && (await s.strikesOf(ID.P2)).some((x) => x.violation_code === 'PAX_NO_SHOW') && (await s.strikesOf(ID.P1)).length === 0, await s.strikesOf(ID.P2));
  check('the pairing is closed, the first trip is still under way with the same driver', (await s.match(mm.M.match_id)).match_status === 'Cancelled' && (await s.bk(mm.A.booking_id)).booking_status === 'Trip Ongoing');
  await s.reset(); await s.clearStrikes();

  console.log('\nS6 Rule 6.5: a replacement is looked for until the cutoff; after the cutoff the trip is Solo');
  mm = await matched();
  await cancel('P2', mm.B.booking_id);
  const repl = await s.propose({ pax: 'P3' });
  check('after the partner cancelled, the trip looks for a replacement: a new compatible booking is proposed to the same driver', repl.m?.match_status === 'Awaiting Driver' && repl.m.primary_booking_id === mm.A.booking_id && repl.m.match_id !== mm.M.match_id, repl.m);
  await s.reset();
  mm = await matched({ stage: 'ongoing' });
  await s.setProgress(mm.A.booking_id, 'D1', 45);
  await cancel('P2', mm.B.booking_id).catch(() => null);
  await s.moveTo('D1', 1500, 10);
  const mid = await s.state('P1', mm.A.booking_id);
  check('(the partner is gone, the trip is at 45%: matching is open again)', mid.matching_open === true && mid.progress_pct === 45 || mid.matching_open === true, mid);
  await s.setProgress(mm.A.booking_id, 'D1', 50);
  const late = await s.propose({ pax: 'P3', pickupNorth: 1650 });
  check('at 50% no replacement is proposed: the trip is billed as it always was, a Solo trip (no failure, no strike)', !late.m && (await s.state('P1', mm.A.booking_id)).matching_open === false && (await s.strikesOf(ID.P1)).length === 0, late.m);
  await s.reset();

  console.log('\nS7 Rules 8.2 - 8.4: the second leg is not "stalled" while the vehicle serves the first');
  // the vehicle waits at the first passenger's pickup ("Driver Arrived") while the second booking, already attached, has not been moved toward for 10 minutes
  const stalled = async (heartbeat) => {
    await s.clearStrikes();
    const t = await matched();
    for (const st of ['In Transit', 'Driver Arrived']) { const r = await s.driverSets('D1', t.A.booking_id, st); if (!r.ok) throw new Error(st + ': ' + r.error); }
    await internal(`UPDATE booking b SET stall_anchor_latitude = d.current_latitude, stall_anchor_longitude = d.current_longitude, stall_anchor_accuracy_m = 10,
        stall_anchor_at = clock_timestamp() - interval '10 minutes', accepted_at = clock_timestamp() - interval '10 minutes'
      FROM driver d WHERE d.driver_id = b.driver_id AND b.booking_id = '${t.B.booking_id}'`);
    if (heartbeat) await s.moveTo('D1', 5, 10);                                   // the driver's app keeps publishing its position, as it does
    else await internal(`UPDATE driver SET last_location_update = clock_timestamp() WHERE driver_id = '${ID.D1}'`);
    await s.sweep(); await s.sweep();
    const out = { b: await s.bk(t.B.booking_id), strikes: await s.strikesOf(ID.D1), t };
    await s.reset();
    return out;
  };
  let x = await stalled(true);
  check('the driver waits for the first passenger and keeps publishing: the second booking is NOT cancelled and the driver is NOT struck', x.b.booking_status === 'Accepted' && x.b.driver_id === ID.D1 && x.strikes.length === 0, { st: x.b.booking_status, strikes: x.strikes });
  x = await stalled(false);
  check('control: the same 10 minutes with NO published fix (no clock restart) is judged by the ordinary stall rule', x.b.booking_status !== 'Accepted' || x.strikes.length > 0, { st: x.b.booking_status, strikes: x.strikes });

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
