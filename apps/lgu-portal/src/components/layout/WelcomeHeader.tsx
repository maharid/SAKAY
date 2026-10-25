import React from 'react';
import { Box, Typography } from '@mui/material';

import { FONT } from '../../styles/density';
import { PAGE_TEXT } from '../../styles/pageTheme';

interface WelcomeHeaderProps {
  welcomeText?: string;
  supportingText?: string;
}

// today's date as the Philippines reads it, e.g. "Sunday, October 25, 2026"
const todayLabel = (): string =>
  new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Manila', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

// The greeting at the top of the Dashboard: one line of welcome and today's date as plain text.
// (The page header above already says "Dashboard" and what the page is for, so nothing is repeated here.)
export const WelcomeHeader: React.FC<WelcomeHeaderProps> = ({ welcomeText = 'Welcome back, LGU Admin', supportingText }) => (
  <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', columnGap: '16px', rowGap: '2px', mb: '16px' }}>
    <Typography component="h2" sx={{ fontSize: FONT.pageTitle, fontWeight: 700, color: PAGE_TEXT.primary, lineHeight: 1.3 }}>
      {welcomeText}
    </Typography>
    <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary }}>
      {supportingText ?? todayLabel()}
    </Typography>
  </Box>
);
