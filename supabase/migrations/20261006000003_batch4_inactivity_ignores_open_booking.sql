-- ============================================================================
-- Migration: 20261006000003_batch4_inactivity_ignores_open_booking.sql
-- Batch 4 fix (Rules 7.6 / 7.7): offers that go unanswered while the driver is ON A BOOKING are not inactivity.
--
-- Found in manual test T5: a driver who had accepted a booking (and was mid-trip) kept receiving offers; each
-- ignored offer still raised the unanswered streak (it reached 8) and fired "You appear to be unavailable".
-- A driver carrying a passenger is not unavailable, and Rule 7.6 counts offers ignored "without accepting any
-- booking". The auto-Offline was (correctly) never applied during a booking, but the streak kept climbing, so the
-- first ignored offer after the trip would have switched the driver Offline at once.
--
-- Change: while the driver has an open accepted booking, an unanswered offer changes nothing (no streak, no
-- reminder). Everything else is exactly the earlier behaviour. Same function name and signature, so the existing
-- trigger keeps using it. Forward-only.
-- ============================================================================

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

    -- NEW: a driver who is on an accepted booking is busy, not unavailable. An ignored offer now is not inactivity.
    IF public.driver_has_open_accepted_booking(NEW.driver_id) THEN
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
    IF v_streak >= public.driver_presence_constant('auto_offline_after_unanswered') THEN
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

REVOKE EXECUTE ON FUNCTION public.track_driver_offer_response() FROM PUBLIC, anon, authenticated;
