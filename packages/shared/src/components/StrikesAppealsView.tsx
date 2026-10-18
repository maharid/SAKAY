import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { EXEMPTION_CAUSE_CODES, EXEMPTION_REQUEST_WINDOW_HOURS } from '../config/policyConfig';
import type { ExemptionCauseCode } from '../config/policyConfig';
import { useInFlight } from '../hooks/useInFlight';
import { canAppealStrike, newestAppealByStrike } from '../utils/strikeAppeals';
import type { AppealResult, AppealRow, StrikeHistory, StrikeRow } from '../utils/strikeAppeals';

export interface StrikesAppealsViewProps {
  language: 'tl' | 'en';
  /** whose strikes these are: only changes the wording about who reviews an appeal */
  audience: 'passenger' | 'driver';
  history: StrikeHistory | null;
  appeals: AppealRow[];
  loading: boolean;
  /** the strikes could not be read */
  failed: boolean;
  /** send an appeal; the database's answer comes back as it is */
  onAppeal: (strikeId: string, cause: ExemptionCauseCode, justification: string) => Promise<AppealResult>;
  /** an appeal was sent: the screen reloads its data and shows `message` */
  onAppealSent: (message: string) => void | Promise<void>;
}

const CAUSE_LABELS: Record<ExemptionCauseCode, { en: string; tl: string }> = {
  FORCE_MAJEURE: { en: 'Force majeure (storm, flood, road closure)', tl: 'Force majeure (bagyo, baha, saradong daan)' },
  VEHICLE_BREAKDOWN: { en: 'Vehicle breakdown', tl: 'Nasira ang sasakyan' },
  NETWORK_OUTAGE: { en: 'Signal or network outage', tl: 'Walang signal o network' },
  MEDICAL_EMERGENCY: { en: 'Medical emergency', tl: 'Emergency sa kalusugan' },
  ACCIDENT_DOCUMENTED: { en: 'Documented traffic accident', tl: 'May dokumentadong aksidente' },
  DEVICE_FAILURE: { en: 'Phone or GPS failure (dead battery, damaged phone)', tl: 'Sira ang phone o GPS (na-lowbat, nasira)' },
  OTHER: { en: 'Other cause', tl: 'Ibang dahilan' },
};

const STATUS_LABELS: Record<string, { en: string; tl: string; color: 'warning' | 'default' | 'success' | 'error' }> = {
  PROVISIONAL: { en: 'Provisional (may be waived)', tl: 'Pansamantala (maaaring alisin)', color: 'warning' },
  ACTIVE: { en: 'Active', tl: 'Aktibo', color: 'error' },
  PARTIALLY_WAIVED: { en: 'Partly waived', tl: 'Bahagyang inalis', color: 'warning' },
  WAIVED: { en: 'Waived', tl: 'Inalis', color: 'success' },
  AUTO_WAIVED: { en: 'No strike (exempt)', tl: 'Walang strike (exempted)', color: 'success' },
  OBSERVED: { en: 'Recorded (no strike yet)', tl: 'Naitala (wala pang strike)', color: 'default' },
  VOIDED: { en: 'Cancelled', tl: 'Kinansela', color: 'default' },
};

const APPEAL_STATUS: Record<string, { en: string; tl: string; severity: 'info' | 'success' | 'error' }> = {
  'Pending TODA Review': { en: 'Waiting for the TODA Administrator', tl: 'Naghihintay sa TODA Administrator', severity: 'info' },
  'Pending LGU Review': { en: 'Waiting for the LGU Administrator', tl: 'Naghihintay sa LGU Administrator', severity: 'info' },
  'Full Waiver': { en: 'The strike was removed', tl: 'Inalis ang strike', severity: 'success' },
  'Partial Waiver': { en: 'The strike was partly removed', tl: 'Bahagyang inalis ang strike', severity: 'success' },
  Denied: { en: 'Denied', tl: 'Tinanggihan', severity: 'error' },
};

const manila = (iso: string, withTime = true): string =>
  new Date(iso).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });

/**
 * Rules 20 / 21 and 25: the strikes of the signed-in person with their status, and the way to appeal one within 48 hours of its issue. The same
 * screen serves passengers (an appeal goes to the LGU Administrator, 25.5) and drivers (to the TODA Administrator, 25.4); the database routes it.
 * The page that holds this view brings its own header, toast and data.
 */
export const StrikesAppealsView: React.FC<StrikesAppealsViewProps> = ({ language, audience, history, appeals, loading, failed, onAppeal, onAppealSent }) => {
  const tl = language === 'tl';
  const flight = useInFlight();

  const [target, setTarget] = useState<StrikeRow | null>(null);
  const [cause, setCause] = useState<ExemptionCauseCode>('OTHER');
  const [justification, setJustification] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const appealByStrike = useMemo(() => newestAppealByStrike(appeals), [appeals]);

  const openForm = (s: StrikeRow) => {
    setTarget(s);
    setCause(s.violationCode === 'DRV_CONNECTIVITY_FAILURE' ? 'NETWORK_OUTAGE' : 'OTHER');
    setJustification('');
    setFormError(null);
  };

  const send = () =>
    flight.run(async () => {
      if (!target) return;
      if (justification.trim().length < 5) {
        setFormError(tl ? 'Isulat kung ano ang nangyari.' : 'Write what happened.');
        return;
      }
      const result = await onAppeal(target.strikeId, cause, justification);
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      setTarget(null);
      await onAppealSent(
        result.assignedRole === 'lgu_admin'
          ? (tl ? 'Naipadala ang apela sa LGU Administrator.' : 'Your appeal was sent to the LGU Administrator.')
          : (tl ? 'Naipadala ang apela sa TODA Administrator mo.' : 'Your appeal was sent to your TODA Administrator.')
      );
    });

  const strikes = history?.strikes ?? [];

  return (
    <>
      <Box className="hide-scrollbar" sx={{ flex: 1, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress size={28} sx={{ color: '#FF6600' }} aria-label={tl ? 'Naglo-load' : 'Loading'} />
          </Box>
        ) : failed ? (
          <Alert severity="warning" sx={{ borderRadius: '12px' }}>
            {tl ? 'Hindi makuha ang mga strike mo ngayon. Subukan muli mamaya.' : 'Your strikes could not be loaded right now. Try again in a moment.'}
          </Alert>
        ) : (
          <>
            <Paper elevation={0} sx={{ p: 2, borderRadius: '16px', border: '1px solid #F1F5F9' }}>
              <Typography sx={{ fontSize: '13px', color: '#64748B', fontWeight: 600 }}>
                {tl ? `Aktibong strike (huling ${history?.windowDays ?? 90} araw)` : `Active strikes (last ${history?.windowDays ?? 90} days)`}
              </Typography>
              <Typography sx={{ fontSize: '28px', fontWeight: 700, color: '#0F172A' }}>{history?.activeStrikes ?? 0}</Typography>
              <Typography sx={{ fontSize: '12px', color: '#64748B', mt: 0.5, lineHeight: 1.4 }}>
                {tl
                  ? `May ${EXEMPTION_REQUEST_WINDOW_HOURS} oras ka mula nang ibigay ang strike para humiling na alisin ito.`
                  : `You have ${EXEMPTION_REQUEST_WINDOW_HOURS} hours from the moment a strike is issued to ask for it to be waived.`}
                {' '}
                {audience === 'passenger'
                  ? (tl ? 'Ang LGU Administrator ang magpapasya sa iyong apela.' : 'The LGU Administrator decides your appeal.')
                  : (tl ? 'Ang TODA Administrator mo ang unang magpapasya sa apela.' : 'Your TODA Administrator decides your appeal first.')}
              </Typography>
            </Paper>

            {strikes.length === 0 && (
              <Typography sx={{ textAlign: 'center', color: '#64748B', fontSize: '13px', p: 3 }}>
                {tl ? 'Wala kang strike.' : 'You have no strikes.'}
              </Typography>
            )}

            {strikes.map((s) => {
              const label = STATUS_LABELS[s.status] ?? { en: s.status, tl: s.status, color: 'default' as const };
              const appeal = appealByStrike.get(s.strikeId);
              const appealLabel = appeal ? APPEAL_STATUS[appeal.status] ?? { en: appeal.status, tl: appeal.status, severity: 'info' as const } : null;
              const pending = appeal ? appeal.status.startsWith('Pending') : false;
              return (
                <Paper key={s.strikeId} elevation={0} sx={{ p: 2, borderRadius: '16px', border: '1px solid #F1F5F9', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                    <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#0F172A', lineHeight: 1.3 }}>{s.description}</Typography>
                    <Chip size="small" color={label.color} label={tl ? label.tl : label.en} sx={{ fontWeight: 700, flexShrink: 0 }} />
                  </Box>
                  <Typography sx={{ fontSize: '12px', color: '#64748B' }}>
                    {manila(s.issuedAt)} · {s.sourceRule} · {s.pointsActive}/{s.pointsIssued} {tl ? 'puntos' : 'point(s)'}
                  </Typography>
                  {s.reason && <Typography sx={{ fontSize: '12.5px', color: '#334155', lineHeight: 1.4 }}>{s.reason}</Typography>}
                  {s.status === 'PROVISIONAL' && s.provisionalUntil && (
                    <Typography sx={{ fontSize: '12px', color: '#B45309', fontWeight: 600 }}>
                      {tl ? `Maaaring alisin kung hihilingin bago ${manila(s.provisionalUntil)}.` : `May be waived if you ask before ${manila(s.provisionalUntil)}.`}
                    </Typography>
                  )}
                  {appeal && appealLabel && (
                    <Alert severity={appealLabel.severity} sx={{ borderRadius: '10px', fontSize: '12px', py: 0 }}>
                      {tl ? 'Apela: ' : 'Appeal: '}
                      {tl ? appealLabel.tl : appealLabel.en}
                      {pending && appeal.decisionDueAt ? (tl ? ` · inaasahan ang desisyon bago ${manila(appeal.decisionDueAt, false)}` : ` · decision due by ${manila(appeal.decisionDueAt, false)}`) : ''}
                      {appeal.decisionReason ? ` — ${appeal.decisionReason}` : ''}
                    </Alert>
                  )}
                  {canAppealStrike(s, appeal) && (
                    <Button
                      variant="outlined"
                      onClick={() => openForm(s)}
                      sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '12px', minHeight: 44, borderColor: '#FF6600', color: '#FF6600', alignSelf: 'flex-start' }}
                    >
                      {tl ? 'Mag-apela' : 'Appeal this strike'}
                    </Button>
                  )}
                </Paper>
              );
            })}
          </>
        )}
      </Box>

      <Dialog open={target !== null} onClose={() => setTarget(null)} maxWidth="xs" fullWidth slotProps={{ paper: { sx: { borderRadius: '24px', p: 1 } } }}>
        <DialogTitle sx={{ fontWeight: 700, fontSize: '16px', color: '#0F172A' }}>{tl ? 'Mag-apela ng strike' : 'Appeal a strike'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: '8px !important' }}>
          <Typography sx={{ fontSize: '13px', color: '#475569', lineHeight: 1.45 }}>{target?.description}</Typography>
          <TextField select size="small" label={tl ? 'Dahilan' : 'Cause'} value={cause} onChange={(e) => setCause(e.target.value as ExemptionCauseCode)} fullWidth>
            {EXEMPTION_CAUSE_CODES.map((c) => (
              <MenuItem key={c} value={c}>
                {tl ? CAUSE_LABELS[c].tl : CAUSE_LABELS[c].en}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            multiline
            minRows={3}
            size="small"
            label={tl ? 'Ano ang nangyari?' : 'What happened?'}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            fullWidth
          />
          {formError && (
            <Alert severity="warning" sx={{ borderRadius: '12px', fontSize: '12px' }}>
              {formError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <Button onClick={() => setTarget(null)} sx={{ textTransform: 'none', color: '#64748B', fontWeight: 700 }}>
            {tl ? 'Kanselahin' : 'Cancel'}
          </Button>
          <Button
            variant="contained"
            disabled={flight.busy}
            onClick={send}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '12px', backgroundColor: '#FF6600', '&:hover': { backgroundColor: '#E05300' } }}
          >
            {tl ? 'Ipadala' : 'Send appeal'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default StrikesAppealsView;
