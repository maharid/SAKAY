import React from 'react';
import { Box, Typography } from '@mui/material';

import { FONT, SPACE } from '../../styles/density';
import { OPS_DIVIDER, OPS_TEXT, opsCardSx } from './operationsTheme';

export type OperationsStatTone = 'neutral' | 'brand' | 'success' | 'danger';

export interface OperationsStat {
  key: string;
  label: string;
  value: string | number;
  /** One short line under the number */
  note: string;
  /** Colours the number only when it says something; the label and note always say the same in words */
  tone?: OperationsStatTone;
  /** Colours the note green, for good news such as "online now" */
  noteTone?: 'neutral' | 'success';
}

interface OperationsStatStripProps {
  stats: OperationsStat[];
}

const VALUE_COLOR: Record<OperationsStatTone, string> = {
  neutral: OPS_TEXT.primary,
  brand: OPS_TEXT.brand,
  success: OPS_TEXT.success,
  danger: OPS_TEXT.danger,
};

// The numbers are one group: a single card split by thin lines, not five separate boxes.
// Layout follows the width of the card itself (not the screen), so it also works when the sidebar is open or closed:
// 1 column when very narrow, 2 on a phone, 3 + 2 on a tablet, one row of 5 on a wide screen.
export const OperationsStatStrip: React.FC<OperationsStatStripProps> = ({ stats }) => {
  const count = stats.length;
  const topRow = Math.ceil(count / 2);
  const bottomRow = count - topRow;

  return (
    <Box
      component="section"
      aria-label="Key numbers"
      sx={{ ...opsCardSx, overflow: 'hidden', containerType: 'inline-size', mb: SPACE.section }}
    >
      <Box
        component="dl"
        sx={{
          m: 0,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: '1px',
          backgroundColor: OPS_DIVIDER,
          '@container (min-width: 336px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
          '@container (min-width: 512px)': { gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' },
          '@container (min-width: 800px)': { gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` },
        }}
      >
        {stats.map((stat, index) => (
          <Box
            key={stat.key}
            sx={{
              backgroundColor: '#FFFFFF',
              p: '16px 18px',
              gridColumn: 'span 1',
              '@container (min-width: 336px)': { gridColumn: index === count - 1 && count % 2 === 1 ? 'span 2' : 'span 1' },
              '@container (min-width: 512px)': { gridColumn: `span ${index < topRow ? 6 / topRow : 6 / bottomRow}` },
              '@container (min-width: 800px)': { gridColumn: 'span 1' },
            }}
          >
            <Typography component="dt" sx={{ fontSize: FONT.body, fontWeight: 600, color: OPS_TEXT.secondary }}>
              {stat.label}
            </Typography>
            <Typography
              component="dd"
              sx={{ m: 0, mt: '5px', fontSize: FONT.display, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', color: VALUE_COLOR[stat.tone ?? 'neutral'] }}
            >
              {stat.value}
            </Typography>
            <Typography
              component="dd"
              sx={{ m: 0, mt: '5px', fontSize: FONT.small, lineHeight: 1.4, fontWeight: stat.noteTone === 'success' ? 600 : 400, color: stat.noteTone === 'success' ? OPS_TEXT.success : OPS_TEXT.secondary }}
            >
              {stat.note}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
};
