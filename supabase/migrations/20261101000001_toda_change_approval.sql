-- ============================================================================
-- LGU REVALIDATION OF CHANGES TO AN ACCREDITED TODA (owner's request, Batch 1 section D)
-- ============================================================================
-- The audit found one place where an LGU-accredited TODA could still change what the LGU approved without the LGU seeing it:
--
--   * the identity of the TODA (its name, acronym, barangay, date established) and the NAME of its terminal place (service_coverage_area) were written by the TODA's own
--     app with a plain table update (updateTodaProfile), and a profile save also rewrote the terminal place name on every save, next to a pin that only moves with the
--     LGU's approval;
--   * the Internal Bylaws of an Active TODA were replaced at once (toda_submit_compliance_document) with no review request and no record of what was in force before.
--
-- What is NOT changed on purpose (the owner asked to keep every rule that already exists and not to assume that every TODA action needs approval):
--   terminal moves             already a request the LGU approves or rejects in its own words (20261031000004); the current terminal stays until then
--   Barangay Clearance renewal already a review request (flag TODA_RENEWAL_SUBMITTED) that the LGU records; the accreditation in force (certificate number and expiry) does
--                              not change until the LGU records it
--   roster file / Master Roster adding or marking a member is the TODA's own operation, logged (20261031000005); an updated roster file notifies the LGU (TODA_ROSTER_UPDATED)
--   announcements to own drivers, contact details of the officers   TODA-level, audited, no approval
--   driver applications        already two stages (TODA endorses, LGU approves)
--
-- What this migration adds:
--   toda_change_request            a change to an Active TODA that waits for the LGU: kind 'profile' (identity fields) or 'bylaws' (a replacement file). It keeps what was
--                                  in force (previous), what is proposed, who asked, when, and the LGU's decision with its words. One pending request per kind per TODA.
--   request_toda_profile_change()  the TODA proposes new identity fields. While the TODA is still being reviewed (Pending Verification / Resubmission Required) the
--                                  application is the TODA's own and the change is applied at once (audited); once Active, a request is made and the record in force is untouched
--   toda_submit_compliance_document()  the 20261031000005 definition, with ONE change: the Internal Bylaws of an Active TODA become a pending request
--   decide_toda_change_request()   the LGU approves (the change is applied) or rejects (nothing changes), with a reason of at least 10 characters that the TODA reads
--   withdraw_toda_change_request() the TODA takes back its own pending request
--   protect_toda_identity_columns() on an Active TODA the identity fields, the terminal place name and the bylaws file change only through those functions or by the LGU
--   mark_toda_roster_entry_left()  the 20261031000005 definition, plus a review flag for the LGU when the member who left is an LGU-verified driver of the TODA
--                                  (the LGU decides whether he stays affiliated; the roster change itself stays the TODA's)
--
-- Forward-only. Safe to run twice.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The requests
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.toda_change_request (
    request_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    toda_id           UUID NOT NULL REFERENCES public.toda(toda_id) ON DELETE CASCADE,
    kind              TEXT NOT NULL CHECK (kind IN ('profile', 'bylaws')),
    status            TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Superseded', 'Withdrawn')),
    proposed          JSONB NOT NULL,
    previous          JSONB NOT NULL,
    file_name         TEXT,
    reason            TEXT,
    requested_by      UUID,
    requested_by_name TEXT,
    requested_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_by        UUID,
    decided_by_name   TEXT,
    decided_at        TIMESTAMPTZ,
    decision_note     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_toda_change_one_pending ON public.toda_change_request (toda_id, kind) WHERE status = 'Pending';
CREATE INDEX IF NOT EXISTS idx_toda_change_request_toda ON public.toda_change_request (toda_id, requested_at DESC);

ALTER TABLE public.toda_change_request ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS toda_change_request_select ON public.toda_change_request;
CREATE POLICY toda_change_request_select ON public.toda_change_request FOR SELECT TO authenticated
    USING (COALESCE(public.is_lgu_admin(), FALSE) OR toda_id = public.get_current_toda_admin_toda_id());
REVOKE ALL ON public.toda_change_request FROM PUBLIC, anon;
GRANT SELECT ON public.toda_change_request TO authenticated;
GRANT ALL ON public.toda_change_request TO service_role;

COMMENT ON TABLE public.toda_change_request IS 'A change to an Active TODA that waits for the LGU Administrator. previous = what is in force, proposed = what the TODA asks for. Written only by the functions of 20261101000001.';

-- ----------------------------------------------------------------------------
-- 2. The TODA proposes new identity fields
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_toda_profile_change(p_changes JSONB, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v         public.toda;
    v_uid     UUID := auth.uid();
    v_key     TEXT;
    v_prev    TEXT;
    v_name    TEXT;
    v_acr     TEXT;
    v_brgy    TEXT;
    v_date    DATE;
    v_prop    JSONB := '{}'::JSONB;
    v_old     JSONB := '{}'::JSONB;
    v_reason  TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
    v_admin   TEXT;
    v_req     UUID;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_AUTH_REQUIRED', 'error', 'Sign in first.');
    END IF;
    v := public._toda_of_caller();
    IF v.toda_id IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_TODA_ADMIN', 'error', 'Only the administrator of a TODA can change its profile.');
    END IF;
    IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_FIELD', 'error', 'There is nothing to change.');
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(p_changes) LOOP
        IF v_key NOT IN ('toda_name', 'toda_acronym', 'barangay', 'date_established') THEN
            RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_FIELD', 'error', 'The field "' || v_key || '" cannot be changed here.');
        END IF;
    END LOOP;
    IF v_reason IS NOT NULL AND length(v_reason) > 500 THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_REASON', 'error', 'Keep the reason within 500 characters.');
    END IF;

    -- what really differs from the record in force
    IF p_changes ? 'toda_name' THEN
        v_name := btrim(COALESCE(p_changes->>'toda_name', ''));
        IF length(v_name) < 3 OR length(v_name) > 120 THEN
            RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_FIELD', 'error', 'The TODA name must be 3 to 120 characters.');
        END IF;
        IF v_name IS DISTINCT FROM v.toda_name THEN v_prop := v_prop || jsonb_build_object('toda_name', v_name); v_old := v_old || jsonb_build_object('toda_name', v.toda_name); END IF;
    END IF;
    IF p_changes ? 'toda_acronym' THEN
        v_acr := upper(btrim(COALESCE(p_changes->>'toda_acronym', '')));
        IF length(v_acr) < 2 OR length(v_acr) > 20 THEN
            RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_FIELD', 'error', 'The acronym must be 2 to 20 characters.');
        END IF;
        IF v_acr IS DISTINCT FROM upper(COALESCE(v.toda_acronym, '')) THEN
            IF EXISTS (SELECT 1 FROM public.toda t WHERE upper(t.toda_acronym) = v_acr AND t.toda_id <> v.toda_id) THEN
                RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ACRONYM_TAKEN', 'error', 'Another TODA already uses the acronym ' || v_acr || '.');
            END IF;
            v_prop := v_prop || jsonb_build_object('toda_acronym', v_acr); v_old := v_old || jsonb_build_object('toda_acronym', v.toda_acronym);
        END IF;
    END IF;
    IF p_changes ? 'barangay' THEN
        v_brgy := btrim(COALESCE(p_changes->>'barangay', ''));
        IF length(v_brgy) < 2 OR length(v_brgy) > 120 THEN
            RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_FIELD', 'error', 'Choose the barangay of the TODA.');
        END IF;
        IF v_brgy IS DISTINCT FROM v.barangay THEN v_prop := v_prop || jsonb_build_object('barangay', v_brgy); v_old := v_old || jsonb_build_object('barangay', v.barangay); END IF;
    END IF;
    IF p_changes ? 'date_established' THEN
        BEGIN
            v_date := NULLIF(btrim(COALESCE(p_changes->>'date_established', '')), '')::DATE;
        EXCEPTION WHEN OTHERS THEN
            RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_FIELD', 'error', 'The date established is not a valid date.');
        END;
        IF v_date IS NULL OR v_date > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::DATE THEN
            RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_FIELD', 'error', 'The date established must be a date that has already passed.');
        END IF;
        IF v_date IS DISTINCT FROM v.date_established THEN v_prop := v_prop || jsonb_build_object('date_established', v_date); v_old := v_old || jsonb_build_object('date_established', v.date_established); END IF;
    END IF;

    IF v_prop = '{}'::JSONB THEN
        RETURN jsonb_build_object('success', TRUE, 'changed', FALSE);
    END IF;

    SELECT a.full_name INTO v_admin FROM public.toda_admin a WHERE a.auth_user_id = v_uid LIMIT 1;

    IF v.toda_status IN ('Pending Verification', 'Resubmission Required') THEN
        -- the application is still being reviewed: it is the applicant's own, and the reviewer sees the current data. The change is applied now and recorded.
        v_prev := current_setting('sakay.internal_context', true);
        PERFORM set_config('sakay.internal_context', 'true', true);
        UPDATE public.toda
           SET toda_name = COALESCE(v_prop->>'toda_name', toda_name),
               toda_acronym = COALESCE(v_prop->>'toda_acronym', toda_acronym),
               barangay = COALESCE(v_prop->>'barangay', barangay),
               date_established = COALESCE((v_prop->>'date_established')::DATE, date_established)
         WHERE toda_id = v.toda_id;
        PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
        PERFORM public.record_policy_audit('TODA_PROFILE_UPDATED', v.toda_id::TEXT, v.toda_name, 'Accreditation',
            'Updated the application details while the application is under review.', v_old, v_prop);
        RETURN jsonb_build_object('success', TRUE, 'changed', TRUE, 'applied', TRUE);
    END IF;

    IF v.toda_status <> 'Active' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_TODA_STATUS', 'error', 'This TODA cannot change its profile while it is ' || lower(v.toda_status) || '. Contact the City Transport Office.');
    END IF;

    -- an accredited TODA: the record in force is untouched until the LGU decides
    UPDATE public.toda_change_request
       SET status = 'Superseded', decided_at = CURRENT_TIMESTAMP, decision_note = 'Replaced by a newer request.'
     WHERE toda_id = v.toda_id AND kind = 'profile' AND status = 'Pending';
    INSERT INTO public.toda_change_request (toda_id, kind, proposed, previous, reason, requested_by, requested_by_name)
    VALUES (v.toda_id, 'profile', v_prop, v_old, v_reason, v_uid, v_admin)
    RETURNING request_id INTO v_req;

    INSERT INTO public.admin_review_flag (flag_type, subject_type, subject_id, source_rule, assigned_role, details)
    VALUES ('TODA_PROFILE_CHANGE_REQUESTED', 'toda', v.toda_id::TEXT, 'Rule 2.4', 'lgu_admin',
            jsonb_build_object('toda_name', v.toda_name, 'request_id', v_req, 'requested_at', CURRENT_TIMESTAMP, 'fields', (SELECT jsonb_agg(k) FROM jsonb_object_keys(v_prop) AS k),
                               'note', 'An accredited TODA asked to change its details. They stay as they are until you approve.'))
    ON CONFLICT (subject_type, subject_id, flag_type) WHERE status IN ('Open', 'Under Review')
    DO UPDATE SET details = EXCLUDED.details;

    PERFORM public.record_policy_audit('TODA_PROFILE_CHANGE_REQUESTED', v.toda_id::TEXT, v.toda_name, 'Accreditation',
        'Asked to change the details of the TODA' || CASE WHEN v_reason IS NOT NULL THEN '. Reason: ' || v_reason ELSE '' END || '. They stay as they are until the LGU Administrator approves.', v_old, v_prop);
    RETURN jsonb_build_object('success', TRUE, 'changed', TRUE, 'pending', TRUE, 'request_id', v_req);
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. The Internal Bylaws of an Active TODA wait for the LGU
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
    v_pending BOOLEAN := FALSE;   -- the Internal Bylaws of an Active TODA: a request, not a replacement
    v_admin   TEXT;
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
        IF v.toda_status = 'Active' THEN
            -- D-P9: the roster file submitted at registration is what the LGU accredited: it stays as it is. A later file is a new dated VERSION that the TODA reconciles
            -- with its Master Roster (the browser shows what is new and what is missing; nothing is added or removed until the TODA says so)
            INSERT INTO public.toda_roster_file_version (toda_id, kind, file_path, file_name, uploaded_by)
            VALUES (v.toda_id, 'update', p_path, p_file_name, v_uid);
            SELECT * INTO v_new FROM public.toda WHERE toda_id = v.toda_id;
            INSERT INTO public.admin_review_flag (flag_type, subject_type, subject_id, source_rule, assigned_role, details)
            VALUES ('TODA_ROSTER_UPDATED', 'toda', v.toda_id::TEXT, 'Rule 2.4', 'lgu_admin',
                    jsonb_build_object('toda_name', v.toda_name, 'file_name', p_file_name, 'submitted_at', CURRENT_TIMESTAMP,
                                       'note', 'An accredited TODA submitted a new version of its roster file. For information: the Master Roster only changes when the TODA confirms each member.'))
            ON CONFLICT (subject_type, subject_id, flag_type) WHERE status IN ('Open', 'Under Review')
            DO UPDATE SET details = EXCLUDED.details;
        ELSE
            -- while the application is pending or returned the registration file is still being put together: it is replaced, and the version history says so
            UPDATE public.toda_roster_file_version SET superseded_at = CURRENT_TIMESTAMP WHERE toda_id = v.toda_id AND kind = 'registration' AND superseded_at IS NULL;
            INSERT INTO public.toda_roster_file_version (toda_id, kind, file_path, file_name, uploaded_by)
            VALUES (v.toda_id, 'registration', p_path, p_file_name, v_uid);
            UPDATE public.toda SET accredited_drivers_url = p_path WHERE toda_id = v.toda_id RETURNING * INTO v_new;
        END IF;
    ELSIF v.toda_status = 'Active' THEN
        -- the bylaws the LGU accredited the TODA with stay in force until the LGU approves the new file (20261101000001)
        SELECT a.full_name INTO v_admin FROM public.toda_admin a WHERE a.auth_user_id = v_uid LIMIT 1;
        UPDATE public.toda_change_request
           SET status = 'Superseded', decided_at = CURRENT_TIMESTAMP, decision_note = 'Replaced by a newer file.'
         WHERE toda_id = v.toda_id AND kind = 'bylaws' AND status = 'Pending';
        INSERT INTO public.toda_change_request (toda_id, kind, proposed, previous, file_name, requested_by, requested_by_name)
        VALUES (v.toda_id, 'bylaws', jsonb_build_object('bylaws_url', p_path), jsonb_build_object('bylaws_url', v.bylaws_url), p_file_name, v_uid, v_admin);
        INSERT INTO public.admin_review_flag (flag_type, subject_type, subject_id, source_rule, assigned_role, details)
        VALUES ('TODA_BYLAWS_CHANGE_REQUESTED', 'toda', v.toda_id::TEXT, 'Rule 2.4', 'lgu_admin',
                jsonb_build_object('toda_name', v.toda_name, 'file_name', p_file_name, 'submitted_at', CURRENT_TIMESTAMP,
                                   'note', 'An accredited TODA sent new Internal Bylaws. The bylaws in force stay as they are until you approve.'))
        ON CONFLICT (subject_type, subject_id, flag_type) WHERE status IN ('Open', 'Under Review')
        DO UPDATE SET details = EXCLUDED.details;
        v_pending := TRUE;
        SELECT * INTO v_new FROM public.toda WHERE toda_id = v.toda_id;
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
             WHEN v_pending THEN 'Proposed new Internal Bylaws ("' || COALESCE(p_file_name, 'file') || '"). The bylaws in force stay as they are until the LGU Administrator approves.'
             ELSE 'Submitted ' || p_category || ' ("' || COALESCE(p_file_name, 'file') || '") for the LGU Administrator''s review.' END,
        jsonb_build_object('toda_status', v.toda_status, 'barangay_clearance_url', v.barangay_clearance_url),
        jsonb_build_object('toda_status', v_new.toda_status, 'category', p_category, 'declared_clearance_valid_until', v_new.declared_clearance_valid_until));

    RETURN jsonb_build_object('success', TRUE, 'renewal', v_renewal, 'pending', v_pending, 'toda_status', v_new.toda_status);
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. The LGU decides; the TODA can take its own request back
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decide_toda_change_request(p_request_id UUID, p_approve BOOLEAN, p_note TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_req     public.toda_change_request;
    v_toda    public.toda;
    v_note    TEXT := btrim(COALESCE(p_note, ''));
    v_prev    TEXT;
    v_admin   TEXT;
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_LGU', 'error', 'Access Denied: Only LGU Administrators can decide a change to an accredited TODA.');
    END IF;
    SELECT * INTO v_req FROM public.toda_change_request WHERE request_id = p_request_id FOR UPDATE;
    IF v_req.request_id IS NULL OR v_req.status <> 'Pending' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_PENDING', 'error', 'No pending change was found: it may already have been decided or taken back.');
    END IF;
    IF length(v_note) < 10 OR length(v_note) > 500 THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_DECISION_NOTE', 'error', 'Write the reason for your decision (10 to 500 characters). The TODA reads it.');
    END IF;
    SELECT * INTO v_toda FROM public.toda WHERE toda_id = v_req.toda_id FOR UPDATE;
    SELECT a.full_name INTO v_admin FROM public.lgu_admin a WHERE a.auth_user_id = auth.uid() LIMIT 1;

    IF p_approve THEN
        v_prev := current_setting('sakay.internal_context', true);
        PERFORM set_config('sakay.internal_context', 'true', true);
        BEGIN
            IF v_req.kind = 'profile' THEN
                UPDATE public.toda
                   SET toda_name = COALESCE(v_req.proposed->>'toda_name', toda_name),
                       toda_acronym = COALESCE(v_req.proposed->>'toda_acronym', toda_acronym),
                       barangay = COALESCE(v_req.proposed->>'barangay', barangay),
                       date_established = COALESCE((v_req.proposed->>'date_established')::DATE, date_established)
                 WHERE toda_id = v_req.toda_id;
            ELSE
                UPDATE public.toda SET bylaws_url = v_req.proposed->>'bylaws_url' WHERE toda_id = v_req.toda_id;
            END IF;
        EXCEPTION WHEN unique_violation THEN
            PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
            RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ACRONYM_TAKEN', 'error', 'The proposed name or acronym is already used by another TODA, so the change cannot be applied. Reject it and say why.');
        END;
        PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    END IF;

    UPDATE public.toda_change_request
       SET status = CASE WHEN p_approve THEN 'Approved' ELSE 'Rejected' END, decided_by = auth.uid(), decided_by_name = v_admin, decided_at = CURRENT_TIMESTAMP, decision_note = v_note
     WHERE request_id = v_req.request_id;

    -- the review flag for this kind of change is settled when no other request of the kind is open
    UPDATE public.admin_review_flag
       SET status = 'Resolved', resolution = v_note, resolved_by = auth.uid(), resolved_at = CURRENT_TIMESTAMP
     WHERE subject_type = 'toda' AND subject_id = v_req.toda_id::TEXT
       AND flag_type = CASE WHEN v_req.kind = 'profile' THEN 'TODA_PROFILE_CHANGE_REQUESTED' ELSE 'TODA_BYLAWS_CHANGE_REQUESTED' END
       AND status IN ('Open', 'Under Review');

    PERFORM public.record_policy_audit(
        CASE WHEN p_approve THEN 'TODA_CHANGE_APPROVED' ELSE 'TODA_CHANGE_REJECTED' END,
        v_req.toda_id::TEXT, v_toda.toda_name, 'Accreditation',
        CASE WHEN p_approve THEN 'Approved' ELSE 'Rejected' END || ' the TODA''s change to its ' || CASE WHEN v_req.kind = 'profile' THEN 'details' ELSE 'Internal Bylaws' END || '. Reason: ' || v_note,
        v_req.previous, v_req.proposed);
    RETURN jsonb_build_object('success', TRUE, 'approved', p_approve);
END;
$$;

CREATE OR REPLACE FUNCTION public.withdraw_toda_change_request(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v     public.toda;
    v_req public.toda_change_request;
BEGIN
    v := public._toda_of_caller();
    IF v.toda_id IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_TODA_ADMIN', 'error', 'Only the administrator of a TODA can take a request back.');
    END IF;
    SELECT * INTO v_req FROM public.toda_change_request WHERE request_id = p_request_id AND toda_id = v.toda_id FOR UPDATE;
    IF v_req.request_id IS NULL OR v_req.status <> 'Pending' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_PENDING', 'error', 'That request is not waiting any more.');
    END IF;
    UPDATE public.toda_change_request SET status = 'Withdrawn', decided_at = CURRENT_TIMESTAMP, decision_note = 'Taken back by the TODA.' WHERE request_id = v_req.request_id;
    UPDATE public.admin_review_flag
       SET status = 'Dismissed', resolution = 'The TODA took its request back.', resolved_at = CURRENT_TIMESTAMP
     WHERE subject_type = 'toda' AND subject_id = v.toda_id::TEXT
       AND flag_type = CASE WHEN v_req.kind = 'profile' THEN 'TODA_PROFILE_CHANGE_REQUESTED' ELSE 'TODA_BYLAWS_CHANGE_REQUESTED' END
       AND status IN ('Open', 'Under Review');
    PERFORM public.record_policy_audit('TODA_CHANGE_WITHDRAWN', v.toda_id::TEXT, v.toda_name, 'Accreditation',
        'Took back its own request to change its ' || CASE WHEN v_req.kind = 'profile' THEN 'details' ELSE 'Internal Bylaws' END || '.', v_req.previous, v_req.proposed);
    RETURN jsonb_build_object('success', TRUE);
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. On an Active TODA the identity fields change only through those functions (or by the LGU)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_toda_identity_columns()
RETURNS TRIGGER AS $$
BEGIN
    IF COALESCE(public.is_lgu_admin(), FALSE) OR COALESCE(public.is_service_context(), FALSE) OR auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;
    IF OLD.toda_status = 'Active'
       AND (NEW.toda_name IS DISTINCT FROM OLD.toda_name
            OR NEW.toda_acronym IS DISTINCT FROM OLD.toda_acronym
            OR NEW.barangay IS DISTINCT FROM OLD.barangay
            OR NEW.date_established IS DISTINCT FROM OLD.date_established
            OR NEW.registration_number IS DISTINCT FROM OLD.registration_number
            OR NEW.service_coverage_area IS DISTINCT FROM OLD.service_coverage_area
            OR NEW.bylaws_url IS DISTINCT FROM OLD.bylaws_url) THEN
        RAISE EXCEPTION 'Access Denied: the name, acronym, barangay, terminal place and bylaws of an accredited TODA change only when the LGU Administrator approves a request (request_toda_profile_change, the Internal Bylaws upload, the terminal move).';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_protect_toda_identity_columns ON public.toda;
CREATE TRIGGER trigger_protect_toda_identity_columns
    BEFORE UPDATE ON public.toda
    FOR EACH ROW EXECUTE FUNCTION public.protect_toda_identity_columns();

-- ----------------------------------------------------------------------------
-- 6. A member who is an LGU-verified driver of the TODA leaves the roster: the LGU is asked to look (the roster change itself stays the TODA's)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_toda_roster_entry_left(p_entry_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_toda      UUID := public.get_current_toda_admin_toda_id();
    v_old       public.toda_roster_entry;
    v_reason    TEXT := public._roster_text(p_reason, 500);
    v_toda_name TEXT;
    v_driver    RECORD;
BEGIN
    IF v_toda IS NULL OR NOT public.is_toda_admin() THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_TODA_ADMIN', 'error', 'Only a TODA administrator can change the roster.');
    END IF;
    SELECT * INTO v_old FROM public.toda_roster_entry WHERE entry_id = p_entry_id AND toda_id = v_toda FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_NOT_FOUND', 'error', 'That roster entry was not found.');
    END IF;
    IF v_old.status = 'Left' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_LEFT', 'error', 'This member is already marked as left.');
    END IF;
    IF v_reason IS NULL OR length(v_reason) < 10 THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_REASON', 'error', 'Say why the member is no longer on the roster (10 to 500 characters): he left, transferred, was expelled.');
    END IF;

    UPDATE public.toda_roster_entry SET status = 'Left', left_at = CURRENT_TIMESTAMP, left_reason = v_reason, left_by = auth.uid() WHERE entry_id = p_entry_id;

    SELECT t.toda_name INTO v_toda_name FROM public.toda t WHERE t.toda_id = v_toda;
    PERFORM public.record_policy_audit('TODA_ROSTER_ENTRY_LEFT', v_toda::TEXT, v_toda_name, 'Membership',
        'Marked ' || v_old.member_name || ' (franchise ' || COALESCE(v_old.franchise_number, '-') || ') as no longer on the roster. Reason: ' || v_reason,
        jsonb_build_object('status', 'Active'), jsonb_build_object('status', 'Left'));

    -- an LGU-verified driver of this TODA with that franchise number: the LGU decides whether he stays affiliated (a request to look, not a block)
    FOR v_driver IN
        SELECT a.affiliation_id, a.driver_id, d.full_name
          FROM public.driver_toda_affiliation a
          JOIN public.driver d ON d.driver_id = a.driver_id
         WHERE a.toda_id = v_toda
           AND a.lgu_verification_status = 'Approved'
           AND public._roster_normalize(d.franchise_number) = v_old.normalized_franchise
           AND v_old.normalized_franchise <> ''
    LOOP
        INSERT INTO public.admin_review_flag (flag_type, subject_type, subject_id, source_rule, assigned_role, details)
        VALUES ('TODA_ROSTER_MEMBER_LEFT', 'driver', v_driver.driver_id::TEXT, 'Rule 2.4', 'lgu_admin',
                jsonb_build_object('toda_name', v_toda_name, 'driver_name', v_driver.full_name, 'affiliation_id', v_driver.affiliation_id, 'left_at', CURRENT_TIMESTAMP, 'reason', v_reason,
                                   'note', 'A verified driver was marked as no longer a member of the TODA roster. He stays verified and affiliated until you decide otherwise.'))
        ON CONFLICT (subject_type, subject_id, flag_type) WHERE status IN ('Open', 'Under Review')
        DO UPDATE SET details = EXCLUDED.details;
    END LOOP;
    RETURN jsonb_build_object('success', TRUE);
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Privileges
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.protect_toda_identity_columns() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_toda_profile_change(JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_toda_profile_change(JSONB, TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.decide_toda_change_request(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_toda_change_request(UUID, BOOLEAN, TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.withdraw_toda_change_request(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_toda_change_request(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.toda_submit_compliance_document(TEXT, TEXT, TEXT, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toda_submit_compliance_document(TEXT, TEXT, TEXT, DATE) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_toda_roster_entry_left(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_toda_roster_entry_left(UUID, TEXT) TO authenticated, service_role;
