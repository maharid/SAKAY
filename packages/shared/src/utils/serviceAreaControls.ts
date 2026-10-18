/**
 * Rule 17.5 / PI-01: the service area is where a booking may start and end. It is the whole of Calapan City by its boundary; the LGU Administrator may narrow it to
 * a pilot area around one TODA's terminal (set_pilot_service_area) and put it back to the whole city (use_city_service_area). Every new booking's pickup AND destination
 * must be inside, so a change decides who can book: it is the LGU Administrator's only, and audited. The DATABASE decides who may and keeps the one active area; this is
 * the call arguments, the check of the radius (same limits as the function) and the reading of the configured areas for the screen
 * (scripts/db-tests/batch1/service-area-controls-client-contract.js runs it against the database).
 */

/** a pilot area is a circle around a terminal: from a few blocks to a district */
export const PILOT_RADIUS_MIN_KM = 0.5;
export const PILOT_RADIUS_MAX_KM = 15;

export const pilotAreaArgs = (todaId: string, radiusKm: number) => ({ p_toda_id: todaId, p_radius_km: radiusKm });

/** Why a pilot area cannot be set yet, or null (the database checks again). */
export function pilotAreaProblem(todaId: string | null, radiusKm: number | null): string | null {
  if (!todaId) return 'Choose the TODA whose terminal is the centre of the pilot area.';
  if (radiusKm === null || !Number.isFinite(radiusKm) || radiusKm < PILOT_RADIUS_MIN_KM || radiusKm > PILOT_RADIUS_MAX_KM) {
    return `The radius must be from ${PILOT_RADIUS_MIN_KM} to ${PILOT_RADIUS_MAX_KM} km.`;
  }
  return null;
}

export interface ServiceAreaRecord {
  configId: string;
  name: string;
  /** the whole city by its boundary (a polygon) rather than a circle */
  isWholeCity: boolean;
  radiusKm: number;
  active: boolean;
  notes: string | null;
  updatedAt: string;
}

/** The rows of service_area_config, the active one first. */
export function mapServiceAreas(rows: Array<Record<string, unknown>>): ServiceAreaRecord[] {
  return rows
    .map((r) => ({
      configId: String(r.config_id),
      name: String(r.area_name),
      isWholeCity: r.boundary_geojson !== null && r.boundary_geojson !== undefined,
      radiusKm: Number(r.radius_km),
      active: Boolean(r.is_active),
      notes: r.notes ? String(r.notes) : null,
      updatedAt: String(r.updated_at),
    }))
    .sort((a, b) => Number(b.active) - Number(a.active) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
