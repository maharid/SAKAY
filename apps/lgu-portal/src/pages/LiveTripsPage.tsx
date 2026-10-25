import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Button, TableBody, TableCell, TableRow, Typography } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import appIconToto from '@sakay/shared/assets/icons/app-icon-toto.webp';

import { FilterToolbar, FilterOption } from '../components/admin/FilterToolbar';
import { StatusBadge } from '../components/common/StatusBadge';
import { TripDetailModal } from '../components/admin/TripDetailModal';
import { DispatchSettingsCard } from '../components/admin/DispatchSettingsCard';
import { CellStack, DataTableCard, DataTableMessageRow } from '../components/common/DataTable';
import { StatStrip } from '../components/common/StatStrip';
import { DashboardCard } from '../components/dashboard/DashboardCard';
import { fetchAllBookings, BookingRecordItem, fetchTripsNeedingReconciliation, reconcileTrip, fetchFareDisputes, resolveFareDispute, endTripSafely, signLguCaseEvidence } from '../services/adminApiService';
import { FareDisputesPanel, SafetyEndTripPanel, TripReconciliationPanel } from '@sakay/shared';
import type { FareDisputeRow } from '@sakay/shared';
import type { ReconciliationTrip } from '@sakay/shared';
import { hasRoutablePlaces, roadBetween } from '../utils/tripRoutes';
import type { LatLng } from '../utils/tripRoutes';
import { FONT } from '../styles/density';
import { PAGE_BORDER, PAGE_TEXT, rowActionSx } from '../styles/pageTheme';

/** A position older than this is drawn grey: the phone is not reporting any more (the policy treats 3 minutes of silence as Driver Unreachable) */
const LIVE_FIX_STALE_SECONDS = 90;

const escapeHtml = (v: string): string =>
  v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** The name of each list the numbers above the table pick, as a heading and as "no ... recorded" */
const LIST_NAMES = {
  Active: { heading: 'Active trips', none: 'active trips' },
  Completed: { heading: 'Completed trips', none: 'completed trips' },
  Cancelled: { heading: 'Cancelled bookings', none: 'cancelled bookings' },
  All: { heading: 'All bookings', none: 'bookings' },
} as const;

/**
 * ============================================================================
 * LIVE OPERATIONS & TRIP MONITORING PAGE (LiveTripsPage.tsx)
 * ============================================================================
 * Checklist Scope:
 *   ● Monitor Transportation Operations
 *     ○ View active trips
 *     ○ View completed trips
 *     ○ View cancelled bookings
 *     ○ Monitor ongoing trips
 * ============================================================================
 */
export const LiveTripsPage: React.FC = () => {
  const [bookings, setBookings] = useState<BookingRecordItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'Active' | 'Completed' | 'Cancelled' | 'All'>('Active');
  const [searchQuery, setSearchQuery] = useState('');
  const [todaFilter, setTodaFilter] = useState('All');
  const [selectedTrip, setSelectedTrip] = useState<any | null>(null);

  // Map references
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const framedRef = useRef(false);
  // counts the roads that have just arrived (or failed), so the map is drawn again with them
  const [routeTick, setRouteTick] = useState(0);
  const redrawRoutes = useCallback(() => setRouteTick((n) => n + 1), []);

  const loadTrips = async () => {
    setIsLoading(true);
    try {
      const data = await fetchAllBookings();
      setBookings(data);
    } catch (err) {
      console.error('[LiveTripsPage] Failed to fetch bookings:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Rule 9.5: trips whose driver has been silent for 30 minutes wait here for an administrator to phone the parties and close them
  const [reconTrips, setReconTrips] = useState<ReconciliationTrip[]>([]);
  const loadReconciliation = async () => setReconTrips(await fetchTripsNeedingReconciliation());
  // Rules 13.5 / 18.4 / 18.6: the fare disputes the LGU Administrator decides (escalated by a TODA Administrator, or with no TODA): 3 business days
  const [fareDisputes, setFareDisputes] = useState<FareDisputeRow[]>([]);
  const loadFareDisputes = async () => setFareDisputes(await fetchFareDisputes());

  useEffect(() => {
    loadTrips();
    loadReconciliation();
    loadFareDisputes();
    const interval = setInterval(() => {
      loadTrips();
      loadReconciliation();
      loadFareDisputes();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  // Categorize bookings
  // Active = a booking that is not finished: still searching for a driver (Pending), or a driver is committed to it
  const activeTrips = bookings.filter((b) =>
    [
      'Pending',
      'Searching Driver',
      'Accepted',
      'Driver Assigned',
      'Driver En Route',
      'In Transit',
      'Arrived at Pickup',
      'Driver Arrived',
      'Trip Ongoing',
      'Heading to Passenger',
      'Arrived at Destination',
    ].includes(b.status)
  );
  const completedTrips = bookings.filter((b) => b.status === 'Completed');
  const cancelledTrips = bookings.filter((b) => (b.status || '').toLowerCase().includes('cancel') || b.status === 'No Driver Found');

  // Filter based on active tab and search
  const currentList =
    activeTab === 'Active'
      ? activeTrips
      : activeTab === 'Completed'
      ? completedTrips
      : activeTab === 'Cancelled'
      ? cancelledTrips
      : bookings;

  const filteredTrips = currentList.filter((t) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      t.id.toLowerCase().includes(q) ||
      t.bookingId.toLowerCase().includes(q) ||
      t.driverName.toLowerCase().includes(q) ||
      t.passengerName.toLowerCase().includes(q) ||
      t.vehiclePlate.toLowerCase().includes(q) ||
      t.pickupArea.toLowerCase().includes(q) ||
      t.destinationArea.toLowerCase().includes(q);

    const matchesToda = todaFilter === 'All' || t.todaName === todaFilter;
    return matchesSearch && matchesToda;
  });

  const todaNames = Array.from(new Set(bookings.map((b) => b.todaName).filter((n) => n && n !== '\u2014'))).sort();
  const todaOptions: FilterOption[] = [
    { label: 'All TODAs', value: 'All' },
    ...todaNames.map((n) => ({ label: n, value: n })),
  ];

  // Leaflet Map Initialization & Markers
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [13.4117, 121.1803],
        zoom: 14,
        zoomControl: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;

    // Clear existing dynamic layers
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker || layer instanceof L.Polyline) {
        map.removeLayer(layer);
      }
    });

    // Render the active trips that have a driver position (the phone's own heartbeat; a trip still searching has none)
    const withFix = activeTrips.filter((t) => t.driverLat !== null && t.driverLng !== null);
    const bounds: L.LatLngTuple[] = [];
    withFix.forEach((trip) => {
      const lat = trip.driverLat as number;
      const lng = trip.driverLng as number;
      const isOngoing = trip.status === 'Trip Ongoing';
      const ageSeconds = trip.driverFixAt ? Math.max(0, Math.round((Date.now() - Date.parse(trip.driverFixAt)) / 1000)) : null;
      const stale = ageSeconds === null || ageSeconds > LIVE_FIX_STALE_SECONDS;
      const markerBg = stale ? '#94A3B8' : isOngoing ? '#1565C0' : '#FF5500';

      const customIcon = L.divIcon({
        className: 'custom-live-trip-marker',
        // The SAKAY tricycle (app-icon-toto) on a white disc, so the artwork reads clearly; the ring around the disc carries the status colour
        html: `
          <div style="width: 36px; height: 36px; box-sizing: border-box; border-radius: 50%; background: #FFFFFF; display: flex; align-items: center; justify-content: center; border: 3px solid ${markerBg}; box-shadow: 0 3px 8px rgba(0,0,0,0.3); cursor: pointer;">
            <img src="${appIconToto}" alt="" draggable="false" style="width: 24px; height: 24px; object-fit: contain; display: block;" />
          </div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });

      const marker = L.marker([lat, lng], { icon: customIcon }).addTo(map);
      marker.bindPopup(`
        <b>${escapeHtml(trip.id.slice(0, 8).toUpperCase())}</b><br/>
        Driver: ${escapeHtml(trip.driverName)}<br/>
        Status: <b>${escapeHtml(trip.status)}</b><br/>
        Route: ${escapeHtml(trip.pickupArea)} → ${escapeHtml(trip.destinationArea)}<br/>
        Last GPS: ${ageSeconds === null ? 'none' : ageSeconds < 60 ? `${ageSeconds} s ago` : `${Math.round(ageSeconds / 60)} min ago`}${stale ? ' (not current)' : ''}
      `);

      marker.on('click', () => setSelectedTrip(trip));

      // Route line: the road from the pickup to the destination (asked for once per trip, utils/tripRoutes.ts). While the road is still loading nothing is drawn; if no
      // road could be had, a thin dotted grey straight line says so, so it is never taken for the road.
      const from: LatLng = [trip.startLat, trip.startLng];
      const to: LatLng = [trip.destLat, trip.destLng];
      if (hasRoutablePlaces(from, to)) {
        const road = roadBetween(from, to, redrawRoutes);
        if (road.state === 'road') {
          L.polyline(road.points, { color: markerBg, weight: 4, opacity: 0.8, dashArray: isOngoing ? undefined : '6, 6' }).addTo(map);
        } else if (road.state === 'unavailable') {
          L.polyline([from, to], { color: '#94A3B8', weight: 2, opacity: 0.9, dashArray: '2, 6' })
            .bindTooltip('Straight line between the pickup and the destination: the road route could not be loaded', { sticky: true })
            .addTo(map);
        }
      }
      bounds.push([lat, lng]);
    });

    // The first time drivers appear, frame them
    if (bounds.length > 0 && !framedRef.current) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      framedRef.current = true;
    }
  }, [activeTrips, routeTick, redrawRoutes]);

  // Rules 29.20 - 29.22: the live trips with a driver on them (a booking still searching has nothing to end)
  const safetyTrips = bookings
    .filter((b) => b.driverId && !['Pending', 'Searching Driver', 'No Driver Found', 'Completed'].includes(b.status) && !b.status.includes('Cancel'))
    .map((b) => ({ bookingId: b.bookingId, label: `${b.driverName} (${b.vehiclePlate}) · ${b.pickupArea} > ${b.destinationArea} · ${b.status}` }));

  const showCount = (n: number) => (isLoading ? '…' : n);
  const filtering = Boolean(searchQuery) || todaFilter !== 'All';
  const listName = LIST_NAMES[activeTab];

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 4.8 }}>
      {/* What needs an administrator now (each shows only when there is something to decide) */}
      <TripReconciliationPanel
        trips={reconTrips}
        showWhenEmpty={false}
        onReconcile={async (input) => {
          const message = await reconcileTrip(input);
          if (!message) {
            await loadReconciliation();
            loadTrips();
          }
          return message;
        }}
      />

      <FareDisputesPanel
        role="lgu_admin"
        disputes={fareDisputes}
        showWhenEmpty={false}
        signEvidence={signLguCaseEvidence}
        onEscalate={async () => 'The LGU Administrator decides a dispute directly.'}
        onResolve={async (decision) => {
          const message = await resolveFareDispute(decision);
          if (!message) {
            await loadFareDisputes();
            loadTrips();
          }
          return message;
        }}
      />

      {/* The numbers: each one is also a button that shows that group of trips in the list below */}
      <StatStrip
        label="Trip totals (press one to show those trips)"
        stats={[
          { key: 'Active', label: 'Active trips', value: showCount(activeTrips.length), note: 'On the way or looking for a driver', onSelect: () => setActiveTab('Active'), selected: activeTab === 'Active' },
          { key: 'Completed', label: 'Completed trips', value: showCount(completedTrips.length), tone: 'success', note: 'Rides that finished', onSelect: () => setActiveTab('Completed'), selected: activeTab === 'Completed' },
          { key: 'Cancelled', label: 'Cancelled bookings', value: showCount(cancelledTrips.length), note: 'Cancelled by a passenger or a driver', onSelect: () => setActiveTab('Cancelled'), selected: activeTab === 'Cancelled' },
          { key: 'All', label: 'All bookings', value: showCount(bookings.length), note: 'Every booking so far', onSelect: () => setActiveTab('All'), selected: activeTab === 'All' },
        ]}
      />

      {/* Live map of Calapan City */}
      <Box sx={{ mb: '19px' }}>
        <DashboardCard
          title="Live map"
          description={`${activeTrips.length} active ${activeTrips.length === 1 ? 'trip' : 'trips'}, ${activeTrips.filter((t) => t.driverLat !== null).length} with a driver GPS position.`}
          actions={
            <Button onClick={loadTrips} startIcon={<RefreshIcon sx={{ fontSize: 16 }} />} sx={rowActionSx('neutral')}>
              Refresh
            </Button>
          }
        >
          <Box sx={{ width: '100%', borderRadius: '8px', overflow: 'hidden', border: `1px solid ${PAGE_BORDER}` }}>
            <div ref={mapContainerRef} style={{ width: '100%', height: '340px' }} />
          </Box>
        </DashboardCard>
      </Box>

      {/* The trips: search, filter, list */}
      <Typography component="h2" sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: PAGE_TEXT.primary, mb: '10px' }}>
        {listName.heading} {isLoading ? '' : `(${filteredTrips.length})`}
      </Typography>

      <FilterToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search trip, driver, passenger, plate"
        selectFilters={[
          {
            id: 'toda',
            label: 'TODA Affiliation',
            value: todaFilter,
            options: todaOptions,
            onChange: setTodaFilter,
          },
        ]}
        onResetFilters={() => {
          setSearchQuery('');
          setTodaFilter('All');
        }}
      />

      <DataTableCard
        label={listName.heading}
        minWidth={900}
        columns={[{ label: 'Trip' }, { label: 'Driver and unit' }, { label: 'Passenger' }, { label: 'Fare' }, { label: 'Status' }, { label: 'Action', align: 'right' }]}
      >
        <TableBody>
          {isLoading ? (
            <DataTableMessageRow colSpan={6} kind="loading" loadingText="Loading trips..." />
          ) : filteredTrips.length > 0 ? (
            filteredTrips.map((trip) => (
              <TableRow key={trip.id}>
                <TableCell>
                  <CellStack primary={trip.id} secondary={`${trip.pickupArea} → ${trip.destinationArea}`} />
                </TableCell>
                <TableCell>
                  <CellStack primary={trip.driverName} secondary={`${trip.todaName} · ${trip.vehiclePlate}`} />
                </TableCell>
                <TableCell>
                  <CellStack primary={trip.passengerName} secondary={trip.passengerPhone} />
                </TableCell>
                <TableCell>
                  <CellStack primary={`₱${trip.estimatedFare}.00`} secondary={`${trip.tripType} · ${trip.distanceKm} km`} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={trip.status as any} />
                  {(trip.cancelledBy || trip.cancellationReason) && (
                    <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '3px', maxWidth: 240, overflowWrap: 'anywhere' }}>
                      {trip.cancelledBy ? `By ${trip.cancelledBy}` : ''}
                      {trip.cancelledBy && trip.cancellationReason ? ': ' : ''}
                      {trip.cancellationReason ?? ''}
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="right">
                  <Button aria-label={`View details of trip ${trip.id}`} onClick={() => setSelectedTrip(trip)} sx={rowActionSx('neutral')}>
                    View details
                  </Button>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <DataTableMessageRow
              colSpan={6}
              kind={filtering ? 'noResults' : 'empty'}
              title={filtering ? 'No trips match' : `No ${listName.none} recorded`}
              hint={
                filtering
                  ? 'Nothing matches your search or filter. Try clearing them.'
                  : 'Trips appear here when passengers and drivers start using SAKAY.'
              }
              onRefresh={loadTrips}
            />
          )}
        </TableBody>
      </DataTableCard>

      {/* Tools that are used less often: ending a trip for safety, and how long the search for a driver runs */}
      <Box sx={{ mt: '26px' }}>
        <SafetyEndTripPanel
          trips={safetyTrips}
          onEnd={async (end) => {
            const message = await endTripSafely(end);
            if (!message) loadTrips();
            return message;
          }}
        />

        <DispatchSettingsCard />
      </Box>

      {/* Trip details window */}
      {selectedTrip && (
        <TripDetailModal
          open={Boolean(selectedTrip)}
          onClose={() => setSelectedTrip(null)}
          trip={selectedTrip}
          onChanged={loadTrips}
        />
      )}
    </Box>
  );
};
