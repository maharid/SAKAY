// Password recovery (Rule 4.2): POST /api/password-reset/request and /confirm. The five database functions behind them are stood in for by a small
// model of what they do (scripts/db-tests/batch2/password-recovery.js proves the real ones); what is checked HERE is the route: who gets a text,
// that the answer does not depend on whether the number has an account, that a weak password does not burn a code, that a code works once and
// only for its own app and number, that the password is set on the right login, and that no code ever leaves in a response or a log.
//   run:  cd server && npx tsx --test test/passwordReset.test.ts
import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createPasswordResetRouter, hashRecoveryCode, type RecoveryRole } from '../src/routes/passwordResetRoutes';
import { checkPassword } from '../src/utils/passwordPolicy';
import { checkPassword as sharedCheckPassword } from '../../packages/shared/src/utils/passwordPolicy';
import { createApp } from '../src/app';
import { createAuth } from '../src/middleware/auth';
import { call, fakeSupabase, listen, quiet, uuid } from './helpers';

const PAX = { id: uuid(21), auth: uuid(31), sub: '9170000001', phone: '09170000001' };
const DRV = { id: uuid(22), auth: uuid(32), sub: '9180000001', phone: '+639180000001' };
const STRANGER = '09199999999';
const CODE = '246810';
const GOOD = 'Mabuhay#2026';

/** What the database functions do, in memory (same rules, simplified). `clock` is moved by the tests instead of waiting. */
function recoveryModel() {
  const clock = { now: 1_000_000_000_000 };
  const rows = new Map<string, { hash: string | null; expires: number; failed: number; lastFailed: number; lastSent: number | null; count: number }>();
  const accounts: Record<RecoveryRole, { id: string; auth: string; sub: string }[]> = { passenger: [PAX], driver: [DRV] };
  const key = (role: string, phone: string) => `${role}:${String(phone).replace(/\D/g, '').slice(-10)}`;
  const row = (k: string) => { let r = rows.get(k); if (!r) { r = { hash: null, expires: 0, failed: 0, lastFailed: 0, lastSent: null, count: 0 }; rows.set(k, r); } return r; };
  const locked = (r: ReturnType<typeof row>) => r.failed >= 5 && clock.now - r.lastFailed < 15 * 60_000;
  const log: string[] = [];
  const rpc = {
    find_recovery_account: (a: any) => {
      log.push('find');
      const sub = String(a.p_phone).replace(/\D/g, '').slice(-10);
      const acc = (accounts[a.p_role as RecoveryRole] ?? []).find((x) => x.sub === sub);
      return { data: acc ? { found: true, account_id: acc.id, auth_user_id: acc.auth, account_status: 'Active' } : { found: false } };
    },
    reserve_password_reset_code: (a: any) => {
      log.push('reserve');
      const r = row(key(a.p_role, a.p_phone));
      if (locked(r)) return { data: { allowed: false, reason: 'locked', minutes_remaining: 9.5 } };
      if (r.lastSent !== null && clock.now - r.lastSent < 30_000) return { data: { allowed: false, reason: 'cooldown', wait_seconds: Math.ceil((30_000 - (clock.now - r.lastSent)) / 1000) } };
      if (r.count >= 5) return { data: { allowed: false, reason: 'daily' } };
      r.lastSent = clock.now; r.count += 1;
      if (a.p_code_hash) { r.hash = a.p_code_hash; r.expires = clock.now + 5 * 60_000; r.failed = 0; }
      return { data: { allowed: true } };
    },
    release_password_reset_code: (a: any) => {
      log.push('release');
      const r = row(key(a.p_role, a.p_phone)); r.lastSent = null; r.count = Math.max(0, r.count - 1); r.hash = null;
      return { data: null };
    },
    verify_password_reset_code: (a: any) => {
      log.push('verify');
      const r = rows.get(key(a.p_role, a.p_phone));
      if (!r) return { data: { ok: false, reason: 'not_found' } };
      if (locked(r)) return { data: { ok: false, reason: 'locked', minutes_remaining: 9.5 } };
      if (!r.hash) return { data: { ok: false, reason: 'not_found' } };
      if (clock.now > r.expires) { r.hash = null; return { data: { ok: false, reason: 'expired' } }; }
      if (r.hash === a.p_code_hash) { r.hash = null; r.failed = 0; return { data: { ok: true } }; }
      r.failed += 1; r.lastFailed = clock.now;
      if (r.failed >= 5) { r.hash = null; return { data: { ok: false, reason: 'locked', minutes_remaining: 15 } }; }
      return { data: { ok: false, reason: 'wrong', attempts_left: 5 - r.failed } };
    },
    finish_password_reset: () => { log.push('finish'); return { data: { app_session_replaced: true, auth_sessions_deleted: 1 } }; },
  };
  return { clock, rows, rpc, log, accounts, key };
}

function fakeSms() {
  const state = { sent: [] as { phone: string; code: string }[], notices: [] as { phone: string; text: string }[], failNext: false };
  return {
    state,
    impl: {
      sendRecoveryCode: async (phone: string, code: string) => {
        if (state.failNext) { state.failNext = false; return { success: false, error: 'Hindi maipadala ang SMS.' }; }
        state.sent.push({ phone, code });
        return { success: true };
      },
      sendNotice: async (phone: string, text: string) => { state.notices.push({ phone, text }); return { success: true }; },
    },
  };
}

async function setup(opts: { adminUpdate?: (id: string, a: any) => { message: string; status?: number } | null; rpcOverride?: Record<string, (a: any) => any> } = {}) {
  const model = recoveryModel();
  const db = fakeSupabase({ rpc: { ...model.rpc, ...(opts.rpcOverride ?? {}) } as any, adminUpdate: opts.adminUpdate });
  const sms = fakeSms();
  const app = express();
  app.use(express.json());
  app.use('/pr', createPasswordResetRouter({ supabase: db as any, sms: sms.impl, makeCode: () => CODE }));
  const srv = await listen(app);
  const post = (path: string, body: unknown) => quiet(() => call(`${srv.url}/pr/${path}`, { method: 'POST', body }));
  return { model, db, sms, srv, post };
}

describe('asking for a code', () => {
  it('texts a code to the number of an existing account, and stores only its hash bound to the app and the number', async () => {
    const t = await setup();
    try {
      const r = await t.post('request', { role: 'passenger', phone: PAX.phone });
      assert.equal(r.status, 200);
      assert.equal(r.json.success, true);
      assert.deepEqual(t.sms.state.sent, [{ phone: '+639170000001', code: CODE }]);
      const reserve = t.db.calls.rpc.find((c) => c.name === 'reserve_password_reset_code')!;
      assert.equal(reserve.args.p_code_hash, hashRecoveryCode('passenger', '+639170000001', CODE));
      assert.notEqual(reserve.args.p_code_hash, CODE);
      assert.notEqual(hashRecoveryCode('driver', '+639170000001', CODE), reserve.args.p_code_hash, 'the same code hashes differently for the other app');
      assert.notEqual(hashRecoveryCode('passenger', '+639170000002', CODE), reserve.args.p_code_hash, 'and for another number');
    } finally { await t.srv.close(); }
  });

  it('gives exactly the same answer for a number with no account, and sends nothing to it', async () => {
    const t = await setup();
    try {
      const real = await t.post('request', { role: 'passenger', phone: PAX.phone });
      const none = await t.post('request', { role: 'passenger', phone: STRANGER });
      assert.equal(none.status, real.status);
      assert.deepEqual(none.json, real.json);
      assert.equal(t.sms.state.sent.length, 1, 'only the real account got a text');
      const reserves = t.db.calls.rpc.filter((c) => c.name === 'reserve_password_reset_code');
      assert.equal(reserves[1].args.p_code_hash, null, 'no code is stored for it');
      // the limits apply to it in the same way
      const again = await t.post('request', { role: 'passenger', phone: STRANGER });
      const againReal = await t.post('request', { role: 'passenger', phone: PAX.phone });
      assert.equal(again.status, 429);
      assert.equal(againReal.status, 429);
      assert.deepEqual(Object.keys(again.json).sort(), Object.keys(againReal.json).sort());
    } finally { await t.srv.close(); }
  });

  it('each app recovers its own accounts: a passenger\'s number asked for as a driver gets no text', async () => {
    const t = await setup();
    try {
      const r = await t.post('request', { role: 'driver', phone: PAX.phone });
      assert.equal(r.status, 200);
      assert.equal(t.sms.state.sent.length, 0);
    } finally { await t.srv.close(); }
  });

  it('refuses a body that is not an app and a Philippine mobile number, before touching the database', async () => {
    const t = await setup();
    try {
      for (const body of [{}, { phone: PAX.phone }, { role: 'lgu', phone: PAX.phone }, { role: 'passenger' }, { role: 'passenger', phone: '12345' }, { role: 'passenger', phone: 91700000010000 }, { role: 'passenger', phone: '9'.repeat(40) }]) {
        const r = await t.post('request', body);
        assert.equal(r.status, 400, JSON.stringify(body));
      }
      assert.equal(t.db.calls.rpc.length, 0);
      assert.equal(t.sms.state.sent.length, 0);
    } finally { await t.srv.close(); }
  });

  it('keeps the 30-second gap and the five-a-day limit, and says how long to wait', async () => {
    const t = await setup();
    try {
      assert.equal((await t.post('request', { role: 'passenger', phone: PAX.phone })).status, 200);
      const wait = await t.post('request', { role: 'passenger', phone: PAX.phone });
      assert.equal(wait.status, 429);
      assert.ok(wait.json.cooldown_remaining_seconds >= 1 && wait.json.cooldown_remaining_seconds <= 30);
      for (let i = 0; i < 4; i++) { t.model.clock.now += 31_000; assert.equal((await t.post('request', { role: 'passenger', phone: PAX.phone })).status, 200); }
      t.model.clock.now += 31_000;
      const daily = await t.post('request', { role: 'passenger', phone: PAX.phone });
      assert.equal(daily.status, 429);
      assert.equal(daily.json.daily_cap_reached, true);
      assert.equal(t.sms.state.sent.length, 5);
    } finally { await t.srv.close(); }
  });

  it('when the SMS gateway fails it says so and gives the send back, so she can ask again at once', async () => {
    const t = await setup();
    try {
      t.sms.state.failNext = true;
      const failed = await t.post('request', { role: 'passenger', phone: PAX.phone });
      assert.equal(failed.status, 502);
      assert.ok(t.db.calls.rpc.some((c) => c.name === 'release_password_reset_code'));
      const retry = await t.post('request', { role: 'passenger', phone: PAX.phone });
      assert.equal(retry.status, 200, 'no 30-second wait after a failure that was not her doing');
      assert.equal(t.sms.state.sent.length, 1);
    } finally { await t.srv.close(); }
  });

  it('a locked number cannot get a new code', async () => {
    const t = await setup();
    try {
      await t.post('request', { role: 'passenger', phone: PAX.phone });
      for (let i = 0; i < 5; i++) await t.post('confirm', { role: 'passenger', phone: PAX.phone, code: '000000', new_password: GOOD });
      t.model.clock.now += 31_000;
      const r = await t.post('request', { role: 'passenger', phone: PAX.phone });
      assert.equal(r.status, 429);
      assert.equal(r.json.is_locked, true);
      assert.ok(r.json.minutes_remaining > 0);
    } finally { await t.srv.close(); }
  });

  it('answers 503 (and never "sent") when the database cannot decide', async () => {
    const t = await setup({ rpcOverride: { reserve_password_reset_code: () => ({ error: { message: 'connection refused' } }) } });
    try {
      const r = await t.post('request', { role: 'passenger', phone: PAX.phone });
      assert.equal(r.status, 503);
      assert.equal(t.sms.state.sent.length, 0);
      const saved = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const prod = await t.post('request', { role: 'passenger', phone: PAX.phone });
        assert.equal(prod.status, 503);
        assert.ok(!/connection refused|development detail/.test(prod.text), 'a database message does not reach the browser in production');
      } finally { process.env.NODE_ENV = saved; }
    } finally { await t.srv.close(); }
  });
});

describe('changing the password', () => {
  async function asked(t: Awaited<ReturnType<typeof setup>>, role: RecoveryRole = 'passenger', phone = PAX.phone) {
    const r = await t.post('request', { role, phone });
    assert.equal(r.status, 200);
  }

  it('with the right code and a strong password it sets the password on THE account that owns the number, and ends its older logins', async () => {
    const t = await setup();
    try {
      await asked(t);
      const r = await t.post('confirm', { role: 'passenger', phone: PAX.phone, code: CODE, new_password: GOOD });
      assert.equal(r.status, 200);
      assert.equal(r.json.success, true);
      assert.deepEqual(t.db.calls.adminUpdates, [{ userId: PAX.auth, attributes: { password: GOOD } }]);
      const finish = t.db.calls.rpc.find((c) => c.name === 'finish_password_reset')!;
      assert.deepEqual(finish.args, { p_role: 'passenger', p_account_id: PAX.id });
      assert.equal(t.sms.state.notices.length, 1, 'the owner is told by text that the password changed');
      assert.equal(t.sms.state.notices[0].phone, '+639170000001');
      assert.ok(!t.sms.state.notices[0].text.includes(CODE) && !t.sms.state.notices[0].text.includes(GOOD));
    } finally { await t.srv.close(); }
  });

  it('works for a driver, on the driver\'s own login', async () => {
    const t = await setup();
    try {
      await asked(t, 'driver', DRV.phone);
      const r = await t.post('confirm', { role: 'driver', phone: DRV.phone, code: CODE, new_password: GOOD });
      assert.equal(r.status, 200);
      assert.deepEqual(t.db.calls.adminUpdates, [{ userId: DRV.auth, attributes: { password: GOOD } }]);
    } finally { await t.srv.close(); }
  });

  it('a code works once', async () => {
    const t = await setup();
    try {
      await asked(t);
      assert.equal((await t.post('confirm', { role: 'passenger', phone: PAX.phone, code: CODE, new_password: GOOD })).status, 200);
      const again = await t.post('confirm', { role: 'passenger', phone: PAX.phone, code: CODE, new_password: 'Another#Pass9' });
      assert.equal(again.status, 400);
      assert.equal(again.json.code_expired, true);
      assert.equal(t.db.calls.adminUpdates.length, 1);
    } finally { await t.srv.close(); }
  });

  it('a weak password is refused BEFORE the code is looked at: the code is not used up and no try is counted', async () => {
    const t = await setup();
    try {
      await asked(t);
      for (const weak of ['Sh0rt#1', 'alllowercase1#', 'ALLUPPERCASE1#', 'NoDigitsHere#', 'NoSymbol12345', '', 'A1#a', `Aa1#${'x'.repeat(80)}`]) {
        const r = await t.post('confirm', { role: 'passenger', phone: PAX.phone, code: CODE, new_password: weak });
        assert.equal(r.status, 400, weak);
        assert.equal(r.json.weak_password, true, weak);
      }
      assert.equal(t.db.calls.rpc.filter((c) => c.name === 'verify_password_reset_code').length, 0);
      const ok = await t.post('confirm', { role: 'passenger', phone: PAX.phone, code: CODE, new_password: GOOD });
      assert.equal(ok.status, 200, 'the same code still works');
    } finally { await t.srv.close(); }
  });

  it('a wrong code says how many tries are left; the fifth locks the number, and then even the right code is refused', async () => {
    const t = await setup();
    try {
      await asked(t);
      const first = await t.post('confirm', { role: 'passenger', phone: PAX.phone, code: '111111', new_password: GOOD });
      assert.equal(first.status, 400);
      assert.equal(first.json.attempts_left, 4);
      for (let i = 0; i < 3; i++) await t.post('confirm', { role: 'passenger', phone: PAX.phone, code: '111111', new_password: GOOD });
      const fifth = await t.post('confirm', { role: 'passenger', phone: PAX.phone, code: '111111', new_password: GOOD });
      assert.equal(fifth.status, 429);
      assert.equal(fifth.json.is_locked, true);
      const right = await t.post('confirm', { role: 'passenger', phone: PAX.phone, code: CODE, new_password: GOOD });
      assert.equal(right.status, 429);
      assert.equal(t.db.calls.adminUpdates.length, 0, 'no password was set');
    } finally { await t.srv.close(); }
  });

  it('a code is no use for the other app, or for another number', async () => {
    const t = await setup();
    try {
      await asked(t);
      const otherApp = await t.post('confirm', { role: 'driver', phone: PAX.phone, code: CODE, new_password: GOOD });
      assert.equal(otherApp.status, 400);
      const otherNumber = await t.post('confirm', { role: 'passenger', phone: STRANGER, code: CODE, new_password: GOOD });
      assert.equal(otherNumber.status, 400);
      assert.equal(t.db.calls.adminUpdates.length, 0);
    } finally { await t.srv.close(); }
  });

  it('an expired code is refused as expired, not as a wrong guess', async () => {
    const t = await setup();
    try {
      await asked(t);
      t.model.clock.now += 5 * 60_000 + 1000;
      const r = await t.post('confirm', { role: 'passenger', phone: PAX.phone, code: CODE, new_password: GOOD });
      assert.equal(r.status, 400);
      assert.equal(r.json.code_expired, true);
      assert.equal(r.json.attempts_left, undefined);
    } finally { await t.srv.close(); }
  });

  it('a code that is not six digits is refused without counting', async () => {
    const t = await setup();
    try {
      await asked(t);
      for (const code of ['12345', '1234567', 'abcdef', '', null, 123456]) {
        const r = await t.post('confirm', { role: 'passenger', phone: PAX.phone, code, new_password: GOOD });
        assert.equal(r.status, 400, String(code));
      }
      assert.equal(t.db.calls.rpc.filter((c) => c.name === 'verify_password_reset_code').length, 0);
    } finally { await t.srv.close(); }
  });

  it('if the account is gone by the time the code is accepted, no password is set', async () => {
    const t = await setup();
    try {
      await asked(t);
      t.model.accounts.passenger.length = 0;
      const r = await t.post('confirm', { role: 'passenger', phone: PAX.phone, code: CODE, new_password: GOOD });
      assert.equal(r.status, 400);
      assert.equal(t.db.calls.adminUpdates.length, 0);
    } finally { await t.srv.close(); }
  });

  it('if the login system refuses the password the person is told which; if it fails, to ask for a new code; older logins are NOT ended for a change that did not happen', async () => {
    for (const [status, expect] of [[422, 400], [500, 502]] as const) {
      const t = await setup({ adminUpdate: () => ({ message: 'nope', status }) });
      try {
        await asked(t);
        const r = await t.post('confirm', { role: 'passenger', phone: PAX.phone, code: CODE, new_password: GOOD });
        assert.equal(r.status, expect);
        assert.equal(t.db.calls.rpc.filter((c) => c.name === 'finish_password_reset').length, 0);
        assert.equal(t.sms.state.notices.length, 0);
      } finally { await t.srv.close(); }
    }
  });

  it('a failure to end the older logins does not undo the password change', async () => {
    const t = await setup({ rpcOverride: { finish_password_reset: () => ({ error: { message: 'boom' } }) } });
    try {
      await asked(t);
      const r = await t.post('confirm', { role: 'passenger', phone: PAX.phone, code: CODE, new_password: GOOD });
      assert.equal(r.status, 200);
      assert.equal(t.db.calls.adminUpdates.length, 1);
    } finally { await t.srv.close(); }
  });
});

describe('what never leaves', () => {
  it('neither the code nor the password is in any response or any log line, and responses are not cacheable', async () => {
    const t = await setup();
    const lines: string[] = [];
    const saved = { log: console.log, warn: console.warn, error: console.error };
    console.log = (...a: unknown[]) => lines.push(a.join(' '));
    console.warn = (...a: unknown[]) => lines.push(a.join(' '));
    console.error = (...a: unknown[]) => lines.push(a.join(' '));
    try {
      const responses = [
        await call(`${t.srv.url}/pr/request`, { method: 'POST', body: { role: 'passenger', phone: PAX.phone } }),
        await call(`${t.srv.url}/pr/confirm`, { method: 'POST', body: { role: 'passenger', phone: PAX.phone, code: '111111', new_password: GOOD } }),
        await call(`${t.srv.url}/pr/confirm`, { method: 'POST', body: { role: 'passenger', phone: PAX.phone, code: CODE, new_password: GOOD } }),
      ];
      for (const r of responses) {
        assert.ok(!r.text.includes(CODE) && !r.text.includes(GOOD) && !r.text.includes(PAX.phone) && !r.text.includes(PAX.auth), r.text);
        assert.match(r.headers.get('cache-control') ?? '', /no-store/);
      }
    } finally { console.log = saved.log; console.warn = saved.warn; console.error = saved.error; await t.srv.close(); }
    const all = lines.join('\n');
    assert.ok(!all.includes(CODE) && !all.includes(GOOD) && !all.includes(PAX.phone) && !all.includes('09170000001'), all);
    assert.ok(/password was reset/.test(all), 'the event itself is logged (with the masked number)');
  });
});

describe('the password rule is the same one the screens show', () => {
  it('the server\'s check and the shared check agree on every sample', () => {
    const samples = ['', 'a', 'Abcdef1#', 'abcdef1#', 'ABCDEF1#', 'Abcdefgh#', 'Abcdefg1', 'Abc1#', GOOD, 'Mabuhay Ka 2026!', 'Pässwörd#1', `Aa1#${'x'.repeat(68)}`, `Aa1#${'x'.repeat(69)}`, 'Aa1#' + 'ñ'.repeat(40)];
    for (const s of samples) {
      const a = checkPassword(s);
      const b = sharedCheckPassword(s);
      assert.deepEqual({ length: a.length, letters: a.letters, digit: a.digit, symbol: a.symbol, tooLong: a.tooLong, ok: a.ok }, { length: b.length, letters: b.letters, digit: b.digit, symbol: b.symbol, tooLong: b.tooLong, ok: b.ok }, JSON.stringify(s));
    }
  });
});

describe('in the assembled app', () => {
  let srv: Awaited<ReturnType<typeof listen>>;
  before(async () => { srv = await listen(createApp({ auth: createAuth({ supabase: fakeSupabase() as any }), env: { NODE_ENV: 'test' } })); });
  after(async () => { await srv.close(); });

  it('needs no sign-in (a person who forgot the password has none): a bad body is a 400 from the route, not a 401', async () => {
    for (const path of ['request', 'confirm']) {
      const r = await call(`${srv.url}/api/password-reset/${path}`, { method: 'POST', body: {} });
      assert.equal(r.status, 400, path);
    }
  });

  it('refuses a body over 4 kB before reading it', async () => {
    const r = await quiet(() => call(`${srv.url}/api/password-reset/request`, { rawBody: JSON.stringify({ role: 'passenger', phone: '0917', pad: 'a'.repeat(6000) }) }));
    assert.equal(r.status, 413);
  });

  it('is limited per address: the eleventh request in ten minutes is refused', async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await call(`${srv.url}/api/password-reset/request`, { method: 'POST', body: {} })).status;
    assert.equal(last, 429);
  });

  it('opens nothing else: the rest of /api still needs a token', async () => {
    assert.equal((await call(`${srv.url}/api/auth/send-otp`, { method: 'POST', body: {} })).status, 401);
    assert.equal((await call(`${srv.url}/api/password-reset/other`, { method: 'POST', body: {} })).status, 401, 'an unknown path under it falls through to the sign-in check');
  });
});
