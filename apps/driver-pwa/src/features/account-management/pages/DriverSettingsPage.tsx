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
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import SecurityIcon from '@mui/icons-material/Security';
import HelpOutlinedIcon from '@mui/icons-material/HelpOutlined';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import LogoutIcon from '@mui/icons-material/Logout';
import PersonOffOutlinedIcon from '@mui/icons-material/PersonOffOutlined';

import PageHeader from '../../../common/components/PageHeader';
import { useLanguage } from '../../../utils/LanguageContext';
import { supabase } from '../../../services/supabaseClient';
import { DeactivateAccountDialog, activateWithKeyboard } from '@sakay/shared';

// Every icon in Settings is this gray, the selected ones too; the chevrons use it as well.
const ICON_GRAY = '#64748B';
// White text on this orange keeps 4.5:1 (on the brand #FF6600 it would be 3:1).
const SELECTED_BG = '#C75000';

interface SettingsRowProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  divider?: boolean;
}

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography sx={{ fontSize: '12px', fontWeight: 700, color: '#64748B', mb: 1, px: 0.5 }}>{children}</Typography>
);

const SectionCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Paper elevation={0} sx={{ borderRadius: '16px', backgroundColor: '#FFFFFF', border: '1px solid #F1F5F9', overflow: 'hidden' }}>
    <List disablePadding>{children}</List>
  </Paper>
);

const SettingsSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <Box>
    <SectionTitle>{title}</SectionTitle>
    <SectionCard>{children}</SectionCard>
  </Box>
);

const SettingsRow: React.FC<SettingsRowProps> = ({ icon, label, onClick, divider = true }) => (
  <>
    {divider && <Divider sx={{ borderColor: '#F8FAFC' }} />}
    <ListItem disablePadding>
      <ListItemButton onClick={onClick} sx={{ py: 1.5, px: 2 }}>
        <ListItemIcon sx={{ minWidth: 38, color: ICON_GRAY }}>{icon}</ListItemIcon>
        <ListItemText primary={<Typography sx={{ fontSize: '14px', fontWeight: 600, color: '#0F172A' }}>{label}</Typography>} />
        <ChevronRightIcon sx={{ color: ICON_GRAY, fontSize: 20 }} />
      </ListItemButton>
    </ListItem>
  </>
);

const LanguageOption: React.FC<{ label: string; selected: boolean; onSelect: () => void }> = ({ label, selected, onSelect }) => (
  <Box
    role="radio"
    tabIndex={0}
    onKeyDown={activateWithKeyboard}
    aria-checked={selected}
    onClick={onSelect}
    sx={{
      flex: 1,
      py: 1,
      minHeight: 44,
      borderRadius: '9px',
      backgroundColor: selected ? SELECTED_BG : 'transparent',
      color: selected ? '#FFFFFF' : '#475569',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      transition: 'background-color 0.2s ease, color 0.2s ease',
      boxShadow: selected ? '0 2px 8px rgba(199,80,0,0.25)' : 'none',
      '&:hover': { backgroundColor: selected ? '#B04600' : '#E2E8F0' },
      '&:focus-visible': { outline: '2px solid #0F172A', outlineOffset: 2 },
    }}
  >
    <Typography sx={{ fontSize: '13px', fontWeight: selected ? 700 : 500, color: 'inherit' }}>{label}</Typography>
  </Box>
);

export const DriverSettingsPage: React.FC = () => {
  const { language, setLanguage } = useLanguage();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);

  const text = (tl: string, en: string) => (language === 'tl' ? tl : en);

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
      <PageHeader title={text('Mga Setting', 'Settings')} onBack={() => navigate('/driver/home')} />

      <Box
        className="hide-scrollbar"
        sx={{
          flexGrow: 1,
          overflowY: 'auto',
          '& > *': { flexShrink: 0 },
          p: 2.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 2.5,
        }}
      >
        <SettingsSection title={text('Account Settings', 'Account Settings')}>
          <SettingsRow
            divider={false}
            icon={<PersonOutlinedIcon sx={{ fontSize: 20 }} />}
            label={text('Impormasyon ng Profile', 'Profile Information')}
            onClick={() => navigate('/driver/profile')}
          />
          <SettingsRow
            icon={<LockOutlinedIcon sx={{ fontSize: 20 }} />}
            label={text('Palitan ang Password', 'Change Password')}
            onClick={() => navigate('/driver/change-password')}
          />
          <SettingsRow
            icon={<PersonOffOutlinedIcon sx={{ fontSize: 20 }} />}
            label={text('I-deactivate ang Aking Account', 'Deactivate My Account')}
            onClick={() => setDeactivateOpen(true)}
          />
        </SettingsSection>

        <Box>
          <SectionTitle>{text('Mga Kagustuhan', 'Preferences')}</SectionTitle>
          <SectionCard>
            <ListItem sx={{ py: 1.5, px: 2, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                <ListItemIcon sx={{ minWidth: 38, color: ICON_GRAY }}>
                  <TranslateIcon sx={{ fontSize: 20 }} />
                </ListItemIcon>
                <ListItemText primary={<Typography sx={{ fontSize: '14px', fontWeight: 600, color: '#0F172A' }}>{text('Wika (Language)', 'Language')}</Typography>} />
              </Box>

              <Box
                role="radiogroup"
                aria-label={text('Wika (Language)', 'Language')}
                sx={{ width: '100%', display: 'flex', backgroundColor: '#F1F5F9', borderRadius: '12px', p: '3px', gap: '4px' }}
              >
                <LanguageOption label="Tagalog" selected={language === 'tl'} onSelect={() => setLanguage('tl')} />
                <LanguageOption label="English" selected={language === 'en'} onSelect={() => setLanguage('en')} />
              </Box>
            </ListItem>
          </SectionCard>
        </Box>

        <SettingsSection title={text('Mga Kaso at Hiling', 'Cases & Requests')}>
          <SettingsRow
            divider={false}
            icon={<GavelIcon sx={{ fontSize: 20 }} />}
            label={text('Mga Strike at Apela', 'Strikes & Appeals')}
            onClick={() => navigate('/driver/strikes')}
          />
          <SettingsRow
            icon={<ReceiptLongIcon sx={{ fontSize: 20 }} />}
            label={text('Mga Kaso sa Pamasahe', 'Fare Cases')}
            onClick={() => navigate('/driver/fare-disputes')}
          />
          <SettingsRow
            icon={<SwapHorizIcon sx={{ fontSize: 20 }} />}
            label={text('Ibang Sasakyan', 'Another Vehicle')}
            onClick={() => navigate('/driver/vehicle-substitution')}
          />
        </SettingsSection>

        <SettingsSection title={text('Suporta at Feedback', 'Support & Feedback')}>
          <SettingsRow
            divider={false}
            icon={<HelpOutlinedIcon sx={{ fontSize: 20 }} />}
            label={text('Tulong at Mga Tanong (FAQs)', 'Help & Support (FAQs)')}
            onClick={() => navigate('/driver/support')}
          />
          <SettingsRow
            icon={<StarBorderIcon sx={{ fontSize: 20 }} />}
            label={text('I-rate ang App', 'Rate the App')}
            onClick={() => navigate('/driver/rate-app')}
          />
        </SettingsSection>

        <SettingsSection title={text('Legal at Patakaran', 'Legal & Privacy')}>
          <SettingsRow
            divider={false}
            icon={<GavelIcon sx={{ fontSize: 20 }} />}
            label={text('Kasunduan sa Serbisyo (Terms of Service)', 'Terms of Service')}
            onClick={() => navigate('/driver/terms-of-service')}
          />
          <SettingsRow
            icon={<SecurityIcon sx={{ fontSize: 20 }} />}
            label={text('Patakaran sa Privacy (Privacy Policy)', 'Privacy Policy')}
            onClick={() => navigate('/driver/privacy-policy')}
          />
        </SettingsSection>

        <SettingsSection title={text('Tungkol', 'About')}>
          <SettingsRow
            divider={false}
            icon={<InfoOutlinedIcon sx={{ fontSize: 20 }} />}
            label={text('Tungkol sa SAKAY', 'About SAKAY')}
            onClick={() => navigate('/driver/about')}
          />
        </SettingsSection>

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
          {text('Mag-log Out', 'Log Out')}
        </Button>
      </Box>

      {/* Panel comment 12 (decision D-P5): the driver pauses their own account; the database refuses while a trip or case is open */}
      <DeactivateAccountDialog
        open={deactivateOpen}
        onClose={() => setDeactivateOpen(false)}
        role="driver"
        language={language === 'tl' ? 'tl' : 'en'}
        client={supabase}
        onDeactivated={handleLogout}
      />
    </Box>
  );
};

export default DriverSettingsPage;
