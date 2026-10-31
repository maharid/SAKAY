/**
 * Searching a place by name for the terminal pin picker (OpenStreetMap's public geocoder, limited to the box around Calapan City).
 * A result only MOVES THE PIN when the person chooses it; the pin is then judged like any other (inside the city, on a road) and can still be dragged.
 * Nothing here is saved or sent to SAKAY: the browser asks the geocoder directly, and a failure is simply "no results".
 */
export interface PlaceResult {
  /** A short name: "Calapan Public Market" */
  name: string;
  /** The rest of the address, to tell two places of the same name apart */
  detail: string;
  lat: number;
  lng: number;
}

// west, north, east, south around Calapan City (the geocoder is asked not to look beyond it)
const CALAPAN_VIEWBOX = '121.05,13.50,121.30,13.33';

export async function searchCalapanPlaces(query: string, signal?: AbortSignal): Promise<PlaceResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  try {
    const url =
      'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=0&limit=6&countrycodes=ph' +
      `&viewbox=${CALAPAN_VIEWBOX}&bounded=1&q=${encodeURIComponent(q)}`;
    const response = await fetch(url, { signal, headers: { 'Accept-Language': 'en,fil' } });
    if (!response.ok) return [];
    const rows = (await response.json()) as Array<{ lat?: string; lon?: string; name?: string; display_name?: string }>;
    return rows
      .map((row) => {
        const lat = Number(row.lat);
        const lng = Number(row.lon);
        const full = String(row.display_name || '').trim();
        const name = String(row.name || full.split(',')[0] || '').trim();
        const detail = full.split(',').slice(1, 4).join(',').trim();
        return { name, detail, lat, lng };
      })
      .filter((p) => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  } catch {
    return [];
  }
}
