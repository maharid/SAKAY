/**
 * What an uploaded file REALLY is, from its first bytes (panel comment 15, decision D-P7: "secure uploaded documents").
 *
 * The browser's file type (`file.type`) and the storage bucket's allowed-types list both go by what the uploader SAYS the file is; a renamed program or script passes both.
 * The first bytes of a file say what it is (a JPEG starts FF D8 FF, a PDF starts %PDF-, ...), and a file that claims one thing and is another is refused. The apps check the file
 * before it leaves the phone or the computer, and the server's upload scan (server/src/services/uploadScan.ts) checks what already sits in storage with the same functions,
 * because nothing that runs in a browser can be trusted by itself.
 */

export type FileKind = 'jpeg' | 'png' | 'webp' | 'gif' | 'pdf' | 'zip' | 'ole' | 'text' | 'unknown';

/** What a screen accepts: images (a photo, a scan), PDFs, spreadsheets (.xlsx is a zip, .xls is OLE) and plain-text lists (.csv) */
export type UploadKind = 'image' | 'pdf' | 'spreadsheet' | 'csv';

const KINDS_OF: Record<UploadKind, FileKind[]> = {
  image: ['jpeg', 'png', 'webp'],
  pdf: ['pdf'],
  spreadsheet: ['zip', 'ole'],
  csv: ['text'],
};

/** How many bytes are needed to tell (enough for every signature above, and to judge that a file is text) */
export const SIGNATURE_BYTES = 512;

const startsWith = (b: Uint8Array, sig: number[], at = 0): boolean => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, at: number, text: string): boolean => text.split('').every((c, i) => b[at + i] === c.charCodeAt(0));

/** Plain text: no NUL and no control characters other than tab, line feeds and carriage returns, in the bytes given */
function looksLikeText(b: Uint8Array): boolean {
  if (b.length === 0) return false;
  for (let i = 0; i < b.length; i++) {
    const v = b[i];
    if (v === 0) return false;
    if (v < 32 && v !== 9 && v !== 10 && v !== 13) return false;
  }
  return true;
}

/** The kind of file the first bytes describe. `text` is a file with no signature that is plain text (a .csv); everything else that is not recognised is `unknown`. */
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

/** True when a file of this kind is one the screen accepts */
export function kindIsAllowed(kind: FileKind, allowed: UploadKind[]): boolean {
  return allowed.some((a) => KINDS_OF[a].includes(kind));
}

/** True when the file type the uploader declared (the browser's / the storage's content type) is what the bytes turned out to be */
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

/** `reason` is what to tell the person when `ok` is false, and '' when it is true. (One plain shape, not a union: the apps are not all compiled with strict null checks, which a union needs to narrow.) */
export interface UploadCheck {
  ok: boolean;
  kind: FileKind;
  reason: string;
}

const WORDS: Record<'tl' | 'en', Record<UploadKind, string>> = {
  en: { image: 'a photo (JPG, PNG or WebP)', pdf: 'a PDF', spreadsheet: 'an Excel file', csv: 'a CSV file' },
  tl: { image: 'larawan (JPG, PNG o WebP)', pdf: 'PDF', spreadsheet: 'Excel file', csv: 'CSV file' },
};

/** The sentence a person reads when a file is refused, in the language of the screen */
export function describeAllowed(allowed: UploadKind[], language: 'tl' | 'en' = 'en'): string {
  const list = allowed.map((a) => WORDS[language][a]).join(language === 'tl' ? ' o ' : ' or ');
  return language === 'tl' ? `Hindi tanggap ang file na ito. Maglagay ng ${list}.` : `This file is not accepted. Upload ${list}.`;
}

/**
 * Reads the first bytes of the file and checks they are one of the kinds the screen accepts, and that they agree with the type the browser reported (an empty reported
 * type is let through: some phones leave it blank). The file itself is not changed.
 */
export async function checkUploadMatchesKind(file: Blob, allowed: UploadKind[], language: 'tl' | 'en' = 'en'): Promise<UploadCheck> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.slice(0, SIGNATURE_BYTES).arrayBuffer());
  } catch {
    return { ok: false, kind: 'unknown', reason: language === 'tl' ? 'Hindi mabasa ang file.' : 'The file could not be read.' };
  }
  const kind = detectFileKind(bytes);
  if (!kindIsAllowed(kind, allowed)) return { ok: false, kind, reason: describeAllowed(allowed, language) };
  const declared = (file as { type?: string }).type;
  if (declared && !mimeMatchesKind(declared, kind)) {
    return { ok: false, kind, reason: language === 'tl' ? 'Hindi tugma ang uri ng file sa laman nito. Piliin ang tamang file.' : 'The file type does not match what is inside the file. Choose the right file.' };
  }
  return { ok: true, kind, reason: '' };
}
