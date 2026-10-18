/**
 * Filing an incident report, the part both apps share: the categories (Rule 19.1 and the ones of Batches 9 and 11), the emergency exception of Rule 16.5, and the
 * photos (optional evidence, Rule 19.2).
 *
 * A report is always about a TRIP the reporter took part in. Who the reporter is (passenger or driver), the driver, the TODA, the routing (Rule 19.3: the driver's TODA
 * Administrator first; Rule 19.8: straight to the LGU Administrator for an assault, harassment, a threat or a crime), the priority, the review clocks and the starting status
 * are decided by the database from the booking, the category and the signed-in user (incident_report_guard), so neither app sends them. The photo goes to the private bucket
 * under the reporter's own folder; the report keeps only its storage path.
 */
import { INCIDENT_EVIDENCE_BUCKET } from './incidentEvidence';
import { ownedObjectPath } from './storageUrls';
import { INCIDENT_EVIDENCE_MAX_BYTES, INCIDENT_EVIDENCE_MAX_FILES, INCIDENT_EVIDENCE_MIME_TYPES } from '../config/policyConfig';

/**
 * What kind of report a category is (the database holds the same list: _incident_category_class(); scripts/db-tests/batch11/config-drift.js keeps both equal):
 *   SERIOUS    alleged assault, harassment, threats or criminal activity - straight to the LGU Administrator (Rule 19.8)
 *   EMERGENCY  an emergency incident - prioritized, no automatic fault (Rules 19.7, 26.2, 26.3, 29.23)
 *   LOST_ITEM  Rule 19.6 - no strike, a TODA-facilitated contact
 *   STANDARD   everything else - the driver's TODA Administrator first (Rule 19.3)
 */
export type IncidentClass = 'SERIOUS' | 'EMERGENCY' | 'LOST_ITEM' | 'STANDARD';
export type IncidentReporter = 'Passenger' | 'Driver';

export interface IncidentCategory {
  /** what the database stores */
  value: string;
  class: IncidentClass;
  tl: string;
  en: string;
  /** who is offered it (decision PI-11K: each party sees the categories that fit its role; the emergency and serious ones are offered to both) */
  by: readonly IncidentReporter[];
}

const BOTH = ['Passenger', 'Driver'] as const;
const PASSENGER = ['Passenger'] as const;
const DRIVER = ['Driver'] as const;

export const INCIDENT_CATEGORIES: readonly IncidentCategory[] = [
  // emergencies: may be filed while the trip is in progress (Rule 16.5)
  { value: 'Emergency', class: 'EMERGENCY', tl: 'Emergency (habang nasa biyahe)', en: 'Emergency (during the trip)', by: BOTH },
  { value: 'Medical Emergency', class: 'EMERGENCY', tl: 'Kailangan ng medikal na tulong', en: 'Medical emergency', by: BOTH },
  { value: 'Safety Concern', class: 'EMERGENCY', tl: 'Alalahanin sa Kaligtasan (habang nasa biyahe)', en: 'Safety Concern (during the trip)', by: BOTH },
  { value: 'Accident', class: 'EMERGENCY', tl: 'Aksidente (habang nasa biyahe)', en: 'Accident (during the trip)', by: BOTH },
  // alleged assault, harassment, threats, crime: straight to the LGU Administrator (Rule 19.8); may be filed during the trip too
  { value: 'Physical Assault', class: 'SERIOUS', tl: 'Pananakit (diretso sa LGU)', en: 'Physical assault (goes straight to the LGU)', by: BOTH },
  { value: 'Harassment', class: 'SERIOUS', tl: 'Panliligalig o harassment (diretso sa LGU)', en: 'Harassment (goes straight to the LGU)', by: BOTH },
  { value: 'Threat', class: 'SERIOUS', tl: 'Pananakot o pagbabanta (diretso sa LGU)', en: 'Threat (goes straight to the LGU)', by: BOTH },
  { value: 'Criminal Activity', class: 'SERIOUS', tl: 'Gawaing kriminal (diretso sa LGU)', en: 'Criminal activity (goes straight to the LGU)', by: BOTH },
  // Rule 27.2 (Batch 12): somebody other than the registered driver at the handlebars - the passenger sees it, the driver cannot report it
  { value: 'Unregistered Person Driving', class: 'SERIOUS', tl: 'Ibang tao ang nagmamaneho (hindi ang rehistradong driver) (diretso sa LGU)', en: 'Someone other than the registered driver is driving (goes straight to the LGU)', by: PASSENGER },
  // after the trip
  { value: 'Overcharging Attempt', class: 'STANDARD', tl: 'Sobra ang singil, o humingi ng paunang bayad o deposito (Rule 6.4)', en: 'Overcharging, or asked for payment in advance, a deposit or an off-app payment (Rule 6.4)', by: PASSENGER },
  { value: 'Rude Behavior', class: 'STANDARD', tl: 'Bastos o Hindi Magalang na Pag-uugali', en: 'Rude Behavior', by: BOTH },
  { value: 'Unsafe Driving', class: 'STANDARD', tl: 'Mapanganib na Pagmamaneho', en: 'Unsafe Driving', by: PASSENGER },
  { value: 'Reckless Driving', class: 'STANDARD', tl: 'Kaskaserong Pagpapatakbo', en: 'Reckless Driving', by: PASSENGER },
  { value: 'Route Deviation', class: 'STANDARD', tl: 'Paglihis sa Karaniwang Ruta', en: 'Route Deviation', by: PASSENGER },
  { value: 'Passenger Misconduct', class: 'STANDARD', tl: 'Hindi Angkop na Asal ng Pasahero', en: 'Passenger Misconduct (including damage or contamination of the vehicle)', by: DRIVER },
  { value: 'Change Refusal', class: 'STANDARD', tl: 'Sinadyang Hindi Pagbibigay ng Sukli', en: 'Refused to Provide Change', by: PASSENGER },
  { value: 'Counterfeit Currency', class: 'STANDARD', tl: 'Peke o Pinaghihinalaang Pekeng Pera', en: 'Counterfeit Currency (referred to the TODA / police)', by: BOTH },
  { value: 'Lost Item', class: 'LOST_ITEM', tl: 'Naiwang Gamit sa Tricycle', en: 'Lost Item in Tricycle', by: BOTH },
  { value: 'Others', class: 'STANDARD', tl: 'Iba Pang Reklamo', en: 'Other Issues', by: BOTH },
];

export const incidentCategoryClass = (category: string): IncidentClass | null => INCIDENT_CATEGORIES.find((c) => c.value === category)?.class ?? null;
/** The categories offered to one party, emergencies first (decision PI-11K) */
export const incidentCategoriesFor = (reporter: IncidentReporter): IncidentCategory[] => INCIDENT_CATEGORIES.filter((c) => c.by.includes(reporter));

/**
 * Rule 16.5 (decision PI-11A): "incident reports may only be submitted after trip completion except for emergency incidents". The emergency incidents are the EMERGENCY
 * and the SERIOUS categories; they may name the trip in progress. incident_report_guard holds the same rule.
 */
export const EMERGENCY_INCIDENT_CATEGORIES = INCIDENT_CATEGORIES.filter((c) => c.class === 'EMERGENCY' || c.class === 'SERIOUS').map((c) => c.value);
export const isEmergencyIncident = (category: string): boolean => EMERGENCY_INCIDENT_CATEGORIES.includes(category);

/** Where a report of this category goes first (Rules 19.3, 19.8), for the sentence on the report screen */
export const incidentRoutingOf = (category: string): 'LGU' | 'TODA' => (incidentCategoryClass(category) === 'SERIOUS' ? 'LGU' : 'TODA');

/** The photo limits the screens apply (figure F11.2; the bucket and the database hold the same ones): re-exported so the screens read them from one place */
export { INCIDENT_EVIDENCE_MAX_BYTES, INCIDENT_EVIDENCE_MAX_FILES };

/** The part of a Supabase client this needs (structural, so the shared package does not depend on the library) */
export interface IncidentUploadClient {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null } }> };
  storage: {
    from(bucket: string): {
      upload(path: string, file: File, options: { contentType: string; upsert: boolean }): Promise<{ error: { message: string } | null }>;
    };
  };
}

const EXTENSION_OF: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Why a photo cannot be attached (Filipino, then English), or null when it can */
export function evidenceFileProblem(file: { type: string; size: number }): string | null {
  if (!(INCIDENT_EVIDENCE_MIME_TYPES as readonly string[]).includes(file.type)) return 'JPEG, PNG o WebP lamang ang tinatanggap. (Only JPEG, PNG or WebP photos are accepted.)';
  if (file.size > INCIDENT_EVIDENCE_MAX_BYTES) return `Masyadong malaki ang larawan (hanggang ${INCIDENT_EVIDENCE_MAX_BYTES / (1024 * 1024)} MB). (The photo is too large: ${INCIDENT_EVIDENCE_MAX_BYTES / (1024 * 1024)} MB at most.)`;
  return null;
}

/**
 * Uploads the submitter's photos (at most 3) to `bucket` and returns their storage paths. Throws an Error whose message (Filipino, then English) can be shown as it is. The stored name is
 * made here (a time and a number, and the extension of the format), never the name the phone gave: the database only accepts a path in the reporter's own folder that ends in
 * .jpg, .jpeg, .png or .webp.
 */
export async function uploadEvidenceFilesTo(bucket: string, client: IncidentUploadClient, files: File[]): Promise<string[]> {
  if (files.length === 0) return [];
  if (files.length > INCIDENT_EVIDENCE_MAX_FILES) throw new Error(`Hanggang ${INCIDENT_EVIDENCE_MAX_FILES} larawan lamang. (At most ${INCIDENT_EVIDENCE_MAX_FILES} photos.)`);
  const { data: auth } = await client.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error('Hindi ka naka-login. (You are not signed in.)');
  for (const file of files) {
    const problem = evidenceFileProblem(file);
    if (problem) throw new Error(problem);
  }
  const paths: string[] = [];
  const stamp = Date.now();
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const path = ownedObjectPath(uid, `${stamp}-${i + 1}.${EXTENSION_OF[file.type]}`);
    const { error } = await client.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw new Error(`Hindi na-upload ang larawan. (The photo could not be uploaded: ${error.message})`);
    paths.push(path);
  }
  return paths;
}

/** An incident report's photos go to the incident-evidence bucket; an appeal's and a fare dispute's to case-evidence (see caseEvidence.ts): the same rules, a different bucket. */
export const uploadIncidentEvidenceFiles = (client: IncidentUploadClient, files: File[]): Promise<string[]> => uploadEvidenceFilesTo(INCIDENT_EVIDENCE_BUCKET, client, files);

/** One photo (the older call; the screens now send up to three through uploadIncidentEvidenceFiles) */
export async function uploadIncidentEvidence(client: IncidentUploadClient, file: File): Promise<string> {
  return (await uploadIncidentEvidenceFiles(client, [file]))[0];
}
