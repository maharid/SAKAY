import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import PlaceIcon from '@mui/icons-material/Place';
import StraightenOutlinedIcon from '@mui/icons-material/StraightenOutlined';

import { formatTripDistance } from '../utils/tripStatus';

export interface TripRouteProps {
  pickup: string;
  dropoff: string;
  /** One line each, cut with an ellipsis (a list); otherwise the whole address, wrapping (a detail screen) */
  truncate?: boolean;
  /** Writes "Pickup location" and "Drop-off location" above the addresses (a detail screen) */
  labelled?: boolean;
  /**
   * The distance the trip record holds, in kilometres, shown as "Total distance". Left out, no distance row is drawn; null, zero or unreadable says "Not recorded": the distance is never
   * worked out or guessed here.
   */
  distanceKm?: number | null;
  language?: 'en' | 'tl';
}

const MARKER = 20;

// read out by a screen reader, not drawn: the markers say which end is which to the eye
const HIDDEN: React.CSSProperties = { position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 };

const addressSx = (truncate: boolean) =>
  ({
    fontSize: '14px',
    fontWeight: 600,
    color: '#0F172A',
    fontFamily: 'Poppins, sans-serif',
    lineHeight: '20px',
    minWidth: 0,
    ...(truncate ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : { overflowWrap: 'anywhere' }),
  }) as const;

const labelSx = { fontSize: '12px', fontWeight: 700, color: '#64748B', fontFamily: 'Poppins, sans-serif', lineHeight: '16px' } as const;

/**
 * Where a trip started and where it ended, the same on the Passenger and the Driver app: a hollow ring for the pickup and a pin for the drop-off (SAKAY orange), joined by a dotted
 * line, each with its address and, on a detail screen, its name and the total distance of the trip as it was recorded.
 */
export const TripRoute: React.FC<TripRouteProps> = ({ pickup, dropoff, truncate = false, labelled = false, distanceKm, language = 'en' }) => {
  const tl = language === 'tl';
  const pickupName = tl ? 'Pinanggalingan' : 'Pickup location';
  const dropoffName = tl ? 'Destinasyon' : 'Drop-off location';
  const distance = distanceKm === undefined ? undefined : formatTripDistance(distanceKm);
  const address = (name: string, text: string) => (
    <Box sx={{ minWidth: 0, flex: 1 }}>
      {labelled && <Typography sx={labelSx}>{name}</Typography>}
      <Typography title={truncate ? text : undefined} sx={addressSx(truncate)}>
        {!labelled && <span style={HIDDEN}>{name}: </span>}
        {text}
      </Typography>
    </Box>
  );
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: labelled ? '14px' : '10px', minWidth: 0 }}>
      <Box sx={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: '12px', minWidth: 0, '&::after': { content: '""', position: 'absolute', left: `${MARKER / 2 - 1}px`, top: `${MARKER + (labelled ? 17 : 1)}px`, bottom: labelled ? '-13px' : '-9px', borderLeft: '2px dotted #FFD8BE' } }}>
        <Box aria-hidden sx={{ width: MARKER, height: MARKER, flexShrink: 0, mt: labelled ? '14px' : 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Box sx={{ width: 14, height: 14, borderRadius: '50%', border: '3px solid #FF6600', backgroundColor: '#FFFFFF', boxSizing: 'border-box' }} />
        </Box>
        {address(pickupName, pickup)}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '12px', minWidth: 0 }}>
        <Box aria-hidden sx={{ width: MARKER, height: MARKER, flexShrink: 0, mt: labelled ? '14px' : 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <PlaceIcon sx={{ fontSize: 22, color: '#FF6600' }} />
        </Box>
        {address(dropoffName, dropoff)}
      </Box>
      {distance !== undefined && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, pt: '12px', borderTop: '1px solid #EEF1F5' }}>
          <Box aria-hidden sx={{ width: MARKER, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
            <StraightenOutlinedIcon sx={{ fontSize: 20, color: '#FF6600' }} />
          </Box>
          <Typography sx={{ flex: 1, minWidth: 0, fontSize: '13px', color: '#475569', fontFamily: 'Poppins, sans-serif' }}>{tl ? 'Kabuuang layo ng biyahe' : 'Total distance'}</Typography>
          <Typography sx={{ fontSize: '14px', fontWeight: 700, color: distance ? '#0F172A' : '#64748B', fontFamily: 'Poppins, sans-serif', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
            {distance ?? (tl ? 'Hindi naitala' : 'Not recorded')}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default TripRoute;
