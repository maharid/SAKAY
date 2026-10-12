/**
 * The end of the trip: the passenger's End Trip (Early), Confirm Fare and Report Fare Discrepancy, the driver's early stop, Payment Received and "the passenger
 * did not pay" (Rules 13, 16, 18; migration 20261024000001). Every rule is the DATABASE's: these functions only call it and read what it answers. Nothing here
 * keeps a flag on the phone (the old payment_confirmed_* localStorage keys and the public broadcast channels are gone): both screens read get_trip_end_state.
 *
 * The call names and their parameter names are checked against the database by scripts/db-tests/batch9/client-contract.js, and the reason lists below
 * against the lists the functions accept, so the two sides cannot drift apart.
 */
import type { RpcCapableClient } from './restrictionUtils';
import { COMPLETION_CONFIRM_TIMEOUT_SECONDS } from '../config/policyConfig';

export type PaymentStatus = 'Unpaid' | 'Paid' | 'Payment Disputed' | 'Waived';
export type EarlyEndKind = 'PERSONAL' | 'SAFETY' | 'DRIVER';
export type TripEndLanguage = 'en' | 'tl';

/** Rule 13.2: why the passenger asks to end the trip early. Safety Concern is the exception of Rule 13.5 (the actual-distance fare, provisional, with a review). */
export const PASSENGER_EARLY_END_REASONS = [
  { code: 'changed_plans', en: 'I changed my plans', tl: 'Nagbago ang plano ko', safety: false },
  { code: 'walk_rest', en: 'I will walk the rest of the way', tl: 'Lalakarin ko na ang natitira', safety: false },
  { code: 'earlier_dropoff', en: 'I want to get down earlier', tl: 'Gusto kong bumaba nang mas maaga', safety: false },
  { code: 'safety_concern', en: 'Safety concern', tl: 'May alalahanin ako sa kaligtasan', safety: true },
] as const;
export type PassengerEarlyEndReason = (typeof PASSENGER_EARLY_END_REASONS)[number]['code'];

/** Rules 13.7 / 29.3: why the driver ends the trip early. The first three are never struck (decision D9-8). */
export const DRIVER_EARLY_STOP_REASONS = [
  { code: 'vehicle_breakdown', en: 'Vehicle trouble', tl: 'May sira ang tricycle', valid: true },
  { code: 'emergency', en: 'Emergency', tl: 'Emergency', valid: true },
  { code: 'safety_concern', en: 'Safety concern', tl: 'May alalahanin sa kaligtasan', valid: true },
  { code: 'passenger_dispute', en: 'Dispute with the passenger', tl: 'Hindi pagkakasundo sa pasahero', valid: false },
  { code: 'other', en: 'Another reason', tl: 'Ibang dahilan', valid: false },
] as const;
export type DriverEarlyStopReason = (typeof DRIVER_EARLY_STOP_REASONS)[number]['code'];

/** What the end of the trip looks like right now (get_trip_end_state). Times are ISO strings from the database; `serverNow` is the database's own clock. */
export interface TripEndState {
  bookingId: string;
  bookingStatus: string;
  paymentStatus: PaymentStatus;
  actualFare: number | null;
  estimatedFare: number | null;
  fareLockedAt: string | null;
  confirmFareAt: string | null;
  fareDiscrepancyAt: string | null;
  paymentReceivedAt: string | null;
  fareUnconfirmed: boolean;
  tripCompletedAt: string | null;
  /** The passenger's confirmation time (Rule 16.6, one timer for Confirm Fare): the whole of it, what is left, and when it ends */
  timeoutSeconds: number;
  secondsLeft: number;
  confirmDeadline: string | null;
  serverNow: string | null;
  canConfirmFare: boolean;
  canReportDiscrepancy: boolean;
  /** The driver's Payment Received is enabled (the passenger answered, or the time ran out) */
  canReceivePayment: boolean;
  /** The 24 hour window to report a fare the driver finished without the passenger's confirmation (decision D9-10) */
  lateDisputeOpen: boolean;
  earlyEnd: {
    kind: EarlyEndKind;
    reason: string | null;
    requestedAt: string | null;
    endedAt: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
  dispute: {
    disputeId: string;
    kind: 'FARE_DISCREPANCY' | 'SAFETY_REVIEW' | 'NON_PAYMENT';
    status: 'Open' | 'Escalated' | 'Resolved';
    outcome: string | null;
    resolvedFare: number | null;
    dueAt: string | null;
    assignedRole: 'toda_admin' | 'lgu_admin';
  } | null;
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** Reads the database's answer. null when it is not a usable answer (an error, an older database): the screen then shows what it already knows. */
export function parseTripEndState(data: unknown): TripEndState | null {
  const r = data as Record<string, unknown> | null;
  if (!r || r.success !== true || typeof r.booking_id !== 'string') return null;
  const ee = r.early_end as Record<string, unknown> | null;
  const d = r.dispute as Record<string, unknown> | null;
  return {
    bookingId: r.booking_id,
    bookingStatus: String(r.booking_status ?? ''),
    paymentStatus: (r.payment_status as PaymentStatus) ?? 'Unpaid',
    actualFare: num(r.actual_fare),
    estimatedFare: num(r.estimated_fare),
    fareLockedAt: str(r.fare_locked_at),
    confirmFareAt: str(r.confirm_fare_at),
    fareDiscrepancyAt: str(r.fare_discrepancy_at),
    paymentReceivedAt: str(r.payment_received_at),
    fareUnconfirmed: Boolean(r.fare_unconfirmed),
    tripCompletedAt: str(r.trip_completed_at),
    timeoutSeconds: num(r.timeout_seconds) ?? COMPLETION_CONFIRM_TIMEOUT_SECONDS,
    secondsLeft: num(r.seconds_left) ?? 0,
    confirmDeadline: str(r.confirm_deadline),
    serverNow: str(r.server_now),
    canConfirmFare: Boolean(r.can_confirm_fare),
    canReportDiscrepancy: Boolean(r.can_report_discrepancy),
    canReceivePayment: Boolean(r.can_receive_payment),
    lateDisputeOpen: Boolean(r.late_dispute_open),
    earlyEnd: ee
      ? {
          kind: ee.kind as EarlyEndKind,
          reason: str(ee.reason),
          requestedAt: str(ee.requested_at),
          endedAt: str(ee.ended_at),
          latitude: num(ee.latitude),
          longitude: num(ee.longitude),
        }
      : null,
    dispute: d
      ? {
          disputeId: String(d.dispute_id),
          kind: d.kind as 'FARE_DISCREPANCY' | 'SAFETY_REVIEW' | 'NON_PAYMENT',
          status: d.status as 'Open' | 'Escalated' | 'Resolved',
          outcome: str(d.outcome),
          resolvedFare: num(d.resolved_fare),
          dueAt: str(d.due_at),
          assignedRole: d.assigned_role as 'toda_admin' | 'lgu_admin',
        }
      : null,
  };
}

/** Asks the database for the state of the end of the trip (the passenger or the driver of the booking may). */
export async function fetchTripEndState(client: RpcCapableClient, bookingId: string): Promise<TripEndState | null> {
  try {
    const { data, error } = await client.rpc('get_trip_end_state', { p_booking_id: bookingId });
    if (error) return null;
    return parseTripEndState(data);
  } catch {
    return null;
  }
}

/** The answer of one of the buttons below. `error` is the database's own sentence (Tagalog and English), without its ERR_ code. */
export interface TripEndResult {
  ok: boolean;
  /** The database's ERR_ code when it gave one (ERR_WAIT_FOR_PASSENGER, ERR_LATE_WINDOW_CLOSED, ...), or 'NETWORK' when nothing came back */
  code: string | null;
  error: string | null;
  data: Record<string, unknown> | null;
}

const ERR_PREFIX = /^ERR_[A-Z0-9_]+:\s*/;

async function call(client: RpcCapableClient, fn: string, args: Record<string, unknown>): Promise<TripEndResult> {
  try {
    const { data, error } = await client.rpc(fn, args);
    if (error) {
      const message = typeof (error as { message?: unknown }).message === 'string' ? (error as { message: string }).message : '';
      const code = /^(ERR_[A-Z0-9_]+)/.exec(message)?.[1] ?? null;
      return { ok: false, code, error: message.replace(ERR_PREFIX, '') || null, data: null };
    }
    const row = data as Record<string, unknown> | null;
    if (!row) return { ok: false, code: 'NETWORK', error: null, data: null };
    if (row.success === false) {
      return { ok: false, code: typeof row.error_code === 'string' ? row.error_code : null, error: typeof row.error === 'string' ? row.error : null, data: row };
    }
    return { ok: true, code: null, error: null, data: row };
  } catch {
    return { ok: false, code: 'NETWORK', error: null, data: null };
  }
}

// ---- the passenger (Rules 13.2, 18.2, 18.4, 13.5) -------------------------------------------------------------------------------------------------------
/** End Trip (Early): a REQUEST that unlocks the driver's End Trip (decision D9-6). Two taps, or a tap after the driver ended the trip, change nothing. */
export const requestEarlyEnd = (client: RpcCapableClient, bookingId: string, reasonCode: PassengerEarlyEndReason, note?: string | null) =>
  call(client, 'passenger_request_early_end', { p_booking_id: bookingId, p_reason_code: reasonCode, p_note: note ?? null });
export const withdrawEarlyEnd = (client: RpcCapableClient, bookingId: string) => call(client, 'passenger_withdraw_early_end', { p_booking_id: bookingId });
/** Confirm Fare (Rule 18.2) */
export const confirmFare = (client: RpcCapableClient, bookingId: string) => call(client, 'passenger_confirm_fare', { p_booking_id: bookingId });
/** Report Fare Discrepancy (Rule 18.4): the amount the driver asked for and what happened are the documentation. */
export const reportFareDiscrepancy = (client: RpcCapableClient, bookingId: string, claimedAmount: number, reason: string) =>
  call(client, 'passenger_report_fare_discrepancy', { p_booking_id: bookingId, p_claimed_amount: claimedAmount, p_reason: reason });
/** Rule 13.5: the passenger asks for an administrative review of a Safety Concern early end (the payment is not disputed by it). */
export const requestSafetyFareReview = (client: RpcCapableClient, bookingId: string, reason: string) =>
  call(client, 'request_safety_fare_review', { p_booking_id: bookingId, p_reason: reason });

// ---- the driver (Rules 13.7, 18.3, 18.6, 29.3) -----------------------------------------------------------------------------------------------------------
/** Payment Received (Rule 18.3): the only way a trip becomes Completed. The database refuses it, with the seconds left, until the passenger has answered or the time ran out. */
export const confirmPaymentReceived = (client: RpcCapableClient, bookingId: string) => call(client, 'driver_confirm_payment_received', { p_booking_id: bookingId });
/** The driver ends the trip before the destination: the passenger pays the actual-distance fare only (Rule 13.7). */
export const stopTripEarly = (client: RpcCapableClient, bookingId: string, reasonCode: DriverEarlyStopReason, note?: string | null) =>
  call(client, 'driver_stop_trip_early', { p_booking_id: bookingId, p_reason_code: reasonCode, p_note: note ?? null });
/** Rule 18.6: the confirmed fare was not paid. The trip is closed and an administrator decides. */
export const reportNonPayment = (client: RpcCapableClient, bookingId: string, note: string) => call(client, 'driver_report_non_payment', { p_booking_id: bookingId, p_note: note });

// ---- either party (Rule 18.4) -------------------------------------------------------------------------------------------------------------------------
export const addFareDisputeNote = (client: RpcCapableClient, disputeId: string, text: string) => call(client, 'submit_fare_dispute_note', { p_dispute_id: disputeId, p_text: text });

/** A word for the payment, as the trip and its receipt show it (Rules 16.6 / 18.3 / 18.4; decision D9-3: "Paid - fare unconfirmed"). */
export function describePayment(state: Pick<TripEndState, 'paymentStatus' | 'fareUnconfirmed'>, language: TripEndLanguage): string {
  const tl = language === 'tl';
  switch (state.paymentStatus) {
    case 'Paid':
      return state.fareUnconfirmed ? (tl ? 'Bayad na - hindi nakumpirma ang pamasahe' : 'Paid - fare unconfirmed') : tl ? 'Bayad na' : 'Paid';
    case 'Payment Disputed':
      return tl ? 'May hindi pagkakasundo sa bayad' : 'Payment disputed';
    case 'Waived':
      return tl ? 'Hindi na sinisingil' : 'Waived';
    default:
      return tl ? 'Hindi pa bayad' : 'Unpaid';
  }
}

/** The label of a reason code of either list, in the language of the screen (the code itself when it is not one of them). */
export function earlyEndReasonLabel(code: string | null | undefined, language: TripEndLanguage): string {
  const base = (code ?? '').split(':')[0];
  const hit = [...PASSENGER_EARLY_END_REASONS, ...DRIVER_EARLY_STOP_REASONS].find((r) => r.code === base);
  return hit ? hit[language] : base;
}

/** A row of the administrators' dispute queue (get_fare_disputes). */
export interface FareDisputeRow {
  dispute_id: string;
  booking_id: string;
  kind: 'FARE_DISCREPANCY' | 'SAFETY_REVIEW' | 'NON_PAYMENT';
  status: 'Open' | 'Escalated' | 'Resolved';
  assigned_role: 'toda_admin' | 'lgu_admin';
  opened_by: 'passenger' | 'driver';
  late: boolean;
  claimed_amount: number | null;
  system_fare: number | null;
  resolved_fare: number | null;
  outcome: string | null;
  resolution_note: string | null;
  due_at: string;
  overdue: boolean;
  created_at: string;
  escalated_at: string | null;
  escalation_reason: string | null;
  resolved_at: string | null;
  booking_status: string;
  payment_status: PaymentStatus;
  actual_fare: number | null;
  estimated_fare: number | null;
  early_end_kind: EarlyEndKind | null;
  early_end_reason: string | null;
  fare_unconfirmed: boolean;
  pickup_address: string | null;
  dropoff_address: string | null;
  trip_completed_at: string | null;
  passenger_name: string | null;
  passenger_phone: string | null;
  driver_id: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  plate_number: string | null;
  toda_name: string | null;
  notes: Array<{ party: string; note: string; created_at: string }>;
}

/** What an administrator decides about a dispute (resolve_fare_dispute) */
export interface FareDisputeDecision {
  disputeId: string;
  outcome: string;
  /** The final fare for a reduction or an adjustment (never above the system's fare: the database refuses it); null otherwise */
  finalFare: number | null;
  reason: string;
  /** DRV_OVERCHARGING, PAX_UNFOUNDED_DISPUTE or PAX_REFUSAL_TO_PAY (administrator-confirmed; the passenger strikes are the LGU Administrator's), or null */
  strikeCode: string | null;
}

// The call arguments of the administrators' functions, in ONE place (checked against the database by scripts/db-tests/batch9/client-contract.js)
export const fareDisputesArgs = (status?: string | null, limit = 100) => ({ p_status: status ?? null, p_limit: limit });
export const escalateFareDisputeArgs = (disputeId: string, reason: string) => ({ p_dispute_id: disputeId, p_reason: reason });
export const resolveFareDisputeArgs = (d: FareDisputeDecision) => ({
  p_dispute_id: d.disputeId,
  p_outcome: d.outcome,
  p_final_fare: d.finalFare,
  p_reason: d.reason,
  p_strike_code: d.strikeCode,
});
/** Rules 13.6 / 13.7: an administrator confirms the violation a review flag points at (admin_confirm_flagged_violation); the booking names the early stop for DRIVER_EARLY_STOP_REVIEW */
export const confirmFlaggedViolationArgs = (flagId: string, bookingId: string | null, reason: string) => ({ p_flag_id: flagId, p_booking_id: bookingId, p_reason: reason, p_points: null });
/** The queue as get_fare_disputes answers it (a list of FareDisputeRow); anything else is an empty queue */
export const parseFareDisputes = (data: unknown): FareDisputeRow[] => (Array.isArray(data) ? (data as FareDisputeRow[]) : []);

/** The decisions an administrator can give (resolve_fare_dispute) and the strike each may carry, by the kind of dispute. */
export const FARE_DISPUTE_OUTCOMES = {
  FARE_DISCREPANCY: ['FARE_CONFIRMED', 'FARE_REDUCED', 'FARE_WAIVED', 'FARE_ADJUSTED'],
  SAFETY_REVIEW: ['FARE_CONFIRMED', 'FARE_REDUCED', 'FARE_WAIVED', 'FARE_ADJUSTED'],
  NON_PAYMENT: ['NON_PAYMENT_UPHELD', 'NON_PAYMENT_REJECTED'],
} as const;
export const FARE_DISPUTE_STRIKES = {
  FARE_DISCREPANCY: [
    { code: 'DRV_OVERCHARGING', en: 'Driver: Overcharging Attempt (2 strikes)', lguOnly: false },
    { code: 'PAX_UNFOUNDED_DISPUTE', en: 'Passenger: bad-faith dispute (1 strike, LGU only)', lguOnly: true },
  ],
  SAFETY_REVIEW: [],
  NON_PAYMENT: [{ code: 'PAX_REFUSAL_TO_PAY', en: 'Passenger: Payment Refusal (2 strikes, LGU only)', lguOnly: true }],
} as const;
