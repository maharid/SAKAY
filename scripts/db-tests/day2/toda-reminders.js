// Day 2: a TODA administrator sends a reminder to the verified drivers of their own TODA (migration 20261013000001).
const { freshDb, asUser, check, summary } = require('../tlib');
const { ID, seed } = require('../fixtures');

(async () => {
  const db = await freshDb();
  await seed(db);
  const as = (uid, fn) => asUser(db, { uid }, fn, { commit: true });
  const internal = (sql) => db.exec(`SELECT set_config('sakay.internal_context','true',false); ${sql}; SELECT set_config('sakay.internal_context','',false);`);
  const send = async (uid, audience, title = 'Meeting', message = 'General assembly on Saturday, 2 PM.') =>
    (await as(uid, (tx) => tx.query(`SELECT public.send_toda_driver_reminder($1,$2,$3) AS r`, [audience, title, message]))).rows[0].r;
  const notes = async (driver) => (await db.query(`SELECT title, message, notification_type FROM notification WHERE driver_id='${driver}' ORDER BY sent_at`)).rows;
  const clearThrottle = () => db.exec(`UPDATE audit_log SET performed_at = performed_at - interval '2 minutes' WHERE action_type = 'TODA_REMINDER_SENT'`);

  // TODA 1: D1 verified member (license fine), D2 verified member (license expires in 10 days), plus a member who is still pending.
  // TODA 2: D3 verified member. D3 must never hear from TODA 1's administrator.
  await internal(`
    UPDATE toda SET toda_status='Active', certificate_expiry = now() + interval '1 year';
    INSERT INTO driver_toda_affiliation(driver_id,toda_id,toda_endorsement_status,lgu_verification_status) VALUES
      ('${ID.D1}','${ID.TODA1}','Endorsed','Approved'),
      ('${ID.D2}','${ID.TODA1}','Endorsed','Approved'),
      ('${ID.D3}','${ID.TODA2}','Endorsed','Approved')`);
  await internal(`UPDATE driver SET license_expiry = CURRENT_DATE + 200, mtop_expiry = CURRENT_DATE + 200 WHERE driver_id = '${ID.D1}';
                  UPDATE driver SET license_expiry = CURRENT_DATE + 10,  mtop_expiry = CURRENT_DATE + 200 WHERE driver_id = '${ID.D2}';
                  UPDATE driver SET license_expiry = CURRENT_DATE - 5,   mtop_expiry = CURRENT_DATE + 200 WHERE driver_id = '${ID.D3}'`);

  console.log('T1 who can send');
  let r = await send(ID.D_AUTH, 'ALL_DRIVERS');
  check('a driver cannot send a reminder', r.success === false && r.error_code === 'ERR_NOT_TODA_ADMIN', r);
  r = await send(ID.P_AUTH, 'ALL_DRIVERS');
  check('a passenger cannot', r.success === false && r.error_code === 'ERR_NOT_TODA_ADMIN', r);
  const anon = await asUser(db, { role: 'anon' }, async (tx) => { try { await tx.query(`SELECT public.send_toda_driver_reminder('ALL_DRIVERS','x','y')`); return 'allowed'; } catch (e) { return e.message; } }, { commit: true });
  check('an anonymous caller cannot call it at all', /permission denied/i.test(anon), anon);

  console.log('\nT2 input checks');
  r = await send(ID.T_AUTH, 'EVERYONE');
  check('an unknown audience is refused', r.success === false && r.error_code === 'ERR_REMINDER_AUDIENCE', r);
  r = await send(ID.T_AUTH, 'ALL_DRIVERS', '   ', 'x');
  check('an empty title is refused', r.success === false && r.error_code === 'ERR_REMINDER_TEXT', r);
  r = await send(ID.T_AUTH, 'ALL_DRIVERS', 'T', 'x'.repeat(501));
  check('a message over 500 characters is refused', r.success === false && r.error_code === 'ERR_REMINDER_TEXT', r);
  r = await send(ID.T_AUTH, 'ALL_DRIVERS', 'x'.repeat(81), 'ok');
  check('a title over 80 characters is refused', r.success === false && r.error_code === 'ERR_REMINDER_TEXT', r);
  check('nothing was delivered by any refused call', (await db.query(`SELECT count(*)::int n FROM notification WHERE notification_type='TODA_REMINDER'`)).rows[0].n === 0);

  console.log('\nT3 a reminder to all drivers reaches only the verified members of the sender\'s own TODA');
  r = await send(ID.T_AUTH, 'ALL_DRIVERS', 'Meeting', 'General assembly on Saturday, 2 PM.');
  check('the send succeeds and reports 2 drivers (D1 and D2)', r.success === true && r.sent === 2, r);
  const n1 = await notes(ID.D1), n2 = await notes(ID.D2), n3 = await notes(ID.D3);
  check('D1 and D2 each received exactly the text that was sent', n1.length === 1 && n2.length === 1 && n1[0].title === 'Meeting' && n1[0].message === 'General assembly on Saturday, 2 PM.' && n1[0].notification_type === 'TODA_REMINDER', { n1, n2 });
  check('D3 (another TODA) received nothing', n3.length === 0, n3);

  console.log('\nT4 a double tap is refused, then allowed after a pause');
  r = await send(ID.T_AUTH, 'ALL_DRIVERS');
  check('a second send within 30 seconds is refused', r.success === false && r.error_code === 'ERR_REMINDER_TOO_SOON', r);
  check('and delivered nothing', (await notes(ID.D1)).length === 1);
  await clearThrottle();

  console.log('\nT5 "documents expiring" reaches only drivers with an expired or soon-expiring license or MTOP');
  r = await send(ID.T_AUTH, 'EXPIRING_DOCUMENTS', 'Renew your license', 'Your license expires soon. Please renew it.');
  check('only D2 (license expires in 10 days) is reminded', r.success === true && r.sent === 1, r);
  check('D2 has the renewal reminder; D1 (200 days left) does not', (await notes(ID.D2)).some((x) => x.title === 'Renew your license') && !(await notes(ID.D1)).some((x) => x.title === 'Renew your license'));
  check('D3 (expired license, but another TODA) is not reminded by this TODA', (await notes(ID.D3)).length === 0);

  console.log('\nT6 the other TODA\'s administrator reminds only their own');
  await clearThrottle();
  r = await send(ID.T2_AUTH, 'EXPIRING_DOCUMENTS', 'Renew', 'Your license has expired.');
  check('TODA 2 reminds D3 (expired license) and nobody else', r.success === true && r.sent === 1 && (await notes(ID.D3)).length === 1, r);
  check('D1 and D2 got nothing from TODA 2', (await notes(ID.D1)).length === 1 && !(await notes(ID.D2)).some((x) => x.title === 'Renew'));

  console.log('\nT7 a driver who is not verified, or whose membership is not approved, is not reminded');
  await clearThrottle();
  await internal(`UPDATE driver_toda_affiliation SET lgu_verification_status = 'Pending' WHERE driver_id = '${ID.D1}' AND toda_id = '${ID.TODA1}'`);
  const before = (await notes(ID.D1)).length;
  r = await send(ID.T_AUTH, 'ALL_DRIVERS', 'Another', 'Another reminder');
  check('D1 (membership no longer approved) is skipped, D2 still receives it', r.success === true && r.sent === 1 && (await notes(ID.D1)).length === before, r);

  console.log('\nT8 the audit trail and the drivers\' own view');
  const audit = (await db.query(`SELECT count(*)::int n FROM audit_log WHERE action_type='TODA_REMINDER_SENT' AND target_id='${ID.TODA1}'`)).rows[0].n;
  check('every successful send is in the audit log (3 sends for TODA 1)', audit === 3, audit);
  const own = await as(ID.D2_AUTH, (tx) => tx.query(`SELECT title FROM notification WHERE driver_id='${ID.D2}' AND notification_type='TODA_REMINDER' ORDER BY sent_at`));
  check('a driver can read their own reminders', own.rows.length === 3, own.rows);
  const other = await as(ID.D_AUTH, (tx) => tx.query(`SELECT title FROM notification WHERE driver_id='${ID.D2}'`));
  check('and cannot read another driver\'s', other.rows.length === 0, other.rows);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
