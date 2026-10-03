// scripts/applySecurityPatch.js
// Applies ONLY migration 20261007000004_security_null_safe_service_context.sql to the hosted Supabase database.
// Prints no credentials and no personal data. Uses DATABASE_URL from server/.env (the same connection as the earlier batches).
//
//   node scripts/applySecurityPatch.js dryrun   1) shows, for each attack, whether it works on the LIVE database today
//                                                  (every attack runs in its own brand-new connection, so the custom
//                                                  setting is undefined, exactly like a freshly opened pooled connection;
//                                                  everything is rolled back),
//                                               2) applies the patch inside a transaction, proves every attack is refused
//                                                  and that the legitimate paths still work, then ROLLS BACK.
//                                               Nothing is kept. Safe to run any number of times.
//   node scripts/applySecurityPatch.js apply    runs the patch in ONE transaction, verifies before COMMIT (any failed check
//                                               rolls everything back), records it in supabase_migrations.schema_migrations,
//                                               then re-checks from a brand-new connection.
//
// The patch replaces two live functions (is_service_context() and protect_read_only_columns()). The script refuses to run
// if the live bodies are not exactly the Batch 3 versions it was written against.
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..').replace(/\\/g, '/');
require(REPO + '/node_modules/dotenv').config({ path: REPO + '/server/.env' });
const { Client } = require(REPO + '/node_modules/pg');

const MODE = process.argv[2];
if (!['dryrun', 'apply'].includes(MODE)) { console.log('usage: node scripts/applySecurityPatch.js dryrun|apply'); process.exit(2); }
const url = process.env.DATABASE_URL;
if (!url) { console.log('NO DATABASE_URL in server/.env'); process.exit(2); }

const M = { version: '20261007000004', name: 'security_null_safe_service_context', file: '20261007000004_security_null_safe_service_context.sql' };
const sql = fs.readFileSync(`${REPO}/supabase/migrations/${M.file}`, 'utf8');
const mk = () => new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
const norm = (s) => s.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').trim();

// ---- tiny helpers (same style as scripts/applyBatch5Migrations.js) -------------------------------------------------------
function helpers(c) {
  let n = 0;
  const q = async (s, p) => (await c.query(s, p)).rows;
  const one = async (s, p) => (await q(s, p))[0];
  const must = (cond, msg) => { if (!cond) throw new Error('verification failed: ' + msg); console.log('  ok  ' + msg); };
  const claims = (sub, role = 'authenticated') => c.query(
    `select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)`,
    [sub || '', role, JSON.stringify({ sub: sub || null, role })]);
  const sandbox = async (fn) => {
    const sp = 'sb' + (++n);
    await c.query('SAVEPOINT ' + sp);
    try { return await fn(); } finally { await c.query('ROLLBACK TO SAVEPOINT ' + sp); await c.query('RELEASE SAVEPOINT ' + sp); }
  };
  // Runs fn in a savepoint that is always rolled back; returns { ok, value } or { ok:false, error }.
  const tryIt = async (fn) => {
    const sp = 'tr' + (++n);
    await c.query('SAVEPOINT ' + sp);
    let out;
    try { out = { ok: true, value: await fn() }; } catch (e) { out = { ok: false, error: String(e.message).split('\n')[0] }; }
    await c.query('ROLLBACK TO SAVEPOINT ' + sp);
    await c.query('RELEASE SAVEPOINT ' + sp);
    return out;
  };
  const expectRefused = async (label, re, fn) => {
    const r = await tryIt(fn);
    must(!r.ok && re.test(r.error), `${label} -> refused (${r.ok ? 'NOT REFUSED' : r.error.slice(0, 80)})`);
  };
  return { q, one, must, claims, sandbox, tryIt, expectRefused };
}

// ---- who the probes use (chosen in a separate connection so the probe connections stay fresh) ---------------------------
async function pickActors() {
  const c = mk();
  await c.connect();
  const q = async (s) => (await c.query(s)).rows[0];
  const a = {
    passenger: await q(`select passenger_id, auth_user_id from public.passenger where auth_user_id is not null and account_status = 'Active' order by created_at limit 1`),
    driver: await q(`select driver_id, auth_user_id from public.driver where auth_user_id is not null and account_status in ('Verified','Suspended','Deactivated') order by created_at limit 1`),
    eligible: await q(`select d.driver_id, d.auth_user_id from public.driver d
        where d.auth_user_id is not null and d.account_status = 'Verified' and d.availability_status = 'Offline'
          and coalesce((public.account_restriction_state('driver', d.driver_id)->>'restricted')::boolean, false) = false
          and coalesce((public.is_driver_documentarily_restricted(d.driver_id)->>'is_restricted')::boolean, false) = false
        order by d.created_at limit 1`),
    lgu: await q(`select auth_user_id from public.lgu_admin where account_status = 'Active' and auth_user_id is not null limit 1`),
  };
  await c.end();
  return a;
}

// The attacks, as statements run with the claims of the attacker. `refused` is what the patched guard says.
function attacks(a) {
  return [
    { name: 'a passenger edits their own strike count', actor: a.passenger && a.passenger.auth_user_id, refused: /policy engine/,
      run: (c) => c.query(`update public.passenger set strikes_count = strikes_count + 1 where passenger_id = $1`, [a.passenger.passenger_id]).then((r) => r.rowCount === 1) },
    { name: 'a driver gives themselves a suspension end date', actor: a.driver && a.driver.auth_user_id, refused: /policy engine/,
      run: (c) => c.query(`update public.driver set suspended_until = now() + interval '30 days' where driver_id = $1`, [a.driver.driver_id]).then((r) => r.rowCount === 1) },
    { name: 'a verified driver changes the plate number of their vehicle', actor: a.driver && a.driver.auth_user_id, refused: /ERR_VEHICLE_LOCKED/,
      run: (c) => c.query(`update public.driver set plate_number = coalesce(plate_number, '') || 'X' where driver_id = $1`, [a.driver.driver_id]).then((r) => r.rowCount === 1) },
    { name: 'an eligible driver flips themselves Available without driver_go_online()', actor: a.eligible && a.eligible.auth_user_id, refused: /ERR_USE_GO_ONLINE/,
      run: (c) => c.query(`update public.driver set availability_status = 'Available' where driver_id = $1`, [a.eligible.driver_id]).then((r) => r.rowCount === 1) },
    { name: 'the LGU administrator flips the strike pause switch directly', actor: a.lgu && a.lgu.auth_user_id, refused: /only be changed through set_strike_accrual_pause/,
      run: (c) => c.query(`update public.system_policy_config set config_value = config_value where config_key = 'strike_accrual_paused'`).then((r) => r.rowCount === 1) },
    { name: 'a passenger creates an administrative review flag', actor: a.passenger && a.passenger.auth_user_id, refused: /Only administrators or the system can create review flags/,
      run: (c) => c.query(`select public.create_admin_review_flag('DRIVER_INACTIVITY_REVIEW', 'driver', $1, 'Rule 7.8', 'lgu_admin', NULL) as v`, [a.driver.driver_id]).then((r) => !!r.rows[0].v) },
    { name: 'a passenger runs the strike sweep (service-only function)', actor: a.passenger && a.passenger.auth_user_id, refused: /service role only/,
      run: (c) => c.query(`select public.sweep_strike_state() as v`).then((r) => r.rows[0].v !== null) },
    { name: 'a passenger runs the presence sweep (service-only function)', actor: a.passenger && a.passenger.auth_user_id, refused: /only the system may run the presence sweep/,
      run: (c) => c.query(`select public.sweep_driver_presence() as v`).then((r) => r.rows[0].v !== null) },
  ];
}

// One attack on a brand-new connection (the setting is undefined), always rolled back.
async function freshAttack(at) {
  if (!at.actor) return { skipped: true };
  const c = mk();
  await c.connect();
  try {
    const fresh = (await c.query(`select current_setting('sakay.internal_context', true) is null as f`)).rows[0].f;
    if (!fresh) return { invalid: true };
    await c.query('BEGIN');
    await c.query(`SET LOCAL lock_timeout = '8s'`);
    await c.query(`SET LOCAL statement_timeout = '60s'`);
    await c.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)`, [at.actor, JSON.stringify({ sub: at.actor, role: 'authenticated' })]);
    let out;
    try { out = { worked: await at.run(c) }; } catch (e) { out = { refused: String(e.message).split('\n')[0] }; }
    await c.query('ROLLBACK');
    return out;
  } finally { await c.end(); }
}

// ---- checks that must hold with the patch in place (inside the patch transaction) -----------------------------------------
async function verifyPatched(h, a) {
  const { one, must, claims, sandbox, expectRefused } = h;
  const first = (await one(`select public.is_service_context() as v`)).v;
  must(first === false, `is_service_context() answers FALSE (not NULL) for a connection with no claims: ${first}`);
  const defs = await one(`select (select provolatile from pg_proc where oid = 'public.is_service_context()'::regprocedure) v1, (select prosecdef from pg_proc where oid = 'public.protect_read_only_columns()'::regprocedure) s2`);
  must(defs.v1 === 's' && defs.s2 === true, 'the two functions kept their attributes (STABLE helper; SECURITY DEFINER trigger function)');

  for (const at of attacks(a)) {
    if (!at.actor) { console.log(`  --  skipped (no suitable account on this database): ${at.name}`); continue; }
    await expectRefused(at.name, at.refused, async () => { await claims(at.actor); await at.run(h.c); });
  }

  // legitimate paths
  if (a.passenger) {
    const r = await h.tryIt(async () => { await claims(a.passenger.auth_user_id); return (await h.c.query(`update public.passenger set full_name = full_name where passenger_id = $1`, [a.passenger.passenger_id])).rowCount; });
    must(r.ok && r.value === 1, 'an account holder can still save their own record (no protected column touched)');
  }
  const svc = await h.tryIt(async () => { await claims(null, 'service_role'); return (await h.c.query(`select public.sweep_strike_state() as v`)).rows[0].v; });
  must(svc.ok && svc.value !== null, 'the service role can still run the strike sweep');
  const svc2 = await h.tryIt(async () => { await claims(null, 'service_role'); return (await h.c.query(`select public.sweep_driver_presence() as v`)).rows[0].v; });
  must(svc2.ok && svc2.value !== null, 'the service role can still run the presence sweep');
  if (a.lgu && a.driver) {
    const f = await h.tryIt(async () => { await claims(a.lgu.auth_user_id); return (await h.c.query(`select public.create_admin_review_flag('DRIVER_INACTIVITY_REVIEW', 'driver', $1, 'Rule 7.8', 'lgu_admin', NULL) as v`, [a.driver.driver_id])).rows[0].v; });
    must(f.ok && !!f.value, 'the LGU administrator can still create a review flag');
    const p = await h.tryIt(async () => { await claims(a.lgu.auth_user_id); return (await h.c.query(`select public.set_strike_accrual_pause(true, 'ALL', 'verification only (rolled back)') as v`)).rows[0].v; });
    must(p.ok && p.value, 'the LGU administrator can still pause strikes through the audited function (rolled back)');
  }
  const internal = await h.tryIt(async () => {
    await h.c.query(`select set_config('sakay.internal_context', 'true', true)`);
    return (await h.c.query(`select public.is_service_context() as v`)).rows[0].v;
  });
  must(internal.ok && internal.value === true, 'the internal context (policy-engine functions) is still recognised as trusted');
}

async function preChecks(c) {
  const h = helpers(c);
  h.c = c;
  const hist = new Set((await h.q(`select version from supabase_migrations.schema_migrations`)).map((r) => r.version));
  const batch5 = ['20261007000001', '20261007000002', '20261007000003'].every((v) => hist.has(v));
  const body = (d) => (d.match(/AS \$function\$([\s\S]*)\$function\$/) || [])[1] || '';
  const repoBody = (name) => {
    const t = fs.readFileSync(`${REPO}/supabase/migrations/20261004000001_batch3_strike_foundation.sql`, 'utf8').replace(/\r\n/g, '\n');
    const i = t.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    const a = t.indexOf('$$', i) + 2;
    return t.slice(a, t.indexOf('$$ LANGUAGE', a));
  };
  const live1 = (await h.one(`select pg_get_functiondef('public.is_service_context()'::regprocedure) d`)).d;
  const live2 = (await h.one(`select pg_get_functiondef('public.protect_read_only_columns()'::regprocedure) d`)).d;
  return {
    h, recorded: hist.has(M.version), batch5,
    helperIsBatch3: norm(body(live1)) === norm(repoBody('is_service_context')),
    protectIsBatch3: norm(body(live2)) === norm(repoBody('protect_read_only_columns')),
    helperAlreadyStrict: norm(body(live1)).includes("COALESCE(current_setting('sakay.internal_context', true), '')"),
  };
}

async function main() {
  const u = new URL(url);
  console.log(`MODE ${MODE.toUpperCase()} | target ${u.hostname} | db ${u.pathname.slice(1)}`);
  const c = mk();
  await c.connect();
  // First statement of this fresh connection: is the helper unsafe right now?
  const probe = (await c.query(`select public.is_service_context() is null as helper_is_null, current_setting('sakay.internal_context', true) is null as setting_unset`)).rows[0];
  console.log('live helper in a brand-new connection:', JSON.stringify(probe), probe.helper_is_null ? ' <- the flaw is live' : ' <- already strict');
  const pre = await preChecks(c);
  console.log(`Batch 5 recorded: ${pre.batch5} | patch recorded: ${pre.recorded} | live is_service_context() is the Batch 3 text: ${pre.helperIsBatch3} | live protect_read_only_columns() is the Batch 3 text: ${pre.protectIsBatch3}`);
  if (pre.recorded) { console.log('The patch is already recorded in the migration history; nothing to do.'); await c.end(); return; }
  if (!pre.batch5) { console.log('ABORT: the Batch 5 migrations are not recorded; apply them first.'); await c.end(); process.exit(1); }
  if (!pre.helperIsBatch3 || !pre.protectIsBatch3) {
    console.log('ABORT: a live function differs from the repo (Batch 3) text. The patch would overwrite a change nobody reviewed. Inspect first.');
    await c.end(); process.exit(1);
  }
  await c.end();

  const actors = await pickActors();
  console.log('accounts available for the probes:', JSON.stringify({ passenger: !!actors.passenger, driver: !!actors.driver, eligible_offline_driver: !!actors.eligible, lgu_admin: !!actors.lgu }));
  const list = attacks(actors);

  if (MODE === 'dryrun') {
    console.log('\n=== 1) TODAY, on the live database: each attack on a brand-new connection (all rolled back)');
    let vulnerable = 0;
    for (const at of list) {
      const r = await freshAttack(at);
      const verdict = r.skipped ? 'skipped (no suitable account)' : r.invalid ? 'INVALID (connection was not fresh)' : r.worked ? 'WORKS -> VULNERABLE' : r.refused ? `refused (${r.refused.slice(0, 60)})` : 'did nothing';
      if (r.worked) vulnerable++;
      console.log(`  ${verdict.padEnd(34)} ${at.name}`);
    }
    console.log(`  => ${vulnerable} of ${list.length} attacks work on the live database today`);
  }

  console.log(`\n=== ${MODE === 'dryrun' ? '2) THE PATCH inside a transaction that is rolled back' : 'APPLYING THE PATCH (one transaction)'}`);
  const t = mk();
  await t.connect();
  const h = helpers(t);
  h.c = t;
  await t.query('BEGIN');
  try {
    await t.query(`SET LOCAL lock_timeout = '10s'`);
    await t.query(`SET LOCAL statement_timeout = '120s'`);
    await t.query(sql);
    console.log('  statements executed (including the migration\'s own self-check)');
    await verifyPatched(h, actors);
    if (MODE === 'apply') {
      await t.query(`INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ($1, $2, $3) ON CONFLICT (version) DO NOTHING`, [M.version, M.name, [sql]]);
      await t.query('COMMIT');
      console.log('  COMMITTED + recorded in migration history');
    } else {
      await t.query('ROLLBACK');
      console.log('\nDRY RUN PASSED. Everything was rolled back.');
    }
  } catch (e) {
    await t.query('ROLLBACK').catch(() => {});
    console.log(`  FAILED and rolled back: ${String(e.message).split('\n')[0]}`);
    await t.end();
    process.exit(1);
  }
  await t.end();

  // Fresh connection afterwards: is the live state what we expect?
  const f = mk();
  await f.connect();
  const after = (await f.query(`select public.is_service_context() is null as helper_is_null`)).rows[0].helper_is_null;
  const rec = (await f.query(`select 1 from supabase_migrations.schema_migrations where version = $1`, [M.version])).rowCount > 0;
  console.log(`\nafter (brand-new connection): helper answers NULL = ${after}; patch recorded = ${rec}` +
    (MODE === 'dryrun' ? (after && !rec ? '   <- as expected for a dry run: nothing was kept' : '   <- UNEXPECTED: the dry run changed something') : (!after && rec ? '   <- patched' : '   <- UNEXPECTED')));
  if (MODE === 'apply') {
    await f.end();
    console.log('\n=== re-check from brand-new connections (the attacks must now be refused)');
    let bad = 0;
    for (const at of list) {
      const r = await freshAttack(at);
      const ok = r.skipped || (r.refused && at.refused.test(r.refused));
      if (!ok) bad++;
      console.log(`  ${(r.skipped ? 'skipped' : r.worked ? 'STILL WORKS' : r.refused ? 'refused' : 'unexpected').padEnd(12)} ${at.name}`);
    }
    if (bad) { console.log(`\n${bad} attack(s) were not refused after the patch. Investigate before relying on it.`); process.exit(1); }
    console.log('\nThe security patch is applied and verified.');
    return;
  }
  await f.end();
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
