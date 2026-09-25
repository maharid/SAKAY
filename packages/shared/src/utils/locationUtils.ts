/**
 * Calculates Haversine distance in kilometers between two GPS coordinates
 */
export const calculateHaversineKm = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
};

/**
 * Formats distance into a human-friendly string (e.g. "450 m" or "2.3 km")
 */
export const formatDistance = (km: number): string => {
  if (km < 1) {
    return `${Math.round(km * 1000)} m`;
  }
  return `${km.toFixed(1)} km`;
};

export interface RouteResult {
  distanceKm: number;
  durationMin: number;
  coordinates: [number, number][]; // [lat, lng]
  source: 'osrm' | 'haversine';
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
  const straightKm = calculateHaversineKm(pickupLat, pickupLng, dropoffLat, dropoffLng);
  const estimatedKm = Math.round(straightKm * 1.3 * 100) / 100;
  const estimatedMin = Math.max(1, Math.round((estimatedKm / 20) * 60));

  return {
    distanceKm: estimatedKm,
    durationMin: estimatedMin,
    coordinates: [
      [pickupLat, pickupLng],
      [dropoffLat, dropoffLng],
    ],
    source: 'haversine',
  };
};
