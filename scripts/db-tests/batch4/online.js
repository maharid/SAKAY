// Batch 4: going Online (preconditions), affiliation selection and lock (T3), vehicle lock,
// heartbeat / single publisher, and what the server reports back after a refresh (T1/T2 DB side).
const { setup, AFF, ID, attempt, check, summary, asUser } = require('../b4fixtures');

(async () => {
  const t = await setup();
  const { db, as, svc, internal, rpc, goOnline, goOffline, presence, one, q, openSession, status } = t;

  console.log('Preconditions (Rules 3.1, 3.10, 17.7)');
  let r = await goOnline(ID.D3_AUTH);
  check('a driver with no VERIFIED affiliation cannot go online (ERR_NO_VERIFIED_AFFILIATION)', r.success === false && r.error_code === 'ERR_NO_VERIFIED_AFFILIATION', r);
  check('...and stays Offline with no session', (await status(ID.D3)) === 'Offline' && !(await openSession(ID.D3)));

  r = await goOnline(ID.D2_AUTH);
  check('two verified affiliations and none selected -> must select first (ERR_SELECT_AFFILIATION)', r.success === false && r.error_code === 'ERR_SELECT_AFFILIATION', r);

  r = await goOnline(ID.D_AUTH, null, null, null);
  check('no position at all (permission not granted) -> ERR_LOCATION_REQUIRED', r.error_code === 'ERR_LOCATION_REQUIRED', r);
  r = await goOnline(ID.D_AUTH, 13.41, 121.18, 250, 100);
  check('accuracy worse than 100 m -> ERR_LOCATION_INACCURATE', r.error_code === 'ERR_LOCATION_INACCURATE', r);
  r = await goOnline(ID.D_AUTH, 13.41, 121.18, 15, 60_000);
  check('a fix older than 45 s -> ERR_LOCATION_STALE', r.error_code === 'ERR_LOCATION_STALE', r);
  check('none of those failures changed anything', (await status(ID.D1)) === 'Offline' && !(await openSession(ID.D1)));

  await internal(`UPDATE driver SET suspended_until = now() + interval '2 days', suspension_kind='LADDER', account_status='Suspended' WHERE driver_id='${ID.D1}'`);
  r = await goOnline(ID.D_AUTH);
  check('a suspended driver is refused with the real reason', r.success === false && r.error_code === 'ERR_ACCOUNT_SUSPENDED' && /PHT/.test(r.error), r);
  await internal(`UPDATE driver SET suspended_until = NULL, suspension_kind=NULL, account_status='Verified' WHERE driver_id='${ID.D1}'`);

  await internal(`UPDATE driver SET license_expiry = current_date - 3 WHERE driver_id='${ID.D1}'`);
  r = await goOnline(ID.D_AUTH);
  check('an expired licence is refused (ERR_DOCUMENT_EXPIRED)', r.error_code === 'ERR_DOCUMENT_EXPIRED', r);
  await internal(`UPDATE driver SET license_expiry = NULL WHERE driver_id='${ID.D1}'`);

  console.log('\nGoing online (single verified affiliation is selected automatically)');
  r = await goOnline(ID.D_AUTH, 13.4115, 121.1803, 12, 300);
  const s1 = await openSession(ID.D1);
  const d1 = await one(`SELECT availability_status, toda_id, current_latitude, last_location_accuracy_m, last_location_update FROM driver WHERE driver_id='${ID.D1}'`);
  const aff = await one(`SELECT is_active_selection a FROM driver_toda_affiliation WHERE affiliation_id='${AFF.D1_T1}'`);
  check('go online succeeds and returns the server state', r.success === true && r.online === true && r.availability_status === 'Available', r);
  check('exactly one open session, tied to the active TODA', !!s1 && s1.toda_id === ID.TODA1 && s1.affiliation_id === AFF.D1_T1, s1);
  check('the only verified affiliation became the active selection', aff.a === true);
  check('the first position was stored with its accuracy', d1.current_latitude === 13.4115 && d1.last_location_accuracy_m === 12 && !!d1.last_location_update, d1);

  console.log('\nT1/T2 (database side): the server is the source of truth');
  r = await goOnline(ID.D_AUTH);
  check('a second go-online (second tab / double tap) is idempotent', r.success === true && r.already_online === true, r);
  check('...and still exactly one open session', (await q(`SELECT 1 FROM driver_online_session WHERE driver_id='${ID.D1}' AND ended_at IS NULL`)).length === 1);
  const p1 = await presence(ID.D_AUTH);
  check('after a refresh / reopen the server still reports Online with the same session', p1.online === true && p1.session.session_id === s1.session_id, p1);
  const dupe = await attempt(() => db.exec(`INSERT INTO driver_online_session(driver_id) VALUES ('${ID.D1}')`));
  check('the database itself refuses a second open session', !dupe.ok && /uq_driver_online_session_open/.test(dupe.error), dupe);

  console.log('\nOne publisher: heartbeat');
  const before = await one(`SELECT last_heartbeat_at h FROM driver_online_session WHERE session_id='${s1.session_id}'`);
  await db.exec(`UPDATE driver_online_session SET last_heartbeat_at = now() - interval '2 minutes' WHERE session_id='${s1.session_id}'`);
  r = await rpc(ID.D_AUTH, 'driver_heartbeat', [13.4120, 121.1810, 20]);
  const d1b = await one(`SELECT current_latitude lat, last_location_accuracy_m acc FROM driver WHERE driver_id='${ID.D1}'`);
  const hb = await one(`SELECT last_heartbeat_at h FROM driver_online_session WHERE session_id='${s1.session_id}'`);
  check('a heartbeat publishes the position and refreshes presence', r.location_accepted === true && d1b.lat === 13.412 && d1b.acc === 20 && new Date(hb.h) > new Date(Date.now() - 60_000), { r, d1b });
  r = await rpc(ID.D_AUTH, 'driver_heartbeat', [10, 10, 400]);
  const d1c = await one(`SELECT current_latitude lat FROM driver WHERE driver_id='${ID.D1}'`);
  check('a low-accuracy fix is NOT published (the last good position is kept) but the heartbeat still counts', r.location_accepted === false && r.location_rejected_reason === 'low_accuracy' && d1c.lat === 13.412, { r, d1c });
  r = await rpc(ID.D_AUTH, 'driver_heartbeat', [null, null, null]);
  check('a heartbeat with no position keeps presence alive and publishes nothing', r.success === true && r.location_accepted === false && r.location_rejected_reason === 'no_position', r);
  r = await rpc(ID.D_AUTH, 'driver_heartbeat', [95, 10, 10]);
  check('an impossible coordinate is not published', r.location_accepted === false, r);
  await rpc(ID.D_AUTH, 'driver_heartbeat', [13.4121, 121.1811, 18]);
  check('driver_has_fresh_location() is true for a fresh accurate fix', (await one(`SELECT public.driver_has_fresh_location('${ID.D1}') f`)).f === true);
  await db.exec(`UPDATE driver SET last_location_update = now() - interval '2 minutes' WHERE driver_id='${ID.D1}'`);
  check('...and false once the fix is older than 45 s', (await one(`SELECT public.driver_has_fresh_location('${ID.D1}') f`)).f === false);

  console.log('\nDirect writes cannot bypass the preconditions');
  await goOffline(ID.D_AUTH);
  const direct = await as(ID.D_AUTH, (tx) => attempt(() => tx.query(`UPDATE driver SET availability_status='Available' WHERE driver_id='${ID.D1}'`)));
  check('a driver cannot set Available with a plain UPDATE (ERR_USE_GO_ONLINE)', !direct.ok && /ERR_USE_GO_ONLINE/.test(direct.error), direct);
  const directD3 = await as(ID.D3_AUTH, (tx) => attempt(() => tx.query(`UPDATE driver SET availability_status='Available' WHERE driver_id='${ID.D3}'`)));
  check('the older checks still run first (no verified affiliation -> ERR_DOCUMENT_EXPIRED)', !directD3.ok && /ERR_DOCUMENT_EXPIRED/.test(directD3.error), directD3);
  check('neither attempt changed the status', (await status(ID.D1)) === 'Offline' && (await status(ID.D3)) === 'Offline');
  const svcOnline = await svc((tx) => attempt(() => tx.query(`UPDATE driver SET availability_status='Available' WHERE driver_id='${ID.D1}'`)));
  check('the service role (system) can still set status (for repair / seed)', svcOnline.ok && svcOnline.value.rowCount === 1, svcOnline);
  await svc((tx) => tx.query(`UPDATE driver SET availability_status='Offline' WHERE driver_id='${ID.D1}'`));

  console.log('\nT3: two affiliations, selection and lock (Rules 3.1, 3.10)');
  r = await rpc(ID.D2_AUTH, 'select_active_driver_affiliation', [AFF.D2_T2]);
  check('while Offline the driver selects TODA2', r.success === true && r.active_toda_id === ID.TODA2, r);
  r = await goOnline(ID.D2_AUTH);
  const s2 = await openSession(ID.D2);
  check('going online uses ONLY the selected affiliation', r.success === true && s2.toda_id === ID.TODA2 && s2.affiliation_id === AFF.D2_T2, { r, s2 });
  r = await rpc(ID.D2_AUTH, 'select_active_driver_affiliation', [AFF.D2_T1]);
  check('changing the active affiliation while Online is refused (ERR_MUST_BE_OFFLINE)', r.success === false && /ERR_MUST_BE_OFFLINE/.test(r.error), r);
  const ptr = await as(ID.D2_AUTH, (tx) => attempt(() => tx.query(`UPDATE driver SET toda_id='${ID.TODA1}' WHERE driver_id='${ID.D2}'`)));
  check('the toda_id pointer cannot be rewritten directly', !ptr.ok && /select_active_driver_affiliation/.test(ptr.error), ptr);
  const flip = await as(ID.D2_AUTH, (tx) => attempt(() => tx.query(`UPDATE driver_toda_affiliation SET is_active_selection = TRUE WHERE affiliation_id='${AFF.D2_T1}'`)));
  check('is_active_selection cannot be flipped directly', !flip.ok, flip);
  check('the active TODA is unchanged', (await one(`SELECT toda_id t FROM driver WHERE driver_id='${ID.D2}'`)).t === ID.TODA2);
  await goOffline(ID.D2_AUTH);
  r = await rpc(ID.D2_AUTH, 'select_active_driver_affiliation', [AFF.D2_T1]);
  check('after going Offline the driver may switch', r.success === true && r.active_toda_id === ID.TODA1, r);
  r = await goOnline(ID.D2_AUTH);
  check('the next session uses the newly selected affiliation', r.success === true && (await openSession(ID.D2)).toda_id === ID.TODA1, r);

  console.log('\nExpired TODA invalidates the selection');
  await goOffline(ID.D2_AUTH);
  await internal(`UPDATE toda SET certificate_expiry = now() - interval '2 days' WHERE toda_id='${ID.TODA1}'`);
  r = await goOnline(ID.D2_AUTH);
  check('selected TODA expired and exactly one verified affiliation remains -> that one becomes active (same as first-time rule)',
    r.success === true && r.active_toda_id === ID.TODA2 && (await openSession(ID.D2)).affiliation_id === AFF.D2_T2, r);
  await goOffline(ID.D2_AUTH);
  await internal(`UPDATE toda SET certificate_expiry = now() - interval '2 days' WHERE toda_id='${ID.TODA2}'`);
  r = await goOnline(ID.D2_AUTH);
  check('every verified affiliation expired -> cannot go online (ERR_NO_VERIFIED_AFFILIATION)', r.success === false && r.error_code === 'ERR_NO_VERIFIED_AFFILIATION', r);
  await internal(`UPDATE toda SET certificate_expiry = now() + interval '1 year'`);

  console.log('\nVehicle lock (Rules 3.10, 29.18)');
  await internal(`UPDATE driver SET plate_number='ABC 123', franchise_number='F-1' WHERE driver_id='${ID.D1}'`);
  const swap = await as(ID.D_AUTH, (tx) => attempt(() => tx.query(`UPDATE driver SET plate_number='ZZZ 999' WHERE driver_id='${ID.D1}'`)));
  check('a verified driver cannot change the plate number', !swap.ok && /ERR_VEHICLE_LOCKED/.test(swap.error), swap);
  const swap2 = await as(ID.D_AUTH, (tx) => attempt(() => tx.query(`UPDATE driver SET franchise_number='F-9' WHERE driver_id='${ID.D1}'`)));
  check('...nor the franchise number', !swap2.ok && /ERR_VEHICLE_LOCKED/.test(swap2.error), swap2);
  const same = await as(ID.D_AUTH, (tx) => attempt(() => tx.query(`UPDATE driver SET plate_number='ABC 123', full_name='Driver One' WHERE driver_id='${ID.D1}'`)));
  check('writing the same value back (profile save) is harmless', same.ok && same.value.rowCount === 1, same);
  const lgu = await as(ID.L_AUTH, (tx) => attempt(() => tx.query(`UPDATE driver SET plate_number='NEW 111' WHERE driver_id='${ID.D1}'`)));
  check('an LGU administrator can approve a substitution', lgu.ok && lgu.value.rowCount === 1, lgu);
  await internal(`UPDATE driver SET account_status='Pending Verification' WHERE driver_id='${ID.D3}'`);
  const pre = await as(ID.D3_AUTH, (tx) => attempt(() => tx.query(`UPDATE driver SET plate_number='APPLY 1' WHERE driver_id='${ID.D3}'`)));
  check('a driver who is still applying can still enter their vehicle details', pre.ok && pre.value.rowCount === 1, pre);

  console.log('\nAccess control');
  const anon = await asUser(db, { role: 'anon' }, (tx) => attempt(() => tx.query(`SELECT public.driver_go_online(13.4,121.1,10,0)`)), { commit: true });
  check('the anonymous role cannot call the presence functions', !anon.ok, anon);
  const nobody = await as('99999999-9999-9999-9999-999999999999', (tx) => tx.query(`SELECT public.driver_go_online(13.4,121.1,10,0) r`));
  check('a login that is not a driver gets ERR_NOT_A_DRIVER', nobody.rows[0].r.error_code === 'ERR_NOT_A_DRIVER', nobody.rows[0]);
  const rls = await as(ID.D3_AUTH, (tx) => tx.query(`SELECT count(*)::int n FROM driver_online_session`));
  check('a driver can only read their own sessions (RLS)', rls.rows[0].n === 0);
  const w = await as(ID.D_AUTH, (tx) => attempt(() => tx.query(`UPDATE driver_online_session SET unanswered_streak = 0`)));
  check('sessions cannot be edited by clients', !w.ok, w);
  const ta = await as(ID.T_AUTH, (tx) => tx.query(`SELECT count(*)::int n FROM driver_online_session`));
  check('a TODA admin can see sessions of their own TODA only', ta.rows[0].n >= 1 && (await as(ID.T2_AUTH, (tx) => tx.query(`SELECT count(*)::int n FROM driver_online_session WHERE toda_id='${ID.TODA1}'`))).rows[0].n === 0);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
