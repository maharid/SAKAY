-- ============================================================================
-- SAKAY - FOREIGN KEY CONSISTENCY AUDIT (READ-ONLY)
-- Lists every foreign key in schema public (and the ones that point at auth.users) with the delete rule and whether the referencing
-- column accepts NULL, and flags the contradictions. Run it in the Supabase SQL editor BEFORE and AFTER
-- supabase/migrations/20261009000001_fk_consistency_booking_passenger.sql.
--
-- verdict:
--   CONTRADICTION  NOT NULL column with ON DELETE SET NULL: deleting the parent row always fails
--   check          ON DELETE SET DEFAULT: make sure the default is a valid parent
--   ok             anything else
-- Expected before the migration: exactly one CONTRADICTION (booking.passenger_id). After: none.
-- ============================================================================
SELECT c.conrelid::regclass                                   AS child_table,
       a.attname                                              AS child_column,
       c.confrelid::regclass                                  AS parent_table,
       CASE c.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE'
                          WHEN 'n' THEN 'SET NULL'  WHEN 'd' THEN 'SET DEFAULT' END AS on_delete,
       CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'nullable' END AS column_nullability,
       CASE WHEN c.confdeltype = 'n' AND a.attnotnull THEN 'CONTRADICTION'
            WHEN c.confdeltype = 'd'                  THEN 'check'
            ELSE 'ok' END                                     AS verdict,
       c.conname                                              AS constraint_name
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
 WHERE c.contype = 'f'
   AND (c.connamespace = 'public'::regnamespace OR c.confrelid = 'auth.users'::regclass)
 ORDER BY (CASE WHEN c.confdeltype = 'n' AND a.attnotnull THEN 0 ELSE 1 END), c.conrelid::regclass::TEXT, a.attname;
