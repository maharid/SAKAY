// What a notice in the Passenger or the Driver app lets the person open (packages/shared/src/utils/notificationActions.ts): only pages that exist in that app, the record the notice
// carries, and no action at all for a notice with nowhere to go.
//   run:  cd server && npx tsx --test test/notificationActions.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appealTargetFromSearch, noticeActions } from '../../packages/shared/src/utils/notificationActions';

const ID = '3f2c8d1e-9a44-4c1b-8e0f-5b7a1d2c9e10';
const keys = (audience: 'passenger' | 'driver', type: string | null | undefined, subjectId?: string | null) => noticeActions(audience, { type, subjectId }).map((a) => a.key);
const targets = (audience: 'passenger' | 'driver', type: string, subjectId?: string | null) => noticeActions(audience, { type, subjectId }).map((a) => a.to);

describe('strike notices', () => {
  it('a new strike offers its strikes page and the appeal of THAT strike, in either app', () => {
    assert.deepEqual(keys('passenger', 'STRIKE_ISSUED', ID), ['strikes', 'appeal']);
    assert.deepEqual(targets('passenger', 'STRIKE_ISSUED', ID), ['/strikes', `/strikes?appeal=${ID}`]);
    assert.deepEqual(targets('driver', 'STRIKE_ISSUED', ID), ['/driver/strikes', `/driver/strikes?appeal=${ID}`]);
  });
  it('a strike notice without a usable record id asks for the first strike that can be appealed, never for a made-up one', () => {
    assert.deepEqual(targets('driver', 'STRIKE_ISSUED'), ['/driver/strikes', '/driver/strikes?appeal=1']);
    assert.deepEqual(targets('driver', 'STRIKE_ISSUED', 'not-a-uuid'), ['/driver/strikes', '/driver/strikes?appeal=1']);
    assert.deepEqual(targets('passenger', 'STRIKE_ISSUED', "x'); drop table strikes;--"), ['/strikes', '/strikes?appeal=1']);
  });
  it('a waiver, a warning or a suspension notice only leads to the strikes (there is nothing left to appeal)', () => {
    for (const type of ['STRIKE_WAIVED_SAFETY_VICTIM', 'CONDUCT_WARNING', 'ACCOUNT_RESTRICTION_NOTICE', 'ACCOUNT_SUSPENDED_BY_ADMIN', 'ACCOUNT_REINSTATED']) {
      assert.deepEqual(keys('driver', type, ID), ['strikes'], type);
    }
  });
  it('a booking cancelled for the driver leads to his strikes and the appeal (Rules 8.6 and 9.4), and means nothing to a passenger here', () => {
    assert.deepEqual(targets('driver', 'BOOKING_AUTO_CANCELLED'), ['/driver/strikes', '/driver/strikes?appeal=1']);
    assert.deepEqual(keys('passenger', 'BOOKING_AUTO_CANCELLED'), []);
  });
  it('an appeal notice leads to the strikes page, where the appeals are listed', () => {
    assert.deepEqual(targets('driver', 'APPEAL_DECIDED', ID), ['/driver/strikes']);
    assert.deepEqual(targets('passenger', 'EXEMPTION_APPROVED', ID), ['/strikes']);
  });
});

describe('trip notices', () => {
  it('open the page of THAT trip in the app that has one', () => {
    assert.deepEqual(targets('passenger', 'TRIP_CORRECTED', ID), [`/trip-details/${ID}`]);
    assert.deepEqual(targets('driver', 'TRIP_CORRECTED', ID), [`/driver/trip-detail/${ID}`]);
  });
  it('carry the booking in the first part of a "booking|detail" subject', () => {
    assert.deepEqual(targets('driver', 'PASSENGER_COUNT_CORRECTED', `${ID}|2`), [`/driver/trip-detail/${ID}`]);
  });
  it('have no action when the notice does not carry its booking (no page is invented for it)', () => {
    assert.deepEqual(keys('passenger', 'TRIP_CORRECTED'), []);
    assert.deepEqual(keys('driver', 'TRIP_CLOSED_BY_ADMIN', null), []);
    assert.deepEqual(keys('driver', 'TRIP_CORRECTED', 'BKG-1234'), []);
  });
});

describe('reports and reviews', () => {
  it('a passenger follows an incident report in the app, on its own page when the notice carries it', () => {
    assert.deepEqual(targets('passenger', 'INCIDENT_RESOLVED', ID), [`/track-reports/${ID}`]);
    assert.deepEqual(targets('passenger', 'INCIDENT_UPDATED'), ['/track-reports']);
  });
  it('a driver has no page to follow a report, so a report notice has no action there', () => {
    assert.deepEqual(keys('driver', 'INCIDENT_RESOLVED', ID), []);
    assert.deepEqual(keys('driver', 'LOST_ITEM_FOUND', ID), []);
  });
  it('a fare review opens the fare reviews list of the app', () => {
    assert.deepEqual(targets('passenger', 'FARE_DISPUTE_DECIDED', ID), ['/fare-disputes']);
    assert.deepEqual(targets('driver', 'FARE_DISPUTE_OPENED', ID), ['/driver/fare-disputes']);
  });
  it('a driver\'s application, documents and substitution notices open the pages for them, and only in the Driver app', () => {
    assert.deepEqual(targets('driver', 'DRIVER_APPLICATION_APPROVED'), ['/driver/status']);
    assert.deepEqual(targets('driver', 'DRIVER_DOCUMENTS_RETURNED'), ['/driver/status']);
    assert.deepEqual(targets('driver', 'VEHICLE_SUBSTITUTION_APPROVED'), ['/driver/vehicle-substitution']);
    assert.deepEqual(keys('passenger', 'DRIVER_APPLICATION_APPROVED'), []);
  });
});

describe('notices with nowhere to go', () => {
  it('an announcement, a reminder or a notice of an unknown type has no action', () => {
    for (const type of ['TODA_REMINDER', 'LGU_RENEWAL_REMINDER', 'SOMETHING_NEW', '', '   ']) {
      assert.deepEqual(keys('driver', type, ID), [], type);
      assert.deepEqual(keys('passenger', type, ID), [], type);
    }
    assert.deepEqual(keys('driver', undefined), []);
    assert.deepEqual(keys('passenger', null), []);
  });
  it('reads the type without regard to case or stray spaces', () => {
    assert.deepEqual(keys('driver', ' strike_issued ', ID), ['strikes', 'appeal']);
  });
});

describe('the appeal the address names', () => {
  it('is a strike\'s id, or 1 for the first strike that can be appealed', () => {
    assert.equal(appealTargetFromSearch(`?appeal=${ID}`), ID);
    assert.equal(appealTargetFromSearch('?appeal=1'), '1');
    assert.equal(appealTargetFromSearch(`?x=1&appeal=${ID}`), ID);
  });
  it('is nothing for anything else (an address typed by hand cannot open a form for a strange value)', () => {
    for (const search of ['', '?appeal=', '?appeal=2', '?appeal=abc', "?appeal=1' or '1'='1", '?other=1']) assert.equal(appealTargetFromSearch(search), null, search);
  });
});
