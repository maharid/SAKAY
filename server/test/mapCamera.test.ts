// Map camera: the visible-area geometry and the controller (packages/shared/src/utils/mapCamera.ts), the heading rules, and the search radius.
// The controller is driven by a fake map with a real linear projection, so "the point ends up in the middle of the UNCOVERED area" is checked
// in pixels, not assumed.
//   run:  cd server && npx tsx --test test/*.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  centerForVisible,
  centerShift,
  createMapCamera,
  effectiveInsets,
  fitPadding,
  insetsDiffer,
  minimalPanToInclude,
  rectContains,
  toInsets,
  visibleRect,
  type CameraMap,
  type MapCamera,
} from '../../packages/shared/src/utils/mapCamera';
import { bearingDegrees, continuousRotation, normalizeHeading, resolveHeading } from '../../packages/shared/src/utils/heading';
import { searchRadiusFromStatus, tweenRadius } from '../../packages/shared/src/utils/searchRadius';

type Call = { fn: string; args: unknown[] };

/** A map whose projection is a straight line: 100 000 px per degree at zoom 15, doubling with each zoom level */
class FakeMap implements CameraMap {
  center: [number, number] = [13.41, 121.18];
  zoom = 15;
  size = { x: 400, y: 800 };
  calls: Call[] = [];
  private k(z: number) {
    return 100_000 * 2 ** (z - 15);
  }
  getSize() {
    return this.size;
  }
  getZoom() {
    return this.zoom;
  }
  project(latlng: [number, number], zoom = this.zoom) {
    return { x: latlng[1] * this.k(zoom), y: -latlng[0] * this.k(zoom) };
  }
  unproject(point: [number, number], zoom = this.zoom) {
    return { lat: -point[1] / this.k(zoom), lng: point[0] / this.k(zoom) };
  }
  latLngToContainerPoint(latlng: [number, number]) {
    const p = this.project(latlng);
    const c = this.project(this.center);
    return { x: p.x - c.x + this.size.x / 2, y: p.y - c.y + this.size.y / 2 };
  }
  panTo(latlng: [number, number], options?: Record<string, unknown>) {
    this.calls.push({ fn: 'panTo', args: [latlng, options] });
    this.center = latlng;
  }
  panBy(offset: [number, number], options?: Record<string, unknown>) {
    this.calls.push({ fn: 'panBy', args: [offset, options] });
    const c = this.project(this.center);
    const n = this.unproject([c.x + offset[0], c.y + offset[1]]);
    this.center = [n.lat, n.lng];
  }
  setView(latlng: [number, number], zoom?: number, options?: Record<string, unknown>) {
    this.calls.push({ fn: 'setView', args: [latlng, zoom, options] });
    this.center = latlng;
    if (zoom !== undefined) this.zoom = zoom;
  }
  fitBounds(bounds: [[number, number], [number, number]], options?: Record<string, unknown>) {
    this.calls.push({ fn: 'fitBounds', args: [bounds, options] });
  }
  invalidateSize(options?: Record<string, unknown>) {
    this.calls.push({ fn: 'invalidateSize', args: [options] });
  }
  last(fn: string): Call | undefined {
    return [...this.calls].reverse().find((c) => c.fn === fn);
  }
  count(fn: string): number {
    return this.calls.filter((c) => c.fn === fn).length;
  }
}

/** A timer the test advances by hand */
function manualTimers() {
  const pending: Array<{ id: number; fn: () => void }> = [];
  let next = 1;
  return {
    setTimer: (fn: () => void) => {
      const id = next++;
      pending.push({ id, fn });
      return id;
    },
    clearTimer: (h: unknown) => {
      const i = pending.findIndex((p) => p.id === h);
      if (i >= 0) pending.splice(i, 1);
    },
    flush: () => {
      const run = pending.splice(0);
      run.forEach((p) => p.fn());
    },
    size: () => pending.length,
  };
}

const TARGET = { lat: 13.412, lng: 121.182 };

function makeCamera(map: FakeMap, extra: Partial<Parameters<typeof createMapCamera>[1]> = {}) {
  const timers = manualTimers();
  const camera = createMapCamera(map, { reducedMotion: () => false, setTimer: timers.setTimer, clearTimer: timers.clearTimer, ...extra });
  return { camera, timers };
}

describe('visible-area geometry', () => {
  it('turns missing, negative and non-numeric sides into 0', () => {
    assert.deepEqual(toInsets({ bottom: 320.4, top: -5, left: Number.NaN }), { top: 0, right: 0, bottom: 320, left: 0 });
    assert.deepEqual(toInsets(null), { top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('puts the visible centre above the container centre when a sheet covers the bottom', () => {
    const size = { w: 400, h: 800 };
    assert.deepEqual(centerShift(size, { top: 0, right: 0, bottom: 300, left: 0 }), { x: 0, y: -150 });
    assert.deepEqual(centerShift(size, { top: 100, right: 0, bottom: 300, left: 0 }), { x: 0, y: -100 });
    assert.deepEqual(centerShift(size, { top: 0, right: 0, bottom: 0, left: 0 }), { x: 0, y: 0 });
  });

  it('never lets overlays leave less than 30% of a dimension uncovered', () => {
    const e = effectiveInsets({ top: 400, right: 0, bottom: 600, left: 0 }, { w: 400, h: 800 });
    assert.ok(800 - e.top - e.bottom >= 800 * 0.3 - 1, JSON.stringify(e));
    const r = visibleRect({ w: 400, h: 800 }, { top: 400, right: 0, bottom: 600, left: 0 });
    assert.ok(r.bottom > r.top);
  });

  it('asks Leaflet to fit inside the visible area, with the margin around it', () => {
    const p = fitPadding({ w: 400, h: 800 }, { top: 72, right: 0, bottom: 320, left: 0 }, 28);
    assert.deepEqual(p, { paddingTopLeft: [28, 100], paddingBottomRight: [28, 348] });
  });

  it('only counts a change in the covered area when it is big enough to matter', () => {
    const a = toInsets({ bottom: 300 });
    assert.equal(insetsDiffer(a, toInsets({ bottom: 305 })), false);
    assert.equal(insetsDiffer(a, toInsets({ bottom: 420 })), true);
  });

  it('works out the smallest pan that brings a point back into view', () => {
    const rect = { left: 0, top: 0, right: 400, bottom: 500 };
    assert.deepEqual(minimalPanToInclude(rect, { x: 200, y: 250 }, 20), { x: 0, y: 0 });
    assert.deepEqual(minimalPanToInclude(rect, { x: 200, y: 560 }, 20), { x: 0, y: 80 });
    assert.deepEqual(minimalPanToInclude(rect, { x: -30, y: 10 }, 20), { x: -50, y: -10 });
    assert.equal(rectContains(rect, { x: 200, y: 250 }, 20), true);
  });
});

describe('centring accounts for what covers the map', () => {
  it('puts the target in the middle of the UNCOVERED area, not the middle of the container', () => {
    const map = new FakeMap();
    const insets = toInsets({ top: 72, bottom: 320 });
    const c = centerForVisible(map, TARGET, insets, map.zoom);
    map.center = [c.lat, c.lng];
    const px = map.latLngToContainerPoint([TARGET.lat, TARGET.lng]);
    const rect = visibleRect({ w: 400, h: 800 }, insets);
    assert.ok(Math.abs(px.x - (rect.left + rect.right) / 2) < 0.5, `x ${px.x}`);
    assert.ok(Math.abs(px.y - (rect.top + rect.bottom) / 2) < 0.5, `y ${px.y}`);
    assert.ok(px.y < 400, 'above the container centre, clear of the sheet');
  });

  it('gives the same answer at another zoom (the offset is in pixels, not degrees)', () => {
    const map = new FakeMap();
    map.zoom = 17;
    const insets = toInsets({ bottom: 400 });
    const c = centerForVisible(map, TARGET, insets, 17);
    map.center = [c.lat, c.lng];
    assert.ok(Math.abs(map.latLngToContainerPoint([TARGET.lat, TARGET.lng]).y - 200) < 0.5);
  });

  it('centerOn from a control moves the camera into the visible area and starts following', () => {
    const map = new FakeMap();
    const modes: string[] = [];
    const { camera } = makeCamera(map, { onModeChange: (m) => modes.push(m) });
    camera.setInsets({ bottom: 320 });
    assert.equal(camera.centerOn(TARGET, { explicit: true, follow: 'user' }), true);
    assert.equal(camera.mode(), 'user');
    assert.deepEqual(modes, ['user']);
    const px = map.latLngToContainerPoint([TARGET.lat, TARGET.lng]);
    assert.ok(Math.abs(px.y - 240) < 0.5, `y ${px.y}`);
    assert.ok(map.zoom >= 16, 'zoomed in enough to be useful');
  });

  it('refuses to centre on a missing or placeholder position', () => {
    const { camera } = makeCamera(new FakeMap());
    assert.equal(camera.centerOn({ lat: 0, lng: 0 }), false);
    assert.equal(camera.centerOn({ lat: Number.NaN, lng: 121 }), false);
  });
});

describe('fitting', () => {
  const route = [
    { lat: 13.41, lng: 121.18 },
    { lat: 13.43, lng: 121.2 },
  ];

  it('fits inside the visible area, using the measured covered area as padding', () => {
    const map = new FakeMap();
    const { camera } = makeCamera(map);
    camera.setInsets({ top: 72, bottom: 320 });
    assert.equal(camera.fit({ points: route, key: 'a' }), true);
    const opts = map.last('fitBounds')!.args[1] as Record<string, unknown>;
    assert.deepEqual(opts.paddingTopLeft, [28, 100]);
    assert.deepEqual(opts.paddingBottomRight, [28, 348]);
    assert.equal(opts.animate, true);
  });

  it('fits once per key, and again after the trip stage changes', () => {
    const map = new FakeMap();
    const { camera } = makeCamera(map);
    assert.equal(camera.fit({ points: route, key: 'a' }), true);
    assert.equal(camera.fit({ points: route, key: 'a' }), false);
    assert.equal(map.count('fitBounds'), 1);
    camera.stageChanged('Trip Ongoing');
    assert.equal(camera.fit({ points: route, key: 'a' }), true);
    assert.equal(map.count('fitBounds'), 2);
  });

  it('leaves a map the person is exploring alone, until they ask for a frame', () => {
    const map = new FakeMap();
    const { camera } = makeCamera(map);
    camera.userMoved();
    assert.equal(camera.mode(), 'free');
    assert.equal(camera.fit({ points: route, key: 'b' }), false);
    assert.equal(map.count('fitBounds'), 0);
    camera.stageChanged('Driver Arrived');
    assert.equal(camera.fit({ points: route, key: 'b' }), false);
    assert.equal(camera.fit({ points: route, key: 'b', explicit: true }), true);
    assert.equal(camera.mode(), 'route');
  });

  it('ignores invalid and placeholder points, and does nothing for an empty request', () => {
    const map = new FakeMap();
    const { camera } = makeCamera(map);
    assert.equal(camera.fit({ points: [{ lat: 0, lng: 0 }, { lat: Number.NaN, lng: 1 }] }), false);
    assert.equal(map.count('fitBounds'), 0);
  });

  it('draws no animation when the person prefers reduced motion', () => {
    const map = new FakeMap();
    const { camera } = makeCamera(map, { reducedMotion: () => true });
    camera.fit({ points: route, key: 'c' });
    assert.equal((map.last('fitBounds')!.args[1] as Record<string, unknown>).animate, false);
    camera.centerOn(TARGET, { explicit: true, follow: 'driver' });
    assert.equal((map.last('setView')!.args[2] as Record<string, unknown>).animate, false);
  });
});

describe('re-framing when the covered area changes', () => {
  const route = [
    { lat: 13.41, lng: 121.18 },
    { lat: 13.43, lng: 121.2 },
  ];

  function framed(extra: Partial<Parameters<typeof createMapCamera>[1]> = {}) {
    const map = new FakeMap();
    // place the map so the route sits comfortably inside the (uncovered) container
    map.center = [13.42, 121.19];
    map.zoom = 12;
    const made = makeCamera(map, extra);
    made.camera.fit({ points: route, key: 'r', explicit: true, kind: 'route' });
    map.calls.length = 0;
    return { map, ...made };
  }

  it('waits for the sheet to settle, and does not jump when everything is still in view', () => {
    const { map, camera, timers } = framed();
    camera.setInsets({ bottom: 120 });
    camera.setInsets({ bottom: 130 });
    assert.equal(timers.size(), 1, 'one pending re-frame, not one per change');
    timers.flush();
    assert.equal(map.count('fitBounds'), 0, 'the route is still visible: no camera movement');
  });

  it('re-fits when a bigger sheet would hide part of the route', () => {
    const { map, camera, timers } = framed();
    camera.setInsets({ bottom: 560 });
    timers.flush();
    assert.equal(map.count('fitBounds'), 1);
    const opts = map.last('fitBounds')!.args[1] as Record<string, unknown>;
    assert.ok((opts.paddingBottomRight as number[])[1] > 400, 'the padding now follows the bigger sheet');
  });

  it('ignores a sheet that moved by only a few pixels', () => {
    const { camera, timers } = framed();
    camera.setInsets({ bottom: 4 });
    assert.equal(timers.size(), 0);
  });

  it('does not touch a map the person is exploring', () => {
    const { map, camera, timers } = framed();
    camera.userMoved();
    camera.setInsets({ bottom: 560 });
    timers.flush();
    assert.equal(map.count('fitBounds'), 0);
    assert.equal(map.count('panTo'), 0);
  });

  it('keeps following the person with a smooth pan when the sheet changes', () => {
    const map = new FakeMap();
    const { camera, timers } = makeCamera(map);
    camera.centerOn(TARGET, { explicit: true, follow: 'user' });
    map.calls.length = 0;
    camera.setInsets({ bottom: 400 });
    timers.flush();
    assert.equal(map.count('fitBounds'), 0);
    assert.equal(map.count('panTo'), 1);
    assert.ok(Math.abs(map.latLngToContainerPoint([TARGET.lat, TARGET.lng]).y - 200) < 0.5);
  });

  it('a screen that is still settling is re-framed, not re-centred: the first automatic framing holds until a marker is followed', () => {
    const map = new FakeMap();
    map.center = [13.42, 121.19];
    map.zoom = 12;
    const { camera, timers } = makeCamera(map);
    camera.followMarker('driver', { lat: 13.41, lng: 121.18 }, { status: 'snapped', reason: 'first' }); // the first GPS fix
    camera.fit({ points: route, key: 'r' }); // then the route arrives and is framed
    map.calls.length = 0;
    camera.setInsets({ bottom: 560 }); // then the sheets finish growing
    timers.flush();
    assert.equal(map.count('fitBounds'), 1, 'the whole route is framed again inside what is left');
    assert.equal(map.count('panTo'), 0);
  });

  it('while the driver is followed, a sheet change re-centres on the driver instead of zooming out to the whole route', () => {
    const map = new FakeMap();
    const { camera, timers } = makeCamera(map);
    // the route was framed automatically, then the driver is followed (mode "auto")
    camera.fit({ points: route, key: 'r' });
    camera.followMarker('driver', TARGET, { status: 'snapped', reason: 'first' });
    map.calls.length = 0;
    camera.setInsets({ bottom: 500 });
    timers.flush();
    assert.equal(map.count('fitBounds'), 0, 'no zoom-out to the whole route');
    assert.equal(map.count('panTo'), 1);
    assert.ok(Math.abs(map.latLngToContainerPoint([TARGET.lat, TARGET.lng]).y - 150) < 0.5, 'the driver is in the middle of what is left');
  });

  it('while the driver is followed, a sheet change that leaves them in the middle moves nothing', () => {
    const map = new FakeMap();
    const { camera, timers } = makeCamera(map);
    camera.followMarker('driver', TARGET, { status: 'snapped', reason: 'first' });
    map.calls.length = 0;
    camera.setInsets({ top: 120, bottom: 120 }); // covered equally above and below: the middle of what is visible has not moved
    timers.flush();
    assert.equal(map.count('panTo'), 0);
  });

  it('re-checks the container size when it changes (rotation, window, keyboard)', () => {
    const { map, camera, timers } = framed();
    camera.resized();
    timers.flush();
    assert.equal(map.count('invalidateSize'), 1);
  });

  it('stops everything on destroy', () => {
    const { map, camera, timers } = framed();
    camera.setInsets({ bottom: 560 });
    camera.destroy();
    timers.flush();
    assert.equal(map.calls.length, 0);
  });
});

describe('following a live marker', () => {
  function started(): { map: FakeMap; camera: MapCamera } {
    const map = new FakeMap();
    const { camera } = makeCamera(map);
    return { map, camera };
  }

  it('keeps the driver centred in the visible area, sliding in a straight line over the glide', () => {
    const { map, camera } = started();
    camera.setInsets({ bottom: 300 });
    camera.followMarker('driver', TARGET, { status: 'gliding', durationMs: 5000 });
    const call = map.last('panTo')!;
    const opts = call.args[1] as Record<string, unknown>;
    assert.equal(opts.duration, 5);
    assert.equal(opts.easeLinearity, 1);
    assert.equal(opts.noMoveStart, true);
    assert.ok(Math.abs(map.latLngToContainerPoint([TARGET.lat, TARGET.lng]).y - 250) < 0.5);
  });

  it('does not follow the passenger dot unless the passenger asked for that', () => {
    const { map, camera } = started();
    camera.followMarker('user', TARGET, { status: 'gliding', durationMs: 5000 });
    assert.equal(map.count('panTo'), 0);
    camera.centerOn(TARGET, { explicit: true, follow: 'user' });
    map.calls.length = 0;
    camera.followMarker('user', { lat: 13.4125, lng: 121.1825 }, { status: 'gliding', durationMs: 5000 });
    assert.equal(map.count('panTo'), 1);
  });

  it('nudges a marker that is leaving the visible area back into it, without recentring', () => {
    const map = new FakeMap();
    const { camera } = makeCamera(map);
    camera.fit({ points: [{ lat: 13.41, lng: 121.18 }, { lat: 13.43, lng: 121.2 }], key: 'k', explicit: true, kind: 'route' });
    map.calls.length = 0;
    camera.setInsets({ bottom: 300 });
    // far below the visible area
    camera.followMarker('driver', { lat: 13.405, lng: 121.19 }, { status: 'gliding', durationMs: 5000 });
    assert.equal(map.count('panTo'), 0);
    assert.equal(map.count('panBy'), 1);
  });

  it('ignores a fix the glide ignored, and everything while the map is free', () => {
    const { map, camera } = started();
    camera.followMarker('driver', TARGET, { status: 'ignored', reason: 'unchanged' });
    camera.followMarker('driver', TARGET, null);
    assert.equal(map.calls.length, 0);
    camera.userMoved();
    camera.followMarker('driver', TARGET, { status: 'gliding', durationMs: 5000 });
    assert.equal(map.calls.length, 0);
  });

  it('follows the passenger own dot while nothing else is on the map (the dashboard), when told to', () => {
    const map = new FakeMap();
    const { camera } = makeCamera(map, { autoFollow: () => 'user' });
    camera.followMarker('user', TARGET, { status: 'gliding', durationMs: 5000 });
    assert.equal(map.count('panTo'), 1);
    camera.followMarker('driver', { lat: 13.4125, lng: 121.1825 }, { status: 'gliding', durationMs: 5000 });
    assert.equal(map.count('panTo'), 1, 'a driver that is not followed does not move the camera');
  });

  it('release hands the camera back after the map was free', () => {
    const map = new FakeMap();
    const { camera } = makeCamera(map);
    camera.userMoved();
    camera.followMarker('driver', TARGET, { status: 'gliding', durationMs: 5000 });
    assert.equal(map.count('panTo'), 0);
    camera.release();
    assert.equal(camera.mode(), 'auto');
    camera.followMarker('driver', TARGET, { status: 'gliding', durationMs: 5000 });
    assert.equal(map.count('panTo'), 1);
  });

  it('places a reduced-motion jump immediately', () => {
    const map = new FakeMap();
    const { camera } = makeCamera(map, { reducedMotion: () => true });
    camera.followMarker('driver', TARGET, { status: 'snapped', reason: 'reduced-motion' });
    assert.equal((map.last('panTo')!.args[1] as Record<string, unknown>).animate, false);
  });
});

describe('heading', () => {
  it('normalises headings and rejects anything that is not a number', () => {
    assert.equal(normalizeHeading(370), 10);
    assert.equal(normalizeHeading(-90), 270);
    assert.equal(normalizeHeading(0), 0);
    for (const bad of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, '90', {}]) assert.equal(normalizeHeading(bad), null);
  });

  it('computes the bearing between two fixes', () => {
    const o = { lat: 13.41, lng: 121.18 };
    assert.ok(Math.abs(bearingDegrees(o, { lat: 13.42, lng: 121.18 }) - 0) < 0.01, 'north');
    assert.ok(Math.abs(bearingDegrees(o, { lat: 13.41, lng: 121.19 }) - 90) < 0.1, 'east');
    assert.ok(Math.abs(bearingDegrees(o, { lat: 13.4, lng: 121.18 }) - 180) < 0.01, 'south');
    assert.ok(Math.abs(bearingDegrees(o, { lat: 13.41, lng: 121.17 }) - 270) < 0.1, 'west');
  });

  const here = { lat: 13.41, lng: 121.18 };
  const eastOfHere = { lat: 13.41, lng: 121.1812 };

  it('prefers the heading the device reports while the vehicle is moving', () => {
    assert.deepEqual(resolveHeading({ reported: 135, speedMps: 6, previous: here, current: eastOfHere, lastHeading: 10 }), { heading: 135, source: 'gps' });
    assert.deepEqual(resolveHeading({ reported: 135, current: here }), { heading: 135, source: 'gps' });
  });

  it('does not trust a device heading at a standstill', () => {
    const r = resolveHeading({ reported: 135, speedMps: 0.2, previous: here, current: eastOfHere, lastHeading: null });
    assert.equal(r.source, 'movement');
    assert.ok(Math.abs((r.heading ?? -1) - 90) < 0.5);
  });

  it('uses the direction of movement when the device reports none, once it moved more than GPS noise', () => {
    const r = resolveHeading({ reported: null, previous: here, current: eastOfHere });
    assert.equal(r.source, 'movement');
    assert.deepEqual(resolveHeading({ reported: null, previous: here, current: { lat: 13.41, lng: 121.18002 } }), { heading: null, source: 'none' });
  });

  it('keeps the last heading when stopped, and has none when nothing is known', () => {
    assert.deepEqual(resolveHeading({ reported: null, previous: here, current: here, lastHeading: 200 }), { heading: 200, source: 'kept' });
    assert.deepEqual(resolveHeading({ current: here }), { heading: null, source: 'none' });
  });

  it('turns the short way round', () => {
    assert.equal(continuousRotation(350, 10), 370);
    assert.equal(continuousRotation(10, 350), -10);
    assert.equal(continuousRotation(null, 90), 90);
    assert.equal(continuousRotation(90, 100), 100);
  });
});

describe('search radius', () => {
  it('draws only a radius the server reported', () => {
    assert.equal(searchRadiusFromStatus({ radiusM: 2000 }), 2000);
    assert.equal(searchRadiusFromStatus({ radiusM: 600 }), 600);
  });

  it('draws nothing when there is no usable radius (never an invented one)', () => {
    for (const status of [null, undefined, {}, { radiusM: null }, { radiusM: 0 }, { radiusM: -5 }, { radiusM: Number.NaN }, { radiusM: 1e9 }]) {
      assert.equal(searchRadiusFromStatus(status as never), null);
    }
  });

  it('grows between two radii and ends exactly on the new one', () => {
    assert.equal(tweenRadius(2000, 2500, 0), 2000);
    assert.equal(tweenRadius(2000, 2500, 1), 2500);
    const mid = tweenRadius(2000, 2500, 0.5);
    assert.ok(mid > 2000 && mid < 2500);
    assert.equal(tweenRadius(2000, 2500, 7), 2500);
  });
});
