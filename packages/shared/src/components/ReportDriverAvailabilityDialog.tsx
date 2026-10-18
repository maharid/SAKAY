import React, { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
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
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, fontSize: '16px' }}>Report a driver (Rules 5.3 / 5.7)</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        <Typography sx={{ fontSize: '13px', color: '#64748B', lineHeight: 1.5 }}>
          This files a report only. A strike is issued only when an administrator confirms it, after checking the terminal queue, the dispatch log or the passenger's account.
        </Typography>
        <TextField select size="small" label="Driver" value={driverId} onChange={(e) => setDriverId(e.target.value)} fullWidth>
          {drivers.map((d) => <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="What was seen" value={kind} onChange={(e) => setKind(e.target.value as AvailabilityKind)} fullWidth>
          {AVAILABILITY_KINDS.map((k) => <MenuItem key={k.kind} value={k.kind}>{k.en} ({k.rule})</MenuItem>)}
        </TextField>
        <TextField multiline minRows={3} size="small" label="What you observed (where, when, what the driver did)" value={description} onChange={(e) => setDescription(e.target.value)} fullWidth />
        {error && <Alert severity="error" sx={{ borderRadius: '10px' }}>{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none', color: '#64748B' }}>Cancel</Button>
        <Button variant="contained" disabled={Boolean(problem) || flight.busy} onClick={send} sx={{ textTransform: 'none', fontWeight: 700, boxShadow: 'none' }}>
          File the report
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ReportDriverAvailabilityDialog;
