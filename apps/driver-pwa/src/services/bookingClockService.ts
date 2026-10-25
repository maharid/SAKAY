import { reportNetworkOutcome } from '@sakay/shared';
import type { DriverDelayReason, TripReconfirmStatus } from '@sakay/shared';

import { supabase } from './supabaseClient';

// The clocks of an accepted booking belong to the DATABASE: how long the passenger has to board once the driver has arrived (Rule 10), the
// warning to a driver who has not set off (Rule 8.2), the delay he may report (Rule 8.4). This module only reads them and asks for the
// guarded actions (report a delay, report a no-show). The phone keeps no clock that decides anything.

export interface ArrivalWait {
  /** Seconds left when the database answered, rounded UP (0 once the time is up). The countdown is drawn from deadlineMs, not from this. */
  secondsRemaining: number;
  /** The moment the wait ends and the database's own clock when it answered (ms since epoch, the SERVER's clock); null if it did not say */
  deadlineMs: number | null;
  serverNowMs: number | null;
  /** 300, or 420 once the passenger used "I'm Almost There" */
  waitTotalSeconds: number;
  extended: boolean;
  /** The database's own check that this driver is at the pickup, on a good enough GPS fix (null if it could not tell) */
  driverInZone: boolean;
  /** The wait is over AND the driver is at the pickup: the Passenger No-Show button may be used */
  canReportNoShow: boolean;
  /** Rule 10.2: seconds of the wait that did not count because the driver was away from the pickup (the deadline already includes them) */
  pausedSeconds: number;
  /** Rule 11.1: the driver has confirmed the passenger's first name; the trip cannot start before */
  boardingVerified: boolean;
}

interface ArrivalWaitRow {
  success?: boolean;
  waiting?: boolean;
  seconds_remaining?: number;
  wait_total_seconds?: number;
  extended?: boolean;
  driver_in_zone?: boolean | null;
  can_report_no_show?: boolean;
  paused_seconds?: number;
  boarding_verified?: boolean;
  deadline?: string | null;
  server_time?: string | null;
}

const parseMs = (value: unknown): number | null => {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : null;
};

/** What a reading of the waiting time found: the passenger is being waited for, the wait is not running (any more), or it could not be read (then keep what is shown). */
export type ArrivalWaitReading = { state: 'waiting'; wait: ArrivalWait } | { state: 'idle' } | { state: 'unavailable' };

export const readArrivalWait = async (bookingId: string): Promise<ArrivalWaitReading> => {
  const { data, error } = await supabase.rpc('get_arrival_wait_status', { p_booking_id: bookingId });
  const row = data as ArrivalWaitRow | null;
  if (error || !row || row.success === false) return { state: 'unavailable' };
  if (!row.waiting) return { state: 'idle' };
  return {
    state: 'waiting',
    wait: {
      secondsRemaining: Number(row.seconds_remaining ?? 0),
      deadlineMs: parseMs(row.deadline),
      serverNowMs: parseMs(row.server_time),
      waitTotalSeconds: Number(row.wait_total_seconds ?? 0),
      extended: Boolean(row.extended),
      driverInZone: Boolean(row.driver_in_zone),
      canReportNoShow: Boolean(row.can_report_no_show),
      pausedSeconds: Number(row.paused_seconds ?? 0),
      boardingVerified: Boolean(row.boarding_verified),
    },
  };
};

/** The passenger's waiting time as the database sees it, or null when the driver has not arrived yet (or it could not be read). */
export const getArrivalWait = async (bookingId: string): Promise<ArrivalWait | null> => {
  const reading = await readArrivalWait(bookingId);
  return reading.state === 'waiting' ? reading.wait : null;
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

/**
 * Rule 11.1: "I checked the first name". The driver has asked the person at the pickup for their first name and it matches the booking; the database records it
 * (booking.boarding_verified_at) and refuses to start the trip before. It cannot see who boards: Rules 11.2 - 11.4 stay the driver's procedure.
 */
export const confirmPassengerFirstName = async (bookingId: string): Promise<ClockActionResult> => {
  const { data, error } = await supabase.rpc('driver_confirm_passenger', { p_booking_id: bookingId });
  const row = data as { success?: boolean; error?: string } | null;
  if (error || !row?.success) return { ok: false, error: refusal(row?.error ?? error?.message, 'The first name could not be confirmed. Please try again.') };
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
  /** The booking was cancelled (by the passenger, or by the system) while the driver was on the way: who, and the reason exactly as saved (may be empty) */
  cancellation: { by: string; reason: string } | null;
}

/** Reads the clock marks of the driver's booking. Null when it could not be read (a network error is not "the booking is gone"). */
export const getAssignedBookingClocks = async (bookingId: string): Promise<AssignedBookingClocks | null> => {
  const { data, error } = await supabase.from('booking').select('booking_status, stall_warned_at, cancelled_by, cancellation_reason').eq('booking_id', bookingId).maybeSingle();
  reportNetworkOutcome(error);
  if (error) return null;
  // Once the booking is given to another driver this driver can no longer read it at all (or it is back in the search).
  if (!data) return { stallWarnedAt: null, bookingGone: true, cancellation: null };
  const back = data.booking_status === 'Pending' || data.booking_status === 'Searching Driver' || data.booking_status === 'No Driver Found';
  const cancellation = data.booking_status === 'Cancelled' ? { by: String(data.cancelled_by ?? ''), reason: String(data.cancellation_reason ?? '') } : null;
  return { stallWarnedAt: (data.stall_warned_at as string | null) ?? null, bookingGone: back, cancellation };
};

export interface TripConnectivity {
  /** The connection was lost during this trip and the driver has not yet said what became of it (Rule 9.5) */
  needsReconfirm: boolean;
  /** The database is receiving the driver's position again: only then can he answer */
  connected: boolean;
  /** When the database marked the silence (3 minutes after the last position) */
  interruptedSince: string | null;
}

/** Does this trip wait for the driver's re-confirmation? Null when it could not be read (a network error is not "nothing to confirm"). */
export const getTripConnectivity = async (bookingId: string): Promise<TripConnectivity | null> => {
  const { data, error } = await supabase.rpc('get_my_trip_connectivity', { p_booking_id: bookingId });
  reportNetworkOutcome(error);
  const row = data as { success?: boolean; needs_reconfirm?: boolean; connected?: boolean; interrupted_since?: string | null } | null;
  if (error || !row || row.success === false) return null;
  return { needsReconfirm: Boolean(row.needs_reconfirm), connected: Boolean(row.connected), interruptedSince: row.interrupted_since ?? null };
};

/**
 * Rule 9.5: after a connection loss during the trip the driver says whether the trip is still going on or has ended. Until he does, the
 * database refuses to move the trip to fare finalisation. The database also checks that his position is reaching it again.
 */
export const reconfirmTrip = async (bookingId: string, status: TripReconfirmStatus): Promise<ClockActionResult> => {
  const { data, error } = await supabase.rpc('driver_reconfirm_trip', { p_booking_id: bookingId, p_status: status });
  reportNetworkOutcome(error);
  const row = data as { success?: boolean; error?: string } | null;
  if (error || !row?.success) return { ok: false, error: refusal(row?.error ?? error?.message, 'The trip could not be re-confirmed. Please try again.') };
  return { ok: true, error: null };
};
