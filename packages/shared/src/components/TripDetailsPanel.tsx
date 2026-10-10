import React, { useId, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Collapse from '@mui/material/Collapse';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import StarRoundedIcon from '@mui/icons-material/StarRounded';

import { RIDE_SHARING_CUTOFF_PERCENT } from '../config/policyConfig';
import type { BookingPhase, TripDetailsView } from '../utils/tripDetails';

interface TripDetailsPanelProps {
  /** From buildTripDetails(); the panel draws nothing for null */
  view: TripDetailsView | null;
  language: string;
  /** Collapsed by default so the map keeps the room; the header is the control that opens it, at every stage */
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** 'card' draws its own border and background; 'plain' sits inside a card that already has them */
  variant?: 'card' | 'plain';
}

const INK = '#0F172A';
const MUTED = '#475569'; // 7.6:1 on white (the lighter slate used elsewhere is below 4.5:1 for small text)
const ORANGE_TEXT = '#C2410C'; // brand orange that is readable as text (5.2:1 on white)

const TEXT = {
  en: {
    title: 'Trip details',
    pickup: 'Pickup',
    destination: 'Destination',
    notAvailable: 'Not available',
    status: 'Status',
    ride: 'Ride',
    solo: 'Solo',
    shared: 'Shared',
    passengers: (n: number) => `${n} ${n === 1 ? 'passenger' : 'passengers'}`,
    estimatedFare: 'Estimated fare',
    finalFare: 'Final fare',
    estimateNote: 'The final fare is set when the trip reaches the destination.',
    driver: 'Driver',
    passenger: 'Passenger',
    tricycle: 'Tricycle',
    franchise: 'Franchise',
    plate: 'Plate',
    sharedWaiting: `Matching continues while less than ${RIDE_SHARING_CUTOFF_PERCENT}% of the trip is done. If no one is matched, the Solo fare applies.`,
    sharedMatched: 'Another commuter is sharing this ride, so the fare is split.',
    sharedUnmatched: 'No one was matched, so the Solo fare applies.',
    phases: {
      searching: 'Finding a driver',
      assigned: 'Heading to the pickup point',
      arrived: 'At the pickup point',
      ongoing: 'Trip in progress',
      at_destination: 'Arrived at the destination',
      completed: 'Trip completed',
      cancelled: 'Cancelled',
      no_driver: 'No driver found',
    } satisfies Record<BookingPhase, string>,
  },
  tl: {
    title: 'Detalye ng biyahe',
    pickup: 'Pickup',
    destination: 'Destinasyon',
    notAvailable: 'Hindi available',
    status: 'Kalagayan',
    ride: 'Uri ng biyahe',
    solo: 'Solo',
    shared: 'Shared',
    passengers: (n: number) => `${n} pasahero`,
    estimatedFare: 'Tinatayang pamasahe',
    finalFare: 'Pinal na pamasahe',
    estimateNote: 'Itatakda ang pinal na pamasahe pagdating sa destinasyon.',
    driver: 'Drayber',
    passenger: 'Pasahero',
    tricycle: 'Tricycle',
    franchise: 'Franchise',
    plate: 'Plaka',
    sharedWaiting: `Tuloy ang paghahanap ng kasabay hangga't wala pang ${RIDE_SHARING_CUTOFF_PERCENT}% ng biyahe ang tapos. Kung walang makapares, Solo fare ang sisingilin.`,
    sharedMatched: 'May kasabay na commuter sa biyaheng ito, kaya hati ang pamasahe.',
    sharedUnmatched: 'Walang nakapares, kaya Solo fare ang sisingilin.',
    phases: {
      searching: 'Naghahanap ng drayber',
      assigned: 'Papunta sa pickup',
      arrived: 'Nasa pickup na',
      ongoing: 'Nasa biyahe',
      at_destination: 'Nasa destinasyon na',
      completed: 'Tapos na ang biyahe',
      cancelled: 'Kinansela',
      no_driver: 'Walang nahanap na drayber',
    } satisfies Record<BookingPhase, string>,
  },
};

const peso = (amount: number): string => `₱${amount.toFixed(2)}`;

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <Box sx={{ display: 'grid', gridTemplateColumns: '104px minmax(0, 1fr)', columnGap: 1.5, alignItems: 'baseline' }}>
    <Typography component="dt" sx={{ fontSize: '12px', fontWeight: 600, color: MUTED }}>
      {label}
    </Typography>
    <Box component="dd" sx={{ m: 0, minWidth: 0, fontSize: '14px', fontWeight: 600, color: INK, overflowWrap: 'anywhere' }}>
      {children}
    </Box>
  </Box>
);

/**
 * The compact Trip Details panel shared by the Passenger and Driver apps: the same pickup, destination, ride type, fare and stage for both
 * sides of one trip, collapsed by default, reachable at every stage from the finding of a driver to the end of the trip.
 */
const TripDetailsPanel: React.FC<TripDetailsPanelProps> = ({ view, language, defaultExpanded = false, onExpandedChange, variant = 'card' }) => {
  const [expanded, setExpanded] = useState<boolean>(defaultExpanded);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const baseId = useId();
  const headerId = `${baseId}-header`;
  const regionId = `${baseId}-region`;
  if (!view) return null;

  const t = language === 'tl' ? TEXT.tl : TEXT.en;
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    onExpandedChange?.(next);
  };

  const fareLabel = view.fare?.kind === 'final' ? t.finalFare : t.estimatedFare;
  const sharedNote =
    view.sharedOutcome === 'matched' ? t.sharedMatched : view.sharedOutcome === 'unmatched' ? t.sharedUnmatched : view.sharedOutcome === 'waiting' ? t.sharedWaiting : null;
  const vehicleText = view.vehicle
    ? [view.vehicle.franchiseNo && `${t.franchise} ${view.vehicle.franchiseNo}`, view.vehicle.plateNo && `${t.plate} ${view.vehicle.plateNo}`, view.vehicle.todaName]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <Box
      component="section"
      aria-labelledby={headerId}
      // flexShrink 0: inside a scrolling column the panel keeps its full height (the column scrolls); it must not be squeezed to fit
      sx={
        variant === 'card'
          ? { width: '100%', flexShrink: 0, borderRadius: '16px', border: '1px solid #E2E8F0', backgroundColor: '#F8FAFC', overflow: 'hidden' }
          : { width: '100%', flexShrink: 0 }
      }
    >
      <ButtonBase
        id={headerId}
        onClick={toggle}
        aria-expanded={expanded}
        aria-controls={regionId}
        sx={{
          width: '100%',
          minHeight: 52,
          px: variant === 'card' ? 2 : 0,
          py: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1.5,
          textAlign: 'left',
          borderRadius: variant === 'card' ? '16px' : '12px',
          '&.Mui-focusVisible': { outline: `3px solid ${ORANGE_TEXT}`, outlineOffset: '-3px' },
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: '14px', fontWeight: 700, color: INK, lineHeight: 1.3 }}>{t.title}</Typography>
          <Typography sx={{ fontSize: '12px', fontWeight: 500, color: MUTED, lineHeight: 1.3 }}>
            {view.rideType === 'Shared' ? t.shared : t.solo}
            {view.passengerCount > 1 ? ` · ${t.passengers(view.passengerCount)}` : ''}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          {view.fare && (
            <Box sx={{ textAlign: 'right' }}>
              <Typography sx={{ fontSize: '15px', fontWeight: 800, color: INK, lineHeight: 1.2 }}>{peso(view.fare.amount)}</Typography>
              <Typography sx={{ fontSize: '11px', fontWeight: 600, color: view.fare.kind === 'final' ? '#166534' : MUTED, lineHeight: 1.2 }}>{fareLabel}</Typography>
            </Box>
          )}
          <ExpandMoreIcon
            aria-hidden
            sx={{ fontSize: 24, color: MUTED, transform: expanded ? 'rotate(180deg)' : 'none', transition: reduceMotion ? 'none' : 'transform 0.2s ease' }}
          />
        </Box>
      </ButtonBase>

      <Collapse in={expanded} timeout={reduceMotion ? 0 : 'auto'} unmountOnExit>
        <Box
          id={regionId}
          role="region"
          aria-labelledby={headerId}
          sx={{ px: variant === 'card' ? 2 : 0, pb: 1.75, pt: 0.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}
        >
          {/* The route: both ends in full, wrapped (long place names must not push the screen sideways) */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {[
              { label: t.pickup, value: view.pickup, color: '#16A34A' },
              { label: t.destination, value: view.destination, color: '#DC2626' },
            ].map((end) => (
              <Box key={end.label} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
                <Box aria-hidden sx={{ mt: '5px', width: 12, height: 12, borderRadius: '50%', border: `3px solid ${end.color}`, flexShrink: 0 }} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: '12px', fontWeight: 600, color: MUTED, lineHeight: 1.3 }}>{end.label}</Typography>
                  <Typography sx={{ fontSize: '14px', fontWeight: 600, color: INK, lineHeight: 1.4, overflowWrap: 'anywhere' }}>
                    {end.value ?? t.notAvailable}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>

          <Box component="dl" sx={{ m: 0, display: 'flex', flexDirection: 'column', gap: 1, borderTop: '1px solid #E2E8F0', pt: 1.5 }}>
            <Row label={t.status}>{t.phases[view.phase]}</Row>
            {view.counterpart && (
              <Row label={view.counterpart.role === 'driver' ? t.driver : t.passenger}>
                {view.counterpart.name}
                {view.counterpart.rating !== null && (
                  <Box component="span" sx={{ ml: 0.75, display: 'inline-flex', alignItems: 'center', gap: 0.25, fontWeight: 700 }}>
                    <StarRoundedIcon aria-hidden sx={{ fontSize: 15, color: '#F59E0B' }} />
                    {view.counterpart.rating.toFixed(1)}
                  </Box>
                )}
              </Row>
            )}
            {vehicleText && <Row label={t.tricycle}>{vehicleText}</Row>}
            {view.fare && (
              <Row label={fareLabel}>
                <Box component="span" sx={{ fontWeight: 800 }}>
                  {peso(view.fare.amount)}
                </Box>
                {view.fare.kind === 'estimate' && (
                  <Typography sx={{ fontSize: '12px', fontWeight: 500, color: MUTED, lineHeight: 1.4 }}>{t.estimateNote}</Typography>
                )}
              </Row>
            )}
          </Box>

          {sharedNote && (
            <Typography
              sx={{ fontSize: '12px', fontWeight: 500, color: '#1E3A8A', lineHeight: 1.45, backgroundColor: '#EFF6FF', borderRadius: '10px', px: 1.25, py: 1 }}
            >
              {sharedNote}
            </Typography>
          )}
        </Box>
      </Collapse>
    </Box>
  );
};

export default TripDetailsPanel;
