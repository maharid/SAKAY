/**
 * Which way a vehicle is pointing, from the data a phone really has.
 *
 * `GeolocationCoordinates.heading` is the direction of travel in degrees clockwise from true north. A phone reports it only while it is
 * moving (it is null or NaN at a standstill) and it is unreliable at walking pace, so:
 *
 *   1. the device's own heading, when it is a real number and the vehicle is moving fast enough for it to mean something;
 *   2. otherwise the direction of the movement itself (the bearing from the previous fix to this one), once it has moved far enough
 *      to be more than GPS noise;
 *   3. otherwise the last heading that was known (a vehicle stopped at a junction still points where it was going);
 *   4. otherwise none. A marker with no heading is drawn without a direction: nothing here is ever made up.
 */
import { distanceMeters, type GeoPoint } from './markerGlide';

/** Below this speed (m/s, about 3.6 km/h) the device's heading is not trusted */
export const HEADING_MIN_SPEED_MPS = 1;
/** A move shorter than this (m) is GPS noise, not a direction */
export const HEADING_MIN_MOVE_METERS = 8;

/** A heading as degrees in [0, 360), or null when it is not a usable number */
export function normalizeHeading(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const wrapped = ((value % 360) + 360) % 360;
  return wrapped;
}

/** The initial bearing from one point to another, degrees clockwise from north in [0, 360) */
export function bearingDegrees(from: GeoPoint, to: GeoPoint): number {
  const toRad = Math.PI / 180;
  const phi1 = from.lat * toRad;
  const phi2 = to.lat * toRad;
  const dLambda = (to.lng - from.lng) * toRad;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return normalizeHeading((Math.atan2(y, x) * 180) / Math.PI) ?? 0;
}

export type HeadingSource = 'gps' | 'movement' | 'kept' | 'none';

export interface HeadingInput {
  /** `coords.heading` from the device (may be null / NaN) */
  reported?: number | null;
  /** `coords.speed` from the device, in m/s (may be null / NaN) */
  speedMps?: number | null;
  /** The fix before this one, when there is one */
  previous?: GeoPoint | null;
  current: GeoPoint;
  /** The heading shown so far */
  lastHeading?: number | null;
}

export interface HeadingResult {
  heading: number | null;
  source: HeadingSource;
}

export function resolveHeading(input: HeadingInput): HeadingResult {
  const reported = normalizeHeading(input.reported);
  const speed = typeof input.speedMps === 'number' && Number.isFinite(input.speedMps) ? input.speedMps : null;
  if (reported !== null && (speed === null || speed >= HEADING_MIN_SPEED_MPS)) return { heading: reported, source: 'gps' };

  if (input.previous && distanceMeters(input.previous, input.current) >= HEADING_MIN_MOVE_METERS) {
    return { heading: bearingDegrees(input.previous, input.current), source: 'movement' };
  }

  const last = normalizeHeading(input.lastHeading);
  if (last !== null) return { heading: last, source: 'kept' };
  return { heading: null, source: 'none' };
}

/**
 * The angle to DRAW so a marker turns the short way round: from 350° to 10° is +20°, not -340°. Returns a value that may leave [0, 360)
 * (it keeps counting), which is what a CSS rotation wants.
 */
export function continuousRotation(displayed: number | null, next: number): number {
  if (displayed === null || !Number.isFinite(displayed)) return next;
  const delta = ((((next - displayed) % 360) + 540) % 360) - 180;
  return displayed + delta;
}
