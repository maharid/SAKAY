import React from 'react';
import { Alert, Box, CircularProgress, Typography } from '@mui/material';

import { formatHistoryTime, verificationActorLine, verificationOutcomeTone } from '../utils/verificationHistory';
import type { VerificationHistoryEvent, VerificationOutcomeTone } from '../utils/verificationHistory';

export interface VerificationHistoryListProps {
  events: VerificationHistoryEvent[] | null;
  loading?: boolean;
  error?: string | null;
}

const TONE: Record<VerificationOutcomeTone, { dot: string; chipBg: string; chipFg: string }> = {
  success: { dot: '#16A34A', chipBg: '#DCFCE7', chipFg: '#166534' },
  info: { dot: '#2563EB', chipBg: '#DBEAFE', chipFg: '#1D4ED8' },
  warning: { dot: '#D97706', chipBg: '#FEF3C7', chipFg: '#92400E' },
  danger: { dot: '#DC2626', chipBg: '#FEE2E2', chipFg: '#991B1B' },
  neutral: { dot: '#94A3B8', chipBg: '#F1F5F9', chipFg: '#475569' },
};

/**
 * One driver's verification history, oldest first: the event, its exact time, who did it (TODA, LGU or the driver) and the outcome. The TODA's and the LGU's actions are told apart by
 * the line under each event. Used by the LGU and the TODA portal, so both read the same history.
 */
export const VerificationHistoryList: React.FC<VerificationHistoryListProps> = ({ events, loading = false, error = null }) => {
  if (loading && !events) {
    return (
      <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: '10px', py: '24px', justifyContent: 'center' }}>
        <CircularProgress size={20} sx={{ color: '#C75000' }} />
        <Typography sx={{ fontSize: '13px', color: '#4d4d52' }}>Loading the verification history...</Typography>
      </Box>
    );
  }
  if (error) return <Alert severity="warning" sx={{ borderRadius: '10px' }}>{error}</Alert>;
  if (!events || events.length === 0) {
    return (
      <Typography sx={{ fontSize: '13px', color: '#4d4d52', py: '16px', textAlign: 'center' }}>
        Nothing has been recorded about this driver's verification yet.
      </Typography>
    );
  }
  return (
    <Box component="ol" aria-label="Verification history" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column' }}>
      {events.map((e, i) => {
        const tone = TONE[verificationOutcomeTone(e.outcome)];
        const last = i === events.length - 1;
        return (
          <Box component="li" key={`${e.key}-${e.at}-${i}`} sx={{ display: 'flex', gap: '12px', position: 'relative', pb: last ? 0 : '16px' }}>
            <Box aria-hidden sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 12 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', mt: '5px', backgroundColor: tone.dot, flexShrink: 0 }} />
              {!last && <Box sx={{ flex: 1, width: '2px', backgroundColor: 'rgba(15, 23, 42, 0.1)', mt: '3px' }} />}
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 10px' }}>
                <Typography component="span" sx={{ fontSize: '13px', fontWeight: 700, color: '#1d1d1f', lineHeight: 1.4 }}>{e.label}</Typography>
                {e.outcome && (
                  <Box component="span" sx={{ px: '8px', py: '1px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 700, backgroundColor: tone.chipBg, color: tone.chipFg }}>{e.outcome}</Box>
                )}
              </Box>
              <Typography component="time" dateTime={e.at} sx={{ display: 'block', fontSize: '12px', color: '#4d4d52', mt: '1px' }}>{formatHistoryTime(e.at)}</Typography>
              <Typography sx={{ fontSize: '12px', color: '#4d4d52' }}>{verificationActorLine(e)}</Typography>
              {e.detail && <Typography sx={{ fontSize: '12.5px', color: '#1d1d1f', mt: '3px', overflowWrap: 'anywhere' }}>{e.detail}</Typography>}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};
