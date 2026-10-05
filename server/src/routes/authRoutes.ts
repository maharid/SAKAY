import { Router, type Request, type Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendOtpSms, verifyOtpCode } from '../services/smsService';
import { supabase as defaultSupabase } from '../config/supabase';
import { isPhMobile, maskPhone, normalizePhone, samePhone } from '../utils/phone';
import { devConfigHint } from '../config/env';
import { isProduction } from '../middleware/security';

/**
 * One-time passwords for registration (passenger and driver).
 *
 * Both endpoints need a signed-in account (the apps sign the user up first, then ask for the code): `requireAuth` + `attachActor` run
 * before this router. The account is taken from the verified token and the database, NEVER from the request body:
 *   - the number must be the contact number of the caller's own passenger / driver record, so a signed-in user cannot have codes sent
 *     to, or accounts activated for, somebody else's number;
 *   - failed codes are counted here (check_otp_lockout / increment_failed_otp / reset_failed_otp are callable by the service role only);
 *   - a passenger is activated here, after the code is verified, by this server with the service role. Nothing in the browser can do it.
 * There is no master code and no development bypass.
 */

// ── Rate-limit constants (Rule 4.6 / 4.7 / W7) ───────────────────────────────
export const OTP_RESEND_COOLDOWN_SECONDS = 30;   // F2.4 approved: 30-second server-side cooldown
export const OTP_DAILY_CAP = 5;                  // F2.4 approved: max 5 OTP sends per number per day
export const OTP_MIN_AGE_YEARS = 12;             // Rule 4.3: under-12 cannot hold a verified account

/** Age in completed years from YYYY-MM-DD; null when the text is not a plausible birth date. */
export function calcAge(dobString: unknown, today: Date = new Date()): number | null {
  if (typeof dobString !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dobString)) return null;
  const dob = new Date(`${dobString}T00:00:00Z`);
  if (isNaN(dob.getTime()) || dob.getTime() > today.getTime() || dob.getUTCFullYear() < 1900) return null;
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const m = today.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

/** Cooldown and daily cap for numbers that have no counters in the database (drivers). Lives in this process. */
export class PhoneSendGate {
  private seen = new Map<string, { last: number; day: string; count: number }>();
  check(phone: string, nowMs: number): { ok: true } | { ok: false; kind: 'cooldown'; wait: number } | { ok: false; kind: 'daily' } {
    const e = this.seen.get(phone);
    if (!e) return { ok: true };
    const elapsed = (nowMs - e.last) / 1000;
    if (elapsed < OTP_RESEND_COOLDOWN_SECONDS) return { ok: false, kind: 'cooldown', wait: Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsed) };
    const today = new Date(nowMs).toISOString().slice(0, 10);
    if (e.day === today && e.count >= OTP_DAILY_CAP) return { ok: false, kind: 'daily' };
    return { ok: true };
  }
  record(phone: string, nowMs: number): void {
    const today = new Date(nowMs).toISOString().slice(0, 10);
    const e = this.seen.get(phone);
    this.seen.set(phone, { last: nowMs, day: today, count: e && e.day === today ? e.count + 1 : 1 });
  }
}

export interface AuthRouterDeps {
  supabase: SupabaseClient | null;
  sms: { sendOtpSms: typeof sendOtpSms; verifyOtpCode: typeof verifyOtpCode };
  now?: () => Date;
}

type Subject =
  | { kind: 'passenger'; id: string; phone: string | null; status: string }
  | { kind: 'driver'; id: string; phone: string | null; status: string };

/** The record whose phone number is being verified: the caller's own passenger or driver record. */
function subjectOf(req: Request): Subject | null {
  const actor = req.actor;
  if (!actor) return null;
  const hint = req.body && typeof req.body === 'object' ? (req.body as { role?: unknown }).role : undefined;
  const pax: Subject | null = actor.passenger ? { kind: 'passenger', id: actor.passenger.passengerId, phone: actor.passenger.contactNumber, status: actor.passenger.accountStatus } : null;
  const drv: Subject | null = actor.driver ? { kind: 'driver', id: actor.driver.driverId, phone: actor.driver.contactNumber, status: actor.driver.accountStatus } : null;
  return hint === 'driver' ? drv ?? pax : pax ?? drv;
}

export function createAuthRouter(deps: AuthRouterDeps): Router {
  const router = Router();
  const db = deps.supabase;
  const clock = deps.now ?? (() => new Date());
  const driverGate = new PhoneSendGate();

  const fail = (res: Response, status: number, error: string, extra: Record<string, unknown> = {}) =>
    res.status(status).json({ success: false, error, ...extra });

  /** 503 for "the verification service cannot decide": generic in production, with the cause appended in development. */
  const unavailable = (res: Response, cause: string) =>
    fail(res, 503, `Verification is temporarily unavailable. Please try again.${isProduction() ? '' : ` [development detail: ${cause}]`}`);

  /** Resolves who is asking and whether the number is theirs; answers the request itself when not. */
  function ownSubject(req: Request, res: Response): { subject: Subject; e164: string } | null {
    const phone = (req.body as { phone?: unknown } | undefined)?.phone;
    if (typeof phone !== 'string' || !isPhMobile(phone)) {
      fail(res, 400, 'A valid Philippine mobile number is required.');
      return null;
    }
    const subject = subjectOf(req);
    if (!subject) {
      fail(res, 403, 'No registration was found for this sign-in. Please register first.');
      return null;
    }
    if (!samePhone(phone, subject.phone)) {
      fail(res, 403, 'This number does not belong to your account.');
      return null;
    }
    return { subject, e164: normalizePhone(phone) };
  }

  /** The database-side OTP lockout (5 wrong codes, 15 minutes). Fails closed: if it cannot be checked, nothing is sent or verified. */
  async function lockedOut(e164: string): Promise<{ locked: boolean; minutes: number } | { unavailable: string }> {
    if (!db) return { unavailable: `Supabase is not configured on the server.${devConfigHint()}` };
    const { data, error } = await db.rpc('check_otp_lockout', { p_contact_number: e164 });
    if (error) {
      console.error('[Auth] check_otp_lockout failed:', error.message);
      return { unavailable: `check_otp_lockout failed: ${error.message}` };
    }
    return { locked: Boolean(data?.is_locked), minutes: Number(data?.minutes_remaining ?? 15) };
  }

  // ── POST /api/auth/send-otp ─────────────────────────────────────────────────
  router.post('/send-otp', async (req: Request, res: Response): Promise<void> => {
    try {
      const own = ownSubject(req, res);
      if (!own) return;
      const { subject, e164 } = own;
      const now = clock();

      if (subject.kind === 'passenger') {
        if (subject.status !== 'Pending OTP Verification' && subject.status !== 'Active') {
          fail(res, 403, 'This account cannot request a code right now.');
          return;
        }
        // 1. lockout
        const lock = await lockedOut(e164);
        if ('unavailable' in lock) { unavailable(res, lock.unavailable); return; }
        if (lock.locked) {
          fail(res, 429, `Too many failed OTP attempts. Please try again in ${lock.minutes.toFixed(0)} minute(s).`, { is_locked: true, minutes_remaining: lock.minutes });
          return;
        }
        // 2. cooldown and daily cap, from the passenger's own columns
        const { data: row, error: rowErr } = await db!.from('passenger')
          .select('otp_last_sent_at, otp_daily_count, otp_daily_reset_at').eq('passenger_id', subject.id).maybeSingle();
        if (rowErr) { console.error('[Auth] passenger OTP counters:', rowErr.message); unavailable(res, `passenger OTP counters: ${rowErr.message}`); return; }
        const today = now.toISOString().slice(0, 10);
        if (row?.otp_last_sent_at) {
          const elapsedSec = (now.getTime() - new Date(row.otp_last_sent_at).getTime()) / 1000;
          if (elapsedSec < OTP_RESEND_COOLDOWN_SECONDS) {
            const wait = Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsedSec);
            fail(res, 429, `Please wait ${wait} second(s) before requesting another OTP.`, { cooldown_remaining_seconds: wait });
            return;
          }
        }
        const lastResetDay = row?.otp_daily_reset_at ? String(row.otp_daily_reset_at).slice(0, 10) : null;
        const countToday = lastResetDay === today ? Number(row?.otp_daily_count ?? 0) : 0;
        if (countToday >= OTP_DAILY_CAP) {
          fail(res, 429, `Daily OTP limit (${OTP_DAILY_CAP}) reached. Please try again tomorrow.`, { daily_cap_reached: true });
          return;
        }
        // 3. send, and only then count it
        const sent = await deps.sms.sendOtpSms(e164);
        if (!sent.success) { fail(res, 502, sent.error || 'Failed to send OTP SMS.'); return; }
        const { error: upErr } = await db!.from('passenger')
          .update({ otp_last_sent_at: now.toISOString(), otp_daily_count: countToday + 1, otp_daily_reset_at: today })
          .eq('passenger_id', subject.id);
        if (upErr) console.warn('[Auth] could not record the OTP send:', upErr.message);
        // A new code starts with a clean count: the wrong entries made against the previous code do not carry over. (A lock that is
        // still running never gets this far: it was refused above, so a lock cannot be cleared by asking for a code.)
        const { error: clearErr } = await db!.rpc('reset_failed_otp', { p_passenger_id: subject.id });
        if (clearErr) console.warn('[Auth] reset_failed_otp after a new code:', clearErr.message);
        res.json({ success: true, message: sent.message || 'OTP SMS sent successfully.' });
        return;
      }

      // driver: same cooldown and daily cap, kept in memory (drivers have no counters in the database)
      const gate = driverGate.check(e164, now.getTime());
      if (!gate.ok) {
        if (gate.kind === 'cooldown') fail(res, 429, `Please wait ${gate.wait} second(s) before requesting another OTP.`, { cooldown_remaining_seconds: gate.wait });
        else fail(res, 429, `Daily OTP limit (${OTP_DAILY_CAP}) reached. Please try again tomorrow.`, { daily_cap_reached: true });
        return;
      }
      const sent = await deps.sms.sendOtpSms(e164);
      if (!sent.success) { fail(res, 502, sent.error || 'Failed to send OTP SMS.'); return; }
      driverGate.record(e164, now.getTime());
      res.json({ success: true, message: sent.message || 'OTP SMS sent successfully.' });
    } catch (err) {
      console.error('[Auth Route /send-otp] Error:', err instanceof Error ? err.message : err);
      fail(res, 500, 'Internal server error');
    }
  });

  // ── POST /api/auth/verify-otp ───────────────────────────────────────────────
  router.post('/verify-otp', async (req: Request, res: Response): Promise<void> => {
    try {
      const own = ownSubject(req, res);
      if (!own) return;
      const { subject, e164 } = own;
      const code = (req.body as { code?: unknown }).code;
      if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
        fail(res, 400, 'A 6-digit code is required.');
        return;
      }

      // 1. lockout BEFORE the code is looked at (passengers; the counters are on their record)
      if (subject.kind === 'passenger') {
        const lock = await lockedOut(e164);
        if ('unavailable' in lock) { unavailable(res, lock.unavailable); return; }
        if (lock.locked) {
          fail(res, 429, `Too many failed OTP attempts. Please try again in ${lock.minutes.toFixed(0)} minute(s).`, { is_locked: true, minutes_remaining: lock.minutes });
          return;
        }
      }

      // 2. the code
      const verdict = deps.sms.verifyOtpCode(e164, code.trim());
      if (!verdict.success) {
        // Only a WRONG guess counts towards the lock. "No code issued" and "the code expired" are not guesses (for example the code was
        // lost when the server restarted), and counting them would lock somebody out for something that is not their mistake.
        const isGuess = verdict.reason === 'wrong' || verdict.reason === 'too_many';
        if (subject.kind === 'passenger' && db && isGuess) {
          const { error } = await db.rpc('increment_failed_otp', { p_passenger_id: subject.id });
          if (error) console.warn('[Auth] increment_failed_otp:', error.message);
          // the guess that made it five: tell the app now, so it can show the countdown instead of "request a new code"
          const now = await lockedOut(e164);
          if (!('unavailable' in now) && now.locked) {
            fail(res, 429, `Too many failed OTP attempts. Please try again in ${now.minutes.toFixed(0)} minute(s).`, { is_locked: true, minutes_remaining: now.minutes });
            return;
          }
        }
        fail(res, 400, verdict.error);
        return;
      }

      if (subject.kind === 'driver') {
        res.json({ success: true, message: 'OTP verified successfully.' });
        return;
      }

      // 3. passenger: age gate (Rule 4.3), then activation
      if (subject.status !== 'Pending OTP Verification' && subject.status !== 'Active') {
        fail(res, 403, 'This account cannot be activated.');
        return;
      }
      const { data: row, error: rowErr } = await db!.from('passenger').select('date_of_birth').eq('passenger_id', subject.id).maybeSingle();
      if (rowErr) { console.error('[Auth] passenger lookup:', rowErr.message); unavailable(res, `passenger lookup: ${rowErr.message}`); return; }
      const bodyDob = (req.body as { date_of_birth?: unknown }).date_of_birth;
      const dob = (row?.date_of_birth as string | null) || (typeof bodyDob === 'string' ? bodyDob : null);
      if (dob) {
        const age = calcAge(String(dob).slice(0, 10), clock());
        if (age !== null && age < OTP_MIN_AGE_YEARS) {
          fail(res, 403,
            `Passengers under ${OTP_MIN_AGE_YEARS} years old cannot hold a verified account. ` +
            `(Ang mga pasaherong wala pang ${OTP_MIN_AGE_YEARS} taong gulang ay hindi maaaring magkaroon ng verified account.)`,
            { under_age: true });
          return;
        }
      }

      const update: Record<string, unknown> = { account_status: 'Active' };
      if (!row?.date_of_birth && typeof bodyDob === 'string' && calcAge(bodyDob, clock()) !== null) update.date_of_birth = bodyDob;
      const { error: upErr } = await db!.from('passenger').update(update).eq('passenger_id', subject.id);
      if (upErr) {
        console.error('[Auth] passenger activation failed:', upErr.message);
        fail(res, 500, 'The account could not be activated. Please try again.');
        return;
      }
      const { error: resetErr } = await db!.rpc('reset_failed_otp', { p_passenger_id: subject.id });
      if (resetErr) console.warn('[Auth] reset_failed_otp:', resetErr.message);

      console.log(`[Auth] passenger ${maskPhone(e164)} activated`);
      res.json({ success: true, message: 'OTP verified successfully and account activated.' });
    } catch (err) {
      console.error('[Auth Route /verify-otp] Error:', err instanceof Error ? err.message : err);
      fail(res, 500, 'Internal server error');
    }
  });

  return router;
}

export default createAuthRouter({
  supabase: defaultSupabase,
  sms: { sendOtpSms, verifyOtpCode },
});
