import { supabase } from './supabaseClient';
import type { DriverDelayReason } from '@sakay/shared';

// The clocks of an accepted booking belong to the DATABASE: how long the passenger has to board once the driver has arrived (Rule 10), the
// warning to a driver who has not set off (Rule 8.2), the delay he may report (Rule 8.4). This module only reads them and asks for the
// guarded actions (report a delay, report a no-show). The phone keeps no clock that decides anything.

export interface ArrivalWait {
  /** Seconds left when the database answered (0 once the time is up) */
  secondsRemaining: number;
  /** 300, or 420 once the passenger used "I'm Almost There" */
  waitTotalSeconds: number;
  extended: boolean;
  /** The database's own check that this driver is at the pickup, on a good enough GPS fix (null if it could not tell) */
  driverInZone: boolean;
  /** The wait is over AND the driver is at the pickup: the Passenger No-Show button may be used */
  canReportNoShow: boolean;
}

interface ArrivalWaitRow {
  success?: boolean;
  waiting?: boolean;
  seconds_remaining?: number;
  wait_total_seconds?: number;
  extended?: boolean;
  driver_in_zone?: boolean | null;
  can_report_no_show?: boolean;
}

/** The passenger's waiting time as the database sees it, or null when the driver has not arrived yet (or it could not be read). */
export const getArrivalWait = async (bookingId: string): Promise<ArrivalWait | null> => {
  const { data, error } = await supabase.rpc('get_arrival_wait_status', { p_booking_id: bookingId });
  const row = data as ArrivalWaitRow | null;
  if (error || !row || row.success === false || !row.waiting) return null;
  return {
    secondsRemaining: Number(row.seconds_remaining ?? 0),
    waitTotalSeconds: Number(row.wait_total_seconds ?? 0),
    extended: Boolean(row.extended),
    driverInZone: Boolean(row.driver_in_zone),
    canReportNoShow: Boolean(row.can_report_no_show),
  };
};

export interface ClockActionResult {
  ok: boolean;
  /** What the database said when it refused (shown as is, without its internal code) */
  error: string | null;
  reportsLeft?: number;
}

const refusal = (message: string | undefined | null, fallback: string): string => (message || fallback).replace(/^ERR_[A-Z_]+:\s*/, '');

/** Rule 10.4: the passenger did not board within the wait. The database checks the wait, the arrival and the driver's position again. */
export const reportPassengerNoShow = async (bookingId: string): Promise<ClockActionResult> => {
  const { data, error } = await supabase.rpc('driver_report_no_show', { p_booking_id: bookingId });
  const row = data as { success?: boolean; error?: string } | null;
  if (error || !row?.success) return { ok: false, error: refusal(row?.error ?? error?.message, 'The no-show could not be reported. Please try again.') };
  return { ok: true, error: null };
};

/** Rule 8.4: tells the system why the driver is standing still on the way (traffic, a road closure). It restarts the five minutes; twice at most. */
export const reportDriverDelay = async (bookingId: string, reason: DriverDelayReason): Promise<ClockActionResult> => {
  const { data, error } = await supabase.rpc('driver_report_delay', { p_booking_id: bookingId, p_reason: reason });
  const row = data as { success?: boolean; error?: string; reports_left?: number } | null;
  if (error || !row?.success) return { ok: false, error: refusal(row?.error ?? error?.message, 'The delay could not be reported. Please try again.') };
  return { ok: true, error: null, reportsLeft: Number(row.reports_left ?? 0) };
};

export interface AssignedBookingClocks {
  /** Rule 8.2: the driver has been warned that he has not started (null = not warned, or he has set off since) */
  stallWarnedAt: string | null;
  /** The booking is no longer this driver's: the system cancelled it on his behalf and gave it to another driver (Rules 8.3, 8.4, 9.3) */
  bookingGone: boolean;
}

/** Reads the clock marks of the driver's booking. Null when it could not be read (a network error is not "the booking is gone"). */
export const getAssignedBookingClocks = async (bookingId: string): Promise<AssignedBookingClocks | null> => {
  const { data, error } = await supabase.from('booking').select('booking_status, stall_warned_at').eq('booking_id', bookingId).maybeSingle();
  if (error) return null;
  // Once the booking is given to another driver this driver can no longer read it at all (or it is back in the search).
  if (!data) return { stallWarnedAt: null, bookingGone: true };
  const back = data.booking_status === 'Pending' || data.booking_status === 'Searching Driver' || data.booking_status === 'No Driver Found';
  return { stallWarnedAt: (data.stall_warned_at as string | null) ?? null, bookingGone: back };
};
