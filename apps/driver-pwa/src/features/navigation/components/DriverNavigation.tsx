import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Button,
  IconButton,
  Avatar,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import NavigationIcon from '@mui/icons-material/Navigation';
import PhoneIcon from '@mui/icons-material/Phone';
import MessageIcon from '@mui/icons-material/Message';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

import MapView, { type MapViewHandle, type CameraMode } from '../../../common/components/MapView';
import { DriverCommunicationModal } from '../../communication/components/DriverCommunicationModal';
import { supabase } from '../../../services/supabaseClient';
import { useLanguage } from '../../../utils/LanguageContext';
import { useDriverSession } from '../../../contexts/DriverSessionContext';
import SakayToast from '../../../common/components/SakayToast';
import SharedLegSwitcher from '../../../common/components/SharedLegSwitcher';
import BookingGivenAwayDialog from '../../../common/components/BookingGivenAwayDialog';
import { useAssignedBookingClocks } from '../../../hooks/useAssignedBookingClocks';
import EnRouteNotices from '../../trip-management/components/EnRouteNotices';
import { DriverLocationNotice } from '../../../common/components/DriverPresenceNotices';
import { arrivalZoneHint } from '../../../utils/arrivalHint';
import {
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
  // The latest heading and speed, for the broadcast below (the position itself is read from profileRef): the channel is not rebuilt per fix
  const motionRef = useRef({ heading: driverHeading, speed: driverSpeed });
  motionRef.current = { heading: driverHeading, speed: driverSpeed };
  // The map: its camera controls, what covers it (so the camera frames what is really visible), and whether the position is still refreshing
  const mapRef = useRef<MapViewHandle>(null);
  const [cameraMode, setCameraMode] = useState<CameraMode>('auto');
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
  const [exitGuardOpen, setExitGuardOpen] = useState(false);
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

    // Watch real-time GPS position and broadcast to passenger
    const channel = bookingId ? supabase.channel(`passenger_trip_${bookingId}`) : null;

    // `heading` / `speed` are what the phone reported (null when it did not): the passenger's marker uses them for its arrow, nothing else.
    const sendPosition = () => {
      const cur = profileRef.current;
      if (!channel || !cur.currentLat || !cur.currentLng) return;
      channel.send({
        type: 'broadcast',
        event: 'driver_location',
        payload: { lat: cur.currentLat, lng: cur.currentLng, at: Date.now(), heading: motionRef.current.heading, speed: motionRef.current.speed },
      });
    };

    if (channel) {
      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') sendPosition();
      });
    }

    // Broadcast Driver Location whenever it changes from the central context
    const broadcastInterval = setInterval(sendPosition, 2000);

    return () => {
      clearInterval(broadcastInterval);
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
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

  const handleExitToHome = () => {
    setExitGuardOpen(false);
    navigate('/driver/home');
  };

  const passengerName = booking?.passenger_name || 'Passenger';
  const passengerPhone = booking?.passenger_phone || '';
  const pickupAddress = booking?.pickup_address || 'JP Rizal St. Central Terminal, Calapan City';
  const fare = booking?.estimated_fare ?? 0;
  const pickupLat = Number(booking?.pickup_latitude) || 13.4150;
  const pickupLng = Number(booking?.pickup_longitude) || 121.1825;
  const pickupDistanceKm = calculateDistanceKm(driverLocation.lat, driverLocation.lng, pickupLat, pickupLng);
  const etaMinutes = Math.max(1, Math.round((pickupDistanceKm / 20) * 60));

  return (
    <Box sx={{ width: '100%', height: '100%', backgroundColor: '#E3ECEF', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <SakayToast message={toastMessage} severity="warning" onClose={() => setToastMessage(null)} />

      {/* Shared Trip (Section 14): the second passenger's leg is one tap away; nothing is shown on an ordinary trip */}
      <SharedLegSwitcher bookingId={bookingId} top={`calc(var(--safe-area-top) + ${banner.height + 24}px)`} />

      <BookingGivenAwayDialog open={clocks.bookingGone} language={language} onClose={() => navigate('/driver/home', { replace: true })} />

      {/* 1. Leaflet OpenStreetMap Surface with the driver (tricycle, pointing the way it travels) and the passenger at the pickup */}
      <MapView
        ref={mapRef}
        userLocation={driverLocation}
        userStale={driverFixStale}
        pickupLocation={{
          lat: pickupLat,
          lng: pickupLng,
        }}
        insets={mapInsets}
        stageKey="to-pickup"
        closeUpWhileMoving
        onCameraModeChange={setCameraMode}
      />

      {/* Map controls: where I am, and the whole route to the pickup. Each really moves the camera; dragging the map lets go of either. */}
      <MapControlStack bottom={bottomCard.height + 16} label={language === 'tl' ? 'Mga kontrol ng mapa' : 'Map controls'}>
        <MapControlButton
          icon="my-location"
          label={language === 'tl' ? 'I-center sa aking lokasyon' : 'Center on my location'}
          pressed={cameraMode === 'driver'}
          unavailableReason={!liveFix ? (language === 'tl' ? 'Hinihintay pa ang GPS. Ipinapakita ang huling alam na lokasyon.' : 'Waiting for GPS. Showing your last known location.') : undefined}
          onClick={() => {
            if (!mapRef.current?.centerOnDriver()) {
              setToastMessage(language === 'tl' ? 'Wala pang nakuhang lokasyon mo. Tiyaking naka-on ang Location.' : 'Your location is not available yet. Make sure Location is turned on.');
            }
          }}
        />
        <MapControlButton
          icon="route"
          label={language === 'tl' ? 'Ipakita ang buong ruta' : 'Show the whole route'}
          pressed={cameraMode === 'route'}
          onClick={() => {
            if (!mapRef.current?.fitRoute()) {
              setToastMessage(language === 'tl' ? 'Wala pang ruta na maipapakita.' : 'There is no route to show yet.');
            }
          }}
        />
      </MapControlStack>

      {/* 2. Top Floating Banner: where the driver is heading. (The road route is drawn on the map; there are no spoken or turn-by-turn directions.) */}
      <Paper
        ref={bannerRef}
        elevation={6}
        sx={{
          position: 'absolute',
          top: 'calc(var(--safe-area-top) + 12px)',
          left: 16,
          right: 16,
          backgroundColor: 'rgba(15, 23, 42, 0.96)',
          backdropFilter: 'blur(8px)',
          color: '#FFFFFF',
          borderRadius: '20px',
          padding: '14px 16px',
          boxShadow: '0 12px 32px rgba(15, 23, 42, 0.25)',
          zIndex: 30,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          border: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        <IconButton
          aria-label={language === "tl" ? "Umalis sa navigation" : "Leave navigation"}
          onClick={() => setExitGuardOpen(true)}
          sx={{
            backgroundColor: 'rgba(255, 255, 255, 0.12)',
            color: '#FFFFFF',
            width: 36,
            height: 36,
            borderRadius: '10px',
            flexShrink: 0,
            '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.25)' },
          }}
        >
          <ArrowBackIcon sx={{ fontSize: 18 }} />
        </IconButton>

        <Box sx={{ width: 40, height: 40, borderRadius: '50%', backgroundColor: '#FF6600', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 2px 8px rgba(255, 102, 0, 0.4)' }}>
          <NavigationIcon sx={{ fontSize: 22, color: '#FFFFFF', transform: 'rotate(0deg)' }} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: '12px', color: '#94A3B8', fontWeight: 700, }}>
            {language === 'tl' ? 'Papunta sa pickup' : 'En route to pickup'}
          </Typography>
          <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#FFFFFF', lineHeight: 1.2 }}>
            {language === 'tl' ? 'Pumunta sa pickup location ng pasahero' : 'Drive towards passenger pickup location'}
          </Typography>
        </Box>
      </Paper>

      {/* 3. Bottom Route Summary Card */}
      <Paper
        ref={bottomCardRef}
        elevation={8}
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: '#FFFFFF',
          borderTopLeftRadius: '24px',
          borderTopRightRadius: '24px',
          padding: '18px 20px calc(var(--safe-area-bottom) + 20px) 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
          zIndex: 20,
          borderTop: '1px solid #E2E8F0',
          boxShadow: '0 -8px 30px rgba(0, 0, 0, 0.08)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Avatar sx={{ width: 44, height: 44, backgroundColor: '#FF6600', color: '#FFFFFF', fontWeight: 700, fontSize: '16px' }}>
              {passengerName.charAt(0)}
            </Avatar>
            <Box>
              <Typography sx={{ fontSize: '15px', fontWeight: 700, color: '#0F172A' }}>
                {passengerName}
              </Typography>
              <Typography sx={{ fontSize: '12px', color: '#64748B' }}>
                Pickup: {pickupAddress.split(',')[0]}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', gap: 1 }}>
            <IconButton aria-label={language === "tl" ? "Tawagan ang pasahero" : "Call passenger"} onClick={() => setCommModalOpen(true)} sx={{ backgroundColor: '#ECFDF5', color: '#10B981', '&:hover': { backgroundColor: '#D1FAE5' } }}>
              <PhoneIcon fontSize="small" />
            </IconButton>
            <IconButton aria-label={language === "tl" ? "Magpadala ng mensahe sa pasahero" : "Message passenger"} onClick={() => setCommModalOpen(true)} sx={{ backgroundColor: '#FFF8F0', color: '#FF6600', '&:hover': { backgroundColor: '#FFE8D6' } }}>
              <MessageIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>

        {/* ETA & Distance */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: '10px 14px', borderRadius: '14px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}>
          <Box>
            <Typography sx={{ fontSize: '12px', color: '#64748B', fontWeight: 700 }}>
              {language === 'tl' ? 'Tinatayang dating (eta)' : 'Estimated arrival (eta)'}
            </Typography>
            <Typography sx={{ fontSize: '16px', fontWeight: 700, color: '#0F172A' }}>
              {etaMinutes} {language === 'tl' ? 'min' : 'mins'} • {formatDistance(pickupDistanceKm)}
            </Typography>
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography sx={{ fontSize: '12px', color: '#64748B', fontWeight: 700 }}>
              {language === 'tl' ? 'Pamasahe' : 'Fare'}
            </Typography>
            <Typography sx={{ fontSize: '17px', fontWeight: 700, color: '#FF6600' }}>₱{fare.toFixed(2)}</Typography>
          </Box>
        </Box>

        {/* Rule 17.4: the server is not getting this phone's position (no connection, or a position that is not good enough) */}
        <DriverLocationNotice issue={locationIssue} />

        <EnRouteNotices bookingId={bookingId} language={language} stallWarnedAt={clocks.stallWarnedAt} onMessage={setToastMessage} />

        {/* Arrival Confirmation Action Button */}
        <Button
          variant="contained"
          fullWidth
          onClick={handleArrivedAtPickup}
          disabled={arriveFlight.busy}
          startIcon={<CheckCircleIcon />}
          sx={{
            height: 50,
            borderRadius: '14px',
            '&.Mui-disabled': { backgroundColor: '#FF6600', color: '#FFFFFF', opacity: 0.75 },
            backgroundColor: '#FF6600',
            color: '#FFFFFF',
            fontWeight: 700,
            fontSize: '15px',
            textTransform: 'none',
            '&:hover': { backgroundColor: '#E65C00' },
          }}
        >
          {arriveFlight.busy
            ? (language === 'tl' ? 'Itinatala...' : 'Recording...')
            : (language === 'tl' ? 'Nakarating na sa Pickup' : 'Arrived at Pickup')}
        </Button>
        {/* Rule 10.1: the database accepts Arrived only from the pickup, on a clear GPS fix (the radius is the one in the policy config) */}
        <Typography sx={{ fontSize: '12px', color: '#475569', textAlign: 'center', fontWeight: 500 }}>
          {arrivalZoneHint(language === 'tl')}
        </Typography>
      </Paper>

      {/* Communication Dialog */}
      <DriverCommunicationModal
        open={commModalOpen}
        onClose={() => setCommModalOpen(false)}
        passengerName={passengerName}
        passengerPhone={passengerPhone}
      />

      {/* Exit Guard Confirmation Dialog */}
      <Dialog
        open={exitGuardOpen}
        onClose={() => setExitGuardOpen(false)}
        slotProps={{
          paper: {
            sx: {
              borderRadius: '20px',
              padding: '8px',
              backgroundColor: '#FFFFFF',
              boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
            },
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 700, fontSize: '17px', color: '#0F172A', textAlign: 'center' }}>
          {language === 'tl' ? 'Aktibong Navigasyon' : 'Active Navigation En Route'}
        </DialogTitle>
        <DialogContent sx={{ textAlign: 'center', py: 1 }}>
          <Typography sx={{ fontSize: '14px', color: '#475569', lineHeight: 1.5 }}>
            {language === 'tl'
              ? `Kasalukuyan kang papunta sa pickup point ni `
              : `You are currently en route to the pickup point of `}
            <strong>{passengerName}</strong>
            {language === 'tl'
              ? `. Nais mo bang kanselahin ang navigasyon at bumalik sa Home?`
              : `. Do you wish to cancel this navigation and return to Home?`}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 2, pb: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Button
            fullWidth
            variant="contained"
            onClick={() => setExitGuardOpen(false)}
            sx={{
              height: 46,
              borderRadius: '12px',
              backgroundColor: '#FF6600',
              fontWeight: 700,
              textTransform: 'none',
              '&:hover': { backgroundColor: '#E65C00' },
            }}
          >
            {language === 'tl' ? 'Manatili sa Navigasyon' : 'Stay in Navigation'}
          </Button>
          <Button
            fullWidth
            variant="outlined"
            color="error"
            onClick={handleExitToHome}
            sx={{
              height: 44,
              borderRadius: '12px',
              fontWeight: 700,
              textTransform: 'none',
            }}
          >
            {language === 'tl' ? 'Kanselahin at Bumalik sa Home' : 'Cancel and Return to Home'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default DriverNavigation;
