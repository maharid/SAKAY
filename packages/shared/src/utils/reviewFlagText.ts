import { INCIDENT_LOST_ITEM_UNCLAIMED_DAYS, SAFE_REASON_FLAG_COUNT, SAFE_REASON_FLAG_WINDOW_DAYS } from '../config/policyConfig';

// The words of the review flags (admin_review_flag): a short label for the list, the full sentence for the details window, and the one-line summary under the label.
// Nothing here decides anything; it only says what the database recorded.

/** One event of a flag that lists several (a trip stopped or cancelled for a reason that is not struck) */
export interface FlagEvent {
  booking_id: string;
  reason: string;
  at: string;
}

/** The full sentence of each flag type: what the system noticed (shown in the details window) */
export const FLAG_TITLES: Record<string, string> = {
  DRIVER_SAFE_REASON_REVIEW: 'A driver cancelled or stopped for a reason that is not struck (verify it)',
  DRIVER_SAFE_REASON_PATTERN: `A driver used such reasons ${SAFE_REASON_FLAG_COUNT} times in ${SAFE_REASON_FLAG_WINDOW_DAYS} days`,
  DRIVER_EARLY_STOP_REVIEW: 'A driver ended a trip before the destination',
  DRIVER_DETENTION_TODA_REVIEW: 'A driver was detained or arrested during a trip: the TODA review',
  DRIVER_DETENTION_LGU_REVIEW: 'A driver was detained or arrested during a trip: the LGU review',
  DRIVER_INCAPACITATED_REVIEW: 'A driver became ill during a trip',
  LOST_ITEM_UNCLAIMED_REVIEW: `A lost-item report has had no response for ${INCIDENT_LOST_ITEM_UNCLAIMED_DAYS} days`,
  DRIVER_CHANGE_REFUSAL_PATTERN: 'Repeated complaints that a driver refused to give change',
  DRIVER_INACTIVITY_REVIEW: 'A driver was put Offline for inactivity several times in 30 days: review, no strike',
  DRIVER_REPEATED_CANCELLATIONS: 'A driver cancelled several accepted bookings',
  DRIVER_SHARED_REQUEST_DECLINES: 'A driver declined several Shared Trip requests',
  PAYMENT_STUCK_RECONCILIATION: 'A trip is waiting at the destination for the payment (PI-15)',
  DRIVER_REPEATED_DECLINES: 'A driver declined several booking offers while Online: weigh the reasons before anything is confirmed',
  DRIVER_QUEUE_CONFLICT_REPORT: 'A driver was reported queued at the terminal while Available in the app',
  DRIVER_AVAILABILITY_VIOLATION_REPORT: 'A driver was reported accepting a booking while carrying other passengers',
  TRIP_MANUAL_RECONCILIATION: 'A trip has been silent for 30 minutes',
  DRIVER_LOW_RATING_REVIEW: "A driver's average rating is under 3.00 after at least 20 completed trips: review, counselling or retraining",
};

/** The short label of each flag type, for the list (the full sentence is in the details window) */
const SHORT_TITLES: Record<string, string> = {
  DRIVER_SAFE_REASON_REVIEW: 'Cancelled or stopped for a safe reason',
  DRIVER_SAFE_REASON_PATTERN: 'Safe reasons used repeatedly',
  DRIVER_EARLY_STOP_REVIEW: 'Trip ended before the destination',
  DRIVER_DETENTION_TODA_REVIEW: 'Driver detained during a trip (TODA review)',
  DRIVER_DETENTION_LGU_REVIEW: 'Driver detained during a trip (LGU review)',
  DRIVER_INCAPACITATED_REVIEW: 'Driver became ill during a trip',
  LOST_ITEM_UNCLAIMED_REVIEW: 'Lost-item report unanswered',
  DRIVER_CHANGE_REFUSAL_PATTERN: 'Repeated change-refusal complaints',
  DRIVER_INACTIVITY_REVIEW: 'Put Offline for inactivity several times',
  DRIVER_REPEATED_CANCELLATIONS: 'Several accepted bookings cancelled',
  DRIVER_SHARED_REQUEST_DECLINES: 'Several Shared Trip requests declined',
  PAYMENT_STUCK_RECONCILIATION: 'Trip waiting for the payment',
  DRIVER_REPEATED_DECLINES: 'Several booking offers declined',
  DRIVER_QUEUE_CONFLICT_REPORT: 'Queued at the terminal while Available',
  DRIVER_AVAILABILITY_VIOLATION_REPORT: 'Accepted a booking while carrying passengers',
  TRIP_MANUAL_RECONCILIATION: 'Trip silent for 30 minutes',
  DRIVER_LOW_RATING_REVIEW: 'Low average rating',
};

/** DRIVER_EARLY_STOP_REVIEW -> "Driver early stop review" */
export const humanizeCode = (code: string): string => {
  const words = code.replace(/_/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const shortFlagTitle = (flagType: string): string => SHORT_TITLES[flagType] ?? humanizeCode(flagType);

const parse = (iso: unknown): number => (typeof iso === 'string' ? Date.parse(iso) : NaN);

/** "Oct 26, 12:38 AM" in Manila time, or "-" when the date is missing */
export const manilaShort = (iso: unknown): string => {
  const ms = parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-';
};

/** "Oct 26, 2026, 12:38 AM" in Manila time, or "-" when the date is missing */
export const manilaFull = (iso: unknown): string => {
  const ms = parse(iso);
  return Number.isFinite(ms)
    ? new Date(ms).toLocaleString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '-';
};

/** The eight characters a trip is known by on screen */
export const shortId = (id: unknown): string => String(id).slice(0, 8).toUpperCase();

/** The events a flag lists (only the entries that are well formed) */
export const flagEvents = (details: Record<string, unknown>): FlagEvent[] =>
  Array.isArray(details.events) ? (details.events as FlagEvent[]).filter((e) => e && typeof e === 'object' && typeof e.booking_id === 'string') : [];

/** "5 declines in 24 hours: no response 3, too far 2." (the sentence the flag has always shown), or null when the flag has no such figures */
export const declinesSentence = (details: Record<string, unknown>): string | null => {
  if (typeof details.declines_in_window !== 'number') return null;
  const reasons =
    details.reasons && typeof details.reasons === 'object'
      ? ': ' + Object.entries(details.reasons as Record<string, number>).map(([k, n]) => `${k.replace(/_/g, ' ')} ${n}`).join(', ')
      : '';
  return `${details.declines_in_window} declines in ${String(details.window_hours)} hours${reasons}.`;
};

export const eventsInWindowSentence = (details: Record<string, unknown>): string | null =>
  typeof details.events_in_window === 'number' ? `${details.events_in_window} events in ${String(details.window_days)} days.` : null;

/** The one line under the label in the list: the figure that matters most, or null when the flag has none */
export const flagSummary = (details: Record<string, unknown>): string | null => {
  const events = flagEvents(details);
  if (events.length === 1) return `Reason: ${String(events[0].reason).replace(/_/g, ' ')}`;
  if (events.length > 1) return `${events.length} events`;
  if (typeof details.declines_in_window === 'number') return `${details.declines_in_window} declines in ${String(details.window_hours)} hours`;
  if (typeof details.events_in_window === 'number') return `${details.events_in_window} events in ${String(details.window_days)} days`;
  return null;
};
