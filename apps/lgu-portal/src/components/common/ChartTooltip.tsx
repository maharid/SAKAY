import React from 'react';
import { Box, Tooltip, Typography } from '@mui/material';

import { FONT } from '../../styles/density';

interface ChartTooltipProps {
  /** the first line, in bold: the period or the name ("Oct 12") */
  title: string;
  /** the lines under it: the values, with their units ("3 bookings") */
  lines?: string[];
  /** the one element it belongs to; it should be able to take the keyboard focus, so the tooltip is there for keyboard users too */
  children: React.ReactElement;
}

// The tooltip of every chart in the LGU portal: a dark card above the bar or the row, with the name in bold and the values under it. It opens on hover, on keyboard
// focus and on a touch, and it is drawn on top of the page, so no card can cut it off.
export const ChartTooltip: React.FC<ChartTooltipProps> = ({ title, lines = [], children }) => (
  <Tooltip
    arrow
    placement="top"
    enterDelay={60}
    enterTouchDelay={0}
    leaveTouchDelay={3500}
    title={
      <Box>
        <Typography component="div" sx={{ fontSize: FONT.body, fontWeight: 700, lineHeight: 1.4 }}>{title}</Typography>
        {lines.map((line) => (
          <Typography key={line} component="div" sx={{ fontSize: FONT.small, lineHeight: 1.45 }}>{line}</Typography>
        ))}
      </Box>
    }
    slotProps={{
      tooltip: { sx: { backgroundColor: '#1F2937', color: '#FFFFFF', borderRadius: '8px', px: '10px', py: '7px', maxWidth: 260, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.3)' } },
      arrow: { sx: { color: '#1F2937' } },
    }}
  >
    {children}
  </Tooltip>
);
