// Pins must lie on a road (panel comment, decision D-P3): snapToRoad() asks the routing service for the nearest road and says on_road (and moves the pin onto it),
// off_road (refuse the pin) or unknown (the service did not answer: let the person carry on, the database still has its say). Nothing here touches the network.
//   run:  cd server && npx tsx --test test/roadSnap.test.ts
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clearRoadSnapCache, offRoadMessage, readNearest, snapToRoad } from '../../packages/shared/src/utils/roadSnap';
import { PIN_ROAD_MAX_DISTANCE_M } from '../../packages/shared/src/config/policyConfig';

const answer = (distance: number, loc: [number, number] = [121.180345, 13.411787]) => ({ code: 'Ok', waypoints: [{ location: loc, distance, name: '' }] });
const respond = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
const BASES = ['https://one.example', 'https://two.example'] as const;

describe('readNearest', () => {
  it('reads the road point and its distance', () => {
    assert.deepEqual(readNearest(answer(10.8)), { lng: 121.180345, lat: 13.411787, distanceM: 10.8 });
  });
  it('treats anything else as no answer', () => {
    for (const bad of [null, {}, { code: 'NoSegment' }, { code: 'Ok', waypoints: [] }, { code: 'Ok', waypoints: [{ location: [1], distance: 3 }] },
                       { code: 'Ok', waypoints: [{ location: [121, 13], distance: -4 }] }, { code: 'Ok', waypoints: [{ location: ['x', 13], distance: 4 }] }]) {
      assert.equal(readNearest(bad), null, JSON.stringify(bad));
    }
  });
});

describe('snapToRoad', () => {
  beforeEach(() => clearRoadSnapCache());

  it('the limit is the one in the policy configuration', () => {
    assert.equal(PIN_ROAD_MAX_DISTANCE_M, 30);
  });

  it('a pin near a road is moved onto it', async () => {
    const r = await snapToRoad(13.4117, 121.1803, { fetchImpl: respond(answer(10.78)), baseUrls: BASES });
    assert.deepEqual(r, { status: 'on_road', lat: 13.411787, lng: 121.180345, distanceM: 11 });
  });

  it('a pin exactly at the limit still counts as on the road; one metre more does not', async () => {
    assert.equal((await snapToRoad(13.1, 121.1, { fetchImpl: respond(answer(30)), baseUrls: BASES })).status, 'on_road');
    assert.equal((await snapToRoad(13.2, 121.1, { fetchImpl: respond(answer(31)), baseUrls: BASES })).status, 'off_road');
  });

  it('a pin on the water (the nearest road is far) is refused and keeps its own point', async () => {
    const r = await snapToRoad(13.45, 121.19, { fetchImpl: respond(answer(2223.6, [121.197403, 13.431253])), baseUrls: BASES });
    assert.deepEqual(r, { status: 'off_road', lat: 13.45, lng: 121.19, distanceM: 2224 });
  });

  it('asks the first server in the right order of coordinates, and the second one when the first fails', async () => {
    const urls: string[] = [];
    const flaky = (async (url: string) => {
      urls.push(url);
      if (url.startsWith('https://one.example')) throw new Error('down');
      return { ok: true, json: async () => answer(5) };
    }) as unknown as typeof fetch;
    const r = await snapToRoad(13.3, 121.2, { fetchImpl: flaky, baseUrls: BASES });
    assert.equal(r.status, 'on_road');
    assert.deepEqual(urls, ['https://one.example/nearest/v1/driving/121.200000,13.300000?number=1', 'https://two.example/nearest/v1/driving/121.200000,13.300000?number=1']);
  });

  it('a server that answers badly (HTTP error, odd body) is skipped like one that is down', async () => {
    let n = 0;
    const odd = (async () => (++n === 1 ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => ({ code: 'NoSegment' }) })) as unknown as typeof fetch;
    const r = await snapToRoad(13.31, 121.2, { fetchImpl: odd, baseUrls: BASES });
    assert.equal(r.status, 'unknown');
    assert.equal(n, 2);
  });

  it('when no server answers the result is unknown, with the asked point: the person may carry on', async () => {
    const down = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    assert.deepEqual(await snapToRoad(13.32, 121.2, { fetchImpl: down, baseUrls: BASES }), { status: 'unknown', lat: 13.32, lng: 121.2, distanceM: null });
  });

  it('a request that takes too long is given up on', async () => {
    const hang = ((_url: string, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;
    const t0 = Date.now();
    const r = await snapToRoad(13.33, 121.2, { fetchImpl: hang, baseUrls: [BASES[0]], timeoutMs: 40 });
    assert.equal(r.status, 'unknown');
    assert.ok(Date.now() - t0 < 1000);
  });

  it('the same place asked twice goes to the network once', async () => {
    let n = 0;
    const counting = (async () => { n++; return { ok: true, json: async () => answer(8) }; }) as unknown as typeof fetch;
    await snapToRoad(13.34, 121.2, { fetchImpl: counting, baseUrls: BASES });
    await snapToRoad(13.34, 121.2, { fetchImpl: counting, baseUrls: BASES });
    assert.equal(n, 1);
  });

  it('a point that is not a number is never sent anywhere', async () => {
    let n = 0;
    const counting = (async () => { n++; return { ok: true, json: async () => answer(8) }; }) as unknown as typeof fetch;
    assert.equal((await snapToRoad(Number.NaN, 121.2, { fetchImpl: counting, baseUrls: BASES })).status, 'unknown');
    assert.equal(n, 0);
  });
});

describe('offRoadMessage', () => {
  it('says what is wrong and what to do, in both languages, with the distance', () => {
    assert.match(offRoadMessage('en', 2224), /nearest road is about 2\.2 km away/);
    assert.match(offRoadMessage('en', 120), /about 120 m away/);
    assert.match(offRoadMessage('tl', 120), /120 m ang layo/);
    assert.match(offRoadMessage('en', null), /Move the pin onto a road/);
  });
});
