import React from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import CancelIcon from '@mui/icons-material/Cancel';

interface BookingGivenAwayDialogProps {
  open: boolean;
  language: string;
  onClose: () => void;
}

/**
 * Shown when the booking is no longer the driver's: the system cancelled it on his behalf (he did not start toward the passenger, or he could
 * not be reached) and gave it to another driver. The reason and any strike are in his notifications.
 */
const BookingGivenAwayDialog: React.FC<BookingGivenAwayDialogProps> = ({ open, language, onClose }) => (
  <Dialog open={open} onClose={onClose} slotProps={{ paper: { sx: { borderRadius: '24px', p: 1.5, maxWidth: '380px', width: '90%' } } }}>
    <DialogTitle sx={{ textAlign: 'center', pt: 2, pb: 1 }}>
      <CancelIcon sx={{ fontSize: 48, color: '#EF4444', mb: 1 }} />
      <Typography sx={{ fontSize: '18px', fontWeight: 800, color: '#0F172A', fontFamily: 'Poppins, sans-serif' }}>
        {language === 'tl' ? 'Nakansela ang Booking' : 'Booking Cancelled'}
      </Typography>
    </DialogTitle>
    <DialogContent sx={{ textAlign: 'center', pb: 2 }}>
      <Typography sx={{ fontSize: '14px', color: '#475569', fontWeight: 600, fontFamily: 'Poppins, sans-serif' }}>
        {language === 'tl'
          ? 'Nakansela ng sistema ang booking na ito at ibinigay sa ibang drayber, dahil hindi ka nakapagsimula papunta sa pasahero o hindi ka makontak. Tingnan ang iyong mga abiso para sa dahilan at sa anumang strike.'
          : 'The system cancelled this booking and gave it to another driver, because you did not start toward the passenger or could not be reached. See your notifications for the reason and any strike. You can appeal through the Exemption & Appeal process.'}
      </Typography>
    </DialogContent>
    <DialogActions sx={{ p: 2, pt: 0 }}>
      <Button
        fullWidth
        variant="contained"
        onClick={onClose}
        sx={{ height: 46, borderRadius: '14px', backgroundColor: '#FF6B00', fontWeight: 800, fontSize: '14px', textTransform: 'none', fontFamily: 'Poppins, sans-serif', '&:hover': { backgroundColor: '#E66000' } }}
      >
        {language === 'tl' ? 'OK (Bumalik sa Home)' : 'OK (Return Home)'}
      </Button>
    </DialogActions>
  </Dialog>
);

export default BookingGivenAwayDialog;
