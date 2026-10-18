import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, FormControlLabel, MenuItem, Radio, RadioGroup, TextField, Typography } from '@mui/material';
import { APPEAL_CAUSE_LABELS, EvidenceLinks, decisionProblem, isPendingAppeal } from '@sakay/shared';
import type { AppealRecord, ExemptionOutcome } from '@sakay/shared';

import { MacCenterModal } from './MacCenterModal';
import { MacConfirmDialog } from './MacConfirmDialog';
import { StatusBadge } from '../common/StatusBadge';
import { decideAppeal, signLguCaseEvidence, voidStrike } from '../../services/adminApiService';

const stamp = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-';

const COUNTED = new Set(['ACTIVE', 'PROVISIONAL', 'PARTIALLY_WAIVED']);

interface AppealDetailModalProps {
  open: boolean;
  onClose: () => void;
  appeal: AppealRecord;
  /** the request was decided or the strike voided: the page reloads its list */
  onChanged: () => void | Promise<void>;
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <Box>
    <Typography sx={{ fontSize: '10px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', mb: '3px' }}>{label}</Typography>
    <Typography component="div" sx={{ fontSize: '12.5px', color: 'var(--mac-text-primary)', lineHeight: 1.5 }}>{children}</Typography>
  </Box>
);

/**
 * Rules 22 and 25: one strike appeal, what the person said, and the LGU Administrator's decision: Full waiver (the strike is removed), Partial waiver
 * (some points are removed), or Denied (the strike stands), always with a reason (25.6, 25.8). A strike that should never have been issued can be
 * voided instead. The database decides who may do what and writes the audit entry; an appeal that is with a TODA Administrator is shown, not decided here.
 */
export const AppealDetailModal: React.FC<AppealDetailModalProps> = ({ open, onClose, appeal, onChanged }) => {
  const [outcome, setOutcome] = useState<ExemptionOutcome | null>(null);
  const [points, setPoints] = useState<number>(1);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [voiding, setVoiding] = useState(false);

  // a different appeal opens with a clean form
  useEffect(() => {
    setOutcome(null);
    setPoints(1);
    setReason('');
    setError(null);
  }, [appeal.requestId]);

  const pending = isPendingAppeal(appeal.status);
  const mine = pending && appeal.assignedRole === 'lgu_admin';
  const problem = decisionProblem(outcome, reason, outcome === 'PARTIAL' ? points : null, appeal.pointsActive);
  const canPartial = appeal.pointsActive >= 2;

  const submit = async () => {
    if (!outcome || problem || busy) return;
    setBusy(true);
    setError(null);
    const message = await decideAppeal(appeal.requestId, outcome, reason, outcome === 'PARTIAL' ? points : null);
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    await onChanged();
    onClose();
  };

  const confirmVoid = async (voidReason?: string) => {
    setVoiding(false);
    if (!voidReason) return;
    setBusy(true);
    setError(null);
    const message = await voidStrike(appeal.strikeId, voidReason);
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    await onChanged();
    onClose();
  };

  return (
    <>
      <MacCenterModal
        open={open}
        onClose={onClose}
        title={`Strike appeal: ${appeal.subjectName}`}
        subtitle={`${appeal.subjectType === 'passenger' ? 'Passenger' : 'Driver'} · requested ${stamp(appeal.requestedAt)}`}
        badge={<StatusBadge status={appeal.status} />}
        maxWidth={720}
        secondaryActionLabel="Close"
        extraActions={
          pending && COUNTED.has(appeal.strikeStatus) && appeal.assignedRole === 'lgu_admin' ? (
            <Button
              variant="text"
              color="error"
              onClick={() => setVoiding(true)}
              disabled={busy}
              sx={{ textTransform: 'none', fontSize: '11.6px', fontWeight: 600, mr: 'auto' }}
            >
              Void this strike (issued in error)
            </Button>
          ) : undefined
        }
        primaryActionLabel={mine ? 'Record decision' : undefined}
        onPrimaryAction={submit}
        primaryActionDisabled={!mine || Boolean(problem) || busy}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.2 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            <Field label="Strike">{appeal.violation}</Field>
            <Field label="Points">{appeal.pointsActive} active of {appeal.pointsIssued} issued ({appeal.strikeStatus || 'unknown status'})</Field>
            <Field label="Cause given">{APPEAL_CAUSE_LABELS[appeal.causeCode] ?? appeal.causeCode}</Field>
            <Field label={pending ? 'Decision due (3 business days)' : 'Decided'}>
              {pending ? `${stamp(appeal.decisionDueAt)}${appeal.overdue ? ' - OVERDUE' : ''}` : stamp(appeal.decidedAt)}
            </Field>
          </Box>

          <Field label="What happened (in the person's words)">{appeal.justification || '-'}</Field>

          {appeal.evidenceUrls.length > 0 && <EvidenceLinks paths={appeal.evidenceUrls} sign={signLguCaseEvidence} label="Evidence (photos sent with the appeal)" />}

          {appeal.escalationReason && <Field label="Why it reached the LGU">{appeal.escalationReason}</Field>}

          {!pending && (
            <Alert severity={appeal.status === 'Denied' ? 'error' : 'success'} sx={{ borderRadius: '10px' }}>
              <strong>{appeal.status}</strong>
              {appeal.pointsWaived !== null && appeal.status !== 'Denied' ? ` (${appeal.pointsWaived} point(s) removed)` : ''}
              {appeal.autoDenied ? ' - denied by the system: the same cause was used three times in 30 days (Rule 25.7)' : ''}
              {appeal.decisionReason ? `: ${appeal.decisionReason}` : ''}
            </Alert>
          )}

          {pending && !mine && (
            <Alert severity="info" sx={{ borderRadius: '10px' }}>
              This appeal is with the TODA Administrator of the driver (Rule 25.4). It comes here only if the TODA escalates it, or if it involves a suspension or deactivation, or the TODA is a party to the dispute.
            </Alert>
          )}

          {mine && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, borderTop: '1px solid var(--mac-border-color)', pt: 2 }}>
              <Typography sx={{ fontSize: '12px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>Your decision</Typography>
              <RadioGroup value={outcome ?? ''} onChange={(e) => setOutcome(e.target.value as ExemptionOutcome)}>
                <FormControlLabel value="FULL" control={<Radio size="small" />} label={<Typography sx={{ fontSize: '12.5px' }}>Full waiver: the strike is removed entirely</Typography>} />
                <FormControlLabel value="PARTIAL" disabled={!canPartial} control={<Radio size="small" />} label={<Typography sx={{ fontSize: '12.5px' }}>Partial waiver: some of the points are removed{canPartial ? '' : ' (a one-point strike cannot be split)'}</Typography>} />
                <FormControlLabel value="DENIED" control={<Radio size="small" />} label={<Typography sx={{ fontSize: '12.5px' }}>Denied: the strike stands</Typography>} />
              </RadioGroup>
              {outcome === 'PARTIAL' && (
                <TextField select size="small" label="Points to remove" value={points} onChange={(e) => setPoints(Number(e.target.value))} sx={{ maxWidth: 220 }}>
                  {Array.from({ length: Math.max(0, appeal.pointsActive - 1) }, (_, i) => i + 1).map((n) => (
                    <MenuItem key={n} value={n}>{n} of {appeal.pointsActive}</MenuItem>
                  ))}
                </TextField>
              )}
              <TextField
                multiline
                minRows={3}
                size="small"
                label="Reason for the decision (kept in the audit log, shown to the person)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                fullWidth
              />
              {problem && (outcome !== null || reason.length > 0) && (
                <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>{problem}</Typography>
              )}
            </Box>
          )}

          {error && <Alert severity="error" sx={{ borderRadius: '10px' }}>{error}</Alert>}
        </Box>
      </MacCenterModal>

      <MacConfirmDialog
        open={voiding}
        onClose={() => setVoiding(false)}
        title="Void this strike?"
        message="A voided strike is removed from the person's record as if it had never been issued, and any open appeal of it is closed. Use this only for a strike that should never have been issued. For a real strike with a good reason, decide the appeal instead."
        confirmLabel="Void strike"
        confirmVariant="danger"
        requireReason
        reasonPlaceholder="Why was this strike issued in error?"
        minReasonLength={5}
        onConfirm={confirmVoid}
      />
    </>
  );
};
