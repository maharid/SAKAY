import React from 'react';
import { Box, Typography } from '@mui/material';
import { useMeasuredSize } from '@sakay/shared';

import { ChartTooltip } from './ChartTooltip';
import { FONT } from '../../styles/density';
import { PAGE_BORDER, PAGE_TEXT } from '../../styles/pageTheme';

export interface BarSegment {
  value: number;
  color: string;
}

export interface BarPoint {
  key: string;
  /** under the bar ("Oct 12") */
  label: string;
  /** the parts of the bar, the first at the bottom (one part for a plain bar) */
  segments: BarSegment[];
  /** the tooltip: its first line, and the values under it with their units */
  tooltipTitle: string;
  tooltipLines: string[];
}

interface BarChartProps {
  points: BarPoint[];
  /** what the chart shows, read out by a screen reader before its bars */
  ariaLabel: string;
  /** height of the bars' area in px (default 140) */
  height?: number;
  /** shown in place of the bars when every bar is zero; it keeps the room the chart would have had */
  empty?: React.ReactNode;
}

const GAP = 4;
const TOTAL_ROOM = 18;
const CHAR_PX = 6.4;

/**
 * A bar chart that fits the width of its card: no scrolling, whatever the number of bars. Every bar gets an equal share of the width; when the shares get too
 * narrow for their labels, only every second (third ...) label is written, counted from the last bar, and the numbers above the bars are left out, because the
 * tooltip of each bar (hover, keyboard focus or a touch) always has the full label and the numbers. The scale starts at zero.
 */
export const BarChart: React.FC<BarChartProps> = ({ points, ariaLabel, height = 140, empty }) => {
  const [ref, size] = useMeasuredSize<HTMLDivElement>();
  const count = points.length;
  const totals = points.map((p) => p.segments.reduce((sum, s) => sum + s.value, 0));
  const max = Math.max(1, ...totals);

  if (empty && totals.every((t) => t === 0)) {
    return <Box sx={{ minHeight: height + 38, display: 'flex' }}>{empty}</Box>;
  }

  const column = count > 0 && size.width > 0 ? (size.width - GAP * (count - 1)) / count : 40;
  const showTotals = column >= 20;
  const longestWord = Math.max(1, ...points.flatMap((p) => p.label.split(' ').map((w) => w.length)));
  const step = Math.max(1, Math.ceil((longestWord * CHAR_PX + 6) / (column + GAP)));
  const barArea = height - TOTAL_ROOM;

  return (
    <Box role="group" aria-label={ariaLabel}>
      <Box ref={ref} sx={{ display: 'flex', alignItems: 'stretch', gap: `${GAP}px`, height, borderBottom: `1px solid ${PAGE_BORDER}` }}>
        {points.map((p, i) => {
          const total = totals[i];
          return (
            <ChartTooltip key={p.key} title={p.tooltipTitle} lines={p.tooltipLines}>
              <Box
                tabIndex={0}
                role="img"
                aria-label={`${p.tooltipTitle}: ${p.tooltipLines.join(', ')}`}
                sx={{
                  flex: '1 1 0',
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  borderRadius: '6px 6px 0 0',
                  cursor: 'default',
                  '&:hover': { backgroundColor: 'rgba(15, 23, 42, 0.05)' },
                  '&:focus-visible': { outline: `2px solid ${PAGE_TEXT.brand}`, outlineOffset: '-2px' },
                }}
              >
                {showTotals && (
                  <Typography aria-hidden sx={{ fontSize: FONT.caption, fontWeight: 700, color: PAGE_TEXT.secondary, height: TOTAL_ROOM - 2, lineHeight: `${TOTAL_ROOM - 2}px` }}>
                    {total > 0 ? total : ''}
                  </Typography>
                )}
                <Box sx={{ width: '100%', maxWidth: 34, height: `${(total / max) * barArea}px`, display: 'flex', flexDirection: 'column-reverse', borderRadius: '4px 4px 0 0', overflow: 'hidden' }}>
                  {p.segments.map((s, k) => (
                    <Box key={k} sx={{ height: total > 0 ? `${(s.value / total) * 100}%` : 0, backgroundColor: s.color }} />
                  ))}
                </Box>
              </Box>
            </ChartTooltip>
          );
        })}
      </Box>
      <Box aria-hidden sx={{ display: 'flex', gap: `${GAP}px`, mt: '6px' }}>
        {/* a label can be a little wider than its bar (it wraps at the space: "Oct" over "12"); the first and the last one grow inwards, so none sticks out of the card */}
        {points.map((p, i) => (
          <Box key={p.key} sx={{ flex: '1 1 0', minWidth: 0, display: 'flex', justifyContent: i === count - 1 ? 'flex-end' : i === 0 ? 'flex-start' : 'center' }}>
            {(count - 1 - i) % step === 0 && (
              <Typography component="span" sx={{ width: 'min-content', textAlign: 'center', fontSize: FONT.caption, lineHeight: 1.2, color: PAGE_TEXT.secondary }}>
                {p.label}
              </Typography>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
};
