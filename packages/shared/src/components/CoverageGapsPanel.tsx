import React, { useId, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';

import type { CoverageGaps } from '../utils/dispatchInsights';
import { CheckCircleGlyph, WarningGlyph } from './glyphs';

export interface CoverageGapsPanelProps {
  /** null while loading or when it could not be read */
  gaps: CoverageGaps | null;
  /** who is looking: the TODA Administrator sees only their own zone */
  audience: 'toda_admin' | 'lgu_admin';
  loading?: boolean;
  /**
   * One slim status line with the long explanation behind "What is this?". A coverage gap, when there is one, still shows in full.
   * Off by default: the LGU portal keeps the original look.
   */
  compact?: boolean;
}

const manila = (iso: string): string => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-';
};

const explanation = (gaps: CoverageGaps | null, audience: 'toda_admin' | 'lgu_admin'): string =>
  `A zone is logged when ${gaps?.events[0]?.threshold ?? 5} or more bookings reach the live search or end with no driver found within ${gaps?.events[0]?.windowHours ?? 24} hours. For service planning and resource allocation only: nobody is penalised.${audience === 'toda_admin' ? ' You see your own zone.' : ''}`;

/** The logged zones and, below them, each time a gap was logged. */
const GapDetails: React.FC<{ gaps: CoverageGaps; dense?: boolean }> = ({ gaps, dense = false }) => (
  <>
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: dense ? '6px' : 1 }}>
      {gaps.zones.map((z) => (
        <Box key={z.zone} sx={{ p: dense ? '8px 10px' : 1.25, borderRadius: dense ? '10px' : '12px', border: '1px solid #FDBA74', backgroundColor: '#FFF7ED', display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: dense ? '12px' : '14px', fontWeight: 700, color: '#0F172A' }}>{z.zone}</Typography>
          <Typography sx={{ fontSize: dense ? '11.5px' : '12.5px', color: '#7C2D12' }}>
            logged {z.timesLogged} time{z.timesLogged === 1 ? '' : 's'} in {gaps.windowDays} days (up to {z.mostBookings} bookings in a day), last {manila(z.lastLoggedAt)}
          </Typography>
        </Box>
      ))}
    </Box>
    <Typography sx={{ fontSize: dense ? '10.5px' : '12px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', mt: dense ? '10px' : 1.5, mb: dense ? '3px' : 0.5 }}>Each time it was logged</Typography>
    <Box component="ul" sx={{ m: 0, pl: dense ? '19px' : 2.5, fontSize: dense ? '11.5px' : '12.5px', color: '#334155', lineHeight: 1.6 }}>
      {gaps.events.slice(0, 15).map((e, i) => (
        <li key={`${e.zone}-${e.loggedAt}-${i}`}>{manila(e.loggedAt)}: {e.zone}, {e.bookings} bookings</li>
      ))}
    </Box>
  </>
);

const CompactCoverageGaps: React.FC<CoverageGapsPanelProps> = ({ gaps, audience, loading = false }) => {
  const [showWhy, setShowWhy] = useState(false);
  const whyId = useId();
  const hasGaps = gaps !== null && gaps.zones.length > 0;
  const needsAttention = !loading && (gaps === null || hasGaps);
  const allClear = !loading && gaps !== null && !hasGaps;

  const message = loading
    ? 'Checking...'
    : gaps === null
    ? 'Could not be checked right now.'
    : hasGaps
    ? `${gaps.zones.length} zone${gaps.zones.length === 1 ? '' : 's'} logged in the last ${gaps.windowDays} days.`
    : `None logged in the last ${gaps.windowDays} days.`;

  return (
    <Paper
      elevation={0}
      sx={{
        mb: '19px',
        px: '19px',
        py: '5px',
        borderRadius: '13px',
        border: `1px solid ${needsAttention ? '#FDBA74' : 'rgba(15, 23, 42, 0.1)'}`,
        backgroundColor: needsAttention ? '#FFF7ED' : '#FFFFFF',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        {allClear && <CheckCircleGlyph aria-hidden sx={{ color: '#15803D', fontSize: 18 }} />}
        {needsAttention && <WarningGlyph aria-hidden sx={{ color: '#B45309', fontSize: 18 }} />}
        <Typography component="h2" sx={{ fontWeight: 700, fontSize: '13px', color: '#0F172A' }}>Coverage gaps</Typography>
        <Typography sx={{ fontSize: '12px', fontWeight: needsAttention ? 700 : 500, color: needsAttention ? '#7C2D12' : allClear ? '#166534' : '#475569' }}>{message}</Typography>
        <Button
          size="small"
          onClick={() => setShowWhy((v) => !v)}
          aria-expanded={showWhy}
          aria-controls={whyId}
          sx={{ ml: 'auto', textTransform: 'none', fontWeight: 600, fontSize: '12px', minHeight: 36, px: '10px', color: '#334155', '@media (pointer: coarse)': { minHeight: 44 }, '&:focus-visible': { outline: '2px solid #1d1d1f', outlineOffset: 2 } }}
        >
          {showWhy ? 'Hide' : 'What is this?'}
        </Button>
      </Box>
      {showWhy && (
        <Typography id={whyId} sx={{ fontSize: '11.5px', color: '#475569', lineHeight: 1.6, mt: '6px', pb: '6px' }}>{explanation(gaps, audience)}</Typography>
      )}
      {hasGaps && gaps && (
        <Box sx={{ mt: '10px', pb: '8px' }}>
          <GapDetails gaps={gaps} dense />
        </Box>
      )}
    </Paper>
  );
};

/**
 * Rule 7.10: a barangay service zone where 5 or more bookings reached the live search or ended as No Driver Found within 24 hours is logged as a Coverage Gap
 * Indicator. The record is for the TODA's and the LGU's service planning and resource allocation ONLY: it never penalises a passenger or a driver, and nothing
 * here changes a ranking, a fare or a service zone.
 */
export const CoverageGapsPanel: React.FC<CoverageGapsPanelProps> = (props) => {
  const { gaps, audience, loading = false, compact = false } = props;
  if (compact) return <CompactCoverageGaps {...props} />;
  return (
    <Paper elevation={0} sx={{ p: 2.5, mb: 3, borderRadius: '16px', border: '1px solid #E2E8F0' }}>
      <Typography sx={{ fontWeight: 700, fontSize: '15px', color: '#0F172A', mb: 0.5 }}>Coverage gaps</Typography>
      <Typography sx={{ fontSize: '12.5px', color: '#64748B', lineHeight: 1.5, mb: 1.5 }}>{explanation(gaps, audience)}</Typography>
      {loading ? (
        <Typography sx={{ fontSize: '13px', color: '#64748B' }}>Loading...</Typography>
      ) : gaps === null ? (
        <Typography sx={{ fontSize: '13px', color: '#B45309' }}>The indicators could not be read right now.</Typography>
      ) : gaps.zones.length === 0 ? (
        <Typography sx={{ fontSize: '13px', color: '#166534', fontWeight: 600 }}>No coverage gap was logged in the last {gaps.windowDays} days.</Typography>
      ) : (
        <GapDetails gaps={gaps} />
      )}
    </Paper>
  );
};

export default CoverageGapsPanel;
