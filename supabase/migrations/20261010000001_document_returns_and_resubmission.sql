-- ============================================================================
-- Migration: 20261010000001_document_returns_and_resubmission.sql
-- RETURN FOR CORRECTION, PER DOCUMENT (paper Rules 3.5, 3.6, 3.7, 3.8; ERD driver_document + document_review_history)
--
-- What was wrong (found in Phase A, reproduced on the local emulator):
--   1. A return named no document. return_driver_affiliation(affiliation, reason, notes) stored one sentence; the Driver app could not
--      tell which document to ask for again, fell back to "license" every time, and the TODA portal offered REJECT reasons (fraud,
--      ineligible, not on the roster) in the RETURN dialog.
--   2. After the driver resubmitted, nothing changed on the status screen. The app wrote verification_status / account_status /
--      rejection_* itself; since the perimeter lockdown those columns are refused to a driver ("Drivers cannot modify verification
--      status", "Only LGU Administrators can modify driver account_status"), the app logged a warning and reported success, and the
--      status stayed "Resubmission Required" for ever. resubmit_driver_application() existed but no client ever called it.
--   3. Nothing told the TODA that a returned application had come back, and the 3-day reminder could never fire again: reminders are
--      de-duplicated on (recipient, type, affiliation, threshold) and the first cycle's row was still there.
--
-- Model (kept consistent with 20261009000002: documents are SHARED per driver, review state is PER AFFILIATION)
--   driver_document            one row per (driver, document type): the CURRENT state of the shared document
--                              (Submitted | Resubmission Required | Resubmitted), no reason text.
--   document_review_history    append-only: a 'Returned' row per document returned (WHICH affiliation's review returned it, who, the
--                              preset reason code and the required free-text reason) and a 'Resubmitted' row when the driver replaces
--                              the document. A return is OPEN until a later 'Resubmitted' row exists for the same document.
--   driver_toda_affiliation    stays the single source of truth for the review stage of each TODA; a return moves ONLY that
--                              affiliation (TODA stage -> 'Resubmission Required', or the LGU stage when the LGU returns it).
--
--   How a return by TODA A relates to TODA B:
--     * B's affiliation, B's stage and B's 5-day clock are not touched.
--     * B is not blocked: it can still endorse, return or reject on its own judgement.
--     * B's administrator can see that the shared document is flagged ("returned in another review") or was replaced after B's
--       application, WITHOUT A's reason text (history rows are visible to the TODA that made the return, the LGU and the driver).
--     * The driver fixes each document once. When it is replaced, every return open on it is closed, and each affiliation whose
--       returned documents have ALL been replaced goes back to review (stage-preserving: a TODA return goes back to the TODA, an LGU
--       return goes back to the LGU), with its 5-calendar-day clock restarted (resubmitted_at), its reminder rows removed, its overdue
--       flag resolved, and its administrator notified. An affiliation whose other documents are still outstanding stays returned.
--
-- Functions
--   return_driver_documents(affiliation, documents jsonb, summary, verified[])   TODA admin of that TODA, or LGU admin
--   resubmit_driver_documents(types[])                                           the driver
--   get_affiliation_document_reviews(affiliation ids[])                          per document state, scoped to the caller
--   get_my_application_review()                                                  the driver's own status screen, one call
--   return_driver_affiliation()                      REPLACED: refuses and says to use return_driver_documents (it used to ask for "a
--                                                    return" with no document, which is how everything became "redo the licence")
--   resubmit_driver_application(affiliation, docs)   REPLACED: wrapper over resubmit_driver_documents for that affiliation
--
-- Row security: both new tables are read-only to every signed-in user (drivers: their own; TODA administrators: only drivers who have an
-- affiliation with their TODA, and only the return rows of THEIR affiliations; the LGU: all). Every write goes through the functions above.
-- Forward-only. Safe to run twice. Ends with a self-check.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.driver_document (
    document_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES public.driver(driver_id) ON DELETE CASCADE,
    document_type VARCHAR(20) NOT NULL CHECK (document_type IN ('license', 'mtop', 'tricycle', 'selfie')),
    document_status VARCHAR(30) NOT NULL DEFAULT 'Submitted'
        CHECK (document_status IN ('Submitted', 'Resubmission Required', 'Resubmitted')),
    resubmission_count INTEGER NOT NULL DEFAULT 0 CHECK (resubmission_count >= 0),
    returned_at TIMESTAMPTZ,
    resubmitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (driver_id, document_type)
);

CREATE TABLE IF NOT EXISTS public.document_review_history (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_seq BIGINT GENERATED ALWAYS AS IDENTITY,
    driver_id UUID NOT NULL REFERENCES public.driver(driver_id) ON DELETE CASCADE,
    document_type VARCHAR(20) NOT NULL CHECK (document_type IN ('license', 'mtop', 'tricycle', 'selfie')),
    event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('Returned', 'Resubmitted')),
    -- The review that returned the document. NULL for 'Resubmitted' (the driver replaces the shared document for everybody).
    -- Nullable + SET NULL: deleting an affiliation keeps the history (see 20261009000001 for the NOT NULL + SET NULL rule).
    affiliation_id UUID REFERENCES public.driver_toda_affiliation(affiliation_id) ON DELETE SET NULL,
    toda_id UUID REFERENCES public.toda(toda_id) ON DELETE SET NULL,
    review_stage VARCHAR(10) CHECK (review_stage IS NULL OR review_stage IN ('TODA', 'LGU')),
    actor_auth_id UUID,                                  -- auth user (no foreign key: the login may be deleted)
    actor_role VARCHAR(20) CHECK (actor_role IS NULL OR actor_role IN ('toda_admin', 'lgu_admin', 'driver')),
    reason_code VARCHAR(30) CHECK (reason_code IS NULL OR reason_code IN ('blurry', 'expired', 'mismatch', 'wrong_document', 'incomplete', 'other')),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT document_review_returned_has_reason
        CHECK (event_type <> 'Returned' OR (reason_code IS NOT NULL AND reason IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_review_history_seq ON public.document_review_history (event_seq);
CREATE INDEX IF NOT EXISTS idx_document_review_history_driver_doc ON public.document_review_history (driver_id, document_type, event_seq);
CREATE INDEX IF NOT EXISTS idx_document_review_history_affiliation ON public.document_review_history (affiliation_id, document_type, event_seq);
CREATE INDEX IF NOT EXISTS idx_driver_document_driver ON public.driver_document (driver_id);

-- The history is append-only. The one UPDATE that is allowed is the foreign key nulling affiliation_id / toda_id when the affiliation
-- or the TODA is deleted; deletes are for trusted sessions (the service role, a direct session such as the clean-up script) and the LGU.
CREATE OR REPLACE FUNCTION public.document_review_history_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (NEW.event_id, NEW.event_seq, NEW.driver_id, NEW.document_type, NEW.event_type, NEW.review_stage, NEW.actor_auth_id,
            NEW.actor_role, NEW.reason_code, NEW.reason, NEW.created_at)
           IS DISTINCT FROM
           (OLD.event_id, OLD.event_seq, OLD.driver_id, OLD.document_type, OLD.event_type, OLD.review_stage, OLD.actor_auth_id,
            OLD.actor_role, OLD.reason_code, OLD.reason, OLD.created_at)
           OR (NEW.affiliation_id IS NOT NULL AND NEW.affiliation_id IS DISTINCT FROM OLD.affiliation_id)
           OR (NEW.toda_id IS NOT NULL AND NEW.toda_id IS DISTINCT FROM OLD.toda_id) THEN
            RAISE EXCEPTION 'The document review history is append-only.' USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
    END IF;
    IF public.is_trusted_session() OR COALESCE(public.is_lgu_admin(), FALSE) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'The document review history cannot be deleted.' USING ERRCODE = '42501';
END;
$$;
DROP TRIGGER IF EXISTS trigger_document_review_history_guard ON public.document_review_history;
CREATE TRIGGER trigger_document_review_history_guard BEFORE UPDATE OR DELETE ON public.document_review_history
    FOR EACH ROW EXECUTE FUNCTION public.document_review_history_guard();

-- ----------------------------------------------------------------------------
-- 2. Row security: read-only for everybody; writes only through the functions below
-- ----------------------------------------------------------------------------
ALTER TABLE public.driver_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_review_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.driver_document, public.document_review_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.driver_document, public.document_review_history TO authenticated;
GRANT ALL ON TABLE public.driver_document, public.document_review_history TO service_role;

-- A policy helper (SECURITY DEFINER: reads the affiliation table without its own policies): is this affiliation one of MY TODA's?
CREATE OR REPLACE FUNCTION public.rls_affiliation_in_my_toda(p_affiliation_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT p_affiliation_id IS NOT NULL
       AND public.get_current_toda_admin_toda_id() IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.driver_toda_affiliation a
                    WHERE a.affiliation_id = p_affiliation_id AND a.toda_id = public.get_current_toda_admin_toda_id());
$$;
REVOKE ALL ON FUNCTION public.rls_affiliation_in_my_toda(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rls_affiliation_in_my_toda(UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS driver_document_select ON public.driver_document;
CREATE POLICY driver_document_select ON public.driver_document FOR SELECT TO authenticated
    USING (driver_id = (SELECT public.get_current_driver_id())
           OR (SELECT public.is_lgu_admin())
           OR public.toda_admin_has_affiliation_with_driver(driver_id));

DROP POLICY IF EXISTS document_review_history_select ON public.document_review_history;
CREATE POLICY document_review_history_select ON public.document_review_history FOR SELECT TO authenticated
    USING (driver_id = (SELECT public.get_current_driver_id())
           OR (SELECT public.is_lgu_admin())
           OR (public.toda_admin_has_affiliation_with_driver(driver_id)
               AND (affiliation_id IS NULL OR public.rls_affiliation_in_my_toda(affiliation_id))));

-- ----------------------------------------------------------------------------
-- 3. Internal helpers (service role only: they read the history without row security)
-- ----------------------------------------------------------------------------
-- The returns of a driver that are still OPEN: no later 'Resubmitted' row exists for the same document.
CREATE OR REPLACE FUNCTION public._driver_open_returns(p_driver_id UUID)
RETURNS TABLE (event_id UUID, event_seq BIGINT, document_type TEXT, affiliation_id UUID, toda_id UUID, review_stage TEXT,
               reason_code TEXT, reason TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT r.event_id, r.event_seq, r.document_type::TEXT, r.affiliation_id, r.toda_id, r.review_stage::TEXT,
           r.reason_code::TEXT, r.reason, r.created_at
      FROM public.document_review_history r
     WHERE r.driver_id = p_driver_id
       AND r.event_type = 'Returned'
       AND NOT EXISTS (SELECT 1 FROM public.document_review_history s
                        WHERE s.driver_id = r.driver_id AND s.document_type = r.document_type
                          AND s.event_type = 'Resubmitted' AND s.event_seq > r.event_seq);
$$;

CREATE OR REPLACE FUNCTION public._document_label(p_type TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE
AS $$ SELECT CASE p_type WHEN 'license' THEN 'Driver''s License' WHEN 'mtop' THEN 'MTOP' WHEN 'tricycle' THEN 'Tricycle photo'
                         WHEN 'selfie' THEN 'Selfie / face photo' ELSE p_type END $$;

CREATE OR REPLACE FUNCTION public._reason_label(p_code TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE
AS $$ SELECT CASE p_code WHEN 'blurry' THEN 'Blurry / hard to read' WHEN 'expired' THEN 'Expired' WHEN 'mismatch' THEN 'Information does not match'
                         WHEN 'wrong_document' THEN 'Wrong document' WHEN 'incomplete' THEN 'Incomplete' ELSE 'Other' END $$;

-- The structured comment the older screens (LGU portal, the Driver app's fallback) read from driver_verification.rejection_comment:
-- built from ALL the open returns of the driver, so a second TODA's return never hides the first one's documents.
CREATE OR REPLACE FUNCTION public._open_returns_json(p_driver_id UUID, p_verified TEXT[] DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT jsonb_build_object(
        'faultyDocuments', COALESCE((SELECT jsonb_agg(t ORDER BY o) FROM (
            SELECT d.t, d.o FROM unnest(ARRAY['license', 'mtop', 'tricycle', 'selfie']) WITH ORDINALITY AS d(t, o)
             WHERE EXISTS (SELECT 1 FROM public._driver_open_returns(p_driver_id) r WHERE r.document_type = d.t)) x), '[]'::JSONB),
        'verifiedDocuments', to_jsonb(COALESCE(p_verified, ARRAY[]::TEXT[])),
        'issues', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'documentType', r.document_type, 'grounds', public._reason_label(r.reason_code), 'notes', r.reason)
                        ORDER BY r.event_seq) FROM public._driver_open_returns(p_driver_id) r), '[]'::JSONB),
        'displayReason', COALESCE((SELECT string_agg(public._document_label(r.document_type) || ': ' || public._reason_label(r.reason_code), '; ' ORDER BY r.event_seq)
                                     FROM public._driver_open_returns(p_driver_id) r), ''),
        'displayNotes', COALESCE((SELECT string_agg(public._document_label(r.document_type) || ': ' || r.reason, '; ' ORDER BY r.event_seq)
                                    FROM public._driver_open_returns(p_driver_id) r), ''),
        'returnedAt', to_jsonb(CURRENT_TIMESTAMP)
    );
$$;

REVOKE ALL ON FUNCTION public._driver_open_returns(UUID), public._document_label(TEXT), public._reason_label(TEXT),
                       public._open_returns_json(UUID, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._driver_open_returns(UUID), public._document_label(TEXT), public._reason_label(TEXT),
                          public._open_returns_json(UUID, TEXT[]) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. Return for correction: which documents, why, for which affiliation
-- ----------------------------------------------------------------------------
-- p_documents: [{ "document_type": "license"|"mtop"|"tricycle"|"selfie",
--                 "reason_code": "blurry"|"expired"|"mismatch"|"wrong_document"|"incomplete"|"other",
--                 "reason": "required free text, at most 500 characters" }, ...]   1 to 4 documents, each once
-- p_summary: optional one-line text for the SMS / notification (default: built from the documents)
-- p_verified: documents the reviewer has looked at and found fine (kept for the LGU screen's "verified" ticks)
CREATE OR REPLACE FUNCTION public.return_driver_documents(
    p_affiliation_id UUID,
    p_documents JSONB,
    p_summary TEXT DEFAULT NULL,
    p_verified TEXT[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_aff public.driver_toda_affiliation;
    v_driver public.driver;
    v_is_lgu BOOLEAN := COALESCE(public.is_lgu_admin(), FALSE);
    v_my_toda UUID := public.get_current_toda_admin_toda_id();
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_item JSONB;
    v_type TEXT;
    v_code TEXT;
    v_reason TEXT;
    v_types TEXT[] := ARRAY[]::TEXT[];
    v_codes TEXT[] := ARRAY[]::TEXT[];
    v_reasons TEXT[] := ARRAY[]::TEXT[];
    v_stage TEXT;
    v_lines TEXT[] := ARRAY[]::TEXT[];
    v_text TEXT;
    v_summary TEXT;
    v_json JSONB;
    v_toda_admin UUID;
    v_lgu_admin UUID;
    v_actor_role TEXT;
    v_i INTEGER;
    v_before JSONB;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'ERR_AUTH_REQUIRED: Sign in first.');
    END IF;

    SELECT * INTO v_aff FROM public.driver_toda_affiliation WHERE affiliation_id = p_affiliation_id FOR UPDATE;
    IF v_aff.affiliation_id IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Affiliation record not found.');
    END IF;
    IF NOT (v_is_lgu OR (v_my_toda IS NOT NULL AND v_aff.toda_id = v_my_toda)) THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Access Denied: You may only return applications to your own TODA.');
    END IF;

    -- The stage that is being returned (sequential review, Policy 3.1)
    IF v_is_lgu THEN
        IF v_aff.toda_endorsement_status <> 'Endorsed' THEN
            RETURN jsonb_build_object('success', FALSE, 'error', 'Sequential violation: the application must be endorsed by its TODA before the LGU can return it.');
        END IF;
        IF v_aff.lgu_verification_status <> 'Pending' THEN
            RETURN jsonb_build_object('success', FALSE, 'error', 'This application is not waiting for the LGU (' || v_aff.lgu_verification_status || ').');
        END IF;
        v_stage := 'LGU';
        v_actor_role := 'lgu_admin';
    ELSE
        IF v_aff.toda_endorsement_status <> 'Submitted' THEN
            RETURN jsonb_build_object('success', FALSE, 'error', 'This application is not waiting for TODA review (' || v_aff.toda_endorsement_status || ').');
        END IF;
        v_stage := 'TODA';
        v_actor_role := 'toda_admin';
    END IF;

    -- The documents: 1 to 4, each valid, each once, each with a preset code and a free-text reason
    IF p_documents IS NULL OR jsonb_typeof(p_documents) <> 'array' OR jsonb_array_length(p_documents) = 0 THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'ERR_DOCUMENTS_REQUIRED: Choose at least one document to return.');
    END IF;
    IF jsonb_array_length(p_documents) > 4 THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'At most four documents can be returned.');
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_documents) LOOP
        v_type := lower(btrim(COALESCE(v_item->>'document_type', '')));
        IF v_type NOT IN ('license', 'mtop', 'tricycle', 'selfie') THEN
            RETURN jsonb_build_object('success', FALSE, 'error', 'ERR_INVALID_DOCUMENT: Unknown document "' || left(v_type, 30) || '".');
        END IF;
        IF v_type = ANY (v_types) THEN
            RETURN jsonb_build_object('success', FALSE, 'error', 'ERR_INVALID_DOCUMENT: ' || public._document_label(v_type) || ' is listed twice.');
        END IF;
        v_code := lower(btrim(COALESCE(v_item->>'reason_code', 'other')));
        IF v_code NOT IN ('blurry', 'expired', 'mismatch', 'wrong_document', 'incomplete', 'other') THEN
            RETURN jsonb_build_object('success', FALSE, 'error', 'ERR_INVALID_REASON: Unknown reason "' || left(v_code, 30) || '" for ' || public._document_label(v_type) || '.');
        END IF;
        v_reason := btrim(regexp_replace(COALESCE(v_item->>'reason', ''), '[[:cntrl:]]+', ' ', 'g'));
        IF v_reason = '' THEN
            RETURN jsonb_build_object('success', FALSE, 'error', 'ERR_REASON_REQUIRED: Write what is wrong with the ' || public._document_label(v_type) || '.');
        END IF;
        v_types := v_types || v_type;
        v_codes := v_codes || v_code;
        v_reasons := v_reasons || left(v_reason, 500);
    END LOOP;

    SELECT * INTO v_driver FROM public.driver WHERE driver_id = v_aff.driver_id;
    SELECT t.admin_id INTO v_toda_admin FROM public.toda_admin t WHERE t.toda_id = v_aff.toda_id AND t.account_status = 'Active' LIMIT 1;
    IF v_is_lgu THEN
        SELECT l.admin_id INTO v_lgu_admin FROM public.lgu_admin l WHERE l.auth_user_id = auth.uid() LIMIT 1;
    END IF;
    v_before := to_jsonb(v_aff);

    FOR v_i IN 1 .. cardinality(v_types) LOOP
        v_lines := v_lines || (public._document_label(v_types[v_i]) || ': ' || public._reason_label(v_codes[v_i]) || ' - ' || v_reasons[v_i]);
    END LOOP;
    v_text := array_to_string(v_lines, '; ');
    v_summary := COALESCE(NULLIF(btrim(p_summary), ''), left(v_text, 250));

    PERFORM set_config('sakay.internal_context', 'true', TRUE);

    -- this affiliation, and only this one, goes back to the driver
    IF v_stage = 'TODA' THEN
        UPDATE public.driver_toda_affiliation
           SET toda_endorsement_status = 'Resubmission Required',
               toda_rejection_reason = v_summary,
               toda_return_notes = v_text,
               updated_at = CURRENT_TIMESTAMP
         WHERE affiliation_id = p_affiliation_id;
    ELSE
        UPDATE public.driver_toda_affiliation
           SET lgu_verification_status = 'Resubmission Required',
               lgu_rejection_reason = v_summary,
               lgu_return_notes = v_text,
               updated_at = CURRENT_TIMESTAMP
         WHERE affiliation_id = p_affiliation_id;
    END IF;

    -- the shared documents: current state + one history row per document
    FOR v_i IN 1 .. cardinality(v_types) LOOP
        INSERT INTO public.driver_document (driver_id, document_type, document_status, returned_at)
        VALUES (v_aff.driver_id, v_types[v_i], 'Resubmission Required', CURRENT_TIMESTAMP)
        ON CONFLICT (driver_id, document_type) DO UPDATE
            SET document_status = 'Resubmission Required', returned_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP;

        INSERT INTO public.document_review_history (driver_id, document_type, event_type, affiliation_id, toda_id, review_stage,
                                                    actor_auth_id, actor_role, reason_code, reason)
        VALUES (v_aff.driver_id, v_types[v_i], 'Returned', p_affiliation_id, v_aff.toda_id, v_stage,
                auth.uid(), v_actor_role, v_codes[v_i], v_reasons[v_i]);
    END LOOP;

    -- the older screens read the shared record: it now lists EVERY open return of the driver
    v_json := public._open_returns_json(v_aff.driver_id, p_verified);
    UPDATE public.driver_verification
       SET verification_status = 'Resubmission Required',
           rejection_reason = left(COALESCE(v_json->>'displayReason', v_summary), 250),
           rejection_comment = v_json::TEXT,
           rejected_at = CURRENT_TIMESTAMP
     WHERE driver_id = v_aff.driver_id;
    IF v_stage = 'LGU' AND v_driver.account_status IN ('Pending Verification', 'Resubmission Required') THEN
        UPDATE public.driver
           SET account_status = 'Resubmission Required',
               rejection_reason = left(COALESCE(v_json->>'displayReason', v_summary), 250),
               rejection_comment = v_json::TEXT,
               updated_at = CURRENT_TIMESTAMP
         WHERE driver_id = v_aff.driver_id;
    END IF;

    -- a returned application is not waiting on a reviewer: its overdue flag is closed (the clock restarts at resubmission)
    UPDATE public.admin_review_flag
       SET status = 'Resolved', resolution = 'Application returned for correction: ' || left(v_summary, 200),
           resolved_at = CURRENT_TIMESTAMP, resolved_by = auth.uid()
     WHERE subject_id = p_affiliation_id::TEXT AND flag_type = 'APPLICATION_OVERDUE' AND status IN ('Open', 'Under Review');

    INSERT INTO public.audit_log (action_type, target_id, target_name, category, actor_id, actor_role, toda_admin_id, lgu_admin_id,
                                  details, before_state, after_state, performed_at)
    VALUES ('DRIVER_DOCUMENTS_RETURNED', p_affiliation_id::TEXT, v_driver.full_name, 'Driver Verification', auth.uid(), v_actor_role,
            v_toda_admin, v_lgu_admin,
            'Returned for correction (' || v_stage || ' review): ' || left(v_text, 900),
            v_before,
            jsonb_build_object('documents', to_jsonb(v_types), 'reason_codes', to_jsonb(v_codes), 'stage', v_stage),
            CURRENT_TIMESTAMP);

    INSERT INTO public.notification (driver_id, recipient_id, subject_id, title, message, notification_type, is_read, sent_at)
    VALUES (v_aff.driver_id, v_aff.driver_id::TEXT, p_affiliation_id::TEXT,
            'Kailangan ng pagwawasto sa dokumento (Correction needed)',
            left(v_text, 900), 'DOCUMENT_RETURNED', FALSE, CURRENT_TIMESTAMP);

    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), TRUE);
    RETURN jsonb_build_object('success', TRUE, 'affiliation_id', p_affiliation_id, 'stage', v_stage, 'documents', to_jsonb(v_types),
                              'summary', v_summary);
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Resubmission: the driver replaced the documents that were returned
-- ----------------------------------------------------------------------------
-- p_document_types: NULL = every document that has an open return; an array = just those (a driver may fix them one at a time).
-- Each affiliation whose returned documents are ALL replaced goes back to review; the others stay returned.
CREATE OR REPLACE FUNCTION public.resubmit_driver_documents(p_document_types TEXT[] DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_driver public.driver;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_asked TEXT[];
    v_types TEXT[] := ARRAY[]::TEXT[];
    v_t TEXT;
    v_aff public.driver_toda_affiliation;
    v_remaining INTEGER;
    v_stage TEXT;
    v_docs TEXT[];
    v_doc_text TEXT;
    v_toda_admin UUID;
    v_back JSONB := '[]'::JSONB;
    v_still JSONB := '[]'::JSONB;
    v_open INTEGER;
    v_json JSONB;
    v_endorsed BOOLEAN;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'ERR_AUTH_REQUIRED: Sign in first.');
    END IF;
    SELECT * INTO v_driver FROM public.driver WHERE auth_user_id = auth.uid() FOR UPDATE;
    IF v_driver.driver_id IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'No driver account for this login.');
    END IF;
    IF v_driver.is_permanently_disqualified = TRUE THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Driver is permanently disqualified.');
    END IF;

    -- which documents: the ones asked for that really have an open return
    IF p_document_types IS NULL THEN
        SELECT COALESCE(array_agg(DISTINCT r.document_type), ARRAY[]::TEXT[]) INTO v_asked
          FROM public._driver_open_returns(v_driver.driver_id) r;
    ELSE
        v_asked := p_document_types;
    END IF;
    FOREACH v_t IN ARRAY v_asked LOOP
        IF v_t IN ('license', 'mtop', 'tricycle', 'selfie') AND NOT (v_t = ANY (v_types))
           AND EXISTS (SELECT 1 FROM public._driver_open_returns(v_driver.driver_id) r WHERE r.document_type = v_t) THEN
            v_types := v_types || v_t;
        END IF;
    END LOOP;

    PERFORM set_config('sakay.internal_context', 'true', TRUE);

    -- 1. the shared documents were replaced: current state + one history row each
    FOREACH v_t IN ARRAY v_types LOOP
        UPDATE public.driver_document
           SET document_status = 'Resubmitted', resubmitted_at = CURRENT_TIMESTAMP,
               resubmission_count = resubmission_count + 1, updated_at = CURRENT_TIMESTAMP
         WHERE driver_id = v_driver.driver_id AND document_type = v_t;
        IF NOT FOUND THEN
            INSERT INTO public.driver_document (driver_id, document_type, document_status, resubmitted_at, resubmission_count)
            VALUES (v_driver.driver_id, v_t, 'Resubmitted', CURRENT_TIMESTAMP, 1);
        END IF;
        INSERT INTO public.document_review_history (driver_id, document_type, event_type, actor_auth_id, actor_role)
        VALUES (v_driver.driver_id, v_t, 'Resubmitted', auth.uid(), 'driver');
    END LOOP;

    -- 2. every affiliation that is waiting on the driver: back to review when ALL of its returned documents are replaced
    FOR v_aff IN
        SELECT * FROM public.driver_toda_affiliation
         WHERE driver_id = v_driver.driver_id
           AND (toda_endorsement_status = 'Resubmission Required' OR lgu_verification_status = 'Resubmission Required')
         ORDER BY submitted_at
           FOR UPDATE
    LOOP
        SELECT count(*) INTO v_remaining FROM public._driver_open_returns(v_driver.driver_id) r WHERE r.affiliation_id = v_aff.affiliation_id;
        v_stage := CASE WHEN v_aff.toda_endorsement_status = 'Resubmission Required' THEN 'TODA' ELSE 'LGU' END;

        IF v_remaining > 0 THEN
            v_still := v_still || jsonb_build_array(jsonb_build_object('affiliation_id', v_aff.affiliation_id, 'toda_id', v_aff.toda_id,
                                                                       'stage', v_stage, 'documents_outstanding', v_remaining));
            CONTINUE;
        END IF;

        -- the documents of this application that were replaced in this call (for the message to its administrator)
        SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::TEXT[]) INTO v_docs
          FROM unnest(v_types) x
         WHERE EXISTS (SELECT 1 FROM public.document_review_history h
                        WHERE h.affiliation_id = v_aff.affiliation_id AND h.event_type = 'Returned' AND h.document_type = x);
        SELECT string_agg(public._document_label(d), ', ') INTO v_doc_text FROM unnest(v_docs) d;

        IF v_stage = 'TODA' THEN
            UPDATE public.driver_toda_affiliation
               SET toda_endorsement_status = 'Submitted', lgu_verification_status = 'Pending',
                   toda_rejection_reason = NULL, toda_return_notes = NULL, lgu_rejection_reason = NULL, lgu_return_notes = NULL,
                   resubmitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE affiliation_id = v_aff.affiliation_id;
        ELSE
            UPDATE public.driver_toda_affiliation
               SET lgu_verification_status = 'Pending', lgu_rejection_reason = NULL, lgu_return_notes = NULL,
                   resubmitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE affiliation_id = v_aff.affiliation_id;
        END IF;

        -- Rule 3.6: the 5-calendar-day clock restarts (resubmitted_at). Rule 3.7: the reminder and the overdue flag start over.
        -- Reminders are de-duplicated on (recipient, type, affiliation, threshold): the previous cycle's rows must go.
        DELETE FROM public.notification
         WHERE subject_id = v_aff.affiliation_id::TEXT AND notification_type IN ('SLA_REMINDER_STAGE1', 'SLA_REMINDER_STAGE2');
        UPDATE public.admin_review_flag
           SET status = 'Resolved', resolution = 'Driver resubmitted; review clock restarted.', resolved_at = CURRENT_TIMESTAMP, resolved_by = auth.uid()
         WHERE subject_id = v_aff.affiliation_id::TEXT AND flag_type = 'APPLICATION_OVERDUE' AND status IN ('Open', 'Under Review');

        SELECT t.admin_id INTO v_toda_admin FROM public.toda_admin t WHERE t.toda_id = v_aff.toda_id AND t.account_status = 'Active' LIMIT 1;

        INSERT INTO public.audit_log (action_type, target_id, target_name, category, actor_id, actor_role, toda_admin_id, details,
                                      before_state, after_state, performed_at)
        VALUES ('DRIVER_APPLICATION_RESUBMITTED', v_aff.affiliation_id::TEXT, v_driver.full_name, 'Driver Verification', auth.uid(), 'driver',
                v_toda_admin,
                'Driver resubmitted (' || v_stage || ' review restarts): ' || COALESCE(v_doc_text, 'documents') || '.',
                to_jsonb(v_aff),
                jsonb_build_object('documents', to_jsonb(v_docs), 'stage', v_stage, 'resubmitted_at', CURRENT_TIMESTAMP),
                CURRENT_TIMESTAMP);

        INSERT INTO public.notification (driver_id, recipient_id, subject_id, title, message, notification_type, is_read, sent_at)
        VALUES (v_aff.driver_id,
                CASE WHEN v_stage = 'TODA' THEN 'toda_' || v_aff.toda_id::TEXT ELSE 'lgu_admin' END,
                v_aff.affiliation_id::TEXT,
                'Resubmitted: ' || v_driver.full_name,
                v_driver.full_name || ' resubmitted ' || COALESCE(v_doc_text, 'documents') || ' for ' || v_stage || ' review. The 5-day review period has restarted.',
                'DRIVER_RESUBMITTED', FALSE, CURRENT_TIMESTAMP);

        v_back := v_back || jsonb_build_array(jsonb_build_object('affiliation_id', v_aff.affiliation_id, 'toda_id', v_aff.toda_id,
                                                                 'stage', v_stage, 'documents', to_jsonb(v_docs)));
    END LOOP;

    IF cardinality(v_types) = 0 AND jsonb_array_length(v_back) = 0 THEN
        PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), TRUE);
        RETURN jsonb_build_object('success', FALSE, 'error', 'Nothing to resubmit: no document of yours is waiting for correction.');
    END IF;

    -- 3. the driver-level records the older screens read
    SELECT count(*) INTO v_open FROM public._driver_open_returns(v_driver.driver_id);
    SELECT EXISTS (SELECT 1 FROM public.driver_toda_affiliation a WHERE a.driver_id = v_driver.driver_id AND a.toda_endorsement_status = 'Endorsed')
      INTO v_endorsed;
    IF v_open = 0 THEN
        UPDATE public.driver_verification
           SET verification_status = CASE WHEN v_endorsed THEN 'Approved' ELSE 'Pending' END,
               rejection_reason = NULL, rejection_comment = NULL, rejected_by = NULL, rejected_at = NULL,
               remarks = 'Resubmitted by driver applicant with updated documents', submitted_at = CURRENT_TIMESTAMP
         WHERE driver_id = v_driver.driver_id;
    ELSE
        v_json := public._open_returns_json(v_driver.driver_id);
        UPDATE public.driver_verification
           SET rejection_reason = left(COALESCE(v_json->>'displayReason', ''), 250), rejection_comment = v_json::TEXT,
               remarks = 'Resubmitted by driver applicant with updated documents', submitted_at = CURRENT_TIMESTAMP
         WHERE driver_id = v_driver.driver_id;
    END IF;
    IF v_driver.account_status = 'Resubmission Required'
       AND NOT EXISTS (SELECT 1 FROM public.driver_toda_affiliation a
                        WHERE a.driver_id = v_driver.driver_id
                          AND (a.toda_endorsement_status = 'Resubmission Required' OR a.lgu_verification_status = 'Resubmission Required')) THEN
        UPDATE public.driver
           SET account_status = 'Pending Verification', rejection_reason = NULL, rejection_comment = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE driver_id = v_driver.driver_id;
    END IF;

    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), TRUE);
    RETURN jsonb_build_object('success', TRUE, 'resubmitted', to_jsonb(v_types), 'back_in_review', v_back, 'still_returned', v_still);
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. What the screens read
-- ----------------------------------------------------------------------------
-- One row per (affiliation, document type) for the affiliations the caller may see (the driver's own; a TODA administrator's own
-- TODA; every one for the LGU). state:
--   returned            THIS affiliation's review returned it and the driver has not replaced it yet (reason shown)
--   resubmitted         it was returned by this affiliation and has been replaced since (reason + both dates shown)
--   returned_elsewhere  another affiliation's review returned it and it is still open (NO reason: that is the other TODA's judgement)
--   replaced_elsewhere  it was replaced after this application was submitted, because of another affiliation's return
--   not_returned        no issue was raised by this affiliation
CREATE OR REPLACE FUNCTION public.get_affiliation_document_reviews(p_affiliation_ids UUID[] DEFAULT NULL)
RETURNS TABLE (affiliation_id UUID, driver_id UUID, document_type TEXT, state TEXT, reason_code TEXT, reason TEXT,
               returned_at TIMESTAMPTZ, returned_by_stage TEXT, resubmitted_at TIMESTAMPTZ, resubmission_count INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    WITH vis AS (
        SELECT a.affiliation_id, a.driver_id, a.toda_id, a.submitted_at
          FROM public.driver_toda_affiliation a
         WHERE (p_affiliation_ids IS NULL OR a.affiliation_id = ANY (p_affiliation_ids))
           AND (COALESCE(public.is_lgu_admin(), FALSE)
                OR (public.get_current_toda_admin_toda_id() IS NOT NULL AND a.toda_id = public.get_current_toda_admin_toda_id())
                OR (public.get_current_driver_id() IS NOT NULL AND a.driver_id = public.get_current_driver_id()))
    ), grid AS (
        SELECT v.*, d.t AS document_type
          FROM vis v CROSS JOIN unnest(ARRAY['license', 'mtop', 'tricycle', 'selfie']) AS d(t)
    )
    SELECT g.affiliation_id, g.driver_id, g.document_type,
           CASE WHEN own.event_id IS NOT NULL AND res.created_at IS NULL THEN 'returned'
                WHEN own.event_id IS NOT NULL THEN 'resubmitted'
                WHEN EXISTS (SELECT 1 FROM public.document_review_history r
                              WHERE r.driver_id = g.driver_id AND r.document_type = g.document_type AND r.event_type = 'Returned'
                                AND r.affiliation_id IS DISTINCT FROM g.affiliation_id
                                AND NOT EXISTS (SELECT 1 FROM public.document_review_history s
                                                 WHERE s.driver_id = r.driver_id AND s.document_type = r.document_type
                                                   AND s.event_type = 'Resubmitted' AND s.event_seq > r.event_seq)) THEN 'returned_elsewhere'
                -- replaced because of ANOTHER review's return: an earlier return of this affiliation that is finished does not count
                WHEN lastres.created_at IS NOT NULL
                     AND NOT EXISTS (SELECT 1 FROM public.document_review_history o
                                      WHERE o.affiliation_id = g.affiliation_id AND o.document_type = g.document_type AND o.event_type = 'Returned')
                     THEN 'replaced_elsewhere'
                ELSE 'not_returned' END,
           own.reason_code::TEXT, own.reason, own.created_at, own.review_stage::TEXT,
           COALESCE(res.created_at,
                    CASE WHEN own.event_id IS NULL
                          AND NOT EXISTS (SELECT 1 FROM public.document_review_history o
                                           WHERE o.affiliation_id = g.affiliation_id AND o.document_type = g.document_type AND o.event_type = 'Returned')
                         THEN lastres.created_at END),
           COALESCE(dd.resubmission_count, 0)
      FROM grid g
      LEFT JOIN LATERAL (
            -- only the LATEST return of this affiliation counts (all the documents of one return share its timestamp): an older
            -- cycle that was already resubmitted and endorsed must not show up again beside a new return
            SELECT h.* FROM public.document_review_history h
             WHERE h.affiliation_id = g.affiliation_id AND h.document_type = g.document_type AND h.event_type = 'Returned'
               AND h.created_at = (SELECT max(h2.created_at) FROM public.document_review_history h2
                                    WHERE h2.affiliation_id = g.affiliation_id AND h2.event_type = 'Returned')
             ORDER BY h.event_seq DESC LIMIT 1) own ON TRUE
      LEFT JOIN LATERAL (
            SELECT s.created_at FROM public.document_review_history s
             WHERE s.driver_id = g.driver_id AND s.document_type = g.document_type AND s.event_type = 'Resubmitted'
               AND s.event_seq > own.event_seq
             ORDER BY s.event_seq LIMIT 1) res ON own.event_id IS NOT NULL
      LEFT JOIN LATERAL (
            SELECT s.created_at FROM public.document_review_history s
             WHERE s.driver_id = g.driver_id AND s.document_type = g.document_type AND s.event_type = 'Resubmitted'
               AND s.created_at >= g.submitted_at
             ORDER BY s.event_seq DESC LIMIT 1) lastres ON TRUE
      LEFT JOIN public.driver_document dd ON dd.driver_id = g.driver_id AND dd.document_type = g.document_type
     ORDER BY g.affiliation_id, array_position(ARRAY['license', 'mtop', 'tricycle', 'selfie'], g.document_type);
$$;

-- The driver's own status screen in ONE call (it polls): every affiliation with its stages, dates and per-document states.
CREATE OR REPLACE FUNCTION public.get_my_application_review()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT jsonb_build_object(
        'affiliations', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'affiliation_id', a.affiliation_id,
                       'toda_id', a.toda_id,
                       'toda_name', t.toda_name,
                       'toda_acronym', t.toda_acronym,
                       'toda_stage', a.toda_endorsement_status,
                       'lgu_stage', a.lgu_verification_status,
                       'is_active', a.is_active_selection,
                       'submitted_at', a.submitted_at,
                       'resubmitted_at', a.resubmitted_at,
                       'toda_return_reason', a.toda_rejection_reason,
                       'lgu_return_reason', a.lgu_rejection_reason,
                       'documents', COALESCE((
                           SELECT jsonb_agg(jsonb_build_object(
                                      'document_type', r.document_type, 'state', r.state, 'reason_code', r.reason_code, 'reason', r.reason,
                                      'returned_at', r.returned_at, 'returned_by_stage', r.returned_by_stage, 'resubmitted_at', r.resubmitted_at)
                                      ORDER BY array_position(ARRAY['license', 'mtop', 'tricycle', 'selfie'], r.document_type))
                             FROM public.get_affiliation_document_reviews(ARRAY[a.affiliation_id]) r), '[]'::JSONB))
                    ORDER BY a.submitted_at)
              FROM public.driver_toda_affiliation a
              JOIN public.toda t ON t.toda_id = a.toda_id
             WHERE a.driver_id = public.get_current_driver_id()), '[]'::JSONB),
        'documents', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('document_type', d.document_type, 'document_status', d.document_status,
                                                'resubmission_count', d.resubmission_count, 'returned_at', d.returned_at,
                                                'resubmitted_at', d.resubmitted_at)
                             ORDER BY array_position(ARRAY['license', 'mtop', 'tricycle', 'selfie'], d.document_type))
              FROM public.driver_document d WHERE d.driver_id = public.get_current_driver_id()), '[]'::JSONB)
    );
$$;

-- ----------------------------------------------------------------------------
-- 7. The old entry points
-- ----------------------------------------------------------------------------
-- A return that names no document is exactly what made every return mean "redo the licence". Same signature, so an old client gets a
-- clear answer instead of "function does not exist".
CREATE OR REPLACE FUNCTION public.return_driver_affiliation(
    p_affiliation_id UUID,
    p_reason TEXT,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN jsonb_build_object('success', FALSE,
        'error', 'ERR_DOCUMENTS_REQUIRED: A return must name the documents to resubmit and a reason for each. Use return_driver_documents().');
END;
$$;

-- The driver resubmits what ONE affiliation asked for (the same thing resubmit_driver_documents does for all of them).
CREATE OR REPLACE FUNCTION public.resubmit_driver_application(
    p_affiliation_id UUID,
    p_submitted_documents JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_aff public.driver_toda_affiliation;
    v_types TEXT[];
BEGIN
    SELECT * INTO v_aff FROM public.driver_toda_affiliation WHERE affiliation_id = p_affiliation_id;
    IF v_aff.affiliation_id IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Affiliation not found.');
    END IF;
    IF v_aff.driver_id IS DISTINCT FROM public.get_current_driver_id() THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Access Denied: You may only resubmit for your own account.');
    END IF;
    IF NOT (v_aff.toda_endorsement_status = 'Resubmission Required' OR v_aff.lgu_verification_status = 'Resubmission Required') THEN
        RETURN jsonb_build_object('success', FALSE,
            'error', 'Only applications marked Resubmission Required can be resubmitted. Approved or Rejected records cannot be reset.');
    END IF;
    SELECT COALESCE(array_agg(DISTINCT r.document_type), ARRAY[]::TEXT[]) INTO v_types
      FROM public._driver_open_returns(v_aff.driver_id) r WHERE r.affiliation_id = p_affiliation_id;
    RETURN public.resubmit_driver_documents(v_types);
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. Privileges (explicit: nothing is granted by default since 20261008000003)
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.return_driver_documents(UUID, JSONB, TEXT, TEXT[]),
                       public.resubmit_driver_documents(TEXT[]),
                       public.get_affiliation_document_reviews(UUID[]),
                       public.get_my_application_review(),
                       public.return_driver_affiliation(UUID, TEXT, TEXT),
                       public.resubmit_driver_application(UUID, JSONB),
                       public.document_review_history_guard()
       FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_driver_documents(UUID, JSONB, TEXT, TEXT[]),
                          public.resubmit_driver_documents(TEXT[]),
                          public.get_affiliation_document_reviews(UUID[]),
                          public.get_my_application_review(),
                          public.return_driver_affiliation(UUID, TEXT, TEXT),
                          public.resubmit_driver_application(UUID, JSONB)
       TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.document_review_history_guard() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.document_review_history_guard() TO service_role;

-- ----------------------------------------------------------------------------
-- 9. Realtime: the Driver app listens to the affiliation and the document tables (best effort; a database without the
--    supabase_realtime publication, or one that publishes every table already, is left as it is)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    t TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        FOREACH t IN ARRAY ARRAY['driver_toda_affiliation', 'driver_document'] LOOP
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
                    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
                END IF;
            EXCEPTION WHEN OTHERS THEN
                RAISE NOTICE 'realtime: could not add % (%)', t, SQLERRM;
            END;
        END LOOP;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 10. SELF-CHECK
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.driver_document'::regclass)
       OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.document_review_history'::regclass) THEN
        RAISE EXCEPTION 'row level security is not enabled on the document tables';
    END IF;
    IF has_table_privilege('authenticated', 'public.driver_document', 'INSERT')
       OR has_table_privilege('authenticated', 'public.driver_document', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.driver_document', 'DELETE')
       OR has_table_privilege('authenticated', 'public.document_review_history', 'INSERT')
       OR has_table_privilege('authenticated', 'public.document_review_history', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.document_review_history', 'DELETE')
       OR has_table_privilege('anon', 'public.driver_document', 'SELECT')
       OR has_table_privilege('anon', 'public.document_review_history', 'SELECT') THEN
        RAISE EXCEPTION 'the document tables are writable by a client role, or readable by anon';
    END IF;
    IF has_function_privilege('anon', 'public.return_driver_documents(uuid, jsonb, text, text[])', 'EXECUTE')
       OR has_function_privilege('anon', 'public.resubmit_driver_documents(text[])', 'EXECUTE')
       OR has_function_privilege('anon', 'public.get_affiliation_document_reviews(uuid[])', 'EXECUTE')
       OR has_function_privilege('anon', 'public.get_my_application_review()', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public._driver_open_returns(uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public._open_returns_json(uuid, text[])', 'EXECUTE') THEN
        RAISE EXCEPTION 'a document-return function is executable by the wrong role';
    END IF;
    IF NOT (has_function_privilege('authenticated', 'public.return_driver_documents(uuid, jsonb, text, text[])', 'EXECUTE')
        AND has_function_privilege('authenticated', 'public.resubmit_driver_documents(text[])', 'EXECUTE')
        AND has_function_privilege('authenticated', 'public.get_affiliation_document_reviews(uuid[])', 'EXECUTE')
        AND has_function_privilege('authenticated', 'public.get_my_application_review()', 'EXECUTE')
        AND has_function_privilege('authenticated', 'public.rls_affiliation_in_my_toda(uuid)', 'EXECUTE')) THEN
        RAISE EXCEPTION 'a signed-in user cannot execute a document-return function they need';
    END IF;
END $$;
