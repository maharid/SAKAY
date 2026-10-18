/**
 * Photos for an appeal (Rule 25.2) and for a statement in a fare dispute (Rule 18.4).
 *
 * The photos go to the private bucket below, inside the sender's own folder "<auth uid>/<time>-<n>.<jpg|png|webp>" (the same limits as an incident report's photos: at most 3,
 * 5 MB each). The database keeps only the PATHS: in exemption_request.evidence_urls for an appeal, in fare_dispute_note.evidence_paths for a statement. Who may open a photo is
 * decided by the storage policies (the sender, the LGU Administrator, and the TODA Administrator who reviews the case; migration 20261028000006), never by this file: it only asks
 * Storage for short-lived signed links.
 * scripts/db-tests/batch9/case-evidence.js and case-evidence-client-contract.js run this against the database.
 */
import { uploadEvidenceFilesTo, evidenceFileProblem, INCIDENT_EVIDENCE_MAX_FILES } from './incidentReports';
import type { IncidentUploadClient } from './incidentReports';
import { signedStorageUrl, SIGNED_URL_TTL } from './storageUrls';
import type { StorageCapableClient } from './storageUrls';
import { callRpc } from './tripEnd';
import type { TripEndResult } from './tripEnd';
import { reportNetworkOutcome } from '../hooks/useConnectionStatus';
import type { RpcCapableClient } from './restrictionUtils';

export const CASE_EVIDENCE_BUCKET = 'case-evidence';
export const CASE_EVIDENCE_MAX_FILES = INCIDENT_EVIDENCE_MAX_FILES;

/** Uploads up to three photos for an appeal or a statement and returns their paths. Throws an Error whose message (Filipino, then English) can be shown as it is. */
export const uploadCaseEvidenceFiles = (client: IncidentUploadClient, files: File[]): Promise<string[]> => uploadEvidenceFilesTo(CASE_EVIDENCE_BUCKET, client, files);

/** Why this set of photos cannot be sent yet (Filipino, then English), or null: the same checks the upload makes, so a bad photo shows before anything is sent. */
export function caseEvidenceProblem(files: Array<{ type: string; size: number }>): string | null {
  if (files.length > CASE_EVIDENCE_MAX_FILES) return `Hanggang ${CASE_EVIDENCE_MAX_FILES} larawan lamang. (At most ${CASE_EVIDENCE_MAX_FILES} photos.)`;
  for (const file of files) {
    const problem = evidenceFileProblem(file);
    if (problem) return problem;
  }
  return null;
}

export interface CaseEvidenceFile {
  name: string;
  type: 'image';
  url: string;
}

/**
 * The photos of one case as openable links. A photo the signed-in user may not read, or that no longer exists, is left out. An older appeal may hold a plain link instead of
 * a path: it is returned as it is (signedStorageUrl passes a link that is not a storage address through).
 */
export async function signCaseEvidence(client: StorageCapableClient, paths?: Array<string | null | undefined> | null): Promise<CaseEvidenceFile[]> {
  const files: CaseEvidenceFile[] = [];
  for (const path of paths ?? []) {
    if (!path) continue;
    const url = await signedStorageUrl(client, CASE_EVIDENCE_BUCKET, path, SIGNED_URL_TTL.document);
    if (url) files.push({ name: path.split('/').pop() || 'photo', type: 'image', url });
  }
  return files;
}

// ---- a statement in a fare dispute (Rule 18.4) ----------------------------------------------------------------------------------------------------

export const FARE_STATEMENT_MIN = 3;
export const FARE_STATEMENT_MAX = 1000;

export const fareStatementArgs = (disputeId: string, text: string, evidencePaths: string[] = []) => ({
  p_dispute_id: disputeId,
  p_text: text.trim(),
  p_evidence_paths: evidencePaths,
});

/** Why the words cannot be sent yet, or null (the database checks again). */
export function fareStatementProblem(text: string): string | null {
  const n = text.trim().length;
  if (n < FARE_STATEMENT_MIN || n > FARE_STATEMENT_MAX) return `Isulat ang impormasyon (${FARE_STATEMENT_MIN} hanggang ${FARE_STATEMENT_MAX} titik). (Write the information: ${FARE_STATEMENT_MIN} to ${FARE_STATEMENT_MAX} characters.)`;
  return null;
}

/**
 * Adds a statement, with up to three photos, to a fare dispute the signed-in person is a party to. The photos are uploaded first; if the database then refuses the statement,
 * they stay in the sender's own folder, where only the sender and the LGU can see them. Resolves to null when it worked, otherwise to the sentence to show.
 */
export async function addFareDisputeStatement(
  client: RpcCapableClient & IncidentUploadClient,
  disputeId: string,
  text: string,
  files: File[] = []
): Promise<string | null> {
  const textProblem = fareStatementProblem(text);
  if (textProblem) return textProblem;
  const photoProblem = caseEvidenceProblem(files);
  if (photoProblem) return photoProblem;
  let paths: string[] = [];
  try {
    paths = await uploadCaseEvidenceFiles(client, files);
  } catch (e) {
    return e instanceof Error ? e.message : 'Hindi na-upload ang larawan. (The photo could not be uploaded.)';
  }
  const r: TripEndResult = await callRpc(client, 'submit_fare_dispute_statement', fareStatementArgs(disputeId, text, paths));
  return r.ok ? null : r.error ?? 'Hindi naidagdag ang impormasyon. (The information could not be added.)';
}

// ---- a person's own disputes (the driver's and the passenger's list) ----------------------------------------------------------------------------

export interface OwnFareDisputeNote {
  party: string;
  note: string;
  createdAt: string;
  evidencePaths: string[];
}

export interface OwnFareDispute {
  disputeId: string;
  bookingId: string;
  kind: string;
  status: 'Open' | 'Escalated' | 'Resolved';
  openedBy: string;
  claimedAmount: number | null;
  systemFare: number | null;
  resolvedFare: number | null;
  outcome: string | null;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
  pickup: string | null;
  dropoff: string | null;
  notes: OwnFareDisputeNote[];
}

/** The part of a Supabase client the list needs: the select / order / limit / in the screens make (row security shows a person only the disputes of their own trips). */
export interface DisputeReadClient {
  from(table: string): {
    select(columns: string): {
      order(column: string, options: { ascending: boolean }): { limit(n: number): PromiseLike<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }> };
      in(column: string, values: string[]): PromiseLike<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>;
    };
  };
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** The disputes about the signed-in person's own trips, newest first, each with its statements and the trip's addresses; null when they could not be read. */
export async function fetchOwnFareDisputes(client: DisputeReadClient): Promise<OwnFareDispute[] | null> {
  const disputes = await client
    .from('fare_dispute')
    .select('dispute_id, booking_id, kind, status, opened_by, claimed_amount, system_fare, resolved_fare, outcome, resolution_note, created_at, resolved_at')
    .order('created_at', { ascending: false })
    .limit(50);
  reportNetworkOutcome(disputes.error);
  if (disputes.error || !disputes.data) return null;
  if (disputes.data.length === 0) return [];
  const ids = disputes.data.map((d) => String(d.dispute_id));
  const bookingIds = [...new Set(disputes.data.map((d) => String(d.booking_id)))];
  const [notes, trips] = await Promise.all([
    client.from('fare_dispute_note').select('dispute_id, party, note, created_at, evidence_paths').in('dispute_id', ids),
    client.from('booking').select('booking_id, pickup_address, dropoff_address').in('booking_id', bookingIds),
  ]);
  const tripOf = new Map((trips.data ?? []).map((b) => [String(b.booking_id), b]));
  return disputes.data.map((d) => {
    const trip = tripOf.get(String(d.booking_id));
    return {
      disputeId: String(d.dispute_id),
      bookingId: String(d.booking_id),
      kind: String(d.kind),
      status: String(d.status) as OwnFareDispute['status'],
      openedBy: String(d.opened_by),
      claimedAmount: num(d.claimed_amount),
      systemFare: num(d.system_fare),
      resolvedFare: num(d.resolved_fare),
      outcome: d.outcome ? String(d.outcome) : null,
      resolutionNote: d.resolution_note ? String(d.resolution_note) : null,
      createdAt: String(d.created_at),
      resolvedAt: d.resolved_at ? String(d.resolved_at) : null,
      pickup: trip?.pickup_address ? String(trip.pickup_address) : null,
      dropoff: trip?.dropoff_address ? String(trip.dropoff_address) : null,
      notes: (notes.data ?? [])
        .filter((n) => String(n.dispute_id) === String(d.dispute_id))
        .map((n) => ({
          party: String(n.party),
          note: String(n.note),
          createdAt: String(n.created_at),
          evidencePaths: Array.isArray(n.evidence_paths) ? (n.evidence_paths as unknown[]).map(String) : [],
        }))
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    };
  });
}

/** The apps hand over their typed Supabase client through this cast (the library's own types are too deep for the structural ones above: TS2589). */
export const asCaseEvidenceClient = (client: unknown) => client as DisputeReadClient & RpcCapableClient & IncidentUploadClient & StorageCapableClient;
