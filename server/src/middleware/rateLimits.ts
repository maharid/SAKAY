import type { Request, RequestHandler, Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

/**
 * Rate limits. A limit is counted per signed-in user when the request carries one (req.auth is set by requireAuth), otherwise per client
 * IP address. The counters live in this process: with one server instance that is exact; with several each instance counts for itself.
 */

export interface LimiterOptions {
  windowMs: number;
  limit: number;
  /** count per signed-in user (needs requireAuth before it); falls back to the IP when there is no user */
  perUser?: boolean;
  /** shown to the client when the limit is hit */
  message?: string;
  /** separates counters of different limiters that share a window */
  name?: string;
}

export function limiter(opts: LimiterOptions): RequestHandler {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req: Request) =>
      `${opts.name ?? 'rl'}:${opts.perUser && req.auth ? `u:${req.auth.userId}` : `ip:${ipKeyGenerator(req.ip ?? '0.0.0.0')}`}`,
    handler: (req: Request, res: Response) => {
      const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
      const retryAfter = resetTime ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000)) : Math.ceil(opts.windowMs / 1000);
      res.status(429).set('Retry-After', String(retryAfter)).json({
        success: false,
        error: opts.message ?? 'Too many requests. Please slow down and try again shortly.',
        retry_after_seconds: retryAfter,
      });
    },
  });
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Figures recommended in the Phase A report (A3). */
export const LIMITS = {
  ipPerMinute: 300,                 // backstop for everything under /api
  userPerMinute: 120,               // every signed-in user, every route
  otpSend: { windowMs: 10 * MINUTE, limit: 3 },
  otpVerify: { windowMs: 10 * MINUTE, limit: 10 },
  sms: { windowMs: HOUR, limit: 10 },
  ocr: { windowMs: HOUR, limit: 10 },
  roster: { windowMs: HOUR, limit: 30 },
  adminSms: { windowMs: HOUR, limit: 200 },   // LGU outcome messages to drivers
} as const;
