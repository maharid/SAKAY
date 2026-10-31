import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Checkbox, Chip, FormControlLabel, MenuItem, Step, StepButton, StepLabel, Stepper, TextField, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import {
  INCIDENT_CONTACT_OPTIONS,
  INCIDENT_NOTE_MIN,
  INCIDENT_OUTCOME_LABEL,
  NO_STRIKE,
  STRIKE_UNSET,
  fabricatedStrikeOption,
  incidentCategoryClass,
  incidentOutcomesFor,
  incidentStrikeOptions,
  investigationSaved,
  pointsProblem,
  stepComplete,
  stepRequirements,
  firstOpenStep,
  useInFlight,
  type IncidentDecision,
  type IncidentFollowupRow,
  type IncidentRecord,
  type LostItemStatus,
  type SavedInvestigation,
  type StepValues,
} from '@sakay/shared';

import { IncidentReportRecord } from '../../mockData/adminData';
import { MacConfirmDialog } from './MacConfirmDialog';
import { FONT } from '../../styles/density';
import { PAGE_BORDER, PAGE_TEXT, dangerOutlineButtonSx, pageCardSx, primaryButtonSx, secondaryButtonSx } from '../../styles/pageTheme';

interface IncidentResolutionStepperProps {
  incident: IncidentReportRecord;
  record: IncidentRecord;
  followups: IncidentFollowupRow[];
  /** Every action answers null when the database accepted it, else its own sentence (shown as it is). The window reloads the report after a null. */
  onAccept: () => Promise<string | null>;
  onTake: () => Promise<string | null>;
  onRecordInvestigation: (notes: string, contacted: string[]) => Promise<string | null>;
  onDecide: (d: Omit<IncidentDecision, 'incidentId'>) => Promise<string | null>;
  onEscalate: (reason: string, serious: boolean) => Promise<string | null>;
  onRefer: (reason: string) => Promise<string | null>;
  onLostItem: (status: Exclude<LostItemStatus, 'Open'>, note: string) => Promise<string | null>;
  /** The report's facts and evidence (step 1) */
  renderFacts: () => React.ReactNode;
}

const STEPS = [
  { label: 'Review', title: 'Step 1 of 4 · Review the report', says: 'Read what was reported and look at the evidence. When you are ready to handle this report, take it: that records you as responsible.' },
  { label: 'Investigate', title: 'Step 2 of 4 · Investigate and document', says: 'Contact the people you need to, read what has happened so far, and write down your findings. The findings are saved on the report.' },
  { label: 'Decide', title: 'Step 3 of 4 · Assessment and decision', says: 'Choose the outcome. Only an upheld or fabricated report can carry a strike, and only if you choose one. Your findings are required.' },
  { label: 'Finalize', title: 'Step 4 of 4 · Check and finalize', says: 'Check everything once more. Finalizing records the decision under your name, tells the people involved and cannot be undone.' },
] as const;

const manila = (iso?: string | null): string => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-';
};

const LOST_STEPS: Array<{ status: Exclude<LostItemStatus, 'Open'>; label: string }> = [
  { status: 'Contact Arranged', label: 'Contact arranged' },
  { status: 'Returned', label: 'Item returned' },
  { status: 'Not Found', label: 'Item not found' },
  { status: 'Unclaimed', label: 'Close as unclaimed' },
];

// ---- the draft kept on this computer until the decision is recorded (the findings themselves are saved on the report) ---------------------------------------------------------
interface Draft {
  notes?: string;
  contacted?: string[];
  outcome?: string;
  strike?: string;
  points?: string;
  findings?: string;
  findingsTouched?: boolean;
  step?: number;
}
const readDraft = (key: string): Draft => {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Draft) : {};
  } catch {
    return {};
  }
};

/**
 * The LGU Administrator's resolution of one incident report, in four steps with the current step and the remaining ones always visible. The database is the authority (who may act, the
 * strike, the audit entry, the notices); this guides the person through it and asks before anything final is done:
 *  - a step is complete only when what it needs is done (not because it was opened), and the Next button, the stepper and the final button all use the same check;
 *  - going back is always possible and keeps everything typed; going forward past an incomplete step is refused with a list of what is missing;
 *  - the findings of step 2 are saved on the report (so they survive closing the window and are seen from any computer); the decision being prepared is kept as a draft here until it is recorded.
 */
export const IncidentResolutionStepper: React.FC<IncidentResolutionStepperProps> = ({ incident, record, followups, onAccept, onTake, onRecordInvestigation, onDecide, onEscalate, onRefer, onLostItem, renderFacts }) => {
  const flight = useInFlight();
  const decided = record.outcome !== null;
  const withdrawn = record.status === 'Cancelled';
  const closed = decided || withdrawn;
  const pending = record.status === 'Pending' || record.status === 'Pending Review';
  const taken = Boolean(record.reviewed_by_lgu) || (!pending && record.routing !== 'LGU') || decided;
  const klass = incidentCategoryClass(record.category);

  const draftKey = `sakay_lgu_incident_draft_${record.incident_id}`;
  const initial = useMemo(() => readDraft(draftKey), [draftKey]);
  const [saved, setSaved] = useState<SavedInvestigation>({ notes: record.investigation_notes ?? '', contacted: record.investigation_contacted ?? [] });
  const [notes, setNotes] = useState<string>(initial.notes ?? record.investigation_notes ?? '');
  const [contacted, setContacted] = useState<string[]>(Array.isArray(initial.contacted) ? initial.contacted : record.investigation_contacted ?? []);
  const [outcome, setOutcome] = useState<IncidentDecision['outcome'] | ''>((initial.outcome as IncidentDecision['outcome'] | undefined) ?? '');
  const [strike, setStrike] = useState<string>(initial.strike ?? STRIKE_UNSET);
  const [points, setPoints] = useState<string>(initial.points ?? '');
  const [findings, setFindings] = useState<string>(initial.findings ?? '');
  const [findingsTouched, setFindingsTouched] = useState<boolean>(initial.findingsTouched ?? false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);
  /** The step that was refused, and what it still needs (shown until the person fixes it or moves back) */
  const [blocked, setBlocked] = useState<{ step: number; missing: string[] } | null>(null);
  const [other, setOther] = useState<null | 'refer' | 'serious' | 'lost'>(null);
  const [otherReason, setOtherReason] = useState('');
  const [otherConfirm, setOtherConfirm] = useState(false);
  const [lostStatus, setLostStatus] = useState<Exclude<LostItemStatus, 'Open'>>('Contact Arranged');

  const outcomes = useMemo(() => incidentOutcomesFor(record.category, record.reported_by), [record.category, record.reported_by]);
  const options = useMemo(() => {
    if (outcome === 'UPHELD') return incidentStrikeOptions(record.category, record.reported_by);
    if (outcome === 'FABRICATED') {
      const f = fabricatedStrikeOption(record.reported_by);
      return f ? [f] : [];
    }
    return [];
  }, [outcome, record.category, record.reported_by]);
  const chosen = options.find((o) => o.code === strike) ?? null;
  // the decision's findings: what the person wrote for the decision, or (until they change it) the investigation findings
  const decisionNote = findingsTouched ? findings.trim() : (findings.trim() || saved.notes.trim());

  const values: StepValues = { closed, taken, pending, notes, contacted, saved, outcome, strike, points, decisionNote, strikeOptions: options, confirmed };
  const complete = (step: number, v: StepValues = values) => stepComplete(step, v);

  const [active, setActive] = useState<number>(() => {
    if (closed) return 3;
    const start = typeof initial.step === 'number' && initial.step >= 0 && initial.step <= 3 ? initial.step : taken ? 1 : 0;
    return Math.min(start, firstOpenStep(values));
  });

  // the draft is kept while the decision is being prepared, and dropped once it is recorded (or the report is closed)
  useEffect(() => {
    try {
      if (closed) {
        localStorage.removeItem(draftKey);
        return;
      }
      const draft: Draft = { notes, contacted, outcome, strike, points, findings, findingsTouched, step: active };
      localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      // the draft is just not kept
    }
  }, [closed, draftKey, notes, contacted, outcome, strike, points, findings, findingsTouched, active]);

  // a refusal is shown only while it is still true
  useEffect(() => {
    if (blocked && complete(blocked.step)) setBlocked(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, contacted, saved, outcome, strike, points, findings, findingsTouched, taken]);

  const canRefer = record.routing === 'LGU' && record.priority !== 'Serious' && klass !== 'SERIOUS';
  const canMarkSerious = record.priority !== 'Serious';
  const unclaimedFrom = Date.parse(record.created_at) + 14 * 86_400_000;

  const run = async (task: () => Promise<string | null>, success: string, after?: () => void): Promise<boolean> => {
    let ok = false;
    await flight.run(async () => {
      const problem = await task();
      if (problem) {
        setMessage({ severity: 'error', text: problem });
        return;
      }
      setMessage({ severity: 'success', text: success });
      ok = true;
      after?.();
    });
    return ok;
  };

  /** Saves the findings on the report. Returns what is now saved, or null when it was not saved (the person is told why). */
  const saveInvestigation = async (): Promise<SavedInvestigation | null> => {
    const next = { notes: notes.trim(), contacted: [...contacted] };
    if (next.notes.length < INCIDENT_NOTE_MIN) return null;
    const ok = await run(() => onRecordInvestigation(next.notes, next.contacted), 'The findings were saved on the report.', () => setSaved(next));
    return ok ? next : null;
  };

  /**
   * Moves to a step. Back is always allowed. Forward: the findings of step 2 are saved first, then every step before the target must be complete; if one is not, the person is taken to the
   * first unfinished step and told what it needs. The Next button and a click on the stepper both come here, so they cannot disagree.
   */
  const goTo = async (target: number) => {
    setMessage(null);
    if (target <= active) {
      setActive(target);
      setBlocked(null);
      return;
    }
    let current = values;
    if (active === 1 && !closed && notes.trim().length >= INCIDENT_NOTE_MIN && !investigationSaved(values)) {
      const next = await saveInvestigation();
      if (!next) return;
      current = { ...values, saved: next };
    }
    for (let s = 0; s < target && s < 3; s += 1) {
      if (!stepComplete(s, current)) {
        setBlocked({ step: s, missing: stepRequirements(s, current).filter((r) => !r.done).map((r) => r.label) });
        setActive(s);
        return;
      }
    }
    setBlocked(null);
    setActive(target);
  };

  const finalize = async () => {
    // the last check, whatever the buttons showed: every step before this one is complete and the person has confirmed
    const withConfirm = { ...values, confirmed: true };
    for (let s = 0; s < 3; s += 1) {
      if (!stepComplete(s, withConfirm)) {
        setConfirmOpen(false);
        setBlocked({ step: s, missing: stepRequirements(s, withConfirm).filter((r) => !r.done).map((r) => r.label) });
        setActive(s);
        return;
      }
    }
    if (!confirmed || !outcome) return;
    await run(
      () => onDecide({ outcome: outcome as IncidentDecision['outcome'], note: decisionNote, strikeCode: chosen ? chosen.code : null, points: chosen && !chosen.lguOnly && points.trim() !== '' ? Number(points) : null }),
      'The resolution was recorded and the people involved were told.',
      () => {
        setConfirmOpen(false);
        try {
          localStorage.removeItem(draftKey);
        } catch {
          // nothing to remove
        }
      },
    );
    setConfirmOpen(false);
  };

  const step = STEPS[Math.min(active, 3)];
  const history = incident.statusHistory ?? [];
  const section = { ...pageCardSx, p: '14px 16px' } as const;
  const reqs = stepRequirements(active, values);
  const stepDone = complete(active);
  // the Next button is open when the step's own inputs are in place; for step 2 that is the findings text, because Next saves them
  const canAdvance = closed ? true : active === 1 ? notes.trim().length >= INCIDENT_NOTE_MIN || investigationSaved(values) : stepDone;

  // ---- the other ways to handle the report (only those this report allows) ----
  const alternatives = [
    canRefer && { key: 'refer' as const, title: 'Hand the report back to the TODA', says: "The report goes back to the TODA Administrator of the driver's TODA, who is told and has a fresh time to act. It is recorded under your name." },
    canMarkSerious && { key: 'serious' as const, title: 'Mark the report as serious', says: 'An assault, harassment, a threat or a crime stays with the LGU alone. The TODA keeps read-only sight of the report.' },
    klass === 'LOST_ITEM' && { key: 'lost' as const, title: 'Record a lost-item contact', says: 'Connect the passenger and the driver by phone or SMS, then record what came of it. No strike for either party.' },
  ].filter(Boolean) as Array<{ key: 'refer' | 'serious' | 'lost'; title: string; says: string }>;

  const reasonOk = otherReason.trim().length >= INCIDENT_NOTE_MIN;
  const runOther = () => {
    const done = () => {
      setOther(null);
      setOtherReason('');
    };
    if (other === 'refer') return run(() => onRefer(otherReason.trim()), 'The report was handed back to the TODA Administrator.', done);
    if (other === 'serious') return run(() => onEscalate(otherReason.trim(), true), 'The report was marked as serious.', done);
    return run(() => onLostItem(lostStatus, otherReason.trim()), 'The lost-item report was updated.', done);
  };
  const otherConfirmWords = {
    refer: { title: 'Hand this report back to the TODA?', message: 'The TODA Administrator is told and has a fresh time to act. You will no longer be the one to decide it.', label: 'Hand back to the TODA' },
    serious: { title: 'Mark this report as serious?', message: 'It stays with the LGU alone and the TODA keeps read-only sight of it. This cannot be undone.', label: 'Mark as serious' },
    lost: { title: 'Save this lost-item update?', message: `The lost-item report is recorded as "${LOST_STEPS.find((x) => x.status === lostStatus)?.label ?? lostStatus}", under your name.`, label: 'Save the update' },
  } as const;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* where the person is, and what is left: done, current or still to do (a step is never "done" just because it was opened) */}
      <Stepper nonLinear activeStep={active} alternativeLabel aria-label="Resolution steps" sx={{ '& .MuiStepIcon-root.Mui-active, & .MuiStepIcon-root.Mui-completed': { color: '#C75000' }, '& .MuiStepIcon-root.Mui-error': { color: '#B91C1C' }, '& .MuiStepLabel-label': { fontSize: FONT.small, fontWeight: 600 } }}>
        {STEPS.map((s, i) => {
          const done = decided ? true : complete(i);
          const status = done ? 'Done' : i === active ? 'Current' : 'To do';
          return (
            <Step key={s.label} completed={done}>
              <StepButton
                onClick={() => void goTo(i)}
                optional={<Typography component="span" sx={{ fontSize: FONT.caption, color: blocked?.step === i ? PAGE_TEXT.danger : done ? PAGE_TEXT.success : PAGE_TEXT.secondary, fontWeight: 600 }}>{blocked?.step === i ? 'Incomplete' : status}</Typography>}
                sx={{ '&:focus-visible': { outline: '2px solid #C75000', outlineOffset: 2 } }}
                aria-label={`${s.label}: ${status}`}
              >
                <StepLabel error={blocked?.step === i}>{s.label}</StepLabel>
              </StepButton>
            </Step>
          );
        })}
      </Stepper>

      <Box sx={{ ...section, backgroundColor: '#FFFBF5', borderColor: 'var(--sakay-orange-border)' }}>
        <Typography component="h3" sx={{ fontSize: FONT.heading, fontWeight: 700, color: PAGE_TEXT.primary }}>{step.title}</Typography>
        <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, lineHeight: 1.55, mt: '2px' }}>{closed && active === 3 ? 'This report is closed. The record below cannot be changed.' : step.says}</Typography>
        {/* what this step needs, ticked as it is done */}
        {!closed && (
          <Box component="ul" aria-label="What this step needs" sx={{ listStyle: 'none', m: 0, mt: '8px', p: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {reqs.map((r) => (
              <Box component="li" key={r.label} sx={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: FONT.small, color: r.done ? PAGE_TEXT.success : PAGE_TEXT.secondary, fontWeight: r.done ? 600 : 500 }}>
                {r.done ? <CheckCircleIcon aria-hidden sx={{ fontSize: 15, mt: '1px' }} /> : <RadioButtonUncheckedIcon aria-hidden sx={{ fontSize: 15, mt: '1px' }} />}
                <span><Box component="span" sx={visuallyHidden}>{r.done ? 'Done: ' : 'To do: '}</Box>{r.label}</span>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {blocked && (
        <Alert severity="warning" role="alert" sx={{ borderRadius: '10px' }}>
          <b>{STEPS[blocked.step].label} is not complete yet.</b> Before you go on: {blocked.missing.join('; ')}.
        </Alert>
      )}
      {message && <Alert severity={message.severity} sx={{ borderRadius: '10px' }}>{message.text}</Alert>}
      {withdrawn && <Alert severity="info" sx={{ borderRadius: '10px' }}>The reporter withdrew this report{record.cancellation_reason ? `: ${record.cancellation_reason}` : '.'}</Alert>}

      {/* ---------------- 1. review ---------------- */}
      {active === 0 && (
        <>
          {renderFacts()}
          {!closed && (
            <Box sx={section}>
              {taken ? (
                <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.success, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <CheckCircleIcon aria-hidden sx={{ fontSize: 18 }} /> You are handling this report.
                </Typography>
              ) : pending ? (
                <>
                  <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, lineHeight: 1.55, mb: '10px' }}>
                    <b>Accept for review</b> moves this report from waiting to under review, stops its first-action clock and tells the person who filed it that you are looking at it. It decides nothing.
                  </Typography>
                  <Button variant="contained" disableElevation disabled={flight.busy} onClick={() => void run(onAccept, 'The report is accepted for review.', () => setActive(1))} sx={primaryButtonSx}>
                    {flight.busy ? 'Saving...' : 'Accept for review'}
                  </Button>
                </>
              ) : (
                <>
                  <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, lineHeight: 1.55, mb: '10px' }}>
                    <b>Take this report</b> records you as the Administrator responsible for it and tells the TODA that the LGU is reviewing it. It decides nothing.
                  </Typography>
                  <Button variant="contained" disableElevation disabled={flight.busy} onClick={() => void run(onTake, 'You are now responsible for this report.', () => setActive(1))} sx={primaryButtonSx}>
                    {flight.busy ? 'Saving...' : 'Take this report'}
                  </Button>
                </>
              )}
            </Box>
          )}
        </>
      )}

      {/* ---------------- 2. investigate ---------------- */}
      {active === 1 && (
        <>
          {record.escalation_reason && (
            <Box sx={section}>
              <Typography sx={{ fontSize: FONT.small, fontWeight: 700, color: PAGE_TEXT.secondary, mb: '4px' }}>WHY IT IS WITH THE LGU</Typography>
              <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.primary, lineHeight: 1.55 }}>{record.escalation_reason}</Typography>
            </Box>
          )}

          <Box sx={section}>
            <Typography sx={{ fontSize: FONT.small, fontWeight: 700, color: PAGE_TEXT.secondary, mb: '6px' }}>FOLLOW-UPS AND HISTORY</Typography>
            {followups.length === 0 && history.length === 0 ? (
              <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary }}>Nothing has been recorded on this report yet.</Typography>
            ) : (
              <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[
                  ...history.map((h) => ({ key: `h-${h.timestamp}-${h.step}`, title: h.step, meta: `${h.timestamp} · ${h.actor}` })),
                  ...[...followups].reverse().map((f) => ({ key: `f-${f.followup_id}`, title: `${f.kind === 'escalation' ? 'Escalation' : 'Follow-up'} no. ${f.sequence_no} from the TODA${f.message ? `: ${f.message}` : ''}`, meta: `${manila(f.sent_at)}${f.sent_by_name ? ` · ${f.sent_by_name}` : ''}` })),
                ].map((row) => (
                  <Box component="li" key={row.key} sx={{ display: 'flex', gap: '10px' }}>
                    <Box aria-hidden sx={{ width: 9, height: 9, borderRadius: '50%', mt: '6px', flexShrink: 0, backgroundColor: '#C75000' }} />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.primary, overflowWrap: 'anywhere' }}>{row.title}</Typography>
                      <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary }}>{row.meta}</Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </Box>

          {/* the investigation record: who was contacted, and the findings (saved on the report) */}
          <Box sx={{ ...section, display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <Box>
              <Typography sx={{ fontSize: FONT.small, fontWeight: 700, color: PAGE_TEXT.secondary, mb: '2px' }}>WHO YOU CONTACTED (OPTIONAL)</Typography>
              <Box role="group" aria-label="Who you contacted" sx={{ display: 'flex', flexWrap: 'wrap', gap: '2px 14px' }}>
                {INCIDENT_CONTACT_OPTIONS.map((who) => (
                  <FormControlLabel
                    key={who}
                    disabled={closed}
                    control={<Checkbox size="small" checked={contacted.includes(who)} onChange={(e) => setContacted((c) => (e.target.checked ? [...c, who] : c.filter((x) => x !== who)))} />}
                    label={<Typography sx={{ fontSize: FONT.body }}>{who}</Typography>}
                  />
                ))}
              </Box>
            </Box>
            <TextField
              fullWidth
              multiline
              minRows={5}
              required
              disabled={closed}
              label="Investigation findings: what you found"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              error={notes.length > 0 && notes.trim().length < INCIDENT_NOTE_MIN}
              helperText={
                notes.trim().length > 0 && notes.trim().length < INCIDENT_NOTE_MIN
                  ? `Write at least ${INCIDENT_NOTE_MIN} characters (${INCIDENT_NOTE_MIN - notes.trim().length} more).`
                  : investigationSaved(values)
                    ? `Saved on the report${record.investigation_recorded_at ? ` on ${manila(record.investigation_recorded_at)}` : ''}. It becomes the findings of your decision.`
                    : 'Not saved yet. Save it, or press Continue: it becomes the findings of your decision.'
              }
            />
            {!closed && (
              <Button
                variant="outlined"
                disabled={flight.busy || notes.trim().length < INCIDENT_NOTE_MIN || investigationSaved(values)}
                onClick={() => void saveInvestigation()}
                sx={{ ...secondaryButtonSx, alignSelf: 'flex-start' }}
              >
                {flight.busy ? 'Saving...' : investigationSaved(values) ? 'Findings saved' : 'Save findings'}
              </Button>
            )}
          </Box>

          {/* other ways to handle the report: only the ones this report allows, each explained and confirmed. When none applies there is nothing to show. */}
          {!closed && alternatives.length > 0 && (
            <Box sx={section}>
              <Typography sx={{ fontSize: FONT.small, fontWeight: 700, color: PAGE_TEXT.secondary, mb: '8px' }}>OTHER WAYS TO HANDLE THIS REPORT</Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {alternatives.map((alt) => (
                  <Box key={alt.key} sx={{ borderTop: alt === alternatives[0] ? 'none' : `1px solid ${PAGE_BORDER}`, pt: alt === alternatives[0] ? 0 : '10px' }}>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                      <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
                        <Typography sx={{ fontSize: FONT.body, fontWeight: 700, color: PAGE_TEXT.primary }}>{alt.title}</Typography>
                        <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, lineHeight: 1.5 }}>{alt.says}</Typography>
                      </Box>
                      <Button
                        aria-expanded={other === alt.key}
                        onClick={() => {
                          setOther(other === alt.key ? null : alt.key);
                          setOtherReason('');
                        }}
                        sx={alt.key === 'serious' ? dangerOutlineButtonSx : secondaryButtonSx}
                      >
                        {other === alt.key ? 'Cancel' : alt.key === 'lost' ? 'Record contact' : alt.key === 'serious' ? 'Mark as serious' : 'Hand back'}
                      </Button>
                    </Box>
                    {other === alt.key && (
                      <Box sx={{ mt: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {alt.key === 'lost' && (
                          <TextField select size="small" fullWidth label="Status" value={lostStatus} onChange={(e) => setLostStatus(e.target.value as Exclude<LostItemStatus, 'Open'>)}>
                            {LOST_STEPS.map((x) => (
                              <MenuItem key={x.status} value={x.status} disabled={x.status === 'Unclaimed' && Date.now() < unclaimedFrom}>
                                {x.label}
                              </MenuItem>
                            ))}
                          </TextField>
                        )}
                        <TextField
                          size="small"
                          multiline
                          rows={2}
                          fullWidth
                          required
                          label={alt.key === 'lost' ? `Who was contacted and what was agreed or found (at least ${INCIDENT_NOTE_MIN} characters)` : alt.key === 'serious' ? `Why it is serious (at least ${INCIDENT_NOTE_MIN} characters)` : `Why it goes back to the TODA (at least ${INCIDENT_NOTE_MIN} characters)`}
                          value={otherReason}
                          onChange={(e) => setOtherReason(e.target.value)}
                          error={otherReason.length > 0 && !reasonOk}
                          helperText={otherReason.length > 0 && !reasonOk ? `${INCIDENT_NOTE_MIN - otherReason.trim().length} more characters needed.` : undefined}
                        />
                        <Button
                          variant="contained"
                          disableElevation
                          color={alt.key === 'serious' ? 'error' : 'primary'}
                          disabled={flight.busy || !reasonOk}
                          onClick={() => setOtherConfirm(true)}
                          sx={alt.key === 'serious' ? { alignSelf: 'flex-start', textTransform: 'none', fontWeight: 700 } : { ...primaryButtonSx, alignSelf: 'flex-start' }}
                        >
                          {alt.key === 'lost' ? 'Save the update' : alt.key === 'serious' ? 'Mark as serious' : 'Hand back to the TODA'}
                        </Button>
                      </Box>
                    )}
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </>
      )}

      {/* ---------------- 3. decide ---------------- */}
      {active === 2 && !closed && (
        <Box sx={{ ...section, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <TextField
            select
            required
            fullWidth
            size="small"
            label="Outcome"
            value={outcome}
            onChange={(e) => {
              setOutcome(e.target.value as IncidentDecision['outcome']);
              // the strikes on offer depend on the outcome, so the choice made for the old one is cleared
              setStrike(STRIKE_UNSET);
              setPoints('');
            }}
          >
            {outcomes.map((o) => <MenuItem key={o} value={o}>{INCIDENT_OUTCOME_LABEL[o]}</MenuItem>)}
          </TextField>
          {(outcome === 'UPHELD' || outcome === 'FABRICATED') && options.length > 0 && (
            <>
              <TextField
                select
                required
                fullWidth
                size="small"
                label={outcome === 'FABRICATED' ? 'Strike on the REPORTER' : 'Strike (only if you choose one)'}
                value={strike}
                onChange={(e) => {
                  setStrike(e.target.value);
                  setPoints('');
                }}
                slotProps={{ select: { displayEmpty: true, renderValue: (v) => (v === STRIKE_UNSET ? <span style={{ color: '#4d4d52' }}>Choose a strike, or "No strike"</span> : v === NO_STRIKE ? 'No strike: record the outcome only' : options.find((o) => o.code === v)?.en ?? String(v)) } }}
              >
                <MenuItem value={NO_STRIKE}>No strike: record the outcome only</MenuItem>
                {options.map((o) => <MenuItem key={o.code} value={o.code} sx={{ whiteSpace: 'normal' }}>{o.en}</MenuItem>)}
              </TextField>
              {chosen && !chosen.lguOnly && chosen.max > chosen.min && (
                <TextField
                  size="small"
                  type="number"
                  label={`Points (${chosen.min} to ${chosen.max}; default ${chosen.min})`}
                  value={points}
                  onChange={(e) => setPoints(e.target.value)}
                  error={Boolean(pointsProblem(values))}
                  helperText={pointsProblem(values) ?? undefined}
                  slotProps={{ htmlInput: { min: chosen.min, max: chosen.max } }}
                />
              )}
              {chosen && <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, lineHeight: 1.5 }}>The strike is recorded under your name through the strike engine, with this report and your findings. The person is told.</Typography>}
            </>
          )}
          {outcome === 'UPHELD' && (klass === 'SERIOUS' || klass === 'EMERGENCY') && (
            <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, lineHeight: 1.5 }}>The reporter is the confirmed victim of a safety incident: any strike of theirs from the trip's own events (a no-show, a late cancellation) is removed.</Typography>
          )}
          <TextField
            fullWidth
            required
            multiline
            minRows={4}
            size="small"
            label={`Findings and reason for the decision (at least ${INCIDENT_NOTE_MIN} characters)`}
            value={findingsTouched ? findings : findings || saved.notes}
            onChange={(e) => {
              setFindings(e.target.value);
              setFindingsTouched(true);
            }}
            error={decisionNote.length > 0 && decisionNote.length < INCIDENT_NOTE_MIN}
            helperText={!findingsTouched && saved.notes ? 'Taken from your investigation findings. Change it if you need to.' : decisionNote.length < INCIDENT_NOTE_MIN ? `Write at least ${INCIDENT_NOTE_MIN} characters.` : undefined}
          />
        </Box>
      )}

      {/* ---------------- 4. finalize ---------------- */}
      {active === 3 && !closed && (
        <Box sx={{ ...section, display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {[0, 1, 2].every((s) => complete(s)) ? (
            <>
              <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '150px 1fr' }, gap: '6px 14px' }}>
                <Typography component="dt" sx={{ fontSize: FONT.small, fontWeight: 700, color: PAGE_TEXT.secondary }}>Outcome</Typography>
                <Typography component="dd" sx={{ m: 0, fontSize: FONT.body, fontWeight: 600 }}>{outcome ? INCIDENT_OUTCOME_LABEL[outcome as IncidentDecision['outcome']] : '-'}</Typography>
                <Typography component="dt" sx={{ fontSize: FONT.small, fontWeight: 700, color: PAGE_TEXT.secondary }}>Strike</Typography>
                <Typography component="dd" sx={{ m: 0, fontSize: FONT.body }}>{chosen ? `${chosen.en}${points ? `, ${points} points` : ''}` : 'None'}</Typography>
                <Typography component="dt" sx={{ fontSize: FONT.small, fontWeight: 700, color: PAGE_TEXT.secondary }}>Findings</Typography>
                <Typography component="dd" sx={{ m: 0, fontSize: FONT.body, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{decisionNote}</Typography>
                <Typography component="dt" sx={{ fontSize: FONT.small, fontWeight: 700, color: PAGE_TEXT.secondary }}>Who is told</Typography>
                <Typography component="dd" sx={{ m: 0, fontSize: FONT.body }}>The person who filed the report, the other person on the trip{record.reported_toda_id ? ' and the TODA' : ''}.</Typography>
              </Box>
              <Alert severity="warning" icon={false} sx={{ borderRadius: '10px', fontSize: FONT.body }}>Finalizing cannot be undone: a decision is never flipped afterwards.</Alert>
              <FormControlLabel control={<Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />} label={<Typography sx={{ fontSize: FONT.body }}>I have read the report and my findings, and I confirm this decision.</Typography>} />
              <Button variant="contained" disableElevation disabled={!confirmed || flight.busy} onClick={() => setConfirmOpen(true)} sx={{ ...primaryButtonSx, alignSelf: 'flex-start' }}>Finalize resolution</Button>
            </>
          ) : (
            <Alert severity="info" sx={{ borderRadius: '10px' }}>Some earlier steps are not complete. Use Back, or the steps above, to finish them before you finalize.</Alert>
          )}
        </Box>
      )}

      {active === 3 && closed && (
        <Box sx={{ ...section, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {decided && (
            <>
              <Chip label={INCIDENT_OUTCOME_LABEL[record.outcome as keyof typeof INCIDENT_OUTCOME_LABEL]} sx={{ alignSelf: 'flex-start', fontWeight: 700, backgroundColor: '#DCFCE7', color: '#166534' }} />
              <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary }}>
                Decided by the {record.decided_by_role === 'lgu_admin' ? 'LGU' : 'TODA'} Administrator on {manila(record.resolved_at)}
                {record.strike_code ? ` · strike ${record.strike_code}` : ' · no strike'}.
              </Typography>
              {record.resolution_notes && <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.primary, lineHeight: 1.6, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{record.resolution_notes}</Typography>}
            </>
          )}
        </Box>
      )}

      {/* back and next */}
      {!(closed && active === 3) && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', pt: '4px', borderTop: `1px solid ${PAGE_BORDER}` }}>
          <Button disabled={active === 0 || flight.busy} onClick={() => void goTo(active - 1)} sx={secondaryButtonSx}>Back</Button>
          {active < 3 && (
            <Button variant="contained" disableElevation disabled={!canAdvance || flight.busy} onClick={() => void goTo(active + 1)} sx={primaryButtonSx}>
              {flight.busy ? 'Saving...' : active === 0 ? 'Continue to investigation' : active === 1 ? 'Save and continue to the decision' : 'Review before finalizing'}
            </Button>
          )}
        </Box>
      )}

      <MacConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Finalize this resolution?"
        message={`The decision "${outcome ? INCIDENT_OUTCOME_LABEL[outcome as IncidentDecision['outcome']] : ''}" is recorded under your name and the people involved are told. This cannot be undone.`}
        confirmLabel="Finalize resolution"
        confirmVariant="danger"
        onConfirm={() => void finalize()}
      />
      {other && (
        <MacConfirmDialog
          open={otherConfirm}
          onClose={() => setOtherConfirm(false)}
          title={otherConfirmWords[other].title}
          message={otherConfirmWords[other].message}
          confirmLabel={otherConfirmWords[other].label}
          confirmVariant={other === 'serious' ? 'danger' : 'orange'}
          onConfirm={() => {
            setOtherConfirm(false);
            void runOther();
          }}
        />
      )}
    </Box>
  );
};
