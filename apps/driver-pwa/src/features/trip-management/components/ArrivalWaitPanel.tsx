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

import { getArrivalWait, reportPassengerNoShow, type ArrivalWait } from '../../../services/bookingClockService';

interface ArrivalWaitPanelProps {
  bookingId: string;
  language: string;
  /** The no-show was recorded: the booking is over (the screen leaves the trip) */
  onNoShowReported: () => void;
  onMessage: (message: string) => void;
}

const POLL_MS = 3000;
const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * Rule 10: the driver has arrived and the passenger has a fixed time to board. The database counts it (from the moment it recorded the
 * arrival, plus the passenger's one "I'm Almost There"); this panel draws the countdown and offers Passenger No-Show once the database says
 * both that the time is up and that the driver is really at the pickup.
 */
const ArrivalWaitPanel: React.FC<ArrivalWaitPanelProps> = ({ bookingId, language, onNoShowReported, onMessage }) => {
  const [wait, setWait] = useState<(ArrivalWait & { endsAt: number }) | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    if (!bookingId) return;
    let stopped = false;
    const read = async () => {
      const answer = await getArrivalWait(bookingId);
      if (!stopped) setWait(answer ? { ...answer, endsAt: Date.now() + answer.secondsRemaining * 1000 } : null);
    };
    read();
    const poll = setInterval(read, POLL_MS);
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      stopped = true;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [bookingId]);

  if (!wait) return null;

  const left = Math.max(0, Math.ceil((wait.endsAt - nowMs) / 1000));
  const over = left === 0;

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
          <Typography sx={{ fontSize: '11px', fontWeight: 700, color: '#64748B' }}>
            {language === 'tl' ? 'ORAS NG PAGHIHINTAY SA PASAHERO' : "PASSENGER'S WAITING TIME"}
          </Typography>
          <Typography sx={{ fontSize: '22px', fontWeight: 900, color: over ? '#B91C1C' : '#92400E', lineHeight: 1.1 }} aria-live="polite">
            {over ? (language === 'tl' ? 'Tapos na ang oras' : 'Time is up') : clock(left)}
          </Typography>
        </Box>
      </Box>
      {wait.extended && !over && (
        <Typography sx={{ fontSize: '11.5px', color: '#78350F', fontWeight: 600 }}>
          {language === 'tl' ? 'Humingi ang pasahero ng dagdag na 2 minuto ("Papunta Na Ako").' : 'The passenger asked for 2 more minutes ("I\'m Almost There").'}
        </Typography>
      )}
      {over && !wait.canReportNoShow && (
        <Typography sx={{ fontSize: '11.5px', color: '#B91C1C', fontWeight: 600 }}>
          {language === 'tl'
            ? 'Para maiulat ang no-show, dapat nasa pickup point ka at malinaw ang GPS.'
            : 'To report a no-show you must be at the pickup point with a clear GPS signal.'}
        </Typography>
      )}
      <Button
        variant="outlined"
        color="error"
        fullWidth
        disabled={!wait.canReportNoShow || reporting}
        onClick={() => setConfirmOpen(true)}
        sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 800 }}
      >
        {language === 'tl' ? 'Hindi Sumakay ang Pasahero (No-Show)' : 'Passenger No-Show'}
      </Button>

      <Dialog open={confirmOpen} onClose={() => !reporting && setConfirmOpen(false)} slotProps={{ paper: { sx: { borderRadius: '20px', p: 1 } } }}>
        <DialogTitle sx={{ fontWeight: 800, fontSize: '17px', textAlign: 'center' }}>
          {language === 'tl' ? 'Iulat ang no-show?' : 'Report a no-show?'}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '13.5px', color: '#475569', textAlign: 'center' }}>
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
            sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 800, height: 44 }}
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
