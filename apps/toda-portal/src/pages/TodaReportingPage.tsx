import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Typography, Tabs, Tab, TableBody, TableCell, TableRow, Button } from '@mui/material';
import AssessmentIcon from '@mui/icons-material/Assessment';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import PeopleIcon from '@mui/icons-material/People';
import EventNoteIcon from '@mui/icons-material/EventNote';
import RefreshIcon from '@mui/icons-material/Refresh';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ScheduleIcon from '@mui/icons-material/Schedule';

import { TodaBooking, TodaIncident } from '../types/toda';
import { FilterToolbar, FilterOption } from '../components/admin/FilterToolbar';
import { StatusBadge } from '../components/common/StatusBadge';
import { MacCenterModal } from '../components/admin/MacCenterModal';
import { BookingVolumeReport } from '../components/reports/BookingVolumeReport';
import { DriverActivityReport } from '../components/reports/DriverActivityReport';
import type { ActivityDriver } from '../components/reports/DriverActivityReport';
import { ReportExportButtons } from '../components/reports/ReportExportButtons';
import { ResultsBar } from '../components/reports/ResultsBar';
import type { ExportFormat } from '../components/reports/ReportExportButtons';
import { OperationsStatStrip } from '../components/operations/OperationsStatStrip';
import type { OperationsStat } from '../components/operations/OperationsStatStrip';
import { CellStack, DataTableCard, DataTableMessageRow, StatusPill } from '../components/common/DataTable';
import { rowActionSx, secondaryButtonSx } from '../components/common/pageButtons';
import { OPS_BORDER, OPS_TEXT, opsFocusRing } from '../components/operations/operationsTheme';
import { FONT, SHELL, SPACE } from '../styles/density';
import { PILOT_COVERAGE_TEXT } from '../components/common/PilotCoverageNote';
import { incidentClocks, incidentHandling, type BookingLike, type IncidentFollowupRow, type IncidentRecord, type ReportTable } from '@sakay/shared';
import { TodaIncidentModal } from '../components/reports/TodaIncidentModal';
import {
  fetchTodaDrivers,
  fetchTodaOperationsTrips,
  fetchTodaIncidents,
  fetchIncidentFollowups,
  fetchTodaProfile,
  startIncident,
  escalateIncident,
  decideIncident,
  updateLostItemReport,
  recordTodaAuditAction,
  recordTodaAuditStrict,
} from '../services/todaApiService';

export const TodaReportingPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<number>(0);
  const [bookings, setBookings] = useState<TodaBooking[]>([]);
  const [incidents, setIncidents] = useState<TodaIncident[]>([]);
  const [todaName, setTodaName] = useState<string>('TODA Association');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Booking Filters
  const [bookingSearch, setBookingSearch] = useState('');
  const [modeFilter, setModeFilter] = useState('All');

  // Incident Filters
  const [incidentSearch, setIncidentSearch] = useState('');
  const [incidentStatusFilter, setIncidentStatusFilter] = useState('All');
  const [incidentPriorityFilter, setIncidentPriorityFilter] = useState('All');
  // which reports need MY action, which only wait for the LGU (monitoring), which are closed
  const [incidentHandlingFilter, setIncidentHandlingFilter] = useState('All');
  const [followups, setFollowups] = useState<Map<string, IncidentFollowupRow[]>>(new Map());

  // Incident Review Modals & Dialogs
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  // read from the list, so the panel shows what the database says after every action
  const selectedIncident = incidents.find((i) => i.id === selectedIncidentId) ?? null;
  // a notice opens this record: ?incident=<id> (read once, then removed from the address)
  const [searchParams, setSearchParams] = useSearchParams();
  const incidentToOpen = searchParams.get('incident');
  useEffect(() => {
    if (!incidentToOpen || isLoading) return;
    if (incidents.some((i) => i.id === incidentToOpen)) {
      setActiveTab(3);
      setSelectedIncidentId(incidentToOpen);
    }
    setSearchParams({}, { replace: true });
  }, [incidentToOpen, incidents, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // The raw booking rows and the TODA's registered drivers feed the volume and driver-activity reports
  const [rawTrips, setRawTrips] = useState<BookingLike[]>([]);
  const [activityDrivers, setActivityDrivers] = useState<ActivityDriver[]>([]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [tripsData, incData, profileData, memberData] = await Promise.all([
        fetchTodaOperationsTrips(),
        fetchTodaIncidents(),
        fetchTodaProfile(),
        fetchTodaDrivers(),
      ]);

      if (profileData) setTodaName(profileData.name);
      setRawTrips((tripsData || []) as BookingLike[]);
      // Only members with a SAKAY account (a roster line that never registered has no driver id and no trips)
      setActivityDrivers(
        (memberData || [])
          .filter((m) => !String(m.id).startsWith('roster-'))
          .map((m) => ({ driver_id: m.id, full_name: m.name, plate_number: m.vehiclePlate }))
      );

      const mappedBookings: TodaBooking[] = (tripsData || []).map((b: any) => {
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

      const mappedIncidents: TodaIncident[] = (incData || []).map((inc: any) => {
        const record = inc as IncidentRecord;
        const withLgu = record.routing === 'LGU';
        const status: TodaIncident['status'] =
          record.status === 'Cancelled' || record.outcome === 'NOT_UPHELD' || record.status === 'Dismissed'
            ? 'Dismissed'
            : record.outcome
            ? record.decided_by_role === 'toda_admin' ? 'Resolved (TODA Level)' : 'Resolved'
            : withLgu
            ? 'Escalated to LGU'
            : record.status === 'Under Investigation'
            ? 'Under Investigation'
            : 'Pending Review';
        return {
          id: inc.incident_id,
          incidentCode: (inc.incident_id || '').slice(0, 8).toUpperCase(),
          bookingId: inc.booking_id || inc.trip_id || 'BKG-001',
          driverName: inc.driver?.full_name || inc.driver_name || 'Driver',
          vehiclePlate: inc.driver?.plate_number || inc.vehicle_plate || 'N/A',
          category: inc.category || 'Service Quality',
          description: inc.description || '',
          reporterName: inc.passenger?.full_name || inc.passenger_name || (inc.reported_by === 'Driver' ? 'Driver' : 'Passenger'),
          reporterRole: (inc.reported_by || 'Passenger') as any,
          submittedAt: inc.created_at ? new Date(inc.created_at).toLocaleDateString('en-US', { timeZone: 'Asia/Manila' }) : 'Recent',
          status,
          findings: inc.status === 'Cancelled' ? `Withdrawn by the reporter: ${inc.cancellation_reason || 'no reason given'}` : (inc.resolution_notes || inc.resolution || undefined),
          tripId: inc.booking_id || inc.trip_id || 'TRIP-001',
          evidenceFiles: inc.evidence_files ?? [],
          routing: record.routing,
          priority: record.priority,
          overdue: incidentClocks(record).overdue,
          route: `${inc.booking?.pickup_address || '-'}  >  ${inc.booking?.dropoff_address || '-'}`,
          passengerName: inc.passenger?.full_name || undefined,
          passengerPhone: inc.passenger?.contact_number || undefined,
          driverPhone: inc.driver?.contact_number || undefined,
          record,
        };
      });

      setBookings(mappedBookings);
      setIncidents(mappedIncidents);
      setFollowups(await fetchIncidentFollowups(mappedIncidents.map((i) => i.id)));
    } catch (err) {
      console.error('[TodaReporting] Error loading data from database:', err);
      setBookings([]);
      setIncidents([]);
      setRawTrips([]);
      setActivityDrivers([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Filtered Bookings
  const filteredBookings = bookings.filter((bkg) => {
    const matchesSearch =
      bkg.bookingCode.toLowerCase().includes(bookingSearch.toLowerCase()) ||
      bkg.passengerName.toLowerCase().includes(bookingSearch.toLowerCase()) ||
      bkg.driverName.toLowerCase().includes(bookingSearch.toLowerCase()) ||
      bkg.vehiclePlate.toLowerCase().includes(bookingSearch.toLowerCase());

    const matchesMode = modeFilter === 'All' || bkg.tripMode === modeFilter;
    return matchesSearch && matchesMode;
  });

  // Filtered Incidents
  const filteredIncidents = incidents.filter((inc) => {
    const matchesSearch =
      inc.id.toLowerCase().includes(incidentSearch.toLowerCase()) ||
      inc.driverName.toLowerCase().includes(incidentSearch.toLowerCase()) ||
      inc.category.toLowerCase().includes(incidentSearch.toLowerCase()) ||
      inc.description.toLowerCase().includes(incidentSearch.toLowerCase());

    const matchesStatus = incidentStatusFilter === 'All' || inc.status === incidentStatusFilter;
    const matchesPriority = incidentPriorityFilter === 'All' || inc.priority === incidentPriorityFilter;
    const matchesHandling = incidentHandlingFilter === 'All' || (inc.record ? incidentHandling(inc.record, 'toda_admin') === incidentHandlingFilter : true);
    return matchesSearch && matchesStatus && matchesPriority && matchesHandling;
  });

  const modeOptions: FilterOption[] = [
    { label: 'All Trip Modes', value: 'All' },
    { label: 'Solo Trip', value: 'Solo Trip' },
    { label: 'Solo Trip', value: 'Solo Trip' },
    { label: 'Shared Ride', value: 'Shared Ride' },
  ];

  const incidentHandlingOptions: FilterOption[] = [
    { label: 'Everything', value: 'All' },
    { label: 'Needs my action', value: 'action' },
    { label: 'Monitoring (with the LGU)', value: 'monitoring' },
    { label: 'Closed', value: 'closed' },
  ];

  const incidentStatusOptions: FilterOption[] = [
    { label: 'All', value: 'All' },
    { label: 'Pending Review', value: 'Pending Review' },
    { label: 'Under Investigation', value: 'Under Investigation' },
    { label: 'Resolved (TODA Level)', value: 'Resolved (TODA Level)' },
    { label: 'Resolved (LGU)', value: 'Resolved' },
    { label: 'Escalated to LGU', value: 'Escalated to LGU' },
    { label: 'Dismissed', value: 'Dismissed' },
  ];

  const incidentPriorityOptions: FilterOption[] = [
    { label: 'All', value: 'All' },
    { label: 'Serious (with the LGU)', value: 'Serious' },
    { label: 'Emergency', value: 'Emergency' },
    { label: 'Standard', value: 'Standard' },
  ];

  // The export is written to the audit log BEFORE the file is handed over (the toolbar makes no file when this fails)
  const recordExport = (reportName: string, format: ExportFormat): Promise<void> =>
    recordTodaAuditStrict({
      actionType: 'REPORT_EXPORTED',
      targetId: 'REPORT',
      targetName: reportName,
      details: `Exported ${reportName} (${format}) for ${todaName}.`,
    });

  // The two reports of this page as tables: the Excel, CSV and PDF files contain exactly these
  const ledgerTable: ReportTable = {
    title: 'Operations Trip Ledger',
    notes: [`The trips of ${todaName} that match the filters on screen. Search: ${bookingSearch.trim() ? `"${bookingSearch.trim()}"` : 'none'}; trip mode: ${modeOptions.find((o) => o.value === modeFilter)?.label ?? modeFilter}.`, PILOT_COVERAGE_TEXT],
    headers: ['Booking Code', 'Passenger', 'Driver', 'Vehicle Plate', 'Pickup', 'Dropoff', 'Distance (km)', 'Fare (PHP)', 'Mode', 'Status', 'Time'],
    rows: filteredBookings.map((b) => [b.bookingCode, b.passengerName, b.driverName, b.vehiclePlate, b.pickupLocation, b.dropoffLocation, b.distanceKm, b.fareAmount, b.tripMode, b.status, b.timestamp]),
  };
  const incidentTable: ReportTable = {
    title: 'Incident Summary Report',
    notes: [
      `The incident reports about drivers of ${todaName} that match the filters on screen. Show: ${incidentHandlingOptions.find((o) => o.value === incidentHandlingFilter)?.label ?? incidentHandlingFilter}; status: ${incidentStatusOptions.find((o) => o.value === incidentStatusFilter)?.label ?? incidentStatusFilter}; priority: ${incidentPriorityOptions.find((o) => o.value === incidentPriorityFilter)?.label ?? incidentPriorityFilter}; search: ${incidentSearch.trim() ? `"${incidentSearch.trim()}"` : 'none'}.`,
      PILOT_COVERAGE_TEXT,
    ],
    pdfColumns: [0, 1, 4, 5, 6, 7, 8, 11],
    orientation: 'landscape',
    headers: ['Incident Code', 'Driver', 'Vehicle Plate', 'Reported By', 'Category', 'Priority', 'With', 'Date', 'Status', 'Outcome', 'Strike', 'Description'],
    rows: filteredIncidents.map((i) => [i.incidentCode || i.id.slice(0, 8), i.driverName, i.vehiclePlate, `${i.reporterName} (${i.reporterRole})`, i.category, i.priority ?? '', i.routing ?? '', i.submittedAt, i.status, i.record?.outcome ?? '', i.record?.strike_code ?? '', i.description]),
  };

  // Incident handlers: each one is ONE database function (who may act, the strike, the audit entry and the notices are the database's); the list is read again afterwards
  const afterAction = (task: () => Promise<string | null>) => async (): Promise<string | null> => {
    const problem = await task();
    if (!problem) await loadData();
    return problem;
  };

  // The four numbers over the trip ledger
  const ledgerStats: OperationsStat[] = [
    { key: 'total', label: 'Total dispatched trips', value: bookings.length, note: 'Recorded bookings' },
    { key: 'completed', label: 'Completed trips', value: bookings.filter((b) => b.status === 'Completed').length, note: 'Successful arrivals', tone: bookings.some((b) => b.status === 'Completed') ? 'success' : 'neutral' },
    { key: 'shared', label: 'Shared rides', value: bookings.filter((b) => b.tripMode === 'Shared Ride').length, note: 'Multi-passenger carpools' },
    { key: 'cancelled', label: 'Cancelled rides', value: bookings.filter((b) => b.status === 'Cancelled').length, tone: bookings.some((b) => b.status === 'Cancelled') ? 'danger' : 'neutral' },
  ];

  // Why a list is empty, in words: nothing was recorded, or nothing matches the search and filters
  const bookingFilterActive = bookingSearch.trim() !== '' || modeFilter !== 'All';
  const incidentFilterActive = incidentSearch.trim() !== '' || incidentStatusFilter !== 'All' || incidentPriorityFilter !== 'All' || incidentHandlingFilter !== 'All';

  const modalLabel = { fontSize: FONT.small, fontWeight: 600, color: OPS_TEXT.secondary, mb: '6px' } as const;
  const modalPanel = { backgroundColor: '#FAFAF8', p: '16px', borderRadius: '10px', border: `1px solid ${OPS_BORDER}` } as const;

  return (
    <Box sx={{ maxWidth: SHELL.contentMaxWidth, margin: '0 auto', pb: '38px' }}>
      {/* 1. The four reports, and Refresh. (The note about what the figures cover is no longer shown on the page; every exported file still carries it.) */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 13px', borderBottom: { xs: 'none', md: `1px solid ${OPS_BORDER}` }, mb: SPACE.gapLarge }}>
        {/* on a phone the tabs take the whole row (and Refresh drops under them); from a tablet up they share one row */}
        <Box sx={{ flex: { xs: '1 1 100%', md: '1 1 0' }, minWidth: 0, borderBottom: { xs: `1px solid ${OPS_BORDER}`, md: 'none' } }}>
          <Tabs
            value={activeTab}
            onChange={(_, val) => setActiveTab(val)}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            sx={{
              minHeight: 40,
              '& .MuiTab-root': {
                textTransform: 'none',
                fontSize: FONT.body,
                fontWeight: 600,
                minHeight: 40,
                color: OPS_TEXT.secondary,
                ...opsFocusRing,
                '&.Mui-selected': { color: OPS_TEXT.brand },
              },
              '& .MuiTabs-indicator': { backgroundColor: 'var(--sakay-orange)', height: 2.5 },
            }}
          >
            <Tab icon={<AssessmentIcon sx={{ fontSize: 16 }} />} iconPosition="start" label={`Operations Trip Ledger (${bookings.length})`} />
            <Tab icon={<EventNoteIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="Booking Volume & Fares" />
            <Tab icon={<PeopleIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="Driver Activity" />
            <Tab icon={<ReportProblemIcon sx={{ fontSize: 16 }} />} iconPosition="start" label={`Incident Reports & Complaints (${incidents.length})`} />
          </Tabs>
        </Box>
        <Button onClick={loadData} startIcon={<RefreshIcon sx={{ fontSize: 16 }} />} variant="outlined" sx={{ ...secondaryButtonSx, mb: { xs: 0, md: '6px' }, ml: { xs: 'auto', md: 0 } }}>
          Refresh
        </Button>
      </Box>

      {/* Active tab content */}
      {activeTab === 0 ? (
        <>
          {/* 3. The trip numbers */}
          <OperationsStatStrip stats={ledgerStats} />

          {/* 4. Search, filter, export */}
          <FilterToolbar
            searchQuery={bookingSearch}
            onSearchChange={setBookingSearch}
            searchPlaceholder="Search trip code, passenger, driver or plate"
            selectFilters={[
              {
                id: 'mode',
                label: 'Trip Mode',
                value: modeFilter,
                options: modeOptions,
                onChange: setModeFilter,
                width: 168,
              },
            ]}
            onResetFilters={() => {
              setBookingSearch('');
              setModeFilter('All');
            }}
            disableMarginBottom
          />
          <ResultsBar count={isLoading ? 'Loading trips...' : `Showing ${filteredBookings.length} of ${bookings.length} trip${bookings.length === 1 ? '' : 's'}`}>
            <ReportExportButtons table={ledgerTable} generatedBy={`${todaName} Administrator`} onExported={recordExport} />
          </ResultsBar>

          {/* 5. The trips */}
          <DataTableCard
            label="Operations trip ledger"
            minWidth={900}
            columns={[{ label: 'Booking code' }, { label: 'Passenger' }, { label: 'Driver' }, { label: 'Route and distance' }, { label: 'Mode and fare' }, { label: 'Status' }]}
          >
            <TableBody>
              {isLoading ? (
                <DataTableMessageRow colSpan={6} kind="loading" loadingText="Loading trip records..." />
              ) : filteredBookings.length > 0 ? (
                filteredBookings.map((bkg) => (
                  <TableRow key={bkg.id}>
                    <TableCell sx={{ fontWeight: 700, color: OPS_TEXT.brand, whiteSpace: 'nowrap' }}>{bkg.bookingCode}</TableCell>
                    <TableCell>
                      <CellStack primary={bkg.passengerName} secondary={bkg.passengerPhone} />
                    </TableCell>
                    <TableCell>
                      <CellStack primary={bkg.driverName} secondary={bkg.vehiclePlate} />
                    </TableCell>
                    <TableCell>
                      <CellStack primary={`${bkg.pickupLocation} → ${bkg.dropoffLocation}`} secondary={`${bkg.distanceKm} km`} />
                    </TableCell>
                    <TableCell>
                      <CellStack primary={`₱${bkg.fareAmount}`} secondary={`${bkg.tripMode} (Cash)`} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={bkg.status} highContrast />
                    </TableCell>
                  </TableRow>
                ))
              ) : bookings.length === 0 ? (
                <DataTableMessageRow colSpan={6} kind="empty" title="No trips recorded yet" hint="Trips booked with your drivers will be listed here." />
              ) : (
                <DataTableMessageRow
                  colSpan={6}
                  kind="noResults"
                  title="No trips match"
                  hint={bookingFilterActive ? 'Try other words or another trip mode, or press Reset to see every trip.' : 'Press Reset to see every trip.'}
                />
              )}
            </TableBody>
          </DataTableCard>
        </>
      ) : activeTab === 1 ? (
        <BookingVolumeReport trips={rawTrips} todaName={todaName} onExported={recordExport} />
      ) : activeTab === 2 ? (
        <DriverActivityReport trips={rawTrips} drivers={activityDrivers} onExported={recordExport} generatedBy={`${todaName} Administrator`} />
      ) : (
        /* 6. Incident reports and complaints */
        <>
          <FilterToolbar
            searchQuery={incidentSearch}
            onSearchChange={setIncidentSearch}
            searchPlaceholder="Search incident ID, driver, category or description"
            selectFilters={[
              {
                id: 'handling',
                label: 'Who acts',
                prefix: 'Show',
                value: incidentHandlingFilter,
                options: incidentHandlingOptions,
                onChange: setIncidentHandlingFilter,
                width: 232,
              },
              {
                id: 'status',
                label: 'Incident Status',
                prefix: 'Status',
                value: incidentStatusFilter,
                options: incidentStatusOptions,
                onChange: setIncidentStatusFilter,
                width: 232,
              },
              {
                id: 'priority',
                label: 'Priority',
                prefix: 'Priority',
                value: incidentPriorityFilter,
                options: incidentPriorityOptions,
                onChange: setIncidentPriorityFilter,
                width: 196,
              },
            ]}
            onResetFilters={() => {
              setIncidentSearch('');
              setIncidentStatusFilter('All');
              setIncidentPriorityFilter('All');
              setIncidentHandlingFilter('All');
            }}
            disableMarginBottom
          />
          <ResultsBar count={isLoading ? 'Loading reports...' : `Showing ${filteredIncidents.length} of ${incidents.length} report${incidents.length === 1 ? '' : 's'}`}>
            <ReportExportButtons table={incidentTable} generatedBy={`${todaName} Administrator`} onExported={recordExport} />
          </ResultsBar>

          <DataTableCard
            label="Incident reports"
            minWidth={980}
            columns={[
              { label: 'Incident ID' },
              { label: 'Driver involved' },
              { label: 'Category and reporter' },
              { label: 'Priority' },
              { label: 'Date submitted' },
              { label: 'Status' },
              { label: 'Action', align: 'right' },
            ]}
          >
            <TableBody>
              {isLoading ? (
                <DataTableMessageRow colSpan={7} kind="loading" loadingText="Loading incident reports..." />
              ) : filteredIncidents.length > 0 ? (
                filteredIncidents.map((inc) => (
                  <TableRow key={inc.id}>
                    <TableCell sx={{ fontWeight: 700, color: OPS_TEXT.brand, whiteSpace: 'nowrap' }}>#{inc.incidentCode || inc.id.slice(0, 8).toUpperCase()}</TableCell>

                    <TableCell>
                      <CellStack primary={inc.driverName} secondary={`Plate: ${inc.vehiclePlate}`} />
                    </TableCell>

                    <TableCell>
                      <CellStack primary={inc.category} secondary={`Reporter: ${inc.reporterName} (${inc.reporterRole})`} />
                    </TableCell>

                    <TableCell>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                        {inc.priority === 'Serious' ? (
                          <StatusPill label="Serious" tone="danger" icon={<ErrorOutlineIcon aria-hidden sx={{ fontSize: 13 }} />} />
                        ) : inc.priority === 'Emergency' ? (
                          <StatusPill label="Emergency" tone="warning" icon={<WarningAmberIcon aria-hidden sx={{ fontSize: 13 }} />} />
                        ) : (
                          <StatusPill label={inc.priority ?? 'Standard'} tone="neutral" />
                        )}
                        {inc.overdue && <StatusPill label="Overdue" tone="danger" icon={<ScheduleIcon aria-hidden sx={{ fontSize: 13 }} />} />}
                        {inc.record && incidentHandling(inc.record, 'toda_admin') === 'action' && <StatusPill label="Needs your action" tone="warning" />}
                        {inc.record && incidentHandling(inc.record, 'toda_admin') === 'monitoring' && <StatusPill label="Monitoring: with the LGU" tone="info" />}
                      </Box>
                    </TableCell>

                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{inc.submittedAt}</TableCell>

                    <TableCell>
                      <StatusBadge status={inc.status} highContrast />
                    </TableCell>

                    <TableCell align="right">
                      <Button variant="outlined" onClick={() => setSelectedIncidentId(inc.id)} sx={rowActionSx('brand')}>
                        {inc.record && incidentHandling(inc.record, 'toda_admin') === 'monitoring' ? 'View and follow up' : 'Review Complaint'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : incidents.length === 0 ? (
                <DataTableMessageRow colSpan={7} kind="empty" title="No incident reports" hint="No complaints have been recorded about your drivers." />
              ) : (
                <DataTableMessageRow
                  colSpan={7}
                  kind="noResults"
                  title="No incident reports match"
                  hint={incidentFilterActive ? 'Try other words, another status or priority, or press Reset to see every report.' : 'Press Reset to see every report.'}
                />
              )}
            </TableBody>
          </DataTableCard>
        </>
      )}

      {/* Incident review window */}
      {selectedIncident && selectedIncident.record && (
        <TodaIncidentModal
          incident={selectedIncident}
          todaName={todaName}
          followups={followups.get(selectedIncident.id) ?? []}
          onClose={() => setSelectedIncidentId(null)}
          onChanged={loadData}
          onStart={afterAction(() => startIncident(selectedIncident.id))}
          onEscalate={(reason, serious) => afterAction(() => escalateIncident(selectedIncident.id, reason, serious))()}
          onDecide={(d) => afterAction(() => decideIncident({ incidentId: selectedIncident.id, ...d }))()}
          onLostItem={(status, note) => afterAction(() => updateLostItemReport(selectedIncident.id, status, note))()}
        />
      )}
    </Box>
  );
};
