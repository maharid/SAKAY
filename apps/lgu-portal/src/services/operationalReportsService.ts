import {
  BARANGAY_NOT_IDENTIFIED,
  CALAPAN_BARANGAYS,
  NO_ANALYTICS_FILTER,
  averageCompleted,
  barangayDemand,
  barangayOfAddress,
  bookingTodaId,
  cancellationSummary,
  classifyDriverActivity,
  compareLatestPeriods,
  completionRateOfFinished,
  demandByWeekday,
  describeFilter,
  dropoffHotspots,
  driverUtilizationSummary,
  filterBookings,
  filterIncidents,
  hotspotsByDayType,
  inDateRange,
  incidentSummary,
  isCancelledBooking,
  isCompletedBooking,
  passengerUtilization,
  peakHourDistribution,
  peakHoursByGroup,
  periodsForFilter,
  pickupHotspots,
  registrationTrend,
  serviceUtilization,
  volumeByPeriod,
} from '@sakay/shared';
import type {
  AnalyticsFilter,
  BarangayDemandRow,
  BookingLike,
  CancellationSummary,
  DayTypeSide,
  DriverActivityLevel,
  DriverUtilizationSummary,
  GroupPeakRow,
  Hotspot,
  IncidentLike,
  IncidentSummary,
  PassengerUtilization,
  PeakHourPoint,
  PeriodComparison,
  RegistrationPoint,
  ServiceUtilization,
  TrendPoint,
  VolumePeriod,
  VolumeRow,
} from '@sakay/shared';

import { supabase } from './supabaseClient';

/**
 * Transportation analytics and reports for the LGU Administrator (checklist A9).
 *
 * The rows are read ONCE (fetchOperationalSource); every filter change only re-runs buildOperationalReports over them, so a date range, a TODA or a barangay is
 * applied without another round trip. Every figure is computed by the shared analytics utilities from SAKAY records: nothing here is a written-in value.
 */

export type BookingRow = BookingLike & {
  booking_id?: string;
  driver?: { full_name?: string | null; toda_id?: string | null; toda?: { toda_name?: string | null } | null } | null;
};

export interface DriverRow {
  driver_id: string;
  full_name: string;
  account_status: string;
  toda_id: string | null;
  created_at: string | null;
  weighted_average_rating: number | string | null;
  toda?: { toda_name?: string | null } | null;
}

export interface TodaRow {
  toda_id: string;
  toda_name: string;
  toda_status?: string | null;
  account_status?: string | null;
  active_driver_count?: number | null;
  registered_tricycle_count?: number | null;
}

export type IncidentRow = IncidentLike & { incident_id?: string };

export interface OperationalSource {
  bookings: BookingRow[];
  drivers: DriverRow[];
  todas: TodaRow[];
  /** created_at of every passenger who finished registering (the OTP step) */
  passengerRegistrations: string[];
  /** driver_id -> when the LGU Administrator accredited the driver (the earliest approval on record) */
  driverAccreditedAt: Map<string, string>;
  incidents: IncidentRow[];
}

const rowsOf = <T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] => {
  if (res.error) console.error(`[operationalReportsService] ${what}:`, res.error.message);
  return (res.data as T[] | null) ?? [];
};

export async function fetchOperationalSource(): Promise<OperationalSource> {
  const [bookingsRes, driversRes, todasRes, passengersRes, affiliationsRes, verificationsRes, incidentsRes] = await Promise.all([
    supabase.from('booking').select('*, driver:driver_id(full_name, toda_id, toda:toda_id(toda_name))'),
    supabase.from('driver').select('driver_id, full_name, account_status, toda_id, created_at, weighted_average_rating, toda:toda_id(toda_name)'),
    supabase.from('toda').select('*'),
    supabase.from('passenger').select('created_at, account_status'),
    supabase.from('driver_toda_affiliation').select('driver_id, lgu_verification_status, lgu_verified_at'),
    supabase.from('driver_verification').select('driver_id, lgu_approved_at'),
    supabase.from('incident_report').select('incident_id, category, status, priority, routing, outcome, created_at, reported_toda_id, booking:booking_id(pickup_address)'),
  ]);

  // The first approval on record for each driver, from the affiliation (the LGU decision) or, for older records, the verification record
  const accreditedAt = new Map<string, string>();
  const note = (driverId: string | null | undefined, iso: string | null | undefined) => {
    if (!driverId || !iso) return;
    const known = accreditedAt.get(driverId);
    if (!known || iso < known) accreditedAt.set(driverId, iso);
  };
  rowsOf<{ driver_id: string; lgu_verification_status: string; lgu_verified_at: string | null }>(affiliationsRes, 'affiliations').forEach((a) => {
    if (a.lgu_verification_status === 'Approved') note(a.driver_id, a.lgu_verified_at);
  });
  rowsOf<{ driver_id: string; lgu_approved_at: string | null }>(verificationsRes, 'verifications').forEach((v) => note(v.driver_id, v.lgu_approved_at));

  return {
    bookings: rowsOf<BookingRow>(bookingsRes, 'bookings'),
    drivers: rowsOf<DriverRow>(driversRes, 'drivers'),
    todas: rowsOf<TodaRow>(todasRes, 'todas'),
    passengerRegistrations: rowsOf<{ created_at: string | null; account_status: string | null }>(passengersRes, 'passengers')
      .filter((p) => !String(p.account_status ?? '').startsWith('Pending'))
      .map((p) => p.created_at ?? ''),
    driverAccreditedAt: accreditedAt,
    incidents: rowsOf<IncidentRow>(incidentsRes, 'incidents'),
  };
}

export const EMPTY_SOURCE: OperationalSource = { bookings: [], drivers: [], todas: [], passengerRegistrations: [], driverAccreditedAt: new Map(), incidents: [] };

export interface OperationalReportsData {
  summary: {
    totalBookings: number;
    completedTrips: number;
    cancelledTrips: number;
    totalRevenue: number;
    averageFare: number;
    activeDrivers: number;
    accreditedTodas: number;
  };
  filter: AnalyticsFilter;
  /** the filter in words, for the page and the top of every export */
  filterText: string;
  peakHourDistribution: PeakHourPoint[];
  barangayDemand: BarangayDemandRow[];
  /** completionRate: percent of the TODA's finished trips that were completed (null while nothing has finished) */
  todaPerformance: Array<{ todaName: string; totalTrips: number; activeUnits: number; verifiedDrivers: number; averagePerDriver: number | null; completionRate: number | null }>;
  driverUtilization: Array<{ driverName: string; toda: string; completedTrips: number; rating: number | null; status: string; activity: DriverActivityLevel | null }>;
  /** the average completed trips per verified driver in the filtered period */
  driverAverage: number | null;
  bookingTrend: TrendPoint[];
  hotspots: Hotspot[];
  dropoffHotspots: Hotspot[];
  serviceUtilization: ServiceUtilization;
  driverUtilizationSummary: DriverUtilizationSummary;
  /** booking volume by day, week and month, covering the chosen dates (or the latest periods), with the comparison of the last two complete ones */
  volume: Record<VolumePeriod, VolumeRow[]>;
  comparison: Record<VolumePeriod, PeriodComparison | null>;
  weekdayDemand: ReturnType<typeof demandByWeekday>;
  peakHoursByToda: GroupPeakRow[];
  peakHoursByBarangay: GroupPeakRow[];
  dayTypes: { weekday: DayTypeSide; weekend: DayTypeSide };
  passengerRegistrations: Record<VolumePeriod, RegistrationPoint[]>;
  driverRegistrations: Record<VolumePeriod, RegistrationPoint[]>;
  driverAccreditations: Record<VolumePeriod, RegistrationPoint[]>;
  /** verified drivers whose accreditation date is not on record (accredited before the dates were kept) */
  driversAccreditedUndated: number;
  passengerUtilization: PassengerUtilization;
  cancellations: CancellationSummary;
  incidents: IncidentSummary;
  /** the choices for the filter bar */
  todaOptions: Array<{ id: string; name: string }>;
  barangayOptions: string[];
}

export const VOLUME_PERIODS: VolumePeriod[] = ['day', 'week', 'month'];

const perPeriod = <T>(make: (p: VolumePeriod) => T): Record<VolumePeriod, T> => ({ day: make('day'), week: make('week'), month: make('month') });

export function buildOperationalReports(source: OperationalSource, filter: AnalyticsFilter = NO_ANALYTICS_FILTER, now: Date = new Date()): OperationalReportsData {
  const { todas, drivers } = source;
  const activeTodas = todas.filter((t) => (t.toda_status || t.account_status) === 'Active');
  const todaName = (id: string): string => todas.find((t) => t.toda_id === id)?.toda_name ?? 'this TODA';

  const bookings = filterBookings(source.bookings, filter);
  const incidents = filterIncidents(source.incidents, filter);
  // A TODA filter limits the drivers and TODAs shown as well; a barangay filter limits only the bookings (a driver does not belong to a barangay)
  const driversInScope = filter.todaId ? drivers.filter((d) => d.toda_id === filter.todaId) : drivers;
  const todasInScope = filter.todaId ? activeTodas.filter((t) => t.toda_id === filter.todaId) : activeTodas;
  const verifiedInScope = driversInScope.filter((d) => d.account_status === 'Verified');
  const verifiedDriverIds = verifiedInScope.map((d) => d.driver_id);

  const service = serviceUtilization(bookings);
  const completed = bookings.filter(isCompletedBooking);
  const completedPerDriver = new Map<string, number>();
  completed.forEach((b) => b.driver_id && completedPerDriver.set(b.driver_id, (completedPerDriver.get(b.driver_id) ?? 0) + 1));

  const { end: windowEnd } = periodsForFilter('day', filter, now);
  const driverAverage = averageCompleted(verifiedDriverIds.map((id) => completedPerDriver.get(id) ?? 0));

  const todaPerformance = todasInScope.map((t) => {
    const mine = bookings.filter((b) => bookingTodaId(b) === t.toda_id);
    const done = mine.filter(isCompletedBooking).length;
    const cancelled = mine.filter(isCancelledBooking).length;
    const verified = drivers.filter((d) => d.toda_id === t.toda_id && d.account_status === 'Verified').length;
    return {
      todaName: t.toda_name,
      totalTrips: done,
      activeUnits: t.active_driver_count || t.registered_tricycle_count || 0,
      verifiedDrivers: verified,
      averagePerDriver: verified > 0 ? Math.round((done / verified) * 10) / 10 : null,
      completionRate: completionRateOfFinished(done, cancelled),
    };
  });

  const driverUtilization = driversInScope.map((d) => {
    const trips = completedPerDriver.get(d.driver_id) ?? 0;
    return {
      driverName: d.full_name,
      toda: d.toda?.toda_name || 'No TODA',
      completedTrips: trips,
      // A driver with no rating yet is "Not Yet Rated" (policy 23.1), not 5.0
      rating: d.weighted_average_rating == null ? null : Number(d.weighted_average_rating),
      status: d.account_status,
      activity: d.account_status === 'Verified' ? classifyDriverActivity(trips, driverAverage) : null,
    };
  });

  // Registrations follow the date range; the drivers also follow the TODA. A passenger belongs to no TODA and no barangay, so those two filters do not apply to them.
  const dates = <T extends { iso: string | null | undefined }>(rows: T[]) => rows.filter((r) => inDateRange(r.iso, filter.from, filter.to)).map((r) => r.iso);
  const passengerDates = dates(source.passengerRegistrations.map((iso) => ({ iso })));
  const driverDates = dates(driversInScope.map((d) => ({ iso: d.created_at })));
  const accreditedDates = dates(verifiedInScope.map((d) => ({ iso: source.driverAccreditedAt.get(d.driver_id) ?? null })));
  const window = perPeriod((p) => periodsForFilter(p, filter, now));
  const registrations = (isoDates: Array<string | null | undefined>) => perPeriod((p) => registrationTrend(isoDates, p, window[p].count, window[p].end));

  const volume = perPeriod((p) => volumeByPeriod(bookings, p, window[p].count, window[p].end));
  const registeredForAverage = filter.todaId || filter.barangay ? null : source.passengerRegistrations.length;

  return {
    summary: {
      totalBookings: service.requests,
      completedTrips: service.completed,
      cancelledTrips: service.cancelled,
      totalRevenue: service.grossFare,
      averageFare: service.averageFare,
      activeDrivers: verifiedDriverIds.length,
      accreditedTodas: todasInScope.length,
    },
    filter,
    filterText: describeFilter(filter, todaName),
    peakHourDistribution: peakHourDistribution(bookings),
    barangayDemand: barangayDemand(bookings),
    todaPerformance,
    driverUtilization,
    driverAverage,
    bookingTrend: volume.day.map((r) => ({ date: r.key, label: r.label, total: r.total, completed: r.completed, cancelled: r.cancelled })),
    hotspots: pickupHotspots(bookings),
    dropoffHotspots: dropoffHotspots(bookings),
    serviceUtilization: service,
    driverUtilizationSummary: driverUtilizationSummary(verifiedDriverIds, bookings, undefined, windowEnd),
    volume,
    comparison: perPeriod((p) => compareLatestPeriods(volume[p], p, window[p].end)),
    weekdayDemand: demandByWeekday(bookings),
    peakHoursByToda: peakHoursByGroup(bookings, (b) => {
      const id = bookingTodaId(b);
      return id ? todaName(id) : 'No TODA (no driver was found)';
    }),
    peakHoursByBarangay: peakHoursByGroup(bookings, (b) => barangayOfAddress(b.pickup_address) ?? BARANGAY_NOT_IDENTIFIED),
    dayTypes: hotspotsByDayType(bookings, filter.from, filter.to),
    passengerRegistrations: registrations(passengerDates),
    driverRegistrations: registrations(driverDates),
    driverAccreditations: registrations(accreditedDates),
    driversAccreditedUndated: verifiedInScope.filter((d) => !source.driverAccreditedAt.has(d.driver_id)).length,
    passengerUtilization: passengerUtilization(registeredForAverage, bookings),
    cancellations: cancellationSummary(bookings),
    incidents: incidentSummary(incidents),
    todaOptions: activeTodas.map((t) => ({ id: t.toda_id, name: t.toda_name })).sort((a, b) => a.name.localeCompare(b.name)),
    barangayOptions: [...CALAPAN_BARANGAYS].sort((a, b) => a.localeCompare(b)).concat(BARANGAY_NOT_IDENTIFIED),
  };
}

/** Reads the records and builds the unfiltered reports (the Dashboard and other single-shot users) */
export async function fetchOperationalReports(filter: AnalyticsFilter = NO_ANALYTICS_FILTER): Promise<OperationalReportsData> {
  try {
    return buildOperationalReports(await fetchOperationalSource(), filter);
  } catch (err) {
    console.error('[operationalReportsService] fetchOperationalReports error:', err);
    return buildOperationalReports(EMPTY_SOURCE, filter);
  }
}
