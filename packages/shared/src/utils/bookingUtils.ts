/**
 * SAKAY Booking Utilities
 */

/**
 * Formats a long UUID or booking identifier into a compact, deterministic user-facing string.
 * Example: 'b8a4f3e2-1234-5678-90ab-cdef12345678' -> 'SAKAY-B8A4F3'
 */
export function formatShortBookingId(id?: string): string {
  if (!id) return 'SAKAY-000000';
  if (id.startsWith('SAKAY-') && id.length <= 14) return id;
  const clean = id.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (clean.length > 6) {
    return `SAKAY-${clean.slice(0, 6)}`;
  }
  return `SAKAY-${clean}`;
}

/**
 * The statuses of a booking that is still OPEN (Rule 4.4): the search is running, or a driver is committed and the trip is not finished.
 * A passenger may have only one open booking. Mirrors the database (_booking_is_searching + _booking_is_open_accepted); the drift test
 * scripts/db-tests/batch6/config-drift.js fails if the two lists disagree. 'No Driver Found', 'Completed' and 'Cancelled' are not open.
 */
export const BOOKING_OPEN_STATUSES = [
  'Pending',
  'Searching Driver',
  'Accepted',
  'Assigned',
  'Driver Assigned',
  'Driver En Route',
  'Heading to Passenger',
  'In Transit',
  'Driver Arrived',
  'Arrived at Pickup',
  'Trip Ongoing',
  'Ongoing',
  'Arrived at Destination',
] as const;
