import { Request, Response } from 'express';

/**
 * Driver approval, strikes, suspensions and reactivations are decided by database functions
 * (verify_driver_affiliation, issue_strike, admin_suspend_account, admin_reinstate_account)
 * that verify the signed-in administrator inside the database. These Express routes had no
 * authentication and either wrote with the service-role key or duplicated that logic in
 * memory, so they are permanently disabled. Clients must call the Supabase RPCs instead.
 */
export function forbidDirectAccountAction(_req: Request, res: Response): void {
  res.status(403).json({
    success: false,
    error:
      'This endpoint is disabled. Driver approval, strikes, suspensions and reinstatements are enforced by database functions that require an authenticated administrator.',
  });
}

/**
 * Fare rule changes (Rule 6.3) are made only by the LGU Administrator, through public.enact_fare_matrix(), which
 * checks the caller inside the database, refuses back-dating, serialises concurrent changes and writes the audit
 * entry. The Express fare route had no authentication, wrote with the service-role key and deactivated the live
 * rule before inserting, so it is permanently disabled. Clients call the Supabase function instead.
 */
export function forbidDirectFareChange(_req: Request, res: Response): void {
  res.status(403).json({
    success: false,
    error:
      'This endpoint is disabled. Fare rules are changed only by the LGU Administrator through the database function public.enact_fare_matrix.',
  });
}

/**
 * The audit log is written by the database: every decision function writes its own entry (actor from the signed-in account, before / after, reason, the server's
 * time) in the same transaction, and the portals read it through get_audit_log(). This route took the actor's name from the request body, wrote with the
 * service-role key (no actor columns) and served invented sample entries when the table was empty, so it is permanently disabled (Rule 28.4, Batch 12).
 */
export function forbidDirectAuditAccess(_req: Request, res: Response): void {
  res.status(403).json({
    success: false,
    error: 'This endpoint is disabled. The audit log is written by the database functions that make each decision and is read through get_audit_log().',
  });
}

/**
 * Approving, returning or declining a TODA application is decided by the database functions approve_toda_accreditation, return_toda_accreditation and
 * deactivate_toda_accreditation, which check that the caller is the LGU Administrator and write the audit entry in the same transaction. These Express routes took
 * the actor's name from the request body, wrote with the service-role key, made up a certificate number and wrote no actor, so they are permanently disabled (Batch 12).
 */
export function forbidDirectTodaDecision(_req: Request, res: Response): void {
  res.status(403).json({
    success: false,
    error: 'This endpoint is disabled. TODA accreditation decisions are made by the database functions approve_toda_accreditation, return_toda_accreditation and deactivate_toda_accreditation.',
  });
}
