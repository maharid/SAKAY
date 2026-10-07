// The service area (SAKAY serves Calapan City only) as the apps see it. The database is the authority (check_booking_service_area_gate uses
// service_area_contains); these functions repeat its logic exactly so a screen can refuse a place the moment it is chosen. They are pure: no
// network, no storage. scripts/db-tests/batch1/service-area-gate.js runs both over the same grid of points and requires identical answers.

/** [longitude, latitude] pairs, first = last */
export type GeoRing = number[][];
export interface GeoPolygon {
  type: 'Polygon';
  /** The outer ring first, then any holes */
  coordinates: GeoRing[];
}
export interface GeoMultiPolygon {
  type: 'MultiPolygon';
  coordinates: GeoRing[][];
}
export type GeoBoundary = GeoPolygon | GeoMultiPolygon;

/** One row of service_area_config. With a boundary it IS the area (centre / radius are then only a cheap first test); without one it is the circle. */
export interface ServiceAreaShape {
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  boundary: GeoBoundary | null;
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in km: the same formula as the database's calculate_haversine_distance_km (the flat-earth helpers are not exact enough at a border). */
export const greatCircleKm = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/** True when the point is inside one ring (ray casting; a point exactly on an edge may go either way). Same arithmetic, in the same order, as the database. */
export const ringContainsPoint = (ring: GeoRing, lat: number, lng: number): boolean => {
  const n = ring ? ring.length : 0;
  if (n < 3) return false;
  let inside = false;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    j = i;
  }
  return inside;
};

const polygonContainsPoint = (rings: GeoRing[], lat: number, lng: number): boolean => {
  if (!rings.length || !ringContainsPoint(rings[0], lat, lng)) return false;
  for (let h = 1; h < rings.length; h++) {
    if (ringContainsPoint(rings[h], lat, lng)) return false;     // inside a hole
  }
  return true;
};

/** True when the point is inside a GeoJSON Polygon (holes honoured) or any part of a MultiPolygon. */
export const boundaryContainsPoint = (boundary: GeoBoundary, lat: number, lng: number): boolean => {
  if (boundary.type === 'Polygon') return polygonContainsPoint(boundary.coordinates, lat, lng);
  if (boundary.type === 'MultiPolygon') return boundary.coordinates.some((rings) => polygonContainsPoint(rings, lat, lng));
  return false;
};

/** Is this point inside the service area? Mirrors service_area_contains(): the cheap distance test first, then the boundary (or, for a circle row, nothing more). */
export const serviceAreaContains = (area: ServiceAreaShape, lat: number, lng: number): boolean => {
  if (greatCircleKm(area.centerLat, area.centerLng, lat, lng) > area.radiusKm) return false;
  if (!area.boundary) return true;
  return boundaryContainsPoint(area.boundary, lat, lng);
};
