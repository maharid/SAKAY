// Trip progress and the 90% finish boundary (packages/shared/src/utils/tripProgress.ts). The database enforces the same boundary with the
// same formula (supabase/migrations/20261017000001, scripts/db-tests/batch6/trip-finish-progress.js); the golden distances below are the
// ones that suite checks against the SQL, so the two implementations cannot drift apart.
//   run:  cd server && npx tsx --test test/*.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateTripProgressFromPositions,
  calculateTripProgressPercent,
  fetchServerTripProgress,
  isTripFinishable,
} from '../../packages/shared/src/utils/tripProgress';
import { calculateDistanceKm } from '../../packages/shared/src/utils/locationUtils';
import {
  TRIP_FINISH_MIN_PROGRESS_PERCENT,
  TRIP_PROGRESS_CAP_PERCENT,
  TRIP_PROGRESS_FLOOR_PERCENT,
  TRIP_PROGRESS_NEAR_DESTINATION_METERS,
} from '../../packages/shared/src/config/policyConfig';

const GOLDEN: Array<[[number, number, number, number], number]> = [
  [[13.4115, 121.1803, 13.4415, 121.1803], 3.32],
  [[13.4115, 121.1803, 13.4115, 121.1903], 1.08],
  [[13.4117, 121.1803, 13.418, 121.185], 0.86],
  [[13.4115, 121.1803, 13.4116, 121.1803], 0.01],
  [[13.0, 121.0, 13.4415, 121.1803], 52.58],
];
const TOTAL = 3.32;
const progressAtKm = (km: number, previousPercent = 0) => calculateTripProgressPercent({ totalKm: TOTAL, driverToDestinationKm: km, previousPercent });

describe('the straight-line distance the progress is built on', () => {
  it('matches the golden values the database suite checks (km, rounded to 10 m)', () => {
    for (const [[a, b, c, d], km] of GOLDEN) assert.equal(calculateDistanceKm(a, b, c, d), km, `${a},${b} -> ${c},${d}`);
  });
});

describe('the policy numbers', () => {
  it('finish from 90%, cap 95%, floor 5%, near the pin within 80 m', () => {
    assert.equal(TRIP_FINISH_MIN_PROGRESS_PERCENT, 90);
    assert.equal(TRIP_PROGRESS_CAP_PERCENT, 95);
    assert.equal(TRIP_PROGRESS_FLOOR_PERCENT, 5);
    assert.equal(TRIP_PROGRESS_NEAR_DESTINATION_METERS, 80);
  });
});

describe('calculateTripProgressPercent', () => {
  it('reads the share of the straight line already covered, in whole percent', () => {
    assert.equal(progressAtKm(TOTAL), 5); // still at the pickup: the floor
    assert.equal(progressAtKm(1.66), 50);
    assert.equal(progressAtKm(0.36), 89); // (3.32 - 0.36) / 3.32 = 89.2
    assert.equal(progressAtKm(0.33), 90); // 90.06
    assert.equal(progressAtKm(0.34), 90); // 89.76 rounds to 90
    assert.equal(progressAtKm(0.35), 89); // 89.46 rounds to 89
  });

  it('reads the maximum within 80 m of the pin, and never more than 95 while the trip is on', () => {
    assert.equal(progressAtKm(0.08), 95);
    assert.equal(progressAtKm(0.01), 95);
    assert.equal(progressAtKm(0), 95);
    assert.equal(progressAtKm(0.09), 95); // just outside the near distance the plain figure is 97.3, capped to 95
    assert.equal(progressAtKm(0.2), 94); // 93.98: below the cap, so the plain figure
    assert.ok(progressAtKm(0.09) <= TRIP_PROGRESS_CAP_PERCENT);
  });

  it('never goes below the floor, however far the position is', () => {
    assert.equal(progressAtKm(20), 5);
    assert.equal(progressAtKm(1000), 5);
  });

  it('does not slide back: the best figure already shown is kept', () => {
    assert.equal(progressAtKm(0.2, 0), 94);
    assert.equal(progressAtKm(1.5, 94), 94);
    assert.equal(progressAtKm(1.5, 0), 55);
  });

  it('keeps the previous value when the position is unreadable (never NaN, never negative)', () => {
    for (const bad of [NaN, Infinity, -1, undefined as unknown as number]) {
      assert.equal(calculateTripProgressPercent({ totalKm: TOTAL, driverToDestinationKm: bad, previousPercent: 42 }), 42);
      assert.equal(calculateTripProgressPercent({ totalKm: TOTAL, driverToDestinationKm: bad }), 0);
    }
  });

  it('copes with a trip whose pickup and destination are the same point', () => {
    assert.equal(calculateTripProgressPercent({ totalKm: 0, driverToDestinationKm: 0.5 }), 50);
    assert.equal(calculateTripProgressPercent({ totalKm: 0, driverToDestinationKm: 0.05 }), 95);
    assert.equal(calculateTripProgressPercent({ totalKm: NaN, driverToDestinationKm: 0.5 }), 50);
  });
});

describe('the 90% finish boundary', () => {
  it('89% is not finishable; 90, 95 and 100 are', () => {
    assert.equal(isTripFinishable(89), false);
    assert.equal(isTripFinishable(90), true);
    assert.equal(isTripFinishable(95), true);
    assert.equal(isTripFinishable(100), true);
  });

  it('is inclusive and on the whole percent: 89.6 displayed as 90 is what the database compares', () => {
    assert.equal(isTripFinishable(progressAtKm(0.34)), true); // 89.76 -> 90
    assert.equal(isTripFinishable(progressAtKm(0.35)), false); // 89.46 -> 89
  });

  it('nothing, nothing readable and nothing valid are not finishable', () => {
    for (const v of [null, undefined, NaN, Infinity * 0, 0, 5, -10]) assert.equal(isTripFinishable(v as number | null | undefined), false);
  });

  it('end to end from positions: a driver 0.33 km short of the destination may finish, 0.36 km short may not', () => {
    const pickup = { lat: 13.4115, lng: 121.1803 };
    const dropoff = { lat: 13.4415, lng: 121.1803 };
    const at = (km: number) => ({ lat: dropoff.lat - km / 110.574, lng: dropoff.lng });
    assert.equal(calculateTripProgressFromPositions(pickup, dropoff, at(0.36)), 89);
    assert.equal(calculateTripProgressFromPositions(pickup, dropoff, at(0.33)), 90);
    assert.equal(isTripFinishable(calculateTripProgressFromPositions(pickup, dropoff, at(0.33))), true);
    assert.equal(isTripFinishable(calculateTripProgressFromPositions(pickup, dropoff, at(0.36))), false);
    assert.equal(calculateTripProgressFromPositions(pickup, dropoff, at(0.07)), 95);
  });
});

describe('fetchServerTripProgress', () => {
  const client = (reply: { data: unknown; error?: unknown } | Error) => ({
    rpc: async () => {
      if (reply instanceof Error) throw reply;
      return { data: reply.data, error: reply.error ?? null };
    },
  });

  it('reads what the database answers', async () => {
    const got = await fetchServerTripProgress(client({ data: { success: true, progress_pct: 92, min_finish_pct: 90, can_finish: true } }), 'b1');
    assert.deepEqual(got, { progressPercent: 92, minFinishPercent: 90, canFinish: true });
  });

  it('keeps "no position yet" as null rather than inventing a number', async () => {
    const got = await fetchServerTripProgress(client({ data: { success: true, progress_pct: null, min_finish_pct: 90, can_finish: false } }), 'b1');
    assert.deepEqual(got, { progressPercent: null, minFinishPercent: 90, canFinish: false });
  });

  it('is null when the call fails, the booking is not the caller\'s, or the database does not have the function yet', async () => {
    assert.equal(await fetchServerTripProgress(client({ data: null, error: { message: 'function get_trip_progress does not exist' } }), 'b1'), null);
    assert.equal(await fetchServerTripProgress(client({ data: { success: false, error: 'This booking is not yours.' } }), 'b1'), null);
    assert.equal(await fetchServerTripProgress(client(new Error('network')), 'b1'), null);
  });
});
