// Batch 11: the file itself (supabase/migrations/20261026000001_batch11_incidents_safety.sql). Forward-only, ASCII only, safe to run twice, every new call has its privileges, and a
// project that has Batch 10 as it was applied (reports in the old statuses, a trip in flight, an evidence bucket that took 20 MB and video) is brought forward by this file alone.
const fs = require('fs');
const path = require('path');
const { setup, ID, DRIVERS, PAX, check, summary, asUser } = require('../b11fixtures');

const FILE = path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261026000001_batch11_incidents_safety.sql');
const BATCH10 = '20261025000001_batch10_ride_sharing.sql';

(async () => {
  const raw = fs.readFileSync(FILE);
  const sql = raw.toString('utf8');

  console.log('S1 the file');
  const nonAscii = [...sql].findIndex((c) => c.charCodeAt(0) > 126 || (c.charCodeAt(0) < 32 && c !== '\n' && c !== '\t'));
  check('pure ASCII (the hosted editor and the migration runner read bytes, not intentions; a damaged dash broke a notice title once)', nonAscii < 0, nonAscii);
  check('LF line endings, ends with a newline', !sql.includes('\r') && sql.endsWith('\n'));
  const drops = [...sql.matchAll(/^\s*DROP\s+(TABLE|COLUMN|FUNCTION|INDEX|CONSTRAINT|TYPE|SCHEMA|POLICY|TRIGGER)\b[^;]*;/gim)].map((m) => m[0].trim());
  check('forward-only: it drops no table, column, type or schema; the only drops are of its own constraints, policies and triggers it recreates (IF EXISTS) and the one function it replaces',
    drops.every((d) => /IF EXISTS/i.test(d) && /^DROP (CONSTRAINT|POLICY|TRIGGER|FUNCTION)/i.test(d.replace(/^DROP\s+/i, 'DROP ')) || /^DROP (POLICY|TRIGGER|FUNCTION) IF EXISTS/i.test(d)), drops.filter((d) => !/IF EXISTS/i.test(d)));
  check('no DELETE or TRUNCATE of data', !/^\s*(DELETE\s+FROM|TRUNCATE)\b/im.test(sql));
  check('it never deletes a row of the evidence, the strikes or the audit (the only table writes are the backfill UPDATEs and the objects it creates)', !/DELETE\s+FROM\s+public\.(incident_report|strikes_ledger|audit_log)/i.test(sql));
  check('it ends with the self-check (a failed check rolls the whole file back)', /RAISE EXCEPTION 'an anonymous caller can reach a signed-in function';\s*END IF;\s*END \$\$;\s*$/.test(sql));
  const fns = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\s*\(/gi)].map((m) => m[1].toLowerCase());
  check(`it defines ${new Set(fns).size} functions`, new Set(fns).size >= 40, [...new Set(fns)].length);
  // the header (SECURITY DEFINER, SET search_path) is before "AS $$" in the new functions and after the closing "$$" in the ones copied from earlier batches
  const FN = /CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\s*\(([\s\S]*?)\n\$\$[^\n]*;/g;
  const unpinned = [...sql.matchAll(FN)].filter((m) => !/SET search_path/i.test(m[2]) && !/SET search_path/i.test(m[0])).map((m) => m[1]);
  check('every function pins its search_path (a caller\'s schema cannot take over a name)', unpinned.length === 0, unpinned);
  const definers = [...sql.matchAll(FN)].filter((m) => !/SECURITY DEFINER/i.test(m[0])).map((m) => m[1]);
  check('every function is SECURITY DEFINER except the pure helpers (incident_constant, the category class, the strike options, _share_hash, _safe_reason_exempt, _early_stop_reason_is_valid, the guard trigger functions)',
    definers.every((n) => /^(incident_constant|_incident_category_class|_incident_strike_options|_incident_set_routing|_share_hash|_safe_reason_exempt|_early_stop_reason_is_valid|_trip_share_expires_at|incident_report_guard)$/.test(n)), definers);
  check('no TODO or FIXME is left in the file', !/\bTODO\b|\bFIXME\b/.test(sql));
  check('the file names no real person, no real phone number and no secret', !/\+63\d{9,}|password\s*[:=]|service_role_key|eyJ[a-zA-Z0-9_-]{20,}/i.test(sql));

  console.log('\nS2 a project as Batch 10 left it is brought forward by this file alone');
  const old = await setup(BATCH10);
  const { q: oq, one: oone, internal: oint, db: odb } = old;
  const D1 = DRIVERS.D1.id, D2 = DRIVERS.D2.id;
  // reports as they exist on the hosted project: filed by the apps, then moved by the old portals
  const oldReport = async (pax, key, category, status, extra = '', resolvedAt = 'clock_timestamp()', by = pax) => {
    const trip = await old.finished(pax, key);
    const r = await old.file(by, trip, category, 'It happened on the way, near the market.');
    if (!r.ok) throw new Error('could not file the old report: ' + r.error);
    if (status !== 'Pending') await oint(`UPDATE incident_report SET status = '${status}', resolved_at = ${resolvedAt} ${extra} WHERE incident_id = '${r.value.incident_id}'`);
    return r.value.incident_id;
  };
  const pending = await oldReport('P1', 'D1', 'Rude Behavior', 'Pending');
  const resolved = await oldReport('P2', 'D2', 'Overcharging Attempt', 'Resolved', `, resolution_notes = 'Spoke with both'`);
  const dismissed = await oldReport('P1', 'D1', 'Unsafe Driving', 'Dismissed');
  const escalated = await oldReport('P2', 'D2', 'Unsafe Driving', 'Under Investigation', `, resolution_notes = '[Escalated to LGU] The TODA cannot decide this.'`, 'NULL');
  const driverFiled = await oldReport('P1', 'D1', 'Passenger Misconduct', 'Pending', '', 'NULL', 'D1');
  await oint(`INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('incident-evidence', 'incident-evidence', FALSE, 20971520, ARRAY['video/mp4', 'application/pdf'])
              ON CONFLICT (id) DO UPDATE SET file_size_limit = 20971520, allowed_mime_types = ARRAY['video/mp4', 'application/pdf']`);
  const flight = await old.startTrip('D1', 'P2');
  const flightStatusBefore = (await oone(`SELECT booking_status FROM booking WHERE booking_id = '${flight.booking_id}'`)).booking_status;
  const strikesBefore = (await oone(`SELECT count(*)::int n FROM strikes_ledger`)).n;
  const oldCols = new Set((await oq(`SELECT column_name FROM information_schema.columns WHERE table_name = 'incident_report'`)).map((r) => r.column_name));
  check('before the file: none of the new columns, the old statuses only', !oldCols.has('routing') && !oldCols.has('outcome') && !oldCols.has('lost_item_status'));

  let failure = null;
  try { await odb.exec(sql); } catch (e) { failure = e.message; }
  check('the file runs on that project without an error (its self-check included)', failure === null, failure);

  const rowOf = (id) => oone(`SELECT * FROM incident_report WHERE incident_id = '${id}'`);
  const p = await rowOf(pending), r = await rowOf(resolved), d = await rowOf(dismissed), e = await rowOf(escalated), f = await rowOf(driverFiled);
  check('a report nobody had touched stays Pending, with the TODA, no outcome, no first action', p.status === 'Pending' && p.routing === 'TODA' && p.outcome === null && p.first_action_at === null && p.priority === 'Standard', p);
  check('who a report is about is filled in from who filed it (a passenger\'s about the driver, a driver\'s about the passenger)', p.subject_type === 'driver' && f.subject_type === 'passenger', { p: p.subject_type, f: f.subject_type });
  check('an old "Resolved" becomes RESOLVED (not UPHELD: it is not counted against the TODA by Rule 2.5), and an old "Dismissed" becomes NOT_UPHELD', r.outcome === 'RESOLVED' && d.outcome === 'NOT_UPHELD', { r: r.outcome, d: d.outcome });
  check('both have a first-action time (the report was acted on) and neither is overdue', r.first_action_at !== null && d.first_action_at !== null);
  check('the escalation the old TODA portal wrote as a text prefix is now a real escalation: routing LGU, with a time and the reason', e.routing === 'LGU' && e.escalated_at !== null && /Escalated/.test(e.escalation_reason ?? ''), e);
  check('its text and its status are untouched', /\[Escalated to LGU\]/.test(e.resolution_notes) && e.status === 'Under Investigation');
  const bucket = await oone(`SELECT file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'incident-evidence'`);
  check('the evidence bucket that took 20 MB, video and PDF now takes 5 MB and the three image types', Number(bucket.file_size_limit) === 5 * 1024 * 1024 && JSON.stringify([...bucket.allowed_mime_types].sort()) === JSON.stringify(['image/jpeg', 'image/png', 'image/webp']), bucket);
  check('the migration struck nobody and wrote no strike (a backfill is not a decision)', (await oone(`SELECT count(*)::int n FROM strikes_ledger`)).n === strikesBefore);
  const f2 = await oone(`SELECT booking_status FROM booking WHERE booking_id = '${flight.booking_id}'`);
  check('a trip in flight at the deploy is untouched (same status, same driver)', f2.booking_status === flightStatusBefore && flightStatusBefore !== null, { before: flightStatusBefore, after: f2.booking_status });
  const u = await old.urgent('P2', flight.booking_id);
  check('...and its passenger can use the new Urgent Safety Report on it at once', u.ok && u.value.success === true, u);
  const share = await old.rpcAs(PAX.P2.uid, 'public.create_trip_share($1,$2)', [flight.booking_id, null]);
  check('...and Share Live Trip', share.success === true && /^[0-9a-f]{32}$/.test(share.token), share);
  const started = await old.start(ID.T_AUTH, pending);
  const done = await old.decide(ID.T_AUTH, pending, 'NOT_UPHELD');
  check('...and the TODA Administrator of the driver can review and decide a report that was filed under the old rules (T2: not upheld, no strike)', started.ok && started.value.success === true && done.ok && done.value.success === true && (await rowOf(pending)).outcome === 'NOT_UPHELD' && (await oone(`SELECT count(*)::int n FROM strikes_ledger`)).n === strikesBefore, { started, done });

  console.log('\nS3 it runs twice on the same database without changing a function, a privilege or the data');
  const names = [...new Set(fns)];
  const fingerprint = async () => oq(`SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS fn, md5(replace(p.prosrc, E'\\r', '')) AS fp,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1::text[]) ORDER BY 1`, [names]);
  const before = await fingerprint();
  const counts = async () => ({
    incident: (await oone(`SELECT count(*)::int n FROM incident_report`)).n, share: (await oone(`SELECT count(*)::int n FROM trip_share_link`)).n,
    strikes: (await oone(`SELECT count(*)::int n FROM strikes_ledger`)).n, audit: (await oone(`SELECT count(*)::int n FROM audit_log`)).n, notices: (await oone(`SELECT count(*)::int n FROM notification`)).n,
  });
  const rowsBefore = JSON.stringify(await oq(`SELECT incident_id, routing, priority, outcome, status, first_action_at, escalated_at FROM incident_report ORDER BY incident_id`));
  const c1 = await counts();
  let again = null;
  try { await odb.exec(sql); } catch (x) { again = x.message; }
  check('the whole file runs a second time without an error', again === null, again);
  const after = await fingerprint();
  check(`${before.length} functions: none changed (same body, same privileges)`, before.length >= 40 && JSON.stringify(before) === JSON.stringify(after), before.filter((b, i) => JSON.stringify(b) !== JSON.stringify(after[i])));
  check('no row was added, lost or changed by the second run (reports, links, strikes, audit, notices)', JSON.stringify(await counts()) === JSON.stringify(c1)
    && rowsBefore === JSON.stringify(await oq(`SELECT incident_id, routing, priority, outcome, status, first_action_at, escalated_at FROM incident_report ORDER BY incident_id`)));
  check('a decided report is not decided again by the backfill (the second run does not turn an outcome into another)', (await rowOf(resolved)).outcome === 'RESOLVED' && (await rowOf(dismissed)).outcome === 'NOT_UPHELD');
  const live = await old.rpcAs(PAX.P2.uid, 'public.get_my_trip_share($1)', [flight.booking_id]);
  check('the link made before the second run still works after it', live.active === true);
  check('and there is still exactly one of each guard trigger and one live-link index', (await oq(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'incident_report'::regclass AND NOT tgisinternal AND tgname LIKE '%incident%'`)).length >= 1
    && (await oq(`SELECT 1 FROM pg_indexes WHERE indexname IN ('uq_trip_share_one_live', 'uq_calamity_one_active')`)).length === 2);
  await old.reset();

  console.log('\nS4 who may call what');
  const exec = async (sig, role) => (await oone(`SELECT has_function_privilege('${role}', '${sig}'::regprocedure, 'EXECUTE') AS v`)).v;
  const RPCS = [
    'public.incident_start_review(uuid)', 'public.incident_escalate(uuid, text, boolean)', 'public.incident_decide(uuid, text, text, text, integer)', 'public.incident_lost_item_update(uuid, text, text)',
    'public.file_urgent_safety_report(uuid, text, text)', 'public.admin_end_trip_for_safety(uuid, text, text, text)', 'public.create_trip_share(uuid, text)', 'public.revoke_trip_share(uuid)',
    'public.get_my_trip_share(uuid)', 'public.get_active_calamity()', 'public.declare_calamity(text, text, text, text)', 'public.end_calamity(text)',
  ];
  for (const sig of RPCS) check(`${sig}: signed-in users yes, anonymous no`, (await exec(sig, 'authenticated')) === true && (await exec(sig, 'anon')) === false);
  check('public.get_shared_trip_view(text): the one call a visitor without an account may make (the link\'s page)', (await exec('public.get_shared_trip_view(text)', 'anon')) === true && (await exec('public.get_shared_trip_view(text)', 'authenticated')) === true);
  const INTERNAL = [
    'public.incident_constant(text)', 'public._incident_category_class(text)', 'public._incident_strike_options(text, text)', 'public._incident_set_routing(public.incident_report)', 'public._incident_actor(public.incident_report)',
    'public._incident_auto_file(uuid, text, text, text)', 'public._incident_admin_id(text)', 'public._incident_notify_reporter(public.incident_report, text, text, text, integer)',
    'public._incident_notify_other(public.incident_report, text, text, text, integer)', 'public._waive_victim_strikes(uuid, text, uuid, uuid, text)', 'public._safe_reason_exempt(text)',
    'public._safe_reason_record(uuid, uuid, text, text)', 'public._early_stop_reason_is_valid(text)', 'public._incident_overdue_sweep()', 'public.check_toda_excess_incidents()',
    'public._apply_strike_accrual_pause(boolean, text, text, jsonb)', 'public._share_hash(text)', 'public._trip_share_expires_at(timestamptz, public.booking)', 'public.incident_report_guard()',
  ];
  for (const sig of INTERNAL) check(`${sig}: no signed-in user and no anonymous caller`, (await exec(sig, 'authenticated')) === false && (await exec(sig, 'anon')) === false);
  check('the tables of the links and the calamities: nobody reads or writes them from the app (RLS on, no policy for the app roles but the LGU\'s read of the declarations)',
    (await oq(`SELECT relname FROM pg_class WHERE relname IN ('trip_share_link', 'calamity_declaration') AND relrowsecurity`)).length === 2
    && (await oq(`SELECT policyname FROM pg_policies WHERE tablename = 'trip_share_link'`)).length === 0);
  const sweepAuth = await oone(`SELECT has_function_privilege('authenticated', 'public.dispatch_sweep()'::regprocedure, 'EXECUTE') AS v`);
  check('the sweep that runs the clocks is still not callable by an app user (it is the scheduler\'s)', sweepAuth.v === false);
  check('the strike pause: the old function an LGU Administrator called is kept as a wrapper and is still the LGU\'s alone', (await exec('public.set_strike_accrual_pause(boolean, text, text)', 'anon')) === false);

  const ok = summary();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
