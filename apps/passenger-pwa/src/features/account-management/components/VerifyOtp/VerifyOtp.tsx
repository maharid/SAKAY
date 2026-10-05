import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  IconButton,
  TextField,
  CircularProgress,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';

import Logo from '../../../../common/components/Logo';
import PrimaryButton from '../../../../common/components/PrimaryButton';
import SakayToast from '../../../../common/components/SakayToast';
import { useLanguage } from '../../../../utils/LanguageContext';
import {
  sendPassengerOtp,
  verifyPassengerOtp,
  getPhoneLookupCandidates,
} from '../../../../services/passengerApiService';
import { supabase } from '../../../../services/supabaseClient';

const formatDisplayPhone = (raw: string = ''): string => {
  const digits = raw.replace(/\D/g, '');
  let norm = digits;
  if (norm.startsWith('639') && norm.length === 12) {
    norm = '0' + norm.slice(2);
  } else if (norm.startsWith('63') && norm.length >= 11) {
    norm = '0' + norm.slice(2);
  } else if (norm.startsWith('9') && norm.length === 10) {
    norm = '0' + norm;
  }
  if (norm.length <= 4) return norm;
  if (norm.length <= 7) return `${norm.slice(0, 4)} ${norm.slice(4)}`;
  return `${norm.slice(0, 4)} ${norm.slice(4, 7)} ${norm.slice(7, 11)}`;
};

export const VerifyOtp: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { language } = useLanguage();
  const state = location.state as {
    phone?: string;
    identifier?: string;
    isRecovery?: boolean;
    isPhoneChange?: boolean;
    returnTo?: string;
    passengerName?: string;
    fullName?: string;
    date_of_birth?: string;
    fromLogin?: boolean;
  } | undefined;

  // The account's own record, used when the screen was opened without route state (a page reload on this screen loses it).
  const [ownRecord, setOwnRecord] = useState<{ phone: string; name: string; dob?: string } | null>(null);

  const resolvedPhone = state?.phone || state?.identifier || ownRecord?.phone || '';
  const resolvedName = state?.passengerName || state?.fullName || ownRecord?.name || 'Passenger';
  const resolvedDob = state?.date_of_birth || ownRecord?.dob;

  const [otp, setOtp] = useState<string[]>(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [toastError, setToastError] = useState<string | null>(null);
  const [toastInfo, setToastInfo] = useState<string | null>(null);
  // Two different waits, two different clocks:
  //   resendCooldown  seconds before another code may be requested (about a minute after every send)
  //   lockRemaining   seconds the number is LOCKED after too many wrong codes (15 minutes); nothing can be entered or requested
  const [resendCooldown, setResendCooldown] = useState(60);
  const [lockRemaining, setLockRemaining] = useState(0);
  const [resendKey, setResendKey] = useState(0);
  const isLockedOut = lockRemaining > 0;

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const hasAutoApprovedRef = useRef(false);
  const hasDispatchedInitialOtpRef = useRef(false);
  const isComplete = otp.every((digit) => digit !== '');

  const mmss = (seconds: number): string =>
    `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  // This screen needs the signed-in session (the server sends and checks the code for THAT account). Without one, the way forward is
  // the login screen, which brings a pending account straight back here.
  const sendToLogin = useCallback(() => {
    navigate('/login', { replace: true, state: { otpSessionEnded: true } });
  }, [navigate]);

  // Opened without route state (reload): take the number from the signed-in account's own record; an account that is already active
  // has nothing to verify.
  useEffect(() => {
    if (state?.phone || state?.identifier) return;
    let alive = true;
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id;
      if (!userId) {
        if (alive) sendToLogin();
        return;
      }
      const { data: own } = await supabase
        .from('passenger')
        .select('contact_number, full_name, date_of_birth, account_status')
        .eq('auth_user_id', userId)
        .maybeSingle();
      if (!alive) return;
      if (!own) {
        sendToLogin();
      } else if (own.account_status === 'Active') {
        navigate('/dashboard', { replace: true });
      } else {
        setOwnRecord({ phone: own.contact_number || '', name: own.full_name || 'Passenger', dob: own.date_of_birth || undefined });
      }
    })();
    return () => {
      alive = false;
    };
  }, [state?.phone, state?.identifier, navigate, sendToLogin]);

  /** Shows what the server said about a code request: a lock, a cooldown, the daily cap, or a plain failure. */
  const applySendFailure = useCallback(
    (result: Awaited<ReturnType<typeof sendPassengerOtp>>) => {
      if (result.sessionMissing) {
        sendToLogin();
        return;
      }
      if (result.locked) {
        setLockRemaining(result.lockSeconds || 15 * 60);
        return;
      }
      if (result.cooldownSeconds && result.cooldownSeconds > 0) {
        // a code was sent a moment ago (for example just before logging in): not an error, just wait
        setResendCooldown(result.cooldownSeconds);
        setToastInfo(
          language === 'tl'
            ? `May ipinadala nang code kani-kanina lang. Maaari kang humingi muli sa loob ng ${result.cooldownSeconds} segundo.`
            : `A code was sent a moment ago. You can request another in ${result.cooldownSeconds} seconds.`
        );
        return;
      }
      setToastError(
        result.error ||
          (language === 'tl' ? 'Hindi maipadala ang OTP code. Pakisubukang muli.' : 'Failed to send OTP code. Please try again.')
      );
    },
    [language, sendToLogin]
  );

  // Automatically initiate sending OTP SMS as soon as the user lands on this screen
  useEffect(() => {
    if (hasDispatchedInitialOtpRef.current || !resolvedPhone) return;
    hasDispatchedInitialOtpRef.current = true;

    const dispatchInitialOtp = async () => {
      setToastError(null);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
          sendToLogin();
          return;
        }
        let result = await sendPassengerOtp(resolvedPhone);
        if (!result.success && result.error && result.error.toLowerCase().includes('unreachable')) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          result = await sendPassengerOtp(resolvedPhone);
        }

        if (result.success) {
          setResendCooldown(60);
        } else {
          applySendFailure(result);
        }
      } catch (err: any) {
        console.warn('[VerifyOtp] Initial OTP dispatch error:', err);
        setToastError(
          language === 'tl'
            ? 'Nagkaroon ng aberya sa koneksyon sa SMS server.'
            : 'Connection error reaching the SMS server.'
        );
      }
    };

    dispatchInitialOtp();
  }, [resolvedPhone, language, applySendFailure, sendToLogin]);

  // The resend cooldown counts down on its own clock ...
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown((prev) => Math.max(0, prev - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown > 0]);

  // ... and the lock on another. When the lock ends the boxes open again (the server decides the same thing: its lock is a time window).
  useEffect(() => {
    if (lockRemaining <= 0) return;
    const timer = setInterval(() => setLockRemaining((prev) => Math.max(0, prev - 1)), 1000);
    return () => clearInterval(timer);
  }, [lockRemaining > 0]);

  const [isResending, setIsResending] = useState(false);

  // Core verification function
  const executeVerification = useCallback(
    async (enteredCode: string) => {
      if (enteredCode.length < 6 || loading || isLockedOut) return;

      setLoading(true);
      setToastError(null);

      try {
        // The server checks the code for the account that is signed in. After registration, and after a login that found the number
        // still unverified, the browser is signed in already. If the session is gone, the login screen brings the account back here.
        const activeAuthUser = (await supabase.auth.getUser()).data.user;
        if (!activeAuthUser) {
          hasAutoApprovedRef.current = false;
          setLoading(false);
          sendToLogin();
          return;
        }
        const result = await verifyPassengerOtp(resolvedPhone, enteredCode, resolvedDob);
        if (!result.success) {
          hasAutoApprovedRef.current = false;
          setLoading(false);
          if (result.sessionMissing) {
            sendToLogin();
            return;
          }
          setOtp(['', '', '', '', '', '']);
          if (result.locked) {
            // the wrong code that locked the number: show the countdown instead of a message about requesting a new code
            setLockRemaining(result.lockSeconds || 15 * 60);
          } else {
            setToastError(result.error || (language === 'tl' ? 'Maling OTP code. Pakisubukang muli.' : 'Incorrect OTP code. Please try again.'));
            setTimeout(() => inputRefs.current[0]?.focus(), 50);
          }
          return;
        }

        // The server has verified the code and activated this account. Nothing is activated from the browser any more (no
        // activate_passenger_otp call, no status written into the profile, no sign-up fallback, no default password).
        const candidates = getPhoneLookupCandidates(resolvedPhone);
        const e164Phone = candidates.e164;
        try {
          localStorage.setItem('sakay_passenger_phone', e164Phone);
          localStorage.setItem('sakay_passenger_status', 'Active');
          localStorage.removeItem('sakay_passenger_password');
        } catch {}

        setLoading(false);

        const isPhoneChange = Boolean(state?.isPhoneChange);
        const returnTo = state?.returnTo || '/profile';

        if (isPhoneChange) {
          navigate(returnTo, { state: { phoneUpdated: true }, replace: true });
        } else {
          // Signed in and verified: on to the consent screens and then the dashboard. No second login.
          navigate('/terms-of-service', {
            state: {
              phone: e164Phone,
              passengerName: resolvedName,
              fromRegistration: true,
            },
          });
        }
      } catch (err: any) {
        console.error('[PassengerVerifyOtp] Verification exception:', err);
        hasAutoApprovedRef.current = false;
        setLoading(false);
        setToastError(language === 'tl' ? 'Hindi makumpleto ang pagpapatunay. Pakisubukang muli.' : 'Verification could not be completed. Please try again.');
      }
    },
    [loading, isLockedOut, resolvedPhone, resolvedDob, state, language, resolvedName, navigate, sendToLogin]
  );

  const handleIncomingSmsOtp = useCallback(
    (incomingCode: string) => {
      const cleaned = (incomingCode || '').replace(/\D/g, '').slice(0, 6);
      if (cleaned.length !== 6 || hasAutoApprovedRef.current || loading || isLockedOut) return;

      hasAutoApprovedRef.current = true;
      const digits = cleaned.split('');
      setOtp(digits);
      setToastError(null);

      setTimeout(() => {
        executeVerification(cleaned);
      }, 400);
    },
    [loading, isLockedOut, executeVerification]
  );

  useEffect(() => {
    let isMounted = true;
    const abortController = new AbortController();

    if (typeof window !== 'undefined' && 'OTPCredential' in window) {
      navigator.credentials
        .get({
          otp: { transport: ['sms'] },
          signal: abortController.signal,
        } as any)
        .then((content: any) => {
          if (!isMounted) return;
          if (content && content.code) {
            handleIncomingSmsOtp(content.code);
          }
        })
        .catch(() => {});
    }

    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, [handleIncomingSmsOtp, resendKey]);

  const handleOtpChange = (index: number, val: string) => {
    if (isLockedOut) return;
    const rawChar = val.replace(/\D/g, '');
    const newOtp = [...otp];

    if (!rawChar) {
      newOtp[index] = '';
      setOtp(newOtp);
      return;
    }

    if (rawChar.length > 1) {
      const pasted = rawChar.slice(0, 6).split('');
      pasted.forEach((ch, idx) => {
        if (index + idx < 6) newOtp[index + idx] = ch;
      });
      setOtp(newOtp);
      const nextIdx = Math.min(index + pasted.length, 5);
      inputRefs.current[nextIdx]?.focus();
      if (newOtp.every((d) => d !== '')) {
        hasAutoApprovedRef.current = true;
        executeVerification(newOtp.join(''));
      }
      return;
    }

    newOtp[index] = rawChar.slice(-1);
    setOtp(newOtp);
    setToastError(null);

    if (rawChar && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    if (newOtp.every((digit) => digit !== '')) {
      hasAutoApprovedRef.current = true;
      executeVerification(newOtp.join(''));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!otp[index] && index > 0) {
        const newOtp = [...otp];
        newOtp[index - 1] = '';
        setOtp(newOtp);
        inputRefs.current[index - 1]?.focus();
      }
    }
  };

  const handleResendOtp = async () => {
    if (resendCooldown > 0 || isResending || loading || isLockedOut) return;
    setToastError(null);
    setToastInfo(null);
    setIsResending(true);

    try {
      const result = await sendPassengerOtp(resolvedPhone);
      setIsResending(false);
      if (result.success) {
        hasAutoApprovedRef.current = false;
        setResendCooldown(60);
        setOtp(['', '', '', '', '', '']);
        setResendKey((prev) => prev + 1);
        setToastInfo(language === 'tl' ? 'Matagumpay na naipadala ang bagong OTP code sa iyong numero.' : 'New OTP sent to your number.');
      } else {
        applySendFailure(result);
      }
    } catch {
      setIsResending(false);
      setToastError(language === 'tl' ? 'Nagkaroon ng aberya sa koneksyon. Pakisubukang muli.' : 'Network connection error. Please try again.');
    }
  };

  const resendBlocked = resendCooldown > 0 || isResending || loading || isLockedOut;
  const phoneCandidates = getPhoneLookupCandidates(resolvedPhone);
  const displayPhone = formatDisplayPhone(phoneCandidates.phone09);

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        backgroundColor: '#FFFFFF',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Toast Feedback for Errors (Incorrect OTP) and Resend Info */}
      <SakayToast
        open={Boolean(toastError)}
        message={toastError}
        severity="error"
        onClose={() => setToastError(null)}
      />
      <SakayToast
        open={Boolean(toastInfo)}
        message={toastInfo}
        severity="success"
        onClose={() => setToastInfo(null)}
      />

      {/* Pinned Top Navigation Bar with Back Button and Logo */}
      <Box
        sx={{
          padding: 'calc(var(--safe-area-top) + 16px) 24px 12px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#FFFFFF',
          flexShrink: 0,
          zIndex: 20,
        }}
      >
        <IconButton
          onClick={() => {
            if (state?.returnTo) navigate(state.returnTo);
            else if (state?.isRecovery) navigate('/forgot-password');
            else if (window.history.length > 1) navigate(-1);
            else navigate('/register');
          }}
          sx={{
            color: '#0F172A',
            backgroundColor: '#FFFFFF',
            borderRadius: '14px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
            width: 44,
            height: 44,
            '&:hover': { backgroundColor: '#F8FAFC' },
          }}
        >
          <ArrowBackIcon sx={{ fontSize: 20 }} />
        </IconButton>
        <Logo color="orange" width={110} />
      </Box>

      {/* Main Content Area */}
      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 24px 16px 24px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Title Section */}
        <Box sx={{ mb: 3.5, mt: 1 }}>
          <Typography
            sx={{
              fontSize: '26px',
              fontWeight: 800,
              color: '#0F172A',
              lineHeight: 1.2,
              letterSpacing: '-0.5px',
            }}
          >
            {language === 'tl' ? 'I-verify ang Mobile Number' : 'Verify Mobile Number'}
          </Typography>
          <Typography
            sx={{
              fontSize: '15px',
              color: '#64748B',
              mt: 0.75,
              fontWeight: 500,
              lineHeight: 1.4,
            }}
          >
            {language === 'tl'
              ? `Nagpadala kami ng 6-digit code sa `
              : `We sent a 6-digit verification code to `}
            <Box component="span" sx={{ fontWeight: 700, color: '#0F172A', whiteSpace: 'nowrap' }}>
              {displayPhone || 'iyong numero'}
            </Box>
            .
          </Typography>
        </Box>

        {/* The lock after too many wrong codes: a live countdown, separate from the resend cooldown below */}
        {isLockedOut && (
          <Box
            role="alert"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              p: '14px 16px',
              borderRadius: '14px',
              backgroundColor: '#FEF2F2',
              border: '1.5px solid #FECACA',
              mb: 1,
            }}
          >
            <LockOutlinedIcon sx={{ color: '#DC2626', fontSize: 22, flexShrink: 0 }} />
            <Box>
              <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#991B1B', lineHeight: 1.35 }}>
                {language === 'tl'
                  ? 'Masyadong maraming maling code. Subukan muli sa loob ng'
                  : 'Too many incorrect attempts. Try again in'}{' '}
                <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800 }}>
                  {mmss(lockRemaining)}
                </Box>
              </Typography>
              <Typography sx={{ fontSize: '12px', color: '#B91C1C', mt: 0.25 }}>
                {language === 'tl'
                  ? 'Hindi muna maaaring maglagay o humingi ng code habang naka-lock.'
                  : 'You cannot enter or request a code while the number is locked.'}
              </Typography>
            </Box>
          </Box>
        )}

        {/* 6 OTP Input Boxes */}
        <Box
          sx={{
            display: 'flex',
            justify: 'space-between',
            gap: 1.2,
            my: 2,
          }}
        >
          {otp.map((digit, index) => (
            <TextField
              key={index}
              inputRef={(el) => (inputRefs.current[index] = el)}
              value={digit}
              onChange={(e) => handleOtpChange(index, e.target.value)}
              onKeyDown={(e: any) => handleKeyDown(index, e)}
              type="tel"
              disabled={isLockedOut || loading}
              slotProps={{
                htmlInput: {
                  maxLength: 6,
                  inputMode: 'numeric',
                  pattern: '[0-9]*',
                  autoComplete: index === 0 ? 'one-time-code' : 'off',
                  style: {
                    textAlign: 'center',
                    fontSize: '22px',
                    fontWeight: 800,
                    color: '#0F172A',
                    padding: 0,
                    height: '58px',
                  },
                },
              }}
              sx={{
                flex: 1,
                backgroundColor: digit ? '#FFF8F3' : '#F8FAFC',
                borderRadius: '16px',
                '& .MuiOutlinedInput-root': {
                  borderRadius: '16px',
                  height: '58px',
                  border: digit ? '1.5px solid #FF6B00' : '1px solid #E2E8F0',
                  '&.Mui-focused': {
                    borderColor: '#FF6B00',
                    boxShadow: '0 0 0 3px rgba(255, 107, 0, 0.12)',
                  },
                  '& fieldset': { border: 'none' },
                },
              }}
            />
          ))}
        </Box>

        {/* Resend Code Section */}
        <Box
          component="button"
          type="button"
          onClick={handleResendOtp}
          disabled={resendBlocked}
          sx={{
            width: '100%',
            height: '48px',
            borderRadius: '14px',
            backgroundColor: resendBlocked ? '#F8FAFC' : '#FFFFFF',
            border: resendBlocked ? '1.5px solid #E2E8F0' : '1.5px solid #FF6B00',
            color: resendBlocked ? '#94A3B8' : '#FF6B00',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            cursor: resendBlocked ? 'not-allowed' : 'pointer',
            outline: 'none',
            fontSize: '14.5px',
            fontWeight: 700,
            fontFamily: 'inherit',
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            '&:hover': resendBlocked ? {} : {
              backgroundColor: 'rgba(255, 107, 0, 0.06)',
              borderColor: '#E66000',
              color: '#E66000',
              transform: 'translateY(-1px)',
            },
            '&:active': resendBlocked ? {} : {
              backgroundColor: 'rgba(255, 107, 0, 0.12)',
              transform: 'translateY(0)',
            },
          }}
        >
          {isResending ? (
            <CircularProgress size={18} sx={{ color: '#FF6B00' }} />
          ) : (
            <RefreshRoundedIcon sx={{ fontSize: 19, color: 'inherit' }} />
          )}
          <Typography sx={{ fontSize: '14.5px', fontWeight: 700, color: 'inherit' }}>
            {isResending
              ? (language === 'tl' ? 'Ipinapadala...' : 'Sending...')
              : isLockedOut
              ? (language === 'tl' ? 'Naka-lock ang numero' : 'Number locked')
              : resendCooldown > 0
              ? (language === 'tl' ? `Muling magpadala sa (${resendCooldown}s)` : `Resend code in (${resendCooldown}s)`)
              : (language === 'tl' ? 'Ipadala Muli ang Code' : 'Resend Code')}
          </Typography>
        </Box>
      </Box>

      {/* Pinned Bottom Action Bar */}
      <Box
        sx={{
          padding: '12px 24px calc(var(--safe-area-bottom) + 16px) 24px',
          backgroundColor: '#FFFFFF',
          borderTop: '1px solid #F1F5F9',
          flexShrink: 0,
          zIndex: 30,
        }}
      >
        <PrimaryButton
          onClick={() => executeVerification(otp.join(''))}
          fullWidth
          loading={loading}
          disabled={!isComplete || loading || isLockedOut}
          sx={{
            height: '56px',
            borderRadius: '16px',
            fontSize: '16px',
            fontWeight: 800,
            backgroundColor: isComplete ? '#FF6B00' : '#E2E8F0',
            color: isComplete ? '#FFFFFF' : '#94A3B8',
            boxShadow: 'none',
            '&.Mui-disabled': {
              backgroundColor: '#E2E8F0',
              color: '#94A3B8',
            },
            '&:hover': {
              backgroundColor: isComplete ? '#E66000' : '#E2E8F0',
              boxShadow: 'none',
            },
          }}
        >
          {language === 'tl' ? 'Kumpirmahin' : 'Confirm'}
        </PrimaryButton>
      </Box>
    </Box>
  );
};

export default VerifyOtp;
