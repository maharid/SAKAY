// Batch 8 (20261023000001), part 2: every cancellation goes through ONE decision (_cancellation_decision). Rules 10.4, 12.1 - 12.9, 29.8, 15.1 (Vehicle Breakdown),
// decisions PI-02 (the redispatch priority of Rule 12.4), D8-X3 (two counters), D8-X2 / D8-X6 (GPS decides what "arrived" and "travelled" mean), D8-X7 (a Vehicle
// Breakdown strike is provisional), X12 (a shared-trip party cancels: only that party is evaluated). Required tests T1, T2, T4, T5 of the batch prompt.
// The database holds every deadline, so the suite moves the stored timestamps back instead of waiting. Whole migration chain on the local emulator (never Supabase).
const { setup, ID, DRIVERS, attempt, check, summary } = require('../b6fixtures');

(async () => {
  let s = await setup();
  let { q, one, internal, as } = s;
  const off = async (k) => { await s.goOffline(DRIVERS[k].uid); };
  const allOffline = async () => { for (const k of ['D1', 'D2', 'D3']) if ((await s.status(DRIVERS[k].id)) !== 'Offline') await off(k); };
  const reset = async (b) => { if (b) await s.finish(b.booking_id); await allOffline(); };
  const bookAndAccept = async (key = 'D1', pax = 'P1') => {
    const b = await s.bookAs(pax);
    const o = await s.pendingOffer(b.booking_id);
    if (!o || o.driver_id !== DRIVERS[key].id) throw new Error(`expected an offer to ${key}, got ${JSON.stringify(o)}`);
    const r = await s.accept(key, o.attempt_id);
    if (!r.success) throw new Error('accept failed ' + JSON.stringify(r));
    return s.booking(b.booking_id);
  };
  const acceptedAgo = (bookingId, sec) => internal(`UPDATE booking SET accepted_at = clock_timestamp() - interval '${sec} seconds' WHERE booking_id = '${bookingId}'`);
  const staleFix = (key, sec) => internal(`UPDATE driver SET last_location_update = last_location_update - interval '${sec} seconds' WHERE driver_id = '${DRIVERS[key].id}'`);
  const clearStrikes = () => internal(`UPDATE strikes_ledger SET status = 'VOIDED', points_active = 0`);
  const flags = (type, subjectId) => q(`SELECT flag_type, source_rule, assigned_role, status FROM admin_review_flag WHERE flag_type = '${type}' AND subject_id = '${subjectId}' AND status IN ('Open','Under Review')`);
  const ledger = (id) => q(`SELECT violation_code, status, points_active, provisional_until, details FROM strikes_ledger WHERE subject_id = '${id}' AND status <> 'VOIDED' ORDER BY issued_at`);
  const decision = async (bookingId, actor, reason = null) => (await one(`SELECT public._cancellation_decision(b, '${actor}', ${reason ? `'${reason}'` : 'NULL'}) AS d FROM booking b WHERE b.booking_id = '${bookingId}'`)).d;
  const near = (v, lo, hi) => typeof v === 'number' && v >= lo && v <= hi;
  const P1 = ID.P_AUTH;

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('S1 Rules 12.1 / 12.2 / 29.8 (T1): the passenger cancels - before acceptance, at 59 s, at 61 s, after Arrived, and by GPS rather than by taps');
  await s.online('D1', 300);
  let b = await s.bookAs('P1');
  await s.cancelAs(P1, b.booking_id);
  check('before any driver accepts: no strike', (await ledger(ID.P1)).length === 0);
  await allOffline(); await s.online('D1', 300);

  b = await bookAndAccept('D1', 'P1'); await acceptedAgo(b.booking_id, 59);
  await s.cancelAs(P1, b.booking_id);
  check('59 seconds after the acceptance: no strike (Rule 12.1)', (await ledger(ID.P1)).length === 0, await ledger(ID.P1));
  await reset(null); await s.online('D1', 300);

  b = await bookAndAccept('D1', 'P1'); await acceptedAgo(b.booking_id, 61);
  await s.cancelAs(P1, b.booking_id);
  let st = await ledger(ID.P1);
  check('61 seconds after the acceptance: one strike, PAX_LATE_CANCEL (Rule 12.2)', st.length === 1 && st[0].violation_code === 'PAX_LATE_CANCEL' && st[0].points_active === 1, st);
  await clearStrikes(); await reset(null); await s.online('D1', 300);

  b = await bookAndAccept('D1', 'P1');
  await s.driverSets('D1', b.booking_id, 'In Transit'); await s.driverSets('D1', b.booking_id, 'Driver Arrived');
  await s.cancelAs(P1, b.booking_id);
  st = await ledger(ID.P1);
  check('once the driver has arrived, even inside the first minute: one strike', st.length === 1 && st[0].violation_code === 'PAX_LATE_CANCEL' && st[0].details.arrived_by_gps === true, st);
  await clearStrikes(); await reset(null); await s.online('D1', 300);

  b = await bookAndAccept('D1', 'P1');
  await s.moveTo('D1', 10, 10);                         // standing at the pickup, 10 s after accepting, and has NOT tapped Arrived (the status is still "Accepted")
  await acceptedAgo(b.booking_id, 10);
  check('the driver is at the pickup by GPS but has tapped nothing', (await s.booking(b.booking_id)).booking_status === 'Accepted');
  await s.cancelAs(P1, b.booking_id);
  st = await ledger(ID.P1);
  check('29.8: the passenger cancels inside the grace minute, but the driver is physically at the pickup: one strike (GPS, not taps)', st.length === 1 && st[0].violation_code === 'PAX_LATE_CANCEL' && st[0].details.arrived_by_gps === true, st);
  await clearStrikes(); await reset(null); await s.online('D1', 300);

  b = await bookAndAccept('D1', 'P1'); await acceptedAgo(b.booking_id, 10);
  await s.cancelAs(P1, b.booking_id);
  check('contrast: the same cancel with the driver 300 m away: no strike', (await ledger(ID.P1)).length === 0);
  await reset(null); await s.online('D1', 300);

  b = await bookAndAccept('D1', 'P1'); await acceptedAgo(b.booking_id, 90);
  await internal(`UPDATE booking SET driver_unreachable_since = clock_timestamp() WHERE booking_id = '${b.booking_id}'`);
  await s.cancelAs(P1, b.booking_id);
  check('while the driver is unreachable a late cancel is not struck (decision D7-6), and the decision is audited',
    (await ledger(ID.P1)).length === 0 && (await q(`SELECT 1 FROM audit_log WHERE action_type = 'PASSENGER_CANCEL_NO_STRIKE_DRIVER_UNREACHABLE' AND target_id = '${b.booking_id}'`)).length === 1);
  await reset(null);

  console.log('\n   W11: a declared pause of strike accrual is honoured by the passenger\'s late-cancellation strike');
  await internal(`UPDATE system_policy_config SET config_value = '{"paused": true, "scope": "ALL", "pause_id": "9d000000-0000-0000-0000-000000000001", "reason": "test calamity"}'::jsonb WHERE config_key = 'strike_accrual_paused'`);
  await s.online('D1', 300);
  b = await bookAndAccept('D1', 'P1'); await acceptedAgo(b.booking_id, 90);
  await s.cancelAs(P1, b.booking_id);
  st = await q(`SELECT status, points_active FROM strikes_ledger WHERE subject_id = '${ID.P1}' AND violation_code = 'PAX_LATE_CANCEL' AND status <> 'VOIDED'`);
  check('during a pause the late cancel is recorded as AUTO_WAIVED with no points', st.length === 1 && st[0].status === 'AUTO_WAIVED' && st[0].points_active === 0, st);
  await internal(`UPDATE system_policy_config SET config_value = '{"paused": false}'::jsonb WHERE config_key = 'strike_accrual_paused'`);
  await clearStrikes(); await reset(null);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS2 Rules 12.3 / 12.4 / 29.8 (T2): the driver cancels - net GPS progress toward the pickup, less the error of both fixes, decides the strike');
  const driverCancelAt = async (accNow, fromM, toM, accStart = 15, reason = 'personal_emergency') => {
    await s.online('D1', fromM, accStart);
    const bk = await bookAndAccept('D1', 'P1');
    await s.moveTo('D1', toM, accNow);
    const out = await s.driverCancel('D1', bk.booking_id, reason);
    return { bk, out };
  };
  let t = await driverCancelAt(15, 300, 270);
  check('30 m of progress: 1 strike, DRV_CANCEL_BEFORE_TRAVEL (Rule 12.3), no priority', t.out.success === true && t.out.strike_code === 'DRV_CANCEL_BEFORE_TRAVEL' && t.out.en_route === false && t.out.priority === false && (await ledger(ID.D1)).map((x) => `${x.violation_code}:${x.points_active}`).join() === 'DRV_CANCEL_BEFORE_TRAVEL:1', t.out);
  check('...and the booking is NOT marked for priority', (await s.booking(t.bk.booking_id)).redispatch_priority_at === null);
  await clearStrikes(); await reset(await s.booking(t.bk.booking_id));

  t = await driverCancelAt(5, 300, 220, 5);
  check('80 m of progress on fixes with 5 m of error: 2 strikes, DRV_CANCEL_EN_ROUTE (Rule 12.4), redispatched WITH PRIORITY', t.out.success === true && t.out.strike_code === 'DRV_CANCEL_EN_ROUTE' && t.out.en_route === true && t.out.priority === true
    && (await ledger(ID.D1)).map((x) => `${x.violation_code}:${x.points_active}`).join() === 'DRV_CANCEL_EN_ROUTE:2', t.out);
  let cur = await s.booking(t.bk.booking_id);
  check('the booking is back in the search, Pending, with the priority marker and no driver', cur.booking_status === 'Pending' && cur.driver_id === null && cur.redispatch_priority_at !== null, cur);
  check('the priority is audited', (await q(`SELECT 1 FROM audit_log WHERE action_type = 'BOOKING_REDISPATCH_PRIORITY' AND target_id = '${t.bk.booking_id}'`)).length === 1);
  await clearStrikes(); await reset(cur);

  console.log('   the boundary: the progress is measured after both fixes\' error (15 m + 15 m) is taken off');
  t = await driverCancelAt(15, 300, 221);
  check('79 m of progress less 30 m of error = 49 m: before travel (1 strike)', t.out.strike_code === 'DRV_CANCEL_BEFORE_TRAVEL', t.out);
  await clearStrikes(); await reset(await s.booking(t.bk.booking_id));
  t = await driverCancelAt(15, 300, 219);
  check('81 m of progress less 30 m of error = 51 m: en route (2 strikes)', t.out.strike_code === 'DRV_CANCEL_EN_ROUTE', t.out);
  await clearStrikes(); await reset(await s.booking(t.bk.booking_id));

  console.log('   29.8: tapping Arrived is not travelling');
  await s.online('D1', 30, 5);                                 // he accepts 30 m from the pickup
  b = await bookAndAccept('D1', 'P1');
  await s.driverSets('D1', b.booking_id, 'In Transit'); await s.driverSets('D1', b.booking_id, 'Driver Arrived');   // (the helper puts him 5 m from the pickup, 10 m of error)
  let out = await s.driverCancel('D1', b.booking_id, 'passenger_unreachable');
  check('he accepted 30 m away, arrived, and cancels: he travelled 25 m (15 after the error) - 1 strike, not 2', out.strike_code === 'DRV_CANCEL_BEFORE_TRAVEL' && out.en_route === false, out);
  await clearStrikes(); await reset(await s.booking(b.booking_id));
  await s.online('D1', 300);
  b = await bookAndAccept('D1', 'P1');
  await s.driverSets('D1', b.booking_id, 'In Transit'); await s.driverSets('D1', b.booking_id, 'Driver Arrived');
  out = await s.driverCancel('D1', b.booking_id, 'passenger_unreachable');
  check('he came 300 m, arrived and cancels: 2 strikes (he really travelled)', out.strike_code === 'DRV_CANCEL_EN_ROUTE' && out.en_route === true, out);
  await clearStrikes(); await reset(await s.booking(b.booking_id));
  await s.online('D1', 300);
  b = await bookAndAccept('D1', 'P1');
  await s.moveTo('D1', 150, 15); await staleFix('D1', 60);
  out = await s.driverCancel('D1', b.booking_id);
  check('a position a minute old proves no progress (the lesser strike)', out.strike_code === 'DRV_CANCEL_BEFORE_TRAVEL', out);
  await clearStrikes(); await reset(await s.booking(b.booking_id));

  console.log('   a U-turn: away and back does not count as travel');
  await s.online('D1', 300);
  b = await bookAndAccept('D1', 'P1');
  await s.moveTo('D1', 500, 10); await s.moveTo('D1', 290, 10);
  out = await s.driverCancel('D1', b.booking_id);
  check('he drove 200 m away and 210 m back: net 10 m toward the pickup - 1 strike', out.strike_code === 'DRV_CANCEL_BEFORE_TRAVEL', out);
  await clearStrikes(); await reset(await s.booking(b.booking_id));

  console.log('   Rule 15.1: a Vehicle Breakdown strike is PROVISIONAL (the TODA Administrator may waive it within 48 hours)');
  t = await driverCancelAt(5, 300, 220, 5, 'vehicle_breakdown');
  let lg = await ledger(ID.D1);
  const hours = lg[0] && lg[0].provisional_until ? (new Date(lg[0].provisional_until).getTime() - Date.now()) / 3600000 : null;
  check('the strike is PROVISIONAL, with a 48-hour waiver window, and the answer says so', t.out.provisional === true && lg.length === 1 && lg[0].status === 'PROVISIONAL' && lg[0].points_active === 2 && near(hours, 47.5, 48.1), { out: t.out, lg });
  await clearStrikes(); await reset(await s.booking(t.bk.booking_id));
  t = await driverCancelAt(5, 300, 220, 5, 'road_closure_or_traffic');
  lg = await ledger(ID.D1);
  check('any other reason is an ordinary (ACTIVE) strike', lg.length === 1 && lg[0].status === 'ACTIVE', lg);
  await clearStrikes(); await reset(await s.booking(t.bk.booking_id));
  const badReason = await s.driverCancel('D1', b.booking_id, 'bored');
  check('a reason outside the list is refused', badReason.success === false && badReason.error_code === 'ERR_CANCEL_REASON_REQUIRED', badReason);

  console.log('   W11: a declared pause is honoured by the driver\'s strike as well');
  await internal(`UPDATE system_policy_config SET config_value = '{"paused": true, "scope": "CANCEL_STALL_NOSHOW", "pause_id": "9d000000-0000-0000-0000-000000000002", "reason": "test calamity"}'::jsonb WHERE config_key = 'strike_accrual_paused'`);
  t = await driverCancelAt(5, 300, 220, 5);
  lg = await q(`SELECT status, points_active FROM strikes_ledger WHERE subject_id = '${ID.D1}' AND status <> 'VOIDED'`);
  check('during a pause the cancellation is recorded as AUTO_WAIVED with no points', lg.length === 1 && lg[0].status === 'AUTO_WAIVED' && lg[0].points_active === 0, lg);
  await internal(`UPDATE system_policy_config SET config_value = '{"paused": false}'::jsonb WHERE config_key = 'strike_accrual_paused'`);
  await clearStrikes(); await reset(await s.booking(t.bk.booking_id));

  console.log('\nS2b Rule 12.4 / PI-02: a booking redispatched with priority is served before the others that are due; the marker ends with the search');
  const contest = async (marked) => {
    await clearStrikes();
    await s.online('D1', 300, 5);
    const b1 = await bookAndAccept('D1', 'P1');                      // P1's booking: D1 takes it
    const b2 = await s.bookAs('P2');                                 // P2's booking: nobody is free (D1 is busy), so it waits
    await s.moveTo('D1', 220, 5);
    const c = await s.driverCancel('D1', b1.booking_id, 'personal_emergency');
    if (!marked) await internal(`UPDATE booking SET redispatch_priority_at = NULL WHERE booking_id = '${b1.booking_id}'`);
    await off('D1');                                                 // D1 is out of the picture: only D2 will compete
    // both are due; the one that was waiting first (P2's) is the one the sweep would take first, unless the other is marked
    await internal(`UPDATE booking SET dispatch_next_action_at = clock_timestamp() - interval '60 seconds' WHERE booking_id = '${b2.booking_id}'`);
    await internal(`UPDATE booking SET dispatch_next_action_at = clock_timestamp() - interval '5 seconds' WHERE booking_id = '${b1.booking_id}'`);
    await s.online('D2', 300, 5);
    await s.sweep();
    const o1 = await s.pendingOffer(b1.booking_id);
    const o2 = await s.pendingOffer(b2.booking_id);
    return { b1, b2, c, o1, o2 };
  };
  let ct = await contest(true);
  check('D1 cancelled en route: the booking was marked and nobody else was online', ct.c.priority === true && (await s.booking(ct.b1.booking_id)).redispatch_priority_at !== null);
  check('D2 comes Online with two bookings due (P2\'s older, P1\'s marked): the marked one gets D2\'s offer', !!ct.o1 && ct.o1.driver_id === ID.D2 && !ct.o2, { o1: ct.o1 && ct.o1.driver_id, o2: ct.o2 && ct.o2.driver_id });
  const acc = await s.accept('D2', ct.o1.attempt_id);
  check('and when a driver accepts it, the marker is cleared', acc.success === true && (await s.booking(ct.b1.booking_id)).redispatch_priority_at === null, acc);
  await reset(await s.booking(ct.b1.booking_id)); await s.finish(ct.b2.booking_id);
  ct = await contest(false);
  check('control: the same situation WITHOUT the marker serves the booking that waited longest (P2\'s) - so the check above can fail', !!ct.o2 && ct.o2.driver_id === ID.D2 && !ct.o1, { o1: ct.o1 && ct.o1.driver_id, o2: ct.o2 && ct.o2.driver_id });
  await reset(null); await s.finish(ct.b1.booking_id); await s.finish(ct.b2.booking_id);
  ct = await contest(true);
  await s.cancelAs(P1, ct.b1.booking_id);
  check('a marked booking that the passenger cancels loses the marker', (await s.booking(ct.b1.booking_id)).redispatch_priority_at === null);
  await reset(null); await s.finish(ct.b2.booking_id);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS3 Rule 12.6 (T4): system cancellations never strike the passenger');
  await clearStrikes();
  await s.online('D1', 300);
  b = await bookAndAccept('D1', 'P1');
  for (const [actor, strikeSubject] of [['system', null], ['passenger', null], ['no_show', 'passenger']]) {
    const dcs = await decision(b.booking_id, actor);
    check(`the decision for actor "${actor}" on a booking in its first minute names ${strikeSubject ? 'the ' + strikeSubject : 'nobody'} for a strike`, (dcs.strike_subject ?? null) === strikeSubject, dcs);
  }
  const dsys = await decision(b.booking_id, 'system');
  check('a system cancellation is redispatched and carries no priority', dsys.redispatch === true && dsys.priority === false, dsys);
  const dns = await decision(b.booking_id, 'no_show');
  check('a no-show: PAX_NO_SHOW, the driver gets the credit, the booking is not redispatched', dns.violation_code === 'PAX_NO_SHOW' && dns.driver_credit === true && dns.redispatch === false, dns);
  await internal(`UPDATE booking SET accepted_at = accepted_at - interval '200 seconds', stall_anchor_at = stall_anchor_at - interval '200 seconds' WHERE booking_id = '${b.booking_id}'`);
  await s.moveTo('D1', 300, 15); await s.sweep();
  cur = await s.booking(b.booking_id);
  check('a stall (Rule 8.3): the driver is struck and replaced, the passenger is not', cur.driver_id === null && (await ledger(ID.D1)).some((x) => x.violation_code === 'DRV_STALL') && (await ledger(ID.P1)).length === 0, { cur: cur.booking_status, p: await ledger(ID.P1) });
  await reset(cur);
  await clearStrikes(); await s.online('D1', 300);
  b = await bookAndAccept('D1', 'P1');
  await internal(`UPDATE driver SET last_location_update = last_location_update - interval '320 seconds' WHERE driver_id = '${ID.D1}';
                  UPDATE booking SET accepted_at = accepted_at - interval '320 seconds', stall_anchor_at = stall_anchor_at - interval '320 seconds' WHERE booking_id = '${b.booking_id}'`);
  await s.sweep();
  cur = await s.booking(b.booking_id);
  check('connectivity loss (Rule 9.3): the driver gets the provisional strike, the passenger none', cur.driver_id === null && (await ledger(ID.D1)).some((x) => x.violation_code === 'DRV_CONNECTIVITY_FAILURE') && (await ledger(ID.P1)).length === 0);
  await reset(cur);
  await clearStrikes(); await s.online('D1', 300);
  b = await s.bookAs('P1');
  await internal(`UPDATE booking SET booking_status = 'No Driver Found', dispatch_ended_reason = 'no_driver_found' WHERE booking_id = '${b.booking_id}'`);
  await s.cancelAs(P1, b.booking_id);
  check('No Driver Found (Rule 7.4): the passenger leaves without a strike', (await ledger(ID.P1)).length === 0);
  await reset(null);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS4 Rules 12.4 / 12.7 / 12.9 (decision X3): two counters, one for 12.7 and one for 12.9, in a rolling 24 hours');
  await s.db.close();
  s = await setup();
  ({ q, one, internal, as } = s);
  const book3 = async (pax, uid, n, { completeAfterFirst = false } = {}) => {
    for (let i = 0; i < n; i++) {
      await allOffline(); await s.online('D1', 300);
      const bk = await s.bookAs(pax);
      await s.cancelAs(uid, bk.booking_id);
      if (completeAfterFirst && i === 0) {
        await s.online('D1', 300);
        const done = await bookAndAccept('D1', pax);
        await internal(`UPDATE booking SET booking_status = 'Completed', trip_completed_at = clock_timestamp() WHERE booking_id = '${done.booking_id}'`);
      }
    }
    await allOffline();
  };
  await book3('P1', ID.P_AUTH, 3, { completeAfterFirst: true });
  check('P1 cancelled three bookings in a day with a completed trip in between: the 12.7 flag is raised', (await flags('PASSENGER_REPEATED_CANCELLATIONS', ID.P1)).length === 1, await flags('PASSENGER_REPEATED_CANCELLATIONS', ID.P1));
  check('...and the 12.9 flag (no completed trip between) is NOT', (await flags('PASSENGER_BOOKING_ABUSE_REVIEW', ID.P1)).length === 0);
  check('both flags go to the LGU Administrator, and the passenger is not struck for them', (await flags('PASSENGER_REPEATED_CANCELLATIONS', ID.P1))[0].assigned_role === 'lgu_admin' && (await ledger(ID.P1)).length === 0);
  await book3('P2', ID.P2_AUTH, 2);
  check('P2: two cancellations are not enough for either', (await flags('PASSENGER_REPEATED_CANCELLATIONS', ID.P2)).length === 0 && (await flags('PASSENGER_BOOKING_ABUSE_REVIEW', ID.P2)).length === 0);
  await allOffline(); await s.online('D1', 300);
  b = await s.bookAs('P2');
  await internal(`UPDATE booking SET booking_status = 'No Driver Found', dispatch_ended_reason = 'no_driver_found' WHERE booking_id = '${b.booking_id}'`);
  await s.cancelAs(ID.P2_AUTH, b.booking_id);
  check('leaving a No Driver Found booking is not a cancellation of his: still no flag', (await flags('PASSENGER_REPEATED_CANCELLATIONS', ID.P2)).length === 0);
  await allOffline(); await s.online('D1', 300);
  b = await s.bookAs('P2'); await s.cancelAs(ID.P2_AUTH, b.booking_id);
  check('P2\'s third cancellation with no trip at all: BOTH flags (12.7 and 12.9)', (await flags('PASSENGER_REPEATED_CANCELLATIONS', ID.P2)).length === 1 && (await flags('PASSENGER_BOOKING_ABUSE_REVIEW', ID.P2)).length === 1);
  const abuse = (await flags('PASSENGER_BOOKING_ABUSE_REVIEW', ID.P2))[0];
  check('the 12.9 flag names the rule and goes to the LGU Administrator, who decides (nothing is restricted by itself)', abuse.assigned_role === 'lgu_admin' && /12\.9/.test(abuse.source_rule) && (await ledger(ID.P2)).length === 0 && (await one(`SELECT account_status FROM passenger WHERE passenger_id = '${ID.P2}'`)).account_status === 'Active', abuse);
  await allOffline();

  console.log('   the driver: a first en-route cancellation is not flagged, a second is (12.4); three cancellations in a day are flagged (12.7)');
  await clearStrikes();
  let dt1 = await driverCancelAt(5, 300, 220, 5);
  check('first en-route cancellation: no review flag', (await flags('DRIVER_REPEATED_CANCELLATIONS', ID.D1)).length === 0);
  await s.finish(dt1.bk.booking_id); await allOffline();
  let dt2 = await driverCancelAt(5, 300, 220, 5);
  const f4 = await flags('DRIVER_REPEATED_CANCELLATIONS', ID.D1);
  check('second en-route cancellation: the TODA is asked to review (Rule 12.4)', f4.length === 1 && f4[0].assigned_role === 'toda_admin' && /12\.4/.test(f4[0].source_rule), f4);
  await s.finish(dt2.bk.booking_id); await allOffline();
  await s.online('D2', 300, 5);
  for (let i = 0; i < 2; i++) {
    const bk = await bookAndAccept('D2', 'P1'); await s.driverCancel('D2', bk.booking_id, 'personal_emergency'); await s.finish(bk.booking_id);
  }
  check('two cancellations before travel: no flag for D2 yet', (await flags('DRIVER_REPEATED_CANCELLATIONS', ID.D2)).length === 0);
  const bk3 = await bookAndAccept('D2', 'P1'); await s.driverCancel('D2', bk3.booking_id, 'personal_emergency'); await s.finish(bk3.booking_id);
  const f7 = await flags('DRIVER_REPEATED_CANCELLATIONS', ID.D2);
  check('the third in a day raises the review flag (Rule 12.7), whatever the reasons', f7.length === 1 && /12\.7/.test(f7[0].source_rule), f7);
  await allOffline();

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS5 Rule 12.5 (T5): one party of a matched Shared Trip cancels before pickup - only that party is evaluated, the other continues at the Solo fare');
  await clearStrikes();
  const shared = async (km = 3.3) => {
    const x = await s.book(s.PAX.P1.uid, ID.P1, { km, shared: true });
    const y = await s.book(s.PAX.P2.uid, ID.P2, { km, shared: true });
    const m = await one(`INSERT INTO shared_trip_match (primary_booking_id, additional_booking_id, match_status, matched_at) VALUES ('${x.booking_id}', '${y.booking_id}', 'Matched', now()) RETURNING match_id`);
    await internal(`UPDATE booking SET shared_trip_match_id = '${m.match_id}' WHERE booking_id IN ('${x.booking_id}', '${y.booking_id}')`);
    return { x, y, m };
  };
  const finishTrip = async (bookingId, driverKey) => {
    await s.assign(bookingId, DRIVERS[driverKey].id);
    return s.setStatus(DRIVERS[driverKey].uid, bookingId, 'Arrived at Destination');
  };
  // control: nobody cancels, so the pairing stands and the fare basis is the matched one
  await s.online('D1', 300);
  let sh = await shared();
  const ctl = await finishTrip(sh.y.booking_id, 'D1');
  check('control: with the pairing intact, the remaining booking is billed on the matched basis', ctl.fare_breakdown && ctl.fare_breakdown.final && ctl.fare_breakdown.final.basis === 'matched_estimate_pending_segments', ctl.fare_breakdown && ctl.fare_breakdown.final);
  await internal(`UPDATE booking SET booking_status = 'Completed', trip_completed_at = clock_timestamp() WHERE booking_id IN ('${sh.x.booking_id}', '${sh.y.booking_id}')`);
  await allOffline();

  // P1 cancels inside the first minute of an assignment (no strike), P2's booking continues
  sh = await shared();
  await s.assign(sh.x.booking_id, ID.D2);
  await s.cancelAs(P1, sh.x.booking_id);
  check('the cancelling party (P1) is evaluated alone under 12.1: inside the grace minute, no strike', (await ledger(ID.P1)).length === 0 && (await s.booking(sh.x.booking_id)).booking_status === 'Cancelled');
  check('the other party (P2) is not struck and his booking is untouched', (await ledger(ID.P2)).length === 0 && ['Pending', 'Searching Driver'].includes((await s.booking(sh.y.booking_id)).booking_status));
  check('the pairing is closed (Cancelled) and audited', (await one(`SELECT match_status FROM shared_trip_match WHERE match_id = '${sh.m.match_id}'`)).match_status === 'Cancelled'
    && (await q(`SELECT 1 FROM audit_log WHERE action_type = 'SHARED_MATCH_CLOSED_ON_CANCEL' AND target_id = '${sh.m.match_id}'`)).length === 1);
  const note = await q(`SELECT title, message FROM notification WHERE recipient_id = '${ID.P2}' AND notification_type = 'SHARED_PARTNER_CANCELLED'`);
  check('the remaining passenger is told: the trip continues, charged the Solo fare he already accepted, nothing to confirm', note.length === 1 && /Solo fare/.test(note[0].message) && /do not need to confirm/.test(note[0].message), note);
  await allOffline(); await s.online('D1', 300);
  const ended = await finishTrip(sh.y.booking_id, 'D1');
  const soloFare = Number((await s.fare(3.3, 'Solo', 1)).solo_fare ?? (await s.fare(3.3, 'Solo', 1)).estimated_fare);
  check('the remaining booking is finally billed as an UNMATCHED SOLO trip, without any new fare confirmation', ended.fare_breakdown.final.basis === 'unmatched_solo' && Number(ended.actual_fare) === soloFare, { basis: ended.fare_breakdown.final, actual: ended.actual_fare, soloFare });
  await internal(`UPDATE booking SET booking_status = 'Completed', trip_completed_at = clock_timestamp() WHERE booking_id = '${sh.y.booking_id}'`);
  await clearStrikes(); await allOffline();

  // P2 cancels late (after the grace minute): only P2 is struck, once
  sh = await shared();
  await s.assign(sh.y.booking_id, ID.D2); await acceptedAgo(sh.y.booking_id, 90);
  await s.cancelAs(ID.P2_AUTH, sh.y.booking_id);
  check('the cancelling party (P2) cancels 90 s after the assignment: ONE strike, for him only', (await ledger(ID.P2)).length === 1 && (await ledger(ID.P2))[0].violation_code === 'PAX_LATE_CANCEL' && (await ledger(ID.P1)).length === 0);
  check('P1\'s booking continues and its pairing is closed', ['Pending', 'Searching Driver'].includes((await s.booking(sh.x.booking_id)).booking_status) && (await one(`SELECT match_status FROM shared_trip_match WHERE match_id = '${sh.m.match_id}'`)).match_status === 'Cancelled');
  await clearStrikes(); await reset(null); await s.finish(sh.x.booking_id);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
