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
import DownloadIcon from '@mui/icons-material/Download';
import CloseIcon from '@mui/icons-material/Close';
import VisibilityIcon from '@mui/icons-material/Visibility';
import RefreshIcon from '@mui/icons-material/Refresh';

import { TodaBooking, TodaIncident } from '../types/toda';
import { FilterToolbar, FilterOption } from '../components/admin/FilterToolbar';
import { StatusBadge } from '../components/common/StatusBadge';
import { ActionButton } from '../components/admin/ActionButton';
import { MacCenterModal } from '../components/admin/MacCenterModal';
import { MacConfirmDialog } from '../components/admin/MacConfirmDialog';
import { BookingVolumeReport } from '../components/reports/BookingVolumeReport';
import { DriverActivityReport } from '../components/reports/DriverActivityReport';
import type { ActivityDriver } from '../components/reports/DriverActivityReport';
import { downloadCsv, reportFileName } from '../utils/csvDownload';
import type { BookingLike } from '@sakay/shared';
import {
  fetchTodaDrivers,
  fetchTodaOperationsTrips,
  fetchTodaIncidents,
  fetchTodaProfile,
  escalateIncidentToLgu,
  submitIncidentRemarks,
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

  // Incident Review Modals & Dialogs
  const [selectedIncident, setSelectedIncident] = useState<TodaIncident | null>(null);
  const [escalateDialogOpen, setEscalateDialogOpen] = useState(false);
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);

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

      const mappedIncidents: TodaIncident[] = (incData || []).map((inc: any) => ({
        id: inc.incident_id,
        incidentCode: (inc.incident_id || '').slice(0, 8).toUpperCase(),
        bookingId: inc.booking_id || inc.trip_id || 'BKG-001',
        driverName: inc.driver?.full_name || inc.driver_name || 'Driver',
        vehiclePlate: inc.driver?.plate_number || inc.vehicle_plate || 'N/A',
        category: inc.category || 'Service Quality',
        description: inc.description || '',
        reporterName: inc.passenger?.full_name || inc.passenger_name || (inc.reported_by === 'Driver' ? 'Driver' : 'Passenger'),
        reporterRole: (inc.reported_by || 'Passenger') as any,
        submittedAt: inc.created_at ? new Date(inc.created_at).toLocaleDateString('en-US') : 'Recent',
        status: (inc.status === 'Resolved'
          ? 'Resolved (TODA Level)'
          : inc.status === 'Under Investigation'
          ? (String(inc.resolution_notes || inc.resolution || '').startsWith('[Escalated to LGU') ? 'Escalated to LGU' : 'Under Investigation')
          : inc.status === 'Dismissed' || inc.status === 'Cancelled'
          ? 'Dismissed'
          : 'Pending Review') as any,
        findings: inc.status === 'Cancelled' ? `Withdrawn by the reporter: ${inc.cancellation_reason || 'no reason given'}` : (inc.resolution_notes || inc.resolution || undefined),
        tripId: inc.booking_id || inc.trip_id || 'TRIP-001',
        evidenceFiles: inc.evidence_files ?? [],
      }));

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
    return matchesSearch && matchesStatus;
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
    { label: 'Escalated to LGU', value: 'Escalated to LGU' },
    { label: 'Dismissed', value: 'Dismissed' },
  ];

  // Export a report as a CSV file (opens in Excel) and record it in the audit log
  const recordExport = (reportName: string) => {
    recordTodaAuditAction({
      actionType: 'REPORT_EXPORTED',
      targetId: 'REPORT',
      targetName: reportName,
      details: `Exported ${reportName} (CSV) for ${todaName}.`,
      category: 'Operations',
    });
  };

  const exportLedger = () => {
    const name = 'Operations Trip Ledger';
    downloadCsv(
      reportFileName(name),
      ['Booking Code', 'Passenger', 'Driver', 'Vehicle Plate', 'Pickup', 'Dropoff', 'Distance (km)', 'Fare (PHP)', 'Mode', 'Status', 'Time'],
      filteredBookings.map((b) => [b.bookingCode, b.passengerName, b.driverName, b.vehiclePlate, b.pickupLocation, b.dropoffLocation, b.distanceKm, b.fareAmount, b.tripMode, b.status, b.timestamp])
    );
    recordExport(name);
  };

  const exportIncidents = () => {
    const name = 'Incident Summary';
    downloadCsv(
      reportFileName(name),
      ['Incident Code', 'Driver', 'Vehicle Plate', 'Reported By', 'Category', 'Date', 'Status', 'Description'],
      filteredIncidents.map((i) => [i.incidentCode || i.id.slice(0, 8), i.driverName, i.vehiclePlate, `${i.reporterName} (${i.reporterRole})`, i.category, i.submittedAt, i.status, i.description])
    );
    recordExport(name);
  };

  // Incident Handlers
  const handleResolveIncident = async () => {
    if (!selectedIncident) return;

    await submitIncidentRemarks(selectedIncident.id, 'Resolved at TODA administration level.', 'Resolved');

    setIncidents((prev) =>
      prev.map((i) =>
        i.id === selectedIncident.id ? { ...i, status: 'Resolved (TODA Level)' } : i
      )
    );

    setResolveDialogOpen(false);
    setSelectedIncident(null);
  };

  const handleEscalateIncident = async () => {
    if (!selectedIncident) return;

    await escalateIncidentToLgu(selectedIncident.id, 'Escalated from TODA portal review.');

    setIncidents((prev) =>
      prev.map((i) =>
        i.id === selectedIncident.id ? { ...i, status: 'Escalated to LGU' } : i
      )
    );

    setEscalateDialogOpen(false);
    setSelectedIncident(null);
  };

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 6 }}>
      {/* 1. Page Header & Refresh Control */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3.5, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography sx={{ fontSize: '20px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>
            TODA Operations Reports & Incident Grievances
          </Typography>
          <Typography sx={{ fontSize: '13.5px', color: 'var(--mac-text-muted)', mt: '3px' }}>
            Official operational trip audits and passenger complaints for {todaName}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          {(activeTab === 0 || activeTab === 3) && (
            <Button
              onClick={activeTab === 0 ? exportLedger : exportIncidents}
              startIcon={<DownloadIcon />}
              variant="contained"
              size="small"
              sx={{ textTransform: 'none', backgroundColor: 'var(--sakay-orange)', fontWeight: 600 }}
            >
              Export {activeTab === 0 ? 'Trip Ledger' : 'Incident Summary'} (CSV)
            </Button>
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
      <Box sx={{ borderBottom: '1px solid var(--mac-border-color)', mb: 3.5 }}>
        <Tabs
          value={activeTab}
          onChange={(_, val) => setActiveTab(val)}
          sx={{
            minHeight: 46,
            '& .MuiTab-root': {
              textTransform: 'none',
              fontSize: '15.5px',
              fontWeight: 600,
              minHeight: 46,
              color: 'var(--mac-text-muted)',
              '&.Mui-selected': { color: 'var(--sakay-orange)' },
            },
            '& .MuiTabs-indicator': { backgroundColor: 'var(--sakay-orange)', height: 3 },
          }}
        >
          <Tab icon={<AssessmentIcon sx={{ fontSize: 20 }} />} iconPosition="start" label={`Operations Trip Ledger (${bookings.length})`} />
          <Tab icon={<EventNoteIcon sx={{ fontSize: 20 }} />} iconPosition="start" label="Booking Volume & Fares" />
          <Tab icon={<PeopleIcon sx={{ fontSize: 20 }} />} iconPosition="start" label="Driver Activity" />
          <Tab icon={<ReportProblemIcon sx={{ fontSize: 20 }} />} iconPosition="start" label={`Incident Reports & Complaints (${incidents.length})`} />
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
              gap: 2.5,
              mb: 3.5,
            }}
          >
            <Card sx={{ borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', boxShadow: 'var(--mac-shadow-card)', backgroundColor: '#FFFFFF' }}>
              <Box sx={{ p: '20px 24px' }}>
                <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', mb: 1 }}>Total Dispatched Trips</Typography>
                <Typography sx={{ fontSize: '32px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>{bookings.length}</Typography>
                <Typography sx={{ fontSize: '12.5px', color: 'var(--mac-text-muted)', mt: 0.5 }}>Recorded bookings</Typography>
              </Box>
            </Card>

            <Card sx={{ borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', boxShadow: 'var(--mac-shadow-card)', backgroundColor: '#FFFFFF' }}>
              <Box sx={{ p: '20px 24px' }}>
                <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', mb: 1 }}>Completed Trips</Typography>
                <Typography sx={{ fontSize: '32px', fontWeight: 700, color: '#059669' }}>{bookings.filter((b) => b.status === 'Completed').length}</Typography>
                <Typography sx={{ fontSize: '12.5px', color: 'var(--mac-text-muted)', mt: 0.5 }}>Successful arrivals</Typography>
              </Box>
            </Card>

            <Card sx={{ borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', boxShadow: 'var(--mac-shadow-card)', backgroundColor: '#FFFFFF' }}>
              <Box sx={{ p: '20px 24px' }}>
                <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', mb: 1 }}>Shared Rides</Typography>
                <Typography sx={{ fontSize: '32px', fontWeight: 700, color: 'var(--sakay-orange)' }}>{bookings.filter((b) => b.tripMode === 'Shared Ride').length}</Typography>
                <Typography sx={{ fontSize: '12.5px', color: 'var(--mac-text-muted)', mt: 0.5 }}>Multi-passenger carpools</Typography>
              </Box>
            </Card>

            <Card sx={{ borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', boxShadow: 'var(--mac-shadow-card)', backgroundColor: '#FFFFFF' }}>
              <Box sx={{ p: '20px 24px' }}>
                <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', mb: 1 }}>Cancelled Rides</Typography>
                <Typography sx={{ fontSize: '32px', fontWeight: 700, color: '#DC2626' }}>{bookings.filter((b) => b.status === 'Cancelled').length}</Typography>
                <Typography sx={{ fontSize: '12.5px', color: 'var(--mac-text-muted)', mt: 0.5 }}>Cancelled trips</Typography>
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
              borderRadius: 'var(--mac-radius-lg)',
              border: '1px solid var(--mac-border-color)',
              boxShadow: 'var(--mac-shadow-card)',
              overflow: 'hidden',
            }}
          >
            <Table>
              <TableHead sx={{ backgroundColor: '#FAFAFC' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, fontSize: '14px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>BOOKING CODE</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '14px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>PASSENGER</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '14px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>ASSIGNED DRIVER</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '14px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>ROUTE DISTANCE</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '14px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>TRIP MODE & FARE</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, fontSize: '14px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>STATUS</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                      <CircularProgress size={28} sx={{ color: 'var(--sakay-orange)', mb: 1 }} />
                      <Typography sx={{ fontSize: '13.5px', color: 'var(--mac-text-muted)' }}>Loading trip records...</Typography>
                    </TableCell>
                  </TableRow>
                ) : filteredBookings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                      <Typography sx={{ fontSize: '15px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>No Trip Records Found</Typography>
                      <Typography sx={{ fontSize: '13px', color: 'var(--mac-text-muted)', mt: 0.5 }}>
                        There are currently no trip records matching your selected filter.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredBookings.map((bkg) => (
                    <TableRow key={bkg.id} sx={{ '&:hover': { backgroundColor: 'var(--mac-canvas-bg)' } }}>
                      <TableCell sx={{ py: 2, px: 3, fontWeight: 600, fontSize: '14.5px', color: 'var(--sakay-orange)' }}>
                        {bkg.bookingCode}
                      </TableCell>

                      <TableCell sx={{ py: 2, px: 3 }}>
                        <Typography sx={{ fontSize: '15px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                          {bkg.passengerName}
                        </Typography>
                        <Typography sx={{ fontSize: '13px', color: 'var(--mac-text-muted)' }}>
                          {bkg.passengerPhone}
                        </Typography>
                      </TableCell>

                      <TableCell sx={{ py: 2, px: 3 }}>
                        <Typography sx={{ fontSize: '15px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                          {bkg.driverName}
                        </Typography>
                        <Typography sx={{ fontSize: '13px', color: 'var(--mac-text-muted)' }}>
                          {bkg.vehiclePlate}
                        </Typography>
                      </TableCell>

                      <TableCell sx={{ py: 2, px: 3 }}>
                        <Typography sx={{ fontSize: '14.5px', color: 'var(--mac-text-primary)' }}>
                          {bkg.pickupLocation} → {bkg.dropoffLocation}
                        </Typography>
                        <Typography sx={{ fontSize: '13px', color: 'var(--mac-text-muted)' }}>
                          {bkg.distanceKm} km
                        </Typography>
                      </TableCell>

                      <TableCell sx={{ py: 2, px: 3 }}>
                        <Typography sx={{ fontSize: '15px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                          ₱{bkg.fareAmount}
                        </Typography>
                        <Typography sx={{ fontSize: '13px', color: 'var(--mac-text-muted)' }}>
                          {bkg.tripMode} (Cash)
                        </Typography>
                      </TableCell>

                      <TableCell align="right" sx={{ py: 2, px: 3 }}>
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
        <DriverActivityReport trips={rawTrips} drivers={activityDrivers} onExported={recordExport} />
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
            ]}
            onResetFilters={() => {
              setIncidentSearch('');
              setIncidentStatusFilter('All');
            }}
          />

          <TableContainer
            component={Paper}
            elevation={0}
            sx={{
              borderRadius: 'var(--mac-radius-lg)',
              border: '1px solid var(--mac-border-color)',
              boxShadow: 'var(--mac-shadow-card)',
              overflow: 'hidden',
            }}
          >
            <Table>
              <TableHead sx={{ backgroundColor: '#FAFAFC' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, fontSize: '14px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>INCIDENT ID</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '14px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>INVOLVED DRIVER</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '14px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>COMPLAINT CATEGORY</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '14px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>DATE SUBMITTED</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '14px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>STATUS</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, fontSize: '14px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>ACTIONS</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                      <CircularProgress size={28} sx={{ color: 'var(--sakay-orange)', mb: 1 }} />
                      <Typography sx={{ fontSize: '13.5px', color: 'var(--mac-text-muted)' }}>Loading incident reports...</Typography>
                    </TableCell>
                  </TableRow>
                ) : filteredIncidents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                      <Typography sx={{ fontSize: '15px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>No Incident Reports Found</Typography>
                      <Typography sx={{ fontSize: '13px', color: 'var(--mac-text-muted)', mt: 0.5 }}>
                        There are currently no passenger complaints recorded.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredIncidents.map((inc) => (
                    <TableRow key={inc.id} sx={{ '&:hover': { backgroundColor: 'var(--mac-canvas-bg)' } }}>
                      <TableCell sx={{ py: 2, px: 3, fontWeight: 600, fontSize: '14.5px', color: 'var(--sakay-orange)' }}>
                        #{inc.incidentCode || inc.id.slice(0, 8).toUpperCase()}
                      </TableCell>

                      <TableCell sx={{ py: 2, px: 3 }}>
                        <Typography sx={{ fontSize: '15px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                          {inc.driverName}
                        </Typography>
                        <Typography sx={{ fontSize: '13px', color: 'var(--mac-text-muted)' }}>
                          Plate: {inc.vehiclePlate}
                        </Typography>
                      </TableCell>

                      <TableCell sx={{ py: 2, px: 3 }}>
                        <Typography sx={{ fontSize: '15px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                          {inc.category}
                        </Typography>
                        <Typography sx={{ fontSize: '13px', color: 'var(--mac-text-muted)' }}>
                          Reporter: {inc.reporterName} ({inc.reporterRole})
                        </Typography>
                      </TableCell>

                      <TableCell sx={{ py: 2, px: 3, fontSize: '14px', color: 'var(--mac-text-secondary)' }}>
                        {inc.submittedAt}
                      </TableCell>

                      <TableCell sx={{ py: 2, px: 3 }}>
                        <StatusBadge status={inc.status} />
                      </TableCell>

                      <TableCell align="right" sx={{ py: 2, px: 3 }}>
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={<VisibilityIcon fontSize="small" />}
                          onClick={() => setSelectedIncident(inc)}
                          sx={{
                            height: 36,
                            px: 2,
                            borderRadius: '8px',
                            fontSize: '13.5px',
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
      {selectedIncident && (
        <MacCenterModal
          open={Boolean(selectedIncident)}
          onClose={() => setSelectedIncident(null)}
          title={`Incident Report #${selectedIncident.incidentCode || selectedIncident.id.slice(0, 8).toUpperCase()}`}
          subtitle={`Category: ${selectedIncident.category} • Submitted by ${selectedIncident.reporterName}`}
          maxWidth={640}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box sx={{ backgroundColor: '#F8FAFC', p: 2.5, borderRadius: '12px', border: '1px solid var(--mac-border-color)' }}>
              <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', mb: 1 }}>
                Complaint Description
              </Typography>
              <Typography sx={{ fontSize: '14.5px', color: 'var(--mac-text-primary)', lineHeight: 1.6 }}>
                {selectedIncident.description || 'No detailed description provided.'}
              </Typography>
            </Box>

            {(selectedIncident.evidenceFiles?.length ?? 0) > 0 && (
              <Box sx={{ backgroundColor: '#F8FAFC', p: 2.5, borderRadius: '12px', border: '1px solid var(--mac-border-color)' }}>
                <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', mb: 1 }}>
                  Attached Photo Evidence ({selectedIncident.evidenceFiles?.length})
                </Typography>
                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                  {selectedIncident.evidenceFiles?.map((file) => (
                    <Box key={file.url} component="a" href={file.url} target="_blank" rel="noreferrer" sx={{ display: 'block', lineHeight: 0 }}>
                      <Box component="img" src={file.url} alt={file.name} sx={{ width: 120, height: 120, objectFit: 'cover', borderRadius: '10px', border: '1px solid var(--mac-border-color)' }} />
                    </Box>
                  ))}
                </Box>
              </Box>
            )}

            {selectedIncident.findings && (
              <Box sx={{ backgroundColor: '#EFF6FF', p: 2.5, borderRadius: '12px', border: '1px solid #BFDBFE' }}>
                <Typography sx={{ fontSize: '13px', fontWeight: 600, color: '#1D4ED8', textTransform: 'uppercase', mb: 1 }}>
                  Review Notes
                </Typography>
                <Typography sx={{ fontSize: '14px', color: '#1E3A8A', lineHeight: 1.6 }}>{selectedIncident.findings}</Typography>
              </Box>
            )}

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5, pt: 2, borderTop: '1px solid var(--mac-border-color)' }}>
              <Button
                variant="outlined"
                onClick={() => setEscalateDialogOpen(true)}
                sx={{ textTransform: 'none', borderColor: '#DC2626', color: '#DC2626' }}
              >
                Escalate to City LGU
              </Button>
              <Button
                variant="contained"
                onClick={() => setResolveDialogOpen(true)}
                sx={{ textTransform: 'none', backgroundColor: '#059669', color: '#FFFFFF' }}
              >
                Mark Resolved (TODA Level)
              </Button>
            </Box>
          </Box>
        </MacCenterModal>
      )}

      {/* Confirmation Dialogs */}
      <MacConfirmDialog
        open={resolveDialogOpen}
        onClose={() => setResolveDialogOpen(false)}
        onConfirm={handleResolveIncident}
        title="Resolve Incident at TODA Level?"
        message="This will mark the complaint as resolved internally by the TODA administration board."
        confirmLabel="Confirm Resolution"
      />

      <MacConfirmDialog
        open={escalateDialogOpen}
        onClose={() => setEscalateDialogOpen(false)}
        onConfirm={handleEscalateIncident}
        title="Escalate Incident to City LGU?"
        message="This will forward the complaint to the Calapan City Transportation Board for formal municipal investigation."
        confirmLabel="Escalate to LGU"
        confirmVariant="danger"
      />
    </Box>
  );
};
