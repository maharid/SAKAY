import React from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';

import type { CoverageGaps } from '../utils/dispatchInsights';

export interface CoverageGapsPanelProps {
  /** null while loading or when it could not be read */
  gaps: CoverageGaps | null;
  /** who is looking: the TODA Administrator sees only their own zone */
  audience: 'toda_admin' | 'lgu_admin';
  loading?: boolean;
}

const manila = (iso: string): string => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-';
};

/**
 * Rule 7.10: a barangay service zone where 5 or more bookings reached the live search or ended as No Driver Found within 24 hours is logged as a Coverage Gap
 * Indicator. The record is for the TODA's and the LGU's service planning and resource allocation ONLY: it never penalises a passenger or a driver, and nothing
 * here changes a ranking, a fare or a service zone.
 */
export const CoverageGapsPanel: React.FC<CoverageGapsPanelProps> = ({ gaps, audience, loading = false }) => (
  <Paper elevation={0} sx={{ p: 2.5, mb: 3, borderRadius: '16px', border: '1px solid #E2E8F0' }}>
    <Typography sx={{ fontWeight: 700, fontSize: '15px', color: '#0F172A', mb: 0.5 }}>Coverage gaps (Rule 7.10)</Typography>
    <Typography sx={{ fontSize: '12.5px', color: '#64748B', lineHeight: 1.5, mb: 1.5 }}>
      A zone is logged when {gaps?.events[0]?.threshold ?? 5} or more bookings reach the live search or end with no driver found within {gaps?.events[0]?.windowHours ?? 24} hours. For service
      planning and resource allocation only: nobody is penalised.{audience === 'toda_admin' ? ' You see your own zone.' : ''}
    </Typography>
    {loading ? (
      <Typography sx={{ fontSize: '13px', color: '#64748B' }}>Loading...</Typography>
    ) : gaps === null ? (
      <Typography sx={{ fontSize: '13px', color: '#B45309' }}>The indicators could not be read right now.</Typography>
    ) : gaps.zones.length === 0 ? (
      <Typography sx={{ fontSize: '13px', color: '#166534', fontWeight: 600 }}>No coverage gap was logged in the last {gaps.windowDays} days.</Typography>
    ) : (
      <>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {gaps.zones.map((z) => (
            <Box key={z.zone} sx={{ p: 1.25, borderRadius: '12px', border: '1px solid #FDBA74', backgroundColor: '#FFF7ED', display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
              <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#0F172A' }}>{z.zone}</Typography>
              <Typography sx={{ fontSize: '12.5px', color: '#7C2D12' }}>
                logged {z.timesLogged} time{z.timesLogged === 1 ? '' : 's'} in {gaps.windowDays} days (up to {z.mostBookings} bookings in a day), last {manila(z.lastLoggedAt)}
              </Typography>
            </Box>
          ))}
        </Box>
        <Typography sx={{ fontSize: '12px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', mt: 1.5, mb: 0.5 }}>Each time it was logged</Typography>
        <Box component="ul" sx={{ m: 0, pl: 2.5, fontSize: '12.5px', color: '#334155', lineHeight: 1.6 }}>
          {gaps.events.slice(0, 15).map((e, i) => (
            <li key={`${e.zone}-${e.loggedAt}-${i}`}>{manila(e.loggedAt)}: {e.zone}, {e.bookings} bookings</li>
          ))}
        </Box>
      </>
    )}
  </Paper>
);

export default CoverageGapsPanel;
