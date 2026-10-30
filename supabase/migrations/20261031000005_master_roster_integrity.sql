-- ============================================================================
-- MASTER ROSTER INTEGRITY (owner's request, decisions D-P9 / D11 - D13)
-- ============================================================================
-- Three lists had drifted apart: the roster FILE a TODA submits at registration (20 drivers, what the LGU accredited), the Master Roster the roster check reads (22 after two
-- members were added), and the Driver Members list, which was rebuilt from the FILE and so never showed the two. The Master Roster could only grow (no way to say a member had
-- left), a member was added by a direct table insert (checked only by the browser, no unique number, the audit written by the browser) and a TODA could delete rows with no trace.
--
-- This makes the Master Roster the one living record, changed only through logged functions, and keeps the registration file as the evidence it is:
--
--   toda_roster_entry         new: membership_number (the TODA's own number for the member, optional), source (registration_file / manual / file_update), added_by, and status
--                             Active / Left with left_at, left_reason, left_by. One ACTIVE entry per franchise number per TODA (a unique index; duplicates that already exist are
--                             marked Left, keeping the earliest, and audited)
--   toda_roster_file_version  every roster file a TODA submitted: the registration file (version 1, never overwritten once the TODA is Active) and later updates (new dated
--                             versions, never a replacement). The TODA reconciles an update with its roster in the browser; the LGU is told it arrived (flag TODA_ROSTER_UPDATED)
--   add_toda_roster_entry     add a member: name and franchise number required, plate number required for an entry typed in (it binds the franchise to the vehicle; imported
--                             rows may lack it), a franchise number already Active is refused, audited
--   update_toda_roster_entry  the existing function with the membership number; a member who has left cannot be edited (reinstate first)
--   mark_toda_roster_entry_left / reinstate_toda_roster_entry   a member who left stops matching NEW applications (applications submitted while he was a member still count); a reason
--                             of at least 10 characters; reinstating makes a NEW entry (history kept), so he counts from that moment, like any new entry
--   import_toda_roster        the existing import, now recording the source (the first import is the registration file, a later one is an updated file) and the membership number
--   get_toda_roster_summary   "20 at registration, 22 now": what the TODA and the LGU read
--   affiliation_roster_check  the roster check, aware of the status; a new reason entry_left (the franchise number is on the roster but the member left before the application)
--   toda_submit_compliance_document   the roster-file branch as described above
--   the direct INSERT / UPDATE / DELETE policies on toda_roster_entry are dropped: every change goes through the functions (the server route uses the service role)
--
-- The timing rule (Requirement A5: an entry counts only if it existed before the application) is unchanged. Forward-only. Safe to run twice.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The roster entry: who, from where, still a member?
-- ----------------------------------------------------------------------------
ALTER TABLE public.toda_roster_entry
    ADD COLUMN IF NOT EXISTS membership_number TEXT,
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS added_by UUID,
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Active',
    ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS left_reason TEXT,
    ADD COLUMN IF NOT EXISTS left_by UUID;

ALTER TABLE public.toda_roster_entry DROP CONSTRAINT IF EXISTS toda_roster_entry_source_check;
ALTER TABLE public.toda_roster_entry ADD CONSTRAINT toda_roster_entry_source_check CHECK (source IN ('registration_file', 'manual', 'file_update'));
ALTER TABLE public.toda_roster_entry DROP CONSTRAINT IF EXISTS toda_roster_entry_status_check;
ALTER TABLE public.toda_roster_entry ADD CONSTRAINT toda_roster_entry_status_check CHECK (status IN ('Active', 'Left'));
ALTER TABLE public.toda_roster_entry DROP CONSTRAINT IF EXISTS toda_roster_entry_left_consistent;
ALTER TABLE public.toda_roster_entry ADD CONSTRAINT toda_roster_entry_left_consistent CHECK ((status = 'Left') = (left_at IS NOT NULL));

-- entries that came in with an import are the registration file's: an import entry is stamped within moments of its audit row
UPDATE public.toda_roster_entry e
   SET source = 'registration_file'
  FROM public.audit_log a
 WHERE a.action_type = 'TODA_ROSTER_IMPORTED'
   AND a.target_id = e.toda_id::TEXT
   AND abs(extract(epoch FROM (e.created_at - a.performed_at))) < 300
   AND e.source = 'manual';

-- one ACTIVE entry per franchise number per TODA: duplicates that already exist keep the earliest and the others are marked Left (never deleted), audited once
DO $dup$
DECLARE
    v_n INTEGER;
BEGIN
    WITH ranked AS (
        SELECT entry_id, row_number() OVER (PARTITION BY toda_id, normalized_franchise ORDER BY created_at, entry_id) AS rn
          FROM public.toda_roster_entry
         WHERE status = 'Active' AND normalized_franchise <> ''
    ), marked AS (
        UPDATE public.toda_roster_entry r
           SET status = 'Left', left_at = CURRENT_TIMESTAMP,
               left_reason = 'Duplicate franchise number: the earliest entry was kept (roster migration).'
          FROM ranked
         WHERE r.entry_id = ranked.entry_id AND ranked.rn > 1
        RETURNING r.entry_id
    )
    SELECT count(*) INTO v_n FROM marked;
    IF v_n > 0 THEN
        PERFORM public.record_policy_audit('TODA_ROSTER_DUPLICATES_MARKED', 'toda_roster_entry', NULL, 'Membership',
            v_n || ' duplicate roster entries (same franchise number in the same TODA) were marked as left; the earliest of each was kept.', NULL, NULL);
    END IF;
END
$dup$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_toda_roster_active_franchise
    ON public.toda_roster_entry (toda_id, normalized_franchise)
 WHERE status = 'Active' AND normalized_franchise <> '';

-- ----------------------------------------------------------------------------
-- 2. The roster files a TODA has submitted
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.toda_roster_file_version (
    version_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    toda_id       UUID NOT NULL REFERENCES public.toda(toda_id) ON DELETE CASCADE,
    kind          TEXT NOT NULL CHECK (kind IN ('registration', 'update')),
    file_path     TEXT NOT NULL,
    file_name     TEXT,
    uploaded_by   UUID,
    uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    superseded_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_toda_roster_file_version_toda ON public.toda_roster_file_version (toda_id, uploaded_at DESC);
ALTER TABLE public.toda_roster_file_version ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS toda_roster_file_version_select ON public.toda_roster_file_version;
CREATE POLICY toda_roster_file_version_select ON public.toda_roster_file_version FOR SELECT TO authenticated
    USING (COALESCE(public.is_lgu_admin(), FALSE) OR toda_id = public.get_current_toda_admin_toda_id());
REVOKE ALL ON public.toda_roster_file_version FROM PUBLIC, anon;
GRANT SELECT ON public.toda_roster_file_version TO authenticated;
GRANT ALL ON public.toda_roster_file_version TO service_role;

-- the roster file already on record is version 1
INSERT INTO public.toda_roster_file_version (toda_id, kind, file_path, file_name, uploaded_at)
SELECT t.toda_id, 'registration', t.accredited_drivers_url, regexp_replace(t.accredited_drivers_url, '^.*/', ''), t.created_at
  FROM public.toda t
 WHERE NULLIF(btrim(COALESCE(t.accredited_drivers_url, '')), '') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.toda_roster_file_version v WHERE v.toda_id = t.toda_id);

-- a TODA registered from now on starts with its file as version 1 (the registration function is not touched)
CREATE OR REPLACE FUNCTION public.toda_roster_file_version_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NULLIF(btrim(COALESCE(NEW.accredited_drivers_url, '')), '') IS NOT NULL THEN
        INSERT INTO public.toda_roster_file_version (toda_id, kind, file_path, file_name, uploaded_by)
        VALUES (NEW.toda_id, 'registration', NEW.accredited_drivers_url, regexp_replace(NEW.accredited_drivers_url, '^.*/', ''), auth.uid());
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_toda_roster_file_version_on_insert ON public.toda;
CREATE TRIGGER trigger_toda_roster_file_version_on_insert AFTER INSERT ON public.toda
    FOR EACH ROW EXECUTE FUNCTION public.toda_roster_file_version_on_insert();

-- ----------------------------------------------------------------------------
-- 3. Small helpers (internal)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._roster_text(p_value TEXT, p_max INTEGER)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $f$
    SELECT CASE WHEN length(t) > p_max THEN NULL ELSE NULLIF(t, '') END
      FROM (SELECT btrim(regexp_replace(regexp_replace(COALESCE(p_value, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')) AS t) x;
$f$;

CREATE OR REPLACE FUNCTION public._roster_normalize(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $f$
    SELECT regexp_replace(upper(COALESCE(p_value, '')), '[^A-Z0-9]', '', 'g');
$f$;

-- ----------------------------------------------------------------------------
-- 4. The roster check knows who has left
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
     ORDER BY GREATEST(r.created_at, COALESCE(r.identifiers_changed_at, r.created_at))
     LIMIT 1;
    IF FOUND THEN
        RETURN QUERY SELECT TRUE, 'matched'::TEXT, v_franchise, v_entry.member_name, v_entry.franchise_number, v_entry.plate_number,
                            v_entry.counted_from, v_aff.submitted_at;
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

-- ----------------------------------------------------------------------------
-- 5. The functions that change the roster
-- ----------------------------------------------------------------------------
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

    INSERT INTO public.toda_roster_entry (toda_id, member_name, franchise_number, plate_number, membership_number, source, added_by)
    VALUES (v_toda, v_name, v_fr, v_pl, v_mem, 'manual', auth.uid())
    RETURNING * INTO v_entry;

    PERFORM public.record_policy_audit('TODA_ROSTER_ENTRY_ADDED', v_toda::TEXT, v_toda_name, 'Membership',
        'Added ' || v_name || ' to the Master Roster (franchise ' || v_fr || ', plate ' || v_pl || ').', NULL,
        jsonb_build_object('member_name', v_name, 'franchise_number', v_fr, 'plate_number', v_pl, 'membership_number', v_mem));

    RETURN jsonb_build_object('success', TRUE, 'entry', to_jsonb(v_entry));
END;
$$;

DROP FUNCTION IF EXISTS public.update_toda_roster_entry(UUID, TEXT, TEXT, TEXT);
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

    UPDATE public.toda_roster_entry
       SET member_name = v_name, franchise_number = v_fr, plate_number = v_pl, membership_number = v_mem
     WHERE entry_id = p_entry_id;

    SELECT t.toda_name INTO v_toda_name FROM public.toda t WHERE t.toda_id = v_toda;
    PERFORM public.record_policy_audit('TODA_ROSTER_ENTRY_UPDATED', v_toda::TEXT, v_toda_name, 'Membership',
        'Updated the roster entry of ' || v_name || '.',
        jsonb_build_object('member_name', v_old.member_name, 'franchise_number', v_old.franchise_number, 'plate_number', v_old.plate_number, 'membership_number', v_old.membership_number),
        jsonb_build_object('member_name', v_name, 'franchise_number', v_fr, 'plate_number', v_pl, 'membership_number', v_mem));

    RETURN jsonb_build_object('success', TRUE, 'changed', TRUE);
END;
$$;

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
    RETURN jsonb_build_object('success', TRUE);
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
    INSERT INTO public.toda_roster_entry (toda_id, member_name, franchise_number, plate_number, membership_number, source, added_by)
    VALUES (v_toda, v_old.member_name, v_old.franchise_number, v_old.plate_number, v_old.membership_number, 'manual', auth.uid())
    RETURNING * INTO v_new;

    SELECT t.toda_name INTO v_toda_name FROM public.toda t WHERE t.toda_id = v_toda;
    PERFORM public.record_policy_audit('TODA_ROSTER_ENTRY_REINSTATED', v_toda::TEXT, v_toda_name, 'Membership',
        'Put ' || v_old.member_name || ' (franchise ' || COALESCE(v_old.franchise_number, '-') || ') back on the roster.',
        jsonb_build_object('status', 'Left'), jsonb_build_object('status', 'Active'));
    RETURN jsonb_build_object('success', TRUE, 'entry', to_jsonb(v_new));
END;
$$;

-- the roster file of a compliance submission (registration file stays; a later file is a new version)
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

-- the import of a roster file (the first one is the registration file, a later one an update)
DROP FUNCTION IF EXISTS public.import_toda_roster(JSONB);
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

        INSERT INTO public.toda_roster_entry (toda_id, member_name, franchise_number, plate_number, membership_number, source, added_by)
        VALUES (v_toda, v_name, v_fr, v_pl, NULLIF(left(btrim(COALESCE(v_item->>'membership_number', '')), 40), ''), v_src, auth.uid());
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
    END IF;

    RETURN jsonb_build_object('success', TRUE, 'added', v_added, 'skipped_duplicate', v_dup, 'skipped_invalid', v_invalid);
END;
$$;

-- "20 at registration, 22 now": what the TODA and the LGU read about one roster
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
        'edited', (SELECT count(*) FROM public.toda_roster_entry r WHERE r.toda_id = v_toda AND r.updated_at IS NOT NULL),
        'versions', COALESCE((SELECT jsonb_agg(jsonb_build_object('version_id', v.version_id, 'kind', v.kind, 'file_name', v.file_name, 'uploaded_at', v.uploaded_at, 'file_path', v.file_path)
                                               ORDER BY v.uploaded_at DESC)
                                FROM public.toda_roster_file_version v WHERE v.toda_id = v_toda), '[]'::jsonb));
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. No direct writes any more; the registration file cannot be swapped by a table update
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS toda_roster_entry_insert ON public.toda_roster_entry;
DROP POLICY IF EXISTS toda_roster_entry_update ON public.toda_roster_entry;
DROP POLICY IF EXISTS toda_roster_entry_delete ON public.toda_roster_entry;

CREATE OR REPLACE FUNCTION public.protect_toda_relocation_columns()
RETURNS TRIGGER AS $$
BEGIN
    IF COALESCE(public.is_lgu_admin(), FALSE) OR COALESCE(public.is_service_context(), FALSE) THEN
        RETURN NEW;
    END IF;
    IF NEW.pending_terminal_latitude IS DISTINCT FROM OLD.pending_terminal_latitude
       OR NEW.pending_terminal_longitude IS DISTINCT FROM OLD.pending_terminal_longitude
       OR NEW.pending_terminal_location IS DISTINCT FROM OLD.pending_terminal_location
       OR NEW.pending_terminal_reason IS DISTINCT FROM OLD.pending_terminal_reason
       OR NEW.terminal_relocation_status IS DISTINCT FROM OLD.terminal_relocation_status
       OR NEW.terminal_relocation_requested_at IS DISTINCT FROM OLD.terminal_relocation_requested_at
       OR NEW.terminal_relocation_decision_note IS DISTINCT FROM OLD.terminal_relocation_decision_note
       OR NEW.terminal_relocation_decided_at IS DISTINCT FROM OLD.terminal_relocation_decided_at THEN
        RAISE EXCEPTION 'Access Denied: a terminal relocation is requested with request_terminal_relocation() and decided by the LGU Administrator.';
    END IF;
    -- D-P9: the registration roster file is what the LGU accredited; it changes only through toda_submit_compliance_document()
    IF NEW.accredited_drivers_url IS DISTINCT FROM OLD.accredited_drivers_url AND auth.uid() IS NOT NULL THEN
        RAISE EXCEPTION 'Access Denied: the roster file is submitted with toda_submit_compliance_document(); the registration file is never replaced by a table update.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 7. Privileges
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._roster_text(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._roster_normalize(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.toda_roster_file_version_on_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_toda_relocation_columns() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.affiliation_roster_check(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliation_roster_check(UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION public.add_toda_roster_entry(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_toda_roster_entry(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_toda_roster_entry_left(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reinstate_toda_roster_entry(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.import_toda_roster(JSONB, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_toda_roster_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_toda_roster_entry(TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_toda_roster_entry(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_toda_roster_entry_left(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reinstate_toda_roster_entry(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_toda_roster(JSONB, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_toda_roster_summary(UUID) TO authenticated, service_role;

DO $$
BEGIN
    IF has_function_privilege('anon', 'public.add_toda_roster_entry(text,text,text,text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.import_toda_roster(jsonb,text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.get_toda_roster_summary(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'the roster functions must not be callable by anon';
    END IF;
    IF has_function_privilege('authenticated', 'public.affiliation_roster_check(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'the roster check must stay internal';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'toda_roster_entry' AND cmd IN ('INSERT', 'UPDATE', 'DELETE')) THEN
        RAISE EXCEPTION 'toda_roster_entry must have no direct write policy';
    END IF;
END $$;
