import React, { useState, useEffect, useRef } from 'react';
import { Alert, Box, Button, CircularProgress, TableBody, TableCell, TableRow, Typography } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { CoverageGapsPanel, fetchCoverageGaps } from '@sakay/shared';
import type { CoverageGaps, Hotspot, VolumePeriod } from '@sakay/shared';
import { AnalyticsFilterBar } from '../components/admin/AnalyticsFilterBar';
import { MiniBarChart } from '../components/admin/MiniBarChart';
import { PeakHoursByGroupTable } from '../components/admin/PeakHoursByGroupTable';
import { BarChart } from '../components/common/BarChart';
import { ChartEmpty } from '../components/common/ChartEmpty';
import { CellStack, DataTableCard } from '../components/common/DataTable';
import { MeterRow } from '../components/common/MeterRow';
import { PageNotice } from '../components/common/PageNotice';
import { SegmentedToggle } from '../components/common/SegmentedToggle';
import type { SegmentedOption } from '../components/common/SegmentedToggle';
import { StatStrip } from '../components/common/StatStrip';
import { DashboardCard } from '../components/dashboard/DashboardCard';
import { useOperationalReports } from '../hooks/useOperationalReports';
import { supabase } from '../services/supabaseClient';
import { FONT, SPACE } from '../styles/density';
import { PAGE_BORDER, PAGE_TEXT, rowActionSx } from '../styles/pageTheme';

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
 * Every figure is computed from SAKAY records (packages/shared/src/utils/transportAnalytics.ts and transportInsights.ts).
 * ============================================================================
 */

const CALAPAN_CENTER: L.LatLngExpression = [13.4117, 121.1803];

const PERIOD_WORD: Record<VolumePeriod, string> = { day: 'day', week: 'week', month: 'month' };
const PERIOD_RANGE_TEXT: Record<VolumePeriod, string> = { day: 'days', week: 'weeks', month: 'months' };

type HotspotKind = 'pickup' | 'dropoff';
type DayType = 'all' | 'weekday' | 'weekend';
type PeakGroup = 'toda' | 'barangay';

const PERIOD_OPTIONS: SegmentedOption<VolumePeriod>[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];
const PEAK_GROUP_OPTIONS: SegmentedOption<PeakGroup>[] = [
  { value: 'toda', label: 'By TODA' },
  { value: 'barangay', label: 'By barangay' },
];
const HOTSPOT_KIND_OPTIONS: SegmentedOption<HotspotKind>[] = [
  { value: 'pickup', label: 'Pickups' },
  { value: 'dropoff', label: 'Drop-offs' },
];
const DAY_TYPE_OPTIONS: SegmentedOption<DayType>[] = [
  { value: 'all', label: 'All days' },
  { value: 'weekday', label: 'Weekdays' },
  { value: 'weekend', label: 'Weekends' },
];

interface OutcomeBarProps {
  label: string;
  count: number;
  total: number;
  color: string;
  detail?: string;
  /** The lines of the tooltip under the label (default: how many of how many) */
  tooltipLines?: string[];
  /** Width of the label column in px */
  labelWidth?: number;
}

// One bar of a share: "Completed  ▇▇▇▇  12 (34%)"
const OutcomeBar: React.FC<OutcomeBarProps> = ({ label, count, total, color, detail, tooltipLines, labelWidth }) => (
  <MeterRow
    label={label}
    valueText={`${count} (${total > 0 ? Math.round((count / total) * 100) : 0}%)`}
    percent={total > 0 ? (count / total) * 100 : 0}
    color={color}
    detail={detail}
    tooltipLines={tooltipLines ?? [`${count} of ${total} booking requests (${total > 0 ? Math.round((count / total) * 100) : 0}%)`]}
    labelWidth={labelWidth}
  />
);

// What a card shows when the filter leaves no booking to count (or when the figures could not be read: that is not the same as having none)
const NoBookings: React.FC<{ failed: boolean }> = ({ failed }) => (
  <ChartEmpty failed={failed} title="No booking requests match the filter" hint="Try a wider date range, or clear the filters." minHeight={180} />
);

// Two cards side by side once the row is wide enough (measured on the row itself, so it also works beside an open sidebar)
const splitRowSx = (columns: string, from = 980) => ({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: SPACE.gapLarge,
  alignItems: 'stretch',
  mb: SPACE.gapLarge,
  [`@container (min-width: ${from}px)`]: { gridTemplateColumns: columns },
});

export const AnalyticsPage: React.FC = () => {
  const { data, filter, setFilter, isLoading, loadError, reload } = useOperationalReports();
  const [period, setPeriod] = useState<VolumePeriod>('day');
  const [hotspotKind, setHotspotKind] = useState<HotspotKind>('pickup');
  const [dayType, setDayType] = useState<DayType>('all');
  const [peakGroup, setPeakGroup] = useState<PeakGroup>('toda');

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
        .bindTooltip(`${spot.label.replace(/</g, '&lt;')}: ${spot.count} ${noun}${spot.count === 1 ? '' : 's'}`, { sticky: true, direction: 'top' })
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
  const failed = Boolean(loadError);
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

  const refreshButton = (
    <Button onClick={() => void reload()} startIcon={<RefreshIcon sx={{ fontSize: 16 }} />} sx={rowActionSx('neutral')}>
      Refresh
    </Button>
  );

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 4.8 }}>
      {loadError && (
        <PageNotice
          tone="danger"
          title="The analytics could not be loaded"
          action={
            <Button onClick={() => void reload()} sx={rowActionSx('neutral')}>
              Try again
            </Button>
          }
        >
          {loadError}
        </PageNotice>
      )}

      {isLoading && !data ? (
        <Box role="status" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', py: '48px' }}>
          <CircularProgress size={21} sx={{ color: 'var(--sakay-orange)' }} />
          <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary }}>Loading analytics...</Typography>
        </Box>
      ) : (
        data && (
          <>
            {/* 2. Filters, and the period of the trend charts */}
            <AnalyticsFilterBar filter={filter} onChange={setFilter} todaOptions={data.todaOptions} barangayOptions={data.barangayOptions} actions={refreshButton} />
            <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 14px', mb: SPACE.gapLarge }}>
              <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.primary }}>View trends by</Typography>
              <SegmentedToggle label="View trends by" value={period} options={PERIOD_OPTIONS} onChange={setPeriod} />
              <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary }}>Showing: {data.filterText}</Typography>
            </Box>

            <CoverageGapsPanel gaps={coverageGaps} loading={coverageLoading} audience="lgu_admin" />

            {/* 3. The key figures */}
            <StatStrip
              label="Key figures"
              minCellWidth={230}
              stats={[
                {
                  key: 'completion',
                  label: 'Booking completion rate',
                  value: service && service.requests > 0 ? `${service.completionRate}%` : '—',
                  note: `${service?.completed ?? 0} of ${service?.requests ?? 0} booking requests were completed`,
                  tone: 'success',
                },
                {
                  key: 'busiest',
                  label: 'Busiest hour',
                  value: busiest ? busiest.hour : '—',
                  note: busiest ? `${busiest.count} booking${busiest.count === 1 ? '' : 's'} created in this hour` : 'No bookings in this selection',
                  tone: 'brand',
                },
                {
                  key: 'fare',
                  label: 'Average fare',
                  value: service && service.completed > 0 ? `₱${service.averageFare.toFixed(2)}` : '—',
                  note: 'Per completed trip (final fare)',
                },
                {
                  key: 'utilization',
                  label: 'Driver utilization',
                  value: drivers && drivers.verifiedDrivers > 0 ? `${drivers.rate}%` : '—',
                  note: `${drivers?.activeDrivers ?? 0} of ${drivers?.verifiedDrivers ?? 0} verified drivers completed a trip in the 30 days up to ${filter.to ? 'the end date' : 'today'}`,
                },
                {
                  key: 'perDriver',
                  label: 'Completed trips per driver',
                  value: data.driverAverage === null ? '—' : data.driverAverage.toFixed(1),
                  note:
                    data.driverAverage === null
                      ? 'No verified drivers in this selection'
                      : `Average over ${drivers?.verifiedDrivers ?? 0} verified driver${drivers?.verifiedDrivers === 1 ? '' : 's'} in this selection. Low-activity and high-demand drivers are listed in Reports.`,
                },
                {
                  key: 'perPassenger',
                  label: 'Bookings per passenger',
                  value: pax?.averageBookingsPerBooker == null ? '—' : pax.averageBookingsPerBooker.toFixed(1),
                  note:
                    pax && pax.bookedAtLeastOnce > 0
                      ? `${pax.bookings} booking${pax.bookings === 1 ? '' : 's'} by ${pax.bookedAtLeastOnce} passenger${pax.bookedAtLeastOnce === 1 ? '' : 's'} who booked; ${pax.repeatBookers} booked more than once${pax.averageBookingsPerRegistered !== null ? `. ${pax.averageBookingsPerRegistered.toFixed(1)} per registered passenger (${pax.registered})` : ''}`
                      : 'No bookings in this selection',
                },
              ]}
            />

            <Box sx={{ containerType: 'inline-size' }}>
              {/* 4. Booking trend + service utilization */}
              <Box sx={splitRowSx('minmax(0, 3fr) minmax(0, 2fr)')}>
                <DashboardCard
                  title={`Booking trend (${trend.length} ${trend.length === 1 ? PERIOD_WORD[period] : PERIOD_RANGE_TEXT[period]})`}
                  description={`${trendTotal} booking${trendTotal === 1 ? '' : 's'} in this period`}
                >
                  {/* the comparison of the last two periods; not shown when the figures could not be read (it would compare two periods of nothing) */}
                  {!failed && (
                    <Alert
                      severity={comparison?.direction === 'decline' ? 'warning' : comparison?.direction === 'growth' ? 'success' : 'info'}
                      sx={{ mb: '14px', py: '2px', borderRadius: '10px', '& .MuiAlert-message': { fontSize: FONT.body, lineHeight: 1.5 } }}
                    >
                      {comparisonText()}
                      {comparison?.inProgress ? ` The current ${PERIOD_WORD[period]} (${comparison.inProgress.label}) has ${comparison.inProgress.total} so far and is not compared until it ends.` : ''}
                    </Alert>
                  )}
                  <BarChart
                    ariaLabel={`Bar chart of bookings per ${PERIOD_WORD[period]}`}
                    height={170}
                    empty={<ChartEmpty failed={failed} title="No bookings in this period" hint="Try a wider date range, or clear the filters." minHeight={208} />}
                    points={trend.map((p) => {
                      const other = p.total - p.completed - p.cancelled;
                      return {
                        key: p.key,
                        label: p.label,
                        segments: [
                          { value: p.completed, color: '#2E7D32' },
                          { value: p.cancelled, color: '#DC2626' },
                          { value: other, color: '#B0B7C3' },
                        ],
                        tooltipTitle: p.label,
                        tooltipLines: [
                          `${p.total} booking${p.total === 1 ? '' : 's'}`,
                          `${p.completed} completed`,
                          `${p.cancelled} cancelled`,
                          `${other} other (searching, no driver, in progress)`,
                        ],
                      };
                    })}
                  />
                  {trendTotal > 0 && (
                  <Box sx={{ display: 'flex', gap: '6px 16px', mt: '12px', flexWrap: 'wrap' }}>
                    {[
                      ['#2E7D32', 'Completed'],
                      ['#DC2626', 'Cancelled'],
                      ['#B0B7C3', 'Other (searching, no driver, in progress)'],
                    ].map(([color, label]) => (
                      <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Box aria-hidden sx={{ width: 10, height: 10, borderRadius: '2px', backgroundColor: color }} />
                        <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary }}>{label}</Typography>
                      </Box>
                    ))}
                  </Box>
                  )}
                </DashboardCard>

                <DashboardCard title="Service utilization" description="What happened to the booking requests">
                  {service && service.requests > 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      <OutcomeBar label="Completed" count={service.completed} total={service.requests} color="#2E7D32" />
                      <OutcomeBar label="Cancelled" count={service.cancelled} total={service.requests} color="#DC2626" />
                      <OutcomeBar label="No driver found" count={service.noDriverFound} total={service.requests} color="#F59E0B" />
                      <OutcomeBar label="In progress / open" count={service.inProgress} total={service.requests} color="#1565C0" />
                      <Box sx={{ borderTop: `1px solid ${PAGE_BORDER}`, pt: '14px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        <OutcomeBar label="Solo trips" count={service.soloTrips} total={service.requests} color="#6A1B9A" />
                        <OutcomeBar label="Shared trips" count={service.sharedTrips} total={service.requests} color="#00897B" />
                      </Box>
                    </Box>
                  ) : (
                    <NoBookings failed={failed} />
                  )}
                </DashboardCard>
              </Box>

              {/* 5. Demand by day of the week + peak hours by TODA or barangay */}
              <Box sx={splitRowSx('minmax(0, 2fr) minmax(0, 3fr)', 1180)}>
                <DashboardCard title="Demand by day of the week" description="Bookings on each day, over the period">
                  {data.serviceUtilization.requests > 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      {data.weekdayDemand.map((d) => (
                        <OutcomeBar
                          key={d.day}
                          label={d.day}
                          labelWidth={96}
                          count={d.total}
                          total={data.serviceUtilization.requests}
                          color={d.day === 'Saturday' || d.day === 'Sunday' ? '#00897B' : '#FF5500'}
                          tooltipLines={[
                            `${d.total} of ${data.serviceUtilization.requests} booking requests (${Math.round((d.total / data.serviceUtilization.requests) * 100)}%)`,
                            ...(d.averagePerDay === null ? [] : [`${d.averagePerDay} on an average ${d.day}, over ${d.occurrences} ${d.day}${d.occurrences === 1 ? '' : 's'}`]),
                          ]}
                          detail={d.averagePerDay === null ? undefined : `${d.averagePerDay} on an average ${d.day} (${d.occurrences} ${d.day}${d.occurrences === 1 ? '' : 's'} in the period)`}
                        />
                      ))}
                    </Box>
                  ) : (
                    <NoBookings failed={failed} />
                  )}
                </DashboardCard>

                <DashboardCard
                  title="Peak hours compared"
                  description="When each group is busiest and quietest"
                  wrapHeader
                  actions={<SegmentedToggle label="Compare peak hours" value={peakGroup} options={PEAK_GROUP_OPTIONS} onChange={setPeakGroup} />}
                >
                  <PeakHoursByGroupTable
                    groupLabel={peakGroup === 'toda' ? 'TODA' : 'Barangay (pickup)'}
                    rows={peakGroup === 'toda' ? data.peakHoursByToda : data.peakHoursByBarangay}
                    failed={failed}
                  />
                </DashboardCard>
              </Box>

              {/* 6. Registration and accreditation trends */}
              <Box sx={{ mb: SPACE.gapLarge }}>
                <DashboardCard title="Registration and accreditation trends" description={`New accounts and accreditations, by ${PERIOD_WORD[period]}`}>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr)',
                      gap: '22px',
                      '@container (min-width: 1200px)': { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
                    }}
                  >
                    {[
                      { title: 'New passenger accounts', emptyTitle: 'No new passenger accounts in this period', rows: data.passengerRegistrations[period], color: '#C2410C', note: 'Accounts whose phone number was confirmed. Not split by TODA or barangay.' },
                      { title: 'New driver accounts', emptyTitle: 'No new driver accounts in this period', rows: data.driverRegistrations[period], color: '#1565C0', note: 'Drivers who created an account (any status).' },
                      {
                        title: 'Drivers accredited by the LGU',
                        emptyTitle: 'No drivers accredited in this period',
                        rows: data.driverAccreditations[period],
                        color: '#2E7D32',
                        note:
                          data.driversAccreditedUndated > 0
                            ? `${data.driversAccreditedUndated} verified driver${data.driversAccreditedUndated === 1 ? ' has' : 's have'} no accreditation date on record and are not counted here.`
                            : 'The date the LGU Administrator approved the driver.',
                      },
                    ].map((c) => (
                      <Box key={c.title} sx={{ minWidth: 0 }}>
                        <Typography component="h3" sx={{ fontSize: FONT.body, fontWeight: 700, color: PAGE_TEXT.primary }}>{c.title}</Typography>
                        <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mb: '8px' }}>
                          {c.rows.reduce((sum, r) => sum + r.count, 0)} in the period · {c.rows[c.rows.length - 1]?.cumulative ?? 0} in total by its end
                        </Typography>
                        <MiniBarChart
                          color={c.color}
                          label={c.title}
                          empty={<ChartEmpty failed={failed} title={c.emptyTitle} hint="Try a wider date range, or clear the filters." minHeight={148} />}
                          points={c.rows.map((r) => ({ key: r.key, label: r.label, value: r.count, lines: [`${r.count} new`, `${r.cumulative} in total`] }))}
                        />
                        <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '8px', lineHeight: 1.5 }}>{c.note}</Typography>
                      </Box>
                    ))}
                  </Box>
                </DashboardCard>
              </Box>

              {/* 7. Booking activity hotspots */}
              <Box sx={{ mb: SPACE.gapLarge }}>
                <DashboardCard
                  title={`Booking activity hotspots (${hotspotKind === 'pickup' ? 'pickup' : 'drop-off'} clusters)`}
                  description={
                    spots.length > 0
                      ? `Top ${spots.length} areas of about 550 m, from the ${hotspotKind === 'pickup' ? 'pickup' : 'drop-off'} coordinates of SAKAY bookings (${dayType === 'all' ? 'all days' : dayType === 'weekday' ? 'Monday to Friday' : 'Saturday and Sunday'}). Larger circles have more bookings.`
                      : `No booking with a ${hotspotKind === 'pickup' ? 'pickup' : 'drop-off'} location matches the filter.`
                  }
                  wrapHeader
                  actions={
                    <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <SegmentedToggle label="Show" value={hotspotKind} options={HOTSPOT_KIND_OPTIONS} onChange={setHotspotKind} />
                      <SegmentedToggle label="Days" value={dayType} options={DAY_TYPE_OPTIONS} onChange={setDayType} />
                    </Box>
                  }
                >
                  <Box sx={{ position: 'relative', isolation: 'isolate', borderRadius: '10px', overflow: 'hidden', border: `1px solid ${PAGE_BORDER}` }}>
                    {spots.length === 0 && (
                      <Box role={failed ? 'alert' : 'status'} sx={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, px: '14px', py: '7px', borderRadius: '8px', backgroundColor: '#FFFFFF', border: `1px solid ${PAGE_BORDER}`, boxShadow: '0 4px 14px rgba(15, 23, 42, 0.12)', fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.primary, whiteSpace: 'nowrap' }}>
                        {failed ? 'Hotspots could not be loaded' : 'No hotspots to show'}
                      </Box>
                    )}
                    <div ref={mapRef} role="region" aria-label="Map of booking activity hotspots" style={{ width: '100%', height: '380px' }} />
                  </Box>
                </DashboardCard>
              </Box>

              {/* 8. Weekdays against weekends */}
              <Box sx={{ mb: '10px' }}>
                <Typography component="h2" sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: PAGE_TEXT.primary }}>Weekdays against weekends</Typography>
                <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '2px' }}>The busiest places on weekdays and on weekends.</Typography>
              </Box>
              <DataTableCard
                label="Weekdays against weekends"
                minWidth={760}
                columns={[
                  { label: 'Period' },
                  { label: 'Bookings' },
                  { label: 'Per day' },
                  { label: 'Busiest pickup area' },
                  { label: 'Busiest drop-off area' },
                  { label: 'Busiest barangay (pickup)' },
                ]}
              >
                <TableBody>
                  {[data.dayTypes.weekday, data.dayTypes.weekend].map((side) => (
                    <TableRow key={side.label}>
                      <TableCell><CellStack primary={side.label} /></TableCell>
                      <TableCell>{side.bookings}</TableCell>
                      <TableCell>{side.perDay === null ? '—' : `${side.perDay} (over ${side.days} day${side.days === 1 ? '' : 's'})`}</TableCell>
                      <TableCell>{side.pickups[0] ? `${side.pickups[0].label} (${side.pickups[0].count})` : '—'}</TableCell>
                      <TableCell>{side.dropoffs[0] ? `${side.dropoffs[0].label} (${side.dropoffs[0].count})` : '—'}</TableCell>
                      <TableCell>{side.barangays[0] ? `${side.barangays[0].barangay} (${side.barangays[0].count})` : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </DataTableCard>
            </Box>
          </>
        )
      )}
    </Box>
  );
};
