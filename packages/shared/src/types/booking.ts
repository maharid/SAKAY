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
  booking_type: 'Immediate' | 'Scheduled';
  is_shared_trip: boolean;
  passenger_count: number;
  pickup_address: string;
  pickup_latitude: number;
  pickup_longitude: number;
  dropoff_address: string;
  dropoff_latitude: number;
  dropoff_longitude: number;
  estimated_distance_km: number;
  estimated_fare: number;
  actual_fare?: number;
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
    | 'Completed'
    | 'Cancelled'
    | 'No Driver Found';
  driver_latitude?: number;
  driver_longitude?: number;
  eta_minutes?: number;
  created_at: string;
  updated_at: string;
}
