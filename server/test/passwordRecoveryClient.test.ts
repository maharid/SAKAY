// The app side of password recovery (packages/shared/src/utils/passwordRecovery.ts) talking to the REAL route, so a renamed field or a changed
// status on either side fails here instead of on a phone. Only the database functions are stood in for (as in passwordReset.test.ts).
//   run:  cd server && npx tsx --test test/passwordRecoveryClient.test.ts
import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createPasswordResetRouter } from '../src/routes/passwordResetRoutes';
import { confirmPasswordReset, recoveryProblemText, requestPasswordResetCode, type RecoveryProblem } from '../../packages/shared/src/utils/passwordRecovery';
import { fakeSupabase, listen, quiet, uuid } from './helpers';

const ACCOUNT = { id: uuid(41), auth: uuid(51), sub: '9171234567' };
const CODE = '135790';
const GOOD = 'Mabuhay#2026';

describe('the apps calls against the real route', () => {
  let srv: Awaited<ReturnType<typeof listen>>;
  let realFetch: typeof fetch;
  const state = { hash: null as string | null, failed: 0, lastSent: 0, set: [] as { id: string; password: string }[] };
  before(async () => {
    const db = fakeSupabase({
      rpc: {
        find_recovery_account: (a: any) => ({ data: String(a.p_phone).endsWith(ACCOUNT.sub) ? { found: true, account_id: ACCOUNT.id, auth_user_id: ACCOUNT.auth } : { found: false } }),
        reserve_password_reset_code: (a: any) => {
          if (Date.now() - state.lastSent < 30_000) return { data: { allowed: false, reason: 'cooldown', wait_seconds: 30 } };
          state.lastSent = Date.now();
          if (a.p_code_hash) { state.hash = a.p_code_hash; state.failed = 0; }
          return { data: { allowed: true } };
        },
        release_password_reset_code: () => ({ data: null }),
        verify_password_reset_code: (a: any) => {
          if (!state.hash) return { data: { ok: false, reason: 'not_found' } };
          if (state.hash === a.p_code_hash) { state.hash = null; return { data: { ok: true } }; }
          state.failed += 1;
          return state.failed >= 5 ? { data: { ok: false, reason: 'locked', minutes_remaining: 15 } } : { data: { ok: false, reason: 'wrong', attempts_left: 5 - state.failed } };
        },
        finish_password_reset: () => ({ data: {} }),
      },
    });
    (db.auth.admin as any).updateUserById = async (id: string, a: { password: string }) => { state.set.push({ id, password: a.password }); return { data: {}, error: null }; };
    const app = express();
    app.use(express.json());
    app.use('/api/password-reset', createPasswordResetRouter({
      supabase: db as any,
      sms: { sendRecoveryCode: async () => ({ success: true }), sendNotice: async () => ({ success: true }) },
      makeCode: () => CODE,
    }));
    srv = await listen(app);
    realFetch = globalThis.fetch;
    // the apps call a path on their own origin; here that origin is the test server
    globalThis.fetch = ((input: any, init?: any) => realFetch(typeof input === 'string' && input.startsWith('/') ? srv.url + input : input, init)) as typeof fetch;
  });
  after(async () => { globalThis.fetch = realFetch; await srv.close(); });

  it('asking for a code, a wrong code, a weak password, then the change', async () => {
    assert.deepEqual(await quiet(() => requestPasswordResetCode('passenger', '0917 123 4567')), { success: true });
    const again = await quiet(() => requestPasswordResetCode('passenger', '09171234567'));
    assert.equal(again.problem, 'cooldown');
    assert.ok((again.waitSeconds ?? 0) > 0);

    const weak = await quiet(() => confirmPasswordReset('passenger', '09171234567', CODE, 'short'));
    assert.equal(weak.problem, 'weak');
    const wrong = await quiet(() => confirmPasswordReset('passenger', '09171234567', '000000', GOOD));
    assert.deepEqual({ problem: wrong.problem, left: wrong.attemptsLeft }, { problem: 'wrong', left: 4 });
    const bad = await quiet(() => confirmPasswordReset('passenger', '09171234567', 'abc', GOOD));
    assert.equal(bad.problem, 'invalid');

    assert.deepEqual(await quiet(() => confirmPasswordReset('passenger', '09171234567', CODE, GOOD)), { success: true });
    assert.deepEqual(state.set, [{ id: ACCOUNT.auth, password: GOOD }]);
    const used = await quiet(() => confirmPasswordReset('passenger', '09171234567', CODE, GOOD));
    assert.equal(used.problem, 'expired');
  });

  it('five wrong codes come back as locked, with the minutes', async () => {
    state.hash = 'something-else'; state.failed = 0;
    let last = await quiet(() => confirmPasswordReset('passenger', '09171234567', '111111', GOOD));
    for (let i = 0; i < 4; i++) last = await quiet(() => confirmPasswordReset('passenger', '09171234567', '111111', GOOD));
    assert.deepEqual({ problem: last.problem, minutes: last.minutesRemaining }, { problem: 'locked', minutes: 15 });
  });

  it('a server that cannot be reached is "network", not a thrown error', async () => {
    const saved = globalThis.fetch;
    globalThis.fetch = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    try { assert.equal((await requestPasswordResetCode('driver', '09171234567')).problem, 'network'); } finally { globalThis.fetch = saved; }
  });
});

describe('what the person is told', () => {
  const problems: RecoveryProblem[] = ['invalid', 'cooldown', 'daily', 'locked', 'wrong', 'expired', 'weak', 'failed', 'sms', 'busy', 'unavailable', 'network'];
  it('every problem has a different, non-empty message in Tagalog and in English, and none contains a code', () => {
    const seen = new Set<string>();
    for (const problem of problems) {
      for (const language of ['tl', 'en'] as const) {
        const text = recoveryProblemText({ success: false, problem, waitSeconds: 30, minutesRemaining: 15, attemptsLeft: 2 }, language);
        assert.ok(text.length > 10, `${problem}/${language}`);
        assert.ok(!seen.has(text), `${problem}/${language} repeats another message`);
        seen.add(text);
        assert.ok(!/\d{6}/.test(text));
      }
    }
  });
  it('says the numbers it was given', () => {
    assert.match(recoveryProblemText({ success: false, problem: 'wrong', attemptsLeft: 2 }, 'en'), /2 tries/);
    assert.match(recoveryProblemText({ success: false, problem: 'wrong', attemptsLeft: 1 }, 'en'), /1 try /);
    assert.match(recoveryProblemText({ success: false, problem: 'locked', minutesRemaining: 9.2 }, 'tl'), /10 minuto/);
    assert.match(recoveryProblemText({ success: false, problem: 'cooldown', waitSeconds: 12 }, 'en'), /12 seconds/);
  });
});
