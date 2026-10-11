/**
 * The search circle drawn around the pickup while a driver is being looked for.
 *
 * The radius is NOT decided here. The database decides how far it is looking (Tier 1: the Priority TODA's drivers within 600 m; Tier 2: any
 * accredited TODA within 2 km; Tier 3: 2 km growing to 3.5 km) and `get_dispatch_status` reports the radius it is using right now
 * (`radius_m`). The map draws that number and nothing else: no status, no circle, never an invented one.
 */

/** Anything bigger than this is not a pickup search area (the service area itself is smaller); it is treated as "not known" */
export const SEARCH_RADIUS_MAX_METERS = 20_000;

export interface SearchRadiusSource {
  /** `radius_m` from get_dispatch_status (null / absent when the search is not running or the database does not report one) */
  radiusM?: number | null;
}

/** The radius to draw, in metres, or null when there is nothing trustworthy to draw */
export function searchRadiusFromStatus(status: SearchRadiusSource | null | undefined): number | null {
  const radius = status?.radiusM;
  if (typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0 || radius > SEARCH_RADIUS_MAX_METERS) return null;
  return radius;
}

/** The radius `progress` (0..1) of the way from `from` to `to`, eased out, for the short growth when the search widens */
export function tweenRadius(from: number, to: number, progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  const eased = 1 - (1 - t) * (1 - t);
  return from + (to - from) * eased;
}
