import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Box, Button, IconButton, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { usePasswordRecovery } from '@sakay/shared';

import Logo from '../../../common/components/Logo';
import PrimaryButton from '../../../common/components/PrimaryButton';
import SakayPhoneInput from '../../../common/components/SakayPhoneInput';
import SakayToast from '../../../common/components/SakayToast';
import { useLanguage } from '../../../utils/LanguageContext';
import { getPhoneLookupCandidates } from '../../../services/driverApiService';

/**
 * Step 1 of password recovery for a driver: the mobile number. The server texts a 6-digit code to the number of an existing DRIVER account
 * (and says the same thing whether or not there is one); the next screen takes the code and the new password.
 */
export const DriverForgotPassword: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, language } = useLanguage();
  const recovery = usePasswordRecovery('driver', language);
  const tl = language === 'tl';

  const [phone, setPhone] = useState(() => (location.state as { phone?: string } | null)?.phone ?? '');
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [toastOpen, setToastOpen] = useState(false);

  const candidates = getPhoneLookupCandidates(phone);
  const isValidPhone = candidates.phoneRaw.length === 10 && candidates.phoneRaw.startsWith('9');
  const showPhoneError = phoneTouched && !isValidPhone;

  const goToCode = (justSent: boolean) => navigate('/driver/reset-password', { state: { phone: candidates.e164, justSent } });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (recovery.busy) return;
    if (!isValidPhone) {
      setPhoneTouched(true);
      return;
    }
    const sent = await recovery.requestCode(candidates.e164);
    if (sent) goToCode(true);
    else setToastOpen(true);
  };

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
      <SakayToast open={toastOpen} message={recovery.message} severity="error" onClose={() => setToastOpen(false)} />

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
          aria-label={tl ? 'Bumalik' : 'Back'}
          onClick={() => navigate('/driver/login')}
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

      {/* 2. Content */}
      <Box
        component="form"
        onSubmit={handleSubmit}
        noValidate
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
          <Typography sx={{ fontSize: '24px', fontWeight: 700, color: '#0F172A', lineHeight: 1.2, letterSpacing: '-0.5px' }}>
            {t.forgotPasswordTitle}
          </Typography>
          <Typography sx={{ fontSize: '15px', color: '#64748B', mt: 0.75, fontWeight: 500, lineHeight: 1.5 }}>
            {tl
              ? 'Ilagay ang numero ng telepono ng iyong driver account. Magpapadala kami ng 6-digit na code sa SMS.'
              : 'Enter the mobile number of your driver account. We will text you a 6-digit code.'}
          </Typography>
        </Box>

        <SakayPhoneInput
          label={tl ? 'Numero ng telepono' : 'Mobile number'}
          value={phone}
          onChange={(fullVal) => setPhone(fullVal)}
          onFocus={() => setPhoneTouched(true)}
          onBlur={() => setPhoneTouched(true)}
          required
          error={showPhoneError}
          helperText={
            showPhoneError
              ? tl
                ? 'Pakikumpleto ang 10-digit mobile number na nagsisimula sa 9.'
                : 'Please enter a valid 10-digit mobile number starting with 9.'
              : ''
          }
        />

        {/* Space pusher to push the button to the bottom */}
        <Box sx={{ flexGrow: 1, minHeight: 24 }} />

        <PrimaryButton
          type="submit"
          fullWidth
          loading={recovery.busy}
          disabled={!isValidPhone}
          sx={{
            height: '56px',
            borderRadius: '16px',
            fontSize: '16px',
            fontWeight: 700,
            backgroundColor: '#FF6600',
            boxShadow: 'none',
            '&:hover': { backgroundColor: '#E65C00', boxShadow: 'none' },
            mt: 2,
          }}
        >
          {tl ? 'Ipadala ang Code' : 'Send Code'}
        </PrimaryButton>

        {/* The code may already be on the phone (this screen was left, or the code was asked for a moment ago) */}
        <Box sx={{ mt: 1.5, mb: 1, display: 'flex', justifyContent: 'center' }}>
          <Button
            type="button"
            disabled={!isValidPhone || recovery.busy}
            onClick={() => goToCode(false)}
            sx={{ textTransform: 'none', fontWeight: 600, color: '#FF6600', minHeight: 44 }}
          >
            {tl ? 'May code na ako' : 'I already have a code'}
          </Button>
        </Box>
      </Box>
    </Box>
  );
};

export default DriverForgotPassword;
