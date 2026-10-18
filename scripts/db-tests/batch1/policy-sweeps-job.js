// 20261028000001: the hourly policy duties (reminders, overdue flags, expiry, provisional strikes, finished suspensions, appeal escalation) are
// run by ONE database entry point that pg_cron calls, instead of a timer inside a web server that sleeps. The emulator has no pg_cron, so this
// proves the entry point itself: it does the work of both sweeps as the system, only the system can call it, and one sweep failing never stops
// the other. (After applying: SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'sakay-policy-sweeps'.)
const fs = require('fs');
const path = require('path');
const { setup, ID, attempt, check, summary } = require('../b6fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, as, svc } = s;
  const job = () => one(`SELECT public.run_policy_sweeps_job() AS r`).then((x) => x.r);

  console.log('The entry point runs both sweeps');
  // Rules 9.4 / 25.1: a provisional strike whose 48 hours passed without an appeal becomes final. The strike sweep does it.
  await internal(`SELECT public.issue_strike('driver', '${ID.D1}', 'DRV_CONNECTIVITY_FAILURE', NULL, NULL, NULL, 'job-test-provisional', NULL, 'job test', NULL, NULL)`);
  const before = await one(`SELECT status FROM strikes_ledger WHERE idempotency_key = 'job-test-provisional'`);
  check('a provisional strike starts as PROVISIONAL', before.status === 'PROVISIONAL', before);
  await internal(`UPDATE strikes_ledger SET provisional_until = now() - interval '1 hour' WHERE idempotency_key = 'job-test-provisional'`);
  // Rule 22.1: a time-bound suspension that has finished is lifted. (The passenger is suspended by an administrator, the date moved into the past.)
  await internal(`UPDATE passenger SET account_status = 'Suspended', suspension_kind = 'ADMIN', suspended_until = now() - interval '1 minute' WHERE passenger_id = '${ID.P2}'`);

  const r = await job();
  check('the job reports both sweeps and no error', r.strike_sweep && r.cascade && Array.isArray(r.errors) && r.errors.length === 0, r);
  const after = await one(`SELECT status FROM strikes_ledger WHERE idempotency_key = 'job-test-provisional'`);
  check('Rules 9.4 / 25.1: the strike sweep made the unappealed provisional strike final', after.status === 'ACTIVE', after);
  const lifted = await one(`SELECT account_status, suspended_until FROM passenger WHERE passenger_id = '${ID.P2}'`);
  check('Rule 22.1: the strike sweep lifted the finished suspension', lifted.account_status !== 'Suspended' && lifted.suspended_until === null, lifted);
  check('the SLA and expiry cascade ran (it answers with its counts)', typeof r.cascade === 'object' && r.cascade !== null && !('error' in r.cascade), r.cascade);

  console.log('\nIt is the system\'s entry point');
  const app = await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`SELECT public.run_policy_sweeps_job()`)));
  check('a signed-in user cannot call it', !app.ok && /permission denied/i.test(app.error), app.error);
  const anon = await attempt(() => s.anon((tx) => tx.query(`SELECT public.run_policy_sweeps_job()`)));
  check('an anonymous caller cannot call it', !anon.ok && /permission denied/i.test(anon.error), anon.error);
  const service = await attempt(() => svc((tx) => tx.query(`SELECT public.run_policy_sweeps_job() AS r`)));
  check('the service role (the "run it now" endpoint) can', service.ok === true && Array.isArray(service.value.rows[0].r.errors), service.error);

  console.log('\nTwice in a row is harmless');
  const again = await job();
  check('a second run finds nothing left to do and reports no error', again.errors.length === 0 && (again.strike_sweep.provisional_confirmed ?? 0) === 0 && (again.strike_sweep.lifted_suspensions ?? 0) === 0, again);

  console.log('\nOne sweep failing does not stop the other');
  await internal(`ALTER FUNCTION public.run_scheduled_sla_and_expiry_cascade() RENAME TO run_scheduled_sla_and_expiry_cascade_real;
                  CREATE FUNCTION public.run_scheduled_sla_and_expiry_cascade() RETURNS jsonb LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'cascade broke on purpose'; END $f$`);
  await internal(`SELECT public.issue_strike('driver', '${ID.D2}', 'DRV_CONNECTIVITY_FAILURE', NULL, NULL, NULL, 'job-test-provisional-2', NULL, 'job test 2', NULL, NULL);
                  UPDATE strikes_ledger SET provisional_until = now() - interval '1 hour' WHERE idempotency_key = 'job-test-provisional-2'`);
  const broken = await job();
  const second = await one(`SELECT status FROM strikes_ledger WHERE idempotency_key = 'job-test-provisional-2'`);
  check('the cascade failed, the failure is reported, and the strike sweep still ran', broken.errors.length === 1 && /cascade broke on purpose/.test(broken.errors[0]) && second.status === 'ACTIVE', { broken, second });
  await internal(`DROP FUNCTION public.run_scheduled_sla_and_expiry_cascade(); ALTER FUNCTION public.run_scheduled_sla_and_expiry_cascade_real() RENAME TO run_scheduled_sla_and_expiry_cascade`);

  console.log('\nThe migration file');
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261028000001_policy_sweeps_in_database.sql'), 'utf8');
  check('it schedules the job hourly with pg_cron, replacing an earlier job of the same name, and only prints a notice where pg_cron is absent',
    /cron\.unschedule/.test(sql) && /cron\.schedule\('sakay-policy-sweeps', '12 \* \* \* \*'/.test(sql) && /RAISE NOTICE 'pg_cron is not available/.test(sql));
  check('it is pure ASCII with LF line endings', !/[^\x00-\x7F]/.test(sql) && !/\r/.test(sql) && sql.endsWith('\n'));
  check('the server no longer starts its own timer for these duties (one scheduler, not two)', !/startSlaScheduler\(\)/.test(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'server', 'src', 'index.ts'), 'utf8')));
  void q;

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
