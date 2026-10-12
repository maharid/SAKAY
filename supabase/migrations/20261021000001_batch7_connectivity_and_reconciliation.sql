-- ============================================================================
-- Migration: 20261021000001_batch7_connectivity_and_reconciliation.sql
-- Batch 7: driver failure-to-proceed, mid-booking unavailability, GPS staleness and connectivity (Rules 8, 9, 17, 29.2, 29.10, 29.11).
--
-- Batch 6 already runs the stall and silence clocks in the database (booking_timers_sweep, every 5 s). This migration completes them:
--
--   Rule 8.4   a warning 1 minute before the 5-minute stand-still cancellation (decision D7-7); the delay the driver reports is STORED
--              (reason + audit row), not just counted
--   Rules 8.2-8.4  the stall movement test subtracts the error of BOTH fixes (decision D7-8: stall_anchor_accuracy_m)
--   Rule 8.7   DRV_PICKUP_DEVIATION: ADMIN_CONFIRMATION, 1 strike on the FIRST confirmed case (decision G6)
--   Rule 9.2 / 9.5 / 17.3 / 29.11  every silence is RECORDED (trip_connectivity_event): when it started, the last fix kept as the
--              passenger's last confirmed location, when it ended, whether the driver re-confirmed the trip
--   Rule 9.5   the driver must re-confirm an Ongoing trip after a silence before it can proceed to fare finalisation
--              (booking_status_guard, driver_reconfirm_trip); after 30 minutes the trip is reconciled by the TODA Administrator
--              (admin_reconcile_trip: outcome Completed / Cancelled, the system's fare or a LOWER agreed amount, audited)
--   Rule 9.6   a deliberate mid-trip offline is REPORTED by the TODA Administrator with its evidence and CONFIRMED by the LGU
--              Administrator: 2 strikes, never exemptible (report_deliberate_offline, confirm_deliberate_offline, violation_catalog.lgu_only)
--   Rule 9.2 / 12.6  a passenger who cancels while the driver is Unreachable is not struck (decision D7-6)
--   Rule 17.5  repeated GPS-caused determinations of one area are listed for the administrators and reported to the LGU Administrator
--              (get_gps_determination_hotspots, report_gps_area_issue; the shared review-flag mechanism)
--   Rule 17.9  get_driver_live_status: the driver's position AND how old it is by the SERVER's clock (the passenger map's timestamp)
--
-- Replaces (CREATE OR REPLACE, the previous copies are NOT edited): dispatch_constant, booking_identity_guard, booking_timers_sweep,
-- driver_report_delay, booking_status_guard, strike_on_passenger_cancellation.
-- Forward-only. Safe to run twice.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. THE NUMBERS (dispatch_constant: every key of 20261019000001, plus four new ones at the end)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispatch_constant(p_key TEXT)
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE p_key
        WHEN 'offer_window_seconds'      THEN COALESCE((SELECT s.setting_value FROM public.dispatch_setting s WHERE s.setting_key = 'offer_window_seconds'), public.dispatch_setting_default('offer_window_seconds'))
        WHEN 'tier3_max_seconds'         THEN COALESCE((SELECT s.setting_value FROM public.dispatch_setting s WHERE s.setting_key = 'tier3_max_seconds'), public.dispatch_setting_default('tier3_max_seconds'))
        WHEN 'offer_grace_seconds'       THEN 5      -- the phone needs a moment to receive an offer; the driver still gets the whole window
        WHEN 'tier1_radius_m'            THEN 600    -- spec s.4: Priority TODA geofence
        WHEN 'tier2_radius_m'            THEN 2000   -- spec s.5
        WHEN 'tier3_refresh_seconds'     THEN 30     -- spec s.6: pool refresh
        WHEN 'accepted_cancel_limit'     THEN 3      -- Rule 12.8: consecutive accepted drivers who cancel the same booking
        WHEN 'eta_speed_kmh'             THEN 20     -- the fixed travel speed the apps already use for an estimated arrival
        WHEN 'eta_winding_percent'       THEN 130    -- straight line x 1.3 (the apps' road estimate)
        WHEN 'passenger_cancel_grace_seconds' THEN 60   -- Rule 12.1
        WHEN 'driver_travel_threshold_m' THEN 50     -- Rules 12.3 / 12.4
        WHEN 'stall_warn_seconds'        THEN 120    -- Rule 8.2: no movement toward the pickup this long after accepting: warn the driver
        WHEN 'stall_cancel_seconds'      THEN 180    -- Rule 8.3: still not moving (3 minutes in all): cancelled on the driver's behalf and redispatched
        WHEN 'stall_min_movement_m'      THEN 20     -- Rules 8.2 / 8.3: less movement than this counts as not moving
        WHEN 'stall_en_route_seconds'    THEN 300    -- Rule 8.4: a driver who has moved but then stands still this long (approach phase) is stalled
        WHEN 'ongoing_reconcile_seconds' THEN 1800   -- Rule 9.5: an Ongoing trip silent this long goes to the TODA administrator for manual reconciliation
        WHEN 'unreachable_warn_seconds'  THEN 180    -- Rule 9.2: no location from an accepted driver this long: Driver Unreachable, passenger told
        WHEN 'unreachable_cancel_seconds' THEN 300   -- Rule 9.3: five minutes in all: cancelled, provisional strike, redispatched
        WHEN 'no_show_wait_seconds'      THEN 300    -- Rule 10.1: the passenger has this long after the driver arrived
        WHEN 'no_show_extension_seconds' THEN 120    -- Rule 10.3: "I'm Almost There", once: 2 more minutes (7 in all)
        WHEN 'zone_max_accuracy_m'       THEN 50     -- PI-06: a fix less accurate than this is ignored when asking "is the driver at the pickup?"
        WHEN 'no_show_radius_m'          THEN 15     -- Rule 10.1: the driver must be this close to the pickup to report a no-show (figure F8.3; 15 m allows for GPS error)
        WHEN 'completion_confirm_timeout_seconds' THEN 120   -- Rule 16.6: the passenger's confirmation prompt; then the driver may end the trip
        WHEN 'repeat_cancel_flag_count'  THEN 3      -- Rules 12.7 / 12.9: cancellations in the window that raise a review flag (no strike)
        WHEN 'repeat_cancel_window_hours' THEN 24
        WHEN 'decline_flag_count'        THEN 5      -- Rule 7.9 pattern flag (review only, no strike); pilot value
        WHEN 'decline_flag_window_hours' THEN 24
        WHEN 'sweep_batch_limit'         THEN 50     -- bookings advanced per sweep call
        WHEN 'trip_finish_min_progress_pct'     THEN 90    -- the driver may finish the trip from this progress up (the destination pin can sit inside a building the tricycle cannot enter)
        WHEN 'trip_progress_near_destination_m' THEN 80    -- within this distance of the destination pin the progress reads its maximum
        WHEN 'trip_progress_cap_pct'            THEN 95    -- progress while the passenger is on board never reads more than this (100 belongs to a trip that has arrived)
        WHEN 'trip_progress_floor_pct'          THEN 5     -- ... and never less than this
        -- Phase B of Batch 6 (2026-10-11)
        WHEN 'retry_max_age_minutes'     THEN 60     -- D-4: a No Driver Found booking older than this cannot be retried (the pickup is probably not where the passenger is)
        WHEN 'coverage_gap_count'        THEN 5      -- Rule 7.10 / PI-11 = A, figure F6.9: bookings of one zone reaching Tier 3 or ending as No Driver Found ...
        WHEN 'coverage_gap_window_hours' THEN 24     -- ... within this many hours are logged as a Coverage Gap Indicator (analysis only)
        WHEN 'decline_history_days'      THEN 30     -- Rule 7.9: how far back the TODA administrator's decline history reads by default
        WHEN 'osrm_timeout_ms'           THEN 2000   -- D-1 / F6.10: one request to the routing engine may take this long
        WHEN 'osrm_cache_seconds'        THEN 15     -- F6.10: an ETA from the routing engine is reused this long
        WHEN 'osrm_failure_limit'        THEN 3      -- F6.10: this many failed requests in a row open the circuit breaker ...
        WHEN 'osrm_breaker_seconds'      THEN 60     -- ... and the routing engine is not asked for this long (the labelled straight-line estimate is used)
        WHEN 'osrm_max_candidates'       THEN 15     -- the nearest candidates (straight line) of a tier that are ranked by the routing engine in one request
        WHEN 'osrm_calls_per_transaction' THEN 2     -- one ranking may make at most this many requests (the primary and one retry on the second server)
        WHEN 'cron_log_retention_days'   THEN 2      -- the daily housekeeping job keeps this many days of pg_cron run details and OSRM cache rows
        -- Batch 7 (2026-10-12)
        WHEN 'stall_en_route_warn_seconds' THEN 240  -- Rule 8.4, decision D7-7: the driver who stands still on the way is warned this long into the stand-still (1 minute before the cancellation), with the Rule 8.2 text
        WHEN 'gps_area_cell_millidegrees' THEN 5     -- Rule 17.5: determinations are grouped into squares of this many thousandths of a degree (0.005 degrees, about 550 m)
        WHEN 'gps_area_flag_count'       THEN 3      -- Rule 17.5: determinations of one square within the window that are worth reporting (the policy says "repeatedly"; provisional pilot value)
        WHEN 'gps_area_window_days'      THEN 30     -- Rule 17.5: how far back the determinations are counted
        ELSE NULL
    END;
$$;

-- ----------------------------------------------------------------------------
-- 2. WHAT THE BOOKING REMEMBERS (two columns) AND THE GUARD THAT KEEPS THEM THE SYSTEM'S
-- ----------------------------------------------------------------------------
-- stall_anchor_accuracy_m: the reported error of the fix that is the stall anchor, so that "he moved" subtracts the error of BOTH fixes
-- (the fare engine's dead-band does the same). It is filled by the trigger below whenever the anchor moves (the acceptance, the sweep).
-- stall_delay_reason: the last delay the driver reported through the in-app templates (Rule 8.4).
ALTER TABLE public.booking
    ADD COLUMN IF NOT EXISTS stall_anchor_accuracy_m DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS stall_delay_reason      TEXT;
COMMENT ON COLUMN public.booking.stall_anchor_accuracy_m IS 'Rules 8.2-8.4: the reported accuracy (m) of the fix that is the stall anchor. Set by the system only.';
COMMENT ON COLUMN public.booking.stall_delay_reason IS 'Rule 8.4: the last delay the driver reported (traffic or road_closure). Set by driver_report_delay() only.';

CREATE OR REPLACE FUNCTION public.booking_stall_anchor_accuracy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.stall_anchor_at IS NULL THEN
        NEW.stall_anchor_accuracy_m := NULL;
    ELSE
        -- the anchor is always the driver's last fix at the moment it is set (the acceptance, the sweep): its accuracy is the driver's last one
        SELECT d.last_location_accuracy_m INTO NEW.stall_anchor_accuracy_m FROM public.driver d WHERE d.driver_id = NEW.driver_id;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_booking_stall_anchor_accuracy ON public.booking;
CREATE TRIGGER trigger_booking_stall_anchor_accuracy BEFORE UPDATE OF stall_anchor_at ON public.booking
    FOR EACH ROW WHEN (NEW.stall_anchor_at IS DISTINCT FROM OLD.stall_anchor_at)
    EXECUTE FUNCTION public.booking_stall_anchor_accuracy();

-- The system's columns cannot be edited by the people on the booking (replaces 20261019000001: the two new columns join the list).
CREATE OR REPLACE FUNCTION public.booking_identity_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF public.is_trusted_session() OR COALESCE(public.is_lgu_admin(), FALSE) THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        NEW.accepted_at := NULL;  NEW.arrived_at := NULL;  NEW.trip_started_at := NULL;  NEW.trip_completed_at := NULL;
        NEW.cancelled_at := NULL;  NEW.cancelled_by := NULL;  NEW.cancellation_reason := NULL;
        NEW.shared_trip_match_id := NULL;
        NEW.search_restarted_at := NULL;
        RETURN NEW;
    END IF;

    IF NEW.passenger_id IS DISTINCT FROM OLD.passenger_id THEN
        -- The only legitimate change: the foreign key nulling the link after the passenger row was deleted.
        IF NOT (NEW.passenger_id IS NULL
                AND OLD.passenger_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM public.passenger p WHERE p.passenger_id = OLD.passenger_id)) THEN
            RAISE EXCEPTION 'ERR_BOOKING_OWNER_LOCKED: The passenger of a booking cannot be changed.' USING ERRCODE = '42501';
        END IF;
    END IF;
    IF NEW.toda_id IS DISTINCT FROM OLD.toda_id THEN
        RAISE EXCEPTION 'ERR_BOOKING_TODA_LOCKED: The TODA of a booking cannot be changed by the people on it.' USING ERRCODE = '42501';
    END IF;
    IF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
        -- Likewise the only change a client session may see: the foreign key nulling the link after the driver row was deleted.
        IF NOT (NEW.driver_id IS NULL
                AND OLD.driver_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM public.driver d WHERE d.driver_id = OLD.driver_id)) THEN
            RAISE EXCEPTION 'ERR_BOOKING_DRIVER_LOCKED: A driver is attached to a booking only by accepting an offer (accept_booking_offer).' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF NEW.dispatch_cycle IS DISTINCT FROM OLD.dispatch_cycle
       OR NEW.dispatch_tier IS DISTINCT FROM OLD.dispatch_tier
       OR NEW.dispatch_cycle_started_at IS DISTINCT FROM OLD.dispatch_cycle_started_at
       OR NEW.dispatch_tier_started_at IS DISTINCT FROM OLD.dispatch_tier_started_at
       OR NEW.dispatch_pool_refreshed_at IS DISTINCT FROM OLD.dispatch_pool_refreshed_at
       OR NEW.dispatch_next_action_at IS DISTINCT FROM OLD.dispatch_next_action_at
       OR NEW.dispatch_reached_tier3_at IS DISTINCT FROM OLD.dispatch_reached_tier3_at
       OR NEW.dispatch_ended_reason IS DISTINCT FROM OLD.dispatch_ended_reason
       OR NEW.dispatch_ended_at IS DISTINCT FROM OLD.dispatch_ended_at
       OR NEW.priority_toda_id IS DISTINCT FROM OLD.priority_toda_id
       OR NEW.accepted_driver_cancel_count IS DISTINCT FROM OLD.accepted_driver_cancel_count
       OR NEW.accept_latitude IS DISTINCT FROM OLD.accept_latitude
       OR NEW.accept_longitude IS DISTINCT FROM OLD.accept_longitude
       OR NEW.stall_anchor_latitude IS DISTINCT FROM OLD.stall_anchor_latitude
       OR NEW.stall_anchor_longitude IS DISTINCT FROM OLD.stall_anchor_longitude
       OR NEW.stall_anchor_at IS DISTINCT FROM OLD.stall_anchor_at
       OR NEW.stall_anchor_accuracy_m IS DISTINCT FROM OLD.stall_anchor_accuracy_m
       OR NEW.stall_delay_reported_at IS DISTINCT FROM OLD.stall_delay_reported_at
       OR NEW.stall_delay_reports IS DISTINCT FROM OLD.stall_delay_reports
       OR NEW.stall_delay_reason IS DISTINCT FROM OLD.stall_delay_reason
       OR NEW.stall_warned_at IS DISTINCT FROM OLD.stall_warned_at
       OR NEW.driver_unreachable_since IS DISTINCT FROM OLD.driver_unreachable_since
       OR NEW.wait_extended_at IS DISTINCT FROM OLD.wait_extended_at
       OR NEW.search_restarted_at IS DISTINCT FROM OLD.search_restarted_at THEN
        RAISE EXCEPTION 'ERR_DISPATCH_LOCKED: The search for a driver is managed by the system and cannot be edited.' USING ERRCODE = '42501';
    END IF;

    -- The moments of the trip and who cancelled change only together with the status (the status guard stamps them).
    IF NEW.booking_status IS NOT DISTINCT FROM OLD.booking_status
       AND (NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
            OR NEW.arrived_at IS DISTINCT FROM OLD.arrived_at
            OR NEW.trip_started_at IS DISTINCT FROM OLD.trip_started_at
            OR NEW.trip_completed_at IS DISTINCT FROM OLD.trip_completed_at
            OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
            OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by) THEN
        RAISE EXCEPTION 'ERR_BOOKING_TIMES_LOCKED: The times of a trip are recorded by the system.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. THE RECORD OF EVERY SILENCE (Rules 9.2, 9.5, 9.6, 17.3, 17.5, 29.11)
-- ----------------------------------------------------------------------------
-- One row per episode: the moment the system marked the silence (3 minutes after the last fix), the LAST CONFIRMED POINT (kept here, so that
-- it is not lost when the driver's own row is overwritten on reconnection), when the driver was heard again, whether he re-confirmed the trip
-- (Ongoing only), whether the 30-minute reconciliation was needed and how it was closed. Written by the system only. It is also the data
-- of the Rule 9.6 pattern review and of the Rule 17.5 area escalation.
CREATE TABLE IF NOT EXISTS public.trip_connectivity_event (
    event_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id            UUID NOT NULL REFERENCES public.booking(booking_id) ON DELETE CASCADE,
    driver_id             UUID REFERENCES public.driver(driver_id) ON DELETE SET NULL,
    phase                 VARCHAR(20) NOT NULL CHECK (phase IN ('assigned', 'arrived', 'ongoing')),
    started_at            TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    last_fix_latitude     DOUBLE PRECISION,
    last_fix_longitude    DOUBLE PRECISION,
    last_fix_accuracy_m   DOUBLE PRECISION,
    last_fix_at           TIMESTAMPTZ,
    restored_at           TIMESTAMPTZ,
    ended_reason          VARCHAR(30) CHECK (ended_reason IN ('auto_cancelled', 'reconciled', 'booking_ended')),
    reconfirmed_at        TIMESTAMPTZ,
    reconfirmed_as        VARCHAR(20) CHECK (reconfirmed_as IN ('ongoing', 'ended')),
    reconcile_flagged_at  TIMESTAMPTZ,
    reconcile_flag_id     UUID,
    reconciled_at         TIMESTAMPTZ,
    reconciled_by         UUID,
    reconcile_outcome     VARCHAR(20) CHECK (reconcile_outcome IN ('completed', 'cancelled')),
    reconcile_fare        NUMERIC(10, 2),
    reconcile_note        TEXT,
    contacted_driver      BOOLEAN,
    contacted_passenger   BOOLEAN
);
COMMENT ON TABLE public.trip_connectivity_event IS 'Rules 9.2 / 9.5 / 9.6 / 17.5: one row per silence of an accepted driver. Written by the system only.';

-- at most one OPEN silence per booking (the sweep may run twice at once)
CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_connectivity_open
    ON public.trip_connectivity_event (booking_id) WHERE restored_at IS NULL AND ended_reason IS NULL;
CREATE INDEX IF NOT EXISTS idx_trip_connectivity_reconfirm
    ON public.trip_connectivity_event (booking_id) WHERE phase = 'ongoing' AND reconfirmed_at IS NULL AND ended_reason IS NULL;
CREATE INDEX IF NOT EXISTS idx_trip_connectivity_reconcile
    ON public.trip_connectivity_event (reconcile_flagged_at) WHERE reconcile_flagged_at IS NOT NULL AND reconciled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_trip_connectivity_driver
    ON public.trip_connectivity_event (driver_id, started_at DESC);

ALTER TABLE public.trip_connectivity_event ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trip_connectivity_event_select ON public.trip_connectivity_event;
CREATE POLICY trip_connectivity_event_select ON public.trip_connectivity_event FOR SELECT TO authenticated
    USING (driver_id = (SELECT public.get_current_driver_id())
           OR (SELECT COALESCE(public.is_lgu_admin(), FALSE))
           OR (driver_id IS NOT NULL AND public.is_toda_admin_for_driver(driver_id)));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.trip_connectivity_event FROM anon, authenticated;
REVOKE SELECT ON public.trip_connectivity_event FROM anon;

-- ----------------------------------------------------------------------------
-- 4. THE VOCABULARY: a service-area subject for the Rule 17.5 flag, and the two violations of Rules 8.7 / 9.6
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_con RECORD;
BEGIN
    FOR v_con IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'public.admin_review_flag'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%subject_type%'
    LOOP
        EXECUTE format('ALTER TABLE public.admin_review_flag DROP CONSTRAINT %I', v_con.conname);
    END LOOP;
END $$;
ALTER TABLE public.admin_review_flag
    ADD CONSTRAINT admin_review_flag_subject_type_check
    CHECK (subject_type IN ('toda', 'driver_application', 'driver', 'passenger', 'service_area'));

-- A violation only the LGU Administrator may confirm (Rule 9.6: the TODA Administrator reports it, the LGU confirms it).
ALTER TABLE public.violation_catalog ADD COLUMN IF NOT EXISTS lgu_only BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.violation_catalog
   SET confirmation_mode = 'ADMIN_CONFIRMATION',
       lgu_only = TRUE,
       rules_note = 'Rule 9.6: 2 strikes, never exemptible (Rule 9.4 does not apply). The TODA Administrator reports it (report_deliberate_offline) with the evidence (pattern review, passenger report or admission); the LGU Administrator confirms it (confirm_deliberate_offline).'
 WHERE violation_code = 'DRV_DELIBERATE_OFFLINE';

UPDATE public.violation_catalog
   SET confirmation_mode = 'ADMIN_CONFIRMATION',
       repeat_min_occurrences = 1,
       description = 'Intentional deviation from the most reasonable route toward the pickup without a documented cause (confirmed after investigation)',
       rules_note = 'Rule 8.7 (decision G6 of Batch 7): 1 strike on the FIRST confirmed case, after investigation of a passenger complaint. Replaces the PI-B3 "2nd occurrence" reading for this violation.'
 WHERE violation_code = 'DRV_PICKUP_DEVIATION';

CREATE OR REPLACE FUNCTION public.strike_lgu_only_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.issued_by_role = 'toda_admin'
       AND EXISTS (SELECT 1 FROM public.violation_catalog c WHERE c.violation_code = NEW.violation_code AND c.lgu_only) THEN
        RAISE EXCEPTION 'Access Denied: Only the LGU Administrator can confirm % (the TODA Administrator reports it).', NEW.violation_code;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_strike_lgu_only_guard ON public.strikes_ledger;
CREATE TRIGGER trigger_strike_lgu_only_guard BEFORE INSERT ON public.strikes_ledger
    FOR EACH ROW EXECUTE FUNCTION public.strike_lgu_only_guard();

-- ----------------------------------------------------------------------------
-- 5. THE SWEEP FOR ACCEPTED BOOKINGS (replaces 20261015000005; called by dispatch_sweep() every 5 s)
-- ----------------------------------------------------------------------------
-- Changes: (a) every silence is recorded in trip_connectivity_event, with the last fix kept; (b) the stall movement subtracts the error of both
-- fixes; (c) the en-route stand-still is warned at 4 minutes. Everything else is the Batch 6 behaviour, unchanged. Idempotent as before.
CREATE OR REPLACE FUNCTION public.booking_timers_sweep()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    r RECORD;
    v_b public.booking;
    v_d public.driver;
    v_ev public.trip_connectivity_event;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_now TIMESTAMPTZ := clock_timestamp();
    v_phase TEXT;
    v_heard TIMESTAMPTZ;
    v_silent DOUBLE PRECISION;
    v_fresh BOOLEAN;
    v_moved DOUBLE PRECISION;
    v_idle DOUBLE PRECISION;
    v_never BOOLEAN;
    v_n INTEGER := 0;
    v_tag INTEGER;
    v_rows INTEGER;
    v_flag UUID;
    v_res TEXT;
BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtextextended('sakay.booking_timers', 0)) THEN
        RETURN 0;
    END IF;
    PERFORM set_config('sakay.internal_context', 'true', true);

    -- A silence whose booking has ended or changed hands (a cancellation, a reconciliation by an administrator) is closed.
    UPDATE public.trip_connectivity_event e
       SET ended_reason = 'booking_ended'
      FROM public.booking b
     WHERE b.booking_id = e.booking_id
       AND e.restored_at IS NULL AND e.ended_reason IS NULL
       AND (b.driver_id IS DISTINCT FROM e.driver_id OR NOT public._booking_is_open_accepted(b.booking_status));

    FOR r IN
        SELECT b.booking_id
          FROM public.booking b
         -- the literal list of the statuses with a driver committed and the trip not yet at its destination (assigned, arrived, ongoing), the
         -- same list as idx_booking_open_accepted: only a literal lets the database use that partial index instead of reading every trip ever made
         WHERE b.driver_id IS NOT NULL
           AND b.booking_status IN ('Accepted', 'Assigned', 'Driver Assigned', 'Driver En Route', 'Heading to Passenger', 'In Transit',
                                    'Driver Arrived', 'Arrived at Pickup', 'Trip Ongoing', 'Ongoing')
    LOOP
        BEGIN
            SELECT * INTO v_b FROM public.booking WHERE booking_id = r.booking_id FOR UPDATE SKIP LOCKED;
            CONTINUE WHEN NOT FOUND OR v_b.driver_id IS NULL;
            v_phase := public._booking_phase(v_b.booking_status);
            CONTINUE WHEN v_phase NOT IN ('assigned', 'arrived', 'ongoing');
            SELECT * INTO v_d FROM public.driver WHERE driver_id = v_b.driver_id;
            CONTINUE WHEN NOT FOUND;
            v_tag := v_b.dispatch_cycle * 100 + v_b.accepted_driver_cancel_count;

            -- ---- Rule 9: has the driver been heard from? (a location update is the only thing that counts)
            v_heard := GREATEST(COALESCE(v_d.last_location_update, '-infinity'::TIMESTAMPTZ), COALESCE(v_b.accepted_at, v_now));
            v_silent := EXTRACT(EPOCH FROM (v_now - v_heard));

            IF v_silent >= public.dispatch_constant('unreachable_warn_seconds') THEN
                IF v_b.driver_unreachable_since IS NULL THEN                                   -- Rule 9.2 / 9.5: marked once, the passenger is told
                    UPDATE public.booking SET driver_unreachable_since = v_now WHERE booking_id = v_b.booking_id RETURNING * INTO v_b;
                    -- the record of this silence, with the last confirmed point (decision D7-9)
                    INSERT INTO public.trip_connectivity_event (booking_id, driver_id, phase, started_at,
                                                                last_fix_latitude, last_fix_longitude, last_fix_accuracy_m, last_fix_at)
                    VALUES (v_b.booking_id, v_b.driver_id, v_phase, v_now,
                            v_d.current_latitude, v_d.current_longitude, v_d.last_location_accuracy_m, v_d.last_location_update)
                    ON CONFLICT (booking_id) WHERE restored_at IS NULL AND ended_reason IS NULL DO NOTHING;
                    PERFORM public._dispatch_notify_passenger(v_b, 'DRIVER_UNREACHABLE',
                        'Connection lost — reconnecting... (Nawalan ng koneksyon)',
                        'Your driver appears to be experiencing a connectivity issue. We''ll keep trying to reach them. '
                        || '(Mukhang may problema sa koneksyon ang iyong drayber. Patuloy kaming susubok na makontak siya.)');
                    PERFORM public.record_policy_audit('CONNECTIVITY_INTERRUPTED', v_b.booking_id::TEXT, v_d.full_name, 'Dispatch',
                        'No location update from the driver for more than ' || public.dispatch_constant('unreachable_warn_seconds') / 60
                        || ' minutes (Rule 9.2); trip phase: ' || v_phase || '.', NULL,
                        jsonb_build_object('booking_id', v_b.booking_id, 'driver_id', v_b.driver_id, 'phase', v_phase,
                                           'last_fix_at', v_d.last_location_update));
                    v_n := v_n + 1;
                ELSE
                    -- already marked: make sure the silence has its record (a mark made before this table existed)
                    INSERT INTO public.trip_connectivity_event (booking_id, driver_id, phase, started_at,
                                                                last_fix_latitude, last_fix_longitude, last_fix_accuracy_m, last_fix_at)
                    VALUES (v_b.booking_id, v_b.driver_id, v_phase, v_b.driver_unreachable_since,
                            v_d.current_latitude, v_d.current_longitude, v_d.last_location_accuracy_m, v_d.last_location_update)
                    ON CONFLICT (booking_id) WHERE restored_at IS NULL AND ended_reason IS NULL DO NOTHING;
                END IF;

                IF v_phase = 'assigned' AND v_silent >= public.dispatch_constant('unreachable_cancel_seconds') THEN
                    v_res := public._booking_timer_cancel(v_b.booking_id, v_b.driver_id, 'DRV_CONNECTIVITY_FAILURE', 'Rule 9.3',
                        'No location update from the driver for ' || public.dispatch_constant('unreachable_cancel_seconds') / 60 || ' minutes before arriving at the pickup.',
                        'We could not reach you for 5 minutes, so this booking was cancelled and given to another driver. A provisional strike was recorded; '
                        || 'if the cause was outside your control (dead battery, no signal, a damaged phone), you may ask your TODA administrator to waive it within 48 hours.',
                        'We lost contact with your driver, so we are finding you another driver. '
                        || '(Nawalan kami ng kontak sa iyong drayber, kaya naghahanap kami ng ibang drayber.)');
                    IF v_res IN ('redispatched', 'terminated') THEN
                        UPDATE public.trip_connectivity_event SET ended_reason = 'auto_cancelled'
                         WHERE booking_id = v_b.booking_id AND restored_at IS NULL AND ended_reason IS NULL;
                    END IF;
                    v_n := v_n + 1;
                ELSIF v_phase = 'ongoing'
                      AND v_now - v_b.driver_unreachable_since >= make_interval(secs => public.dispatch_constant('ongoing_reconcile_seconds')) THEN
                    -- Rule 9.5: a boarded passenger is never stranded: the trip stays open and the TODA administrator reconciles it by phone.
                    SELECT * INTO v_ev FROM public.trip_connectivity_event
                     WHERE booking_id = v_b.booking_id AND restored_at IS NULL AND ended_reason IS NULL
                     ORDER BY started_at DESC LIMIT 1;
                    IF FOUND AND v_ev.reconcile_flagged_at IS NULL THEN
                        v_flag := public._presence_flag('TRIP_MANUAL_RECONCILIATION', v_b.driver_id, 'Rule 9.5',
                            jsonb_build_object('booking_id', v_b.booking_id, 'event_id', v_ev.event_id,
                                'connectivity_interrupted_since', v_b.driver_unreachable_since,
                                'last_known_latitude', v_ev.last_fix_latitude, 'last_known_longitude', v_ev.last_fix_longitude,
                                'last_known_at', v_ev.last_fix_at,
                                'note', 'The driver has been unreachable for 30 minutes during a trip. Contact both parties and confirm the outcome and fare before closing the record.'));
                        UPDATE public.trip_connectivity_event SET reconcile_flagged_at = v_now, reconcile_flag_id = v_flag WHERE event_id = v_ev.event_id;
                        PERFORM public.record_policy_audit('TRIP_RECONCILIATION_REQUIRED', v_b.booking_id::TEXT, v_d.full_name, 'Dispatch',
                            'The trip has been without a location from the driver for 30 minutes (Rule 9.5): it is waiting for manual reconciliation by the TODA Administrator.', NULL,
                            jsonb_build_object('booking_id', v_b.booking_id, 'event_id', v_ev.event_id, 'flag_id', v_flag));
                        v_n := v_n + 1;
                    END IF;
                END IF;
                CONTINUE;                                   -- an unreachable driver is not judged on movement
            ELSIF v_b.driver_unreachable_since IS NOT NULL THEN
                UPDATE public.booking SET driver_unreachable_since = NULL WHERE booking_id = v_b.booking_id RETURNING * INTO v_b;   -- he is back
                UPDATE public.trip_connectivity_event SET restored_at = v_now
                 WHERE booking_id = v_b.booking_id AND restored_at IS NULL AND ended_reason IS NULL;
                GET DIAGNOSTICS v_rows = ROW_COUNT;
                IF v_rows > 0 THEN
                    PERFORM public.record_policy_audit('CONNECTIVITY_RESTORED', v_b.booking_id::TEXT, v_d.full_name, 'Dispatch',
                        'Location updates from the driver resumed (trip phase: ' || v_phase || ').', NULL,
                        jsonb_build_object('booking_id', v_b.booking_id, 'driver_id', v_b.driver_id, 'phase', v_phase));
                END IF;
            END IF;

            -- ---- Rule 8: movement toward the pickup (the approach phase only: Rule 8.5)
            CONTINUE WHEN v_phase <> 'assigned';
            v_fresh := v_d.current_latitude IS NOT NULL AND v_d.current_longitude IS NOT NULL
                       AND v_d.last_location_update >= v_now - make_interval(secs => public.driver_presence_constant('location_max_age_seconds'));
            CONTINUE WHEN NOT v_fresh;                      -- no usable fix right now: neither the warning nor the cancellation is based on a guess
            CONTINUE WHEN public._driver_within_pickup_zone(v_b.driver_id, v_b.booking_id);    -- already there: he only has to tap Arrived

            IF v_b.stall_anchor_at IS NULL THEN
                -- A booking accepted before this clock existed (a trip in flight when the migration was deployed): the driver is judged from
                -- NOW, not from an acceptance long ago, so a deploy can never cancel and strike anybody. The five-minute rule (8.4) applies
                -- from this moment; the 2 / 3 minute rule (8.2 / 8.3) is only for a booking whose acceptance this clock saw.
                UPDATE public.booking
                   SET stall_anchor_latitude = v_d.current_latitude, stall_anchor_longitude = v_d.current_longitude, stall_anchor_at = v_now
                 WHERE booking_id = v_b.booking_id RETURNING * INTO v_b;
            END IF;

            -- Movement = how far the driver is from where he last moved, less the error of BOTH fixes (decision D7-8: GPS noise is not a journey;
            -- a fix whose error circle overlaps the anchor's cannot show that the vehicle moved).
            v_moved := GREATEST(0, public.calculate_haversine_distance_km(v_b.stall_anchor_latitude, v_b.stall_anchor_longitude,
                                                                        v_d.current_latitude, v_d.current_longitude) * 1000.0
                                   - COALESCE(v_b.stall_anchor_accuracy_m, 0) - COALESCE(v_d.last_location_accuracy_m, 0));
            IF v_moved >= public.dispatch_constant('stall_min_movement_m') THEN
                UPDATE public.booking
                   SET stall_anchor_latitude = v_d.current_latitude, stall_anchor_longitude = v_d.current_longitude, stall_anchor_at = v_now,
                       stall_warned_at = NULL
                 WHERE booking_id = v_b.booking_id;
                CONTINUE;
            END IF;

            v_never := v_b.stall_anchor_at <= COALESCE(v_b.accepted_at, v_b.stall_anchor_at);        -- he has not moved at all since accepting
            IF v_never THEN
                v_idle := EXTRACT(EPOCH FROM (v_now - v_b.stall_anchor_at));
                IF v_idle >= public.dispatch_constant('stall_cancel_seconds') THEN                  -- Rule 8.3
                    PERFORM public._booking_timer_cancel(v_b.booking_id, v_b.driver_id, 'DRV_STALL', 'Rule 8.3',
                        'The driver did not start traveling toward the passenger within ' || public.dispatch_constant('stall_cancel_seconds') / 60 || ' minutes of accepting.',
                        'You did not start traveling toward the passenger, so the booking was cancelled and given to another driver. One strike was recorded. '
                        || 'If a road obstruction, a breakdown or a GPS fault stopped you, you may appeal through the Exemption & Appeal process.',
                        'Your driver was unable to proceed. We''re finding you another driver. '
                        || '(Hindi nakapagpatuloy ang iyong drayber. Naghahanap kami ng ibang drayber.)');
                    v_n := v_n + 1;
                ELSIF v_idle >= public.dispatch_constant('stall_warn_seconds') AND v_b.stall_warned_at IS NULL THEN   -- Rule 8.2
                    UPDATE public.booking SET stall_warned_at = v_now WHERE booking_id = v_b.booking_id;
                    PERFORM public._notify_subject('driver', v_b.driver_id, 'STALL_WARNING', 'Hindi ka pa gumagalaw (You have not started)',
                        'You have not started traveling toward the passenger. Please proceed or cancel the booking. '
                        || '(Hindi ka pa nagsisimulang pumunta sa pasahero. Pakisimulan o ikansela ang booking.)',
                        v_b.booking_id::TEXT, v_tag);
                    v_n := v_n + 1;
                END IF;
            ELSE
                -- Rule 8.4: he moved, then stood still. A reported delay (traffic, a road closure) restarts the five minutes.
                v_idle := EXTRACT(EPOCH FROM (v_now - GREATEST(v_b.stall_anchor_at, COALESCE(v_b.stall_delay_reported_at, v_b.stall_anchor_at))));
                IF v_idle >= public.dispatch_constant('stall_en_route_seconds') THEN
                    PERFORM public._booking_timer_cancel(v_b.booking_id, v_b.driver_id, 'DRV_STALL', 'Rule 8.4',
                        'The driver stopped on the way to the pickup for ' || public.dispatch_constant('stall_en_route_seconds') / 60 || ' minutes without reporting a reason.',
                        'You stopped on the way to the passenger for 5 minutes without reporting traffic or a road closure, so the booking was cancelled and given to another driver. '
                        || 'One strike was recorded. You may appeal through the Exemption & Appeal process.',
                        'Your driver was unable to proceed. We''re finding you another driver. '
                        || '(Hindi nakapagpatuloy ang iyong drayber. Naghahanap kami ng ibang drayber.)');
                    v_n := v_n + 1;
                ELSIF v_idle >= public.dispatch_constant('stall_en_route_warn_seconds') AND v_b.stall_warned_at IS NULL THEN   -- Rule 8.4 warning (decision D7-7)
                    UPDATE public.booking SET stall_warned_at = v_now WHERE booking_id = v_b.booking_id;
                    -- the Rule 8.2 text; its own key per delay report, so a restarted stand-still can be warned again
                    PERFORM public._notify_subject('driver', v_b.driver_id, 'STALL_WARNING', 'Hindi ka pa gumagalaw (You have not started)',
                        'You have not started traveling toward the passenger. Please proceed or cancel the booking. '
                        || '(Hindi ka pa nagsisimulang pumunta sa pasahero. Pakisimulan o ikansela ang booking.)',
                        v_b.booking_id::TEXT, 1000000 + v_tag * 10 + v_b.stall_delay_reports);
                    v_n := v_n + 1;
                END IF;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'booking timers: booking % could not be checked (%)', r.booking_id, SQLERRM;
        END;
    END LOOP;

    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN v_n;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. A REPORTED DELAY (Rule 8.4's "traffic / road closure" message): the reason is kept and audited (replaces 20261015000005)
-- ----------------------------------------------------------------------------
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
    IF p_reason IS NULL OR p_reason NOT IN ('traffic', 'road_closure') THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_DELAY_REASON', 'error', 'Choose traffic or a road closure.');
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
        'The driver reported ' || CASE p_reason WHEN 'traffic' THEN 'heavy traffic' ELSE 'a road closure' END
        || ' while on the way to the pickup (report ' || (v_b.stall_delay_reports + 1) || ' of 2, Rule 8.4).', NULL,
        jsonb_build_object('booking_id', p_booking_id, 'driver_id', v_driver, 'reason', p_reason, 'report_number', v_b.stall_delay_reports + 1));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'reports', v_b.stall_delay_reports + 1, 'reports_left', 1 - v_b.stall_delay_reports, 'reason', p_reason);
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. WHAT THE SCREENS READ, AND THE DRIVER'S RE-CONFIRMATION (Rule 9.5)
-- ----------------------------------------------------------------------------
-- The passenger's map: the driver's position and its age by the SERVER's clock (Rule 17.9: the phone's clock and the time a broadcast arrived
-- say nothing about when the position was taken). The position is shared only while the trip is live, as get_assigned_driver_details does.
CREATE OR REPLACE FUNCTION public.get_driver_live_status(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_b public.booking;
    v_d public.driver;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_pax UUID := public.get_current_passenger_id();
    v_live BOOLEAN;
BEGIN
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id;
    IF NOT FOUND OR NOT ((v_pax IS NOT NULL AND v_b.passenger_id = v_pax)
                         OR COALESCE(public.is_lgu_admin(), FALSE) OR public.rls_booking_in_my_toda(p_booking_id)) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_YOUR_BOOKING', 'error', 'This booking is not yours.');
    END IF;
    IF v_b.driver_id IS NULL THEN
        RETURN jsonb_build_object('success', TRUE, 'driver_assigned', FALSE, 'booking_status', v_b.booking_status, 'server_time', v_now);
    END IF;
    SELECT * INTO v_d FROM public.driver WHERE driver_id = v_b.driver_id;
    v_live := public._booking_is_open_accepted(v_b.booking_status::TEXT);
    RETURN jsonb_build_object(
        'success', TRUE, 'driver_assigned', TRUE, 'live', v_live, 'booking_status', v_b.booking_status,
        'latitude', CASE WHEN v_live THEN v_d.current_latitude END,
        'longitude', CASE WHEN v_live THEN v_d.current_longitude END,
        'last_fix_at', CASE WHEN v_live THEN v_d.last_location_update END,
        'age_seconds', CASE WHEN v_live AND v_d.last_location_update IS NOT NULL
                            THEN GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - v_d.last_location_update))))::INTEGER END,
        'unreachable_since', v_b.driver_unreachable_since,
        'interrupted', v_b.driver_unreachable_since IS NOT NULL AND public._booking_phase(v_b.booking_status) = 'ongoing',
        'server_time', v_now);
END;
$$;

-- The driver's screen: does this trip need his re-confirmation (a silence during the trip that he has not yet answered)?
CREATE OR REPLACE FUNCTION public.get_my_trip_connectivity(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_driver UUID := public.get_current_driver_id();
    v_b public.booking;
    v_ev public.trip_connectivity_event;
BEGIN
    IF v_driver IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_A_DRIVER', 'error', 'Only a driver can ask this.');
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id;
    IF NOT FOUND OR v_b.driver_id IS DISTINCT FROM v_driver THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_YOUR_BOOKING', 'error', 'This booking is not assigned to you.');
    END IF;
    SELECT * INTO v_ev FROM public.trip_connectivity_event
     WHERE booking_id = p_booking_id AND phase = 'ongoing' AND reconfirmed_at IS NULL AND ended_reason IS NULL
     ORDER BY started_at DESC LIMIT 1;
    RETURN jsonb_build_object('success', TRUE,
        'needs_reconfirm', FOUND,
        'interrupted_since', v_ev.started_at,
        'connected', FOUND AND (v_ev.restored_at IS NOT NULL OR public.driver_has_fresh_location(v_driver)),
        'server_time', clock_timestamp());
END;
$$;

-- Rule 9.5: after a silence during the trip the driver states whether the trip is still going on or has ended. Until he does, nobody can move
-- the trip to fare finalisation (booking_status_guard). He must be connected again (a fresh position) to answer.
CREATE OR REPLACE FUNCTION public.driver_reconfirm_trip(p_booking_id UUID, p_status TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_driver UUID := public.get_current_driver_id();
    v_b public.booking;
    v_ev public.trip_connectivity_event;
    v_prev TEXT := current_setting('sakay.internal_context', true);
BEGIN
    IF v_driver IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_A_DRIVER', 'error', 'Only the driver can re-confirm the trip.');
    END IF;
    IF p_status IS NULL OR p_status NOT IN ('ongoing', 'ended') THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_RECONFIRM_STATUS', 'error', 'Say whether the trip is still going on or has ended.');
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_b.driver_id IS DISTINCT FROM v_driver THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_YOUR_BOOKING', 'error', 'This booking is not assigned to you.');
    END IF;
    IF public._booking_phase(v_b.booking_status) <> 'ongoing' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_ONGOING', 'error', 'Only a trip that is in progress needs to be re-confirmed.');
    END IF;
    SELECT * INTO v_ev FROM public.trip_connectivity_event
     WHERE booking_id = p_booking_id AND phase = 'ongoing' AND reconfirmed_at IS NULL AND ended_reason IS NULL
     ORDER BY started_at DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', TRUE, 'nothing_to_confirm', TRUE, 'booking_id', p_booking_id);      -- a double tap, or nothing was interrupted
    END IF;
    IF v_ev.restored_at IS NULL AND NOT public.driver_has_fresh_location(v_driver) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_STILL_NO_GPS',
            'error', 'We have not received your location yet. Wait a few seconds with Location on, then try again.');
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.trip_connectivity_event
       SET reconfirmed_at = clock_timestamp(), reconfirmed_as = p_status, restored_at = COALESCE(restored_at, clock_timestamp())
     WHERE event_id = v_ev.event_id;
    PERFORM public.record_policy_audit('TRIP_RECONFIRMED', p_booking_id::TEXT, NULL, 'Dispatch',
        'After a connection loss of the driver during the trip, the driver re-confirmed that the trip is '
        || CASE p_status WHEN 'ongoing' THEN 'still going on' ELSE 'over' END || ' (Rule 9.5).', NULL,
        jsonb_build_object('booking_id', p_booking_id, 'driver_id', v_driver, 'event_id', v_ev.event_id, 'status', p_status,
                           'interrupted_since', v_ev.started_at));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'booking_id', p_booking_id, 'status', p_status);
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. THE STATUS GUARD (replaces 20261019000001): an interrupted trip cannot proceed to fare finalisation until the driver re-confirms it
-- ----------------------------------------------------------------------------
-- The one addition is the first check inside the "people on the booking" block (decision D7-2): from Ongoing to Arrived at Destination, by the
-- driver or by the passenger, is refused while a silence of this trip has not been re-confirmed. The service role, the system and the LGU
-- administrator are unchanged (the TODA Administrator closes such a trip through admin_reconcile_trip()).
CREATE OR REPLACE FUNCTION public.booking_status_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_old TEXT := public._booking_phase(OLD.booking_status);
    v_new TEXT := public._booking_phase(NEW.booking_status);
    v_trusted BOOLEAN := public.is_trusted_session();
    v_now TIMESTAMPTZ := clock_timestamp();
    v_is_driver BOOLEAN;
    v_is_pax BOOLEAN;
    v_is_lgu BOOLEAN;
    v_allowed BOOLEAN := FALSE;
    v_timeout INTEGER := public.dispatch_constant('completion_confirm_timeout_seconds');
BEGIN
    IF NEW.booking_status IS NOT DISTINCT FROM OLD.booking_status THEN
        RETURN NEW;
    END IF;

    v_is_driver := OLD.driver_id IS NOT NULL AND OLD.driver_id = public.get_current_driver_id();
    v_is_pax := OLD.passenger_id IS NOT NULL AND OLD.passenger_id = public.get_current_passenger_id();
    v_is_lgu := COALESCE(public.is_lgu_admin(), FALSE);

    IF NOT v_trusted AND NOT v_is_lgu THEN
        IF v_new IS NULL THEN
            RAISE EXCEPTION 'ERR_UNKNOWN_BOOKING_STATUS: "%" is not a booking status.', NEW.booking_status USING ERRCODE = 'P0001';
        END IF;

        -- Rule 9.5: the connection was lost during this trip; the driver must say what became of it before it can be finished.
        IF v_old = 'ongoing' AND NEW.booking_status = 'Arrived at Destination'
           AND EXISTS (SELECT 1 FROM public.trip_connectivity_event e
                        WHERE e.booking_id = OLD.booking_id AND e.phase = 'ongoing' AND e.reconfirmed_at IS NULL AND e.ended_reason IS NULL) THEN
            RAISE EXCEPTION 'ERR_RECONFIRM_TRIP: Nawalan ng koneksyon ang biyaheng ito. Kumpirmahin muna ng drayber ang kalagayan ng biyahe bago ito matapos. (The connection was lost during this trip: the driver must re-confirm the trip status before it can be finished.)' USING ERRCODE = 'P0001';
        END IF;

        IF v_is_driver THEN
            IF NEW.booking_status = 'Cancelled' THEN
                RAISE EXCEPTION 'ERR_USE_DRIVER_CANCEL: Gamitin ang Cancel Booking button (a driver cancels through driver_cancel_booking(), which records the reason and finds another driver).' USING ERRCODE = 'P0001';
            END IF;
            v_allowed := (v_old = 'assigned' AND NEW.booking_status = 'In Transit')
                      OR (v_old IN ('assigned', 'arrived') AND v_new = 'arrived')
                      OR (v_old = 'arrived' AND v_new = 'ongoing')
                      OR (v_old = 'ongoing' AND NEW.booking_status = 'Arrived at Destination');
            IF NOT v_allowed AND v_old = 'at_destination' AND NEW.booking_status = 'Completed' THEN
                IF OLD.fare_locked_at IS NOT NULL AND v_now >= OLD.fare_locked_at + make_interval(secs => v_timeout) THEN
                    v_allowed := TRUE;                         -- Rule 16.6: the passenger did not confirm within the confirmation time
                ELSE
                    RAISE EXCEPTION 'ERR_WAIT_FOR_PASSENGER: Hintayin muna ang kumpirmasyon ng pasahero. (Wait for the passenger to confirm the fare; you can end the trip % seconds after arrival if they do not.)', v_timeout USING ERRCODE = 'P0001';
                END IF;
            END IF;
        ELSIF v_is_pax THEN
            IF NEW.booking_status = 'Cancelled' AND v_old = 'ongoing' THEN
                RAISE EXCEPTION 'ERR_TRIP_IN_PROGRESS: Hindi maaaring ikansela ang biyaheng nagpapatuloy. (A trip in progress cannot be cancelled.)' USING ERRCODE = 'P0001';
            END IF;
            -- A passenger may also say "we have arrived" (Slide to Finish Trip) when the driver has not: the fare lock then runs exactly as
            -- if the driver had, and a track that stops short of the destination cannot lower the fare (booking_fare_update_guard).
            v_allowed := (NEW.booking_status = 'Cancelled' AND v_old IN ('searching', 'assigned', 'arrived', 'no_driver'))
                      OR (v_old = 'ongoing' AND NEW.booking_status = 'Arrived at Destination')
                      OR (v_old = 'at_destination' AND NEW.booking_status = 'Completed');
        END IF;

        IF NOT v_allowed THEN
            RAISE EXCEPTION 'ERR_BOOKING_TRANSITION: A booking cannot go from "%" to "%".', OLD.booking_status, NEW.booking_status USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- A phone cannot write a moment this transition does not own (the passenger's "arrived" call used to carry its own arrived_at).
    IF NOT v_trusted THEN
        IF NOT (v_new = 'assigned' AND v_old = 'searching') THEN NEW.accepted_at := OLD.accepted_at; END IF;
        IF v_new IS DISTINCT FROM 'arrived' THEN NEW.arrived_at := OLD.arrived_at; END IF;
        IF v_new IS DISTINCT FROM 'ongoing' THEN NEW.trip_started_at := OLD.trip_started_at; END IF;
        IF v_new IS DISTINCT FROM 'completed' THEN NEW.trip_completed_at := OLD.trip_completed_at; END IF;
        IF v_new IS DISTINCT FROM 'cancelled' THEN NEW.cancelled_at := OLD.cancelled_at; NEW.cancelled_by := OLD.cancelled_by; END IF;
    END IF;

    -- The server's clock for every moment of the trip (trusted callers may supply their own, a phone may not).
    IF v_new = 'assigned' AND v_old = 'searching' THEN
        NEW.accepted_at := COALESCE(CASE WHEN v_trusted THEN NEW.accepted_at END, v_now);
    ELSIF v_new = 'arrived' THEN
        NEW.arrived_at := COALESCE(OLD.arrived_at, CASE WHEN v_trusted THEN NEW.arrived_at END, v_now);
    ELSIF v_new = 'ongoing' THEN
        NEW.trip_started_at := COALESCE(OLD.trip_started_at, CASE WHEN v_trusted THEN NEW.trip_started_at END, v_now);
    ELSIF v_new = 'completed' THEN
        NEW.trip_completed_at := COALESCE(CASE WHEN v_trusted THEN NEW.trip_completed_at END, v_now);
    ELSIF v_new = 'cancelled' THEN
        NEW.cancelled_at := COALESCE(CASE WHEN v_trusted THEN NEW.cancelled_at END, v_now);
        NEW.cancelled_by := CASE
            WHEN v_is_pax THEN 'passenger'
            WHEN v_is_driver THEN 'driver'
            WHEN v_is_lgu AND NOT v_trusted THEN 'lgu_admin'
            ELSE COALESCE(NEW.cancelled_by, 'system') END;
    END IF;
    RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. A PASSENGER WHO CANCELS WHILE THE DRIVER IS UNREACHABLE IS NOT STRUCK (decision D7-6; replaces 20261019000001)
-- ----------------------------------------------------------------------------
-- The only change: the late-cancellation strike (Rule 12.2) is not issued while the booking carries the Driver Unreachable mark (Rule 9.2).
-- The cancellation still counts toward the Rule 12.9 review flag, which is a review and not a penalty.
CREATE OR REPLACE FUNCTION public.strike_on_passenger_cancellation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_grace INTEGER := public.dispatch_constant('passenger_cancel_grace_seconds');
    v_in_grace BOOLEAN;
    v_window INTERVAL := make_interval(hours => public.dispatch_constant('repeat_cancel_window_hours'));
    v_last_done TIMESTAMPTZ;
    v_recent INTEGER;
BEGIN
    IF NEW.cancelled_by IS DISTINCT FROM 'passenger' OR NEW.passenger_id IS NULL OR OLD.booking_status = 'No Driver Found' THEN
        RETURN NEW;
    END IF;
    PERFORM set_config('sakay.internal_context', 'true', true);

    IF public._booking_is_open_accepted(OLD.booking_status) THEN
        v_in_grace := OLD.accepted_at IS NOT NULL
                  AND public._booking_phase(OLD.booking_status) = 'assigned'
                  AND clock_timestamp() <= OLD.accepted_at + make_interval(secs => v_grace);
        IF OLD.driver_unreachable_since IS NOT NULL THEN
            -- Rule 9.2 / decision D7-6: the passenger is leaving a driver who cannot be reached; that is not a late cancellation
            PERFORM public.record_policy_audit('PASSENGER_CANCEL_NO_STRIKE_DRIVER_UNREACHABLE', NEW.booking_id::TEXT, NULL, 'Dispatch',
                'The passenger cancelled while the driver was unreachable; no late-cancellation strike was issued.', NULL,
                jsonb_build_object('booking_id', NEW.booking_id, 'passenger_id', NEW.passenger_id, 'driver_unreachable_since', OLD.driver_unreachable_since));
        ELSIF NOT v_in_grace THEN
            PERFORM public.issue_strike('passenger', NEW.passenger_id, 'PAX_LATE_CANCEL', NULL, NEW.booking_id, NULL,
                'PAX_LATE_CANCEL:' || NEW.booking_id::TEXT, NULL,
                COALESCE(NEW.cancellation_reason, 'Cancelled after the driver accepted'), NULL, NULL);
        END IF;
    END IF;

    SELECT max(b.trip_completed_at) INTO v_last_done FROM public.booking b
     WHERE b.passenger_id = NEW.passenger_id AND b.booking_status = 'Completed';
    SELECT count(*) INTO v_recent FROM public.booking b
     WHERE b.passenger_id = NEW.passenger_id AND b.booking_status = 'Cancelled' AND b.cancelled_by = 'passenger'
       AND b.dispatch_ended_reason IS DISTINCT FROM 'no_driver_found'
       AND b.dispatch_ended_reason IS DISTINCT FROM 'accepted_drivers_cancelled'
       AND b.cancelled_at > GREATEST(clock_timestamp() - v_window, COALESCE(v_last_done, '-infinity'::TIMESTAMPTZ));
    IF v_recent >= public.dispatch_constant('repeat_cancel_flag_count') THEN
        PERFORM public.create_admin_review_flag('PASSENGER_BOOKING_ABUSE_REVIEW', 'passenger', NEW.passenger_id::TEXT, 'Rules 12.7 / 12.9',
            'lgu_admin', jsonb_build_object('cancelled_bookings_in_window', v_recent,
                'window_hours', public.dispatch_constant('repeat_cancel_window_hours'),
                'note', 'Review flag only. The passenger may be restricted only after the administrator reviews it (Rule 12.9).'));
    END IF;

    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. MANUAL RECONCILIATION BY THE TODA ADMINISTRATOR (Rule 9.5)
-- ----------------------------------------------------------------------------
-- The trips waiting for it: the silence lasted 30 minutes, the trip is still open, nobody has reconciled it. The TODA Administrator sees the
-- trips of the TODA's own drivers (both phone numbers, to contact them by phone or SMS), the LGU Administrator sees them all.
CREATE OR REPLACE FUNCTION public.get_trips_needing_reconciliation()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_lgu BOOLEAN := COALESCE(public.is_lgu_admin(), FALSE);
    v_toda UUID := public.get_current_toda_admin_toda_id();
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF NOT v_lgu AND v_toda IS NULL THEN
        RAISE EXCEPTION 'Access Denied: Only a TODA or LGU administrator can see the trips that need reconciliation.';
    END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                   'event_id', e.event_id, 'booking_id', b.booking_id, 'booking_status', b.booking_status,
                   'driver_id', d.driver_id, 'driver_name', d.full_name, 'driver_phone', d.contact_number,
                   'plate_number', d.plate_number, 'toda_name', t.toda_name,
                   'passenger_id', p.passenger_id, 'passenger_name', p.full_name, 'passenger_phone', p.contact_number,
                   'pickup_address', b.pickup_address, 'dropoff_address', b.dropoff_address,
                   'estimated_fare', b.estimated_fare, 'trip_started_at', b.trip_started_at,
                   'interrupted_since', e.started_at, 'flagged_at', e.reconcile_flagged_at,
                   'last_fix_latitude', e.last_fix_latitude, 'last_fix_longitude', e.last_fix_longitude, 'last_fix_at', e.last_fix_at,
                   'restored_at', e.restored_at, 'reconfirmed_at', e.reconfirmed_at,
                   'silent_minutes', CASE WHEN e.restored_at IS NULL THEN floor(EXTRACT(EPOCH FROM (v_now - COALESCE(e.last_fix_at, e.started_at))) / 60)::INTEGER END)
               ORDER BY e.reconcile_flagged_at)
          FROM public.trip_connectivity_event e
          JOIN public.booking b ON b.booking_id = e.booking_id
          JOIN public.driver d ON d.driver_id = e.driver_id
          LEFT JOIN public.passenger p ON p.passenger_id = b.passenger_id
          LEFT JOIN public.toda t ON t.toda_id = d.toda_id
         WHERE e.phase = 'ongoing' AND e.reconcile_flagged_at IS NOT NULL AND e.reconciled_at IS NULL
           AND public._booking_phase(b.booking_status) = 'ongoing'
           AND (v_lgu OR d.toda_id = v_toda OR b.toda_id = v_toda)), '[]'::JSONB);
END;
$$;

-- Closes a trip that stayed silent for 30 minutes, after the administrator has phoned or texted the parties (Rule 9.5):
--   outcome 'completed'  the trip is Completed; the fare is the system's (locked by the fare guard) unless the administrator records a LOWER agreed
--                        amount with the reason (never higher, never below the base fare of the booking's own tariff); the change is also written
--                        to fare_adjustment_history (ADMIN_CORRECTION)
--   outcome 'cancelled'  the trip is Cancelled by the administrator; no fare
-- Everything is audited (who, what, before / after, why). The flag is resolved. Both parties are told.
CREATE OR REPLACE FUNCTION public.admin_reconcile_trip(
    p_booking_id UUID,
    p_outcome TEXT,
    p_fare NUMERIC,
    p_reason TEXT,
    p_contacted_driver BOOLEAN,
    p_contacted_passenger BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_lgu BOOLEAN := COALESCE(public.is_lgu_admin(), FALSE);
    v_toda_ok BOOLEAN := COALESCE(public.is_toda_admin(), FALSE) AND public.rls_booking_in_my_toda(p_booking_id);
    v_b public.booking;
    v_b2 public.booking;
    v_ev public.trip_connectivity_event;
    v_flag public.admin_review_flag;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_default NUMERIC;
    v_final NUMERIC;
    v_floor NUMERIC;
    v_actor_role TEXT := CASE WHEN COALESCE(public.is_lgu_admin(), FALSE) THEN 'lgu_admin' ELSE 'toda_admin' END;
BEGIN
    IF NOT (v_lgu OR v_toda_ok) THEN
        RAISE EXCEPTION 'Access Denied: Only the TODA Administrator of this driver, or the LGU Administrator, can reconcile this trip.';
    END IF;
    IF p_outcome IS NULL OR p_outcome NOT IN ('completed', 'cancelled') THEN
        RAISE EXCEPTION 'ERR_RECONCILE_OUTCOME: The outcome must be completed or cancelled.';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
        RAISE EXCEPTION 'ERR_RECONCILE_REASON: Write down how the outcome and the fare were confirmed (who was reached, and what they said).';
    END IF;
    IF NOT (COALESCE(p_contacted_driver, FALSE) OR COALESCE(p_contacted_passenger, FALSE)) THEN
        RAISE EXCEPTION 'ERR_RECONCILE_CONTACT: Contact at least one of the two parties by phone or SMS before closing the trip (Rule 9.5).';
    END IF;

    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND OR public._booking_phase(v_b.booking_status) <> 'ongoing' THEN
        RAISE EXCEPTION 'ERR_RECONCILE_NOT_ONGOING: This trip is no longer in progress.';
    END IF;
    SELECT * INTO v_ev FROM public.trip_connectivity_event
     WHERE booking_id = p_booking_id AND phase = 'ongoing' AND reconcile_flagged_at IS NOT NULL AND reconciled_at IS NULL
     ORDER BY started_at DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_RECONCILE_NOT_FLAGGED: This trip has not been waiting for manual reconciliation (the silence did not last 30 minutes).';
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    IF p_outcome = 'completed' THEN
        -- the fare guard computes and locks the system's final fare as the trip is completed
        UPDATE public.booking SET booking_status = 'Completed' WHERE booking_id = p_booking_id RETURNING * INTO v_b2;
        v_default := COALESCE(v_b2.actual_fare, v_b2.estimated_fare);
        v_final := v_default;
        IF p_fare IS NOT NULL THEN
            v_floor := COALESCE((v_b2.fare_breakdown #>> '{rule,base_fare}')::NUMERIC, 0);
            IF p_fare > v_default THEN
                RAISE EXCEPTION 'ERR_RECONCILE_FARE_HIGHER: The agreed fare cannot be higher than the system''s fare (%).', v_default;
            ELSIF p_fare < v_floor THEN
                RAISE EXCEPTION 'ERR_RECONCILE_FARE_BELOW_BASE: The agreed fare cannot be lower than the base fare of the tariff (%).', v_floor;
            ELSIF p_fare < v_default THEN
                UPDATE public.booking SET actual_fare = p_fare WHERE booking_id = p_booking_id RETURNING * INTO v_b2;
                INSERT INTO public.fare_adjustment_history (booking_id, reason_code, previous_fare, new_fare, details, actor_id, actor_role)
                VALUES (p_booking_id, 'ADMIN_CORRECTION', v_default, p_fare,
                        jsonb_build_object('rule', '9.5', 'event_id', v_ev.event_id, 'reason', p_reason), auth.uid(), v_actor_role);
                v_final := p_fare;
            END IF;
        END IF;
    ELSE
        UPDATE public.booking
           SET booking_status = 'Cancelled', cancelled_by = v_actor_role,
               cancellation_reason = 'The trip was closed by an administrator after manual reconciliation (Isinara ng administrator ang biyahe matapos ang manu-manong pagsusuri).'
         WHERE booking_id = p_booking_id RETURNING * INTO v_b2;
        v_final := NULL;
    END IF;

    UPDATE public.trip_connectivity_event
       SET reconciled_at = clock_timestamp(), reconciled_by = auth.uid(), reconcile_outcome = p_outcome, reconcile_fare = v_final,
           reconcile_note = btrim(p_reason), contacted_driver = COALESCE(p_contacted_driver, FALSE),
           contacted_passenger = COALESCE(p_contacted_passenger, FALSE), ended_reason = 'reconciled'
     WHERE event_id = v_ev.event_id;

    -- the review flag of this trip (the flag is per driver: only the one that names this booking is resolved)
    IF v_ev.reconcile_flag_id IS NOT NULL THEN
        SELECT * INTO v_flag FROM public.admin_review_flag
         WHERE flag_id = v_ev.reconcile_flag_id AND status IN ('Open', 'Under Review') AND details ->> 'booking_id' = p_booking_id::TEXT;
        IF FOUND THEN
            PERFORM public.resolve_admin_review_flag(v_flag.flag_id, 'Resolved',
                'Reconciled: ' || p_outcome || COALESCE(' (fare ' || v_final || ')', '') || '. ' || btrim(p_reason));
        END IF;
    END IF;

    PERFORM public.record_policy_audit('TRIP_RECONCILED', p_booking_id::TEXT, NULL, 'Trip Reconciliation',
        'The trip was reconciled manually after the driver was silent for 30 minutes (Rule 9.5): ' || p_outcome
        || COALESCE(', fare ' || v_final, '') || '. ' || btrim(p_reason),
        jsonb_build_object('booking_status', v_b.booking_status, 'actual_fare', v_b.actual_fare, 'estimated_fare', v_b.estimated_fare),
        jsonb_build_object('booking_status', v_b2.booking_status, 'actual_fare', v_b2.actual_fare, 'system_fare', v_default, 'recorded_fare', v_final,
                           'outcome', p_outcome, 'contacted_driver', COALESCE(p_contacted_driver, FALSE),
                           'contacted_passenger', COALESCE(p_contacted_passenger, FALSE), 'event_id', v_ev.event_id));

    PERFORM public._dispatch_notify_passenger(v_b2, 'TRIP_RECONCILED',
        'Natapos ang biyahe pagkatapos ng pagsusuri (Trip closed after review)',
        CASE WHEN p_outcome = 'completed'
             THEN 'An administrator contacted you and your driver and closed the trip as completed' || COALESCE(', with a fare of PHP ' || v_final, '') || '. '
                  || '(Kinontak ng administrator ang inyong dalawa ng drayber at isinara ang biyahe bilang tapos.)'
             ELSE 'An administrator contacted you and your driver and closed the trip without a fare. '
                  || '(Kinontak ng administrator ang inyong dalawa ng drayber at isinara ang biyahe nang walang pamasahe.)' END);
    PERFORM public._notify_subject('driver', v_b.driver_id, 'TRIP_RECONCILED',
        'Natapos ang biyahe pagkatapos ng pagsusuri (Trip closed after review)',
        'Your TODA Administrator closed this trip as ' || p_outcome || COALESCE(' (fare PHP ' || v_final || ')', '') || ' after contacting you or the passenger. '
        || '(Isinara ng administrator ang biyahe.)', p_booking_id::TEXT, 7);
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);

    RETURN jsonb_build_object('success', TRUE, 'booking_id', p_booking_id, 'outcome', p_outcome, 'system_fare', v_default, 'recorded_fare', v_final);
END;
$$;

-- ----------------------------------------------------------------------------
-- 11. RULE 9.6: DELIBERATE MID-TRIP OFFLINE, REPORTED BY THE TODA ADMINISTRATOR, CONFIRMED BY THE LGU ADMINISTRATOR
-- ----------------------------------------------------------------------------
-- The report names its evidence (a pattern of interruptions found on review, a passenger's report, or the driver's own admission) and carries
-- the driver's recent interruptions as the pattern. It raises ONE review flag for the LGU Administrator. No strike yet.
CREATE OR REPLACE FUNCTION public.report_deliberate_offline(p_driver_id UUID, p_booking_id UUID, p_evidence TEXT, p_note TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_lgu BOOLEAN := COALESCE(public.is_lgu_admin(), FALSE);
    v_toda_ok BOOLEAN := COALESCE(public.is_toda_admin(), FALSE) AND public.is_toda_admin_for_driver(p_driver_id);
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_flag UUID;
    v_pattern JSONB;
    v_count INTEGER;
BEGIN
    IF NOT (v_lgu OR v_toda_ok) THEN
        RAISE EXCEPTION 'Access Denied: Only the TODA Administrator of this driver, or the LGU Administrator, can report a deliberate offline.';
    END IF;
    IF p_evidence IS NULL OR p_evidence NOT IN ('pattern_review', 'passenger_report', 'admission') THEN
        RAISE EXCEPTION 'ERR_EVIDENCE: The evidence must be a pattern review, a passenger report or the driver''s admission (Rule 9.6).';
    END IF;
    IF p_note IS NULL OR length(btrim(p_note)) = 0 THEN
        RAISE EXCEPTION 'ERR_EVIDENCE_NOTE: Describe the evidence.';
    END IF;
    IF p_booking_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.booking b WHERE b.booking_id = p_booking_id AND b.driver_id = p_driver_id) THEN
        RAISE EXCEPTION 'ERR_NOT_THE_DRIVERS_BOOKING: That booking is not this driver''s.';
    END IF;

    SELECT count(*), COALESCE(jsonb_agg(jsonb_build_object('event_id', x.event_id, 'booking_id', x.booking_id, 'phase', x.phase,
                                                           'started_at', x.started_at, 'restored_at', x.restored_at) ORDER BY x.started_at DESC), '[]'::JSONB)
      INTO v_count, v_pattern
      FROM (SELECT * FROM public.trip_connectivity_event e
             WHERE e.driver_id = p_driver_id AND e.started_at > clock_timestamp() - interval '30 days'
             ORDER BY e.started_at DESC LIMIT 20) x;

    PERFORM set_config('sakay.internal_context', 'true', true);
    v_flag := public.create_admin_review_flag('DRIVER_DELIBERATE_OFFLINE_REPORT', 'driver', p_driver_id::TEXT, 'Rule 9.6', 'lgu_admin',
        jsonb_build_object('booking_id', p_booking_id, 'evidence', p_evidence, 'note', btrim(p_note),
                           'reported_by_role', CASE WHEN v_lgu THEN 'lgu_admin' ELSE 'toda_admin' END,
                           'interruptions_last_30_days', v_count, 'interruptions', v_pattern));
    PERFORM public.record_policy_audit('DELIBERATE_OFFLINE_REPORTED', p_driver_id::TEXT, NULL, 'Strikes & Suspensions',
        'A deliberate mid-trip offline was reported (Rule 9.6), evidence: ' || p_evidence || '. ' || btrim(p_note), NULL,
        jsonb_build_object('flag_id', v_flag, 'booking_id', p_booking_id, 'evidence', p_evidence, 'interruptions_last_30_days', v_count));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'flag_id', v_flag, 'interruptions_last_30_days', v_count);
END;
$$;

-- The LGU Administrator confirms the report: 2 strikes (DRV_DELIBERATE_OFFLINE; Rule 9.4 does not apply: the violation is not exemption-eligible)
-- and the flag is resolved. A report that the LGU does not confirm is dismissed with resolve_admin_review_flag (the existing mechanism).
CREATE OR REPLACE FUNCTION public.confirm_deliberate_offline(p_flag_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_flag public.admin_review_flag;
    v_booking UUID;
    v_strike JSONB;
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RAISE EXCEPTION 'Access Denied: Only the LGU Administrator can confirm a deliberate offline (Rule 9.6).';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
        RAISE EXCEPTION 'ERR_CONFIRM_REASON: A confirmation reason is required.';
    END IF;
    SELECT * INTO v_flag FROM public.admin_review_flag WHERE flag_id = p_flag_id FOR UPDATE;
    IF NOT FOUND OR v_flag.flag_type <> 'DRIVER_DELIBERATE_OFFLINE_REPORT' OR v_flag.subject_type <> 'driver' THEN
        RAISE EXCEPTION 'ERR_NOT_A_DELIBERATE_OFFLINE_REPORT: This is not a deliberate-offline report.';
    END IF;
    IF v_flag.status NOT IN ('Open', 'Under Review') THEN
        RETURN jsonb_build_object('success', TRUE, 'already_decided', TRUE, 'status', v_flag.status);      -- a double tap
    END IF;
    v_booking := NULLIF(v_flag.details ->> 'booking_id', '')::UUID;

    -- issued as the LGU Administrator (not as the system): the ledger records who confirmed it
    v_strike := public.issue_strike('driver', v_flag.subject_id::UUID, 'DRV_DELIBERATE_OFFLINE', NULL, v_booking, NULL,
        'DRV_DELIBERATE_OFFLINE:' || p_flag_id::TEXT, NULL, btrim(p_reason), NULL,
        jsonb_build_object('rule', '9.6', 'flag_id', p_flag_id, 'evidence', v_flag.details ->> 'evidence'));
    PERFORM public.resolve_admin_review_flag(p_flag_id, 'Resolved', 'Confirmed: 2 strikes (Rule 9.6). ' || btrim(p_reason));
    RETURN jsonb_build_object('success', TRUE, 'flag_id', p_flag_id, 'strike', v_strike);
END;
$$;

-- ----------------------------------------------------------------------------
-- 12. RULE 17.5: REPEATED GPS-CAUSED DETERMINATIONS IN ONE AREA
-- ----------------------------------------------------------------------------
-- A "determination" is a stall or silence cancellation of a booking (strikes of DRV_STALL / DRV_CONNECTIVITY_FAILURE, waived ones included:
-- a waiver after review is exactly a determination that GPS got wrong) or a silence during a trip (trip_connectivity_event). They are grouped
-- into squares of gps_area_cell_millidegrees and counted per booking. Not callable by clients.
CREATE OR REPLACE FUNCTION public._gps_area_cells(p_days INTEGER, p_toda_id UUID DEFAULT NULL)
RETURNS TABLE (cell_i BIGINT, cell_j BIGINT, determinations INTEGER, stalls INTEGER, connectivity INTEGER, first_at TIMESTAMPTZ, last_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    WITH step AS (SELECT public.dispatch_constant('gps_area_cell_millidegrees') / 1000.0 AS s),
    pts AS (
        SELECT 'stall'::TEXT AS kind, s.booking_id, b.pickup_latitude AS lat, b.pickup_longitude AS lng, s.issued_at AS at_time
          FROM public.strikes_ledger s
          JOIN public.booking b ON b.booking_id = s.booking_id
          JOIN public.driver d ON d.driver_id = s.subject_id
         WHERE s.subject_type = 'driver' AND s.violation_code IN ('DRV_STALL', 'DRV_CONNECTIVITY_FAILURE') AND s.status <> 'VOIDED'
           AND s.issued_at > clock_timestamp() - make_interval(days => p_days)
           AND (p_toda_id IS NULL OR d.toda_id = p_toda_id)
        UNION ALL
        SELECT 'connectivity', e.booking_id, e.last_fix_latitude, e.last_fix_longitude, e.started_at
          FROM public.trip_connectivity_event e
          JOIN public.driver d ON d.driver_id = e.driver_id
         WHERE e.started_at > clock_timestamp() - make_interval(days => p_days)
           AND e.last_fix_latitude IS NOT NULL AND e.last_fix_longitude IS NOT NULL
           AND (p_toda_id IS NULL OR d.toda_id = p_toda_id)
    )
    SELECT floor(p.lat / st.s)::BIGINT, floor(p.lng / st.s)::BIGINT,
           count(DISTINCT p.booking_id)::INTEGER,
           count(DISTINCT p.booking_id) FILTER (WHERE p.kind = 'stall')::INTEGER,
           count(DISTINCT p.booking_id) FILTER (WHERE p.kind = 'connectivity')::INTEGER,
           min(p.at_time), max(p.at_time)
      FROM pts p CROSS JOIN step st
     WHERE p.lat IS NOT NULL AND p.lng IS NOT NULL
     GROUP BY 1, 2;
$$;

-- The squares that reached the reporting count in the window, for the administrator's own TODA (all of them for the LGU Administrator).
CREATE OR REPLACE FUNCTION public.get_gps_determination_hotspots(p_days INTEGER DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_lgu BOOLEAN := COALESCE(public.is_lgu_admin(), FALSE);
    v_toda UUID := public.get_current_toda_admin_toda_id();
    v_days INTEGER := LEAST(GREATEST(COALESCE(p_days, public.dispatch_constant('gps_area_window_days')), 1), 365);
    v_step NUMERIC := public.dispatch_constant('gps_area_cell_millidegrees') / 1000.0;
BEGIN
    IF NOT v_lgu AND v_toda IS NULL THEN
        RAISE EXCEPTION 'Access Denied: Only a TODA or LGU administrator can see these determinations.';
    END IF;
    RETURN jsonb_build_object('window_days', v_days, 'min_count', public.dispatch_constant('gps_area_flag_count'),
        'areas', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'cell_key', c.cell_i || ':' || c.cell_j,
                       'center_latitude', round(((c.cell_i + 0.5) * v_step)::NUMERIC, 5),
                       'center_longitude', round(((c.cell_j + 0.5) * v_step)::NUMERIC, 5),
                       'determinations', c.determinations, 'stalls', c.stalls, 'connectivity', c.connectivity,
                       'first_at', c.first_at, 'last_at', c.last_at,
                       'reported', EXISTS (SELECT 1 FROM public.admin_review_flag f WHERE f.flag_type = 'GPS_AREA_REVIEW' AND f.subject_type = 'service_area'
                                            AND f.subject_id = c.cell_i || ':' || c.cell_j AND f.status IN ('Open', 'Under Review')))
                   ORDER BY c.determinations DESC, c.last_at DESC)
              FROM public._gps_area_cells(v_days, CASE WHEN v_lgu THEN NULL ELSE v_toda END) c
             WHERE c.determinations >= public.dispatch_constant('gps_area_flag_count')), '[]'::JSONB));
END;
$$;

-- The TODA Administrator reports an area to the LGU Administrator (the shared review-flag mechanism). The counts in the flag are the
-- database's own, recomputed here; the client sends only the square and a note.
CREATE OR REPLACE FUNCTION public.report_gps_area_issue(p_cell_key TEXT, p_note TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_lgu BOOLEAN := COALESCE(public.is_lgu_admin(), FALSE);
    v_toda UUID := public.get_current_toda_admin_toda_id();
    v_days INTEGER := public.dispatch_constant('gps_area_window_days');
    v_step NUMERIC := public.dispatch_constant('gps_area_cell_millidegrees') / 1000.0;
    v_i BIGINT;
    v_j BIGINT;
    v_cell RECORD;
    v_flag UUID;
    v_prev TEXT := current_setting('sakay.internal_context', true);
BEGIN
    IF NOT v_lgu AND v_toda IS NULL THEN
        RAISE EXCEPTION 'Access Denied: Only a TODA or LGU administrator can report an area.';
    END IF;
    IF p_cell_key IS NULL OR p_cell_key !~ '^-?[0-9]+:-?[0-9]+$' THEN
        RAISE EXCEPTION 'ERR_AREA: Unknown area.';
    END IF;
    IF p_note IS NULL OR length(btrim(p_note)) = 0 THEN
        RAISE EXCEPTION 'ERR_AREA_NOTE: Describe what you observed in this area.';
    END IF;
    v_i := split_part(p_cell_key, ':', 1)::BIGINT;
    v_j := split_part(p_cell_key, ':', 2)::BIGINT;
    SELECT * INTO v_cell FROM public._gps_area_cells(v_days, CASE WHEN v_lgu THEN NULL ELSE v_toda END) c WHERE c.cell_i = v_i AND c.cell_j = v_j;
    IF NOT FOUND OR v_cell.determinations < public.dispatch_constant('gps_area_flag_count') THEN
        RAISE EXCEPTION 'ERR_AREA_NOT_REPEATED: This area has fewer than % determinations in the last % days.', public.dispatch_constant('gps_area_flag_count'), v_days;
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    v_flag := public.create_admin_review_flag('GPS_AREA_REVIEW', 'service_area', p_cell_key, 'Rule 17.5', 'lgu_admin',
        jsonb_build_object('center_latitude', round(((v_i + 0.5) * v_step)::NUMERIC, 5), 'center_longitude', round(((v_j + 0.5) * v_step)::NUMERIC, 5),
                           'window_days', v_days, 'determinations', v_cell.determinations, 'stalls', v_cell.stalls, 'connectivity', v_cell.connectivity,
                           'first_at', v_cell.first_at, 'last_at', v_cell.last_at, 'note', btrim(p_note),
                           'reported_by_role', CASE WHEN v_lgu THEN 'lgu_admin' ELSE 'toda_admin' END, 'toda_id', v_toda,
                           'purpose', 'Possible service-zone boundary adjustment (Rule 17.5): repeated stall or connectivity determinations in one area.'));
    PERFORM public.record_policy_audit('GPS_AREA_REPORTED', p_cell_key, NULL, 'Service Area',
        'An area with repeated GPS-caused determinations was reported to the LGU Administrator (Rule 17.5): ' || v_cell.determinations || ' in ' || v_days || ' days. ' || btrim(p_note), NULL,
        jsonb_build_object('flag_id', v_flag, 'cell_key', p_cell_key, 'determinations', v_cell.determinations));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'flag_id', v_flag, 'determinations', v_cell.determinations);
END;
$$;

-- ----------------------------------------------------------------------------
-- 13. PRIVILEGES (every new function has its grants set explicitly: no PUBLIC, no anon)
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.booking_stall_anchor_accuracy() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.strike_lgu_only_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._gps_area_cells(INTEGER, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.booking_timers_sweep() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_driver_live_status(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_trip_connectivity(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.driver_reconfirm_trip(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_trips_needing_reconciliation() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_reconcile_trip(UUID, TEXT, NUMERIC, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.report_deliberate_offline(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.confirm_deliberate_offline(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_gps_determination_hotspots(INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.report_gps_area_issue(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.driver_report_delay(UUID, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_driver_live_status(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_trip_connectivity(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_reconfirm_trip(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_trips_needing_reconciliation() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_trip(UUID, TEXT, NUMERIC, TEXT, BOOLEAN, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_deliberate_offline(UUID, UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_deliberate_offline(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_gps_determination_hotspots(INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_gps_area_issue(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_report_delay(UUID, TEXT) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 14. SELF-CHECK: the new numbers took effect, an old one did not move, and the two violations changed as decided
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF public.dispatch_constant('stall_en_route_warn_seconds') <> 240 OR public.dispatch_constant('gps_area_cell_millidegrees') <> 5
       OR public.dispatch_constant('gps_area_flag_count') <> 3 OR public.dispatch_constant('gps_area_window_days') <> 30 THEN
        RAISE EXCEPTION 'dispatch_constant() does not return the Batch 7 numbers';
    END IF;
    IF public.dispatch_constant('stall_en_route_seconds') <> 300 OR public.dispatch_constant('unreachable_cancel_seconds') <> 300
       OR public.dispatch_constant('ongoing_reconcile_seconds') <> 1800 OR public.dispatch_constant('offer_window_seconds') <> 15 THEN
        RAISE EXCEPTION 'dispatch_constant() lost an existing value';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.violation_catalog WHERE violation_code = 'DRV_DELIBERATE_OFFLINE'
                      AND confirmation_mode = 'ADMIN_CONFIRMATION' AND lgu_only AND NOT exemption_eligible AND default_points = 2) THEN
        RAISE EXCEPTION 'DRV_DELIBERATE_OFFLINE is not LGU-confirmed, 2 points, non-exemptible';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.violation_catalog WHERE violation_code = 'DRV_PICKUP_DEVIATION'
                      AND confirmation_mode = 'ADMIN_CONFIRMATION' AND repeat_min_occurrences = 1 AND default_points = 1) THEN
        RAISE EXCEPTION 'DRV_PICKUP_DEVIATION is not 1 point on the first confirmed case';
    END IF;
END $$;
