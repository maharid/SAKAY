-- ============================================================================
-- Migration: 20261009000002_driver_multi_affiliation.sql
-- DRIVER REGISTRATION UNDER ONE OR MORE TODAs (paper SAKAY 10-3-26: Driver Module 2.1, Policy 3.1, Policy 3.10)
--
-- What already exists (20260930080000 batch 1, nothing here replaces it):
--   public.driver_toda_affiliation   ONE ROW PER (driver, TODA), UNIQUE (driver_id, toda_id), with its own TODA stage
--                                    (toda_endorsement_status) and LGU stage (lgu_verification_status), and is_active_selection
--   endorse_ / return_ / reject_ / verify_driver_affiliation, resubmit_driver_application, select_active_driver_affiliation,
--   driver_go_online (refuses unless exactly one VERIFIED affiliation is active), get_my_toda_affiliations()
--
-- What was missing, and is added here:
--   1. assigned_terminal and barangay_service_area on the affiliation (they were single columns on driver, so a second TODA could
--      not have its own). toda_membership_number was already per affiliation.
--   2. The unique (driver_id, toda_id) rule is asserted (it exists; created only if some database lacks it).
--   3. VISIBILITY. Row policies and storage policies let a TODA administrator see a driver only when driver.toda_id (one pointer)
--      is their TODA. With two TODAs only one of them could ever see the applicant, so "each TODA reviews its own affiliation"
--      was impossible. A TODA administrator may now READ a driver who has an affiliation with THEIR TODA: the driver row, the
--      verification record (documents, OCR data) and the document folders. READ ONLY: no insert / update policy and no
--      is_toda_admin_for_driver() is widened, so no TODA administrator gains the power to write another TODA's applicant.
--   4. apply_driver_toda_affiliations(jsonb): the registration RPC. ONE call creates one 'Submitted' / 'Pending' affiliation per
--      selected TODA, each with its own membership number, terminal and barangay. Only active, unexpired TODAs are accepted;
--      nothing here can create an Endorsed / Approved / active row (that is what the TODA and LGU decide, per affiliation).
--   5. reject_driver_affiliation() no longer poisons the DRIVER when one TODA / the LGU rejects ONE affiliation while another
--      is still alive: driver.account_status = 'Rejected' and the shared verification record are only set when no other
--      affiliation of that driver is left (rejected at neither stage). Everything else in the function is unchanged.
--
-- NOT built here (follow-up): choosing the verified tricycle unit before going Online (there is no tricycle_unit table yet).
--
-- Forward-only. Safe to run twice. Every function has explicit privileges. Ends with a self-check.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Per-affiliation columns
-- ----------------------------------------------------------------------------
ALTER TABLE public.driver_toda_affiliation
    ADD COLUMN IF NOT EXISTS assigned_terminal VARCHAR(100),
    ADD COLUMN IF NOT EXISTS barangay_service_area VARCHAR(100);

-- ----------------------------------------------------------------------------
-- 2. UNIQUE (driver_id, toda_id), whatever it is called
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_index i
         WHERE i.indrelid = 'public.driver_toda_affiliation'::regclass
           AND i.indisunique AND i.indpred IS NULL AND i.indnatts = 2
           AND (SELECT array_agg(a.attname::TEXT ORDER BY a.attname)
                  FROM pg_attribute a
                 WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)) = ARRAY['driver_id', 'toda_id']
    ) THEN
        ALTER TABLE public.driver_toda_affiliation
            ADD CONSTRAINT driver_toda_affiliation_driver_toda_key UNIQUE (driver_id, toda_id);
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Read access for the TODA administrator of ANY TODA the driver applied to
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.toda_admin_has_affiliation_with_driver(p_driver_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT p_driver_id IS NOT NULL
       AND public.get_current_toda_admin_toda_id() IS NOT NULL
       AND EXISTS (
            SELECT 1 FROM public.driver_toda_affiliation a
             WHERE a.driver_id = p_driver_id
               AND a.toda_id = public.get_current_toda_admin_toda_id()
       );
$$;

REVOKE ALL ON FUNCTION public.toda_admin_has_affiliation_with_driver(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toda_admin_has_affiliation_with_driver(UUID) TO authenticated, service_role;

-- driver: SELECT only (same predicate as 20261008000004, plus the affiliation test)
DROP POLICY IF EXISTS driver_select_scoped ON public.driver;
CREATE POLICY driver_select_scoped ON public.driver FOR SELECT TO authenticated
    USING (auth_user_id = (SELECT auth.uid())
           OR (SELECT public.is_lgu_admin())
           OR (toda_id IS NOT NULL AND toda_id = (SELECT public.get_current_toda_admin_toda_id()))
           OR public.toda_admin_has_affiliation_with_driver(driver_id));

-- driver_verification: SELECT only (same predicate as 20261008000004, plus the affiliation test)
DROP POLICY IF EXISTS driver_verification_select_scoped ON public.driver_verification;
CREATE POLICY driver_verification_select_scoped ON public.driver_verification FOR SELECT TO authenticated
    USING (driver_id = (SELECT public.get_current_driver_id())
           OR (SELECT public.is_lgu_admin())
           OR public.is_toda_admin_for_driver(driver_id)
           OR public.toda_admin_has_affiliation_with_driver(driver_id));

-- storage: the driver's document folders (driver-licenses, mtop-permits, tricycle-photos, profile photos). CREATE OR REPLACE keeps
-- the existing grants; the text is the one from 20261008000005 plus the affiliation test.
CREATE OR REPLACE FUNCTION public.storage_can_read_driver_folder(p_folder TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(public.is_lgu_admin(), FALSE)
        OR EXISTS (
            SELECT 1 FROM public.driver d
             WHERE d.auth_user_id::TEXT = p_folder
               AND d.toda_id IS NOT NULL
               AND d.toda_id = public.get_current_toda_admin_toda_id()
        )
        OR EXISTS (
            SELECT 1 FROM public.driver d
              JOIN public.driver_toda_affiliation a ON a.driver_id = d.driver_id
             WHERE d.auth_user_id::TEXT = p_folder
               AND public.get_current_toda_admin_toda_id() IS NOT NULL
               AND a.toda_id = public.get_current_toda_admin_toda_id()
        );
$$;

-- ----------------------------------------------------------------------------
-- 4. Registration: one call, one affiliation per selected TODA
-- ----------------------------------------------------------------------------
-- p_applications: [{ "toda_id": uuid, "toda_membership_number": text, "assigned_terminal": text, "barangay_service_area": text }, ...]
-- Returns { success, applied, results: [{ toda_id, success, outcome | error, affiliation_id, toda_endorsement_status, ... }] }
--   outcome 'created'    a new Submitted / Pending affiliation
--   outcome 'updated'    the affiliation was still waiting for its TODA (or was returned for correction): only the descriptive
--                        fields (membership number, terminal, barangay) were refreshed, the review stage is untouched
--   outcome 'unchanged'  the affiliation is already past the first stage (Endorsed / Approved / Rejected): nothing changed
CREATE OR REPLACE FUNCTION public.apply_driver_toda_affiliations(p_applications JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    c_max CONSTANT INTEGER := 10;
    v_driver public.driver;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_item JSONB;
    v_toda_id UUID;
    v_toda public.toda;
    v_existing public.driver_toda_affiliation;
    v_aff public.driver_toda_affiliation;
    v_membership TEXT;
    v_terminal TEXT;
    v_barangay TEXT;
    v_seen UUID[] := ARRAY[]::UUID[];
    v_results JSONB := '[]'::JSONB;
    v_ok INTEGER := 0;
    v_first UUID := NULL;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'ERR_AUTH_REQUIRED: Sign in first.');
    END IF;

    SELECT * INTO v_driver FROM public.driver WHERE auth_user_id = auth.uid();
    IF v_driver.driver_id IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Driver profile not found.');
    END IF;
    IF v_driver.is_permanently_disqualified = TRUE THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Driver is permanently disqualified from TODA affiliations.');
    END IF;
    IF v_driver.account_status = 'Rejected' THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Driver account is rejected. Re-application must be allowed by an administrator.');
    END IF;

    IF p_applications IS NULL OR jsonb_typeof(p_applications) <> 'array' OR jsonb_array_length(p_applications) = 0 THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Select at least one TODA.');
    END IF;
    IF jsonb_array_length(p_applications) > c_max THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'At most ' || c_max || ' TODAs can be selected at once.');
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_applications) LOOP
        v_toda_id := NULL;
        BEGIN
            v_toda_id := NULLIF(v_item->>'toda_id', '')::UUID;
        EXCEPTION WHEN OTHERS THEN
            v_toda_id := NULL;
        END;

        IF v_toda_id IS NULL THEN
            v_results := v_results || jsonb_build_array(jsonb_build_object('success', FALSE, 'error', 'A TODA id is missing or not valid.'));
            CONTINUE;
        END IF;
        IF v_toda_id = ANY (v_seen) THEN
            CONTINUE;   -- the same TODA twice in one request counts once
        END IF;
        v_seen := v_seen || v_toda_id;

        v_membership := NULLIF(left(btrim(COALESCE(v_item->>'toda_membership_number', '')), 100), '');
        v_terminal   := NULLIF(left(btrim(COALESCE(v_item->>'assigned_terminal', '')), 100), '');
        v_barangay   := NULLIF(left(btrim(COALESCE(v_item->>'barangay_service_area', '')), 100), '');

        SELECT * INTO v_toda FROM public.toda WHERE toda_id = v_toda_id;
        IF v_toda.toda_id IS NULL
           OR v_toda.toda_status IS DISTINCT FROM 'Active'
           OR (v_toda.certificate_expiry IS NOT NULL
               AND (v_toda.certificate_expiry AT TIME ZONE 'Asia/Manila')::DATE < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::DATE) THEN
            v_results := v_results || jsonb_build_array(jsonb_build_object(
                'toda_id', v_toda_id, 'success', FALSE,
                'error', 'ERR_TODA_NOT_ACTIVE: Hindi maaaring mag-aplay sa TODA na hindi aktibo o paso na ang akreditasyon. (This TODA is not active, or its accreditation has expired.)'));
            CONTINUE;
        END IF;

        SELECT * INTO v_existing FROM public.driver_toda_affiliation
         WHERE driver_id = v_driver.driver_id AND toda_id = v_toda_id;

        IF v_existing.affiliation_id IS NULL THEN
            -- A brand-new application. The insert trigger validates it; the policy engine context lets this function insert it.
            PERFORM set_config('sakay.internal_context', 'true', TRUE);
            INSERT INTO public.driver_toda_affiliation (
                driver_id, toda_id, toda_membership_number, assigned_terminal, barangay_service_area,
                toda_endorsement_status, lgu_verification_status, is_active_selection, submitted_at
            ) VALUES (
                v_driver.driver_id, v_toda_id, v_membership, v_terminal, v_barangay,
                'Submitted', 'Pending', FALSE, CURRENT_TIMESTAMP
            )
            RETURNING * INTO v_aff;
            PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), TRUE);

            v_ok := v_ok + 1;
            v_results := v_results || jsonb_build_array(jsonb_build_object(
                'toda_id', v_toda_id, 'success', TRUE, 'outcome', 'created', 'affiliation_id', v_aff.affiliation_id,
                'toda_endorsement_status', v_aff.toda_endorsement_status, 'lgu_verification_status', v_aff.lgu_verification_status));
            v_first := COALESCE(v_first, v_toda_id);

        ELSIF v_existing.toda_endorsement_status IN ('Submitted', 'Resubmission Required')
              AND v_existing.lgu_verification_status IN ('Pending', 'Resubmission Required') THEN
            -- Still with its TODA (or returned for correction): refresh the descriptive fields only. The review columns are not
            -- touched, so the trigger that guards them has nothing to object to.
            UPDATE public.driver_toda_affiliation
               SET toda_membership_number = COALESCE(v_membership, toda_membership_number),
                   assigned_terminal      = COALESCE(v_terminal, assigned_terminal),
                   barangay_service_area  = COALESCE(v_barangay, barangay_service_area),
                   updated_at             = CURRENT_TIMESTAMP
             WHERE affiliation_id = v_existing.affiliation_id
            RETURNING * INTO v_aff;

            v_ok := v_ok + 1;
            v_results := v_results || jsonb_build_array(jsonb_build_object(
                'toda_id', v_toda_id, 'success', TRUE, 'outcome', 'updated', 'affiliation_id', v_aff.affiliation_id,
                'toda_endorsement_status', v_aff.toda_endorsement_status, 'lgu_verification_status', v_aff.lgu_verification_status));
            v_first := COALESCE(v_first, v_toda_id);

        ELSE
            v_ok := v_ok + 1;
            v_results := v_results || jsonb_build_array(jsonb_build_object(
                'toda_id', v_toda_id, 'success', TRUE, 'outcome', 'unchanged', 'affiliation_id', v_existing.affiliation_id,
                'toda_endorsement_status', v_existing.toda_endorsement_status, 'lgu_verification_status', v_existing.lgu_verification_status));
            v_first := COALESCE(v_first, v_toda_id);
        END IF;
    END LOOP;

    -- The legacy pointer driver.toda_id (read by several screens) follows the first TODA when the driver has none yet. It is NOT the
    -- active selection: that is only ever set by select_active_driver_affiliation / verify_driver_affiliation, per affiliation.
    IF v_ok > 0 AND v_driver.toda_id IS NULL AND v_first IS NOT NULL THEN
        PERFORM set_config('sakay.internal_context', 'true', TRUE);
        UPDATE public.driver SET toda_id = v_first WHERE driver_id = v_driver.driver_id AND toda_id IS NULL;
        PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), TRUE);
    END IF;

    IF v_ok = 0 THEN
        RETURN jsonb_build_object('success', FALSE, 'applied', 0, 'results', v_results,
                                  'error', 'None of the selected TODAs could be applied to.');
    END IF;
    RETURN jsonb_build_object('success', TRUE, 'applied', v_ok, 'results', v_results);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_driver_toda_affiliations(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_driver_toda_affiliations(JSONB) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. reject_driver_affiliation(): a rejection of ONE affiliation does not reject the DRIVER while another is still alive
--    (same function as 20260930080000 section "Reject Driver Application"; the changes are marked NEW)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_driver_affiliation(
    p_affiliation_id UUID,
    p_reason_category TEXT,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_aff public.driver_toda_affiliation;
    v_driver public.driver;
    v_old_state JSONB;
    v_other_alive BOOLEAN;   -- NEW
BEGIN
    SELECT * INTO v_aff FROM public.driver_toda_affiliation WHERE affiliation_id = p_affiliation_id;
    IF v_aff.affiliation_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Affiliation record not found.');
    END IF;

    IF NOT (public.is_lgu_admin() OR (public.get_current_toda_admin_toda_id() IS NOT NULL AND v_aff.toda_id = public.get_current_toda_admin_toda_id())) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Access Denied: You may only review applications for your own TODA.');
    END IF;

    -- Mandatory reason category check (Rule 3.8, Item A4)
    IF p_reason_category NOT IN ('ineligible', 'fraudulent') THEN
        RETURN jsonb_build_object('success', false, 'error', 'ERR_INVALID_REJECTION_REASON: Mandatory reason category must be ''ineligible'' or ''fraudulent''. Document issues must use return_driver_affiliation (Rule 3.8).');
    END IF;

    SELECT * INTO v_driver FROM public.driver WHERE driver_id = v_aff.driver_id;
    v_old_state := to_jsonb(v_aff);

    -- NEW: another application of this driver (to a different TODA) that is not rejected at either stage
    SELECT EXISTS (
        SELECT 1 FROM public.driver_toda_affiliation a
         WHERE a.driver_id = v_aff.driver_id
           AND a.affiliation_id <> p_affiliation_id
           AND a.toda_endorsement_status <> 'Rejected'
           AND a.lgu_verification_status <> 'Rejected'
    ) INTO v_other_alive;

    PERFORM set_config('sakay.internal_context', 'true', true);

    IF public.is_lgu_admin() THEN
        UPDATE public.driver_toda_affiliation
        SET lgu_verification_status = 'Rejected',
            lgu_rejection_reason = p_reason_category || ': ' || COALESCE(p_notes, ''),
            updated_at = CURRENT_TIMESTAMP
        WHERE affiliation_id = p_affiliation_id;

        -- NEW condition: only when no other affiliation is left
        IF v_driver.account_status != 'Verified' AND NOT v_other_alive THEN
            UPDATE public.driver
            SET account_status = 'Rejected',
                rejection_reason = p_reason_category,
                rejection_comment = p_notes,
                rejected_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE driver_id = v_aff.driver_id;
        END IF;
    ELSE
        UPDATE public.driver_toda_affiliation
        SET toda_endorsement_status = 'Rejected',
            toda_rejection_reason = p_reason_category || ': ' || COALESCE(p_notes, ''),
            updated_at = CURRENT_TIMESTAMP
        WHERE affiliation_id = p_affiliation_id;

        -- TODA admin does NOT change driver.account_status!
    END IF;

    -- NEW condition: the shared verification record says Rejected only when no other affiliation is left
    IF NOT v_other_alive THEN
        UPDATE public.driver_verification
        SET verification_status = 'Rejected',
            rejection_reason = p_reason_category,
            rejection_comment = p_notes
        WHERE driver_id = v_aff.driver_id;
    END IF;

    -- Resolve overdue flag
    UPDATE public.admin_review_flag
    SET status = 'Resolved',
        resolution = 'Application rejected (' || p_reason_category || '): ' || COALESCE(p_notes, ''),
        resolved_at = CURRENT_TIMESTAMP,
        resolved_by = auth.uid()
    WHERE subject_id = p_affiliation_id::TEXT AND flag_type = 'APPLICATION_OVERDUE' AND status IN ('Open', 'Under Review');

    INSERT INTO public.audit_log (
        action_type, target_id, actor_id, actor_role, details, before_state, performed_at
    ) VALUES (
        'DRIVER_AFFILIATION_REJECTED',
        p_affiliation_id::TEXT,
        auth.uid(),
        CASE WHEN public.is_lgu_admin() THEN 'lgu_admin' ELSE 'toda_admin' END,
        'Rejected driver affiliation (' || p_reason_category || '). ' || COALESCE(p_notes, ''),
        v_old_state,
        CURRENT_TIMESTAMP
    );

    PERFORM set_config('sakay.internal_context', '', false);
    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 6. SELF-CHECK
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF has_function_privilege('anon', 'public.apply_driver_toda_affiliations(jsonb)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.toda_admin_has_affiliation_with_driver(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'a new affiliation function is executable by anon';
    END IF;
    IF NOT (has_function_privilege('authenticated', 'public.apply_driver_toda_affiliations(jsonb)', 'EXECUTE')
        AND has_function_privilege('authenticated', 'public.toda_admin_has_affiliation_with_driver(uuid)', 'EXECUTE')
        AND has_function_privilege('authenticated', 'public.reject_driver_affiliation(uuid, text, text)', 'EXECUTE')
        AND has_function_privilege('authenticated', 'public.storage_can_read_driver_folder(text)', 'EXECUTE')) THEN
        RAISE EXCEPTION 'a signed-in user cannot execute an affiliation function they need';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.driver_toda_affiliation'::regclass
                    AND attname = 'assigned_terminal' AND NOT attisdropped)
       OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.driver_toda_affiliation'::regclass
                       AND attname = 'barangay_service_area' AND NOT attisdropped) THEN
        RAISE EXCEPTION 'driver_toda_affiliation is missing assigned_terminal / barangay_service_area';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.driver_toda_affiliation'::regclass AND relrowsecurity) THEN
        RAISE EXCEPTION 'row level security is not enabled on driver_toda_affiliation';
    END IF;
END $$;
