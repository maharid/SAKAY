-- ============================================================================
-- Migration: 20261005000001_batch4_presence_foundation.sql
-- Batch 4 (Step 1): Driver availability, online sessions and inactivity.
--
--   Rules 3.1 / 3.10  one verified affiliation + unit selected before Online;
--                     selection cannot change while Online
--   Rule 5.5          Offline is always allowed unless an accepted booking is open
--   Rules 7.6 - 7.8   unanswered-offer streak -> reminder (3) -> auto Offline (5,
--                     no strike) -> TODA review flag (3 auto-Offlines in 30 days)
--   Rule 17.7         location permission is a precondition of being Online
--   Rule 29.7         offline-after-decline pattern -> monitoring flag, no strike
--   Rule 29.18        the verified vehicle cannot be swapped by the driver
--
-- Forward-only. Nothing from Batches 1-3 is edited; the one trigger function that
-- Batch 3 already replaced (check_driver_online_eligibility) is replaced again
-- with all earlier behaviour kept.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. POLICY CONSTANTS (code constants, mirrored in packages/shared/src/config/policyConfig.ts)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_presence_constant(p_key TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE p_key
        WHEN 'reminder_after_unanswered'     THEN 3     -- Rule 7.6
        WHEN 'auto_offline_after_unanswered' THEN 5     -- Rule 7.7 (3 + 2 more)
        WHEN 'review_window_days'            THEN 30    -- Rule 7.8
        WHEN 'review_auto_offline_count'     THEN 3     -- Rule 7.8
        WHEN 'offline_after_decline_seconds' THEN 60    -- Rule 29.7 ("immediately")
        WHEN 'offline_after_decline_count'   THEN 3     -- Rule 29.7
        WHEN 'heartbeat_stale_seconds'       THEN 300   -- presence sweep (approved extra, 5 min)
        WHEN 'location_max_accuracy_m'       THEN 100   -- F4.7: min accuracy to publish / dispatch
        WHEN 'location_max_age_seconds'      THEN 45    -- F4.6: max GPS age for dispatch
        ELSE NULL
    END;
$$;

-- ----------------------------------------------------------------------------
-- 2. COLUMNS
-- ----------------------------------------------------------------------------
ALTER TABLE public.driver
    ADD COLUMN IF NOT EXISTS last_location_accuracy_m DOUBLE PRECISION;

-- Distinguishes "the driver answered" from "the offer timed out". Both the
-- passenger dispatcher and the driver countdown record a timeout as 'Declined'
-- WITHOUT responded_at; an explicit decline or an accept carries responded_at.
ALTER TABLE public.dispatch_attempt
    ADD COLUMN IF NOT EXISTS unanswered BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- 3. ONLINE SESSION TABLE (one row per Online period; at most one open per driver)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.driver_online_session (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES public.driver(driver_id) ON DELETE CASCADE,
    login_session_id UUID,                       -- snapshot of driver.session_id (app login session)
    toda_id UUID,
    affiliation_id UUID,
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMPTZ,
    end_reason VARCHAR(40),
    unanswered_streak INTEGER NOT NULL DEFAULT 0,
    reminder_sent_at TIMESTAMPTZ,
    offline_pending_reason VARCHAR(40),          -- permission lost during an open booking
    offline_after_decline BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT driver_online_session_end_reason_check
        CHECK (end_reason IS NULL OR end_reason IN
               ('manual', 'auto_inactivity', 'location_permission_revoked', 'stale_heartbeat', 'system')),
    CONSTRAINT driver_online_session_closed_pair_check
        CHECK ((ended_at IS NULL) = (end_reason IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_driver_online_session_open
    ON public.driver_online_session (driver_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_driver_online_session_driver_ended
    ON public.driver_online_session (driver_id, ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_online_session_auto_offline
    ON public.driver_online_session (driver_id, ended_at) WHERE end_reason = 'auto_inactivity';
CREATE INDEX IF NOT EXISTS idx_driver_online_session_stale
    ON public.driver_online_session (last_heartbeat_at) WHERE ended_at IS NULL;

ALTER TABLE public.driver_online_session ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "driver_online_session_select" ON public.driver_online_session;
CREATE POLICY "driver_online_session_select" ON public.driver_online_session
    FOR SELECT TO authenticated
    USING (
        driver_id = public.get_current_driver_id()
        OR public.is_lgu_admin()
        OR (public.is_toda_admin() AND toda_id = public.get_current_toda_admin_toda_id())
    );

-- All writes go through the functions below.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.driver_online_session FROM anon, authenticated;
REVOKE SELECT ON public.driver_online_session FROM anon;

-- ----------------------------------------------------------------------------
-- 4. HELPERS
-- ----------------------------------------------------------------------------

-- True only inside the presence RPCs (go online / go offline / heartbeat / sweep).
CREATE OR REPLACE FUNCTION public._in_presence_context()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(current_setting('sakay.presence_context', true), '') = 'true';
$$;

-- Statuses a booking has while a driver is committed to it (accepted and not yet
-- finished). Rule 5.5 / Section 9. The app writes several spellings; all are listed.
CREATE OR REPLACE FUNCTION public._booking_is_open_accepted(p_status TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT p_status IN (
        'Accepted', 'Assigned', 'Driver Assigned', 'Driver En Route', 'Heading to Passenger',
        'Driver Arrived', 'Arrived at Pickup', 'In Transit', 'Trip Ongoing', 'Ongoing',
        'Arrived at Destination'
    );
$$;

CREATE OR REPLACE FUNCTION public.driver_has_open_accepted_booking(p_driver_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.booking b
        WHERE b.driver_id = p_driver_id
          AND public._booking_is_open_accepted(b.booking_status)
    );
$$;

-- For the dispatcher (Batch 6): is the driver's last published fix good enough to
-- receive offers? Fresh (F4.6) and accurate (F4.7).
CREATE OR REPLACE FUNCTION public.driver_has_fresh_location(p_driver_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.driver d
        WHERE d.driver_id = p_driver_id
          AND d.current_latitude IS NOT NULL AND d.current_longitude IS NOT NULL
          AND d.last_location_update >= CURRENT_TIMESTAMP - make_interval(secs => public.driver_presence_constant('location_max_age_seconds'))
          AND d.last_location_accuracy_m IS NOT NULL
          AND d.last_location_accuracy_m <= public.driver_presence_constant('location_max_accuracy_m')
    );
$$;

-- Create a review flag from inside an engine function (the flag function only
-- accepts service / internal callers or administrators).
CREATE OR REPLACE FUNCTION public._presence_flag(
    p_flag_type TEXT, p_driver_id UUID, p_rule TEXT, p_details JSONB
)
RETURNS UUID AS $$
DECLARE
    v_prev TEXT := current_setting('sakay.internal_context', true);
    v_toda UUID;
    v_id UUID;
BEGIN
    SELECT toda_id INTO v_toda FROM public.driver WHERE driver_id = p_driver_id;
    PERFORM set_config('sakay.internal_context', 'true', true);
    v_id := public.create_admin_review_flag(
        p_flag_type, 'driver', p_driver_id::TEXT, p_rule,
        CASE WHEN v_toda IS NULL THEN 'lgu_admin' ELSE 'toda_admin' END,
        p_details
    );
    PERFORM set_config('sakay.internal_context', COALESCE(v_prev, ''), true);
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Put a driver Offline from inside the engine, recording why. No strike (7.7).
CREATE OR REPLACE FUNCTION public._presence_set_offline(p_driver_id UUID, p_reason TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    v_prev_p TEXT := current_setting('sakay.presence_context', true);
    v_prev_r TEXT := current_setting('sakay.offline_reason', true);
    v_rows INTEGER;
BEGIN
    PERFORM set_config('sakay.presence_context', 'true', true);
    PERFORM set_config('sakay.offline_reason', p_reason, true);
    UPDATE public.driver SET availability_status = 'Offline'
    WHERE driver_id = p_driver_id AND availability_status <> 'Offline';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    PERFORM set_config('sakay.presence_context', COALESCE(v_prev_p, ''), true);
    PERFORM set_config('sakay.offline_reason', COALESCE(v_prev_r, ''), true);
    RETURN v_rows > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 5. ONLINE / OFFLINE GUARD (extends the Batch 1 + Batch 3 trigger function)
-- ----------------------------------------------------------------------------
-- Kept from Batch 3, in the same order: suspension / deactivation, Verified,
-- documentary restriction, and the Busy -> Available forced-Offline rule.
-- Added: (a) a driver cannot flip to Available / Busy with a direct write; that
-- must go through driver_go_online() so every precondition is checked once;
-- (b) Rule 5.5: a driver cannot go Offline with an open accepted booking.
CREATE OR REPLACE FUNCTION public.check_driver_online_eligibility()
RETURNS TRIGGER AS $$
DECLARE
    v_res JSONB;
    v_state JSONB;
    v_requested TEXT := NEW.availability_status;   -- before the forced-Offline conversion below
BEGIN
    IF (OLD.availability_status = 'Offline' AND NEW.availability_status IN ('Available', 'Busy')) THEN
        v_state := public.account_restriction_state('driver', NEW.driver_id);
        IF COALESCE((v_state->>'restricted')::BOOLEAN, FALSE) THEN
            RAISE EXCEPTION '%', public._restriction_message(v_state) USING ERRCODE = 'P0001';
        END IF;

        IF NEW.account_status != 'Verified' THEN
            RAISE EXCEPTION 'ERR_DRIVER_NOT_VERIFIED: Hindi maaaring mag-online hangga''t hindi ganap na aprubado ng LGU ang account (Driver must be Verified by LGU before going online).';
        END IF;

        v_res := public.is_driver_documentarily_restricted(NEW.driver_id);
        IF (v_res->>'is_restricted')::BOOLEAN = TRUE THEN
            RAISE EXCEPTION 'ERR_DOCUMENT_EXPIRED: Hindi maaaring mag-online dahil sa expired o kulang na dokumento: %', v_res->>'reasons';
        END IF;

        IF NOT (public.is_service_context() OR public._in_presence_context()) THEN
            RAISE EXCEPTION 'ERR_USE_GO_ONLINE: Gamitin ang Go Online button para mag-online (Going online must go through driver_go_online()).';
        END IF;
    END IF;

    IF (OLD.availability_status = 'Busy' AND NEW.availability_status = 'Available') THEN
        v_state := public.account_restriction_state('driver', NEW.driver_id);
        v_res := public.is_driver_documentarily_restricted(NEW.driver_id);
        IF COALESCE((v_state->>'restricted')::BOOLEAN, FALSE) OR (v_res->>'is_restricted')::BOOLEAN = TRUE THEN
            NEW.availability_status := 'Offline';
        END IF;
    END IF;

    IF (OLD.availability_status <> 'Offline' AND v_requested = 'Offline')
       AND NOT (public.is_service_context() OR public._in_presence_context()) THEN
        IF public.driver_has_open_accepted_booking(NEW.driver_id) THEN
            RAISE EXCEPTION 'ERR_OPEN_BOOKING: Hindi ka maaaring mag-Offline habang may bukas na tinanggap na booking. Tapusin o ipaalam muna ang booking. (You cannot go Offline while you have an open accepted booking.)';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 6. SESSION BOOKKEEPING (single place that keeps sessions consistent with status)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_driver_online_session()
RETURNS TRIGGER AS $$
DECLARE
    v_session public.driver_online_session;
    v_reason TEXT;
    v_declined BOOLEAN;
    v_aff UUID;
    v_count INTEGER;
BEGIN
    -- Offline -> Available / Busy: open a session.
    IF OLD.availability_status = 'Offline' AND NEW.availability_status <> 'Offline' THEN
        SELECT affiliation_id INTO v_aff
        FROM public.driver_toda_affiliation
        WHERE driver_id = NEW.driver_id AND is_active_selection = TRUE
        LIMIT 1;

        INSERT INTO public.driver_online_session (driver_id, login_session_id, toda_id, affiliation_id)
        VALUES (NEW.driver_id, NEW.session_id, NEW.toda_id, v_aff)
        ON CONFLICT (driver_id) WHERE ended_at IS NULL DO NOTHING;
        RETURN NEW;
    END IF;

    -- Available / Busy -> Offline: close the session and record why.
    IF OLD.availability_status <> 'Offline' AND NEW.availability_status = 'Offline' THEN
        v_reason := NULLIF(current_setting('sakay.offline_reason', true), '');
        IF v_reason IS NULL THEN
            v_reason := CASE WHEN public.is_service_context() THEN 'system' ELSE 'manual' END;
        END IF;

        -- Rule 29.7: a decline / lost offer in THIS session within the last 60 s.
        SELECT * INTO v_session FROM public.driver_online_session
        WHERE driver_id = NEW.driver_id AND ended_at IS NULL;
        v_declined := v_reason = 'manual' AND v_session.session_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.dispatch_attempt a
            WHERE a.driver_id = NEW.driver_id
              AND a.response_status IN ('Declined', 'Expired')
              AND a.resolved_at >= v_session.started_at
              AND a.resolved_at >= CURRENT_TIMESTAMP - make_interval(secs => public.driver_presence_constant('offline_after_decline_seconds'))
        );

        UPDATE public.driver_online_session
        SET ended_at = CURRENT_TIMESTAMP,
            end_reason = v_reason,
            offline_pending_reason = NULL,
            offline_after_decline = v_declined
        WHERE driver_id = NEW.driver_id AND ended_at IS NULL
        RETURNING * INTO v_session;

        IF v_session.session_id IS NULL THEN
            RETURN NEW;
        END IF;

        PERFORM public.record_policy_audit(
            'DRIVER_WENT_OFFLINE', NEW.driver_id::TEXT, NEW.full_name, 'Driver Presence',
            'Driver went Offline (' || v_reason || ').', NULL,
            jsonb_build_object('session_id', v_session.session_id, 'reason', v_reason, 'offline_after_decline', v_declined)
        );

        -- Rule 29.7: pattern repeats 3+ times in one app login session -> monitoring flag only.
        IF v_declined THEN
            SELECT count(*) INTO v_count
            FROM public.driver_online_session s
            WHERE s.driver_id = NEW.driver_id
              AND s.offline_after_decline
              AND s.login_session_id IS NOT DISTINCT FROM v_session.login_session_id;
            IF v_count >= public.driver_presence_constant('offline_after_decline_count') THEN
                PERFORM public._presence_flag(
                    'DRIVER_AVAILABILITY_MONITORING', NEW.driver_id, 'Rule 29.7',
                    jsonb_build_object('pattern', 'offline_after_decline', 'count_in_login_session', v_count,
                                       'last_session_id', v_session.session_id,
                                       'note', 'Monitoring flag only. No strike is applied (Rule 29.7).')
                );
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trigger_sync_driver_online_session ON public.driver;
CREATE TRIGGER trigger_sync_driver_online_session
    AFTER UPDATE OF availability_status ON public.driver
    FOR EACH ROW
    WHEN (OLD.availability_status IS DISTINCT FROM NEW.availability_status)
    EXECUTE FUNCTION public.sync_driver_online_session();

-- Existing rows: any driver already Online gets an open session (with a full
-- heartbeat grace period) so the invariant "Online => open session" holds.
INSERT INTO public.driver_online_session (driver_id, login_session_id, toda_id, affiliation_id)
SELECT d.driver_id, d.session_id, d.toda_id,
       (SELECT a.affiliation_id FROM public.driver_toda_affiliation a
        WHERE a.driver_id = d.driver_id AND a.is_active_selection = TRUE LIMIT 1)
FROM public.driver d
WHERE d.availability_status <> 'Offline'
ON CONFLICT (driver_id) WHERE ended_at IS NULL DO NOTHING;

-- ----------------------------------------------------------------------------
-- 7. OFFERS: unanswered detection and the 7.6 / 7.7 / 7.8 counters
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.classify_dispatch_attempt_response()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.response_status = 'Pending' AND NEW.response_status IS DISTINCT FROM 'Pending' THEN
        -- Every caller (driver, passenger dispatcher, server): classify the same way.
        NEW.resolved_at := CURRENT_TIMESTAMP;
        -- Accepted, or an explicit decline that carries responded_at, is an answer.
        NEW.unanswered := NEW.response_status IN ('Declined', 'Expired') AND NEW.responded_at IS NULL;
        IF NEW.responded_at IS NOT NULL THEN
            NEW.responded_at := CURRENT_TIMESTAMP;   -- server clock, not the device clock
        END IF;
    ELSIF NOT public.is_service_context() THEN
        -- Not a transition out of Pending: clients cannot write these columns.
        NEW.unanswered := OLD.unanswered;
        NEW.resolved_at := OLD.resolved_at;
        NEW.responded_at := OLD.responded_at;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trigger_classify_dispatch_attempt_response ON public.dispatch_attempt;
CREATE TRIGGER trigger_classify_dispatch_attempt_response
    BEFORE UPDATE ON public.dispatch_attempt
    FOR EACH ROW
    EXECUTE FUNCTION public.classify_dispatch_attempt_response();

CREATE OR REPLACE FUNCTION public.track_driver_offer_response()
RETURNS TRIGGER AS $$
DECLARE
    v_session public.driver_online_session;
    v_streak INTEGER;
    v_auto INTEGER;
    v_count INTEGER;
    v_name TEXT;
    v_toda UUID;
BEGIN
    SELECT * INTO v_session FROM public.driver_online_session
    WHERE driver_id = NEW.driver_id AND ended_at IS NULL FOR UPDATE;
    IF v_session.session_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- The offer was withdrawn by the system (the booking was cancelled or completed while it was pending):
    -- the driver neither answered nor ignored it, so the run is left exactly as it was.
    IF NEW.response_status = 'Expired' AND NOT NEW.unanswered THEN
        RETURN NEW;
    END IF;

    -- An accept or an explicit decline ends the "consecutive unanswered" run (PI-B4-3).
    IF NOT NEW.unanswered THEN
        IF v_session.unanswered_streak <> 0 OR v_session.reminder_sent_at IS NOT NULL THEN
            UPDATE public.driver_online_session
            SET unanswered_streak = 0, reminder_sent_at = NULL
            WHERE session_id = v_session.session_id;
        END IF;
        RETURN NEW;
    END IF;

    v_streak := v_session.unanswered_streak + 1;
    UPDATE public.driver_online_session SET unanswered_streak = v_streak
    WHERE session_id = v_session.session_id;

    -- Rule 7.6: reminder after the 3rd consecutive unanswered offer.
    IF v_streak >= public.driver_presence_constant('reminder_after_unanswered')
       AND v_session.reminder_sent_at IS NULL THEN
        UPDATE public.driver_online_session SET reminder_sent_at = CURRENT_TIMESTAMP
        WHERE session_id = v_session.session_id;
        INSERT INTO public.notification (
            recipient_id, subject_id, driver_id, title, message, notification_type, threshold_days, sent_at
        ) VALUES (
            NEW.driver_id::TEXT, v_session.session_id::TEXT, NEW.driver_id,
            'Mukhang wala ka sa iyong device (You appear to be unavailable)',
            'You appear to be unavailable. Please switch to Offline if you are no longer accepting bookings. '
            || '(Mukhang hindi ka available. Paki-switch sa Offline kung hindi ka na tumatanggap ng booking.)',
            'DRIVER_INACTIVITY_REMINDER', 0, CURRENT_TIMESTAMP
        ) ON CONFLICT (recipient_id, notification_type, subject_id, threshold_days) DO NOTHING;
    END IF;

    -- Rule 7.7: automatic Offline at the 5th consecutive unanswered offer. No strike.
    IF v_streak >= public.driver_presence_constant('auto_offline_after_unanswered')
       AND NOT public.driver_has_open_accepted_booking(NEW.driver_id) THEN
        IF public._presence_set_offline(NEW.driver_id, 'auto_inactivity') THEN
            SELECT full_name, toda_id INTO v_name, v_toda FROM public.driver WHERE driver_id = NEW.driver_id;
            PERFORM public.record_policy_audit(
                'DRIVER_AUTO_OFFLINE_INACTIVITY', NEW.driver_id::TEXT, v_name, 'Driver Presence',
                'Driver automatically set Offline after ' || v_streak || ' consecutive unanswered booking offers (Rule 7.7). No strike applied.',
                NULL, jsonb_build_object('session_id', v_session.session_id, 'unanswered_streak', v_streak)
            );
            INSERT INTO public.notification (
                recipient_id, subject_id, driver_id, title, message, notification_type, threshold_days, sent_at
            ) VALUES (
                NEW.driver_id::TEXT, v_session.session_id::TEXT, NEW.driver_id,
                'Awtomatikong na-Offline ka (You were set to Offline)',
                'You did not respond to several booking offers, so your status was set to Offline. No strike was applied. '
                || '(Hindi ka tumugon sa ilang booking offer, kaya inilagay ka sa Offline. Walang strike.)',
                'DRIVER_AUTO_OFFLINE', 0, CURRENT_TIMESTAMP
            ) ON CONFLICT (recipient_id, notification_type, subject_id, threshold_days) DO NOTHING;

            -- Rule 7.8: 3 or more automatic Offlines in a rolling 30 days -> TODA review flag, no strike.
            SELECT count(*) INTO v_auto FROM public.driver_online_session
            WHERE driver_id = NEW.driver_id AND end_reason = 'auto_inactivity'
              AND ended_at > CURRENT_TIMESTAMP - make_interval(days => public.driver_presence_constant('review_window_days'));
            IF v_auto >= public.driver_presence_constant('review_auto_offline_count') THEN
                PERFORM public._presence_flag(
                    'DRIVER_INACTIVITY_REVIEW', NEW.driver_id, 'Rule 7.8',
                    jsonb_build_object('auto_offline_count_30d', v_auto,
                                       'note', 'Review whether the driver is intentionally staying available while ignoring requests. No strike is applied automatically (Rule 7.8).')
                );
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trigger_track_driver_offer_response ON public.dispatch_attempt;
CREATE TRIGGER trigger_track_driver_offer_response
    AFTER UPDATE OF response_status ON public.dispatch_attempt
    FOR EACH ROW
    WHEN (OLD.response_status = 'Pending' AND NEW.response_status IS DISTINCT FROM 'Pending')
    EXECUTE FUNCTION public.track_driver_offer_response();

-- ----------------------------------------------------------------------------
-- 8. PENDING OFFLINE: permission lost while a booking was open (PI-B4-2)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_pending_driver_offline()
RETURNS TRIGGER AS $$
DECLARE
    v_reason TEXT;
BEGIN
    IF NEW.driver_id IS NULL OR public.driver_has_open_accepted_booking(NEW.driver_id) THEN
        RETURN NEW;
    END IF;
    SELECT offline_pending_reason INTO v_reason FROM public.driver_online_session
    WHERE driver_id = NEW.driver_id AND ended_at IS NULL;
    IF v_reason IS NOT NULL THEN
        PERFORM public._presence_set_offline(NEW.driver_id, v_reason);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trigger_apply_pending_driver_offline ON public.booking;
CREATE TRIGGER trigger_apply_pending_driver_offline
    AFTER UPDATE OF booking_status ON public.booking
    FOR EACH ROW
    WHEN (public._booking_is_open_accepted(OLD.booking_status) AND NOT public._booking_is_open_accepted(NEW.booking_status))
    EXECUTE FUNCTION public.apply_pending_driver_offline();

-- ----------------------------------------------------------------------------
-- 9. VEHICLE LOCK (Rules 3.10, 29.18): one verified unit, no self-service swap
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_verified_vehicle()
RETURNS TRIGGER AS $$
BEGIN
    IF (NEW.plate_number IS DISTINCT FROM OLD.plate_number OR NEW.franchise_number IS DISTINCT FROM OLD.franchise_number)
       AND OLD.account_status IN ('Verified', 'Suspended', 'Deactivated')
       AND NOT (public.is_service_context() OR public.is_lgu_admin()) THEN
        RAISE EXCEPTION 'ERR_VEHICLE_LOCKED: Hindi na mababago ang plate at franchise number ng beripikadong sasakyan. Makipag-ugnayan sa TODA at LGU para sa pagpapalit. (The verified vehicle cannot be changed by the driver; substitution needs TODA and LGU approval.)';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trigger_protect_verified_vehicle ON public.driver;
CREATE TRIGGER trigger_protect_verified_vehicle
    BEFORE UPDATE OF plate_number, franchise_number ON public.driver
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_verified_vehicle();

-- ----------------------------------------------------------------------------
-- 10. PRIVILEGES
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._in_presence_context() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._presence_flag(TEXT, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._presence_set_offline(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_driver_online_session() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.classify_dispatch_attempt_response() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.track_driver_offer_response() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_pending_driver_offline() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_verified_vehicle() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.driver_has_open_accepted_booking(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.driver_has_fresh_location(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_has_open_accepted_booking(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_has_fresh_location(UUID) TO authenticated, service_role;
