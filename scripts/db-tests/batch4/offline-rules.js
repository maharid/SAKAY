// Batch 4: T4 (location permission lost), T6 (Offline always allowed unless a booking is open),
// the stale-heartbeat sweep, and the Rules 5.3 / 5.7 report -> confirmation -> strike path.
const { setup, AFF, ID, attempt, check, summary, asUser } = require('../b4fixtures');

(async () => {
  const t = await setup();
  const { db, as, svc, internal, rpc, goOnline, goOffline, presence, one, q, openSession, lastSession, status, mkBooking } = t;
  const ledger = async (id) => (await one(`SELECT count(*)::int n FROM strikes_ledger WHERE subject_id='${id}'`)).n;

  console.log('T6: Offline is always allowed and never penalized (Rule 5.5)');
  await goOnline(ID.D_AUTH);
  let r = await goOffline(ID.D_AUTH);
  let last = await lastSession(ID.D1);
  check('a driver can go Offline at any time', r.success === true && r.online === false && (await status(ID.D1)) === 'Offline', r);
  check('...recorded as a manual Offline with no strike', last.end_reason === 'manual' && (await ledger(ID.D1)) === 0 && (await one(`SELECT strikes_count c FROM driver WHERE driver_id='${ID.D1}'`)).c === 0, last);
  r = await goOffline(ID.D_AUTH);
  check('going Offline again is a harmless no-op', r.success === true && r.already_offline === true, r);

  await goOnline(ID.D_AUTH);
  const bk = await mkBooking(ID.P1, 'Accepted', ID.D1);
  r = await goOffline(ID.D_AUTH);
  check('with an open accepted booking, going Offline is refused (ERR_OPEN_BOOKING)', r.success === false && r.error_code === 'ERR_OPEN_BOOKING', r);
  const direct = await as(ID.D_AUTH, (tx) => attempt(() => tx.query(`UPDATE driver SET availability_status='Offline' WHERE driver_id='${ID.D1}'`)));
  check('...and a plain UPDATE cannot get around it either', !direct.ok && /ERR_OPEN_BOOKING/.test(direct.error), direct);
  check('the driver is still Online', (await status(ID.D1)) === 'Available');
  for (const st of ['Driver Arrived', 'In Transit', 'Trip Ongoing', 'Arrived at Destination']) {
    await internal(`UPDATE booking SET booking_status='${st}' WHERE booking_id='${bk}'`);
    const x = await goOffline(ID.D_AUTH);
    check(`booking status "${st}" still counts as open`, x.success === false && x.error_code === 'ERR_OPEN_BOOKING', x);
  }
  await internal(`UPDATE booking SET booking_status='Completed' WHERE booking_id='${bk}'`);
  r = await goOffline(ID.D_AUTH);
  check('once the booking is completed the driver can go Offline', r.success === true && (await status(ID.D1)) === 'Offline', r);
  const bk2 = await mkBooking(ID.P1, 'Accepted', ID.D1);
  await internal(`UPDATE booking SET booking_status='Cancelled' WHERE booking_id='${bk2}'`);
  await goOnline(ID.D_AUTH);
  check('a cancelled booking does not block Offline', (await goOffline(ID.D_AUTH)).success === true);

  console.log('\nT4: location permission revoked while Online (Rule 17.7)');
  await goOnline(ID.D_AUTH);
  r = await rpc(ID.D_AUTH, 'driver_report_location_unavailable', ['permission revoked in browser']);
  last = await lastSession(ID.D1);
  check('permission loss sets the driver Offline immediately', r.success === true && r.reauth_required === true && (await status(ID.D1)) === 'Offline', r);
  check('...with the reason recorded, so the app can show the re-authorization prompt', last.end_reason === 'location_permission_revoked' && (await presence(ID.D_AUTH)).last_session_end.reason === 'location_permission_revoked', last);
  check('...audited', (await q(`SELECT 1 FROM audit_log WHERE action_type='DRIVER_LOCATION_PERMISSION_LOST' AND target_id='${ID.D1}'`)).length === 1);
  check('...and without a strike', (await ledger(ID.D1)) === 0);
  r = await goOnline(ID.D_AUTH, null, null, null);
  check('cannot go Online again without a position (permission still off)', r.success === false && r.error_code === 'ERR_LOCATION_REQUIRED', r);
  r = await goOnline(ID.D_AUTH, 13.41, 121.18, 10, 200);
  check('once permission is back and a fix arrives, the driver can go Online again', r.success === true && r.online === true, r);

  console.log('\n...during an open booking the trip is not abandoned (PI-B4-2)');
  const bk3 = await mkBooking(ID.P2, 'Accepted', ID.D1);
  r = await rpc(ID.D_AUTH, 'driver_report_location_unavailable', ['revoked mid-trip']);
  check('permission lost mid-trip: recorded, driver stays Online until the trip ends', r.success === true && r.deferred === true && (await status(ID.D1)) === 'Available', r);
  check('...the pending Offline is stored on the session', (await openSession(ID.D1)).offline_pending_reason === 'location_permission_revoked');
  await internal(`UPDATE booking SET booking_status='Trip Ongoing' WHERE booking_id='${bk3}'`);
  check('...still Online while the trip is ongoing', (await status(ID.D1)) === 'Available');
  await svc((tx) => tx.query(`UPDATE booking SET booking_status='Completed' WHERE booking_id='${bk3}'`));
  last = await lastSession(ID.D1);
  check('when the booking completes the driver is set Offline with the permission reason', (await status(ID.D1)) === 'Offline' && last.end_reason === 'location_permission_revoked', last);

  console.log('\nOther ways a session ends are recorded too');
  await goOnline(ID.D_AUTH);
  await internal(`UPDATE driver SET availability_status='Offline' WHERE driver_id='${ID.D1}'`);
  check('a system / admin forced Offline closes the session with reason "system"', (await lastSession(ID.D1)).end_reason === 'system' && !(await openSession(ID.D1)));
  await goOnline(ID.D_AUTH);
  const susp = await as(ID.L_AUTH, (tx) => attempt(() => tx.query(`SELECT public.admin_suspend_account('driver','${ID.D1}',3,'investigation')`)));
  check('a suspension (Batch 3) sets the Online driver Offline and closes the session', susp.ok && (await status(ID.D1)) === 'Offline' && !(await openSession(ID.D1)) && (await lastSession(ID.D1)).end_reason === 'system', susp);
  const reinst = await as(ID.L_AUTH, (tx) => attempt(() => tx.query(`SELECT public.admin_reinstate_account('driver','${ID.D1}','done',true)`)));
  check('after reinstatement the driver can go Online again', reinst.ok && (await goOnline(ID.D_AUTH)).success === true, reinst);
  await goOffline(ID.D_AUTH);

  console.log('\nT2: the server tells a reopened app the truth');
  await goOnline(ID.D_AUTH);
  await db.exec(`UPDATE driver_online_session SET last_heartbeat_at = now() - interval '6 minutes' WHERE driver_id='${ID.D1}' AND ended_at IS NULL`);
  const nonSvc = await as(ID.D_AUTH, (tx) => attempt(() => tx.query(`SELECT public.sweep_driver_presence()`)));
  check('a driver cannot run the presence sweep', !nonSvc.ok, nonSvc);
  const sw = (await svc((tx) => tx.query(`SELECT public.sweep_driver_presence() r`))).rows[0].r;
  last = await lastSession(ID.D1);
  check('sweep: a driver whose app stopped reporting (6 min) is set Offline', sw.set_offline === 1 && (await status(ID.D1)) === 'Offline' && last.end_reason === 'stale_heartbeat', { sw, last });
  check('...without a strike, and audited', (await ledger(ID.D1)) === 0 && (await q(`SELECT 1 FROM audit_log WHERE action_type='DRIVER_AUTO_OFFLINE_STALE' AND target_id='${ID.D1}'`)).length === 1);
  const reopened = await presence(ID.D_AUTH);
  check('after reopening, the app is told Offline and why (not left showing Online)', reopened.online === false && reopened.last_session_end.reason === 'stale_heartbeat', reopened);
  const hb = await rpc(ID.D_AUTH, 'driver_heartbeat', [13.5, 121.5, 10]);
  check('a heartbeat from an Offline driver reports Offline and publishes nothing', hb.online === false && hb.location_accepted === false && (await one(`SELECT current_latitude l FROM driver WHERE driver_id='${ID.D1}'`)).l !== 13.5, hb);
  await goOnline(ID.D_AUTH);
  await db.exec(`UPDATE driver_online_session SET last_heartbeat_at = now() - interval '4 minutes' WHERE driver_id='${ID.D1}' AND ended_at IS NULL`);
  const sw2 = (await svc((tx) => tx.query(`SELECT public.sweep_driver_presence() r`))).rows[0].r;
  check('4 minutes of silence is inside the 5-minute allowance', sw2.set_offline === 0 && (await status(ID.D1)) === 'Available', sw2);
  const bk4 = await mkBooking(ID.P1, 'Accepted', ID.D1);
  await db.exec(`UPDATE driver_online_session SET last_heartbeat_at = now() - interval '20 minutes' WHERE driver_id='${ID.D1}' AND ended_at IS NULL`);
  const sw3 = (await svc((tx) => tx.query(`SELECT public.sweep_driver_presence() r`))).rows[0].r;
  check('a driver with an open booking is not swept (Section 9 handles unreachable drivers)', sw3.set_offline === 0 && sw3.skipped_open_booking === 1 && (await status(ID.D1)) === 'Available', sw3);
  await internal(`UPDATE booking SET booking_status='Completed' WHERE booking_id='${bk4}'`);
  await goOffline(ID.D_AUTH);

  console.log('\nRules 5.3 / 5.7: report -> administrator confirmation -> strike');
  const report = (uid, driver, kind, booking, text) => as(uid, (tx) => attempt(() => tx.query(`SELECT public.report_driver_availability_violation($1,$2,$3,$4) r`, [driver, kind, booking, text])));
  const book1 = await mkBooking(ID.P1, 'Completed', ID.D1);
  let rep = await report(ID.T_AUTH, ID.D1, 'QUEUE_CONFLICT', null, 'Seen in the terminal queue while accepting an app booking.');
  const flagId = rep.value && rep.value.rows[0].r.flag_id;
  check('a TODA administrator can report a driver of their own TODA', rep.ok && !!flagId, rep);
  check('...the report is a flag only: NO strike yet', (await ledger(ID.D1)) === 0 && (await one(`SELECT status, flag_type, assigned_role FROM admin_review_flag WHERE flag_id='${flagId}'`)).flag_type === 'DRIVER_QUEUE_CONFLICT_REPORT');
  const rep2 = await report(ID.T_AUTH, ID.D1, 'QUEUE_CONFLICT', null, 'Again.');
  check('reporting the same thing again returns the same open flag', rep2.ok && rep2.value.rows[0].r.flag_id === flagId, rep2);
  const wrongToda = await report(ID.T2_AUTH, ID.D1, 'QUEUE_CONFLICT', null, 'not my driver');
  check("a TODA administrator cannot report another TODA's driver", !wrongToda.ok && /Access Denied/.test(wrongToda.error), wrongToda);
  const strangerPax = await report(ID.P2_AUTH, ID.D1, 'AVAILABILITY_VIOLATION', null, 'x');
  check('a passenger with no booking served by that driver cannot report', !strangerPax.ok, strangerPax);
  const noText = await report(ID.T_AUTH, ID.D1, 'AVAILABILITY_VIOLATION', null, '  ');
  check('a report needs a description', !noText.ok, noText);
  const paxRep = await report(ID.P_AUTH, ID.D1, 'AVAILABILITY_VIOLATION', book1, 'Driver was carrying another passenger and still accepted my booking.');
  check('the passenger of a booking this driver served can report (Rule 5.7)', paxRep.ok, paxRep);

  const confirm = (uid, flag, reason) => as(uid, (tx) => attempt(() => tx.query(`SELECT public.confirm_driver_availability_violation($1,$2) r`, [flag, reason])));
  const noReason = await confirm(ID.T_AUTH, flagId, '');
  check('confirming needs a reason', !noReason.ok, noReason);
  const otherAdmin = await confirm(ID.T2_AUTH, flagId, 'I am not their admin');
  check("another TODA's administrator cannot confirm", !otherAdmin.ok, otherAdmin);
  check('...still no strike and the flag is still open', (await ledger(ID.D1)) === 0 && (await one(`SELECT status s FROM admin_review_flag WHERE flag_id='${flagId}'`)).s === 'Open');
  const ok = await confirm(ID.T_AUTH, flagId, 'Confirmed by terminal marshal and dispatch log.');
  const row = await one(`SELECT violation_code, points_active, status FROM strikes_ledger WHERE subject_id='${ID.D1}'`);
  check('the TODA administrator confirms: exactly one DRV_QUEUE_CONFLICT strike of 1 point', ok.ok && row && row.violation_code === 'DRV_QUEUE_CONFLICT' && row.points_active === 1 && (await ledger(ID.D1)) === 1, { ok, row });
  check('...and the flag is resolved', (await one(`SELECT status s FROM admin_review_flag WHERE flag_id='${flagId}'`)).s === 'Resolved');
  const again = await confirm(ID.T_AUTH, flagId, 'click twice');
  check('confirming twice does not strike twice', !again.ok && (await ledger(ID.D1)) === 1, again);

  const paxFlag = paxRep.value.rows[0].r.flag_id;
  await as(ID.L_AUTH, (tx) => tx.query(`SELECT public.resolve_admin_review_flag($1,'Dismissed','Not substantiated')`, [paxFlag]));
  check('dismissing a report issues no strike', (await ledger(ID.D1)) === 1 && (await one(`SELECT status s FROM admin_review_flag WHERE flag_id='${paxFlag}'`)).s === 'Dismissed');
  const lguRep = await report(ID.L_AUTH, ID.D1, 'AVAILABILITY_VIOLATION', null, 'Investigation finding.');
  const lguOk = await confirm(ID.L_AUTH, lguRep.value.rows[0].r.flag_id, 'Investigation upheld.');
  check('an LGU administrator can confirm an availability violation (Rule 5.7)', lguOk.ok && (await one(`SELECT count(*)::int n FROM strikes_ledger WHERE subject_id='${ID.D1}' AND violation_code='DRV_AVAILABILITY_VIOLATION'`)).n === 1, lguOk);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
