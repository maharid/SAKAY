import React, { useId } from 'react';
import { Box, Typography } from '@mui/material';

import { FONT, SPACE } from '../../styles/density';
import { OPS_TEXT, opsCardSx } from './operationsTheme';

interface OperationsListCardProps {
  title: string;
  subtitle?: string;
  /** e.g. "20 drivers" */
  count: string;
  children: React.ReactNode;
}

// The card around a list: heading, one short line, how many, then the table.
export const OperationsListCard: React.FC<OperationsListCardProps> = ({ title, subtitle, count, children }) => {
  const headingId = useId();
  return (
    <Box component="section" aria-labelledby={headingId} sx={{ ...opsCardSx, p: SPACE.cardLarge, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', mb: SPACE.gap }}>
        <Box>
          <Typography id={headingId} component="h2" sx={{ fontSize: FONT.sectionTitle, fontWeight: 700, color: OPS_TEXT.primary }}>{title}</Typography>
          {subtitle && <Typography sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary, mt: '2px' }}>{subtitle}</Typography>}
        </Box>
        <Box sx={{ flexShrink: 0, px: '10px', py: '3px', borderRadius: '999px', backgroundColor: '#F4F4F5', color: '#3F3F46', fontSize: FONT.small, fontWeight: 600, whiteSpace: 'nowrap' }}>
          {count}
        </Box>
      </Box>
      {children}
    </Box>
  );
};
