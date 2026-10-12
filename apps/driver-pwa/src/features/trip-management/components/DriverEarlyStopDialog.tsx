import React, { useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Radio, RadioGroup, TextField, Typography } from '@mui/material';
import { DRIVER_EARLY_STOP_REASONS, type DriverEarlyStopReason } from '@sakay/shared';

interface DriverEarlyStopDialogProps {
  open: boolean;
  language: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: DriverEarlyStopReason, note: string) => void;
}

/**
 * Rules 13.7 / 29.3: the DRIVER ends the trip before the destination (vehicle trouble, a safety concern, an emergency, a dispute with the passenger). The passenger
 * pays only for the distance travelled; the TODA Administrator reviews every early stop, and a strike (DRV_EARLY_STOP) is only ever confirmed by the
 * administrator and never for a breakdown, a safety concern or an emergency (decision D9-8).
 */
const DriverEarlyStopDialog: React.FC<DriverEarlyStopDialogProps> = ({ open, language, busy, onClose, onConfirm }) => {
  const tl = language === 'tl';
  const [reason, setReason] = useState<DriverEarlyStopReason>('vehicle_breakdown');
  const [note, setNote] = useState('');
  const valid = DRIVER_EARLY_STOP_REASONS.find((r) => r.code === reason)?.valid ?? false;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" slotProps={{ paper: { sx: { borderRadius: '24px', p: 1 } } }}>
      <DialogTitle sx={{ fontWeight: 700, fontSize: '17px', color: '#0F172A', fontFamily: 'Poppins, sans-serif' }}>{tl ? 'Itigil ang Biyahe Bago ang Destinasyon' : 'Stop the Trip Early'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Typography sx={{ fontSize: '13px', color: '#64748B', lineHeight: 1.5, fontFamily: 'Poppins, sans-serif' }}>
          {tl
            ? 'Huminto muna sa ligtas na lugar. Babayaran lamang ng pasahero ang layong nalakbay. Susuriin ng TODA Administrator ang bawat maagang paghinto.'
            : 'Stop in a safe place first. The passenger pays only for the distance travelled. The TODA Administrator reviews every early stop.'}
        </Typography>
        <RadioGroup value={reason} onChange={(e) => setReason(e.target.value as DriverEarlyStopReason)} aria-label={tl ? 'Dahilan' : 'Reason'}>
          {DRIVER_EARLY_STOP_REASONS.map((r) => (
            <FormControlLabel key={r.code} value={r.code} control={<Radio sx={{ color: '#CBD5E1', '&.Mui-checked': { color: '#FF6600' } }} />} label={r[tl ? 'tl' : 'en']} sx={{ '& .MuiFormControlLabel-label': { fontSize: '14px', color: '#0F172A', fontFamily: 'Poppins, sans-serif' } }} />
          ))}
        </RadioGroup>
        <Box sx={{ p: '10px 12px', borderRadius: '12px', backgroundColor: valid ? '#F0FDF4' : '#FFFBEB', border: `1px solid ${valid ? '#86EFAC' : '#FCD34D'}` }}>
          <Typography sx={{ fontSize: '12px', lineHeight: 1.45, color: valid ? '#166534' : '#78350F', fontFamily: 'Poppins, sans-serif' }}>
            {valid
              ? tl ? 'Walang parusa para sa ganitong dahilan.' : 'No penalty for this kind of reason.'
              : tl ? 'Maaaring may parusa kung makumpirma ng TODA Administrator na walang makatwirang dahilan.' : 'A penalty is possible if the TODA Administrator confirms there was no valid reason.'}
          </Typography>
        </Box>
        <TextField
          fullWidth
          size="small"
          multiline
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 300))}
          label={tl ? 'Ano ang nangyari? (opsyonal)' : 'What happened? (optional)'}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: '12px' } }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Button variant="outlined" fullWidth disabled={busy} onClick={onClose} sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 600, height: 44 }}>
          {tl ? 'Ituloy ang Biyahe' : 'Continue the Trip'}
        </Button>
        <Button
          variant="contained"
          fullWidth
          disabled={busy}
          onClick={() => onConfirm(reason, note.trim())}
          sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 700, height: 44, backgroundColor: '#B91C1C', boxShadow: 'none', '&:hover': { backgroundColor: '#991B1B', boxShadow: 'none' } }}
        >
          {busy ? (tl ? 'Itinitigil...' : 'Stopping...') : tl ? 'Itigil' : 'Stop the Trip'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default DriverEarlyStopDialog;
