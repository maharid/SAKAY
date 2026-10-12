import { BOOKING_OPEN_STATUSES, reportNetworkOutcome } from '@sakay/shared';

import { supabase } from './supabaseClient';

// Rule 29.2: a crash, a reload or a reopened app does not lose the trip: the booking, its status and the GPS trail are the database's. This is how
// the Driver app finds its way back to a trip it has been given: it asks the DATABASE (row security shows a driver only his own bookings), not
// the browser's memory (the trip screens used to learn the booking only from the screen that opened them).

/** A booking the driver has accepted and that is not finished: the search statuses are not his yet. */
const ACCEPTED_STATUSES: readonly string[] = BOOKING_OPEN_STATUSES.filter((s) => s !== 'Pending' && s !== 'Searching Driver');

/** On the way to the pickup: the navigation screen. Arrived at the pickup or later: the trip screen. */
const ON_THE_WAY_STATUSES: readonly string[] = ['Accepted', 'Assigned', 'Driver Assigned', 'Driver En Route', 'Heading to Passenger', 'In Transit'];

export interface DriverOpenBooking {
  bookingId: string;
  status: string;
  pickupAddress: string;
  dropoffAddress: string;
  /** Where the app takes him: the route and the state that screen reads */
  route: '/driver/navigation' | '/driver/active-trip';
}

/** The driver's open booking as the database has it, or null (none, or it could not be read). */
export const fetchDriverOpenBooking = async (): Promise<DriverOpenBooking | null> => {
  const { data, error } = await supabase
    .from('booking')
    .select('booking_id, booking_status, pickup_address, dropoff_address')
    .in('booking_status', [...ACCEPTED_STATUSES])
    .not('driver_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  reportNetworkOutcome(error);
  if (error || !data) return null;
  const status = String(data.booking_status);
  return {
    bookingId: String(data.booking_id),
    status,
    pickupAddress: String(data.pickup_address ?? ''),
    dropoffAddress: String(data.dropoff_address ?? ''),
    route: ON_THE_WAY_STATUSES.includes(status) ? '/driver/navigation' : '/driver/active-trip',
  };
};
