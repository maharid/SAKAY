-- ============================================================================
-- Migration: 20261011000001_align_strike_values_to_policy.sql
-- Aligns three Batch 3 policy figures with the SAKAY Policy document (Appendix B).
--
--   Sections 20 and 21   5 strikes -> 7-DAY suspension      (was 3 days: decision F3.3)
--   Sections 20 and 21   8 strikes -> 30-DAY suspension     (was 7 days: decision F3.3)
--   Rule 25.1 and 9.4    exemption / provisional-strike waiver window 48 HOURS (was 72: decision D1)
--
-- Why: the policy document is the root reference of the whole system and the Driver Terms of Service already promise
-- 7 and 30 days. The earlier values were testing-friendly overrides; they are retired here.
--
-- Scope: only the function public.strike_policy_constant() changes (CREATE OR REPLACE keeps its privileges). Strikes that
-- already exist keep the suspension end date and the exemption deadline they were given when they were issued; the new
-- values apply to strikes issued from now on. Forward-only: the Batch 3 migrations are not edited.
-- Safe to run twice.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.strike_policy_constant(p_key TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE p_key
        WHEN 'window_days'                      THEN 90   -- Sections 20/21 rolling window
        WHEN 'warning_threshold'                THEN 1
        WHEN 'review_threshold'                 THEN 3
        WHEN 'suspension_1_threshold'           THEN 5
        WHEN 'suspension_1_days'                THEN 7    -- Sections 20/21 (aligned; F3.3 override retired)
        WHEN 'suspension_2_threshold'           THEN 8
        WHEN 'suspension_2_days'                THEN 30   -- Sections 20/21 (aligned; F3.3 override retired)
        WHEN 'deactivation_threshold'           THEN 10
        WHEN 'exemption_window_hours'           THEN 48   -- Rules 25.1 / 9.4 (aligned; D1 override retired)
        WHEN 'exemption_decision_business_days' THEN 3    -- Rule 25.6
        WHEN 'exemption_repeat_limit'           THEN 3    -- Rule 25.7: requests reviewed; the next is denied
        WHEN 'exemption_repeat_window_days'     THEN 30   -- Rule 25.7
        WHEN 'repeat_violation_window_days'     THEN 30   -- PI-B3 definition of "repeated"
        ELSE NULL
    END;
$$;

-- Self-check: the three values moved and nothing else did.
DO $$
BEGIN
    IF public.strike_policy_constant('suspension_1_days') <> 7
       OR public.strike_policy_constant('suspension_2_days') <> 30
       OR public.strike_policy_constant('exemption_window_hours') <> 48 THEN
        RAISE EXCEPTION 'strike_policy_constant: the aligned values did not take effect';
    END IF;
    IF public.strike_policy_constant('window_days') <> 90
       OR public.strike_policy_constant('suspension_1_threshold') <> 5
       OR public.strike_policy_constant('suspension_2_threshold') <> 8
       OR public.strike_policy_constant('deactivation_threshold') <> 10
       OR public.strike_policy_constant('exemption_decision_business_days') <> 3 THEN
        RAISE EXCEPTION 'strike_policy_constant: an unrelated value changed';
    END IF;
END $$;
