/**
 * Trip progress: how far a tricycle with the passenger on board has got toward the destination pin.
 *
 * ONE formula for the passenger screen, the driver screen and the database (public._trip_progress_pct, migration
 * 20261017000001): a straight-line estimate, so the percentage the driver reads is the percentage the server enforces. The drift test
 * scripts/db-tests/batch6/config-drift.js keeps the constants in policyConfig.ts equal to the database's.
 *
 * While the trip is in progress the value is between FLOOR and CAP (5 - 95). 100% belongs to a trip that has arrived (the status
 * 'Arrived at Destination'), never to a position: the destination pin can sit inside an establishment the tricycle cannot enter.
 */
import {
  TRIP_FINISH_MIN_PROGRESS_PERCENT,
  TRIP_PROGRESS_CAP_PERCENT,
  TRIP_PROGRESS_FLOOR_PERCENT,
  TRIP_PROGRESS_NEAR_DESTINATION_METERS,
} from '../config/policyConfig';
import { calculateDistanceKm } from './locationUtils';
import type { RpcCapableClient } from './restrictionUtils';

export interface TripProgressInput {
  /** Straight-line distance pickup -> destination (km) */
  totalKm: number;
  /** Straight-line distance from the driver's latest fix to the destination pin (km) */
  driverToDestinationKm: number;
  /** The highest value already shown for this trip: the figure does not slide back when the GPS jitters */
  previousPercent?: number;
}

/**
 * The progress (whole percent, FLOOR..CAP) for one position. Nothing readable (a missing or invalid distance) leaves the previous value.
 * The same arithmetic the apps always used: round((total - remaining) / total), "near the pin" reads the maximum, never above the cap.
 */
export function calculateTripProgressPercent({ totalKm, driverToDestinationKm, previousPercent = 0 }: TripProgressInput): number {
  if (!Number.isFinite(driverToDestinationKm) || driverToDestinationKm < 0) return Math.max(0, previousPercent);
  const nearKm = TRIP_PROGRESS_NEAR_DESTINATION_METERS / 1000;
  let here: number;
  if (driverToDestinationKm <= nearKm) {
    here = TRIP_PROGRESS_CAP_PERCENT;
  } else if (Number.isFinite(totalKm) && totalKm > 0) {
    here = Math.max(TRIP_PROGRESS_FLOOR_PERCENT, Math.round(((totalKm - driverToDestinationKm) / totalKm) * 100));
  } else {
    here = 50; // a trip whose pickup and destination are the same point has no distance to measure
  }
  return Math.min(TRIP_PROGRESS_CAP_PERCENT, Math.max(previousPercent, here));
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** The progress of a driver at `driver` on the trip pickup -> dropoff, using the apps' straight-line distance. */
export function calculateTripProgressFromPositions(pickup: LatLng, dropoff: LatLng, driver: LatLng, previousPercent = 0): number {
  return calculateTripProgressPercent({
    totalKm: calculateDistanceKm(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng),
    driverToDestinationKm: calculateDistanceKm(driver.lat, driver.lng, dropoff.lat, dropoff.lng),
    previousPercent,
  });
}

/** The driver may finish the trip from this progress up. The comparison is inclusive and on the whole-percent value (as the database does). */
export function isTripFinishable(progressPercent: number | null | undefined): boolean {
  return typeof progressPercent === 'number' && Number.isFinite(progressPercent) && progressPercent >= TRIP_FINISH_MIN_PROGRESS_PERCENT;
}

/** The progress as the database holds it (get_trip_progress): the figure the driver's finish is checked against. */
export interface ServerTripProgress {
  /** null: the database has no usable fix of the trip yet */
  progressPercent: number | null;
  minFinishPercent: number;
  canFinish: boolean;
}

/**
 * Asks the database for the trip's progress (both the passenger and the driver of the booking may). null when it could not be read: a
 * database that does not have the function yet, or a network error. The caller then keeps its own estimate; the database still decides
 * when the driver finishes.
 */
export async function fetchServerTripProgress(client: RpcCapableClient, bookingId: string): Promise<ServerTripProgress | null> {
  try {
    const { data, error } = await client.rpc('get_trip_progress', { p_booking_id: bookingId });
    const row = data as { success?: boolean; progress_pct?: number | null; min_finish_pct?: number; can_finish?: boolean } | null;
    if (error || !row || row.success === false) return null;
    const pct = row.progress_pct === null || row.progress_pct === undefined ? null : Number(row.progress_pct);
    return {
      progressPercent: pct !== null && Number.isFinite(pct) ? pct : null,
      minFinishPercent: Number(row.min_finish_pct ?? TRIP_FINISH_MIN_PROGRESS_PERCENT),
      canFinish: Boolean(row.can_finish),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// What the person SEES. The figure above is what the database checks; what the screen draws moves toward it at a pace a tricycle can explain,
// and ignores a position no tricycle could have reached, so the bar never leaps from 64% to 95% on one odd fix.
// ---------------------------------------------------------------------------------------------------------------------------------------

/** The bar rises at most this many percentage points per second (a real trip rises a fraction of a point per second: this only limits a jump) */
export const TRIP_PROGRESS_MAX_RISE_POINTS_PER_SECOND = 2;

/** A tricycle does not travel faster than this between two fixes (m/s, about 100 km/h): a position that implies more is held back as a GPS error */
export const TRIP_PROGRESS_MAX_PLAUSIBLE_SPEED_MPS = 28;

/** After this long without a fix (the phone was asleep, the connection dropped) any position is believed: the tricycle really may be far from where it was */
export const TRIP_PROGRESS_FIX_GAP_BELIEVED_MS = 60_000;

/** This many positions in a row that "could not be reached" mean the tricycle really is there: they are believed after all */
export const TRIP_PROGRESS_REJECTED_FIXES_BEFORE_BELIEVING = 3;

/**
 * The figure to draw next (keep it as it is returned, with its fraction; round only when it is shown). It never goes down, never passes `target`, and rises by at most
 * TRIP_PROGRESS_MAX_RISE_POINTS_PER_SECOND.
 * 100 (the trip has arrived: the status says so, not a position) is shown at once, as is the first figure of a screen (`shown` null).
 */
export function stepShownProgress(shown: number | null, target: number, elapsedMs: number): number {
  if (!Number.isFinite(target)) return shown ?? 0;
  if (shown === null || !Number.isFinite(shown)) return target;
  if (target >= 100) return 100;
  if (target <= shown) return shown;
  const room = (Math.max(0, elapsedMs) / 1000) * TRIP_PROGRESS_MAX_RISE_POINTS_PER_SECOND;
  return Math.min(target, shown + room);
}

export interface FixSample extends LatLng {
  atMs: number;
}

/** Could a tricycle have gone from `previous` to `next` in the time between the two? (A first fix, or one after a long silence, is always believed.) */
export function isPlausibleFix(previous: FixSample | null, next: FixSample): boolean {
  if (!previous) return true;
  const elapsedMs = next.atMs - previous.atMs;
  if (elapsedMs >= TRIP_PROGRESS_FIX_GAP_BELIEVED_MS) return true;
  const movedM = calculateDistanceKm(previous.lat, previous.lng, next.lat, next.lng) * 1000;
  const seconds = Math.max(2, elapsedMs / 1000); // two fixes that arrive together still count as a couple of seconds apart
  return movedM / seconds <= TRIP_PROGRESS_MAX_PLAUSIBLE_SPEED_MPS;
}
