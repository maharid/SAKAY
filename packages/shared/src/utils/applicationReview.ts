/**
 * Return for correction, as the apps see it (Rules 3.6, 3.8; database: 20261010000001_document_returns_and_resubmission.sql).
 *
 * Documents are shared per driver, but the REVIEW is per affiliation (one application per TODA): the database answers, for every
 * affiliation and every document, whether THAT review returned it, whether it has been replaced since, or whether the document is flagged /
 * was replaced because of another TODA's review. This file turns that answer into what a screen says, in one place, so the Driver app
 * and the tests agree. It has no dependencies and uses no browser API.
 */

export type ReviewDocumentType = 'license' | 'mtop' | 'tricycle' | 'selfie';

export const REVIEW_DOCUMENT_ORDER: ReviewDocumentType[] = ['license', 'mtop', 'tricycle', 'selfie'];

export type ReviewDocumentState = 'returned' | 'resubmitted' | 'returned_elsewhere' | 'replaced_elsewhere' | 'not_returned';

/** The preset reasons of a return. The free-text reason is always required as well. */
export type ReturnReasonCode = 'blurry' | 'expired' | 'mismatch' | 'wrong_document' | 'incomplete' | 'other';

export const RETURN_REASON_CODES: ReturnReasonCode[] = ['blurry', 'expired', 'mismatch', 'wrong_document', 'incomplete', 'other'];

export interface ApplicationReviewDocument {
  document_type: ReviewDocumentType;
  state: ReviewDocumentState;
  reason_code?: ReturnReasonCode | null;
  reason?: string | null;
  returned_at?: string | null;
  returned_by_stage?: 'TODA' | 'LGU' | null;
  resubmitted_at?: string | null;
}

export type TodaStageValue = 'Submitted' | 'Endorsed' | 'Resubmission Required' | 'Rejected';
export type LguStageValue = 'Pending' | 'Approved' | 'Resubmission Required' | 'Rejected';

export interface ApplicationReviewAffiliation {
  affiliation_id: string;
  toda_id: string;
  toda_name?: string | null;
  toda_acronym?: string | null;
  toda_stage: TodaStageValue;
  lgu_stage: LguStageValue;
  is_active?: boolean;
  submitted_at?: string | null;
  /** Set each time the driver resubmits: the 5-calendar-day review clock restarts here (Rule 3.6). */
  resubmitted_at?: string | null;
  /** The free text of a return made BEFORE documents were named (kept so such an application can still be answered). */
  toda_return_reason?: string | null;
  lgu_return_reason?: string | null;
  documents: ApplicationReviewDocument[];
}

export type ApplicationStatusKind =
  | 'resubmission_required'        // at least one affiliation is waiting for the driver to replace documents
  | 'resubmitted_awaiting_toda'    // the driver resubmitted; the TODA has not decided yet
  | 'resubmitted_awaiting_lgu'     // the driver resubmitted an LGU return; the LGU has not decided yet
  | 'endorsed_awaiting_lgu'        // the TODA endorsed; the LGU has not decided yet
  | 'under_review';                // nothing special: a first submission waiting for its TODA

export interface ReturnedDocumentNotice {
  affiliation_id: string;
  toda_acronym: string;
  stage: 'TODA' | 'LGU';
  document_type: ReviewDocumentType;
  reason_code: ReturnReasonCode | null;
  reason: string;
  returned_at: string | null;
  /** True for a return that named no document (made before documents were tracked): the licence is asked for, as it always was. */
  legacy?: boolean;
}

export interface ResubmittedDocumentNotice {
  affiliation_id: string;
  toda_acronym: string;
  document_type: ReviewDocumentType;
  resubmitted_at: string | null;
}

export interface ApplicationStatus {
  kind: ApplicationStatusKind;
  /** The documents the driver must replace NOW (state "returned"), in document order, with who returned them and why. */
  returnedDocuments: ReturnedDocumentNotice[];
  /** The distinct documents to ask for (what the correction flow walks through). */
  documentsToResubmit: ReviewDocumentType[];
  /** For the "resubmitted, awaiting review" screens: when, and which documents were replaced. */
  resubmittedAt: string | null;
  resubmittedDocuments: ResubmittedDocumentNotice[];
  /** Per document, for the affiliation the screen is about; every document is listed. */
  documentStates: Record<ReviewDocumentType, ReviewDocumentState>;
  /** The affiliations the headline is about. */
  affiliationIds: string[];
}

const orderOf = (t: ReviewDocumentType): number => REVIEW_DOCUMENT_ORDER.indexOf(t);

const acronymOf = (a: ApplicationReviewAffiliation): string => a.toda_acronym || a.toda_name || 'TODA';

const emptyStates = (): Record<ReviewDocumentType, ReviewDocumentState> => ({
  license: 'not_returned',
  mtop: 'not_returned',
  tricycle: 'not_returned',
  selfie: 'not_returned',
});

const newestFirst = (a: string | null | undefined, b: string | null | undefined): number =>
  new Date(b || 0).getTime() - new Date(a || 0).getTime();

/**
 * What the Driver app's status screen should say. It never says the documents passed: "resubmitted" means "waiting for the reviewer",
 * and only an endorsement (TODA) or an approval (LGU) moves the application on.
 *
 * Priority: an affiliation waiting for the DRIVER comes first (the driver has something to do), then a resubmission waiting for the
 * TODA, then one waiting for the LGU, then an endorsed application waiting for the LGU, then a plain review.
 */
export function classifyApplication(affiliations: ApplicationReviewAffiliation[]): ApplicationStatus {
  const live = affiliations.filter((a) => a.toda_stage !== 'Rejected' && a.lgu_stage !== 'Rejected' && a.lgu_stage !== 'Approved');

  const waitingForDriver = live.filter((a) => a.toda_stage === 'Resubmission Required' || a.lgu_stage === 'Resubmission Required');
  if (waitingForDriver.length > 0) {
    const returnedDocuments: ReturnedDocumentNotice[] = [];
    const documentStates = emptyStates();
    for (const a of waitingForDriver) {
      if (!a.documents.some((d) => d.state === 'returned')) {
        // returned before documents were named: nothing says which, so the licence is asked for (what the app always did) and the
        // reviewer's own words are shown
        const stage = a.toda_stage === 'Resubmission Required' ? 'TODA' : 'LGU';
        documentStates.license = 'returned';
        returnedDocuments.push({
          affiliation_id: a.affiliation_id,
          toda_acronym: acronymOf(a),
          stage,
          document_type: 'license',
          reason_code: null,
          reason: (stage === 'TODA' ? a.toda_return_reason : a.lgu_return_reason) || '',
          returned_at: null,
          legacy: true,
        });
        continue;
      }
      for (const d of a.documents) {
        if (d.state !== 'returned') continue;
        documentStates[d.document_type] = 'returned';
        returnedDocuments.push({
          affiliation_id: a.affiliation_id,
          toda_acronym: acronymOf(a),
          stage: d.returned_by_stage === 'LGU' ? 'LGU' : 'TODA',
          document_type: d.document_type,
          reason_code: d.reason_code ?? null,
          reason: d.reason ?? '',
          returned_at: d.returned_at ?? null,
        });
      }
    }
    returnedDocuments.sort((x, y) => orderOf(x.document_type) - orderOf(y.document_type));
    return {
      kind: 'resubmission_required',
      returnedDocuments,
      documentsToResubmit: Array.from(new Set(returnedDocuments.map((d) => d.document_type))).sort((x, y) => orderOf(x) - orderOf(y)),
      resubmittedAt: null,
      resubmittedDocuments: [],
      documentStates,
      affiliationIds: waitingForDriver.map((a) => a.affiliation_id),
    };
  }

  const resubmitted = (stageIsToda: boolean) =>
    live
      .filter((a) =>
        stageIsToda
          ? a.toda_stage === 'Submitted' && Boolean(a.resubmitted_at)
          : // resubmitted_at also holds the date of an earlier TODA-stage resubmission, so it is an LGU resubmission only when the
            // latest return was the LGU's and its documents were replaced
            a.toda_stage === 'Endorsed' && a.lgu_stage === 'Pending' && Boolean(a.resubmitted_at)
            && a.documents.some((d) => d.state === 'resubmitted' && d.returned_by_stage === 'LGU')
      )
      .sort((x, y) => newestFirst(x.resubmitted_at, y.resubmitted_at));

  for (const [kind, list] of [
    ['resubmitted_awaiting_toda', resubmitted(true)],
    ['resubmitted_awaiting_lgu', resubmitted(false)],
  ] as const) {
    if (list.length === 0) continue;
    const head = list[0];
    const documentStates = emptyStates();
    const resubmittedDocuments: ResubmittedDocumentNotice[] = [];
    for (const d of head.documents) {
      documentStates[d.document_type] = d.state;
      if (d.state === 'resubmitted') {
        resubmittedDocuments.push({
          affiliation_id: head.affiliation_id,
          toda_acronym: acronymOf(head),
          document_type: d.document_type,
          resubmitted_at: d.resubmitted_at ?? null,
        });
      }
    }
    resubmittedDocuments.sort((x, y) => orderOf(x.document_type) - orderOf(y.document_type));
    return {
      kind,
      returnedDocuments: [],
      documentsToResubmit: [],
      resubmittedAt: head.resubmitted_at ?? null,
      resubmittedDocuments,
      documentStates,
      affiliationIds: list.map((a) => a.affiliation_id),
    };
  }

  const endorsed = live.filter((a) => a.toda_stage === 'Endorsed' && a.lgu_stage === 'Pending');
  return {
    kind: endorsed.length > 0 ? 'endorsed_awaiting_lgu' : 'under_review',
    returnedDocuments: [],
    documentsToResubmit: [],
    resubmittedAt: null,
    resubmittedDocuments: [],
    documentStates: emptyStates(),
    affiliationIds: (endorsed.length > 0 ? endorsed : live).map((a) => a.affiliation_id),
  };
}

/** English labels, shared by every screen. (Tagalog lives with each app's own translations.) */
export const REVIEW_DOCUMENT_LABEL: Record<ReviewDocumentType, string> = {
  license: "Driver's License",
  mtop: 'MTOP',
  tricycle: 'Tricycle photo',
  selfie: 'Selfie / face photo',
};

export const RETURN_REASON_LABEL: Record<ReturnReasonCode, string> = {
  blurry: 'Blurry / hard to read',
  expired: 'Expired',
  mismatch: 'Information does not match',
  wrong_document: 'Wrong document',
  incomplete: 'Incomplete',
  other: 'Other',
};

/**
 * Permanent rejection (Rule 3.8). Rejecting is FINAL: the applicant cannot re-apply to that TODA. It is only for these grounds; a
 * document that can be fixed is RETURNED for correction instead. The codes are what the database stores
 * (reject_driver_affiliation, 20261010000003); 'ineligible' and 'fraudulent' are the two the LGU Portal has always used.
 */
export type RejectionReasonCode =
  | 'fraudulent'
  | 'license_mtop_revoked'
  | 'ineligible'
  | 'duplicate_identity'
  | 'failed_background_check';

export const REJECTION_REASON_CODES: RejectionReasonCode[] = [
  'fraudulent',
  'license_mtop_revoked',
  'ineligible',
  'duplicate_identity',
  'failed_background_check',
];

export const REJECTION_REASON_LABEL: Record<RejectionReasonCode, string> = {
  fraudulent: 'Fraudulent or falsified documents',
  license_mtop_revoked: 'License or MTOP revoked',
  ineligible: 'Not eligible for this TODA',
  duplicate_identity: 'Duplicate identity',
  failed_background_check: 'Failed LGU background check',
};

export const REJECTION_REASON_LABEL_TL: Record<RejectionReasonCode, string> = {
  fraudulent: 'Pekeng o binagong dokumento',
  license_mtop_revoked: 'Binawi ang lisensya o MTOP',
  ineligible: 'Hindi kwalipikado sa TODA na ito',
  duplicate_identity: 'Doble ang pagkakakilanlan',
  failed_background_check: 'Hindi pumasa sa background check ng LGU',
};

export const isRejectionReasonCode = (value: unknown): value is RejectionReasonCode =>
  typeof value === 'string' && (REJECTION_REASON_CODES as string[]).includes(value);

/**
 * What a screen shows for a stored rejection reason. The database keeps the code (`fraudulent`), sometimes with the note after it
 * (`fraudulent: the note`); an older rejection may hold free text. A known code becomes its label (and the note, if any, is returned
 * separately); anything else is shown as it is.
 */
export function rejectionReasonParts(stored: string | null | undefined, language: 'en' | 'tl' = 'en'): { label: string; note: string } {
  const text = (stored || '').trim();
  if (!text) return { label: '', note: '' };
  const colon = text.indexOf(':');
  const code = (colon >= 0 ? text.slice(0, colon) : text).trim();
  if (isRejectionReasonCode(code)) {
    return { label: (language === 'tl' ? REJECTION_REASON_LABEL_TL : REJECTION_REASON_LABEL)[code], note: colon >= 0 ? text.slice(colon + 1).trim() : '' };
  }
  return { label: text, note: '' };
}

/** Just the label of a stored rejection reason (see rejectionReasonParts). */
export const rejectionReasonLabel = (stored: string | null | undefined, language: 'en' | 'tl' = 'en'): string =>
  rejectionReasonParts(stored, language).label;
