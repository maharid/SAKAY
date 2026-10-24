import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Tabs,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  Chip,
  Card,
  LinearProgress,
  CircularProgress,
} from '@mui/material';
import AssessmentIcon from '@mui/icons-material/Assessment';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PeopleIcon from '@mui/icons-material/People';
import EventNoteIcon from '@mui/icons-material/EventNote';
import CloseIcon from '@mui/icons-material/Close';
import VisibilityIcon from '@mui/icons-material/Visibility';
import RefreshIcon from '@mui/icons-material/Refresh';

import { TodaBooking, TodaIncident } from '../types/toda';
import { FilterToolbar, FilterOption } from '../components/admin/FilterToolbar';
import { StatusBadge } from '../components/common/StatusBadge';
import { ActionButton } from '../components/admin/ActionButton';
import { MacCenterModal } from '../components/admin/MacCenterModal';
import { BookingVolumeReport } from '../components/reports/BookingVolumeReport';
import { DriverActivityReport } from '../components/reports/DriverActivityReport';
import type { ActivityDriver } from '../components/reports/DriverActivityReport';
import { ReportExportButtons } from '../components/reports/ReportExportButtons';
import type { ExportFormat } from '../components/reports/ReportExportButtons';
import { PILOT_COVERAGE_TEXT, PilotCoverageNote } from '../components/common/PilotCoverageNote';
import { IncidentReviewPanel, incidentClocks, type BookingLike, type IncidentRecord, type ReportTable } from '@sakay/shared';
import {
  fetchTodaDrivers,
  fetchTodaOperationsTrips,
  fetchTodaIncidents,
  fetchTodaProfile,
  startIncident,
  escalateIncident,
  decideIncident,
  updateLostItemReport,
  recordTodaAuditAction,
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

  // Incident Review Modals & Dialogs
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  // read from the list, so the panel shows what the database says after every action
  const selectedIncident = incidents.find((i) => i.id === selectedIncidentId) ?? null;

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
    return matchesSearch && matchesStatus && matchesPriority;
  });

  const modeOptions: FilterOption[] = [
    { label: 'All Trip Modes', value: 'All' },
    { label: 'Solo Trip', value: 'Solo Trip' },
    { label: 'Solo Trip', value: 'Solo Trip' },
    { label: 'Shared Ride', value: 'Shared Ride' },
  ];

  const incidentStatusOptions: FilterOption[] = [
    { label: 'All Incident Statuses', value: 'All' },
    { label: 'Pending Review', value: 'Pending Review' },
    { label: 'Under Investigation', value: 'Under Investigation' },
    { label: 'Resolved (TODA Level)', value: 'Resolved (TODA Level)' },
    { label: 'Resolved (LGU)', value: 'Resolved' },
    { label: 'Escalated to LGU', value: 'Escalated to LGU' },
    { label: 'Dismissed', value: 'Dismissed' },
  ];

  const incidentPriorityOptions: FilterOption[] = [
    { label: 'All Priorities', value: 'All' },
    { label: 'Serious (with the LGU)', value: 'Serious' },
    { label: 'Emergency', value: 'Emergency' },
    { label: 'Standard', value: 'Standard' },
  ];

  // Export a report as a CSV file (opens in Excel) and record it in the audit log
  const recordExport = (reportName: string, format: ExportFormat) => {
    recordTodaAuditAction({
      actionType: 'REPORT_EXPORTED',
      targetId: 'REPORT',
      targetName: reportName,
      details: `Exported ${reportName} (${format}) for ${todaName}.`,
      category: 'Operations',
    });
  };

  // The two reports of this page as tables: the Excel, CSV and PDF files contain exactly these
  const ledgerTable: ReportTable = {
    title: 'Operations Trip Ledger',
    notes: [`The trips of ${todaName} that match the filters on screen.`, PILOT_COVERAGE_TEXT],
    headers: ['Booking Code', 'Passenger', 'Driver', 'Vehicle Plate', 'Pickup', 'Dropoff', 'Distance (km)', 'Fare (PHP)', 'Mode', 'Status', 'Time'],
    rows: filteredBookings.map((b) => [b.bookingCode, b.passengerName, b.driverName, b.vehiclePlate, b.pickupLocation, b.dropoffLocation, b.distanceKm, b.fareAmount, b.tripMode, b.status, b.timestamp]),
  };
  const incidentTable: ReportTable = {
    title: 'Incident Summary Report',
    notes: [`The incident reports about drivers of ${todaName} that match the filters on screen.`, PILOT_COVERAGE_TEXT],
    headers: ['Incident Code', 'Driver', 'Vehicle Plate', 'Reported By', 'Category', 'Priority', 'With', 'Date', 'Status', 'Outcome', 'Strike', 'Description'],
    rows: filteredIncidents.map((i) => [i.incidentCode || i.id.slice(0, 8), i.driverName, i.vehiclePlate, `${i.reporterName} (${i.reporterRole})`, i.category, i.priority ?? '', i.routing ?? '', i.submittedAt, i.status, i.record?.outcome ?? '', i.record?.strike_code ?? '', i.description]),
  };

  // Incident handlers: each one is ONE database function (who may act, the strike, the audit entry and the notices are the database's); the list is read again afterwards
  const afterAction = (task: () => Promise<string | null>) => async (): Promise<string | null> => {
    const problem = await task();
    if (!problem) await loadData();
    return problem;
  };

  return (
    <Box sx={{ maxWidth: 1280, margin: '0 auto', pb: '38px' }}>
      {/* 1. Page Header & Refresh Control */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: '22px', flexWrap: 'wrap', gap: '13px' }}>
        <Box>
          <Typography sx={{ fontSize: '16px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>
            TODA Operations Reports & Incident Grievances
          </Typography>
          <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)', mt: '2.5px' }}>
            Official operational trip audits and passenger complaints for {todaName}
          </Typography>
          <Box sx={{ mt: '5px', maxWidth: 720 }}>
            <PilotCoverageNote />
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: '10px' }}>
          {(activeTab === 0 || activeTab === 3) && (
            <ReportExportButtons table={activeTab === 0 ? ledgerTable : incidentTable} generatedBy={`${todaName} Administrator`} onExported={recordExport} />
          )}
          <Button
            onClick={loadData}
            startIcon={<RefreshIcon />}
            variant="outlined"
            size="small"
            sx={{ textTransform: 'none', borderColor: 'var(--mac-border-color)', color: 'var(--mac-text-primary)' }}
          >
            Refresh
          </Button>
        </Box>
      </Box>

      {/* 2. Top Navigation Tabs */}
      <Box sx={{ borderBottom: '1px solid var(--mac-border-color)', mb: '22px' }}>
        <Tabs
          value={activeTab}
          onChange={(_, val) => setActiveTab(val)}
          sx={{
            minHeight: 37,
            '& .MuiTab-root': {
              textTransform: 'none',
              fontSize: '12px',
              fontWeight: 600,
              minHeight: 37,
              color: 'var(--mac-text-muted)',
              '&.Mui-selected': { color: 'var(--sakay-orange)' },
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

      {/* Active Tab Content */}
      {activeTab === 0 ? (
        <>
          {/* 3. Operational Summary KPI Cards */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
              gap: '16px',
              mb: '22px',
            }}
          >
            <Card sx={{ borderRadius: '14px', border: '1px solid var(--mac-border-color)', boxShadow: 'var(--mac-shadow-card)', backgroundColor: '#FFFFFF' }}>
              <Box sx={{ p: '16px 19px' }}>
                <Typography sx={{ fontSize: '11px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', mb: '6px' }}>Total Dispatched Trips</Typography>
                <Typography sx={{ fontSize: '26px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>{bookings.length}</Typography>
                <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)', mt: '3px' }}>Recorded bookings</Typography>
              </Box>
            </Card>

            <Card sx={{ borderRadius: '14px', border: '1px solid var(--mac-border-color)', boxShadow: 'var(--mac-shadow-card)', backgroundColor: '#FFFFFF' }}>
              <Box sx={{ p: '16px 19px' }}>
                <Typography sx={{ fontSize: '11px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', mb: '6px' }}>Completed Trips</Typography>
                <Typography sx={{ fontSize: '26px', fontWeight: 700, color: '#059669' }}>{bookings.filter((b) => b.status === 'Completed').length}</Typography>
                <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)', mt: '3px' }}>Successful arrivals</Typography>
              </Box>
            </Card>

            <Card sx={{ borderRadius: '14px', border: '1px solid var(--mac-border-color)', boxShadow: 'var(--mac-shadow-card)', backgroundColor: '#FFFFFF' }}>
              <Box sx={{ p: '16px 19px' }}>
                <Typography sx={{ fontSize: '11px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', mb: '6px' }}>Shared Rides</Typography>
                <Typography sx={{ fontSize: '26px', fontWeight: 700, color: 'var(--sakay-orange)' }}>{bookings.filter((b) => b.tripMode === 'Shared Ride').length}</Typography>
                <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)', mt: '3px' }}>Multi-passenger carpools</Typography>
              </Box>
            </Card>

            <Card sx={{ borderRadius: '14px', border: '1px solid var(--mac-border-color)', boxShadow: 'var(--mac-shadow-card)', backgroundColor: '#FFFFFF' }}>
              <Box sx={{ p: '16px 19px' }}>
                <Typography sx={{ fontSize: '11px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', mb: '6px' }}>Cancelled Rides</Typography>
                <Typography sx={{ fontSize: '26px', fontWeight: 700, color: '#DC2626' }}>{bookings.filter((b) => b.status === 'Cancelled').length}</Typography>
                <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)', mt: '3px' }}>Cancelled trips</Typography>
              </Box>
            </Card>
          </Box>

          {/* 4. Filter Toolbar */}
          <FilterToolbar
            searchQuery={bookingSearch}
            onSearchChange={setBookingSearch}
            searchPlaceholder="Search trip code, passenger, driver, or plate..."
            selectFilters={[
              {
                id: 'mode',
                label: 'Trip Mode',
                value: modeFilter,
                options: modeOptions,
                onChange: setModeFilter,
              },
            ]}
            onResetFilters={() => {
              setBookingSearch('');
              setModeFilter('All');
            }}
          />

          {/* 5. Bookings History Table */}
          <TableContainer
            component={Paper}
            elevation={0}
            sx={{
              borderRadius: '14px',
              border: '1px solid var(--mac-border-color)',
              boxShadow: 'var(--mac-shadow-card)',
              overflow: 'hidden',
            }}
          >
            <Table>
              <TableHead sx={{ backgroundColor: '#FAFAFC' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, fontSize: '11.5px', color: 'var(--mac-text-muted)', py: '13px', px: '19px' }}>BOOKING CODE</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '11.5px', color: 'var(--mac-text-muted)', py: '13px', px: '19px' }}>PASSENGER</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '11.5px', color: 'var(--mac-text-muted)', py: '13px', px: '19px' }}>ASSIGNED DRIVER</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '11.5px', color: 'var(--mac-text-muted)', py: '13px', px: '19px' }}>ROUTE DISTANCE</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '11.5px', color: 'var(--mac-text-muted)', py: '13px', px: '19px' }}>TRIP MODE & FARE</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, fontSize: '11.5px', color: 'var(--mac-text-muted)', py: '13px', px: '19px' }}>STATUS</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: '38px' }}>
                      <CircularProgress size={22} sx={{ color: 'var(--sakay-orange)', mb: '6px' }} />
                      <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>Loading trip records...</Typography>
                    </TableCell>
                  </TableRow>
                ) : filteredBookings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: '38px' }}>
                      <Typography sx={{ fontSize: '12px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>No Trip Records Found</Typography>
                      <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)', mt: '3px' }}>
                        There are currently no trip records matching your selected filter.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredBookings.map((bkg) => (
                    <TableRow key={bkg.id} sx={{ '&:hover': { backgroundColor: 'var(--mac-canvas-bg)' } }}>
                      <TableCell sx={{ py: '13px', px: '19px', fontWeight: 600, fontSize: '12px', color: 'var(--sakay-orange)' }}>
                        {bkg.bookingCode}
                      </TableCell>

                      <TableCell sx={{ py: '13px', px: '19px' }}>
                        <Typography sx={{ fontSize: '12px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                          {bkg.passengerName}
                        </Typography>
                        <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>
                          {bkg.passengerPhone}
                        </Typography>
                      </TableCell>

                      <TableCell sx={{ py: '13px', px: '19px' }}>
                        <Typography sx={{ fontSize: '12px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                          {bkg.driverName}
                        </Typography>
                        <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>
                          {bkg.vehiclePlate}
                        </Typography>
                      </TableCell>

                      <TableCell sx={{ py: '13px', px: '19px' }}>
                        <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-primary)' }}>
                          {bkg.pickupLocation} → {bkg.dropoffLocation}
                        </Typography>
                        <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>
                          {bkg.distanceKm} km
                        </Typography>
                      </TableCell>

                      <TableCell sx={{ py: '13px', px: '19px' }}>
                        <Typography sx={{ fontSize: '12px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                          ₱{bkg.fareAmount}
                        </Typography>
                        <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>
                          {bkg.tripMode} (Cash)
                        </Typography>
                      </TableCell>

                      <TableCell align="right" sx={{ py: '13px', px: '19px' }}>
                        <StatusBadge status={bkg.status} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      ) : activeTab === 1 ? (
        <BookingVolumeReport trips={rawTrips} todaName={todaName} onExported={recordExport} />
      ) : activeTab === 2 ? (
        <DriverActivityReport trips={rawTrips} drivers={activityDrivers} onExported={recordExport} generatedBy={`${todaName} Administrator`} />
      ) : (
        /* 6. Incident Management Tab */
        <>
          <FilterToolbar
            searchQuery={incidentSearch}
            onSearchChange={setIncidentSearch}
            searchPlaceholder="Search incident ID, driver name, category, or description..."
            selectFilters={[
              {
                id: 'status',
                label: 'Incident Status',
                value: incidentStatusFilter,
                options: incidentStatusOptions,
                onChange: setIncidentStatusFilter,
              },
              {
                id: 'priority',
                label: 'Priority',
                value: incidentPriorityFilter,
                options: incidentPriorityOptions,
                onChange: setIncidentPriorityFilter,
              },
            ]}
            onResetFilters={() => {
              setIncidentSearch('');
              setIncidentStatusFilter('All');
              setIncidentPriorityFilter('All');
            }}
          />

          <TableContainer
            component={Paper}
            elevation={0}
            sx={{
              borderRadius: '14px',
              border: '1px solid var(--mac-border-color)',
              boxShadow: 'var(--mac-shadow-card)',
              overflow: 'hidden',
            }}
          >
            <Table>
              <TableHead sx={{ backgroundColor: '#FAFAFC' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, fontSize: '11.5px', color: 'var(--mac-text-muted)', py: '13px', px: '19px' }}>INCIDENT ID</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '11.5px', color: 'var(--mac-text-muted)', py: '13px', px: '19px' }}>INVOLVED DRIVER</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '11.5px', color: 'var(--mac-text-muted)', py: '13px', px: '19px' }}>COMPLAINT CATEGORY</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '11.5px', color: 'var(--mac-text-muted)', py: '13px', px: '19px' }}>PRIORITY</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '11.5px', color: 'var(--mac-text-muted)', py: '13px', px: '19px' }}>DATE SUBMITTED</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '11.5px', color: 'var(--mac-text-muted)', py: '13px', px: '19px' }}>STATUS</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, fontSize: '11.5px', color: 'var(--mac-text-muted)', py: '13px', px: '19px' }}>ACTIONS</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: '38px' }}>
                      <CircularProgress size={22} sx={{ color: 'var(--sakay-orange)', mb: '6px' }} />
                      <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>Loading incident reports...</Typography>
                    </TableCell>
                  </TableRow>
                ) : filteredIncidents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: '38px' }}>
                      <Typography sx={{ fontSize: '12px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>No Incident Reports Found</Typography>
                      <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)', mt: '3px' }}>
                        There are currently no passenger complaints recorded.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredIncidents.map((inc) => (
                    <TableRow key={inc.id} sx={{ '&:hover': { backgroundColor: 'var(--mac-canvas-bg)' } }}>
                      <TableCell sx={{ py: '13px', px: '19px', fontWeight: 600, fontSize: '12px', color: 'var(--sakay-orange)' }}>
                        #{inc.incidentCode || inc.id.slice(0, 8).toUpperCase()}
                      </TableCell>

                      <TableCell sx={{ py: '13px', px: '19px' }}>
                        <Typography sx={{ fontSize: '12px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                          {inc.driverName}
                        </Typography>
                        <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>
                          Plate: {inc.vehiclePlate}
                        </Typography>
                      </TableCell>

                      <TableCell sx={{ py: '13px', px: '19px' }}>
                        <Typography sx={{ fontSize: '12px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                          {inc.category}
                        </Typography>
                        <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>
                          Reporter: {inc.reporterName} ({inc.reporterRole})
                        </Typography>
                      </TableCell>

                      <TableCell sx={{ py: '13px', px: '19px' }}>
                        <Typography sx={{ fontSize: '11px', fontWeight: 700, color: inc.priority === 'Serious' ? '#991B1B' : inc.priority === 'Emergency' ? '#9A3412' : 'var(--mac-text-muted)' }}>{inc.priority ?? 'Standard'}</Typography>
                        {inc.overdue && <Typography sx={{ fontSize: '11px', fontWeight: 700, color: '#B91C1C' }}>Overdue</Typography>}
                        {inc.routing === 'LGU' && <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>With the LGU</Typography>}
                      </TableCell>

                      <TableCell sx={{ py: '13px', px: '19px', fontSize: '11.5px', color: 'var(--mac-text-secondary)' }}>
                        {inc.submittedAt}
                      </TableCell>

                      <TableCell sx={{ py: '13px', px: '19px' }}>
                        <StatusBadge status={inc.status} />
                      </TableCell>

                      <TableCell align="right" sx={{ py: '13px', px: '19px' }}>
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={<VisibilityIcon fontSize="small" />}
                          onClick={() => setSelectedIncidentId(inc.id)}
                          sx={{
                            height: 29,
                            px: '13px',
                            borderRadius: '6.5px',
                            fontSize: '11px',
                            fontWeight: 600,
                            textTransform: 'none',
                            color: 'var(--sakay-orange)',
                            borderColor: 'var(--sakay-orange-border)',
                            backgroundColor: 'var(--sakay-orange-soft)',
                            whiteSpace: 'nowrap',
                            '&:hover': {
                              backgroundColor: 'var(--sakay-orange)',
                              color: '#FFFFFF',
                            },
                          }}
                        >
                          Review Complaint
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      {/* Incident Review Detail Modal */}
      {selectedIncident && selectedIncident.record && (
        <MacCenterModal
          open={Boolean(selectedIncident)}
          onClose={() => setSelectedIncidentId(null)}
          title={`Incident Report #${selectedIncident.incidentCode || selectedIncident.id.slice(0, 8).toUpperCase()}`}
          subtitle={`Category: ${selectedIncident.category} • Submitted by ${selectedIncident.reporterName}`}
          maxWidth={544}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '19px' }}>
            <Box sx={{ backgroundColor: '#F8FAFC', p: '16px', borderRadius: '10px', border: '1px solid var(--mac-border-color)' }}>
              <Typography sx={{ fontSize: '11px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', mb: '6px' }}>
                Complaint Description
              </Typography>
              <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-primary)', lineHeight: 1.6 }}>
                {selectedIncident.description || 'No detailed description provided.'}
              </Typography>
            </Box>

            <Box sx={{ backgroundColor: '#F8FAFC', p: '16px', borderRadius: '10px', border: '1px solid var(--mac-border-color)' }}>
              <Typography sx={{ fontSize: '11px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', mb: '6px' }}>
                The trip
              </Typography>
              <Typography sx={{ fontSize: '11.5px', color: 'var(--mac-text-primary)', lineHeight: 1.6 }}>
                Trip {selectedIncident.tripId.slice(0, 8).toUpperCase()} · {selectedIncident.route}
              </Typography>
              <Box sx={{ display: 'flex', gap: '26px', flexWrap: 'wrap', mt: '10px' }}>
                {[
                  { label: 'Passenger', name: selectedIncident.passengerName, phone: selectedIncident.passengerPhone },
                  { label: `Driver (${selectedIncident.vehiclePlate})`, name: selectedIncident.driverName, phone: selectedIncident.driverPhone },
                ].map((p) => (
                  <Box key={p.label} sx={{ minWidth: 144 }}>
                    <Typography sx={{ fontSize: '11px', color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>{p.label}</Typography>
                    <Typography sx={{ fontSize: '11.5px', fontWeight: 600 }}>{p.name || '-'}</Typography>
                    {p.phone ? (
                      <Typography sx={{ fontSize: '11px' }}>
                        <a href={`tel:${p.phone}`} style={{ color: '#2563EB', fontWeight: 600 }}>{p.phone}</a>
                        {' · '}
                        <a href={`sms:${p.phone}`} style={{ color: '#2563EB' }}>SMS</a>
                      </Typography>
                    ) : (
                      <Typography sx={{ fontSize: '11px', color: '#94A3B8' }}>no number on record</Typography>
                    )}
                  </Box>
                ))}
              </Box>
            </Box>

            {(selectedIncident.evidenceFiles?.length ?? 0) > 0 && (
              <Box sx={{ backgroundColor: '#F8FAFC', p: '16px', borderRadius: '10px', border: '1px solid var(--mac-border-color)' }}>
                <Typography sx={{ fontSize: '11px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', mb: '6px' }}>
                  Attached Photo Evidence ({selectedIncident.evidenceFiles?.length})
                </Typography>
                <Box sx={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {selectedIncident.evidenceFiles?.map((file) => (
                    <Box key={file.url} component="a" href={file.url} target="_blank" rel="noreferrer" sx={{ display: 'block', lineHeight: 0 }}>
                      <Box component="img" src={file.url} alt={file.name} sx={{ width: 96, height: 96, objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--mac-border-color)' }} />
                    </Box>
                  ))}
                </Box>
              </Box>
            )}

            {selectedIncident.findings && (
              <Box sx={{ backgroundColor: '#EFF6FF', p: '16px', borderRadius: '10px', border: '1px solid #BFDBFE' }}>
                <Typography sx={{ fontSize: '11px', fontWeight: 600, color: '#1D4ED8', textTransform: 'uppercase', mb: '6px' }}>
                  Review Notes
                </Typography>
                <Typography sx={{ fontSize: '11.5px', color: '#1E3A8A', lineHeight: 1.6 }}>{selectedIncident.findings}</Typography>
              </Box>
            )}

            <Box sx={{ pt: '13px', borderTop: '1px solid var(--mac-border-color)' }}>
              <IncidentReviewPanel
                role="toda_admin"
                incident={selectedIncident.record}
                onStart={afterAction(() => startIncident(selectedIncident.id))}
                onEscalate={(reason, serious) => afterAction(() => escalateIncident(selectedIncident.id, reason, serious))()}
                onDecide={(d) => afterAction(() => decideIncident({ incidentId: selectedIncident.id, ...d }))()}
                onLostItem={(status, note) => afterAction(() => updateLostItemReport(selectedIncident.id, status, note))()}
              />
            </Box>
          </Box>
        </MacCenterModal>
      )}
    </Box>
  );
};
