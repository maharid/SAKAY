-- ============================================================================
-- Migration: 20261029000001_lgu_portal_fixes.sql
-- Fixes found when Part A (LGU Administrator) of the final checklist was checked against the code (2026-10-21).
--
--   1. announcement: published_at / unpublished_at / updated_at, stamped by the database, never by the browser
--      (Features LGU 1.7: "publish or unpublish an announcement, with timestamps"). Edit, publish and unpublish are now plain updates of the
--      same row; the screen used to change only what it showed.
--   2. approve_toda_accreditation(): refuses an application that has no Barangay Clearance on file (Rule 2.1, checklist A2.8). The LGU
--      Administrator reads the certificate number and the "valid until" date from the clearance and types them; the screen no longer
--      invents them. The expiry date must still be in the future (unchanged).
--   3. incident_refer_to_toda(): the LGU Administrator sends a report back to the involved TODA for action (Features LGU 1.6). A report of
--      assault, harassment, a threat or a crime is never sent to a TODA (Rule 19.8).
--   4. admin_send_driver_renewal_reminder() / admin_send_toda_renewal_reminder(): the "Send Renewal Alert" buttons of the LGU portal
--      only wrote an audit row and said "sent". They now deliver a real notice (to the driver, or to the TODA's administrators).
--
-- Forward-only, ASCII only, safe to run twice. Nothing is deleted. The one data change is the back-fill of published_at for announcements that
-- are already published.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ANNOUNCEMENTS: the database stamps when each one was published, unpublished and last changed
-- ----------------------------------------------------------------------------
ALTER TABLE public.announcement ADD COLUMN IF NOT EXISTS published_at   TIMESTAMPTZ;
ALTER TABLE public.announcement ADD COLUMN IF NOT EXISTS unpublished_at TIMESTAMPTZ;
ALTER TABLE public.announcement ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.announcement_stamp_publication()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.published_at := CASE WHEN COALESCE(NEW.is_published, TRUE) THEN v_now ELSE NULL END;
        NEW.unpublished_at := NULL;
    ELSE
        -- the two times move only when the published flag flips; whatever the caller sends for them is ignored
        NEW.published_at := OLD.published_at;
        NEW.unpublished_at := OLD.unpublished_at;
        IF COALESCE(NEW.is_published, TRUE) IS DISTINCT FROM COALESCE(OLD.is_published, TRUE) THEN
            IF COALESCE(NEW.is_published, TRUE) THEN
                NEW.published_at := v_now;
                NEW.unpublished_at := NULL;
            ELSE
                NEW.unpublished_at := v_now;
            END IF;
        END IF;
    END IF;
    NEW.updated_at := v_now;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_announcement_stamp_publication ON public.announcement;
CREATE TRIGGER trigger_announcement_stamp_publication
    BEFORE INSERT OR UPDATE ON public.announcement
    FOR EACH ROW EXECUTE FUNCTION public.announcement_stamp_publication();

-- announcements that were already live were published when they were created
UPDATE public.announcement SET published_at = created_at WHERE published_at IS NULL AND COALESCE(is_published, TRUE);

-- ----------------------------------------------------------------------------
-- 2. TODA APPROVAL: a Barangay Clearance must be on file
-- ----------------------------------------------------------------------------
-- Verbatim copy of the newest definition (20260930080000_batch1_onboarding_and_expiry.sql) with the marked addition.
CREATE OR REPLACE FUNCTION public.approve_toda_accreditation(
    p_toda_id UUID,
    p_certificate_number TEXT,
    p_certificate_expiry TIMESTAMPTZ,
    p_remarks TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_toda public.toda;
    v_old_state JSONB;
BEGIN
    IF NOT public.is_lgu_admin() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Access Denied: Only LGU Administrators can approve TODA accreditation.');
    END IF;

    IF p_certificate_number IS NULL OR trim(p_certificate_number) = '' OR p_certificate_expiry IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Official Certificate Number and Expiration Date are mandatory.');
    END IF;

    IF (p_certificate_expiry AT TIME ZONE 'Asia/Manila')::DATE <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::DATE THEN
        RETURN jsonb_build_object('success', false, 'error', 'Certificate expiry date must be in the future.');
    END IF;

    -- Match exact ID only (no ILIKE)
    SELECT * INTO v_toda FROM public.toda WHERE toda_id = p_toda_id;

    IF v_toda.toda_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'TODA record not found.');
    END IF;

    -- Rule 2.1 (LGU portal fix): only a TODA that holds a Barangay Clearance may be accredited. A missing file is refused here;
    -- the validity date is the one the Administrator reads from that clearance (it must be in the future, checked above).
    IF v_toda.barangay_clearance_url IS NULL OR trim(v_toda.barangay_clearance_url) = '' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'ERR_CLEARANCE_MISSING',
            'error', 'This application has no Barangay Clearance on file. Return it for correction so the TODA uploads one.');
    END IF;

    v_old_state := to_jsonb(v_toda);

    PERFORM set_config('sakay.internal_context', 'true', true);

    UPDATE public.toda
    SET toda_status = 'Active',
        account_status = 'Active',
        certificate_number = p_certificate_number,
        certificate_expiry = p_certificate_expiry
    WHERE toda_id = p_toda_id
    RETURNING * INTO v_toda;

    UPDATE public.toda_admin
    SET account_status = 'Active'
    WHERE toda_id = p_toda_id;

    -- Record immutable audit log
    INSERT INTO public.audit_log (
        action_type, target_id, actor_id, actor_role, details, before_state, after_state, performed_at
    ) VALUES (
        'TODA_ACCREDITATION_APPROVED',
        p_toda_id::TEXT,
        auth.uid(),
        'lgu_admin',
        'Approved municipal accreditation for TODA ''' || v_toda.toda_name || '''. Cert: ' || p_certificate_number || '. ' || COALESCE(p_remarks, ''),
        v_old_state,
        to_jsonb(v_toda),
        CURRENT_TIMESTAMP
    );

    RETURN jsonb_build_object('success', true, 'data', to_jsonb(v_toda));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 3. INCIDENTS: the LGU Administrator refers a report to the involved TODA
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.incident_refer_to_toda(p_incident_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_i    public.incident_report;
    v_toda UUID;
    v_name TEXT;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_now  TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RAISE EXCEPTION 'Access Denied: Only the LGU Administrator can refer a report to a TODA.';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
        RAISE EXCEPTION 'ERR_INCIDENT_REASON: Write why the report is referred to the TODA (at least 10 characters).';
    END IF;
    SELECT * INTO v_i FROM public.incident_report WHERE incident_id = p_incident_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_INCIDENT_NOT_FOUND: The report was not found.';
    END IF;
    IF v_i.outcome IS NOT NULL OR v_i.status = 'Cancelled' THEN
        RAISE EXCEPTION 'ERR_INCIDENT_CLOSED: The report is closed.';
    END IF;
    IF v_i.priority = 'Serious' OR public._incident_category_class(v_i.category) = 'SERIOUS' THEN
        RAISE EXCEPTION 'ERR_INCIDENT_SERIOUS: A report of assault, harassment, a threat or a crime stays with the LGU Administrator (Rule 19.8).';
    END IF;
    v_toda := COALESCE(v_i.reported_toda_id, (SELECT d.toda_id FROM public.driver d WHERE d.driver_id = v_i.driver_id));
    IF v_toda IS NULL THEN
        RAISE EXCEPTION 'ERR_INCIDENT_NO_TODA: No TODA is involved in this report, so there is nobody to refer it to.';
    END IF;
    IF v_i.routing = 'TODA' THEN
        RETURN jsonb_build_object('success', TRUE, 'unchanged', TRUE, 'routing', 'TODA');
    END IF;
    SELECT t.toda_name INTO v_name FROM public.toda t WHERE t.toda_id = v_toda;

    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.incident_report
       SET routing = 'TODA',
           reported_toda_id = v_toda,
           status = 'Pending',
           first_action_due_at = public.add_business_days(v_now, public.incident_constant('standard_first_review_business_days')),
           first_action_at = NULL,
           decision_due_at = NULL
     WHERE incident_id = p_incident_id;
    PERFORM public._incident_notify_reporter(v_i, 'INCIDENT_REFERRED', 'Ipinasa sa TODA ang iyong ulat (Your report went to the TODA)',
        'The LGU Administrator sent your report to the driver''s TODA Administrator for action. (Ipinasa ng LGU sa TODA ang ulat mo para sa aksyon.)', 3);
    PERFORM public.record_policy_audit('INCIDENT_REFERRED_TO_TODA', p_incident_id::TEXT, NULL, 'Incident Reports',
        'The LGU Administrator referred the report (' || v_i.category || ') to ' || COALESCE(v_name, 'the TODA') || ' for action: ' || btrim(p_reason),
        jsonb_build_object('routing', v_i.routing, 'priority', v_i.priority, 'status', v_i.status),
        jsonb_build_object('routing', 'TODA', 'toda_id', v_toda, 'incident_id', p_incident_id, 'category', v_i.category));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'routing', 'TODA', 'toda_id', v_toda);
END;
$$;

REVOKE ALL ON FUNCTION public.incident_refer_to_toda(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.incident_refer_to_toda(UUID, TEXT) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. RENEWAL REMINDERS: a real notice, not only an audit row
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_send_driver_renewal_reminder(p_driver_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_d    public.driver;
    v_msg  TEXT;
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_LGU_ADMIN', 'error', 'Only the LGU Administrator can send this reminder.');
    END IF;
    SELECT * INTO v_d FROM public.driver WHERE driver_id = p_driver_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_FOUND', 'error', 'The driver was not found.');
    END IF;
    IF EXISTS (SELECT 1 FROM public.audit_log
                WHERE action_type = 'DRIVER_RENEWAL_REMINDER_SENT' AND target_id = p_driver_id::TEXT
                  AND performed_at > CURRENT_TIMESTAMP - INTERVAL '10 minutes') THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_REMINDER_TOO_SOON', 'error', 'A reminder was sent to this driver a few minutes ago.');
    END IF;

    v_msg := 'Please renew your documents and upload the new ones in the app so you can keep going Online. '
          || CASE WHEN v_d.license_expiry IS NOT NULL THEN 'Driver''s License valid until ' || to_char(v_d.license_expiry, 'Mon DD, YYYY') || '. ' ELSE '' END
          || CASE WHEN v_d.mtop_expiry IS NOT NULL THEN 'MTOP valid until ' || to_char(v_d.mtop_expiry, 'Mon DD, YYYY') || '. ' ELSE '' END
          || '(I-renew ang iyong lisensya at MTOP at i-upload sa app.)';
    INSERT INTO public.notification (driver_id, title, message, notification_type, sent_at)
    VALUES (v_d.driver_id, 'Renewal reminder from the LGU (Paalala sa pag-renew)', v_msg, 'LGU_RENEWAL_REMINDER', CURRENT_TIMESTAMP);

    PERFORM public.record_policy_audit('DRIVER_RENEWAL_REMINDER_SENT', v_d.driver_id::TEXT, v_d.full_name, 'Verification',
        'The LGU Administrator sent the driver a document renewal reminder.', NULL,
        jsonb_build_object('license_expiry', v_d.license_expiry, 'mtop_expiry', v_d.mtop_expiry));
    RETURN jsonb_build_object('success', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_send_toda_renewal_reminder(p_toda_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_t    public.toda;
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_LGU_ADMIN', 'error', 'Only the LGU Administrator can send this reminder.');
    END IF;
    SELECT * INTO v_t FROM public.toda WHERE toda_id = p_toda_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_FOUND', 'error', 'The TODA was not found.');
    END IF;
    IF EXISTS (SELECT 1 FROM public.audit_log
                WHERE action_type = 'TODA_RENEWAL_REMINDER_SENT' AND target_id = p_toda_id::TEXT
                  AND performed_at > CURRENT_TIMESTAMP - INTERVAL '10 minutes') THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_REMINDER_TOO_SOON', 'error', 'A reminder was sent to this TODA a few minutes ago.');
    END IF;

    INSERT INTO public.notification (recipient_id, subject_id, title, message, notification_type, sent_at)
    VALUES ('toda_' || v_t.toda_id::TEXT, v_t.toda_id::TEXT,
            'Renewal reminder from the LGU (Paalala sa pag-renew)',
            'Please renew the Barangay Clearance of ' || v_t.toda_name
              || CASE WHEN v_t.certificate_expiry IS NOT NULL THEN ' (valid until ' || to_char(v_t.certificate_expiry AT TIME ZONE 'Asia/Manila', 'Mon DD, YYYY') || ')' ELSE '' END
              || ' and upload the new one under Account Management, so your drivers can stay Online. (I-renew ang Barangay Clearance at i-upload.)',
            'LGU_RENEWAL_REMINDER', CURRENT_TIMESTAMP);

    PERFORM public.record_policy_audit('TODA_RENEWAL_REMINDER_SENT', v_t.toda_id::TEXT, v_t.toda_name, 'Verification',
        'The LGU Administrator sent the TODA a Barangay Clearance renewal reminder.', NULL,
        jsonb_build_object('certificate_expiry', v_t.certificate_expiry));
    RETURN jsonb_build_object('success', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_send_driver_renewal_reminder(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_send_toda_renewal_reminder(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_send_driver_renewal_reminder(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_send_toda_renewal_reminder(UUID) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Self-check: the new functions exist and are closed to the anonymous role
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF has_function_privilege('anon', 'public.incident_refer_to_toda(uuid,text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.admin_send_driver_renewal_reminder(uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.admin_send_toda_renewal_reminder(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'the LGU portal fix functions must not be callable by anon';
    END IF;
END $$;
