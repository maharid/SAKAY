-- ============================================================================
-- BATCH 2: incident follow-up and overdue state, role-addressed notices, accreditation reminders, emergency declaration changes
-- ============================================================================
-- What exists already and is NOT changed (the owner asked to keep every rule and record):
--   * the response times of an incident report (migration 20261026000001, figure F11.1): a first action within 2 business days (4 hours for a safety report), a decision within 3 business days
--     after an escalation. They are in incident_constant() and in policyConfig.ts. No deadline is invented here.
--   * the notice table: public.notification, addressed by recipient_id ('lgu_admin', 'toda_<toda id>', or a driver / passenger id), de-duplicated by the unique index on
--     (recipient_id, notification_type, subject_id, threshold_days).
--
-- What this migration adds:
--   1. _portal_notify()               one way to write a notice to the LGU ('lgu_admin') or to a TODA ('toda_<id>'): written once per event (the unique index), and a failure to write it
--                                     never undoes the action it reports: it is recorded in the audit log (NOTIFICATION_DELIVERY_FAILED).
--   2. incident notices (trigger)     a report filed with the TODA / with the LGU, escalated to the LGU, referred back, taken by the LGU, decided by the LGU, withdrawn: the party that has to
--                                     act or has been answered is told. Passengers and drivers keep their own notices (unchanged).
--   3. overdue state                  incident_report.overdue_kind / overdue_since are set by the hourly sweep when a report passes its first-action or decision time; the LGU and the
--                                     TODA are told once per event. The times themselves are the existing ones.
--   3b. incident_lgu_acknowledge()   the LGU takes a report in hand without deciding it (who is responsible; the TODA is told). A report the TODA escalated is already 'Under Investigation', so
--                                     incident_start_review has no effect on it: this is the explicit step.
--   4. incident_followup              a TODA administrator sends the LGU a follow-up on a report that is with the LGU and not decided: who, when, which report, what was said; one per
--                                     cooldown (system_policy_config key incident_followup_cooldown_hours, default 24: a POLICY GAP, no approved figure existed, change it there).
--   5. accreditation reminders        a notice to the TODA 7 days before its accreditation (certificate) expires and another when it has expired, once per accreditation period
--                                     (the subject carries the expiry date, so a renewal starts a new period). System key toda_accreditation_reminder_days, default [7].
--   6. decisions of the LGU on a driver  the TODA is told when the LGU verifies, returns or rejects one of its applicants.
--   7. appeals reaching the LGU       the LGU is told when a strike appeal waits for it.
--   8. read state                     portal_notification_read: who has read which notice (per signed-in administrator), so it is kept across devices.
--   9. emergency declaration          optional expected end, last change; update_calamity() (LGU only, audited); get_active_calamity() returns them.
-- Forward-only. Safe to run twice.
-- ============================================================================

INSERT INTO public.system_policy_config (config_key, config_value, description) VALUES
    ('incident_followup_cooldown_hours', '24'::jsonb, 'Hours a TODA administrator must wait between two follow-ups on the same incident report that is with the LGU. No approved figure existed: this is a reasonable default, change it here.'),
    ('toda_accreditation_reminder_days', '[7]'::jsonb, 'Days before the accreditation certificate expires on which the TODA is notified (once per accreditation period); it is notified again when the certificate has expired.')
ON CONFLICT (config_key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 1. One way to write a notice to the LGU or to a TODA
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._portal_notify(p_recipient TEXT, p_type TEXT, p_title TEXT, p_message TEXT, p_subject TEXT, p_threshold INTEGER DEFAULT 1)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_recipient IS NULL OR p_recipient NOT IN ('lgu_admin') AND p_recipient !~ '^toda_[0-9a-f-]{36}$' THEN
        RETURN FALSE;
    END IF;
    INSERT INTO public.notification (recipient_id, subject_id, title, message, notification_type, threshold_days, is_read, sent_at)
    VALUES (p_recipient, p_subject, left(p_title, 255), p_message, p_type, COALESCE(p_threshold, 1), FALSE, CURRENT_TIMESTAMP)
    ON CONFLICT (recipient_id, notification_type, subject_id, threshold_days) DO NOTHING;
    RETURN FOUND;
EXCEPTION WHEN OTHERS THEN
    -- a notice that cannot be written never undoes the action it reports; the failure is on record
    BEGIN
        PERFORM public.record_policy_audit('NOTIFICATION_DELIVERY_FAILED', COALESCE(p_subject, ''), NULL, 'Notifications',
            'A ' || COALESCE(p_type, 'notice') || ' for ' || COALESCE(p_recipient, 'nobody') || ' could not be written: ' || SQLERRM, NULL,
            jsonb_build_object('recipient', p_recipient, 'type', p_type, 'subject', p_subject));
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;
    RETURN FALSE;
END;
$$;

-- the next sequence number of an event that may legitimately happen again for the same subject (a report referred back twice): a notice per real transition, never one per sweep
CREATE OR REPLACE FUNCTION public._portal_notice_seq(p_recipient TEXT, p_type TEXT, p_subject TEXT)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(max(n.threshold_days), 0) + 1 FROM public.notification n
     WHERE n.recipient_id = p_recipient AND n.notification_type = p_type AND n.subject_id = p_subject;
$$;

-- ----------------------------------------------------------------------------
-- 2. Read state per administrator
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.portal_notification_read (
    notification_id UUID NOT NULL REFERENCES public.notification(notification_id) ON DELETE CASCADE,
    reader_auth_id  UUID NOT NULL,
    read_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (notification_id, reader_auth_id)
);
ALTER TABLE public.portal_notification_read ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portal_notification_read_select ON public.portal_notification_read;
CREATE POLICY portal_notification_read_select ON public.portal_notification_read FOR SELECT TO authenticated USING (reader_auth_id = auth.uid());
REVOKE ALL ON public.portal_notification_read FROM PUBLIC, anon;
GRANT SELECT ON public.portal_notification_read TO authenticated;
GRANT ALL ON public.portal_notification_read TO service_role;

-- an LGU administrator marks notices of the LGU as read; a TODA administrator, notices of their own TODA; nobody can mark another audience's notice
CREATE OR REPLACE FUNCTION public.mark_portal_notifications_read(p_ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_toda UUID := public.get_current_toda_admin_toda_id();
    v_n INTEGER := 0;
BEGIN
    IF v_uid IS NULL OR p_ids IS NULL OR cardinality(p_ids) = 0 THEN
        RETURN 0;
    END IF;
    INSERT INTO public.portal_notification_read (notification_id, reader_auth_id)
    SELECT n.notification_id, v_uid FROM public.notification n
     WHERE n.notification_id = ANY (p_ids)
       AND ((COALESCE(public.is_lgu_admin(), FALSE) AND n.recipient_id = 'lgu_admin')
            OR (v_toda IS NOT NULL AND n.recipient_id = 'toda_' || v_toda::TEXT))
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Overdue state of an incident report
-- ----------------------------------------------------------------------------
ALTER TABLE public.incident_report
    ADD COLUMN IF NOT EXISTS overdue_kind  VARCHAR(12),
    ADD COLUMN IF NOT EXISTS overdue_since TIMESTAMPTZ;
ALTER TABLE public.incident_report DROP CONSTRAINT IF EXISTS incident_report_overdue_kind_check;
ALTER TABLE public.incident_report ADD CONSTRAINT incident_report_overdue_kind_check CHECK (overdue_kind IS NULL OR overdue_kind IN ('first_action', 'decision'));

-- ----------------------------------------------------------------------------
-- 4. Notices when a report changes hands, is answered or is withdrawn
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._incident_portal_notices()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_toda    TEXT := CASE WHEN NEW.reported_toda_id IS NOT NULL THEN 'toda_' || NEW.reported_toda_id::TEXT END;
    v_id      TEXT := NEW.incident_id::TEXT;
    v_code    TEXT := upper(left(NEW.incident_id::TEXT, 8));
    v_what    TEXT := NEW.category || CASE WHEN NEW.priority = 'Serious' THEN ' (serious)' WHEN NEW.priority = 'Emergency' THEN ' (emergency)' ELSE '' END;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.routing = 'LGU' THEN
            PERFORM public._portal_notify('lgu_admin', 'INCIDENT_NEW_LGU', 'New incident report #' || v_code || ': ' || v_what,
                'A report was filed that goes straight to the LGU Administrator. Open it to review the details and the evidence.', v_id, 1);
        ELSIF v_toda IS NOT NULL THEN
            PERFORM public._portal_notify(v_toda, 'INCIDENT_NEW_TODA', 'New incident report #' || v_code || ': ' || v_what,
                'A report about one of your drivers is waiting for your first review.', v_id, 1);
        END IF;
        RETURN NEW;
    END IF;

    -- escalated to the LGU (by the TODA, or reclassified as serious)
    IF OLD.routing = 'TODA' AND NEW.routing = 'LGU' THEN
        PERFORM public._portal_notify('lgu_admin', 'INCIDENT_ESCALATED', 'Incident #' || v_code || ' escalated to the LGU: ' || v_what,
            COALESCE('Reason: ' || NEW.escalation_reason, 'A TODA escalated this report to you.') || ' A decision is due ' ||
            COALESCE(to_char(NEW.decision_due_at AT TIME ZONE 'Asia/Manila', 'Mon DD, YYYY'), 'within the policy time') || '.',
            v_id, public._portal_notice_seq('lgu_admin', 'INCIDENT_ESCALATED', v_id));
    END IF;
    -- handed back to the TODA by the LGU
    IF OLD.routing = 'LGU' AND NEW.routing = 'TODA' AND v_toda IS NOT NULL THEN
        PERFORM public._portal_notify(v_toda, 'INCIDENT_REFERRED_TO_TODA', 'The LGU sent incident #' || v_code || ' back to you',
            'The LGU Administrator referred this report back for your review. You have a fresh time to act.', v_id, public._portal_notice_seq(v_toda, 'INCIDENT_REFERRED_TO_TODA', v_id));
    END IF;
    -- the LGU Administrator took the report in hand
    IF v_toda IS NOT NULL AND NEW.routing = 'LGU' AND NEW.reviewed_by_lgu IS NOT NULL AND NEW.reviewed_by_lgu IS DISTINCT FROM OLD.reviewed_by_lgu THEN
        PERFORM public._portal_notify(v_toda, 'INCIDENT_LGU_REVIEWING', 'The LGU is reviewing incident #' || v_code,
            'The LGU Administrator started the review of this ' || NEW.category || ' report. You will be told when it is decided.', v_id, 1);
    END IF;
    -- decided
    IF OLD.outcome IS NULL AND NEW.outcome IS NOT NULL AND v_toda IS NOT NULL AND NEW.decided_by_role = 'lgu_admin' THEN
        PERFORM public._portal_notify(v_toda, 'INCIDENT_LGU_DECIDED', 'The LGU decided incident #' || v_code,
            'Outcome: ' || replace(initcap(lower(replace(NEW.outcome, '_', ' '))), 'Not Upheld', 'Not upheld') || '. Open the report to read the LGU''s findings.', v_id, 1);
    END IF;
    -- withdrawn by the reporter: whoever held it is told
    IF OLD.status IS DISTINCT FROM 'Cancelled' AND NEW.status = 'Cancelled' THEN
        IF NEW.routing = 'LGU' THEN
            PERFORM public._portal_notify('lgu_admin', 'INCIDENT_WITHDRAWN', 'Incident #' || v_code || ' was withdrawn by the reporter', 'No decision is needed any more.', v_id, 1);
        ELSIF v_toda IS NOT NULL THEN
            PERFORM public._portal_notify(v_toda, 'INCIDENT_WITHDRAWN', 'Incident #' || v_code || ' was withdrawn by the reporter', 'No decision is needed any more.', v_id, 1);
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_incident_portal_notices ON public.incident_report;
CREATE TRIGGER trigger_incident_portal_notices
    AFTER INSERT OR UPDATE ON public.incident_report
    FOR EACH ROW EXECUTE FUNCTION public._incident_portal_notices();

-- ----------------------------------------------------------------------------
-- 5. The follow-up a TODA sends the LGU
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.incident_followup (
    followup_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id       UUID NOT NULL REFERENCES public.incident_report(incident_id) ON DELETE CASCADE,
    toda_id           UUID NOT NULL REFERENCES public.toda(toda_id) ON DELETE CASCADE,
    kind              TEXT NOT NULL CHECK (kind IN ('reminder', 'escalation')),
    sequence_no       INTEGER NOT NULL,
    message           TEXT,
    sent_by           UUID,
    sent_by_name      TEXT,
    sent_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    next_allowed_at   TIMESTAMPTZ NOT NULL,
    UNIQUE (incident_id, sequence_no)
);
CREATE INDEX IF NOT EXISTS idx_incident_followup_incident ON public.incident_followup (incident_id, sent_at DESC);
ALTER TABLE public.incident_followup ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS incident_followup_select ON public.incident_followup;
CREATE POLICY incident_followup_select ON public.incident_followup FOR SELECT TO authenticated
    USING (COALESCE(public.is_lgu_admin(), FALSE) OR toda_id = public.get_current_toda_admin_toda_id());
REVOKE ALL ON public.incident_followup FROM PUBLIC, anon;
GRANT SELECT ON public.incident_followup TO authenticated;
GRANT ALL ON public.incident_followup TO service_role;

CREATE OR REPLACE FUNCTION public.incident_send_followup(p_incident_id UUID, p_message TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_toda   UUID := public.get_current_toda_admin_toda_id();
    v_i      public.incident_report;
    v_msg    TEXT := NULLIF(btrim(COALESCE(p_message, '')), '');
    v_last   RECORD;
    v_cool   INTEGER := public.get_policy_config_int('incident_followup_cooldown_hours', 24);
    v_seq    INTEGER;
    v_next   TIMESTAMPTZ;
    v_kind   TEXT;
    v_name   TEXT;
    v_code   TEXT;
    v_prev   TEXT := current_setting('sakay.internal_context', true);
BEGIN
    IF v_toda IS NULL OR NOT COALESCE(public.is_toda_admin(), FALSE) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_TODA_ADMIN', 'error', 'Only a TODA administrator can send a follow-up to the LGU.');
    END IF;
    IF v_msg IS NOT NULL AND length(v_msg) > 500 THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_FOLLOWUP_MESSAGE', 'error', 'Keep the message within 500 characters.');
    END IF;
    SELECT * INTO v_i FROM public.incident_report WHERE incident_id = p_incident_id FOR UPDATE;
    IF v_i.incident_id IS NULL OR v_i.reported_toda_id IS DISTINCT FROM v_toda THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_YOUR_INCIDENT', 'error', 'That report was not found among your TODA''s reports.');
    END IF;
    IF v_i.outcome IS NOT NULL OR v_i.status = 'Cancelled' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_INCIDENT_CLOSED', 'error', 'This report is already closed.');
    END IF;
    IF v_i.routing <> 'LGU' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_WITH_LGU', 'error', 'This report is with you, not with the LGU: review it, or escalate it to the LGU.');
    END IF;

    SELECT max(f.sent_at) AS last_at, max(f.sequence_no) AS last_seq, max(f.next_allowed_at) AS allowed INTO v_last FROM public.incident_followup f WHERE f.incident_id = p_incident_id;
    IF v_last.allowed IS NOT NULL AND v_last.allowed > clock_timestamp() THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_FOLLOWUP_TOO_SOON', 'next_allowed_at', v_last.allowed,
            'error', 'A follow-up on this report was already sent. You can send another after ' || to_char(v_last.allowed AT TIME ZONE 'Asia/Manila', 'Mon DD, HH12:MI AM') || '.');
    END IF;

    v_seq := COALESCE(v_last.last_seq, 0) + 1;
    v_next := clock_timestamp() + make_interval(hours => GREATEST(v_cool, 1));
    v_kind := CASE WHEN v_i.overdue_kind IS NOT NULL OR (v_i.decision_due_at IS NOT NULL AND v_i.decision_due_at < clock_timestamp()) THEN 'escalation' ELSE 'reminder' END;
    SELECT a.full_name INTO v_name FROM public.toda_admin a WHERE a.auth_user_id = auth.uid() LIMIT 1;
    v_code := upper(left(p_incident_id::TEXT, 8));

    PERFORM set_config('sakay.internal_context', 'true', true);
    INSERT INTO public.incident_followup (incident_id, toda_id, kind, sequence_no, message, sent_by, sent_by_name, next_allowed_at)
    VALUES (p_incident_id, v_toda, v_kind, v_seq, v_msg, auth.uid(), v_name, v_next);
    PERFORM public._portal_notify('lgu_admin', 'INCIDENT_FOLLOWUP',
        CASE WHEN v_kind = 'escalation' THEN 'Overdue: a TODA is asking for action on incident #' || v_code ELSE 'A TODA is following up on incident #' || v_code END,
        COALESCE((SELECT t.toda_name FROM public.toda t WHERE t.toda_id = v_toda), 'A TODA') || ' asked for the LGU''s decision on this ' || v_i.category || ' report'
            || COALESCE(': ' || v_msg, '.'), p_incident_id::TEXT, v_seq);
    PERFORM public.record_policy_audit('INCIDENT_FOLLOWUP_SENT', p_incident_id::TEXT, NULL, 'Incident Reports',
        'The TODA administrator ' || COALESCE(v_name, '') || ' sent the LGU a ' || v_kind || ' (no. ' || v_seq || ') on the report (' || v_i.category || ')' || COALESCE(': ' || v_msg, '.'),
        NULL, jsonb_build_object('incident_id', p_incident_id, 'sequence_no', v_seq, 'kind', v_kind));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'kind', v_kind, 'sequence_no', v_seq, 'next_allowed_at', v_next);
END;
$$;

-- the LGU Administrator takes a report that is with the LGU in hand ("Take this report"): it records who is responsible and stops the first-action clock, without deciding anything.
-- A report the TODA escalated is already "Under Investigation" (escalation moves it), so incident_start_review has nothing left to do for it; this is the explicit acknowledgement.
CREATE OR REPLACE FUNCTION public.incident_lgu_acknowledge(p_incident_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_i     public.incident_report;
    v_admin UUID := public._incident_admin_id('lgu_admin');
    v_prev  TEXT := current_setting('sakay.internal_context', true);
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) OR v_admin IS NULL THEN
        RAISE EXCEPTION 'Access Denied: Only an LGU Administrator can take a report.';
    END IF;
    SELECT * INTO v_i FROM public.incident_report WHERE incident_id = p_incident_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_INCIDENT_NOT_FOUND: The report was not found.';
    END IF;
    IF v_i.outcome IS NOT NULL OR v_i.status = 'Cancelled' THEN
        RETURN jsonb_build_object('success', TRUE, 'unchanged', TRUE, 'status', v_i.status);
    END IF;
    IF v_i.reviewed_by_lgu IS NOT NULL THEN
        RETURN jsonb_build_object('success', TRUE, 'unchanged', TRUE, 'status', v_i.status);
    END IF;
    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.incident_report
       SET reviewed_by_lgu = v_admin, first_action_at = COALESCE(first_action_at, clock_timestamp()),
           status = CASE WHEN status IN ('Pending', 'Pending Review') THEN 'Under Investigation' ELSE status END
     WHERE incident_id = p_incident_id;
    PERFORM public.record_policy_audit('INCIDENT_LGU_ACKNOWLEDGED', p_incident_id::TEXT, NULL, 'Incident Reports',
        'The LGU Administrator took the report in hand (' || v_i.category || '). Nothing is decided yet.',
        jsonb_build_object('status', v_i.status), jsonb_build_object('status', 'Under Investigation', 'incident_id', p_incident_id, 'category', v_i.category));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE);
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. The hourly sweep: lost items (unchanged), overdue reports, accreditation reminders
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._toda_accreditation_expiry_sweep()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    r RECORD;
    v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::DATE;
    v_days_list INTEGER[] := public.get_policy_config_int_array('toda_accreditation_reminder_days', ARRAY[7]);
    v_d INTEGER;
    v_left INTEGER;
    v_period TEXT;
    v_n INTEGER := 0;
BEGIN
    FOR r IN
        SELECT t.toda_id, t.toda_name, t.certificate_number, t.certificate_expiry FROM public.toda t
         WHERE t.toda_status IN ('Active', 'Suspended') AND t.certificate_expiry IS NOT NULL
    LOOP
        v_left := ((r.certificate_expiry AT TIME ZONE 'Asia/Manila')::DATE - v_today);
        -- one accreditation period = one expiry date: a renewal moves the date and so allows its own reminders
        v_period := r.toda_id::TEXT || '|' || to_char(r.certificate_expiry AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD');
        IF v_left > 0 THEN
            FOREACH v_d IN ARRAY v_days_list LOOP
                IF v_left <= v_d THEN
                    IF public._portal_notify('toda_' || r.toda_id::TEXT, 'TODA_ACCREDITATION_EXPIRING', 'Your accreditation expires in ' || v_left || ' day' || CASE WHEN v_left = 1 THEN '' ELSE 's' END,
                        r.toda_name || ' (certificate ' || COALESCE(r.certificate_number, 'on record') || ') is valid until ' || to_char(r.certificate_expiry AT TIME ZONE 'Asia/Manila', 'Mon DD, YYYY')
                        || '. Renew it with the City Transport Office so your drivers can stay Online. Open Account & Accreditation for the details.', v_period, v_d) THEN
                        v_n := v_n + 1;
                    END IF;
                END IF;
            END LOOP;
        ELSE
            IF public._portal_notify('toda_' || r.toda_id::TEXT, 'TODA_ACCREDITATION_EXPIRED', 'Your accreditation has expired',
                r.toda_name || ' (certificate ' || COALESCE(r.certificate_number, 'on record') || ') expired on ' || to_char(r.certificate_expiry AT TIME ZONE 'Asia/Manila', 'Mon DD, YYYY')
                || '. Your drivers cannot go Online until the LGU records a renewal. Open Account & Accreditation to send the renewed Barangay Clearance.', v_period, 0) THEN
                v_n := v_n + 1;
                PERFORM public._portal_notify('lgu_admin', 'TODA_ACCREDITATION_EXPIRED_LGU', r.toda_name || ': accreditation expired',
                    'The accreditation of ' || r.toda_name || ' expired on ' || to_char(r.certificate_expiry AT TIME ZONE 'Asia/Manila', 'Mon DD, YYYY') || '. Its drivers cannot go Online until a renewal is recorded.', v_period, 0);
            END IF;
        END IF;
    END LOOP;
    RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public._incident_overdue_sweep()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    r RECORD;
    v_n INTEGER := 0;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_kind TEXT;
    v_code TEXT;
    v_toda TEXT;
BEGIN
    PERFORM set_config('sakay.internal_context', 'true', true);

    -- (unchanged, Batch 11) a lost-item report with no contact and no result after 14 days is SHOWN to the driver's TODA administrator; nothing is closed by the job
    FOR r IN
        SELECT i.incident_id, i.driver_id, i.booking_id FROM public.incident_report i
         WHERE i.category = 'Lost Item' AND i.lost_item_status = 'Open' AND i.outcome IS NULL AND i.status <> 'Cancelled' AND i.driver_id IS NOT NULL
           AND i.created_at <= clock_timestamp() - make_interval(days => public.incident_constant('lost_item_unclaimed_days'))
    LOOP
        IF NOT EXISTS (SELECT 1 FROM public.admin_review_flag f WHERE f.flag_type = 'LOST_ITEM_UNCLAIMED_REVIEW' AND f.subject_type = 'driver'
                          AND f.subject_id = r.driver_id::TEXT AND f.status IN ('Open', 'Under Review')) THEN
            PERFORM public._presence_flag('LOST_ITEM_UNCLAIMED_REVIEW', r.driver_id, 'Rule 29.19',
                jsonb_build_object('incident_id', r.incident_id, 'booking_id', r.booking_id,
                    'note', 'A lost-item report has had no contact and no result for ' || public.incident_constant('lost_item_unclaimed_days') || ' days. Contact the parties, or close it as Unclaimed.'));
            v_n := v_n + 1;
        END IF;
    END LOOP;

    -- (new) a report past its first-action time (nobody acted) or its decision time (escalated, not decided): the state is recorded and both sides are told once
    FOR r IN
        SELECT i.incident_id, i.category, i.routing, i.reported_toda_id, i.overdue_kind,
               CASE WHEN i.first_action_at IS NULL THEN 'first_action' ELSE 'decision' END AS kind,
               CASE WHEN i.first_action_at IS NULL THEN i.first_action_due_at ELSE i.decision_due_at END AS due_at
          FROM public.incident_report i
         WHERE i.outcome IS NULL AND i.status <> 'Cancelled'
           AND ((i.first_action_at IS NULL AND i.first_action_due_at IS NOT NULL AND i.first_action_due_at < clock_timestamp())
             OR (i.first_action_at IS NOT NULL AND i.decision_due_at IS NOT NULL AND i.decision_due_at < clock_timestamp()))
    LOOP
        v_kind := r.kind;
        v_code := upper(left(r.incident_id::TEXT, 8));
        v_toda := CASE WHEN r.reported_toda_id IS NOT NULL THEN 'toda_' || r.reported_toda_id::TEXT END;
        IF r.overdue_kind IS DISTINCT FROM v_kind THEN
            UPDATE public.incident_report SET overdue_kind = v_kind, overdue_since = r.due_at WHERE incident_id = r.incident_id;
        END IF;
        IF v_kind = 'first_action' AND r.routing = 'TODA' THEN
            IF v_toda IS NOT NULL AND public._portal_notify(v_toda, 'INCIDENT_OVERDUE_TODA', 'Overdue: incident #' || v_code || ' needs your first action',
                'This ' || r.category || ' report passed its first-action time on ' || to_char(r.due_at AT TIME ZONE 'Asia/Manila', 'Mon DD, YYYY') || '. Review it, or escalate it to the LGU.', r.incident_id::TEXT, 1) THEN
                v_n := v_n + 1;
            END IF;
            PERFORM public._portal_notify('lgu_admin', 'INCIDENT_OVERDUE_LGU', 'Overdue at the TODA: incident #' || v_code,
                'A ' || r.category || ' report has had no first action from the TODA since ' || to_char(r.due_at AT TIME ZONE 'Asia/Manila', 'Mon DD, YYYY') || '. You may take it over.', r.incident_id::TEXT, 1);
        ELSE
            -- with the LGU (a decision is due), or the first action of a report the LGU holds
            IF public._portal_notify('lgu_admin', 'INCIDENT_OVERDUE_LGU', 'Overdue: incident #' || v_code || ' needs the LGU''s ' || CASE WHEN v_kind = 'first_action' THEN 'first action' ELSE 'decision' END,
                'This ' || r.category || ' report passed its ' || CASE WHEN v_kind = 'first_action' THEN 'first-action' ELSE 'decision' END || ' time on ' || to_char(r.due_at AT TIME ZONE 'Asia/Manila', 'Mon DD, YYYY') || '.',
                r.incident_id::TEXT, CASE WHEN v_kind = 'first_action' THEN 1 ELSE 2 END) THEN
                v_n := v_n + 1;
            END IF;
            IF v_toda IS NOT NULL THEN
                PERFORM public._portal_notify(v_toda, 'INCIDENT_OVERDUE_FYI', 'Incident #' || v_code || ' is overdue at the LGU',
                    'The LGU has not yet ' || CASE WHEN v_kind = 'first_action' THEN 'acted on' ELSE 'decided' END || ' this ' || r.category || ' report. You can send the LGU a follow-up from the report.',
                    r.incident_id::TEXT, CASE WHEN v_kind = 'first_action' THEN 1 ELSE 2 END);
            END IF;
        END IF;
    END LOOP;

    -- (new) the accreditation reminders
    v_n := v_n + public._toda_accreditation_expiry_sweep();

    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN v_n;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. The LGU's decisions on a driver, and an appeal that reaches the LGU
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._affiliation_decision_notice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_name TEXT;
    v_word TEXT;
BEGIN
    IF NEW.lgu_verification_status IS NOT DISTINCT FROM OLD.lgu_verification_status OR NEW.lgu_verification_status NOT IN ('Approved', 'Rejected', 'Resubmission Required') THEN
        RETURN NEW;
    END IF;
    SELECT d.full_name INTO v_name FROM public.driver d WHERE d.driver_id = NEW.driver_id;
    v_word := CASE NEW.lgu_verification_status WHEN 'Approved' THEN 'verified' WHEN 'Rejected' THEN 'rejected' ELSE 'returned for correction' END;
    PERFORM public._portal_notify('toda_' || NEW.toda_id::TEXT, 'TODA_DRIVER_LGU_DECISION', 'The LGU ' || v_word || ' ' || COALESCE(v_name, 'a driver'),
        'The LGU ' || v_word || ' the application of ' || COALESCE(v_name, 'your applicant') || ' to your TODA. Open Driver Verification to see the decision.',
        NEW.affiliation_id::TEXT, public._portal_notice_seq('toda_' || NEW.toda_id::TEXT, 'TODA_DRIVER_LGU_DECISION', NEW.affiliation_id::TEXT));
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_affiliation_decision_notice ON public.driver_toda_affiliation;
CREATE TRIGGER trigger_affiliation_decision_notice
    AFTER UPDATE OF lgu_verification_status ON public.driver_toda_affiliation
    FOR EACH ROW EXECUTE FUNCTION public._affiliation_decision_notice();

CREATE OR REPLACE FUNCTION public._appeal_pending_lgu_notice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.status = 'Pending LGU Review' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
        PERFORM public._portal_notify('lgu_admin', 'APPEAL_PENDING_LGU', 'A strike appeal is waiting for the LGU',
            'A ' || NEW.subject_type || '''s appeal needs the LGU Administrator''s decision. Open Strike Appeals to review it.', NEW.request_id::TEXT, 1);
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_appeal_pending_lgu_notice ON public.exemption_request;
CREATE TRIGGER trigger_appeal_pending_lgu_notice
    AFTER INSERT OR UPDATE OF status ON public.exemption_request
    FOR EACH ROW EXECUTE FUNCTION public._appeal_pending_lgu_notice();

-- ----------------------------------------------------------------------------
-- 8. The emergency declaration: an expected end and a way to change it (LGU only, audited)
-- ----------------------------------------------------------------------------
ALTER TABLE public.calamity_declaration
    ADD COLUMN IF NOT EXISTS expected_end_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_by      UUID;

CREATE OR REPLACE FUNCTION public.update_calamity(p_title TEXT, p_message TEXT, p_expected_end TIMESTAMPTZ DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_c    public.calamity_declaration;
    v_title TEXT := btrim(COALESCE(p_title, ''));
    v_msg   TEXT := btrim(COALESCE(p_message, ''));
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RAISE EXCEPTION 'Access Denied: Only the LGU Administrator can change an emergency declaration.';
    END IF;
    IF length(v_title) < 5 OR length(v_msg) < 10 THEN
        RAISE EXCEPTION 'ERR_CALAMITY_TEXT: Write a title (at least 5 characters) and the announcement (at least 10 characters).';
    END IF;
    IF p_expected_end IS NOT NULL AND p_expected_end <= clock_timestamp() THEN
        RAISE EXCEPTION 'ERR_CALAMITY_END: The expected end must be in the future. To end the emergency now, end it.';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('sakay.calamity', 0));
    SELECT * INTO v_c FROM public.calamity_declaration WHERE ended_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_NO_ACTIVE_CALAMITY: There is no active emergency declaration to change.';
    END IF;
    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.calamity_declaration
       SET title = left(v_title, 255), message = v_msg, expected_end_at = p_expected_end, updated_at = clock_timestamp(), updated_by = auth.uid()
     WHERE declaration_id = v_c.declaration_id;
    IF v_c.announcement_id IS NOT NULL THEN
        UPDATE public.announcement SET title = left(v_title, 255), message = v_msg WHERE announcement_id = v_c.announcement_id;
    END IF;
    PERFORM public.record_policy_audit('CALAMITY_UPDATED', v_c.declaration_id::TEXT, v_title, 'Strikes & Suspensions',
        'The emergency declaration was changed: ' || v_title,
        jsonb_build_object('title', v_c.title, 'message', v_c.message, 'expected_end_at', v_c.expected_end_at),
        jsonb_build_object('title', v_title, 'message', v_msg, 'expected_end_at', p_expected_end));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'declaration_id', v_c.declaration_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_active_calamity()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE((SELECT jsonb_build_object('active', TRUE, 'declaration_id', c.declaration_id, 'kind', c.kind, 'title', c.title, 'message', c.message,
                                               'scope', c.scope, 'declared_at', c.declared_at, 'expected_end_at', c.expected_end_at, 'updated_at', c.updated_at)
                       FROM public.calamity_declaration c WHERE c.ended_at IS NULL LIMIT 1),
                    jsonb_build_object('active', FALSE));
$$;

-- ----------------------------------------------------------------------------
-- 9. Privileges
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._portal_notify(TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._portal_notice_seq(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._incident_portal_notices() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._toda_accreditation_expiry_sweep() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._incident_overdue_sweep() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._affiliation_decision_notice() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._appeal_pending_lgu_notice() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_portal_notifications_read(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_portal_notifications_read(UUID[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.incident_lgu_acknowledge(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.incident_lgu_acknowledge(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.incident_send_followup(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.incident_send_followup(UUID, TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_calamity(TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_calamity(TEXT, TEXT, TIMESTAMPTZ) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 10. The kind of event an announcement is about (its icon follows it in the portals and the apps)
-- ----------------------------------------------------------------------------
-- The TODA form always had a "Category", but nothing stored it: every announcement came back as "General" after a reload. It is a column now. A calamity's announcement is an 'Emergency'.
ALTER TABLE public.announcement ADD COLUMN IF NOT EXISTS event_type VARCHAR(30) NOT NULL DEFAULT 'General';
ALTER TABLE public.announcement DROP CONSTRAINT IF EXISTS announcement_event_type_check;
ALTER TABLE public.announcement ADD CONSTRAINT announcement_event_type_check
    CHECK (event_type IN ('General', 'Terminal Rules', 'Document Renewal', 'Meeting Notice', 'Safety Advisory', 'Road Closure', 'Weather', 'Emergency', 'Fare Update', 'Service Notice'));

UPDATE public.announcement a SET event_type = 'Emergency'
  FROM public.calamity_declaration c
 WHERE c.announcement_id = a.announcement_id AND a.event_type = 'General';

CREATE OR REPLACE FUNCTION public._calamity_announcement_event_type()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
BEGIN
    IF NEW.announcement_id IS NOT NULL THEN
        PERFORM set_config('sakay.internal_context', 'true', true);
        UPDATE public.announcement SET event_type = 'Emergency' WHERE announcement_id = NEW.announcement_id;
        PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_calamity_announcement_event_type ON public.calamity_declaration;
CREATE TRIGGER trigger_calamity_announcement_event_type
    AFTER INSERT ON public.calamity_declaration
    FOR EACH ROW EXECUTE FUNCTION public._calamity_announcement_event_type();
REVOKE EXECUTE ON FUNCTION public._calamity_announcement_event_type() FROM PUBLIC, anon, authenticated;
