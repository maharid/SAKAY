import { Router, type Request, type Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomInt } from 'node:crypto';
import { sendNoticeSms, sendRecoveryCodeSms } from '../services/smsService';
import { supabase as defaultSupabase } from '../config/supabase';
import { isPhMobile, maskPhone, normalizePhone, subscriberOf } from '../utils/phone';
import { checkPassword } from '../utils/passwordPolicy';
import { devConfigHint } from '../config/env';
import { isProduction } from '../middleware/security';

/**
 * Password recovery for passengers and drivers (Rule 4.2 sends a person whose number is already registered here).
 *
 * These are the only routes besides /api/health and /api/scheduler that are reachable WITHOUT a sign-in: a person who forgot the password
 * cannot have one. What stands in the place of the sign-in is, in order:
 *   - a text message with a six-digit code, sent only to the number of an EXISTING account of that app (nothing is sent to any other number);
 *   - the code's rules (database: password_reset_challenge): valid for five minutes, used once, five wrong codes lock the number for fifteen
 *     minutes (Rules 4.6 / 4.7), at least 30 seconds between codes and at most five a day. They are kept in the DATABASE, so a restart of this
 *     server resets nothing;
 *   - the same answer whether or not the number has an account (the limits and the success message do not depend on it);
 *   - per-address limits in app.ts, and a 4 kB body limit;
 *   - the new password has to meet the registration rules, and is checked BEFORE the code is looked at, so a typo does not burn a code.
 * The password itself is set here, by the server, with the service role (Supabase Auth admin API) on the auth user of the account that owns
 * the number. The code is never logged, never returned, and only its hash is stored.
 */

export type RecoveryRole = 'passenger' | 'driver';

export interface PasswordResetDeps {
  supabase: SupabaseClient | null;
  sms: {
    sendRecoveryCode: (phone: string, code: string) => Promise<{ success: boolean; error?: string }>;
    sendNotice: (phone: string, text: string) => Promise<{ success: boolean; error?: string }>;
  };
  /** the six-digit code (tests pass a fixed one) */
  makeCode?: () => string;
}

/** What is stored for a code: a hash that also binds it to the app and the number, so one code cannot be replayed on another. */
export function hashRecoveryCode(role: RecoveryRole, phone: string, code: string): string {
  return createHash('sha256').update(`${role}:${subscriberOf(phone)}:${code}`).digest('hex');
}

const defaultMakeCode = (): string => randomInt(100000, 1000000).toString();

const SAME_FOR_EVERY_NUMBER = 'If this number has a SAKAY account, a 6-digit code was sent to it. It is valid for 5 minutes.';
const PASSWORD_CHANGED_NOTICE = 'SAKAY: Napalitan ang password ng iyong account. Kung hindi ikaw ito, makipag-ugnayan agad sa SAKAY support o sa tanggapan ng LGU.';

export function createPasswordResetRouter(deps: PasswordResetDeps): Router {
  const router = Router();
  const db = deps.supabase;
  const makeCode = deps.makeCode ?? defaultMakeCode;

  // Codes and passwords must never be kept by a browser, a proxy or a log of the response
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  const fail = (res: Response, status: number, error: string, extra: Record<string, unknown> = {}) =>
    res.status(status).json({ success: false, error, ...extra });

  /** 503: "the service cannot decide right now". Generic in production, with the cause appended in development. */
  const unavailable = (res: Response, cause: string) =>
    fail(res, 503, `Password recovery is temporarily unavailable. Please try again.${isProduction() ? '' : ` [development detail: ${cause}]`}`);

  /** The app and the number from the body, or null after answering 400. */
  function target(req: Request, res: Response): { role: RecoveryRole; e164: string } | null {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as { role?: unknown; phone?: unknown };
    if (body.role !== 'passenger' && body.role !== 'driver') {
      fail(res, 400, 'Choose the app to recover the account of.');
      return null;
    }
    if (typeof body.phone !== 'string' || body.phone.length > 30 || !isPhMobile(body.phone)) {
      fail(res, 400, 'A valid Philippine mobile number is required.');
      return null;
    }
    return { role: body.role, e164: normalizePhone(body.phone) };
  }

  // ── POST /api/password-reset/request ───────────────────────────────────────
  router.post('/request', async (req: Request, res: Response): Promise<void> => {
    try {
      const t = target(req, res);
      if (!t) return;
      if (!db) { unavailable(res, `Supabase is not configured on the server.${devConfigHint()}`); return; }
      const { role, e164 } = t;

      const account = await db.rpc('find_recovery_account', { p_role: role, p_phone: e164 });
      if (account.error) { console.error('[PasswordReset] find_recovery_account failed:', account.error.message); unavailable(res, `find_recovery_account: ${account.error.message}`); return; }
      const hasAccount = account.data?.found === true;
      const code = hasAccount ? makeCode() : null;

      // The limits apply to every well-formed number, registered or not, so that the answer does not say which are.
      const reserved = await db.rpc('reserve_password_reset_code', { p_role: role, p_phone: e164, p_code_hash: code ? hashRecoveryCode(role, e164, code) : null });
      if (reserved.error) { console.error('[PasswordReset] reserve_password_reset_code failed:', reserved.error.message); unavailable(res, `reserve_password_reset_code: ${reserved.error.message}`); return; }
      const slot = (reserved.data ?? {}) as { allowed?: boolean; reason?: string; minutes_remaining?: number; wait_seconds?: number };
      if (!slot.allowed) {
        if (slot.reason === 'locked') {
          const minutes = Number(slot.minutes_remaining ?? 15);
          fail(res, 429, `Too many wrong codes. Please try again in ${Math.ceil(minutes)} minute(s).`, { is_locked: true, minutes_remaining: minutes });
        } else if (slot.reason === 'cooldown') {
          const wait = Number(slot.wait_seconds ?? 30);
          fail(res, 429, `Please wait ${wait} second(s) before requesting another code.`, { cooldown_remaining_seconds: wait });
        } else if (slot.reason === 'daily') {
          fail(res, 429, 'Daily code limit reached. Please try again tomorrow.', { daily_cap_reached: true });
        } else {
          fail(res, 400, 'A valid Philippine mobile number is required.');
        }
        return;
      }

      if (hasAccount && code) {
        const sent = await deps.sms.sendRecoveryCode(e164, code);
        if (!sent.success) {
          // the person did nothing wrong: give the send back so she can ask again at once
          const { error } = await db.rpc('release_password_reset_code', { p_role: role, p_phone: e164 });
          if (error) console.warn('[PasswordReset] release_password_reset_code failed:', error.message);
          fail(res, 502, sent.error || 'The SMS could not be sent. Please try again in a moment.');
          return;
        }
        console.log(`[PasswordReset] code sent for a ${role} account (${maskPhone(e164)})`);
      }
      res.json({ success: true, message: SAME_FOR_EVERY_NUMBER });
    } catch (err) {
      console.error('[PasswordReset /request] Error:', err instanceof Error ? err.message : err);
      fail(res, 500, 'Internal server error');
    }
  });

  // ── POST /api/password-reset/confirm ───────────────────────────────────────
  router.post('/confirm', async (req: Request, res: Response): Promise<void> => {
    try {
      const t = target(req, res);
      if (!t) return;
      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as { code?: unknown; new_password?: unknown };

      // 1. the new password, BEFORE the code is looked at: a weak password is the person's typo, not a wrong code
      const pw = checkPassword(body.new_password);
      if (!pw.ok) {
        fail(res, 400, 'The new password does not meet the rules: at least 8 characters with upper and lower case letters, a number and a symbol (at most 72 characters).', { weak_password: true, password_check: pw });
        return;
      }
      if (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code.trim())) {
        fail(res, 400, 'A 6-digit code is required.');
        return;
      }
      if (!db) { unavailable(res, `Supabase is not configured on the server.${devConfigHint()}`); return; }
      const { role, e164 } = t;

      // 2. the code (this is where the five tries and the lock are counted)
      const verdict = await db.rpc('verify_password_reset_code', { p_role: role, p_phone: e164, p_code_hash: hashRecoveryCode(role, e164, body.code.trim()) });
      if (verdict.error) { console.error('[PasswordReset] verify_password_reset_code failed:', verdict.error.message); unavailable(res, `verify_password_reset_code: ${verdict.error.message}`); return; }
      const v = (verdict.data ?? {}) as { ok?: boolean; reason?: string; minutes_remaining?: number; attempts_left?: number };
      if (!v.ok) {
        if (v.reason === 'locked') {
          const minutes = Number(v.minutes_remaining ?? 15);
          fail(res, 429, `Too many wrong codes. Please try again in ${Math.ceil(minutes)} minute(s).`, { is_locked: true, minutes_remaining: minutes });
        } else if (v.reason === 'wrong') {
          fail(res, 400, `Incorrect code. ${Number(v.attempts_left ?? 0)} tries left.`, { attempts_left: Number(v.attempts_left ?? 0) });
        } else {
          fail(res, 400, 'The code has expired or was not found. Please request a new code.', { code_expired: true });
        }
        return;
      }

      // 3. whose password: the one account of this app that owns the number
      const account = await db.rpc('find_recovery_account', { p_role: role, p_phone: e164 });
      if (account.error) { console.error('[PasswordReset] find_recovery_account failed:', account.error.message); unavailable(res, `find_recovery_account: ${account.error.message}`); return; }
      const found = (account.data ?? {}) as { found?: boolean; account_id?: string; auth_user_id?: string };
      if (!found.found || !found.account_id || !found.auth_user_id) {
        fail(res, 400, 'The code has expired or was not found. Please request a new code.', { code_expired: true });
        return;
      }

      // 4. set it
      const { error: authErr } = await db.auth.admin.updateUserById(found.auth_user_id, { password: String(body.new_password) });
      if (authErr) {
        const status = (authErr as { status?: number }).status;
        console.error('[PasswordReset] could not set the password:', authErr.message);
        if (status === 422) {
          fail(res, 400, 'That password cannot be used. Please choose a different one.', { weak_password: true });
        } else {
          fail(res, 502, 'The password could not be changed. Please request a new code and try again.', { code_expired: true });
        }
        return;
      }

      // 5. older logins stop working, and the reset is in the audit log; neither may undo the change that was made
      const finished = await db.rpc('finish_password_reset', { p_role: role, p_account_id: found.account_id });
      if (finished.error) console.warn('[PasswordReset] finish_password_reset failed:', finished.error.message);
      void deps.sms.sendNotice(e164, PASSWORD_CHANGED_NOTICE).catch(() => undefined);

      console.log(`[PasswordReset] a ${role} password was reset (${maskPhone(e164)})`);
      res.json({ success: true, message: 'Your password was changed. You can now log in.' });
    } catch (err) {
      console.error('[PasswordReset /confirm] Error:', err instanceof Error ? err.message : err);
      fail(res, 500, 'Internal server error');
    }
  });

  return router;
}

export default createPasswordResetRouter({
  supabase: defaultSupabase,
  sms: { sendRecoveryCode: sendRecoveryCodeSms, sendNotice: sendNoticeSms },
});
