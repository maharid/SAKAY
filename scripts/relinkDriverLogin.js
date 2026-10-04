// scripts/relinkDriverLogin.js
// Repairs the login of ONE driver whose Supabase Auth e-mail is not an address the Driver app derives from the mobile number.
//
// WHY. The Driver app used to find a driver by looking the mobile number up BEFORE sign-in (with a built-in administrator account) and then
// signed in with whatever e-mail was stored on the driver's record. That look-up is gone (anybody could use it to find out who is
// registered), so the app now signs in with the e-mail it DERIVES from the number that was typed:  driver_63<10 digits>@sakay.ph
// (four older spellings are tried too). An account that was made by hand, for example the test driver "Juan" (testdriver@sakay.local),
// is not reachable that way. This script gives such an account the standard address. Nothing else changes: the same driver record, the same
// password, the same documents, affiliations and history.
//
//   node scripts/relinkDriverLogin.js 09123456789                     READ-ONLY: shows what is wrong and exactly what --apply would change
//   node scripts/relinkDriverLogin.js 09123456789 --apply             makes the change, in ONE transaction, and re-reads it
//   node scripts/relinkDriverLogin.js 09123456789 --apply --set-password-env DRIVER_NEW_PASSWORD
//                                                                     also sets the password to the value of that environment variable
//                                                                     (use it only if the old password no longer works; the value is never
//                                                                     typed on the command line and never printed)
//   --emulator   rehearsal on a local PGlite database with a made-up "Juan" (no network, no DATABASE_URL); used by scripts/db-tests
//
// Uses DATABASE_URL from server/.env, like the other scripts here. Prints no passwords, tokens or full e-mail addresses / numbers.
// Exit codes: 0 done / nothing to do, 1 error, 2 usage or no DATABASE_URL, 3 needs a human decision (conflict, no driver, several drivers).
'use strict';
const path = require('path');
const REPO = path.join(__dirname, '..').replace(/\\/g, '/');

// ---- the addresses the Driver app tries (mirror of getPhoneLookupCandidates() in apps/driver-pwa/src/services/driverApiService.ts) -----
const last10 = (raw) => String(raw ?? '').replace(/\D/g, '').slice(-10);
const loginEmails = (p10) => ({
  standard: `driver_63${p10}@sakay.ph`,
  all: [`driver_63${p10}@sakay.ph`, `driver_0${p10}@sakay.ph`, `driver_${p10}@sakay.ph`, `driver_0${p10}@driver.sakay.internal`, `driver_63${p10}@driver.sakay.internal`],
});

const maskEmail = (e) => (e ? String(e).replace(/^(.{2})[^@]*(@.*)$/, '$1***$2') : '(none)');
const shortId = (id) => (id ? `${String(id).slice(0, 8)}…` : '(none)');

// ---- inspect: what is the situation, and what would fix it ------------------------------------------------------------------------
async function inspect(db, phoneInput) {
  const p10 = last10(phoneInput);
  if (!/^9\d{9}$/.test(p10)) return { kind: 'usage', message: 'Give a Philippine mobile number such as 09123456789.' };
  const want = loginEmails(p10);

  const drivers = (await db.query(
    `select driver_id, full_name, account_status, auth_user_id, email
       from public.driver
      where right(regexp_replace(coalesce(contact_number, ''), '\\D', '', 'g'), 10) = $1`, [p10])).rows;
  if (drivers.length === 0) return { kind: 'no-driver', p10, want };
  if (drivers.length > 1) return { kind: 'many-drivers', p10, want, count: drivers.length };
  const driver = drivers[0];

  const authCols = `id, email, (email_confirmed_at is not null) as confirmed, (coalesce(encrypted_password, '') <> '') as has_password,
                    (banned_until is not null and banned_until > now()) as banned, (deleted_at is not null) as deleted`;
  const linked = driver.auth_user_id ? (await db.query(`select ${authCols} from auth.users where id = $1`, [driver.auth_user_id])).rows[0] || null : null;
  const hits = (await db.query(`select ${authCols} from auth.users where lower(email) = any($1::text[]) and deleted_at is null order by created_at`, [want.all])).rows;

  const base = { p10, want, driver, linked, hits };
  if (linked && !linked.deleted && want.all.includes(String(linked.email).toLowerCase())) return { kind: 'reachable', ...base };
  const others = hits.filter((h) => !linked || h.id !== linked.id);
  if (linked && !linked.deleted) {
    if (others.length) return { kind: 'conflict', ...base, others };
    return { kind: 'rename-login', ...base };
  }
  // the record points at no usable login
  if (others.length === 1) return { kind: 'repoint-driver', ...base, target: others[0] };
  if (others.length > 1) return { kind: 'conflict', ...base, others };
  return { kind: 'no-login', ...base };
}

function describe(r, log) {
  const say = (s = '') => log(s);
  if (r.kind === 'usage') { say(r.message); return; }
  say(`the number ends ...${r.p10.slice(-4)}; the Driver app signs in with driver_63*******${r.p10.slice(-3)}@sakay.ph (and ${r.want.all.length - 1} older spellings)`);
  if (r.kind === 'no-driver') { say('NO driver record has this number. Nothing to repair here.'); return; }
  if (r.kind === 'many-drivers') { say(`${r.count} driver records share this number. Decide which one is the real one before repairing anything.`); return; }
  const d = r.driver;
  say(`driver ${shortId(d.driver_id)} | "${d.full_name}" | status ${d.account_status} | linked login ${shortId(d.auth_user_id)}`);
  if (r.linked) say(`linked login: ${maskEmail(r.linked.email)} | confirmed=${r.linked.confirmed} | password set=${r.linked.has_password} | banned=${r.linked.banned}${r.linked.deleted ? ' | DELETED' : ''}`);
  else say('linked login: none (the record has no usable login account)');
  if (r.kind === 'reachable') { say('OK: the linked login already uses an address the Driver app tries. If sign-in still fails the cause is the password (see --set-password-env).'); return; }
  if (r.kind === 'conflict') {
    say(`CONFLICT: another login already owns an address the app tries: ${r.others.map((o) => `${shortId(o.id)} ${maskEmail(o.email)}`).join(', ')}.`);
    say('Not changing anything automatically. Decide which of the two logins is the real one (the dashboard shows both), then remove or rename the other and run this again.');
    return;
  }
  if (r.kind === 'no-login') { say('NO login account exists for this driver (and none with the standard address). The driver has to register again.'); return; }
  say('PROBLEM: the linked login is not one of the addresses the app tries, so the app cannot find this driver.');
  say('PLAN (nothing is changed without --apply):');
  if (r.kind === 'rename-login') {
    say(`  1. auth.users ${shortId(r.linked.id)}: e-mail ${maskEmail(r.linked.email)} -> driver_63*******${r.p10.slice(-3)}@sakay.ph   (marked confirmed; the password is NOT touched)`);
    say('  2. auth.identities (email): updated to match');
    say('  3. public.driver.email: updated to match');
  } else {
    say(`  1. public.driver ${shortId(d.driver_id)}: auth_user_id ${shortId(d.auth_user_id)} -> ${shortId(r.target.id)} (the login that owns the standard address ${maskEmail(r.target.email)})`);
    say('     (files that driver uploaded under the old login id stay in that folder; they are not moved)');
  }
  say('  Nothing else is touched: driver record, documents, affiliations, history.');
}

// ---- apply: ONE transaction, re-read before COMMIT -----------------------------------------------------------------------------
async function cryptSchema(db) {
  const r = (await db.query(`select n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'crypt' order by (n.nspname = 'extensions') desc limit 1`)).rows[0];
  return r ? r.nspname : null;
}

async function applyPlan(db, r, opts, log) {
  if (!['rename-login', 'repoint-driver', 'reachable'].includes(r.kind)) throw new Error(`nothing to apply for: ${r.kind}`);
  if (r.kind === 'reachable' && !opts.password) { log('nothing to change.'); return false; }
  await db.query('BEGIN');
  try {
    const std = r.want.standard;
    let authId = r.kind === 'repoint-driver' ? r.target.id : r.linked.id;
    if (r.kind === 'rename-login') {
      const u = await db.query(
        `update auth.users set email = $2, email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = $1 and lower(email) <> lower($2)`, [authId, std]);
      if (u.rowCount !== 1) throw new Error('the login e-mail was not updated (it changed while this ran?)');
      await db.query(
        `update auth.identities set identity_data = jsonb_set(coalesce(identity_data, '{}'::jsonb), '{email}', to_jsonb($2::text)), updated_at = now() where user_id = $1 and provider = 'email'`, [authId, std]);
      await db.query(`update public.driver set email = $2 where driver_id = $1`, [r.driver.driver_id, std]);
    } else if (r.kind === 'repoint-driver') {
      const u = await db.query(`update public.driver set auth_user_id = $2, email = $3 where driver_id = $1`, [r.driver.driver_id, authId, std]);
      if (u.rowCount !== 1) throw new Error('the driver record was not updated');
    }
    if (opts.password) {
      const schema = await cryptSchema(db);
      if (!schema) throw new Error('pgcrypto (crypt) is not available on this database, so the password cannot be set here; set it in the Supabase dashboard instead');
      const p = await db.query(`update auth.users set encrypted_password = ${schema}.crypt($2, ${schema}.gen_salt('bf', 10)), updated_at = now() where id = $1`, [authId, opts.password]);
      if (p.rowCount !== 1) throw new Error('the password was not updated');
    }
    // re-read inside the transaction: the standard address must now belong to exactly one login, the one the driver record points at
    // (a password-only change leaves the address as it was: then the login must simply still be the one the driver record points at)
    const owners = (await db.query(`select id, (email_confirmed_at is not null) as confirmed from auth.users where lower(email) = lower($1)`, [std])).rows;
    const linkedNow = (await db.query(`select auth_user_id from public.driver where driver_id = $1`, [r.driver.driver_id])).rows[0]?.auth_user_id;
    if (r.kind === 'reachable') {
      if (linkedNow !== r.linked.id) throw new Error('verification failed; rolled back');
    } else if (owners.length !== 1 || owners[0].id !== authId || linkedNow !== authId || owners[0].confirmed !== true) {
      throw new Error('verification failed; rolled back');
    }
    await db.query('COMMIT');
    return true;
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  }
}

// ---- the rehearsal world (--emulator) ----------------------------------------------------------------------------------------------
async function rehearsalDb() {
  const { freshDb } = require(`${REPO}/scripts/db-tests/tlib`);
  const db = await freshDb('20261007000004_security_null_safe_service_context.sql');
  await db.exec(`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'testdriver@sakay.local',
            crypt('Rehearsal#1', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}');
    insert into auth.identities (user_id, identity_data, provider, provider_id)
    values ('22222222-2222-2222-2222-222222222222', '{"sub":"22222222-2222-2222-2222-222222222222","email":"testdriver@sakay.local"}', 'email', '22222222-2222-2222-2222-222222222222');
    insert into public.driver (driver_id, auth_user_id, full_name, contact_number, email, account_status)
    values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'Juan Dela Cruz (Test)', '+639123456789', 'testdriver@sakay.local', 'Verified');`);
  return {
    kind: 'emulator',
    target: 'local PGlite rehearsal database (a made-up Juan; proves nothing about the hosted database)',
    query: async (sql, params) => { const r = await db.query(sql, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; },
    close: async () => {},
    raw: db,
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

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n) => argv.includes(n);
  const valueOf = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1] === '--set-password-env'));
  const phone = positional[0];
  if (!phone) {
    console.log('usage: node scripts/relinkDriverLogin.js <mobile number, e.g. 09123456789> [--apply] [--set-password-env NAME] [--emulator]');
    process.exit(2);
  }
  const apply = flag('--apply');
  let password;
  if (flag('--set-password-env')) {
    const name = valueOf('--set-password-env');
    password = name ? process.env[name] : undefined;
    if (!password || password.length < 8) { console.log(`The environment variable ${name || '(name missing)'} is not set to a password of at least 8 characters.`); process.exit(2); }
  }
  const db = await openDb(flag('--emulator'));
  try {
    console.log(`MODE ${apply ? 'APPLY' : 'PREVIEW (read-only)'} | target ${db.target}`);
    const r = await inspect(db, phone);
    describe(r, console.log);
    if (r.kind === 'usage') { process.exitCode = 2; return; }
    if (['no-driver', 'many-drivers', 'conflict', 'no-login'].includes(r.kind)) { process.exitCode = 3; return; }
    if (!apply) {
      if (password) console.log('  (the password would also be set from the environment variable you named)');
      console.log('\nPreview only. Run again with --apply to make this change.');
      return;
    }
    const changed = await applyPlan(db, r, { password }, console.log);
    if (changed) {
      const after = await inspect(db, phone);
      console.log('\nDONE and re-read:');
      describe(after, console.log);
      console.log(`\nSign in to the Driver app with 0${r.p10} and ${password ? 'the password you set through the environment variable' : 'the same password as before'}.`);
    }
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('ERROR:', String(e.message).split('\n')[0]); process.exit(1); });
}

module.exports = { last10, loginEmails, inspect, describe, applyPlan };
