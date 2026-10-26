import React from 'react';
import { Box, Typography } from '@mui/material';
import TimerIcon from '@mui/icons-material/Timer';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import { earlyEndReasonLabel, formatCountdown, formatPeso, type TripEndState } from '@sakay/shared';

interface FareConfirmationCardProps {
  language: string;
  /** What the database says about the end of the trip right now (null until the first answer) */
  state: TripEndState | null;
  /** The fare to show before the first answer: the booking row's own */
  fallbackFare: number;
  /** Whole seconds of the confirmation time left (null while it is not running) and whether it has ended */
  secondsLeft: number | null;
  expired: boolean;
  ordinance: string | null;
  /** the sheet is closed: the fare and what to do about it; the basis of the fare and the cash note come with the open sheet */
  compact?: boolean;
}

/**
 * Rules 16.6 / 18.1 / 18.2: the final fare, shown identically to the driver, and what the passenger has to do about it - one prompt, one timer. The fare is the
 * database's (nobody can edit it); Confirm Fare and Report Fare Discrepancy are the two buttons at the bottom of the screen.
 */
const FareConfirmationCard: React.FC<FareConfirmationCardProps> = ({ language, state, fallbackFare, secondsLeft, expired, ordinance, compact = false }) => {
  const tl = language === 'tl';
  const fare = state?.actualFare ?? fallbackFare;
  const answered = Boolean(state?.confirmFareAt);
  const reported = Boolean(state?.fareDiscrepancyAt);
  const early = state?.earlyEnd ?? null;

  const panel = (tone: 'amber' | 'red' | 'green', children: React.ReactNode) => {
    const tones = {
      amber: { bg: '#FFFBEB', border: '#FCD34D', text: '#78350F' },
      red: { bg: '#FEF2F2', border: '#FCA5A5', text: '#991B1B' },
      green: { bg: '#F0FDF4', border: '#86EFAC', text: '#166534' },
    }[tone];
    return (
      <Box role="status" sx={{ p: '12px 14px', borderRadius: '16px', backgroundColor: tones.bg, border: `1.5px solid ${tones.border}`, color: tones.text, display: 'flex', gap: 1.25, alignItems: 'flex-start' }}>
        {children}
      </Box>
    );
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box sx={{ p: compact ? '8px 14px' : 2, borderRadius: '16px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', textAlign: compact ? 'left' : 'center', ...(compact ? { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5 } : {}) }}>
        <Typography sx={{ fontSize: '12px', fontWeight: 600, color: '#64748B' }}>
          {early ? (tl ? 'Pamasahe (tinapos nang maaga)' : 'Fare (trip ended early)') : tl ? 'Opisyal na pamasahe' : 'Official tariff fare'}
        </Typography>
        <Typography data-testid="final-fare" sx={{ fontSize: compact ? '26px' : '30px', fontWeight: 700, lineHeight: 1.2, color: '#FF6600', my: compact ? 0 : 0.5, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {formatPeso(fare)}
        </Typography>
        {!compact && (
        <Typography sx={{ fontSize: '12px', lineHeight: 1.4, color: '#64748B' }}>
          {early
            ? early.kind === 'SAFETY'
              ? tl
                ? 'Pansamantala: ayon sa layong nalakbay. Maaari kang humiling ng pagsusuri.'
                : 'Provisional: based on the distance travelled. You can ask for a review.'
              : early.kind === 'DRIVER'
              ? tl
                ? 'Tinapos ng drayber ang biyahe: layong nalakbay lamang ang sinisingil.'
                : 'The driver ended the trip: you pay only for the distance travelled.'
              : tl
              ? 'Ang mas mataas sa pamasahe noong nag-book ka at sa layong nalakbay.'
              : 'The greater of the fare when you booked and the distance travelled.'
            : ordinance
            ? tl
              ? `Batay sa ${ordinance}`
              : `Based on ${ordinance}`
            : tl
            ? 'Batay sa opisyal na taripa ng Lungsod ng Calapan'
            : 'Based on the official Calapan City tariff'}
        </Typography>
        )}
        {!compact && early?.reason && (
          <Typography sx={{ fontSize: '11px', color: '#94A3B8', mt: 0.5 }}>{earlyEndReasonLabel(early.reason, tl ? 'tl' : 'en')}</Typography>
        )}
      </Box>

      {reported
        ? panel(
            'amber',
            <>
              <ReportProblemIcon aria-hidden sx={{ fontSize: 20, flexShrink: 0, color: '#B45309' }} />
              <Typography sx={{ fontSize: '13px', lineHeight: 1.45, fontWeight: 500 }}>
                {tl
                  ? 'Nai-report na ang pamasahe. Maaari pa ring tapusin ng drayber ang biyahe; susuriin ng TODA Administrator ang hindi pagkakasundo.'
                  : 'The fare was reported. The driver can still finish the trip; the TODA Administrator will review the dispute.'}
              </Typography>
            </>
          )
        : answered
        ? panel(
            'green',
            <>
              <CheckCircleIcon aria-hidden sx={{ fontSize: 20, flexShrink: 0, color: '#16A34A' }} />
              <Typography sx={{ fontSize: '13px', lineHeight: 1.45, fontWeight: 500 }}>
                {tl
                  ? 'Kinumpirma mo ang pamasahe. Ibigay ang bayad sa drayber; kumpleto ang biyahe kapag pinindot niya ang Payment Received.'
                  : 'You confirmed the fare. Pay the driver; the trip is complete when the driver taps Payment Received.'}
              </Typography>
            </>
          )
        : panel(
            expired ? 'red' : 'amber',
            <>
              <TimerIcon aria-hidden sx={{ fontSize: 20, flexShrink: 0, color: expired ? '#B91C1C' : '#B45309' }} />
              <Box sx={compact && !expired ? { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5 } : { flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: '13px', lineHeight: 1.45, fontWeight: 600 }}>
                  {tl ? 'Suriin ang pamasahe, ibigay ang bayad sa drayber, saka pindutin ang Confirm Fare.' : 'Check the fare, pay the driver in cash, then tap Confirm Fare.'}
                </Typography>
                <Typography role="timer" aria-live="off" sx={{ fontSize: expired ? '14px' : '22px', fontWeight: 700, lineHeight: 1.2, mt: compact && !expired ? 0 : 0.5, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                  {expired || secondsLeft === 0
                    ? tl ? 'Tapos na ang oras: maaari nang tapusin ng drayber ang biyahe.' : 'Time is up: the driver can finish the trip now. You can still confirm or report.'
                    : secondsLeft !== null
                    ? formatCountdown(secondsLeft)
                    : ''}
                </Typography>
              </Box>
            </>
          )}

      {!compact && (
      <Typography sx={{ fontSize: '12px', lineHeight: 1.4, color: '#64748B', textAlign: 'center' }}>
        {tl
          ? 'Pera lamang (cash) ang bayad. Ang peke o pinaghihinalaang pekeng pera ay sabihin sa TODA Administrator at, kung kailangan, sa pulisya.'
          : 'Cash only. Counterfeit money is not handled by the app: tell the TODA Administrator and, if needed, the police.'}
      </Typography>
      )}
    </Box>
  );
};

export default FareConfirmationCard;
