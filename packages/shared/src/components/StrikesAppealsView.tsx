import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Paper, Typography } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { EXEMPTION_REQUEST_WINDOW_HOURS } from '../config/policyConfig';
import type { ExemptionCauseCode } from '../config/policyConfig';
import { useInFlight } from '../hooks/useInFlight';
import { activateWithKeyboard } from '../utils/a11y';
import { appealOutcome, appealReviewer, newestAppealByStrike, strikeAppealEligibility } from '../utils/strikeAppeals';
import type { AppealResult, AppealRow, StrikeHistory, StrikeRow } from '../utils/strikeAppeals';
import { strikeLevel, strikeLevelName, strikeNextStepText } from '../utils/strikeLevel';
import { messageForLanguage } from '../utils/notificationLocalization';
import { DRIVER_CANCEL_LABELS } from '../utils/cancellationReasons';
import { APPEAL_CAUSE_LABELS, AppealFormDialog } from './AppealFormDialog';

export interface StrikesAppealsViewProps {
  language: 'tl' | 'en';
  /** whose strikes these are: only changes the wording about who reviews an appeal */
  audience: 'passenger' | 'driver';
  history: StrikeHistory | null;
  appeals: AppealRow[];
  loading: boolean;
  /** the strikes could not be read */
  failed: boolean;
  /** send an appeal with up to three photos as evidence (Rule 25.2); the database's answer comes back as it is */
  onAppeal: (strikeId: string, cause: ExemptionCauseCode, justification: string, files: File[]) => Promise<AppealResult>;
  /** an appeal was sent: the screen reloads its data and shows `message` */
  onAppealSent: (message: string) => void | Promise<void>;
  /** a notice asked for an appeal form: a strike's id, or '1' for the first strike that can still be appealed (the "Want to Appeal?" action) */
  openAppealFor?: string | null;
  /** the request above was dealt with (the form opened, or the reason it could not was shown): the screen drops it from its address so a reload does not repeat it */
  onOpenAppealHandled?: () => void;
}

type Tone = 'red' | 'amber' | 'green' | 'slate';
const TONES: Record<Tone, { background: string; color: string }> = {
  red: { background: '#FEE2E2', color: '#B91C1C' },
  amber: { background: '#FEF3C7', color: '#92400E' },
  green: { background: '#DCFCE7', color: '#166534' },
  slate: { background: '#F1F5F9', color: '#475569' },
};

const STRIKE_STATUS: Record<string, { en: string; tl: string; tone: Tone }> = {
  PROVISIONAL: { en: 'Provisional', tl: 'Pansamantala', tone: 'amber' },
  ACTIVE: { en: 'Active', tl: 'Aktibo', tone: 'red' },
  PARTIALLY_WAIVED: { en: 'Partly waived', tl: 'Bahagyang inalis', tone: 'amber' },
  WAIVED: { en: 'Waived', tl: 'Inalis', tone: 'green' },
  AUTO_WAIVED: { en: 'Exempt', tl: 'Exempted', tone: 'green' },
  OBSERVED: { en: 'Recorded', tl: 'Naitala', tone: 'slate' },
  VOIDED: { en: 'Cancelled', tl: 'Kinansela', tone: 'slate' },
};

const OUTCOME: Record<'pending' | 'approved' | 'rejected', { en: string; tl: string; tone: Tone }> = {
  pending: { en: 'Pending', tl: 'Naghihintay', tone: 'amber' },
  approved: { en: 'Approved', tl: 'Aprubado', tone: 'green' },
  rejected: { en: 'Rejected', tl: 'Tinanggihan', tone: 'red' },
};

const REVIEWER = {
  toda: { en: 'TODA Administrator', tl: 'TODA Administrator' },
  lgu: { en: 'LGU Administrator', tl: 'LGU Administrator' },
  system: { en: 'SAKAY (automatic)', tl: 'SAKAY (awtomatiko)' },
};

const manila = (iso: string, withTime = true): string =>
  new Date(iso).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });

const cardSx = {
  p: 2,
  borderRadius: '16px',
  border: '1px solid #E2E8F0',
  backgroundColor: '#FFFFFF',
  display: 'flex',
  flexDirection: 'column',
  gap: 1.5,
  boxShadow: '0 1px 3px rgba(15,23,42,0.03)',
} as const;

const Badge: React.FC<{ tone: Tone; children: React.ReactNode }> = ({ tone, children }) => (
  <Box
    component="span"
    sx={{
      display: 'inline-flex',
      alignItems: 'center',
      height: 24,
      px: '10px',
      borderRadius: '999px',
      fontSize: '11.5px',
      fontWeight: 700,
      fontFamily: 'Poppins, sans-serif',
      whiteSpace: 'nowrap',
      flexShrink: 0,
      ...TONES[tone],
    }}
  >
    {children}
  </Box>
);

/** One labelled fact of an appeal ("Submitted", "Reviewed by") */
const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '11.5px', fontWeight: 600, color: '#64748B' }}>{label}</Typography>
    <Typography component="div" sx={{ fontSize: '13px', color: '#0F172A', lineHeight: 1.45, overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}>
      {children}
    </Typography>
  </Box>
);

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography component="h2" sx={{ fontSize: '14px', fontWeight: 700, color: '#0F172A', fontFamily: 'Poppins, sans-serif' }}>
    {children}
  </Typography>
);

/**
 * Rules 20 / 21 and 25: the strikes of the signed-in person and the way to appeal one within 48 hours of its issue. Three parts: a summary (how many strikes count and where that
 * puts the account on the strike ladder), the strike history, and the appeals with their decisions. The same screen serves passengers (an appeal goes to the LGU Administrator,
 * 25.5) and drivers (to the TODA Administrator, 25.4); the database routes it, decides what can be appealed and, when an appeal is approved, updates the strike. The page that holds
 * this view brings its own header, toast and data.
 */
export const StrikesAppealsView: React.FC<StrikesAppealsViewProps> = ({ language, audience, history, appeals, loading, failed, onAppeal, onAppealSent, openAppealFor = null, onOpenAppealHandled }) => {
  const tl = language === 'tl';
  // A text of the strike as the person should read it: one language, no rule or item numbers, and a reason code spelled out ("vehicle_breakdown" is "Vehicle breakdown")
  const readable = (text: string | null | undefined): string =>
    messageForLanguage(text, language).replace(/[a-z]+(?:_[a-z]+)+/g, (code) =>
      code in DRIVER_CANCEL_LABELS ? DRIVER_CANCEL_LABELS[code as keyof typeof DRIVER_CANCEL_LABELS][language] : code.replace(/_/g, ' ')
    );
  const flight = useInFlight();

  const [tab, setTab] = useState<'strikes' | 'appeals'>('strikes');
  const [target, setTarget] = useState<StrikeRow | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const handledRequest = useRef<string | null>(null);

  const strikes = history?.strikes ?? [];
  const appealByStrike = useMemo(() => newestAppealByStrike(appeals), [appeals]);
  const strikeById = useMemo(() => new Map(strikes.map((s) => [s.strikeId, s])), [strikes]);
  const active = history?.activeStrikes ?? 0;
  const level = strikeLevel(active);
  const pendingAppeals = appeals.filter((a) => appealOutcome(a.status) === 'pending').length;

  const openForm = (s: StrikeRow) => {
    setFormError(null);
    setTarget(s);
  };

  // "Want to Appeal?" in a notice: open the form of that strike; when it can no longer be appealed, show the strike and why
  useEffect(() => {
    if (loading || failed || !history || !openAppealFor || handledRequest.current === openAppealFor) return;
    handledRequest.current = openAppealFor;
    const eligible = (s: StrikeRow) => strikeAppealEligibility(s, appealByStrike.get(s.strikeId)).can;
    const wanted = openAppealFor === '1' ? strikes.find(eligible) : strikes.find((s) => s.strikeId === openAppealFor);
    setTab('strikes');
    if (wanted && eligible(wanted)) {
      openForm(wanted);
    } else if (wanted) {
      setHighlight(wanted.strikeId);
    } else {
      setNotice(tl ? 'Walang strike na maaaring apelahan ngayon. Nasa ilalim ng bawat strike ang dahilan.' : 'None of your strikes can be appealed right now. The reason is shown under each strike.');
    }
    onOpenAppealHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, failed, history, openAppealFor, appeals]);

  useEffect(() => {
    if (!highlight) return;
    document.getElementById(`strike-${highlight}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlight, tab]);

  const send = (cause: ExemptionCauseCode, justification: string, files: File[]) =>
    flight.run(async () => {
      if (!target) return;
      const result = await onAppeal(target.strikeId, cause, justification, files);
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      setTarget(null);
      await onAppealSent(
        result.autoDenied
          ? (tl ? 'Naitala ang apela pero awtomatiko itong tinanggihan: ginamit mo na ang dahilang ito nang ilang beses.' : 'Your appeal was recorded but denied automatically: this cause has been used several times already.')
          : result.assignedRole === 'lgu_admin'
            ? (tl ? 'Naipadala ang apela sa LGU Administrator.' : 'Your appeal was sent to the LGU Administrator.')
            : (tl ? 'Naipadala ang apela sa TODA Administrator mo.' : 'Your appeal was sent to your TODA Administrator.')
      );
    });

  const strikeTitle = (s: StrikeRow | undefined): string => (s ? readable(s.description) : 'Strike');

  // These three are called as functions, not rendered as components: a component defined inside this one would be a new type on every render and remount its rows
  const summaryCard = () => (
    <Paper elevation={0} sx={{ ...cardSx, gap: 1.5 }}>
      <SectionTitle>{tl ? 'Buod ng strike' : 'Strike summary'}</SectionTitle>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'stretch' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '11.5px', fontWeight: 600, color: '#64748B' }}>{tl ? 'Aktibong strike' : 'Active strikes'}</Typography>
          <Typography sx={{ fontSize: '30px', fontWeight: 700, color: '#0F172A', lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>
            {active}
            <Box component="span" sx={{ fontSize: '14px', fontWeight: 600, color: '#64748B' }}> / {level.max}</Box>
          </Typography>
        </Box>
        <Box sx={{ width: '1px', backgroundColor: '#EEF1F5' }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '11.5px', fontWeight: 600, color: '#64748B' }}>{tl ? 'Antas ng strike' : 'Strike level'}</Typography>
          <Typography sx={{ fontSize: '15px', fontWeight: 700, color: level.tier === 0 ? '#166534' : level.tier <= 2 ? '#92400E' : '#B91C1C', lineHeight: 1.3, mt: '6px' }}>
            {strikeLevelName(level.tier, language)}
          </Typography>
        </Box>
      </Box>
      <Box role="progressbar" aria-valuemin={0} aria-valuemax={level.max} aria-valuenow={Math.min(active, level.max)} aria-label={tl ? 'Aktibong strike' : 'Active strikes'} sx={{ height: 6, borderRadius: '3px', backgroundColor: '#EEF1F5', overflow: 'hidden' }}>
        <Box sx={{ height: '100%', width: `${Math.min(100, (active / level.max) * 100)}%`, backgroundColor: level.tier === 0 ? '#16A34A' : level.tier <= 2 ? '#F59E0B' : '#DC2626' }} />
      </Box>
      <Typography sx={{ fontSize: '12.5px', color: '#334155', lineHeight: 1.45 }}>{strikeNextStepText(level, active, language)}</Typography>
      <Typography sx={{ fontSize: '11.5px', color: '#64748B', lineHeight: 1.45 }}>
        {tl
          ? `Binibilang ang strike sa nakaraang ${history?.windowDays ?? 90} araw. May ${EXEMPTION_REQUEST_WINDOW_HOURS} oras ka mula nang ibigay ang strike para mag-apela.`
          : `Strikes count for ${history?.windowDays ?? 90} days. You have ${EXEMPTION_REQUEST_WINDOW_HOURS} hours from the moment a strike is issued to appeal it.`}{' '}
        {audience === 'passenger'
          ? (tl ? 'Ang LGU Administrator ang magpapasya sa iyong apela.' : 'The LGU Administrator decides your appeal.')
          : (tl ? 'Ang TODA Administrator mo ang unang magpapasya sa apela.' : 'Your TODA Administrator decides your appeal first.')}
      </Typography>
    </Paper>
  );

  const strikeCard = (s: StrikeRow) => {
    const status = STRIKE_STATUS[s.status] ?? { en: s.status, tl: s.status, tone: 'slate' as Tone };
    const appeal = appealByStrike.get(s.strikeId);
    const eligibility = strikeAppealEligibility(s, appeal);
    const outcome = appeal ? appealOutcome(appeal.status) : null;
    const reviewer = appeal ? appealReviewer(appeal) : null;
    const appealCause = appeal ? APPEAL_CAUSE_LABELS[appeal.causeCode as ExemptionCauseCode] : null;
    const reason = eligibility.can === true ? null : eligibility.why;
    const why =
      reason === 'window-passed'
        ? (tl
            ? `Natapos na ang ${EXEMPTION_REQUEST_WINDOW_HOURS} oras na pag-aapela${eligibility.until ? ` noong ${manila(new Date(eligibility.until).toISOString())}` : ''}.`
            : `The ${EXEMPTION_REQUEST_WINDOW_HOURS}-hour window to appeal ended${eligibility.until ? ` on ${manila(new Date(eligibility.until).toISOString())}` : ''}.`)
        : reason === 'not-counting' && !appeal
          ? (tl ? 'Hindi na nabibilang ang strike na ito, kaya walang aapelahan.' : 'This strike no longer counts, so there is nothing to appeal.')
          : null;
    return (
      <Paper
        id={`strike-${s.strikeId}`}
        elevation={0}
        sx={{
          ...cardSx,
          ...(highlight === s.strikeId
            ? { borderColor: '#FF6600', boxShadow: '0 0 0 3px rgba(255,102,0,0.18)' }
            : {}),
        }}
      >
        {/* Header: Violation Title and Status Badge */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1.5 }}>
          <Typography
            sx={{
              fontSize: '15px',
              fontWeight: 700,
              color: '#0F172A',
              fontFamily: 'Poppins, sans-serif',
              lineHeight: 1.35,
              minWidth: 0,
              overflowWrap: 'anywhere',
            }}
          >
            {readable(s.description)}
          </Typography>
          <Badge tone={status.tone}>{tl ? status.tl : status.en}</Badge>
        </Box>

        {/* Metadata: Date and Points */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
            <CalendarTodayIcon sx={{ fontSize: 13, color: '#94A3B8' }} />
            <Typography sx={{ fontSize: '12px', fontWeight: 500, color: '#64748B', fontFamily: 'Poppins, sans-serif' }}>
              {manila(s.issuedAt)}
            </Typography>
          </Box>
          <Typography sx={{ color: '#CBD5E1', fontSize: '12px' }}>·</Typography>
          <Box
            component="span"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              px: '7px',
              py: '1.5px',
              borderRadius: '6px',
              backgroundColor: s.pointsActive > 0 ? '#FFF7ED' : '#F1F5F9',
              color: s.pointsActive > 0 ? '#C2410C' : '#64748B',
              fontSize: '11px',
              fontWeight: 700,
              fontFamily: 'Poppins, sans-serif',
            }}
          >
            {s.pointsActive}/{s.pointsIssued} {tl ? 'puntos' : 'point(s)'}
          </Box>
        </Box>

        {/* Reported Reason / Violation Details Block */}
        {s.reason && (
          <Box
            sx={{
              p: '10px 12px',
              borderRadius: '10px',
              backgroundColor: '#F8FAFC',
              border: '1px solid #EEF2F6',
            }}
          >
            <Typography
              sx={{
                fontSize: '11px',
                fontWeight: 600,
                color: '#64748B',
                fontFamily: 'Poppins, sans-serif',
                textTransform: 'uppercase',
                letterSpacing: '0.4px',
                mb: 0.25,
              }}
            >
              {tl ? 'Dahilan ng ulat / pagkakansela:' : 'Reported reason / details:'}
            </Typography>
            <Typography
              sx={{
                fontSize: '13px',
                fontWeight: 500,
                color: '#1E293B',
                fontFamily: 'Poppins, sans-serif',
                lineHeight: 1.4,
                overflowWrap: 'anywhere',
              }}
            >
              {readable(s.reason)}
            </Typography>
          </Box>
        )}

        {/* Provisional Note */}
        {s.status === 'PROVISIONAL' && s.provisionalUntil && (
          <Box
            sx={{
              p: '8px 12px',
              borderRadius: '8px',
              backgroundColor: '#FEF3C7',
              color: '#92400E',
              display: 'flex',
              gap: 0.75,
              alignItems: 'center',
            }}
          >
            <InfoOutlinedIcon sx={{ fontSize: 16, flexShrink: 0 }} />
            <Typography sx={{ fontSize: '12px', fontWeight: 600, fontFamily: 'Poppins, sans-serif' }}>
              {tl
                ? `Maaaring alisin kung hihilingin bago ${manila(s.provisionalUntil)}.`
                : `May be waived if requested before ${manila(s.provisionalUntil)}.`}
            </Typography>
          </Box>
        )}

        {/* Appeal Status Section (when an appeal has been submitted) */}
        {appeal && outcome && (
          <Box
            sx={{
              p: 1.5,
              borderRadius: '12px',
              border: '1px solid',
              borderColor:
                outcome === 'pending'
                  ? '#FDE68A'
                  : outcome === 'approved'
                    ? '#BBF7D0'
                    : '#FECACA',
              backgroundColor:
                outcome === 'pending'
                  ? '#FFFBEB'
                  : outcome === 'approved'
                    ? '#F0FDF4'
                    : '#FEF2F2',
              display: 'flex',
              flexDirection: 'column',
              gap: 0.75,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
              <Badge tone={OUTCOME[outcome].tone}>
                {outcome === 'pending'
                  ? reviewer === 'toda'
                    ? tl ? 'Apela: Sinusuri ng TODA' : 'Appeal: Pending TODA Review'
                    : reviewer === 'lgu'
                      ? tl ? 'Apela: Sinusuri ng LGU' : 'Appeal: Pending LGU Review'
                      : tl ? `Apela: ${OUTCOME[outcome].tl}` : `Appeal: ${OUTCOME[outcome].en}`
                  : tl ? `Apela: ${OUTCOME[outcome].tl}` : `Appeal: ${OUTCOME[outcome].en}`}
              </Badge>
              <Typography sx={{ fontSize: '11px', color: '#64748B', fontFamily: 'Poppins, sans-serif' }}>
                {tl ? 'Ipinadala:' : 'Submitted:'} {manila(appeal.requestedAt)}
              </Typography>
            </Box>

            {appealCause && (
              <Typography sx={{ fontSize: '12px', fontWeight: 600, color: '#334155', fontFamily: 'Poppins, sans-serif' }}>
                {tl ? 'Dahilan:' : 'Cause:'}{' '}
                <Box component="span" sx={{ fontWeight: 700, color: '#0F172A' }}>
                  {tl ? appealCause.tl : appealCause.en}
                </Box>
              </Typography>
            )}

            {outcome === 'pending' ? (
              <>
                {appeal.decisionDueAt && (
                  <Typography sx={{ fontSize: '11.5px', color: '#B45309', fontFamily: 'Poppins, sans-serif' }}>
                    {tl
                      ? `Inaasahang desisyon bago ang ${manila(appeal.decisionDueAt, false)}`
                      : `Decision expected by ${manila(appeal.decisionDueAt, false)}`}
                  </Typography>
                )}
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.6, pt: 0.25 }}>
                  <InfoOutlinedIcon sx={{ fontSize: 14, color: '#B45309', mt: '2px', flexShrink: 0 }} />
                  <Typography sx={{ fontSize: '11.5px', color: '#B45309', lineHeight: 1.4, fontFamily: 'Poppins, sans-serif' }}>
                    {tl
                      ? 'Kasalukuyang naghihintay ng desisyon. Hindi maaaring magsumite ng panibagong apela habang may nakabinbin.'
                      : 'Appeal is currently under review. Duplicate appeals cannot be submitted while an appeal is pending.'}
                  </Typography>
                </Box>
              </>
            ) : outcome === 'approved' ? (
              <Typography sx={{ fontSize: '12.5px', fontWeight: 600, color: '#166534', fontFamily: 'Poppins, sans-serif' }}>
                {appeal.status === 'Full Waiver'
                  ? tl ? 'Inalis ang strike.' : 'The strike was removed.'
                  : tl ? 'Bahagyang inalis ang strike.' : 'The strike was partly removed.'}
              </Typography>
            ) : (
              <Typography sx={{ fontSize: '12.5px', fontWeight: 600, color: '#B91C1C', fontFamily: 'Poppins, sans-serif' }}>
                {tl ? 'Nananatili ang strike.' : 'The strike stays.'}
                {appeal.decisionReason && (
                  <Box component="span" sx={{ display: 'block', fontWeight: 400, fontSize: '12px', color: '#475569', mt: 0.25 }}>
                    {readable(appeal.decisionReason)}
                  </Box>
                )}
              </Typography>
            )}
          </Box>
        )}

        {/* Eligible for Appeal: Display Appeal Strike button directly inside the strike card */}
        {eligibility.can && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, pt: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <AccessTimeIcon sx={{ fontSize: 15, color: '#C2410C', flexShrink: 0 }} />
              <Typography sx={{ fontSize: '12px', fontWeight: 600, color: '#C2410C', fontFamily: 'Poppins, sans-serif' }}>
                {tl
                  ? `Maaaring mag-apela hanggang ${manila(new Date(eligibility.until).toISOString())}`
                  : `Eligible for appeal until ${manila(new Date(eligibility.until).toISOString())}`}
              </Typography>
            </Box>
            <Button
              variant="contained"
              fullWidth
              disableElevation
              onClick={() => openForm(s)}
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                fontFamily: 'Poppins, sans-serif',
                fontSize: '14px',
                borderRadius: '12px',
                minHeight: 44,
                height: 44,
                backgroundColor: '#FF6600',
                color: '#FFFFFF',
                boxShadow: 'none',
                '&:hover': { backgroundColor: '#E65C00', boxShadow: 'none' },
              }}
            >
              {tl ? 'Iapela ang Strike' : 'Appeal Strike'}
            </Button>
          </Box>
        )}

        {/* Ineligible Explanation directly inside the card */}
        {!eligibility.can && !appeal && why && (
          <Box
            sx={{
              display: 'flex',
              gap: 1,
              alignItems: 'center',
              p: '10px 12px',
              borderRadius: '10px',
              backgroundColor: '#F8FAFC',
              border: '1px solid #E2E8F0',
              color: '#64748B',
            }}
          >
            <InfoOutlinedIcon aria-hidden sx={{ fontSize: 16, color: '#94A3B8', flexShrink: 0 }} />
            <Typography sx={{ fontSize: '12px', lineHeight: 1.45, color: '#64748B', fontFamily: 'Poppins, sans-serif' }}>
              {why}
            </Typography>
          </Box>
        )}
      </Paper>
    );
  };

  const appealCard = (a: AppealRow) => {
    const outcome = appealOutcome(a.status);
    const reviewer = appealReviewer(a);
    const strike = strikeById.get(a.strikeId);
    const cause = APPEAL_CAUSE_LABELS[a.causeCode as ExemptionCauseCode];
    const result =
      a.status === 'Full Waiver'
        ? (tl ? 'Inalis ang strike.' : 'The strike was removed.')
        : a.status === 'Partial Waiver'
          ? (tl ? 'Bahagyang inalis ang strike.' : 'The strike was partly removed.')
          : a.status === 'Denied'
            ? (tl ? 'Nananatili ang strike.' : 'The strike stays.')
            : null;
    return (
      <Paper elevation={0} sx={cardSx}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
          <Typography sx={{ fontSize: '15px', fontWeight: 700, color: '#0F172A', fontFamily: 'Poppins, sans-serif', lineHeight: 1.35, minWidth: 0, overflowWrap: 'anywhere' }}>
            {strikeTitle(strike)}
          </Typography>
          <Badge tone={OUTCOME[outcome].tone}>{tl ? OUTCOME[outcome].tl : OUTCOME[outcome].en}</Badge>
        </Box>
        {result && (
          <Typography sx={{ fontSize: '12.5px', fontWeight: 600, color: outcome === 'approved' ? '#166534' : '#B91C1C', fontFamily: 'Poppins, sans-serif' }}>
            {result}
          </Typography>
        )}
        <Fact label={tl ? 'Ipinadala noong' : 'Submitted'}>{manila(a.requestedAt)}</Fact>
        <Fact label={tl ? 'Dahilan ng apela' : 'Reason submitted'}>
          {cause ? <b>{tl ? cause.tl : cause.en}</b> : null}
          {cause && a.justification ? '\n' : null}
          {a.justification}
        </Fact>
        {reviewer && <Fact label={tl ? 'Nagsusuri' : 'Reviewing authority'}>{tl ? REVIEWER[reviewer].tl : REVIEWER[reviewer].en}</Fact>}
        {outcome === 'pending' ? (
          a.decisionDueAt && <Fact label={tl ? 'Inaasahang desisyon' : 'Decision due'}>{manila(a.decisionDueAt, false)}</Fact>
        ) : (
          <>
            {a.decidedAt && <Fact label={tl ? 'Petsa ng desisyon' : 'Decision date'}>{manila(a.decidedAt)}</Fact>}
            <Fact label={tl ? 'Puna ng nagsuri' : 'Reviewer remarks'}>{a.decisionReason ? readable(a.decisionReason) : tl ? 'Walang isinulat na puna.' : 'No remarks were written.'}</Fact>
          </>
        )}
      </Paper>
    );
  };

  const tabs: Array<{ key: 'strikes' | 'appeals'; label: string; count: number }> = [
    { key: 'strikes', label: tl ? 'Kasaysayan ng strike' : 'Strike history', count: strikes.length },
    { key: 'appeals', label: tl ? 'Mga apela' : 'Appeals', count: appeals.length },
  ];

  return (
    <>
      <Box
        className="hide-scrollbar"
        sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 2, pb: 'calc(var(--safe-area-bottom) + 24px)', display: 'flex', flexDirection: 'column', gap: 1.5, '& > *': { flexShrink: 0 } }}
      >
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
            {notice && (
              <Alert severity="info" onClose={() => setNotice(null)} sx={{ borderRadius: '12px', fontSize: '12.5px' }}>
                {notice}
              </Alert>
            )}

            {summaryCard()}

            <Box role="tablist" aria-label={tl ? 'Mga strike at apela' : 'Strikes and appeals'} sx={{ display: 'flex', gap: '4px', p: '4px', borderRadius: '14px', backgroundColor: '#F1F5F9' }}>
              {tabs.map((t) => {
                const selected = tab === t.key;
                return (
                  <Box
                    key={t.key}
                    role="tab"
                    tabIndex={0}
                    aria-selected={selected}
                    onKeyDown={activateWithKeyboard}
                    onClick={() => setTab(t.key)}
                    sx={{
                      flex: 1,
                      minHeight: 40,
                      px: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 0.75,
                      borderRadius: '11px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: 700,
                      fontFamily: 'Poppins, sans-serif',
                      color: selected ? '#C2410C' : '#475569',
                      backgroundColor: selected ? '#FFFFFF' : 'transparent',
                      boxShadow: selected ? '0 1px 3px rgba(15,23,42,0.12)' : 'none',
                      '&:focus-visible': { outline: '2px solid #E65C00', outlineOffset: 1 },
                    }}
                  >
                    {t.label}
                    <Box component="span" sx={{ minWidth: 20, height: 20, px: '6px', borderRadius: '10px', fontSize: '11.5px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? '#FFEDD5' : '#E2E8F0', color: selected ? '#C2410C' : '#475569' }}>
                      {t.count}
                    </Box>
                  </Box>
                );
              })}
            </Box>

            {tab === 'strikes' ? (
              strikes.length === 0 ? (
                <Typography sx={{ textAlign: 'center', color: '#64748B', fontSize: '13px', p: 3 }}>{tl ? 'Wala kang strike.' : 'You have no strikes.'}</Typography>
              ) : (
                strikes.map((s) => <React.Fragment key={s.strikeId}>{strikeCard(s)}</React.Fragment>)
              )
            ) : appeals.length === 0 ? (
              <Typography sx={{ textAlign: 'center', color: '#64748B', fontSize: '13px', p: 3 }}>{tl ? 'Wala ka pang ipinadalang apela.' : 'You have not sent any appeals.'}</Typography>
            ) : (
              <>
                {pendingAppeals > 0 && (
                  <Typography sx={{ fontSize: '12px', color: '#92400E', fontWeight: 600 }}>
                    {tl ? `${pendingAppeals} apela ang naghihintay ng desisyon.` : `${pendingAppeals} appeal${pendingAppeals === 1 ? ' is' : 's are'} waiting for a decision.`}
                  </Typography>
                )}
                {appeals.map((a) => <React.Fragment key={a.requestId}>{appealCard(a)}</React.Fragment>)}
              </>
            )}
          </>
        )}
      </Box>

      {target && (
        <AppealFormDialog
          key={target.strikeId}
          open
          language={language}
          audience={audience}
          strikeTitle={readable(target.description)}
          strikeMeta={`${tl ? 'Ibinigay noong' : 'Issued'} ${manila(target.issuedAt)}`}
          deadline={(() => {
            const e = strikeAppealEligibility(target, appealByStrike.get(target.strikeId));
            return e.until ? manila(new Date(e.until).toISOString()) : null;
          })()}
          defaultCause={target.violationCode === 'DRV_CONNECTIVITY_FAILURE' ? 'NETWORK_OUTAGE' : 'OTHER'}
          busy={flight.busy}
          error={formError}
          onClose={() => setTarget(null)}
          onSubmit={send}
        />
      )}
    </>
  );
};

export default StrikesAppealsView;
