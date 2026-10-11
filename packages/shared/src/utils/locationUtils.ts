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

/**
 * Queries OSRM road network for accurate driving distance, duration & road geometry coordinates
 */
export const getOSRMRoute = async (
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number
): Promise<RouteResult> => {
  const endpoints = [
    `https://router.project-osrm.org/route/v1/driving/${pickupLng},${pickupLat};${dropoffLng},${dropoffLat}?overview=full&geometries=geojson`,
    `https://routing.openstreetmap.de/routed-car/route/v1/driving/${pickupLng},${pickupLat};${dropoffLng},${dropoffLat}?overview=full&geometries=geojson`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;

      const data = await res.json();
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const distanceKm = Math.round((route.distance / 1000) * 100) / 100;
        const durationMin = Math.max(1, Math.round(route.duration / 60));
        const coordinates: [number, number][] = route.geometry.coordinates.map(
          (c: [number, number]) => [c[1], c[0]]
        );

        return {
          distanceKm,
          durationMin,
          coordinates,
          source: 'osrm',
        };
      }
    } catch (err) {
      console.warn(`[getOSRMRoute] Endpoint request issue: ${url}`, err);
    }
  }

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
