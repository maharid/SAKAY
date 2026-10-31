import React, { useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';

import { deactivateOwnAccount } from '../utils/restrictionUtils';
import type { NoticeLanguage, RpcCapableClient } from '../utils/restrictionUtils';

/**
 * "Deactivate my account" for a passenger or a driver (panel comment 12, decision D-P5). The person pauses their own account: it can no longer book (or go Online
 * and receive trips), nothing is deleted, and they come back by signing in and choosing Reactivate. The database refuses while a booking, trip, dispute or review is
 * open and says why in words; this dialog shows that answer. It is not the penalty deactivation of Rule 22.2, which only the LGU can lift.
 */
export interface DeactivateAccountDialogProps {
  open: boolean;
  onClose: () => void;
  role: 'passenger' | 'driver';
  language: NoticeLanguage;
  client: RpcCapableClient;
  /** The account is deactivated: the app signs the person out and goes to the sign-in page */
  onDeactivated: () => void | Promise<void>;
}

const MAX_REASON = 300;

export const DeactivateAccountDialog: React.FC<DeactivateAccountDialogProps> = ({ open, onClose, role, language, client, onDeactivated }) => {
  const tl = language === 'tl';
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setProblem(null);
    setReason('');
    onClose();
  };

  const confirm = async () => {
    setBusy(true);
    setProblem(null);
    const result = await deactivateOwnAccount(client, role, reason.trim() || null, language);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message ?? (tl ? 'Hindi naisagawa.' : 'It could not be done.'));
      return;
    }
    setReason('');
    await onDeactivated();
  };

  const lines = role === 'driver'
    ? [
        tl ? 'Hindi na kayo makakapag-Online at hindi na kayo makakatanggap ng biyahe.' : 'You will not be able to go Online or receive trips.',
        tl ? 'Walang mabubura: nananatili ang inyong mga dokumento, kasaysayan ng biyahe at rating.' : 'Nothing is deleted: your documents, trip history and ratings are kept.',
        tl ? 'Para bumalik, mag-sign in at piliin ang Reactivate.' : 'To come back, sign in and choose Reactivate.',
        tl ? 'Hindi ito maaaring gawin habang may biyaheng tinanggap, o may bukas na reklamo, dispute o review.' : 'It cannot be done while you have an accepted trip, or an open report, dispute or review.',
      ]
    : [
        tl ? 'Hindi na kayo makakapag-book ng biyahe.' : 'You will not be able to book rides.',
        tl ? 'Walang mabubura: nananatili ang inyong profile at kasaysayan ng biyahe.' : 'Nothing is deleted: your profile and trip history are kept.',
        tl ? 'Para bumalik, mag-sign in at piliin ang Reactivate.' : 'To come back, sign in and choose Reactivate.',
        tl ? 'Hindi ito maaaring gawin habang may booking o biyaheng hindi pa tapos, o may bukas na reklamo, dispute o review.' : 'It cannot be done while you have a booking or trip in progress, or an open report, dispute or review.',
      ];

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="xs" aria-labelledby="deactivate-account-title" slotProps={{ paper: { sx: { borderRadius: '16px', m: 2 } } }}>
      <DialogTitle id="deactivate-account-title" sx={{ fontFamily: 'var(--sakay-font-family, Poppins), sans-serif', fontWeight: 700, fontSize: '17px' }}>
        {tl ? 'I-deactivate ang aking account?' : 'Deactivate my account?'}
      </DialogTitle>
      <DialogContent>
        <Box component="ul" sx={{ m: 0, pl: 2.5, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {lines.map((line) => (
            <Typography key={line} component="li" sx={{ fontFamily: 'var(--sakay-font-family, Poppins), sans-serif', fontSize: '13px', color: '#334155', lineHeight: 1.5 }}>
              {line}
            </Typography>
          ))}
        </Box>
        <TextField
          fullWidth
          multiline
          minRows={2}
          margin="normal"
          disabled={busy}
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, MAX_REASON))}
          label={tl ? 'Dahilan (hindi required)' : 'Reason (optional)'}
          helperText={`${reason.length}/${MAX_REASON}`}
          slotProps={{ inputLabel: { sx: { fontFamily: 'var(--sakay-font-family, Poppins), sans-serif' } } }}
        />
        {problem && (
          <Alert severity="warning" role="alert" sx={{ mt: 1, borderRadius: '10px', fontFamily: 'var(--sakay-font-family, Poppins), sans-serif', fontSize: '13px' }}>
            {problem}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Button onClick={close} disabled={busy} sx={{ textTransform: 'none', fontWeight: 600, color: '#475569', fontFamily: 'var(--sakay-font-family, Poppins), sans-serif' }}>
          {tl ? 'Huwag muna' : 'Not now'}
        </Button>
        <Button
          onClick={confirm}
          disabled={busy}
          variant="contained"
          sx={{ textTransform: 'none', fontWeight: 700, backgroundColor: '#B91C1C', fontFamily: 'var(--sakay-font-family, Poppins), sans-serif', '&:hover': { backgroundColor: '#991B1B' } }}
        >
          {busy ? (tl ? 'Isinasagawa...' : 'Working...') : tl ? 'I-deactivate' : 'Deactivate'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
