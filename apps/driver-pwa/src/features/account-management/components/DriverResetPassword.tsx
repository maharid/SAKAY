import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  TextField,
  InputAdornment,
  IconButton,
  LinearProgress,
  Alert,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import HttpsOutlinedIcon from '@mui/icons-material/HttpsOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';

import Logo from '../../../common/components/Logo';
import PrimaryButton from '../../../common/components/PrimaryButton';
import SuccessModal from '../../../common/components/SuccessModal';
import { supabase } from '../../../services/supabaseClient';
import { useLanguage } from '../../../utils/LanguageContext';
import { extendTapArea } from '@sakay/shared';

export const DriverResetPassword: React.FC = () => {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successModalOpen, setSuccessModalOpen] = useState(false);
  const [sessionValid, setSessionValid] = useState<boolean | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);

  const [passwordFocused, setPasswordFocused] = useState(false);
  const [confirmPasswordFocused, setConfirmPasswordFocused] = useState(false);

  useEffect(() => {
    // Validate that the user arrived via a valid recovery session or token
    const verifyRecoverySession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const hash = window.location.hash || '';
        const search = window.location.search || '';
        const hasRecoveryToken = hash.includes('type=recovery') || hash.includes('access_token') || search.includes('code=');

        if (session) {
          setIsAuthenticated(true);
          setSessionValid(true);
        } else if (hasRecoveryToken) {
          setIsAuthenticated(false);
          setSessionValid(true);
        } else {
          setSessionValid(false);
          setErrorMessage(
            language === 'tl'
              ? 'Walang aktibong recovery session o nag-expire na ang reset link. Mangyaring humiling muli ng link.'
              : 'No active recovery session found or the reset link has expired. Please request a new link.'
          );
        }
      } catch (err) {
        console.warn('Session check error:', err);
        setSessionValid(true);
      }
    };

    verifyRecoverySession();
  }, [language]);

  // Password Criteria Validation (matching TODA registration)
  const hasMinLength = newPassword.length >= 8;
  const hasUppercase = /[A-Z]/.test(newPassword);
  const hasLowercase = /[a-z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>_\-]/.test(newPassword);

  const criteriaList = [
    { label: 'Minimum 8 characters', met: hasMinLength },
    { label: 'At least 1 uppercase letter (A-Z)', met: hasUppercase },
    { label: 'At least 1 lowercase letter (a-z)', met: hasLowercase },
    { label: 'At least 1 number (0-9)', met: hasNumber },
    { label: 'At least 1 special character (!@#$%^&*)', met: hasSpecial },
  ];

  const metCount = criteriaList.filter((c) => c.met).length;
  const passwordScore = (metCount / criteriaList.length) * 100;
  const isPasswordValid = metCount === criteriaList.length;

  const getStrengthColor = () => {
    if (metCount <= 2) return '#DC2626';
    if (metCount <= 4) return '#EA580C';
    return '#16A34A';
  };

  const getStrengthLabel = () => {
    if (newPassword.length === 0) return '';
    if (metCount <= 2) return 'Weak';
    if (metCount <= 4) return 'Moderate';
    return 'Strong';
  };

  // Password Confirmation Validation
  const isPasswordMatched = confirmPassword.length > 0 && newPassword === confirmPassword;
  const isPasswordMismatched = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const [showMatchSuccess, setShowMatchSuccess] = useState(false);

  useEffect(() => {
    if (confirmPassword.length > 0 && newPassword === confirmPassword) {
      setShowMatchSuccess(true);
      const timer = setTimeout(() => {
        setShowMatchSuccess(false);
      }, 3000);
      return () => clearTimeout(timer);
    } else {
      setShowMatchSuccess(false);
    }
  }, [newPassword, confirmPassword]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    setErrorMessage(null);

    if (!isPasswordValid) {
      setErrorMessage(
        language === 'tl'
          ? 'Pakitiyak na natutugunan ng password ang lahat ng pamantayan.'
          : 'Please make sure your password meets all criteria.'
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage(
        language === 'tl'
          ? 'Hindi magkatugma ang kumpirmasyon ng password.'
          : 'Passwords do not match.'
      );
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        setErrorMessage(error.message);
        setLoading(false);
        return;
      }

      setLoading(false);
      setSuccessModalOpen(true);
      setTimeout(() => {
        if (isAuthenticated) {
          navigate('/driver/settings', { replace: true });
        } else {
          navigate('/driver/login', { replace: true });
        }
      }, 1600);
    } catch (err: any) {
      setErrorMessage(
        err?.message ||
          (language === 'tl'
            ? 'Nagkaroon ng problema sa pag-update ng password.'
            : 'An unexpected error occurred while updating password.')
      );
      setLoading(false);
    }
  };

  const showPasswordIcon = !passwordFocused && !newPassword;
  const showConfirmPasswordIcon = !confirmPasswordFocused && !confirmPassword;

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
          aria-label={language === 'tl' ? 'Bumalik' : 'Back'}
          onClick={() => {
            if (isAuthenticated) {
              navigate('/driver/settings');
            } else {
              navigate('/driver/login');
            }
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
        onSubmit={handleSubmit}
        sx={{
          flex: 1,
          overflowY: 'auto',
          '& > *': { flexShrink: 0 },
          padding: '16px 24px calc(var(--safe-area-bottom) + 24px) 24px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Box sx={{ mb: 3.5, mt: 1 }}>
          <Typography
            sx={{
              fontSize: '24px',
              fontWeight: 700,
              color: '#0F172A',
              lineHeight: 1.2,
              letterSpacing: '-0.5px',
            }}
          >
            {t.newPasswordTitle}
          </Typography>
          <Typography
            sx={{
              fontSize: '15px',
              color: '#64748B',
              mt: 0.75,
              fontWeight: 500,
              lineHeight: 1.5,
            }}
          >
            {t.newPasswordDesc}
          </Typography>
        </Box>

        {errorMessage && (
          <Alert severity={sessionValid === false ? "warning" : "error"} sx={{ mb: 2.5, borderRadius: '12px' }}>
            {errorMessage}
          </Alert>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* New Password */}
          <TextField
            fullWidth
            required
            type={showPassword ? 'text' : 'password'}
            label={t.newPassword}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            onFocus={() => setPasswordFocused(true)}
            onBlur={() => setPasswordFocused(false)}
            error={hasAttemptedSubmit && !isPasswordValid}
            slotProps={{
              inputLabel: {
                shrink: Boolean(passwordFocused || newPassword),
                sx: {
                  color: '#64748B',
                  fontSize: '14px',
                  fontWeight: 500,
                  '&.Mui-focused': { color: '#FF6600', fontWeight: 600 },
                  ...(showPasswordIcon ? { transform: 'translate(44px, 16px) scale(1)' } : {}),
                },
              },
              input: {
                startAdornment: showPasswordIcon ? (
                  <InputAdornment position="start">
                    <LockOutlinedIcon sx={{ color: '#0F172A', fontSize: 20 }} />
                  </InputAdornment>
                ) : null,
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      onClick={() => setShowPassword(!showPassword)}
                      edge="end"
                      size="small"
                      sx={{ ...extendTapArea(8), color: '#64748B' }}
                    >
                      {showPassword ? <VisibilityOffOutlinedIcon fontSize="small" /> : <VisibilityOutlinedIcon fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
                sx: {
                  borderRadius: '16px',
                  backgroundColor: '#F8FAFC',
                  fontSize: '15px',
                  height: '56px',
                  '& fieldset': { borderColor: '#E2E8F0' },
                  '&:hover fieldset': { borderColor: '#CBD5E1' },
                  '&.Mui-focused fieldset': { borderColor: '#FF6600' },
                },
              },
            }}
          />

          {/* Password Progress Bar */}
          {!isPasswordValid && newPassword.length > 0 && (
            <Box sx={{ mt: -0.5, mb: 0.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#64748B', fontWeight: 600 }}>
                  Password Strength:
                </Typography>
                <Typography sx={{ fontSize: '12px', color: getStrengthColor(), fontWeight: 700 }}>
                  {getStrengthLabel()}
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={passwordScore}
                sx={{
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: '#E2E8F0',
                  '& .MuiLinearProgress-bar': {
                    backgroundColor: getStrengthColor(),
                    borderRadius: 3,
                    transition: 'all 0.3s ease',
                  },
                }}
              />
            </Box>
          )}

          {/* Password Criteria Checklist */}
          {!isPasswordValid && newPassword.length > 0 && (
            <Box sx={{ p: 1.75, borderRadius: '12px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}>
              <Typography sx={{ fontSize: '12px', fontWeight: 700, color: '#334155', mb: 1 }}>
                Password Requirements:
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.85 }}>
                {criteriaList.map((crit, idx) => (
                  <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {crit.met ? (
                      <CheckCircleIcon sx={{ fontSize: 16, color: '#16A34A' }} />
                    ) : (
                      <RadioButtonUncheckedIcon sx={{ fontSize: 16, color: '#64748B' }} />
                    )}
                    <Typography
                      sx={{
                        fontSize: '12px',
                        color: crit.met ? '#16A34A' : '#64748B',
                        fontWeight: crit.met ? 600 : 400,
                      }}
                    >
                      {crit.label}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          )}

          {/* Confirm Password */}
          <TextField
            fullWidth
            required
            type={showConfirmPassword ? 'text' : 'password'}
            label={t.confirmPassword}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onFocus={() => setConfirmPasswordFocused(true)}
            onBlur={() => setConfirmPasswordFocused(false)}
            error={isPasswordMismatched || (hasAttemptedSubmit && !confirmPassword)}
            helperText={
              isPasswordMismatched
                ? 'Passwords do not match.'
                : showMatchSuccess
                ? 'Passwords match ✓'
                : ''
            }
            slotProps={{
              formHelperText: {
                sx: {
                  fontSize: '12px',
                  color: isPasswordMismatched ? '#DC2626' : showMatchSuccess ? '#16A34A' : '#64748B',
                  fontWeight: isPasswordMismatched || showMatchSuccess ? 600 : 400,
                },
              },
              inputLabel: {
                shrink: Boolean(confirmPasswordFocused || confirmPassword),
                sx: {
                  color: '#64748B',
                  fontSize: '14px',
                  fontWeight: 500,
                  '&.Mui-focused': { color: '#FF6600', fontWeight: 600 },
                  ...(showConfirmPasswordIcon ? { transform: 'translate(44px, 16px) scale(1)' } : {}),
                },
              },
              input: {
                startAdornment: showConfirmPasswordIcon ? (
                  <InputAdornment position="start">
                    <HttpsOutlinedIcon sx={{ color: '#0F172A', fontSize: 20 }} />
                  </InputAdornment>
                ) : null,
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      edge="end"
                      size="small"
                      sx={{ ...extendTapArea(8), color: '#64748B' }}
                    >
                      {showConfirmPassword ? <VisibilityOffOutlinedIcon fontSize="small" /> : <VisibilityOutlinedIcon fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
                sx: {
                  borderRadius: '16px',
                  backgroundColor: '#F8FAFC',
                  fontSize: '15px',
                  height: '56px',
                  '& fieldset': { borderColor: '#E2E8F0' },
                  '&:hover fieldset': { borderColor: '#CBD5E1' },
                  '&.Mui-focused fieldset': { borderColor: '#FF6600' },
                },
              },
            }}
          />
        </Box>

        {/* Space pusher to push button to bottom */}
        <Box sx={{ flexGrow: 1 }} />

        <PrimaryButton
          fullWidth
          type="submit"
          loading={loading}
          sx={{
            height: '56px',
            borderRadius: '16px',
            fontSize: '16px',
            fontWeight: 700,
            backgroundColor: '#FF6600',
            boxShadow: 'none',
            '&:hover': { backgroundColor: '#E65C00', boxShadow: 'none' },
            mt: 2,
            mb: 1,
          }}
        >
          {t.saveAndLogin}
        </PrimaryButton>
      </Box>

      <SuccessModal
        open={successModalOpen}
        title={language === 'tl' ? 'Matagumpay na Na-reset ang Password!' : 'Password Reset Successful!'}
        message={
          language === 'tl'
            ? 'Maaari ka nang mag-login gamit ang iyong bagong password.'
            : 'You can now log in using your new password.'
        }
      />
    </Box>
  );
};

export default DriverResetPassword;
