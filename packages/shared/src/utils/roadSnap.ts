import { OSRM_BASE_URLS, PIN_ROAD_MAX_DISTANCE_M } from '../config/policyConfig';

/**
 * Pins must lie on a road (panel comment, decision D-P3): "guard rails sa map ... dapat hindi napi-pin yung mga ilog ... dapat within Calapan roads".
 *
 * The routing service the apps already use for road distance (OSRM) also answers "which road is nearest to this point, and how far away is it?" (/nearest). A pin on
 * a river, in the bay or in the middle of a field is far from every road; a pin on a street is a few metres from one. snapToRoad() asks, and says:
 *
 *   on_road   a road lies within `maxDistanceM` (default PIN_ROAD_MAX_DISTANCE_M): the pin is MOVED onto that road (lat / lng are the road's point), so what is
 *             booked is a place a tricycle can actually reach
 *   off_road  the nearest road is farther than that: the screen refuses the pin and says why
 *   unknown   no routing server answered in time. The screen lets the person carry on (the service-area check in the database still stands); an outage of a
 *             free public service must not stop every booking
 *
 * The routing data are OpenStreetMap's, so a road missing from the map is "off the road" here until someone adds it there. The database has no road layer, so this
 * guard is the apps'; the water layer of the service area (migration of decision D-P3) is the database's backstop for rivers and the sea.
 */

export type RoadSnapStatus = 'on_road' | 'off_road' | 'unknown';

export interface RoadSnap {
  status: RoadSnapStatus;
  /** the point to use: the road's own point when on_road, the point that was asked about otherwise */
  lat: number;
  lng: number;
  /** metres from the asked point to the nearest road, null when unknown */
  distanceM: number | null;
}

export interface RoadSnapOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxDistanceM?: number;
  baseUrls?: readonly string[];
}

const DEFAULT_TIMEOUT_MS = 2500;
const CACHE_LIMIT = 200;
/** the same place asked again (the map settles, the person taps Confirm) is answered from memory: about 1 m of precision */
const cache = new Map<string, RoadSnap>();

const keyOf = (lat: number, lng: number, maxM: number): string => `${lat.toFixed(5)},${lng.toFixed(5)},${maxM}`;

/** What one /nearest answer says, or null when it is not a usable answer. */
export function readNearest(body: unknown): { lat: number; lng: number; distanceM: number } | null {
  const waypoint = (body as { code?: string; waypoints?: Array<{ location?: unknown; distance?: unknown }> } | null)?.waypoints?.[0];
  if ((body as { code?: string } | null)?.code !== 'Ok' || !waypoint) return null;
  const loc = waypoint.location;
  const distance = Number(waypoint.distance);
  if (!Array.isArray(loc) || loc.length < 2 || !Number.isFinite(Number(loc[0])) || !Number.isFinite(Number(loc[1])) || !Number.isFinite(distance) || distance < 0) return null;
  return { lng: Number(loc[0]), lat: Number(loc[1]), distanceM: distance };
}

export async function snapToRoad(lat: number, lng: number, opts: RoadSnapOptions = {}): Promise<RoadSnap> {
  const maxM = opts.maxDistanceM ?? PIN_ROAD_MAX_DISTANCE_M;
  const asked: RoadSnap = { status: 'unknown', lat, lng, distanceM: null };
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return asked;

  const key = keyOf(lat, lng, maxM);
  const hit = cache.get(key);
  if (hit) return hit;

  const doFetch = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return asked;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // the same two servers, in the same order, as the road distance (policyConfig OSRM_BASE_URLS)
  for (const base of opts.baseUrls ?? OSRM_BASE_URLS) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await doFetch(`${base}/nearest/v1/driving/${lng.toFixed(6)},${lat.toFixed(6)}?number=1`, controller ? { signal: controller.signal } : undefined);
      if (!res.ok) continue;
      const near = readNearest(await res.json());
      if (!near) continue;
      const result: RoadSnap = near.distanceM <= maxM
        ? { status: 'on_road', lat: near.lat, lng: near.lng, distanceM: Math.round(near.distanceM) }
        : { status: 'off_road', lat, lng, distanceM: Math.round(near.distanceM) };
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
      cache.set(key, result);
      return result;
    } catch {
      // this server did not answer in time (or at all): try the next one
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return asked;
}

/** For tests: forget what was answered. */
export const clearRoadSnapCache = (): void => cache.clear();

/** What to tell the person when a pin is not near a road (Tagalog first, as everywhere in the apps). */
export const offRoadMessage = (language: string, distanceM: number | null): string => {
  const far = distanceM !== null && distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1)} km` : distanceM !== null ? `${distanceM} m` : '';
  if (language === 'tl') {
    return `Walang daan na madadaanan ng tricycle malapit sa pin${far ? ` (mga ${far} ang layo ng pinakamalapit na daan)` : ''}. Maaaring ilog, dagat o bukid ito. Ilipat ang pin sa isang kalsada.`;
  }
  return `There is no road a tricycle can use near this pin${far ? ` (the nearest road is about ${far} away)` : ''}. It may be on a river, the sea or a field. Move the pin onto a road.`;
};
