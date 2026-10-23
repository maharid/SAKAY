import React, { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { useInFlight } from '../hooks/useInFlight';
import { MIN_SUBSTITUTION_NOTE_LENGTH, substitutionDecisionProblem } from '../utils/vehicleSubstitution';
import type { VehicleSubstitution } from '../utils/vehicleSubstitution';

export interface VehicleSubstitutionsPanelProps {
  /** Which administrator is looking: the TODA Administrator decides first, the LGU Administrator last */
  role: 'toda_admin' | 'lgu_admin';
  requests: VehicleSubstitution[];
  /** Approve or deny. Resolves to null when the database accepted it, else to what the database said (shown as it is). */
  onDecide: (id: string, approve: boolean, note: string) => Promise<string | null>;
  /** End an active substitution early (the registered vehicle is put back). Same resolution. */
  onEnd: (id: string, reason: string) => Promise<string | null>;
  /** Shown when there is nothing to review */
  showWhenEmpty?: boolean;
}

const manila = (iso: string | null): string => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-';
};

/**
 * Rule 29.18: the requests of drivers to use another vehicle for 1 to 7 days. The TODA Administrator decides first (and sees only their own drivers'); the request then
 * goes to the LGU Administrator, whose approval puts the substitute in place until the days are over (the database puts the registered vehicle back by itself).
 * Either may end an active substitution early. The database decides who may do what, and tells the driver.
 */
export const VehicleSubstitutionsPanel: React.FC<VehicleSubstitutionsPanelProps> = ({ role, requests, onDecide, onEnd, showWhenEmpty = false }) => {
  const flight = useInFlight();
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);

  const mine = role === 'toda_admin' ? 'Pending TODA Approval' : 'Pending LGU Approval';
  const waiting = requests.filter((r) => r.status === mine);
  const other = requests.filter((r) => r.status === (role === 'toda_admin' ? 'Pending LGU Approval' : 'Pending TODA Approval'));
  const active = requests.filter((r) => r.status === 'Active');
  const closed = requests.filter((r) => r.status === 'Ended' || r.status === 'Denied' || r.status === 'Withdrawn').slice(0, 8);

  if (waiting.length + other.length + active.length + closed.length === 0 && !showWhenEmpty) return null;

  const run = (task: () => Promise<string | null>, ok: string) =>
    flight.run(async () => {
      const problem = await task();
      if (problem) {
        setMessage({ severity: 'error', text: problem });
        return;
      }
      setMessage({ severity: 'success', text: ok });
      setOpenId(null);
      setNote('');
    });

  const head = (r: VehicleSubstitution) => (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#0F172A' }}>{r.driverName}</Typography>
        <Chip size="small" label={r.status} sx={{ fontWeight: 700, fontSize: '10.5px' }} />
        <Typography sx={{ fontSize: '12px', color: '#64748B' }}>asked {manila(r.createdAt)}</Typography>
      </Box>
      <Typography sx={{ fontSize: '13px', color: '#334155', mt: 0.5 }}>
        Uses <b>{r.substitutePlate}</b> (franchise {r.substituteFranchise}) for {r.requestedDays} day{r.requestedDays === 1 ? '' : 's'}
        {r.originalPlate ? <> instead of {r.originalPlate}</> : null}.
      </Typography>
      <Typography sx={{ fontSize: '12.5px', color: '#475569', lineHeight: 1.5 }}>Reason: "{r.reason}"</Typography>
      {r.todaNote && <Typography sx={{ fontSize: '12.5px', color: '#475569' }}>TODA Administrator: {r.todaNote}</Typography>}
    </>
  );

  return (
    <Paper elevation={0} sx={{ p: 2.5, mb: 3, borderRadius: '16px', border: '1px solid #E2E8F0' }}>
      <Typography sx={{ fontWeight: 700, fontSize: '15px', color: '#0F172A', mb: 0.5 }}>Vehicle substitution requests</Typography>
      <Typography sx={{ fontSize: '12.5px', color: '#64748B', lineHeight: 1.5, mb: 1.5 }}>
        A driver may use another vehicle only after the TODA Administrator and then the LGU Administrator approve, for 1 to 7 days. Check the unit and its franchise before you approve:
        {role === 'lgu_admin' ? ' your approval puts the substitute in place until the days are over.' : ' your approval sends it to the LGU Administrator.'}
      </Typography>
      {message && <Alert severity={message.severity} sx={{ mb: 1.5 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        {waiting.map((r) => (
          <Box key={r.substitutionId} sx={{ p: 1.5, borderRadius: '12px', border: '1px solid #FDBA74', backgroundColor: '#FFF7ED' }}>
            {head(r)}
            <Button size="small" variant="outlined" onClick={() => { setOpenId(openId === r.substitutionId ? null : r.substitutionId); setNote(''); setMessage(null); }} sx={{ textTransform: 'none', fontWeight: 600, mt: 1 }}>
              {openId === r.substitutionId ? 'Close' : 'Decide'}
            </Button>
            {openId === r.substitutionId && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1.25 }}>
                <TextField size="small" multiline rows={2} fullWidth label={`Note (required to deny, at least ${MIN_SUBSTITUTION_NOTE_LENGTH} characters; the driver is told)`} value={note} onChange={(e) => setNote(e.target.value)} />
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Button size="small" variant="contained" color="success" disabled={flight.busy || substitutionDecisionProblem(true, note) !== null}
                    onClick={() => void run(() => onDecide(r.substitutionId, true, note), role === 'toda_admin' ? 'Approved: it now waits for the LGU Administrator.' : 'Approved: the substitute vehicle is in place.')}
                    sx={{ textTransform: 'none', fontWeight: 700, boxShadow: 'none' }}>
                    Approve
                  </Button>
                  <Button size="small" variant="outlined" color="error" disabled={flight.busy || substitutionDecisionProblem(false, note) !== null}
                    onClick={() => void run(() => onDecide(r.substitutionId, false, note), 'Denied: the driver was told.')} sx={{ textTransform: 'none', fontWeight: 700 }}>
                    Deny
                  </Button>
                </Box>
              </Box>
            )}
          </Box>
        ))}

        {active.map((r) => (
          <Box key={r.substitutionId} sx={{ p: 1.5, borderRadius: '12px', border: '1px solid #86EFAC', backgroundColor: '#F0FDF4' }}>
            {head(r)}
            <Typography sx={{ fontSize: '12.5px', color: '#166534', fontWeight: 600 }}>In use until {manila(r.endsAt)}; the registered vehicle comes back by itself.</Typography>
            <Button size="small" variant="outlined" color="error" onClick={() => { setOpenId(openId === r.substitutionId ? null : r.substitutionId); setNote(''); setMessage(null); }} sx={{ textTransform: 'none', fontWeight: 600, mt: 1 }}>
              {openId === r.substitutionId ? 'Close' : 'End early'}
            </Button>
            {openId === r.substitutionId && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1.25 }}>
                <TextField size="small" multiline rows={2} fullWidth label={`Why (at least ${MIN_SUBSTITUTION_NOTE_LENGTH} characters; the driver is told)`} value={note} onChange={(e) => setNote(e.target.value)} />
                <Box>
                  <Button size="small" variant="contained" color="error" disabled={flight.busy || note.trim().length < MIN_SUBSTITUTION_NOTE_LENGTH}
                    onClick={() => void run(() => onEnd(r.substitutionId, note), 'Ended: the registered vehicle is back.')} sx={{ textTransform: 'none', fontWeight: 700, boxShadow: 'none' }}>
                    End the substitution
                  </Button>
                </Box>
              </Box>
            )}
          </Box>
        ))}

        {other.map((r) => (
          <Box key={r.substitutionId} sx={{ p: 1.5, borderRadius: '12px', border: '1px solid #E2E8F0' }}>
            {head(r)}
            <Typography sx={{ fontSize: '12px', color: '#64748B' }}>{role === 'toda_admin' ? 'With the LGU Administrator now.' : 'Still with the TODA Administrator; it reaches you after their approval.'}</Typography>
          </Box>
        ))}

        {closed.map((r) => (
          <Box key={r.substitutionId} sx={{ p: 1.25, borderRadius: '12px', border: '1px solid #F1F5F9', backgroundColor: '#F8FAFC' }}>
            <Typography sx={{ fontSize: '12.5px', color: '#475569' }}>
              <b>{r.driverName}</b>: {r.substitutePlate} for {r.requestedDays} day{r.requestedDays === 1 ? '' : 's'}: {r.status}
              {r.status === 'Denied' && r.denialReason ? ` (${r.deniedByRole === 'lgu_admin' ? 'LGU' : 'TODA'}: ${r.denialReason})` : ''}
              {r.status === 'Ended' && r.endReason ? ` (${r.endReason})` : ''}
            </Typography>
          </Box>
        ))}
      </Box>
    </Paper>
  );
};

export default VehicleSubstitutionsPanel;
