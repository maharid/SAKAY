/**
 * Smooth movement of a map marker between GPS fixes.
 *
 * A fix arrives about every 5 seconds (ACTIVE_TRIP_GPS_INTERVAL_SECONDS). Setting the marker straight to each one makes it teleport.
 * This engine slides the DISPLAYED position from where it is now to the newest fix over about one update interval, in a straight line at
 * constant speed. It is a drawing aid only: the fixes themselves (what the database stores, and what routing, distance, fare and trip
 * progress use) are never changed, and nothing here talks to a server.
 *
 *   - the first fix, a far jump, and `prefers-reduced-motion` place the marker immediately (a glide would only mislead);
 *   - a new fix while one is still sliding starts from the position currently DISPLAYED, so the marker never snaps backward;
 *   - the same position again, or a move too small to see, is ignored and does not restart the slide;
 *   - an invalid fix (not a finite lat/lng in range, or the (0, 0) placeholder) is ignored, and so is one stamped OLDER than a fix already
 *     accepted (reordered delivery);
 *   - the frame loop runs only while sliding, at most ~30 times a second, and stop() cancels it (components call it on unmount).
 *
 * Pure: the clock and the frame scheduler are injected, so server/test/markerGlide.test.ts drives it deterministically.
 */
import { ACTIVE_TRIP_GPS_INTERVAL_MS } from '../config/policyConfig';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface GlideFix extends GeoPoint {
  /** When the SENDER took the fix (ms, any monotone clock of that one sender). Used only to drop fixes that arrive out of order. */
  at?: number;
}

export type GlideResult =
  /** Placed immediately: the first fix, a far jump (a stale position corrected), or a person who prefers reduced motion */
  | { status: 'snapped'; reason: 'first' | 'jump' | 'reduced-motion' }
  | { status: 'gliding'; durationMs: number }
  | { status: 'ignored'; reason: 'invalid' | 'out-of-order' | 'unchanged' };

export interface MarkerGlideOptions {
  /** Draws the marker at this position (e.g. marker.setLatLng) */
  onPosition: (position: GeoPoint) => void;
  now?: () => number;
  requestFrame?: (callback: () => void) => unknown;
  cancelFrame?: (handle: unknown) => void;
  /** The slide lasts as long as the gap between the last two distinct fixes, kept inside [minDurationMs, maxDurationMs] */
  defaultDurationMs?: number;
  minDurationMs?: number;
  maxDurationMs?: number;
  /** A jump farther than this is placed immediately (a stale position being corrected, not a vehicle moving) */
  snapDistanceMeters?: number;
  /** A move smaller than this (GPS noise) is not worth a slide */
  minMoveMeters?: number;
  /** Frames are drawn at most this often (ms) */
  minFrameIntervalMs?: number;
  reducedMotion?: () => boolean;
}

export interface MarkerGlide {
  push: (fix: GlideFix | null | undefined) => GlideResult;
  /** The position the marker should be drawn at right now (null before the first valid fix) */
  current: () => GeoPoint | null;
  isAnimating: () => boolean;
  /** Stops the frame loop; the marker stays where it is. Call on unmount. */
  stop: () => void;
  /** Stops and forgets the position (the marker is gone). */
  reset: () => void;
}

/** A finite lat/lng inside the globe, and not the (0, 0) the apps use for "no position yet". */
export function isValidGeoPoint(point: unknown): point is GeoPoint {
  if (!point || typeof point !== 'object') return false;
  const { lat, lng } = point as { lat?: unknown; lng?: unknown };
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return !(lat === 0 && lng === 0);
}

const METERS_PER_DEGREE_LAT = 111195;

/** Straight-line metres between two nearby points (accurate to well under a percent over the distances a trip covers). */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = (b.lat - a.lat) * METERS_PER_DEGREE_LAT;
  const dLng = (b.lng - a.lng) * METERS_PER_DEGREE_LAT * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/** The point `t` (0..1) of the way from `from` to `to`. */
export function interpolatePoint(from: GeoPoint, to: GeoPoint, t: number): GeoPoint {
  const k = Math.min(1, Math.max(0, t));
  return { lat: from.lat + (to.lat - from.lat) * k, lng: from.lng + (to.lng - from.lng) * k };
}

const browserNow = (): number => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
const browserFrame = (callback: () => void): unknown => {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
  return setTimeout(callback, 16);
};
const browserCancel = (handle: unknown): void => {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle as number);
  else clearTimeout(handle as ReturnType<typeof setTimeout>);
};
const browserReducedMotion = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createMarkerGlide(options: MarkerGlideOptions): MarkerGlide {
  const now = options.now ?? browserNow;
  const requestFrame = options.requestFrame ?? browserFrame;
  const cancelFrame = options.cancelFrame ?? browserCancel;
  const reducedMotion = options.reducedMotion ?? browserReducedMotion;
  const defaultDurationMs = options.defaultDurationMs ?? ACTIVE_TRIP_GPS_INTERVAL_MS;
  const minDurationMs = options.minDurationMs ?? 800;
  const maxDurationMs = options.maxDurationMs ?? 6000;
  const snapDistanceMeters = options.snapDistanceMeters ?? 1000;
  const minMoveMeters = options.minMoveMeters ?? 1;
  const minFrameIntervalMs = options.minFrameIntervalMs ?? 33;

  let from: GeoPoint | null = null;
  let to: GeoPoint | null = null;
  let startedAt = 0;
  let durationMs = 0;
  let lastFixAt: number | null = null; // the newest sender stamp accepted
  let lastTargetChangeAt: number | null = null; // when the target last moved (this phone's clock)
  let frameHandle: unknown = null;
  let lastDrawnAt = -Infinity;

  const positionNow = (): GeoPoint | null => {
    if (!to) return null;
    if (!from || durationMs <= 0) return to;
    const t = (now() - startedAt) / durationMs;
    return t >= 1 ? to : interpolatePoint(from, to, t);
  };

  const isDone = (): boolean => !to || !from || durationMs <= 0 || now() - startedAt >= durationMs;

  const cancelLoop = (): void => {
    if (frameHandle !== null) {
      cancelFrame(frameHandle);
      frameHandle = null;
    }
  };

  const frame = (): void => {
    frameHandle = null;
    const at = now();
    const finished = isDone();
    // Draw at most every minFrameIntervalMs, but always draw the final position.
    if (finished || at - lastDrawnAt >= minFrameIntervalMs) {
      const position = positionNow();
      if (position) options.onPosition(position);
      lastDrawnAt = at;
    }
    if (!finished) frameHandle = requestFrame(frame);
  };

  const place = (point: GeoPoint): void => {
    cancelLoop();
    from = point;
    to = point;
    durationMs = 0;
    options.onPosition(point);
    lastDrawnAt = now();
  };

  return {
    push(fix) {
      if (!isValidGeoPoint(fix)) return { status: 'ignored', reason: 'invalid' };
      const target: GeoPoint = { lat: fix.lat, lng: fix.lng };

      if (typeof fix.at === 'number' && Number.isFinite(fix.at)) {
        if (lastFixAt !== null && fix.at <= lastFixAt) return { status: 'ignored', reason: 'out-of-order' };
        lastFixAt = fix.at;
      }

      const displayed = positionNow();
      if (displayed === null) {
        place(target);
        lastTargetChangeAt = now();
        return { status: 'snapped', reason: 'first' };
      }

      // The same place again (the driver app repeats its position every couple of seconds) or noise: leave the slide alone.
      if (to && distanceMeters(to, target) < minMoveMeters) return { status: 'ignored', reason: 'unchanged' };

      const at = now();
      const sinceLastMove = lastTargetChangeAt === null ? defaultDurationMs : at - lastTargetChangeAt;
      lastTargetChangeAt = at;

      const calm = reducedMotion();
      if (calm || distanceMeters(displayed, target) > snapDistanceMeters) {
        place(target);
        return { status: 'snapped', reason: calm ? 'reduced-motion' : 'jump' };
      }

      from = displayed; // start where the marker IS, never where it was heading
      to = target;
      startedAt = at;
      durationMs = Math.min(maxDurationMs, Math.max(minDurationMs, sinceLastMove));
      if (frameHandle === null) frameHandle = requestFrame(frame);
      return { status: 'gliding', durationMs };
    },
    current: positionNow,
    isAnimating: () => frameHandle !== null,
    stop: cancelLoop,
    reset() {
      cancelLoop();
      from = null;
      to = null;
      durationMs = 0;
      lastFixAt = null;
      lastTargetChangeAt = null;
      lastDrawnAt = -Infinity;
    },
  };
}

/** The part of a map marker (a Leaflet marker has all of it) the controller drives. */
export interface LiveMarkerLike {
  setLatLng: (latlng: [number, number]) => unknown;
  remove: () => unknown;
}

export interface LiveMarkerOptions<M extends LiveMarkerLike> {
  /** Makes the marker and adds it to the map, at this position */
  create: (position: GeoPoint) => M;
  glide?: Partial<Omit<MarkerGlideOptions, 'onPosition'>>;
}

export interface LiveMarker {
  /**
   * The newest position of the thing the marker stands for.
   *   null / undefined  -> there is nothing to show: the marker is removed (a driver who is not assigned yet)
   *   an invalid fix    -> ignored; the marker stays where it is (a bad reading must not make the vehicle vanish)
   *   a valid fix       -> the marker is made at the first one, then slides to each next one
   */
  update: (fix: GlideFix | null | undefined) => GlideResult | null;
  hasMarker: () => boolean;
  /** Cancels the animation and removes the marker. Call on unmount. */
  destroy: () => void;
}

/** One map marker that glides between the positions it is given (see createMarkerGlide). Leaflet-free: the map code passes `create`. */
export function createLiveMarker<M extends LiveMarkerLike>(options: LiveMarkerOptions<M>): LiveMarker {
  let marker: M | null = null;
  const glide = createMarkerGlide({
    ...options.glide,
    onPosition: (position) => {
      if (marker) marker.setLatLng([position.lat, position.lng]);
    },
  });
  return {
    update(fix) {
      if (fix === null || fix === undefined) {
        glide.reset();
        if (marker) marker.remove();
        marker = null;
        return null;
      }
      if (!isValidGeoPoint(fix)) return { status: 'ignored', reason: 'invalid' };
      if (!marker) marker = options.create({ lat: fix.lat, lng: fix.lng });
      return glide.push(fix);
    },
    hasMarker: () => marker !== null,
    destroy() {
      glide.stop();
      if (marker) marker.remove();
      marker = null;
    },
  };
}
