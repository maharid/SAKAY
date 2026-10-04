import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Guard for the scheduler endpoint (called by a cron service, not by a person).
 *
 *  - FAILS CLOSED: if SCHEDULER_SECRET is not set (or is shorter than 16 characters) the endpoint answers 503 to everyone.
 *    It used to fall back to a default secret that was written in the source code.
 *  - The secret is read from the X-Scheduler-Secret header (or `Authorization: Bearer <secret>`) and compared in constant time.
 */
export const MIN_SECRET_LENGTH = 16;

const digest = (s: string) => createHash('sha256').update(s).digest();

export function createSchedulerGuard(getSecret: () => string | undefined = () => process.env.SCHEDULER_SECRET): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const secret = getSecret();
    if (!secret || secret.length < MIN_SECRET_LENGTH) {
      console.error('[Scheduler Security] SCHEDULER_SECRET is missing or too short: the scheduler endpoint is disabled.');
      res.status(503).json({ success: false, error: 'The scheduler endpoint is disabled until SCHEDULER_SECRET is configured on the server.' });
      return;
    }
    const auth = req.header('Authorization');
    const provided = req.header('X-Scheduler-Secret') || (auth && auth.startsWith('Bearer ') ? auth.slice(7) : '');
    if (!provided || !timingSafeEqual(digest(provided), digest(secret))) {
      console.warn(`[Scheduler Security] Unauthorized cron trigger attempt from IP: ${req.ip}`);
      res.status(401).json({ success: false, error: 'Access Denied: invalid or missing scheduler secret.' });
      return;
    }
    next();
  };
}
