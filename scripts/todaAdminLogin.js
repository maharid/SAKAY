// scripts/todaAdminLogin.js
// Gives a TODA a working administrator login, or resets the password of the one it already has. PREVIEW first: nothing is changed without --apply.
//
// WHY. The old TODA portal had a development-mode shortcut that opened a fake "DEMO MODE" session for an acronym such as DWCCTODA with ANY
// password, and it looked accounts up before sign-in. Both are gone: the portal signs in with exactly what is typed (an e-mail address, or
// the TODA acronym, which becomes <acronym>@toda.sakay.internal) and the account must be a real administrator record. A TODA that was added
// to the database without an administrator (DWC TODA) therefore has no way in, and an administrator who forgot the password has no recovery
// inside the app (their address cannot receive e-mail).
//
//   For every TODA you name, the script looks at what exists and does the one thing that fits:
//     the TODA has ONE administrator  ->  resets THAT login's password (the e-mail, the role record and everything else stay) and signs
//                                          the login out everywhere
//     the TODA has NO administrator   ->  creates the login <acronym>@toda.sakay.internal (confirmed) and its administrator record (Active)
//     anything else (two administrators, the address belongs to some other login, no such TODA)  ->  stops and says what to decide.
//
//   node scripts/todaAdminLogin.js SINGKOTODA DWCCTODA
//         PREVIEW (read-only). Nothing is asked and nothing is changed. Add --apply and each password is ASKED FOR on the screen: hidden,
//         typed twice, never on the command line and never in your shell history.
//   node scripts/todaAdminLogin.js SINGKOTODA:SINGKOTODA_PASSWORD DWCCTODA:DWCCTODA_PASSWORD [--apply]
//         each password comes from the ENVIRONMENT VARIABLE named after the colon (the variable name is written on the command line, the
//         password is not). Set them for this terminal window only and clear them afterwards:
//             PowerShell:   $env:SINGKOTODA_PASSWORD = '...'   ...   Remove-Item Env:SINGKOTODA_PASSWORD
//   --apply                    makes ALL the changes in ONE transaction (all or nothing) and re-reads the result
//   --allow-burned-password    accept a password that is written in this project's old code (public); refused by default
//   --emulator                 rehearsal on a local PGlite database with made-up TODAs (no network, no DATABASE_URL); used by scripts/db-tests
//
// A password needs at least 8 characters with an uppercase letter, a lowercase letter, a number and a symbol (the rule of the registration
// form). Uses DATABASE_URL from server/.env, like the other scripts here. Prints no password, no hash, and no e-mail address other than the
// built-in <acronym>@toda.sakay.internal form.
// Exit codes: 0 done / nothing to do, 1 error, 2 usage, no DATABASE_URL or a rejected password, 3 needs a human decision.
'use strict';
const path = require('path');
const crypto = require('crypto');
const REPO = path.join(__dirname, '..').replace(/\\/g, '/');

// Passwords that were written in this project's code or shipped in an app: anybody who has read the repository knows them.
const BURNED = ['password123!', 'newpassword123!', '@dmin_123', 'admin123', 'sakay#2026', 'sakaydriver#2026'];
const isBurned = (pw) => BURNED.includes(String(pw).toLowerCase()) || /^sakaydriver#2026_/i.test(String(pw));

function passwordProblem(pw, { allowBurned = false } = {}) {
  if (typeof pw !== 'string' || pw.length < 8) return 'must be at least 8 characters long';
  if (!/[A-Z]/.test(pw)) return 'needs an uppercase letter';
  if (!/[a-z]/.test(pw)) return 'needs a lowercase letter';
  if (!/\d/.test(pw)) return 'needs a number';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'needs a symbol';
  if (!allowBurned && isBurned(pw)) return 'is a password that was written in this project\'s old code (it is public); choose another one, or pass --allow-burned-password for a throw-away test account';
  return null;
}

const maskEmail = (e) => (e ? String(e).replace(/^(.{2})[^@]*(@.*)$/, '$1***$2') : '(none)');
const shortId = (id) => (id ? `${String(id).slice(0, 8)}…` : '(none)');
const isAcronymEmail = (email, acronym) => String(email || '').toLowerCase() === `${acronym.toLowerCase()}@toda.sakay.internal`;

// ---- what exists, and what would fix it ------------------------------------------------------------------------------------------
async function inspectToda(db, acronym) {
  const todas = (await db.query(
    `select toda_id, toda_name, toda_acronym, toda_status, president_name, president_contact from public.toda where lower(toda_acronym) = lower($1)`, [acronym])).rows;
  if (todas.length === 0) return { kind: 'no-toda', acronym };
  if (todas.length > 1) return { kind: 'many-todas', acronym, count: todas.length };
  const toda = todas[0];
  const email = `${acronym.toLowerCase()}@toda.sakay.internal`;
  const admins = (await db.query(
    `select a.admin_id, a.auth_user_id, a.account_status, u.email, (u.id is null or u.deleted_at is not null) as no_login,
            (coalesce(u.encrypted_password, '') <> '') as has_password
       from public.toda_admin a left join auth.users u on u.id = a.auth_user_id
      where a.toda_id = $1 order by a.created_at`, [toda.toda_id])).rows;
  const base = { acronym, toda, email, admins };
  if (admins.length > 1) return { kind: 'many-admins', ...base };
  if (admins.length === 1) return admins[0].no_login ? { kind: 'no-login', ...base } : { kind: 'reset-password', ...base, admin: admins[0] };
  const taken = (await db.query(`select id from auth.users where lower(email) = lower($1)`, [email])).rows;
  if (taken.length) return { kind: 'email-taken', ...base };
  return { kind: 'create-admin', ...base };
}

const ACTIONABLE = ['reset-password', 'create-admin'];

// the text columns Auth keeps as '' (not NULL) on every user it creates; a fixed list, so it is safe to put in the insert statement
const AUTH_TOKEN_COLUMNS = ['confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change', 'email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token'];

function describe(p, log) {
  const say = (s = '') => log(s);
  if (p.kind === 'no-toda') { say(`${p.acronym}: NO TODA with this acronym exists.`); return; }
  if (p.kind === 'many-todas') { say(`${p.acronym}: ${p.count} TODAs share this acronym. Decide which one is real before creating anything.`); return; }
  say(`${p.acronym}: "${p.toda.toda_name}" | TODA status ${p.toda.toda_status}`);
  if (p.kind === 'many-admins') {
    say(`  has ${p.admins.length} administrators: ${p.admins.map((a) => `${shortId(a.admin_id)} ${a.account_status} ${isAcronymEmail(a.email, p.acronym) ? a.email : maskEmail(a.email)}`).join('; ')}`);
    say('  NOT changing anything: decide which administrator login this is about, then reset it from the Supabase dashboard (or remove the extra record) and run again.');
    return;
  }
  if (p.kind === 'no-login') { say('  its administrator record points at a login that does not exist (or was deleted). Not changing anything automatically: remove that record, then run this again to create a fresh login.'); return; }
  if (p.kind === 'email-taken') {
    say(`  has no administrator, but the address ${p.email} already belongs to some other login. Not changing anything: that login is not an administrator of this TODA.`);
    say('  Remove or rename that login in the Supabase dashboard, then run this again.');
    return;
  }
  if (p.kind === 'reset-password') {
    const a = p.admin;
    say(`  has 1 administrator: login ${isAcronymEmail(a.email, p.acronym) ? a.email : maskEmail(a.email)} | status ${a.account_status} | password set=${a.has_password}`);
    say('  PLAN: set a NEW password for that login and sign it out everywhere. The e-mail, the administrator record and everything else stay.');
    if (a.account_status !== 'Active') say(`  NOTE: the administrator record is ${a.account_status}; the portal refuses it whatever the password. Its status is not changed here.`);
    say(isAcronymEmail(a.email, p.acronym) ? `  Then sign in to the TODA portal with  ${p.acronym}  and the new password.` : '  Then sign in to the TODA portal with that e-mail address and the new password.');
    return;
  }
  say('  has NO administrator (the TODA exists, nobody can sign in for it).');
  say(`  PLAN: create the login ${p.email} (confirmed) and its administrator record (Active) for this TODA, with a password you choose.`);
  say(`  Then sign in to the TODA portal with  ${p.acronym}  and that password.`);
}

// ---- apply (inside the caller's transaction) -----------------------------------------------------------------------------------
async function cryptSchema(db) {
  const r = (await db.query(`select n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'crypt' order by (n.nspname = 'extensions') desc limit 1`)).rows[0];
  if (!r) throw new Error('pgcrypto (crypt) is not available on this database, so a password cannot be stored from here');
  return r.nspname;
}

async function applyPlan(db, p, password, log) {
  if (!ACTIONABLE.includes(p.kind)) throw new Error(`nothing to apply for ${p.acronym}: ${p.kind}`);
  const pg = await cryptSchema(db);
  if (p.kind === 'reset-password') {
    const authId = p.admin.auth_user_id;
    const before = (await db.query(`select encrypted_password from auth.users where id = $1`, [authId])).rows[0]?.encrypted_password;
    const u = await db.query(`update auth.users set encrypted_password = ${pg}.crypt($2, ${pg}.gen_salt('bf', 10)), updated_at = now() where id = $1`, [authId, password]);
    if (u.rowCount !== 1) throw new Error(`${p.acronym}: the password was not updated`);
    // sign the login out everywhere (existing sessions survive a password change otherwise); optional, never fatal
    const hasSessions = (await db.query(`select to_regclass('auth.sessions') is not null as ok`)).rows[0].ok;
    if (hasSessions) {
      await db.query('SAVEPOINT revoke_sessions');
      try { await db.query(`delete from auth.sessions where user_id = $1`, [authId]); await db.query('RELEASE SAVEPOINT revoke_sessions'); }
      catch (e) { await db.query('ROLLBACK TO SAVEPOINT revoke_sessions'); log(`  (note: could not sign the old sessions out: ${String(e.message).split('\n')[0]})`); }
    }
    const check = (await db.query(`select encrypted_password, (encrypted_password = ${pg}.crypt($2, encrypted_password)) as ok from auth.users where id = $1`, [authId, password])).rows[0];
    if (!check || check.ok !== true || check.encrypted_password === before) throw new Error(`${p.acronym}: verification failed; rolled back`);
    await audit(db, p, 'TODA_ADMIN_PASSWORD_RESET', `The password of the administrator login of ${p.toda.toda_name} (${p.acronym}) was reset from the command line (scripts/todaAdminLogin.js).`, log);
    log(`  ${p.acronym}: password reset for the existing administrator login${isAcronymEmail(p.admin.email, p.acronym) ? ` (${p.admin.email})` : ''}.`);
    return;
  }
  // create-admin
  const authId = crypto.randomUUID();
  const fullName = (p.toda.president_name || `${p.toda.toda_name} Administrator`).slice(0, 120);
  // Auth (GoTrue) writes '' - never NULL - into its token columns, and on some Auth versions a row that leaves them NULL fails at sign-in with
  // "Database error querying schema". Set them to '' (only the ones this database has), so the login looks exactly like one Auth created.
  const tokenColumns = (await db.query(
    `select column_name from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = any($1::text[]) order by column_name`,
    [AUTH_TOKEN_COLUMNS])).rows.map((r) => r.column_name);
  await db.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at${tokenColumns.map((c) => `, ${c}`).join('')})
     values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, ${pg}.crypt($3, ${pg}.gen_salt('bf', 10)), now(),
             '{"provider":"email","providers":["email"]}'::jsonb, $4::jsonb, now(), now()${tokenColumns.map(() => ", ''").join('')})`,
    [authId, p.email, password, JSON.stringify({ full_name: fullName })]);          // no "role" in the sign-up data: nothing may treat this login as anything else
  await db.query(
    `insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, $2::text, $3::jsonb, 'email', now(), now())`,
    [authId, authId, JSON.stringify({ sub: authId, email: p.email, email_verified: true, phone_verified: false })]);
  await db.query(
    `insert into public.toda_admin (auth_user_id, toda_id, full_name, email, contact_number, account_status, toda_acronym)
     values ($1::uuid, $2::uuid, $3, $4, $5, 'Active', $6)`,
    [authId, p.toda.toda_id, fullName, p.email, p.toda.president_contact || null, p.toda.toda_acronym]);
  const check = (await db.query(
    `select (select count(*) from public.toda_admin where toda_id = $1)::int as admins,
            (select count(*) from auth.users where lower(email) = lower($2))::int as logins,
            coalesce((select (u.encrypted_password = ${pg}.crypt($4, u.encrypted_password)) and u.email_confirmed_at is not null from auth.users u where u.id = $3), false) as ok`,
    [p.toda.toda_id, p.email, authId, password])).rows[0];
  if (check.admins !== 1 || check.logins !== 1 || check.ok !== true) throw new Error(`${p.acronym}: verification failed; rolled back`);
  await audit(db, p, 'TODA_ADMIN_LOGIN_CREATED', `A login and administrator record were created for ${p.toda.toda_name} (${p.acronym}) from the command line (scripts/todaAdminLogin.js).`, log);
  log(`  ${p.acronym}: created the login ${p.email} and its administrator record (Active).`);
}

// an audit-log entry for what was done; never fatal (the log's columns may differ), never contains a password
async function audit(db, p, actionType, details, log) {
  await db.query('SAVEPOINT audit_entry');
  try {
    await db.query(`insert into public.audit_log (action_type, target_id, details, performed_at) values ($1, $2, $3, now())`, [actionType, p.toda.toda_id, details]);
    await db.query('RELEASE SAVEPOINT audit_entry');
  } catch (e) {
    await db.query('ROLLBACK TO SAVEPOINT audit_entry');
    log(`  (note: the audit-log entry was not written: ${String(e.message).split('\n')[0]})`);
  }
}

// ---- passwords: from the environment, or asked for on the screen (hidden) --------------------------------------------------------
function askHidden(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) { reject(new Error('there is no terminal to ask in. Pass the password through an environment variable instead: ACRONYM:ENV_VAR_NAME')); return; }
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const done = (fn, value) => { stdin.removeListener('data', onData); stdin.setRawMode(false); stdin.pause(); process.stdout.write('\n'); fn(value); };
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n' || c === '\u0004') return done(resolve, buf);
        if (c === '\u0003') return done(reject, new Error('cancelled'));
        if (c === '\u007f' || c === '\b') { buf = buf.slice(0, -1); continue; }
        buf += c;
      }
    };
    stdin.on('data', onData);
  });
}

async function askTwice(label) {
  const a = await askHidden(`New password for ${label} (hidden): `);
  const b = await askHidden('Type it again: ');
  if (a !== b) throw new Error(`the two entries for ${label} differ`);
  return a;
}

// ---- the rehearsal world (--emulator) ---------------------------------------------------------------------------------------------
async function rehearsalDb() {
  const { freshDb } = require(`${REPO}/scripts/db-tests/tlib`);
  const db = await freshDb('20261007000004_security_null_safe_service_context.sql');
  await db.exec(`
    insert into public.toda (toda_id, toda_name, toda_acronym, president_name, president_contact, toda_status, account_status) values
      ('31275516-0000-4000-8000-000000000001', 'Sta. Isabel TODA', 'SINGKOTODA', 'Pres Ident', '+639170000001', 'Active', 'Active'),
      ('30891ef9-0000-4000-8000-000000000002', 'DWCC TODA', 'DWCCTODA', 'Dee Dub', '+639170000002', 'Active', 'Active');
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values ('a9021cae-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'singkotoda@toda.sakay.internal',
            crypt('Forgotten#1', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}');
    insert into public.toda_admin (auth_user_id, toda_id, full_name, email, account_status)
    values ('a9021cae-0000-4000-8000-0000000000a1', '31275516-0000-4000-8000-000000000001', 'Pres Ident', 'singkotoda@toda.sakay.internal', 'Active');`);
  return {
    kind: 'emulator',
    target: 'local PGlite rehearsal database (made-up TODAs; proves nothing about the hosted database)',
    query: async (sql, params) => { const r = await db.query(sql, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; },
    close: async () => {},
  };
}

async function openDb(emulator) {
  if (emulator) return rehearsalDb();
  require(`${REPO}/node_modules/dotenv`).config({ path: `${REPO}/server/.env` });
  const { Client } = require(`${REPO}/node_modules/pg`);
  const url = process.env.DATABASE_URL;
  if (!url) { console.log('NO DATABASE_URL in server/.env'); process.exit(2); }
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const u = new URL(url);
  return {
    kind: 'pg',
    target: `${u.hostname} | db ${u.pathname.slice(1)}`,
    query: async (sql, params) => { const r = await c.query(sql, params); return { rows: r.rows, rowCount: r.rowCount }; },
    close: async () => { await c.end(); },
  };
}

function parseEntries(args) {
  const entries = [];
  for (const a of args.filter((x) => !x.startsWith('--'))) {
    const [acr, envName, ...rest] = a.split(':');
    if (!/^[A-Za-z0-9_-]{2,30}$/.test(acr || '') || rest.length || (envName !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName))) {
      throw new Error(`"${a}" is not ACRONYM or ACRONYM:ENV_VAR_NAME`);
    }
    if (entries.some((e) => e.acronym === acr.toUpperCase())) throw new Error(`${acr.toUpperCase()} is named twice`);
    entries.push({ acronym: acr.toUpperCase(), envName });
  }
  return entries;
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n) => argv.includes(n);
  let entries;
  try { entries = parseEntries(argv); } catch (e) { console.log(e.message); entries = []; }
  if (!entries.length) {
    console.log('usage: node scripts/todaAdminLogin.js ACRONYM[:ENV_VAR_NAME] [ACRONYM[:ENV_VAR_NAME] ...] [--apply] [--allow-burned-password] [--emulator]');
    process.exit(2);
  }
  const apply = flag('--apply');
  const allowBurned = flag('--allow-burned-password');

  // passwords named through the environment are checked right away (nothing is printed but ok / the reason)
  const passwords = new Map();
  for (const e of entries.filter((x) => x.envName)) {
    const value = process.env[e.envName];
    if (!value) { console.log(`${e.acronym}: the environment variable ${e.envName} is not set.`); process.exit(2); }
    const problem = passwordProblem(value, { allowBurned });
    if (problem) { console.log(`${e.acronym}: the password in ${e.envName} ${problem}.`); process.exit(2); }
    passwords.set(e.acronym, value);
  }

  const db = await openDb(flag('--emulator'));
  try {
    console.log(`MODE ${apply ? 'APPLY' : 'PREVIEW (read-only)'} | target ${db.target}\n`);
    const plans = [];
    for (const e of entries) {
      const p = await inspectToda(db, e.acronym);
      plans.push(p);
      describe(p, console.log);
      console.log(`  password: ${e.envName ? `taken from ${e.envName} (set, passes the rules)` : 'will be asked for on the screen (hidden, typed twice)'}\n`);
    }
    if (plans.some((p) => !ACTIONABLE.includes(p.kind))) { console.log('Nothing was changed: at least one TODA needs a decision first (see above).'); process.exitCode = 3; return; }
    if (!apply) { console.log('Preview only. Run again with --apply to make these changes.'); return; }

    for (const e of entries.filter((x) => !x.envName)) {          // asked BEFORE the transaction opens, so nothing waits on a person while locks are held
      const pw = await askTwice(e.acronym);
      const problem = passwordProblem(pw, { allowBurned });
      if (problem) { console.log(`${e.acronym}: that password ${problem}.`); process.exitCode = 2; return; }
      passwords.set(e.acronym, pw);
    }

    await db.query('BEGIN');
    try {
      for (const p of plans) await applyPlan(db, p, passwords.get(p.acronym), console.log);
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK').catch(() => {});
      console.log(`\nFAILED and rolled back, nothing was changed: ${String(err.message).split('\n')[0]}`);
      process.exitCode = 1;
      return;
    }
    console.log('\nDONE (one transaction) and re-read. Sign in to the TODA portal (npm run dev:toda, http://localhost:5175) with the acronym and the password you set.');
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('ERROR:', String(e.message).split('\n')[0]); process.exit(1); });
}

module.exports = { passwordProblem, isBurned, parseEntries, inspectToda, describe, applyPlan, ACTIONABLE };
