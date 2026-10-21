import React, { useEffect, useState } from 'react';
import { Alert, Box, TextField, Typography } from '@mui/material';

import { MacCenterModal } from './MacCenterModal';

interface TodaAccreditationDialogProps {
  open: boolean;
  /** approve: a new or returned application; renew: an accredited TODA whose Barangay Clearance was renewed */
  mode: 'approve' | 'renew';
  todaName: string;
  /** False when the TODA has uploaded no Barangay Clearance: the database refuses the approval, so this screen does not offer it (Rule 2.1) */
  hasClearance: boolean;
  /** Prefilled for a renewal */
  currentCertificateNumber?: string | null;
  /** What the TODA says the clearance is valid until (YYYY-MM-DD): prefilled, never trusted. The Administrator reads the document and confirms or corrects it. */
  declaredValidUntil?: string | null;
  onClose: () => void;
  /** Resolves when the database accepted it; rejects with the database's own explanation, which is shown here */
  onSubmit: (certificateNumber: string, validUntilIso: string, remarks: string) => Promise<void>;
}

/** Today's date in Manila as YYYY-MM-DD (the database compares dates in Asia/Manila). */
const manilaDay = (offsetDays = 0): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offsetDays * 86_400_000));

/**
 * Rule 2.1 / checklist A2.5, A2.8: the LGU Administrator reads the Barangay Clearance and types its certificate number and the date it is valid until. Nothing is made up
 * on the way: a missing number or date, a date that is not in the future, or a TODA with no clearance on file cannot be saved.
 */
export const TodaAccreditationDialog: React.FC<TodaAccreditationDialogProps> = ({ open, mode, todaName, hasClearance, currentCertificateNumber, declaredValidUntil, onClose, onSubmit }) => {
  const [certificateNumber, setCertificateNumber] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCertificateNumber(mode === 'renew' ? currentCertificateNumber ?? '' : '');
      setValidUntil(declaredValidUntil && declaredValidUntil >= manilaDay(1) ? declaredValidUntil : '');
      setRemarks('');
      setError(null);
      setBusy(false);
    }
  }, [open, mode, currentCertificateNumber, declaredValidUntil]);

  const tomorrow = manilaDay(1);
  const problem =
    !certificateNumber.trim() ? 'Enter the certificate number shown on the Barangay Clearance.'
    : !validUntil ? 'Enter the date the Barangay Clearance is valid until.'
    : validUntil < tomorrow ? 'The Barangay Clearance must be valid beyond today.'
    : null;

  const submit = async () => {
    if (problem || busy || !hasClearance) return;
    setBusy(true);
    setError(null);
    try {
      // end of that day in Manila, so the clearance counts as valid through it
      await onSubmit(certificateNumber.trim(), new Date(`${validUntil}T23:59:00+08:00`).toISOString(), remarks.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The accreditation could not be saved.');
      setBusy(false);
    }
  };

  return (
    <MacCenterModal
      open={open}
      onClose={onClose}
      title={mode === 'approve' ? 'Approve TODA Accreditation' : 'Record Accreditation Renewal'}
      subtitle={todaName}
      maxWidth={560}
      primaryActionLabel={busy ? 'Saving...' : mode === 'approve' ? 'Approve & Issue Accreditation' : 'Record Renewal'}
      onPrimaryAction={submit}
      primaryActionDisabled={Boolean(problem) || busy || !hasClearance}
      secondaryActionLabel="Cancel"
      onSecondaryAction={onClose}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography sx={{ fontSize: '12.5px', color: 'var(--mac-text-secondary)', lineHeight: 1.6 }}>
          Open the Barangay Clearance in the review window and copy its certificate number and the date it is valid until. They are saved with the accreditation:
          the TODA and its drivers are reminded before that date, and the drivers cannot go Online after it.
        </Typography>

        {!hasClearance && (
          <Alert severity="error" sx={{ borderRadius: '10px' }}>
            This TODA has uploaded no Barangay Clearance, so it cannot be approved. Return the application for correction so the TODA uploads one.
          </Alert>
        )}

        <TextField
          fullWidth
          label="Certificate number (from the Barangay Clearance)"
          value={certificateNumber}
          onChange={(e) => setCertificateNumber(e.target.value)}
          disabled={!hasClearance}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
        />
        <TextField
          fullWidth
          type="date"
          label="Barangay Clearance valid until"
          value={validUntil}
          onChange={(e) => setValidUntil(e.target.value)}
          disabled={!hasClearance}
          helperText={declaredValidUntil ? `The TODA states: ${declaredValidUntil}. Check it against the clearance and correct it if it differs.` : 'The TODA stated no date: read it from the clearance.'}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: tomorrow } }}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
        />
        <TextField
          fullWidth
          multiline
          rows={2}
          label="Remarks (optional)"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          disabled={!hasClearance}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
        />

        {error && <Alert severity="error" sx={{ borderRadius: '10px' }}>{error}</Alert>}
      </Box>
    </MacCenterModal>
  );
};
