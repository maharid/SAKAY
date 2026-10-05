/**
 * ============================================================================
 * SAKAY PASSENGER API CLIENT SERVICE (passengerApiService.ts)
 * ============================================================================
 * Purpose:
 *   Centralized network service providing typed database requests connecting the
 *   SAKAY Passenger PWA directly to the Supabase database.
 * ============================================================================
 */

import { apiPostJson, fetchOwnAccountRestriction, type AccountRestriction } from '@sakay/shared';
import { supabase } from './supabaseClient';

/**
 * Helper to get localized error message respecting current selected language
 */
export function getLocalizedError(tlMsg: string, enMsg: string): string {
  const lang = typeof window !== 'undefined' ? localStorage.getItem('sakay_language') || 'tl' : 'tl';
  return lang === 'tl' ? tlMsg : enMsg;
}

/**
 * Normalizes any Philippine phone number representation to standard E.164 (+639XXXXXXXXX)
 */
export function formatPhoneToE164(phone: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('639') && digits.length === 12) {
    return `+${digits}`;
  }
  if (digits.startsWith('09') && digits.length === 11) {
    return `+63${digits.slice(1)}`;
  }
  if (digits.startsWith('9') && digits.length === 10) {
    return `+63${digits}`;
  }
  if (digits.startsWith('63') && digits.length >= 12) {
    return `+${digits}`;
  }
  if (digits.startsWith('0') && digits.length >= 11) {
    return `+63${digits.slice(1)}`;
  }
  return digits ? `+63${digits}` : '';
}

/**
 * Returns candidate phone representations and auth sign-in email variants for resilient matching
 */
export function getPhoneLookupCandidates(raw: string) {
  const digits = (raw || '').replace(/\D/g, '');
  let phoneRaw = digits;
  if (digits.startsWith('639')) {
    phoneRaw = digits.slice(2);
  } else if (digits.startsWith('09')) {
    phoneRaw = digits.slice(1);
  } else if (digits.startsWith('63')) {
    phoneRaw = digits.slice(2);
  } else if (digits.startsWith('0')) {
    phoneRaw = digits.slice(1);
  } else if (digits.startsWith('9')) {
    phoneRaw = digits;
  }

  const phone09 = `0${phoneRaw}`;
  const phone63NoPlus = `63${phoneRaw}`;
  const phone63WithPlus = `+63${phoneRaw}`;

  return {
    raw,
    phoneRaw,
    phone09,
    phone63NoPlus,
    phone63WithPlus,
    e164: phone63WithPlus,
    authCandidates: [
      { email: `passenger_${phone63NoPlus}@sakay.ph` },
      { email: `passenger_${phone09}@sakay.ph` },
      { email: `passenger_${phoneRaw}@sakay.ph` },
      { phone: phone63WithPlus },
      { phone: phone09 },
    ],
  };
}


// ============================================================================
// OTP SMS DISPATCH & VERIFICATION
// ============================================================================

export function normalizePhoneE164(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('63') && digits.length === 12) return `+${digits}`;
  if (digits.startsWith('09') && digits.length === 11) return `+63${digits.slice(1)}`;
  if (digits.startsWith('9') && digits.length === 10) return `+63${digits}`;
  if (digits.length === 11) return `+63${digits.slice(1)}`;
  return `+${digits}`;
}

/** What the server said about a code request. The lock, the resend cooldown and the daily cap are three different things. */
export interface PassengerOtpSendResult {
  success: boolean;
  message?: string;
  error?: string;
  /** The number is locked out after too many wrong codes (15 minutes). No code can be requested or checked until it ends. */
  locked?: boolean;
  /** Seconds until the lock ends (from the server's own clock reading). */
  lockSeconds?: number;
  /** A code was sent a moment ago: seconds until another may be requested (the resend cooldown). */
  cooldownSeconds?: number;
  /** Five codes were sent today. */
  dailyCapReached?: boolean;
  /** There is no signed-in session: the request was not even sent. */
  sessionMissing?: boolean;
}

/** Seconds from the server's `minutes_remaining` (a number, possibly fractional). */
function secondsFromMinutes(minutes: unknown): number {
  const m = Number(minutes);
  return Number.isFinite(m) && m > 0 ? Math.ceil(m * 60) : 0;
}

/**
 * Asks the server to send an OTP SMS to the signed-in passenger's own number.
 * The server checks the lockout, the 30-second cooldown and the daily cap, and refuses any number that is not this account's.
 */
export async function sendPassengerOtp(phone: string): Promise<PassengerOtpSendResult> {
  const e164Phone = normalizePhoneE164(phone);
  try {
    const { ok, status, data } = await apiPostJson(supabase, '/api/auth/send-otp', { phone: e164Phone }, { timeoutMs: 20000 });
    if (ok && data.success) {
      return { success: true, message: data.message || 'OTP SMS sent successfully.' };
    }
    return {
      success: false,
      error: data.error || getLocalizedError('Nabigong ipadala ang OTP SMS.', 'Failed to send OTP SMS.'),
      locked: Boolean(data.is_locked),
      lockSeconds: data.is_locked ? secondsFromMinutes(data.minutes_remaining) || 15 * 60 : undefined,
      cooldownSeconds: typeof data.cooldown_remaining_seconds === 'number' ? data.cooldown_remaining_seconds : undefined,
      dailyCapReached: Boolean(data.daily_cap_reached),
      sessionMissing: status === 401,
    };
  } catch (err: any) {
    console.warn('[passengerApiService] Error connecting to /api/auth/send-otp:', err.message);
    return {
      success: false,
      error: getLocalizedError('Hindi maabot ang SMS server. Pakisubukang muli.', 'SMS server unreachable. Please try again.'),
    };
  }
}

/**
 * Asks the server to check the code. When it is right the SERVER activates this account (nothing is activated from the browser) and
 * counts a wrong code against the lockout; the age rule (Rule 4.3) is enforced there too, using the birth date on the record
 * or the one passed here.
 */
export interface PassengerOtpVerifyResult {
  success: boolean;
  error?: string;
  /** This wrong code was the one that locked the number (or it was already locked): 15 minutes, counted down on the screen. */
  locked?: boolean;
  lockSeconds?: number;
  /** The server refused because the passenger is under the minimum age (Rule 4.3). */
  underAge?: boolean;
  sessionMissing?: boolean;
}

export async function verifyPassengerOtp(
  phone: string,
  code: string,
  dateOfBirth?: string
): Promise<PassengerOtpVerifyResult> {
  const e164Phone = normalizePhoneE164(phone);
  const payload: Record<string, unknown> = { phone: e164Phone, code: (code || '').trim() };
  if (dateOfBirth) payload.date_of_birth = dateOfBirth;

  try {
    const { ok, status, data } = await apiPostJson(supabase, '/api/auth/verify-otp', payload, { timeoutMs: 15000 });
    if (ok && data.success) {
      // A fresh login-session token for this device (single-session rule). Own record only.
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (userData.user?.id) {
          const { data: own } = await supabase.from('passenger').select('passenger_id').eq('auth_user_id', userData.user.id).maybeSingle();
          if (own?.passenger_id) await rotatePassengerSession(own.passenger_id);
        }
      } catch (sessionErr) {
        console.warn('[passengerApiService] could not rotate the login session after verification:', sessionErr);
      }
      return { success: true };
    }
    return {
      success: false,
      error: data.error || getLocalizedError('Maling OTP code o nag-expire na ito.', 'Incorrect or expired OTP code.'),
      locked: Boolean(data.is_locked),
      lockSeconds: data.is_locked ? secondsFromMinutes(data.minutes_remaining) || 15 * 60 : undefined,
      underAge: Boolean(data.under_age),
      sessionMissing: status === 401,
    };
  } catch (err: any) {
    console.warn('[passengerApiService] Error connecting to /api/auth/verify-otp:', err.message);
    return {
      success: false,
      error: getLocalizedError('Hindi makakonekta sa server. Pakisubukang muli.', 'Unable to connect to server. Please try again.'),
    };
  }
}

// ============================================================================
// ACCOUNT RESTRICTION (Batch 3 - suspension / deactivation)
// ============================================================================

/** Whether the signed-in passenger is suspended or deactivated, as decided by the database. */
export function getOwnAccountRestriction(role: 'passenger' | 'driver' = 'passenger'): Promise<AccountRestriction | null> {
  return fetchOwnAccountRestriction(supabase, role);
}

// ============================================================================
// SUPABASE AUTH SESSION LIFECYCLE (PASSENGER REGISTRATION)
// ============================================================================

/**
 * Writes a fresh session_id to public.passenger and persists the token in
 * localStorage so Login.tsx can compare it on the next login attempt.
 * Call this at login time (not only at OTP time) to enforce single-session.
 */
export async function rotatePassengerSession(passengerId: string): Promise<string> {
  const newSessionId = crypto.randomUUID();
  await supabase
    .from('passenger')
    .update({ session_id: newSessionId })
    .eq('passenger_id', passengerId);
  try {
    localStorage.setItem('sakay_session_token', newSessionId);
  } catch {}
  return newSessionId;
}

/**
 * Creates the passenger's Supabase Auth account (or resumes an unfinished registration with the same password) and makes sure an
 * authenticated session is active in this browser, then makes sure the passenger's own record exists, as Pending OTP Verification.
 *
 * Perimeter lockdown: nothing here looks at anybody else's record, tries other passwords, or writes an account status.
 * "Already registered" is learned from the sign-up itself: a login that already exists answers with an error, and the only way past
 * it is to know its password (an unfinished registration, still Pending).
 */
export async function ensurePassengerAuthSession(
  phone: string,
  password: string,
  fullName?: string
): Promise<{ success: boolean; error?: string }> {
  const candidates = getPhoneLookupCandidates(phone);
  const e164Phone = candidates.e164;
  const passengerEmail = `passenger_${candidates.phone63NoPlus}@sakay.ph`;
  const alreadyRegistered = {
    success: false,
    error: getLocalizedError(
      'Ang numerong ito ay nakarehistro na. Mangyaring mag-log in na lamang.',
      'This mobile number is already registered. Please log in instead.'
    ),
  };

  try {
    // 1. A clean slate: sign out any session left in this browser.
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData?.session) {
      await supabase.auth.signOut();
    }

    // 2. Create the login. (Only sign-up data that is needed to create a PENDING record; roles are never granted from it.)
    const { error: signUpError } = await supabase.auth.signUp({
      email: passengerEmail,
      password: password,
      options: {
        data: {
          role: 'passenger',
          full_name: fullName || null,
          contact_number: e164Phone,
        },
      },
    });
    const exists = Boolean(
      signUpError &&
        (signUpError.message?.toLowerCase().includes('already registered') || (signUpError as any)?.code === 'user_already_exists')
    );
    if (signUpError && !exists) {
      console.error('[PASSENGER REGISTRATION AUTH] Registration error:', signUpError.message);
      return { success: false, error: signUpError.message };
    }

    // 3. Be signed in (also how an unfinished registration is resumed). A wrong password for an existing login ends here.
    const signIn = await supabase.auth.signInWithPassword({ email: passengerEmail, password: password });
    if (signIn.error || !signIn.data?.user) {
      return exists ? alreadyRegistered : { success: false, error: signIn.error?.message || 'Failed to sign in after registration.' };
    }
    const authUser = signIn.data.user;

    // 4. The passenger's own record (Row-level security shows each passenger only their own).
    const { data: own, error: ownErr } = await supabase
      .from('passenger')
      .select('passenger_id, account_status')
      .eq('auth_user_id', authUser.id)
      .maybeSingle();
    if (ownErr) {
      console.error('[PASSENGER REGISTRATION AUTH] Passenger lookup error:', ownErr.message);
      return { success: false, error: ownErr.message };
    }
    if (own && own.account_status !== 'Pending OTP Verification') {
      await supabase.auth.signOut();
      return alreadyRegistered;
    }

    if (own) {
      const updateObj: Record<string, any> = { contact_number: e164Phone, email: passengerEmail };
      if (fullName) updateObj.full_name = fullName;
      const { error: upErr } = await supabase.from('passenger').update(updateObj).eq('passenger_id', own.passenger_id);
      if (upErr) {
        console.error('[PASSENGER REGISTRATION AUTH] Update error:', upErr.message, upErr.code);
        return { success: false, error: upErr.message };
      }
    } else {
      const { error: insErr } = await supabase.from('passenger').insert([
        {
          auth_user_id: authUser.id,
          contact_number: e164Phone,
          email: passengerEmail,
          full_name: fullName || 'Passenger',
          account_status: 'Pending OTP Verification',
        },
      ]);
      if (insErr) {
        console.error('[PASSENGER REGISTRATION AUTH] Insert error:', insErr.message, insErr.code);
        return { success: false, error: insErr.message };
      }
    }
    return { success: true };
  } catch (err: any) {
    console.error('[PASSENGER REGISTRATION AUTH] Exception in ensurePassengerAuthSession:', err);
    return { success: false, error: err.message || 'Registration failed' };
  }
}
