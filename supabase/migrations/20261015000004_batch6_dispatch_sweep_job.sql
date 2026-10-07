-- ============================================================================
-- Migration: 20261015000004_batch6_dispatch_sweep_job.sql
-- Batch 6, part 4 of 4: the scheduled job that keeps every search moving even when nobody has the app open.
--
-- The search is driven by deadlines in the database (booking.dispatch_next_action_at, dispatch_attempt.expires_at). Whoever notices a deadline
-- has passed advances the search: the passenger's screen, any Online driver's screen, the driver's accept / decline. This job is the one
-- that does not depend on a phone: it runs dispatch_sweep() every few seconds, so a passenger who closed the app (or whose phone died) still
-- gets the search to its end: the next driver is offered, the radius grows, and No Driver Found is written on time.
--
--   * pg_cron can run a job every N SECONDS (pg_cron 1.5+, which Supabase has). Where only whole minutes are accepted, the job falls back to
--     every minute (the drivers' and the passenger's polls keep offers moving in between).
--   * Idempotent: re-running replaces the job of the same name. Where pg_cron does not exist (local emulator), it only prints a notice.
--
-- After applying, check:   SELECT jobname, schedule, active FROM cron.job;
--                          SELECT status, return_message, start_time FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;
-- ============================================================================

CREATE OR REPLACE FUNCTION public.run_dispatch_sweep_job()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN public.dispatch_sweep();
END;
$$;

-- Not callable by apps; the database owner (which pg_cron runs as) and the service role may call it.
REVOKE EXECUTE ON FUNCTION public.run_dispatch_sweep_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_dispatch_sweep_job() TO service_role;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
        CREATE EXTENSION IF NOT EXISTS pg_cron;

        -- Replace any earlier job of the same name so a re-run never creates a duplicate schedule.
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'sakay-dispatch-sweep';
        BEGIN
            PERFORM cron.schedule('sakay-dispatch-sweep', '5 seconds', 'SELECT public.run_dispatch_sweep_job()');
        EXCEPTION WHEN OTHERS THEN
            PERFORM cron.schedule('sakay-dispatch-sweep', '* * * * *', 'SELECT public.run_dispatch_sweep_job()');
            RAISE NOTICE 'pg_cron here accepts only whole-minute schedules (%): the dispatch sweep runs every minute; the drivers'' and passengers'' polls keep offers moving in between.', SQLERRM;
        END;
    ELSE
        RAISE NOTICE 'pg_cron is not available in this database: the dispatch sweep job is NOT scheduled here. Enable pg_cron (Supabase: Database > Extensions) and re-run this migration. Until then searches advance only while an app is open.';
    END IF;
END $$;
