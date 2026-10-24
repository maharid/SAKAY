import React, { useEffect, useId, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { useInFlight } from '../hooks/useInFlight';
import { AVAILABILITY_KINDS, reportProblem } from '../utils/availabilityReports';
import type { AvailabilityKind } from '../utils/availabilityReports';
import { DIALOG_ACTIONS_SX, DIALOG_CONTENT_SX, DIALOG_INTRO_SX, DIALOG_PAPER_SX, DIALOG_TITLE_SX, EMPTY_OPTION_SX, WRAPPING_SELECT_SLOTS } from './dialogStyles';

export interface ReportDriverAvailabilityDialogProps {
  open: boolean;
  onClose: () => void;
  /** the drivers that can be chosen (an administrator's own drivers) */
  drivers: Array<{ id: string; name: string }>;
  /** Files the report. Resolves to null when the database accepted it, else to what the database said (shown as it is). */
  onSubmit: (driverId: string, kind: AvailabilityKind, description: string) => Promise<string | null>;
  /** the report was filed */
  onFiled?: () => void;
}

/**
 * Rules 5.3 / 5.7 (administrators): reports a driver seen in the terminal queue while Available in the app, or one who accepted a booking while already carrying
 * other passengers. It is a report only: a strike follows only when an administrator confirms the instance (Review flags).
 */
export const ReportDriverAvailabilityDialog: React.FC<ReportDriverAvailabilityDialogProps> = ({ open, onClose, drivers, onSubmit, onFiled }) => {
  const flight = useInFlight();
  const titleId = useId();
  const [driverId, setDriverId] = useState('');
  const [kind, setKind] = useState<AvailabilityKind>('QUEUE_CONFLICT');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDriverId('');
      setKind('QUEUE_CONFLICT');
      setDescription('');
      setError(null);
    }
  }, [open]);

  const problem = reportProblem(driverId || null, description);

  const send = () =>
    flight.run(async () => {
      if (problem) return;
      const message = await onSubmit(driverId, kind, description);
      if (message) {
        setError(message);
        return;
      }
      onFiled?.();
      onClose();
    });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth aria-labelledby={titleId} slotProps={{ paper: { sx: DIALOG_PAPER_SX } }}>
      <DialogTitle id={titleId} sx={DIALOG_TITLE_SX}>Report a driver</DialogTitle>
      <DialogContent sx={DIALOG_CONTENT_SX}>
        <Typography sx={DIALOG_INTRO_SX}>
          This files a report only. A strike is issued only when an administrator confirms it, after checking the terminal queue, the dispatch log or the passenger's account.
        </Typography>
        <TextField select size="small" label="Driver" value={driverId} onChange={(e) => setDriverId(e.target.value)} fullWidth>
          {drivers.length === 0 ? (
            // not a driver: it cannot be chosen, it only says why the list is empty
            <MenuItem disabled sx={EMPTY_OPTION_SX}>
              <Box component="span" sx={{ display: 'block', fontWeight: 600 }}>There are currently no drivers available.</Box>
            </MenuItem>
          ) : (
            drivers.map((d) => <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>)
          )}
        </TextField>
        {/* the chosen option is a full sentence: let it wrap inside the field on a narrow screen instead of being cut with "..." */}
        <TextField select size="small" label="What was seen" value={kind} onChange={(e) => setKind(e.target.value as AvailabilityKind)} fullWidth slotProps={WRAPPING_SELECT_SLOTS}>
          {AVAILABILITY_KINDS.map((k) => <MenuItem key={k.kind} value={k.kind}>{k.en}</MenuItem>)}
        </TextField>
        {/* a short label always fits the field; the hint that used to follow it in brackets is the helper line under the box */}
        <TextField multiline minRows={3} size="small" label="What you observed" helperText="Where, when, and what the driver did." value={description} onChange={(e) => setDescription(e.target.value)} fullWidth />
        {error && <Alert severity="error" sx={{ borderRadius: '10px' }}>{error}</Alert>}
      </DialogContent>
      <DialogActions sx={DIALOG_ACTIONS_SX}>
        <Button onClick={onClose} sx={{ textTransform: 'none', color: '#475569' }}>Cancel</Button>
        <Button variant="contained" disabled={Boolean(problem) || flight.busy} onClick={send} sx={{ textTransform: 'none', fontWeight: 700, boxShadow: 'none' }}>
          File the report
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ReportDriverAvailabilityDialog;
