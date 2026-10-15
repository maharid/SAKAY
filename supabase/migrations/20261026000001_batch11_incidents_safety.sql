-- ============================================================================
-- Migration: 20261026000001_batch11_incidents_safety.sql
-- Batch 11 - Incident reporting, emergency and safety, vehicle breakdown, force majeure and the other edge cases
-- (Sections 15, 19, 26; Rules 29.6, 29.12 - 29.16, 29.19 - 29.23).
--
-- Until now an incident report was a row that a TODA or LGU administrator could overwrite from the browser: there was no routing rule, no
-- outcome ("upheld" did not exist, so no strike could follow a report), no way to file the assault / harassment / threat reports of Rule 19.8,
-- no Urgent Safety Report, no Share Live Trip, no administrator path for a detained or incapacitated driver, no LGU screen for the strike
-- pause, and the "safe" reasons (breakdown, accident, emergency, safety, road closure, an unsafe or illegal request) still struck the driver.
--
--   1. incident_constant(): every number of this batch in ONE place (mirrored in policyConfig.ts; the drift test keeps both equal)
--   2. incident_report: routing (TODA / LGU), priority, subject, review clocks, escalation, outcome, the linked strike, the lost-item contact;
--      the evidence bucket gets the limits the screens apply (3 photos, JPEG / PNG / WebP, 5 MB)
--   3. incident_report_guard(): the category list, the routing of Rule 19.3 and the bypass of Rule 19.8, the 16.5 emergency exception, the evidence
--      limits; the portals can no longer overwrite a report - every review action is a function below (audited, idempotent, atomic)
--   4. the review functions: incident_start_review, incident_escalate (also "reclassify as serious"), incident_decide (Upheld / Not upheld /
--      Fabricated / Resolved; the strike is issued by issue_strike() as the confirming administrator, Rules 19.4 and 19.5; a confirmed victim is
--      never struck for the same incident, Rule 26.4), incident_lost_item_update (Rules 19.6, 29.19), file_urgent_safety_report (Rule 26.2)
--   5. safe reasons (decision PI-11B): a breakdown, an accident, an emergency, a safety concern, a road closure, an unsafe or illegal request or a
--      prohibited item is recorded as an AUTO_WAIVED event with no points, a TODA verification flag and a repeat-pattern flag (3 in 30 days)
--   6. the administrator "end trip for safety" (Rules 29.20 - 29.22, 26.3): a detained or incapacitated driver, an accident, a passenger in danger
--   7. Rule 2.5: check_toda_excess_incidents() counts UPHELD reports (the Batch 1 stub returned 0); a lost item nobody claims is shown to the TODA
--   8. the calamity (Rules 15.4, 29.6): ONE audited administrative action = the announcement + the strike pause; and the way to end it
--   9. Share Live Trip (Rule 26.1): a hashed 128-bit token, valid until the trip ends + 15 minutes (hard cap 4 hours), revocable; one anonymous read
--
-- Functions replaced (verbatim copies of the newest definitions with the marked "Batch 11" additions): issue_strike, admin_reinstate_account,
-- admin_confirm_flagged_violation, _cancellation_decision, driver_cancel_booking, driver_stop_trip_early, passenger_request_early_end,
-- driver_report_delay, set_strike_accrual_pause (now a thin wrapper), check_toda_excess_incidents; rewritten: incident_report_guard,
-- _early_stop_reason_is_valid.
-- Forward-only, ASCII only, safe to run twice.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. THE NUMBERS (one place)
-- ----------------------------------------------------------------------------
-- Code constants, mirrored in packages/shared/src/config/policyConfig.ts. The business-day arithmetic is add_business_days() (Mon-Fri, Asia/Manila).
CREATE OR REPLACE FUNCTION public.incident_constant(p_key TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE p_key
        WHEN 'safety_first_action_hours'          THEN 4        -- F11.1: a safety report (emergency, urgent safety, serious allegation) gets a first action within this many hours
        WHEN 'safety_decision_business_days'      THEN 3        -- F11.1: ... and a decision within this many business days
        WHEN 'standard_first_review_business_days' THEN 2       -- F11.1: a standard report: the driver's TODA Administrator reviews it first within this many business days
        WHEN 'lgu_decision_business_days'         THEN 3        -- F11.1: the LGU decides within this many business days after the escalation
        WHEN 'lost_item_contact_business_days'    THEN 1        -- F11.1: the TODA arranges the contact within this many business days
        WHEN 'evidence_max_files'                 THEN 3        -- F11.2: photos per report
        WHEN 'evidence_max_bytes'                 THEN 5242880  -- F11.2: 5 MB per photo (the bucket's own limit)
        WHEN 'share_link_buffer_minutes'          THEN 15       -- F11.3: a Share Live Trip link lives until the trip ends plus this
        WHEN 'share_link_max_hours'               THEN 4        -- F11.3: ... and never longer than this from its creation
        WHEN 'lost_item_file_days'                THEN 7        -- F11.4: a Lost Item report may be filed within this many days of the trip
        WHEN 'lost_item_unclaimed_days'           THEN 14       -- F11.4: after this many days with no response the TODA is shown the report and may close it as Unclaimed
        WHEN 'safe_reason_flag_count'             THEN 3        -- PI-11B: safe-reason cancellations or stops in the window that raise the repeat-pattern flag
        WHEN 'safe_reason_flag_window_days'       THEN 30       -- PI-11B
        ELSE NULL
    END;
$$;

-- The categories a report may have (Rule 19.1 plus the ones of Batches 9 and 11) and what kind of report each is:
--   SERIOUS    alleged assault, harassment, threats or criminal activity: straight to the LGU Administrator (Rule 19.8)
--   EMERGENCY  an emergency incident, prioritized, no automatic fault (Rules 19.7, 26.2, 26.3, 29.23); allowed while the trip is in progress (Rule 16.5)
--   LOST_ITEM  Rule 19.6: no strike for anybody, a TODA-facilitated contact
--   STANDARD   everything else: the driver's TODA Administrator first (Rule 19.3)
-- NULL = not a category.
CREATE OR REPLACE FUNCTION public._incident_category_class(p_category TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE
        WHEN p_category IN ('Physical Assault', 'Harassment', 'Threat', 'Criminal Activity') THEN 'SERIOUS'
        WHEN p_category IN ('Emergency', 'Safety Concern', 'Accident', 'Medical Emergency') THEN 'EMERGENCY'
        WHEN p_category = 'Lost Item' THEN 'LOST_ITEM'
        WHEN p_category IN ('Rude Behavior', 'Unsafe Driving', 'Reckless Driving', 'Route Deviation', 'Overcharging Attempt', 'Passenger Misconduct',
                            'Change Refusal', 'Counterfeit Currency', 'Others') THEN 'STANDARD'
    END;
$$;

-- The strike codes an UPHELD report of this category may carry (decision PI-11G); an empty list = the outcome is recorded, no strike. The deciding
-- administrator picks the code (and the points within its range, default the minimum) and the database checks it against this list.
CREATE OR REPLACE FUNCTION public._incident_strike_options(p_category TEXT, p_reported_by TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE
        WHEN p_category = 'Rude Behavior' AND p_reported_by = 'Passenger' THEN ARRAY['DRV_RUDE_UPHELD']
        WHEN p_category = 'Rude Behavior' AND p_reported_by = 'Driver' THEN ARRAY['PAX_ABUSIVE_UPHELD']
        WHEN p_category IN ('Unsafe Driving', 'Reckless Driving') AND p_reported_by = 'Passenger' THEN ARRAY['DRV_UNSAFE_DRIVING']
        WHEN p_category = 'Overcharging Attempt' AND p_reported_by = 'Passenger' THEN ARRAY['DRV_OVERCHARGING']
        WHEN p_category = 'Route Deviation' AND p_reported_by = 'Passenger' THEN ARRAY['DRV_ROUTE_DEVIATION_FARE']
        WHEN p_category = 'Passenger Misconduct' AND p_reported_by = 'Driver' THEN ARRAY['PAX_ABUSIVE_UPHELD', 'PAX_VEHICLE_DAMAGE', 'PAX_CONTAMINATION']
        WHEN p_category = 'Physical Assault' AND p_reported_by = 'Passenger' THEN ARRAY['DRV_PHYSICAL_ALTERCATION']
        WHEN p_category IN ('Harassment', 'Threat') AND p_reported_by = 'Passenger' THEN ARRAY['DRV_HARASSMENT']
        WHEN p_category IN ('Physical Assault', 'Harassment', 'Threat') AND p_reported_by = 'Driver' THEN ARRAY['PAX_ABUSIVE_UPHELD']
        ELSE ARRAY[]::TEXT[]
    END;
$$;

-- ----------------------------------------------------------------------------
-- 2. THE REPORT'S NEW COLUMNS
-- ----------------------------------------------------------------------------
ALTER TABLE public.incident_report
    ADD COLUMN IF NOT EXISTS routing              VARCHAR(10) NOT NULL DEFAULT 'TODA',
    ADD COLUMN IF NOT EXISTS priority             VARCHAR(12) NOT NULL DEFAULT 'Standard',
    ADD COLUMN IF NOT EXISTS subject_type         VARCHAR(10),
    ADD COLUMN IF NOT EXISTS source               VARCHAR(10) NOT NULL DEFAULT 'USER',
    ADD COLUMN IF NOT EXISTS filed_during_trip    BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS incident_latitude    DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS incident_longitude   DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS first_action_due_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS first_action_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS decision_due_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS escalated_at         TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS escalated_by         UUID,
    ADD COLUMN IF NOT EXISTS escalation_reason    TEXT,
    ADD COLUMN IF NOT EXISTS outcome              VARCHAR(20),
    ADD COLUMN IF NOT EXISTS decided_by           UUID,
    ADD COLUMN IF NOT EXISTS decided_by_role      VARCHAR(12),
    ADD COLUMN IF NOT EXISTS strike_id            UUID,
    ADD COLUMN IF NOT EXISTS strike_code          VARCHAR(60),
    ADD COLUMN IF NOT EXISTS lost_item_status     VARCHAR(20),
    ADD COLUMN IF NOT EXISTS lost_item_contact_at TIMESTAMPTZ;

ALTER TABLE public.incident_report DROP CONSTRAINT IF EXISTS incident_report_routing_check;
ALTER TABLE public.incident_report ADD CONSTRAINT incident_report_routing_check CHECK (routing IN ('TODA', 'LGU'));
ALTER TABLE public.incident_report DROP CONSTRAINT IF EXISTS incident_report_priority_check;
ALTER TABLE public.incident_report ADD CONSTRAINT incident_report_priority_check CHECK (priority IN ('Standard', 'Emergency', 'Serious'));
ALTER TABLE public.incident_report DROP CONSTRAINT IF EXISTS incident_report_subject_type_check;
ALTER TABLE public.incident_report ADD CONSTRAINT incident_report_subject_type_check CHECK (subject_type IS NULL OR subject_type IN ('driver', 'passenger'));
ALTER TABLE public.incident_report DROP CONSTRAINT IF EXISTS incident_report_source_check;
ALTER TABLE public.incident_report ADD CONSTRAINT incident_report_source_check CHECK (source IN ('USER', 'SYSTEM'));
ALTER TABLE public.incident_report DROP CONSTRAINT IF EXISTS incident_report_outcome_check;
ALTER TABLE public.incident_report ADD CONSTRAINT incident_report_outcome_check CHECK (outcome IS NULL OR outcome IN ('UPHELD', 'NOT_UPHELD', 'FABRICATED', 'RESOLVED', 'UNCLAIMED'));
ALTER TABLE public.incident_report DROP CONSTRAINT IF EXISTS incident_report_decided_by_role_check;
ALTER TABLE public.incident_report ADD CONSTRAINT incident_report_decided_by_role_check CHECK (decided_by_role IS NULL OR decided_by_role IN ('toda_admin', 'lgu_admin'));
ALTER TABLE public.incident_report DROP CONSTRAINT IF EXISTS incident_report_lost_item_status_check;
ALTER TABLE public.incident_report ADD CONSTRAINT incident_report_lost_item_status_check
    CHECK (lost_item_status IS NULL OR lost_item_status IN ('Open', 'Contact Arranged', 'Returned', 'Not Found', 'Unclaimed'));
ALTER TABLE public.incident_report DROP CONSTRAINT IF EXISTS incident_report_strike_id_fkey;
ALTER TABLE public.incident_report ADD CONSTRAINT incident_report_strike_id_fkey FOREIGN KEY (strike_id) REFERENCES public.strikes_ledger(strike_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_incident_report_queue ON public.incident_report (routing, priority, status, created_at);
CREATE INDEX IF NOT EXISTS idx_incident_report_toda_upheld ON public.incident_report (reported_toda_id, resolved_at) WHERE outcome = 'UPHELD';

-- The reports that exist already: who they are about, the escalations the TODA portal wrote as a text prefix, the first action and the outcome the old
-- statuses implied ("Resolved" had no meaning of "upheld", so it becomes RESOLVED and is NOT counted by Rule 2.5; "Dismissed" was a finding that the
-- report is unfounded).
SELECT set_config('sakay.internal_context', 'true', true);
UPDATE public.incident_report
   SET subject_type = CASE reported_by WHEN 'Passenger' THEN 'driver' WHEN 'Driver' THEN 'passenger' END
 WHERE subject_type IS NULL AND reported_by IN ('Passenger', 'Driver') AND public._incident_category_class(category) = 'STANDARD';
UPDATE public.incident_report
   SET routing = 'LGU', escalated_at = COALESCE(escalated_at, resolved_at, created_at), escalation_reason = COALESCE(escalation_reason, 'Escalated by the TODA Administrator (before routing was recorded).')
 WHERE routing = 'TODA' AND status = 'Under Investigation' AND COALESCE(resolution_notes, resolution, '') LIKE '[Escalated to LGU%';
UPDATE public.incident_report
   SET first_action_at = COALESCE(first_action_at, resolved_at, created_at)
 WHERE first_action_at IS NULL AND status NOT IN ('Pending', 'Pending Review');
UPDATE public.incident_report SET outcome = 'RESOLVED' WHERE outcome IS NULL AND status = 'Resolved';
UPDATE public.incident_report SET outcome = 'NOT_UPHELD' WHERE outcome IS NULL AND status = 'Dismissed';
SELECT set_config('sakay.internal_context', '', true);

-- F11.2: the evidence bucket accepts exactly what the screens accept (three photos of 5 MB each; JPEG, PNG or WebP). Before this it took 20 MB, video and PDF.
UPDATE storage.buckets
   SET file_size_limit = public.incident_constant('evidence_max_bytes'),
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
 WHERE id = 'incident-evidence';

-- ----------------------------------------------------------------------------
-- 3. ROUTING, REVIEW CLOCKS AND THE GUARD
-- ----------------------------------------------------------------------------
-- The ONE place a new report gets its routing, priority and review clocks (the guard of a user's report and the system's own reports both call it).
--   Rule 19.3: a report about a trip with a driver goes to that driver's TODA Administrator first (routing TODA).
--   Rule 19.8: alleged assault, harassment, threats or criminal activity go straight to the LGU Administrator (routing LGU, escalated on arrival).
--   F11.1: a safety report (emergency or serious) must have a first action within 4 hours and a decision within 3 business days; a standard report is
--   reviewed by the TODA within 2 business days (the LGU's 3 business days start when it is escalated); a lost item gets its contact within 1 business day.
CREATE OR REPLACE FUNCTION public._incident_set_routing(p public.incident_report)
RETURNS public.incident_report
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_class TEXT := COALESCE(public._incident_category_class(p.category), 'STANDARD');
    v_now TIMESTAMPTZ := COALESCE(p.created_at, CURRENT_TIMESTAMP);
BEGIN
    p.priority := CASE v_class WHEN 'SERIOUS' THEN 'Serious' WHEN 'EMERGENCY' THEN 'Emergency' ELSE 'Standard' END;
    p.routing := CASE WHEN v_class = 'SERIOUS' THEN 'LGU' ELSE 'TODA' END;
    p.escalated_at := NULL;
    p.escalated_by := NULL;
    p.escalation_reason := NULL;
    IF v_class = 'SERIOUS' THEN
        p.escalated_at := v_now;
        p.escalation_reason := 'Alleged assault, harassment, threat or criminal activity goes straight to the LGU Administrator (Rule 19.8).';
    END IF;
    IF v_class IN ('SERIOUS', 'EMERGENCY') THEN
        p.first_action_due_at := v_now + make_interval(hours => public.incident_constant('safety_first_action_hours'));
        p.decision_due_at := public.add_business_days(v_now, public.incident_constant('safety_decision_business_days'));
    ELSIF v_class = 'LOST_ITEM' THEN
        p.first_action_due_at := public.add_business_days(v_now, public.incident_constant('lost_item_contact_business_days'));
        p.decision_due_at := NULL;
        p.lost_item_status := 'Open';
    ELSE
        p.first_action_due_at := public.add_business_days(v_now, public.incident_constant('standard_first_review_business_days'));
        p.decision_due_at := NULL;
    END IF;
    RETURN p;
END;
$$;

-- Which administrator is acting on a report: the LGU Administrator (any report), or the TODA Administrator of the reported driver's TODA.
CREATE OR REPLACE FUNCTION public._incident_actor(p_i public.incident_report)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF COALESCE(public.is_lgu_admin(), FALSE) THEN
        RETURN 'lgu_admin';
    END IF;
    IF COALESCE(public.is_toda_admin(), FALSE)
       AND ((p_i.reported_toda_id IS NOT NULL AND p_i.reported_toda_id = public.get_current_toda_admin_toda_id())
            OR COALESCE(public.is_toda_admin_for_driver(p_i.driver_id), FALSE)) THEN
        RETURN 'toda_admin';
    END IF;
    RAISE EXCEPTION 'Access Denied: This report is not assigned to you.';
END;
$$;

-- The system files a report of its own (the passenger ended the trip for a safety concern, the driver stopped it for an accident or an emergency,
-- an administrator ended it for safety). One safety report per party per trip: when that party already filed one, that one is returned and nothing
-- is added (decision PI-11D: End Trip (Early) creates the Urgent Safety Report only "if none exists"). Everything the guard derives for a user's
-- report is derived here from the booking.
CREATE OR REPLACE FUNCTION public._incident_auto_file(p_booking_id UUID, p_reported_by TEXT, p_category TEXT, p_description TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_b public.booking;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_row public.incident_report;
    v_pt JSONB;
    v_existing UUID;
BEGIN
    IF p_reported_by IS NULL OR p_reported_by NOT IN ('Passenger', 'Driver', 'System')
       OR COALESCE(public._incident_category_class(p_category), '') NOT IN ('EMERGENCY', 'SERIOUS') THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id;
    IF NOT FOUND OR v_b.driver_id IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT r.incident_id INTO v_existing
      FROM public.incident_report r
     WHERE r.booking_id = p_booking_id AND r.reported_by = p_reported_by AND r.status <> 'Cancelled'
       AND public._incident_category_class(r.category) IN ('EMERGENCY', 'SERIOUS')
     ORDER BY r.created_at LIMIT 1;
    IF v_existing IS NOT NULL THEN
        RETURN v_existing;
    END IF;

    v_pt := public._early_end_point(v_b.driver_id, p_booking_id);
    v_row.incident_id := gen_random_uuid();
    v_row.booking_id := p_booking_id;
    v_row.passenger_id := v_b.passenger_id;
    v_row.driver_id := v_b.driver_id;
    v_row.reported_by := p_reported_by;
    v_row.category := p_category;
    v_row.description := left(btrim(p_description), 2000);
    v_row.status := 'Pending';
    v_row.created_at := CURRENT_TIMESTAMP;
    v_row.evidence_paths := '{}';
    v_row.reported_toda_id := COALESCE((SELECT d.toda_id FROM public.driver d WHERE d.driver_id = v_b.driver_id), v_b.toda_id);
    v_row.source := 'SYSTEM';
    v_row.filed_during_trip := public._booking_phase(v_b.booking_status) IN ('assigned', 'arrived', 'ongoing', 'at_destination');
    v_row.incident_latitude := (v_pt->>'lat')::DOUBLE PRECISION;
    v_row.incident_longitude := (v_pt->>'lng')::DOUBLE PRECISION;
    v_row := public._incident_set_routing(v_row);

    PERFORM set_config('sakay.internal_context', 'true', true);
    INSERT INTO public.incident_report SELECT * FROM jsonb_populate_record(NULL::public.incident_report, to_jsonb(v_row));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN v_row.incident_id;
END;
$$;

-- THE GUARD (replaces 20261024000001: Rule 16.5 there; the category list, the routing, the clocks, the evidence limits and the end of the portals'
-- direct writes are new). Trusted callers (the service role, the policy engine and the functions of this migration, a direct database session) pass.
CREATE OR REPLACE FUNCTION public.incident_report_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_trusted BOOLEAN := COALESCE(public.is_trusted_session(), FALSE);
    v_uid     UUID := auth.uid();
    v_pax     UUID;
    v_drv     UUID;
    v_b       public.booking;
    v_toda    UUID;
    v_class   TEXT;
    v_pt      JSONB;
    v_phase   TEXT;
    v_max     INTEGER := public.incident_constant('evidence_max_files');
BEGIN
    -- ===================== INSERT =====================
    IF TG_OP = 'INSERT' THEN
        NEW.category    := btrim(COALESCE(NEW.category, ''));
        NEW.description := btrim(COALESCE(NEW.description, ''));
        IF v_trusted THEN
            RETURN NEW;
        END IF;

        v_class := public._incident_category_class(NEW.category);
        IF NEW.category = '' OR length(NEW.category) > 100 OR v_class IS NULL THEN
            RAISE EXCEPTION 'ERR_INCIDENT_INVALID: Pumili ng uri ng insidente mula sa listahan. (Choose an incident category from the list.)';
        END IF;
        IF NEW.description = '' OR length(NEW.description) > 2000 THEN
            RAISE EXCEPTION 'ERR_INCIDENT_INVALID: Isulat ang detalye ng insidente (hanggang 2000 na titik). (Describe the incident, up to 2000 characters.)';
        END IF;

        SELECT * INTO v_b FROM public.booking WHERE booking_id = NEW.booking_id;
        IF v_b.booking_id IS NULL THEN
            RAISE EXCEPTION 'ERR_INCIDENT_BOOKING: Hindi nahanap ang biyahe. (The trip was not found.)';
        END IF;
        -- Rule 16.5: a report is made after the trip is completed, except for an emergency incident (an emergency or a serious allegation,
        -- decision PI-11A: the list is Emergency, Medical Emergency, Safety Concern, Accident, and the four serious categories of Rule 19.8)
        IF v_b.booking_status IS DISTINCT FROM 'Completed' AND v_class NOT IN ('EMERGENCY', 'SERIOUS') THEN
            RAISE EXCEPTION 'ERR_INCIDENT_AFTER_TRIP: Makapag-uulat lamang pagkatapos ng biyahe, maliban sa emergency. (A report can be made only after the trip is completed, except for an emergency incident.)';
        END IF;
        -- F11.4: a Lost Item report is filed within 7 days of the trip
        IF v_class = 'LOST_ITEM'
           AND COALESCE(v_b.trip_completed_at, v_b.created_at) < CURRENT_TIMESTAMP - make_interval(days => public.incident_constant('lost_item_file_days')) THEN
            RAISE EXCEPTION 'ERR_INCIDENT_LOST_ITEM_WINDOW: Lumipas na ang % araw mula sa biyahe; makipag-ugnayan sa TODA. (A lost item must be reported within % days of the trip; contact the TODA directly.)',
                public.incident_constant('lost_item_file_days'), public.incident_constant('lost_item_file_days');
        END IF;

        v_pax := public.get_current_passenger_id();
        v_drv := public.get_current_driver_id();
        IF v_pax IS NOT NULL AND v_b.passenger_id = v_pax THEN
            NEW.reported_by := 'Passenger';
            NEW.passenger_id := v_pax;
            NEW.driver_id := v_b.driver_id;
        ELSIF v_drv IS NOT NULL AND v_b.driver_id = v_drv THEN
            NEW.reported_by := 'Driver';
            NEW.driver_id := v_drv;
            NEW.passenger_id := v_b.passenger_id;
        ELSE
            RAISE EXCEPTION 'ERR_INCIDENT_NOT_PARTICIPANT: Makapag-uulat ka lamang tungkol sa biyaheng sinakyan o minaneho mo. (You can only report a trip you took part in.)';
        END IF;

        IF NEW.driver_id IS NULL THEN
            RAISE EXCEPTION 'ERR_INCIDENT_NO_DRIVER: Walang drayber ang biyaheng ito. (This trip never had a driver.)';
        END IF;

        SELECT d.toda_id INTO v_toda FROM public.driver d WHERE d.driver_id = NEW.driver_id;
        NEW.reported_toda_id := COALESCE(v_toda, v_b.toda_id);

        -- Who the report is about (only a standard report names a party; an emergency, a lost item or a safety report assigns no fault, Rule 19.7)
        NEW.subject_type := CASE WHEN v_class = 'STANDARD' THEN CASE NEW.reported_by WHEN 'Passenger' THEN 'driver' ELSE 'passenger' END END;
        NEW.source := 'USER';
        v_phase := public._booking_phase(v_b.booking_status);
        NEW.filed_during_trip := v_phase IN ('assigned', 'arrived', 'ongoing', 'at_destination');
        IF NEW.filed_during_trip THEN
            v_pt := public._early_end_point(NEW.driver_id, NEW.booking_id);       -- where the vehicle was (nothing is guessed: NULL when unknown)
        END IF;
        NEW.incident_latitude := (v_pt->>'lat')::DOUBLE PRECISION;
        NEW.incident_longitude := (v_pt->>'lng')::DOUBLE PRECISION;

        -- The review state always starts empty, whatever the request said.
        NEW.status := 'Pending';
        NEW.reviewed_by_toda := NULL;
        NEW.reviewed_by_lgu := NULL;
        NEW.resolution := NULL;
        NEW.resolution_notes := NULL;
        NEW.resolved_at := NULL;
        NEW.cancellation_reason := NULL;
        NEW.outcome := NULL;
        NEW.decided_by := NULL;
        NEW.decided_by_role := NULL;
        NEW.strike_id := NULL;
        NEW.strike_code := NULL;
        NEW.first_action_at := NULL;
        NEW.lost_item_status := NULL;
        NEW.lost_item_contact_at := NULL;
        NEW.created_at := CURRENT_TIMESTAMP;
        NEW := public._incident_set_routing(NEW);

        -- Evidence (F11.2): at most 3 photos, every one inside the reporter's own storage folder, JPEG / PNG / WebP.
        NEW.evidence_paths := COALESCE(NEW.evidence_paths, '{}');
        IF cardinality(NEW.evidence_paths) > v_max THEN
            RAISE EXCEPTION 'ERR_INCIDENT_EVIDENCE: Hanggang % larawan lamang. (At most % photos.)', v_max, v_max;
        END IF;
        IF EXISTS (SELECT 1 FROM unnest(NEW.evidence_paths) p
                    WHERE p NOT LIKE v_uid::TEXT || '/%' OR p LIKE '%..%') THEN
            RAISE EXCEPTION 'ERR_INCIDENT_EVIDENCE: Hindi tamang lokasyon ng larawan. (The photo must be in your own folder.)';
        END IF;
        IF EXISTS (SELECT 1 FROM unnest(NEW.evidence_paths) p WHERE p !~* '\.(jpe?g|png|webp)$') THEN
            RAISE EXCEPTION 'ERR_INCIDENT_EVIDENCE: JPEG, PNG o WebP lamang. (Only JPEG, PNG or WebP photos.)';
        END IF;
        RETURN NEW;
    END IF;

    -- ===================== UPDATE =====================
    IF v_trusted THEN
        RETURN NEW;
    END IF;

    -- The facts of a report never change, for anybody.
    IF NEW.incident_id IS DISTINCT FROM OLD.incident_id
       OR NEW.booking_id IS DISTINCT FROM OLD.booking_id
       OR NEW.passenger_id IS DISTINCT FROM OLD.passenger_id
       OR NEW.driver_id IS DISTINCT FROM OLD.driver_id
       OR NEW.reported_by IS DISTINCT FROM OLD.reported_by
       OR NEW.reported_toda_id IS DISTINCT FROM OLD.reported_toda_id
       OR NEW.category IS DISTINCT FROM OLD.category
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.evidence_paths IS DISTINCT FROM OLD.evidence_paths
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'ERR_INCIDENT_LOCKED: Hindi na maaaring baguhin ang nilalaman ng ulat. (A submitted report cannot be edited.)';
    END IF;

    -- Batch 11: an administrator reviews a report ONLY through the review functions (start review, escalate, decide, lost item): routing, outcome, the
    -- strike and the audit entry are written together, atomically, by the database. A direct write from a browser is refused.
    IF COALESCE(public.is_lgu_admin(), FALSE) OR COALESCE(public.is_toda_admin(), FALSE) THEN
        RAISE EXCEPTION 'ERR_INCIDENT_USE_REVIEW: Gamitin ang mga aksyon sa pagsusuri ng ulat. (Use the review actions of the report; a report is not edited directly.)';
    END IF;

    -- Anybody else who got past the row policy is the reporting party: the only change allowed is withdrawing a Pending report.
    IF OLD.status = 'Pending'
       AND NEW.status = 'Cancelled'
       AND btrim(COALESCE(NEW.cancellation_reason, '')) <> ''
       AND (to_jsonb(NEW) - 'status' - 'cancellation_reason') = (to_jsonb(OLD) - 'status' - 'cancellation_reason') THEN
        NEW.cancellation_reason := btrim(NEW.cancellation_reason);
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'ERR_INCIDENT_LOCKED: Maaari mo lamang bawiin ang ulat na hindi pa nasusuri. (Only a report that has not been reviewed yet can be withdrawn.)';
END;
$$;

-- The strike engine (replaces 20261004000002): more exempt reasons for the safe reasons of PI-11B, and the one way a TODA Administrator may confirm a
-- strike on a passenger or an automatic-mode violation: a function that has already checked the administrator's authority over the report or the flag
-- sets sakay.admin_confirm (incident_decide, admin_confirm_flagged_violation). A signed-in user cannot set it: it is a transaction setting only these
-- SECURITY DEFINER functions write.
CREATE OR REPLACE FUNCTION public.issue_strike(
    p_subject_type TEXT,
    p_subject_id UUID,
    p_violation_code TEXT,
    p_points INTEGER DEFAULT NULL,
    p_booking_id UUID DEFAULT NULL,
    p_incident_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL,
    p_provisional BOOLEAN DEFAULT NULL,
    p_reason TEXT DEFAULT NULL,
    p_exempt_reason TEXT DEFAULT NULL,
    p_details JSONB DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_cat public.violation_catalog;
    v_existing public.strikes_ledger;
    v_row public.strikes_ledger;
    v_is_service BOOLEAN := public.is_service_context();
    v_is_lgu BOOLEAN := public.is_lgu_admin();
    v_actor UUID := auth.uid();
    v_actor_role TEXT;
    v_name TEXT;
    v_toda UUID;
    v_points INTEGER;
    v_cfg JSONB;
    v_scope TEXT;
    v_pause_id UUID;
    v_prior INTEGER;
    v_mode TEXT := 'NORMAL';
    v_status TEXT;
    v_active INTEGER;
    v_provisional BOOLEAN;
    v_strike_id UUID;
    v_before INTEGER;
    v_after INTEGER;
    v_state_before JSONB;
    v_state_after JSONB;
    v_crossed INTEGER := 0;
    v_t_warn INTEGER := public.strike_policy_constant('warning_threshold');
    v_t_review INTEGER := public.strike_policy_constant('review_threshold');
    v_t_s1 INTEGER := public.strike_policy_constant('suspension_1_threshold');
    v_t_s2 INTEGER := public.strike_policy_constant('suspension_2_threshold');
    v_t_deact INTEGER := public.strike_policy_constant('deactivation_threshold');
    v_consequence TEXT := NULL;
    v_until TIMESTAMPTZ;
    v_days INTEGER;
    v_flag_role TEXT;
    v_title TEXT;
    v_msg TEXT;
BEGIN
    IF p_subject_type NOT IN ('passenger', 'driver') THEN
        RAISE EXCEPTION 'Unknown subject type %', p_subject_type;
    END IF;

    SELECT * INTO v_cat FROM public.violation_catalog
    WHERE violation_code = p_violation_code AND is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown or inactive violation code %', p_violation_code;
    END IF;
    IF v_cat.applies_to <> p_subject_type THEN
        RAISE EXCEPTION 'Violation % applies to %, not %', p_violation_code, v_cat.applies_to, p_subject_type;
    END IF;

    -- Lock the subject row: concurrent strikes for one account are serialized.
    IF p_subject_type = 'passenger' THEN
        SELECT full_name, NULL::UUID INTO v_name, v_toda FROM public.passenger WHERE passenger_id = p_subject_id FOR UPDATE;
    ELSE
        SELECT full_name, toda_id INTO v_name, v_toda FROM public.driver WHERE driver_id = p_subject_id FOR UPDATE;
    END IF;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Subject not found';
    END IF;

    -- Authorization
    IF v_is_service THEN
        v_actor_role := 'system';
    ELSIF v_is_lgu THEN
        v_actor_role := 'lgu_admin';
    ELSIF public.is_toda_admin() AND p_subject_type = 'driver'
          AND v_toda IS NOT NULL AND v_toda = public.get_current_toda_admin_toda_id()
          AND v_cat.confirmation_mode <> 'AUTOMATIC' THEN
        v_actor_role := 'toda_admin';
    -- Batch 11: a TODA Administrator inside a function that has checked their authority (decisions PI-11B, PI-11E)
    ELSIF public.is_toda_admin() AND COALESCE(current_setting('sakay.admin_confirm', true), '') = 'true'
          AND (p_subject_type = 'passenger' OR (v_toda IS NOT NULL AND v_toda = public.get_current_toda_admin_toda_id())) THEN
        v_actor_role := 'toda_admin';
    ELSE
        RAISE EXCEPTION 'Access Denied: You are not allowed to issue this strike.';
    END IF;

    -- Idempotency: a repeated call with the same key changes nothing.
    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing FROM public.strikes_ledger WHERE idempotency_key = p_idempotency_key;
        IF FOUND THEN
            RETURN jsonb_build_object('success', TRUE, 'idempotent', TRUE,
                'strike_id', v_existing.strike_id, 'status', v_existing.status);
        END IF;
    END IF;

    IF v_cat.confirmation_mode = 'ADMIN_CONFIRMATION' AND (p_reason IS NULL OR length(btrim(p_reason)) = 0) THEN
        RAISE EXCEPTION 'A confirmation reason is required for % (administrator-confirmed violation).', p_violation_code;
    END IF;

    v_points := COALESCE(p_points, v_cat.default_points);
    IF v_points < v_cat.min_points OR v_points > v_cat.max_points THEN
        RAISE EXCEPTION 'Points % are outside the allowed range % to % for %',
            v_points, v_cat.min_points, v_cat.max_points, p_violation_code;
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);

    v_before := public.get_active_strike_count(p_subject_type, p_subject_id);
    v_state_before := public.account_restriction_state(p_subject_type, p_subject_id);

    -- Decide how this event is recorded ------------------------------------
    v_cfg := (SELECT config_value FROM public.system_policy_config WHERE config_key = 'strike_accrual_paused');
    v_scope := COALESCE(v_cfg->>'scope', 'ALL');

    IF p_exempt_reason IS NOT NULL THEN
        IF p_exempt_reason NOT IN ('SAFETY_INCIDENT_VICTIM', 'TRAFFIC_ACCIDENT', 'FORCE_MAJEURE', 'VEHICLE_BREAKDOWN', 'EMERGENCY', 'LAWFUL_REFUSAL') THEN   -- Batch 11: three more
            RAISE EXCEPTION 'Unknown exempt reason %', p_exempt_reason;
        END IF;
        IF p_exempt_reason IN ('TRAFFIC_ACCIDENT', 'VEHICLE_BREAKDOWN', 'LAWFUL_REFUSAL') AND p_subject_type <> 'driver' THEN
            RAISE EXCEPTION '% applies to drivers only (Rules 15.1, 15.5, 29.13).', p_exempt_reason;
        END IF;
        v_mode := 'EXEMPT';
    ELSIF COALESCE((v_cfg->>'paused')::BOOLEAN, FALSE) AND v_cat.pausable
          AND (v_scope = 'ALL' OR (v_scope = 'CANCEL_STALL_NOSHOW' AND v_cat.event_category IN ('CANCELLATION', 'STALL', 'NO_SHOW'))) THEN
        v_mode := 'PAUSED';
        v_pause_id := NULLIF(v_cfg->>'pause_id', '')::UUID;
    ELSIF v_cat.repeat_min_occurrences > 1 THEN
        SELECT COUNT(*) INTO v_prior FROM public.strikes_ledger
        WHERE subject_type = p_subject_type AND subject_id = p_subject_id AND violation_code = p_violation_code
          AND status <> 'VOIDED'
          AND issued_at > CURRENT_TIMESTAMP - make_interval(days => public.strike_policy_constant('repeat_violation_window_days'));
        IF v_prior + 1 < v_cat.repeat_min_occurrences THEN
            v_mode := 'OBSERVED';
        END IF;
    END IF;

    IF v_mode = 'NORMAL' AND v_cat.ladder_bypass <> 'NONE' THEN
        v_mode := 'BYPASS';
    END IF;

    v_provisional := COALESCE(p_provisional, v_cat.provisional_by_default) AND v_cat.exemption_eligible AND v_points > 0;

    v_status := CASE v_mode
        WHEN 'EXEMPT' THEN 'AUTO_WAIVED'
        WHEN 'PAUSED' THEN 'AUTO_WAIVED'
        WHEN 'OBSERVED' THEN 'OBSERVED'
        WHEN 'BYPASS' THEN 'ACTIVE'
        WHEN 'NORMAL' THEN CASE WHEN v_provisional THEN 'PROVISIONAL' ELSE 'ACTIVE' END
    END;
    v_active := CASE WHEN v_mode = 'NORMAL' THEN v_points ELSE 0 END;

    IF p_subject_type = 'driver' THEN
        v_flag_role := CASE WHEN v_cat.ladder_bypass = 'ADMIN_REVIEW_ONLY' THEN 'toda_admin' ELSE 'lgu_admin' END;
    ELSE
        v_flag_role := 'lgu_admin';
    END IF;

    INSERT INTO public.strikes_ledger (
        subject_type, subject_id, violation_code, source_rule, status, points_issued, points_active,
        provisional_until, booking_id, incident_id, toda_id, reason, details, exempt_reason, pause_id,
        idempotency_key, issued_by, issued_by_role
    ) VALUES (
        p_subject_type, p_subject_id, p_violation_code, v_cat.source_rule, v_status,
        CASE WHEN v_mode = 'BYPASS' THEN 0 ELSE v_points END, v_active,
        CASE WHEN v_status = 'PROVISIONAL'
             THEN CURRENT_TIMESTAMP + make_interval(hours => public.strike_policy_constant('exemption_window_hours')) END,
        p_booking_id, p_incident_id, v_toda, p_reason, p_details, p_exempt_reason, v_pause_id,
        p_idempotency_key, v_actor, v_actor_role
    ) RETURNING * INTO v_row;
    v_strike_id := v_row.strike_id;

    -- Non-counting outcomes: recorded, nothing else changes ----------------
    IF v_mode IN ('PAUSED', 'OBSERVED') THEN
        PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
        RETURN jsonb_build_object('success', TRUE, 'strike_id', v_strike_id, 'status', v_status,
            'paused', v_mode = 'PAUSED', 'observed', v_mode = 'OBSERVED', 'points', 0,
            'active_before', v_before, 'active_after', v_before);
    END IF;

    IF v_mode = 'EXEMPT' THEN
        PERFORM public.record_policy_audit('STRIKE_AUTO_WAIVED', p_subject_id::TEXT, v_name, 'Strikes & Suspensions',
            'Event ' || p_violation_code || ' recorded without a strike (' || p_exempt_reason || ').',
            jsonb_build_object('active_strikes', v_before), to_jsonb(v_row));
        PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
        RETURN jsonb_build_object('success', TRUE, 'strike_id', v_strike_id, 'status', v_status,
            'exempt', TRUE, 'points', 0, 'active_before', v_before, 'active_after', v_before);
    END IF;

    -- Ladder bypass (immediate escalation / review only) --------------------
    IF v_mode = 'BYPASS' THEN
        IF v_cat.ladder_bypass = 'SUSPEND_PENDING_INVESTIGATION' THEN
            PERFORM public._apply_suspension(p_subject_type, p_subject_id, NULL, 'INVESTIGATION',
                'Suspended pending investigation: ' || v_cat.description, v_strike_id, NULL);
            PERFORM public.create_admin_review_flag('IMMEDIATE_ESCALATION', p_subject_type, p_subject_id::TEXT,
                v_cat.source_rule, 'lgu_admin',
                jsonb_build_object('violation_code', p_violation_code, 'strike_id', v_strike_id, 'reason', p_reason));
            v_consequence := 'INVESTIGATION_SUSPENSION';
            v_title := 'Suspendido ang Iyong Account';
            v_msg := 'Pansamantalang sinuspinde ang iyong account habang iniimbestigahan ang: ' || v_cat.description ||
                     '. (Your account is suspended pending investigation.)';
        ELSIF v_cat.ladder_bypass = 'DEACTIVATE_FOR_REVIEW' THEN
            PERFORM public._apply_deactivation(p_subject_type, p_subject_id, 'Deactivated for review: ' || v_cat.description, v_strike_id);
            PERFORM public.create_admin_review_flag('DEACTIVATION_REVIEW', p_subject_type, p_subject_id::TEXT,
                v_cat.source_rule, 'lgu_admin',
                jsonb_build_object('violation_code', p_violation_code, 'strike_id', v_strike_id, 'reason', p_reason));
            v_consequence := 'DEACTIVATION';
            v_title := 'Na-deactivate ang Iyong Account';
            v_msg := 'Na-deactivate ang iyong account para sa pagsusuri: ' || v_cat.description ||
                     '. (Your account is deactivated pending administrator review.)';
        ELSE
            PERFORM public.create_admin_review_flag(COALESCE(v_cat.review_flag_type, 'IMMEDIATE_REVIEW'), p_subject_type,
                p_subject_id::TEXT, v_cat.source_rule, v_flag_role,
                jsonb_build_object('violation_code', p_violation_code, 'strike_id', v_strike_id, 'reason', p_reason));
            v_consequence := 'ADMIN_REVIEW';
        END IF;

        v_state_after := public.account_restriction_state(p_subject_type, p_subject_id);
        PERFORM public.record_policy_audit('STRIKE_ESCALATED', p_subject_id::TEXT, v_name, 'Strikes & Suspensions',
            p_violation_code || ' (' || v_cat.source_rule || ') bypassed the ladder: ' || v_consequence || '.',
            v_state_before, jsonb_build_object('restriction', v_state_after, 'strike', to_jsonb(v_row)));
        IF v_title IS NOT NULL THEN
            PERFORM public._notify_subject(p_subject_type, p_subject_id, 'ACCOUNT_RESTRICTION_NOTICE',
                v_title, v_msg, v_strike_id::TEXT, 0);
        END IF;
        PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
        RETURN jsonb_build_object('success', TRUE, 'strike_id', v_strike_id, 'status', v_status,
            'consequence', v_consequence, 'points', 0, 'active_before', v_before, 'active_after', v_before);
    END IF;

    -- Normal strike: evaluate the ladder ------------------------------------
    v_after := public.get_active_strike_count(p_subject_type, p_subject_id);

    IF p_subject_type = 'passenger' THEN
        UPDATE public.passenger SET strikes_count = v_after WHERE passenger_id = p_subject_id;
    ELSE
        UPDATE public.driver SET strikes_count = v_after WHERE driver_id = p_subject_id;
    END IF;

    IF v_before < v_t_warn   AND v_after >= v_t_warn   THEN v_crossed := v_t_warn;   END IF;
    IF v_before < v_t_review AND v_after >= v_t_review THEN v_crossed := v_t_review; END IF;
    IF v_before < v_t_s1     AND v_after >= v_t_s1     THEN v_crossed := v_t_s1;     END IF;
    IF v_before < v_t_s2     AND v_after >= v_t_s2     THEN v_crossed := v_t_s2;     END IF;
    IF v_before < v_t_deact  AND v_after >= v_t_deact  THEN v_crossed := v_t_deact;  END IF;

    IF v_after >= v_t_deact AND COALESCE(v_state_before->>'kind', '') NOT IN ('DEACTIVATED', 'CLOSED') THEN
        -- Top tier fires on crossing AND for a reinstated account still at/over the threshold.
        PERFORM public._apply_deactivation(p_subject_type, p_subject_id,
            v_after || ' active strikes within 90 days (' || p_violation_code || ')', v_strike_id);
        PERFORM public.create_admin_review_flag('DEACTIVATION_REVIEW', p_subject_type, p_subject_id::TEXT,
            'Sections 20/21', 'lgu_admin',
            jsonb_build_object('active_strikes', v_after, 'strike_id', v_strike_id));
        v_consequence := 'DEACTIVATION';
    ELSIF v_crossed >= v_t_s2 THEN
        v_days := public.strike_policy_constant('suspension_2_days');
        v_until := public._apply_suspension(p_subject_type, p_subject_id, CURRENT_TIMESTAMP + make_interval(days => v_days), 'LADDER',
            v_after || ' active strikes within 90 days (' || p_violation_code || ')', v_strike_id, v_t_s2);
        v_consequence := 'SUSPENSION';
    ELSIF v_crossed >= v_t_s1 THEN
        v_days := public.strike_policy_constant('suspension_1_days');
        v_until := public._apply_suspension(p_subject_type, p_subject_id, CURRENT_TIMESTAMP + make_interval(days => v_days), 'LADDER',
            v_after || ' active strikes within 90 days (' || p_violation_code || ')', v_strike_id, v_t_s1);
        v_consequence := 'SUSPENSION';
    ELSIF v_crossed >= v_t_review THEN
        v_consequence := 'ADMIN_REVIEW';
    ELSIF v_crossed >= v_t_warn THEN
        v_consequence := 'WARNING';
    END IF;

    -- Administrative review at 3 strikes (also raised when a larger jump crosses 3).
    IF v_before < v_t_review AND v_after >= v_t_review THEN
        PERFORM public.create_admin_review_flag('ADMIN_REVIEW_3_STRIKES', p_subject_type, p_subject_id::TEXT,
            'Sections 20/21', CASE WHEN p_subject_type = 'driver' THEN 'toda_admin' ELSE 'lgu_admin' END,
            jsonb_build_object('active_strikes', v_after, 'strike_id', v_strike_id));
    END IF;

    -- A new violation during a suspension is left to TODA/LGU discretion (22.1).
    IF v_points > 0 AND COALESCE(v_state_before->>'kind', '') IN ('SUSPENDED', 'INVESTIGATION') THEN
        PERFORM public.create_admin_review_flag('SUSPENSION_NEW_VIOLATION', p_subject_type, p_subject_id::TEXT,
            'Rule 22.1', 'lgu_admin',
            jsonb_build_object('violation_code', p_violation_code, 'strike_id', v_strike_id, 'active_strikes', v_after));
    END IF;

    v_state_after := public.account_restriction_state(p_subject_type, p_subject_id);

    PERFORM public.record_policy_audit('STRIKE_ISSUED', p_subject_id::TEXT, v_name, 'Strikes & Suspensions',
        'Issued ' || v_points || ' strike(s) for ' || p_violation_code || ' (' || v_cat.source_rule || '). Active strikes: '
            || v_before || ' -> ' || v_after || COALESCE('. Consequence: ' || v_consequence, '') || '. ' || COALESCE(p_reason, ''),
        jsonb_build_object('active_strikes', v_before, 'restriction', v_state_before),
        jsonb_build_object('active_strikes', v_after, 'restriction', v_state_after, 'strike', to_jsonb(v_row)));

    -- Notices (Abiso): one per strike, plus one for any restriction.
    v_title := CASE WHEN v_before < v_t_warn THEN 'Babala: May Strike sa Iyong Account' ELSE 'May Bagong Strike sa Iyong Account' END;
    v_msg := 'Nakatanggap ka ng ' || v_points || ' strike: ' || v_cat.description || '. Aktibong strike: ' || v_after ||
             '.' || CASE WHEN v_cat.exemption_eligible
                         THEN ' May ' || public.strike_policy_constant('exemption_window_hours') || ' oras ka para humiling ng exemption.' ELSE '' END ||
             ' (You received ' || v_points || ' strike(s). Active strikes: ' || v_after || '.)';
    PERFORM public._notify_subject(p_subject_type, p_subject_id, 'STRIKE_ISSUED', v_title, v_msg, v_strike_id::TEXT, 0);

    IF v_consequence = 'SUSPENSION' THEN
        PERFORM public._notify_subject(p_subject_type, p_subject_id, 'ACCOUNT_RESTRICTION_NOTICE',
            'Suspendido ang Iyong Account',
            'Suspendido ang iyong account hanggang ' || public._fmt_manila(v_until) || ' dahil sa ' || v_after ||
            ' aktibong strike. (Your account is suspended until ' || public._fmt_manila(v_until) || '.)',
            v_strike_id::TEXT, v_crossed);
    ELSIF v_consequence = 'DEACTIVATION' THEN
        PERFORM public._notify_subject(p_subject_type, p_subject_id, 'ACCOUNT_RESTRICTION_NOTICE',
            'Na-deactivate ang Iyong Account',
            'Na-deactivate ang iyong account dahil sa ' || v_after || ' aktibong strike. Susuriin ito ng LGU. ' ||
            '(Your account is deactivated pending LGU review.)',
            v_strike_id::TEXT, v_t_deact);
    END IF;

    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object(
        'success', TRUE, 'strike_id', v_strike_id, 'status', v_status, 'points', v_points,
        'active_before', v_before, 'active_after', v_after,
        'consequence', v_consequence, 'suspended_until', v_until, 'provisional', v_status = 'PROVISIONAL');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 4. THE REVIEW FUNCTIONS (the only way an administrator changes a report: audited, idempotent, atomic)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._incident_admin_id(p_role TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT CASE p_role
        WHEN 'lgu_admin'  THEN (SELECT a.admin_id FROM public.lgu_admin a WHERE a.auth_user_id = auth.uid() LIMIT 1)
        WHEN 'toda_admin' THEN (SELECT a.admin_id FROM public.toda_admin a WHERE a.auth_user_id = auth.uid() LIMIT 1)
    END;
$$;

-- A notice (Abiso) to the party who filed the report
CREATE OR REPLACE FUNCTION public._incident_notify_reporter(p_i public.incident_report, p_type TEXT, p_title TEXT, p_message TEXT, p_threshold INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_i.reported_by = 'Passenger' AND p_i.passenger_id IS NOT NULL THEN
        PERFORM public._notify_subject('passenger', p_i.passenger_id, p_type, p_title, p_message, p_i.incident_id::TEXT, p_threshold);
    ELSIF p_i.reported_by = 'Driver' AND p_i.driver_id IS NOT NULL THEN
        PERFORM public._notify_subject('driver', p_i.driver_id, p_type, p_title, p_message, p_i.incident_id::TEXT, p_threshold);
    END IF;
END;
$$;

-- A notice to the party the report is NOT from (the other side of the trip)
CREATE OR REPLACE FUNCTION public._incident_notify_other(p_i public.incident_report, p_type TEXT, p_title TEXT, p_message TEXT, p_threshold INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_i.reported_by = 'Passenger' AND p_i.driver_id IS NOT NULL THEN
        PERFORM public._notify_subject('driver', p_i.driver_id, p_type, p_title, p_message, p_i.incident_id::TEXT, p_threshold);
    ELSIF p_i.reported_by = 'Driver' AND p_i.passenger_id IS NOT NULL THEN
        PERFORM public._notify_subject('passenger', p_i.passenger_id, p_type, p_title, p_message, p_i.incident_id::TEXT, p_threshold);
    END IF;
END;
$$;

-- Rule 26.4: a confirmed victim of a safety incident is never struck for it. Every strike still counting against the victim on the booking of the
-- report that came from the trip's own events (no-show, late cancellation, stall ...: not the finding of another report) is waived (one audit entry); the ladder is re-evaluated (a suspension those strikes caused is lifted, as for any waiver).
CREATE OR REPLACE FUNCTION public._waive_victim_strikes(p_booking_id UUID, p_subject_type TEXT, p_subject_id UUID, p_incident_id UUID, p_reason TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    r public.strikes_ledger;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_n INTEGER := 0;
    v_ids UUID[] := '{}';
BEGIN
    IF p_subject_id IS NULL THEN
        RETURN 0;
    END IF;
    PERFORM set_config('sakay.internal_context', 'true', true);
    FOR r IN
        SELECT * FROM public.strikes_ledger s
         WHERE s.booking_id = p_booking_id AND s.subject_type = p_subject_type AND s.subject_id = p_subject_id
           AND s.status IN ('ACTIVE', 'PROVISIONAL') AND s.points_active > 0
           AND s.incident_id IS NULL                      -- the events of the trip (a no-show, a late cancellation ...), not the findings of another report
         ORDER BY s.issued_at FOR UPDATE
    LOOP
        UPDATE public.strikes_ledger
           SET points_active = 0, status = 'WAIVED', resolved_at = CURRENT_TIMESTAMP, resolved_by = auth.uid(),
               resolution_reason = 'Confirmed victim of a safety incident (Rule 26.4): ' || left(p_reason, 400)
         WHERE strike_id = r.strike_id;
        PERFORM public._reevaluate_after_waiver(r.subject_type, r.subject_id, r.strike_id);
        v_n := v_n + 1;
        v_ids := v_ids || r.strike_id;
    END LOOP;
    IF v_n > 0 THEN
        PERFORM public._notify_subject(p_subject_type, p_subject_id, 'STRIKE_WAIVED_SAFETY_VICTIM',
            'Naalis ang strike mo (Your strike was removed)',
            'Because your safety report was confirmed, the strike(s) recorded on that trip were removed. (Dahil nakumpirma ang ulat mo sa kaligtasan, inalis ang strike mo sa biyaheng iyon.)',
            p_incident_id::TEXT, 20);
        PERFORM public.record_policy_audit('VICTIM_STRIKES_WAIVED', p_incident_id::TEXT, public._subject_name(p_subject_type, p_subject_id), 'Incident Reports',
            v_n || ' strike(s) of the confirmed victim on this trip were waived (Rule 26.4).', NULL,
            jsonb_build_object('incident_id', p_incident_id, 'booking_id', p_booking_id, 'strike_ids', to_jsonb(v_ids)));
    END IF;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN v_n;
END;
$$;

-- 4.1 The administrator starts the review (Pending -> Under Investigation). The TODA Administrator for a report with the TODA; the LGU Administrator for any.
CREATE OR REPLACE FUNCTION public.incident_start_review(p_incident_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_i public.incident_report;
    v_role TEXT;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    SELECT * INTO v_i FROM public.incident_report WHERE incident_id = p_incident_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_INCIDENT_NOT_FOUND: The report was not found.';
    END IF;
    v_role := public._incident_actor(v_i);
    IF v_role = 'toda_admin' AND (v_i.routing <> 'TODA' OR v_i.priority = 'Serious') THEN
        RAISE EXCEPTION 'Access Denied: This report is with the LGU Administrator (read only for the TODA Administrator).';
    END IF;
    IF v_i.outcome IS NOT NULL OR v_i.status NOT IN ('Pending', 'Pending Review') THEN
        RETURN jsonb_build_object('success', TRUE, 'unchanged', TRUE, 'status', v_i.status);
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.incident_report
       SET status = 'Under Investigation', first_action_at = COALESCE(first_action_at, v_now),
           reviewed_by_toda = CASE WHEN v_role = 'toda_admin' THEN COALESCE(public._incident_admin_id('toda_admin'), reviewed_by_toda) ELSE reviewed_by_toda END,
           reviewed_by_lgu = CASE WHEN v_role = 'lgu_admin' THEN COALESCE(public._incident_admin_id('lgu_admin'), reviewed_by_lgu) ELSE reviewed_by_lgu END
     WHERE incident_id = p_incident_id;
    PERFORM public._incident_notify_reporter(v_i, 'INCIDENT_UNDER_REVIEW', 'Sinusuri na ang iyong ulat (Your report is being reviewed)',
        'An administrator has started to review your report. (Sinimulan nang suriin ng administrator ang iyong ulat.)', 1);
    PERFORM public.record_policy_audit('INCIDENT_REVIEW_STARTED', p_incident_id::TEXT, NULL, 'Incident Reports',
        'The ' || replace(v_role, '_', ' ') || ' started to review the report (' || v_i.category || ').',
        jsonb_build_object('status', v_i.status), jsonb_build_object('status', 'Under Investigation', 'incident_id', p_incident_id, 'category', v_i.category));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'status', 'Under Investigation');
END;
$$;

-- 4.2 Escalation (Rule 19.3): what the TODA cannot resolve, or what could mean a suspension or deactivation, goes to the LGU Administrator. With
-- p_serious the report is reclassified as serious (decision PI-11J): it is the LGU's alone from now on and the TODA keeps read-only sight of it.
-- The LGU Administrator may also take a report over (for example one the TODA left past its review time).
CREATE OR REPLACE FUNCTION public.incident_escalate(p_incident_id UUID, p_reason TEXT, p_serious BOOLEAN DEFAULT FALSE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_i public.incident_report;
    v_role TEXT;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_now TIMESTAMPTZ := clock_timestamp();
    v_serious BOOLEAN := COALESCE(p_serious, FALSE);
BEGIN
    IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
        RAISE EXCEPTION 'ERR_INCIDENT_REASON: Write why the report is escalated (at least 10 characters).';
    END IF;
    SELECT * INTO v_i FROM public.incident_report WHERE incident_id = p_incident_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_INCIDENT_NOT_FOUND: The report was not found.';
    END IF;
    v_role := public._incident_actor(v_i);
    IF v_role = 'toda_admin' AND v_i.routing <> 'TODA' THEN
        RAISE EXCEPTION 'Access Denied: This report is already with the LGU Administrator (read only for the TODA Administrator).';
    END IF;
    IF v_i.outcome IS NOT NULL OR v_i.status = 'Cancelled' THEN
        RAISE EXCEPTION 'ERR_INCIDENT_CLOSED: The report is closed.';
    END IF;
    IF v_i.routing = 'LGU' AND (NOT v_serious OR v_i.priority = 'Serious') THEN
        RETURN jsonb_build_object('success', TRUE, 'unchanged', TRUE, 'routing', 'LGU', 'priority', v_i.priority);
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.incident_report
       SET routing = 'LGU',
           priority = CASE WHEN v_serious THEN 'Serious' ELSE priority END,
           escalated_at = COALESCE(escalated_at, v_now),
           escalated_by = auth.uid(),
           escalation_reason = btrim(p_reason),
           status = 'Under Investigation',
           first_action_at = COALESCE(first_action_at, v_now),
           decision_due_at = CASE WHEN v_serious
               THEN LEAST(COALESCE(decision_due_at, 'infinity'::TIMESTAMPTZ), public.add_business_days(v_now, public.incident_constant('safety_decision_business_days')))
               ELSE public.add_business_days(v_now, public.incident_constant('lgu_decision_business_days')) END,
           reviewed_by_toda = CASE WHEN v_role = 'toda_admin' THEN COALESCE(public._incident_admin_id('toda_admin'), reviewed_by_toda) ELSE reviewed_by_toda END
     WHERE incident_id = p_incident_id;
    PERFORM public._incident_notify_reporter(v_i, 'INCIDENT_ESCALATED', 'Ipinasa sa LGU ang iyong ulat (Your report went to the LGU)',
        'Your report is now with the LGU Administrator for a decision. (Nasa LGU Administrator na ang ulat mo para sa pagpapasya.)', 2);
    PERFORM public.record_policy_audit(CASE WHEN v_serious THEN 'INCIDENT_RECLASSIFIED_SERIOUS' ELSE 'INCIDENT_ESCALATED' END, p_incident_id::TEXT, NULL, 'Incident Reports',
        'The ' || replace(v_role, '_', ' ') || ' ' || CASE WHEN v_serious THEN 'reclassified the report as serious and sent it to the LGU' ELSE 'escalated the report to the LGU' END
            || ' (' || v_i.category || '): ' || btrim(p_reason),
        jsonb_build_object('routing', v_i.routing, 'priority', v_i.priority, 'status', v_i.status),
        jsonb_build_object('routing', 'LGU', 'priority', CASE WHEN v_serious THEN 'Serious' ELSE v_i.priority END, 'incident_id', p_incident_id, 'category', v_i.category));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'routing', 'LGU', 'priority', CASE WHEN v_serious THEN 'Serious' ELSE v_i.priority END);
END;
$$;

-- 4.3 The decision (Rules 19.4, 19.5, 26.4): UPHELD / NOT_UPHELD / FABRICATED / RESOLVED (no fault, for an emergency).
--   * Nothing here is automatic: the deciding administrator names the outcome and, for UPHELD, may name the strike (the catalog's own range, default the
--     minimum, with the written reason); the strike is issued through issue_strike() AS the confirming administrator (decision PI-11E: the driver's TODA
--     Administrator for a report with the TODA; the LGU Administrator for any, and for the serious ones and the sanctions that suspend an account).
--   * FABRICATED (Rule 19.5): the strike, if any, is on the REPORTER (2 strikes, decision PI-11H).
--   * A confirmed victim of a safety incident is not struck for it (Rule 26.4): their strikes on the same trip are waived.
CREATE OR REPLACE FUNCTION public.incident_decide(p_incident_id UUID, p_outcome TEXT, p_note TEXT, p_strike_code TEXT DEFAULT NULL, p_points INTEGER DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_i public.incident_report;
    v_role TEXT;
    v_class TEXT;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_now TIMESTAMPTZ := clock_timestamp();
    v_cat public.violation_catalog;
    v_subject_type TEXT;
    v_subject_id UUID;
    v_points INTEGER;
    v_strike JSONB;
    v_waived INTEGER := 0;
    v_note TEXT := btrim(COALESCE(p_note, ''));
    v_victim_type TEXT;
    v_victim_id UUID;
BEGIN
    IF p_outcome IS NULL OR p_outcome NOT IN ('UPHELD', 'NOT_UPHELD', 'FABRICATED', 'RESOLVED') THEN
        RAISE EXCEPTION 'ERR_INCIDENT_OUTCOME: The outcome must be UPHELD, NOT_UPHELD, FABRICATED or RESOLVED.';
    END IF;
    IF length(v_note) < 10 THEN
        RAISE EXCEPTION 'ERR_INCIDENT_NOTE: Write the findings and the reason for the decision (at least 10 characters).';
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
        IF v_i.outcome = p_outcome THEN
            RETURN jsonb_build_object('success', TRUE, 'already_decided', TRUE, 'outcome', v_i.outcome, 'strike_id', v_i.strike_id);
        END IF;
        RAISE EXCEPTION 'ERR_INCIDENT_ALREADY_DECIDED: The report was already decided (%).', v_i.outcome;
    END IF;

    v_class := COALESCE(public._incident_category_class(v_i.category), 'STANDARD');
    IF v_class = 'LOST_ITEM' AND p_outcome <> 'NOT_UPHELD' THEN
        RAISE EXCEPTION 'ERR_INCIDENT_USE_LOST_ITEM: A lost item is closed as Returned, Not Found or Unclaimed (Rule 19.6); it carries no strike.';
    END IF;
    IF p_outcome = 'RESOLVED' AND v_class <> 'EMERGENCY' THEN
        RAISE EXCEPTION 'ERR_INCIDENT_OUTCOME: Resolved (no fault) is the outcome of an emergency incident only (Rule 19.7).';
    END IF;
    IF p_outcome = 'FABRICATED' AND v_i.reported_by NOT IN ('Passenger', 'Driver') THEN
        RAISE EXCEPTION 'ERR_INCIDENT_OUTCOME: A report filed by the system cannot be fabricated.';
    END IF;

    -- the strike (never automatic)
    IF p_strike_code IS NOT NULL THEN
        IF p_outcome = 'UPHELD' THEN
            IF NOT (p_strike_code = ANY (public._incident_strike_options(v_i.category, v_i.reported_by))) THEN
                RAISE EXCEPTION 'ERR_INCIDENT_STRIKE_CODE: % does not fit a % report filed by the %.', p_strike_code, v_i.category, lower(v_i.reported_by);
            END IF;
            v_subject_type := CASE WHEN p_strike_code LIKE 'PAX\_%' THEN 'passenger' ELSE 'driver' END;
            v_subject_id := CASE WHEN v_subject_type = 'passenger' THEN v_i.passenger_id ELSE v_i.driver_id END;
        ELSIF p_outcome = 'FABRICATED' THEN
            IF NOT ((v_i.reported_by = 'Passenger' AND p_strike_code = 'PAX_FABRICATED_REPORT') OR (v_i.reported_by = 'Driver' AND p_strike_code = 'DRV_FABRICATED_REPORT')) THEN
                RAISE EXCEPTION 'ERR_INCIDENT_STRIKE_CODE: The strike of a fabricated report is on the reporter (PAX_FABRICATED_REPORT / DRV_FABRICATED_REPORT).';
            END IF;
            v_subject_type := CASE v_i.reported_by WHEN 'Passenger' THEN 'passenger' ELSE 'driver' END;
            v_subject_id := CASE v_i.reported_by WHEN 'Passenger' THEN v_i.passenger_id ELSE v_i.driver_id END;
        ELSE
            RAISE EXCEPTION 'ERR_INCIDENT_STRIKE_NOT_ALLOWED: A report that is not upheld, and a no-fault resolution, carry no strike.';
        END IF;
        IF v_subject_id IS NULL THEN
            RAISE EXCEPTION 'ERR_INCIDENT_STRIKE_SUBJECT: The report has no % to strike.', v_subject_type;
        END IF;
        SELECT * INTO v_cat FROM public.violation_catalog WHERE violation_code = p_strike_code AND is_active;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'ERR_INCIDENT_STRIKE_CODE: Unknown strike code %.', p_strike_code;
        END IF;
        IF v_role = 'toda_admin' AND (v_cat.ladder_bypass <> 'NONE' OR COALESCE(v_cat.lgu_only, FALSE)) THEN
            RAISE EXCEPTION 'Access Denied: A sanction that suspends an account is decided by the LGU Administrator (Rule 19.3): escalate the report.';
        END IF;
        v_points := COALESCE(p_points, v_cat.min_points);

        -- the strike is issued as the confirming administrator (a TODA Administrator for a passenger only through this function: the flag below)
        PERFORM set_config('sakay.admin_confirm', CASE WHEN v_role = 'toda_admin' THEN 'true' ELSE '' END, true);
        v_strike := public.issue_strike(v_subject_type, v_subject_id, p_strike_code, v_points, v_i.booking_id, v_i.incident_id,
            'INCIDENT:' || v_i.incident_id::TEXT || ':' || p_strike_code, NULL, v_note, NULL,
            jsonb_build_object('incident_id', v_i.incident_id, 'category', v_i.category, 'outcome', p_outcome,
                               'rule', CASE p_outcome WHEN 'FABRICATED' THEN 'Rule 19.5' ELSE 'Rule 19.4' END, 'decided_by_role', v_role));
        PERFORM set_config('sakay.admin_confirm', '', true);
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.incident_report
       SET status = CASE p_outcome WHEN 'NOT_UPHELD' THEN 'Dismissed' ELSE 'Resolved' END,
           outcome = p_outcome, resolution = v_note, resolution_notes = v_note, resolved_at = v_now,
           decided_by = auth.uid(), decided_by_role = v_role,
           first_action_at = COALESCE(first_action_at, v_now),
           strike_id = NULLIF(v_strike->>'strike_id', '')::UUID, strike_code = p_strike_code,
           reviewed_by_toda = CASE WHEN v_role = 'toda_admin' THEN COALESCE(public._incident_admin_id('toda_admin'), reviewed_by_toda) ELSE reviewed_by_toda END,
           reviewed_by_lgu = CASE WHEN v_role = 'lgu_admin' THEN COALESCE(public._incident_admin_id('lgu_admin'), reviewed_by_lgu) ELSE reviewed_by_lgu END
     WHERE incident_id = p_incident_id;

    -- Rule 26.4: the reporter of a confirmed safety incident is its victim: no strike of theirs on that trip stands
    IF (p_outcome = 'UPHELD' AND v_class IN ('SERIOUS', 'EMERGENCY')) OR (p_outcome = 'RESOLVED' AND v_class = 'EMERGENCY') THEN
        v_victim_type := CASE v_i.reported_by WHEN 'Passenger' THEN 'passenger' WHEN 'Driver' THEN 'driver' END;
        v_victim_id := CASE v_i.reported_by WHEN 'Passenger' THEN v_i.passenger_id WHEN 'Driver' THEN v_i.driver_id END;
        IF v_victim_type IS NOT NULL THEN
            v_waived := public._waive_victim_strikes(v_i.booking_id, v_victim_type, v_victim_id, v_i.incident_id, v_note);
        END IF;
    END IF;

    PERFORM public._incident_notify_reporter(v_i, 'INCIDENT_DECIDED', 'Nasuri na ang iyong ulat (Your report was decided)',
        CASE p_outcome
            WHEN 'UPHELD' THEN 'Your report was reviewed and upheld. (Sinuri at pinaboran ang iyong ulat.)'
            WHEN 'NOT_UPHELD' THEN 'Your report was reviewed and not upheld. (Sinuri ngunit hindi napaboran ang iyong ulat.)'
            WHEN 'FABRICATED' THEN 'Your report was found to be false or malicious. (Napag-alamang hindi totoo o may masamang hangarin ang ulat.)'
            ELSE 'Your report was reviewed. No fault was assigned to anybody. (Sinuri ang ulat mo; walang itinalagang may kasalanan.)' END, 3);
    IF p_outcome = 'UPHELD' AND v_strike IS NULL THEN
        PERFORM public._incident_notify_other(v_i, 'INCIDENT_UPHELD_AGAINST_YOU', 'May ulat tungkol sa biyahe mo (A report about your trip was upheld)',
            'A report about one of your trips was reviewed and upheld by an administrator. They may contact you. (May ulat tungkol sa isang biyahe mo na pinaboran ng administrator.)', 4);
    END IF;
    PERFORM public.record_policy_audit('INCIDENT_DECIDED', p_incident_id::TEXT, NULL, 'Incident Reports',
        'The ' || replace(v_role, '_', ' ') || ' decided the ' || v_i.category || ' report: ' || p_outcome || COALESCE(' (strike ' || p_strike_code || ')', '') || '. ' || v_note,
        jsonb_build_object('status', v_i.status, 'outcome', v_i.outcome, 'routing', v_i.routing),
        jsonb_build_object('status', CASE p_outcome WHEN 'NOT_UPHELD' THEN 'Dismissed' ELSE 'Resolved' END, 'outcome', p_outcome, 'incident_id', p_incident_id,
                           'strike_id', v_strike->>'strike_id', 'strike_code', p_strike_code, 'victim_strikes_waived', v_waived));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'outcome', p_outcome, 'status', CASE p_outcome WHEN 'NOT_UPHELD' THEN 'Dismissed' ELSE 'Resolved' END,
                              'strike', v_strike, 'victim_strikes_waived', v_waived);
END;
$$;

-- 4.4 A lost item (Rules 19.6, 29.19): the TODA Administrator arranges the contact between the two parties and records what came of it. No strike.
-- "Unclaimed" is only for a report 14 days old with no result (F11.4), and only the administrator, after the report was shown to them, closes it.
CREATE OR REPLACE FUNCTION public.incident_lost_item_update(p_incident_id UUID, p_status TEXT, p_note TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_i public.incident_report;
    v_role TEXT;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_now TIMESTAMPTZ := clock_timestamp();
    v_note TEXT := btrim(COALESCE(p_note, ''));
    v_closing BOOLEAN := p_status IN ('Returned', 'Not Found', 'Unclaimed');
    v_flag public.admin_review_flag;
    v_thr INTEGER;
BEGIN
    IF p_status IS NULL OR p_status NOT IN ('Contact Arranged', 'Returned', 'Not Found', 'Unclaimed') THEN
        RAISE EXCEPTION 'ERR_LOST_ITEM_STATUS: The status must be Contact Arranged, Returned, Not Found or Unclaimed.';
    END IF;
    IF length(v_note) < 10 THEN
        RAISE EXCEPTION 'ERR_LOST_ITEM_NOTE: Write who was contacted and what was agreed or found (at least 10 characters).';
    END IF;
    SELECT * INTO v_i FROM public.incident_report WHERE incident_id = p_incident_id FOR UPDATE;
    IF NOT FOUND OR v_i.category <> 'Lost Item' THEN
        RAISE EXCEPTION 'ERR_INCIDENT_NOT_FOUND: The lost-item report was not found.';
    END IF;
    v_role := public._incident_actor(v_i);
    IF v_role = 'toda_admin' AND v_i.routing <> 'TODA' THEN
        RAISE EXCEPTION 'Access Denied: This report is with the LGU Administrator.';
    END IF;
    IF v_i.status = 'Cancelled' THEN
        RAISE EXCEPTION 'ERR_INCIDENT_WITHDRAWN: The reporter withdrew this report.';
    END IF;
    IF v_i.outcome IS NOT NULL THEN
        IF v_i.lost_item_status = p_status THEN
            RETURN jsonb_build_object('success', TRUE, 'unchanged', TRUE, 'lost_item_status', v_i.lost_item_status);
        END IF;
        RAISE EXCEPTION 'ERR_INCIDENT_ALREADY_DECIDED: The report is already closed (%).', v_i.lost_item_status;
    END IF;
    IF p_status = 'Contact Arranged' AND v_i.lost_item_status = 'Contact Arranged' THEN
        RETURN jsonb_build_object('success', TRUE, 'unchanged', TRUE, 'lost_item_status', v_i.lost_item_status);
    END IF;
    IF p_status = 'Unclaimed' AND v_i.created_at > v_now - make_interval(days => public.incident_constant('lost_item_unclaimed_days')) THEN
        RAISE EXCEPTION 'ERR_LOST_ITEM_TOO_EARLY: A lost item can be closed as Unclaimed only % days after the report.', public.incident_constant('lost_item_unclaimed_days');
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.incident_report
       SET lost_item_status = p_status,
           lost_item_contact_at = CASE WHEN p_status = 'Contact Arranged' THEN COALESCE(lost_item_contact_at, v_now) ELSE lost_item_contact_at END,
           status = CASE WHEN v_closing THEN 'Resolved' ELSE 'Under Investigation' END,
           outcome = CASE WHEN p_status = 'Unclaimed' THEN 'UNCLAIMED' WHEN v_closing THEN 'RESOLVED' ELSE NULL END,
           resolution = v_note, resolution_notes = v_note,
           resolved_at = CASE WHEN v_closing THEN v_now ELSE NULL END,
           decided_by = CASE WHEN v_closing THEN auth.uid() ELSE NULL END,
           decided_by_role = CASE WHEN v_closing THEN v_role ELSE NULL END,
           first_action_at = COALESCE(first_action_at, v_now),
           reviewed_by_toda = CASE WHEN v_role = 'toda_admin' THEN COALESCE(public._incident_admin_id('toda_admin'), reviewed_by_toda) ELSE reviewed_by_toda END,
           reviewed_by_lgu = CASE WHEN v_role = 'lgu_admin' THEN COALESCE(public._incident_admin_id('lgu_admin'), reviewed_by_lgu) ELSE reviewed_by_lgu END
     WHERE incident_id = p_incident_id;

    v_thr := CASE p_status WHEN 'Contact Arranged' THEN 10 WHEN 'Returned' THEN 11 WHEN 'Not Found' THEN 12 ELSE 13 END;
    IF p_status = 'Contact Arranged' THEN
        PERFORM public._incident_notify_reporter(v_i, 'LOST_ITEM_CONTACT', 'Inayos ang pagkontak para sa naiwang gamit (Contact arranged for the lost item)',
            'The TODA Administrator is connecting you with the other party to return the item. Expect a call or text. (Ikokonekta ka ng TODA Administrator para maibalik ang gamit.)', v_thr);
        PERFORM public._incident_notify_other(v_i, 'LOST_ITEM_CONTACT', 'May naiwang gamit sa biyahe (A lost item was reported on your trip)',
            'A lost item was reported on one of your trips. The TODA Administrator will contact you to arrange its return. (May naiwang gamit sa isang biyahe mo; kokontakin ka ng TODA Administrator.)', v_thr);
    ELSIF p_status = 'Returned' THEN
        PERFORM public._incident_notify_reporter(v_i, 'LOST_ITEM_CLOSED', 'Naibalik ang gamit (The item was returned)', 'The lost-item report is closed: the item was returned. (Sarado na ang ulat: naibalik ang gamit.)', v_thr);
        PERFORM public._incident_notify_other(v_i, 'LOST_ITEM_CLOSED', 'Sarado ang lost-item report (The lost-item report is closed)', 'The lost-item report on your trip is closed: the item was returned. Thank you. (Salamat.)', v_thr);
    ELSIF p_status = 'Not Found' THEN
        PERFORM public._incident_notify_reporter(v_i, 'LOST_ITEM_CLOSED', 'Hindi natagpuan ang gamit (The item was not found)', 'The lost-item report is closed: the item was not found. (Sarado na ang ulat: hindi natagpuan ang gamit.)', v_thr);
        PERFORM public._incident_notify_other(v_i, 'LOST_ITEM_CLOSED', 'Sarado ang lost-item report (The lost-item report is closed)', 'The lost-item report on your trip is closed: the item was not found. (Hindi natagpuan ang gamit.)', v_thr);
    ELSE
        PERFORM public._incident_notify_reporter(v_i, 'LOST_ITEM_CLOSED', 'Sarado ang ulat bilang unclaimed (The report was closed as unclaimed)',
            'The lost-item report was closed as unclaimed after no response. You can still contact your TODA. (Sarado ang ulat dahil walang tugon.)', v_thr);
    END IF;
    IF v_closing THEN
        SELECT * INTO v_flag FROM public.admin_review_flag
         WHERE flag_type = 'LOST_ITEM_UNCLAIMED_REVIEW' AND subject_type = 'driver' AND subject_id = v_i.driver_id::TEXT
           AND status IN ('Open', 'Under Review') AND details->>'incident_id' = p_incident_id::TEXT;
        IF FOUND THEN
            PERFORM public.resolve_admin_review_flag(v_flag.flag_id, 'Resolved', 'The lost-item report was closed as ' || p_status || '.');
        END IF;
    END IF;
    PERFORM public.record_policy_audit('INCIDENT_LOST_ITEM_UPDATED', p_incident_id::TEXT, NULL, 'Incident Reports',
        'The ' || replace(v_role, '_', ' ') || ' set the lost-item report to ' || p_status || '. ' || v_note,
        jsonb_build_object('lost_item_status', v_i.lost_item_status, 'status', v_i.status),
        jsonb_build_object('lost_item_status', p_status, 'incident_id', p_incident_id, 'booking_id', v_i.booking_id));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'lost_item_status', p_status, 'closed', v_closing);
END;
$$;

-- 4.5 The Urgent Safety Report (Rule 26.2) - one tap during a trip. A passenger or the driver of the trip files an emergency incident (an emergency, a
-- safety concern, an accident, a medical emergency) or a serious allegation (assault, harassment, threat, criminal activity: straight to the LGU,
-- Rule 19.8), with the vehicle's last known position. The details are optional here (nobody types while in danger). A second tap within two minutes
-- returns the same report. The report is filed through the same guard as every report (it is the table's INSERT, not a shortcut around it).
CREATE OR REPLACE FUNCTION public.file_urgent_safety_report(p_booking_id UUID, p_category TEXT DEFAULT 'Safety Concern', p_description TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_b public.booking;
    v_pax UUID := public.get_current_passenger_id();
    v_drv UUID := public.get_current_driver_id();
    v_who TEXT;
    v_class TEXT := public._incident_category_class(p_category);
    v_existing UUID;
    v_id UUID;
    v_desc TEXT := COALESCE(NULLIF(btrim(COALESCE(p_description, '')), ''), 'Urgent Safety Report sent from the trip screen. No details were typed. (Walang karagdagang detalye.)');
    v_row public.incident_report;
BEGIN
    IF v_class IS NULL OR v_class NOT IN ('EMERGENCY', 'SERIOUS') THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_URGENT_CATEGORY', 'error', 'Pumili ng uri ng emergency. (Choose an emergency type.)');
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id;
    IF FOUND THEN
        v_who := CASE WHEN v_pax IS NOT NULL AND v_b.passenger_id = v_pax THEN 'Passenger' WHEN v_drv IS NOT NULL AND v_b.driver_id = v_drv THEN 'Driver' END;
    END IF;
    IF v_who IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_INCIDENT_NOT_PARTICIPANT', 'error', 'You can only report a trip you took part in.');
    END IF;
    SELECT r.incident_id INTO v_existing FROM public.incident_report r
     WHERE r.booking_id = p_booking_id AND r.reported_by = v_who AND r.category = p_category AND r.status <> 'Cancelled'
       AND r.created_at > CURRENT_TIMESTAMP - interval '2 minutes'
     ORDER BY r.created_at DESC LIMIT 1;
    IF v_existing IS NOT NULL THEN
        SELECT * INTO v_row FROM public.incident_report WHERE incident_id = v_existing;
        RETURN jsonb_build_object('success', TRUE, 'incident_id', v_existing, 'existing', TRUE, 'priority', v_row.priority, 'routing', v_row.routing);
    END IF;
    INSERT INTO public.incident_report (booking_id, category, description) VALUES (p_booking_id, p_category, left(v_desc, 2000)) RETURNING incident_id INTO v_id;
    SELECT * INTO v_row FROM public.incident_report WHERE incident_id = v_id;
    PERFORM public.record_policy_audit('URGENT_SAFETY_REPORT_FILED', v_id::TEXT, NULL, 'Incident Reports',
        'An Urgent Safety Report (' || p_category || ') was filed by the ' || lower(v_who) || ' (Rule 26.2). Routing: ' || v_row.routing || '.', NULL,
        jsonb_build_object('incident_id', v_id, 'booking_id', p_booking_id, 'category', p_category, 'priority', v_row.priority, 'routing', v_row.routing,
                           'latitude', v_row.incident_latitude, 'longitude', v_row.incident_longitude));
    RETURN jsonb_build_object('success', TRUE, 'incident_id', v_id, 'existing', FALSE, 'priority', v_row.priority, 'routing', v_row.routing);
END;
$$;

-- Rule 29.20 (replaces 20261004000002): a driver detained or arrested during a trip is not reinstated while the TODA review or the LGU review is open
CREATE OR REPLACE FUNCTION public.admin_reinstate_account(
    p_subject_type TEXT, p_subject_id UUID, p_reason TEXT, p_history_reviewed BOOLEAN DEFAULT FALSE
)
RETURNS JSONB AS $$
DECLARE
    v_before JSONB;
    v_kind TEXT;
BEGIN
    IF NOT public.is_lgu_admin() THEN
        RAISE EXCEPTION 'Access Denied: Only LGU Administrators can reinstate accounts.';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
        RAISE EXCEPTION 'A reinstatement reason is required.';
    END IF;
    IF p_subject_type NOT IN ('passenger', 'driver') OR public._subject_name(p_subject_type, p_subject_id) IS NULL THEN
        RAISE EXCEPTION 'Subject not found';
    END IF;

    IF p_subject_type = 'driver' AND EXISTS (SELECT 1 FROM public.admin_review_flag f WHERE f.subject_type = 'driver' AND f.subject_id = p_subject_id::TEXT
                                              AND f.flag_type IN ('DRIVER_DETENTION_TODA_REVIEW', 'DRIVER_DETENTION_LGU_REVIEW') AND f.status IN ('Open', 'Under Review')) THEN
        RAISE EXCEPTION 'ERR_REVIEW_PENDING: The TODA and the LGU Administrators must both finish reviewing the detention before this driver resumes (Rule 29.20): resolve the review flags first.';
    END IF;
    v_before := public.account_restriction_state(p_subject_type, p_subject_id);
    v_kind := v_before->>'kind';
    IF v_kind = 'CLOSED' THEN
        RAISE EXCEPTION 'A permanently closed account cannot be reinstated.';
    END IF;
    IF v_kind = 'DEACTIVATED' AND NOT COALESCE(p_history_reviewed, FALSE) THEN
        RAISE EXCEPTION 'Confirm that the full violation history was reviewed before reactivating a deactivated account.';
    END IF;

    PERFORM public._clear_restriction(p_subject_type, p_subject_id, v_kind = 'DEACTIVATED');

    PERFORM public.record_policy_audit('ACCOUNT_REINSTATED', p_subject_id::TEXT,
        public._subject_name(p_subject_type, p_subject_id), 'Strikes & Suspensions',
        'Reinstated from ' || COALESCE(v_kind, 'no restriction') || '. History reviewed: ' || COALESCE(p_history_reviewed, FALSE) ||
        '. Strike count is retained and ages out normally. Reason: ' || p_reason,
        v_before, public.account_restriction_state(p_subject_type, p_subject_id));
    IF v_kind IS NOT NULL THEN
        PERFORM public._notify_subject(p_subject_type, p_subject_id, 'ACCOUNT_REINSTATED',
            'Naibalik ang Iyong Account',
            'Naibalik na ang iyong account. (Your account has been reinstated.)', gen_random_uuid()::TEXT, 0);
    END IF;
    RETURN jsonb_build_object('success', TRUE, 'previous_kind', v_kind);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 5. SAFE REASONS (Rules 15.1 - 15.5, 29.13, 29.14, 29.21; decision PI-11B)
-- ----------------------------------------------------------------------------
-- A driver who cancels or stops because of a breakdown, an accident, an emergency, a safety concern, a road closure, or because the passenger asked for
-- something unsafe or illegal, or to carry a prohibited item, is NOT struck. The event is recorded in the strike ledger as AUTO_WAIVED with no points
-- (so the history, the analytics and the repeat count keep it), the driver's TODA Administrator gets ONE verification flag listing the events, and a
-- driver who uses these reasons three times in 30 days raises a repeat-pattern flag for the same administrator. Nothing is automatic against the driver:
-- the TODA or LGU Administrator may later confirm the strike the reason was meant to avoid (admin_confirm_flagged_violation, below).
CREATE OR REPLACE FUNCTION public._safe_reason_exempt(p_reason TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE split_part(COALESCE(p_reason, ''), ':', 1)
        WHEN 'vehicle_breakdown'         THEN 'VEHICLE_BREAKDOWN'
        WHEN 'personal_emergency'        THEN 'EMERGENCY'
        WHEN 'emergency'                 THEN 'EMERGENCY'
        WHEN 'medical_emergency'         THEN 'EMERGENCY'
        WHEN 'safety_concern'            THEN 'SAFETY_INCIDENT_VICTIM'
        WHEN 'accident'                  THEN 'TRAFFIC_ACCIDENT'
        WHEN 'road_closure_or_traffic'   THEN 'FORCE_MAJEURE'
        WHEN 'unsafe_or_illegal_request' THEN 'LAWFUL_REFUSAL'
        WHEN 'prohibited_item'           THEN 'LAWFUL_REFUSAL'
    END;
$$;

-- Adds the event to the driver's ONE open verification flag, and raises the repeat-pattern flag at the third event in the window.
CREATE OR REPLACE FUNCTION public._safe_reason_record(p_driver_id UUID, p_booking_id UUID, p_reason_code TEXT, p_rule TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_flag UUID;
    v_n INTEGER;
BEGIN
    PERFORM set_config('sakay.internal_context', 'true', true);
    v_flag := public._presence_flag('DRIVER_SAFE_REASON_REVIEW', p_driver_id, p_rule,
        jsonb_build_object('events', '[]'::JSONB,
            'note', 'The driver cancelled or stopped for a reason that is not struck (breakdown, accident, emergency, safety concern, road closure, an unsafe or illegal request, a prohibited item). Verify it; if it was misused, confirm the strike with the booking of the event.'));
    UPDATE public.admin_review_flag
       SET details = jsonb_set(COALESCE(details, '{}'::JSONB), '{events}',
                               COALESCE(details->'events', '[]'::JSONB)
                               || jsonb_build_array(jsonb_build_object('booking_id', p_booking_id, 'reason', split_part(p_reason_code, ':', 1), 'at', clock_timestamp())))
     WHERE flag_id = v_flag;
    SELECT count(*) INTO v_n FROM public.strikes_ledger s
     WHERE s.subject_type = 'driver' AND s.subject_id = p_driver_id AND s.status = 'AUTO_WAIVED'
       AND s.exempt_reason IN ('VEHICLE_BREAKDOWN', 'EMERGENCY', 'SAFETY_INCIDENT_VICTIM', 'TRAFFIC_ACCIDENT', 'FORCE_MAJEURE', 'LAWFUL_REFUSAL')
       AND s.issued_at >= clock_timestamp() - make_interval(days => public.incident_constant('safe_reason_flag_window_days'));
    IF v_n >= public.incident_constant('safe_reason_flag_count') THEN
        PERFORM public._presence_flag('DRIVER_SAFE_REASON_PATTERN', p_driver_id, p_rule,
            jsonb_build_object('events_in_window', v_n, 'window_days', public.incident_constant('safe_reason_flag_window_days'),
                'note', 'Three or more cancellations or stops for a safe reason in 30 days. Review the pattern; nothing is struck automatically.'));
    END IF;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
END;
$$;

-- The valid reasons of a driver's early stop (a strike is never confirmed for these; replaces 20261024000001: accident and medical emergency are new)
CREATE OR REPLACE FUNCTION public._early_stop_reason_is_valid(p_reason TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT split_part(COALESCE(p_reason, ''), ':', 1) IN ('vehicle_breakdown', 'emergency', 'safety_concern', 'accident', 'medical_emergency');
$$;

-- The decision function of every cancellation (replaces 20261023000001): the safe reasons are not struck and not provisional; they are exempt events (PI-11B)
CREATE OR REPLACE FUNCTION public._cancellation_decision(p_b public.booking, p_actor TEXT, p_reason_code TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_phase TEXT := public._booking_phase(p_b.booking_status);
    v_now TIMESTAMPTZ := clock_timestamp();
    v_arrived BOOLEAN;
    v_progress DOUBLE PRECISION;
    v_en_route BOOLEAN;
    v_prior INTEGER := 0;
BEGIN
    IF p_actor = 'passenger' THEN
        IF v_phase NOT IN ('assigned', 'arrived') THEN
            RETURN jsonb_build_object('actor', p_actor, 'rule', 'Rule 12.1', 'strike_subject', NULL, 'waived_reason', 'before_acceptance');
        END IF;
        v_arrived := v_phase = 'arrived' OR public._driver_within_pickup_zone(p_b.driver_id, p_b.booking_id);
        IF p_b.driver_unreachable_since IS NOT NULL THEN
            RETURN jsonb_build_object('actor', p_actor, 'rule', 'Rule 9.2 / D7-6', 'strike_subject', NULL, 'waived_reason', 'driver_unreachable',
                                      'arrived_by_gps', v_arrived);
        END IF;
        IF NOT v_arrived AND p_b.accepted_at IS NOT NULL
           AND v_now <= p_b.accepted_at + make_interval(secs => public.dispatch_constant('passenger_cancel_grace_seconds')) THEN
            RETURN jsonb_build_object('actor', p_actor, 'rule', 'Rule 12.1', 'strike_subject', NULL, 'waived_reason', 'grace', 'arrived_by_gps', v_arrived);
        END IF;
        RETURN jsonb_build_object('actor', p_actor, 'rule', 'Rule 12.2', 'strike_subject', 'passenger', 'violation_code', 'PAX_LATE_CANCEL',
                                  'provisional', FALSE, 'arrived_by_gps', v_arrived, 'redispatch', FALSE, 'priority', FALSE);
    ELSIF p_actor = 'driver' THEN
        v_progress := public._driver_progress_toward_pickup_m(p_b);
        v_en_route := COALESCE(v_progress, 0) >= public.dispatch_constant('driver_travel_threshold_m');
        IF v_en_route THEN
            SELECT count(*) INTO v_prior FROM public.strikes_ledger
             WHERE subject_type = 'driver' AND subject_id = p_b.driver_id AND violation_code = 'DRV_CANCEL_EN_ROUTE' AND status <> 'VOIDED';
        END IF;
        RETURN jsonb_build_object('actor', p_actor, 'rule', CASE WHEN v_en_route THEN 'Rule 12.4' ELSE 'Rule 12.3' END,
                                  'strike_subject', 'driver',
                                  'violation_code', CASE WHEN v_en_route THEN 'DRV_CANCEL_EN_ROUTE' ELSE 'DRV_CANCEL_BEFORE_TRAVEL' END,
                                  'provisional', FALSE, 'exempt_reason', public._safe_reason_exempt(p_reason_code),   -- Batch 11: a breakdown is no longer a provisional strike (decision PI-11B)
                                  'en_route', v_en_route, 'progress_m', v_progress,
                                  'redispatch', TRUE, 'priority', v_en_route, 'flag_on_repeat', v_en_route AND v_prior > 0);
    ELSIF p_actor = 'no_show' THEN
        RETURN jsonb_build_object('actor', p_actor, 'rule', 'Rule 10.4', 'strike_subject', 'passenger', 'violation_code', 'PAX_NO_SHOW',
                                  'provisional', FALSE, 'redispatch', FALSE, 'priority', FALSE, 'driver_credit', TRUE);
    ELSIF p_actor = 'system' THEN
        RETURN jsonb_build_object('actor', p_actor, 'rule', 'Rule 12.6', 'strike_subject', NULL, 'redispatch', TRUE, 'priority', FALSE);
    END IF;
    RAISE EXCEPTION 'Unknown cancellation actor %', p_actor;
END;
$$;

-- The driver's cancellation (replaces 20261023000001): three more reasons (an accident, an unsafe or illegal request, a prohibited item); the safe reasons are
-- recorded as exempt events with the verification and repeat-pattern flags (PI-11B)
CREATE OR REPLACE FUNCTION public.driver_cancel_booking(p_booking_id UUID, p_reason_code TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_driver UUID := public.get_current_driver_id();
    v_b public.booking;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_phase TEXT;
    v_reason TEXT;
    v_dec JSONB;
    v_en_route BOOLEAN;
    v_code TEXT;
    v_result TEXT;
BEGIN
    IF v_driver IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_A_DRIVER', 'error', 'Only a driver can cancel an accepted booking.');
    END IF;
    IF p_reason_code IS NULL OR p_reason_code NOT IN ('vehicle_breakdown', 'personal_emergency', 'passenger_unreachable',
                                                       'wrong_pickup_location', 'safety_concern', 'road_closure_or_traffic', 'accident',
                                                       'unsafe_or_illegal_request', 'prohibited_item', 'other') THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_CANCEL_REASON_REQUIRED', 'error', 'Choose a reason for cancelling.');
    END IF;

    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_b.driver_id IS DISTINCT FROM v_driver THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_YOUR_BOOKING', 'error', 'This booking is not assigned to you.');
    END IF;
    v_phase := public._booking_phase(v_b.booking_status);
    IF v_phase NOT IN ('assigned', 'arrived') THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_CANNOT_CANCEL',
            'error', 'This booking can no longer be cancelled (the trip has started or it has already ended).');
    END IF;

    v_reason := p_reason_code || CASE WHEN p_note IS NOT NULL AND length(btrim(p_note)) > 0 THEN ': ' || left(btrim(p_note), 300) ELSE '' END;
    v_dec := public._cancellation_decision(v_b, 'driver', p_reason_code);
    v_en_route := (v_dec->>'en_route')::BOOLEAN;
    v_code := v_dec->>'violation_code';

    PERFORM set_config('sakay.internal_context', 'true', true);
    PERFORM public.issue_strike('driver', v_driver, v_code, NULL, p_booking_id, NULL,
        'DRV_CANCEL:' || p_booking_id::TEXT || ':' || v_b.dispatch_cycle || ':' || (v_b.accepted_driver_cancel_count + 1),
        CASE WHEN (v_dec->>'provisional')::BOOLEAN THEN TRUE END, v_reason, v_dec->>'exempt_reason',
        jsonb_build_object('reason_code', p_reason_code, 'en_route', v_en_route, 'rule', v_dec->>'rule',
                           'progress_toward_pickup_m', CASE WHEN v_dec->>'progress_m' IS NOT NULL THEN round((v_dec->>'progress_m')::NUMERIC) END,
                           'provisional', (v_dec->>'provisional')::BOOLEAN));

    IF v_dec->>'exempt_reason' IS NOT NULL THEN                           -- Batch 11 (PI-11B): a safe reason: the TODA verifies it; a pattern is flagged
        PERFORM public._safe_reason_record(v_driver, p_booking_id, p_reason_code, 'Rules 15.1 / 29.13 / 29.14');
    END IF;
    IF (v_dec->>'flag_on_repeat')::BOOLEAN THEN                           -- Rule 12.4: not the first instance
        PERFORM public._presence_flag('DRIVER_REPEATED_CANCELLATIONS', v_driver, 'Rule 12.4',
            jsonb_build_object('booking_id', p_booking_id, 'note', 'An en-route cancellation that is not the first (Rule 12.4).'));
    END IF;
    PERFORM public._check_repeat_cancellations('driver', v_driver);       -- Rule 12.7

    v_result := public._dispatch_redispatch(p_booking_id, v_driver, 'driver', v_reason);
    IF v_result = 'redispatched' AND (v_dec->>'priority')::BOOLEAN THEN
        -- Rule 12.4 / PI-02: the booking was delayed by a driver who had already set off; it is served first in the search (cleared when accepted or ended)
        UPDATE public.booking SET redispatch_priority_at = clock_timestamp() WHERE booking_id = p_booking_id;
        PERFORM public.record_policy_audit('BOOKING_REDISPATCH_PRIORITY', p_booking_id::TEXT, NULL, 'Dispatch',
            'The driver cancelled after travelling toward the pickup (Rule 12.4); the booking is redispatched with priority.', NULL,
            jsonb_build_object('booking_id', p_booking_id, 'driver_id', v_driver, 'progress_m', v_dec->'progress_m'));
    END IF;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);

    RETURN jsonb_build_object('success', TRUE, 'booking_id', p_booking_id, 'outcome', v_result,
                              'strike_code', v_code, 'en_route', v_en_route, 'priority', COALESCE((v_dec->>'priority')::BOOLEAN, FALSE) AND v_result = 'redispatched',
                              'provisional', COALESCE((v_dec->>'provisional')::BOOLEAN, FALSE),
                              'waived', v_dec->>'exempt_reason' IS NOT NULL, 'exempt_reason', v_dec->>'exempt_reason');
END;
$$;

-- The driver ends the trip early (replaces 20261024000001): two more valid reasons; a valid reason is recorded as an exempt event, the TODA verification
-- flag, and an Emergency incident for an emergency, an accident, a medical emergency or a safety concern (Rules 15.2, 26.3, 29.21, 29.23)
CREATE OR REPLACE FUNCTION public.driver_stop_trip_early(p_booking_id UUID, p_reason_code TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_driver UUID := public.get_current_driver_id();
    v_b public.booking;
    v_b2 public.booking;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_phase TEXT;
    v_reason TEXT;
    v_valid BOOLEAN;
    v_flag UUID;
BEGIN
    IF v_driver IS NULL THEN
        RETURN public._trip_end_error('ERR_NOT_A_DRIVER', 'Only a driver can end a trip early.');
    END IF;
    IF p_reason_code IS NULL OR p_reason_code NOT IN ('vehicle_breakdown', 'emergency', 'safety_concern', 'accident', 'medical_emergency', 'passenger_dispute', 'other') THEN
        RETURN public._trip_end_error('ERR_EARLY_REASON_REQUIRED', 'Pumili ng dahilan. (Choose a reason.)');
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_b.driver_id IS DISTINCT FROM v_driver THEN
        RETURN public._trip_end_error('ERR_NOT_YOUR_BOOKING', 'This booking is not assigned to you.');
    END IF;
    v_phase := public._booking_phase(v_b.booking_status);
    IF v_phase IN ('at_destination', 'completed') THEN
        RETURN jsonb_build_object('success', TRUE, 'already_ended', TRUE, 'booking_status', v_b.booking_status);
    END IF;
    IF v_phase <> 'ongoing' THEN
        RETURN public._trip_end_error('ERR_TRIP_NOT_ONGOING', 'Maaari lamang tapusin nang maaga ang biyaheng nagpapatuloy. (Only a trip in progress can be ended early.)');
    END IF;
    IF v_b.early_end_requested_at IS NOT NULL AND v_b.early_end_kind <> 'DRIVER' THEN
        RETURN public._trip_end_error('ERR_USE_END_TRIP', 'Humiling ang pasahero na tapusin nang maaga ang biyahe: pindutin ang End Trip. (The passenger asked to end the trip early: tap End Trip.)');
    END IF;

    v_reason := p_reason_code || CASE WHEN p_note IS NOT NULL AND length(btrim(p_note)) > 0 THEN ': ' || left(btrim(p_note), 300) ELSE '' END;
    v_valid := public._early_stop_reason_is_valid(p_reason_code);

    PERFORM set_config('sakay.internal_context', 'true', true);
    -- one statement: the fare guard sees the early end and computes the actual-distance fare; the status guard lets the system through
    UPDATE public.booking
       SET early_end_kind = 'DRIVER', early_end_reason = v_reason, early_end_requested_at = COALESCE(early_end_requested_at, clock_timestamp()),
           booking_status = 'Arrived at Destination'
     WHERE booking_id = p_booking_id
     RETURNING * INTO v_b2;

    v_flag := public._presence_flag('DRIVER_EARLY_STOP_REVIEW', v_driver, 'Rule 13.7',
        jsonb_build_object('booking_id', p_booking_id, 'reason', v_reason, 'valid_reason', v_valid, 'early_end_at', v_b2.early_end_at,
                           'actual_fare', v_b2.actual_fare,
                           'note', 'The driver ended a trip before the destination (Rules 13.7 / 29.3). Review the reason; DRV_EARLY_STOP is confirmed by the TODA Administrator and is not given for a breakdown, a safety concern or an emergency.'));
    IF v_valid THEN                                                       -- Batch 11 (PI-11B): no strike; the event is recorded and verified
        PERFORM public.issue_strike('driver', v_driver, 'DRV_EARLY_STOP', NULL, p_booking_id, NULL, 'DRV_EARLY_STOP_EVENT:' || p_booking_id::TEXT, NULL, v_reason,
            public._safe_reason_exempt(p_reason_code), jsonb_build_object('reason_code', p_reason_code, 'rule', 'Rules 13.7 / 15.2 / 26.3'));
        PERFORM public._safe_reason_record(v_driver, p_booking_id, p_reason_code, 'Rules 13.7 / 15.2');
        PERFORM public._incident_auto_file(p_booking_id, 'Driver',
            CASE p_reason_code WHEN 'emergency' THEN 'Emergency' WHEN 'accident' THEN 'Accident' WHEN 'medical_emergency' THEN 'Medical Emergency' WHEN 'safety_concern' THEN 'Safety Concern' END,
            'The driver ended the trip early: ' || v_reason || '. (Rules 15.2, 26.3, 29.23)');
    END IF;
    PERFORM public.record_policy_audit('DRIVER_EARLY_STOP', p_booking_id::TEXT, NULL, 'Trip End',
        'The driver ended the trip before the destination (Rules 13.7 / 29.3): ' || v_reason || '. The passenger is charged the actual-distance fare only.',
        jsonb_build_object('booking_status', v_b.booking_status, 'actual_fare', v_b.actual_fare),
        jsonb_build_object('booking_status', v_b2.booking_status, 'actual_fare', v_b2.actual_fare, 'valid_reason', v_valid, 'review_flag_id', v_flag));
    PERFORM public._dispatch_notify_passenger(v_b2, 'DRIVER_STOPPED_TRIP',
        'Tinapos nang maaga ng drayber ang biyahe (Your driver ended the trip early)',
        'You pay only for the distance travelled. Please check the fare shown, then confirm it or report a discrepancy. (Babayaran mo lamang ang layong nalakbay. Suriin ang pamasahe, saka kumpirmahin o i-report.)');
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);

    RETURN jsonb_build_object('success', TRUE, 'booking_id', p_booking_id, 'actual_fare', v_b2.actual_fare, 'valid_reason', v_valid);
END;
$$;

-- The passenger asks to end the trip early (replaces 20261024000001): a Safety Concern is a safety incident, filed here if the passenger has not filed one (Rule 26.2, PI-11D)
CREATE OR REPLACE FUNCTION public.passenger_request_early_end(p_booking_id UUID, p_reason_code TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_pax UUID := public.get_current_passenger_id();
    v_b public.booking;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_phase TEXT;
    v_kind TEXT;
    v_reason TEXT;
    v_pct INTEGER;
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF v_pax IS NULL THEN
        RETURN public._trip_end_error('ERR_NOT_A_PASSENGER', 'Only a passenger can request to end a trip early.');
    END IF;
    IF p_reason_code IS NULL OR p_reason_code NOT IN ('changed_plans', 'walk_rest', 'earlier_dropoff', 'safety_concern') THEN
        RETURN public._trip_end_error('ERR_EARLY_REASON_REQUIRED', 'Pumili ng dahilan. (Choose a reason.)');
    END IF;

    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_b.passenger_id IS DISTINCT FROM v_pax THEN
        RETURN public._trip_end_error('ERR_NOT_YOUR_BOOKING', 'This booking is not yours.');
    END IF;
    v_phase := public._booking_phase(v_b.booking_status);
    IF v_phase IN ('at_destination', 'completed') THEN
        RETURN jsonb_build_object('success', TRUE, 'already_ended', TRUE, 'booking_status', v_b.booking_status);   -- the driver ended it first: same result
    END IF;
    IF v_phase <> 'ongoing' THEN
        RETURN public._trip_end_error('ERR_TRIP_NOT_ONGOING', 'Maaari lamang tapusin nang maaga ang biyaheng nagpapatuloy. (Only a trip in progress can be ended early.)');
    END IF;

    v_kind := CASE WHEN p_reason_code = 'safety_concern' THEN 'SAFETY' ELSE 'PERSONAL' END;
    v_reason := p_reason_code || CASE WHEN p_note IS NOT NULL AND length(btrim(p_note)) > 0 THEN ': ' || left(btrim(p_note), 300) ELSE '' END;

    IF v_b.early_end_kind = 'SAFETY' OR (v_b.early_end_kind = 'PERSONAL' AND v_kind = 'PERSONAL') THEN
        RETURN jsonb_build_object('success', TRUE, 'already_requested', TRUE, 'kind', v_b.early_end_kind);   -- a Safety Concern request is never downgraded
    END IF;
    IF v_kind = 'PERSONAL' THEN
        v_pct := public._trip_progress_pct(p_booking_id);
        IF v_pct IS NOT NULL AND v_pct >= public.dispatch_constant('trip_finish_min_progress_pct') THEN
            RETURN jsonb_build_object('success', TRUE, 'at_gate', TRUE, 'early', FALSE);   -- arrived: the driver can already end the trip
        END IF;
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.booking
       SET early_end_kind = v_kind, early_end_reason = v_reason, early_end_requested_at = COALESCE(early_end_requested_at, v_now)
     WHERE booking_id = p_booking_id;
    PERFORM public._notify_subject('driver', v_b.driver_id, 'EARLY_END_REQUESTED',
        'Nais ng pasahero na tapusin nang maaga ang biyahe (The passenger asked to end the trip early)',
        CASE WHEN v_kind = 'SAFETY' THEN 'The passenger reported a safety concern. Stop in a safe place, then tap End Trip. (Nag-ulat ng alalahanin sa kaligtasan ang pasahero. Huminto sa ligtas na lugar, saka pindutin ang End Trip.)'
             ELSE 'Stop in a safe place, then tap End Trip. (Huminto sa ligtas na lugar, saka pindutin ang End Trip.)' END,
        p_booking_id::TEXT, 1);
    IF v_kind = 'SAFETY' THEN                                             -- Batch 11: End Trip (Early) for safety creates the Urgent Safety Report if none exists
        PERFORM public._incident_auto_file(p_booking_id, 'Passenger', 'Safety Concern',
            'End Trip (Early) because of a safety concern: ' || v_reason || '. (Rules 13.5, 26.2)');
    END IF;
    PERFORM public.record_policy_audit('EARLY_END_REQUESTED', p_booking_id::TEXT, NULL, 'Trip End',
        'The passenger asked to end the trip early (Rule 13.2): ' || v_reason || '.', NULL,
        jsonb_build_object('booking_id', p_booking_id, 'kind', v_kind, 'reason', v_reason, 'progress_pct', public._trip_progress_pct(p_booking_id)));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);

    RETURN jsonb_build_object('success', TRUE, 'kind', v_kind, 'requested_at', v_now);
END;
$$;

-- A reported delay (replaces 20261021000001): a police checkpoint or inspection (Rule 29.12); it restarts the stand-still time as traffic does, and it is never a violation
CREATE OR REPLACE FUNCTION public.driver_report_delay(p_booking_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_driver UUID := public.get_current_driver_id();
    v_b public.booking;
    v_prev TEXT := current_setting('sakay.internal_context', true);
BEGIN
    IF v_driver IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_A_DRIVER', 'error', 'Only a driver can report a delay.');
    END IF;
    IF p_reason IS NULL OR p_reason NOT IN ('traffic', 'road_closure', 'police_checkpoint') THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_DELAY_REASON', 'error', 'Choose traffic, a road closure or a police checkpoint.');
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_b.driver_id IS DISTINCT FROM v_driver OR public._booking_phase(v_b.booking_status) <> 'assigned' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_ON_THE_WAY', 'error', 'You can report a delay only while you are on the way to the pickup.');
    END IF;
    IF v_b.stall_anchor_at IS NULL OR v_b.stall_anchor_at <= COALESCE(v_b.accepted_at, v_b.stall_anchor_at) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_STARTED',
            'error', 'Start traveling toward the passenger first. A delay can be reported only after you have set off.');
    END IF;
    IF v_b.stall_delay_reports >= 2 THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_TOO_MANY_DELAY_REPORTS',
            'error', 'You have already reported two delays for this booking. Please proceed, or cancel the booking.');
    END IF;
    PERFORM set_config('sakay.internal_context', 'true', true);
    -- the stand-still starts again: the reason is kept, and the warning (if one was shown) is withdrawn
    UPDATE public.booking
       SET stall_delay_reported_at = clock_timestamp(), stall_delay_reports = stall_delay_reports + 1,
           stall_delay_reason = p_reason, stall_warned_at = NULL
     WHERE booking_id = p_booking_id;
    PERFORM public.record_policy_audit('DRIVER_DELAY_REPORTED', p_booking_id::TEXT, NULL, 'Dispatch',
        'The driver reported ' || CASE p_reason WHEN 'traffic' THEN 'heavy traffic' WHEN 'police_checkpoint' THEN 'a police checkpoint or inspection' ELSE 'a road closure' END
        || ' while on the way to the pickup (report ' || (v_b.stall_delay_reports + 1) || ' of 2, Rule 8.4).', NULL,
        jsonb_build_object('booking_id', p_booking_id, 'driver_id', v_driver, 'reason', p_reason, 'report_number', v_b.stall_delay_reports + 1));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'reports', v_b.stall_delay_reports + 1, 'reports_left', 1 - v_b.stall_delay_reports, 'reason', p_reason);
END;
$$;

-- Confirming a flagged violation (replaces 20261025000001): the verification flag of a safe reason (PI-11B)
CREATE OR REPLACE FUNCTION public.admin_confirm_flagged_violation(p_flag_id UUID, p_booking_id UUID, p_reason TEXT, p_points INTEGER DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_f public.admin_review_flag;
    v_b public.booking;
    v_code TEXT;
    v_type TEXT;
    v_subject UUID;
    v_strike JSONB;
    v_admin_confirm BOOLEAN := FALSE;
BEGIN
    IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
        RAISE EXCEPTION 'ERR_CONFIRM_REASON: Write why the violation is confirmed (at least 10 characters).';
    END IF;
    SELECT * INTO v_f FROM public.admin_review_flag WHERE flag_id = p_flag_id AND status IN ('Open', 'Under Review') FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_FLAG_NOT_OPEN: The review flag was not found or is already closed.';
    END IF;
    IF v_f.flag_type = 'PASSENGER_EARLY_END_PATTERN' THEN
        IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
            RAISE EXCEPTION 'Access Denied: Only the LGU Administrator can confirm a passenger strike.';
        END IF;
        v_code := 'PAX_FARE_AVOIDANCE'; v_type := 'passenger'; v_subject := v_f.subject_id::UUID;
    ELSIF v_f.flag_type = 'DRIVER_EARLY_STOP_REVIEW' THEN
        SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id;
        IF NOT FOUND OR v_b.early_end_kind IS DISTINCT FROM 'DRIVER' OR v_b.driver_id::TEXT IS DISTINCT FROM v_f.subject_id THEN
            RAISE EXCEPTION 'ERR_NOT_AN_EARLY_STOP: The booking is not an early stop by this driver.';
        END IF;
        IF public._early_stop_reason_is_valid(v_b.early_end_reason) THEN
            RAISE EXCEPTION 'ERR_VALID_REASON: The driver stopped for a breakdown, a safety concern or an emergency: no strike (decision D9-8).';
        END IF;
        v_code := 'DRV_EARLY_STOP'; v_type := 'driver'; v_subject := v_b.driver_id;
    -- Batch 10 (Rules 14.7, 29.17): an under-declared passenger count; the LGU Administrator decides (passenger strikes are the LGU's). The points default to
    -- the severity the report recommended.
    ELSIF v_f.flag_type = 'PASSENGER_COUNT_UNDER_DECLARED' THEN
        IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
            RAISE EXCEPTION 'Access Denied: Only the LGU Administrator can confirm a passenger strike.';
        END IF;
        v_code := 'PAX_UNDER_DECLARED_COUNT'; v_type := 'passenger'; v_subject := v_f.subject_id::UUID;
        p_booking_id := COALESCE(p_booking_id, NULLIF(v_f.details->>'booking_id', '')::UUID);
        p_points := COALESCE(p_points, NULLIF(v_f.details->>'recommended_points', '')::INTEGER);
    -- Batch 10 (Rule 14.3): repeated, unjustified refusal of compatible Shared requests; only after the administrator has reviewed the pattern
    ELSIF v_f.flag_type = 'DRIVER_SHARED_REQUEST_DECLINES' THEN
        v_code := 'DRV_REPEATED_REFUSAL'; v_type := 'driver'; v_subject := v_f.subject_id::UUID;
    -- Batch 11 (PI-11B): the administrator found that a safe reason was misused: the strike the reason was meant to avoid is confirmed, for the booking of the event
    ELSIF v_f.flag_type = 'DRIVER_SAFE_REASON_REVIEW' THEN
        IF NOT (COALESCE(public.is_lgu_admin(), FALSE) OR COALESCE(public.is_toda_admin_for_driver(v_f.subject_id::UUID), FALSE)) THEN
            RAISE EXCEPTION 'Access Denied: Only the driver''s TODA Administrator or the LGU Administrator can confirm this strike.';
        END IF;
        SELECT s.violation_code INTO v_code FROM public.strikes_ledger s
         WHERE s.subject_type = 'driver' AND s.subject_id = v_f.subject_id::UUID AND s.booking_id = p_booking_id AND s.status = 'AUTO_WAIVED'
           AND s.exempt_reason IS NOT NULL AND s.violation_code IN ('DRV_CANCEL_BEFORE_TRAVEL', 'DRV_CANCEL_EN_ROUTE', 'DRV_EARLY_STOP')
         ORDER BY s.issued_at DESC LIMIT 1;
        IF v_code IS NULL THEN
            RAISE EXCEPTION 'ERR_NOT_A_SAFE_REASON_EVENT: The booking is not a cancellation or stop of this driver that was waived for a safe reason.';
        END IF;
        v_type := 'driver'; v_subject := v_f.subject_id::UUID;
        v_admin_confirm := TRUE;
    ELSE
        RAISE EXCEPTION 'ERR_FLAG_NOT_CONFIRMABLE: A strike cannot be confirmed from a % flag.', v_f.flag_type;
    END IF;
    PERFORM set_config('sakay.admin_confirm', CASE WHEN v_admin_confirm THEN 'true' ELSE '' END, true);
    v_strike := public.issue_strike(v_type, v_subject, v_code, p_points, p_booking_id, NULL,
        'FLAG_VIOLATION:' || p_flag_id::TEXT || ':' || v_code || ':' || COALESCE(p_booking_id::TEXT, '-'), NULL, btrim(p_reason), NULL,
        jsonb_build_object('flag_id', p_flag_id, 'flag_type', v_f.flag_type, 'rule', v_f.source_rule));
    PERFORM set_config('sakay.admin_confirm', '', true);
    PERFORM public.resolve_admin_review_flag(p_flag_id, 'Resolved', 'Violation confirmed (' || v_code || '): ' || btrim(p_reason));
    RETURN jsonb_build_object('success', TRUE, 'strike', v_strike);
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. THE ADMINISTRATOR ENDS A TRIP FOR SAFETY (Rules 29.20, 29.21, 29.22, 26.3, 19.7; decision PI-11C)
-- ----------------------------------------------------------------------------
-- When the driver cannot end the trip (detained or arrested, medically incapacitated) or the passenger is in danger and the driver does not stop, the
-- TODA Administrator of the driver or the LGU Administrator ends it. The passenger pays the distance travelled at most: the administrator may close the
-- trip as Paid or as Waived at once (Rule 26.3: the TODA Administrator decides a fare adjustment or waiver), or leave it at the destination stage for the
-- ordinary confirmation. No strike for anybody. Everything is recorded: an Emergency incident, an audit entry, the notices.
--   driver_detained       Rule 29.20: the driver's account is suspended pending the review of the TODA and LGU Administrators (an open-ended INVESTIGATION
--                         suspension; admin_reinstate_account refuses to lift it while either review flag is open)
--   driver_incapacitated  Rule 29.22: a review flag for the TODA Administrator
--   accident, passenger_in_danger, emergency: the trip is ended and recorded
-- A trip that has not started (the driver is on the way or at the pickup) goes back to the search with no penalty to the passenger.
CREATE OR REPLACE FUNCTION public.admin_end_trip_for_safety(p_booking_id UUID, p_reason_code TEXT, p_note TEXT, p_close_as TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_lgu BOOLEAN := COALESCE(public.is_lgu_admin(), FALSE);
    v_role TEXT;
    v_b public.booking;
    v_b2 public.booking;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_now TIMESTAMPTZ := clock_timestamp();
    v_note TEXT := btrim(COALESCE(p_note, ''));
    v_phase TEXT;
    v_reason TEXT;
    v_how TEXT;
    v_category TEXT;
    v_inc UUID;
    v_details JSONB;
    v_label TEXT;
    v_fare_end NUMERIC;
BEGIN
    IF NOT (v_lgu OR (COALESCE(public.is_toda_admin(), FALSE) AND public.rls_booking_in_my_toda(p_booking_id))) THEN
        RAISE EXCEPTION 'Access Denied: Only the TODA Administrator of this driver, or the LGU Administrator, can end a trip for safety.';
    END IF;
    v_role := CASE WHEN v_lgu THEN 'lgu_admin' ELSE 'toda_admin' END;
    IF p_reason_code IS NULL OR p_reason_code NOT IN ('driver_detained', 'driver_incapacitated', 'accident', 'passenger_in_danger', 'emergency') THEN
        RAISE EXCEPTION 'ERR_SAFETY_END_REASON: The reason must be driver_detained, driver_incapacitated, accident, passenger_in_danger or emergency.';
    END IF;
    IF length(v_note) < 10 THEN
        RAISE EXCEPTION 'ERR_SAFETY_END_NOTE: Write how the situation was confirmed (who was reached, and what they said): at least 10 characters.';
    END IF;
    IF p_close_as IS NOT NULL AND p_close_as NOT IN ('Paid', 'Waived') THEN
        RAISE EXCEPTION 'ERR_SAFETY_END_CLOSE: Close the trip as Paid (the cash was received) or Waived (no fare), or leave it open.';
    END IF;

    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_b.driver_id IS NULL THEN
        RAISE EXCEPTION 'ERR_SAFETY_END_BOOKING: The trip was not found or has no driver.';
    END IF;
    v_phase := public._booking_phase(v_b.booking_status);
    v_label := CASE p_reason_code WHEN 'driver_detained' THEN 'the driver was detained or arrested' WHEN 'driver_incapacitated' THEN 'the driver was medically incapacitated'
                 WHEN 'accident' THEN 'there was an accident' WHEN 'passenger_in_danger' THEN 'the passenger was in danger' ELSE 'there was an emergency' END;
    v_reason := 'admin_' || p_reason_code || ': ' || left(v_note, 300);
    v_category := CASE p_reason_code WHEN 'accident' THEN 'Accident' WHEN 'passenger_in_danger' THEN 'Safety Concern' ELSE 'Emergency' END;

    IF v_phase IN ('searching', 'cancelled', 'no_driver') THEN
        RAISE EXCEPTION 'ERR_SAFETY_END_NOT_ACTIVE: This trip is not active (status %).', v_b.booking_status;
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    IF v_phase = 'ongoing' THEN
        v_how := 'ended';
        -- one statement, as the driver's own early stop: the fare guard sees the early end and computes the actual-distance fare
        UPDATE public.booking
           SET early_end_kind = CASE WHEN early_end_kind = 'SAFETY' THEN 'SAFETY' ELSE 'DRIVER' END,
               early_end_reason = v_reason, early_end_requested_at = COALESCE(early_end_requested_at, v_now),
               booking_status = 'Arrived at Destination'
         WHERE booking_id = p_booking_id
         RETURNING * INTO v_b2;
        v_fare_end := v_b2.actual_fare;
        IF p_close_as IS NOT NULL THEN
            UPDATE public.booking
               SET booking_status = 'Completed', payment_status = p_close_as,
                   payment_received_at = CASE WHEN p_close_as = 'Paid' THEN v_now ELSE payment_received_at END,
                   fare_unconfirmed = CASE WHEN p_close_as = 'Paid' AND confirm_fare_at IS NULL THEN TRUE ELSE fare_unconfirmed END,
                   actual_fare = CASE WHEN p_close_as = 'Waived' THEN 0 ELSE actual_fare END
             WHERE booking_id = p_booking_id
             RETURNING * INTO v_b2;
            IF p_close_as = 'Waived' AND COALESCE(v_fare_end, 0) <> 0 THEN
                INSERT INTO public.fare_adjustment_history (booking_id, reason_code, previous_fare, new_fare, details, actor_id, actor_role)
                VALUES (p_booking_id, 'ADMIN_CORRECTION', v_fare_end, 0,
                        jsonb_build_object('rule', '26.3', 'reason', v_reason), auth.uid(), v_role);
            END IF;
            v_how := 'ended_and_closed';
        END IF;
        PERFORM public._dispatch_notify_passenger(v_b2, 'TRIP_ENDED_FOR_SAFETY',
            'Tinapos ng administrator ang biyahe para sa kaligtasan (An administrator ended your trip for safety)',
            'An administrator ended your trip because ' || v_label || '. You pay at most for the distance travelled' || CASE WHEN p_close_as = 'Waived' THEN '; the fare was waived' ELSE '' END
            || '. (Tinapos ng administrator ang biyahe mo para sa kaligtasan; ang layong nalakbay lamang ang babayaran.)');
    ELSIF v_phase IN ('assigned', 'arrived') THEN
        v_how := 'redispatched';
        PERFORM public._dispatch_redispatch(p_booking_id, v_b.driver_id, 'system', v_reason);
    ELSE
        v_how := 'already_ended';
    END IF;

    -- the driver's side (Rules 29.20, 29.22)
    IF p_reason_code = 'driver_detained' THEN
        v_details := jsonb_build_object('booking_id', p_booking_id, 'note', v_note, 'ended_by_role', v_role,
            'review', 'The driver was detained or arrested during a trip (Rule 29.20). The TODA Administrator and the LGU Administrator review before the account resumes.');
        PERFORM public.create_admin_review_flag('DRIVER_DETENTION_TODA_REVIEW', 'driver', v_b.driver_id::TEXT, 'Rule 29.20', 'toda_admin', v_details);
        PERFORM public.create_admin_review_flag('DRIVER_DETENTION_LGU_REVIEW', 'driver', v_b.driver_id::TEXT, 'Rule 29.20', 'lgu_admin', v_details);
        PERFORM public._apply_suspension('driver', v_b.driver_id, NULL, 'INVESTIGATION',
            'Detained or arrested during a trip: under review by the TODA and the LGU Administrators (Rule 29.20).', NULL, NULL);
        PERFORM public._notify_subject('driver', v_b.driver_id, 'ACCOUNT_RESTRICTION_NOTICE', 'Suspendido ang Iyong Account (Your account is on hold)',
            'Your account is on hold while your TODA and the LGU review the incident on your trip. You are not struck. (Naka-hold ang account mo habang sinusuri ng TODA at LGU ang insidente; walang strike.)',
            p_booking_id::TEXT, 30);
    ELSIF p_reason_code = 'driver_incapacitated' THEN
        PERFORM public.create_admin_review_flag('DRIVER_INCAPACITATED_REVIEW', 'driver', v_b.driver_id::TEXT, 'Rule 29.22', 'toda_admin',
            jsonb_build_object('booking_id', p_booking_id, 'note', v_note, 'review', 'The driver became medically incapacitated during a trip. No strike is issued pending the administrative review (Rule 29.22).'));
    END IF;

    v_inc := public._incident_auto_file(p_booking_id, 'System', v_category,
        'An administrator ended the trip for safety because ' || v_label || ': ' || v_note || ' (Rules 26.3, 29.20 - 29.22)');
    PERFORM public.record_policy_audit('TRIP_ENDED_FOR_SAFETY', p_booking_id::TEXT, NULL, 'Trip End',
        'The ' || replace(v_role, '_', ' ') || ' ended the trip for safety (' || p_reason_code || '): ' || v_note,
        jsonb_build_object('booking_status', v_b.booking_status, 'payment_status', v_b.payment_status, 'actual_fare', v_b.actual_fare),
        jsonb_build_object('result', v_how, 'booking_status', COALESCE(v_b2.booking_status, v_b.booking_status), 'actual_fare', COALESCE(v_b2.actual_fare, v_b.actual_fare),
                           'payment_status', COALESCE(v_b2.payment_status, v_b.payment_status), 'incident_id', v_inc, 'booking_id', p_booking_id));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'result', v_how, 'booking_status', COALESCE(v_b2.booking_status, v_b.booking_status),
                              'actual_fare', COALESCE(v_b2.actual_fare, v_b.actual_fare), 'incident_id', v_inc);
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. RULE 2.5 AND THE LOST ITEM NOBODY CLAIMS (both run inside the existing hourly job: check_toda_excess_incidents() is called at the end of
--    run_scheduled_sla_and_expiry_cascade())
-- ----------------------------------------------------------------------------
-- A lost-item report with no TODA contact and no result after 14 days (F11.4) is SHOWN to the driver's TODA Administrator as a review flag; the
-- administrator closes it as Unclaimed (incident_lost_item_update). Nothing is closed by the job.
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
BEGIN
    PERFORM set_config('sakay.internal_context', 'true', true);
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
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN v_n;
END;
$$;

-- Rule 2.5 (the Batch 1 stub returned 0, "Batch 11 defines what constitutes an upheld incident report"): an UPHELD report about a driver of a TODA counts
-- once, on the day it was decided. The TODA that reaches the threshold (3, from the central configuration) within the window (60 days) gets ONE review
-- flag for the LGU Administrator. Returns the number of flags the run created (the lost-item flags included).
CREATE OR REPLACE FUNCTION public.check_toda_excess_incidents()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    r RECORD;
    v_threshold INTEGER := public.get_policy_config_int('toda_incident_report_flag_threshold', 3);
    v_window INTEGER := public.get_policy_config_int('toda_incident_report_window_days', 60);
    v_n INTEGER := 0;
    v_prev TEXT := current_setting('sakay.internal_context', true);
BEGIN
    PERFORM set_config('sakay.internal_context', 'true', true);
    FOR r IN
        SELECT i.reported_toda_id AS toda_id, count(*) AS n
          FROM public.incident_report i
         WHERE i.outcome = 'UPHELD' AND i.subject_type = 'driver' AND i.reported_toda_id IS NOT NULL
           AND i.resolved_at >= clock_timestamp() - make_interval(days => v_window)
         GROUP BY i.reported_toda_id
        HAVING count(*) >= v_threshold
    LOOP
        IF NOT EXISTS (SELECT 1 FROM public.admin_review_flag f WHERE f.flag_type = 'TODA_EXCESS_INCIDENTS' AND f.subject_type = 'toda'
                          AND f.subject_id = r.toda_id::TEXT AND f.status IN ('Open', 'Under Review')) THEN
            PERFORM public.create_admin_review_flag('TODA_EXCESS_INCIDENTS', 'toda', r.toda_id::TEXT, 'Rule 2.5', 'lgu_admin',
                jsonb_build_object('upheld_reports', r.n, 'window_days', v_window, 'threshold', v_threshold,
                    'note', 'Upheld incident reports against drivers of this TODA reached the threshold within the window. Supervisory review (Rule 2.5); nothing is imposed automatically.'));
            v_n := v_n + 1;
        END IF;
    END LOOP;
    v_n := v_n + public._incident_overdue_sweep();
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN v_n;
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. THE CALAMITY (Rules 15.3, 15.4, 29.6): ONE administrative action
-- ----------------------------------------------------------------------------
-- During a calamity the LGU Administrator issues a platform-wide announcement and, at their discretion, applies a blanket exemption: strike accrual
-- for cancellations, stalls and no-shows (or, as the existing switch allows, everything pausable) is suspended platform-wide until the event ends.
-- Serious and safety violations are never pausable. The announcement, the pause and the declaration are made together and recorded by ONE audit entry;
-- ending the calamity is one more. The old switch (set_strike_accrual_pause) stays, as a thin wrapper over the same function.
CREATE OR REPLACE FUNCTION public._apply_strike_accrual_pause(p_paused BOOLEAN, p_scope TEXT, p_reason TEXT, p_calamity JSONB DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_old JSONB;
    v_new JSONB;
    v_pause_id UUID;
    v_action TEXT;
    v_prev TEXT := current_setting('sakay.internal_context', true);
BEGIN
    SELECT config_value INTO v_old FROM public.system_policy_config WHERE config_key = 'strike_accrual_paused' FOR UPDATE;
    IF COALESCE((v_old->>'paused')::BOOLEAN, FALSE) = p_paused THEN
        RETURN jsonb_build_object('success', TRUE, 'unchanged', TRUE, 'state', v_old);
    END IF;

    v_pause_id := CASE WHEN p_paused THEN gen_random_uuid() ELSE NULLIF(v_old->>'pause_id', '')::UUID END;
    v_new := jsonb_build_object(
        'paused', p_paused, 'scope', p_scope, 'pause_id', v_pause_id,
        'reason', p_reason, 'declared_by', auth.uid(), 'changed_at', CURRENT_TIMESTAMP);

    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.system_policy_config
    SET config_value = v_new, updated_at = CURRENT_TIMESTAMP, updated_by = auth.uid()
    WHERE config_key = 'strike_accrual_paused';
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);

    v_action := CASE WHEN p_calamity IS NOT NULL THEN CASE WHEN p_paused THEN 'CALAMITY_DECLARED' ELSE 'CALAMITY_ENDED' END
                     ELSE CASE WHEN p_paused THEN 'STRIKE_ACCRUAL_PAUSED' ELSE 'STRIKE_ACCRUAL_RESUMED' END END;
    PERFORM public.record_policy_audit(
        v_action,
        COALESCE(p_calamity->>'declaration_id', v_pause_id::TEXT, 'strike_accrual_paused'), NULL, 'Strikes & Suspensions',
        CASE WHEN p_calamity IS NOT NULL THEN
                 CASE WHEN p_paused THEN 'Calamity declared (' || COALESCE(p_calamity->>'kind', '') || '): ' || COALESCE(p_calamity->>'title', '')
                                         || '. Announcement published and strike accrual paused platform-wide (scope ' || p_scope || '). Reason: ' || COALESCE(p_reason, '')
                      ELSE 'Calamity ended: ' || COALESCE(p_calamity->>'title', '') || '. Strike accrual resumed platform-wide.' END
             WHEN p_paused THEN 'Strike accrual paused platform-wide (scope ' || p_scope || '). Reason: ' || p_reason
             ELSE 'Strike accrual resumed platform-wide.' END,
        v_old, CASE WHEN p_calamity IS NULL THEN v_new ELSE v_new || jsonb_build_object('calamity', p_calamity) END);
    RETURN jsonb_build_object('success', TRUE, 'state', v_new);
END;
$$;

-- The existing switch (replaces 20261004000002): same checks, same answers, same audit names; it now calls the function above.
CREATE OR REPLACE FUNCTION public.set_strike_accrual_pause(
    p_paused BOOLEAN, p_scope TEXT DEFAULT 'ALL', p_reason TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
BEGIN
    IF NOT public.is_lgu_admin() THEN
        RAISE EXCEPTION 'Access Denied: Only the LGU Administrator can pause strike accrual.';
    END IF;
    IF p_scope NOT IN ('ALL', 'CANCEL_STALL_NOSHOW') THEN
        RAISE EXCEPTION 'Scope must be ALL or CANCEL_STALL_NOSHOW.';
    END IF;
    IF p_paused AND (p_reason IS NULL OR length(btrim(p_reason)) = 0) THEN
        RAISE EXCEPTION 'A reason (declared emergency or calamity) is required to pause strike accrual.';
    END IF;
    RETURN public._apply_strike_accrual_pause(p_paused, p_scope, p_reason, NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE TABLE IF NOT EXISTS public.calamity_declaration (
    declaration_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind            VARCHAR(30) NOT NULL CHECK (kind IN ('Typhoon', 'Flood', 'Earthquake', 'Road Closure', 'Declared Emergency', 'Other')),
    title           VARCHAR(255) NOT NULL,
    message         TEXT NOT NULL,
    scope           VARCHAR(30) NOT NULL CHECK (scope IN ('ALL', 'CANCEL_STALL_NOSHOW')),
    pause_id        UUID,
    announcement_id UUID,
    declared_by     UUID,
    declared_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at        TIMESTAMPTZ,
    ended_by        UUID,
    end_note        TEXT
);
-- one calamity at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_calamity_one_active ON public.calamity_declaration ((TRUE)) WHERE ended_at IS NULL;
ALTER TABLE public.calamity_declaration ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calamity_declaration_select_lgu ON public.calamity_declaration;
CREATE POLICY calamity_declaration_select_lgu ON public.calamity_declaration FOR SELECT TO authenticated USING (public.is_lgu_admin());
REVOKE ALL ON public.calamity_declaration FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.calamity_declaration FROM authenticated;

CREATE OR REPLACE FUNCTION public.declare_calamity(p_kind TEXT, p_title TEXT, p_message TEXT, p_scope TEXT DEFAULT 'CANCEL_STALL_NOSHOW')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_active public.calamity_declaration;
    v_id UUID := gen_random_uuid();
    v_ann UUID;
    v_pause JSONB;
    v_cfg JSONB;
    v_title TEXT := btrim(COALESCE(p_title, ''));
    v_msg TEXT := btrim(COALESCE(p_message, ''));
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RAISE EXCEPTION 'Access Denied: Only the LGU Administrator can declare a calamity.';
    END IF;
    IF p_kind IS NULL OR p_kind NOT IN ('Typhoon', 'Flood', 'Earthquake', 'Road Closure', 'Declared Emergency', 'Other') THEN
        RAISE EXCEPTION 'ERR_CALAMITY_KIND: Choose the kind of event.';
    END IF;
    IF p_scope IS NULL OR p_scope NOT IN ('ALL', 'CANCEL_STALL_NOSHOW') THEN
        RAISE EXCEPTION 'ERR_CALAMITY_SCOPE: The scope must be ALL or CANCEL_STALL_NOSHOW.';
    END IF;
    IF length(v_title) < 5 OR length(v_msg) < 10 THEN
        RAISE EXCEPTION 'ERR_CALAMITY_TEXT: Write a title (at least 5 characters) and the announcement (at least 10 characters).';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('sakay.calamity', 0));
    SELECT * INTO v_active FROM public.calamity_declaration WHERE ended_at IS NULL;
    IF FOUND THEN
        RETURN jsonb_build_object('success', TRUE, 'already_active', TRUE, 'declaration_id', v_active.declaration_id);
    END IF;
    SELECT config_value INTO v_cfg FROM public.system_policy_config WHERE config_key = 'strike_accrual_paused';
    IF COALESCE((v_cfg->>'paused')::BOOLEAN, FALSE) THEN
        RAISE EXCEPTION 'ERR_ALREADY_PAUSED: Strike accrual was already paused by hand (%). Resume it first, then declare the calamity.', COALESCE(v_cfg->>'reason', 'no reason recorded');
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    INSERT INTO public.announcement (toda_id, title, message, target_audience, urgency, is_published)
    VALUES (NULL, left(v_title, 255), v_msg, 'All', 'Urgent', TRUE)
    RETURNING announcement_id INTO v_ann;
    v_pause := public._apply_strike_accrual_pause(TRUE, p_scope, p_kind || ': ' || v_title,
        jsonb_build_object('declaration_id', v_id, 'kind', p_kind, 'title', v_title, 'announcement_id', v_ann));
    INSERT INTO public.calamity_declaration (declaration_id, kind, title, message, scope, pause_id, announcement_id, declared_by)
    VALUES (v_id, p_kind, left(v_title, 255), v_msg, p_scope, NULLIF(v_pause->'state'->>'pause_id', '')::UUID, v_ann, auth.uid());
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'declaration_id', v_id, 'announcement_id', v_ann, 'scope', p_scope, 'pause_id', v_pause->'state'->>'pause_id');
END;
$$;

CREATE OR REPLACE FUNCTION public.end_calamity(p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_c public.calamity_declaration;
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RAISE EXCEPTION 'Access Denied: Only the LGU Administrator can end a calamity.';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('sakay.calamity', 0));
    SELECT * INTO v_c FROM public.calamity_declaration WHERE ended_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', TRUE, 'no_active_calamity', TRUE);
    END IF;
    PERFORM set_config('sakay.internal_context', 'true', true);
    PERFORM public._apply_strike_accrual_pause(FALSE, v_c.scope, NULL,
        jsonb_build_object('declaration_id', v_c.declaration_id, 'kind', v_c.kind, 'title', v_c.title, 'announcement_id', v_c.announcement_id, 'note', NULLIF(btrim(COALESCE(p_note, '')), '')));
    UPDATE public.calamity_declaration SET ended_at = clock_timestamp(), ended_by = auth.uid(), end_note = NULLIF(btrim(COALESCE(p_note, '')), '')
     WHERE declaration_id = v_c.declaration_id;
    INSERT INTO public.announcement (toda_id, title, message, target_audience, urgency, is_published)
    VALUES (NULL, left('Normal operations resumed: ' || v_c.title, 255),
            'The event is over. Strikes for cancellations, stalls and no-shows count again from now. (Tapos na ang sakuna; muling mabibilang ang mga strike mula ngayon.)', 'All', 'Normal', TRUE);
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'declaration_id', v_c.declaration_id);
END;
$$;

-- What the apps show (a banner while it lasts): any signed-in user may read it
CREATE OR REPLACE FUNCTION public.get_active_calamity()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE((SELECT jsonb_build_object('active', TRUE, 'declaration_id', c.declaration_id, 'kind', c.kind, 'title', c.title, 'message', c.message,
                                               'scope', c.scope, 'declared_at', c.declared_at)
                       FROM public.calamity_declaration c WHERE c.ended_at IS NULL LIMIT 1),
                    jsonb_build_object('active', FALSE));
$$;

-- ----------------------------------------------------------------------------
-- 9. SHARE LIVE TRIP (Rule 26.1; figure F11.3)
-- ----------------------------------------------------------------------------
-- The passenger shares the current trip with the device's own sharing (SMS, Messenger, ...): a link that shows the trip's status and the vehicle's live
-- position, nothing else (no passenger name, no phone number, no fare, no account). The link is the only credential, so it is a 128-bit random token;
-- the database keeps only its SHA-256 hash (a leaked table gives no working link). It lives from its creation until the trip ends plus 15 minutes, and
-- never longer than 4 hours; the passenger can switch it off at any moment; there is one live link per trip (a new one replaces the old). The ONE
-- function an unsigned visitor may call is get_shared_trip_view(): it answers for a valid link, and for anything else ("not found", "revoked",
-- "expired", a malformed token) with the same {found: false}, so a guess learns nothing.
-- Not built, by decision of Rule 26.1: in-app emergency calling, messaging or emergency-contact management.
CREATE TABLE IF NOT EXISTS public.trip_share_link (
    link_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES public.booking(booking_id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_share_one_live ON public.trip_share_link (booking_id) WHERE revoked_at IS NULL;
ALTER TABLE public.trip_share_link ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trip_share_link FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public._share_hash(p_token TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT encode(sha256(convert_to(COALESCE(p_token, ''), 'UTF8')), 'hex');
$$;

-- When a link stops working: 15 minutes after the trip ended (completed or cancelled), or 4 hours after it was made, whichever comes first.
CREATE OR REPLACE FUNCTION public._trip_share_expires_at(p_created TIMESTAMPTZ, p_b public.booking)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT LEAST(
        p_created + make_interval(hours => public.incident_constant('share_link_max_hours')),
        CASE public._booking_phase(p_b.booking_status)
            WHEN 'completed' THEN COALESCE(p_b.trip_completed_at, p_created) + make_interval(mins => public.incident_constant('share_link_buffer_minutes'))
            WHEN 'cancelled' THEN COALESCE(p_b.cancelled_at, p_created) + make_interval(mins => public.incident_constant('share_link_buffer_minutes'))
            WHEN 'no_driver' THEN COALESCE(p_b.cancelled_at, p_created) + make_interval(mins => public.incident_constant('share_link_buffer_minutes'))
            ELSE 'infinity'::TIMESTAMPTZ
        END);
$$;

-- The passenger of a trip in progress makes (or re-reads) the link. p_reuse_token: the token this phone made earlier; when it is still the live one, the
-- same link is returned (so sharing twice sends the same link). The token leaves the database only here, once.
CREATE OR REPLACE FUNCTION public.create_trip_share(p_booking_id UUID, p_reuse_token TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_pax UUID := public.get_current_passenger_id();
    v_b public.booking;
    v_l public.trip_share_link;
    v_token TEXT;
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF v_pax IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_A_PASSENGER', 'error', 'Only a passenger can share a trip.');
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_b.passenger_id IS DISTINCT FROM v_pax THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_YOUR_BOOKING', 'error', 'This booking is not yours.');
    END IF;
    IF public._booking_phase(v_b.booking_status) NOT IN ('assigned', 'arrived', 'ongoing', 'at_destination') THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_SHARE_NOT_ACTIVE',
            'error', 'Maaari lamang ibahagi ang biyaheng may drayber na at nagpapatuloy. (A trip can be shared while it is in progress.)');
    END IF;
    IF p_reuse_token IS NOT NULL AND p_reuse_token ~ '^[0-9a-f]{32}$' THEN
        SELECT * INTO v_l FROM public.trip_share_link WHERE booking_id = p_booking_id AND revoked_at IS NULL AND token_hash = public._share_hash(p_reuse_token);
        IF FOUND AND v_now < public._trip_share_expires_at(v_l.created_at, v_b) THEN
            RETURN jsonb_build_object('success', TRUE, 'token', p_reuse_token, 'reused', TRUE, 'expires_at', public._trip_share_expires_at(v_l.created_at, v_b));
        END IF;
    END IF;
    UPDATE public.trip_share_link SET revoked_at = v_now WHERE booking_id = p_booking_id AND revoked_at IS NULL;
    -- 128 random bits: the hex of a hash over two random UUIDs and the clock (no extension needed)
    v_token := left(encode(sha256(convert_to(gen_random_uuid()::TEXT || gen_random_uuid()::TEXT || clock_timestamp()::TEXT, 'UTF8')), 'hex'), 32);
    INSERT INTO public.trip_share_link (booking_id, token_hash, created_by, created_at)
    VALUES (p_booking_id, public._share_hash(v_token), auth.uid(), v_now)
    RETURNING * INTO v_l;
    PERFORM public.record_policy_audit('TRIP_SHARE_CREATED', p_booking_id::TEXT, NULL, 'Share Live Trip',
        'The passenger made a Share Live Trip link (Rule 26.1); it expires when the trip ends plus ' || public.incident_constant('share_link_buffer_minutes') || ' minutes, at most '
        || public.incident_constant('share_link_max_hours') || ' hours from now.', NULL,
        jsonb_build_object('booking_id', p_booking_id, 'link_id', v_l.link_id));
    RETURN jsonb_build_object('success', TRUE, 'token', v_token, 'reused', FALSE, 'expires_at', public._trip_share_expires_at(v_l.created_at, v_b));
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_trip_share(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_pax UUID := public.get_current_passenger_id();
    v_n INTEGER;
BEGIN
    IF v_pax IS NULL OR NOT EXISTS (SELECT 1 FROM public.booking b WHERE b.booking_id = p_booking_id AND b.passenger_id = v_pax) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_YOUR_BOOKING', 'error', 'This booking is not yours.');
    END IF;
    UPDATE public.trip_share_link SET revoked_at = clock_timestamp() WHERE booking_id = p_booking_id AND revoked_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
        PERFORM public.record_policy_audit('TRIP_SHARE_REVOKED', p_booking_id::TEXT, NULL, 'Share Live Trip', 'The passenger switched off the Share Live Trip link.', NULL,
            jsonb_build_object('booking_id', p_booking_id));
    END IF;
    RETURN jsonb_build_object('success', TRUE, 'revoked', v_n);
END;
$$;

-- Whether this trip has a live link (the token itself is never returned again)
CREATE OR REPLACE FUNCTION public.get_my_trip_share(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_pax UUID := public.get_current_passenger_id();
    v_b public.booking;
    v_l public.trip_share_link;
BEGIN
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id;
    IF v_pax IS NULL OR NOT FOUND OR v_b.passenger_id IS DISTINCT FROM v_pax THEN
        RETURN jsonb_build_object('active', FALSE);
    END IF;
    SELECT * INTO v_l FROM public.trip_share_link WHERE booking_id = p_booking_id AND revoked_at IS NULL;
    IF NOT FOUND OR clock_timestamp() >= public._trip_share_expires_at(v_l.created_at, v_b) THEN
        RETURN jsonb_build_object('active', FALSE);
    END IF;
    RETURN jsonb_build_object('active', TRUE, 'expires_at', public._trip_share_expires_at(v_l.created_at, v_b), 'created_at', v_l.created_at);
END;
$$;

-- THE ONE FUNCTION AN UNSIGNED VISITOR MAY CALL (besides the TODA picker): what the person who received the link sees. A whitelist: the status of the trip, where
-- it goes, the driver's FIRST name and the plate (to recognize the tricycle), the vehicle's position and how old it is, how far along the trip is.
CREATE OR REPLACE FUNCTION public.get_shared_trip_view(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_l public.trip_share_link;
    v_b public.booking;
    v_d public.driver;
    v_phase TEXT;
    v_exp TIMESTAMPTZ;
    v_live BOOLEAN;
BEGIN
    IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN
        RETURN jsonb_build_object('found', FALSE);
    END IF;
    SELECT * INTO v_l FROM public.trip_share_link WHERE token_hash = public._share_hash(p_token) AND revoked_at IS NULL;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('found', FALSE);
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = v_l.booking_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('found', FALSE);
    END IF;
    v_exp := public._trip_share_expires_at(v_l.created_at, v_b);
    IF clock_timestamp() >= v_exp THEN
        RETURN jsonb_build_object('found', FALSE);
    END IF;
    v_phase := public._booking_phase(v_b.booking_status);
    v_live := v_phase IN ('assigned', 'arrived', 'ongoing', 'at_destination');
    SELECT * INTO v_d FROM public.driver WHERE driver_id = v_b.driver_id;
    RETURN jsonb_build_object(
        'found', TRUE,
        'state', v_phase,
        'ended', NOT v_live,
        'status_en', CASE v_phase WHEN 'assigned' THEN 'On the way to the pickup' WHEN 'arrived' THEN 'The driver has arrived at the pickup' WHEN 'ongoing' THEN 'The trip is in progress'
                                  WHEN 'at_destination' THEN 'Arrived at the destination' WHEN 'completed' THEN 'The trip has ended' ELSE 'The trip was cancelled' END,
        'status_tl', CASE v_phase WHEN 'assigned' THEN 'Papunta sa sasakay' WHEN 'arrived' THEN 'Dumating na ang drayber sa sasakyan' WHEN 'ongoing' THEN 'Nasa biyahe'
                                  WHEN 'at_destination' THEN 'Nakarating na sa destinasyon' WHEN 'completed' THEN 'Tapos na ang biyahe' ELSE 'Nakansela ang biyahe' END,
        'pickup_address', v_b.pickup_address,
        'dropoff_address', v_b.dropoff_address,
        'pickup', jsonb_build_object('lat', v_b.pickup_latitude, 'lng', v_b.pickup_longitude),
        'dropoff', jsonb_build_object('lat', v_b.dropoff_latitude, 'lng', v_b.dropoff_longitude),
        'driver_first_name', CASE WHEN v_d.driver_id IS NOT NULL THEN public.passenger_first_name(v_d.full_name) END,
        'plate_number', v_d.plate_number,
        'driver_position', CASE WHEN v_live AND v_d.current_latitude IS NOT NULL AND v_d.current_longitude IS NOT NULL
                                THEN jsonb_build_object('lat', v_d.current_latitude, 'lng', v_d.current_longitude,
                                                        'age_seconds', GREATEST(0, floor(EXTRACT(EPOCH FROM (clock_timestamp() - v_d.last_location_update)))::INTEGER)) END,
        'progress_pct', CASE WHEN v_phase = 'ongoing' THEN public._trip_progress_pct(v_b.booking_id) END,
        'expires_at', v_exp,
        'server_now', clock_timestamp());
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. PRIVILEGES
-- ----------------------------------------------------------------------------
-- What the apps and the portals call (signed-in users) ...
REVOKE EXECUTE ON FUNCTION public.incident_start_review(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.incident_escalate(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.incident_decide(UUID, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.incident_lost_item_update(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.file_urgent_safety_report(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_end_trip_for_safety(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.declare_calamity(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.end_calamity(TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_active_calamity() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_trip_share(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revoke_trip_share(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_trip_share(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.incident_start_review(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.incident_escalate(UUID, TEXT, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.incident_decide(UUID, TEXT, TEXT, TEXT, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.incident_lost_item_update(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.file_urgent_safety_report(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_end_trip_for_safety(UUID, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.declare_calamity(TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.end_calamity(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_active_calamity() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_trip_share(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_trip_share(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_trip_share(UUID) TO authenticated, service_role;
-- ... and the ONE function a visitor without an account may call (the person who received a Share Live Trip link)
REVOKE EXECUTE ON FUNCTION public.get_shared_trip_view(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_trip_view(TEXT) TO anon, authenticated, service_role;

-- everything else is the database's own
REVOKE EXECUTE ON FUNCTION public.incident_constant(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._incident_category_class(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._incident_strike_options(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._incident_set_routing(public.incident_report) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._incident_actor(public.incident_report) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._incident_auto_file(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._incident_admin_id(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._incident_notify_reporter(public.incident_report, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._incident_notify_other(public.incident_report, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._waive_victim_strikes(UUID, TEXT, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._safe_reason_exempt(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._safe_reason_record(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._early_stop_reason_is_valid(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._incident_overdue_sweep() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_toda_excess_incidents() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_toda_excess_incidents() TO service_role;
REVOKE EXECUTE ON FUNCTION public._apply_strike_accrual_pause(BOOLEAN, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._share_hash(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._trip_share_expires_at(TIMESTAMPTZ, public.booking) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.incident_report_guard() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 11. SELF-CHECK (the migration fails, and nothing is applied, if any of this is not true)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF public.incident_constant('safety_first_action_hours') <> 4 OR public.incident_constant('evidence_max_files') <> 3
       OR public.incident_constant('share_link_buffer_minutes') <> 15 OR public.incident_constant('share_link_max_hours') <> 4
       OR public.incident_constant('lost_item_file_days') <> 7 OR public.incident_constant('lost_item_unclaimed_days') <> 14 THEN
        RAISE EXCEPTION 'the incident constants are wrong';
    END IF;
    IF pg_get_functiondef('public.incident_report_guard()'::regprocedure) NOT LIKE '%ERR_INCIDENT_USE_REVIEW%' THEN
        RAISE EXCEPTION 'incident_report_guard() was not replaced';
    END IF;
    IF pg_get_functiondef('public.issue_strike(text, uuid, text, integer, uuid, uuid, text, boolean, text, text, jsonb)'::regprocedure) NOT LIKE '%LAWFUL_REFUSAL%'
       OR pg_get_functiondef('public.issue_strike(text, uuid, text, integer, uuid, uuid, text, boolean, text, text, jsonb)'::regprocedure) NOT LIKE '%sakay.admin_confirm%' THEN
        RAISE EXCEPTION 'issue_strike() was not replaced';
    END IF;
    IF pg_get_functiondef('public.driver_cancel_booking(uuid, text, text)'::regprocedure) NOT LIKE '%_safe_reason_record%'
       OR pg_get_functiondef('public.driver_stop_trip_early(uuid, text, text)'::regprocedure) NOT LIKE '%_incident_auto_file%'
       OR pg_get_functiondef('public.passenger_request_early_end(uuid, text, text)'::regprocedure) NOT LIKE '%_incident_auto_file%' THEN
        RAISE EXCEPTION 'a cancellation or early-end function was not replaced';
    END IF;
    IF pg_get_functiondef('public.check_toda_excess_incidents()'::regprocedure) NOT LIKE '%TODA_EXCESS_INCIDENTS%' THEN
        RAISE EXCEPTION 'check_toda_excess_incidents() is still the stub';
    END IF;
    IF pg_get_functiondef('public.admin_reinstate_account(text, uuid, text, boolean)'::regprocedure) NOT LIKE '%DRIVER_DETENTION%' THEN
        RAISE EXCEPTION 'admin_reinstate_account() was not replaced';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'incident_report' AND column_name = 'outcome') THEN
        RAISE EXCEPTION 'incident_report.outcome is missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('uq_trip_share_one_live'))
       OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('uq_calamity_one_active')) THEN
        RAISE EXCEPTION 'a unique index is missing';
    END IF;
    IF has_function_privilege('authenticated', 'public._incident_auto_file(uuid, text, text, text)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public._apply_strike_accrual_pause(boolean, text, text, jsonb)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public._waive_victim_strikes(uuid, text, uuid, uuid, text)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.check_toda_excess_incidents()', 'EXECUTE') THEN
        RAISE EXCEPTION 'a signed-in user can run an internal incident function';
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.incident_decide(uuid, text, text, text, integer)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.file_urgent_safety_report(uuid, text, text)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.create_trip_share(uuid, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'the apps cannot call the incident functions';
    END IF;
    IF NOT has_function_privilege('anon', 'public.get_shared_trip_view(text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'a visitor cannot open a Share Live Trip link';
    END IF;
    IF has_function_privilege('anon', 'public.create_trip_share(uuid, text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.incident_decide(uuid, text, text, text, integer)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.get_active_calamity()', 'EXECUTE') THEN
        RAISE EXCEPTION 'an anonymous caller can reach a signed-in function';
    END IF;
END $$;
