// Prints ONE read-only SQL query for the Supabase SQL editor: it answers "is the dispatch code on the hosted project exactly what the repository says?".
//
//   node scripts/dispatchFingerprintCheck.js [first migration prefix]        (default 20261015: the first Batch 6 migration; it also covers Batch 7's
//                                                                              20261021000001, which replaces dispatch_constant, booking_identity_guard, booking_timers_sweep,
//                                                                              driver_report_delay, booking_status_guard and strike_on_passenger_cancellation, and adds the
//                                                                              connectivity / reconciliation functions; and Batch 8's 20261023000001, which replaces
//                                                                              dispatch_constant, the two guards, the sweeps, the arrival / no-show / cancellation functions
//                                                                              and adds the cancellation decision, the pickup change and the first-name check; and Batch 9's
//                                                                              20261024000001, which replaces dispatch_constant, the booking status / fare / progress guards,
//                                                                              the incident guard, dispatch_sweep and the open-booking check, and adds the trip-end, payment,
//                                                                              fare-dispute and completed-trip functions; and Batch 10's 20261025000001, which replaces
//                                                                              _dispatch_advance, dispatch_sweep, booking_identity_guard, booking_fare_update_guard,
//                                                                              admin_confirm_flagged_violation, _trip_track_summary (two optional arguments), the cancellation
//                                                                              hook, block_driver_double_booking and _log_trip_fix, and adds the ride-sharing matching,
//                                                                              approvals, disclosure, settlement and passenger-count functions; and Batch 11's 20261026000001,
//                                                                              which replaces issue_strike, admin_reinstate_account, admin_confirm_flagged_violation,
//                                                                              _cancellation_decision, driver_cancel_booking, driver_stop_trip_early, passenger_request_early_end,
//                                                                              driver_report_delay, set_strike_accrual_pause, check_toda_excess_incidents, incident_report_guard
//                                                                              and _early_stop_reason_is_valid, and adds the incident review, urgent safety report, safe-reason,
//                                                                              end-trip-for-safety, calamity and Share Live Trip functions; and Batch 12's 20261027000001,
//                                                                              which replaces driver_insert_guard, audit_log_stamp_actor, return_toda_accreditation,
//                                                                              deactivate_toda_accreditation, storage_can_read_driver_folder, _incident_category_class and
//                                                                              _incident_strike_options, drops update_driver_rating, and adds the rating summary / cache /
//                                                                              exclusion, the append-only audit log, get_audit_log / record_audit_export, the legal hold and
//                                                                              retention jobs, the integrity detectors and the privacy acceptance functions: 213 functions in 18 files)
//
// How it works: the whole migration chain is built on the local emulator (PGlite, never Supabase), every function that those migrations define or
// replace is fingerprinted (md5 of its body, line endings ignored), and the fingerprints are written INTO the query. Run on the hosted project, the
// query gives one row: "N of N ... are exactly the repository's code", and the name of every function that differs or is missing. A migration file
// that was changed after it was applied does not run again (that happened to 20261019000001), so this is how such drift is found.
// Regenerate it after any migration: the fingerprints are only valid for the repository state they were made from.
const fs = require('fs');
const path = require('path');
const { setup } = require('./db-tests/b6fixtures');

const MIGRATIONS = path.join(__dirname, '..', 'supabase', 'migrations');
const FROM = process.argv[2] || '20261015';

(async () => {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && f.slice(0, FROM.length) >= FROM).sort();
  const names = new Set();
  for (const f of files) {
    const src = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
    for (const m of src.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\s*\(/gi)) names.add(m[1].toLowerCase());
  }
  const list = [...names].sort();

  const s = await setup();
  const { rows } = await s.db.query(`
    SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS fn, md5(replace(p.prosrc, E'\\r', '')) AS fingerprint
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1::text[])
     ORDER BY 1`, [list]);

  const lit = (t) => t.replace(/'/g, "''");
  console.log(`-- ${rows.length} functions defined by the migrations from ${FROM} on (${files.length} files). Read-only. Paste into the Supabase SQL editor.`);
  console.log(`with expected(fn, fingerprint) as (values\n${rows.map((r) => `    ('${lit(r.fn)}', '${r.fingerprint}')`).join(',\n')}\n), actual as (
  select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn,
         md5(replace(p.prosrc, E'\\r', '')) as fingerprint
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
)
select count(*) filter (where a.fingerprint = e.fingerprint) || ' of ' || count(*) || ' functions are exactly the repository''s code' as summary,
       coalesce(string_agg(e.fn || case when a.fn is null then '  [missing]' else '  [differs]' end, E'\\n') filter (where a.fingerprint is distinct from e.fingerprint), 'none differ') as differences
  from expected e
  left join actual a on a.fn = e.fn;`);
  process.exit(0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
