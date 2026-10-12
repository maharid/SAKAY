import { supabase } from './supabaseClient';

// The search for a driver runs in the DATABASE (Batch 6): when a booking is made the database offers it to the nearest eligible driver,
// moves on when an offer runs out, widens the search, and ends it with "No Driver Found" at the maximum time, whether or not this app is open.
// This module only asks how the search is going and asks for a Retry. Nothing here offers a booking to anybody or keeps a clock.

/** nearby = the area around the pickup, widening = the live search has grown past it, ended = the search is over (accepted, cancelled or nobody found). */
export type DispatchPhase = 'nearby' | 'widening' | 'ended';

export interface DispatchStatus {
  bookingStatus: string;
  phase: DispatchPhase;
  /** Dispatch cycle: 1 at booking, +1 at every Retry */
  cycle: number;
  /** Seconds since this cycle began, as the database counted them when it answered */
  searchSeconds: number;
  /** Seconds since the live search began (only while widening) */
  wideningSeconds: number | null;
  /**
   * How far the database is looking for a driver right now, in metres (null when the search is not running, or when the database does not
   * report it). The map draws exactly this and nothing else.
   */
  radiusM: number | null;
  /** Why the search ended: accepted | cancelled | no_driver_found | accepted_drivers_cancelled */
  endedReason: string | null;
  driverAssigned: boolean;
  /** Accepted drivers who gave this booking back (Rule 12.8 ends the cycle at three) */
  acceptedDriverCancelCount: number;
}

interface DispatchStatusRow {
  success?: boolean;
  booking_status?: string;
  phase?: DispatchPhase;
  cycle?: number;
  search_seconds?: number;
  widening_seconds?: number | null;
  radius_m?: number | null;
  ended_reason?: string | null;
  driver_assigned?: boolean;
  accepted_driver_cancel_count?: number;
}

/** How the passenger's search is going (and a nudge: if something is due, the database does it now). Null when it could not be read. */
export const getDispatchStatus = async (bookingId: string): Promise<DispatchStatus | null> => {
  const { data, error } = await supabase.rpc('get_dispatch_status', { p_booking_id: bookingId });
  const row = data as DispatchStatusRow | null;
  if (error || !row || row.success === false || !row.booking_status || !row.phase) return null;
  return {
    bookingStatus: row.booking_status,
    phase: row.phase,
    cycle: row.cycle ?? 1,
    searchSeconds: Number(row.search_seconds ?? 0),
    wideningSeconds: row.widening_seconds === null || row.widening_seconds === undefined ? null : Number(row.widening_seconds),
    radiusM: row.radius_m === null || row.radius_m === undefined ? null : Number(row.radius_m),
    endedReason: row.ended_reason ?? null,
    driverAssigned: Boolean(row.driver_assigned),
    acceptedDriverCancelCount: Number(row.accepted_driver_cancel_count ?? 0),
  };
};

/** What the database answered to a Retry: restarted, or why not (ERR_OPEN_BOOKING_EXISTS, ERR_RETRY_EXPIRED, ERR_NOT_SEARCHING, ...; null when it could not be reached). */
export interface RetryOutcome {
  ok: boolean;
  errorCode: string | null;
}

/**
 * Retry after No Driver Found: the database starts a NEW cycle on the same booking, from the nearest drivers (Rule 7.4). Asking again while
 * the search is already running changes nothing. It refuses while the passenger has another open booking (Rule 4.4) and when the search ended
 * more than an hour ago (the pickup is probably not where the passenger is any more).
 */
export const retryDriverSearch = async (bookingId: string): Promise<RetryOutcome> => {
  const { data, error } = await supabase.rpc('retry_driver_search', { p_booking_id: bookingId });
  const row = data as { success?: boolean; error_code?: string } | null;
  if (!error && row?.success) return { ok: true, errorCode: null };
  return { ok: false, errorCode: row?.error_code ?? null };
};

/** What to tell the passenger when a Retry was refused (Tagalog or English), so the booking screen and the trip screen say the same thing. */
export const describeRetryRefusal = (errorCode: string | null, language: string): string => {
  const tl = language === 'tl';
  if (errorCode === 'ERR_OPEN_BOOKING_EXISTS') {
    return tl ? 'May iba ka pang bukas na booking. Tapusin o kanselahin muna ito.' : 'You already have another open booking. Finish or cancel it first.';
  }
  if (errorCode === 'ERR_RETRY_EXPIRED') {
    return tl
      ? 'Matagal nang natapos ang paghahanap na ito para ulitin pa. Gumawa ng bagong booking.'
      : 'This search ended too long ago to restart. Please make a new booking.';
  }
  return tl ? 'Hindi masimulan muli ang paghahanap. Pakisubukang muli.' : 'We could not restart the search. Please try again.';
};
