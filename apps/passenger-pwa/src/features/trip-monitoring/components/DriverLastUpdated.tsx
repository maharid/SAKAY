import React from 'react';
import { Box, Typography } from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { PASSENGER_STALE_LOCATION_INDICATOR_SECONDS } from '@sakay/shared';

interface DriverLastUpdatedProps {
  /** How old the driver's position is by the database's count (null: there is no position to talk about) */
  ageSeconds: number | null;
  /** When the database received that position */
  lastFixAt: string | null;
  language: string;
  /** Distance from the bottom of the screen (px): just above the card that covers the bottom of the map */
  bottom?: number;
}

const manilaClock = (iso: string | null): string => {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', second: '2-digit' });
};

const howOld = (seconds: number, tl: boolean): string => {
  if (seconds < 60) return tl ? `${seconds} s ang nakalipas` : `${seconds} s ago`;
  const minutes = Math.floor(seconds / 60);
  return tl ? `${minutes} min ang nakalipas` : `${minutes} min ago`;
};

/**
 * Rule 17.9: whenever the driver's last position is more than 10 seconds old, the map says WHEN it was taken (the time the database received it, in
 * Manila time) and how long ago, so a tricycle that looks still is not mistaken for one that is live. Nothing is drawn while the position is fresh.
 */
const DriverLastUpdated: React.FC<DriverLastUpdatedProps> = ({ ageSeconds, lastFixAt, language, bottom = 16 }) => {
  if (ageSeconds === null || ageSeconds <= PASSENGER_STALE_LOCATION_INDICATOR_SECONDS) return null;
  const tl = language === 'tl';
  const clock = manilaClock(lastFixAt);
  return (
    <Box
      role="status"
      aria-live="off"
      sx={{
        position: 'absolute',
        left: 12,
        bottom,
        zIndex: 10,
        transition: 'bottom 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1.25,
        py: 0.75,
        maxWidth: 'calc(100% - 84px)',
        borderRadius: '12px',
        backgroundColor: 'rgba(15, 23, 42, 0.88)',
        color: '#FFFFFF',
        boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
      }}
    >
      <AccessTimeIcon sx={{ fontSize: 16, flexShrink: 0 }} />
      <Typography sx={{ fontSize: '11.5px', fontWeight: 600, lineHeight: 1.3, fontFamily: 'Poppins, sans-serif' }}>
        {tl ? 'Huling update ng lokasyon ng drayber' : 'Driver location last updated'}
        {clock ? ` ${clock}` : ''} ({howOld(ageSeconds, tl)})
      </Typography>
    </Box>
  );
};

export default DriverLastUpdated;
