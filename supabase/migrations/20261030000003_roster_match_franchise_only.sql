-- ============================================================================
-- ROSTER MATCH (Rule 2.4): the FRANCHISE number decides, and the screen is told WHY
-- ============================================================================
-- Until now an applicant counted as "on the master roster" when EITHER the franchise number OR the plate number matched a roster entry
-- (20261010000005, 20261014000001). The rule is the franchise number: it is the number the TODA vouches for, and a plate can belong to a
-- different tricycle than the franchise on the roster. A plate alone no longer matches.
--
--   1. affiliation_roster_check(affiliation)   ONE row that explains the answer (internal: only the functions below use it):
--        matched            an entry of THIS TODA has the applicant's franchise number and was in place before the application
--        entry_added_later  an entry has that franchise number, but it was added (or its franchise edited) AFTER the application, so it does not count
--        plate_only         no entry has that franchise number, but one has the applicant's plate number (shown as a hint, never a match)
--        no_entry           nothing on this TODA's roster has that franchise number
--        no_franchise       the applicant has no franchise number to compare
--   2. affiliation_roster_matched(affiliation) the yes / no the endorsement uses (Roster Mismatch flag): the same answer, from the same check.
--   3. get_affiliation_roster_matches(ids)     what the TODA screen reads: now also carries the reason and the roster entry it found, so the
--                                              review window can say why. Same callers as before (own TODA's administrator, the LGU).
--
-- NOT changed: name alone never matches; only entries that existed before the application count (Requirement A5: an entry typed in, or a
-- franchise edited, afterwards must not make an old application look "found"); a TODA can still endorse an unmatched applicant, which raises the
-- Roster Mismatch flag; the LGU still needs a written reason to approve over an open flag (verify_driver_affiliation, audit-logged).
-- Existing flags and endorsements are untouched: the new rule applies to the next endorsement and to what the screen shows from now on.
-- Forward-only. Safe to run twice.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The check, in one place
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
     ORDER BY GREATEST(r.created_at, COALESCE(r.identifiers_changed_at, r.created_at)) DESC
     LIMIT 1;
    IF FOUND THEN
        RETURN QUERY SELECT FALSE, 'entry_added_later'::TEXT, v_franchise, v_entry.member_name, v_entry.franchise_number, v_entry.plate_number,
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

REVOKE ALL ON FUNCTION public.affiliation_roster_check(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliation_roster_check(UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. The yes / no the endorsement uses: the same answer
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.affiliation_roster_matched(p_affiliation_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT COALESCE((SELECT c.roster_matched FROM public.affiliation_roster_check(p_affiliation_id) c), FALSE);
$$;

REVOKE ALL ON FUNCTION public.affiliation_roster_matched(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliation_roster_matched(UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 3. What the TODA screen reads (the answer plus the reason and the entry), for the applications the caller administers:
--    a TODA administrator: their own TODA's; the LGU: every one. Nobody else gets a row.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_affiliation_roster_matches(UUID[]);

CREATE FUNCTION public.get_affiliation_roster_matches(p_affiliation_ids UUID[] DEFAULT NULL)
RETURNS TABLE (
    affiliation_id UUID,
    roster_matched BOOLEAN,
    reason_code TEXT,
    driver_franchise TEXT,
    entry_member_name TEXT,
    entry_franchise TEXT,
    entry_plate TEXT,
    entry_counted_from TIMESTAMPTZ,
    application_submitted_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT a.affiliation_id, c.roster_matched, c.reason_code, c.driver_franchise, c.entry_member_name, c.entry_franchise,
           c.entry_plate, c.entry_counted_from, c.application_submitted_at
      FROM public.driver_toda_affiliation a
     CROSS JOIN LATERAL public.affiliation_roster_check(a.affiliation_id) c
     WHERE (p_affiliation_ids IS NULL OR a.affiliation_id = ANY (p_affiliation_ids))
       AND (COALESCE(public.is_lgu_admin(), FALSE)
            OR (public.get_current_toda_admin_toda_id() IS NOT NULL AND a.toda_id = public.get_current_toda_admin_toda_id()));
$$;

REVOKE ALL ON FUNCTION public.get_affiliation_roster_matches(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_affiliation_roster_matches(UUID[]) TO authenticated, service_role;

-- SELF-CHECK
DO $$
BEGIN
    IF has_function_privilege('authenticated', 'public.affiliation_roster_check(uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.affiliation_roster_check(uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.affiliation_roster_matched(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'the roster check functions must stay internal';
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.get_affiliation_roster_matches(uuid[])', 'EXECUTE')
       OR has_function_privilege('anon', 'public.get_affiliation_roster_matches(uuid[])', 'EXECUTE') THEN
        RAISE EXCEPTION 'get_affiliation_roster_matches grants are wrong';
    END IF;
END $$;
