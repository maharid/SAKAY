// Batch 10: the file itself (supabase/migrations/20261025000001_batch10_ride_sharing.sql). Forward-only, ASCII only, safe to run twice, every new call has its privileges, and a project
// that has Batch 9 as it was applied is brought forward by this file alone (a trip in flight at the deploy keeps working).
const fs = require('fs');
const path = require('path');
const { setup, ID, check, summary } = require('../b10fixtures');

const FILE = path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261025000001_batch10_ride_sharing.sql');

(async () => {
  const raw = fs.readFileSync(FILE);
  const sql = raw.toString('utf8');

  console.log('S1 the file');
  const nonAscii = [...sql].findIndex((c) => c.charCodeAt(0) > 126 || (c.charCodeAt(0) < 32 && c !== '\n' && c !== '\t'));
  check('pure ASCII (the hosted editor and the migration runner read bytes, not intentions; a damaged dash broke a notice title once)', nonAscii < 0, nonAscii);
  check('LF line endings, ends with a newline', !sql.includes('\r') && sql.endsWith('\n'));
  check('forward-only: it drops nothing but the old three-argument track replay it replaces', [...sql.matchAll(/^\s*DROP\s+(TABLE|COLUMN|FUNCTION|INDEX|CONSTRAINT|TYPE|SCHEMA)\b[^;]*;/gim)].every((m) => /DROP FUNCTION IF EXISTS public\._trip_track_summary\(UUID, DOUBLE PRECISION, DOUBLE PRECISION\)/.test(m[0])), [...sql.matchAll(/^\s*DROP\s+(TABLE|COLUMN|FUNCTION|INDEX|CONSTRAINT|TYPE|SCHEMA)\b[^;]*;/gim)].map((m) => m[0]));
  check('no DELETE or TRUNCATE of data', !/^\s*(DELETE\s+FROM|TRUNCATE)\b/im.test(sql));
  check('every function is SECURITY DEFINER with a pinned search_path unless it is a pure helper', [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\([\s\S]*?\n(?:\$\$|\$fn\$)(?:\s+LANGUAGE[^\n]*)?;/g)].length > 20);

  // on the chain up to this migration: a later batch replaces some of its functions (Batch 11: admin_confirm_flagged_violation), and running this file again would put the old ones back
  const s = await setup('20261025000001_batch10_ride_sharing.sql');
  const { q, one, internal, db } = s;

  console.log('\nS2 it runs twice on the same database without changing a function, a privilege or the data');
  const names = [...new Set([...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\s*\(/gi)].map((m) => m[1].toLowerCase()))];
  const fingerprint = async () => q(`SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS fn, md5(replace(p.prosrc, E'\\r', '')) AS fp,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1::text[]) ORDER BY 1`, [names]);
  const before = await fingerprint();
  // data that must survive: a Shared Trip with a proposal, and a count report
  const A = await s.host();
  const { b: B, m } = await s.propose();
  await s.driverAnswer('D1', m.match_id, true);
  const counts = async () => ({ match: (await one(`SELECT count(*)::int n FROM shared_trip_match`)).n, report: (await one(`SELECT count(*)::int n FROM passenger_count_report`)).n, booking: (await one(`SELECT count(*)::int n FROM booking`)).n });
  const c1 = await counts();
  let again = null;
  try { await db.exec(sql); } catch (e) { again = e.message; }
  check('the whole file runs a second time without an error (its self-check included)', again === null, again);
  const after = await fingerprint();
  check(`${before.length} functions: none changed (same body, same privileges)`, before.length >= 25 && JSON.stringify(before) === JSON.stringify(after), before.filter((b, i) => JSON.stringify(b) !== JSON.stringify(after[i])));
  check('no row was added, lost or changed by the second run', JSON.stringify(await counts()) === JSON.stringify(c1));
  check('the open proposal still stands (the pairing is not reset by a deploy)', (await s.match(m.match_id)).match_status === 'Awaiting Passenger');
  const r = await s.paxAnswer('P1', m.match_id, true);
  check('...and it can still be agreed after the second run', r.success === true && (await s.bk(B.booking_id)).driver_id === ID.D1, r);
  await s.reset();

  console.log('\nS3 privileges: the apps call five functions; everything else is the database\'s');
  const exec = async (sig, role) => (await one(`SELECT has_function_privilege('${role}', '${sig}'::regprocedure, 'EXECUTE') AS v`)).v;
  const RPCS = ['public.get_my_shared_request()', 'public.driver_respond_shared_request(uuid, boolean)', 'public.passenger_respond_shared_match(uuid, boolean)', 'public.get_shared_match_state(uuid)', 'public.driver_report_passenger_count(uuid, integer, text)'];
  for (const sig of RPCS) check(`${sig}: signed-in users yes, anonymous no`, (await exec(sig, 'authenticated')) === true && (await exec(sig, 'anon')) === false);
  const INTERNAL = [
    'public._shared_try_propose(uuid)', 'public._shared_best_host(uuid)', 'public._shared_close_match(uuid, text, boolean)', 'public._shared_proposal_blocks(uuid)', 'public._shared_release_booking(uuid)',
    'public.shared_match_sweep()', 'public._shared_decline_flag(uuid)', 'public._trip_odometer_km(uuid, uuid, timestamptz)', 'public.shared_trip_constant(text)', 'public.calapan_barangays()',
    'public._area_of_address(text)', 'public._bearing_deg(double precision, double precision, double precision, double precision)', 'public._compass_8(double precision)',
    'public._shared_road_m(double precision, double precision, double precision, double precision)', 'public.shared_trip_match_guard()', 'public.booking_shared_release_on_driver_loss()',
    'public._shared_leg_fare(public.booking, numeric, numeric, numeric, numeric, integer, timestamptz)', 'public._trip_track_summary(uuid, double precision, double precision, timestamptz, uuid)',
  ];
  for (const sig of INTERNAL) check(`${sig}: no signed-in user and no anonymous caller`, (await exec(sig, 'authenticated')) === false && (await exec(sig, 'anon')) === false);
  check('the old three-argument track replay is gone (one replay, not two)', (await q(`SELECT 1 FROM pg_proc p WHERE p.proname = '_trip_track_summary' AND p.pronargs = 3`)).length === 0);
  const sweepAuth = await one(`SELECT has_function_privilege('authenticated', 'public.dispatch_sweep()'::regprocedure, 'EXECUTE') AS v`);
  check('dispatch_sweep() keeps its privileges (the service role only)', sweepAuth.v === false);

  console.log('\nS4 the tables');
  const idx = (await q(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('shared_trip_match', 'booking')`)).map((x) => x.indexname);
  check('one open pairing per booking is an INDEX (the database refuses a repeat even if a function forgot)', idx.includes('uq_shared_match_open_primary') && idx.includes('uq_shared_match_open_additional'));
  check('the status vocabulary is a CHECK', (await q(`SELECT 1 FROM pg_constraint WHERE conname IN ('shared_trip_match_status_check', 'shared_trip_match_driver_response_check', 'shared_trip_match_first_response_check')`)).length === 3);
  check('the report table has row-level security and no write policy', (await one(`SELECT relrowsecurity AS v FROM pg_class WHERE relname = 'passenger_count_report'`)).v === true
    && (await q(`SELECT 1 FROM pg_policies WHERE tablename = 'passenger_count_report' AND cmd <> 'SELECT'`)).length === 0);
  check('the pairing table\'s only policy is the administrators\' read', (await q(`SELECT policyname FROM pg_policies WHERE tablename = 'shared_trip_match'`)).map((x) => x.policyname).join() === 'shared_trip_match_select_admin' || (await q(`SELECT policyname, cmd FROM pg_policies WHERE tablename = 'shared_trip_match'`)).every((x) => x.cmd === 'SELECT' || x.cmd === 'DELETE'),
    await q(`SELECT policyname, cmd FROM pg_policies WHERE tablename = 'shared_trip_match'`));

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
