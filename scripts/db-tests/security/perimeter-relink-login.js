// scripts/relinkDriverLogin.js, rehearsed on the local emulator (the database just before the lockdown AND the fully locked-down chain):
// what it finds, what it changes, what it refuses to touch, and that a failed change leaves nothing behind. Nothing here connects to Supabase.
const path = require('path');
const { spawnSync } = require('child_process');
const { freshDb, check, summary } = require('../tlib');
const relink = require('../../relinkDriverLogin');

const PRE = '20261007000004_security_null_safe_service_context.sql';
const script = path.join(__dirname, '..', '..', 'relinkDriverLogin.js');
// DATABASE_URL is blanked on purpose: no run here may ever reach a hosted database.
const run = (args, extraEnv = {}) => {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 300000, env: { ...process.env, DATABASE_URL: '', ...extraEnv } });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const adapter = (db) => ({
  query: async (sql, params) => { const r = await db.query(sql, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; },
});

const U = {
  juan: '22222222-2222-2222-2222-222222222222', dana: 'aaaaaaa1-0000-4000-8000-000000000001', danaStale: 'aaaaaaa2-0000-4000-8000-000000000002',
  nico: 'aaaaaaa3-0000-4000-8000-000000000003', nicoOld: 'aaaaaaa8-0000-4000-8000-000000000008', twin1: 'aaaaaaa9-0000-4000-8000-000000000009', twin2: 'aaaaaab1-0000-4000-8000-00000000000a', rey: 'aaaaaaa4-0000-4000-8000-000000000004',
};
const D = { juan: '11111111-1111-1111-1111-111111111111', dana: 'bbbbbbb1-0000-4000-8000-000000000001', nico: 'bbbbbbb2-0000-4000-8000-000000000002',
  rey: 'bbbbbbb3-0000-4000-8000-000000000003', twin1: 'bbbbbbb4-0000-4000-8000-000000000004', twin2: 'bbbbbbb5-0000-4000-8000-000000000005' };

async function build(db) {
  const user = (id, email) => db.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, crypt('Rehearsal#1', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}')`, [id, email]);
  const identity = (id, email) => db.query(
    `insert into auth.identities (user_id, identity_data, provider, provider_id) values ($1::uuid, $2::jsonb, 'email', $3::text)`, [id, JSON.stringify({ sub: id, email }), id]);
  const driver = (id, auth, name, phone, email, status = 'Verified') => db.query(
    `insert into public.driver (driver_id, auth_user_id, full_name, contact_number, email, account_status) values ($1, $2, $3, $4, $5, $6)`, [id, auth, name, phone, email, status]);

  await user(U.juan, 'testdriver@sakay.local');                   await identity(U.juan, 'testdriver@sakay.local');
  await driver(D.juan, U.juan, 'Juan Dela Cruz (Test)', '+639123456789', 'testdriver@sakay.local');

  await user(U.dana, 'dana@example.test');                        await identity(U.dana, 'dana@example.test');     // Dana's real login is a hand-made address ...
  await user(U.danaStale, 'driver_639181111111@sakay.ph');                                                          // ... and a stale login owns the standard one
  await driver(D.dana, U.dana, 'Dana Test', '09181111111', 'dana@example.test');

  await user(U.nicoOld, 'nico.old@example.test');                 await db.query("update auth.users set deleted_at = now() where id = $1", [U.nicoOld]);   // Nico: his record is linked to a login that was deleted ...
  await user(U.nico, 'driver_639182222222@sakay.ph');             await identity(U.nico, 'driver_639182222222@sakay.ph');   // ... while a login with the standard address exists
  await driver(D.nico, U.nicoOld, 'Nico Test', '+639182222222', null);

  await user(U.rey, 'driver_639183333333@sakay.ph');              await identity(U.rey, 'driver_639183333333@sakay.ph');    // Rey: already fine
  await driver(D.rey, U.rey, 'Rey Test', '+639183333333', 'driver_639183333333@sakay.ph');

  await user(U.twin1, 'twin1@example.test'); await user(U.twin2, 'twin2@example.test');                              // two records, one number
  await driver(D.twin1, U.twin1, 'Twin One', '+639184444444', null);
  await driver(D.twin2, U.twin2, 'Twin Two', '09184444444', null);
}

const row = async (db, sql, p) => (await db.query(sql, p)).rows[0];

async function scenarios(label, until) {
  console.log(`\n=== ${label}`);
  const db = await freshDb(until);
  await build(db);
  const a = adapter(db);
  const lines = [];
  const log = (s) => lines.push(String(s));

  // ---- Juan: the hand-made login ----
  const beforeAuth = await row(db, `select email, encrypted_password, email_confirmed_at is not null as confirmed from auth.users where id = $1`, [U.juan]);
  const beforeDrv = await row(db, `select driver_id, full_name, account_status, availability_status, auth_user_id, toda_id, contact_number from public.driver where driver_id = $1`, [D.juan]);
  const r1 = await relink.inspect(a, '09123456789');
  check('Juan: the hand-made login is found, and the plan is to give it the standard address', r1.kind === 'rename-login' && r1.want.standard === 'driver_639123456789@sakay.ph' && r1.linked.id === U.juan, r1.kind);
  check('...the number may be typed with +63, 63 or 09: same driver', (await relink.inspect(a, '+63 912 345 6789')).kind === 'rename-login' && (await relink.inspect(a, '9123456789')).kind === 'rename-login');
  const unchanged = await row(db, `select email from auth.users where id = $1`, [U.juan]);
  check('...inspecting (the preview) changes nothing', unchanged.email === 'testdriver@sakay.local');
  relink.describe(r1, log);
  const text = lines.join('\n');
  check('...and what it prints hides the e-mail address and the number', !/testdriver/.test(text) && !/9123456789/.test(text) && /te\*\*\*@sakay\.local/.test(text), text.slice(0, 200));

  const done = await relink.applyPlan(a, r1, {}, log);
  check('Juan: apply reports a change', done === true);
  const afterAuth = await row(db, `select email, encrypted_password, email_confirmed_at is not null as confirmed from auth.users where id = $1`, [U.juan]);
  const afterDrv = await row(db, `select driver_id, full_name, account_status, availability_status, auth_user_id, toda_id, contact_number from public.driver where driver_id = $1`, [D.juan]);
  check('...the login now has the standard address, is confirmed, and the PASSWORD is untouched', afterAuth.email === 'driver_639123456789@sakay.ph' && afterAuth.confirmed === true && afterAuth.encrypted_password === beforeAuth.encrypted_password, afterAuth.email);
  check('...the identity follows the address', (await row(db, `select identity_data->>'email' as e from auth.identities where user_id = $1`, [U.juan])).e === 'driver_639123456789@sakay.ph');
  check('...the driver record is the SAME record (id, name, status, availability, login id, TODA, number unchanged); only its e-mail column follows',
    JSON.stringify(afterDrv) === JSON.stringify(beforeDrv) && (await row(db, `select email from public.driver where driver_id = $1`, [D.juan])).email === 'driver_639123456789@sakay.ph');
  check('...and the password still matches (the old one works)', (await row(db, `select (encrypted_password = crypt('Rehearsal#1', encrypted_password)) as ok from auth.users where id = $1`, [U.juan])).ok === true);
  check('...a second look says it is reachable, and a second apply does nothing', (await relink.inspect(a, '09123456789')).kind === 'reachable' && (await relink.applyPlan(a, await relink.inspect(a, '09123456789'), {}, log)) === false);

  // ---- Dana: another login already owns the standard address ----
  const r2 = await relink.inspect(a, '09181111111');
  check('Dana: a stale login owns the standard address -> a CONFLICT, nothing is touched automatically', r2.kind === 'conflict' && r2.others.length === 1 && r2.others[0].id === U.danaStale, r2.kind);
  const applyConflict = await relink.applyPlan(a, r2, {}, log).then(() => 'applied', (e) => String(e.message));
  check('...apply refuses', /nothing to apply/.test(applyConflict), applyConflict);
  check('...both logins are exactly as they were', (await row(db, `select email from auth.users where id = $1`, [U.dana])).email === 'dana@example.test'
    && (await row(db, `select email from auth.users where id = $1`, [U.danaStale])).email === 'driver_639181111111@sakay.ph');

  // ---- Nico: the record is linked to nothing, a login with the standard address exists ----
  const r3 = await relink.inspect(a, '09182222222');
  check('Nico: the linked login was deleted and one login owns the standard address -> re-point the record', r3.kind === 'repoint-driver' && r3.target.id === U.nico, r3.kind);
  await relink.applyPlan(a, r3, {}, log);
  const nico = await row(db, `select auth_user_id, email from public.driver where driver_id = $1`, [D.nico]);
  check('...the record now points at that login', nico.auth_user_id === U.nico && nico.email === 'driver_639182222222@sakay.ph', nico);

  // ---- Rey, twins, nobody, bad input ----
  check('Rey: already reachable', (await relink.inspect(a, '09183333333')).kind === 'reachable');
  check('two records with one number: refused to guess', (await relink.inspect(a, '09184444444')).kind === 'many-drivers');
  check('a number nobody has: no driver', (await relink.inspect(a, '09185555555')).kind === 'no-driver');
  check('a bad number is a usage error', (await relink.inspect(a, '12345')).kind === 'usage' && (await relink.inspect(a, '08123456789')).kind === 'usage');

  // ---- the password option ----
  const reyBefore = (await row(db, `select encrypted_password from auth.users where id = $1`, [U.rey])).encrypted_password;
  const reyPlan = await relink.inspect(a, '09183333333');
  const pwLines = [];
  await relink.applyPlan(a, reyPlan, { password: 'Brand#New123' }, (s) => pwLines.push(s));
  const reyAfter = await row(db, `select encrypted_password, (encrypted_password = crypt('Brand#New123', encrypted_password)) as new_ok, (encrypted_password = crypt('Rehearsal#1', encrypted_password)) as old_ok from auth.users where id = $1`, [U.rey]);
  check('--set-password-env: the new password is stored as a hash, the old one no longer matches, and the value is never printed',
    reyAfter.encrypted_password !== reyBefore && reyAfter.new_ok === true && reyAfter.old_ok === false && !pwLines.join('\n').includes('Brand#New123'));

  // ---- all or nothing: the address is taken between the preview and the apply ----
  await db.query(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
                  values ('aaaaaaa6-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'quinn@example.test', crypt('x', gen_salt('bf')), now(), '{}', '{}')`);
  await db.query(`insert into public.driver (driver_id, auth_user_id, full_name, contact_number, email, account_status) values ('bbbbbbb6-0000-4000-8000-000000000006', 'aaaaaaa6-0000-4000-8000-000000000006', 'Quinn Test', '+639186666666', 'quinn@example.test', 'Verified')`);
  const quinnPlan = await relink.inspect(a, '09186666666');
  check('Quinn: a plain rename case', quinnPlan.kind === 'rename-login');
  await db.query(`insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values ('aaaaaaa7-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'driver_639186666666@sakay.ph', '{}', '{}')`);
  const raced = await relink.applyPlan(a, quinnPlan, {}, log).then(() => 'applied', (e) => String(e.message));
  check('...if somebody takes the address after the preview, apply fails its own re-read and ROLLS BACK',
    /verification failed/.test(raced) && (await row(db, `select email from auth.users where id = 'aaaaaaa6-0000-4000-8000-000000000006'`)).email === 'quinn@example.test'
    && (await row(db, `select email from public.driver where driver_id = 'bbbbbbb6-0000-4000-8000-000000000006'`)).email === 'quinn@example.test', raced);
  await db.close();
}

(async () => {
  await scenarios('the database just before the lockdown', PRE);
  await scenarios('the fully locked-down chain (S0-S4 applied)', undefined);

  console.log('\nthe command line');
  const none = run([]);
  check('no number prints the usage and exits with 2', none.status === 2 && /usage:/.test(none.out));
  const noUrl = run(['09123456789']);
  check('without DATABASE_URL it stops before doing anything', noUrl.status === 2 && /NO DATABASE_URL/.test(noUrl.out), noUrl.out.slice(0, 120));
  const noPw = run(['09123456789', '--emulator', '--set-password-env', 'RELINK_TEST_PW'], {});
  check('--set-password-env with an unset or short variable exits with 2 and nothing happens', noPw.status === 2 && /not set to a password/.test(noPw.out), noPw.out.slice(0, 160));
  const preview = run(['09123456789', '--emulator']);
  check('the preview (rehearsal) shows the plan and says it is only a preview', preview.status === 0 && /PLAN/.test(preview.out) && /Preview only/.test(preview.out), preview.out.slice(-300));
  check('...and prints neither the e-mail address nor the full number', !/testdriver/.test(preview.out) && !/9123456789/.test(preview.out));
  const applied = run(['09123456789', '--emulator', '--apply']);
  check('--apply (rehearsal) changes it and re-reads the result', applied.status === 0 && /DONE and re-read/.test(applied.out) && /already uses an address/.test(applied.out), applied.out.slice(-300));
  const withPw = run(['09123456789', '--emulator', '--apply', '--set-password-env', 'RELINK_TEST_PW'], { RELINK_TEST_PW: 'Another#Pass9' });
  check('...with --set-password-env the password is set and never printed', withPw.status === 0 && !withPw.out.includes('Another#Pass9'), withPw.out.slice(-200));
  const nobody = run(['09185555555', '--emulator']);
  check('a number with no driver exits with 3 (needs a human)', nobody.status === 3 && /NO driver record/.test(nobody.out), nobody.out.slice(-200));

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
