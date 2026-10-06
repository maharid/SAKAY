-- ============================================================================
-- Migration: 20261013000001_toda_driver_reminders.sql
-- Checklist (TODA Administrator > Manage Announcements): "Send reminders".
--
-- A TODA administrator can remind the verified drivers of their own TODA about something (a meeting, a renewal, a terminal rule)
-- or remind only the drivers whose Driver's License or MTOP has expired or expires within 30 days (Rule 24.1 / 24.4). Each driver
-- receives a notification (shown in the Driver app under Abiso).
--
-- A TODA administrator cannot write a driver's notification directly (only the server and database functions can), and must never be
-- able to write to the drivers of ANOTHER TODA, so this one function is the only way:
--   * the caller must be a TODA administrator; the TODA is theirs (never a parameter);
--   * recipients are drivers whose membership of THAT TODA is endorsed and approved and whose account is Verified;
--   * a reminder is a short text (title up to 80, message up to 500 characters), not a way to flood: a second send within 30 seconds
--     is refused (a double tap);
--   * every send is written to the audit log with the audience and the number of drivers.
-- Forward-only. Safe to run twice.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.send_toda_driver_reminder(p_audience TEXT, p_title TEXT, p_message TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_toda   UUID := public.get_current_toda_admin_toda_id();
    v_name   TEXT;
    v_title  TEXT := btrim(COALESCE(p_title, ''));
    v_msg    TEXT := btrim(COALESCE(p_message, ''));
    v_today  DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::DATE;
    v_sent   INTEGER;
BEGIN
    IF v_toda IS NULL OR NOT public.is_toda_admin() THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_NOT_TODA_ADMIN',
            'error', 'Only a TODA administrator can send a reminder to drivers.');
    END IF;
    IF p_audience IS NULL OR p_audience NOT IN ('ALL_DRIVERS', 'EXPIRING_DOCUMENTS') THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_REMINDER_AUDIENCE',
            'error', 'Choose who receives the reminder.');
    END IF;
    IF length(v_title) < 1 OR length(v_title) > 80 OR length(v_msg) < 1 OR length(v_msg) > 500 THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_REMINDER_TEXT',
            'error', 'The title must be 1 to 80 characters and the message 1 to 500 characters.');
    END IF;
    IF EXISTS (SELECT 1 FROM public.audit_log
                WHERE action_type = 'TODA_REMINDER_SENT' AND target_id = v_toda::TEXT
                  AND performed_at > CURRENT_TIMESTAMP - INTERVAL '30 seconds') THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ERR_REMINDER_TOO_SOON',
            'error', 'A reminder was just sent. Wait a few seconds before sending another.');
    END IF;

    SELECT t.toda_name INTO v_name FROM public.toda t WHERE t.toda_id = v_toda;

    WITH members AS (
        SELECT DISTINCT d.driver_id, d.license_expiry, d.mtop_expiry
          FROM public.driver_toda_affiliation a
          JOIN public.driver d ON d.driver_id = a.driver_id
         WHERE a.toda_id = v_toda
           AND a.toda_endorsement_status = 'Endorsed'
           AND a.lgu_verification_status = 'Approved'
           AND d.account_status = 'Verified'
    ), picked AS (
        SELECT driver_id FROM members
         WHERE p_audience = 'ALL_DRIVERS'
            OR (p_audience = 'EXPIRING_DOCUMENTS'
                AND ((license_expiry IS NOT NULL AND license_expiry <= v_today + 30)
                  OR (mtop_expiry IS NOT NULL AND mtop_expiry <= v_today + 30)))
    ), inserted AS (
        INSERT INTO public.notification (driver_id, title, message, notification_type, sent_at)
        SELECT driver_id, v_title, v_msg, 'TODA_REMINDER', CURRENT_TIMESTAMP FROM picked
        RETURNING 1
    )
    SELECT count(*)::INTEGER INTO v_sent FROM inserted;

    PERFORM public.record_policy_audit(
        'TODA_REMINDER_SENT', v_toda::TEXT, v_name, 'Announcement',
        'Sent a reminder to ' || v_sent || ' driver(s): ' || v_title, NULL,
        jsonb_build_object('audience', p_audience, 'sent', v_sent, 'title', v_title));

    RETURN jsonb_build_object('success', TRUE, 'sent', v_sent, 'audience', p_audience);
END;
$$;

REVOKE ALL ON FUNCTION public.send_toda_driver_reminder(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_toda_driver_reminder(TEXT, TEXT, TEXT) TO authenticated, service_role;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'send_toda_driver_reminder' AND pronamespace = 'public'::regnamespace) THEN
        RAISE EXCEPTION 'send_toda_driver_reminder is missing';
    END IF;
    IF has_function_privilege('anon', 'public.send_toda_driver_reminder(text,text,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'send_toda_driver_reminder must not be callable by anon';
    END IF;
END $$;
