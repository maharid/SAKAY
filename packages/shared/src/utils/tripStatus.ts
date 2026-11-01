/**
 * How a trip's status is worded and coloured on the Passenger and the Driver app, in one place. Nothing here decides a status: the database does; this only words it.
 */

export type StatusLang = 'en' | 'tl';

/** The status in the person's language. Only the statuses of a finished trip are translated; any other is shown as the database wrote it. */
export function tripStatusLabel(status: string | undefined | null, lang: StatusLang): string {
  if (status === 'Completed') return lang === 'tl' ? 'Nakumpleto' : 'Completed';
  if (status === 'Cancelled') return lang === 'tl' ? 'Kinansela' : 'Cancelled';
  return status ?? '';
}

/** Green only for a completed trip, red for a cancelled one, neutral for anything else (white text keeps 4.5:1 contrast on all three). */
export function tripStatusColors(status: string | undefined | null): { background: string; color: string } {
  return { background: status === 'Completed' ? '#15803D' : status === 'Cancelled' ? '#B91C1C' : '#475569', color: '#FFFFFF' };
}

/** "4.2 km": the distance a trip record holds, with its unit and one decimal; null when it holds none (zero, missing or unreadable): a distance is never worked out or guessed here. */
export function formatTripDistance(distanceKm: number | null | undefined): string | null {
  const km = typeof distanceKm === 'number' ? distanceKm : NaN;
  return Number.isFinite(km) && km > 0 ? `${km.toFixed(1)} km` : null;
}

const MANILA = 'Asia/Manila';

/** "10 Oct 2025, 8:22 AM" in Philippine time; a record without a timestamp falls back to the date and time it was stored with, never to an invented one. */
export function formatTripWhen(trip: { createdAt?: string | null; dateString?: string | null; time?: string | null }): string {
  const t = trip.createdAt ? Date.parse(trip.createdAt) : NaN;
  if (Number.isFinite(t)) {
    const d = new Date(t);
    const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: MANILA });
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: MANILA });
    return `${day}, ${time}`;
  }
  return [trip.dateString, trip.time].filter(Boolean).join(', ');
}
