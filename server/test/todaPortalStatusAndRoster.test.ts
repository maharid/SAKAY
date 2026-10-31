// The TODA portal's status of a driver application and the LGU portal's roster comparison (pure functions, no network):
//   apps/toda-portal/src/utils/applicantStage.ts    where an application stands, from the TODA endorsement AND the LGU's persisted decision
//   apps/lgu-portal/src/utils/masterRoster.ts       the Master Roster next to EVERY driver registered with the TODA
//   run:  cd server && npx tsx --test test/*.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applicantStage, memberLguStatus } from '../../apps/toda-portal/src/utils/applicantStage';
import { buildRosterRows, franchiseKey } from '../../apps/lgu-portal/src/utils/masterRoster';

describe('applicantStage (TODA portal)', () => {
  it('shows the TODA stage until the TODA has endorsed', () => {
    assert.equal(applicantStage('Submitted', 'Pending'), 'Awaiting Screening');
    assert.equal(applicantStage('Resubmission Required', 'Pending'), 'Resubmission Required');
    assert.equal(applicantStage('Rejected', 'Pending'), 'Rejected');
  });

  it('says "Endorsed to LGU" only while the LGU has not decided', () => {
    assert.equal(applicantStage('Endorsed', 'Pending'), 'Endorsed to LGU');
    assert.equal(applicantStage('Endorsed', null), 'Endorsed to LGU');
  });

  it('shows the LGU\'s decision once it is made (it used to say "Endorsed to LGU" for ever)', () => {
    assert.equal(applicantStage('Endorsed', 'Approved'), 'Verified by LGU');
    assert.equal(applicantStage('Endorsed', 'Rejected'), 'Rejected by LGU');
    assert.equal(applicantStage('Endorsed', 'Resubmission Required'), 'Returned by LGU');
  });
});

describe('memberLguStatus (Driver Membership)', () => {
  it('reads the persisted decision of THIS TODA\'s affiliation', () => {
    assert.equal(memberLguStatus({ affiliation_lgu_status: 'Approved', account_status: 'Pending Verification' }), 'Verified');
    assert.equal(memberLguStatus({ affiliation_lgu_status: 'Pending', account_status: 'Verified' }), 'Pending');
    assert.equal(memberLguStatus({ affiliation_lgu_status: 'Rejected' }), 'Rejected');
    assert.equal(memberLguStatus({ affiliation_lgu_status: 'Resubmission Required' }), 'Returned');
  });
  it('falls back to the account status only when the affiliation has no stage', () => {
    assert.equal(memberLguStatus({ account_status: 'Verified' }), 'Verified');
    assert.equal(memberLguStatus({ account_status: 'Pending Verification' }), 'Pending');
    assert.equal(memberLguStatus(null), 'Pending');
  });
});

const entry = (id: string, name: string, franchise: string, status: 'Active' | 'Left' = 'Active') => ({
  entryId: id, memberName: name, franchiseNumber: franchise, plateNumber: '', membershipNumber: '', source: 'manual', status, addedAt: '2026-01-01T00:00:00Z',
});
// only the fields the comparison reads
const driver = (id: string, name: string, franchise: string, lguStage = 'Pending') =>
  ({ id, name, franchiseNo: franchise, vehiclePlate: 'PLATE', affiliations: [{ lguStage, todaStage: 'Endorsed', membershipNo: '' }] }) as unknown as Parameters<typeof buildRosterRows>[1][number];

describe('buildRosterRows (LGU Master Roster page)', () => {
  it('compares franchise numbers the way a person would', () => {
    assert.equal(franchiseKey('mtop-1234'), franchiseKey('MTOP 1234'));
    assert.equal(franchiseKey(null), '');
  });

  it('puts a member and a driver with the same franchise number on ONE row', () => {
    const rows = buildRosterRows([entry('e1', 'Ana Cruz', 'MTOP-1')], [driver('d1', 'Ana M. Cruz', 'mtop 1')]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].match, 'matched');
    assert.equal(rows[0].driver?.id, 'd1');
  });

  it('lists a member with no driver account, and EVERY driver the roster does not name, verified or not', () => {
    const rows = buildRosterRows(
      [entry('e1', 'Ana Cruz', 'A-1'), entry('e2', 'Ben Reyes', 'B-2')],
      [driver('d1', 'Ana Cruz', 'A-1', 'Approved'), driver('d9', 'Walk-in Driver', 'Z-9', 'Pending'), driver('d8', 'Returned Driver', 'Y-8', 'Resubmission Required')],
    );
    const byMatch = (m: string) => rows.filter((r) => r.match === m).map((r) => r.name).sort();
    assert.deepEqual(byMatch('matched'), ['Ana Cruz']);
    assert.deepEqual(byMatch('rosterOnly'), ['Ben Reyes']);
    assert.deepEqual(byMatch('driverOnly'), ['Returned Driver', 'Walk-in Driver']);
  });

  it('keeps a member who left as history, and does not list his driver a second time', () => {
    const rows = buildRosterRows([entry('e1', 'Old Member', 'L-1', 'Left')], [driver('d1', 'Old Member', 'L-1', 'Approved')]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].match, 'left');
    assert.equal(rows[0].driver?.id, 'd1');
  });

  it('a driver who is back on the roster after leaving is matched to the active entry', () => {
    const rows = buildRosterRows([entry('e1', 'Back Again', 'R-1', 'Left'), entry('e2', 'Back Again', 'R-1', 'Active')], [driver('d1', 'Back Again', 'R-1')]);
    assert.equal(rows.filter((r) => r.match === 'matched').length, 1);
    assert.equal(rows.filter((r) => r.match === 'left')[0].driver, undefined, 'the driver is shown on the active row only');
  });
});
