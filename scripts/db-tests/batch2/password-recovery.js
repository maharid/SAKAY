// Rules 4.2 / 4.6 / 4.7 (20261028000003): the database half of password recovery. A code is kept here as a HASH, valid for five minutes, with
// five wrong tries before a fifteen-minute lock, a 30-second gap between codes and five codes a day; a right code works once; the account of a
// number is found without guessing; and after the password changed every older login of the account stops being able to book / go Online.
// Whole migration chain on the local emulator (never Supabase). Time is moved by shifting the stored timestamps, not by waiting.
const fs = require('fs');
const path = require('path');
const { setup, ID, attempt, check, summary, PICKUP } = require('../b6fixtures');
const { asUser } = require('../tlib');

(async () => {
  const s = await setup();
  const { one, q, internal, svc, db } = s;
  const PAX_PHONE = '+639170000001';      // ID.P1
  const DRV_PHONE = '+639180000001';      // ID.D1
  const STRANGER = '09190000000';         // nobody
  const H = (n) => `hash-${n}`;
  const rpc = async (fn, ...args) => (await svc((tx) => tx.query(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) AS r`, args))).rows[0].r;
  const reserve = (role, phone, hash) => rpc('reserve_password_reset_code', role, phone, hash === undefined ? null : hash);
  const verify = (role, phone, hash) => rpc('verify_password_reset_code', role, phone, hash);
  const row = (role, sub) => one(`SELECT * FROM password_reset_challenge WHERE account_role = '${role}' AND subscriber = '${sub}'`);
  const age = (role, sub, sets) => internal(`UPDATE password_reset_challenge SET ${sets} WHERE account_role = '${role}' AND subscriber = '${sub}'`);

  console.log('Asking for a code: the gap, the daily limit, and what is stored');
  let r = await reserve('passenger', PAX_PHONE, H(1));
  check('the first request is allowed', r.allowed === true, r);
  let c = await row('passenger', '9170000001');
  check('only the HASH is stored, valid for five minutes (Rule 4.6)', c.code_hash === H(1) && Math.abs((new Date(c.code_expires_at) - Date.now()) / 1000 - 300) < 30, c);
  check('...and it is stored under the subscriber (the same row for 0917..., +63917... and 63917...)', c.subscriber === '9170000001' && c.sent_count === 1, c);
  r = await reserve('passenger', '09170000001', H(2));
  check('a second request straight away is refused with the seconds to wait (30-second gap)', r.allowed === false && r.reason === 'cooldown' && r.wait_seconds >= 1 && r.wait_seconds <= 30, r);
  c = await row('passenger', '9170000001');
  check('...and the refused request changed nothing (still the first code, still one send)', c.code_hash === H(1) && c.sent_count === 1, c);
  for (let i = 2; i <= 5; i++) {
    await age('passenger', '9170000001', `last_sent_at = last_sent_at - interval '31 seconds'`);
    r = await reserve('passenger', PAX_PHONE, H(i));
    check(`request ${i} of the day is allowed once the gap has passed`, r.allowed === true, r);
  }
  await age('passenger', '9170000001', `last_sent_at = last_sent_at - interval '31 seconds'`);
  r = await reserve('passenger', PAX_PHONE, H(6));
  check('the sixth in a day is refused (five a day)', r.allowed === false && r.reason === 'daily', r);
  await age('passenger', '9170000001', `sent_day = sent_day - 1`);
  r = await reserve('passenger', PAX_PHONE, H(7));
  check('the next day it is allowed again, counting from one', r.allowed === true && (await row('passenger', '9170000001')).sent_count === 1, r);

  console.log('\nThe same number in the other app is separate');
  r = await reserve('driver', '09170000001', H(8));
  check('a driver account with the same number has its own gap and limits', r.allowed === true, r);
  r = await reserve('admin', PAX_PHONE, H(9));
  check('an unknown app is refused', r.allowed === false && r.reason === 'invalid', r);
  r = await reserve('passenger', '12345', H(9));
  check('a number that is not a Philippine mobile number is refused', r.allowed === false && r.reason === 'invalid', r);

  console.log('\nA number with no account: the same throttle, nothing stored');
  r = await reserve('passenger', STRANGER, null);
  c = await row('passenger', '9190000000');
  check('it is allowed, counted, and no code is stored', r.allowed === true && c.sent_count === 1 && c.code_hash === null, c);
  r = await reserve('passenger', STRANGER, null);
  check('...and the 30-second gap applies to it in exactly the same way (the answer does not tell the two apart)', r.allowed === false && r.reason === 'cooldown', r);
  r = await verify('passenger', STRANGER, H(1));
  check('a code for it can never be right: "no code"', r.ok === false && r.reason === 'not_found', r);
  r = await verify('passenger', '09191111111', H(1));
  check('a number that never asked: "no code" too', r.ok === false && r.reason === 'not_found', r);

  console.log('\nTyping the code: wrong, right, used up');
  await age('driver', '9170000001', `last_sent_at = NULL, sent_count = 0`);
  await reserve('driver', DRV_PHONE, H('d1'));
  r = await verify('driver', DRV_PHONE, H('nope'));
  check('a wrong code is refused and says how many tries are left', r.ok === false && r.reason === 'wrong' && r.attempts_left === 4, r);
  r = await verify('driver', DRV_PHONE, H('d1'));
  check('the right code is accepted', r.ok === true, r);
  c = await row('driver', '9180000001');
  check('...and is used up, with the wrong-entry count cleared', c.code_hash === null && c.failed_count === 0, c);
  r = await verify('driver', DRV_PHONE, H('d1'));
  check('the same code does not work a second time', r.ok === false && r.reason === 'not_found', r);

  console.log('\nFive wrong codes lock the number for fifteen minutes (Rule 4.7)');
  await age('driver', '9180000001', `last_sent_at = NULL`);
  await reserve('driver', DRV_PHONE, H('d2'));
  for (let i = 1; i <= 4; i++) {
    r = await verify('driver', DRV_PHONE, H(`bad${i}`));
    check(`wrong code ${i}: refused, ${5 - i} left`, r.ok === false && r.reason === 'wrong' && r.attempts_left === 5 - i, r);
  }
  r = await verify('driver', DRV_PHONE, H('bad5'));
  check('the fifth wrong code locks, and says for how long', r.ok === false && r.reason === 'locked' && r.minutes_remaining === 15, r);
  r = await verify('driver', DRV_PHONE, H('d2'));
  check('during the lock even the right code is refused (it was thrown away with the fifth wrong one)', r.ok === false && r.reason === 'locked', r);
  r = await reserve('driver', DRV_PHONE, H('d3'));
  check('...and a new code cannot be requested either: locked, with the minutes left', r.allowed === false && r.reason === 'locked' && r.minutes_remaining > 14, r);
  await age('driver', '9180000001', `last_failed_at = last_failed_at - interval '16 minutes', last_sent_at = last_sent_at - interval '16 minutes'`);
  r = await reserve('driver', DRV_PHONE, H('d4'));
  c = await row('driver', '9180000001');
  check('after the fifteen minutes a new code can be requested, with a clean count', r.allowed === true && c.failed_count === 0 && c.code_hash === H('d4'), { r, c });
  r = await verify('driver', DRV_PHONE, H('d4'));
  check('...and it works', r.ok === true, r);

  console.log('\nOld failures do not carry over, and an unrequested code is not a guess');
  await age('driver', '9180000001', `last_sent_at = NULL`);
  await reserve('driver', DRV_PHONE, H('d5'));
  await age('driver', '9180000001', `failed_count = 4, last_failed_at = now() - interval '1 hour'`);
  r = await verify('driver', DRV_PHONE, H('stale'));
  check('four wrong codes from an hour ago do not make the next one the fifth: it starts a new count at one', r.ok === false && r.reason === 'wrong' && r.attempts_left === 4, r);
  await age('driver', '9180000001', `code_hash = NULL, code_expires_at = NULL, failed_count = 0, last_failed_at = NULL`);
  for (let i = 0; i < 6; i++) await verify('driver', DRV_PHONE, H(`none${i}`));
  c = await row('driver', '9180000001');
  check('typing codes when none was requested never counts towards the lock', c.failed_count === 0, c);

  console.log('\nFive minutes');
  await age('driver', '9180000001', `last_sent_at = NULL`);
  await reserve('driver', DRV_PHONE, H('d6'));
  await age('driver', '9180000001', `code_expires_at = now() - interval '1 second'`);
  r = await verify('driver', DRV_PHONE, H('d6'));
  check('a code older than five minutes is refused as expired, even though it is the right one (Rule 4.6)', r.ok === false && r.reason === 'expired', r);
  c = await row('driver', '9180000001');
  check('...and an expired code is not a wrong guess', c.failed_count === 0 && c.code_hash === null, c);

  console.log('\nThe SMS could not be sent');
  await age('driver', '9180000001', `last_sent_at = NULL, sent_count = 0`);
  await reserve('driver', DRV_PHONE, H('d7'));
  await rpc('release_password_reset_code', 'driver', DRV_PHONE);
  c = await row('driver', '9180000001');
  check('the send is given back and the code that never reached the person is forgotten', c.sent_count === 0 && c.last_sent_at === null && c.code_hash === null, c);
  r = await reserve('driver', DRV_PHONE, H('d8'));
  check('...so she can ask again at once, without the 30-second wait', r.allowed === true, r);

  console.log('\nFinding the account of a number');
  let a = await rpc('find_recovery_account', 'passenger', '0917 000 0001');
  check('a passenger is found whatever way the number is written', a.found === true && a.account_id === ID.P1 && a.auth_user_id === ID.P_AUTH && a.account_status === 'Active', a);
  a = await rpc('find_recovery_account', 'driver', '+639180000001');
  check('a driver is found in the driver app', a.found === true && a.account_id === ID.D1 && a.auth_user_id === ID.D_AUTH, a);
  a = await rpc('find_recovery_account', 'driver', PAX_PHONE);
  check('a passenger\'s number is not a driver account (each app recovers its own accounts)', a.found === false, a);
  a = await rpc('find_recovery_account', 'passenger', STRANGER);
  check('a number with no account finds nothing', a.found === false, a);
  a = await rpc('find_recovery_account', 'lgu', PAX_PHONE);
  check('administrators are not recovered this way', a.found === false, a);

  console.log('\nAfter the password changed, the older logins stop working');
  const A = '11111111-1111-4111-8111-111111111111';
  const withSession = (uid, sessionId, fn, commit = true) => asUser(db, { uid }, async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated', session_id: sessionId })]);
    return fn(tx);
  }, { commit });
  const book = async () => {
    const qt = await s.quote(ID.P_AUTH, 3.3, 1);
    return attempt(() => withSession(ID.P_AUTH, A, async (tx) => (await tx.query(
      `INSERT INTO public.booking (passenger_id, booking_type, is_shared_trip, passenger_count, pickup_address, pickup_latitude, pickup_longitude,
                                   dropoff_address, dropoff_latitude, dropoff_longitude, estimated_distance_km, estimated_fare)
       VALUES ($1, 'Immediate', FALSE, 1, 'A', $2, $3, 'B', $4, $5, 3.3, $6) RETURNING booking_id`,
      [ID.P1, PICKUP.lat, PICKUP.lng, PICKUP.lat + 0.03, PICKUP.lng, qt.solo_fare])).rows[0]));
  };
  const reg = await withSession(ID.P_AUTH, A, async (tx) => (await tx.query(`SELECT public.register_passenger_session() AS r`)).rows[0].r);
  let b = await book();
  check('(before) the passenger\'s phone, logged in as session A, can book', reg.success === true && b.ok === true, b.error);
  await internal(`UPDATE booking SET booking_status = 'Cancelled', cancelled_by = 'system' WHERE booking_status IN ('Pending', 'Searching Driver')`);
  await internal(`UPDATE driver SET session_id = '99999999-9999-4999-8999-999999999999' WHERE driver_id = '${ID.D1}'`);
  const before = await one(`SELECT session_id, auth_session_id FROM passenger WHERE passenger_id = '${ID.P1}'`);
  const dBefore = await one(`SELECT session_id FROM driver WHERE driver_id = '${ID.D1}'`);

  let e = await rpc('finish_password_reset', 'passenger', ID.P1);
  check('ending the passenger\'s sessions replaces the app session (and says the auth sessions could not be reached here: the emulator has none)', e.app_session_replaced === true && e.auth_sessions_deleted === null, e);
  const after = await one(`SELECT session_id, auth_session_id FROM passenger WHERE passenger_id = '${ID.P1}'`);
  check('...the stored session and auth session are both new', after.session_id !== before.session_id && after.auth_session_id !== before.auth_session_id && after.auth_session_id !== A, { before, after });
  b = await book();
  check('the older phone (session A) can no longer create a booking', !b.ok && /ERR_SESSION_SUPERSEDED/.test(b.error), b.ok ? 'booking was accepted' : b.error);
  e = await rpc('finish_password_reset', 'driver', ID.D1);
  const dAfter = await one(`SELECT session_id FROM driver WHERE driver_id = '${ID.D1}'`);
  check('ending the driver\'s sessions replaces the driver\'s session', e.app_session_replaced === true && dAfter.session_id !== dBefore.session_id, { dBefore, dAfter, e });
  e = await rpc('finish_password_reset', 'passenger', '00000000-0000-4000-8000-00000000dead');
  check('an account that does not exist replaces nothing and fails nothing', e.app_session_replaced === false, e);
  const audit = await q(`SELECT target_id, details FROM audit_log WHERE action_type = 'ACCOUNT_PASSWORD_RESET' ORDER BY performed_at`);
  check('each real reset is in the audit log, for that account, and the entry holds no number and no code', audit.length === 2 && audit[0].target_id === ID.P1 && audit[1].target_id === ID.D1 && !audit.some((a) => /\d{7,}|\+63/.test(a.details)), audit);

  await db.exec(`create table if not exists auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid)`);   // not in the emulator by default
  await db.query(`insert into auth.sessions (user_id) values ($1), ($1), ($2)`, [ID.P_AUTH, ID.P2_AUTH]);
  e = await rpc('finish_password_reset', 'passenger', ID.P1);
  const left = await one(`SELECT (SELECT count(*)::int FROM auth.sessions WHERE user_id = '${ID.P_AUTH}') AS mine, (SELECT count(*)::int FROM auth.sessions WHERE user_id = '${ID.P2_AUTH}') AS other`);
  check('where the auth sessions can be reached they are deleted for that login only', e.auth_sessions_deleted === 2 && left.mine === 0 && left.other === 1, { e, left });

  console.log('\nOnly the server can touch any of it');
  const asApp = (fn) => attempt(() => s.as(ID.P_AUTH, fn));
  for (const [label, sql] of [
    ['reserve_password_reset_code', `SELECT public.reserve_password_reset_code('passenger', '${PAX_PHONE}', 'x')`],
    ['release_password_reset_code', `SELECT public.release_password_reset_code('passenger', '${PAX_PHONE}')`],
    ['verify_password_reset_code', `SELECT public.verify_password_reset_code('passenger', '${PAX_PHONE}', 'x')`],
    ['find_recovery_account', `SELECT public.find_recovery_account('passenger', '${PAX_PHONE}')`],
    ['finish_password_reset', `SELECT public.finish_password_reset('passenger', '${ID.P1}')`],
  ]) {
    const user = await asApp((tx) => tx.query(sql));
    const anon = await attempt(() => s.anon((tx) => tx.query(sql)));
    check(`${label}: a signed-in user and an anonymous caller are both refused`, !user.ok && /permission denied/i.test(user.error) && !anon.ok && /permission denied/i.test(anon.error), `${user.error} | ${anon.error}`);
  }
  const peek = await asApp((tx) => tx.query(`SELECT * FROM public.password_reset_challenge`));
  check('nobody signed in can read the table (the codes\' hashes)', !peek.ok && /permission denied/i.test(peek.error), peek.error);
  const rls = await one(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.password_reset_challenge'::regclass`);
  const pols = await q(`SELECT policyname FROM pg_policies WHERE tablename = 'password_reset_challenge'`);
  check('row security is on and there is no policy at all', rls.relrowsecurity === true && pols.length === 0, pols);

  console.log('\nThe migration file');
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261028000003_password_recovery.sql'), 'utf8');
  check('it is pure ASCII with LF line endings', !/[^\x00-\x7F]/.test(sql) && !/\r/.test(sql) && sql.endsWith('\n'));
  check('it never stores or returns a code, only a hash', !/code\s+TEXT|plain_code|raw_code/i.test(sql) && /code_hash/.test(sql));

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
