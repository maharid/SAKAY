// Batch 10 / the approvals: the driver's Additional Shared Passenger Request (Rule 14.3) and the first passenger's Accept / Decline Shared Match (Rule 14.5).
//   S1  the driver declines: no strike, the booking returns to the standard search, the trip under way is not harmed
//   S2  the driver accepts: the first passenger is asked (decisions N1, N2)
//   S3  T4  the first passenger declines: the trip stays Solo at the Maximum Unmatched Fare, the booking returns to dispatch, nobody is struck
//   S4  the first passenger accepts: the second booking is attached to the same driver, atomically, by one function
//   S5  windows: no answer counts as a Decline (driver 15 s + 5 s, passenger 20 s); a late answer is refused
//   S6  the cutoff closes a proposal that is still out
//   S7  Rule 14.3 / F10.7: repeated declines are flagged for review, a strike only after an administrator confirms
//   S8  who may answer, and what a phone can no longer write
const { setup, ID, check, summary } = require('../b10fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, DRIVERS, at } = s;
  const solo = async () => Number((await s.fare(3.3, 'Solo', 1)).solo_fare);
  const noStrikes = async () => (await s.strikesOf(ID.P1)).length === 0 && (await s.strikesOf(ID.P2)).length === 0 && (await s.strikesOf(ID.D1)).length === 0 && (await s.strikesOf(ID.D2)).length === 0;

  console.log('S1 the driver declines (Rule 14.3): no strike, the request returns to standard dispatch');
  let A = await s.host();
  await s.online('D2', 400);                                                       // an eligible driver for the standard search
  let { b: B, m: M } = await s.propose();
  check('(precondition) the proposal is out and the booking is held', M.match_status === 'Awaiting Driver' && (await s.offers(B.booking_id)).length === 0);
  let r = await s.driverAnswer('D2', M.match_id, false);
  check('another driver cannot answer it', r.success === false && r.error_code === 'ERR_REQUEST_NOT_FOUND', r);
  r = await s.rpc(ID.P2_AUTH, 'driver_respond_shared_request($1, $2)', [M.match_id, false]);
  check('a passenger cannot answer it', r.success === false && r.error_code === 'ERR_NOT_A_DRIVER', r);
  r = await s.driverAnswer('D1', M.match_id, false);
  check('the host driver declines: it works, and says so', r.success === true && r.state === 'declined', r);
  let m1 = await s.match(M.match_id);
  check('the pairing is Declined by the driver, with the reason and the time', m1.match_status === 'Declined' && m1.driver_response_status === 'Declined' && m1.closed_reason === 'driver_declined' && !!m1.closed_at && !!m1.driver_responded_at, m1);
  check('NO strike for anybody: a single decline is no violation', await noStrikes(), await s.strikesOf(ID.D1));
  const back = await s.pendingOffer(B.booking_id);
  check('the second booking is back in STANDARD dispatch at once: the next driver (D2) holds its offer', !!back && back.driver_id === ID.D2, back);
  check('the trip under way is untouched, and it can still take another passenger (the decline did not close its matching)', (await s.bk(A.booking_id)).booking_status === 'Accepted');
  r = await s.driverAnswer('D1', M.match_id, false);
  check('a repeated tap changes nothing (answered once)', r.success === true && r.already_answered === true && (await s.matchesOf(B.booking_id)).length === 1, r);
  r = await s.driverAnswer('D1', M.match_id, true);
  check('Accept after Decline is refused: the request is over', r.success === false && r.error_code === 'ERR_REQUEST_CLOSED', r);
  const c = await s.sharedBook('P3', { pickup: at(120) });
  check('the host trip is still open for another compatible booking', (await s.matchOf(c.booking_id))?.match_status === 'Awaiting Driver');
  await s.reset();

  console.log('\nS2 the driver accepts: the first passenger is asked, the booking stays held (decisions N1, N2)');
  A = await s.host();
  await s.online('D2', 400);
  ({ b: B, m: M } = await s.propose());
  const before = await q(`SELECT 1 FROM notification WHERE notification_type = 'SHARED_MATCH_REQUEST'`);
  check('(precondition) before the driver answers the first passenger is not disturbed: no notice, state "none"', before.length === 0 && (await s.state('P1', A.booking_id)).state === 'none');
  r = await s.driverAnswer('D1', M.match_id, true);
  check('the driver accepts', r.success === true && r.state === 'awaiting_passenger', r);
  m1 = await s.match(M.match_id);
  check('the pairing now waits for the FIRST PASSENGER (20 s), the driver\'s answer is recorded', m1.match_status === 'Awaiting Passenger' && m1.driver_response_status === 'Accepted' && m1.first_passenger_response === 'Pending' && Math.abs((new Date(m1.passenger_expires_at) - new Date(m1.driver_responded_at)) / 1000 - 20) < 1.5, m1);
  const note = await q(`SELECT title, message FROM notification WHERE notification_type = 'SHARED_MATCH_REQUEST' AND recipient_id = '${ID.P1}'`);
  check('the first passenger is told (English and Filipino), without any detail about the other passenger', note.length === 1 && /Accept or Decline/.test(note[0].message) && !/Pax Two|\+63917/.test(note[0].message), note);
  const st = await s.state('P1', A.booking_id);
  check('the first passenger\'s screen state: awaiting_my_consent, with the seconds left', st.state === 'awaiting_my_consent' && st.match_id === M.match_id && st.seconds_remaining > 0 && st.seconds_remaining <= 20, st);
  check('the second booking is still HELD (no standard offer)', (await s.offers(B.booking_id)).length === 0);
  const adv = await one(`SELECT public._dispatch_advance('${B.booking_id}') AS r`);
  check('...even when the standard search is asked to move it on: it answers "shared_hold" and offers it to nobody', adv.r === 'shared_hold' && (await s.offers(B.booking_id)).length === 0, adv);
  r = await s.driverAnswer('D1', M.match_id, true);
  check('a second tap on Accept changes nothing', r.success === true && r.already_answered === true && (await s.match(M.match_id)).match_status === 'Awaiting Passenger', r);
  check('the driver no longer sees it as a request to answer', (await s.myRequest('D1')) === null);

  console.log('\nS3 T4 the first passenger declines (Rule 14.5): the trip stays Solo, the booking returns to dispatch, nobody is struck');
  r = await s.paxAnswer('P2', M.match_id, false);
  check('the OTHER passenger cannot answer for the first', r.success === false && r.error_code === 'ERR_MATCH_NOT_FOUND', r);
  r = await s.paxAnswer('P1', M.match_id, false);
  check('Decline Shared Match works', r.success === true && r.state === 'declined', r);
  m1 = await s.match(M.match_id);
  check('the pairing is Declined by the first passenger', m1.match_status === 'Declined' && m1.first_passenger_response === 'Declined' && m1.closed_reason === 'passenger_declined' && !!m1.first_passenger_responded_at, m1);
  check('NO strike for either passenger (nor for the driver)', await noStrikes());
  const back2 = await s.pendingOffer(B.booking_id);
  check('the proposed second booking returns to STANDARD dispatch: D2 holds its offer', !!back2 && back2.driver_id === ID.D2, back2);
  const stA = await s.state('P1', A.booking_id);
  check('the trip stays Solo for the rest of its way: matching is closed for it (the passenger declined)', stA.matching_open === false && stA.state === 'closed' && stA.closed_reason === 'passenger_declined', stA);
  const c2 = await s.sharedBook('P3', { pickup: at(120) });
  await s.sweep(); await s.sweep();
  check('no other booking is proposed to that trip any more', (await s.matchOf(c2.booking_id)) === undefined);
  r = await s.paxAnswer('P1', M.match_id, true);
  check('Accept after Decline is refused', r.success === false && r.error_code === 'ERR_MATCH_CLOSED', r);
  r = await s.paxAnswer('P1', M.match_id, false);
  check('a repeated Decline is a no-op', r.success === true && r.already_answered === true, r);
  // the trip is billed Solo (Maximum Unmatched Fare), no new confirmation
  await s.finish(B.booking_id); await s.finish(c2.booking_id);
  await s.walkToTrip('D1', A.booking_id);
  const ended = await s.driverEnds('D1', A.booking_id);
  const endA = await s.bk(A.booking_id);
  check('the trip under way ends and is billed the SOLO fare of its distance (the Maximum Unmatched Fare it accepted), as an unmatched trip', ended.ok && endA.fare_breakdown.final.basis === 'unmatched_solo' && Number(endA.actual_fare) === (await solo()), { basis: endA.fare_breakdown.final.basis, fare: endA.actual_fare });
  await s.reset();

  console.log('\nS4 the first passenger accepts: ONE function attaches the second booking to the same driver');
  A = await s.host();
  await s.online('D2', 400);
  ({ b: B, m: M } = await s.propose());
  await s.driverAnswer('D1', M.match_id, true);
  r = await s.paxAnswer('P1', M.match_id, true);
  check('Accept Shared Match works', r.success === true && r.state === 'matched', r);
  m1 = await s.match(M.match_id);
  const a2 = await s.bk(A.booking_id); const b2 = await s.bk(B.booking_id);
  check('the pairing is Matched, stamped with the time', m1.match_status === 'Matched' && m1.first_passenger_response === 'Accepted' && !!m1.matched_at, m1);
  check('the second booking now belongs to the SAME driver, accepted, with the database\'s clock', b2.driver_id === ID.D1 && b2.booking_status === 'Accepted' && !!b2.accepted_at && b2.dispatch_ended_reason === 'accepted' && b2.dispatch_next_action_at === null, b2);
  check('both bookings point at the pairing (the fare of a matched trip depends on it)', a2.shared_trip_match_id === M.match_id && b2.shared_trip_match_id === M.match_id);
  check('the second booking got the driver\'s TODA and the stall starting point, as a normal acceptance does', b2.toda_id === ID.TODA1 && b2.stall_anchor_latitude !== null && b2.accept_latitude !== null, b2);
  check('the second booking is no longer searched for: D2 has no offer, the booking has no standard offer at all', (await s.myOffer('D2')) === null && (await s.offers(B.booking_id)).length === 0);
  check('both passengers are told it is confirmed', (await q(`SELECT 1 FROM notification WHERE notification_type = 'SHARED_MATCH_CONFIRMED'`)).length === 2);
  check('the confirmation is audited', (await q(`SELECT 1 FROM audit_log WHERE action_type = 'SHARED_MATCH_CONFIRMED' AND target_id = '${M.match_id}'`)).length === 1);
  r = await s.paxAnswer('P1', M.match_id, true);
  check('a second tap on Accept changes nothing', r.success === true && r.already_answered === true && (await s.bk(B.booking_id)).driver_id === ID.D1, r);
  const open = await one(`SELECT count(*)::int n FROM booking WHERE driver_id = '${ID.D1}' AND booking_status NOT IN ('Cancelled','Completed')`);
  check('the driver carries exactly the two bookings of the pairing', open.n === 2, open);
  // nothing else can attach a second booking
  const third = await s.sharedBook('P3', { pickup: at(2000) });
  let w = await s.attempt(() => s.svc((tx) => tx.query(`UPDATE booking SET driver_id = '${ID.D1}', booking_status = 'Accepted' WHERE booking_id = '${third.booking_id}'`)));
  check('"one open booking per driver" still holds for everybody else, the server included (ERR_DRIVER_HAS_OPEN_BOOKING)', !w.ok && /ERR_DRIVER_HAS_OPEN_BOOKING/.test(w.error), w);
  w = await s.attempt(() => s.svc((tx) => tx.query(`UPDATE booking SET driver_id = '${ID.D1}', booking_status = 'Accepted' WHERE booking_id = '${third.booking_id}'`)));
  check('...also with no pairing named (a stale setting cannot be reused)', !w.ok && /ERR_DRIVER_HAS_OPEN_BOOKING/.test(w.error), w);
  w = await s.attempt(() => s.as(ID.D_AUTH, (tx) => tx.query(`UPDATE booking SET driver_id = '${ID.D1}' WHERE booking_id = '${third.booking_id}'`)));
  check('a driver cannot attach a booking to himself from the app (ERR_BOOKING_DRIVER_LOCKED)', !w.ok && /ERR_BOOKING_DRIVER_LOCKED|0 rows|permission|row-level/.test(w.error) || (w.ok && w.value.rowCount === 0), w);
  w = await s.attempt(() => s.as(ID.P2_AUTH, (tx) => tx.query(`UPDATE booking SET shared_trip_match_id = NULL WHERE booking_id = '${B.booking_id}'`)));
  check('a passenger cannot unhook or change the pairing of his booking (ERR_MATCH_LOCKED)', !w.ok && /ERR_MATCH_LOCKED/.test(w.error), w);
  w = await s.attempt(() => s.as(s.EXTRA.P3.uid, (tx) => tx.query(`UPDATE booking SET shared_trip_match_id = '${M.match_id}' WHERE booking_id = '${third.booking_id}'`)));
  check('...nor point his own booking at somebody\'s pairing to get its fare (ERR_MATCH_LOCKED)', !w.ok && /ERR_MATCH_LOCKED/.test(w.error), w);
  await s.reset();

  console.log('\nS5 the windows: no answer counts as a Decline (the driver 15 s + 5 s, the passenger 20 s); a late answer is refused');
  A = await s.host();
  await s.online('D2', 400);
  ({ b: B, m: M } = await s.propose());
  await s.matchAgo(M.match_id, 25);
  r = await s.driverAnswer('D1', M.match_id, true);
  check('the driver answers after his window: refused (ERR_REQUEST_EXPIRED) and the proposal is closed', r.success === false && r.error_code === 'ERR_REQUEST_EXPIRED' && (await s.match(M.match_id)).match_status === 'Declined', r);
  m1 = await s.match(M.match_id);
  check('...recorded as the driver\'s timeout (not a decline he chose), no strike', m1.driver_response_status === 'Expired' && m1.closed_reason === 'driver_timeout' && await noStrikes(), m1);
  check('...and the booking is back in the standard search (D2)', (await s.pendingOffer(B.booking_id))?.driver_id === ID.D2);
  await s.reset();
  A = await s.host();
  await s.online('D2', 400);
  ({ b: B, m: M } = await s.propose());
  await s.matchAgo(M.match_id, 25);
  await s.sweep();
  m1 = await s.match(M.match_id);
  check('the sweep closes a request the driver ignored: Declined / driver_timeout', m1.match_status === 'Declined' && m1.closed_reason === 'driver_timeout' && m1.driver_response_status === 'Expired', m1);
  check('...and sets the booking free at once', (await s.pendingOffer(B.booking_id))?.driver_id === ID.D2);
  await s.reset();
  A = await s.host();
  await s.online('D2', 400);
  ({ b: B, m: M } = await s.propose());
  await s.driverAnswer('D1', M.match_id, true);
  await s.matchAgo(M.match_id, 40);
  r = await s.paxAnswer('P1', M.match_id, true);
  check('the first passenger answers after 20 s: refused, nothing is matched (ERR_RESPONSE_EXPIRED)', r.success === false && r.error_code === 'ERR_RESPONSE_EXPIRED' && (await s.bk(B.booking_id)).driver_id === null, r);
  m1 = await s.match(M.match_id);
  check('...it counts as a DECLINE of the passenger, with no strike for anybody', m1.match_status === 'Declined' && m1.first_passenger_response === 'Expired' && m1.closed_reason === 'passenger_timeout' && await noStrikes(), m1);
  check('...and the second booking returns to the standard search', (await s.pendingOffer(B.booking_id))?.driver_id === ID.D2);
  check('...the trip stays Solo', (await s.state('P1', A.booking_id)).matching_open === false);
  await s.reset();
  A = await s.host();
  await s.online('D2', 400);
  ({ b: B, m: M } = await s.propose());
  await s.driverAnswer('D1', M.match_id, true);
  await s.matchAgo(M.match_id, 40);
  await s.sweep();
  m1 = await s.match(M.match_id);
  check('the sweep closes a consent nobody gave (passenger_timeout)', m1.match_status === 'Declined' && m1.closed_reason === 'passenger_timeout');
  await s.reset();

  console.log('\nS6 Rule 14.2 / PI-10: a proposal still out when the trip reaches 50% is closed; matching never starts at 50% or later');
  A = await s.host({ stage: 'ongoing' });
  await s.online('D2', 400);
  await s.setProgress(A.booking_id, 'D1', 30);
  ({ b: B, m: M } = await s.propose({ pickupNorth: 1000 + 120 }));
  check('(precondition) at 30% a proposal goes out', M?.match_status === 'Awaiting Driver', M);
  await s.driverAnswer('D1', M.match_id, true);
  const p = await s.setProgress(A.booking_id, 'D1', 50);
  check('(the trip reaches 50%)', p === 50, p);
  r = await s.paxAnswer('P1', M.match_id, true);
  check('the first passenger accepts too late: matching has closed (ERR_MATCHING_CLOSED), nothing is attached', r.success === false && r.error_code === 'ERR_MATCHING_CLOSED' && (await s.bk(B.booking_id)).driver_id === null, r);
  check('...recorded as Expired / cutoff, not as anybody\'s decline', (await s.match(M.match_id)).match_status === 'Expired' && (await s.match(M.match_id)).closed_reason === 'cutoff' && await noStrikes());
  await s.reset();

  console.log('\nS7 Rule 14.3 / F10.7: repeated declines of Shared requests are flagged for review; a strike only after an administrator confirms');
  // a clean slate: the earlier sections of this suite left declines and timeouts of the same driver
  await internal(`UPDATE shared_trip_match SET created_at = created_at - interval '3 days', closed_at = closed_at - interval '3 days'`);
  await internal(`DELETE FROM admin_review_flag WHERE flag_type = 'DRIVER_SHARED_REQUEST_DECLINES'`);
  A = await s.host();
  await s.online('D2', 400);
  const decline = async (pax) => {
    const x = await s.propose({ pax });
    const d = await s.driverAnswer('D1', x.m.match_id, false);
    await s.finish(x.b.booking_id);
    return d;
  };
  await decline('P2');
  check('ONE decline: no flag', (await s.flags('DRIVER_SHARED_REQUEST_DECLINES', ID.D1)).length === 0);
  await decline('P2');
  check('two declines: still no flag', (await s.flags('DRIVER_SHARED_REQUEST_DECLINES', ID.D1)).length === 0);
  // the third is a request the driver IGNORED (a timeout counts like a decline, F10.7)
  const ign = await s.propose({ pax: 'P2' });
  await s.matchAgo(ign.m.match_id, 25);
  await s.sweep();
  await s.finish(ign.b.booking_id);
  const flags = await s.flags('DRIVER_SHARED_REQUEST_DECLINES', ID.D1);
  check('the THIRD (two declines and one ignored request) in 24 h raises ONE review flag for the driver\'s TODA Administrator (review only)', flags.length === 1 && flags[0].assigned_role === 'toda_admin' && flags[0].details.declines_in_window === 3, flags);
  check('...and still NO strike: nothing is sanctioned until an administrator confirms', (await s.strikesOf(ID.D1)).length === 0);
  const standard = await q(`SELECT 1 FROM admin_review_flag WHERE flag_type = 'DRIVER_REPEATED_DECLINES'`);
  check('the Rule 7.9 counter of STANDARD offers is separate: it was not touched by Shared declines', standard.length === 0);
  let conf = await s.attempt(() => s.todaCall('admin_confirm_flagged_violation($1, NULL, $2, NULL)', [flags[0].flag_id, 'too short']));
  check('confirming needs a written reason (at least 10 characters)', !conf.ok && /ERR_CONFIRM_REASON/.test(conf.error), conf);
  conf = await s.attempt(() => s.lguCall('admin_confirm_flagged_violation($1, NULL, $2, NULL)', [flags[0].flag_id, 'Refused compatible shared requests without a reason while available.']));
  check('the administrator confirms: DRV_REPEATED_REFUSAL is issued (the existing catalog code, Rules 7.9 / 14.3)', conf.ok && conf.value.success === true, conf);
  const sk = await s.strikesOf(ID.D1);
  check('exactly one strike, the catalog\'s', sk.length === 1 && sk[0].violation_code === 'DRV_REPEATED_REFUSAL', sk);
  check('the flag is resolved', (await s.flags('DRIVER_SHARED_REQUEST_DECLINES', ID.D1)).length === 0);
  await s.clearStrikes(); await s.reset();

  console.log('\nS4b the one exception to "one open booking per driver" holds only for a pairing that is awaiting the first passenger');
  A = await s.host();
  ({ b: B, m: M } = await s.propose());
  await s.driverAnswer('D1', M.match_id, true);
  await s.paxAnswer('P1', M.match_id, false);                                   // the pairing ends: Declined
  w = await s.attempt(() => s.db.exec(`SELECT set_config('sakay.internal_context', 'true', true); SELECT set_config('sakay.shared_attach', '${M.match_id}', true);
      UPDATE booking SET driver_id = '${ID.D1}', booking_status = 'Accepted' WHERE booking_id = '${B.booking_id}'`));
  check('a setting that names a pairing which has ended attaches nobody (ERR_DRIVER_HAS_OPEN_BOOKING), even for a trusted session', !w.ok && /ERR_DRIVER_HAS_OPEN_BOOKING/.test(w.error), w);
  check('...and the second booking still has no driver', (await s.bk(B.booking_id)).driver_id === null);
  await s.reset();

  console.log('\nS8 who may answer, and what the screens may read');
  A = await s.host();
  ({ b: B, m: M } = await s.propose());
  await s.driverAnswer('D1', M.match_id, true);
  w = await s.attempt(() => s.as(ID.P_AUTH, (tx) => tx.query(`SELECT * FROM shared_trip_match`)));
  check('a passenger can no longer read the pairing table (the disclosure function is the only way)', w.ok && w.value.rows.length === 0, w);
  w = await s.attempt(() => s.as(ID.D_AUTH, (tx) => tx.query(`SELECT * FROM shared_trip_match`)));
  check('a driver cannot read it either (his request comes from get_my_shared_request)', w.ok && w.value.rows.length === 0, w);
  w = await s.attempt(() => s.as(ID.L_AUTH, (tx) => tx.query(`SELECT * FROM shared_trip_match`)));
  check('the LGU Administrator reads every pairing', w.ok && w.value.rows.length >= 1, w);
  w = await s.attempt(() => s.as(ID.T_AUTH, (tx) => tx.query(`SELECT * FROM shared_trip_match`)));
  check('the TODA Administrator reads the pairings of the TODA\'s own bookings', w.ok && w.value.rows.length >= 1, w);
  w = await s.attempt(() => s.as(ID.T2_AUTH, (tx) => tx.query(`SELECT * FROM shared_trip_match`)));
  check('...and another TODA\'s administrator reads none', w.ok && w.value.rows.length === 0, w);
  w = await s.attempt(() => s.as(ID.P_AUTH, (tx) => tx.query(`INSERT INTO shared_trip_match (primary_booking_id) VALUES ('${A.booking_id}')`)));
  check('nobody writes a pairing from a browser', !w.ok, w);
  w = await s.attempt(() => s.anon((tx) => tx.query(`SELECT public.get_shared_match_state('${A.booking_id}')`)));
  check('an anonymous caller cannot ask for a shared match', !w.ok, w);
  r = await s.state('P2', A.booking_id);
  check('a passenger cannot ask about somebody else\'s booking', r.success === false && r.error_code === 'ERR_NOT_YOUR_BOOKING', r);
  await s.reset();

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
