import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { EXEMPTION_CAUSE_CODES, EXEMPTION_REQUEST_WINDOW_HOURS, useInFlight } from '@sakay/shared';
import type { ExemptionCauseCode } from '@sakay/shared';

import PageHeader from '../../../common/components/PageHeader';
import SakayToast from '../../../common/components/SakayToast';
import {
  fetchMyAppeals,
  fetchMyStrikes,
  submitStrikeAppeal,
  type DriverAppeal,
  type DriverStrike,
  type StrikeHistory,
} from '../../../services/strikeAppealService';
import { useLanguage } from '../../../utils/LanguageContext';

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

const manila = (iso: string, withTime = true): string =>
  new Date(iso).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });

const APPEALABLE = new Set(['ACTIVE', 'PROVISIONAL', 'PARTIALLY_WAIVED']);

/**
 * Rules 8.6, 9.4 and 25: the driver's strikes, and the way to appeal one. A strike for a stall or a lost connection can be appealed (a road
 * obstruction, a breakdown, a GPS or phone failure). The request goes to his TODA Administrator; the database refuses what the policy refuses.
 */
const DriverStrikesPage: React.FC = () => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const tl = language === 'tl';
  const flight = useInFlight();

  const [history, setHistory] = useState<StrikeHistory | null>(null);
  const [appeals, setAppeals] = useState<DriverAppeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [target, setTarget] = useState<DriverStrike | null>(null);
  const [cause, setCause] = useState<ExemptionCauseCode>('NETWORK_OUTAGE');
  const [justification, setJustification] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [h, a] = await Promise.all([fetchMyStrikes(), fetchMyAppeals()]);
    setHistory(h);
    setFailed(h === null);
    setAppeals(a);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const appealByStrike = useMemo(() => {
    const m = new Map<string, DriverAppeal>();
    for (const a of appeals) if (!m.has(a.strikeId)) m.set(a.strikeId, a);       // newest first
    return m;
  }, [appeals]);

  const windowMs = EXEMPTION_REQUEST_WINDOW_HOURS * 3600_000;
  const canAppeal = (s: DriverStrike): boolean => {
    const a = appealByStrike.get(s.strikeId);
    const open = a && (a.status === 'Pending TODA Review' || a.status === 'Pending LGU Review');
    return APPEALABLE.has(s.status) && s.pointsActive > 0 && !open && Date.now() <= Date.parse(s.issuedAt) + windowMs;
  };

  const openForm = (s: DriverStrike) => {
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
      const result = await submitStrikeAppeal(target.strikeId, cause, justification);
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      setTarget(null);
      setToast(
        result.assignedRole === 'lgu_admin'
          ? (tl ? 'Naipadala ang apela sa LGU Administrator.' : 'Your appeal was sent to the LGU Administrator.')
          : (tl ? 'Naipadala ang apela sa TODA Administrator mo.' : 'Your appeal was sent to your TODA Administrator.')
      );
      await load();
    });

  return (
    <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#F8FAFC' }}>
      <SakayToast message={toast} severity="success" onClose={() => setToast(null)} />
      <PageHeader title={tl ? 'Mga Strike at Apela' : 'Strikes & Appeals'} onBack={() => navigate(-1)} />

      <Box className="hide-scrollbar" sx={{ flex: 1, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress size={28} sx={{ color: '#FF6600' }} />
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
              </Typography>
            </Paper>

            {(history?.strikes ?? []).length === 0 && (
              <Typography sx={{ textAlign: 'center', color: '#64748B', fontSize: '13px', p: 3 }}>
                {tl ? 'Wala kang strike.' : 'You have no strikes.'}
              </Typography>
            )}

            {(history?.strikes ?? []).map((s) => {
              const label = STATUS_LABELS[s.status] ?? { en: s.status, tl: s.status, color: 'default' as const };
              const appeal = appealByStrike.get(s.strikeId);
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
                  {appeal && (
                    <Alert severity={appeal.status === 'Denied' ? 'error' : appeal.status.includes('Waiver') ? 'success' : 'info'} sx={{ borderRadius: '10px', fontSize: '12px', py: 0 }}>
                      {tl ? 'Apela: ' : 'Appeal: '}
                      {appeal.status}
                      {appeal.decisionReason ? ` — ${appeal.decisionReason}` : ''}
                    </Alert>
                  )}
                  {canAppeal(s) && (
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
    </Box>
  );
};

export default DriverStrikesPage;
