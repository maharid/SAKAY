-- ============================================================================
-- Migration: 20261007000001_batch5_fare_rules.sql
-- Batch 5 (Step 1): the fare rule store.
--
--   Rule 6.3   Only the LGU Administrator may change the base fare / per-km rate.
--              A change takes effect only for bookings confirmed after its effective
--              timestamp; a booking is billed at the rule in force when it was confirmed.
--
-- What this adds:
--   * fare_policy_constant()   code constants for the fare engine (mirrored in
--                              packages/shared/src/config/policyConfig.ts, section 8)
--   * fare_matrix              becomes an append-only list of rule versions. No client role
--                              can INSERT / UPDATE / DELETE it any more; the only write path
--                              is enact_fare_matrix(), which checks the caller is an LGU
--                              administrator, refuses back-dating, serialises concurrent
--                              changes and writes audit_log (actor, before, after, reason).
--   * fare_rule_in_force(at)   the ONE place that decides which rule applies at a moment.
--   * fare_matrix_history()    the LGU portal's list (status computed here, not in React).
--
-- Forward-only. Nothing from Batches 0-4 is edited.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. POLICY CONSTANTS (code constants; the admin-changeable fare VALUES live in fare_matrix)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fare_policy_constant(p_key TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE p_key
        WHEN 'seat_capacity'                THEN 4     -- Rules 6.1.2 / 6.1.3: Solo = seat fare x 4; shared pool = base fare x 4
        WHEN 'partner_assumption_pax'       THEN 1     -- D2c: the Matched Shared Fare Estimate assumes one more 1-passenger partner
        WHEN 'deviation_tolerance_m'        THEN 500   -- F5.2: floor of the estimate-vs-actual tolerance (metres)
        WHEN 'deviation_tolerance_pct'      THEN 15    -- F5.2: ... or this percent of the estimated distance, whichever is larger
        WHEN 'gps_max_accuracy_m'           THEN 50    -- F5.1: a fix worse than this is not used for distance
        WHEN 'gps_max_speed_kmh'            THEN 80    -- F5.1: a fix implying a faster jump is discarded
        WHEN 'gps_deadband_m'               THEN 15    -- F5.1: movement inside max(this, accuracy of both fixes added) is jitter
        WHEN 'gps_gap_flag_seconds'         THEN 30    -- F5.1: a hole longer than this flags the track
        WHEN 'gps_reanchor_after_rejects'   THEN 3     -- F5.1: consecutive discards after which the reference point is replaced
        WHEN 'gps_arrival_radius_m'         THEN 150   -- F5.2 guard: a track that ends farther than this from the destination is incomplete
        WHEN 'distance_min_pct_of_straight' THEN 90    -- plausibility of the client's OSRM distance: not below 90 % of straight line ...
        WHEN 'distance_min_slack_m'         THEN 50    --   ... minus this many metres (road snapping)
        WHEN 'distance_max_factor'          THEN 3     -- ... and not above 3 x straight line ...
        WHEN 'distance_max_slack_m'         THEN 500   --   ... plus this many metres
        WHEN 'future_request_slack_seconds' THEN 300   -- Rule 6.6: a request time further ahead than this is a scheduled booking
        WHEN 'rate_backdate_slack_seconds'  THEN 120   -- Rule 6.3: an effective timestamp older than this is back-dating
        ELSE NULL
    END;
$$;

-- ----------------------------------------------------------------------------
-- 2. FARE_MATRIX: append-only versions
-- ----------------------------------------------------------------------------
-- True only inside the fare functions below.
CREATE OR REPLACE FUNCTION public._in_fare_context()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(current_setting('sakay.fare_context', true), '') = 'true';
$$;

-- Sanity limits on every rule row (NOT VALID: rows that already exist are not re-checked).
ALTER TABLE public.fare_matrix DROP CONSTRAINT IF EXISTS fare_matrix_rates_check;
ALTER TABLE public.fare_matrix ADD CONSTRAINT fare_matrix_rates_check
    CHECK (base_fare > 0 AND base_distance_km >= 0 AND succeeding_rate >= 0) NOT VALID;

-- A rule version is history: it is never edited or deleted (a mistake is corrected by enacting
-- a newer version, which takes effect from then on, exactly like any other change).
CREATE OR REPLACE FUNCTION public.protect_fare_matrix_history()
RETURNS TRIGGER AS $$
BEGIN
    IF public._in_fare_context() THEN
        RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    RAISE EXCEPTION 'ERR_FARE_RULE_APPEND_ONLY: Hindi maaaring baguhin o burahin ang umiiral na fare matrix. Magpatupad ng bagong bersyon gamit ang enact_fare_matrix(). (A fare rule version cannot be edited or deleted; enact a new version instead.)';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trigger_protect_fare_matrix_history ON public.fare_matrix;
CREATE TRIGGER trigger_protect_fare_matrix_history
    BEFORE UPDATE OR DELETE ON public.fare_matrix
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_fare_matrix_history();

-- No client role writes the table directly any more; reading stays as it was.
DROP POLICY IF EXISTS "fare_matrix_insert_policy" ON public.fare_matrix;
DROP POLICY IF EXISTS "fare_matrix_update_policy" ON public.fare_matrix;
DROP POLICY IF EXISTS "fare_matrix_delete_policy" ON public.fare_matrix;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.fare_matrix FROM anon, authenticated;

-- D4: the citation is Ordinance No. 110, s. 2022. The seeded row had none.
DO $$
BEGIN
    PERFORM set_config('sakay.fare_context', 'true', true);
    UPDATE public.fare_matrix
    SET ordinance_reference = 'City Ordinance No. 110, Series of 2022'
    WHERE ordinance_reference IS NULL
      AND base_fare = 15 AND base_distance_km = 2 AND succeeding_rate = 1;
    PERFORM set_config('sakay.fare_context', '', true);
END $$;

-- ----------------------------------------------------------------------------
-- 3. WHICH RULE APPLIES AT A MOMENT (single source of truth)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._fare_rule_row(p_at TIMESTAMPTZ)
RETURNS public.fare_matrix
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT m
    FROM public.fare_matrix m
    WHERE m.effective_timestamp <= p_at
    ORDER BY m.effective_timestamp DESC, m.created_at DESC
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fare_rule_in_force(p_at TIMESTAMPTZ DEFAULT NULL)
RETURNS public.fare_matrix
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_rule public.fare_matrix;
BEGIN
    v_rule := public._fare_rule_row(COALESCE(p_at, clock_timestamp()));
    IF v_rule.fare_matrix_id IS NULL THEN
        RAISE EXCEPTION 'ERR_NO_FARE_RULE: Walang umiiral na fare matrix sa oras na ito. (No fare rule is in force at this time.)';
    END IF;
    RETURN v_rule;
END;
$$;

-- The rule as a snapshot, the shape stored on every booking and returned with every quote.
CREATE OR REPLACE FUNCTION public._fare_rule_json(p_rule public.fare_matrix)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT jsonb_build_object(
        'fare_matrix_id',       p_rule.fare_matrix_id,
        'base_fare',            p_rule.base_fare,
        'base_distance_km',     p_rule.base_distance_km,
        'succeeding_rate',      p_rule.succeeding_rate,
        'seat_capacity',        public.fare_policy_constant('seat_capacity'),
        'effective_timestamp',  p_rule.effective_timestamp,
        'ordinance_reference',  p_rule.ordinance_reference
    );
$$;

-- ----------------------------------------------------------------------------
-- 4. ENACT A NEW RULE (LGU Administrator only; the only write path)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enact_fare_matrix(
    p_base_fare NUMERIC,
    p_base_distance_km NUMERIC,
    p_succeeding_rate NUMERIC,
    p_ordinance_reference TEXT,
    p_reason TEXT,
    p_effective_timestamp TIMESTAMPTZ DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_slack INTEGER := public.fare_policy_constant('rate_backdate_slack_seconds');
    v_eff TIMESTAMPTZ;
    v_admin UUID;
    v_before public.fare_matrix;
    v_new public.fare_matrix;
    v_current UUID;
    v_prev_ctx TEXT := current_setting('sakay.fare_context', true);
BEGIN
    IF NOT public.is_lgu_admin() THEN
        RAISE EXCEPTION 'ERR_NOT_LGU_ADMIN: Ang LGU Administrator lamang ang maaaring magbago ng base fare at per-km rate. (Only the LGU Administrator may change the fare matrix.)'
            USING ERRCODE = '42501';
    END IF;

    IF p_base_fare IS NULL OR p_base_fare <= 0 OR p_base_fare <> round(p_base_fare, 2) THEN
        RAISE EXCEPTION 'ERR_INVALID_FARE_RULE: Ang base fare ay dapat higit sa zero at hanggang 2 decimal places. (Base fare must be above zero, at most 2 decimals.)';
    END IF;
    IF p_base_distance_km IS NULL OR p_base_distance_km < 0 OR p_base_distance_km <> round(p_base_distance_km, 2) THEN
        RAISE EXCEPTION 'ERR_INVALID_FARE_RULE: Ang base distance ay hindi maaaring negatibo (hanggang 2 decimals). (Base distance cannot be negative, at most 2 decimals.)';
    END IF;
    IF p_succeeding_rate IS NULL OR p_succeeding_rate < 0 OR p_succeeding_rate <> round(p_succeeding_rate, 2) THEN
        RAISE EXCEPTION 'ERR_INVALID_FARE_RULE: Ang per-km rate ay hindi maaaring negatibo (hanggang 2 decimals). (Per-km rate cannot be negative, at most 2 decimals.)';
    END IF;
    IF p_ordinance_reference IS NULL OR length(btrim(p_ordinance_reference)) < 3 THEN
        RAISE EXCEPTION 'ERR_ORDINANCE_REQUIRED: Ilagay ang ordinansa o resolusyon na pinagbabatayan. (The ordinance or resolution reference is required.)';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
        RAISE EXCEPTION 'ERR_REASON_REQUIRED: Ilagay ang dahilan ng pagbabago (kahit 5 character). (A reason for the change is required.)';
    END IF;

    -- Rule 6.3: a change is forward-only. "Now" is allowed; anything older than the small
    -- clock-skew slack is back-dating (it would re-price bookings already confirmed).
    IF p_effective_timestamp IS NOT NULL AND p_effective_timestamp < v_now - make_interval(secs => v_slack) THEN
        RAISE EXCEPTION 'ERR_BACKDATED_RATE: Hindi maaaring ipatupad ang bagong rate sa nakaraang petsa; para lamang ito sa mga booking na makukumpirma pagkatapos nito. (A fare change cannot take effect in the past.)';
    END IF;
    v_eff := GREATEST(COALESCE(p_effective_timestamp, v_now), v_now);

    SELECT admin_id INTO v_admin FROM public.lgu_admin WHERE auth_user_id = auth.uid() AND account_status = 'Active';

    -- One change at a time (two administrators saving together must not interleave).
    PERFORM pg_advisory_xact_lock(hashtext('sakay.fare_matrix'));

    v_before := public._fare_rule_row(v_now);

    PERFORM set_config('sakay.fare_context', 'true', true);

    INSERT INTO public.fare_matrix (
        base_fare, base_distance_km, succeeding_rate, effective_timestamp, is_active,
        configured_by, ordinance_reference, notes
    ) VALUES (
        p_base_fare, p_base_distance_km, p_succeeding_rate, v_eff, FALSE,
        v_admin, btrim(p_ordinance_reference), NULLIF(btrim(COALESCE(p_notes, '')), '')
    ) RETURNING * INTO v_new;

    -- is_active is only a convenience flag now (it cannot flip by itself when a scheduled rule
    -- becomes effective); every lookup uses effective_timestamp via fare_rule_in_force().
    SELECT m.fare_matrix_id INTO v_current FROM public._fare_rule_row(v_now) m;
    UPDATE public.fare_matrix SET is_active = (fare_matrix_id = v_current)
    WHERE is_active IS DISTINCT FROM (fare_matrix_id = v_current);

    PERFORM set_config('sakay.fare_context', COALESCE(v_prev_ctx, ''), true);

    SELECT * INTO v_new FROM public.fare_matrix WHERE fare_matrix_id = v_new.fare_matrix_id;

    PERFORM public.record_policy_audit(
        'FARE_MATRIX_ENACTED',
        v_new.fare_matrix_id::TEXT,
        COALESCE(v_new.ordinance_reference, 'Fare matrix'),
        'Fare Matrix',
        format('Enacted a fare rule effective %s: base fare %s for the first %s km, %s per succeeding km. Ordinance: %s. Reason: %s',
               public._fmt_manila(v_new.effective_timestamp), v_new.base_fare, v_new.base_distance_km, v_new.succeeding_rate,
               v_new.ordinance_reference, btrim(p_reason)),
        CASE WHEN v_before.fare_matrix_id IS NULL THEN NULL ELSE to_jsonb(v_before) END,
        to_jsonb(v_new)
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'rule', public._fare_rule_json(v_new),
        'effective_immediately', v_new.effective_timestamp <= clock_timestamp()
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. HISTORY FOR THE LGU PORTAL
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fare_matrix_history()
RETURNS TABLE (
    fare_matrix_id UUID,
    base_fare NUMERIC,
    base_distance_km NUMERIC,
    succeeding_rate NUMERIC,
    effective_timestamp TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    ordinance_reference TEXT,
    notes TEXT,
    configured_by UUID,
    configured_by_name TEXT,
    status TEXT,
    solo_base_fare NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_current UUID;
BEGIN
    IF NOT public.is_lgu_admin() THEN
        RAISE EXCEPTION 'ERR_NOT_LGU_ADMIN: Para lamang sa LGU Administrator. (LGU Administrator only.)' USING ERRCODE = '42501';
    END IF;

    SELECT r.fare_matrix_id INTO v_current FROM public._fare_rule_row(v_now) r;

    RETURN QUERY
    SELECT m.fare_matrix_id, m.base_fare, m.base_distance_km, m.succeeding_rate,
           m.effective_timestamp, m.created_at, m.ordinance_reference::TEXT, m.notes,
           m.configured_by, a.full_name::TEXT,
           CASE
               WHEN m.fare_matrix_id = v_current THEN 'In force'
               WHEN m.effective_timestamp > v_now THEN 'Scheduled'
               ELSE 'Superseded'
           END,
           m.base_fare * public.fare_policy_constant('seat_capacity')      -- the Solo Trip base (base fare x seats), so no client multiplies
    FROM public.fare_matrix m
    LEFT JOIN public.lgu_admin a ON a.admin_id = m.configured_by
    ORDER BY m.effective_timestamp DESC, m.created_at DESC;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. PRIVILEGES
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._in_fare_context() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._fare_rule_row(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._fare_rule_json(public.fare_matrix) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fare_rule_in_force(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enact_fare_matrix(NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fare_matrix_history() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fare_rule_in_force(TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.enact_fare_matrix(NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fare_matrix_history() TO authenticated, service_role;
