import React, { useState, useEffect } from 'react';
import { Box, Button } from '@mui/material';

import { DateCalendarPopover } from '../components/common/DateCalendarPopover';
import { OperationsToolbar } from '../components/operations/OperationsToolbar';
import { OperationsStatStrip } from '../components/operations/OperationsStatStrip';
import type { OperationsStat } from '../components/operations/OperationsStatStrip';
import { OperationsActionCard } from '../components/operations/OperationsActionCard';
import { OperationsListCard } from '../components/operations/OperationsListCard';
import { DriverRosterTable } from '../components/operations/DriverRosterTable';
import { BookingsTable } from '../components/operations/BookingsTable';
import { FarePolicyNote } from '../components/operations/FarePolicyNote';
import { opsButtonSx, OPS_BORDER, OPS_TEXT } from '../components/operations/operationsTheme';
import { SHELL, SPACE } from '../styles/density';
import { TodaProfile, TodaDriverMember, TodaBooking } from '../types/toda';
import {
  fetchTodaProfile,
  fetchTodaDrivers,
  fetchTodaOperationsTrips,
  fetchTripsNeedingReconciliation,
  reconcileTrip,
  reportDeliberateOffline,
  fetchGpsAreas,
  reportGpsArea,
  fetchFareDisputes,
  escalateFareDispute,
  signTodaCaseEvidence,
  resolveFareDispute,
  endTripSafely,
  fetchTodaReviewFlags,
  resolveTodaReviewFlag,
  confirmTodaFlaggedViolation,
  closeUnfinishedTrip,
  reportDriverAvailability,
  confirmAvailabilityViolation,
} from '../services/todaApiService';
import type { GpsArea } from '../services/todaApiService';
import { GpsAreasCard } from '../components/admin/GpsAreasCard';
import { FareDisputesPanel, ReportDriverAvailabilityDialog, ReviewFlagsPanel, SafetyEndTripPanel, TripReconciliationPanel, VehicleSubstitutionsPanel, CoverageGapsPanel, DeclineHistoryDialog, fetchCoverageGaps, fetchDeclineHistory, asSubstitutionClient, decideVehicleSubstitution, endVehicleSubstitution, fetchVehicleSubstitutions } from '@sakay/shared';
import type { CoverageGaps, DeclineHistory, FareDisputeRow, ReconciliationTrip, ReviewFlagRow, VehicleSubstitution } from '@sakay/shared';
import { supabase } from '../services/supabaseClient';
import { driverActivity, volumeByPeriod } from '@sakay/shared';
import type { BookingLike } from '@sakay/shared';
import { useAuth } from '../contexts/AuthContext';

export const TodaOperationsPage: React.FC = () => {
  const { todaAdminProfile } = useAuth();
  const targetTodaId = todaAdminProfile?.toda_id;

  const [profile, setProfile] = useState<TodaProfile | null>(null);
  const [drivers, setDrivers] = useState<TodaDriverMember[]>([]);
  const [bookings, setBookings] = useState<TodaBooking[]>([]);
  // the raw booking rows: today's counts and each driver's trips are computed from them
  const [rawTrips, setRawTrips] = useState<BookingLike[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [lastRefreshed, setLastRefreshed] = useState<string>(
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [calendarAnchorEl, setCalendarAnchorEl] = useState<HTMLElement | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [prof, drvs, trips] = await Promise.all([
        fetchTodaProfile(targetTodaId),
        fetchTodaDrivers(targetTodaId),
        fetchTodaOperationsTrips(targetTodaId),
      ]);

      if (prof) setProfile(prof);
      setDrivers(drvs || []);
      setRawTrips((trips || []) as BookingLike[]);

      const mappedBookings: TodaBooking[] = (trips || []).map((b: any) => {
        const rawStatus = b.booking_status || b.status || '';
        const tripStatus =
          rawStatus === 'Completed'
            ? 'Completed'
            : rawStatus.toLowerCase().includes('cancel')
            ? 'Cancelled'
            : 'In Progress';

        return {
          id: b.booking_id,
          bookingCode: b.booking_id.slice(0, 8).toUpperCase(),
          passengerName: b.passenger?.full_name || b.passenger_name || 'Passenger',
          passengerPhone: b.passenger?.contact_number || b.passenger_phone || '+63 900 000 0000',
          driverName: b.driver?.full_name || 'Assigned Driver',
          vehiclePlate: b.driver?.plate_number || 'MV-101',
          pickupLocation: b.pickup_address || b.pickup_location_address || 'Pickup Point',
          dropoffLocation: b.dropoff_address || b.dropoff_location_address || 'Dropoff Point',
          distanceKm: Number(b.actual_distance_km ?? b.estimated_distance_km) || 0,
          // the final fare once the trip arrived (written by the database), otherwise the estimate
          fareAmount: Number(b.actual_fare ?? b.estimated_fare) || 0,
          tripMode: b.is_shared_trip || b.trip_type === 'Shared' ? 'Shared Ride' : 'Solo Trip',
          status: tripStatus,
          paymentMethod: 'Cash',
          timestamp: b.created_at ? new Date(b.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent',
        };
      });

      setBookings(mappedBookings);
      setLastRefreshed(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      console.error('[TodaOperations] Error fetching data from database:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [targetTodaId]);

  // Rule 9.5: trips of this TODA's drivers whose location stayed silent for 30 minutes wait here for the administrator to phone the parties and close them.
  // Rule 17.5: areas where the stall / lost-connection rules keep cancelling bookings may be a GPS problem of the place: report them to the LGU.
  const [reconTrips, setReconTrips] = useState<ReconciliationTrip[]>([]);
  const [gpsAreas, setGpsAreas] = useState<{ areas: GpsArea[]; minCount: number; windowDays: number }>({ areas: [], minCount: 3, windowDays: 30 });
  const loadReconciliation = async () => setReconTrips(await fetchTripsNeedingReconciliation());
  const loadGpsAreas = async () => setGpsAreas(await fetchGpsAreas());
  // Rules 13.5 / 18.4 / 18.6: the fare disputes of this TODA's drivers wait here for a decision within 2 business days (or an escalation to the LGU Administrator)
  const [fareDisputes, setFareDisputes] = useState<FareDisputeRow[]>([]);
  const loadFareDisputes = async () => setFareDisputes(await fetchFareDisputes());
  // The events the system recorded without a strike (a breakdown, an accident, a lost item nobody claimed, a detention ...): the TODA Administrator verifies them (PI-11B)
  const [reviewFlags, setReviewFlags] = useState<ReviewFlagRow[]>([]);
  const loadReviewFlags = async () => setReviewFlags(await fetchTodaReviewFlags());
  // Rules 5.3 / 5.7: reporting a driver seen in the terminal queue, or carrying other passengers, while Available in the app
  const [reportOpen, setReportOpen] = useState(false);
  // Rule 29.18: the drivers' requests to use another vehicle: the TODA Administrator approves first, then the LGU Administrator
  const [substitutions, setSubstitutions] = useState<VehicleSubstitution[]>([]);
  const loadSubstitutions = async () => setSubstitutions((await fetchVehicleSubstitutions(asSubstitutionClient(supabase))) ?? []);
  // Rule 7.9: the booking offers of a driver a repeated-declines flag is about. Rule 7.10: the coverage gaps logged for this TODA's zone.
  const [declineView, setDeclineView] = useState<{ driverId: string; name: string; loading: boolean; history: DeclineHistory | null } | null>(null);
  const [coverageGaps, setCoverageGaps] = useState<CoverageGaps | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(true);
  const openDeclineHistory = async (driverId: string, name: string) => {
    setDeclineView({ driverId, name, loading: true, history: null });
    const history = await fetchDeclineHistory(supabase, driverId);
    setDeclineView({ driverId, name, loading: false, history });
  };
  useEffect(() => {
    loadReconciliation();
    loadGpsAreas();
    loadFareDisputes();
    loadReviewFlags();
    loadSubstitutions();
    fetchCoverageGaps(supabase, 30).then((g) => { setCoverageGaps(g); setCoverageLoading(false); });
    const timer = setInterval(() => {
      loadReconciliation();
      loadFareDisputes();
      loadReviewFlags();
      loadSubstitutions();
    }, 15000);
    return () => clearInterval(timer);
  }, [targetTodaId]);

  const totalDrivers = drivers.length;
  // Online right now = the database says Available (idle) or Busy (on a trip); a paused driver is online but not taking new bookings
  const isOnlineNow = (d: TodaDriverMember): boolean => d.availabilityStatus === 'Available' || d.availabilityStatus === 'Busy';
  const isPausedNow = (d: TodaDriverMember): boolean => !!d.bookingsPausedUntil && Date.parse(d.bookingsPausedUntil) > Date.now();
  const onlineDrivers = drivers.filter(isOnlineNow).length;
  // Today in Asia/Manila (the cards used to count every booking ever recorded under "today")
  const today = volumeByPeriod(rawTrips, 'day', 1)[0];
  // Per driver: trips and whether the driver carried passengers in the last 30 days
  const activityById = new Map(
    driverActivity(
      rawTrips,
      drivers.filter((d) => !String(d.id).startsWith('roster-')).map((d) => ({ driver_id: d.id, full_name: d.name, plate_number: d.vehiclePlate }))
    ).map((r) => [r.driverId, r])
  );
  const registeredDrivers = activityById.size;
  const activeDrivers30 = [...activityById.values()].filter((r) => r.activeInWindow).length;
  const activeTrips = bookings.filter((b) => b.status === 'In Progress');
  // Rules 29.20 - 29.22: the trips of this TODA's drivers that are on, with a driver on them (a booking still searching has nothing to end)
  const SEARCHING = ['Pending', 'Searching Driver', 'No Driver Found'];
  const safetyTrips = rawTrips
    .filter((t: any) => t.driver_id && t.booking_status && !SEARCHING.includes(t.booking_status) && t.booking_status !== 'Completed' && !String(t.booking_status).includes('Cancel'))
    .map((t: any) => ({ bookingId: t.booking_id as string, label: `${t.driver?.full_name ?? 'Driver'} (${t.driver?.plate_number ?? '-'}) · ${t.pickup_address ?? '-'} > ${t.dropoff_address ?? '-'} · ${t.booking_status}` }));

  // The five key numbers: the values are the ones computed above; only the order, wording and colour are for reading at a glance.
  // A number is coloured only when it is more than zero, so a calm day stays calm.
  const completedToday = today?.completed ?? 0;
  const cancelledToday = today?.cancelled ?? 0;
  const stats: OperationsStat[] = [
    {
      key: 'accredited',
      label: 'Accredited drivers',
      value: totalDrivers,
      note: `${onlineDrivers} online now`,
      noteTone: onlineDrivers > 0 ? 'success' : 'neutral',
    },
    {
      key: 'utilization',
      label: 'Driver utilization',
      value: registeredDrivers > 0 ? `${Math.round((activeDrivers30 / registeredDrivers) * 100)}%` : '-',
      note: `${activeDrivers30} of ${registeredDrivers} drivers completed a trip in 30 days`,
    },
    {
      key: 'active',
      label: 'Active trips',
      value: activeTrips.length,
      note: 'Currently in transit',
      tone: activeTrips.length > 0 ? 'brand' : 'neutral',
    },
    {
      key: 'completed',
      label: 'Completed today',
      value: completedToday,
      note: `${today?.total ?? 0} booking requests today`,
      tone: completedToday > 0 ? 'success' : 'neutral',
    },
    {
      key: 'cancelled',
      label: 'Cancelled today',
      value: cancelledToday,
      note: `${today?.noDriverFound ?? 0} with no driver found`,
      tone: cancelledToday > 0 ? 'danger' : 'neutral',
    },
  ];

  return (
    // containerType: the sections below lay themselves out by the width of this page area, so they also fit when the sidebar is open or closed
    <Box sx={{ maxWidth: SHELL.contentMaxWidth, margin: '0 auto', pb: SPACE.section, containerType: 'inline-size' }}>
      <OperationsToolbar
        accreditation={!profile && isLoading ? 'loading' : profile?.accreditationStatus === 'Active' ? 'active' : 'not-active'}
        accreditationNo={profile?.accreditationNo || undefined}
        dateLabel={selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        onOpenCalendar={setCalendarAnchorEl}
        lastRefreshed={lastRefreshed}
        onRefresh={loadData}
      />

      <DateCalendarPopover
        open={Boolean(calendarAnchorEl)}
        anchorEl={calendarAnchorEl}
        onClose={() => setCalendarAnchorEl(null)}
        selectedDate={selectedDate}
        onSelectDate={(date) => {
          setSelectedDate(date);
          loadData();
        }}
      />

      <OperationsStatStrip stats={stats} />

      {/* Things waiting for a decision. Each panel appears only when it has something to show, right under the numbers. */}
      <TripReconciliationPanel
        trips={reconTrips}
        showWhenEmpty={false}
        onReconcile={async (input) => {
          const message = await reconcileTrip(input);
          if (!message) {
            await loadReconciliation();
            loadData();
          }
          return message;
        }}
        onReportDeliberateOffline={reportDeliberateOffline}
      />

      <VehicleSubstitutionsPanel
        role="toda_admin"
        requests={substitutions}
        onDecide={async (id, approve, note) => {
          const message = await decideVehicleSubstitution(asSubstitutionClient(supabase), 'toda_admin', id, approve, note);
          if (!message) await loadSubstitutions();
          return message;
        }}
        onEnd={async (id, reason) => {
          const message = await endVehicleSubstitution(asSubstitutionClient(supabase), id, reason);
          if (!message) await loadSubstitutions();
          return message;
        }}
      />

      <ReviewFlagsPanel
        flags={reviewFlags}
        driverNames={Object.fromEntries(drivers.map((d) => [d.id, d.name]))}
        onResolve={async (flagId, status, note) => {
          const message = await resolveTodaReviewFlag(flagId, status, note);
          if (!message) await loadReviewFlags();
          return message;
        }}
        onConfirm={async (flagId, bookingId, reason) => {
          const message = await confirmTodaFlaggedViolation(flagId, bookingId, reason);
          if (!message) await loadReviewFlags();
          return message;
        }}
        onConfirmAvailability={async (flagId, reason) => {
          const message = await confirmAvailabilityViolation(flagId, reason);
          if (!message) await loadReviewFlags();
          return message;
        }}
        onViewDeclineHistory={openDeclineHistory}
        onCloseTrip={async (bookingId, paymentStatus, reason) => {
          const message = await closeUnfinishedTrip(bookingId, paymentStatus, reason);
          if (!message) {
            await loadReviewFlags();
            loadData();
          }
          return message;
        }}
      />

      <FareDisputesPanel
        role="toda_admin"
        disputes={fareDisputes}
        showWhenEmpty={false}
        signEvidence={signTodaCaseEvidence}
        onEscalate={async (id, reason) => {
          const message = await escalateFareDispute(id, reason);
          if (!message) await loadFareDisputes();
          return message;
        }}
        onResolve={async (decision) => {
          const message = await resolveFareDispute(decision);
          if (!message) {
            await loadFareDisputes();
            loadData();
          }
          return message;
        }}
      />

      <GpsAreasCard
        areas={gpsAreas.areas}
        minCount={gpsAreas.minCount}
        windowDays={gpsAreas.windowDays}
        onReport={async (cellKey, note) => {
          const message = await reportGpsArea(cellKey, note);
          if (!message) await loadGpsAreas();
          return message;
        }}
      />

      {/* A single status line while all is well; it opens up as a warning when a zone was logged. */}
      <CoverageGapsPanel compact gaps={coverageGaps} loading={coverageLoading} audience="toda_admin" />
      <DeclineHistoryDialog
        open={declineView !== null}
        onClose={() => setDeclineView(null)}
        driverName={declineView?.name ?? ''}
        history={declineView?.history ?? null}
        loading={declineView?.loading ?? false}
        failed={declineView !== null && !declineView.loading && declineView.history === null}
      />

      {/* The two things a president does: report a driver, or (in an emergency) end a trip. The safety one is red and asks twice.
          One grid holds both cards, so they share a top edge and a height. The safety form opens as its own full-width row under the pair. */}
      <Box
        component="section"
        aria-label="Actions"
        sx={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: SPACE.gap,
          alignItems: 'stretch',
          mb: SPACE.section,
          '@container (min-width: 608px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
        }}
      >
        <OperationsActionCard title="Report a driver" description="A driver seen in the terminal queue, or carrying other passengers, while shown Available in the app.">
          <Button
            variant="outlined"
            onClick={() => setReportOpen(true)}
            disabled={drivers.filter((d) => !String(d.id).startsWith('roster-')).length === 0}
            sx={{ ...opsButtonSx, minWidth: 167, flexShrink: 0, color: OPS_TEXT.primary, borderColor: OPS_BORDER, '&:hover': { backgroundColor: 'var(--sakay-orange-soft)', borderColor: 'var(--sakay-orange-border)' } }}
          >
            Report a driver
          </Button>
        </OperationsActionCard>

        <SafetyEndTripPanel
          compact
          trips={safetyTrips}
          loading={isLoading}
          onEnd={async (end) => {
            const message = await endTripSafely(end);
            if (!message) loadData();
            return message;
          }}
        />
      </Box>
      <ReportDriverAvailabilityDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        drivers={drivers.filter((d) => !String(d.id).startsWith('roster-')).map((d) => ({ id: d.id, name: d.name }))}
        onSubmit={reportDriverAvailability}
        onFiled={() => void loadReviewFlags()}
      />

      {/* The two lists, side by side on a wide screen and one under the other on a narrow one */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: SPACE.gapLarge,
          alignItems: 'stretch',
          mb: SPACE.sectionLarge,
          '@container (min-width: 944px)': { gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)' },
        }}
      >
        <OperationsListCard
          title="Driver roster"
          subtitle={`Drivers registered with ${profile?.name || 'this TODA'}`}
          count={`${drivers.length} ${drivers.length === 1 ? 'driver' : 'drivers'}`}
        >
          <DriverRosterTable
            drivers={drivers}
            isLoading={isLoading}
            isOnlineNow={isOnlineNow}
            isPausedNow={isPausedNow}
            completedTrips={(d) => activityById.get(d.id)?.completed ?? 0}
          />
        </OperationsListCard>

        <OperationsListCard
          title="SAKAY bookings"
          subtitle={`Ongoing and recent rides of ${profile?.acronym || 'TODA'} drivers`}
          count={`${bookings.length} ${bookings.length === 1 ? 'booking' : 'bookings'}`}
        >
          <BookingsTable bookings={bookings} isLoading={isLoading} />
        </OperationsListCard>
      </Box>

      <FarePolicyNote />
    </Box>
  );
};
