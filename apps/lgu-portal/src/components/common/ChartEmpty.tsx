import React from 'react';
import { Box, Typography } from '@mui/material';
import InsertChartOutlinedIcon from '@mui/icons-material/InsertChartOutlined';

import { FONT } from '../../styles/density';
import { PAGE_TEXT } from '../../styles/pageTheme';

interface ChartEmptyProps {
  /** what is missing, in a few words ("No bookings in this period") */
  title: string;
  /** one short line of what to do */
  hint?: string;
  /** the room the chart would have taken, so the card keeps its size */
  minHeight?: number;
  /** the figures could not be read: the message says so instead of "no data" (an empty chart and a failed read are different things) */
  failed?: boolean;
}

// What a chart card shows when there is nothing to draw. It keeps the card's size, says in plain words why, and never draws made-up bars.
export const ChartEmpty: React.FC<ChartEmptyProps> = ({ title, hint, minHeight = 140, failed = false }) => (
  <Box role={failed ? 'alert' : 'status'} sx={{ minHeight, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: '3px', py: '16px' }}>
    <InsertChartOutlinedIcon aria-hidden sx={{ fontSize: 26, color: failed ? PAGE_TEXT.danger : '#8A8A90', mb: '4px' }} />
    <Typography sx={{ fontSize: FONT.heading, fontWeight: 700, color: PAGE_TEXT.primary }}>{failed ? 'These figures could not be loaded' : title}</Typography>
    {(failed || hint) && <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, lineHeight: 1.5, maxWidth: 320 }}>{failed ? 'Use Try again at the top of the page.' : hint}</Typography>}
  </Box>
);
