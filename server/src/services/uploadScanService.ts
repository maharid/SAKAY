import type { SupabaseClient } from '@supabase/supabase-js';

import { SIGNATURE_BYTES, detectFileKind, kindIsAllowed, mimeMatchesKind } from '../utils/fileSignature';
import type { FileKind, UploadKind } from '../utils/fileSignature';

/**
 * The server's check of what is already stored (panel comment 15, decision D-P7: "secure uploaded documents").
 *
 * The apps check a file's first bytes before it is sent (packages/shared/src/utils/uploadGuard.ts), but nothing that runs in a browser can be trusted by itself: a person can call the
 * storage API directly. So the files that were added or changed recently are checked again here, with the service role. A file whose content is not one of the kinds its bucket
 * accepts, or whose stored type is not what its bytes show, is MOVED to the `_quarantine/` folder of its bucket: no signed link the app makes for the original path will open
 * it, the uploader and the apps cannot see the folder (the storage rules look for the uploader's own folder), and the file is kept as evidence for the LGU until the service role
 * removes it. Nothing is deleted here. The scan reads only the first 512 bytes of each file (a ranged request on a 60-second signed link).
 */

/** What each private bucket accepts: the same as its policy and its screens */
export const SCAN_BUCKETS: Record<string, UploadKind[]> = {
  'driver-licenses': ['image'],
  'mtop-permits': ['image'],
  'tricycle-photos': ['image'],
  'profiles': ['image'],
  'profile-photos': ['image'],
  'incident-evidence': ['image'],
  'case-evidence': ['image'],
  'barangay-clearances': ['image', 'pdf'],
  'toda-accredited-driver-lists': ['spreadsheet', 'csv', 'pdf'],
  'toda-bylaws': ['image', 'pdf'],
};

export const QUARANTINE_FOLDER = '_quarantine';

export interface ScanOptions {
  /** Only files created or changed in the last N hours are checked (default 26: a daily run with a margin) */
  sinceHours?: number;
  /** At most this many files are checked per run (default 2000) */
  maxObjects?: number;
  /** Move a mismatched file to the quarantine folder (default true); false only reports */
  quarantine?: boolean;
  fetchImpl?: typeof fetch;
  now?: Date;
}

export interface ScanFinding {
  bucket: string;
  path: string;
  declaredType: string | null;
  detectedKind: FileKind;
  reason: string;
  quarantined: boolean;
}

export interface ScanResult {
  buckets: number;
  checked: number;
  /** files outside the time window, or beyond maxObjects */
  skipped: number;
  findings: ScanFinding[];
  /** things that went wrong (a bucket that could not be listed, a file that could not be read): the run goes on */
  errors: string[];
}

interface StorageEntry {
  name: string;
  id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  metadata?: { mimetype?: string; size?: number } | null;
}

const LIST_PAGE = 100;

async function listAll(db: SupabaseClient, bucket: string, prefix: string, errors: string[]): Promise<StorageEntry[]> {
  const out: StorageEntry[] = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) {
      errors.push(`${bucket}/${prefix}: ${error.message}`);
      break;
    }
    const page = (data ?? []) as StorageEntry[];
    out.push(...page);
    if (page.length < LIST_PAGE) break;
  }
  return out;
}

/** The first bytes of a stored file, through a short-lived signed link and a ranged request */
async function firstBytes(db: SupabaseClient, bucket: string, path: string, fetchImpl: typeof fetch): Promise<Uint8Array> {
  const { data, error } = await db.storage.from(bucket).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) throw new Error(error?.message || 'no signed link');
  const res = await fetchImpl(data.signedUrl, { headers: { Range: `bytes=0-${SIGNATURE_BYTES - 1}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer()).subarray(0, SIGNATURE_BYTES);
}

/** Checks the recent files of every bucket (or of the `only` buckets) and, unless told otherwise, quarantines the ones that are not what they say */
export async function scanUploads(db: SupabaseClient, options: ScanOptions = {}, only?: string[]): Promise<ScanResult> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - (options.sinceHours ?? 26) * 3600 * 1000);
  const maxObjects = options.maxObjects ?? 2000;
  const quarantine = options.quarantine !== false;
  const fetchImpl = options.fetchImpl ?? fetch;
  const result: ScanResult = { buckets: 0, checked: 0, skipped: 0, findings: [], errors: [] };

  for (const [bucket, allowed] of Object.entries(SCAN_BUCKETS)) {
    if (only && !only.includes(bucket)) continue;
    result.buckets++;
    // files live at <folder>/<name>: the top level lists folders (no id), each folder lists its files
    const top = await listAll(db, bucket, '', result.errors);
    for (const folder of top.filter((e) => !e.id && e.name !== QUARANTINE_FOLDER)) {
      const files = await listAll(db, bucket, folder.name, result.errors);
      for (const file of files.filter((f) => f.id)) {
        const path = `${folder.name}/${file.name}`;
        const changed = new Date(file.updated_at || file.created_at || 0);
        if (changed < since || result.checked >= maxObjects) {
          result.skipped++;
          continue;
        }
        result.checked++;
        const declared = file.metadata?.mimetype ?? null;
        let reason: string | null = null;
        let kind: FileKind = 'unknown';
        try {
          if (file.metadata?.size === 0) {
            reason = 'the file is empty';
          } else {
            kind = detectFileKind(await firstBytes(db, bucket, path, fetchImpl));
            if (!kindIsAllowed(kind, allowed)) reason = `its content is ${kind}, and this bucket accepts ${allowed.join(', ')}`;
            else if (declared && !mimeMatchesKind(declared, kind)) reason = `its stored type is ${declared}, but its content is ${kind}`;
          }
        } catch (e) {
          result.errors.push(`${bucket}/${path}: could not be read (${e instanceof Error ? e.message : String(e)})`);
          continue;
        }
        if (!reason) continue;

        let moved = false;
        if (quarantine) {
          const { error } = await db.storage.from(bucket).move(path, `${QUARANTINE_FOLDER}/${path}`);
          if (error) result.errors.push(`${bucket}/${path}: could not be moved to quarantine (${error.message})`);
          else moved = true;
        }
        result.findings.push({ bucket, path, declaredType: declared, detectedKind: kind, reason, quarantined: moved });
      }
    }
  }
  return result;
}

/** One sentence per run for the audit log, naming each file that was found (never what was in it) */
export function describeScan(result: ScanResult): string {
  const head = `Upload scan: ${result.checked} file${result.checked === 1 ? '' : 's'} checked in ${result.buckets} bucket${result.buckets === 1 ? '' : 's'}, ${result.findings.length} not what ${result.findings.length === 1 ? 'it says' : 'they say'}.`;
  const list = result.findings.slice(0, 20).map((f) => `${f.bucket}/${f.path} (${f.reason})${f.quarantined ? ' moved to quarantine' : ' left in place'}`);
  const more = result.findings.length > 20 ? ` and ${result.findings.length - 20} more` : '';
  return [head, ...list].join(' ') + more + (result.errors.length ? ` ${result.errors.length} error${result.errors.length === 1 ? '' : 's'} while scanning.` : '');
}
