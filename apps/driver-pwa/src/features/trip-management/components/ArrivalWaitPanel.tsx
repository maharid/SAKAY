import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import TimerIcon from '@mui/icons-material/Timer';
import { PICKUP_ZONE_RADIUS_METERS, formatCountdown, monotonicNow, useServerCountdown } from '@sakay/shared';

import { readArrivalWait, reportPassengerNoShow, type ArrivalWait } from '../../../services/bookingClockService';

interface ArrivalWaitPanelProps {
  bookingId: string;
  language: string;
  /** The no-show was recorded: the booking is over (the screen leaves the trip) */
  onNoShowReported: () => void;
  onMessage: (message: string) => void;
}

const POLL_MS = 3000;

/**
 * Rule 10: the driver has arrived and the passenger has a fixed time to board. The database counts it (from the moment it recorded the
 * arrival, plus the passenger's one "I'm Almost There"); this panel draws the countdown and offers Passenger No-Show once the database says
 * both that the time is up and that the driver is really at the pickup.
 *
 * The countdown has ONE end time per deadline (ServerDeadlineClock in @sakay/shared), the same as on the passenger's screen: a late or overlapping
 * answer cannot restart it, it never shows a negative value, and once ended it stays ended until the database names a later deadline.
 */
const ArrivalWaitPanel: React.FC<ArrivalWaitPanelProps> = ({ bookingId, language, onNoShowReported, onMessage }) => {
  const [wait, setWait] = useState<ArrivalWait | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const countdown = useServerCountdown(bookingId, Boolean(bookingId));
  const { beginRequest, apply } = countdown;

  useEffect(() => {
    if (!bookingId) return;
    let stopped = false;
    const read = async () => {
      const request = beginRequest();
      const reading = await readArrivalWait(bookingId);
      if (stopped || reading.state === 'unavailable') return; // a failed read changes nothing: the countdown keeps running from what is known
      if (reading.state === 'idle') {
        setWait(null);
        return;
      }
      setWait(reading.wait);
      apply({
        sequence: request.sequence,
        sentAt: request.sentAt,
        receivedAt: monotonicNow(),
        deadlineMs: reading.wait.deadlineMs,
        serverNowMs: reading.wait.serverNowMs,
        secondsRemaining: reading.wait.secondsRemaining,
      });
    };
    read();
    const poll = setInterval(read, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(poll);
    };
  }, [bookingId, beginRequest, apply]);

  if (!wait || !countdown.hasValue) return null;

  const left = countdown.remainingSeconds;
  const over = countdown.expired;

  const confirmNoShow = async () => {
    setReporting(true);
    const result = await reportPassengerNoShow(bookingId);
    setReporting(false);
    setConfirmOpen(false);
    if (!result.ok) {
      onMessage(result.error || (language === 'tl' ? 'Hindi naiulat ang no-show.' : 'The no-show could not be reported.'));
      return;
    }
    onNoShowReported();
  };

  return (
    <Box
      sx={{
        p: '12px 14px',
        borderRadius: '14px',
        backgroundColor: over ? '#FEF2F2' : '#FFFBEB',
        border: `1.5px solid ${over ? '#FCA5A5' : '#FCD34D'}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <TimerIcon sx={{ color: over ? '#DC2626' : '#D97706', fontSize: 22 }} />
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>
            {language === 'tl' ? 'Oras ng paghihintay sa pasahero' : "Passenger's waiting time"}
          </Typography>
          <Typography role="timer" aria-live="off" sx={{ fontSize: '24px', fontWeight: 700, color: over ? '#B91C1C' : '#92400E', lineHeight: 1.15 }}>
            {over ? (language === 'tl' ? 'Tapos na ang oras' : 'Time is up') : formatCountdown(left)}
          </Typography>
        </Box>
      </Box>
      {wait.extended && !over && (
        <Typography sx={{ fontSize: '12px', color: '#78350F', fontWeight: 600 }}>
          {language === 'tl' ? 'Humingi ang pasahero ng dagdag na 2 minuto ("Papunta Na Ako").' : 'The passenger asked for 2 more minutes ("I\'m Almost There").'}
        </Typography>
      )}
      {wait.pausedSeconds > 0 && (
        <Typography sx={{ fontSize: '12px', color: '#78350F', fontWeight: 600 }}>
          {language === 'tl'
            ? `Na-pause ang oras nang ${wait.pausedSeconds} segundo habang wala ka sa pickup point.`
            : `The timer was paused for ${wait.pausedSeconds} s while you were away from the pickup point.`}
        </Typography>
      )}
      {over && !wait.canReportNoShow && (
        <Typography sx={{ fontSize: '12px', color: '#B91C1C', fontWeight: 600 }}>
          {language === 'tl'
            ? `Para maiulat ito, dapat nasa loob ka ng ${PICKUP_ZONE_RADIUS_METERS} m ng pickup point at malinaw ang GPS.`
            : `To report it, be within ${PICKUP_ZONE_RADIUS_METERS} m of the pickup point with a clear GPS signal.`}
        </Typography>
      )}
      <Button
        variant="outlined"
        color="error"
        fullWidth
        disabled={!wait.canReportNoShow || reporting}
        onClick={() => setConfirmOpen(true)}
        sx={{ minHeight: 44, borderRadius: '12px', textTransform: 'none', fontWeight: 700, fontSize: '14px', lineHeight: 1.25 }}
      >
        {language === 'tl' ? 'Hindi sumakay ang pasahero' : 'Passenger did not board'}
      </Button>

      <Dialog open={confirmOpen} onClose={() => !reporting && setConfirmOpen(false)} slotProps={{ paper: { sx: { borderRadius: '20px', p: 1 } } }}>
        <DialogTitle sx={{ fontWeight: 700, fontSize: '17px', textAlign: 'center' }}>
          {language === 'tl' ? 'Iulat ang no-show?' : 'Report a no-show?'}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '14px', color: '#475569', textAlign: 'center' }}>
            {language === 'tl'
              ? 'Makakansela ang booking at 2 strike ang ibibigay sa pasahero. Hindi na ito mababawi. Kumpirmahin lamang kung talagang hindi siya sumakay.'
              : 'The booking will be cancelled and the passenger will get 2 strikes. This cannot be undone. Confirm only if the passenger really did not board.'}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 2, pb: 2, flexDirection: 'column', gap: 1 }}>
          <Button
            fullWidth
            variant="contained"
            color="error"
            disabled={reporting}
            onClick={confirmNoShow}
            sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 700, height: 44 }}
          >
            {reporting ? (language === 'tl' ? 'Isinusumite...' : 'Reporting...') : language === 'tl' ? 'Oo, iulat ang no-show' : 'Yes, report the no-show'}
          </Button>
          <Button fullWidth disabled={reporting} onClick={() => setConfirmOpen(false)} sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 700 }}>
            {language === 'tl' ? 'Bumalik' : 'Go back'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ArrivalWaitPanel;
