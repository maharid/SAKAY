import { apiPostPublic } from './apiClient';

/**
 * Password recovery, the app side (Rule 4.2): ask the server to text a code to the number of the account, then send the code with the new
 * password. The server (server/src/routes/passwordResetRoutes.ts) does every check; this only carries the two calls and turns the server's
 * answer into something a screen can show in Tagalog or English. Neither call needs a sign-in.
 */

export type RecoveryRole = 'passenger' | 'driver';
export type RecoveryLanguage = 'tl' | 'en';

export type RecoveryProblem =
  | 'invalid'        // the number or the code is not in the right form
  | 'cooldown'       // a code was sent a moment ago: wait `waitSeconds`
  | 'daily'          // five codes today
  | 'locked'         // five wrong codes: locked for `minutesRemaining`
  | 'wrong'          // a wrong code: `attemptsLeft` tries left
  | 'expired'        // no code, or it ran out: ask for a new one
  | 'weak'           // the new password breaks the rules
  | 'failed'         // the code was right but the password could not be changed: ask for a new code
  | 'sms'            // the text message could not be sent
  | 'busy'           // too many requests from this connection: wait `waitSeconds`
  | 'unavailable'    // the server cannot decide right now
  | 'network';       // the server could not be reached

export interface RecoveryResult {
  success: boolean;
  problem?: RecoveryProblem;
  waitSeconds?: number;
  minutesRemaining?: number;
  attemptsLeft?: number;
}

const OK: RecoveryResult = { success: true };

function toResult(res: { ok: boolean; status: number; data: Record<string, any> }): RecoveryResult {
  if (res.ok && res.data.success !== false) return OK;
  const d = res.data;
  if (res.status === 429) {
    if (d.is_locked) return { success: false, problem: 'locked', minutesRemaining: Number(d.minutes_remaining ?? 15) };
    if (d.daily_cap_reached) return { success: false, problem: 'daily' };
    if (d.cooldown_remaining_seconds !== undefined) return { success: false, problem: 'cooldown', waitSeconds: Number(d.cooldown_remaining_seconds) };
    return { success: false, problem: 'busy', waitSeconds: Number(d.retry_after_seconds ?? 60) };
  }
  if (res.status === 400) {
    if (d.weak_password) return { success: false, problem: 'weak' };
    if (d.attempts_left !== undefined) return { success: false, problem: 'wrong', attemptsLeft: Number(d.attempts_left) };
    if (d.code_expired) return { success: false, problem: 'expired' };
    return { success: false, problem: 'invalid' };
  }
  if (res.status === 502) return { success: false, problem: d.code_expired ? 'failed' : 'sms' };
  if (res.status === 503 || res.status >= 500) return { success: false, problem: 'unavailable' };
  return { success: false, problem: 'invalid' };
}

async function send(path: string, payload: Record<string, unknown>): Promise<RecoveryResult> {
  try {
    return toResult(await apiPostPublic(path, payload));
  } catch {
    return { success: false, problem: 'network' };
  }
}

/** Ask for a code. `phone` may be typed in any Philippine format. */
export const requestPasswordResetCode = (role: RecoveryRole, phone: string): Promise<RecoveryResult> =>
  send('/api/password-reset/request', { role, phone });

/** Send the code and the new password. The server checks the password rules first, so a weak password does not use up the code. */
export const confirmPasswordReset = (role: RecoveryRole, phone: string, code: string, newPassword: string): Promise<RecoveryResult> =>
  send('/api/password-reset/confirm', { role, phone, code, new_password: newPassword });

const minutesText = (m: number, tl: boolean): string => `${Math.max(1, Math.ceil(m))} ${tl ? 'minuto' : m > 1 ? 'minutes' : 'minute'}`;
const secondsText = (s: number, tl: boolean): string => `${Math.max(1, Math.ceil(s))} ${tl ? 'segundo' : s > 1 ? 'seconds' : 'second'}`;

/** What to tell the person about a failed call, in the language of the app. */
export function recoveryProblemText(result: RecoveryResult, language: RecoveryLanguage): string {
  const tl = language === 'tl';
  switch (result.problem) {
    case 'cooldown':
      return tl ? `Maghintay ng ${secondsText(result.waitSeconds ?? 30, true)} bago humiling ng bagong code.` : `Please wait ${secondsText(result.waitSeconds ?? 30, false)} before asking for another code.`;
    case 'daily':
      return tl ? 'Naabot na ang limitasyon ng 5 code sa isang araw. Subukan muli bukas.' : 'You have reached the limit of 5 codes a day. Please try again tomorrow.';
    case 'locked':
      return tl
        ? `Masyadong maraming maling code. Subukan muli pagkalipas ng ${minutesText(result.minutesRemaining ?? 15, true)}.`
        : `Too many wrong codes. Please try again in ${minutesText(result.minutesRemaining ?? 15, false)}.`;
    case 'wrong': {
      const n = result.attemptsLeft ?? 0;
      return tl ? `Mali ang code. May ${n} subok ka pa.` : `That code is not right. You have ${n} ${n === 1 ? 'try' : 'tries'} left.`;
    }
    case 'expired':
      return tl ? 'Nag-expire na ang code o wala pang naipapadala. Humiling ng bagong code.' : 'The code has expired or none was sent. Please ask for a new code.';
    case 'weak':
      return tl
        ? 'Hindi sapat ang lakas ng bagong password. Dapat ay hindi bababa sa 8 karakter na may malaki at maliit na titik, numero at simbolo.'
        : 'The new password is not strong enough. It needs at least 8 characters with upper and lower case letters, a number and a symbol.';
    case 'failed':
      return tl ? 'Hindi napalitan ang password. Humiling ng bagong code at subukan muli.' : 'The password could not be changed. Please ask for a new code and try again.';
    case 'sms':
      return tl ? 'Hindi maipadala ang SMS ngayon. Subukan muli sa ilang sandali.' : 'The text message could not be sent right now. Please try again in a moment.';
    case 'busy':
      return tl ? `Masyadong maraming subok mula sa koneksyong ito. Subukan muli pagkalipas ng ${minutesText((result.waitSeconds ?? 60) / 60, true)}.` : `Too many attempts from this connection. Please try again in ${minutesText((result.waitSeconds ?? 60) / 60, false)}.`;
    case 'unavailable':
      return tl ? 'Pansamantalang hindi available ang pag-recover ng password. Subukan muli mamaya.' : 'Password recovery is temporarily unavailable. Please try again later.';
    case 'network':
      return tl ? 'Hindi maabot ang server. Suriin ang iyong koneksyon at subukan muli.' : 'Could not reach the server. Check your connection and try again.';
    default:
      return tl ? 'Pakisuri ang numero at ang code, at subukan muli.' : 'Please check the number and the code, then try again.';
  }
}
