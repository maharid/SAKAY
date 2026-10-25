import React from 'react';
import { Box, Typography } from '@mui/material';

import type { BookingRecordItem } from '../../services/adminApiService';
import { formatManilaDateTime } from '@sakay/shared/utils/restrictionUtils';
import { MacCenterModal } from './MacCenterModal';
import { StatusBadge } from '../common/StatusBadge';
import { FlagTag } from '../common/DataTable';
import { DetailField, DetailGrid, DetailSection } from '../common/DetailSection';
import { TripCorrectionSection } from './TripCorrectionSection';
import { TripRouteMap } from './TripRouteMap';
import { FONT } from '../../styles/density';
import { PAGE_BORDER, PAGE_TEXT } from '../../styles/pageTheme';

interface TripDetailModalProps {
  open: boolean;
  onClose: () => void;
  trip: BookingRecordItem | null;
  /** a completed trip was corrected, or a trip left at the destination was closed: the page reloads */
  onChanged?: () => void | Promise<void>;
}

export const TripDetailModal: React.FC<TripDetailModalProps> = ({ open, onClose, trip, onChanged }) => {
  if (!trip) return null;

  const fmt = (iso: string | null): string => (iso ? formatManilaDateTime(iso) : '\u2014');
  const minutesBetween = (a: string | null, b: string | null): number | null =>
    a && b && Number.isFinite(Date.parse(a)) && Number.isFinite(Date.parse(b)) ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000)) : null;
  const tripMinutes = minutesBetween(trip.startedAt, trip.completedAt);
  const km = (v: number | null): string => (v === null ? '\u2014' : `${v.toFixed(2)} km`);
  const cancelled = trip.status.includes('Cancel');
  const noDriver = trip.status === 'No Driver Found';
  const timeline: Array<[string, string | null]> = [
    ['Booking requested', trip.requestedAt],
    ['Driver accepted', trip.acceptedAt],
    ['Driver arrived at pickup', trip.arrivedAt],
    ['Trip started', trip.startedAt],
    ['Trip completed', trip.completedAt],
  ];

  return (
    <MacCenterModal
      open={open}
      onClose={onClose}
      title={`Trip details: ${trip.id}`}
      subtitle={`Booking ID: ${trip.bookingId} · ${trip.todaName}`}
      badge={<StatusBadge status={trip.status as any} />}
      maxWidth={624}
    >
      {/* Where the trip stands now */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px 16px',
          backgroundColor: '#FAFAF8',
          padding: '12px 16px',
          borderRadius: '12px',
          border: `1px solid ${PAGE_BORDER}`,
          mb: '20px',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: PAGE_TEXT.primary, lineHeight: 1.2 }}>{trip.status}</Typography>
          <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '2px' }}>
            {trip.driverLat !== null && trip.driverLng !== null ? (
              <>
                Driver GPS ({trip.driverLat.toFixed(5)}, {trip.driverLng.toFixed(5)}) at{' '}
                <Box component="span" sx={{ fontWeight: 600, color: PAGE_TEXT.primary }}>{fmt(trip.driverFixAt)}</Box>
              </>
            ) : (
              <>No live driver position for this booking</>
            )}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
          <FlagTag label={trip.tripType} tone={trip.tripType === 'Shared Trip' ? 'warning' : 'success'} />
          <Typography sx={{ fontSize: FONT.small, fontWeight: 600, color: PAGE_TEXT.brand }}>
            {trip.actualDistanceKm !== null ? `Recorded distance: ${km(trip.actualDistanceKm)}` : trip.estimatedDistanceKm !== null ? `Quoted distance: ${km(trip.estimatedDistanceKm)}` : 'Distance not recorded yet'}
          </Typography>
        </Box>
      </Box>

      <DetailSection title="Passenger">
        <DetailGrid>
          <DetailField label="Name">{trip.passengerName}</DetailField>
          <DetailField label="Mobile number">{trip.passengerPhone}</DetailField>
          <DetailField label="Passengers declared">{trip.passengerCount} {trip.passengerCount === 1 ? 'commuter' : 'commuters'}</DetailField>
          <DetailField label="Booking requested">{trip.bookingTime}</DetailField>
        </DetailGrid>
      </DetailSection>

      <DetailSection title="Driver and tricycle">
        <DetailGrid>
          <DetailField label="Name">{trip.driverName}</DetailField>
          <DetailField label="Mobile number">{trip.driverPhone}</DetailField>
          <DetailField label="TODA">{trip.todaName}</DetailField>
          <DetailField label="Plate number">
            <Box component="span" sx={{ color: PAGE_TEXT.brand, fontWeight: 700 }}>{trip.vehiclePlate}</Box>
          </DetailField>
        </DetailGrid>
      </DetailSection>

      <DetailSection title="Route and fare">
        <DetailGrid>
          <DetailField label="Pickup">{trip.pickupArea}</DetailField>
          <DetailField label="Destination">{trip.destinationArea}</DetailField>
        </DetailGrid>

        <Box sx={{ mt: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px 16px', backgroundColor: '#FFFFFF', padding: '12px 16px', borderRadius: '12px', border: `1px solid ${PAGE_BORDER}` }}>
          <Box>
            <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mb: '2px' }}>Estimated cash fare (confirmed by the passenger)</Typography>
            <Typography sx={{ fontSize: FONT.sectionTitle, fontWeight: 700, color: PAGE_TEXT.brand }}>₱{Number(trip.estimatedFare).toFixed(2)}</Typography>
            {trip.finalFare !== null && trip.finalFare !== undefined && (
              <>
                <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '8px', mb: '2px' }}>Final fare (computed by the system, binding)</Typography>
                <Typography sx={{ fontSize: FONT.sectionTitle, fontWeight: 700, color: PAGE_TEXT.success }}>₱{Number(trip.finalFare).toFixed(2)}</Typography>
                {trip.fareBasis === 'unmatched_solo' && (
                  <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '2px' }}>
                    Shared booking with no matched passenger: billed as a Solo Trip.
                  </Typography>
                )}
                {trip.fareDeviation && (
                  <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.warning, mt: '2px' }}>
                    Route deviation recorded: the fare follows the actual distance travelled.
                  </Typography>
                )}
              </>
            )}
          </Box>

          {trip.sharedTripDetails && (
            <Box sx={{ textAlign: 'right' }}>
              <Typography sx={{ fontSize: FONT.small, fontWeight: 600, color: PAGE_TEXT.primary }}>Ride-sharing allocation active</Typography>
              <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '2px' }}>{trip.sharedTripDetails.sharedSavings}</Typography>
            </Box>
          )}
        </Box>
      </DetailSection>

      {/* What happened and when (Rule 16.2: timestamps, distance and duration are recorded automatically) */}
      <DetailSection title="Timeline, distance and duration">
        <DetailGrid>
          {timeline.map(([label, at]) => (
            <DetailField key={label} label={label}>{fmt(at)}</DetailField>
          ))}
          {(cancelled || trip.cancelledAt) && (
            <DetailField label="Cancelled">
              <Box component="span" sx={{ color: PAGE_TEXT.danger }}>{fmt(trip.cancelledAt)}</Box>
            </DetailField>
          )}
          <DetailField label="Quoted road distance">{km(trip.estimatedDistanceKm)}</DetailField>
          <DetailField label="Distance recorded by the driver's phone">{km(trip.actualDistanceKm)}</DetailField>
          <DetailField label="Trip duration (start to completion)">{tripMinutes === null ? '\u2014' : `${tripMinutes} min`}</DetailField>
          {trip.fareDeviation && (
            <DetailField label="Route deviation">
              <Box component="span" sx={{ color: PAGE_TEXT.warning }}>Recorded: the fare follows the distance travelled</Box>
            </DetailField>
          )}
        </DetailGrid>
      </DetailSection>

      {(cancelled || noDriver) && (
        <DetailSection title={noDriver ? 'No driver found' : 'Cancellation'}>
          <Box sx={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA', padding: '12px 16px', borderRadius: '12px' }}>
            {noDriver ? (
              <Typography sx={{ fontSize: FONT.body, color: '#7F1D1D' }}>Every eligible driver declined, did not answer, or none was available. No strike applies to anyone.</Typography>
            ) : (
              <>
                <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: '#7F1D1D' }}>
                  Cancelled by {trip.cancelledBy ?? 'unknown'}{trip.cancelledAt ? ` on ${fmt(trip.cancelledAt)}` : ''}
                </Typography>
                <Typography sx={{ fontSize: FONT.body, color: '#7F1D1D', mt: '3px' }}>
                  Reason: {trip.cancellationReason ?? 'none was recorded'}
                </Typography>
              </>
            )}
          </Box>
        </DetailSection>
      )}

      {/* The route the driver's phone recorded */}
      {trip.driverId && (
        <DetailSection title="Route recorded by the driver's phone">
          <TripRouteMap bookingId={trip.bookingId} pickupLat={trip.startLat} pickupLng={trip.startLng} destLat={trip.destLat} destLng={trip.destLng} />
        </DetailSection>
      )}

      {/* Rule 16.3 / PI-15: the audited correction of a completed trip, and closing a trip the driver never finished */}
      <TripCorrectionSection
        bookingId={trip.bookingId}
        status={trip.status}
        finalFare={trip.finalFare}
        paymentStatus={trip.paymentStatus}
        onChanged={async () => {
          await onChanged?.();
          onClose();
        }}
      />
    </MacCenterModal>
  );
};
