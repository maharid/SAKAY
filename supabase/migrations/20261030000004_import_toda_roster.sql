-- ============================================================================
-- MASTER ROSTER: import the roster a TODA already has, in one step (Rule 2.4)
-- ============================================================================
-- The roster check (affiliation_roster_check) reads public.toda_roster_entry. The roster FILE a TODA uploads when it registers was only ever
-- read by the browser to build the member list; nothing copied it into that table, so a TODA that registered with a file and never typed its
-- members in one by one had an EMPTY master roster, and every applicant looked "not found". This adds the one door for filling it from a file:
--
--   import_toda_roster(entries)   the signed-in TODA administrator sends the rows of THEIR roster (member_name, franchise_number, plate_number)
--                                  * only for the administrator's own TODA (the TODA is never taken from the request)
--                                  * a franchise number is required (it is what the roster check compares); a row without a usable one,
--                                    or with a name that is too short / long, is skipped and counted
--                                  * a franchise number already on this TODA's roster (or repeated in the same upload) is skipped and counted:
--                                    an import never creates a second entry for the same franchise and never edits an existing one
--                                  * at most 500 rows at a time
--                                  * ONE audit entry (TODA_ROSTER_IMPORTED) with the counts
--
-- Imported entries are dated when they are imported, exactly like an entry typed in: the trigger that stamps created_at is not bypassed, so an
-- import cannot make an earlier application look "found" (Requirement A5). They count for the applications submitted after the import; for an
-- earlier application the review window says the entry was added later, the TODA can still endorse, and the LGU gives its written reason.
-- Forward-only. Safe to run twice.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.import_toda_roster(p_entries JSONB)
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
           OR EXISTS (SELECT 1 FROM public.toda_roster_entry r WHERE r.toda_id = v_toda AND r.normalized_franchise = v_nfr) THEN
            v_dup := v_dup + 1;
            CONTINUE;
        END IF;

        INSERT INTO public.toda_roster_entry (toda_id, member_name, franchise_number, plate_number)
        VALUES (v_toda, v_name, v_fr, v_pl);
        v_seen := v_seen || v_nfr;
        v_added := v_added + 1;
    END LOOP;

    IF v_added > 0 THEN
        SELECT t.toda_name INTO v_toda_name FROM public.toda t WHERE t.toda_id = v_toda;
        PERFORM public.record_policy_audit(
            'TODA_ROSTER_IMPORTED', v_toda::TEXT, v_toda_name, 'Membership',
            'Imported ' || v_added || ' master roster entries from the uploaded roster file (' || v_dup || ' already on the roster, '
                || v_invalid || ' skipped).',
            NULL,
            jsonb_build_object('added', v_added, 'skipped_duplicate', v_dup, 'skipped_invalid', v_invalid));
    END IF;

    RETURN jsonb_build_object('success', TRUE, 'added', v_added, 'skipped_duplicate', v_dup, 'skipped_invalid', v_invalid);
END;
$$;

REVOKE ALL ON FUNCTION public.import_toda_roster(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_toda_roster(JSONB) TO authenticated, service_role;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'import_toda_roster' AND pronamespace = 'public'::regnamespace) THEN
        RAISE EXCEPTION 'import_toda_roster is missing';
    END IF;
    IF has_function_privilege('anon', 'public.import_toda_roster(jsonb)', 'EXECUTE') THEN
        RAISE EXCEPTION 'import_toda_roster must not be callable by anon';
    END IF;
END $$;
