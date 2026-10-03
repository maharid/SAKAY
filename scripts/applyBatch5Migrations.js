// scripts/applyBatch5Migrations.js
// Applies ONLY the three Batch 5 migrations to the hosted Supabase database. Prints no credentials and no personal data.
// Uses DATABASE_URL from server/.env (the same connection the Batch 3 / Batch 4 migrations were applied with).
//
//   node scripts/applyBatch5Migrations.js dryrun   all three in ONE transaction, verify (including a simulated booking
//                                                  life: quote, refused edits, GPS track, locked final fare), then ROLLBACK.
//                                                  Nothing is kept. Safe to run any number of times.
//   node scripts/applyBatch5Migrations.js apply    one transaction per migration: run it, verify, record it in
//                                                  supabase_migrations.schema_migrations, COMMIT. Any failed check rolls that
//                                                  migration back and stops. Then asks the API to reload its schema cache.
//
// Every behaviour test runs inside a SAVEPOINT that is rolled back, so verification leaves no data behind.
// Run `dryrun` first; `apply` refuses to run if only some of the three are already recorded.
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..').replace(/\\/g, '/');
require(REPO + '/node_modules/dotenv').config({ path: REPO + '/server/.env' });
const { Client } = require(REPO + '/node_modules/pg');

const MODE = process.argv[2];
if (!['dryrun', 'apply'].includes(MODE)) { console.log('usage: node scripts/applyBatch5Migrations.js dryrun|apply'); process.exit(2); }
const url = process.env.DATABASE_URL;
if (!url) { console.log('NO DATABASE_URL in server/.env'); process.exit(2); }

const MIGRATIONS = [
  { version: '20261007000001', name: 'batch5_fare_rules', file: '20261007000001_batch5_fare_rules.sql' },
  { version: '20261007000002', name: 'batch5_fare_engine', file: '20261007000002_batch5_fare_engine.sql' },
  { version: '20261007000003', name: 'batch5_booking_fare_guards', file: '20261007000003_batch5_booking_fare_guards.sql' },
];
const sqlOf = (m) => fs.readFileSync(`${REPO}/supabase/migrations/${m.file}`, 'utf8');
const mk = () => new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

function helpers(c) {
  let spN = 0;
  const q = async (s, p) => (await c.query(s, p)).rows;
  const one = async (s, p) => (await q(s, p))[0];
  const must = (cond, msg) => { if (!cond) throw new Error('verification failed: ' + msg); console.log('  ok  ' + msg); };
  const claims = (sub, role = 'authenticated') => c.query(
    `select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)`,
    [sub, role, JSON.stringify({ sub, role })]);
  const internal = (on) => c.query(`select set_config('sakay.internal_context', $1, true)`, [on ? 'true' : '']);
  // Runs fn inside a savepoint that is ALWAYS rolled back (claims and settings made inside go with it).
  const sandbox = async (fn) => {
    const sp = 'sb' + (++spN);
    await c.query('SAVEPOINT ' + sp);
    try { return await fn(); }
    finally { await c.query('ROLLBACK TO SAVEPOINT ' + sp); await c.query('RELEASE SAVEPOINT ' + sp); }
  };
  // The statement must be refused with a message matching re; whatever it did is undone.
  const expectFail = async (label, re, fn) => {
    const sp = 'ef' + (++spN);
    await c.query('SAVEPOINT ' + sp);
    let err = null;
    try { await fn(); } catch (e) { err = e; }
    await c.query('ROLLBACK TO SAVEPOINT ' + sp);
    await c.query('RELEASE SAVEPOINT ' + sp);
    must(err && re.test(err.message), `${label} -> refused (${err ? String(err.message).split('\n')[0].slice(0, 80) : 'NOT REFUSED'})`);
  };
  return { q, one, must, claims, internal, sandbox, expectFail };
}

// ---- dependency check: every public.* object the three files use must exist or be created by them ------------------
async function checkDependencies(h) {
  const all = MIGRATIONS.map(sqlOf).join('\n');
  const defined = new Set([...all.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.([a-z_0-9]+)/gi)].map((m) => m[1].toLowerCase()));
  const created = new Set([...all.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?public\.([a-z_0-9]+)/gi)].map((m) => m[1].toLowerCase()));
  const refs = new Set([...all.matchAll(/public\.([a-z_][a-z_0-9]*)/gi)].map((m) => m[1].toLowerCase()));
  const external = [...refs].filter((n) => !defined.has(n) && !created.has(n));
  const rel = await h.q(`select c.relname as n from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = any($1)`, [external]);
  const fn = await h.q(`select distinct p.proname as n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [external]);
  const have = new Set([...rel, ...fn].map((r) => r.n));
  const missing = external.filter((n) => !have.has(n));
  console.log(`  ${external.length} existing objects referenced by the migrations; missing on the live database: ${JSON.stringify(missing)}`);
  h.must(missing.length === 0, 'every table and function the migrations call already exists on the live database');
}

// ---- Migration 1: the rule store ---------------------------------------------------------------------------------
async function verifyM1(h, pre) {
  const { one, q, must, claims, sandbox, expectFail } = h;
  must((await one(`select public.fare_policy_constant('seat_capacity') v`)).v === 4, 'fare constant: seat capacity is 4');
  const p = await one(`select has_table_privilege('anon','public.fare_matrix','INSERT') a_i, has_table_privilege('authenticated','public.fare_matrix','INSERT') u_i,
      has_table_privilege('authenticated','public.fare_matrix','UPDATE') u_u, has_table_privilege('authenticated','public.fare_matrix','DELETE') u_d,
      has_table_privilege('authenticated','public.fare_matrix','SELECT') u_s`);
  must(!p.a_i && !p.u_i && !p.u_u && !p.u_d, 'no client role can write fare_matrix directly any more');
  must(p.u_s, 'the apps can still READ the fare table');
  const pol = (await q(`select policyname from pg_policies where schemaname='public' and tablename='fare_matrix' order by 1`)).map((r) => r.policyname);
  must(pol.join(',') === 'fare_matrix_select_policy', 'only the read policy is left on fare_matrix: ' + pol.join(','));
  const trg = await one(`select tgenabled from pg_trigger where tgname='trigger_protect_fare_matrix_history' and tgrelid='public.fare_matrix'::regclass`);
  must(trg && trg.tgenabled === 'O', 'the append-only trigger is attached and enabled');
  const cnt = await one(`select count(*)::int n, count(*) filter (where ordinance_reference is null)::int no_cite from public.fare_matrix`);
  must(cnt.n === pre.fareRows, `no fare_matrix rows were added or removed by the migration (${cnt.n})`);
  must(cnt.no_cite === 0, 'the existing 15 / 2 km / 1 per km row now carries its citation');
  const r = await one(`select * from public.fare_rule_in_force()`);
  must(r.fare_matrix_id && Number(r.base_fare) === 15 && Number(r.base_distance_km) === 2 && Number(r.succeeding_rate) === 1,
    `fare_rule_in_force() returns the live rule: 15 / 2 km / 1 per km, citation "${r.ordinance_reference}"`);
  must(r.ordinance_reference === 'City Ordinance No. 110, Series of 2022', 'the citation is Ordinance No. 110, Series of 2022');
  const g = await one(`select has_function_privilege('anon','public.enact_fare_matrix(numeric,numeric,numeric,text,text,timestamptz,text)','EXECUTE') a_e,
      has_function_privilege('authenticated','public.enact_fare_matrix(numeric,numeric,numeric,text,text,timestamptz,text)','EXECUTE') u_e,
      has_function_privilege('authenticated','public.fare_rule_in_force(timestamptz)','EXECUTE') u_r,
      has_function_privilege('authenticated','public.fare_matrix_history()','EXECUTE') u_h, has_function_privilege('anon','public.fare_matrix_history()','EXECUTE') a_h`);
  must(!g.a_e && g.u_e && !g.u_r && g.u_h && !g.a_h, 'rate functions: signed-in users may call enact / history (they check the role inside); anonymous may not; the rule lookup is server-only');

  const pax = await one(`select auth_user_id from public.passenger where auth_user_id is not null limit 1`);
  if (pax) {
    await expectFail('a passenger trying to change the fare rate', /ERR_NOT_LGU_ADMIN/, async () => {
      await claims(pax.auth_user_id);
      await h.q(`select public.enact_fare_matrix(20, 2, 2, 'City Ordinance test', 'not allowed', null, null)`);
    });
  } else console.log('  (no passenger with a login to test the role gate with)');

  const lgu = await one(`select auth_user_id from public.lgu_admin where account_status = 'Active' and auth_user_id is not null limit 1`);
  must(!!lgu, 'an active LGU administrator with a login exists');
  await sandbox(async () => {
    await claims(lgu.auth_user_id);
    const e = (await one(`select public.enact_fare_matrix(20, 2, 2, 'LIVE VERIFICATION ONLY', 'Live verification of the migration (rolled back at once)', now() + interval '1 hour', null) as r`)).r;
    must(e && e.success === true, 'the LGU administrator can enact a future-dated rate (this test change is rolled back at once)');
    const inside = await one(`select (select count(*) from public.fare_matrix)::int rules, (select count(*) from public.audit_log where action_type = 'FARE_MATRIX_ENACTED')::int audits`);
    must(inside.rules === pre.fareRows + 1 && inside.audits >= 1, `it appended one rule version and wrote the audit entry (rules ${inside.rules}, audit rows ${inside.audits})`);
    const hist = await q(`select status from public.fare_matrix_history() order by effective_timestamp`);
    must(hist.map((x) => x.status).join(',') === 'In force,Scheduled', 'the LGU history shows the live rule "In force" and the new one "Scheduled": ' + hist.map((x) => x.status).join(','));
  });
  must((await one(`select count(*)::int n from public.fare_matrix`)).n === pre.fareRows, 'rolled back: the live rule list is exactly as before');
}

// ---- Migration 2: the fare engine --------------------------------------------------------------------------------
async function verifyM2(h) {
  const { one, must, claims, sandbox } = h;
  const f5 = (await one(`select public.calculate_fare(5, 'Solo', 1, 15, 2, 1, 4) r`)).r;
  must(Number(f5.solo_fare) === 72 && Number(f5.shared_matched_estimate) === 36 && Number(f5.max_unmatched_fare) === 72, '5 km: Solo 72, Matched Shared Fare Estimate 36, Maximum Unmatched Fare 72');
  const f10 = (await one(`select public.calculate_fare(10, 'Solo', 1, 15, 2, 1, 4) r`)).r;
  must(Number(f10.solo_fare) === 92 && Number(f10.shared_matched_estimate) === 46, '10 km: Solo 92, Matched Shared Fare Estimate 46');
  const f2 = (await one(`select public.calculate_fare(2, 'Solo', 1, 15, 2, 1, 4) r`)).r;
  const f201 = (await one(`select public.calculate_fare(2.125, 'Solo', 1, 15, 2, 1, 4) r`)).r;
  must(Number(f2.solo_fare) === 60 && Number(f201.solo_fare) === 61, 'boundaries: 2 km is 60; 2.125 km (60.50) rounds up to 61');
  const legs = JSON.stringify([{ booking_id: 'A', passenger_count: 1, board_km: 0, alight_km: 5 }, { booking_id: 'B', passenger_count: 1, board_km: 2, alight_km: 5 }]);
  const al = (await one(`select public.allocate_shared_fares($1::jsonb, 15, 2, 1, 4) r`, [legs])).r;
  must(al.bookings.map((b) => Number(b.fare)).join('/') === '50/22' && Number(al.pool_fare) === 72, 'shared allocation walkthrough (A rides 5 km, B boards at km 2): 50 / 22, total 72');
  const g = await one(`select has_function_privilege('anon','public.calculate_fare(numeric,text,integer,numeric,numeric,numeric,integer)','EXECUTE') a_c,
      has_function_privilege('authenticated','public.calculate_fare(numeric,text,integer,numeric,numeric,numeric,integer)','EXECUTE') u_c,
      has_function_privilege('anon','public.quote_fare(numeric,integer)','EXECUTE') a_q, has_function_privilege('authenticated','public.quote_fare(numeric,integer)','EXECUTE') u_q,
      has_function_privilege('authenticated','public._shared_segments(jsonb)','EXECUTE') u_s`);
  must(!g.a_c && g.u_c && !g.a_q && g.u_q && !g.u_s, 'privileges: signed-in users can quote, anonymous callers cannot, the segment helper is server-only');

  const rule = await one(`select fare_matrix_id from public.fare_rule_in_force()`);
  const pax = await one(`select auth_user_id from public.passenger where auth_user_id is not null limit 1`);
  if (pax) {
    await sandbox(async () => {
      await claims(pax.auth_user_id);
      const qt = (await one(`select public.quote_fare(5, 1) r`)).r;
      must(Number(qt.solo_fare) === 72 && qt.rule && qt.rule.fare_matrix_id === rule.fare_matrix_id, 'a signed-in passenger gets a quote: Solo 72 on the live rule');
    });
  }
}

// ---- Migration 3: booking guards, GPS ledger, final fare -----------------------------------------------------------
async function verifyM3(h, pre) {
  const { one, q, must } = h;
  const cols = (await q(`select column_name from information_schema.columns where table_schema='public' and table_name='booking' and column_name in ('fare_matrix_id','fare_breakdown','fare_locked_at')`)).map((r) => r.column_name).sort();
  must(cols.join(',') === 'fare_breakdown,fare_locked_at,fare_matrix_id', 'booking has the three new columns');
  const fah = await one(`select to_regclass('public.fare_adjustment_history') t, (select relrowsecurity from pg_class where oid = 'public.fare_adjustment_history'::regclass) rls,
      has_table_privilege('authenticated','public.fare_adjustment_history','INSERT') u_i, has_table_privilege('authenticated','public.fare_adjustment_history','UPDATE') u_u,
      has_table_privilege('authenticated','public.fare_adjustment_history','DELETE') u_d, has_table_privilege('anon','public.fare_adjustment_history','SELECT') a_s`);
  must(fah.t && fah.rls && !fah.u_i && !fah.u_u && !fah.u_d && !fah.a_s, 'fare_adjustment_history exists, row-level security on, nobody can write it from a client, anonymous cannot read it');
  const gp = (await q(`select policyname from pg_policies where schemaname='public' and tablename='gps_log' order by 1`)).map((r) => r.policyname);
  must(gp.join(',') === 'gps_log_select_policy', 'gps_log keeps one read policy and no write policy: ' + gp.join(','));
  const gg = await one(`select has_table_privilege('anon','public.gps_log','SELECT') a_s, has_table_privilege('anon','public.gps_log','INSERT') a_i, has_table_privilege('authenticated','public.gps_log','INSERT') u_i,
      has_table_privilege('authenticated','public.gps_log','UPDATE') u_u, has_table_privilege('authenticated','public.gps_log','DELETE') u_d, has_table_privilege('authenticated','public.gps_log','SELECT') u_s`);
  must(!gg.a_s && !gg.a_i && !gg.u_i && !gg.u_u && !gg.u_d && gg.u_s, 'gps_log: anonymous has no access, signed-in users can only read (through the row policy), nobody writes it from a client');
  const trg = await q(`select tgname, tgenabled, (tgtype & 2) > 0 as is_before, (tgtype & 4) > 0 as on_insert, (tgtype & 16) > 0 as on_update from pg_trigger where tgrelid='public.booking'::regclass and tgname in ('trigger_booking_fare_insert_guard','trigger_booking_fare_update_guard') order by 1`);
  must(trg.length === 2 && trg.every((t) => t.tgenabled === 'O' && t.is_before) && trg[0].on_insert && trg[1].on_update, 'the two booking guards are attached (BEFORE INSERT / BEFORE UPDATE) and enabled');
  const ck = await one(`select convalidated from pg_constraint where conrelid='public.booking'::regclass and conname='booking_type_immediate_only'`);
  must(ck && ck.convalidated === true, 'booking_type can only be Immediate (CHECK validated against the existing rows)');
  const hb = await q(`select pg_get_function_identity_arguments(p.oid) args, pg_get_functiondef(p.oid) def, has_function_privilege('anon', p.oid, 'EXECUTE') a_e, has_function_privilege('authenticated', p.oid, 'EXECUTE') u_e from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='driver_heartbeat'`);
  must(hb.length === 1 && /p_session_token uuid/.test(hb[0].args) && hb[0].def.includes('_log_trip_fix') && !hb[0].a_e && hb[0].u_e, 'driver_heartbeat is still ONE function (same signature), now also logs trip fixes; drivers can call it, anonymous cannot');
  const rows = await one(`select count(*)::int n, count(*) filter (where fare_breakdown is not null)::int with_snapshot from public.booking`);
  must(rows.n === pre.bookingRows && rows.with_snapshot === 0, `the ${rows.n} existing bookings are untouched (none gets a fake snapshot)`);
  must((await one(`select count(*)::int n from pg_policies where schemaname='public' and tablename='booking'`)).n === pre.bookingPolicies, 'the booking table policies are exactly as before');
  const hv = await one(`select to_regprocedure('public.calculate_haversine_distance_km(double precision,double precision,double precision,double precision)') f`);
  must(hv.f, 'the distance helper used by the trip replay exists');
  await liveSimulation(h, pre);
}

// A whole booking life on the real database, inside a rolled-back savepoint: quote -> refused inserts -> valid insert ->
// locked columns -> accepted -> GPS track -> arrived (fare computed and locked) -> still locked -> nothing left behind.
async function liveSimulation(h, pre) {
  const { one, must, claims, internal, sandbox, expectFail } = h;
  const P = await one(`select p.passenger_id, p.auth_user_id from public.passenger p
      where p.auth_user_id is not null and p.account_status = 'Active'
        and not exists (select 1 from public.booking b where b.passenger_id = p.passenger_id and b.booking_status not in ('Completed','Cancelled','No Driver Found'))
        and coalesce((public.account_restriction_state('passenger', p.passenger_id)->>'restricted')::boolean, false) = false
      order by p.created_at limit 1`);
  const D = await one(`select d.driver_id, d.auth_user_id from public.driver d
      where d.auth_user_id is not null and coalesce((public.account_restriction_state('driver', d.driver_id)->>'restricted')::boolean, false) = false
      order by (d.account_status = 'Verified') desc, d.created_at limit 1`);
  if (!P || !D) { console.log('  (SKIPPED live booking simulation: no eligible passenger or driver was found)'); h.skipped = true; return; }
  const rule = await one(`select fare_matrix_id from public.fare_rule_in_force()`);
  const PICK = { lat: 13.4115, lng: 121.1803 }, DROP = { lat: 13.4415, lng: 121.1803 };
  console.log('  -- simulated booking life (an eligible passenger and driver are used; everything is rolled back) --');

  await sandbox(async () => {
    await claims(P.auth_user_id);
    const qt = (await one(`select public.quote_fare(3.4, 1) r`)).r;
    const fare = Number(qt.solo_fare);
    must(fare === 66, 'quote for 3.4 km: Solo fare 66');
    const ins = async (o = {}) => {
      const cols = { passenger_id: P.passenger_id, booking_type: 'Immediate', is_shared_trip: false, passenger_count: 1, pickup_address: 'LIVE CHECK A', pickup_latitude: PICK.lat, pickup_longitude: PICK.lng,
        dropoff_address: 'LIVE CHECK B', dropoff_latitude: DROP.lat, dropoff_longitude: DROP.lng, estimated_distance_km: 3.4, estimated_fare: fare, ...o };
      for (const k of Object.keys(cols)) if (cols[k] === undefined) delete cols[k];
      const keys = Object.keys(cols);
      return (await h.q(`insert into public.booking (${keys.join(',')}) values (${keys.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, keys.map((k) => cols[k])))[0];
    };

    await expectFail('a Scheduled booking', /ERR_SCHEDULED_BOOKING_NOT_SUPPORTED/, () => ins({ booking_type: 'Scheduled' }));
    await expectFail('a booking for tomorrow', /ERR_FUTURE_BOOKING_NOT_SUPPORTED/, () => ins({ requested_at: new Date(Date.now() + 86400000).toISOString() }));
    await expectFail('a tampered fare (1.00)', /ERR_FARE_MISMATCH/, () => ins({ estimated_fare: 1 }));
    await expectFail('a booking without a route distance', /ERR_DISTANCE_REQUIRED/, () => ins({ estimated_distance_km: undefined }));
    await expectFail('a route distance that does not fit the points (40 km)', /ERR_DISTANCE_IMPLAUSIBLE/, () => ins({ estimated_distance_km: 40 }));

    const b = await ins();
    must(b.booking_type === 'Immediate' && Number(b.estimated_fare) === fare && b.fare_matrix_id === rule.fare_matrix_id && b.fare_breakdown && b.fare_breakdown.estimate && b.fare_locked_at === null,
      'a correct booking is accepted: estimate 66 stored, the rule in force snapshotted on it, not yet locked');

    await expectFail('the passenger editing the estimate', /ERR_BOOKING_LOCKED/, () => h.q(`update public.booking set estimated_fare = 1 where booking_id = $1`, [b.booking_id]));
    await expectFail('the passenger moving the pickup', /ERR_BOOKING_LOCKED/, () => h.q(`update public.booking set pickup_address = 'Elsewhere' where booking_id = $1`, [b.booking_id]));
    await expectFail('the passenger editing the final fare', /ERR_FARE_LOCKED/, () => h.q(`update public.booking set actual_fare = 1 where booking_id = $1`, [b.booking_id]));

    await internal(true);
    await h.q(`update public.booking set driver_id = $2, booking_status = 'Accepted' where booking_id = $1`, [b.booking_id, D.driver_id]);
    await internal(false);

    await claims(D.auth_user_id);
    await h.q(`update public.booking set booking_status = 'Trip Ongoing', trip_started_at = now() where booking_id = $1`, [b.booking_id]);
    // 68 fixes, 50 m apart, 5 s apart (36 km/h): about 3.35 km along the route, ending just past the destination.
    await h.q(`insert into public.gps_log (booking_id, driver_id, latitude, longitude, accuracy, recorded_at)
        select $1, $2, $3::float8 + i * 0.00045::float8, $4::float8, 10::float8, now() - interval '10 minutes' + (i * 5) * interval '1 second' from generate_series(0, 67) as i`,
      [b.booking_id, D.driver_id, PICK.lat, PICK.lng]);
    const done = (await h.q(`update public.booking set booking_status = 'Arrived at Destination' where booking_id = $1 returning *`, [b.booking_id]))[0];
    must(Number(done.actual_fare) === fare && done.fare_locked_at !== null && done.fare_breakdown.final.distance_basis === 'estimate_within_tolerance'
      && Number(done.actual_distance_km) > 3.2 && Number(done.actual_distance_km) < 3.5,
      `arrival: the database computed and locked the final fare (66) from the recorded track (${done.actual_distance_km} km, inside the tolerance, so the estimate stands)`);

    await claims(P.auth_user_id);
    await expectFail('the passenger editing the fare after the lock', /ERR_FARE_LOCKED/, () => h.q(`update public.booking set actual_fare = 1 where booking_id = $1`, [b.booking_id]));
    const paid = (await h.q(`update public.booking set booking_status = 'Completed' where booking_id = $1 returning actual_fare, fare_locked_at`, [b.booking_id]))[0];
    must(Number(paid.actual_fare) === fare, 'the passenger confirming payment (Completed) does not change the locked fare');
    must((await one(`select count(*)::int n from public.gps_log where booking_id = $1`, [b.booking_id])).n === 68, 'the simulated track (68 fixes) was in gps_log for the replay');
  });

  const left = await one(`select (select count(*) from public.booking where pickup_address like 'LIVE CHECK%')::int bookings, (select count(*) from public.gps_log)::int gps, (select count(*) from public.fare_adjustment_history)::int ledger,
      (select count(*) from public.booking)::int total`);
  must(left.bookings === 0 && left.gps === pre.gpsRows && left.ledger === 0 && left.total === pre.bookingRows, 'rolled back: no simulated booking, track point or ledger row remains');
}

async function preState(h) {
  const { one, q } = h;
  return {
    fareRows: (await one(`select count(*)::int n from public.fare_matrix`)).n,
    bookingRows: (await one(`select count(*)::int n from public.booking`)).n,
    gpsRows: (await one(`select count(*)::int n from public.gps_log`)).n,
    bookingPolicies: (await one(`select count(*)::int n from pg_policies where schemaname='public' and tablename='booking'`)).n,
    recorded: new Set((await q(`select version from supabase_migrations.schema_migrations`)).map((r) => r.version)),
  };
}

async function main() {
  const c = mk();
  await c.connect();
  const h = helpers(c);
  const u = new URL(url);
  console.log(`MODE ${MODE.toUpperCase()} | target ${u.hostname} | db ${u.pathname.slice(1)}`);
  const pre = await preState(h);
  console.log('before:', JSON.stringify({ fare_matrix_rows: pre.fareRows, bookings: pre.bookingRows, gps_log_rows: pre.gpsRows, booking_policies: pre.bookingPolicies }));
  const already = MIGRATIONS.filter((m) => pre.recorded.has(m.version)).map((m) => m.version);
  console.log('already recorded in migration history:', JSON.stringify(already));

  if (MODE === 'dryrun') {
    if (already.length) { console.log('ABORT: some Batch 5 migrations are already recorded; nothing to dry-run'); await c.end(); process.exit(1); }
    console.log('\n=== dependency check (read-only)');
    await checkDependencies(h);
    console.log('\n=== DRY RUN: all three migrations in ONE transaction, then ROLLBACK');
    await c.query('BEGIN');
    try {
      await c.query(`SET LOCAL lock_timeout = '10s'`);
      await c.query(`SET LOCAL statement_timeout = '120s'`);
      for (const [i, m] of MIGRATIONS.entries()) {
        console.log(`\n--- ${m.file}`);
        await c.query(sqlOf(m));
        console.log('  statements executed');
        if (i === 0) await verifyM1(h, pre); else if (i === 1) await verifyM2(h); else await verifyM3(h, pre);
      }
      await c.query('ROLLBACK');
      console.log('\nDRY RUN PASSED. Everything was rolled back.');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      console.log(`\nDRY RUN FAILED (rolled back): ${String(e.message).split('\n')[0]}`);
      await c.end();
      process.exit(1);
    }
    const chk = await h.one(`select to_regprocedure('public.quote_fare(numeric,integer)') f, (select count(*) from information_schema.columns where table_name='booking' and column_name='fare_breakdown')::int col, (select count(*) from public.fare_matrix)::int rules`);
    console.log('after the dry run (must show nothing kept):', JSON.stringify(chk), h.skipped ? '| NOTE: the live booking simulation was skipped' : '');
    await c.end();
    return;
  }

  // ---- apply ----
  if (already.length === MIGRATIONS.length) { console.log('All three are already recorded; nothing to do.'); await c.end(); return; }
  if (already.length) { console.log('ABORT: only some Batch 5 migrations are recorded (' + already.join(', ') + '); inspect before continuing'); await c.end(); process.exit(1); }
  await checkDependencies(h);
  const applied = [];
  for (const [i, m] of MIGRATIONS.entries()) {
    console.log(`\n=== ${m.file}`);
    const sql = sqlOf(m);
    await c.query('BEGIN');
    try {
      await c.query(`SET LOCAL lock_timeout = '10s'`);
      await c.query(`SET LOCAL statement_timeout = '120s'`);
      await c.query(sql);
      console.log('  statements executed');
      if (i === 0) await verifyM1(h, pre); else if (i === 1) await verifyM2(h); else await verifyM3(h, pre);
      await c.query(`INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ($1, $2, $3) ON CONFLICT (version) DO NOTHING`, [m.version, m.name, [sql]]);
      await c.query('COMMIT');
      console.log('  COMMITTED + recorded in migration history');
      applied.push(m.version);
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      console.log(`  FAILED and rolled back: ${String(e.message).split('\n')[0]}`);
      console.log('Stopping. Migrations applied before this one stay applied: ' + JSON.stringify(applied));
      await c.end();
      process.exit(1);
    }
  }
  await c.query(`NOTIFY pgrst, 'reload schema'`);
  console.log('\nasked the API to reload its schema cache');

  console.log('\n=== AFTER (fresh read)');
  console.log('history      :', JSON.stringify(await h.q(`select version, name from supabase_migrations.schema_migrations where version >= '20261006000003' order by version`)));
  console.log('live rule    :', JSON.stringify(await h.one(`select base_fare, base_distance_km, succeeding_rate, ordinance_reference, effective_timestamp from public.fare_rule_in_force()`)));
  console.log('rows         :', JSON.stringify(await h.one(`select (select count(*) from public.fare_matrix)::int fare_matrix, (select count(*) from public.booking)::int bookings, (select count(*) from public.gps_log)::int gps_log, (select count(*) from public.fare_adjustment_history)::int fare_adjustments`)));
  await c.end();

  // What the apps do before login: the new function must be KNOWN to the API (401 permission denied), not missing (404).
  try {
    const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
    if (base && key) {
      let res, body;
      for (let t = 0; t < 6; t++) {
        await new Promise((r) => setTimeout(r, 1500));
        res = await fetch(`${base}/rest/v1/rpc/quote_fare`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_distance_km: 5, p_passenger_count: 1 }) });
        body = await res.json().catch(() => ({}));
        if (res.status !== 404) break;
      }
      console.log('API probe (no login, quote_fare):', res.status, body.code || '', String(body.message || '').slice(0, 90), res.status === 401 || res.status === 403 ? '  <- known to the API, refused without a login (as designed)' : '');
    } else console.log('API probe skipped (no SUPABASE_URL / SUPABASE_ANON_KEY in server/.env)');
  } catch (e) { console.log('API probe skipped:', String(e.message).slice(0, 80)); }
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
