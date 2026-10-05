-- ============================================================================
-- Migration: 20261010000003_permanent_rejection_reasons.sql
-- Manual-test item (TODA Portal, "Reject application"): rejection is FINAL, so the reason must be one of a fixed list of permanent
-- grounds (Rule 3.8), chosen from a dropdown, with an optional note. Fixable problems are RETURNED for correction instead
-- (return_driver_documents, 20261010000001); this function is never the way to ask for a better photo.
--
-- WHAT CHANGES
--   reject_driver_affiliation() accepted two categories, 'ineligible' and 'fraudulent'. It now accepts five, and nothing else:
--       fraudulent               fraudulent or falsified documents
--       license_mtop_revoked     license or MTOP revoked
--       ineligible               not eligible for this TODA
--       duplicate_identity       duplicate identity
--       failed_background_check  failed LGU background check
--   'ineligible' and 'fraudulent' keep their meaning and their spelling, so every earlier rejection and the LGU Portal (which uses them)
--   are unaffected. The notes are optional (they were already). Nothing else in the function changes: same access check, same
--   one-affiliation-at-a-time behaviour (20261009000002), same audit entry.
--
-- WHAT DOES NOT CHANGE
--   Who may reject, the grants, RLS, the re-application rules: a rejected application stays rejected, and the driver cannot re-apply
--   to that TODA on their own (apply_driver_toda_affiliations leaves a Rejected affiliation untouched). Rule 3.9's audited
--   administrator override (allow_driver_reapplication) is untouched.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.reject_driver_affiliation(
    p_affiliation_id UUID,
    p_reason_category TEXT,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_aff public.driver_toda_affiliation;
    v_driver public.driver;
    v_old_state JSONB;
    v_other_alive BOOLEAN;
BEGIN
    SELECT * INTO v_aff FROM public.driver_toda_affiliation WHERE affiliation_id = p_affiliation_id;
    IF v_aff.affiliation_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Affiliation record not found.');
    END IF;

    IF NOT (public.is_lgu_admin() OR (public.get_current_toda_admin_toda_id() IS NOT NULL AND v_aff.toda_id = public.get_current_toda_admin_toda_id())) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Access Denied: You may only review applications for your own TODA.');
    END IF;

    -- Mandatory reason category (Rule 3.8, Item A4): one of the permanent grounds
    IF p_reason_category IS NULL OR p_reason_category NOT IN (
        'fraudulent', 'license_mtop_revoked', 'ineligible', 'duplicate_identity', 'failed_background_check'
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'ERR_INVALID_REJECTION_REASON: The reason must be one of fraudulent, license_mtop_revoked, ineligible, duplicate_identity or failed_background_check. Document issues must use return_driver_documents (Rule 3.8).');
    END IF;

    SELECT * INTO v_driver FROM public.driver WHERE driver_id = v_aff.driver_id;
    v_old_state := to_jsonb(v_aff);

    -- another application of this driver (to a different TODA) that is not rejected at either stage
    SELECT EXISTS (
        SELECT 1 FROM public.driver_toda_affiliation a
         WHERE a.driver_id = v_aff.driver_id
           AND a.affiliation_id <> p_affiliation_id
           AND a.toda_endorsement_status <> 'Rejected'
           AND a.lgu_verification_status <> 'Rejected'
    ) INTO v_other_alive;

    PERFORM set_config('sakay.internal_context', 'true', true);

    IF public.is_lgu_admin() THEN
        UPDATE public.driver_toda_affiliation
        SET lgu_verification_status = 'Rejected',
            lgu_rejection_reason = p_reason_category || ': ' || COALESCE(p_notes, ''),
            updated_at = CURRENT_TIMESTAMP
        WHERE affiliation_id = p_affiliation_id;

        IF v_driver.account_status != 'Verified' AND NOT v_other_alive THEN
            UPDATE public.driver
            SET account_status = 'Rejected',
                rejection_reason = p_reason_category,
                rejection_comment = p_notes,
                rejected_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE driver_id = v_aff.driver_id;
        END IF;
    ELSE
        UPDATE public.driver_toda_affiliation
        SET toda_endorsement_status = 'Rejected',
            toda_rejection_reason = p_reason_category || ': ' || COALESCE(p_notes, ''),
            updated_at = CURRENT_TIMESTAMP
        WHERE affiliation_id = p_affiliation_id;

        -- TODA admin does NOT change driver.account_status!
    END IF;

    -- the shared verification record says Rejected only when no other affiliation is left
    IF NOT v_other_alive THEN
        UPDATE public.driver_verification
        SET verification_status = 'Rejected',
            rejection_reason = p_reason_category,
            rejection_comment = p_notes
        WHERE driver_id = v_aff.driver_id;
    END IF;

    -- Resolve overdue flag
    UPDATE public.admin_review_flag
    SET status = 'Resolved',
        resolution = 'Application rejected (' || p_reason_category || '): ' || COALESCE(p_notes, ''),
        resolved_at = CURRENT_TIMESTAMP,
        resolved_by = auth.uid()
    WHERE subject_id = p_affiliation_id::TEXT AND flag_type = 'APPLICATION_OVERDUE' AND status IN ('Open', 'Under Review');

    INSERT INTO public.audit_log (
        action_type, target_id, actor_id, actor_role, details, before_state, performed_at
    ) VALUES (
        'DRIVER_AFFILIATION_REJECTED',
        p_affiliation_id::TEXT,
        auth.uid(),
        CASE WHEN public.is_lgu_admin() THEN 'lgu_admin' ELSE 'toda_admin' END,
        'Rejected driver affiliation (' || p_reason_category || '). ' || COALESCE(p_notes, ''),
        v_old_state,
        CURRENT_TIMESTAMP
    );

    PERFORM set_config('sakay.internal_context', '', false);
    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- SELF-CHECK: same signature, so the grants from 20260930080000 / 20261009000002 stand; make sure a signed-in user can still call it and
-- an anonymous one cannot.
DO $$
BEGIN
    IF NOT has_function_privilege('authenticated', 'public.reject_driver_affiliation(uuid, text, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'a signed-in administrator cannot execute reject_driver_affiliation';
    END IF;
    IF has_function_privilege('anon', 'public.reject_driver_affiliation(uuid, text, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'reject_driver_affiliation is executable by anon';
    END IF;
END $$;

COMMIT;
