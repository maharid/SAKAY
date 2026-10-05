-- ============================================================================
-- Migration: 20261010000004_reapplication_lgu_only.sql
-- Decision (project owner, 2026-10-06): a rejection is FINAL for the applicant and for the TODA. The one way back is Rule 3.9's audited
-- administrative override, and it belongs to the LGU alone.
--
-- WHAT CHANGES in allow_driver_reapplication(p_affiliation_id, p_reason)  (same name, same arguments, so the grants stay as they were)
--   * only an LGU administrator may call it. Until now the TODA administrator of the affiliation could too, which let a TODA undo its own
--     rejection (or one that the LGU had made).
--   * the reason is required: at least 10 characters once trimmed (before: any non-blank text, so "ok" passed).
--   * the audit_log entry (DRIVER_REAPPLICATION_ALLOWED) now says WHO (the LGU administrator's name), carries the reason, and records what
--     was cleared: the earlier rejection reasons of both stages. The audit_log is append-only, so this is permanent.
-- Everything else is exactly as in 20260930080000: a permanently disqualified driver can never be cleared, only a rejected application
-- can be, and the affiliation goes back to Submitted / Pending with a new submitted_at.
--
-- WHAT DOES NOT CHANGE
--   The driver still cannot re-apply to a TODA that rejected them (apply_driver_toda_affiliations leaves a Rejected affiliation alone),
--   and neither can the TODA endorse, return or re-open it: those functions already require the application to be in Submitted.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.allow_driver_reapplication(
    p_affiliation_id UUID,
    p_reason TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_aff public.driver_toda_affiliation;
    v_driver public.driver;
    v_old_state JSONB;
    v_admin_name TEXT;
BEGIN
    -- LGU only (Rule 3.9): the TODA that rejected an applicant does not get to reverse its own decision
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Access Denied: Only an LGU administrator can allow re-application after a rejection.');
    END IF;

    SELECT * INTO v_aff FROM public.driver_toda_affiliation WHERE affiliation_id = p_affiliation_id;
    IF v_aff.affiliation_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Affiliation record not found.');
    END IF;

    IF p_reason IS NULL OR length(trim(p_reason)) < 10 THEN
        RETURN jsonb_build_object('success', false, 'error', 'ERR_REASON_REQUIRED: A reason of at least 10 characters is required to allow re-application. It is written to the audit log.');
    END IF;

    SELECT * INTO v_driver FROM public.driver WHERE driver_id = v_aff.driver_id;
    IF v_driver.driver_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Driver profile not found.');
    END IF;

    -- Permanently disqualified drivers can NEVER be cleared (Rule 3.9)
    IF v_driver.is_permanently_disqualified = TRUE THEN
        RETURN jsonb_build_object('success', false, 'error', 'Permanently disqualified driver cannot be cleared for re-application.');
    END IF;

    -- Must be currently rejected
    IF NOT (v_aff.toda_endorsement_status = 'Rejected' OR v_aff.lgu_verification_status = 'Rejected' OR v_driver.account_status = 'Rejected') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only rejected applications can be cleared for re-application.');
    END IF;

    SELECT full_name INTO v_admin_name FROM public.lgu_admin WHERE auth_user_id = auth.uid() LIMIT 1;
    v_old_state := to_jsonb(v_aff);

    PERFORM set_config('sakay.internal_context', 'true', true);

    -- Clear rejection on the affiliation: back to Submitted so the driver can be reviewed again
    UPDATE public.driver_toda_affiliation
    SET toda_endorsement_status = 'Submitted',
        lgu_verification_status = 'Pending',
        toda_rejection_reason = NULL,
        lgu_rejection_reason = NULL,
        toda_return_notes = NULL,
        lgu_return_notes = NULL,
        submitted_at = CURRENT_TIMESTAMP,
        resubmitted_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE affiliation_id = p_affiliation_id;

    -- Clear driver account rejection status
    UPDATE public.driver
    SET account_status = 'Pending Verification',
        rejection_reason = NULL,
        rejection_comment = NULL,
        rejected_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE driver_id = v_aff.driver_id;

    UPDATE public.driver_verification
    SET verification_status = 'Pending',
        rejection_reason = NULL,
        rejection_comment = NULL
    WHERE driver_id = v_aff.driver_id;

    -- Immutable audit log: who, why, and what was cleared (the earlier reasons are also in before_state)
    INSERT INTO public.audit_log (
        action_type, target_id, actor_id, actor_role, details, before_state, performed_at
    ) VALUES (
        'DRIVER_REAPPLICATION_ALLOWED',
        p_affiliation_id::TEXT,
        auth.uid(),
        'lgu_admin',
        'LGU administrator ' || COALESCE(v_admin_name, auth.uid()::TEXT) || ' cleared the rejection of ' || COALESCE(v_driver.full_name, 'a driver')
            || ' to allow re-application. Reason: ' || trim(p_reason)
            || '. Cleared: TODA stage "' || COALESCE(NULLIF(v_aff.toda_rejection_reason, ''), v_aff.toda_endorsement_status)
            || '", LGU stage "' || COALESCE(NULLIF(v_aff.lgu_rejection_reason, ''), v_aff.lgu_verification_status) || '".',
        v_old_state,
        CURRENT_TIMESTAMP
    );

    PERFORM set_config('sakay.internal_context', '', false);

    RETURN jsonb_build_object('success', true, 'message', 'Re-application allowed. Driver application reset to Submitted.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

COMMIT;
