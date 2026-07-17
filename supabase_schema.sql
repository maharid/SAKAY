-- SAKAY Database Schema Initialization
-- Targeted for Supabase PostgreSQL (Relational Database)
-- Mapped from the SAKAY Capstone Paper specifications.

-- Enable UUID extension if not already active
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. TRIGGERS & UTILITY FUNCTIONS
-- ============================================================================

-- Reusable function to automatically update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Helper to check if current user is an LGU admin
CREATE OR REPLACE FUNCTION is_lgu_admin()
RETURNS BOOLEAN AS $$
BEGIN
    -- Check if the current authenticated user's ID exists in the lgu_admin table
    RETURN EXISTS (
        SELECT 1 FROM public.lgu_admin 
        WHERE auth_user_id = auth.uid() 
        AND account_status = 'Active'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper to get toda_id of current toda_admin
CREATE OR REPLACE FUNCTION get_current_toda_admin_toda_id()
RETURNS UUID AS $$
BEGIN
    RETURN (
        SELECT toda_id FROM public.toda_admin 
        WHERE auth_user_id = auth.uid() 
        AND account_status = 'Active'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper to get passenger_id of current passenger
CREATE OR REPLACE FUNCTION get_current_passenger_id()
RETURNS UUID AS $$
BEGIN
    RETURN (
        SELECT passenger_id FROM public.passenger 
        WHERE auth_user_id = auth.uid()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper to get driver_id of current driver
CREATE OR REPLACE FUNCTION get_current_driver_id()
RETURNS UUID AS $$
BEGIN
    RETURN (
        SELECT driver_id FROM public.driver 
        WHERE auth_user_id = auth.uid()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper to check if toda_admin is matching the driver's toda
CREATE OR REPLACE FUNCTION is_toda_admin_for_driver(p_driver_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.driver d
        WHERE d.driver_id = p_driver_id
        AND d.toda_id = get_current_toda_admin_toda_id()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Reusable function to prevent passenger/driver updating read-only columns
CREATE OR REPLACE FUNCTION protect_read_only_columns()
RETURNS TRIGGER AS $$
BEGIN
    -- LGU admins have full permission to modify all columns
    IF is_lgu_admin() THEN
        RETURN NEW;
    END IF;

    -- Passenger table column protection
    IF TG_TABLE_NAME = 'passenger' THEN
        IF NEW.account_status IS DISTINCT FROM OLD.account_status THEN
            RAISE EXCEPTION 'Access Denied: Passengers cannot modify their own account_status.';
        END IF;
    END IF;

    -- Driver table column protection
    IF TG_TABLE_NAME = 'driver' THEN
        -- TODA admins are allowed to update driver status details if linked to their TODA
        IF is_toda_admin_for_driver(OLD.driver_id) THEN
            -- TODA admins cannot edit rating columns
            IF NEW.weighted_average_rating IS DISTINCT FROM OLD.weighted_average_rating THEN
                RAISE EXCEPTION 'Access Denied: Cannot modify weighted_average_rating.';
            END IF;
            RETURN NEW;
        END IF;

        -- Regular driver profile updates
        IF NEW.account_status IS DISTINCT FROM OLD.account_status OR
           NEW.weighted_average_rating IS DISTINCT FROM OLD.weighted_average_rating OR
           NEW.toda_id IS DISTINCT FROM OLD.toda_id OR
           NEW.license_number IS DISTINCT FROM OLD.license_number OR
           NEW.license_expiry IS DISTINCT FROM OLD.license_expiry OR
           NEW.franchise_number IS DISTINCT FROM OLD.franchise_number OR
           NEW.plate_number IS DISTINCT FROM OLD.plate_number OR
           NEW.toda_membership_number IS DISTINCT FROM OLD.toda_membership_number THEN
            RAISE EXCEPTION 'Access Denied: Drivers cannot modify status, ratings, toda, license, franchise, or plate details.';
        END IF;
    END IF;

    -- Driver verification table column protection
    IF TG_TABLE_NAME = 'driver_verification' THEN
        -- Check if current toda_admin manages the verification's driver
        IF EXISTS (
            SELECT 1 FROM public.driver d 
            WHERE d.driver_id = OLD.driver_id 
            AND d.toda_id = get_current_toda_admin_toda_id()
        ) THEN
            -- TODA admins cannot modify LGU reviewer details
            IF NEW.reviewed_by_lgu IS DISTINCT FROM OLD.reviewed_by_lgu THEN
                RAISE EXCEPTION 'Access Denied: TODA admins cannot modify reviewed_by_lgu.';
            END IF;
            RETURN NEW;
        END IF;

        -- Regular driver updates
        IF NEW.verification_status IS DISTINCT FROM OLD.verification_status OR
           NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by OR
           NEW.reviewed_by_lgu IS DISTINCT FROM OLD.reviewed_by_lgu THEN
            RAISE EXCEPTION 'Access Denied: Drivers cannot modify verification status or review details.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Role-aware trigger on auth.users for passenger and driver signups
CREATE OR REPLACE FUNCTION handle_new_user_signup()
RETURNS TRIGGER AS $$
DECLARE
    user_role TEXT;
    user_full_name TEXT;
    user_contact_number TEXT;
    user_toda_id UUID;
BEGIN
    -- Extract metadata details
    user_role := COALESCE(NEW.raw_user_meta_data->>'role', 'passenger');
    user_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
    user_contact_number := COALESCE(NEW.phone, NEW.raw_user_meta_data->>'contact_number', '');
    
    IF user_role = 'passenger' THEN
        INSERT INTO public.passenger (
            auth_user_id,
            full_name,
            contact_number,
            email,
            profile_photo_url,
            date_of_birth,
            residential_address,
            account_status
        ) VALUES (
            NEW.id,
            user_full_name,
            user_contact_number,
            NEW.email,
            NEW.raw_user_meta_data->>'profile_photo_url',
            (NEW.raw_user_meta_data->>'date_of_birth')::DATE,
            NEW.raw_user_meta_data->>'residential_address',
            'Pending OTP Verification' -- Wait for OTP trigger on update to activate
        );
    ELSIF user_role = 'driver' THEN
        user_toda_id := (NEW.raw_user_meta_data->>'toda_id')::UUID;
        INSERT INTO public.driver (
            auth_user_id,
            toda_id,
            full_name,
            contact_number,
            email,
            profile_photo_url,
            date_of_birth,
            residential_address,
            toda_membership_number,
            license_number,
            license_expiry,
            franchise_number,
            plate_number,
            assigned_terminal,
            barangay_service_area,
            account_status,
            availability_status
        ) VALUES (
            NEW.id,
            user_toda_id,
            user_full_name,
            user_contact_number,
            NEW.email,
            NEW.raw_user_meta_data->>'profile_photo_url',
            (NEW.raw_user_meta_data->>'date_of_birth')::DATE,
            NEW.raw_user_meta_data->>'residential_address',
            NEW.raw_user_meta_data->>'toda_membership_number',
            NEW.raw_user_meta_data->>'license_number',
            (NEW.raw_user_meta_data->>'license_expiry')::DATE,
            NEW.raw_user_meta_data->>'franchise_number',
            NEW.raw_user_meta_data->>'plate_number',
            NEW.raw_user_meta_data->>'assigned_terminal',
            NEW.raw_user_meta_data->>'barangay_service_area',
            'Pending Verification',
            'Offline'
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger definition on auth.users INSERT
CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user_signup();

-- Trigger function on auth.users UPDATE to confirm OTP and activate passenger
CREATE OR REPLACE FUNCTION handle_user_auth_update()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if phone verification transitions from null to verified timestamp
    IF NEW.phone_confirmed_at IS NOT NULL AND OLD.phone_confirmed_at IS NULL THEN
        UPDATE public.passenger
        SET account_status = 'Active'
        WHERE auth_user_id = NEW.id
        AND account_status = 'Pending OTP Verification';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger definition on auth.users UPDATE
CREATE OR REPLACE TRIGGER on_auth_user_updated
    AFTER UPDATE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_user_auth_update();

-- RPC function to atomically register a TODA and its admin (uses auth.uid() directly)
CREATE OR REPLACE FUNCTION register_toda_with_admin(
    p_toda_name VARCHAR(255),
    p_toda_acronym VARCHAR(50),
    p_registration_number VARCHAR(100),
    p_date_established DATE,
    p_terminal_latitude DOUBLE PRECISION,
    p_terminal_longitude DOUBLE PRECISION,
    p_barangay VARCHAR(100),
    p_service_coverage_area TEXT,
    p_contact_number VARCHAR(20),
    p_email VARCHAR(255),
    p_president_name VARCHAR(255),
    p_president_contact VARCHAR(20),
    p_vice_president_name VARCHAR(255),
    p_vice_president_contact VARCHAR(20),
    p_secretary_name VARCHAR(255),
    p_secretary_contact VARCHAR(20),
    p_treasurer_name VARCHAR(255),
    p_treasurer_contact VARCHAR(20),
    p_admin_full_name VARCHAR(255),
    p_admin_email VARCHAR(255),
    p_admin_contact_number VARCHAR(20)
)
RETURNS UUID AS $$
DECLARE
    v_toda_id UUID;
    v_auth_user_id UUID;
BEGIN
    v_auth_user_id := auth.uid();
    
    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'Access Denied: User must be authenticated.';
    END IF;

    -- Create toda record
    INSERT INTO public.toda (
        toda_name,
        toda_acronym,
        registration_number,
        date_established,
        terminal_latitude,
        terminal_longitude,
        barangay,
        service_coverage_area,
        contact_number,
        email,
        president_name,
        president_contact,
        vice_president_name,
        vice_president_contact,
        secretary_name,
        secretary_contact,
        treasurer_name,
        treasurer_contact,
        account_status
    ) VALUES (
        p_toda_name,
        p_toda_acronym,
        p_registration_number,
        p_date_established,
        p_terminal_latitude,
        p_terminal_longitude,
        p_barangay,
        p_service_coverage_area,
        p_contact_number,
        p_email,
        p_president_name,
        p_president_contact,
        p_vice_president_name,
        p_vice_president_contact,
        p_secretary_name,
        p_secretary_contact,
        p_treasurer_name,
        p_treasurer_contact,
        'Pending Verification'
    ) RETURNING toda_id INTO v_toda_id;

    -- Create toda_admin record linked to the toda and the caller's auth ID
    INSERT INTO public.toda_admin (
        auth_user_id,
        toda_id,
        full_name,
        email,
        contact_number,
        account_status
    ) VALUES (
        v_auth_user_id,
        v_toda_id,
        p_admin_full_name,
        p_admin_email,
        p_admin_contact_number,
        'Active'
    );

    RETURN v_toda_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Limit execute permissions on register_toda_with_admin to authenticated users
REVOKE EXECUTE ON FUNCTION register_toda_with_admin(
    VARCHAR(255), VARCHAR(50), VARCHAR(100), DATE, DOUBLE PRECISION, DOUBLE PRECISION,
    VARCHAR(100), TEXT, VARCHAR(20), VARCHAR(255), VARCHAR(255), VARCHAR(20),
    VARCHAR(255), VARCHAR(20), VARCHAR(255), VARCHAR(20), VARCHAR(255), VARCHAR(20),
    VARCHAR(255), VARCHAR(255), VARCHAR(20)
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION register_toda_with_admin(
    VARCHAR(255), VARCHAR(50), VARCHAR(100), DATE, DOUBLE PRECISION, DOUBLE PRECISION,
    VARCHAR(100), TEXT, VARCHAR(20), VARCHAR(255), VARCHAR(255), VARCHAR(20),
    VARCHAR(255), VARCHAR(20), VARCHAR(255), VARCHAR(20), VARCHAR(255), VARCHAR(20),
    VARCHAR(255), VARCHAR(255), VARCHAR(20)
) TO authenticated;

-- ============================================================================
-- 2. CORE IDENTITY SCHEMA GROUP
-- ============================================================================

-- TODA Organization Table
CREATE TABLE IF NOT EXISTS toda (
    toda_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    toda_name VARCHAR(255) NOT NULL,
    toda_acronym VARCHAR(50),
    registration_number VARCHAR(100) NOT NULL UNIQUE,
    date_established DATE,
    terminal_latitude DOUBLE PRECISION,
    terminal_longitude DOUBLE PRECISION,
    barangay VARCHAR(100),
    service_coverage_area TEXT,
    contact_number VARCHAR(20),
    email VARCHAR(255),
    president_name VARCHAR(255),
    president_contact VARCHAR(20),
    vice_president_name VARCHAR(255),
    vice_president_contact VARCHAR(20),
    secretary_name VARCHAR(255),
    secretary_contact VARCHAR(20),
    treasurer_name VARCHAR(255),
    treasurer_contact VARCHAR(20),
    registered_tricycle_count INTEGER NOT NULL DEFAULT 0,
    active_driver_count INTEGER NOT NULL DEFAULT 0,
    certificate_number VARCHAR(100),
    certificate_expiry TIMESTAMPTZ,
    account_status VARCHAR(50) NOT NULL DEFAULT 'Pending Verification' 
        CHECK (account_status IN ('Pending Verification', 'Active', 'Suspended', 'Deactivated')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- LGU Admin Accounts Table
CREATE TABLE IF NOT EXISTS lgu_admin (
    admin_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    contact_number VARCHAR(20),
    position VARCHAR(100),
    account_status VARCHAR(50) NOT NULL DEFAULT 'Active' 
        CHECK (account_status IN ('Active', 'Suspended')),
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- TODA Admin Accounts Table
CREATE TABLE IF NOT EXISTS toda_admin (
    admin_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    toda_id UUID NOT NULL REFERENCES toda(toda_id) ON DELETE CASCADE,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    contact_number VARCHAR(20),
    account_status VARCHAR(50) NOT NULL DEFAULT 'Active' 
        CHECK (account_status IN ('Active', 'Suspended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Passenger Accounts Table
CREATE TABLE IF NOT EXISTS passenger (
    passenger_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name VARCHAR(255) NOT NULL,
    contact_number VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(255) UNIQUE,
    profile_photo_url TEXT,
    date_of_birth DATE,
    residential_address TEXT,
    account_status VARCHAR(50) NOT NULL DEFAULT 'Pending OTP Verification' 
        CHECK (account_status IN ('Pending OTP Verification', 'Active', 'Suspended', 'Deactivated')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER trigger_update_passenger_updated_at
BEFORE UPDATE ON passenger
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_protect_passenger_columns
BEFORE UPDATE ON passenger
FOR EACH ROW EXECUTE FUNCTION protect_read_only_columns();

-- Driver Accounts Table
CREATE TABLE IF NOT EXISTS driver (
    driver_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    toda_id UUID REFERENCES toda(toda_id) ON DELETE SET NULL,
    full_name VARCHAR(255) NOT NULL,
    contact_number VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(255) UNIQUE,
    profile_photo_url TEXT,
    date_of_birth DATE,
    residential_address TEXT,
    toda_membership_number VARCHAR(100),
    license_number VARCHAR(50),
    license_expiry DATE,
    franchise_number VARCHAR(50),
    plate_number VARCHAR(50),
    assigned_terminal VARCHAR(100),
    barangay_service_area VARCHAR(100),
    account_status VARCHAR(50) NOT NULL DEFAULT 'Pending Verification' 
        CHECK (account_status IN ('Pending Verification', 'Verified', 'Rejected', 'Suspended', 'Deactivated', 'Resubmission Required')),
    availability_status VARCHAR(50) NOT NULL DEFAULT 'Offline' 
        CHECK (availability_status IN ('Offline', 'Available', 'Busy')),
    weighted_average_rating NUMERIC(3,2) NOT NULL DEFAULT 4.00,
    current_latitude DOUBLE PRECISION,
    current_longitude DOUBLE PRECISION,
    last_location_update TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER trigger_update_driver_updated_at
BEFORE UPDATE ON driver
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_protect_driver_columns
BEFORE UPDATE ON driver
FOR EACH ROW EXECUTE FUNCTION protect_read_only_columns();

-- Driver Verification Records Table (Includes sequential review tracking)
CREATE TABLE IF NOT EXISTS driver_verification (
    verification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES driver(driver_id) ON DELETE CASCADE,
    reviewed_by UUID REFERENCES toda_admin(admin_id) ON DELETE SET NULL, -- TODA Admin reviewer
    reviewed_by_lgu UUID REFERENCES lgu_admin(admin_id) ON DELETE SET NULL, -- LGU Admin reviewer
    ocr_full_name VARCHAR(255),
    submitted_full_name VARCHAR(255),
    ocr_license_number VARCHAR(50),
    submitted_license_number VARCHAR(50),
    ocr_dob DATE,
    submitted_dob DATE,
    ocr_address TEXT,
    submitted_address TEXT,
    ocr_dl_codes VARCHAR(50),
    submitted_dl_codes VARCHAR(50),
    ocr_toda_membership_number VARCHAR(100),
    submitted_toda_membership_number VARCHAR(100),
    ocr_franchise_number VARCHAR(50),
    submitted_franchise_number VARCHAR(50),
    ocr_operator_name VARCHAR(255),
    submitted_operator_name VARCHAR(255),
    ocr_plate_number VARCHAR(50),
    submitted_plate_number VARCHAR(50),
    license_expiry DATE,
    franchise_expiry DATE,
    mime_type VARCHAR(100),
    file_size INTEGER,
    scan_status VARCHAR(50) NOT NULL DEFAULT 'Clean' 
        CHECK (scan_status IN ('Clean', 'Flagged')),
    verification_status VARCHAR(50) NOT NULL DEFAULT 'Pending' 
        CHECK (verification_status IN ('Pending', 'Approved', 'Rejected', 'Resubmission Required')),
    remarks TEXT,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMPTZ
);

CREATE TRIGGER trigger_protect_verification_columns
BEFORE UPDATE ON driver_verification
FOR EACH ROW EXECUTE FUNCTION protect_read_only_columns();

-- ============================================================================
-- 3. SUPPORT SCHEMA GROUP
-- ============================================================================

-- Fare Matrix Config Table
CREATE TABLE IF NOT EXISTS fare_matrix (
    fare_matrix_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    base_fare NUMERIC(10,2) NOT NULL,
    base_distance_km NUMERIC(5,2) NOT NULL DEFAULT 2.00,
    succeeding_rate NUMERIC(10,2) NOT NULL,
    effective_timestamp TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    configured_by UUID REFERENCES lgu_admin(admin_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 4. RIDE & BOOKING SCHEMA GROUP
-- ============================================================================

-- Main Booking Table
CREATE TABLE IF NOT EXISTS booking (
    booking_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    passenger_id UUID NOT NULL REFERENCES passenger(passenger_id) ON DELETE SET NULL,
    driver_id UUID REFERENCES driver(driver_id) ON DELETE SET NULL,
    toda_id UUID REFERENCES toda(toda_id) ON DELETE SET NULL,
    booking_type VARCHAR(50) NOT NULL DEFAULT 'Immediate',
    is_shared_trip BOOLEAN NOT NULL DEFAULT FALSE,
    shared_trip_match_id UUID,
    passenger_count INTEGER NOT NULL CHECK (passenger_count > 0 AND passenger_count <= 4),
    pickup_address TEXT NOT NULL,
    pickup_latitude DOUBLE PRECISION NOT NULL,
    pickup_longitude DOUBLE PRECISION NOT NULL,
    dropoff_address TEXT NOT NULL,
    dropoff_latitude DOUBLE PRECISION NOT NULL,
    dropoff_longitude DOUBLE PRECISION NOT NULL,
    estimated_distance_km DOUBLE PRECISION,
    actual_distance_km DOUBLE PRECISION,
    estimated_fare NUMERIC(10,2),
    actual_fare NUMERIC(10,2),
    fare_confirmation_status VARCHAR(50) NOT NULL DEFAULT 'Matched',
    booking_status VARCHAR(50) NOT NULL DEFAULT 'Pending',
    cancelled_by VARCHAR(50),
    cancellation_reason TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMPTZ,
    arrived_at TIMESTAMPTZ,
    trip_started_at TIMESTAMPTZ,
    trip_completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Dispatch Attempts Log
CREATE TABLE IF NOT EXISTS dispatch_attempt (
    attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES booking(booking_id) ON DELETE CASCADE,
    driver_id UUID NOT NULL REFERENCES driver(driver_id) ON DELETE CASCADE,
    dispatch_method VARCHAR(50) NOT NULL,
    driver_rank INTEGER,
    response_status VARCHAR(50) NOT NULL DEFAULT 'Pending',
    notification_sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    responded_at TIMESTAMPTZ
);

-- Shared Trip Pairing Table
CREATE TABLE IF NOT EXISTS shared_trip_match (
    match_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    primary_booking_id UUID NOT NULL REFERENCES booking(booking_id) ON DELETE CASCADE,
    additional_booking_id UUID REFERENCES booking(booking_id) ON DELETE CASCADE,
    route_progress_at_request NUMERIC(5,2),
    driver_response_status VARCHAR(50) NOT NULL DEFAULT 'Pending',
    match_status VARCHAR(50) NOT NULL DEFAULT 'Searching',
    matched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Detailed Cancellation Log
CREATE TABLE IF NOT EXISTS cancellation_record (
    cancellation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES booking(booking_id) ON DELETE CASCADE,
    cancelled_by VARCHAR(50) NOT NULL,
    reason TEXT,
    redispatch_triggered BOOLEAN NOT NULL DEFAULT FALSE,
    cancelled_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Real-Time GPS Tracking Logs
CREATE TABLE IF NOT EXISTS gps_log (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID REFERENCES booking(booking_id) ON DELETE CASCADE,
    driver_id UUID NOT NULL REFERENCES driver(driver_id) ON DELETE CASCADE,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    accuracy DOUBLE PRECISION,
    speed DOUBLE PRECISION,
    heading DOUBLE PRECISION,
    sync_status VARCHAR(50) NOT NULL DEFAULT 'Synced',
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 5. FEEDBACK, ALERTS & INCIDENT SCHEMA GROUP
-- ============================================================================

-- Passenger/Driver Trip Ratings Table
CREATE TABLE IF NOT EXISTS rating (
    rating_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES booking(booking_id) ON DELETE CASCADE,
    rater_id UUID NOT NULL,
    ratee_id UUID NOT NULL,
    rater_role VARCHAR(50) NOT NULL,
    stars INTEGER NOT NULL CHECK (stars >= 1 AND stars <= 5),
    tags TEXT[],
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Incident Complaints & Safety Reports Table
CREATE TABLE IF NOT EXISTS incident_report (
    incident_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES booking(booking_id) ON DELETE CASCADE,
    passenger_id UUID REFERENCES passenger(passenger_id) ON DELETE SET NULL,
    driver_id UUID REFERENCES driver(driver_id) ON DELETE SET NULL,
    reported_by VARCHAR(50) NOT NULL,
    category VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Pending',
    reviewed_by_toda UUID REFERENCES toda_admin(admin_id) ON DELETE SET NULL,
    reviewed_by_lgu UUID REFERENCES lgu_admin(admin_id) ON DELETE SET NULL,
    resolution TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMPTZ
);

-- System & Booking Notifications Table
CREATE TABLE IF NOT EXISTS notification (
    notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    passenger_id UUID REFERENCES passenger(passenger_id) ON DELETE CASCADE,
    driver_id UUID REFERENCES driver(driver_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    notification_type VARCHAR(50) NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- TODA Announcements Table
CREATE TABLE IF NOT EXISTS announcement (
    announcement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    toda_id UUID NOT NULL REFERENCES toda(toda_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    created_by UUID REFERENCES toda_admin(admin_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 6. ANALYTICS & LOGGING SCHEMA GROUP
-- ============================================================================

-- Analytics Logs
CREATE TABLE IF NOT EXISTS analytics_log (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    triggered_by VARCHAR(50) NOT NULL,
    data_period_start TIMESTAMPTZ NOT NULL,
    data_period_end TIMESTAMPTZ NOT NULL,
    records_processed INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL,
    run_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Generated Reports Table
CREATE TABLE IF NOT EXISTS analytics_report (
    report_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    generated_by_toda_admin UUID REFERENCES toda_admin(admin_id) ON DELETE SET NULL,
    generated_by_lgu_admin UUID REFERENCES lgu_admin(admin_id) ON DELETE SET NULL,
    report_type VARCHAR(100) NOT NULL,
    report_title VARCHAR(255) NOT NULL,
    report_period VARCHAR(100) NOT NULL,
    report_file_url TEXT,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    analytics_log_id UUID REFERENCES analytics_log(log_id) ON DELETE SET NULL
);

-- Admin Activity Auditing Table
CREATE TABLE IF NOT EXISTS audit_log (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    toda_admin_id UUID REFERENCES toda_admin(admin_id) ON DELETE SET NULL,
    lgu_admin_id UUID REFERENCES lgu_admin(admin_id) ON DELETE SET NULL,
    action_type VARCHAR(100) NOT NULL,
    target_id UUID,
    details TEXT,
    performed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 7. PERFORMANCE INDEXES (FOR FREQUENT QUERIES)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_driver_availability ON driver(availability_status) WHERE account_status = 'Verified';
CREATE INDEX IF NOT EXISTS idx_driver_location ON driver(current_latitude, current_longitude);
CREATE INDEX IF NOT EXISTS idx_booking_status ON booking(booking_status);
CREATE INDEX IF NOT EXISTS idx_booking_passenger ON booking(passenger_id);
CREATE INDEX IF NOT EXISTS idx_booking_driver ON booking(driver_id);
CREATE INDEX IF NOT EXISTS idx_gps_log_booking ON gps_log(booking_id);
CREATE INDEX IF NOT EXISTS idx_incident_report_status ON incident_report(status);
CREATE INDEX IF NOT EXISTS idx_notification_unread ON notification(is_read) WHERE is_read = FALSE;

-- ============================================================================
-- 8. SECURITY & ROLE-BASED ACCESS CONTROL (RLS) POLICIES
-- ============================================================================

-- Helper: Retrieve assigned driver details for passenger active trip
CREATE OR REPLACE FUNCTION get_assigned_driver_details(p_booking_id UUID)
RETURNS TABLE (
    driver_id UUID,
    full_name VARCHAR(255),
    plate_number VARCHAR(50),
    weighted_average_rating NUMERIC(3,2),
    current_latitude DOUBLE PRECISION,
    current_longitude DOUBLE PRECISION,
    last_location_update TIMESTAMPTZ
) AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.booking b
        WHERE b.booking_id = p_booking_id
        AND (
            b.passenger_id = get_current_passenger_id()
            OR b.toda_id = get_current_toda_admin_toda_id()
            OR is_lgu_admin()
        )
    ) THEN
        RETURN QUERY
        SELECT 
            d.driver_id,
            d.full_name,
            d.plate_number,
            d.weighted_average_rating,
            d.current_latitude,
            d.current_longitude,
            d.last_location_update
        FROM public.driver d
        JOIN public.booking b ON d.driver_id = b.driver_id
        WHERE b.booking_id = p_booking_id;
    ELSE
        RAISE EXCEPTION 'Access denied. You are not authorized to view this driver details.';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================
-- RLS POLICIES: toda
-- ====================
CREATE POLICY "LGU admins have full access to toda" ON toda FOR ALL TO authenticated USING (is_lgu_admin());
CREATE POLICY "TODA admins can access/edit own toda" ON toda FOR ALL TO authenticated USING (toda_id = get_current_toda_admin_toda_id());
CREATE POLICY "Public authenticated can view active toda names" ON toda FOR SELECT TO authenticated USING (account_status = 'Active');

-- ====================
-- RLS POLICIES: lgu_admin
-- ====================
CREATE POLICY "LGU admins can read/write all lgu_admin profiles" ON lgu_admin FOR ALL TO authenticated USING (is_lgu_admin());
CREATE POLICY "LGU admins can access own profile" ON lgu_admin FOR ALL TO authenticated USING (auth_user_id = auth.uid());

-- ====================
-- RLS POLICIES: toda_admin
-- ====================
CREATE POLICY "LGU admins can manage toda_admin accounts" ON toda_admin FOR ALL TO authenticated USING (is_lgu_admin());
CREATE POLICY "TODA admins can view/manage toda_admins in same toda" ON toda_admin FOR ALL TO authenticated USING (toda_id = get_current_toda_admin_toda_id());
CREATE POLICY "TODA admins can access own profile" ON toda_admin FOR ALL TO authenticated USING (auth_user_id = auth.uid());

-- ====================
-- RLS POLICIES: passenger
-- ====================
CREATE POLICY "Passengers can read/write own profile" ON passenger FOR ALL TO authenticated USING (auth_user_id = auth.uid());
CREATE POLICY "LGU admins can view/manage all passengers" ON passenger FOR ALL TO authenticated USING (is_lgu_admin());
CREATE POLICY "TODA admins can read passengers linked to bookings in their toda" ON passenger FOR SELECT TO authenticated USING (
    EXISTS (
        SELECT 1 FROM public.booking b 
        WHERE b.passenger_id = passenger.passenger_id 
        AND b.toda_id = get_current_toda_admin_toda_id()
    )
);

-- ====================
-- RLS POLICIES: driver
-- ====================
CREATE POLICY "Drivers can access/update own profile" ON driver FOR ALL TO authenticated USING (auth_user_id = auth.uid());
CREATE POLICY "TODA admins can manage their drivers" ON driver FOR ALL TO authenticated USING (toda_id = get_current_toda_admin_toda_id());
CREATE POLICY "LGU admins can manage all drivers" ON driver FOR ALL TO authenticated USING (is_lgu_admin());

-- ====================
-- RLS POLICIES: driver_verification
-- ====================
CREATE POLICY "Drivers can view/insert own verification" ON driver_verification FOR ALL TO authenticated USING (driver_id = get_current_driver_id());
CREATE POLICY "TODA admins can manage verifications of their drivers" ON driver_verification FOR ALL TO authenticated USING (
    EXISTS (
        SELECT 1 FROM public.driver d 
        WHERE d.driver_id = driver_verification.driver_id 
        AND d.toda_id = get_current_toda_admin_toda_id()
    )
);
CREATE POLICY "LGU admins can manage all driver verifications" ON driver_verification FOR ALL TO authenticated USING (is_lgu_admin());

-- ====================
-- RLS POLICIES: fare_matrix
-- ====================
CREATE POLICY "LGU admins can manage fare configurations" ON fare_matrix FOR ALL TO authenticated USING (is_lgu_admin());
CREATE POLICY "Authenticated users can select active fare matrices" ON fare_matrix FOR SELECT TO authenticated USING (is_active = TRUE);

-- ====================
-- RLS POLICIES: booking
-- ====================
CREATE POLICY "Passengers can manage own bookings" ON booking FOR ALL TO authenticated USING (passenger_id = get_current_passenger_id());
CREATE POLICY "Drivers can manage assigned bookings" ON booking FOR ALL TO authenticated USING (driver_id = get_current_driver_id());
CREATE POLICY "TODA admins can manage bookings of their toda" ON booking FOR ALL TO authenticated USING (toda_id = get_current_toda_admin_toda_id());
CREATE POLICY "LGU admins can manage all bookings" ON booking FOR ALL TO authenticated USING (is_lgu_admin());

-- ====================
-- RLS POLICIES: dispatch_attempt
-- ====================
CREATE POLICY "Drivers can view dispatch attempts directed to them" ON dispatch_attempt FOR SELECT TO authenticated USING (driver_id = get_current_driver_id());
CREATE POLICY "TODA admins can view dispatch attempts under their toda" ON dispatch_attempt FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.booking b WHERE b.booking_id = dispatch_attempt.booking_id AND b.toda_id = get_current_toda_admin_toda_id())
);
CREATE POLICY "LGU admins can manage all dispatch attempts" ON dispatch_attempt FOR ALL TO authenticated USING (is_lgu_admin());
CREATE POLICY "Passengers can view dispatch attempts for their booking" ON dispatch_attempt FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.booking b WHERE b.booking_id = dispatch_attempt.booking_id AND b.passenger_id = get_current_passenger_id())
);

-- ====================
-- RLS POLICIES: shared_trip_match
-- ====================
CREATE POLICY "Passengers can view matches of their bookings" ON shared_trip_match FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.booking b WHERE (b.booking_id = shared_trip_match.primary_booking_id OR b.booking_id = shared_trip_match.additional_booking_id) AND b.passenger_id = get_current_passenger_id())
);
CREATE POLICY "Drivers can view/update matches for active trips" ON shared_trip_match FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.booking b WHERE b.booking_id = shared_trip_match.primary_booking_id AND b.driver_id = get_current_driver_id())
);
CREATE POLICY "TODA admins can view matches in their toda" ON shared_trip_match FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.booking b WHERE b.booking_id = shared_trip_match.primary_booking_id AND b.toda_id = get_current_toda_admin_toda_id())
);
CREATE POLICY "LGU admins can manage all shared trip matches" ON shared_trip_match FOR ALL TO authenticated USING (is_lgu_admin());

-- ====================
-- RLS POLICIES: cancellation_record
-- ====================
CREATE POLICY "Passengers can insert/view own cancellations" ON cancellation_record FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.booking b WHERE b.booking_id = cancellation_record.booking_id AND b.passenger_id = get_current_passenger_id())
);
CREATE POLICY "Drivers can insert/view own cancellations" ON cancellation_record FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.booking b WHERE b.booking_id = cancellation_record.booking_id AND b.driver_id = get_current_driver_id())
);
CREATE POLICY "TODA admins can manage cancellations in their toda" ON cancellation_record FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.booking b WHERE b.booking_id = cancellation_record.booking_id AND b.toda_id = get_current_toda_admin_toda_id())
);
CREATE POLICY "LGU admins can manage all cancellations" ON cancellation_record FOR ALL TO authenticated USING (is_lgu_admin());

-- ====================
-- RLS POLICIES: gps_log
-- ====================
CREATE POLICY "Drivers can insert/select own gps logs" ON gps_log FOR ALL TO authenticated USING (driver_id = get_current_driver_id());
CREATE POLICY "Passengers can select gps logs for active booking" ON gps_log FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.booking b WHERE b.booking_id = gps_log.booking_id AND b.passenger_id = get_current_passenger_id())
);
CREATE POLICY "TODA admins can select gps logs in their toda" ON gps_log FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.booking b WHERE b.booking_id = gps_log.booking_id AND b.toda_id = get_current_toda_admin_toda_id())
);
CREATE POLICY "LGU admins can manage all gps logs" ON gps_log FOR ALL TO authenticated USING (is_lgu_admin());

-- ====================
-- RLS POLICIES: rating
-- ====================
CREATE POLICY "Users can create ratings for bookings they were part of" ON rating FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.booking b 
        WHERE b.booking_id = rating.booking_id 
        AND (b.passenger_id = get_current_passenger_id() OR b.driver_id = get_current_driver_id())
    )
);
CREATE POLICY "Users can view ratings they received or gave" ON rating FOR SELECT TO authenticated USING (
    rater_id = get_current_passenger_id() 
    OR rater_id = get_current_driver_id() 
    OR ratee_id = get_current_passenger_id() 
    OR ratee_id = get_current_driver_id()
);
CREATE POLICY "TODA admins can view ratings for their toda" ON rating FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.booking b WHERE b.booking_id = rating.booking_id AND b.toda_id = get_current_toda_admin_toda_id())
);
CREATE POLICY "LGU admins can manage all ratings" ON rating FOR ALL TO authenticated USING (is_lgu_admin());

-- ====================
-- RLS POLICIES: incident_report
-- ====================
CREATE POLICY "Passengers can manage own incident reports" ON incident_report FOR ALL TO authenticated USING (passenger_id = get_current_passenger_id());
CREATE POLICY "Drivers can manage own incident reports" ON incident_report FOR ALL TO authenticated USING (driver_id = get_current_driver_id());
CREATE POLICY "TODA admins can view/update incident reports of their toda" ON incident_report FOR ALL TO authenticated USING (
    EXISTS (
        SELECT 1 FROM public.booking b 
        WHERE b.booking_id = incident_report.booking_id 
        AND b.toda_id = get_current_toda_admin_toda_id()
    )
);
CREATE POLICY "LGU admins can manage all incident reports" ON incident_report FOR ALL TO authenticated USING (is_lgu_admin());

-- ====================
-- RLS POLICIES: notification
-- ====================
CREATE POLICY "Passengers can view/update own notifications" ON notification FOR ALL TO authenticated USING (passenger_id = get_current_passenger_id());
CREATE POLICY "Drivers can view/update own notifications" ON notification FOR ALL TO authenticated USING (driver_id = get_current_driver_id());
CREATE POLICY "LGU admins can manage all notifications" ON notification FOR ALL TO authenticated USING (is_lgu_admin());

-- ====================
-- RLS POLICIES: announcement
-- ====================
CREATE POLICY "TODA admins can manage announcements for their toda" ON announcement FOR ALL TO authenticated USING (toda_id = get_current_toda_admin_toda_id());
CREATE POLICY "Drivers can view announcements for their toda" ON announcement FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.driver d WHERE d.driver_id = get_current_driver_id() AND d.toda_id = announcement.toda_id)
);
CREATE POLICY "LGU admins can view/manage all announcements" ON announcement FOR ALL TO authenticated USING (is_lgu_admin());

-- ====================
-- RLS POLICIES: audit_log, analytics_log, analytics_report
-- ====================
CREATE POLICY "Only LGU admins can access analytics logs" ON analytics_log FOR ALL TO authenticated USING (is_lgu_admin());
CREATE POLICY "LGU admins can manage all analytics reports" ON analytics_report FOR ALL TO authenticated USING (is_lgu_admin());
CREATE POLICY "TODA admins can view reports they generated" ON analytics_report FOR SELECT TO authenticated USING (generated_by_toda_admin = (SELECT admin_id FROM public.toda_admin WHERE auth_user_id = auth.uid()));
CREATE POLICY "Only LGU admins can access system audit logs" ON audit_log FOR ALL TO authenticated USING (is_lgu_admin());
CREATE POLICY "TODA admins can view audit logs they triggered" ON audit_log FOR SELECT TO authenticated USING (toda_admin_id = (SELECT admin_id FROM public.toda_admin WHERE auth_user_id = auth.uid()));
