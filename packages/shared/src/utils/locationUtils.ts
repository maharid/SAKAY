import { OSRM_BASE_URLS } from '../config/policyConfig';

/**
 * Calculates planar coordinate distance in kilometers (standard equirectangular projection)
 */
export const calculateDistanceKm = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const latDiff = (lat2 - lat1) * 110.574;
  const lonDiff = (lon2 - lon1) * 108.29;
  return Math.round(Math.sqrt(latDiff * latDiff + lonDiff * lonDiff) * 100) / 100;
};

/**
 * Backward compatibility alias for distance calculation
 */
export const calculateHaversineKm = calculateDistanceKm;

/**
 * Calculates straight-line distance in kilometers between two GPS coordinates
 */
export const getDistanceKm = calculateDistanceKm;

/**
 * Formats distance into a human-friendly string (e.g. "450 m" or "2.3 km"). The number and its unit are joined with a no-break space
 * so a label never wraps into "2.3" on one line and "km" on the next.
 */
export const formatDistance = (km: number): string => {
  if (km < 1) {
    return `${Math.round(km * 1000)}\u00A0m`;
  }
  return `${km.toFixed(1)}\u00A0km`;
};

export interface RouteResult {
  distanceKm: number;
  durationMin: number;
  coordinates: [number, number][]; // [lat, lng]
  source: 'osrm' | 'road_estimate';
}

/** How long one routing server may take before it is given up on (a public server that hangs used to hold the road line back for as long as the browser waited) */
const ROUTE_REQUEST_TIMEOUT_MS = 6000;
/** The second server is asked this long after the first, if the first has not answered yet (the first answer wins; most of the time only one request is made) */
const ROUTE_HEDGE_DELAY_MS = 1200;
/** A road does not move: an answer is kept this long, so the same trip (or the same driver position) is not asked for twice */
const ROUTE_CACHE_TTL_MS = 10 * 60 * 1000;
const ROUTE_CACHE_MAX = 60;

const routeCache = new Map<string, { at: number; result: RouteResult }>();
const routeInFlight = new Map<string, Promise<RouteResult>>();

// Positions are compared to about 11 m (4 decimals): a driver who has not really moved gets the answer already held
const routeKey = (aLat: number, aLng: number, bLat: number, bLng: number) => `${aLat.toFixed(4)},${aLng.toFixed(4)};${bLat.toFixed(4)},${bLng.toFixed(4)}`;

async function fetchRouteFrom(url: string): Promise<RouteResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ROUTE_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`routing server answered ${res.status}`);
    const data = await res.json();
    if (!data.routes || data.routes.length === 0) throw new Error('no route');
    const route = data.routes[0];
    return {
      distanceKm: Math.round((route.distance / 1000) * 100) / 100,
      durationMin: Math.max(1, Math.round(route.duration / 60)),
      coordinates: route.geometry.coordinates.map((c: [number, number]) => [c[1], c[0]] as [number, number]),
      source: 'osrm',
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The first server that answers wins. The next server is asked only when the one before it fails, or has not answered after ROUTE_HEDGE_DELAY_MS. */
function firstRouteAnswer(urls: string[]): Promise<RouteResult> {
  return new Promise<RouteResult>((resolve, reject) => {
    let settled = false;
    let failed = 0;
    let started = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = () => timers.forEach((t) => clearTimeout(t));
    const startNext = () => {
      if (settled || started >= urls.length) return;
      const url = urls[started++];
      if (started < urls.length) timers.push(setTimeout(startNext, ROUTE_HEDGE_DELAY_MS));
      fetchRouteFrom(url).then(
        (result) => {
          if (settled) return;
          settled = true;
          finish();
          resolve(result);
        },
        (err) => {
          console.warn(`[getOSRMRoute] Endpoint request issue: ${url}`, err);
          failed += 1;
          if (settled) return;
          if (failed >= urls.length) {
            settled = true;
            finish();
            reject(new Error('every routing server failed'));
          } else {
            startNext(); // do not wait for the hedge timer when a server has already failed
          }
        },
      );
    };
    startNext();
  });
}

/**
 * Queries OSRM road network for accurate driving distance, duration & road geometry coordinates.
 * The road line is the slowest thing on a trip map to appear, so: an answer already held is returned at once, the same question asked twice at
 * the same time shares one request, a server that hangs is given up on after a few seconds, and the next server is asked while the first is
 * still thinking (the first answer wins). A straight "road estimate" is returned (and never kept) only when every server failed.
 */
export const getOSRMRoute = async (
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number
): Promise<RouteResult> => {
  const key = routeKey(pickupLat, pickupLng, dropoffLat, dropoffLng);
  const held = routeCache.get(key);
  if (held && Date.now() - held.at < ROUTE_CACHE_TTL_MS) return held.result;
  const running = routeInFlight.get(key);
  if (running) return running;

  // The same two servers, in the same order, as the database's own ETA request (policyConfig OSRM_BASE_URLS, mirrored in _osrm_base_url()).
  const endpoints = OSRM_BASE_URLS.map(
    (base) => `${base}/route/v1/driving/${pickupLng},${pickupLat};${dropoffLng},${dropoffLat}?overview=full&geometries=geojson`
  );

  const request = firstRouteAnswer(endpoints)
    .then((result) => {
      routeCache.set(key, { at: Date.now(), result });
      if (routeCache.size > ROUTE_CACHE_MAX) {
        const oldest = routeCache.keys().next().value;
        if (oldest !== undefined) routeCache.delete(oldest);
      }
      return result;
    })
    .catch((): RouteResult => {
      // Fallback if public road routing servers are unreachable
      const straightKm = calculateDistanceKm(pickupLat, pickupLng, dropoffLat, dropoffLng);
      const estimatedKm = Math.round(straightKm * 1.3 * 100) / 100;
      const estimatedMin = Math.max(1, Math.round((estimatedKm / 20) * 60));
      return {
        distanceKm: estimatedKm,
        durationMin: estimatedMin,
        coordinates: [
          [pickupLat, pickupLng],
          [dropoffLat, dropoffLng],
        ],
        source: 'road_estimate',
      };
    })
    .finally(() => {
      routeInFlight.delete(key);
    });
  routeInFlight.set(key, request);
  return request;
};

export interface LocationCoords {
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp?: number;
  /** Direction of travel in degrees clockwise from north, only while the device is moving (null / absent otherwise) */
  heading?: number | null;
  /** Speed in metres per second, when the device knows it */
  speed?: number | null;
}

/** The numeric fields of a browser position as LocationCoords. Heading and speed are NaN or null at a standstill: they become null, never a number. */
export const coordsFromPosition = (position: GeolocationPosition): LocationCoords => {
  const num = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    timestamp: position.timestamp,
    heading: num(position.coords.heading),
    speed: num(position.coords.speed),
  };
};

/**
 * Does the app need to ask the phone for a NEW position? True when there is none, or the last one is older than `maxAgeMs`.
 * A location watcher reports CHANGES: a phone that is standing still (a driver waiting at the pickup) can go minutes without one, so the last
 * fix ages past the limit the server accepts and the position the server holds goes stale although nobody moved.
 */
export const needsFreshFix = (coords: LocationCoords | null, maxAgeMs: number, now: number = Date.now()): boolean => {
  if (!coords) return true;
  if (typeof coords.timestamp !== "number") return false;
  return now - coords.timestamp > maxAgeMs;
};

/**
 * Retrieves cached device position from localStorage if available
 */
export const getCachedDevicePosition = (): LocationCoords | null => {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const lat = localStorage.getItem("user_lat");
    const lng = localStorage.getItem("user_lng");
    if (lat && lng) {
      const parsedLat = parseFloat(lat);
      const parsedLng = parseFloat(lng);
      if (!isNaN(parsedLat) && !isNaN(parsedLng) && parsedLat !== 0 && parsedLng !== 0) {
        return { latitude: parsedLat, longitude: parsedLng };
      }
    }
  } catch {
    // ignore
  }
  return null;
};

/**
 * Requests real device location with high-accuracy first and fast low-accuracy (network/Wi-Fi) fallback
 */
export const getCurrentDevicePosition = (): Promise<LocationCoords> => {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation is not supported by this browser/device."));
      return;
    }

    const saveSuccess = (position: GeolocationPosition) => {
      const coords: LocationCoords = coordsFromPosition(position);

      try {
        localStorage.setItem("user_lat", coords.latitude.toString());
        localStorage.setItem("user_lng", coords.longitude.toString());
        localStorage.setItem("gps_permission", "true");
        localStorage.setItem("sakay_driver_location_permission", "always");
      } catch {}

      resolve(coords);
    };

    const tryLowAccuracy = () => {
      navigator.geolocation.getCurrentPosition(
        saveSuccess,
        (error) => {
          let message = "An error occurred retrieving location.";
          if (error.code === error.PERMISSION_DENIED) {
            message = "Location permission denied by user.";
          } else if (error.code === error.POSITION_UNAVAILABLE) {
            message = "Location information is unavailable.";
          } else if (error.code === error.TIMEOUT) {
            message = "Location request timed out.";
          }
          reject(Object.assign(new Error(message), { code: error.code }));
        },
        {
          enableHighAccuracy: false,
          timeout: 8000,
          maximumAge: 60000,
        }
      );
    };

    // Try high accuracy first (e.g. mobile GPS), fallback quickly to low accuracy (Wi-Fi/cellular/network)
    navigator.geolocation.getCurrentPosition(
      saveSuccess,
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          reject(Object.assign(new Error("Location permission denied by user."), { code: error.code }));
          return;
        }
        tryLowAccuracy();
      },
      {
        enableHighAccuracy: true,
        timeout: 4000,
        maximumAge: 10000,
      }
    );
  });
};

/**
 * Watches real device position with continuous updates
 */
export const watchDevicePosition = (
  onCoords: (coords: LocationCoords) => void,
  onError?: (err: Error & { code?: number }) => void,
  options: PositionOptions = { enableHighAccuracy: false, timeout: 15000, maximumAge: 5000 }
): number | null => {
  if (typeof window === "undefined" || !navigator.geolocation) return null;

  return navigator.geolocation.watchPosition(
    (pos) => {
      const coords: LocationCoords = coordsFromPosition(pos);
      try {
        localStorage.setItem("user_lat", coords.latitude.toString());
        localStorage.setItem("user_lng", coords.longitude.toString());
      } catch {}
      onCoords(coords);
    },
    (err) => {
      // Keep the browser's error code (1 = permission denied) so callers can tell it apart.
      if (onError) onError(Object.assign(new Error(err.message), { code: err.code }));
    },
    options
  );
};
