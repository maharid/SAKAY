import React, { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { useInFlight } from '../hooks/useInFlight';
import { FARE_DISPUTE_OUTCOMES, FARE_DISPUTE_STRIKES, earlyEndReasonLabel, type FareDisputeDecision, type FareDisputeRow } from '../utils/tripEnd';

export interface FareDisputesPanelProps {
  /** Which administrator is looking: the TODA Administrator decides an Open dispute or escalates it; the LGU Administrator decides anything not yet resolved */
  role: 'toda_admin' | 'lgu_admin';
  disputes: FareDisputeRow[];
  /** Passes the dispute to the LGU Administrator. Resolves to null when the database accepted it, else to what the database said. */
  onEscalate: (disputeId: string, reason: string) => Promise<string | null>;
  /** The decision. Resolves to null when the database accepted it, else to what the database said. */
  onResolve: (decision: FareDisputeDecision) => Promise<string | null>;
  /** Shown when there is nothing to review (the LGU page hides the panel instead: pass false) */
  showWhenEmpty?: boolean;
}

const KIND_LABELS: Record<FareDisputeRow['kind'], string> = {
  FARE_DISCREPANCY: 'Fare discrepancy reported by the passenger (Rule 18.4)',
  SAFETY_REVIEW: 'Review of a Safety Concern early end - provisional fare (Rule 13.5)',
  NON_PAYMENT: 'The driver reports the confirmed fare was not paid (Rule 18.6)',
};
const OUTCOME_LABELS: Record<string, string> = {
  FARE_CONFIRMED: 'Confirm the fare (it stands)',
  FARE_REDUCED: 'Reduce the fare',
  FARE_WAIVED: 'Waive the fare (no fare)',
  FARE_ADJUSTED: 'Adjust the fare',
  NON_PAYMENT_UPHELD: 'Upheld: the passenger did not pay',
  NON_PAYMENT_REJECTED: 'Rejected: the fare was paid',
};

const manila = (iso: string | null): string => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-';
};
const peso = (v: number | null | undefined): string => (v === null || v === undefined ? '-' : `₱${Number(v).toFixed(2)}`);

const Party: React.FC<{ label: string; name: string | null; phone: string | null }> = ({ label, name, phone }) => (
  <Box sx={{ minWidth: 160 }}>
    <Typography sx={{ fontSize: '11px', color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>{label}</Typography>
    <Typography sx={{ fontSize: '14px', fontWeight: 600, color: '#0F172A' }}>{name || '-'}</Typography>
    {phone ? (
      <Typography sx={{ fontSize: '13px' }}>
        <a href={`tel:${phone}`} style={{ color: '#2563EB', fontWeight: 600 }}>{phone}</a>
        {' · '}
        <a href={`sms:${phone}`} style={{ color: '#2563EB' }}>SMS</a>
      </Typography>
    ) : (
      <Typography sx={{ fontSize: '13px', color: '#94A3B8' }}>no number on record</Typography>
    )}
  </Box>
);

/**
 * Rules 13.5 / 18.4 / 18.6: the fare disputes waiting for an administrator. The TODA Administrator of the driver reviews first (target: 2 business days) and may
 * escalate to the LGU Administrator (3 business days after that); an overdue dispute is shown as overdue and is never resolved by the system. The decision
 * confirms, reduces, waives or adjusts the fare (never above the system's fare, Rule 18.1), and may carry the strike the facts call for; every decision is
 * written to the fare ledger and the audit log by the database, and both parties are told.
 * Used by the TODA and LGU portals (the data and the actions are theirs; this is only the screen).
 */
export const FareDisputesPanel: React.FC<FareDisputesPanelProps> = ({ role, disputes, onEscalate, onResolve, showWhenEmpty = true }) => {
  const flight = useInFlight();
  const [deciding, setDeciding] = useState<FareDisputeRow | null>(null);
  const [escalating, setEscalating] = useState<FareDisputeRow | null>(null);
  const [outcome, setOutcome] = useState('');
  const [finalFare, setFinalFare] = useState('');
  const [strike, setStrike] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const open = disputes.filter((d) => d.status !== 'Resolved');
  const resolved = disputes.filter((d) => d.status === 'Resolved').slice(0, 10);
  if (disputes.length === 0 && !showWhenEmpty) return null;

  const canDecide = (d: FareDisputeRow) => d.status !== 'Resolved' && (role === 'lgu_admin' || (d.status === 'Open' && d.assigned_role === 'toda_admin'));

  const openDecide = (d: FareDisputeRow) => {
    setDeciding(d);
    setOutcome(FARE_DISPUTE_OUTCOMES[d.kind][0]);
    setFinalFare('');
    setStrike('');
    setReason('');
    setError(null);
  };
  const openEscalate = (d: FareDisputeRow) => {
    setEscalating(d);
    setReason('');
    setError(null);
  };

  const needsFare = outcome === 'FARE_REDUCED' || outcome === 'FARE_ADJUSTED';
  const strikes = deciding ? FARE_DISPUTE_STRIKES[deciding.kind] : [];

  const submitDecision = () =>
    flight.run(async () => {
      if (!deciding) return;
      const fare = needsFare ? Number(finalFare) : null;
      if (needsFare && (finalFare.trim() === '' || !Number.isFinite(fare) || (fare as number) < 0)) {
        setError('Give the final fare (a number, never above the system fare).');
        return;
      }
      const message = await onResolve({ disputeId: deciding.dispute_id, outcome, finalFare: fare, reason: reason.trim(), strikeCode: strike || null });
      if (message) {
        setError(message);
        return;
      }
      setDone('The decision was recorded: the fare ledger and the audit log have it, and both parties were told.');
      setDeciding(null);
    });

  const submitEscalation = () =>
    flight.run(async () => {
      if (!escalating) return;
      const message = await onEscalate(escalating.dispute_id, reason.trim());
      if (message) {
        setError(message);
        return;
      }
      setDone('The dispute was passed to the LGU Administrator.');
      setEscalating(null);
    });

  return (
    <Paper elevation={0} sx={{ mb: 3, borderRadius: '16px', border: '1px solid #FDBA74', backgroundColor: '#FFF7ED', overflow: 'hidden' }}>
      <Box sx={{ p: '16px 20px', borderBottom: '1px solid #FED7AA' }}>
        <Typography sx={{ fontSize: '15px', fontWeight: 700, color: '#9A3412' }}>Fare disputes ({open.length} waiting) - Rules 13.5, 18.4, 18.6</Typography>
        <Typography sx={{ fontSize: '12.5px', color: '#7C2D12', mt: 0.5, lineHeight: 1.45 }}>
          {role === 'toda_admin'
            ? 'Read both statements, contact the parties if you need to, then decide within 2 business days, or escalate to the LGU Administrator. The payment stays disputed until you decide.'
            : 'Disputes escalated by a TODA Administrator, and those with no TODA, wait here for your decision within 3 business days. The payment stays disputed until you decide.'}
        </Typography>
      </Box>

      {done && (
        <Alert severity="success" onClose={() => setDone(null)} sx={{ m: 2, borderRadius: '10px' }}>
          {done}
        </Alert>
      )}

      {open.length === 0 ? (
        <Typography sx={{ p: 3, fontSize: '13px', color: '#7C2D12' }}>No fare dispute is waiting.</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          {open.map((d) => (
            <Box key={d.dispute_id} sx={{ p: '16px 20px', borderTop: '1px solid #FFEDD5', backgroundColor: '#FFFFFF', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#0F172A' }}>{KIND_LABELS[d.kind]}</Typography>
                <Chip size="small" label={d.status === 'Escalated' ? 'With the LGU Administrator' : 'With the TODA Administrator'} sx={{ fontWeight: 600 }} />
                {d.overdue && <Chip size="small" color="error" label={`Overdue (was due ${manila(d.due_at)})`} sx={{ fontWeight: 700 }} />}
                {!d.overdue && <Chip size="small" variant="outlined" label={`Due ${manila(d.due_at)}`} />}
                {d.late && <Chip size="small" variant="outlined" label="Reported after the confirmation time" />}
              </Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.5, alignItems: 'flex-start' }}>
                <Party label="Passenger" name={d.passenger_name} phone={d.passenger_phone} />
                <Party label="Driver" name={d.driver_name} phone={d.driver_phone} />
                <Box sx={{ flex: 1, minWidth: 220 }}>
                  <Typography sx={{ fontSize: '11px', color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Trip and fare</Typography>
                  <Typography sx={{ fontSize: '13px', color: '#0F172A' }}>{d.pickup_address || 'Pickup'} {'→'} {d.dropoff_address || 'Destination'}</Typography>
                  <Typography sx={{ fontSize: '12.5px', color: '#475569' }}>
                    System fare {peso(d.actual_fare)} (estimate {peso(d.estimated_fare)}) {'·'} payment: {d.payment_status}
                    {d.fare_unconfirmed ? ' (the passenger did not confirm)' : ''}
                    {d.claimed_amount !== null ? ` · amount the driver asked for: ${peso(d.claimed_amount)}` : ''}
                  </Typography>
                  {d.early_end_kind && (
                    <Typography sx={{ fontSize: '12.5px', color: '#B45309', fontWeight: 600 }}>
                      Ended early ({d.early_end_kind === 'SAFETY' ? 'Safety Concern, provisional fare' : d.early_end_kind === 'DRIVER' ? 'by the driver' : 'personal'}): {earlyEndReasonLabel(d.early_end_reason, 'en')}
                    </Typography>
                  )}
                </Box>
              </Box>
              {d.notes.length > 0 && (
                <Box sx={{ p: '10px 12px', borderRadius: '10px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  {d.notes.map((n, i) => (
                    <Typography key={i} sx={{ fontSize: '12.5px', color: '#334155', lineHeight: 1.45 }}>
                      <strong style={{ textTransform: 'capitalize' }}>{n.party.replace('_', ' ')}</strong> ({manila(n.created_at)}): {n.note}
                    </Typography>
                  ))}
                </Box>
              )}
              {d.escalation_reason && <Typography sx={{ fontSize: '12.5px', color: '#7C2D12' }}>Escalated {manila(d.escalated_at)}: {d.escalation_reason}</Typography>}
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {canDecide(d) ? (
                  <Button variant="contained" onClick={() => openDecide(d)} sx={{ textTransform: 'none', fontWeight: 700, backgroundColor: '#C2410C', '&:hover': { backgroundColor: '#9A3412' } }}>
                    Decide
                  </Button>
                ) : (
                  <Typography sx={{ fontSize: '12.5px', color: '#64748B', alignSelf: 'center' }}>Waiting for the LGU Administrator.</Typography>
                )}
                {role === 'toda_admin' && d.status === 'Open' && d.assigned_role === 'toda_admin' && (
                  <Button variant="outlined" onClick={() => openEscalate(d)} sx={{ textTransform: 'none', fontWeight: 600 }}>
                    Escalate to the LGU
                  </Button>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {resolved.length > 0 && (
        <Box sx={{ p: '12px 20px', borderTop: '1px solid #FED7AA', backgroundColor: '#FFFFFF' }}>
          <Typography sx={{ fontSize: '12px', color: '#64748B', fontWeight: 700, textTransform: 'uppercase', mb: 0.5 }}>Recently resolved</Typography>
          {resolved.map((d) => (
            <Typography key={d.dispute_id} sx={{ fontSize: '12.5px', color: '#475569', lineHeight: 1.6 }}>
              {manila(d.resolved_at)} {'·'} {d.passenger_name || 'Passenger'} / {d.driver_name || 'Driver'} {'·'} {OUTCOME_LABELS[d.outcome ?? ''] ?? d.outcome}
              {d.resolved_fare !== null ? ` (${peso(d.resolved_fare)})` : ''}
            </Typography>
          ))}
        </Box>
      )}

      <Dialog open={deciding !== null} onClose={() => setDeciding(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, fontSize: '16px' }}>Decide the dispute</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <TextField select size="small" label="Decision" value={outcome} onChange={(e) => setOutcome(e.target.value)} fullWidth>
            {(deciding ? FARE_DISPUTE_OUTCOMES[deciding.kind] : []).map((o) => (
              <MenuItem key={o} value={o}>{OUTCOME_LABELS[o]}</MenuItem>
            ))}
          </TextField>
          {needsFare && (
            <TextField
              size="small"
              type="number"
              label="Final fare"
              value={finalFare}
              onChange={(e) => setFinalFare(e.target.value)}
              helperText={`The system fare is ${peso(deciding?.actual_fare)}: the final fare can be lower, never higher.`}
              fullWidth
            />
          )}
          {strikes.length > 0 && (
            <TextField select size="small" label="Strike to confirm (optional)" value={strike} onChange={(e) => setStrike(e.target.value)} fullWidth>
              <MenuItem value="">No strike</MenuItem>
              {strikes.map((s) => (
                <MenuItem key={s.code} value={s.code} disabled={s.lguOnly && role !== 'lgu_admin'}>
                  {s.en}
                  {s.lguOnly && role !== 'lgu_admin' ? ' - escalate to the LGU to confirm it' : ''}
                </MenuItem>
              ))}
            </TextField>
          )}
          <TextField multiline minRows={3} size="small" label="Reason for the decision" placeholder="What you checked, who you spoke to, and why." value={reason} onChange={(e) => setReason(e.target.value)} fullWidth />
          {error && <Alert severity="warning" sx={{ borderRadius: '10px' }}>{error}</Alert>}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setDeciding(null)} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" disabled={flight.busy || reason.trim().length < 10} onClick={submitDecision} sx={{ textTransform: 'none', fontWeight: 700, backgroundColor: '#C2410C', '&:hover': { backgroundColor: '#9A3412' } }}>
            Record the decision
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={escalating !== null} onClose={() => setEscalating(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, fontSize: '16px' }}>Escalate to the LGU Administrator</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <Typography sx={{ fontSize: '13px', color: '#475569', lineHeight: 1.45 }}>
            Say why this dispute needs the LGU Administrator (for example a passenger strike, or a conflict of interest). You will no longer be able to decide it.
          </Typography>
          <TextField multiline minRows={3} size="small" label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} fullWidth />
          {error && <Alert severity="warning" sx={{ borderRadius: '10px' }}>{error}</Alert>}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setEscalating(null)} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" disabled={flight.busy || reason.trim().length < 10} onClick={submitEscalation} sx={{ textTransform: 'none', fontWeight: 700 }}>
            Escalate
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default FareDisputesPanel;
