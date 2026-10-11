import React, { useState } from 'react';
import { Alert, Box, MenuItem, TextField, Typography } from '@mui/material';

import { MacCenterModal } from '../admin/MacCenterModal';
import { sendDriverReminder } from '../../services/todaApiService';
import type { ReminderAudience } from '../../services/todaApiService';

/**
 * Send a reminder to the TODA's drivers (checklist: TODA Administrator > Manage Announcements > Send reminders).
 * It goes to each driver's notifications (Abiso in the Driver app). The database decides who receives it: only the verified
 * members of this TODA, and for "expiring documents" only those whose Driver's License or MTOP is expired or ends within 30 days.
 */
interface SendReminderDialogProps {
  open: boolean;
  onClose: () => void;
  /** called after a successful send with the number of drivers reached */
  onSent: (count: number) => void;
}

const TITLE_MAX = 80;
const MESSAGE_MAX = 500;

const AUDIENCES: Array<{ value: ReminderAudience; label: string }> = [
  { value: 'ALL_DRIVERS', label: 'All verified drivers of my TODA' },
  { value: 'EXPIRING_DOCUMENTS', label: 'Drivers whose license or MTOP is expired or expires within 30 days' },
];

export const SendReminderDialog: React.FC<SendReminderDialogProps> = ({ open, onClose, onSent }) => {
  const [audience, setAudience] = useState<ReminderAudience>('ALL_DRIVERS');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const valid = title.trim().length > 0 && message.trim().length > 0;

  const close = () => {
    if (sending) return;
    setError(null);
    setResult(null);
    onClose();
  };

  const send = async () => {
    if (!valid || sending) return;
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const { sent } = await sendDriverReminder(audience, title, message);
      setResult(sent === 0 ? 'No driver matched, so nothing was sent.' : `Reminder sent to ${sent} driver${sent === 1 ? '' : 's'}.`);
      if (sent > 0) {
        setTitle('');
        setMessage('');
        onSent(sent);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <MacCenterModal
      open={open}
      onClose={close}
      title="Send Reminder to Drivers"
      subtitle="Delivered to each driver's notifications in the Driver App"
      maxWidth={640}
      primaryActionLabel={valid && !result ? (sending ? 'Sending...' : 'Send Reminder') : undefined}
      onPrimaryAction={valid && !result ? send : undefined}
      secondaryActionLabel={result ? 'Close' : 'Cancel'}
      onSecondaryAction={close}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <TextField
          select
          fullWidth
          label="Who should receive it"
          value={audience}
          onChange={(e) => setAudience(e.target.value as ReminderAudience)}
          slotProps={{
            input: {
              sx: {
                borderRadius: '12px',
                '& fieldset': { borderColor: '#E5E5EA' },
                '&:hover fieldset': { borderColor: '#C7C7CC' },
                '&.Mui-focused fieldset': { borderColor: '#FF6600' },
              },
            },
          }}
        >
          {AUDIENCES.map((a) => (
            <MenuItem key={a.value} value={a.value}>{a.label}</MenuItem>
          ))}
        </TextField>

        <TextField
          fullWidth
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
          placeholder="e.g. Renew your Driver's License"
          helperText={`${title.length}/${TITLE_MAX}`}
          slotProps={{
            input: {
              sx: {
                borderRadius: '12px',
                '& fieldset': { borderColor: '#E5E5EA' },
                '&:hover fieldset': { borderColor: '#C7C7CC' },
                '&.Mui-focused fieldset': { borderColor: '#FF6600' },
              },
            },
          }}
        />

        <TextField
          fullWidth
          multiline
          rows={4}
          label="Message"
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX))}
          placeholder="What should the drivers do, and by when?"
          helperText={`${message.length}/${MESSAGE_MAX}`}
          slotProps={{
            input: {
              sx: {
                borderRadius: '12px',
                '& fieldset': { borderColor: '#E5E5EA' },
                '&:hover fieldset': { borderColor: '#C7C7CC' },
                '&.Mui-focused fieldset': { borderColor: '#FF6600' },
              },
            },
          }}
        />

        {error && <Alert severity="error" sx={{ borderRadius: '10px' }}>{error}</Alert>}
        {result && <Alert severity={result.startsWith('No driver') ? 'info' : 'success'} sx={{ borderRadius: '10px' }}>{result}</Alert>}
      </Box>
    </MacCenterModal>
  );
};

export default SendReminderDialog;
