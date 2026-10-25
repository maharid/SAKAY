import React from 'react';
import { Box, Typography } from '@mui/material';

import { FONT } from '../../styles/density';
import { PAGE_BORDER, PAGE_TEXT } from '../../styles/pageTheme';

export interface MiniBarPoint {
  key: string;
  label: string;
  value: number;
  /** shown as the tooltip of the bar */
  title?: string;
}

interface MiniBarChartProps {
  points: MiniBarPoint[];
  color: string;
  /** bar area height in px */
  height?: number;
  /** What the chart shows, read out by a screen reader together with its numbers */
  label?: string;
}

/** A plain vertical bar chart of one value per period, for the registration and accreditation trends. The scale starts at zero. */
export const MiniBarChart: React.FC<MiniBarChartProps> = ({ points, color, height = 110, label = 'Bar chart' }) => {
  const max = Math.max(1, ...points.map((p) => p.value));
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box role="img" aria-label={`${label}: ${points.map((p) => `${p.label} ${p.value}`).join(', ')}`} sx={{ minWidth: points.length * 30 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height, borderBottom: `1px solid ${PAGE_BORDER}` }}>
          {points.map((p) => (
            <Box key={p.key} title={p.title ?? `${p.label}: ${p.value}`} sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end' }}>
              <Typography sx={{ fontSize: FONT.caption, fontWeight: 700, color: PAGE_TEXT.secondary, mb: '2px' }}>{p.value > 0 ? p.value : ''}</Typography>
              <Box sx={{ width: '100%', maxWidth: 30, height: `${(p.value / max) * (height - 22)}px`, backgroundColor: color, borderRadius: '4px 4px 0 0' }} />
            </Box>
          ))}
        </Box>
        <Box sx={{ display: 'flex', gap: '4px', mt: 0.75 }}>
          {points.map((p) => (
            <Typography key={p.key} sx={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: FONT.caption, lineHeight: 1.2, color: PAGE_TEXT.secondary }}>
              {p.label}
            </Typography>
          ))}
        </Box>
      </Box>
    </Box>
  );
};
