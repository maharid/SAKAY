import type { Hotspot, ReportTable, VolumePeriod } from '@sakay/shared';

import type { OperationalReportsData } from '../services/operationalReportsService';

/**
 * The reports of the LGU Reports page as plain tables (checklist A9.15 - A9.21): the page shows them, and the same table is what the Excel, CSV and PDF exports
 * contain, so a printed report never differs from the screen. Pure functions over the figures of operationalReportsService; nothing is written in here.
 */

export type ReportKind = 'Bookings' | 'Trend' | 'Drivers' | 'TODA' | 'PeakHours' | 'Hotspots' | 'Barangay' | 'Service' | 'Cancellations' | 'Incidents';

const notesOf = (d: OperationalReportsData): string[] => [`Filter: ${d.filterText}`];

const PERIOD_TITLE: Record<VolumePeriod, string> = { day: 'Daily', week: 'Weekly', month: 'Monthly' };
const peso = (n: number): string => n.toFixed(2);
const share = (n: number): string => `${n}%`;

function bookingsTable(d: OperationalReportsData): ReportTable {
  const s = d.serviceUtilization;
  return {
    title: 'Booking Report',
    notes: notesOf(d),
    headers: ['Metric', 'Value', 'Basis'],
    rows: [
      ['Total booking requests', d.summary.totalBookings, 'Every booking request, any outcome'],
      ['Completed trips', d.summary.completedTrips, s.requests > 0 ? `${s.completionRate}% of requests` : 'No requests'],
      ['Cancelled bookings', d.summary.cancelledTrips, s.requests > 0 ? `${s.cancellationRate}% of requests` : 'No requests'],
      ['Estimated gross fare value (PHP)', peso(d.summary.totalRevenue), 'Sum of the final fares of the completed trips (cash)'],
      ['Average fare per completed trip (PHP)', peso(d.summary.averageFare), 'Gross fares divided by completed trips'],
    ],
  };
}

function trendTable(d: OperationalReportsData, period: VolumePeriod): ReportTable {
  const rows = d.volume[period];
  const changes = rows.map((r, i) => {
    const prev = i > 0 ? rows[i - 1] : null;
    if (!prev) return { change: '', pct: '' };
    const diff = r.total - prev.total;
    return { change: `${diff > 0 ? '+' : ''}${diff}`, pct: prev.total > 0 ? `${diff > 0 ? '+' : ''}${Math.round((diff / prev.total) * 100)}%` : 'n/a' };
  });
  return {
    title: `Booking Trend Report (${PERIOD_TITLE[period]})`,
    notes: notesOf(d),
    headers: ['Period', 'Bookings', 'Change from the period before', 'Change (%)', 'Completed', 'Cancelled', 'No driver found', 'Shared trips', 'Completion rate', 'Gross fares (PHP)', 'Average fare (PHP)'],
    rows: rows.map((r, i) => [r.label, r.total, changes[i].change, changes[i].pct, r.completed, r.cancelled, r.noDriverFound, r.sharedTrips, share(r.completionRate), peso(r.grossFare), peso(r.averageFare)]),
  };
}

function driversTable(d: OperationalReportsData): ReportTable {
  return {
    title: 'Participating-Driver Utilization Report',
    notes: [...notesOf(d), d.driverAverage === null ? 'No verified drivers in this selection.' : `Average completed trips per verified driver: ${d.driverAverage}. Low activity: under half of it. High demand: at least one and a half times it.`],
    headers: ['Driver', 'TODA', 'Completed trips', 'Passenger rating', 'Account status', 'Activity level'],
    rows: d.driverUtilization.map((r) => [r.driverName, r.toda, r.completedTrips, r.rating === null ? 'Not yet rated' : r.rating.toFixed(2), r.status, r.activity ?? 'Not verified']),
  };
}

function todaTable(d: OperationalReportsData): ReportTable {
  return {
    title: 'TODA Performance Report',
    notes: notesOf(d),
    headers: ['TODA', 'Registered units', 'Verified drivers', 'Completed trips', 'Completed trips per verified driver', 'Completion rate of finished trips'],
    rows: d.todaPerformance.map((t) => [t.todaName, t.activeUnits, t.verifiedDrivers, t.totalTrips, t.averagePerDriver === null ? 'n/a' : t.averagePerDriver, t.completionRate === null ? 'n/a' : share(t.completionRate)]),
  };
}

/** The hour (0 - 23) of a label such as "8:00 AM" or "12:00 PM" */
function hourOfLabel(label: string): number {
  const [time, ampm] = label.split(' ');
  const h = Number(time.split(':')[0]) % 12;
  return ampm === 'PM' ? h + 12 : h;
}

/** One row per hour: a column for all bookings and one for each of the busiest TODAs, so their patterns can be compared side by side */
function peakHoursTable(d: OperationalReportsData): ReportTable {
  const todas = d.peakHoursByToda.slice(0, 5);
  return {
    title: 'Peak-Hour Report',
    notes: [...notesOf(d), 'Hours are when the booking was created, Asia/Manila time.'],
    headers: ['Hour', 'All bookings', ...todas.map((t) => t.group)],
    rows: d.peakHourDistribution.map((h) => [h.hour, h.count, ...todas.map((t) => t.hours[hourOfLabel(h.hour)])]),
  };
}

const spotRows = (kind: string, dayType: string, spots: Hotspot[]): Array<Array<string | number>> =>
  spots.map((s) => [kind, dayType, s.label, s.count, share(s.share), s.lat.toFixed(5), s.lng.toFixed(5)]);

function hotspotsTable(d: OperationalReportsData): ReportTable {
  const { weekday, weekend } = d.dayTypes;
  return {
    title: 'SAKAY Booking Activity Hotspot Report',
    notes: [...notesOf(d), 'Areas are clusters of about 550 m around the pickup or drop-off coordinates of SAKAY bookings. Share is of the bookings that have coordinates.'],
    headers: ['Kind', 'Days', 'Area (most common address)', 'Bookings', 'Share', 'Latitude', 'Longitude'],
    rows: [
      ...spotRows('Pickup', 'All days', d.hotspots),
      ...spotRows('Drop-off', 'All days', d.dropoffHotspots),
      ...spotRows('Pickup', 'Weekdays', weekday.pickups),
      ...spotRows('Drop-off', 'Weekdays', weekday.dropoffs),
      ...spotRows('Pickup', 'Weekends', weekend.pickups),
      ...spotRows('Drop-off', 'Weekends', weekend.dropoffs),
    ],
  };
}

function barangayTable(d: OperationalReportsData): ReportTable {
  return {
    title: 'Barangay Demand Report',
    notes: [...notesOf(d), 'The barangay is read from the pickup address text; a pickup whose address names no Calapan barangay is listed as not identified.'],
    headers: ['Barangay zone', 'Booking requests', 'Share'],
    rows: d.barangayDemand.map((b) => [b.barangay, b.count, share(b.percentage)]),
  };
}

function serviceTable(d: OperationalReportsData): ReportTable {
  const u = d.serviceUtilization;
  const v = d.driverUtilizationSummary;
  return {
    title: 'Service Utilization Report',
    notes: notesOf(d),
    headers: ['Outcome', 'Bookings', 'Share of requests'],
    rows: [
      ['Completed trips', u.completed, share(u.completionRate)],
      ['Cancelled', u.cancelled, share(u.cancellationRate)],
      ['No driver found', u.noDriverFound, share(u.noDriverRate)],
      ['In progress / open', u.inProgress, 'n/a'],
      ['Solo trips', u.soloTrips, 'n/a'],
      ['Shared trips', u.sharedTrips, 'n/a'],
      [`Verified drivers who carried passengers (last ${v.windowDays} days)`, `${v.activeDrivers} of ${v.verifiedDrivers}`, v.verifiedDrivers > 0 ? share(v.rate) : 'n/a'],
    ],
  };
}

function cancellationsTable(d: OperationalReportsData): ReportTable {
  const c = d.cancellations;
  const ofCancelled = (n: number): string => (c.cancelled > 0 ? share(Math.round((n / c.cancelled) * 100)) : '');
  return {
    title: 'Cancellation Summary Report',
    notes: notesOf(d),
    headers: ['Item', 'Bookings', 'Share'],
    rows: [
      ['Booking requests', c.requests, ''],
      ['Cancelled', c.cancelled, share(c.rate)],
      ['Cancelled before a driver accepted', c.beforeDriverAccepted, ofCancelled(c.beforeDriverAccepted)],
      ['Cancelled after a driver accepted', c.afterDriverAccepted, ofCancelled(c.afterDriverAccepted)],
      ['No driver found (not a cancellation by anyone)', c.noDriverFound, ''],
      ...c.byActor.map((a) => [a.label, a.count, share(a.share)]),
      ...c.byReason.map((r) => [r.label, r.count, share(r.share)]),
    ],
  };
}

function incidentsTable(d: OperationalReportsData): ReportTable {
  const i = d.incidents;
  return {
    title: 'Incident Summary Report',
    notes: [...notesOf(d), 'The barangay filter uses the pickup address of the trip the report is about.'],
    headers: ['Item', 'Reports', 'Share'],
    rows: [
      ['Reports filed', i.total, ''],
      ['Open (no decision yet)', i.open, ''],
      ['Decided', i.decided, ''],
      ['Withdrawn by the reporter', i.withdrawn, ''],
      ['With the LGU Administrator', i.withLgu, ''],
      ['With the TODA Administrator', i.withToda, ''],
      ['Serious (assault, harassment, threat, crime)', i.serious, ''],
      ...i.byCategory.map((c) => [c.label, c.count, share(c.share)]),
      ...i.byStatus.map((c) => [c.label, c.count, share(c.share)]),
      ...i.byOutcome.map((c) => [c.label, c.count, share(c.share)]),
    ],
  };
}

export function reportTableFor(kind: ReportKind, data: OperationalReportsData, period: VolumePeriod): ReportTable {
  switch (kind) {
    case 'Bookings': return bookingsTable(data);
    case 'Trend': return trendTable(data, period);
    case 'Drivers': return driversTable(data);
    case 'TODA': return todaTable(data);
    case 'PeakHours': return peakHoursTable(data);
    case 'Hotspots': return hotspotsTable(data);
    case 'Barangay': return barangayTable(data);
    case 'Service': return serviceTable(data);
    case 'Cancellations': return cancellationsTable(data);
    case 'Incidents': return incidentsTable(data);
  }
}
