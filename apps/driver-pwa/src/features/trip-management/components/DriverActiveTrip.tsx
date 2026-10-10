import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Button,
  IconButton,
  LinearProgress,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Avatar,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import LocalTaxiIcon from '@mui/icons-material/LocalTaxi';
import CancelIcon from '@mui/icons-material/Cancel';
import PhoneIcon from '@mui/icons-material/Phone';
import MessageIcon from '@mui/icons-material/Message';
import PersonIcon from '@mui/icons-material/Person';

import MapView from '../../../common/components/MapView';
import { supabase } from '../../../services/supabaseClient';
import { useLanguage } from '../../../utils/LanguageContext';
import { useDriverSession } from '../../../contexts/DriverSessionContext';
import {
  COMPLETION_CONFIRM_TIMEOUT_SECONDS,
  TRIP_FINISH_MIN_PROGRESS_PERCENT,
  TripDetailsPanel,
  buildTripDetails,
  calculateDistanceKm,
  calculateTripProgressPercent,
  fetchServerTripProgress,
  formatDistance,
  isTripFinishable,
  type DriverCancelReason,
} from '@sakay/shared';
import { DriverFeedbackModal } from '../../feedback/components/DriverFeedbackModal';
import { DriverCommunicationModal } from '../../communication/components/DriverCommunicationModal';
import { DriverCancelModal } from '../../../common/components/DriverCancelModal';
import SakayToast from '../../../common/components/SakayToast';
import BookingGivenAwayDialog from '../../../common/components/BookingGivenAwayDialog';
import { useAssignedBookingClocks } from '../../../hooks/useAssignedBookingClocks';
import EnRouteNotices from './EnRouteNotices';
import ArrivalWaitPanel from './ArrivalWaitPanel';

export const DriverActiveTrip: React.FC = () => {
  const { language } = useLanguage();
  const { profile, refreshPresence } = useDriverSession();
  const navigate = useNavigate();
  const location = useLocation();
  const bookingId = (location.state as { bookingId?: string })?.bookingId || '';

  const [booking, setBooking] = useState<any>(null);
  const [exitGuardOpen, setExitGuardOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [commModalOpen, setCommModalOpen] = useState(false);

  // Bidirectional Passenger Cancelled Alert State
  const [passengerCancelledAlertOpen, setPassengerCancelledAlertOpen] = useState(false);
  const [passengerCancelReason, setPassengerCancelReason] = useState<string>('');

  // Waiting for passenger payment & feedback states
  const [waitingForPayment, setWaitingForPayment] = useState(false);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  // A write the database refused must not look as if it worked: the screen says so and shows what is true.
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  // When the database locked the fare at the destination (Rule 16.6: the passenger then has the confirmation time before the driver may end the trip)
  const [fareLockedAt, setFareLockedAt] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // The best progress this screen has shown for the trip (it does not slide back when the GPS jitters)
  const maxProgressRef = useRef(0);
  // One write to the booking at a time: a second tap while the first is still being saved does nothing
  const movingRef = useRef(false);
  const [moving, setMoving] = useState(false);
  // The trip's progress as the database holds it: the figure the Finish Trip is checked against (null: not read yet, or it cannot be read)
  const [serverProgress, setServerProgress] = useState<number | null>(null);
  // What the database has locked at the destination (Rule 6.2): the final fare and how it was worked out (solo, matched or unmatched)
  const [lockedFare, setLockedFare] = useState<number | null>(null);
  const [fareBasis, setFareBasis] = useState<string | null>(null);

  // The fare on screen: the estimate until the trip arrives, then the final fare the database wrote (Rule 6.2).
  const [currentFare, setCurrentFare] = useState<number>(booking?.estimated_fare ?? 0);

  // Rules 8 / 9: while the driver is on the way the system watches his progress. It may warn him (8.2), and if he does not start or cannot be
  // reached it cancels on his behalf and gives the booking to another driver: this screen then has nothing left to show.
  const onTheWay = booking?.booking_status === 'Accepted' || booking?.booking_status === 'Driver Assigned' || booking?.booking_status === 'In Transit';
  const clocks = useAssignedBookingClocks(bookingId, onTheWay);
  // The driver's own position (the map glides the marker to each new fix; the position itself is untouched). Same values, same object: no redraw.
  const driverLat = profile.currentLat || booking?.pickup_latitude || 13.4117;
  const driverLng = profile.currentLng || booking?.pickup_longitude || 121.1803;
  const driverLocation = useMemo(() => ({ lat: driverLat, lng: driverLng }), [driverLat, driverLng]);

  // Fetch live booking & passenger details
  useEffect(() => {
    if (!bookingId) return;

    const fetchBookingDetails = async () => {
      try {
        const { data } = await supabase
          .from('booking')
          .select('*')
          .eq('booking_id', bookingId)
          .maybeSingle();

        if (data) {
          // The passenger's name, and phone while the trip is live, come from a function that discloses just that (the passenger table
          // is not readable by a driver).
          const { data: parties } = await supabase.rpc('get_booking_counterparties', { p_booking_ids: [bookingId] });
          const party = ((parties ?? []) as Array<{ passenger_name?: string | null; passenger_phone?: string | null }>)[0];
          const fare = Number(data.actual_fare ?? data.estimated_fare) || 0;
          if (data.fare_locked_at && data.actual_fare !== null && data.actual_fare !== undefined) {
            setLockedFare(Number(data.actual_fare));
            setFareBasis(data.fare_breakdown?.final?.basis ?? null);
          }

          setBooking({
            booking_id: data.booking_id,
            passenger_id: data.passenger_id,
            passenger_name: party?.passenger_name || data.passenger_name || '',
            passenger_phone: party?.passenger_phone || '',
            booking_type: data.booking_type || 'Immediate',
            is_shared_trip: Boolean(data.is_shared_trip),
            passenger_count: data.passenger_count || 1,
            pickup_address: data.pickup_address || data.pickup_location_address || '',
            pickup_latitude: Number(data.pickup_latitude) || 13.4117,
            pickup_longitude: Number(data.pickup_longitude) || 121.1803,
            dropoff_address: data.dropoff_address || data.dropoff_location_address || '',
            dropoff_latitude: Number(data.dropoff_latitude) || 13.4180,
            dropoff_longitude: Number(data.dropoff_longitude) || 121.1850,
            estimated_distance_km: Number(data.estimated_distance_km) || 0,
            estimated_fare: Number(data.estimated_fare) || fare,
            booking_status: data.booking_status,
            created_at: data.created_at,
            updated_at: data.updated_at,
          } as any);

          setCurrentFare(fare);

          if (data.booking_status === 'Arrived at Destination') {
            setWaitingForPayment(true);
          } else if (data.booking_status === 'Cancelled' && data.cancelled_by === 'passenger') {
            setPassengerCancelReason(data.cancellation_reason || (language === 'tl' ? 'Kinansela ng pasahero ang booking' : 'Passenger cancelled the booking'));
            setPassengerCancelledAlertOpen(true);
          }
        }
      } catch (e) {
        console.warn('[DriverActiveTrip] Supabase fetch error:', e);
      }
    };

    fetchBookingDetails();
  }, [bookingId, language]);

  // The database is the source of truth. The passenger's phone is a DIFFERENT device, so neither this browser's storage nor a broadcast on a
  // public channel (anyone can send one) can tell the driver that the passenger paid or cancelled; the booking row can, read every 2 seconds.
  useEffect(() => {
    if (!bookingId) return;

    const checkBookingInDb = async () => {
      try {
        const { data } = await supabase
          .from('booking')
          .select('booking_status, actual_fare, fare_locked_at, fare_breakdown, cancelled_by, cancellation_reason')
          .eq('booking_id', bookingId)
          .maybeSingle();
        if (!data) return;
        if (data.fare_locked_at) {
          setFareLockedAt(data.fare_locked_at);
          if (data.actual_fare !== null && data.actual_fare !== undefined) {
            setLockedFare(Number(data.actual_fare));
            setFareBasis((data.fare_breakdown as { final?: { basis?: string } } | null)?.final?.basis ?? null);
          }
        }
        if (data.booking_status === 'Completed') {
          if (data.actual_fare !== null && data.actual_fare !== undefined) setCurrentFare(Number(data.actual_fare));
          setBooking((prev: any) => (prev ? { ...prev, booking_status: 'Completed' } : prev));
          if (!paymentConfirmed) {
            setPaymentConfirmed(true);
            setWaitingForPayment(false);
            setFeedbackModalOpen(true);
          }
        } else if (data.booking_status === 'Arrived at Destination') {
          if (data.actual_fare !== null && data.actual_fare !== undefined) setCurrentFare(Number(data.actual_fare));
          setBooking((prev: any) => (prev && prev.booking_status !== 'Arrived at Destination' ? { ...prev, booking_status: 'Arrived at Destination' } : prev));
          if (!paymentConfirmed) setWaitingForPayment(true);
        } else if (data.booking_status === 'Cancelled' && data.cancelled_by !== 'driver') {
          setPassengerCancelReason(data.cancellation_reason || (language === 'tl' ? 'Kinansela ang booking' : 'The booking was cancelled'));
          setPassengerCancelledAlertOpen(true);
        } else if (data.booking_status === 'Pending') {
          // The booking went back to the search (it is no longer ours): leave the trip screen.
          navigate('/driver/home', { replace: true });
        }
      } catch {
        // the next poll tries again
      }
    };

    checkBookingInDb();
    const interval = setInterval(checkBookingInDb, 2000);
    return () => clearInterval(interval);
  }, [bookingId, paymentConfirmed, language, navigate]);

  // The trip's progress as the database holds it (what Finish Trip is checked against), read while the passenger is on board.
  const readServerProgress = useCallback(async () => {
    if (!bookingId) return;
    const answer = await fetchServerTripProgress(supabase, bookingId);
    if (answer && answer.progressPercent !== null) setServerProgress(answer.progressPercent);
  }, [bookingId]);
  const tripIsOn = booking?.booking_status === 'Trip Ongoing';
  useEffect(() => {
    if (!tripIsOn) return;
    readServerProgress();
    const timer = setInterval(readServerProgress, 3000);
    return () => clearInterval(timer);
  }, [tripIsOn, readServerProgress]);

  // A clock for the confirmation countdown (only while waiting for the passenger)
  useEffect(() => {
    if (!waitingForPayment) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waitingForPayment]);

  // Real-time GPS broadcasting during active trip
  useEffect(() => {
    const channel = bookingId ? supabase.channel(`passenger_trip_${bookingId}`) : null;

    if (channel) {
      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED' && profile.currentLat && profile.currentLng) {
          channel.send({
            type: 'broadcast',
            event: 'driver_location',
            payload: { lat: profile.currentLat, lng: profile.currentLng, at: Date.now() },
          });
        }
      });
    }

    const broadcastInterval = setInterval(() => {
      if (channel && profile.currentLat && profile.currentLng) {
        channel.send({
          type: 'broadcast',
          event: 'driver_location',
          payload: { lat: profile.currentLat, lng: profile.currentLng, at: Date.now() },
        });
      }
    }, 2000);

    return () => {
      clearInterval(broadcastInterval);
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [bookingId, profile.currentLat, profile.currentLng, profile.id, booking?.driver_id]);

  // Moves the booking one step (the database decides whether the step is allowed, and stamps the time). Returns the booking as the database now has it.
  const moveBooking = async (status: string): Promise<{ ok: boolean; actualFare: number | null }> => {
    if (movingRef.current) return { ok: false, actualFare: null }; // the first tap is still being saved: a second one must not write again
    movingRef.current = true;
    setMoving(true);
    try {
      return await writeBookingStatus(status);
    } finally {
      movingRef.current = false;
      setMoving(false);
    }
  };

  const writeBookingStatus = async (status: string): Promise<{ ok: boolean; actualFare: number | null }> => {
    const { data, error } = await supabase
      .from('booking')
      .update({ booking_status: status })
      .eq('booking_id', bookingId)
      .select('booking_status, actual_fare, fare_locked_at')
      .maybeSingle();
    if (error || !data) {
      const why = error?.message ? error.message.replace(/^ERR_[A-Z_]+:\s*/, '') : '';
      setToastMessage(why || (language === 'tl' ? 'Hindi na-update ang booking. Pakisubukang muli.' : 'The booking could not be updated. Please try again.'));
      return { ok: false, actualFare: null };
    }
    setBooking((prev: any) => ({ ...prev, booking_status: data.booking_status }));
    if (data.fare_locked_at) setFareLockedAt(data.fare_locked_at);
    if (data.fare_locked_at && data.actual_fare !== null && data.actual_fare !== undefined) setLockedFare(Number(data.actual_fare));
    return { ok: true, actualFare: data.actual_fare !== null && data.actual_fare !== undefined ? Number(data.actual_fare) : null };
  };

  const handleEnRoute = async () => {
    await moveBooking('In Transit');
  };

  const handleArrived = async () => {
    await moveBooking('Arrived at Pickup');
  };

  const handleStartTrip = async () => {
    await moveBooking('Trip Ongoing');
  };

  const handleDriverSlideComplete = async () => {
    // The database computes and locks the final fare from the recorded GPS track when the trip first arrives (Rule 6.2); read it back
    // so the driver sees the same binding figure as the passenger.
    const arrived = await moveBooking('Arrived at Destination');
    if (!arrived.ok) {
      readServerProgress(); // the database refused (e.g. the trip is not far enough yet): show the figure it holds
      return;
    }
    if (arrived.actualFare !== null) setCurrentFare(arrived.actualFare);
    setWaitingForPayment(true);
  };

  // Rule 16.6: the passenger did not confirm within the confirmation time, so the driver may end the trip (recorded without the passenger's acknowledgement).
  const handleEndTripWithoutConfirmation = async () => {
    const ended = await moveBooking('Completed');
    if (!ended.ok) return;
    setPaymentConfirmed(true);
    setWaitingForPayment(false);
    setFeedbackModalOpen(true);
  };

  const handleFinishAndGoHome = () => {
    setFeedbackModalOpen(false);
    navigate('/driver/home', {
      replace: true,
      state: {
        showEarningsAnimation: true,
        completedFare: currentFare,
        passengerName,
      },
    });
  };

  // The only way to give a booking back after accepting it: the database records the reason, strikes as the policy says (Rules 12.3 / 12.4) and
  // puts the booking straight back into the search for another driver. Nothing is announced to the passenger from here: the booking row says it.
  const handleConfirmCancelTrip = async (reasonCode: DriverCancelReason) => {
    setCancelling(true);
    const { data, error } = await supabase.rpc('driver_cancel_booking', { p_booking_id: bookingId, p_reason_code: reasonCode, p_note: null });
    setCancelling(false);
    setCancelModalOpen(false);
    const result = data as { success?: boolean; error?: string } | null;
    if (error || !result?.success) {
      setToastMessage(
        result?.error ||
          (language === 'tl' ? 'Hindi makansela ang booking. Pakisubukang muli.' : 'The booking could not be cancelled. Please try again.')
      );
      return;
    }
    refreshPresence();
    navigate('/driver/home', { replace: true });
  };

  // Real GPS calculations
  const pickupLat = Number(booking?.pickup_latitude) || 13.4117;
  const pickupLng = Number(booking?.pickup_longitude) || 121.1803;
  const dropoffLat = Number(booking?.dropoff_latitude) || 13.4180;
  const dropoffLng = Number(booking?.dropoff_longitude) || 121.1850;

  const pickupDistKm = calculateDistanceKm(driverLocation.lat, driverLocation.lng, pickupLat, pickupLng);
  const dropoffDistKm = calculateDistanceKm(driverLocation.lat, driverLocation.lng, dropoffLat, dropoffLng);
  const totalTripKm = calculateDistanceKm(pickupLat, pickupLng, dropoffLat, dropoffLng);

  const isOngoing = booking?.booking_status === 'Trip Ongoing';
  const isArrived = booking?.booking_status === 'Arrived at Destination';

  // The progress is one formula for both screens and the database (tripProgress in @sakay/shared); the best the trip has reached is kept, and so is
  // the database's. The database also checks it again when the driver taps Finish Trip.
  let computedProgress = 0;
  if (isArrived || paymentConfirmed) {
    computedProgress = 100;
  } else if (isOngoing) {
    computedProgress = calculateTripProgressPercent({
      totalKm: totalTripKm,
      driverToDestinationKm: dropoffDistKm,
      previousPercent: Math.max(maxProgressRef.current, serverProgress ?? 0),
    });
    maxProgressRef.current = computedProgress;
  }
  const finishable = isTripFinishable(computedProgress);

  const passengerName = booking?.passenger_name || 'Passenger';
  const passengerPhone = booking?.passenger_phone || '';

  // What the Trip Details panel shows (the same facts the passenger's panel shows for this trip)
  const tripDetails = buildTripDetails({
    role: 'driver',
    status: booking?.booking_status,
    pickupAddress: booking?.pickup_address,
    dropoffAddress: booking?.dropoff_address,
    isSharedTrip: booking?.is_shared_trip,
    passengerCount: booking?.passenger_count,
    estimatedFare: booking?.estimated_fare,
    actualFare: lockedFare,
    fareLockedAt,
    fareBasis,
    counterpartName: booking?.passenger_name,
  });

  const isPreTrip =
    booking?.booking_status === 'Accepted' ||
    booking?.booking_status === 'Driver Assigned' ||
    booking?.booking_status === 'In Transit' ||
    booking?.booking_status === 'Arrived at Pickup';

  const getStageTitle = () => {
    if (waitingForPayment) return language === 'tl' ? 'Naghihintay ng kumpirmasyon' : 'Waiting for confirmation';
    const status = booking?.booking_status;
    if (status === 'Accepted' || status === 'Driver Assigned' || status === 'In Transit') {
      return language === 'tl' ? 'Papunta sa pickup' : 'Driving to pickup';
    }
    if (status === 'Arrived at Pickup' || status === 'Driver Arrived') {
      return language === 'tl' ? 'Nasa pickup na' : 'Arrived at pickup';
    }
    if (status === 'Trip Ongoing') {
      return language === 'tl' ? 'Nasa biyahe' : 'Trip in progress';
    }
    if (status === 'Arrived at Destination') {
      return language === 'tl' ? 'Nasa destinasyon na' : 'Arrived at destination';
    }
    return language === 'tl' ? 'Aktibong biyahe' : 'Active trip';
  };

  const tl = language === 'tl';
  const primaryButtonSx = {
    minHeight: 52,
    borderRadius: '16px',
    backgroundColor: '#FF6B00',
    color: '#FFFFFF',
    fontWeight: 700,
    fontSize: '16px',
    textTransform: 'none',
    boxShadow: 'none',
    '&:hover': { backgroundColor: '#E66000', boxShadow: 'none' },
    '&.Mui-disabled': { backgroundColor: '#E2E8F0', color: '#64748B' },
  } as const;
  const confirmationLeft = waitingForPayment
    ? Math.max(0, COMPLETION_CONFIRM_TIMEOUT_SECONDS - Math.floor((nowMs - (fareLockedAt ? Date.parse(fareLockedAt) : nowMs)) / 1000))
    : 0;
  const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        backgroundColor: '#E3ECEF',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      {/* 1. Leaflet OpenStreetMap Surface */}
      <MapView
        pickupLocation={{ lat: pickupLat, lng: pickupLng }}
        dropoffLocation={!isPreTrip ? { lat: dropoffLat, lng: dropoffLng } : undefined}
        userLocation={driverLocation}
      />

      {/* 2. Where the trip is: one line */}
      <Paper
        elevation={6}
        sx={{
          position: 'absolute',
          top: 'calc(var(--safe-area-top) + 12px)',
          left: 16,
          right: 16,
          backgroundColor: 'rgba(255, 255, 255, 0.96)',
          backdropFilter: 'blur(8px)',
          borderRadius: '20px',
          padding: '12px 16px',
          zIndex: 30,
          border: '1px solid #E2E8F0',
          boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
        }}
      >
        <Typography component="h1" sx={{ fontSize: '16px', color: '#0F172A', fontWeight: 700, fontFamily: 'Poppins, sans-serif' }}>
          {getStageTitle()}
        </Typography>
      </Paper>

      {/* 3. The passenger, the progress, and the trip details (collapsed until asked for) */}
      <Paper
        elevation={6}
        sx={{
          position: 'absolute',
          top: 'calc(var(--safe-area-top) + 72px)',
          left: 16,
          right: 16,
          maxHeight: 'calc(100% - var(--safe-area-top) - 72px - 210px)',
          overflowY: 'auto',
          p: 2,
          backgroundColor: 'rgba(255, 255, 255, 0.97)',
          backdropFilter: 'blur(8px)',
          borderRadius: '18px',
          border: '1px solid #E2E8F0',
          boxShadow: '0 8px 20px rgba(15, 23, 42, 0.08)',
          zIndex: 25,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1, minWidth: 0 }}>
            <Avatar sx={{ width: 40, height: 40, backgroundColor: '#FF6B00', fontWeight: 700, fontSize: '16px' }}>
              {passengerName.charAt(0)}
            </Avatar>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography noWrap sx={{ fontSize: '15px', fontWeight: 700, color: '#0F172A', fontFamily: 'Poppins, sans-serif' }}>
                {passengerName}
              </Typography>
              <Typography sx={{ fontSize: '12px', color: '#475569', fontFamily: 'Poppins, sans-serif', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <PersonIcon aria-hidden sx={{ fontSize: 14, color: '#64748B' }} />
                {booking?.passenger_count || 1} {tl ? 'pasahero' : (booking?.passenger_count || 1) === 1 ? 'passenger' : 'passengers'}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
            <IconButton
              aria-label={tl ? 'Tawagan ang pasahero' : 'Call passenger'}
              disabled={!passengerPhone}
              onClick={() => {
                if (passengerPhone) window.location.href = `tel:${passengerPhone}`;
              }}
              sx={{ backgroundColor: '#E6F4EA', color: '#166534', width: 44, height: 44, borderRadius: '12px', '&:hover': { backgroundColor: '#D1EBD7' } }}
            >
              <PhoneIcon fontSize="small" />
            </IconButton>
            <IconButton
              aria-label={tl ? 'Magpadala ng mensahe sa pasahero' : 'Message passenger'}
              onClick={() => setCommModalOpen(true)}
              sx={{ backgroundColor: '#FFF1E6', color: '#C2410C', width: 44, height: 44, borderRadius: '12px', '&:hover': { backgroundColor: '#FFE6D2' } }}
            >
              <MessageIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>

        {/* Progress: the distance to the pickup before the passenger boards, the share of the trip after */}
        <Box sx={{ mt: 1.5, pt: 1.25, borderTop: '1px solid #F1F5F9' }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography sx={{ fontSize: '12px', color: '#475569', fontWeight: 600, fontFamily: 'Poppins, sans-serif' }}>
              {isPreTrip ? (tl ? 'Layo sa pickup' : 'Distance to pickup') : tl ? 'Progreso papunta sa destinasyon' : 'Progress to destination'}
            </Typography>
            <Typography sx={{ fontSize: '14px', fontWeight: 800, color: '#0F172A', fontFamily: 'Poppins, sans-serif' }}>
              {isPreTrip
                ? formatDistance(pickupDistKm)
                : isArrived || paymentConfirmed
                ? '100%'
                : `${computedProgress}% · ${formatDistance(dropoffDistKm)} ${tl ? 'pa' : 'left'}`}
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            aria-label={isPreTrip ? (tl ? 'Layo sa pickup' : 'Distance to pickup') : tl ? 'Progreso ng biyahe' : 'Trip progress'}
            value={isPreTrip ? Math.min(100, Math.max(10, 100 - pickupDistKm * 20)) : computedProgress}
            sx={{
              height: 6,
              borderRadius: 3,
              backgroundColor: '#E2E8F0',
              '& .MuiLinearProgress-bar': { backgroundColor: '#FF6B00', borderRadius: 3 },
            }}
          />
        </Box>

        <Box sx={{ mt: 0.5, pt: 0.5, borderTop: '1px solid #F1F5F9' }}>
          <TripDetailsPanel view={tripDetails} language={language} variant="plain" />
        </Box>
      </Paper>

      {/* 4. The action for this stage, and the way out */}
      <Paper
        elevation={8}
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: '#FFFFFF',
          borderTopLeftRadius: '24px',
          borderTopRightRadius: '24px',
          padding: '16px 20px calc(var(--safe-area-bottom) + 20px) 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 1.25,
          zIndex: 30,
          borderTop: '1px solid #E2E8F0',
          boxShadow: '0 -8px 30px rgba(0, 0, 0, 0.08)',
        }}
      >
        {onTheWay && (
          <EnRouteNotices bookingId={bookingId} language={language} stallWarnedAt={clocks.stallWarnedAt} onMessage={setToastMessage} />
        )}

        {!booking ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.25, minHeight: 52 }} role="status">
            <CircularProgress size={20} sx={{ color: '#FF6B00' }} />
            <Typography sx={{ fontSize: '14px', color: '#475569', fontFamily: 'Poppins, sans-serif' }}>{tl ? 'Kinukuha ang biyahe...' : 'Loading the trip...'}</Typography>
          </Box>
        ) : booking.booking_status === 'Accepted' || booking.booking_status === 'Driver Assigned' ? (
          <Button variant="contained" fullWidth disabled={moving} onClick={handleEnRoute} sx={primaryButtonSx}>
            {moving ? <CircularProgress size={24} color="inherit" aria-label={tl ? 'Isinusulat' : 'Saving'} /> : tl ? 'Papunta Na Ako' : "I'm On My Way"}
          </Button>
        ) : booking.booking_status === 'In Transit' ? (
          <Button variant="contained" fullWidth disabled={moving} onClick={handleArrived} sx={primaryButtonSx}>
            {moving ? <CircularProgress size={24} color="inherit" aria-label={tl ? 'Isinusulat' : 'Saving'} /> : tl ? 'Nakarating na sa Pickup' : 'Arrived at Pickup'}
          </Button>
        ) : booking.booking_status === 'Arrived at Pickup' || booking.booking_status === 'Driver Arrived' ? (
          <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            <ArrivalWaitPanel
              bookingId={bookingId}
              language={language}
              onMessage={setToastMessage}
              onNoShowReported={() => {
                refreshPresence();
                navigate('/driver/home', { replace: true });
              }}
            />
            <Button variant="contained" fullWidth disabled={moving} onClick={handleStartTrip} startIcon={moving ? undefined : <LocalTaxiIcon />} sx={primaryButtonSx}>
              {moving ? <CircularProgress size={24} color="inherit" aria-label={tl ? 'Isinusulat' : 'Saving'} /> : tl ? 'Simulan ang Biyahe' : 'Start Trip'}
            </Button>
          </Box>
        ) : waitingForPayment ? (
          /* Finished on this side: the passenger confirms the fare (Rule 16.6), and after the confirmation time the driver may end the trip */
          <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: '12px 14px', borderRadius: '14px', backgroundColor: '#FFFBEB', border: '1.5px solid #FCD34D' }}>
              <CircularProgress size={22} sx={{ color: '#B45309', flexShrink: 0 }} />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#78350F', fontFamily: 'Poppins, sans-serif' }}>
                  {tl ? 'Naghihintay ng kumpirmasyon ng pasahero' : 'Waiting for the passenger to confirm'}
                </Typography>
                {confirmationLeft > 0 && (
                  <Typography sx={{ fontSize: '12px', color: '#78350F', fontFamily: 'Poppins, sans-serif' }}>
                    {tl
                      ? `Maaari mong tapusin ang biyahe sa ${clock(confirmationLeft)} kung hindi magkumpirma ang pasahero.`
                      : `If the passenger does not confirm, you can end the trip in ${clock(confirmationLeft)}.`}
                  </Typography>
                )}
              </Box>
            </Box>
            {confirmationLeft === 0 && (
              <Button
                variant="outlined"
                fullWidth
                disabled={moving}
                onClick={handleEndTripWithoutConfirmation}
                sx={{ minHeight: 52, borderRadius: '16px', fontWeight: 700, textTransform: 'none', fontFamily: 'Poppins, sans-serif', borderColor: '#C2410C', color: '#C2410C' }}
              >
                {tl ? 'Tapusin ang biyahe (hindi nagkumpirma ang pasahero)' : 'End trip (the passenger did not confirm)'}
              </Button>
            )}
          </Box>
        ) : booking.booking_status === 'Trip Ongoing' ? (
          /* The trip is on: Finish Trip is there from the start and opens at 90% (the database checks the same figure) */
          <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Button
              variant="contained"
              fullWidth
              disabled={!finishable || moving}
              onClick={handleDriverSlideComplete}
              startIcon={moving ? undefined : <CheckCircleIcon />}
              aria-describedby={finishable ? undefined : 'finish-trip-help'}
              sx={primaryButtonSx}
            >
              {moving ? <CircularProgress size={24} color="inherit" aria-label={tl ? 'Isinusulat' : 'Saving'} /> : tl ? 'Tapusin ang Biyahe' : 'Finish Trip'}
            </Button>
            {!finishable && (
              <Typography id="finish-trip-help" sx={{ fontSize: '12px', color: '#475569', textAlign: 'center', fontWeight: 500, fontFamily: 'Poppins, sans-serif' }}>
                {tl
                  ? `Mabubuksan ang Tapusin ang Biyahe sa ${TRIP_FINISH_MIN_PROGRESS_PERCENT}% ng ruta. Nasa ${computedProgress}% ka na.`
                  : `Finish Trip opens at ${TRIP_FINISH_MIN_PROGRESS_PERCENT}% of the route. You are at ${computedProgress}%.`}
              </Typography>
            )}
          </Box>
        ) : null}

        {/* The way out, before the passenger is on board: a plain button that opens the same confirmation (reason and confirm) */}
        {booking && isPreTrip && !waitingForPayment && (
          <Button
            variant="text"
            fullWidth
            disabled={cancelling}
            onClick={() => setCancelModalOpen(true)}
            sx={{ minHeight: 48, borderRadius: '14px', textTransform: 'none', fontWeight: 600, fontSize: '14px', color: '#B91C1C', fontFamily: 'Poppins, sans-serif', '&:hover': { backgroundColor: '#FEF2F2' } }}
          >
            {tl ? 'Ikansel ang booking' : 'Cancel booking'}
          </Button>
        )}
      </Paper>

      {/* Driver ↔ Passenger Communication Modal */}
      <DriverCommunicationModal
        open={commModalOpen}
        onClose={() => setCommModalOpen(false)}
        passengerName={passengerName}
        passengerPhone={passengerPhone}
        currentStage={booking?.booking_status}
      />

      {/* Driver Feedback Modal (opens when payment is confirmed) */}
      <DriverFeedbackModal
        open={feedbackModalOpen}
        onClose={handleFinishAndGoHome}
        onSubmitted={handleFinishAndGoHome}
        booking={{
          booking_id: bookingId,
          passenger_name: passengerName,
          passenger_id: booking?.passenger_id,
          driver_id: profile.id,
        }}
      />

      {/* Driver Cancel Confirmation Modal with Reasons */}
      <DriverCancelModal
        open={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        onConfirmCancel={handleConfirmCancelTrip}
        language={language}
        loading={cancelling}
      />

      <SakayToast message={toastMessage} severity="warning" onClose={() => setToastMessage(null)} />

      <BookingGivenAwayDialog
        open={clocks.bookingGone}
        language={language}
        onClose={() => {
          refreshPresence();
          navigate('/driver/home', { replace: true });
        }}
      />

      {/* Bidirectional Passenger Cancellation Realtime Notification Modal */}
      <Dialog
        open={passengerCancelledAlertOpen}
        onClose={() => {
          setPassengerCancelledAlertOpen(false);
          navigate('/driver/home', { replace: true });
        }}
        slotProps={{
          paper: {
            sx: { borderRadius: '24px', p: 1.5, backgroundColor: '#FFFFFF', maxWidth: '380px', width: '90%' },
          },
        }}
      >
        <DialogTitle sx={{ textAlign: 'center', pt: 2, pb: 1 }}>
          <CancelIcon sx={{ fontSize: 48, color: '#EF4444', mb: 1 }} />
          <Typography sx={{ fontSize: '18px', fontWeight: 800, color: '#0F172A', fontFamily: 'Poppins, sans-serif' }}>
            {language === 'tl' ? 'Kanselado ang Biyahe' : 'Trip Cancelled'}
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ textAlign: 'center', pb: 2 }}>
          <Typography sx={{ fontSize: '14px', color: '#475569', fontWeight: 600, fontFamily: 'Poppins, sans-serif' }}>
            {language === 'tl'
              ? 'Kinansela ng pasahero ang booking.'
              : 'The passenger has cancelled the booking.'}
          </Typography>
          {passengerCancelReason && (
            <Box sx={{ mt: 1.5, p: '10px 14px', backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '12px' }}>
              <Typography sx={{ fontSize: '12.5px', color: '#B91C1C', fontWeight: 600, fontFamily: 'Poppins, sans-serif' }}>
                {language === 'tl' ? 'Rason:' : 'Reason:'} "{passengerCancelReason}"
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2, pt: 0 }}>
          <Button
            fullWidth
            variant="contained"
            onClick={() => {
              setPassengerCancelledAlertOpen(false);
              navigate('/driver/home', { replace: true });
            }}
            sx={{
              height: 46,
              borderRadius: '14px',
              backgroundColor: '#FF6B00',
              fontWeight: 800,
              fontSize: '14px',
              textTransform: 'none',
              fontFamily: 'Poppins, sans-serif',
              boxShadow: '0 4px 14px rgba(255, 107, 0, 0.25)',
              '&:hover': { backgroundColor: '#E66000' },
            }}
          >
            {language === 'tl' ? 'OK (Bumalik sa Home)' : 'OK (Return Home)'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Exit Guard Confirmation Dialog */}
      <Dialog
        open={exitGuardOpen}
        onClose={() => setExitGuardOpen(false)}
        slotProps={{
          paper: {
            sx: { borderRadius: '20px', padding: '8px', backgroundColor: '#FFFFFF' },
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 800, fontSize: '17px', color: '#0F172A', textAlign: 'center' }}>
          {language === 'tl' ? 'Biyahe ay Aktibo' : 'Active Trip'}
        </DialogTitle>
        <DialogContent sx={{ textAlign: 'center', py: 1 }}>
          <Typography sx={{ fontSize: '13.5px', color: '#475569', lineHeight: 1.5 }}>
            {language === 'tl'
              ? `May pasahero ka sa biyahe (${passengerName}). Nais mo bang bumalik sa Home?`
              : `You currently have passenger (${passengerName}). Do you want to return to Home? Your trip progress will remain active.`}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 2, pb: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Button
            fullWidth
            variant="contained"
            onClick={() => setExitGuardOpen(false)}
            sx={{
              height: 44,
              borderRadius: '12px',
              backgroundColor: '#FF6B00',
              fontWeight: 700,
              textTransform: 'none',
              '&:hover': { backgroundColor: '#E66000' },
            }}
          >
            {language === 'tl' ? 'Manatili sa Biyahe' : 'Stay in Trip'}
          </Button>
          <Button
            fullWidth
            variant="outlined"
            color="error"
            onClick={() => navigate('/driver/home')}
            sx={{
              height: 44,
              borderRadius: '12px',
              fontWeight: 700,
              textTransform: 'none',
            }}
          >
            {language === 'tl' ? 'Bumalik sa Home' : 'Return to Home'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default DriverActiveTrip;
