import React from 'react';

import { BarChart } from '../common/BarChart';

export interface MiniBarPoint {
  key: string;
  label: string;
  value: number;
  /** shown in the tooltip under the period: the numbers with their units ("1 new", "9 in total") */
  lines?: string[];
}

interface MiniBarChartProps {
  points: MiniBarPoint[];
  color: string;
  /** bar area height in px */
  height?: number;
  /** What the chart shows, read out by a screen reader together with its numbers */
  label?: string;
  /** shown in place of the bars when every value is zero */
  empty?: React.ReactNode;
}

/** A plain vertical bar chart of one value per period, for the registration and accreditation trends. It fits its card (see BarChart); the scale starts at zero. */
export const MiniBarChart: React.FC<MiniBarChartProps> = ({ points, color, height = 110, label = 'Bar chart', empty }) => (
  <BarChart
    ariaLabel={label}
    height={height}
    empty={empty}
    points={points.map((p) => ({
      key: p.key,
      label: p.label,
      segments: [{ value: p.value, color }],
      tooltipTitle: p.label,
      tooltipLines: p.lines ?? [String(p.value)],
    }))}
  />
);
