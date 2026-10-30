import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Avatar, Box, Button, LinearProgress, Typography } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import PhoneIcon from '@mui/icons-material/Phone';
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined';

import { RouteTimeline, SHARE_TOKEN_PATTERN, fetchSharedTripView, type SharedTripView as SharedTrip } from '@sakay/shared';
import Logo from '../../../common/components/Logo';
import SharedTripMap from '../components/SharedTripMap';
import { LIVE_POSITION_MAX_AGE_SECONDS, useSharedTripRoutes } from '../hooks/useSharedTripRoutes';
import { supabase } from '../../../services/supabaseClient';
import { useLanguage } from '../../../utils/LanguageContext';

/** How often the page asks the database for the newest position */
const POLL_MS = 5000;
const FONT = 'Poppins, sans-serif';

const TEXT = {
  en: {
    ended: 'This link has ended',
    endedBody: 'A shared-trip link works only while the trip is on and for a few minutes after. You can ask the person who sent it for a new one.',
    live: 'Live',
    pickup: 'Pickup',
    destination: 'Destination',
    driver: 'Driver',
    plate: 'Plate number',
    phone: 'Driver phone number',
    call: 'Call',
    progress: (n: number) => `${n}% of the trip`,
    etaPickup: (n: number) => `Reaching the pickup in about ${n} min`,
    etaDestination: (n: number) => `Reaching the destination in about ${n} min`,
    updatedNow: 'Driver location updated just now',
    updatedAgo: (m: number) => `Driver location updated ${m} min ago`,
    outdated: 'This location may be out of date.',
    noPosition: 'The driver\'s location is not available yet.',
    privacy: 'This page refreshes every few seconds. It never shows the passenger\'s name or phone number, or the fare.',
    loading: 'Loading the trip',
    language: 'Language',
  },
  tl: {
    ended: 'Tapos na ang link na ito',
    endedBody: 'Gumagana lamang ang link ng ibinahaging biyahe habang tumatakbo ang biyahe at ilang minuto pagkatapos. Maaari kang humingi ng bago sa taong nagpadala nito.',
    live: 'Live',
    pickup: 'Pickup',
    destination: 'Destinasyon',
    driver: 'Drayber',
    plate: 'Numero ng plaka',
    phone: 'Numero ng telepono ng drayber',
    call: 'Tawagan',
    progress: (n: number) => `${n}% ng biyahe`,
    etaPickup: (n: number) => `Darating sa pickup sa halos ${n} min`,
    etaDestination: (n: number) => `Darating sa destinasyon sa halos ${n} min`,
    updatedNow: 'Bagong update ang lokasyon ng drayber',
    updatedAgo: (m: number) => `Na-update ang lokasyon ng drayber ${m} min na ang nakalipas`,
    outdated: 'Maaaring luma na ang lokasyong ito.',
    noPosition: 'Wala pang lokasyon ng drayber.',
    privacy: 'Nag-a-update ang pahinang ito bawat ilang segundo. Walang pangalan o numero ng telepono ng pasahero, at walang pamasahe dito.',
    loading: 'Kinukuha ang biyahe',
    language: 'Wika',
  },
} as const;

/**
 * Rule 26.1: what the person who received a Share Live Trip link sees. No account, no sign-in: the link is the only credential and the database answers only for a link that is
 * still live (until the trip ends + 15 minutes, never longer than 4 hours, and not switched off). The page shows the SAKAY brand, a map with the road between the pickup and the
 * destination and the tricycle moving on it, the status, the pickup and destination, the driver's FIRST name and plate, and the time to the next stop when it can be told. It uses
 * exactly the fields the database sends (no passenger name, phone number or fare is ever among them) and one timer that stops when the trip has ended.
 */
const SharedTripView: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>();
  const { language, setLanguage } = useLanguage();
  const t = language === 'tl' ? TEXT.tl : TEXT.en;
  const valid = SHARE_TOKEN_PATTERN.test(token);
  const [trip, setTrip] = useState<SharedTrip | null>(null);
  const [loaded, setLoaded] = useState(false);
  const inFlight = useRef(false);

  // One poll for the life of the page; it stops by itself once the trip has ended (nothing more will change) and does not run while the page is hidden
  useEffect(() => {
    if (!valid) return undefined;
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    // the first read always happens (a link opened in a background tab is ready when the person looks at it); later ones wait while the page is hidden
    const read = async (force = false) => {
      if (inFlight.current || (document.hidden && !force)) return;
      inFlight.current = true;
      try {
        const view = await fetchSharedTripView(supabase, token);
        if (!alive) return;
        setTrip(view);
        setLoaded(true);
        if (!view || view.ended) stop();
      } finally {
        inFlight.current = false;
      }
    };
    const onVisible = () => {
      if (!document.hidden) void read();
    };
    void read(true);
    timer = setInterval(() => void read(), POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      stop();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [token, valid]);

  const { road, etaMinutes, etaTarget } = useSharedTripRoutes(trip);

  const gone = !valid || (loaded && !trip);
  const pos = trip?.driver_position ?? null;
  const progress = trip?.progress_pct ?? null;
  const stale = Boolean(pos && pos.age_seconds > LIVE_POSITION_MAX_AGE_SECONDS);
  const pickupPoint = trip && trip.pickup && trip.pickup.lat !== null && trip.pickup.lng !== null ? { lat: trip.pickup.lat, lng: trip.pickup.lng } : null;
  const dropoffPoint = trip && trip.dropoff && trip.dropoff.lat !== null && trip.dropoff.lng !== null ? { lat: trip.dropoff.lat, lng: trip.dropoff.lng } : null;
  const statusText = trip ? (language === 'tl' ? trip.status_tl : trip.status_en) : '';

  return (
    <Box
      sx={{
        width: '100%',
        height: '100dvh',
        backgroundColor: '#F8FAFC',
        display: 'flex',
        flexDirection: { xs: 'column', md: 'row-reverse' },
        overflow: 'hidden',
        fontFamily: FONT,
      }}
    >
      {/* The map: the top of the page on a phone, the larger side on a wide screen */}
      <Box sx={{ position: 'relative', flex: { xs: '1 1 45%', md: '1 1 auto' }, minHeight: { xs: 220, md: 0 } }}>
        {trip && !gone ? (
          <SharedTripMap
            language={language === 'tl' ? 'tl' : 'en'}
            pickup={pickupPoint}
            dropoff={dropoffPoint}
            route={road}
            driver={pos ? { lat: pos.lat, lng: pos.lng } : null}
            driverStale={stale}
          />
        ) : (
          <Box sx={{ position: 'absolute', inset: 0, backgroundColor: '#E2E8F0' }} />
        )}
      </Box>

      {/* The information: the bottom of the page on a phone, a column on the left on a wide screen */}
      <Box
        sx={{
          flex: { xs: '0 1 auto', md: '0 0 400px' },
          maxHeight: { xs: '58%', md: 'none' },
          overflowY: 'auto',
          backgroundColor: '#FFFFFF',
          borderTop: { xs: '1px solid #E2E8F0', md: 'none' },
          borderRight: { md: '1px solid #E2E8F0' },
          borderTopLeftRadius: { xs: '24px', md: 0 },
          borderTopRightRadius: { xs: '24px', md: 0 },
          boxShadow: { xs: '0 -8px 24px rgba(15, 23, 42, 0.08)', md: 'none' },
          zIndex: 2,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* header: the SAKAY brand and the language */}
        <Box component="header" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, px: 2.5, pt: 2, pb: 1.25 }}>
          <Logo color="orange" width={92} />
          <Box role="group" aria-label={t.language} sx={{ display: 'flex', gap: 0.5, backgroundColor: '#F1F5F9', borderRadius: '999px', p: '3px' }}>
            {(['tl', 'en'] as const).map((code) => (
              <Button
                key={code}
                size="small"
                aria-pressed={language === code}
                onClick={() => setLanguage(code)}
                sx={{
                  minWidth: 44,
                  minHeight: 32,
                  px: 1,
                  borderRadius: '999px',
                  fontSize: '12px',
                  fontWeight: 700,
                  textTransform: 'none',
                  backgroundColor: language === code ? '#C75000' : 'transparent',
                  color: language === code ? '#FFFFFF' : '#475569',
                  '&:hover': { backgroundColor: language === code ? '#B04600' : '#E2E8F0' },
                }}
              >
                {code === 'tl' ? 'TL' : 'EN'}
              </Button>
            ))}
          </Box>
        </Box>

        {!loaded && valid && <LinearProgress aria-label={t.loading} sx={{ mx: 2.5 }} />}

        {gone && (
          <Box role="status" sx={{ mx: 2.5, mb: 2.5, p: 2, borderRadius: '16px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}>
            <Typography sx={{ fontWeight: 700, color: '#0F172A', fontFamily: FONT }}>{t.ended}</Typography>
            <Typography sx={{ fontSize: '13px', color: '#475569', mt: 0.5, lineHeight: 1.5, fontFamily: FONT }}>{t.endedBody}</Typography>
          </Box>
        )}

        {trip && !gone && (
          <Box sx={{ px: 2.5, pb: 'calc(env(safe-area-inset-bottom, 0px) + 20px)', display: 'flex', flexDirection: 'column', gap: 1.75 }}>
            {/* status, and the time to the next stop */}
            <Box
              role="status"
              aria-live="polite"
              sx={{ p: 1.75, borderRadius: '16px', backgroundColor: trip.ended ? '#F1F5F9' : '#ECFDF5', border: `1px solid ${trip.ended ? '#CBD5E1' : '#A7F3D0'}` }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                <Typography sx={{ fontWeight: 700, fontSize: '16px', color: '#0F172A', fontFamily: FONT, lineHeight: 1.3 }}>{statusText}</Typography>
                {!trip.ended && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, fontSize: '12px', fontWeight: 700, color: '#166534' }}>
                    <Box aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: stale ? '#F59E0B' : '#16A34A' }} />
                    {t.live}
                  </Box>
                )}
              </Box>
              {etaMinutes !== null && etaTarget && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.75, color: '#0F172A' }}>
                  <TimerOutlinedIcon aria-hidden sx={{ fontSize: 18, color: '#C75000' }} />
                  <Typography sx={{ fontSize: '14px', fontWeight: 600, fontFamily: FONT }}>{etaTarget === 'pickup' ? t.etaPickup(etaMinutes) : t.etaDestination(etaMinutes)}</Typography>
                </Box>
              )}
              {progress !== null && (
                <Box sx={{ mt: 1 }}>
                  <LinearProgress
                    variant="determinate"
                    value={Math.max(0, Math.min(100, progress))}
                    aria-label={t.progress(progress)}
                    sx={{ height: 8, borderRadius: 4, backgroundColor: '#D1FAE5', '& .MuiLinearProgress-bar': { backgroundColor: '#16A34A', borderRadius: 4 } }}
                  />
                  <Typography sx={{ fontSize: '12px', color: '#475569', mt: 0.5, fontFamily: FONT }}>{t.progress(progress)}</Typography>
                </Box>
              )}
            </Box>

            {/* the driver comes before the route: the person following the trip needs to recognise the tricycle first. Picture, first name, the plate in large type and the number to call, exactly what the database sends (panel comment, D-P2) */}
            <Box sx={{ p: 1.75, borderRadius: '16px', border: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75 }}>
                <Avatar
                  src={trip.driver_has_photo ? `/api/share/${token}/driver-photo` : undefined}
                  alt={trip.driver_first_name ? `${t.driver} ${trip.driver_first_name}` : t.driver}
                  sx={{ width: 84, height: 84, flexShrink: 0, backgroundColor: '#FF6600', color: '#FFFFFF', fontWeight: 700, fontSize: '34px', fontFamily: FONT }}
                >
                  {trip.driver_first_name ? trip.driver_first_name.charAt(0).toUpperCase() : <PersonIcon sx={{ fontSize: 44 }} />}
                </Avatar>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: '14px', fontWeight: 600, color: '#475569', fontFamily: FONT, lineHeight: 1.3 }}>{t.driver}</Typography>
                  <Typography sx={{ fontSize: '24px', fontWeight: 700, color: '#0F172A', fontFamily: FONT, lineHeight: 1.25, overflowWrap: 'anywhere' }}>{trip.driver_first_name || '-'}</Typography>
                </Box>
              </Box>

              {/* the plate, the way it is read from the road: large, bold, boxed */}
              <Box>
                <Typography sx={{ fontSize: '14px', fontWeight: 600, color: '#475569', fontFamily: FONT, lineHeight: 1.3, mb: 0.5 }}>{t.plate}</Typography>
                <Box
                  aria-label={`${t.plate}: ${trip.plate_number || '-'}`}
                  sx={{ border: '3px solid #0F172A', borderRadius: '12px', backgroundColor: '#FEF9C3', py: 1, px: 1.5, textAlign: 'center' }}
                >
                  <Typography sx={{ fontSize: '36px', fontWeight: 800, color: '#0F172A', fontFamily: FONT, lineHeight: 1.15, letterSpacing: '0.06em', overflowWrap: 'anywhere' }}>
                    {trip.plate_number || '-'}
                  </Typography>
                </Box>
              </Box>

              {/* the driver's number, while the trip is on: one tap to call */}
              {!trip.ended && trip.driver_phone && (
                <Box>
                  <Typography sx={{ fontSize: '14px', fontWeight: 600, color: '#475569', fontFamily: FONT, lineHeight: 1.3, mb: 0.5 }}>{t.phone}</Typography>
                  <Button
                    component="a"
                    href={`tel:${trip.driver_phone}`}
                    startIcon={<PhoneIcon sx={{ fontSize: '26px !important' }} />}
                    aria-label={`${t.call} ${trip.driver_phone}`}
                    sx={{ width: '100%', minHeight: 56, borderRadius: '14px', textTransform: 'none', fontFamily: FONT, fontSize: '22px', fontWeight: 700, color: '#166534', backgroundColor: '#E6F4EA', '&:hover': { backgroundColor: '#D1EBD7' } }}
                  >
                    {trip.driver_phone}
                  </Button>
                </Box>
              )}
              {!trip.ended &&
                (pos ? (
                  <Typography sx={{ fontSize: '12.5px', color: stale ? '#B45309' : '#475569', fontFamily: FONT, lineHeight: 1.45 }}>
                    {pos.age_seconds < 90 ? t.updatedNow : t.updatedAgo(Math.max(1, Math.round(pos.age_seconds / 60)))}
                    {stale ? ` ${t.outdated}` : ''}
                  </Typography>
                ) : (
                  <Typography sx={{ fontSize: '12.5px', color: '#64748B', fontFamily: FONT }}>{t.noPosition}</Typography>
                ))}
            </Box>

            {/* the route */}
            <Box sx={{ p: 1.75, borderRadius: '16px', border: '1px solid #E2E8F0' }}>
              <RouteTimeline pickup={trip.pickup_address} destination={trip.dropoff_address} pickupLabel={t.pickup} destinationLabel={t.destination} />
            </Box>

            <Typography sx={{ fontSize: '11.5px', color: '#64748B', lineHeight: 1.5, fontFamily: FONT }}>{t.privacy}</Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default SharedTripView;
