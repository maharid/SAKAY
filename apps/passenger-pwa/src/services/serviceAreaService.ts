import { supabase } from './supabaseClient';

// SAKAY serves Calapan City only. A trip must start AND end inside the service area; the database refuses a booking that does not
// (check_booking_service_area_gate, both pickup and destination). This module lets the screens say so BEFORE a route is drawn or a fare
// is shown, using the same active service_area_config row the database uses. It decides nothing: if the area cannot be read, the screens
// let the passenger carry on and the database still refuses the booking.

export interface ServiceArea {
  name: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
}

let cached: Promise<ServiceArea | null> | null = null;

/** The active service area, read once per app session (a failed read is retried on the next call). */
export const fetchServiceArea = (): Promise<ServiceArea | null> => {
  if (!cached) {
    cached = Promise.resolve(
      supabase
        .from('service_area_config')
        .select('area_name, center_latitude, center_longitude, radius_km')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()
    )
      .then(({ data, error }) => {
        if (error || !data) {
          cached = null;
          return null;
        }
        return {
          name: String(data.area_name),
          centerLat: Number(data.center_latitude),
          centerLng: Number(data.center_longitude),
          radiusKm: Number(data.radius_km),
        };
      })
      .catch(() => {
        cached = null;
        return null;
      });
  }
  return cached;
};

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance, the same formula the database gate uses (the app's flat-earth distance helpers are not exact enough at the border). */
const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/** True when the point is inside the service area. An unset point (0, 0) or an unknown area is never reported as outside. */
export const isOutsideServiceArea = (area: ServiceArea | null, lat: number, lng: number): boolean => {
  if (!area || !lat || !lng) return false;
  return haversineKm(area.centerLat, area.centerLng, lat, lng) > area.radiusKm;
};

export type TripEnd = 'pickup' | 'destination';

/** What to tell the passenger when an end of the trip is outside the service area (Tagalog first, as everywhere in the app). */
export const outsideServiceAreaMessage = (language: string, end: TripEnd): string => {
  if (language === 'tl') {
    return end === 'destination'
      ? 'Nasa labas ng Calapan City ang destinasyong ito. Sa loob lamang ng Calapan City naglilingkod ang SAKAY. Pumili ng destinasyon sa loob ng lungsod.'
      : 'Nasa labas ng Calapan City ang pickup location na ito. Sa loob lamang ng Calapan City naglilingkod ang SAKAY. Pumili ng pickup sa loob ng lungsod.';
  }
  return end === 'destination'
    ? 'This destination is outside Calapan City. SAKAY serves Calapan City only. Please choose a destination inside the city.'
    : 'This pickup location is outside Calapan City. SAKAY serves Calapan City only. Please choose a pickup inside the city.';
};
