// Migration 20261031000006 (panel comments 7 and 12, decision D-P5): a suspended TODA's drivers cannot travel, and a passenger or a driver can deactivate their own account.
// Whole migration chain on the local emulator (never Supabase).
const { setup, ID, DRIVERS, PAX, attempt, check, summary } = require('../b11fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, svc, as } = s;
  const LGU = ID.L_AUTH;
  const rpc = (uid, sql, args = []) => attempt(() => s.rpcAs(uid, `public.${sql}`, args));
  const toda = () => one(`SELECT * FROM toda WHERE toda_id = '${ID.TODA1}'`);
  const avail = (k) => s.status(DRIVERS[k].id);
  const suspend = (uid = LGU, reason = 'Several complaints about fares charged above the posted rate; the LGU is reviewing.', until = null) =>
    rpc(uid, 'suspend_toda($1,$2,$3)', [ID.TODA1, reason, until]);
  const reinstate = (uid = LGU, note = 'The TODA corrected the fares and the LGU confirmed it.') => rpc(uid, 'reinstate_toda($1,$2)', [ID.TODA1, note]);
  const audits = (action, target = ID.TODA1) => q(`SELECT * FROM audit_log WHERE action_type = '${action}' AND target_id = '${target}' ORDER BY performed_at`);
  const clean = async () => {
    for (const k of ['D1', 'D2', 'D3']) if ((await avail(k)) !== 'Offline') await s.goOffline(DRIVERS[k].uid);
    await internal(`UPDATE booking SET booking_status = 'Cancelled', cancelled_by = 'system' WHERE booking_status NOT IN ('Cancelled', 'Completed')`);
    for (const k of ['D1', 'D2', 'D3']) if ((await avail(k)) !== 'Offline') await internal(`UPDATE driver SET availability_status = 'Offline' WHERE driver_id = '${DRIVERS[k].id}'`);
  };
  const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();

  console.log('S1 who can suspend, and what is refused');
  check('TODA One starts Active', (await toda()).toda_status === 'Active');
  let r = await suspend(ID.T_AUTH);
  check('the TODA\'s own administrator cannot suspend it (only the LGU)', r.ok && r.value.success === false && /Access Denied/.test(r.value.error) && (await toda()).toda_status === 'Active', r);
  r = await suspend(PAX.P1.uid);
  check('a passenger cannot', r.ok && r.value.success === false && /Access Denied/.test(r.value.error), r);
  r = await suspend(LGU, 'too short');
  check('a reason under 10 characters is refused: ERR_SUSPENSION_REASON', r.ok && r.value.success === false && r.value.error_code === 'ERR_SUSPENSION_REASON', r);
  r = await suspend(LGU, undefined, inDays(-1));
  check('an end date in the past is refused: ERR_SUSPENSION_END', r.ok && r.value.success === false && r.value.error_code === 'ERR_SUSPENSION_END', r);
  r = await suspend(LGU, undefined, inDays(400));
  check('an end date more than a year away is refused too', r.ok && r.value.success === false && r.value.error_code === 'ERR_SUSPENSION_END', r);
  r = await rpc(LGU, 'suspend_toda($1,$2,$3)', ['99999999-9999-9999-9999-999999999999', 'A reason that is long enough.', null]);
  check('an unknown TODA is refused', r.ok && r.value.success === false && /not found/i.test(r.value.error), r);
  r = await reinstate();
  check('reinstating a TODA that is not suspended is refused: ERR_NOT_SUSPENDED', r.ok && r.value.success === false && r.value.error_code === 'ERR_NOT_SUSPENDED', r);
  check('nothing changed after all the refusals', (await toda()).toda_status === 'Active' && (await audits('TODA_SUSPENDED')).length === 0);
  await internal(`UPDATE toda SET toda_status = 'Pending Verification' WHERE toda_id = '${ID.TODA2}'`);
  r = await rpc(LGU, 'suspend_toda($1,$2,$3)', [ID.TODA2, 'A reason that is long enough.', null]);
  check('a TODA that is not accredited (here: Pending Verification) cannot be suspended: ERR_TODA_NOT_ACTIVE', r.ok && r.value.success === false && r.value.error_code === 'ERR_TODA_NOT_ACTIVE', r);
  await internal(`UPDATE toda SET toda_status = 'Active' WHERE toda_id = '${ID.TODA2}'`);

  console.log('\nS2 the suspension: drivers go Offline, unanswered offers end, the search moves on');
  await s.online('D1', 300);
  await s.online('D3', 400);                                          // TODA Two: not suspended
  let b = await s.bookAs('P1');
  let o = await s.offers(b.booking_id);
  check('before: the offer is out to D1 (TODA One\'s driver, Tier 1)', o.length === 1 && o[0].driver_id === ID.D1 && o[0].response_status === 'Pending', o);
  r = await suspend(LGU, 'Several complaints about fares charged above the posted rate; the LGU is reviewing.', inDays(3));
  check('the LGU suspends TODA One with a reason and an end date three days away', r.ok && r.value.success === true && r.value.data.toda_status === 'Suspended', r);
  check('...and the answer counts what happened: one driver put Offline, one offer withdrawn, one driver told',
    r.value.drivers_set_offline === 1 && r.value.offers_withdrawn === 1 && r.value.drivers_notified >= 1 && r.value.drivers_finishing_trip === 0, r.value);
  let t = await toda();
  check('the TODA row keeps the reason, the time and the end date', t.toda_status === 'Suspended' && /fares charged above/.test(t.suspension_reason) && t.suspended_at !== null && new Date(t.suspended_until) > new Date(), t);
  check('D1 is Offline at once', (await avail('D1')) === 'Offline');
  check('D3 (another TODA) is untouched and still Available', (await avail('D3')) === 'Available');
  o = await s.offers(b.booking_id);
  check('D1\'s offer ended as Expired WITH a response time (so it is not counted as a missed offer)', o[0].response_status === 'Expired' && o[0].responded_at !== null && o[0].unanswered === false, o[0]);
  check('the search moved on to D3 at once (no waiting for the offer to run out)', o.length === 2 && o[1].driver_id === ID.D3 && o[1].response_status === 'Pending', o);
  check('no strike and no review flag for D1', (await s.strikes(ID.D1)).length === 0);
  const notice = await q(`SELECT * FROM notification WHERE driver_id = '${ID.D1}' AND notification_type = 'TODA_SUSPENDED'`);
  check('D1 was told, with the reason and the end date', notice.length === 1 && /fares charged above/.test(notice[0].message) && /sinuspinde/.test(notice[0].message) && /until/.test(notice[0].message), notice);
  const aud = await audits('TODA_SUSPENDED');
  check('the suspension is audited with who, why and what it did', aud.length === 1 && /fares charged above/.test(aud[0].details) && /Drivers put Offline: 1/.test(aud[0].details), aud);
  r = await suspend();
  check('suspending a TODA that is already suspended is refused: ERR_ALREADY_SUSPENDED', r.ok && r.value.success === false && r.value.error_code === 'ERR_ALREADY_SUSPENDED', r);
  await s.finish(b.booking_id); await clean();

  console.log('\nS3 while it lasts, the drivers of the TODA cannot travel');
  r = await s.online('D1', 300);
  check('D1 cannot go Online: ERR_TODA_SUSPENDED, with the TODA\'s name, the reason and the end date', r.success === false && r.error_code === 'ERR_TODA_SUSPENDED'
    && /fares charged above/.test(r.error) && /Suspendido/.test(r.error) && /until/.test(r.error), r);
  check('D1 is still Offline', (await avail('D1')) === 'Offline');
  let sus = await rpc(DRIVERS.D1.uid, 'get_my_toda_suspension()');
  check('D1\'s app can read the suspension (reason, since, until, message)', sus.ok && sus.value.suspended === true && /fares/.test(sus.value.reason) && sus.value.since && sus.value.until && /ERR_TODA_SUSPENDED/.test(sus.value.message), sus);
  const pres = await rpc(DRIVERS.D1.uid, 'driver_heartbeat()');
  check('...and the presence state D1\'s app polls carries it too', pres.ok && pres.value.toda_suspension && pres.value.toda_suspension.toda_name === sus.value.toda_name, pres);
  sus = await rpc(DRIVERS.D3.uid, 'get_my_toda_suspension()');
  check('a driver of another TODA reads "not suspended"', sus.ok && sus.value.suspended === false, sus);
  let d = await attempt(() => internal(`UPDATE driver SET availability_status = 'Available' WHERE driver_id = '${ID.D1}'`));
  check('even a direct write of Available is refused by the database (ERR_TODA_SUSPENDED)', !d.ok && /ERR_TODA_SUSPENDED/.test(d.error), d);
  b = await s.bookAs('P1');
  d = await attempt(() => internal(`UPDATE booking SET driver_id = '${ID.D1}', booking_status = 'Accepted' WHERE booking_id = '${b.booking_id}'`));
  check('a booking cannot be given to D1 (acceptance is refused: ERR_TODA_SUSPENDED)', !d.ok && /ERR_TODA_SUSPENDED/.test(d.error), d);
  d = await attempt(() => internal(`INSERT INTO dispatch_attempt (booking_id, driver_id, tier, cycle, driver_rank, response_status, notification_sent_at, expires_at)
                                    VALUES ('${b.booking_id}', '${ID.D1}', 1, 1, 9, 'Pending', clock_timestamp(), clock_timestamp() + interval '20 seconds')`));
  check('an offer cannot be written for D1 either', !d.ok && /ERR_TODA_SUSPENDED/.test(d.error), d);
  await s.finish(b.booking_id);
  b = await s.bookAs('P1');
  o = await s.offers(b.booking_id);
  check('a new booking is never offered to D1 (the search skips a suspended TODA)', !o.some((x) => x.driver_id === ID.D1), o);
  await s.finish(b.booking_id); await clean();
  const col = await attempt(() => as(ID.T_AUTH, (tx) => tx.query(`UPDATE toda SET suspension_reason = 'Nothing happened' WHERE toda_id = '${ID.TODA1}'`)));
  check('the TODA\'s own administrator cannot edit or clear the suspension with a table update', !col.ok && /Access Denied/.test(col.error), col);
  const clearIt = await attempt(() => as(ID.T_AUTH, (tx) => tx.query(`UPDATE toda SET reinstated_at = now() WHERE toda_id = '${ID.TODA1}'`)));
  check('...nor mark itself reinstated', !clearIt.ok && /Access Denied/.test(clearIt.error), clearIt);

  console.log('\nS4 reinstating');
  r = await reinstate(ID.T_AUTH);
  check('the TODA cannot reinstate itself', r.ok && r.value.success === false && /Access Denied/.test(r.value.error) && (await toda()).toda_status === 'Suspended', r);
  r = await reinstate(LGU, 'ok');
  check('reinstating without the LGU\'s own words (under 10 characters) is refused: ERR_DECISION_NOTE', r.ok && r.value.success === false && r.value.error_code === 'ERR_DECISION_NOTE', r);
  r = await reinstate();
  t = await toda();
  check('the LGU reinstates with its reason: Active again, the suspension cleared, the note and the time kept',
    r.ok && r.value.success === true && t.toda_status === 'Active' && t.suspension_reason === null && t.suspended_until === null && t.suspended_at === null
    && /corrected the fares/.test(t.reinstatement_note) && t.reinstated_at !== null, t);
  check('the drivers were told it is over', (await q(`SELECT * FROM notification WHERE driver_id = '${ID.D1}' AND notification_type = 'TODA_REINSTATED'`)).length === 1);
  check('the reinstatement is audited', (await audits('TODA_REINSTATED')).length === 1);
  r = await s.online('D1', 300);
  check('D1 goes Online again by itself: nothing was lost', r.success === true && (await avail('D1')) === 'Available', r);
  await clean();

  console.log('\nS5 a driver who is on a trip finishes it, then goes Offline');
  await s.online('D1', 300);
  b = await s.bookAs('P1');
  const offer = await s.pendingOffer(b.booking_id);
  const acc = await s.accept('D1', offer.attempt_id);
  check('D1 accepts a booking (a trip is now open)', acc.success === true && (await s.booking(b.booking_id)).driver_id === ID.D1, acc);
  r = await suspend();
  check('the LGU suspends the TODA while D1 has the trip: D1 is counted as "finishing a trip", not put Offline', r.ok && r.value.success === true
    && r.value.drivers_finishing_trip === 1 && r.value.drivers_set_offline === 0, r);
  check('D1 is still on the trip (not Offline)', (await avail('D1')) !== 'Offline' && (await s.booking(b.booking_id)).driver_id === ID.D1 && (await s.booking(b.booking_id)).booking_status === 'Accepted');
  const sess = await one(`SELECT * FROM driver_online_session WHERE driver_id = '${ID.D1}' AND ended_at IS NULL`);
  check('the session says the driver goes Offline when the trip ends (reason "system")', sess.offline_pending_reason === 'system', sess);
  await s.finish(b.booking_id);
  check('the trip ends: D1 goes Offline by itself', (await avail('D1')) === 'Offline');
  const last = await one(`SELECT end_reason FROM driver_online_session WHERE driver_id = '${ID.D1}' ORDER BY ended_at DESC LIMIT 1`);
  check('...and the session ended with the reason "system" (no strike, not a manual logout)', last.end_reason === 'system', last);
  r = await s.online('D1', 300);
  check('and D1 cannot start another', r.success === false && r.error_code === 'ERR_TODA_SUSPENDED', r);
  await reinstate(); await clean();

  console.log('\nS6 the end date lifts a suspension by itself');
  r = await suspend(LGU, 'A short suspension for a document check.', inDays(1));
  check('suspended with an end date tomorrow', r.ok && r.value.success === true);
  let n = (await svc((tx) => tx.query(`SELECT public.run_toda_suspension_job() AS n`))).rows[0].n;
  check('the watcher does nothing before the end date', Number(n) === 0 && (await toda()).toda_status === 'Suspended', n);
  await internal(`UPDATE toda SET suspended_until = clock_timestamp() - interval '1 minute' WHERE toda_id = '${ID.TODA1}'`);
  n = (await svc((tx) => tx.query(`SELECT public.run_toda_suspension_job() AS n`))).rows[0].n;
  t = await toda();
  check('after the end date the watcher lifts it: Active, cleared, the note says the period ended', Number(n) === 1 && t.toda_status === 'Active' && t.suspension_reason === null && /period set by the LGU ended/.test(t.reinstatement_note), { n, t });
  check('...audited as an ending by the clock, not as a person\'s decision', (await audits('TODA_SUSPENSION_ENDED')).length === 1);
  const sweepCall = await attempt(() => as(LGU, (tx) => tx.query(`SELECT public.lift_expired_toda_suspensions()`)));
  check('the watcher is not callable from an app', !sweepCall.ok && /permission denied/i.test(sweepCall.error), sweepCall);
  r = await suspend();
  check('an open-ended suspension (no end date) stays until the LGU lifts it', r.ok && r.value.success === true && (await toda()).suspended_until === null);
  await svc((tx) => tx.query(`SELECT public.run_toda_suspension_job()`));
  check('...the watcher leaves it alone', (await toda()).toda_status === 'Suspended');
  await reinstate(); await clean();

  console.log('\nS7 a passenger deactivates their own account');
  r = await rpc(PAX.P1.uid, 'deactivate_my_account($1,$2)', ['teacher', null]);
  check('a role that is neither passenger nor driver is refused', r.ok && r.value.success === false && r.value.error_code === 'ERR_ROLE', r);
  r = await rpc(PAX.P1.uid, 'deactivate_my_account($1,$2)', ['driver', null]);
  check('a passenger asking to deactivate a DRIVER account finds none: ERR_NO_ACCOUNT', r.ok && r.value.success === false && r.value.error_code === 'ERR_NO_ACCOUNT', r);
  b = await s.bookAs('P1');
  r = await rpc(PAX.P1.uid, 'deactivate_my_account($1,$2)', ['passenger', 'I do not need rides any more']);
  check('with a booking in progress it is refused: ERR_OPEN_BOOKING', r.ok && r.value.success === false && r.value.error_code === 'ERR_OPEN_BOOKING', r);
  await s.finish(b.booking_id);
  const done = await s.finished('P1', 'D1');
  const rep = await s.file('P1', done, 'Safety Concern');
  r = await rpc(PAX.P1.uid, 'deactivate_my_account($1,$2)', ['passenger', null]);
  check('with an open report it is refused: ERR_OPEN_CASE', rep.ok && r.ok && r.value.success === false && r.value.error_code === 'ERR_OPEN_CASE', { rep, r });
  await internal(`UPDATE incident_report SET status = 'Resolved', resolved_at = clock_timestamp() WHERE booking_id = '${done}'`);
  r = await rpc(PAX.P1.uid, 'deactivate_my_account($1,$2)', ['passenger', 'I do not need rides any more']);
  check('once nothing is open it succeeds', r.ok && r.value.success === true, r);
  let p = await one(`SELECT * FROM passenger WHERE passenger_id = '${ID.P1}'`);
  check('the account keeps its data and its Active status, and is marked self-deactivated with the time and the reason',
    p.self_deactivated_at !== null && /do not need rides/.test(p.self_deactivation_reason) && p.account_status === 'Active' && p.deactivated_at === null, p);
  let st = await s.restriction('passenger', ID.P1);
  check('the restriction state says SELF_DEACTIVATED (not the penalty "DEACTIVATED"), with the time', st.restricted === true && st.kind === 'SELF_DEACTIVATED' && st.since, st);
  const mine = await rpc(PAX.P1.uid, 'get_my_account_restriction($1)', ['passenger']);
  check('the app reads the same from get_my_account_restriction', mine.ok && mine.value.kind === 'SELF_DEACTIVATED' && mine.value.restricted === true, mine);
  const bk = await attempt(() => s.bookAs('P1'));
  check('a self-deactivated passenger cannot book: ERR_ACCOUNT_SELF_DEACTIVATED with the way back in the message', !bk.ok && /ERR_ACCOUNT_SELF_DEACTIVATED/.test(bk.error) && /Reactivate/.test(bk.error), bk);
  r = await rpc(PAX.P1.uid, 'deactivate_my_account($1,$2)', ['passenger', null]);
  check('deactivating twice is refused: ERR_ALREADY_RESTRICTED', r.ok && r.value.success === false && r.value.error_code === 'ERR_ALREADY_RESTRICTED', r);
  const forge = await attempt(() => as(PAX.P1.uid, (tx) => tx.query(`UPDATE passenger SET self_deactivated_at = NULL WHERE passenger_id = '${ID.P1}'`)));
  check('the passenger cannot clear it with a table update (only reactivate_my_account() does)', !forge.ok && /Access Denied/.test(forge.error), forge);
  const forge2 = await attempt(() => as(PAX.P2.uid, (tx) => tx.query(`UPDATE passenger SET self_deactivated_at = now() WHERE passenger_id = '${ID.P2}'`)));
  check('...nor set it', !forge2.ok && /Access Denied/.test(forge2.error), forge2);
  check('the deactivation is audited', (await audits('ACCOUNT_SELF_DEACTIVATED', ID.P1)).length === 1);

  console.log('\nS8 and brings it back');
  r = await rpc(PAX.P2.uid, 'reactivate_my_account($1)', ['passenger']);
  check('reactivating an account that is not deactivated is harmless ("already active")', r.ok && r.value.success === true && r.value.already_active === true, r);
  r = await rpc(PAX.P1.uid, 'reactivate_my_account($1)', ['passenger']);
  check('reactivating works for the account holder and says nothing else restricts it', r.ok && r.value.success === true && r.value.restriction.restricted === false, r);
  p = await one(`SELECT * FROM passenger WHERE passenger_id = '${ID.P1}'`);
  check('the marks are cleared', p.self_deactivated_at === null && p.self_deactivation_reason === null, p);
  b = await s.bookAs('P1');
  check('and the passenger books again', !!b.booking_id, b);
  await s.finish(b.booking_id);
  check('the reactivation is audited', (await audits('ACCOUNT_SELF_REACTIVATED', ID.P1)).length === 1);
  await rpc(PAX.P1.uid, 'deactivate_my_account($1,$2)', ['passenger', null]);
  await internal(`UPDATE passenger SET account_status = 'Deactivated', deactivated_at = clock_timestamp() WHERE passenger_id = '${ID.P1}'`);
  st = await s.restriction('passenger', ID.P1);
  check('a penalty deactivation outranks the self-deactivation in what the person is told', st.kind === 'DEACTIVATED', st);
  r = await rpc(PAX.P1.uid, 'reactivate_my_account($1)', ['passenger']);
  check('reactivating then lifts only the person\'s own pause: the penalty still applies and the answer says so', r.ok && r.value.success === true && r.value.restriction.restricted === true && r.value.restriction.kind === 'DEACTIVATED', r);
  await internal(`UPDATE passenger SET account_status = 'Active', deactivated_at = NULL WHERE passenger_id = '${ID.P1}'`);

  console.log('\nS9 a driver deactivates their own account');
  await s.online('D1', 300);
  b = await s.bookAs('P2');
  const off1 = await s.pendingOffer(b.booking_id);
  r = await rpc(DRIVERS.D1.uid, 'deactivate_my_account($1,$2)', ['driver', 'Changing job']);
  check('an unanswered offer is not a trip: a driver who holds one can deactivate', off1 && r.ok && r.value.success === true, r);
  const offered = await s.offers(b.booking_id);
  check('the unanswered offer was withdrawn (Expired with a response time, so no missed-offer count)', offered[0].response_status === 'Expired' && offered[0].responded_at !== null && offered[0].unanswered === false, offered[0]);
  check('the driver is Offline', (await avail('D1')) === 'Offline');
  check('the driver is told ERR_ACCOUNT_SELF_DEACTIVATED when going Online', (await s.online('D1', 300)).error_code === 'ERR_ACCOUNT_SELF_DEACTIVATED');
  st = await s.restriction('driver', ID.D1);
  check('the restriction state says SELF_DEACTIVATED', st.kind === 'SELF_DEACTIVATED', st);
  r = await rpc(DRIVERS.D1.uid, 'reactivate_my_account($1)', ['driver']);
  check('the driver reactivates', r.ok && r.value.success === true && r.value.restriction.restricted === false, r);
  check('...and goes Online again', (await s.online('D1', 300)).success === true);
  await s.finish(b.booking_id); await clean();
  await s.online('D1', 300);
  b = await s.bookAs('P2');
  const off2 = await s.pendingOffer(b.booking_id);
  await s.accept('D1', off2.attempt_id);
  r = await rpc(DRIVERS.D1.uid, 'deactivate_my_account($1,$2)', ['driver', null]);
  check('a driver with an accepted trip is refused: ERR_OPEN_BOOKING', r.ok && r.value.success === false && r.value.error_code === 'ERR_OPEN_BOOKING', r);
  await s.finish(b.booking_id); await clean();

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
