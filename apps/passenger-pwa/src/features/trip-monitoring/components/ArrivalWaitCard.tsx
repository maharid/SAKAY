import React, { useEffect, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import TimerIcon from '@mui/icons-material/Timer';

import { NO_SHOW_EXTENSION_SECONDS } from '@sakay/shared';

import type { LiveArrivalWait } from '../hooks/useArrivalWait';

interface ArrivalWaitCardProps {
  wait: LiveArrivalWait;
  language: string;
  onExtend: () => void;
  extending: boolean;
}

const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * Rule 10.3: the live countdown the passenger sees once the driver is at the pickup, with the one-time "I'm Almost There".
 * The time left is the database's (it counted from the moment the driver arrived); this only draws it.
 */
const ArrivalWaitCard: React.FC<ArrivalWaitCardProps> = ({ wait, language, onExtend, extending }) => {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const left = Math.max(0, Math.ceil((wait.endsAt - nowMs) / 1000));
  const over = left === 0;
  const extraMinutes = Math.round(NO_SHOW_EXTENSION_SECONDS / 60);

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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <TimerIcon sx={{ color: over ? '#DC2626' : '#D97706', fontSize: 22 }} />
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: '12px', fontWeight: 700, color: '#64748B' }}>
            {language === 'tl' ? 'Naghihintay ang iyong drayber' : 'Your driver is waiting for you'}
          </Typography>
          <Typography sx={{ fontSize: '22px', fontWeight: 900, color: over ? '#B91C1C' : '#92400E', lineHeight: 1.1 }} aria-live="polite">
            {over ? (language === 'tl' ? 'Tapos na ang oras' : 'Time is up') : clock(left)}
          </Typography>
        </Box>
        {!wait.extended && wait.canExtend && !over && (
          <Button
            variant="contained"
            disabled={extending}
            onClick={onExtend}
            sx={{ borderRadius: '12px', backgroundColor: '#FF6B00', fontWeight: 800, textTransform: 'none', '&:hover': { backgroundColor: '#E55F00' } }}
          >
            {language === 'tl' ? 'Papunta Na Ako' : "I'm Almost There"}
          </Button>
        )}
      </Box>
      <Typography sx={{ fontSize: '11.5px', color: over ? '#B91C1C' : '#78350F', fontWeight: 600 }}>
        {over
          ? language === 'tl'
            ? 'Maaaring iulat ng drayber na hindi ka sumakay. Magiging 2 strike ito at makakansela ang booking.'
            : 'The driver can now report that you did not board. The booking would be cancelled and you would get 2 strikes.'
          : wait.extended
          ? language === 'tl'
            ? `Nagamit mo na ang dagdag na ${extraMinutes} minuto. Pakisakay na po agad.`
            : `You have used your extra ${extraMinutes} minutes. Please board as soon as you can.`
          : language === 'tl'
          ? `Sumakay bago matapos ang oras. Maaari kang magdagdag ng ${extraMinutes} minuto nang isang beses.`
          : `Please board before the time runs out. You can add ${extraMinutes} minutes, once.`}
      </Typography>
    </Box>
  );
};

export default ArrivalWaitCard;
