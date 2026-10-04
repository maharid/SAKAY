import { Router, type Request, type Response } from 'express';
import { extractMtopWithGemini, extractLicenseWithGemini } from '../services/geminiOcrService';

/**
 * POST /api/ocr/mtop and /api/ocr/license: document photo -> fields, through the Gemini API (which costs money per call).
 * `requireAuth` + `requireRole('driver')` and the per-user limit run before this router (see index.ts); the body parser for this
 * path allows large photos, every other path allows 100 kB.
 */
const router = Router();

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 9 * 1024 * 1024;

/** Returns the decoded image, or an error text for the client. */
export function readImage(body: unknown): { buffer: Buffer; mimeType: string } | { error: string } {
  const { imageBase64, mimeType = 'image/jpeg' } = (body ?? {}) as { imageBase64?: unknown; mimeType?: unknown };
  if (typeof imageBase64 !== 'string' || imageBase64.length === 0) return { error: 'Missing imageBase64 in request body.' };
  if (typeof mimeType !== 'string' || !ALLOWED_MIME.has(mimeType)) return { error: 'Unsupported image type. Use JPEG, PNG or WebP.' };
  // Strip data:image/...;base64, prefix if present
  const cleanBase64 = imageBase64.replace(/^data:image\/[\w.+-]+;base64,/, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleanBase64.slice(0, 1024))) return { error: 'The image is not valid base64.' };
  const buffer = Buffer.from(cleanBase64, 'base64');
  if (buffer.length === 0) return { error: 'The image is empty.' };
  if (buffer.length > MAX_IMAGE_BYTES) return { error: 'The image is too large (maximum 9 MB).' };
  return { buffer, mimeType };
}

type Extractor = (buffer: Buffer, mimeType: string) => Promise<{ success: boolean; data?: unknown; error?: string }>;

const handler = (label: string, extract: Extractor) => async (req: Request, res: Response): Promise<void> => {
  try {
    const image = readImage(req.body);
    if ('error' in image) {
      res.status(400).json({ success: false, error: image.error });
      return;
    }
    const result = await extract(image.buffer, image.mimeType);
    if (!result.success) {
      res.status(400).json({ success: false, error: result.error || `Failed to extract ${label} details with Gemini.` });
      return;
    }
    res.json({ success: true, data: result.data, engine: 'gemini-vision' });
  } catch (err) {
    console.error(`[OCR Route] ${label} error:`, err instanceof Error ? err.message : err);
    res.status(500).json({ success: false, error: `Internal server error during ${label} OCR.` });
  }
};

router.post('/mtop', handler('MTOP', extractMtopWithGemini as Extractor));
router.post('/license', handler('License', extractLicenseWithGemini as Extractor));

export default router;
