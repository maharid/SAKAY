import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Button,
  IconButton,
  Avatar,
} from '@mui/material';
import NavigationIcon from '@mui/icons-material/Navigation';
import PhoneIcon from '@mui/icons-material/Phone';
import MessageIcon from '@mui/icons-material/Message';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

import MapView, { type MapViewHandle } from '../../../common/components/MapView';
import { DriverCommunicationModal } from '../../communication/components/DriverCommunicationModal';
import { supabase } from '../../../services/supabaseClient';
import { useLanguage } from '../../../utils/LanguageContext';
import { useDriverSession } from '../../../contexts/DriverSessionContext';
import SakayToast from '../../../common/components/SakayToast';
import SharedLegSwitcher from '../../../common/components/SharedLegSwitcher';
import BookingGivenAwayDialog from '../../../common/components/BookingGivenAwayDialog';
import BookingCancelledDialog from '../../../common/components/BookingCancelledDialog';
import { useAssignedBookingClocks } from '../../../hooks/useAssignedBookingClocks';
import EnRouteNotices from '../../trip-management/components/EnRouteNotices';
import { DriverLocationNotice } from '../../../common/components/DriverPresenceNotices';
import { arrivalZoneHint } from '../../../utils/arrivalHint';
import {
  CollapsibleSheet,
  TripDetailsPanel,
  buildTripDetails,
  calculateDistanceKm,
  formatDistance,
  useInFlight,
  MapControlButton,
  MapControlStack,
  useMeasuredSize,
  useSafeAreaInsets,
  useStaleSignal,
} from '@sakay/shared';

export const DriverNavigation: React.FC = () => {
  const { language } = useLanguage();
  const { profile, setProfile, liveFix, locationIssue } = useDriverSession();
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const navigate = useNavigate();
  const location = useLocation();
  const bookingId = (location.state as { bookingId?: string })?.bookingId || '';

  const [booking, setBooking] = useState<any>(null);
  // The direction and speed the phone reported for THIS position (never for an older one): they only turn the marker's arrow and bring the map in close
  const fixIsCurrent = liveFix !== null && liveFix.latitude === profile.currentLat && liveFix.longitude === profile.currentLng;
  const driverHeading = fixIsCurrent ? liveFix.heading ?? null : null;
  const driverSpeed = fixIsCurrent ? liveFix.speed ?? null : null;
  const driverLocation = useMemo(
    () => ({
      lat: profile.currentLat || 13.4117,
      lng: profile.currentLng || 121.1803,
      heading: driverHeading,
      speed: driverSpeed,
    }),
    [profile.currentLat, profile.currentLng, driverHeading, driverSpeed]
  );
  // The map: its camera controls, what covers it (so the camera frames what is really visible), and whether the position is still refreshing
  const mapRef = useRef<MapViewHandle>(null);
  const driverFixStale = useStaleSignal(liveFix, 30_000);
  const safeArea = useSafeAreaInsets();
  const [bannerRef, banner] = useMeasuredSize<HTMLDivElement>();
  const [bottomCardRef, bottomCard] = useMeasuredSize<HTMLDivElement>();
  const mapInsets = useMemo(
    () => ({
      top: safeArea.top + 12 + banner.height + 12,
      right: 64,
      bottom: bottomCard.height + 12,
      left: 16,
    }),
    [safeArea.top, banner.height, bottomCard.height]
  );
  const [commModalOpen, setCommModalOpen] = useState(false);
  // open only when the driver opens it: nothing about the trip opens or closes the card
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  // Rules 8 / 9: the system's warning to a driver who has not started, and the notice that it gave the booking to another driver
  const clocks = useAssignedBookingClocks(bookingId, true);

  useEffect(() => {
    if (!bookingId) return;
    Promise.resolve(
      supabase
        .from('booking')
        .select('*')
        .eq('booking_id', bookingId)
        .maybeSingle()
    )
      .then(async ({ data }: any) => {
        if (data) {
          // The passenger's name, and phone while the trip is live, come from a function that discloses just that (the passenger table
          // is not readable by a driver).
          const { data: parties } = await supabase.rpc('get_booking_counterparties', { p_booking_ids: [bookingId] });
          const party = ((parties ?? []) as Array<{ passenger_name?: string | null; passenger_phone?: string | null }>)[0];
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
            dropoff_address: data.dropoff_address || data.dropoff_location_address || 'Calapan City',
            dropoff_latitude: Number(data.dropoff_latitude) || 13.4180,
            dropoff_longitude: Number(data.dropoff_longitude) || 121.1850,
            estimated_distance_km: Number(data.estimated_distance_km) || 0,
            estimated_fare: Number(data.estimated_fare) || 0,
            booking_status: data.booking_status,
            created_at: data.created_at,
            updated_at: data.updated_at,
          } as any);
        }
      })
      .catch((e: any) => console.warn('[DriverNavigation] Supabase fetch error:', e));
  }, [bookingId]);

  useEffect(() => {
    // The driver is on the way: Accepted -> In Transit. Only from Accepted: opening this screen again later (after arriving, or mid-trip) must
    // never move a booking backwards.
    const notifyEnRoute = async () => {
      try {
        await supabase
          .from('booking')
          .update({ booking_status: 'In Transit' })
          .eq('booking_id', bookingId)
          .eq('booking_status', 'Accepted');
      } catch (err) {
        // the trip screen shows the real status
      }
    };
    notifyEnRoute();

    // The driver's position is NOT sent to the passenger from here any more. It used to go out over a public realtime channel that anyone who knew
    // the booking id could join (to watch the driver or to send a false position); now the position the phone publishes (driver_heartbeat, every 5 s
    // while a booking is open, Rule 17.1) is read by the passenger from the database, which only the people on the booking may do.
  }, [bookingId]);

  // One request at a time: a second tap while the first is being saved must not write again.
  const arriveFlight = useInFlight();

  const recordArrivalAtPickup = async () => {
    // The database decides (and stamps the time): only a driver on the way can arrive. A refusal is shown, not hidden behind the next screen.
    const { data, error } = await supabase
      .from('booking')
      .update({ booking_status: 'Driver Arrived' })
      .eq('booking_id', bookingId)
      .in('booking_status', ['Accepted', 'In Transit'])
      .select('booking_id');
    const alreadyArrived = (booking?.booking_status === 'Driver Arrived' || booking?.booking_status === 'Arrived at Pickup');
    if (error || ((!data || data.length === 0) && !alreadyArrived)) {
      const why = error?.message ? error.message.replace(/^ERR_[A-Z_]+:\s*/, '') : '';
      setToastMessage(why || (language === 'tl' ? 'Hindi naitala ang pagdating. Pakisubukang muli.' : 'The arrival could not be recorded. Please try again.'));
      return;
    }
    navigate('/driver/active-trip', { replace: true, state: { bookingId } });
  };

  const handleArrivedAtPickup = () => arriveFlight.run(recordArrivalAtPickup);

  const passengerName = booking?.passenger_name || 'Passenger';
  const passengerPhone = booking?.passenger_phone || '';
  const pickupAddress = booking?.pickup_address || 'JP Rizal St. Central Terminal, Calapan City';
  const fare = booking?.estimated_fare ?? 0;
  const pickupLat = Number(booking?.pickup_latitude) || 13.4150;
  const pickupLng = Number(booking?.pickup_longitude) || 121.1825;
  const pickupDistanceKm = calculateDistanceKm(driverLocation.lat, driverLocation.lng, pickupLat, pickupLng);
  const etaMinutes = Math.max(1, Math.round((pickupDistanceKm / 20) * 60));
  const tl = language === 'tl';
  const passengerCount = booking?.passenger_count || 1;
  // The same facts the passenger's trip panel shows for this trip (pickup, destination, ride type, estimate, who), collapsed until asked for
  const tripDetails = buildTripDetails({
    role: 'driver',
    status: booking?.booking_status,
    pickupAddress: booking?.pickup_address,
    dropoffAddress: booking?.dropoff_address,
    isSharedTrip: booking?.is_shared_trip,
    passengerCount: booking?.passenger_count,
    estimatedFare: booking?.estimated_fare,
    counterpartName: booking?.passenger_name,
  });

  return (
    <Box sx={{ width: '100%', height: '100%', backgroundColor: '#E3ECEF', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <SakayToast message={toastMessage} severity="warning" onClose={() => setToastMessage(null)} />

      {/* Shared Trip (Section 14): the second passenger's leg is one tap away; nothing is shown on an ordinary trip */}
      <SharedLegSwitcher bookingId={bookingId} top={`calc(var(--safe-area-top) + ${banner.height + 24}px)`} />

      <BookingGivenAwayDialog open={clocks.bookingGone} language={language} onClose={() => navigate('/driver/home', { replace: true })} />
      {/* The passenger (or the system) cancelled while the driver was on the way: say who, and the reason when there is one */}
      <BookingCancelledDialog
        open={Boolean(clocks.cancellation)}
        language={language === 'tl' ? 'tl' : 'en'}
        cancelledBy={clocks.cancellation?.by ?? ''}
        reason={clocks.cancellation?.reason ?? ''}
        onClose={() => navigate('/driver/home', { replace: true })}
      />

      {/* 1. Leaflet OpenStreetMap Surface with the driver (tricycle, pointing the way it travels) and the passenger at the pickup */}
      <MapView
        ref={mapRef}
        userLocation={driverLocation}
        userStale={driverFixStale}
        pickupLocation={{
          lat: pickupLat,
          lng: pickupLng,
        }}
        pickupLabel={{ title: 'Pickup', address: booking?.pickup_address }}
        insets={mapInsets}
        stageKey="to-pickup"
        closeUpWhileMoving
      />

      {/* Map controls: the whole route to the pickup (top) and where I am (bottom). Each is an action, not a switch: it moves the camera once and never
          stays "on"; the bottom one also takes the map back to following the driver, and dragging the map lets go of either. */}
      <MapControlStack bottom={bottomCard.height + 16} label={language === 'tl' ? 'Mga kontrol ng mapa' : 'Map controls'}>
        <MapControlButton
          icon="route"
          label={language === 'tl' ? 'Ipakita ang buong ruta' : 'Show the whole route'}
          onClick={() => {
            if (!mapRef.current?.fitRoute()) {
              setToastMessage(language === 'tl' ? 'Wala pang ruta na maipapakita.' : 'There is no route to show yet.');
            }
          }}
        />
        <MapControlButton
          icon="my-location"
          label={language === 'tl' ? 'I-center sa aking lokasyon' : 'Center on my location'}
          unavailableReason={!liveFix ? (language === 'tl' ? 'Hinihintay pa ang GPS. Ipinapakita ang huling alam na lokasyon.' : 'Waiting for GPS. Showing your last known location.') : undefined}
          onClick={() => {
            if (!mapRef.current?.centerOnDriver()) {
              setToastMessage(language === 'tl' ? 'Wala pang nakuhang lokasyon mo. Tiyaking naka-on ang Location.' : 'Your location is not available yet. Make sure Location is turned on.');
            }
          }}
        />
      </MapControlStack>

      {/* 2. Top banner: where the driver is heading and how far it is. One compact row (the road route is drawn on the map; there are no spoken or
          turn-by-turn directions). The way out of the screen is the phone's own back, as everywhere else in the app. */}
      <Paper
        ref={bannerRef}
        elevation={6}
        sx={{
          position: 'absolute',
          top: 'calc(var(--safe-area-top) + 12px)',
          left: 12,
          right: 12,
          backgroundColor: 'rgba(15, 23, 42, 0.96)',
          backdropFilter: 'blur(8px)',
          color: '#FFFFFF',
          borderRadius: '18px',
          px: 1.5,
          py: 1.25,
          boxShadow: '0 10px 28px rgba(15, 23, 42, 0.25)',
          zIndex: 30,
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          border: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        <Box aria-hidden sx={{ width: 36, height: 36, borderRadius: '50%', backgroundColor: '#FF6600', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 2px 8px rgba(255, 102, 0, 0.4)' }}>
          <NavigationIcon sx={{ fontSize: 20, color: '#FFFFFF' }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="h1" sx={{ fontSize: '12px', color: '#FDBA74', fontWeight: 700, lineHeight: 1.3 }}>
            {tl ? 'Papunta sa pickup' : 'En route to pickup'}
          </Typography>
          <Typography
            title={pickupAddress}
            sx={{ fontSize: '14px', fontWeight: 700, color: '#FFFFFF', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}
          >
            {pickupAddress}
          </Typography>
        </Box>
        <Box sx={{ pl: 1.25, borderLeft: '1px solid rgba(255, 255, 255, 0.18)', textAlign: 'right', flexShrink: 0 }}>
          <Typography sx={{ fontSize: '16px', fontWeight: 800, color: '#FFFFFF', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {etaMinutes} {tl ? 'min' : 'min'}
          </Typography>
          <Typography sx={{ fontSize: '12px', color: '#CBD5E1', lineHeight: 1.3, whiteSpace: 'nowrap' }}>{formatDistance(pickupDistanceKm)}</Typography>
        </Box>
      </Paper>

      {/* 3. Bottom card: the passenger, anything that cannot wait, and the one action for this stage. The trip details open on demand (handle: tap, drag or
          arrow keys), so the map keeps its room. */}
      <CollapsibleSheet
        sheetRef={bottomCardRef}
        // room above the card for the banner and the two map controls (they are never covered)
        maxHeight={`calc(100% - var(--safe-area-top) - ${banner.height + 136}px)`}
        expanded={sheetExpanded}
        onExpandedChange={setSheetExpanded}
        expandLabel={tl ? 'Ipakita ang detalye ng biyahe' : 'Show trip details'}
        collapseLabel={tl ? 'Itago ang detalye ng biyahe' : 'Hide trip details'}
        zIndex={20}
        summary={
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {/* Rule 17.4: the server is not getting this phone's position (no connection, or a position that is not good enough) */}
            <DriverLocationNotice issue={locationIssue} />

            <EnRouteNotices bookingId={bookingId} language={language} stallWarnedAt={clocks.stallWarnedAt} onMessage={setToastMessage} />

            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
                <Avatar sx={{ width: 40, height: 40, flexShrink: 0, backgroundColor: '#FF6600', color: '#FFFFFF', fontWeight: 700, fontSize: '16px' }}>
                  {passengerName.charAt(0)}
                </Avatar>
                <Box sx={{ minWidth: 0 }}>
                  <Typography noWrap title={passengerName} sx={{ fontSize: '15px', fontWeight: 700, color: '#0F172A', lineHeight: 1.3 }}>
                    {passengerName}
                  </Typography>
                  <Typography noWrap sx={{ fontSize: '12px', color: '#475569', lineHeight: 1.3 }}>
                    {booking?.is_shared_trip ? 'Shared' : 'Solo'} · {passengerCount} {tl ? 'pasahero' : passengerCount === 1 ? 'passenger' : 'passengers'}
                  </Typography>
                </Box>
              </Box>

              <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                <IconButton aria-label={tl ? 'Tawagan ang pasahero' : 'Call passenger'} onClick={() => setCommModalOpen(true)} sx={{ width: 44, height: 44, backgroundColor: '#E6F4EA', color: '#166534', '&:hover': { backgroundColor: '#D1EBD7' } }}>
                  <PhoneIcon fontSize="small" />
                </IconButton>
                <IconButton aria-label={tl ? 'Magpadala ng mensahe sa pasahero' : 'Message passenger'} onClick={() => setCommModalOpen(true)} sx={{ width: 44, height: 44, backgroundColor: '#FFF1E6', color: '#FF6600', '&:hover': { backgroundColor: '#FFE6D2' } }}>
                  <MessageIcon fontSize="small" />
                </IconButton>
              </Box>
            </Box>
          </Box>
        }
        details={<TripDetailsPanel view={tripDetails} language={language} variant="plain" defaultExpanded />}
        actions={
          <>
            {/* Arrival Confirmation Action Button */}
            <Button
              variant="contained"
              fullWidth
              onClick={handleArrivedAtPickup}
              disabled={arriveFlight.busy}
              startIcon={<CheckCircleIcon />}
              sx={{
                minHeight: 52,
                borderRadius: '14px',
                '&.Mui-disabled': { backgroundColor: '#FF6600', color: '#FFFFFF', opacity: 0.75 },
                backgroundColor: '#FF6600',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: '15px',
                whiteSpace: 'nowrap',
                textTransform: 'none',
                '&:hover': { backgroundColor: '#E65C00' },
              }}
            >
              {arriveFlight.busy
                ? (tl ? 'Itinatala...' : 'Recording...')
                : (tl ? 'Nakarating na sa Pickup' : 'Arrived at Pickup')}
            </Button>
            {/* Rule 10.1: the database accepts Arrived only from the pickup, on a clear GPS fix (the radius is the one in the policy config) */}
            <Typography sx={{ fontSize: '12px', color: '#475569', textAlign: 'center', fontWeight: 500, lineHeight: 1.35 }}>
              {arrivalZoneHint(tl)}
            </Typography>
          </>
        }
      />

      {/* Communication Dialog */}
      <DriverCommunicationModal
        open={commModalOpen}
        onClose={() => setCommModalOpen(false)}
        passengerName={passengerName}
        passengerPhone={passengerPhone}
      />
    </Box>
  );
};

export default DriverNavigation;
