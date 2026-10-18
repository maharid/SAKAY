/**
 * Rule 16.3 and PI-15: what an administrator needs to correct a COMPLETED trip or to close a trip that was left at the destination, for the LGU portal
 * and the TODA portal: the call arguments (checked against the database by scripts/db-tests/batch9/corrections-client-contract.js) and the same checks the
 * database makes, so a mistake is shown before anything is sent. The DATABASE decides who may (only the LGU Administrator corrects a completed trip; the
 * driver's TODA Administrator may close a stuck trip after 30 minutes, the LGU at any time), keeps the fare at or under the system's, writes the audit entry
 * and tells the passenger and the driver; none of that is repeated here.
 */

/** admin_correct_completed_trip: the payment statuses a completed trip may be corrected to */
export const CORRECTION_PAYMENT_STATUSES = ['Unpaid', 'Paid', 'Payment Disputed', 'Waived'] as const;
/** admin_close_unfinished_trip: a trip left at the destination is closed as paid (the cash was received) or waived (no fare) */
export const CLOSE_PAYMENT_STATUSES = ['Paid', 'Waived'] as const;
/** both functions want the reason in words: how it was confirmed, who was reached */
export const MIN_TRIP_REASON_LENGTH = 10;

export const correctCompletedTripArgs = (bookingId: string, newFare: number | null, paymentStatus: string | null, reason: string) => ({
  p_booking_id: bookingId,
  p_new_fare: newFare,
  p_payment_status: paymentStatus,
  p_reason: reason.trim(),
});

export const closeUnfinishedTripArgs = (bookingId: string, paymentStatus: string, reason: string) => ({
  p_booking_id: bookingId,
  p_payment_status: paymentStatus,
  p_reason: reason.trim(),
});

export interface CorrectionInput {
  /** the trip's fare and payment status as they stand */
  currentFare: number | null;
  currentPayment: string | null;
  /** what the administrator typed: a new fare (null = unchanged) and a payment status (null = unchanged) */
  newFare: number | null;
  paymentStatus: string | null;
  reason: string;
}

/**
 * Why a correction cannot be sent yet, or null when it can. Same order and same limits as admin_correct_completed_trip: a reason of at least 10
 * characters; a new fare, a payment status or both; a fare from 0 up to the system's fare (never above it); and something that really changes.
 */
export function correctionProblem(input: CorrectionInput): string | null {
  if (input.reason.trim().length < MIN_TRIP_REASON_LENGTH) return `Write the reason for the correction (at least ${MIN_TRIP_REASON_LENGTH} characters).`;
  if (input.newFare === null && input.paymentStatus === null) return 'Give a new fare, a payment status, or both.';
  if (input.paymentStatus !== null && !(CORRECTION_PAYMENT_STATUSES as readonly string[]).includes(input.paymentStatus)) {
    return 'The payment status must be Unpaid, Paid, Payment Disputed or Waived.';
  }
  if (input.newFare !== null && !Number.isFinite(input.newFare)) return 'The new fare must be a number.';
  const ceiling = input.currentFare ?? 0;
  const fare = input.newFare ?? input.currentFare;
  if (fare === null || fare < 0 || fare > ceiling) return `The fare must be at least 0 and never above the system's fare (${ceiling.toFixed(2)}).`;
  const payment = input.paymentStatus ?? (fare === 0 && input.newFare !== null ? 'Waived' : input.currentPayment);
  if (fare === input.currentFare && payment === input.currentPayment) return 'Nothing would change.';
  return null;
}

/** Why a trip cannot be closed yet, or null when it can (admin_close_unfinished_trip). */
export function closeProblem(paymentStatus: string | null, reason: string): string | null {
  if (!paymentStatus || !(CLOSE_PAYMENT_STATUSES as readonly string[]).includes(paymentStatus)) return 'Close the trip as Paid (the cash was received) or Waived (no fare).';
  if (reason.trim().length < MIN_TRIP_REASON_LENGTH) return `Write how the outcome was confirmed: who was reached, and what they said (at least ${MIN_TRIP_REASON_LENGTH} characters).`;
  return null;
}
