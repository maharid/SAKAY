import React, { useEffect, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import { formatPeso } from '@sakay/shared';

interface FareDiscrepancyDialogProps {
  open: boolean;
  language: string;
  /** 'discrepancy': Report Fare Discrepancy (Rule 18.4: the amount asked for and what happened). 'safety': the review of a Safety Concern early end (Rule 13.5): no amount. */
  mode: 'discrepancy' | 'safety';
  /** The fare the system shows both of you (it cannot be edited by either) */
  systemFare: number;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (claimedAmount: number | null, reason: string) => void;
}

const REASON_MIN = 10;

/** The documentation of a fare discrepancy: the amount the driver asked for and what happened. The TODA Administrator reviews it, and the LGU Administrator on escalation. */
const FareDiscrepancyDialog: React.FC<FareDiscrepancyDialogProps> = ({ open, language, mode, systemFare, busy, error, onClose, onSubmit }) => {
  const tl = language === 'tl';
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) {
      setAmount('');
      setReason('');
    }
  }, [open]);
  const amountOk = mode === 'safety' || (amount.trim() !== '' && Number.isFinite(Number(amount)) && Number(amount) >= 0);
  const reasonOk = reason.trim().length >= REASON_MIN;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" slotProps={{ paper: { sx: { borderRadius: '24px', p: 1.5 } } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
        <ReportProblemIcon sx={{ color: '#EF4444' }} />
        <Typography component="span" sx={{ fontSize: '17px', fontWeight: 700, color: '#0F172A' }}>
          {mode === 'safety' ? (tl ? 'Humiling ng Pagsusuri' : 'Ask for a Review') : tl ? 'I-report ang Pamasahe' : 'Report Fare Discrepancy'}
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}>
        <Typography sx={{ fontSize: '13px', color: '#64748B', lineHeight: 1.5 }}>
          {mode === 'safety'
            ? tl
              ? 'Susuriin ng TODA Administrator ang pamasahe ng biyaheng tinapos mo dahil sa kaligtasan, at kung kailangan, ng LGU Administrator.'
              : 'The TODA Administrator, and the LGU Administrator if needed, will review the fare of the trip you ended for safety.'
            : tl
            ? `Ang pamasahe ayon sa sistema ay ${formatPeso(systemFare)}. Susuriin ng TODA Administrator ang iyong ulat, at kung kailangan, ng LGU Administrator.`
            : `The system shows ${formatPeso(systemFare)}. The TODA Administrator, and the LGU Administrator if needed, will review your report.`}
        </Typography>
        {error && <Alert severity="error" sx={{ borderRadius: '12px' }}>{error}</Alert>}
        {mode === 'discrepancy' && (
          <TextField
            fullWidth
            size="small"
            type="number"
            label={tl ? 'Halagang hiningi ng drayber (₱)' : 'Amount the driver asked for (₱)'}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            slotProps={{ htmlInput: { min: 0, step: 1, inputMode: 'decimal' } }}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: '12px' } }}
          />
        )}
        <TextField
          fullWidth
          size="small"
          multiline
          rows={3}
          label={tl ? 'Ano ang nangyari?' : 'What happened?'}
          placeholder={tl ? 'Pakilarawan ang nangyari (hindi bababa sa 10 titik)...' : 'Please describe what happened (at least 10 characters)...'}
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 1000))}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: '12px' } }}
        />
        <Typography sx={{ fontSize: '12px', color: '#64748B', lineHeight: 1.45 }}>
          {tl
            ? 'Ang peke o pinaghihinalaang pekeng pera ay hindi hinahawakan ng app: sabihin ito sa iyong TODA Administrator at, kung kailangan, sa pulisya.'
            : 'Counterfeit money is not handled by the app: tell the TODA Administrator and, if needed, the police.'}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ p: '12px 18px 18px', gap: 1 }}>
        <Button variant="outlined" fullWidth disabled={busy} onClick={onClose} sx={{ borderRadius: '12px', textTransform: 'none' }}>
          {tl ? 'Kanselahin' : 'Cancel'}
        </Button>
        <Button
          variant="contained"
          fullWidth
          color="error"
          disabled={busy || !amountOk || !reasonOk}
          onClick={() => onSubmit(mode === 'safety' ? null : Number(amount), reason.trim())}
          sx={{ borderRadius: '12px', fontWeight: 700, textTransform: 'none', boxShadow: 'none' }}
        >
          {busy ? (tl ? 'Isinusumite...' : 'Submitting...') : tl ? 'Isumite' : 'Submit'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FareDiscrepancyDialog;
