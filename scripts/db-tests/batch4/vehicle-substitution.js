// Rule 29.18 (20261028000004): a driver may use another vehicle only with the approval of the TODA Administrator AND the LGU Administrator, in that order. While the
// substitution is active the driver's plate and franchise number ARE the substitute's (every screen shows the vehicle actually driven); the registered vehicle returns
// by itself when the days are over; nothing changes while the driver has an open booking; every step is audited and tells the driver. Whole migration chain on the
// local emulator (never Supabase). Time is moved by shifting the stored timestamps.
const fs = require('fs');
const path = require('path');
const { setup, ID, attempt, check, summary } = require('../b6fixtures');

(async () => {
  const t = await setup();
  const { as, internal, one, q, svc, mkBooking } = t;
  const D1 = ID.D1;
  const call = (uid, fn, ...args) => as(uid, (tx) => attempt(async () => (await tx.query(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) AS r`, args)).rows[0].r));
  const row = (id) => one(`SELECT * FROM vehicle_substitution WHERE substitution_id = '${id}'`);
  const drv = () => one(`SELECT plate_number, franchise_number FROM driver WHERE driver_id = '${D1}'`);
  const notices = async (type) => (await q(`SELECT title, message FROM notification WHERE driver_id = '${D1}' AND notification_type = '${type}'`));
  const audits = async (action) => (await q(`SELECT actor_role FROM audit_log WHERE action_type = '${action}' AND target_id = '${D1}'`));
  const REASON = 'My tricycle broke down and the shop needs three days';
  await internal(`UPDATE driver SET plate_number = 'REG-111', franchise_number = 'FR-111' WHERE driver_id = '${D1}'`);
  const reset = () => internal(`DELETE FROM vehicle_substitution`);

  console.log('S1 the request');
  let r = await call(ID.D_AUTH, 'request_vehicle_substitution', ' sub 222 ', 'fr-222', REASON, 3);
  check('a verified driver asks: it goes to the TODA Administrator first, plate and franchise normalised', r.ok && r.value.status === 'Pending TODA Approval', r);
  const id1 = r.value && r.value.substitution_id;
  let s = await row(id1);
  check('...stored as SUB 222 / FR-222 for 3 days, naming the driver\'s TODA', s.substitute_plate === 'SUB 222' && s.substitute_franchise === 'FR-222' && s.requested_days === 3 && s.toda_id === ID.TODA1, s);
  check('...the registered vehicle is untouched, and it is in the audit log', (await drv()).plate_number === 'REG-111' && (await audits('VEHICLE_SUBSTITUTION_REQUESTED')).length === 1);
  r = await call(ID.D_AUTH, 'request_vehicle_substitution', 'SUB 333', 'FR-333', REASON, 2);
  check('a second request while one is open is refused', !r.ok && /ERR_REQUEST_OPEN/.test(r.error), r);
  await reset();
  for (const [label, args, re] of [
    ['0 days', ['SUB 222', 'FR-222', REASON, 0], /ERR_DAYS/],
    ['8 days', ['SUB 222', 'FR-222', REASON, 8], /ERR_DAYS/],
    ['a short reason', ['SUB 222', 'FR-222', 'broke', 3], /ERR_REASON/],
    ['no plate', ['', 'FR-222', REASON, 3], /ERR_PLATE/],
    ['a plate with symbols', ['<script>', 'FR-222', REASON, 3], /ERR_PLATE/],
    ['no franchise number', ['SUB 222', ' ', REASON, 3], /ERR_FRANCHISE/],
    ['the vehicle he already has (any case, with spaces)', [' reg-111 ', 'FR-111', REASON, 3], /ERR_SAME_VEHICLE/],
  ]) {
    r = await call(ID.D_AUTH, 'request_vehicle_substitution', ...args);
    check(`${label} is refused`, !r.ok && re.test(r.error), r);
  }
  r = await call(ID.P_AUTH, 'request_vehicle_substitution', 'SUB 222', 'FR-222', REASON, 3);
  check('a passenger cannot ask', !r.ok && /ERR_NOT_A_DRIVER/.test(r.error), r);
  const open = await mkBooking(ID.P1, 'Accepted', D1);
  r = await call(ID.D_AUTH, 'request_vehicle_substitution', 'SUB 222', 'FR-222', REASON, 3);
  check('with an open booking he must finish it first', !r.ok && /ERR_OPEN_BOOKING/.test(r.error), r);
  await internal(`UPDATE booking SET booking_status = 'Completed' WHERE booking_id = '${open}'`);

  console.log('\nS2 the TODA Administrator decides first');
  r = await call(ID.D_AUTH, 'request_vehicle_substitution', 'SUB 222', 'FR-222', REASON, 3);
  const id = r.value.substitution_id;
  const lguEarly = await call(ID.L_AUTH, 'decide_vehicle_substitution_lgu', id, true, 'ok');
  check('the LGU Administrator cannot approve before the TODA Administrator (the order of the policy)', !lguEarly.ok && /ERR_NOT_WAITING/.test(lguEarly.error), lguEarly);
  const otherToda = await call(ID.T2_AUTH, 'decide_vehicle_substitution_toda', id, true, 'ok');
  check('another TODA\'s administrator cannot decide it', !otherToda.ok && /Access Denied/.test(otherToda.error), otherToda);
  const paxDecide = await call(ID.P_AUTH, 'decide_vehicle_substitution_toda', id, true, 'ok');
  check('nor a passenger', !paxDecide.ok, paxDecide);
  const noWhy = await call(ID.T_AUTH, 'decide_vehicle_substitution_toda', id, false, '  ');
  check('a denial needs the reason', !noWhy.ok && /ERR_REASON/.test(noWhy.error), noWhy);
  const noChoice = await call(ID.T_AUTH, 'decide_vehicle_substitution_toda', id, null, 'x');
  check('and a choice', !noChoice.ok && /ERR_CHOICE/.test(noChoice.error), noChoice);
  const visible = async (uid) => (await as(uid, (tx) => tx.query(`SELECT count(*)::int n FROM vehicle_substitution`))).rows[0].n;
  check('row security: the driver, his TODA Administrator and the LGU see it; the other TODA and another driver do not', (await visible(ID.D_AUTH)) === 1 && (await visible(ID.T_AUTH)) === 1 && (await visible(ID.L_AUTH)) === 1 && (await visible(ID.T2_AUTH)) === 0 && (await visible(ID.D2_AUTH)) === 0);
  const todaOk = await call(ID.T_AUTH, 'decide_vehicle_substitution_toda', id, true, 'I checked the unit at the terminal');
  s = await row(id);
  check('the TODA Administrator approves: it now waits for the LGU, the vehicle is NOT changed yet, the driver is told not to use it yet', todaOk.ok && s.status === 'Pending LGU Approval' && (await drv()).plate_number === 'REG-111' && (await notices('VEHICLE_SUBSTITUTION_FORWARDED')).length === 1, { todaOk, s });
  const again = await call(ID.T_AUTH, 'decide_vehicle_substitution_toda', id, true, 'twice');
  check('it cannot be decided by the TODA twice', !again.ok && /ERR_NOT_WAITING/.test(again.error), again);

  console.log('\nS3 the LGU Administrator approves: the substitute becomes his vehicle');
  const todaAsLgu = await call(ID.T_AUTH, 'decide_vehicle_substitution_lgu', id, true, 'x');
  check('a TODA Administrator cannot give the LGU\'s approval', !todaAsLgu.ok && /Access Denied/.test(todaAsLgu.error), todaAsLgu);
  const bk = await mkBooking(ID.P1, 'Accepted', D1);
  const busy = await call(ID.L_AUTH, 'decide_vehicle_substitution_lgu', id, true, 'ok');
  check('while the driver has an open booking the vehicle is not changed (approve it after the trip)', !busy.ok && /ERR_OPEN_BOOKING/.test(busy.error) && (await drv()).plate_number === 'REG-111', busy);
  await internal(`UPDATE booking SET booking_status = 'Completed' WHERE booking_id = '${bk}'`);
  const approved = await call(ID.L_AUTH, 'decide_vehicle_substitution_lgu', id, true, 'Both units checked');
  s = await row(id);
  check('approved: Active for 3 days, the registered vehicle remembered', approved.ok && s.status === 'Active' && s.original_plate === 'REG-111' && s.original_franchise === 'FR-111' && Math.abs((new Date(s.ends_at) - Date.now()) / 86400000 - 3) < 0.05, { approved, s });
  check('...the driver\'s plate and franchise ARE the substitute\'s now (so the passenger and every list show the vehicle actually driven)', (await drv()).plate_number === 'SUB 222' && (await drv()).franchise_number === 'FR-222', await drv());
  check('...the driver is told until when, and it is audited under the LGU Administrator', (await notices('VEHICLE_SUBSTITUTION_ACTIVE')).length === 1 && (await audits('VEHICLE_SUBSTITUTION_APPROVED')).some((a) => a.actor_role === 'lgu_admin'));
  const own = await as(ID.D_AUTH, (tx) => attempt(() => tx.query(`UPDATE driver SET plate_number = 'MY-OWN' WHERE driver_id = '${D1}'`)));
  check('the driver still cannot change the vehicle himself', !own.ok && /ERR_VEHICLE_LOCKED/.test(own.error), own);
  const second = await call(ID.D_AUTH, 'request_vehicle_substitution', 'SUB 444', 'FR-444', REASON, 1);
  check('and cannot ask for another while one is active', !second.ok && /ERR_REQUEST_OPEN/.test(second.error), second);

  console.log('\nS4 it ends: by the days, early by an administrator or the driver, never mid-trip');
  const trip = await mkBooking(ID.P1, 'Accepted', D1);
  await internal(`UPDATE vehicle_substitution SET ends_at = now() - interval '1 minute' WHERE substitution_id = '${id}'`);
  let n = (await svc((tx) => tx.query(`SELECT public.end_expired_vehicle_substitutions() AS n`))).rows[0].n;
  check('the days are over but the driver is on a trip: nothing is changed', n === 0 && (await drv()).plate_number === 'SUB 222' && (await row(id)).status === 'Active', n);
  const early = await call(ID.T_AUTH, 'end_vehicle_substitution', id, 'The TODA wants it ended');
  check('an administrator cannot end it mid-trip either', !early.ok && /ERR_OPEN_BOOKING/.test(early.error), early);
  await internal(`UPDATE booking SET booking_status = 'Completed' WHERE booking_id = '${trip}'`);
  const job = (await svc((tx) => tx.query(`SELECT public.run_policy_sweeps_job() AS r`))).rows[0].r;
  s = await row(id);
  check('after the trip the hourly job puts the registered vehicle back, and says how many it ended', job.vehicle_substitutions_ended === 1 && job.errors.length === 0 && s.status === 'Ended' && (await drv()).plate_number === 'REG-111' && (await drv()).franchise_number === 'FR-111', { job, s });
  check('...the driver is told, and it is audited', (await notices('VEHICLE_SUBSTITUTION_ENDED')).length === 1 && (await audits('VEHICLE_SUBSTITUTION_ENDED')).length === 1);
  n = (await svc((tx) => tx.query(`SELECT public.end_expired_vehicle_substitutions() AS n`))).rows[0].n;
  check('running it again changes nothing', n === 0);

  await reset();
  r = await call(ID.D_AUTH, 'request_vehicle_substitution', 'SUB 555', 'FR-555', REASON, 2);
  const idB = r.value.substitution_id;
  await call(ID.T_AUTH, 'decide_vehicle_substitution_toda', idB, true, '');
  await call(ID.L_AUTH, 'decide_vehicle_substitution_lgu', idB, true, '');
  const strangerEnd = await call(ID.T2_AUTH, 'end_vehicle_substitution', idB, 'not mine');
  check('another TODA\'s administrator cannot end it', !strangerEnd.ok && /Access Denied/.test(strangerEnd.error), strangerEnd);
  const noWhyEnd = await call(ID.T_AUTH, 'end_vehicle_substitution', idB, '');
  check('an administrator must say why (the driver is told)', !noWhyEnd.ok && /ERR_REASON/.test(noWhyEnd.error), noWhyEnd);
  const adminEnd = await call(ID.T_AUTH, 'end_vehicle_substitution', idB, 'The unit was seen carrying more than the allowed passengers');
  check('the driver\'s TODA Administrator ends it early: the registered vehicle is back', adminEnd.ok && (await drv()).plate_number === 'REG-111' && (await row(idB)).status === 'Ended' && /TODA Administrator/.test((await row(idB)).end_reason), { adminEnd, d: await drv() });
  await reset();
  r = await call(ID.D_AUTH, 'request_vehicle_substitution', 'SUB 666', 'FR-666', REASON, 1);
  const idC = r.value.substitution_id;
  await call(ID.T_AUTH, 'decide_vehicle_substitution_toda', idC, true, '');
  await call(ID.L_AUTH, 'decide_vehicle_substitution_lgu', idC, true, '');
  const driverEnd = await call(ID.D_AUTH, 'end_vehicle_substitution', idC);
  check('the driver can give it back himself, without a reason', driverEnd.ok && (await drv()).plate_number === 'REG-111', driverEnd);

  console.log('\nS5 denial, withdrawal, and a driver with no TODA');
  await reset();
  r = await call(ID.D_AUTH, 'request_vehicle_substitution', 'SUB 777', 'FR-777', REASON, 2);
  const idD = r.value.substitution_id;
  const denied = await call(ID.T_AUTH, 'decide_vehicle_substitution_toda', idD, false, 'That unit has no valid franchise');
  s = await row(idD);
  check('a denial by the TODA ends it with the reason, and the driver is told', denied.ok && s.status === 'Denied' && s.denied_by_role === 'toda_admin' && /no valid franchise/.test(s.denial_reason) && (await notices('VEHICLE_SUBSTITUTION_DENIED')).length === 1 && (await drv()).plate_number === 'REG-111', { denied, s });
  r = await call(ID.D_AUTH, 'request_vehicle_substitution', 'SUB 888', 'FR-888', REASON, 2);
  const idE = r.value.substitution_id;
  await call(ID.T_AUTH, 'decide_vehicle_substitution_toda', idE, true, '');
  const lguDeny = await call(ID.L_AUTH, 'decide_vehicle_substitution_lgu', idE, false, 'The operator did not consent');
  check('a denial by the LGU Administrator also ends it, with the reason', lguDeny.ok && (await row(idE)).status === 'Denied' && (await row(idE)).denied_by_role === 'lgu_admin', lguDeny);
  r = await call(ID.D_AUTH, 'request_vehicle_substitution', 'SUB 999', 'FR-999', REASON, 2);
  const idF = r.value.substitution_id;
  const notMine = await call(ID.D2_AUTH, 'withdraw_vehicle_substitution', idF);
  check('another driver cannot withdraw it', !notMine.ok && /Access Denied/.test(notMine.error), notMine);
  const wd = await call(ID.D_AUTH, 'withdraw_vehicle_substitution', idF);
  check('the driver withdraws a request that is waiting', wd.ok && (await row(idF)).status === 'Withdrawn', wd);
  const wd2 = await call(ID.D_AUTH, 'withdraw_vehicle_substitution', idF);
  check('and only a waiting one', !wd2.ok && /ERR_NOT_WAITING/.test(wd2.error), wd2);
  await internal(`UPDATE driver SET toda_id = NULL WHERE driver_id = '${D1}'`);
  r = await call(ID.D_AUTH, 'request_vehicle_substitution', 'SUB 123', 'FR-123', REASON, 1);
  check('a driver with no TODA goes straight to the LGU Administrator', r.ok && r.value.status === 'Pending LGU Approval', r);
  await internal(`UPDATE driver SET toda_id = '${ID.TODA1}' WHERE driver_id = '${D1}'`);

  console.log('\nS6 who can call what, and the file');
  for (const [fn, sql] of [
    ['_revert_vehicle_substitution', `SELECT public._revert_vehicle_substitution('${id}', 'x')`],
    ['end_expired_vehicle_substitutions', `SELECT public.end_expired_vehicle_substitutions()`],
    ['run_policy_sweeps_job', `SELECT public.run_policy_sweeps_job()`],
  ]) {
    const user = await as(ID.D_AUTH, (tx) => attempt(() => tx.query(sql)));
    const anon = await attempt(() => t.anon((tx) => tx.query(sql)));
    check(`${fn}: neither a signed-in user nor an anonymous caller`, !user.ok && /permission denied/i.test(user.error) && !anon.ok && /permission denied/i.test(anon.error), `${user.error} | ${anon.error}`);
  }
  const direct = await as(ID.D_AUTH, (tx) => attempt(() => tx.query(`INSERT INTO vehicle_substitution (driver_id, substitute_plate, substitute_franchise, reason, requested_days, status) VALUES ('${D1}', 'X', 'Y', 'a direct write', 1, 'Active')`)));
  check('nobody writes the table directly', !direct.ok && /permission denied/i.test(direct.error), direct);
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261028000004_vehicle_substitution.sql'), 'utf8');
  check('the migration file is pure ASCII with LF line endings', !/[^\x00-\x7F]/.test(sql) && !/\r/.test(sql) && sql.endsWith('\n'));

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
