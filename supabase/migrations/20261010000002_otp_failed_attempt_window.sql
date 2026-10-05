-- ============================================================================
-- Migration: 20261010000002_otp_failed_attempt_window.sql
-- Manual-test fix (Batch 1, passenger OTP): "after a new code is issued, ONE wrong entry jumps to the 15-minute lock".
--
-- ROOT CAUSE
--   increment_failed_otp() only ever added 1 to passenger.failed_otp_attempts; the counter was cleared only by a SUCCESSFUL
--   verification (reset_failed_otp). So after five wrong codes the number was locked for 15 minutes, and when the lock ran out
--   the counter still stood at 5: the very next wrong entry made it 6 with last_otp_failed_at = now, which is a brand-new
--   15-minute lock. A counter left over from an old attempt (4 wrong a week ago) did the same thing: the 5th wrong ever, not the 5th
--   wrong in this session, locked the number.
--
-- FIX (the threshold, 5 wrong codes, and the 15-minute lock are NOT changed - Rule 4.7)
--   A failure that comes MORE THAN 15 MINUTES after the previous one starts a new count at 1. Inside a lock nothing is counted at all
--   (the server refuses before it looks at the code), so this only changes what happens once the lock has run out or the old
--   failures have gone stale. The server now also clears the counter whenever a new code is issued (authRoutes.ts), so each issued code
--   starts with a clean count; that is the application side of the same fix.
--
-- Same name, same arguments, same return type, so the existing grants (service role only since S1) are untouched.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.increment_failed_otp(p_passenger_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE public.passenger
       SET failed_otp_attempts = CASE
               WHEN last_otp_failed_at IS NULL
                 OR last_otp_failed_at < NOW() - INTERVAL '15 minutes'
               THEN 1                                           -- the previous lock has run out / the old failures are stale: a new count
               ELSE COALESCE(failed_otp_attempts, 0) + 1
           END,
           last_otp_failed_at = NOW()
     WHERE passenger_id = p_passenger_id;
END;
$$;

COMMIT;
