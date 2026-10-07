import React, { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Radio,
  RadioGroup,
  FormControlLabel,
  Alert,
} from '@mui/material';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../services/supabaseClient';
import { useLanguage } from '../../utils/LanguageContext';
import { useDriverSession } from '../../contexts/DriverSessionContext';
import { DISPATCH_DECLINE_REASONS, TYPOGRAPHY_TOKENS, formatDistance, type DispatchDeclineReason } from '@sakay/shared';

// Rule 7.9: the reasons a driver may give for declining. The database accepts exactly these (the drift test checks the list).
const DECLINE_LABELS: Record<DispatchDeclineReason, { tl: string; en: string }> = {
  vehicle_issue: { tl: 'Problema sa sasakyan', en: 'Vehicle issue' },
  personal_emergency: { tl: 'Dahilang pangkagipitan', en: 'Personal emergency' },
  safety_concern: { tl: 'Alalahanin sa kaligtasan', en: 'Safety concern' },
  end_of_shift: { tl: 'Tapos na ang shift', en: 'End of shift' },
  other: { tl: 'Iba pang dahilan', en: 'Other operational reason' },
};

/** What the database says when it refuses an accept, in words a driver can act on. */
const acceptErrorText = (code: string | undefined, fallback: string, language: 'tl' | 'en'): string => {
  switch (code) {
    case 'ERR_OFFER_EXPIRED':
      return language === 'tl' ? 'Tapos na ang oras para sa request na ito.' : 'The time for this request has ended.';
    case 'ERR_BOOKING_UNAVAILABLE':
    case 'ERR_OFFER_NOT_FOUND':
      return language === 'tl' ? 'Hindi na available ang booking na ito.' : 'This booking is no longer available.';
    case 'ERR_NOT_ONLINE':
      return language === 'tl' ? 'Kailangan mong naka-Online para tumanggap ng booking.' : 'You must be Online to accept a booking.';
    case 'ERR_DRIVER_HAS_OPEN_BOOKING':
    case 'ERR_DRIVER_BUSY':
      return language === 'tl'
        ? 'May kasalukuyan kang biyahe. Tapusin muna ito bago tumanggap ng bago.'
        : 'You already have a trip in progress. Finish it before taking another.';
    case 'ERR_ACCOUNT_SUSPENDED':
    case 'ERR_ACCOUNT_DEACTIVATED':
      return language === 'tl' ? 'Hindi ka maaaring tumanggap ng booking dahil sa katayuan ng iyong account.' : 'You cannot accept bookings because of your account status.';
    default:
      return fallback;
  }
};

export const DriverIncomingRequestModal: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const {
    incomingRequest,
    setIncomingRequest,
    currentAttemptId,
    countdown,
    offerInfo,
    handleDeclineRequest,
    refreshPresence,
  } = useDriverSession();

  const [accepting, setAccepting] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState<DispatchDeclineReason | ''>('');
  const [declining, setDeclining] = useState(false);
  const [notice, setNotice] = useState<string>('');

  const handleAcceptRequest = async () => {
    if (!incomingRequest || !currentAttemptId || accepting) return;
    setAccepting(true);
    setNotice('');
    try {
      // One atomic call: the database checks that the offer is this driver's, still open and not expired, that the booking is still free and
      // that the driver may take it, and assigns it. Two drivers can never both get it.
      const { data, error } = await supabase.rpc('accept_booking_offer', { p_attempt_id: currentAttemptId });
      const result = data as { success?: boolean; booking_id?: string; error_code?: string; error?: string } | null;

      if (error || !result?.success) {
        const message = acceptErrorText(result?.error_code, result?.error || error?.message || 'The booking could not be accepted.', language as 'tl' | 'en');
        if (result?.error_code && result.error_code !== 'ERR_NOT_ONLINE') {
          // The offer is gone for good (ran out, taken, cancelled): say so and leave it.
          setIncomingRequest(null);
        }
        setNotice(message);
        refreshPresence();
        return;
      }

      const activeId = result.booking_id || incomingRequest.booking_id;
      setIncomingRequest(null);
      // A booking is now open: the presence publisher switches to the 5 s trip interval (Rule 17.1).
      refreshPresence();

      // Route to Active Navigation to Pickup
      navigate('/driver/navigation', { state: { bookingId: activeId, stage: 'pickup' } });
    } catch (err) {
      console.warn('[DriverIncomingRequestModal] accept_booking_offer failed:', err);
      setNotice(language === 'tl' ? 'Hindi maabot ang server. Pakisubukang muli.' : 'The server could not be reached. Please try again.');
    } finally {
      setAccepting(false);
    }
  };

  const handleConfirmDecline = async () => {
    if (!declineReason || declining) return;
    setDeclining(true);
    const declined = await handleDeclineRequest(declineReason);
    setDeclining(false);
    if (declined) {
      setDeclineOpen(false);
      setDeclineReason('');
    } else {
      setNotice(language === 'tl' ? 'Hindi maabot ang server. Pakisubukang muli.' : 'The server could not be reached. Please try again.');
      setDeclineOpen(false);
    }
  };

  if (!incomingRequest) return null;

  const etaMinutes = offerInfo?.etaSeconds != null ? Math.max(1, Math.ceil(offerInfo.etaSeconds / 60)) : null;

  return (
    <>
      <Dialog
        open={Boolean(incomingRequest) && !declineOpen}
        maxWidth="xs"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              borderRadius: '24px',
              padding: '8px',
              backgroundColor: '#FFFFFF',
              boxShadow: '0 25px 50px rgba(0,0,0,0.3)',
            },
          },
        }}
      >
        <DialogTitle sx={{ textAlign: 'center', pb: 1, pt: 2 }}>
          <Chip
            label={language === 'tl' ? `Bagong Booking Request (${countdown}s)` : `New Booking Request (${countdown}s)`}
            color="warning"
            sx={{ fontWeight: 800, fontSize: TYPOGRAPHY_TOKENS.fontSize.caption }}
          />
          <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.pageTitle, fontWeight: 800, color: '#0F172A', mt: 1 }}>
            {incomingRequest.is_shared_trip
              ? (language === 'tl' ? 'Shared Commuter Ride' : 'Shared Commuter Ride')
              : (language === 'tl' ? 'Solo Trip' : 'Solo Trip')}
          </Typography>
          <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.bodyMobile, color: '#64748B' }}>
            {language === 'tl' ? 'Pasahero:' : 'Passenger:'} <strong>{incomingRequest.passenger_name}</strong> • {incomingRequest.passenger_count} {language === 'tl' ? 'pasahero' : 'passenger(s)'}
          </Typography>
          {offerInfo?.distanceM != null && (
            <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.caption, color: '#FF6B00', fontWeight: 700, mt: 0.5 }}>
              {language === 'tl'
                ? `Pickup: ${formatDistance(offerInfo.distanceM / 1000)} mula sa iyo${etaMinutes ? ` (~${etaMinutes} min)` : ''}`
                : `Pickup is ${formatDistance(offerInfo.distanceM / 1000)} from you${etaMinutes ? ` (~${etaMinutes} min)` : ''}`}
            </Typography>
          )}
        </DialogTitle>

        <DialogContent sx={{ py: 1 }}>
          {notice && (
            <Alert severity="warning" sx={{ mb: 1.5, borderRadius: '12px' }} onClose={() => setNotice('')}>
              {notice}
            </Alert>
          )}
          <Box sx={{ p: '14px 16px', backgroundColor: '#F8FAFC', borderRadius: '16px', border: '1px solid #E2E8F0', mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mb: 1.5 }}>
              <LocationOnIcon sx={{ color: '#10B981', fontSize: 20 }} />
              <Box>
                <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.micro, color: '#94A3B8', fontWeight: 700 }}>
                  {language === 'tl' ? 'LOKASYON NG PICKUP' : 'PICKUP LOCATION'}
                </Typography>
                <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.bodyMobile, fontWeight: 700, color: '#0F172A' }}>{incomingRequest.pickup_address}</Typography>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
              <LocationOnIcon sx={{ color: '#EF4444', fontSize: 20 }} />
              <Box>
                <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.micro, color: '#94A3B8', fontWeight: 700 }}>
                  {language === 'tl' ? 'DESTINASYON' : 'DESTINATION'}
                </Typography>
                <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.bodyMobile, fontWeight: 700, color: '#0F172A' }}>{incomingRequest.dropoff_address}</Typography>
              </Box>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1 }}>
            <Box>
              <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.caption, color: '#64748B' }}>
                {language === 'tl' ? 'Tinatayang Distansya' : 'Estimated Distance'}
              </Typography>
              <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.section, fontWeight: 700, color: '#0F172A' }}>{incomingRequest.estimated_distance_km} km</Typography>
            </Box>
            <Box sx={{ textAlign: 'right' }}>
              <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.caption, color: '#64748B' }}>
                {language === 'tl' ? 'Pamasahe' : 'Fare'}
              </Typography>
              <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.display, fontWeight: 900, color: '#FF6B00' }}>₱{incomingRequest.estimated_fare.toFixed(2)}</Typography>
            </Box>
          </Box>

          {/* Rule 7.3: respond only when it is safe to do so */}
          <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.micro, color: '#94A3B8', textAlign: 'center', mt: 1.5 }}>
            {language === 'tl'
              ? 'Tumugon lamang kapag ligtas. Huwag gamitin ang app habang nagmamaneho.'
              : 'Respond only when it is safe to do so. Do not use the app while driving.'}
          </Typography>
        </DialogContent>

        <DialogActions sx={{ p: '12px 18px 18px', gap: 1.5 }}>
          <Button
            variant="outlined"
            fullWidth
            color="inherit"
            disabled={accepting}
            onClick={() => setDeclineOpen(true)}
            sx={{ height: 44, borderRadius: '14px', fontWeight: 700, fontSize: TYPOGRAPHY_TOKENS.fontSize.buttonMobile, color: '#64748B', textTransform: 'none' }}
          >
            {language === 'tl' ? 'Tanggihan' : 'Decline'}
          </Button>

          <Button
            variant="contained"
            fullWidth
            disabled={accepting}
            onClick={handleAcceptRequest}
            sx={{
              height: 44,
              borderRadius: '14px',
              backgroundColor: '#1E8E3E',
              color: '#FFFFFF',
              fontWeight: 800,
              fontSize: TYPOGRAPHY_TOKENS.fontSize.buttonMobile,
              textTransform: 'none',
              '&:hover': { backgroundColor: '#137333' },
            }}
          >
            {language === 'tl' ? 'Tanggapin' : 'Accept'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Rule 7.9: a decline carries a reason from the fixed list; it is no strike and the offer goes to the next driver at once */}
      <Dialog open={declineOpen} maxWidth="xs" fullWidth onClose={() => !declining && setDeclineOpen(false)}>
        <DialogTitle sx={{ fontWeight: 800, fontSize: TYPOGRAPHY_TOKENS.fontSize.section }}>
          {language === 'tl' ? 'Bakit mo tinatanggihan?' : 'Why are you declining?'}
          <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.caption, color: '#64748B', fontWeight: 500, mt: 0.5 }}>
            {language === 'tl' ? `May ${countdown}s pa. Walang strike sa pagtanggi.` : `${countdown}s left. Declining is not a strike.`}
          </Typography>
        </DialogTitle>
        <DialogContent>
          <RadioGroup value={declineReason} onChange={(e) => setDeclineReason(e.target.value as DispatchDeclineReason)}>
            {DISPATCH_DECLINE_REASONS.map((reason) => (
              <FormControlLabel
                key={reason}
                value={reason}
                control={<Radio sx={{ '&.Mui-checked': { color: '#FF6B00' } }} />}
                label={language === 'tl' ? DECLINE_LABELS[reason].tl : DECLINE_LABELS[reason].en}
              />
            ))}
          </RadioGroup>
        </DialogContent>
        <DialogActions sx={{ p: '8px 20px 18px', gap: 1 }}>
          <Button fullWidth disabled={declining} onClick={() => setDeclineOpen(false)} sx={{ textTransform: 'none', fontWeight: 700, color: '#64748B' }}>
            {language === 'tl' ? 'Bumalik' : 'Back'}
          </Button>
          <Button
            fullWidth
            variant="contained"
            disabled={!declineReason || declining}
            onClick={handleConfirmDecline}
            sx={{ height: 44, borderRadius: '14px', backgroundColor: '#EF4444', textTransform: 'none', fontWeight: 800, '&:hover': { backgroundColor: '#DC2626' } }}
          >
            {language === 'tl' ? 'Tanggihan' : 'Decline'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
