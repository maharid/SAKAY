import React, { useMemo, useState } from 'react';
import { Alert, Box, Button, TextField, Typography } from '@mui/material';
import ForwardToInboxOutlinedIcon from '@mui/icons-material/ForwardToInboxOutlined';
import { IncidentFacts, IncidentReviewPanel, incidentClocks, incidentHandling, type IncidentFollowupRow, type LostItemStatus } from '@sakay/shared';
import type { IncidentDecision } from '@sakay/shared';

import type { TodaIncident } from '../../types/toda';
import { MacCenterModal } from '../admin/MacCenterModal';
import { DocumentPreviewModal } from '../admin/DocumentPreviewModal';
import { StatusPill } from '../common/DataTable';
import { primaryButtonSx } from '../common/pageButtons';
import { OPS_BORDER, OPS_TEXT } from '../operations/operationsTheme';
import { FONT, SPACE } from '../../styles/density';
import { sendFollowupToLgu } from '../../services/todaApiService';

interface TodaIncidentModalProps {
  incident: TodaIncident;
  todaName: string;
  followups: IncidentFollowupRow[];
  onClose: () => void;
  /** The list is read again after every action: the database's answer is what the window then shows */
  onChanged: () => void | Promise<void>;
  onStart: () => Promise<string | null>;
  onEscalate: (reason: string, serious: boolean) => Promise<string | null>;
  onDecide: (d: Omit<IncidentDecision, 'incidentId'>) => Promise<string | null>;
  onLostItem: (status: Exclude<LostItemStatus, 'Open'>, note: string) => Promise<string | null>;
}

const manila = (iso?: string | null): string => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-';
};

const section = { p: '14px 16px', borderRadius: '12px', border: `1px solid ${OPS_BORDER}`, backgroundColor: '#FFFFFF' } as const;
const heading = { fontSize: FONT.heading, fontWeight: 700, color: OPS_TEXT.primary, mb: '6px' } as const;

/**
 * One incident report, for the TODA administrator: what was reported and by whom, where the vehicle was, the people, the evidence, and WHO HAS TO ACT. A report with the TODA needs the
 * administrator's action (review it, decide it, escalate it); a report with the LGU is only monitored: the administrator is told when the LGU answers and may send the LGU a
 * follow-up (who, when and what are recorded; a second one waits for the cooldown).
 */
export const TodaIncidentModal: React.FC<TodaIncidentModalProps> = ({ incident, todaName, followups, onClose, onChanged, onStart, onEscalate, onDecide, onLostItem }) => {
  const record = incident.record!;
  const handling = incidentHandling(record, 'toda_admin');
  const clocks = incidentClocks(record);
  const [photo, setPhoto] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const nextAllowed = followups.length > 0 ? Date.parse(followups[0].next_allowed_at) : NaN;
  const waitingForCooldown = Number.isFinite(nextAllowed) && nextAllowed > Date.now();

  // what happened to this report, from what the database holds about it (nothing is invented)
  const history = useMemo(() => {
    const rows: { at: string | null | undefined; title: string; detail?: string | null }[] = [{ at: record.created_at, title: 'Report filed', detail: `${incident.reporterRole} ${incident.reporterName}` }];
    if (record.first_action_at) rows.push({ at: record.first_action_at, title: 'First action taken' });
    if (record.escalated_at) rows.push({ at: record.escalated_at, title: 'Escalated to the LGU', detail: record.escalation_reason });
    for (const f of [...followups].reverse()) rows.push({ at: f.sent_at, title: `${f.kind === 'escalation' ? 'Escalation' : 'Follow-up'} no. ${f.sequence_no} sent to the LGU`, detail: [f.sent_by_name ? `by ${f.sent_by_name}` : '', f.message ?? ''].filter(Boolean).join(': ') });
    if (record.overdue_since && record.overdue_kind) rows.push({ at: record.overdue_since, title: record.overdue_kind === 'decision' ? 'Passed the decision time' : 'Passed the first-action time' });
    if (record.resolved_at) rows.push({ at: record.resolved_at, title: `Closed by the ${record.decided_by_role === 'lgu_admin' ? 'LGU' : 'TODA'} Administrator`, detail: record.resolution_notes });
    return rows.sort((a, b) => Date.parse(String(a.at)) - Date.parse(String(b.at)));
  }, [record, followups, incident.reporterName, incident.reporterRole]);

  const sendFollowup = async () => {
    setSending(true);
    setFeedback(null);
    const result = await sendFollowupToLgu(incident.id, message);
    setSending(false);
    if (result.error) {
      setFeedback({ ok: false, text: result.error });
      return;
    }
    setMessage('');
    setFeedback({ ok: true, text: 'Your follow-up was sent to the LGU Administrator.' });
    await onChanged();
  };

  const evidence = incident.evidenceFiles ?? [];
  const code = incident.incidentCode || incident.id.slice(0, 8).toUpperCase();

  return (
    <>
      <MacCenterModal
        open
        onClose={onClose}
        title={`Incident report #${code}`}
        subtitle={incident.category}
        badge={
          handling === 'action' ? <StatusPill label="Needs your action" tone="warning" />
          : handling === 'monitoring' ? <StatusPill label="With the LGU: you are monitoring it" tone="info" />
          : <StatusPill label="Closed" tone="neutral" />
        }
        maxWidth={680}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: SPACE.gapLarge }}>
          {handling === 'action' && (
            <Alert severity={clocks.overdue ? 'error' : 'warning'} icon={false} sx={{ borderRadius: '10px', fontSize: FONT.body }}>
              <b>This report needs your action.</b> Review it, record your decision, or escalate it to the LGU if it needs more than you can decide.
              {clocks.overdue ? ' It has passed its time limit.' : ''}
            </Alert>
          )}
          {handling === 'monitoring' && (
            <Alert severity={clocks.overdue ? 'error' : 'info'} icon={false} sx={{ borderRadius: '10px', fontSize: FONT.body }}>
              <b>This report is with the LGU Administrator.</b> You are monitoring it: you will be notified when the LGU answers.
              {clocks.overdue ? ' The LGU has passed its time limit: you can send it a follow-up below.' : ''}
            </Alert>
          )}

          <IncidentFacts
            record={record}
            reporter={{ role: incident.reporterRole, name: incident.reporterName }}
            passenger={{ name: incident.passengerName, phone: incident.passengerPhone }}
            driver={{ name: incident.driverName, phone: incident.driverPhone, plate: incident.vehiclePlate }}
            todaName={todaName}
            route={incident.route}
            evidence={evidence}
            onOpenEvidence={setPhoto}
          />

          {handling === 'monitoring' && (
            <Box sx={section}>
              <Typography sx={heading}>Follow up with the LGU</Typography>
              <Typography sx={{ fontSize: FONT.body, color: OPS_TEXT.secondary, lineHeight: 1.55, mb: '10px' }}>
                Ask the LGU Administrator to act on this report. The LGU is notified, and your name, the time and your message are recorded. You can send another follow-up once the waiting time passes.
              </Typography>
              <TextField
                fullWidth
                multiline
                minRows={2}
                size="small"
                label="Message to the LGU (optional)"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={sending || waitingForCooldown}
                slotProps={{ htmlInput: { maxLength: 500 } }}
              />
              <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 14px', mt: '10px' }}>
                <Button variant="contained" disableElevation startIcon={<ForwardToInboxOutlinedIcon sx={{ fontSize: 17 }} />} onClick={() => void sendFollowup()} disabled={sending || waitingForCooldown} sx={primaryButtonSx}>
                  {sending ? 'Sending...' : 'Send follow-up to the LGU'}
                </Button>
                {waitingForCooldown && (
                  <Typography sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary }}>You already followed up. You can send another after {manila(followups[0].next_allowed_at)}.</Typography>
                )}
              </Box>
              {feedback && <Alert severity={feedback.ok ? 'success' : 'error'} sx={{ mt: '10px', borderRadius: '8px', fontSize: FONT.body }}>{feedback.text}</Alert>}
            </Box>
          )}

          {handling === 'action' && (
            <Box sx={section}>
              <Typography sx={heading}>What you can do</Typography>
              <IncidentReviewPanel role="toda_admin" incident={record} compact onStart={onStart} onEscalate={onEscalate} onDecide={onDecide} onLostItem={onLostItem} />
            </Box>
          )}

          {incident.findings && handling === 'closed' && (
            <Box sx={{ ...section, borderColor: 'var(--sakay-orange-border)' }}>
              <Typography sx={heading}>Findings</Typography>
              <Typography sx={{ fontSize: FONT.body, color: OPS_TEXT.primary, lineHeight: 1.6, overflowWrap: 'anywhere' }}>{incident.findings}</Typography>
            </Box>
          )}

          <Box sx={section}>
            <Typography sx={heading}>History</Typography>
            <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {history.map((h, i) => (
                <Box component="li" key={i} sx={{ display: 'flex', gap: '10px' }}>
                  <Box aria-hidden sx={{ width: 9, height: 9, borderRadius: '50%', mt: '6px', flexShrink: 0, backgroundColor: 'var(--sakay-orange)' }} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: OPS_TEXT.primary }}>{h.title}</Typography>
                    <Typography sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary, overflowWrap: 'anywhere' }}>{manila(h.at)}{h.detail ? ` · ${h.detail}` : ''}</Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      </MacCenterModal>

      {photo !== null && (
        <DocumentPreviewModal
          open
          onClose={() => setPhoto(null)}
          documentName={evidence[photo]?.name ?? 'Evidence'}
          documentType="Photo evidence"
          imageUrls={evidence.map((f) => f.url)}
          photoLabels={evidence.map((_, i) => `Photo ${i + 1}`)}
        />
      )}
    </>
  );
};
