-- ============================================================================
-- Migration: 20261024000001_batch9_trip_end_payment_disputes.sql
-- Batch 9: trip completion, early termination, payment confirmation and fare disputes (Rules 13, 16, 18, 29.3 - 29.5).
--
-- What the Phase A audit found (2026-10-12) and what this file changes:
--
--   Rules 16.1 / 18.3   a trip became Completed when the PASSENGER tapped "I Paid" (or when the driver ended it 120 s after arrival): nobody ever
--                       confirmed the cash. Now: the passenger confirms the fare (or documents a discrepancy), the driver taps Payment Received
--                       (driver_confirm_payment_received), and only that tap completes the trip. "Paid" needs BOTH (a CHECK says so).
--   Rule 16.6 / PI-13   ONE merged prompt (decision D9-4 = B): after the driver's End Trip the final fare is locked and shown to both; the passenger
--                       taps Confirm Fare or Report Fare Discrepancy; after completion_confirm_timeout_seconds (120 s, F9.1 = F9.2) the driver may
--                       tap Payment Received without the passenger: recorded "Paid - fare unconfirmed", no strike, a 24 h late dispute window.
--   Rule 18.4           Report Fare Discrepancy = amount + reason saved (fare_dispute); payment_status becomes 'Payment Disputed'; the driver can then
--                       tap Payment Received (the booking completes, the payment stays disputed) until the TODA Administrator (2 business days),
--                       and on escalation the LGU Administrator (3 business days), resolve it to Paid or Waived (resolve_fare_dispute).
--   Rule 13.2 - 13.5    End Trip (Early): the passenger's tap is a REQUEST (passenger_request_early_end); the driver holds the End Trip transition,
--                       which the request unlocks outside the 90 % gate. The approved early point (GPS + time) is recorded, and the fare is the
--                       greater of the accepted estimate and the actual-distance fare (personal), the provisional actual-distance fare with a
--                       fare_adjustment_history row 'SAFETY_EARLY_TERMINATION' (Safety Concern), through the ONE fare function (calculate_fare).
--   Rule 13.6           3 personal early ends in 30 days raise a review flag (LGU first); 3 Safety Concern ends raise a separate safety-pattern flag.
--   Rules 13.7 / 29.3   driver_stop_trip_early: the passenger pays the actual-distance fare only; a TODA review flag; DRV_EARLY_STOP only on
--                       confirmation and never for a breakdown, safety or emergency reason.
--   Rule 16.3           a Completed trip is read-only (booking_completed_lock_guard); the only changes are audited administrator actions
--                       (resolve_fare_dispute, admin_correct_completed_trip).
--   Rule 16.5           an incident report needs a Completed trip, except Emergency / Safety Concern / Accident (provisional list, decision D9-12).
--   Rules 18.5 - 18.7   strikes through issue_strike only, on administrator confirmation: DRV_OVERCHARGING, PAX_REFUSAL_TO_PAY (the driver's
--                       driver_report_non_payment), PAX_UNFOUNDED_DISPUTE, PAX_FARE_AVOIDANCE, DRV_EARLY_STOP; change-refusal complaints are
--                       counted (3 in 30 days: a TODA review flag).
--   PI-15               a passenger who confirmed (or documented) is released from the open-booking check; an 'Arrived at Destination' booking
--                       stuck for 30 minutes is flagged for the TODA Administrator, who can close it (admin_close_unfinished_trip).
--
-- Replaces (CREATE OR REPLACE, copied from the newest definition and patched; the earlier files are NOT edited): dispatch_constant,
-- booking_status_guard, booking_fare_update_guard, booking_trip_progress_guard, incident_report_guard, dispatch_sweep,
-- _passenger_open_booking_conflict.
-- ASCII only (a character outside ASCII would be re-encoded by a hand-applied file). Forward-only. Safe to run twice.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. WHAT THE BOOKING REMEMBERS (system columns: the people on the booking cannot write them, see booking_fare_update_guard)
-- ----------------------------------------------------------------------------
-- The columns, and (ONLY the first time they are added) the record of the trips finished by the old one-tap flow: those trips are recorded as paid by it,
-- with its one moment and nothing invented beyond that. The guard below refuses these columns to everybody except the system, so the backfill runs in the
-- internal context. A second run of this file (a hand-applied file may be pasted twice) finds the columns and touches no data: a trip that was closed
-- unpaid since the first run (an upheld non-payment) stays unpaid.
DO $$
DECLARE
    v_first BOOLEAN := NOT EXISTS (SELECT 1 FROM information_schema.columns
                                    WHERE table_schema = 'public' AND table_name = 'booking' AND column_name = 'payment_status');
    v_prev TEXT := current_setting('sakay.internal_context', true);
BEGIN
    ALTER TABLE public.booking
        ADD COLUMN IF NOT EXISTS payment_status           TEXT NOT NULL DEFAULT 'Unpaid',
        ADD COLUMN IF NOT EXISTS confirm_fare_at          TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS fare_discrepancy_at      TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS payment_received_at      TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS fare_unconfirmed         BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS payment_stuck_flagged_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS early_end_kind           TEXT,
        ADD COLUMN IF NOT EXISTS early_end_reason         TEXT,
        ADD COLUMN IF NOT EXISTS early_end_requested_at   TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS early_end_at             TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS early_end_latitude       DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS early_end_longitude      DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS early_end_accuracy_m     DOUBLE PRECISION;
    IF v_first THEN
        PERFORM set_config('sakay.internal_context', 'true', true);
        UPDATE public.booking
           SET payment_status = 'Paid',
               confirm_fare_at = COALESCE(trip_completed_at, created_at),
               payment_received_at = COALESCE(trip_completed_at, created_at)
         WHERE booking_status = 'Completed';
        PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    END IF;
END $$;
COMMENT ON COLUMN public.booking.payment_status IS 'Rules 18.3 / 18.4: Unpaid, Paid (passenger fare confirmation AND driver Payment Received), Payment Disputed, Waived. System only.';
COMMENT ON COLUMN public.booking.confirm_fare_at IS 'Rule 18.2: when the passenger tapped Confirm Fare. System only (passenger_confirm_fare).';
COMMENT ON COLUMN public.booking.fare_discrepancy_at IS 'Rule 18.4: when the passenger documented a fare discrepancy (amount + reason). System only.';
COMMENT ON COLUMN public.booking.payment_received_at IS 'Rule 18.3: when the driver tapped Payment Received (or an administrator closed the trip). System only.';
COMMENT ON COLUMN public.booking.fare_unconfirmed IS 'Rule 16.6 / PI-08: the trip was finished by the timeout without the passenger''s confirmation ("Paid - fare unconfirmed"). System only.';
COMMENT ON COLUMN public.booking.payment_stuck_flagged_at IS 'PI-15: the booking stayed at the destination without a finish for payment_stuck_minutes and was flagged for reconciliation. System only.';
COMMENT ON COLUMN public.booking.early_end_kind IS 'Rules 13.4 / 13.5 / 13.7: PERSONAL, SAFETY (passenger, Safety Concern) or DRIVER (driver-initiated stop). System only.';
COMMENT ON COLUMN public.booking.early_end_reason IS 'Rule 13: the reason code the passenger or the driver gave (with an optional note). System only.';
COMMENT ON COLUMN public.booking.early_end_requested_at IS 'Rule 13.2: when the early end was requested; it unlocks the driver''s End Trip outside the destination gate. System only.';
COMMENT ON COLUMN public.booking.early_end_at IS 'Rule 13.5: when the driver ended the trip at the approved early point (the moment the point was recorded). System only.';
COMMENT ON COLUMN public.booking.early_end_latitude IS 'Rule 13.5: latitude of the approved early termination point (the driver''s fix when he ended the trip). System only.';
COMMENT ON COLUMN public.booking.early_end_longitude IS 'Rule 13.5: longitude of the approved early termination point. System only.';
COMMENT ON COLUMN public.booking.early_end_accuracy_m IS 'Rule 13.5: reported accuracy (m) of the fix at the approved early termination point. System only.';

ALTER TABLE public.booking DROP CONSTRAINT IF EXISTS booking_payment_status_check;
ALTER TABLE public.booking ADD CONSTRAINT booking_payment_status_check
    CHECK (payment_status IN ('Unpaid', 'Paid', 'Payment Disputed', 'Waived'));
ALTER TABLE public.booking DROP CONSTRAINT IF EXISTS booking_early_end_kind_check;
ALTER TABLE public.booking ADD CONSTRAINT booking_early_end_kind_check
    CHECK (early_end_kind IS NULL OR early_end_kind IN ('PERSONAL', 'SAFETY', 'DRIVER'));
-- Rule 18.3: a booking is recorded as Paid only after BOTH the passenger's fare confirmation and the driver's payment confirmation. The passenger's
-- side is the confirmation itself, a documented discrepancy that was then resolved, or the timeout / administrator closure (fare_unconfirmed).
ALTER TABLE public.booking DROP CONSTRAINT IF EXISTS booking_paid_needs_both_check;
ALTER TABLE public.booking ADD CONSTRAINT booking_paid_needs_both_check
    CHECK (payment_status <> 'Paid'
           OR (payment_received_at IS NOT NULL
               AND (confirm_fare_at IS NOT NULL OR fare_discrepancy_at IS NOT NULL OR fare_unconfirmed)));

-- the sweep of PI-15 reads only the bookings still at the destination: a partial index keeps it from reading every trip ever made
CREATE INDEX IF NOT EXISTS idx_booking_payment_stuck ON public.booking (fare_locked_at)
    WHERE booking_status = 'Arrived at Destination' AND payment_stuck_flagged_at IS NULL;

-- Rule 13.5: the reason code of the fare ledger. 'SAFETY_EARLY_TERMINATION' is shown as "Safety Early Termination".
ALTER TABLE public.fare_adjustment_history DROP CONSTRAINT IF EXISTS fare_adjustment_history_reason_code_check;
ALTER TABLE public.fare_adjustment_history ADD CONSTRAINT fare_adjustment_history_reason_code_check
    CHECK (reason_code IN ('ROUTE_DEVIATION', 'DECLARED_PASSENGER_MISMATCH', 'EARLY_TERMINATION', 'SAFETY_EARLY_TERMINATION', 'DISPUTE_RESOLUTION', 'ADMIN_CORRECTION'));


-- ----------------------------------------------------------------------------
-- 2. THE NUMBERS (dispatch_constant: every key of 20261023000001, plus the end-of-trip figures F9.5 / PI-15 / 13.6 / 18.7)
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
        WHEN 'zone_max_accuracy_m'       THEN 30     -- PI-06 / D8-ZONE (F8.3): a fix less accurate than this is ignored when asking "is the driver at the pickup?"
        WHEN 'no_show_radius_m'          THEN 25     -- PI-06 / D8-ZONE (F8.3): ONE pickup zone for Rules 8.5, 10.1 and the Arrived tap: plain distance, the fix's own error earns no credit
        WHEN 'arrival_zone_tolerance_m'       THEN 5     -- Rule 10.2: the driver may be this far beyond the zone ...
        WHEN 'arrival_zone_tolerance_seconds' THEN 15    -- ... for this long (and up to the radius for this long) without pausing the passenger's wait
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
        -- Batch 9 (2026-10-12): the end of the trip. completion_confirm_timeout_seconds above is ALSO the fare-confirmation timeout (F9.1 = F9.2, decision D9-4)
        WHEN 'fare_dispute_toda_business_days' THEN 2   -- F9.5: the TODA Administrator decides a fare dispute within this many business days (shown as overdue, never auto-resolved)
        WHEN 'fare_dispute_lgu_business_days'  THEN 3   -- F9.5: ... and the LGU Administrator within this many after an escalation
        WHEN 'late_dispute_window_hours' THEN 24     -- Rule 16.6 / PI-20: a fare finished without the passenger's confirmation can still be reported this long
        WHEN 'early_end_flag_count'      THEN 3      -- Rule 13.6 / D9-9: early ends of one kind (personal, or Safety Concern) in the window that raise a review flag (no strike)
        WHEN 'early_end_flag_window_days' THEN 30
        WHEN 'payment_stuck_minutes'     THEN 30     -- PI-15: a trip left at the destination this long is flagged for reconciliation (the same 30 minutes as Rule 9.5)
        WHEN 'change_refusal_flag_count' THEN 3      -- Rule 18.7: complaints of refused change that raise a TODA review flag (a pilot figure: the policy says "repeated")
        WHEN 'change_refusal_window_days' THEN 30
        ELSE NULL
    END;
$$;


-- ----------------------------------------------------------------------------
-- 3. FARE DISPUTES (Rules 13.5, 18.4, 18.6): one record per booking at a time, with the statements of both parties and the review
-- ----------------------------------------------------------------------------
-- kind  FARE_DISCREPANCY  the passenger reported the displayed fare (18.4)
--       SAFETY_REVIEW     the passenger asked for an administrative review of a Safety Concern early end (13.5); it is NOT a payment dispute
--       NON_PAYMENT       the driver reports that a confirmed fare was not paid (18.6)
-- status Open (the TODA Administrator, due in 2 business days) -> Escalated (the LGU Administrator, due in 3 business days after) -> Resolved.
-- due_at is shown as overdue by the portals; nothing is ever resolved automatically.
CREATE TABLE IF NOT EXISTS public.fare_dispute (
    dispute_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id        UUID NOT NULL REFERENCES public.booking(booking_id) ON DELETE CASCADE,
    kind              TEXT NOT NULL CHECK (kind IN ('FARE_DISCREPANCY', 'SAFETY_REVIEW', 'NON_PAYMENT')),
    opened_by         TEXT NOT NULL CHECK (opened_by IN ('passenger', 'driver')),
    opened_by_id      UUID,
    toda_id           UUID REFERENCES public.toda(toda_id) ON DELETE SET NULL,
    assigned_role     TEXT NOT NULL DEFAULT 'toda_admin' CHECK (assigned_role IN ('toda_admin', 'lgu_admin')),
    status            TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Escalated', 'Resolved')),
    claimed_amount    NUMERIC(10,2),
    system_fare       NUMERIC(10,2),
    late              BOOLEAN NOT NULL DEFAULT FALSE,
    outcome           TEXT CHECK (outcome IS NULL OR outcome IN ('FARE_CONFIRMED', 'FARE_REDUCED', 'FARE_WAIVED', 'FARE_ADJUSTED', 'NON_PAYMENT_UPHELD', 'NON_PAYMENT_REJECTED')),
    resolved_fare     NUMERIC(10,2),
    resolution_note   TEXT,
    due_at            TIMESTAMPTZ NOT NULL,
    escalated_at      TIMESTAMPTZ,
    escalated_by      UUID,
    escalation_reason TEXT,
    resolved_at       TIMESTAMPTZ,
    resolved_by       UUID,
    resolved_by_role  TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- one open dispute per booking: a second report adds a statement to it
CREATE UNIQUE INDEX IF NOT EXISTS uq_fare_dispute_open_per_booking ON public.fare_dispute (booking_id) WHERE status <> 'Resolved';
CREATE INDEX IF NOT EXISTS idx_fare_dispute_queue ON public.fare_dispute (status, due_at);
CREATE INDEX IF NOT EXISTS idx_fare_dispute_toda ON public.fare_dispute (toda_id, status);

CREATE TABLE IF NOT EXISTS public.fare_dispute_note (
    note_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispute_id UUID NOT NULL REFERENCES public.fare_dispute(dispute_id) ON DELETE CASCADE,
    party      TEXT NOT NULL CHECK (party IN ('passenger', 'driver', 'toda_admin', 'lgu_admin', 'system')),
    author_id  UUID,
    note       TEXT NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fare_dispute_note_dispute ON public.fare_dispute_note (dispute_id, created_at);

ALTER TABLE public.fare_dispute ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fare_dispute_note ENABLE ROW LEVEL SECURITY;

-- The parties, the TODA Administrator of the booking's TODA and the LGU Administrator read; nobody writes except through the functions below.
DROP POLICY IF EXISTS "fare_dispute_select" ON public.fare_dispute;
CREATE POLICY "fare_dispute_select" ON public.fare_dispute
    FOR SELECT TO authenticated
    USING (public.rls_booking_visible(booking_id));
DROP POLICY IF EXISTS "fare_dispute_note_select" ON public.fare_dispute_note;
CREATE POLICY "fare_dispute_note_select" ON public.fare_dispute_note
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.fare_dispute d WHERE d.dispute_id = fare_dispute_note.dispute_id AND public.rls_booking_visible(d.booking_id)));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.fare_dispute FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.fare_dispute_note FROM anon, authenticated;
REVOKE SELECT ON public.fare_dispute FROM anon;
REVOKE SELECT ON public.fare_dispute_note FROM anon;


-- ----------------------------------------------------------------------------
-- 5. HELPERS (not callable by the apps)
-- ----------------------------------------------------------------------------

-- Rule 13.5: where the approved early termination happened. The driver's own fix when it is fresh and accurate enough for the fare track,
-- otherwise the last good fix of this trip; NULL when the database holds nothing usable (nothing is guessed).
CREATE OR REPLACE FUNCTION public._early_end_point(p_driver_id UUID, p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    d public.driver;
    g RECORD;
    v_max_acc DOUBLE PRECISION := public.fare_policy_constant('gps_max_accuracy_m');
BEGIN
    SELECT * INTO d FROM public.driver WHERE driver_id = p_driver_id;
    IF FOUND AND d.current_latitude IS NOT NULL AND d.current_longitude IS NOT NULL
       AND d.last_location_update >= clock_timestamp() - make_interval(secs => public.driver_presence_constant('location_max_age_seconds'))
       AND d.last_location_accuracy_m IS NOT NULL AND d.last_location_accuracy_m <= v_max_acc THEN
        RETURN jsonb_build_object('lat', d.current_latitude, 'lng', d.current_longitude, 'acc', d.last_location_accuracy_m, 'source', 'driver_fix');
    END IF;
    SELECT l.latitude, l.longitude, l.accuracy INTO g
      FROM public.gps_log l
     WHERE l.booking_id = p_booking_id AND l.accuracy IS NOT NULL AND l.accuracy >= 0 AND l.accuracy <= v_max_acc
     ORDER BY l.recorded_at DESC, l.log_id DESC
     LIMIT 1;
    IF FOUND THEN
        RETURN jsonb_build_object('lat', g.latitude, 'lng', g.longitude, 'acc', g.accuracy, 'source', 'trip_track');
    END IF;
    RETURN NULL;
END;
$$;

-- Opens the dispute of a booking (or, when one is already open, adds the statement to it) and puts it in the right queue: the TODA Administrator of
-- the booking's TODA, or the LGU Administrator when the booking has no TODA. Called by the functions below, which hold the booking's lock.
CREATE OR REPLACE FUNCTION public._fare_dispute_open(p_b public.booking, p_kind TEXT, p_opened_by TEXT, p_opened_by_id UUID, p_claimed NUMERIC, p_note TEXT, p_late BOOLEAN DEFAULT FALSE)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_toda UUID := p_b.toda_id;
    v_role TEXT;
    v_id UUID;
    v_due TIMESTAMPTZ;
BEGIN
    IF v_toda IS NULL THEN
        SELECT d.toda_id INTO v_toda FROM public.driver d WHERE d.driver_id = p_b.driver_id;
    END IF;
    v_role := CASE WHEN v_toda IS NULL THEN 'lgu_admin' ELSE 'toda_admin' END;
    v_due := public.add_business_days(clock_timestamp(),
                public.dispatch_constant(CASE WHEN v_role = 'lgu_admin' THEN 'fare_dispute_lgu_business_days' ELSE 'fare_dispute_toda_business_days' END));

    INSERT INTO public.fare_dispute (booking_id, kind, opened_by, opened_by_id, toda_id, assigned_role, claimed_amount, system_fare, late, due_at)
    VALUES (p_b.booking_id, p_kind, p_opened_by, p_opened_by_id, v_toda, v_role, p_claimed, p_b.actual_fare, COALESCE(p_late, FALSE), v_due)
    ON CONFLICT (booking_id) WHERE status <> 'Resolved' DO NOTHING
    RETURNING dispute_id INTO v_id;

    IF v_id IS NULL THEN
        SELECT d.dispute_id INTO v_id FROM public.fare_dispute d WHERE d.booking_id = p_b.booking_id AND d.status <> 'Resolved';
    ELSE
        PERFORM public.record_policy_audit('FARE_DISPUTE_OPENED', v_id::TEXT, NULL, 'Fare Disputes',
            p_kind || ' opened by the ' || p_opened_by || ' (Rules 13.5 / 18.4 / 18.6); assigned to the ' || replace(v_role, '_', ' ') || '.', NULL,
            jsonb_build_object('dispute_id', v_id, 'booking_id', p_b.booking_id, 'kind', p_kind, 'claimed_amount', p_claimed, 'system_fare', p_b.actual_fare, 'late', COALESCE(p_late, FALSE)));
    END IF;

    IF p_note IS NOT NULL AND length(btrim(p_note)) > 0 THEN
        INSERT INTO public.fare_dispute_note (dispute_id, party, author_id, note) VALUES (v_id, p_opened_by, p_opened_by_id, btrim(p_note));
    END IF;
    RETURN v_id;
END;
$$;

-- Rule 13.6 (decision D9-9): personal early ends and Safety Concern early ends are counted separately, over the same window. Reaching the
-- count raises ONE review flag for the LGU Administrator (the passenger belongs to no TODA; the flag lists the trips and their TODAs). Nothing is automatic:
-- the strike PAX_FARE_AVOIDANCE needs the administrator's confirmation (admin_confirm_flagged_violation).
CREATE OR REPLACE FUNCTION public._check_early_end_pattern(p_passenger_id UUID, p_kind TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_days INTEGER := public.dispatch_constant('early_end_flag_window_days');
    v_need INTEGER := public.dispatch_constant('early_end_flag_count');
    v_n INTEGER;
    v_trips JSONB;
BEGIN
    IF p_passenger_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('PERSONAL', 'SAFETY') THEN
        RETURN;
    END IF;
    SELECT count(*), COALESCE(jsonb_agg(jsonb_build_object('booking_id', b.booking_id, 'early_end_at', b.early_end_at, 'toda_id', b.toda_id, 'reason', b.early_end_reason) ORDER BY b.early_end_at), '[]'::JSONB)
      INTO v_n, v_trips
      FROM public.booking b
     WHERE b.passenger_id = p_passenger_id AND b.early_end_kind = p_kind
       AND b.early_end_at >= clock_timestamp() - make_interval(days => v_days);
    IF v_n < v_need THEN
        RETURN;
    END IF;
    PERFORM set_config('sakay.internal_context', 'true', true);
    PERFORM public.create_admin_review_flag(
        CASE p_kind WHEN 'PERSONAL' THEN 'PASSENGER_EARLY_END_PATTERN' ELSE 'PASSENGER_SAFETY_END_PATTERN' END,
        'passenger', p_passenger_id::TEXT,
        CASE p_kind WHEN 'PERSONAL' THEN 'Rule 13.6' ELSE 'Rule 13.5 / D9-9' END,
        'lgu_admin',
        jsonb_build_object('kind', p_kind, 'count', v_n, 'window_days', v_days, 'trips', v_trips,
            'note', CASE p_kind WHEN 'PERSONAL' THEN 'Frequent early terminations: a possible fare-avoidance pattern. Review the trips; the TODA Administrator may investigate.'
                                ELSE 'Frequent Safety Concern early terminations. Review the trips and the reasons given.' END));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
END;
$$;

CREATE OR REPLACE FUNCTION public.booking_early_end_pattern_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public._check_early_end_pattern(NEW.passenger_id, NEW.early_end_kind);
    RETURN NULL;
END;
$$;

-- Rule 18.7: complaints that a driver intentionally refused to provide change are incident reports of the category 'Change Refusal';
-- repeated complaints (3 in 30 days, a pilot figure) raise a review flag for the driver's TODA Administrator. Nothing is automatic.
CREATE OR REPLACE FUNCTION public.incident_change_refusal_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_days INTEGER := public.dispatch_constant('change_refusal_window_days');
    v_need INTEGER := public.dispatch_constant('change_refusal_flag_count');
    v_n INTEGER;
BEGIN
    IF NEW.driver_id IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT count(*) INTO v_n FROM public.incident_report r
     WHERE r.driver_id = NEW.driver_id AND r.category = 'Change Refusal'
       AND r.created_at >= clock_timestamp() - make_interval(days => v_days);
    IF v_n >= v_need THEN
        PERFORM public._presence_flag('DRIVER_CHANGE_REFUSAL_PATTERN', NEW.driver_id, 'Rule 18.7',
            jsonb_build_object('count', v_n, 'window_days', v_days, 'latest_incident_id', NEW.incident_id,
                'note', 'Repeated complaints that the driver refused to provide change. Review the reports.'));
    END IF;
    RETURN NULL;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. A COMPLETED TRIP IS READ-ONLY (Rule 16.3)
-- ----------------------------------------------------------------------------
-- Nobody on the booking, and no administrator through a table write, changes a Completed trip or deletes it. The ways to change one are the audited
-- functions (resolve_fare_dispute, admin_correct_completed_trip), which run in the internal context. The system (service role, internal context, a
-- direct database session) is not held to this, and neither is the one change a client session may see: the foreign key nulling the passenger or the
-- driver after that row was deleted.
CREATE OR REPLACE FUNCTION public.booking_completed_lock_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.booking_status IS DISTINCT FROM 'Completed' OR COALESCE(public.is_trusted_session(), FALSE) THEN
        RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF to_jsonb(NEW) = to_jsonb(OLD) THEN
            RETURN NEW;                                        -- nothing changes
        END IF;
        IF (to_jsonb(NEW) - 'passenger_id' - 'driver_id') = (to_jsonb(OLD) - 'passenger_id' - 'driver_id')
           AND (NEW.passenger_id IS NOT DISTINCT FROM OLD.passenger_id
                OR (NEW.passenger_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.passenger p WHERE p.passenger_id = OLD.passenger_id)))
           AND (NEW.driver_id IS NOT DISTINCT FROM OLD.driver_id
                OR (NEW.driver_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.driver d WHERE d.driver_id = OLD.driver_id))) THEN
            RETURN NEW;                                        -- the foreign key letting go of a deleted account
        END IF;
    END IF;
    RAISE EXCEPTION 'ERR_TRIP_COMPLETED_READ_ONLY: Tapos na ang biyaheng ito at hindi na ito mababago maliban sa aprubadong aksyon ng administrator. (A completed trip is read-only; only an audited administrator action can change it.)' USING ERRCODE = '42501';
END;
$$;


-- ----------------------------------------------------------------------------
-- 8. THE END OF THE TRIP: what the passenger and the driver tap (all idempotent, each under the booking's row lock)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._trip_end_error(p_code TEXT, p_message TEXT)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT jsonb_build_object('success', FALSE, 'error_code', p_code, 'error', p_message);
$$;

-- Seconds of the passenger's confirmation time left (Rule 16.6 / PI-08: ONE timer, completion_confirm_timeout_seconds), counted from the moment the
-- final fare was locked and shown to both. The database's clock, never a phone's.
CREATE OR REPLACE FUNCTION public._fare_confirm_seconds_left(p_fare_locked_at TIMESTAMPTZ)
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE WHEN p_fare_locked_at IS NULL THEN public.dispatch_constant('completion_confirm_timeout_seconds')
                ELSE GREATEST(0, CEIL(public.dispatch_constant('completion_confirm_timeout_seconds')
                                      - EXTRACT(EPOCH FROM (clock_timestamp() - p_fare_locked_at))))::INTEGER END;
$$;

-- ----------------------------------------------------------------------------
-- 8.1 RULE 13.2: End Trip (Early) is the passenger's REQUEST; the driver holds the End Trip transition (decision D9-6)
-- ----------------------------------------------------------------------------
-- Changed plans / walk the rest / earlier drop-off are personal (13.4: the greater of the accepted estimate and the actual-distance fare). Safety
-- Concern is the exception of 13.5 (the actual-distance fare, provisional, with an administrative review). A request outside the destination gate
-- unlocks the driver's End Trip there; inside the gate a personal request changes nothing (the driver can already end the trip), so two people
-- ending the trip together (Rule 29.5) are harmless: whichever the server receives first, the result is the same trip end.
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
    PERFORM public.record_policy_audit('EARLY_END_REQUESTED', p_booking_id::TEXT, NULL, 'Trip End',
        'The passenger asked to end the trip early (Rule 13.2): ' || v_reason || '.', NULL,
        jsonb_build_object('booking_id', p_booking_id, 'kind', v_kind, 'reason', v_reason, 'progress_pct', public._trip_progress_pct(p_booking_id)));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);

    RETURN jsonb_build_object('success', TRUE, 'kind', v_kind, 'requested_at', v_now);
END;
$$;

CREATE OR REPLACE FUNCTION public.passenger_withdraw_early_end(p_booking_id UUID)
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
BEGIN
    IF v_pax IS NULL THEN
        RETURN public._trip_end_error('ERR_NOT_A_PASSENGER', 'Only a passenger can withdraw the request.');
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_b.passenger_id IS DISTINCT FROM v_pax THEN
        RETURN public._trip_end_error('ERR_NOT_YOUR_BOOKING', 'This booking is not yours.');
    END IF;
    v_phase := public._booking_phase(v_b.booking_status);
    IF v_phase <> 'ongoing' THEN
        RETURN public._trip_end_error('ERR_TRIP_ALREADY_ENDED', 'Tapos na ang biyahe. (The trip has already ended.)');
    END IF;
    IF v_b.early_end_requested_at IS NULL OR v_b.early_end_kind NOT IN ('PERSONAL', 'SAFETY') THEN
        RETURN jsonb_build_object('success', TRUE, 'nothing_to_withdraw', TRUE);
    END IF;
    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.booking SET early_end_kind = NULL, early_end_reason = NULL, early_end_requested_at = NULL WHERE booking_id = p_booking_id;
    PERFORM public.record_policy_audit('EARLY_END_WITHDRAWN', p_booking_id::TEXT, NULL, 'Trip End',
        'The passenger withdrew the request to end the trip early.', jsonb_build_object('kind', v_b.early_end_kind, 'reason', v_b.early_end_reason), NULL);
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'withdrawn', TRUE);
END;
$$;

-- ----------------------------------------------------------------------------
-- 8.2 RULES 13.7 / 29.3: the DRIVER ends the trip early (breakdown, safety, refusal to continue after boarding)
-- ----------------------------------------------------------------------------
-- The passenger pays the actual-distance fare only (the fare guard computes it). No automatic strike: a review flag goes to the TODA Administrator;
-- DRV_EARLY_STOP needs the administrator's confirmation (admin_confirm_flagged_violation) and is never confirmed for a breakdown, a safety concern
-- or an emergency (decision D9-8).
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
    IF p_reason_code IS NULL OR p_reason_code NOT IN ('vehicle_breakdown', 'emergency', 'safety_concern', 'passenger_dispute', 'other') THEN
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

-- ----------------------------------------------------------------------------
-- 8.3 RULES 18.2 / 18.3: Confirm Fare, Report Fare Discrepancy, Payment Received, "the passenger did not pay"
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.passenger_confirm_fare(p_booking_id UUID)
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
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF v_pax IS NULL THEN
        RETURN public._trip_end_error('ERR_NOT_A_PASSENGER', 'Only a passenger can confirm the fare.');
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_b.passenger_id IS DISTINCT FROM v_pax THEN
        RETURN public._trip_end_error('ERR_NOT_YOUR_BOOKING', 'This booking is not yours.');
    END IF;
    v_phase := public._booking_phase(v_b.booking_status);
    IF v_b.confirm_fare_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', TRUE, 'already_confirmed', TRUE, 'confirm_fare_at', v_b.confirm_fare_at, 'actual_fare', v_b.actual_fare);
    END IF;
    IF v_phase <> 'at_destination' THEN
        RETURN public._trip_end_error('ERR_FARE_NOT_SHOWN', 'Wala pang pamasahe na makukumpirma. (There is no fare to confirm yet, or the trip has already finished.)');
    END IF;
    IF v_b.fare_discrepancy_at IS NOT NULL THEN
        RETURN public._trip_end_error('ERR_DISCREPANCY_REPORTED', 'Nai-report mo na ang pamasahe. (You already reported a discrepancy for this fare.)');
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.booking SET confirm_fare_at = v_now WHERE booking_id = p_booking_id;
    PERFORM public._notify_subject('driver', v_b.driver_id, 'FARE_CONFIRMED',
        'Kinumpirma ng pasahero ang pamasahe (The passenger confirmed the fare)',
        'Collect the cash and tap Payment Received. (Kunin ang bayad, saka pindutin ang Payment Received.)', p_booking_id::TEXT, 1);
    PERFORM public.record_policy_audit('FARE_CONFIRMED', p_booking_id::TEXT, NULL, 'Trip End',
        'The passenger confirmed the displayed fare (Rule 18.2).', NULL, jsonb_build_object('booking_id', p_booking_id, 'actual_fare', v_b.actual_fare, 'confirm_fare_at', v_now));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'confirm_fare_at', v_now, 'actual_fare', v_b.actual_fare);
END;
$$;

-- Rule 18.4: the discrepancy is DOCUMENTED when the amount the driver asked for and the reason are saved. The booking becomes Payment Disputed. Before the
-- driver has finished the trip this is the passenger's alternative to Confirm Fare; after a timeout finish ("Paid - fare unconfirmed") it is still possible
-- for the late dispute window (24 hours, decision D9-10).
CREATE OR REPLACE FUNCTION public.passenger_report_fare_discrepancy(p_booking_id UUID, p_claimed_amount NUMERIC, p_reason TEXT)
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
    v_now TIMESTAMPTZ := clock_timestamp();
    v_late BOOLEAN := FALSE;
    v_dispute UUID;
BEGIN
    IF v_pax IS NULL THEN
        RETURN public._trip_end_error('ERR_NOT_A_PASSENGER', 'Only a passenger can report a fare discrepancy.');
    END IF;
    IF p_claimed_amount IS NULL OR p_claimed_amount < 0 OR p_claimed_amount > 99999 THEN
        RETURN public._trip_end_error('ERR_DISCREPANCY_AMOUNT', 'Ilagay ang halagang hiningi ng drayber. (Enter the amount the driver asked for.)');
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) < 10 OR length(btrim(p_reason)) > 1000 THEN
        RETURN public._trip_end_error('ERR_DISCREPANCY_REASON', 'Isulat ang dahilan (10 hanggang 1000 titik). (Write what happened: 10 to 1000 characters.)');
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_b.passenger_id IS DISTINCT FROM v_pax THEN
        RETURN public._trip_end_error('ERR_NOT_YOUR_BOOKING', 'This booking is not yours.');
    END IF;
    v_phase := public._booking_phase(v_b.booking_status);

    IF v_b.fare_discrepancy_at IS NOT NULL THEN
        SELECT d.dispute_id INTO v_dispute FROM public.fare_dispute d WHERE d.booking_id = p_booking_id ORDER BY d.created_at DESC LIMIT 1;
        RETURN jsonb_build_object('success', TRUE, 'already_reported', TRUE, 'dispute_id', v_dispute);
    END IF;
    IF v_phase = 'at_destination' THEN
        IF v_b.confirm_fare_at IS NOT NULL THEN
            RETURN public._trip_end_error('ERR_FARE_ALREADY_CONFIRMED', 'Kinumpirma mo na ang pamasahe. (You already confirmed this fare; a concern about it goes through an incident report.)');
        END IF;
    ELSIF v_phase = 'completed' AND v_b.payment_status = 'Paid' AND v_b.fare_unconfirmed
          AND v_b.payment_received_at >= v_now - make_interval(hours => public.dispatch_constant('late_dispute_window_hours')) THEN
        v_late := TRUE;
    ELSIF v_phase = 'completed' AND v_b.payment_status = 'Paid' AND v_b.fare_unconfirmed THEN
        RETURN public._trip_end_error('ERR_LATE_WINDOW_CLOSED', 'Tapos na ang oras para i-report ang pamasahe. (The time to report this fare has passed.)');
    ELSE
        RETURN public._trip_end_error('ERR_FARE_NOT_SHOWN', 'Walang pamasahe na maire-report ngayon. (There is no fare to report right now.)');
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.booking SET payment_status = 'Payment Disputed', fare_discrepancy_at = v_now WHERE booking_id = p_booking_id RETURNING * INTO v_b;
    v_dispute := public._fare_dispute_open(v_b, 'FARE_DISCREPANCY', 'passenger', v_pax, p_claimed_amount, p_reason, v_late);
    IF v_b.driver_id IS NOT NULL THEN
        PERFORM public._notify_subject('driver', v_b.driver_id, 'FARE_DISCREPANCY_REPORTED',
            'Nag-ulat ang pasahero ng hindi tugmang pamasahe (The passenger reported a fare discrepancy)',
            CASE WHEN v_late THEN 'The TODA Administrator will review it. You may add your side in the app. (Susuriin ito ng TODA Administrator. Maaari mong idagdag ang panig mo sa app.)'
                 ELSE 'You can still tap Payment Received to finish the trip; the payment stays disputed until the TODA Administrator reviews it. You may add your side in the app. (Maaari mo pa ring pindutin ang Payment Received; susuriin ng TODA Administrator ang hindi pagkakasundo.)' END,
            p_booking_id::TEXT, 1);
    END IF;
    PERFORM public.record_policy_audit('FARE_DISCREPANCY_REPORTED', p_booking_id::TEXT, NULL, 'Trip End',
        'The passenger reported a fare discrepancy (Rule 18.4); the booking is Payment Disputed.', NULL,
        jsonb_build_object('booking_id', p_booking_id, 'dispute_id', v_dispute, 'system_fare', v_b.actual_fare, 'claimed_amount', p_claimed_amount, 'late', v_late));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'dispute_id', v_dispute, 'payment_status', 'Payment Disputed', 'late', v_late);
END;
$$;

-- Rule 13.5: the passenger asks for an administrative review of a Safety Concern early end. NOT a payment dispute: the payment is untouched.
CREATE OR REPLACE FUNCTION public.request_safety_fare_review(p_booking_id UUID, p_reason TEXT)
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
    v_dispute UUID;
BEGIN
    IF v_pax IS NULL THEN
        RETURN public._trip_end_error('ERR_NOT_A_PASSENGER', 'Only a passenger can ask for this review.');
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) < 10 OR length(btrim(p_reason)) > 1000 THEN
        RETURN public._trip_end_error('ERR_REVIEW_REASON', 'Isulat ang dahilan (10 hanggang 1000 titik). (Write what happened: 10 to 1000 characters.)');
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_b.passenger_id IS DISTINCT FROM v_pax THEN
        RETURN public._trip_end_error('ERR_NOT_YOUR_BOOKING', 'This booking is not yours.');
    END IF;
    v_phase := public._booking_phase(v_b.booking_status);
    IF v_b.early_end_kind IS DISTINCT FROM 'SAFETY' OR v_phase NOT IN ('at_destination', 'completed') THEN
        RETURN public._trip_end_error('ERR_NOT_A_SAFETY_END', 'Para lamang ito sa biyaheng tinapos dahil sa Safety Concern. (This review is only for a trip ended early for a Safety Concern.)');
    END IF;
    IF v_phase = 'completed' AND COALESCE(v_b.trip_completed_at, clock_timestamp()) < clock_timestamp() - make_interval(hours => public.dispatch_constant('late_dispute_window_hours')) THEN
        RETURN public._trip_end_error('ERR_LATE_WINDOW_CLOSED', 'Tapos na ang oras para humiling ng pagsusuri. (The time to ask for a review has passed.)');
    END IF;
    PERFORM set_config('sakay.internal_context', 'true', true);
    v_dispute := public._fare_dispute_open(v_b, 'SAFETY_REVIEW', 'passenger', v_pax, NULL, p_reason, FALSE);
    PERFORM public.record_policy_audit('SAFETY_FARE_REVIEW_REQUESTED', p_booking_id::TEXT, NULL, 'Trip End',
        'The passenger asked for an administrative review of a Safety Concern early end (Rule 13.5).', NULL,
        jsonb_build_object('booking_id', p_booking_id, 'dispute_id', v_dispute, 'provisional_fare', v_b.actual_fare));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'dispute_id', v_dispute);
END;
$$;

-- Rule 18.3: the driver's Payment Received. It is the ONLY way a trip becomes Completed. Enabled when the passenger confirmed the fare, or documented a
-- discrepancy (the trip completes, the payment stays disputed), or the confirmation time ran out (PI-08: recorded "Paid - fare unconfirmed", no strike).
CREATE OR REPLACE FUNCTION public.driver_confirm_payment_received(p_booking_id UUID)
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
    v_now TIMESTAMPTZ := clock_timestamp();
    v_left INTEGER;
    v_basis TEXT;
BEGIN
    IF v_driver IS NULL THEN
        RETURN public._trip_end_error('ERR_NOT_A_DRIVER', 'Only a driver can confirm a payment.');
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_b.driver_id IS DISTINCT FROM v_driver THEN
        RETURN public._trip_end_error('ERR_NOT_YOUR_BOOKING', 'This booking is not assigned to you.');
    END IF;
    v_phase := public._booking_phase(v_b.booking_status);
    IF v_phase = 'completed' AND v_b.payment_received_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', TRUE, 'already_received', TRUE, 'payment_status', v_b.payment_status, 'trip_completed_at', v_b.trip_completed_at);
    END IF;
    IF v_phase <> 'at_destination' THEN
        RETURN public._trip_end_error('ERR_TRIP_NOT_ENDED', 'Hindi pa tapos ang biyahe. (The trip has not been ended yet.)');
    END IF;

    v_left := public._fare_confirm_seconds_left(v_b.fare_locked_at);
    v_basis := CASE
        WHEN v_b.confirm_fare_at IS NOT NULL THEN 'confirmed'
        WHEN v_b.fare_discrepancy_at IS NOT NULL THEN 'disputed'
        WHEN v_b.fare_locked_at IS NOT NULL AND v_left = 0 THEN 'timeout'
    END;
    IF v_basis IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_WAIT_FOR_PASSENGER', 'seconds_left', v_left,
            'error', 'Hintayin ang kumpirmasyon ng pasahero. (Wait for the passenger to confirm the fare or report a discrepancy; you can tap Payment Received in ' || v_left || ' seconds if they do not.)');
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.booking
       SET payment_received_at = v_now,
           payment_status = CASE WHEN v_basis = 'disputed' THEN 'Payment Disputed' ELSE 'Paid' END,
           fare_unconfirmed = (v_basis = 'timeout'),
           booking_status = 'Completed'
     WHERE booking_id = p_booking_id
     RETURNING * INTO v_b2;
    PERFORM public._dispatch_notify_passenger(v_b2, 'PAYMENT_RECEIVED',
        'Natapos ang biyahe (Trip completed)',
        CASE v_basis WHEN 'disputed' THEN 'Your driver finished the trip. The fare you reported will be reviewed by the TODA Administrator. (Natapos na ang biyahe. Susuriin ng TODA Administrator ang inireport mong pamasahe.)'
                     WHEN 'timeout' THEN 'Your driver finished the trip without your confirmation. If the fare was wrong you may still report it within 24 hours. (Natapos ng drayber ang biyahe nang walang kumpirmasyon mo. Maaari mo pa ring i-report ang pamasahe sa loob ng 24 oras.)'
                     ELSE 'Thank you for riding with SAKAY. (Salamat sa pagsakay sa SAKAY.)' END);
    PERFORM public.record_policy_audit('PAYMENT_RECEIVED', p_booking_id::TEXT, NULL, 'Trip End',
        'The driver tapped Payment Received (Rule 18.3); basis: ' || v_basis || '. The trip is completed.',
        jsonb_build_object('booking_status', v_b.booking_status, 'payment_status', v_b.payment_status),
        jsonb_build_object('booking_status', v_b2.booking_status, 'payment_status', v_b2.payment_status, 'basis', v_basis, 'actual_fare', v_b2.actual_fare,
                           'fare_unconfirmed', v_b2.fare_unconfirmed, 'payment_received_at', v_now));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'payment_status', v_b2.payment_status, 'basis', v_basis, 'fare_unconfirmed', v_b2.fare_unconfirmed,
                              'trip_completed_at', v_b2.trip_completed_at, 'actual_fare', v_b2.actual_fare);
END;
$$;

-- Rule 18.6: the driver reports that a fare the passenger confirmed (or that the confirmation time passed on) was not paid. The trip is closed so the
-- driver is free again, the payment is recorded as Payment Disputed, and a NON_PAYMENT dispute goes to the TODA Administrator. The strike
-- PAX_REFUSAL_TO_PAY (2) is the LGU Administrator's to confirm on resolution.
CREATE OR REPLACE FUNCTION public.driver_report_non_payment(p_booking_id UUID, p_note TEXT)
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
    v_left INTEGER;
    v_dispute UUID;
BEGIN
    IF v_driver IS NULL THEN
        RETURN public._trip_end_error('ERR_NOT_A_DRIVER', 'Only a driver can report a non-payment.');
    END IF;
    IF p_note IS NULL OR length(btrim(p_note)) < 10 OR length(btrim(p_note)) > 1000 THEN
        RETURN public._trip_end_error('ERR_NON_PAYMENT_NOTE', 'Isulat kung ano ang nangyari (10 hanggang 1000 titik). (Write what happened: 10 to 1000 characters.)');
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_b.driver_id IS DISTINCT FROM v_driver THEN
        RETURN public._trip_end_error('ERR_NOT_YOUR_BOOKING', 'This booking is not assigned to you.');
    END IF;
    v_phase := public._booking_phase(v_b.booking_status);
    IF v_phase <> 'at_destination' THEN
        RETURN public._trip_end_error('ERR_TRIP_NOT_ENDED', 'Walang bayad na maire-report ngayon. (There is no unpaid fare to report: the trip has not been ended, or it is finished.)');
    END IF;
    IF v_b.fare_discrepancy_at IS NOT NULL THEN
        RETURN public._trip_end_error('ERR_DISPUTE_OPEN', 'May inireport nang hindi pagkakasundo ang pasahero. (The passenger reported a discrepancy: the fare is in review.)');
    END IF;
    v_left := public._fare_confirm_seconds_left(v_b.fare_locked_at);
    IF v_b.confirm_fare_at IS NULL AND (v_b.fare_locked_at IS NULL OR v_left > 0) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_WAIT_FOR_PASSENGER', 'seconds_left', v_left,
            'error', 'Hintayin ang kumpirmasyon ng pasahero. (Wait for the passenger to confirm the fare, or for the time to run out.)');
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.booking SET payment_status = 'Payment Disputed', booking_status = 'Completed' WHERE booking_id = p_booking_id RETURNING * INTO v_b2;
    v_dispute := public._fare_dispute_open(v_b2, 'NON_PAYMENT', 'driver', v_driver, NULL, p_note, FALSE);
    PERFORM public._dispatch_notify_passenger(v_b2, 'NON_PAYMENT_REPORTED',
        'Iniulat ng drayber na hindi nabayaran ang pamasahe (Your driver reported that the fare was not paid)',
        'The TODA Administrator will review it. You may add your side in the app. (Susuriin ito ng TODA Administrator. Maaari mong idagdag ang panig mo sa app.)');
    PERFORM public.record_policy_audit('NON_PAYMENT_REPORTED', p_booking_id::TEXT, NULL, 'Trip End',
        'The driver reported that the confirmed fare was not paid (Rule 18.6); the trip is closed with the payment disputed.', NULL,
        jsonb_build_object('booking_id', p_booking_id, 'dispute_id', v_dispute, 'system_fare', v_b2.actual_fare));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'dispute_id', v_dispute, 'payment_status', 'Payment Disputed');
END;
$$;

-- Either party may add supporting information while the dispute is open (Rule 18.4); the administrators' own notes are written by their functions.
CREATE OR REPLACE FUNCTION public.submit_fare_dispute_note(p_dispute_id UUID, p_text TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_pax UUID := public.get_current_passenger_id();
    v_drv UUID := public.get_current_driver_id();
    v_d public.fare_dispute;
    v_b public.booking;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_party TEXT;
    v_author UUID;
BEGIN
    IF p_text IS NULL OR length(btrim(p_text)) < 3 OR length(btrim(p_text)) > 1000 THEN
        RETURN public._trip_end_error('ERR_NOTE_TEXT', 'Isulat ang impormasyon (3 hanggang 1000 titik). (Write the information: 3 to 1000 characters.)');
    END IF;
    SELECT * INTO v_d FROM public.fare_dispute WHERE dispute_id = p_dispute_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN public._trip_end_error('ERR_DISPUTE_NOT_FOUND', 'The dispute was not found.');
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = v_d.booking_id;
    IF v_pax IS NOT NULL AND v_b.passenger_id = v_pax THEN
        v_party := 'passenger'; v_author := v_pax;
    ELSIF v_drv IS NOT NULL AND v_b.driver_id = v_drv THEN
        v_party := 'driver'; v_author := v_drv;
    ELSE
        RETURN public._trip_end_error('ERR_NOT_YOUR_DISPUTE', 'This dispute is not yours.');
    END IF;
    IF v_d.status = 'Resolved' THEN
        RETURN public._trip_end_error('ERR_DISPUTE_RESOLVED', 'Nasuri na ang hindi pagkakasundo. (The dispute has been resolved.)');
    END IF;
    PERFORM set_config('sakay.internal_context', 'true', true);
    INSERT INTO public.fare_dispute_note (dispute_id, party, author_id, note) VALUES (p_dispute_id, v_party, v_author, btrim(p_text));
    PERFORM public.record_policy_audit('FARE_DISPUTE_NOTE', p_dispute_id::TEXT, NULL, 'Fare Disputes',
        'The ' || v_party || ' added supporting information to the dispute (Rule 18.4).', NULL, jsonb_build_object('dispute_id', p_dispute_id, 'booking_id', v_d.booking_id, 'party', v_party));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE);
END;
$$;

-- ----------------------------------------------------------------------------
-- 8.4 WHAT BOTH SCREENS READ: the state of the end of the trip, with the server's clock (nothing is kept on a phone)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_trip_end_state(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_me_driver UUID := public.get_current_driver_id();
    v_me_pax UUID := public.get_current_passenger_id();
    v_b public.booking;
    v_d public.fare_dispute;
    v_phase TEXT;
    v_left INTEGER;
    v_open BOOLEAN;
    v_late BOOLEAN;
BEGIN
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id;
    IF NOT FOUND OR NOT ((v_me_driver IS NOT NULL AND v_b.driver_id = v_me_driver) OR (v_me_pax IS NOT NULL AND v_b.passenger_id = v_me_pax)) THEN
        RETURN public._trip_end_error('ERR_NOT_YOUR_BOOKING', 'This booking is not yours.');
    END IF;
    v_phase := public._booking_phase(v_b.booking_status);
    v_open := v_phase = 'at_destination' AND v_b.confirm_fare_at IS NULL AND v_b.fare_discrepancy_at IS NULL;
    v_left := CASE WHEN v_open THEN public._fare_confirm_seconds_left(v_b.fare_locked_at) ELSE 0 END;
    v_late := v_phase = 'completed' AND v_b.payment_status = 'Paid' AND v_b.fare_unconfirmed
              AND v_b.payment_received_at >= clock_timestamp() - make_interval(hours => public.dispatch_constant('late_dispute_window_hours'));
    SELECT * INTO v_d FROM public.fare_dispute WHERE booking_id = p_booking_id ORDER BY created_at DESC LIMIT 1;
    RETURN jsonb_build_object(
        'success', TRUE, 'booking_id', p_booking_id, 'booking_status', v_b.booking_status, 'phase', v_phase,
        'payment_status', v_b.payment_status, 'actual_fare', v_b.actual_fare, 'estimated_fare', v_b.estimated_fare,
        'fare_locked_at', v_b.fare_locked_at, 'confirm_fare_at', v_b.confirm_fare_at, 'fare_discrepancy_at', v_b.fare_discrepancy_at,
        'payment_received_at', v_b.payment_received_at, 'fare_unconfirmed', v_b.fare_unconfirmed, 'trip_completed_at', v_b.trip_completed_at,
        'timeout_seconds', public.dispatch_constant('completion_confirm_timeout_seconds'), 'seconds_left', v_left,
        -- the absolute moment the passenger's confirmation time ends (while it runs): the screens count down to it from the server's own clock (server_now)
        'confirm_deadline', CASE WHEN v_open AND v_b.fare_locked_at IS NOT NULL
                                 THEN v_b.fare_locked_at + make_interval(secs => public.dispatch_constant('completion_confirm_timeout_seconds')) END,
        'can_confirm_fare', v_open,
        'can_report_discrepancy', v_open OR v_late,
        'can_receive_payment', v_phase = 'at_destination' AND (v_b.confirm_fare_at IS NOT NULL OR v_b.fare_discrepancy_at IS NOT NULL OR (v_b.fare_locked_at IS NOT NULL AND v_left = 0)),
        'late_dispute_open', v_late,
        'early_end', CASE WHEN v_b.early_end_kind IS NULL THEN NULL ELSE jsonb_build_object(
            'kind', v_b.early_end_kind, 'reason', v_b.early_end_reason, 'requested_at', v_b.early_end_requested_at, 'ended_at', v_b.early_end_at,
            'latitude', v_b.early_end_latitude, 'longitude', v_b.early_end_longitude) END,
        'dispute', CASE WHEN v_d.dispute_id IS NULL THEN NULL ELSE jsonb_build_object(
            'dispute_id', v_d.dispute_id, 'kind', v_d.kind, 'status', v_d.status, 'outcome', v_d.outcome, 'resolved_fare', v_d.resolved_fare,
            'due_at', v_d.due_at, 'assigned_role', v_d.assigned_role) END,
        'server_now', clock_timestamp());
END;
$$;


-- ----------------------------------------------------------------------------
-- 7. THE GUARDS (each replaces its newest definition; the earlier files are not edited)
-- ----------------------------------------------------------------------------
-- 7.1 the status guard (replaces 20261023000001): Completed only through Payment Received; the passenger no longer ends the trip; an LGU override is audited
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
            -- Rule 10.1 / PI-06 (Batch 8): Arrived means AT THE PICKUP. Whichever screen sends it, the database looks at the driver's own
            -- fix (fresh, accurate, within the zone); a tap from anywhere else is refused, so the passenger's wait can never run while the
            -- driver is still on the road.
            IF v_old = 'assigned' AND v_new = 'arrived' AND NOT public._driver_within_pickup_zone(OLD.driver_id, OLD.booking_id) THEN
                RAISE EXCEPTION 'ERR_NOT_AT_PICKUP: Wala ka pa sa pickup point, o hindi pa malinaw ang GPS mo. Lumapit sa pin at subukang muli. (You are not at the pickup point yet, or your GPS is not clear enough. Move closer to the pin, into the open if needed, and tap Arrived again.)' USING ERRCODE = 'P0001';
            END IF;
            -- Rule 11.1 (Batch 8): the trip does not start before the driver has checked the passenger's first name against the booking
            IF v_old = 'arrived' AND v_new = 'ongoing' AND OLD.boarding_verified_at IS NULL THEN
                RAISE EXCEPTION 'ERR_VERIFY_PASSENGER: Tiyakin muna ang unang pangalan ng pasahero bago simulan ang biyahe. (Check the passenger''s first name against the booking first, then tap "I checked the first name".)' USING ERRCODE = 'P0001';
            END IF;
            v_allowed := (v_old = 'assigned' AND NEW.booking_status = 'In Transit')
                      OR (v_old IN ('assigned', 'arrived') AND v_new = 'arrived')
                      OR (v_old = 'arrived' AND v_new = 'ongoing')
                      OR (v_old = 'ongoing' AND NEW.booking_status = 'Arrived at Destination');
            -- Rule 18.3 (Batch 9): a trip is Completed only by the driver's Payment Received (driver_confirm_payment_received), which waits for the
            -- passenger's Confirm Fare / Report Fare Discrepancy or the confirmation time (Rule 16.6, completion_confirm_timeout_seconds)
            IF v_old = 'at_destination' AND NEW.booking_status = 'Completed' THEN
                RAISE EXCEPTION 'ERR_USE_PAYMENT_RECEIVED: Pindutin ang "Payment Received" para tapusin ang biyahe. (Tap "Payment Received" to finish the trip: a trip is completed by that button only.)' USING ERRCODE = 'P0001';
            END IF;
        ELSIF v_is_pax THEN
            IF NEW.booking_status = 'Cancelled' AND v_old = 'ongoing' THEN
                RAISE EXCEPTION 'ERR_TRIP_IN_PROGRESS: Hindi maaaring ikansela ang biyaheng nagpapatuloy. (A trip in progress cannot be cancelled.)' USING ERRCODE = 'P0001';
            END IF;
            -- Rules 13.2 / 18.2 (Batch 9, decision D9-6): the passenger neither ends the trip nor completes it by writing the status. Outside the destination
            -- gate End Trip (Early) is a REQUEST (passenger_request_early_end) that unlocks the DRIVER's End Trip; the fare is confirmed with
            -- passenger_confirm_fare (or a discrepancy is documented with passenger_report_fare_discrepancy).
            IF v_old = 'ongoing' AND NEW.booking_status = 'Arrived at Destination' THEN
                RAISE EXCEPTION 'ERR_USE_EARLY_END: Ang drayber ang nagtatapos ng biyahe. Pindutin ang End Trip (Early) para humiling. (The driver ends the trip; tap End Trip (Early) to ask for it.)' USING ERRCODE = 'P0001';
            END IF;
            IF v_old = 'at_destination' AND NEW.booking_status = 'Completed' THEN
                RAISE EXCEPTION 'ERR_USE_CONFIRM_FARE: Pindutin ang Confirm Fare o i-report ang pamasahe. (Tap Confirm Fare, or report a discrepancy: the driver completes the trip with Payment Received.)' USING ERRCODE = 'P0001';
            END IF;
            v_allowed := (NEW.booking_status = 'Cancelled' AND v_old IN ('searching', 'assigned', 'arrived', 'no_driver'));
        END IF;

        IF NOT v_allowed THEN
            RAISE EXCEPTION 'ERR_BOOKING_TRANSITION: A booking cannot go from "%" to "%".', OLD.booking_status, NEW.booking_status USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- An LGU Administrator who moves a booking through the table (support, an override) leaves an audit row (Rule 16.3 / D9-2: audited admin override)
    IF NOT v_trusted AND v_is_lgu THEN
        PERFORM public.record_policy_audit('ADMIN_BOOKING_STATUS_OVERRIDE', OLD.booking_id::TEXT, NULL, 'Booking Lifecycle',
            'An LGU administrator changed the status of a booking directly.', jsonb_build_object('booking_status', OLD.booking_status),
            jsonb_build_object('booking_status', NEW.booking_status));
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
    -- Rule 12.4 / PI-02: the priority of a redispatched booking lasts only while it is searching (accepted, cancelled or ended clears it)
    IF v_new IS DISTINCT FROM 'searching' THEN
        NEW.redispatch_priority_at := NULL;
    END IF;
    RETURN NEW;
END;
$$;

-- 7.2 the fare guard (replaces 20261007000003): the payment and early-end columns are the system's; the early-end fare of Rules 13.4 / 13.5 / 13.7
CREATE OR REPLACE FUNCTION public.booking_fare_update_guard()
RETURNS TRIGGER AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_snapshot JSONB;
    v_row public.fare_matrix;
    v_base NUMERIC;
    v_base_km NUMERIC;
    v_rate NUMERIC;
    v_cap INTEGER;
    v_est NUMERIC;
    v_track JSONB;
    v_usable INTEGER;
    v_rec NUMERIC;
    v_tol NUMERIC;
    v_billed NUMERIC;
    v_distance_basis TEXT;
    v_deviation BOOLEAN := FALSE;
    v_incomplete BOOLEAN;
    v_matched BOOLEAN;
    v_basis TEXT;
    v_calc JSONB;
    v_prev_calc JSONB;
    v_final NUMERIC;
    v_prev NUMERIC;
    v_components JSONB;
    v_early BOOLEAN := FALSE;
    v_pt JSONB;
BEGIN
    -- 1. What nobody but trusted server code may change (Rules 6.2, 6.2.1).
    --    COALESCE: is_service_context() can answer NULL in a session that never set the internal-context setting,
    --    and "IF NOT NULL" would skip these locks (found by the live dry run). Unknown = not trusted.
    IF NOT COALESCE(public.is_service_context(), FALSE) THEN
        IF NEW.booking_type IS DISTINCT FROM OLD.booking_type
           OR NEW.is_shared_trip IS DISTINCT FROM OLD.is_shared_trip
           OR NEW.passenger_count IS DISTINCT FROM OLD.passenger_count
           OR NEW.pickup_address IS DISTINCT FROM OLD.pickup_address
           OR NEW.pickup_latitude IS DISTINCT FROM OLD.pickup_latitude
           OR NEW.pickup_longitude IS DISTINCT FROM OLD.pickup_longitude
           OR NEW.dropoff_address IS DISTINCT FROM OLD.dropoff_address
           OR NEW.dropoff_latitude IS DISTINCT FROM OLD.dropoff_latitude
           OR NEW.dropoff_longitude IS DISTINCT FROM OLD.dropoff_longitude
           OR NEW.estimated_distance_km IS DISTINCT FROM OLD.estimated_distance_km
           OR NEW.estimated_fare IS DISTINCT FROM OLD.estimated_fare
           OR NEW.fare_matrix_id IS DISTINCT FROM OLD.fare_matrix_id
           OR NEW.fare_breakdown IS DISTINCT FROM OLD.fare_breakdown THEN
            RAISE EXCEPTION 'ERR_BOOKING_LOCKED: Naka-lock na ang pickup, destinasyon at pamasahe ng booking na ito. (The pickup, destination and estimated fare are locked once a booking is confirmed.)';
        END IF;
        IF NEW.actual_fare IS DISTINCT FROM OLD.actual_fare
           OR NEW.actual_distance_km IS DISTINCT FROM OLD.actual_distance_km
           OR NEW.fare_locked_at IS DISTINCT FROM OLD.fare_locked_at THEN
            RAISE EXCEPTION 'ERR_FARE_LOCKED: Ang pinal na pamasahe ay kinakalkula ng sistema at hindi maaaring baguhin ninuman. (The final fare is computed by the system and cannot be edited by the passenger or the driver.)';
        END IF;
    END IF;

    -- 1b. (Batch 9) The payment and early-termination columns are the system's too: written only by the functions of 20261024000001 (Rules 13, 18).
    IF NOT COALESCE(public.is_service_context(), FALSE) THEN
        IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
           OR NEW.confirm_fare_at IS DISTINCT FROM OLD.confirm_fare_at
           OR NEW.fare_discrepancy_at IS DISTINCT FROM OLD.fare_discrepancy_at
           OR NEW.payment_received_at IS DISTINCT FROM OLD.payment_received_at
           OR NEW.fare_unconfirmed IS DISTINCT FROM OLD.fare_unconfirmed
           OR NEW.payment_stuck_flagged_at IS DISTINCT FROM OLD.payment_stuck_flagged_at
           OR NEW.early_end_kind IS DISTINCT FROM OLD.early_end_kind
           OR NEW.early_end_reason IS DISTINCT FROM OLD.early_end_reason
           OR NEW.early_end_requested_at IS DISTINCT FROM OLD.early_end_requested_at
           OR NEW.early_end_at IS DISTINCT FROM OLD.early_end_at
           OR NEW.early_end_latitude IS DISTINCT FROM OLD.early_end_latitude
           OR NEW.early_end_longitude IS DISTINCT FROM OLD.early_end_longitude
           OR NEW.early_end_accuracy_m IS DISTINCT FROM OLD.early_end_accuracy_m THEN
            RAISE EXCEPTION 'ERR_PAYMENT_LOCKED: Ang bayad at ang maagang pagtatapos ng biyahe ay itinatala ng sistema. (The payment status and the early-termination record are written by the system: use the buttons of the trip.)';
        END IF;
    END IF;

    -- 2. First arrival: compute and lock the final fare (Rule 6.2). Runs once.
    IF NEW.booking_status IN ('Arrived at Destination', 'Completed')
       AND OLD.booking_status IS DISTINCT FROM NEW.booking_status
       AND OLD.fare_locked_at IS NULL
       AND NEW.fare_locked_at IS NULL THEN

        IF NEW.estimated_distance_km IS NULL THEN
            NEW.fare_locked_at := v_now;           -- a row created without a quote: nothing to compute
            RETURN NEW;
        END IF;

        v_snapshot := NEW.fare_breakdown;
        IF v_snapshot IS NULL OR v_snapshot->'rule' IS NULL THEN
            -- A booking made before this batch: use the rule that was in force when it was created.
            v_row := public._fare_rule_row(COALESCE(NEW.created_at, v_now));
            IF v_row.fare_matrix_id IS NULL THEN
                NEW.fare_locked_at := v_now;
                RETURN NEW;
            END IF;
            NEW.fare_matrix_id := v_row.fare_matrix_id;
            v_snapshot := jsonb_build_object('version', 1, 'rule', public._fare_rule_json(v_row), 'estimate', NULL, 'final', NULL, 'legacy_rule_lookup', TRUE);
        END IF;

        v_base := (v_snapshot #>> '{rule,base_fare}')::NUMERIC;
        v_base_km := (v_snapshot #>> '{rule,base_distance_km}')::NUMERIC;
        v_rate := (v_snapshot #>> '{rule,succeeding_rate}')::NUMERIC;
        v_cap := COALESCE((v_snapshot #>> '{rule,seat_capacity}')::INTEGER, public.fare_policy_constant('seat_capacity'));
        v_est := round(NEW.estimated_distance_km::NUMERIC, 3);

        -- Which distance is billed (F5.2).
        -- An early end has no destination to measure against: the track ends where the passenger got down (Rule 13.5)
        v_track := public._trip_track_summary(NEW.booking_id,
            CASE WHEN NEW.early_end_kind IS NULL THEN NEW.dropoff_latitude END,
            CASE WHEN NEW.early_end_kind IS NULL THEN NEW.dropoff_longitude END);
        v_usable := (v_track->>'fixes_usable')::INTEGER;
        v_rec := CASE WHEN v_usable >= 2 THEN (v_track->>'distance_km')::NUMERIC ELSE NULL END;
        v_tol := GREATEST(
            public.fare_policy_constant('deviation_tolerance_m')::NUMERIC / 1000.0,
            v_est * public.fare_policy_constant('deviation_tolerance_pct') / 100.0
        );
        -- A track that has holes or stops short of the destination cannot prove the trip was SHORTER.
        v_incomplete := COALESCE((v_track->>'gap_flag')::BOOLEAN, FALSE)
            OR COALESCE((v_track->>'end_distance_to_destination_m')::NUMERIC > public.fare_policy_constant('gps_arrival_radius_m'), FALSE);

        IF v_rec IS NULL THEN
            v_billed := v_est;  v_distance_basis := 'estimate_no_track';
        ELSIF abs(v_rec - v_est) <= v_tol THEN
            v_billed := v_est;  v_distance_basis := 'estimate_within_tolerance';
        ELSIF v_rec < v_est AND v_incomplete THEN
            v_billed := v_est;  v_distance_basis := 'estimate_kept_incomplete_track';
        ELSE
            v_billed := v_rec;  v_distance_basis := 'actual_distance';  v_deviation := TRUE;
        END IF;

        -- (Batch 9) Rules 13.4 / 13.5 / 13.7: an early end is billed on the distance really travelled to the approved early point, recorded here with
        -- its GPS position and time. Without a usable track the straight line from the pickup to that point stands in for a Safety Concern or a driver's
        -- stop (never more than the passenger could owe); a personal end then keeps the estimate, which is its floor anyway.
        IF NEW.early_end_kind IS NOT NULL THEN
            v_early := TRUE;
            v_deviation := FALSE;                                   -- an early end is its own recorded adjustment, not a Rule 6.2.3 deviation
            v_pt := public._early_end_point(NEW.driver_id, NEW.booking_id);
            NEW.early_end_at := v_now;
            NEW.early_end_latitude := (v_pt->>'lat')::DOUBLE PRECISION;
            NEW.early_end_longitude := (v_pt->>'lng')::DOUBLE PRECISION;
            NEW.early_end_accuracy_m := (v_pt->>'acc')::DOUBLE PRECISION;
            IF v_rec IS NOT NULL THEN
                v_billed := v_rec;  v_distance_basis := 'actual_distance_to_early_point';
            ELSIF v_pt IS NOT NULL AND NEW.early_end_kind <> 'PERSONAL' THEN
                v_billed := round(public.calculate_haversine_distance_km(NEW.pickup_latitude, NEW.pickup_longitude,
                                  (v_pt->>'lat')::DOUBLE PRECISION, (v_pt->>'lng')::DOUBLE PRECISION)::NUMERIC, 3);
                v_distance_basis := 'straight_line_to_early_point_no_track';
            ELSE
                v_billed := v_est;  v_distance_basis := 'estimate_no_track';
            END IF;
        END IF;

        -- Which fare applies (Rules 6.1.2, 6.5, 14.4).
        v_matched := NEW.is_shared_trip
            AND NEW.shared_trip_match_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM public.shared_trip_match m WHERE m.match_id = NEW.shared_trip_match_id AND m.match_status = 'Matched');
        v_basis := CASE
            WHEN NOT NEW.is_shared_trip THEN 'solo'
            WHEN v_matched THEN 'matched_estimate_pending_segments'   -- Batch 10 supplies the legs for allocate_shared_fares()
            ELSE 'unmatched_solo'                                      -- no partner: Maximum Unmatched Fare, no strike, no compensation
        END;

        v_calc := public.calculate_fare(v_billed, CASE WHEN v_matched THEN 'Shared' ELSE 'Solo' END, NEW.passenger_count, v_base, v_base_km, v_rate, v_cap);
        v_final := CASE WHEN v_matched THEN (v_calc->>'shared_matched_estimate') ELSE (v_calc->>'solo_fare') END::NUMERIC;
        v_components := CASE WHEN v_matched THEN v_calc->'shared_components' ELSE v_calc->'solo_components' END;

        IF v_early THEN
            -- the accepted estimate, priced on the same basis (Rule 13.4: the fare displayed and accepted at booking confirmation)
            v_prev_calc := public.calculate_fare(v_est, CASE WHEN v_matched THEN 'Shared' ELSE 'Solo' END, NEW.passenger_count, v_base, v_base_km, v_rate, v_cap);
            v_prev := CASE WHEN v_matched THEN (v_prev_calc->>'shared_matched_estimate') ELSE (v_prev_calc->>'solo_fare') END::NUMERIC;
            IF NEW.early_end_kind = 'PERSONAL' AND v_prev > v_final THEN
                v_calc := v_prev_calc;                              -- Rule 13.4: the GREATER of the accepted estimate and the actual-distance fare
                v_final := v_prev;
                v_components := CASE WHEN v_matched THEN v_calc->'shared_components' ELSE v_calc->'solo_components' END;
                v_billed := v_est;
                v_distance_basis := 'estimate_is_greater_than_actual';
            END IF;
            INSERT INTO public.fare_adjustment_history (
                booking_id, reason_code, previous_fare, new_fare, estimated_distance_km, actual_distance_km, tolerance_km, details, actor_role
            ) VALUES (
                NEW.booking_id, CASE WHEN NEW.early_end_kind = 'SAFETY' THEN 'SAFETY_EARLY_TERMINATION' ELSE 'EARLY_TERMINATION' END,
                v_prev, v_final, v_est, v_rec, NULL,
                jsonb_build_object('kind', NEW.early_end_kind, 'reason', NEW.early_end_reason, 'provisional', NEW.early_end_kind = 'SAFETY',
                                   'distance_basis', v_distance_basis, 'billed_distance_km', v_billed,
                                   'early_end_at', v_now, 'early_end_latitude', NEW.early_end_latitude, 'early_end_longitude', NEW.early_end_longitude,
                                   'early_end_accuracy_m', NEW.early_end_accuracy_m, 'track', v_track),
                'system'
            );
        END IF;

        IF v_deviation THEN
            v_prev_calc := public.calculate_fare(v_est, CASE WHEN v_matched THEN 'Shared' ELSE 'Solo' END, NEW.passenger_count, v_base, v_base_km, v_rate, v_cap);
            v_prev := CASE WHEN v_matched THEN (v_prev_calc->>'shared_matched_estimate') ELSE (v_prev_calc->>'solo_fare') END::NUMERIC;
            -- Rule 6.2.4: every deviation is recorded for audit.
            INSERT INTO public.fare_adjustment_history (
                booking_id, reason_code, previous_fare, new_fare,
                estimated_distance_km, actual_distance_km, tolerance_km, details, actor_role
            ) VALUES (
                NEW.booking_id, 'ROUTE_DEVIATION', v_prev, v_final,
                v_est, v_rec, round(v_tol, 3),
                jsonb_build_object(
                    'direction', CASE WHEN v_rec > v_est THEN 'longer' ELSE 'shorter' END,
                    'distance_basis', v_distance_basis,
                    'track', v_track
                ),
                'system'
            );
        END IF;

        NEW.actual_distance_km := v_rec::DOUBLE PRECISION;
        NEW.actual_fare := v_final;
        NEW.fare_locked_at := v_now;
        NEW.fare_breakdown := jsonb_set(v_snapshot, '{final}', jsonb_build_object(
            'basis', v_basis,
            'distance_basis', v_distance_basis,
            'billed_distance_km', v_billed,
            'estimated_distance_km', v_est,
            'recorded_distance_km', v_rec,
            'tolerance_km', round(v_tol, 3),
            'deviation', v_deviation,
            'track', v_track,
            'seat_fare', v_calc->'seat_fare',
            'excess_km', v_calc->'excess_km',
            'seat_capacity', v_cap,
            'components', v_components,
            'minimum_fare', v_calc->'minimum_fare',
            'actual_fare', v_final,
            'finalized_at', v_now
        ) || CASE WHEN v_early THEN jsonb_build_object('early_end', jsonb_build_object(
                'kind', NEW.early_end_kind, 'reason', NEW.early_end_reason, 'requested_at', NEW.early_end_requested_at, 'ended_at', v_now,
                'latitude', NEW.early_end_latitude, 'longitude', NEW.early_end_longitude, 'accuracy_m', NEW.early_end_accuracy_m,
                'provisional', NEW.early_end_kind = 'SAFETY', 'accepted_estimate_fare', v_prev, 'actual_distance_km', v_rec))
            ELSE '{}'::JSONB END, TRUE);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 7.3 the finish gate (replaces 20261017000001): a pending early end unlocks the driver's End Trip
CREATE OR REPLACE FUNCTION public.booking_trip_progress_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_min INTEGER := public.dispatch_constant('trip_finish_min_progress_pct');
    v_pct INTEGER;
BEGIN
    IF public._booking_phase(OLD.booking_status) IS DISTINCT FROM 'ongoing'
       OR NEW.booking_status IS DISTINCT FROM 'Arrived at Destination'
       OR COALESCE(public.is_trusted_session(), FALSE)
       OR COALESCE(public.is_lgu_admin(), FALSE)
       OR OLD.early_end_requested_at IS NOT NULL OR OLD.early_end_kind IS NOT NULL      -- Rule 13.2 (Batch 9): the passenger's early-end request unlocks End Trip
       OR OLD.driver_id IS NULL OR OLD.driver_id IS DISTINCT FROM public.get_current_driver_id() THEN
        RETURN NEW;
    END IF;

    v_pct := public._trip_progress_pct(OLD.booking_id);
    IF v_pct IS NULL THEN
        RAISE EXCEPTION 'ERR_TRIP_POSITION_UNKNOWN: Wala pang naitalang lokasyon ng biyahe. Siguraduhing bukas ang Location at subukang muli. (Your position on this trip has not been recorded yet. Keep Location on and try again in a few seconds.)' USING ERRCODE = 'P0001';
    ELSIF v_pct < v_min THEN
        RAISE EXCEPTION 'ERR_TRIP_NOT_FAR_ENOUGH: Malayo pa sa destinasyon (% ng biyahe). Maaaring tapusin ang biyahe mula % ng biyahe. (You can finish the trip once it is at least % complete; it is at % now.)', v_pct || '%', v_min || '%', v_min || '%', v_pct || '%' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

-- 7.4 the incident guard (replaces 20261012000001): Rule 16.5
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
    v_lgu     UUID;
    v_tadmin  UUID;
BEGIN
    -- ===================== INSERT =====================
    IF TG_OP = 'INSERT' THEN
        NEW.category    := btrim(COALESCE(NEW.category, ''));
        NEW.description := btrim(COALESCE(NEW.description, ''));
        IF v_trusted THEN
            RETURN NEW;
        END IF;

        IF NEW.category = '' OR length(NEW.category) > 100 THEN
            RAISE EXCEPTION 'ERR_INCIDENT_INVALID: Pumili ng uri ng insidente. (Choose an incident category.)';
        END IF;
        IF NEW.description = '' OR length(NEW.description) > 2000 THEN
            RAISE EXCEPTION 'ERR_INCIDENT_INVALID: Isulat ang detalye ng insidente (hanggang 2000 na titik). (Describe the incident, up to 2000 characters.)';
        END IF;

        SELECT * INTO v_b FROM public.booking WHERE booking_id = NEW.booking_id;
        IF v_b.booking_id IS NULL THEN
            RAISE EXCEPTION 'ERR_INCIDENT_BOOKING: Hindi nahanap ang biyahe. (The trip was not found.)';
        END IF;
        -- Rule 16.5 (Batch 9, decision D9-12): a report is made after the trip is completed, except for an emergency (the provisional list: Batch 11
        -- defines the emergency incidents)
        IF v_b.booking_status IS DISTINCT FROM 'Completed' AND NEW.category NOT IN ('Emergency', 'Safety Concern', 'Accident') THEN
            RAISE EXCEPTION 'ERR_INCIDENT_AFTER_TRIP: Makapag-uulat lamang pagkatapos ng biyahe, maliban sa emergency. (A report can be made only after the trip is completed, except for an emergency: Emergency, Safety Concern or Accident.)';
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

        -- The review state always starts empty, whatever the request said.
        NEW.status := 'Pending';
        NEW.reviewed_by_toda := NULL;
        NEW.reviewed_by_lgu := NULL;
        NEW.resolution := NULL;
        NEW.resolution_notes := NULL;
        NEW.resolved_at := NULL;
        NEW.cancellation_reason := NULL;
        NEW.created_at := CURRENT_TIMESTAMP;

        -- Evidence: at most 3 files, every one inside the reporter's own storage folder.
        NEW.evidence_paths := COALESCE(NEW.evidence_paths, '{}');
        IF cardinality(NEW.evidence_paths) > 3 THEN
            RAISE EXCEPTION 'ERR_INCIDENT_EVIDENCE: Hanggang 3 larawan lamang. (At most 3 photos.)';
        END IF;
        IF EXISTS (SELECT 1 FROM unnest(NEW.evidence_paths) p
                    WHERE p NOT LIKE v_uid::TEXT || '/%' OR p LIKE '%..%') THEN
            RAISE EXCEPTION 'ERR_INCIDENT_EVIDENCE: Hindi tamang lokasyon ng larawan. (The photo must be in your own folder.)';
        END IF;
        RETURN NEW;
    END IF;

    -- ===================== UPDATE =====================
    IF v_trusted THEN
        RETURN NEW;
    END IF;

    -- The facts of a report never change, for anybody. Administrators change only the review fields.
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

    IF public.is_lgu_admin() THEN
        SELECT a.admin_id INTO v_lgu FROM public.lgu_admin a WHERE a.auth_user_id = v_uid LIMIT 1;
        NEW.reviewed_by_lgu := COALESCE(v_lgu, OLD.reviewed_by_lgu);
        NEW.reviewed_by_toda := OLD.reviewed_by_toda;
        RETURN NEW;
    END IF;

    IF public.is_toda_admin() THEN
        SELECT a.admin_id INTO v_tadmin FROM public.toda_admin a WHERE a.auth_user_id = v_uid LIMIT 1;
        NEW.reviewed_by_toda := COALESCE(v_tadmin, OLD.reviewed_by_toda);
        NEW.reviewed_by_lgu := OLD.reviewed_by_lgu;
        RETURN NEW;
    END IF;

    -- Anybody else who got past the row policy is the reporting passenger: the only change allowed is withdrawing a Pending report.
    IF OLD.status = 'Pending'
       AND NEW.status = 'Cancelled'
       AND btrim(COALESCE(NEW.cancellation_reason, '')) <> ''
       AND NEW.resolution IS NOT DISTINCT FROM OLD.resolution
       AND NEW.resolution_notes IS NOT DISTINCT FROM OLD.resolution_notes
       AND NEW.reviewed_by_toda IS NOT DISTINCT FROM OLD.reviewed_by_toda
       AND NEW.reviewed_by_lgu IS NOT DISTINCT FROM OLD.reviewed_by_lgu
       AND NEW.resolved_at IS NOT DISTINCT FROM OLD.resolved_at THEN
        NEW.cancellation_reason := btrim(NEW.cancellation_reason);
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'ERR_INCIDENT_LOCKED: Maaari mo lamang bawiin ang ulat na hindi pa nasusuri. (Only a report that has not been reviewed yet can be withdrawn.)';
END;
$$;

-- 7.5 one definition of "open booking" (replaces 20261019000001): PI-15
CREATE OR REPLACE FUNCTION public._passenger_open_booking_conflict(p_passenger_id UUID, p_is_shared BOOLEAN, p_except_booking_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_open INTEGER;
    v_shared_primary INTEGER;
BEGIN
    IF p_passenger_id IS NULL THEN
        RETURN FALSE;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('sakay.open_booking:' || p_passenger_id::TEXT, 0));

    SELECT count(*) INTO v_open
      FROM public.booking b
     WHERE b.passenger_id = p_passenger_id
       AND b.booking_id IS DISTINCT FROM p_except_booking_id
       AND (public._booking_is_searching(b.booking_status) OR public._booking_is_open_accepted(b.booking_status))
       -- PI-15 (Batch 9): once the passenger has confirmed the fare or documented a discrepancy nothing is left for the passenger to do at the destination
       AND NOT (b.booking_status = 'Arrived at Destination' AND (b.confirm_fare_at IS NOT NULL OR b.fare_discrepancy_at IS NOT NULL));
    IF v_open = 0 THEN
        RETURN FALSE;
    END IF;

    SELECT count(*) INTO v_shared_primary
      FROM public.booking b
     WHERE b.passenger_id = p_passenger_id
       AND b.booking_id IS DISTINCT FROM p_except_booking_id
       AND b.is_shared_trip = TRUE
       AND b.booking_status = 'Searching Driver';
    RETURN NOT (v_shared_primary = v_open AND COALESCE(p_is_shared, FALSE));
END;
$$;

-- 7.6 the sweep (replaces 20261023000001): the stuck-trip check
CREATE OR REPLACE FUNCTION public.dispatch_sweep()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    r RECORD;
    v_n INTEGER := 0;
BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtextextended('sakay.dispatch_sweep', 0)) THEN
        RETURN 0;
    END IF;
    FOR r IN
        SELECT b.booking_id
          FROM public.booking b
         -- the literal status list (not _booking_is_searching()): only a literal lets the database use the partial index idx_booking_dispatch_due,
         -- so a sweep does not read every trip ever made
         WHERE b.booking_status IN ('Pending', 'Searching Driver')
           AND (COALESCE(b.dispatch_next_action_at, b.created_at) <= clock_timestamp()
                -- an offer whose driver went Offline (or Busy) is not waited out: the search moves on at once
                OR EXISTS (SELECT 1 FROM public.dispatch_attempt a JOIN public.driver d ON d.driver_id = a.driver_id
                            WHERE a.booking_id = b.booking_id AND a.response_status = 'Pending' AND d.availability_status <> 'Available'))
         -- Rule 12.4 / PI-02: a booking redispatched with priority is served before the others that are due (the one deliberate exception)
         ORDER BY (b.redispatch_priority_at IS NULL), COALESCE(b.dispatch_next_action_at, b.created_at)
         LIMIT public.dispatch_constant('sweep_batch_limit')
           FOR UPDATE OF b SKIP LOCKED
    LOOP
        BEGIN
            PERFORM public._dispatch_advance(r.booking_id);
            v_n := v_n + 1;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'dispatch sweep: booking % could not be advanced (%)', r.booking_id, SQLERRM;
        END;
    END LOOP;
    -- The same wake-ups also keep the accepted bookings honest (a driver who never moves, a driver who goes silent): see booking_timers_sweep().
    BEGIN
        PERFORM public.booking_timers_sweep();
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'dispatch sweep: the booking timers could not run (%)', SQLERRM;
    END;
    -- PI-15 (Batch 9): a trip left at the destination without Payment Received is flagged once for the TODA Administrator.
    BEGIN
        PERFORM public._booking_payment_sweep();
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'dispatch sweep: the payment sweep could not run (%)', SQLERRM;
    END;
    RETURN v_n;
END;
$$;


-- ----------------------------------------------------------------------------
-- 9. THE ADMINISTRATORS: the dispute queue, escalation, resolution, the audited correction of a completed trip, the stuck trip
-- ----------------------------------------------------------------------------
-- A driver's early stop for these reasons is never struck (decision D9-8); one place holds the list.
CREATE OR REPLACE FUNCTION public._early_stop_reason_is_valid(p_reason TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT split_part(COALESCE(p_reason, ''), ':', 1) IN ('vehicle_breakdown', 'emergency', 'safety_concern');
$$;

-- The disputes this administrator may see: the TODA Administrator the ones of the TODA's own drivers (all of them, so an escalated one stays visible),
-- the LGU Administrator all of them. Names and phone numbers are the administrators' to read (the same rule as the trip reconciliation).
CREATE OR REPLACE FUNCTION public.get_fare_disputes(p_status TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_lgu BOOLEAN := COALESCE(public.is_lgu_admin(), FALSE);
    v_toda UUID := public.get_current_toda_admin_toda_id();
BEGIN
    IF NOT v_lgu AND v_toda IS NULL THEN
        RAISE EXCEPTION 'Access Denied: Only a TODA or LGU administrator can see the fare disputes.';
    END IF;
    IF p_status IS NOT NULL AND p_status NOT IN ('Open', 'Escalated', 'Resolved') THEN
        RAISE EXCEPTION 'ERR_DISPUTE_STATUS: The status must be Open, Escalated or Resolved.';
    END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(x.j ORDER BY x.resolved, x.due_at, x.created_at DESC)
          FROM (
            SELECT (d.status = 'Resolved') AS resolved, d.due_at, d.created_at,
                   jsonb_build_object(
                       'dispute_id', d.dispute_id, 'booking_id', d.booking_id, 'kind', d.kind, 'status', d.status, 'assigned_role', d.assigned_role,
                       'opened_by', d.opened_by, 'late', d.late, 'claimed_amount', d.claimed_amount, 'system_fare', d.system_fare,
                       'resolved_fare', d.resolved_fare, 'outcome', d.outcome, 'resolution_note', d.resolution_note,
                       'due_at', d.due_at, 'overdue', (d.status <> 'Resolved' AND d.due_at < clock_timestamp()),
                       'created_at', d.created_at, 'escalated_at', d.escalated_at, 'escalation_reason', d.escalation_reason, 'resolved_at', d.resolved_at,
                       'booking_status', b.booking_status, 'payment_status', b.payment_status, 'actual_fare', b.actual_fare, 'estimated_fare', b.estimated_fare,
                       'early_end_kind', b.early_end_kind, 'early_end_reason', b.early_end_reason, 'fare_unconfirmed', b.fare_unconfirmed,
                       'pickup_address', b.pickup_address, 'dropoff_address', b.dropoff_address, 'trip_completed_at', b.trip_completed_at,
                       'passenger_name', p.full_name, 'passenger_phone', p.contact_number,
                       'driver_id', dr.driver_id, 'driver_name', dr.full_name, 'driver_phone', dr.contact_number, 'plate_number', dr.plate_number,
                       'toda_name', t.toda_name,
                       'notes', COALESCE((SELECT jsonb_agg(jsonb_build_object('party', n.party, 'note', n.note, 'created_at', n.created_at) ORDER BY n.created_at)
                                            FROM public.fare_dispute_note n WHERE n.dispute_id = d.dispute_id), '[]'::JSONB)
                   ) AS j
              FROM public.fare_dispute d
              JOIN public.booking b ON b.booking_id = d.booking_id
              LEFT JOIN public.passenger p ON p.passenger_id = b.passenger_id
              LEFT JOIN public.driver dr ON dr.driver_id = b.driver_id
              LEFT JOIN public.toda t ON t.toda_id = d.toda_id
             WHERE (p_status IS NULL OR d.status = p_status)
               AND (v_lgu OR d.toda_id = v_toda OR public.rls_booking_in_my_toda(d.booking_id))
             ORDER BY (d.status = 'Resolved'), d.due_at, d.created_at DESC
             LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
          ) x), '[]'::JSONB);
END;
$$;

-- The TODA Administrator passes a dispute to the LGU Administrator (Rule 18.4: "where necessary"); the LGU review target (3 business days) starts.
CREATE OR REPLACE FUNCTION public.escalate_fare_dispute(p_dispute_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_d public.fare_dispute;
    v_b public.booking;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_due TIMESTAMPTZ;
BEGIN
    IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
        RAISE EXCEPTION 'ERR_ESCALATION_REASON: Write why the dispute needs the LGU Administrator (at least 10 characters).';
    END IF;
    SELECT * INTO v_d FROM public.fare_dispute WHERE dispute_id = p_dispute_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_DISPUTE_NOT_FOUND: The dispute was not found.';
    END IF;
    IF NOT (COALESCE(public.is_toda_admin(), FALSE) AND public.rls_booking_in_my_toda(v_d.booking_id)) THEN
        RAISE EXCEPTION 'Access Denied: Only the TODA Administrator of this driver can escalate the dispute (the LGU Administrator resolves it directly).';
    END IF;
    IF v_d.status <> 'Open' THEN
        RETURN jsonb_build_object('success', TRUE, 'already', TRUE, 'status', v_d.status);
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = v_d.booking_id;
    v_due := public.add_business_days(clock_timestamp(), public.dispatch_constant('fare_dispute_lgu_business_days'));
    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.fare_dispute
       SET status = 'Escalated', assigned_role = 'lgu_admin', escalated_at = clock_timestamp(), escalated_by = auth.uid(),
           escalation_reason = btrim(p_reason), due_at = v_due
     WHERE dispute_id = p_dispute_id;
    INSERT INTO public.fare_dispute_note (dispute_id, party, author_id, note) VALUES (p_dispute_id, 'toda_admin', auth.uid(), 'Escalated to the LGU Administrator: ' || btrim(p_reason));
    IF v_b.passenger_id IS NOT NULL THEN
        PERFORM public._notify_subject('passenger', v_b.passenger_id, 'FARE_DISPUTE_ESCALATED', 'Ipinasa sa LGU ang pagsusuri (The review was passed to the LGU Administrator)',
            'The LGU Administrator will decide your fare dispute. (Ang LGU Administrator na ang magpapasya.)', p_dispute_id::TEXT, 1);
    END IF;
    IF v_b.driver_id IS NOT NULL THEN
        PERFORM public._notify_subject('driver', v_b.driver_id, 'FARE_DISPUTE_ESCALATED', 'Ipinasa sa LGU ang pagsusuri (The review was passed to the LGU Administrator)',
            'The LGU Administrator will decide the fare dispute. (Ang LGU Administrator na ang magpapasya.)', p_dispute_id::TEXT, 1);
    END IF;
    PERFORM public.record_policy_audit('FARE_DISPUTE_ESCALATED', p_dispute_id::TEXT, NULL, 'Fare Disputes',
        'The TODA Administrator escalated the dispute to the LGU Administrator (Rule 18.4): ' || btrim(p_reason), jsonb_build_object('status', v_d.status),
        jsonb_build_object('status', 'Escalated', 'due_at', v_due, 'booking_id', v_d.booking_id));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'status', 'Escalated', 'due_at', v_due);
END;
$$;

-- Rules 13.5 / 18.4 / 18.6: the decision. The final fare is confirmed, reduced, waived or adjusted (never above the system's fare: Rule 18.1), the payment
-- becomes Paid or Waived, and the strike the facts call for is issued through issue_strike AS THE ADMINISTRATOR (so the ledger names who confirmed it):
--   DRV_OVERCHARGING (the driver asked for more than the displayed fare, Rule 18.5), PAX_UNFOUNDED_DISPUTE (bad faith, Rule 18.4) and
--   PAX_REFUSAL_TO_PAY (Rule 18.6; the TODA Administrator may not strike a passenger: the LGU Administrator confirms the two passenger strikes).
-- Everything is written to fare_adjustment_history and audit_log; both parties are told.
CREATE OR REPLACE FUNCTION public.resolve_fare_dispute(p_dispute_id UUID, p_outcome TEXT, p_final_fare NUMERIC, p_reason TEXT, p_strike_code TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_lgu BOOLEAN := COALESCE(public.is_lgu_admin(), FALSE);
    v_role TEXT;
    v_d public.fare_dispute;
    v_b public.booking;
    v_b2 public.booking;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_now TIMESTAMPTZ := clock_timestamp();
    v_cur NUMERIC;
    v_final NUMERIC;
    v_pay TEXT;
    v_strike JSONB;
    v_subject_type TEXT;
    v_subject_id UUID;
BEGIN
    IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
        RAISE EXCEPTION 'ERR_RESOLUTION_REASON: Write the reason for the decision (at least 10 characters).';
    END IF;
    SELECT * INTO v_d FROM public.fare_dispute WHERE dispute_id = p_dispute_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_DISPUTE_NOT_FOUND: The dispute was not found.';
    END IF;
    IF NOT (v_lgu OR (COALESCE(public.is_toda_admin(), FALSE) AND v_d.status = 'Open' AND v_d.assigned_role = 'toda_admin' AND public.rls_booking_in_my_toda(v_d.booking_id))) THEN
        RAISE EXCEPTION 'Access Denied: This dispute is not assigned to you (an escalated dispute is decided by the LGU Administrator).';
    END IF;
    v_role := CASE WHEN v_lgu THEN 'lgu_admin' ELSE 'toda_admin' END;
    IF v_d.status = 'Resolved' THEN
        RETURN jsonb_build_object('success', TRUE, 'already_resolved', TRUE, 'outcome', v_d.outcome);
    END IF;
    IF p_outcome IS NULL OR NOT ((v_d.kind IN ('FARE_DISCREPANCY', 'SAFETY_REVIEW') AND p_outcome IN ('FARE_CONFIRMED', 'FARE_REDUCED', 'FARE_WAIVED', 'FARE_ADJUSTED'))
                                  OR (v_d.kind = 'NON_PAYMENT' AND p_outcome IN ('NON_PAYMENT_UPHELD', 'NON_PAYMENT_REJECTED'))) THEN
        RAISE EXCEPTION 'ERR_RESOLUTION_OUTCOME: The outcome does not fit this kind of dispute (%).', v_d.kind;
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = v_d.booking_id FOR UPDATE;
    IF public._booking_phase(v_b.booking_status) <> 'completed' THEN
        RAISE EXCEPTION 'ERR_TRIP_NOT_FINISHED: The trip has not been finished yet; close it first (admin_close_unfinished_trip).';
    END IF;

    v_cur := COALESCE(v_b.actual_fare, 0);
    v_final := CASE p_outcome
        WHEN 'FARE_WAIVED' THEN 0
        WHEN 'FARE_REDUCED' THEN p_final_fare
        WHEN 'FARE_ADJUSTED' THEN p_final_fare
        ELSE v_cur END;
    IF v_final IS NULL OR v_final < 0 OR v_final > v_cur OR (p_outcome = 'FARE_REDUCED' AND v_final >= v_cur) THEN
        RAISE EXCEPTION 'ERR_RESOLUTION_FARE: The final fare must be given, at least 0, and never above the system''s fare (%); a reduction must be lower.', v_cur;
    END IF;

    -- the payment status that follows the decision
    v_pay := CASE
        WHEN v_d.kind = 'NON_PAYMENT' AND p_outcome = 'NON_PAYMENT_UPHELD' THEN 'Unpaid'
        WHEN v_d.kind = 'NON_PAYMENT' THEN 'Paid'
        WHEN p_outcome = 'FARE_WAIVED' THEN 'Waived'
        WHEN v_b.payment_status = 'Payment Disputed' THEN 'Paid'
        ELSE v_b.payment_status END;

    -- the strike (administrator-confirmed, never automatic), issued as the administrator
    IF p_strike_code IS NOT NULL THEN
        IF NOT ((v_d.kind = 'FARE_DISCREPANCY' AND p_strike_code IN ('DRV_OVERCHARGING', 'PAX_UNFOUNDED_DISPUTE'))
                OR (v_d.kind = 'NON_PAYMENT' AND p_strike_code = 'PAX_REFUSAL_TO_PAY' AND p_outcome = 'NON_PAYMENT_UPHELD')) THEN
            RAISE EXCEPTION 'ERR_STRIKE_NOT_FOR_THIS_DISPUTE: % does not fit this dispute (% / %).', p_strike_code, v_d.kind, p_outcome;
        END IF;
        IF p_strike_code = 'PAX_UNFOUNDED_DISPUTE' AND p_outcome <> 'FARE_CONFIRMED' THEN
            RAISE EXCEPTION 'ERR_STRIKE_NOT_FOR_THIS_DISPUTE: a dispute that changes the fare is not an unfounded dispute.';
        END IF;
        IF p_strike_code LIKE 'PAX\_%' AND NOT v_lgu THEN
            RAISE EXCEPTION 'ERR_LGU_ONLY_STRIKE: Only the LGU Administrator can confirm a passenger strike: escalate the dispute.';
        END IF;
        v_subject_type := CASE WHEN p_strike_code LIKE 'PAX\_%' THEN 'passenger' ELSE 'driver' END;
        v_subject_id := CASE WHEN v_subject_type = 'passenger' THEN v_b.passenger_id ELSE v_b.driver_id END;
        IF v_subject_id IS NULL THEN
            RAISE EXCEPTION 'ERR_STRIKE_SUBJECT: The booking has no % to strike.', v_subject_type;
        END IF;
        v_strike := public.issue_strike(v_subject_type, v_subject_id, p_strike_code, NULL, v_d.booking_id, NULL,
            'FARE_DISPUTE:' || p_dispute_id::TEXT || ':' || p_strike_code, NULL, btrim(p_reason), NULL,
            jsonb_build_object('dispute_id', p_dispute_id, 'outcome', p_outcome, 'rule', CASE p_strike_code WHEN 'DRV_OVERCHARGING' THEN 'Rule 18.5' WHEN 'PAX_REFUSAL_TO_PAY' THEN 'Rule 18.6' ELSE 'Rule 18.4' END));
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.booking
       SET actual_fare = v_final,
           payment_status = v_pay,
           payment_received_at = CASE WHEN v_pay = 'Paid' THEN COALESCE(payment_received_at, v_now) ELSE payment_received_at END,
           fare_unconfirmed = CASE WHEN v_pay = 'Paid' AND payment_received_at IS NULL THEN TRUE ELSE fare_unconfirmed END,
           fare_breakdown = CASE WHEN fare_breakdown IS NULL THEN NULL ELSE jsonb_set(fare_breakdown, '{resolution}',
               jsonb_build_object('source', 'fare_dispute', 'dispute_id', p_dispute_id, 'outcome', p_outcome, 'previous_fare', v_cur,
                                  'final_fare', v_final, 'resolved_by_role', v_role, 'resolved_at', v_now), TRUE) END
     WHERE booking_id = v_d.booking_id
     RETURNING * INTO v_b2;
    IF v_final IS DISTINCT FROM v_cur THEN
        INSERT INTO public.fare_adjustment_history (booking_id, reason_code, previous_fare, new_fare, details, actor_id, actor_role)
        VALUES (v_d.booking_id, 'DISPUTE_RESOLUTION', v_cur, v_final,
                jsonb_build_object('dispute_id', p_dispute_id, 'kind', v_d.kind, 'outcome', p_outcome, 'reason', btrim(p_reason)), auth.uid(), v_role);
    END IF;
    UPDATE public.fare_dispute
       SET status = 'Resolved', outcome = p_outcome, resolved_fare = v_final, resolution_note = btrim(p_reason),
           resolved_at = v_now, resolved_by = auth.uid(), resolved_by_role = v_role
     WHERE dispute_id = p_dispute_id;
    INSERT INTO public.fare_dispute_note (dispute_id, party, author_id, note) VALUES (p_dispute_id, v_role, auth.uid(), 'Decision ' || p_outcome || ': ' || btrim(p_reason));
    IF v_b.passenger_id IS NOT NULL THEN
        PERFORM public._notify_subject('passenger', v_b.passenger_id, 'FARE_DISPUTE_RESOLVED', 'Nasuri na ang pamasahe (Your fare review is complete)',
            'Decision: ' || replace(p_outcome, '_', ' ') || CASE WHEN v_final IS DISTINCT FROM v_cur THEN '. The fare is now PHP ' || v_final ELSE '' END || '. ' || btrim(p_reason), p_dispute_id::TEXT, 2);
    END IF;
    IF v_b.driver_id IS NOT NULL THEN
        PERFORM public._notify_subject('driver', v_b.driver_id, 'FARE_DISPUTE_RESOLVED', 'Nasuri na ang pamasahe (The fare review is complete)',
            'Decision: ' || replace(p_outcome, '_', ' ') || CASE WHEN v_final IS DISTINCT FROM v_cur THEN '. The fare is now PHP ' || v_final ELSE '' END || '. ' || btrim(p_reason), p_dispute_id::TEXT, 2);
    END IF;
    PERFORM public.record_policy_audit('FARE_DISPUTE_RESOLVED', p_dispute_id::TEXT, NULL, 'Fare Disputes',
        'The ' || replace(v_role, '_', ' ') || ' resolved the dispute: ' || p_outcome || '. ' || btrim(p_reason),
        jsonb_build_object('status', v_d.status, 'actual_fare', v_cur, 'payment_status', v_b.payment_status),
        jsonb_build_object('status', 'Resolved', 'outcome', p_outcome, 'actual_fare', v_final, 'payment_status', v_pay, 'booking_id', v_d.booking_id,
                           'strike', v_strike->>'strike_id', 'strike_code', p_strike_code));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'outcome', p_outcome, 'actual_fare', v_final, 'payment_status', v_pay, 'strike', v_strike);
END;
$$;

-- Rule 16.3: the audited correction of a Completed trip. The LGU Administrator only; the fare never above the system's, never a change of the
-- route, the times or the people; the reason is mandatory; the before and after are in audit_log and the fare in the ledger.
CREATE OR REPLACE FUNCTION public.admin_correct_completed_trip(p_booking_id UUID, p_new_fare NUMERIC, p_payment_status TEXT, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_b public.booking;
    v_b2 public.booking;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_now TIMESTAMPTZ := clock_timestamp();
    v_fare NUMERIC;
    v_pay TEXT;
BEGIN
    IF NOT COALESCE(public.is_lgu_admin(), FALSE) THEN
        RAISE EXCEPTION 'Access Denied: Only the LGU Administrator can correct a completed trip.';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
        RAISE EXCEPTION 'ERR_CORRECTION_REASON: Write the reason for the correction (at least 10 characters).';
    END IF;
    IF p_new_fare IS NULL AND p_payment_status IS NULL THEN
        RAISE EXCEPTION 'ERR_CORRECTION_EMPTY: Give a new fare, a payment status, or both.';
    END IF;
    IF p_payment_status IS NOT NULL AND p_payment_status NOT IN ('Unpaid', 'Paid', 'Payment Disputed', 'Waived') THEN
        RAISE EXCEPTION 'ERR_CORRECTION_PAYMENT: The payment status must be Unpaid, Paid, Payment Disputed or Waived.';
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND OR public._booking_phase(v_b.booking_status) <> 'completed' THEN
        RAISE EXCEPTION 'ERR_NOT_COMPLETED: Only a completed trip is corrected here.';
    END IF;
    v_fare := COALESCE(p_new_fare, v_b.actual_fare);
    IF v_fare < 0 OR v_fare > COALESCE(v_b.actual_fare, 0) THEN
        RAISE EXCEPTION 'ERR_CORRECTION_FARE: The fare must be at least 0 and never above the system''s fare (%).', v_b.actual_fare;
    END IF;
    v_pay := COALESCE(p_payment_status, CASE WHEN v_fare = 0 AND p_new_fare IS NOT NULL THEN 'Waived' ELSE v_b.payment_status END);
    IF v_fare IS NOT DISTINCT FROM v_b.actual_fare AND v_pay IS NOT DISTINCT FROM v_b.payment_status THEN
        RAISE EXCEPTION 'ERR_CORRECTION_EMPTY: Nothing would change.';
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.booking
       SET actual_fare = v_fare,
           payment_status = v_pay,
           payment_received_at = CASE WHEN v_pay = 'Paid' THEN COALESCE(payment_received_at, v_now) ELSE payment_received_at END,
           fare_unconfirmed = CASE WHEN v_pay = 'Paid' AND payment_received_at IS NULL AND confirm_fare_at IS NULL THEN TRUE ELSE fare_unconfirmed END,
           fare_breakdown = CASE WHEN fare_breakdown IS NULL THEN NULL ELSE jsonb_set(fare_breakdown, '{resolution}',
               jsonb_build_object('source', 'admin_correction', 'previous_fare', v_b.actual_fare, 'final_fare', v_fare, 'previous_payment_status', v_b.payment_status,
                                  'payment_status', v_pay, 'resolved_by_role', 'lgu_admin', 'resolved_at', v_now), TRUE) END
     WHERE booking_id = p_booking_id
     RETURNING * INTO v_b2;
    IF v_fare IS DISTINCT FROM v_b.actual_fare THEN
        INSERT INTO public.fare_adjustment_history (booking_id, reason_code, previous_fare, new_fare, details, actor_id, actor_role)
        VALUES (p_booking_id, 'ADMIN_CORRECTION', v_b.actual_fare, v_fare, jsonb_build_object('rule', '16.3', 'reason', btrim(p_reason)), auth.uid(), 'lgu_admin');
    END IF;
    PERFORM public.record_policy_audit('COMPLETED_TRIP_CORRECTED', p_booking_id::TEXT, NULL, 'Trip End',
        'The LGU Administrator corrected a completed trip (Rule 16.3): ' || btrim(p_reason),
        jsonb_build_object('actual_fare', v_b.actual_fare, 'payment_status', v_b.payment_status),
        jsonb_build_object('actual_fare', v_b2.actual_fare, 'payment_status', v_b2.payment_status, 'booking_id', p_booking_id));
    IF v_b.passenger_id IS NOT NULL THEN
        PERFORM public._notify_subject('passenger', v_b.passenger_id, 'TRIP_CORRECTED', 'Naitama ang talaan ng biyahe (Your trip record was corrected)',
            'An administrator corrected the fare or payment of a completed trip. ' || btrim(p_reason), p_booking_id::TEXT, 3);
    END IF;
    IF v_b.driver_id IS NOT NULL THEN
        PERFORM public._notify_subject('driver', v_b.driver_id, 'TRIP_CORRECTED', 'Naitama ang talaan ng biyahe (A trip record was corrected)',
            'An administrator corrected the fare or payment of a completed trip. ' || btrim(p_reason), p_booking_id::TEXT, 3);
    END IF;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'actual_fare', v_b2.actual_fare, 'payment_status', v_b2.payment_status);
END;
$$;

-- PI-15: a trip left at the destination (the driver never tapped Payment Received) is closed by the TODA Administrator of the driver after the stuck
-- time (30 minutes), or by the LGU Administrator at any time, after contacting the parties. Paid (the cash was received) or Waived (no fare).
CREATE OR REPLACE FUNCTION public.admin_close_unfinished_trip(p_booking_id UUID, p_payment_status TEXT, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_lgu BOOLEAN := COALESCE(public.is_lgu_admin(), FALSE);
    v_b public.booking;
    v_b2 public.booking;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_now TIMESTAMPTZ := clock_timestamp();
    v_role TEXT;
    v_flag public.admin_review_flag;
BEGIN
    IF NOT (v_lgu OR (COALESCE(public.is_toda_admin(), FALSE) AND public.rls_booking_in_my_toda(p_booking_id))) THEN
        RAISE EXCEPTION 'Access Denied: Only the TODA Administrator of this driver, or the LGU Administrator, can close this trip.';
    END IF;
    v_role := CASE WHEN v_lgu THEN 'lgu_admin' ELSE 'toda_admin' END;
    IF p_payment_status IS NULL OR p_payment_status NOT IN ('Paid', 'Waived') THEN
        RAISE EXCEPTION 'ERR_CLOSE_PAYMENT: Close the trip as Paid (the cash was received) or Waived (no fare).';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
        RAISE EXCEPTION 'ERR_CLOSE_REASON: Write how the outcome was confirmed (who was reached, and what they said): at least 10 characters.';
    END IF;
    SELECT * INTO v_b FROM public.booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND OR public._booking_phase(v_b.booking_status) <> 'at_destination' THEN
        RAISE EXCEPTION 'ERR_NOT_AT_DESTINATION: This trip is not waiting at the destination.';
    END IF;
    IF NOT v_lgu AND (v_b.fare_locked_at IS NULL OR v_b.fare_locked_at > v_now - make_interval(mins => public.dispatch_constant('payment_stuck_minutes'))) THEN
        RAISE EXCEPTION 'ERR_NOT_STUCK: The trip has been waiting for less than % minutes; the driver can still finish it.', public.dispatch_constant('payment_stuck_minutes');
    END IF;

    PERFORM set_config('sakay.internal_context', 'true', true);
    UPDATE public.booking
       SET booking_status = 'Completed',
           payment_status = p_payment_status,
           payment_received_at = CASE WHEN p_payment_status = 'Paid' THEN v_now ELSE payment_received_at END,
           fare_unconfirmed = CASE WHEN p_payment_status = 'Paid' AND confirm_fare_at IS NULL THEN TRUE ELSE fare_unconfirmed END,
           actual_fare = CASE WHEN p_payment_status = 'Waived' THEN 0 ELSE actual_fare END
     WHERE booking_id = p_booking_id
     RETURNING * INTO v_b2;
    IF p_payment_status = 'Waived' AND COALESCE(v_b.actual_fare, 0) <> 0 THEN
        INSERT INTO public.fare_adjustment_history (booking_id, reason_code, previous_fare, new_fare, details, actor_id, actor_role)
        VALUES (p_booking_id, 'ADMIN_CORRECTION', v_b.actual_fare, 0, jsonb_build_object('rule', 'PI-15', 'reason', btrim(p_reason)), auth.uid(), v_role);
    END IF;
    -- the review flag of the stuck trip (one open flag per driver: only the one that names this booking is resolved)
    SELECT * INTO v_flag FROM public.admin_review_flag
     WHERE flag_type = 'PAYMENT_STUCK_RECONCILIATION' AND subject_id = v_b.driver_id::TEXT AND status IN ('Open', 'Under Review')
       AND details ->> 'booking_id' = p_booking_id::TEXT;
    IF FOUND THEN
        PERFORM public.resolve_admin_review_flag(v_flag.flag_id, 'Resolved', 'Closed as ' || p_payment_status || ': ' || btrim(p_reason));
    END IF;
    IF v_b.passenger_id IS NOT NULL THEN
        PERFORM public._notify_subject('passenger', v_b.passenger_id, 'TRIP_CLOSED_BY_ADMIN', 'Isinara ng administrator ang biyahe (An administrator closed your trip)',
            'The trip was closed as ' || p_payment_status || ' after the parties were contacted. ' || btrim(p_reason), p_booking_id::TEXT, 4);
    END IF;
    PERFORM public._notify_subject('driver', v_b.driver_id, 'TRIP_CLOSED_BY_ADMIN', 'Isinara ng administrator ang biyahe (An administrator closed the trip)',
        'The trip was closed as ' || p_payment_status || ' after the parties were contacted. ' || btrim(p_reason), p_booking_id::TEXT, 4);
    PERFORM public.record_policy_audit('UNFINISHED_TRIP_CLOSED', p_booking_id::TEXT, NULL, 'Trip End',
        'The ' || replace(v_role, '_', ' ') || ' closed a trip left at the destination as ' || p_payment_status || ' (PI-15): ' || btrim(p_reason),
        jsonb_build_object('booking_status', v_b.booking_status, 'payment_status', v_b.payment_status, 'actual_fare', v_b.actual_fare),
        jsonb_build_object('booking_status', v_b2.booking_status, 'payment_status', v_b2.payment_status, 'actual_fare', v_b2.actual_fare, 'booking_id', p_booking_id));
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN jsonb_build_object('success', TRUE, 'payment_status', v_b2.payment_status, 'actual_fare', v_b2.actual_fare);
END;
$$;

-- Rules 13.6 / 13.7: the administrator confirms the violation a review flag points at. PASSENGER_EARLY_END_PATTERN -> PAX_FARE_AVOIDANCE (the LGU
-- Administrator), DRIVER_EARLY_STOP_REVIEW -> DRV_EARLY_STOP for the early stop of p_booking_id (the driver's TODA Administrator or the LGU
-- Administrator; never for a breakdown, a safety concern or an emergency). The strike is issued as the administrator; the flag is resolved with it.
-- Not confirming is the flag's ordinary resolution (resolve_admin_review_flag): no strike.
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
    ELSE
        RAISE EXCEPTION 'ERR_FLAG_NOT_CONFIRMABLE: A strike cannot be confirmed from a % flag.', v_f.flag_type;
    END IF;
    v_strike := public.issue_strike(v_type, v_subject, v_code, p_points, p_booking_id, NULL,
        'FLAG_VIOLATION:' || p_flag_id::TEXT || ':' || v_code || ':' || COALESCE(p_booking_id::TEXT, '-'), NULL, btrim(p_reason), NULL,
        jsonb_build_object('flag_id', p_flag_id, 'flag_type', v_f.flag_type, 'rule', v_f.source_rule));
    PERFORM public.resolve_admin_review_flag(p_flag_id, 'Resolved', 'Violation confirmed (' || v_code || '): ' || btrim(p_reason));
    RETURN jsonb_build_object('success', TRUE, 'strike', v_strike);
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. PI-15: A TRIP LEFT AT THE DESTINATION (called by dispatch_sweep every few seconds; cheap: one partial index)
-- ----------------------------------------------------------------------------
-- A trip that stays "Arrived at Destination" for payment_stuck_minutes without the driver's Payment Received is flagged ONCE for the TODA
-- Administrator of the driver (a dead phone, a driver who walked away). The passenger who confirmed or documented is already free to book
-- again (_passenger_open_booking_conflict); the administrator closes the trip with admin_close_unfinished_trip.
CREATE OR REPLACE FUNCTION public._booking_payment_sweep()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    r RECORD;
    v_b public.booking;
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_n INTEGER := 0;
    v_flag UUID;
BEGIN
    PERFORM set_config('sakay.internal_context', 'true', true);
    FOR r IN
        SELECT b.booking_id
          FROM public.booking b
         WHERE b.booking_status = 'Arrived at Destination'
           AND b.payment_stuck_flagged_at IS NULL
           AND b.fare_locked_at <= clock_timestamp() - make_interval(mins => public.dispatch_constant('payment_stuck_minutes'))
         ORDER BY b.fare_locked_at
         LIMIT public.dispatch_constant('sweep_batch_limit')
    LOOP
        BEGIN
            SELECT * INTO v_b FROM public.booking WHERE booking_id = r.booking_id AND booking_status = 'Arrived at Destination' AND payment_stuck_flagged_at IS NULL FOR UPDATE SKIP LOCKED;
            CONTINUE WHEN NOT FOUND OR v_b.driver_id IS NULL;
            v_flag := public._presence_flag('PAYMENT_STUCK_RECONCILIATION', v_b.driver_id, 'PI-15',
                jsonb_build_object('booking_id', v_b.booking_id, 'fare_locked_at', v_b.fare_locked_at, 'confirm_fare_at', v_b.confirm_fare_at,
                                   'fare_discrepancy_at', v_b.fare_discrepancy_at, 'actual_fare', v_b.actual_fare,
                                   'note', 'The trip has been at the destination for 30 minutes without the driver finishing it. Contact both parties, then close it (Paid or Waived).'));
            UPDATE public.booking SET payment_stuck_flagged_at = clock_timestamp() WHERE booking_id = v_b.booking_id;
            PERFORM public.record_policy_audit('PAYMENT_STUCK_FLAGGED', v_b.booking_id::TEXT, NULL, 'Trip End',
                'A trip stayed at the destination for ' || public.dispatch_constant('payment_stuck_minutes') || ' minutes without Payment Received (PI-15); it was flagged for reconciliation.', NULL,
                jsonb_build_object('booking_id', v_b.booking_id, 'flag_id', v_flag, 'driver_id', v_b.driver_id));
            v_n := v_n + 1;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'payment sweep: booking % could not be checked (%)', r.booking_id, SQLERRM;
        END;
    END LOOP;
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN v_n;
END;
$$;


-- ----------------------------------------------------------------------------
-- 11. TRIGGERS
-- ----------------------------------------------------------------------------
-- Named to run LAST ("zz_" sorts after every other booking trigger): the specific guards (the fare and route locks, the status guard, the identity guard) keep
-- giving their own, more precise errors; this one refuses whatever they let through on a completed trip.
DROP TRIGGER IF EXISTS trigger_booking_zz_completed_lock ON public.booking;
CREATE TRIGGER trigger_booking_zz_completed_lock BEFORE UPDATE OR DELETE ON public.booking
    FOR EACH ROW EXECUTE FUNCTION public.booking_completed_lock_guard();

-- Rule 13.6: counted when the early end is recorded (AFTER, so the row being written is part of the count)
DROP TRIGGER IF EXISTS trigger_booking_early_end_pattern ON public.booking;
CREATE TRIGGER trigger_booking_early_end_pattern AFTER UPDATE ON public.booking
    FOR EACH ROW WHEN (OLD.early_end_at IS NULL AND NEW.early_end_at IS NOT NULL)
    EXECUTE FUNCTION public.booking_early_end_pattern_trigger();

-- Rule 18.7
DROP TRIGGER IF EXISTS trigger_incident_change_refusal ON public.incident_report;
CREATE TRIGGER trigger_incident_change_refusal AFTER INSERT ON public.incident_report
    FOR EACH ROW WHEN (NEW.category = 'Change Refusal')
    EXECUTE FUNCTION public.incident_change_refusal_trigger();

-- ----------------------------------------------------------------------------
-- 12. PRIVILEGES (every new function has them set explicitly: no PUBLIC, no anon)
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._early_end_point(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._fare_dispute_open(public.booking, TEXT, TEXT, UUID, NUMERIC, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._check_early_end_pattern(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.booking_early_end_pattern_trigger() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.incident_change_refusal_trigger() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.booking_completed_lock_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._trip_end_error(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._fare_confirm_seconds_left(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._early_stop_reason_is_valid(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._booking_payment_sweep() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.passenger_request_early_end(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.passenger_withdraw_early_end(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.driver_stop_trip_early(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.passenger_confirm_fare(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.passenger_report_fare_discrepancy(UUID, NUMERIC, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_safety_fare_review(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.driver_confirm_payment_received(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.driver_report_non_payment(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.submit_fare_dispute_note(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_trip_end_state(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_fare_disputes(TEXT, INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.escalate_fare_dispute(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.resolve_fare_dispute(UUID, TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_correct_completed_trip(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_close_unfinished_trip(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_confirm_flagged_violation(UUID, UUID, TEXT, INTEGER) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.passenger_request_early_end(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.passenger_withdraw_early_end(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_stop_trip_early(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.passenger_confirm_fare(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.passenger_report_fare_discrepancy(UUID, NUMERIC, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_safety_fare_review(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_confirm_payment_received(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_report_non_payment(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_fare_dispute_note(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_trip_end_state(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_fare_disputes(TEXT, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.escalate_fare_dispute(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_fare_dispute(UUID, TEXT, NUMERIC, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_correct_completed_trip(UUID, NUMERIC, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_close_unfinished_trip(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_confirm_flagged_violation(UUID, UUID, TEXT, INTEGER) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 13. SELF-CHECK
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF public.dispatch_constant('completion_confirm_timeout_seconds') <> 120 OR public.dispatch_constant('trip_finish_min_progress_pct') <> 90
       OR public.dispatch_constant('trip_progress_near_destination_m') <> 80 OR public.dispatch_constant('offer_window_seconds') <> 15 THEN
        RAISE EXCEPTION 'dispatch_constant() lost an existing value';
    END IF;
    IF public.dispatch_constant('fare_dispute_toda_business_days') <> 2 OR public.dispatch_constant('fare_dispute_lgu_business_days') <> 3
       OR public.dispatch_constant('late_dispute_window_hours') <> 24 OR public.dispatch_constant('early_end_flag_count') <> 3
       OR public.dispatch_constant('early_end_flag_window_days') <> 30 OR public.dispatch_constant('payment_stuck_minutes') <> 30
       OR public.dispatch_constant('change_refusal_flag_count') <> 3 OR public.dispatch_constant('change_refusal_window_days') <> 30 THEN
        RAISE EXCEPTION 'dispatch_constant() does not return the Batch 9 values';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'booking' AND column_name = 'payment_status')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_booking_zz_completed_lock' AND NOT tgisinternal) THEN
        RAISE EXCEPTION 'The Batch 9 columns or the completed-trip lock are missing';
    END IF;
END $$;
