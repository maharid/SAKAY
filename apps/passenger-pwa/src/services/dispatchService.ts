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

/** What the database answered to a pickup change (Rule 29.9). expectedFare is the fare it quotes for the new pickup when the one that was sent was not it. */
export interface PickupChangeOutcome {
  ok: boolean;
  errorCode: string | null;
  expectedFare: number | null;
}

/**
 * Rule 29.9: the pickup may be changed ONLY while the search is still running and no driver has accepted. The database quotes the fare again from the new
 * route (the passenger confirms the figure he was shown: a different figure comes back as ERR_FARE_MISMATCH with expected_fare), checks the service area,
 * withdraws the offers that are out and starts the search over. After acceptance it refuses (ERR_PICKUP_LOCKED): cancel (free, if the driver has not arrived
 * and the grace minute has not passed) and book again.
 */
export const changeBookingPickup = async (
  bookingId: string,
  place: { address: string; lat: number; lng: number },
  distanceKm: number,
  expectedFare: number
): Promise<PickupChangeOutcome> => {
  const { data, error } = await supabase.rpc('passenger_update_pickup', {
    p_booking_id: bookingId,
    p_latitude: place.lat,
    p_longitude: place.lng,
    p_address: place.address,
    p_distance_km: distanceKm,
    p_expected_fare: expectedFare,
  });
  const row = data as { success?: boolean; error_code?: string; expected_fare?: number | string } | null;
  if (!error && row?.success) return { ok: true, errorCode: null, expectedFare: null };
  const expected = row?.expected_fare !== undefined && row.expected_fare !== null ? Number(row.expected_fare) : null;
  return { ok: false, errorCode: row?.error_code ?? null, expectedFare: Number.isFinite(expected as number) ? expected : null };
};

/** What to tell the passenger when a pickup change was refused (Tagalog or English). */
export const describePickupRefusal = (errorCode: string | null, language: string): string => {
  const tl = language === 'tl';
  if (errorCode === 'ERR_PICKUP_LOCKED') {
    return tl
      ? 'Hindi na mababago ang pickup dahil may drayber nang tumanggap. Maaari kang magkansela at mag-book muli.'
      : 'The pickup can no longer be changed because a driver has accepted. You can cancel and book again.';
  }
  if (errorCode === 'ERR_OUT_OF_SERVICE_AREA') {
    return tl ? 'Nasa labas ng Calapan City ang pickup na ito. Pumili ng pickup sa loob ng lungsod.' : 'This pickup is outside Calapan City. Please choose a pickup inside the city.';
  }
  if (errorCode === 'ERR_FARE_MISMATCH') {
    return tl ? 'Nagbago ang pamasahe para sa bagong pickup. Pakisuri ang bagong halaga bago kumpirmahin.' : 'The fare for the new pickup is different. Please review it before confirming.';
  }
  return tl ? 'Hindi mabago ang pickup ngayon. Pakisubukang muli.' : 'The pickup could not be changed right now. Please try again.';
};
