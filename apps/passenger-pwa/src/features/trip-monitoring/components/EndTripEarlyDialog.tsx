import React, { useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Radio, RadioGroup, TextField, Typography } from '@mui/material';
import { PASSENGER_EARLY_END_REASONS, type PassengerEarlyEndReason } from '@sakay/shared';

interface EndTripEarlyDialogProps {
  open: boolean;
  language: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: PassengerEarlyEndReason, note: string) => void;
}

/**
 * Rule 13.2: End Trip (Early) is a REQUEST to the driver. The passenger says why; the driver stops in a safe place and ends the trip. Changed plans, walking the
 * rest of the way or an earlier drop-off are charged the greater of the fare accepted at booking and the distance travelled (Rule 13.4); a Safety Concern is
 * charged the distance travelled, provisionally, and an administrator can review it (Rule 13.5).
 */
const EndTripEarlyDialog: React.FC<EndTripEarlyDialogProps> = ({ open, language, busy, onClose, onConfirm }) => {
  const tl = language === 'tl';
  const [reason, setReason] = useState<PassengerEarlyEndReason>('changed_plans');
  const [note, setNote] = useState('');
  const safety = reason === 'safety_concern';

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" slotProps={{ paper: { sx: { borderRadius: '24px', p: 1 } } }}>
      <DialogTitle sx={{ fontWeight: 700, fontSize: '17px', color: '#0F172A' }}>{tl ? 'Tapusin nang Maaga ang Biyahe' : 'End Trip (Early)'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Typography sx={{ fontSize: '13px', color: '#64748B', lineHeight: 1.5 }}>
          {tl
            ? 'Hihilingin namin sa drayber na huminto sa ligtas na lugar at tapusin ang biyahe. Hindi ito pagkansela.'
            : 'We will ask your driver to stop in a safe place and end the trip. This is not a cancellation.'}
        </Typography>
        <RadioGroup value={reason} onChange={(e) => setReason(e.target.value as PassengerEarlyEndReason)} aria-label={tl ? 'Dahilan' : 'Reason'}>
          {PASSENGER_EARLY_END_REASONS.map((r) => (
            <FormControlLabel key={r.code} value={r.code} control={<Radio sx={{ color: '#CBD5E1', '&.Mui-checked': { color: '#FF6600' } }} />} label={r[tl ? 'tl' : 'en']} sx={{ '& .MuiFormControlLabel-label': { fontSize: '14px', color: '#0F172A' } }} />
          ))}
        </RadioGroup>
        <Box sx={{ p: '10px 12px', borderRadius: '12px', backgroundColor: safety ? '#FEF2F2' : '#F8FAFC', border: `1px solid ${safety ? '#FCA5A5' : '#E2E8F0'}` }}>
          <Typography sx={{ fontSize: '12px', lineHeight: 1.45, color: safety ? '#991B1B' : '#475569' }}>
            {safety
              ? tl
                ? 'Babayaran mo ang layong nalakbay (pansamantala). Maaari kang humiling ng pagsusuri ng administrator pagkatapos.'
                : 'You pay for the distance travelled (provisionally). You can ask an administrator to review the fare afterwards.'
              : tl
              ? 'Babayaran mo ang mas mataas: ang pamasahe noong nag-book ka, o ang layong nalakbay.'
              : 'You pay the greater of the fare shown when you booked and the distance you travelled.'}
          </Typography>
        </Box>
        <TextField
          fullWidth
          size="small"
          multiline
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 300))}
          label={tl ? 'Dagdag na detalye (opsyonal)' : 'More detail (optional)'}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: '12px' } }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Button variant="outlined" fullWidth disabled={busy} onClick={onClose} sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 600, height: 44 }}>
          {tl ? 'Magpatuloy sa Biyahe' : 'Keep Riding'}
        </Button>
        <Button
          variant="contained"
          fullWidth
          disabled={busy}
          onClick={() => onConfirm(reason, note.trim())}
          sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 700, height: 44, backgroundColor: '#FF6600', boxShadow: 'none', '&:hover': { backgroundColor: '#E65C00', boxShadow: 'none' } }}
        >
          {busy ? (tl ? 'Ipinapadala...' : 'Sending...') : tl ? 'Hilingin' : 'Ask the Driver'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default EndTripEarlyDialog;
