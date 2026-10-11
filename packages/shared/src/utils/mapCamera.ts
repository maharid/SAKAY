/**
 * Map camera: where the map looks, given the part of the screen that is actually visible.
 *
 * A bottom sheet, a header or a floating panel covers part of the map. Centring "the map" then puts the thing you are looking at BEHIND
 * the sheet. Everything here works from the real covered area (`MapInsets`, in pixels, measured from the elements themselves) and from the
 * map's own projection, never from a guessed offset:
 *
 *   - `visibleRect` / `centerShift`   the uncovered rectangle and how far its centre is from the container's centre
 *   - `fitPadding`                    Leaflet's `paddingTopLeft` / `paddingBottomRight` for the same area, so bounds fit INSIDE it
 *   - `createMapCamera`               the behaviour on top of those: centre on a point, fit some points, follow a live marker, and
 *                                     re-frame (without a jump) when the covered area, the container size or the trip stage changes
 *
 * The controller talks to a map through the small `CameraMap` interface (Leaflet's `L.Map` satisfies it), so it can be driven by a fake map
 * in server/test/mapCamera.test.ts. It never calls a server and holds no GPS data of its own.
 */
import type { GeoPoint, GlideResult } from './markerGlide';

// ------------------------------------------------------------------------------------------------
// Geometry (pure)
// ------------------------------------------------------------------------------------------------

/** How much of the map container is covered on each side, in pixels */
export interface MapInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: MapInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export interface PixelSize {
  w: number;
  h: number;
}

export interface PixelPoint {
  x: number;
  y: number;
}

export interface PixelRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** At least this share of each dimension must stay uncovered, so an overlay taller than the screen cannot make the "visible area" vanish */
export const MIN_VISIBLE_FRACTION = 0.3;

const finite = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);

/** A complete set of insets from a partial one (missing, negative and non-numeric sides are 0) */
export function toInsets(partial?: Partial<MapInsets> | null): MapInsets {
  return { top: finite(partial?.top), right: finite(partial?.right), bottom: finite(partial?.bottom), left: finite(partial?.left) };
}

/** The insets scaled down, if they would leave less than `minFraction` of a dimension uncovered */
export function effectiveInsets(insets: MapInsets, size: PixelSize, minFraction = MIN_VISIBLE_FRACTION): MapInsets {
  const fit = (a: number, b: number, total: number): [number, number] => {
    const allowed = Math.max(0, total * (1 - minFraction));
    const sum = a + b;
    if (sum <= allowed || sum === 0) return [a, b];
    const k = allowed / sum;
    return [Math.round(a * k), Math.round(b * k)];
  };
  const [top, bottom] = fit(insets.top, insets.bottom, size.h);
  const [left, right] = fit(insets.left, insets.right, size.w);
  return { top, right, bottom, left };
}

/** The part of the container that nothing covers */
export function visibleRect(size: PixelSize, insets: MapInsets): PixelRect {
  const e = effectiveInsets(insets, size);
  return { left: e.left, top: e.top, right: size.w - e.right, bottom: size.h - e.bottom };
}

export function rectCenter(rect: PixelRect): PixelPoint {
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
}

/** From the container's centre to the visible area's centre (a bottom sheet makes y negative: the visible centre is higher up) */
export function centerShift(size: PixelSize, insets: MapInsets): PixelPoint {
  const c = rectCenter(visibleRect(size, insets));
  return { x: c.x - size.w / 2, y: c.y - size.h / 2 };
}

/** Leaflet fitBounds padding that keeps the bounds inside the visible area, with `margin` px of air around them */
export function fitPadding(
  size: PixelSize,
  insets: MapInsets,
  margin: number
): { paddingTopLeft: [number, number]; paddingBottomRight: [number, number] } {
  const e = effectiveInsets(insets, size);
  return { paddingTopLeft: [e.left + margin, e.top + margin], paddingBottomRight: [e.right + margin, e.bottom + margin] };
}

/** True when the two sets of insets differ by at least `threshold` px on some side (smaller changes are layout noise) */
export function insetsDiffer(a: MapInsets, b: MapInsets, threshold = 8): boolean {
  return (
    Math.abs(a.top - b.top) >= threshold ||
    Math.abs(a.right - b.right) >= threshold ||
    Math.abs(a.bottom - b.bottom) >= threshold ||
    Math.abs(a.left - b.left) >= threshold
  );
}

export function rectContains(rect: PixelRect, point: PixelPoint, margin = 0): boolean {
  return point.x >= rect.left + margin && point.x <= rect.right - margin && point.y >= rect.top + margin && point.y <= rect.bottom - margin;
}

/** The smallest pan (for `map.panBy`) that brings `point` inside `rect` with `margin` px to spare; {0,0} when it is already inside */
export function minimalPanToInclude(rect: PixelRect, point: PixelPoint, margin = 0): PixelPoint {
  const dx = point.x < rect.left + margin ? point.x - (rect.left + margin) : point.x > rect.right - margin ? point.x - (rect.right - margin) : 0;
  const dy = point.y < rect.top + margin ? point.y - (rect.top + margin) : point.y > rect.bottom - margin ? point.y - (rect.bottom - margin) : 0;
  return { x: dx, y: dy };
}

// ------------------------------------------------------------------------------------------------
// The controller
// ------------------------------------------------------------------------------------------------

/** The part of a Leaflet map the camera uses */
export interface CameraMap {
  getSize(): { x: number; y: number };
  getZoom(): number;
  project(latlng: [number, number], zoom?: number): { x: number; y: number };
  unproject(point: [number, number], zoom?: number): { lat: number; lng: number };
  latLngToContainerPoint(latlng: [number, number]): { x: number; y: number };
  panTo(latlng: [number, number], options?: Record<string, unknown>): unknown;
  panBy(offset: [number, number], options?: Record<string, unknown>): unknown;
  setView(latlng: [number, number], zoom?: number, options?: Record<string, unknown>): unknown;
  fitBounds(bounds: [[number, number], [number, number]], options?: Record<string, unknown>): unknown;
  invalidateSize(options?: Record<string, unknown>): unknown;
}

/**
 *  auto    nobody has asked for anything: the first good frame is fitted once, then the driver is followed
 *  free    the person dragged or zoomed: the camera leaves the map alone until they ask for a frame again
 *  user    following the passenger's own position
 *  driver  following the driver's position
 *  route   the whole route is framed and stays framed (a marker that nears the edge is nudged back into view)
 *  search  the driver-search area is framed
 */
export type CameraMode = 'auto' | 'free' | 'user' | 'driver' | 'route' | 'search';

export interface MapCameraOptions {
  /** Pixels of air kept around fitted points (default 28) */
  margin?: number;
  /** Fitting never zooms in closer than this (default 16) */
  maxFitZoom?: number;
  /** "Centre on me" never leaves the map zoomed out further than this (default 16) */
  followZoom?: number;
  reducedMotion?: () => boolean;
  /** Re-framing waits this long after the last change (a sheet animates for ~350 ms) */
  settleMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Told whenever the mode changes, so a control can show whether it is "on" */
  onModeChange?: (mode: CameraMode) => void;
  /**
   * Which live marker the camera follows while nobody has asked for anything ("auto"): the driver when there is one (default), or the
   * passenger's own dot when there is nothing else on the map, or none.
   */
  autoFollow?: () => 'user' | 'driver' | null;
}

export interface FitRequest {
  points: GeoPoint[];
  /** Identifies what is being framed (the route's destination, say): an automatic fit happens once per key */
  key?: string;
  /** From a control the person pressed: it also takes the camera back from "free" */
  explicit?: boolean;
  kind?: 'route' | 'search';
  maxZoom?: number;
}

export interface MapCamera {
  mode(): CameraMode;
  insets(): MapInsets;
  /** The covered area changed (a sheet opened or closed, a panel appeared). Small changes are ignored; the rest re-frame after they settle. */
  setInsets(next: Partial<MapInsets>): void;
  /** The container changed size (rotation, window, keyboard) */
  resized(): void;
  /** The person dragged or zoomed the map: hands it over */
  userMoved(): void;
  /** Takes the camera back from "free" (a recenter was asked for): the automatic framing and following apply again */
  release(): void;
  /** Centre on a point in the VISIBLE area. `explicit` (a control) starts following `follow`. */
  centerOn(point: GeoPoint, options?: { explicit?: boolean; follow?: 'user' | 'driver'; minZoom?: number }): boolean;
  /** Fit points inside the visible area. Returns false when nothing was done (a fit for this key already happened, or the map is "free"). */
  fit(request: FitRequest): boolean;
  /** A live marker was moved to `point` (the glide's result says how). Keeps it in view, and centred when it is the one being followed. */
  followMarker(kind: 'user' | 'driver', point: GeoPoint, result: GlideResult | null): void;
  /** The trip moved to another stage: the next automatic fit happens again (a map the person is exploring is left alone) */
  stageChanged(key: string): void;
  destroy(): void;
}

const tuple = (p: GeoPoint): [number, number] => [p.lat, p.lng];

const defaultReducedMotion = (): boolean => {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/** The latitude/longitude the map must be CENTRED on for `target` to appear at the middle of the visible area at `zoom` */
export function centerForVisible(map: CameraMap, target: GeoPoint, insets: MapInsets, zoom: number): GeoPoint {
  const s = map.getSize();
  const shift = centerShift({ w: s.x, h: s.y }, insets);
  const p = map.project(tuple(target), zoom);
  const c = map.unproject([p.x - shift.x, p.y - shift.y], zoom);
  return { lat: c.lat, lng: c.lng };
}

export function createMapCamera(map: CameraMap, options: MapCameraOptions = {}): MapCamera {
  const margin = options.margin ?? 28;
  const maxFitZoom = options.maxFitZoom ?? 16;
  const followZoom = options.followZoom ?? 16;
  const settleMs = options.settleMs ?? 160;
  const reducedMotion = options.reducedMotion ?? defaultReducedMotion;
  const autoFollow = options.autoFollow ?? (() => 'driver' as const);
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let mode: CameraMode = 'auto';
  let covered: MapInsets = { ...NO_INSETS };
  let framed: { points: GeoPoint[]; key?: string; kind: 'route' | 'search'; maxZoom: number } | null = null;
  let autoFitKey: string | null = null;
  /** The last thing the camera did was frame points (not follow a marker): a screen that is still settling is re-framed, not re-centred */
  let frameFresh = false;
  let stageKey: string | null = null;
  const lastMarker: { user: GeoPoint | null; driver: GeoPoint | null } = { user: null, driver: null };
  let reframeTimer: unknown = null;
  let destroyed = false;

  const size = (): PixelSize => {
    const s = map.getSize();
    return { w: s.x, h: s.y };
  };
  const animate = () => !reducedMotion();

  const setMode = (next: CameraMode) => {
    if (mode === next) return;
    mode = next;
    options.onModeChange?.(mode);
  };

  const visible = () => visibleRect(size(), covered);

  const containerPoint = (p: GeoPoint): PixelPoint => {
    const c = map.latLngToContainerPoint(tuple(p));
    return { x: c.x, y: c.y };
  };

  const doFit = (points: GeoPoint[], maxZoom: number, animateIt: boolean) => {
    frameFresh = true;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    for (const p of points) {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLng = Math.min(minLng, p.lng);
      maxLng = Math.max(maxLng, p.lng);
    }
    map.fitBounds(
      [
        [minLat, minLng],
        [maxLat, maxLng],
      ],
      { ...fitPadding(size(), covered, margin), maxZoom, animate: animateIt }
    );
  };

  const panToVisibleCenter = (target: GeoPoint, animateIt: boolean, duration?: number, linear = false) => {
    const zoom = map.getZoom();
    const c = centerForVisible(map, target, covered, zoom);
    const opts: Record<string, unknown> = { animate: animateIt };
    if (animateIt && duration !== undefined) {
      opts.duration = duration;
      if (linear) {
        opts.easeLinearity = 1;
        opts.noMoveStart = true;
      }
    }
    map.panTo(tuple(c), opts);
  };

  /** After the covered area or the container changed: keep what was framed in view, with no jump when it already is */
  const reframe = () => {
    reframeTimer = null;
    if (destroyed || mode === 'free') return;
    map.invalidateSize({ pan: false });
    const followed = mode === 'user' || mode === 'driver' ? mode : mode === 'auto' ? autoFollow() : null;
    const subject = followed ? lastMarker[followed] : null;
    // A frame is held (and re-fitted when part of it is hidden) when the person asked for it, or when it is the screen's own first framing and
    // nothing has followed a marker since (the sheets are still settling). Otherwise someone is being followed: they stay in the middle of
    // what is now visible, at the zoom the map already has: re-fitting the whole route would zoom the map out every time a sheet moved.
    const holdFrame = framed !== null && (mode === 'route' || mode === 'search' || (mode === 'auto' && (frameFresh || !subject)));
    if (holdFrame && framed) {
      const rect = visible();
      // "hidden" means within half the fitting margin of the edge: a pin touching a panel is as good as hidden, and a re-fit puts every point
      // a full margin inside, so this settles (it never re-fits twice for the same layout)
      const allIn = framed.points.every((p) => rectContains(rect, containerPoint(p), margin / 2));
      if (!allIn) doFit(framed.points, framed.maxZoom, animate());
      return;
    }
    if (subject) {
      const middle = rectCenter(visible());
      const at = containerPoint(subject);
      if (Math.abs(at.x - middle.x) > 3 || Math.abs(at.y - middle.y) > 3) {
        panToVisibleCenter(subject, animate());
        frameFresh = false;
      }
    }
  };

  const scheduleReframe = () => {
    if (reframeTimer !== null) clearTimer(reframeTimer);
    reframeTimer = setTimer(reframe, settleMs);
  };

  return {
    mode: () => mode,
    insets: () => ({ ...covered }),

    setInsets(next) {
      const merged = toInsets({
        top: next.top ?? covered.top,
        right: next.right ?? covered.right,
        bottom: next.bottom ?? covered.bottom,
        left: next.left ?? covered.left,
      });
      if (!insetsDiffer(covered, merged)) return;
      covered = merged;
      scheduleReframe();
    },

    resized() {
      scheduleReframe();
    },

    userMoved() {
      setMode('free');
    },

    release() {
      setMode('auto');
    },

    centerOn(point, opts = {}) {
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || (point.lat === 0 && point.lng === 0)) return false;
      if (opts.explicit) setMode(opts.follow ?? 'user');
      frameFresh = false;
      const zoom = Math.max(map.getZoom(), opts.minZoom ?? followZoom);
      const c = centerForVisible(map, point, covered, zoom);
      map.setView(tuple(c), zoom, { animate: animate() });
      if (opts.follow === 'driver' || mode === 'driver') lastMarker.driver = point;
      else if (opts.follow === 'user' || mode === 'user') lastMarker.user = point;
      return true;
    },

    fit(request) {
      const points = request.points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && !(p.lat === 0 && p.lng === 0));
      if (points.length === 0) return false;
      const kind = request.kind ?? 'route';
      const maxZoom = request.maxZoom ?? maxFitZoom;
      if (request.explicit) {
        setMode(kind);
      } else {
        if (mode === 'free') return false;
        if (request.key !== undefined && autoFitKey === request.key) {
          // already framed for this key: only remember the points (a route that was redrawn), do not move the camera
          framed = { points, key: request.key, kind, maxZoom };
          return false;
        }
      }
      autoFitKey = request.key ?? autoFitKey;
      framed = { points, key: request.key, kind, maxZoom };
      doFit(points, maxZoom, animate());
      return true;
    },

    followMarker(kind, point, result) {
      lastMarker[kind] = point;
      if (!result || result.status === 'ignored' || mode === 'free' || destroyed) return;
      const centred = mode === kind || (mode === 'auto' && autoFollow() === kind);
      if (centred) {
        frameFresh = false;
        if (result.status === 'gliding' && animate()) {
          // pan in a straight line over the same time as the glide: the marker stays put on screen and the map slides under it
          panToVisibleCenter(point, true, result.durationMs / 1000, true);
        } else {
          panToVisibleCenter(point, animate() && result.status === 'snapped' && result.reason === 'jump');
        }
        return;
      }
      // Not the followed marker: only make sure it has not slipped out of view (route / search frames, or a user dot while following the driver)
      if (mode === 'route' || mode === 'auto' || mode === 'user' || mode === 'driver') {
        const rect = visible();
        const pan = minimalPanToInclude(rect, containerPoint(point), margin);
        if (pan.x !== 0 || pan.y !== 0) map.panBy([pan.x, pan.y], { animate: animate() });
      }
    },

    stageChanged(key) {
      if (key === stageKey) return;
      stageKey = key;
      if (mode !== 'free') autoFitKey = null;
    },

    destroy() {
      destroyed = true;
      if (reframeTimer !== null) clearTimer(reframeTimer);
      reframeTimer = null;
    },
  };
}
