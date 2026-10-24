import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { checkPassword } from '@sakay/shared';
import { DIALOG_ACTIONS_SX, DIALOG_CONTENT_SX, DIALOG_INTRO_SX, DIALOG_PAPER_SX, DIALOG_TITLE_SX } from '@sakay/shared/components/dialogStyles';

import { supabase } from '../../services/supabaseClient';
import { useLanguage } from '../../hooks/useLanguage';
import { FONT, SPACE } from '../../styles/density';
import { OPS_TEXT, opsCardSx } from '../operations/operationsTheme';
import { primaryButtonSx, secondaryButtonSx } from './pageButtons';

interface ChangePasswordDialogProps {
  open: boolean;
  onClose: () => void;
  /** called after the password was changed (the window has been closed) */
  onChanged: () => void;
}

/**
 * Checklist B1: the TODA administrator changes their own password. The same four rules as the other SAKAY apps (8 characters, upper and lower case, a number, a symbol);
 * the login system sets it for the signed-in user only. It is a window, so any page can offer it (Account & Accreditation and Settings do).
 */
export const ChangePasswordDialog: React.FC<ChangePasswordDialogProps> = ({ open, onClose, onChanged }) => {
  const { t } = useLanguage();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = checkPassword(password);

  // every time the window opens it starts empty
  useEffect(() => {
    if (open) {
      setPassword('');
      setConfirm('');
      setError(null);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!check.ok) {
      setError(t('password.rules'));
      return;
    }
    if (password !== confirm) {
      setError(t('password.mismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(updateError.message || 'The password could not be changed. Please try again.');
      return;
    }
    setPassword('');
    setConfirm('');
    onClose();
    onChanged();
  };

  // a rule that is met shows a tick and turns green; one that is not shows a dot, so the state is in the symbol and not only in the colour
  const rule = (ok: boolean, text: string) => (
    <Typography key={text} sx={{ fontSize: FONT.small, color: ok ? OPS_TEXT.success : OPS_TEXT.secondary }}>
      {ok ? '✓' : '•'} {text}
    </Typography>
  );

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} maxWidth="xs" fullWidth slotProps={{ paper: { sx: DIALOG_PAPER_SX } }}>
      <form onSubmit={submit}>
        <DialogTitle sx={DIALOG_TITLE_SX}>{t('password.change')}</DialogTitle>
        <DialogContent sx={DIALOG_CONTENT_SX}>
          <Typography sx={DIALOG_INTRO_SX}>Choose a new password for this administrator login.</Typography>
          {error && <Alert severity="error" sx={{ borderRadius: '8px', fontSize: FONT.body }}>{error}</Alert>}
          <TextField fullWidth size="small" type="password" label={t('password.new')} autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
          <TextField fullWidth size="small" type="password" label={t('password.confirm')} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy} />
          <Box>
            {rule(check.length, 'At least 8 characters')}
            {rule(check.letters, 'Upper and lower case letters')}
            {rule(check.digit, 'A number')}
            {rule(check.symbol, 'A symbol')}
            {check.tooLong && rule(false, 'No longer than 72 bytes')}
          </Box>
        </DialogContent>
        <DialogActions sx={DIALOG_ACTIONS_SX}>
          <Button onClick={onClose} disabled={busy} variant="outlined" sx={secondaryButtonSx}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disableElevation disabled={busy || !password} sx={primaryButtonSx}>
            {busy ? 'Saving...' : t('password.change')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
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
