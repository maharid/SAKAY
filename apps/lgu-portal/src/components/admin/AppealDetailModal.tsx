import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, FormControlLabel, MenuItem, Radio, RadioGroup, TextField, Typography } from '@mui/material';
import { APPEAL_CAUSE_LABELS, EvidenceLinks, decisionProblem, isPendingAppeal } from '@sakay/shared';
import type { AppealRecord, ExemptionOutcome } from '@sakay/shared';

import { MacCenterModal } from './MacCenterModal';
import { MacConfirmDialog } from './MacConfirmDialog';
import { StatusBadge } from '../common/StatusBadge';
import { DetailField, DetailGrid, DetailSection } from '../common/DetailSection';
import { decideAppeal, signLguCaseEvidence, voidStrike } from '../../services/adminApiService';
import { FONT } from '../../styles/density';
import { PAGE_BORDER, PAGE_TEXT } from '../../styles/pageTheme';

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

  const radioLabel = (text: string) => <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.primary }}>{text}</Typography>;

  return (
    <>
      <MacCenterModal
        open={open}
        onClose={onClose}
        title={`Strike appeal: ${appeal.subjectName}`}
        subtitle={`${appeal.subjectType === 'passenger' ? 'Passenger' : 'Driver'} · requested ${stamp(appeal.requestedAt)}`}
        badge={<StatusBadge status={appeal.status} />}
        maxWidth={576}
        extraActions={
          pending && COUNTED.has(appeal.strikeStatus) && appeal.assignedRole === 'lgu_admin' ? (
            <Button
              variant="text"
              onClick={() => setVoiding(true)}
              disabled={busy}
              sx={{ textTransform: 'none', fontSize: FONT.body, fontWeight: 600, mr: 'auto', color: PAGE_TEXT.danger }}
            >
              Void this strike (issued in error)
            </Button>
          ) : undefined
        }
        primaryActionLabel={mine ? 'Record decision' : undefined}
        onPrimaryAction={submit}
        primaryActionDisabled={!mine || Boolean(problem) || busy}
      >
        <DetailSection title="The strike">
          <DetailGrid>
            <DetailField label="Strike">{appeal.violation}</DetailField>
            <DetailField label="Points">{appeal.pointsActive} active of {appeal.pointsIssued} issued ({appeal.strikeStatus || 'unknown status'})</DetailField>
            <DetailField label="Cause given">{APPEAL_CAUSE_LABELS[appeal.causeCode] ?? appeal.causeCode}</DetailField>
            <DetailField label={pending ? 'Decision due (3 business days)' : 'Decided'}>
              {pending ? `${stamp(appeal.decisionDueAt)}${appeal.overdue ? ' - OVERDUE' : ''}` : stamp(appeal.decidedAt)}
            </DetailField>
          </DetailGrid>
        </DetailSection>

        <DetailSection title="What happened (in the person's words)">
          <Box sx={{ backgroundColor: '#FAFAF8', border: `1px solid ${PAGE_BORDER}`, borderRadius: '12px', p: '12px 14px' }}>
            <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.primary, lineHeight: 1.55, overflowWrap: 'anywhere' }}>{appeal.justification || '-'}</Typography>
          </Box>
        </DetailSection>

        {appeal.evidenceUrls.length > 0 && (
          <DetailSection title="Evidence">
            <EvidenceLinks paths={appeal.evidenceUrls} sign={signLguCaseEvidence} label="Photos sent with the appeal" />
          </DetailSection>
        )}

        {appeal.escalationReason && (
          <DetailSection title="Why it reached the LGU">
            <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.primary, lineHeight: 1.55 }}>{appeal.escalationReason}</Typography>
          </DetailSection>
        )}

        {!pending && (
          <Alert severity={appeal.status === 'Denied' ? 'error' : 'success'} sx={{ borderRadius: '10px', mb: '20px' }}>
            <strong>{appeal.status}</strong>
            {appeal.pointsWaived !== null && appeal.status !== 'Denied' ? ` (${appeal.pointsWaived} point(s) removed)` : ''}
            {appeal.autoDenied ? ' - denied by the system: the same cause was used three times in 30 days' : ''}
            {appeal.decisionReason ? `: ${appeal.decisionReason}` : ''}
          </Alert>
        )}

        {pending && !mine && (
          <Alert severity="info" sx={{ borderRadius: '10px', mb: '20px' }}>
            This appeal is with the TODA Administrator of the driver. It comes here only if the TODA escalates it, or if it involves a suspension or deactivation, or the TODA is a party to the dispute.
          </Alert>
        )}

        {mine && (
          <DetailSection title="Your decision">
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <RadioGroup value={outcome ?? ''} onChange={(e) => setOutcome(e.target.value as ExemptionOutcome)}>
                <FormControlLabel value="FULL" control={<Radio size="small" />} label={radioLabel('Full waiver: the strike is removed entirely')} />
                <FormControlLabel value="PARTIAL" disabled={!canPartial} control={<Radio size="small" />} label={radioLabel(`Partial waiver: some of the points are removed${canPartial ? '' : ' (a one-point strike cannot be split)'}`)} />
                <FormControlLabel value="DENIED" control={<Radio size="small" />} label={radioLabel('Denied: the strike stands')} />
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
                <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary }}>{problem}</Typography>
              )}
            </Box>
          </DetailSection>
        )}

        {error && <Alert severity="error" sx={{ borderRadius: '10px' }}>{error}</Alert>}
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
