// Batch 7: failure to proceed, mid-booking unavailability, GPS staleness and connectivity (Rules 8.2-8.7, 9.2-9.6, 17.3, 17.5, 17.9, 29.2, 29.10, 29.11).
// Batch 6 built the clocks (booking-timers.js proves the 2 / 3 / 5 minute rules, the 3 / 5 minute silence and the 30-minute flag); this suite proves what
// Batch 7 adds: the two-sided jitter filter, the 4-minute warning and the stored delay reason, the record of every silence (trip_connectivity_event),
// the driver's re-confirmation before fare finalisation, the manual reconciliation by the TODA Administrator, the deliberate-offline and route-deviation
// violations, the passenger's no-strike cancel while the driver is unreachable, the area escalation (17.5) and the live position with its server age (17.9).
// The database holds every deadline, so the suite moves the stored timestamps back instead of waiting. Whole migration chain on the local emulator.
const fs = require('fs');
const path = require('path');
const { setup, ID, DRIVERS, attempt, check, summary } = require('../b6fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, as, svc } = s;
  const off = async (k) => { await s.goOffline(DRIVERS[k].uid); };
  const allOffline = async () => { for (const k of ['D1', 'D2', 'D3']) if ((await s.status(DRIVERS[k].id)) !== 'Offline') await off(k); };
  const reset = async (b) => { if (b) await s.finish(b.booking_id); await s.sweep(); await allOffline(); };
  const driverSets = (key, bookingId, status) =>
    attempt(() => as(DRIVERS[key].uid, (tx) => tx.query(`UPDATE booking SET booking_status=$2 WHERE booking_id=$1 RETURNING *`, [bookingId, status])));
  const paxSets = (pax, bookingId, status) =>
    attempt(() => as(s.PAX[pax].uid, (tx) => tx.query(`UPDATE booking SET booking_status=$2 WHERE booking_id=$1 RETURNING *`, [bookingId, status])));
  const bookAndAccept = async (key = 'D1', pax = 'P1') => {
    const b = await s.bookAs(pax);
    const o = await s.pendingOffer(b.booking_id);
    if (!o || o.driver_id !== DRIVERS[key].id) throw new Error(`expected an offer to ${key}, got ${JSON.stringify(o)}`);
    const r = await s.accept(key, o.attempt_id);
    if (!r.success) throw new Error('accept failed ' + JSON.stringify(r));
    return s.booking(b.booking_id);
  };
  const age = (bookingId, sec) => internal(`
    UPDATE booking SET accepted_at = accepted_at - interval '${sec} seconds',
        stall_anchor_at = stall_anchor_at - interval '${sec} seconds',
        arrived_at = arrived_at - interval '${sec} seconds',
        stall_delay_reported_at = stall_delay_reported_at - interval '${sec} seconds',
        driver_unreachable_since = driver_unreachable_since - interval '${sec} seconds'
      WHERE booking_id = '${bookingId}'`);
  const silence = (key, sec) => internal(`
    UPDATE driver SET last_location_update = last_location_update - interval '${sec} seconds' WHERE driver_id = '${DRIVERS[key].id}';
    UPDATE booking SET accepted_at = accepted_at - interval '${sec} seconds', stall_anchor_at = stall_anchor_at - interval '${sec} seconds'
      WHERE driver_id = '${DRIVERS[key].id}' AND booking_status NOT IN ('Cancelled', 'Completed')`);
  const notes = (recipient, type) => q(`SELECT title, message, subject_id FROM notification WHERE recipient_id = '${recipient}' AND notification_type = '${type}' ORDER BY sent_at`);
  const rpc = (key, sql, args) => s.rpcAs(DRIVERS[key].uid, sql, args);
  const paxRpc = (pax, sql, args) => s.rpcAs(s.PAX[pax].uid, sql, args);
  const adminRpc = (uid, sql, args) => attempt(() => s.rpcAs(uid, sql, args));
  const events = (bookingId) => q(`SELECT * FROM trip_connectivity_event WHERE booking_id='${bookingId}' ORDER BY started_at`);
  const strikeRows = (id, code) => q(`SELECT violation_code, status, points_active, issued_by_role FROM strikes_ledger WHERE subject_id='${id}' AND violation_code='${code}' AND status <> 'VOIDED'`);
  const clearStrikes = () => internal(`UPDATE strikes_ledger SET status = 'VOIDED', points_active = 0`);
  const auditRows = (action, target) => q(`SELECT * FROM audit_log WHERE action_type='${action}' AND target_id='${target}'`);
  // A trip that has started: the driver is at the pickup, arrives, the passenger boards.
  const startTrip = async (key = 'D1', pax = 'P1') => {
    const b = await bookAndAccept(key, pax);
    await s.moveTo(key, 5, 10);
    await driverSets(key, b.booking_id, 'In Transit'); await driverSets(key, b.booking_id, 'Driver Arrived');
    await s.moveTo(key, 5, 10);
    const t = await driverSets(key, b.booking_id, 'Trip Ongoing');
    if (!t.ok) throw new Error('trip did not start: ' + t.error);
    return s.booking(b.booking_id);
  };
  const A = { toda1: ID.T_AUTH, toda2: ID.T2_AUTH, lgu: ID.L_AUTH };

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('S1 decision D7-8: the stall movement subtracts the error of BOTH fixes');
  await s.online('D1', 300, 25); await s.online('D2', 600);
  let b = await bookAndAccept('D1', 'P1');
  check('the stall anchor remembers the accuracy of the fix it is made of (25 m)', b.stall_anchor_accuracy_m === 25, b.stall_anchor_accuracy_m);
  await age(b.booking_id, 100);
  await s.moveTo('D1', 260, 10); await s.sweep();                      // 40 m closer, the new fix is good (10 m): one-sided 30 m, two-sided 5 m
  let cur = await s.booking(b.booking_id);
  check('40 m between a 25 m fix and a 10 m fix is inside their combined error: NOT movement (the anchor stays; a one-sided filter would have moved it)',
    new Date(cur.stall_anchor_at).getTime() === new Date(b.stall_anchor_at).getTime() - 100000 && cur.driver_id === ID.D1, { anchor: cur.stall_anchor_at, was: b.stall_anchor_at });
  await s.moveTo('D1', 230, 10); await s.sweep();                      // 70 m from the anchor: 70 - 25 - 10 = 35 m
  cur = await s.booking(b.booking_id);
  check('70 m is movement (70 - 25 - 10 = 35 m): the anchor moves, now on the new fix (accuracy 10 m)', new Date(cur.stall_anchor_at) > new Date(b.accepted_at) && cur.stall_anchor_accuracy_m === 10, cur.stall_anchor_accuracy_m);
  for (const [col, val] of [['stall_anchor_accuracy_m', '1'], ['stall_delay_reason', `'traffic'`]]) {
    const rp = await attempt(() => as(s.PAX.P1.uid, (tx) => tx.query(`UPDATE booking SET ${col} = ${val} WHERE booking_id=$1`, [b.booking_id])));
    const rd = await attempt(() => as(DRIVERS.D1.uid, (tx) => tx.query(`UPDATE booking SET ${col} = ${val} WHERE booking_id=$1`, [b.booking_id])));
    check(`neither the passenger nor the driver can write ${col}`, !rp.ok && /ERR_DISPATCH_LOCKED/.test(rp.error) && !rd.ok && /ERR_DISPATCH_LOCKED/.test(rd.error), { rp: rp.error, rd: rd.error });
  }
  await reset(cur);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS2 decision D7-7 and Rule 8.4: a warning at 4 minutes of standing still on the way; the reported delay is kept and audited');
  await s.online('D1', 300); await s.online('D2', 600);
  await clearStrikes();
  b = await bookAndAccept('D1', 'P1');
  await s.moveTo('D1', 200); await s.sweep();                         // he sets off (100 m)
  await age(b.booking_id, 235); await s.moveTo('D1', 200); await s.sweep();
  check('after 235 s of standing still on the way there is no warning yet', (await s.booking(b.booking_id)).stall_warned_at === null);
  await age(b.booking_id, 10); await s.moveTo('D1', 200); await s.sweep();
  cur = await s.booking(b.booking_id);
  check('after 4 minutes (245 s) he is warned, and the booking is still his', cur.stall_warned_at !== null && cur.driver_id === ID.D1 && cur.booking_status === 'Accepted', cur);
  let w = (await notes(ID.D1, 'STALL_WARNING')).filter((n) => n.subject_id === b.booking_id);
  check('the warning is the Rule 8.2 text', w.length === 1 && /You have not started traveling toward the passenger\. Please proceed or cancel the booking\./.test(w[0].message), w);
  await s.sweep(); await s.sweep();
  check('the sweep repeating does not warn twice', (await notes(ID.D1, 'STALL_WARNING')).filter((n) => n.subject_id === b.booking_id).length === 1);
  const rep = await rpc('D1', 'public.driver_report_delay($1, $2)', [b.booking_id, 'road_closure']);
  cur = await s.booking(b.booking_id);
  check('reporting a road closure restarts the five minutes, withdraws the warning and KEEPS the reason',
    rep.success === true && rep.reason === 'road_closure' && cur.stall_warned_at === null && cur.stall_delay_reason === 'road_closure' && cur.stall_delay_reports === 1, { rep, cur });
  const au = await auditRows('DRIVER_DELAY_REPORTED', b.booking_id);
  check('an audit row records who reported what (reason, report number)', au.length === 1 && au[0].after_state.reason === 'road_closure' && au[0].after_state.report_number === 1 && au[0].actor_role === 'driver', au);
  await age(b.booking_id, 245); await s.moveTo('D1', 200); await s.sweep();
  cur = await s.booking(b.booking_id);
  check('4 minutes after the report he is warned again (a restarted stand-still), and is still the driver', cur.stall_warned_at !== null && cur.driver_id === ID.D1, cur);
  check('the second warning is a new notice (its own key)', (await notes(ID.D1, 'STALL_WARNING')).filter((n) => n.subject_id === b.booking_id).length === 2);
  await age(b.booking_id, 60); await s.moveTo('D1', 200); await s.sweep();
  cur = await s.booking(b.booking_id);
  check('5 minutes after the report he is stalled: cancelled, 1 strike (Rule 8.4)', cur.driver_id === null && (await strikeRows(ID.D1, 'DRV_STALL')).length === 1, cur);
  await reset(cur);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS3 T3: GPS stops before the pickup: Driver Unreachable at 3 minutes, cancelled with a provisional strike at 5, and the strike is waived by the TODA Administrator');
  await s.online('D1', 300); await s.online('D2', 600);
  await clearStrikes();
  b = await bookAndAccept('D1', 'P1');
  await s.moveTo('D1', 200);
  await silence('D1', 190); await s.sweep();
  cur = await s.booking(b.booking_id);
  let ev = await events(b.booking_id);
  check('after 3 minutes of silence the booking is marked Driver Unreachable and the silence is RECORDED (phase assigned, still open)',
    cur.driver_unreachable_since !== null && ev.length === 1 && ev[0].phase === 'assigned' && ev[0].restored_at === null && ev[0].ended_reason === null, { cur: cur.driver_unreachable_since, ev });
  const dr = await one(`SELECT current_latitude, current_longitude, last_location_accuracy_m FROM driver WHERE driver_id='${ID.D1}'`);
  check('the event keeps the last confirmed point (his last fix), the time of that fix and its accuracy',
    ev[0].last_fix_latitude === dr.current_latitude && ev[0].last_fix_longitude === dr.current_longitude && ev[0].last_fix_accuracy_m === dr.last_location_accuracy_m && ev[0].last_fix_at !== null, ev[0]);
  let un = await notes(ID.P1, 'DRIVER_UNREACHABLE');
  check('the passenger notice has the title "Connection lost — reconnecting..." and the exact Rule 9.2 text',
    un.length === 1 && /^Connection lost — reconnecting\.\.\./.test(un[0].title) && /Your driver appears to be experiencing a connectivity issue\. We'll keep trying to reach them\./.test(un[0].message), un);
  check('an audit row records the interruption', (await auditRows('CONNECTIVITY_INTERRUPTED', b.booking_id)).length === 1);
  await s.sweep(); await s.sweep();
  check('the sweep repeating creates no second record and no second notice', (await events(b.booking_id)).length === 1 && (await notes(ID.P1, 'DRIVER_UNREACHABLE')).length === 1);
  await silence('D1', 120); await s.sweep();
  cur = await s.booking(b.booking_id);
  ev = await events(b.booking_id);
  check('after 5 minutes before arriving the booking goes to the next driver (Rule 9.3) and the silence is closed as auto_cancelled', cur.driver_id === null && cur.booking_status === 'Pending' && ev.length === 1 && ev[0].ended_reason === 'auto_cancelled', { cur: cur.booking_status, ev });
  const st = await q(`SELECT strike_id, status, points_active, toda_id, provisional_until FROM strikes_ledger WHERE subject_id='${ID.D1}' AND violation_code='DRV_CONNECTIVITY_FAILURE' AND status <> 'VOIDED'`);
  check('the driver has ONE provisional strike of 1 point, issued under his TODA', st.length === 1 && st[0].status === 'PROVISIONAL' && st[0].points_active === 1 && st[0].toda_id === ID.TODA1, st);
  const req = await attempt(() => s.rpcAs(ID.D_AUTH, `public.submit_exemption_request($1, 'NETWORK_OUTAGE', 'My phone had no signal in the tunnel near the market', '[]'::jsonb, false)`, [st[0].strike_id]));
  check('he reconnects and, within 48 hours, asks for the strike to be waived with a cause: it goes to his TODA Administrator', req.ok && req.value.assigned_role === 'toda_admin' && req.value.status === 'Pending TODA Review', req);
  const other = await adminRpc(A.toda2, `public.decide_exemption($1, 'FULL', 'not my driver', NULL)`, [req.value.request_id]);
  check('the Administrator of ANOTHER TODA cannot decide it', !other.ok && /not assigned to you/.test(other.error), other);
  const dec = await adminRpc(A.toda1, `public.decide_exemption($1, 'FULL', 'Verified: a documented signal outage at that place and time', NULL)`, [req.value.request_id]);
  const st2 = await q(`SELECT status, points_active FROM strikes_ledger WHERE strike_id='${st[0].strike_id}'`);
  check('his TODA Administrator waives it in full: the strike is WAIVED, 0 points active', dec.ok && st2[0].status === 'WAIVED' && st2[0].points_active === 0, { dec, st2 });
  check('the waiver is audited (EXEMPTION_DECIDED)', (await q(`SELECT 1 FROM audit_log WHERE action_type='EXEMPTION_DECIDED' AND target_id='${ID.D1}'`)).length === 1);
  await reset(cur);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS4 T4: an Ongoing trip loses GPS: never cancelled, the silence is recorded with the last point, the driver must re-confirm before the fare is finalised');
  await s.online('D1', 300);
  await clearStrikes();
  b = await startTrip('D1', 'P1');
  await s.moveTo('D1', 150, 12);
  await silence('D1', 400); await s.sweep();
  cur = await s.booking(b.booking_id);
  ev = await events(b.booking_id);
  check('silent for 6 minutes during the trip: marked, NOT cancelled, the trip stays with the driver', cur.driver_unreachable_since !== null && cur.booking_status === 'Trip Ongoing' && cur.driver_id === ID.D1, cur.booking_status);
  check('the silence is recorded as an Ongoing one, with the last confirmed point', ev.length === 1 && ev[0].phase === 'ongoing' && ev[0].last_fix_latitude !== null && ev[0].reconfirmed_at === null, ev);
  const live = await paxRpc('P1', 'public.get_driver_live_status($1)', [b.booking_id]);
  check('the passenger\'s screen is told the trip is interrupted, and how old the position is by the SERVER\'s clock', live.success === true && live.interrupted === true && live.live === true && live.age_seconds >= 400 && live.latitude !== null, live);
  const noPax = await paxRpc('P2', 'public.get_driver_live_status($1)', [b.booking_id]);
  check('another passenger cannot read it', noPax.success === false && noPax.error_code === 'ERR_NOT_YOUR_BOOKING', noPax);
  const mine = await rpc('D1', 'public.get_my_trip_connectivity($1)', [b.booking_id]);
  check('the driver\'s app learns that a re-confirmation is needed, and that he is not connected yet', mine.success === true && mine.needs_reconfirm === true && mine.connected === false, mine);
  const early = await rpc('D1', 'public.driver_reconfirm_trip($1, $2)', [b.booking_id, 'ongoing']);
  check('he cannot re-confirm while the server still has no position from him', early.success === false && early.error_code === 'ERR_STILL_NO_GPS', early);
  await s.moveTo('D1', 140, 12); await s.sweep();
  cur = await s.booking(b.booking_id);
  ev = await events(b.booking_id);
  check('he is heard again: the mark is cleared and the silence is closed (restored), but it still waits for his re-confirmation', cur.driver_unreachable_since === null && ev[0].restored_at !== null && ev[0].reconfirmed_at === null, ev[0]);
  check('an audit row records the restoration', (await auditRows('CONNECTIVITY_RESTORED', b.booking_id)).length === 1);
  const mine2 = await rpc('D1', 'public.get_my_trip_connectivity($1)', [b.booking_id]);
  check('the driver\'s app now shows the dialog (needs re-confirmation, connected)', mine2.needs_reconfirm === true && mine2.connected === true, mine2);
  await s.reachDestination(b.booking_id);
  const f1 = await driverSets('D1', b.booking_id, 'Arrived at Destination');
  check('the driver cannot finish the trip before he re-confirms it (ERR_RECONFIRM_TRIP)', !f1.ok && /ERR_RECONFIRM_TRIP/.test(f1.error), f1);
  const f2 = await paxSets('P1', b.booking_id, 'Arrived at Destination');
  check('nor can the passenger finish it for him', !f2.ok && /ERR_RECONFIRM_TRIP/.test(f2.error), f2);
  check('the trip is still Ongoing', (await s.booking(b.booking_id)).booking_status === 'Trip Ongoing');
  const badStatus = await rpc('D1', 'public.driver_reconfirm_trip($1, $2)', [b.booking_id, 'maybe']);
  check('only "ongoing" or "ended" are accepted', badStatus.success === false && badStatus.error_code === 'ERR_RECONFIRM_STATUS', badStatus);
  const stranger = await rpc('D2', 'public.driver_reconfirm_trip($1, $2)', [b.booking_id, 'ongoing']);
  check('another driver cannot re-confirm this trip', stranger.success === false, stranger);
  const ok1 = await rpc('D1', 'public.driver_reconfirm_trip($1, $2)', [b.booking_id, 'ended']);
  ev = await events(b.booking_id);
  check('he re-confirms (the trip has ended): recorded with the time and his answer', ok1.success === true && ev[0].reconfirmed_at !== null && ev[0].reconfirmed_as === 'ended', { ok1, ev: ev[0] });
  const ok2 = await rpc('D1', 'public.driver_reconfirm_trip($1, $2)', [b.booking_id, 'ended']);
  check('a double tap changes nothing', ok2.success === true && ok2.nothing_to_confirm === true && (await events(b.booking_id))[0].reconfirmed_at !== null);
  check('an audit row records the re-confirmation', (await auditRows('TRIP_RECONFIRMED', b.booking_id)).length === 1);
  const f3 = await driverSets('D1', b.booking_id, 'Arrived at Destination');
  const fin = await s.booking(b.booking_id);
  check('now the trip proceeds to fare finalisation: Arrived at Destination, the fare is locked by the database', f3.ok && fin.booking_status === 'Arrived at Destination' && fin.fare_locked_at !== null && fin.actual_fare !== null, f3.error);
  const mine3 = await rpc('D1', 'public.get_my_trip_connectivity($1)', [b.booking_id]);
  check('and nothing is left to confirm', mine3.needs_reconfirm === false, mine3);
  await reset(fin);

  console.log('\nS4b a second silence of the same trip needs a second re-confirmation; a trip that was never interrupted needs none');
  await s.online('D1', 300);
  b = await startTrip('D1', 'P1');
  check('an uninterrupted trip has nothing to re-confirm', (await rpc('D1', 'public.get_my_trip_connectivity($1)', [b.booking_id])).needs_reconfirm === false);
  await silence('D1', 200); await s.sweep(); await s.moveTo('D1', 100, 12); await s.sweep();
  await rpc('D1', 'public.driver_reconfirm_trip($1, $2)', [b.booking_id, 'ongoing']);
  await silence('D1', 200); await s.sweep(); await s.moveTo('D1', 90, 12); await s.sweep();
  ev = await events(b.booking_id);
  check('two silences are two records, the second is waiting for its own re-confirmation', ev.length === 2 && ev[0].reconfirmed_as === 'ongoing' && ev[1].reconfirmed_at === null && ev[1].restored_at !== null, ev.map((e) => ({ r: e.reconfirmed_at, rs: e.restored_at })));
  await s.reachDestination(b.booking_id);
  const g1 = await driverSets('D1', b.booking_id, 'Arrived at Destination');
  check('the trip is blocked again until he answers again', !g1.ok && /ERR_RECONFIRM_TRIP/.test(g1.error), g1);
  const lguFinish = await internal(`UPDATE booking SET booking_status='Arrived at Destination' WHERE booking_id='${b.booking_id}'`);
  check('the system (and the LGU administrator) are not blocked by the guard', (await s.booking(b.booking_id)).booking_status === 'Arrived at Destination');
  await reset(await s.booking(b.booking_id));
  check('...and an open record of a booking that ended is closed (booking_ended)', (await q(`SELECT 1 FROM trip_connectivity_event WHERE booking_id='${b.booking_id}' AND ended_reason IS NULL AND restored_at IS NULL`)).length === 0);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS5 Rule 9.5: after 30 minutes the TODA Administrator reconciles the trip (phone / SMS), records the outcome and the fare, and the booking is closed');
  await s.online('D1', 300);
  await clearStrikes();
  b = await startTrip('D1', 'P1');
  await s.moveTo('D1', 150, 12);
  await silence('D1', 400); await s.sweep();
  const none0 = await adminRpc(A.toda1, 'public.get_trips_needing_reconciliation()');
  check('before 30 minutes the trip is not waiting for reconciliation', none0.ok && none0.value.length === 0, none0);
  await age(b.booking_id, 1900); await silence('D1', 1900); await s.sweep(); await s.sweep();
  ev = await events(b.booking_id);
  const fl = await q(`SELECT * FROM admin_review_flag WHERE subject_id='${ID.D1}' AND flag_type='TRIP_MANUAL_RECONCILIATION' AND status IN ('Open','Under Review')`);
  check('after 30 minutes the silence is flagged for reconciliation, once, and the flag carries the event and the last known point',
    ev.length === 1 && ev[0].reconcile_flagged_at !== null && ev[0].reconcile_flag_id === fl[0]?.flag_id && fl.length === 1 && fl[0].details.event_id === ev[0].event_id && fl[0].details.last_known_latitude === ev[0].last_fix_latitude, { ev: ev[0], fl });
  check('an audit row records that the trip is waiting', (await auditRows('TRIP_RECONCILIATION_REQUIRED', b.booking_id)).length === 1);
  const mineList = await adminRpc(A.toda1, 'public.get_trips_needing_reconciliation()');
  check('the Administrator of the driver\'s TODA sees the trip, with BOTH phone numbers and the last known position',
    mineList.ok && mineList.value.length === 1 && mineList.value[0].booking_id === b.booking_id && !!mineList.value[0].driver_phone && !!mineList.value[0].passenger_phone && mineList.value[0].last_fix_latitude !== null, mineList);
  const otherList = await adminRpc(A.toda2, 'public.get_trips_needing_reconciliation()');
  check('the Administrator of another TODA does not', otherList.ok && otherList.value.length === 0, otherList);
  check('the LGU Administrator sees it', (await adminRpc(A.lgu, 'public.get_trips_needing_reconciliation()')).value.length === 1);
  const paxList = await adminRpc(s.PAX.P1.uid, 'public.get_trips_needing_reconciliation()');
  check('a passenger cannot list them', !paxList.ok && /Access Denied/.test(paxList.error), paxList);
  const recon = (uid, outcome, fare, reason, cd, cp) => adminRpc(uid, 'public.admin_reconcile_trip($1, $2, $3::numeric, $4, $5, $6)', [b.booking_id, outcome, fare, reason, cd, cp]);
  check('another TODA\'s Administrator cannot reconcile it', /Access Denied/.test((await recon(A.toda2, 'completed', null, 'x', true, true)).error ?? ''));
  check('a driver cannot reconcile his own trip', /Access Denied/.test((await attempt(() => s.rpcAs(DRIVERS.D1.uid, 'public.admin_reconcile_trip($1, $2, NULL::numeric, $3, true, true)', [b.booking_id, 'completed', 'x']))).error ?? ''));
  check('an outcome other than completed / cancelled is refused', /ERR_RECONCILE_OUTCOME/.test((await recon(A.toda1, 'maybe', null, 'x', true, true)).error ?? ''));
  check('a reason is required', /ERR_RECONCILE_REASON/.test((await recon(A.toda1, 'completed', null, '  ', true, true)).error ?? ''));
  check('at least one of the two parties must have been contacted', /ERR_RECONCILE_CONTACT/.test((await recon(A.toda1, 'completed', null, 'x', false, false)).error ?? ''));
  const hi = await recon(A.toda1, 'completed', 1000, 'The passenger agreed', true, true);
  check('the agreed fare can never be HIGHER than the system\'s', !hi.ok && /ERR_RECONCILE_FARE_HIGHER/.test(hi.error), hi);
  check('...and the refusal left the trip untouched (atomic): still Ongoing, no fare, still waiting',
    (await s.booking(b.booking_id)).booking_status === 'Trip Ongoing' && (await s.booking(b.booking_id)).fare_locked_at === null && (await adminRpc(A.toda1, 'public.get_trips_needing_reconciliation()')).value.length === 1);
  const lo = await recon(A.toda1, 'completed', 10, 'The passenger agreed', true, true);
  check('nor lower than the base fare of the booking\'s own tariff (PHP 15)', !lo.ok && /ERR_RECONCILE_FARE_BELOW_BASE/.test(lo.error), lo);
  const done = await recon(A.toda1, 'completed', 45, 'Called the driver at 4:10 PM and the passenger at 4:12 PM: both confirm the trip ended near the destination and agree on PHP 45.', true, true);
  const closed = await s.booking(b.booking_id);
  check('the Administrator closes the trip as completed with a LOWER agreed fare: Completed, PHP 45, closed by the system on the Administrator\'s behalf',
    done.ok && done.value.success === true && closed.booking_status === 'Completed' && Number(closed.actual_fare) === 45 && closed.trip_completed_at !== null, { done, closed: closed.booking_status, fare: closed.actual_fare });
  check('the system\'s own fare was computed and kept in the result', Number(done.value.system_fare) > 45 && Number(done.value.recorded_fare) === 45, done.value);
  const fa = await q(`SELECT reason_code, previous_fare, new_fare, actor_role FROM fare_adjustment_history WHERE booking_id='${b.booking_id}' AND reason_code='ADMIN_CORRECTION'`);
  check('the lower amount is written to the fare ledger (ADMIN_CORRECTION, from the system\'s fare to 45, by a TODA Administrator)', fa.length === 1 && Number(fa[0].new_fare) === 45 && Number(fa[0].previous_fare) > 45 && fa[0].actor_role === 'toda_admin', fa);
  ev = await events(b.booking_id);
  check('the event keeps who closed it, the outcome, the fare, the note and which parties were reached',
    ev[0].reconciled_at !== null && ev[0].reconciled_by === A.toda1 && ev[0].reconcile_outcome === 'completed' && Number(ev[0].reconcile_fare) === 45 && /Called the driver/.test(ev[0].reconcile_note) && ev[0].contacted_driver === true && ev[0].contacted_passenger === true && ev[0].ended_reason === 'reconciled', ev[0]);
  const ra = await auditRows('TRIP_RECONCILED', b.booking_id);
  check('the audit log records the Administrator, the outcome, the fare and the reason, before and after', ra.length === 1 && ra[0].actor_role === 'toda_admin' && ra[0].before_state.booking_status === 'Trip Ongoing' && ra[0].after_state.booking_status === 'Completed' && Number(ra[0].after_state.recorded_fare) === 45 && /Called the driver/.test(ra[0].details), ra);
  const flAfter = await q(`SELECT status, resolution FROM admin_review_flag WHERE flag_id='${ev[0].reconcile_flag_id}'`);
  check('the review flag is resolved', flAfter[0].status === 'Resolved' && /Reconciled: completed/.test(flAfter[0].resolution), flAfter);
  check('both parties are told', (await notes(ID.P1, 'TRIP_RECONCILED')).length === 1 && (await notes(ID.D1, 'TRIP_RECONCILED')).length === 1);
  check('nobody was struck (the driver\'s silence is not a violation by itself)', (await s.strikes(ID.D1)).length === 0 && (await s.strikes(ID.P1)).length === 0);
  const again = await recon(A.toda1, 'completed', null, 'x', true, true);
  check('closing it twice is refused (the trip is no longer in progress)', !again.ok && /ERR_RECONCILE_NOT_ONGOING/.test(again.error), again);
  await reset(null);

  console.log('\nS5b closing as cancelled: no fare, cancelled by the Administrator, and a trip that was not silent for 30 minutes cannot be reconciled');
  await s.online('D1', 300);
  b = await startTrip('D1', 'P1');
  await silence('D1', 400); await s.sweep();
  const early2 = await recon(A.toda1, 'cancelled', null, 'x', true, true);
  check('a trip silent for only 6 minutes cannot be reconciled', !early2.ok && /ERR_RECONCILE_NOT_FLAGGED/.test(early2.error), early2);
  await age(b.booking_id, 1900); await silence('D1', 1900); await s.sweep();
  const canc = await recon(A.lgu, 'cancelled', null, 'Neither party could confirm a trip; the passenger says she got another tricycle.', false, true);
  const cb = await s.booking(b.booking_id);
  check('the LGU Administrator closes it as cancelled: Cancelled by lgu_admin, no fare, and the passenger is not struck',
    canc.ok && cb.booking_status === 'Cancelled' && cb.cancelled_by === 'lgu_admin' && cb.actual_fare === null && (await s.strikes(ID.P1)).length === 0, { canc, cb: cb.booking_status });
  check('...and the driver neither', (await s.strikes(ID.D1)).length === 0);
  await reset(null);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS6 T5: the passenger\'s phone is off and the driver\'s app crashes: the trip is the database\'s, and it carries on');
  await s.online('D1', 300);
  b = await startTrip('D1', 'P1');
  for (let i = 0; i < 6; i++) { await s.moveTo('D1', 150 - i * 10, 12); await s.sweep(); }
  check('the passenger\'s device never reaches the database during the trip: nothing is flagged, nobody is struck, the trip is still Ongoing',
    (await s.booking(b.booking_id)).booking_status === 'Trip Ongoing' && (await events(b.booking_id)).length === 0 && (await s.strikes(ID.P1)).length === 0);
  const trail = await one(`SELECT count(*)::int n FROM gps_log WHERE booking_id='${b.booking_id}'`);
  check('the GPS trail of the trip is kept server-side', trail.n >= 6, trail);
  // the driver's app crashes (the app is gone: no heartbeat, no screen state) and is reopened a minute later
  await silence('D1', 60); await s.sweep();
  check('a crash shorter than the 3-minute threshold is not a connectivity event (Rule 29.2)', (await events(b.booking_id)).length === 0 && (await s.booking(b.booking_id)).driver_unreachable_since === null);
  const resume = await attempt(() => as(DRIVERS.D1.uid, (tx) => tx.query(
    `SELECT booking_id, booking_status FROM booking WHERE booking_status IN ('Accepted','Assigned','Driver Assigned','Driver En Route','Heading to Passenger','In Transit','Driver Arrived','Arrived at Pickup','Trip Ongoing','Ongoing','Arrived at Destination') ORDER BY created_at DESC LIMIT 1`)));
  check('the reopened Driver app finds its open booking from the DATABASE (what the Home screen\'s resume reads, row security applied)', resume.ok && resume.value.rows.length === 1 && resume.value.rows[0].booking_id === b.booking_id && resume.value.rows[0].booking_status === 'Trip Ongoing', resume);
  const nothingForD2 = await attempt(() => as(DRIVERS.D2.uid, (tx) => tx.query(`SELECT booking_id FROM booking WHERE booking_status = 'Trip Ongoing'`)));
  check('another driver sees no such booking', nothingForD2.ok && nothingForD2.value.rows.length === 0, nothingForD2);
  await s.moveTo('D1', 90, 12); await s.sweep();
  check('he is back on the trip and it goes on as if nothing had happened', (await s.booking(b.booking_id)).booking_status === 'Trip Ongoing' && (await events(b.booking_id)).length === 0);
  await reset(await s.booking(b.booking_id));

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS7 decision D7-6: a passenger who cancels while the driver is Unreachable is not struck');
  await s.online('D1', 300); await s.online('D2', 600);
  await clearStrikes();
  b = await bookAndAccept('D1', 'P1');
  await s.moveTo('D1', 200); await age(b.booking_id, 100);
  await silence('D1', 190); await s.sweep();
  check('the driver is marked Unreachable', (await s.booking(b.booking_id)).driver_unreachable_since !== null);
  const c1 = await s.cancelAs(s.PAX.P1.uid, b.booking_id, 'The driver is not answering');
  check('she cancels (after the 60-second grace, while he is unreachable): cancelled by the passenger and NO late-cancellation strike', c1.rows[0].booking_status === 'Cancelled' && (await s.strikes(ID.P1)).length === 0, await s.strikes(ID.P1));
  check('the decision is audited', (await auditRows('PASSENGER_CANCEL_NO_STRIKE_DRIVER_UNREACHABLE', b.booking_id)).length === 1);
  await reset(null);
  await s.online('D1', 300); await s.online('D2', 600);
  b = await bookAndAccept('D1', 'P1');
  await s.moveTo('D1', 200); await age(b.booking_id, 100); await s.moveTo('D1', 200);
  const c2 = await s.cancelAs(s.PAX.P1.uid, b.booking_id, 'Changed my mind');
  check('control: the same cancel with a driver who IS reachable is still a late cancellation (1 strike)', c2.rows[0].booking_status === 'Cancelled' && (await strikeRows(ID.P1, 'PAX_LATE_CANCEL')).length === 1, await s.strikes(ID.P1));
  await reset(null);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS8 T6 and Rule 9.6: a deliberate offline is REPORTED by the TODA Administrator with its evidence and CONFIRMED by the LGU Administrator: 2 strikes, no exemption');
  await s.online('D1', 300);
  await clearStrikes();
  b = await startTrip('D1', 'P1');
  await silence('D1', 400); await s.sweep();
  await s.moveTo('D1', 100, 12); await s.sweep();
  const report = (uid, driver, booking, ev_, note) => adminRpc(uid, 'public.report_deliberate_offline($1, $2, $3, $4)', [driver, booking, ev_, note]);
  check('a passenger cannot report one', /Access Denied/.test((await report(s.PAX.P1.uid, ID.D1, b.booking_id, 'passenger_report', 'x')).error ?? ''));
  check('the Administrator of another TODA cannot report this driver', /Access Denied/.test((await report(A.toda2, ID.D1, b.booking_id, 'passenger_report', 'x')).error ?? ''));
  check('the evidence must be a pattern review, a passenger report or an admission', /ERR_EVIDENCE:/.test((await report(A.toda1, ID.D1, b.booking_id, 'gut_feeling', 'x')).error ?? ''));
  check('the evidence must be described', /ERR_EVIDENCE_NOTE/.test((await report(A.toda1, ID.D1, b.booking_id, 'passenger_report', '  ')).error ?? ''));
  check('the booking must be this driver\'s', /ERR_NOT_THE_DRIVERS_BOOKING/.test((await report(A.toda1, ID.D2, b.booking_id, 'admission', 'x')).error ?? ''));
  const rep1 = await report(A.toda1, ID.D1, b.booking_id, 'passenger_report', 'The passenger says he switched the phone off after she asked to be dropped near the market.');
  const fl1 = await q(`SELECT * FROM admin_review_flag WHERE flag_id='${rep1.value?.flag_id}'`);
  check('the TODA Administrator reports it: ONE review flag for the LGU Administrator, carrying the evidence and the driver\'s recent interruptions (the pattern); NO strike yet',
    rep1.ok && fl1.length === 1 && fl1[0].flag_type === 'DRIVER_DELIBERATE_OFFLINE_REPORT' && fl1[0].assigned_role === 'lgu_admin' && fl1[0].details.evidence === 'passenger_report' && fl1[0].details.interruptions_last_30_days >= 1 && fl1[0].details.reported_by_role === 'toda_admin'
      && (await strikeRows(ID.D1, 'DRV_DELIBERATE_OFFLINE')).length === 0, { rep1, fl1 });
  const direct = await adminRpc(A.toda1, `public.issue_strike('driver', $1, 'DRV_DELIBERATE_OFFLINE', NULL, NULL, NULL, 'x-direct', NULL, 'I decide', NULL, NULL)`, [ID.D1]);
  check('the TODA Administrator cannot issue the strike himself (only the LGU Administrator confirms it)', !direct.ok && /Only the LGU Administrator/.test(direct.error), direct);
  const byToda = await adminRpc(A.toda1, 'public.confirm_deliberate_offline($1, $2)', [rep1.value.flag_id, 'I confirm']);
  check('nor through the confirmation function', !byToda.ok && /Only the LGU Administrator/.test(byToda.error), byToda);
  const noReason = await adminRpc(A.lgu, 'public.confirm_deliberate_offline($1, $2)', [rep1.value.flag_id, '']);
  check('the LGU Administrator must give a reason', !noReason.ok && /ERR_CONFIRM_REASON/.test(noReason.error), noReason);
  const conf = await adminRpc(A.lgu, 'public.confirm_deliberate_offline($1, $2)', [rep1.value.flag_id, 'Reviewed the three interruptions and the passenger\'s statement: the driver went offline on purpose.']);
  const sk = await strikeRows(ID.D1, 'DRV_DELIBERATE_OFFLINE');
  check('the LGU Administrator confirms it: ONE strike of 2 points, ACTIVE (not provisional), issued by the LGU Administrator', conf.ok && sk.length === 1 && sk[0].points_active === 2 && sk[0].status === 'ACTIVE' && sk[0].issued_by_role === 'lgu_admin', { conf, sk });
  check('the flag is resolved', (await q(`SELECT status FROM admin_review_flag WHERE flag_id='${rep1.value.flag_id}'`))[0].status === 'Resolved');
  const conf2 = await adminRpc(A.lgu, 'public.confirm_deliberate_offline($1, $2)', [rep1.value.flag_id, 'again']);
  check('confirming twice (a double tap) strikes only once', conf2.ok && conf2.value.already_decided === true && (await strikeRows(ID.D1, 'DRV_DELIBERATE_OFFLINE')).length === 1, conf2);
  const delibId = (await q(`SELECT strike_id FROM strikes_ledger WHERE subject_id='${ID.D1}' AND violation_code='DRV_DELIBERATE_OFFLINE'`))[0].strike_id;
  const noEx = await attempt(() => s.rpcAs(ID.D_AUTH, `public.submit_exemption_request($1, 'NETWORK_OUTAGE', 'my signal dropped', '[]'::jsonb, false)`, [delibId]));
  check('the driver CANNOT ask for it to be waived (Rule 9.6: the Rule 9.4 exemption does not apply)', !noEx.ok && /not eligible/.test(noEx.error), noEx);
  const notFlag = await adminRpc(A.lgu, 'public.confirm_deliberate_offline($1, $2)', [(await q(`SELECT flag_id FROM admin_review_flag WHERE flag_type <> 'DRIVER_DELIBERATE_OFFLINE_REPORT' LIMIT 1`))[0]?.flag_id ?? '00000000-0000-0000-0000-000000000000', 'x']);
  check('only a deliberate-offline report can be confirmed this way', !notFlag.ok && /ERR_NOT_A_DELIBERATE_OFFLINE_REPORT/.test(notFlag.error), notFlag);
  await reset(await s.booking(b.booking_id));

  console.log('\nS8b Rule 8.7: a route deviation confirmed after investigation is 1 strike on the FIRST case');
  const dev = (uid, reason) => adminRpc(uid, `public.issue_strike('driver', $1, 'DRV_PICKUP_DEVIATION', NULL, NULL, NULL, $3, NULL, $2, NULL, NULL)`, [ID.D1, reason, 'dev-' + Math.random()]);
  const dev0 = await dev(A.toda1, '');
  check('it is administrator-confirmed: a reason is required', !dev0.ok && /confirmation reason is required/.test(dev0.error), dev0);
  const dev1 = await dev(A.toda1, 'Passenger complaint investigated: GPS trail shows a 1.4 km detour with no road closure on record.');
  check('confirmed once: 1 strike, ACTIVE straight away (before Batch 7 the first case was only observed)', dev1.ok && dev1.value.status === 'ACTIVE' && dev1.value.points === 1, dev1);
  const devOther = await dev(A.toda2, 'not my driver');
  check('only the driver\'s own TODA (or the LGU) can confirm it', !devOther.ok && /Access Denied/.test(devOther.error), devOther);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS9 access: the record of silences is the system\'s; the people concerned read it, nobody writes it');
  const evAll = await q(`SELECT * FROM trip_connectivity_event LIMIT 1`);
  const evId = evAll[0].event_id;
  for (const [who, uid] of [['a driver', DRIVERS.D1.uid], ['a passenger', s.PAX.P1.uid], ['a TODA administrator', A.toda1], ['the LGU administrator', A.lgu]]) {
    const w1 = await attempt(() => as(uid, (tx) => tx.query(`UPDATE trip_connectivity_event SET reconfirmed_at = now() WHERE event_id = $1`, [evId])));
    const w2 = await attempt(() => as(uid, (tx) => tx.query(`DELETE FROM trip_connectivity_event WHERE event_id = $1`, [evId])));
    const w3 = await attempt(() => as(uid, (tx) => tx.query(`INSERT INTO trip_connectivity_event (booking_id, phase) SELECT booking_id, 'ongoing' FROM trip_connectivity_event LIMIT 1`)));
    check(`${who} cannot write, delete or insert`, !w1.ok && !w2.ok && !w3.ok, { w1: w1.error, w2: w2.error, w3: w3.error });
  }
  const seeP = await attempt(() => as(s.PAX.P1.uid, (tx) => tx.query(`SELECT count(*)::int n FROM trip_connectivity_event`)));
  check('a passenger reads none of them', seeP.ok && seeP.value.rows[0].n === 0, seeP);
  const seeD = await attempt(() => as(DRIVERS.D1.uid, (tx) => tx.query(`SELECT count(*)::int n FROM trip_connectivity_event`)));
  check('a driver reads his own', seeD.ok && seeD.value.rows[0].n > 0, seeD);
  const seeD2 = await attempt(() => as(DRIVERS.D2.uid, (tx) => tx.query(`SELECT count(*)::int n FROM trip_connectivity_event`)));
  check('another driver reads none of them', seeD2.ok && seeD2.value.rows[0].n === 0, seeD2);
  const seeT = await attempt(() => as(A.toda2, (tx) => tx.query(`SELECT count(*)::int n FROM trip_connectivity_event`)));
  check('the Administrator of another TODA reads none', seeT.ok && seeT.value.rows[0].n === 0, seeT);
  const seeT1 = await attempt(() => as(A.toda1, (tx) => tx.query(`SELECT count(*)::int n FROM trip_connectivity_event`)));
  check('the Administrator of the driver\'s TODA reads them', seeT1.ok && seeT1.value.rows[0].n > 0, seeT1);
  const asAnon = async (sql, args = []) => { await s.db.exec('SET ROLE anon'); try { return await attempt(() => s.db.query(sql, args)); } finally { await s.db.exec('RESET ROLE'); } };
  const anon = await asAnon('SELECT * FROM trip_connectivity_event');
  check('an anonymous caller reads nothing (permission denied)', !anon.ok && /permission denied/i.test(anon.error), anon.error);
  for (const [fn, args] of [['public.driver_reconfirm_trip($1::uuid, $2)', [ID.D1, 'ongoing']], ['public.get_driver_live_status($1::uuid)', [ID.D1]],
                            ['public.get_trips_needing_reconciliation()', []], ['public.get_gps_determination_hotspots()', []]]) {
    const r = await asAnon('SELECT ' + fn, args);
    check('an anonymous caller cannot call ' + fn.split('(')[0] + ' (permission denied)', !r.ok && /permission denied/i.test(r.error), r.error);
  }

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS10 the lists the screens offer are exactly what the database accepts (no list on one side only)');
  const root = path.join(__dirname, '..', '..', '..');
  const cfg = fs.readFileSync(path.join(root, 'packages', 'shared', 'src', 'config', 'policyConfig.ts'), 'utf8');
  const panel = fs.readFileSync(path.join(root, 'packages', 'shared', 'src', 'components', 'TripReconciliationPanel.tsx'), 'utf8');
  const listOf = (text, name) => {
    const m = text.match(new RegExp('export const ' + name + '\\s*=\\s*\\[([^\\]]*)\\]'));
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
  };
  const reconfirm = listOf(cfg, 'TRIP_RECONFIRM_STATUSES');
  check('the re-confirmation answers are "ongoing" and "ended" in the app config', JSON.stringify(reconfirm) === JSON.stringify(['ongoing', 'ended']), reconfirm);
  const noBooking = '00000000-0000-0000-0000-0000000000bb';
  for (const st of [...reconfirm, 'maybe', '']) {
    const r = await rpc('D1', 'public.driver_reconfirm_trip($1, $2)', [noBooking, st]);
    const accepted = r.error_code !== 'ERR_RECONFIRM_STATUS';
    check(`the database ${reconfirm.includes(st) ? 'accepts' : 'refuses'} the answer "${st}" (as the app config lists it)`, accepted === reconfirm.includes(st), r);
  }
  const evidence = listOf(panel, 'DELIBERATE_OFFLINE_EVIDENCE');
  check('the evidence of a deliberate offline is the three kinds of Rule 9.6 in the shared panel', JSON.stringify(evidence) === JSON.stringify(['pattern_review', 'passenger_report', 'admission']), evidence);
  for (const kind of [...evidence, 'gut_feeling']) {
    const r = await report(A.toda1, ID.D1, null, kind, '');
    const accepted = !/ERR_EVIDENCE:/.test(r.error ?? '');
    check(`the database ${evidence.includes(kind) ? 'accepts' : 'refuses'} the evidence "${kind}" (as the shared panel lists it)`, accepted === evidence.includes(kind), r.error);
  }
  // the Driver app takes a reopened driver to the navigation screen while he is on the way to the pickup and to the trip screen after: its list of
  // "on the way" statuses must be exactly the database's 'assigned' phase
  const resumeSrc = fs.readFileSync(path.join(root, 'apps', 'driver-pwa', 'src', 'services', 'openBookingService.ts'), 'utf8');
  const onTheWay = [...(resumeSrc.match(/ON_THE_WAY_STATUSES[^=]*=\s*\[([^\]]*)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]);
  const dbAssigned = (await q(`SELECT s FROM unnest(ARRAY['Accepted','Assigned','Driver Assigned','Driver En Route','Heading to Passenger','In Transit','Driver Arrived','Arrived at Pickup','Trip Ongoing','Ongoing','Arrived at Destination']) s WHERE public._booking_phase(s) = 'assigned' ORDER BY 1`)).map((r) => r.s).sort();
  check('the Driver app\'s "on the way to the pickup" statuses are exactly the database\'s assigned phase (where a reopened app resumes)', JSON.stringify([...onTheWay].sort()) === JSON.stringify(dbAssigned), { onTheWay, dbAssigned });
  const causes = listOf(cfg, 'EXEMPTION_CAUSE_CODES');
  const def = (await one(`SELECT pg_get_constraintdef(c.oid) d FROM pg_constraint c WHERE c.conrelid = 'public.exemption_request'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%cause_code%'`)).d;
  const dbCauses = [...def.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]).sort();
  check('the grounds of an appeal in the app config are the ones the database accepts (Rule 25.3)', JSON.stringify([...causes].sort()) === JSON.stringify(dbCauses), { causes, dbCauses });

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS11 the migration is safe to run twice, and changes no other function\'s answer');
  const mig = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261021000001_batch7_connectivity_and_reconciliation.sql'), 'utf8');
  const twice = await attempt(() => s.db.exec(mig));
  check('running the migration a second time on the same database raises nothing', twice.ok, twice.error);
  check('...and the numbers are still right', (await one(`SELECT public.dispatch_constant('stall_en_route_warn_seconds') v`)).v === 240 && (await one(`SELECT public.dispatch_constant('stall_en_route_seconds') v`)).v === 300);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
