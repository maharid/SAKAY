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
      {/* The label has the whole width to itself; below it the time (the thing to read) and, once, the button, wrapping under the time on a narrow phone */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <TimerIcon aria-hidden sx={{ color: over ? '#B91C1C' : '#B45309', fontSize: 20, flexShrink: 0 }} />
        <Typography sx={{ fontSize: '13px', fontWeight: 600, color: '#475569', lineHeight: 1.3 }}>
          {tl ? 'Naghihintay ang iyong drayber' : 'Your driver is waiting for you'}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        <Typography
          role="timer"
          aria-live="off"
          sx={{ fontSize: over ? '22px' : '32px', fontWeight: 700, color: over ? '#B91C1C' : '#92400E', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}
        >
          {over ? (tl ? 'Tapos na ang oras' : 'Time is up') : formatCountdown(left)}
        </Typography>
      </Box>
      <Typography sx={{ fontSize: '13px', color: over ? '#991B1B' : '#78350F', fontWeight: 500, lineHeight: 1.45, mt: 0.5 }}>
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
      {!wait.extended && wait.canExtend && !over && (
        <Button
          variant="contained"
          fullWidth
          disabled={extending}
          onClick={onExtend}
          sx={{
            mt: 1.25,
            minHeight: 46,
            px: 2,
            borderRadius: '14px',
            backgroundColor: '#FF6600',
            color: '#FFFFFF',
            fontWeight: 700,
            fontSize: '14px',
            lineHeight: 1.2,
            textTransform: 'none',
            boxShadow: 'none',
            '&:hover': { backgroundColor: '#E55C00', boxShadow: 'none' },
          }}
        >
          {extending ? (
            <CircularProgress size={20} color="inherit" aria-label={tl ? 'Idinadagdag' : 'Adding time'} />
          ) : tl ? (
            `Malapit na ako (+${extraMinutes} minuto pa)`
          ) : (
            `I'm Almost There (+${extraMinutes} min)`
          )}
        </Button>
      )}
      <Box component="span" role="status" aria-live="polite" sx={HIDDEN_FROM_VIEW}>
        {spoken}
      </Box>
    </Box>
  );
};

export default ArrivalWaitCard;
