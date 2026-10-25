import React from 'react';
import { Box, Typography } from '@mui/material';

import { ChartTooltip } from './ChartTooltip';
import { FONT } from '../../styles/density';
import { PAGE_TEXT } from '../../styles/pageTheme';

interface MeterRowProps {
  label: string;
  /** What the bar measures, written out ("12 (34%)"): the number is always in words too, never only a bar */
  valueText: string;
  /** 0 - 100: how full the bar is */
  percent: number;
  color: string;
  /** One quiet line under the bar (optional) */
  detail?: string;
  /** Width of the label column in px (default 120) */
  labelWidth?: number;
  /** Width of the value column in px (default 84) */
  valueWidth?: number;
  /** Bar thickness in px (default 8) */
  thickness?: number;
  /** The lines of the tooltip under the label (default: the value in words). The numbers are always written beside the bar too, so nothing depends on the tooltip. */
  tooltipLines?: string[];
}

// One horizontal bar of a comparison: a label, the bar and the number in words. The same row is used for outcomes, days of the week, peak hours and barangays.
export const MeterRow: React.FC<MeterRowProps> = ({ label, valueText, percent, color, detail, labelWidth = 120, valueWidth = 84, thickness = 8, tooltipLines }) => {
  const width = Math.max(0, Math.min(100, percent));
  return (
    <ChartTooltip title={label} lines={tooltipLines ?? [valueText]}>
      <Box sx={{ display: 'grid', gridTemplateColumns: `minmax(72px, ${labelWidth}px) minmax(0, 1fr) minmax(${valueWidth}px, auto)`, alignItems: 'center', columnGap: '12px', rowGap: '2px' }}>
        <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.secondary, overflowWrap: 'anywhere' }}>{label}</Typography>
        <Box aria-hidden sx={{ height: thickness, borderRadius: `${thickness / 2}px`, backgroundColor: '#EEEEF0', overflow: 'hidden' }}>
          <Box sx={{ width: `${width}%`, height: '100%', borderRadius: `${thickness / 2}px`, backgroundColor: color }} />
        </Box>
        <Typography sx={{ fontSize: FONT.body, fontWeight: 700, textAlign: 'right', color: PAGE_TEXT.primary, fontVariantNumeric: 'tabular-nums' }}>{valueText}</Typography>
        {detail && <Typography sx={{ gridColumn: '2 / -1', fontSize: FONT.small, color: PAGE_TEXT.secondary }}>{detail}</Typography>}
      </Box>
    </ChartTooltip>
  );
};
