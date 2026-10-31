import React, { useState } from 'react';
import { Box, Typography } from '@mui/material';
import RouteIcon from '@mui/icons-material/Route';
import type { VolumeRow } from '@sakay/shared';

import { DashboardCard, DashboardEmpty } from './DashboardCard';
import { FONT } from '../../styles/density';
import { PAGE_BORDER, PAGE_TEXT } from '../../styles/pageTheme';

interface BookingTrendCardProps {
  /** One row per day, oldest first (the last seven days), counted from the real bookings */
  days?: VolumeRow[];
  /** How many bookings there were in the seven days before those, for the change shown next to the title */
  previousTotal?: number;
  loading?: boolean;
}

const WIDTH = 760;
const LEFT = 55;
const RIGHT = 720;
const TOP = 35;
const BOTTOM = 200;

/** A round top for the scale (5, 10, 20, 50 ...) so the gridlines carry whole numbers */
const niceMax = (value: number): number => {
  if (value <= 5) return 5;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((m) => m * magnitude >= value) as number;
  return step * magnitude;
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The change against the seven days before, in words ("+20%"), or nothing when there is nothing to compare */
const changeText = (current: number, previous: number): string | undefined => {
  if (previous <= 0) return undefined;
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct > 0 ? '+' : ''}${pct}%`;
};

export const BookingTrendCard: React.FC<BookingTrendCardProps> = ({ days = [], previousTotal = 0, loading = false }) => {
  const [hovered, setHovered] = useState<number | null>(null);

  const total = days.reduce((n, d) => n + d.total, 0);
  const completed = days.reduce((n, d) => n + d.completed, 0);
  const hasData = total > 0;
  const top = niceMax(Math.max(0, ...days.map((d) => d.total)));
  const step = days.length > 1 ? (RIGHT - LEFT) / (days.length - 1) : 0;
  const points = days.map((d, i) => ({ ...d, x: LEFT + i * step, y: BOTTOM - (d.total / top) * (BOTTOM - TOP) }));

  // a smooth curve through the points
  const linePath = points.length < 2 ? '' : points.reduce((path, pt, i) => (i === 0 ? `M ${pt.x} ${pt.y}` : `${path} C ${points[i - 1].x + step / 2} ${points[i - 1].y}, ${pt.x - step / 2} ${pt.y}, ${pt.x} ${pt.y}`), '');
  const areaPath = linePath ? `${linePath} L ${points[points.length - 1].x} ${BOTTOM} L ${points[0].x} ${BOTTOM} Z` : '';
  const change = changeText(total, previousTotal);
  const active = hovered !== null ? points[hovered] : null;

  return (
    <DashboardCard
      title="Booking trend"
      description="Booking requests per day over the last 7 days. Point at a day for its details."
      titleAdornment={
        hasData && change ? (
          <Box
            title={`${total} booking${total === 1 ? '' : 's'} in the last 7 days against ${previousTotal} in the 7 days before`}
            sx={{
              backgroundColor: change.startsWith('-') ? 'rgba(185, 28, 28, 0.08)' : 'rgba(52, 168, 83, 0.12)',
              color: change.startsWith('-') ? PAGE_TEXT.danger : PAGE_TEXT.success,
              fontWeight: 600,
              fontSize: FONT.caption,
              padding: '2px 8px',
              borderRadius: '999px',
              border: `1px solid ${change.startsWith('-') ? 'rgba(185, 28, 28, 0.25)' : 'rgba(52, 168, 83, 0.25)'}`,
            }}
          >
            {change} vs the 7 days before
          </Box>
        ) : undefined
      }
    >
      {hasData ? (
        <>
          <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mb: '6px' }}>
            {total.toLocaleString()} {plural(total, 'request', 'requests')} in 7 days, {completed.toLocaleString()} completed
            {total > 0 ? ` (${Math.round((completed / total) * 100)}%)` : ''}.
          </Typography>
          <Box sx={{ width: '100%', height: 260, position: 'relative', mt: 'auto' }}>
            <svg viewBox={`0 0 ${WIDTH} 240`} style={{ width: '100%', height: '100%', overflow: 'visible' }} role="group" aria-label={`Booking requests per day, last 7 days: ${points.map((p) => `${p.label} ${p.total}`).join(', ')}`}>
              <defs>
                <linearGradient id="bookingAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--sakay-orange)" stopOpacity="0.28" />
                  <stop offset="60%" stopColor="var(--sakay-orange)" stopOpacity="0.08" />
                  <stop offset="100%" stopColor="var(--sakay-orange)" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* gridlines with their values, so the height of a point can be read */}
              {[0, 1, 2, 3].map((i) => {
                const y = BOTTOM - (i * (BOTTOM - TOP)) / 3;
                return (
                  <g key={i}>
                    <line x1={LEFT} y1={y} x2={RIGHT} y2={y} stroke="#E5E5EA" strokeDasharray="4 4" strokeWidth="1" />
                    <text x={LEFT - 10} y={y + 4} textAnchor="end" fill="#636366" fontSize="12">{Math.round((i * top) / 3)}</text>
                  </g>
                );
              })}

              <path d={areaPath} fill="url(#bookingAreaGrad)" />
              <path d={linePath} fill="none" stroke="var(--sakay-orange)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />

              {points.map((pt, idx) => (
                <g
                  key={pt.key}
                  tabIndex={0}
                  role="img"
                  aria-label={`${pt.label}: ${pt.total} ${plural(pt.total, 'request', 'requests')}, ${pt.completed} completed, ${pt.cancelled} cancelled, ${pt.noDriverFound} with no driver found`}
                  onMouseEnter={() => setHovered(idx)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(idx)}
                  onBlur={() => setHovered(null)}
                  style={{ cursor: 'pointer', outline: 'none' }}
                >
                  {/* a wide invisible target, so a day is easy to point at */}
                  <rect x={pt.x - Math.max(step / 2, 14)} y={TOP - 10} width={Math.max(step, 28)} height={BOTTOM - TOP + 40} fill="transparent" />
                  {hovered === idx && <line x1={pt.x} y1={TOP - 5} x2={pt.x} y2={BOTTOM} stroke="var(--sakay-orange)" strokeOpacity="0.35" strokeDasharray="3 3" />}
                  {hovered === idx && <circle cx={pt.x} cy={pt.y} r="10" fill="var(--sakay-orange-soft)" />}
                  <circle cx={pt.x} cy={pt.y} r={hovered === idx ? 6.5 : 5} fill="#FFFFFF" stroke="var(--sakay-orange)" strokeWidth="3.5" style={{ transition: 'all 0.15s ease' }} />
                </g>
              ))}

              <g fill="#636366" fontSize="13" fontWeight="500" textAnchor="middle">
                {points.map((pt) => (
                  <text key={pt.key} x={pt.x} y="228">
                    {pt.label}
                  </text>
                ))}
              </g>
            </svg>

            {active && (
              <Box
                role="status"
                sx={{
                  position: 'absolute',
                  left: `clamp(0px, calc(${(active.x / WIDTH) * 100}% - 95px), calc(100% - 190px))`,
                  top: `calc(${(active.y / 240) * 100}% - 112px)`,
                  backgroundColor: '#FFFFFF',
                  color: PAGE_TEXT.primary,
                  padding: '8px 13px',
                  borderRadius: '10px',
                  border: `1px solid ${PAGE_BORDER}`,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                  pointerEvents: 'none',
                  zIndex: 10,
                  width: 190,
                }}
              >
                <Typography sx={{ fontSize: FONT.caption, color: PAGE_TEXT.secondary, fontWeight: 600, textTransform: 'uppercase' }}>{active.label}</Typography>
                <Typography sx={{ fontSize: FONT.heading, fontWeight: 700, color: 'var(--sakay-orange)' }}>
                  {active.total.toLocaleString()} {plural(active.total, 'request', 'requests')}
                </Typography>
                <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.primary, lineHeight: 1.5 }}>
                  {active.completed} completed ({active.completionRate}%)
                  <br />
                  {active.cancelled} cancelled · {active.noDriverFound} no driver found
                </Typography>
              </Box>
            )}
          </Box>
        </>
      ) : (
        <DashboardEmpty
          icon={<RouteIcon aria-hidden />}
          title={loading ? 'Loading the booking trend...' : 'No bookings in the last 7 days'}
          hint={loading ? undefined : 'The chart appears here as soon as passengers book rides.'}
        />
      )}
    </DashboardCard>
  );
};
