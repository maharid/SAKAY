import React from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

import { FONT, SPACE } from '../../styles/density';
import { PAGE_DIVIDER, PAGE_TEXT, pageCardSx } from '../../styles/pageTheme';

export type StatTone = 'neutral' | 'brand' | 'success' | 'danger';

export interface StatItem {
  key: string;
  label: string;
  /** The number (or a spinner while it loads) */
  value: React.ReactNode;
  /** One short line under the number (optional) */
  note?: string;
  /** Colours the number only when it says something; the label and note always say the same in words */
  tone?: StatTone;
  /** Makes the whole cell a link to the screen that lists these records */
  to?: string;
  /** Makes the whole cell a button that picks this group of records in the list below (the cell the list shows is marked with `selected`) */
  onSelect?: () => void;
  selected?: boolean;
}

interface StatStripProps {
  stats: StatItem[];
  /** Read out by a screen reader for the group, e.g. "Key numbers" */
  label?: string;
  /** The narrowest a cell may get before the strip wraps into rows (default 150px) */
  minCellWidth?: number;
}

const VALUE_COLOR: Record<StatTone, string> = {
  neutral: PAGE_TEXT.primary,
  brand: PAGE_TEXT.brand,
  success: PAGE_TEXT.success,
  danger: PAGE_TEXT.danger,
};

const FOCUS_INSIDE = { '&:focus-visible': { outline: `2px solid ${PAGE_TEXT.brand}`, outlineOffset: '-2px' } } as const;

// The numbers are one group (the same as the TODA portal's Operations strip): a single card split by thin lines, not a row of separate boxes.
// The layout follows the width of the card itself (not the screen), so it also works when the sidebar is open or closed:
// 1 column when very narrow, 2 on a phone, 3 on a tablet when the count divides by 3, one row on a wide screen.
export const StatStrip: React.FC<StatStripProps> = ({ stats, label = 'Key numbers', minCellWidth = 150 }) => {
  const count = stats.length;
  const tiers: Array<{ min: number; cols: number }> = [{ min: 340, cols: 2 }];
  if (count > 3 && count % 3 === 0) tiers.push({ min: 480, cols: 3 });
  tiers.push({ min: Math.max(count * minCellWidth, tiers[tiers.length - 1].min + 1), cols: count });

  // the last cell fills what is left of its row, so a strip of five or seven has no empty box
  const lastSpan = (cols: number) => `span ${cols - ((count - 1) % cols)}`;

  const gridQueries = Object.fromEntries(tiers.map((t) => [`@container (min-width: ${t.min}px)`, { gridTemplateColumns: `repeat(${t.cols}, minmax(0, 1fr))` }]));
  const lastQueries = Object.fromEntries(tiers.map((t) => [`@container (min-width: ${t.min}px)`, { gridColumn: lastSpan(t.cols) }]));

  const cellSx = { display: 'block', p: '16px 18px', color: 'inherit', textDecoration: 'none', height: '100%', width: '100%', textAlign: 'left', font: 'inherit' } as const;

  return (
    <Box component="section" aria-label={label} sx={{ ...pageCardSx, overflow: 'hidden', containerType: 'inline-size', mb: SPACE.section }}>
      <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '1px', backgroundColor: PAGE_DIVIDER, ...gridQueries }}>
        {stats.map((stat, index) => {
          const body = (
            <>
              <Typography component="span" sx={{ display: 'block', fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.secondary }}>
                {stat.label}
              </Typography>
              <Typography
                component="span"
                sx={{ display: 'block', mt: '5px', fontSize: FONT.display, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', color: VALUE_COLOR[stat.tone ?? 'neutral'] }}
              >
                {stat.value}
              </Typography>
              {stat.note && (
                <Typography component="span" sx={{ display: 'block', mt: '5px', fontSize: FONT.small, lineHeight: 1.4, color: PAGE_TEXT.secondary }}>
                  {stat.note}
                </Typography>
              )}
            </>
          );
          return (
            <Box key={stat.key} component="li" sx={{ backgroundColor: stat.selected ? '#FFF6EE' : '#FFFFFF', minWidth: 0, boxShadow: stat.selected ? `inset 0 -3px 0 #C75000` : 'none', ...(index === count - 1 ? lastQueries : {}) }}>
              {stat.to ? (
                <Box component={RouterLink} to={stat.to} sx={{ ...cellSx, cursor: 'pointer', '&:hover': { backgroundColor: '#FAFAF8' }, ...FOCUS_INSIDE }}>
                  {body}
                </Box>
              ) : stat.onSelect ? (
                <ButtonBase
                  onClick={stat.onSelect}
                  aria-pressed={Boolean(stat.selected)}
                  disableRipple
                  sx={{ ...cellSx, cursor: 'pointer', alignItems: 'flex-start', '&:hover': { backgroundColor: stat.selected ? '#FFF1E4' : '#FAFAF8' }, ...FOCUS_INSIDE }}
                >
                  {body}
                </ButtonBase>
              ) : (
                <Box sx={cellSx}>{body}</Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};
