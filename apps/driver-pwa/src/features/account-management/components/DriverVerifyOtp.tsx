import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  IconButton,
  TextField,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';

import Logo from '../../../common/components/Logo';
import PrimaryButton from '../../../common/components/PrimaryButton';
import SakayToast from '../../../common/components/SakayToast';
import { useLanguage } from '../../../utils/LanguageContext';
import { sendDriverOtp, verifyDriverOtp, formatPhoneToE164, getPhoneLookupCandidates } from '../../../services/driverApiService';

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

export const DriverVerifyOtp: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, language } = useLanguage();
  const state = location.state as { phone?: string; driverName?: string } | undefined;

  const [otp, setOtp] = useState<string[]>(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [toastError, setToastError] = useState<string | null>(null);
  const [toastInfo, setToastInfo] = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState(60);
  const [resendKey, setResendKey] = useState(0);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const hasAutoApprovedRef = useRef(false);
  const hasDispatchedInitialOtpRef = useRef(false);
  const isComplete = otp.every((digit) => digit !== '');

  const targetPhone = state?.phone || (typeof window !== 'undefined' ? localStorage.getItem('sakay_driver_phone') : '') || '';

  // Automatically initiate sending OTP SMS as soon as the user lands on this screen
  useEffect(() => {
    if (hasDispatchedInitialOtpRef.current || !targetPhone) return;
    hasDispatchedInitialOtpRef.current = true;

    const dispatchInitialOtp = async () => {
      setToastError(null);
      try {
        const res = await sendDriverOtp(targetPhone);
        if (res.success) {
          setResendTimer(60);
        } else {
          setToastError(res.error || (language === 'tl' ? 'Hindi maipadala ang OTP SMS.' : 'Failed to send OTP SMS.'));
        }
      } catch (err: any) {
        console.warn('[DriverVerifyOtp] Initial OTP dispatch error:', err);
        setToastError(language === 'tl' ? 'Nagkaroon ng aberya sa koneksyon.' : 'Network error while requesting OTP.');
      }
    };

    dispatchInitialOtp();
  }, [targetPhone, t, language]);

  // Countdown timer for resend (continues running every second until timer reaches 0)
  useEffect(() => {
    if (resendTimer <= 0) return;
    const timer = setInterval(() => {
      setResendTimer((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendTimer]);

  // Core verification function
  const executeVerification = useCallback(
    async (enteredCode: string) => {
      if (enteredCode.length < 6 || loading) return;

      setLoading(true);
      setToastError(null);

      try {
        // The server checks the code against the signed-in driver's own number. There is no sandbox code, and if the server cannot be
        // reached the code is not verified. (The driver is already signed in: registration created the login before this screen.)
        const result = await verifyDriverOtp(targetPhone, enteredCode);
        if (!result.success) {
          setLoading(false);
          setToastError(result.error || (language === 'tl' ? 'Maling OTP code. Pakisubukang muli.' : 'Incorrect OTP code. Please try again.'));
          return;
        }

        const e164Phone = formatPhoneToE164(targetPhone);
        try {
          localStorage.setItem('sakay_driver_phone', e164Phone);
        } catch {}

        setLoading(false);
        navigate('/driver/terms-of-service', {
          replace: true,
          state: {
            driverName: state?.driverName || 'Bagong Drayber',
            phone: e164Phone,
            fromRegistration: true,
          },
        });
      } catch {
        setLoading(false);
        setToastError(language === 'tl' ? 'Hindi makumpleto ang verification.' : 'Verification service unavailable. Please check your connection.');
      }
    },
    [loading, navigate, state, language, targetPhone]
  );

  const handleIncomingSmsOtp = useCallback(
    (incomingCode: string) => {
      const cleaned = (incomingCode || '').replace(/\D/g, '').slice(0, 6);
      if (cleaned.length !== 6 || hasAutoApprovedRef.current || loading) return;

      hasAutoApprovedRef.current = true;
      const digits = cleaned.split('');
      setOtp(digits);
      setToastError(null);

      setTimeout(() => {
        executeVerification(cleaned);
      }, 400);
    },
    [loading, executeVerification]
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
    const cleaned = val.replace(/\D/g, '');
    if (cleaned.length >= 6) {
      const pasted = cleaned.slice(0, 6).split('');
      setOtp(pasted);
      setToastError(null);
      inputRefs.current[5]?.focus();
      return;
    }

    const singleDigit = cleaned ? cleaned.slice(-1) : '';
    const next = [...otp];
    next[index] = singleDigit;
    setOtp(next);
    setToastError(null);

    if (singleDigit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleResend = async () => {
    if (resendTimer > 0) return;
    setResendTimer(60);
    setToastError(null);
    setToastInfo(null);

    try {
      const res = await sendDriverOtp(targetPhone);
      if (res.success) {
        hasAutoApprovedRef.current = false;
        setOtp(['', '', '', '', '', '']);
        setResendKey((prev) => prev + 1);
        setToastInfo(language === 'tl' ? 'Matagumpay na naipadala ang bagong OTP code sa iyong numero.' : 'New OTP sent to your number.');
      } else {
        setToastError(res.error || (language === 'tl' ? 'Hindi maipadala ang OTP SMS.' : 'Failed to resend SMS OTP.'));
      }
    } catch {
      setToastError(language === 'tl' ? 'Nagkaroon ng aberya sa koneksyon.' : 'Network error while requesting new OTP.');
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const enteredCode = otp.join('');
    if (enteredCode.length < 6) {
      setToastError(language === 'tl' ? 'Mangyaring ilagay ang 6-digit OTP code.' : 'Please enter all 6 digits of the OTP code.');
      return;
    }
    executeVerification(enteredCode);
  };

  const phoneCandidates = getPhoneLookupCandidates(targetPhone);
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

      {/* 1. Header with Rounded Back Button and SAKAY Logo */}
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
            if (window.history.length > 1) navigate(-1);
            else navigate('/driver/register');
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

      {/* 2. Scrollable Form Content */}
      <Box
        component="form"
        onSubmit={handleManualSubmit}
        sx={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 24px calc(var(--safe-area-bottom) + 24px) 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        <Box sx={{ width: '100%', textAlign: 'left', mb: 3, mt: 1 }}>
          <Typography
            sx={{
              fontSize: '26px',
              fontWeight: 800,
              color: '#0F172A',
              lineHeight: 1.2,
              letterSpacing: '-0.5px',
              mb: 0.75,
            }}
          >
            {t.verifyOtpTitle}
          </Typography>
          <Typography sx={{ fontSize: '15px', color: '#64748B', fontWeight: 500 }}>
            {t.otpSentTo} <Box component="span" sx={{ fontWeight: 700, color: '#0F172A', whiteSpace: 'nowrap' }}>{displayPhone}</Box>.
          </Typography>
        </Box>

        {/* 6 Digit Inputs */}
        <Box sx={{ display: 'flex', gap: 1.2, justifyContent: 'center', width: '100%', mb: 2.5 }}>
          {otp.map((digit, i) => (
            <TextField
              key={i}
              inputRef={(el) => {
                inputRefs.current[i] = el;
              }}
              value={digit}
              onChange={(e) => handleOtpChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              slotProps={{
                htmlInput: {
                  maxLength: 6,
                  inputMode: 'numeric',
                  pattern: '[0-9]*',
                  autoComplete: i === 0 ? 'one-time-code' : 'off',
                  style: {
                    textAlign: 'center',
                    fontSize: '22px',
                    fontWeight: 800,
                    padding: 0,
                    height: '58px',
                    color: '#0F172A',
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

        {/* Resend Code Button Container */}
        <Box
          component="button"
          type="button"
          onClick={handleResend}
          disabled={resendTimer > 0}
          sx={{
            width: '100%',
            height: '48px',
            borderRadius: '14px',
            backgroundColor: resendTimer > 0 ? '#F8FAFC' : '#FFFFFF',
            border: resendTimer > 0 ? '1.5px solid #E2E8F0' : '1.5px solid #FF6B00',
            color: resendTimer > 0 ? '#94A3B8' : '#FF6B00',
            boxShadow: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            cursor: resendTimer > 0 ? 'not-allowed' : 'pointer',
            outline: 'none',
            fontSize: '14.5px',
            fontWeight: 700,
            fontFamily: 'inherit',
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            '&:hover': resendTimer > 0 ? {} : {
              backgroundColor: 'rgba(255, 107, 0, 0.06)',
              borderColor: '#E66000',
              color: '#E66000',
              transform: 'translateY(-1px)',
            },
            '&:active': resendTimer > 0 ? {} : {
              backgroundColor: 'rgba(255, 107, 0, 0.12)',
              transform: 'translateY(0)',
            },
          }}
        >
          <RefreshRoundedIcon
            sx={{
              fontSize: 19,
              color: 'inherit',
              transition: 'transform 0.3s ease',
            }}
          />
          <Typography sx={{ fontSize: '14.5px', fontWeight: 700, color: 'inherit' }}>
            {resendTimer > 0 ? `${t.resendCode} (${resendTimer}s)` : t.resendCode}
          </Typography>
        </Box>

        <Box sx={{ flexGrow: 1 }} />

        <PrimaryButton
          fullWidth
          type="submit"
          loading={loading}
          disabled={!isComplete}
          sx={{
            height: '56px',
            borderRadius: '16px',
            fontSize: '16px',
            fontWeight: 800,
            backgroundColor: '#FF6B00',
            boxShadow: 'none',
            '&:hover': { backgroundColor: '#E66000', boxShadow: 'none' },
            mb: 2,
          }}
        >
          {t.confirmOtp}
        </PrimaryButton>
      </Box>
    </Box>
  );
};

export default DriverVerifyOtp;
