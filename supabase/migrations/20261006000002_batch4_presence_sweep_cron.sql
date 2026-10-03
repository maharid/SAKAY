-- ============================================================================
-- Migration: 20261006000002_batch4_presence_sweep_cron.sql
-- Batch 4: run the presence sweep inside the database with pg_cron.
--
-- The sweep (sweep_driver_presence) sets Offline any driver whose app has been silent for 5 minutes.
-- It used to be driven by a timer in the Express server, which sleeps on Render's free plan. pg_cron runs
-- inside the database, so it keeps running regardless of any web server.
--
--   * run_presence_sweep_job() is the one entry point the job calls: it marks the call as the system
--     (the sweep itself refuses clients) and runs the sweep.
--   * The job runs every minute (pg_cron's finest standard granularity); 5 minutes is the staleness
--     threshold, not the schedule.
--   * Idempotent: re-running replaces the job of the same name. Where pg_cron does not exist at all
--     (local emulator), the migration only prints a notice.
--
-- After applying, check:   SELECT jobname, schedule, active FROM cron.job;
--                          SELECT status, return_message, start_time FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;
-- ============================================================================

CREATE OR REPLACE FUNCTION public.run_presence_sweep_job()
RETURNS JSONB AS $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_result JSONB;
BEGIN
    PERFORM set_config('sakay.internal_context', 'true', true);
    v_result := public.sweep_driver_presence();
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Not callable by clients; the database owner (which pg_cron runs as) and the service role may call it.
REVOKE EXECUTE ON FUNCTION public.run_presence_sweep_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_presence_sweep_job() TO service_role;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
        CREATE EXTENSION IF NOT EXISTS pg_cron;

        -- Replace any earlier job of the same name so a re-run never creates a duplicate schedule.
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'sakay-presence-sweep';
        PERFORM cron.schedule('sakay-presence-sweep', '* * * * *', 'SELECT public.run_presence_sweep_job()');
    ELSE
        RAISE NOTICE 'pg_cron is not available in this database: the presence sweep is NOT scheduled here. Enable pg_cron (Supabase: Database > Extensions) and re-run this migration.';
    END IF;
END $$;
