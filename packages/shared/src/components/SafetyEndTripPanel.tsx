import React, { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { useInFlight } from '../hooks/useInFlight';
import { SAFETY_END_REASONS, type SafetyEnd, type SafetyEndReason } from '../utils/tripSafety';

export interface SafetyEndTripOption {
  bookingId: string;
  /** what the administrator recognizes the trip by (the driver, the plate, the route) */
  label: string;
}

export interface SafetyEndTripPanelProps {
  /** the trips this administrator may end: the TODA Administrator's own drivers' live trips, or every live trip for the LGU Administrator */
  trips: SafetyEndTripOption[];
  /** Resolves to null when the database accepted it, else to what the database said (shown as it is) */
  onEnd: (end: SafetyEnd) => Promise<string | null>;
}

/**
 * Rules 29.20 - 29.22, 26.2, 26.3 (decision PI-11C): when the driver cannot end the trip (detained or arrested, medically incapacitated) or the passenger is in danger and the driver does
 * not stop, the driver's TODA Administrator or the LGU Administrator ends it here. The passenger pays at most the distance travelled; the administrator may close the trip as Paid or Waived
 * at once (the TODA Administrator decides the fare, Rule 26.3), or leave it for the ordinary confirmation. A detained driver is held for the TODA and LGU review (Rule 29.20) and nobody
 * is struck. Used by the TODA and LGU portals; the database checks who may do what and records it.
 */
export const SafetyEndTripPanel: React.FC<SafetyEndTripPanelProps> = ({ trips, onEnd }) => {
  const flight = useInFlight();
  const [open, setOpen] = useState(false);
  const [bookingId, setBookingId] = useState('');
  const [reason, setReason] = useState<SafetyEndReason>('passenger_in_danger');
  const [note, setNote] = useState('');
  const [closeAs, setCloseAs] = useState<'' | 'Paid' | 'Waived'>('');
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);

  const hint = SAFETY_END_REASONS.find((r) => r.code === reason)?.note ?? '';
  const ready = bookingId !== '' && note.trim().length >= 10;

  const submit = () =>
    flight.run(async () => {
      const problem = await onEnd({ bookingId, reason, note: note.trim(), closeAs: closeAs === '' ? null : closeAs });
      setConfirming(false);
      if (problem) {
        setMessage({ severity: 'error', text: problem });
        return;
      }
      setMessage({ severity: 'success', text: 'The trip was ended for safety and recorded. The passenger and the driver were told.' });
      setNote('');
      setBookingId('');
      setCloseAs('');
      setOpen(false);
    });

  return (
    <Paper elevation={0} sx={{ p: 2.5, mb: 3, borderRadius: '16px', border: '1px solid #E2E8F0' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 240 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '15px', color: '#0F172A' }}>End a trip for safety</Typography>
          <Typography sx={{ fontSize: '12.5px', color: '#64748B', lineHeight: 1.5 }}>
            A driver who was detained or arrested, a driver who became ill, an accident, or a passenger in danger (Rules 29.20 - 29.22): you end the trip, nobody is struck.
          </Typography>
        </Box>
        <Button variant={open ? 'outlined' : 'contained'} color="error" onClick={() => setOpen(!open)} sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px', boxShadow: 'none' }}>
          {open ? 'Close' : 'End a trip for safety'}
        </Button>
      </Box>
      {message && !open && <Alert severity={message.severity} sx={{ mt: 1.5 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

      {open && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 2 }}>
          <TextField select size="small" fullWidth label="The trip" value={bookingId} onChange={(e) => { setBookingId(e.target.value); setConfirming(false); }}
            helperText={trips.length === 0 ? 'There is no live trip to end.' : undefined}>
            {trips.map((t) => (
              <MenuItem key={t.bookingId} value={t.bookingId}>{t.label}</MenuItem>
            ))}
          </TextField>
          <TextField select size="small" fullWidth label="What happened" value={reason} onChange={(e) => { setReason(e.target.value as SafetyEndReason); setConfirming(false); }} helperText={hint}>
            {SAFETY_END_REASONS.map((r) => (
              <MenuItem key={r.code} value={r.code}>{r.en}</MenuItem>
            ))}
          </TextField>
          <TextField size="small" multiline rows={3} fullWidth label="How it was confirmed: who you reached and what they said (at least 10 characters)" value={note} onChange={(e) => setNote(e.target.value)} />
          <TextField select size="small" fullWidth label="The fare" value={closeAs} onChange={(e) => setCloseAs(e.target.value as '' | 'Paid' | 'Waived')}
            helperText="The passenger pays the distance travelled at most (the system computes it).">
            <MenuItem value="">Leave the trip open: the passenger confirms the fare, the payment is recorded as usual</MenuItem>
            <MenuItem value="Paid">Close it now: the cash was received (Paid)</MenuItem>
            <MenuItem value="Waived">Close it now: no fare (Waived, Rule 26.3)</MenuItem>
          </TextField>
          {message && message.severity === 'error' && <Alert severity="error">{message.text}</Alert>}
          {!confirming ? (
            <Button variant="contained" color="error" disabled={!ready || flight.busy} onClick={() => setConfirming(true)} sx={{ textTransform: 'none', fontWeight: 700, alignSelf: 'flex-start', boxShadow: 'none' }}>
              End the trip...
            </Button>
          ) : (
            <Alert severity="warning" action={
              <Button color="error" size="small" variant="contained" disabled={flight.busy} onClick={submit} sx={{ textTransform: 'none', fontWeight: 700, boxShadow: 'none' }}>
                {flight.busy ? 'Ending...' : 'Yes, end it now'}
              </Button>
            }>
              This ends the trip for the passenger and the driver now. It cannot be undone.
            </Alert>
          )}
        </Box>
      )}
    </Paper>
  );
};

export default SafetyEndTripPanel;
