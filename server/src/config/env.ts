import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Loads server/.env from an EXPLICIT path, so it is found whatever directory the process was started from
 * (`npm run dev:server` at the repo root, `tsx server/src/index.ts`, `node server/dist/index.js`, an IDE run configuration, ...).
 * A bare `dotenv.config()` only looks in the current working directory.
 *
 * Import this file FIRST (a side-effect import) in every module that reads process.env when it is loaded: ES modules are evaluated in
 * import order, so the variables are there before the next module runs. dotenv never overwrites a variable that already exists, so a real
 * environment (Render dashboard, the test harness) always wins over the file.
 *
 * Only variable NAMES are ever reported from here. A value is never printed.
 */

// This file is server/src/config/env.ts (tsx) or server/dist/config/env.js (compiled): two levels up is server/ either way.
export const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ENV_FILE = path.join(SERVER_DIR, '.env');

const loaded = dotenv.config({ path: ENV_FILE });
export const envFileLoaded: boolean = !loaded.error;

const MIN_SCHEDULER_SECRET_LENGTH = 16; // keep in step with middleware/schedulerSecret.ts

const isSet = (env: NodeJS.ProcessEnv, name: string): boolean => (env[name] ?? '').trim() !== '';

export interface EnvReport {
  /** The server cannot authenticate anybody or read any record without these. */
  missingRequired: string[];
  /** A feature is switched off or degraded without these (name -> what stops working). */
  missingFeature: Array<{ name: string; effect: string }>;
}

/** Which variables are not set, by NAME only. Pure: reads the environment it is given. */
export function checkServerEnv(env: NodeJS.ProcessEnv = process.env): EnvReport {
  const missingRequired: string[] = [];
  if (!isSet(env, 'SUPABASE_URL')) missingRequired.push('SUPABASE_URL');
  if (!isSet(env, 'SUPABASE_SERVICE_ROLE_KEY')) missingRequired.push('SUPABASE_SERVICE_ROLE_KEY');

  const missingFeature: EnvReport['missingFeature'] = [];
  for (const name of ['SMS_GATEWAY_URL', 'SMS_GATEWAY_LOGIN', 'SMS_GATEWAY_PASSWORD']) {
    if (!isSet(env, name)) missingFeature.push({ name, effect: 'OTP and SMS notifications cannot be sent' });
  }
  for (const name of ['SMS_GATEWAY_DEVICE_ID', 'SMS_GATEWAY_SIM_NUMBER']) {
    if (!isSet(env, name)) missingFeature.push({ name, effect: 'SMS gateway uses its default device / SIM' });
  }
  if (!isSet(env, 'GEMINI_API_KEY') && !isSet(env, 'GOOGLE_API_KEY')) {
    missingFeature.push({ name: 'GEMINI_API_KEY', effect: 'document OCR scans fail' });
  }
  const secret = env.SCHEDULER_SECRET ?? '';
  if (secret.length < MIN_SCHEDULER_SECRET_LENGTH) {
    missingFeature.push({
      name: 'SCHEDULER_SECRET',
      effect: secret.trim() === '' ? '/api/scheduler/* answers 503' : `/api/scheduler/* answers 503 (shorter than ${MIN_SCHEDULER_SECRET_LENGTH} characters)`,
    });
  }
  if (env.NODE_ENV === 'production' && !isSet(env, 'CORS_ORIGIN')) {
    missingFeature.push({ name: 'CORS_ORIGIN', effect: 'in production no browser origin is allowed to call the API' });
  }
  return { missingRequired, missingFeature };
}

/** Prints the report once at start-up. Names and effects only. */
export function logServerEnv(env: NodeJS.ProcessEnv = process.env): EnvReport {
  const report = checkServerEnv(env);
  console.log(envFileLoaded ? `[Env] Loaded ${ENV_FILE}` : `[Env] No env file at ${ENV_FILE}; using the process environment only.`);
  if (report.missingRequired.length > 0) {
    console.error(`[Env] MISSING REQUIRED: ${report.missingRequired.join(', ')}. Sign-in checks, role lookups and OTP will fail until they are set.`);
  }
  for (const m of report.missingFeature) {
    console.warn(`[Env] ${m.name} is not set: ${m.effect}.`);
  }
  if (report.missingRequired.length === 0 && report.missingFeature.length === 0) {
    console.log('[Env] All expected server variables are set.');
  }
  return report;
}

/** A development-only hint for a response body: which variables to look at. Always '' in production. */
export function devConfigHint(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NODE_ENV === 'production') return '';
  const { missingRequired } = checkServerEnv(env);
  return missingRequired.length > 0 ? ` (development hint: server/.env is missing ${missingRequired.join(', ')})` : '';
}
