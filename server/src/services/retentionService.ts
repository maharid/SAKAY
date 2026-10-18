import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The server's part of the retention schedule (Rule 28.1, decision F12.4). The DATABASE decides which identity document images are due for deletion
 * (get_expired_identity_documents: replaced images after 30 days, rejected applications after 30 days, closed accounts after 12 months, never a held account or an
 * image somebody still uses). Deleting a storage.objects row in SQL does not delete the file, so the files are removed here, through the Storage API, and the database
 * is told which ones are gone (confirm_identity_documents_purged: stamps them, clears the stored paths, writes one audit entry).
 */

/** The private buckets that hold identity images (perimeter S4). A stored path does not say which one, so a path is removed from each. */
export const IDENTITY_IMAGE_BUCKETS = ['driver-licenses', 'mtop-permits', 'tricycle-photos'] as const;

/** A stored value is normally a storage path; older rows may hold a full storage URL. Returns the object path and, for a URL, the bucket it names. */
export function storagePathOf(raw: string): { bucket: string | null; path: string } {
  const value = String(raw ?? '').trim();
  const m = value.match(/^https?:\/\/[^/]+\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/([^?]+)/i);
  if (m) return { bucket: m[1], path: decodeURIComponent(m[2]) };
  return { bucket: null, path: value.replace(/^\/+/, '') };
}

export interface ImagePurgeResult {
  /** rows the database said were due */
  due: number;
  /** files confirmed gone (removed, or already absent) */
  removed: number;
  /** rows left for the next run because a bucket refused */
  failed: number;
}

interface DueImage {
  retention_id: string;
  storage_path: string;
  reason: string;
}

/** Removes the due images (at most `maxBatches` x `batchSize` per run) and confirms them to the database. */
export async function purgeIdentityImages(db: SupabaseClient, batchSize = 200, maxBatches = 10): Promise<ImagePurgeResult> {
  const result: ImagePurgeResult = { due: 0, removed: 0, failed: 0 };
  const failedIds = new Set<string>();
  for (let batch = 0; batch < maxBatches; batch++) {
    const { data, error } = await db.rpc('get_expired_identity_documents', { p_limit: batchSize });
    if (error) throw new Error(`get_expired_identity_documents: ${error.message}`);
    const due = ((data ?? []) as DueImage[]).filter((r) => !failedIds.has(r.retention_id));
    if (due.length === 0) break;
    result.due += due.length;

    const confirmed: string[] = [];
    for (const row of due) {
      const { bucket, path } = storagePathOf(row.storage_path);
      const buckets = bucket ? [bucket] : [...IDENTITY_IMAGE_BUCKETS];
      let ok = path !== '';
      for (const b of buckets) {
        if (!ok) break;
        const { error: removeError } = await db.storage.from(b).remove([path]);
        if (removeError) ok = false;
      }
      if (ok) confirmed.push(row.retention_id);
      else {
        failedIds.add(row.retention_id);
        result.failed++;
      }
    }
    if (confirmed.length > 0) {
      const { error: confirmError } = await db.rpc('confirm_identity_documents_purged', { p_ids: confirmed });
      if (confirmError) throw new Error(`confirm_identity_documents_purged: ${confirmError.message}`);
      result.removed += confirmed.length;
    }
    if (due.length < batchSize) break;
  }
  return result;
}
