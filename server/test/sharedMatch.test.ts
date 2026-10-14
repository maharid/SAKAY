// Ride-sharing on the screens (Section 14; packages/shared/src/utils/sharedMatch.ts and the trip-details outcome of tripDetails.ts).
//   run:  cd server && npx tsx --test test/*.test.ts
// The rules themselves are the database's (scripts/db-tests/batch10/*); this file checks what the apps do with its answers: what they read, what they can never show, the
// words, and the exact calls they make.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeOtherParty,
  directionLabel,
  fetchMySharedRequest,
  fetchSharedMatchState,
  parseSharedMatchState,
  parseSharedRequest,
  pickupAreaLabel,
  reportPassengerCount,
  respondSharedMatch,
  respondSharedRequest,
  type SharedOtherParty,
} from '../../packages/shared/src/utils/sharedMatch';
import { buildTripDetails, type TripDetailsInput } from '../../packages/shared/src/utils/tripDetails';
import {
  FARE_SEAT_CAPACITY,
  RIDE_SHARING_CUTOFF_PERCENT,
  SHARED_BOOKING_MAX_PASSENGERS,
  SHARED_TRIP_MAX_BOOKINGS,
  SHARED_TRIP_PASSENGER_RESPONSE_SECONDS,
} from '../../packages/shared/src/config/policyConfig';

type Call = { fn: string; args: Record<string, unknown> | undefined };
const fakeClient = (answer: unknown, error: unknown = null) => {
  const calls: Call[] = [];
  return { calls, rpc: (fn: string, args?: Record<string, unknown>) => { calls.push({ fn, args }); return Promise.resolve({ data: answer, error }); } };
};

const matchedAnswer = (over: Record<string, unknown> = {}) => ({
  success: true, booking_id: 'b1', is_shared_trip: true, role: 'first', state: 'awaiting_my_consent', match_id: 'm1', closed_reason: null, matching_open: false,
  progress_pct: 12, cutoff_pct: 50, expires_at: '2026-10-12T10:00:20Z', seconds_remaining: 18, server_time: '2026-10-12T10:00:02Z',
  other: { mobile_verified: true, party_size: 2, pickup_area: 'Ilaya', direction: 'NE' },
  driver: { name: 'Driver One', vehicle: 'Tricycle', plate_number: 'ABC-1234', franchise_number: 'FR-0001' },
  ...over,
});

describe('the shared-match state of a booking', () => {
  it('reads the database\'s answer into the shape the screens use', () => {
    const v = parseSharedMatchState(matchedAnswer());
    assert.ok(v);
    assert.equal(v.state, 'awaiting_my_consent');
    assert.equal(v.role, 'first');
    assert.equal(v.matchId, 'm1');
    assert.equal(v.secondsRemaining, 18);
    assert.deepEqual(v.other, { mobileVerified: true, partySize: 2, pickupArea: 'Ilaya', direction: 'NE' });
    assert.deepEqual(v.driver, { name: 'Driver One', vehicle: 'Tricycle', plateNumber: 'ABC-1234', franchiseNumber: 'FR-0001' });
  });

  it('keeps ONLY the permitted facts about the other passenger, whatever else an answer carries (Rule 14.2.1)', () => {
    const hostile = matchedAnswer({
      other: { mobile_verified: true, party_size: 1, pickup_area: 'Ilaya', direction: 'N', full_name: 'Joshua Dizon', contact_number: '09171234567', pickup_address: 'Blk 7 Lot 3', pickup_latitude: 13.41 },
    });
    const json = JSON.stringify(parseSharedMatchState(hostile));
    assert.ok(!/Joshua|0917|Blk 7|13\.41/.test(json), json);
  });

  it('a state the apps do not know is "none", an unknown compass point is no direction, a failed call is no answer', () => {
    assert.equal(parseSharedMatchState(matchedAnswer({ state: 'something_new' }))?.state, 'none');
    assert.equal(parseSharedMatchState(matchedAnswer({ other: { mobile_verified: true, party_size: 1, pickup_area: null, direction: 'UP' } }))?.other?.direction, null);
    assert.equal(parseSharedMatchState({ success: false, error_code: 'ERR_NOT_YOUR_BOOKING' }), null);
    assert.equal(parseSharedMatchState(null), null);
    assert.equal(parseSharedMatchState('x'), null);
  });

  it('a state without a pairing carries no other party and no driver', () => {
    const v = parseSharedMatchState(matchedAnswer({ state: 'none', role: null, match_id: null, other: null, driver: null, matching_open: true, seconds_remaining: null, expires_at: null }));
    assert.ok(v);
    assert.equal(v.other, null);
    assert.equal(v.driver, null);
    assert.equal(v.matchingOpen, true);
    assert.equal(v.secondsRemaining, null);
  });

  it('asks the database with the booking id, and answers null when it cannot be read', async () => {
    const ok = fakeClient(matchedAnswer());
    assert.ok(await fetchSharedMatchState(ok, 'b1'));
    assert.deepEqual(ok.calls, [{ fn: 'get_shared_match_state', args: { p_booking_id: 'b1' } }]);
    assert.equal(await fetchSharedMatchState(fakeClient(null, { message: 'down' }), 'b1'), null);
    const boom = { rpc: () => { throw new Error('offline'); } };
    assert.equal(await fetchSharedMatchState(boom as never, 'b1'), null);
  });
});

describe('the buttons make exactly the calls the database has', () => {
  it('Accept / Decline Shared Match (the first passenger, Rule 14.5)', async () => {
    const c = fakeClient({ success: true, state: 'matched' });
    const r = await respondSharedMatch(c, 'm1', true);
    assert.equal(r.ok, true);
    assert.deepEqual(c.calls, [{ fn: 'passenger_respond_shared_match', args: { p_match_id: 'm1', p_accept: true } }]);
    const d = fakeClient({ success: true, state: 'declined' });
    await respondSharedMatch(d, 'm1', false);
    assert.deepEqual(d.calls[0].args, { p_match_id: 'm1', p_accept: false });
  });

  it('Accept / Decline of the driver\'s Additional Shared Passenger Request (Rule 14.3)', async () => {
    const c = fakeClient({ success: true, state: 'declined' });
    await respondSharedRequest(c, 'm9', false);
    assert.deepEqual(c.calls, [{ fn: 'driver_respond_shared_request', args: { p_match_id: 'm9', p_accept: false } }]);
  });

  it('the report of a passenger count (Rules 14.7, 29.17)', async () => {
    const c = fakeClient({ success: true, over_capacity: false });
    await reportPassengerCount(c, 'b1', 3, 'two adults');
    assert.deepEqual(c.calls, [{ fn: 'driver_report_passenger_count', args: { p_booking_id: 'b1', p_actual_count: 3, p_note: 'two adults' } }]);
    const d = fakeClient({ success: true });
    await reportPassengerCount(d, 'b1', 2);
    assert.equal(d.calls[0].args?.p_note, null);
  });

  it('a refusal arrives with the database\'s code and its own sentence; a missing answer is a network failure', async () => {
    const refused = await respondSharedMatch(fakeClient({ success: false, error_code: 'ERR_RESPONSE_EXPIRED', error: 'The time to answer has ended.' }), 'm1', true);
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'ERR_RESPONSE_EXPIRED');
    assert.equal(refused.error, 'The time to answer has ended.');
    const raised = await respondSharedMatch(fakeClient(null, { message: 'ERR_MATCH_CLOSED: This shared match is no longer open.' }), 'm1', true);
    assert.equal(raised.code, 'ERR_MATCH_CLOSED');
    assert.equal(raised.error, 'This shared match is no longer open.');
    const none = await respondSharedMatch(fakeClient(null), 'm1', true);
    assert.equal(none.code, 'NETWORK');
  });
});

describe('the driver\'s request', () => {
  const row = {
    match_id: 'm1', booking_id: 'b2', passenger_first_name: 'Maria', passenger_count: 2, pickup_address: 'Ilaya Market', pickup_latitude: 13.41, pickup_longitude: 121.18,
    dropoff_address: 'Calapan Port', dropoff_latitude: 13.43, dropoff_longitude: 121.19, estimated_distance_km: 3.4, current_party_size: 1, host_progress_pct: 0,
    pickup_gap_m: 150, first_added_m: 0, second_added_m: 12, window_seconds: 15, seconds_remaining: 14, expires_at: '2026-10-12T10:00:20Z', server_time: '2026-10-12T10:00:05Z',
  };
  it('reads the request, and nothing when there is none', async () => {
    const v = parseSharedRequest(row);
    assert.ok(v);
    assert.equal(v.passengerFirstName, 'Maria');
    assert.equal(v.passengerCount, 2);
    assert.equal(v.windowSeconds, 15);
    assert.equal(v.secondsRemaining, 14);
    assert.equal(parseSharedRequest(null), null);
    assert.equal(parseSharedRequest({ booking_id: 'x' }), null);
    const c = fakeClient(row);
    assert.ok(await fetchMySharedRequest(c));
    assert.deepEqual(c.calls, [{ fn: 'get_my_shared_request', args: {} }]);
    assert.equal(await fetchMySharedRequest(fakeClient(null)), null);
  });
});

describe('the words', () => {
  it('all eight compass points have a word in English and in Filipino, and a missing direction says so', () => {
    const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
    for (const p of points) {
      assert.ok(directionLabel(p, 'en').length > 0 && directionLabel(p, 'tl').length > 0, p);
    }
    assert.equal(new Set(points.map((p) => directionLabel(p, 'en'))).size, 8);
    assert.equal(new Set(points.map((p) => directionLabel(p, 'tl'))).size, 8);
    assert.equal(directionLabel('NE', 'en'), 'north-east');
    assert.equal(directionLabel('NE', 'tl'), 'hilagang-silangan');
    assert.equal(directionLabel(null, 'en'), 'not known');
  });

  it('the area is the barangay, else the city; the description of the other passenger carries only the permitted facts', () => {
    assert.equal(pickupAreaLabel('Ilaya'), 'Brgy. Ilaya');
    assert.equal(pickupAreaLabel(null), 'Calapan City');
    const other: SharedOtherParty = { mobileVerified: true, partySize: 2, pickupArea: 'Ilaya', direction: 'N' };
    assert.equal(describeOtherParty(other, 'en'), 'Mobile-Verified · 2 passengers · pickup in Brgy. Ilaya · heading north');
    assert.equal(describeOtherParty({ ...other, mobileVerified: false, partySize: 1 }, 'en'), 'Not Mobile-Verified · 1 passenger · pickup in Brgy. Ilaya · heading north');
    assert.match(describeOtherParty(other, 'tl'), /Mobile-Verified · 2 pasahero · sundo sa Brgy\. Ilaya · papuntang hilaga/);
  });
});

describe('what the Trip Details panel says about matching', () => {
  const trip = (over: Partial<TripDetailsInput> = {}): TripDetailsInput => ({
    role: 'passenger', status: 'In Transit', pickupAddress: 'A', dropoffAddress: 'B', isSharedTrip: true, passengerCount: 1, estimatedFare: 40, ...over,
  });
  const outcome = (over: Partial<TripDetailsInput>) => (buildTripDetails(trip(over)) as NonNullable<ReturnType<typeof buildTripDetails>>).sharedOutcome;

  it('"waiting" while matching is open (or unknown), "ended" once it closed, "matched" for a confirmed pairing', () => {
    assert.equal(outcome({}), 'waiting');
    assert.equal(outcome({ sharedMatchingOpen: true }), 'waiting');
    assert.equal(outcome({ sharedMatchingOpen: false }), 'ended');
    assert.equal(outcome({ sharedMatchingOpen: false, status: 'Trip Ongoing' }), 'ended');
    assert.equal(outcome({ sharedPaired: true, sharedMatchingOpen: false }), 'matched');
  });

  it('a booking still searching for a driver is never "ended": matching has not started', () => {
    assert.equal(outcome({ status: 'Searching Driver', sharedMatchingOpen: false }), 'waiting');
  });

  it('the locked basis wins: shared_allocated and the estimate basis are both "matched", unmatched_solo is "unmatched"', () => {
    const lock = { status: 'Arrived at Destination', actualFare: 50, fareLockedAt: '2026-10-12T06:00:00Z', sharedMatchingOpen: false };
    assert.equal(outcome({ ...lock, fareBasis: 'shared_allocated' }), 'matched');
    assert.equal(outcome({ ...lock, fareBasis: 'matched_estimate_pending_segments' }), 'matched');
    assert.equal(outcome({ ...lock, fareBasis: 'unmatched_solo' }), 'unmatched');
    assert.equal(outcome({ ...lock, fareBasis: null }), null);
  });

  it('an ordinary Solo booking has no shared outcome at all', () => {
    assert.equal(outcome({ isSharedTrip: false, sharedMatchingOpen: false }), null);
  });
});

describe('the numbers', () => {
  it('a Shared booking may declare one seat fewer than the tricycle has (a seat stays free for the second booking); 4 book Solo', () => {
    assert.equal(FARE_SEAT_CAPACITY, 4);
    assert.equal(SHARED_BOOKING_MAX_PASSENGERS, 3);
    assert.equal(SHARED_TRIP_MAX_BOOKINGS, 2);
    assert.equal(RIDE_SHARING_CUTOFF_PERCENT, 50);
    assert.equal(SHARED_TRIP_PASSENGER_RESPONSE_SECONDS, 20);
  });
});
