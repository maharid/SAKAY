/**
 * DESCRIPTIVE transportation analytics (Chapter 1: "descriptive analytics only ... no forecasting").
 *
 * Pure functions over booking rows, used by the LGU Analytics and Reports pages. Every number the pages show comes from here, so
 * nothing on those pages is a value written in the screen code. The figures describe SAKAY bookings only (the pilot is one TODA and one
 * barangay; they are not citywide demand).
 *
 * Dates and hours are read in Asia/Manila whatever the viewer's computer is set to.
 */
import { CALAPAN_BARANGAYS } from '../config/calapanBarangays';

export interface BookingLike {
  booking_status?: string | null;
  created_at?: string | null;
  actual_fare?: number | string | null;
  estimated_fare?: number | string | null;
  is_shared_trip?: boolean | null;
  trip_type?: string | null;
  pickup_address?: string | null;
  pickup_latitude?: number | string | null;
  pickup_longitude?: number | string | null;
  driver_id?: string | null;
  actual_distance_km?: number | string | null;
  estimated_distance_km?: number | string | null;
}

const MANILA = 'Asia/Manila';

/** The pickup area used to group hotspots: a cell of about 0.005 degrees (roughly 550 m) */
export const HOTSPOT_CELL_DEGREES = 0.005;
/** How many hotspots the map shows */
export const HOTSPOT_MAX_COUNT = 8;
/** Days shown in the booking-trend chart */
export const BOOKING_TREND_DAYS = 14;
/** A driver counts as active when they completed a trip within this many days */
export const DRIVER_ACTIVITY_WINDOW_DAYS = 30;
/** Hours of the day always listed in the peak-hour report (an hour outside them is added when it has bookings) */
export const PEAK_HOURS_CORE_START = 6;
export const PEAK_HOURS_CORE_END = 21;

export const isCompletedBooking = (b: BookingLike): boolean => b.booking_status === 'Completed';
export const isCancelledBooking = (b: BookingLike): boolean => (b.booking_status ?? '').includes('Cancel');
export const isNoDriverBooking = (b: BookingLike): boolean => b.booking_status === 'No Driver Found';
export const isSharedBooking = (b: BookingLike): boolean => b.is_shared_trip === true || b.trip_type === 'Shared';

const fare = (b: BookingLike): number => Number(b.actual_fare ?? b.estimated_fare) || 0;

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: MANILA, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: MANILA, hour: '2-digit', hour12: false });

/** "2026-10-06" for an instant, as the calendar date in Manila */
export const manilaDateKey = (d: Date): string => dateFmt.format(d);
/** 0-23, the hour in Manila */
export const manilaHour = (d: Date): number => Number(hourFmt.format(d)) % 24;

const round1 = (n: number): number => Math.round(n * 10) / 10;
const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);

// ---------------------------------------------------------------------------------------------------------------------------------
// Booking volume by day, week or month (TODA reports: daily, weekly and monthly booking reports, platform volume, gross fare)
// ---------------------------------------------------------------------------------------------------------------------------------
export type VolumePeriod = 'day' | 'week' | 'month';

/** How many periods each report lists, newest last: 14 days, 8 weeks (Monday to Sunday), 6 months */
export const VOLUME_PERIOD_COUNTS: Record<VolumePeriod, number> = { day: 14, week: 8, month: 6 };

export interface VolumeRow {
  /** "2026-10-06" for a day, the Monday "2026-10-05" for a week, "2026-10" for a month */
  key: string;
  label: string;
  total: number;
  completed: number;
  cancelled: number;
  noDriverFound: number;
  sharedTrips: number;
  /** final fares of the completed trips, in pesos (cash) */
  grossFare: number;
  averageFare: number;
  /** percent of the period's requests that were completed */
  completionRate: number;
}

const shortDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const monthLabelFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' });

const keyToUtc = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d ?? 1));
};
const utcToKey = (d: Date): string => d.toISOString().slice(0, 10);
const addDaysToKey = (key: string, days: number): string => utcToKey(new Date(keyToUtc(key).getTime() + days * 86_400_000));
/** The Monday of the week that contains a calendar date ("YYYY-MM-DD") */
const weekStartKey = (key: string): string => addDaysToKey(key, -((keyToUtc(key).getUTCDay() + 6) % 7));

function periodKeyOf(dateKey: string, period: VolumePeriod): string {
  if (period === 'day') return dateKey;
  if (period === 'week') return weekStartKey(dateKey);
  return dateKey.slice(0, 7);
}

function periodKeysEndingAt(nowKey: string, period: VolumePeriod, count: number): string[] {
  const keys: string[] = [];
  if (period === 'day') {
    for (let i = count - 1; i >= 0; i--) keys.push(addDaysToKey(nowKey, -i));
  } else if (period === 'week') {
    const start = weekStartKey(nowKey);
    for (let i = count - 1; i >= 0; i--) keys.push(addDaysToKey(start, -7 * i));
  } else {
    const [y, m] = nowKey.split('-').map(Number);
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(y, m - 1 - i, 1));
      keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
  }
  return keys;
}

function periodLabel(key: string, period: VolumePeriod): string {
  if (period === 'day') return shortDate.format(keyToUtc(key));
  if (period === 'week') return `${shortDate.format(keyToUtc(key))} - ${shortDate.format(keyToUtc(addDaysToKey(key, 6)))}`;
  return monthLabelFmt.format(keyToUtc(`${key}-01`));
}

export function volumeByPeriod(
  bookings: BookingLike[],
  period: VolumePeriod,
  count: number = VOLUME_PERIOD_COUNTS[period],
  now: Date = new Date()
): VolumeRow[] {
  const rows = new Map<string, VolumeRow>();
  const order = periodKeysEndingAt(manilaDateKey(now), period, count);
  for (const key of order) {
    rows.set(key, { key, label: periodLabel(key, period), total: 0, completed: 0, cancelled: 0, noDriverFound: 0, sharedTrips: 0, grossFare: 0, averageFare: 0, completionRate: 0 });
  }
  for (const b of bookings) {
    if (!b.created_at) continue;
    const row = rows.get(periodKeyOf(manilaDateKey(new Date(b.created_at)), period));
    if (!row) continue;
    row.total += 1;
    if (isSharedBooking(b)) row.sharedTrips += 1;
    if (isCompletedBooking(b)) {
      row.completed += 1;
      row.grossFare += fare(b);
    } else if (isCancelledBooking(b)) row.cancelled += 1;
    else if (isNoDriverBooking(b)) row.noDriverFound += 1;
  }
  return order.map((key) => {
    const row = rows.get(key) as VolumeRow;
    row.grossFare = Math.round(row.grossFare * 100) / 100;
    row.averageFare = row.completed > 0 ? Math.round((row.grossFare / row.completed) * 100) / 100 : 0;
    row.completionRate = pct(row.completed, row.total);
    return row;
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Booking trend: bookings per day for the last N days (the daily volume, in the shape the trend chart uses)
// ---------------------------------------------------------------------------------------------------------------------------------
export interface TrendPoint {
  date: string;
  label: string;
  total: number;
  completed: number;
  cancelled: number;
}

export function bookingTrend(bookings: BookingLike[], days: number = BOOKING_TREND_DAYS, now: Date = new Date()): TrendPoint[] {
  return volumeByPeriod(bookings, 'day', days, now).map((r) => ({ date: r.key, label: r.label, total: r.total, completed: r.completed, cancelled: r.cancelled }));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Peak hours
// ---------------------------------------------------------------------------------------------------------------------------------
export interface PeakHourPoint {
  hour: string;
  count: number;
}

const hourLabel = (h: number): string => `${h % 12 === 0 ? 12 : h % 12}:00 ${h >= 12 ? 'PM' : 'AM'}`;

export function peakHourDistribution(bookings: BookingLike[]): PeakHourPoint[] {
  const counts = new Array<number>(24).fill(0);
  for (const b of bookings) {
    if (b.created_at) counts[manilaHour(new Date(b.created_at))] += 1;
  }
  const out: PeakHourPoint[] = [];
  for (let h = 0; h < 24; h++) {
    if ((h >= PEAK_HOURS_CORE_START && h <= PEAK_HOURS_CORE_END) || counts[h] > 0) out.push({ hour: hourLabel(h), count: counts[h] });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Demand hotspots: where pickups cluster (computed from the pickup coordinates, never from a fixed list)
// ---------------------------------------------------------------------------------------------------------------------------------
export interface Hotspot {
  lat: number;
  lng: number;
  count: number;
  /** share of all pickups that have coordinates, in percent */
  share: number;
  /** the pickup address most often seen in this area */
  label: string;
}

export function pickupHotspots(bookings: BookingLike[], cell: number = HOTSPOT_CELL_DEGREES, top: number = HOTSPOT_MAX_COUNT): Hotspot[] {
  type Acc = { count: number; sumLat: number; sumLng: number; addresses: Map<string, number> };
  const cells = new Map<string, Acc>();
  let located = 0;
  for (const b of bookings) {
    const lat = Number(b.pickup_latitude);
    const lng = Number(b.pickup_longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
    located += 1;
    const key = `${Math.round(lat / cell)}:${Math.round(lng / cell)}`;
    const acc = cells.get(key) ?? { count: 0, sumLat: 0, sumLng: 0, addresses: new Map<string, number>() };
    acc.count += 1;
    acc.sumLat += lat;
    acc.sumLng += lng;
    const addr = (b.pickup_address ?? '').trim();
    if (addr) acc.addresses.set(addr, (acc.addresses.get(addr) ?? 0) + 1);
    cells.set(key, acc);
  }
  return [...cells.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, top)
    .map((acc) => {
      const label = [...acc.addresses.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Pickup area';
      return { lat: acc.sumLat / acc.count, lng: acc.sumLng / acc.count, count: acc.count, share: pct(acc.count, located), label };
    });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Barangay demand: the barangay named in the pickup address (a booking stores the address text, not a barangay)
// ---------------------------------------------------------------------------------------------------------------------------------
export interface BarangayDemandRow {
  barangay: string;
  count: number;
  percentage: number;
}

export const BARANGAY_NOT_IDENTIFIED = 'Not identified in address';

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Longest names first, so "San Vicente Central" is tried before any shorter name could match part of it.
const BARANGAY_MATCHERS = [...CALAPAN_BARANGAYS]
  .sort((a, b) => b.length - a.length)
  .map((name) => ({ name, re: new RegExp(`(^|[^a-z0-9])${escapeRegExp(name.toLowerCase())}($|[^a-z0-9])`) }));

/** The Calapan barangay named in an address, or null */
export function barangayOfAddress(address?: string | null): string | null {
  const text = (address ?? '').toLowerCase();
  if (!text) return null;
  return BARANGAY_MATCHERS.find((m) => m.re.test(text))?.name ?? null;
}

export function barangayDemand(bookings: BookingLike[]): BarangayDemandRow[] {
  const counts = new Map<string, number>();
  for (const b of bookings) {
    const key = barangayOfAddress(b.pickup_address) ?? BARANGAY_NOT_IDENTIFIED;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = bookings.length;
  return [...counts.entries()]
    .sort((a, b) => (a[0] === BARANGAY_NOT_IDENTIFIED ? 1 : b[0] === BARANGAY_NOT_IDENTIFIED ? -1 : b[1] - a[1]))
    .map(([barangay, count]) => ({ barangay, count, percentage: pct(count, total) }));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Service utilization: what happened to the booking requests
// ---------------------------------------------------------------------------------------------------------------------------------
export interface ServiceUtilization {
  requests: number;
  completed: number;
  cancelled: number;
  noDriverFound: number;
  inProgress: number;
  completionRate: number;
  cancellationRate: number;
  noDriverRate: number;
  soloTrips: number;
  sharedTrips: number;
  /** gross fares of completed trips, in pesos, and their average */
  grossFare: number;
  averageFare: number;
}

export function serviceUtilization(bookings: BookingLike[]): ServiceUtilization {
  const completed = bookings.filter(isCompletedBooking);
  const cancelled = bookings.filter(isCancelledBooking);
  const noDriver = bookings.filter(isNoDriverBooking);
  const gross = completed.reduce((sum, b) => sum + fare(b), 0);
  const shared = bookings.filter(isSharedBooking).length;
  return {
    requests: bookings.length,
    completed: completed.length,
    cancelled: cancelled.length,
    noDriverFound: noDriver.length,
    inProgress: bookings.length - completed.length - cancelled.length - noDriver.length,
    completionRate: pct(completed.length, bookings.length),
    cancellationRate: pct(cancelled.length, bookings.length),
    noDriverRate: pct(noDriver.length, bookings.length),
    soloTrips: bookings.length - shared,
    sharedTrips: shared,
    grossFare: Math.round(gross * 100) / 100,
    averageFare: completed.length > 0 ? Math.round((gross / completed.length) * 100) / 100 : 0,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Driver utilization: how many of the verified drivers actually carried passengers recently
// ---------------------------------------------------------------------------------------------------------------------------------
export interface DriverUtilizationSummary {
  verifiedDrivers: number;
  activeDrivers: number;
  /** percent of verified drivers with at least one completed trip in the window */
  rate: number;
  windowDays: number;
}

export function driverUtilizationSummary(
  verifiedDriverIds: string[],
  bookings: Array<BookingLike & { driver_id?: string | null }>,
  windowDays: number = DRIVER_ACTIVITY_WINDOW_DAYS,
  now: Date = new Date()
): DriverUtilizationSummary {
  const since = now.getTime() - windowDays * 86_400_000;
  const active = new Set<string>();
  for (const b of bookings) {
    if (!isCompletedBooking(b) || !b.driver_id || !b.created_at) continue;
    if (new Date(b.created_at).getTime() >= since) active.add(b.driver_id);
  }
  const activeDrivers = verifiedDriverIds.filter((id) => active.has(id)).length;
  return { verifiedDrivers: verifiedDriverIds.length, activeDrivers, rate: round1(verifiedDriverIds.length ? (activeDrivers / verifiedDriverIds.length) * 100 : 0), windowDays };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Driver activity: trips, distance and fares per driver (TODA report: driver trip volume and activity)
// ---------------------------------------------------------------------------------------------------------------------------------
export interface DriverActivityRow {
  driverId: string;
  name: string;
  plate: string;
  completed: number;
  cancelled: number;
  /** road distance of the completed trips, in km */
  km: number;
  grossFare: number;
  /** the creation time of the driver's latest completed booking */
  lastTripAt: string | null;
  /** completed a trip within the activity window */
  activeInWindow: boolean;
}

export function driverActivity(
  bookings: BookingLike[],
  drivers: Array<{ driver_id: string; full_name: string; plate_number?: string | null }>,
  windowDays: number = DRIVER_ACTIVITY_WINDOW_DAYS,
  now: Date = new Date()
): DriverActivityRow[] {
  const since = now.getTime() - windowDays * 86_400_000;
  const rows = new Map<string, DriverActivityRow>();
  for (const d of drivers) {
    rows.set(d.driver_id, { driverId: d.driver_id, name: d.full_name, plate: d.plate_number ?? '', completed: 0, cancelled: 0, km: 0, grossFare: 0, lastTripAt: null, activeInWindow: false });
  }
  for (const b of bookings) {
    const row = b.driver_id ? rows.get(b.driver_id) : undefined;
    if (!row) continue;
    if (isCompletedBooking(b)) {
      row.completed += 1;
      row.km += Number(b.actual_distance_km ?? b.estimated_distance_km) || 0;
      row.grossFare += fare(b);
      if (b.created_at && (!row.lastTripAt || b.created_at > row.lastTripAt)) row.lastTripAt = b.created_at;
      if (b.created_at && new Date(b.created_at).getTime() >= since) row.activeInWindow = true;
    } else if (isCancelledBooking(b)) {
      row.cancelled += 1;
    }
  }
  return [...rows.values()]
    .map((r) => ({ ...r, km: round1(r.km), grossFare: Math.round(r.grossFare * 100) / 100 }))
    .sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name));
}

/** completed / (completed + cancelled), in percent, or null when nothing has finished yet */
export function completionRateOfFinished(completed: number, cancelled: number): number | null {
  const finished = completed + cancelled;
  return finished > 0 ? Math.round((completed / finished) * 100) : null;
}
