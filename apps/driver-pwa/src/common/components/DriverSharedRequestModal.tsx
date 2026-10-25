import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import LocationOnIcon from '@mui/icons-material/LocationOn';

import { fetchMySharedRequest, respondSharedRequest, type SharedRequestView, TYPOGRAPHY_TOKENS, formatDistance, monotonicNow } from '@sakay/shared';
import { supabase } from '../../services/supabaseClient';
import { useDriverSession } from '../../contexts/DriverSessionContext';
import { useLanguage } from '../../utils/LanguageContext';
import { SakayToast } from './SakayToast';

/** How often the app asks whether a shared-passenger request is waiting (the table is the database's: a driver cannot subscribe to it, so this is the poll) */
const POLL_MS = 3000;

/** What the database says when it refuses an answer, in words a driver can act on. */
const answerErrorText = (code: string | null, fallback: string | null, tl: boolean): string => {
  switch (code) {
    case 'ERR_REQUEST_EXPIRED':
      return tl ? 'Tapos na ang oras para sa request na ito.' : 'The time for this request has ended.';
    case 'ERR_MATCHING_CLOSED':
    case 'ERR_REQUEST_CLOSED':
    case 'ERR_REQUEST_NOT_FOUND':
      return tl ? 'Hindi na bukas ang request na ito.' : 'This request is no longer open.';
    case 'NETWORK':
      return tl ? 'Hindi maabot ang server. Pakisubukang muli.' : 'The server could not be reached. Please try again.';
    default:
      return fallback || (tl ? 'Hindi naitala ang sagot mo.' : 'Your answer could not be saved.');
  }
};

/**
 * Rule 14.3: the Additional Shared Passenger Request. While the driver is on a Shared Trip, a compatible second booking may be proposed to him; he may Accept or
 * Decline. A single decline is not a strike and the booking returns to standard dispatch; repeated or unreasonable declines may be reviewed by the TODA
 * Administrator. Accepting does not seat the passenger yet: the passenger on board answers next (Rule 14.5). Everything is decided by the database.
 */
export const DriverSharedRequestModal: React.FC = () => {
  const { language } = useLanguage();
  const tl = language === 'tl';
  const { playIncomingAlert, refreshPresence } = useDriverSession();
  const [request, setRequest] = useState<SharedRequestView | null>(null);
  const [receivedAt, setReceivedAt] = useState<number>(0);
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>('');
  const [toast, setToast] = useState<string>('');
  const currentId = useRef<string | null>(null);
  // the alert function is recreated by the session on every render: it is read through a ref, so the poll below is not restarted by it
  const alertRef = useRef(playIncomingAlert);
  alertRef.current = playIncomingAlert;

  const read = useCallback(async () => {
    const found = await fetchMySharedRequest(supabase);
    if (!found) {
      if (currentId.current) {
        currentId.current = null;
        setRequest(null);
      }
      return;
    }
    if (currentId.current === found.matchId) return;       // the same request: the countdown keeps running
    currentId.current = found.matchId;
    setRequest(found);
    setReceivedAt(monotonicNow());
    setNotice('');
    alertRef.current();
  }, []);

  useEffect(() => {
    void read();
    const timer = setInterval(read, POLL_MS);
    return () => clearInterval(timer);
  }, [read]);

  useEffect(() => {
    if (!request) return;
    const timer = setInterval(() => setTick((n) => (n + 1) % 1_000_000), 1000);
    return () => clearInterval(timer);
  }, [request]);

  const secondsLeft = request ? Math.max(0, Math.round(request.secondsRemaining - (monotonicNow() - receivedAt) / 1000)) : 0;
  useEffect(() => {
    // at zero the request simply leaves this screen (the database closes it as a timeout: no strike)
    if (request && secondsLeft <= 0) {
      currentId.current = null;
      setRequest(null);
    }
  }, [request, secondsLeft]);

  const answer = async (accept: boolean) => {
    if (!request || busy) return;
    setBusy(true);
    setNotice('');
    const result = await respondSharedRequest(supabase, request.matchId, accept);
    setBusy(false);
    if (!result.ok) {
      setNotice(answerErrorText(result.code, result.error, tl));
      if (result.code && result.code !== 'NETWORK') {
        currentId.current = null;
        setRequest(null);
      }
      return;
    }
    currentId.current = null;
    setRequest(null);
    refreshPresence();
    setToast(
      accept
        ? tl
          ? 'Naipadala. Hihintayin ang pahintulot ng pasaherong nakasakay. Makikita mo ang pangalawang pasahero kapag pumayag siya.'
          : 'Sent. The passenger on board must agree first. You will see the second passenger on your trip when they do.'
        : tl
        ? 'Tinanggihan. Walang strike; ibabalik ang booking sa ibang drayber.'
        : 'Declined. No strike; the booking goes back to other drivers.'
    );
  };

  return (
    <>
      <SakayToast message={toast || null} autoHideDuration={7000} onClose={() => setToast('')} />
      {request && (
        <Dialog open maxWidth="xs" fullWidth slotProps={{ paper: { sx: { borderRadius: '24px', padding: '8px', backgroundColor: '#FFFFFF', boxShadow: '0 25px 50px rgba(0,0,0,0.3)' } } }}>
          <DialogTitle sx={{ textAlign: 'center', pb: 1, pt: 2 }}>
            <Chip
              label={tl ? `Karagdagang Shared na Pasahero (${secondsLeft}s)` : `Additional Shared Passenger Request (${secondsLeft}s)`}
              color="warning"
              sx={{ fontWeight: 700, fontSize: TYPOGRAPHY_TOKENS.fontSize.caption, height: 'auto', py: 0.5, '& .MuiChip-label': { whiteSpace: 'normal', textAlign: 'center' } }}
            />
            <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.pageTitle, fontWeight: 700, color: '#0F172A', mt: 1 }}>
              {tl ? 'May gustong sumabay sa biyahe mo' : 'A passenger can join your trip'}
            </Typography>
            <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.bodyMobile, color: '#64748B' }}>
              {tl ? 'Pasahero:' : 'Passenger:'} <strong>{request.passengerFirstName || (tl ? 'Pasahero' : 'Passenger')}</strong> • {request.passengerCount} {tl ? 'pasahero' : 'passenger(s)'}
            </Typography>
            <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.caption, color: '#64748B', mt: 0.25 }}>
              {tl ? `Nasa biyahe mo na: ${request.currentPartySize} pasahero` : `Already on your trip: ${request.currentPartySize} passenger(s)`}
            </Typography>
            {request.pickupGapM !== null && (
              <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.caption, color: '#FF6600', fontWeight: 700, mt: 0.5 }}>
                {tl ? `Ang pickup ay ${formatDistance(request.pickupGapM / 1000)} mula sa susunod mong hintuan` : `The pickup is ${formatDistance(request.pickupGapM / 1000)} from your next stop`}
              </Typography>
            )}
            {request.firstAddedM !== null && request.secondAddedM !== null && (
              <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.micro, color: '#64748B' }}>
                {tl
                  ? `Dagdag na layo: ~${formatDistance(request.firstAddedM / 1000)} sa nakasakay, ~${formatDistance(request.secondAddedM / 1000)} sa bago`
                  : `Extra distance: about ${formatDistance(request.firstAddedM / 1000)} for the first passenger, ${formatDistance(request.secondAddedM / 1000)} for the new one`}
              </Typography>
            )}
          </DialogTitle>
          <DialogContent sx={{ py: 1 }}>
            {notice && (
              <Alert severity="warning" sx={{ mb: 1.5, borderRadius: '12px' }} onClose={() => setNotice('')}>
                {notice}
              </Alert>
            )}
            <Box sx={{ p: '14px 16px', backgroundColor: '#F8FAFC', borderRadius: '16px', border: '1px solid #E2E8F0', mb: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mb: 1.5 }}>
                <LocationOnIcon sx={{ color: '#10B981', fontSize: 20 }} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.micro, color: '#64748B', fontWeight: 700 }}>{tl ? 'Lokasyon ng pickup' : 'Pickup location'}</Typography>
                  <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.bodyMobile, fontWeight: 700, color: '#0F172A', overflowWrap: 'anywhere' }}>{request.pickupAddress}</Typography>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                <LocationOnIcon sx={{ color: '#EF4444', fontSize: 20 }} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.micro, color: '#64748B', fontWeight: 700 }}>{tl ? 'Destinasyon' : 'Destination'}</Typography>
                  <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.bodyMobile, fontWeight: 700, color: '#0F172A', overflowWrap: 'anywhere' }}>{request.dropoffAddress}</Typography>
                </Box>
              </Box>
            </Box>
            <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.micro, color: '#64748B', textAlign: 'center' }}>
              {tl
                ? 'Libre ang tumanggi: walang strike at ibabalik ang booking sa ibang drayber. Ang paulit-ulit at walang dahilang pagtanggi ay maaaring suriin ng TODA Administrator. Tumugon lamang kapag ligtas.'
                : 'Declining is free: no strike, and the booking goes back to other drivers. Repeated declines without a good reason may be reviewed by the TODA Administrator. Respond only when it is safe.'}
            </Typography>
          </DialogContent>
          <DialogActions sx={{ p: '12px 18px 18px', gap: 1.5 }}>
            <Button
              variant="outlined"
              fullWidth
              color="inherit"
              disabled={busy}
              onClick={() => void answer(false)}
              sx={{ height: 44, borderRadius: '14px', fontWeight: 700, fontSize: TYPOGRAPHY_TOKENS.fontSize.buttonMobile, color: '#64748B', textTransform: 'none' }}
            >
              {tl ? 'Tanggihan' : 'Decline'}
            </Button>
            <Button
              variant="contained"
              fullWidth
              disabled={busy}
              onClick={() => void answer(true)}
              sx={{ height: 44, borderRadius: '14px', backgroundColor: '#1E8E3E', color: '#FFFFFF', fontWeight: 700, fontSize: TYPOGRAPHY_TOKENS.fontSize.buttonMobile, textTransform: 'none', '&:hover': { backgroundColor: '#137333' } }}
            >
              {tl ? 'Tanggapin' : 'Accept'}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
};

export default DriverSharedRequestModal;
