-- ============================================================================
-- Migration: 20261015000001_batch6_dispatch_foundation.sql
-- Batch 6 (Intelligent Driver Dispatch), part 1 of 4: the schema, the constants and the admin-editable settings.
--
-- Until now the passenger's PHONE ran the search for a driver (a browser loop): it inserted the offers, waited, timed them out and wrote
-- "No Driver Found". If the passenger closed the app, or the Book Ride screen never started the loop, nothing was ever offered. Batch 6
-- moves the whole search into the database. This part only adds what the engine (part 2) and the lifecycle rules (part 3) need.
--
--   dispatch_setting          the two values an LGU administrator may change at run time (offer window, Tier 3 maximum duration)
--   dispatch_constant(key)    every dispatch number in ONE place (spec section 21); mirrored in packages/shared/.../policyConfig.ts,
--                             and scripts/db-tests/batch6/config-drift.js fails if the two disagree
--   dispatch_tier3_radius_m() the live-search radius that applies N seconds into Tier 3
--   booking.dispatch_*        the state of the search for one booking (cycle, tier, the clocks, why it ended)
--   dispatch_attempt.*        what each offer records: cycle, tier, expiry, ETA, distance, the decline reason
--
-- Forward-only. Safe to run twice. Nothing here changes behaviour yet.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ADMIN-EDITABLE SETTINGS (Batch 6 prompt B4: the offer window and the Tier 3 maximum must be configurable)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dispatch_setting (
    setting_key   TEXT PRIMARY KEY,
    setting_value INTEGER NOT NULL,
    updated_by    UUID REFERENCES public.lgu_admin(admin_id) ON DELETE SET NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT dispatch_setting_key_check CHECK (setting_key IN ('offer_window_seconds', 'tier3_max_seconds'))
);

ALTER TABLE public.dispatch_setting ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dispatch_setting_select_lgu ON public.dispatch_setting;
CREATE POLICY dispatch_setting_select_lgu ON public.dispatch_setting
    FOR SELECT TO authenticated
    USING ((SELECT public.is_lgu_admin()));

-- All writes go through set_dispatch_setting() (part 3).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.dispatch_setting FROM anon, authenticated;
REVOKE SELECT ON public.dispatch_setting FROM anon;

-- ----------------------------------------------------------------------------
-- 2. THE CONSTANTS
-- ----------------------------------------------------------------------------
-- Dispatch AND the booking-lifecycle rules that feed it (cancellation, completion): one place for every number.
-- offer_window_seconds and tier3_max_seconds read dispatch_setting first and fall back to the value below.
--   offer_window_seconds   15    Rule 7.3 (initial pilot value, configurable)
--   tier3_max_seconds      300   figure F6.5. The specification says 600; 300 is applied for the pilot (decision D-DS-3, provisional)
CREATE OR REPLACE FUNCTION public.dispatch_constant(p_key TEXT)
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE p_key
        WHEN 'offer_window_seconds'      THEN COALESCE((SELECT s.setting_value FROM public.dispatch_setting s WHERE s.setting_key = 'offer_window_seconds'), 15)
        WHEN 'tier3_max_seconds'         THEN COALESCE((SELECT s.setting_value FROM public.dispatch_setting s WHERE s.setting_key = 'tier3_max_seconds'), 300)
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
        ELSE NULL
    END;
$$;

-- The live-search radius (metres) N seconds after Tier 3 began; NULL once the maximum duration has passed (spec s.6:
-- 2.0 km, 2.5 km from 1:30, 3.0 km from 3:00, 3.5 km from 4:30).
CREATE OR REPLACE FUNCTION public.dispatch_tier3_radius_m(p_elapsed_seconds DOUBLE PRECISION)
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE
        WHEN p_elapsed_seconds IS NULL OR p_elapsed_seconds < 0 THEN 2000
        WHEN p_elapsed_seconds >= public.dispatch_constant('tier3_max_seconds') THEN NULL
        WHEN p_elapsed_seconds >= 270 THEN 3500
        WHEN p_elapsed_seconds >= 180 THEN 3000
        WHEN p_elapsed_seconds >= 90  THEN 2500
        ELSE 2000
    END;
$$;

-- ----------------------------------------------------------------------------
-- 3. THE STATE OF A SEARCH (on the booking)
-- ----------------------------------------------------------------------------
-- A "cycle" is one dispatch cycle: it starts when the booking is made and again at every Retry (spec s.6, Rule 7.4). Which drivers were
-- already offered the booking is remembered per cycle, and only a Retry clears it.
ALTER TABLE public.booking
    ADD COLUMN IF NOT EXISTS dispatch_cycle                INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS dispatch_tier                 SMALLINT,
    ADD COLUMN IF NOT EXISTS dispatch_cycle_started_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS dispatch_tier_started_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS dispatch_pool_refreshed_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS dispatch_next_action_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS dispatch_reached_tier3_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS dispatch_ended_reason         TEXT,
    ADD COLUMN IF NOT EXISTS priority_toda_id              UUID REFERENCES public.toda(toda_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS accepted_driver_cancel_count  INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS accept_latitude               DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS accept_longitude              DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS stall_anchor_latitude         DOUBLE PRECISION,   -- Rules 8.2-8.4: where the driver was when he last moved 20 m or more
    ADD COLUMN IF NOT EXISTS stall_anchor_longitude        DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS stall_anchor_at               TIMESTAMPTZ,        -- ... and since when he has been standing there (= accepted_at until he first moves)
    ADD COLUMN IF NOT EXISTS stall_delay_reported_at       TIMESTAMPTZ,        -- Rule 8.4: the driver said "traffic" / "road closure" (restarts the 5 minutes)
    ADD COLUMN IF NOT EXISTS stall_delay_reports           SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS stall_warned_at               TIMESTAMPTZ,        -- Rule 8.2: the driver has been told he has not started
    ADD COLUMN IF NOT EXISTS driver_unreachable_since      TIMESTAMPTZ,        -- Rule 9.2: no location from the accepted driver (the passenger sees it)
    ADD COLUMN IF NOT EXISTS wait_extended_at              TIMESTAMPTZ;        -- Rule 10.3: the passenger used "I'm Almost There"

-- Rule 10.4: after a passenger no-show the driver's next offer, in the same Online session, is ranked ahead of otherwise-equal drivers
-- (decision PI-02 = A: single use, session scoped, only the FIRST tie-breaker after ETA; never a boost).
ALTER TABLE public.driver_online_session
    ADD COLUMN IF NOT EXISTS redispatch_credit BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.booking DROP CONSTRAINT IF EXISTS booking_dispatch_tier_check;
ALTER TABLE public.booking ADD CONSTRAINT booking_dispatch_tier_check
    CHECK (dispatch_tier IS NULL OR dispatch_tier IN (1, 2, 3));
ALTER TABLE public.booking DROP CONSTRAINT IF EXISTS booking_dispatch_ended_reason_check;
ALTER TABLE public.booking ADD CONSTRAINT booking_dispatch_ended_reason_check
    CHECK (dispatch_ended_reason IS NULL OR dispatch_ended_reason IN
           ('accepted', 'cancelled', 'no_driver_found', 'accepted_drivers_cancelled'));

COMMENT ON COLUMN public.booking.driver_unreachable_since IS 'Rule 9.2: since when no location update has reached the system from the accepted driver. Cleared when the driver is heard from again.';
COMMENT ON COLUMN public.booking.dispatch_cycle IS 'Dispatch cycle number: 1 at booking, +1 at every Retry. Offers of earlier cycles no longer exclude anyone.';
COMMENT ON COLUMN public.booking.dispatch_tier IS 'Tier the search is in: 1 Priority TODA / 600 m, 2 any TODA / 2 km, 3 live search. NULL when no search is running.';
COMMENT ON COLUMN public.booking.dispatch_next_action_at IS 'When the search next has to do something (an offer runs out, the pool is refreshed, the maximum time ends). The sweep acts on rows where this has passed.';
COMMENT ON COLUMN public.booking.dispatch_reached_tier3_at IS 'When the search first entered Tier 3 (Coverage Gap analysis, spec s.18). Never cleared by a Retry.';

-- The sweep looks for due searches, so index exactly those.
CREATE INDEX IF NOT EXISTS idx_booking_dispatch_due
    ON public.booking (dispatch_next_action_at)
    WHERE booking_status IN ('Pending', 'Searching Driver');

-- ----------------------------------------------------------------------------
-- 4. WHAT AN OFFER RECORDS (on the dispatch_attempt)
-- ----------------------------------------------------------------------------
-- The offer row is the auditable trail of the search (spec W12): which cycle, which tier, which driver, the ETA it was ranked by,
-- when it expires and how it ended.
ALTER TABLE public.dispatch_attempt
    ADD COLUMN IF NOT EXISTS cycle           INTEGER,
    ADD COLUMN IF NOT EXISTS tier            SMALLINT,
    ADD COLUMN IF NOT EXISTS expires_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS eta_seconds     INTEGER,
    ADD COLUMN IF NOT EXISTS eta_source      TEXT,
    ADD COLUMN IF NOT EXISTS distance_m      INTEGER,
    ADD COLUMN IF NOT EXISTS decline_reason  TEXT;

ALTER TABLE public.dispatch_attempt DROP CONSTRAINT IF EXISTS dispatch_attempt_decline_reason_check;
ALTER TABLE public.dispatch_attempt ADD CONSTRAINT dispatch_attempt_decline_reason_check
    CHECK (decline_reason IS NULL OR decline_reason IN
           ('vehicle_issue', 'personal_emergency', 'safety_concern', 'end_of_shift', 'other'));   -- Rule 7.9

CREATE INDEX IF NOT EXISTS idx_dispatch_attempt_booking_cycle ON public.dispatch_attempt (booking_id, cycle);
CREATE INDEX IF NOT EXISTS idx_dispatch_attempt_driver_pending ON public.dispatch_attempt (driver_id) WHERE response_status = 'Pending';

-- Offers reach the driver's phone by realtime as well as by the poll (the table was never in the publication).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime' AND puballtables)
       AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'dispatch_attempt') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.dispatch_attempt;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 5. PRIVILEGES AND SELF-CHECK
-- ----------------------------------------------------------------------------
-- Internal: the database functions read them (they run with their owner's rights); an app has no need to call them. The apps carry mirrors
-- (policyConfig.ts) and the LGU administrator reads the two editable values through get_dispatch_settings().
REVOKE EXECUTE ON FUNCTION public.dispatch_constant(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.dispatch_tier3_radius_m(DOUBLE PRECISION) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_constant(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.dispatch_tier3_radius_m(DOUBLE PRECISION) TO service_role;

DO $$
BEGIN
    IF public.dispatch_constant('tier1_radius_m') <> 600 OR public.dispatch_constant('tier2_radius_m') <> 2000
       OR public.dispatch_constant('offer_window_seconds') <> 15 THEN
        RAISE EXCEPTION 'dispatch_constant() does not return the specified values';
    END IF;
    IF public.dispatch_tier3_radius_m(0) <> 2000 OR public.dispatch_tier3_radius_m(90) <> 2500
       OR public.dispatch_tier3_radius_m(180) <> 3000 OR public.dispatch_tier3_radius_m(270) <> 3500
       OR public.dispatch_tier3_radius_m(public.dispatch_constant('tier3_max_seconds')) IS NOT NULL THEN
        RAISE EXCEPTION 'dispatch_tier3_radius_m() does not follow the specified schedule';
    END IF;
END $$;
