import React, { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { useInFlight } from '../hooks/useInFlight';
import { INCIDENT_LOST_ITEM_UNCLAIMED_DAYS } from '../config/policyConfig';
import { incidentCategoryClass } from '../utils/incidentReports';
import {
  INCIDENT_OUTCOME_LABEL,
  fabricatedStrikeOption,
  incidentClocks,
  incidentOutcomesFor,
  incidentStrikeOptions,
  type IncidentActor,
  type IncidentDecision,
  type IncidentRecord,
  type IncidentStrikeOption,
  type LostItemStatus,
} from '../utils/incidentReview';

export interface IncidentReviewPanelProps {
  /** Which administrator is looking: the driver's TODA Administrator reviews first (Rule 19.3); the LGU Administrator decides the escalated and the serious ones */
  role: IncidentActor;
  incident: IncidentRecord;
  /** Every action resolves to null when the database accepted it, else to what the database said (shown as it is). The portal reloads its list after a null. */
  onStart: () => Promise<string | null>;
  onEscalate: (reason: string, serious: boolean) => Promise<string | null>;
  onDecide: (d: Omit<IncidentDecision, 'incidentId'>) => Promise<string | null>;
  onLostItem: (status: Exclude<LostItemStatus, 'Open'>, note: string) => Promise<string | null>;
  /** LGU only: hand a report that was escalated (not a serious one) back to the TODA Administrator of the driver's TODA, with the reason */
  onRefer?: (reason: string) => Promise<string | null>;
}

const manila = (iso: string | null): string => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-';
};

const PRIORITY_COLOR: Record<string, { bg: string; fg: string }> = {
  Serious: { bg: '#FEE2E2', fg: '#991B1B' },
  Emergency: { bg: '#FFEDD5', fg: '#9A3412' },
  Standard: { bg: '#F1F5F9', fg: '#475569' },
};

const LOST_ITEM_STEPS: Array<{ status: Exclude<LostItemStatus, 'Open'>; label: string }> = [
  { status: 'Contact Arranged', label: 'Contact arranged' },
  { status: 'Returned', label: 'Item returned' },
  { status: 'Not Found', label: 'Item not found' },
  { status: 'Unclaimed', label: 'Close as unclaimed' },
];

/**
 * Rules 19.3, 19.4, 19.5, 19.6, 19.8, 26.4: what an administrator does with one incident report. The database is the authority (who may act, what each outcome may carry, the strike, the audit entry,
 * the notices); this is only the form. Used by the TODA and the LGU portals. A report that is with the LGU Administrator is read only for the TODA Administrator (decision PI-11I).
 */
export const IncidentReviewPanel: React.FC<IncidentReviewPanelProps> = ({ role, incident, onStart, onEscalate, onDecide, onLostItem, onRefer }) => {
  const flight = useInFlight();
  const [mode, setMode] = useState<null | 'escalate' | 'decide' | 'lost' | 'refer'>(null);
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);
  const [reason, setReason] = useState('');
  const [serious, setSerious] = useState(false);
  const [outcome, setOutcome] = useState<IncidentDecision['outcome'] | ''>('');
  const [strike, setStrike] = useState('');
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');
  const [lostStatus, setLostStatus] = useState<Exclude<LostItemStatus, 'Open'>>('Contact Arranged');

  const klass = incidentCategoryClass(incident.category);
  const clocks = incidentClocks(incident);
  const decided = incident.outcome !== null;
  const withdrawn = incident.status === 'Cancelled';
  const readOnlyForToda = role === 'toda_admin' && (incident.routing === 'LGU' || incident.priority === 'Serious');
  const pending = incident.status === 'Pending' || incident.status === 'Pending Review';
  // Rule 19.8: assault, harassment, threats and crime stay with the LGU; anything else it took over can go back to the TODA (the database makes the same check)
  const canRefer = role === 'lgu_admin' && Boolean(onRefer) && incident.routing === 'LGU' && incident.priority !== 'Serious' && klass !== 'SERIOUS';
  const unclaimedFrom = Date.parse(incident.created_at) + INCIDENT_LOST_ITEM_UNCLAIMED_DAYS * 86_400_000;

  const outcomes = useMemo(() => incidentOutcomesFor(incident.category, incident.reported_by), [incident.category, incident.reported_by]);
  const options: IncidentStrikeOption[] = useMemo(() => {
    if (outcome === 'UPHELD') return incidentStrikeOptions(incident.category, incident.reported_by);
    if (outcome === 'FABRICATED') {
      const f = fabricatedStrikeOption(incident.reported_by);
      return f ? [f] : [];
    }
    return [];
  }, [outcome, incident.category, incident.reported_by]);
  const chosen = options.find((o) => o.code === strike) ?? null;

  const run = (task: () => Promise<string | null>, success: string, after?: () => void) =>
    flight.run(async () => {
      const problem = await task();
      if (problem) {
        setMessage({ severity: 'error', text: problem });
        return;
      }
      setMessage({ severity: 'success', text: success });
      setMode(null);
      setReason('');
      setNote('');
      setSerious(false);
      setOutcome('');
      setStrike('');
      setPoints('');
      after?.();
    });

  const submitDecision = () => {
    if (!outcome) return;
    const p = points.trim() === '' ? null : Number(points);
    void run(() => onDecide({ outcome, note: note.trim(), strikeCode: chosen ? chosen.code : null, points: chosen && !chosen.lguOnly ? p : null }), 'The decision was recorded.');
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip size="small" label={incident.priority} sx={{ fontWeight: 700, backgroundColor: (PRIORITY_COLOR[incident.priority] ?? PRIORITY_COLOR.Standard).bg, color: (PRIORITY_COLOR[incident.priority] ?? PRIORITY_COLOR.Standard).fg }} />
        <Chip size="small" variant="outlined" label={incident.routing === 'LGU' ? 'With the LGU Administrator' : 'With the TODA Administrator'} />
        {incident.filed_during_trip && <Chip size="small" variant="outlined" label="Filed during the trip" />}
        {incident.source === 'SYSTEM' && <Chip size="small" variant="outlined" label="Recorded by the system" />}
        {clocks.overdue && <Chip size="small" label={clocks.firstActionOverdue ? 'First action overdue' : 'Decision overdue'} sx={{ fontWeight: 700, backgroundColor: '#FEE2E2', color: '#991B1B' }} />}
      </Box>
      <Typography sx={{ fontSize: '12px', color: '#64748B', lineHeight: 1.5 }}>
        Filed {manila(incident.created_at)}
        {clocks.nextDue ? ` · ${incident.first_action_at === null ? 'first action due' : 'decision due'} ${manila(clocks.nextDue)}` : ''}
        {incident.escalated_at ? ` · escalated ${manila(incident.escalated_at)}` : ''}
      </Typography>
      {incident.escalation_reason && (
        <Typography sx={{ fontSize: '12.5px', color: '#334155', lineHeight: 1.5 }}>
          <b>Why it is with the LGU:</b> {incident.escalation_reason}
        </Typography>
      )}
      {incident.incident_latitude !== null && incident.incident_longitude !== null && (
        <Typography sx={{ fontSize: '12.5px', color: '#334155' }}>
          <b>Vehicle position when filed:</b>{' '}
          <a href={`https://www.openstreetmap.org/?mlat=${incident.incident_latitude}&mlon=${incident.incident_longitude}#map=17/${incident.incident_latitude}/${incident.incident_longitude}`} target="_blank" rel="noreferrer">
            {incident.incident_latitude.toFixed(5)}, {incident.incident_longitude.toFixed(5)}
          </a>
        </Typography>
      )}

      {withdrawn && <Alert severity="info">The reporter withdrew this report{incident.cancellation_reason ? `: ${incident.cancellation_reason}` : '.'}</Alert>}
      {decided && (
        <Alert severity={incident.outcome === 'NOT_UPHELD' ? 'info' : 'success'}>
          <b>{INCIDENT_OUTCOME_LABEL[incident.outcome as keyof typeof INCIDENT_OUTCOME_LABEL]}</b> by the {incident.decided_by_role === 'lgu_admin' ? 'LGU' : 'TODA'} Administrator on {manila(incident.resolved_at)}
          {incident.strike_code ? ` · strike ${incident.strike_code}` : ' · no strike'}
          {incident.resolution_notes ? <Box sx={{ mt: 0.5 }}>{incident.resolution_notes}</Box> : null}
        </Alert>
      )}
      {readOnlyForToda && !decided && !withdrawn && (
        <Alert severity="warning">
          This report is with the LGU Administrator ({incident.priority === 'Serious' ? 'Rule 19.8: assault, harassment, threats and crime go straight to the LGU' : 'escalated'}). You can read it; only the LGU decides it.
        </Alert>
      )}
      {message && <Alert severity={message.severity}>{message.text}</Alert>}

      {!decided && !withdrawn && !readOnlyForToda && (
        <>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {pending && (
              <Button size="small" variant="outlined" disabled={flight.busy} onClick={() => void run(onStart, 'The review was started.')} sx={{ textTransform: 'none', fontWeight: 600 }}>
                Start review
              </Button>
            )}
            {klass === 'LOST_ITEM' && (
              <Button size="small" variant={mode === 'lost' ? 'contained' : 'outlined'} disabled={flight.busy} onClick={() => setMode(mode === 'lost' ? null : 'lost')} sx={{ textTransform: 'none', fontWeight: 600 }}>
                Lost item contact
              </Button>
            )}
            {(role === 'toda_admin' ? incident.routing === 'TODA' : true) && (
              <Button size="small" variant={mode === 'escalate' ? 'contained' : 'outlined'} color="error" disabled={flight.busy || (role === 'lgu_admin' && incident.routing === 'LGU' && incident.priority === 'Serious')}
                onClick={() => setMode(mode === 'escalate' ? null : 'escalate')} sx={{ textTransform: 'none', fontWeight: 600 }}>
                {role === 'toda_admin' ? 'Escalate to the LGU' : incident.routing === 'LGU' ? 'Reclassify as serious' : 'Take over / mark serious'}
              </Button>
            )}
            {canRefer && (
              <Button size="small" variant={mode === 'refer' ? 'contained' : 'outlined'} disabled={flight.busy} onClick={() => setMode(mode === 'refer' ? null : 'refer')} sx={{ textTransform: 'none', fontWeight: 600 }}>
                Refer to the TODA
              </Button>
            )}
            <Button size="small" variant={mode === 'decide' ? 'contained' : 'outlined'} disabled={flight.busy} onClick={() => setMode(mode === 'decide' ? null : 'decide')} sx={{ textTransform: 'none', fontWeight: 600 }}>
              Record the decision
            </Button>
          </Box>

          {mode === 'escalate' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <TextField size="small" multiline rows={2} fullWidth label="Why (at least 10 characters)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <FormControlLabel control={<Checkbox size="small" checked={serious} onChange={(e) => setSerious(e.target.checked)} />}
                label={<Typography sx={{ fontSize: '13px' }}>This describes an assault, harassment, a threat or a crime (Rule 19.8): reclassify it as serious</Typography>} />
              <Button size="small" variant="contained" color="error" disabled={flight.busy || reason.trim().length < 10} onClick={() => void run(() => onEscalate(reason.trim(), serious), 'The report was sent to the LGU Administrator.')} sx={{ textTransform: 'none', fontWeight: 700, alignSelf: 'flex-start' }}>
                {flight.busy ? 'Sending...' : 'Send to the LGU Administrator'}
              </Button>
            </Box>
          )}

          {mode === 'refer' && onRefer && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography sx={{ fontSize: '12.5px', color: '#475569', lineHeight: 1.5 }}>
                The report goes back to the TODA Administrator of the driver's TODA, who is told and has a fresh time to act. It is recorded in the audit log under your name. A serious report (Rule 19.8) cannot be referred.
              </Typography>
              <TextField size="small" multiline rows={2} fullWidth label="Why it goes back to the TODA (at least 10 characters)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button size="small" variant="contained" disabled={flight.busy || reason.trim().length < 10} onClick={() => void run(() => onRefer(reason.trim()), 'The report was referred to the TODA Administrator.')} sx={{ textTransform: 'none', fontWeight: 700, alignSelf: 'flex-start' }}>
                {flight.busy ? 'Sending...' : 'Refer to the TODA Administrator'}
              </Button>
            </Box>
          )}

          {mode === 'lost' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography sx={{ fontSize: '12.5px', color: '#475569', lineHeight: 1.5 }}>
                Rule 29.19: connect the passenger and the driver by phone or SMS (their numbers are in the trip details), then record what came of it. No strike for either party (Rule 19.6).
              </Typography>
              <TextField select size="small" fullWidth label="Status" value={lostStatus} onChange={(e) => setLostStatus(e.target.value as Exclude<LostItemStatus, 'Open'>)}>
                {LOST_ITEM_STEPS.map((s) => (
                  <MenuItem key={s.status} value={s.status} disabled={s.status === 'Unclaimed' && Date.now() < unclaimedFrom}>
                    {s.label}{s.status === 'Unclaimed' && Date.now() < unclaimedFrom ? ` (after ${INCIDENT_LOST_ITEM_UNCLAIMED_DAYS} days)` : ''}
                  </MenuItem>
                ))}
              </TextField>
              <TextField size="small" multiline rows={2} fullWidth label="Who was contacted and what was agreed or found (at least 10 characters)" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button size="small" variant="contained" disabled={flight.busy || note.trim().length < 10} onClick={() => void run(() => onLostItem(lostStatus, note.trim()), 'The lost-item report was updated.')} sx={{ textTransform: 'none', fontWeight: 700, alignSelf: 'flex-start' }}>
                {flight.busy ? 'Saving...' : 'Save'}
              </Button>
            </Box>
          )}

          {mode === 'decide' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <TextField select size="small" fullWidth label="Outcome" value={outcome} onChange={(e) => { setOutcome(e.target.value as IncidentDecision['outcome']); setStrike(''); setPoints(''); }}>
                {outcomes.map((o) => (
                  <MenuItem key={o} value={o}>{INCIDENT_OUTCOME_LABEL[o]}</MenuItem>
                ))}
              </TextField>
              {(outcome === 'UPHELD' || outcome === 'FABRICATED') && (
                <>
                  <TextField select size="small" fullWidth label={outcome === 'FABRICATED' ? 'Strike on the REPORTER (Rule 19.5)' : 'Strike (Rule 19.4: only when you confirm it)'} value={strike} onChange={(e) => { setStrike(e.target.value); setPoints(''); }}>
                    <MenuItem value="">No strike: record the outcome only</MenuItem>
                    {options.map((o) => (
                      <MenuItem key={o.code} value={o.code} disabled={role === 'toda_admin' && o.lguOnly}>
                        {o.en}{role === 'toda_admin' && o.lguOnly ? ' - LGU only' : ''}
                      </MenuItem>
                    ))}
                  </TextField>
                  {chosen && !chosen.lguOnly && chosen.max > chosen.min && (
                    <TextField size="small" type="number" label={`Points (${chosen.min} - ${chosen.max}; default ${chosen.min})`} value={points} onChange={(e) => setPoints(e.target.value)} slotProps={{ htmlInput: { min: chosen.min, max: chosen.max } }} />
                  )}
                  {chosen && (
                    <Typography sx={{ fontSize: '12px', color: '#64748B', lineHeight: 1.5 }}>
                      The strike is recorded under your name through the strike engine, with this report and your findings. The person is told.
                    </Typography>
                  )}
                </>
              )}
              {outcome === 'UPHELD' && (klass === 'SERIOUS' || klass === 'EMERGENCY') && (
                <Typography sx={{ fontSize: '12px', color: '#64748B', lineHeight: 1.5 }}>
                  The reporter is the confirmed victim of a safety incident: any strike of theirs from the trip's own events (a no-show, a late cancellation) is removed (Rule 26.4).
                </Typography>
              )}
              <TextField size="small" multiline rows={3} fullWidth label="Findings and reason (at least 10 characters)" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button size="small" variant="contained" disabled={flight.busy || !outcome || note.trim().length < 10} onClick={submitDecision} sx={{ textTransform: 'none', fontWeight: 700, alignSelf: 'flex-start' }}>
                {flight.busy ? 'Saving...' : 'Record the decision'}
              </Button>
            </Box>
          )}
        </>
      )}
    </Box>
  );
};

export default IncidentReviewPanel;
