/**
 * What a stored file REALLY is, from its first bytes (panel comment 15, decision D-P7). This is the server's copy of packages/shared/src/utils/fileSignature.ts, which the apps use
 * before an upload; the server builds on its own (it does not import from the shared package, like passwordPolicy.ts), and server/test/uploadScan.test.ts checks the two agree.
 */

export type FileKind = 'jpeg' | 'png' | 'webp' | 'gif' | 'pdf' | 'zip' | 'ole' | 'text' | 'unknown';
export type UploadKind = 'image' | 'pdf' | 'spreadsheet' | 'csv';

const KINDS_OF: Record<UploadKind, FileKind[]> = {
  image: ['jpeg', 'png', 'webp'],
  pdf: ['pdf'],
  spreadsheet: ['zip', 'ole'],
  csv: ['text'],
};

/** How many bytes are needed to tell */
export const SIGNATURE_BYTES = 512;

const startsWith = (b: Uint8Array, sig: number[], at = 0): boolean => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, at: number, text: string): boolean => text.split('').every((c, i) => b[at + i] === c.charCodeAt(0));

function looksLikeText(b: Uint8Array): boolean {
  if (b.length === 0) return false;
  for (let i = 0; i < b.length; i++) {
    const v = b[i];
    if (v === 0) return false;
    if (v < 32 && v !== 9 && v !== 10 && v !== 13) return false;
  }
  return true;
}

export function detectFileKind(bytes: Uint8Array): FileKind {
  if (bytes.length >= 3 && startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (bytes.length >= 8 && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (bytes.length >= 12 && ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return 'webp';
  if (bytes.length >= 6 && (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a'))) return 'gif';
  if (bytes.length >= 5 && ascii(bytes, 0, '%PDF-')) return 'pdf';
  if (bytes.length >= 4 && (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]))) return 'zip';
  if (bytes.length >= 8 && startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole';
  if (looksLikeText(bytes)) return 'text';
  return 'unknown';
}

export function kindIsAllowed(kind: FileKind, allowed: UploadKind[]): boolean {
  return allowed.some((a) => KINDS_OF[a].includes(kind));
}

export function mimeMatchesKind(mime: string | null | undefined, kind: FileKind): boolean {
  const m = String(mime ?? '').split(';')[0].trim().toLowerCase();
  switch (kind) {
    case 'jpeg': return m === 'image/jpeg' || m === 'image/jpg' || m === 'image/pjpeg';
    case 'png': return m === 'image/png';
    case 'webp': return m === 'image/webp';
    case 'gif': return m === 'image/gif';
    case 'pdf': return m === 'application/pdf';
    case 'zip': return m === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || m === 'application/zip' || m === 'application/x-zip-compressed';
    case 'ole': return m === 'application/vnd.ms-excel';
    case 'text': return m === 'text/csv' || m === 'text/plain' || m === 'application/csv' || m === 'application/vnd.ms-excel';
    default: return false;
  }
}
