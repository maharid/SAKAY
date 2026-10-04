import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  IconButton,
  Alert,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

import Logo from '../../../common/components/Logo';
import PrimaryButton from '../../../common/components/PrimaryButton';
import { useLanguage } from '../../../utils/LanguageContext';

/**
 * Password reset is switched off for now.
 *
 * The old screen texted a code to ANY number typed into it and then accepted a fixed sandbox code, and the "new password" page after it
 * never changed a password. A safe reset needs a server-checked code tied to the account; that is the OTP redesign, and until it ships
 * this screen only tells the driver where to get help. Nothing here reads or writes data.
 */
export const DriverForgotPassword: React.FC = () => {
  const navigate = useNavigate();
  const { t, language } = useLanguage();

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
        sx={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 24px calc(var(--safe-area-bottom) + 24px) 24px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
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
            {t.forgotPasswordTitle}
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
            {language === 'tl'
              ? 'Pansamantalang hindi available ang pag-reset ng password sa app.'
              : 'Resetting your password in the app is temporarily unavailable.'}
          </Typography>
        </Box>

        <Alert severity="info" sx={{ borderRadius: '12px' }}>
          {language === 'tl'
            ? 'Para mabawi ang iyong account, makipag-ugnayan sa administrator ng iyong TODA o sa tanggapan ng LGU. Dalhin ang iyong valid ID at ang mobile number na ginamit mo sa pagpaparehistro.'
            : 'To recover your account, please contact your TODA administrator or the LGU transport office. Bring a valid ID and the mobile number you registered with.'}
        </Alert>

        {/* Space pusher to push button to bottom */}
        <Box sx={{ flexGrow: 1 }} />

        <PrimaryButton
          fullWidth
          onClick={() => navigate('/driver/login')}
          sx={{
            height: '56px',
            borderRadius: '16px',
            fontSize: '16px',
            fontWeight: 800,
            backgroundColor: '#FF6B00',
            boxShadow: 'none',
            '&:hover': { backgroundColor: '#E66000', boxShadow: 'none' },
            mt: 2,
            mb: 1,
          }}
        >
          {t.backToLogin}
        </PrimaryButton>
      </Box>
    </Box>
  );
};

export default DriverForgotPassword;
