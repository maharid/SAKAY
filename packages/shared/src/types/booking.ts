import type { FareBreakdown } from '../utils/fareCalculator';

export interface BookingRecord {
  booking_id: string;
  passenger_id: string;
  passenger_name: string;
  passenger_phone: string;
  driver_id?: string;
  driver_name?: string;
  driver_photo?: string;
  driver_phone?: string;
  franchise_no?: string;
  vehicle_plate?: string;
  toda_name?: string;
  toda_id?: string;
  /** Rule 6.6: every booking is for immediate pickup */
  booking_type: 'Immediate';
  is_shared_trip: boolean;
  passenger_count: number;
  pickup_address: string;
  pickup_latitude: number;
  pickup_longitude: number;
  dropoff_address: string;
  dropoff_latitude: number;
  dropoff_longitude: number;
  estimated_distance_km: number;
  /** The estimate confirmed by the passenger, set by the database (Matched Shared Fare Estimate for a Shared trip) */
  estimated_fare: number;
  /** The final, binding fare: written once by the database when the trip arrives (Rule 6.2); null until then */
  actual_fare?: number | null;
  /** The distance recorded from the GPS track, when there was a usable track */
  actual_distance_km?: number | null;
  /** The fare rule the booking was priced on (Rule 6.3) */
  fare_matrix_id?: string | null;
  /** Rule snapshot + estimate + final breakdown: what a receipt prints */
  fare_breakdown?: FareBreakdown | null;
  /** Set when the final fare was computed and locked */
  fare_locked_at?: string | null;
  /** DISPLAY ONLY (the pairing banner). Never a source of money: Batch 10 replaces it with real match data. */
  proportionate_fare?: number;
  paired_booking_count?: number;
  paired_passenger_name?: string;
  booking_status:
    | 'Pending'
    | 'Accepted'
    | 'Driver Assigned'
    | 'Driver En Route'
    | 'Arrived at Pickup'
    | 'Driver Arrived'
    | 'In Transit'
    | 'Trip Ongoing'
    | 'Arrived at Destination'
    | 'Completed'
    | 'Cancelled'
    | 'No Driver Found';
  driver_latitude?: number;
  driver_longitude?: number;
  eta_minutes?: number;
  created_at: string;
  updated_at: string;
}
