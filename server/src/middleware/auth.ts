import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { devConfigHint } from '../config/env';
import type { Actor, AuthContext, Role } from './types';
import { isProduction } from './security';

/**
 * Authentication and authorisation for the Express API.
 *
 *  requireAuth     Verifies the `Authorization: Bearer <access token>` with Supabase Auth (auth.getUser), so a signed-out, revoked,
 *                  deleted or banned account is refused at once. Sets req.auth. Fails CLOSED: when Supabase Auth cannot be reached the
 *                  answer is 503, never "let it through".
 *  attachActor     Loads the account's role rows (passenger, driver, TODA administrator, LGU administrator) with the service role.
 *  requireRole     attachActor + at least one of the listed roles, judged on those rows (an administrator must be Active).
 *
 * Nothing in a request body or query string is ever used as an identity. The sign-up metadata is not consulted either: roles are rows in
 * our own tables, created by the registration functions or by an LGU administrator.
 *
 * Verified tokens and role rows are cached for a few seconds so that one screen making ten calls costs one lookup; the cache is bounded.
 */

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;
const MAX_TOKEN_LENGTH = 4096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuthDeps {
  supabase: SupabaseClient | null;
  /** how long a verified token / role lookup is reused, in ms (default 30 s) */
  ttlMs?: number;
  /** how long a REFUSED token is remembered, in ms (default 5 s) */
  negativeTtlMs?: number;
  /** the cache never holds more than this many entries (default 1000) */
  maxEntries?: number;
  now?: () => number;
}

class TtlCache<V> {
  private map = new Map<string, { value: V; expiresAt: number }>();
  constructor(private maxEntries: number, private now: () => number) {}
  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }
  set(key: string, value: V, ttlMs: number): void {
    if (ttlMs <= 0) return;
    if (this.map.size >= this.maxEntries) {
      // drop expired entries first, then the oldest
      const t = this.now();
      for (const [k, v] of this.map) if (v.expiresAt <= t) this.map.delete(k);
      while (this.map.size >= this.maxEntries) {
        const oldest = this.map.keys().next().value;
        if (oldest === undefined) break;
        this.map.delete(oldest);
      }
    }
    this.map.set(key, { value, expiresAt: this.now() + ttlMs });
  }
  delete(key: string): void { this.map.delete(key); }
  clear(): void { this.map.clear(); }
  get size(): number { return this.map.size; }
}

type Verdict = { ok: true; auth: AuthContext } | { ok: false; reason: 'invalid' };

export class AuthUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthUnavailableError';
  }
}

/** The `exp` claim of a JWT in ms, WITHOUT verifying anything: used only to avoid caching a token past its own expiry. */
function unverifiedExpiryMs(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || header.length > MAX_TOKEN_LENGTH + 7) return null;
  const m = /^Bearer (\S+)$/.exec(header);
  if (!m) return null;
  const token = m[1];
  if (token.length > MAX_TOKEN_LENGTH || !TOKEN_SHAPE.test(token)) return null;
  return token;
}

export function createAuth(deps: AuthDeps) {
  const now = deps.now ?? Date.now;
  const ttl = deps.ttlMs ?? 30_000;
  const negTtl = deps.negativeTtlMs ?? 5_000;
  const max = deps.maxEntries ?? 1000;
  const tokens = new TtlCache<Verdict>(max, now);
  const actors = new TtlCache<Actor>(max, now);
  /** The log line (names only, never values) that says which server/.env variables to fill in. */
  const notConfiguredMessage = () => `Supabase is not configured on the server.${devConfigHint()}`;

  const unauthorised = (res: Response) =>
    res.status(401).set('WWW-Authenticate', 'Bearer').json({ success: false, error: 'Authentication required.' });
  // Production: a generic message (a library or database message must not reach a browser). Development: say what is wrong, so a missing
  // server/.env value is found in one look instead of in the server log. The same text is always in the server log.
  const unavailable = (res: Response, cause?: unknown) => {
    const base = 'Authentication is temporarily unavailable. Please try again.';
    const detail = !isProduction() && cause instanceof Error ? ` [development detail: ${cause.message}]` : '';
    res.status(503).json({ success: false, error: base + detail });
  };
  const forbidden = (res: Response) =>
    res.status(403).json({ success: false, error: 'You do not have access to this resource.' });

  async function verify(token: string): Promise<Verdict> {
    const key = createHash('sha256').update(token).digest('hex');
    const cached = tokens.get(key);
    if (cached) return cached;

    const exp = unverifiedExpiryMs(token);
    if (exp !== null && exp <= now()) {
      const v: Verdict = { ok: false, reason: 'invalid' };
      tokens.set(key, v, negTtl);
      return v;
    }
    if (!deps.supabase) throw new AuthUnavailableError(notConfiguredMessage());

    let result;
    try {
      result = await deps.supabase.auth.getUser(token);
    } catch (e) {
      throw new AuthUnavailableError(e instanceof Error ? e.message : 'auth lookup failed');
    }
    const { data, error } = result;
    if (error || !data?.user) {
      const status = (error as { status?: number } | null)?.status;
      // a definite "no" from Supabase Auth (4xx) is a bad token; anything else (network, 5xx) means we cannot tell
      if (typeof status === 'number' && status >= 400 && status < 500) {
        const v: Verdict = { ok: false, reason: 'invalid' };
        tokens.set(key, v, negTtl);
        return v;
      }
      throw new AuthUnavailableError(error?.message ?? 'no user returned');
    }
    const user = data.user;
    if (!UUID.test(user.id) || (user as { is_anonymous?: boolean }).is_anonymous === true) {
      const v: Verdict = { ok: false, reason: 'invalid' };
      tokens.set(key, v, negTtl);
      return v;
    }
    const v: Verdict = { ok: true, auth: { userId: user.id, email: user.email ?? null } };
    const remaining = exp === null ? ttl : Math.max(0, exp - now());
    tokens.set(key, v, Math.min(ttl, remaining));
    return v;
  }

  const requireAuth: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    const token = bearerToken(req);
    if (!token) { unauthorised(res); return; }
    try {
      const verdict = await verify(token);
      if (!verdict.ok) { unauthorised(res); return; }
      req.auth = verdict.auth;
      next();
    } catch (e) {
      console.error('[Auth] verification unavailable:', e instanceof Error ? e.message : e);
      unavailable(res, e);
    }
  };

  async function loadActor(userId: string): Promise<Actor> {
    const cached = actors.get(userId);
    if (cached) return cached;
    if (!deps.supabase) throw new AuthUnavailableError(notConfiguredMessage());
    const db = deps.supabase;
    const [p, d, t, l] = await Promise.all([
      db.from('passenger').select('passenger_id, account_status, contact_number').eq('auth_user_id', userId).maybeSingle(),
      db.from('driver').select('driver_id, account_status, contact_number, toda_id, full_name').eq('auth_user_id', userId).maybeSingle(),
      db.from('toda_admin').select('admin_id, toda_id, account_status').eq('auth_user_id', userId).maybeSingle(),
      db.from('lgu_admin').select('admin_id, account_status').eq('auth_user_id', userId).maybeSingle(),
    ]);
    for (const r of [p, d, t, l]) {
      if (r.error) throw new AuthUnavailableError(`role lookup failed: ${r.error.message}`);
    }
    const actor: Actor = {
      userId,
      passenger: p.data ? { passengerId: p.data.passenger_id, accountStatus: p.data.account_status, contactNumber: p.data.contact_number ?? null } : null,
      driver: d.data ? { driverId: d.data.driver_id, accountStatus: d.data.account_status, contactNumber: d.data.contact_number ?? null, todaId: d.data.toda_id ?? null, fullName: d.data.full_name ?? null } : null,
      todaAdmin: t.data ? { adminId: t.data.admin_id, todaId: t.data.toda_id, accountStatus: t.data.account_status } : null,
      lguAdmin: l.data ? { adminId: l.data.admin_id, accountStatus: l.data.account_status } : null,
    };
    actors.set(userId, actor, ttl);
    return actor;
  }

  /** Needs requireAuth before it. */
  const attachActor: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) { unauthorised(res); return; }
    try {
      req.actor = await loadActor(req.auth.userId);
      next();
    } catch (e) {
      console.error('[Auth] role lookup unavailable:', e instanceof Error ? e.message : e);
      unavailable(res, e);
    }
  };

  const hasRole = (actor: Actor, role: Role): boolean => {
    switch (role) {
      case 'lgu': return actor.lguAdmin?.accountStatus === 'Active';
      case 'toda': return actor.todaAdmin?.accountStatus === 'Active';
      case 'driver': return actor.driver !== null;
      case 'passenger': return actor.passenger !== null;
    }
  };

  /** Needs requireAuth before it. Passes when the account holds AT LEAST ONE of the roles. */
  const requireRole = (...roles: Role[]): RequestHandler => async (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) { unauthorised(res); return; }
    try {
      const actor = req.actor ?? (await loadActor(req.auth.userId));
      req.actor = actor;
      if (!roles.some((r) => hasRole(actor, r))) { forbidden(res); return; }
      next();
    } catch (e) {
      console.error('[Auth] role lookup unavailable:', e instanceof Error ? e.message : e);
      unavailable(res, e);
    }
  };

  return {
    requireAuth,
    attachActor,
    requireRole,
    loadActor,
    hasRole,
    /** for tests */
    _caches: { tokens, actors },
    forgetActor: (userId: string) => actors.delete(userId),
  };
}

export type Auth = ReturnType<typeof createAuth>;
