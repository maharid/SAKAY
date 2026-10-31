import React from 'react';
import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';

export interface TripProgressBarProps {
  /** Whole percent, 0-100 */
  percent: number;
  /** "Trip progress" in the screen's language */
  label: string;
  /** The lines under the bar ("Remaining: 1.2 km", "ETA ~4 min"), already in the screen's language */
  detailLeft?: React.ReactNode;
  detailRight?: React.ReactNode;
}

/**
 * The trip's progress bar, the same in the Passenger and the Driver app. It sits in the always-visible part of the bottom card, so the person
 * sees how far the trip has gone whether the card is open or collapsed. `percent` is already the smoothed figure (see useShownTripProgress).
 */
export const TripProgressBar: React.FC<TripProgressBarProps> = ({ percent, label, detailLeft, detailRight }) => {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <Box sx={{ p: '10px 14px', borderRadius: '14px', backgroundColor: '#F8FAFC', border: '1.5px solid #E2E8F0' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Typography sx={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>{label}</Typography>
        <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#0F172A' }}>{value}%</Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={value}
        aria-label={label}
        sx={{
          height: 8,
          borderRadius: 4,
          backgroundColor: '#E2E8F0',
          '& .MuiLinearProgress-bar': { backgroundColor: '#C75000', borderRadius: 4, transition: 'transform 0.4s linear' },
        }}
      />
      {(detailLeft || detailRight) && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mt: 0.5 }}>
          <Typography component="div" sx={{ fontSize: '12px', color: '#475569' }}>{detailLeft}</Typography>
          <Typography component="div" sx={{ fontSize: '12px', color: '#475569' }}>{detailRight}</Typography>
        </Box>
      )}
    </Box>
  );
};
