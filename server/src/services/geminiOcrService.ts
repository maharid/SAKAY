import { GoogleGenAI } from '@google/genai';
import '../config/env'; // loads server/.env from an explicit path before the API key is read

/**
 * Data minimization (Rule 28.1, Batch 12): the OCR extracts ONLY the fields the verification needs. For the MTOP: the operator, the franchise number, the plate and the
 * expiry. The make, engine number, chassis number and issue date are not asked for and not kept.
 */
export interface MtopParsedData {
  operatorName: string;
  franchiseNumber: string;
  plateNumber: string;
  expirationDate: string;
  rawConfidence?: number;
}

/** For the driver's license: the number, the full name, the expiry, the DL codes (restrictions) and the birth date. The address and the nationality are not asked for and not kept. */
export interface LicenseParsedData {
  licenseNumber: string;
  fullName: string;
  expirationDate: string;
  dlCodes: string;
  birthDate: string;
  rawConfidence?: number;
}

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

/**
 * Extracts MTOP data using Gemini Vision with structured JSON output
 */
export async function extractMtopWithGemini(
  imageBuffer: Buffer,
  mimeType = 'image/jpeg'
): Promise<{ success: boolean; data?: MtopParsedData; error?: string }> {
  if (!ai || !apiKey) {
    return {
      success: false,
      error: 'GEMINI_API_KEY is not configured in server/.env. Please add your free Google AI Studio API key to enable high-accuracy Gemini OCR.',
    };
  }

  try {
    const base64Image = imageBuffer.toString('base64');

    const prompt = `You are an expert document understanding engine for Philippine government transport documents.
Analyze this image of a Motorized Tricycle Operator's Permit (MTOP) / Tricycle Franchise Permit (often from Calapan City or other Philippine LGUs).
Extract the permit details with high precision even if there are official wet ink stamps, dot-matrix typography, signatures, folds, or angled captures.

Return ONLY a valid JSON object with EXACTLY these keys:
{
  "operatorName": string, // Full name of the operator/grantee/owner (in UPPERCASE)
  "franchiseNumber": string, // The 3 to 6-digit MTOP / Franchise / Case number
  "plateNumber": string, // Plate number or MV file number
  "expirationDate": string // Expiration or validity date formatted as MM/DD/YYYY
}

Extract nothing else: do not read or return the engine number, chassis number, make or any other field.

Do not include markdown fences, code blocks, or extra commentary. Return only the JSON object.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                data: base64Image,
                mimeType,
              },
            },
          ],
        },
      ],
    });

    const text = response.text || '';
    const cleanJson = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed: MtopParsedData = JSON.parse(cleanJson);

    return {
      success: true,
      data: parsed,
    };
  } catch (err: any) {
    console.error('[geminiOcrService] MTOP Extraction Error:', err);
    return {
      success: false,
      error: err.message || 'Failed to extract MTOP details with Gemini.',
    };
  }
}

/**
 * Extracts Philippine Driver's License data using Gemini Vision
 */
export async function extractLicenseWithGemini(
  imageBuffer: Buffer,
  mimeType = 'image/jpeg'
): Promise<{ success: boolean; data?: LicenseParsedData; error?: string }> {
  if (!ai || !apiKey) {
    return {
      success: false,
      error: 'GEMINI_API_KEY is not configured in server/.env.',
    };
  }

  try {
    const base64Image = imageBuffer.toString('base64');

    const prompt = `You are an expert document understanding engine for Philippine Land Transportation Office (LTO) Driver's Licenses.
Analyze this driver's license image and extract the key details with high precision.

Return ONLY a valid JSON object with EXACTLY these keys:
{
  "licenseNumber": string, // LTO license number (e.g. N03-12-123456 or D01-20-123456)
  "fullName": string, // Driver full legal name (in UPPERCASE, LAST NAME, FIRST NAME MIDDLE NAME)
  "expirationDate": string, // Expiration date formatted as MM/DD/YYYY
  "dlCodes": string, // The restriction / DL codes printed on the license (e.g. A, A1, B, B1)
  "birthDate": string // Date of birth formatted as MM/DD/YYYY
}

Extract nothing else: do not read or return the address, nationality, sex or any other field.

Do not include markdown fences, code blocks, or extra commentary. Return only the JSON object.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                data: base64Image,
                mimeType,
              },
            },
          ],
        },
      ],
    });

    const text = response.text || '';
    const cleanJson = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed: LicenseParsedData = JSON.parse(cleanJson);

    return {
      success: true,
      data: parsed,
    };
  } catch (err: any) {
    console.error('[geminiOcrService] License Extraction Error:', err);
    return {
      success: false,
      error: err.message || 'Failed to extract license details with Gemini.',
    };
  }
}
