import { DISPATCH_TIER3_MAX_SECONDS, DISPATCH_TIER3_RADIUS_STEPS } from '../config/policyConfig';
import { getDistanceKm } from './locationUtils';

// Pure rules of the driver search (Intelligent Driver Dispatch specification, sections 4-7). No timers and no network here:
// the dispatcher (apps/passenger-pwa/src/services/dispatchService.ts) supplies the clock and the data.

/** A driver the database says may be offered a booking: Available, verified, not on a trip, not yet offered it in this round. */
export interface DispatchCandidate {
  driver_id: string;
  toda_id: string | null;
  /** Straight-line distance from the pickup in km (rounded to 0.1 km), or null when the driver's position is unknown */
  distance_km: number | null;
}

export interface TodaTerminal {
  toda_id: string;
  terminal_latitude: number | string | null;
  terminal_longitude: number | string | null;
}

/**
 * The radius (km) of the live search `elapsedSeconds` after Tier 3 began, or null once the maximum duration has passed.
 */
export const tier3RadiusKm = (elapsedSeconds: number): number | null => {
  if (!(elapsedSeconds < DISPATCH_TIER3_MAX_SECONDS)) return null;
  let radiusKm: number = DISPATCH_TIER3_RADIUS_STEPS[0].radiusKm;
  for (const step of DISPATCH_TIER3_RADIUS_STEPS) {
    if (elapsedSeconds >= step.fromSecond) radiusKm = step.radiusKm;
  }
  return radiusKm;
};

/**
 * The accredited TODA whose registered terminal is nearest the pickup (the Priority TODA), or null when no TODA has a terminal position.
 */
export const nearestAccreditedTodaId = (todas: TodaTerminal[], pickupLat: number, pickupLng: number): string | null => {
  let nearestId: string | null = null;
  let nearestKm = Number.POSITIVE_INFINITY;
  for (const toda of todas) {
    if (!toda.terminal_latitude || !toda.terminal_longitude) continue;
    const km = getDistanceKm(pickupLat, pickupLng, Number(toda.terminal_latitude), Number(toda.terminal_longitude));
    if (km < nearestKm) {
      nearestKm = km;
      nearestId = toda.toda_id;
    }
  }
  return nearestId;
};

/**
 * The drivers of one tier, nearest first: inside the radius and, when `todaId` is given, affiliated with that TODA.
 * A driver whose position is unknown cannot be placed inside any radius and is left out. Drivers at the same distance keep the order
 * they came in (the database orders ties by driver id).
 */
export const selectTierCandidates = <T extends DispatchCandidate>(
  candidates: T[],
  options: { radiusKm: number; todaId?: string | null }
): T[] =>
  candidates
    .filter(
      (c) =>
        c.distance_km !== null &&
        c.distance_km !== undefined &&
        Number(c.distance_km) <= options.radiusKm &&
        (!options.todaId || c.toda_id === options.todaId)
    )
    .sort((a, b) => Number(a.distance_km) - Number(b.distance_km));
