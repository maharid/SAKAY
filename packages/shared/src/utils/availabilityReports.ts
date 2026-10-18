/**
 * Rules 5.1 - 5.7: a driver must not be Available while queued at a terminal (a Queue Conflict Violation, Rule 5.3: 1 strike per confirmed instance) nor accept a
 * booking while already transporting passengers through another arrangement (a Driver Availability Violation, Rule 5.7). Nothing is automatic: an administrator
 * or a passenger REPORTS it, and a strike is issued only when an administrator confirms the instance. This is the call arguments (checked against the database by
 * scripts/db-tests/batch4/availability-client-contract.js) and the one check the database makes before a report, for the screens that file or confirm one.
 * The DATABASE decides who may report whom (the driver's own TODA Administrator, the LGU Administrator, or a passenger the driver served) and who may confirm.
 */

export type AvailabilityKind = 'QUEUE_CONFLICT' | 'AVAILABILITY_VIOLATION';

export const AVAILABILITY_KINDS: ReadonlyArray<{ kind: AvailabilityKind; rule: string; en: string; tl: string }> = [
  { kind: 'QUEUE_CONFLICT', rule: 'Rule 5.3', en: 'Queue conflict: Available in the app while queued at the terminal', tl: 'Queue conflict: Available sa app habang nakapila sa terminal' },
  { kind: 'AVAILABILITY_VIOLATION', rule: 'Rule 5.7', en: 'Availability violation: accepted a booking while carrying other passengers', tl: 'Availability violation: tumanggap ng booking habang may ibang sakay' },
];

/** The flag types a report becomes (admin_review_flag); the strike is issued only when an administrator confirms. */
export const AVAILABILITY_FLAG_TYPES = ['DRIVER_QUEUE_CONFLICT_REPORT', 'DRIVER_AVAILABILITY_VIOLATION_REPORT'] as const;
export const isAvailabilityFlag = (flagType: string): boolean => (AVAILABILITY_FLAG_TYPES as readonly string[]).includes(flagType);

/** report_driver_availability_violation: `bookingId` is the trip a passenger reports (required for a passenger, optional for an administrator) */
export const reportAvailabilityArgs = (driverId: string, kind: AvailabilityKind, bookingId: string | null, description: string) => ({
  p_driver_id: driverId,
  p_kind: kind,
  p_booking_id: bookingId,
  p_description: description.trim(),
});

/** confirm_driver_availability_violation: the strike is recorded under the administrator's name, with this reason */
export const confirmAvailabilityArgs = (flagId: string, reason: string) => ({ p_flag_id: flagId, p_reason: reason.trim() });

/** Why a report cannot be sent yet, or null (the database wants a description of what was observed). */
export function reportProblem(driverId: string | null, description: string): string | null {
  if (!driverId) return 'Choose the driver.';
  if (description.trim().length === 0) return 'Describe what was observed: where, when and what the driver did.';
  return null;
}
