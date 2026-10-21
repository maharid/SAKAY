import React, { useState } from 'react';
import { Alert, Box, Button, Card, TextField, Typography } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { checkPassword } from '@sakay/shared';

import { supabase } from '../../services/supabaseClient';

/**
 * Checklist B1: the TODA administrator changes their own password. The same four rules as the other SAKAY apps (8 characters, upper and lower case, a number, a symbol);
 * the login system sets it for the signed-in user only.
 */
export const ChangePasswordCard: React.FC = () => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);
  const check = checkPassword(password);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!check.ok) {
      setMessage({ severity: 'error', text: 'The password does not meet all four rules below.' });
      return;
    }
    if (password !== confirm) {
      setMessage({ severity: 'error', text: 'The two passwords do not match.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setMessage({ severity: 'error', text: error.message || 'The password could not be changed. Please try again.' });
      return;
    }
    setPassword('');
    setConfirm('');
    setMessage({ severity: 'success', text: 'Your password was changed.' });
  };

  const rule = (ok: boolean, text: string) => (
    <Typography key={text} sx={{ fontSize: '12.5px', color: ok ? '#1E8E3E' : 'var(--mac-text-muted)' }}>
      {ok ? '✓' : '•'} {text}
    </Typography>
  );

  return (
    <Card
      elevation={0}
      sx={{ p: 3, mt: 3, borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', backgroundColor: '#FFFFFF', boxShadow: 'none', maxWidth: 560 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
        <LockOutlinedIcon sx={{ color: 'var(--sakay-orange)', fontSize: 22 }} />
        <Typography sx={{ fontSize: '18px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>Change Password</Typography>
      </Box>
      <Typography sx={{ fontSize: '13.5px', color: 'var(--mac-text-muted)', mb: 2 }}>Choose a new password for this administrator login.</Typography>
      {message && <Alert severity={message.severity} sx={{ mb: 2, borderRadius: '10px' }}>{message.text}</Alert>}
      <form onSubmit={submit}>
        <TextField fullWidth size="small" type="password" label="New password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} sx={{ mb: 1.5 }} />
        <TextField fullWidth size="small" type="password" label="Confirm new password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy} sx={{ mb: 1.5 }} />
        <Box sx={{ mb: 2 }}>
          {rule(check.length, 'At least 8 characters')}
          {rule(check.letters, 'Upper and lower case letters')}
          {rule(check.digit, 'A number')}
          {rule(check.symbol, 'A symbol')}
          {check.tooLong && rule(false, 'No longer than 72 bytes')}
        </Box>
        <Button
          type="submit"
          variant="contained"
          disabled={busy || !password}
          sx={{ textTransform: 'none', fontWeight: 600, backgroundColor: 'var(--sakay-orange)', borderRadius: '8px', boxShadow: 'none', '&:hover': { backgroundColor: '#E65C00', boxShadow: 'none' } }}
        >
          {busy ? 'Saving...' : 'Change password'}
        </Button>
      </form>
    </Card>
  );
};
