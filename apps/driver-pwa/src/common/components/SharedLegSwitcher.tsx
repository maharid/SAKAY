import React, { useEffect, useState } from 'react';
import { Box, Chip } from '@mui/material';
import { useNavigate } from 'react-router-dom';

import { fetchDriverOpenBookings, legStageOf, type DriverOpenBooking, type LegStage } from '../../services/openBookingService';
import { useLanguage } from '../../utils/LanguageContext';

const POLL_MS = 4000;

const STAGE_LABEL: Record<LegStage, { en: string; tl: string }> = {
  on_the_way: { en: 'on the way to pickup', tl: 'papunta sa pickup' },
  at_pickup: { en: 'at pickup', tl: 'nasa pickup' },
  on_board: { en: 'on board', tl: 'nakasakay' },
  at_destination: { en: 'at destination', tl: 'nasa destinasyon' },
};

interface SharedLegSwitcherProps {
  /** The booking this screen shows */
  bookingId: string;
  /** Floating variant: the CSS `top` of an absolutely placed bar (the navigation screen); without it the bar sits in the flow of the page */
  top?: string;
}

/**
 * On a Shared Trip (Section 14) the driver carries two bookings, one per passenger, and each is its own trip with its own rules (Rule 14.6). This bar lets him go
 * from one leg to the other; it appears only while he has two open bookings and shows nothing on an ordinary trip.
 */
export const SharedLegSwitcher: React.FC<SharedLegSwitcherProps> = ({ bookingId, top }) => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const tl = language === 'tl';
  const [legs, setLegs] = useState<DriverOpenBooking[]>([]);

  useEffect(() => {
    let stopped = false;
    const read = async () => {
      const found = await fetchDriverOpenBookings();
      if (!stopped) setLegs((prev) => (prev.length === found.length && prev.every((p, i) => p.bookingId === found[i].bookingId && p.status === found[i].status) ? prev : found));
    };
    void read();
    const timer = setInterval(read, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  if (legs.length < 2) return null;
  return (
    <Box
      role="tablist"
      aria-label={tl ? 'Mga pasahero ng shared trip' : 'The passengers of this shared trip'}
      sx={{
        display: 'flex',
        gap: 1,
        flexWrap: 'wrap',
        ...(top !== undefined ? { position: 'absolute', top, left: 16, right: 16, zIndex: 29 } : { py: 0.5 }),
      }}
    >
      {legs.map((leg, i) => {
        const current = leg.bookingId === bookingId;
        const stage = STAGE_LABEL[legStageOf(leg.status)];
        return (
          <Chip
            key={leg.bookingId}
            role="tab"
            aria-selected={current}
            label={`${tl ? 'Pasahero' : 'Passenger'} ${i + 1}: ${tl ? stage.tl : stage.en}`}
            color={current ? 'primary' : 'default'}
            variant={current ? 'filled' : 'outlined'}
            onClick={current ? undefined : () => navigate(leg.route, { replace: true, state: { bookingId: leg.bookingId } })}
            sx={{ fontWeight: 700, fontSize: '12px', backgroundColor: current ? undefined : 'rgba(255,255,255,0.92)' }}
          />
        );
      })}
    </Box>
  );
};

export default SharedLegSwitcher;
