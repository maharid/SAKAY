// Descriptive transportation analytics (packages/shared/src/utils/transportAnalytics.ts), used by the LGU Analytics and Reports pages.
//   run:  cd server && npx tsx --test test/*.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bookingTrend,
  barangayDemand,
  barangayOfAddress,
  completionRateOfFinished,
  driverActivity,
  driverUtilizationSummary,
  manilaDateKey,
  manilaHour,
  peakHourDistribution,
  pickupHotspots,
  serviceUtilization,
  volumeByPeriod,
  BARANGAY_NOT_IDENTIFIED,
  type BookingLike,
} from '../../packages/shared/src/utils/transportAnalytics';

// "Now" is 2026-10-06 12:00 in Manila (04:00 UTC).
const NOW = new Date('2026-10-06T04:00:00Z');
const at = (iso: string, extra: Partial<BookingLike> = {}): BookingLike => ({ created_at: iso, booking_status: 'Completed', ...extra });

describe('Manila time', () => {
  it('reads the calendar date and the hour in Manila, not in UTC', () => {
    const lateUtc = new Date('2026-10-05T20:30:00Z'); // 04:30 on Oct 6 in Manila
    assert.equal(manilaDateKey(lateUtc), '2026-10-06');
    assert.equal(manilaHour(lateUtc), 4);
    assert.equal(manilaHour(new Date('2026-10-05T16:00:00Z')), 0); // midnight in Manila is hour 0, not 24
  });
});

describe('booking trend', () => {
  it('lists the last N days oldest first and ends today', () => {
    const t = bookingTrend([], 14, NOW);
    assert.equal(t.length, 14);
    assert.equal(t[13].date, '2026-10-06');
    assert.equal(t[0].date, '2026-09-23');
  });
  it('counts total, completed and cancelled per Manila day and ignores older bookings', () => {
    const t = bookingTrend(
      [
        at('2026-10-06T01:00:00Z'),
        at('2026-10-06T02:00:00Z', { booking_status: 'Cancelled' }),
        at('2026-10-05T20:30:00Z', { booking_status: 'Searching Driver' }), // Oct 6 in Manila
        at('2026-10-05T03:00:00Z'),
        at('2026-08-01T03:00:00Z'), // outside the window
      ],
      14,
      NOW
    );
    const today = t[13];
    assert.deepEqual([today.total, today.completed, today.cancelled], [3, 1, 1]);
    assert.equal(t[12].total, 1);
    assert.equal(t.reduce((s, p) => s + p.total, 0), 4);
  });
});

describe('peak hours', () => {
  it('lists 6 AM to 9 PM and adds an outside hour only when it has bookings', () => {
    const base = peakHourDistribution([]);
    assert.equal(base.length, 16);
    assert.equal(base[0].hour, '6:00 AM');
    assert.equal(base[15].hour, '9:00 PM');
    const withNight = peakHourDistribution([at('2026-10-05T15:30:00Z')]); // 11:30 PM Manila
    assert.equal(withNight.length, 17);
    assert.equal(withNight[16].hour, '11:00 PM');
    assert.equal(withNight[16].count, 1);
  });
  it('reads the hour in Manila', () => {
    const d = peakHourDistribution([at('2026-10-06T00:15:00Z')]); // 8:15 AM Manila
    assert.equal(d.find((p) => p.hour === '8:00 AM')?.count, 1);
  });
});

describe('demand hotspots', () => {
  const near = (n: number, lat = 13.4115, lng = 121.1803, address = 'Calapan City Hall') =>
    Array.from({ length: n }, (_, i) => at('2026-10-06T01:00:00Z', { pickup_latitude: lat + i * 0.0001, pickup_longitude: lng, pickup_address: address }));
  it('groups nearby pickups into one hotspot and ranks by count', () => {
    const rows = [...near(5), ...near(2, 13.4289, 121.1925, 'Calapan Port'), ...near(1, 13.3, 121.0, 'Far away')];
    const h = pickupHotspots(rows);
    assert.equal(h.length, 3);
    assert.deepEqual(h.map((x) => x.count), [5, 2, 1]);
    assert.equal(h[0].label, 'Calapan City Hall');
    assert.equal(h[0].share, 63); // 5 of 8
  });
  it('ignores bookings without usable coordinates and never invents a hotspot', () => {
    const h = pickupHotspots([at('2026-10-06T01:00:00Z'), at('2026-10-06T01:00:00Z', { pickup_latitude: 0, pickup_longitude: 0 }), at('2026-10-06T01:00:00Z', { pickup_latitude: 'x', pickup_longitude: 'y' })]);
    assert.deepEqual(h, []);
    assert.deepEqual(pickupHotspots([]), []);
  });
  it('keeps only the top N', () => {
    const rows = Array.from({ length: 12 }, (_, i) => at('2026-10-06T01:00:00Z', { pickup_latitude: 13.0 + i * 0.1, pickup_longitude: 121.0, pickup_address: `P${i}` }));
    assert.equal(pickupHotspots(rows).length, 8);
  });
});

describe('barangay of an address', () => {
  it('finds a barangay name inside an address and prefers the longest name', () => {
    assert.equal(barangayOfAddress('Purok 3, Barangay Lumangbayan, Calapan City, Oriental Mindoro'), 'Lumangbayan');
    assert.equal(barangayOfAddress('Rizal St, San Vicente Central, Calapan'), 'San Vicente Central');
    assert.equal(barangayOfAddress('Sta. Isabel, Calapan City'), 'Sta. Isabel');
    assert.equal(barangayOfAddress('lumangbayan'), 'Lumangbayan');
  });
  it('does not match a name that is only part of a longer word, and returns null for nothing', () => {
    assert.equal(barangayOfAddress('Palhiward Extension'), null);
    assert.equal(barangayOfAddress('Sapulo Road'), null);
    assert.equal(barangayOfAddress(''), null);
    assert.equal(barangayOfAddress(null), null);
  });
  it('builds the demand table with the unidentified bucket last', () => {
    const rows = barangayDemand([
      at('2026-10-06T01:00:00Z', { pickup_address: 'Lumangbayan, Calapan' }),
      at('2026-10-06T01:00:00Z', { pickup_address: 'Lumangbayan, Calapan' }),
      at('2026-10-06T01:00:00Z', { pickup_address: 'Somewhere unnamed' }),
      at('2026-10-06T01:00:00Z', { pickup_address: 'Wawa Port' }),
    ]);
    assert.deepEqual(rows.map((r) => r.barangay), ['Lumangbayan', 'Wawa', BARANGAY_NOT_IDENTIFIED]);
    assert.deepEqual(rows.map((r) => r.count), [2, 1, 1]);
    assert.equal(rows[0].percentage, 50);
  });
});

describe('service utilization', () => {
  it('splits requests by outcome and computes the rates and fares', () => {
    const u = serviceUtilization([
      at('2026-10-06T01:00:00Z', { actual_fare: 60 }),
      at('2026-10-06T01:00:00Z', { actual_fare: 80, is_shared_trip: true }),
      at('2026-10-06T01:00:00Z', { booking_status: 'Cancelled' }),
      at('2026-10-06T01:00:00Z', { booking_status: 'No Driver Found' }),
      at('2026-10-06T01:00:00Z', { booking_status: 'Trip Ongoing' }),
    ]);
    assert.equal(u.requests, 5);
    assert.deepEqual([u.completed, u.cancelled, u.noDriverFound, u.inProgress], [2, 1, 1, 1]);
    assert.deepEqual([u.completionRate, u.cancellationRate, u.noDriverRate], [40, 20, 20]);
    assert.deepEqual([u.soloTrips, u.sharedTrips], [4, 1]);
    assert.equal(u.grossFare, 140);
    assert.equal(u.averageFare, 70);
  });
  it('uses the estimate when a final fare is not recorded, and is all zeros for no bookings', () => {
    assert.equal(serviceUtilization([at('2026-10-06T01:00:00Z', { estimated_fare: '60.00' })]).grossFare, 60);
    const z = serviceUtilization([]);
    assert.deepEqual([z.requests, z.completionRate, z.averageFare, z.grossFare], [0, 0, 0, 0]);
  });
});

describe('driver utilization', () => {
  it('counts verified drivers with a completed trip inside the window', () => {
    const rows = [
      { ...at('2026-10-01T01:00:00Z'), driver_id: 'd1' },
      { ...at('2026-10-02T01:00:00Z'), driver_id: 'd1' },
      { ...at('2026-08-01T01:00:00Z'), driver_id: 'd2' }, // too old
      { ...at('2026-10-02T01:00:00Z', { booking_status: 'Cancelled' }), driver_id: 'd3' }, // not completed
      { ...at('2026-10-02T01:00:00Z'), driver_id: 'unverified' }, // not a verified driver
    ];
    const s = driverUtilizationSummary(['d1', 'd2', 'd3', 'd4'], rows, 30, NOW);
    assert.deepEqual([s.verifiedDrivers, s.activeDrivers, s.rate], [4, 1, 25]);
    assert.equal(driverUtilizationSummary([], rows, 30, NOW).rate, 0);
  });
  it('completion rate of finished trips is null until something has finished', () => {
    assert.equal(completionRateOfFinished(0, 0), null);
    assert.equal(completionRateOfFinished(3, 1), 75);
    assert.equal(completionRateOfFinished(0, 2), 0);
  });
});

describe('volume by day, week and month', () => {
  it('weeks run Monday to Sunday in Manila and the newest week comes last', () => {
    const w = volumeByPeriod(
      [
        at('2026-10-06T01:00:00Z', { actual_fare: 60 }), // Tue Oct 6, 9 AM in Manila
        at('2026-10-04T20:00:00Z', { actual_fare: 80 }), // Mon Oct 5, 4 AM in Manila (still Sunday in UTC)
        at('2026-10-04T12:00:00Z', { booking_status: 'Cancelled' }), // Sun Oct 4, 8 PM in Manila: the week before
        at('2026-08-01T01:00:00Z'), // older than 8 weeks
      ],
      'week',
      8,
      NOW
    );
    assert.equal(w.length, 8);
    const last = w[7];
    assert.equal(last.key, '2026-10-05');
    assert.equal(last.label, 'Oct 5 - Oct 11');
    assert.deepEqual([last.total, last.completed, last.grossFare, last.averageFare], [2, 2, 140, 70]);
    assert.deepEqual([w[6].key, w[6].total, w[6].cancelled], ['2026-09-28', 1, 1]);
    assert.equal(w.reduce((n, r) => n + r.total, 0), 3);
  });
  it('months follow the Manila calendar and are labelled', () => {
    const m = volumeByPeriod([at('2026-09-30T16:30:00Z', { actual_fare: 50 }), at('2026-09-15T01:00:00Z')], 'month', 6, NOW);
    assert.deepEqual(m.map((r) => r.key), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    assert.equal(m[5].label, 'Oct 2026');
    assert.deepEqual([m[5].total, m[5].grossFare], [1, 50]); // 00:30 on Oct 1 in Manila is October
    assert.equal(m[4].total, 1);
  });
  it('months roll back across a year boundary', () => {
    const m = volumeByPeriod([], 'month', 3, new Date('2026-01-15T04:00:00Z'));
    assert.deepEqual(m.map((r) => r.key), ['2025-11', '2025-12', '2026-01']);
  });
  it('each period reports outcomes, shared trips, fares and its own completion rate', () => {
    const [day] = volumeByPeriod(
      [
        at('2026-10-06T01:00:00Z', { actual_fare: 60 }),
        at('2026-10-06T01:10:00Z', { actual_fare: 80, is_shared_trip: true }),
        at('2026-10-06T01:20:00Z', { booking_status: 'Cancelled' }),
        at('2026-10-06T01:30:00Z', { booking_status: 'No Driver Found' }),
      ],
      'day',
      1,
      NOW
    );
    assert.deepEqual([day.total, day.completed, day.cancelled, day.noDriverFound, day.sharedTrips], [4, 2, 1, 1, 1]);
    assert.deepEqual([day.grossFare, day.averageFare, day.completionRate], [140, 70, 50]);
  });
  it('an empty period is all zeros, not missing', () => {
    const d = volumeByPeriod([], 'day', 3, NOW);
    assert.equal(d.length, 3);
    assert.ok(d.every((r) => r.total === 0 && r.grossFare === 0 && r.averageFare === 0 && r.completionRate === 0));
  });
});

describe('driver activity', () => {
  const drivers = [
    { driver_id: 'd1', full_name: 'Ana', plate_number: 'P1' },
    { driver_id: 'd2', full_name: 'Ben', plate_number: 'P2' },
    { driver_id: 'd3', full_name: 'Cara' },
  ];
  it('totals the completed trips, kilometres and fares of each driver, the newest trip and recent activity', () => {
    const rows = driverActivity(
      [
        { ...at('2026-10-02T01:00:00Z', { actual_fare: 60, actual_distance_km: '3.0' }), driver_id: 'd1' },
        { ...at('2026-08-01T01:00:00Z', { estimated_fare: 62, estimated_distance_km: 2.4 }), driver_id: 'd1' },
        { ...at('2026-10-03T01:00:00Z', { booking_status: 'Cancelled' }), driver_id: 'd1' },
        { ...at('2026-10-03T01:00:00Z', { booking_status: 'Cancelled' }), driver_id: 'd2' },
        { ...at('2026-10-03T01:00:00Z', { actual_fare: 99 }), driver_id: 'stranger' },
      ],
      drivers,
      30,
      NOW
    );
    assert.deepEqual(rows.map((r) => r.driverId), ['d1', 'd2', 'd3']);
    const [ana, ben, cara] = rows;
    assert.deepEqual([ana.completed, ana.cancelled, ana.km, ana.grossFare], [2, 1, 5.4, 122]);
    assert.equal(ana.lastTripAt, '2026-10-02T01:00:00Z');
    assert.equal(ana.activeInWindow, true);
    assert.deepEqual([ben.completed, ben.cancelled, ben.activeInWindow], [0, 1, false]);
    assert.deepEqual([cara.completed, cara.plate, cara.lastTripAt], [0, '', null]);
  });
  it('a driver whose only trip is outside the window is not active', () => {
    const [row] = driverActivity([{ ...at('2026-08-01T01:00:00Z'), driver_id: 'd1' }], [drivers[0]], 30, NOW);
    assert.equal(row.completed, 1);
    assert.equal(row.activeInWindow, false);
  });
});
