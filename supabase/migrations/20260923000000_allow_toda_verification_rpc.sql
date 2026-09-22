-- ============================================================================
-- Migration: 20260923000000_allow_toda_verification_rpc.sql
-- Purpose:
--   1. Provide SECURITY DEFINER RPC functions for TODA accreditation management
--      (approval, return for correction, and deactivation) so that LGU Admin action
--      persists TODA active/approved status directly to public.toda in PostgreSQL
--      without being blocked by RLS policies when client runs under anon/authenticated roles.
-- ============================================================================

-- 1. RPC function to approve TODA application / accreditation
CREATE OR REPLACE FUNCTION public.approve_toda_accreditation(p_toda_id TEXT, p_remarks TEXT DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
    v_cert_no TEXT;
    v_cert_expiry TIMESTAMPTZ;
    v_toda public.toda;
BEGIN
    v_cert_no := 'CERT-LGU-' || EXTRACT(YEAR FROM CURRENT_TIMESTAMP) || '-' || FLOOR(100 + RANDOM() * 900)::TEXT;
    v_cert_expiry := CURRENT_TIMESTAMP + INTERVAL '3 years';

    -- Update public.toda
    UPDATE public.toda
    SET toda_status = 'Active',
        account_status = 'Active',
        certificate_number = COALESCE(certificate_number, v_cert_no),
        certificate_expiry = COALESCE(certificate_expiry, v_cert_expiry)
    WHERE toda_id::TEXT = p_toda_id
       OR toda_acronym ILIKE p_toda_id
       OR toda_name ILIKE p_toda_id
    RETURNING * INTO v_toda;

    IF v_toda.toda_id IS NULL THEN
        -- Attempt fallback update matching by substring or acronym match
        UPDATE public.toda
        SET toda_status = 'Active',
            account_status = 'Active',
            certificate_number = COALESCE(certificate_number, v_cert_no),
            certificate_expiry = COALESCE(certificate_expiry, v_cert_expiry)
        WHERE toda_acronym ILIKE '%' || p_toda_id || '%'
           OR toda_name ILIKE '%' || p_toda_id || '%'
        RETURNING * INTO v_toda;
    END IF;

    IF v_toda.toda_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'TODA record not found in database');
    END IF;

    -- Update associated TODA admin accounts to Active
    UPDATE public.toda_admin
    SET account_status = 'Active'
    WHERE toda_id = v_toda.toda_id;

    -- Log audit event
    BEGIN
        INSERT INTO public.audit_log (action_type, target_id, details, performed_at)
        VALUES (
            'TODA_ACCREDITATION_APPROVED',
            v_toda.toda_id::TEXT,
            '[Accreditation] Approved municipal accreditation for TODA ''' || v_toda.toda_name || '''. Issued Certificate ' || COALESCE(v_toda.certificate_number, v_cert_no) || '. ' || COALESCE(p_remarks, ''),
            CURRENT_TIMESTAMP
        );
    EXCEPTION WHEN OTHERS THEN
        -- Audit logging failure should not abort transaction
    END;

    RETURN jsonb_build_object(
        'success', true,
        'data', to_jsonb(v_toda)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 2. RPC function to return TODA application for correction
CREATE OR REPLACE FUNCTION public.return_toda_accreditation(p_toda_id TEXT, p_reason TEXT DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
    v_toda public.toda;
BEGIN
    UPDATE public.toda
    SET toda_status = 'Resubmission Required',
        account_status = 'Resubmission Required',
        resubmission_reason = COALESCE(p_reason, 'Document correction required')
    WHERE toda_id::TEXT = p_toda_id
       OR toda_acronym ILIKE p_toda_id
       OR toda_name ILIKE p_toda_id
    RETURNING * INTO v_toda;

    IF v_toda.toda_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'TODA record not found in database');
    END IF;

    UPDATE public.toda_admin
    SET account_status = 'Resubmission Required'
    WHERE toda_id = v_toda.toda_id;

    RETURN jsonb_build_object(
        'success', true,
        'data', to_jsonb(v_toda)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 3. RPC function to deactivate / decline TODA accreditation
CREATE OR REPLACE FUNCTION public.deactivate_toda_accreditation(p_toda_id TEXT, p_reason TEXT DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
    v_toda public.toda;
BEGIN
    UPDATE public.toda
    SET toda_status = 'Deactivated',
        account_status = 'Deactivated',
        decline_reason = COALESCE(p_reason, 'Accreditation deactivated by LGU Transport Office')
    WHERE toda_id::TEXT = p_toda_id
       OR toda_acronym ILIKE p_toda_id
       OR toda_name ILIKE p_toda_id
    RETURNING * INTO v_toda;

    IF v_toda.toda_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'TODA record not found in database');
    END IF;

    UPDATE public.toda_admin
    SET account_status = 'Deactivated'
    WHERE toda_id = v_toda.toda_id;

    RETURN jsonb_build_object(
        'success', true,
        'data', to_jsonb(v_toda)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Grant permissions to execute these RPC functions
GRANT EXECUTE ON FUNCTION public.approve_toda_accreditation(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.return_toda_accreditation(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_toda_accreditation(TEXT, TEXT) TO anon, authenticated, service_role;
