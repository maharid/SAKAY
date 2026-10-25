import React, { useState } from 'react';
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import { earlyEndReasonLabel, formatCountdown, formatPeso, type TripEndState } from '@sakay/shared';

interface PaymentReceivedPanelProps {
  language: string;
  /** What the database says about the end of the trip right now (null until the first answer) */
  state: TripEndState | null;
  /** The fare to show before the first answer: the one the database locked */
  fallbackFare: number;
  /** Whole seconds of the passenger's confirmation time left (null while it is not running), and whether it has ended */
  secondsLeft: number | null;
  expired: boolean;
  busy: boolean;
  onPaymentReceived: () => void;
  /** Rule 18.6: the confirmed fare was not paid (the driver writes what happened) */
  onReportNonPayment: (note: string) => void;
  /** Rule 18.4: the driver's side of a fare dispute */
  onAddDisputeNote: (disputeId: string, text: string) => Promise<string | null>;
}

const FONT = 'Poppins, sans-serif';
const TEXT_MIN = 10;

/**
 * Rules 16.6 / 18.1 - 18.6: at the destination the fare is shown to both. The driver waits for the passenger's Confirm Fare (or a documented discrepancy), collects
 * the cash and taps Payment Received - the ONLY way the trip is completed. After the confirmation time with no answer he may finish without the passenger
 * ("Paid - fare unconfirmed", no strike for anybody).
 */
const PaymentReceivedPanel: React.FC<PaymentReceivedPanelProps> = ({
  language, state, fallbackFare, secondsLeft, expired, busy, onPaymentReceived, onReportNonPayment, onAddDisputeNote,
}) => {
  const tl = language === 'tl';
  const fare = state?.actualFare ?? fallbackFare;
  const answered = Boolean(state?.confirmFareAt);
  const reported = Boolean(state?.fareDiscrepancyAt);
  const canReceive = Boolean(state?.canReceivePayment);
  const waiting = !answered && !reported && !canReceive;
  const canReportNonPayment = !reported && (answered || expired || (state ? state.canReceivePayment : false));
  const dispute = state?.dispute && state.dispute.status !== 'Resolved' ? state.dispute : null;
  const early = state?.earlyEnd ?? null;

  const [dialog, setDialog] = useState<'nonpayment' | 'note' | null>(null);
  const [text, setText] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const close = () => { setDialog(null); setText(''); setNoteError(null); };

  const submit = async () => {
    if (dialog === 'nonpayment') {
      onReportNonPayment(text.trim());
      close();
      return;
    }
    if (dialog === 'note' && dispute) {
      const problem = await onAddDisputeNote(dispute.disputeId, text.trim());
      if (problem) { setNoteError(problem); return; }
      close();
    }
  };

  return (
    <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box sx={{ p: '12px 14px', borderRadius: '14px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', textAlign: 'center' }}>
        <Typography sx={{ fontSize: '12px', fontWeight: 600, color: '#64748B', fontFamily: FONT }}>
          {tl ? 'Kunin ang bayad (cash)' : 'Collect in cash'}
          {early ? (tl ? ' • tinapos nang maaga' : ' • ended early') : ''}
        </Typography>
        <Typography data-testid="fare-to-collect" sx={{ fontSize: '30px', fontWeight: 700, lineHeight: 1.2, color: '#FF6600', fontFamily: FONT, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {formatPeso(fare)}
        </Typography>
        {early?.reason && <Typography sx={{ fontSize: '11px', color: '#94A3B8', fontFamily: FONT }}>{earlyEndReasonLabel(early.reason, tl ? 'tl' : 'en')}</Typography>}
        <Typography sx={{ fontSize: '11px', color: '#64748B', fontFamily: FONT, mt: 0.5, lineHeight: 1.4 }}>
          {tl
            ? 'Ang pamasahe sa screen lamang ang singilin, at cash lamang. Ang paghingi ng higit o ng ibang paraan ng bayad ay Overcharging Attempt.'
            : 'Charge only the fare shown, in cash. Asking for more, or for any other kind of payment, is an Overcharging Attempt.'}
        </Typography>
      </Box>

      {waiting && (
        <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: '12px 14px', borderRadius: '14px', backgroundColor: '#FFFBEB', border: '1.5px solid #FCD34D' }}>
          <CircularProgress size={22} sx={{ color: '#B45309', flexShrink: 0 }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#78350F', fontFamily: FONT }}>
              {tl ? 'Naghihintay ng kumpirmasyon ng pasahero' : 'Waiting for the passenger to confirm the fare'}
            </Typography>
            {secondsLeft !== null && secondsLeft > 0 && (
              <Typography sx={{ fontSize: '12px', color: '#78350F', fontFamily: FONT }}>
                {tl ? `Maaari mong tapusin ang biyahe sa ${formatCountdown(secondsLeft)} kung hindi sumagot ang pasahero.` : `If the passenger does not answer, you can finish the trip in ${formatCountdown(secondsLeft)}.`}
              </Typography>
            )}
          </Box>
        </Box>
      )}
      {!answered && !reported && canReceive && (
        <Box role="status" sx={{ p: '12px 14px', borderRadius: '14px', backgroundColor: '#FEF2F2', border: '1.5px solid #FCA5A5' }}>
          <Typography sx={{ fontSize: '13px', color: '#991B1B', fontFamily: FONT, lineHeight: 1.45 }}>
            {tl
              ? 'Hindi sumagot ang pasahero. Maaari mo nang tapusin ang biyahe: ire-record ito bilang "Bayad - hindi nakumpirma ang pamasahe", walang parusa kaninuman.'
              : 'The passenger did not answer. You can finish the trip now: it is recorded as "Paid - fare unconfirmed", with no penalty for anyone.'}
          </Typography>
        </Box>
      )}
      {answered && !reported && (
        <Box role="status" sx={{ p: '12px 14px', borderRadius: '14px', backgroundColor: '#F0FDF4', border: '1.5px solid #86EFAC' }}>
          <Typography sx={{ fontSize: '13px', color: '#166534', fontFamily: FONT, lineHeight: 1.45 }}>
            {tl ? 'Kinumpirma ng pasahero ang pamasahe. Kunin ang bayad, saka pindutin ang Payment Received.' : 'The passenger confirmed the fare. Collect the cash, then tap Payment Received.'}
          </Typography>
        </Box>
      )}
      {reported && (
        <Box role="status" sx={{ p: '12px 14px', borderRadius: '14px', backgroundColor: '#FFFBEB', border: '1.5px solid #FCD34D' }}>
          <Typography sx={{ fontSize: '13px', color: '#78350F', fontFamily: FONT, lineHeight: 1.45 }}>
            {tl
              ? 'Nag-ulat ang pasahero na hindi tugma ang pamasahe. Maaari mo pa ring pindutin ang Payment Received; susuriin ng TODA Administrator ang hindi pagkakasundo. Maaari mong idagdag ang panig mo.'
              : 'The passenger reported that the fare does not match. You can still tap Payment Received; the TODA Administrator will review the dispute. You can add your side.'}
          </Typography>
        </Box>
      )}

      <Button
        variant="contained"
        fullWidth
        disabled={busy || !canReceive}
        onClick={onPaymentReceived}
        sx={{ minHeight: 52, borderRadius: '16px', backgroundColor: '#15803D', fontWeight: 700, fontSize: '16px', textTransform: 'none', fontFamily: FONT, boxShadow: 'none', '&:hover': { backgroundColor: '#166534', boxShadow: 'none' }, '&.Mui-disabled': { backgroundColor: '#E2E8F0', color: '#64748B' } }}
      >
        {busy ? <CircularProgress size={24} color="inherit" /> : tl ? 'Natanggap na ang Bayad' : 'Payment Received'}
      </Button>
      {canReportNonPayment && (
        <Button variant="text" fullWidth disabled={busy} onClick={() => setDialog('nonpayment')} sx={{ minHeight: 44, textTransform: 'none', fontWeight: 600, fontSize: '13px', color: '#B91C1C', fontFamily: FONT }}>
          {tl ? 'Hindi nagbayad ang pasahero' : 'The passenger did not pay'}
        </Button>
      )}
      {dispute && (
        <Button variant="outlined" fullWidth disabled={busy} onClick={() => setDialog('note')} sx={{ minHeight: 44, borderRadius: '14px', textTransform: 'none', fontWeight: 600, fontSize: '13px', fontFamily: FONT, borderColor: '#CBD5E1', color: '#334155' }}>
          {tl ? 'Idagdag ang panig ko' : 'Add my side of the story'}
        </Button>
      )}
      <Typography sx={{ fontSize: '11px', lineHeight: 1.4, color: '#94A3B8', textAlign: 'center', fontFamily: FONT }}>
        {tl
          ? 'Ang peke o pinaghihinalaang pekeng pera ay hindi pinapasya ng app: iulat ito sa iyong TODA Administrator at, kung kailangan, sa pulisya.'
          : 'Counterfeit money is not decided by the app: report it to your TODA Administrator and, if needed, the police.'}
      </Typography>

      <Dialog open={dialog !== null} onClose={close} fullWidth maxWidth="xs" slotProps={{ paper: { sx: { borderRadius: '24px', p: 1 } } }}>
        <DialogTitle sx={{ fontWeight: 700, fontSize: '17px', color: '#0F172A', fontFamily: FONT }}>
          {dialog === 'nonpayment' ? (tl ? 'Hindi nagbayad ang pasahero' : 'The passenger did not pay') : tl ? 'Ang panig mo' : 'Your side'}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography sx={{ fontSize: '13px', color: '#64748B', lineHeight: 1.5, fontFamily: FONT }}>
            {dialog === 'nonpayment'
              ? tl
                ? 'Isasara ang biyahe at susuriin ng TODA Administrator ang iyong ulat. Isulat kung ano ang nangyari.'
                : 'The trip is closed and the TODA Administrator reviews your report. Write what happened.'
              : tl
              ? 'Idadagdag ito sa hindi pagkakasundo para makita ng TODA Administrator.'
              : 'This is added to the dispute for the TODA Administrator to read.'}
          </Typography>
          {noteError && <Typography role="alert" sx={{ fontSize: '12px', color: '#B91C1C', fontFamily: FONT }}>{noteError}</Typography>}
          <TextField
            fullWidth
            multiline
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 1000))}
            label={tl ? 'Ano ang nangyari? (hindi bababa sa 10 titik)' : 'What happened? (at least 10 characters)'}
           
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button variant="outlined" fullWidth onClick={close} sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 600, height: 44 }}>{tl ? 'Kanselahin' : 'Cancel'}</Button>
          <Button
            variant="contained"
            fullWidth
            disabled={text.trim().length < TEXT_MIN}
            onClick={submit}
            sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 700, height: 44, backgroundColor: '#FF6600', boxShadow: 'none', '&:hover': { backgroundColor: '#E65C00', boxShadow: 'none' } }}
          >
            {tl ? 'Isumite' : 'Submit'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PaymentReceivedPanel;
