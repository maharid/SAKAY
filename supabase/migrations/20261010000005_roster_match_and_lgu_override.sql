-- ============================================================================
-- Migration: 20261010000005_roster_match_and_lgu_override.sql
-- Decisions (project owner, 2026-10-06), Rule 2.4 "Roster Mismatch":
--
--   1. ONE roster match. endorse_driver_affiliation() matched the applicant against the TODA master roster by franchise OR plate number
--      (roster entries created before the application only; name alone never passes), while the TODA Portal screen guessed by NAME on the
--      client, so the screen could say "found on the roster" when the endorsement raised a mismatch flag, or the reverse. The rule is now
--      a single function, affiliation_roster_matched(); endorse_driver_affiliation() uses it, and the screen asks
--      get_affiliation_roster_matches(), which uses it too. They cannot disagree.
--
--   2. An open Roster Mismatch flag no longer disappears silently on LGU approval. verify_driver_affiliation() gets a new last argument,
--      p_roster_override_reason: while a ROSTER_MISMATCH flag is Open / Under Review for the affiliation, approval is refused unless the
--      LGU administrator gives a reason (at least 10 characters). The reason is written to the flag's resolution and to the audit log
--      (DRIVER_ROSTER_MISMATCH_OVERRIDDEN, with the administrator's name). With no open flag nothing changes and no reason is asked for.
--
-- NOT changed: TODA endorsement is still allowed for an unmatched applicant (it raises the flag, as before); the matching rule itself
-- (franchise OR plate, normalised, entries created at or before submitted_at); who may approve; anything about rejection.
--
-- The 4-argument verify_driver_affiliation() is dropped and replaced by the 5-argument one (the new argument has a default, so a call that
-- names only the old arguments still resolves). Grants are re-stated below because a dropped function loses them.
-- ============================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- 1. The match, in one place (internal: only the other SECURITY DEFINER functions below use it)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.affiliation_roster_matched(p_affiliation_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.driver_toda_affiliation a
          JOIN public.driver d ON d.driver_id = a.driver_id
          LEFT JOIN LATERAL (
                SELECT v.submitted_franchise_number, v.submitted_plate_number
                  FROM public.driver_verification v WHERE v.driver_id = a.driver_id LIMIT 1) v ON TRUE
          CROSS JOIN LATERAL (
                SELECT regexp_replace(upper(COALESCE(v.submitted_franchise_number, d.franchise_number, '')), '[^A-Z0-9]', '', 'g') AS nf,
                       regexp_replace(upper(COALESCE(v.submitted_plate_number, d.plate_number, '')), '[^A-Z0-9]', '', 'g') AS np) n
          JOIN public.toda_roster_entry r
            ON r.toda_id = a.toda_id
           AND r.created_at <= a.submitted_at
           AND ((n.nf <> '' AND r.normalized_franchise = n.nf) OR (n.np <> '' AND r.normalized_plate = n.np))
         WHERE a.affiliation_id = p_affiliation_id
    );
$$;

REVOKE ALL ON FUNCTION public.affiliation_roster_matched(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliation_roster_matched(UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. What the TODA screen reads: the same answer, for the applications the caller administers (a TODA administrator: their own TODA's;
--    the LGU: every one). Nobody else gets a row.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_affiliation_roster_matches(p_affiliation_ids UUID[] DEFAULT NULL)
RETURNS TABLE (affiliation_id UUID, roster_matched BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT a.affiliation_id, public.affiliation_roster_matched(a.affiliation_id)
      FROM public.driver_toda_affiliation a
     WHERE (p_affiliation_ids IS NULL OR a.affiliation_id = ANY (p_affiliation_ids))
       AND (COALESCE(public.is_lgu_admin(), FALSE)
            OR (public.get_current_toda_admin_toda_id() IS NOT NULL AND a.toda_id = public.get_current_toda_admin_toda_id()));
$$;

REVOKE ALL ON FUNCTION public.get_affiliation_roster_matches(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_affiliation_roster_matches(UUID[]) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. TODA endorsement: same function as before (20260930080000); the only change is that the roster match comes from section 1
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.endorse_driver_affiliation(
    p_affiliation_id UUID,
    p_remarks TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_aff public.driver_toda_affiliation;
    v_driver public.driver;
    v_toda public.toda;
    v_verif public.driver_verification;
    v_old_state JSONB;
    v_roster_matched BOOLEAN := FALSE;
BEGIN
    SELECT * INTO v_aff FROM public.driver_toda_affiliation WHERE affiliation_id = p_affiliation_id;
    IF v_aff.affiliation_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Affiliation record not found.');
    END IF;

    -- Verify caller is TODA Admin for this TODA or LGU Admin
    IF NOT (public.is_lgu_admin() OR (public.get_current_toda_admin_toda_id() IS NOT NULL AND v_aff.toda_id = public.get_current_toda_admin_toda_id())) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Access Denied: You may only endorse drivers applying to your own TODA.');
    END IF;

    -- Require status 'Submitted'
    IF v_aff.toda_endorsement_status != 'Submitted' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Application is not in Submitted status.');
    END IF;

    -- Require TODA active and unexpired
    SELECT * INTO v_toda FROM public.toda WHERE toda_id = v_aff.toda_id;
    IF v_toda.toda_id IS NULL OR v_toda.toda_status != 'Active' 
       OR (v_toda.certificate_expiry IS NOT NULL AND (v_toda.certificate_expiry AT TIME ZONE 'Asia/Manila')::DATE < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::DATE) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot endorse driver for inactive or expired TODA.');
    END IF;

    SELECT * INTO v_driver FROM public.driver WHERE driver_id = v_aff.driver_id;
    IF v_driver.is_permanently_disqualified = TRUE THEN
        RETURN jsonb_build_object('success', false, 'error', 'Driver is permanently disqualified.');
    END IF;

    SELECT * INTO v_verif FROM public.driver_verification WHERE driver_id = v_aff.driver_id LIMIT 1;

    -- Roster match (Requirement C13: name alone does NOT pass; Requirement A5: only roster entries created before or at the application's
    -- submitted_at count). One definition for the whole system: the TODA screen asks the same function (get_affiliation_roster_matches).
    v_roster_matched := public.affiliation_roster_matched(p_affiliation_id);

    v_old_state := to_jsonb(v_aff);

    PERFORM set_config('sakay.internal_context', 'true', true);

    -- Complete Stage 1 endorsement
    UPDATE public.driver_toda_affiliation
    SET toda_endorsement_status = 'Endorsed',
        toda_endorsed_at = CURRENT_TIMESTAMP,
        toda_endorsed_by = (SELECT admin_id FROM public.toda_admin WHERE auth_user_id = (SELECT auth.uid()) LIMIT 1),
        lgu_verification_status = 'Pending',
        updated_at = CURRENT_TIMESTAMP
    WHERE affiliation_id = p_affiliation_id
    RETURNING * INTO v_aff;

    -- Update driver_verification status to maintain backward compatibility
    UPDATE public.driver_verification
    SET verification_status = 'Approved',
        endorsed_at = CURRENT_TIMESTAMP,
        reviewed_by = (SELECT admin_id FROM public.toda_admin WHERE auth_user_id = (SELECT auth.uid()) LIMIT 1)
    WHERE driver_id = v_aff.driver_id;

    -- Rule 2.4: If driver not on roster, raise supervisory review flag for LGU (subject_type = driver_application)
    IF NOT v_roster_matched THEN
        INSERT INTO public.admin_review_flag (
            flag_type, subject_type, subject_id, source_rule, assigned_role, details
        ) VALUES (
            'ROSTER_MISMATCH',
            'driver_application',
            p_affiliation_id::TEXT,
            'Rule 2.4',
            'lgu_admin',
            jsonb_build_object(
                'affiliation_id', p_affiliation_id,
                'toda_id', v_aff.toda_id,
                'driver_id', v_aff.driver_id,
                'driver_name', v_driver.full_name,
                'franchise', v_driver.franchise_number,
                'plate', v_driver.plate_number,
                'reason', 'TODA endorsed driver applicant who does not match the pre-existing master roster.'
            )
        ) ON CONFLICT (subject_type, subject_id, flag_type) WHERE status IN ('Open', 'Under Review') DO NOTHING;
    END IF;

    INSERT INTO public.audit_log (
        action_type, target_id, actor_id, actor_role, details, before_state, after_state, performed_at
    ) VALUES (
        'DRIVER_AFFILIATION_STAGE1_ENDORSED',
        p_affiliation_id::TEXT,
        auth.uid(),
        'toda_admin',
        'Endorsed driver ' || v_driver.full_name || ' for TODA affiliation. Roster matched: ' || v_roster_matched::TEXT,
        v_old_state,
        to_jsonb(v_aff),
        CURRENT_TIMESTAMP
    );

    PERFORM set_config('sakay.internal_context', '', false);
    RETURN jsonb_build_object('success', true, 'data', to_jsonb(v_aff), 'roster_matched', v_roster_matched);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 4. LGU approval with the roster-mismatch override (the changes are marked in the text: p_roster_override_reason, the flag check, the
--    flag resolution text, the DRIVER_ROSTER_MISMATCH_OVERRIDDEN audit entry)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.verify_driver_affiliation(UUID, TEXT, DATE, DATE);

CREATE OR REPLACE FUNCTION public.verify_driver_affiliation(
    p_affiliation_id UUID,
    p_franchise_number TEXT DEFAULT NULL,
    p_license_expiry DATE DEFAULT NULL,
    p_mtop_expiry DATE DEFAULT NULL,
    p_roster_override_reason TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_aff public.driver_toda_affiliation;
    v_driver public.driver;
    v_toda public.toda;
    v_verif public.driver_verification;
    v_old_state JSONB;
    v_has_active_selection BOOLEAN;
    v_roster_flag_open BOOLEAN;
    v_override TEXT := NULLIF(trim(COALESCE(p_roster_override_reason, '')), '');
    v_admin_name TEXT;
BEGIN
    IF NOT public.is_lgu_admin() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Access Denied: Only LGU Administrators can issue final verification.');
    END IF;

    SELECT * INTO v_aff FROM public.driver_toda_affiliation WHERE affiliation_id = p_affiliation_id;
    IF v_aff.affiliation_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Affiliation record not found.');
    END IF;

    -- Sequential rule (Item A1): Require toda_endorsement_status = 'Endorsed'
    IF v_aff.toda_endorsement_status != 'Endorsed' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sequential violation: Application must be endorsed by TODA Administrator first.');
    END IF;

    -- Require not already Approved
    IF v_aff.lgu_verification_status = 'Approved' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Affiliation has already been approved.');
    END IF;

    -- Require TODA active and unexpired
    SELECT * INTO v_toda FROM public.toda WHERE toda_id = v_aff.toda_id;
    IF v_toda.toda_id IS NULL OR v_toda.toda_status != 'Active' 
       OR (v_toda.certificate_expiry IS NOT NULL AND (v_toda.certificate_expiry AT TIME ZONE 'Asia/Manila')::DATE < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::DATE) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot verify driver affiliation for inactive or expired TODA.');
    END IF;

    SELECT * INTO v_driver FROM public.driver WHERE driver_id = v_aff.driver_id;
    IF v_driver.is_permanently_disqualified = TRUE THEN
        RETURN jsonb_build_object('success', false, 'error', 'Driver is permanently disqualified.');
    END IF;

    SELECT * INTO v_verif FROM public.driver_verification WHERE driver_id = v_aff.driver_id LIMIT 1;
    v_old_state := to_jsonb(v_aff);

    -- Roster mismatch (Rule 2.4): the TODA endorsed an applicant who is not on its master roster and an open flag says so. The LGU may
    -- still approve, but only with a written reason, which goes to the flag's resolution and to the audit log.
    SELECT EXISTS (
        SELECT 1 FROM public.admin_review_flag f
         WHERE f.flag_type = 'ROSTER_MISMATCH' AND f.subject_type = 'driver_application'
           AND f.subject_id = p_affiliation_id::TEXT AND f.status IN ('Open', 'Under Review')
    ) INTO v_roster_flag_open;
    IF v_roster_flag_open AND (v_override IS NULL OR length(v_override) < 10) THEN
        RETURN jsonb_build_object('success', false, 'roster_override_required', true,
            'error', 'ERR_ROSTER_OVERRIDE_REQUIRED: This applicant is not on the TODA master roster (open Roster Mismatch flag). To approve anyway, give a reason of at least 10 characters. It is written to the audit log.');
    END IF;
    SELECT full_name INTO v_admin_name FROM public.lgu_admin WHERE auth_user_id = auth.uid() LIMIT 1;

    PERFORM set_config('sakay.internal_context', 'true', true);

    -- Check if driver already has an active selection
    SELECT EXISTS (
        SELECT 1 FROM public.driver_toda_affiliation 
        WHERE driver_id = v_aff.driver_id AND is_active_selection = TRUE AND affiliation_id != p_affiliation_id
    ) INTO v_has_active_selection;

    -- Approve affiliation; only set active selection if driver has none yet
    UPDATE public.driver_toda_affiliation
    SET lgu_verification_status = 'Approved',
        lgu_verified_at = CURRENT_TIMESTAMP,
        lgu_verified_by = (SELECT admin_id FROM public.lgu_admin WHERE auth_user_id = (SELECT auth.uid()) LIMIT 1),
        is_active_selection = CASE WHEN v_has_active_selection THEN FALSE ELSE TRUE END,
        updated_at = CURRENT_TIMESTAMP
    WHERE affiliation_id = p_affiliation_id
    RETURNING * INTO v_aff;

    -- Update driver table (Item A1): Only set driver.account_status = 'Verified' when it is 'Pending Verification' or 'Resubmission Required'; NEVER change Suspended, Deactivated or Rejected drivers.
    UPDATE public.driver
    SET account_status = CASE 
            WHEN is_permanently_disqualified = TRUE THEN account_status
            WHEN account_status IN ('Pending Verification', 'Resubmission Required') THEN 'Verified'
            ELSE account_status
        END,
        toda_id = CASE WHEN v_aff.is_active_selection THEN v_aff.toda_id ELSE toda_id END,
        franchise_number = COALESCE(p_franchise_number, v_verif.submitted_franchise_number, franchise_number),
        license_expiry = COALESCE(p_license_expiry, v_verif.license_expiry, license_expiry),
        mtop_expiry = COALESCE(p_mtop_expiry, v_verif.mtop_expiry, v_verif.franchise_expiry, mtop_expiry),
        lgu_approved_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE driver_id = v_aff.driver_id
    RETURNING * INTO v_driver;

    UPDATE public.driver_verification
    SET verification_status = 'Approved',
        reviewed_by_lgu = (SELECT admin_id FROM public.lgu_admin WHERE auth_user_id = (SELECT auth.uid()) LIMIT 1),
        lgu_approved_at = CURRENT_TIMESTAMP
    WHERE driver_id = v_aff.driver_id;

    -- Close open overdue and roster mismatch flags for this affiliation (a roster mismatch records the override reason)
    UPDATE public.admin_review_flag
    SET status = 'Resolved',
        resolution = CASE WHEN flag_type = 'ROSTER_MISMATCH' AND v_override IS NOT NULL
                          THEN 'LGU Admin approved the application despite the roster mismatch. Override reason: ' || v_override
                          ELSE 'LGU Admin approved application.' END,
        resolved_at = CURRENT_TIMESTAMP,
        resolved_by = auth.uid()
    WHERE subject_id = p_affiliation_id::TEXT 
      AND flag_type IN ('APPLICATION_OVERDUE', 'ROSTER_MISMATCH') 
      AND status IN ('Open', 'Under Review');

    INSERT INTO public.audit_log (
        action_type, target_id, actor_id, actor_role, details, before_state, after_state, performed_at
    ) VALUES (
        'DRIVER_AFFILIATION_STAGE2_VERIFIED',
        p_affiliation_id::TEXT,
        auth.uid(),
        'lgu_admin',
        'LGU approved and accredited driver ' || v_driver.full_name || '.',
        v_old_state,
        to_jsonb(v_aff),
        CURRENT_TIMESTAMP
    );

    IF v_roster_flag_open THEN
        INSERT INTO public.audit_log (
            action_type, target_id, actor_id, actor_role, details, before_state, after_state, performed_at
        ) VALUES (
            'DRIVER_ROSTER_MISMATCH_OVERRIDDEN',
            p_affiliation_id::TEXT,
            auth.uid(),
            'lgu_admin',
            'LGU administrator ' || COALESCE(v_admin_name, auth.uid()::TEXT) || ' approved ' || v_driver.full_name
                || ' although the applicant is not on the TODA master roster (Rule 2.4). Override reason: ' || v_override,
            v_old_state,
            to_jsonb(v_aff),
            CURRENT_TIMESTAMP
        );
    END IF;

    PERFORM set_config('sakay.internal_context', '', false);
    RETURN jsonb_build_object('success', true, 'data', to_jsonb(v_aff), 'roster_override_recorded', v_roster_flag_open);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.verify_driver_affiliation(UUID, TEXT, DATE, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_driver_affiliation(UUID, TEXT, DATE, DATE, TEXT) TO authenticated, service_role;

-- SELF-CHECK
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'verify_driver_affiliation' AND pronargs = 4) THEN
        RAISE EXCEPTION 'the old 4-argument verify_driver_affiliation is still there';
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.verify_driver_affiliation(uuid, text, date, date, text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.verify_driver_affiliation(uuid, text, date, date, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'verify_driver_affiliation grants are wrong';
    END IF;
    IF has_function_privilege('authenticated', 'public.affiliation_roster_matched(uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.get_affiliation_roster_matches(uuid[])', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.get_affiliation_roster_matches(uuid[])', 'EXECUTE') THEN
        RAISE EXCEPTION 'roster match function grants are wrong';
    END IF;
END $$;

COMMIT;
