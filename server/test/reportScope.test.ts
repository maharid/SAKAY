// One day, one week, one month (panel comment, decision D-P6): the report period is ONE period, not the last 14 days / 8 weeks / 6 months. Pure functions; no network.
//   run:  cd server && npx tsx --test test/reportScope.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compareWithPrevious, previousWindow, scopeRange, scopeSeries, shiftAnchor } from '../../packages/shared/src/utils/reportScope';

describe('scopeRange', () => {
  it('a day is that one day', () => {
    assert.deepEqual(scopeRange('day', '2026-10-30'), { from: '2026-10-30', to: '2026-10-30', label: 'Fri, Oct 30, 2026' });
  });
  it('a week is the Monday to Sunday week that contains the day (Friday 30 Oct -> 26 Oct - 1 Nov)', () => {
    assert.deepEqual(scopeRange('week', '2026-10-30'), { from: '2026-10-26', to: '2026-11-01', label: 'Oct 26 - Nov 1, 2026' });
    assert.equal(scopeRange('week', '2026-10-26').from, '2026-10-26');       // a Monday is the first day of its own week
    assert.equal(scopeRange('week', '2026-11-01').from, '2026-10-26');       // and a Sunday the last
  });
  it('a month is the whole calendar month, also a short one and a leap February', () => {
    assert.deepEqual(scopeRange('month', '2026-10-15'), { from: '2026-10-01', to: '2026-10-31', label: 'October 2026' });
    assert.equal(scopeRange('month', '2026-02-10').to, '2026-02-28');
    assert.equal(scopeRange('month', '2028-02-10').to, '2028-02-29');
    assert.equal(scopeRange('month', '2026-12-31').to, '2026-12-31');
  });
});

describe('shiftAnchor', () => {
  it('moves a day, a week or a month back and forth', () => {
    assert.equal(shiftAnchor('day', '2026-10-30', -1), '2026-10-29');
    assert.equal(shiftAnchor('day', '2026-10-31', 1), '2026-11-01');
    assert.equal(shiftAnchor('week', '2026-10-30', -1), '2026-10-23');
    assert.equal(shiftAnchor('month', '2026-10-30', -1), '2026-09-30');
    assert.equal(shiftAnchor('month', '2026-12-15', 1), '2027-01-15');
  });
  it('a month keeps the day of the month, or the last day of a shorter month', () => {
    assert.equal(shiftAnchor('month', '2026-03-31', -1), '2026-02-28');
    assert.equal(shiftAnchor('month', '2026-01-31', 1), '2026-02-28');
  });
});

const at = (manila: string, status = 'Completed', fare = 100) => ({ booking_id: manila + status, created_at: new Date(`${manila}+08:00`).toISOString(), booking_status: status, actual_fare: fare });

describe('scopeSeries', () => {
  const bookings = [
    at('2026-10-30T08:10:00', 'Completed', 80), at('2026-10-30T08:50:00', 'Cancelled'), at('2026-10-30T17:05:00', 'Completed', 120), at('2026-10-30T23:59:00', 'No Driver Found'),
    at('2026-10-29T08:00:00'), at('2026-10-31T00:00:00'), at('2026-10-24T12:00:00'),
  ];
  it('one day: exactly 24 hourly bars and only that day\'s bookings (Manila time, not UTC)', () => {
    const rows = scopeSeries(bookings, 'day', '2026-10-30', '2026-10-30');
    assert.equal(rows.length, 24);
    assert.equal(rows.reduce((n, r) => n + r.total, 0), 4);
    assert.equal(rows[8].total, 2);
    assert.equal(rows[8].label, '8 AM');
    assert.equal(rows[17].label, '5 PM');
    assert.equal(rows[23].noDriverFound, 1);
    assert.equal(rows[0].total, 0);
    assert.equal(rows[12].label, '12 PM');
    assert.equal(rows[0].label, '12 AM');
  });
  it('the sums of an hour: completed, cancelled, fares and the completion rate', () => {
    const eight = scopeSeries(bookings, 'day', '2026-10-30', '2026-10-30')[8];
    assert.deepEqual([eight.total, eight.completed, eight.cancelled, eight.grossFare, eight.averageFare, eight.completionRate], [2, 1, 1, 80, 80, 50]);
  });
  it('one week: seven daily bars Monday to Sunday, including the days with nothing', () => {
    const rows = scopeSeries(bookings, 'week', '2026-10-26', '2026-11-01');
    assert.equal(rows.length, 7);
    assert.deepEqual(rows.map((r) => r.key), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
    assert.deepEqual(rows.map((r) => r.total), [0, 0, 0, 1, 4, 1, 0]);
  });
  it('one month: one bar per day, 31 for October, labelled by the day of the month', () => {
    const rows = scopeSeries(bookings, 'month', '2026-10-01', '2026-10-31');
    assert.equal(rows.length, 31);
    assert.equal(rows[0].label, '1');
    assert.equal(rows[30].label, '31');
    assert.equal(rows.reduce((n, r) => n + r.total, 0), 7);
  });
  it('bookings outside the period are ignored and a booking without a time is skipped', () => {
    const rows = scopeSeries([...bookings, { booking_id: 'x', created_at: null, booking_status: 'Completed' }], 'week', '2026-10-26', '2026-11-01');
    assert.equal(rows.reduce((n, r) => n + r.total, 0), 6);
  });
});

describe('the comparison with the period before', () => {
  it('a day is compared with the day before, a week with the 7 days before', () => {
    assert.deepEqual(previousWindow('2026-10-30', '2026-10-30'), { from: '2026-10-29', to: '2026-10-29' });
    assert.deepEqual(previousWindow('2026-10-26', '2026-11-01'), { from: '2026-10-19', to: '2026-10-25' });
    assert.deepEqual(previousWindow('2026-10-01', '2026-10-31'), { from: '2026-08-31', to: '2026-09-30' });
  });
  it('growth, decline, no change, and no percentage when the period before had nothing', () => {
    assert.deepEqual(compareWithPrevious(12, 10, '2026-10-26', '2026-11-01'), { current: 12, previous: 10, change: 2, changePct: 20, direction: 'growth', previousLabel: 'the 7 days before' });
    assert.equal(compareWithPrevious(8, 10, '2026-10-30', '2026-10-30').direction, 'decline');
    assert.equal(compareWithPrevious(8, 10, '2026-10-30', '2026-10-30').previousLabel, 'the day before');
    assert.equal(compareWithPrevious(5, 5, '2026-10-30', '2026-10-30').direction, 'same');
    assert.equal(compareWithPrevious(5, 0, '2026-10-30', '2026-10-30').changePct, null);
  });
});
