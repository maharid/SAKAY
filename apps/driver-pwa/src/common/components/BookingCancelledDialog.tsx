import React from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import CancelIcon from '@mui/icons-material/Cancel';
import { localizeCancellationReason } from '@sakay/shared';

interface BookingCancelledDialogProps {
  open: boolean;
  language: 'tl' | 'en';
  /** Who cancelled, as the database saved it ('passenger', 'system', ...) */
  cancelledBy: string;
  /** The reason exactly as saved. It is shown in the driver's language when it is a known reason, and not at all when nothing real was saved. */
  reason: string;
  onClose: () => void;
}

/** Shown to the driver when a booking was cancelled while it was theirs: says who cancelled, and the reason when there is one. */
const BookingCancelledDialog: React.FC<BookingCancelledDialogProps> = ({ open, language, cancelledBy, reason, onClose }) => {
  const byPassenger = cancelledBy === 'passenger';
  const shownReason = localizeCancellationReason(reason, language);
  const sentence = byPassenger
    ? language === 'tl' ? 'Kinansela ng pasahero ang booking.' : 'The passenger has cancelled the booking.'
    : language === 'tl' ? 'Nakansela ang booking.' : 'The booking has been cancelled.';

  return (
    <Dialog open={open} onClose={onClose} slotProps={{ paper: { sx: { borderRadius: '24px', p: 1.5, backgroundColor: '#FFFFFF', maxWidth: '380px', width: '90%' } } }}>
      <DialogTitle sx={{ textAlign: 'center', pt: 2, pb: 1 }}>
        <CancelIcon sx={{ fontSize: 48, color: '#EF4444', mb: 1 }} />
        <Typography sx={{ fontSize: '18px', fontWeight: 700, color: '#0F172A', fontFamily: 'Poppins, sans-serif' }}>
          {language === 'tl' ? 'Kanselado ang Biyahe' : 'Trip Cancelled'}
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ textAlign: 'center', pb: 2 }}>
        <Typography sx={{ fontSize: '14px', color: '#475569', fontWeight: 600, fontFamily: 'Poppins, sans-serif' }}>{sentence}</Typography>
        {shownReason && (
          <Box sx={{ mt: 1.5, p: '10px 14px', backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '12px' }}>
            <Typography sx={{ fontSize: '13px', color: '#B91C1C', fontWeight: 600, fontFamily: 'Poppins, sans-serif', overflowWrap: 'anywhere' }}>
              {language === 'tl' ? 'Dahilan:' : 'Reason:'} &ldquo;{shownReason}&rdquo;
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2, pt: 0 }}>
        <Button
          fullWidth
          variant="contained"
          onClick={onClose}
          sx={{
            height: 46,
            borderRadius: '14px',
            backgroundColor: '#FF6600',
            color: '#FFFFFF',
            fontWeight: 700,
            fontSize: '14px',
            textTransform: 'none',
            fontFamily: 'Poppins, sans-serif',
            boxShadow: '0 4px 14px rgba(255, 102, 0, 0.25)',
            '&:hover': { backgroundColor: '#E65C00' },
          }}
        >
          {language === 'tl' ? 'OK (Bumalik sa Home)' : 'OK (Return Home)'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default BookingCancelledDialog;
