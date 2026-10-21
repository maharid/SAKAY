// What the TODA portal shows for each state of the accreditation (apps/toda-portal/src/utils/accreditation.ts): the lock on the driver features, the chips and the
// countdown to the expiry.
//   run:  cd server && npx tsx --test test/*.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RENEWAL_WINDOW_DAYS, accreditationChip, daysUntil, documentChip, isTodaLocked } from '../../apps/toda-portal/src/utils/accreditation';

// "Now" is 2026-10-21 12:00 in Manila (04:00 UTC)
const NOW = new Date('2026-10-21T04:00:00Z');

describe('the lock on the driver, roster and monitoring features', () => {
  it('is open only while the accreditation is Active', () => {
    assert.equal(isTodaLocked('Active'), false);
    for (const s of ['Pending Verification', 'Resubmission Required', 'Suspended', 'Deactivated']) assert.equal(isTodaLocked(s), true, s);
  });
  it('does not lock anything while the profile is still loading', () => {
    assert.equal(isTodaLocked(undefined), false);
    assert.equal(isTodaLocked(null), false);
  });
});

describe('the status chips', () => {
  it('say what is true for each status and use red for a returned, declined or suspended TODA', () => {
    assert.equal(accreditationChip('Active').label, 'Accredited Active');
    assert.equal(accreditationChip('Pending Verification').label, 'Pending Verification');
    assert.equal(accreditationChip('Resubmission Required').label, 'Returned for correction');
    assert.equal(accreditationChip('Deactivated').label, 'Declined / deactivated');
    assert.equal(accreditationChip('Suspended').label, 'Suspended');
    for (const s of ['Resubmission Required', 'Deactivated', 'Suspended'] as const) assert.equal(accreditationChip(s).color, '#B91C1C');
  });
  it('tell a verified file from a renewal the LGU has not recorded yet', () => {
    assert.equal(documentChip('Active', false).label, 'Verified by LGU');
    assert.equal(documentChip('Active', true).label, 'Renewal sent to the LGU');
    assert.equal(documentChip('Resubmission Required', false).label, 'Returned: correct it');
    assert.equal(documentChip('Pending Verification', false).label, 'Pending Verification');
  });
});

describe('days until the accreditation expires', () => {
  it('is zero on the day itself, positive before and negative after', () => {
    assert.equal(daysUntil('2026-10-21T10:00:00Z', NOW), 0);
    assert.equal(daysUntil('2026-10-21T15:00:00Z', NOW), 0); // 23:00 on Oct 21 in Manila: still today
    assert.equal(daysUntil('2026-11-02T10:00:00Z', NOW), 12);
    assert.equal(daysUntil('2026-10-19T10:00:00Z', NOW), -2);
  });
  it('reads the Manila date, not the UTC date: 17:00 UTC is already the next day in Manila', () => {
    assert.equal(daysUntil('2026-10-21T17:00:00Z', NOW), 1);
  });
  it('has no answer without a date', () => {
    assert.equal(daysUntil(null, NOW), null);
    assert.equal(daysUntil('not a date', NOW), null);
  });
  it('uses the 30-day reminder window of Rule 24.4', () => {
    assert.equal(RENEWAL_WINDOW_DAYS, 30);
  });
});
