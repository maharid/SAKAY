// Smooth marker movement between GPS fixes (packages/shared/src/utils/markerGlide.ts). Drawing only: the fixes themselves are never changed.
//   run:  cd server && npx tsx --test test/*.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLiveMarker,
  createMarkerGlide,
  distanceMeters,
  interpolatePoint,
  isValidGeoPoint,
  type GeoPoint,
  type MarkerGlideOptions,
} from '../../packages/shared/src/utils/markerGlide';

const A: GeoPoint = { lat: 13.4115, lng: 121.1803 };
const DEG_PER_M = 1 / 111195;
const northOf = (p: GeoPoint, meters: number): GeoPoint => ({ lat: p.lat + meters * DEG_PER_M, lng: p.lng });

/** A glide on a clock and a frame scheduler the test turns by hand. */
const harness = (overrides: Partial<MarkerGlideOptions> = {}) => {
  let t = 0;
  let nextHandle = 1;
  const pending = new Map<number, () => void>();
  const drawn: GeoPoint[] = [];
  const cancelled: number[] = [];
  const glide = createMarkerGlide({
    onPosition: (p) => drawn.push(p),
    now: () => t,
    requestFrame: (cb) => {
      const h = nextHandle++;
      pending.set(h, cb);
      return h;
    },
    cancelFrame: (h) => {
      cancelled.push(h as number);
      pending.delete(h as number);
    },
    reducedMotion: () => false,
    minFrameIntervalMs: 0,
    ...overrides,
  });
  /** Moves the clock on by `ms`, running the frames in steps of 50 ms so the loop behaves as it would in a browser. */
  const run = (ms: number, stepMs = 50) => {
    let left = ms;
    while (left > 0) {
      const step = Math.min(stepMs, left);
      t += step;
      left -= step;
      const due = [...pending.entries()];
      pending.clear();
      for (const [, cb] of due) cb();
    }
  };
  return { glide, drawn, run, at: (ms: number) => { t = ms; }, now: () => t, pendingFrames: () => pending.size, cancelled };
};

describe('validity', () => {
  it('accepts a finite lat/lng in range and refuses everything else, including the (0, 0) placeholder', () => {
    assert.equal(isValidGeoPoint(A), true);
    for (const bad of [null, undefined, {}, { lat: 'x', lng: 1 }, { lat: NaN, lng: 1 }, { lat: 1, lng: Infinity }, { lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: 0, lng: 0 }, 5, 'a']) {
      assert.equal(isValidGeoPoint(bad), false, JSON.stringify(bad));
    }
  });
});

describe('first fix, repeats and noise', () => {
  it('places the first fix at once and starts no animation', () => {
    const h = harness();
    assert.deepEqual(h.glide.push(A), { status: 'snapped', reason: 'first' });
    assert.deepEqual(h.drawn, [A]);
    assert.equal(h.glide.isAnimating(), false);
    assert.equal(h.pendingFrames(), 0);
  });

  it('ignores invalid fixes without disturbing the marker', () => {
    const h = harness();
    h.glide.push(A);
    for (const bad of [null, undefined, { lat: NaN, lng: 1 }, { lat: 0, lng: 0 }, { lat: 200, lng: 5 }] as unknown[]) {
      assert.deepEqual(h.glide.push(bad as GeoPoint), { status: 'ignored', reason: 'invalid' });
    }
    assert.deepEqual(h.glide.current(), A);
    assert.equal(h.drawn.length, 1);
  });

  it('ignores the same position again (the driver app repeats it every couple of seconds) and does not restart the slide', () => {
    const h = harness();
    h.glide.push(A);
    h.at(5000);
    const B = northOf(A, 50);
    const first = h.glide.push(B);
    assert.deepEqual(first, { status: 'gliding', durationMs: 5000 });
    h.run(2000);
    const midway = h.glide.current() as GeoPoint;
    assert.deepEqual(h.glide.push({ ...B }), { status: 'ignored', reason: 'unchanged' });
    h.run(0);
    assert.deepEqual(h.glide.current(), midway, 'the slide neither restarted nor stalled');
    h.run(3000);
    assert.deepEqual(h.glide.current(), B);
  });

  it('ignores movement under a metre (GPS noise) so a stopped vehicle does not wobble', () => {
    const h = harness();
    h.glide.push(A);
    h.at(5000);
    assert.deepEqual(h.glide.push(northOf(A, 0.4)), { status: 'ignored', reason: 'unchanged' });
    assert.equal(h.glide.isAnimating(), false);
  });
});

describe('gliding between fixes', () => {
  it('slides in a straight line at constant speed over the gap between the last two fixes, and ends exactly on the new fix', () => {
    const h = harness();
    h.glide.push(A);
    h.at(5000);
    const B = northOf(A, 100);
    assert.deepEqual(h.glide.push(B), { status: 'gliding', durationMs: 5000 });
    h.run(2500);
    const mid = h.glide.current() as GeoPoint;
    assert.ok(Math.abs(distanceMeters(A, mid) - 50) < 0.5, `halfway is 50 m from the start, was ${distanceMeters(A, mid)}`);
    h.run(2500);
    assert.deepEqual(h.glide.current(), B);
    assert.deepEqual(h.drawn[h.drawn.length - 1], B);
    // every drawn point lies between the two fixes, and they only ever advance
    let last = -1;
    for (const p of h.drawn) {
      assert.ok(p.lat >= A.lat - 1e-12 && p.lat <= B.lat + 1e-12);
      assert.ok(p.lat >= last);
      last = p.lat;
    }
  });

  it('stops its frame loop when it arrives (no animation while the vehicle is stopped)', () => {
    const h = harness();
    h.glide.push(A);
    h.at(5000);
    h.glide.push(northOf(A, 30));
    assert.equal(h.glide.isAnimating(), true);
    h.run(5200);
    assert.equal(h.glide.isAnimating(), false);
    assert.equal(h.pendingFrames(), 0);
    const count = h.drawn.length;
    h.run(10_000);
    assert.equal(h.drawn.length, count, 'nothing is drawn once it has arrived');
  });

  it('sizes the slide to the real gap between fixes, kept between 0.8 s and 6 s', () => {
    const h = harness();
    h.glide.push(A);
    h.at(300);
    assert.deepEqual(h.glide.push(northOf(A, 10)), { status: 'gliding', durationMs: 800 });
    h.run(1000);
    h.at(h.now() + 60_000);
    assert.deepEqual(h.glide.push(northOf(A, 20)), { status: 'gliding', durationMs: 6000 });
  });

  it('draws at most ~30 frames a second', () => {
    const h = harness({ minFrameIntervalMs: 33 });
    h.glide.push(A);
    h.at(5000);
    h.glide.push(northOf(A, 100));
    h.run(5000, 16); // a 60 Hz display
    assert.ok(h.drawn.length <= 1 + Math.ceil(5000 / 33) + 1, `drew ${h.drawn.length}`);
    assert.ok(h.drawn.length >= 100);
    assert.deepEqual(h.drawn[h.drawn.length - 1], northOf(A, 100));
  });
});

describe('overlapping updates and changes of direction', () => {
  it('a new fix while sliding starts from where the marker IS: it never snaps backward or jumps', () => {
    const h = harness();
    h.glide.push(A);
    h.at(5000);
    const B = northOf(A, 100);
    h.glide.push(B);
    h.run(2500);
    const where = h.glide.current() as GeoPoint; // 50 m along
    const before = h.drawn.length;
    h.at(h.now());
    const C = northOf(A, 150);
    h.glide.push(C);
    assert.deepEqual(h.glide.current(), where, 'the displayed position at the moment of the new fix is unchanged');
    h.run(100);
    const first = h.drawn[before];
    assert.ok(first.lat >= where.lat - 1e-12, 'the next frame is not behind where the marker was');
    h.run(10_000);
    assert.deepEqual(h.glide.current(), C);
    let last = where.lat;
    for (const p of h.drawn.slice(before)) {
      assert.ok(p.lat >= last - 1e-12, 'always forward');
      last = p.lat;
    }
  });

  it('a change of direction turns from the displayed position (no jump back to the previous target)', () => {
    const h = harness();
    h.glide.push(A);
    h.at(5000);
    h.glide.push(northOf(A, 100)); // heading north
    h.run(2500);
    const turnAt = h.glide.current() as GeoPoint; // 50 m north
    h.glide.push(northOf(A, -60)); // the vehicle has turned and gone south of where it started
    assert.deepEqual(h.glide.current(), turnAt);
    h.run(60);
    const next = h.glide.current() as GeoPoint;
    assert.ok(next.lat < turnAt.lat, 'it now moves toward the new fix');
    assert.ok(next.lat > northOf(A, 50).lat - 20 * DEG_PER_M, 'and from where it was, not from the old target');
    h.run(10_000);
    assert.deepEqual(h.glide.current(), northOf(A, -60));
  });

  it('keeps one frame loop however many fixes arrive', () => {
    const h = harness();
    h.glide.push(A);
    for (let i = 1; i <= 6; i++) {
      h.at(i * 1000);
      h.glide.push(northOf(A, i * 10));
      assert.equal(h.pendingFrames(), 1);
    }
  });
});

describe('stale, reordered and far-off fixes', () => {
  it('drops a fix stamped older than one already accepted, and never moves the marker for it', () => {
    const h = harness();
    h.glide.push({ ...A, at: 1000 });
    h.at(5000);
    const newer = northOf(A, 80);
    h.glide.push({ ...newer, at: 6000 });
    h.run(5000);
    assert.deepEqual(h.glide.push({ ...northOf(A, 10), at: 4000 }), { status: 'ignored', reason: 'out-of-order' });
    assert.deepEqual(h.glide.push({ ...northOf(A, 20), at: 6000 }), { status: 'ignored', reason: 'out-of-order' });
    assert.deepEqual(h.glide.current(), newer);
  });

  it('a repeat of the newest position with a newer stamp is fine and moves nothing', () => {
    const h = harness();
    h.glide.push({ ...A, at: 1 });
    assert.deepEqual(h.glide.push({ ...A, at: 2 }), { status: 'ignored', reason: 'unchanged' });
    assert.deepEqual(h.glide.push({ ...A, at: 1 }), { status: 'ignored', reason: 'out-of-order' });
  });

  it('places a far jump (a stale position being corrected) at once instead of sliding across the map', () => {
    const h = harness();
    h.glide.push(A);
    h.at(5000);
    assert.deepEqual(h.glide.push({ lat: 13.5, lng: 121.2 }), { status: 'snapped', reason: 'jump' });
    assert.equal(h.glide.isAnimating(), false);
    assert.deepEqual(h.glide.current(), { lat: 13.5, lng: 121.2 });
  });

  it('places each fix at once for a person who prefers reduced motion', () => {
    const h = harness({ reducedMotion: () => true });
    h.glide.push(A);
    h.at(5000);
    assert.deepEqual(h.glide.push(northOf(A, 100)), { status: 'snapped', reason: 'reduced-motion' });
    assert.equal(h.glide.isAnimating(), false);
  });
});

describe('cleanup', () => {
  it('stop() cancels the pending frame and nothing is drawn afterwards (the component unmounted)', () => {
    const h = harness();
    h.glide.push(A);
    h.at(5000);
    h.glide.push(northOf(A, 100));
    h.run(1000);
    const drawn = h.drawn.length;
    h.glide.stop();
    assert.equal(h.pendingFrames(), 0);
    assert.ok(h.cancelled.length >= 1);
    assert.equal(h.glide.isAnimating(), false);
    h.run(10_000);
    assert.equal(h.drawn.length, drawn);
  });

  it('stop() on an idle glide is harmless, and reset() forgets the position (the first fix after it is placed at once)', () => {
    const h = harness();
    h.glide.stop();
    h.glide.push(A);
    h.glide.reset();
    assert.equal(h.glide.current(), null);
    assert.deepEqual(h.glide.push(northOf(A, 500)), { status: 'snapped', reason: 'first' });
  });
});

describe('geometry helpers', () => {
  it('interpolatePoint clamps to the two ends', () => {
    const B = northOf(A, 100);
    assert.deepEqual(interpolatePoint(A, B, -1), A);
    assert.deepEqual(interpolatePoint(A, B, 2), B);
    assert.ok(Math.abs(distanceMeters(A, interpolatePoint(A, B, 0.5)) - 50) < 0.5);
  });

  it('distanceMeters is about 111 km per degree of latitude and shrinks with latitude for longitude', () => {
    assert.ok(Math.abs(distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) - 111195) < 1);
    assert.ok(distanceMeters({ lat: 60, lng: 0 }, { lat: 60, lng: 1 }) < 56_000);
  });
});

describe('a live marker on the map', () => {
  /** A fake map marker that records what it was told */
  const fake = () => {
    const log: Array<[number, number]> = [];
    const state = { removed: 0, created: [] as GeoPoint[] };
    const make = (at: GeoPoint) => {
      state.created.push(at);
      return {
        setLatLng: (ll: [number, number]) => { log.push(ll); },
        remove: () => { state.removed += 1; },
      };
    };
    return { log, state, make };
  };

  it('makes the marker at the first fix, slides it to later ones, and removes it for "nothing to show"', () => {
    let t = 0;
    const frames: Array<() => void> = [];
    const m = fake();
    const marker = createLiveMarker({
      create: m.make,
      glide: { now: () => t, requestFrame: (cb) => { frames.push(cb); return frames.length; }, cancelFrame: () => { frames.length = 0; }, reducedMotion: () => false, minFrameIntervalMs: 0 },
    });
    assert.equal(marker.hasMarker(), false);
    assert.deepEqual(marker.update(A), { status: 'snapped', reason: 'first' });
    assert.deepEqual(m.state.created, [A]);
    assert.equal(marker.hasMarker(), true);
    t = 5000;
    const B = northOf(A, 60);
    assert.deepEqual(marker.update(B), { status: 'gliding', durationMs: 5000 });
    for (let i = 0; i < 100 && frames.length; i++) {
      t += 100;
      frames.splice(0).forEach((cb) => cb());
    }
    assert.deepEqual(m.log[m.log.length - 1], [B.lat, B.lng]);
    assert.equal(m.state.created.length, 1, 'one marker for the whole trip, not one per fix');
    assert.equal(marker.update(null), null);
    assert.equal(m.state.removed, 1);
    assert.equal(marker.hasMarker(), false);
    assert.deepEqual(marker.update(northOf(A, 10)), { status: 'snapped', reason: 'first' }, 'a driver assigned again starts fresh');
    assert.equal(m.state.created.length, 2);
  });

  it('keeps the marker where it is when a bad reading arrives (the vehicle does not vanish)', () => {
    const m = fake();
    const marker = createLiveMarker({ create: m.make });
    marker.update(A);
    assert.deepEqual(marker.update({ lat: NaN, lng: 1 }), { status: 'ignored', reason: 'invalid' });
    assert.equal(marker.hasMarker(), true);
    assert.equal(m.state.removed, 0);
    marker.destroy();
  });

  it('destroy() removes the marker and stops the animation (the map unmounted)', () => {
    let t = 0;
    const frames: Array<() => void> = [];
    let cancelled = 0;
    const m = fake();
    const marker = createLiveMarker({
      create: m.make,
      glide: { now: () => t, requestFrame: (cb) => { frames.push(cb); return frames.length; }, cancelFrame: () => { cancelled += 1; frames.length = 0; }, reducedMotion: () => false },
    });
    marker.update(A);
    t = 5000;
    marker.update(northOf(A, 80));
    assert.equal(frames.length, 1);
    marker.destroy();
    assert.equal(m.state.removed, 1);
    assert.equal(cancelled, 1);
    assert.equal(frames.length, 0);
    assert.equal(marker.hasMarker(), false);
  });
});
