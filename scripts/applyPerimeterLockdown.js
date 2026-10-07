// scripts/applyPerimeterLockdown.js
// Applies the PERIMETER LOCKDOWN migrations (20261008000001 .. 20261008000005) to the hosted Supabase database, one stage at a time.
// Prints no credentials and no personal data (only counts and object names). Uses DATABASE_URL from server/.env.
//
//   STAGES   S0  20261008000001  close the sign-up privilege escalation        HOT-FIX: safe to apply on its own, FIRST
//            S1  20261008000002  expand: new RPCs, policy helpers, guards       additive: old and new apps keep working
//            ---- deploy the new server and the four apps here, check them (docs/policy-decisions.md section 8) ----
//            S2  20261008000003  function privileges (anon / PUBLIC lose EXECUTE)
//            S3  20261008000004  row-level security + table privileges
//            S4  20261008000005  storage: private buckets, owner-folder policies
//
//   node scripts/applyPerimeterLockdown.js preflight          READ-ONLY. Shows the live state (exposures, drift between the live database
//                                                             and the repo, migration history) and writes a snapshot + an emergency
//                                                             rollback script for S2-S4 to a temp folder. Changes nothing.
//   node scripts/applyPerimeterLockdown.js dryrun <S0..S4|all>  Runs the stage(s) INSIDE a transaction (earlier stages that are not
//                                                             applied yet are included), runs the verification, then ROLLS BACK.
//                                                             Nothing is kept. Safe to run any number of times.
//   node scripts/applyPerimeterLockdown.js apply S0           Applies ONE stage in ONE transaction: the migration (with its own
//                                                             self-check), the verification, the history row; any failure rolls the
//                                                             whole stage back. Then NOTIFY pgrst, then a re-check on a new connection.
//   node scripts/applyPerimeterLockdown.js apply S1           (stages must go in order)
//   node scripts/applyPerimeterLockdown.js apply S2 --apps-deployed     S2, S3, S4 switch off doors the OLD apps use. They refuse to run
//   node scripts/applyPerimeterLockdown.js apply S3 --apps-deployed     unless you say the new server + apps are deployed.
//   node scripts/applyPerimeterLockdown.js apply S4 --apps-deployed
//
//   Options  --accept-drift   apply even though a function that a stage replaces differs from the repo (somebody changed it by hand);
//                             read the drift report first
//   node scripts/applyPerimeterLockdown.js selftest           (local only) applies every stage to the rehearsal database, then the emergency
//                                                             rollback script, and checks the perimeter is back exactly as it was.
//                                                             Run by scripts/db-tests (security/perimeter-apply-script.js).
//            --emulator       REHEARSAL on a local PGlite database built from the repo (no network, no DATABASE_URL). Used to test this
//                             script; it proves nothing about the hosted database.
//
// Nothing here ever reads or prints personal data: the probes use account ids internally and report pass / fail.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const REPO = path.join(__dirname, '..').replace(/\\/g, '/');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const positional = argv.filter((a) => !a.startsWith('--'));
const MODE = positional[0];
const TARGET = (positional[1] || '').toUpperCase();
const EMULATOR = MODE === 'selftest' || flag('--emulator') || process.env.PERIMETER_EMULATOR === '1';
const ACCEPT_DRIFT = flag('--accept-drift');
const APPS_DEPLOYED = flag('--apps-deployed');

const STAGES = [
  { id: 'S0', version: '20261008000001', name: 'perimeter_signup_triggers', title: 'close the sign-up privilege escalation (hot-fix)' },
  { id: 'S1', version: '20261008000002', name: 'perimeter_expand', title: 'new RPCs, policy helpers and guards (additive)' },
  { id: 'S2', version: '20261008000003', name: 'perimeter_function_grants', title: 'function privileges', contract: true },
  { id: 'S3', version: '20261008000004', name: 'perimeter_rls', title: 'row-level security and table privileges', contract: true },
  { id: 'S4', version: '20261008000005', name: 'perimeter_storage', title: 'storage: private buckets and owner-folder policies', contract: true },
].map((s, i) => ({ ...s, index: i, file: `${s.version}_${s.name}.sql` }));
const PRE_STATE_FILE = '20261007000004_security_null_safe_service_context.sql';   // the last migration before the lockdown
const PRE_STATE_VERSION = PRE_STATE_FILE.split('_')[0];

// "all" is a rehearsal word: a dry run of every stage, or (rehearsal database only) applying every stage in one process.
// On the hosted database the stages are always applied one at a time, on purpose.
const allowedAll = TARGET === 'ALL' && (MODE === 'dryrun' || (MODE === 'apply' && EMULATOR));
if (!['preflight', 'dryrun', 'apply', 'selftest'].includes(MODE) || (!['preflight', 'selftest'].includes(MODE) && !allowedAll && !STAGES.some((s) => s.id === TARGET))) {
  console.log('usage: node scripts/applyPerimeterLockdown.js preflight | dryrun <S0|S1|S2|S3|S4|all> | apply <S0|S1|S2|S3|S4> [--apps-deployed] [--accept-drift] [--emulator] | selftest');
  process.exit(2);
}
const sqlOf = (s) => fs.readFileSync(`${REPO}/supabase/migrations/${s.file}`, 'utf8');

const norm = (s) => String(s || '').replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').trim();
const bodyOf = (def) => (String(def || '').match(/AS \$[A-Za-z_]*\$([\s\S]*)\$[A-Za-z_]*\$/) || [])[1] || '';
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const randomUuid = () => require('crypto').randomUUID();
// A phone number nobody has (the probes' records are rolled back, but a unique index would still see a clash while they exist).
const randomPhone = () => '+63917' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0');

// ---- database access: the hosted database (pg) or the local rehearsal database (PGlite) ----------------------------------------
async function openDb() {
  if (EMULATOR) {
    const { setup } = require(`${REPO}/scripts/db-tests/b4fixtures`);
    const t = await setup(PRE_STATE_FILE);
    const db = t.db;
    await db.exec(`CREATE SCHEMA IF NOT EXISTS supabase_migrations;
                   CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text)`);
    for (const f of fs.readdirSync(`${REPO}/supabase/migrations`).filter((x) => x.endsWith('.sql')).sort()) {
      if (f > PRE_STATE_FILE) break;
      await db.query(`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [f.split('_')[0], f.replace(/^\d+_/, '').replace(/\.sql$/, '')]);
    }
    const { ID } = require(`${REPO}/scripts/db-tests/fixtures`);
    await db.exec(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES
      ('driver-licenses', '${ID.D_AUTH}/license_front.jpg', '${ID.D_AUTH}'),
      ('mtop-permits', '${ID.D_AUTH}/mtop.jpg', '${ID.D_AUTH}'),
      ('driver-licenses', '${ID.D2_AUTH}/license_front.jpg', '${ID.D2_AUTH}')`);
    return {
      kind: 'emulator',
      target: 'local PGlite rehearsal database',
      query: async (sql, params) => { const r = await db.query(sql, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; },
      exec: async (sql) => { await db.exec(sql); },
      close: async () => {},
    };
  }
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
    exec: async (sql) => { await c.query(sql); },
    close: async () => { await c.end(); },
  };
}

function helpers(db) {
  let n = 0;
  const q = async (s, p) => (await db.query(s, p)).rows;
  const one = async (s, p) => (await q(s, p))[0];
  const results = { ok: 0, skipped: 0 };
  const must = (cond, msg) => { if (!cond) throw new Error('verification failed: ' + msg); results.ok++; console.log('  ok  ' + msg); };
  const skip = (msg) => { results.skipped++; console.log('  --  skipped (no suitable account / object on this database): ' + msg); };
  // Runs fn in a savepoint that is ALWAYS rolled back; returns { ok, value } or { ok:false, error }.
  const tryIt = async (fn) => {
    const sp = 'pl' + (++n);
    await db.exec('SAVEPOINT ' + sp);
    let out;
    try { out = { ok: true, value: await fn() }; } catch (e) { out = { ok: false, error: String(e.message).split('\n')[0] }; }
    await db.exec('ROLLBACK TO SAVEPOINT ' + sp);
    await db.exec('RELEASE SAVEPOINT ' + sp);
    return out;
  };
  // Runs fn as `role` (anon / authenticated / service_role) with the claims of `sub`; rolled back afterwards.
  const asRole = (role, sub, fn) => tryIt(async () => {
    await db.exec(`SET LOCAL ROLE ${role}`);
    await db.query(`select set_config('request.jwt.claim.role', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claims', $3, true)`,
      [role, sub || '', JSON.stringify({ role, sub: sub || null })]);
    return fn();
  });
  const countAs = async (role, sub, sql, params) => {
    const r = await asRole(role, sub, async () => Number((await one(sql, params)).n));
    return r.ok ? { n: r.value } : { error: r.error };
  };
  const refused = async (label, re, role, sub, sql, params) => {
    const r = await asRole(role, sub, () => q(sql, params));
    must(!r.ok && re.test(r.error), `${label} -> refused (${r.ok ? 'NOT REFUSED' : r.error.slice(0, 70)})`);
  };
  return { db, q, one, must, skip, tryIt, asRole, countAs, refused, results };
}

// ---- accounts used by the probes (ids never printed) --------------------------------------------------------------------------
async function pickActors(db) {
  const q = async (s) => (await db.query(s)).rows[0] || null;
  return {
    passenger: await q(`select passenger_id, auth_user_id from public.passenger where auth_user_id is not null order by created_at limit 1`),
    driver: await q(`select driver_id, auth_user_id, toda_id from public.driver where auth_user_id is not null order by (toda_id is not null) desc, created_at limit 1`),
    lgu: await q(`select auth_user_id from public.lgu_admin where account_status = 'Active' and auth_user_id is not null order by created_at limit 1`),
    toda: await q(`select auth_user_id, toda_id from public.toda_admin where account_status = 'Active' and auth_user_id is not null order by created_at limit 1`),
    driverWithFiles: await q(`select d.auth_user_id from public.driver d where d.auth_user_id is not null
                              and exists (select 1 from storage.objects o where (storage.foldername(o.name))[1] = d.auth_user_id::text) limit 1`).catch(() => null),
  };
}

async function insertAuthUser(h, id, meta = {}) {
  await h.db.query(
    `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, $3::jsonb, '{"provider":"email","providers":["email"]}'::jsonb, now(), now())`,
    [id, `perimeter-probe-${id}@example.invalid`, JSON.stringify(meta)]);
}

// ---- what is exposed today (counts and names only) ----------------------------------------------------------------------------
async function exposure(db) {
  const q = async (s, p) => (await db.query(s, p)).rows;
  const anonPolicies = await q(`select schemaname, tablename, policyname from pg_policies where schemaname in ('public','storage') and (roles && array['anon','public']::name[]) order by 1,2,3`);
  const openAuthPolicies = await q(`select schemaname, tablename, policyname from pg_policies where schemaname = 'public' and 'authenticated' = any(roles) and cmd in ('SELECT','ALL') and (qual is null or lower(replace(qual,' ','')) in ('true','(true)')) order by 1,2,3`);
  const anonTables = await q(`select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v') and has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') order by 1`);
  const anonFns = await q(`select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p') and has_function_privilege('anon', p.oid, 'EXECUTE')
                           and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') order by 1`);
  const publicBuckets = await q(`select id from storage.buckets where public order by 1`);
  const storageAnon = await q(`select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and (roles && array['anon','public']::name[])`);
  const authTriggers = await q(`select t.tgname, p.proname from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal order by 1`).catch(() => []);
  const urlRows = await q(`select count(*)::int as n from public.toda where barangay_clearance_url ~* '^https?://' or accredited_drivers_url ~* '^https?://' or bylaws_url ~* '^https?://'`).catch(() => [{ n: null }]);
  return { anonPolicies, openAuthPolicies, anonTables, anonFns, publicBuckets, storageAnon, authTriggers, urlRows: urlRows[0].n };
}

function printExposure(e) {
  const list = (a, f = (x) => x, max = 12) => a.slice(0, max).map(f).join(', ') + (a.length > max ? `, ... (+${a.length - max})` : '');
  console.log(`  policies on public / storage that name anon or public .... ${e.anonPolicies.length}  ${list(e.anonPolicies, (p) => `${p.tablename}.${p.policyname}`, 6)}`);
  console.log(`  USING(true) policies for signed-in users on public ........ ${e.openAuthPolicies.length}  ${list(e.openAuthPolicies, (p) => `${p.tablename}.${p.policyname}`, 6)}`);
  console.log(`  public tables where anon has table privileges ............. ${e.anonTables.length}  ${list(e.anonTables.map((t) => t.relname))}`);
  console.log(`  public functions executable by anon ....................... ${e.anonFns.length}  ${list(e.anonFns.map((f) => f.proname), (x) => x, 8)}`);
  console.log(`  storage buckets that are public ........................... ${e.publicBuckets.length}  ${list(e.publicBuckets.map((b) => b.id))}`);
  console.log(`  sign-up triggers on auth.users ............................ ${e.authTriggers.length}  ${list(e.authTriggers, (t) => `${t.tgname}->${t.proname}`)}`);
  console.log(`  toda document columns holding a full http(s) URL .......... ${e.urlRows}`);
}

// ---- logins the NEW apps cannot find --------------------------------------------------------------------------------------------
// The new Driver and Passenger apps sign in with an e-mail DERIVED from the number that was typed (nothing is looked up before sign-in),
// so a driver or passenger whose Supabase Auth e-mail is anything else (made by hand, an old alias) cannot sign in until that login is given
// the standard address. Counts and shortened ids only: no e-mail address, number or name is printed.
async function legacyLogins(db) {
  const q = async (s, p) => (await db.query(s, p)).rows;
  const drivers = await q(`select d.driver_id, d.account_status, (u.id is null or u.deleted_at is not null) as no_login
      from public.driver d
      left join auth.users u on u.id = d.auth_user_id
      cross join lateral (select right(regexp_replace(coalesce(d.contact_number, ''), '\\D', '', 'g'), 10) as p) x
     where not (u.id is not null and u.deleted_at is null and lower(u.email) = any (array[
            'driver_63' || x.p || '@sakay.ph', 'driver_0' || x.p || '@sakay.ph', 'driver_' || x.p || '@sakay.ph',
            'driver_0' || x.p || '@driver.sakay.internal', 'driver_63' || x.p || '@driver.sakay.internal']))
     order by d.created_at`);
  const passengers = await q(`select p.passenger_id, p.account_status, (u.id is null or u.deleted_at is not null) as no_login
      from public.passenger p
      left join auth.users u on u.id = p.auth_user_id
      cross join lateral (select right(regexp_replace(coalesce(p.contact_number, ''), '\\D', '', 'g'), 10) as p10) x
     where not (u.id is not null and u.deleted_at is null and lower(u.email) = 'passenger_63' || x.p10 || '@sakay.ph')
     order by p.created_at`);
  const total = async (t) => Number((await q(`select count(*) as n from public.${t}`))[0].n);
  return { drivers, passengers, driverTotal: await total('driver'), passengerTotal: await total('passenger') };
}

function printLegacyLogins(l) {
  const short = (id) => `${String(id).slice(0, 8)}…`;
  const list = (rows, key, label) => rows.slice(0, 10).map((r) => `${label} ${short(r[key])} (${r.account_status}${r.no_login ? ', no usable login' : ''})`).join('; ') + (rows.length > 10 ? `; ... (+${rows.length - 10})` : '');
  console.log(`  drivers the new Driver app cannot find by phone ........... ${l.drivers.length} of ${l.driverTotal}${l.drivers.length ? '  ' + list(l.drivers, 'driver_id', 'driver') : ''}`);
  console.log(`  passengers the new Passenger app cannot find by phone ..... ${l.passengers.length} of ${l.passengerTotal}${l.passengers.length ? '  ' + list(l.passengers, 'passenger_id', 'passenger') : ''}`);
  if (l.drivers.length) console.log('    A DRIVER you still need (for example the test driver) can be repaired, without touching anything else:\n      node scripts/relinkDriverLogin.js <mobile number>          (preview)      then add --apply');
  if (l.passengers.length) console.log('    A PASSENGER that is still needed has to register again (or be given the address passenger_63<10 digits>@sakay.ph in the Supabase dashboard).');
  if (l.drivers.length || l.passengers.length) console.log('    These accounts keep working in the OLD apps until you deploy the new ones, so repair or re-create them before you do.');
}

// ---- drift: does the live database still hold what the repo says it holds just before the lockdown? --------------------------
function functionNamesOf(sqlText) {
  const names = new Set();
  const re = /(?:CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION|DROP\s+FUNCTION\s+IF\s+EXISTS)\s+public\.([a-zA-Z0-9_]+)\s*\(/gi;
  let m;
  while ((m = re.exec(sqlText))) names.add(m[1]);
  return [...names].sort();
}

async function driftReport(live, recorded = new Set()) {
  if (EMULATOR) return { skipped: true, differ: [], missing: [], liveOnlyPolicies: [] };
  // The expected state is the repo as it stood just before the lockdown PLUS every stage that is already recorded as applied, and only the
  // functions that the stages still to apply replace are compared. (A stage that is already applied has, of course, changed its own
  // functions: without this, applying S0 would make every later "apply" refuse, as if somebody had edited those functions by hand.)
  const applied = STAGES.filter((s) => recorded.has(s.version));
  const pending = STAGES.filter((s) => !recorded.has(s.version));
  const expectedUntil = applied.length ? applied[applied.length - 1].file : PRE_STATE_FILE;
  console.log(`  building the expected state from the repo (${applied.length ? 'with ' + applied.map((s) => s.id).join(' + ') + ' applied' : 'before the lockdown'}; local emulator, no network) ...`);
  const { freshDb } = require(`${REPO}/scripts/db-tests/tlib`);
  const exp = await freshDb(expectedUntil);
  const names = [...new Set(pending.flatMap((s) => functionNamesOf(sqlOf(s))))];
  const sel = `select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1 and p.prokind in ('f','p')`;
  const differ = [];
  const missing = [];
  for (const name of names) {
    const want = (await exp.query(sel, [name])).rows;
    const have = (await live.query(sel, [name])).rows;
    for (const w of want) {
      const h = have.find((x) => x.sig === w.sig);
      if (!h) missing.push(w.sig);
      else if (norm(bodyOf(h.def)) !== norm(bodyOf(w.def))) differ.push(w.sig);
    }
  }
  const expPolicies = new Set((await exp.query(`select schemaname || '.' || tablename || '.' || policyname as k from pg_policies where schemaname in ('public','storage')`)).rows.map((r) => r.k));
  const liveOnlyPolicies = (await live.query(`select schemaname || '.' || tablename || '.' || policyname as k from pg_policies where schemaname in ('public','storage') order by 1`)).rows
    .map((r) => r.k).filter((k) => !expPolicies.has(k) && !k.includes('.perimeter_'));
  await exp.close();
  return { skipped: false, differ, missing, liveOnlyPolicies };
}

function printDrift(d) {
  if (d.skipped) { console.log('  (rehearsal database: drift check not applicable)'); return; }
  console.log(`  functions the lockdown replaces whose live body DIFFERS from the repo: ${d.differ.length}${d.differ.length ? '  <- somebody changed these by hand: ' + d.differ.join(', ') : ''}`);
  console.log(`  functions the repo expects before the lockdown that are MISSING live:   ${d.missing.length}${d.missing.length ? '  ' + d.missing.join(', ') : ''}`);
  console.log(`  policies on the live database that the repo does not know (hand-made):  ${d.liveOnlyPolicies.length}${d.liveOnlyPolicies.length ? '  ' + d.liveOnlyPolicies.slice(0, 15).join(', ') : ''}`);
  if (d.liveOnlyPolicies.length) console.log('    (S3 / S4 drop every hand-made policy that names anon or public; others stay and are listed by S3\'s self-check if they are open)');
}

// ---- snapshot of the live perimeter, and the emergency rollback script ---------------------------------------------------------
async function takeSnapshot(db) {
  const q = async (s, p) => (await db.query(s, p)).rows;
  const snap = {
    takenAt: new Date().toISOString(),
    policies: await q(`select schemaname, tablename, policyname, permissive, roles::text[] as roles, cmd, qual, with_check from pg_policies where schemaname in ('public','storage') order by 1,2,3`),
    tableGrants: await q(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated','PUBLIC') order by 1,2,3`),
    functionGrants: await q(`select p.oid::regprocedure::text as sig, case a.grantee when 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee
                             from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                             where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p') and a.privilege_type = 'EXECUTE'
                               and (a.grantee = 0 or a.grantee::regrole::text in ('anon','authenticated'))
                               and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') order by 1,2`),
    buckets: await q(`select id, public from storage.buckets order by 1`),
    authTriggers: await q(`select t.tgname, p.proname from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal order by 1`).catch(() => []),
    counts: {},
  };
  for (const t of ['passenger', 'driver', 'toda', 'toda_admin', 'lgu_admin', 'booking', 'driver_verification']) {
    snap.counts[t] = (await q(`select count(*)::int as n from public.${t}`).catch(() => [{ n: null }]))[0].n;
  }
  snap.counts.storageObjects = (await q(`select count(*)::int as n from storage.objects`).catch(() => [{ n: null }]))[0].n;
  return snap;
}

// Re-creates the perimeter AS IT WAS in the snapshot (policies, table privileges, function EXECUTE grants, bucket flags). It re-opens every
// door the lockdown closed: for an emergency only (to restore service), followed by a fix-forward. S0 and S1 are never rolled back.
function buildRollbackSql(snap) {
  const created = new Set();
  for (const s of STAGES.filter((x) => ['S3', 'S4'].includes(x.id))) {
    const re = /CREATE\s+POLICY\s+("?[A-Za-z0-9_]+"?)\s+ON\s+([a-z_]+\.[a-z_]+)/gi;
    let m;
    const text = sqlOf(s);
    while ((m = re.exec(text))) created.add(`${m[2]}|${m[1].replace(/"/g, '')}`);
  }
  const out = [];
  out.push(`-- EMERGENCY ROLLBACK of stages S2, S3 and S4 (functions, row security / table privileges, storage).`);
  out.push(`-- Generated ${snap.takenAt} from the live perimeter as it was BEFORE the lockdown. It re-opens every door the lockdown closed.`);
  out.push(`-- Use it only to restore service, then fix forward. S0 (sign-up hot-fix) and S1 (additive) are never rolled back.`);
  out.push(`-- Run it in the Supabase SQL editor or with psql. It runs in one transaction.`);
  out.push('BEGIN;');
  out.push('');
  out.push('-- storage buckets');
  for (const b of snap.buckets) out.push(`UPDATE storage.buckets SET public = ${b.public ? 'TRUE' : 'FALSE'} WHERE id = ${lit(b.id)};`);
  out.push('');
  out.push('-- policies created by the lockdown go; the policies that existed before come back');
  for (const k of [...created].sort()) { const [tbl, name] = k.split('|'); out.push(`DROP POLICY IF EXISTS "${name}" ON ${tbl};`); }
  for (const p of snap.policies) {
    const roles = (p.roles || []).filter((r) => r !== 'public');
    const to = (p.roles || []).includes('public') && !roles.length ? 'PUBLIC' : roles.join(', ');
    out.push(`DROP POLICY IF EXISTS "${p.policyname}" ON ${p.schemaname}.${p.tablename};`);
    out.push(`CREATE POLICY "${p.policyname}" ON ${p.schemaname}.${p.tablename} AS ${p.permissive === 'RESTRICTIVE' ? 'RESTRICTIVE' : 'PERMISSIVE'} FOR ${p.cmd} TO ${to}`
      + `${p.qual ? ` USING (${p.qual})` : ''}${p.with_check ? ` WITH CHECK (${p.with_check})` : ''};`);
  }
  out.push('');
  out.push('-- table privileges');
  for (const g of snap.tableGrants) out.push(`GRANT ${g.privilege_type} ON public.${g.table_name} TO ${g.grantee === 'PUBLIC' ? 'PUBLIC' : g.grantee};`);
  out.push('');
  out.push('-- function EXECUTE grants (a function that no longer exists, for example one S0 dropped, is skipped)');
  out.push('DO $rollback$');
  out.push('DECLARE r RECORD;');
  out.push('BEGIN');
  out.push('  FOR r IN SELECT * FROM (VALUES');
  out.push(snap.functionGrants.map((g) => `    (${lit(g.sig)}, ${lit(g.grantee)})`).join(',\n') || "    ('', '')");
  out.push('  ) AS t(sig, grantee)');
  out.push('  LOOP');
  out.push("    IF r.sig <> '' AND to_regprocedure(r.sig) IS NOT NULL THEN");
  out.push("      EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO %s', r.sig, CASE WHEN r.grantee = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(r.grantee) END);");
  out.push('    END IF;');
  out.push('  END LOOP;');
  out.push('END $rollback$;');
  out.push('');
  out.push('COMMIT;');
  out.push("NOTIFY pgrst, 'reload schema';");
  return out.join('\n') + '\n';
}

function writeSnapshot(snap) {
  const dir = path.join(os.tmpdir(), `sakay-perimeter-${snap.takenAt.replace(/[:.]/g, '-')}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify(snap, null, 2));
  fs.writeFileSync(path.join(dir, 'rollback_S2_S3_S4.sql'), buildRollbackSql(snap));
  return dir;
}

// ---- verification, stage by stage (runs inside the stage transaction; everything it creates is rolled back) --------------------
async function verifyS0(h) {
  const { q, one, must, tryIt } = h;
  // the attack: an account whose sign-up data says it is an administrator
  const lguId = randomUuid(), todaId = randomUuid(), drvId = randomUuid(), paxId = randomUuid();
  const someToda = await one(`select toda_id from public.toda limit 1`);
  const seen = await tryIt(async () => {
    await insertAuthUser(h, lguId, { role: 'lgu_admin', full_name: 'probe' });
    await insertAuthUser(h, todaId, { role: 'toda_admin', full_name: 'probe', toda_id: someToda ? someToda.toda_id : randomUuid(), toda_acronym: 'PROBE' });
    await insertAuthUser(h, drvId, { role: 'driver', full_name: 'Probe Driver', contact_number: randomPhone() });
    await insertAuthUser(h, paxId, { role: 'passenger', full_name: 'Probe Passenger', contact_number: randomPhone() });
    return {
      lgu: Number((await one(`select count(*) as n from public.lgu_admin where auth_user_id = $1`, [lguId])).n),
      lguAsToda: Number((await one(`select count(*) as n from public.toda_admin where auth_user_id = $1`, [lguId])).n),
      toda: Number((await one(`select count(*) as n from public.toda_admin where auth_user_id = $1`, [todaId])).n),
      todaAsLgu: Number((await one(`select count(*) as n from public.lgu_admin where auth_user_id = $1`, [todaId])).n),
      drv: await one(`select account_status, availability_status from public.driver where auth_user_id = $1`, [drvId]),
      pax: await one(`select account_status from public.passenger where auth_user_id = $1`, [paxId]),
    };
  });
  must(seen.ok, `the sign-up probes ran (${seen.ok ? 'ok' : seen.error})`);
  must(seen.value.lgu === 0 && seen.value.lguAsToda === 0, 'a sign-up that claims role "lgu_admin" creates NO administrator record');
  must(seen.value.toda === 0 && seen.value.todaAsLgu === 0, 'a sign-up that claims role "toda_admin" (with a toda_id) creates NO administrator record');
  must(seen.value.drv && seen.value.drv.account_status === 'Pending Verification' && seen.value.drv.availability_status === 'Offline', 'a driver sign-up still creates a PENDING, offline driver record');
  must(seen.value.pax && seen.value.pax.account_status === 'Pending OTP Verification', 'a passenger sign-up still creates a pending passenger record');
  const gone = await one(`select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'handle_new_toda_admin_user')::int as fns,
                                 (select count(*) from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'trg_on_auth_user_created_toda_admin')::int as trg`);
  must(gone.fns === 0 && gone.trg === 0, 'the TODA-administrator sign-up trigger and its function are gone');
  const priv = await one(`select has_function_privilege('anon', 'public.handle_new_user_signup()', 'EXECUTE') as a, has_function_privilege('authenticated', 'public.handle_new_user_signup()', 'EXECUTE') as b,
                                 has_function_privilege('anon', 'public.handle_user_auth_update()', 'EXECUTE') as c, has_function_privilege('authenticated', 'public.handle_user_auth_update()', 'EXECUTE') as d`);
  must(!priv.a && !priv.b && !priv.c && !priv.d, 'the two sign-up trigger functions are not callable by clients');
  void q;
}

async function verifyS1(h, a) {
  const { one, must, asRole, refused, q, skip, db } = h;
  const priv = await one(`select
      has_function_privilege('anon', 'public.list_accredited_todas()', 'EXECUTE') as dir_anon,
      coalesce(has_function_privilege('anon', to_regprocedure('public.find_candidate_drivers(uuid, double precision, integer)'), 'EXECUTE'), false) as cand_anon,   -- removed by Batch 6 (20261015000003): absent = not callable
      has_function_privilege('anon', 'public.get_booking_counterparties(uuid[])', 'EXECUTE') as party_anon,
      has_function_privilege('anon', 'public.get_assigned_driver_details(uuid)', 'EXECUTE') as assigned_anon,
      has_function_privilege('anon', 'public.get_my_toda_affiliations()', 'EXECUTE') as mine_anon,
      has_function_privilege('anon', 'public.register_toda_with_admin(varchar, varchar, varchar, date, integer, integer, double precision, double precision, varchar, varchar, text, varchar, varchar, varchar, text, text, uuid)', 'EXECUTE') as reg_anon,
      has_function_privilege('authenticated', 'public.get_my_toda_affiliations()', 'EXECUTE') as mine_auth,
      has_function_privilege('authenticated', 'public.is_trusted_session()', 'EXECUTE') as trusted_auth`);
  must(priv.dir_anon === true, 'list_accredited_todas() is callable by anon (the registration picker)');
  must(!priv.cand_anon && !priv.party_anon && !priv.assigned_anon && !priv.mine_anon && !priv.reg_anon, 'the other new / rewritten RPCs are NOT callable by anon');
  must(priv.mine_auth === true && priv.trusted_auth === false, 'signed-in users can call the new RPCs; the trusted-session helper is not callable by clients');

  const dir = await asRole('anon', null, () => q(`select * from public.list_accredited_todas()`));
  must(dir.ok, `anon can read the directory of accredited TODAs (${dir.ok ? dir.value.length + ' row(s)' : dir.error})`);
  if (dir.ok && dir.value.length) {
    must(JSON.stringify(Object.keys(dir.value[0]).sort()) === JSON.stringify(['barangay', 'service_coverage_area', 'terminal_latitude', 'terminal_longitude', 'toda_acronym', 'toda_id', 'toda_name']),
      'the directory returns only directory columns (no documents, certificate data, officers or contacts)');
  }

  // a stranger (signed-in, no role anywhere)
  const stranger = randomUuid();
  const out = await h.tryIt(async () => {
    await insertAuthUser(h, stranger, {});
    const r = {};
    const cand = await asRole('authenticated', stranger, () => q(`select * from public.find_candidate_drivers($1::uuid)`, [randomUuid()]));
    r.cand = cand;
    r.party = await asRole('authenticated', stranger, () => q(`select * from public.get_booking_counterparties(array[$1::uuid])`, [randomUuid()]));
    r.mine = await asRole('authenticated', stranger, () => q(`select * from public.get_my_toda_affiliations()`));
    // guards: a registrant can only create a Pending record
    r.paxActive = await asRole('authenticated', stranger, () => q(`insert into public.passenger (auth_user_id, full_name, contact_number, account_status)
        values ($1, 'Probe', $2, 'Active') returning account_status`, [stranger, randomPhone()]));
    r.paxPending = await asRole('authenticated', stranger, async () => (await q(`insert into public.passenger (auth_user_id, full_name, contact_number, account_status, strikes_count, failed_otp_attempts)
        values ($1, 'Probe', $2, 'Pending OTP Verification', 4, 9) returning strikes_count, failed_otp_attempts`, [stranger, randomPhone()]))[0]);
    r.drvVerified = await asRole('authenticated', stranger, () => q(`insert into public.driver (auth_user_id, full_name, contact_number, account_status) values ($1, 'Probe', $2, 'Verified') returning account_status`, [stranger, randomPhone()]));
    // the TODA registration function: identity is the caller, never a parameter
    const tag = randomUuid().slice(0, 8).toUpperCase();
    r.regOther = await asRole('authenticated', stranger, () => q(`select public.register_toda_with_admin('Probe TODA','P1' || $2,'PRB-1-' || $2,'2020-01-01',1,1,13.41,121.18,'T','B','C','P','probe@example.invalid','+639170000905',null,null,$1::uuid)`, [randomUuid(), tag]));
    r.regSelf = await asRole('authenticated', stranger, async () => {
      const id = (await one(`select public.register_toda_with_admin('Probe TODA','P2' || $2,'PRB-2-' || $2,'2020-01-01',1,1,13.41,121.18,'T','B','C','P','probe@example.invalid','+639170000905',null,null,$1::uuid) as id`, [stranger, tag])).id;
      return { id, admin: (await one(`select count(*)::int as n from public.toda_admin where auth_user_id = $1 and toda_id = $2`, [stranger, id])).n };
    });
    return r;
  });
  must(out.ok, `the stranger probes ran (${out.ok ? 'ok' : out.error})`);
  const r = out.value;
  must(r.cand.ok === false && /ERR_NOT_A_PASSENGER|does not exist/.test(r.cand.error || ''), 'find_candidate_drivers() refuses a caller who is not a passenger (or no longer exists: Batch 6 removed it)');
  must(r.party.ok && r.party.value.length === 0, 'get_booking_counterparties() tells a stranger nothing');
  must(r.mine.ok && r.mine.value.length === 0, 'get_my_toda_affiliations() returns nothing to someone who is not a driver');
  must(r.paxActive.ok === false && /ERR_PASSENGER_PENDING_ONLY|row-level security|policy/.test(r.paxActive.error || ''), 'a new passenger record cannot be inserted Active (activation is the server\'s job, after the OTP)');
  must(r.paxPending.ok && r.paxPending.value.strikes_count === 0 && r.paxPending.value.failed_otp_attempts === 0, 'a Pending passenger record can be created, and its strike / OTP counters start at zero whatever was sent');
  must(r.drvVerified.ok === false && /ERR_DRIVER_PENDING_ONLY|row-level security|policy/.test(r.drvVerified.error || ''), 'a new driver record cannot be inserted Verified');
  must(r.regOther.ok === false && /ERR_IDENTITY_MISMATCH/.test(r.regOther.error || ''), 'register_toda_with_admin() refuses to make somebody else the administrator');
  must(r.regSelf.ok && r.regSelf.value.admin === 1, 'register_toda_with_admin() makes the CALLER the administrator of the new TODA (rolled back)');
  await refused('anon cannot register a TODA', /permission denied/, 'anon', null,
    `select public.register_toda_with_admin('A','B','C','2020-01-01',1,1,1,1,'t','b','s','p','e@x.y','+639',null,null,null)`);

  if (a.driver) {
    const mine = await asRole('authenticated', a.driver.auth_user_id, () => q(`select * from public.get_my_toda_affiliations()`));
    must(mine.ok, `a real driver can call get_my_toda_affiliations() (${mine.ok ? mine.value.length + ' affiliation(s)' : mine.error})`);
  } else skip('get_my_toda_affiliations() as a real driver');
  void db;
}

async function verifyS2(h) {
  const { one, must, q } = h;
  const bad = await q(`select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p')
                         and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
                         and (has_function_privilege('anon', p.oid, 'EXECUTE') or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
                         and p.proname <> 'list_accredited_todas'`);
  must(bad.length === 0, `no public function is executable by anon or PUBLIC except list_accredited_todas (${bad.length} found${bad.length ? ': ' + bad.slice(0, 6).map((x) => x.proname).join(', ') : ''})`);
  const dir = await one(`select has_function_privilege('anon', 'public.list_accredited_todas()', 'EXECUTE') as a`);
  must(dir.a === true, 'list_accredited_todas() is still callable by anon');
  const only = await q(`select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('activate_passenger_otp','check_otp_lockout','increment_failed_otp','reset_failed_otp','check_toda_excess_incidents')
                          and has_function_privilege('authenticated', p.oid, 'EXECUTE')`);
  must(only.length === 0, 'the five server-only functions are NOT callable by signed-in users');
  const svc = await one(`select bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE')) as ok from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p')
                           and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`);
  must(svc.ok === true, 'the service role can execute every function (the Express server keeps working)');
  // what the apps call must still be callable by signed-in users (only when the function exists on this database)
  const needed = ['driver_go_online', 'driver_go_offline', 'driver_heartbeat', 'get_my_driver_presence', 'select_active_driver_affiliation', 'quote_fare', 'get_assigned_driver_details',
    'get_booking_counterparties', 'find_candidate_drivers', 'get_my_toda_affiliations', 'register_toda_with_admin', 'create_admin_review_flag', 'request_terminal_relocation'];
  const missing = [];
  for (const fn of needed) {
    const r = await q(`select p.oid, has_function_privilege('authenticated', p.oid, 'EXECUTE') as ok from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1`, [fn]);
    if (r.length && !r.every((x) => x.ok)) missing.push(fn);
  }
  must(missing.length === 0, `the functions the apps call are still callable by signed-in users${missing.length ? ' (NOT: ' + missing.join(', ') + ')' : ''}`);
}

async function verifyS3(h, a) {
  const { one, must, skip, countAs, q } = h;
  const tables = await q(`select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and c.relrowsecurity order by 1`);
  const anyAnon = await q(`select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v') and has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`);
  must(anyAnon.length === 0, `anon has no privilege on any table or view in public (${anyAnon.length} found${anyAnon.length ? ': ' + anyAnon.slice(0, 6).map((x) => x.relname).join(', ') : ''})`);
  const anonPol = await one(`select count(*)::int as n from pg_policies where schemaname = 'public' and (roles && array['anon','public']::name[])`);
  must(anonPol.n === 0, 'no policy on a public table names anon / public');
  const trunc = await q(`select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and has_table_privilege('authenticated', c.oid, 'TRUNCATE,REFERENCES,TRIGGER')`);
  must(trunc.length === 0, 'signed-in users have no TRUNCATE / REFERENCES / TRIGGER privilege on any table');
  must(tables.length > 0, `row-level security is switched on for ${tables.length} public tables`);

  // black-box reads
  const probeTables = ['passenger', 'driver', 'booking', 'driver_verification', 'dispatch_attempt', 'toda', 'toda_admin', 'lgu_admin', 'audit_log', 'incident_report', 'driver_toda_affiliation', 'notification', 'rating'];
  const have = new Set(tables.map((t) => t.relname));
  for (const t of probeTables) {
    if (!have.has(t)) continue;
    const r = await countAs('anon', null, `select count(*) as n from public.${t}`);
    must(r.error && /permission denied/.test(r.error), `anon cannot read ${t} (${r.error ? r.error.slice(0, 50) : 'READ ' + r.n + ' rows'})`);
  }
  const stranger = randomUuid();
  const strangerCounts = await h.tryIt(async () => {
    await insertAuthUser(h, stranger, {});
    const out = {};
    for (const t of probeTables) {
      if (!have.has(t)) continue;
      const r = await countAs('authenticated', stranger, `select count(*) as n from public.${t}`);
      out[t] = r.error ? `error: ${r.error}` : r.n;
    }
    return out;
  });
  must(strangerCounts.ok, 'the stranger probes ran');
  const seenByStranger = Object.entries(strangerCounts.value).filter(([, n]) => n !== 0);
  must(seenByStranger.length === 0, `a signed-in account with no role sees no rows in: ${Object.keys(strangerCounts.value).join(', ')}${seenByStranger.length ? '  <- SEES: ' + seenByStranger.map(([t, n]) => `${t}=${n}`).join(', ') : ''}`);

  if (a.passenger) {
    const own = await countAs('authenticated', a.passenger.auth_user_id, `select count(*) as n from public.passenger`);
    must(own.n === 1, `a passenger sees exactly their own passenger record (${own.n ?? own.error})`);
    const others = await countAs('authenticated', a.passenger.auth_user_id, `select count(*) as n from public.booking where passenger_id <> '${a.passenger.passenger_id}'`);
    must(others.n === 0, `a passenger sees no booking of another passenger (${others.n ?? others.error})`);
    const drv = await countAs('authenticated', a.passenger.auth_user_id, `select count(*) as n from public.driver`);
    must(drv.n === 0, `a passenger cannot read the driver table (${drv.n ?? drv.error})`);
  } else skip('passenger probes');
  if (a.driver) {
    const own = await countAs('authenticated', a.driver.auth_user_id, `select count(*) as n from public.driver`);
    must(own.n === 1, `a driver sees exactly their own driver record (${own.n ?? own.error})`);
    const pax = await countAs('authenticated', a.driver.auth_user_id, `select count(*) as n from public.passenger`);
    must(pax.n === 0, `a driver cannot read the passenger table (${pax.n ?? pax.error})`);
    const toda = await countAs('authenticated', a.driver.auth_user_id, `select count(*) as n from public.toda`);
    must(toda.n === 0, `a driver cannot read the toda table (documents, officers) (${toda.n ?? toda.error})`);
    const mine = await h.asRole('authenticated', a.driver.auth_user_id, () => q(`select * from public.get_my_toda_affiliations()`));
    must(mine.ok, 'a driver can still list their TODA affiliations through the RPC');
  } else skip('driver probes');
  if (a.toda) {
    const foreign = await countAs('authenticated', a.toda.auth_user_id, `select count(*) as n from public.driver where toda_id is distinct from '${a.toda.toda_id}'`);
    must(foreign.n === 0, `a TODA administrator sees no driver of another TODA (${foreign.n ?? foreign.error})`);
    const own = await countAs('authenticated', a.toda.auth_user_id, `select count(*) as n from public.toda`);
    must(own.n === 1, `a TODA administrator sees exactly their own TODA record (${own.n ?? own.error})`);
  } else skip('TODA administrator probes');
  if (a.lgu) {
    for (const t of ['passenger', 'driver', 'toda'].filter((x) => have.has(x))) {
      const total = Number((await one(`select count(*) as n from public.${t}`)).n);
      const seen = await countAs('authenticated', a.lgu.auth_user_id, `select count(*) as n from public.${t}`);
      must(seen.n === total, `the LGU administrator still sees every ${t} record (${seen.n ?? seen.error} of ${total})`);
    }
  } else skip('LGU administrator probes');
}

async function verifyS4(h, a) {
  const { one, must, skip, countAs, q } = h;
  const pub = await q(`select id from storage.buckets where public`);
  must(pub.length === 0, `every storage bucket is private (${pub.length} public${pub.length ? ': ' + pub.map((b) => b.id).join(', ') : ''})`);
  const pol = await one(`select count(*)::int as n from pg_policies where schemaname = 'storage' and tablename = 'objects' and (roles && array['anon','public']::name[])`);
  must(pol.n === 0, 'no policy on storage.objects names anon / public');
  const urls = await one(`select count(*)::int as n from public.toda where barangay_clearance_url ~* '^https?://' or accredited_drivers_url ~* '^https?://' or bylaws_url ~* '^https?://'`);
  must(urls.n === 0, 'no TODA document column still holds a full URL (they hold storage paths)');
  const total = Number((await one(`select count(*) as n from storage.objects`)).n);
  const anon = await countAs('anon', null, `select count(*) as n from storage.objects`);
  must(anon.error ? /permission denied/.test(anon.error) : anon.n === 0, `anon sees no stored file (${anon.error ? anon.error.slice(0, 40) : anon.n + ' of ' + total})`);
  const stranger = randomUuid();
  const sc = await h.tryIt(async () => {
    await insertAuthUser(h, stranger, {});
    return countAs('authenticated', stranger, `select count(*) as n from storage.objects`);
  });
  must(sc.ok && sc.value.n === 0, `a signed-in account with no role sees no stored file (${sc.ok ? sc.value.n : sc.error})`);
  if (a.lgu) {
    const seen = await countAs('authenticated', a.lgu.auth_user_id, `select count(*) as n from storage.objects`);
    must(seen.n >= 0 && (total === 0 || seen.n > 0), `the LGU administrator can still see stored files (${seen.n ?? seen.error} of ${total})`);
  } else skip('LGU administrator storage probe');
  if (a.driverWithFiles) {
    const own = await countAs('authenticated', a.driverWithFiles.auth_user_id, `select count(*) as n from storage.objects where (storage.foldername(name))[1] = '${a.driverWithFiles.auth_user_id}'`);
    must(own.n > 0, `a driver can still see their own uploaded documents (${own.n ?? own.error})`);
    const foreign = await countAs('authenticated', a.driverWithFiles.auth_user_id, `select count(*) as n from storage.objects where (storage.foldername(name))[1] is distinct from '${a.driverWithFiles.auth_user_id}'`);
    must(foreign.n === 0, `a driver sees no file in anyone else's folder (${foreign.n ?? foreign.error})`);
  } else skip('driver own-folder probe (no driver has uploaded files)');
}

const VERIFY = { S0: verifyS0, S1: verifyS1, S2: verifyS2, S3: verifyS3, S4: verifyS4 };

// ---- running one or more stages inside the CURRENT transaction -----------------------------------------------------------------
async function runStage(db, stage, actors) {
  console.log(`\n--- ${stage.id}  ${stage.file}  (${stage.title})`);
  await db.exec(sqlOf(stage));
  console.log('  statements executed (including the migration\'s own self-check)');
  const h = helpers(db);
  const sp = 'verify_' + stage.id;
  await db.exec('SAVEPOINT ' + sp);       // everything the probes create is rolled back, also in apply mode
  try { await VERIFY[stage.id](h, actors); } finally { await db.exec('ROLLBACK TO SAVEPOINT ' + sp); await db.exec('RELEASE SAVEPOINT ' + sp); }
  console.log(`  ${stage.id}: ${h.results.ok} checks passed${h.results.skipped ? `, ${h.results.skipped} skipped` : ''}`);
}

async function recordedVersions(db) {
  return new Set((await db.query(`select version from supabase_migrations.schema_migrations`)).rows.map((r) => r.version));
}

// The rehearsal the db-tests suite runs: apply every stage, then the generated rollback, and compare the perimeter with the snapshot.
async function selftest() {
  const db = await openDb();
  console.log('SELFTEST on the local rehearsal database (apply S0..S4, then the emergency rollback script)');
  let failed = 0;
  const check = (cond, msg, extra) => { if (cond) console.log('  PASS  ' + msg); else { failed++; console.log('  FAIL  ' + msg + (extra ? '  -> ' + extra : '')); } };
  const key = {
    policy: (p) => [p.schemaname, p.tablename, p.policyname, p.permissive, p.cmd, [...(p.roles || [])].sort().join(','), norm(p.qual), norm(p.with_check)].join(' | '),
    tableGrant: (g) => [g.table_name, g.grantee, g.privilege_type].join(' | '),
    fnGrant: (g) => [g.sig, g.grantee].join(' | '),
  };
  const before = await takeSnapshot(db);
  for (const s of STAGES) {
    const actors = await pickActors(db);
    await applyStage(db, s, actors);
  }
  const locked = await takeSnapshot(db);
  const open = await exposure(db);
  check(locked.policies.length !== before.policies.length && open.anonPolicies.length === 0 && open.anonTables.length === 0 && open.publicBuckets.length === 0,
    'after S0-S4 the perimeter is closed (no anon policy, no anon table privilege, no public bucket)');

  const rollback = buildRollbackSql(before);
  check(/^BEGIN;/m.test(rollback) && /COMMIT;/.test(rollback) && /UPDATE storage\.buckets/.test(rollback), 'the rollback script is generated');
  await db.exec(rollback);
  const reopened = await takeSnapshot(db);

  const same = (name, a, b, f, only) => {
    const A = new Set(a.filter(only || (() => true)).map(f));
    const B = new Set(b.filter(only || (() => true)).map(f));
    const missing = [...A].filter((k) => !B.has(k));
    const extra = [...B].filter((k) => !A.has(k));
    check(missing.length === 0 && extra.length === 0, `the rollback restores the ${name} exactly (${A.size} entries)`, (missing.length ? 'missing: ' + missing.slice(0, 3).join(' ;; ') : '') + (extra.length ? ' extra: ' + extra.slice(0, 3).join(' ;; ') : ''));
  };
  same('policies', before.policies, reopened.policies, key.policy);
  same('table privileges', before.tableGrants, reopened.tableGrants, key.tableGrant);
  // (a function S0 dropped, for example the TODA-administrator sign-up function, is gone for good and is not restored)
  const existingNow = new Set((await db.query(`select p.oid::regprocedure::text as sig from pg_proc p where p.pronamespace = 'public'::regnamespace`)).rows.map((r) => r.sig));
  const knownFns = new Set(before.functionGrants.map((g) => g.sig).filter((sig) => existingNow.has(sig)));
  same('function EXECUTE grants (of the functions that existed before and still exist)', before.functionGrants, reopened.functionGrants, key.fnGrant, (g) => knownFns.has(g.sig));
  check(JSON.stringify(before.buckets) === JSON.stringify(reopened.buckets), 'the rollback restores the bucket flags');
  const back = await exposure(db);
  check(back.anonPolicies.length > 0 && back.publicBuckets.length > 0, 'after the rollback the doors are open again (this is the emergency script: it re-opens everything)');
  // S0 and S1 are not rolled back: the sign-up hot-fix and the additive objects stay
  const gone = (await db.query(`select count(*)::int as n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'handle_new_toda_admin_user'`)).rows[0].n;
  check(gone === 0 && reopened.authTriggers.every((t) => t.tgname !== 'trg_on_auth_user_created_toda_admin'), 'S0 stays in place after the rollback (the sign-up escalation does not come back)');
  await db.close();
  console.log(failed ? `\nSELFTEST FAILED (${failed})` : '\nSELFTEST PASSED');
  process.exit(failed ? 1 : 0);
}

async function main() {
  if (MODE === 'selftest') return selftest();
  const db = await openDb();
  console.log(`MODE ${MODE.toUpperCase()}${TARGET ? ' ' + TARGET : ''} | target ${db.target}${EMULATOR ? '  (REHEARSAL - proves nothing about the hosted database)' : ''}`);
  const sv = (await db.query('select version() as v')).rows[0].v.split(' ').slice(0, 2).join(' ');
  const recorded = await recordedVersions(db);
  console.log(`server ${sv} | prerequisite ${PRE_STATE_VERSION} recorded: ${recorded.has(PRE_STATE_VERSION)} | stages recorded: ${STAGES.filter((s) => recorded.has(s.version)).map((s) => s.id).join(', ') || 'none'}`);
  if (!recorded.has(PRE_STATE_VERSION)) {
    console.log(`ABORT: migration ${PRE_STATE_VERSION} (the Batch 5 security patch) is not recorded on this database. Apply it first (node scripts/applySecurityPatch.js apply).`);
    await db.close();
    process.exit(1);
  }

  // 1. the picture of today
  console.log('\n=== the live perimeter TODAY');
  const before = await exposure(db);
  printExposure(before);
  console.log('\n=== logins the NEW apps cannot find (they sign in with an address derived from the phone number)');
  printLegacyLogins(await legacyLogins(db));
  console.log('\n=== drift between the live database and the repo');
  const drift = await driftReport(db, recorded);
  printDrift(drift);
  console.log('\n=== snapshot (read-only)');
  const snap = await takeSnapshot(db);
  const dir = writeSnapshot(snap);
  console.log(`  counts: ${JSON.stringify(snap.counts)}`);
  console.log(`  written to ${dir}\n    snapshot.json            the policies, grants, bucket flags and sign-up triggers as they are now\n    rollback_S2_S3_S4.sql    EMERGENCY ONLY: puts the perimeter back as it is now (it re-opens every door)`);

  if (MODE === 'preflight') {
    const pending = STAGES.filter((s) => !recorded.has(s.version));
    console.log(`\nStages still to apply: ${pending.map((s) => s.id).join(', ') || 'none'}.`);
    if (drift.differ.length) console.log('Drift found: apply will refuse unless you pass --accept-drift (read the list above first).');
    console.log('Next: node scripts/applyPerimeterLockdown.js dryrun all   (everything inside a transaction that is rolled back)');
    await db.close();
    return;
  }

  // 2. which stages
  const target = TARGET === 'ALL' ? STAGES[STAGES.length - 1] : STAGES.find((s) => s.id === TARGET);
  let toRun;
  if (MODE === 'apply') {
    if (TARGET === 'ALL') {
      toRun = STAGES.filter((s) => !recorded.has(s.version));      // rehearsal database only (the argument check refuses this on the hosted one)
    } else {
      if (recorded.has(target.version)) { console.log(`\n${target.id} is already recorded in the migration history; nothing to do.`); await db.close(); return; }
      const earlier = STAGES.filter((s) => s.index < target.index && !recorded.has(s.version));
      if (earlier.length) { console.log(`\nABORT: apply the stages in order. Not applied yet: ${earlier.map((s) => s.id).join(', ')}.`); await db.close(); process.exit(1); }
      if (target.contract && !APPS_DEPLOYED) {
        console.log(`\nABORT: ${target.id} switches off doors the OLD apps and the OLD server still use (open policies, public files, anonymous function calls).`);
        console.log('Deploy the new server and the four new apps first and check them (docs/policy-decisions.md section 8), then run this again with --apps-deployed.');
        await db.close();
        process.exit(1);
      }
      toRun = [target];
    }
  } else {
    toRun = STAGES.filter((s) => s.index <= target.index && !recorded.has(s.version));   // dry run: include the stages it depends on
    if (!toRun.length) { console.log('\nEvery stage up to that one is already recorded; nothing to rehearse.'); await db.close(); return; }
  }
  if (drift.differ.length && MODE === 'apply' && !ACCEPT_DRIFT) {
    console.log(`\nABORT: ${drift.differ.length} function(s) that a stage replaces differ from the repo (listed above). Applying would overwrite a change nobody reviewed.`);
    console.log('Inspect them; if the live version is not wanted, run again with --accept-drift.');
    await db.close();
    process.exit(1);
  }
  if (drift.differ.length && ACCEPT_DRIFT) console.log('\nWARNING: --accept-drift was given: the functions listed above WILL be overwritten.');

  // 3. dry run: all the stages in ONE transaction that is rolled back
  if (MODE === 'dryrun') {
    const actors = await pickActors(db);
    console.log(`\naccounts available for the probes: ${JSON.stringify(actorSummary(actors))}`);
    console.log(`\n=== DRY RUN: ${toRun.map((s) => s.id).join(' + ')} inside a transaction that is rolled back`);
    await db.exec('BEGIN');
    try {
      await db.exec(`SET LOCAL lock_timeout = '10s'`);
      await db.exec(`SET LOCAL statement_timeout = '180s'`);
      for (const s of toRun) await runStage(db, s, actors);
      await db.exec('ROLLBACK');
      console.log('\nDRY RUN PASSED. Everything was rolled back.');
    } catch (e) {
      await db.exec('ROLLBACK').catch(() => {});
      console.log(`\n  FAILED and rolled back: ${String(e.message).split('\n')[0]}`);
      await db.close();
      process.exit(1);
    }
    const left = await recordedVersions(db);
    console.log(`after the dry run: stages recorded = ${STAGES.filter((s) => left.has(s.version)).map((s) => s.id).join(', ') || 'none'}   <- unchanged, as expected for a dry run`);
    await db.close();
    return;
  }

  // 4. apply: each stage in its own transaction
  for (const s of toRun) {
    const actors = await pickActors(db);
    console.log(`\naccounts available for the probes: ${JSON.stringify(actorSummary(actors))}`);
    console.log(`\n=== APPLYING ${s.id} (one transaction)`);
    try {
      await applyStage(db, s, actors);
    } catch (e) {
      await db.close();
      process.exit(1);
    }
    await recheck(s);
  }
  const after = await exposure(db);
  console.log('\n=== the live perimeter NOW');
  printExposure(after);
  const last = toRun[toRun.length - 1];
  console.log(`\n${last.id} is applied and verified.${last.id === 'S0' ? ' The sign-up privilege escalation is closed. Next: S1, then deploy the new server and apps.' : last.id === 'S1' ? ' Next: deploy the new server and the four apps, check them, then S2, S3, S4 (with --apps-deployed).' : last.id === 'S4' ? ' The perimeter lockdown is complete. Run: node scripts/verifyPerimeter.js' : ''}`);
  await db.close();
}

function actorSummary(a) {
  return { passenger: !!a.passenger, driver: !!a.driver, toda_admin: !!a.toda, lgu_admin: !!a.lgu, driver_with_files: !!a.driverWithFiles };
}

// One stage, one transaction: migration + verification + history row, committed together or not at all.
async function applyStage(db, stage, actors) {
  await db.exec('BEGIN');
  try {
    await db.exec(`SET LOCAL lock_timeout = '10s'`);
    await db.exec(`SET LOCAL statement_timeout = '180s'`);
    await runStage(db, stage, actors);
    await db.query(`INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ($1, $2, $3) ON CONFLICT (version) DO NOTHING`, [stage.version, stage.name, [sqlOf(stage)]]);
    await db.exec('COMMIT');
    console.log(`\n  COMMITTED + recorded in migration history (${stage.version})`);
  } catch (e) {
    await db.exec('ROLLBACK').catch(() => {});
    console.log(`\n  FAILED and rolled back: ${String(e.message).split('\n')[0]}`);
    throw e;
  }
  await db.exec(`NOTIFY pgrst, 'reload schema'`);
  console.log('  PostgREST asked to reload its schema cache');
}

// After the commit: the same verification again, read-only, from a brand-new connection (hosted database only).
async function recheck(stage) {
  if (EMULATOR) return;
  const fresh = await openDb().catch(() => null);
  if (!fresh) { console.log('  (could not open a second connection for the re-check)'); return; }
  try {
    const rec = (await fresh.query(`select 1 from supabase_migrations.schema_migrations where version = $1`, [stage.version])).rowCount > 0;
    console.log(`\nre-check on a brand-new connection: ${stage.id} recorded = ${rec}`);
    const actors = await pickActors(fresh);
    await fresh.exec('BEGIN');
    const h = helpers(fresh);
    await fresh.exec('SAVEPOINT recheck');
    try { await VERIFY[stage.id](h, actors); } finally { await fresh.exec('ROLLBACK TO SAVEPOINT recheck'); await fresh.exec('ROLLBACK'); }
  } finally {
    await fresh.close();
  }
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
