// scripts/todaAdminLogin.js, rehearsed on the local emulator (the database just before the lockdown AND the fully locked-down chain):
// what it finds, what it creates / resets, what it refuses to touch, that it is all-or-nothing, and that no password is ever printed.
// Nothing here connects to Supabase.
const path = require('path');
const { spawnSync } = require('child_process');
const { freshDb, check, summary } = require('../tlib');
const tl = require('../../todaAdminLogin');

const PRE = '20261007000004_security_null_safe_service_context.sql';
const script = path.join(__dirname, '..', '..', 'todaAdminLogin.js');
// DATABASE_URL is blanked on purpose: no run here may ever reach a hosted database.
const run = (args, env = {}) => {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 300000, stdin: 'ignore', env: { ...process.env, DATABASE_URL: '', ...env } });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const adapter = (db) => ({ query: async (sql, params) => { const r = await db.query(sql, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; } });
const row = async (db, sql, p) => (await db.query(sql, p)).rows[0];

const T = { sta: '31275516-0000-4000-8000-000000000001', dwcc: '30891ef9-0000-4000-8000-000000000002', third: '33333333-0000-4000-8000-000000000003',
  twins: '44444444-0000-4000-8000-000000000004', ghost: '55555555-0000-4000-8000-000000000005' };
const U = { sta: 'a9021cae-0000-4000-8000-0000000000a1', thirdSquatter: 'a9021cae-0000-4000-8000-0000000000a2', twin1: 'a9021cae-0000-4000-8000-0000000000a3',
  twin2: 'a9021cae-0000-4000-8000-0000000000a4', ghost: 'a9021cae-0000-4000-8000-0000000000a5' };

async function build(db) {
  const toda = (id, name, acr) => db.query(`insert into public.toda (toda_id, toda_name, toda_acronym, president_name, president_contact, toda_status, account_status) values ($1, $2, $3, 'Pres Ident', '+639170000001', 'Active', 'Active')`, [id, name, acr]);
  const user = (id, email, deleted = false) => db.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, deleted_at, raw_app_meta_data, raw_user_meta_data)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, crypt('Forgotten#1', gen_salt('bf')), now(), ${deleted ? 'now()' : 'null'}, '{"provider":"email","providers":["email"]}', '{}')`, [id, email]);
  const admin = (uid, tid, email, status = 'Active') => db.query(`insert into public.toda_admin (auth_user_id, toda_id, full_name, email, account_status) values ($1, $2, 'Admin', $3, $4)`, [uid, tid, email, status]);

  await toda(T.sta, 'Sta. Isabel TODA', 'SINGKOTODA');   await user(U.sta, 'singkotoda@toda.sakay.internal');   await admin(U.sta, T.sta, 'singkotoda@toda.sakay.internal');
  await toda(T.dwcc, 'DWCC TODA', 'DWCCTODA');                                                                           // no administrator
  await toda(T.third, 'Third TODA', 'THIRDTODA');        await user(U.thirdSquatter, 'thirdtoda@toda.sakay.internal');   // the address is held by some other login
  await toda(T.twins, 'Twins TODA', 'TWINSTODA');        await user(U.twin1, 'twin1@example.test'); await user(U.twin2, 'twin2@example.test');
  await admin(U.twin1, T.twins, 'twin1@example.test'); await admin(U.twin2, T.twins, 'twin2@example.test');                // two administrators
  await toda(T.ghost, 'Ghost TODA', 'GHOSTTODA');        await user(U.ghost, 'ghost@example.test', true);  await admin(U.ghost, T.ghost, 'ghost@example.test');   // login was deleted
}

async function scenarios(label, until) {
  console.log(`\n=== ${label}`);
  const db = await freshDb(until);
  await build(db);
  await db.exec(`create table if not exists auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid)`);   // not in the emulator by default
  await db.query(`insert into auth.sessions (user_id) values ($1), ($1)`, [U.sta]);
  const a = adapter(db);
  const lines = [];
  const log = (s) => lines.push(String(s));

  const sta = await tl.inspectToda(a, 'SINGKOTODA');
  const dwcc = await tl.inspectToda(a, 'dwccToda');
  check('SINGKOTODA has one administrator -> reset that login\'s password', sta.kind === 'reset-password' && sta.admin.auth_user_id === U.sta, sta.kind);
  check('DWCCTODA has none -> create the login and the administrator record (acronym typed in any case)', dwcc.kind === 'create-admin' && dwcc.email === 'dwcctoda@toda.sakay.internal', dwcc.kind);
  check('...inspecting changes nothing', (await row(db, `select count(*)::int as n from auth.users where lower(email) = 'dwcctoda@toda.sakay.internal'`)).n === 0);
  tl.describe(sta, log); tl.describe(dwcc, log);
  const text = lines.join('\n');
  check('...what it prints names the plan and never an e-mail other than the built-in acronym form', /set a NEW password/.test(text) && /create the login dwcctoda@toda\.sakay\.internal/.test(text) && !/Forgotten/.test(text));

  const staBefore = await row(db, `select encrypted_password, email, email_confirmed_at is not null as confirmed from auth.users where id = $1`, [U.sta]);
  const staAdminBefore = await row(db, `select admin_id, toda_id, full_name, email, account_status from public.toda_admin where auth_user_id = $1`, [U.sta]);

  // ---- both, in ONE transaction, the way the command line does it ----
  await a.query('BEGIN');
  await tl.applyPlan(a, sta, 'Fresh#Start1', log);
  await tl.applyPlan(a, dwcc, 'Another#Pass2', log);
  await a.query('COMMIT');

  const staAfter = await row(db, `select encrypted_password, email, email_confirmed_at is not null as confirmed, (encrypted_password = crypt('Fresh#Start1', encrypted_password)) as new_ok, (encrypted_password = crypt('Forgotten#1', encrypted_password)) as old_ok from auth.users where id = $1`, [U.sta]);
  const staAdminAfter = await row(db, `select admin_id, toda_id, full_name, email, account_status from public.toda_admin where auth_user_id = $1`, [U.sta]);
  check('SINGKOTODA: the new password works, the forgotten one no longer does, and the hash changed', staAfter.new_ok === true && staAfter.old_ok === false && staAfter.encrypted_password !== staBefore.encrypted_password);
  check('...the e-mail, confirmation and the administrator record are exactly as they were', staAfter.email === staBefore.email && staAfter.confirmed === true && JSON.stringify(staAdminAfter) === JSON.stringify(staAdminBefore));
  check('...and the login was signed out everywhere', (await row(db, `select count(*)::int as n from auth.sessions where user_id = $1`, [U.sta])).n === 0);

  const dw = await row(db, `select u.id, u.email, u.email_confirmed_at is not null as confirmed, (u.encrypted_password = crypt('Another#Pass2', u.encrypted_password)) as pw_ok, u.raw_user_meta_data as meta from auth.users u where lower(u.email) = 'dwcctoda@toda.sakay.internal'`);
  check('DWCCTODA: the login exists, is confirmed, and has the chosen password', dw && dw.confirmed === true && dw.pw_ok === true, dw && dw.email);
  const tokens = await row(db, `select confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token from auth.users where id = $1`, [dw.id]);
  check('...its sign-up data carries NO role (nothing may treat it as anything else), and its token columns hold \'\' not NULL, like a login Auth created',
    dw && !('role' in dw.meta) && Object.values(tokens).every((v) => v === ''), tokens);
  const dwAdmin = await row(db, `select auth_user_id, toda_id, email, account_status, toda_acronym from public.toda_admin where toda_id = $1`, [T.dwcc]);
  check('...the administrator record is Active, for DWC TODA, with the portal\'s login address', dwAdmin && dwAdmin.auth_user_id === dw.id && dwAdmin.account_status === 'Active' && dwAdmin.email === 'dwcctoda@toda.sakay.internal' && dwAdmin.toda_acronym === 'DWCCTODA', dwAdmin);
  check('...it has an e-mail identity, and no passenger / driver / LGU record was created for it',
    (await row(db, `select count(*)::int as n from auth.identities where user_id = $1 and provider = 'email'`, [dw.id])).n === 1
    && (await row(db, `select (select count(*) from public.passenger where auth_user_id = $1)::int + (select count(*) from public.driver where auth_user_id = $1)::int + (select count(*) from public.lgu_admin where auth_user_id = $1)::int as n`, [dw.id])).n === 0);
  check('...and both actions are in the audit log, without any password',
    (await row(db, `select count(*)::int as n from public.audit_log where action_type in ('TODA_ADMIN_LOGIN_CREATED', 'TODA_ADMIN_PASSWORD_RESET')`)).n === 2
    && !lines.join('\n').includes('Fresh#Start1') && !lines.join('\n').includes('Another#Pass2'));

  // ---- idempotence: DWCCTODA now has an administrator, so a second run is a reset ----
  const again = await tl.inspectToda(a, 'DWCCTODA');
  check('a second look at DWCCTODA says reset-password (it is never created twice)', again.kind === 'reset-password', again.kind);

  // ---- refusals ----
  const third = await tl.inspectToda(a, 'THIRDTODA');
  check('THIRDTODA: no administrator, but the address belongs to some other login -> email-taken, nothing is touched', third.kind === 'email-taken'
    && await tl.applyPlan(a, third, 'Another#Pass2', log).then(() => false, (e) => /nothing to apply/.test(e.message)));
  check('TWINSTODA: two administrators -> refused to guess', (await tl.inspectToda(a, 'TWINSTODA')).kind === 'many-admins');
  check('GHOSTTODA: the administrator record points at a deleted login -> refused', (await tl.inspectToda(a, 'GHOSTTODA')).kind === 'no-login');
  check('an acronym nobody has -> no-toda', (await tl.inspectToda(a, 'NOPE')).kind === 'no-toda');

  // ---- all or nothing: the second entry fails after the first one succeeded ----
  const tBefore = (await row(db, `select encrypted_password from auth.users where id = $1`, [U.sta])).encrypted_password;
  const planA = await tl.inspectToda(a, 'SINGKOTODA');
  await db.query(`insert into public.toda (toda_id, toda_name, toda_acronym, president_name, toda_status, account_status) values ('66666666-0000-4000-8000-000000000006', 'Race TODA', 'RACETODA', 'R', 'Active', 'Active')`);
  const planB = await tl.inspectToda(a, 'RACETODA');
  await db.query(`insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values ('a9021cae-0000-4000-8000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'racetoda@toda.sakay.internal', '{}', '{}')`);
  await a.query('BEGIN');
  let failed = null;
  try { await tl.applyPlan(a, planA, 'Third#Change3', log); await tl.applyPlan(a, planB, 'Third#Change3', log); await a.query('COMMIT'); }
  catch (e) { failed = e.message; await a.query('ROLLBACK'); }
  check('if one entry fails, the other one is rolled back too (SINGKOTODA keeps the password it had)', failed !== null
    && (await row(db, `select encrypted_password from auth.users where id = $1`, [U.sta])).encrypted_password === tBefore
    && (await row(db, `select count(*)::int as n from public.toda_admin where toda_id = '66666666-0000-4000-8000-000000000006'`)).n === 0, failed);
  await db.close();
}

(async () => {
  console.log('\nthe password rules');
  check('weak passwords are refused with the reason', tl.passwordProblem('short1!A') === null && tl.passwordProblem('Sh0rt!') !== null && tl.passwordProblem('alllowercase1!') !== null
    && tl.passwordProblem('ALLUPPERCASE1!') !== null && tl.passwordProblem('NoNumbers!!') !== null && tl.passwordProblem('NoSymbol123') !== null);
  check('passwords that were written in the old code are refused unless allowed (@Dmin_123, Password123!, any case)',
    /old code/.test(tl.passwordProblem('@Dmin_123') || '') && /old code/.test(tl.passwordProblem('Password123!') || '') && /old code/.test(tl.passwordProblem('passWORD123!') || '')
    && tl.passwordProblem('@Dmin_123', { allowBurned: true }) === null);
  check('the entries are ACRONYM or ACRONYM:ENV_VAR; anything else is refused', tl.parseEntries(['SINGKOTODA:A_PW', 'dwcctoda']).length === 2
    && [['x'], ['ABC:1BAD'], ['ABC:A:B'], ['ABC', 'abc']].every((bad) => { try { tl.parseEntries(bad); return false; } catch { return true; } }));

  await scenarios('the database just before the lockdown', PRE);
  await scenarios('the fully locked-down chain (S0-S4 applied)', undefined);

  console.log('\nthe command line');
  const none = run([]);
  check('no acronym prints the usage and exits with 2', none.status === 2 && /usage:/.test(none.out));
  const noUrl = run(['SINGKOTODA:X_PW'], { X_PW: 'Fresh#Start1' });
  check('without DATABASE_URL it stops before doing anything', noUrl.status === 2 && /NO DATABASE_URL/.test(noUrl.out), noUrl.out.slice(0, 120));
  const unset = run(['SINGKOTODA:NOT_SET_ANYWHERE', '--emulator']);
  check('an unset environment variable exits with 2 and says which one', unset.status === 2 && /NOT_SET_ANYWHERE is not set/.test(unset.out), unset.out.slice(0, 160));
  const weak = run(['SINGKOTODA:W_PW', '--emulator'], { W_PW: 'weak' });
  check('a weak password exits with 2 and never prints the password', weak.status === 2 && /at least 8/.test(weak.out) && !weak.out.includes('weak\n'), weak.out.slice(0, 160));
  const burned = run(['DWCCTODA:B_PW', '--emulator'], { B_PW: '@Dmin_123' });
  check('the old sample password @Dmin_123 is refused by default, and the message says why', burned.status === 2 && /written in this project's old code/.test(burned.out), burned.out.slice(0, 200));
  const burnedOk = run(['DWCCTODA:B_PW', '--emulator', '--allow-burned-password'], { B_PW: '@Dmin_123' });
  check('...and accepted with --allow-burned-password (preview)', burnedOk.status === 0 && /Preview only/.test(burnedOk.out), burnedOk.out.slice(-200));
  const preview = run(['SINGKOTODA:S_PW', 'DWCCTODA:D_PW', '--emulator'], { S_PW: 'Fresh#Start1', D_PW: 'Another#Pass2' });
  check('the preview shows both plans, changes nothing, and prints no password', preview.status === 0 && /set a NEW password/.test(preview.out) && /create the login dwcctoda@toda\.sakay\.internal/.test(preview.out)
    && /Preview only/.test(preview.out) && !preview.out.includes('Fresh#Start1') && !preview.out.includes('Another#Pass2'), preview.out.slice(-300));
  const applied = run(['SINGKOTODA:S_PW', 'DWCCTODA:D_PW', '--emulator', '--apply'], { S_PW: 'Fresh#Start1', D_PW: 'Another#Pass2' });
  check('--apply (rehearsal) does both in one transaction and never prints a password', applied.status === 0 && /password reset for the existing administrator login/.test(applied.out) && /created the login dwcctoda@toda\.sakay\.internal/.test(applied.out)
    && /DONE \(one transaction\)/.test(applied.out) && !applied.out.includes('Fresh#Start1') && !applied.out.includes('Another#Pass2'), applied.out.slice(-300));
  const noTty = run(['SINGKOTODA', '--emulator', '--apply']);
  check('with no terminal and no environment variable, --apply cannot ask for a password and says so (nothing changes)', noTty.status === 1 && /no terminal to ask in/.test(noTty.out), noTty.out.slice(-200));
  const unknown = run(['NOSUCHTODA:S_PW', '--emulator'], { S_PW: 'Fresh#Start1' });
  check('an acronym that does not exist exits with 3 (needs a human)', unknown.status === 3 && /NO TODA with this acronym/.test(unknown.out), unknown.out.slice(-200));

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
