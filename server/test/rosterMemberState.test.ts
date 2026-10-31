// What a Master Roster member is (packages/shared/src/utils/rosterMemberState.ts): Registered (has a SAKAY account) and Verified (the LGU verified that driver) are different facts.
//   run:  cd server && npx tsx --test test/*.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { driverForFranchise, hasDriverAccount, normalizeFranchiseNumber, rosterCounts, rosterMemberState } from '../../packages/shared/src/utils/rosterMemberState';

const registered = { id: 'd1', franchiseNo: 'CAL-001', lguVerificationStatus: 'Pending', accountStatus: 'Pending Verification' };
const verified = { id: 'd2', franchiseNo: 'cal 002', lguVerificationStatus: 'Verified', accountStatus: 'Active' };
const rosterOnly = { id: 'roster-9', franchiseNo: 'CAL-003', lguVerificationStatus: 'Pending', accountStatus: 'Not Registered' };

describe('roster member state', () => {
  it('compares franchise numbers the way the roster check does', () => {
    assert.equal(normalizeFranchiseNumber(' cal-001 '), 'CAL001');
    assert.equal(normalizeFranchiseNumber(null), '');
  });

  it('a member with no account is not registered, even if a line for him exists', () => {
    assert.equal(hasDriverAccount(rosterOnly), false);
    assert.equal(rosterMemberState(rosterOnly), 'not_registered');
    assert.equal(rosterMemberState(undefined), 'not_registered');
  });

  it('a registered driver the LGU has not verified is Registered, never Verified', () => {
    assert.equal(rosterMemberState(registered), 'registered');
    for (const status of ['Pending', 'Returned', 'Rejected', 'Suspended']) {
      assert.equal(rosterMemberState({ ...registered, lguVerificationStatus: status }), 'registered');
    }
  });

  it('only the LGU\'s verification makes a driver Verified', () => {
    assert.equal(rosterMemberState(verified), 'verified');
  });

  it('finds the driver by franchise number, and a real account wins over a roster-only line', () => {
    const drivers = [rosterOnly, { ...registered, id: 'd3', franchiseNo: 'CAL-003' }, verified];
    assert.equal(driverForFranchise('cal003', drivers)?.id, 'd3');
    assert.equal(driverForFranchise('CAL-002', drivers)?.id, 'd2');
    assert.equal(driverForFranchise('', drivers), undefined);
    assert.equal(driverForFranchise('NOPE', drivers), undefined);
  });

  it('counts the active members only; verified drivers are also registered; approvals are counted apart', () => {
    const entries = [
      { franchise_number: 'CAL-001', status: 'Active', approval_status: 'Approved' },
      { franchise_number: 'CAL-002', status: 'Active', approval_status: 'Pending' },
      { franchise_number: 'CAL-003', status: 'Active', approval_status: 'Rejected' },
      { franchise_number: 'CAL-004', status: 'Left', approval_status: 'Pending' },
    ];
    const drivers = [registered, verified, rosterOnly];
    assert.deepEqual(rosterCounts(entries, drivers), { members: 3, registered: 2, verified: 1, notRegistered: 1, pendingApproval: 1, rejected: 1 });
  });
});
