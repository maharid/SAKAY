import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Button,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
} from '@mui/material';
import PersonOutlinedIcon from '@mui/icons-material/PersonOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import TranslateIcon from '@mui/icons-material/Translate';
import GavelIcon from '@mui/icons-material/Gavel';
import SecurityIcon from '@mui/icons-material/Security';
import HelpOutlinedIcon from '@mui/icons-material/HelpOutlined';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import LogoutIcon from '@mui/icons-material/Logout';

import PageHeader from '../../../common/components/PageHeader';
import { useLanguage } from '../../../utils/LanguageContext';
import { supabase } from '../../../services/supabaseClient';

export const DriverSettingsPage: React.FC = () => {
  const { language, setLanguage } = useLanguage();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);

  const isTagalog = language === 'tl';

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      if (supabase && supabase.auth) {
        await supabase.auth.signOut();
      }
      localStorage.removeItem('sakay_driver_phone');
      localStorage.removeItem('sakay_driver_id');
      localStorage.removeItem('sakay_driver_profile');
      sessionStorage.clear();
      navigate('/driver/login');
    } catch (err) {
      console.warn('Logout error:', err);
      navigate('/driver/login');
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        backgroundColor: '#FAFAFA',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <PageHeader
        title={isTagalog ? 'Mga Setting' : 'Settings'}
        onBack={() => navigate('/driver/home')}
      />

      <Box
        className="hide-scrollbar"
        sx={{
          flexGrow: 1,
          overflowY: 'auto',
          p: 2.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 2.5,
        }}
      >
        {/* Section 1: Account */}
        <Box>
          <Typography
            sx={{
              fontSize: '12px',
              fontWeight: 700,
              color: '#94A3B8',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              mb: 1,
              px: 0.5,
            }}
          >
            {isTagalog ? 'Account Settings' : 'Account Settings'}
          </Typography>

          <Paper
            elevation={0}
            sx={{
              borderRadius: '16px',
              backgroundColor: '#FFFFFF',
              border: '1px solid #F1F5F9',
              overflow: 'hidden',
            }}
          >
            <List disablePadding>
              <ListItem disablePadding>
                <ListItemButton onClick={() => navigate('/driver/profile')} sx={{ py: 1.5, px: 2 }}>
                  <ListItemIcon sx={{ minWidth: 38, color: '#FF6B00' }}>
                    <PersonOutlinedIcon sx={{ fontSize: 20 }} />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Typography sx={{ fontSize: '14px', fontWeight: 600, color: '#0F172A' }}>
                        {isTagalog ? 'Impormasyon ng Profile' : 'Profile Information'}
                      </Typography>
                    }
                  />
                  <ChevronRightIcon sx={{ color: '#94A3B8', fontSize: 20 }} />
                </ListItemButton>
              </ListItem>
              <Divider sx={{ borderColor: '#F8FAFC' }} />

              <ListItem disablePadding>
                <ListItemButton onClick={() => navigate('/driver/forgot-password')} sx={{ py: 1.5, px: 2 }}>
                  <ListItemIcon sx={{ minWidth: 38, color: '#FF6B00' }}>
                    <LockOutlinedIcon sx={{ fontSize: 20 }} />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Typography sx={{ fontSize: '14px', fontWeight: 600, color: '#0F172A' }}>
                        {isTagalog ? 'Palitan ang Password' : 'Change Password'}
                      </Typography>
                    }
                  />
                  <ChevronRightIcon sx={{ color: '#94A3B8', fontSize: 20 }} />
                </ListItemButton>
              </ListItem>
            </List>
          </Paper>
        </Box>

        {/* Section 2: Preferences */}
        <Box>
          <Typography
            sx={{
              fontSize: '12px',
              fontWeight: 700,
              color: '#94A3B8',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              mb: 1,
              px: 0.5,
            }}
          >
            {isTagalog ? 'Mga Kagustuhan' : 'Preferences'}
          </Typography>

          <Paper
            elevation={0}
            sx={{
              borderRadius: '16px',
              backgroundColor: '#FFFFFF',
              border: '1px solid #F1F5F9',
              overflow: 'hidden',
            }}
          >
            <List disablePadding>
              <ListItem sx={{ py: 1.5, px: 2, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                  <ListItemIcon sx={{ minWidth: 38, color: '#FF6B00' }}>
                    <TranslateIcon sx={{ fontSize: 20 }} />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Typography sx={{ fontSize: '14px', fontWeight: 600, color: '#0F172A' }}>
                        {isTagalog ? 'Wika (Language)' : 'Language'}
                      </Typography>
                    }
                  />
                </Box>

                {/* Segmented 2-Option Selector */}
                <Box
                  sx={{
                    width: '100%',
                    display: 'flex',
                    backgroundColor: '#F1F5F9',
                    borderRadius: '12px',
                    p: '3px',
                    gap: '4px',
                  }}
                >
                  <Box
                    onClick={() => setLanguage('tl')}
                    sx={{
                      flex: 1,
                      py: 1,
                      borderRadius: '9px',
                      backgroundColor: language === 'tl' ? '#FF6B00' : 'transparent',
                      color: language === 'tl' ? '#FFFFFF' : '#64748B',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 1,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      boxShadow: language === 'tl' ? '0 2px 8px rgba(255,107,0,0.25)' : 'none',
                    }}
                  >
                    <Typography sx={{ fontSize: '14px' }}>🇵🇭</Typography>
                    <Typography
                      sx={{
                        fontSize: '13px',
                        fontWeight: language === 'tl' ? 700 : 500,
                      }}
                    >
                      Tagalog
                    </Typography>
                  </Box>

                  <Box
                    onClick={() => setLanguage('en')}
                    sx={{
                      flex: 1,
                      py: 1,
                      borderRadius: '9px',
                      backgroundColor: language === 'en' ? '#FF6B00' : 'transparent',
                      color: language === 'en' ? '#FFFFFF' : '#64748B',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 1,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      boxShadow: language === 'en' ? '0 2px 8px rgba(255,107,0,0.25)' : 'none',
                    }}
                  >
                    <Typography sx={{ fontSize: '14px' }}>🇺🇸</Typography>
                    <Typography
                      sx={{
                        fontSize: '13px',
                        fontWeight: language === 'en' ? 700 : 500,
                      }}
                    >
                      English
                    </Typography>
                  </Box>
                </Box>
              </ListItem>
            </List>
          </Paper>
        </Box>

        {/* Section 3: Support & Feedback */}
        <Box>
          <Typography
            sx={{
              fontSize: '12px',
              fontWeight: 700,
              color: '#94A3B8',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              mb: 1,
              px: 0.5,
            }}
          >
            {isTagalog ? 'Suporta at Feedback' : 'Support & Feedback'}
          </Typography>

          <Paper
            elevation={0}
            sx={{
              borderRadius: '16px',
              backgroundColor: '#FFFFFF',
              border: '1px solid #F1F5F9',
              overflow: 'hidden',
            }}
          >
            <List disablePadding>
              <ListItem disablePadding>
                <ListItemButton onClick={() => navigate('/driver/support')} sx={{ py: 1.5, px: 2 }}>
                  <ListItemIcon sx={{ minWidth: 38, color: '#64748B' }}>
                    <HelpOutlinedIcon sx={{ fontSize: 20 }} />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Typography sx={{ fontSize: '14px', fontWeight: 600, color: '#0F172A' }}>
                        {isTagalog ? 'Tulong at Mga Tanong (FAQs)' : 'Help & Support (FAQs)'}
                      </Typography>
                    }
                  />
                  <ChevronRightIcon sx={{ color: '#94A3B8', fontSize: 20 }} />
                </ListItemButton>
              </ListItem>
              <Divider sx={{ borderColor: '#F8FAFC' }} />

              <ListItem disablePadding>
                <ListItemButton onClick={() => navigate('/driver/rate-app')} sx={{ py: 1.5, px: 2 }}>
                  <ListItemIcon sx={{ minWidth: 38, color: '#64748B' }}>
                    <StarBorderIcon sx={{ fontSize: 20 }} />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Typography sx={{ fontSize: '14px', fontWeight: 600, color: '#0F172A' }}>
                        {isTagalog ? 'I-rate ang App' : 'Rate the App'}
                      </Typography>
                    }
                  />
                  <ChevronRightIcon sx={{ color: '#94A3B8', fontSize: 20 }} />
                </ListItemButton>
              </ListItem>
            </List>
          </Paper>
        </Box>

        {/* Section 4: Legal & Privacy */}
        <Box>
          <Typography
            sx={{
              fontSize: '12px',
              fontWeight: 700,
              color: '#94A3B8',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              mb: 1,
              px: 0.5,
            }}
          >
            {isTagalog ? 'Legal at Patakaran' : 'Legal & Privacy'}
          </Typography>

          <Paper
            elevation={0}
            sx={{
              borderRadius: '16px',
              backgroundColor: '#FFFFFF',
              border: '1px solid #F1F5F9',
              overflow: 'hidden',
            }}
          >
            <List disablePadding>
              <ListItem disablePadding>
                <ListItemButton onClick={() => navigate('/driver/terms-of-service')} sx={{ py: 1.5, px: 2 }}>
                  <ListItemIcon sx={{ minWidth: 38, color: '#64748B' }}>
                    <GavelIcon sx={{ fontSize: 20 }} />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Typography sx={{ fontSize: '14px', fontWeight: 600, color: '#0F172A' }}>
                        {isTagalog ? 'Kasunduan sa Serbisyo (Terms of Service)' : 'Terms of Service'}
                      </Typography>
                    }
                  />
                  <ChevronRightIcon sx={{ color: '#94A3B8', fontSize: 20 }} />
                </ListItemButton>
              </ListItem>
              <Divider sx={{ borderColor: '#F8FAFC' }} />

              <ListItem disablePadding>
                <ListItemButton onClick={() => navigate('/driver/privacy-policy')} sx={{ py: 1.5, px: 2 }}>
                  <ListItemIcon sx={{ minWidth: 38, color: '#64748B' }}>
                    <SecurityIcon sx={{ fontSize: 20 }} />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Typography sx={{ fontSize: '14px', fontWeight: 600, color: '#0F172A' }}>
                        {isTagalog ? 'Patakaran sa Privacy (Privacy Policy)' : 'Privacy Policy'}
                      </Typography>
                    }
                  />
                  <ChevronRightIcon sx={{ color: '#94A3B8', fontSize: 20 }} />
                </ListItemButton>
              </ListItem>
            </List>
          </Paper>
        </Box>

        {/* Section 5: About */}
        <Paper
          elevation={0}
          sx={{
            p: 2,
            borderRadius: '16px',
            backgroundColor: '#FFFFFF',
            border: '1px solid #F1F5F9',
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
          }}
        >
          <InfoOutlinedIcon sx={{ color: '#FF6B00', fontSize: 22 }} />
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontSize: '13px', fontWeight: 700, color: '#0F172A' }}>
              SAKAY Driver PWA v1.2.0
            </Typography>
            <Typography sx={{ fontSize: '11px', color: '#64748B' }}>
              Calapan City Localized Tricycle Logistics & Ride Platform
            </Typography>
          </Box>
        </Paper>

        {/* Logout Button */}
        <Button
          fullWidth
          variant="outlined"
          disabled={loggingOut}
          onClick={handleLogout}
          startIcon={<LogoutIcon />}
          sx={{
            borderColor: '#EF4444',
            color: '#EF4444',
            borderRadius: '14px',
            height: '46px',
            fontSize: '14px',
            fontWeight: 700,
            textTransform: 'none',
            mt: 1,
            '&:hover': { borderColor: '#DC2626', backgroundColor: '#FEF2F2' },
          }}
        >
          {isTagalog ? 'Mag-log Out' : 'Log Out'}
        </Button>
      </Box>
    </Box>
  );
};

export default DriverSettingsPage;
