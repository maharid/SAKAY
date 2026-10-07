// Batch 6: the dispatch engine in the database. Spec section 27 TEST 1-6, 8, 10, 11, 12 and the Batch 6 prompt's T4, T5, T6.
// Runs the WHOLE migration chain on the local emulator (never Supabase). The search is driven by deadlines stored in the database, so the
// suite winds those deadlines forward (rewind) instead of waiting minutes; the passenger's and the drivers' apps are never involved
// except as callers of the same RPCs they use.
const { setup, ID, DRIVERS, attempt, check, summary } = require('../b6fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, svc, as, north } = s;
  const ids = (rows) => rows.map((r) => (r.driver_id === ID.D1 ? 'D1' : r.driver_id === ID.D2 ? 'D2' : r.driver_id === ID.D3 ? 'D3' : r.driver_id));
  const off = async (k) => { await s.goOffline(DRIVERS[k].uid); };
  const allOffline = async () => { for (const k of ['D1', 'D2', 'D3']) if ((await s.status(DRIVERS[k].id)) !== 'Offline') await off(k); };
  const reset = async (b) => { if (b) await s.finish(b.booking_id); await allOffline(); };

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('S1 TEST 1: Tier 1 success - the nearest Priority TODA driver inside 600 m gets the offer; Tier 2 and 3 never start');
  await s.online('D1', 300); await s.online('D2', 500);
  let b = await s.bookAs('P1');
  check('the search started by itself when the booking was inserted (no app call)', b.booking_status === 'Pending' && b.dispatch_tier === 1 && b.dispatch_cycle === 1, b);
  check('the Priority TODA (nearest accredited terminal) was chosen at booking time', b.priority_toda_id === ID.TODA1, b.priority_toda_id);
  let o = await s.offers(b.booking_id);
  check('exactly one offer went out, to D1 (shortest ETA), in Tier 1', o.length === 1 && ids(o)[0] === 'D1' && o[0].tier === 1 && o[0].cycle === 1, o);
  check('the offer records the ETA it was ranked by and says what that ETA is (an estimate, not a routing-engine figure)',
    o[0].eta_seconds === 70 && o[0].eta_source === 'straight_line_estimate' && o[0].distance_m === 300, o[0]);
  check('the offer expires after the window plus the delivery grace (15 s + 5 s)',
    Math.abs((new Date(o[0].expires_at) - new Date(o[0].notification_sent_at)) / 1000 - 20) < 0.5, o[0]);
  const acc = await s.accept('D1', o[0].attempt_id);
  b = await s.booking(b.booking_id);
  check('D1 accepts: the booking is Accepted with D1, the TODA of the driver, the server time and the starting position',
    acc.success === true && b.booking_status === 'Accepted' && b.driver_id === ID.D1 && b.toda_id === ID.TODA1 && !!b.accepted_at && b.accept_latitude !== null, { acc, b });
  check('Tier 2 and Tier 3 never started; the search is over, reason "accepted"', b.dispatch_tier === 1 && b.dispatch_reached_tier3_at === null && b.dispatch_ended_reason === 'accepted' && b.dispatch_next_action_at === null, b);
  check('D2 was never offered anything', ids(await s.offers(b.booking_id)).join() === 'D1');
  await reset(b);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS2 TEST 2: Tier 1 empty - the search goes straight to Tier 2, no waiting');
  await s.online('D3', 400);          // TODA Two: not the Priority TODA, so Tier 1 has nobody
  b = await s.bookAs('P1');
  o = await s.offers(b.booking_id);
  check('the offer to D3 goes out at once, in Tier 2', o.length === 1 && ids(o)[0] === 'D3' && o[0].tier === 2, o);
  check('the booking is in Tier 2', (await s.booking(b.booking_id)).dispatch_tier === 2);
  await reset(b);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS3 TEST 3: a decline excludes the driver for this cycle; the next-ranked driver is offered at once');
  await s.online('D1', 300); await s.online('D2', 500);
  b = await s.bookAs('P1');
  o = await s.offers(b.booking_id);
  const noReason = await s.decline('D1', o[0].attempt_id, null);
  check('a decline needs a reason (Rule 7.9)', noReason.success === false && noReason.error_code === 'ERR_DECLINE_REASON_REQUIRED', noReason);
  check('a reason must come from the list', (await s.decline('D1', o[0].attempt_id, 'bored')).error_code === 'ERR_DECLINE_REASON_REQUIRED');
  check('the offer is still open after the refused declines', (await s.pendingOffer(b.booking_id))?.driver_id === ID.D1);
  const dec = await s.decline('D1', o[0].attempt_id, 'vehicle_issue');
  o = await s.offers(b.booking_id);
  check('D1 declines with a reason: the offer is closed as an ANSWER (not "unanswered") with the reason recorded',
    dec.success === true && o[0].response_status === 'Declined' && o[0].decline_reason === 'vehicle_issue' && o[0].responded_at !== null && o[0].unanswered === false, o[0]);
  check('the next-ranked driver (D2) is offered at once, in Tier 1', o.length === 2 && ids(o)[1] === 'D2' && o[1].response_status === 'Pending' && o[1].tier === 1, o);
  check('a decline is no strike', (await s.strikes(ID.D1)).length === 0);
  await s.expireOffer(b.booking_id);
  o = await s.offers(b.booking_id);
  check('D2 ignores it: closed as unanswered; D1 is NOT offered again in this cycle (declined / timed out drivers stay excluded)',
    o[1].response_status === 'Expired' && o[1].unanswered === true && o.filter((r) => r.driver_id === ID.D1).length === 1 && !(await s.pendingOffer(b.booking_id)), o);
  b = await s.booking(b.booking_id);
  check('with nobody left the search is in Tier 3, waiting for the next pool refresh', b.dispatch_tier === 3 && b.dispatch_reached_tier3_at !== null && b.booking_status === 'Pending', b);
  await reset(b);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS4 TEST 4: Tier 2 - 2 km, any accredited TODA');
  await s.online('D1', 300); await s.online('D2', 1500); await s.online('D3', 1200);
  b = await s.bookAs('P1');
  o = await s.offers(b.booking_id);
  check('Tier 1 first: only D1 (Priority TODA, inside 600 m)', o.length === 1 && ids(o)[0] === 'D1' && o[0].tier === 1, o);
  await s.decline('D1', o[0].attempt_id, 'other');
  o = await s.offers(b.booking_id);
  check('Tier 1 has nobody else (D2 is a Priority TODA driver but 1.5 km away): Tier 2 begins and the nearer D3 (TODA Two, 1.2 km) is offered - the TODA restriction is gone',
    o.length === 2 && ids(o)[1] === 'D3' && o[1].tier === 2, o);
  await s.decline('D3', o[1].attempt_id, 'other');
  o = await s.offers(b.booking_id);
  check('then D2 (1.5 km), still Tier 2', o.length === 3 && ids(o)[2] === 'D2' && o[2].tier === 2, o);
  await reset(b);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS5 TEST 5: Tier 3 - the radius grows 2.0 -> 2.5 -> 3.0 -> 3.5 km and the pool is refreshed every 30 s');
  const radii = await q(`SELECT s, public.dispatch_tier3_radius_m(s) r FROM unnest(ARRAY[0, 89, 90, 179, 180, 269, 270, 299, 300, 1000]) s`);
  check('the schedule: 0-89 s 2.0 km, 90-179 s 2.5 km, 180-269 s 3.0 km, 270-299 s 3.5 km, then the search ends',
    radii.map((r) => `${r.s}:${r.r ?? ''}`).join() === '0:2000,89:2000,90:2500,179:2500,180:3000,269:3000,270:3500,299:3500,300:,1000:', radii);
  await s.online('D1', 2200); await s.online('D2', 2800); await s.online('D3', 3400);
  b = await s.bookAs('P1');
  b = await s.booking(b.booking_id);
  check('nobody inside Tier 1 or Tier 2: the live search began at once and nobody was offered (the nearest is 2.2 km, the radius 2.0 km)',
    b.dispatch_tier === 3 && b.dispatch_reached_tier3_at !== null && (await s.offers(b.booking_id)).length === 0, b);
  const nextIn = (new Date(b.dispatch_next_action_at) - Date.now()) / 1000;
  check('it will look again in 30 s', nextIn > 28 && nextIn <= 30.5, nextIn);
  check('the passenger sees the search is widening (no tier numbers)', (await s.statusOf('P1', b.booking_id)).phase === 'widening');
  check('a sweep before anything is due does nothing', (await s.sweep()) === 0 && (await s.offers(b.booking_id)).length === 0);
  await s.rewind(b.booking_id, 95); await s.sweep();
  o = await s.offers(b.booking_id);
  check('at 1:35 the radius is 2.5 km: D1 (2.2 km) is offered, in Tier 3', o.length === 1 && ids(o)[0] === 'D1' && o[0].tier === 3, o);
  await s.decline('D1', o[0].attempt_id, 'other');
  check('nobody else within 2.5 km (D2 is 2.8 km)', (await s.offers(b.booking_id)).length === 1);
  await s.rewind(b.booking_id, 95); await s.sweep();
  o = await s.offers(b.booking_id);
  check('at 3:10 the radius is 3.0 km: D2 (2.8 km) is offered', o.length === 2 && ids(o)[1] === 'D2', o);
  await s.decline('D2', o[1].attempt_id, 'other');
  await s.rewind(b.booking_id, 95); await s.sweep();
  o = await s.offers(b.booking_id);
  check('at 4:45 the radius is 3.5 km: D3 (3.4 km) is offered', o.length === 3 && ids(o)[2] === 'D3', o);
  await reset(b);

  console.log('   pool refresh: a driver who comes Online after the live search began can still be offered the booking');
  b = await s.bookAs('P1');
  check('nobody Online: the search is waiting', (await s.offers(b.booking_id)).length === 0 && (await s.booking(b.booking_id)).dispatch_tier === 3);
  await s.online('D1', 1000);
  await s.sweep();
  check('D1 came Online but the pool is only looked at again at the refresh time: still no offer', (await s.offers(b.booking_id)).length === 0);
  await s.rewind(b.booking_id, 31); await s.sweep();
  o = await s.offers(b.booking_id);
  check('at the next refresh D1 qualifies and is offered', o.length === 1 && ids(o)[0] === 'D1' && o[0].tier === 3, o);
  await reset(b);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS6 TEST 6 and T6: No Driver Found at the maximum time - driven by the database alone (no app, no passenger)');
  await s.online('D1', 300);
  b = await s.bookAs('P1');
  o = await s.offers(b.booking_id);
  await s.decline('D1', o[0].attempt_id, 'other');                     // D1 declines in cycle 1
  await allOffline();
  check('the search is waiting in Tier 3', (await s.booking(b.booking_id)).dispatch_tier === 3);
  await s.rewind(b.booking_id, 299); await s.sweep();
  check('at 4:59 the booking is still searching', (await s.booking(b.booking_id)).booking_status === 'Pending');
  await s.rewind(b.booking_id, 2); const swept = await s.sweep();
  b = await s.booking(b.booking_id);
  check('at 5:01 a SWEEP (the scheduled job, no app involved) ends it: No Driver Found, the reason recorded, the clock stopped',
    swept >= 1 && b.booking_status === 'No Driver Found' && b.dispatch_ended_reason === 'no_driver_found' && b.dispatch_next_action_at === null, b);
  check('the passenger is told, and the audit log has it',
    (await q(`SELECT 1 FROM notification WHERE passenger_id='${ID.P1}' AND notification_type='NO_DRIVER_FOUND'`)).length === 1
    && (await q(`SELECT 1 FROM audit_log WHERE action_type='DISPATCH_NO_DRIVER_FOUND' AND target_id='${b.booking_id}'`)).length === 1);
  const st = await s.statusOf('P1', b.booking_id);
  check('the passenger sees an ended search', st.phase === 'ended' && st.booking_status === 'No Driver Found' && st.ended_reason === 'no_driver_found', st);
  const again = await attempt(() => s.bookAs('P1'));
  check('No Driver Found is not an open booking: the passenger may book again without penalty (and we do not here)', again.ok === true, again.error);
  if (again.ok) await s.finish(again.value.booking_id);
  await s.online('D1', 300);
  const rt = await s.retry('P1', b.booking_id);
  b = await s.booking(b.booking_id);
  check('Retry: the SAME booking starts a new cycle from Tier 1', rt.success === true && b.booking_status === 'Pending' && b.dispatch_cycle === 2 && b.dispatch_tier === 1 && b.search_restarted_at !== null, { rt, b });
  o = await s.offers(b.booking_id);
  check('D1, who declined in cycle 1, is a candidate again and is offered at once (Tier 1, cycle 2)', o.length === 2 && o[1].driver_id === ID.D1 && o[1].cycle === 2 && o[1].tier === 1 && o[1].response_status === 'Pending', o);
  const rt2 = await s.retry('P1', b.booking_id);
  check('retrying a search that is already running changes nothing (no second cycle)', rt2.success === true && rt2.already_searching === true && (await s.booking(b.booking_id)).dispatch_cycle === 2);
  check('another passenger cannot retry it', (await s.retry('P2', b.booking_id)).error_code === 'ERR_NOT_YOUR_BOOKING');
  check('and only one booking is open for the passenger', (await q(`SELECT 1 FROM booking WHERE passenger_id='${ID.P1}' AND booking_status IN ('Pending','Searching Driver')`)).length === 1);
  await reset(b);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS7 TEST 8: realtime recovery - the offer is in the database, a driver who reconnects gets it back');
  await s.online('D1', 300);
  b = await s.bookAs('P1');
  let mine = await s.myOffer('D1');
  check('get_my_pending_offer returns the offer with what the screen needs', !!mine && mine.booking_id === b.booking_id && mine.passenger_name === 'Pax One'
    && Number(mine.estimated_fare) > 0 && mine.seconds_remaining >= 14 && mine.seconds_remaining <= 15 && mine.eta_seconds === 70, mine);
  await s.rewind(b.booking_id, 8);
  mine = await s.myOffer('D1');
  check('8 seconds later the same offer is back, with no more than the time that is really left before the hard expiry (12 s)', !!mine && mine.seconds_remaining >= 11 && mine.seconds_remaining <= 12, mine && mine.seconds_remaining);
  check('another driver sees nothing', (await s.myOffer('D2')) === null);
  check('the driver can still read the offered booking, and no other driver can', (await as(DRIVERS.D1.uid, (tx) => tx.query(`SELECT 1 FROM booking WHERE booking_id=$1`, [b.booking_id]))).rows.length === 1
    && (await as(DRIVERS.D2.uid, (tx) => tx.query(`SELECT 1 FROM booking WHERE booking_id=$1`, [b.booking_id]))).rows.length === 0);
  await s.rewind(b.booking_id, 30);
  check('once the time is up the offer is gone from the driver (and the driver\'s own poll moved the search on)', (await s.myOffer('D1')) === null);
  check('and the offer was closed as unanswered by the poll alone', (await s.offers(b.booking_id))[0].unanswered === true);
  await reset(b);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS8 TEST 10: only ONE dispatch cycle and ONE open offer, however often it is poked');
  await s.online('D1', 300); await s.online('D2', 500);
  b = await s.bookAs('P1');
  for (let i = 0; i < 4; i++) await s.sweep();
  for (let i = 0; i < 4; i++) await s.statusOf('P1', b.booking_id);
  for (let i = 0; i < 3; i++) await internal(`SELECT public._dispatch_advance('${b.booking_id}')`);
  await internal(`UPDATE booking SET booking_status = booking_status WHERE booking_id = '${b.booking_id}'`);       // a replayed event
  o = await s.offers(b.booking_id);
  check('after many sweeps, polls and replays: one cycle, one offer, one driver asked', o.length === 1 && (await s.booking(b.booking_id)).dispatch_cycle === 1 && o[0].response_status === 'Pending', o);
  check('at most one offer is pending for the booking at any time', (await q(`SELECT 1 FROM dispatch_attempt WHERE booking_id='${b.booking_id}' AND response_status='Pending'`)).length === 1);
  await reset(b);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS9 TEST 11: a Shared booking uses the same tiered dispatch');
  await s.online('D1', 300);
  b = await s.bookAs('P1', { shared: true, fare: undefined });
  o = await s.offers(b.booking_id);
  check('the shared booking is offered by the same engine: Tier 1, D1, with an ETA and expiry',
    b.is_shared_trip === true && o.length === 1 && ids(o)[0] === 'D1' && o[0].tier === 1 && o[0].expires_at !== null, o);
  check('the driver sees it marked as a shared trip', (await s.myOffer('D1')).is_shared_trip === true);
  await reset(b);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS10 TEST 12: dispatch uses the drivers\' latest real GPS fix; nothing simulated');
  await s.online('D1', 500); await s.online('D2', 300);
  b = await s.bookAs('P1');
  check('D2 (300 m) is nearer than D1 (500 m) and is offered', ids(await s.offers(b.booking_id))[0] === 'D2');
  await reset(b);
  await s.online('D1', 500); await s.online('D2', 300);
  await s.moveTo('D1', 100); await s.moveTo('D2', 800);
  b = await s.bookAs('P1');
  check('after the drivers publish new fixes the order follows them: D1 (now 100 m) is offered first', ids(await s.offers(b.booking_id))[0] === 'D1');
  await reset(b);
  console.log('   a driver whose position is unknown, stale or inaccurate is never offered (an unknown position used to rank FIRST: the distance helper answers 0 km for NULL)');
  const probe = async (label, sql, restore) => {
    await s.online('D1', 100); await s.online('D2', 1000);
    await internal(sql);
    const x = await s.bookAs('P1');
    const first = ids(await s.offers(x.booking_id))[0];
    check(`${label}: D1 (100 m) is skipped, D2 is offered`, first === 'D2', first);
    await s.finish(x.booking_id); await allOffline();
    await internal(restore);
  };
  await probe('no position at all', `UPDATE driver SET current_latitude = NULL, current_longitude = NULL WHERE driver_id = '${ID.D1}'`, `SELECT 1`);
  await probe('a fix older than 45 s', `UPDATE driver SET last_location_update = now() - interval '2 minutes' WHERE driver_id = '${ID.D1}'`, `SELECT 1`);
  await probe('a fix worse than 100 m accuracy', `UPDATE driver SET last_location_accuracy_m = 500 WHERE driver_id = '${ID.D1}'`, `SELECT 1`);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS11 T4: drivers who must never be offered a booking');
  // The driver under test is the NEAREST (100 m); a control driver 1 km away is perfectly eligible. The control must be offered instead.
  const never = async (label, who, apply, undo) => {
    const control = who === 'D2' ? 'D1' : 'D2';
    await s.online(who, 100); await s.online(control, 1000);
    await apply();
    const x = await s.bookAs('P1');
    const first = ids(await s.offers(x.booking_id))[0];
    check(`${label}: ${who} (the nearest) is skipped and ${control} is offered`, first === control, first);
    await s.finish(x.booking_id); await allOffline();
    if (undo) await undo();
  };
  await never('expired driving licence', 'D1', () => internal(`UPDATE driver SET license_expiry = current_date - 1 WHERE driver_id = '${ID.D1}'`), () => internal(`UPDATE driver SET license_expiry = NULL WHERE driver_id = '${ID.D1}'`));
  await never('expired MTOP permit', 'D1', () => internal(`UPDATE driver SET mtop_expiry = current_date - 1 WHERE driver_id = '${ID.D1}'`), () => internal(`UPDATE driver SET mtop_expiry = NULL WHERE driver_id = '${ID.D1}'`));
  await never('suspended account', 'D1', () => internal(`UPDATE driver SET suspended_until = now() + interval '3 days', suspension_kind = 'ADMIN', account_status = 'Suspended' WHERE driver_id = '${ID.D1}'`),
    () => internal(`UPDATE driver SET suspended_until = NULL, suspension_kind = NULL, account_status = 'Verified' WHERE driver_id = '${ID.D1}'`));
  await never('deactivated account', 'D1', () => internal(`UPDATE driver SET deactivated_at = now() WHERE driver_id = '${ID.D1}'`), () => internal(`UPDATE driver SET deactivated_at = NULL WHERE driver_id = '${ID.D1}'`));
  await never('affiliation not approved by the LGU (wrong affiliation)', 'D1', () => internal(`UPDATE driver_toda_affiliation SET lgu_verification_status = 'Pending' WHERE affiliation_id = '${s.AFF.D1_T1}'`),
    () => internal(`UPDATE driver_toda_affiliation SET lgu_verification_status = 'Approved' WHERE affiliation_id = '${s.AFF.D1_T1}'`));
  await never('affiliated TODA no longer accredited (certificate expired)', 'D3', () => internal(`UPDATE toda SET certificate_expiry = now() - interval '2 days' WHERE toda_id = '${ID.TODA2}'`),
    () => internal(`UPDATE toda SET certificate_expiry = now() + interval '1 year' WHERE toda_id = '${ID.TODA2}'`));
  await never('affiliated TODA suspended', 'D3', () => internal(`UPDATE toda SET toda_status = 'Suspended' WHERE toda_id = '${ID.TODA2}'`),
    () => internal(`UPDATE toda SET toda_status = 'Active' WHERE toda_id = '${ID.TODA2}'`));
  await never('paused bookings', 'D1', () => s.rpc(DRIVERS.D1.uid, 'driver_pause_bookings', [15]), null);
  // Resume: the pause ends at once and the driver is offered bookings again.
  await s.online('D1', 100); await s.online('D2', 1000);
  await s.rpc(DRIVERS.D1.uid, 'driver_pause_bookings', [15]);
  let paused = await s.bookAs('P1');
  check('while paused D1 (the nearest) is skipped', ids(await s.offers(paused.booking_id))[0] === 'D2');
  await s.finish(paused.booking_id);
  await s.rpc(DRIVERS.D1.uid, 'driver_resume_bookings', []);
  paused = await s.bookAs('P1');
  check('after Resume D1 is offered again', ids(await s.offers(paused.booking_id))[0] === 'D1');
  await s.finish(paused.booking_id); await allOffline();
  await never('a driver set Busy', 'D1', () => internal(`UPDATE driver SET availability_status = 'Busy' WHERE driver_id = '${ID.D1}'`), null);
  await allOffline();
  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS12 a driver already on a trip, an offline driver, and a driver holding another offer are skipped');
  await s.online('D1', 100); await s.online('D2', 1000);
  const first = await s.bookAs('P2');
  check('P2\'s booking goes to D1 (nearest)', ids(await s.offers(first.booking_id))[0] === 'D1');
  const second = await s.bookAs('P1');
  check('while D1 holds an unanswered offer for P2, P1\'s booking goes to D2', ids(await s.offers(second.booking_id)).join() === 'D2');
  await s.accept('D1', (await s.pendingOffer(first.booking_id)).attempt_id);
  await s.finish(second.booking_id);
  const third = await s.bookAs('P1');
  check('D1 now on a trip: P1\'s next booking goes to D2, not D1', ids(await s.offers(third.booking_id)).join() === 'D2');
  await s.finish(third.booking_id); await s.finish(first.booking_id);
  await off('D2');
  const fourth = await s.bookAs('P1');
  check('D2 offline: D1 (finished its trip) is offered', ids(await s.offers(fourth.booking_id)).join() === 'D1');
  await reset(fourth);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS13 a cancelled search withdraws its offer (not counted as ignored); a driver who goes Offline loses it');
  await s.online('D1', 300);
  b = await s.bookAs('P1');
  const dBefore = await one(`SELECT unanswered_streak FROM driver_online_session WHERE driver_id='${ID.D1}' AND ended_at IS NULL`);
  await s.cancelAs(ID.P_AUTH, b.booking_id);
  o = await s.offers(b.booking_id);
  const dAfter = await one(`SELECT unanswered_streak FROM driver_online_session WHERE driver_id='${ID.D1}' AND ended_at IS NULL`);
  check('cancelling the booking while it is searching: the open offer is withdrawn (Expired with an answer time = not "unanswered"), the driver\'s ignored-offer count is untouched',
    o[0].response_status === 'Expired' && o[0].responded_at !== null && o[0].unanswered === false && dBefore.unanswered_streak === dAfter.unanswered_streak, o[0]);
  check('cancelling a booking that is still searching is free of any strike', (await s.strikes(ID.P1)).length === 0);
  check('the clocks stopped and the reason is recorded', (await s.booking(b.booking_id)).dispatch_next_action_at === null && (await s.booking(b.booking_id)).dispatch_ended_reason === 'cancelled');
  await s.online('D2', 400);
  b = await s.bookAs('P1');
  check('(a new booking, offered to the nearest)', ids(await s.offers(b.booking_id))[0] === 'D1');
  await off('D1');
  await s.sweep();
  o = await s.offers(b.booking_id);
  check('D1 goes Offline while holding the offer: it is withdrawn and D2 is offered at once', o[0].response_status === 'Expired' && o[0].unanswered === false && ids(o)[1] === 'D2' && o[1].response_status === 'Pending', o);
  await reset(b);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS14 a search that was already running when this was deployed is picked up');
  await s.online('D1', 300);
  b = await s.bookAs('P1');
  await internal(`UPDATE dispatch_attempt SET response_status = 'Expired', responded_at = now() WHERE booking_id = '${b.booking_id}';
                  UPDATE booking SET dispatch_tier = NULL, dispatch_cycle_started_at = NULL, dispatch_tier_started_at = NULL, dispatch_next_action_at = NULL,
                         dispatch_cycle = 1, priority_toda_id = NULL WHERE booking_id = '${b.booking_id}'`);
  await internal(`DELETE FROM dispatch_attempt WHERE booking_id = '${b.booking_id}'`);
  await s.sweep();
  o = await s.offers(b.booking_id);
  check('a Pending booking with none of the new columns set is advanced by the sweep and offered', o.length === 1 && ids(o)[0] === 'D1', o);
  await reset(b);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS15 offers that time out count toward the inactivity rules (Rules 7.6 - 7.8), through the existing single code path');
  await s.online('D1', 300);
  for (let i = 0; i < 3; i++) {
    const x = await s.bookAs('P1');
    await s.expireOffer(x.booking_id);
    await s.finish(x.booking_id);
  }
  const sess = await one(`SELECT unanswered_streak, reminder_sent_at FROM driver_online_session WHERE driver_id='${ID.D1}' AND ended_at IS NULL`);
  check('three unanswered offers: the reminder is due (Rule 7.6)', sess.unanswered_streak === 3 && sess.reminder_sent_at !== null, sess);
  for (let i = 0; i < 2; i++) {
    const x = await s.bookAs('P1');
    await s.expireOffer(x.booking_id);
    await s.finish(x.booking_id);
  }
  check('five unanswered offers: the driver is set Offline automatically, with no strike (Rule 7.7)', (await s.status(ID.D1)) === 'Offline' && (await s.strikes(ID.D1)).length === 0);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
