import React, { useState } from 'react';
import { Alert, Box, Button, MenuItem, TextField, Typography } from '@mui/material';
import { CLOSE_PAYMENT_STATUSES, CORRECTION_PAYMENT_STATUSES, closeProblem, correctionProblem } from '@sakay/shared';

import { closeUnfinishedTrip, correctCompletedTrip } from '../../services/adminApiService';
import { FONT } from '../../styles/density';
import { PAGE_TEXT, primaryButtonSx } from '../../styles/pageTheme';

interface TripCorrectionSectionProps {
  bookingId: string;
  /** Completed: the audited correction (Rule 16.3). Arrived at Destination: close the trip the driver never finished (PI-15). */
  status: string;
  /** the fare as the system holds it (actual fare) and the payment status */
  finalFare: number | null | undefined;
  paymentStatus: string | null | undefined;
  /** the trip was changed: the page closes the dialog and reloads */
  onChanged: () => void | Promise<void>;
}

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography component="h3" sx={{ fontSize: FONT.heading, fontWeight: 700, color: PAGE_TEXT.primary, mb: 1 }}>{children}</Typography>
);

/**
 * Rule 16.3: a completed trip is read-only except for this one audited action of the LGU Administrator: the fare (never above the system's) and / or the
 * payment status, with a reason of at least 10 characters. PI-15: a trip left at the destination (the driver never tapped Payment Received) is closed
 * as Paid or Waived after the parties were contacted. The database enforces who may, the limits and the audit entry, and tells the passenger and the driver.
 */
export const TripCorrectionSection: React.FC<TripCorrectionSectionProps> = ({ bookingId, status, finalFare, paymentStatus, onChanged }) => {
  const [fare, setFare] = useState('');
  const [payment, setPayment] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status !== 'Completed' && status !== 'Arrived at Destination') return null;
  const closing = status === 'Arrived at Destination';
  const current = finalFare ?? null;

  const typedFare = fare.trim() === '' ? null : Number(fare);
  const problem = closing
    ? closeProblem(payment || null, reason)
    : correctionProblem({ currentFare: current, currentPayment: paymentStatus ?? null, newFare: typedFare, paymentStatus: payment || null, reason });

  const submit = async () => {
    if (problem || busy) return;
    setBusy(true);
    setError(null);
    const message = closing
      ? await closeUnfinishedTrip(bookingId, payment, reason)
      : await correctCompletedTrip(bookingId, typedFare, payment || null, reason);
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    await onChanged();
  };

  return (
    <Box sx={{ mt: 2.4, pt: 2.4, borderTop: '1px solid var(--mac-border-color)' }}>
      <SectionTitle>{closing ? 'Close this trip (Payment Received was never tapped)' : 'Administrative correction'}</SectionTitle>
      <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, lineHeight: 1.5, mb: 1.6 }}>
        {closing
          ? 'Contact the driver and the passenger first, then close the trip as Paid (the cash was received) or Waived (no fare). The reason says who was reached and what they said. Both are told.'
          : 'A completed trip is read-only. This is the one audited way to fix its fare (never above the system\'s fare) or its payment status. The route, the times and the people never change. Both the passenger and the driver are told.'}
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: closing ? '1fr' : '1fr 1fr' }, gap: 1.6, mb: 1.6 }}>
        {!closing && (
          <TextField
            size="small"
            type="number"
            label={`New fare (system's fare: ${current === null ? '-' : Number(current).toFixed(2)})`}
            value={fare}
            onChange={(e) => setFare(e.target.value)}
            slotProps={{ htmlInput: { min: 0, max: current ?? 0, step: '0.01' } }}
          />
        )}
        <TextField select size="small" label={closing ? 'Close as' : `Payment status (now: ${paymentStatus ?? '-'})`} value={payment} onChange={(e) => setPayment(e.target.value)}>
          {!closing && <MenuItem value="">Keep the payment status</MenuItem>}
          {(closing ? CLOSE_PAYMENT_STATUSES : CORRECTION_PAYMENT_STATUSES).map((s) => (
            <MenuItem key={s} value={s}>{closing ? (s === 'Paid' ? 'Paid (the cash was received)' : 'Waived (no fare)') : s}</MenuItem>
          ))}
        </TextField>
      </Box>
      <TextField
        multiline
        minRows={2}
        size="small"
        fullWidth
        label={closing ? 'How the outcome was confirmed (at least 10 characters)' : 'Reason for the correction (at least 10 characters, kept in the audit log)'}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        sx={{ mb: 1.2 }}
      />
      {problem && reason.length > 0 && <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mb: 0.8 }}>{problem}</Typography>}
      {error && <Alert severity="error" sx={{ borderRadius: '10px', mb: 1.2 }}>{error}</Alert>}
      <Button
        variant="contained"
        disabled={Boolean(problem) || busy}
        onClick={submit}
        sx={primaryButtonSx}
      >
        {closing ? 'Close the trip' : 'Record the correction'}
      </Button>
    </Box>
  );
};
