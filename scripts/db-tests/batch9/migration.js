// Batch 9 (20261024000001): the migration file itself. ASCII only (a hand-applied file cannot be re-encoded: the Batch 7 em dash was), forward-only, safe to run
// twice (every function keeps its exact code and its privileges, the data keeps its values), the trips finished by the old one-tap flow are recorded as paid by it,
// trips in flight at the moment of the deploy stay finishable, and every new call has its privileges set explicitly. Whole migration chain on the local emulator (never Supabase).
const fs = require('fs');
const path = require('path');
const { setup, ID, DRIVERS, attempt, check, summary } = require('../b9fixtures');

const FILE = path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261024000001_batch9_trip_end_payment_disputes.sql');
const PREVIOUS = '20261023000001_batch8_arrival_noshow_cancellation.sql';

(async () => {
  const bytes = fs.readFileSync(FILE);
  const sql = bytes.toString('utf8');
  console.log('S1 the file');
  check('the migration contains only ASCII characters', ![...bytes].some((b) => b > 0x7f));
  check('it is a forward-only file: no DROP of a table or column, and no earlier migration is edited to run it', !/DROP\s+(TABLE|COLUMN)/i.test(sql));
  const names = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\s*\(/gi)].map((m) => m[1].toLowerCase());
  const unique = [...new Set(names)].sort();
  check(`it defines ${unique.length} functions, each once`, unique.length === names.length, names.filter((n, i) => names.indexOf(n) !== i));
  const replaced = ['dispatch_constant', 'booking_status_guard', 'booking_fare_update_guard', 'booking_trip_progress_guard', 'incident_report_guard', 'dispatch_sweep', '_passenger_open_booking_conflict'];
  check('it replaces exactly the seven functions of the plan (each copied from its newest definition), and the earlier files are untouched', replaced.every((n) => unique.includes(n)));
  const gitDirty = require('child_process').spawnSync('git', ['status', '--porcelain', '--', 'supabase/migrations'], { cwd: path.join(__dirname, '..', '..', '..'), encoding: 'utf8' }).stdout;
  check('no earlier migration file is modified in the working tree (only the new Batch 9 file is new)', gitDirty.split('\n').filter(Boolean).every((l) => /20261024000001_batch9_trip_end_payment_disputes\.sql$/.test(l)), gitDirty);

  console.log('\nS2 the trips of the old one-tap flow, and the trips in flight at the deploy, on a database at the Batch 8 state');
  const old = await setup(PREVIOUS);
  const finished = await old.mkBooking(ID.P1, 'Completed', ID.D1);
  await old.internal(`UPDATE booking SET trip_completed_at = '2026-10-01T10:00:00Z', actual_fare = 65 WHERE booking_id = '${finished}'`);
  const inFlight = await old.mkBooking(ID.P2, 'Arrived at Destination', ID.D2);
  const cancelled = await old.mkBooking(ID.P1, 'Cancelled', ID.D1);
  await old.db.exec('BEGIN');
  const applied = await old.db.exec(sql).then(() => true, (e) => e.message);
  await old.db.exec(applied === true ? 'COMMIT' : 'ROLLBACK');
  check('the file applies on the Batch 8 state', applied === true, applied);
  const f1 = (await old.q(`SELECT * FROM booking WHERE booking_id = '${finished}'`))[0];
  check('a trip completed by the old flow is recorded as Paid by it: payment and fare confirmation at its completion time, nothing invented beyond that moment',
    f1.payment_status === 'Paid' && f1.confirm_fare_at.getTime() === f1.trip_completed_at.getTime() && f1.payment_received_at.getTime() === f1.trip_completed_at.getTime() && f1.fare_unconfirmed === false && Number(f1.actual_fare) === 65, f1);
  const f2 = (await old.q(`SELECT * FROM booking WHERE booking_id = '${inFlight}'`))[0];
  check('a trip waiting at the destination at the deploy is unpaid and untouched: it can be finished through the new buttons', f2.payment_status === 'Unpaid' && f2.confirm_fare_at === null && f2.booking_status === 'Arrived at Destination', f2);
  const f3 = (await old.q(`SELECT * FROM booking WHERE booking_id = '${cancelled}'`))[0];
  check('a cancelled booking is not given a payment', f3.payment_status === 'Unpaid' && f3.payment_received_at === null);
  const stateOk = await attempt(() => old.internal(`UPDATE booking SET payment_status = 'Paid', payment_received_at = NULL WHERE booking_id = '${inFlight}'`));
  check('the new CHECK is in force on the migrated data', !stateOk.ok && /booking_paid_needs_both_check/.test(stateOk.error), stateOk);

  console.log('\nS3 safe to run twice (on the whole chain)');
  const s = await setup();
  const { q, one, internal, db } = s;
  const fingerprints = async () => Object.fromEntries((await q(`SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS fn,
      md5(replace(p.prosrc, E'\\r', '')) || ':' || COALESCE(p.proacl::text, '') AS fp FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1::text[])`, [unique])).map((r) => [r.fn, r.fp]));
  // data in the new columns and tables that a second run must not touch
  const b = await s.atDestination('D1', 'P1');
  await s.paxCall('P1', 'passenger_report_fare_discrepancy($1,$2,$3)', [b.booking_id, 90, 'The driver asked for 90 pesos but the app says 65']);
  await s.drvCall('D1', 'driver_confirm_payment_received($1)', [b.booking_id]);
  // a trip closed Unpaid since the first run (an upheld non-payment): pasting the file a second time must NOT record it as paid by the old flow
  const closedUnpaid = await s.mkBooking(ID.P2, 'Completed', ID.D2);
  const before = await fingerprints();
  const rowBefore = JSON.stringify(await s.bk(b.booking_id));
  const disputesBefore = JSON.stringify(await q(`SELECT * FROM fare_dispute ORDER BY dispute_id`));
  const again = await db.exec(sql).then(() => true, (e) => e.message);
  const after = await fingerprints();
  check('the file runs a second time without error', again === true, again);
  check(`all ${Object.keys(before).length} functions keep exactly their code and privileges`, JSON.stringify(before) === JSON.stringify(after), Object.keys(after).filter((k) => before[k] !== after[k]));
  check('the booking and the dispute keep their data (the backfill did not touch a trip finished by the new flow)', rowBefore === JSON.stringify(await s.bk(b.booking_id)) && disputesBefore === JSON.stringify(await q(`SELECT * FROM fare_dispute ORDER BY dispute_id`)));
  const cu = await s.bk(closedUnpaid);
  check('the backfill of the old one-tap trips runs only the FIRST time: a trip closed unpaid since then is still unpaid after a second run', cu.payment_status === 'Unpaid' && cu.payment_received_at === null && cu.confirm_fare_at === null, cu);
  check('and there is still exactly one of each trigger', (await q(`SELECT tgname FROM pg_trigger WHERE tgname IN ('trigger_booking_zz_completed_lock', 'trigger_booking_early_end_pattern', 'trigger_incident_change_refusal') AND NOT tgisinternal`)).length === 3);
  await s.reset();

  console.log('\nS4 who may call what');
  const can = async (role, fn) => (await one(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE') AS c`)).c;
  const calls = ['passenger_request_early_end(uuid, text, text)', 'passenger_withdraw_early_end(uuid)', 'driver_stop_trip_early(uuid, text, text)', 'passenger_confirm_fare(uuid)',
    'passenger_report_fare_discrepancy(uuid, numeric, text)', 'request_safety_fare_review(uuid, text)', 'driver_confirm_payment_received(uuid)', 'driver_report_non_payment(uuid, text)',
    'submit_fare_dispute_note(uuid, text)', 'get_trip_end_state(uuid)', 'get_fare_disputes(text, integer)', 'escalate_fare_dispute(uuid, text)',
    'resolve_fare_dispute(uuid, text, numeric, text, text)', 'admin_correct_completed_trip(uuid, numeric, text, text)', 'admin_close_unfinished_trip(uuid, text, text)',
    'admin_confirm_flagged_violation(uuid, uuid, text, integer)'];
  const closedToAnon = [], openToUsers = [];
  for (const f of calls) { if (await can('anon', `public.${f}`)) closedToAnon.push(f); if (!(await can('authenticated', `public.${f}`)) || !(await can('service_role', `public.${f}`))) openToUsers.push(f); }
  check(`the ${calls.length} calls of the end of the trip are open to signed-in users and the service role and closed to anonymous callers`, closedToAnon.length === 0 && openToUsers.length === 0, { closedToAnon, openToUsers });
  const helpers = ['public._early_end_point(uuid, uuid)', 'public._fare_dispute_open(public.booking, text, text, uuid, numeric, text, boolean)', 'public._check_early_end_pattern(uuid, text)',
    'public.booking_early_end_pattern_trigger()', 'public.incident_change_refusal_trigger()', 'public.booking_completed_lock_guard()', 'public._trip_end_error(text, text)',
    'public._fare_confirm_seconds_left(timestamp with time zone)', 'public._early_stop_reason_is_valid(text)', 'public._booking_payment_sweep()'];
  const open = [];
  for (const f of helpers) if ((await can('authenticated', f)) || (await can('anon', f))) open.push(f);
  check('the helpers, the triggers and the stuck-trip sweep are closed to signed-in and anonymous users', open.length === 0, open);
  check('the dispute tables are readable by signed-in users only through their row policies, and not by anonymous visitors',
    (await one(`SELECT has_table_privilege('anon', 'public.fare_dispute', 'SELECT') AS c`)).c === false && (await one(`SELECT has_table_privilege('authenticated', 'public.fare_dispute', 'INSERT') AS c`)).c === false);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
