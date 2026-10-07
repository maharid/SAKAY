import { supabase } from './supabaseClient';
import {
  DISPATCH_OFFER_GRACE_SECONDS,
  DISPATCH_TIER1_RADIUS_KM,
  DISPATCH_TIER2_RADIUS_KM,
  DISPATCH_TIER3_MAX_SECONDS,
  DISPATCH_TIER3_REFRESH_SECONDS,
  DRIVER_OFFER_TIMEOUT_SECONDS,
  nearestAccreditedTodaId,
  selectTierCandidates,
  tier3RadiusKm,
  type DispatchCandidate,
  type TodaTerminal,
} from '@sakay/shared';

// How long the dispatcher waits for ONE driver: the driver's countdown plus a short grace (see DISPATCH_OFFER_GRACE_SECONDS).
const OFFER_WAIT_SECONDS = DRIVER_OFFER_TIMEOUT_SECONDS + DISPATCH_OFFER_GRACE_SECONDS;

// While Tier 3 waits for the next pool refresh it still looks at the booking this often, so a cancellation is noticed quickly.
const IDLE_STATUS_CHECK_SECONDS = 3;

const SEARCHING_STATUSES = ['Pending', 'Searching Driver'];
const ACCEPTED_STATUSES = ['Accepted', 'Driver Assigned', 'In Transit', 'Trip Ongoing'];

// Wait utility
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

const activeDispatches = new Set<string>();

// ---------------------------------------------------------------------------------------------------------------------------------
// Progress: what the passenger's screen shows while the search runs. 'nearby' = Tiers 1-2 (the area around the pickup), 'widening' =
// Tier 3 (the live search with a growing radius), 'ended' = the dispatcher stopped (a driver accepted, the passenger cancelled, or
// nobody was found; the booking status says which). Kept for every screen: it lives here, not inside one component.
// ---------------------------------------------------------------------------------------------------------------------------------
export type DispatchPhase = 'nearby' | 'widening' | 'ended';

export interface DispatchProgress {
  phase: DispatchPhase;
  /** When this search round began in this browser (ms since epoch) */
  startedAt: number;
}

const progressByBooking = new Map<string, DispatchProgress>();
const progressListeners = new Set<() => void>();

const setProgress = (bookingId: string, next: DispatchProgress) => {
  progressByBooking.set(bookingId, next);
  progressListeners.forEach((listener) => listener());
};

export const getDispatchProgress = (bookingId?: string | null): DispatchProgress | null =>
  bookingId ? progressByBooking.get(bookingId) ?? null : null;

export const subscribeDispatchProgress = (listener: () => void): (() => void) => {
  progressListeners.add(listener);
  return () => {
    progressListeners.delete(listener);
  };
};

// ---------------------------------------------------------------------------------------------------------------------------------

/** The booking's status, or null when it could not be read (a failed read never ends a search). */
const readBookingStatus = async (bookingId: string): Promise<string | null> => {
  const { data, error } = await supabase.from('booking').select('booking_status').eq('booking_id', bookingId).maybeSingle();
  return error || !data ? null : (data.booking_status as string);
};

/** Someone accepted, or the passenger cancelled: the search is over whatever it was doing. */
const isSearchOver = (status: string | null): boolean => status !== null && !SEARCHING_STATUSES.includes(status);

// The drivers the database says may be offered THIS booking now (Available, verified, not on a trip, not paused, not offered it in
// this search round) inside the radius. A passenger cannot read the driver table, so the database answers for this booking only:
// driver id, TODA and distance from the pickup rounded to 0.1 km. (GPS freshness is not checked there yet: Batch 6.)
const fetchCandidates = async (bookingId: string, radiusKm: number): Promise<DispatchCandidate[]> => {
  const { data, error } = await supabase.rpc('find_candidate_drivers', { p_booking_id: bookingId, p_max_km: radiusKm, p_limit: 50 });
  if (error) {
    console.warn('[dispatchService] find_candidate_drivers:', error.message);
    return [];
  }
  return (data ?? []) as DispatchCandidate[];
};

// How one run of offers ended: 'closed' = a driver accepted or the passenger cancelled (stop everything), 'exhausted' = every driver in
// the list was offered the booking and none accepted, 'expired' = the search ran out of time between two offers.
type OfferOutcome = 'closed' | 'exhausted' | 'expired';

// Offers the booking to the drivers one at a time, in the order given, each with its own response window.
const sendSequentialOffers = async (bookingId: string, drivers: DispatchCandidate[], deadlineAt?: number): Promise<OfferOutcome> => {
  for (let i = 0; i < drivers.length; i++) {
    const driver = drivers[i];

    if (deadlineAt !== undefined && Date.now() >= deadlineAt) return 'expired';

    if (isSearchOver(await readBookingStatus(bookingId))) {
      console.log('[dispatchService] Booking no longer searching. Halting dispatch.');
      return 'closed';
    }

    console.log(`[dispatchService] Offering to driver ${driver.driver_id} (Rank ${i + 1})`);

    const { data: attempt, error: attemptError } = await supabase
      .from('dispatch_attempt')
      .insert([{
        booking_id: bookingId,
        driver_id: driver.driver_id,
        dispatch_method: 'Sequential Tiered',
        driver_rank: i + 1,
        response_status: 'Pending'
      }])
      .select()
      .single();

    if (attemptError) {
      console.error('[dispatchService] Failed to create attempt:', attemptError);
      continue;
    }

    // Wait for the driver's response
    let waited = 0;
    let attemptStatus = 'Pending';

    while (waited < OFFER_WAIT_SECONDS) {
      await delay(1000);
      waited += 1;

      const { data: currentAttempt } = await supabase
        .from('dispatch_attempt')
        .select('response_status')
        .eq('attempt_id', attempt.attempt_id)
        .single();

      if (currentAttempt) {
        attemptStatus = currentAttempt.response_status;
        if (attemptStatus === 'Accepted') {
          console.log(`[dispatchService] Driver ${driver.driver_id} accepted via attempt.`);
          return 'closed';
        } else if (attemptStatus === 'Declined' || attemptStatus === 'Expired') {
          console.log(`[dispatchService] Driver ${driver.driver_id} ${attemptStatus.toLowerCase()}.`);
          break;
        }
      }

      // Concurrently check if the booking itself was accepted or cancelled
      const status = await readBookingStatus(bookingId);
      if (status !== null && ACCEPTED_STATUSES.includes(status)) {
        console.log(`[dispatchService] Booking ${bookingId} was accepted!`);
        return 'closed';
      }
      if (isSearchOver(status)) {
        console.log(`[dispatchService] Booking ${bookingId} is '${status}'. Halting dispatch.`);
        return 'closed';
      }
    }

    if (attemptStatus === 'Pending') {
      // Timeout, mark as Declined (no responded_at: the unanswered-offer counter expects exactly this)
      await supabase.from('dispatch_attempt').update({ response_status: 'Declined' }).eq('attempt_id', attempt.attempt_id);
      console.log(`[dispatchService] Driver ${driver.driver_id} timed out.`);
    }
  }
  return 'exhausted';
};

/**
 * Dispatch Engine: Tiered Allocation (Intelligent Driver Dispatch specification), run by the Passenger PWA until Batch 6 moves it to the server.
 *
 *   Tier 1  the Priority TODA's drivers within DISPATCH_TIER1_RADIUS_KM of the pickup (skipped at once when there are none)
 *   Tier 2  any accredited TODA's drivers within DISPATCH_TIER2_RADIUS_KM
 *   Tier 3  live search: the radius grows (DISPATCH_TIER3_RADIUS_STEPS) and the pool is refreshed every DISPATCH_TIER3_REFRESH_SECONDS,
 *           until DISPATCH_TIER3_MAX_SECONDS; then the booking becomes 'No Driver Found'
 *
 * Offers are sequential and nearest first, each with its own response window. A driver is offered a booking once per search round
 * (the database leaves out drivers already offered it since the round began). One search runs per booking at a time.
 */
export const startDispatch = async (bookingId: string) => {
  if (!bookingId) return;

  if (activeDispatches.has(bookingId)) {
    console.log(`[dispatchService] Dispatch already actively running for booking: ${bookingId}`);
    return;
  }
  activeDispatches.add(bookingId);

  const startedAt = Date.now();
  try {
    const { data: dbBooking, error: bErr } = await supabase
      .from('booking')
      .select('booking_status, pickup_latitude, pickup_longitude')
      .eq('booking_id', bookingId)
      .single();
    if (bErr || !dbBooking) {
      console.warn('[dispatchService] Booking not found in database:', bErr);
      return;
    }

    if (!SEARCHING_STATUSES.includes(dbBooking.booking_status)) {
      console.log(`[dispatchService] Booking ${bookingId} is already in status '${dbBooking.booking_status}'. No dispatch needed.`);
      return;
    }

    console.log(`[dispatchService] Starting tiered dispatch for booking: ${bookingId}`);
    setProgress(bookingId, { phase: 'nearby', startedAt });

    const pickupLat = Number(dbBooking.pickup_latitude) || 13.4117;
    const pickupLng = Number(dbBooking.pickup_longitude) || 121.1803;

    // Priority TODA: the public directory of accredited TODAs (id, name, terminal position); the toda table itself is not readable by passengers.
    const { data: todas } = await supabase.rpc('list_accredited_todas');
    const priorityTodaId = nearestAccreditedTodaId((todas ?? []) as TodaTerminal[], pickupLat, pickupLng);

    // The drivers of one tier, nearest first. 'closed' / 'exhausted' / 'expired' as above; 'empty' = nobody to offer.
    const offerToTier = async (radiusKm: number, todaId: string | null, deadlineAt?: number): Promise<OfferOutcome | 'empty'> => {
      const pool = selectTierCandidates(await fetchCandidates(bookingId, radiusKm), { radiusKm, todaId });
      if (pool.length === 0) return 'empty';
      console.log(`[dispatchService] ${pool.length} driver(s) within ${radiusKm} km${todaId ? ' of the Priority TODA' : ''}`);
      return sendSequentialOffers(bookingId, pool, deadlineAt);
    };

    // --- TIER 1: the Priority TODA, inside the small geofence ---
    if (priorityTodaId) {
      console.log('[dispatchService] Executing Tier 1');
      if ((await offerToTier(DISPATCH_TIER1_RADIUS_KM, priorityTodaId)) === 'closed') return;
    }

    // --- TIER 2: any accredited TODA, wider ---
    console.log('[dispatchService] Executing Tier 2');
    if ((await offerToTier(DISPATCH_TIER2_RADIUS_KM, null)) === 'closed') return;

    // --- TIER 3: live search with a growing radius and a refreshed pool ---
    console.log('[dispatchService] Executing Tier 3 (live search)');
    setProgress(bookingId, { phase: 'widening', startedAt });
    const tier3StartedAt = Date.now();
    const deadlineAt = tier3StartedAt + DISPATCH_TIER3_MAX_SECONDS * 1000;

    while (Date.now() < deadlineAt) {
      const radiusKm = tier3RadiusKm((Date.now() - tier3StartedAt) / 1000);
      if (radiusKm === null) break;

      const nextRefreshAt = Date.now() + DISPATCH_TIER3_REFRESH_SECONDS * 1000;
      const outcome = await offerToTier(radiusKm, null, deadlineAt);
      if (outcome === 'closed') return;
      if (outcome === 'expired') break;

      // Everyone in this pool was offered (or nobody was there): wait for the next refresh, keeping an eye on the booking.
      while (Date.now() < Math.min(nextRefreshAt, deadlineAt)) {
        await delay(IDLE_STATUS_CHECK_SECONDS * 1000);
        if (isSearchOver(await readBookingStatus(bookingId))) return;
      }
    }

    // Out of time. The update only applies while the booking is still searching, so it can never overwrite an acceptance or a cancellation.
    console.log('[dispatchService] Maximum search time reached. No driver found.');
    await supabase
      .from('booking')
      .update({ booking_status: 'No Driver Found' })
      .eq('booking_id', bookingId)
      .in('booking_status', SEARCHING_STATUSES);
  } catch (err) {
    console.error('[dispatchService] Dispatch error:', err);
  } finally {
    const progress = progressByBooking.get(bookingId);
    if (progress) setProgress(bookingId, { ...progress, phase: 'ended' });
    activeDispatches.delete(bookingId);
  }
};

/**
 * Retry after No Driver Found: the database reopens the booking and starts a new search round (offers of the earlier round no longer
 * exclude anyone), and the search begins again from Tier 1. Returns false when the search could not be restarted.
 */
export const retryDriverSearch = async (bookingId: string): Promise<boolean> => {
  const { data, error } = await supabase.rpc('retry_driver_search', { p_booking_id: bookingId });
  if (error || !data?.success) return false;
  startDispatch(bookingId).catch(console.error);
  return true;
};
