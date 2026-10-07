import { serviceAreaContains, type GeoBoundary, type ServiceAreaShape } from '@sakay/shared';

import { supabase } from './supabaseClient';

// SAKAY serves Calapan City only. A trip must start AND end inside the service area; the database refuses a booking that does not
// (check_booking_service_area_gate, both pickup and destination). This module lets the screens say so BEFORE a route is drawn or a fare
// is shown, using the same active service_area_config row the database uses: the boundary of Calapan City (a polygon), or, for a pilot
// narrowing, a circle. The database decides; if the area cannot be read, the screens let the passenger carry on and the database still
// refuses the booking.

export interface ServiceArea extends ServiceAreaShape {
  name: string;
}

let cached: Promise<ServiceArea | null> | null = null;

/** The active service area, read once per app session (a failed read is retried on the next call). */
export const fetchServiceArea = (): Promise<ServiceArea | null> => {
  if (!cached) {
    cached = Promise.resolve(
      supabase
        .from('service_area_config')
        .select('area_name, center_latitude, center_longitude, radius_km, boundary_geojson')
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
          boundary: (data.boundary_geojson as GeoBoundary | null) ?? null,
        };
      })
      .catch(() => {
        cached = null;
        return null;
      });
  }
  return cached;
};

/** True when the point is OUTSIDE the service area. An unset point (0, 0) or an unknown area is never reported as outside. */
export const isOutsideServiceArea = (area: ServiceArea | null, lat: number, lng: number): boolean => {
  if (!area || !lat || !lng) return false;
  return !serviceAreaContains(area, lat, lng);
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
