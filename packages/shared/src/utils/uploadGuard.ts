/**
 * The one call every upload goes through before it leaves the phone or the computer (panel comment 15, decision D-P7: "secure uploaded documents").
 *
 *   1. The first bytes must say the file is one of the kinds the screen accepts, and agree with the file type the browser reported (fileSignature.ts). A program or a script
 *      renamed to .jpg or .pdf is refused here; the server's upload scan makes the same check on what is already stored.
 *   2. A photo is re-drawn before it is sent, which drops everything that is not the picture: the GPS position, the time and the phone model in its EXIF data, and any text a
 *      file carries after the image. (A passenger's or a driver's profile photo should not say where they live.) The picture itself is the same; the orientation the phone
 *      recorded is applied. Evidence photos are NOT re-drawn: what was filed is kept exactly as it was.
 *
 * It throws UploadRejectedError with a sentence the person can read, in their language. Nothing here changes a file that is not an image.
 */
import { checkUploadMatchesKind } from './fileSignature';
import type { UploadKind } from './fileSignature';

export class UploadRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadRejectedError';
  }
}

export interface PrepareUploadOptions {
  language?: 'tl' | 'en';
  /** Re-draw a photo to drop its metadata (default true; false for evidence that must stay exactly as filed) */
  stripMetadata?: boolean;
}

/** Re-draws an image with the browser's own decoder and encoder, so only the picture is kept. Returns the original when the browser cannot (no canvas). Throws when the file cannot be decoded. */
export async function stripImageMetadata(file: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  const type = file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
    return out && out.size > 0 ? out : file;
  } finally {
    bitmap.close?.();
  }
}

/** Checks the file and, for a photo, drops its metadata. Returns what should be uploaded (the same file when nothing needed changing). */
export async function prepareUpload<T extends Blob>(file: T, allowed: UploadKind[], options: PrepareUploadOptions = {}): Promise<T | Blob> {
  const language = options.language ?? 'en';
  const check = await checkUploadMatchesKind(file, allowed, language);
  if (!check.ok) throw new UploadRejectedError(check.reason);
  const isPhoto = check.kind === 'jpeg' || check.kind === 'png' || check.kind === 'webp';
  if (!isPhoto || options.stripMetadata === false) return file;
  try {
    return await stripImageMetadata(file);
  } catch {
    throw new UploadRejectedError(language === 'tl' ? 'Hindi mabasa ang larawan. Pumili ng ibang larawan.' : 'The photo could not be read. Choose another photo.');
  }
}

/** The text to show for whatever went wrong while preparing an upload */
export function uploadProblemMessage(error: unknown, language: 'tl' | 'en' = 'en'): string {
  if (error instanceof UploadRejectedError) return error.message;
  return language === 'tl' ? 'Hindi na-upload ang file. Pakisubukang muli.' : 'The file could not be uploaded. Please try again.';
}
