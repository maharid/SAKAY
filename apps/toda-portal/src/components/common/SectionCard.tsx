import React from 'react';
import { Box, Card, Typography } from '@mui/material';

import { FONT, SPACE } from '../../styles/density';
import { OPS_TEXT, opsCardSx } from '../operations/operationsTheme';

interface SectionCardProps {
  icon: React.ReactNode;
  title: string;
  /** a button or pill on the right of the title */
  action?: React.ReactNode;
  children: React.ReactNode;
}

// A card of a page: an icon and a title, an optional action on the right, then the content. It fills the height of its grid cell, so cards side by side line up.
export const SectionCard: React.FC<SectionCardProps> = ({ icon, title, action, children }) => (
  <Card elevation={0} sx={{ ...opsCardSx, p: SPACE.cardLarge, minWidth: 0, height: '100%' }}>
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', mb: '14px' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {icon}
        <Typography component="h2" sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: OPS_TEXT.primary }}>{title}</Typography>
      </Box>
      {action}
    </Box>
    {children}
  </Card>
);

interface InfoItemProps {
  label: string;
  children: React.ReactNode;
}

// A label with its value under it (put several inside a <dl>)
export const InfoItem: React.FC<InfoItemProps> = ({ label, children }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography component="dt" sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary }}>{label}</Typography>
    <Typography component="dd" sx={{ m: 0, fontSize: FONT.body, fontWeight: 600, color: OPS_TEXT.primary, overflowWrap: 'anywhere' }}>{children}</Typography>
  </Box>
);
