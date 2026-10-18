import { adminActionMessage } from './tripReconciliation';
import { reportNetworkOutcome } from '../hooks/useConnectionStatus';

/**
 * Rule 29.18: a driver may use another vehicle only with the approval of the TODA Administrator AND the LGU Administrator, in that order, for 1 to 7 days. This is
 * the driver's request, the two administrators' decisions, ending a substitution early, and the same checks the database makes before a request (so a mistake shows
 * before anything is sent), for the Driver app and both portals. The DATABASE decides who may do what, changes the driver's plate and franchise number while the
 * substitution is active, puts the registered vehicle back when it ends, writes the audit entry and tells the driver
 * (scripts/db-tests/batch4/vehicle-substitution-client-contract.js proves the arguments and the checks against the real functions).
 */

export const SUBSTITUTION_MAX_DAYS = 7;
export const MIN_SUBSTITUTION_REASON_LENGTH = 10;
export const MIN_SUBSTITUTION_NOTE_LENGTH = 5;

export type SubstitutionStatus = 'Pending TODA Approval' | 'Pending LGU Approval' | 'Active' | 'Ended' | 'Denied' | 'Withdrawn';

export interface VehicleSubstitution {
  substitutionId: string;
  driverId: string;
  driverName: string;
  todaId: string | null;
  substitutePlate: string;
  substituteFranchise: string;
  reason: string;
  requestedDays: number;
  status: SubstitutionStatus;
  originalPlate: string | null;
  originalFranchise: string | null;
  todaNote: string | null;
  lguNote: string | null;
  deniedByRole: string | null;
  denialReason: string | null;
  activatedAt: string | null;
  endsAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  createdAt: string;
}

export const isOpenSubstitution = (s: SubstitutionStatus): boolean => s === 'Pending TODA Approval' || s === 'Pending LGU Approval' || s === 'Active';

// ── call arguments ───────────────────────────────────────────────────────────

export const requestSubstitutionArgs = (plate: string, franchise: string, reason: string, days: number) => ({
  p_plate: plate.trim(),
  p_franchise: franchise.trim(),
  p_reason: reason.trim(),
  p_days: days,
});
export const decideSubstitutionArgs = (id: string, approve: boolean, note: string) => ({ p_id: id, p_approve: approve, p_note: note.trim() });
export const endSubstitutionArgs = (id: string, reason: string) => ({ p_id: id, p_reason: reason.trim() });
export const withdrawSubstitutionArgs = (id: string) => ({ p_id: id });

// ── checks before sending (the database checks again) ────────────────────────

/** Why a request cannot be sent yet, or null. Same limits as request_vehicle_substitution. */
export function substitutionRequestProblem(input: { plate: string; franchise: string; reason: string; days: number | null; registeredPlate: string | null }): string | null {
  const plate = input.plate.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 -]{2,19}$/.test(plate)) return 'Enter the plate number of the vehicle you want to use (letters, numbers, space or dash).';
  if (input.franchise.trim().length < 2) return 'Enter the franchise (MTOP) number of the vehicle you want to use.';
  if (input.reason.trim().length < MIN_SUBSTITUTION_REASON_LENGTH) return `Say why you need another vehicle (at least ${MIN_SUBSTITUTION_REASON_LENGTH} characters).`;
  if (input.days === null || !Number.isInteger(input.days) || input.days < 1 || input.days > SUBSTITUTION_MAX_DAYS) return `A substitute vehicle can be approved for 1 to ${SUBSTITUTION_MAX_DAYS} days.`;
  if ((input.registeredPlate ?? '').trim().toUpperCase() === plate) return 'That is already your registered vehicle.';
  return null;
}

/** Why a decision cannot be sent yet, or null: denying needs the reason (the driver is told); approving may carry a note. */
export function substitutionDecisionProblem(approve: boolean | null, note: string): string | null {
  if (approve === null) return 'Approve or deny the request.';
  if (!approve && note.trim().length < MIN_SUBSTITUTION_NOTE_LENGTH) return 'Give the reason for denying: the driver is told.';
  return null;
}

// ── reading and calling ──────────────────────────────────────────────────────

/** The part of a Supabase client these calls need. */
export interface SubstitutionClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from(table: string): {
    select(columns: string): {
      order(column: string, opts: { ascending: boolean }): {
        limit(n: number): PromiseLike<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>;
      };
      in(column: string, values: string[]): PromiseLike<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>;
    };
  };
}

/**
 * A Supabase client as these calls use it. (Checking the real client against the shape above makes the compiler's generics run away, so the apps say "this is such a
 * client" once, here; scripts/db-tests/batch4/vehicle-substitution-client-contract.js runs these calls against the database.)
 */
export const asSubstitutionClient = (client: unknown): SubstitutionClient => client as SubstitutionClient;

const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** The substitutions the signed-in person may see (the driver's own, a TODA Administrator's drivers', all for the LGU), newest first; null when they could not be read. */
export async function fetchVehicleSubstitutions(client: SubstitutionClient): Promise<VehicleSubstitution[] | null> {
  const { data, error } = await client.from('vehicle_substitution').select('*').order('created_at', { ascending: false }).limit(200);
  reportNetworkOutcome(error);
  if (error || !data) return null;
  const ids = [...new Set(data.map((r) => String(r.driver_id)))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: drivers } = await client.from('driver').select('driver_id, full_name').in('driver_id', ids);
    for (const d of drivers ?? []) names.set(String(d.driver_id), String(d.full_name ?? 'Driver'));
  }
  return data.map((r) => ({
    substitutionId: String(r.substitution_id),
    driverId: String(r.driver_id),
    driverName: names.get(String(r.driver_id)) ?? 'Driver',
    todaId: text(r.toda_id),
    substitutePlate: String(r.substitute_plate),
    substituteFranchise: String(r.substitute_franchise),
    reason: String(r.reason ?? ''),
    requestedDays: Number(r.requested_days),
    status: String(r.status) as SubstitutionStatus,
    originalPlate: text(r.original_plate),
    originalFranchise: text(r.original_franchise),
    todaNote: text(r.toda_decision_note),
    lguNote: text(r.lgu_decision_note),
    deniedByRole: text(r.denied_by_role),
    denialReason: text(r.denial_reason),
    activatedAt: text(r.activated_at),
    endsAt: text(r.ends_at),
    endedAt: text(r.ended_at),
    endReason: text(r.end_reason),
    createdAt: String(r.created_at),
  }));
}

async function call(client: SubstitutionClient, fn: string, args: Record<string, unknown>, fallback: string): Promise<string | null> {
  const { error } = await client.rpc(fn, args);
  reportNetworkOutcome(error);
  return error ? adminActionMessage(error.message, fallback) : null;
}

/** The driver asks. Null when it was sent, otherwise the database's sentence (shown as it is). */
export const requestVehicleSubstitution = (client: SubstitutionClient, plate: string, franchise: string, reason: string, days: number) =>
  call(client, 'request_vehicle_substitution', requestSubstitutionArgs(plate, franchise, reason, days), 'The request could not be sent.');

/** The TODA Administrator (first) or the LGU Administrator (then) decides. */
export const decideVehicleSubstitution = (client: SubstitutionClient, role: 'toda_admin' | 'lgu_admin', id: string, approve: boolean, note: string) =>
  call(client, role === 'toda_admin' ? 'decide_vehicle_substitution_toda' : 'decide_vehicle_substitution_lgu', decideSubstitutionArgs(id, approve, note), 'The decision could not be recorded.');

/** An administrator, or the driver, ends an active substitution early: the registered vehicle is put back. */
export const endVehicleSubstitution = (client: SubstitutionClient, id: string, reason: string) =>
  call(client, 'end_vehicle_substitution', endSubstitutionArgs(id, reason), 'The substitution could not be ended.');

/** The driver withdraws a request that is still waiting. */
export const withdrawVehicleSubstitution = (client: SubstitutionClient, id: string) =>
  call(client, 'withdraw_vehicle_substitution', withdrawSubstitutionArgs(id), 'The request could not be withdrawn.');
