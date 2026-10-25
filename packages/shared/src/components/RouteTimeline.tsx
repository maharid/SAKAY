import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import PlaceIcon from '@mui/icons-material/Place';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';

export interface RouteTimelineProps {
  pickup: string | null | undefined;
  destination: string | null | undefined;
  pickupLabel: string;
  destinationLabel: string;
  /** Shown under the destination address in a quieter line (for example the city) */
  destinationNote?: string;
  /** What to write when an address is missing */
  missingText?: string;
  /** For panels that must leave the map visible: smaller type, and an address longer than two lines is cut with "..." (the full text is still the element's title) */
  compact?: boolean;
  /** Which end the vehicle is heading for now; the other end is drawn quieter. Leave out to draw both the same. */
  current?: 'pickup' | 'destination';
}

const ORANGE = '#FF6600';
const INK = '#0F172A';
const MUTED = '#64748B';
// the dotted line between the two ends, as on the trip details screen
const CONNECTOR = '#FFD8BE';

/**
 * The pickup and the destination of a trip as the trip details screen draws them: a hollow orange ring at the pickup, a dotted line, an orange pin at the
 * destination, and each address in full beside its end (wrapped, so a long place name never pushes the layout sideways). The Passenger and Driver apps use
 * this one drawing wherever both ends of a trip are shown, so the booking, the search, the active trip and the history all read the same.
 */
export const RouteTimeline: React.FC<RouteTimelineProps> = ({ pickup, destination, pickupLabel, destinationLabel, destinationNote, missingText = '-', compact = false, current }) => {
  const stop = (key: 'pickup' | 'destination', label: string, address: string | null | undefined, note?: string) => {
    const quiet = current !== undefined && current !== key;
    const text = (address ?? '').trim() || missingText;
    return (
      <Box sx={{ display: 'flex', alignItems: 'stretch', gap: compact ? 1.25 : 1.75 }}>
        <Box aria-hidden sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 20, flexShrink: 0, pt: '1px' }}>
          {key === 'pickup' ? (
            <>
              <RadioButtonUncheckedIcon sx={{ fontSize: 18, color: ORANGE, opacity: quiet ? 0.55 : 1 }} />
              <Box sx={{ flex: 1, minHeight: compact ? 14 : 20, borderLeft: `2px dotted ${CONNECTOR}`, my: 0.5 }} />
            </>
          ) : (
            <PlaceIcon sx={{ fontSize: 20, color: ORANGE, opacity: quiet ? 0.55 : 1 }} />
          )}
        </Box>
        <Box sx={{ minWidth: 0, flex: 1, pb: key === 'pickup' ? (compact ? 0.75 : 1.5) : 0 }}>
          <Typography sx={{ fontSize: '12px', fontWeight: 700, color: MUTED, lineHeight: 1.3 }}>{label}</Typography>
          <Typography
            title={text}
            sx={{
              fontSize: compact ? '13px' : '14px',
              fontWeight: 700,
              color: quiet ? '#475569' : INK,
              lineHeight: 1.35,
              overflowWrap: 'anywhere',
              ...(compact ? { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : {}),
            }}
          >
            {text}
          </Typography>
          {note && <Typography sx={{ fontSize: '12px', color: MUTED, lineHeight: 1.35 }}>{note}</Typography>}
        </Box>
      </Box>
    );
  };

  return (
    <Box role="group" sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {stop('pickup', pickupLabel, pickup)}
      {stop('destination', destinationLabel, destination, destinationNote)}
    </Box>
  );
};

export default RouteTimeline;
