// What the Trip Details panel shows at each stage, to each side of the trip (packages/shared/src/utils/tripDetails.ts).
//   run:  cd server && npx tsx --test test/*.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOKING_PHASE_BY_STATUS,
  bookingPhaseOf,
  buildTripDetails,
  type BookingPhase,
  type TripDetailsInput,
} from '../../packages/shared/src/utils/tripDetails';

const trip = (over: Partial<TripDetailsInput> = {}): TripDetailsInput => ({
  role: 'passenger',
  status: 'Trip Ongoing',
  pickupAddress: 'Divine Word College of Calapan, Calapan City',
  dropoffAddress: 'Calapan Public Market',
  isSharedTrip: false,
  passengerCount: 1,
  estimatedFare: 60,
  actualFare: null,
  fareLockedAt: null,
  fareBasis: null,
  counterpartName: 'Laurent Lopez',
  counterpartRating: 4.0,
  franchiseNo: 'CAL-TEST-0001',
  plateNo: 'TST 1234',
  todaName: 'Calapan Central TODA',
  ...over,
});

const ALL_STATUSES = Object.keys(BOOKING_PHASE_BY_STATUS);

describe('the stage is the database\'s phase', () => {
  it('maps every status the apps write to its phase, and nothing else to a phase', () => {
    assert.equal(bookingPhaseOf('Pending'), 'searching');
    assert.equal(bookingPhaseOf('Searching Driver'), 'searching');
    assert.equal(bookingPhaseOf('Accepted'), 'assigned');
    assert.equal(bookingPhaseOf('In Transit'), 'assigned');
    assert.equal(bookingPhaseOf('Driver Arrived'), 'arrived');
    assert.equal(bookingPhaseOf('Arrived at Pickup'), 'arrived');
    assert.equal(bookingPhaseOf('Trip Ongoing'), 'ongoing');
    assert.equal(bookingPhaseOf('Arrived at Destination'), 'at_destination');
    assert.equal(bookingPhaseOf('Completed'), 'completed');
    assert.equal(bookingPhaseOf('Cancelled'), 'cancelled');
    assert.equal(bookingPhaseOf('No Driver Found'), 'no_driver');
    for (const bad of [null, undefined, '', 'Teleported', 'toString', '__proto__']) assert.equal(bookingPhaseOf(bad), null, String(bad));
  });

  it('draws nothing for a status a booking cannot have (it invents no stage)', () => {
    assert.equal(buildTripDetails(trip({ status: 'Teleported' })), null);
    assert.equal(buildTripDetails(trip({ status: null })), null);
  });
});

describe('the panel is available at every stage, to both sides', () => {
  it('builds a view for every status and both roles', () => {
    for (const status of ALL_STATUSES) {
      for (const role of ['passenger', 'driver'] as const) {
        const view = buildTripDetails(trip({ role, status }));
        assert.ok(view, `${role} / ${status}`);
        assert.equal(view.phase, BOOKING_PHASE_BY_STATUS[status]);
        assert.equal(view.pickup, 'Divine Word College of Calapan, Calapan City');
        assert.equal(view.destination, 'Calapan Public Market');
      }
    }
  });

  it('finding a driver: the route, the ride type and the estimate, nobody else yet', () => {
    const v = buildTripDetails(trip({ status: 'Pending', counterpartName: null, franchiseNo: null, plateNo: null, todaName: null })) as NonNullable<ReturnType<typeof buildTripDetails>>;
    assert.equal(v.phase, 'searching');
    assert.deepEqual(v.fare, { amount: 60, kind: 'estimate' });
    assert.equal(v.counterpart, null);
    assert.equal(v.vehicle, null);
    assert.equal(v.rideType, 'Solo');
  });

  it('heading to the pickup: the passenger sees the driver and the tricycle, the driver sees the passenger', () => {
    const p = buildTripDetails(trip({ role: 'passenger', status: 'In Transit' })) as NonNullable<ReturnType<typeof buildTripDetails>>;
    assert.deepEqual(p.counterpart, { role: 'driver', name: 'Laurent Lopez', rating: 4 });
    assert.deepEqual(p.vehicle, { franchiseNo: 'CAL-TEST-0001', plateNo: 'TST 1234', todaName: 'Calapan Central TODA' });
    const d = buildTripDetails(trip({ role: 'driver', status: 'In Transit', counterpartName: 'Allena Arguelles', counterpartRating: null })) as NonNullable<ReturnType<typeof buildTripDetails>>;
    assert.deepEqual(d.counterpart, { role: 'passenger', name: 'Allena Arguelles', rating: null });
    assert.equal(d.vehicle, null, 'a driver is not shown his own tricycle');
  });

  it('at the pickup, on the trip, at the destination and after it: still there', () => {
    for (const status of ['Driver Arrived', 'Trip Ongoing', 'Arrived at Destination', 'Completed']) {
      const v = buildTripDetails(trip({ status })) as NonNullable<ReturnType<typeof buildTripDetails>>;
      assert.equal(v.counterpart?.name, 'Laurent Lopez', status);
      assert.ok(v.vehicle, status);
    }
  });

  it('a booking that ended without a trip shows its route but no driver and no fare', () => {
    for (const status of ['Cancelled', 'No Driver Found']) {
      const v = buildTripDetails(trip({ status })) as NonNullable<ReturnType<typeof buildTripDetails>>;
      assert.equal(v.counterpart, null, status);
      assert.equal(v.vehicle, null, status);
      assert.equal(v.fare, null, status);
      assert.equal(v.sharedOutcome, null, status);
    }
  });
});

describe('the fare is an estimate until the database has locked it', () => {
  it('shows the estimate while the trip is on, even if a final figure is somehow present but not locked', () => {
    const v = buildTripDetails(trip({ status: 'Trip Ongoing', estimatedFare: 60, actualFare: 74, fareLockedAt: null })) as NonNullable<ReturnType<typeof buildTripDetails>>;
    assert.deepEqual(v.fare, { amount: 60, kind: 'estimate' });
  });

  it('shows the final fare once locked / arrived, labelled final', () => {
    const arrived = buildTripDetails(trip({ status: 'Arrived at Destination', estimatedFare: 60, actualFare: 74, fareLockedAt: '2026-10-10T06:00:00Z' })) as NonNullable<ReturnType<typeof buildTripDetails>>;
    assert.deepEqual(arrived.fare, { amount: 74, kind: 'final' });
    const done = buildTripDetails(trip({ status: 'Completed', estimatedFare: 60, actualFare: 74 })) as NonNullable<ReturnType<typeof buildTripDetails>>;
    assert.deepEqual(done.fare, { amount: 74, kind: 'final' });
  });

  it('shows no fare rather than a made-up one when none is known', () => {
    const v = buildTripDetails(trip({ estimatedFare: 0, actualFare: null })) as NonNullable<ReturnType<typeof buildTripDetails>>;
    assert.equal(v.fare, null);
    const w = buildTripDetails(trip({ estimatedFare: NaN as number, actualFare: null })) as NonNullable<ReturnType<typeof buildTripDetails>>;
    assert.equal(w.fare, null);
  });
});

describe('ride type and sharing', () => {
  it('solo has no sharing note', () => {
    const v = buildTripDetails(trip({ isSharedTrip: false })) as NonNullable<ReturnType<typeof buildTripDetails>>;
    assert.equal(v.rideType, 'Solo');
    assert.equal(v.sharedOutcome, null);
  });

  it('a shared booking is "waiting" for a match until the database has locked the fare', () => {
    for (const status of ['Pending', 'In Transit', 'Trip Ongoing']) {
      const v = buildTripDetails(trip({ status, isSharedTrip: true, passengerCount: 2 })) as NonNullable<ReturnType<typeof buildTripDetails>>;
      assert.equal(v.rideType, 'Shared', status);
      assert.equal(v.sharedOutcome, 'waiting', status);
      assert.equal(v.passengerCount, 2);
    }
  });

  it('...and matched / unmatched only as the locked fare basis says', () => {
    const base = { isSharedTrip: true, status: 'Arrived at Destination', actualFare: 50, fareLockedAt: '2026-10-10T06:00:00Z' };
    assert.equal((buildTripDetails(trip({ ...base, fareBasis: 'matched_estimate_pending_segments' })) as NonNullable<ReturnType<typeof buildTripDetails>>).sharedOutcome, 'matched');
    assert.equal((buildTripDetails(trip({ ...base, fareBasis: 'unmatched_solo' })) as NonNullable<ReturnType<typeof buildTripDetails>>).sharedOutcome, 'unmatched');
    assert.equal((buildTripDetails(trip({ ...base, fareBasis: null })) as NonNullable<ReturnType<typeof buildTripDetails>>).sharedOutcome, null, 'an arrived trip never claims that matching continues');
    assert.equal((buildTripDetails(trip({ ...base, fareBasis: 'solo', status: 'Completed' })) as NonNullable<ReturnType<typeof buildTripDetails>>).sharedOutcome, null);
  });

  it('never claims a match from anything but the locked fare basis (a basis without a lock is not an answer)', () => {
    const v = buildTripDetails(trip({ isSharedTrip: true, status: 'Trip Ongoing', fareBasis: 'matched_estimate_pending_segments', actualFare: null })) as NonNullable<ReturnType<typeof buildTripDetails>>;
    assert.equal(v.sharedOutcome, 'waiting');
  });

  it('counts at least one passenger', () => {
    for (const bad of [0, -3, NaN, null, undefined]) assert.equal((buildTripDetails(trip({ passengerCount: bad as number })) as NonNullable<ReturnType<typeof buildTripDetails>>).passengerCount, 1);
  });
});

describe('privacy and consistency', () => {
  it('shows neither side\'s phone, nor any ride-sharing partner\'s name, whatever the input carries', () => {
    const input = { ...trip({ isSharedTrip: true }), counterpartPhone: '09171234567', pairedPassengerName: 'Joshua Dizon' } as TripDetailsInput;
    const json = JSON.stringify(buildTripDetails(input));
    assert.ok(!/0917|Joshua/.test(json));
  });

  it('the passenger and the driver of one trip read the same route, ride type, fare and stage', () => {
    for (const status of ALL_STATUSES) {
      const input = trip({ status, isSharedTrip: true, passengerCount: 2, actualFare: 74, fareLockedAt: status === 'Completed' ? '2026-10-10T06:00:00Z' : null });
      const p = buildTripDetails({ ...input, role: 'passenger' });
      const d = buildTripDetails({ ...input, role: 'driver' });
      assert.deepEqual(
        { phase: p?.phase, pickup: p?.pickup, destination: p?.destination, rideType: p?.rideType, fare: p?.fare, shared: p?.sharedOutcome, n: p?.passengerCount },
        { phase: d?.phase, pickup: d?.pickup, destination: d?.destination, rideType: d?.rideType, fare: d?.fare, shared: d?.sharedOutcome, n: d?.passengerCount },
        status
      );
    }
  });

  it('keeps long place names whole (the panel wraps them) and trims blanks and the "-" placeholder to nothing', () => {
    const long = 'Barangay Santa Maria Village, near the old Calapan City Public Market beside the Mindoro Oriental Provincial Capitol Compound, Calapan City';
    const v = buildTripDetails(trip({ pickupAddress: long, dropoffAddress: '   ', franchiseNo: '-', plateNo: '', todaName: undefined })) as NonNullable<ReturnType<typeof buildTripDetails>>;
    assert.equal(v.pickup, long);
    assert.equal(v.destination, null);
    assert.equal(v.vehicle, null);
  });

  it('knows the eight phases and no more', () => {
    const phases = new Set<BookingPhase>(Object.values(BOOKING_PHASE_BY_STATUS));
    assert.deepEqual([...phases].sort(), ['arrived', 'assigned', 'at_destination', 'cancelled', 'completed', 'no_driver', 'ongoing', 'searching']);
  });
});
