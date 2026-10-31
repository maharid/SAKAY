-- ============================================================================
-- BATCH 3: the investigation record of an incident report, in-app feedback, and the LGU administrator's own profile
-- ============================================================================
-- What exists already and is NOT changed: every incident function and rule (incident_start_review, incident_lgu_acknowledge, incident_escalate, incident_refer_to_toda,
-- incident_decide, incident_lost_item_update), their roles, their outcomes and strikes, and the notices of Batch 2.
--
-- What this migration adds:
--   1. incident_record_investigation()   the findings of an investigation (and who was contacted) are saved on the report itself, under the administrator's name and with an audit entry,
--                                        so step 2 of the resolution is a real record that survives closing the window, another device and another administrator. It is a note: it
--                                        changes no status, no outcome, no clock and no strike.
--   2. app_feedback + submit_app_feedback()   (section 9) feedback written in the portals goes to the database, not to the person's mail program.
--   3. update_my_lgu_profile()           (section 10) the LGU administrator edits their own name, contact number, position and office; nothing else about the account.
-- Forward-only. Safe to run twice.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The investigation record of an incident report
-- ----------------------------------------------------------------------------
ALTER TABLE public.incident_report
    ADD COLUMN IF NOT EXISTS investigation_notes       TEXT,
    ADD COLUMN IF NOT EXISTS investigation_contacted   TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS investigation_recorded_by UUID,
    ADD COLUMN IF NOT EXISTS investigation_recorded_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.incident_record_investigation(p_incident_id UUID, p_notes TEXT, p_contacted TEXT[] DEFAULT '{}')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_i       public.incident_report;
    v_role    TEXT;
    v_prev    TEXT := current_setting('sakay.internal_context', true);
    v_notes   TEXT := btrim(COALESCE(p_notes, ''));
    v_contact TEXT[] := COALESCE(p_contacted, '{}');
    v_allowed TEXT[] := ARRAY['Reporter', 'Driver', 'Passenger', 'TODA Administrator', 'Witness or other'];
BEGIN
    IF length(v_notes) < 10 THEN
        RAISE EXCEPTION 'ERR_INCIDENT_NOTE: Write what you found (at least 10 characters).';
    END IF;
    IF length(v_notes) > 4000 THEN
        RAISE EXCEPTION 'ERR_INCIDENT_NOTE: The findings are too long (at most 4000 characters).';
    END IF;
    IF NOT (v_contact <@ v_allowed) THEN
        RAISE EXCEPTION 'ERR_INCIDENT_CONTACT: Choose the people you contacted from the list.';
    END IF;
    SELECT * INTO v_i FROM public.incident_report WHERE incident_id = p_incident_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_INCIDENT_NOT_FOUND: The report was not found.';
    END IF;
    v_role := public._incident_actor(v_i);
    IF v_role = 'toda_admin' AND (v_i.routing <> 'TODA' OR v_i.priority = 'Serious') THEN
        RAISE EXCEPTION 'Access Denied: This report is with the LGU Administrator (read only for the TODA Administrator).';
    END IF;
    IF v_i.status = 'Cancelled' THEN
        RAISE EXCEPTION 'ERR_INCIDENT_WITHDRAWN: The reporter withdrew this report.';
    END IF;
    IF v_i.outcome IS NOT NULL THEN
        RAISE EXCEPTION 'ERR_INCIDENT_ALREADY_DECIDED: The report was already decided (%): its record cannot be changed.', v_i.outcome;
    END IF;
    -- step 1 comes first: the administrator is responsible for the report before writing findings on it
    IF (v_role = 'lgu_admin' AND v_i.reviewed_by_lgu IS NULL) OR (v_role = 'toda_admin' AND v_i.status IN ('Pending', 'Pending Review')) THEN
        RAISE EXCEPTION 'ERR_INCIDENT_NOT_TAKEN: Accept or take the report for review first, then record your findings.';
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.incident_report
       SET investigation_notes = v_notes, investigation_contacted = v_contact,
           investigation_recorded_by = auth.uid(), investigation_recorded_at = clock_timestamp()
     WHERE incident_id = p_incident_id;
    PERFORM public.record_policy_audit('INCIDENT_INVESTIGATION_RECORDED', p_incident_id::TEXT, NULL, 'Incident Reports',
        'The ' || replace(v_role, '_', ' ') || ' recorded the findings of the investigation (' || v_i.category || ').',
        jsonb_build_object('investigation_notes', v_i.investigation_notes, 'contacted', v_i.investigation_contacted),
        jsonb_build_object('investigation_notes', v_notes, 'contacted', v_contact, 'incident_id', p_incident_id));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'incident_id', p_incident_id, 'recorded_at', clock_timestamp());
END;
$$;

REVOKE ALL ON FUNCTION public.incident_record_investigation(UUID, TEXT, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.incident_record_investigation(UUID, TEXT, TEXT[]) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. In-app feedback (the portals' "Send feedback" form)
-- ----------------------------------------------------------------------------
-- It used to open the person's own mail program and nothing was stored. Feedback written in a portal now goes to this table through submit_app_feedback(): who wrote it
-- (their name and role come from the database, never from the browser), which portal, a rating and/or a comment. Nobody inserts, changes or deletes a row directly;
-- the LGU Administrator reads them all and a person reads their own.
CREATE TABLE IF NOT EXISTS public.app_feedback (
    feedback_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id   UUID NOT NULL,
    client_token   UUID NOT NULL,
    app            TEXT NOT NULL CHECK (app IN ('lgu-portal', 'toda-portal')),
    submitter_role TEXT NOT NULL CHECK (submitter_role IN ('LGU Administrator', 'TODA Administrator')),
    submitter_name TEXT NOT NULL,
    toda_id        UUID,
    rating         SMALLINT CHECK (rating BETWEEN 1 AND 5),
    comment        TEXT CHECK (comment IS NULL OR length(comment) <= 1000),
    status         TEXT NOT NULL DEFAULT 'New' CHECK (status IN ('New', 'Read', 'Closed')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT app_feedback_has_content CHECK (rating IS NOT NULL OR (comment IS NOT NULL AND length(btrim(comment)) > 0))
);
-- the same press twice (a double click, a retry after a slow answer) is one feedback: the page sends one token per attempt
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_feedback_token ON public.app_feedback (auth_user_id, client_token);
CREATE INDEX IF NOT EXISTS idx_app_feedback_created ON public.app_feedback (created_at DESC);
ALTER TABLE public.app_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_feedback_select_lgu ON public.app_feedback;
CREATE POLICY app_feedback_select_lgu ON public.app_feedback FOR SELECT TO authenticated USING (COALESCE(public.is_lgu_admin(), FALSE));
DROP POLICY IF EXISTS app_feedback_select_own ON public.app_feedback;
CREATE POLICY app_feedback_select_own ON public.app_feedback FOR SELECT TO authenticated USING (auth_user_id = auth.uid());
REVOKE ALL ON public.app_feedback FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.app_feedback FROM authenticated;

CREATE OR REPLACE FUNCTION public.submit_app_feedback(p_app TEXT, p_rating INTEGER, p_comment TEXT, p_client_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid      UUID := auth.uid();
    v_role     TEXT;
    v_name     TEXT;
    v_toda     UUID;
    v_comment  TEXT := NULLIF(btrim(COALESCE(p_comment, '')), '');
    v_existing UUID;
    v_id       UUID;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Access Denied: Sign in to send feedback.' USING ERRCODE = '42501';
    END IF;
    IF p_app IS NULL OR p_app NOT IN ('lgu-portal', 'toda-portal') THEN
        RAISE EXCEPTION 'ERR_FEEDBACK_APP: Feedback can be sent from the LGU and TODA portals.';
    END IF;
    IF p_client_token IS NULL THEN
        RAISE EXCEPTION 'ERR_FEEDBACK_TOKEN: The feedback has no reference. Reload the page and try again.';
    END IF;
    IF p_rating IS NOT NULL AND (p_rating < 1 OR p_rating > 5) THEN
        RAISE EXCEPTION 'ERR_FEEDBACK_RATING: The rating is from 1 to 5 stars.';
    END IF;
    IF p_rating IS NULL AND v_comment IS NULL THEN
        RAISE EXCEPTION 'ERR_FEEDBACK_EMPTY: Choose a star rating or write a comment first.';
    END IF;
    IF v_comment IS NOT NULL AND length(v_comment) > 1000 THEN
        RAISE EXCEPTION 'ERR_FEEDBACK_LONG: The comment is too long (at most 1000 characters).';
    END IF;

    -- who writes it comes from the database
    IF COALESCE(public.is_lgu_admin(), FALSE) THEN
        SELECT full_name INTO v_name FROM public.lgu_admin WHERE auth_user_id = v_uid;
        v_role := 'LGU Administrator';
    ELSIF COALESCE(public.is_toda_admin(), FALSE) THEN
        SELECT full_name, toda_id INTO v_name, v_toda FROM public.toda_admin WHERE auth_user_id = v_uid;
        v_role := 'TODA Administrator';
    ELSE
        RAISE EXCEPTION 'Access Denied: Only administrators can send feedback from the portals.' USING ERRCODE = '42501';
    END IF;
    IF (v_role = 'LGU Administrator' AND p_app <> 'lgu-portal') OR (v_role = 'TODA Administrator' AND p_app <> 'toda-portal') THEN
        RAISE EXCEPTION 'ERR_FEEDBACK_APP: This portal does not match your account.';
    END IF;

    -- the same press again returns the feedback that was already saved
    SELECT feedback_id INTO v_existing FROM public.app_feedback WHERE auth_user_id = v_uid AND client_token = p_client_token;
    IF FOUND THEN
        RETURN jsonb_build_object('success', TRUE, 'feedback_id', v_existing, 'already_saved', TRUE);
    END IF;
    -- not a flood: at most five an hour
    IF (SELECT count(*) FROM public.app_feedback WHERE auth_user_id = v_uid AND created_at > clock_timestamp() - interval '1 hour') >= 5 THEN
        RAISE EXCEPTION 'ERR_FEEDBACK_RATE: You have sent several messages in the last hour. Please wait a little before sending another.';
    END IF;

    INSERT INTO public.app_feedback (auth_user_id, client_token, app, submitter_role, submitter_name, toda_id, rating, comment)
    VALUES (v_uid, p_client_token, p_app, v_role, COALESCE(v_name, v_role), v_toda, p_rating::SMALLINT, v_comment)
    RETURNING feedback_id INTO v_id;
    RETURN jsonb_build_object('success', TRUE, 'feedback_id', v_id, 'already_saved', FALSE);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_app_feedback(TEXT, INTEGER, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_app_feedback(TEXT, INTEGER, TEXT, UUID) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. The LGU administrator's own profile
-- ----------------------------------------------------------------------------
-- The table already holds the name, the e-mail, the contact number and the position; the office is new. update_my_lgu_profile() changes those four (name, position, office, contact
-- number) on the signed-in administrator's own row, validates them in the database, and writes the change to the audit log with the old and the new values. The e-mail is changed
-- through the login system (it is confirmed there); the account's status, its login and its role cannot be changed by this function or by the administrator.
ALTER TABLE public.lgu_admin ADD COLUMN IF NOT EXISTS office_name VARCHAR(150);

CREATE OR REPLACE FUNCTION public.update_my_lgu_profile(p_full_name TEXT, p_position TEXT, p_office TEXT, p_contact_number TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid    UUID := auth.uid();
    v_row    public.lgu_admin;
    v_prev   TEXT := current_setting('sakay.internal_context', true);
    v_name   TEXT := btrim(COALESCE(p_full_name, ''));
    v_pos    TEXT := NULLIF(btrim(COALESCE(p_position, '')), '');
    v_office TEXT := NULLIF(btrim(COALESCE(p_office, '')), '');
    v_phone  TEXT := NULLIF(btrim(COALESCE(p_contact_number, '')), '');
BEGIN
    IF v_uid IS NULL OR NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RAISE EXCEPTION 'Access Denied: Only the LGU Administrator can change this profile.' USING ERRCODE = '42501';
    END IF;
    IF length(v_name) < 2 OR length(v_name) > 120 OR v_name !~ '^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .,''-]*$' THEN
        RAISE EXCEPTION 'ERR_PROFILE_NAME: Enter your full name (2 to 120 letters; spaces, dots, commas, apostrophes and hyphens are allowed).';
    END IF;
    IF v_pos IS NOT NULL AND length(v_pos) > 100 THEN
        RAISE EXCEPTION 'ERR_PROFILE_POSITION: The position is too long (at most 100 characters).';
    END IF;
    IF v_office IS NOT NULL AND length(v_office) > 150 THEN
        RAISE EXCEPTION 'ERR_PROFILE_OFFICE: The office is too long (at most 150 characters).';
    END IF;
    IF v_phone IS NOT NULL AND v_phone !~ '^\+639[0-9]{9}$' THEN
        RAISE EXCEPTION 'ERR_PROFILE_PHONE: Enter a Philippine mobile number (+639XXXXXXXXX).';
    END IF;
    SELECT * INTO v_row FROM public.lgu_admin WHERE auth_user_id = v_uid FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Access Denied: No administrator profile belongs to this login.' USING ERRCODE = '42501';
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.lgu_admin SET full_name = v_name, position = v_pos, office_name = v_office, contact_number = v_phone WHERE auth_user_id = v_uid;
    PERFORM public.record_policy_audit('LGU_PROFILE_UPDATED', v_row.admin_id::TEXT, v_name, 'Account',
        'The LGU administrator changed their own profile.',
        jsonb_build_object('full_name', v_row.full_name, 'position', v_row.position, 'office_name', v_row.office_name, 'contact_number', v_row.contact_number),
        jsonb_build_object('full_name', v_name, 'position', v_pos, 'office_name', v_office, 'contact_number', v_phone));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.update_my_lgu_profile(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_lgu_profile(TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
