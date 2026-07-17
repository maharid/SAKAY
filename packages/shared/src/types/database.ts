// SAKAY Database Types matching Supabase PostgreSQL Schema

export interface Toda {
  toda_id: string;
  toda_name: string;
  toda_acronym?: string;
  registration_number: string;
  date_established?: string;
  terminal_latitude?: number;
  terminal_longitude?: number;
  barangay?: string;
  service_coverage_area?: string;
  contact_number?: string;
  email?: string;
  president_name?: string;
  president_contact?: string;
  vice_president_name?: string;
  vice_president_contact?: string;
  secretary_name?: string;
  secretary_contact?: string;
  treasurer_name?: string;
  treasurer_contact?: string;
  registered_tricycle_count: number;
  active_driver_count: number;
  certificate_number?: string;
  certificate_expiry?: string;
  account_status: 'Pending Verification' | 'Active' | 'Suspended' | 'Deactivated';
  created_at: string;
}

export interface Passenger {
  passenger_id: string;
  auth_user_id: string;
  full_name: string;
  contact_number: string;
  email?: string;
  profile_photo_url?: string;
  date_of_birth?: string;
  residential_address?: string;
  account_status: 'Pending OTP Verification' | 'Active' | 'Suspended' | 'Deactivated';
  created_at: string;
  updated_at: string;
}

export interface Driver {
  driver_id: string;
  auth_user_id: string;
  toda_id?: string;
  full_name: string;
  contact_number: string;
  email?: string;
  profile_photo_url?: string;
  date_of_birth?: string;
  residential_address?: string;
  toda_membership_number?: string;
  license_number?: string;
  license_expiry?: string;
  franchise_number?: string;
  plate_number?: string;
  assigned_terminal?: string;
  barangay_service_area?: string;
  account_status: 'Pending Verification' | 'Verified' | 'Rejected' | 'Suspended' | 'Deactivated' | 'Resubmission Required';
  availability_status: 'Offline' | 'Available' | 'Busy';
  weighted_average_rating: number;
  current_latitude?: number;
  current_longitude?: number;
  last_location_update?: string;
  created_at: string;
  updated_at: string;
}

export interface Booking {
  booking_id: string;
  passenger_id: string;
  driver_id?: string;
  toda_id?: string;
  booking_type: 'Immediate' | 'Scheduled';
  is_shared_trip: boolean;
  shared_trip_match_id?: string;
  passenger_count: number;
  pickup_address: string;
  pickup_latitude: number;
  pickup_longitude: number;
  dropoff_address: string;
  dropoff_latitude: number;
  dropoff_longitude: number;
  estimated_distance_km?: number;
  actual_distance_km?: number;
  estimated_fare?: number;
  actual_fare?: number;
  fare_confirmation_status: 'Matched' | 'Flagged for Review';
  booking_status: 'Pending' | 'Searching Driver' | 'Driver Assigned' | 'Driver En Route' | 'Driver Arrived' | 'Passenger Boarded' | 'Trip Ongoing' | 'Completed' | 'Cancelled' | 'No Driver Found';
  cancelled_by?: 'Passenger' | 'Driver' | 'System';
  cancellation_reason?: string;
  requested_at: string;
  accepted_at?: string;
  arrived_at?: string;
  trip_started_at?: string;
  trip_completed_at?: string;
  cancelled_at?: string;
  created_at: string;
}
