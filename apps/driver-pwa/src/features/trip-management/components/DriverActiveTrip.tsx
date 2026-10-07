import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Button,
  IconButton,
  Chip,
  LinearProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Avatar,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import LocalTaxiIcon from '@mui/icons-material/LocalTaxi';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import CancelIcon from '@mui/icons-material/Cancel';
import PhoneIcon from '@mui/icons-material/Phone';
import MessageIcon from '@mui/icons-material/Message';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import PersonIcon from '@mui/icons-material/Person';

import MapView from '../../../common/components/MapView';
import { supabase } from '../../../services/supabaseClient';
import { useLanguage } from '../../../utils/LanguageContext';
import { useDriverSession } from '../../../contexts/DriverSessionContext';
import { COMPLETION_CONFIRM_TIMEOUT_SECONDS, calculateDistanceKm, formatDistance, type DriverCancelReason } from '@sakay/shared';
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

  // Collapsible Card State
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);

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

  // Scroll to cancel drag tracking for driver
  const [dragY, setDragY] = useState(0);
  const isDraggingSheet = useRef(false);
  const startY = useRef(0);
  const maxProgressRef = useRef(0);

  // Additional Shared Passenger State
  const [pairedPassenger, setPairedPassenger] = useState<string | null>(null);
  const [sharedPromptOpen, setSharedPromptOpen] = useState(false);
  const [hasPromptedShared, setHasPromptedShared] = useState(false);

  // The fare on screen: the estimate until the trip arrives, then the final fare the database wrote (Rule 6.2).
  const [currentFare, setCurrentFare] = useState<number>(booking?.estimated_fare ?? 0);

  // Rules 8 / 9: while the driver is on the way the system watches his progress. It may warn him (8.2), and if he does not start or cannot be
  // reached it cancels on his behalf and gives the booking to another driver: this screen then has nothing left to show.
  const onTheWay = booking?.booking_status === 'Accepted' || booking?.booking_status === 'Driver Assigned' || booking?.booking_status === 'In Transit';
  const clocks = useAssignedBookingClocks(bookingId, onTheWay);
  const driverLocation = {
    lat: profile.currentLat || booking?.pickup_latitude || 13.4117,
    lng: profile.currentLng || booking?.pickup_longitude || 121.1803,
  };

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

          setBooking({
            booking_id: data.booking_id,
            passenger_id: data.passenger_id,
            passenger_name: party?.passenger_name || data.passenger_name || 'Passenger',
            passenger_phone: party?.passenger_phone || '',
            booking_type: data.booking_type || 'Immediate',
            is_shared_trip: Boolean(data.is_shared_trip),
            passenger_count: data.passenger_count || 1,
            pickup_address: data.pickup_address || data.pickup_location_address || 'Calapan City',
            pickup_latitude: Number(data.pickup_latitude) || 13.4117,
            pickup_longitude: Number(data.pickup_longitude) || 121.1803,
            dropoff_address: data.dropoff_address || data.dropoff_location_address || 'Calapan City Public Market',
            dropoff_latitude: Number(data.dropoff_latitude) || 13.4180,
            dropoff_longitude: Number(data.dropoff_longitude) || 121.1850,
            estimated_distance_km: Number(data.estimated_distance_km) || 0,
            estimated_fare: fare,
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
          .select('booking_status, actual_fare, fare_locked_at, cancelled_by, cancellation_reason')
          .eq('booking_id', bookingId)
          .maybeSingle();
        if (!data) return;
        if (data.fare_locked_at) setFareLockedAt(data.fare_locked_at);
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
            payload: { lat: profile.currentLat, lng: profile.currentLng },
          });
        }
      });
    }

    const broadcastInterval = setInterval(() => {
      if (channel && profile.currentLat && profile.currentLng) {
        channel.send({
          type: 'broadcast',
          event: 'driver_location',
          payload: { lat: profile.currentLat, lng: profile.currentLng },
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
    if (!arrived.ok) return;
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

  // Scroll to cancel drag handlers for Driver PWA footer sheet
  const handleSheetTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    const pageY = 'touches' in e ? e.touches[0].pageY : e.pageY;
    isDraggingSheet.current = true;
    startY.current = pageY;
  };

  const handleSheetTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDraggingSheet.current) return;
    const pageY = 'touches' in e ? e.touches[0].pageY : e.pageY;
    const diff = startY.current - pageY;
    // Bound drag distance (maxDrag = 150px)
    const clamped = Math.max(0, Math.min(150, diff));
    setDragY(clamped);

    if (clamped >= 120) {
      isDraggingSheet.current = false;
      setDragY(0);
      setCancelModalOpen(true);
    }
  };

  const handleSheetTouchEnd = () => {
    if (!isDraggingSheet.current) return;
    isDraggingSheet.current = false;
    setDragY(0);
  };

  // Real GPS calculations
  const pickupLat = Number(booking?.pickup_latitude) || 13.4117;
  const pickupLng = Number(booking?.pickup_longitude) || 121.1803;
  const dropoffLat = Number(booking?.dropoff_latitude) || 13.4180;
  const dropoffLng = Number(booking?.dropoff_longitude) || 121.1850;

  const pickupDistKm = calculateDistanceKm(driverLocation.lat, driverLocation.lng, pickupLat, pickupLng);
  const dropoffDistKm = calculateDistanceKm(driverLocation.lat, driverLocation.lng, dropoffLat, dropoffLng);
  const totalTripKm = calculateDistanceKm(pickupLat, pickupLng, dropoffLat, dropoffLng) || 1.5;

  const isOngoing = booking?.booking_status === 'Trip Ongoing';
  const isArrived = booking?.booking_status === 'Arrived at Destination';

  let computedProgress = 0;
  if (isArrived || paymentConfirmed) {
    computedProgress = 100;
  } else if (isOngoing) {
    const rawProgress = Math.round(((totalTripKm - dropoffDistKm) / totalTripKm) * 100);
    const proximityProgress = dropoffDistKm <= 0.08 ? 95 : Math.max(5, rawProgress);
    computedProgress = Math.min(95, Math.max(maxProgressRef.current, proximityProgress));
    maxProgressRef.current = computedProgress;
  }

  const passengerName = booking?.passenger_name || 'Passenger';
  const passengerPhone = booking?.passenger_phone || '';
  const dropoffAddress = booking?.dropoff_address || 'Calapan Public Market';

  const isPreTrip =
    booking?.booking_status === 'Accepted' ||
    booking?.booking_status === 'Driver Assigned' ||
    booking?.booking_status === 'In Transit' ||
    booking?.booking_status === 'Arrived at Pickup';

  const getStageTitle = () => {
    if (waitingForPayment) return language === 'tl' ? 'NAGHIHINTAY NG BAYAD' : 'WAITING FOR PAYMENT';
    const status = booking?.booking_status;
    if (status === 'Accepted' || status === 'Driver Assigned' || status === 'In Transit') {
      return language === 'tl' ? 'PAPUNTA SA PICKUP' : 'DRIVING TO PICKUP';
    }
    if (status === 'Arrived at Pickup' || status === 'Driver Arrived') {
      return language === 'tl' ? 'NASA PICKUP NA' : 'ARRIVED AT PICKUP';
    }
    if (status === 'Trip Ongoing') {
      return language === 'tl' ? 'BIYAHE AY ONGOING' : 'TRIP IN PROGRESS';
    }
    if (status === 'Arrived at Destination') {
      return language === 'tl' ? 'NASA DESTINASYON NA' : 'ARRIVED AT DESTINATION';
    }
    return language === 'tl' ? 'BIYAHE' : 'ACTIVE TRIP';
  };

  return (
    <Box
      onClick={() => setIsDetailsExpanded(false)}
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

      {/* 2. Top Floating Navigation Header */}
      <Paper
        elevation={6}
        onClick={(e) => e.stopPropagation()}
        sx={{
          position: 'absolute',
          top: 'calc(var(--safe-area-top) + 12px)',
          left: 16,
          right: 16,
          backgroundColor: 'rgba(255, 255, 255, 0.96)',
          backdropFilter: 'blur(8px)',
          borderRadius: '20px',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 30,
          border: '1px solid #E2E8F0',
          boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
        }}
      >
        <Typography
          sx={{
            fontSize: '13.5px',
            color: '#0F172A',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            fontFamily: 'Poppins, sans-serif',
          }}
        >
          {getStageTitle()}
        </Typography>
        <Chip
          label={booking?.is_shared_trip ? 'Shared Ride' : 'Solo Trip'}
          size="small"
          sx={{
            backgroundColor: '#FFF8F0',
            color: '#FF6B00',
            fontWeight: 800,
            border: '1px solid #FFD6B3',
            fontFamily: 'Poppins, sans-serif',
          }}
        />
      </Paper>

      {/* 3. Floating Collapsible Trip Card with Persistent Destination Progress */}
      <Paper
        elevation={6}
        onClick={(e) => e.stopPropagation()}
        sx={{
          position: 'absolute',
          top: 'calc(var(--safe-area-top) + 76px)',
          left: 16,
          right: 16,
          p: 2,
          backgroundColor: 'rgba(255, 255, 255, 0.96)',
          backdropFilter: 'blur(8px)',
          borderRadius: '18px',
          border: '1px solid #E2E8F0',
          boxShadow: '0 8px 20px rgba(15, 23, 42, 0.08)',
          zIndex: 25,
          transition: 'all 0.25s ease',
        }}
      >
        {/* Main Row: Passenger Name & Destination + Toggle */}
        <Box
          onClick={() => setIsDetailsExpanded((prev) => !prev)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1, minWidth: 0 }}>
            <Avatar sx={{ width: 40, height: 40, backgroundColor: '#FF6B00', fontWeight: 800, fontSize: '15px' }}>
              {passengerName.charAt(0)}
            </Avatar>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontSize: '15px', fontWeight: 800, color: '#0F172A', fontFamily: 'Poppins, sans-serif', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {passengerName}
              </Typography>
              <Typography sx={{ fontSize: '11.5px', color: '#64748B', fontFamily: 'Poppins, sans-serif', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <PersonIcon sx={{ fontSize: 13, color: '#94A3B8' }} />
                {booking?.passenger_count || 1} {language === 'tl' ? 'pasahero' : 'passenger(s)'}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <IconButton
              onClick={(e) => {
                e.stopPropagation();
                if (passengerPhone) window.location.href = `tel:${passengerPhone}`;
              }}
              sx={{ backgroundColor: '#E6F4EA', color: '#1E8E3E', width: 34, height: 34, borderRadius: '10px' }}
              title={language === 'tl' ? 'Tawagan ang pasahero' : 'Call passenger'}
            >
              <PhoneIcon fontSize="small" />
            </IconButton>
            <IconButton
              onClick={(e) => {
                e.stopPropagation();
                setCommModalOpen(true);
              }}
              sx={{ backgroundColor: '#FFF8F0', color: '#FF6B00', width: 34, height: 34, borderRadius: '10px' }}
              title={language === 'tl' ? 'Magpadala ng mensahe' : 'Send message'}
            >
              <MessageIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                setIsDetailsExpanded((prev) => !prev);
              }}
              sx={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', color: '#0F172A', width: 34, height: 34, borderRadius: '10px' }}
            >
              {isDetailsExpanded ? <KeyboardArrowUpIcon fontSize="small" /> : <KeyboardArrowDownIcon fontSize="small" />}
            </IconButton>
          </Box>
        </Box>

        {/* ALWAYS VISIBLE DESTINATION PROGRESS INDICATOR */}
        <Box sx={{ mt: 1.5, pt: 1, borderTop: '1px solid #F1F5F9' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography sx={{ fontSize: '11.5px', color: '#64748B', fontWeight: 700, fontFamily: 'Poppins, sans-serif' }}>
              {isPreTrip ? 'Pickup Distance' : 'Progress towards Destination'}
            </Typography>
            <Typography sx={{ fontSize: '13px', fontWeight: 900, color: '#FF6B00', fontFamily: 'Poppins, sans-serif' }}>
              {isPreTrip ? formatDistance(pickupDistKm) : `${computedProgress}% (${formatDistance(dropoffDistKm)} left)`}
            </Typography>
          </Box>

          <LinearProgress
            variant="determinate"
            value={isPreTrip ? Math.min(100, Math.max(10, 100 - pickupDistKm * 20)) : computedProgress}
            sx={{
              height: 6,
              borderRadius: 3,
              backgroundColor: '#E2E8F0',
              '& .MuiLinearProgress-bar': { backgroundColor: '#FF6B00', borderRadius: 3 },
            }}
          />
        </Box>

        {/* Collapsible Expanded Details */}
        {isDetailsExpanded && (
          <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid #F1F5F9', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            <Box sx={{ p: 1.25, borderRadius: '12px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                <LocationOnIcon sx={{ color: '#FF6B00', fontSize: 18, mt: '2px', flexShrink: 0 }} />
                <Box>
                  <Typography sx={{ fontSize: '10px', color: '#94A3B8', fontWeight: 700, fontFamily: 'Poppins, sans-serif', textTransform: 'uppercase' }}>
                    {language === 'tl' ? 'LOKASYON NG PICKUP' : 'PICKUP LOCATION'}
                  </Typography>
                  <Typography sx={{ fontSize: '12.5px', fontWeight: 700, color: '#0F172A', fontFamily: 'Poppins, sans-serif' }}>
                    {booking?.pickup_address || 'Calapan City'}
                  </Typography>
                </Box>
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, pt: 0.75, borderTop: '1px dashed #E2E8F0' }}>
                <LocationOnIcon sx={{ color: '#EF4444', fontSize: 18, mt: '2px', flexShrink: 0 }} />
                <Box>
                  <Typography sx={{ fontSize: '10px', color: '#94A3B8', fontWeight: 700, fontFamily: 'Poppins, sans-serif', textTransform: 'uppercase' }}>
                    {language === 'tl' ? 'DESTINASYON' : 'DESTINATION'}
                  </Typography>
                  <Typography sx={{ fontSize: '12.5px', fontWeight: 700, color: '#0F172A', fontFamily: 'Poppins, sans-serif' }}>
                    {dropoffAddress}
                  </Typography>
                </Box>
              </Box>
            </Box>

            {pairedPassenger && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.25, backgroundColor: '#ECFDF5', borderRadius: '12px', border: '1px solid #A7F3D0' }}>
                <Avatar sx={{ width: 28, height: 28, backgroundColor: '#10B981', color: '#FFFFFF', fontWeight: 800, fontSize: '12px' }}>
                  J
                </Avatar>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontSize: '12.5px', fontWeight: 700, color: '#065F46', fontFamily: 'Poppins, sans-serif' }}>
                    {pairedPassenger}
                  </Typography>
                  <Typography sx={{ fontSize: '11px', color: '#047857', fontFamily: 'Poppins, sans-serif' }}>
                    Passenger #2 (Shared Carpool)
                  </Typography>
                </Box>
              </Box>
            )}
          </Box>
        )}
      </Paper>

      {/* 4. Bottom Action Footer with Draggable Scroll-To-Cancel */}
      <Paper
        elevation={8}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={handleSheetTouchStart}
        onMouseMove={handleSheetTouchMove}
        onMouseUp={handleSheetTouchEnd}
        onTouchStart={handleSheetTouchStart}
        onTouchMove={handleSheetTouchMove}
        onTouchEnd={handleSheetTouchEnd}
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
          transform: `translateY(${-dragY}px)`,
          transition: isDraggingSheet.current ? 'none' : 'transform 0.25s ease',
        }}
      >
        {/* Scroll-to-Cancel Guidance Bar during Pickup Stage */}
        {isPreTrip && !waitingForPayment && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, py: 0.25 }}>
            <Typography sx={{ fontSize: '11.5px', fontWeight: 700, color: '#94A3B8', fontFamily: 'Poppins, sans-serif' }}>
              ⌃⌃ {language === 'tl' ? 'I-scroll pataas para ikansela ang biyahe' : 'Scroll up to cancel trip'} ⌃⌃
            </Typography>
          </Box>
        )}

        {/* Estimated Arrival Time / Distance */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 0.5 }}>
          <Typography sx={{ fontSize: '11px', fontWeight: 800, color: '#64748B', fontFamily: 'Poppins, sans-serif', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            ESTIMATED ROUTE DISTANCE:
          </Typography>
          <Chip
            label={isPreTrip ? `Pickup: ${formatDistance(pickupDistKm)}` : `Dest: ${formatDistance(dropoffDistKm)}`}
            size="small"
            sx={{
              backgroundColor: '#FFF7ED',
              color: '#FF6B00',
              fontWeight: 800,
              fontSize: '11px',
              height: '24px',
              border: '1px solid #FFD6B3',
              fontFamily: 'Poppins, sans-serif',
            }}
          />
        </Box>

        {/* Total Fare Display */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 0.5 }}>
          <Typography sx={{ fontSize: '13px', fontWeight: 700, color: '#64748B', fontFamily: 'Poppins, sans-serif' }}>
            Total Trip Fare:
          </Typography>
          <Typography sx={{ fontSize: '22px', fontWeight: 900, color: '#FF6B00', fontFamily: 'Poppins, sans-serif' }}>
            ₱{currentFare.toFixed(2)}
          </Typography>
        </Box>

        {onTheWay && (
          <EnRouteNotices bookingId={bookingId} language={language} stallWarnedAt={clocks.stallWarnedAt} onMessage={setToastMessage} />
        )}

        {/* Dynamic Booking Action Button Controls */}
        {booking?.booking_status === 'Accepted' || booking?.booking_status === 'Driver Assigned' ? (
          <Button
            variant="contained"
            fullWidth
            onClick={handleEnRoute}
            sx={{
              height: 48,
              borderRadius: '14px',
              backgroundColor: '#3B82F6',
              fontWeight: 800,
              fontSize: '14.5px',
              textTransform: 'none',
              fontFamily: 'Poppins, sans-serif',
              '&:hover': { backgroundColor: '#2563EB' },
            }}
          >
            I'm On My Way
          </Button>
        ) : booking?.booking_status === 'In Transit' ? (
          <Button
            variant="contained"
            fullWidth
            onClick={handleArrived}
            sx={{
              height: 48,
              borderRadius: '14px',
              backgroundColor: '#F59E0B',
              fontWeight: 800,
              fontSize: '14.5px',
              textTransform: 'none',
              fontFamily: 'Poppins, sans-serif',
              '&:hover': { backgroundColor: '#D97706' },
            }}
          >
            {language === 'tl' ? 'Nakarating na sa Pickup' : 'Arrived at Pickup'}
          </Button>
        ) : booking?.booking_status === 'Arrived at Pickup' || booking?.booking_status === 'Driver Arrived' ? (
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
            <Button
              variant="contained"
              fullWidth
              onClick={handleStartTrip}
              startIcon={<LocalTaxiIcon />}
              sx={{
                height: 48,
                borderRadius: '14px',
                backgroundColor: '#10B981',
                fontWeight: 800,
                fontSize: '14.5px',
                textTransform: 'none',
                fontFamily: 'Poppins, sans-serif',
                '&:hover': { backgroundColor: '#059669' },
              }}
            >
              Start Trip
            </Button>
          </Box>
        ) : (
          (() => {
            const isNearDestination = dropoffDistKm <= 0.05; // 50 meters
            const canComplete = paymentConfirmed || isNearDestination;

            return (
              <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                <Button
                  variant="contained"
                  fullWidth
                  disabled={!canComplete || waitingForPayment}
                  onClick={handleDriverSlideComplete}
                  startIcon={<CheckCircleIcon />}
                  sx={{
                    height: 50,
                    borderRadius: '14px',
                    backgroundColor: canComplete && !waitingForPayment ? '#FF6B00' : '#E2E8F0',
                    color: canComplete && !waitingForPayment ? '#FFFFFF' : '#94A3B8',
                    fontWeight: 800,
                    fontSize: '15px',
                    textTransform: 'none',
                    fontFamily: 'Poppins, sans-serif',
                    boxShadow: canComplete && !waitingForPayment ? '0 4px 14px rgba(255, 107, 0, 0.35)' : 'none',
                    '&:hover': {
                      backgroundColor: canComplete && !waitingForPayment ? '#E66000' : '#E2E8F0',
                    },
                    '&.Mui-disabled': {
                      backgroundColor: '#F1F5F9',
                      color: '#94A3B8',
                    },
                  }}
                >
                  {waitingForPayment
                    ? (language === 'tl' ? 'Naghihintay ng Kumpirmasyon...' : 'Waiting for Passenger Confirmation...')
                    : (language === 'tl' ? 'Tapusin ang Biyahe' : 'Complete Trip')}
                </Button>
                {waitingForPayment && (() => {
                  const lockedMs = fareLockedAt ? Date.parse(fareLockedAt) : nowMs;
                  const left = Math.max(0, COMPLETION_CONFIRM_TIMEOUT_SECONDS - Math.floor((nowMs - lockedMs) / 1000));
                  return left > 0 ? (
                    <Typography sx={{ fontSize: '11px', color: '#64748B', textAlign: 'center', fontWeight: 600, fontFamily: 'Poppins, sans-serif' }}>
                      {language === 'tl'
                        ? `Kung hindi magkumpirma ang pasahero, maaari mong tapusin ang biyahe sa ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}.`
                        : `If the passenger does not confirm, you can end the trip in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}.`}
                    </Typography>
                  ) : (
                    <Button
                      variant="outlined"
                      fullWidth
                      onClick={handleEndTripWithoutConfirmation}
                      sx={{ height: 44, borderRadius: '14px', fontWeight: 800, textTransform: 'none', fontFamily: 'Poppins, sans-serif', borderColor: '#FF6B00', color: '#FF6B00' }}
                    >
                      {language === 'tl' ? 'Tapusin ang biyahe (hindi nagkumpirma ang pasahero)' : 'End trip (the passenger did not confirm)'}
                    </Button>
                  );
                })()}
                {!canComplete && !waitingForPayment && (
                  <Typography sx={{ fontSize: '11px', color: '#64748B', textAlign: 'center', fontWeight: 600, fontFamily: 'Poppins, sans-serif' }}>
                    {language === 'tl'
                      ? `Maaaring tapusin kapag nag-slide ang pasahero o nasa loob ng 50m (${formatDistance(dropoffDistKm)} pa)`
                      : `Active when passenger slides to finish or within 50m of destination (${formatDistance(dropoffDistKm)} left)`}
                  </Typography>
                )}
              </Box>
            );
          })()
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
