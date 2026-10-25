import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Paper,
  Card,
  CardContent,
  CircularProgress,
  Button,
  LinearProgress,
  Alert,
  ToggleButton,
  ToggleButtonGroup,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TimelineIcon from '@mui/icons-material/Timeline';
import RefreshIcon from '@mui/icons-material/Refresh';
import MapIcon from '@mui/icons-material/Map';
import SpeedIcon from '@mui/icons-material/Speed';
import PeopleIcon from '@mui/icons-material/People';
import PersonIcon from '@mui/icons-material/Person';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { CoverageGapsPanel, fetchCoverageGaps } from '@sakay/shared';
import type { CoverageGaps, Hotspot, VolumePeriod } from '@sakay/shared';
import { AnalyticsFilterBar } from '../components/admin/AnalyticsFilterBar';
import { MiniBarChart } from '../components/admin/MiniBarChart';
import { PeakHoursByGroupTable } from '../components/admin/PeakHoursByGroupTable';
import { PilotCoverageNote } from '../components/admin/PilotCoverageNote';
import { useOperationalReports } from '../hooks/useOperationalReports';
import { supabase } from '../services/supabaseClient';
import { FONT } from '../styles/density';

/**
 * ============================================================================
 * TRANSPORTATION ANALYTICS DASHBOARD (AnalyticsPage.tsx)
 * ============================================================================
 * Checklist Scope (A9):
 *   ● View Transportation Analytics
 *     ○ Booking trends by day, week and month, and the change from the previous period
 *     ○ Peak travel periods, by hour and by day of the week, and by TODA or barangay
 *     ○ Demand hotspot map: pickups and drop-offs, weekdays against weekends
 *     ○ Passenger and driver registration / accreditation trends
 *     ○ Passenger utilization, driver utilization, service utilization
 *     ○ A date range, TODA and barangay filter for all of it
 *
 * Descriptive analytics only: every figure is computed from SAKAY records (packages/shared/src/utils/transportAnalytics.ts and transportInsights.ts).
 * The pilot covers one TODA and one barangay, so these figures are not citywide transport demand.
 * ============================================================================
 */

const CALAPAN_CENTER: L.LatLngExpression = [13.4117, 121.1803];

const cardSx = {
  borderRadius: 'var(--mac-radius-lg)',
  border: '1px solid var(--mac-border-color)',
  boxShadow: 'var(--mac-shadow-card)',
  backgroundColor: '#FFFFFF',
};

const PERIOD_WORD: Record<VolumePeriod, string> = { day: 'day', week: 'week', month: 'month' };
const PERIOD_RANGE_TEXT: Record<VolumePeriod, string> = { day: 'days', week: 'weeks', month: 'months' };

type HotspotKind = 'pickup' | 'dropoff';
type DayType = 'all' | 'weekday' | 'weekend';

interface MetricCardProps {
  title: string;
  value: string;
  caption: string;
  color: string;
  icon: React.ReactNode;
}

const MetricCard: React.FC<MetricCardProps> = ({ title, value, caption, color, icon }) => (
  <Card sx={cardSx}>
    <CardContent sx={{ p: '16px 18px !important' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mb: 0.8 }}>
        {icon}
        <Typography sx={{ fontSize: FONT.caption, fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase' }}>{title}</Typography>
      </Box>
      <Typography sx={{ fontSize: '22px', fontWeight: 700, color, mb: 0.4 }}>{value}</Typography>
      <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)' }}>{caption}</Typography>
    </CardContent>
  </Card>
);

interface OutcomeBarProps {
  label: string;
  count: number;
  total: number;
  color: string;
}

const OutcomeBar: React.FC<OutcomeBarProps> = ({ label, count, total, color }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.6 }}>
    <Typography sx={{ width: 130, fontSize: FONT.caption, fontWeight: 600, color: 'var(--mac-text-secondary)' }}>{label}</Typography>
    <Box sx={{ flex: 1 }}>
      <LinearProgress
        variant="determinate"
        value={total > 0 ? (count / total) * 100 : 0}
        sx={{ height: 10, borderRadius: 5, backgroundColor: '#F0F0F2', '& .MuiLinearProgress-bar': { backgroundColor: color, borderRadius: 5 } }}
      />
    </Box>
    <Typography sx={{ width: 90, fontSize: FONT.caption, fontWeight: 700, textAlign: 'right', color: 'var(--mac-text-primary)' }}>
      {count} ({total > 0 ? Math.round((count / total) * 100) : 0}%)
    </Typography>
  </Box>
);

const SectionTitle: React.FC<{ children: React.ReactNode; icon?: React.ReactNode }> = ({ children, icon }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mb: 1.6 }}>
    {icon}
    <Typography sx={{ fontSize: FONT.heading, fontWeight: 700, color: 'var(--mac-text-primary)' }}>{children}</Typography>
  </Box>
);

export const AnalyticsPage: React.FC = () => {
  const { data, filter, setFilter, isLoading, loadError, reload } = useOperationalReports();
  const [period, setPeriod] = useState<VolumePeriod>('day');
  const [hotspotKind, setHotspotKind] = useState<HotspotKind>('pickup');
  const [dayType, setDayType] = useState<DayType>('all');
  const [peakGroup, setPeakGroup] = useState<'toda' | 'barangay'>('toda');

  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const hotspotLayer = useRef<L.LayerGroup | null>(null);

  // Rule 7.10: the coverage gaps logged in the last 30 days, for service planning (never a penalty)
  const [coverageGaps, setCoverageGaps] = useState<CoverageGaps | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(true);
  useEffect(() => {
    fetchCoverageGaps(supabase, 30).then((g) => {
      setCoverageGaps(g);
      setCoverageLoading(false);
    });
  }, []);

  // The hotspots on the map: all days, or only weekdays or weekends; pickups or drop-offs
  const spots: Hotspot[] = !data
    ? []
    : dayType === 'all'
      ? hotspotKind === 'pickup' ? data.hotspots : data.dropoffHotspots
      : hotspotKind === 'pickup' ? data.dayTypes[dayType].pickups : data.dayTypes[dayType].dropoffs;
  const spotColor = hotspotKind === 'pickup' ? '#FF5500' : '#1565C0';

  // The map is created once, as soon as its container exists...
  const mapReady = Boolean(data);
  useEffect(() => {
    if (!mapReady || !mapRef.current || leafletMap.current) return;
    const map = L.map(mapRef.current, { center: CALAPAN_CENTER, zoom: 14, zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    hotspotLayer.current = L.layerGroup().addTo(map);
    leafletMap.current = map;
    return () => {
      map.remove();
      leafletMap.current = null;
      hotspotLayer.current = null;
    };
  }, [mapReady]);

  // ...and the hotspots are redrawn whenever the data, the filter or the toggles change. Each one is a cluster of real coordinates.
  useEffect(() => {
    const map = leafletMap.current;
    const layer = hotspotLayer.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (spots.length === 0) return;
    const maxCount = Math.max(...spots.map((s) => s.count));
    const noun = hotspotKind === 'pickup' ? 'pickup' : 'drop-off';
    spots.forEach((spot) => {
      L.circle([spot.lat, spot.lng], {
        color: spotColor,
        fillColor: spotColor,
        fillOpacity: 0.25,
        radius: 200 + 500 * (spot.count / maxCount),
      })
        .bindPopup(`<b>${spot.label.replace(/</g, '&lt;')}</b><br/>${spot.count} ${noun}${spot.count === 1 ? '' : 's'} (${spot.share}% of located ${noun}s)`)
        .addTo(layer);
    });
    map.fitBounds(L.latLngBounds(spots.map((s) => [s.lat, s.lng] as L.LatLngTuple)).pad(0.4), { maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, hotspotKind, dayType]);

  const service = data?.serviceUtilization;
  const drivers = data?.driverUtilizationSummary;
  const pax = data?.passengerUtilization;
  const trend = data?.volume[period] ?? [];
  const trendMax = Math.max(1, ...trend.map((p) => p.total));
  const trendTotal = trend.reduce((sum, p) => sum + p.total, 0);
  const comparison = data?.comparison[period] ?? null;
  const busiest = (data?.peakHourDistribution ?? []).reduce<{ hour: string; count: number } | null>(
    (best, h) => (h.count > 0 && (!best || h.count > best.count) ? h : best),
    null
  );

  const comparisonText = (): string => {
    if (!comparison) return `Not enough complete ${PERIOD_RANGE_TEXT[period]} yet to compare one ${PERIOD_WORD[period]} with the one before it.`;
    const sign = comparison.change > 0 ? '+' : '';
    const pctText = comparison.changePct === null ? 'the earlier period had no bookings' : `${sign}${comparison.changePct}%`;
    const verdict = comparison.direction === 'growth' ? 'Growth' : comparison.direction === 'decline' ? 'Decline' : 'No change';
    return `${verdict}: ${comparison.current.label} had ${comparison.current.total} booking${comparison.current.total === 1 ? '' : 's'} against ${comparison.previous.total} in ${comparison.previous.label} (${sign}${comparison.change}, ${pctText}).`;
  };

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 4.8 }}>
      {/* 1. Header Toolbar */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1.6 }}>
        <Box sx={{ maxWidth: 900 }}>
          <Typography sx={{ fontSize: FONT.pageTitle, fontWeight: 700, color: 'var(--mac-text-primary)' }}>Transportation Operations Analytics</Typography>
          <Box sx={{ mt: '2px' }}>
            <PilotCoverageNote />
          </Box>
        </Box>
        <Button
          onClick={() => void reload()}
          startIcon={<RefreshIcon />}
          variant="outlined"
          size="small"
          sx={{ textTransform: 'none', borderColor: 'var(--mac-border-color)', color: 'var(--mac-text-primary)' }}
        >
          Refresh Analytics
        </Button>
      </Box>

      {loadError && <Alert severity="error" sx={{ mb: 1.6 }}>{loadError}</Alert>}

      {isLoading && !data ? (
        <Box sx={{ textAlign: 'center', py: 6.4 }}>
          <CircularProgress size={32} sx={{ color: 'var(--sakay-orange)' }} />
        </Box>
      ) : (
        data && (
          <>
            {/* 2. Filters and the period of the trend charts */}
            <AnalyticsFilterBar filter={filter} onChange={setFilter} todaOptions={data.todaOptions} barangayOptions={data.barangayOptions} />
            <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.6, mb: 2.4 }}>
              <Typography sx={{ fontSize: FONT.small, fontWeight: 600, color: 'var(--mac-text-secondary)' }}>View trends by</Typography>
              <ToggleButtonGroup size="small" exclusive value={period} onChange={(_, v: VolumePeriod | null) => v && setPeriod(v)}>
                <ToggleButton value="day" sx={{ textTransform: 'none', px: 1.6 }}>Day</ToggleButton>
                <ToggleButton value="week" sx={{ textTransform: 'none', px: 1.6 }}>Week</ToggleButton>
                <ToggleButton value="month" sx={{ textTransform: 'none', px: 1.6 }}>Month</ToggleButton>
              </ToggleButtonGroup>
              <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)' }}>Showing: {data.filterText}</Typography>
            </Box>

            <CoverageGapsPanel gaps={coverageGaps} loading={coverageLoading} audience="lgu_admin" />

            {/* 3. Top Analytics Metrics */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(3, 1fr)' }, gap: 2, mb: 2.8 }}>
              <MetricCard
                title="Booking Completion Rate"
                value={service && service.requests > 0 ? `${service.completionRate}%` : '—'}
                caption={`${service?.completed ?? 0} of ${service?.requests ?? 0} booking requests were completed`}
                color="#2E7D32"
                icon={<TrendingUpIcon sx={{ color: '#2E7D32', fontSize: '16px' }} />}
              />
              <MetricCard
                title="Busiest Hour"
                value={busiest ? busiest.hour : '—'}
                caption={busiest ? `${busiest.count} booking${busiest.count === 1 ? '' : 's'} created in this hour` : 'No bookings in this selection'}
                color="var(--sakay-orange)"
                icon={<SpeedIcon sx={{ color: 'var(--sakay-orange)', fontSize: '16px' }} />}
              />
              <MetricCard
                title="Average Fare"
                value={service && service.completed > 0 ? `₱${service.averageFare.toFixed(2)}` : '—'}
                caption="Per completed trip (final fare)"
                color="#6A1B9A"
                icon={<TimelineIcon sx={{ color: '#6A1B9A', fontSize: '16px' }} />}
              />
              <MetricCard
                title="Driver Utilization"
                value={drivers && drivers.verifiedDrivers > 0 ? `${drivers.rate}%` : '—'}
                caption={`${drivers?.activeDrivers ?? 0} of ${drivers?.verifiedDrivers ?? 0} verified drivers completed a trip in the 30 days up to ${filter.to ? 'the end date' : 'today'}`}
                color="#1565C0"
                icon={<PeopleIcon sx={{ color: '#1565C0', fontSize: '16px' }} />}
              />
              <MetricCard
                title="Completed Trips per Driver"
                value={data.driverAverage === null ? '—' : data.driverAverage.toFixed(1)}
                caption={data.driverAverage === null ? 'No verified drivers in this selection' : `Average over ${drivers?.verifiedDrivers ?? 0} verified driver${drivers?.verifiedDrivers === 1 ? '' : 's'} in this selection (lists of low-activity and high-demand drivers: Reports)`}
                color="#00897B"
                icon={<DirectionsCarIcon sx={{ color: '#00897B', fontSize: '16px' }} />}
              />
              <MetricCard
                title="Bookings per Passenger"
                value={pax?.averageBookingsPerBooker == null ? '—' : pax.averageBookingsPerBooker.toFixed(1)}
                caption={
                  pax && pax.bookedAtLeastOnce > 0
                    ? `${pax.bookings} booking${pax.bookings === 1 ? '' : 's'} by ${pax.bookedAtLeastOnce} passenger${pax.bookedAtLeastOnce === 1 ? '' : 's'} who booked; ${pax.repeatBookers} booked more than once${pax.averageBookingsPerRegistered !== null ? `. ${pax.averageBookingsPerRegistered.toFixed(1)} per registered passenger (${pax.registered})` : ''}`
                    : 'No bookings in this selection'
                }
                color="#C2410C"
                icon={<PersonIcon sx={{ color: '#C2410C', fontSize: '16px' }} />}
              />
            </Box>

            {/* 4. Booking trend + service utilization */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '3fr 2fr' }, gap: 2, mb: 2.8 }}>
              <Paper elevation={0} sx={{ ...cardSx, p: 2.4 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.2, flexWrap: 'wrap', gap: 0.8 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                    <TimelineIcon sx={{ color: 'var(--sakay-orange)', fontSize: '18px' }} />
                    <Typography sx={{ fontSize: FONT.heading, fontWeight: 700, color: 'var(--mac-text-primary)' }}>
                      Booking Trend ({trend.length} {trend.length === 1 ? PERIOD_WORD[period] : PERIOD_RANGE_TEXT[period]})
                    </Typography>
                  </Box>
                  <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)' }}>{trendTotal} booking{trendTotal === 1 ? '' : 's'} in this period</Typography>
                </Box>
                <Alert severity={comparison?.direction === 'decline' ? 'warning' : comparison?.direction === 'growth' ? 'success' : 'info'} sx={{ mb: 1.6, py: 0, '& .MuiAlert-message': { fontSize: FONT.small } }}>
                  {comparisonText()}
                  {comparison?.inProgress ? ` The current ${PERIOD_WORD[period]} (${comparison.inProgress.label}) has ${comparison.inProgress.total} so far and is not compared until it ends.` : ''}
                </Alert>
                <Box sx={{ overflowX: 'auto' }}>
                  <Box sx={{ minWidth: trend.length * 36 }}>
                    <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '5px', height: 170, borderBottom: '1px solid var(--mac-border-color)' }}>
                      {trend.map((p) => {
                        const other = p.total - p.completed - p.cancelled;
                        const scale = (n: number) => `${(n / trendMax) * 140}px`;
                        return (
                          <Box
                            key={p.key}
                            title={`${p.label}: ${p.total} booking(s), ${p.completed} completed, ${p.cancelled} cancelled`}
                            sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', minWidth: 0 }}
                          >
                            <Typography sx={{ fontSize: FONT.caption, fontWeight: 700, color: 'var(--mac-text-secondary)', mb: '2px' }}>{p.total > 0 ? p.total : ''}</Typography>
                            <Box sx={{ width: '100%', maxWidth: 34, display: 'flex', flexDirection: 'column', borderRadius: '4px 4px 0 0', overflow: 'hidden' }}>
                              <Box sx={{ height: scale(other), backgroundColor: '#B0B7C3' }} />
                              <Box sx={{ height: scale(p.cancelled), backgroundColor: '#DC2626' }} />
                              <Box sx={{ height: scale(p.completed), backgroundColor: '#2E7D32' }} />
                            </Box>
                          </Box>
                        );
                      })}
                    </Box>
                    <Box sx={{ display: 'flex', gap: '5px', mt: 0.75 }}>
                      {trend.map((p) => (
                        <Typography key={p.key} sx={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: FONT.caption, lineHeight: 1.2, color: 'var(--mac-text-muted)', wordBreak: 'break-word' }}>
                          {p.label}
                        </Typography>
                      ))}
                    </Box>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', gap: 1.6, mt: 1.2, flexWrap: 'wrap' }}>
                  {[
                    ['#2E7D32', 'Completed'],
                    ['#DC2626', 'Cancelled'],
                    ['#B0B7C3', 'Other (searching, no driver, in progress)'],
                  ].map(([color, label]) => (
                    <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <Box sx={{ width: 10, height: 10, borderRadius: '2px', backgroundColor: color }} />
                      <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)' }}>{label}</Typography>
                    </Box>
                  ))}
                </Box>
              </Paper>

              <Paper elevation={0} sx={{ ...cardSx, p: 2.4 }}>
                <Typography sx={{ fontSize: FONT.heading, fontWeight: 700, color: 'var(--mac-text-primary)', mb: 1.6 }}>Service Utilization</Typography>
                {service && service.requests > 0 ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
                    <OutcomeBar label="Completed" count={service.completed} total={service.requests} color="#2E7D32" />
                    <OutcomeBar label="Cancelled" count={service.cancelled} total={service.requests} color="#DC2626" />
                    <OutcomeBar label="No driver found" count={service.noDriverFound} total={service.requests} color="#F59E0B" />
                    <OutcomeBar label="In progress / open" count={service.inProgress} total={service.requests} color="#1565C0" />
                    <Box sx={{ borderTop: '1px solid var(--mac-border-color)', pt: 1.2, mt: 0.4 }}>
                      <OutcomeBar label="Solo trips" count={service.soloTrips} total={service.requests} color="#6A1B9A" />
                      <Box sx={{ mt: 1.25 }}>
                        <OutcomeBar label="Shared trips" count={service.sharedTrips} total={service.requests} color="#00897B" />
                      </Box>
                    </Box>
                  </Box>
                ) : (
                  <Typography sx={{ fontSize: FONT.small, color: 'var(--mac-text-muted)' }}>No booking requests match the filter.</Typography>
                )}
              </Paper>
            </Box>

            {/* 5. Demand by day of the week + peak hours by TODA or barangay */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '2fr 3fr' }, gap: 2, mb: 2.8 }}>
              <Paper elevation={0} sx={{ ...cardSx, p: 2.4 }}>
                <SectionTitle>Demand by Day of the Week</SectionTitle>
                {data.serviceUtilization.requests > 0 ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
                    {data.weekdayDemand.map((d) => (
                      <Box key={d.day} title={d.averagePerDay === null ? undefined : `${d.averagePerDay} booking(s) on an average ${d.day}, over ${d.occurrences} ${d.day}${d.occurrences === 1 ? '' : 's'}`}>
                        <OutcomeBar label={d.day} count={d.total} total={data.serviceUtilization.requests} color={d.day === 'Saturday' || d.day === 'Sunday' ? '#00897B' : '#FF5500'} />
                        <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)', ml: '117px' }}>
                          {d.averagePerDay === null ? '' : `${d.averagePerDay} on an average ${d.day} (${d.occurrences} ${d.day}${d.occurrences === 1 ? '' : 's'} in the period)`}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                ) : (
                  <Typography sx={{ fontSize: FONT.small, color: 'var(--mac-text-muted)' }}>No booking requests match the filter.</Typography>
                )}
              </Paper>

              <Paper elevation={0} sx={{ ...cardSx, p: 2.4 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 0.8, mb: 0.8 }}>
                  <SectionTitle icon={<SpeedIcon sx={{ color: 'var(--sakay-orange)', fontSize: '18px' }} />}>Peak Hours Compared</SectionTitle>
                  <ToggleButtonGroup size="small" exclusive value={peakGroup} onChange={(_, v: 'toda' | 'barangay' | null) => v && setPeakGroup(v)}>
                    <ToggleButton value="toda" sx={{ textTransform: 'none', px: 1.2 }}>By TODA</ToggleButton>
                    <ToggleButton value="barangay" sx={{ textTransform: 'none', px: 1.2 }}>By barangay</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                <PeakHoursByGroupTable
                  groupLabel={peakGroup === 'toda' ? 'TODA' : 'Barangay (pickup)'}
                  rows={peakGroup === 'toda' ? data.peakHoursByToda : data.peakHoursByBarangay}
                />
              </Paper>
            </Box>

            {/* 6. Registration and accreditation trends */}
            <Paper elevation={0} sx={{ ...cardSx, p: 2.4, mb: 2.8 }}>
              <SectionTitle icon={<PeopleIcon sx={{ color: '#1565C0', fontSize: '18px' }} />}>Registration and Accreditation Trends (by {PERIOD_WORD[period]})</SectionTitle>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(3, 1fr)' }, gap: 2.4 }}>
                {[
                  { title: 'New passenger accounts', rows: data.passengerRegistrations[period], color: '#C2410C', note: 'Accounts whose phone number was confirmed. Not split by TODA or barangay.' },
                  { title: 'New driver accounts', rows: data.driverRegistrations[period], color: '#1565C0', note: 'Drivers who created an account (any status).' },
                  { title: 'Drivers accredited by the LGU', rows: data.driverAccreditations[period], color: '#2E7D32', note: data.driversAccreditedUndated > 0 ? `${data.driversAccreditedUndated} verified driver${data.driversAccreditedUndated === 1 ? ' has' : 's have'} no accreditation date on record and are not counted here.` : 'The date the LGU Administrator approved the driver.' },
                ].map((c) => (
                  <Box key={c.title} sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: FONT.small, fontWeight: 700, color: 'var(--mac-text-primary)' }}>{c.title}</Typography>
                    <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)', mb: 0.8 }}>
                      {c.rows.reduce((sum, r) => sum + r.count, 0)} in the period · {c.rows[c.rows.length - 1]?.cumulative ?? 0} in total by its end
                    </Typography>
                    <MiniBarChart
                      color={c.color}
                      points={c.rows.map((r) => ({ key: r.key, label: r.label, value: r.count, title: `${r.label}: ${r.count} new (${r.cumulative} in total)` }))}
                    />
                    <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)', mt: 0.75 }}>{c.note}</Typography>
                  </Box>
                ))}
              </Box>
            </Paper>

            {/* 7. Demand Hotspot Map */}
            <Paper elevation={0} sx={{ ...cardSx, overflow: 'hidden', mb: 2 }}>
              <Box sx={{ p: '13px 16px', borderBottom: '1px solid var(--mac-border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                  <MapIcon sx={{ color: 'var(--sakay-orange)', fontSize: '18px' }} />
                  <Typography sx={{ fontSize: FONT.heading, fontWeight: 700, color: 'var(--mac-text-primary)' }}>
                    SAKAY Booking Activity Hotspots ({hotspotKind === 'pickup' ? 'pickup' : 'drop-off'} clusters)
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1.2, flexWrap: 'wrap' }}>
                  <ToggleButtonGroup size="small" exclusive value={hotspotKind} onChange={(_, v: HotspotKind | null) => v && setHotspotKind(v)}>
                    <ToggleButton value="pickup" sx={{ textTransform: 'none', px: 1.2 }}>Pickups</ToggleButton>
                    <ToggleButton value="dropoff" sx={{ textTransform: 'none', px: 1.2 }}>Drop-offs</ToggleButton>
                  </ToggleButtonGroup>
                  <ToggleButtonGroup size="small" exclusive value={dayType} onChange={(_, v: DayType | null) => v && setDayType(v)}>
                    <ToggleButton value="all" sx={{ textTransform: 'none', px: 1.2 }}>All days</ToggleButton>
                    <ToggleButton value="weekday" sx={{ textTransform: 'none', px: 1.2 }}>Weekdays</ToggleButton>
                    <ToggleButton value="weekend" sx={{ textTransform: 'none', px: 1.2 }}>Weekends</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
              </Box>
              <Typography sx={{ px: '16px', py: 0.8, fontSize: FONT.caption, color: 'var(--mac-text-muted)' }}>
                {spots.length > 0
                  ? `Top ${spots.length} areas of about 550 m, from the ${hotspotKind === 'pickup' ? 'pickup' : 'drop-off'} coordinates of SAKAY bookings (${dayType === 'all' ? 'all days' : dayType === 'weekday' ? 'Monday to Friday' : 'Saturday and Sunday'}). Larger circles have more bookings.`
                  : `No booking with a ${hotspotKind === 'pickup' ? 'pickup' : 'drop-off'} location matches the filter.`}
              </Typography>
              <div ref={mapRef} style={{ width: '100%', height: '380px' }} />
            </Paper>

            {/* 8. Weekday against weekend */}
            <Paper elevation={0} sx={{ ...cardSx, p: 2.4 }}>
              <SectionTitle>Weekdays Against Weekends</SectionTitle>
              <TableContainer>
                <Table size="small">
                  <TableHead sx={{ backgroundColor: '#FAFAFC' }}>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>PERIOD</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>BOOKINGS</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>PER DAY</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>BUSIEST PICKUP AREA</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>BUSIEST DROP-OFF AREA</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>BUSIEST BARANGAY (PICKUP)</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {[data.dayTypes.weekday, data.dayTypes.weekend].map((side) => (
                      <TableRow key={side.label}>
                        <TableCell sx={{ fontWeight: 600 }}>{side.label}</TableCell>
                        <TableCell>{side.bookings}</TableCell>
                        <TableCell>{side.perDay === null ? '—' : `${side.perDay} (over ${side.days} day${side.days === 1 ? '' : 's'})`}</TableCell>
                        <TableCell>{side.pickups[0] ? `${side.pickups[0].label} (${side.pickups[0].count})` : '—'}</TableCell>
                        <TableCell>{side.dropoffs[0] ? `${side.dropoffs[0].label} (${side.dropoffs[0].count})` : '—'}</TableCell>
                        <TableCell>{side.barangays[0] ? `${side.barangays[0].barangay} (${side.barangays[0].count})` : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          </>
        )
      )}
    </Box>
  );
};
