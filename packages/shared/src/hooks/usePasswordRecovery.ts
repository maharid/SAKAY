import { useCallback, useEffect, useState } from 'react';
import {
  confirmPasswordReset,
  recoveryProblemText,
  requestPasswordResetCode,
  type RecoveryLanguage,
  type RecoveryProblem,
  type RecoveryResult,
  type RecoveryRole,
} from '../utils/passwordRecovery';

/**
 * The state of the two password-recovery screens (ask for a code, then enter it with the new password) for either app: what is being
 * waited for, what to tell the person, how long until another code may be asked for, and the lock after five wrong codes (Rule 4.7).
 * The server holds every real limit; this only mirrors the waits it reports so the buttons say so.
 */
export interface PasswordRecovery {
  /** a call is in flight */
  busy: boolean;
  /** what went wrong with the last call, in the app's language (null after a success or clear) */
  message: string | null;
  problem: RecoveryProblem | null;
  /** seconds until another code may be asked for (0 = now) */
  resendSeconds: number;
  /** minutes the number is locked for (0 = not locked) */
  lockedMinutes: number;
  /** ask for a code; true when it was sent */
  requestCode: (phone: string) => Promise<boolean>;
  /** change the password; true when it was changed */
  changePassword: (phone: string, code: string, newPassword: string) => Promise<boolean>;
  /** a code was just sent by the screen before this one: start the wait for the next */
  startResendWait: () => void;
  clearMessage: () => void;
}

const RESEND_WAIT_SECONDS = 30;

export function usePasswordRecovery(role: RecoveryRole, language: RecoveryLanguage): PasswordRecovery {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<RecoveryProblem | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resendUntil, setResendUntil] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const waiting = resendUntil > now || lockedUntil > now;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  const fail = useCallback((result: RecoveryResult) => {
    const at = Date.now();
    setNow(at);
    setProblem(result.problem ?? 'invalid');
    setMessage(recoveryProblemText(result, language));
    if (result.problem === 'cooldown' || result.problem === 'busy') setResendUntil(at + (result.waitSeconds ?? RESEND_WAIT_SECONDS) * 1000);
    if (result.problem === 'locked') setLockedUntil(at + (result.minutesRemaining ?? 15) * 60_000);
  }, [language]);

  const requestCode = useCallback(async (phone: string): Promise<boolean> => {
    setBusy(true);
    setMessage(null);
    setProblem(null);
    const result = await requestPasswordResetCode(role, phone);
    setBusy(false);
    if (result.success) {
      const at = Date.now();
      setNow(at);
      setResendUntil(at + RESEND_WAIT_SECONDS * 1000);
      return true;
    }
    fail(result);
    return false;
  }, [role, fail]);

  const changePassword = useCallback(async (phone: string, code: string, newPassword: string): Promise<boolean> => {
    setBusy(true);
    setMessage(null);
    setProblem(null);
    const result = await confirmPasswordReset(role, phone, code, newPassword);
    setBusy(false);
    if (result.success) return true;
    fail(result);
    return false;
  }, [role, fail]);

  const startResendWait = useCallback(() => {
    const at = Date.now();
    setNow(at);
    setResendUntil(at + RESEND_WAIT_SECONDS * 1000);
  }, []);

  const clearMessage = useCallback(() => { setMessage(null); setProblem(null); }, []);

  return {
    busy,
    message,
    problem,
    resendSeconds: Math.max(0, Math.ceil((resendUntil - now) / 1000)),
    lockedMinutes: lockedUntil > now ? Math.ceil((lockedUntil - now) / 60_000) : 0,
    requestCode,
    changePassword,
    startResendWait,
    clearMessage,
  };
}
