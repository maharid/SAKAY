// More descriptive analytics for the LGU Administrator (packages/shared/src/utils/transportInsights.ts and reportExport.ts): the filters, period comparison,
// demand by weekday, peak hours by group, weekday against weekend, registration trends, passenger and driver utilization, the cancellation and incident summaries.
//   run:  cd server && npx tsx --test test/*.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  averageCompleted,
  cancellationSummary,
  classifyDriverActivity,
  compareLatestPeriods,
  countShares,
  demandByWeekday,
  describeFilter,
  filterBookings,
  filterIncidents,
  filterProblem,
  hotspotsByDayType,
  incidentSummary,
  inDateRange,
  isFiltered,
  NO_ANALYTICS_FILTER,
  passengerUtilization,
  peakHoursByGroup,
  periodChanges,
  periodsForFilter,
  readableReason,
  registrationTrend,
  type AnalyticsFilter,
} from '../../packages/shared/src/utils/transportInsights';
import { dropoffHotspots, volumeByPeriod, BARANGAY_NOT_IDENTIFIED, barangayOfAddress, type BookingLike } from '../../packages/shared/src/utils/transportAnalytics';
import { reportXlsxName, exportReportXlsx, type ReportTable } from '../../packages/shared/src/utils/reportExport';
import { CALAPAN_BARANGAYS } from '../../packages/shared/src/config/calapanBarangays';
import { reportTableFor } from '../../apps/lgu-portal/src/utils/reportTables';
import type { OperationalReportsData } from '../../apps/lgu-portal/src/services/operationalReportsService';

// "Now" is Tuesday 2026-10-06 12:00 in Manila (04:00 UTC).
const NOW = new Date('2026-10-06T04:00:00Z');
const at = (iso: string, extra: Partial<BookingLike> = {}): BookingLike => ({ created_at: iso, booking_status: 'Completed', ...extra });
const filter = (patch: Partial<AnalyticsFilter>): AnalyticsFilter => ({ ...NO_ANALYTICS_FILTER, ...patch });

describe('the filter', () => {
  it('knows when nothing is filtered, and rejects a start date after the end date', () => {
    assert.equal(isFiltered(NO_ANALYTICS_FILTER), false);
    assert.equal(isFiltered(filter({ todaId: 'x' })), true);
    assert.equal(filterProblem(filter({ from: '2026-10-05', to: '2026-10-01' })), 'The start date is after the end date.');
    assert.equal(filterProblem(filter({ from: '2026-10-01', to: '2026-10-05' })), null);
    assert.equal(filterProblem(filter({ from: '2026-10-01' })), null);
  });

  it('reads the date range in Manila, both ends included', () => {
    // 2026-10-05T17:00Z is 01:00 on Oct 6 in Manila
    assert.equal(inDateRange('2026-10-05T17:00:00Z', '2026-10-06', '2026-10-06'), true);
    assert.equal(inDateRange('2026-10-05T17:00:00Z', '', '2026-10-05'), false);
    assert.equal(inDateRange('2026-10-06T15:59:00Z', '2026-10-06', '2026-10-06'), true); // 23:59 in Manila
    assert.equal(inDateRange('2026-10-06T16:00:00Z', '2026-10-06', '2026-10-06'), false); // midnight: Oct 7
    assert.equal(inDateRange(null, '2026-10-01', ''), false);
    assert.equal(inDateRange(null, '', ''), true);
  });

  it('filters bookings by date, by TODA (the booking, else its driver) and by the barangay in the pickup address', () => {
    const rows = [
      at('2026-10-01T02:00:00Z', { toda_id: 'T1', pickup_address: 'Ilaya, Calapan' }),
      at('2026-10-03T02:00:00Z', { toda_id: null, pickup_address: 'Lumangbayan' }),
      at('2026-10-05T02:00:00Z', { toda_id: 'T2', pickup_address: 'Somewhere unlisted' }),
    ] as Array<BookingLike & { driver?: { toda_id: string } | null }>;
    rows[1].driver = { toda_id: 'T1' };
    assert.equal(filterBookings(rows, NO_ANALYTICS_FILTER).length, 3);
    assert.equal(filterBookings(rows, filter({ from: '2026-10-02' })).length, 2);
    assert.equal(filterBookings(rows, filter({ todaId: 'T1' })).length, 2);
    assert.equal(filterBookings(rows, filter({ todaId: 'T2' })).length, 1);
    const ilaya = barangayOfAddress('Ilaya, Calapan');
    assert.ok(ilaya, 'Ilaya is a Calapan barangay in the list');
    assert.equal(filterBookings(rows, filter({ barangay: ilaya as string })).length, 1);
    assert.equal(filterBookings(rows, filter({ barangay: BARANGAY_NOT_IDENTIFIED })).length, 1);
    assert.equal(filterBookings(rows, filter({ todaId: 'T1', from: '2026-10-02' })).length, 1);
  });

  it('describes the filter in words', () => {
    assert.equal(describeFilter(NO_ANALYTICS_FILTER), 'All dates');
    assert.equal(describeFilter(filter({ from: '2026-10-01', to: '2026-10-15', todaId: 'T1', barangay: 'Ilaya' }), () => 'Ilaya TODA'), 'Oct 1, 2026 to Oct 15, 2026 / TODA: Ilaya TODA / Barangay: Ilaya');
    assert.equal(describeFilter(filter({ from: '2026-10-01' })), 'From Oct 1, 2026');
    assert.equal(describeFilter(filter({ to: '2026-10-01' })), 'Until Oct 1, 2026');
  });

  it('lists the periods that cover a chosen range, at most the cap', () => {
    assert.deepEqual(periodsForFilter('day', NO_ANALYTICS_FILTER, NOW).count, 14);
    assert.equal(periodsForFilter('day', filter({ from: '2026-10-01', to: '2026-10-05' }), NOW).count, 5);
    assert.equal(periodsForFilter('week', filter({ from: '2026-09-15', to: '2026-10-06' }), NOW).count, 4); // weeks of Sep 14, 21, 28, Oct 5
    assert.equal(periodsForFilter('month', filter({ from: '2026-07-20', to: '2026-10-06' }), NOW).count, 4);
    assert.equal(periodsForFilter('day', filter({ from: '2020-01-01', to: '2026-10-06' }), NOW).count, 62);
    // the list ends on the chosen last day, not today
    const { end } = periodsForFilter('day', filter({ from: '2026-09-01', to: '2026-09-10' }), NOW);
    assert.equal(volumeByPeriod([], 'day', 10, end)[9].key, '2026-09-10');
  });
});

describe('period against period', () => {
  const rows = (totals: number[]) => totals.map((t, i) => ({ key: `2026-09-${String(20 + i).padStart(2, '0')}`, label: `L${i}`, total: t, completed: 0, cancelled: 0, noDriverFound: 0, sharedTrips: 0, grossFare: 0, averageFare: 0, completionRate: 0 }));

  it('gives the change from the period before, and no percentage when that period was empty', () => {
    const c = periodChanges(rows([0, 4, 6, 3]));
    assert.deepEqual(c.map((x) => x.change), [null, 4, 2, -3]);
    assert.deepEqual(c.map((x) => x.changePct), [null, null, 50, -50]);
  });

  it('compares the last two complete periods and keeps the one in progress apart', () => {
    const days = volumeByPeriod(
      [at('2026-10-02T02:00:00Z'), at('2026-10-02T03:00:00Z'), at('2026-10-02T04:00:00Z'), at('2026-10-03T02:00:00Z'), at('2026-10-03T03:00:00Z'), at('2026-10-06T01:00:00Z')],
      'day',
      5,
      NOW
    );
    const cmp = compareLatestPeriods(days, 'day', NOW);
    assert.ok(cmp);
    assert.equal(cmp.current.key, '2026-10-05');
    assert.equal(cmp.previous.key, '2026-10-04');
    assert.equal(cmp.inProgress?.key, '2026-10-06');
    assert.equal(cmp.inProgress?.total, 1);
    // two quiet complete days against each other are flat
    const g = compareLatestPeriods(volumeByPeriod([at('2026-10-02T02:00:00Z')], 'day', 5, NOW), 'day', NOW);
    assert.equal(g?.direction, 'flat');
  });

  it('reports growth and decline between two complete weeks', () => {
    const bookings = [
      at('2026-09-22T02:00:00Z'), // Tue of the week of Sep 21
      at('2026-09-29T02:00:00Z'), at('2026-09-30T02:00:00Z'), at('2026-10-01T02:00:00Z'), // week of Sep 28: 3
    ];
    const weeks = volumeByPeriod(bookings, 'week', 4, NOW);
    const cmp = compareLatestPeriods(weeks, 'week', NOW);
    assert.equal(cmp?.current.key, '2026-09-28');
    assert.equal(cmp?.previous.key, '2026-09-21');
    assert.equal(cmp?.change, 2);
    assert.equal(cmp?.changePct, 200);
    assert.equal(cmp?.direction, 'growth');
    assert.equal(cmp?.inProgress?.key, '2026-10-05');
  });

  it('has nothing to compare with fewer than two complete periods', () => {
    assert.equal(compareLatestPeriods(volumeByPeriod([], 'day', 1, NOW), 'day', NOW), null);
  });
});

describe('demand by day of the week', () => {
  it('counts each weekday in Manila time, Monday first, with the average per such day', () => {
    // Mon Oct 5 and Mon Sep 28 (one each), Tue Oct 6: three bookings. Span Sep 28 .. Oct 6 holds two Mondays, two Tuesdays.
    const rows = demandByWeekday([
      at('2026-09-28T02:00:00Z'),
      at('2026-10-05T02:00:00Z', { booking_status: 'Cancelled' }),
      at('2026-10-06T02:00:00Z'),
    ]);
    assert.equal(rows[0].day, 'Monday');
    assert.equal(rows[0].total, 2);
    assert.equal(rows[0].completed, 1);
    assert.equal(rows[0].occurrences, 2);
    assert.equal(rows[0].averagePerDay, 1);
    assert.equal(rows[1].total, 1);
    assert.equal(rows[1].averagePerDay, 0.5);
    assert.equal(rows[2].total, 0);
    assert.equal(rows[2].occurrences, 1);
    assert.equal(rows.reduce((a, r) => a + r.share, 0) >= 99, true);
  });

  it('uses the Manila date: 23:30 UTC on a Sunday is already Monday in Manila', () => {
    const rows = demandByWeekday([at('2026-10-04T23:30:00Z')]); // Sun 23:30Z = Mon 07:30 Manila
    assert.equal(rows[0].total, 1);
    assert.equal(rows[6].total, 0);
  });

  it('is empty without bookings', () => {
    const rows = demandByWeekday([]);
    assert.equal(rows.length, 7);
    assert.ok(rows.every((r) => r.total === 0 && r.averagePerDay === null));
  });
});

describe('peak hours by TODA or barangay', () => {
  it('finds each group\'s busiest hour and its quietest core hour, and sorts by volume', () => {
    const rows = peakHoursByGroup(
      [
        at('2026-10-05T00:10:00Z', { toda_id: 'A' }), // 08:10 Manila
        at('2026-10-05T00:40:00Z', { toda_id: 'A' }),
        at('2026-10-05T09:00:00Z', { toda_id: 'A' }), // 17:00
        at('2026-10-05T09:30:00Z', { toda_id: 'B' }),
        at('2026-10-05T02:00:00Z', { toda_id: null }),
      ],
      (b) => b.toda_id ?? null
    );
    assert.equal(rows[0].group, 'A');
    assert.equal(rows[0].total, 3);
    assert.equal(rows[0].peakHour, '8:00 AM');
    assert.equal(rows[0].peakCount, 2);
    assert.equal(rows[0].quietHour, '6:00 AM'); // the first core hour with the lowest count (0)
    assert.equal(rows[0].hours.length, 24);
    assert.equal(rows.find((r) => r.group === 'Not identified')?.total, 1);
    assert.equal(rows.length, 3);
  });

  it('is empty without bookings', () => {
    assert.deepEqual(peakHoursByGroup([], () => 'x'), []);
  });
});

describe('weekday against weekend', () => {
  it('splits the bookings by Manila weekday / weekend and divides by the number of such days', () => {
    // Sat Oct 3, Sun Oct 4 (2 weekend days) and Mon Oct 5 (1 weekday): the bookings span Oct 3 .. Oct 5
    const rows = [
      at('2026-10-03T02:00:00Z', { pickup_latitude: 13.41, pickup_longitude: 121.18, pickup_address: 'Ilaya, Calapan', dropoff_latitude: 13.42, dropoff_longitude: 121.19, dropoff_address: 'Public Market' }),
      at('2026-10-04T02:00:00Z', { pickup_latitude: 13.41, pickup_longitude: 121.18, pickup_address: 'Ilaya, Calapan', dropoff_latitude: 13.42, dropoff_longitude: 121.19, dropoff_address: 'Public Market' }),
      at('2026-10-05T02:00:00Z', { pickup_latitude: 13.5, pickup_longitude: 121.1, pickup_address: 'Lumangbayan', dropoff_latitude: 13.41, dropoff_longitude: 121.18, dropoff_address: 'Ilaya' }),
    ];
    const r = hotspotsByDayType(rows);
    assert.equal(r.weekend.days, 2);
    assert.equal(r.weekday.days, 1);
    assert.equal(r.weekend.bookings, 2);
    assert.equal(r.weekend.perDay, 1);
    assert.equal(r.weekday.bookings, 1);
    assert.equal(r.weekday.perDay, 1);
    assert.equal(r.weekend.pickups[0].count, 2);
    assert.equal(r.weekend.dropoffs[0].label, 'Public Market');
    assert.equal(r.weekday.pickups[0].label, 'Lumangbayan');
  });

  it('uses the chosen range for the number of days, even when no booking falls on some of them', () => {
    const r = hotspotsByDayType([at('2026-10-05T02:00:00Z')], '2026-10-01', '2026-10-14');
    assert.equal(r.weekday.days, 10);
    assert.equal(r.weekend.days, 4);
  });

  it('maps drop-offs like pickups, and skips bookings without coordinates', () => {
    const d = dropoffHotspots([
      at('2026-10-05T02:00:00Z', { dropoff_latitude: 13.41, dropoff_longitude: 121.18, dropoff_address: 'Terminal' }),
      at('2026-10-05T03:00:00Z', { dropoff_latitude: 13.411, dropoff_longitude: 121.181, dropoff_address: 'Terminal' }),
      at('2026-10-05T04:00:00Z', { dropoff_latitude: null, dropoff_longitude: null }),
      at('2026-10-05T05:00:00Z', { dropoff_latitude: 0, dropoff_longitude: 0 }),
    ]);
    assert.equal(d.length, 1);
    assert.equal(d[0].count, 2);
    assert.equal(d[0].share, 100);
    assert.equal(d[0].label, 'Terminal');
  });
});

describe('registration and accreditation trends', () => {
  it('counts the accounts of each period and keeps a running total that includes the earlier ones', () => {
    const t = registrationTrend(
      ['2026-07-01T00:00:00Z', '2026-09-30T02:00:00Z', '2026-10-01T02:00:00Z', '2026-10-05T02:00:00Z', null, undefined, 'not a date'],
      'week',
      2,
      NOW
    );
    assert.equal(t.length, 2);
    assert.equal(t[0].key, '2026-09-28');
    assert.equal(t[0].count, 2); // Sep 30, Oct 1
    assert.equal(t[1].key, '2026-10-05');
    assert.equal(t[1].count, 1);
    assert.equal(t[0].cumulative, 3); // July 1 + the two
    assert.equal(t[1].cumulative, 4);
  });

  it('works by day and by month', () => {
    assert.equal(registrationTrend(['2026-10-06T02:00:00Z'], 'day', 3, NOW)[2].count, 1);
    const m = registrationTrend(['2026-08-10T02:00:00Z', '2026-10-02T02:00:00Z'], 'month', 3, NOW);
    assert.deepEqual(m.map((x) => x.count), [1, 0, 1]);
    assert.deepEqual(m.map((x) => x.cumulative), [1, 1, 2]);
  });
});

describe('passenger and driver utilization', () => {
  it('averages bookings per passenger who booked and per registered passenger', () => {
    const u = passengerUtilization(10, [
      at('2026-10-01T02:00:00Z', { passenger_id: 'p1' }),
      at('2026-10-02T02:00:00Z', { passenger_id: 'p1', booking_status: 'Cancelled' }),
      at('2026-10-03T02:00:00Z', { passenger_id: 'p2' }),
      at('2026-10-04T02:00:00Z', { passenger_id: null }),
    ]);
    assert.equal(u.bookedAtLeastOnce, 2);
    assert.equal(u.bookings, 4);
    assert.equal(u.completedTrips, 3);
    assert.equal(u.averageBookingsPerBooker, 2);
    assert.equal(u.averageCompletedPerBooker, 1.5);
    assert.equal(u.averageBookingsPerRegistered, 0.4);
    assert.equal(u.repeatBookers, 1);
  });

  it('gives no averages when there is nobody to divide by', () => {
    const u = passengerUtilization(null, []);
    assert.equal(u.averageBookingsPerBooker, null);
    assert.equal(u.averageBookingsPerRegistered, null);
    assert.equal(passengerUtilization(0, []).averageBookingsPerRegistered, null);
  });

  it('classifies a driver against the average completed trips', () => {
    const avg = averageCompleted([10, 2, 0, 4]); // 4
    assert.equal(avg, 4);
    assert.equal(classifyDriverActivity(10, avg), 'High demand'); // >= 6
    assert.equal(classifyDriverActivity(6, avg), 'High demand');
    assert.equal(classifyDriverActivity(4, avg), 'Normal');
    assert.equal(classifyDriverActivity(2, avg), 'Normal'); // exactly half is not below half
    assert.equal(classifyDriverActivity(1, avg), 'Low activity');
    assert.equal(classifyDriverActivity(0, avg), 'Low activity');
    assert.equal(classifyDriverActivity(0, 0), 'Low activity');
    assert.equal(classifyDriverActivity(3, null), 'Low activity');
    assert.equal(averageCompleted([]), null);
  });
});

describe('cancellation summary', () => {
  it('splits the cancellations by who cancelled, why, and whether a driver had accepted', () => {
    const s = cancellationSummary([
      at('2026-10-01T02:00:00Z'),
      at('2026-10-01T03:00:00Z', { booking_status: 'Cancelled', cancelled_by: 'passenger', cancellation_reason: 'Changed my mind' }),
      at('2026-10-01T04:00:00Z', { booking_status: 'Cancelled', cancelled_by: 'passenger', cancellation_reason: 'changed my mind', accepted_at: '2026-10-01T04:01:00Z' }),
      at('2026-10-01T05:00:00Z', { booking_status: 'Cancelled', cancelled_by: 'driver', cancellation_reason: 'PASSENGER_NO_SHOW', accepted_at: '2026-10-01T05:01:00Z' }),
      at('2026-10-01T06:00:00Z', { booking_status: 'Cancelled', cancelled_by: null, cancellation_reason: null }),
      at('2026-10-01T07:00:00Z', { booking_status: 'No Driver Found' }),
    ]);
    assert.equal(s.requests, 6);
    assert.equal(s.cancelled, 4);
    assert.equal(s.rate, 67);
    assert.equal(s.afterDriverAccepted, 2);
    assert.equal(s.beforeDriverAccepted, 2);
    assert.equal(s.noDriverFound, 1);
    assert.deepEqual(s.byActor.map((a) => [a.label, a.count]), [['Passenger', 2], ['Driver', 1], ['Not recorded', 1]]);
    assert.equal(s.byReason[0].label, 'Changed my mind');
    assert.equal(s.byReason[0].count, 2);
    assert.ok(s.byReason.some((r) => r.label === 'Passenger no show'));
    assert.ok(s.byReason.some((r) => r.label === 'No reason given'));
  });

  it('is zero without bookings', () => {
    const s = cancellationSummary([]);
    assert.equal(s.cancelled, 0);
    assert.equal(s.rate, 0);
    assert.deepEqual(s.byActor, []);
  });

  it('makes reason codes readable, keeps free text, and groups the long tail', () => {
    assert.equal(readableReason('PASSENGER_NO_SHOW'), 'Passenger no show');
    assert.equal(readableReason('  Waited too long '), 'Waited too long');
    assert.equal(readableReason(''), 'No reason given');
    assert.equal(readableReason('x'.repeat(100)).length, 80);
    const many = countShares(Array.from({ length: 12 }, (_, i) => `reason ${i}`), 3, 'Other reasons');
    assert.equal(many.length, 4);
    assert.equal(many[3].label, 'Other reasons');
    assert.equal(many[3].count, 9);
  });
});

describe('incident summary', () => {
  const incidents = [
    { category: 'Physical Assault', status: 'Under Investigation', priority: 'Serious', routing: 'LGU', outcome: null, created_at: '2026-10-01T02:00:00Z', reported_toda_id: 'T1', booking: { pickup_address: 'Ilaya, Calapan' } },
    { category: 'Overcharging', status: 'Resolved', priority: 'Standard', routing: 'TODA', outcome: 'UPHELD', created_at: '2026-10-02T02:00:00Z', reported_toda_id: 'T1', booking: { pickup_address: 'Elsewhere' } },
    { category: 'Overcharging', status: 'Dismissed', priority: 'Standard', routing: 'TODA', outcome: 'NOT_UPHELD', created_at: '2026-10-03T02:00:00Z', reported_toda_id: 'T2', booking: null },
    { category: 'Lost Item', status: 'Cancelled', priority: 'Standard', routing: 'TODA', outcome: null, created_at: '2026-10-04T02:00:00Z', reported_toda_id: 'T2', booking: null },
  ];

  it('counts open, decided and withdrawn reports and groups them by category and outcome', () => {
    const s = incidentSummary(incidents);
    assert.equal(s.total, 4);
    assert.equal(s.open, 1);
    assert.equal(s.decided, 2);
    assert.equal(s.withdrawn, 1);
    assert.equal(s.withLgu, 1);
    assert.equal(s.withToda, 3);
    assert.equal(s.serious, 1);
    assert.deepEqual(s.byCategory[0], { label: 'Overcharging', count: 2, share: 50 });
    assert.equal(s.byOutcome.length, 2);
  });

  it('filters by date, TODA and the barangay of the trip', () => {
    assert.equal(filterIncidents(incidents, NO_ANALYTICS_FILTER).length, 4);
    assert.equal(filterIncidents(incidents, filter({ from: '2026-10-02', to: '2026-10-03' })).length, 2);
    assert.equal(filterIncidents(incidents, filter({ todaId: 'T2' })).length, 2);
    assert.equal(filterIncidents(incidents, filter({ barangay: barangayOfAddress('Ilaya, Calapan') as string })).length, 1);
    assert.equal(filterIncidents(incidents, filter({ barangay: BARANGAY_NOT_IDENTIFIED })).length, 3);
  });

  it('is empty without reports', () => {
    const s = incidentSummary([]);
    assert.equal(s.total, 0);
    assert.equal(s.open, 0);
  });
});

describe('report export', () => {
  const table: ReportTable = { title: 'Booking Trend Report (Weekly)', notes: ['All dates'], headers: ['Week', 'Bookings'], rows: [['Sep 28 - Oct 4', 3], ['Oct 5 - Oct 11', null]] };

  it('names the workbook like the CSV, with .xlsx', () => {
    assert.equal(reportXlsxName(table.title, new Date('2026-10-06T00:00:00Z')), 'booking_trend_report_weekly_2026-10-06.xlsx');
  });

  it('writes the title, the notes, a blank row, the headers and the rows into one sheet', () => {
    const written: { aoa?: unknown[][]; sheet?: string; file?: string } = {};
    exportReportXlsx(
      {
        utils: {
          aoa_to_sheet: (d) => { written.aoa = d; return {}; },
          book_new: () => ({}),
          book_append_sheet: (_b, _s, name) => { written.sheet = name; },
        },
        writeFile: (_b, name) => { written.file = name; },
      },
      table,
      new Date('2026-10-06T00:00:00Z')
    );
    assert.deepEqual(written.aoa, [['Booking Trend Report (Weekly)'], ['All dates'], [], ['Week', 'Bookings'], ['Sep 28 - Oct 4', 3], ['Oct 5 - Oct 11', '']]);
    assert.equal(written.sheet, 'Booking Trend Report (Weekly)');
    assert.equal(written.file, 'booking_trend_report_weekly_2026-10-06.xlsx');
  });

  it('keeps the sheet name within what Excel accepts', () => {
    let name = '';
    exportReportXlsx(
      { utils: { aoa_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet: (_b, _s, n) => { name = n; } }, writeFile: () => undefined },
      { ...table, title: 'A very long report title: with [illegal] / characters * in it' }
    );
    assert.ok(name.length <= 31);
    assert.ok(!/[\\/?*[\]:]/.test(name));
  });

  it('has a barangay list to filter by', () => {
    assert.ok(CALAPAN_BARANGAYS.length > 10);
  });
});

describe('the report tables of the LGU Reports page', () => {
  const row = (label: string, total: number, extra = {}) => ({ key: label, label, total, completed: total, cancelled: 0, noDriverFound: 0, sharedTrips: 0, grossFare: total * 50, averageFare: 50, completionRate: 100, ...extra });
  const data = {
    filterText: 'All dates',
    summary: { totalBookings: 4, completedTrips: 3, cancelledTrips: 1, totalRevenue: 150, averageFare: 50, activeDrivers: 2, accreditedTodas: 1 },
    serviceUtilization: { requests: 4, completed: 3, cancelled: 1, noDriverFound: 0, inProgress: 0, completionRate: 75, cancellationRate: 25, noDriverRate: 0, soloTrips: 4, sharedTrips: 0, grossFare: 150, averageFare: 50 },
    volume: { day: [row('Oct 5', 2), row('Oct 6', 0)], week: [row('Sep 28 - Oct 4', 2), row('Oct 5 - Oct 11', 5)], month: [] },
    driverAverage: 2,
    driverUtilization: [
      { driverName: 'A', toda: 'T1', completedTrips: 3, rating: 4.5, status: 'Verified', activity: 'High demand' },
      { driverName: 'B', toda: 'T1', completedTrips: 0, rating: null, status: 'Pending', activity: null },
    ],
    peakHourDistribution: [{ hour: '8:00 AM', count: 2 }, { hour: '12:00 PM', count: 1 }, { hour: '5:00 PM', count: 1 }],
    peakHoursByToda: [{ group: 'T1', total: 4, hours: Object.assign(new Array(24).fill(0), { 8: 2, 12: 1, 17: 1 }), peakHour: '8:00 AM', peakCount: 2, quietHour: '6:00 AM', quietCount: 0 }],
    hotspots: [{ lat: 13.41, lng: 121.18, count: 3, share: 100, label: 'Ilaya' }],
    dropoffHotspots: [{ lat: 13.42, lng: 121.19, count: 2, share: 100, label: 'Market' }],
    dayTypes: { weekday: { pickups: [{ lat: 13.41, lng: 121.18, count: 2, share: 100, label: 'Ilaya' }], dropoffs: [] }, weekend: { pickups: [], dropoffs: [] } },
    cancellations: { requests: 4, cancelled: 1, rate: 25, beforeDriverAccepted: 1, afterDriverAccepted: 0, noDriverFound: 0, byActor: [{ label: 'Passenger', count: 1, share: 100 }], byReason: [{ label: 'Changed my mind', count: 1, share: 100 }] },
    incidents: { total: 2, open: 1, decided: 1, withdrawn: 0, withLgu: 1, withToda: 1, serious: 1, byCategory: [{ label: 'Overcharging', count: 2, share: 100 }], byStatus: [], byOutcome: [{ label: 'Upheld', count: 1, share: 100 }] },
    barangayDemand: [{ barangay: 'Ilaya', count: 4, percentage: 100 }],
    todaPerformance: [{ todaName: 'T1', totalTrips: 3, activeUnits: 5, verifiedDrivers: 2, averagePerDriver: 1.5, completionRate: 75 }],
    driverUtilizationSummary: { verifiedDrivers: 2, activeDrivers: 1, rate: 50, windowDays: 30 },
  } as unknown as OperationalReportsData;

  it('puts the filter and the pilot scope on every report', () => {
    for (const kind of ['Bookings', 'Trend', 'Drivers', 'TODA', 'PeakHours', 'Hotspots', 'Barangay', 'Service', 'Cancellations', 'Incidents'] as const) {
      const t = reportTableFor(kind, data, 'week');
      assert.ok(t.notes.includes('Filter: All dates'), kind);
      assert.ok(t.notes.some((n) => /one TODA in one barangay/.test(n)), kind);
      assert.ok(t.rows.every((r) => r.length === t.headers.length), `${kind}: every row has a cell for every header`);
    }
  });

  it('lists the booking trend with the change from the period before', () => {
    const t = reportTableFor('Trend', data, 'week');
    assert.equal(t.title, 'Booking Trend Report (Weekly)');
    assert.deepEqual(t.rows[0].slice(0, 4), ['Sep 28 - Oct 4', 2, '', '']);
    assert.deepEqual(t.rows[1].slice(0, 4), ['Oct 5 - Oct 11', 5, '+3', '+150%']);
    const d = reportTableFor('Trend', data, 'day');
    assert.equal(d.rows[1][3], '-100%');
  });

  it('shows the activity level of verified drivers only', () => {
    const t = reportTableFor('Drivers', data, 'week');
    assert.equal(t.rows[0][5], 'High demand');
    assert.equal(t.rows[1][5], 'Not verified');
    assert.equal(t.rows[1][3], 'Not yet rated');
  });

  it('gives the peak-hour report a column for each TODA with the right hour of the day', () => {
    const t = reportTableFor('PeakHours', data, 'week');
    assert.deepEqual(t.headers, ['Hour', 'All bookings', 'T1']);
    assert.deepEqual(t.rows.map((r) => r[2]), [2, 1, 1]); // 8 AM, 12 PM (hour 12), 5 PM (hour 17)
  });

  it('lists the hotspots of all days, weekdays and weekends with their coordinates', () => {
    const t = reportTableFor('Hotspots', data, 'week');
    assert.deepEqual(t.rows[0], ['Pickup', 'All days', 'Ilaya', 3, '100%', '13.41000', '121.18000']);
    assert.ok(t.rows.some((r) => r[0] === 'Drop-off' && r[1] === 'All days'));
    assert.ok(t.rows.some((r) => r[0] === 'Pickup' && r[1] === 'Weekdays'));
    assert.ok(!t.rows.some((r) => r[1] === 'Weekends'));
  });

  it('summarises the cancellations and the incidents in sections', () => {
    const c = reportTableFor('Cancellations', data, 'week');
    assert.deepEqual(c.rows[1], ['Summary', 'Cancelled', 1, '25%']);
    assert.deepEqual(c.rows[2], ['Summary', 'Cancelled before a driver accepted', 1, '100%']);
    assert.ok(c.rows.some((r) => r[0] === 'Cancelled by' && r[1] === 'Passenger'));
    assert.ok(c.rows.some((r) => r[0] === 'Reason' && r[1] === 'Changed my mind'));
    const i = reportTableFor('Incidents', data, 'week');
    assert.deepEqual(i.rows[0], ['Summary', 'Reports filed', 2, '']);
    assert.ok(i.rows.some((r) => r[0] === 'Decision' && r[1] === 'Upheld'));
  });

  it('reports the estimated gross fare value of the completed trips', () => {
    const t = reportTableFor('Bookings', data, 'week');
    assert.deepEqual(t.rows[3], ['Estimated gross fare value (PHP)', '150.00', 'Sum of the final fares of the completed trips (cash)']);
  });
});
