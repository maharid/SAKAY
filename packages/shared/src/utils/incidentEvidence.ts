/**
 * Incident report evidence photos (Section 19.2: "optional photo evidence may be attached").
 *
 * A report keeps only the STORAGE PATHS of its photos (incident_report.evidence_paths, files in the private bucket below, inside the
 * reporter's own folder). Every app that shows a report asks Storage for short-lived signed links through this one function, so the
 * rules about who may open a photo stay in the storage policies (the reporter, the LGU, and the TODA administrator of the reported
 * driver; migration 20261012000001) and nothing here builds a public address.
 */
import { signedStorageUrl, SIGNED_URL_TTL } from './storageUrls';
import type { StorageCapableClient } from './storageUrls';

export const INCIDENT_EVIDENCE_BUCKET = 'incident-evidence';

export interface IncidentEvidenceFile {
  name: string;
  type: 'image';
  url: string;
}

/** The photos of one report as openable links. A photo the signed-in user may not read, or that no longer exists, is left out. */
export async function signIncidentEvidence(client: StorageCapableClient, paths?: string[] | null): Promise<IncidentEvidenceFile[]> {
  const files: IncidentEvidenceFile[] = [];
  for (const path of paths ?? []) {
    const url = await signedStorageUrl(client, INCIDENT_EVIDENCE_BUCKET, path, SIGNED_URL_TTL.document);
    if (url) files.push({ name: path.split('/').pop() || 'photo', type: 'image', url });
  }
  return files;
}
