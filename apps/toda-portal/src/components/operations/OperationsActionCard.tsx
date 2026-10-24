import React from 'react';
import { Box, Typography } from '@mui/material';

import { FONT, SPACE } from '../../styles/density';
import { OPS_TEXT, opsCardSx } from './operationsTheme';

interface OperationsActionCardProps {
  title: string;
  description: string;
  /** The button that starts the action. It keeps its size when the text wraps. */
  children: React.ReactNode;
}

// A title, a short description, and the button. Built the same way as the compact "End a trip for safety" card (same padding, text sizes and button size)
// so the two read as a pair; the grid they sit in gives them the same height.
export const OperationsActionCard: React.FC<OperationsActionCardProps> = ({ title, description, children }) => (
  <Box sx={{ ...opsCardSx, p: SPACE.card, display: 'flex', alignItems: 'center' }}>
    <Box sx={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.gap, flexWrap: 'wrap' }}>
      <Box sx={{ flex: '1 1 192px', minWidth: 0 }}>
        <Typography component="h2" sx={{ fontWeight: 700, fontSize: FONT.cardTitle, color: OPS_TEXT.primary }}>{title}</Typography>
        <Typography sx={{ fontSize: FONT.small, lineHeight: 1.5, color: OPS_TEXT.secondary }}>{description}</Typography>
      </Box>
      {children}
    </Box>
  </Box>
);
