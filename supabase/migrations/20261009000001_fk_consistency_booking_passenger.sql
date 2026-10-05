-- ============================================================================
-- Migration: 20261009000001_fk_consistency_booking_passenger.sql
-- SCHEMA CONSISTENCY: a NOT NULL column whose foreign key says ON DELETE SET NULL can never be deleted through.
--
-- The contradiction (init_schema.sql, table booking):
--     passenger_id UUID NOT NULL REFERENCES passenger(passenger_id) ON DELETE SET NULL
--   Deleting a passenger (or the auth user the passenger row cascades from) that has even one booking makes Postgres try to null
--   booking.passenger_id, which NOT NULL forbids. The delete fails with
--     null value in column "passenger_id" of relation "booking" violates not-null constraint
--   instead of doing either of the things the two clauses were meant to do.
--
-- Audit of every foreign key in supabase/migrations/ (referencing column -> parent, ON DELETE, nullability):
--     OK  nullable + SET NULL   driver.toda_id, booking.driver_id, booking.toda_id, incident_report.passenger_id / driver_id /
--                               reported_toda_id, every *_by / reviewed_by / created_by / configured_by / resolved_by column,
--                               strikes_ledger.booking_id / incident_id / toda_id, exemption_request.toda_id, announcement.toda_id
--                               (made nullable by 20260927010000), analytics_report.analytics_log_id, audit_log.*_admin_id
--     OK  NOT NULL + CASCADE    toda_admin.toda_id, driver_verification.driver_id, driver_toda_affiliation.driver_id / toda_id,
--                               driver_online_session.driver_id, toda_roster_entry.toda_id, dispatch_attempt / gps_log.driver_id,
--                               and every child-of-booking table (dispatch_attempt, cancellation_record, rating, incident_report,
--                               fare_adjustment_history, shared_trip_match.primary_booking_id)
--     OK  NO ACTION (= refuse)  booking.fare_matrix_id -> fare_matrix, strikes_ledger.violation_code -> violation_catalog:
--                               fare history and the violation catalogue must never disappear under existing records
--     FIXED  NOT NULL + SET NULL   booking.passenger_id   <- the only contradiction found
--   There is NO tricycle_unit table in the migrations (the "verified tricycle unit" step of the paper is not built yet), and
--   "affiliation_id" exists only as the primary key of driver_toda_affiliation and as a plain, unreferenced column of
--   driver_online_session. Nothing to fix for those.
--   Columns that point at a passenger or driver WITHOUT a foreign key (they are polymorphic or historical, so none is possible):
--   rating.rater_id / ratee_id (uuid), strikes_ledger.subject_id (uuid), exemption_request.subject_id (uuid),
--   admin_review_flag.subject_id (text), audit_log.target_id (text), notification.recipient_id (text),
--   driver_online_session.affiliation_id / toda_id (uuid). They are listed here because deleting a person leaves them behind;
--   supabase/scripts/safe_test_data_cleanup.sql removes them explicitly, with the right types.
--
-- The choice for booking.passenger_id: make the column NULLABLE and keep ON DELETE SET NULL (anonymise, do not erase).
--   * CASCADE would delete the trip, which also erases the DRIVER's earnings and trip history and the LGU's record of a trip that
--     happened. Rejected.
--   * RESTRICT would be safe for the data but turns every account clean-up into a manual job, and an auth user could not be removed
--     from the dashboard once the passenger has ridden. It also disagrees with the rest of the schema, where every other link from a
--     trip to a person (booking.driver_id, incident_report.passenger_id / driver_id) is already "keep the record, drop the link".
--   * NULLABLE + SET NULL keeps the trip for the driver, the TODA and the LGU, removes the passenger's identity from it, and agrees
--     with the row policies written in the perimeter lockdown, which already test `passenger_id IS NOT NULL` before comparing it.
--   No existing row changes, no table rewrite, and no row policy is touched.
--
-- The one guard that would stand in the way: booking_identity_guard() (perimeter S1) refuses ANY change of passenger_id unless the
-- session is "trusted". The foreign key's own UPDATE (passenger_id -> NULL) runs inside the deleting session, so it only worked for
-- trusted sessions. The guard now also lets through exactly one change, whoever runs it: passenger_id going from a value to NULL
-- while the passenger row it pointed at no longer exists. A client cannot produce that state (it cannot delete a passenger), so
-- nothing is weakened; every other change of passenger_id is still refused.
--
-- Forward-only. Safe to run twice. Ends with a self-check.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The fix
-- ----------------------------------------------------------------------------
ALTER TABLE public.booking ALTER COLUMN passenger_id DROP NOT NULL;

COMMENT ON COLUMN public.booking.passenger_id IS
    'The passenger who made the booking. NULL only after that passenger was permanently deleted (ON DELETE SET NULL): the trip stays for the driver, the TODA and the LGU, without the passenger''s identity.';

-- ----------------------------------------------------------------------------
-- 2. booking_identity_guard(): same text as 20261008000002 section 3.4, plus the one deletion-driven change described above
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.booking_identity_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_me_driver UUID;
BEGIN
    IF public.is_trusted_session() OR COALESCE(public.is_lgu_admin(), FALSE) THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        NEW.accepted_at := NULL;  NEW.arrived_at := NULL;  NEW.trip_started_at := NULL;  NEW.trip_completed_at := NULL;
        NEW.cancelled_at := NULL;  NEW.cancelled_by := NULL;  NEW.cancellation_reason := NULL;
        NEW.shared_trip_match_id := NULL;
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
        v_me_driver := public.get_current_driver_id();
        IF NOT (OLD.driver_id IS NULL AND NEW.driver_id IS NOT NULL AND v_me_driver IS NOT NULL AND NEW.driver_id = v_me_driver) THEN
            RAISE EXCEPTION 'ERR_BOOKING_DRIVER_LOCKED: A driver can only take an unassigned booking for themselves.' USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. SELF-CHECK
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_attribute
                WHERE attrelid = 'public.booking'::regclass AND attname = 'passenger_id' AND attnotnull) THEN
        RAISE EXCEPTION 'booking.passenger_id is still NOT NULL';
    END IF;

    -- Any other "NOT NULL column + ON DELETE SET NULL" in the live schema (tables this repository does not create, for instance).
    -- Reported, not failed: the migration is complete for what the repository defines, and the list tells you what to look at.
    FOR r IN
        SELECT c.conrelid::regclass AS tbl, c.conname, a.attname
          FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
         WHERE c.contype = 'f' AND c.confdeltype = 'n' AND a.attnotnull
           AND c.connamespace = 'public'::regnamespace
    LOOP
        RAISE WARNING 'foreign key % on % : column % is NOT NULL but ON DELETE SET NULL (deleting the parent will fail)', r.conname, r.tbl, r.attname;
    END LOOP;
END $$;
