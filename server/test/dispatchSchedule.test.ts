// The pure rules of the driver search (packages/shared/src/utils/dispatchSchedule.ts) and the schedule figures they read.
//   run:  cd server && npx tsx --test test/*.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  nearestAccreditedTodaId,
  selectTierCandidates,
  tier3RadiusKm,
  type DispatchCandidate,
} from '../../packages/shared/src/utils/dispatchSchedule';
import {
  DISPATCH_TIER1_RADIUS_KM,
  DISPATCH_TIER2_RADIUS_KM,
  DISPATCH_TIER3_MAX_SECONDS,
  DISPATCH_TIER3_REFRESH_SECONDS,
  DRIVER_OFFER_TIMEOUT_SECONDS,
} from '../../packages/shared/src/config/policyConfig';

const driver = (driver_id: string, distance_km: number | null, toda_id: string | null = 'T1'): DispatchCandidate => ({
  driver_id,
  toda_id,
  distance_km,
});

describe('search schedule figures (Intelligent Driver Dispatch specification)', () => {
  it('uses the specified radii and timers', () => {
    assert.equal(DISPATCH_TIER1_RADIUS_KM, 0.6);
    assert.equal(DISPATCH_TIER2_RADIUS_KM, 2);
    assert.equal(DISPATCH_TIER3_REFRESH_SECONDS, 30);
    assert.equal(DRIVER_OFFER_TIMEOUT_SECONDS, 15);
  });
});

describe('tier3RadiusKm: the live search grows with time', () => {
  it('starts at 2.0 km', () => {
    assert.equal(tier3RadiusKm(0), 2.0);
    assert.equal(tier3RadiusKm(89), 2.0);
  });
  it('grows to 2.5 km at 1:30, 3.0 km at 3:00 and 3.5 km at 4:30', () => {
    assert.equal(tier3RadiusKm(90), 2.5);
    assert.equal(tier3RadiusKm(179), 2.5);
    assert.equal(tier3RadiusKm(180), 3.0);
    assert.equal(tier3RadiusKm(269), 3.0);
    assert.equal(tier3RadiusKm(270), 3.5);
  });
  it('is over exactly at the maximum duration', () => {
    assert.equal(tier3RadiusKm(DISPATCH_TIER3_MAX_SECONDS - 1), 3.5);
    assert.equal(tier3RadiusKm(DISPATCH_TIER3_MAX_SECONDS), null);
    assert.equal(tier3RadiusKm(DISPATCH_TIER3_MAX_SECONDS + 1000), null);
  });
  it('the maximum leaves room for every radius step', () => {
    assert.ok(DISPATCH_TIER3_MAX_SECONDS > 270, 'the 3.5 km step must be reachable');
  });
});

describe('selectTierCandidates', () => {
  const pool = [
    driver('d-far', 3.4),
    driver('d-near', 0.3),
    driver('d-mid', 1.4, 'T2'),
    driver('d-edge', 0.6),
    driver('d-unknown', null),
    driver('d-tie-b', 1.0),
    driver('d-tie-a', 1.0),
  ];

  it('keeps only drivers inside the radius, nearest first', () => {
    const ids = selectTierCandidates(pool, { radiusKm: 2 }).map((d) => d.driver_id);
    assert.deepEqual(ids, ['d-near', 'd-edge', 'd-tie-b', 'd-tie-a', 'd-mid']);
  });
  it('a driver exactly on the radius is inside it', () => {
    assert.ok(selectTierCandidates(pool, { radiusKm: 0.6 }).some((d) => d.driver_id === 'd-edge'));
  });
  it('Tier 1 takes only the Priority TODA inside the small geofence', () => {
    const ids = selectTierCandidates(pool, { radiusKm: DISPATCH_TIER1_RADIUS_KM, todaId: 'T1' }).map((d) => d.driver_id);
    assert.deepEqual(ids, ['d-near', 'd-edge']);
  });
  it('Tier 2 removes only the TODA restriction (the radius still applies)', () => {
    const ids = selectTierCandidates(pool, { radiusKm: DISPATCH_TIER2_RADIUS_KM, todaId: null }).map((d) => d.driver_id);
    assert.ok(ids.includes('d-mid'));
    assert.ok(!ids.includes('d-far'));
  });
  it('a driver whose position is unknown is never selected', () => {
    assert.ok(!selectTierCandidates(pool, { radiusKm: 100 }).some((d) => d.driver_id === 'd-unknown'));
  });
  it('drivers at the same distance keep the order they came in', () => {
    const ids = selectTierCandidates(pool, { radiusKm: 2 }).map((d) => d.driver_id);
    assert.ok(ids.indexOf('d-tie-b') < ids.indexOf('d-tie-a'));
  });
  it('does not change the list it was given', () => {
    const before = pool.map((d) => d.driver_id);
    selectTierCandidates(pool, { radiusKm: 2 });
    assert.deepEqual(pool.map((d) => d.driver_id), before);
  });
  it('an empty pool gives an empty tier', () => {
    assert.deepEqual(selectTierCandidates([], { radiusKm: 2 }), []);
  });
});

describe('nearestAccreditedTodaId (the Priority TODA)', () => {
  const pickup = { lat: 13.4117, lng: 121.1803 };
  it('is the TODA whose terminal is nearest the pickup', () => {
    const id = nearestAccreditedTodaId(
      [
        { toda_id: 'far', terminal_latitude: 13.45, terminal_longitude: 121.2 },
        { toda_id: 'near', terminal_latitude: '13.4120', terminal_longitude: '121.1805' },
      ],
      pickup.lat,
      pickup.lng
    );
    assert.equal(id, 'near');
  });
  it('ignores a TODA without a terminal position', () => {
    const id = nearestAccreditedTodaId(
      [
        { toda_id: 'no-terminal', terminal_latitude: null, terminal_longitude: null },
        { toda_id: 'has-terminal', terminal_latitude: 13.5, terminal_longitude: 121.3 },
      ],
      pickup.lat,
      pickup.lng
    );
    assert.equal(id, 'has-terminal');
  });
  it('is null when no TODA has a terminal position (Tier 1 is then skipped)', () => {
    assert.equal(nearestAccreditedTodaId([{ toda_id: 'x', terminal_latitude: null, terminal_longitude: null }], pickup.lat, pickup.lng), null);
    assert.equal(nearestAccreditedTodaId([], pickup.lat, pickup.lng), null);
  });
});
