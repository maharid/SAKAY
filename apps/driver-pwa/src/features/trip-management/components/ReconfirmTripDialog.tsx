import React, { useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import WifiIcon from '@mui/icons-material/Wifi';
import { useInFlight } from '@sakay/shared';
import type { TripReconfirmStatus } from '@sakay/shared';

import { reconfirmTrip } from '../../../services/bookingClockService';

interface ReconfirmTripDialogProps {
  open: boolean;
  bookingId: string;
  language: string;
  /** When the database marked the silence (shown in Manila time) */
  interruptedSince: string | null;
  /** The database accepted the answer: the screen reads the trip again */
  onAnswered: () => void;
}

const manilaTime = (iso: string | null): string => {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });
};

/**
 * Rule 9.5: the connection was lost during this trip and is back. Until the driver says whether the trip is still going on or has ended, the
 * database will not move it to fare finalisation, so this cannot be dismissed: it asks once, in two big buttons. The answer is the driver's;
 * a trip the passenger or an administrator has already closed simply stops asking (the screen reads the booking again).
 */
const ReconfirmTripDialog: React.FC<ReconfirmTripDialogProps> = ({ open, bookingId, language, interruptedSince, onAnswered }) => {
  const tl = language === 'tl';
  const flight = useInFlight();
  const [error, setError] = useState<string | null>(null);
  const since = manilaTime(interruptedSince);

  const answer = (status: TripReconfirmStatus) =>
    flight.run(async () => {
      setError(null);
      const result = await reconfirmTrip(bookingId, status);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onAnswered();
    });

  return (
    <Dialog open={open} maxWidth="xs" fullWidth slotProps={{ paper: { sx: { borderRadius: '24px', p: 1 } } }}>
      <DialogTitle sx={{ fontWeight: 700, fontSize: '16px', color: '#0F172A', display: 'flex', alignItems: 'center', gap: 1 }}>
        <WifiIcon sx={{ color: '#16A34A' }} />
        {tl ? 'Bumalik ang koneksyon — kumpirmahin ang biyahe' : 'Connection restored — confirm your trip'}
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: '14px', color: '#334155', lineHeight: 1.5 }}>
          {tl
            ? `Nawalan kami ng kontak sa iyo${since ? ` noong ${since}` : ''} habang nasa biyahe. Sabihin kung nasaan na ang biyahe para matapos ito at makumpirma ang pamasahe.`
            : `We lost contact with you${since ? ` at ${since}` : ''} during the trip. Tell us where the trip stands, so it can be finished and the fare confirmed.`}
        </Typography>
        {error && (
          <Alert severity="warning" sx={{ mt: 1.5, borderRadius: '12px', fontSize: '12px' }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2, pt: 0, display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'stretch' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Button
            variant="contained"
            disabled={flight.busy}
            onClick={() => answer('ongoing')}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '12px', minHeight: 48, backgroundColor: '#FF6600', '&:hover': { backgroundColor: '#E05300' } }}
          >
            {tl ? 'Tuloy pa ang biyahe' : 'The trip is still going on'}
          </Button>
          <Button
            variant="outlined"
            disabled={flight.busy}
            onClick={() => answer('ended')}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '12px', minHeight: 48, borderColor: '#CBD5E1', color: '#334155' }}
          >
            {tl ? 'Tapos na ang biyahe' : 'The trip has ended'}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
};

export default ReconfirmTripDialog;
