import React from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Typography from '@mui/material/Typography';

import type { ActiveCalamity } from '../utils/tripSafety';

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
  const strikesLine =
    calamity.scope === 'ALL'
      ? tl ? 'Walang bibilangin na strike habang nagpapatuloy ito, maliban sa mga seryosong paglabag.' : 'Strikes are paused while this lasts, except for serious violations.'
      : tl ? 'Hindi bibilangin na strike ang pagkansela, paghinto o hindi pagsipot habang nagpapatuloy ito.' : 'Cancellations, stalls and no-shows are not struck while this lasts.';
  return (
    <Alert severity="warning" role="status" sx={{ borderRadius: '14px', alignItems: 'flex-start', '& .MuiAlert-message': { width: '100%' } }}>
      <AlertTitle sx={{ fontWeight: 700, fontSize: '14px', mb: 0.25 }}>{calamity.title}</AlertTitle>
      <Typography sx={{ fontSize: '12.5px', lineHeight: 1.45, whiteSpace: 'pre-line' }}>{calamity.message}</Typography>
      <Typography sx={{ fontSize: '12px', lineHeight: 1.45, mt: 0.5, fontWeight: 600 }}>
        {strikesLine}
        {audience === 'driver' ? (tl ? ' Mag-ingat sa daan.' : ' Drive carefully.') : ''}
      </Typography>
    </Alert>
  );
};

export default CalamityBanner;
