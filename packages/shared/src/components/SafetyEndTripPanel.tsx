import React, { useId, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Portal from '@mui/material/Portal';
import Snackbar from '@mui/material/Snackbar';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { useInFlight } from '../hooks/useInFlight';
import { SAFETY_END_REASONS, type SafetyEnd, type SafetyEndReason } from '../utils/tripSafety';
import { DIALOG_ACTIONS_SX, DIALOG_CONTENT_SX, DIALOG_INTRO_SX, DIALOG_PAPER_SX, DIALOG_TITLE_SX, EMPTY_OPTION_SX, WRAPPING_SELECT_SLOTS } from './dialogStyles';

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
  /** The trips are still being read: an empty list then says "Loading" instead of "no trips". Optional; without it an empty list means there are none. */
  loading?: boolean;
  /**
   * For a dashboard that puts this next to another action. The panel becomes a compact card (shorter text, larger button, red outline) and the form opens in a
   * MODAL instead of unfolding inside the page, so the card keeps its size and nothing below it is pushed down.
   * The form, the checks and the confirmation step are the same. Off by default: the LGU portal keeps the original look.
   */
  compact?: boolean;
}

/**
 * Rules 29.20 - 29.22, 26.2, 26.3 (decision PI-11C): when the driver cannot end the trip (detained or arrested, medically incapacitated) or the passenger is in danger and the driver does
 * not stop, the driver's TODA Administrator or the LGU Administrator ends it here. The passenger pays at most the distance travelled; the administrator may close the trip as Paid or Waived
 * at once (the TODA Administrator decides the fare, Rule 26.3), or leave it for the ordinary confirmation. A detained driver is held for the TODA and LGU review (Rule 29.20) and nobody
 * is struck. Used by the TODA and LGU portals; the database checks who may do what and records it.
 */
export const SafetyEndTripPanel: React.FC<SafetyEndTripPanelProps> = ({ trips, onEnd, loading = false, compact = false }) => {
  const flight = useInFlight();
  const titleId = useId();
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

  // Closing the modal also drops a pending "Are you sure?", so reopening it always starts from the form and never from the final button.
  const closeModal = () => {
    setOpen(false);
    setConfirming(false);
  };

  // In the compact layout a chosen option can be a long sentence: let it wrap inside the field instead of being cut with "..."
  const selectSlots = compact ? WRAPPING_SELECT_SLOTS : undefined;

  const noTrips = trips.length === 0;
  const noTripsText = loading ? 'Loading trips...' : 'There are currently no trips to end.';
  const tripField = (
    <TextField select size="small" fullWidth label="The trip" value={bookingId} onChange={(e) => { setBookingId(e.target.value); setConfirming(false); }}
      helperText={noTrips ? noTripsText : undefined} slotProps={selectSlots}>
      {noTrips ? (
        // not a record: it cannot be chosen, and it says why the list is empty (or that it is still loading)
        <MenuItem disabled sx={EMPTY_OPTION_SX}>
          <Box component="span" sx={{ display: 'block', fontWeight: 600 }}>{noTripsText}</Box>
          {!loading && (
            <Box component="span" sx={{ display: 'block', fontSize: '11.5px' }}>A trip can be ended here only while it is on and has a driver.</Box>
          )}
        </MenuItem>
      ) : (
        trips.map((t) => (
          <MenuItem key={t.bookingId} value={t.bookingId}>{t.label}</MenuItem>
        ))
      )}
    </TextField>
  );
  const reasonField = (
    <TextField select size="small" fullWidth label="What happened" value={reason} onChange={(e) => { setReason(e.target.value as SafetyEndReason); setConfirming(false); }} helperText={hint} slotProps={selectSlots}>
      {SAFETY_END_REASONS.map((r) => (
        <MenuItem key={r.code} value={r.code}>{r.en}</MenuItem>
      ))}
    </TextField>
  );
  const noteField = (
    <TextField size="small" multiline rows={3} fullWidth label="How it was confirmed: who you reached and what they said (at least 10 characters)" value={note} onChange={(e) => setNote(e.target.value)} />
  );
  const fareField = (
    <TextField select size="small" fullWidth label="The fare" value={closeAs} onChange={(e) => setCloseAs(e.target.value as '' | 'Paid' | 'Waived')}
      helperText="The passenger pays the distance travelled at most (the system computes it)." slotProps={selectSlots}>
      <MenuItem value="">Leave the trip open: the passenger confirms the fare, the payment is recorded as usual</MenuItem>
      <MenuItem value="Paid">Close it now: the cash was received (Paid)</MenuItem>
      <MenuItem value="Waived">Close it now: no fare (Waived)</MenuItem>
    </TextField>
  );
  const errorAlert = message && message.severity === 'error' ? <Alert severity="error">{message.text}</Alert> : null;
  const confirmAlert = (
    <Alert severity="warning" sx={{ flexWrap: 'wrap', '& .MuiAlert-message': { flex: '1 1 160px' }, '& .MuiAlert-action': { ml: 'auto' } }} action={
      <Button color="error" size="small" variant="contained" disabled={flight.busy} onClick={submit} sx={{ textTransform: 'none', fontWeight: 700, boxShadow: 'none', whiteSpace: 'nowrap' }}>
        {flight.busy ? 'Ending...' : 'Yes, end it now'}
      </Button>
    }>
      This ends the trip for the passenger and the driver now. It cannot be undone.
    </Alert>
  );
  const endButton = (
    <Button variant="contained" color="error" disabled={!ready || flight.busy} onClick={() => setConfirming(true)}
      sx={{ textTransform: 'none', fontWeight: 700, alignSelf: 'flex-start', boxShadow: 'none' }}>
      End the trip...
    </Button>
  );

  if (compact) {
    return (
      <>
        {/* The card never changes size: it only opens the modal. */}
        <Paper
          elevation={0}
          sx={{ p: '16px 19px', borderRadius: '13px', border: '1px solid #FCA5A5', backgroundColor: '#FFFFFF', display: 'flex', alignItems: 'center' }}
        >
          <Box sx={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
            <Box sx={{ flex: '1 1 192px', minWidth: 0 }}>
              <Typography component="h2" sx={{ fontWeight: 700, fontSize: '14px', color: '#0F172A' }}>End a trip for safety</Typography>
              <Typography sx={{ fontSize: '11.5px', color: '#475569', lineHeight: 1.5 }}>
                For a detained or ill driver, an accident, or a passenger in danger. No strike is given to anyone.
              </Typography>
            </Box>
            <Button
              variant="contained"
              color="error"
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
              sx={{
                textTransform: 'none', fontWeight: 700, borderRadius: '8px', boxShadow: 'none', minHeight: 36, minWidth: 167, px: '16px', fontSize: '12px', flexShrink: 0,
                '@media (pointer: coarse)': { minHeight: 44 },
                '&:focus-visible': { outline: '2px solid #1d1d1f', outlineOffset: 2 },
              }}
            >
              End a trip for safety
            </Button>
          </Box>
        </Paper>

        <Dialog open={open} onClose={closeModal} maxWidth="sm" fullWidth aria-labelledby={titleId} slotProps={{ paper: { sx: DIALOG_PAPER_SX } }}>
          <DialogTitle id={titleId} sx={DIALOG_TITLE_SX}>End a trip for safety</DialogTitle>
          <DialogContent sx={DIALOG_CONTENT_SX}>
            <Typography sx={DIALOG_INTRO_SX}>
              A driver who was detained or arrested, a driver who became ill, an accident, or a passenger in danger: you end the trip, nobody is struck.
            </Typography>
            {tripField}
            {reasonField}
            {noteField}
            {fareField}
          </DialogContent>
          {/* the answer to "are you sure?" and any message from the database stay in view, below the scrolling form */}
          {(errorAlert || confirming) && (
            <Box sx={{ px: '19px', pb: '6px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {errorAlert}
              {confirming && confirmAlert}
            </Box>
          )}
          <DialogActions sx={DIALOG_ACTIONS_SX}>
            <Button onClick={closeModal} sx={{ textTransform: 'none', color: '#475569' }}>Cancel</Button>
            {!confirming && endButton}
          </DialogActions>
        </Dialog>

        {/* the result after the modal closed: it floats over the page, so it never moves the cards or the tables */}
        <Portal>
          <Snackbar open={Boolean(message) && !open} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
            {message ? <Alert severity={message.severity} onClose={() => setMessage(null)} sx={{ width: '100%' }}>{message.text}</Alert> : undefined}
          </Snackbar>
        </Portal>
      </>
    );
  }

  return (
    <Paper elevation={0} sx={{ p: 2.5, mb: 3, borderRadius: '16px', border: '1px solid #E2E8F0' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 240 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '15px', color: '#0F172A' }}>End a trip for safety</Typography>
          <Typography sx={{ fontSize: '12.5px', color: '#64748B', lineHeight: 1.5 }}>
            A driver who was detained or arrested, a driver who became ill, an accident, or a passenger in danger: you end the trip, nobody is struck.
          </Typography>
        </Box>
        <Button
          variant={open ? 'outlined' : 'contained'}
          color="error"
          onClick={() => setOpen(!open)}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px', boxShadow: 'none' }}
        >
          {open ? 'Close' : 'End a trip for safety'}
        </Button>
      </Box>
      {message && !open && <Alert severity={message.severity} sx={{ mt: 1.5 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

      {open && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 2 }}>
          {tripField}
          {reasonField}
          {noteField}
          {fareField}
          {errorAlert}
          {confirming ? confirmAlert : endButton}
        </Box>
      )}
    </Paper>
  );
};

export default SafetyEndTripPanel;
