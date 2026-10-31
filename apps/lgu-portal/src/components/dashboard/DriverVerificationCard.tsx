import React, { useState } from 'react';
import { Box, Typography } from '@mui/material';
import BadgeIcon from '@mui/icons-material/Badge';

import { DashboardCard, DashboardEmpty } from './DashboardCard';
import { ChartTooltip } from '../common/ChartTooltip';
import { FONT } from '../../styles/density';
import { PAGE_TEXT } from '../../styles/pageTheme';

interface SegmentData {
  key: string;
  label: string;
  count: number;
  percentage: number;
  color: string;
  /** What the group means, in a sentence (the tooltip) */
  meaning: string;
}

interface DriverVerificationCardProps {
  data?: {
    total: number;
    approved: number;
    pending: number;
    rejected: number;
    suspended: number;
    deactivated?: number;
  };
}

const SEGMENT_STYLE: Array<{ key: keyof NonNullable<DriverVerificationCardProps['data']>; label: string; color: string; meaning: string }> = [
  { key: 'approved', label: 'Verified', color: '#2E8B47', meaning: 'Verified by the LGU: these drivers can go online and take trips.' },
  { key: 'pending', label: 'In review', color: '#E0A100', meaning: 'Applications still being checked by a TODA or by the LGU, or sent back to the driver to fix.' },
  { key: 'rejected', label: 'Rejected', color: '#D93025', meaning: 'Applications the LGU rejected. These drivers cannot take trips.' },
  { key: 'suspended', label: 'Suspended', color: '#6B7280', meaning: 'Verified drivers whose account is on hold. They cannot take trips until it is reinstated.' },
  { key: 'deactivated', label: 'Deactivated', color: '#9AA0A6', meaning: 'Accounts that were closed, by the driver or by an administrator.' },
];

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const DriverVerificationCard: React.FC<DriverVerificationCardProps> = ({ data }) => {
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const total = data?.total || 0;
  // a group with nobody in it is left out of the ring and the list would only repeat "0": it stays in the list so the whole picture is there
  const segments: SegmentData[] = SEGMENT_STYLE.map((s) => {
    const count = Number(data?.[s.key] ?? 0);
    return { key: s.key, label: s.label, count, percentage: total > 0 ? Math.round((count / total) * 100) : 0, color: s.color, meaning: s.meaning };
  });
  const active = segments.find((s) => s.key === activeKey) ?? null;

  const size = 150;
  const strokeWidth = 22;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // the ring is drawn from the real shares (not the rounded percentages), so the pieces always close the circle
  let cumulative = 0;
  const arcs = segments.map((seg) => {
    const length = total > 0 ? (seg.count / total) * circumference : 0;
    const arc = { seg, length, offset: -cumulative };
    cumulative += length;
    return arc;
  });

  const tooltipLines = (seg: SegmentData) => [`${seg.count.toLocaleString()} ${plural(seg.count, 'driver', 'drivers')} (${seg.percentage}% of ${total.toLocaleString()})`, seg.meaning];

  return (
    <DashboardCard title="Driver verification" description="Where every driver account stands. Point at a colour for what it means." action={{ label: 'View all', to: '/drivers', ariaLabel: 'View all drivers' }}>
      {total > 0 ? (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1, flexWrap: 'wrap', gap: '20px' }}>
          <Box sx={{ position: 'relative', width: 165, height: 165, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, mx: 'auto' }}>
            <svg
              width={size}
              height={size}
              viewBox={`0 0 ${size} ${size}`}
              style={{ overflow: 'visible' }}
              role="group"
              aria-label={`${total} drivers: ${segments.map((seg) => `${seg.count} ${seg.label.toLowerCase()}`).join(', ')}`}
            >
              {/* the track behind the pieces */}
              <circle cx={size / 2} cy={size / 2} r={radius} fill="transparent" stroke="#F1F1EE" strokeWidth={strokeWidth} />
              {arcs
                .filter((a) => a.length > 0)
                .map(({ seg, length, offset }) => {
                  const isActive = activeKey === seg.key;
                  return (
                    <ChartTooltip key={seg.key} title={seg.label} lines={tooltipLines(seg)}>
                      <circle
                        tabIndex={0}
                        role="img"
                        aria-label={`${seg.label}: ${seg.count} ${plural(seg.count, 'driver', 'drivers')}, ${seg.percentage}%. ${seg.meaning}`}
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        fill="transparent"
                        stroke={seg.color}
                        strokeWidth={isActive ? strokeWidth + 6 : strokeWidth}
                        strokeDasharray={`${length} ${circumference}`}
                        strokeDashoffset={offset}
                        transform={`rotate(-90 ${size / 2} ${size / 2})`}
                        style={{ transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)', cursor: 'pointer', opacity: activeKey && !isActive ? 0.4 : 1, outline: 'none' }}
                        onMouseEnter={() => setActiveKey(seg.key)}
                        onMouseLeave={() => setActiveKey(null)}
                        onFocus={() => setActiveKey(seg.key)}
                        onBlur={() => setActiveKey(null)}
                      />
                    </ChartTooltip>
                  );
                })}
            </svg>

            {/* the middle says the number and the name of the piece that is pointed at (the total when none is) */}
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', textAlign: 'center', px: '24px' }}>
              <Typography sx={{ fontSize: FONT.pageTitle, fontWeight: 700, color: active ? active.color : PAGE_TEXT.primary, lineHeight: 1 }}>{(active ? active.count : total).toLocaleString()}</Typography>
              <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, fontWeight: 600, mt: '3px', lineHeight: 1.2 }}>{active ? active.label : 'Total drivers'}</Typography>
              {active && <Typography sx={{ fontSize: FONT.caption, color: PAGE_TEXT.secondary, mt: '1px' }}>{active.percentage}% of all drivers</Typography>}
            </Box>
          </Box>

          {/* the legend says everything the chart says, in words: nothing depends on hovering or on colour alone */}
          <Box component="ul" sx={{ flex: '1 1 190px', m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {segments.map((seg) => {
              const isActive = activeKey === seg.key;
              return (
                <ChartTooltip key={seg.key} title={seg.label} lines={tooltipLines(seg)}>
                  <Box
                    component="li"
                    tabIndex={0}
                    onMouseEnter={() => setActiveKey(seg.key)}
                    onMouseLeave={() => setActiveKey(null)}
                    onFocus={() => setActiveKey(seg.key)}
                    onBlur={() => setActiveKey(null)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px',
                      padding: '6px 8px',
                      borderRadius: '8px',
                      cursor: 'default',
                      backgroundColor: isActive ? '#FFF4EA' : 'transparent',
                      opacity: seg.count === 0 && !isActive ? 0.6 : 1,
                      outline: 'none',
                      '&:focus-visible': { boxShadow: 'inset 0 0 0 2px #B34700' },
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Box aria-hidden sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: seg.color, flexShrink: 0 }} />
                      <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.primary, fontWeight: isActive ? 700 : 400 }}>{seg.label}</Typography>
                    </Box>
                    <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.primary, whiteSpace: 'nowrap' }}>
                      {seg.count.toLocaleString()}{' '}
                      <Box component="span" sx={{ color: PAGE_TEXT.secondary, fontWeight: 400 }}>({seg.percentage}%)</Box>
                    </Typography>
                  </Box>
                </ChartTooltip>
              );
            })}
          </Box>
        </Box>
      ) : (
        <DashboardEmpty icon={<BadgeIcon aria-hidden />} title="No driver verification requests yet" hint="Drivers appear here once accredited TODAs start registering them." />
      )}
    </DashboardCard>
  );
};
