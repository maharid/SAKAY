-- ============================================================================
-- SAKAY - WHERE DOES THIS MOBILE NUMBER STILL EXIST?   (READ-ONLY: SELECT statements only, nothing is changed)
-- Run in the Supabase SQL editor. Run each numbered block on its own (select it, then Run) and read the result.
--
-- Why: registration answers "mobile number already registered" from the SIGN-UP itself, not from public.driver. The apps create a
-- login with the e-mail alias   driver_63<9XXXXXXXXX>@sakay.ph   (passenger: passenger_63...@sakay.ph). Clearing public.driver
-- does not remove that login, and a login that exists blocks the same alias for ever. Block 1 shows it.
--
-- HOW TO USE: replace 9XXXXXXXXX in the line that says  '9XXXXXXXXX'  (the last ten digits of the number, starting with 9) in
-- EVERY block below. The match ignores spaces, dashes and the +63 / 63 / 0 prefix, so one value finds every spelling.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- BLOCK 1.  auth.users - the logins. Look at: email, phone, deleted_at (a soft-deleted user still holds its e-mail),
--           has_driver_row / has_passenger_row (false for both = an ORPHAN login, the usual cause), is_*_admin (never touch those).
-- ----------------------------------------------------------------------------
WITH params AS (
    SELECT regexp_replace('9XXXXXXXXX', '(\d)', '\1[ .()-]*', 'g') AS rx
)
SELECT u.id,
       u.email,
       u.phone,
       u.created_at,
       u.last_sign_in_at,
       u.email_confirmed_at IS NOT NULL AS email_confirmed,
       u.deleted_at,
       u.banned_until,
       u.raw_user_meta_data ->> 'role'  AS meta_role,
       EXISTS (SELECT 1 FROM public.driver     d WHERE d.auth_user_id = u.id) AS has_driver_row,
       EXISTS (SELECT 1 FROM public.passenger  p WHERE p.auth_user_id = u.id) AS has_passenger_row,
       EXISTS (SELECT 1 FROM public.toda_admin t WHERE t.auth_user_id = u.id) AS is_toda_admin,
       EXISTS (SELECT 1 FROM public.lgu_admin  l WHERE l.auth_user_id = u.id) AS is_lgu_admin,
       CASE WHEN u.email ~ params.rx THEN 'email ' ELSE '' END
    || CASE WHEN u.phone ~ params.rx THEN 'phone ' ELSE '' END
    || CASE WHEN u.raw_user_meta_data::TEXT ~ params.rx THEN 'raw_user_meta_data ' ELSE '' END
    || CASE WHEN u.raw_app_meta_data::TEXT  ~ params.rx THEN 'raw_app_meta_data'  ELSE '' END AS matched_in
  FROM auth.users u, params
 WHERE u.email ~ params.rx
    OR u.phone ~ params.rx
    OR u.raw_user_meta_data::TEXT ~ params.rx
    OR u.raw_app_meta_data::TEXT ~ params.rx
 ORDER BY u.created_at;


-- ----------------------------------------------------------------------------
-- BLOCK 2.  auth.identities - the login methods attached to a user (identity_data holds the e-mail / phone copy).
-- ----------------------------------------------------------------------------
WITH params AS (
    SELECT regexp_replace('9XXXXXXXXX', '(\d)', '\1[ .()-]*', 'g') AS rx
)
SELECT i.id,
       i.user_id,
       i.provider,
       i.provider_id,
       i.identity_data ->> 'email' AS identity_email,
       i.identity_data ->> 'phone' AS identity_phone,
       i.created_at,
       EXISTS (SELECT 1 FROM auth.users u WHERE u.id = i.user_id) AS user_exists
  FROM auth.identities i, params
 WHERE i.identity_data::TEXT ~ params.rx
    OR i.provider_id ~ params.rx
 ORDER BY i.created_at;


-- ----------------------------------------------------------------------------
-- BLOCK 3.  public.* - every text / varchar / char / json / jsonb / array column of every table, scanned for the number.
--           Only columns with at least one match are listed; inspect_sql is a ready-made SELECT to look at the rows.
-- ----------------------------------------------------------------------------
WITH params AS (
    SELECT regexp_replace('9XXXXXXXXX', '(\d)', '\1[ .()-]*', 'g') AS rx
),
cols AS (
    SELECT c.table_schema, c.table_name, c.column_name, c.data_type
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public'
       AND c.data_type IN ('text', 'character varying', 'character', 'json', 'jsonb', 'ARRAY')
),
counted AS (
    SELECT cols.*,
           (xpath('/row/c/text()',
                  query_to_xml(format('SELECT count(*) AS c FROM %I.%I WHERE %I::TEXT ~ %L',
                                      cols.table_schema, cols.table_name, cols.column_name, params.rx),
                               FALSE, TRUE, '')))[1]::TEXT::INT AS matches,
           params.rx
      FROM cols, params
)
SELECT table_name,
       column_name,
       data_type,
       matches,
       format('SELECT * FROM %I.%I WHERE %I::TEXT ~ %L;', table_schema, table_name, column_name, rx) AS inspect_sql
  FROM counted
 WHERE matches > 0
 ORDER BY table_name, column_name;


-- ----------------------------------------------------------------------------
-- BLOCK 4.  The two e-mail aliases the apps would create for this number RIGHT NOW (exact match, no pattern).
--           If a row comes back, signing up with this number is refused until that login is removed (or its password is used).
--           Replace 9XXXXXXXXX here too (ten digits, no spaces).
-- ----------------------------------------------------------------------------
WITH params AS (SELECT '9XXXXXXXXX'::TEXT AS sub)
SELECT u.id, u.email, u.created_at, u.deleted_at,
       EXISTS (SELECT 1 FROM public.driver    d WHERE d.auth_user_id = u.id) AS has_driver_row,
       EXISTS (SELECT 1 FROM public.passenger p WHERE p.auth_user_id = u.id) AS has_passenger_row
  FROM auth.users u, params
 WHERE lower(u.email) IN ('driver_63' || params.sub || '@sakay.ph', 'passenger_63' || params.sub || '@sakay.ph');


-- ----------------------------------------------------------------------------
-- BLOCK 5.  Every ORPHAN app login in the project (a driver_/passenger_ alias with no row in public.driver / public.passenger and
--           not an administrator). These are what block a number after the public tables were cleared.
-- ----------------------------------------------------------------------------
SELECT u.id, u.email, u.created_at, u.last_sign_in_at, u.deleted_at
  FROM auth.users u
 WHERE (u.email ~* '^(driver|passenger|test)_'  OR u.email ~* '@(driver\.sakay\.internal|sakay\.ph|sakay\.internal|sakay\.local)$')
   AND NOT EXISTS (SELECT 1 FROM public.driver     d WHERE d.auth_user_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM public.passenger  p WHERE p.auth_user_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM public.toda_admin t WHERE t.auth_user_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM public.lgu_admin  l WHERE l.auth_user_id = u.id)
 ORDER BY u.created_at;
