-- ============================================================================
-- Migration: 20261027000001_batch12_ratings_integrity_privacy_audit.sql
-- Batch 12 - Ratings and service quality (Section 23), fraud and system integrity (Section 27), data privacy, audit and recordkeeping (Section 28).
--
-- What was wrong before this file (found by the Phase A audit of 2026-10-15):
--   * the driver's Average Rating was a cached column (NOT NULL DEFAULT 4.00) refreshed by an INSERT / UPDATE trigger only: a new driver showed 4.0 (or 5.0),
--     an excluded or deleted rating never left the mean, a passenger had no stored mean at all, and nothing flagged a driver under 3.00 after 20 trips
--   * the LGU Administrator could UPDATE or DELETE any rating silently (no reason, no audit)
--   * audit_log was writable and deletable by the LGU (policy audit_log_manage_lgu FOR ALL), the TODA return / deactivate functions wrote no audit row, and the
--     client stamped its own audit timestamps
--   * nothing detected GPS spoofing, rating manipulation, collusive matching or re-registration after a sanction; nothing was ever purged (gps_log, sessions,
--     identity document images, closed accounts); a TODA that had REJECTED a driver could still read the driver's documents
--
--   1. integrity_constant() and retention_constant(): every number of this batch in ONE place (mirrored in policyConfig.ts; the drift test keeps both equal)
--   2. ratings: Average Rating = sum / n over the account's whole history, from the source rows (rating_summary), never a default (NULL = "Not Yet Rated");
--      excluded ratings leave BOTH sum and count; only ratings of Completed trips count; the cache is refreshed by a trigger that cannot drift (INSERT, UPDATE,
--      DELETE, and a trip becoming Completed); ratings are immutable facts, excluded only by admin_exclude_rating() (LGU only, reason, audited)
--   3. Rules 23.3 / 23.4: a driver (TODA, or LGU when no TODA) or a passenger (LGU) under 3.00 after 20 completed trips gets ONE review flag; the passenger
--      warning is an LGU action (admin_send_conduct_warning)
--   4. audit_log: append-only (ERR_AUDIT_APPEND_ONLY, even for the service role), the LGU's write policy and every UPDATE / DELETE grant are gone, the server
--      stamps the audit time, get_audit_log() / record_audit_export() give the portals their paged list and the audited export; the TODA return / deactivate
--      functions check the caller and write their own audit row
--   5. detectors (Rules 27.1, 27.3 - 27.6): flags only, never an automatic strike: GPS teleports and distance mismatch, rating manipulation (reciprocal five-star
--      pairs, concentration, burst), collusive Shared Trip matching, re-registration after a sanction; admin_confirm_integrity_flag() is the LGU's decision
--   6. new violation codes: PAX_ / DRV_RATING_MANIPULATION (2 strikes), DRV_MULTI_ACCOUNT and DRV_FALSE_DOCUMENTS (deactivate for review); the incident category
--      "Unregistered Person Driving" (Rule 27.2, SERIOUS class)
--   7. retention (Rules 28.1 - 28.3): legal_hold + the automatic holds of open cases, purge of gps_log and sessions, a queue for identity document images
--      (the server removes the files), anonymization of accounts 5 years after closure, one daily job; storage_can_read_driver_folder() honours live
--      affiliations only; consent record columns and record_privacy_acceptance()
--
-- Functions replaced (verbatim copies of the newest definitions with the marked "Batch 12" changes): driver_insert_guard, audit_log_stamp_actor,
-- return_toda_accreditation, deactivate_toda_accreditation, storage_can_read_driver_folder, _incident_category_class, _incident_strike_options.
-- Forward-only, ASCII only, safe to run twice.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. THE NUMBERS (one place)
-- ----------------------------------------------------------------------------
-- Code constants, mirrored in packages/shared/src/config/policyConfig.ts. The GPS accuracy and speed limits are NOT repeated here: the detectors read
-- fare_policy_constant('gps_max_accuracy_m') and ('gps_max_speed_kmh') (Batch 5), the same filter the fare uses.
CREATE OR REPLACE FUNCTION public.integrity_constant(p_key TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE p_key
        WHEN 'rating_review_min_trips'      THEN 20     -- F12.1: completed trips before the average can raise a review (Rules 23.3, 23.4)
        WHEN 'rating_review_floor_x100'     THEN 300    -- F12.1: an average under 3.00 (x100) raises it; compared exactly as sum x 100 < floor x n
        WHEN 'rating_reflag_trips'          THEN 20     -- a reviewed account is flagged again only after this many MORE completed trips
        WHEN 'gps_spoof_teleport_fixes'     THEN 3      -- F12.6: fixes in ONE trip that jump faster than the fare filter allows (accuracy within the fare limit)
        WHEN 'gps_spoof_heavy_fixes'        THEN 10     -- F12.6: ... one trip with this many is enough on its own
        WHEN 'gps_spoof_repeat_trips'       THEN 2      -- F12.6: suspect trips among the driver's last trips that raise the flag
        WHEN 'gps_spoof_repeat_window_trips' THEN 10    -- F12.6: ... the number of last completed trips looked at
        WHEN 'gps_distance_mismatch_pct'    THEN 40     -- F12.6: tracked distance differs from the quoted route by more than this percent ...
        WHEN 'gps_distance_mismatch_m'      THEN 1000   -- F12.6: ... AND by more than this many metres
        WHEN 'rm_pair_trips'                THEN 5      -- F12.7: completed trips of one driver and passenger in the window where BOTH gave the top rating
        WHEN 'rm_pair_window_days'          THEN 30     -- F12.7
        WHEN 'rm_conc_min_ratings'          THEN 10     -- F12.7: ratings of a driver in the window before concentration is looked at
        WHEN 'rm_conc_share_pct'            THEN 60     -- F12.7: share of those ratings given by the top passengers
        WHEN 'rm_conc_max_raters'           THEN 2      -- F12.7: ... how many passengers make the "top"
        WHEN 'rm_conc_mean_x10'             THEN 48     -- F12.7: ... and the mean of those ratings is at least 4.8 (x10)
        WHEN 'rm_conc_window_days'          THEN 30     -- F12.7
        WHEN 'rm_burst_count'               THEN 5      -- F12.7: ratings by one account inside the burst window
        WHEN 'rm_burst_minutes'             THEN 10     -- F12.7
        WHEN 'coll_matches'                 THEN 4      -- Rule 27.4: Matched Shared pairings of one driver with one passenger in the window
        WHEN 'coll_window_days'             THEN 30
        WHEN 'rereg_lookback_days'          THEN 14     -- Rules 27.3 / 27.6: accounts created in the last days are compared with sanctioned accounts
        ELSE NULL
    END;
$$;

CREATE OR REPLACE FUNCTION public.retention_constant(p_key TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE p_key
        WHEN 'gps_log_days'             THEN 90     -- F12.2: routine GPS fixes, unless held
        WHEN 'session_days'             THEN 90     -- F12.5: ended driver online sessions and trip connectivity events, unless held
        WHEN 'closed_records_years'     THEN 5      -- F12.3: a closed account is anonymized this many years after its closure (its strike records stay, without names)
        WHEN 'doc_superseded_days'      THEN 30     -- F12.4: a replaced identity image is deleted this many days after the replacement
        WHEN 'doc_rejected_days'        THEN 30     -- F12.4: the images of a rejected application are deleted this many days after the rejection
        WHEN 'doc_closed_months'        THEN 12     -- F12.4: the images of a closed account are deleted this many months after the closure
        WHEN 'purge_batch_rows'         THEN 5000   -- rows removed per statement (a run loops until nothing is left)
        ELSE NULL
    END;
$$;

-- ----------------------------------------------------------------------------
-- 2. NEW COLUMNS
-- ----------------------------------------------------------------------------
ALTER TABLE public.rating
    ADD COLUMN IF NOT EXISTS is_excluded BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS excluded_at TIMESTAMPTZ;

-- "Not Yet Rated" is NULL: there is no default average (Rule 23.1).
ALTER TABLE public.driver ALTER COLUMN weighted_average_rating DROP NOT NULL;
ALTER TABLE public.driver ALTER COLUMN weighted_average_rating DROP DEFAULT;
ALTER TABLE public.driver
    ADD COLUMN IF NOT EXISTS rating_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS privacy_notice_version TEXT,
    ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ;
ALTER TABLE public.passenger
    ADD COLUMN IF NOT EXISTS average_rating NUMERIC(3,2),
    ADD COLUMN IF NOT EXISTS rating_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS privacy_notice_version TEXT,
    ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ;

COMMENT ON COLUMN public.driver.weighted_average_rating IS 'Average Rating (Rule 23.1): the plain mean sum / n of the non-excluded ratings of Completed trips, NULL = Not Yet Rated. A cache of rating_summary(), written only by the database.';
COMMENT ON COLUMN public.passenger.average_rating IS 'Average Rating (Rule 23.1), same rule as driver.weighted_average_rating. NULL = Not Yet Rated.';

-- ----------------------------------------------------------------------------
-- 3. RATINGS (Rules 23.1 - 23.5)
-- ----------------------------------------------------------------------------
-- Who is rated: a Passenger rating is about the driver, a Driver rating about the passenger.
CREATE OR REPLACE FUNCTION public._rating_subject_type(p_rater_role TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE lower(COALESCE(p_rater_role, '')) WHEN 'passenger' THEN 'driver' WHEN 'driver' THEN 'passenger' END;
$$;

-- THE ONE SOURCE OF TRUTH for an Average Rating (Rule 23.1): over the account's whole history (no window), the ratings of Completed trips that were not
-- excluded under Rule 23.5. Excluded ratings are out of BOTH the sum and the count. average is NULL when n = 0 ("Not Yet Rated"), never a default.
CREATE OR REPLACE FUNCTION public.rating_summary(p_subject_type TEXT, p_subject_id UUID)
RETURNS TABLE (n INTEGER, sum_stars INTEGER, average NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT count(*)::INTEGER,
           COALESCE(sum(r.stars), 0)::INTEGER,
           CASE WHEN count(*) = 0 THEN NULL ELSE round(sum(r.stars)::NUMERIC / count(*), 2) END
      FROM public.rating r
      JOIN public.booking b ON b.booking_id = r.booking_id
     WHERE r.ratee_id = p_subject_id
       AND NOT r.is_excluded
       AND b.booking_status = 'Completed'
       AND lower(r.rater_role) = CASE WHEN p_subject_type = 'driver' THEN 'passenger' ELSE 'driver' END;
$$;

-- The cache the apps read (driver.weighted_average_rating, passenger.average_rating, rating_count) is written ONLY here.
CREATE OR REPLACE FUNCTION public._refresh_rating_cache(p_subject_type TEXT, p_subject_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
    s RECORD;
BEGIN
    IF p_subject_id IS NULL OR p_subject_type NOT IN ('driver', 'passenger') THEN
        RETURN;
    END IF;
    SELECT * INTO s FROM public.rating_summary(p_subject_type, p_subject_id);
    PERFORM set_config('sakay.internal_context', 'true', true);
    IF p_subject_type = 'driver' THEN
        UPDATE public.driver
           SET weighted_average_rating = s.average, rating_count = s.n
         WHERE driver_id = p_subject_id
           AND (weighted_average_rating IS DISTINCT FROM s.average OR rating_count IS DISTINCT FROM s.n);
    ELSE
        UPDATE public.passenger
           SET average_rating = s.average, rating_count = s.n
         WHERE passenger_id = p_subject_id
           AND (average_rating IS DISTINCT FROM s.average OR rating_count IS DISTINCT FROM s.n);
    END IF;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
END;
$$;

-- Rules 23.3 / 23.4: an average under 3.00 after at least 20 completed trips raises ONE review flag. The comparison is exact (sum x 100 < floor x n), never the
-- rounded figure the screens show. A driver's flag goes to the TODA Administrator (the LGU when the driver has no active TODA); a passenger's to the LGU.
-- A flag that was reviewed is raised again only after another 20 completed trips. Returns the flag id, or NULL when nothing is raised.
CREATE OR REPLACE FUNCTION public._rating_review_check(p_subject_type TEXT, p_subject_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
    s RECORD;
    v_trips INTEGER;
    v_type TEXT;
    v_toda UUID;
    v_role TEXT := 'lgu_admin';
    v_last RECORD;
    v_flag UUID;
BEGIN
    IF p_subject_id IS NULL OR p_subject_type NOT IN ('driver', 'passenger') THEN
        RETURN NULL;
    END IF;
    SELECT * INTO s FROM public.rating_summary(p_subject_type, p_subject_id);
    IF s.n = 0 THEN
        RETURN NULL;
    END IF;
    IF p_subject_type = 'driver' THEN
        SELECT count(*)::INTEGER INTO v_trips FROM public.booking WHERE driver_id = p_subject_id AND booking_status = 'Completed';
    ELSE
        SELECT count(*)::INTEGER INTO v_trips FROM public.booking WHERE passenger_id = p_subject_id AND booking_status = 'Completed';
    END IF;
    IF v_trips < public.integrity_constant('rating_review_min_trips') THEN
        RETURN NULL;
    END IF;
    IF s.sum_stars * 100 >= public.integrity_constant('rating_review_floor_x100') * s.n THEN
        RETURN NULL;
    END IF;

    v_type := CASE WHEN p_subject_type = 'driver' THEN 'DRIVER_LOW_RATING_REVIEW' ELSE 'PASSENGER_LOW_RATING_REVIEW' END;
    SELECT f.status, NULLIF(f.details->>'completed_trips', '')::INTEGER AS trips INTO v_last
      FROM public.admin_review_flag f
     WHERE f.flag_type = v_type AND f.subject_type = p_subject_type AND f.subject_id = p_subject_id::TEXT
     ORDER BY f.created_at DESC LIMIT 1;
    IF FOUND AND v_last.status NOT IN ('Open', 'Under Review')
       AND v_trips < COALESCE(v_last.trips, 0) + public.integrity_constant('rating_reflag_trips') THEN
        RETURN NULL;
    END IF;

    IF p_subject_type = 'driver' THEN
        SELECT toda_id INTO v_toda FROM public.driver WHERE driver_id = p_subject_id;
        IF v_toda IS NOT NULL THEN
            v_role := 'toda_admin';
        END IF;
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    v_flag := public.create_admin_review_flag(v_type, p_subject_type, p_subject_id::TEXT,
        CASE WHEN p_subject_type = 'driver' THEN 'Rule 23.3' ELSE 'Rule 23.4' END, v_role,
        jsonb_build_object('completed_trips', v_trips, 'rating_count', s.n, 'sum_stars', s.sum_stars, 'average', s.average, 'threshold', 3.00,
            'note', CASE WHEN p_subject_type = 'driver'
                         THEN 'The average rating is under 3.00 after at least 20 completed trips: review, counselling or retraining (Rules 23.2, 23.3).'
                         ELSE 'The average rating is under 3.00 after at least 20 completed trips: a warning may be sent (Rules 23.2, 23.4).' END));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN v_flag;
END;
$$;

CREATE OR REPLACE FUNCTION public._rating_touch(p_ratee UUID, p_rater_role TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_type TEXT := public._rating_subject_type(p_rater_role);
BEGIN
    IF v_type IS NULL OR p_ratee IS NULL THEN
        RETURN;
    END IF;
    PERFORM public._refresh_rating_cache(v_type, p_ratee);
    PERFORM public._rating_review_check(v_type, p_ratee);
END;
$$;

-- The cache cannot drift: every change to a rating (insert, update, delete) refreshes the rated account. A failure here must never stop a rating or a
-- payment, so it is reported as a warning only.
CREATE OR REPLACE FUNCTION public.rating_after_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    BEGIN
        IF TG_OP = 'DELETE' THEN
            PERFORM public._rating_touch(OLD.ratee_id, OLD.rater_role);
            RETURN OLD;
        END IF;
        PERFORM public._rating_touch(NEW.ratee_id, NEW.rater_role);
        IF TG_OP = 'UPDATE' AND (OLD.ratee_id IS DISTINCT FROM NEW.ratee_id OR OLD.rater_role IS DISTINCT FROM NEW.rater_role) THEN
            PERFORM public._rating_touch(OLD.ratee_id, OLD.rater_role);
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'rating cache refresh failed: %', SQLERRM;
    END;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- A trip becoming Completed (or ceasing to be) changes which ratings count and the completed-trip count of both parties.
CREATE OR REPLACE FUNCTION public.booking_rating_refresh()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    BEGIN
        IF NEW.driver_id IS NOT NULL THEN
            PERFORM public._refresh_rating_cache('driver', NEW.driver_id);
            PERFORM public._rating_review_check('driver', NEW.driver_id);
        END IF;
        IF NEW.passenger_id IS NOT NULL THEN
            PERFORM public._refresh_rating_cache('passenger', NEW.passenger_id);
            PERFORM public._rating_review_check('passenger', NEW.passenger_id);
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'rating refresh after a completed trip failed: %', SQLERRM;
    END;
    RETURN NULL;
END;
$$;

-- A rating is a fact: its stars, comment, parties and time never change for anybody, the server stamps its time (the burst detector needs a time the
-- client cannot choose), and only admin_exclude_rating() marks one excluded.
CREATE OR REPLACE FUNCTION public.rating_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NOT COALESCE(public.is_trusted_session(), FALSE) THEN
            NEW.created_at := clock_timestamp();
            NEW.is_excluded := FALSE;
            NEW.excluded_at := NULL;
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.rating_id IS DISTINCT FROM OLD.rating_id
       OR NEW.booking_id IS DISTINCT FROM OLD.booking_id
       OR NEW.rater_id IS DISTINCT FROM OLD.rater_id
       OR NEW.ratee_id IS DISTINCT FROM OLD.ratee_id
       OR NEW.rater_role IS DISTINCT FROM OLD.rater_role
       OR NEW.stars IS DISTINCT FROM OLD.stars
       OR NEW.tags IS DISTINCT FROM OLD.tags
       OR NEW.comment IS DISTINCT FROM OLD.comment
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'ERR_RATING_IMMUTABLE: A submitted rating cannot be changed. An LGU Administrator can exclude it (Rule 23.5).' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_driver_rating ON public.rating;
DROP FUNCTION IF EXISTS public.update_driver_rating();
DROP TRIGGER IF EXISTS trigger_rating_guard ON public.rating;
CREATE TRIGGER trigger_rating_guard BEFORE INSERT OR UPDATE ON public.rating
    FOR EACH ROW EXECUTE FUNCTION public.rating_guard();
DROP TRIGGER IF EXISTS trigger_rating_after_change ON public.rating;
CREATE TRIGGER trigger_rating_after_change AFTER INSERT OR UPDATE OR DELETE ON public.rating
    FOR EACH ROW EXECUTE FUNCTION public.rating_after_change();
DROP TRIGGER IF EXISTS trigger_booking_rating_refresh ON public.booking;
CREATE TRIGGER trigger_booking_rating_refresh AFTER UPDATE OF booking_status ON public.booking
    FOR EACH ROW
    WHEN (NEW.booking_status IS DISTINCT FROM OLD.booking_status AND (NEW.booking_status = 'Completed' OR OLD.booking_status = 'Completed'))
    EXECUTE FUNCTION public.booking_rating_refresh();

-- No client edits or deletes a rating, not even the LGU (they use admin_exclude_rating); the row policies that allowed it go too.
DROP POLICY IF EXISTS rating_update_policy ON public.rating;
DROP POLICY IF EXISTS rating_delete_policy ON public.rating;
REVOKE UPDATE, DELETE, TRUNCATE ON public.rating FROM authenticated, anon;

-- The LGU feedback page reads the ratings through this view: it gains is_excluded / excluded_at (appended at the end, so nothing that reads it changes) so the page shows
-- which ratings are left out of the Average Rating. Same definition otherwise; still the reader's own rights (security_invoker).
CREATE OR REPLACE VIEW public.driver_rating
WITH (security_invoker = true)
AS
SELECT
    r.rating_id,
    r.booking_id,
    r.rater_id AS passenger_id,
    r.ratee_id AS driver_id,
    r.stars,
    r.tags,
    r.comment,
    r.created_at,
    p.full_name AS passenger_name,
    p.contact_number AS passenger_contact,
    d.full_name AS driver_name,
    d.contact_number AS driver_contact,
    d.plate_number,
    d.toda_id,
    t.toda_name,
    t.toda_acronym,
    r.is_excluded,
    r.excluded_at
FROM public.rating r
LEFT JOIN public.passenger p ON p.passenger_id = r.rater_id
LEFT JOIN public.driver d ON d.driver_id = r.ratee_id
LEFT JOIN public.toda t ON t.toda_id = d.toda_id;
ALTER VIEW public.driver_rating SET (security_invoker = true);

-- Rule 23.5: the LGU Administrator excludes (or reinstates) a rating, with a reason. The reason is kept in the audit entry, not on the row (the rated and the
-- rating party can read their own rating rows).
CREATE OR REPLACE FUNCTION public._set_rating_excluded(p_rating_id UUID, p_exclude BOOLEAN, p_reason TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    r public.rating;
    v_type TEXT;
BEGIN
    SELECT * INTO r FROM public.rating WHERE rating_id = p_rating_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_RATING_NOT_FOUND: The rating was not found.';
    END IF;
    IF r.is_excluded = p_exclude THEN
        RETURN FALSE;
    END IF;
    UPDATE public.rating
       SET is_excluded = p_exclude, excluded_at = CASE WHEN p_exclude THEN clock_timestamp() ELSE NULL END
     WHERE rating_id = p_rating_id;
    v_type := public._rating_subject_type(r.rater_role);
    PERFORM public.record_policy_audit(
        CASE WHEN p_exclude THEN 'RATING_EXCLUDED' ELSE 'RATING_REINSTATED' END,
        p_rating_id::TEXT, public._subject_name(v_type, r.ratee_id), 'Ratings',
        CASE WHEN p_exclude THEN 'Rating excluded from the Average Rating (Rules 23.1, 23.5). Reason: ' ELSE 'Rating counted again. Reason: ' END || btrim(p_reason),
        jsonb_build_object('is_excluded', r.is_excluded, 'stars', r.stars, 'booking_id', r.booking_id, 'ratee_id', r.ratee_id, 'rater_role', r.rater_role),
        jsonb_build_object('is_excluded', p_exclude, 'stars', r.stars, 'booking_id', r.booking_id, 'ratee_id', r.ratee_id, 'rater_role', r.rater_role));
    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_exclude_rating(p_rating_id UUID, p_exclude BOOLEAN DEFAULT TRUE, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_changed BOOLEAN;
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RAISE EXCEPTION 'Access Denied: Only the LGU Administrator can exclude a rating (Rule 23.5).';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
        RAISE EXCEPTION 'ERR_RATING_EXCLUDE_REASON: Write why the rating is excluded: it was submitted maliciously or in retaliation (at least 10 characters).';
    END IF;
    v_changed := public._set_rating_excluded(p_rating_id, COALESCE(p_exclude, TRUE), p_reason);
    RETURN jsonb_build_object('success', TRUE, 'changed', v_changed, 'idempotent', NOT v_changed);
END;
$$;

-- Rule 23.4: the warning to a passenger whose average is under 3.00 after 20 trips is the LGU Administrator's decision: a notice, and the flag is closed.
CREATE OR REPLACE FUNCTION public.admin_send_conduct_warning(p_flag_id UUID, p_message TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_f public.admin_review_flag;
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RAISE EXCEPTION 'Access Denied: Only the LGU Administrator can send this warning (Rule 23.4).';
    END IF;
    IF p_message IS NULL OR length(btrim(p_message)) < 10 THEN
        RAISE EXCEPTION 'ERR_WARNING_MESSAGE: Write the warning (at least 10 characters).';
    END IF;
    SELECT * INTO v_f FROM public.admin_review_flag
     WHERE flag_id = p_flag_id AND flag_type = 'PASSENGER_LOW_RATING_REVIEW' AND status IN ('Open', 'Under Review') FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_FLAG_NOT_OPEN: The review flag was not found, is closed, or is not a passenger rating review.';
    END IF;
    PERFORM public._notify_subject('passenger', v_f.subject_id::UUID, 'CONDUCT_WARNING', 'Paalala mula sa SAKAY (A reminder from SAKAY)', btrim(p_message), p_flag_id::TEXT, NULL);
    PERFORM public.record_policy_audit('PASSENGER_WARNING_SENT', v_f.subject_id, public._subject_name('passenger', v_f.subject_id::UUID), 'Ratings',
        'A warning was sent after the average rating stayed under 3.00 (Rule 23.4): ' || btrim(p_message), NULL, jsonb_build_object('flag_id', p_flag_id));
    PERFORM public.resolve_admin_review_flag(p_flag_id, 'Resolved', 'Warning sent: ' || btrim(p_message));
    RETURN jsonb_build_object('success', TRUE);
END;
$$;

-- The columns only the database writes (the rating cache, the consent record, the anonymization stamp).
CREATE OR REPLACE FUNCTION public.protect_rating_and_privacy_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF COALESCE(public.is_trusted_session(), FALSE) THEN
        RETURN NEW;
    END IF;
    IF TG_TABLE_NAME = 'passenger' THEN
        IF TG_OP = 'INSERT' THEN
            NEW.average_rating := NULL; NEW.rating_count := 0;
            NEW.privacy_notice_version := NULL; NEW.privacy_accepted_at := NULL; NEW.anonymized_at := NULL;
        ELSIF NEW.average_rating IS DISTINCT FROM OLD.average_rating OR NEW.rating_count IS DISTINCT FROM OLD.rating_count
              OR NEW.privacy_notice_version IS DISTINCT FROM OLD.privacy_notice_version OR NEW.privacy_accepted_at IS DISTINCT FROM OLD.privacy_accepted_at
              OR NEW.anonymized_at IS DISTINCT FROM OLD.anonymized_at THEN
            RAISE EXCEPTION 'Access Denied: The rating, consent and anonymization columns are written by the system only.' USING ERRCODE = '42501';
        END IF;
    ELSE
        IF TG_OP = 'INSERT' THEN
            NEW.rating_count := 0;
            NEW.privacy_notice_version := NULL; NEW.privacy_accepted_at := NULL; NEW.anonymized_at := NULL;
        ELSIF NEW.rating_count IS DISTINCT FROM OLD.rating_count
              OR NEW.privacy_notice_version IS DISTINCT FROM OLD.privacy_notice_version OR NEW.privacy_accepted_at IS DISTINCT FROM OLD.privacy_accepted_at
              OR NEW.anonymized_at IS DISTINCT FROM OLD.anonymized_at THEN
            RAISE EXCEPTION 'Access Denied: The rating, consent and anonymization columns are written by the system only.' USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_passenger_protect_rating_privacy ON public.passenger;
CREATE TRIGGER trigger_passenger_protect_rating_privacy BEFORE INSERT OR UPDATE ON public.passenger
    FOR EACH ROW EXECUTE FUNCTION public.protect_rating_and_privacy_columns();
DROP TRIGGER IF EXISTS trigger_driver_protect_rating_privacy ON public.driver;
CREATE TRIGGER trigger_driver_protect_rating_privacy BEFORE INSERT OR UPDATE ON public.driver
    FOR EACH ROW EXECUTE FUNCTION public.protect_rating_and_privacy_columns();

-- A new driver account starts unrated, not at 4.00 (Batch 12). Verbatim copy of 20261008000002 with that one change.
CREATE OR REPLACE FUNCTION public.driver_insert_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    IF public.is_trusted_session() OR COALESCE(public.is_lgu_admin(), FALSE) THEN
        RETURN NEW;
    END IF;
    IF NEW.account_status IS DISTINCT FROM 'Pending Verification' THEN
        RAISE EXCEPTION 'ERR_DRIVER_PENDING_ONLY: A new driver account always starts as Pending Verification; only the LGU Administrator verifies it.'
            USING ERRCODE = '42501';
    END IF;
    NEW.availability_status := 'Offline';
    NEW.weighted_average_rating := NULL;                                    -- Batch 12: Not Yet Rated (was 4.00)
    NEW.strikes_count := 0;
    NEW.suspension_reason := NULL;  NEW.suspended_at := NULL;  NEW.suspended_until := NULL;
    NEW.suspension_kind := NULL;  NEW.suspension_trigger_strike_id := NULL;  NEW.suspension_threshold := NULL;
    NEW.deactivated_at := NULL;  NEW.closed_at := NULL;
    NEW.is_permanently_disqualified := FALSE;  NEW.disqualification_reason := NULL;
    NEW.disqualified_at := NULL;  NEW.disqualified_by := NULL;
    NEW.rejection_reason := NULL;  NEW.rejection_comment := NULL;  NEW.rejected_by := NULL;  NEW.rejected_at := NULL;
    NEW.endorsed_at := NULL;  NEW.lgu_approved_at := NULL;
    NEW.current_latitude := NULL;  NEW.current_longitude := NULL;
    NEW.last_location_update := NULL;  NEW.last_location_accuracy_m := NULL;
    RETURN NEW;
END;
$$;

-- The consent record (RA 10173): the notice version the person accepted, and when. Written by the person's own call only.
CREATE OR REPLACE FUNCTION public.record_privacy_acceptance(p_version TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_uid UUID := auth.uid();
    v_rows INTEGER := 0;
    v_n INTEGER;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Access Denied: Sign in first.';
    END IF;
    IF p_version IS NULL OR p_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'ERR_PRIVACY_VERSION: The notice version is a date, YYYY-MM-DD.';
    END IF;
    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.passenger SET privacy_notice_version = p_version, privacy_accepted_at = clock_timestamp()
     WHERE auth_user_id = v_uid AND privacy_notice_version IS DISTINCT FROM p_version;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_rows := v_rows + v_n;
    UPDATE public.driver SET privacy_notice_version = p_version, privacy_accepted_at = clock_timestamp()
     WHERE auth_user_id = v_uid AND privacy_notice_version IS DISTINCT FROM p_version;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_rows := v_rows + v_n;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'recorded', v_rows);
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. THE AUDIT LOG (Rule 28.4): append-only, server-stamped, readable and exportable
-- ----------------------------------------------------------------------------
-- No UPDATE, DELETE or TRUNCATE for anybody (the service role and the table owner included). The one change that is let through is the foreign key action
-- that sets toda_admin_id / lgu_admin_id to NULL when an administrator account is deleted: every other column is compared and must be identical.
-- Changing the log is a migration, on purpose.
CREATE OR REPLACE FUNCTION public.audit_log_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (to_jsonb(NEW) - 'toda_admin_id' - 'lgu_admin_id') = (to_jsonb(OLD) - 'toda_admin_id' - 'lgu_admin_id')
           AND (NEW.toda_admin_id IS NULL OR NEW.toda_admin_id IS NOT DISTINCT FROM OLD.toda_admin_id)
           AND (NEW.lgu_admin_id IS NULL OR NEW.lgu_admin_id IS NOT DISTINCT FROM OLD.lgu_admin_id) THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'ERR_AUDIT_APPEND_ONLY: The audit log can only be added to. An entry cannot be changed or removed (Rule 28.4).' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trigger_audit_log_append_only ON public.audit_log;
CREATE TRIGGER trigger_audit_log_append_only BEFORE UPDATE OR DELETE ON public.audit_log
    FOR EACH ROW EXECUTE FUNCTION public.audit_log_append_only();
DROP TRIGGER IF EXISTS trigger_audit_log_no_truncate ON public.audit_log;
CREATE TRIGGER trigger_audit_log_no_truncate BEFORE TRUNCATE ON public.audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION public.audit_log_append_only();

-- The LGU's "FOR ALL" policy let the log be edited and deleted: gone. Reading (LGU: everything, a TODA Administrator: their own entries) and adding
-- (staff) stay as perimeter S3 made them.
DROP POLICY IF EXISTS audit_log_manage_lgu ON public.audit_log;
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log FROM authenticated, anon;

-- The actor is whoever is signed in (perimeter S1) and now the TIME is the server's too: a browser can no longer back-date its own entry. Verbatim copy of
-- 20261008000002 with the two timestamp lines marked "Batch 12".
CREATE OR REPLACE FUNCTION public.audit_log_stamp_actor()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_lgu UUID;
    v_toda UUID;
BEGIN
    IF COALESCE(public.is_service_context(), FALSE) OR v_uid IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT l.admin_id INTO v_lgu FROM public.lgu_admin l WHERE l.auth_user_id = v_uid AND l.account_status = 'Active' LIMIT 1;
    SELECT t.admin_id INTO v_toda FROM public.toda_admin t WHERE t.auth_user_id = v_uid AND t.account_status = 'Active' LIMIT 1;
    NEW.actor_id := v_uid;
    NEW.actor_role := CASE WHEN v_lgu IS NOT NULL THEN 'lgu_admin' WHEN v_toda IS NOT NULL THEN 'toda_admin' ELSE 'user' END;
    NEW.lgu_admin_id := v_lgu;
    NEW.toda_admin_id := v_toda;
    NEW.performed_at := clock_timestamp();                                  -- Batch 12
    NEW.created_at := NEW.performed_at;                                     -- Batch 12
    RETURN NEW;
END;
$$;

-- The page of the audit log the portals show and export: the LGU sees every entry, a TODA Administrator their own. The actor's name is read from the account
-- (never typed by the browser), the time is given in UTC and in Asia/Manila.
CREATE OR REPLACE FUNCTION public.get_audit_log(
    p_from TIMESTAMPTZ DEFAULT NULL,
    p_to TIMESTAMPTZ DEFAULT NULL,
    p_action TEXT DEFAULT NULL,
    p_search TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 200,
    p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_lgu BOOLEAN := COALESCE(public.is_lgu_admin(), FALSE);
    v_toda UUID;
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);
    v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
    v_q TEXT := lower(btrim(COALESCE(p_search, '')));
    v_total BIGINT;
    v_rows JSONB;
BEGIN
    IF NOT v_lgu THEN
        SELECT t.admin_id INTO v_toda FROM public.toda_admin t WHERE t.auth_user_id = auth.uid() AND t.account_status = 'Active' LIMIT 1;
        IF v_toda IS NULL THEN
            RAISE EXCEPTION 'Access Denied: Only an LGU or TODA Administrator can read the audit log.';
        END IF;
    END IF;

    SELECT count(*) INTO v_total
      FROM public.audit_log a
     WHERE (v_lgu OR a.toda_admin_id = v_toda)
       AND (p_from IS NULL OR a.performed_at >= p_from)
       AND (p_to IS NULL OR a.performed_at < p_to)
       AND (COALESCE(p_action, '') = '' OR a.action_type = p_action)
       AND (v_q = '' OR position(v_q IN lower(COALESCE(a.action_type, '') || ' ' || COALESCE(a.target_name, '') || ' ' || COALESCE(a.target_id, '') || ' ' || COALESCE(a.details, ''))) > 0);

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'log_id', x.log_id,
               'performed_at', x.performed_at,
               'performed_at_manila', to_char(x.performed_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD HH24:MI:SS'),
               'action_type', x.action_type,
               'category', x.category,
               'target_id', x.target_id,
               'target_name', x.target_name,
               'details', x.details,
               'before_state', x.before_state,
               'after_state', x.after_state,
               'actor_id', x.actor_id,
               'actor_role', x.actor_role,
               'actor_name', COALESCE(
                   (SELECT l.full_name FROM public.lgu_admin l WHERE l.auth_user_id = x.actor_id),
                   (SELECT t.full_name FROM public.toda_admin t WHERE t.auth_user_id = x.actor_id),
                   (SELECT l.full_name FROM public.lgu_admin l WHERE l.admin_id = x.lgu_admin_id),
                   (SELECT t.full_name FROM public.toda_admin t WHERE t.admin_id = x.toda_admin_id),
                   CASE WHEN x.actor_role IN ('driver', 'passenger') THEN initcap(x.actor_role) || ' (account holder)' END,
                   CASE WHEN x.actor_role IN ('system', 'system_scheduler') THEN 'SAKAY system' END,
                   'Not recorded')
           ) ORDER BY x.performed_at DESC, x.log_id), '[]'::jsonb)
      INTO v_rows
      FROM (
          SELECT a.*
            FROM public.audit_log a
           WHERE (v_lgu OR a.toda_admin_id = v_toda)
             AND (p_from IS NULL OR a.performed_at >= p_from)
             AND (p_to IS NULL OR a.performed_at < p_to)
             AND (COALESCE(p_action, '') = '' OR a.action_type = p_action)
             AND (v_q = '' OR position(v_q IN lower(COALESCE(a.action_type, '') || ' ' || COALESCE(a.target_name, '') || ' ' || COALESCE(a.target_id, '') || ' ' || COALESCE(a.details, ''))) > 0)
           ORDER BY a.performed_at DESC, a.log_id
           LIMIT v_limit OFFSET v_offset
      ) x;

    RETURN jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset, 'rows', v_rows);
END;
$$;

-- An export of the audit log is itself an audited action (who exported what, when).
CREATE OR REPLACE FUNCTION public.record_audit_export(p_format TEXT, p_row_count INTEGER, p_filters JSONB DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT (COALESCE(public.is_lgu_admin(), FALSE) OR COALESCE(public.is_toda_admin(), FALSE)) THEN
        RAISE EXCEPTION 'Access Denied: Only an LGU or TODA Administrator can export the audit log.';
    END IF;
    IF p_format IS NULL OR p_format NOT IN ('xlsx', 'csv', 'pdf') THEN
        RAISE EXCEPTION 'ERR_AUDIT_EXPORT_FORMAT: The format is xlsx, csv or pdf.';
    END IF;
    IF p_row_count IS NULL OR p_row_count < 0 OR p_row_count > 1000000 THEN
        RAISE EXCEPTION 'ERR_AUDIT_EXPORT_ROWS: The row count is not valid.';
    END IF;
    PERFORM public.record_policy_audit('AUDIT_LOG_EXPORTED', 'AUDIT_LOG', NULL, 'Audit',
        'Exported ' || p_row_count || ' audit log entries (' || p_format || ') for compliance review.',
        NULL, jsonb_build_object('format', p_format, 'rows', p_row_count, 'filters', COALESCE(p_filters, '{}'::jsonb)));
    RETURN jsonb_build_object('success', TRUE);
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. THE TWO TODA DECISIONS THAT WROTE NO AUDIT ROW
-- ----------------------------------------------------------------------------
-- Before: no caller check inside (the toda protection trigger refused a non-LGU caller indirectly), the TODA matched by ILIKE (a "%" matched every TODA), and the
-- audit entry was written by the browser afterwards. Now: the LGU only, one exact TODA, the audit entry (actor, before, after, reason) in the same transaction.
-- Found while testing the function below: "return for correction" has never been storable. The CHECK on toda.toda_status (it is called toda_account_status_check) does not
-- list 'Resubmission Required', the status the LGU portal and return_toda_accreditation() use, so every return failed (and the old browser fallbacks failed the same way).
ALTER TABLE public.toda DROP CONSTRAINT IF EXISTS toda_account_status_check;
ALTER TABLE public.toda ADD CONSTRAINT toda_account_status_check
    CHECK (toda_status::TEXT IN ('Pending Verification', 'Active', 'Suspended', 'Deactivated', 'Resubmission Required'));
-- ... and the same for the TODA's administrator account, which the same functions move to the same status (it only allowed Active and Suspended)
ALTER TABLE public.toda_admin DROP CONSTRAINT IF EXISTS toda_admin_account_status_check;
ALTER TABLE public.toda_admin ADD CONSTRAINT toda_admin_account_status_check
    CHECK (account_status::TEXT IN ('Active', 'Suspended', 'Pending Verification', 'Resubmission Required', 'Deactivated'));

CREATE OR REPLACE FUNCTION public._toda_by_ref(p_ref TEXT)
RETURNS public.toda
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v public.toda;
    n INTEGER;
BEGIN
    SELECT * INTO v FROM public.toda WHERE toda_id::TEXT = p_ref;
    IF FOUND THEN
        RETURN v;
    END IF;
    SELECT count(*) INTO n FROM public.toda WHERE lower(toda_acronym) = lower(p_ref);
    IF n = 1 THEN
        SELECT * INTO v FROM public.toda WHERE lower(toda_acronym) = lower(p_ref);
        RETURN v;
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.return_toda_accreditation(p_toda_id TEXT, p_reason TEXT DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
    v_old public.toda;
    v_toda public.toda;
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RAISE EXCEPTION 'Access Denied: Only the LGU Administrator can return a TODA application for correction.';
    END IF;
    v_old := public._toda_by_ref(p_toda_id);
    IF v_old.toda_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'TODA record not found in database');
    END IF;

    UPDATE public.toda
    SET toda_status = 'Resubmission Required',
        account_status = 'Resubmission Required',
        resubmission_reason = COALESCE(p_reason, 'Document correction required')
    WHERE toda_id = v_old.toda_id
    RETURNING * INTO v_toda;

    UPDATE public.toda_admin
    SET account_status = 'Resubmission Required'
    WHERE toda_id = v_toda.toda_id;

    PERFORM public.record_policy_audit('TODA_APPLICATION_RETURNED_FOR_CORRECTION', v_toda.toda_id::TEXT, v_toda.toda_name, 'Verification',
        'Returned the accreditation application for correction. Required correction: ' || COALESCE(p_reason, 'Document correction required'),
        jsonb_build_object('toda_status', v_old.toda_status, 'account_status', v_old.account_status),
        jsonb_build_object('toda_status', v_toda.toda_status, 'account_status', v_toda.account_status, 'resubmission_reason', v_toda.resubmission_reason));

    RETURN jsonb_build_object('success', true, 'data', to_jsonb(v_toda));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.deactivate_toda_accreditation(p_toda_id TEXT, p_reason TEXT DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
    v_old public.toda;
    v_toda public.toda;
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RAISE EXCEPTION 'Access Denied: Only the LGU Administrator can decline or deactivate a TODA accreditation.';
    END IF;
    v_old := public._toda_by_ref(p_toda_id);
    IF v_old.toda_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'TODA record not found in database');
    END IF;

    UPDATE public.toda
    SET toda_status = 'Deactivated',
        account_status = 'Deactivated',
        decline_reason = COALESCE(p_reason, 'Accreditation deactivated by LGU Transport Office')
    WHERE toda_id = v_old.toda_id
    RETURNING * INTO v_toda;

    UPDATE public.toda_admin
    SET account_status = 'Deactivated'
    WHERE toda_id = v_toda.toda_id;

    PERFORM public.record_policy_audit('TODA_APPLICATION_REJECTED', v_toda.toda_id::TEXT, v_toda.toda_name, 'Verification',
        'Declined or deactivated the TODA accreditation. Reason: ' || COALESCE(p_reason, 'Accreditation deactivated by LGU Transport Office'),
        jsonb_build_object('toda_status', v_old.toda_status, 'account_status', v_old.account_status),
        jsonb_build_object('toda_status', v_toda.toda_status, 'account_status', v_toda.account_status, 'decline_reason', v_toda.decline_reason));

    RETURN jsonb_build_object('success', true, 'data', to_jsonb(v_toda));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 6. LEGAL HOLD (Rule 28.3): records tied to an open case are kept until the case is closed
-- ----------------------------------------------------------------------------
-- Two kinds of hold. AUTOMATIC: an open incident report, an open fare dispute, an open exemption request, an open review flag that names the trip, an
-- unreconciled trip. MANUAL: the LGU Administrator places a hold on a trip, a driver or a passenger (an investigation that is not a case in the system).
CREATE TABLE IF NOT EXISTS public.legal_hold (
    hold_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_type   TEXT NOT NULL CHECK (subject_type IN ('booking', 'driver', 'passenger')),
    subject_id     UUID NOT NULL,
    case_ref       TEXT,
    reason         TEXT NOT NULL CHECK (length(btrim(reason)) >= 10),
    placed_by      UUID,
    placed_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    released_at    TIMESTAMPTZ,
    released_by    UUID,
    release_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_hold_open ON public.legal_hold (subject_type, subject_id) WHERE released_at IS NULL;
ALTER TABLE public.legal_hold ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_hold_select_lgu ON public.legal_hold;
CREATE POLICY legal_hold_select_lgu ON public.legal_hold FOR SELECT TO authenticated USING ((SELECT public.is_lgu_admin()));
REVOKE ALL ON public.legal_hold FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.legal_hold FROM authenticated;

-- Is a trip held? (a manual hold on the trip, its driver or its passenger, or an open case that names it)
CREATE OR REPLACE FUNCTION public._booking_is_held(p_booking_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT p_booking_id IS NOT NULL AND (
        EXISTS (SELECT 1 FROM public.legal_hold h
                 WHERE h.released_at IS NULL
                   AND ((h.subject_type = 'booking' AND h.subject_id = p_booking_id)
                        OR (h.subject_type = 'driver' AND h.subject_id = (SELECT b.driver_id FROM public.booking b WHERE b.booking_id = p_booking_id))
                        OR (h.subject_type = 'passenger' AND h.subject_id = (SELECT b.passenger_id FROM public.booking b WHERE b.booking_id = p_booking_id))))
        OR EXISTS (SELECT 1 FROM public.incident_report i WHERE i.booking_id = p_booking_id AND i.status NOT IN ('Resolved', 'Dismissed', 'Cancelled'))
        OR EXISTS (SELECT 1 FROM public.fare_dispute d WHERE d.booking_id = p_booking_id AND d.status <> 'Resolved')
        OR EXISTS (SELECT 1 FROM public.strikes_ledger s JOIN public.exemption_request e ON e.strike_id = s.strike_id
                    WHERE s.booking_id = p_booking_id AND e.status IN ('Pending TODA Review', 'Pending LGU Review'))
        OR EXISTS (SELECT 1 FROM public.admin_review_flag f
                    WHERE f.status IN ('Open', 'Under Review') AND position(p_booking_id::TEXT IN COALESCE(f.details::TEXT, '')) > 0)
        OR EXISTS (SELECT 1 FROM public.trip_connectivity_event c
                    WHERE c.booking_id = p_booking_id AND c.reconcile_flagged_at IS NOT NULL AND c.reconciled_at IS NULL)
    );
$$;

-- Is an account held? (a manual hold, or an open case about it)
CREATE OR REPLACE FUNCTION public._subject_is_held(p_subject_type TEXT, p_subject_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT p_subject_id IS NOT NULL AND (
        EXISTS (SELECT 1 FROM public.legal_hold h WHERE h.released_at IS NULL AND h.subject_type = p_subject_type AND h.subject_id = p_subject_id)
        OR EXISTS (SELECT 1 FROM public.admin_review_flag f
                    WHERE f.status IN ('Open', 'Under Review')
                      AND ((f.subject_type = p_subject_type AND f.subject_id = p_subject_id::TEXT)
                           OR position(p_subject_id::TEXT IN COALESCE(f.details::TEXT, '')) > 0))
        OR (p_subject_type = 'driver' AND EXISTS (SELECT 1 FROM public.incident_report i WHERE i.driver_id = p_subject_id AND i.status NOT IN ('Resolved', 'Dismissed', 'Cancelled')))
        OR (p_subject_type = 'passenger' AND EXISTS (SELECT 1 FROM public.incident_report i WHERE i.passenger_id = p_subject_id AND i.status NOT IN ('Resolved', 'Dismissed', 'Cancelled')))
        OR EXISTS (SELECT 1 FROM public.exemption_request e WHERE e.subject_type = p_subject_type AND e.subject_id = p_subject_id
                    AND e.status IN ('Pending TODA Review', 'Pending LGU Review'))
        -- Rule 27.7, figure F12.4: the documents of a driver found to have submitted false ones are evidence, kept until the case is closed (the LGU voids the entry)
        OR (p_subject_type = 'driver' AND EXISTS (SELECT 1 FROM public.strikes_ledger s
                    WHERE s.subject_type = 'driver' AND s.subject_id = p_subject_id AND s.violation_code = 'DRV_FALSE_DOCUMENTS'
                      AND s.status IN ('ACTIVE', 'PROVISIONAL', 'OBSERVED', 'PARTIALLY_WAIVED')))
        OR EXISTS (SELECT 1 FROM public.fare_dispute d JOIN public.booking b ON b.booking_id = d.booking_id
                    WHERE d.status <> 'Resolved'
                      AND ((p_subject_type = 'driver' AND b.driver_id = p_subject_id) OR (p_subject_type = 'passenger' AND b.passenger_id = p_subject_id)))
    );
$$;

CREATE OR REPLACE FUNCTION public.place_legal_hold(p_subject_type TEXT, p_subject_id UUID, p_case_ref TEXT, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_id UUID;
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RAISE EXCEPTION 'Access Denied: Only the LGU Administrator can place a legal hold.';
    END IF;
    IF p_subject_type IS NULL OR p_subject_type NOT IN ('booking', 'driver', 'passenger') OR p_subject_id IS NULL THEN
        RAISE EXCEPTION 'ERR_HOLD_SUBJECT: A hold is placed on a booking, a driver or a passenger.';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
        RAISE EXCEPTION 'ERR_HOLD_REASON: Write why the records are held (at least 10 characters).';
    END IF;
    INSERT INTO public.legal_hold (subject_type, subject_id, case_ref, reason, placed_by)
    VALUES (p_subject_type, p_subject_id, NULLIF(btrim(COALESCE(p_case_ref, '')), ''), btrim(p_reason), auth.uid())
    ON CONFLICT (subject_type, subject_id) WHERE released_at IS NULL DO NOTHING
    RETURNING hold_id INTO v_id;
    IF v_id IS NULL THEN
        SELECT hold_id INTO v_id FROM public.legal_hold WHERE subject_type = p_subject_type AND subject_id = p_subject_id AND released_at IS NULL;
        RETURN jsonb_build_object('success', TRUE, 'hold_id', v_id, 'idempotent', TRUE);
    END IF;
    PERFORM public.record_policy_audit('LEGAL_HOLD_PLACED', p_subject_id::TEXT, NULL, 'Retention',
        'Records held until the case is closed (' || p_subject_type || '). ' || btrim(p_reason), NULL,
        jsonb_build_object('hold_id', v_id, 'subject_type', p_subject_type, 'case_ref', p_case_ref));
    RETURN jsonb_build_object('success', TRUE, 'hold_id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_legal_hold(p_hold_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_h public.legal_hold;
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RAISE EXCEPTION 'Access Denied: Only the LGU Administrator can release a legal hold.';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
        RAISE EXCEPTION 'ERR_HOLD_REASON: Write why the hold is released (at least 10 characters).';
    END IF;
    SELECT * INTO v_h FROM public.legal_hold WHERE hold_id = p_hold_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_HOLD_NOT_FOUND: The hold was not found.';
    END IF;
    IF v_h.released_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', TRUE, 'idempotent', TRUE);
    END IF;
    UPDATE public.legal_hold SET released_at = clock_timestamp(), released_by = auth.uid(), release_reason = btrim(p_reason) WHERE hold_id = p_hold_id;
    PERFORM public.record_policy_audit('LEGAL_HOLD_RELEASED', v_h.subject_id::TEXT, NULL, 'Retention',
        'Legal hold released. ' || btrim(p_reason), jsonb_build_object('hold_id', p_hold_id, 'subject_type', v_h.subject_type), NULL);
    RETURN jsonb_build_object('success', TRUE);
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. RETENTION (Rules 28.1 - 28.3; decisions F12.2 - F12.5)
-- ----------------------------------------------------------------------------
-- Routine GPS fixes (F12.2): removed 90 days after they were recorded, trip by trip, unless the trip is held. A run removes at most purge_batch_rows rows.
CREATE OR REPLACE FUNCTION public.purge_expired_gps_logs()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_cutoff TIMESTAMPTZ := clock_timestamp() - make_interval(days => public.retention_constant('gps_log_days'));
    v_max INTEGER := public.retention_constant('purge_batch_rows');
    v_removed BIGINT := 0;
    v_held INTEGER := 0;
    v_n BIGINT;
    r RECORD;
BEGIN
    FOR r IN SELECT DISTINCT g.booking_id FROM public.gps_log g WHERE g.recorded_at < v_cutoff AND g.booking_id IS NOT NULL LOOP
        EXIT WHEN v_removed >= v_max;
        IF public._booking_is_held(r.booking_id) THEN
            v_held := v_held + 1;
            CONTINUE;
        END IF;
        DELETE FROM public.gps_log WHERE booking_id = r.booking_id AND recorded_at < v_cutoff;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_removed := v_removed + v_n;
    END LOOP;
    IF v_removed < v_max THEN
        DELETE FROM public.gps_log WHERE booking_id IS NULL AND recorded_at < v_cutoff;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_removed := v_removed + v_n;
    END IF;
    RETURN jsonb_build_object('gps_rows_removed', v_removed, 'trips_held', v_held, 'kept_days', public.retention_constant('gps_log_days'));
END;
$$;

-- Ended driver online sessions and trip connectivity events (F12.5): 90 days, unless the trip is held.
CREATE OR REPLACE FUNCTION public.purge_expired_sessions()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_cutoff TIMESTAMPTZ := clock_timestamp() - make_interval(days => public.retention_constant('session_days'));
    v_sessions BIGINT;
    v_events BIGINT;
BEGIN
    DELETE FROM public.driver_online_session WHERE ended_at IS NOT NULL AND ended_at < v_cutoff;
    GET DIAGNOSTICS v_sessions = ROW_COUNT;
    DELETE FROM public.trip_connectivity_event e
     WHERE e.started_at < v_cutoff AND NOT public._booking_is_held(e.booking_id);
    GET DIAGNOSTICS v_events = ROW_COUNT;
    RETURN jsonb_build_object('sessions_removed', v_sessions, 'connectivity_events_removed', v_events, 'kept_days', public.retention_constant('session_days'));
END;
$$;

-- Identity document images (F12.4). The database decides WHAT is due; the files themselves are removed by the server through the Storage API (deleting a
-- storage.objects row in SQL does not delete the file), which then confirms.
CREATE TABLE IF NOT EXISTS public.identity_document_retention (
    retention_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id    UUID REFERENCES public.driver(driver_id) ON DELETE SET NULL,
    storage_path TEXT NOT NULL,
    reason       TEXT NOT NULL CHECK (reason IN ('superseded', 'rejected', 'closed')),
    due_at       TIMESTAMPTZ NOT NULL,
    queued_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    purged_at    TIMESTAMPTZ,
    CONSTRAINT identity_document_retention_path_key UNIQUE (storage_path)
);
CREATE INDEX IF NOT EXISTS idx_identity_document_retention_due ON public.identity_document_retention (due_at) WHERE purged_at IS NULL;
ALTER TABLE public.identity_document_retention ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.identity_document_retention FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public._queue_identity_path(p_driver_id UUID, p_path TEXT, p_reason TEXT, p_due TIMESTAMPTZ)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    n INTEGER;
BEGIN
    IF p_path IS NULL OR btrim(p_path) = '' THEN
        RETURN 0;
    END IF;
    INSERT INTO public.identity_document_retention (driver_id, storage_path, reason, due_at)
    VALUES (p_driver_id, btrim(p_path), p_reason, p_due)
    ON CONFLICT (storage_path) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;

-- Is a stored path still the current image of someone's application?
CREATE OR REPLACE FUNCTION public._identity_path_in_use(p_path TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (SELECT 1 FROM public.driver d WHERE d.tricycle_photo_path = p_path)
        OR EXISTS (SELECT 1 FROM public.driver_verification v
                    WHERE p_path IN (v.face_photo_path, v.mtop_photo_path, v.license_front_photo_path, v.license_back_photo_path, v.tricycle_photo_path,
                                     v.pending_license_photo_url, v.pending_mtop_photo_url));
$$;

-- An image that is REPLACED (a returned document sent again, a new photo) is deleted 30 days later.
CREATE OR REPLACE FUNCTION public.queue_superseded_identity_documents()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_cols TEXT[] := ARRAY['face_photo_path', 'mtop_photo_path', 'license_front_photo_path', 'license_back_photo_path', 'tricycle_photo_path',
                           'pending_license_photo_url', 'pending_mtop_photo_url'];
    v_driver UUID := COALESCE((to_jsonb(NEW)->>'driver_id')::UUID, NULL);
    c TEXT;
    o TEXT;
    n TEXT;
BEGIN
    FOREACH c IN ARRAY v_cols LOOP
        o := to_jsonb(OLD)->>c;
        n := to_jsonb(NEW)->>c;
        IF o IS NOT NULL AND btrim(o) <> '' AND n IS DISTINCT FROM o THEN
            PERFORM public._queue_identity_path(v_driver, o, 'superseded', clock_timestamp() + make_interval(days => public.retention_constant('doc_superseded_days')));
        END IF;
    END LOOP;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trigger_driver_queue_superseded_docs ON public.driver;
CREATE TRIGGER trigger_driver_queue_superseded_docs AFTER UPDATE OF tricycle_photo_path ON public.driver
    FOR EACH ROW WHEN (OLD.tricycle_photo_path IS DISTINCT FROM NEW.tricycle_photo_path)
    EXECUTE FUNCTION public.queue_superseded_identity_documents();
DROP TRIGGER IF EXISTS trigger_verification_queue_superseded_docs ON public.driver_verification;
CREATE TRIGGER trigger_verification_queue_superseded_docs
    AFTER UPDATE OF face_photo_path, mtop_photo_path, license_front_photo_path, license_back_photo_path, tricycle_photo_path, pending_license_photo_url, pending_mtop_photo_url
    ON public.driver_verification
    FOR EACH ROW EXECUTE FUNCTION public.queue_superseded_identity_documents();

-- The images of a rejected application (30 days after the rejection) and of a closed account (12 months after the closure) are queued with their due date.
CREATE OR REPLACE FUNCTION public.queue_identity_documents()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    r RECORD;
    v_n INTEGER := 0;
    v_reason TEXT;
    v_due TIMESTAMPTZ;
BEGIN
    FOR r IN
        SELECT d.driver_id, d.account_status, d.rejected_at, d.closed_at, d.tricycle_photo_path,
               v.face_photo_path, v.mtop_photo_path, v.license_front_photo_path, v.license_back_photo_path, v.tricycle_photo_path AS v_tricycle,
               v.pending_license_photo_url, v.pending_mtop_photo_url
          FROM public.driver d
          LEFT JOIN public.driver_verification v ON v.driver_id = d.driver_id
         WHERE (d.account_status = 'Rejected' AND d.rejected_at IS NOT NULL) OR d.closed_at IS NOT NULL
    LOOP
        IF r.closed_at IS NOT NULL THEN
            v_reason := 'closed';
            v_due := r.closed_at + make_interval(months => public.retention_constant('doc_closed_months'));
        ELSE
            v_reason := 'rejected';
            v_due := r.rejected_at + make_interval(days => public.retention_constant('doc_rejected_days'));
        END IF;
        v_n := v_n + public._queue_identity_path(r.driver_id, r.tricycle_photo_path, v_reason, v_due)
                   + public._queue_identity_path(r.driver_id, r.face_photo_path, v_reason, v_due)
                   + public._queue_identity_path(r.driver_id, r.mtop_photo_path, v_reason, v_due)
                   + public._queue_identity_path(r.driver_id, r.license_front_photo_path, v_reason, v_due)
                   + public._queue_identity_path(r.driver_id, r.license_back_photo_path, v_reason, v_due)
                   + public._queue_identity_path(r.driver_id, r.v_tricycle, v_reason, v_due)
                   + public._queue_identity_path(r.driver_id, r.pending_license_photo_url, v_reason, v_due)
                   + public._queue_identity_path(r.driver_id, r.pending_mtop_photo_url, v_reason, v_due);
    END LOOP;
    RETURN v_n;
END;
$$;

-- What the server may delete now: due, not held, and still meant to go (a replaced image nobody uses any more; the images of a driver who is STILL rejected or
-- closed - a driver the LGU allowed to re-apply keeps them).
CREATE OR REPLACE FUNCTION public.get_expired_identity_documents(p_limit INTEGER DEFAULT 200)
RETURNS TABLE (retention_id UUID, storage_path TEXT, reason TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT q.retention_id, q.storage_path, q.reason
      FROM public.identity_document_retention q
     WHERE q.purged_at IS NULL
       AND q.due_at <= clock_timestamp()
       AND (q.driver_id IS NULL OR NOT public._subject_is_held('driver', q.driver_id))
       AND CASE q.reason
               WHEN 'superseded' THEN NOT public._identity_path_in_use(q.storage_path)
               ELSE EXISTS (SELECT 1 FROM public.driver d WHERE d.driver_id = q.driver_id AND (d.account_status = 'Rejected' OR d.closed_at IS NOT NULL))
           END
     ORDER BY q.due_at
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);
$$;

-- The server confirms the files are gone: the rows are stamped, the stored paths are cleared (a screen must not point at a deleted file), one audit entry.
CREATE OR REPLACE FUNCTION public.confirm_identity_documents_purged(p_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_paths TEXT[];
    v_n INTEGER;
    v_reasons JSONB;
BEGIN
    SELECT array_agg(q.storage_path) INTO v_paths
      FROM public.identity_document_retention q
     WHERE q.retention_id = ANY (COALESCE(p_ids, '{}')) AND q.purged_at IS NULL;
    IF v_paths IS NULL THEN
        RETURN jsonb_build_object('success', TRUE, 'purged', 0);
    END IF;
    SELECT COALESCE(jsonb_object_agg(t.reason, t.n), '{}'::jsonb) INTO v_reasons
      FROM (SELECT q.reason, count(*) AS n FROM public.identity_document_retention q
             WHERE q.retention_id = ANY (p_ids) AND q.purged_at IS NULL GROUP BY q.reason) t;
    UPDATE public.identity_document_retention SET purged_at = clock_timestamp() WHERE retention_id = ANY (p_ids) AND purged_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.driver SET tricycle_photo_path = NULL WHERE tricycle_photo_path = ANY (v_paths);
    UPDATE public.driver_verification
       SET face_photo_path = CASE WHEN face_photo_path = ANY (v_paths) THEN NULL ELSE face_photo_path END,
           mtop_photo_path = CASE WHEN mtop_photo_path = ANY (v_paths) THEN NULL ELSE mtop_photo_path END,
           license_front_photo_path = CASE WHEN license_front_photo_path = ANY (v_paths) THEN NULL ELSE license_front_photo_path END,
           license_back_photo_path = CASE WHEN license_back_photo_path = ANY (v_paths) THEN NULL ELSE license_back_photo_path END,
           tricycle_photo_path = CASE WHEN tricycle_photo_path = ANY (v_paths) THEN NULL ELSE tricycle_photo_path END,
           pending_license_photo_url = CASE WHEN pending_license_photo_url = ANY (v_paths) THEN NULL ELSE pending_license_photo_url END,
           pending_mtop_photo_url = CASE WHEN pending_mtop_photo_url = ANY (v_paths) THEN NULL ELSE pending_mtop_photo_url END
     WHERE face_photo_path = ANY (v_paths) OR mtop_photo_path = ANY (v_paths) OR license_front_photo_path = ANY (v_paths)
        OR license_back_photo_path = ANY (v_paths) OR tricycle_photo_path = ANY (v_paths)
        OR pending_license_photo_url = ANY (v_paths) OR pending_mtop_photo_url = ANY (v_paths);
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    PERFORM public.record_policy_audit('IDENTITY_DOCUMENTS_PURGED', 'IDENTITY_DOCUMENTS', NULL, 'Retention',
        'Identity document images deleted under the retention schedule (' || v_n || ').', NULL, jsonb_build_object('images', v_n, 'by_reason', v_reasons));
    RETURN jsonb_build_object('success', TRUE, 'purged', v_n);
END;
$$;

-- Accounts closed 5 years ago (F12.3): the personal identifiers go, the strike, suspension and exemption records stay, tied to an id and no name. An account
-- that is held (a case about it is open, or the LGU holds it) is left alone.
CREATE OR REPLACE FUNCTION public.anonymize_closed_accounts()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_cutoff TIMESTAMPTZ := clock_timestamp() - make_interval(years => public.retention_constant('closed_records_years'));
    r RECORD;
    v_drivers INTEGER := 0;
    v_passengers INTEGER := 0;
    v_held INTEGER := 0;
BEGIN
    PERFORM set_config('sakay.internal_context', 'true', true);
    FOR r IN SELECT driver_id FROM public.driver WHERE closed_at IS NOT NULL AND closed_at < v_cutoff AND anonymized_at IS NULL LOOP
        IF public._subject_is_held('driver', r.driver_id) THEN
            v_held := v_held + 1;
            CONTINUE;
        END IF;
        UPDATE public.driver
           SET full_name = 'Closed account', contact_number = 'closed-' || right(replace(r.driver_id::TEXT, '-', ''), 12), email = NULL, profile_photo_url = NULL,
               date_of_birth = NULL, residential_address = NULL, license_number = NULL, franchise_number = NULL, plate_number = NULL,
               toda_membership_number = NULL, chassis_number = NULL, vehicle_make = NULL, motor_number = NULL, or_number = NULL,
               anonymized_at = clock_timestamp()
         WHERE driver_id = r.driver_id;
        UPDATE public.driver_verification
           SET ocr_full_name = NULL, submitted_full_name = NULL, ocr_license_number = NULL, submitted_license_number = NULL, ocr_dob = NULL, submitted_dob = NULL,
               ocr_address = NULL, submitted_address = NULL, ocr_dl_codes = NULL, submitted_dl_codes = NULL, ocr_toda_membership_number = NULL,
               submitted_toda_membership_number = NULL, ocr_franchise_number = NULL, submitted_franchise_number = NULL, ocr_operator_name = NULL,
               submitted_operator_name = NULL, ocr_plate_number = NULL, submitted_plate_number = NULL, submitted_chassis_number = NULL,
               submitted_vehicle_make = NULL, submitted_motor_number = NULL, submitted_or_number = NULL
         WHERE driver_id = r.driver_id;
        UPDATE public.driver_toda_affiliation SET toda_membership_number = NULL WHERE driver_id = r.driver_id;
        PERFORM public.record_policy_audit('ACCOUNT_ANONYMIZED', r.driver_id::TEXT, NULL, 'Retention',
            'Personal identifiers removed 5 years after the account was closed (driver). The strike and suspension records are kept.', NULL, NULL);
        v_drivers := v_drivers + 1;
    END LOOP;
    FOR r IN SELECT passenger_id FROM public.passenger WHERE closed_at IS NOT NULL AND closed_at < v_cutoff AND anonymized_at IS NULL LOOP
        IF public._subject_is_held('passenger', r.passenger_id) THEN
            v_held := v_held + 1;
            CONTINUE;
        END IF;
        UPDATE public.passenger
           SET full_name = 'Closed account', contact_number = 'closed-' || right(replace(r.passenger_id::TEXT, '-', ''), 12), email = NULL, profile_photo_url = NULL,
               date_of_birth = NULL, residential_address = NULL, anonymized_at = clock_timestamp()
         WHERE passenger_id = r.passenger_id;
        PERFORM public.record_policy_audit('ACCOUNT_ANONYMIZED', r.passenger_id::TEXT, NULL, 'Retention',
            'Personal identifiers removed 5 years after the account was closed (passenger). The strike and suspension records are kept.', NULL, NULL);
        v_passengers := v_passengers + 1;
    END LOOP;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('drivers_anonymized', v_drivers, 'passengers_anonymized', v_passengers, 'held', v_held);
END;
$$;

-- The daily job (03:42 in Manila): the database part of the schedule. One audit entry per run that did something. The image files are the server's part
-- (/api/scheduler/run-retention calls this first, then removes the due files and confirms them).
CREATE OR REPLACE FUNCTION public.run_retention_job()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_gps JSONB;
    v_ses JSONB;
    v_queued INTEGER;
    v_anon JSONB;
    v_result JSONB;
BEGIN
    PERFORM set_config('sakay.internal_context', 'true', true);
    v_gps := public.purge_expired_gps_logs();
    v_ses := public.purge_expired_sessions();
    v_queued := public.queue_identity_documents();
    v_anon := public.anonymize_closed_accounts();
    v_result := jsonb_build_object('gps', v_gps, 'sessions', v_ses, 'images_queued', v_queued, 'anonymized', v_anon);
    IF (v_gps->>'gps_rows_removed')::BIGINT > 0 OR (v_ses->>'sessions_removed')::BIGINT > 0 OR (v_ses->>'connectivity_events_removed')::BIGINT > 0
       OR v_queued > 0 OR (v_anon->>'drivers_anonymized')::INTEGER > 0 OR (v_anon->>'passengers_anonymized')::INTEGER > 0 THEN
        PERFORM public.record_policy_audit('RETENTION_JOB_RUN', 'RETENTION_JOB', NULL, 'Retention',
            'Daily retention run: old GPS fixes, sessions and connectivity events removed, identity images queued, closed accounts anonymized.', NULL, v_result);
    END IF;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN v_result;
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. DETECTORS (Rules 27.1, 27.3 - 27.6): review flags only, never an automatic strike
-- ----------------------------------------------------------------------------
-- One flag per case: a flag the administrator already closed for the SAME evidence (its signature) is not raised again.
CREATE OR REPLACE FUNCTION public._integrity_flag(p_type TEXT, p_subject_type TEXT, p_subject_id TEXT, p_rule TEXT, p_details JSONB, p_signature TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.admin_review_flag f
                WHERE f.flag_type = p_type AND f.subject_type = p_subject_type AND f.subject_id = p_subject_id AND f.details->>'signature' = p_signature) THEN
        RETURN NULL;
    END IF;
    RETURN public.create_admin_review_flag(p_type, p_subject_type, p_subject_id, p_rule, 'lgu_admin', COALESCE(p_details, '{}'::jsonb) || jsonb_build_object('signature', p_signature));
END;
$$;

-- Rule 27.1, GPS spoofing or a falsified distance (F12.6). From the track of a driver's last completed trips, with the fare's own filter (accuracy and speed):
--   * teleports: fixes that jump faster than the fare allows (accuracy within the fare's limit): 3 in one trip makes the trip suspect, 10 is enough alone
--   * a distance far from the route that was quoted (more than 40 percent AND more than 1 km), only for a trip with no hole in its track, no early end, not Shared
-- Two suspect trips among the last ten raise the flag. A single bad fix, a tunnel or a long silence never does.
CREATE OR REPLACE FUNCTION public._integrity_gps_sweep()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    d RECORD;
    t RECORD;
    s JSONB;
    v_flags INTEGER := 0;
    v_suspect JSONB;
    v_count INTEGER;
    v_heavy BOOLEAN;
    v_tele INTEGER;
    v_mis BOOLEAN;
    v_track NUMERIC;
    v_est NUMERIC;
    v_sig TEXT;
BEGIN
    FOR d IN
        SELECT DISTINCT b.driver_id FROM public.booking b
         WHERE b.driver_id IS NOT NULL AND b.booking_status = 'Completed' AND b.trip_completed_at >= clock_timestamp() - INTERVAL '2 days'
    LOOP
        v_suspect := '[]'::jsonb;  v_count := 0;  v_heavy := FALSE;
        FOR t IN
            SELECT b.booking_id, b.estimated_distance_km, b.early_end_kind, b.is_shared_trip
              FROM public.booking b
             WHERE b.driver_id = d.driver_id AND b.booking_status = 'Completed'
             ORDER BY b.trip_completed_at DESC NULLS LAST, b.booking_id
             LIMIT public.integrity_constant('gps_spoof_repeat_window_trips')
        LOOP
            s := public._trip_track_summary(t.booking_id);
            v_tele := COALESCE((s->>'rejected_speed')::INTEGER, 0);
            v_mis := FALSE;  v_track := NULL;  v_est := NULL;
            IF NOT COALESCE(t.is_shared_trip, FALSE) AND t.early_end_kind IS NULL
               AND NOT COALESCE((s->>'gap_flag')::BOOLEAN, FALSE) AND COALESCE((s->>'fixes_usable')::INTEGER, 0) >= 2
               AND COALESCE(t.estimated_distance_km, 0) > 0 THEN
                v_track := (s->>'distance_km')::NUMERIC;
                v_est := t.estimated_distance_km;
                v_mis := abs(v_track - v_est) * 1000 > public.integrity_constant('gps_distance_mismatch_m')
                         AND abs(v_track - v_est) > v_est * public.integrity_constant('gps_distance_mismatch_pct') / 100.0;
            END IF;
            IF v_tele >= public.integrity_constant('gps_spoof_teleport_fixes') OR v_mis THEN
                v_count := v_count + 1;
                v_suspect := v_suspect || jsonb_build_object('booking_id', t.booking_id, 'teleport_fixes', v_tele, 'fixes_total', (s->>'fixes_total')::INTEGER,
                    'distance_mismatch', v_mis, 'tracked_km', v_track, 'quoted_km', v_est);
            END IF;
            IF v_tele >= public.integrity_constant('gps_spoof_heavy_fixes') THEN
                v_heavy := TRUE;
            END IF;
        END LOOP;
        IF v_count >= public.integrity_constant('gps_spoof_repeat_trips') OR v_heavy THEN
            SELECT md5(string_agg(x->>'booking_id', ',' ORDER BY x->>'booking_id')) INTO v_sig FROM jsonb_array_elements(v_suspect) x;
            IF public._integrity_flag('GPS_SPOOFING_REVIEW', 'driver', d.driver_id::TEXT, 'Rule 27.1',
                jsonb_build_object('suspect_trips', v_suspect, 'suspect_count', v_count, 'window_trips', public.integrity_constant('gps_spoof_repeat_window_trips'),
                    'parties', jsonb_build_array(jsonb_build_object('type', 'driver', 'id', d.driver_id)),
                    'note', 'The GPS track of recent trips shows impossible jumps or a distance far from the quoted route. Review before any decision (Rule 27.1).'),
                v_sig) IS NOT NULL THEN
                v_flags := v_flags + 1;
            END IF;
        END IF;
    END LOOP;
    RETURN v_flags;
END;
$$;

-- Rule 27.5, rating manipulation (F12.7): reciprocal five-star pairs, concentration, burst. The flag carries the ratings and the accounts concerned.
CREATE OR REPLACE FUNCTION public._integrity_rating_sweep()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    r RECORD;
    v_flags INTEGER := 0;
    v_ids UUID[];
    v_sig TEXT;
    v_window INTERVAL := make_interval(days => public.integrity_constant('rm_pair_window_days'));
BEGIN
    -- 1. reciprocal five-star pair: one driver and one passenger, both gave the top rating on at least 5 completed trips in the window
    FOR r IN
        SELECT b.driver_id, b.passenger_id, count(*) AS trips, array_agg(rp.rating_id) || array_agg(rd.rating_id) AS rating_ids
          FROM public.booking b
          JOIN public.rating rp ON rp.booking_id = b.booking_id AND lower(rp.rater_role) = 'passenger' AND rp.stars = 5 AND NOT rp.is_excluded
          JOIN public.rating rd ON rd.booking_id = b.booking_id AND lower(rd.rater_role) = 'driver' AND rd.stars = 5 AND NOT rd.is_excluded
         WHERE b.booking_status = 'Completed' AND b.driver_id IS NOT NULL AND b.passenger_id IS NOT NULL
           AND GREATEST(rp.created_at, rd.created_at) >= clock_timestamp() - v_window
         GROUP BY b.driver_id, b.passenger_id
        HAVING count(*) >= public.integrity_constant('rm_pair_trips')
    LOOP
        SELECT md5(string_agg(x::TEXT, ',' ORDER BY x::TEXT)) INTO v_sig FROM unnest(r.rating_ids) x;
        IF public._integrity_flag('RATING_MANIPULATION_REVIEW', 'driver', r.driver_id::TEXT, 'Rule 27.5',
            jsonb_build_object('pattern', 'RECIPROCAL_FIVE_STAR', 'trips', r.trips, 'window_days', public.integrity_constant('rm_pair_window_days'),
                'rating_ids', to_jsonb(r.rating_ids),
                'parties', jsonb_build_array(jsonb_build_object('type', 'driver', 'id', r.driver_id), jsonb_build_object('type', 'passenger', 'id', r.passenger_id)),
                'note', 'A driver and a passenger gave each other the top rating on many trips in a short time (Rule 27.5).'),
            v_sig) IS NOT NULL THEN
            v_flags := v_flags + 1;
        END IF;
    END LOOP;

    -- 2. concentration: most of a driver's recent ratings come from one or two passengers, and the mean is very high
    FOR r IN
        WITH rr AS (
            SELECT x.ratee_id AS driver_id, x.rater_id, x.rating_id, x.stars
              FROM public.rating x JOIN public.booking b ON b.booking_id = x.booking_id
             WHERE lower(x.rater_role) = 'passenger' AND NOT x.is_excluded AND b.booking_status = 'Completed'
               AND x.created_at >= clock_timestamp() - make_interval(days => public.integrity_constant('rm_conc_window_days'))
        ), tot AS (
            SELECT driver_id, count(*) AS n, avg(stars) AS mean FROM rr GROUP BY driver_id HAVING count(*) >= public.integrity_constant('rm_conc_min_ratings')
        ), per AS (
            SELECT driver_id, rater_id, count(*) AS c, row_number() OVER (PARTITION BY driver_id ORDER BY count(*) DESC, rater_id) AS rk FROM rr GROUP BY driver_id, rater_id
        )
        SELECT t.driver_id, t.n, round(t.mean, 2) AS mean, sum(p.c) AS top_n, array_agg(p.rater_id) AS raters
          FROM tot t JOIN per p ON p.driver_id = t.driver_id AND p.rk <= public.integrity_constant('rm_conc_max_raters')
         GROUP BY t.driver_id, t.n, t.mean
        HAVING sum(p.c) * 100 >= t.n * public.integrity_constant('rm_conc_share_pct') AND t.mean * 10 >= public.integrity_constant('rm_conc_mean_x10')
    LOOP
        SELECT array_agg(x.rating_id) INTO v_ids
          FROM public.rating x JOIN public.booking b ON b.booking_id = x.booking_id
         WHERE x.ratee_id = r.driver_id AND lower(x.rater_role) = 'passenger' AND NOT x.is_excluded AND b.booking_status = 'Completed'
           AND x.rater_id = ANY (r.raters)
           AND x.created_at >= clock_timestamp() - make_interval(days => public.integrity_constant('rm_conc_window_days'));
        SELECT md5(string_agg(x::TEXT, ',' ORDER BY x::TEXT)) INTO v_sig FROM unnest(v_ids) x;
        IF public._integrity_flag('RATING_MANIPULATION_REVIEW', 'driver', r.driver_id::TEXT, 'Rule 27.5',
            jsonb_build_object('pattern', 'CONCENTRATION', 'ratings', r.n, 'top_raters_ratings', r.top_n, 'mean', r.mean, 'rating_ids', to_jsonb(v_ids),
                'parties', (SELECT jsonb_agg(jsonb_build_object('type', 'passenger', 'id', q)) FROM unnest(r.raters) q) || jsonb_build_array(jsonb_build_object('type', 'driver', 'id', r.driver_id)),
                'note', 'Most of this driver''s recent ratings come from one or two passengers and the average is very high (Rule 27.5).'),
            v_sig) IS NOT NULL THEN
            v_flags := v_flags + 1;
        END IF;
    END LOOP;

    -- 3. burst: one account gave five or more ratings inside ten minutes (a script, or ratings that cannot belong to separate trips)
    FOR r IN
        SELECT DISTINCT ON (w.rater_id) w.rater_id, w.rater_role, w.start_at, w.c
          FROM (
              SELECT a.rater_id, a.rater_role, a.created_at AS start_at,
                     (SELECT count(*) FROM public.rating z
                       WHERE z.rater_id = a.rater_id AND NOT z.is_excluded AND z.created_at >= a.created_at
                         AND z.created_at < a.created_at + make_interval(mins => public.integrity_constant('rm_burst_minutes'))) AS c
                FROM public.rating a
               WHERE a.created_at >= clock_timestamp() - v_window
          ) w
         WHERE w.c >= public.integrity_constant('rm_burst_count')
         ORDER BY w.rater_id, w.start_at
    LOOP
        SELECT array_agg(z.rating_id) INTO v_ids FROM public.rating z
         WHERE z.rater_id = r.rater_id AND NOT z.is_excluded AND z.created_at >= r.start_at
           AND z.created_at < r.start_at + make_interval(mins => public.integrity_constant('rm_burst_minutes'));
        SELECT md5(string_agg(x::TEXT, ',' ORDER BY x::TEXT)) INTO v_sig FROM unnest(v_ids) x;
        IF public._integrity_flag('RATING_MANIPULATION_REVIEW', CASE WHEN lower(r.rater_role) = 'driver' THEN 'driver' ELSE 'passenger' END, r.rater_id::TEXT, 'Rule 27.5',
            jsonb_build_object('pattern', 'BURST', 'ratings', r.c, 'minutes', public.integrity_constant('rm_burst_minutes'), 'rating_ids', to_jsonb(v_ids),
                'parties', jsonb_build_array(jsonb_build_object('type', CASE WHEN lower(r.rater_role) = 'driver' THEN 'driver' ELSE 'passenger' END, 'id', r.rater_id)),
                'note', 'One account gave many ratings within minutes (Rule 27.5).'),
            v_sig) IS NOT NULL THEN
            v_flags := v_flags + 1;
        END IF;
    END LOOP;
    RETURN v_flags;
END;
$$;

-- Rule 27.4, collusive Shared Trip matching: one driver and one joining passenger Matched again and again in the window. The data was kept since Batch 10.
CREATE OR REPLACE FUNCTION public._integrity_collusion_sweep()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    r RECORD;
    v_flags INTEGER := 0;
    v_sig TEXT;
BEGIN
    FOR r IN
        SELECT m.host_driver_id AS driver_id, ab.passenger_id, count(*) AS matches, array_agg(m.match_id) AS match_ids
          FROM public.shared_trip_match m
          JOIN public.booking ab ON ab.booking_id = m.additional_booking_id
         WHERE m.match_status = 'Matched' AND m.host_driver_id IS NOT NULL AND ab.passenger_id IS NOT NULL
           AND COALESCE(m.matched_at, m.created_at) >= clock_timestamp() - make_interval(days => public.integrity_constant('coll_window_days'))
         GROUP BY m.host_driver_id, ab.passenger_id
        HAVING count(*) >= public.integrity_constant('coll_matches')
    LOOP
        SELECT md5(string_agg(x::TEXT, ',' ORDER BY x::TEXT)) INTO v_sig FROM unnest(r.match_ids) x;
        IF public._integrity_flag('COLLUSIVE_MATCHING_REVIEW', 'driver', r.driver_id::TEXT, 'Rule 27.4',
            jsonb_build_object('matches', r.matches, 'window_days', public.integrity_constant('coll_window_days'), 'match_ids', to_jsonb(r.match_ids),
                'passenger_id', r.passenger_id,
                'parties', jsonb_build_array(jsonb_build_object('type', 'driver', 'id', r.driver_id), jsonb_build_object('type', 'passenger', 'id', r.passenger_id)),
                'note', 'The same driver and passenger were matched on a Shared Trip many times in a short time. Check that the routes were really compatible (Rule 27.4).'),
            v_sig) IS NOT NULL THEN
            v_flags := v_flags + 1;
        END IF;
    END LOOP;
    RETURN v_flags;
END;
$$;

-- Rules 27.3 / 27.6, a new account that matches a sanctioned one: the same name and birth date (passenger or driver), or the same license or plate (driver).
-- The signals are the ones the system already holds; no device identifier is collected. The flag names the linked accounts; the LGU decides.
CREATE OR REPLACE FUNCTION public._integrity_rereg_sweep()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    r RECORD;
    v_flags INTEGER := 0;
    v_sig TEXT;
    v_since TIMESTAMPTZ := clock_timestamp() - make_interval(days => public.integrity_constant('rereg_lookback_days'));
BEGIN
    FOR r IN
        SELECT n.passenger_id AS new_id,
               jsonb_agg(jsonb_build_object('type', 'passenger', 'id', o.passenger_id, 'state', public.account_restriction_state('passenger', o.passenger_id)->>'kind') ORDER BY o.passenger_id) AS linked,
               md5(string_agg(o.passenger_id::TEXT, ',' ORDER BY o.passenger_id)) AS sig
          FROM public.passenger n
          JOIN public.passenger o ON o.passenger_id <> n.passenger_id AND o.anonymized_at IS NULL
               AND regexp_replace(lower(o.full_name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(n.full_name), '[^a-z0-9]', '', 'g')
               AND o.date_of_birth = n.date_of_birth
         WHERE n.created_at >= v_since AND n.anonymized_at IS NULL AND n.date_of_birth IS NOT NULL
           AND (o.closed_at IS NOT NULL OR COALESCE((public.account_restriction_state('passenger', o.passenger_id)->>'restricted')::BOOLEAN, FALSE))
         GROUP BY n.passenger_id
    LOOP
        v_sig := r.sig;
        IF public._integrity_flag('POSSIBLE_REREGISTRATION_REVIEW', 'passenger', r.new_id::TEXT, 'Rules 27.3, 27.6',
            jsonb_build_object('basis', jsonb_build_array('name_and_birth_date'), 'linked', r.linked,
                'parties', jsonb_build_array(jsonb_build_object('type', 'passenger', 'id', r.new_id)) || r.linked,
                'note', 'A new account has the same name and birth date as an account that was suspended, deactivated or closed. Confirm the link before any decision (Rules 27.3, 27.6).'),
            v_sig) IS NOT NULL THEN
            v_flags := v_flags + 1;
        END IF;
    END LOOP;

    FOR r IN
        SELECT n.driver_id AS new_id,
               jsonb_agg(jsonb_build_object('type', 'driver', 'id', o.driver_id, 'state', public.account_restriction_state('driver', o.driver_id)->>'kind') ORDER BY o.driver_id) AS linked,
               md5(string_agg(o.driver_id::TEXT, ',' ORDER BY o.driver_id)) AS sig,
               bool_or(regexp_replace(lower(o.full_name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(n.full_name), '[^a-z0-9]', '', 'g') AND o.date_of_birth = n.date_of_birth) AS by_name,
               bool_or(COALESCE(regexp_replace(upper(n.license_number), '[^A-Z0-9]', '', 'g'), '') <> '' AND regexp_replace(upper(o.license_number), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(n.license_number), '[^A-Z0-9]', '', 'g')) AS by_license,
               bool_or(COALESCE(regexp_replace(upper(n.plate_number), '[^A-Z0-9]', '', 'g'), '') <> '' AND regexp_replace(upper(o.plate_number), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(n.plate_number), '[^A-Z0-9]', '', 'g')) AS by_plate
          FROM public.driver n
          JOIN public.driver o ON o.driver_id <> n.driver_id AND o.anonymized_at IS NULL
               AND ((regexp_replace(lower(o.full_name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(n.full_name), '[^a-z0-9]', '', 'g') AND o.date_of_birth = n.date_of_birth AND n.date_of_birth IS NOT NULL)
                    OR (COALESCE(regexp_replace(upper(n.license_number), '[^A-Z0-9]', '', 'g'), '') <> '' AND regexp_replace(upper(o.license_number), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(n.license_number), '[^A-Z0-9]', '', 'g'))
                    OR (COALESCE(regexp_replace(upper(n.plate_number), '[^A-Z0-9]', '', 'g'), '') <> '' AND regexp_replace(upper(o.plate_number), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(n.plate_number), '[^A-Z0-9]', '', 'g')))
         WHERE n.created_at >= v_since AND n.anonymized_at IS NULL
           AND (o.closed_at IS NOT NULL OR o.is_permanently_disqualified OR COALESCE((public.account_restriction_state('driver', o.driver_id)->>'restricted')::BOOLEAN, FALSE))
         GROUP BY n.driver_id
    LOOP
        v_sig := r.sig;
        IF public._integrity_flag('POSSIBLE_REREGISTRATION_REVIEW', 'driver', r.new_id::TEXT, 'Rules 27.3, 27.6',
            jsonb_build_object('basis', (SELECT jsonb_agg(b) FROM unnest(ARRAY[CASE WHEN r.by_name THEN 'name_and_birth_date' END, CASE WHEN r.by_license THEN 'license_number' END, CASE WHEN r.by_plate THEN 'plate_number' END]) b WHERE b IS NOT NULL),
                'linked', r.linked,
                'parties', jsonb_build_array(jsonb_build_object('type', 'driver', 'id', r.new_id)) || r.linked,
                'note', 'A new driver account matches a suspended, deactivated, closed or disqualified one (name and birth date, license or plate). Confirm the link before any decision (Rules 27.3, 27.6).'),
            v_sig) IS NOT NULL THEN
            v_flags := v_flags + 1;
        END IF;
    END LOOP;
    RETURN v_flags;
END;
$$;

-- Rules 23.3 / 23.4 for accounts whose trip count crossed 20 without a new rating: the cached mean prefilters, the exact check decides.
CREATE OR REPLACE FUNCTION public._integrity_rating_review_sweep()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    r RECORD;
    v_n INTEGER := 0;
BEGIN
    FOR r IN SELECT driver_id FROM public.driver WHERE rating_count > 0 AND weighted_average_rating <= 3.00 LOOP
        IF public._rating_review_check('driver', r.driver_id) IS NOT NULL THEN v_n := v_n + 1; END IF;
    END LOOP;
    FOR r IN SELECT passenger_id FROM public.passenger WHERE rating_count > 0 AND average_rating <= 3.00 LOOP
        IF public._rating_review_check('passenger', r.passenger_id) IS NOT NULL THEN v_n := v_n + 1; END IF;
    END LOOP;
    RETURN v_n;
END;
$$;

-- The daily sweep (03:27 in Manila). Idempotent: a repeated run raises no second flag.
CREATE OR REPLACE FUNCTION public.run_integrity_sweep()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_result JSONB;
BEGIN
    PERFORM set_config('sakay.internal_context', 'true', true);
    v_result := jsonb_build_object(
        'rating_reviews', public._integrity_rating_review_sweep(),
        'gps_flags', public._integrity_gps_sweep(),
        'rating_manipulation_flags', public._integrity_rating_sweep(),
        'collusion_flags', public._integrity_collusion_sweep(),
        'reregistration_flags', public._integrity_rereg_sweep());
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN v_result;
END;
$$;

-- The LGU Administrator's decision on a detector flag (Rules 27.1, 27.3 - 27.6): confirming records the violation against every account the flag names, as that
-- administrator, with the reason: a GPS spoofing suspends the driver pending investigation; rating manipulation excludes the ratings and strikes the accounts
-- (2 strikes each); collusive matching and a linked account deactivate for review. Closing the accounts for good stays the separate, audited admin_close_account.
-- Dismissing the flag is the ordinary resolve_admin_review_flag.
CREATE OR REPLACE FUNCTION public.admin_confirm_integrity_flag(p_flag_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_f public.admin_review_flag;
    v_party JSONB;
    v_type TEXT;
    v_id UUID;
    v_code TEXT;
    v_rid TEXT;
    v_strikes JSONB := '[]'::jsonb;
    v_excluded INTEGER := 0;
    v_res JSONB;
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RAISE EXCEPTION 'Access Denied: Only the LGU Administrator can confirm this violation.';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
        RAISE EXCEPTION 'ERR_CONFIRM_REASON: Write why the violation is confirmed (at least 10 characters).';
    END IF;
    SELECT * INTO v_f FROM public.admin_review_flag WHERE flag_id = p_flag_id AND status IN ('Open', 'Under Review') FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_FLAG_NOT_OPEN: The review flag was not found or is already closed.';
    END IF;
    IF v_f.flag_type NOT IN ('GPS_SPOOFING_REVIEW', 'RATING_MANIPULATION_REVIEW', 'COLLUSIVE_MATCHING_REVIEW', 'POSSIBLE_REREGISTRATION_REVIEW') THEN
        RAISE EXCEPTION 'ERR_FLAG_NOT_CONFIRMABLE: A violation cannot be confirmed from a % flag.', v_f.flag_type;
    END IF;

    IF v_f.flag_type = 'RATING_MANIPULATION_REVIEW' THEN
        FOR v_rid IN SELECT jsonb_array_elements_text(COALESCE(v_f.details->'rating_ids', '[]'::jsonb)) LOOP
            IF public._set_rating_excluded(v_rid::UUID, TRUE, 'Rating manipulation confirmed (Rule 27.5): ' || btrim(p_reason)) THEN
                v_excluded := v_excluded + 1;
            END IF;
        END LOOP;
    END IF;

    FOR v_party IN SELECT jsonb_array_elements(COALESCE(v_f.details->'parties', '[]'::jsonb)) LOOP
        v_type := v_party->>'type';
        v_id := (v_party->>'id')::UUID;
        v_code := CASE v_f.flag_type
            WHEN 'GPS_SPOOFING_REVIEW'            THEN CASE WHEN v_type = 'driver' THEN 'DRV_GPS_SPOOFING' END
            WHEN 'RATING_MANIPULATION_REVIEW'     THEN CASE WHEN v_type = 'driver' THEN 'DRV_RATING_MANIPULATION' ELSE 'PAX_RATING_MANIPULATION' END
            WHEN 'COLLUSIVE_MATCHING_REVIEW'      THEN CASE WHEN v_type = 'driver' THEN 'DRV_COLLUSIVE_MATCH' ELSE 'PAX_COLLUSIVE_MATCH' END
            WHEN 'POSSIBLE_REREGISTRATION_REVIEW' THEN CASE WHEN v_type = 'driver' THEN 'DRV_MULTI_ACCOUNT' ELSE 'PAX_MULTI_ACCOUNT' END
        END;
        CONTINUE WHEN v_code IS NULL OR v_id IS NULL;
        CONTINUE WHEN COALESCE(public.account_restriction_state(v_type, v_id)->>'kind', '') = 'CLOSED';
        v_res := public.issue_strike(v_type, v_id, v_code, NULL, NULL, NULL, 'INTEGRITY:' || p_flag_id::TEXT || ':' || v_id::TEXT, NULL, btrim(p_reason), NULL,
            jsonb_build_object('flag_id', p_flag_id, 'flag_type', v_f.flag_type, 'rule', v_f.source_rule));
        v_strikes := v_strikes || jsonb_build_array(jsonb_build_object('type', v_type, 'id', v_id, 'code', v_code, 'result', v_res));
    END LOOP;

    PERFORM public.resolve_admin_review_flag(p_flag_id, 'Resolved', 'Violation confirmed: ' || btrim(p_reason));
    PERFORM public.record_policy_audit('INTEGRITY_FLAG_CONFIRMED', v_f.subject_id, NULL, 'Fraud & Integrity',
        'Confirmed ' || v_f.flag_type || ' (' || v_f.source_rule || '). ' || btrim(p_reason), to_jsonb(v_f),
        jsonb_build_object('strikes', v_strikes, 'ratings_excluded', v_excluded));
    RETURN jsonb_build_object('success', TRUE, 'strikes', v_strikes, 'ratings_excluded', v_excluded);
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. NEW VIOLATION CODES (decision PI-09 / Rule 27.5; decided by the owner 2026-10-15)
-- ----------------------------------------------------------------------------
INSERT INTO public.violation_catalog
    (violation_code, applies_to, description, source_rule, default_points, min_points, max_points,
     confirmation_mode, event_category, exemption_eligible, provisional_by_default, pausable,
     repeat_min_occurrences, ladder_bypass, review_flag_type, rules_note)
VALUES
    ('PAX_RATING_MANIPULATION', 'passenger', 'Rating manipulation (coordinated top ratings, scripts)', 'Rule 27.5',
        2, 2, 2, 'ADMIN_CONFIRMATION', 'INTEGRITY', FALSE, FALSE, FALSE, 1, 'NONE', NULL,
        'Batch 12: 2 strikes, the affected ratings are excluded (Rules 23.5, 27.5). Confirmed by the LGU Administrator from a RATING_MANIPULATION_REVIEW flag.'),
    ('DRV_RATING_MANIPULATION', 'driver', 'Rating manipulation (coordinated top ratings, scripts)', 'Rule 27.5',
        2, 2, 2, 'ADMIN_CONFIRMATION', 'INTEGRITY', FALSE, FALSE, FALSE, 1, 'NONE', NULL,
        'Batch 12: 2 strikes, the affected ratings are excluded (Rules 23.5, 27.5). Confirmed by the LGU Administrator from a RATING_MANIPULATION_REVIEW flag.'),
    ('DRV_MULTI_ACCOUNT', 'driver', 'Multiple driver accounts used to evade sanctions or re-registration after a sanction', 'Rules 27.3, 27.6',
        0, 0, 0, 'ADMIN_CONFIRMATION', 'INTEGRITY', FALSE, FALSE, FALSE, 1, 'DEACTIVATE_FOR_REVIEW', NULL,
        'Batch 12: deactivates for review; the LGU Administrator decides the permanent closure of all linked accounts (admin_close_account).'),
    ('DRV_FALSE_DOCUMENTS', 'driver', 'False, altered or manipulated verification documents', 'Rule 27.7',
        0, 0, 0, 'ADMIN_CONFIRMATION', 'INTEGRITY', FALSE, FALSE, FALSE, 1, 'DEACTIVATE_FOR_REVIEW', NULL,
        'Batch 12: deactivates for review; the documents are held (not deleted) until the case is closed.')
ON CONFLICT (violation_code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 10. RULE 27.2: "UNREGISTERED PERSON DRIVING" IS AN INCIDENT CATEGORY (SERIOUS: straight to the LGU Administrator)
-- ----------------------------------------------------------------------------
-- Verbatim copies of the Batch 11 definitions with the marked "Batch 12" lines. incident_report_guard asks _incident_category_class() for the list, so it
-- does not change. An upheld report may carry DRV_SUBSTITUTE_DRIVER (the driver is suspended pending the LGU investigation).
CREATE OR REPLACE FUNCTION public._incident_category_class(p_category TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE
        WHEN p_category IN ('Physical Assault', 'Harassment', 'Threat', 'Criminal Activity', 'Unregistered Person Driving') THEN 'SERIOUS'   -- Batch 12: Rule 27.2
        WHEN p_category IN ('Emergency', 'Safety Concern', 'Accident', 'Medical Emergency') THEN 'EMERGENCY'
        WHEN p_category = 'Lost Item' THEN 'LOST_ITEM'
        WHEN p_category IN ('Rude Behavior', 'Unsafe Driving', 'Reckless Driving', 'Route Deviation', 'Overcharging Attempt', 'Passenger Misconduct',
                            'Change Refusal', 'Counterfeit Currency', 'Others') THEN 'STANDARD'
    END;
$$;

CREATE OR REPLACE FUNCTION public._incident_strike_options(p_category TEXT, p_reported_by TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE
        WHEN p_category = 'Rude Behavior' AND p_reported_by = 'Passenger' THEN ARRAY['DRV_RUDE_UPHELD']
        WHEN p_category = 'Rude Behavior' AND p_reported_by = 'Driver' THEN ARRAY['PAX_ABUSIVE_UPHELD']
        WHEN p_category IN ('Unsafe Driving', 'Reckless Driving') AND p_reported_by = 'Passenger' THEN ARRAY['DRV_UNSAFE_DRIVING']
        WHEN p_category = 'Overcharging Attempt' AND p_reported_by = 'Passenger' THEN ARRAY['DRV_OVERCHARGING']
        WHEN p_category = 'Route Deviation' AND p_reported_by = 'Passenger' THEN ARRAY['DRV_ROUTE_DEVIATION_FARE']
        WHEN p_category = 'Passenger Misconduct' AND p_reported_by = 'Driver' THEN ARRAY['PAX_ABUSIVE_UPHELD', 'PAX_VEHICLE_DAMAGE', 'PAX_CONTAMINATION']
        WHEN p_category = 'Physical Assault' AND p_reported_by = 'Passenger' THEN ARRAY['DRV_PHYSICAL_ALTERCATION']
        WHEN p_category IN ('Harassment', 'Threat') AND p_reported_by = 'Passenger' THEN ARRAY['DRV_HARASSMENT']
        WHEN p_category IN ('Physical Assault', 'Harassment', 'Threat') AND p_reported_by = 'Driver' THEN ARRAY['PAX_ABUSIVE_UPHELD']
        WHEN p_category = 'Unregistered Person Driving' AND p_reported_by = 'Passenger' THEN ARRAY['DRV_SUBSTITUTE_DRIVER']   -- Batch 12: Rule 27.2
        ELSE ARRAY[]::TEXT[]
    END;
$$;

-- ----------------------------------------------------------------------------
-- 11. STORAGE: A TODA THAT REJECTED A DRIVER NO LONGER READS THE DRIVER'S DOCUMENTS (decision of 2026-10-15)
-- ----------------------------------------------------------------------------
-- Verbatim copy of 20261009000002 with ONE change: the affiliation branch counts only affiliations that are still alive (not rejected by the TODA and not rejected
-- by the LGU). The current active TODA of the driver (driver.toda_id) and the LGU read as before.
CREATE OR REPLACE FUNCTION public.storage_can_read_driver_folder(p_folder TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(public.is_lgu_admin(), FALSE)
        OR EXISTS (
            SELECT 1 FROM public.driver d
             WHERE d.auth_user_id::TEXT = p_folder
               AND d.toda_id IS NOT NULL
               AND d.toda_id = public.get_current_toda_admin_toda_id()
        )
        OR EXISTS (
            SELECT 1 FROM public.driver d
              JOIN public.driver_toda_affiliation a ON a.driver_id = d.driver_id
             WHERE d.auth_user_id::TEXT = p_folder
               AND public.get_current_toda_admin_toda_id() IS NOT NULL
               AND a.toda_id = public.get_current_toda_admin_toda_id()
               AND a.toda_endorsement_status <> 'Rejected'                 -- Batch 12: live affiliations only
               AND a.lgu_verification_status <> 'Rejected'                 -- Batch 12
        );
$$;

-- ----------------------------------------------------------------------------
-- 12. OCR MINIMIZATION: data already stored that the verification does not need is cleared on request, never silently
-- ----------------------------------------------------------------------------
-- The apps stopped collecting the residential address, the nationality, the engine and chassis numbers and the make (Batch 12). Values stored earlier are removed
-- by this function, which the LGU's operator runs once (service role): it is not called by this migration, because deleting stored personal data is a decision.
CREATE OR REPLACE FUNCTION public.scrub_unneeded_identity_fields()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
    a INTEGER;
    b INTEGER;
    c INTEGER;
BEGIN
    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.driver SET residential_address = NULL, chassis_number = NULL, motor_number = NULL, vehicle_make = NULL
     WHERE residential_address IS NOT NULL OR chassis_number IS NOT NULL OR motor_number IS NOT NULL OR vehicle_make IS NOT NULL;
    GET DIAGNOSTICS a = ROW_COUNT;
    UPDATE public.driver_verification SET ocr_address = NULL, submitted_address = NULL, submitted_chassis_number = NULL, submitted_motor_number = NULL, submitted_vehicle_make = NULL
     WHERE ocr_address IS NOT NULL OR submitted_address IS NOT NULL OR submitted_chassis_number IS NOT NULL OR submitted_motor_number IS NOT NULL OR submitted_vehicle_make IS NOT NULL;
    GET DIAGNOSTICS b = ROW_COUNT;
    UPDATE public.passenger SET residential_address = NULL WHERE residential_address IS NOT NULL;
    GET DIAGNOSTICS c = ROW_COUNT;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    PERFORM public.record_policy_audit('UNNEEDED_IDENTITY_FIELDS_SCRUBBED', 'IDENTITY_FIELDS', NULL, 'Retention',
        'Residential address, engine, chassis and make removed from stored driver records, and the address from passenger records (data minimization).',
        NULL, jsonb_build_object('drivers', a, 'verifications', b, 'passengers', c));
    RETURN jsonb_build_object('drivers', a, 'verifications', b, 'passengers', c);
END;
$$;

-- ----------------------------------------------------------------------------
-- 13. THE DAILY JOBS (03:27 and 03:42 in Manila)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
        CREATE EXTENSION IF NOT EXISTS pg_cron;
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'sakay-integrity-sweep';
        PERFORM cron.schedule('sakay-integrity-sweep', '27 19 * * *', 'SELECT public.run_integrity_sweep()');
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'sakay-retention-job';
        PERFORM cron.schedule('sakay-retention-job', '42 19 * * *', 'SELECT public.run_retention_job()');
    ELSE
        RAISE NOTICE 'pg_cron is not available in this database: the daily integrity sweep and retention job are NOT scheduled here.';
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 14. BACKFILL: every account's Average Rating is recomputed from the rating rows (a driver with none becomes Not Yet Rated)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
    r RECORD;
BEGIN
    PERFORM set_config('sakay.internal_context', 'true', true);
    FOR r IN SELECT driver_id FROM public.driver LOOP
        PERFORM public._refresh_rating_cache('driver', r.driver_id);
    END LOOP;
    FOR r IN SELECT passenger_id FROM public.passenger LOOP
        PERFORM public._refresh_rating_cache('passenger', r.passenger_id);
    END LOOP;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
END $$;

-- ----------------------------------------------------------------------------
-- 15. PRIVILEGES
-- ----------------------------------------------------------------------------
-- Internal: the database's own functions call them; no app may.
REVOKE EXECUTE ON FUNCTION public._rating_subject_type(TEXT), public.rating_summary(TEXT, UUID), public._refresh_rating_cache(TEXT, UUID),
    public._rating_review_check(TEXT, UUID), public._rating_touch(UUID, TEXT), public.rating_after_change(), public.booking_rating_refresh(),
    public.rating_guard(), public._set_rating_excluded(UUID, BOOLEAN, TEXT), public.protect_rating_and_privacy_columns(),
    public.audit_log_append_only(), public._toda_by_ref(TEXT),
    public._booking_is_held(UUID), public._subject_is_held(TEXT, UUID), public._queue_identity_path(UUID, TEXT, TEXT, TIMESTAMPTZ),
    public._identity_path_in_use(TEXT), public.queue_superseded_identity_documents(),
    public._integrity_flag(TEXT, TEXT, TEXT, TEXT, JSONB, TEXT), public._integrity_gps_sweep(), public._integrity_rating_sweep(),
    public._integrity_collusion_sweep(), public._integrity_rereg_sweep(), public._integrity_rating_review_sweep(),
    public.integrity_constant(TEXT), public.retention_constant(TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.integrity_constant(TEXT), public.retention_constant(TEXT), public.rating_summary(TEXT, UUID) TO service_role;

-- The jobs and the server's part of the retention: the service role only.
REVOKE EXECUTE ON FUNCTION public.purge_expired_gps_logs(), public.purge_expired_sessions(), public.queue_identity_documents(),
    public.get_expired_identity_documents(INTEGER), public.confirm_identity_documents_purged(UUID[]), public.anonymize_closed_accounts(),
    public.run_retention_job(), public.run_integrity_sweep(), public.scrub_unneeded_identity_fields()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_gps_logs(), public.purge_expired_sessions(), public.queue_identity_documents(),
    public.get_expired_identity_documents(INTEGER), public.confirm_identity_documents_purged(UUID[]), public.anonymize_closed_accounts(),
    public.run_retention_job(), public.run_integrity_sweep(), public.scrub_unneeded_identity_fields() TO service_role;

-- The administrators' and accounts' own calls (each checks the caller inside).
REVOKE EXECUTE ON FUNCTION public.admin_exclude_rating(UUID, BOOLEAN, TEXT), public.admin_send_conduct_warning(UUID, TEXT),
    public.get_audit_log(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, INTEGER, INTEGER), public.record_audit_export(TEXT, INTEGER, JSONB),
    public.place_legal_hold(TEXT, UUID, TEXT, TEXT), public.release_legal_hold(UUID, TEXT), public.admin_confirm_integrity_flag(UUID, TEXT),
    public.record_privacy_acceptance(TEXT)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_exclude_rating(UUID, BOOLEAN, TEXT), public.admin_send_conduct_warning(UUID, TEXT),
    public.get_audit_log(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, INTEGER, INTEGER), public.record_audit_export(TEXT, INTEGER, JSONB),
    public.place_legal_hold(TEXT, UUID, TEXT, TEXT), public.release_legal_hold(UUID, TEXT), public.admin_confirm_integrity_flag(UUID, TEXT),
    public.record_privacy_acceptance(TEXT)
    TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 16. SELF-CHECK
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.audit_log'::regclass AND tgname = 'trigger_audit_log_append_only' AND tgenabled = 'O') THEN
        RAISE EXCEPTION 'the audit_log append-only trigger is missing';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'audit_log' AND policyname = 'audit_log_manage_lgu') THEN
        RAISE EXCEPTION 'audit_log_manage_lgu must be gone';
    END IF;
    IF has_table_privilege('authenticated', 'public.audit_log', 'UPDATE') OR has_table_privilege('authenticated', 'public.audit_log', 'DELETE')
       OR has_table_privilege('authenticated', 'public.rating', 'UPDATE') OR has_table_privilege('authenticated', 'public.rating', 'DELETE') THEN
        RAISE EXCEPTION 'authenticated must not be able to update or delete audit_log or rating rows';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.rating'::regclass AND tgname = 'trigger_update_driver_rating') THEN
        RAISE EXCEPTION 'the old rating trigger is still attached';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'driver' AND column_name = 'weighted_average_rating'
                  AND (is_nullable = 'NO' OR column_default IS NOT NULL)) THEN
        RAISE EXCEPTION 'driver.weighted_average_rating must be nullable with no default';
    END IF;
    IF public.integrity_constant('rating_review_min_trips') <> 20 OR public.integrity_constant('rating_review_floor_x100') <> 300
       OR public.retention_constant('gps_log_days') <> 90 OR public.retention_constant('closed_records_years') <> 5 THEN
        RAISE EXCEPTION 'the Batch 12 figures are not the approved ones';
    END IF;
    IF (SELECT count(*) FROM public.violation_catalog WHERE violation_code IN ('PAX_RATING_MANIPULATION', 'DRV_RATING_MANIPULATION', 'DRV_MULTI_ACCOUNT', 'DRV_FALSE_DOCUMENTS')) <> 4 THEN
        RAISE EXCEPTION 'the four Batch 12 violation codes are missing';
    END IF;
    IF public._incident_category_class('Unregistered Person Driving') IS DISTINCT FROM 'SERIOUS' THEN
        RAISE EXCEPTION 'Unregistered Person Driving must be a SERIOUS category';
    END IF;
    IF has_function_privilege('authenticated', 'public.run_retention_job()', 'EXECUTE') OR has_function_privilege('anon', 'public.get_audit_log(timestamptz,timestamptz,text,text,integer,integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'a job function is callable by a client, or the audit log page is callable by anon';
    END IF;
END $$;
