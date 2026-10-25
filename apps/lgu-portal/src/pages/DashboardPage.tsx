import React, { useState, useEffect } from 'react';
import { Box, Typography, Button, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions, TextField } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

import { WelcomeHeader } from '../components/layout/WelcomeHeader';
import { FlagTag } from '../components/common/DataTable';
import { PageNotice } from '../components/common/PageNotice';
import { StatStrip } from '../components/common/StatStrip';
import type { StatItem } from '../components/common/StatStrip';
import { DashboardCard } from '../components/dashboard/DashboardCard';
import { BookingTrendCard } from '../components/dashboard/BookingTrendCard';
import { DriverVerificationCard } from '../components/dashboard/DriverVerificationCard';
import { LiveTripsMapCard } from '../components/dashboard/LiveTripsMapCard';
import { RecentIncidentReportsCard } from '../components/dashboard/RecentIncidentReportsCard';
import { RecentTodaApplicationsCard } from '../components/dashboard/RecentTodaApplicationsCard';
import { fetchDashboardStats, DashboardStats, fetchAdminReviewFlags, resolveAdminReviewFlag, confirmDeliberateOffline, confirmFlaggedViolation, confirmIntegrityFlag, sendConductWarning, fetchFareDisputes, closeUnfinishedTrip, confirmAvailabilityViolation } from '../services/adminApiService';
import { closeProblem, isAvailabilityFlag } from '@sakay/shared';
import { flagTypeLabel } from '../utils/flagTypeLabel';
import { FONT, SPACE } from '../styles/density';
import { PAGE_DIVIDER, PAGE_TEXT, dangerButtonSx, primaryButtonSx, rowActionSx, secondaryButtonSx } from '../styles/pageTheme';

/** The flags a detector raises (Rules 27.1, 27.3 - 27.6): the LGU Administrator confirms them, which records the violation against every account named */
const INTEGRITY_FLAG_TYPES = ['GPS_SPOOFING_REVIEW', 'RATING_MANIPULATION_REVIEW', 'COLLUSIVE_MATCHING_REVIEW', 'POSSIBLE_REREGISTRATION_REVIEW'];

/** A review flag still waiting for an administrator: the database says Open or Under Review (it never says "Pending"). */
const isOpenFlag = (f: any): boolean => f.status === 'Open' || f.status === 'Under Review';

const EVIDENCE_TEXT: Record<string, string> = {
  pattern_review: 'a pattern of interruptions found on review',
  passenger_report: "a passenger's report",
  admission: "the driver's own admission",
};

/** What the flag says, in plain lines, for the flags that carry their evidence with them (Rules 8.7, 9.5, 9.6, 17.5). */
const describeFlagDetails = (flag: any): string[] => {
  const d = flag?.details ?? {};
  if (flag?.flag_type === 'DRIVER_DELIBERATE_OFFLINE_REPORT') {
    return [
      "Reported by the driver's " + (d.reported_by_role === 'lgu_admin' ? 'LGU' : 'TODA') + ' Administrator. Evidence: ' + (EVIDENCE_TEXT[d.evidence] ?? d.evidence) + '.',
      d.note ? 'Note: ' + d.note : '',
      'Interruptions of this driver in the last 30 days: ' + (d.interruptions_last_30_days ?? 0) + '.',
      'Confirming issues 2 strikes; the driver cannot appeal this decision.',
    ].filter(Boolean);
  }
  if (flag?.flag_type === 'GPS_AREA_REVIEW') {
    return [
      'Area around ' + d.center_latitude + ', ' + d.center_longitude + ' (about 550 m square).',
      d.determinations + ' stall or lost-connection determinations in ' + d.window_days + ' days (' + d.stalls + ' stalls, ' + d.connectivity + ' lost connections).',
      d.note ? 'Reported by the TODA Administrator: ' + d.note : '',
      'Possible service-zone boundary adjustment.',
    ].filter(Boolean);
  }
  if (flag?.flag_type === 'PASSENGER_EARLY_END_PATTERN' || flag?.flag_type === 'PASSENGER_SAFETY_END_PATTERN') {
    return [
      d.count + ' ' + (d.kind === 'SAFETY' ? 'Safety Concern' : 'personal') + ' early terminations in ' + d.window_days + ' days.',
      d.note ?? '',
      d.kind === 'SAFETY' ? 'Review the trips and the reasons; there is no strike for a Safety Concern pattern.' : 'Confirming issues 1 strike, PAX_FARE_AVOIDANCE. The TODA Administrator may investigate the trips first.',
    ].filter(Boolean);
  }
  if (flag?.flag_type === 'DRIVER_EARLY_STOP_REVIEW') {
    return [
      'The driver ended booking ' + d.booking_id + ' before the destination. Reason: ' + d.reason + (d.valid_reason ? ' (a valid reason: no strike).' : '.'),
      d.valid_reason ? '' : 'Confirming issues DRV_EARLY_STOP (1 strike).',
    ].filter(Boolean);
  }
  if (isAvailabilityFlag(flag?.flag_type ?? '')) {
    return [
      (flag.flag_type === 'DRIVER_QUEUE_CONFLICT_REPORT' ? 'Queue conflict: Available in the app while queued at the terminal.' : 'Availability violation: accepted a booking while carrying other passengers.')
        + ' Reported by ' + String(d.reported_by ?? 'an administrator').replace('_', ' ') + '.',
      d.description ? '"' + d.description + '"' : '',
      'Confirming records the strike under your name. Nothing is struck until you confirm.',
    ].filter(Boolean);
  }
  if (flag?.flag_type === 'PAYMENT_STUCK_RECONCILIATION') {
    return ['Booking ' + d.booking_id + ' has been at the destination for 30 minutes without the driver tapping Payment Received. Contact both parties and close it as Paid or Waived.'];
  }
  if (flag?.flag_type === 'DRIVER_CHANGE_REFUSAL_PATTERN') {
    return [d.count + ' passengers reported that this driver refused to provide change in ' + d.window_days + ' days. Review the reports; there is no automatic strike.'];
  }
  if (flag?.flag_type === 'TRIP_MANUAL_RECONCILIATION') {
    return ['Booking ' + d.booking_id + ' has been without a driver location for 30 minutes. Close it from Live Trips after contacting both parties.'];
  }
  if (flag?.flag_type === 'TODA_RENEWAL_SUBMITTED') {
    return [
      (d.toda_name ?? 'A TODA') + ' sent a renewed Barangay Clearance' + (d.file_name ? ' ("' + d.file_name + '")' : '') + '.',
      d.declared_valid_until ? 'The TODA states it is valid until ' + d.declared_valid_until + '. Read the date on the document yourself.' : 'The TODA stated no validity date: read it from the document.',
      'Open the TODA under Accredited TODAs, check the document, then press Record Renewal. The accreditation and the certificate stay as they are until you do.',
    ];
  }
  if (flag?.flag_type === 'DUPLICATE_LICENSE' || flag?.flag_type === 'DUPLICATE_PLATE' || flag?.flag_type === 'DUPLICATE_MTOP') {
    const what = flag.flag_type === 'DUPLICATE_LICENSE' ? "Driver's License number" : flag.flag_type === 'DUPLICATE_PLATE' ? 'plate number' : 'MTOP franchise number';
    return ['A driver application uses a ' + what + (d.number ? ' (' + d.number + ')' : '') + ' that another driver already has. The application is not auto-approved: verify the documents of both drivers.'];
  }
  // Batch 11 (Sections 15, 19, 26; Rules 2.5, 29.19, 29.20, 29.22)
  if (flag?.flag_type === 'TODA_EXCESS_INCIDENTS') {
    return [d.upheld_reports + ' incident reports about drivers of this TODA were upheld in ' + d.window_days + ' days (the threshold is ' + d.threshold + '). Supervisory review; nothing is imposed automatically.'];
  }
  if (flag?.flag_type === 'DRIVER_DETENTION_LGU_REVIEW' || flag?.flag_type === 'DRIVER_DETENTION_TODA_REVIEW') {
    return ['The driver was detained or arrested during booking ' + d.booking_id + '. The account is on hold until BOTH the TODA and the LGU reviews are resolved; then reinstate it from the driver record.', d.note ? 'How it was confirmed: ' + d.note : ''].filter(Boolean);
  }
  if (flag?.flag_type === 'DRIVER_INCAPACITATED_REVIEW') {
    return ['The driver became ill during booking ' + d.booking_id + '. No strike is issued pending the review.', d.note ? 'How it was confirmed: ' + d.note : ''].filter(Boolean);
  }
  if (flag?.flag_type === 'DRIVER_SAFE_REASON_REVIEW' || flag?.flag_type === 'DRIVER_SAFE_REASON_PATTERN') {
    return ['The driver cancelled or stopped for a reason that is not struck (a breakdown, an accident, an emergency, a safety concern, a road closure, an unsafe request). The TODA Administrator of the driver verifies it; no strike was issued.', d.events_in_window ? d.events_in_window + ' such events in ' + d.window_days + ' days.' : ''].filter(Boolean);
  }
  if (flag?.flag_type === 'LOST_ITEM_UNCLAIMED_REVIEW') {
    return ['A lost-item report has had no contact and no result for 14 days. The TODA Administrator arranges the contact or closes it as Unclaimed.'];
  }
  if (flag?.flag_type === 'DRIVER_LOW_RATING_REVIEW' || flag?.flag_type === 'PASSENGER_LOW_RATING_REVIEW') {
    return [String(d.note ?? 'The average rating is under 3.00 after at least 20 completed trips.'), 'Average ' + d.average + ' from ' + d.rating_count + ' ratings over ' + d.completed_trips + ' completed trips. Ratings never change booking or dispatch.'];
  }
  if (flag?.flag_type === 'GPS_SPOOFING_REVIEW') {
    const trips = Array.isArray(d.suspect_trips) ? d.suspect_trips : [];
    return [String(d.note ?? ''), trips.length + ' suspect trip(s) among the last ' + (d.window_trips ?? 10) + ' completed trips.'].filter(Boolean).concat(trips.map((x: any) => 'Trip ' + String(x.booking_id).slice(0, 8).toUpperCase() + ': ' + x.teleport_fixes + ' impossible jumps' + (x.distance_mismatch ? ', tracked ' + x.tracked_km + ' km against the quoted ' + x.quoted_km + ' km' : '')));
  }
  if (flag?.flag_type === 'RATING_MANIPULATION_REVIEW') {
    return [String(d.note ?? ''), 'Pattern: ' + String(d.pattern ?? '').replace(/_/g, ' ').toLowerCase() + ', ' + (Array.isArray(d.rating_ids) ? d.rating_ids.length : 0) + ' ratings. Confirming excludes these ratings and records 2 strikes for each account named.'];
  }
  if (flag?.flag_type === 'COLLUSIVE_MATCHING_REVIEW') {
    return [String(d.note ?? ''), d.matches + ' matches in ' + d.window_days + ' days. Confirming deactivates both accounts for review.'];
  }
  if (flag?.flag_type === 'POSSIBLE_REREGISTRATION_REVIEW') {
    const linked = Array.isArray(d.linked) ? d.linked : [];
    return [String(d.note ?? ''), 'Matched on: ' + (Array.isArray(d.basis) ? d.basis.join(', ').replace(/_/g, ' ') : '-') + '. Linked account(s): ' + linked.map((x: any) => x.type + ' ' + String(x.id).slice(0, 8) + (x.state ? ' (' + String(x.state).toLowerCase() + ')' : '')).join('; ') + '. Confirming deactivates them for review; closing them for good is a separate action on each account.'];
  }
  return [];
};

export const DashboardPage: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Dismissible alert states
  const [showTodaAlert, setShowTodaAlert] = useState(true);
  const [showOverdueAlert, setShowOverdueAlert] = useState(true);

  // Administrative review flags (Rules 2.4, 2.5, 3.7)
  const [adminFlags, setAdminFlags] = useState<any[]>([]);
  const [selectedFlag, setSelectedFlag] = useState<any | null>(null);
  const [flagResolutionText, setFlagResolutionText] = useState('');
  const [flagDialogOpen, setFlagDialogOpen] = useState(false);
  const [flagError, setFlagError] = useState<string | null>(null);
  // Rules 13.5 / 18.4 / 18.6: fare disputes waiting for an administrator (the panel is on Live Trips)
  const [disputeCount, setDisputeCount] = useState<{ waiting: number; overdue: number }>({ waiting: 0, overdue: 0 });

  useEffect(() => {
    let isMounted = true;
    fetchDashboardStats()
      .then((data) => {
        if (isMounted) {
          setStats(data);
        }
      })
      .catch((err) => {
        console.error('[DashboardPage] Failed to fetch live dashboard stats:', err);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    fetchFareDisputes()
      .then((rows) => {
        const waiting = rows.filter((r) => r.status !== 'Resolved');
        if (isMounted) setDisputeCount({ waiting: waiting.length, overdue: waiting.filter((r) => r.overdue).length });
      })
      .catch((err) => console.warn('[DashboardPage] Failed to fetch fare disputes:', err));

    fetchAdminReviewFlags()
      .then((flags) => {
        if (isMounted) setAdminFlags(flags || []);
      })
      .catch((err) => {
        console.warn('[DashboardPage] Failed to fetch admin flags:', err);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleResolveFlag = async () => {
    if (!selectedFlag) return;
    try {
      await resolveAdminReviewFlag(selectedFlag.flag_id, flagResolutionText || 'Resolved by LGU Administrator');
      setAdminFlags((prev) =>
        prev.map((f) =>
          f.flag_id === selectedFlag.flag_id
            ? { ...f, status: 'Resolved', resolution: flagResolutionText || 'Resolved' }
            : f
        )
      );
      setFlagDialogOpen(false);
      setSelectedFlag(null);
      setFlagResolutionText('');
    } catch (err) {
      console.error('[DashboardPage] Flag resolve error:', err);
    }
  };

  // Rule 9.6: the LGU Administrator confirms the TODA Administrator's report of a deliberate offline: 2 strikes
  const handleConfirmDeliberateOffline = async () => {
    if (!selectedFlag) return;
    const message = await confirmDeliberateOffline(selectedFlag.flag_id, flagResolutionText);
    if (message) {
      setFlagError(message);
      return;
    }
    setAdminFlags((prev) => prev.map((f) => (f.flag_id === selectedFlag.flag_id ? { ...f, status: 'Resolved', resolution: 'Confirmed: 2 strikes' } : f)));
    setFlagDialogOpen(false);
    setSelectedFlag(null);
    setFlagResolutionText('');
    setFlagError(null);
  };

  // Rules 27.1, 27.3 - 27.6: confirm what a detector flag points at
  const handleConfirmIntegrity = async () => {
    if (!selectedFlag) return;
    const message = await confirmIntegrityFlag(selectedFlag.flag_id, flagResolutionText);
    if (message) {
      setFlagError(message);
      return;
    }
    setAdminFlags((prev) => prev.map((f) => (f.flag_id === selectedFlag.flag_id ? { ...f, status: 'Resolved', resolution: 'Violation confirmed' } : f)));
    setFlagDialogOpen(false);
    setSelectedFlag(null);
    setFlagResolutionText('');
    setFlagError(null);
  };

  // Rules 5.3 / 5.7: the LGU Administrator confirms a reported queue conflict or availability violation: the strike is recorded under their name
  const handleConfirmAvailability = async () => {
    if (!selectedFlag) return;
    const message = await confirmAvailabilityViolation(selectedFlag.flag_id, flagResolutionText);
    if (message) {
      setFlagError(message);
      return;
    }
    setAdminFlags((prev) => prev.map((f) => (f.flag_id === selectedFlag.flag_id ? { ...f, status: 'Resolved', resolution: 'Violation confirmed' } : f)));
    setFlagDialogOpen(false);
    setSelectedFlag(null);
    setFlagResolutionText('');
    setFlagError(null);
  };

  // PI-15: a trip left at the destination (Payment Received never tapped) is closed as Paid or Waived after the parties were contacted; this also resolves the flag
  const handleCloseStuckTrip = async (paymentStatus: 'Paid' | 'Waived') => {
    if (!selectedFlag) return;
    const bookingId = selectedFlag.details?.booking_id;
    if (typeof bookingId !== 'string') {
      setFlagError('This flag does not name a trip.');
      return;
    }
    const message = await closeUnfinishedTrip(bookingId, paymentStatus, flagResolutionText);
    if (message) {
      setFlagError(message);
      return;
    }
    setAdminFlags((prev) => prev.map((f) => (f.flag_id === selectedFlag.flag_id ? { ...f, status: 'Resolved', resolution: `Trip closed as ${paymentStatus}` } : f)));
    setFlagDialogOpen(false);
    setSelectedFlag(null);
    setFlagResolutionText('');
    setFlagError(null);
  };

  // Rule 23.4: a passenger whose average stayed under 3.00 after 20 trips may get a warning
  const handleSendWarning = async () => {
    if (!selectedFlag) return;
    const message = await sendConductWarning(selectedFlag.flag_id, flagResolutionText);
    if (message) {
      setFlagError(message);
      return;
    }
    setAdminFlags((prev) => prev.map((f) => (f.flag_id === selectedFlag.flag_id ? { ...f, status: 'Resolved', resolution: 'Warning sent' } : f)));
    setFlagDialogOpen(false);
    setSelectedFlag(null);
    setFlagResolutionText('');
    setFlagError(null);
  };

  // Rules 13.6 / 13.7: the LGU Administrator confirms the strike a review flag points at
  const handleConfirmViolation = async () => {
    if (!selectedFlag) return;
    const message = await confirmFlaggedViolation(selectedFlag.flag_id, selectedFlag.details?.booking_id ?? null, flagResolutionText);
    if (message) {
      setFlagError(message);
      return;
    }
    setAdminFlags((prev) => prev.map((f) => (f.flag_id === selectedFlag.flag_id ? { ...f, status: 'Resolved', resolution: 'Violation confirmed' } : f)));
    setFlagDialogOpen(false);
    setSelectedFlag(null);
    setFlagResolutionText('');
    setFlagError(null);
  };

  const kpis = stats?.kpis || {
    passengers: { total: 0, active: 0, inactive: 0 },
    drivers: { total: 0, active: 0, inactive: 0 },
    todas: { total: 0, pendingReview: 0 },
    trips: { total: 0, ongoing: 0, allBookings: 0, cancelled: 0 },
    verifications: { pending: 0, overdue5Days: 0 },
    incidents: { open: 0, total: 0, resolved: 0 },
  };

  const flaggedTodas = stats?.flaggedTodas || [];

  const openFlags = adminFlags.filter(isOpenFlag);
  const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);
  // the number while the page is still reading it, then the figure
  const figure = (n: number) => (isLoading ? <CircularProgress size={24} aria-label="Loading" sx={{ color: 'var(--sakay-orange)' }} /> : n.toLocaleString());

  const statItems: StatItem[] = [
    {
      key: 'passengers',
      label: 'Passengers',
      value: figure(kpis.passengers.total),
      note: isLoading ? undefined : `${kpis.passengers.active} active, ${kpis.passengers.inactive} inactive`,
      to: '/passengers',
    },
    {
      key: 'drivers',
      label: 'Drivers',
      value: figure(kpis.drivers.total),
      note: isLoading ? undefined : `${kpis.drivers.active} verified, ${kpis.drivers.inactive} not verified`,
      to: '/drivers',
    },
    {
      key: 'todas',
      label: 'Accredited TODAs',
      value: figure(kpis.todas.total),
      note: isLoading ? undefined : `${kpis.todas.pendingReview} pending review`,
      to: '/accredited-todas',
    },
    {
      key: 'trips',
      label: 'Completed trips',
      value: figure(kpis.trips.total),
      note: isLoading ? undefined : `${kpis.trips.ongoing} in transit, ${kpis.trips.cancelled} cancelled, ${kpis.trips.allBookings} bookings in all`,
      to: '/live-trips',
    },
    {
      key: 'verifications',
      label: 'Pending verifications',
      value: figure(kpis.verifications.pending),
      tone: kpis.verifications.pending > 0 ? 'brand' : 'neutral',
      note: isLoading ? undefined : `${kpis.todas.pendingReview} TODA, ${kpis.verifications.pending - kpis.todas.pendingReview} drivers`,
      to: '/toda-applications',
    },
    {
      key: 'incidents',
      label: 'Open incidents',
      value: figure(kpis.incidents.open),
      tone: kpis.incidents.open > 0 ? 'danger' : 'neutral',
      note: isLoading ? undefined : `${kpis.incidents.resolved} resolved, ${kpis.incidents.total} reports in all`,
      to: '/incident-reports',
    },
  ];

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 4.8 }}>
      <WelcomeHeader />

      {/* Alerts: the same quiet look for each; the button opens the screen that handles it */}
      {showTodaAlert && flaggedTodas.length > 0 && (
        <PageNotice
          tone="warning"
          title={`${flaggedTodas.length} ${plural(flaggedTodas.length, 'TODA needs', 'TODAs need')} a supervisory review`}
          action={<Button component={RouterLink} to="/accredited-todas" sx={rowActionSx('neutral')}>Review TODAs</Button>}
          onDismiss={() => setShowTodaAlert(false)}
        >
          {flaggedTodas.map((t) => t.name).join(', ')} {plural(flaggedTodas.length, 'has', 'have')} 3 or more confirmed incident reports.
        </PageNotice>
      )}

      {showOverdueAlert && kpis.verifications.overdue5Days > 0 && (
        <PageNotice
          tone="danger"
          title="Verification requests are overdue"
          action={<Button component={RouterLink} to="/toda-applications" sx={rowActionSx('danger')}>View pending</Button>}
          onDismiss={() => setShowOverdueAlert(false)}
        >
          {kpis.verifications.overdue5Days} verification {plural(kpis.verifications.overdue5Days, 'request has', 'requests have')} been pending for more than 5 days and {plural(kpis.verifications.overdue5Days, 'needs', 'need')} review now.
        </PageNotice>
      )}

      {disputeCount.waiting > 0 && (
        <PageNotice tone="warning" action={<Button component={RouterLink} to="/live-trips" sx={rowActionSx('neutral')}>Open Live Trips</Button>}>
          {disputeCount.waiting} fare {plural(disputeCount.waiting, 'dispute', 'disputes')} waiting for an administrator
          {disputeCount.overdue > 0 ? ' (' + disputeCount.overdue + ' overdue)' : ''}.
        </PageNotice>
      )}

      {/* The key numbers: each one opens the screen that lists those records */}
      <StatStrip stats={statItems} />

      {/* Administrative review flags (Rules 2.4, 2.5, 3.7) */}
      {openFlags.length > 0 && (
        <Box sx={{ mb: SPACE.gapLarge }}>
          <DashboardCard
            title="Review flags"
            description="Items that need an administrator's decision."
            titleAdornment={<FlagTag label={`${openFlags.length} pending`} tone="warning" />}
          >
            <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', '& > li + li': { borderTop: `1px solid ${PAGE_DIVIDER}` } }}>
              {openFlags.slice(0, 12).map((flag) => (
                <Box
                  component="li"
                  key={flag.flag_id}
                  sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px 12px', py: '10px' }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.primary }}>{flagTypeLabel(flag.flag_type)}</Typography>
                    <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '1px', overflowWrap: 'anywhere' }}>
                      {flag.subject_type}: <Box component="span" sx={{ fontFamily: 'monospace' }}>{flag.subject_id}</Box>
                      {' · '}
                      {new Date(flag.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </Typography>
                  </Box>

                  <Button
                    aria-label={`Resolve flag: ${flagTypeLabel(flag.flag_type)}`}
                    onClick={() => {
                      setSelectedFlag(flag);
                      setFlagDialogOpen(true);
                    }}
                    sx={rowActionSx('brand')}
                  >
                    Resolve flag
                  </Button>
                </Box>
              ))}
            </Box>
          </DashboardCard>
        </Box>
      )}

      {/* Booking trend and driver verification */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '7fr 5fr' }, gap: SPACE.gapLarge, mb: SPACE.gapLarge }}>
        <BookingTrendCard />
        <DriverVerificationCard data={stats?.driverBreakdown} />
      </Box>

      {/* The live map and the two most recent lists */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', lg: '1fr 1fr 1fr' }, gap: SPACE.gapLarge }}>
        <LiveTripsMapCard ongoingTripsCount={kpis.trips.ongoing} />
        <RecentTodaApplicationsCard applications={stats?.recentApplications} />
        <RecentIncidentReportsCard reports={stats?.recentIncidents} />
      </Box>

      {/* Flag Resolution Dialog */}
      <Dialog open={flagDialogOpen} onClose={() => setFlagDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, fontSize: FONT.cardTitle, color: PAGE_TEXT.primary }}>
          Resolve flag: {flagTypeLabel(selectedFlag?.flag_type)}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, mb: 1.6 }}>
            Provide resolution notes for {selectedFlag?.subject_type} {selectedFlag?.subject_id} ({selectedFlag?.source_rule}).
          </Typography>
          {describeFlagDetails(selectedFlag).length > 0 && (
            <Box sx={{ mb: 1.6, p: 1.2, borderRadius: '8px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}>
              {describeFlagDetails(selectedFlag).map((line, i) => (
                <Typography key={i} sx={{ fontSize: FONT.body, color: PAGE_TEXT.primary, lineHeight: 1.5 }}>
                  {line}
                </Typography>
              ))}
            </Box>
          )}
          {flagError && (
            <Typography role="alert" sx={{ fontSize: FONT.body, color: PAGE_TEXT.danger, mb: 1.2 }}>{flagError}</Typography>
          )}
          <TextField
            autoFocus
            fullWidth
            multiline
            rows={3}
            label="Resolution notes"
            value={flagResolutionText}
            onChange={(e) => setFlagResolutionText(e.target.value)}
            placeholder="e.g. Verified with manual certificate, franchise validated, or inspection completed..."
          />
        </DialogContent>
        <DialogActions sx={{ p: 1.6, flexWrap: 'wrap', gap: 1, '& > :not(style) ~ :not(style)': { ml: 0 } }}>
          <Button onClick={() => { setFlagDialogOpen(false); setFlagError(null); }} sx={secondaryButtonSx}>
            Cancel
          </Button>
          {selectedFlag?.flag_type === 'DRIVER_DELIBERATE_OFFLINE_REPORT' && (
            <Button
              onClick={handleConfirmDeliberateOffline}
              variant="contained"
              disabled={!flagResolutionText.trim()}
              sx={dangerButtonSx}
            >
              Confirm: 2 strikes
            </Button>
          )}
          {(selectedFlag?.flag_type === 'PASSENGER_EARLY_END_PATTERN' || (selectedFlag?.flag_type === 'DRIVER_EARLY_STOP_REVIEW' && selectedFlag?.details?.valid_reason === false)) && (
            <Button
              onClick={handleConfirmViolation}
              variant="contained"
              disabled={flagResolutionText.trim().length < 10}
              sx={dangerButtonSx}
            >
              Confirm: 1 strike
            </Button>
          )}
          {INTEGRITY_FLAG_TYPES.includes(selectedFlag?.flag_type) && (
            <Button
              onClick={handleConfirmIntegrity}
              variant="contained"
              disabled={flagResolutionText.trim().length < 10}
              sx={dangerButtonSx}
            >
              Confirm the violation
            </Button>
          )}
          {isAvailabilityFlag(selectedFlag?.flag_type ?? '') && (
            <Button
              onClick={handleConfirmAvailability}
              variant="contained"
              disabled={flagResolutionText.trim().length < 10}
              sx={dangerButtonSx}
            >
              Confirm: record the strike
            </Button>
          )}
          {selectedFlag?.flag_type === 'PAYMENT_STUCK_RECONCILIATION' && (
            <>
              <Button
                onClick={() => handleCloseStuckTrip('Paid')}
                variant="contained"
                disabled={closeProblem('Paid', flagResolutionText) !== null}
                sx={primaryButtonSx}
              >
                Close the trip: Paid
              </Button>
              <Button
                onClick={() => handleCloseStuckTrip('Waived')}
                variant="outlined"
                disabled={closeProblem('Waived', flagResolutionText) !== null}
                sx={secondaryButtonSx}
              >
                Close the trip: Waived
              </Button>
            </>
          )}
          {selectedFlag?.flag_type === 'PASSENGER_LOW_RATING_REVIEW' && (
            <Button
              onClick={handleSendWarning}
              variant="contained"
              disabled={flagResolutionText.trim().length < 10}
              sx={primaryButtonSx}
            >
              Send the passenger a warning
            </Button>
          )}
          <Button onClick={handleResolveFlag} variant="contained" sx={primaryButtonSx}>
            Mark as resolved
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
