import React, { useState } from 'react';
import { Box, Typography } from '@mui/material';
import BadgeIcon from '@mui/icons-material/Badge';

import { DashboardCard, DashboardEmpty } from './DashboardCard';
import { FONT } from '../../styles/density';
import { PAGE_TEXT } from '../../styles/pageTheme';

interface SegmentData {
  label: string;
  count: number;
  percentage: number;
  color: string;
}

interface DriverVerificationCardProps {
  data?: {
    total: number;
    approved: number;
    pending: number;
    rejected: number;
    suspended: number;
  };
}

export const DriverVerificationCard: React.FC<DriverVerificationCardProps> = ({ data }) => {
  const [hoveredSegment, setHoveredSegment] = useState<SegmentData | null>(null);

  const total = data?.total || 0;
  const approved = data?.approved || 0;
  const pending = data?.pending || 0;
  const rejected = data?.rejected || 0;
  const suspended = data?.suspended || 0;

  const segments: SegmentData[] = [
    {
      label: 'Approved',
      count: approved,
      percentage: total > 0 ? Math.round((approved / total) * 100) : 0,
      color: '#34A853',
    },
    {
      label: 'Pending',
      count: pending,
      percentage: total > 0 ? Math.round((pending / total) * 100) : 0,
      color: '#FBBC04',
    },
    {
      label: 'Rejected',
      count: rejected,
      percentage: total > 0 ? Math.round((rejected / total) * 100) : 0,
      color: '#EA4335',
    },
    {
      label: 'Suspended',
      count: suspended,
      percentage: total > 0 ? Math.round((suspended / total) * 100) : 0,
      color: '#9AA0A6',
    },
  ];

  const size = 150;
  const strokeWidth = 22;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let cumulativeOffset = 0;

  return (
    <DashboardCard title="Driver verification" action={{ label: 'View all', to: '/drivers', ariaLabel: 'View all drivers' }}>
      {total > 0 ? (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1, flexWrap: 'wrap', gap: '20px' }}>
          <Box
            sx={{
              position: 'relative',
              width: 165,
              height: 165,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              mx: 'auto',
            }}
          >
            <svg
              width={size}
              height={size}
              viewBox={`0 0 ${size} ${size}`}
              style={{ overflow: 'visible' }}
              role="img"
              aria-label={`${total} drivers: ${segments.map((seg) => `${seg.count} ${seg.label.toLowerCase()}`).join(', ')}`}
            >
              {segments.map((seg, idx) => {
                const strokeDasharray = `${(seg.percentage / 100) * circumference} ${circumference}`;
                const strokeDashoffset = -cumulativeOffset;
                cumulativeOffset += (seg.percentage / 100) * circumference;
                const isHovered = hoveredSegment?.label === seg.label;

                return (
                  <circle
                    key={idx}
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="transparent"
                    stroke={seg.color}
                    strokeWidth={isHovered ? strokeWidth + 5 : strokeWidth}
                    strokeDasharray={strokeDasharray}
                    strokeDashoffset={strokeDashoffset}
                    transform={`rotate(-90 ${size / 2} ${size / 2})`}
                    style={{
                      transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                      cursor: 'pointer',
                      opacity: hoveredSegment && !isHovered ? 0.45 : 1,
                    }}
                    onMouseEnter={() => setHoveredSegment(seg)}
                    onMouseLeave={() => setHoveredSegment(null)}
                  />
                );
              })}
            </svg>

            <Box
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
              }}
            >
              <Typography
                sx={{
                  fontSize: FONT.pageTitle,
                  fontWeight: 700,
                  color: PAGE_TEXT.primary,
                  lineHeight: 1,
                }}
              >
                {hoveredSegment ? hoveredSegment.count : total}
              </Typography>
              <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, fontWeight: 500, mt: '3px' }}>
                {hoveredSegment ? hoveredSegment.label : 'Total drivers'}
              </Typography>
            </Box>
          </Box>

          {/* The legend says everything the chart says, in words: nothing depends on hovering or on colour alone */}
          <Box component="ul" sx={{ flex: '1 1 160px', m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {segments.map((seg) => {
              const isHovered = hoveredSegment?.label === seg.label;

              return (
                <Box
                  component="li"
                  key={seg.label}
                  onMouseEnter={() => setHoveredSegment(seg)}
                  onMouseLeave={() => setHoveredSegment(null)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    padding: '6px 8px',
                    borderRadius: '8px',
                    backgroundColor: isHovered ? '#FAFAF8' : 'transparent',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Box aria-hidden sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: seg.color, flexShrink: 0 }} />
                    <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.primary }}>{seg.label}</Typography>
                  </Box>
                  <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.primary, whiteSpace: 'nowrap' }}>
                    {seg.count}{' '}
                    <Box component="span" sx={{ color: PAGE_TEXT.secondary, fontWeight: 400 }}>({seg.percentage}%)</Box>
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </Box>
      ) : (
        <DashboardEmpty
          icon={<BadgeIcon aria-hidden />}
          title="No driver verification requests yet"
          hint="Drivers appear here once accredited TODAs start registering them."
        />
      )}
    </DashboardCard>
  );
};
