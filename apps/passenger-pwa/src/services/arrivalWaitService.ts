import { supabase } from './supabaseClient';

// Once the driver has arrived the passenger has a fixed time to board (Rule 10.1: 5 minutes, and "I'm Almost There" once adds 2 more, Rule 10.3).
// The DATABASE keeps that clock, from the moment it recorded the driver's arrival. This module only asks how much is left and asks for the extension;
// the phone draws the countdown and decides nothing.

export interface ArrivalWait {
  /** Seconds left when the database answered (0 once the time is up) */
  secondsRemaining: number;
  /** 300, or 420 once the extension has been used */
  waitTotalSeconds: number;
  extended: boolean;
  /** "I'm Almost There" is still available (not used yet, and the first five minutes are still running) */
  canExtend: boolean;
}

interface ArrivalWaitRow {
  success?: boolean;
  waiting?: boolean;
  seconds_remaining?: number;
  wait_total_seconds?: number;
  extended?: boolean;
  can_extend?: boolean;
  error?: string;
}

const toArrivalWait = (row: ArrivalWaitRow): ArrivalWait => ({
  secondsRemaining: Number(row.seconds_remaining ?? 0),
  waitTotalSeconds: Number(row.wait_total_seconds ?? 0),
  extended: Boolean(row.extended),
  canExtend: Boolean(row.can_extend),
});

/** The waiting time as the database sees it, or null when the driver has not arrived (or it could not be read). */
export const getArrivalWait = async (bookingId: string): Promise<ArrivalWait | null> => {
  const { data, error } = await supabase.rpc('get_arrival_wait_status', { p_booking_id: bookingId });
  const row = data as ArrivalWaitRow | null;
  if (error || !row || row.success === false || !row.waiting) return null;
  return toArrivalWait(row);
};

/** "I'm Almost There": adds two minutes, once. The database refuses a second time and once the wait is over, and says why. */
export const extendArrivalWait = async (bookingId: string): Promise<{ wait: ArrivalWait | null; error: string | null }> => {
  const { data, error } = await supabase.rpc('passenger_extend_wait', { p_booking_id: bookingId });
  const row = data as ArrivalWaitRow | null;
  if (error || !row) return { wait: null, error: error?.message || 'The extra time could not be added. Please try again.' };
  if (row.success === false) return { wait: null, error: row.error || 'The extra time could not be added.' };
  return { wait: row.waiting ? toArrivalWait(row) : null, error: null };
};
