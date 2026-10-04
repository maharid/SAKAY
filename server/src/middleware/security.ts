import cors from 'cors';
import express, { type RequestHandler } from 'express';
import helmet from 'helmet';

/**
 * Transport-level hardening: security headers, CORS, body size limits, a request log that does not record bodies or query strings.
 */

export class CorsDeniedError extends Error {
  constructor(origin: string) {
    super(`Origin not allowed: ${origin}`);
    this.name = 'CorsDeniedError';
  }
}

const DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:5176'];

export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production';
}

/**
 * Production: only the origins listed in CORS_ORIGIN (comma separated). Anything else, including any localhost, is refused.
 * Development: the listed origins, the Vite dev ports, any localhost port and VS Code dev tunnels.
 * A request with no Origin header (the server called directly, a native app) is not a browser cross-origin request and is not blocked
 * here: the Bearer token is what protects the API.
 */
export function buildCors(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  const prod = isProduction(env);
  const listed = (env.CORS_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const allowed = new Set(prod ? listed : [...listed, ...DEV_ORIGINS]);
  return cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowed.has(origin)) return callback(null, true);
      if (!prod && (/^https?:\/\/localhost(:\d+)?$/.test(origin) || /^https:\/\/([a-z0-9-]+\.)+devtunnels\.ms$/.test(origin))) {
        return callback(null, true);
      }
      return callback(new CorsDeniedError(origin));
    },
    credentials: false,                       // the API uses a Bearer header, never cookies
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Scheduler-Secret'],
    maxAge: 600,
  });
}

export function securityHeaders(): RequestHandler {
  return helmet();
}

/** Default JSON body limit; large bodies (document photos for OCR) get their own parser on their own path. */
export const DEFAULT_BODY_LIMIT = '100kb';
export const OCR_BODY_LIMIT = '12mb';

export const jsonBody = (limit: string = DEFAULT_BODY_LIMIT): RequestHandler => express.json({ limit });
export const formBody = (limit: string = DEFAULT_BODY_LIMIT): RequestHandler => express.urlencoded({ limit, extended: true });

/** method + path only: no query string, no body, no headers. */
export const requestLogger: RequestHandler = (req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
};
