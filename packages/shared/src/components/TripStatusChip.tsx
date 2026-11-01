import React from 'react';
import Chip from '@mui/material/Chip';

import { tripStatusColors, tripStatusLabel } from '../utils/tripStatus';

export interface TripStatusChipProps {
  status?: string | null;
  language: 'en' | 'tl';
  /** the list uses a smaller chip than the detail screen */
  size?: 'small' | 'medium';
}

/** The status of a trip, worded and coloured the same on the lists and detail screens of both apps. */
export const TripStatusChip: React.FC<TripStatusChipProps> = ({ status, language, size = 'small' }) => {
  if (!status) return null;
  const { background, color } = tripStatusColors(status);
  return (
    <Chip
      label={tripStatusLabel(status, language)}
      sx={{
        backgroundColor: background,
        color,
        fontWeight: 700,
        fontSize: '12px',
        fontFamily: 'Poppins, sans-serif',
        height: size === 'small' ? 24 : 26,
        px: size === 'small' ? 0.25 : 1,
        flexShrink: 0,
        '& .MuiChip-label': { px: '10px' },
      }}
    />
  );
};

export default TripStatusChip;
