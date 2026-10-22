-- ============================================================================
-- SAKAY: RESET THE DATABASE FOR A DEMO  (one-off script, NOT a migration)
-- ============================================================================
-- Run it by hand in the Supabase SQL Editor (Dashboard > SQL Editor > paste > Run). It is a single DO block, so it is all-or-nothing:
-- if any check at the end fails, nothing is changed.
--
-- WHAT IT DOES
--   1. TRUNCATEs every table in the public schema (RESTART IDENTITY CASCADE) EXCEPT the keep list below.
--   2. Deletes every user in auth.users EXCEPT the LGU administrator login(s) in public.lgu_admin, so every registered phone number is free again
--      (public.passenger / driver / toda_admin rows are already gone; their auth.identities, sessions and refresh tokens go with the user).
--   3. Clears the phone number (and phone identity) from the auth users that are kept.
--   4. Writes one DEMO_DATABASE_RESET entry to the audit log.
--
-- WHAT IT KEEPS (edit v_keep to change). These are settings the migrations created; nothing in the apps can put them back, and without them the
-- system does not work (no fare, no service-area polygon, no strike catalogue, no dispatch settings, no ETA breaker row, no LGU login):
--   system_policy_config, service_area_config, violation_catalog, dispatch_setting, fare_matrix, osrm_eta_state, lgu_admin
-- To keep the accredited TODAs too, add 'toda' to v_keep (then only their drivers, admins and activity are wiped).
--
-- THE AUDIT LOG (Rule 28.4). public.audit_log is append-only on purpose: a BEFORE TRUNCATE trigger rejects the truncate "even for the service role".
-- This script switches that trigger off for the length of the truncate and switches it back on before it ends (it checks that it did). That is a
-- deliberate, owner-approved exception for a throw-away demo database. Do NOT run this against a database that holds real data.
--
-- NOT TOUCHED: files in Storage (documents, photos). Supabase blocks deleting storage.objects with SQL; empty the buckets in
-- Dashboard > Storage if you want them gone. Orphan files do not affect the demo. Cron jobs (pg_cron) and all functions, policies and triggers stay.
-- ============================================================================

DO $reset$
DECLARE
    v_keep      TEXT[] := ARRAY[
        'system_policy_config', 'service_area_config', 'violation_catalog', 'dispatch_setting', 'fare_matrix', 'osrm_eta_state',
        'lgu_admin'
    ];
    v_missing   TEXT;
    v_tables    TEXT;
    v_guards    RECORD;
    v_keep_name TEXT;
    v_before    BIGINT;
    v_after     BIGINT;
    v_users_before  BIGINT;
    v_users_deleted BIGINT;
    v_phones_left   BIGINT;
BEGIN
    -- 0. A typo in the keep list must stop the script, not silently wipe a settings table.
    SELECT string_agg(k, ', ') INTO v_missing
      FROM unnest(v_keep) AS k
     WHERE NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                        WHERE n.nspname = 'public' AND c.relname = k AND c.relkind IN ('r', 'p'));
    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'reset_for_demo: keep-list table(s) not found in public: %', v_missing;
    END IF;

    -- The kept tables' row counts, to prove at the end that CASCADE did not reach them.
    CREATE TEMP TABLE _reset_keep_counts (tbl TEXT PRIMARY KEY, n BIGINT) ON COMMIT DROP;
    FOREACH v_keep_name IN ARRAY v_keep LOOP
        EXECUTE format('INSERT INTO _reset_keep_counts SELECT %L, count(*) FROM public.%I', v_keep_name, v_keep_name);
    END LOOP;

    SELECT count(*) INTO v_users_before FROM auth.users;

    -- 1. The tables to wipe.
    SELECT string_agg(format('public.%I', c.relname), ', ' ORDER BY c.relname) INTO v_tables
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT (c.relname = ANY (v_keep));
    IF v_tables IS NULL THEN
        RAISE EXCEPTION 'reset_for_demo: nothing to truncate';
    END IF;

    -- 2. Switch off the BEFORE TRUNCATE guard triggers (the audit log's), remembering which ones, then truncate, then switch them back on.
    CREATE TEMP TABLE _reset_guards (tbl TEXT, trg TEXT) ON COMMIT DROP;
    INSERT INTO _reset_guards
    SELECT c.oid::regclass::TEXT, t.tgname
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND NOT t.tgisinternal AND (t.tgtype & 32) <> 0 AND t.tgenabled = 'O' AND NOT (c.relname = ANY (v_keep));
    FOR v_guards IN SELECT tbl, trg FROM _reset_guards LOOP
        EXECUTE format('ALTER TABLE %s DISABLE TRIGGER %I', v_guards.tbl, v_guards.trg);
    END LOOP;

    EXECUTE 'TRUNCATE TABLE ' || v_tables || ' RESTART IDENTITY CASCADE';

    FOR v_guards IN SELECT tbl, trg FROM _reset_guards LOOP
        EXECUTE format('ALTER TABLE %s ENABLE TRIGGER %I', v_guards.tbl, v_guards.trg);
    END LOOP;

    -- 3. Every auth user that is not an LGU administrator. This frees their phone numbers and synthetic e-mails for registering again.
    --    (Wiped before the per-user cascade so the cascade has nothing to do in the public schema.)
    DELETE FROM auth.users u
     WHERE NOT EXISTS (SELECT 1 FROM public.lgu_admin a WHERE a.auth_user_id = u.id);
    GET DIAGNOSTICS v_users_deleted = ROW_COUNT;

    -- 4. The kept (LGU) logins give up their phone number too.
    DELETE FROM auth.identities WHERE provider = 'phone';
    UPDATE auth.users SET phone = NULL, phone_confirmed_at = NULL WHERE phone IS NOT NULL;

    -- 5. Checks. Any failure raises, which undoes everything above.
    FOREACH v_keep_name IN ARRAY v_keep LOOP
        SELECT n INTO v_before FROM _reset_keep_counts WHERE tbl = v_keep_name;
        EXECUTE format('SELECT count(*) FROM public.%I', v_keep_name) INTO v_after;
        IF v_after <> v_before THEN
            RAISE EXCEPTION 'reset_for_demo: kept table % changed (% -> % rows); CASCADE reached it. Nothing was changed.', v_keep_name, v_before, v_after;
        END IF;
    END LOOP;

    SELECT count(*) INTO v_phones_left FROM auth.users WHERE phone IS NOT NULL;
    IF v_phones_left <> 0 THEN
        RAISE EXCEPTION 'reset_for_demo: % auth user(s) still hold a phone number', v_phones_left;
    END IF;

    IF EXISTS (SELECT 1 FROM _reset_guards g JOIN pg_trigger t ON t.tgname = g.trg AND t.tgrelid = g.tbl::regclass WHERE t.tgenabled <> 'O') THEN
        RAISE EXCEPTION 'reset_for_demo: a BEFORE TRUNCATE guard trigger was not switched back on';
    END IF;

    -- 6. One line in the (now empty) audit log, written with the guards back on.
    INSERT INTO public.audit_log (log_id, action_type, details)
    VALUES (gen_random_uuid(), 'DEMO_DATABASE_RESET',
            format('Database reset for a demo: %s public tables truncated, %s of %s auth users deleted, phone numbers released.',
                   (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT (c.relname = ANY (v_keep))),
                   v_users_deleted, v_users_before));

    RAISE NOTICE 'reset_for_demo: done. Truncated: %', v_tables;
    RAISE NOTICE 'reset_for_demo: auth users %, deleted %, kept % (LGU administrators)', v_users_before, v_users_deleted, v_users_before - v_users_deleted;
END
$reset$;

-- Afterwards, as a check (should return 0 phones, and one row per LGU login):
-- SELECT count(*) FILTER (WHERE phone IS NOT NULL) AS phones_left, count(*) AS users_left FROM auth.users;
-- SELECT action_type, details FROM public.audit_log;
