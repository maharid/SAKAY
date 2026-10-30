import { addDaysToKey, isCancelledBooking, isCompletedBooking, isNoDriverBooking, isSharedBooking, keyToUtc, manilaDateKey, manilaHour, pct } from './transportAnalytics';
import type { BookingLike, VolumeRow } from './transportAnalytics';

/**
 * One day, one week, one month (panel comment, decision D-P6: "kapag day lang, 1 day lang ang makikita. Kapag week edi 1 week").
 *
 * The analytics used to show "Daily" as the last 14 days, "Weekly" as the last 8 weeks and "Monthly" as the last 6 months. Now the report period is chosen as ONE period:
 *   day    the chosen day, shown hour by hour
 *   week   the Monday - Sunday week that contains the chosen day, shown day by day
 *   month  the calendar month of the chosen day, shown day by day
 *   custom a from / to range the person types (the earlier behaviour, with its own choice of day / week / month bars)
 * Every date is a Manila calendar date "YYYY-MM-DD". Pure functions: no network, no storage.
 */
export type ReportScope = 'day' | 'week' | 'month' | 'custom';
export type SingleScope = Exclude<ReportScope, 'custom'>;

export interface ScopeRange {
  from: string;
  to: string;
  /** "Fri, Oct 30, 2026" / "Oct 26 - Nov 1, 2026" / "October 2026" */
  label: string;
}

const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const shortFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const monthFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });

const weekStart = (key: string): string => addDaysToKey(key, -((keyToUtc(key).getUTCDay() + 6) % 7));
const monthStart = (key: string): string => `${key.slice(0, 7)}-01`;
const monthEnd = (key: string): string => {
  const [y, m] = key.split('-').map(Number);
  return addDaysToKey(`${new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)}`, -1);
};

export function scopeRange(scope: SingleScope, anchor: string): ScopeRange {
  if (scope === 'day') return { from: anchor, to: anchor, label: dayFmt.format(keyToUtc(anchor)) };
  if (scope === 'week') {
    const from = weekStart(anchor);
    const to = addDaysToKey(from, 6);
    const year = keyToUtc(to).getUTCFullYear();
    return { from, to, label: `${shortFmt.format(keyToUtc(from))} - ${shortFmt.format(keyToUtc(to))}, ${year}` };
  }
  return { from: monthStart(anchor), to: monthEnd(anchor), label: monthFmt.format(keyToUtc(anchor)) };
}

/** The anchor moved one period back (-1) or forward (+1): a day, a week, or a month (the day of the month is kept, or the last day of a shorter month) */
export function shiftAnchor(scope: SingleScope, anchor: string, delta: number): string {
  if (scope === 'day') return addDaysToKey(anchor, delta);
  if (scope === 'week') return addDaysToKey(anchor, 7 * delta);
  const [y, m, d] = anchor.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + delta, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Today in Manila */
export const todayKey = (now: Date = new Date()): string => manilaDateKey(now);

const emptyRow = (key: string, label: string): VolumeRow => ({ key, label, total: 0, completed: 0, cancelled: 0, noDriverFound: 0, sharedTrips: 0, grossFare: 0, averageFare: 0, completionRate: 0 });

const hourLabel = (h: number): string => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;

const fareOf = (b: BookingLike): number => Number((b as { actual_fare?: number | string | null }).actual_fare ?? (b as { estimated_fare?: number | string | null }).estimated_fare ?? 0) || 0;

function tally(row: VolumeRow, b: BookingLike): void {
  row.total += 1;
  if (isSharedBooking(b)) row.sharedTrips += 1;
  if (isCompletedBooking(b)) {
    row.completed += 1;
    row.grossFare += fareOf(b);
  } else if (isCancelledBooking(b)) row.cancelled += 1;
  else if (isNoDriverBooking(b)) row.noDriverFound += 1;
}

function finish(rows: VolumeRow[]): VolumeRow[] {
  rows.forEach((r) => {
    r.grossFare = Math.round(r.grossFare * 100) / 100;
    r.averageFare = r.completed > 0 ? Math.round((r.grossFare / r.completed) * 100) / 100 : 0;
    r.completionRate = pct(r.completed, r.total);
  });
  return rows;
}

/**
 * The bars of ONE period: 24 hourly bars for a day, one bar per day for a week or a month. Bookings outside [from, to] are ignored, and every hour / day of the
 * period is there even when it had no booking (an empty bar is information).
 */
export function scopeSeries(bookings: BookingLike[], scope: SingleScope, from: string, to: string): VolumeRow[] {
  if (scope === 'day') {
    const rows = Array.from({ length: 24 }, (_, h) => emptyRow(`${from}T${String(h).padStart(2, '0')}`, hourLabel(h)));
    for (const b of bookings) {
      if (!b.created_at) continue;
      const when = new Date(b.created_at);
      if (manilaDateKey(when) !== from) continue;
      tally(rows[manilaHour(when)], b);
    }
    return finish(rows);
  }
  const rows: VolumeRow[] = [];
  const index = new Map<string, VolumeRow>();
  for (let key = from; key <= to; key = addDaysToKey(key, 1)) {
    const row = emptyRow(key, scope === 'week' ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', day: 'numeric' }).format(keyToUtc(key)) : String(Number(key.slice(8))));
    rows.push(row);
    index.set(key, row);
  }
  for (const b of bookings) {
    if (!b.created_at) continue;
    const row = index.get(manilaDateKey(new Date(b.created_at)));
    if (row) tally(row, b);
  }
  return finish(rows);
}

export interface ScopeComparison {
  current: number;
  previous: number;
  change: number;
  /** null when the earlier period had no bookings (a percentage of zero is meaningless) */
  changePct: number | null;
  direction: 'growth' | 'decline' | 'same';
  /** "the day before" / "the 7 days before" / "the 31 days before" */
  previousLabel: string;
}

/** This period's bookings against the period of the same length just before it */
export function compareWithPrevious(currentTotal: number, previousTotal: number, from: string, to: string): ScopeComparison {
  const days = Math.round((keyToUtc(to).getTime() - keyToUtc(from).getTime()) / 86_400_000) + 1;
  const change = currentTotal - previousTotal;
  return {
    current: currentTotal,
    previous: previousTotal,
    change,
    changePct: previousTotal > 0 ? Math.round((change / previousTotal) * 100) : null,
    direction: change > 0 ? 'growth' : change < 0 ? 'decline' : 'same',
    previousLabel: days === 1 ? 'the day before' : `the ${days} days before`,
  };
}

/** The window of the same length that ends the day before `from` (for the comparison above) */
export function previousWindow(from: string, to: string): { from: string; to: string } {
  const days = Math.round((keyToUtc(to).getTime() - keyToUtc(from).getTime()) / 86_400_000) + 1;
  const prevTo = addDaysToKey(from, -1);
  return { from: addDaysToKey(prevTo, -(days - 1)), to: prevTo };
}
