/**
 * Files in Supabase Storage (all ten buckets are private).
 *
 * The database keeps only the STORAGE PATH of a file (for example "<auth uid>/license_front.jpg"). When a screen needs to show or
 * download it, it asks Storage for a short-lived signed URL; Storage checks the signed-in user against the bucket's policies first, so a
 * URL can only be minted for a file that user may read. Nothing builds a public URL: there are none.
 *
 *   TTL: documents 10 minutes, avatars 1 hour. Sign when the file is opened, not when a list loads.
 */
export interface StorageCapableClient {
  storage: {
    from(bucket: string): {
      createSignedUrl(path: string, expiresIn: number): Promise<{ data: { signedUrl: string } | null; error: unknown }>;
    };
  };
}

export const SIGNED_URL_TTL = {
  /** licences, permits, registration papers, evidence */
  document: 600,
  /** profile photos shown in lists and headers */
  avatar: 3600,
} as const;

/**
 * Accepts what older rows may hold (a full storage URL, "bucket/path", "/bucket/path") as well as a plain storage path, and returns the
 * object path inside `bucket`. Returns null for an empty value.
 */
export function extractStoragePath(bucket: string, value?: string | null): string | null {
  if (!value) return null;
  let v = String(value).trim();
  if (!v) return null;
  const m = v.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+?)(?:\?.*)?$/i);
  if (m) {
    if (m[1] === bucket) {
      try { return decodeURIComponent(m[2]); } catch { return m[2]; }
    }
    return null;   // a URL into another bucket is not this bucket's file
  }
  v = v.replace(/^\/+/, '');
  if (v.startsWith(`${bucket}/`)) v = v.slice(bucket.length + 1);
  return v || null;
}

const memo = new Map<string, { url: string; expiresAt: number }>();

/**
 * A signed URL for a file the signed-in user may read, or null when there is none (no file, not allowed, not found).
 * A URL that is not a storage URL at all (data:, blob:, an external https image) is returned unchanged.
 */
export async function signedStorageUrl(
  client: StorageCapableClient,
  bucket: string,
  pathOrUrl?: string | null,
  ttlSeconds: number = SIGNED_URL_TTL.document
): Promise<string | null> {
  if (!pathOrUrl) return null;
  const raw = String(pathOrUrl).trim();
  if (!raw) return null;
  if (/^(data:|blob:)/i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw) && !/\/storage\/v1\/object\//i.test(raw)) return raw;

  const path = extractStoragePath(bucket, raw);
  if (!path) return null;

  const key = `${bucket}|${path}`;
  const now = Date.now();
  const hit = memo.get(key);
  if (hit && hit.expiresAt - now > 30_000) return hit.url;

  try {
    const { data, error } = await client.storage.from(bucket).createSignedUrl(path, ttlSeconds);
    if (error || !data?.signedUrl) return null;
    memo.set(key, { url: data.signedUrl, expiresAt: now + ttlSeconds * 1000 });
    return data.signedUrl;
  } catch {
    return null;
  }
}

const STORAGE_OBJECT_URL = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+?)(?:\?.*)?$/i;

/**
 * A fresh signed URL for the object a STORAGE URL (signed, public or authenticated) points at. Screens that list documents sign them
 * when the list loads; a link that is opened later may be past its short life, so the preview re-signs when it opens.
 * Any other value (data:, blob:, an external https image, a bare path) is returned unchanged; null when the object cannot be signed
 * for this user.
 */
export async function refreshStorageUrl(
  client: StorageCapableClient,
  url?: string | null,
  ttlSeconds: number = SIGNED_URL_TTL.document
): Promise<string | null> {
  if (!url) return null;
  const raw = String(url).trim();
  const m = raw.match(STORAGE_OBJECT_URL);
  if (!m) return raw || null;
  let path = m[2];
  try { path = decodeURIComponent(path); } catch { /* keep the raw path */ }
  return signedStorageUrl(client, m[1], path, ttlSeconds);
}

/** First bucket that yields a signed URL: for files that moved between buckets (for example selfies kept in driver-licenses). */
export async function signedStorageUrlFromAny(
  client: StorageCapableClient,
  buckets: string[],
  pathOrUrl?: string | null,
  ttlSeconds: number = SIGNED_URL_TTL.document
): Promise<string | null> {
  for (const bucket of buckets) {
    const url = await signedStorageUrl(client, bucket, pathOrUrl, ttlSeconds);
    if (url) return url;
  }
  return null;
}

/** A unique, folder-first object path for an upload: "<auth uid>/<name>". The folder is what the storage policies check. */
export function ownedObjectPath(authUserId: string, fileName: string): string {
  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+/, '').slice(-120) || 'file';
  return `${authUserId}/${safe}`;
}
