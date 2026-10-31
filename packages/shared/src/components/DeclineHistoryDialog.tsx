import React from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import Typography from '@mui/material/Typography';

import { DECLINE_REASON_LABELS, declineRatePercent } from '../utils/dispatchInsights';
import type { DeclineHistory } from '../utils/dispatchInsights';
import { SakayDialogTitle } from './SakayDialogTitle';

export interface DeclineHistoryDialogProps {
  open: boolean;
  onClose: () => void;
  driverName: string;
  /** null while loading or when it could not be read (see `failed`) */
  history: DeclineHistory | null;
  loading: boolean;
  failed: boolean;
}

const manila = (iso: string | null): string => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-';
};

const Stat: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <Box sx={{ minWidth: 92 }}>
    <Typography sx={{ fontSize: '20px', fontWeight: 700, color: '#0F172A', lineHeight: 1.1 }}>{value}</Typography>
    <Typography sx={{ fontSize: '11.5px', color: '#64748B' }}>{label}</Typography>
  </Box>
);

/**
 * Rule 7.9: the booking-offer history of a driver, for the TODA or LGU Administrator who reviews a pattern of refusals. A driver may decline without a strike; a
 * repeated or unreasonable pattern while Online is only a flag, and a sanction needs the administrator's confirmation after weighing the stated reasons, the
 * booking history and the circumstances. This shows exactly those: no judgement is made here.
 */
export const DeclineHistoryDialog: React.FC<DeclineHistoryDialogProps> = ({ open, onClose, driverName, history, loading, failed }) => (
  <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
    <SakayDialogTitle onClose={onClose} sx={{ fontWeight: 700, fontSize: '16px' }}>Booking offers of {driverName}</SakayDialogTitle>
    <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {loading && <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress size={28} /></Box>}
      {failed && !loading && <Alert severity="warning">The history could not be read. It is available only for a driver of your own TODA, or to the LGU Administrator.</Alert>}
      {history && !loading && (
        <>
          <Typography sx={{ fontSize: '12.5px', color: '#64748B', lineHeight: 1.5 }}>
            The last {history.windowDays} days. A decline is never a strike by itself; a pattern is for you to weigh with the reasons below.
          </Typography>
          <Box sx={{ display: 'flex', gap: 2.5, flexWrap: 'wrap' }}>
            <Stat label="offers" value={history.offers} />
            <Stat label="accepted" value={history.accepted} />
            <Stat label="declined" value={`${history.declined} (${declineRatePercent(history)}%)`} />
            <Stat label="not answered" value={history.unanswered} />
            <Stat label="withdrawn" value={history.withdrawn} />
            <Stat label="trips completed" value={history.completedTrips} />
          </Box>
          {history.openReviewFlags > 0 && <Alert severity="info" sx={{ borderRadius: '10px' }}>{history.openReviewFlags} open review flag(s) about repeated declines are waiting for a decision.</Alert>}
          {history.bookingsPausedUntil && Date.parse(history.bookingsPausedUntil) > Date.now() && (
            <Typography sx={{ fontSize: '12.5px', color: '#475569' }}>Bookings are paused until {manila(history.bookingsPausedUntil)} (the driver paused them).</Typography>
          )}
          <Box>
            <Typography sx={{ fontSize: '12px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', mb: 0.5 }}>Reasons given</Typography>
            {history.byReason.length === 0 ? (
              <Typography sx={{ fontSize: '13px', color: '#64748B' }}>No declines in this period.</Typography>
            ) : (
              history.byReason.map((r) => (
                <Typography key={r.reason} sx={{ fontSize: '13px', color: '#334155' }}>
                  {DECLINE_REASON_LABELS[r.reason] ?? r.reason}: <b>{r.count}</b>
                </Typography>
              ))
            )}
          </Box>
          {history.declines.length > 0 && (
            <Box>
              <Typography sx={{ fontSize: '12px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', mb: 0.5 }}>Latest declines</Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5, fontSize: '12.5px', color: '#334155', lineHeight: 1.6 }}>
                {history.declines.slice(0, 15).map((d) => (
                  <li key={d.attemptId}>
                    {manila(d.declinedAt)}: {DECLINE_REASON_LABELS[d.reason] ?? d.reason}
                    {d.distanceM !== null ? `, ${Math.round(d.distanceM)} m from the pickup` : ''}
                    {d.etaSeconds !== null ? `, ETA ${Math.round(d.etaSeconds / 60)} min` : ''}
                  </li>
                ))}
              </Box>
            </Box>
          )}
        </>
      )}
    </DialogContent>
    <DialogActions sx={{ p: 2 }}>
      <Button onClick={onClose} sx={{ textTransform: 'none', fontWeight: 600 }}>Close</Button>
    </DialogActions>
  </Dialog>
);

export default DeclineHistoryDialog;
