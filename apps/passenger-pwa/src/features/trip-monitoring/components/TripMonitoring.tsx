import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Button,
  IconButton,
  ButtonBase,
  Avatar,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Alert,
  Radio,
  RadioGroup,
  FormControlLabel,
  FormControl,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PhoneIcon from '@mui/icons-material/Phone';
import MessageIcon from '@mui/icons-material/Message';
import StarIcon from '@mui/icons-material/Star';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import LinearProgress from '@mui/material/LinearProgress';
import MapView from '../../../common/components/MapView';
import PassengerCancelModal from '../../../common/components/PassengerCancelModal';
import SakayToast from '../../../common/components/SakayToast';
import { getBooking, cancelBooking, updateBookingState } from '../../../services/bookingService';
import type { BookingRecord } from '@sakay/shared';
import {
  formatShortBookingId,
  calculateDistanceKm,
  formatDistance,
  signedStorageUrl,
  SIGNED_URL_TTL,
  TripDetailsPanel,
  buildTripDetails,
  calculateTripProgressPercent,
  fetchServerTripProgress,
  useInFlight,
  extendTapArea,
} from '@sakay/shared';
import { supabase } from '../../../services/supabaseClient';
import { submitIncidentReport } from '../../../services/incidentService';
import { useLanguage } from '../../../utils/LanguageContext';
import { retryDriverSearch } from '../../../services/dispatchService';
import { useArrivalWait } from '../hooks/useArrivalWait';
import ArrivalWaitCard from './ArrivalWaitCard';

const mapBookingStatus = (rawStatus: string): any => {
  if (rawStatus === 'Pending') return 'Searching Driver';
  if (rawStatus === 'Accepted' || rawStatus === 'Driver Assigned') return 'Driver Assigned';
  if (rawStatus === 'In Transit') return 'Driver En Route';
  if (rawStatus === 'Arrived at Pickup' || rawStatus === 'Driver Arrived') return 'Driver Arrived';
  if (rawStatus === 'Trip Ongoing') return 'Trip Ongoing';
  if (rawStatus === 'Arrived at Destination') return 'Arrived at Destination';
  if (rawStatus === 'Completed') return 'Completed';
  if (rawStatus === 'Cancelled') return 'Cancelled';
  if (rawStatus === 'No Driver Found') return 'No Driver Found';
  return rawStatus || 'Searching Driver';
};

const SlideToFinish: React.FC<{ onFinish: () => void; language: string; disabled?: boolean }> = ({
  onFinish,
  language,
  disabled = false,
}) => {
  const [slidePos, setSlidePos] = useState(0);
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleStart = () => {
    if (disabled) return;
    isDragging.current = true;
  };

  // A person who cannot drag (keyboard, switch, screen reader) finishes with Enter or Space on the same control.
  const handleKey = (e: React.KeyboardEvent) => {
    if (disabled || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    onFinish();
  };

  const handleMove = (clientX: number) => {
    if (disabled || !isDragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const maxOffset = rect.width - 52;
    const offset = Math.max(0, Math.min(clientX - rect.left - 24, maxOffset));
    setSlidePos(offset);

    if (offset >= maxOffset * 0.85) {
      isDragging.current = false;
      setSlidePos(maxOffset);
      onFinish();
    }
  };

  const handleEnd = () => {
    if (!isDragging.current) return;
    isDragging.current = false;
    setSlidePos(0);
  };

  return (
    <Box
      ref={containerRef}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={language === 'tl' ? 'I-slide o pindutin ang Enter para tapusin ang biyahe' : 'Slide, or press Enter, to finish the trip'}
      onKeyDown={handleKey}
      onMouseDown={handleStart}
      onMouseMove={(e) => handleMove(e.clientX)}
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
      onTouchStart={handleStart}
      onTouchMove={(e) => handleMove(e.touches[0].clientX)}
      onTouchEnd={handleEnd}
      sx={{
        position: 'relative',
        width: '100%',
        height: '52px',
        backgroundColor: disabled ? '#F1F5F9' : '#FFF7ED',
        border: disabled ? '1.5px solid #CBD5E1' : '1.5px solid #FFD6B3',
        borderRadius: '999px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        cursor: disabled ? 'not-allowed' : 'grab',
        userSelect: 'none',
        touchAction: 'none',
        mt: 1.5,
      }}
    >
      <Typography
        sx={{
          fontSize: '14px',
          fontWeight: 700,
          color: disabled ? '#64748B' : '#C2410C',
          fontFamily: 'Poppins, sans-serif',
          pointerEvents: 'none',
          opacity: disabled ? 1 : Math.max(0.2, 1 - slidePos / 140),
        }}
      >
        {disabled
          ? (language === 'tl' ? 'Naghihintay na simulan ang biyahe...' : 'Waiting for trip to start...')
          : (language === 'tl' ? 'I-slide para Tapusin ang Biyahe >>>' : 'Slide to Finish Trip >>>')}
      </Typography>

      <Box
        sx={{
          position: 'absolute',
          left: 4 + (disabled ? 0 : slidePos),
          width: '44px',
          height: '44px',
          borderRadius: '50%',
          backgroundColor: disabled ? '#94A3B8' : '#FF6B00',
          color: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: disabled ? 'none' : '0 4px 12px rgba(255, 107, 0, 0.4)',
          transition: isDragging.current ? 'none' : 'left 0.25s ease',
        }}
      >
        <CheckCircleIcon sx={{ fontSize: 24 }} />
      </Box>
    </Box>
  );
};

export const TripMonitoring: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { language } = useLanguage();

  const stateBookingId = (location.state as { bookingId?: string })?.bookingId;
  const activeBookingId = stateBookingId || sessionStorage.getItem('current_active_booking_id') || '';

  useEffect(() => {
    if (stateBookingId) {
      sessionStorage.setItem('current_active_booking_id', stateBookingId);
    }
  }, [stateBookingId]);

  // There is no demo trip any more: without a booking to show, go back to the dashboard.
  useEffect(() => {
    if (!activeBookingId) navigate('/dashboard', { replace: true });
  }, [activeBookingId, navigate]);

  const retryFlight = useInFlight();

  const restartDriverSearch = async () => {
    try {
      // A new search round that starts again from the nearest drivers (the same retry the booking screen uses)
      const restarted = await retryDriverSearch(activeBookingId);
      if (!restarted) {
        setToastMessage(
          language === 'tl'
            ? 'Hindi masimulan muli ang paghahanap. Pakisubukang muli.'
            : 'We could not restart the search. Please try again.'
        );
        return;
      }
      setBooking((prev) => prev ? { ...prev, booking_status: 'Searching Driver' as any } : prev);
      setToastMessage(language === 'tl' ? 'Muling naghahanap ng drayber...' : 'Retrying driver search...');
    } catch (err) {
      console.warn('Retry search failed:', err);
    }
  };

  const handleRetrySearch = () => retryFlight.run(restartDriverSearch);

  const [booking, setBooking] = useState<BookingRecord | null>(() => {
    // Until the real booking is loaded from the database this is an EMPTY placeholder (the map starts on the city centre). It
    // used to be a made-up trip with a made-up driver, phone number, plate and fare, which a passenger could see as if it were real.
    return getBooking(activeBookingId) || {
      booking_id: activeBookingId,
      passenger_id: '',
      passenger_name: '',
      passenger_phone: '',
      booking_type: 'Immediate',
      is_shared_trip: false,
      passenger_count: 1,
      pickup_address: '',
      pickup_latitude: 13.4117,
      pickup_longitude: 121.1803,
      dropoff_address: '',
      dropoff_latitude: 13.4117,
      dropoff_longitude: 121.1803,
      estimated_distance_km: 0,
      estimated_fare: 0,
      booking_status: 'Pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });

  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [leaveConfirmModalOpen, setLeaveConfirmModalOpen] = useState(false);
  const [commModalOpen, setCommModalOpen] = useState(false);
  const [selectedSmsTemplate, setSelectedSmsTemplate] = useState<string>('');
  const [customSms, setCustomSms] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Bidirectional Driver Cancelled Alert State
  const [driverCancelledAlertOpen, setDriverCancelledAlertOpen] = useState(false);
  const [driverCancelReason, setDriverCancelReason] = useState<string>('');
  // The booking was cancelled because the passenger did not board in time (Rule 10.4), not because the driver gave it up
  const [noShowCancelled, setNoShowCancelled] = useState(false);
  // Rule 9.2: the database has not heard from the driver for 3 minutes (cleared the moment it does)
  const [driverUnreachable, setDriverUnreachable] = useState(false);
  const [extendingWait, setExtendingWait] = useState(false);

  // Draggable Bottom Sheet State
  const [isExpanded, setIsExpanded] = useState(false);
  const [dragY, setDragY] = useState(0);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const maxProgressRef = useRef(5);
  // Asks the database for the booking's state right now (the poll below, on demand): set by the effect that owns the poll.
  const pollNowRef = useRef<(() => Promise<void>) | null>(null);

  const handleCopyBookingId = () => {
    if (activeBookingId) {
      navigator.clipboard.writeText(activeBookingId);
      setToastMessage(
        language === 'tl'
          ? `Na-copy ang Buong Booking ID: ${activeBookingId}`
          : `Full Booking ID Copied: ${activeBookingId}`
      );
    }
  };

  const handleDragStart = (e: React.PointerEvent | React.TouchEvent) => {
    isDraggingRef.current = true;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.PointerEvent).clientY;
    startYRef.current = clientY;
  };

  const handleDragMove = (e: React.PointerEvent | React.TouchEvent) => {
    if (!isDraggingRef.current) return;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.PointerEvent).clientY;
    const deltaY = clientY - startYRef.current;
    // Strict drag bounds (maxDrag = 180px) so bottom sheet never pulls off-screen
    const clamped = Math.max(-180, Math.min(180, deltaY));
    setDragY(clamped);
  };

  const handleDragEnd = () => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    if (dragY < -40) {
      setIsExpanded(true);
    } else if (dragY > 40) {
      setIsExpanded(false);
    }
    setDragY(0);
  };

  // Workflow Step 12: Trip Completion & Fare Confirmation State
  const [completionFareModalOpen, setCompletionFareModalOpen] = useState(false);
  const [disputeModalOpen, setDisputeModalOpen] = useState(false);
  const [disputedAmount, setDisputedAmount] = useState('');
  const [disputeCategory, setDisputeCategory] = useState('Overcharging Attempt');
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeSubmitted, setDisputeSubmitted] = useState(false);
  const [disputeError, setDisputeError] = useState<string | null>(null);
  const [disputeSending, setDisputeSending] = useState(false);

  // One request at a time: a second tap while the first is being saved must not write again (the database would refuse it and the toast would lie).
  const finishFlight = useInFlight();
  const paidFlight = useInFlight();
  const cancelFlight = useInFlight();

  const markArrivedAtDestination = async () => {
    try {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(activeBookingId)) {
        // The database computes and locks the final fare when the trip first arrives (Rule 6.2); read it back
        // so the figure on screen is the binding one, not the estimate.
        const { data, error } = await supabase
          .from('booking')
          .update({ booking_status: 'Arrived at Destination' })
          .eq('booking_id', activeBookingId)
          .select('actual_fare, actual_distance_km, fare_breakdown')
          .maybeSingle();
        if (error || !data) {
          // The database said no (for example the driver already ended the trip): show what is true, not a completion screen.
          setToastMessage(
            language === 'tl'
              ? 'Hindi naitala ang pagdating. Pakisubukang muli.'
              : 'We could not record the arrival. Please try again.'
          );
          fetchBookingFromDb();
          return;
        }
        setBooking((prev) =>
          prev
            ? {
                ...prev,
                actual_fare: data.actual_fare !== null && data.actual_fare !== undefined ? Number(data.actual_fare) : prev.actual_fare,
                actual_distance_km: data.actual_distance_km ?? prev.actual_distance_km,
                fare_breakdown: data.fare_breakdown ?? prev.fare_breakdown,
              }
            : prev
        );
      }
      localStorage.setItem(`passenger_finished_${activeBookingId}`, 'true');

      const channel = supabase.channel(`booking_sync_${activeBookingId}`);
      await channel.send({
        type: 'broadcast',
        event: 'passenger_finished',
        payload: { bookingId: activeBookingId, passenger_finished: true },
      });
    } catch (err) {
      console.warn('[TripMonitoring] markPassengerFinished error:', err);
    }
    setCompletionFareModalOpen(true);
  };

  const handlePassengerFinishTrip = () => finishFlight.run(markArrivedAtDestination);

  const confirmPassengerPayment = async () => {
    try {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(activeBookingId)) {
        // The passenger confirms payment; the final fare is NOT sent from here (Rule 6.2): the database
        // already computed it when the trip arrived, and rejects any client that tries to write it.
        const { error } = await supabase
          .from('booking')
          .update({ booking_status: 'Completed' })
          .eq('booking_id', activeBookingId);
        if (error) throw error;
      }
      localStorage.setItem(`payment_confirmed_${activeBookingId}`, 'true');
      localStorage.setItem(`passenger_finished_${activeBookingId}`, 'true');

      const channel = supabase.channel(`booking_sync_${activeBookingId}`);
      await channel.send({
        type: 'broadcast',
        event: 'payment_confirmed',
        payload: { bookingId: activeBookingId, payment_confirmed: true },
      });

      updateBookingState(activeBookingId, {
        booking_status: 'Completed',
        actual_fare: booking?.actual_fare ?? undefined,
      });
    } catch (err) {
      console.warn('[TripMonitoring] handlePassengerPaid error:', err);
      setToastMessage(
        language === 'tl'
          ? 'Hindi nakumpirma ang bayad. Pakisubukang muli.'
          : 'We could not confirm the payment. Please try again.'
      );
      return;
    }
    setCompletionFareModalOpen(true);
  };


  const handlePassengerPaid = () => paidFlight.run(confirmPassengerPayment);

  // Driver Location Telemetry
  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number; at?: number }>({
    lat: booking?.driver_latitude || 13.4140,
    lng: booking?.driver_longitude || 121.1845,
  });
  const hasLiveDriverGpsRef = useRef(false);
  // The driver's app repeats its position every couple of seconds, so the SAME place is not a new position: no new state, no redraw. `at` is
  // when the driver's phone sent it, so that a late older fix cannot move the tricycle backward.
  const applyDriverPos = useCallback((lat: number, lng: number, at?: number) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    setDriverPos((prev) => (prev.lat === lat && prev.lng === lng ? prev : { lat, lng, at }));
  }, []);

  // The assigned driver's photo and rating, as the database gives them (a photo only while the trip is live; none is invented)
  const [driverPhotoUrl, setDriverPhotoUrl] = useState<string>('');
  const [driverRating, setDriverRating] = useState<number | null>(null);
  const assignedDriverId = booking?.driver_id;
  useEffect(() => {
    if (!activeBookingId || !assignedDriverId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: path } = await supabase.rpc('get_assigned_driver_photo', { p_booking_id: activeBookingId });
        const url = typeof path === 'string' && path ? await signedStorageUrl(supabase, 'profiles', path, SIGNED_URL_TTL.avatar) : '';
        if (!cancelled) setDriverPhotoUrl(url || '');
      } catch {
        if (!cancelled) setDriverPhotoUrl('');
      }
    })();
    return () => { cancelled = true; };
  }, [activeBookingId, assignedDriverId]);

  // Loads the booking and, once a driver is assigned, the driver's details (name, phone, plate, TODA, rating). It runs when the screen
  // opens AND whenever the assigned driver changes: a driver who accepts AFTER this screen opened used to leave the card on "Driver"
  // with no plate, phone, photo or rating (and the rating step had no driver to rate).
  const loadedDriverIdRef = useRef<string | null>(null);
  const fetchBookingFromDb = useCallback(async () => {
    if (!activeBookingId) return;
      try {
        const { data, error } = await supabase
          .from('booking')
          .select(`
            booking_id,
            passenger_id,
            booking_status,
            pickup_address,
            pickup_latitude,
            pickup_longitude,
            dropoff_address,
            dropoff_latitude,
            dropoff_longitude,
            estimated_fare,
            actual_fare,
            actual_distance_km,
            fare_breakdown,
            fare_locked_at,
            estimated_distance_km,
            is_shared_trip,
            passenger_count,
            driver_id
          `)
          .eq('booking_id', activeBookingId)
          .maybeSingle();

        if (!error && data) {
          const d = data as any;
          // The assigned driver: name, vehicle, TODA and (while the trip is live) position, from a function that answers only for the
          // passenger of this booking.
          let driverInfo: any = null;
          if (d.driver_id) {
            const { data: details } = await supabase.rpc('get_assigned_driver_details', { p_booking_id: activeBookingId });
            driverInfo = Array.isArray(details) ? details[0] : details;
          }
          const todaInfo = driverInfo?.toda_name ? { toda_name: driverInfo.toda_name as string } : null;
          loadedDriverIdRef.current = d.driver_id ?? null;
          const rating = Number(driverInfo?.weighted_average_rating);
          setDriverRating(Number.isFinite(rating) && rating > 0 ? rating : null);

          const mappedStatus = mapBookingStatus(d.booking_status);

          const drvLat = driverInfo?.current_latitude ?? d.driver_latitude;
          const drvLng = driverInfo?.current_longitude ?? d.driver_longitude;
          if (drvLat && drvLng && !hasLiveDriverGpsRef.current) {
            applyDriverPos(Number(drvLat), Number(drvLng));
          }

          setBooking((prev) => {
            const updated: BookingRecord = {
              ...(prev || ({} as any)),
              booking_id: d.booking_id,
              passenger_id: d.passenger_id || prev?.passenger_id || '',
              passenger_name: prev?.passenger_name || '',
              passenger_phone: prev?.passenger_phone || '',
              driver_id: d.driver_id || prev?.driver_id,
              driver_name: driverInfo?.full_name || prev?.driver_name || '',
              driver_phone: driverInfo?.contact_number || prev?.driver_phone || '',
              franchise_no: driverInfo?.franchise_number || prev?.franchise_no || '',
              vehicle_plate: driverInfo?.plate_number || prev?.vehicle_plate || '',
              toda_name: todaInfo?.toda_name || prev?.toda_name || '',
              booking_status: mappedStatus as any,
              pickup_address: d.pickup_address || prev?.pickup_address || '',
              dropoff_address: d.dropoff_address || prev?.dropoff_address || '',
              pickup_latitude: d.pickup_latitude ?? prev?.pickup_latitude ?? 13.4124,
              pickup_longitude: d.pickup_longitude ?? prev?.pickup_longitude ?? 121.1834,
              dropoff_latitude: d.dropoff_latitude ?? prev?.dropoff_latitude ?? 13.4150,
              dropoff_longitude: d.dropoff_longitude ?? prev?.dropoff_longitude ?? 121.1810,
              estimated_fare: Number(d.estimated_fare) || prev?.estimated_fare || 0,
              // null until the trip arrives: the database writes the final fare once (Rule 6.2)
              actual_fare: d.actual_fare !== null && d.actual_fare !== undefined ? Number(d.actual_fare) : prev?.actual_fare ?? null,
              actual_distance_km: d.actual_distance_km ?? prev?.actual_distance_km ?? null,
              fare_breakdown: d.fare_breakdown ?? prev?.fare_breakdown ?? null,
              fare_locked_at: d.fare_locked_at ?? prev?.fare_locked_at ?? null,
              is_shared_trip: Boolean(d.is_shared_trip),
              passenger_count: Number(d.passenger_count) || 1,
              created_at: prev?.created_at || new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            updateBookingState(activeBookingId, updated);
            if (mappedStatus === 'Completed') {
              setCompletionFareModalOpen(true);
            }
            return updated;
          });
        }
      } catch (err) {
        console.warn('[TripMonitoring] fetchBookingFromDb note:', err);
      }
  }, [activeBookingId, applyDriverPos]);

  useEffect(() => {
    fetchBookingFromDb();
  }, [fetchBookingFromDb]);

  // The booking went back to the search because the driver who had accepted gave it up (Rules 12.3 / 12.4) or could not proceed: forget
  // that driver (details, photo, rating, position) and say so. The database is the only source of this: status Pending, no driver.
  const handleBackToSearch = useCallback((row: { booking_status?: string; driver_id?: string | null }) => {
    const searching = row.booking_status === 'Pending' || row.booking_status === 'Searching Driver';
    if (!searching || row.driver_id || !loadedDriverIdRef.current) return;
    loadedDriverIdRef.current = null;
    hasLiveDriverGpsRef.current = false;
    setDriverPhotoUrl('');
    setDriverRating(null);
    setBooking((prev) => (prev ? { ...prev, driver_id: undefined, driver_name: '', driver_phone: '', franchise_no: '', vehicle_plate: '', toda_name: '' } : prev));
    setToastMessage(
      language === 'tl'
        ? 'Hindi nakapagpatuloy ang iyong drayber. Naghahanap kami ng ibang drayber...'
        : 'Your driver was unable to proceed. We are finding you another driver...'
    );
  }, [language]);

  // Listen to Supabase Realtime for updates and broadcast for driver GPS
  useEffect(() => {
    if (!activeBookingId) return;

    // Polling fallback in case Supabase Realtime is not enabled on the dashboard
    const pollOnce = async () => {
      try {
        const { data, error } = await supabase
          .from('booking')
          .select(`
            booking_status,
            actual_fare,
            fare_breakdown,
            fare_locked_at,
            created_at,
            driver_id,
            cancelled_by,
            cancellation_reason,
            driver_unreachable_since
          `)
          .eq('booking_id', activeBookingId)
          .maybeSingle();

        if (!error && data) {
          const d = data as any;
          setDriverUnreachable(Boolean(d.driver_unreachable_since) && d.booking_status !== 'Cancelled' && d.booking_status !== 'Completed');
          if (d.booking_status === 'Cancelled' && d.cancelled_by && d.cancelled_by !== 'passenger') {
            const noShow = d.cancellation_reason === 'PASSENGER_NO_SHOW';
            setNoShowCancelled(noShow);
            setDriverCancelReason(noShow ? '' : d.cancellation_reason || (language === 'tl' ? 'Kinansela ang booking ng sistema' : 'The booking was cancelled by the system'));
            setDriverCancelledAlertOpen(true);
          }
          handleBackToSearch(d);
          // A driver accepted (or the driver changed): load who it is
          if (d.driver_id && d.driver_id !== loadedDriverIdRef.current) {
            loadedDriverIdRef.current = d.driver_id;
            fetchBookingFromDb();
          }

          // The driver's position comes from get_assigned_driver_details, which shares it only while the trip is live.
          let drv: any = null;
          if (d.driver_id && !hasLiveDriverGpsRef.current) {
            const { data: details } = await supabase.rpc('get_assigned_driver_details', { p_booking_id: activeBookingId });
            drv = Array.isArray(details) ? details[0] : details;
          }
          if (drv?.current_latitude && drv?.current_longitude && !hasLiveDriverGpsRef.current) {
            applyDriverPos(Number(drv.current_latitude), Number(drv.current_longitude));
          }

          setBooking((prev) => {
            if (prev?.booking_status === d.booking_status) return prev; // No change
            
            const mappedStatus = mapBookingStatus(d.booking_status);

            const merged: BookingRecord = {
              ...(prev || ({} as any)),
              booking_status: mappedStatus as any,
              actual_fare: d.actual_fare !== null && d.actual_fare !== undefined ? Number(d.actual_fare) : prev?.actual_fare,
              fare_breakdown: d.fare_breakdown ?? prev?.fare_breakdown,
              fare_locked_at: d.fare_locked_at ?? prev?.fare_locked_at,
              updated_at: new Date().toISOString(),
            };
            updateBookingState(activeBookingId, merged);

            if (mappedStatus === 'Completed') {
              setCompletionFareModalOpen(true);
            }
            return merged;
          });
        }
      } catch (err) {
        // ignore polling errors
      }
    };
    pollNowRef.current = pollOnce;
    const pollInterval = setInterval(pollOnce, 2500);

    const channel = supabase
      .channel(`passenger_trip_${activeBookingId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'booking',
          filter: `booking_id=eq.${activeBookingId}`,
        },
        (payload: any) => {
          const row = payload.new;
          if (row && row.booking_id === activeBookingId) {
            if (row.driver_id && row.driver_id !== loadedDriverIdRef.current) {
              loadedDriverIdRef.current = row.driver_id;
              fetchBookingFromDb();
            }
            if (row.booking_status === 'Cancelled' && row.cancelled_by && row.cancelled_by !== 'passenger') {
              const noShow = row.cancellation_reason === 'PASSENGER_NO_SHOW';
              setNoShowCancelled(noShow);
              setDriverCancelReason(noShow ? '' : row.cancellation_reason || (language === 'tl' ? 'Kinansela ang booking ng sistema' : 'The booking was cancelled by the system'));
              setDriverCancelledAlertOpen(true);
            }
            handleBackToSearch(row);

            if (row.driver_latitude && row.driver_longitude && !hasLiveDriverGpsRef.current) {
              applyDriverPos(Number(row.driver_latitude), Number(row.driver_longitude));
            }

            setBooking((prev) => {
              const mappedStatus = mapBookingStatus(row.booking_status);

              const merged: BookingRecord = {
                ...(prev || ({} as any)),
                booking_status: mappedStatus as any,
                actual_fare: row.actual_fare !== null && row.actual_fare !== undefined ? Number(row.actual_fare) : prev?.actual_fare,
                actual_distance_km: row.actual_distance_km ?? prev?.actual_distance_km,
                fare_breakdown: row.fare_breakdown ?? prev?.fare_breakdown,
                fare_locked_at: row.fare_locked_at ?? prev?.fare_locked_at,
                updated_at: row.updated_at || new Date().toISOString(),
              };
              updateBookingState(activeBookingId, merged);

              if (mappedStatus === 'Completed') {
                setCompletionFareModalOpen(true);
              }
              return merged;
            });
          }
        }
      )
      .on('broadcast', { event: 'driver_location' }, (payload: any) => {
        if (payload.payload?.lat && payload.payload?.lng) {
          hasLiveDriverGpsRef.current = true;
          const sentAt = Number(payload.payload.at);
          applyDriverPos(Number(payload.payload.lat), Number(payload.payload.lng), Number.isFinite(sentAt) ? sentAt : undefined);
        }
      })
      .subscribe();

    return () => {
      clearInterval(pollInterval);
      pollNowRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [activeBookingId, language, fetchBookingFromDb, handleBackToSearch, applyDriverPos]);

  const status = booking?.booking_status || 'Searching Driver';
  const isTripActive = status !== 'Completed' && status !== 'Cancelled';

  // Rule 10.3: once the driver is at the pickup the database counts the time the passenger has to board; "I'm Almost There" adds two minutes, once.
  const { wait: arrivalWait, extend: extendArrivalWait } = useArrivalWait(activeBookingId, status === 'Driver Arrived', () => {
    pollNowRef.current?.();
    fetchBookingFromDb();
  });

  // The trip's progress as the database holds it: the figure the driver's Finish is checked against. Read while the passenger is on board.
  // The screen's own estimate from the driver's position is used until the first answer, and wherever the database cannot answer.
  const [serverProgress, setServerProgress] = useState<number | null>(null);
  useEffect(() => {
    if (status !== 'Trip Ongoing' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(activeBookingId)) return;
    let stopped = false;
    const read = async () => {
      const answer = await fetchServerTripProgress(supabase, activeBookingId);
      if (!stopped && answer && answer.progressPercent !== null) setServerProgress(answer.progressPercent);
    };
    read();
    const timer = setInterval(read, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [status, activeBookingId]);
  const handleExtendWait = async () => {
    setExtendingWait(true);
    const problem = await extendArrivalWait();
    setExtendingWait(false);
    if (problem) setToastMessage(problem.replace(/^ERR_[A-Z_]+:\s*/, ''));
  };

  const handleBackRequest = () => {
    if (isTripActive) {
      setLeaveConfirmModalOpen(true);
    } else {
      navigate('/dashboard');
    }
  };

  const cancelPassengerBooking = async (reasonText?: string) => {
    const finalReason = reasonText || (language === 'tl' ? 'Kinansela ng pasahero bago ang pickup' : 'Passenger cancelled before pickup');
    const cancelled = await cancelBooking(activeBookingId, finalReason);
    setCancelModalOpen(false);
    if (!cancelled) {
      // Still open in the database: do not pretend it is cancelled (the passenger could not book again)
      setToastMessage(
        language === 'tl'
          ? 'Hindi makansela ang booking. Pakisubukang muli.'
          : 'The booking could not be cancelled. Please try again.'
      );
      return;
    }
    sessionStorage.removeItem('current_active_booking_id');
    navigate('/dashboard');
  };

  const handleCancelTrip = (reasonText?: string) => cancelFlight.run(() => cancelPassengerBooking(reasonText));

  const handleOpenCommModal = () => {
    setSelectedSmsTemplate('');
    setCustomSms('');
    setCommModalOpen(true);
  };

  const handleSendSmsClick = () => {
    const finalMsg = selectedSmsTemplate === 'custom' ? customSms.trim() : selectedSmsTemplate;
    if (!finalMsg) return;

    const cleanPhone = driverPhone.replace(/[^\d+]/g, '');
    const smsUrl = `sms:${cleanPhone}?body=${encodeURIComponent(finalMsg)}`;

    try {
      window.location.href = smsUrl;
    } catch (err) {
      console.warn('[TripMonitoring] SMS launch error:', err);
    }

    setToastMessage(
      language === 'tl'
        ? `Binubuksan ang SMS app para magpadala ng mensahe...`
        : `Opening SMS app to send message...`
    );

    setCommModalOpen(false);
    setSelectedSmsTemplate('');
    setCustomSms('');
  };

  // Shown exactly as the database says. When something is not known yet it is left blank or "-", never replaced by an invented driver.
  const driverName = booking?.driver_name || (language === 'tl' ? 'Drayber' : 'Driver');
  const driverPhone = booking?.driver_phone || '';
  const franchiseNo = booking?.franchise_no || '-';
  const plateNo = booking?.vehicle_plate || '-';
  const todaName = booking?.toda_name || '-';
  // The final fare is the one the database wrote when the trip arrived; until then it is the estimate (Rule 6.2).
  const passengerPayableFare = booking?.actual_fare ?? booking?.estimated_fare ?? 0;
  const fareOrdinance = booking?.fare_breakdown?.rule.ordinance_reference ?? null;
  const fareBasis = booking?.fare_breakdown?.final?.basis ?? null;

  const isPreTrip =
    status === 'Searching Driver' ||
    status === 'Driver Assigned' ||
    status === 'Driver En Route' ||
    status === 'Driver Arrived';

  const pickupLat = booking?.pickup_latitude || 13.4124;
  const pickupLng = booking?.pickup_longitude || 121.1834;
  const dropoffLat = booking?.dropoff_latitude || 13.4150;
  const dropoffLng = booking?.dropoff_longitude || 121.1810;

  const totalTripKm = calculateDistanceKm(pickupLat, pickupLng, dropoffLat, dropoffLng);
  const driverToPickupKm = calculateDistanceKm(driverPos.lat, driverPos.lng, pickupLat, pickupLng);
  const driverToDropoffKm = calculateDistanceKm(driverPos.lat, driverPos.lng, dropoffLat, dropoffLng);

  let tripProgress = 0;
  if (status === 'Trip Ongoing') {
    // One formula for both screens and the database (@sakay/shared tripProgress); the best the trip has reached is kept, and so is the database's
    const here = calculateTripProgressPercent({
      totalKm: totalTripKm,
      driverToDestinationKm: driverToDropoffKm,
      previousPercent: Math.max(maxProgressRef.current, serverProgress ?? 0),
    });
    maxProgressRef.current = here;
    tripProgress = here;
  } else if (status === 'Arrived at Destination' || status === 'Completed') {
    tripProgress = 100;
  }

  // What the Trip Details panel shows (the same facts the driver's panel shows for this trip)
  const tripDetails = buildTripDetails({
    role: 'passenger',
    status,
    pickupAddress: booking?.pickup_address,
    dropoffAddress: booking?.dropoff_address,
    isSharedTrip: booking?.is_shared_trip,
    passengerCount: booking?.passenger_count,
    estimatedFare: booking?.estimated_fare,
    actualFare: booking?.actual_fare,
    fareLockedAt: booking?.fare_locked_at,
    fareBasis,
    counterpartName: booking?.driver_name,
    counterpartRating: driverRating,
  });

  return (
    <Box sx={{ width: '100%', height: '100%', backgroundColor: '#F8FAFC', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
      {/* 1. Header Bar matching Settings PageHeader */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justify: 'space-between',
          width: '100%',
          pt: 'calc(var(--safe-area-top) + 12px)',
          pb: 1.5,
          px: 2,
          backgroundColor: '#FFFFFF',
          borderBottom: '1px solid #F1F5F9',
          flexShrink: 0,
          zIndex: 20,
        }}
      >
        {!isTripActive ? (
          <IconButton
            onClick={handleBackRequest}
            aria-label="Go back"
            sx={{
              backgroundColor: '#FFFFFF',
              border: '1px solid #E2E8F0',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
              color: '#1A1A1A',
              borderRadius: '14px',
              width: '44px',
              height: '44px',
              '&:hover': { backgroundColor: '#F8FAFC' },
            }}
          >
            <ArrowBackIcon sx={{ fontSize: 20 }} />
          </IconButton>
        ) : (
          <Box sx={{ width: '44px' }} />
        )}

        <Box sx={{ textAlign: 'center', flex: 1 }}>
          <Typography
            sx={{
              fontSize: '16px',
              fontWeight: 700,
              color: '#0F172A',
              fontFamily: 'Poppins, sans-serif',
            }}
          >
            {language === 'tl' ? 'Pagsubaybay sa Biyahe' : 'Trip Monitoring'}
          </Typography>
          <Typography
            sx={{
              fontSize: '12px',
              color: '#64748B',
              fontFamily: 'Poppins, sans-serif',
            }}
          >
            Booking: <strong onClick={handleCopyBookingId} style={{ cursor: 'pointer' }} title="Click to copy full Booking ID">{formatShortBookingId(activeBookingId)}</strong>
          </Typography>
        </Box>

        <Box sx={{ width: '44px' }} />

      </Box>

      {/* 2. Full Surface Map View */}
      <Box
        sx={{
          flex: 1,
          position: 'relative',
          backgroundColor: '#E3ECEF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          width: '100%',
        }}
      >
        <MapView
          pickupLocation={{
            lat: pickupLat,
            lng: pickupLng,
          }}
          dropoffLocation={
            isPreTrip
              ? undefined
              : {
                  lat: dropoffLat,
                  lng: dropoffLng,
                }
          }
          driverLocation={status !== 'Searching Driver' ? driverPos : null}
        />

        {/* Status Pill Badge */}
        <Chip
          label={
            status === 'Searching Driver'
              ? (language === 'tl' ? 'Naghahanap ng pinakamalapit na Tricycle...' : 'Finding nearest tricycle...')
              : status === 'No Driver Found'
              ? (language === 'tl' ? 'Walang nahanap na drayber sa ngayon' : 'No driver available right now')
              : status === 'Driver Assigned' || status === 'Driver En Route'
              ? (language === 'tl'
                  ? `Papunta na ang Driver • ${formatDistance(driverToPickupKm)} (~${Math.max(1, Math.round(driverToPickupKm * 3))} min)`
                  : `Driver en route • ${formatDistance(driverToPickupKm)} (~${Math.max(1, Math.round(driverToPickupKm * 3))} min)`)
              : status === 'Driver Arrived'
              ? (language === 'tl' ? 'Nandito na ang Tricycle sa Pickup Point!' : 'Tricycle has arrived at the pickup point!')
              : status === 'Trip Ongoing'
              ? (language === 'tl' ? 'Bumibiyahe sa Destinasyon' : 'Traveling to destination')
              : (language === 'tl' ? 'Nakumpleto na ang Biyahe!' : 'Trip Completed!')
          }
          sx={{
            position: 'absolute',
            top: 16,
            backgroundColor:
              status === 'Searching Driver'
                ? '#B45309'
                : status === 'No Driver Found'
                ? '#DC2626'
                : status === 'Driver Arrived'
                ? '#1E8E3E'
                : '#0F172A',
            color: '#FFFFFF',
            fontWeight: 700,
            fontSize: '13px',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
            zIndex: 10,
          }}
        />

        {/* Pulsing Radar Ring for Searching Stage */}
        {status === 'Searching Driver' && (
          <Box
            sx={{
              position: 'absolute',
              width: 180,
              height: 180,
              borderRadius: '50%',
              border: '2px solid rgba(255, 107, 0, 0.5)',
              zIndex: 5,
              pointerEvents: 'none',
              animation: 'pulse 2s infinite ease-out',
              '@keyframes pulse': {
                '0%': { transform: 'scale(0.8)', opacity: 1 },
                '100%': { transform: 'scale(1.6)', opacity: 0 },
              },
            }}
          />
        )}

      </Box>

      {/* 3. Driver & Trip Details (draggable bottom sheet): the content scrolls, the action stays pinned at the bottom */}
      <Paper
        elevation={8}
        sx={{
          backgroundColor: '#FFFFFF',
          borderRadius: '24px 24px 0 0',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 20,
          width: '100%',
          maxHeight: isExpanded ? '85vh' : '52vh',
          transform: dragY !== 0 ? `translateY(${dragY}px)` : 'none',
          transition: isDraggingRef.current ? 'none' : 'max-height 0.35s cubic-bezier(0.2, 0.8, 0.2, 1), transform 0.2s ease',
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          boxShadow: '0 -8px 24px rgba(0, 0, 0, 0.08)',
          overflow: 'hidden',
        }}
      >
        {/* The handle: tap it, or drag it, to give the sheet more or less room */}
        <ButtonBase
          onClick={() => setIsExpanded((open) => !open)}
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onTouchStart={handleDragStart}
          onTouchMove={handleDragMove}
          onTouchEnd={handleDragEnd}
          aria-expanded={isExpanded}
          aria-label={
            isExpanded
              ? (language === 'tl' ? 'Paliitin ang panel ng biyahe' : 'Make the trip panel smaller')
              : (language === 'tl' ? 'Palakihin ang panel ng biyahe' : 'Make the trip panel bigger')
          }
          sx={{ width: '100%', minHeight: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none', cursor: 'grab' }}
        >
          <Box sx={{ width: 40, height: 5, borderRadius: 3, backgroundColor: '#CBD5E1' }} />
        </ButtonBase>

        <Box className="hide-scrollbar" sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: '20px', pb: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {driverUnreachable && (
            <Alert severity="warning" sx={{ borderRadius: '14px', fontSize: '13px', fontWeight: 600 }}>
              {language === 'tl'
                ? 'Mukhang may problema sa koneksyon ang iyong drayber. Patuloy kaming susubok na makontak siya.'
                : "Your driver appears to be experiencing a connectivity issue. We'll keep trying to reach them."}
            </Alert>
          )}

          {status === 'Driver Arrived' && arrivalWait && (
            <ArrivalWaitCard wait={arrivalWait} language={language} onExtend={handleExtendWait} extending={extendingWait} />
          )}

          {status === 'No Driver Found' ? (
            <Box role="alert" sx={{ p: 2, backgroundColor: '#FEF2F2', borderRadius: '16px', border: '1.5px solid #FCA5A5', textAlign: 'center' }}>
              <Typography sx={{ fontWeight: 700, fontSize: '16px', color: '#991B1B' }}>
                {language === 'tl' ? 'Walang available na drayber sa ngayon' : 'No driver available right now'}
              </Typography>
              <Typography sx={{ fontSize: '13px', color: '#7F1D1D', mt: 0.5, lineHeight: 1.5 }}>
                {language === 'tl'
                  ? 'Maaaring offline o may biyahe ang mga drayber sa iyong lugar. Subukang mag-search muli.'
                  : 'Nearby drivers may be offline or on trips. You can retry searching.'}
              </Typography>
            </Box>
          ) : (
            /* Driver identity */
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                <Avatar src={status !== 'Searching Driver' && driverPhotoUrl ? driverPhotoUrl : undefined} alt={driverName} sx={{ width: 48, height: 48, flexShrink: 0, backgroundColor: '#FF6B00', fontWeight: 700, fontSize: '20px' }}>
                  {driverName.charAt(0)}
                </Avatar>
                <Box sx={{ minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: '16px', fontWeight: 700, color: '#0F172A' }}>
                    {status === 'Searching Driver' ? (language === 'tl' ? 'Naghahanap ng Drayber...' : 'Looking for Driver...') : driverName}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                    {driverRating !== null && (
                      <>
                        <StarIcon aria-hidden sx={{ fontSize: 14, color: '#F59E0B' }} />
                        <Typography sx={{ fontSize: '12px', fontWeight: 700, color: '#0F172A' }}>{driverRating.toFixed(1)}</Typography>
                      </>
                    )}
                    {todaName !== '-' && (
                      <Typography noWrap sx={{ fontSize: '12px', color: '#475569' }}>
                        {driverRating !== null ? '• ' : ''}{todaName}
                      </Typography>
                    )}
                  </Box>
                </Box>
              </Box>

              {/* Call and message (once a driver is assigned) */}
              {status !== 'Searching Driver' && (
                <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                  <IconButton
                    aria-label={language === 'tl' ? 'Tawagan ang drayber' : 'Call driver'}
                    disabled={!driverPhone}
                    onClick={() => (window.location.href = `tel:${driverPhone}`)}
                    sx={{ width: 44, height: 44, backgroundColor: '#E6F4EA', color: '#166534', '&:hover': { backgroundColor: '#D1EBD7' } }}
                  >
                    <PhoneIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    aria-label={language === 'tl' ? 'Magpadala ng mensahe sa drayber' : 'Message driver'}
                    onClick={handleOpenCommModal}
                    sx={{ width: 44, height: 44, backgroundColor: '#FFF1E6', color: '#C2410C', '&:hover': { backgroundColor: '#FFE6D2' } }}
                  >
                    <MessageIcon fontSize="small" />
                  </IconButton>
                </Box>
              )}
            </Box>
          )}

          {/* Trip details: collapsed by default, one tap away at every stage */}
          <TripDetailsPanel view={tripDetails} language={language} />

          {/* Live trip progress (the passenger is on board) */}
          {status === 'Trip Ongoing' && (
            <Box sx={{ p: '12px 16px', borderRadius: '14px', backgroundColor: '#F8FAFC', border: '1.5px solid #E2E8F0' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75 }}>
                <Typography sx={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>
                  {language === 'tl' ? 'Progreso ng biyahe' : 'Trip progress'}
                </Typography>
                <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#0F172A' }}>{tripProgress}%</Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={tripProgress}
                aria-label={language === 'tl' ? 'Progreso ng biyahe' : 'Trip progress'}
                sx={{ height: 8, borderRadius: 4, backgroundColor: '#E2E8F0', '& .MuiLinearProgress-bar': { backgroundColor: '#FF6B00', borderRadius: 4 } }}
              />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.75 }}>
                <Typography sx={{ fontSize: '12px', color: '#475569' }}>
                  {language === 'tl' ? 'Natitira:' : 'Remaining:'} <strong>{formatDistance(driverToDropoffKm)}</strong>
                </Typography>
                <Typography sx={{ fontSize: '12px', color: '#475569' }}>
                  ETA: <strong>~{Math.max(1, Math.round(driverToDropoffKm * 3))} min</strong>
                </Typography>
              </Box>
            </Box>
          )}

          {/* Tricycle: the franchise body number and plate, to recognise it at the pickup */}
          {status !== 'Searching Driver' && status !== 'No Driver Found' && (franchiseNo !== '-' || plateNo !== '-') && (
            <Box sx={{ p: '12px 16px', borderRadius: '12px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: '12px', color: '#475569', fontWeight: 600 }}>
                  {language === 'tl' ? 'Franchise body no.' : 'Franchise body no.'}
                </Typography>
                <Typography sx={{ fontSize: '15px', fontWeight: 700, color: '#0F172A', overflowWrap: 'anywhere' }}>{franchiseNo}</Typography>
              </Box>
              <Box sx={{ textAlign: 'right', minWidth: 0 }}>
                <Typography sx={{ fontSize: '12px', color: '#475569', fontWeight: 600 }}>{language === 'tl' ? 'Plaka' : 'Plate number'}</Typography>
                <Typography sx={{ fontSize: '15px', fontWeight: 700, color: '#0F172A', overflowWrap: 'anywhere' }}>{plateNo}</Typography>
              </Box>
            </Box>
          )}
        </Box>

        {/* The action for this stage, always in reach */}
        {status !== 'Completed' && status !== 'Cancelled' && (
          <Box sx={{ flexShrink: 0, px: '20px', pt: 1.25, pb: 'calc(var(--safe-area-bottom) + 16px)', borderTop: '1px solid #F1F5F9', backgroundColor: '#FFFFFF' }}>
            {status === 'No Driver Found' ? (
              <Box sx={{ display: 'flex', gap: 1.5 }}>
                <Button
                  variant="outlined"
                  fullWidth
                  onClick={() => {
                    sessionStorage.removeItem('current_active_booking_id');
                    navigate('/dashboard');
                  }}
                  sx={{ minHeight: 52, borderRadius: '16px', textTransform: 'none', fontWeight: 600, fontSize: '15px', color: '#334155', borderColor: '#CBD5E1' }}
                >
                  {language === 'tl' ? 'Bumalik sa Home' : 'Back to Home'}
                </Button>
                <Button
                  variant="contained"
                  fullWidth
                  onClick={handleRetrySearch}
                  disabled={retryFlight.busy}
                  sx={{ minHeight: 52, borderRadius: '16px', '&.Mui-disabled': { backgroundColor: '#FF6B00', color: '#FFFFFF', opacity: 0.75 }, backgroundColor: '#FF6B00', textTransform: 'none', fontWeight: 700, fontSize: '15px', boxShadow: 'none', '&:hover': { backgroundColor: '#E55F00', boxShadow: 'none' } }}
                >
                  {language === 'tl' ? 'Subukan Muli' : 'Retry Search'}
                </Button>
              </Box>
            ) : status === 'Arrived at Destination' ? (
              <Button
                variant="contained"
                fullWidth
                onClick={handlePassengerPaid}
                disabled={paidFlight.busy}
                sx={{
                  minHeight: 52,
                  borderRadius: '16px',
                  '&.Mui-disabled': { backgroundColor: '#15803D', color: '#FFFFFF', opacity: 0.75 },
                  backgroundColor: '#15803D',
                  fontWeight: 700,
                  fontSize: '16px',
                  textTransform: 'none',
                  boxShadow: 'none',
                  '&:hover': { backgroundColor: '#166534', boxShadow: 'none' },
                }}
              >
                {paidFlight.busy
                  ? (language === 'tl' ? 'Kinukumpirma...' : 'Confirming...')
                  : (language === 'tl' ? 'Nabayaran Ko Na (I Paid)' : 'I Paid')}
              </Button>
            ) : status === 'Trip Ongoing' ? (
              /* A trip in progress cannot be cancelled (it ends instead, Rule 13) */
              <SlideToFinish onFinish={handlePassengerFinishTrip} language={language} disabled={finishFlight.busy} />
            ) : (
              /* Before the trip starts the passenger may still cancel: a plain, quiet button that opens the same confirmation (reason and confirm) */
              <Button
                variant="outlined"
                fullWidth
                onClick={() => setCancelModalOpen(true)}
                sx={{ minHeight: 52, borderRadius: '16px', textTransform: 'none', fontWeight: 700, fontSize: '15px', color: '#B91C1C', borderColor: '#FCA5A5', '&:hover': { backgroundColor: '#FEF2F2', borderColor: '#F87171' } }}
              >
                {language === 'tl' ? 'Ikansel ang Booking' : 'Cancel Booking'}
              </Button>
            )}
          </Box>
        )}
      </Paper>

      {/* 4. Cancellation Confirmation Modal */}
      <PassengerCancelModal
        open={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        onConfirmCancel={handleCancelTrip}
        language={language}
        loading={cancelFlight.busy}
      />

      {/* 5. Passenger SMS Communication Modal */}
      <Dialog
        open={commModalOpen}
        onClose={() => setCommModalOpen(false)}
        fullWidth
        maxWidth="xs"
        slotProps={{ paper: { sx: { borderRadius: '24px', p: 1 } } }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
          <Typography sx={{ fontSize: '17px', fontWeight: 700 }}>
            {language === 'tl' ? `Mensahe kay Driver ${driverName.split(' ')[0]}` : `Message Driver ${driverName.split(' ')[0]}`}
          </Typography>
          <IconButton aria-label={language === "tl" ? "Isara" : "Close"} onClick={() => setCommModalOpen(false)} size="small" sx={extendTapArea(7)}><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}>
          <Typography sx={{ fontSize: '12px', fontWeight: 700, color: '#64748B' }}>
            {language === 'tl' ? 'Pumili ng mensahe' : 'Select a message'}
          </Typography>

          <FormControl component="fieldset">
            <RadioGroup
              value={selectedSmsTemplate}
              onChange={(e) => setSelectedSmsTemplate(e.target.value)}
            >
              {(language === 'tl'
                ? [
                    'Nandito na po ako sa labas.',
                    'Nasa tapat po ako ng gate.',
                    'Pakibilisan po ng konti. Salamat!',
                  ]
                : [
                    "I'm waiting outside.",
                    "I'm in front of the gate.",
                    "Please hurry if possible. Thank you!",
                  ]
              ).map((tpl, i) => (
                <FormControlLabel
                  key={i}
                  value={tpl}
                  control={<Radio size="small" sx={{ color: '#FF6B00', '&.Mui-checked': { color: '#FF6B00' } }} />}
                  label={<Typography sx={{ fontSize: '13px', fontWeight: 500, fontFamily: 'Poppins, sans-serif' }}>{tpl}</Typography>}
                  sx={{ py: 0.5 }}
                />
              ))}
              <FormControlLabel
                value="custom"
                control={<Radio size="small" sx={{ color: '#FF6B00', '&.Mui-checked': { color: '#FF6B00' } }} />}
                label={
                  <Typography sx={{ fontSize: '13px', fontWeight: 500, fontFamily: 'Poppins, sans-serif' }}>
                    {language === 'tl' ? 'Iba pang mensahe...' : 'Custom message'}
                  </Typography>
                }
                sx={{ py: 0.5 }}
              />
            </RadioGroup>
          </FormControl>

          {selectedSmsTemplate === 'custom' && (
            <TextField
              fullWidth
              multiline
              rows={2}
              size="small"
              placeholder={language === 'tl' ? "I-type ang mensahe dito..." : "Type custom message here..."}
              value={customSms}
              onChange={(e) => setCustomSms(e.target.value)}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: '12px' }, mt: 0.5 }}
            />
          )}

          <Button
            variant="contained"
            fullWidth
            onClick={handleSendSmsClick}
            disabled={!selectedSmsTemplate || (selectedSmsTemplate === 'custom' && !customSms.trim())}
            startIcon={<SendIcon />}
            sx={{
              mt: 1,
              height: '46px',
              borderRadius: '12px',
              backgroundColor: '#FF6B00',
              fontWeight: 700,
              fontSize: '14px',
              textTransform: 'none',
              fontFamily: 'Poppins, sans-serif',
              '&:hover': { backgroundColor: '#E05000' },
              '&.Mui-disabled': { backgroundColor: '#CBD5E1', color: '#64748B' },
            }}
          >
            {language === 'tl' ? 'Ipadala ang Mensahe' : 'Send Message'}
          </Button>
        </DialogContent>
      </Dialog>

      {/* 6. Active Trip Exit Guard Modal */}
      <Dialog
        open={leaveConfirmModalOpen}
        onClose={() => setLeaveConfirmModalOpen(false)}
        fullWidth
        maxWidth="xs"
        slotProps={{ paper: { sx: { borderRadius: '24px', p: 1 } } }}
      >
        <DialogTitle sx={{ fontWeight: 700, fontSize: '17px', color: '#0F172A' }}>
          {language === 'tl' ? 'Kasalukuyang Aktibo ang Biyahe' : 'Trip Is Currently Active'}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '13px', color: '#64748B', lineHeight: 1.5 }}>
            {language === 'tl'
              ? 'Mayroon kang tumatakbong biyahe. Nais mo bang pumunta sa Dashboard? Mananatiling aktibo ang iyong booking at maaari kang bumalik sa tracking anumang oras.'
              : 'You have an ongoing trip. Do you want to return to the Dashboard? Your booking will remain active and you can return to tracking anytime.'}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Button
            variant="contained"
            fullWidth
            onClick={() => setLeaveConfirmModalOpen(false)}
            sx={{ borderRadius: '12px', backgroundColor: '#FF6B00', fontWeight: 700, height: '44px', textTransform: 'none', '&:hover': { backgroundColor: '#E05000' } }}
          >
            {language === 'tl' ? 'Manatili sa Tracking' : 'Stay on Tracking'}
          </Button>
          <Button
            variant="text"
            fullWidth
            onClick={() => {
              setLeaveConfirmModalOpen(false);
              navigate('/dashboard');
            }}
            sx={{ color: '#64748B', fontWeight: 600, textTransform: 'none' }}
          >
            {language === 'tl' ? 'Pumunta sa Dashboard' : 'Go to Dashboard'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 7. Arrived at Destination! Modal with Expanded Padding, Spacing, and Centered Tariff */}
      <Dialog
        open={completionFareModalOpen}
        fullWidth
        maxWidth="xs"
        slotProps={{ paper: { sx: { borderRadius: '28px', p: 3, textAlign: 'center' } } }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1.5, mt: 0.5 }}>
          <CheckCircleIcon sx={{ fontSize: 60, color: '#10B981' }} />
        </Box>
        <Typography sx={{ fontSize: '20px', fontWeight: 700, color: '#0F172A', mb: 0.75 }}>
          {language === 'tl' ? 'Nakarating na sa Destinasyon!' : 'Arrived at Destination!'}
        </Typography>
        <Typography sx={{ fontSize: '14px', color: '#64748B', mb: 2.5, px: 1 }}>
          {language === 'tl'
            ? 'Pakisuri ang siningil na pamasahe ng drayber bago magpatuloy.'
            : 'Please verify the fare charged by the driver before proceeding.'}
        </Typography>

        <Paper elevation={0} sx={{ p: 2.5, borderRadius: '20px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', mb: 3, textAlign: 'center' }}>
          <Typography sx={{ fontSize: '12px', fontWeight: 700, color: '#64748B', textAlign: 'center', display: 'block' }}>
            {language === 'tl' ? 'Opisyal na pamasahe' : 'Official tariff fare'}
          </Typography>
          <Typography sx={{ fontSize: '34px', fontWeight: 700, color: '#C2410C', my: 1, textAlign: 'center' }}>
            ₱{passengerPayableFare.toFixed(2)}
          </Typography>
          <Typography sx={{ fontSize: '12px', color: '#64748B', textAlign: 'center', display: 'block' }}>
            {fareOrdinance
              ? (language === 'tl' ? `Batay sa ${fareOrdinance}` : `Based on ${fareOrdinance}`)
              : (language === 'tl' ? 'Batay sa opisyal na taripa ng Lungsod ng Calapan' : 'Based on the official Calapan City tariff')}
          </Typography>
        </Paper>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Button
            variant="contained"
            fullWidth
            onClick={() => {
              setCompletionFareModalOpen(false);
              sessionStorage.removeItem('current_active_booking_id');
              sessionStorage.removeItem('trip_dropoff');
              sessionStorage.removeItem('trip_pickup');
              sessionStorage.removeItem('trip_notes');
              updateBookingState(activeBookingId, {
                booking_status: 'Completed',
                actual_fare: passengerPayableFare,
              });
              navigate('/feedback', {
                replace: true,
                state: {
                  booking: {
                    ...booking,
                    booking_status: 'Completed',
                    actual_fare: passengerPayableFare,
                  },
                },
              });
            }}
            sx={{
              height: '52px',
              borderRadius: '16px',
              backgroundColor: '#15803D',
              fontWeight: 700,
              fontSize: '15px',
              textTransform: 'none',
              boxShadow: '0 4px 14px rgba(21, 128, 61, 0.3)',
              '&:hover': { backgroundColor: '#166534' },
            }}
          >
            {language === 'tl'
              ? `Nagbayad ako ng ₱${passengerPayableFare.toFixed(2)} (Tama ang Bayad)`
              : `I paid ₱${passengerPayableFare.toFixed(2)} (Fare Verified)`}
          </Button>

          <Button
            variant="outlined"
            fullWidth
            color="error"
            onClick={() => {
              setCompletionFareModalOpen(false);
              setDisputeModalOpen(true);
            }}
            startIcon={<ReportProblemIcon />}
            sx={{
              height: '46px',
              borderRadius: '16px',
              fontWeight: 700,
              fontSize: '14px',
              textTransform: 'none',
              borderColor: '#FCA5A5',
              color: '#EF4444',
            }}
          >
            {language === 'tl' ? "Amount Doesn't Match (May Aberya)" : "Amount Doesn't Match (Dispute Fare)"}
          </Button>
        </Box>
      </Dialog>

      {/* 8. LGU Fare Dispute & Incident Form Dialog */}
      <Dialog
        open={disputeModalOpen}
        onClose={() => setDisputeModalOpen(false)}
        fullWidth
        maxWidth="xs"
        slotProps={{ paper: { sx: { borderRadius: '24px', p: 1.5 } } }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
          <ReportProblemIcon sx={{ color: '#EF4444' }} />
          <Typography sx={{ fontSize: '17px', fontWeight: 700, color: '#0F172A' }}>
            {language === 'tl' ? 'Isumite ang Reklamo sa LGU' : 'Submit Dispute to City LGU'}
          </Typography>
        </DialogTitle>

        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}>
          {disputeSubmitted ? (
            <Alert severity="success" sx={{ borderRadius: '12px' }}>
              {language === 'tl'
                ? `Naisumite na ang iyong reklamo sa City LGU Transport Board (Incident #${activeBookingId}). Iimbestigahan ito agad.`
                : `Your complaint has been submitted to the City LGU Transport Board (Incident #${activeBookingId}). It will be investigated promptly.`}
            </Alert>
          ) : (
            <>
              <Typography sx={{ fontSize: '13px', color: '#64748B' }}>
                {language === 'tl'
                  ? 'Ipapadala ang ulat na ito sa City LGU Administrator sa ilalim ng Complaint & Incident Management.'
                  : 'This report is sent directly to the City LGU Administrator under Complaint & Incident Management.'}
              </Typography>

              {disputeError && (
                <Alert severity="error" sx={{ borderRadius: '12px' }}>{disputeError}</Alert>
              )}

              <TextField
                select
                fullWidth
                size="small"
                label={language === 'tl' ? "Uri ng Reklamo" : "Dispute Category"}
                value={disputeCategory}
                onChange={(e) => setDisputeCategory(e.target.value)}
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: '12px' } }}
              >
                <MenuItem value="Overcharging Attempt">
                  {language === 'tl' ? 'Overcharging (Sobra ang singil sa pamasahe)' : 'Overcharging (Exceeded official tariff)'}
                </MenuItem>
                <MenuItem value="Refusal to Follow Tariff">
                  {language === 'tl' ? 'Refusal to Follow Tariff (Hindi sumunod sa taripa)' : 'Refusal to Follow Tariff (Arbitrary pricing)'}
                </MenuItem>
                <MenuItem value="Unauthorized Route">
                  {language === 'tl' ? 'Unauthorized Route (Maling ruta)' : 'Unauthorized Route (Unscheduled detour)'}
                </MenuItem>
                <MenuItem value="Rude Behavior">
                  {language === 'tl' ? 'Rude Behavior (Hindi magandang asal)' : 'Rude Behavior / Harassment'}
                </MenuItem>
              </TextField>

              <TextField
                fullWidth
                size="small"
                label={language === 'tl' ? "Halagang Siningil ng Drayber (₱)" : "Amount Charged by Driver (₱)"}
                type="number"
                placeholder={language === 'tl' ? "Hal. 50" : "e.g. 50"}
                value={disputedAmount}
                onChange={(e) => setDisputedAmount(e.target.value)}
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: '12px' } }}
              />

              <TextField
                fullWidth
                size="small"
                multiline
                rows={3}
                label={language === 'tl' ? "Paliwanag o Detalye" : "Explanation or Details"}
                placeholder={language === 'tl' ? "Pakilarawan ang nangyari..." : "Please describe what happened..."}
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: '12px' } }}
              />
            </>
          )}
        </DialogContent>

        {!disputeSubmitted && (
          <DialogActions sx={{ p: '12px 18px 18px', gap: 1 }}>
            <Button
              variant="outlined"
              fullWidth
              onClick={() => setDisputeModalOpen(false)}
              sx={{ borderRadius: '12px', textTransform: 'none' }}
            >
              {language === 'tl' ? 'Kanselahin' : 'Cancel'}
            </Button>
            <Button
              variant="contained"
              fullWidth
              color="error"
              disabled={disputeSending || !activeBookingId}
              onClick={async () => {
                setDisputeError(null);
                setDisputeSending(true);
                try {
                  // The database takes the driver, the TODA and the reporter from the booking; only the facts of the complaint are sent.
                  await submitIncidentReport({
                    bookingId: activeBookingId as string,
                    category: disputeCategory || 'Overcharging Attempt',
                    description: `Disputed Fare. Expected: ₱${passengerPayableFare.toFixed(2)}, Actual: ₱${disputedAmount || passengerPayableFare}. Details: ${disputeReason}`,
                  });
                } catch (err) {
                  setDisputeError(err instanceof Error ? err.message : String(err));
                  setDisputeSending(false);
                  return;
                }
                setDisputeSending(false);

                setDisputeSubmitted(true);
                setTimeout(() => {
                  setDisputeModalOpen(false);
                  navigate('/dashboard', { replace: true });
                }, 2000);
              }}
              sx={{ borderRadius: '12px', fontWeight: 700, textTransform: 'none' }}
            >
              {language === 'tl' ? 'Isumite sa LGU' : 'Submit to LGU'}
            </Button>
          </DialogActions>
        )}
      </Dialog>

      {/* Bidirectional Driver Cancellation Realtime Notification Modal */}
      <Dialog
        open={driverCancelledAlertOpen}
        onClose={() => {
          setDriverCancelledAlertOpen(false);
          sessionStorage.removeItem('current_active_booking_id');
          navigate('/dashboard', { replace: true });
        }}
        slotProps={{
          paper: {
            sx: { borderRadius: '24px', p: 1.5, backgroundColor: '#FFFFFF', maxWidth: '380px', width: '90%' },
          },
        }}
      >
        <DialogTitle sx={{ textAlign: 'center', pt: 2, pb: 1 }}>
          <CancelIcon sx={{ fontSize: 48, color: '#EF4444', mb: 1 }} />
          <Typography sx={{ fontSize: '18px', fontWeight: 700, color: '#0F172A', fontFamily: 'Poppins, sans-serif' }}>
            {language === 'tl' ? 'Kanselado ang Biyahe' : 'Trip Cancelled'}
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ textAlign: 'center', pb: 2 }}>
          <Typography sx={{ fontSize: '14px', color: '#475569', fontWeight: 600, fontFamily: 'Poppins, sans-serif' }}>
            {noShowCancelled
              ? language === 'tl'
                ? 'Hindi ka sumakay sa loob ng oras ng paghihintay, kaya nakansela ang booking at 2 strike ang naitala. Maaari kang mag-book muli.'
                : 'You did not board within the waiting time, so the booking was cancelled as a no-show and 2 strikes were recorded. You can book again.'
              : language === 'tl'
              ? 'Kinansela ang booking.'
              : 'The booking has been cancelled.'}
          </Typography>
          {driverCancelReason && (
            <Box sx={{ mt: 1.5, p: '10px 14px', backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '12px' }}>
              <Typography sx={{ fontSize: '13px', color: '#B91C1C', fontWeight: 600, fontFamily: 'Poppins, sans-serif' }}>
                {language === 'tl' ? 'Rason:' : 'Reason:'} "{driverCancelReason}"
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2, pt: 0 }}>
          <Button
            fullWidth
            variant="contained"
            onClick={() => {
              setDriverCancelledAlertOpen(false);
              sessionStorage.removeItem('current_active_booking_id');
              navigate('/dashboard', { replace: true });
            }}
            sx={{
              height: 46,
              borderRadius: '14px',
              backgroundColor: '#FF6B00',
              fontWeight: 700,
              fontSize: '14px',
              textTransform: 'none',
              fontFamily: 'Poppins, sans-serif',
              boxShadow: '0 4px 14px rgba(255, 107, 0, 0.25)',
              '&:hover': { backgroundColor: '#E66000' },
            }}
          >
            {language === 'tl' ? 'OK (Mag-book Ulit)' : 'OK (Book Another Ride)'}
          </Button>
        </DialogActions>
      </Dialog>

      <SakayToast message={toastMessage} onClose={() => setToastMessage(null)} />
    </Box>
  );
};
