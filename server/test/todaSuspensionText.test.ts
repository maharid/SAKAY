// The words a driver reads when the TODA is suspended (decision D-P5): the LGU's reason is quoted as written, without a doubled full stop, and the end date is in Manila time.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeRestriction, describeTodaSuspension, parseRestrictionError } from '../../packages/shared/src/utils/restrictionUtils';

describe('describeTodaSuspension', () => {
  const s = { suspended: true, todaName: 'Xentro Mall TODA', reason: 'Several complaints about fares.', until: '2026-11-05T15:59:59Z' };
  it('says who, until when (Asia/Manila) and why, in Tagalog and in English', () => {
    const tl = describeTodaSuspension(s, 'tl');
    assert.match(tl, /Suspendido ng LGU ang Xentro Mall TODA hanggang Nov 05, 2026, 11:59 PM \(PHT\)/);
    assert.match(tl, /Dahilan: Several complaints about fares\.$/);
    const en = describeTodaSuspension(s, 'en');
    assert.match(en, /suspended Xentro Mall TODA until Nov 05, 2026, 11:59 PM \(PHT\)/);
    assert.match(en, /Reason: Several complaints about fares\.$/);
    assert.ok(!/\.\./.test(tl) && !/\.\./.test(en), 'no doubled full stop');
  });
  it('an open-ended suspension says it lasts until the LGU reinstates the TODA, and a missing reason says so', () => {
    const en = describeTodaSuspension({ suspended: true, todaName: 'A TODA', reason: null, until: null }, 'en');
    assert.match(en, /until it is reinstated/);
    assert.match(en, /Reason: no reason recorded\.$/);
    assert.match(describeTodaSuspension({ suspended: true, reason: null }, 'tl'), /walang naitalang dahilan\.$/);
  });
  it('keeps the reason\'s own letters (only trailing punctuation goes)', () => {
    assert.match(describeTodaSuspension({ suspended: true, todaName: 'A', reason: 'Fares above the posted rates' }, 'en'), /Reason: Fares above the posted rates\.$/);
  });
});

describe('a self-deactivated account (decision D-P5)', () => {
  it('is described with the way back, in both languages', () => {
    assert.match(describeRestriction({ restricted: true, kind: 'SELF_DEACTIVATED' }, 'en'), /Reactivate/);
    assert.match(describeRestriction({ restricted: true, kind: 'SELF_DEACTIVATED' }, 'tl'), /Reactivate/);
  });
  it('is recovered from the database\'s error message', () => {
    const r = parseRestrictionError('ERR_ACCOUNT_SELF_DEACTIVATED: Na-deactivate mo ang iyong account. (You deactivated your account.) [kind=SELF_DEACTIVATED]');
    assert.deepEqual(r, { restricted: true, kind: 'SELF_DEACTIVATED', until: null });
  });
});
