import React, { useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';

import { FARE_SEAT_CAPACITY, TYPOGRAPHY_TOKENS, reportPassengerCount } from '@sakay/shared';
import { supabase } from '../../services/supabaseClient';
import { useLanguage } from '../../utils/LanguageContext';

interface PassengerCountReportDialogProps {
  open: boolean;
  bookingId: string;
  /** The number the passenger declared when booking */
  declaredCount: number;
  onClose: () => void;
  /** Called with a sentence for the driver once the database has recorded the report */
  onReported: (message: string) => void;
}

/**
 * Rules 14.7 / 29.17: more (or fewer) passengers than the booking declared. The driver reports the real number BEFORE the trip is finished: the fare of a shared
 * trip then uses it, and the LGU Administrator is told when the booking was under-declared (a strike exists only after that administrator confirms it). He may
 * refuse to start the trip until the booking is corrected or the extra passengers get down: that is his right and needs no button.
 */
export const PassengerCountReportDialog: React.FC<PassengerCountReportDialogProps> = ({ open, bookingId, declaredCount, onClose, onReported }) => {
  const { language } = useLanguage();
  const tl = language === 'tl';
  const [count, setCount] = useState<number>(Math.min(10, declaredCount + 1));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    const result = await reportPassengerCount(supabase, bookingId, count, note.trim() || null);
    setBusy(false);
    if (!result.ok) {
      setError(result.code === 'NETWORK' ? (tl ? 'Hindi maabot ang server. Pakisubukang muli.' : 'The server could not be reached. Please try again.') : result.error || (tl ? 'Hindi naitala ang ulat.' : 'The report could not be saved.'));
      return;
    }
    const over = result.data?.over_capacity === true;
    onReported(
      over
        ? tl
          ? `Naitala: ${count} pasahero. Lampas ito sa ${FARE_SEAT_CAPACITY} na upuan: huwag mong simulan ang biyahe hangga't hindi bumababa ang sobra.`
          : `Recorded: ${count} passengers. That is more than the ${FARE_SEAT_CAPACITY} seats: do not start the trip until the extra passengers get down.`
        : tl
        ? `Naitala: ${count} pasahero. Itatama ang pamasahe ng shared trip ayon sa bilang na ito.`
        : `Recorded: ${count} passenger(s). The fare of a shared trip will use this number.`
    );
    onClose();
  };

  return (
    <Dialog open={open} maxWidth="xs" fullWidth onClose={() => !busy && onClose()}>
      <DialogTitle sx={{ fontWeight: 700, fontSize: TYPOGRAPHY_TOKENS.fontSize.section }}>
        {tl ? 'Iba ang bilang ng pasahero?' : 'A different number of passengers?'}
        <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.caption, color: '#64748B', fontWeight: 500, mt: 0.5 }}>
          {tl ? `Idineklara sa booking: ${declaredCount}. Iulat bago matapos ang biyahe.` : `Declared in the booking: ${declaredCount}. Report it before the trip is finished.`}
        </Typography>
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="warning" sx={{ mb: 1.5, borderRadius: '12px' }}>
            {error}
          </Alert>
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, my: 1 }}>
          <IconButton aria-label={tl ? 'Bawasan' : 'Fewer'} disabled={busy || count <= 1} onClick={() => setCount((c) => Math.max(1, c - 1))}>
            <RemoveIcon />
          </IconButton>
          <Typography aria-live="polite" sx={{ fontSize: '28px', fontWeight: 700, minWidth: 48, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
            {count}
          </Typography>
          <IconButton aria-label={tl ? 'Dagdagan' : 'More'} disabled={busy || count >= 10} onClick={() => setCount((c) => Math.min(10, c + 1))}>
            <AddIcon />
          </IconButton>
        </Box>
        <TextField
          fullWidth
          multiline
          minRows={2}
          size="small"
          label={tl ? 'Tala (opsyonal)' : 'Note (optional)'}
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value.slice(0, 300))}
        />
        <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.micro, color: '#64748B', mt: 1.5 }}>
          {tl
            ? 'Ang sobrang pasahero ay maaaring magresulta sa pagbabago ng pamasahe at, kung sinadya, sa strike pagkatapos suriin ng LGU Administrator. Maaari kang tumangging magsimula hangga\'t hindi naitatama.'
            : 'Extra passengers can change the fare and, if deliberate, lead to a strike after the LGU Administrator reviews it. You may refuse to start the trip until it is corrected.'}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ p: '8px 18px 16px', gap: 1 }}>
        <Button disabled={busy} onClick={onClose} sx={{ textTransform: 'none', fontWeight: 700, color: '#64748B' }}>
          {tl ? 'Kanselahin' : 'Cancel'}
        </Button>
        <Button variant="contained" disabled={busy || count === declaredCount} onClick={() => void submit()} sx={{ textTransform: 'none', fontWeight: 700, backgroundColor: '#FF6600', '&:hover': { backgroundColor: '#E65C00' } }}>
          {tl ? 'Iulat' : 'Report'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default PassengerCountReportDialog;
