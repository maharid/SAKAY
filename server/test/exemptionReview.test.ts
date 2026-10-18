// Rules 22 and 25: what the LGU and TODA portals need to review strike appeals (packages/shared/src/utils/exemptionReview.ts): the checks before a decision is
// sent, the call arguments, and the reading of the database's rows. (scripts/db-tests/batch3/appeals-client-contract.js runs the same code against the real database.)
//   run:  cd server && npx tsx --test test/exemptionReview.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  closeAccountArgs,
  decideExemptionArgs,
  decisionProblem,
  escalateExemptionArgs,
  isPendingAppeal,
  mapAppealRows,
  voidStrikeArgs,
} from '../../packages/shared/src/utils/exemptionReview';

const NOW = Date.parse('2026-10-18T08:00:00Z');
const request = (over: Record<string, unknown> = {}) => ({
  request_id: 'r1', strike_id: 's1', subject_type: 'passenger', subject_id: 'p1', cause_code: 'OTHER', justification: 'Because', evidence_urls: [],
  status: 'Pending LGU Review', assigned_role: 'lgu_admin', requested_at: '2026-10-17T08:00:00Z', decision_due_at: '2026-10-21T08:00:00Z',
  escalation_reason: null, auto_denied: false, decided_at: null, decision_reason: null, points_waived: null, ...over,
});
const lookup = {
  strikes: [{ strike_id: 's1', violation_code: 'PAX_NO_SHOW', source_rule: 'Rule 10.4', status: 'ACTIVE', points_active: 2, points_issued: 2 }],
  people: [{ id: 'p1', type: 'passenger' as const, name: 'Pax One' }, { id: 'p1', type: 'driver' as const, name: 'A Driver With The Same Id' }],
  catalog: [{ violation_code: 'PAX_NO_SHOW', description: 'No-show at pickup' }],
};

describe('what must be filled in before a decision is sent', () => {
  it('needs an outcome and a reason of at least five characters, for every outcome', () => {
    assert.match(decisionProblem(null, 'a good reason', null, 2) ?? '', /outcome/);
    for (const o of ['FULL', 'PARTIAL', 'DENIED'] as const) {
      assert.match(decisionProblem(o, '', 1, 2) ?? '', /reason/, o);
      assert.match(decisionProblem(o, '  abc  ', 1, 2) ?? '', /reason/, o);
    }
    assert.equal(decisionProblem('FULL', 'proof seen', null, 1), null);
    assert.equal(decisionProblem('DENIED', 'no proof', null, 1), null);
  });
  it('a partial waiver needs a whole number of points from 1 to one less than the strike has', () => {
    assert.equal(decisionProblem('PARTIAL', 'part of it', 1, 2), null);
    assert.equal(decisionProblem('PARTIAL', 'part of it', 2, 3), null);
    for (const points of [0, 3, 2.5, -1, null, Number.NaN]) assert.notEqual(decisionProblem('PARTIAL', 'part of it', points as number | null, 3), null, String(points));
    assert.match(decisionProblem('PARTIAL', 'part of it', 1, 1) ?? '', /one point/, 'a one-point strike cannot be split');
  });
});

describe('the call arguments', () => {
  it('decide: the reason is trimmed and the points are sent only for a partial waiver', () => {
    assert.deepEqual(decideExemptionArgs('r', 'FULL', '  ok  ', 3), { p_request_id: 'r', p_outcome: 'FULL', p_reason: 'ok', p_points_to_waive: null });
    assert.deepEqual(decideExemptionArgs('r', 'DENIED', 'no', 3), { p_request_id: 'r', p_outcome: 'DENIED', p_reason: 'no', p_points_to_waive: null });
    assert.deepEqual(decideExemptionArgs('r', 'PARTIAL', 'some', 1), { p_request_id: 'r', p_outcome: 'PARTIAL', p_reason: 'some', p_points_to_waive: 1 });
  });
  it('escalate, void and close', () => {
    assert.deepEqual(escalateExemptionArgs('r', ' why '), { p_request_id: 'r', p_reason: 'why' });
    assert.deepEqual(voidStrikeArgs('s', ' wrong person '), { p_strike_id: 's', p_reason: 'wrong person' });
    assert.deepEqual(closeAccountArgs('driver', 'd', ' abuse ', true), { p_subject_type: 'driver', p_subject_id: 'd', p_reason: 'abuse', p_history_reviewed: true });
  });
});

describe('reading the database\'s rows', () => {
  it('joins the strike, the catalog description and the right person (a passenger and a driver may share an id string)', () => {
    const [r] = mapAppealRows({ requests: [request()], ...lookup }, NOW);
    assert.equal(r.subjectName, 'Pax One');
    assert.equal(r.violation, 'No-show at pickup (Rule 10.4)');
    assert.deepEqual([r.pointsActive, r.pointsIssued, r.strikeStatus], [2, 2, 'ACTIVE']);
    const [d] = mapAppealRows({ requests: [request({ subject_type: 'driver' })], ...lookup }, NOW);
    assert.equal(d.subjectName, 'A Driver With The Same Id');
  });
  it('overdue only while it is still waiting and past its due date', () => {
    const past = '2026-10-18T07:00:00Z';
    assert.equal(mapAppealRows({ requests: [request({ decision_due_at: past })], ...lookup }, NOW)[0].overdue, true);
    assert.equal(mapAppealRows({ requests: [request({ decision_due_at: past, status: 'Pending TODA Review' })], ...lookup }, NOW)[0].overdue, true);
    assert.equal(mapAppealRows({ requests: [request({ decision_due_at: past, status: 'Full Waiver', decided_at: past })], ...lookup }, NOW)[0].overdue, false);
    assert.equal(mapAppealRows({ requests: [request()], ...lookup }, NOW)[0].overdue, false);
    assert.equal(mapAppealRows({ requests: [request({ decision_due_at: null })], ...lookup }, NOW)[0].overdue, false);
  });
  it('a request whose strike or person cannot be read still shows, with plain words and no invented numbers', () => {
    const [r] = mapAppealRows({ requests: [request({ strike_id: 'gone', subject_id: 'nobody' })], strikes: [], people: [], catalog: [] }, NOW);
    assert.equal(r.subjectName, 'Passenger');
    assert.equal(r.violation, 'Strike');
    assert.deepEqual([r.pointsActive, r.pointsIssued], [0, 0]);
  });
  it('evidence, escalation, the decision and an automatic denial come through', () => {
    const [r] = mapAppealRows({
      requests: [request({ evidence_urls: ['https://x/a.jpg', 'https://x/b.pdf'], escalation_reason: 'TODA is a party', status: 'Denied', auto_denied: true, decision_reason: 'Same cause four times', decided_at: '2026-10-18T07:00:00Z', points_waived: 0 })],
      ...lookup,
    }, NOW);
    assert.deepEqual(r.evidenceUrls, ['https://x/a.jpg', 'https://x/b.pdf']);
    assert.equal(r.escalationReason, 'TODA is a party');
    assert.equal(r.autoDenied, true);
    assert.equal(r.decisionReason, 'Same cause four times');
    assert.equal(r.pointsWaived, 0);
    assert.equal(mapAppealRows({ requests: [request({ evidence_urls: 'not a list' })], ...lookup }, NOW)[0].evidenceUrls.length, 0);
  });
  it('which statuses are still waiting', () => {
    assert.equal(isPendingAppeal('Pending TODA Review'), true);
    assert.equal(isPendingAppeal('Pending LGU Review'), true);
    for (const s of ['Full Waiver', 'Partial Waiver', 'Denied']) assert.equal(isPendingAppeal(s), false, s);
  });
});
