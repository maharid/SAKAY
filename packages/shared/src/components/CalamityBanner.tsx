import React from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';

import type { ActiveCalamity } from '../utils/tripSafety';
import { calamityDetails } from '../utils/calamityDetails';

export interface CalamityBannerProps {
  calamity: ActiveCalamity;
  language: 'en' | 'tl';
  /** the audience: what the paused strikes mean for them */
  audience: 'passenger' | 'driver';
}

/**
 * Rules 15.3, 15.4, 29.6: while the LGU Administrator's calamity declaration lasts, both apps say so on their home screen (the announcement itself is in the notices):
 * what happened, and that cancellations, stalls and no-shows are not struck during it.
 */
export const CalamityBanner: React.FC<CalamityBannerProps> = ({ calamity, language, audience }) => {
  if (!calamity.active) return null;
  const tl = language === 'tl';
  const details = calamityDetails(calamity, language);
  const row = (label: string, value: string) => (
    <Typography component="div" sx={{ fontSize: '12px', lineHeight: 1.45, mt: 0.5 }}>
      <Box component="span" sx={{ fontWeight: 700 }}>{label}: </Box>
      {value}
    </Typography>
  );
  return (
    <Alert severity="warning" role="status" sx={{ borderRadius: '14px', alignItems: 'flex-start', '& .MuiAlert-message': { width: '100%' } }}>
      <AlertTitle sx={{ fontWeight: 700, fontSize: '14px', mb: 0.25 }}>{calamity.title}</AlertTitle>
      <Typography sx={{ fontSize: '12.5px', lineHeight: 1.45, whiteSpace: 'pre-line' }}>{calamity.message}</Typography>
      {/* what is paused, what is not, who it is for and for how long: the same words as the LGU portal's panel */}
      <Box sx={{ mt: 0.75 }}>
        {row(tl ? 'Naka-pause' : 'Paused', details.suspended)}
        {row(tl ? 'Hindi naka-pause' : 'Not paused', details.stillEnforced)}
        {row(tl ? 'Para kanino' : 'Who', details.affected)}
        {row(tl ? 'Tagal' : 'How long', details.duration)}
      </Box>
      {audience === 'driver' && (
        <Typography sx={{ fontSize: '12px', lineHeight: 1.45, mt: 0.5, fontWeight: 600 }}>{tl ? 'Mag-ingat sa daan.' : 'Drive carefully.'}</Typography>
      )}
    </Alert>
  );
};

export default CalamityBanner;
