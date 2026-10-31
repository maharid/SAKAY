import React, { useState, useEffect } from 'react';
import { Box, Button, CircularProgress } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

import { WelcomeHeader } from '../components/layout/WelcomeHeader';
import { PageNotice } from '../components/common/PageNotice';
import { StatStrip } from '../components/common/StatStrip';
import type { StatItem } from '../components/common/StatStrip';
import { ReviewFlagsPanel } from '../components/dashboard/ReviewFlagsPanel';
import { BookingTrendCard } from '../components/dashboard/BookingTrendCard';
import { DriverVerificationCard } from '../components/dashboard/DriverVerificationCard';
import { LiveTripsMapCard } from '../components/dashboard/LiveTripsMapCard';
import { RecentIncidentReportsCard } from '../components/dashboard/RecentIncidentReportsCard';
import { RecentTodaApplicationsCard } from '../components/dashboard/RecentTodaApplicationsCard';
import { fetchDashboardStats, DashboardStats, fetchFareDisputes, fetchBookingTrend } from '../services/adminApiService';
import type { BookingTrend } from '../services/adminApiService';
import { SPACE } from '../styles/density';
import { rowActionSx } from '../styles/pageTheme';

export const DashboardPage: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [trend, setTrend] = useState<BookingTrend | null>(null);
  const [trendLoading, setTrendLoading] = useState<boolean>(true);

  // Dismissible alert states
  const [showTodaAlert, setShowTodaAlert] = useState(true);
  const [showOverdueAlert, setShowOverdueAlert] = useState(true);

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

    fetchBookingTrend()
      .then((data) => {
        if (isMounted) setTrend(data);
      })
      .catch((err) => console.warn('[DashboardPage] Failed to fetch the booking trend:', err))
      .finally(() => {
        if (isMounted) setTrendLoading(false);
      });

    fetchFareDisputes()
      .then((rows) => {
        const waiting = rows.filter((r) => r.status !== 'Resolved');
        if (isMounted) setDisputeCount({ waiting: waiting.length, overdue: waiting.filter((r) => r.overdue).length });
      })
      .catch((err) => console.warn('[DashboardPage] Failed to fetch fare disputes:', err));

    return () => {
      isMounted = false;
    };
  }, []);

  const kpis = stats?.kpis || {
    passengers: { total: 0, active: 0, inactive: 0 },
    drivers: { total: 0, active: 0, inactive: 0 },
    todas: { total: 0, pendingReview: 0 },
    trips: { total: 0, ongoing: 0, allBookings: 0, cancelled: 0 },
    verifications: { pending: 0, overdue5Days: 0 },
    incidents: { open: 0, total: 0, resolved: 0 },
  };

  const flaggedTodas = stats?.flaggedTodas || [];

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

      {/* Administrative review flags (Rules 2.4, 2.5, 3.7): the first five; "See more" opens the Review Flags page with all of them */}
      <ReviewFlagsPanel limit={5} />

      {/* Booking trend and driver verification */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '7fr 5fr' }, gap: SPACE.gapLarge, mb: SPACE.gapLarge }}>
        <BookingTrendCard days={trend?.days} previousTotal={trend?.previousTotal} loading={trendLoading} />
        <DriverVerificationCard data={stats?.driverBreakdown} />
      </Box>

      {/* The live map and the two most recent lists */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', lg: '1fr 1fr 1fr' }, gap: SPACE.gapLarge }}>
        <LiveTripsMapCard ongoingTripsCount={kpis.trips.ongoing} />
        <RecentTodaApplicationsCard applications={stats?.recentApplications} />
        <RecentIncidentReportsCard reports={stats?.recentIncidents} />
      </Box>
    </Box>
  );
};
