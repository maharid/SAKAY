-- ============================================================================
-- Migration: 20261028000001_policy_sweeps_in_database.sql
-- The hourly policy duties run inside the database (pg_cron), not in a web server that sleeps.
--
-- Two sweeps carry duties that the policy puts on a clock:
--   * run_scheduled_sla_and_expiry_cascade()  Rule 3.7 (a reviewer's 3-day reminder, the 5-day overdue flag), Rules 24.1 - 24.5 (document and
--                                             accreditation expiry reminders, drivers made unable to go Online), Rule 2.5 (a TODA with 3 upheld
--                                             reports in 60 days), the overdue and lost-item flags of Section 19
--   * sweep_strike_state()                    Rule 22.1 (a finished suspension is lifted), Rules 9.4 / 25.1 (a provisional strike whose 48 hours
--                                             passed without an appeal becomes final), Rule 25.6 (an appeal the TODA did not decide in time goes
--                                             to the LGU), and the cached strike totals
-- Both were started by a timer inside the Express server. That server runs on Render's free plan, which puts it to sleep when nobody is calling
-- it, and a sleeping server runs no timers: the reminders, the overdue flags and the escalations simply did not happen until something woke it.
-- Batch 4 moved the presence sweep into pg_cron for exactly this reason and listed these two as the follow-up; this is that follow-up.
--
--   * run_policy_sweeps_job() is the one entry point the job calls: it marks the call as the system and runs both sweeps, each on its own, so a
--     failure in one never stops the other (the failure is raised as a WARNING that shows in cron.job_run_details).
--   * The job runs every hour at minute 12. Both sweeps are idempotent and take their own advisory lock, so a second caller (the manual
--     POST /api/scheduler/run-sla-checks, which stays for an administrator's "run it now") is harmless.
--   * Safe to run twice: re-running replaces the job of the same name. Where pg_cron does not exist (the local emulator) it only prints a notice.
--
-- After applying:   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'sakay-policy-sweeps';
--                   SELECT status, return_message, start_time FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;
-- ============================================================================

CREATE OR REPLACE FUNCTION public.run_policy_sweeps_job()
RETURNS JSONB AS $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_cascade JSONB;
    v_strikes JSONB;
    v_errors JSONB := '[]'::jsonb;
BEGIN
    PERFORM set_config('sakay.internal_context', 'true', true);

    BEGIN
        v_cascade := public.run_scheduled_sla_and_expiry_cascade();
    EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors || jsonb_build_array('SLA and expiry cascade: ' || SQLERRM);
        RAISE WARNING 'policy sweeps: the SLA and expiry cascade failed (%)', SQLERRM;
    END;

    BEGIN
        v_strikes := public.sweep_strike_state();
    EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors || jsonb_build_array('Strike sweep: ' || SQLERRM);
        RAISE WARNING 'policy sweeps: the strike sweep failed (%)', SQLERRM;
    END;

    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('cascade', v_cascade, 'strike_sweep', v_strikes, 'errors', v_errors);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Not callable by clients; the database owner (which pg_cron runs as) and the service role may call it.
REVOKE EXECUTE ON FUNCTION public.run_policy_sweeps_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_policy_sweeps_job() TO service_role;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
        CREATE EXTENSION IF NOT EXISTS pg_cron;

        -- Replace any earlier job of the same name so a re-run never creates a duplicate schedule.
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'sakay-policy-sweeps';
        PERFORM cron.schedule('sakay-policy-sweeps', '12 * * * *', 'SELECT public.run_policy_sweeps_job()');
    ELSE
        RAISE NOTICE 'pg_cron is not available in this database: the hourly policy sweeps are NOT scheduled here. Enable pg_cron (Supabase: Database > Extensions) and re-run this migration.';
    END IF;
END $$;
