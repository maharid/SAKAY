import React from 'react';
import { Box, Typography } from '@mui/material';

import { OPS_TEXT } from '../operations/operationsTheme';
import { FONT, SPACE } from '../../styles/density';

interface ResultsBarProps {
  /** How many are shown, in words ("Showing 2 of 2 reports") */
  count: string;
  /** What sits at the right: the export toolbar */
  children?: React.ReactNode;
}

/** The line between a filter card and its table: the count on the left and the export on the right, so the two never crowd the filters */
export const ResultsBar: React.FC<ResultsBarProps> = ({ count, children }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px 16px', my: SPACE.gap }}>
    <Typography role="status" sx={{ fontSize: FONT.body, color: OPS_TEXT.secondary }}>
      {count}
    </Typography>
    {children}
  </Box>
);
