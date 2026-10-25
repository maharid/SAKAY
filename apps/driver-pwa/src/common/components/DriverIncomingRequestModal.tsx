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
  LinearProgress,
} from '@mui/material';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import NearMeOutlinedIcon from '@mui/icons-material/NearMeOutlined';
import RouteOutlinedIcon from '@mui/icons-material/RouteOutlined';
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../services/supabaseClient';
import { useLanguage } from '../../utils/LanguageContext';
import { useDriverSession } from '../../contexts/DriverSessionContext';
import { DISPATCH_DECLINE_REASONS, DRIVER_OFFER_TIMEOUT_SECONDS, TYPOGRAPHY_TOKENS, formatDistance, type DispatchDeclineReason, formatPeso, messageForLanguage, RouteTimeline } from '@sakay/shared';

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

/** The seconds left turn urgent (red) for the last stretch, so the time pressure is noticed without a second alert. */
const URGENT_SECONDS = 10;

const Stat: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.25, p: '10px 12px', borderRadius: '14px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: '#64748B', '& svg': { fontSize: 16 } }}>
      {icon}
      <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.micro, fontWeight: 600, color: 'inherit', lineHeight: 1.2 }}>{label}</Typography>
    </Box>
    <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.bodyMobile, fontWeight: 700, color: '#0F172A', lineHeight: 1.25, overflowWrap: 'anywhere' }}>{value}</Typography>
  </Box>
);

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
  const urgent = countdown <= URGENT_SECONDS;
  // The bar is the share of the offer's time that is left (the offer is DRIVER_OFFER_TIMEOUT_SECONDS long; the database's own seconds drive the number)
  const countdownShare = Math.max(0, Math.min(100, (countdown / DRIVER_OFFER_TIMEOUT_SECONDS) * 100));

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
              m: 2,
              width: 'calc(100% - 32px)',
              maxHeight: 'calc(100% - 32px)',
              backgroundColor: '#FFFFFF',
              boxShadow: '0 25px 50px rgba(0,0,0,0.3)',
              overflow: 'hidden',
            },
          },
        }}
      >
        {/* Header: what this is, and the time that is left */}
        <Box sx={{ px: 2.5, pt: 2.25, pb: 1.5, backgroundColor: '#FFF7ED', borderBottom: '1px solid #FFEDD5' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5 }}>
            <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.caption, fontWeight: 800, color: '#9A3412', letterSpacing: '0.04em', textTransform: 'uppercase', lineHeight: 1.25 }}>
              {language === 'tl' ? 'Bagong Booking Request' : 'New Booking Request'}
            </Typography>
            <Box
              role="timer"
              aria-label={language === 'tl' ? `May ${countdown} segundo pa` : `${countdown} seconds left`}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                flexShrink: 0,
                px: 1.25,
                py: 0.5,
                borderRadius: '999px',
                backgroundColor: urgent ? '#B91C1C' : '#C75000',
                color: '#FFFFFF',
                transition: 'background-color 0.3s ease',
              }}
            >
              <TimerOutlinedIcon aria-hidden sx={{ fontSize: 16 }} />
              <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.caption, fontWeight: 800, color: 'inherit', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>{countdown}s</Typography>
            </Box>
          </Box>
          <LinearProgress
            variant="determinate"
            value={countdownShare}
            aria-hidden
            sx={{
              mt: 1.25,
              height: 6,
              borderRadius: 3,
              backgroundColor: '#FED7AA',
              '& .MuiLinearProgress-bar': { borderRadius: 3, backgroundColor: urgent ? '#B91C1C' : '#C75000', transition: 'transform 1s linear' },
            }}
          />
        </Box>

        <DialogContent sx={{ px: 2.5, pt: 2, pb: 1 }}>
          {notice && (
            <Alert severity="warning" sx={{ mb: 1.5, borderRadius: '12px' }} onClose={() => setNotice('')}>
              {messageForLanguage(notice, language)}
            </Alert>
          )}

          {/* Passenger and the kind of trip */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
            <Box
              aria-hidden
              sx={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FF6600', color: '#FFFFFF', fontWeight: 800, fontSize: TYPOGRAPHY_TOKENS.fontSize.section }}
            >
              {(incomingRequest.passenger_name || '?').trim().charAt(0).toUpperCase()}
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.section, fontWeight: 700, color: '#0F172A', lineHeight: 1.25, overflowWrap: 'anywhere' }}>{incomingRequest.passenger_name}</Typography>
              <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.caption, color: '#64748B', lineHeight: 1.3 }}>
                {incomingRequest.passenger_count} {language === 'tl' ? 'pasahero' : incomingRequest.passenger_count === 1 ? 'passenger' : 'passengers'}
              </Typography>
            </Box>
            <Chip
              size="small"
              label={incomingRequest.is_shared_trip ? 'Shared Commuter Ride' : 'Solo Trip'}
              sx={{ flexShrink: 0, maxWidth: '45%', fontWeight: 700, backgroundColor: incomingRequest.is_shared_trip ? '#DBEAFE' : '#F1F5F9', color: incomingRequest.is_shared_trip ? '#1E3A8A' : '#334155', '& .MuiChip-label': { whiteSpace: 'normal', textAlign: 'center', py: 0.25 }, height: 'auto' }}
            />
          </Box>

          {/* The fare is what the driver weighs first */}
          <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2, mb: 2 }}>
            <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.caption, fontWeight: 700, color: '#64748B' }}>{language === 'tl' ? 'Pamasahe' : 'Fare'}</Typography>
            <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.display, fontWeight: 800, color: '#C75000', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
              {formatPeso(incomingRequest.estimated_fare)}
            </Typography>
          </Box>

          {/* Where from, where to */}
          <Box sx={{ p: '14px 16px', backgroundColor: '#F8FAFC', borderRadius: '16px', border: '1px solid #E2E8F0', mb: 1.5 }}>
            <RouteTimeline
              pickup={incomingRequest.pickup_address}
              destination={incomingRequest.dropoff_address}
              pickupLabel={language === 'tl' ? 'Lokasyon ng pickup' : 'Pickup location'}
              destinationLabel={language === 'tl' ? 'Destinasyon' : 'Destination'}
            />
          </Box>

          {/* Distances: the trip itself and how far the pickup is from the driver (shown only when the offer carries it) */}
          <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
            <Stat
              icon={<RouteOutlinedIcon aria-hidden />}
              label={language === 'tl' ? 'Distansya ng biyahe' : 'Trip distance'}
              value={`${incomingRequest.estimated_distance_km}\u00A0km`}
            />
            {offerInfo?.distanceM != null && (
              <Stat
                icon={<NearMeOutlinedIcon aria-hidden />}
                label={language === 'tl' ? 'Pickup mula sa iyo' : 'Pickup from you'}
                value={`${formatDistance(offerInfo.distanceM / 1000)}${etaMinutes ? ` (~${etaMinutes} min)` : ''}`}
              />
            )}
          </Box>

          {/* Respond only when it is safe to do so */}
          <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.micro, color: '#64748B', textAlign: 'center', lineHeight: 1.4 }}>
            {language === 'tl'
              ? 'Tumugon lamang kapag ligtas. Huwag gamitin ang app habang nagmamaneho.'
              : 'Respond only when it is safe to do so. Do not use the app while driving.'}
          </Typography>
        </DialogContent>

        <DialogActions sx={{ px: 2.5, pt: 1.5, pb: 2.5, gap: 1.5, alignItems: 'stretch' }}>
          <Button
            variant="outlined"
            disabled={accepting}
            onClick={() => setDeclineOpen(true)}
            startIcon={<CloseRoundedIcon />}
            sx={{
              flex: 1,
              minWidth: 0,
              minHeight: 52,
              borderRadius: '14px',
              borderWidth: 2,
              borderColor: '#CBD5E1',
              fontWeight: 700,
              fontSize: TYPOGRAPHY_TOKENS.fontSize.buttonMobile,
              color: '#B91C1C',
              textTransform: 'none',
              '&:hover': { borderWidth: 2, borderColor: '#B91C1C', backgroundColor: '#FEF2F2' },
            }}
          >
            {language === 'tl' ? 'Tanggihan' : 'Decline'}
          </Button>

          <Button
            variant="contained"
            disabled={accepting}
            onClick={handleAcceptRequest}
            startIcon={<CheckRoundedIcon />}
            sx={{
              flex: 1.4,
              minWidth: 0,
              minHeight: 52,
              borderRadius: '14px',
              backgroundColor: '#1E8E3E',
              color: '#FFFFFF',
              fontWeight: 700,
              fontSize: TYPOGRAPHY_TOKENS.fontSize.buttonMobile,
              textTransform: 'none',
              boxShadow: '0 6px 16px rgba(30, 142, 62, 0.35)',
              '&:hover': { backgroundColor: '#137333' },
            }}
          >
            {language === 'tl' ? 'Tanggapin' : 'Accept'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Rule 7.9: a decline carries a reason from the fixed list; it is no strike and the offer goes to the next driver at once */}
      <Dialog open={declineOpen} maxWidth="xs" fullWidth onClose={() => !declining && setDeclineOpen(false)}>
        <DialogTitle sx={{ fontWeight: 700, fontSize: TYPOGRAPHY_TOKENS.fontSize.section }}>
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
                control={<Radio sx={{ '&.Mui-checked': { color: '#FF6600' } }} />}
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
            sx={{ height: 44, borderRadius: '14px', backgroundColor: '#EF4444', textTransform: 'none', fontWeight: 700, '&:hover': { backgroundColor: '#DC2626' } }}
          >
            {language === 'tl' ? 'Tanggihan' : 'Decline'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
