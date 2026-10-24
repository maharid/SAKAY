import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  MenuItem,
  Select,
  Tab,
  Tabs,
  Typography,
  useMediaQuery,
} from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import PrivacyTipOutlinedIcon from '@mui/icons-material/PrivacyTipOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';

import { LogoutConfirmModal } from '../components/admin/LogoutConfirmModal';
import { ChangePasswordDialog } from '../components/common/ChangePasswordCard';
import { StatusPill } from '../components/common/DataTable';
import { SettingFact, SettingRow, settingsListSx } from '../components/common/SettingRow';
import { secondaryButtonSx } from '../components/common/pageButtons';
import { OPS_BORDER, OPS_TEXT, opsCardSx, opsFocusRing } from '../components/operations/operationsTheme';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../hooks/useLanguage';
import { ABOUT_SAKAY, PRIVACY_INFO, SUPPORT_NOTE } from '../utils/appInfo';
import { DEFAULT_LANGUAGE } from '../utils/language';
import type { PortalLanguage } from '../utils/language';
import { DIALOG_ACTIONS_SX, DIALOG_CONTENT_SX, DIALOG_INTRO_SX, DIALOG_PAPER_SX, DIALOG_TITLE_SX } from '@sakay/shared/components/dialogStyles';
import { CONTROL, FONT, SHELL, SPACE } from '../styles/density';

type CategoryId = 'preferences' | 'account' | 'privacy' | 'about';

// Only categories that have something real in them. There is no "Notifications" here: the portal has no notification preferences to change
// (the bell in the header just lists the notices), and a page of switches that do nothing would be worse than no page.
const CATEGORIES: Array<{ id: CategoryId; label: string; description: string; icon: React.ReactElement }> = [
  { id: 'preferences', label: 'Preferences', description: 'How this portal reads.', icon: <TuneIcon /> },
  { id: 'account', label: 'Account & Security', description: 'Your sign-in, password and session.', icon: <LockOutlinedIcon /> },
  { id: 'privacy', label: 'Privacy & Legal', description: 'How SAKAY looks after personal information.', icon: <PrivacyTipOutlinedIcon /> },
  { id: 'about', label: 'About SAKAY', description: 'What SAKAY is and who built it.', icon: <InfoOutlinedIcon /> },
];

// Below this screen width the category menu becomes a row of tabs above the settings (the sidebar takes 220px of the screen when it is open)
const WIDE_QUERY = '(min-width: 1100px)';

// Settings: a menu of categories on the left (a row of tabs on a narrow screen) and the settings of the chosen category on the right.
// Language is kept in the browser (see utils/language.ts); the password, the log-out and the account pages are the ones the portal already has; the privacy
// text and the "about" facts are read from files the project already has. Nothing here is saved on the server.
export const TodaSettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const wide = useMediaQuery(WIDE_QUERY, { noSsr: true });
  const { todaAdminProfile, user, signOut } = useAuth();
  const { language, setLanguage, options } = useLanguage();
  const [category, setCategory] = useState<CategoryId>('preferences');
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  const adminName = todaAdminProfile?.full_name || 'TODA Administrator';
  const adminEmail = todaAdminProfile?.email || user?.email || '';
  const current = CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[0];

  // the same sign-out the account menu in the header does
  const handleSignOutConfirm = async () => {
    setLogoutOpen(false);
    await signOut();
    navigate('/login', { replace: true });
  };

  const panels: Record<CategoryId, React.ReactNode> = {
    preferences: (
      <SettingRow
        title="Language"
        description="The language of this portal. English is the only language available for now; more will be added when their translations are ready. Your choice is saved on this device."
        control={
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <Select
              value={language}
              onChange={(e) => setLanguage(e.target.value as PortalLanguage)}
              SelectDisplayProps={{ 'aria-label': 'Language' }}
              sx={{ height: CONTROL.height, '@media (pointer: coarse)': { height: CONTROL.touchHeight } }}
            >
              {options.map((option) => (
                <MenuItem key={option.code} value={option.code}>
                  {option.name}
                  {option.code === DEFAULT_LANGUAGE ? ' (default)' : ''}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        }
      />
    ),

    account: (
      <>
        <SettingRow
          title="Signed in as"
          description={
            <>
              <Box component="span" sx={{ display: 'block', fontWeight: 600, color: OPS_TEXT.primary }}>{adminName}</Box>
              {adminEmail && <Box component="span" sx={{ display: 'block' }}>{adminEmail}</Box>}
            </>
          }
        />
        <SettingRow
          title="TODA profile and documents"
          description="Edit your TODA's details and officers, and send or replace its compliance documents."
          control={
            <Button variant="outlined" startIcon={<ManageAccountsIcon sx={{ fontSize: 16 }} />} onClick={() => navigate('/account')} sx={secondaryButtonSx}>
              Open Account &amp; Accreditation
            </Button>
          }
        />
        <SettingRow
          title="Password"
          description="Choose a new password for this administrator login."
          control={
            <Button
              variant="outlined"
              startIcon={<LockOutlinedIcon sx={{ fontSize: 16 }} />}
              onClick={() => {
                setPasswordChanged(false);
                setPasswordOpen(true);
              }}
              sx={secondaryButtonSx}
            >
              Change Password
            </Button>
          }
        >
          {passwordChanged && (
            <Alert severity="success" onClose={() => setPasswordChanged(false)} sx={{ mt: '12px', borderRadius: '8px', fontSize: FONT.body }}>Your password was changed.</Alert>
          )}
        </SettingRow>
        <SettingRow
          title="Log out"
          description="End your session on this device. You will need to sign in again."
          control={
            <Button
              variant="outlined"
              startIcon={<LogoutIcon sx={{ fontSize: 16 }} />}
              onClick={() => setLogoutOpen(true)}
              sx={{ ...secondaryButtonSx, color: '#B91C1C', borderColor: 'rgba(185, 28, 28, 0.35)', '&:hover': { backgroundColor: '#FEF2F2', borderColor: '#B91C1C' } }}
            >
              Log Out
            </Button>
          }
        />
      </>
    ),

    privacy: (
      <SettingRow
        title="Privacy Policy"
        description={`Your rights over your personal data, and who to ask about it. Notice version ${PRIVACY_INFO.version}.`}
        control={
          <Button variant="outlined" startIcon={<PrivacyTipOutlinedIcon sx={{ fontSize: 16 }} />} onClick={() => setPrivacyOpen(true)} sx={secondaryButtonSx}>
            View Privacy Policy
          </Button>
        }
      />
    ),

    about: (
      <Box component="dl" sx={{ m: 0, ...settingsListSx }}>
        <SettingFact label="Application">{ABOUT_SAKAY.name} {ABOUT_SAKAY.portal}</SettingFact>
        <SettingFact label="Project">{ABOUT_SAKAY.title}</SettingFact>
        <SettingFact label="Developed by">
          {ABOUT_SAKAY.developers.map((name) => (
            <Box component="span" key={name} sx={{ display: 'block' }}>{name}</Box>
          ))}
        </SettingFact>
        <SettingFact label="School">{ABOUT_SAKAY.school}</SettingFact>
        <SettingFact label="Capstone project">{ABOUT_SAKAY.project}, {ABOUT_SAKAY.completed}</SettingFact>
        <SettingFact label="Help">{SUPPORT_NOTE}</SettingFact>
      </Box>
    ),
  };

  return (
    <Box sx={{ maxWidth: SHELL.contentMaxWidth, margin: '0 auto', pb: SPACE.section }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: wide ? 'minmax(210px, 250px) minmax(0, 1fr)' : 'minmax(0, 1fr)', gap: SPACE.gapLarge, alignItems: 'start' }}>
        {/* The categories */}
        <Card elevation={0} sx={{ ...opsCardSx, p: wide ? '10px' : '4px 8px', position: wide ? 'sticky' : 'static', top: 0 }}>
          <Tabs
            value={category}
            onChange={(_, next: CategoryId) => setCategory(next)}
            orientation={wide ? 'vertical' : 'horizontal'}
            variant={wide ? 'standard' : 'scrollable'}
            scrollButtons="auto"
            allowScrollButtonsMobile
            aria-label="Settings categories"
            sx={{
              minHeight: 0,
              '& .MuiTabs-indicator': wide ? { display: 'none' } : { backgroundColor: 'var(--sakay-orange)', height: 3 },
              '& .MuiTabs-flexContainer': { gap: wide ? '2px' : 0 },
              '& .MuiTab-root': {
                textTransform: 'none',
                fontSize: FONT.heading,
                fontWeight: 600,
                color: OPS_TEXT.primary,
                minHeight: 44,
                minWidth: 0,
                px: '12px',
                gap: '10px',
                justifyContent: wide ? 'flex-start' : 'center',
                alignItems: 'center',
                textAlign: 'left',
                borderRadius: '10px',
                '@media (pointer: coarse)': { minHeight: CONTROL.touchHeight + 4 },
                '& .MuiTab-iconWrapper': { mb: 0, mr: 0, fontSize: 20, color: OPS_TEXT.secondary },
                '&:hover': { backgroundColor: 'rgba(17, 24, 39, 0.05)' },
                '&.Mui-selected': {
                  color: OPS_TEXT.brand,
                  backgroundColor: wide ? 'var(--sakay-orange-soft)' : 'transparent',
                  boxShadow: wide ? 'inset 3px 0 0 #C75000' : 'none',
                  '& .MuiTab-iconWrapper': { color: OPS_TEXT.brand },
                },
                '&.Mui-focusVisible': { outline: `2px solid ${OPS_TEXT.brand}`, outlineOffset: '-2px' },
              },
            }}
          >
            {CATEGORIES.map((c) => (
              <Tab key={c.id} value={c.id} id={`settings-tab-${c.id}`} aria-controls={`settings-panel-${c.id}`} icon={c.icon} iconPosition="start" label={c.label} />
            ))}
          </Tabs>
        </Card>

        {/* The settings of the chosen category */}
        <Card
          elevation={0}
          role="tabpanel"
          id={`settings-panel-${current.id}`}
          aria-labelledby={`settings-tab-${current.id}`}
          sx={{ ...opsCardSx, minWidth: 0 }}
        >
          <Box sx={{ p: '18px 24px 14px', borderBottom: `1px solid ${OPS_BORDER}` }}>
            <Typography component="h2" sx={{ fontSize: FONT.sectionTitle, fontWeight: 700, color: OPS_TEXT.primary }}>{current.label}</Typography>
            <Typography sx={{ fontSize: FONT.body, color: OPS_TEXT.secondary, mt: '2px' }}>{current.description}</Typography>
          </Box>
          <Box sx={{ px: '24px', ...(current.id === 'about' ? {} : settingsListSx) }}>{panels[current.id]}</Box>
        </Card>
      </Box>

      <ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} onChanged={() => setPasswordChanged(true)} />
      <LogoutConfirmModal open={logoutOpen} onClose={() => setLogoutOpen(false)} onConfirm={handleSignOutConfirm} />

      {/* The privacy notice: the rights text of the shared SAKAY notice, as the Driver and Passenger apps show it */}
      <Dialog open={privacyOpen} onClose={() => setPrivacyOpen(false)} maxWidth="sm" fullWidth slotProps={{ paper: { sx: DIALOG_PAPER_SX } }}>
        <DialogTitle sx={{ ...DIALOG_TITLE_SX, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 10px' }}>
          Privacy Policy
          <StatusPill label={`Notice version ${PRIVACY_INFO.version}`} tone="neutral" />
        </DialogTitle>
        <DialogContent sx={DIALOG_CONTENT_SX}>
          <Typography component="h3" sx={{ fontSize: FONT.heading, fontWeight: 700, color: OPS_TEXT.primary }}>{PRIVACY_INFO.rightsTitle}</Typography>
          <Typography sx={{ fontSize: FONT.body, color: OPS_TEXT.primary, lineHeight: 1.6 }}>{PRIVACY_INFO.rightsText}</Typography>
          <Typography sx={DIALOG_INTRO_SX}>The complete SAKAY privacy notices, for drivers and for passengers, are in the Driver App and the Passenger App.</Typography>
        </DialogContent>
        <DialogActions sx={DIALOG_ACTIONS_SX}>
          <Button variant="outlined" onClick={() => setPrivacyOpen(false)} autoFocus sx={{ ...secondaryButtonSx, ...opsFocusRing }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

