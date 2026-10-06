-- ============================================================================
-- Migration: 20261014000001_roster_entry_edit.sql
-- Checklist (TODA Administrator > Manage Drivers): "Update member information".
--
-- A TODA administrator can correct an entry of the TODA's master roster (a misspelt name, a wrong franchise or plate number).
--
-- The one thing an edit must not do is rewrite history. The roster match (Rule 2.4, affiliation_roster_matched) counts an entry only
-- when it existed BEFORE the driver applied (created_at <= submitted_at): an entry typed in afterwards must not make an old application
-- look "found on the roster". Editing the franchise or plate number of an old entry would have the same effect, so the database now
-- remembers when an entry's franchise / plate identifiers last changed (identifiers_changed_at) and the match counts the entry only from
-- that moment. Correcting only the name (a name alone never matches) changes nothing about matching.
--
--   * update_toda_roster_entry(entry, name, franchise, plate): the only supported way to edit; the caller must be the administrator of
--     the entry's TODA (an entry of another TODA looks the same as a missing one), the franchise number is required, a franchise number
--     already used by another entry of the same TODA is refused, and every real change is written to the audit log (before and after).
--   * the trigger also stops an entry being moved to another TODA and stamps updated_at / identifiers_changed_at itself, so a direct
--     table update cannot hide a change either.
-- Forward-only. Safe to run twice.
-- ============================================================================

ALTER TABLE public.toda_roster_entry
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS identifiers_changed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.sync_toda_roster_entry_normalized()
RETURNS TRIGGER AS $$
BEGIN
    NEW.normalized_name := regexp_replace(lower(COALESCE(NEW.member_name, '')), '[^a-z0-9]', '', 'g');
    NEW.normalized_franchise := regexp_replace(upper(COALESCE(NEW.franchise_number, '')), '[^A-Z0-9]', '', 'g');
    NEW.normalized_plate := regexp_replace(upper(COALESCE(NEW.plate_number, '')), '[^A-Z0-9]', '', 'g');
    NEW.normalized_license := regexp_replace(upper(COALESCE(NEW.license_number, '')), '[^A-Z0-9]', '', 'g');

    IF TG_OP = 'UPDATE' THEN
        IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'Access Denied: created_at timestamp on roster entries is immutable and cannot be back-dated.';
        END IF;
        IF NEW.toda_id IS DISTINCT FROM OLD.toda_id THEN
            RAISE EXCEPTION 'Access Denied: a roster entry cannot be moved to another TODA.';
        END IF;
        -- the match counts an entry only from the moment its franchise / plate identifiers were last set
        IF NEW.normalized_franchise IS DISTINCT FROM OLD.normalized_franchise
           OR NEW.normalized_plate IS DISTINCT FROM OLD.normalized_plate THEN
            NEW.identifiers_changed_at := CURRENT_TIMESTAMP;
        ELSE
            NEW.identifiers_changed_at := OLD.identifiers_changed_at;
        END IF;
        IF NEW.member_name IS DISTINCT FROM OLD.member_name
           OR NEW.normalized_franchise IS DISTINCT FROM OLD.normalized_franchise
           OR NEW.normalized_plate IS DISTINCT FROM OLD.normalized_plate
           OR NEW.normalized_license IS DISTINCT FROM OLD.normalized_license THEN
            NEW.updated_at := CURRENT_TIMESTAMP;
        ELSE
            NEW.updated_at := OLD.updated_at;
        END IF;
    END IF;

    IF TG_OP = 'INSERT' THEN
        NEW.created_at := CURRENT_TIMESTAMP;
        NEW.updated_at := NULL;
        NEW.identifiers_changed_at := NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The roster match: identical to 20261010000005 except that an entry counts from the later of its creation and its last
-- change of franchise / plate number.
CREATE OR REPLACE FUNCTION public.affiliation_roster_matched(p_affiliation_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.driver_toda_affiliation a
          JOIN public.driver d ON d.driver_id = a.driver_id
          LEFT JOIN LATERAL (
                SELECT v.submitted_franchise_number, v.submitted_plate_number
                  FROM public.driver_verification v WHERE v.driver_id = a.driver_id LIMIT 1) v ON TRUE
          CROSS JOIN LATERAL (
                SELECT regexp_replace(upper(COALESCE(v.submitted_franchise_number, d.franchise_number, '')), '[^A-Z0-9]', '', 'g') AS nf,
                       regexp_replace(upper(COALESCE(v.submitted_plate_number, d.plate_number, '')), '[^A-Z0-9]', '', 'g') AS np) n
          JOIN public.toda_roster_entry r
            ON r.toda_id = a.toda_id
           AND GREATEST(r.created_at, COALESCE(r.identifiers_changed_at, r.created_at)) <= a.submitted_at
           AND ((n.nf <> '' AND r.normalized_franchise = n.nf) OR (n.np <> '' AND r.normalized_plate = n.np))
         WHERE a.affiliation_id = p_affiliation_id
    );
$$;

REVOKE ALL ON FUNCTION public.affiliation_roster_matched(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliation_roster_matched(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.update_toda_roster_entry(
    p_entry_id UUID,
    p_member_name TEXT,
    p_franchise_number TEXT,
    p_plate_number TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_toda    UUID := public.get_current_toda_admin_toda_id();
    v_old     public.toda_roster_entry;
    v_name    TEXT := btrim(COALESCE(p_member_name, ''));
    v_fr      TEXT := NULLIF(btrim(COALESCE(p_franchise_number, '')), '');
    v_pl      TEXT := NULLIF(btrim(COALESCE(p_plate_number, '')), '');
    v_nfr     TEXT;
    v_toda_name TEXT;
BEGIN
    IF v_toda IS NULL OR NOT public.is_toda_admin() THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_TODA_ADMIN',
            'error', 'Only a TODA administrator can update the roster.');
    END IF;

    SELECT * INTO v_old FROM public.toda_roster_entry WHERE entry_id = p_entry_id AND toda_id = v_toda FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_NOT_FOUND',
            'error', 'That roster entry was not found.');
    END IF;

    IF length(v_name) < 2 OR length(v_name) > 120 THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_TEXT',
            'error', 'The member name must be 2 to 120 characters.');
    END IF;
    IF v_fr IS NULL OR length(v_fr) > 40 OR (v_pl IS NOT NULL AND length(v_pl) > 20) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_TEXT',
            'error', 'The franchise number is required (up to 40 characters) and the plate number can be up to 20.');
    END IF;

    v_nfr := regexp_replace(upper(v_fr), '[^A-Z0-9]', '', 'g');
    IF v_nfr = '' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_TEXT',
            'error', 'The franchise number needs letters or numbers.');
    END IF;
    IF EXISTS (SELECT 1 FROM public.toda_roster_entry r
                WHERE r.toda_id = v_toda AND r.entry_id <> p_entry_id AND r.normalized_franchise = v_nfr) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_ROSTER_DUPLICATE',
            'error', 'Another roster entry of this TODA already has that franchise number.');
    END IF;

    IF v_name IS NOT DISTINCT FROM v_old.member_name
       AND v_fr IS NOT DISTINCT FROM v_old.franchise_number
       AND v_pl IS NOT DISTINCT FROM v_old.plate_number THEN
        RETURN jsonb_build_object('success', TRUE, 'changed', FALSE);
    END IF;

    UPDATE public.toda_roster_entry
       SET member_name = v_name, franchise_number = v_fr, plate_number = v_pl
     WHERE entry_id = p_entry_id;

    SELECT t.toda_name INTO v_toda_name FROM public.toda t WHERE t.toda_id = v_toda;
    PERFORM public.record_policy_audit(
        'TODA_ROSTER_ENTRY_UPDATED', v_toda::TEXT, v_toda_name, 'Membership',
        'Updated the roster entry of ' || v_name || '.',
        jsonb_build_object('member_name', v_old.member_name, 'franchise_number', v_old.franchise_number, 'plate_number', v_old.plate_number),
        jsonb_build_object('member_name', v_name, 'franchise_number', v_fr, 'plate_number', v_pl));

    RETURN jsonb_build_object('success', TRUE, 'changed', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.update_toda_roster_entry(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_toda_roster_entry(UUID, TEXT, TEXT, TEXT) TO authenticated, service_role;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_toda_roster_entry' AND pronamespace = 'public'::regnamespace) THEN
        RAISE EXCEPTION 'update_toda_roster_entry is missing';
    END IF;
    IF has_function_privilege('anon', 'public.update_toda_roster_entry(uuid,text,text,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'update_toda_roster_entry must not be callable by anon';
    END IF;
    IF has_function_privilege('authenticated', 'public.affiliation_roster_matched(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'affiliation_roster_matched must stay internal';
    END IF;
END $$;
