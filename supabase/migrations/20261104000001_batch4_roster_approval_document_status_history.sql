-- ============================================================================
-- BATCH 4: LGU approval of new Master Roster members, document statuses that follow the decisions, and a verification history per driver
-- ============================================================================
-- 1. A driver who is added to a TODA's Master Roster after the registration roster file (typed in, from an updated file, or an entry whose franchise number was changed)
--    does not count as "on the roster" until the LGU approves the entry. The roster the LGU accredited (the registration file) is never asked again.
--      toda_roster_entry.approval_status   Pending / Approved / Rejected (a rejected entry is kept, with the LGU's reason; correcting it sends it back to Pending)
--      approval_basis                      original_roster (the registration file), lgu_decision (the LGU approved or rejected it), prior_verification (the member had been verified by
--                                          the LGU before this step existed), reinstated (a member who left and came back keeps what the LGU decided before)
--      approval_decided_at / _by / _by_name / approval_reason   who decided, when and why (recorded at the moment of the decision, never invented afterwards)
--    affiliation_roster_check            "matched" only counts an APPROVED entry; two new reasons: entry_pending_lgu, entry_rejected_lgu
--    add_toda_roster_entry / import_toda_roster (updated file) / update_toda_roster_entry / reinstate_toda_roster_entry   follow the rule; the LGU is told once per new member
--    decide_toda_roster_entry            the LGU approves or rejects (a reason of 10 characters is required to reject); audited; the TODA is told; roster-mismatch flags that the
--                                        approval settles are resolved
--    get_toda_roster_summary             also counts the entries waiting for the LGU and the rejected ones
-- 2. get_affiliation_document_approvals   per application and document: pending, endorsed (the TODA inspected it), verified (the LGU verified the application) or resubmitted (the
--    driver replaced it after the last decision). A document replaced after a decision is never shown as approved, and a document that was resubmitted before the decision no
--    longer shows "Resubmitted (Awaiting Review)" once the application is endorsed or verified.
-- 3. get_driver_verification_history      what really happened to a driver's verification, from the records the existing workflow already writes (audit log, document return history,
--    the application and roster records): event, exact time, who (TODA or LGU, or the driver) and the outcome. Nothing is estimated.
-- Forward-only. Safe to run twice.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The approval columns, and what existing entries are
-- ----------------------------------------------------------------------------
DO $approval$
DECLARE
    v_new BOOLEAN := NOT EXISTS (SELECT 1 FROM information_schema.columns
                                  WHERE table_schema = 'public' AND table_name = 'toda_roster_entry' AND column_name = 'approval_status');
BEGIN
    ALTER TABLE public.toda_roster_entry
        ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'Approved',
        ADD COLUMN IF NOT EXISTS approval_basis TEXT,
        ADD COLUMN IF NOT EXISTS approval_decided_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS approval_decided_by UUID,
        ADD COLUMN IF NOT EXISTS approval_decided_by_name TEXT,
        ADD COLUMN IF NOT EXISTS approval_reason TEXT;

    ALTER TABLE public.toda_roster_entry DROP CONSTRAINT IF EXISTS toda_roster_entry_approval_status_check;
    ALTER TABLE public.toda_roster_entry ADD CONSTRAINT toda_roster_entry_approval_status_check CHECK (approval_status IN ('Pending', 'Approved', 'Rejected'));
    ALTER TABLE public.toda_roster_entry DROP CONSTRAINT IF EXISTS toda_roster_entry_approval_basis_check;
    ALTER TABLE public.toda_roster_entry ADD CONSTRAINT toda_roster_entry_approval_basis_check
        CHECK (approval_basis IS NULL OR approval_basis IN ('original_roster', 'lgu_decision', 'prior_verification', 'reinstated'));
    ALTER TABLE public.toda_roster_entry DROP CONSTRAINT IF EXISTS toda_roster_entry_approval_consistent;
    ALTER TABLE public.toda_roster_entry ADD CONSTRAINT toda_roster_entry_approval_consistent
        CHECK ((approval_status <> 'Pending' OR approval_decided_at IS NULL)
           AND (approval_status <> 'Rejected' OR (approval_reason IS NOT NULL AND approval_decided_at IS NOT NULL)));

    IF v_new THEN
        -- the roster file the TODA registered with was accredited by the LGU: it is the original roster
        UPDATE public.toda_roster_entry SET approval_status = 'Approved', approval_basis = 'original_roster' WHERE source = 'registration_file';

        -- a member added later whose driver the LGU had ALREADY verified for this TODA: the LGU's verification stands (its own date), no new approval is asked
        UPDATE public.toda_roster_entry r
           SET approval_status = 'Approved', approval_basis = 'prior_verification',
               approval_decided_at = v.verified_at
          FROM (SELECT a.toda_id, regexp_replace(upper(COALESCE(d.franchise_number, '')), '[^A-Z0-9]', '', 'g') AS nf, max(a.lgu_verified_at) AS verified_at
                  FROM public.driver_toda_affiliation a JOIN public.driver d ON d.driver_id = a.driver_id
                 WHERE a.lgu_verification_status = 'Approved' AND a.lgu_verified_at IS NOT NULL
                 GROUP BY a.toda_id, regexp_replace(upper(COALESCE(d.franchise_number, '')), '[^A-Z0-9]', '', 'g')) v
         WHERE r.source <> 'registration_file' AND v.nf <> '' AND r.toda_id = v.toda_id AND r.normalized_franchise = v.nf;

        -- every other later member waits for the LGU
        UPDATE public.toda_roster_entry SET approval_status = 'Pending'
         WHERE source <> 'registration_file' AND approval_basis IS NULL;
    END IF;
END
$approval$;

CREATE INDEX IF NOT EXISTS idx_toda_roster_entry_pending ON public.toda_roster_entry (toda_id) WHERE approval_status = 'Pending' AND status = 'Active';

-- one line for the audit text and the notices
CREATE OR REPLACE FUNCTION public._roster_pending_notice(p_toda_id UUID, p_toda_name TEXT, p_what TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public._portal_notify('lgu_admin', 'ROSTER_ENTRY_PENDING_LGU', p_toda_name || ': a roster member needs approval', p_what,
                                  p_toda_id::TEXT, public._portal_notice_seq('lgu_admin', 'ROSTER_ENTRY_PENDING_LGU', p_toda_id::TEXT));
END;
$$;

-- ----------------------------------------------------------------------------
-- 1b. The roster check, and the functions that add, correct, bring back or import members (each is the 20261031000005 definition plus the approval rule)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.affiliation_roster_check(p_affiliation_id UUID)
RETURNS TABLE (
    roster_matched BOOLEAN,
    reason_code TEXT,
    driver_franchise TEXT,
    entry_member_name TEXT,
    entry_franchise TEXT,
    entry_plate TEXT,
    entry_counted_from TIMESTAMPTZ,
    application_submitted_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_aff public.driver_toda_affiliation;
    v_franchise TEXT;
    v_plate TEXT;
    v_nf TEXT;
    v_np TEXT;
    v_entry RECORD;
BEGIN
    SELECT * INTO v_aff FROM public.driver_toda_affiliation a WHERE a.affiliation_id = p_affiliation_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- what the driver SUBMITTED (the verification record), else what the driver record holds
    SELECT COALESCE(NULLIF(btrim(v.submitted_franchise_number), ''), NULLIF(btrim(d.franchise_number), '')),
           COALESCE(NULLIF(btrim(v.submitted_plate_number), ''), NULLIF(btrim(d.plate_number), ''))
      INTO v_franchise, v_plate
      FROM public.driver d
      LEFT JOIN LATERAL (
            SELECT x.submitted_franchise_number, x.submitted_plate_number
              FROM public.driver_verification x WHERE x.driver_id = d.driver_id LIMIT 1) v ON TRUE
     WHERE d.driver_id = v_aff.driver_id;

    v_nf := regexp_replace(upper(COALESCE(v_franchise, '')), '[^A-Z0-9]', '', 'g');
    v_np := regexp_replace(upper(COALESCE(v_plate, '')), '[^A-Z0-9]', '', 'g');

    IF v_nf = '' THEN
        RETURN QUERY SELECT FALSE, 'no_franchise'::TEXT, v_franchise, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ, v_aff.submitted_at;
        RETURN;
    END IF;

    -- an entry that counts: this TODA's, the same franchise number, in place at or before the application
    SELECT r.member_name AS member_name, r.franchise_number AS franchise_number, r.plate_number AS plate_number,
           GREATEST(r.created_at, COALESCE(r.identifiers_changed_at, r.created_at)) AS counted_from
      INTO v_entry
      FROM public.toda_roster_entry r
     WHERE r.toda_id = v_aff.toda_id
       AND r.normalized_franchise = v_nf
       AND GREATEST(r.created_at, COALESCE(r.identifiers_changed_at, r.created_at)) <= v_aff.submitted_at
       -- D-P9: a member counts if he was still on the roster when the application was submitted (marked as left later does not undo it)
       AND (r.status = 'Active' OR r.left_at > v_aff.submitted_at)
       -- Batch 4: an entry added after the registration roster file counts only once the LGU has approved it
       AND r.approval_status = 'Approved'
     ORDER BY GREATEST(r.created_at, COALESCE(r.identifiers_changed_at, r.created_at))
     LIMIT 1;
    IF FOUND THEN
        RETURN QUERY SELECT TRUE, 'matched'::TEXT, v_franchise, v_entry.member_name, v_entry.franchise_number, v_entry.plate_number,
                            v_entry.counted_from, v_aff.submitted_at;
        RETURN;
    END IF;

    -- Batch 4: the member is on the roster, but the LGU has not approved the entry yet (or did not approve it): it does not count
    SELECT r.member_name AS member_name, r.franchise_number AS franchise_number, r.plate_number AS plate_number,
           GREATEST(r.created_at, COALESCE(r.identifiers_changed_at, r.created_at)) AS counted_from, r.approval_status AS approval_status
      INTO v_entry
      FROM public.toda_roster_entry r
     WHERE r.toda_id = v_aff.toda_id
       AND r.normalized_franchise = v_nf
       AND r.status = 'Active'
       AND r.approval_status IN ('Pending', 'Rejected')
     ORDER BY GREATEST(r.created_at, COALESCE(r.identifiers_changed_at, r.created_at)) DESC
     LIMIT 1;
    IF FOUND THEN
        RETURN QUERY SELECT FALSE, CASE WHEN v_entry.approval_status = 'Rejected' THEN 'entry_rejected_lgu' ELSE 'entry_pending_lgu' END::TEXT, v_franchise,
                            v_entry.member_name, v_entry.franchise_number, v_entry.plate_number, v_entry.counted_from, v_aff.submitted_at;
        RETURN;
    END IF;

    -- the same franchise number, but only since AFTER the application: it does not count
    SELECT r.member_name AS member_name, r.franchise_number AS franchise_number, r.plate_number AS plate_number,
           GREATEST(r.created_at, COALESCE(r.identifiers_changed_at, r.created_at)) AS counted_from
      INTO v_entry
      FROM public.toda_roster_entry r
     WHERE r.toda_id = v_aff.toda_id
       AND r.normalized_franchise = v_nf
       AND GREATEST(r.created_at, COALESCE(r.identifiers_changed_at, r.created_at)) > v_aff.submitted_at
     ORDER BY GREATEST(r.created_at, COALESCE(r.identifiers_changed_at, r.created_at)) DESC
     LIMIT 1;
    IF FOUND THEN
        RETURN QUERY SELECT FALSE, 'entry_added_later'::TEXT, v_franchise, v_entry.member_name, v_entry.franchise_number, v_entry.plate_number,
                            v_entry.counted_from, v_aff.submitted_at;
        RETURN;
    END IF;

    -- D-P9: the franchise number is on the roster, but the member had been marked as LEFT before the application was submitted (entry_counted_from carries the date he left)
    SELECT r.member_name AS member_name, r.franchise_number AS franchise_number, r.plate_number AS plate_number, r.left_at AS counted_from
      INTO v_entry
      FROM public.toda_roster_entry r
     WHERE r.toda_id = v_aff.toda_id
       AND r.normalized_franchise = v_nf
       AND r.status = 'Left'
       AND r.left_at <= v_aff.submitted_at
     ORDER BY r.left_at DESC
     LIMIT 1;
    IF FOUND THEN
        RETURN QUERY SELECT FALSE, 'entry_left'::TEXT, v_franchise, v_entry.member_name, v_entry.franchise_number, v_entry.plate_number,
                            v_entry.counted_from, v_aff.submitted_at;
        RETURN;
    END IF;

    -- the plate number is on the roster under another franchise number: a hint for the reviewer, not a match
    IF v_np <> '' THEN
        SELECT r.member_name AS member_name, r.franchise_number AS franchise_number, r.plate_number AS plate_number,
               GREATEST(r.created_at, COALESCE(r.identifiers_changed_at, r.created_at)) AS counted_from
          INTO v_entry
          FROM public.toda_roster_entry r
         WHERE r.toda_id = v_aff.toda_id
           AND r.normalized_plate = v_np
           AND r.status = 'Active'
         ORDER BY GREATEST(r.created_at, COALESCE(r.identifiers_changed_at, r.created_at)) DESC
         LIMIT 1;
        IF FOUND THEN
            RETURN QUERY SELECT FALSE, 'plate_only'::TEXT, v_franchise, v_entry.member_name, v_entry.franchise_number, v_entry.plate_number,
                                v_entry.counted_from, v_aff.submitted_at;
            RETURN;
        END IF;
    END IF;

    RETURN QUERY SELECT FALSE, 'no_entry'::TEXT, v_franchise, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ, v_aff.submitted_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_toda_roster_entry(
    p_member_name TEXT,
    p_franchise_number TEXT,
    p_plate_number TEXT,
    p_membership_number TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_toda      UUID := public.get_current_toda_admin_toda_id();
    v_toda_name TEXT;
    v_status    TEXT;
    v_name      TEXT := public._roster_text(p_member_name, 120);
    v_fr        TEXT := public._roster_text(p_franchise_number, 40);
    v_pl        TEXT := public._roster_text(p_plate_number, 20);
    v_mem       TEXT := public._roster_text(p_membership_number, 40);
    v_entry     public.toda_roster_entry;
BEGIN
    IF v_toda IS NULL OR NOT public.is_toda_admin() THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_TODA_ADMIN', 'error', 'Only a TODA administrator can add a roster member.');
    END IF;
    SELECT t.toda_name, t.toda_status INTO v_toda_name, v_status FROM public.toda t WHERE t.toda_id = v_toda;
    IF v_status IS DISTINCT FROM 'Active' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_TODA_NOT_ACTIVE', 'error', 'The Master Roster can be changed only while the TODA is accredited (Active).');
    END IF;
    IF v_name IS NULL OR length(v_name) < 2 THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_NAME', 'error', 'The driver''s full name is required (2 to 120 characters).');
    END IF;
    IF v_fr IS NULL OR public._roster_normalize(v_fr) = '' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_FRANCHISE', 'error', 'The franchise number is required (letters or numbers, up to 40 characters): it is what the roster check compares.');
    END IF;
    IF v_pl IS NULL OR public._roster_normalize(v_pl) = '' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_PLATE', 'error', 'The plate number is required for a member you add yourself (up to 20 characters): it ties the franchise to the tricycle.');
    END IF;
    IF NULLIF(btrim(COALESCE(p_membership_number, '')), '') IS NOT NULL AND v_mem IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_MEMBERSHIP', 'error', 'The membership number can be up to 40 characters.');
    END IF;
    IF EXISTS (SELECT 1 FROM public.toda_roster_entry r WHERE r.toda_id = v_toda AND r.status = 'Active' AND r.normalized_franchise = public._roster_normalize(v_fr)) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_DUPLICATE', 'error', 'A member with that franchise number is already on the roster. Edit that entry instead.');
    END IF;

    INSERT INTO public.toda_roster_entry (toda_id, member_name, franchise_number, plate_number, membership_number, source, added_by, approval_status)
    VALUES (v_toda, v_name, v_fr, v_pl, v_mem, 'manual', auth.uid(), 'Pending')
    RETURNING * INTO v_entry;

    PERFORM public.record_policy_audit('TODA_ROSTER_ENTRY_ADDED', v_toda::TEXT, v_toda_name, 'Membership',
        'Added ' || v_name || ' to the Master Roster (franchise ' || v_fr || ', plate ' || v_pl || '). The member counts once the LGU approves the entry.', NULL,
        jsonb_build_object('member_name', v_name, 'franchise_number', v_fr, 'plate_number', v_pl, 'membership_number', v_mem));

    PERFORM public._roster_pending_notice(v_toda, v_toda_name, v_name || ' (franchise ' || v_fr || ') was added to the Master Roster of ' || v_toda_name || ' and waits for the LGU''s approval.');

    RETURN jsonb_build_object('success', TRUE, 'entry', to_jsonb(v_entry));
END;
$$;

CREATE OR REPLACE FUNCTION public.update_toda_roster_entry(
    p_entry_id UUID,
    p_member_name TEXT,
    p_franchise_number TEXT,
    p_plate_number TEXT DEFAULT NULL,
    p_membership_number TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_toda      UUID := public.get_current_toda_admin_toda_id();
    v_old       public.toda_roster_entry;
    v_name      TEXT := public._roster_text(p_member_name, 120);
    v_fr        TEXT := public._roster_text(p_franchise_number, 40);
    v_pl        TEXT := public._roster_text(p_plate_number, 20);
    v_mem       TEXT;
    v_toda_name TEXT;
    v_reset     BOOLEAN;
BEGIN
    IF v_toda IS NULL OR NOT public.is_toda_admin() THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_TODA_ADMIN', 'error', 'Only a TODA administrator can update the roster.');
    END IF;
    SELECT * INTO v_old FROM public.toda_roster_entry WHERE entry_id = p_entry_id AND toda_id = v_toda FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_NOT_FOUND', 'error', 'That roster entry was not found.');
    END IF;
    IF v_old.status = 'Left' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_LEFT', 'error', 'This member has left. Reinstate him first if he is back.');
    END IF;
    IF v_name IS NULL OR length(v_name) < 2 THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_TEXT', 'error', 'The member name must be 2 to 120 characters.');
    END IF;
    IF v_fr IS NULL OR public._roster_normalize(v_fr) = '' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_TEXT', 'error', 'The franchise number is required (up to 40 characters) and needs letters or numbers; the plate number can be up to 20.');
    END IF;
    IF NULLIF(btrim(COALESCE(p_plate_number, '')), '') IS NOT NULL AND v_pl IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_TEXT', 'error', 'The plate number can be up to 20 characters.');
    END IF;
    -- NULL leaves the membership number as it is; an empty text clears it
    IF p_membership_number IS NULL THEN
        v_mem := v_old.membership_number;
    ELSE
        v_mem := public._roster_text(p_membership_number, 40);
        IF NULLIF(btrim(p_membership_number), '') IS NOT NULL AND v_mem IS NULL THEN
            RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_MEMBERSHIP', 'error', 'The membership number can be up to 40 characters.');
        END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM public.toda_roster_entry r
                WHERE r.toda_id = v_toda AND r.entry_id <> p_entry_id AND r.status = 'Active' AND r.normalized_franchise = public._roster_normalize(v_fr)) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_DUPLICATE', 'error', 'Another roster entry of this TODA already has that franchise number.');
    END IF;

    IF v_name IS NOT DISTINCT FROM v_old.member_name AND v_fr IS NOT DISTINCT FROM v_old.franchise_number
       AND v_pl IS NOT DISTINCT FROM v_old.plate_number AND v_mem IS NOT DISTINCT FROM v_old.membership_number THEN
        RETURN jsonb_build_object('success', TRUE, 'changed', FALSE);
    END IF;

    -- Batch 4: a rejected entry that is corrected is sent to the LGU again; a franchise number that is changed is a different member, so the earlier approval does not carry over
    v_reset := v_old.approval_status = 'Rejected'
               OR (v_old.approval_status = 'Approved' AND public._roster_normalize(v_fr) IS DISTINCT FROM v_old.normalized_franchise);

    UPDATE public.toda_roster_entry
       SET member_name = v_name, franchise_number = v_fr, plate_number = v_pl, membership_number = v_mem,
           approval_status = CASE WHEN v_reset THEN 'Pending' ELSE approval_status END,
           approval_basis = CASE WHEN v_reset THEN NULL ELSE approval_basis END,
           approval_decided_at = CASE WHEN v_reset THEN NULL ELSE approval_decided_at END,
           approval_decided_by = CASE WHEN v_reset THEN NULL ELSE approval_decided_by END,
           approval_decided_by_name = CASE WHEN v_reset THEN NULL ELSE approval_decided_by_name END,
           approval_reason = CASE WHEN v_reset THEN NULL ELSE approval_reason END
     WHERE entry_id = p_entry_id;

    SELECT t.toda_name INTO v_toda_name FROM public.toda t WHERE t.toda_id = v_toda;
    PERFORM public.record_policy_audit('TODA_ROSTER_ENTRY_UPDATED', v_toda::TEXT, v_toda_name, 'Membership',
        'Updated the roster entry of ' || v_name || '.' || CASE WHEN v_reset THEN ' It was sent to the LGU for approval again.' ELSE '' END,
        jsonb_build_object('member_name', v_old.member_name, 'franchise_number', v_old.franchise_number, 'plate_number', v_old.plate_number, 'membership_number', v_old.membership_number,
                           'approval_status', v_old.approval_status, 'approval_reason', v_old.approval_reason),
        jsonb_build_object('member_name', v_name, 'franchise_number', v_fr, 'plate_number', v_pl, 'membership_number', v_mem,
                           'approval_status', CASE WHEN v_reset THEN 'Pending' ELSE v_old.approval_status END));
    IF v_reset THEN
        PERFORM public._roster_pending_notice(v_toda, v_toda_name, v_name || ' (franchise ' || v_fr || ') on the Master Roster of ' || v_toda_name || ' was corrected and waits for the LGU''s approval.');
    END IF;

    RETURN jsonb_build_object('success', TRUE, 'changed', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.reinstate_toda_roster_entry(p_entry_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_toda      UUID := public.get_current_toda_admin_toda_id();
    v_old       public.toda_roster_entry;
    v_new       public.toda_roster_entry;
    v_toda_name TEXT;
BEGIN
    IF v_toda IS NULL OR NOT public.is_toda_admin() THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_TODA_ADMIN', 'error', 'Only a TODA administrator can change the roster.');
    END IF;
    SELECT * INTO v_old FROM public.toda_roster_entry WHERE entry_id = p_entry_id AND toda_id = v_toda FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_NOT_FOUND', 'error', 'That roster entry was not found.');
    END IF;
    IF v_old.status <> 'Left' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_NOT_LEFT', 'error', 'This member is not marked as left.');
    END IF;
    IF EXISTS (SELECT 1 FROM public.toda_roster_entry r WHERE r.toda_id = v_toda AND r.entry_id <> p_entry_id AND r.status = 'Active' AND r.normalized_franchise = v_old.normalized_franchise) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_DUPLICATE', 'error', 'Another active member already has that franchise number.');
    END IF;

    -- he counts again from NOW, like a new entry: the old entry stays as the history of his earlier membership (marked Left), and a NEW entry is made. An application submitted while
    -- he was away therefore does not become "found" (the check sees an entry added after it).
    INSERT INTO public.toda_roster_entry (toda_id, member_name, franchise_number, plate_number, membership_number, source, added_by,
                                         approval_status, approval_basis, approval_decided_at, approval_decided_by, approval_decided_by_name, approval_reason)
    VALUES (v_toda, v_old.member_name, v_old.franchise_number, v_old.plate_number, v_old.membership_number, 'manual', auth.uid(),
            v_old.approval_status, v_old.approval_basis, v_old.approval_decided_at, v_old.approval_decided_by, v_old.approval_decided_by_name, v_old.approval_reason)
    RETURNING * INTO v_new;

    SELECT t.toda_name INTO v_toda_name FROM public.toda t WHERE t.toda_id = v_toda;
    PERFORM public.record_policy_audit('TODA_ROSTER_ENTRY_REINSTATED', v_toda::TEXT, v_toda_name, 'Membership',
        'Put ' || v_old.member_name || ' (franchise ' || COALESCE(v_old.franchise_number, '-') || ') back on the roster.',
        jsonb_build_object('status', 'Left'), jsonb_build_object('status', 'Active'));
    IF v_new.approval_status = 'Pending' THEN
        PERFORM public._roster_pending_notice(v_toda, v_toda_name, v_old.member_name || ' (franchise ' || COALESCE(v_old.franchise_number, '-') || ') is back on the Master Roster of ' || v_toda_name || ' and waits for the LGU''s approval.');
    END IF;
    RETURN jsonb_build_object('success', TRUE, 'entry', to_jsonb(v_new));
END;
$$;

CREATE OR REPLACE FUNCTION public.import_toda_roster(p_entries JSONB, p_source TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_toda      UUID := public.get_current_toda_admin_toda_id();
    v_toda_name TEXT;
    v_item      JSONB;
    v_name      TEXT;
    v_fr        TEXT;
    v_pl        TEXT;
    v_nfr       TEXT;
    v_seen      TEXT[] := ARRAY[]::TEXT[];
    v_added     INT := 0;
    v_dup       INT := 0;
    v_invalid   INT := 0;
    v_src       TEXT;
BEGIN
    IF v_toda IS NULL OR NOT public.is_toda_admin() THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_TODA_ADMIN',
            'error', 'Only a TODA administrator can import the roster.');
    END IF;
    IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) = 0 THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_IMPORT_EMPTY',
            'error', 'There are no roster rows to import.');
    END IF;
    IF jsonb_array_length(p_entries) > 500 THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_IMPORT_TOO_MANY',
            'error', 'At most 500 roster rows can be imported at a time.');
    END IF;

    -- where these entries come from: the first import of a TODA is its registration file; a later one is a new version of it (the browser says which)
    v_src := COALESCE(NULLIF(p_source, ''),
                      CASE WHEN EXISTS (SELECT 1 FROM public.toda_roster_entry x WHERE x.toda_id = v_toda) THEN 'file_update' ELSE 'registration_file' END);
    IF v_src NOT IN ('registration_file', 'file_update') THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_SOURCE', 'error', 'Unknown source for the imported entries.');
    END IF;

    FOR v_item IN SELECT e.value FROM jsonb_array_elements(p_entries) AS e LOOP
        IF jsonb_typeof(v_item) <> 'object' THEN
            v_invalid := v_invalid + 1;
            CONTINUE;
        END IF;

        v_name := btrim(regexp_replace(regexp_replace(COALESCE(v_item->>'member_name', ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g'));
        v_fr   := NULLIF(btrim(regexp_replace(regexp_replace(COALESCE(v_item->>'franchise_number', ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), '');
        v_pl   := NULLIF(btrim(regexp_replace(regexp_replace(COALESCE(v_item->>'plate_number', ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), '');
        v_nfr  := regexp_replace(upper(COALESCE(v_fr, '')), '[^A-Z0-9]', '', 'g');

        IF length(v_name) < 2 OR length(v_name) > 120
           OR v_fr IS NULL OR length(v_fr) > 40 OR v_nfr = ''
           OR (v_pl IS NOT NULL AND length(v_pl) > 20) THEN
            v_invalid := v_invalid + 1;
            CONTINUE;
        END IF;

        IF v_nfr = ANY (v_seen)
           OR EXISTS (SELECT 1 FROM public.toda_roster_entry r WHERE r.toda_id = v_toda AND r.normalized_franchise = v_nfr AND r.status = 'Active') THEN
            v_dup := v_dup + 1;
            CONTINUE;
        END IF;

        INSERT INTO public.toda_roster_entry (toda_id, member_name, franchise_number, plate_number, membership_number, source, added_by, approval_status, approval_basis)
        VALUES (v_toda, v_name, v_fr, v_pl, NULLIF(left(btrim(COALESCE(v_item->>'membership_number', '')), 40), ''), v_src, auth.uid(),
                CASE WHEN v_src = 'registration_file' THEN 'Approved' ELSE 'Pending' END, CASE WHEN v_src = 'registration_file' THEN 'original_roster' END);
        v_seen := v_seen || v_nfr;
        v_added := v_added + 1;
    END LOOP;

    IF v_added > 0 THEN
        SELECT t.toda_name INTO v_toda_name FROM public.toda t WHERE t.toda_id = v_toda;
        PERFORM public.record_policy_audit(
            'TODA_ROSTER_IMPORTED', v_toda::TEXT, v_toda_name, 'Membership',
            'Imported ' || v_added || ' master roster entries from the ' || CASE WHEN v_src = 'registration_file' THEN 'registration roster file' ELSE 'updated roster file' END || ' (' || v_dup || ' already on the roster, '
                || v_invalid || ' skipped).',
            NULL,
            jsonb_build_object('added', v_added, 'skipped_duplicate', v_dup, 'skipped_invalid', v_invalid));
        IF v_src = 'file_update' THEN
            PERFORM public._roster_pending_notice(v_toda, v_toda_name, v_added || ' new member' || CASE WHEN v_added = 1 THEN '' ELSE 's' END || ' from the updated roster file of ' || v_toda_name || ' wait' || CASE WHEN v_added = 1 THEN 's' ELSE '' END || ' for the LGU''s approval.');
        END IF;
    END IF;

    RETURN jsonb_build_object('success', TRUE, 'added', v_added, 'skipped_duplicate', v_dup, 'skipped_invalid', v_invalid);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_toda_roster_summary(p_toda_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_toda UUID;
    v_reg  RECORD;
BEGIN
    IF COALESCE(public.is_lgu_admin(), FALSE) THEN
        v_toda := p_toda_id;
    ELSE
        v_toda := public.get_current_toda_admin_toda_id();
        IF p_toda_id IS NOT NULL AND p_toda_id IS DISTINCT FROM v_toda THEN
            RETURN jsonb_build_object('found', FALSE);
        END IF;
    END IF;
    IF v_toda IS NULL THEN
        RETURN jsonb_build_object('found', FALSE);
    END IF;
    SELECT file_name, uploaded_at INTO v_reg FROM public.toda_roster_file_version WHERE toda_id = v_toda AND kind = 'registration' ORDER BY uploaded_at DESC LIMIT 1;
    RETURN jsonb_build_object(
        'found', TRUE,
        'registration_file', CASE WHEN v_reg.file_name IS NOT NULL THEN jsonb_build_object('file_name', v_reg.file_name, 'uploaded_at', v_reg.uploaded_at) END,
        'from_registration_file', (SELECT count(*) FROM public.toda_roster_entry r WHERE r.toda_id = v_toda AND r.source = 'registration_file'),
        'active', (SELECT count(*) FROM public.toda_roster_entry r WHERE r.toda_id = v_toda AND r.status = 'Active'),
        'added_later', (SELECT count(*) FROM public.toda_roster_entry r WHERE r.toda_id = v_toda AND r.status = 'Active' AND r.source <> 'registration_file'),
        'left', (SELECT count(*) FROM public.toda_roster_entry r WHERE r.toda_id = v_toda AND r.status = 'Left'),
        'pending_lgu', (SELECT count(*) FROM public.toda_roster_entry r WHERE r.toda_id = v_toda AND r.status = 'Active' AND r.approval_status = 'Pending'),
        'rejected_lgu', (SELECT count(*) FROM public.toda_roster_entry r WHERE r.toda_id = v_toda AND r.status = 'Active' AND r.approval_status = 'Rejected'),
        'edited', (SELECT count(*) FROM public.toda_roster_entry r WHERE r.toda_id = v_toda AND r.updated_at IS NOT NULL),
        'versions', COALESCE((SELECT jsonb_agg(jsonb_build_object('version_id', v.version_id, 'kind', v.kind, 'file_name', v.file_name, 'uploaded_at', v.uploaded_at, 'file_path', v.file_path)
                                               ORDER BY v.uploaded_at DESC)
                                FROM public.toda_roster_file_version v WHERE v.toda_id = v_toda), '[]'::jsonb));
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. The LGU decides on a new roster member
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decide_toda_roster_entry(p_entry_id UUID, p_decision TEXT, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_admin     public.lgu_admin;
    v_entry     public.toda_roster_entry;
    v_toda_name TEXT;
    v_decision  TEXT := lower(btrim(COALESCE(p_decision, '')));
    v_reason    TEXT := NULLIF(btrim(regexp_replace(COALESCE(p_reason, ''), '[[:cntrl:]]', ' ', 'g')), '');
    v_status    TEXT;
    v_flags     INTEGER := 0;
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_LGU_ADMIN', 'error', 'Only the LGU can approve or reject a new roster member.');
    END IF;
    IF v_decision NOT IN ('approve', 'reject') THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_DECISION', 'error', 'The decision must be approve or reject.');
    END IF;
    IF v_reason IS NOT NULL AND length(v_reason) > 500 THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_REASON', 'error', 'The reason can be up to 500 characters.');
    END IF;
    IF v_decision = 'reject' AND (v_reason IS NULL OR length(v_reason) < 10) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_REASON', 'error', 'Say why the member is not approved (at least 10 characters): the TODA is shown the reason.');
    END IF;

    SELECT * INTO v_admin FROM public.lgu_admin WHERE auth_user_id = auth.uid() AND account_status = 'Active';
    SELECT * INTO v_entry FROM public.toda_roster_entry WHERE entry_id = p_entry_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_NOT_FOUND', 'error', 'That roster entry was not found.');
    END IF;
    IF v_entry.status <> 'Active' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_LEFT', 'error', 'This member has left the TODA, so there is nothing to decide.');
    END IF;
    IF v_entry.approval_status <> 'Pending' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_NOT_PENDING',
            'error', 'This member was already ' || lower(v_entry.approval_status) || CASE WHEN v_entry.approval_basis = 'original_roster' THEN ' (he is on the roster the LGU accredited).' ELSE '.' END);
    END IF;

    v_status := CASE v_decision WHEN 'approve' THEN 'Approved' ELSE 'Rejected' END;
    UPDATE public.toda_roster_entry
       SET approval_status = v_status, approval_basis = 'lgu_decision', approval_decided_at = CURRENT_TIMESTAMP,
           approval_decided_by = auth.uid(), approval_decided_by_name = COALESCE(v_admin.full_name, 'LGU administrator'), approval_reason = v_reason
     WHERE entry_id = p_entry_id;

    SELECT t.toda_name INTO v_toda_name FROM public.toda t WHERE t.toda_id = v_entry.toda_id;
    PERFORM public.record_policy_audit(
        CASE WHEN v_status = 'Approved' THEN 'TODA_ROSTER_ENTRY_APPROVED' ELSE 'TODA_ROSTER_ENTRY_REJECTED' END,
        v_entry.toda_id::TEXT, v_toda_name, 'Membership',
        'The LGU ' || CASE WHEN v_status = 'Approved' THEN 'approved' ELSE 'did not approve' END || ' ' || v_entry.member_name || ' (franchise ' || COALESCE(v_entry.franchise_number, '-')
            || ') as a new member of the Master Roster of ' || v_toda_name || COALESCE('. Reason: ' || v_reason, '.'),
        jsonb_build_object('approval_status', 'Pending'),
        jsonb_build_object('approval_status', v_status, 'reason', v_reason, 'entry_id', p_entry_id, 'franchise_number', v_entry.franchise_number));

    PERFORM public._portal_notify('toda_' || v_entry.toda_id::TEXT, 'ROSTER_ENTRY_DECIDED',
        CASE WHEN v_status = 'Approved' THEN 'Roster member approved' ELSE 'Roster member not approved' END,
        v_entry.member_name || ' (franchise ' || COALESCE(v_entry.franchise_number, '-') || ') '
            || CASE WHEN v_status = 'Approved' THEN 'was approved by the LGU.' ELSE 'was not approved by the LGU. Reason: ' || v_reason || ' Correct the entry to send it again.' END,
        p_entry_id::TEXT, public._portal_notice_seq('toda_' || v_entry.toda_id::TEXT, 'ROSTER_ENTRY_DECIDED', p_entry_id::TEXT));

    -- an open roster-mismatch flag that this approval settles (the application now matches an approved entry) is resolved, with the reason on record
    IF v_status = 'Approved' THEN
        UPDATE public.admin_review_flag f
           SET status = 'Resolved', resolved_at = CURRENT_TIMESTAMP, resolved_by = auth.uid(),
               resolution = 'The LGU approved ' || v_entry.member_name || ' on the Master Roster of ' || v_toda_name || ', so the roster check now matches.'
         WHERE f.flag_type = 'ROSTER_MISMATCH' AND f.status IN ('Open', 'Under Review')
           AND EXISTS (SELECT 1 FROM public.driver_toda_affiliation a
                        WHERE a.affiliation_id::TEXT = f.subject_id AND a.toda_id = v_entry.toda_id AND public.affiliation_roster_matched(a.affiliation_id));
        GET DIAGNOSTICS v_flags = ROW_COUNT;
    END IF;

    RETURN jsonb_build_object('success', TRUE, 'approval_status', v_status, 'flags_resolved', v_flags);
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Document statuses that follow the decisions
-- ----------------------------------------------------------------------------
-- approval_state: verified (the LGU verified the application after the last time the document was replaced), endorsed (the TODA endorsed it after that), resubmitted (the driver replaced it
-- after the application was submitted and no decision has come since), pending (nothing since the application). awaiting_stage says whose turn it is.
CREATE OR REPLACE FUNCTION public.get_affiliation_document_approvals(p_affiliation_ids UUID[] DEFAULT NULL)
RETURNS TABLE (affiliation_id UUID, driver_id UUID, document_type TEXT, approval_state TEXT, decided_at TIMESTAMPTZ, decided_stage TEXT, changed_at TIMESTAMPTZ, awaiting_stage TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    WITH vis AS (
        SELECT a.affiliation_id AS aff, a.driver_id AS drv, a.submitted_at AS sub, a.toda_endorsement_status AS tstat, a.toda_endorsed_at AS tat,
               a.lgu_verification_status AS lstat, a.lgu_verified_at AS lat
          FROM public.driver_toda_affiliation a
         WHERE (p_affiliation_ids IS NULL OR a.affiliation_id = ANY (p_affiliation_ids))
           AND (COALESCE(public.is_lgu_admin(), FALSE)
                OR (public.get_current_toda_admin_toda_id() IS NOT NULL AND a.toda_id = public.get_current_toda_admin_toda_id())
                OR (public.get_current_driver_id() IS NOT NULL AND a.driver_id = public.get_current_driver_id()))
    ), grid AS (
        SELECT v.*, d.t AS dtype,
               (SELECT max(s.created_at) FROM public.document_review_history s
                 WHERE s.driver_id = v.drv AND s.document_type = d.t AND s.event_type = 'Resubmitted' AND s.created_at >= v.sub) AS chg
          FROM vis v CROSS JOIN unnest(ARRAY['license', 'mtop', 'tricycle', 'selfie']) AS d(t)
    )
    SELECT g.aff, g.drv, g.dtype,
           CASE WHEN g.lstat = 'Approved' AND g.lat IS NOT NULL AND (g.chg IS NULL OR g.chg <= g.lat) THEN 'verified'
                WHEN g.tstat = 'Endorsed' AND g.tat IS NOT NULL AND (g.chg IS NULL OR g.chg <= g.tat) THEN 'endorsed'
                WHEN g.chg IS NOT NULL THEN 'resubmitted'
                ELSE 'pending' END,
           CASE WHEN g.lstat = 'Approved' AND g.lat IS NOT NULL AND (g.chg IS NULL OR g.chg <= g.lat) THEN g.lat
                WHEN g.tstat = 'Endorsed' AND g.tat IS NOT NULL AND (g.chg IS NULL OR g.chg <= g.tat) THEN g.tat END,
           CASE WHEN g.lstat = 'Approved' AND g.lat IS NOT NULL AND (g.chg IS NULL OR g.chg <= g.lat) THEN 'LGU'
                WHEN g.tstat = 'Endorsed' AND g.tat IS NOT NULL AND (g.chg IS NULL OR g.chg <= g.tat) THEN 'TODA' END,
           g.chg,
           CASE WHEN g.lstat = 'Approved' AND g.lat IS NOT NULL AND (g.chg IS NULL OR g.chg <= g.lat) THEN NULL
                WHEN g.tstat = 'Endorsed' AND g.tat IS NOT NULL THEN 'LGU'
                ELSE 'TODA' END
      FROM grid g
     ORDER BY g.aff, array_position(ARRAY['license', 'mtop', 'tricycle', 'selfie'], g.dtype);
$$;

-- ----------------------------------------------------------------------------
-- 4. The verification history of one driver
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._actor_display_name(p_auth_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT COALESCE((SELECT x.full_name FROM public.lgu_admin x WHERE x.auth_user_id = p_auth_id),
                    (SELECT x.full_name FROM public.toda_admin x WHERE x.auth_user_id = p_auth_id),
                    (SELECT x.full_name FROM public.driver x WHERE x.auth_user_id = p_auth_id));
$$;

-- LGU: every event. A TODA administrator: only for a driver who applied to their TODA, and only the events of their own TODA's application (the driver's own acts too).
CREATE OR REPLACE FUNCTION public.get_driver_verification_history(p_driver_id UUID)
RETURNS TABLE (event_at TIMESTAMPTZ, event_key TEXT, label TEXT, actor_role TEXT, actor_name TEXT, toda_id UUID, toda_name TEXT, outcome TEXT, detail TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    WITH ctx AS (
        SELECT COALESCE(public.is_lgu_admin(), FALSE) AS lgu, public.get_current_toda_admin_toda_id() AS toda
    ), ok AS (
        SELECT c.lgu, c.toda FROM ctx c
         WHERE c.lgu OR (c.toda IS NOT NULL AND EXISTS (SELECT 1 FROM public.driver_toda_affiliation a WHERE a.driver_id = p_driver_id AND a.toda_id = c.toda))
    ), affs AS (
        SELECT a.affiliation_id AS aff, a.toda_id AS tid, t.toda_name AS tname, a.submitted_at AS sub
          FROM public.driver_toda_affiliation a JOIN public.toda t ON t.toda_id = a.toda_id CROSS JOIN ok
         WHERE a.driver_id = p_driver_id AND (ok.lgu OR a.toda_id = ok.toda)
    ), drv AS (
        -- the franchise number the roster check compares: what the driver SUBMITTED, else what the driver record holds
        SELECT d.driver_id AS did, d.full_name AS dname, d.created_at AS dcreated,
               regexp_replace(upper(COALESCE(NULLIF(btrim(v.submitted_franchise_number), ''), NULLIF(btrim(d.franchise_number), ''), '')), '[^A-Z0-9]', '', 'g') AS nf
          FROM public.driver d
          LEFT JOIN LATERAL (SELECT x.submitted_franchise_number FROM public.driver_verification x WHERE x.driver_id = d.driver_id LIMIT 1) v ON TRUE
         WHERE d.driver_id = p_driver_id
    ), ev AS (
        -- the driver's registration
        SELECT d.dcreated AS at, 'registered' AS k, 'Registered in SAKAY' AS lbl, 'driver' AS role, d.dname AS who, NULL::UUID AS tid, NULL::TEXT AS tname, 'Registered' AS outc, NULL::TEXT AS dtl
          FROM drv d CROSS JOIN ok
        UNION ALL
        -- an application to a TODA
        SELECT a.sub, 'submitted', 'Application submitted to ' || a.tname, 'driver', d.dname, a.tid, a.tname, 'Submitted', NULL
          FROM affs a CROSS JOIN drv d
        UNION ALL
        -- the stage decisions the workflow writes to the audit log
        SELECT l.performed_at,
               CASE l.action_type WHEN 'DRIVER_AFFILIATION_STAGE1_ENDORSED' THEN 'endorsed' WHEN 'DRIVER_AFFILIATION_STAGE2_VERIFIED' THEN 'verified'
                    WHEN 'DRIVER_ROSTER_MISMATCH_OVERRIDDEN' THEN 'verified_override' WHEN 'DRIVER_APPLICATION_RETURNED' THEN 'returned'
                    WHEN 'DRIVER_AFFILIATION_REJECTED' THEN 'rejected' ELSE 'resubmitted' END,
               CASE l.action_type WHEN 'DRIVER_AFFILIATION_STAGE1_ENDORSED' THEN 'Endorsed by ' || a.tname
                    WHEN 'DRIVER_AFFILIATION_STAGE2_VERIFIED' THEN 'Verified by the LGU'
                    WHEN 'DRIVER_ROSTER_MISMATCH_OVERRIDDEN' THEN 'Verified by the LGU despite a roster mismatch'
                    WHEN 'DRIVER_APPLICATION_RETURNED' THEN 'Application returned for correction'
                    WHEN 'DRIVER_AFFILIATION_REJECTED' THEN 'Application rejected'
                    ELSE 'Application resubmitted by the driver' END,
               COALESCE(l.actor_role, CASE l.action_type WHEN 'DRIVER_AFFILIATION_STAGE1_ENDORSED' THEN 'toda_admin' WHEN 'DRIVER_AFFILIATION_STAGE2_VERIFIED' THEN 'lgu_admin' END),
               COALESCE(public._actor_display_name(l.actor_id), CASE l.actor_role WHEN 'lgu_admin' THEN 'LGU administrator' WHEN 'toda_admin' THEN 'TODA administrator' END),
               a.tid, a.tname,
               CASE l.action_type WHEN 'DRIVER_AFFILIATION_STAGE1_ENDORSED' THEN 'Endorsed' WHEN 'DRIVER_AFFILIATION_STAGE2_VERIFIED' THEN 'Verified'
                    WHEN 'DRIVER_ROSTER_MISMATCH_OVERRIDDEN' THEN 'Verified (override)' WHEN 'DRIVER_APPLICATION_RETURNED' THEN 'Returned'
                    WHEN 'DRIVER_AFFILIATION_REJECTED' THEN 'Rejected' ELSE 'Resubmitted' END,
               CASE WHEN l.action_type IN ('DRIVER_AFFILIATION_REJECTED', 'DRIVER_APPLICATION_RETURNED', 'DRIVER_ROSTER_MISMATCH_OVERRIDDEN') THEN left(l.details, 600) END
          FROM affs a
          JOIN public.audit_log l ON l.target_id::TEXT = a.aff::TEXT
           AND l.action_type IN ('DRIVER_AFFILIATION_STAGE1_ENDORSED', 'DRIVER_AFFILIATION_STAGE2_VERIFIED', 'DRIVER_ROSTER_MISMATCH_OVERRIDDEN', 'DRIVER_APPLICATION_RETURNED',
                                 'DRIVER_AFFILIATION_REJECTED', 'DRIVER_APPLICATION_RESUBMITTED')
        UNION ALL
        -- one document returned (which stage, who, why) or replaced by the driver
        SELECT h.created_at,
               CASE h.event_type WHEN 'Returned' THEN 'doc_returned' ELSE 'doc_replaced' END,
               CASE h.event_type WHEN 'Returned' THEN 'Document returned for correction: ' ELSE 'Document replaced by the driver: ' END
                   || CASE h.document_type WHEN 'license' THEN 'driver''s license' WHEN 'mtop' THEN 'MTOP permit' WHEN 'tricycle' THEN 'tricycle photo' ELSE 'selfie' END,
               COALESCE(h.actor_role, CASE h.review_stage WHEN 'TODA' THEN 'toda_admin' WHEN 'LGU' THEN 'lgu_admin' ELSE 'driver' END),
               COALESCE(public._actor_display_name(h.actor_auth_id), CASE h.review_stage WHEN 'TODA' THEN 'TODA administrator' WHEN 'LGU' THEN 'LGU administrator' END),
               h.toda_id, (SELECT t.toda_name FROM public.toda t WHERE t.toda_id = h.toda_id),
               CASE h.event_type WHEN 'Returned' THEN 'Returned' ELSE 'Resubmitted' END,
               CASE h.event_type WHEN 'Returned' THEN left(h.reason, 600) END
          FROM public.document_review_history h CROSS JOIN ok
         WHERE h.driver_id = p_driver_id
           AND (h.event_type = 'Resubmitted' OR ok.lgu OR h.toda_id = ok.toda)
        UNION ALL
        -- a document renewal (the LGU's own queue)
        SELECT l.performed_at, CASE l.action_type WHEN 'DRIVER_DOCUMENT_RENEWAL_SUBMITTED' THEN 'renewal_submitted' ELSE 'renewal_decided' END,
               CASE l.action_type WHEN 'DRIVER_DOCUMENT_RENEWAL_SUBMITTED' THEN 'Document renewal submitted' ELSE 'Document renewal decided by the LGU' END,
               COALESCE(l.actor_role, 'driver'), COALESCE(public._actor_display_name(l.actor_id), CASE l.actor_role WHEN 'lgu_admin' THEN 'LGU administrator' END), NULL::UUID, NULL::TEXT,
               CASE WHEN l.action_type = 'DRIVER_DOCUMENT_RENEWAL_SUBMITTED' THEN 'Submitted' WHEN l.details ILIKE '%Approved%' THEN 'Approved' ELSE 'Rejected' END,
               CASE WHEN l.action_type = 'DRIVER_DOCUMENT_RENEWAL_VERIFIED' THEN left(l.details, 600) END
          FROM public.audit_log l CROSS JOIN ok
         WHERE ok.lgu AND l.target_id::TEXT = p_driver_id::TEXT AND l.action_type IN ('DRIVER_DOCUMENT_RENEWAL_SUBMITTED', 'DRIVER_DOCUMENT_RENEWAL_VERIFIED')
        UNION ALL
        -- the driver's place on the TODA's Master Roster, when it was added after the registration roster file: added by the TODA, then the LGU's decision
        SELECT r.created_at, 'roster_added', 'Added to the Master Roster of ' || a.tname, 'toda_admin',
               COALESCE(public._actor_display_name(r.added_by), 'TODA administrator'), a.tid, a.tname,
               CASE WHEN r.approval_basis = 'prior_verification' THEN 'Added' ELSE 'Awaiting LGU approval' END, NULL
          FROM affs a CROSS JOIN drv d
          JOIN public.toda_roster_entry r ON r.toda_id = a.tid AND r.normalized_franchise = d.nf AND d.nf <> '' AND r.source <> 'registration_file'
        UNION ALL
        SELECT r.approval_decided_at, 'roster_decided',
               CASE r.approval_status WHEN 'Approved' THEN 'Master Roster entry approved by the LGU' ELSE 'Master Roster entry not approved by the LGU' END,
               'lgu_admin', COALESCE(r.approval_decided_by_name, 'LGU administrator'), a.tid, a.tname, r.approval_status, left(r.approval_reason, 600)
          FROM affs a CROSS JOIN drv d
          JOIN public.toda_roster_entry r ON r.toda_id = a.tid AND r.normalized_franchise = d.nf AND d.nf <> ''
           AND r.approval_basis = 'lgu_decision' AND r.approval_decided_at IS NOT NULL
    )
    SELECT ev.at, ev.k, ev.lbl, ev.role, ev.who, ev.tid, ev.tname, ev.outc, ev.dtl
      FROM ev
     WHERE ev.at IS NOT NULL
     ORDER BY ev.at, ev.k;
$$;

-- ----------------------------------------------------------------------------
-- 5. Grants and a self-check
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.decide_toda_roster_entry(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_toda_roster_entry(UUID, TEXT, TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_affiliation_document_approvals(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_affiliation_document_approvals(UUID[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_driver_verification_history(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_driver_verification_history(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._actor_display_name(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._actor_display_name(UUID) TO service_role;
REVOKE ALL ON FUNCTION public._roster_pending_notice(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._roster_pending_notice(UUID, TEXT, TEXT) TO service_role;

DO $check$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'toda_roster_entry' AND column_name = 'approval_status') THEN
        RAISE EXCEPTION 'Batch 4: toda_roster_entry.approval_status is missing';
    END IF;
    IF EXISTS (SELECT 1 FROM public.toda_roster_entry WHERE source = 'registration_file' AND approval_status <> 'Approved') THEN
        RAISE EXCEPTION 'Batch 4: an entry of the registration roster file is not approved';
    END IF;
    IF has_function_privilege('anon', 'public.decide_toda_roster_entry(uuid,text,text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.get_driver_verification_history(uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.get_affiliation_document_approvals(uuid[])', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public._actor_display_name(uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public._roster_pending_notice(uuid,text,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'Batch 4: a function has the wrong grants';
    END IF;
END
$check$;
