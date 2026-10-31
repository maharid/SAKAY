/**
 * Where a vehicle was when a report was filed, as a place a person recognises ("Rizal Street, Barangay Ilaya, Calapan") instead of two numbers.
 * The browser asks OpenStreetMap's public geocoder (reverse lookup); the answer is kept for the session, and a failure is simply "no place": the coordinates stay on screen as the
 * supporting detail. Nothing here is saved or sent to SAKAY.
 */
const cache = new Map<string, string | null>();

const key = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`;

interface ReverseAnswer {
  name?: string;
  display_name?: string;
  address?: Record<string, string | undefined>;
}

/** "Rizal Street, Ilaya, Calapan City": the road (or the named place), the barangay or suburb, the city */
export function placeLabelFromAnswer(answer: ReverseAnswer | null | undefined): string | null {
  if (!answer) return null;
  const a = answer.address ?? {};
  const first = a.amenity || a.shop || a.building || a.road || a.pedestrian || answer.name || '';
  const area = a.suburb || a.neighbourhood || a.village || a.quarter || a.hamlet || '';
  const city = a.city || a.town || a.municipality || a.county || '';
  const parts = [first, area, city].map((p) => String(p || '').trim()).filter((p, i, all) => p && all.indexOf(p) === i);
  if (parts.length > 0) return parts.join(', ');
  const display = String(answer.display_name || '').split(',').slice(0, 3).map((p) => p.trim()).filter(Boolean);
  return display.length > 0 ? display.join(', ') : null;
}

export async function describeIncidentPlace(lat: number, lng: number, signal?: AbortSignal): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const k = key(lat, lng);
  if (cache.has(k)) return cache.get(k) ?? null;
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${lat}&lon=${lng}`, { signal, headers: { 'Accept-Language': 'en,fil' } });
    if (!response.ok) return null;
    const label = placeLabelFromAnswer((await response.json()) as ReverseAnswer);
    cache.set(k, label);
    return label;
  } catch {
    return null;
  }
}
