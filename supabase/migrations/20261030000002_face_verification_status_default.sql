-- ============================================================================
-- driver_verification.face_verification_status: new rows no longer say 'Passed'
-- ============================================================================
-- The driver registration used to scan the face and "match" it against the licence photo; the app wrote 'Passed' or 'Flagged' into this column, and
-- the column itself defaulted to 'Passed' (20260831000000), so even a row the app never wrote claimed a face check had passed. That step is now a
-- live profile picture (driver.profile_photo_url, plus the review copy in face_photo_path): no face is matched, so nothing is "Passed". The app has
-- stopped writing the column, and nothing in the database or in any screen reads it.
--
-- This migration only removes the default, so a NEW driver_verification row has NULL ("no face check was made") instead of 'Passed'.
--   * Existing rows are NOT touched. The values they hold (the earlier 'Passed' / 'Flagged') stay exactly as they are: dropping a default never rewrites a row.
--   * The column stays (it is legacy data, and dropping it would be destructive); only a comment now says so.
--   * No constraint, policy, trigger or function changes.
-- Forward-only. Safe to run twice.
-- ============================================================================

ALTER TABLE public.driver_verification
    ALTER COLUMN face_verification_status DROP DEFAULT;

COMMENT ON COLUMN public.driver_verification.face_verification_status IS
    'LEGACY. Written by the earlier face-matching registration step (Passed / Flagged). No face matching exists any more: new rows are NULL and nothing reads this column.';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'driver_verification'
           AND column_name = 'face_verification_status'
           AND column_default IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'driver_verification.face_verification_status still has a default';
    END IF;
    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'driver_verification'
           AND column_name = 'face_verification_status'
    ) THEN
        RAISE EXCEPTION 'driver_verification.face_verification_status must stay (existing rows keep their values)';
    END IF;
END $$;
