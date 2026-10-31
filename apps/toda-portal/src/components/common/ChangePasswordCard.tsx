import React, { useState } from 'react';
import { Alert, Box, Button, Card, Typography } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { ChangePasswordDialog as SharedChangePasswordDialog } from '@sakay/shared';

import { supabase } from '../../services/supabaseClient';
import { useLanguage } from '../../hooks/useLanguage';
import { FONT, SPACE } from '../../styles/density';
import { OPS_TEXT, opsCardSx } from '../operations/operationsTheme';
import { secondaryButtonSx } from './pageButtons';

interface ChangePasswordDialogProps {
  open: boolean;
  onClose: () => void;
  /** called after the password was changed (the window has been closed) */
  onChanged: () => void;
}

/**
 * Checklist B1: the TODA administrator changes their own password. It is the shared window of the LGU and TODA portals (the current password is checked again, the same four rules
 * as the other SAKAY apps are a live checklist, the strength is shown, and the login system sets the new password for the signed-in user only). Any page can offer it
 * (Account & Accreditation and Settings do).
 */
export const ChangePasswordDialog: React.FC<ChangePasswordDialogProps> = ({ open, onClose, onChanged }) => {
  const { t } = useLanguage();
  const verifyCurrent = async (current: string): Promise<string | null> => {
    const { data } = await supabase.auth.getUser();
    const email = data.user?.email;
    if (!email) return 'Your login has no e-mail address on record, so the current password cannot be checked. Sign in again.';
    const { error } = await supabase.auth.signInWithPassword({ email, password: current });
    if (!error) return null;
    return error.status === 429 ? 'Too many attempts. Wait a minute and try again.' : 'The current password is not right.';
  };
  const setNewPassword = async (password: string): Promise<string | null> => {
    const { error } = await supabase.auth.updateUser({ password });
    return error ? error.message || 'The password could not be changed. Please try again.' : null;
  };
  return (
    <SharedChangePasswordDialog
      open={open}
      onClose={onClose}
      verifyCurrent={verifyCurrent}
      setNewPassword={setNewPassword}
      onChanged={onChanged}
      labels={{ title: t('password.change'), newPassword: t('password.new'), confirm: t('password.confirm'), submit: t('password.change') }}
    />
  );
};

/** The slim "Account security" row of the Account & Accreditation page: one button that opens the password window, and the note after a successful change. */
export const ChangePasswordCard: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [changed, setChanged] = useState(false);

  return (
    <Card elevation={0} sx={{ ...opsCardSx, p: SPACE.cardLarge }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <LockOutlinedIcon aria-hidden sx={{ color: OPS_TEXT.brand, fontSize: 19 }} />
          <Box>
            <Typography component="h2" sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: OPS_TEXT.primary }}>Account security</Typography>
            <Typography sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary }}>Choose a new password for this administrator login.</Typography>
          </Box>
        </Box>
        <Button
          variant="outlined"
          startIcon={<LockOutlinedIcon sx={{ fontSize: 16 }} />}
          onClick={() => {
            setChanged(false);
            setOpen(true);
          }}
          sx={secondaryButtonSx}
        >
          Change Password
        </Button>
      </Box>

      {changed && (
        <Alert severity="success" onClose={() => setChanged(false)} sx={{ mt: '13px', borderRadius: '8px', fontSize: FONT.body }}>Your password was changed.</Alert>
      )}

      <ChangePasswordDialog open={open} onClose={() => setOpen(false)} onChanged={() => setChanged(true)} />
    </Card>
  );
};
