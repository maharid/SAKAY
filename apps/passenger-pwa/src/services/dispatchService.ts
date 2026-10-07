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
    endedReason: row.ended_reason ?? null,
    driverAssigned: Boolean(row.driver_assigned),
    acceptedDriverCancelCount: Number(row.accepted_driver_cancel_count ?? 0),
  };
};

/**
 * Retry after No Driver Found: the database starts a NEW cycle on the same booking, from the nearest drivers (Rule 7.4). Asking again while
 * the search is already running changes nothing. Returns false when the search could not be restarted.
 */
export const retryDriverSearch = async (bookingId: string): Promise<boolean> => {
  const { data, error } = await supabase.rpc('retry_driver_search', { p_booking_id: bookingId });
  return !error && Boolean((data as { success?: boolean } | null)?.success);
};
