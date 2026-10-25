import { getOSRMRoute } from '@sakay/shared';

// The road a trip is meant to follow, for the Live map. The geometry comes from the road routing the apps already use (getOSRMRoute in @sakay/shared: OSRM, the same
// two servers in the same order). A trip's pickup and destination do not move, so its road is asked for ONCE and kept for the session; the live driver position does
// not change the road, so a 10-second refresh of the list never makes a new request. A request that failed is only tried again after a minute.

export type LatLng = [number, number];

/** What the map has for a trip: the road is still being asked for, the road itself (drawn along the streets), or no road could be had (never drawn as a road) */
export type TripRoad = { state: 'loading' } | { state: 'road'; points: [number, number][] } | { state: 'unavailable' };

/** A failed request waits this long before the next try */
const RETRY_AFTER_MS = 60_000;
/** A routing server that does not answer in this time counts as failed */
const REQUEST_TIMEOUT_MS = 10_000;
/** The most roads kept (the oldest go first); a day of trips is far below this */
const MAX_ROADS = 200;

const roads = new Map<string, [number, number][]>();
const pending = new Set<string>();
const failedAt = new Map<string, number>();

const valid = (p: LatLng): boolean => Number.isFinite(p[0]) && Number.isFinite(p[1]) && !(p[0] === 0 && p[1] === 0) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;
// 5 decimals is about a metre: the same two places always give the same key
const keyOf = (a: LatLng, b: LatLng): string => `${a[0].toFixed(5)},${a[1].toFixed(5)};${b[0].toFixed(5)},${b[1].toFixed(5)}`;

/** Both places are real, and they are not the same place (there is no road between a place and itself) */
export const hasRoutablePlaces = (from: LatLng, to: LatLng): boolean => valid(from) && valid(to) && keyOf(from, from) !== keyOf(to, to);

const timeout = (ms: number) => new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));

/**
 * The road between two places. Answers at once from what is kept; when nothing is kept it starts ONE request (a second call for the same two places waits for that one)
 * and calls `onSettled` when it has finished, so the map can draw again. A straight line between the two places (what the routing helper hands back when no server
 * answered) is NOT a road: it is reported as unavailable.
 */
export function roadBetween(from: LatLng, to: LatLng, onSettled: () => void): TripRoad {
  const key = keyOf(from, to);
  const known = roads.get(key);
  if (known) return { state: 'road', points: known };
  if (pending.has(key)) return { state: 'loading' };
  const failed = failedAt.get(key);
  if (failed !== undefined && Date.now() - failed < RETRY_AFTER_MS) return { state: 'unavailable' };

  pending.add(key);
  void Promise.race([getOSRMRoute(from[0], from[1], to[0], to[1]), timeout(REQUEST_TIMEOUT_MS)])
    .then((route) => {
      if (route && route.source === 'osrm' && route.coordinates.length >= 2) {
        if (roads.size >= MAX_ROADS) roads.delete(roads.keys().next().value as string);
        roads.set(key, route.coordinates);
        failedAt.delete(key);
      } else {
        failedAt.set(key, Date.now());
      }
    })
    .catch(() => failedAt.set(key, Date.now()))
    .finally(() => {
      pending.delete(key);
      onSettled();
    });
  return { state: 'loading' };
}
