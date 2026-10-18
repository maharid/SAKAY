// Rules 20 / 22.3 / 25: the strikes and appeals calls that the Passenger and the Driver app share (packages/shared/src/utils/strikeAppeals.ts).
// The database decides who may appeal what; these tests cover what the apps do with its answers: what is mapped, what is offered as "Appeal",
// what is sent, and what is shown when the database refuses.
//   run:  cd server && npx tsx --test test/strikeAppeals.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canAppealStrike,
  fetchOwnAppeals,
  fetchStrikeHistory,
  newestAppealByStrike,
  submitStrikeAppeal,
  type AppealRow,
  type StrikeAppealClient,
  type StrikeRow,
} from '../../packages/shared/src/utils/strikeAppeals';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-10-18T08:00:00Z');

const strike = (over: Partial<StrikeRow> = {}): StrikeRow => ({
  strikeId: 's1', violationCode: 'PAX_LATE_CANCEL', description: 'Late cancellation', sourceRule: 'Rule 12.2', status: 'ACTIVE',
  pointsIssued: 1, pointsActive: 1, issuedAt: new Date(NOW - 2 * HOUR).toISOString(), provisionalUntil: null, reason: null, ...over,
});
const appeal = (over: Partial<AppealRow> = {}): AppealRow => ({
  requestId: 'r1', strikeId: 's1', status: 'Pending LGU Review', causeCode: 'OTHER', requestedAt: new Date(NOW - HOUR).toISOString(),
  decisionDueAt: null, decisionReason: null, decidedAt: null, ...over,
});

function fakeClient(opts: { rpc?: (fn: string, args: Record<string, unknown>) => { data?: unknown; error?: { message: string } | null }; rows?: Array<Record<string, unknown>> | null; rowsError?: string } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const queries: { table: string; columns: string; order: string; limit: number }[] = [];
  const client: StrikeAppealClient = {
    rpc: async (fn, args = {}) => {
      calls.push({ fn, args });
      const r = opts.rpc?.(fn, args) ?? { data: null, error: null };
      return { data: r.data ?? null, error: r.error ?? null };
    },
    from: (table) => ({
      select: (columns) => ({
        order: (column) => ({
          limit: async (n) => {
            queries.push({ table, columns, order: column, limit: n });
            return opts.rowsError ? { data: null, error: { message: opts.rowsError } } : { data: opts.rows ?? [], error: null };
          },
        }),
      }),
    }),
  };
  return { client, calls, queries };
}

describe('the strike history', () => {
  it('asks for the subject\'s own history and maps the rows', async () => {
    const f = fakeClient({
      rpc: () => ({
        data: {
          active_strikes: 2, window_days: 90,
          strikes: [{ strike_id: 'a', violation_code: 'PAX_NO_SHOW', description: 'No-show', source_rule: 'Rule 10.4', status: 'PROVISIONAL', points_issued: 2, points_active: 2, issued_at: '2026-10-17T01:00:00Z', provisional_until: '2026-10-19T01:00:00Z', reason: 'Not at pickup' }],
        },
      }),
    });
    const h = await fetchStrikeHistory(f.client, 'passenger', 'p-1');
    assert.deepEqual(f.calls, [{ fn: 'get_strike_history', args: { p_subject_type: 'passenger', p_subject_id: 'p-1' } }]);
    assert.equal(h?.activeStrikes, 2);
    assert.equal(h?.windowDays, 90);
    assert.deepEqual(h?.strikes[0], {
      strikeId: 'a', violationCode: 'PAX_NO_SHOW', description: 'No-show', sourceRule: 'Rule 10.4', status: 'PROVISIONAL', pointsIssued: 2, pointsActive: 2,
      issuedAt: '2026-10-17T01:00:00Z', provisionalUntil: '2026-10-19T01:00:00Z', reason: 'Not at pickup',
    });
  });

  it('is null (not an empty list) when the database refuses or answers nothing, so the screen can say it could not load', async () => {
    assert.equal(await fetchStrikeHistory(fakeClient({ rpc: () => ({ error: { message: 'Access Denied: You cannot view this strike history.' } }) }).client, 'passenger', 'p'), null);
    assert.equal(await fetchStrikeHistory(fakeClient({ rpc: () => ({ data: null }) }).client, 'driver', 'd'), null);
  });

  it('a history with no strikes is a real, empty history', async () => {
    const h = await fetchStrikeHistory(fakeClient({ rpc: () => ({ data: { active_strikes: 0, window_days: 90, strikes: [] } }) }).client, 'passenger', 'p');
    assert.deepEqual(h, { activeStrikes: 0, windowDays: 90, strikes: [] });
  });
});

describe('the person\'s appeals', () => {
  it('reads the appeals with their decision date, newest first, at most 50', async () => {
    const f = fakeClient({ rows: [{ request_id: 'r', strike_id: 's', status: 'Pending LGU Review', cause_code: 'OTHER', requested_at: '2026-10-18T01:00:00Z', decision_due_at: '2026-10-21T01:00:00Z', decision_reason: null, decided_at: null }] });
    const rows = await fetchOwnAppeals(f.client);
    assert.deepEqual(f.queries, [{ table: 'exemption_request', columns: 'request_id, strike_id, status, cause_code, requested_at, decision_due_at, decision_reason, decided_at', order: 'requested_at', limit: 50 }]);
    assert.deepEqual(rows, [{ requestId: 'r', strikeId: 's', status: 'Pending LGU Review', causeCode: 'OTHER', requestedAt: '2026-10-18T01:00:00Z', decisionDueAt: '2026-10-21T01:00:00Z', decisionReason: null, decidedAt: null }]);
  });
  it('is an empty list when it cannot be read', async () => {
    assert.deepEqual(await fetchOwnAppeals(fakeClient({ rowsError: 'network' }).client), []);
  });
  it('the newest appeal of each strike wins, whatever the order', () => {
    const older = appeal({ requestId: 'old', status: 'Denied', requestedAt: '2026-10-10T00:00:00Z' });
    const newer = appeal({ requestId: 'new', status: 'Pending LGU Review', requestedAt: '2026-10-17T00:00:00Z' });
    const other = appeal({ requestId: 'o', strikeId: 's2' });
    for (const list of [[older, newer, other], [newer, other, older], [other, older, newer]]) {
      const m = newestAppealByStrike(list);
      assert.equal(m.get('s1')?.requestId, 'new');
      assert.equal(m.get('s2')?.requestId, 'o');
      assert.equal(m.size, 2);
    }
  });
});

describe('when "Appeal" is offered (Rule 25.1)', () => {
  it('for a strike that still counts, within 48 hours, with no appeal waiting', () => {
    for (const status of ['ACTIVE', 'PROVISIONAL', 'PARTIALLY_WAIVED']) assert.equal(canAppealStrike(strike({ status }), undefined, NOW), true, status);
  });
  it('not for a strike that no longer counts', () => {
    for (const status of ['WAIVED', 'AUTO_WAIVED', 'OBSERVED', 'VOIDED']) assert.equal(canAppealStrike(strike({ status }), undefined, NOW), false, status);
    assert.equal(canAppealStrike(strike({ pointsActive: 0 }), undefined, NOW), false);
  });
  it('the 48 hours run from the issue: at 48 h exactly it is still offered, a second later it is not', () => {
    const issued = NOW - 48 * HOUR;
    assert.equal(canAppealStrike(strike({ issuedAt: new Date(issued).toISOString() }), undefined, NOW), true);
    assert.equal(canAppealStrike(strike({ issuedAt: new Date(issued - 1000).toISOString() }), undefined, NOW), false);
  });
  it('not while an appeal of it is waiting for a decision (either reviewer), but again after a decision', () => {
    assert.equal(canAppealStrike(strike(), appeal({ status: 'Pending LGU Review' }), NOW), false);
    assert.equal(canAppealStrike(strike(), appeal({ status: 'Pending TODA Review' }), NOW), false);
    assert.equal(canAppealStrike(strike(), appeal({ status: 'Denied' }), NOW), true);
  });
  it('not when the issue time is unreadable (nothing is guessed)', () => {
    assert.equal(canAppealStrike(strike({ issuedAt: 'not a date' }), undefined, NOW), false);
  });
});

describe('sending an appeal', () => {
  it('sends the cause and the trimmed words, and no evidence, and says who will decide', async () => {
    const f = fakeClient({ rpc: () => ({ data: { success: true, assigned_role: 'lgu_admin' } }) });
    const r = await submitStrikeAppeal(f.client, 's1', 'MEDICAL_EMERGENCY', '  I was taken to hospital.  ');
    assert.deepEqual(r, { ok: true, error: null, assignedRole: 'lgu_admin' });
    assert.deepEqual(f.calls, [{ fn: 'submit_exemption_request', args: { p_strike_id: 's1', p_cause_code: 'MEDICAL_EMERGENCY', p_justification: 'I was taken to hospital.', p_evidence: [], p_toda_is_party: false } }]);
  });
  it('shows the database\'s refusal as it is, without the "Access Denied:" prefix', async () => {
    const f = fakeClient({ rpc: () => ({ error: { message: 'The 48 hour window to request an exemption for this strike has passed (Rule 25.1).' } }) });
    const r = await submitStrikeAppeal(f.client, 's1', 'OTHER', 'late');
    assert.equal(r.ok, false);
    assert.equal(r.error, 'The 48 hour window to request an exemption for this strike has passed (Rule 25.1).');
    const denied = await submitStrikeAppeal(fakeClient({ rpc: () => ({ error: { message: 'Access Denied: You can only request an exemption for your own strike.' } }) }).client, 's1', 'OTHER', 'x');
    assert.equal(denied.error, 'You can only request an exemption for your own strike.');
  });
  it('an answer that is not a success is not reported as one', async () => {
    const r = await submitStrikeAppeal(fakeClient({ rpc: () => ({ data: { success: false } }) }).client, 's1', 'OTHER', 'x');
    assert.equal(r.ok, false);
    assert.match(r.error ?? '', /could not be sent/);
  });
});
