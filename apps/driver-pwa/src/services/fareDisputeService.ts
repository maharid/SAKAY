import { addFareDisputeStatement, asCaseEvidenceClient, fetchOwnFareDisputes, signCaseEvidence } from '@sakay/shared';
import type { CaseEvidenceFile, OwnFareDispute } from '@sakay/shared';

import { supabase } from './supabaseClient';

// Rules 18.4, 13.5 and 18.6: the driver reads the fare cases about his own trips and adds information (words and up to three photos) while a case is open. The
// database decides who may add what (a party to the dispute, while it is not decided) and who may open a photo (the sender, the LGU, the TODA Administrator who reviews
// the case); the calls are shared with the Passenger app (packages/shared/src/utils/caseEvidence.ts).

/** The fare cases of this person's own trips, newest first (null when they could not be read). */
export const fetchMyFareDisputes = (): Promise<OwnFareDispute[] | null> => fetchOwnFareDisputes(asCaseEvidenceClient(supabase));

/** Adds a statement with up to three photos; resolves to null when it worked, else to the sentence to show. */
export const addMyFareStatement = (disputeId: string, text: string, files: File[]): Promise<string | null> =>
  addFareDisputeStatement(asCaseEvidenceClient(supabase), disputeId, text, files);

/** Links for the photos this person sent (Storage signs only what the person may read). */
export const signMyFareEvidence = (paths: string[]): Promise<CaseEvidenceFile[]> => signCaseEvidence(supabase, paths);
