/**
 * Filing an incident report, the part both apps share: the photo (optional evidence, Section 19.2).
 *
 * A report is always about a TRIP the reporter took part in. Who the reporter is (passenger or driver), the driver, the TODA and the starting
 * status are decided by the database from the booking and the signed-in user (migration 20261012000001, incident_report_guard), so neither app
 * sends them. The photo goes to the private bucket under the reporter's own folder; the report keeps only its storage path.
 */
import { INCIDENT_EVIDENCE_BUCKET } from './incidentEvidence';
import { ownedObjectPath } from './storageUrls';

/**
 * Rule 16.5 (decision D9-12, provisional until Batch 11 defines the emergency incidents): a report is made after the trip is completed, EXCEPT these
 * categories, which may be reported while the trip is still in progress. incident_report_guard (migration 20261024000001) holds the same list.
 */
export const EMERGENCY_INCIDENT_CATEGORIES = ['Emergency', 'Safety Concern', 'Accident'] as const;
export const isEmergencyIncident = (category: string): boolean => (EMERGENCY_INCIDENT_CATEGORIES as readonly string[]).includes(category);

/** The photo limit the screens apply. The database separately refuses more than 3 files or a file outside the reporter's folder. */
export const INCIDENT_EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;

/** The part of a Supabase client this needs (structural, so the shared package does not depend on the library) */
export interface IncidentUploadClient {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null } }> };
  storage: {
    from(bucket: string): {
      upload(path: string, file: File, options: { contentType: string; upsert: boolean }): Promise<{ error: { message: string } | null }>;
    };
  };
}

/**
 * Uploads the reporter's photo and returns its storage path. Throws an Error whose message (Filipino, then English) can be shown as it is.
 */
export async function uploadIncidentEvidence(client: IncidentUploadClient, file: File): Promise<string> {
  const { data: auth } = await client.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error('Hindi ka naka-login. (You are not signed in.)');
  if (!file.type.startsWith('image/')) throw new Error('Larawan lamang ang tinatanggap. (Only image files are accepted.)');
  if (file.size > INCIDENT_EVIDENCE_MAX_BYTES) throw new Error('Masyadong malaki ang larawan (hanggang 5 MB). (The photo is too large: 5 MB at most.)');
  const path = ownedObjectPath(uid, `${Date.now()}-${file.name}`);
  const { error } = await client.storage.from(INCIDENT_EVIDENCE_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(`Hindi na-upload ang larawan. (The photo could not be uploaded: ${error.message})`);
  return path;
}
