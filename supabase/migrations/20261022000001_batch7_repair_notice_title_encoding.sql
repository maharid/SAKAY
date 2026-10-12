-- ============================================================================
-- Migration: 20261022000001_batch7_repair_notice_title_encoding.sql
-- Batch 7 follow-up: repairs ONE character that was damaged on its way into the hosted database.
--
-- What happened: 20261021000001 contains exactly one non-ASCII character, the em dash of the passenger's notice title "Connection lost -
-- reconnecting..." inside booking_timers_sweep(). When that migration was applied to the hosted project the dash was read as Windows-1252 and
-- saved again as UTF-8, so the function there says "Connection lost <a-circumflex><euro><right double quote> reconnecting..." (hex c3a2 e282ac e2809d)
-- and the fingerprint check (scripts/dispatchFingerprintCheck.js) reported 66 of 67 functions. The sweep itself is the same; only the title of the
-- "driver unreachable" notification is garbled.
--
-- The repair: where the damaged text is found, put the dash back, in the function (its definition is read back from the database, changed and run
-- again, so every other line stays exactly as it was) and in the notifications already written with the damaged title. Where it is not found (a database
-- built from the repository, or one that was applied correctly) nothing happens. This file is ASCII only, on purpose: the characters are built with
-- chr(), so no tool, editor or console can damage them again. Safe to run twice. Forward-only: 20261021000001 is NOT edited (it has been applied).
-- ============================================================================
DO $$
DECLARE
    v_bad  TEXT := 'Connection lost ' || chr(226) || chr(8364) || chr(8221) || ' reconnecting';   -- U+00E2 U+20AC U+201D: what the dash became
    v_good TEXT := 'Connection lost ' || chr(8212) || ' reconnecting';                            -- U+2014: the em dash
    v_def  TEXT;
    v_rows INTEGER;
BEGIN
    v_def := pg_get_functiondef('public.booking_timers_sweep()'::regprocedure);
    IF position(v_bad IN v_def) > 0 THEN
        EXECUTE replace(v_def, v_bad, v_good);
        RAISE NOTICE 'booking_timers_sweep(): the damaged dash of the notice title was repaired.';
    ELSE
        RAISE NOTICE 'booking_timers_sweep(): nothing to repair.';
    END IF;

    UPDATE public.notification
       SET title = replace(title, v_bad, v_good)
     WHERE notification_type = 'DRIVER_UNREACHABLE' AND position(v_bad IN title) > 0;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
        RAISE NOTICE '% notification title(s) were repaired.', v_rows;
    END IF;

    -- Self-check: the function holds the good title and not the damaged one.
    v_def := pg_get_functiondef('public.booking_timers_sweep()'::regprocedure);
    IF position(v_good IN v_def) = 0 OR position(v_bad IN v_def) > 0 THEN
        RAISE EXCEPTION 'booking_timers_sweep() does not hold the repaired notice title';
    END IF;
END $$;
