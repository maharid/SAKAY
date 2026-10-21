import React from 'react';
import { Box, Typography, Avatar, Chip } from '@mui/material';
import NavigationIcon from '@mui/icons-material/Navigation';
import PersonIcon from '@mui/icons-material/Person';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import RouteIcon from '@mui/icons-material/Route';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';

import type { BookingRecordItem } from '../../services/adminApiService';
import { formatManilaDateTime } from '@sakay/shared/utils/restrictionUtils';
import { MacCenterModal } from './MacCenterModal';
import { StatusBadge } from '../common/StatusBadge';
import { TripCorrectionSection } from './TripCorrectionSection';
import { TripRouteMap } from './TripRouteMap';

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
      title={`Trip Details — ${trip.id}`}
      subtitle={`Booking ID: ${trip.bookingId} • ${trip.todaName}`}
      badge={<StatusBadge status={trip.status as any} />}
      maxWidth={780}
    >
      {/* Top Status & Telemetry Bar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#FAFAFC',
          padding: '18px 24px',
          borderRadius: '12px',
          border: '1px solid var(--mac-border-color)',
          mb: 4,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: '12px',
              backgroundColor: trip.status === 'Trip Ongoing' ? 'rgba(21, 101, 192, 0.12)' : 'var(--sakay-orange-soft)',
              color: trip.status === 'Trip Ongoing' ? '#1565C0' : 'var(--sakay-orange)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <NavigationIcon fontSize="medium" />
          </Box>
          <Box>
            <Typography sx={{ fontSize: '14.4px', fontWeight: 700, color: 'var(--mac-text-primary)', lineHeight: 1.2 }}>
              {trip.status}
            </Typography>
            <Typography sx={{ fontSize: '10.8px', color: 'var(--mac-text-muted)', mt: '3px' }}>
              {trip.driverLat !== null && trip.driverLng !== null ? (
                <>
                  Driver GPS ({trip.driverLat.toFixed(5)}, {trip.driverLng.toFixed(5)}) at{' '}
                  <span style={{ fontWeight: 600, color: 'var(--mac-text-primary)' }}>{fmt(trip.driverFixAt)}</span>
                </>
              ) : (
                <>No live driver position for this booking</>
              )}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.8 }}>
          <Chip
            label={trip.tripType}
            size="small"
            sx={{
              fontSize: '10px',
              fontWeight: 700,
              backgroundColor: trip.tripType === 'Shared Trip' ? 'rgba(156, 39, 176, 0.12)' : 'rgba(52, 168, 83, 0.12)',
              color: trip.tripType === 'Shared Trip' ? '#9C27B0' : '#1E8E3E',
              height: 26,
            }}
          />
          <Typography sx={{ fontSize: '10.4px', fontWeight: 600, color: 'var(--sakay-orange)' }}>
            {trip.actualDistanceKm !== null ? `Recorded distance: ${km(trip.actualDistanceKm)}` : trip.estimatedDistanceKm !== null ? `Quoted distance: ${km(trip.estimatedDistanceKm)}` : 'Distance not recorded yet'}
          </Typography>
        </Box>
      </Box>

      {/* Section 1: Passenger Information */}
      <Box sx={{ mb: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 2 }}>
          <PersonIcon fontSize="small" sx={{ color: 'var(--sakay-orange)' }} />
          <Typography sx={{ fontSize: '10.4px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
            Passenger Booking Details
          </Typography>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2.5, backgroundColor: '#F5F5F7', padding: '20px', borderRadius: '12px' }}>
          <Box>
            <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)', mb: '4px' }}>Passenger Name</Typography>
            <Typography sx={{ fontSize: '11.6px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{trip.passengerName}</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)', mb: '4px' }}>Mobile Contact</Typography>
            <Typography sx={{ fontSize: '11.6px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{trip.passengerPhone}</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)', mb: '4px' }}>Declared Passengers</Typography>
            <Typography sx={{ fontSize: '11.6px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{trip.passengerCount} Commuter(s)</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)', mb: '4px' }}>Booking Request Time</Typography>
            <Typography sx={{ fontSize: '11.6px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{trip.bookingTime}</Typography>
          </Box>
        </Box>
      </Box>

      {/* Section 2: Driver & Vehicle Credentials */}
      <Box sx={{ mb: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 2 }}>
          <DirectionsCarIcon fontSize="small" sx={{ color: 'var(--sakay-orange)' }} />
          <Typography sx={{ fontSize: '10.4px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
            Assigned Driver & Tricycle Unit
          </Typography>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2.5, backgroundColor: '#F5F5F7', padding: '20px', borderRadius: '12px' }}>
          <Box>
            <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)', mb: '4px' }}>Driver Name</Typography>
            <Typography sx={{ fontSize: '11.6px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{trip.driverName}</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)', mb: '4px' }}>Driver Contact</Typography>
            <Typography sx={{ fontSize: '11.6px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{trip.driverPhone}</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)', mb: '4px' }}>Affiliated TODA</Typography>
            <Typography sx={{ fontSize: '11.6px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{trip.todaName}</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)', mb: '4px' }}>Vehicle Plate No.</Typography>
            <Typography sx={{ fontSize: '11.6px', fontWeight: 700, color: 'var(--sakay-orange)' }}>{trip.vehiclePlate}</Typography>
          </Box>
        </Box>
      </Box>

      {/* Section 3: Route & Fare Matrix Breakdown */}
      <Box sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 2 }}>
          <RouteIcon fontSize="small" sx={{ color: 'var(--sakay-orange)' }} />
          <Typography sx={{ fontSize: '10.4px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
            Route & Fare Matrix Computation
          </Typography>
        </Box>

        <Box sx={{ backgroundColor: '#F5F5F7', padding: '20px', borderRadius: '12px' }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2.5, mb: 2.5 }}>
            <Box>
              <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)', mb: '4px' }}>Pickup Point</Typography>
              <Typography sx={{ fontSize: '11.6px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{trip.pickupArea}</Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)', mb: '4px' }}>Destination Point</Typography>
              <Typography sx={{ fontSize: '11.6px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{trip.destinationArea}</Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFFFFF', padding: '16px 20px', borderRadius: '10px', border: '1px solid var(--mac-border-color)' }}>
            <Box>
              <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)', mb: '2px' }}>Estimated Cash Fare (confirmed by the passenger)</Typography>
              <Typography sx={{ fontSize: '19.3px', fontWeight: 700, color: 'var(--sakay-orange)' }}>
                ₱{Number(trip.estimatedFare).toFixed(2)}
              </Typography>
              {trip.finalFare !== null && trip.finalFare !== undefined && (
                <>
                  <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)', mt: '8px', mb: '2px' }}>Final Fare (computed by the system, binding)</Typography>
                  <Typography sx={{ fontSize: '19.3px', fontWeight: 700, color: '#1E8E3E' }}>
                    ₱{Number(trip.finalFare).toFixed(2)}
                  </Typography>
                  {trip.fareBasis === 'unmatched_solo' && (
                    <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)', mt: '2px' }}>
                      Shared booking with no matched passenger: billed as a Solo Trip.
                    </Typography>
                  )}
                  {trip.fareDeviation && (
                    <Typography sx={{ fontSize: '9.6px', color: '#C25E00', mt: '2px' }}>
                      Route deviation recorded: the fare follows the actual distance travelled.
                    </Typography>
                  )}
                </>
              )}
            </Box>

            {trip.sharedTripDetails && (
              <Box sx={{ textAlign: 'right' }}>
                <Typography sx={{ fontSize: '10px', fontWeight: 600, color: '#9C27B0' }}>
                  Ride-Sharing Allocation Active
                </Typography>
                <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)', mt: '2px' }}>
                  {trip.sharedTripDetails.sharedSavings}
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
      </Box>

      {/* Section 4: what happened and when (Rule 16.2: timestamps, distance and duration are recorded automatically) */}
      <Box sx={{ mb: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 2 }}>
          <AccessTimeIcon fontSize="small" sx={{ color: 'var(--sakay-orange)' }} />
          <Typography sx={{ fontSize: '10.4px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
            Timeline, Distance & Duration
          </Typography>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2.5, backgroundColor: '#F5F5F7', padding: '20px', borderRadius: '12px' }}>
          {timeline.map(([label, at]) => (
            <Box key={label}>
              <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)', mb: '4px' }}>{label}</Typography>
              <Typography sx={{ fontSize: '11.6px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{fmt(at)}</Typography>
            </Box>
          ))}
          {(cancelled || trip.cancelledAt) && (
            <Box>
              <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)', mb: '4px' }}>Cancelled</Typography>
              <Typography sx={{ fontSize: '11.6px', fontWeight: 600, color: '#B91C1C' }}>{fmt(trip.cancelledAt)}</Typography>
            </Box>
          )}
          <Box>
            <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)', mb: '4px' }}>Quoted road distance</Typography>
            <Typography sx={{ fontSize: '11.6px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{km(trip.estimatedDistanceKm)}</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)', mb: '4px' }}>Distance recorded by the driver's phone</Typography>
            <Typography sx={{ fontSize: '11.6px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{km(trip.actualDistanceKm)}</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)', mb: '4px' }}>Trip duration (start to completion)</Typography>
            <Typography sx={{ fontSize: '11.6px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{tripMinutes === null ? '\u2014' : `${tripMinutes} min`}</Typography>
          </Box>
          {trip.fareDeviation && (
            <Box>
              <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)', mb: '4px' }}>Route deviation (Rule 6.2.4)</Typography>
              <Typography sx={{ fontSize: '11.6px', fontWeight: 600, color: '#C25E00' }}>Recorded: the fare follows the distance travelled</Typography>
            </Box>
          )}
        </Box>
      </Box>

      {(cancelled || noDriver) && (
        <Box sx={{ mb: 4 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 2 }}>
            <NavigationIcon fontSize="small" sx={{ color: '#B91C1C' }} />
            <Typography sx={{ fontSize: '10.4px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
              {noDriver ? 'No Driver Found' : 'Cancellation'}
            </Typography>
          </Box>
          <Box sx={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA', padding: '16px 20px', borderRadius: '12px' }}>
            {noDriver ? (
              <Typography sx={{ fontSize: '11.6px', color: '#7F1D1D' }}>Every eligible driver declined, did not answer, or none was available. No strike applies to anyone (Rule 7.4).</Typography>
            ) : (
              <>
                <Typography sx={{ fontSize: '11.6px', fontWeight: 600, color: '#7F1D1D' }}>
                  Cancelled by {trip.cancelledBy ?? 'unknown'}{trip.cancelledAt ? ` on ${fmt(trip.cancelledAt)}` : ''}
                </Typography>
                <Typography sx={{ fontSize: '11.6px', color: '#7F1D1D', mt: '4px' }}>
                  Reason: {trip.cancellationReason ?? 'none was recorded'}
                </Typography>
              </>
            )}
          </Box>
        </Box>
      )}

      {/* Section 5: the route the driver's phone recorded */}
      {trip.driverId && (
        <Box sx={{ mb: 4 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 2 }}>
            <RouteIcon fontSize="small" sx={{ color: 'var(--sakay-orange)' }} />
            <Typography sx={{ fontSize: '10.4px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
              Route Recorded by the Driver's Phone
            </Typography>
          </Box>
          <TripRouteMap bookingId={trip.bookingId} pickupLat={trip.startLat} pickupLng={trip.startLng} destLat={trip.destLat} destLng={trip.destLng} />
        </Box>
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
