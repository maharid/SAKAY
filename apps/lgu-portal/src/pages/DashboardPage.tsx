import React, { useState, useEffect } from 'react';
import { Box, Typography, Card, CardContent, Button, IconButton, CircularProgress, Chip, Dialog, DialogTitle, DialogContent, DialogActions, TextField } from '@mui/material';
import PeopleIcon from '@mui/icons-material/People';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import RouteIcon from '@mui/icons-material/Route';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import CloseIcon from '@mui/icons-material/Close';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import FlagIcon from '@mui/icons-material/Flag';
import { useNavigate } from 'react-router-dom';

import { WelcomeHeader } from '../components/layout/WelcomeHeader';
import { BookingTrendCard } from '../components/dashboard/BookingTrendCard';
import { DriverVerificationCard } from '../components/dashboard/DriverVerificationCard';
import { LiveTripsMapCard } from '../components/dashboard/LiveTripsMapCard';
import { RecentIncidentReportsCard } from '../components/dashboard/RecentIncidentReportsCard';
import { RecentTodaApplicationsCard } from '../components/dashboard/RecentTodaApplicationsCard';
import { fetchDashboardStats, DashboardStats, fetchAdminReviewFlags, resolveAdminReviewFlag, confirmDeliberateOffline, confirmFlaggedViolation, confirmIntegrityFlag, sendConductWarning, fetchFareDisputes, closeUnfinishedTrip, confirmAvailabilityViolation } from '../services/adminApiService';
import { closeProblem, isAvailabilityFlag } from '@sakay/shared';

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
      'Confirming issues 2 strikes (Rule 9.6); the driver cannot appeal it under Rule 9.4.',
    ].filter(Boolean);
  }
  if (flag?.flag_type === 'GPS_AREA_REVIEW') {
    return [
      'Area around ' + d.center_latitude + ', ' + d.center_longitude + ' (about 550 m square).',
      d.determinations + ' stall or lost-connection determinations in ' + d.window_days + ' days (' + d.stalls + ' stalls, ' + d.connectivity + ' lost connections).',
      d.note ? 'Reported by the TODA Administrator: ' + d.note : '',
      'Possible service-zone boundary adjustment (Rule 17.5).',
    ].filter(Boolean);
  }
  if (flag?.flag_type === 'PASSENGER_EARLY_END_PATTERN' || flag?.flag_type === 'PASSENGER_SAFETY_END_PATTERN') {
    return [
      d.count + ' ' + (d.kind === 'SAFETY' ? 'Safety Concern' : 'personal') + ' early terminations in ' + d.window_days + ' days.',
      d.note ?? '',
      d.kind === 'SAFETY' ? 'Review the trips and the reasons; there is no strike for a Safety Concern pattern.' : 'Confirming issues 1 strike, PAX_FARE_AVOIDANCE (Rule 13.6). The TODA Administrator may investigate the trips first.',
    ].filter(Boolean);
  }
  if (flag?.flag_type === 'DRIVER_EARLY_STOP_REVIEW') {
    return [
      'The driver ended booking ' + d.booking_id + ' before the destination. Reason: ' + d.reason + (d.valid_reason ? ' (a valid reason: no strike).' : '.'),
      d.valid_reason ? '' : 'Confirming issues DRV_EARLY_STOP (1 strike, Rule 13.7).',
    ].filter(Boolean);
  }
  if (isAvailabilityFlag(flag?.flag_type ?? '')) {
    return [
      (flag.flag_type === 'DRIVER_QUEUE_CONFLICT_REPORT' ? 'Queue conflict (Rule 5.3): Available in the app while queued at the terminal.' : 'Availability violation (Rule 5.7): accepted a booking while carrying other passengers.')
        + ' Reported by ' + String(d.reported_by ?? 'an administrator').replace('_', ' ') + '.',
      d.description ? '"' + d.description + '"' : '',
      'Confirming records the strike under your name (Rules 5.3 / 5.7). Nothing is struck until you confirm.',
    ].filter(Boolean);
  }
  if (flag?.flag_type === 'PAYMENT_STUCK_RECONCILIATION') {
    return ['Booking ' + d.booking_id + ' has been at the destination for 30 minutes without the driver tapping Payment Received. Contact both parties and close it as Paid or Waived.'];
  }
  if (flag?.flag_type === 'DRIVER_CHANGE_REFUSAL_PATTERN') {
    return [d.count + ' passengers reported that this driver refused to provide change in ' + d.window_days + ' days (Rule 18.7). Review the reports; there is no automatic strike.'];
  }
  if (flag?.flag_type === 'TRIP_MANUAL_RECONCILIATION') {
    return ['Booking ' + d.booking_id + ' has been without a driver location for 30 minutes. Close it from Live Trips after contacting both parties.'];
  }
  // Batch 11 (Sections 15, 19, 26; Rules 2.5, 29.19, 29.20, 29.22)
  if (flag?.flag_type === 'TODA_EXCESS_INCIDENTS') {
    return [d.upheld_reports + ' incident reports about drivers of this TODA were upheld in ' + d.window_days + ' days (the threshold is ' + d.threshold + ', Rule 2.5). Supervisory review; nothing is imposed automatically.'];
  }
  if (flag?.flag_type === 'DRIVER_DETENTION_LGU_REVIEW' || flag?.flag_type === 'DRIVER_DETENTION_TODA_REVIEW') {
    return ['The driver was detained or arrested during booking ' + d.booking_id + ' (Rule 29.20). The account is on hold until BOTH the TODA and the LGU reviews are resolved; then reinstate it from the driver record.', d.note ? 'How it was confirmed: ' + d.note : ''].filter(Boolean);
  }
  if (flag?.flag_type === 'DRIVER_INCAPACITATED_REVIEW') {
    return ['The driver became ill during booking ' + d.booking_id + ' (Rule 29.22). No strike is issued pending the review.', d.note ? 'How it was confirmed: ' + d.note : ''].filter(Boolean);
  }
  if (flag?.flag_type === 'DRIVER_SAFE_REASON_REVIEW' || flag?.flag_type === 'DRIVER_SAFE_REASON_PATTERN') {
    return ['The driver cancelled or stopped for a reason that is not struck (a breakdown, an accident, an emergency, a safety concern, a road closure, an unsafe request). The TODA Administrator of the driver verifies it; no strike was issued.', d.events_in_window ? d.events_in_window + ' such events in ' + d.window_days + ' days.' : ''].filter(Boolean);
  }
  if (flag?.flag_type === 'LOST_ITEM_UNCLAIMED_REVIEW') {
    return ['A lost-item report has had no contact and no result for 14 days (Rule 29.19). The TODA Administrator arranges the contact or closes it as Unclaimed.'];
  }
  if (flag?.flag_type === 'DRIVER_LOW_RATING_REVIEW' || flag?.flag_type === 'PASSENGER_LOW_RATING_REVIEW') {
    return [String(d.note ?? 'The average rating is under 3.00 after at least 20 completed trips.'), 'Average ' + d.average + ' from ' + d.rating_count + ' ratings over ' + d.completed_trips + ' completed trips. Ratings never change booking or dispatch (Rule 23.2).'];
  }
  if (flag?.flag_type === 'GPS_SPOOFING_REVIEW') {
    const trips = Array.isArray(d.suspect_trips) ? d.suspect_trips : [];
    return [String(d.note ?? ''), trips.length + ' suspect trip(s) among the last ' + (d.window_trips ?? 10) + ' completed trips.'].filter(Boolean).concat(trips.map((x: any) => 'Trip ' + String(x.booking_id).slice(0, 8).toUpperCase() + ': ' + x.teleport_fixes + ' impossible jumps' + (x.distance_mismatch ? ', tracked ' + x.tracked_km + ' km against the quoted ' + x.quoted_km + ' km' : '')));
  }
  if (flag?.flag_type === 'RATING_MANIPULATION_REVIEW') {
    return [String(d.note ?? ''), 'Pattern: ' + String(d.pattern ?? '').replace(/_/g, ' ').toLowerCase() + ', ' + (Array.isArray(d.rating_ids) ? d.rating_ids.length : 0) + ' ratings. Confirming excludes these ratings and records 2 strikes for each account named (Rules 23.5, 27.5).'];
  }
  if (flag?.flag_type === 'COLLUSIVE_MATCHING_REVIEW') {
    return [String(d.note ?? ''), d.matches + ' matches in ' + d.window_days + ' days. Confirming deactivates both accounts for review (Rule 27.4).'];
  }
  if (flag?.flag_type === 'POSSIBLE_REREGISTRATION_REVIEW') {
    const linked = Array.isArray(d.linked) ? d.linked : [];
    return [String(d.note ?? ''), 'Matched on: ' + (Array.isArray(d.basis) ? d.basis.join(', ').replace(/_/g, ' ') : '-') + '. Linked account(s): ' + linked.map((x: any) => x.type + ' ' + String(x.id).slice(0, 8) + (x.state ? ' (' + String(x.state).toLowerCase() + ')' : '')).join('; ') + '. Confirming deactivates them for review; closing them for good is a separate action on each account (Rules 27.3, 27.6).'];
  }
  return [];
};

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();

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
    setAdminFlags((prev) => prev.map((f) => (f.flag_id === selectedFlag.flag_id ? { ...f, status: 'Resolved', resolution: 'Confirmed: 2 strikes (Rule 9.6)' } : f)));
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
    trips: { total: 0, ongoing: 0, allBookings: 0 },
    verifications: { pending: 0, overdue5Days: 0 },
    incidents: { open: 0, total: 0 },
  };

  const flaggedTodas = stats?.flaggedTodas || [];

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 6 }}>
      {/* 1. Welcome Greeting Text Header */}
      <WelcomeHeader />

      {/* 2. TODA Supervisory Review Banner (Conditional from live DB) */}
      {showTodaAlert && flaggedTodas.length > 0 && (
        <Box
          sx={{
            mb: 3,
            backgroundColor: '#FFF7ED',
            border: '1px solid #FDBA74',
            borderRadius: 'var(--mac-radius-lg)',
            padding: '18px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: 'var(--mac-shadow-subtle)',
            position: 'relative',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5, pr: 2 }}>
            <WarningAmberIcon sx={{ color: '#EA580C', fontSize: 26, flexShrink: 0 }} />
            <Box>
              <Typography sx={{ fontSize: '15px', fontWeight: 600, color: '#9A3412', mb: '4px' }}>
                TODA Supervisory Review Alert
              </Typography>
              <Typography sx={{ fontSize: '13.5px', color: '#C2410C', lineHeight: 1.4 }}>
                {flaggedTodas.length} accredited TODA(s) ({flaggedTodas.map((t) => t.name).join(', ')}) have accumulated 3 or more confirmed incident reports requiring supervisory review.
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0 }}>
            <Button
              onClick={() => navigate('/accredited-todas')}
              endIcon={<ArrowForwardIcon sx={{ fontSize: '16px !important' }} />}
              sx={{
                height: 38,
                padding: '0 18px',
                borderRadius: '8px',
                textTransform: 'none',
                fontSize: '13.5px',
                fontWeight: 600,
                backgroundColor: '#EA580C',
                color: '#FFFFFF',
                whiteSpace: 'nowrap',
                boxShadow: 'var(--mac-shadow-subtle)',
                '&:hover': { backgroundColor: '#C2410C' },
              }}
            >
              Review TODAs
            </Button>
            <IconButton
              onClick={() => setShowTodaAlert(false)}
              aria-label="Dismiss alert"
              size="small"
              sx={{
                color: '#C2410C',
                '&:hover': { backgroundColor: 'rgba(234, 88, 12, 0.12)' },
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>
      )}

      {/* 3. Overdue Applications Alert Banner */}
      {showOverdueAlert && kpis.verifications.overdue5Days > 0 && (
        <Box
          sx={{
            mb: 3.5,
            backgroundColor: '#FEF2F2',
            border: '1px solid #FCA5A5',
            borderRadius: 'var(--mac-radius-lg)',
            padding: '18px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: 'var(--mac-shadow-subtle)',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5, pr: 2 }}>
            <AccessTimeIcon sx={{ color: '#DC2626', fontSize: 26, flexShrink: 0 }} />
            <Box>
              <Typography sx={{ fontSize: '15px', fontWeight: 600, color: '#991B1B', mb: '4px' }}>
                Overdue Verifications Alert
              </Typography>
              <Typography sx={{ fontSize: '13.5px', color: '#B91C1C', lineHeight: 1.4 }}>
                {kpis.verifications.overdue5Days} verification request(s) pending beyond 5 calendar days require immediate review.
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0 }}>
            <Button
              onClick={() => navigate('/toda-applications')}
              endIcon={<ArrowForwardIcon sx={{ fontSize: '16px !important' }} />}
              sx={{
                height: 38,
                padding: '0 18px',
                borderRadius: '8px',
                textTransform: 'none',
                fontSize: '13.5px',
                fontWeight: 600,
                backgroundColor: '#DC2626',
                color: '#FFFFFF',
                whiteSpace: 'nowrap',
                boxShadow: 'var(--mac-shadow-subtle)',
                '&:hover': { backgroundColor: '#B91C1C' },
              }}
            >
              View Pending
            </Button>
            <IconButton
              onClick={() => setShowOverdueAlert(false)}
              aria-label="Dismiss alert"
              size="small"
              sx={{
                color: '#B91C1C',
                '&:hover': { backgroundColor: 'rgba(220, 38, 38, 0.12)' },
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>
      )}

      {disputeCount.waiting > 0 && (
        <Box
          role="status"
          sx={{ mb: 3.5, p: '14px 18px', borderRadius: 'var(--mac-radius-lg)', border: '1px solid #FDBA74', backgroundColor: '#FFF7ED', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}
        >
          <Typography sx={{ fontSize: '14px', fontWeight: 600, color: '#9A3412' }}>
            {disputeCount.waiting} fare dispute{disputeCount.waiting === 1 ? '' : 's'} waiting for an administrator
            {disputeCount.overdue > 0 ? ' (' + disputeCount.overdue + ' overdue)' : ''}
          </Typography>
          <Button onClick={() => navigate('/live-trips')} sx={{ textTransform: 'none', fontWeight: 600, color: '#9A3412' }}>
            Open Live Trips
          </Button>
        </Box>
      )}

      {/* 3B. Administrative Review Flags Card (Rules 2.4, 2.5, 3.7) */}
      {adminFlags.some(isOpenFlag) && (
        <Card
          sx={{
            mb: 3.5,
            borderRadius: 'var(--mac-radius-lg)',
            border: '1px solid #CBD5E1',
            backgroundColor: '#F8FAFC',
            boxShadow: 'var(--mac-shadow-subtle)',
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              p: '16px 20px',
              backgroundColor: '#EDE9FE',
              borderBottom: '1px solid #DDD6FE',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <FlagIcon sx={{ color: '#6D28D9', fontSize: 22 }} />
              <Typography sx={{ fontSize: '15px', fontWeight: 700, color: '#4C1D95' }}>
                Administrative Review Flags ({adminFlags.filter(isOpenFlag).length} Pending Action)
              </Typography>
            </Box>
            <Typography sx={{ fontSize: '12px', color: '#6D28D9', fontWeight: 500 }}>
              Rules 2.4, 2.5, 3.7, 8.7, 9.5, 9.6, 17.5 and others
            </Typography>
          </Box>
          <CardContent sx={{ p: '16px 20px !important' }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {adminFlags
                .filter(isOpenFlag)
                .slice(0, 12)
                .map((flag) => (
                  <Box
                    key={flag.flag_id}
                    sx={{
                      p: 1.5,
                      borderRadius: '8px',
                      backgroundColor: '#FFFFFF',
                      border: '1px solid #E2E8F0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 1.5,
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Chip
                        label={flag.flag_type}
                        size="small"
                        sx={{
                          fontWeight: 700,
                          fontSize: '11px',
                          backgroundColor:
                            flag.flag_type === 'ROSTER_MISMATCH'
                              ? '#FEE2E2'
                              : flag.flag_type === 'TERMINAL_RELOCATION_PENDING'
                              ? '#FEF3C7'
                              : '#FFEDD5',
                          color:
                            flag.flag_type === 'ROSTER_MISMATCH'
                              ? '#DC2626'
                              : flag.flag_type === 'TERMINAL_RELOCATION_PENDING'
                              ? '#D97706'
                              : '#EA580C',
                        }}
                      />
                      <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                        {flag.subject_type}: <span style={{ fontFamily: 'monospace' }}>{flag.subject_id}</span>
                      </Typography>
                      <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)' }}>
                        Rule {flag.source_rule} • {new Date(flag.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </Typography>
                    </Box>

                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => {
                        setSelectedFlag(flag);
                        setFlagDialogOpen(true);
                      }}
                      sx={{
                        backgroundColor: '#6D28D9',
                        '&:hover': { backgroundColor: '#5B21B6' },
                        fontSize: '12px',
                        textTransform: 'none',
                        fontWeight: 600,
                        height: 30,
                      }}
                    >
                      Resolve Flag
                    </Button>
                  </Box>
                ))}
            </Box>
          </CardContent>
        </Card>
      )}

      {/* 4. Real Live KPI Summary Cards */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)', lg: 'repeat(6, 1fr)' },
          gap: 2.5,
          mb: 4,
        }}
      >
        {/* Passengers */}
        <Card
          onClick={() => navigate('/passengers')}
          sx={{
            borderRadius: 'var(--mac-radius-lg)',
            border: '1px solid var(--mac-border-color)',
            boxShadow: 'var(--mac-shadow-card)',
            backgroundColor: '#FFFFFF',
            cursor: 'pointer',
            transition: 'var(--mac-transition-fast)',
            '&:hover': { transform: 'translateY(-2px)', borderColor: 'var(--sakay-orange)' },
          }}
        >
          <CardContent sx={{ p: '20px 22px !important' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Typography sx={{ fontSize: '12px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase' }}>
                Passengers
              </Typography>
              <PeopleIcon sx={{ color: 'var(--sakay-orange)', fontSize: 20 }} />
            </Box>
            <Typography sx={{ fontSize: '25px', fontWeight: 700, color: 'var(--mac-text-primary)', mb: 0.5 }}>
              {isLoading ? <CircularProgress size={20} /> : kpis.passengers.total.toLocaleString()}
            </Typography>
            <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)' }}>
              <span style={{ fontWeight: 600, color: '#1E8E3E' }}>{kpis.passengers.active} Active</span> • {kpis.passengers.inactive} Inactive
            </Typography>
          </CardContent>
        </Card>

        {/* Drivers */}
        <Card
          onClick={() => navigate('/drivers')}
          sx={{
            borderRadius: 'var(--mac-radius-lg)',
            border: '1px solid var(--mac-border-color)',
            boxShadow: 'var(--mac-shadow-card)',
            backgroundColor: '#FFFFFF',
            cursor: 'pointer',
            transition: 'var(--mac-transition-fast)',
            '&:hover': { transform: 'translateY(-2px)', borderColor: 'var(--sakay-orange)' },
          }}
        >
          <CardContent sx={{ p: '20px 22px !important' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Typography sx={{ fontSize: '12px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase' }}>
                Drivers
              </Typography>
              <DirectionsCarIcon sx={{ color: 'var(--sakay-orange)', fontSize: 20 }} />
            </Box>
            <Typography sx={{ fontSize: '25px', fontWeight: 700, color: 'var(--mac-text-primary)', mb: 0.5 }}>
              {isLoading ? <CircularProgress size={20} /> : kpis.drivers.total.toLocaleString()}
            </Typography>
            <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)' }}>
              <span style={{ fontWeight: 600, color: '#1E8E3E' }}>{kpis.drivers.active} Verified</span> • {kpis.drivers.inactive} Other
            </Typography>
          </CardContent>
        </Card>

        {/* Accredited TODAs */}
        <Card
          onClick={() => navigate('/accredited-todas')}
          sx={{
            borderRadius: 'var(--mac-radius-lg)',
            border: '1px solid var(--mac-border-color)',
            boxShadow: 'var(--mac-shadow-card)',
            backgroundColor: '#FFFFFF',
            cursor: 'pointer',
            transition: 'var(--mac-transition-fast)',
            '&:hover': { transform: 'translateY(-2px)', borderColor: 'var(--sakay-orange)' },
          }}
        >
          <CardContent sx={{ p: '20px 22px !important' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Typography sx={{ fontSize: '12px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase' }}>
                Accredited TODAs
              </Typography>
              <AccountBalanceIcon sx={{ color: 'var(--sakay-orange)', fontSize: 20 }} />
            </Box>
            <Typography sx={{ fontSize: '25px', fontWeight: 700, color: 'var(--mac-text-primary)', mb: 0.5 }}>
              {isLoading ? <CircularProgress size={20} /> : kpis.todas.total.toLocaleString()}
            </Typography>
            <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)' }}>
              <span style={{ fontWeight: 600, color: '#1565C0' }}>{kpis.todas.total} Active</span> • {kpis.todas.pendingReview} Pending
            </Typography>
          </CardContent>
        </Card>

        {/* Completed Trips */}
        <Card
          onClick={() => navigate('/live-trips')}
          sx={{
            borderRadius: 'var(--mac-radius-lg)',
            border: '1px solid var(--mac-border-color)',
            boxShadow: 'var(--mac-shadow-card)',
            backgroundColor: '#FFFFFF',
            cursor: 'pointer',
            transition: 'var(--mac-transition-fast)',
            '&:hover': { transform: 'translateY(-2px)', borderColor: 'var(--sakay-orange)' },
          }}
        >
          <CardContent sx={{ p: '20px 22px !important' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Typography sx={{ fontSize: '12px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase' }}>
                Completed Trips
              </Typography>
              <RouteIcon sx={{ color: 'var(--sakay-orange)', fontSize: 20 }} />
            </Box>
            <Typography sx={{ fontSize: '25px', fontWeight: 700, color: 'var(--mac-text-primary)', mb: 0.5 }}>
              {isLoading ? <CircularProgress size={20} /> : kpis.trips.total.toLocaleString()}
            </Typography>
            <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)' }}>
              <span style={{ fontWeight: 600, color: '#1E8E3E' }}>{kpis.trips.ongoing} In Transit</span> • {kpis.trips.allBookings} Total
            </Typography>
          </CardContent>
        </Card>

        {/* Pending Verifications */}
        <Card
          onClick={() => navigate('/toda-applications')}
          sx={{
            borderRadius: 'var(--mac-radius-lg)',
            border: '1px solid var(--mac-border-color)',
            boxShadow: 'var(--mac-shadow-card)',
            backgroundColor: '#FFFFFF',
            cursor: 'pointer',
            transition: 'var(--mac-transition-fast)',
            '&:hover': { transform: 'translateY(-2px)', borderColor: 'var(--sakay-orange)' },
          }}
        >
          <CardContent sx={{ p: '20px 22px !important' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Typography sx={{ fontSize: '12px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase' }}>
                Pending Verifications
              </Typography>
              <AccessTimeIcon sx={{ color: '#EA580C', fontSize: 20 }} />
            </Box>
            <Typography sx={{ fontSize: '25px', fontWeight: 700, color: '#EA580C', mb: 0.5 }}>
              {isLoading ? <CircularProgress size={20} /> : kpis.verifications.pending.toLocaleString()}
            </Typography>
            <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)' }}>
              {kpis.todas.pendingReview} TODA • {kpis.verifications.pending - kpis.todas.pendingReview} Drivers
            </Typography>
          </CardContent>
        </Card>

        {/* Open Incidents */}
        <Card
          onClick={() => navigate('/incident-reports')}
          sx={{
            borderRadius: 'var(--mac-radius-lg)',
            border: '1px solid var(--mac-border-color)',
            boxShadow: 'var(--mac-shadow-card)',
            backgroundColor: '#FFFFFF',
            cursor: 'pointer',
            transition: 'var(--mac-transition-fast)',
            '&:hover': { transform: 'translateY(-2px)', borderColor: 'var(--sakay-orange)' },
          }}
        >
          <CardContent sx={{ p: '20px 22px !important' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Typography sx={{ fontSize: '12px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase' }}>
                Open Incidents
              </Typography>
              <ReportProblemIcon sx={{ color: '#D93025', fontSize: 20 }} />
            </Box>
            <Typography sx={{ fontSize: '25px', fontWeight: 700, color: '#D93025', mb: 0.5 }}>
              {isLoading ? <CircularProgress size={20} /> : kpis.incidents.open.toLocaleString()}
            </Typography>
            <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)' }}>
              {kpis.incidents.total} Total Complaints
            </Typography>
          </CardContent>
        </Card>
      </Box>

      {/* 5. Row 1: Booking Trend Card & Driver Verification Card */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '7fr 5fr' },
          gap: 3.5,
          mb: 3.5,
        }}
      >
        <BookingTrendCard />
        <DriverVerificationCard data={stats?.driverBreakdown} />
      </Box>

      {/* 6. Row 2: Live Trips Map, Recent TODA Applications & Recent Incident Reports */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', lg: '1fr 1fr 1fr' },
          gap: 3.5,
        }}
      >
        <LiveTripsMapCard ongoingTripsCount={kpis.trips.ongoing} />
        <RecentTodaApplicationsCard applications={stats?.recentApplications} />
        <RecentIncidentReportsCard reports={stats?.recentIncidents} />
      </Box>

      {/* Flag Resolution Dialog */}
      <Dialog open={flagDialogOpen} onClose={() => setFlagDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, fontSize: '16px' }}>
          Resolve Administrative Flag ({selectedFlag?.flag_type})
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '13px', color: 'var(--mac-text-secondary)', mb: 2 }}>
            Provide resolution notes for {selectedFlag?.subject_type} {selectedFlag?.subject_id} ({selectedFlag?.source_rule}).
          </Typography>
          {describeFlagDetails(selectedFlag).length > 0 && (
            <Box sx={{ mb: 2, p: 1.5, borderRadius: '8px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}>
              {describeFlagDetails(selectedFlag).map((line, i) => (
                <Typography key={i} sx={{ fontSize: '12.5px', color: 'var(--mac-text-primary)', lineHeight: 1.5 }}>
                  {line}
                </Typography>
              ))}
            </Box>
          )}
          {flagError && (
            <Typography sx={{ fontSize: '12.5px', color: '#B91C1C', mb: 1.5 }}>{flagError}</Typography>
          )}
          <TextField
            autoFocus
            fullWidth
            multiline
            rows={3}
            label="Resolution Notes"
            value={flagResolutionText}
            onChange={(e) => setFlagResolutionText(e.target.value)}
            placeholder="e.g. Verified with manual certificate, franchise validated, or inspection completed..."
          />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => { setFlagDialogOpen(false); setFlagError(null); }} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          {selectedFlag?.flag_type === 'DRIVER_DELIBERATE_OFFLINE_REPORT' && (
            <Button
              onClick={handleConfirmDeliberateOffline}
              variant="contained"
              color="error"
              disabled={!flagResolutionText.trim()}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Confirm: 2 strikes
            </Button>
          )}
          {(selectedFlag?.flag_type === 'PASSENGER_EARLY_END_PATTERN' || (selectedFlag?.flag_type === 'DRIVER_EARLY_STOP_REVIEW' && selectedFlag?.details?.valid_reason === false)) && (
            <Button
              onClick={handleConfirmViolation}
              variant="contained"
              color="error"
              disabled={flagResolutionText.trim().length < 10}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Confirm: 1 strike
            </Button>
          )}
          {INTEGRITY_FLAG_TYPES.includes(selectedFlag?.flag_type) && (
            <Button
              onClick={handleConfirmIntegrity}
              variant="contained"
              color="error"
              disabled={flagResolutionText.trim().length < 10}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Confirm the violation
            </Button>
          )}
          {isAvailabilityFlag(selectedFlag?.flag_type ?? '') && (
            <Button
              onClick={handleConfirmAvailability}
              variant="contained"
              color="error"
              disabled={flagResolutionText.trim().length < 10}
              sx={{ textTransform: 'none', fontWeight: 600 }}
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
                sx={{ textTransform: 'none', fontWeight: 600 }}
              >
                Close the trip: Paid
              </Button>
              <Button
                onClick={() => handleCloseStuckTrip('Waived')}
                variant="outlined"
                disabled={closeProblem('Waived', flagResolutionText) !== null}
                sx={{ textTransform: 'none', fontWeight: 600 }}
              >
                Close the trip: Waived
              </Button>
            </>
          )}
          {selectedFlag?.flag_type === 'PASSENGER_LOW_RATING_REVIEW' && (
            <Button
              onClick={handleSendWarning}
              variant="contained"
              color="warning"
              disabled={flagResolutionText.trim().length < 10}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Send the passenger a warning
            </Button>
          )}
          <Button
            onClick={handleResolveFlag}
            variant="contained"
            sx={{ backgroundColor: '#6D28D9', '&:hover': { backgroundColor: '#5B21B6' }, textTransform: 'none', fontWeight: 600 }}
          >
            Mark Resolved
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
