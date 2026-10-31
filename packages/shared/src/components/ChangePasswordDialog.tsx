import React, { useEffect, useId, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, IconButton, InputAdornment, TextField, Typography } from '@mui/material';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';

import { SakayDialogTitle } from './SakayDialogTitle';
import { DIALOG_ACTIONS_SX, DIALOG_CONTENT_SX, DIALOG_INTRO_SX, DIALOG_PAPER_SX, DIALOG_TITLE_SX } from './dialogStyles';
import { checkPassword } from '../utils/passwordPolicy';

export interface ChangePasswordLabels {
  title: string;
  intro: string;
  current: string;
  newPassword: string;
  confirm: string;
  cancel: string;
  submit: string;
  submitting: string;
}

const DEFAULT_LABELS: ChangePasswordLabels = {
  title: 'Change password',
  intro: 'Enter your current password, then choose a new one for this administrator login.',
  current: 'Current password',
  newPassword: 'New password',
  confirm: 'Confirm new password',
  cancel: 'Cancel',
  submit: 'Change password',
  submitting: 'Updating your password...',
};

export interface ChangePasswordDialogProps {
  open: boolean;
  onClose: () => void;
  /** Checks the password the person types as their current one (the login system re-checks it). Answers null when it is right, else the sentence to show. */
  verifyCurrent: (current: string) => Promise<string | null>;
  /** Sets the new password through the portal's login system. Answers null when it was set, else the sentence to show (the login system's own words). */
  setNewPassword: (password: string) => Promise<string | null>;
  /** Called after the password was changed and the window closed (the page says so with a toast) */
  onChanged: () => void;
  labels?: Partial<ChangePasswordLabels>;
}

const STRENGTH = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'] as const;
const STRENGTH_COLOR = ['#9AA0A6', '#D93025', '#E0A100', '#2E8B47', '#15803D'] as const;

/** One password box with a button that shows or hides what was typed (the type is announced, so the button's state is never only an icon) */
const PasswordField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  autoComplete: string;
  autoFocus?: boolean;
  error?: string | null;
  helper?: string;
}> = ({ label, value, onChange, disabled, autoComplete, autoFocus, error, helper }) => {
  const [shown, setShown] = useState(false);
  return (
    <TextField
      fullWidth
      size="small"
      required
      type={shown ? 'text' : 'password'}
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      error={Boolean(error)}
      helperText={error ?? helper}
      slotProps={{
        formHelperText: error ? { role: 'alert' } : undefined,
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton size="small" edge="end" onClick={() => setShown((v) => !v)} disabled={disabled} aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} aria-pressed={shown}>
                {shown ? <VisibilityOffOutlinedIcon sx={{ fontSize: 18 }} /> : <VisibilityOutlinedIcon sx={{ fontSize: 18 }} />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  );
};

/**
 * The window in which an administrator changes their own password (the LGU and TODA portals use this one). It asks for the current password (the login system checks it again),
 * shows the rules as a live checklist and a strength bar, says at once when the confirmation differs, says what is happening while the password is being set, and shows the login
 * system's own sentence when it refuses. The password is never kept or shown anywhere: it is cleared whenever the window opens or closes.
 */
export const ChangePasswordDialog: React.FC<ChangePasswordDialogProps> = ({ open, onClose, verifyCurrent, setNewPassword, onChanged, labels }) => {
  const text = { ...DEFAULT_LABELS, ...labels };
  const rulesId = useId();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentError, setCurrentError] = useState<string | null>(null);

  // every time the window opens it starts empty
  useEffect(() => {
    if (open) {
      setCurrent('');
      setPassword('');
      setConfirm('');
      setError(null);
      setCurrentError(null);
      setBusy(false);
    }
  }, [open]);

  const check = checkPassword(password);
  const differs = password.length > 0 && current.length > 0 ? password !== current : true;
  const matches = confirm.length > 0 && password === confirm;
  const mismatch = confirm.length > 0 && password !== confirm;
  const met = [check.length, check.letters, check.digit, check.symbol].filter(Boolean).length;
  const strength = password.length === 0 ? 0 : check.tooLong ? 1 : met;
  const ready = current.length > 0 && check.ok && matches && differs && !busy;

  const rules: Array<{ ok: boolean; label: string }> = [
    { ok: check.length, label: 'At least 8 characters' },
    { ok: check.letters, label: 'Upper and lower case letters' },
    { ok: check.digit, label: 'A number' },
    { ok: check.symbol, label: 'A symbol' },
    ...(check.tooLong ? [{ ok: false, label: 'No longer than 72 bytes' }] : []),
    { ok: password.length > 0 && differs, label: 'Different from your current password' },
    { ok: matches, label: 'Matches the confirmation' },
  ];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    // the same checks as the button, again: nothing is sent unless every rule is met
    if (!ready) {
      setError(!current ? 'Enter your current password.' : !check.ok ? 'The new password does not meet every rule below.' : !differs ? 'Choose a password that is different from the current one.' : 'The two new passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    setCurrentError(null);
    try {
      const wrong = await verifyCurrent(current);
      if (wrong) {
        setCurrentError(wrong);
        return;
      }
      const refused = await setNewPassword(password);
      if (refused) {
        setError(refused);
        return;
      }
      setCurrent('');
      setPassword('');
      setConfirm('');
      onClose();
      onChanged();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'The password could not be changed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} maxWidth="xs" fullWidth slotProps={{ paper: { sx: DIALOG_PAPER_SX } }}>
      <form onSubmit={submit} noValidate>
        <SakayDialogTitle onClose={onClose} busy={busy} sx={DIALOG_TITLE_SX}>{text.title}</SakayDialogTitle>
        <DialogContent sx={DIALOG_CONTENT_SX}>
          <Typography sx={DIALOG_INTRO_SX}>{text.intro}</Typography>
          {error && <Alert severity="error" role="alert" sx={{ borderRadius: '8px', fontSize: '12px' }}>{error}</Alert>}
          {busy && (
            <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#4d4d52', fontSize: '12px' }}>
              <CircularProgress size={14} sx={{ color: '#C75000' }} /> {text.submitting}
            </Box>
          )}
          <PasswordField label={text.current} value={current} onChange={(v) => { setCurrent(v); setCurrentError(null); }} disabled={busy} autoComplete="current-password" autoFocus error={currentError} />
          <PasswordField label={text.newPassword} value={password} onChange={setPassword} disabled={busy} autoComplete="new-password" helper="Use a password you do not use anywhere else." />
          <Box aria-hidden={password.length === 0} sx={{ mt: '-4px' }}>
            <Box sx={{ display: 'flex', gap: '4px' }} aria-hidden>
              {[1, 2, 3, 4].map((i) => (
                <Box key={i} sx={{ flex: 1, height: 5, borderRadius: '3px', backgroundColor: i <= strength ? STRENGTH_COLOR[strength] : '#E5E5EA', transition: 'background-color 0.2s' }} />
              ))}
            </Box>
            {password.length > 0 && (
              <Typography role="status" sx={{ fontSize: '11.5px', mt: '3px', color: STRENGTH_COLOR[strength], fontWeight: 600 }}>
                Strength: {STRENGTH[strength]}
              </Typography>
            )}
          </Box>
          <PasswordField label={text.confirm} value={confirm} onChange={setConfirm} disabled={busy} autoComplete="new-password" error={mismatch ? 'The two new passwords do not match.' : null} />
          <Box component="ul" id={rulesId} aria-label="Password rules" sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {rules.map((r) => (
              <Box component="li" key={r.label} sx={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: r.ok ? '#15803D' : '#4d4d52', fontWeight: r.ok ? 600 : 400 }}>
                {r.ok ? <CheckCircleOutlineIcon aria-hidden sx={{ fontSize: 15 }} /> : <RadioButtonUncheckedIcon aria-hidden sx={{ fontSize: 15 }} />}
                <span>
                  <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{r.ok ? 'Met: ' : 'Not met yet: '}</Box>
                  {r.label}
                </span>
              </Box>
            ))}
          </Box>
        </DialogContent>
        <DialogActions sx={DIALOG_ACTIONS_SX}>
          <Button onClick={onClose} disabled={busy} variant="outlined" sx={{ textTransform: 'none', fontWeight: 600, color: '#1d1d1f', borderColor: 'rgba(15, 23, 42, 0.18)' }}>
            {text.cancel}
          </Button>
          <Button type="submit" variant="contained" disableElevation disabled={!ready} sx={{ textTransform: 'none', fontWeight: 700, backgroundColor: '#C75000', color: '#FFFFFF', '&:hover': { backgroundColor: '#B34700' }, '&.Mui-disabled': { backgroundColor: 'rgba(199, 80, 0, 0.35)', color: '#FFFFFF' } }}>
            {busy ? text.submitting : text.submit}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

export default ChangePasswordDialog;
