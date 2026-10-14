import { BOOKING_OPEN_STATUSES, reportNetworkOutcome } from '@sakay/shared';

import { supabase } from './supabaseClient';

// Rule 29.2: a crash, a reload or a reopened app does not lose the trip: the booking, its status and the GPS trail are the database's. This is how
// the Driver app finds its way back to a trip it has been given: it asks the DATABASE (row security shows a driver only his own bookings), not
// the browser's memory (the trip screens used to learn the booking only from the screen that opened them).
//
// A driver normally carries ONE booking. On a Shared Trip (Section 14) he carries two, one per passenger (Rule 14.6: each leg is its own booking and its own rules),
// so the screens ask for the list and pick the leg to show; the driver can switch legs at any time (SharedLegSwitcher).

/** A booking the driver has accepted and that is not finished: the search statuses are not his yet. */
const ACCEPTED_STATUSES: readonly string[] = BOOKING_OPEN_STATUSES.filter((s) => s !== 'Pending' && s !== 'Searching Driver');

/** On the way to the pickup: the navigation screen. Arrived at the pickup or later: the trip screen. */
const ON_THE_WAY_STATUSES: readonly string[] = ['Accepted', 'Assigned', 'Driver Assigned', 'Driver En Route', 'Heading to Passenger', 'In Transit'];
const ARRIVED_STATUSES: readonly string[] = ['Driver Arrived', 'Arrived at Pickup'];
const ONGOING_STATUSES: readonly string[] = ['Trip Ongoing', 'Ongoing'];

/** How far along a leg is: the leg furthest along (the passenger on board before the one still being fetched) is the one the app opens first. */
export type LegStage = 'on_the_way' | 'at_pickup' | 'on_board' | 'at_destination';
export const legStageOf = (status: string): LegStage =>
  ONGOING_STATUSES.includes(status) ? 'on_board' : ARRIVED_STATUSES.includes(status) ? 'at_pickup' : ON_THE_WAY_STATUSES.includes(status) ? 'on_the_way' : 'at_destination';
const STAGE_RANK: Record<LegStage, number> = { on_board: 3, at_pickup: 2, on_the_way: 1, at_destination: 0 };

export interface DriverOpenBooking {
  bookingId: string;
  status: string;
  pickupAddress: string;
  dropoffAddress: string;
  /** When the booking was made: the first booking of a Shared Trip is leg 1 */
  createdAt: string;
  /** Where the app takes him: the route and the state that screen reads */
  route: '/driver/navigation' | '/driver/active-trip';
}

/** Every open booking of the driver as the database has it, oldest first (one, or two on a Shared Trip); empty when none, or when it could not be read. */
export const fetchDriverOpenBookings = async (): Promise<DriverOpenBooking[]> => {
  const { data, error } = await supabase
    .from('booking')
    .select('booking_id, booking_status, pickup_address, dropoff_address, created_at')
    .in('booking_status', [...ACCEPTED_STATUSES])
    .not('driver_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(4);
  reportNetworkOutcome(error);
  if (error || !data) return [];
  return data.map((row) => {
    const status = String(row.booking_status);
    return {
      bookingId: String(row.booking_id),
      status,
      pickupAddress: String(row.pickup_address ?? ''),
      dropoffAddress: String(row.dropoff_address ?? ''),
      createdAt: String(row.created_at ?? ''),
      route: ON_THE_WAY_STATUSES.includes(status) ? '/driver/navigation' : '/driver/active-trip',
    };
  });
};

/** The leg to show first: the one furthest along; the older booking when two are alike. null when there is none. */
export const pickCurrentLeg = (legs: readonly DriverOpenBooking[]): DriverOpenBooking | null =>
  legs.length === 0 ? null : [...legs].sort((a, b) => STAGE_RANK[legStageOf(b.status)] - STAGE_RANK[legStageOf(a.status)] || a.createdAt.localeCompare(b.createdAt))[0];

/** The driver's open booking as the database has it, or null (none, or it could not be read). */
export const fetchDriverOpenBooking = async (): Promise<DriverOpenBooking | null> => pickCurrentLeg(await fetchDriverOpenBookings());
