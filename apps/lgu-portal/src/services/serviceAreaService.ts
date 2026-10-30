import type { GeoBoundary, ServiceAreaShape } from '@sakay/shared';

import { supabase } from './supabaseClient';

// The active service area (Calapan City's boundary, or a pilot circle) as the database holds it, for the screens that place a pin: a TODA's terminal must lie inside the
// city and, like every pin (panel comment, decision D-P3), on a road. The same row, and the same point-in-polygon test, as the Passenger app and the database use.

let cached: Promise<ServiceAreaShape | null> | null = null;

/** The active service area, read once per portal session (a failed read is retried on the next call; null means "could not be read": the pin is then not refused for it). */
export const fetchServiceArea = (): Promise<ServiceAreaShape | null> => {
  if (!cached) {
    cached = Promise.all([
      Promise.resolve(
        supabase
          .from('service_area_config')
          .select('center_latitude, center_longitude, radius_km, boundary_geojson')
          .eq('is_active', true)
          .limit(1)
          .maybeSingle()
      ),
      // the sea is not part of the service area (D-P3); if this cannot be read the pin is simply not refused for it here: the database still refuses it
      Promise.resolve(supabase.from('service_area_water').select('geojson').eq('water_id', 1).maybeSingle()).catch(() => ({ data: null, error: true })),
    ])
      .then(([{ data, error }, water]) => {
        if (error || !data) {
          cached = null;
          return null;
        }
        return {
          centerLat: Number(data.center_latitude),
          centerLng: Number(data.center_longitude),
          radiusKm: Number(data.radius_km),
          boundary: (data.boundary_geojson as GeoBoundary | null) ?? null,
          waterExclusion: ((water as { data?: { geojson?: GeoBoundary } | null }).data?.geojson as GeoBoundary | undefined) ?? null,
        };
      })
      .catch(() => {
        cached = null;
        return null;
      });
  }
  return cached;
};
