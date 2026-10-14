/**
 * Ride-sharing on the screens (Section 14; migration 20261025000001). Every rule is the DATABASE's: these functions only call it and read what it answers.
 *   - the first passenger's Accept Shared Match / Decline Shared Match (Rule 14.5)
 *   - the driver's Additional Shared Passenger Request (Rule 14.3)
 *   - the limited facts about the other passenger the Passenger PWA may show (Rule 14.2.1): Mobile-Verified status, declared party size, approximate pickup area,
 *     general destination direction, and the driver's name, vehicle details and plate number. get_shared_match_state() answers NOTHING else (no name, phone number,
 *     address, coordinate or id of the other passenger), so nothing here can show more.
 *   - the driver's report of a passenger count that differs from the declared one (Rules 14.7, 29.17)
 *
 * The call names and their parameter names are checked against the database by scripts/db-tests/batch10/client-contract.js.
 */
import type { RpcCapableClient } from './restrictionUtils';
import { callRpc } from './tripEnd';
import type { TripEndResult } from './tripEnd';

export type SharedLanguage = 'en' | 'tl';
/** Where the pairing of a booking stands, for THIS passenger (get_shared_match_state) */
export type SharedMatchState = 'none' | 'proposed' | 'awaiting_my_consent' | 'awaiting_first_passenger' | 'matched' | 'closed';
export type CompassPoint = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
/** The answer of a button: the same shape as every other call of the apps (ok, the database's ERR_ code, its own sentence) */
export type SharedResult = TripEndResult;

/** Rule 14.2.1: the only facts about the other passenger */
export interface SharedOtherParty {
  mobileVerified: boolean;
  partySize: number;
  /** The Calapan barangay the pickup address names; null when it names none (the address itself never reaches the app) */
  pickupArea: string | null;
  direction: CompassPoint | null;
}

/** Rule 14.2.1: the assigned driver's name, vehicle details and plate number */
export interface SharedDriverBlock {
  name: string;
  vehicle: string;
  plateNumber: string | null;
  franchiseNumber: string | null;
}

export interface SharedMatchView {
  bookingId: string;
  isSharedTrip: boolean;
  /** 'first': this booking has the driver; 'second': this booking was proposed to join */
  role: 'first' | 'second' | null;
  state: SharedMatchState;
  matchId: string | null;
  /** Why the pairing ended (only for the first passenger: 'passenger_declined', 'passenger_timeout', 'cutoff', ...) */
  closedReason: string | null;
  /** The system is still looking for a second passenger for this booking (Rule 6.5: until the cutoff) */
  matchingOpen: boolean;
  progressPct: number | null;
  cutoffPct: number;
  expiresAt: string | null;
  secondsRemaining: number | null;
  other: SharedOtherParty | null;
  driver: SharedDriverBlock | null;
  serverNow: string | null;
}

const COMPASS: readonly CompassPoint[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const isCompass = (v: unknown): v is CompassPoint => typeof v === 'string' && (COMPASS as readonly string[]).includes(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** Reads the answer of get_shared_match_state. null when it is not the answer of a booking of this passenger. */
export function parseSharedMatchState(data: unknown): SharedMatchView | null {
  const d = data as Record<string, unknown> | null;
  if (!d || typeof d !== 'object' || d.success !== true || typeof d.booking_id !== 'string') return null;
  const o = d.other as Record<string, unknown> | null;
  const dr = d.driver as Record<string, unknown> | null;
  const state = String(d.state ?? 'none') as SharedMatchState;
  return {
    bookingId: d.booking_id,
    isSharedTrip: d.is_shared_trip === true,
    role: d.role === 'first' || d.role === 'second' ? d.role : null,
    state: (['none', 'proposed', 'awaiting_my_consent', 'awaiting_first_passenger', 'matched', 'closed'] as const).includes(state) ? state : 'none',
    matchId: str(d.match_id),
    closedReason: str(d.closed_reason),
    matchingOpen: d.matching_open === true,
    progressPct: num(d.progress_pct),
    cutoffPct: num(d.cutoff_pct) ?? 50,
    expiresAt: str(d.expires_at),
    secondsRemaining: num(d.seconds_remaining),
    other: o
      ? { mobileVerified: o.mobile_verified === true, partySize: num(o.party_size) ?? 1, pickupArea: str(o.pickup_area), direction: isCompass(o.direction) ? o.direction : null }
      : null,
    driver: dr
      ? { name: String(dr.name ?? ''), vehicle: String(dr.vehicle ?? 'Tricycle'), plateNumber: str(dr.plate_number), franchiseNumber: str(dr.franchise_number) }
      : null,
    serverNow: str(d.server_time),
  };
}

/** The shared-match state of one of the passenger's bookings, or null when it could not be read (an older database, a network error). */
export async function fetchSharedMatchState(client: RpcCapableClient, bookingId: string): Promise<SharedMatchView | null> {
  try {
    const { data, error } = await client.rpc('get_shared_match_state', { p_booking_id: bookingId });
    if (error) return null;
    return parseSharedMatchState(data);
  } catch {
    return null;
  }
}

/** Accept Shared Match (accept = true) or Decline Shared Match (Rule 14.5). A decline, or no answer, keeps the trip Solo and strikes nobody. */
export const respondSharedMatch = (client: RpcCapableClient, matchId: string, accept: boolean): Promise<SharedResult> =>
  callRpc(client, 'passenger_respond_shared_match', { p_match_id: matchId, p_accept: accept });

/** The driver's Additional Shared Passenger Request (Rule 14.3) */
export interface SharedRequestView {
  matchId: string;
  bookingId: string;
  /** Drivers are shown the passenger's first name only (Rule 11.1) */
  passengerFirstName: string;
  passengerCount: number;
  pickupAddress: string;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  dropoffAddress: string;
  dropoffLatitude: number | null;
  dropoffLongitude: number | null;
  estimatedDistanceKm: number | null;
  /** The passengers already on this trip */
  currentPartySize: number;
  hostProgressPct: number | null;
  /** How far the second pickup is from the stop the trip is heading to now, and how many metres each party's ride grows */
  pickupGapM: number | null;
  firstAddedM: number | null;
  secondAddedM: number | null;
  windowSeconds: number;
  secondsRemaining: number;
  expiresAt: string | null;
  serverNow: string | null;
}

export function parseSharedRequest(data: unknown): SharedRequestView | null {
  const d = data as Record<string, unknown> | null;
  if (!d || typeof d !== 'object' || typeof d.match_id !== 'string' || typeof d.booking_id !== 'string') return null;
  return {
    matchId: d.match_id,
    bookingId: d.booking_id,
    passengerFirstName: String(d.passenger_first_name ?? ''),
    passengerCount: num(d.passenger_count) ?? 1,
    pickupAddress: String(d.pickup_address ?? ''),
    pickupLatitude: num(d.pickup_latitude),
    pickupLongitude: num(d.pickup_longitude),
    dropoffAddress: String(d.dropoff_address ?? ''),
    dropoffLatitude: num(d.dropoff_latitude),
    dropoffLongitude: num(d.dropoff_longitude),
    estimatedDistanceKm: num(d.estimated_distance_km),
    currentPartySize: num(d.current_party_size) ?? 1,
    hostProgressPct: num(d.host_progress_pct),
    pickupGapM: num(d.pickup_gap_m),
    firstAddedM: num(d.first_added_m),
    secondAddedM: num(d.second_added_m),
    windowSeconds: num(d.window_seconds) ?? 15,
    secondsRemaining: num(d.seconds_remaining) ?? 0,
    expiresAt: str(d.expires_at),
    serverNow: str(d.server_time),
  };
}

/** The driver's open Additional Shared Passenger Request, or null (none, or it could not be read). */
export async function fetchMySharedRequest(client: RpcCapableClient): Promise<SharedRequestView | null> {
  try {
    const { data, error } = await client.rpc('get_my_shared_request', {});
    if (error) return null;
    return parseSharedRequest(data);
  } catch {
    return null;
  }
}

/** Accept or Decline the request (Rule 14.3). One decline is no strike; the booking returns to standard dispatch. */
export const respondSharedRequest = (client: RpcCapableClient, matchId: string, accept: boolean): Promise<SharedResult> =>
  callRpc(client, 'driver_respond_shared_request', { p_match_id: matchId, p_accept: accept });

/**
 * Rules 14.7 / 29.17: the driver reports the real number of passengers of a booking BEFORE the trip is finished. The fare of a shared trip is recomputed with it
 * and the LGU Administrator is flagged when the booking was under-declared; a strike needs that administrator's confirmation.
 */
export const reportPassengerCount = (client: RpcCapableClient, bookingId: string, actualCount: number, note?: string | null): Promise<SharedResult> =>
  callRpc(client, 'driver_report_passenger_count', { p_booking_id: bookingId, p_actual_count: actualCount, p_note: note ?? null });

// ---- words ------------------------------------------------------------------------------------------------------------------------------------------------
const COMPASS_WORDS: Record<CompassPoint, { en: string; tl: string }> = {
  N: { en: 'north', tl: 'hilaga' },
  NE: { en: 'north-east', tl: 'hilagang-silangan' },
  E: { en: 'east', tl: 'silangan' },
  SE: { en: 'south-east', tl: 'timog-silangan' },
  S: { en: 'south', tl: 'timog' },
  SW: { en: 'south-west', tl: 'timog-kanluran' },
  W: { en: 'west', tl: 'kanluran' },
  NW: { en: 'north-west', tl: 'hilagang-kanluran' },
};

/** "General destination direction" in words (Rule 14.2.1): one of eight compass points */
export function directionLabel(point: CompassPoint | null | undefined, language: SharedLanguage): string {
  if (!point) return language === 'tl' ? 'hindi tiyak' : 'not known';
  return COMPASS_WORDS[point][language];
}

/** "Approximate pickup area" in words: the barangay, or the city when the address names none */
export function pickupAreaLabel(area: string | null | undefined): string {
  return area ? `Brgy. ${area}` : 'Calapan City';
}

/** The one line that describes the other passenger on a consent or disclosure screen (Rule 14.2.1): nothing in it can identify anybody. */
export function describeOtherParty(other: SharedOtherParty, language: SharedLanguage): string {
  const tl = language === 'tl';
  const people = tl ? `${other.partySize} pasahero` : `${other.partySize} passenger${other.partySize === 1 ? '' : 's'}`;
  const verified = other.mobileVerified ? (tl ? 'Mobile-Verified' : 'Mobile-Verified') : tl ? 'Hindi pa Mobile-Verified' : 'Not Mobile-Verified';
  return tl
    ? `${verified} · ${people} · sundo sa ${pickupAreaLabel(other.pickupArea)} · papuntang ${directionLabel(other.direction, language)}`
    : `${verified} · ${people} · pickup in ${pickupAreaLabel(other.pickupArea)} · heading ${directionLabel(other.direction, language)}`;
}
