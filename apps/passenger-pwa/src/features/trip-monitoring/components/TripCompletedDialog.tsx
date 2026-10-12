import React from 'react';
import { Box, Button, Dialog, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { describePayment, formatPeso, LATE_FARE_DISPUTE_WINDOW_HOURS, type TripEndState } from '@sakay/shared';

interface TripCompletedDialogProps {
  open: boolean;
  language: string;
  fare: number;
  state: TripEndState | null;
  onRate: () => void;
  /** Rule 16.6 / D9-10: a fare finished without the passenger's confirmation can be reported for 24 hours */
  onReport: () => void;
  /** Rule 13.5: an administrative review of a Safety Concern early end */
  onAskReview: () => void;
}

/** The trip is over: the driver tapped Payment Received (Rule 18.3). What is left for the passenger: rate the driver, and (when it applies) report the fare or ask for the review. */
const TripCompletedDialog: React.FC<TripCompletedDialogProps> = ({ open, language, fare, state, onRate, onReport, onAskReview }) => {
  const tl = language === 'tl';
  const canReview = state?.earlyEnd?.kind === 'SAFETY' && !state.dispute;
  const dispute = state?.dispute ?? null;
  return (
    <Dialog open={open} fullWidth maxWidth="xs" aria-labelledby="trip-completed-title" slotProps={{ paper: { sx: { borderRadius: '24px', m: 2, width: 'calc(100% - 32px)', p: { xs: 2.5, sm: 3 }, textAlign: 'center' } } }}>
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1 }}>
        <CheckCircleIcon aria-hidden sx={{ fontSize: 44, color: '#15803D' }} />
      </Box>
      <Typography id="trip-completed-title" component="h2" sx={{ fontSize: '18px', fontWeight: 700, color: '#0F172A', mb: 0.5 }}>
        {tl ? 'Nakumpleto na ang Biyahe!' : 'Trip Completed!'}
      </Typography>
      <Typography sx={{ fontSize: '30px', fontWeight: 700, lineHeight: 1.2, color: '#FF6600', fontVariantNumeric: 'tabular-nums' }}>{formatPeso(fare)}</Typography>
      <Typography sx={{ fontSize: '13px', color: '#64748B', mb: 2 }}>{state ? describePayment(state, tl ? 'tl' : 'en') : tl ? 'Cash' : 'Cash'}</Typography>

      {dispute && (
        <Box role="status" sx={{ p: '10px 12px', borderRadius: '12px', backgroundColor: '#FFFBEB', border: '1px solid #FCD34D', mb: 1.5, textAlign: 'left' }}>
          <Typography sx={{ fontSize: '12px', lineHeight: 1.45, color: '#78350F' }}>
            {dispute.status === 'Resolved'
              ? tl ? 'Nasuri na ang pamasahe ng mga administrator.' : 'The administrators have reviewed the fare.'
              : tl ? 'Ang pamasahe ay nasa pagsusuri ng administrator.' : 'The fare is being reviewed by an administrator.'}
          </Typography>
        </Box>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Button
          variant="contained"
          fullWidth
          onClick={onRate}
          sx={{ minHeight: 52, borderRadius: '14px', backgroundColor: '#15803D', fontWeight: 700, fontSize: '15px', textTransform: 'none', boxShadow: 'none', '&:hover': { backgroundColor: '#166534', boxShadow: 'none' } }}
        >
          {tl ? 'I-rate ang Drayber' : 'Rate Your Driver'}
        </Button>
        {state?.lateDisputeOpen && !state.fareDiscrepancyAt && (
          <Button variant="outlined" fullWidth color="error" onClick={onReport} sx={{ minHeight: 44, borderRadius: '14px', textTransform: 'none', fontWeight: 600, fontSize: '13px', borderColor: '#CBD5E1', color: '#B91C1C' }}>
            {tl ? `I-report ang pamasahe (${LATE_FARE_DISPUTE_WINDOW_HOURS} oras)` : `Report the fare (${LATE_FARE_DISPUTE_WINDOW_HOURS} hours)`}
          </Button>
        )}
        {canReview && (
          <Button variant="outlined" fullWidth onClick={onAskReview} sx={{ minHeight: 44, borderRadius: '14px', textTransform: 'none', fontWeight: 600, fontSize: '13px', borderColor: '#CBD5E1', color: '#334155' }}>
            {tl ? 'Humiling ng pagsusuri ng pamasahe' : 'Ask for a review of the fare'}
          </Button>
        )}
      </Box>
    </Dialog>
  );
};

export default TripCompletedDialog;
