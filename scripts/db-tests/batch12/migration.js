// Batch 12: the migration itself. It runs twice without harm; it turns the old defaults into "Not Yet Rated" and recomputes every average from the rating rows (the backfill);
// the old rating trigger, the LGU's audit write policy and the client rating updates are gone; every new function has exactly the privileges it should; the figures are the approved
// ones; the self-check at the end of the file is itself part of the proof. Whole migration chain on the local emulator.
const { setup, ID, DRIVERS, PAX, attempt, check, summary } = require('../b12fixtures');

(async () => {
  console.log('S1 the backfill: the chain up to Batch 11, then Batch 12 on a database that already has drivers and ratings');
  const s = await setup('20261026000001_batch11_incidents_safety.sql');
  const { q, one, internal, db } = s;
  const D1 = DRIVERS.D1.id, D2 = DRIVERS.D2.id, D3 = DRIVERS.D3.id, P1 = PAX.P1.id;
  const pre = await one(`SELECT weighted_average_rating AS a FROM driver WHERE driver_id = '${D2}'`);
  check('before Batch 12 a driver with no ratings reads 4.00 (the old default) - the defect', Number(pre.a) === 4, pre);
  const t1 = await s.finished('P1', 'D1'), t2 = await s.finished('P2', 'D1'), t3 = await s.finished('P1', 'D3', { status: 'Arrived at Destination' });
  await internal(`INSERT INTO rating (booking_id, rater_id, ratee_id, rater_role, stars) VALUES
      ('${t1}', '${P1}', '${D1}', 'Passenger', 2), ('${t2}', '${PAX.P2.id}', '${D1}', 'Passenger', 5), ('${t3}', '${P1}', '${D3}', 'Passenger', 1),
      ('${t1}', '${D1}', '${P1}', 'Driver', 3)`);
  const sql = s.migrationSql();
  check('the migration file is pure ASCII and has no tab or control characters', !/[^\x09\x0A\x20-\x7E]/.test(sql) && !/\r/.test(sql));
  const ap = await attempt(() => db.exec(sql));
  check('Batch 12 applies on top of Batch 11 with data in the tables (its own self-check passes)', ap.ok, ap);
  let d = await one(`SELECT weighted_average_rating AS a, rating_count AS n FROM driver WHERE driver_id = '${D1}'`);
  check('the driver with ratings 2 and 5 now has the TRUE mean 3.50 from 2 ratings (recomputed from the rows)', Number(d.a) === 3.5 && Number(d.n) === 2, d);
  d = await one(`SELECT weighted_average_rating AS a, rating_count AS n FROM driver WHERE driver_id = '${D2}'`);
  check('the driver with no rating is "Not Yet Rated" (NULL, 0), no longer 4.00', d.a === null && Number(d.n) === 0, d);
  d = await one(`SELECT weighted_average_rating AS a, rating_count AS n FROM driver WHERE driver_id = '${D3}'`);
  check('a rating on a trip that has only arrived does not count: NULL, 0', d.a === null && Number(d.n) === 0, d);
  const p = await one(`SELECT average_rating AS a, rating_count AS n FROM passenger WHERE passenger_id = '${P1}'`);
  check('the passenger the driver rated 3 has the mean 3.00 from 1 rating', Number(p.a) === 3 && Number(p.n) === 1, p);
  const viewCols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'driver_rating'`)).map((c) => c.column_name);
  check('the driver_rating view (the LGU feedback page) now carries is_excluded and excluded_at, and kept every column it had', ['rating_id', 'booking_id', 'passenger_id', 'driver_id', 'stars', 'tags', 'comment', 'created_at', 'passenger_name', 'passenger_contact', 'driver_name', 'driver_contact', 'plate_number', 'toda_id', 'toda_name', 'toda_acronym', 'is_excluded', 'excluded_at'].every((c) => viewCols.includes(c)), viewCols);
  const target = await one(`SELECT rating_id FROM rating WHERE booking_id = '${t1}' AND rater_role = 'Passenger'`);
  const viewRead = async () => (await s.as(ID.L_AUTH, (tx) => tx.query(`SELECT is_excluded FROM public.driver_rating WHERE rating_id = $1`, [target.rating_id]))).rows[0];
  const exr = await attempt(() => s.rpcAs(ID.L_AUTH, 'public.admin_exclude_rating($1, TRUE, $2)', [target.rating_id, 'Test: a rating left out of the mean.']));
  const whileExcluded = await viewRead();
  const back = await attempt(() => s.rpcAs(ID.L_AUTH, 'public.admin_exclude_rating($1, FALSE, $2)', [target.rating_id, 'Test: counted again after review.']));
  const afterBack = await viewRead();
  check('an excluded rating reads is_excluded = true through the view, as the LGU page needs (and false once counted again)', exr.ok && back.ok && whileExcluded.is_excluded === true && afterBack.is_excluded === false, { whileExcluded, afterBack });

  console.log('\nS2 it can run twice');
  const before = {
    triggers: Number((await one(`SELECT count(*)::int n FROM pg_trigger WHERE NOT tgisinternal`)).n),
    policies: Number((await one(`SELECT count(*)::int n FROM pg_policies`)).n),
    catalog: Number((await one(`SELECT count(*)::int n FROM violation_catalog`)).n),
    functions: Number((await one(`SELECT count(*)::int n FROM pg_proc WHERE pronamespace = 'public'::regnamespace`)).n),
    audit: Number((await one(`SELECT count(*)::int n FROM audit_log`)).n),
  };
  const again = await attempt(() => db.exec(sql));
  const afterRun = {
    triggers: Number((await one(`SELECT count(*)::int n FROM pg_trigger WHERE NOT tgisinternal`)).n),
    policies: Number((await one(`SELECT count(*)::int n FROM pg_policies`)).n),
    catalog: Number((await one(`SELECT count(*)::int n FROM violation_catalog`)).n),
    functions: Number((await one(`SELECT count(*)::int n FROM pg_proc WHERE pronamespace = 'public'::regnamespace`)).n),
    audit: Number((await one(`SELECT count(*)::int n FROM audit_log`)).n),
  };
  check('a second run succeeds and adds no trigger, policy, function, catalog row or audit entry', again.ok && JSON.stringify(before) === JSON.stringify(afterRun), { again: again.error, before, afterRun });
  d = await one(`SELECT weighted_average_rating AS a, rating_count AS n FROM driver WHERE driver_id = '${D1}'`);
  check('...and the averages are the same', Number(d.a) === 3.5 && Number(d.n) === 2, d);

  console.log('\nS3 what is gone and what is there');
  check('the old rating trigger and its function are gone', (await q(`SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_update_driver_rating'`)).length === 0 && (await q(`SELECT 1 FROM pg_proc WHERE proname = 'update_driver_rating'`)).length === 0);
  check('the rating UPDATE / DELETE policies and the LGU\'s audit-log write policy are gone', (await q(`SELECT 1 FROM pg_policies WHERE policyname IN ('rating_update_policy', 'rating_delete_policy', 'audit_log_manage_lgu')`)).length === 0);
  const trg = (await q(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.rating'::regclass, 'public.audit_log'::regclass) ORDER BY 1`)).map((x) => x.tgname);
  check('the rating has its guard and its refresh, the audit log its append-only, no-truncate and stamp triggers', ['trigger_rating_after_change', 'trigger_rating_guard', 'trigger_audit_log_append_only', 'trigger_audit_log_no_truncate', 'trigger_audit_log_stamp_actor'].every((t) => trg.includes(t)), trg);
  const priv = async (fn, role) => (await one(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE') AS x`)).x;
  const internalFns = ['public.rating_summary(text,uuid)', 'public._refresh_rating_cache(text,uuid)', 'public._rating_review_check(text,uuid)', 'public._set_rating_excluded(uuid,boolean,text)', 'public._booking_is_held(uuid)',
    'public._subject_is_held(text,uuid)', 'public._integrity_flag(text,text,text,text,jsonb,text)', 'public._integrity_gps_sweep()', 'public._integrity_rating_sweep()', 'public._integrity_collusion_sweep()',
    'public._integrity_rereg_sweep()', 'public.integrity_constant(text)', 'public.retention_constant(text)', 'public.audit_log_append_only()', 'public.rating_guard()'];
  const results = [];
  for (const fn of internalFns) results.push([fn, await priv(fn, 'authenticated'), await priv(fn, 'anon')]);
  check('the internal functions are closed to signed-in users and visitors', results.every(([, u, a]) => !u && !a), results.filter(([, u, a]) => u || a));
  const jobFns = ['public.run_integrity_sweep()', 'public.run_retention_job()', 'public.purge_expired_gps_logs()', 'public.purge_expired_sessions()', 'public.queue_identity_documents()', 'public.anonymize_closed_accounts()',
    'public.get_expired_identity_documents(integer)', 'public.confirm_identity_documents_purged(uuid[])', 'public.scrub_unneeded_identity_fields()'];
  const jr = [];
  for (const fn of jobFns) jr.push([fn, await priv(fn, 'authenticated'), await priv(fn, 'anon'), await priv(fn, 'service_role')]);
  check('the jobs and the server\'s retention calls belong to the service role only', jr.every(([, u, a, sr]) => !u && !a && sr), jr);
  const clientFns = ['public.admin_exclude_rating(uuid,boolean,text)', 'public.admin_send_conduct_warning(uuid,text)', 'public.admin_confirm_integrity_flag(uuid,text)', 'public.get_audit_log(timestamptz,timestamptz,text,text,integer,integer)',
    'public.record_audit_export(text,integer,jsonb)', 'public.place_legal_hold(text,uuid,text,text)', 'public.release_legal_hold(uuid,text)', 'public.record_privacy_acceptance(text)'];
  const cr = [];
  for (const fn of clientFns) cr.push([fn, await priv(fn, 'authenticated'), await priv(fn, 'anon')]);
  check('the administrators\' and accounts\' own calls are for signed-in users only (each checks the caller inside)', cr.every(([, u, a]) => u && !a), cr);
  check('audit_log and rating are not writable by signed-in users beyond what the apps need (INSERT only)', await (async () => {
    const x = await one(`SELECT has_table_privilege('authenticated','public.audit_log','INSERT') ai, has_table_privilege('authenticated','public.audit_log','UPDATE') au, has_table_privilege('authenticated','public.audit_log','DELETE') ad,
                                has_table_privilege('authenticated','public.rating','INSERT') ri, has_table_privilege('authenticated','public.rating','UPDATE') ru, has_table_privilege('authenticated','public.rating','DELETE') rd,
                                has_table_privilege('authenticated','public.legal_hold','INSERT') li, has_table_privilege('authenticated','public.identity_document_retention','SELECT') ids`);
    return x.ai && !x.au && !x.ad && x.ri && !x.ru && !x.rd && !x.li && !x.ids;
  })());

  console.log('\nS4 the approved figures and codes');
  const k = async (fn, key) => (await one(`SELECT public.${fn}('${key}') AS v`)).v;
  const figs = [['integrity_constant', 'rating_review_min_trips', 20], ['integrity_constant', 'rating_review_floor_x100', 300], ['integrity_constant', 'gps_spoof_teleport_fixes', 3], ['integrity_constant', 'gps_spoof_repeat_trips', 2],
    ['integrity_constant', 'gps_spoof_repeat_window_trips', 10], ['integrity_constant', 'gps_distance_mismatch_pct', 40], ['integrity_constant', 'gps_distance_mismatch_m', 1000], ['integrity_constant', 'rm_pair_trips', 5],
    ['integrity_constant', 'rm_pair_window_days', 30], ['integrity_constant', 'rm_conc_min_ratings', 10], ['integrity_constant', 'rm_conc_share_pct', 60], ['integrity_constant', 'rm_conc_mean_x10', 48], ['integrity_constant', 'rm_burst_count', 5],
    ['integrity_constant', 'rm_burst_minutes', 10], ['retention_constant', 'gps_log_days', 90], ['retention_constant', 'session_days', 90], ['retention_constant', 'closed_records_years', 5], ['retention_constant', 'doc_superseded_days', 30],
    ['retention_constant', 'doc_rejected_days', 30], ['retention_constant', 'doc_closed_months', 12]];
  const wrong = [];
  for (const [fn, key, want] of figs) { const v = await k(fn, key); if (Number(v) !== want) wrong.push([key, v, want]); }
  check(`all ${figs.length} figures of F12.1 - F12.7 are the ones the owner approved`, wrong.length === 0, wrong);
  check('an unknown key is NULL, not zero (a typo cannot silently disable a rule)', (await k('integrity_constant', 'nope')) === null && (await k('retention_constant', 'nope')) === null);
  const cat = await q(`SELECT violation_code, applies_to, default_points, min_points, max_points, confirmation_mode, ladder_bypass, exemption_eligible FROM violation_catalog WHERE violation_code IN ('PAX_RATING_MANIPULATION','DRV_RATING_MANIPULATION','DRV_MULTI_ACCOUNT','DRV_FALSE_DOCUMENTS') ORDER BY 1`);
  const by = Object.fromEntries(cat.map((c) => [c.violation_code, c]));
  check('PAX_ / DRV_RATING_MANIPULATION: 2 strikes, administrator-confirmed, no exemption', ['PAX_RATING_MANIPULATION', 'DRV_RATING_MANIPULATION'].every((c) => by[c] && by[c].default_points === 2 && by[c].min_points === 2 && by[c].max_points === 2 && by[c].confirmation_mode === 'ADMIN_CONFIRMATION' && by[c].exemption_eligible === false && by[c].ladder_bypass === 'NONE') && by.PAX_RATING_MANIPULATION.applies_to === 'passenger' && by.DRV_RATING_MANIPULATION.applies_to === 'driver', cat);
  check('DRV_MULTI_ACCOUNT and DRV_FALSE_DOCUMENTS: 0 points, deactivate for review', ['DRV_MULTI_ACCOUNT', 'DRV_FALSE_DOCUMENTS'].every((c) => by[c] && by[c].default_points === 0 && by[c].ladder_bypass === 'DEACTIVATE_FOR_REVIEW' && by[c].applies_to === 'driver'), cat);
  check('"Unregistered Person Driving" is a SERIOUS category that may be followed by DRV_SUBSTITUTE_DRIVER only (by a passenger)', (await one(`SELECT public._incident_category_class('Unregistered Person Driving') AS c`)).c === 'SERIOUS'
    && JSON.stringify((await one(`SELECT public._incident_strike_options('Unregistered Person Driving', 'Passenger') AS o`)).o) === '["DRV_SUBSTITUTE_DRIVER"]' && (await one(`SELECT public._incident_strike_options('Unregistered Person Driving', 'Driver') AS o`)).o.length === 0);
  const tc = await q(`SELECT conname, pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname IN ('toda_account_status_check', 'toda_admin_account_status_check')`);
  check('a TODA application can be returned for correction (the status check allows Resubmission Required; before, every return failed)', tc.every((c) => /Resubmission Required/.test(c.d)) && tc.length === 2, tc);

  const ok = summary();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
