import { Router } from 'express';
import { forbidDirectAuditAccess } from './disabledEndpoints';

/**
 * The audit log (Rule 28.4) is append-only and belongs to the database: every decision function writes its own entry (the signed-in actor, before / after, reason,
 * the server's time) and the portals read it through get_audit_log() and export it through record_audit_export().
 *
 * This route used to hold an in-memory ledger of invented sample entries (served whenever the table was empty), and to accept an entry whose actor name came from the
 * request body and which was written with the service-role key, with no actor columns. Both are gone (Batch 12): every method answers 403. The file is kept so the
 * mount in app.ts stays; do not add a handler here.
 */
const router = Router();

router.use(forbidDirectAuditAccess);

export default router;
