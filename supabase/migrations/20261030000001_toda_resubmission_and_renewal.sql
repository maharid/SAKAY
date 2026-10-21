-- ============================================================================
-- TODA SIDE OF THE ACCREDITATION CYCLE: correct and resubmit, renew, declare the clearance validity (Rules 2.1, 24.1 - 24.4; checklist A2.5, A2.15, B1)
-- ============================================================================
-- Found while verifying the LGU portal: a TODA administrator cannot change toda_status / account_status of their own TODA (the protect trigger refuses it:
-- "Access Denied: ... TODA status can only be modified by LGU Administrators or through authorized RPCs"), and there was no authorized RPC. So the TODA portal's
-- "re-upload a document" and "resubmit" always failed: a TODA the LGU returned for correction could never go back into review, and a renewed Barangay Clearance
-- could not reach the LGU. This migration adds the authorized RPCs. Everything is ADDITIVE (new columns, new functions, two functions replaced as verbatim
-- copies plus the marked change).
--
--   1. toda: declared_clearance_valid_until (what the TODA says the clearance is valid until; the LGU reads the document and types the real date at approval),
--            barangay_clearance_submitted_at (when the current clearance file was submitted), renewal_submitted_at (a renewed clearance waiting for the LGU).
--   2. protect_toda_read_only_columns(): the clearance file and the two timestamps change only through the RPCs below (or the LGU / the server).
--   3. toda_declare_clearance_validity(date)               the TODA's own administrator states the validity date (used at registration)
--   4. toda_submit_compliance_document(category, path, name, valid_until)   replaces a file; for an Active TODA a new clearance is a RENEWAL: the status is
--                                                              untouched, the LGU is flagged (TODA_RENEWAL_SUBMITTED) and records it with the new certificate
--   5. toda_resubmit_application(note)                      Resubmission Required -> Pending Verification, for the TODA's own application only
--   6. approve_toda_accreditation(): also clears the renewal marker and resolves the renewal flag
--   7. check_driver_credential_uniqueness(): also flags a duplicate franchise / MTOP number (Rule 3.2, checklist A3.7)
--   8. announcement: the database records who wrote it (a TODA's announcement could not be posted at all: the browser sent the login id where the table
--      wants the administrator id, so the foreign key refused every one)
--   9. announcement: who may READ it (until now any signed-in person could read every announcement, drafts included, and every TODA's notices)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. COLUMNS
-- ----------------------------------------------------------------------------
ALTER TABLE public.toda ADD COLUMN IF NOT EXISTS declared_clearance_valid_until DATE;
ALTER TABLE public.toda ADD COLUMN IF NOT EXISTS barangay_clearance_submitted_at TIMESTAMPTZ;
ALTER TABLE public.toda ADD COLUMN IF NOT EXISTS renewal_submitted_at TIMESTAMPTZ;

-- a clearance that is already on file was submitted when the application was (the earliest time on record)
UPDATE public.toda
   SET barangay_clearance_submitted_at = created_at
 WHERE barangay_clearance_submitted_at IS NULL
   AND barangay_clearance_url IS NOT NULL AND btrim(barangay_clearance_url) <> '';

COMMENT ON COLUMN public.toda.declared_clearance_valid_until IS 'What the TODA states its Barangay Clearance is valid until (Rule 2.1). The LGU Administrator reads the document and records the real date as certificate_expiry at approval or renewal.';
COMMENT ON COLUMN public.toda.barangay_clearance_submitted_at IS 'When the current Barangay Clearance file was submitted. Set by toda_submit_compliance_document() only.';
COMMENT ON COLUMN public.toda.renewal_submitted_at IS 'A renewed Barangay Clearance of an Active TODA, waiting for the LGU Administrator to record the renewal. Set by toda_submit_compliance_document(), cleared by approve_toda_accreditation().';

-- ----------------------------------------------------------------------------
-- 2. PROTECTION: the clearance file and its timestamps only through the RPCs
-- ----------------------------------------------------------------------------
-- Verbatim copy of the newest definition (20261008000002_perimeter_expand.sql) with the three marked columns added.
CREATE OR REPLACE FUNCTION public.protect_toda_read_only_columns()
RETURNS TRIGGER AS $$
BEGIN
    IF COALESCE(public.is_lgu_admin(), FALSE)
       OR COALESCE(public.is_service_context(), FALSE) THEN
        RETURN NEW;
    END IF;

    IF NEW.terminal_latitude IS DISTINCT FROM OLD.terminal_latitude
       OR NEW.terminal_longitude IS DISTINCT FROM OLD.terminal_longitude
       OR NEW.certificate_expiry IS DISTINCT FROM OLD.certificate_expiry
       OR NEW.certificate_number IS DISTINCT FROM OLD.certificate_number
       OR NEW.account_status IS DISTINCT FROM OLD.account_status
       OR NEW.toda_status IS DISTINCT FROM OLD.toda_status
       -- added: a signed-in person (a TODA administrator) cannot change the clearance file or when it arrived with a table update; that goes through
       -- toda_submit_compliance_document(). A migration or a maintenance session has no signed-in user, so re-running an older migration still works.
       OR (auth.uid() IS NOT NULL
           AND (NEW.barangay_clearance_url IS DISTINCT FROM OLD.barangay_clearance_url
                OR NEW.barangay_clearance_submitted_at IS DISTINCT FROM OLD.barangay_clearance_submitted_at
                OR NEW.renewal_submitted_at IS DISTINCT FROM OLD.renewal_submitted_at)) THEN
        RAISE EXCEPTION 'Access Denied: Terminal coordinates, certificate data, and TODA status can only be modified by LGU Administrators or through authorized RPCs.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- helper: the TODA the signed-in user administers (NULL fields when none). Not callable by users: only by the functions below.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._toda_of_caller()
RETURNS public.toda
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT t.*
      FROM public.toda t
      JOIN public.toda_admin a ON a.toda_id = t.toda_id
     WHERE a.auth_user_id = auth.uid()
       AND a.account_status <> 'Suspended'
     LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public._toda_of_caller() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. DECLARE THE CLEARANCE VALIDITY (registration and renewal)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.toda_declare_clearance_validity(p_valid_until DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v public.toda;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_AUTH_REQUIRED', 'error', 'Sign in first.');
    END IF;
    v := public._toda_of_caller();
    IF v.toda_id IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_TODA_ADMIN', 'error', 'Only the administrator of a TODA can do this.');
    END IF;
    IF v.toda_status NOT IN ('Pending Verification', 'Resubmission Required', 'Active') THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_TODA_STATUS', 'error', 'This TODA cannot change its documents while it is ' || lower(v.toda_status) || '. Contact the City Transport Office.');
    END IF;
    IF p_valid_until IS NULL OR p_valid_until <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::DATE THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_VALIDITY_DATE', 'error', 'Enter the date the Barangay Clearance is valid until. It must be after today.');
    END IF;

    UPDATE public.toda SET declared_clearance_valid_until = p_valid_until WHERE toda_id = v.toda_id;

    PERFORM public.record_policy_audit('TODA_CLEARANCE_VALIDITY_DECLARED', v.toda_id::TEXT, v.toda_name, 'Verification',
        'The TODA stated that its Barangay Clearance is valid until ' || to_char(p_valid_until, 'Mon DD, YYYY') || '. The LGU Administrator confirms it against the document.',
        jsonb_build_object('declared_clearance_valid_until', v.declared_clearance_valid_until),
        jsonb_build_object('declared_clearance_valid_until', p_valid_until));
    RETURN jsonb_build_object('success', TRUE);
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. SUBMIT A COMPLIANCE DOCUMENT (a correction, or the renewed clearance of an Active TODA)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.toda_submit_compliance_document(
    p_category TEXT,
    p_path TEXT,
    p_file_name TEXT,
    p_valid_until DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v      public.toda;
    v_uid  UUID := auth.uid();
    v_prev TEXT;
    v_new  public.toda;
    v_renewal BOOLEAN;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_AUTH_REQUIRED', 'error', 'Sign in first.');
    END IF;
    v := public._toda_of_caller();
    IF v.toda_id IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_TODA_ADMIN', 'error', 'Only the administrator of a TODA can submit its documents.');
    END IF;
    IF v.toda_status NOT IN ('Pending Verification', 'Resubmission Required', 'Active') THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_TODA_STATUS', 'error', 'This TODA cannot submit documents while it is ' || lower(v.toda_status) || '. Contact the City Transport Office.');
    END IF;
    IF p_category NOT IN ('Barangay Clearance', 'Driver Roster', 'Internal Bylaws') THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_CATEGORY', 'error', 'Choose the Barangay Clearance, the Driver Roster or the Internal Bylaws.');
    END IF;
    -- the file must be one this login uploaded into its own folder of the private bucket
    IF p_path IS NULL OR btrim(p_path) = '' OR length(p_path) > 400 OR position('..' IN p_path) > 0 OR left(p_path, length(v_uid::TEXT) + 1) <> v_uid::TEXT || '/' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_FILE', 'error', 'The uploaded file could not be found in your own folder. Upload it again.');
    END IF;
    IF p_category = 'Barangay Clearance'
       AND (p_valid_until IS NULL OR p_valid_until <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::DATE) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_VALIDITY_DATE', 'error', 'Enter the date the Barangay Clearance is valid until. It must be after today.');
    END IF;

    v_renewal := (v.toda_status = 'Active' AND p_category = 'Barangay Clearance');

    -- the protected columns change here, by the function, not by the caller's own privileges
    v_prev := current_setting('sakay.internal_context', true);
    PERFORM set_config('sakay.internal_context', 'true', true);

    IF p_category = 'Barangay Clearance' THEN
        UPDATE public.toda
           SET barangay_clearance_url = p_path,
               barangay_clearance_submitted_at = CURRENT_TIMESTAMP,
               declared_clearance_valid_until = p_valid_until,
               renewal_submitted_at = CASE WHEN v_renewal THEN CURRENT_TIMESTAMP ELSE renewal_submitted_at END
         WHERE toda_id = v.toda_id
        RETURNING * INTO v_new;
    ELSIF p_category = 'Driver Roster' THEN
        UPDATE public.toda SET accredited_drivers_url = p_path WHERE toda_id = v.toda_id RETURNING * INTO v_new;
    ELSE
        UPDATE public.toda SET bylaws_url = p_path WHERE toda_id = v.toda_id RETURNING * INTO v_new;
    END IF;

    IF v_renewal THEN
        -- the LGU Administrator sees it on the Dashboard until the renewal is recorded
        INSERT INTO public.admin_review_flag (flag_type, subject_type, subject_id, source_rule, assigned_role, details)
        VALUES ('TODA_RENEWAL_SUBMITTED', 'toda', v.toda_id::TEXT, 'Rule 24.3', 'lgu_admin',
                jsonb_build_object('toda_name', v.toda_name, 'file_name', p_file_name, 'declared_valid_until', p_valid_until,
                                   'current_certificate_expiry', v.certificate_expiry, 'submitted_at', CURRENT_TIMESTAMP))
        ON CONFLICT (subject_type, subject_id, flag_type) WHERE status IN ('Open', 'Under Review')
        DO UPDATE SET details = EXCLUDED.details;
    END IF;

    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);

    PERFORM public.record_policy_audit(
        CASE WHEN v_renewal THEN 'TODA_CLEARANCE_RENEWAL_SUBMITTED' ELSE 'COMPLIANCE_DOCUMENT_UPDATED' END,
        v.toda_id::TEXT, v.toda_name, 'Verification',
        CASE WHEN v_renewal
             THEN 'Submitted a renewed Barangay Clearance ("' || COALESCE(p_file_name, 'file') || '"), valid until ' || to_char(p_valid_until, 'Mon DD, YYYY') || ', for the LGU Administrator to record. The accreditation is unchanged until then.'
             ELSE 'Submitted ' || p_category || ' ("' || COALESCE(p_file_name, 'file') || '") for the LGU Administrator''s review.' END,
        jsonb_build_object('toda_status', v.toda_status, 'barangay_clearance_url', v.barangay_clearance_url),
        jsonb_build_object('toda_status', v_new.toda_status, 'category', p_category, 'declared_clearance_valid_until', v_new.declared_clearance_valid_until));

    RETURN jsonb_build_object('success', TRUE, 'renewal', v_renewal, 'toda_status', v_new.toda_status);
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. RESUBMIT A RETURNED APPLICATION
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.toda_resubmit_application(p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v      public.toda;
    v_prev TEXT;
    v_new  public.toda;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_AUTH_REQUIRED', 'error', 'Sign in first.');
    END IF;
    v := public._toda_of_caller();
    IF v.toda_id IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_TODA_ADMIN', 'error', 'Only the administrator of a TODA can resubmit its application.');
    END IF;
    IF v.toda_status IS DISTINCT FROM 'Resubmission Required' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_RETURNED', 'error', 'This application was not returned for correction, so there is nothing to resubmit.');
    END IF;
    IF v.barangay_clearance_url IS NULL OR btrim(v.barangay_clearance_url) = '' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_CLEARANCE_MISSING', 'error', 'Upload the Barangay Clearance before resubmitting.');
    END IF;

    v_prev := current_setting('sakay.internal_context', true);
    PERFORM set_config('sakay.internal_context', 'true', true);

    UPDATE public.toda
       SET toda_status = 'Pending Verification',
           account_status = 'Pending Verification',
           resubmission_reason = NULL
     WHERE toda_id = v.toda_id
    RETURNING * INTO v_new;

    UPDATE public.toda_admin SET account_status = 'Pending Verification' WHERE toda_id = v.toda_id;

    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);

    PERFORM public.record_policy_audit('TODA_APPLICATION_RESUBMITTED', v.toda_id::TEXT, v.toda_name, 'Verification',
        'Corrected and resubmitted the accreditation application.' || CASE WHEN COALESCE(btrim(p_note), '') <> '' THEN ' Note to the LGU: ' || btrim(p_note) ELSE '' END,
        jsonb_build_object('toda_status', v.toda_status, 'resubmission_reason', v.resubmission_reason),
        jsonb_build_object('toda_status', v_new.toda_status));
    RETURN jsonb_build_object('success', TRUE, 'toda_status', v_new.toda_status);
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. APPROVAL / RENEWAL: clears the renewal marker
-- ----------------------------------------------------------------------------
-- Verbatim copy of the newest definition (20261029000001_lgu_portal_fixes.sql) with the marked additions.
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
        certificate_expiry = p_certificate_expiry,
        -- added: the renewal (if one was submitted) is now recorded
        renewal_submitted_at = NULL
    WHERE toda_id = p_toda_id
    RETURNING * INTO v_toda;

    UPDATE public.toda_admin
    SET account_status = 'Active'
    WHERE toda_id = p_toda_id;

    -- added: the Dashboard flag for a submitted renewal is resolved by this decision
    UPDATE public.admin_review_flag
       SET status = 'Resolved', resolved_at = CURRENT_TIMESTAMP,
           resolution = 'Renewal recorded: certificate ' || p_certificate_number || ', valid until ' || to_char(p_certificate_expiry AT TIME ZONE 'Asia/Manila', 'Mon DD, YYYY') || '.'
     WHERE flag_type = 'TODA_RENEWAL_SUBMITTED' AND subject_type = 'toda' AND subject_id = p_toda_id::TEXT AND status IN ('Open', 'Under Review');

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
-- 7. DUPLICATE FRANCHISE / MTOP NUMBER (Rule 3.2: license, MTOP franchise and plate numbers are validated for uniqueness)
-- ----------------------------------------------------------------------------
-- Verbatim copy of the newest definition (20260930080000_batch1_onboarding_and_expiry.sql) with the marked franchise check added. The plate check used to set
-- is_duplicate_mtop (the wrong column); that flag now means what its name says.
CREATE OR REPLACE FUNCTION public.check_driver_credential_uniqueness()
RETURNS TRIGGER AS $$
DECLARE
    v_norm_lic TEXT;
    v_norm_plate TEXT;
    v_norm_franchise TEXT;
    v_dup_driver UUID;
BEGIN
    v_norm_lic := regexp_replace(upper(COALESCE(NEW.submitted_license_number, '')), '[^A-Z0-9]', '', 'g');
    v_norm_plate := regexp_replace(upper(COALESCE(NEW.submitted_plate_number, '')), '[^A-Z0-9]', '', 'g');
    v_norm_franchise := regexp_replace(upper(COALESCE(NEW.submitted_franchise_number, '')), '[^A-Z0-9]', '', 'g');

    -- Check license uniqueness across other drivers
    IF v_norm_lic != '' THEN
        SELECT driver_id INTO v_dup_driver
        FROM public.driver
        WHERE driver_id != NEW.driver_id
          AND regexp_replace(upper(COALESCE(license_number, '')), '[^A-Z0-9]', '', 'g') = v_norm_lic
        LIMIT 1;

        IF v_dup_driver IS NOT NULL THEN
            NEW.scan_status := 'Flagged';
            NEW.is_duplicate_license := TRUE;

            INSERT INTO public.admin_review_flag (
                flag_type, subject_type, subject_id, source_rule, assigned_role, details
            ) VALUES (
                'DUPLICATE_LICENSE',
                'driver_application',
                NEW.driver_id::TEXT,
                'Rule 3.2',
                'lgu_admin',
                jsonb_build_object(
                    'type', 'license',
                    'number', NEW.submitted_license_number,
                    'conflicting_driver_id', v_dup_driver
                )
            ) ON CONFLICT (subject_type, subject_id, flag_type) WHERE status IN ('Open', 'Under Review') DO NOTHING;
        END IF;
    END IF;

    -- Check plate uniqueness across other drivers
    IF v_norm_plate != '' THEN
        SELECT driver_id INTO v_dup_driver
        FROM public.driver
        WHERE driver_id != NEW.driver_id
          AND regexp_replace(upper(COALESCE(plate_number, '')), '[^A-Z0-9]', '', 'g') = v_norm_plate
        LIMIT 1;

        IF v_dup_driver IS NOT NULL THEN
            NEW.scan_status := 'Flagged';

            INSERT INTO public.admin_review_flag (
                flag_type, subject_type, subject_id, source_rule, assigned_role, details
            ) VALUES (
                'DUPLICATE_PLATE',
                'driver_application',
                NEW.driver_id::TEXT,
                'Rule 3.2',
                'lgu_admin',
                jsonb_build_object(
                    'type', 'plate',
                    'number', NEW.submitted_plate_number,
                    'conflicting_driver_id', v_dup_driver
                )
            ) ON CONFLICT (subject_type, subject_id, flag_type) WHERE status IN ('Open', 'Under Review') DO NOTHING;
        END IF;
    END IF;

    -- added: franchise / MTOP number uniqueness (against the franchise of other drivers and the numbers other applications submitted)
    IF v_norm_franchise != '' THEN
        SELECT d.driver_id INTO v_dup_driver
        FROM public.driver d
        WHERE d.driver_id != NEW.driver_id
          AND regexp_replace(upper(COALESCE(d.franchise_number, '')), '[^A-Z0-9]', '', 'g') = v_norm_franchise
        LIMIT 1;
        IF v_dup_driver IS NULL THEN
            SELECT v.driver_id INTO v_dup_driver
            FROM public.driver_verification v
            WHERE v.driver_id != NEW.driver_id
              AND regexp_replace(upper(COALESCE(v.submitted_franchise_number, '')), '[^A-Z0-9]', '', 'g') = v_norm_franchise
            LIMIT 1;
        END IF;

        IF v_dup_driver IS NOT NULL THEN
            NEW.scan_status := 'Flagged';
            NEW.is_duplicate_mtop := TRUE;

            INSERT INTO public.admin_review_flag (
                flag_type, subject_type, subject_id, source_rule, assigned_role, details
            ) VALUES (
                'DUPLICATE_MTOP',
                'driver_application',
                NEW.driver_id::TEXT,
                'Rule 3.2',
                'lgu_admin',
                jsonb_build_object(
                    'type', 'franchise',
                    'number', NEW.submitted_franchise_number,
                    'conflicting_driver_id', v_dup_driver
                )
            ) ON CONFLICT (subject_type, subject_id, flag_type) WHERE status IN ('Open', 'Under Review') DO NOTHING;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 8. ANNOUNCEMENTS: the database stamps the author (a TODA administrator could never post one)
-- ----------------------------------------------------------------------------
-- announcement.created_by references toda_admin(admin_id), but the TODA portal sent the signed-in login id, which is a different value: every insert broke the
-- foreign key. The author is now written by the database from the signed-in login; whatever the browser sends is ignored. An LGU Administrator is not a TODA
-- administrator, so a notice written by the LGU has no created_by.
CREATE OR REPLACE FUNCTION public.announcement_stamp_creator()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF COALESCE(public.is_service_context(), FALSE) THEN
        RETURN NEW;
    END IF;
    NEW.created_by := CASE
        WHEN COALESCE(public.is_lgu_admin(), FALSE) THEN NULL
        ELSE (SELECT a.admin_id FROM public.toda_admin a WHERE a.auth_user_id = auth.uid() LIMIT 1)
    END;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_announcement_stamp_creator ON public.announcement;
CREATE TRIGGER trigger_announcement_stamp_creator
    BEFORE INSERT ON public.announcement
    FOR EACH ROW EXECUTE FUNCTION public.announcement_stamp_creator();

-- ----------------------------------------------------------------------------
-- 9. ANNOUNCEMENTS: who may read which
-- ----------------------------------------------------------------------------
-- Before: USING (true), so any signed-in person (a passenger, a driver of another TODA) could read every row: drafts that were never published and the
-- notices of every TODA. Now: the LGU Administrator reads all. A person reads what is PUBLISHED and either city-wide (no TODA) or written for a TODA they belong
-- to (its administrator, or a driver affiliated with it). A TODA administrator also reads the drafts they wrote themselves. Passengers belong to no TODA, so they
-- read the city-wide notices only. The audience (All / Passenger / Driver / TODA Administrator) is still chosen by each app.
CREATE OR REPLACE FUNCTION public.rls_announcement_visible(p_toda_id UUID, p_published BOOLEAN, p_created_by UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(public.is_lgu_admin(), FALSE)
        OR (p_created_by IS NOT NULL
            AND EXISTS (SELECT 1 FROM public.toda_admin a WHERE a.auth_user_id = auth.uid() AND a.admin_id = p_created_by))
        OR (COALESCE(p_published, TRUE)
            AND (p_toda_id IS NULL
                 OR EXISTS (SELECT 1 FROM public.toda_admin a WHERE a.auth_user_id = auth.uid() AND a.toda_id = p_toda_id)
                 OR EXISTS (SELECT 1 FROM public.driver_toda_affiliation f
                              JOIN public.driver d ON d.driver_id = f.driver_id
                             WHERE d.auth_user_id = auth.uid() AND f.toda_id = p_toda_id)));
$$;
REVOKE ALL ON FUNCTION public.rls_announcement_visible(UUID, BOOLEAN, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rls_announcement_visible(UUID, BOOLEAN, UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS announcement_select_policy ON public.announcement;
CREATE POLICY announcement_select_policy ON public.announcement FOR SELECT TO authenticated
    USING (public.rls_announcement_visible(toda_id, is_published, created_by));

-- ----------------------------------------------------------------------------
-- Grants: signed-in users call the three TODA functions (each refuses anybody who does not administer a TODA); anon calls none
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.toda_declare_clearance_validity(DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.toda_submit_compliance_document(TEXT, TEXT, TEXT, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.toda_resubmit_application(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toda_declare_clearance_validity(DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.toda_submit_compliance_document(TEXT, TEXT, TEXT, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.toda_resubmit_application(TEXT) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Self-check
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF has_function_privilege('anon', 'public.toda_declare_clearance_validity(date)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.toda_submit_compliance_document(text,text,text,date)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.toda_resubmit_application(text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.rls_announcement_visible(uuid,boolean,uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public._toda_of_caller()', 'EXECUTE') THEN
        RAISE EXCEPTION 'the TODA resubmission functions are open to the wrong roles';
    END IF;
END $$;
