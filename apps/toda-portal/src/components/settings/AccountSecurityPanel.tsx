import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';

import { LogoutConfirmModal } from '../admin/LogoutConfirmModal';
import { ChangePasswordDialog } from '../common/ChangePasswordCard';
import { SettingRow } from '../common/SettingRow';
import { secondaryButtonSx } from '../common/pageButtons';
import { OPS_TEXT } from '../operations/operationsTheme';
import { AccountSummary } from './AccountSummary';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../hooks/useLanguage';
import { FONT } from '../../styles/density';

// Who is signed in, the password and the log-out. These are the account pages and the sign-out the portal already has; nothing here is new.
// (The password used to be a card at the bottom of Account & Accreditation; it lives here now.)
export const AccountSecurityPanel: React.FC = () => {
  const navigate = useNavigate();
  const { todaAdminProfile, user, signOut } = useAuth();
  const { t } = useLanguage();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);

  const adminName = todaAdminProfile?.full_name || 'TODA Administrator';
  const adminEmail = todaAdminProfile?.email || user?.email || '';

  // the same sign-out the account menu in the header does
  const handleSignOutConfirm = async () => {
    setLogoutOpen(false);
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <>
      <AccountSummary name={adminName} email={adminEmail} />
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
            {t('password.change')}
          </Button>
        }
      >
        {passwordChanged && (
          <Alert severity="success" onClose={() => setPasswordChanged(false)} sx={{ mt: '12px', borderRadius: '8px', fontSize: FONT.body }}>{t('password.changed')}</Alert>
        )}
      </SettingRow>
      <SettingRow
        title={t('logout.title')}
        description="End your session on this device. You will need to sign in again."
        control={
          <Button
            variant="outlined"
            startIcon={<LogoutIcon sx={{ fontSize: 16 }} />}
            onClick={() => setLogoutOpen(true)}
            sx={{ ...secondaryButtonSx, color: OPS_TEXT.danger, borderColor: 'rgba(185, 28, 28, 0.35)', '&:hover': { backgroundColor: '#FEF2F2', borderColor: OPS_TEXT.danger } }}
          >
            {t('logout.button')}
          </Button>
        }
      />

      <ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} onChanged={() => setPasswordChanged(true)} />
      <LogoutConfirmModal open={logoutOpen} onClose={() => setLogoutOpen(false)} onConfirm={handleSignOutConfirm} />
    </>
  );
};
