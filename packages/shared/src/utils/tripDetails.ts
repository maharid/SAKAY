/**
 * What the Trip Details panel shows, for one booking, to one side of it.
 *
 * Both apps build the panel from the same booking row with this function, so the passenger and the driver of one trip read the same pickup,
 * destination, ride type, fare and stage. It invents nothing: the stage is the database's phase of the booking status (_booking_phase), the
 * fare is the estimate until the database has locked the final one (Rule 6.2), and each side sees only what that role is allowed to
 * (a passenger sees the driver and the tricycle; a driver sees the passenger; neither sees the other's phone here, and a ride-sharing partner's
 * name is not shown to anyone).
 */

/** The phases of a booking, exactly the database's names (public._booking_phase). */
export type BookingPhase = 'searching' | 'assigned' | 'arrived' | 'ongoing' | 'at_destination' | 'completed' | 'cancelled' | 'no_driver';

/** Mirrors public._booking_phase(). The drift test scripts/db-tests/batch6/config-drift.js fails if the two disagree. */
export const BOOKING_PHASE_BY_STATUS: Readonly<Record<string, BookingPhase>> = {
  'Pending': 'searching',
  'Searching Driver': 'searching',
  'Accepted': 'assigned',
  'Assigned': 'assigned',
  'Driver Assigned': 'assigned',
  'Driver En Route': 'assigned',
  'Heading to Passenger': 'assigned',
  'In Transit': 'assigned',
  'Driver Arrived': 'arrived',
  'Arrived at Pickup': 'arrived',
  'Trip Ongoing': 'ongoing',
  'Ongoing': 'ongoing',
  'Arrived at Destination': 'at_destination',
  'Completed': 'completed',
  'Cancelled': 'cancelled',
  'No Driver Found': 'no_driver',
};

export function bookingPhaseOf(status: string | null | undefined): BookingPhase | null {
  if (!status) return null;
  return Object.prototype.hasOwnProperty.call(BOOKING_PHASE_BY_STATUS, status) ? BOOKING_PHASE_BY_STATUS[status] : null;
}

export type TripDetailsRole = 'passenger' | 'driver';

export interface TripDetailsInput {
  role: TripDetailsRole;
  /** The booking_status as the database (or the app's label for it) says */
  status: string | null | undefined;
  pickupAddress?: string | null;
  dropoffAddress?: string | null;
  isSharedTrip?: boolean | null;
  passengerCount?: number | null;
  /** The estimate the passenger confirmed */
  estimatedFare?: number | null;
  /** The final fare; null until the database has locked it */
  actualFare?: number | null;
  /** Set once the database locked the final fare */
  fareLockedAt?: string | null;
  /** fare_breakdown.final.basis: 'solo' | 'matched_estimate_pending_segments' | 'unmatched_solo' (known only once the fare is locked) */
  fareBasis?: string | null;
  /** The OTHER party: the driver for the passenger's screen, the passenger for the driver's */
  counterpartName?: string | null;
  counterpartRating?: number | null;
  /** The tricycle (the passenger's screen only) */
  franchiseNo?: string | null;
  plateNo?: string | null;
  todaName?: string | null;
}

export type FareKind = 'estimate' | 'final';
/** waiting: a shared booking nobody has been matched to yet; matched / unmatched: the database's answer once the fare is locked */
export type SharedOutcome = 'waiting' | 'matched' | 'unmatched';

export interface TripDetailsView {
  phase: BookingPhase;
  pickup: string | null;
  destination: string | null;
  rideType: 'Solo' | 'Shared';
  passengerCount: number;
  fare: { amount: number; kind: FareKind } | null;
  sharedOutcome: SharedOutcome | null;
  counterpart: { role: TripDetailsRole; name: string; rating: number | null } | null;
  vehicle: { franchiseNo: string | null; plateNo: string | null; todaName: string | null } | null;
}

const clean = (value: string | null | undefined): string | null => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text !== '-' ? text : null;
};

const money = (value: number | null | undefined): number | null => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);

/** null when the status is not one a booking may have (nothing is shown rather than something invented). */
export function buildTripDetails(input: TripDetailsInput): TripDetailsView | null {
  const phase = bookingPhaseOf(input.status);
  if (!phase) return null;

  const shared = Boolean(input.isSharedTrip);
  const passengers = Number.isFinite(input.passengerCount) && (input.passengerCount as number) > 0 ? Math.floor(input.passengerCount as number) : 1;

  // The fare is FINAL only once the database has locked it (and the trip has arrived); until then it is only the estimate. A final amount is
  // never shown for a booking the database has not locked, and an estimate is never labelled final.
  const locked = money(input.actualFare) !== null && (Boolean(input.fareLockedAt) || phase === 'at_destination' || phase === 'completed');
  const estimate = money(input.estimatedFare);
  const fare: TripDetailsView['fare'] = locked
    ? { amount: money(input.actualFare) as number, kind: 'final' }
    : estimate !== null && phase !== 'cancelled' && phase !== 'no_driver'
    ? { amount: estimate, kind: 'estimate' }
    : null;

  // Matching is "waiting" only while the trip can still be matched; once it has arrived the panel states only what the database locked, and says nothing
  // rather than claim that matching goes on.
  const tripOver = phase === 'at_destination' || phase === 'completed';
  let sharedOutcome: SharedOutcome | null = null;
  if (shared && phase !== 'cancelled' && phase !== 'no_driver') {
    sharedOutcome =
      locked && input.fareBasis === 'matched_estimate_pending_segments' ? 'matched' : locked && input.fareBasis === 'unmatched_solo' ? 'unmatched' : tripOver ? null : 'waiting';
  }

  // Who is on the other end exists only once a driver has accepted, and goes away when the booking ends without a trip.
  const hasCounterpartPhase = phase === 'assigned' || phase === 'arrived' || phase === 'ongoing' || phase === 'at_destination' || phase === 'completed';
  const counterpartName = clean(input.counterpartName);
  const counterpart =
    hasCounterpartPhase && counterpartName
      ? {
          role: (input.role === 'passenger' ? 'driver' : 'passenger') as TripDetailsRole,
          name: counterpartName,
          rating: typeof input.counterpartRating === 'number' && Number.isFinite(input.counterpartRating) && input.counterpartRating > 0 ? input.counterpartRating : null,
        }
      : null;

  // The tricycle is the passenger's to know (to recognise it at the pickup); the driver already is in it.
  const vehicleParts = { franchiseNo: clean(input.franchiseNo), plateNo: clean(input.plateNo), todaName: clean(input.todaName) };
  const vehicle =
    input.role === 'passenger' && hasCounterpartPhase && (vehicleParts.franchiseNo || vehicleParts.plateNo || vehicleParts.todaName) ? vehicleParts : null;

  return {
    phase,
    pickup: clean(input.pickupAddress),
    destination: clean(input.dropoffAddress),
    rideType: shared ? 'Shared' : 'Solo',
    passengerCount: passengers,
    fare,
    sharedOutcome,
    counterpart,
    vehicle,
  };
}
