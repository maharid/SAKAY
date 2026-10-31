import React, { useMemo, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import type { Hotspot, ReportTable, VolumeRow } from '@sakay/shared';

import { BarChart } from '../common/BarChart';
import type { BarPoint } from '../common/BarChart';
import { MeterRow } from '../common/MeterRow';
import { SegmentedToggle } from '../common/SegmentedToggle';
import type { SegmentedOption } from '../common/SegmentedToggle';
import { PeakHoursByGroupTable } from './PeakHoursByGroupTable';
import { HotspotMap } from './HotspotMap';
import { ReportTableView } from './ReportTableView';
import type { OperationalReportsData } from '../../services/operationalReportsService';
import type { ReportKind } from '../../utils/reportTables';
import { FONT } from '../../styles/density';
import { PAGE_BORDER, PAGE_TEXT, secondaryButtonSx } from '../../styles/pageTheme';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** A heading inside the report panel */
const ChartHeading: React.FC<{ children: React.ReactNode; note?: string }> = ({ children, note }) => (
  <Box sx={{ mb: '10px' }}>
    <Typography component="h3" sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: PAGE_TEXT.primary }}>{children}</Typography>
    {note && <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '2px' }}>{note}</Typography>}
  </Box>
);

interface RankedItem {
  label: string;
  value: number;
  /** the number in words beside the bar ("12 trips") */
  text: string;
  tooltip?: string[];
}

/** Horizontal bars, longest first: a comparison of names (the TODAs, the drivers, the barangays, the reasons). The longest bar is the full width. */
const RankedBars: React.FC<{ items: RankedItem[]; color: string; labelWidth?: number; valueWidth?: number }> = ({ items, color, labelWidth = 190, valueWidth = 110 }) => {
  const top = Math.max(1, ...items.map((i) => i.value));
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {items.map((i) => (
        <MeterRow key={i.label} label={i.label} valueText={i.text} percent={(i.value / top) * 100} color={color} labelWidth={labelWidth} valueWidth={valueWidth} tooltipLines={i.tooltip} />
      ))}
    </Box>
  );
};

const Legend: React.FC<{ items: Array<{ label: string; color: string }> }> = ({ items }) => (
  <Box component="ul" aria-label="Chart key" sx={{ m: 0, mt: '8px', p: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
    {items.map((i) => (
      <Box component="li" key={i.label} sx={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: FONT.small, color: PAGE_TEXT.secondary }}>
        <Box aria-hidden sx={{ width: 10, height: 10, borderRadius: '2px', backgroundColor: i.color }} />
        {i.label}
      </Box>
    ))}
  </Box>
);

const OUTCOME = { completed: '#2E8B47', cancelled: '#D93025', noDriver: '#9AA0A6', open: '#E0A100' } as const;

/** One bar per period: completed, cancelled, no driver found and still open, stacked (the tooltip has the numbers) */
const trendPoints = (rows: VolumeRow[]): BarPoint[] =>
  rows.map((r) => ({
    key: r.key,
    label: r.label,
    segments: [
      { value: r.completed, color: OUTCOME.completed },
      { value: r.cancelled, color: OUTCOME.cancelled },
      { value: r.noDriverFound, color: OUTCOME.noDriver },
      { value: Math.max(0, r.total - r.completed - r.cancelled - r.noDriverFound), color: OUTCOME.open },
    ],
    tooltipTitle: r.label,
    tooltipLines: [`${r.total} ${plural(r.total, 'booking', 'bookings')}`, `${r.completed} completed (${r.completionRate}%)`, `${r.cancelled} cancelled · ${r.noDriverFound} no driver found`, `₱${r.grossFare.toLocaleString('en-PH', { maximumFractionDigits: 2 })} estimated gross fare`],
  }));

// ---- peak hours ---------------------------------------------------------------------------------------------------------------------------------------------------------------
type GroupView = 'toda' | 'barangay';
const GROUP_OPTIONS: SegmentedOption<GroupView>[] = [
  { value: 'toda', label: 'By TODA' },
  { value: 'barangay', label: 'By barangay' },
];

/** The 24 hours as a column chart with the busiest one marked, then ONE table at a time (by TODA or by barangay), and the exported table folded away until asked for */
export const PeakHoursSection: React.FC<{ data: OperationalReportsData; table: ReportTable; failed: boolean; emptyText: string }> = ({ data, table, failed, emptyText }) => {
  const [group, setGroup] = useState<GroupView>('toda');
  const [showTable, setShowTable] = useState(false);
  const hours = data.peakHourDistribution;
  const total = hours.reduce((n, h) => n + h.count, 0);
  const busiest = hours.reduce<(typeof hours)[number] | null>((best, h) => (h.count > 0 && (!best || h.count > best.count) ? h : best), null);
  const points: BarPoint[] = hours.map((h) => {
    const short = h.hour.replace(':00 ', '').replace(' ', '').toLowerCase();
    return {
      key: h.hour,
      label: short,
      segments: [{ value: h.count, color: busiest && h.hour === busiest.hour ? '#B34700' : '#F2A163' }],
      tooltipTitle: h.hour,
      tooltipLines: [`${h.count} ${plural(h.count, 'booking', 'bookings')}${total > 0 ? ` (${Math.round((h.count / total) * 100)}% of the day's bookings)` : ''}`, ...(busiest && h.hour === busiest.hour ? ['The busiest hour'] : [])],
    };
  });

  return (
    <Box>
      <ChartHeading note="When SAKAY bookings are created (Asia/Manila time). The darkest column is the busiest hour.">Peak travel hours</ChartHeading>
      {busiest && (
        <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.primary, mb: '10px' }}>
          Busiest hour: <b>{busiest.hour}</b> with {busiest.count} {plural(busiest.count, 'booking', 'bookings')} ({total > 0 ? Math.round((busiest.count / total) * 100) : 0}% of {total}).
        </Typography>
      )}
      <BarChart points={points} ariaLabel="Bookings by hour of the day" height={190} empty={<Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, m: 'auto' }}>{emptyText}</Typography>} />

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', mt: '22px', mb: '10px' }}>
        <Typography component="h3" sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: PAGE_TEXT.primary }}>When each {group === 'toda' ? 'TODA' : 'barangay'} is busiest</Typography>
        <SegmentedToggle label="Peak hours by" value={group} options={GROUP_OPTIONS} onChange={setGroup} />
      </Box>
      {group === 'toda' ? (
        <PeakHoursByGroupTable groupLabel="TODA" rows={data.peakHoursByToda} failed={failed} />
      ) : (
        <PeakHoursByGroupTable groupLabel="Barangay (pickup)" rows={data.peakHoursByBarangay} failed={failed} />
      )}

      <Box sx={{ mt: '22px', pt: '14px', borderTop: `1px solid ${PAGE_BORDER}` }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary }}>The table the exports contain ({table.rows.length} rows: every hour, all bookings and the busiest TODAs).</Typography>
          <Button onClick={() => setShowTable((v) => !v)} aria-expanded={showTable} sx={secondaryButtonSx}>{showTable ? 'Hide the table' : 'Show the table'}</Button>
        </Box>
        {showTable && (
          <Box sx={{ mt: '12px' }}>
            <ReportTableView table={table} emptyText={emptyText} />
          </Box>
        )}
      </Box>
    </Box>
  );
};

// ---- hotspots -----------------------------------------------------------------------------------------------------------------------------------------------------------------
type HotspotKindView = 'pickup' | 'dropoff';
type DayView = 'all' | 'weekday' | 'weekend';
const KIND_OPTIONS: SegmentedOption<HotspotKindView>[] = [
  { value: 'pickup', label: 'Pickups' },
  { value: 'dropoff', label: 'Drop-offs' },
];
const DAY_OPTIONS: SegmentedOption<DayView>[] = [
  { value: 'all', label: 'All days' },
  { value: 'weekday', label: 'Weekdays' },
  { value: 'weekend', label: 'Weekends' },
];

/** A map of the areas (a circle per area, sized by its bookings) beside the ten busiest in a ranked list; pickups or drop-offs, all days, weekdays or weekends */
export const HotspotsSection: React.FC<{ data: OperationalReportsData; emptyText: string }> = ({ data, emptyText }) => {
  const [kind, setKind] = useState<HotspotKindView>('pickup');
  const [days, setDays] = useState<DayView>('all');
  const spots: Hotspot[] = useMemo(() => {
    if (days === 'all') return kind === 'pickup' ? data.hotspots : data.dropoffHotspots;
    const side = days === 'weekday' ? data.dayTypes.weekday : data.dayTypes.weekend;
    return kind === 'pickup' ? side.pickups : side.dropoffs;
  }, [data, kind, days]);
  const ranked = [...spots].sort((a, b) => b.count - a.count).slice(0, 10);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px 14px', flexWrap: 'wrap', mb: '12px' }}>
        <SegmentedToggle label="Show" value={kind} options={KIND_OPTIONS} onChange={setKind} />
        <SegmentedToggle label="Days" value={days} options={DAY_OPTIONS} onChange={setDays} />
      </Box>
      {spots.length === 0 ? (
        <Typography role="status" sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, py: '24px' }}>{emptyText}</Typography>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 3fr) minmax(0, 2fr)' }, gap: '20px', alignItems: 'start' }}>
          <HotspotMap spots={spots} kind={kind} />
          <Box>
            <ChartHeading note="The areas with the most bookings. The map shows where they are.">Ten busiest {kind === 'pickup' ? 'pickup' : 'drop-off'} areas</ChartHeading>
            <RankedBars
              color={kind === 'pickup' ? '#C75000' : '#1D5FA8'}
              labelWidth={170}
              valueWidth={96}
              items={ranked.map((s) => ({ label: s.label, value: s.count, text: `${s.count} (${s.share}%)`, tooltip: [`${s.count} ${kind === 'pickup' ? 'pickups' : 'drop-offs'}, ${s.share}% of those with a location`] }))}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
};

// ---- the other reports: the chart that goes above each table ---------------------------------------------------------------------------------------------------------------
/** The chart above a report's table, from the same figures the table is made of (nothing typed in). Null when the report has no chart or nothing to draw. */
export const ReportChart: React.FC<{ kind: ReportKind; data: OperationalReportsData; trendRows: VolumeRow[] }> = ({ kind, data, trendRows }) => {
  if (kind === 'Trend') {
    if (trendRows.every((r) => r.total === 0)) return null;
    return (
      <Box sx={{ mb: '22px' }}>
        <ChartHeading note="Each bar is a period; the colours are what became of its bookings. Point at a bar for the numbers.">Bookings by period</ChartHeading>
        <BarChart points={trendPoints(trendRows)} ariaLabel="Bookings by period, by what became of them" height={190} />
        <Legend items={[{ label: 'Completed', color: OUTCOME.completed }, { label: 'Cancelled', color: OUTCOME.cancelled }, { label: 'No driver found', color: OUTCOME.noDriver }, { label: 'Still open', color: OUTCOME.open }]} />
      </Box>
    );
  }

  let heading = '';
  let note: string | undefined;
  let items: RankedItem[] = [];
  let color = '#C75000';
  if (kind === 'Bookings' || kind === 'Service') {
    const u = data.serviceUtilization;
    heading = 'What became of the booking requests';
    note = `${u.requests} ${plural(u.requests, 'request', 'requests')} in this selection.`;
    const row = (label: string, count: number, color: string): RankedItem & { color: string } => ({ label, value: count, text: `${count} (${u.requests > 0 ? Math.round((count / u.requests) * 100) : 0}%)`, color });
    items = [row('Completed trips', u.completed, OUTCOME.completed), row('Cancelled', u.cancelled, OUTCOME.cancelled), row('No driver found', u.noDriverFound, OUTCOME.noDriver), row('In progress or open', u.inProgress, OUTCOME.open)];
    if (u.requests === 0) return null;
    return (
      <Box sx={{ mb: '22px' }}>
        <ChartHeading note={note}>{heading}</ChartHeading>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {(items as Array<RankedItem & { color: string }>).map((i) => (
            <MeterRow key={i.label} label={i.label} valueText={i.text} percent={u.requests > 0 ? (i.value / u.requests) * 100 : 0} color={i.color} labelWidth={170} valueWidth={96} />
          ))}
        </Box>
      </Box>
    );
  }
  if (kind === 'Drivers') {
    heading = 'Completed trips of the busiest drivers';
    note = data.driverAverage === null ? undefined : `The average is ${data.driverAverage} completed trips per verified driver.`;
    items = [...data.driverUtilization].sort((a, b) => b.completedTrips - a.completedTrips).slice(0, 10).map((d) => ({ label: d.driverName, value: d.completedTrips, text: `${d.completedTrips} ${plural(d.completedTrips, 'trip', 'trips')}`, tooltip: [d.toda, `${d.completedTrips} completed ${plural(d.completedTrips, 'trip', 'trips')}`] }));
  } else if (kind === 'TODA') {
    heading = 'Completed trips by TODA';
    items = [...data.todaPerformance].sort((a, b) => b.totalTrips - a.totalTrips).slice(0, 10).map((t) => ({ label: t.todaName, value: t.totalTrips, text: `${t.totalTrips} ${plural(t.totalTrips, 'trip', 'trips')}`, tooltip: [`${t.verifiedDrivers} verified ${plural(t.verifiedDrivers, 'driver', 'drivers')}`, `${t.totalTrips} completed ${plural(t.totalTrips, 'trip', 'trips')}`] }));
  } else if (kind === 'Barangay') {
    heading = 'Pickups by barangay';
    color = '#1565C0';
    items = data.barangayDemand.map((b) => ({ label: b.barangay, value: b.count, text: `${b.count} ${plural(b.count, 'pickup', 'pickups')} · ${b.percentage}%` }));
  } else if (kind === 'Cancellations') {
    heading = 'Why bookings were cancelled';
    color = '#D93025';
    items = data.cancellations.byReason.slice(0, 10).map((r) => ({ label: r.label, value: r.count, text: `${r.count} (${r.share}%)` }));
  } else if (kind === 'Incidents') {
    heading = 'Incident reports by category';
    color = '#B34700';
    items = data.incidents.byCategory.slice(0, 10).map((c) => ({ label: c.label, value: c.count, text: `${c.count} (${c.share}%)` }));
  }
  if (items.length === 0 || items.every((i) => i.value === 0)) return null;
  return (
    <Box sx={{ mb: '22px' }}>
      <ChartHeading note={note}>{heading}</ChartHeading>
      <RankedBars items={items} color={color} labelWidth={kind === 'Barangay' ? 190 : 200} valueWidth={kind === 'Barangay' ? 150 : 110} />
    </Box>
  );
};
