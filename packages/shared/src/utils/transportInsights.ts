/**
 * More DESCRIPTIVE analytics for the LGU Administrator (checklist A9): the date, TODA and barangay filters, period-against-period comparison, demand by day of the
 * week, peak hours by TODA or barangay, pickup and drop-off hotspots on weekdays against weekends, registration trends, passenger and driver utilization, and the
 * cancellation and incident summaries.
 *
 * Pure functions over rows, like transportAnalytics.ts, which they build on. Descriptive only: nothing here forecasts. Dates and hours are read in Asia/Manila.
 */
import {
  BARANGAY_NOT_IDENTIFIED,
  PEAK_HOURS_CORE_END,
  PEAK_HOURS_CORE_START,
  VOLUME_PERIOD_COUNTS,
  addDaysToKey,
  barangayDemand,
  barangayOfAddress,
  dropoffHotspots,
  isCancelledBooking,
  isCompletedBooking,
  isNoDriverBooking,
  keyToUtc,
  manilaDateKey,
  manilaHour,
  periodKeyOf,
  periodKeysEndingAt,
  periodLabel,
  pct,
  pickupHotspots,
  round1,
  type BarangayDemandRow,
  type BookingLike,
  type Hotspot,
  type VolumePeriod,
  type VolumeRow,
} from './transportAnalytics';
import { INCIDENT_OUTCOME_LABEL } from './incidentReview';

// ---------------------------------------------------------------------------------------------------------------------------------
// The filter (A9.22 - A9.24): a date range, one TODA, one barangay. All of them are optional; an empty string means "no limit".
// ---------------------------------------------------------------------------------------------------------------------------------
export interface AnalyticsFilter {
  /** first day to include, "YYYY-MM-DD" in Manila, or '' */
  from: string;
  /** last day to include, "YYYY-MM-DD" in Manila, or '' */
  to: string;
  todaId: string;
  /** a Calapan barangay, or BARANGAY_NOT_IDENTIFIED, or '' */
  barangay: string;
}

export const NO_ANALYTICS_FILTER: AnalyticsFilter = { from: '', to: '', todaId: '', barangay: '' };

export const isFiltered = (f: AnalyticsFilter): boolean => Boolean(f.from || f.to || f.todaId || f.barangay);

/** What is wrong with the filter, or null */
export function filterProblem(f: AnalyticsFilter): string | null {
  if (f.from && f.to && f.from > f.to) return 'The start date is after the end date.';
  return null;
}

export type FilterableBooking = BookingLike & { driver?: { toda_id?: string | null } | null };

/** The TODA of a booking: the one recorded on it, else the TODA of its driver */
export const bookingTodaId = (b: FilterableBooking): string | null => b.toda_id ?? b.driver?.toda_id ?? null;

/** True when the instant falls on a Manila calendar day inside [from, to] */
export function inDateRange(iso: string | null | undefined, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!iso) return false;
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return false;
  const day = manilaDateKey(time);
  return (!from || day >= from) && (!to || day <= to);
}

export function filterBookings<T extends FilterableBooking>(bookings: T[], f: AnalyticsFilter): T[] {
  if (!isFiltered(f)) return bookings;
  return bookings.filter(
    (b) =>
      inDateRange(b.created_at, f.from, f.to) &&
      (!f.todaId || bookingTodaId(b) === f.todaId) &&
      (!f.barangay || (barangayOfAddress(b.pickup_address) ?? BARANGAY_NOT_IDENTIFIED) === f.barangay)
  );
}

const dayTextFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
const dayText = (key: string): string => dayTextFmt.format(keyToUtc(key));

/** The filter in words, for the page and the top of every export: "Oct 1, 2026 to Oct 15, 2026 / TODA: X / Barangay: Y" */
export function describeFilter(f: AnalyticsFilter, todaName: (id: string) => string = (id) => id): string {
  const parts: string[] = [];
  if (f.from && f.to) parts.push(`${dayText(f.from)} to ${dayText(f.to)}`);
  else if (f.from) parts.push(`From ${dayText(f.from)}`);
  else if (f.to) parts.push(`Until ${dayText(f.to)}`);
  else parts.push('All dates');
  if (f.todaId) parts.push(`TODA: ${todaName(f.todaId)}`);
  if (f.barangay) parts.push(`Barangay: ${f.barangay}`);
  return parts.join(' / ');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Periods: how many day / week / month rows to list for the filter, and the change from one period to the one before (A9.1, A9.2)
// ---------------------------------------------------------------------------------------------------------------------------------
const MAX_PERIODS: Record<VolumePeriod, number> = { day: 62, week: 26, month: 24 };

/** The rows to list: the default count ending now, or, when a date range is chosen, the periods that cover it (at most MAX_PERIODS, the latest ones) */
export function periodsForFilter(period: VolumePeriod, f: AnalyticsFilter, now: Date = new Date()): { count: number; end: Date } {
  const end = f.to ? new Date(`${f.to}T12:00:00+08:00`) : now;
  if (!f.from) return { count: VOLUME_PERIOD_COUNTS[period], end };
  const startKey = periodKeyOf(f.from, period);
  const endKey = periodKeyOf(manilaDateKey(end), period);
  let span: number;
  if (period === 'month') {
    const [sy, sm] = startKey.split('-').map(Number);
    const [ey, em] = endKey.split('-').map(Number);
    span = (ey * 12 + em) - (sy * 12 + sm) + 1;
  } else {
    const days = Math.round((keyToUtc(endKey).getTime() - keyToUtc(startKey).getTime()) / 86_400_000);
    span = Math.floor(days / (period === 'week' ? 7 : 1)) + 1;
  }
  return { count: Math.min(MAX_PERIODS[period], Math.max(1, span)), end };
}

export interface PeriodChange {
  key: string;
  label: string;
  total: number;
  /** the period before it in the list, null for the first row */
  previousTotal: number | null;
  change: number | null;
  /** null when the period before had no bookings (a percentage of zero is meaningless) */
  changePct: number | null;
}

export function periodChanges(rows: VolumeRow[]): PeriodChange[] {
  return rows.map((r, i) => {
    const previous = i > 0 ? rows[i - 1] : null;
    const change = previous ? r.total - previous.total : null;
    return {
      key: r.key,
      label: r.label,
      total: r.total,
      previousTotal: previous ? previous.total : null,
      change,
      changePct: previous && previous.total > 0 && change !== null ? Math.round((change / previous.total) * 100) : null,
    };
  });
}

export type ChangeDirection = 'growth' | 'decline' | 'flat';

export interface PeriodComparison {
  current: VolumeRow;
  previous: VolumeRow;
  change: number;
  changePct: number | null;
  direction: ChangeDirection;
  /** the period that is still going on (not compared, because it is not over); null when the list ends before it */
  inProgress: VolumeRow | null;
}

/**
 * The last two COMPLETE periods against each other. A period that is still going on is left out of the comparison (it would always look like a decline early in
 * the week) and returned as `inProgress`. Null when fewer than two periods are complete.
 */
export function compareLatestPeriods(rows: VolumeRow[], period: VolumePeriod, now: Date = new Date()): PeriodComparison | null {
  const nowKey = periodKeyOf(manilaDateKey(now), period);
  const complete = rows.filter((r) => r.key < nowKey);
  if (complete.length < 2) return null;
  const current = complete[complete.length - 1];
  const previous = complete[complete.length - 2];
  const change = current.total - previous.total;
  return {
    current,
    previous,
    change,
    changePct: previous.total > 0 ? Math.round((change / previous.total) * 100) : null,
    direction: change > 0 ? 'growth' : change < 0 ? 'decline' : 'flat',
    inProgress: rows.find((r) => r.key === nowKey) ?? null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Demand by day of the week (A9.5)
// ---------------------------------------------------------------------------------------------------------------------------------
export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** 0 = Monday ... 6 = Sunday, for a calendar date "YYYY-MM-DD" */
const weekdayIndexOfKey = (key: string): number => (keyToUtc(key).getUTCDay() + 6) % 7;

/** The first and last Manila calendar day of the bookings, or null when none has a date */
function bookingSpan(bookings: BookingLike[]): { from: string; to: string } | null {
  let from = '';
  let to = '';
  for (const b of bookings) {
    if (!b.created_at) continue;
    const t = new Date(b.created_at);
    if (Number.isNaN(t.getTime())) continue;
    const key = manilaDateKey(t);
    if (!from || key < from) from = key;
    if (!to || key > to) to = key;
  }
  return from ? { from, to } : null;
}

/** How many of each weekday (Monday first) lie in [from, to], both included */
function weekdayOccurrences(from: string, to: string): number[] {
  const counts = new Array<number>(7).fill(0);
  for (let key = from, guard = 0; key <= to && guard < 4000; key = addDaysToKey(key, 1), guard++) counts[weekdayIndexOfKey(key)] += 1;
  return counts;
}

export interface WeekdayRow {
  day: string;
  total: number;
  completed: number;
  /** percent of all bookings */
  share: number;
  /** how many of this weekday the bookings span (a span of ten days has two Mondays) */
  occurrences: number;
  /** bookings divided by occurrences, so a short span does not favour the days it happens to contain twice */
  averagePerDay: number | null;
}

export function demandByWeekday(bookings: BookingLike[]): WeekdayRow[] {
  const total = new Array<number>(7).fill(0);
  const completed = new Array<number>(7).fill(0);
  let all = 0;
  for (const b of bookings) {
    if (!b.created_at) continue;
    const t = new Date(b.created_at);
    if (Number.isNaN(t.getTime())) continue;
    const idx = weekdayIndexOfKey(manilaDateKey(t));
    total[idx] += 1;
    all += 1;
    if (isCompletedBooking(b)) completed[idx] += 1;
  }
  const span = bookingSpan(bookings);
  const occ = span ? weekdayOccurrences(span.from, span.to) : new Array<number>(7).fill(0);
  return WEEKDAY_NAMES.map((day, i) => ({
    day,
    total: total[i],
    completed: completed[i],
    share: pct(total[i], all),
    occurrences: occ[i],
    averagePerDay: occ[i] > 0 ? round1(total[i] / occ[i]) : null,
  }));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Peak hours compared across TODAs or barangays (A9.6)
// ---------------------------------------------------------------------------------------------------------------------------------
const hourText = (h: number): string => `${h % 12 === 0 ? 12 : h % 12}:00 ${h >= 12 ? 'PM' : 'AM'}`;

export interface GroupPeakRow {
  group: string;
  total: number;
  /** bookings created in each hour of the day (index 0 - 23, Manila) */
  hours: number[];
  peakHour: string | null;
  peakCount: number;
  /** the quietest hour between the core hours of the day (6 AM - 9 PM), the off-peak counterpart */
  quietHour: string | null;
  quietCount: number;
}

/** groupOf returns the name of the group a booking belongs to (a TODA, a barangay) or null for "not identified" */
export function peakHoursByGroup(bookings: BookingLike[], groupOf: (b: BookingLike) => string | null, maxGroups = 12): GroupPeakRow[] {
  const groups = new Map<string, number[]>();
  for (const b of bookings) {
    if (!b.created_at) continue;
    const t = new Date(b.created_at);
    if (Number.isNaN(t.getTime())) continue;
    const name = groupOf(b) ?? 'Not identified';
    const hours = groups.get(name) ?? new Array<number>(24).fill(0);
    hours[manilaHour(t)] += 1;
    groups.set(name, hours);
  }
  return [...groups.entries()]
    .map(([group, hours]) => {
      const total = hours.reduce((a, c) => a + c, 0);
      let peak = 0;
      for (let h = 1; h < 24; h++) if (hours[h] > hours[peak]) peak = h;
      let quiet = PEAK_HOURS_CORE_START;
      for (let h = PEAK_HOURS_CORE_START + 1; h <= PEAK_HOURS_CORE_END; h++) if (hours[h] < hours[quiet]) quiet = h;
      return {
        group,
        total,
        hours,
        peakHour: hours[peak] > 0 ? hourText(peak) : null,
        peakCount: hours[peak],
        quietHour: total > 0 ? hourText(quiet) : null,
        quietCount: hours[quiet],
      };
    })
    .sort((a, b) => b.total - a.total || a.group.localeCompare(b.group))
    .slice(0, maxGroups);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Hotspots on weekdays against weekends (A9.7, A9.8)
// ---------------------------------------------------------------------------------------------------------------------------------
export interface DayTypeSide {
  label: string;
  /** calendar days of this kind inside the span */
  days: number;
  bookings: number;
  /** bookings per calendar day of this kind, so five weekdays and two weekend days can be compared fairly */
  perDay: number | null;
  pickups: Hotspot[];
  dropoffs: Hotspot[];
  barangays: BarangayDemandRow[];
}

const isWeekendKey = (key: string): boolean => {
  const d = keyToUtc(key).getUTCDay();
  return d === 0 || d === 6;
};

/** Monday - Friday against Saturday - Sunday, over [from, to] when given, else over the days the bookings span */
export function hotspotsByDayType(bookings: BookingLike[], spanFrom = '', spanTo = '', top = 5): { weekday: DayTypeSide; weekend: DayTypeSide } {
  const own = bookingSpan(bookings);
  const from = spanFrom || own?.from || '';
  const to = spanTo || own?.to || '';
  let weekdayDays = 0;
  let weekendDays = 0;
  if (from && to) {
    for (let key = from, guard = 0; key <= to && guard < 4000; key = addDaysToKey(key, 1), guard++) {
      if (isWeekendKey(key)) weekendDays += 1;
      else weekdayDays += 1;
    }
  }
  const weekdayBookings: BookingLike[] = [];
  const weekendBookings: BookingLike[] = [];
  for (const b of bookings) {
    if (!b.created_at) continue;
    const t = new Date(b.created_at);
    if (Number.isNaN(t.getTime())) continue;
    (isWeekendKey(manilaDateKey(t)) ? weekendBookings : weekdayBookings).push(b);
  }
  const side = (label: string, days: number, rows: BookingLike[]): DayTypeSide => ({
    label,
    days,
    bookings: rows.length,
    perDay: days > 0 ? round1(rows.length / days) : null,
    pickups: pickupHotspots(rows, undefined, top),
    dropoffs: dropoffHotspots(rows, undefined, top),
    barangays: barangayDemand(rows).slice(0, top),
  });
  return { weekday: side('Weekdays (Monday - Friday)', weekdayDays, weekdayBookings), weekend: side('Weekends (Saturday - Sunday)', weekendDays, weekendBookings) };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Registration and accreditation trends (A9.9, A9.10): how many accounts were created, or accredited, in each period
// ---------------------------------------------------------------------------------------------------------------------------------
export interface RegistrationPoint {
  key: string;
  label: string;
  count: number;
  /** everything up to the end of this period, including what came before the first listed period */
  cumulative: number;
}

/** isoDates: the instants (an account's created_at, a driver's approval) one per account; a missing one is not counted */
export function registrationTrend(isoDates: Array<string | null | undefined>, period: VolumePeriod, count: number = VOLUME_PERIOD_COUNTS[period], now: Date = new Date()): RegistrationPoint[] {
  const keys = periodKeysEndingAt(manilaDateKey(now), period, count);
  const perKey = new Map<string, number>(keys.map((k) => [k, 0]));
  let before = 0;
  for (const iso of isoDates) {
    if (!iso) continue;
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) continue;
    const key = periodKeyOf(manilaDateKey(t), period);
    if (perKey.has(key)) perKey.set(key, (perKey.get(key) ?? 0) + 1);
    else if (key < keys[0]) before += 1;
  }
  let running = before;
  return keys.map((key) => {
    const n = perKey.get(key) ?? 0;
    running += n;
    return { key, label: periodLabel(key, period), count: n, cumulative: running };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Passenger and driver utilization (A9.11, A9.12, A9.13)
// ---------------------------------------------------------------------------------------------------------------------------------
export interface PassengerUtilization {
  /** passengers with a registered account (null when a TODA or barangay filter makes that number meaningless) */
  registered: number | null;
  /** distinct passengers who made at least one booking in the bookings given */
  bookedAtLeastOnce: number;
  bookings: number;
  completedTrips: number;
  /** bookings / registered passengers */
  averageBookingsPerRegistered: number | null;
  /** bookings / passengers who booked */
  averageBookingsPerBooker: number | null;
  averageCompletedPerBooker: number | null;
  /** passengers who booked more than once */
  repeatBookers: number;
}

export function passengerUtilization(registered: number | null, bookings: BookingLike[]): PassengerUtilization {
  const perPassenger = new Map<string, number>();
  for (const b of bookings) if (b.passenger_id) perPassenger.set(b.passenger_id, (perPassenger.get(b.passenger_id) ?? 0) + 1);
  const bookers = perPassenger.size;
  const completed = bookings.filter(isCompletedBooking).length;
  return {
    registered,
    bookedAtLeastOnce: bookers,
    bookings: bookings.length,
    completedTrips: completed,
    averageBookingsPerRegistered: registered !== null && registered > 0 ? round1(bookings.length / registered) : null,
    averageBookingsPerBooker: bookers > 0 ? round1(bookings.length / bookers) : null,
    averageCompletedPerBooker: bookers > 0 ? round1(completed / bookers) : null,
    repeatBookers: [...perPassenger.values()].filter((n) => n > 1).length,
  };
}

/** A driver below this share of the average completed trips is "low activity"; at or above HIGH_DEMAND_RATIO times the average, "high demand" */
export const LOW_ACTIVITY_RATIO = 0.5;
export const HIGH_DEMAND_RATIO = 1.5;

export type DriverActivityLevel = 'High demand' | 'Normal' | 'Low activity';

/** The average completed trips per driver, or null when there are no drivers */
export function averageCompleted(completedPerDriver: number[]): number | null {
  return completedPerDriver.length > 0 ? round1(completedPerDriver.reduce((a, c) => a + c, 0) / completedPerDriver.length) : null;
}

export function classifyDriverActivity(completed: number, average: number | null): DriverActivityLevel {
  if (average === null || average <= 0) return 'Low activity';
  if (completed >= average * HIGH_DEMAND_RATIO) return 'High demand';
  if (completed < average * LOW_ACTIVITY_RATIO) return 'Low activity';
  return 'Normal';
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Cancellation summary (A9.20)
// ---------------------------------------------------------------------------------------------------------------------------------
export interface CountShare {
  label: string;
  count: number;
  /** percent of the group's total */
  share: number;
}

/** Counts equal labels (compared without case), largest first; everything beyond `top` is added up as "Other" */
export function countShares(labels: string[], top = 10, otherLabel = 'Other'): CountShare[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const label of labels) {
    const key = label.toLowerCase();
    const entry = counts.get(key) ?? { label, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  const sorted = [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const head = sorted.slice(0, top);
  const rest = sorted.slice(top).reduce((a, c) => a + c.count, 0);
  const rows = rest > 0 ? [...head, { label: otherLabel, count: rest }] : head;
  return rows.map((r) => ({ label: r.label, count: r.count, share: pct(r.count, labels.length) }));
}

const sentenceCase = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);

/** "PASSENGER_NO_SHOW" becomes "Passenger no show"; free text stays as typed */
export function readableReason(reason: string | null | undefined): string {
  const text = (reason ?? '').trim();
  if (!text) return 'No reason given';
  return /^[A-Z0-9_]+$/.test(text) ? sentenceCase(text.replace(/_/g, ' ')) : text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

export interface CancellationSummary {
  /** booking requests in the group */
  requests: number;
  cancelled: number;
  /** percent of the requests */
  rate: number;
  /** cancelled before any driver accepted, and after one did */
  beforeDriverAccepted: number;
  afterDriverAccepted: number;
  byActor: CountShare[];
  byReason: CountShare[];
  /** requests that ended with no driver found: not a cancellation by anyone, listed beside it */
  noDriverFound: number;
}

export function cancellationSummary(bookings: BookingLike[]): CancellationSummary {
  const cancelled = bookings.filter(isCancelledBooking);
  const after = cancelled.filter((b) => Boolean(b.accepted_at)).length;
  return {
    requests: bookings.length,
    cancelled: cancelled.length,
    rate: pct(cancelled.length, bookings.length),
    beforeDriverAccepted: cancelled.length - after,
    afterDriverAccepted: after,
    byActor: countShares(cancelled.map((b) => (b.cancelled_by ? sentenceCase(b.cancelled_by.trim()) : 'Not recorded'))),
    byReason: countShares(cancelled.map((b) => readableReason(b.cancellation_reason)), 10, 'Other reasons'),
    noDriverFound: bookings.filter(isNoDriverBooking).length,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Incident summary (A9.19)
// ---------------------------------------------------------------------------------------------------------------------------------
export interface IncidentLike {
  category?: string | null;
  status?: string | null;
  priority?: string | null;
  routing?: string | null;
  outcome?: string | null;
  created_at?: string | null;
  reported_toda_id?: string | null;
  booking?: { pickup_address?: string | null } | null;
}

/** The same date, TODA and barangay filter as the bookings (the barangay is that of the trip's pickup address) */
export function filterIncidents<T extends IncidentLike>(rows: T[], f: AnalyticsFilter): T[] {
  if (!isFiltered(f)) return rows;
  return rows.filter(
    (i) =>
      inDateRange(i.created_at, f.from, f.to) &&
      (!f.todaId || i.reported_toda_id === f.todaId) &&
      (!f.barangay || (barangayOfAddress(i.booking?.pickup_address) ?? BARANGAY_NOT_IDENTIFIED) === f.barangay)
  );
}

export interface IncidentSummary {
  total: number;
  /** no decision recorded and not withdrawn */
  open: number;
  /** a decision (an outcome) is recorded */
  decided: number;
  withdrawn: number;
  /** with the LGU Administrator / with the TODA Administrator */
  withLgu: number;
  withToda: number;
  serious: number;
  byCategory: CountShare[];
  byStatus: CountShare[];
  byOutcome: CountShare[];
}

export function incidentSummary(rows: IncidentLike[]): IncidentSummary {
  const withdrawn = rows.filter((i) => i.status === 'Cancelled');
  const decided = rows.filter((i) => i.status !== 'Cancelled' && i.outcome);
  return {
    total: rows.length,
    open: rows.length - withdrawn.length - decided.length,
    decided: decided.length,
    withdrawn: withdrawn.length,
    withLgu: rows.filter((i) => i.routing === 'LGU').length,
    withToda: rows.filter((i) => i.routing === 'TODA').length,
    serious: rows.filter((i) => i.priority === 'Serious').length,
    byCategory: countShares(rows.map((i) => (i.category || 'Not recorded').trim())),
    byStatus: countShares(rows.map((i) => (i.status || 'Not recorded').trim())),
    byOutcome: countShares(decided.map((i) => INCIDENT_OUTCOME_LABEL[i.outcome as keyof typeof INCIDENT_OUTCOME_LABEL] ?? String(i.outcome))),
  };
}
