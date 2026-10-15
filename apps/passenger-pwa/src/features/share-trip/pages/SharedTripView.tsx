import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Box, LinearProgress, Typography } from '@mui/material';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';

import { SHARE_TOKEN_PATTERN, fetchSharedTripView, type SharedTripView as SharedTrip } from '@sakay/shared';
import { supabase } from '../../../services/supabaseClient';
import { useLanguage } from '../../../utils/LanguageContext';

const POLL_MS = 5000;
const FONT = 'Poppins, sans-serif';

/**
 * Rule 26.1: what the person who received a Share Live Trip link sees. No account, no sign-in: the link is the only credential and the database answers only for a link that is still
 * live (until the trip ends + 15 minutes, never longer than 4 hours, and not switched off). It shows the status, the route, the driver's FIRST name, the plate and where the tricycle
 * is - nothing else: no passenger name, phone number or fare is ever sent to this page.
 */
const SharedTripView: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>();
  const { language } = useLanguage();
  const tl = language === 'tl';
  const valid = SHARE_TOKEN_PATTERN.test(token);
  const [trip, setTrip] = useState<SharedTrip | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!valid) return undefined;
    let alive = true;
    const read = async () => {
      const view = await fetchSharedTripView(supabase, token);
      if (!alive) return;
      setTrip(view);
      setLoaded(true);
    };
    void read();
    const timer = setInterval(() => void read(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [token, valid]);

  const gone = !valid || (loaded && !trip);
  const pos = trip?.driver_position ?? null;
  const progress = trip?.progress_pct ?? null;

  return (
    <Box sx={{ width: '100%', height: '100%', backgroundColor: '#FAFAFA', display: 'flex', flexDirection: 'column', overflowY: 'auto', p: 2.5, gap: 2, fontFamily: FONT }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <DirectionsCarIcon sx={{ color: '#FF6600' }} />
        <Typography sx={{ fontWeight: 700, fontSize: '18px', color: '#0F172A', fontFamily: FONT }}>{tl ? 'Ibinahaging biyahe sa SAKAY' : 'A trip shared on SAKAY'}</Typography>
      </Box>

      {!loaded && valid && <LinearProgress aria-label={tl ? 'Naglo-load' : 'Loading'} />}

      {gone && (
        <Box role="status" sx={{ p: 2, borderRadius: '16px', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0' }}>
          <Typography sx={{ fontWeight: 700, color: '#0F172A', fontFamily: FONT }}>{tl ? 'Tapos na ang link na ito' : 'This link has ended'}</Typography>
          <Typography sx={{ fontSize: '13px', color: '#475569', mt: 0.5, lineHeight: 1.5, fontFamily: FONT }}>
            {tl
              ? 'Gumagana lamang ang link ng ibinahaging biyahe habang tumatakbo ang biyahe at ilang minuto pagkatapos. Maaari kang humingi ng bago sa taong nagpadala nito.'
              : 'A shared-trip link works only while the trip is on and for a few minutes after. You can ask the person who sent it for a new one.'}
          </Typography>
        </Box>
      )}

      {trip && (
        <>
          <Box role="status" aria-live="polite" sx={{ p: 2, borderRadius: '16px', backgroundColor: trip.ended ? '#F1F5F9' : '#ECFDF5', border: `1px solid ${trip.ended ? '#CBD5E1' : '#A7F3D0'}` }}>
            <Typography sx={{ fontWeight: 700, fontSize: '16px', color: '#0F172A', fontFamily: FONT }}>{tl ? trip.status_tl : trip.status_en}</Typography>
            {progress !== null && (
              <Box sx={{ mt: 1 }}>
                <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, progress))} aria-label={tl ? 'Layo ng biyahe' : 'Trip progress'} sx={{ height: 8, borderRadius: 4 }} />
                <Typography sx={{ fontSize: '12px', color: '#475569', mt: 0.5, fontFamily: FONT }}>{progress}% {tl ? 'ng biyahe' : 'of the trip'}</Typography>
              </Box>
            )}
          </Box>

          <Box sx={{ p: 2, borderRadius: '16px', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography sx={{ fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', fontFamily: FONT }}>{tl ? 'Ruta' : 'Route'}</Typography>
            <Typography sx={{ fontSize: '14px', color: '#0F172A', fontFamily: FONT }}><b>{tl ? 'Mula:' : 'From:'}</b> {trip.pickup_address || '-'}</Typography>
            <Typography sx={{ fontSize: '14px', color: '#0F172A', fontFamily: FONT }}><b>{tl ? 'Papunta:' : 'To:'}</b> {trip.dropoff_address || '-'}</Typography>
          </Box>

          <Box sx={{ p: 2, borderRadius: '16px', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Typography sx={{ fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', fontFamily: FONT }}>{tl ? 'Tricycle at drayber' : 'Tricycle and driver'}</Typography>
            <Typography sx={{ fontSize: '14px', color: '#0F172A', fontFamily: FONT }}><b>{tl ? 'Drayber:' : 'Driver:'}</b> {trip.driver_first_name || '-'}</Typography>
            <Typography sx={{ fontSize: '14px', color: '#0F172A', fontFamily: FONT }}><b>{tl ? 'Plaka:' : 'Plate:'}</b> {trip.plate_number || '-'}</Typography>
            {pos ? (
              <Typography sx={{ fontSize: '13px', color: '#334155', fontFamily: FONT }}>
                {tl ? 'Huling lokasyon: ' : 'Last position: '}
                <a href={`https://www.openstreetmap.org/?mlat=${pos.lat}&mlon=${pos.lng}#map=17/${pos.lat}/${pos.lng}`} target="_blank" rel="noreferrer" style={{ color: '#2563EB', fontWeight: 600 }}>
                  {tl ? 'buksan sa mapa' : 'open on the map'}
                </a>
                {' · '}
                {pos.age_seconds < 90 ? (tl ? 'ngayon lang' : 'just now') : tl ? `${Math.round(pos.age_seconds / 60)} minuto ang nakalipas` : `${Math.round(pos.age_seconds / 60)} min ago`}
              </Typography>
            ) : (
              !trip.ended && <Typography sx={{ fontSize: '13px', color: '#64748B', fontFamily: FONT }}>{tl ? 'Wala pang lokasyon.' : 'No position yet.'}</Typography>
            )}
          </Box>

          <Typography sx={{ fontSize: '11.5px', color: '#64748B', lineHeight: 1.5, fontFamily: FONT }}>
            {tl
              ? 'Ang pahinang ito ay nag-a-update bawat ilang segundo. Walang pangalan ng pasahero, numero ng telepono o pamasahe dito.'
              : 'This page refreshes every few seconds. It never shows the passenger\'s name, phone number or fare.'}
          </Typography>
        </>
      )}
    </Box>
  );
};

export default SharedTripView;
