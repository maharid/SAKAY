/**
 * Safety during a trip and in a calamity (Sections 15, 26; Rules 29.6, 29.20 - 29.22; migration 20261026000001): the Urgent Safety Report, Share Live Trip, the administrator who ends a
 * trip for safety, and the LGU's calamity declaration. Every rule is the DATABASE's: these functions only call it and read what it answers.
 *
 * Share Live Trip is the device's own sharing of a link (Rule 26.1): SAKAY has no in-app emergency calling, messaging or emergency-contact management, and none is built here.
 * The call names and their parameter names are checked against the database by scripts/db-tests/batch11/client-contract.js.
 */
import type { RpcCapableClient } from './restrictionUtils';
import { callRpc } from './tripEnd';
import type { TripEndResult } from './tripEnd';
import { SHARE_LINK_BUFFER_MINUTES, SHARE_LINK_MAX_HOURS } from '../config/policyConfig';

export type SafetyLanguage = 'en' | 'tl';

// ---- the Urgent Safety Report (Rule 26.2) ---------------------------------------------------------------------------------------------------------------------
/** What the person can say with one tap. Everything but the first goes straight to the LGU Administrator (Rule 19.8) or is an emergency incident (Rules 19.7, 26.3). */
export const URGENT_REPORT_OPTIONS = [
  { category: 'Safety Concern', en: 'I feel unsafe', tl: 'Hindi ako ligtas', serious: false },
  { category: 'Threat', en: 'Someone is threatening me', tl: 'Binabantaan ako', serious: true },
  { category: 'Physical Assault', en: 'Someone is hurting me', tl: 'Sinasaktan ako', serious: true },
  { category: 'Harassment', en: 'I am being harassed', tl: 'Nililigalig ako', serious: true },
  { category: 'Medical Emergency', en: 'Someone needs a doctor', tl: 'May nangangailangan ng doktor', serious: false },
  { category: 'Accident', en: 'There was an accident', tl: 'May aksidente', serious: false },
] as const;
export type UrgentReportCategory = (typeof URGENT_REPORT_OPTIONS)[number]['category'];

/** One tap: the report is filed with the trip's last known vehicle position; the text is optional. Two taps within two minutes are one report. */
export const fileUrgentSafetyReport = (client: RpcCapableClient, bookingId: string, category: UrgentReportCategory = 'Safety Concern', description?: string | null): Promise<TripEndResult> =>
  callRpc(client, 'file_urgent_safety_report', { p_booking_id: bookingId, p_category: category, p_description: description?.trim() || null });

// ---- the administrator ends a trip for safety (Rules 29.20 - 29.22, 26.3) -------------------------------------------------------------------------------------
export const SAFETY_END_REASONS = [
  { code: 'driver_detained', en: 'The driver was detained or arrested', note: 'The driver is held for the TODA and LGU review.' },
  { code: 'driver_incapacitated', en: 'The driver is medically incapacitated', note: 'No strike; the TODA reviews it.' },
  { code: 'accident', en: 'There was an accident', note: 'No automatic strike.' },
  { code: 'passenger_in_danger', en: 'The passenger is in danger', note: '' },
  { code: 'emergency', en: 'Another emergency', note: '' },
] as const;
export type SafetyEndReason = (typeof SAFETY_END_REASONS)[number]['code'];
export interface SafetyEnd {
  bookingId: string;
  reason: SafetyEndReason;
  /** how the situation was confirmed (who was reached, what they said): at least 10 characters */
  note: string;
  /** close the trip at once as Paid or Waived (the TODA Administrator decides the fare, Rule 26.3), or null to leave it for the ordinary confirmation */
  closeAs: 'Paid' | 'Waived' | null;
}
export const endTripForSafety = (client: RpcCapableClient, e: SafetyEnd): Promise<TripEndResult> =>
  callRpc(client, 'admin_end_trip_for_safety', { p_booking_id: e.bookingId, p_reason_code: e.reason, p_note: e.note, p_close_as: e.closeAs });

// ---- Share Live Trip (Rule 26.1; figure F11.3) -----------------------------------------------------------------------------------------------------------------
/** What the person who got the link sees (get_shared_trip_view): a whitelist; no passenger name, phone number or fare is in it */
export interface SharedTripView {
  found: true;
  state: 'assigned' | 'arrived' | 'ongoing' | 'at_destination' | 'completed' | 'cancelled' | string;
  ended: boolean;
  status_en: string;
  status_tl: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup: { lat: number | null; lng: number | null };
  dropoff: { lat: number | null; lng: number | null };
  driver_first_name: string | null;
  plate_number: string | null;
  /** Panel comment (D-P2): the driver's mobile number while the trip is on, for the person who received the link to call; null once it has ended */
  driver_phone: string | null;
  /** The driver has a profile picture the page may ask for (GET /api/share/:token/driver-photo); the picture itself is not in this answer */
  driver_has_photo: boolean;
  driver_position: { lat: number; lng: number; age_seconds: number } | null;
  progress_pct: number | null;
  expires_at: string;
  server_now: string;
}

/** Makes the link (or returns the one this phone already holds: pass its token). The token comes back once; the database keeps only its hash. */
export const createTripShare = (client: RpcCapableClient, bookingId: string, reuseToken?: string | null): Promise<TripEndResult> =>
  callRpc(client, 'create_trip_share', { p_booking_id: bookingId, p_reuse_token: reuseToken ?? null });
/** The passenger switches the link off at once */
export const revokeTripShare = (client: RpcCapableClient, bookingId: string): Promise<TripEndResult> => callRpc(client, 'revoke_trip_share', { p_booking_id: bookingId });
export async function fetchMyTripShare(client: RpcCapableClient, bookingId: string): Promise<{ active: boolean; expiresAt: string | null }> {
  try {
    const { data, error } = await client.rpc('get_my_trip_share', { p_booking_id: bookingId });
    const row = data as { active?: boolean; expires_at?: string } | null;
    if (error || !row) return { active: false, expiresAt: null };
    return { active: Boolean(row.active), expiresAt: row.expires_at ?? null };
  } catch {
    return { active: false, expiresAt: null };
  }
}
/** What a visitor without an account may read; null when the link is not (or no longer) valid, or nothing came back */
export async function fetchSharedTripView(client: RpcCapableClient, token: string): Promise<SharedTripView | null> {
  try {
    const { data, error } = await client.rpc('get_shared_trip_view', { p_token: token });
    const row = data as { found?: boolean } | null;
    if (error || !row || row.found !== true) return null;
    return row as unknown as SharedTripView;
  } catch {
    return null;
  }
}

export const SHARE_TOKEN_PATTERN = /^[0-9a-f]{32}$/;
/** The address the link opens: a page of the Passenger app that needs no sign-in */
export const shareUrl = (origin: string, token: string): string => `${origin.replace(/\/+$/, '')}/share/${token}`;

/**
 * The message the phone's own sharing sends (SMS, Messenger, ...): one short line and the link. The addresses are not in it: the page the link opens shows them.
 * (`pickup` and `dropoff` are still accepted so that older callers compile; they are not used.)
 */
export function shareMessage(language: SafetyLanguage, trip: { url: string; pickup?: string | null; dropoff?: string | null }): string {
  return language === 'tl'
    ? `Tingnan ang aking SAKAY Trip! Masusubaybayan mo ang biyahe ko dito: ${trip.url}`
    : `View my SAKAY Trip! You can follow my trip here: ${trip.url}`;
}
/** The line under the share button: how long the link lasts (F11.3) */
export const shareLifetimeText = (language: SafetyLanguage): string =>
  language === 'tl'
    ? `Gumagana ang link hanggang matapos ang biyahe (+${SHARE_LINK_BUFFER_MINUTES} minuto), hindi lalampas ng ${SHARE_LINK_MAX_HOURS} oras. Maaari mo itong patayin anumang oras.`
    : `The link works until the trip ends (+${SHARE_LINK_BUFFER_MINUTES} minutes), never longer than ${SHARE_LINK_MAX_HOURS} hours. You can switch it off at any time.`;

// ---- the calamity (Rules 15.3, 15.4, 29.6) ---------------------------------------------------------------------------------------------------------------------
export const CALAMITY_KINDS = ['Typhoon', 'Flood', 'Earthquake', 'Road Closure', 'Declared Emergency', 'Other'] as const;
export type CalamityKind = (typeof CALAMITY_KINDS)[number];
export const CALAMITY_SCOPES = [
  { code: 'CANCEL_STALL_NOSHOW', en: 'Cancellations, stalls and no-shows' },
  { code: 'ALL', en: 'Every violation that can be paused (serious and safety violations never are)' },
] as const;
export type CalamityScope = (typeof CALAMITY_SCOPES)[number]['code'];

export interface ActiveCalamity {
  active: boolean;
  declarationId?: string;
  kind?: CalamityKind;
  title?: string;
  message?: string;
  scope?: CalamityScope;
  declaredAt?: string;
}
/** What the apps show as a banner while it lasts: any signed-in user may read it */
export async function fetchActiveCalamity(client: RpcCapableClient): Promise<ActiveCalamity> {
  try {
    const { data, error } = await client.rpc('get_active_calamity', {});
    const r = data as Record<string, unknown> | null;
    if (error || !r || r.active !== true) return { active: false };
    return {
      active: true,
      declarationId: String(r.declaration_id ?? ''),
      kind: r.kind as CalamityKind,
      title: String(r.title ?? ''),
      message: String(r.message ?? ''),
      scope: r.scope as CalamityScope,
      declaredAt: typeof r.declared_at === 'string' ? r.declared_at : undefined,
    };
  } catch {
    return { active: false };
  }
}
export interface CalamityInput {
  kind: CalamityKind;
  title: string;
  message: string;
  scope: CalamityScope;
}
/** ONE administrative action: the announcement and the strike pause, recorded by one audit entry (the LGU Administrator only) */
export const declareCalamity = (client: RpcCapableClient, c: CalamityInput): Promise<TripEndResult> =>
  callRpc(client, 'declare_calamity', { p_kind: c.kind, p_title: c.title, p_message: c.message, p_scope: c.scope });
export const endCalamity = (client: RpcCapableClient, note?: string | null): Promise<TripEndResult> => callRpc(client, 'end_calamity', { p_note: note?.trim() || null });
