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
const labelFmt = new Intl.DateTimeFormat('en-US', { timeZone: MANILA, month: 'short', day: 'numeric' });

/** "2026-10-06" for an instant, as the calendar date in Manila */
export const manilaDateKey = (d: Date): string => dateFmt.format(d);
/** 0-23, the hour in Manila */
export const manilaHour = (d: Date): number => Number(hourFmt.format(d)) % 24;

const round1 = (n: number): number => Math.round(n * 10) / 10;
const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);

// ---------------------------------------------------------------------------------------------------------------------------------
// Booking trend: bookings per day for the last N days
// ---------------------------------------------------------------------------------------------------------------------------------
export interface TrendPoint {
  date: string;
  label: string;
  total: number;
  completed: number;
  cancelled: number;
}

export function bookingTrend(bookings: BookingLike[], days: number = BOOKING_TREND_DAYS, now: Date = new Date()): TrendPoint[] {
  const points: TrendPoint[] = [];
  const index = new Map<string, TrendPoint>();
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now.getTime() - i * 86_400_000);
    const p: TrendPoint = { date: manilaDateKey(day), label: labelFmt.format(day), total: 0, completed: 0, cancelled: 0 };
    points.push(p);
    index.set(p.date, p);
  }
  for (const b of bookings) {
    if (!b.created_at) continue;
    const p = index.get(manilaDateKey(new Date(b.created_at)));
    if (!p) continue;
    p.total += 1;
    if (isCompletedBooking(b)) p.completed += 1;
    else if (isCancelledBooking(b)) p.cancelled += 1;
  }
  return points;
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

/** completed / (completed + cancelled), in percent, or null when nothing has finished yet */
export function completionRateOfFinished(completed: number, cancelled: number): number | null {
  const finished = completed + cancelled;
  return finished > 0 ? Math.round((completed / finished) * 100) : null;
}
