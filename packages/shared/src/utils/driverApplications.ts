import { adminActionMessage } from './tripReconciliation';

/**
 * Rule 3.9: a driver whose application was REJECTED may apply again only after the grounds were resolved, unless the applicant was permanently disqualified. Both are
 * the LGU Administrator's, audited and with a reason of at least 10 characters:
 *   * allow_driver_reapplication(affiliation, reason)   an application that was rejected goes back to review (never for a permanently disqualified driver)
 *   * permanently_disqualify_driver(driver, reason)     the applicant can never be cleared again; the account is Rejected and Offline
 * These functions answer { success, error } instead of raising, so the answer is read here. The DATABASE decides everything; this carries the arguments and the
 * check of the reason, so a short reason shows before anything is sent (scripts/db-tests/batch1/driver-applications-client-contract.js runs it against the database).
 */

export const MIN_APPLICATION_REASON_LENGTH = 10;

export const allowReapplicationArgs = (affiliationId: string, reason: string) => ({ p_affiliation_id: affiliationId, p_reason: reason.trim() });
export const disqualifyDriverArgs = (driverId: string, reason: string) => ({ p_driver_id: driverId, p_reason: reason.trim() });

/** Why the reason cannot be sent yet, or null. */
export function applicationReasonProblem(reason: string): string | null {
  return reason.trim().length < MIN_APPLICATION_REASON_LENGTH ? `Write the reason (at least ${MIN_APPLICATION_REASON_LENGTH} characters): it is kept in the audit log.` : null;
}

/** The part of a Supabase client these calls need. */
export interface ApplicationRpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** Reads { success, error }: null when it worked, otherwise the sentence to show (the database's, without its code). */
function outcome(res: { data: unknown; error: { message: string } | null }, fallback: string): string | null {
  if (res.error) return adminActionMessage(res.error.message, fallback);
  const d = res.data as { success?: boolean; error?: string } | null;
  if (d && d.success === true) return null;
  return adminActionMessage(d?.error, fallback);
}

export async function allowDriverReapplication(client: ApplicationRpcClient, affiliationId: string, reason: string): Promise<string | null> {
  return outcome(await client.rpc('allow_driver_reapplication', allowReapplicationArgs(affiliationId, reason)), 'Re-application could not be allowed.');
}

export async function permanentlyDisqualifyDriver(client: ApplicationRpcClient, driverId: string, reason: string): Promise<string | null> {
  return outcome(await client.rpc('permanently_disqualify_driver', disqualifyDriverArgs(driverId, reason)), 'The driver could not be disqualified.');
}
