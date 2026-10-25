import { DRIVER_CANCEL_REASONS } from '../config/policyConfig';
import type { DriverCancelReason } from '../config/policyConfig';
import { cleanBilingualText } from './notificationLocalization';

/**
 * The reasons a person can pick when cancelling a booking, in both languages: the Passenger and Driver apps' cancel screens read their choices from here, and the
 * OTHER party's screen reads the same tables to show the reason in ITS language (the passenger's cancel reason is saved as the words the passenger read, in the
 * passenger's language; the driver's is saved as a code).
 */
export type CancelReasonLanguage = 'tl' | 'en';

export const DRIVER_CANCEL_LABELS: Record<DriverCancelReason, { tl: string; en: string }> = {
  vehicle_breakdown: { tl: 'Nasiraan ng sasakyan', en: 'Vehicle breakdown / technical issue' },
  personal_emergency: { tl: 'Dahilang pangkagipitan', en: 'Personal emergency' },
  passenger_unreachable: { tl: 'Hindi maabot ang pasahero', en: 'Passenger unreachable' },
  wrong_pickup_location: { tl: 'Mali o hindi maabot ang pickup', en: 'Wrong or unreachable pickup location' },
  safety_concern: { tl: 'Alalahanin sa kaligtasan', en: 'Safety concern' },
  road_closure_or_traffic: { tl: 'Sarado ang daan / sakuna (bagyo, baha)', en: 'Road closed / calamity (typhoon, flood)' },
  accident: { tl: 'Aksidente', en: 'Accident' },
  unsafe_or_illegal_request: { tl: 'Hiniling ng pasahero ang mapanganib o ilegal', en: 'Passenger asked for something unsafe or illegal' },
  prohibited_item: { tl: 'Bawal o sobrang laking bagahe', en: 'Prohibited or oversized baggage' },
  other: { tl: 'Iba pa', en: 'Other reason' },
};

export interface PassengerCancelOption {
  id: string;
  tl: string;
  en: string;
}

export const PASSENGER_CANCEL_OPTIONS: PassengerCancelOption[] = [
  { id: 'driver_delayed', tl: 'Matagal dumating ang driver', en: 'Driver is taking too long' },
  { id: 'no_longer_needed', tl: 'Hindi ko na kailangan ang biyahe', en: 'I no longer need the ride' },
  { id: 'wrong_location', tl: 'Nagkamali ako ng pickup o destination', en: 'Wrong pickup or destination' },
  { id: 'found_another_ride', tl: 'May ibang nasakyan na ako', en: 'Found another ride' },
  { id: 'other', tl: 'Iba pa', en: 'Other reason' },
];

/** What the cancel screens store when no choice could be found: these say nothing, so they are never shown as a reason. */
const PLACEHOLDER_REASONS = new Set(['cancelled by user', 'cancelled by passenger', 'cancelled by driver']);

const KNOWN_TEXTS: Array<{ tl: string; en: string }> = [
  ...Object.values(DRIVER_CANCEL_LABELS),
  ...PASSENGER_CANCEL_OPTIONS.map(({ tl, en }) => ({ tl, en })),
];

const isDriverReasonCode = (code: string): code is DriverCancelReason => (DRIVER_CANCEL_REASONS as readonly string[]).includes(code);

/**
 * The reason of a cancellation as the person looking at it should read it: a driver's reason code or a known reason text (either language) becomes the
 * text in `language`; a bilingual "Tagalog (English)" text keeps only the part in `language`; any other text (a note, a system message) is shown as it
 * is. Returns '' when there is no real reason (nothing saved, a placeholder, or the no-show marker, which has its own wording), so a screen shows a
 * reason only when there is one.
 */
export function localizeCancellationReason(raw: string | null | undefined, language: CancelReasonLanguage): string {
  const text = (raw ?? '').trim();
  if (!text) return '';
  if (PLACEHOLDER_REASONS.has(text.toLowerCase()) || text === 'PASSENGER_NO_SHOW') return '';

  // "<code>" or "<code>: a note": what the database keeps of a driver's cancellation
  const separator = text.indexOf(':');
  const code = (separator === -1 ? text : text.slice(0, separator)).trim();
  if (isDriverReasonCode(code)) {
    const label = DRIVER_CANCEL_LABELS[code][language];
    const note = separator === -1 ? '' : text.slice(separator + 1).trim();
    return note ? `${label}: ${note}` : label;
  }

  const lower = text.toLowerCase();
  const known = KNOWN_TEXTS.find((entry) => entry.tl.toLowerCase() === lower || entry.en.toLowerCase() === lower);
  if (known) return known[language];

  return cleanBilingualText(text, language);
}
