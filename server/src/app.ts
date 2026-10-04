import express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from './config/supabase';

import { createAuth, type Auth } from './middleware/auth';
import { LIMITS, limiter } from './middleware/rateLimits';
import { OCR_BODY_LIMIT, buildCors, formBody, isProduction, jsonBody, requestLogger, securityHeaders } from './middleware/security';
import { errorHandler, notFound } from './middleware/errorHandler';

// Administrative & TODA routes
import fareMatrixRoutes from './routes/fareMatrixRoutes';
import todaRoutes from './routes/todaRoutes';
import driverRoutes from './routes/driverRoutes';
import passengerRoutes from './routes/passengerRoutes';
import incidentRoutes from './routes/incidentRoutes';
import announcementRoutes from './routes/announcementRoutes';
import auditLogRoutes from './routes/auditLogRoutes';
import dashboardRoutes from './routes/dashboardRoutes';
import authRoutes from './routes/authRoutes';
import communicationRoutes from './routes/communicationRoutes';
import ocrRoutes from './routes/ocrRoutes';
import schedulerRoutes from './routes/schedulerRoutes';
import rosterRoutes from './routes/rosterRoutes';
import driverNotifyRoutes, { todaDriverNotifyRouter } from './routes/driverNotifyRoutes';
// ./routes/todaPortalRoutes is intentionally NOT mounted: it only returns hard-coded sample data, is not scoped to any TODA and no
// client calls it. (The file is kept; mount it again only after it reads the signed-in administrator's own TODA from the database.)

export interface AppDeps {
  /** the service-role client used to verify tokens and look up roles (default: the one in config/supabase) */
  supabase?: SupabaseClient | null;
  /** replace the whole authentication layer (tests) */
  auth?: Auth;
  env?: NodeJS.ProcessEnv;
}

/**
 * The Express application.
 *
 * Request order matters and is part of the security model:
 *   1. security headers, CORS, request log (method + path only)
 *   2. per-IP rate limit for everything under /api
 *   3. the only routes that need no sign-in: /api/health and /api/scheduler (which has its own secret and fails closed)
 *   4. DEFAULT DENY: from here on every /api request must carry a valid Supabase access token (a route added later is protected
 *      without anybody remembering to protect it) and is limited per user
 *   5. body parsing (after the sign-in check, so nobody unauthenticated makes the server read a large body); 100 kB, except the
 *      OCR path that takes document photos
 *   6. routes, each behind its role check and its own limits
 */
export function createApp(deps: AppDeps = {}): express.Express {
  const env = deps.env ?? process.env;
  const app = express();

  app.disable('x-powered-by');
  // Behind Render's proxy the client address is in X-Forwarded-For; trust exactly one proxy hop (a bare `true` would let a client spoof it).
  // (an EMPTY TRUST_PROXY, as left by a copied .env.example, counts as unset: it must not mean "trust nobody" behind the proxy)
  const hops = Number(env.TRUST_PROXY ? env.TRUST_PROXY : (isProduction(env) ? 1 : 0));
  app.set('trust proxy', Number.isFinite(hops) ? hops : 0);

  const auth = deps.auth ?? createAuth({ supabase: deps.supabase === undefined ? defaultSupabase : deps.supabase });

  // 1
  app.use(securityHeaders());
  app.use(buildCors(env));
  app.use(requestLogger);

  // 2
  app.use('/api', limiter({ name: 'ip', windowMs: 60_000, limit: LIMITS.ipPerMinute }));

  // 3
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  });
  app.use('/api/scheduler', jsonBody(), schedulerRoutes);

  // 4
  app.use('/api', auth.requireAuth);
  app.use('/api', limiter({ name: 'user', perUser: true, windowMs: 60_000, limit: LIMITS.userPerMinute }));

  // 5
  app.use('/api/ocr', jsonBody(OCR_BODY_LIMIT));
  app.use(jsonBody());
  app.use(formBody());

  // 6
  app.use('/api/auth/send-otp', limiter({ name: 'otp-send', perUser: true, ...LIMITS.otpSend, message: 'Too many code requests. Please wait a few minutes.' }));
  app.use('/api/auth/verify-otp', limiter({ name: 'otp-verify', perUser: true, ...LIMITS.otpVerify, message: 'Too many verification attempts. Please wait a few minutes.' }));
  app.use('/api/auth', auth.attachActor, authRoutes);

  app.use('/api/communication', auth.requireRole('driver'), limiter({ name: 'sms', perUser: true, ...LIMITS.sms, message: 'You have sent too many messages. Please try again later.' }), communicationRoutes);
  app.use('/api/ocr', auth.requireRole('driver'), limiter({ name: 'ocr', perUser: true, ...LIMITS.ocr, message: 'Too many scans. Please try again later.' }), ocrRoutes);

  // The roster belongs to a TODA: its own administrator or the LGU (the router checks that :todaId is THEIR TODA). Mounted before the LGU gate.
  app.use('/api/admin/todas/:todaId/roster', auth.requireRole('lgu', 'toda'), limiter({ name: 'roster', perUser: true, ...LIMITS.roster }), rosterRoutes);

  // A TODA administrator tells an applicant of their OWN TODA what the TODA decided (the router checks the driver belongs to that TODA).
  app.use('/api/toda-admin/notify', auth.requireRole('toda'), limiter({ name: 'toda-sms', perUser: true, ...LIMITS.adminSms, message: 'Too many notifications were sent. Please try again later.' }), todaDriverNotifyRouter);

  // Everything else under /api/admin is the LGU administrator's.
  app.use('/api/admin', auth.requireRole('lgu'));
  app.use('/api/admin/fare-matrix', fareMatrixRoutes);
  app.use('/api/admin/todas', todaRoutes);
  app.use('/api/admin/drivers', driverRoutes);
  app.use('/api/admin/passengers', passengerRoutes);
  app.use('/api/admin/incidents', incidentRoutes);
  app.use('/api/admin/announcements', announcementRoutes);
  app.use('/api/admin/audit-logs', auditLogRoutes);
  app.use('/api/admin/dashboard', dashboardRoutes);
  // The LGU tells a driver the outcome of their application by SMS (the number comes from the driver's record, the text from a template).
  app.use('/api/admin/notify', limiter({ name: 'admin-sms', perUser: true, ...LIMITS.adminSms, message: 'Too many notifications were sent. Please try again later.' }), driverNotifyRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
