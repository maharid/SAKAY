import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  IconButton,
  Avatar,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  AlertTitle,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PhoneIcon from '@mui/icons-material/Phone';
import MessageIcon from '@mui/icons-material/Message';
import StarIcon from '@mui/icons-material/Star';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import CancelIcon from '@mui/icons-material/Cancel';
import LinearProgress from '@mui/material/LinearProgress';
import MapView, { type MapViewHandle } from '../../../common/components/MapView';
import PassengerCancelModal from '../../../common/components/PassengerCancelModal';
import SakayToast from '../../../common/components/SakayToast';
import { getBooking, cancelBooking, tryCancelBooking, updateBookingState } from '../../../services/bookingService';
import type { BookingRecord } from '@sakay/shared';
import {
  formatShortBookingId,
  calculateDistanceKm,
  formatDistance,
  signedStorageUrl,
  SIGNED_URL_TTL,
  CollapsibleSheet,
  SECONDARY_BUTTON_SX,
  useMeasuredSize,
  useSafeAreaInsets,
  TripDetailsPanel,
  buildTripDetails,
  calculateTripProgressPercent,
  fetchServerTripProgress,
  useInFlight,
  QuickMessageDialog,
  MapControlButton,
  MapControlStack,
  searchRadiusFromStatus,
  PASSENGER_STALE_LOCATION_DIM_SECONDS,
  useTripEndState,
  useSharedMatch,
  SharedMatchPanel,
  requestEarlyEnd,
  withdrawEarlyEnd,
  confirmFare,
  reportFareDiscrepancy,
  requestSafetyFareReview,
  type PassengerEarlyEndReason,
  reportNetworkOutcome,
  reportNetworkResult,
  resolveHeading,
  localizeCancellationReason,
} from '@sakay/shared';
import { supabase } from '../../../services/supabaseClient';
import { useLanguage } from '../../../utils/LanguageContext';
import { describeRetryRefusal, retryDriverSearch } from '../../../services/dispatchService';
import { useArrivalWait } from '../hooks/useArrivalWait';
import { usePassengerLocation } from '../hooks/usePassengerLocation';
import { useDispatchStatus } from '../../ride-booking/hooks/useDispatchStatus';
import ArrivalWaitCard from './ArrivalWaitCard';
import EndTripEarlyDialog from './EndTripEarlyDialog';
import TripSafetyActions from './TripSafetyActions';
import FareConfirmationCard from './FareConfirmationCard';
import FareDiscrepancyDialog from './FareDiscrepancyDialog';
import TripCompletedDialog from './TripCompletedDialog';
import DriverLastUpdated from './DriverLastUpdated';
import { useDriverLiveStatus } from '../hooks/useDriverLiveStatus';

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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
      if (!restarted.ok) {
        setToastMessage(describeRetryRefusal(restarted.errorCode, language));
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
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  // The trip card is closed at first (the map keeps its room; the driver, what cannot wait and the action of the stage are in view) and changes only when the
  // passenger uses its handle: a trip update never opens or closes it
  const [sheetExpanded, setSheetExpanded] = useState(false);

  // The map fills the whole screen, as on the New Trip screen; the header card, the status pill and the trip card float over it. What covers it is measured, so the
  // camera frames and centres inside what is really visible, and the map controls sit just above the trip card whether it is open or closed.
  const safeArea = useSafeAreaInsets();
  const [headerRef, header] = useMeasuredSize<HTMLDivElement>();
  const [sheetRef, sheetSize] = useMeasuredSize<HTMLDivElement>();
  const mapInsets = useMemo(
    () => ({ top: safeArea.top + 12 + header.height + 56, right: 64, bottom: sheetSize.height + 12, left: 12 }),
    [safeArea.top, header.height, sheetSize.height]
  );

  // Bidirectional Driver Cancelled Alert State
  const [driverCancelledAlertOpen, setDriverCancelledAlertOpen] = useState(false);
  const [driverCancelReason, setDriverCancelReason] = useState<string>('');
  // who cancelled it, as saved ('driver', 'system'): the notice names the driver only when it was the driver
  const [cancelledByDriver, setCancelledByDriver] = useState(false);
  // the reason as saved, shown in the language that is selected (nothing when none was saved)
  const shownCancelReason = localizeCancellationReason(driverCancelReason, language === 'tl' ? 'tl' : 'en');
  // The booking was cancelled because the passenger did not board in time (Rule 10.4), not because the driver gave it up
  const [noShowCancelled, setNoShowCancelled] = useState(false);
  const [extendingWait, setExtendingWait] = useState(false);
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

  // The end of the trip (Rules 13, 16, 18): what the passenger taps is a call to the database and what the screen shows is what the database answers
  // (get_trip_end_state). Nothing is kept on the phone and nothing is broadcast: the old payment_confirmed_* keys and channels are gone.
  const [endEarlyOpen, setEndEarlyOpen] = useState(false);
  const [discrepancyMode, setDiscrepancyMode] = useState<'discrepancy' | 'safety' | null>(null);
  const [discrepancyError, setDiscrepancyError] = useState<string | null>(null);
  const [completedDialogOpen, setCompletedDialogOpen] = useState(false);

  // One request at a time: a second tap while the first is being saved must not write again (the database would treat it as a no-op, and the toast would lie).
  const earlyFlight = useInFlight();
  const confirmFlight = useInFlight();
  const reportFlight = useInFlight();
  const cancelFlight = useInFlight();

  // Driver Location Telemetry
  // `known`: the position is the driver's real one (a fallback point is only used for the distance text, never drawn as the driver)
  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number; at?: number; heading?: number | null; speed?: number | null; known: boolean }>({
    lat: booking?.driver_latitude || 13.4140,
    lng: booking?.driver_longitude || 121.1845,
    known: Boolean(booking?.driver_latitude && booking?.driver_longitude),
  });
  const driverKnown = driverPos.known;
  // The driver's position is read from the DATABASE only (get_driver_live_status, every 2.5 s; the driver's phone publishes a fix every 5 s, Rule 17.1).
  // It used to travel on a public realtime channel as well; anyone who knew a booking id could listen to it or send a false position, so that channel
  // is gone. The SAME place is not a new position: no new state, no redraw. The marker's arrow points the way the tricycle moved between two fixes
  // (resolveHeading ignores GPS noise and keeps the last direction while it is stopped); nothing is made up when there is no movement to read.
  const applyDriverPos = useCallback((lat: number, lng: number) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    setDriverPos((prev) => {
      if (prev.known && prev.lat === lat && prev.lng === lng) return prev;
      const { heading } = resolveHeading({
        previous: prev.known ? { lat: prev.lat, lng: prev.lng } : null,
        current: { lat, lng },
        lastHeading: prev.heading ?? null,
      });
      return { lat, lng, heading, speed: null, known: true };
    });
  }, [setDriverPos]);

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
          if (drvLat && drvLng) {
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
              setCompletedDialogOpen(true);
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
    setDriverPos((prev) => ({ ...prev, known: false }));
    setDriverPhotoUrl('');
    setDriverRating(null);
    setBooking((prev) => (prev ? { ...prev, driver_id: undefined, driver_name: '', driver_phone: '', franchise_no: '', vehicle_plate: '', toda_name: '' } : prev));
    // Who gave the booking up, and why, is in the booking's cancellation record (the booking row itself is back in the search and carries no reason).
    // A reason is shown only when the record has one; if it cannot be read the notice still says what happened.
    const bookingId = activeBookingId;
    void (async () => {
      let byDriver = false;
      let reason = '';
      try {
        const { data } = await supabase
          .from('cancellation_record')
          .select('cancelled_by, reason')
          .eq('booking_id', bookingId)
          .order('cancelled_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const record = data as { cancelled_by?: string | null; reason?: string | null } | null;
        byDriver = record?.cancelled_by === 'driver';
        if (byDriver) reason = localizeCancellationReason(record?.reason, language === 'tl' ? 'tl' : 'en');
      } catch {
        // the notice below is the plain one
      }
      if (byDriver) {
        setToastMessage(
          language === 'tl'
            ? `Kinansela ng drayber mo ang booking.${reason ? ` Dahilan: ${reason}.` : ''} Naghahanap kami ng ibang drayber.`
            : `Your driver cancelled the booking.${reason ? ` Reason: ${reason}.` : ''} We're finding you another driver.`
        );
      } else {
        setToastMessage(
          language === 'tl'
            ? 'Hindi nakapagpatuloy ang iyong drayber. Naghahanap kami ng ibang drayber.'
            : 'Your driver was unable to proceed. We\'re finding you another driver.'
        );
      }
    })();
  }, [language, activeBookingId]);

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
            cancellation_reason
          `)
          .eq('booking_id', activeBookingId)
          .maybeSingle();
        reportNetworkOutcome(error);                          // Rule 17.4: does this phone reach the server?

        if (!error && data) {
          const d = data as any;
          if (d.booking_status === 'Cancelled' && d.cancelled_by && d.cancelled_by !== 'passenger') {
            const noShow = d.cancellation_reason === 'PASSENGER_NO_SHOW';
            setNoShowCancelled(noShow);
            setCancelledByDriver(d.cancelled_by === 'driver');
            setDriverCancelReason(noShow ? '' : d.cancellation_reason ?? '');
            setDriverCancelledAlertOpen(true);
          }
          handleBackToSearch(d);
          // A driver accepted (or the driver changed): load who it is
          if (d.driver_id && d.driver_id !== loadedDriverIdRef.current) {
            loadedDriverIdRef.current = d.driver_id;
            fetchBookingFromDb();
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
              setCompletedDialogOpen(true);
            }
            return merged;
          });
        }
      } catch (err) {
        // a poll that did not get through is tried again by the next one; it is also a failed call for the "Connection lost" notice (Rule 17.4)
        reportNetworkResult(false);
      }
    };
    pollNowRef.current = pollOnce;
    const pollInterval = setInterval(pollOnce, 2500);

    // (Named differently from the old broadcast topic `passenger_trip_<id>` on purpose: this channel carries only the booking's own row changes, which
    // the database's row security already limits to the people on the booking.)
    const channel = supabase
      .channel(`booking_changes_${activeBookingId}`)
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
              setCancelledByDriver(row.cancelled_by === 'driver');
              setDriverCancelReason(noShow ? '' : row.cancellation_reason ?? '');
              setDriverCancelledAlertOpen(true);
            }
            handleBackToSearch(row);

            if (row.driver_latitude && row.driver_longitude) {
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
                setCompletedDialogOpen(true);
              }
              return merged;
            });
          }
        }
      )
      .subscribe();

    return () => {
      clearInterval(pollInterval);
      pollNowRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [activeBookingId, language, fetchBookingFromDb, handleBackToSearch, applyDriverPos]);

  const status = booking?.booking_status || 'Searching Driver';
  const isTripActive = status !== 'Completed' && status !== 'Cancelled';
  // Rules 26.1 / 26.2: Share Live Trip and the Urgent Safety Report are offered while a driver is on the trip
  const safetyActive = isTripActive && Boolean(booking?.driver_id) && status !== 'Searching Driver' && status !== 'No Driver Found' && status !== 'Pending';

  // The end of the trip as the database has it (Rules 16.6 / 18.2 / 18.3): the fare, who has answered, the one confirmation timer, the payment and the dispute.
  const tripEndActive = UUID_PATTERN.test(activeBookingId) && (status === 'Trip Ongoing' || status === 'Arrived at Destination' || status === 'Completed');
  const tripEnd = useTripEndState(supabase, activeBookingId, tripEndActive);
  const endState = tripEnd.state;
  // Ride-sharing (Section 14): whether a second passenger is being asked or is on the way, and the first passenger's Accept / Decline Shared Match (Rule 14.5).
  // The database answers; a booking that is not Shared is never asked.
  const sharedMatch = useSharedMatch(supabase, activeBookingId, UUID_PATTERN.test(activeBookingId) && Boolean(booking?.is_shared_trip) && isTripActive && status !== 'Arrived at Destination');
  // End Trip (Early) was asked for and the driver has not ended the trip yet (Rule 13.2)
  const earlyRequested = status === 'Trip Ongoing' && Boolean(endState?.earlyEnd && endState.earlyEnd.kind !== 'DRIVER' && endState.earlyEnd.requestedAt);
  const say = (tl: string, en: string) => (language === 'tl' ? tl : en);

  const handleRequestEarlyEnd = (reason: PassengerEarlyEndReason, note: string) =>
    earlyFlight.run(async () => {
      const r = await requestEarlyEnd(supabase, activeBookingId, reason, note || null);
      if (!r.ok) {
        setToastMessage(r.error ?? say('Hindi naipadala ang hiling. Pakisubukang muli.', 'The request could not be sent. Please try again.'));
        return;
      }
      setEndEarlyOpen(false);
      setToastMessage(
        r.data?.at_gate
          ? say('Nasa destinasyon ka na: ang drayber ang magtatapos ng biyahe.', 'You are at the destination: the driver ends the trip.')
          : say('Naipadala sa drayber ang hiling mo.', 'Your request was sent to the driver.')
      );
      await tripEnd.refresh();
    });

  const handleWithdrawEarlyEnd = () =>
    earlyFlight.run(async () => {
      const r = await withdrawEarlyEnd(supabase, activeBookingId);
      if (!r.ok) setToastMessage(r.error ?? say('Hindi na-withdraw ang hiling.', 'The request could not be withdrawn.'));
      await tripEnd.refresh();
    });

  // Rule 18.2: Confirm Fare. The trip is NOT paid or completed by it: that needs the driver's Payment Received as well (Rule 18.3).
  const handleConfirmFare = () =>
    confirmFlight.run(async () => {
      const r = await confirmFare(supabase, activeBookingId);
      if (!r.ok) setToastMessage(r.error ?? say('Hindi nakumpirma ang pamasahe. Pakisubukang muli.', 'We could not confirm the fare. Please try again.'));
      await tripEnd.refresh();
    });

  const closeDiscrepancyDialog = () => {
    setDiscrepancyMode(null);
    setDiscrepancyError(null);
    if (status === 'Completed') setCompletedDialogOpen(true);
  };
  const handleSubmitDiscrepancy = (claimedAmount: number | null, reason: string) =>
    reportFlight.run(async () => {
      setDiscrepancyError(null);
      const r =
        discrepancyMode === 'safety'
          ? await requestSafetyFareReview(supabase, activeBookingId, reason)
          : await reportFareDiscrepancy(supabase, activeBookingId, claimedAmount ?? 0, reason);
      if (!r.ok) {
        setDiscrepancyError(r.error ?? say('Hindi naisumite. Pakisubukang muli.', 'It could not be submitted. Please try again.'));
        return;
      }
      closeDiscrepancyDialog();
      setToastMessage(
        discrepancyMode === 'safety'
          ? say('Naisumite ang hiling mo sa TODA Administrator.', 'Your request was sent to the TODA Administrator.')
          : say('Naisumite ang ulat. Susuriin ito ng TODA Administrator.', 'Your report was submitted. The TODA Administrator will review it.')
      );
      await tripEnd.refresh();
    });

  const handleRateDriver = () => {
    setCompletedDialogOpen(false);
    sessionStorage.removeItem('current_active_booking_id');
    sessionStorage.removeItem('trip_dropoff');
    sessionStorage.removeItem('trip_pickup');
    sessionStorage.removeItem('trip_notes');
    const fare = endState?.actualFare ?? booking?.actual_fare ?? booking?.estimated_fare ?? 0;
    updateBookingState(activeBookingId, { booking_status: 'Completed', actual_fare: fare });
    navigate('/feedback', { replace: true, state: { booking: { ...booking, booking_status: 'Completed', actual_fare: fare } } });
  };

  // The map: the passenger's own position (only on this phone), the search area while a driver is being looked for, and the two camera controls
  const mapRef = useRef<MapViewHandle>(null);
  const passengerLocation = usePassengerLocation(isTripActive);
  const isSearching = status === 'Searching Driver';
  const { status: searchStatus } = useDispatchStatus(isSearching && UUID_PATTERN.test(activeBookingId) ? activeBookingId : null);
  const searchRadiusMeters = isSearching ? searchRadiusFromStatus(searchStatus) : null;
  // "Center on me" was pressed before there was a position to centre on: do it as soon as the first one arrives
  const centerWhenLocatedRef = useRef(false);
  useEffect(() => {
    if (!centerWhenLocatedRef.current || !passengerLocation.fix) return;
    centerWhenLocatedRef.current = false;
    mapRef.current?.centerOnUser();
  }, [passengerLocation.fix]);
  // The phone said no (or cannot tell): say so once instead of leaving the press without an answer
  useEffect(() => {
    if (!centerWhenLocatedRef.current) return;
    if (passengerLocation.status !== 'denied' && passengerLocation.status !== 'unavailable') return;
    centerWhenLocatedRef.current = false;
    setToastMessage(
      passengerLocation.status === 'denied'
        ? language === 'tl'
          ? 'Hindi pinayagan ang lokasyon. I-on ito sa settings ng browser para makita ang iyong posisyon.'
          : 'Location was not allowed. Turn it on in your browser settings to see where you are.'
        : language === 'tl'
        ? 'Hindi makuha ang iyong lokasyon ngayon. Subukan muli sa mas bukas na lugar.'
        : 'Your location is not available right now. Try again with a clearer view of the sky.'
    );
  }, [passengerLocation.status, language]);
  // The driver's position as the DATABASE has it, and how old it is (Rules 17.1 / 17.9 / 9.2). The marker is drawn dimmer when the position is old, and the map says
  // WHEN it was taken once it is more than 10 seconds old; the database's copy is also what moves the marker.
  const driverLive = useDriverLiveStatus(activeBookingId, UUID_PATTERN.test(activeBookingId) && Boolean(booking?.driver_id) && isTripActive);
  useEffect(() => {
    if (!driverLive.position) return;
    applyDriverPos(driverLive.position.lat, driverLive.position.lng);
  }, [driverLive.position, applyDriverPos]);
  const driverStale = driverLive.ageSeconds !== null && driverLive.ageSeconds > PASSENGER_STALE_LOCATION_DIM_SECONDS;

  const handleCenterOnMe = () => {
    if (mapRef.current?.centerOnUser()) {
      centerWhenLocatedRef.current = false;
      return;
    }
    // This press is the passenger's consent to read the phone's location for this map: ask (again), and centre when the answer comes
    centerWhenLocatedRef.current = true;
    passengerLocation.request();
    if (passengerLocation.status === 'denied') {
      setToastMessage(
        language === 'tl'
          ? 'Naka-block ang lokasyon sa browser. I-on ito sa settings ng browser para makita ang iyong posisyon.'
          : 'Location is blocked in your browser. Turn it on in your browser settings to see where you are.'
      );
      return;
    }
    setToastMessage(language === 'tl' ? 'Hinahanap ang iyong lokasyon...' : 'Finding your location...');
  };

  // While a driver is still being looked for there is no route yet: the same control then frames the area being searched
  const showsSearchArea = isSearching && searchRadiusMeters !== null;
  const handleFitRoute = () => {
    const framed = showsSearchArea ? mapRef.current?.fitSearchArea() : mapRef.current?.fitRoute();
    if (!framed) {
      setToastMessage(language === 'tl' ? 'Wala pang ruta na maipapakita.' : 'There is no route to show yet.');
    }
  };

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
    const attempt = await tryCancelBooking(activeBookingId, finalReason);
    setCancelModalOpen(false);
    if (!attempt.cancelled) {
      // Still open in the database: do not pretend it is cancelled (the passenger could not book again)
      setToastMessage(
        attempt.onTheWay
          ? (language === 'tl'
            ? 'Papunta na ang drayber, kaya hindi na maaaring ikansela ang booking.'
            : 'Your driver is already on the way, so this booking can no longer be cancelled.')
          : language === 'tl'
          ? 'Hindi makansela ang booking. Pakisubukang muli.'
          : 'The booking could not be cancelled. Please try again.'
      );
      return;
    }
    sessionStorage.removeItem('current_active_booking_id');
    navigate('/dashboard');
  };

  const handleCancelTrip = (reasonText?: string) => cancelFlight.run(() => cancelPassengerBooking(reasonText));

  const handleOpenCommModal = () => setCommModalOpen(true);

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
    sharedPaired: sharedMatch.view ? sharedMatch.view.state === 'matched' : null,
    sharedMatchingOpen: sharedMatch.view ? sharedMatch.view.matchingOpen : null,
  });

  return (
    <Box sx={{ width: '100%', height: '100%', backgroundColor: '#F8FAFC', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
      {/* 1. The full-screen map, behind everything (the same layout as the New Trip screen) */}
      <MapView
        ref={mapRef}
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
        driverLocation={status !== 'Searching Driver' && driverKnown ? driverPos : null}
        userLocation={passengerLocation.fix}
        showUserMarker
        userStale={passengerLocation.stale}
        driverStale={driverStale}
        insets={mapInsets}
        stageKey={status}
        searchRadiusMeters={searchRadiusMeters}
      />

      {/* 2. Header card floating over the map: back (before the trip), the title and the booking number */}
      <Box
        ref={headerRef}
        sx={{
          position: 'absolute',
          top: 'calc(var(--safe-area-top) + 12px)',
          left: 12,
          right: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1,
          py: 0.75,
          backgroundColor: 'rgba(255, 255, 255, 0.96)',
          backdropFilter: 'blur(8px)',
          border: '1px solid #E2E8F0',
          borderRadius: '16px',
          boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
          zIndex: 30,
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

        {/* Status Pill Badge */}
        <Chip
          label={
            status === 'Searching Driver'
              ? (language === 'tl' ? 'Naghahanap ng pinakamalapit na Tricycle...' : 'Finding nearest tricycle...')
              : status === 'No Driver Found'
              ? (language === 'tl' ? 'Walang nahanap na drayber sa ngayon' : 'No driver available right now')
              : status === 'Driver Assigned' || status === 'Driver En Route'
              ? (driverKnown
                  ? (language === 'tl'
                      ? `Papunta na ang Driver • ${formatDistance(driverToPickupKm)} (~${Math.max(1, Math.round(driverToPickupKm * 3))} min)`
                      : `Driver en route • ${formatDistance(driverToPickupKm)} (~${Math.max(1, Math.round(driverToPickupKm * 3))} min)`)
                  : (language === 'tl' ? 'Papunta na ang Driver' : 'Driver en route'))
              : status === 'Driver Arrived'
              ? (language === 'tl' ? 'Nandito na ang Tricycle sa Pickup Point!' : 'Tricycle has arrived at the pickup point!')
              : status === 'Trip Ongoing'
              ? (language === 'tl' ? 'Bumibiyahe sa Destinasyon' : 'Traveling to destination')
              : (language === 'tl' ? 'Nakumpleto na ang Biyahe!' : 'Trip Completed!')
          }
          sx={{
            position: 'absolute',
            top: `calc(var(--safe-area-top) + ${header.height + 20}px)`,
            left: '50%',
            transform: 'translateX(-50%)',
            maxWidth: 'calc(100% - 24px)',
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

        {/* Rule 17.9: when the driver's last position is more than 10 seconds old the map says when it was taken */}
        {status !== 'Searching Driver' && driverKnown && (
          <DriverLastUpdated ageSeconds={driverLive.ageSeconds} lastFixAt={driverLive.lastFixAt} language={language} bottom={sheetSize.height + 16} />
        )}

        {/* The search area itself is drawn on the map (MapView), at the radius the database reports: nothing is drawn here */}

        {/* Map controls: the whole trip (top) and where I am (bottom). Each is an action that moves the camera once; dragging the map lets go of either. */}
        <MapControlStack bottom={sheetSize.height + 16} label={language === 'tl' ? 'Mga kontrol ng mapa' : 'Map controls'}>
          <MapControlButton
            icon="route"
            label={
              showsSearchArea
                ? (language === 'tl' ? 'Ipakita ang buong lugar ng paghahanap' : 'Show the whole search area')
                : (language === 'tl' ? 'Ipakita ang buong ruta' : 'Show the whole route')
            }
            onClick={handleFitRoute}
          />
          <MapControlButton
            icon="my-location"
            label={language === 'tl' ? 'I-center sa aking lokasyon' : 'Center on my location'}
            unavailableReason={
              passengerLocation.status === 'denied'
                ? language === 'tl' ? 'Naka-block ang lokasyon sa browser' : 'Location is blocked in your browser'
                : passengerLocation.status === 'unavailable'
                ? language === 'tl' ? 'Hindi makuha ang lokasyon ngayon' : 'Location is not available right now'
                : undefined
            }
            onClick={handleCenterOnMe}
          />
        </MapControlStack>

      {/* 3. Driver & trip (bottom card): who and anything that cannot wait stay in view; the trip details, progress and tricycle open and close with the handle
          (tap, drag or arrow keys). The card floats over the full-screen map: opening it covers more of the map, closing it shows more of it. */}
      <CollapsibleSheet
        sheetRef={sheetRef}
        // room above the card for the header, the status pill and the two map controls (they are never covered)
        maxHeight={`calc(100% - var(--safe-area-top) - ${header.height + 180}px)`}
        expanded={sheetExpanded}
        onExpandedChange={setSheetExpanded}
        expandLabel={language === 'tl' ? 'Ipakita ang detalye ng biyahe' : 'Show trip details'}
        collapseLabel={language === 'tl' ? 'Itago ang detalye ng biyahe' : 'Hide trip details'}
        summary={
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {driverLive.unreachable && (
              <Alert severity="warning" sx={{ borderRadius: '14px', fontSize: '13px', fontWeight: 600 }}>
                {/* Rules 9.2 / 17.4 / 17.9: the title is the notice of Rule 17.4, the body the exact message of Rule 9.2 */}
                <AlertTitle sx={{ fontSize: '13px', fontWeight: 700 }}>
                  {language === 'tl' ? 'Nawalan ng koneksyon — nire-reconnect...' : 'Connection lost — reconnecting...'}
                </AlertTitle>
                {language === 'tl'
                  ? 'Mukhang may problema sa koneksyon ang iyong drayber. Patuloy kaming susubok na makontak siya.'
                  : "Your driver appears to be experiencing a connectivity issue. We'll keep trying to reach them."}
              </Alert>
            )}

            {status === 'Driver Arrived' && arrivalWait && (
              <ArrivalWaitCard wait={arrivalWait} language={language} onExtend={handleExtendWait} extending={extendingWait} compact={!sheetExpanded} />
            )}

            {status === 'Arrived at Destination' && (
              <FareConfirmationCard
                language={language}
                state={endState}
                fallbackFare={passengerPayableFare}
                secondsLeft={tripEnd.secondsLeft}
                expired={tripEnd.expired}
                ordinance={fareOrdinance}
                compact={!sheetExpanded}
              />
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
                  <Avatar src={status !== 'Searching Driver' && driverPhotoUrl ? driverPhotoUrl : undefined} alt={driverName} sx={{ width: 64, height: 64, flexShrink: 0, backgroundColor: '#FF6600', color: '#FFFFFF', fontWeight: 700, fontSize: '26px' }}>
                    {driverName.charAt(0)}
                  </Avatar>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: '16px', fontWeight: 700, color: '#0F172A', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere', lineHeight: 1.3 }}>
                      {status === 'Searching Driver' ? (language === 'tl' ? 'Naghahanap ng Drayber...' : 'Looking for Driver...') : driverName}
                    </Typography>
                    {/* the number is written out (not only behind the call button) so it can be read to a relative or noted down */}
                    {status !== 'Searching Driver' && driverPhone && (
                      <Typography sx={{ fontSize: '16px', fontWeight: 700, color: '#166534', lineHeight: 1.3 }}>{driverPhone}</Typography>
                    )}
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
                      sx={{ width: 44, height: 44, backgroundColor: '#FFF1E6', color: '#FF6600', '&:hover': { backgroundColor: '#FFE6D2' } }}
                    >
                      <MessageIcon fontSize="small" />
                    </IconButton>
                  </Box>
                )}
              </Box>
            )}

            {/* Ride-sharing (Rules 14.2.1, 14.5): the Accept / Decline Shared Match question, and the limited facts about the passenger who shares */}
            <SharedMatchPanel view={sharedMatch.view} language={language} secondsLeft={sharedMatch.secondsLeft} busy={sharedMatch.busy} errorMessage={sharedMatch.error} onRespond={(accept) => void sharedMatch.respond(accept)} />
          </Box>
        }
        details={
          <>
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
                  sx={{ height: 8, borderRadius: 4, backgroundColor: '#E2E8F0', '& .MuiLinearProgress-bar': { backgroundColor: '#FF6600', borderRadius: 4 } }}
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
                  <Typography sx={{ fontSize: '13px', color: '#475569', fontWeight: 600 }}>
                    {language === 'tl' ? 'Franchise body no.' : 'Franchise body no.'}
                  </Typography>
                  <Typography sx={{ fontSize: '20px', fontWeight: 700, color: '#0F172A', overflowWrap: 'anywhere' }}>{franchiseNo}</Typography>
                </Box>
                {/* Panel comment (D-P2): the plate is what the passenger looks for on the road, so it is large and boxed */}
                <Box sx={{ textAlign: 'right', minWidth: 0 }}>
                  <Typography sx={{ fontSize: '13px', color: '#475569', fontWeight: 600 }}>{language === 'tl' ? 'Numero ng plaka' : 'Plate number'}</Typography>
                  <Typography
                    aria-label={`${language === 'tl' ? 'Numero ng plaka' : 'Plate number'}: ${plateNo}`}
                    sx={{ display: 'inline-block', fontSize: '28px', fontWeight: 800, color: '#0F172A', letterSpacing: '0.05em', lineHeight: 1.2, border: '3px solid #0F172A', borderRadius: '10px', backgroundColor: '#FEF9C3', px: 1.25, py: 0.25, overflowWrap: 'anywhere' }}
                  >
                    {plateNo}
                  </Typography>
                </Box>
              </Box>
            )}
          </>
        }
        actions={
          status !== 'Completed' && status !== 'Cancelled' ? (
            <>
            <TripSafetyActions
                bookingId={activeBookingId}
                language={language === 'tl' ? 'tl' : 'en'}
                active={safetyActive && UUID_PATTERN.test(activeBookingId)}
                onEndTripEarly={status === 'Trip Ongoing' && !earlyRequested ? () => setEndEarlyOpen(true) : undefined}
                onMessage={setToastMessage}
              />
              {status === 'No Driver Found' ? (
                <Box sx={{ display: 'flex', gap: 1.5 }}>
                  <Button
                    variant="outlined"
                    fullWidth
                    onClick={() => {
                      // Rule 7.4, cancel without penalty: close the booking in the database too (it never strikes or flags the passenger), only while
                      // it is STILL No Driver Found (this screen may be out of date), and leave at once; if the close cannot be saved the booking
                      // simply stays No Driver Found, which is not open either.
                      if (activeBookingId) void cancelBooking(activeBookingId, 'No driver found', 'No Driver Found');
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
                    sx={{ minHeight: 52, borderRadius: '16px', '&.Mui-disabled': { backgroundColor: '#FF6600', color: '#FFFFFF', opacity: 0.75 }, backgroundColor: '#FF6600', color: '#FFFFFF', textTransform: 'none', fontWeight: 700, fontSize: '15px', boxShadow: 'none', '&:hover': { backgroundColor: '#E65C00', boxShadow: 'none' } }}
                  >
                    {language === 'tl' ? 'Subukan Muli' : 'Retry Search'}
                  </Button>
                </Box>
              ) : status === 'Arrived at Destination' ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Button
                    variant="contained"
                    fullWidth
                    onClick={handleConfirmFare}
                    disabled={confirmFlight.busy || Boolean(endState?.confirmFareAt) || Boolean(endState?.fareDiscrepancyAt) || (endState !== null && !endState.canConfirmFare)}
                    sx={{
                      minHeight: 52,
                      borderRadius: '16px',
                      '&.Mui-disabled': { backgroundColor: '#15803D', color: '#FFFFFF', opacity: 0.6 },
                      backgroundColor: '#15803D',
                      fontWeight: 700,
                      fontSize: '16px',
                      textTransform: 'none',
                      boxShadow: 'none',
                      '&:hover': { backgroundColor: '#166534', boxShadow: 'none' },
                    }}
                  >
                    {confirmFlight.busy
                      ? say('Kinukumpirma...', 'Confirming...')
                      : endState?.confirmFareAt
                      ? say('Nakumpirma na ang pamasahe', 'Fare confirmed')
                      : say('Kumpirmahin ang Pamasahe', 'Confirm Fare')}
                  </Button>
                  {!endState?.confirmFareAt && !endState?.fareDiscrepancyAt && (
                    <Button
                      variant="outlined"
                      fullWidth
                      color="error"
                      onClick={() => setDiscrepancyMode('discrepancy')}
                      startIcon={<ReportProblemIcon />}
                      sx={{ minHeight: 44, borderRadius: '14px', fontWeight: 600, fontSize: '13px', textTransform: 'none', borderColor: '#CBD5E1', color: '#B91C1C', '&:hover': { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' } }}
                    >
                      {say('I-report ang Pamasahe', 'Report Fare Discrepancy')}
                    </Button>
                  )}
                </Box>
              ) : status === 'Trip Ongoing' ? (
                /* Rule 13.2: a trip in progress is not cancelled; the passenger asks to END it early (a request the driver acts on) */
                earlyRequested ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'center' }}>
                    <Typography role="status" sx={{ fontSize: '13px', fontWeight: 600, color: '#475569', textAlign: 'center' }}>
                      {say('Naipadala sa drayber ang hiling: hinihintay na tapusin niya ang biyahe.', 'Request sent: waiting for the driver to end the trip.')}
                    </Typography>
                    <Button variant="outlined" fullWidth disabled={earlyFlight.busy} onClick={handleWithdrawEarlyEnd} sx={SECONDARY_BUTTON_SX}>
                      {say('Bawiin ang hiling', 'Withdraw the request')}
                    </Button>
                  </Box>
                ) : (
                  <Button
                    variant="outlined"
                    fullWidth
                    disabled={earlyFlight.busy}
                    onClick={() => setEndEarlyOpen(true)}
                    sx={{ minHeight: 52, borderRadius: '16px', textTransform: 'none', fontWeight: 700, fontSize: '15px', color: '#B45309', borderColor: '#FDBA74', '&:hover': { backgroundColor: '#FFF7ED', borderColor: '#FB923C' } }}
                  >
                    {say('Tapusin nang Maaga ang Biyahe', 'End Trip (Early)')}
                  </Button>
                )
              ) : (status === 'Driver En Route' || status === 'Driver Arrived') && !driverLive.unreachable ? (
                /* Panel comment: once the driver is on the way (or has arrived) the booking can no longer be cancelled. The database refuses it too (ERR_DRIVER_ON_THE_WAY);
                   a driver the system has marked Unreachable can still be left, so the button comes back then. */
                <Typography role="status" sx={{ fontSize: '13px', fontWeight: 600, color: '#475569', textAlign: 'center', lineHeight: 1.5, px: 1 }}>
                  {status === 'Driver Arrived'
                    ? say('Nasa pickup na ang drayber. Hindi na maaaring ikansela ang booking: lumabas na sa pickup point.', 'Your driver is at the pickup. This booking can no longer be cancelled: please head out to meet them.')
                    : say('Papunta na ang drayber. Hindi na maaaring ikansela ang booking. May problema? Gamitin ang Urgent Safety Report.', 'Your driver is on the way. This booking can no longer be cancelled. Something wrong? Use the Urgent Safety Report.')}
                </Typography>
              ) : (
                /* Before the driver is on the way the passenger may still cancel: a plain, quiet button that opens the same confirmation (reason and confirm) */
                <Button
                  variant="outlined"
                  fullWidth
                  onClick={() => setCancelModalOpen(true)}
                  sx={{ minHeight: 52, borderRadius: '16px', textTransform: 'none', fontWeight: 700, fontSize: '15px', color: '#B91C1C', borderColor: '#FCA5A5', '&:hover': { backgroundColor: '#FEF2F2', borderColor: '#F87171' } }}
                >
                  {language === 'tl' ? 'Ikansel ang Booking' : 'Cancel Booking'}
                </Button>
              )}
            </>
          ) : null
        }
      />

      {/* 4. Cancellation Confirmation Modal */}
      <PassengerCancelModal
        open={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        onConfirmCancel={handleCancelTrip}
        language={language}
        loading={cancelFlight.busy}
        phase={status === 'Searching Driver' ? 'searching' : 'accepted'}
      />

      {/* 5. Quick message to the driver (the shared sheet: ready-made messages, one tap to choose, one to send) */}
      <QuickMessageDialog
        open={commModalOpen}
        onClose={() => setCommModalOpen(false)}
        language={language}
        recipient={`${language === 'tl' ? 'Driver' : 'Driver'} ${driverName}`}
        phone={driverPhone}
        templates={
          language === 'tl'
            ? ['Nandito na po ako sa labas.', 'Nasa tapat po ako ng gate.', 'Saglit lang po, palabas na ako.', 'Pakibilisan po, salamat!']
            : ["I'm waiting outside.", "I'm in front of the gate.", "One moment, I'm coming out.", 'Please hurry if you can. Thank you!']
        }
      />

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
            sx={{ borderRadius: '12px', backgroundColor: '#FF6600', color: '#FFFFFF', fontWeight: 700, height: '44px', textTransform: 'none', '&:hover': { backgroundColor: '#E05000' } }}
          >
            {language === 'tl' ? 'Manatili sa Tracking' : 'Stay on Tracking'}
          </Button>
          <Button
            variant="outlined"
            fullWidth
            onClick={() => {
              setLeaveConfirmModalOpen(false);
              navigate('/dashboard');
            }}
            sx={SECONDARY_BUTTON_SX}
          >
            {language === 'tl' ? 'Pumunta sa Dashboard' : 'Go to Dashboard'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 7. End Trip (Early): the request to the driver (Rule 13.2) */}
      <EndTripEarlyDialog open={endEarlyOpen} language={language} busy={earlyFlight.busy} onClose={() => setEndEarlyOpen(false)} onConfirm={handleRequestEarlyEnd} />

      {/* 8. Report Fare Discrepancy (Rule 18.4), and the review of a Safety Concern early end (Rule 13.5) */}
      <FareDiscrepancyDialog
        open={discrepancyMode !== null}
        mode={discrepancyMode ?? 'discrepancy'}
        language={language}
        systemFare={endState?.actualFare ?? passengerPayableFare}
        busy={reportFlight.busy}
        error={discrepancyError}
        onClose={closeDiscrepancyDialog}
        onSubmit={handleSubmitDiscrepancy}
      />

      {/* 9. The trip is over: the driver tapped Payment Received (Rule 18.3) */}
      <TripCompletedDialog
        open={completedDialogOpen}
        language={language}
        fare={endState?.actualFare ?? passengerPayableFare}
        state={endState}
        onRate={handleRateDriver}
        onReport={() => {
          setCompletedDialogOpen(false);
          setDiscrepancyMode('discrepancy');
        }}
        onAskReview={() => {
          setCompletedDialogOpen(false);
          setDiscrepancyMode('safety');
        }}
      />

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
              : cancelledByDriver
              ? language === 'tl'
                ? 'Kinansela ng drayber ang booking.'
                : 'Your driver has cancelled the booking.'
              : language === 'tl'
              ? 'Nakansela ang booking.'
              : 'The booking has been cancelled.'}
          </Typography>
          {shownCancelReason && (
            <Box sx={{ mt: 1.5, p: '10px 14px', backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '12px' }}>
              <Typography sx={{ fontSize: '13px', color: '#B91C1C', fontWeight: 600, fontFamily: 'Poppins, sans-serif', overflowWrap: 'anywhere' }}>
                {language === 'tl' ? 'Dahilan:' : 'Reason:'} &ldquo;{shownCancelReason}&rdquo;
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
              backgroundColor: '#FF6600',
              fontWeight: 700,
              fontSize: '14px',
              textTransform: 'none',
              fontFamily: 'Poppins, sans-serif',
              boxShadow: '0 4px 14px rgba(255, 102, 0, 0.25)',
              '&:hover': { backgroundColor: '#E65C00' },
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
