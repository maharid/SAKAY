import React from 'react';
import { Box, Button, CircularProgress, Typography } from '@mui/material';
import TimerIcon from '@mui/icons-material/Timer';

import { NO_SHOW_EXTENSION_SECONDS, formatCountdown } from '@sakay/shared';

import type { LiveArrivalWait } from '../hooks/useArrivalWait';

interface ArrivalWaitCardProps {
  wait: LiveArrivalWait;
  language: string;
  onExtend: () => void;
  extending: boolean;
}

const HIDDEN_FROM_VIEW = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const;

/**
 * Rule 10.3: the live countdown the passenger sees once the driver is at the pickup, with the one-time "I'm Almost There".
 * The end time is the database's (it counted from the moment the driver arrived); this only draws it. The countdown comes from the hook as
 * whole seconds that never go up and an `expired` flag that never flips back, so the card cannot flicker between "0:01" and "Time is up".
 * A screen reader hears the time at 60, 30 and 10 seconds and when it ends, not every second.
 */
const ArrivalWaitCard: React.FC<ArrivalWaitCardProps> = ({ wait, language, onExtend, extending }) => {
  const tl = language === 'tl';
  const over = wait.expired;
  const left = wait.remainingSeconds;
  const extraMinutes = Math.round(NO_SHOW_EXTENSION_SECONDS / 60);

  const spoken = over
    ? tl ? 'Tapos na ang oras' : 'Time is up'
    : left <= 10
    ? tl ? 'Wala pang 10 segundo ang natitira' : 'Less than 10 seconds left'
    : left <= 30
    ? tl ? 'Wala pang 30 segundo ang natitira' : 'Less than 30 seconds left'
    : left <= 60
    ? tl ? 'Wala pang isang minuto ang natitira' : 'Less than a minute left'
    : '';

  return (
    <Box
      sx={{
        p: '12px 14px',
        borderRadius: '16px',
        backgroundColor: over ? '#FEF2F2' : '#FFFBEB',
        border: `1.5px solid ${over ? '#FCA5A5' : '#FCD34D'}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <TimerIcon aria-hidden sx={{ color: over ? '#B91C1C' : '#B45309', fontSize: 26, flexShrink: 0 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>
            {tl ? 'Naghihintay ang iyong drayber' : 'Your driver is waiting for you'}
          </Typography>
          <Typography role="timer" aria-live="off" sx={{ fontSize: '24px', fontWeight: 800, color: over ? '#B91C1C' : '#92400E', lineHeight: 1.15 }}>
            {over ? (tl ? 'Tapos na ang oras' : 'Time is up') : formatCountdown(left)}
          </Typography>
        </Box>
        {!wait.extended && wait.canExtend && !over && (
          <Button
            variant="contained"
            disabled={extending}
            onClick={onExtend}
            sx={{
              flexShrink: 0,
              minHeight: 48,
              px: 2,
              borderRadius: '14px',
              backgroundColor: '#FF6B00',
              color: '#FFFFFF',
              fontWeight: 700,
              fontSize: '14px',
              textTransform: 'none',
              boxShadow: 'none',
              '&:hover': { backgroundColor: '#E66000', boxShadow: 'none' },
            }}
          >
            {extending ? (
              <CircularProgress size={20} color="inherit" aria-label={tl ? 'Idinadagdag' : 'Adding time'} />
            ) : tl ? (
              'Papunta Na Ako'
            ) : (
              "I'm Almost There"
            )}
          </Button>
        )}
      </Box>
      <Typography sx={{ fontSize: '12px', color: over ? '#991B1B' : '#78350F', fontWeight: 500, lineHeight: 1.45 }}>
        {over
          ? tl
            ? 'Maaaring iulat ng drayber na hindi ka sumakay. Magiging 2 strike ito at makakansela ang booking.'
            : 'The driver can now report that you did not board. The booking would be cancelled and you would get 2 strikes.'
          : wait.extended
          ? tl
            ? `Nagamit mo na ang dagdag na ${extraMinutes} minuto. Pakisakay na po agad.`
            : `You have used your extra ${extraMinutes} minutes. Please board as soon as you can.`
          : tl
          ? `Sumakay bago matapos ang oras. Maaari kang magdagdag ng ${extraMinutes} minuto nang isang beses.`
          : `Please board before the time runs out. You can add ${extraMinutes} minutes, once.`}
      </Typography>
      <Box component="span" role="status" aria-live="polite" sx={HIDDEN_FROM_VIEW}>
        {spoken}
      </Box>
    </Box>
  );
};

export default ArrivalWaitCard;
