// OTP routes and the SMS relay, with a fake database and a fake SMS gateway. Account, role and phone checks are real middleware.
import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAuth } from '../src/middleware/auth';
import { OTP_DAILY_CAP, calcAge, createAuthRouter } from '../src/routes/authRoutes';
import { createCommunicationRouter } from '../src/routes/communicationRoutes';
import { createDriverNotifyRouter, createTodaDriverNotifyRouter } from '../src/routes/driverNotifyRoutes';
import { _clearOtpStore, sendOtpSms, verifyOtpCode } from '../src/services/smsService';
import { isPhMobile, maskPhone, normalizePhone, samePhone, subscriberOf } from '../src/utils/phone';
import { call, fakeJwt, fakeSupabase, listen, quiet, uuid } from './helpers';

const PAX = { user: uuid(1), id: uuid(11), phone: '+639171111111' };
const PAX2 = { user: uuid(2), id: uuid(12), phone: '+639172222222' };
const DRV = { user: uuid(3), id: uuid(13), phone: '+639173333333' };
const DRV2 = { user: uuid(4), id: uuid(14), phone: '+639174444444' };
const NOBODY = { user: uuid(5) };
const tokens = { pax: fakeJwt(), pax2: fakeJwt(), drv: fakeJwt(), drv2: fakeJwt(), nobody: fakeJwt() };

function world(over: { paxStatus?: string; paxDob?: string | null; drvStatus?: string; lockout?: any; failLockout?: boolean } = {}) {
  const db = fakeSupabase({
    users: { [tokens.pax]: { id: PAX.user }, [tokens.pax2]: { id: PAX2.user }, [tokens.drv]: { id: DRV.user }, [tokens.drv2]: { id: DRV2.user }, [tokens.nobody]: { id: NOBODY.user } },
    tables: {
      passenger: [
        { auth_user_id: PAX.user, passenger_id: PAX.id, account_status: over.paxStatus ?? 'Pending OTP Verification', contact_number: PAX.phone, date_of_birth: over.paxDob ?? '2000-01-01', otp_last_sent_at: null, otp_daily_count: 0, otp_daily_reset_at: null },
        { auth_user_id: PAX2.user, passenger_id: PAX2.id, account_status: 'Pending OTP Verification', contact_number: PAX2.phone, date_of_birth: '2000-01-01', otp_last_sent_at: null, otp_daily_count: 0, otp_daily_reset_at: null },
      ],
      driver: [
        { auth_user_id: DRV.user, driver_id: DRV.id, account_status: over.drvStatus ?? 'Verified', contact_number: DRV.phone, toda_id: null, full_name: 'Juan Dela Cruz' },
        { auth_user_id: DRV2.user, driver_id: DRV2.id, account_status: 'Verified', contact_number: DRV2.phone, toda_id: null, full_name: 'Other Driver' },
      ],
      lgu_admin: [], toda_admin: [], booking: [],
    },
    rpc: {
      check_otp_lockout: () => (over.failLockout ? { error: { message: 'boom' } } : { data: typeof over.lockout === 'function' ? over.lockout() : (over.lockout ?? { is_locked: false, minutes_remaining: 0 }) }),
      increment_failed_otp: () => ({ data: true }),
      reset_failed_otp: () => ({ data: true }),
    },
  });
  return db;
}

function fakeSms() {
  const sent: string[] = [];
  const verdicts: ('ok' | 'wrong')[] = [];
  return {
    sent, verdicts,
    impl: {
      sendOtpSms: async (phone: string) => { sent.push(phone); return { success: true, message: 'sent', formattedPhone: phone }; },
      verifyOtpCode: (_phone: string, code: string) => (code === '246810' ? { success: true as const } : { success: false as const, reason: 'wrong' as const, error: 'Incorrect OTP code. Please try again.' }),
    },
  };
}

async function otpApp(db: ReturnType<typeof fakeSupabase>, sms = fakeSms(), now?: () => Date) {
  const auth = createAuth({ supabase: db as any });
  const app = express();
  app.use(express.json());
  app.use('/otp', auth.requireAuth, auth.attachActor, createAuthRouter({ supabase: db as any, sms: sms.impl as any, now }));
  const srv = await listen(app);
  return { srv, sms, db };
}

describe('POST /otp/send-otp', () => {
  it('sends a code to the passenger\'s own number, and counts it', async () => {
    const db = world();
    const { srv, sms } = await otpApp(db);
    try {
      const r = await call(`${srv.url}/otp/send-otp`, { token: tokens.pax, body: { phone: '09171111111' } });
      assert.equal(r.status, 200);
      assert.deepEqual(sms.sent, ['+639171111111']);
      const row = db.tables.passenger[0];
      assert.equal(row.otp_daily_count, 1);
      assert.ok(row.otp_last_sent_at);
    } finally { await srv.close(); }
  });

  it('a new code starts with a clean failure count (the wrong entries against the old code do not carry over)', async () => {
    const db = world();
    const { srv } = await otpApp(db);
    try {
      const r = await call(`${srv.url}/otp/send-otp`, { token: tokens.pax, body: { phone: PAX.phone } });
      assert.equal(r.status, 200);
      assert.deepEqual(db.calls.rpc.filter((c) => c.name === 'reset_failed_otp').map((c) => c.args), [{ p_passenger_id: PAX.id }]);
    } finally { await srv.close(); }
  });

  it('a lock that is still running is refused with the time left, and asking for a code does not clear it', async () => {
    const db = world({ lockout: { is_locked: true, minutes_remaining: 11.5 } });
    const { srv, sms } = await otpApp(db);
    try {
      const r = await call(`${srv.url}/otp/send-otp`, { token: tokens.pax, body: { phone: PAX.phone } });
      assert.equal(r.status, 429);
      assert.equal(r.json.is_locked, true);
      assert.equal(r.json.minutes_remaining, 11.5);
      assert.deepEqual(sms.sent, []);
      assert.equal(db.calls.rpc.filter((c) => c.name === 'reset_failed_otp').length, 0, 'the lock stays');
    } finally { await srv.close(); }
  });

  it('a failed SMS does not clear the count and is not counted as a send', async () => {
    const db = world();
    const sms = fakeSms();
    sms.impl.sendOtpSms = async (phone: string) => ({ success: false as any, error: 'gateway down', formattedPhone: phone } as any);
    const { srv } = await otpApp(db, sms);
    try {
      const r = await call(`${srv.url}/otp/send-otp`, { token: tokens.pax, body: { phone: PAX.phone } });
      assert.equal(r.status, 502);
      assert.equal(db.calls.rpc.filter((c) => c.name === 'reset_failed_otp').length, 0);
      assert.equal(db.tables.passenger[0].otp_daily_count, 0);
    } finally { await srv.close(); }
  });

  it('refuses a number that is not the caller\'s own, so a signed-in user cannot have codes sent to somebody else', async () => {
    const { srv, sms } = await otpApp(world());
    try {
      const r = await call(`${srv.url}/otp/send-otp`, { token: tokens.pax, body: { phone: PAX2.phone } });
      assert.equal(r.status, 403);
      assert.deepEqual(sms.sent, []);
    } finally { await srv.close(); }
  });

  it('refuses an account that has no passenger or driver record', async () => {
    const { srv, sms } = await otpApp(world());
    try {
      const r = await call(`${srv.url}/otp/send-otp`, { token: tokens.nobody, body: { phone: '+639175555555' } });
      assert.equal(r.status, 403);
      assert.deepEqual(sms.sent, []);
    } finally { await srv.close(); }
  });

  it('refuses a number that is not a Philippine mobile number', async () => {
    const { srv } = await otpApp(world());
    try {
      for (const phone of ['', '123', '+639', 'abc', 123, null]) assert.equal((await call(`${srv.url}/otp/send-otp`, { token: tokens.pax, body: { phone } })).status, 400);
    } finally { await srv.close(); }
  });

  it('a body that names another account is ignored: the caller\'s own record decides', async () => {
    const { srv, sms } = await otpApp(world());
    try {
      const r = await call(`${srv.url}/otp/send-otp`, { token: tokens.pax, body: { phone: PAX2.phone, auth_user_id: PAX2.user, userId: PAX2.user, passenger_id: PAX2.id } });
      assert.equal(r.status, 403);
      assert.deepEqual(sms.sent, []);
    } finally { await srv.close(); }
  });

  it('a locked-out passenger gets 429 and no SMS', async () => {
    const { srv, sms } = await otpApp(world({ lockout: { is_locked: true, minutes_remaining: 12 } }));
    try {
      const r = await call(`${srv.url}/otp/send-otp`, { token: tokens.pax, body: { phone: PAX.phone } });
      assert.equal(r.status, 429);
      assert.equal(r.json.is_locked, true);
      assert.deepEqual(sms.sent, []);
    } finally { await srv.close(); }
  });

  it('FAILS CLOSED when the lockout cannot be checked: 503 and no SMS', async () => {
    const { srv, sms } = await otpApp(world({ failLockout: true }));
    try {
      const r = await quiet(() => call(`${srv.url}/otp/send-otp`, { token: tokens.pax, body: { phone: PAX.phone } }));
      assert.equal(r.status, 503);
      assert.deepEqual(sms.sent, []);
    } finally { await srv.close(); }
  });

  it('enforces the 30-second cooldown and the 5-per-day cap', async () => {
    const db = world();
    let t = new Date('2026-10-10T08:00:00Z');
    const { srv, sms } = await otpApp(db, fakeSms(), () => t);
    try {
      assert.equal((await call(`${srv.url}/otp/send-otp`, { token: tokens.pax, body: { phone: PAX.phone } })).status, 200);
      t = new Date(t.getTime() + 10_000);
      const cool = await call(`${srv.url}/otp/send-otp`, { token: tokens.pax, body: { phone: PAX.phone } });
      assert.equal(cool.status, 429);
      assert.ok(cool.json.cooldown_remaining_seconds > 0);
      for (let i = 1; i < OTP_DAILY_CAP; i++) {
        t = new Date(t.getTime() + 31_000);
        assert.equal((await call(`${srv.url}/otp/send-otp`, { token: tokens.pax, body: { phone: PAX.phone } })).status, 200, `send ${i + 1}`);
      }
      t = new Date(t.getTime() + 31_000);
      const capped = await call(`${srv.url}/otp/send-otp`, { token: tokens.pax, body: { phone: PAX.phone } });
      assert.equal(capped.status, 429);
      assert.equal(capped.json.daily_cap_reached, true);
      assert.equal(sms.sent.length, OTP_DAILY_CAP);
      t = new Date(t.getTime() + 24 * 3600 * 1000);                     // next day
      assert.equal((await call(`${srv.url}/otp/send-otp`, { token: tokens.pax, body: { phone: PAX.phone } })).status, 200);
    } finally { await srv.close(); }
  });

  it('drivers get the same cooldown and daily cap (kept in memory)', async () => {
    let t = new Date('2026-10-10T08:00:00Z');
    const { srv, sms } = await otpApp(world(), fakeSms(), () => t);
    try {
      assert.equal((await call(`${srv.url}/otp/send-otp`, { token: tokens.drv, body: { phone: DRV.phone, role: 'driver' } })).status, 200);
      assert.equal((await call(`${srv.url}/otp/send-otp`, { token: tokens.drv, body: { phone: DRV.phone, role: 'driver' } })).status, 429);
      for (let i = 1; i < OTP_DAILY_CAP; i++) { t = new Date(t.getTime() + 31_000); assert.equal((await call(`${srv.url}/otp/send-otp`, { token: tokens.drv, body: { phone: DRV.phone, role: 'driver' } })).status, 200); }
      t = new Date(t.getTime() + 31_000);
      assert.equal((await call(`${srv.url}/otp/send-otp`, { token: tokens.drv, body: { phone: DRV.phone, role: 'driver' } })).status, 429);
      assert.equal(sms.sent.length, OTP_DAILY_CAP);
    } finally { await srv.close(); }
  });

  it('a gateway failure is a 502 and is not counted against the daily cap', async () => {
    const db = world();
    const sms = fakeSms();
    sms.impl.sendOtpSms = async (phone: string) => ({ success: false, error: 'gateway down', formattedPhone: phone } as any);
    const { srv } = await otpApp(db, sms);
    try {
      const r = await call(`${srv.url}/otp/send-otp`, { token: tokens.pax, body: { phone: PAX.phone } });
      assert.equal(r.status, 502);
      assert.equal(db.tables.passenger[0].otp_daily_count, 0);
    } finally { await srv.close(); }
  });

  it('a suspended passenger cannot ask for a code', async () => {
    const { srv, sms } = await otpApp(world({ paxStatus: 'Suspended' }));
    try {
      assert.equal((await call(`${srv.url}/otp/send-otp`, { token: tokens.pax, body: { phone: PAX.phone } })).status, 403);
      assert.deepEqual(sms.sent, []);
    } finally { await srv.close(); }
  });
});

describe('POST /otp/verify-otp', () => {
  it('a correct code activates THIS passenger only, with the service role, and resets the failure counter', async () => {
    const db = world();
    const { srv } = await otpApp(db);
    try {
      const r = await call(`${srv.url}/otp/verify-otp`, { token: tokens.pax, body: { phone: PAX.phone, code: '246810' } });
      assert.equal(r.status, 200);
      assert.equal(db.tables.passenger[0].account_status, 'Active');
      assert.equal(db.tables.passenger[1].account_status, 'Pending OTP Verification', 'the other passenger is untouched');
      assert.deepEqual(db.calls.updates.map((u) => u.filters), [[['passenger_id', PAX.id]]]);
      assert.ok(db.calls.rpc.some((c) => c.name === 'reset_failed_otp' && c.args.p_passenger_id === PAX.id));
    } finally { await srv.close(); }
  });

  it('a wrong code does not activate, and the failure is counted on the caller\'s own record', async () => {
    const db = world();
    const { srv } = await otpApp(db);
    try {
      const r = await call(`${srv.url}/otp/verify-otp`, { token: tokens.pax, body: { phone: PAX.phone, code: '123456' } });
      assert.equal(r.status, 400);
      assert.equal(db.tables.passenger[0].account_status, 'Pending OTP Verification');
      assert.deepEqual(db.calls.rpc.filter((c) => c.name === 'increment_failed_otp').map((c) => c.args), [{ p_passenger_id: PAX.id }]);
    } finally { await srv.close(); }
  });

  it('the wrong code that makes five answers "locked" with the time left, so the app can show the countdown', async () => {
    let calls = 0;
    // the check before the code is looked at: open; the check after this wrong guess was counted: locked for 15 minutes
    const db = world({ lockout: () => (++calls === 1 ? { is_locked: false, minutes_remaining: 0 } : { is_locked: true, minutes_remaining: 15 }) });
    const { srv } = await otpApp(db);
    try {
      const r = await call(`${srv.url}/otp/verify-otp`, { token: tokens.pax, body: { phone: PAX.phone, code: '123456' } });
      assert.equal(r.status, 429);
      assert.equal(r.json.is_locked, true);
      assert.equal(r.json.minutes_remaining, 15);
      assert.equal(db.tables.passenger[0].account_status, 'Pending OTP Verification');
    } finally { await srv.close(); }
  });

  it('"no code was issued" and "the code expired" are not guesses: they are not counted towards the lock', async () => {
    for (const reason of ['not_found', 'expired'] as const) {
      const db = world();
      const sms = fakeSms();
      sms.impl.verifyOtpCode = () => ({ success: false as const, reason, error: 'OTP expired or not found. Please request a new code.' }) as any;
      const { srv } = await otpApp(db, sms);
      try {
        const r = await call(`${srv.url}/otp/verify-otp`, { token: tokens.pax, body: { phone: PAX.phone, code: '123456' } });
        assert.equal(r.status, 400, reason);
        assert.equal(db.calls.rpc.filter((c) => c.name === 'increment_failed_otp').length, 0, reason);
      } finally { await srv.close(); }
    }
  });

  it('123456 is not a master code: with nothing issued it is simply refused', async () => {
    _clearOtpStore();
    const db = world();
    const auth = createAuth({ supabase: db as any });
    const app = express();
    app.use(express.json());
    app.use('/otp', auth.requireAuth, auth.attachActor, createAuthRouter({ supabase: db as any, sms: { sendOtpSms, verifyOtpCode } }));
    const srv = await listen(app);
    try {
      for (const code of ['123456', '654321', '000000', '111111']) {
        const r = await quiet(() => call(`${srv.url}/otp/verify-otp`, { token: tokens.pax, body: { phone: PAX.phone, code } }));
        assert.equal(r.status, 400, code);
      }
      assert.equal(db.tables.passenger[0].account_status, 'Pending OTP Verification');
    } finally { await srv.close(); }
  });

  it('cannot verify, or activate, somebody else\'s number', async () => {
    const db = world();
    const { srv } = await otpApp(db);
    try {
      const r = await call(`${srv.url}/otp/verify-otp`, { token: tokens.pax, body: { phone: PAX2.phone, code: '246810', auth_user_id: PAX2.user } });
      assert.equal(r.status, 403);
      assert.equal(db.tables.passenger[1].account_status, 'Pending OTP Verification');
    } finally { await srv.close(); }
  });

  it('the code must be 6 digits', async () => {
    const { srv } = await otpApp(world());
    try {
      for (const code of ['12345', '1234567', 'abcdef', '', null, 123456]) assert.equal((await call(`${srv.url}/otp/verify-otp`, { token: tokens.pax, body: { phone: PAX.phone, code } })).status, 400);
    } finally { await srv.close(); }
  });

  it('a locked-out passenger is refused BEFORE the code is checked', async () => {
    const db = world({ lockout: { is_locked: true, minutes_remaining: 9 } });
    const { srv } = await otpApp(db);
    try {
      const r = await call(`${srv.url}/otp/verify-otp`, { token: tokens.pax, body: { phone: PAX.phone, code: '246810' } });
      assert.equal(r.status, 429);
      assert.equal(db.tables.passenger[0].account_status, 'Pending OTP Verification');
    } finally { await srv.close(); }
  });

  it('refuses to activate a passenger under 12 (Rule 4.3)', async () => {
    const year = new Date().getUTCFullYear() - 8;
    const db = world({ paxDob: `${year}-06-15` });
    const { srv } = await otpApp(db);
    try {
      const r = await call(`${srv.url}/otp/verify-otp`, { token: tokens.pax, body: { phone: PAX.phone, code: '246810' } });
      assert.equal(r.status, 403);
      assert.equal(r.json.under_age, true);
      assert.equal(db.tables.passenger[0].account_status, 'Pending OTP Verification');
    } finally { await srv.close(); }
  });

  it('does not reactivate a suspended or deactivated passenger', async () => {
    for (const status of ['Suspended', 'Deactivated']) {
      const db = world({ paxStatus: status });
      const { srv } = await otpApp(db);
      try {
        const r = await call(`${srv.url}/otp/verify-otp`, { token: tokens.pax, body: { phone: PAX.phone, code: '246810' } });
        assert.equal(r.status, 403, status);
        assert.equal(db.tables.passenger[0].account_status, status);
      } finally { await srv.close(); }
    }
  });

  it('a driver\'s code is verified but nothing is activated here (drivers go through document verification)', async () => {
    const db = world();
    const { srv } = await otpApp(db);
    try {
      const r = await call(`${srv.url}/otp/verify-otp`, { token: tokens.drv, body: { phone: DRV.phone, code: '246810', role: 'driver' } });
      assert.equal(r.status, 200);
      assert.equal(db.calls.updates.length, 0);
    } finally { await srv.close(); }
  });

  it('an activation failure is reported as a failure, not as success', async () => {
    const db = world();
    (db as any).tables.passenger[0].__marker = true;
    const failing = fakeSupabase({ ...({} as any) });
    void failing;
    const bad = fakeSupabase({
      users: { [tokens.pax]: { id: PAX.user } },
      tables: { passenger: [{ auth_user_id: PAX.user, passenger_id: PAX.id, account_status: 'Pending OTP Verification', contact_number: PAX.phone, date_of_birth: '2000-01-01' }], driver: [], lgu_admin: [], toda_admin: [] },
      rpc: { check_otp_lockout: () => ({ data: { is_locked: false } }), reset_failed_otp: () => ({ data: true }), increment_failed_otp: () => ({ data: true }) },
      fail: { 'passenger:update': 'permission denied' },
    });
    const { srv } = await otpApp(bad);
    try {
      const r = await quiet(() => call(`${srv.url}/otp/verify-otp`, { token: tokens.pax, body: { phone: PAX.phone, code: '246810' } }));
      assert.equal(r.status, 500);
      assert.notEqual(r.json.success, true);
    } finally { await srv.close(); }
  });
});

describe('the SMS gateway: accepted is not sent (smsService)', () => {
  const realFetch = globalThis.fetch;
  const savedEnv = { url: process.env.SMS_GATEWAY_URL };
  let posted: { body: any }[] = [];
  /** A fake gateway: POST /message queues (202) and GET /message/<id> answers with the scripted states. */
  const gateway = (states: string[], recipientError?: string) => {
    let i = 0;
    posted = [];
    globalThis.fetch = (async (input: any, init: any) => {
      const url = String(input);
      if (init?.method === 'POST') {
        posted.push({ body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ id: 'msg-1', state: 'Pending', recipients: [{ state: 'Pending' }] }), { status: 202 });
      }
      assert.ok(url.endsWith('/message/msg-1'), url);
      const state = states[Math.min(i++, states.length - 1)];
      return new Response(JSON.stringify({ id: 'msg-1', state, recipients: [{ state, error: state === 'Failed' ? recipientError : undefined }] }), { status: 200 });
    }) as typeof fetch;
  };
  beforeEach(() => { _clearOtpStore(); process.env.SMS_GATEWAY_URL = 'http://gateway.test'; });
  after(() => { globalThis.fetch = realFetch; process.env.SMS_GATEWAY_URL = savedEnv.url ?? ''; });
  const codeSent = () => /: (\d{6})\./.exec(String(posted[0].body.message))![1];

  it('a message the phone reports as Sent succeeds, and the code that was sent is the code that works', async () => {
    gateway(['Pending', 'Processed', 'Sent']);
    const r = await quiet(() => sendOtpSms('+639171234570'));
    assert.equal(r.success, true);
    assert.equal(verifyOtpCode('+639171234570', codeSent()).success, true);
  });

  it('a message the phone reports as Failed is a FAILED request: the app is not told "sent", and no code is stored', async () => {
    gateway(['Pending', 'Failed'], 'no signal');
    const r = await quiet(() => sendOtpSms('+639171234571'));
    assert.equal(r.success, false);
    assert.ok(r.error, "the failure carries a message for the app");
    assert.equal(verifyOtpCode('+639171234571', codeSent()).success, false, 'a code that never left the phone is not valid');
  });

  it('a message still Pending after the wait is reported as queued: the code is kept (the SMS may still arrive)', async () => {
    gateway(['Pending']);
    const r = await quiet(() => sendOtpSms('+639171234572'));
    assert.equal(r.success, true);
    assert.equal(verifyOtpCode('+639171234572', codeSent()).success, true);
  });
});

describe('the real OTP store (smsService)', () => {
  beforeEach(() => _clearOtpStore());
  const capture = async (fn: () => Promise<unknown>): Promise<string> => {
    const lines: string[] = [];
    const saved = console.log;
    console.log = (...a: unknown[]) => { lines.push(a.join(' ')); };
    try { await fn(); } finally { console.log = saved; }
    return lines.join('\n');
  };
  const issue = async (phone: string): Promise<string> => {
    process.env.NODE_ENV = 'development'; process.env.OTP_DEV_ECHO = '1'; process.env.SMS_GATEWAY_URL = '';
    let out = '';
    try { out = await capture(() => sendOtpSms(phone)); } finally { process.env.NODE_ENV = 'test'; process.env.OTP_DEV_ECHO = ''; }
    const m = /is (\d{6})/.exec(out);
    assert.ok(m, `no dev echo in: ${out}`);
    return m![1];
  };
  const other = (code: string) => (code === '135790' ? '135791' : '135790');

  it('without OTP_DEV_ECHO and a gateway, no code is issued at all (nothing to guess)', async () => {
    process.env.NODE_ENV = 'development'; process.env.OTP_DEV_ECHO = '';
    const r = await quiet(() => sendOtpSms('+639171234567'));
    process.env.NODE_ENV = 'test';
    assert.equal(r.success, false);
    assert.equal(verifyOtpCode('+639171234567', '123456').success, false);
  });

  it('the dev echo refuses to run in production, even with the flag set', async () => {
    process.env.NODE_ENV = 'production'; process.env.OTP_DEV_ECHO = '1'; process.env.SMS_GATEWAY_URL = '';
    try {
      const r = await quiet(() => sendOtpSms('+639171234567'));
      assert.equal(r.success, false);
    } finally { process.env.NODE_ENV = 'test'; process.env.OTP_DEV_ECHO = ''; }
  });

  it('an issued code works once; a wrong code does not; the code is never in a log other than the dev echo', async () => {
    const code = await issue('+639171234567');
    assert.equal(verifyOtpCode('+639171234567', other(code)).success, false);
    assert.equal(verifyOtpCode('09171234567', code).success, true, 'the number may be written any way');
    assert.equal(verifyOtpCode('+639171234567', code).success, false, 'a code is consumed');
  });

  it('five wrong tries throw the code away', async () => {
    const code = await issue('+639171234568');
    for (let i = 0; i < 4; i++) assert.equal((verifyOtpCode('+639171234568', other(code)) as any).reason, 'wrong');
    assert.equal((verifyOtpCode('+639171234568', other(code)) as any).reason, 'too_many');
    assert.equal(verifyOtpCode('+639171234568', code).success, false, 'even the right code is gone');
  });

  it('a code for one number does not work for another', async () => {
    const code = await issue('+639171234569');
    assert.equal(verifyOtpCode('+639171234560', code).success, false);
  });

  it('non-numeric and wrong-length input is refused, and counts as a wrong try (the route rejects it earlier; this is the store\'s own rule)', async () => {
    const code = await issue('+639171234570');
    for (const bad of ['12345', '1234567', 'abcdef', '  ']) assert.equal(verifyOtpCode('+639171234570', bad).success, false);
    assert.equal(verifyOtpCode('+639171234570', code).success, true, 'four wrong tries are survivable');
  });
});

describe('POST /sms/send-sms (a driver texts the passenger of their live trip)', () => {
  function smsWorld(trips: { driver_id: string; passenger_id: string; booking_status: string }[], opts: { driverStatus?: string } = {}) {
    const db = world({ drvStatus: opts.driverStatus });
    db.tables.booking = trips;
    return db;
  }
  async function smsApp(db: ReturnType<typeof fakeSupabase>) {
    const sent: { phone: string; text: string }[] = [];
    const auth = createAuth({ supabase: db as any });
    const app = express();
    app.use(express.json());
    app.use('/sms', auth.requireAuth, auth.requireRole('driver'), createCommunicationRouter({
      supabase: db as any,
      sendRawSms: async (phone: string, text: string) => { sent.push({ phone, text }); return { success: true, formattedPhone: phone }; },
    }));
    return { srv: await listen(app), sent };
  }
  const live = [{ driver_id: DRV.id, passenger_id: PAX.id, booking_status: 'Accepted' }];

  it('texts the passenger of the driver\'s live trip, with the sender label taken from the driver\'s record', async () => {
    const { srv, sent } = await smsApp(smsWorld(live));
    try {
      const r = await call(`${srv.url}/sms/send-sms`, { token: tokens.drv, body: { phone: PAX.phone, message: 'I am at the gate', senderName: 'SPOOFED', senderRole: 'passenger' } });
      assert.equal(r.status, 200);
      assert.deepEqual(sent, [{ phone: PAX.phone, text: '[SAKAY Driver Juan Dela Cruz]: I am at the gate' }]);
    } finally { await srv.close(); }
  });

  it('refuses any other number: it is no longer an open SMS relay', async () => {
    const { srv, sent } = await smsApp(smsWorld(live));
    try {
      for (const phone of ['+639179999999', PAX2.phone, DRV.phone]) assert.equal((await call(`${srv.url}/sms/send-sms`, { token: tokens.drv, body: { phone, message: 'buy now' } })).status, 403, phone);
      assert.deepEqual(sent, []);
    } finally { await srv.close(); }
  });

  it('refuses when the driver has no live trip (a finished or cancelled trip does not count) or the trip is another driver\'s', async () => {
    for (const trips of [[], [{ driver_id: DRV.id, passenger_id: PAX.id, booking_status: 'Completed' }], [{ driver_id: DRV.id, passenger_id: PAX.id, booking_status: 'Cancelled' }], [{ driver_id: DRV2.id, passenger_id: PAX.id, booking_status: 'Accepted' }]]) {
      const { srv, sent } = await smsApp(smsWorld(trips));
      try {
        assert.equal((await call(`${srv.url}/sms/send-sms`, { token: tokens.drv, body: { phone: PAX.phone, message: 'hello' } })).status, 403);
        assert.deepEqual(sent, []);
      } finally { await srv.close(); }
    }
  });

  it('only a verified driver may use it', async () => {
    for (const status of ['Pending Verification', 'Suspended', 'Rejected']) {
      const { srv, sent } = await smsApp(smsWorld(live, { driverStatus: status }));
      try {
        assert.equal((await call(`${srv.url}/sms/send-sms`, { token: tokens.drv, body: { phone: PAX.phone, message: 'hello' } })).status, 403, status);
        assert.deepEqual(sent, []);
      } finally { await srv.close(); }
    }
  });

  it('a passenger cannot use it', async () => {
    const { srv } = await smsApp(smsWorld(live));
    try {
      assert.equal((await call(`${srv.url}/sms/send-sms`, { token: tokens.pax, body: { phone: PAX2.phone, message: 'hello' } })).status, 403);
    } finally { await srv.close(); }
  });

  it('limits the text to 140 characters, strips control characters, and refuses empty or non-text messages', async () => {
    const { srv, sent } = await smsApp(smsWorld(live));
    try {
      assert.equal((await call(`${srv.url}/sms/send-sms`, { token: tokens.drv, body: { phone: PAX.phone, message: 'x'.repeat(141) } })).status, 400);
      assert.equal((await call(`${srv.url}/sms/send-sms`, { token: tokens.drv, body: { phone: PAX.phone, message: '   ' } })).status, 400);
      assert.equal((await call(`${srv.url}/sms/send-sms`, { token: tokens.drv, body: { phone: PAX.phone, message: { evil: 1 } } })).status, 400);
      assert.equal((await call(`${srv.url}/sms/send-sms`, { token: tokens.drv, body: { phone: PAX.phone, message: 'x'.repeat(140) } })).status, 200);
      await call(`${srv.url}/sms/send-sms`, { token: tokens.drv, body: { phone: PAX.phone, message: 'line1\r\nline2\u0000\u0007end' } });
      assert.equal(sent[sent.length - 1].text, '[SAKAY Driver Juan Dela Cruz]: line1 line2 end');
    } finally { await srv.close(); }
  });

  it('a gateway failure is reported as a failure (it used to be hidden as success in development)', async () => {
    const db = smsWorld(live);
    const auth = createAuth({ supabase: db as any });
    const app = express();
    app.use(express.json());
    app.use('/sms', auth.requireAuth, auth.requireRole('driver'), createCommunicationRouter({ supabase: db as any, sendRawSms: async (p: string) => ({ success: false, error: 'gateway down', formattedPhone: p }) }));
    const srv = await listen(app);
    try {
      const r = await call(`${srv.url}/sms/send-sms`, { token: tokens.drv, body: { phone: PAX.phone, message: 'hello' } });
      assert.equal(r.status, 502);
      assert.equal(r.json.success, false);
    } finally { await srv.close(); }
  });

  it('a database error is a 503, never a send', async () => {
    const db = smsWorld(live);
    (db as any).tables.booking = live;
    const bad = fakeSupabase({ users: { [tokens.drv]: { id: DRV.user } }, tables: { driver: db.tables.driver, passenger: db.tables.passenger, lgu_admin: [], toda_admin: [], booking: live }, fail: { 'booking:select': 'down' } });
    const { srv, sent } = await smsApp(bad);
    try {
      const r = await quiet(() => call(`${srv.url}/sms/send-sms`, { token: tokens.drv, body: { phone: PAX.phone, message: 'hello' } }));
      assert.equal(r.status, 503);
      assert.deepEqual(sent, []);
    } finally { await srv.close(); }
  });
});

describe('POST /notify/driver (the LGU tells a driver the outcome of their application)', () => {
  const LGU = { user: uuid(7), adminId: uuid(17) };
  const lguToken = fakeJwt();
  const APPLICANT = { id: uuid(21), phone: '+639175555555' };
  const TODA = { id: uuid(31), name: 'Central Calapan TODA' };

  function notifyWorld(status: string, over: { phone?: string | null; lguStatus?: string } = {}) {
    const db = world();
    db.tables.lgu_admin = [{ auth_user_id: LGU.user, admin_id: LGU.adminId, account_status: over.lguStatus ?? 'Active' }];
    db.tables.driver.push({ auth_user_id: uuid(9), driver_id: APPLICANT.id, account_status: status, contact_number: over.phone === undefined ? APPLICANT.phone : over.phone, toda_id: TODA.id, full_name: 'Maria Santos Reyes' });
    db.tables.toda = [{ toda_id: TODA.id, toda_name: TODA.name }];
    return db;
  }
  async function notifyApp(db: ReturnType<typeof fakeSupabase>, gateway: (p: string, t: string) => Promise<any> = async (p) => ({ success: true, formattedPhone: p })) {
    const sent: { phone: string; text: string }[] = [];
    const users = { [lguToken]: { id: LGU.user }, [tokens.drv]: { id: DRV.user }, [tokens.pax]: { id: PAX.user }, [tokens.nobody]: { id: NOBODY.user } };
    const authDb = fakeSupabase({ users, tables: db.tables });
    const auth = createAuth({ supabase: authDb as any });
    const app = express();
    app.use(express.json());
    app.use('/notify', auth.requireAuth, auth.requireRole('lgu'), createDriverNotifyRouter({
      supabase: authDb as any,
      sendRawSms: async (phone: string, text: string) => { sent.push({ phone, text }); return gateway(phone, text); },
    }));
    return { srv: await listen(app), sent };
  }
  const send = (url: string, body: unknown, token = lguToken) => call(`${url}/notify/driver`, { token, body });

  it('approved: texts the driver\'s OWN number from a template, whatever number or text the request carries', async () => {
    const { srv, sent } = await notifyApp(notifyWorld('Verified'));
    try {
      const r = await send(srv.url, { driverId: APPLICANT.id, kind: 'approved', phone: '+639179999999', message: 'send me money' });
      assert.equal(r.status, 200);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].phone, APPLICANT.phone);
      assert.ok(sent[0].text.startsWith('SAKAY Alert: Magandang araw, Maria!'));
      assert.ok(sent[0].text.includes('Central Calapan TODA'));
      assert.ok(!sent[0].text.includes('send me money'));
    } finally { await srv.close(); }
  });

  it('PER AFFILIATION: with an affiliationId the message is checked against THAT affiliation and names THAT TODA (not the driver\'s overall status)', async () => {
    const OTHER = { id: uuid(32), name: 'Balite TODA' };
    const world2 = () => {
      const db = notifyWorld('Pending Verification');          // overall status says "not Verified" ...
      db.tables.toda!.push({ toda_id: OTHER.id, toda_name: OTHER.name });
      db.tables.driver_toda_affiliation = [
        { affiliation_id: uuid(81), driver_id: APPLICANT.id, toda_id: OTHER.id, lgu_verification_status: 'Approved' },   // ... but this affiliation was approved
        { affiliation_id: uuid(82), driver_id: APPLICANT.id, toda_id: TODA.id, lgu_verification_status: 'Pending' },
      ];
      return db;
    };
    const ok = await notifyApp(world2());
    try {
      const r = await send(ok.srv.url, { driverId: APPLICANT.id, kind: 'approved', affiliationId: uuid(81) });
      assert.equal(r.status, 200);
      assert.ok(ok.sent[0].text.includes('Balite TODA'), 'names the approving TODA, not the driver\'s pointer');
      assert.ok(!ok.sent[0].text.includes('Central Calapan TODA'));
    } finally { await ok.srv.close(); }
    const notYet = await notifyApp(world2());
    try {
      assert.equal((await send(notYet.srv.url, { driverId: APPLICANT.id, kind: 'approved', affiliationId: uuid(82) })).status, 409, 'that affiliation is still Pending');
      assert.equal((await send(notYet.srv.url, { driverId: uuid(99), kind: 'approved', affiliationId: uuid(81) })).status, 404, 'an affiliation of another driver');
      assert.equal((await send(notYet.srv.url, { driverId: APPLICANT.id, kind: 'approved', affiliationId: 'nope' })).status, 400);
      assert.deepEqual(notYet.sent, []);
    } finally { await notYet.srv.close(); }
  });

  it('a message the record does not support is refused: approved needs Verified, rejected needs Rejected, returned needs Resubmission Required', async () => {
    const cases: [string, string][] = [['approved', 'Pending Verification'], ['approved', 'Rejected'], ['rejected', 'Verified'], ['returned', 'Verified'], ['returned', 'Pending Verification']];
    for (const [kind, status] of cases) {
      const { srv, sent } = await notifyApp(notifyWorld(status));
      try {
        assert.equal((await send(srv.url, { driverId: APPLICANT.id, kind, reason: 'x' })).status, 409, `${kind} for ${status}`);
        assert.deepEqual(sent, []);
      } finally { await srv.close(); }
    }
  });

  it('rejected and returned carry the (cleaned, limited) reason and only the known document names', async () => {
    const rej = await notifyApp(notifyWorld('Rejected'));
    try {
      assert.equal((await send(rej.srv.url, { driverId: APPLICANT.id, kind: 'rejected', reason: `Expired\r\nlicense${'!'.repeat(400)}` })).status, 200);
      assert.ok(rej.sent[0].text.includes('Dahilan: Expired license'));
      assert.ok(rej.sent[0].text.length < 500);
    } finally { await rej.srv.close(); }
    const ret = await notifyApp(notifyWorld('Resubmission Required'));
    try {
      assert.equal((await send(ret.srv.url, { driverId: APPLICANT.id, kind: 'returned', documents: ['license', 'selfie', 'passport', 7], notes: 'Blurry photo' })).status, 200);
      assert.ok(ret.sent[0].text.includes("Driver's License, Photo / Selfie"));
      assert.ok(!ret.sent[0].text.includes('passport'));
      assert.ok(ret.sent[0].text.includes('Dahilan: Blurry photo'));
    } finally { await ret.srv.close(); }
  });

  it('only an active LGU administrator may use it (a driver, a passenger, a signed-in stranger, a suspended administrator)', async () => {
    for (const [who, token, lguStatus] of [['driver', tokens.drv, 'Active'], ['passenger', tokens.pax, 'Active'], ['stranger', tokens.nobody, 'Active'], ['suspended LGU', lguToken, 'Suspended']] as const) {
      const { srv, sent } = await notifyApp(notifyWorld('Verified', { lguStatus }));
      try {
        assert.equal((await send(srv.url, { driverId: APPLICANT.id, kind: 'approved' }, token)).status, 403, who);
        assert.deepEqual(sent, []);
      } finally { await srv.close(); }
    }
  });

  it('refuses malformed requests, unknown drivers, and a driver with no mobile number on record', async () => {
    const { srv, sent } = await notifyApp(notifyWorld('Verified'));
    try {
      assert.equal((await send(srv.url, { driverId: 'not-a-uuid', kind: 'approved' })).status, 400);
      assert.equal((await send(srv.url, { driverId: APPLICANT.id, kind: 'broadcast' })).status, 400);
      assert.equal((await send(srv.url, { driverId: APPLICANT.id })).status, 400);
      assert.equal((await send(srv.url, { driverId: uuid(99), kind: 'approved' })).status, 404);
      assert.deepEqual(sent, []);
    } finally { await srv.close(); }
    const noPhone = await notifyApp(notifyWorld('Verified', { phone: null }));
    try {
      assert.equal((await send(noPhone.srv.url, { driverId: APPLICANT.id, kind: 'approved' })).status, 422);
      assert.deepEqual(noPhone.sent, []);
    } finally { await noPhone.srv.close(); }
  });

  it('a gateway failure is a 502 (not reported as success)', async () => {
    const { srv } = await notifyApp(notifyWorld('Verified'), async (p) => ({ success: false, error: 'gateway down', formattedPhone: p }));
    try {
      const r = await send(srv.url, { driverId: APPLICANT.id, kind: 'approved' });
      assert.equal(r.status, 502);
      assert.equal(r.json.success, false);
    } finally { await srv.close(); }
  });
});

describe('POST /toda-admin/notify/driver (a TODA administrator tells an applicant of their own TODA what the TODA decided)', () => {
  const TADM = { user: uuid(8), adminId: uuid(18) };
  const todaToken = fakeJwt();
  const MY_TODA = uuid(41);
  const OTHER_TODA = uuid(42);
  const MINE = { id: uuid(51), phone: '+639176666666' };
  const THEIRS = { id: uuid(52), phone: '+639177777777' };

  const MULTI = { id: uuid(53), phone: '+639178888888' };   // driver.toda_id points at ANOTHER TODA, but also applied to MY_TODA

  function todaWorld(affiliationStatus: string | null, over: { adminStatus?: string; multiMine?: string; multiOther?: string } = {}) {
    const db = world();
    db.tables.toda_admin = [{ auth_user_id: TADM.user, admin_id: TADM.adminId, toda_id: MY_TODA, account_status: over.adminStatus ?? 'Active' }];
    db.tables.driver.push(
      { auth_user_id: uuid(61), driver_id: MINE.id, account_status: 'Pending Verification', contact_number: MINE.phone, toda_id: MY_TODA, full_name: 'Jose Rizal Santos' },
      { auth_user_id: uuid(62), driver_id: THEIRS.id, account_status: 'Pending Verification', contact_number: THEIRS.phone, toda_id: OTHER_TODA, full_name: 'Andres Bonifacio' },
    );
    db.tables.driver.push(
      { auth_user_id: uuid(63), driver_id: MULTI.id, account_status: 'Pending Verification', contact_number: MULTI.phone, toda_id: OTHER_TODA, full_name: 'Emilio Aguinaldo' },
    );
    // one row per (driver, TODA): each TODA's stage is its own
    db.tables.driver_toda_affiliation = [
      ...(affiliationStatus
        ? [
            { affiliation_id: uuid(71), driver_id: MINE.id, toda_id: MY_TODA, toda_endorsement_status: affiliationStatus },
            { affiliation_id: uuid(72), driver_id: THEIRS.id, toda_id: OTHER_TODA, toda_endorsement_status: affiliationStatus },
          ]
        : []),
      ...(over.multiMine
        ? [
            { affiliation_id: uuid(73), driver_id: MULTI.id, toda_id: MY_TODA, toda_endorsement_status: over.multiMine },
            { affiliation_id: uuid(74), driver_id: MULTI.id, toda_id: OTHER_TODA, toda_endorsement_status: over.multiOther ?? 'Submitted' },
          ]
        : []),
    ];
    db.tables.toda = [{ toda_id: MY_TODA, toda_name: 'Balite TODA', toda_acronym: 'BTODA' }];
    return db;
  }
  async function todaApp(db: ReturnType<typeof fakeSupabase>, gateway: (p: string, t: string) => Promise<any> = async (p) => ({ success: true, formattedPhone: p })) {
    const sent: { phone: string; text: string }[] = [];
    const users = { [todaToken]: { id: TADM.user }, [tokens.drv]: { id: DRV.user }, [tokens.pax]: { id: PAX.user }, [tokens.nobody]: { id: NOBODY.user } };
    const authDb = fakeSupabase({ users, tables: db.tables });
    const auth = createAuth({ supabase: authDb as any });
    const app = express();
    app.use(express.json());
    app.use('/tn', auth.requireAuth, auth.requireRole('toda'), createTodaDriverNotifyRouter({
      supabase: authDb as any,
      sendRawSms: async (phone: string, text: string) => { sent.push({ phone, text }); return gateway(phone, text); },
    }));
    return { srv: await listen(app), sent };
  }
  const send = (url: string, body: unknown, token = todaToken) => call(`${url}/tn/driver`, { token, body });

  it('endorsed: texts the applicant\'s OWN number from a template that names the TODA, whatever number or text the request carries', async () => {
    const { srv, sent } = await todaApp(todaWorld('Endorsed'));
    try {
      const r = await send(srv.url, { driverId: MINE.id, kind: 'endorsed', phone: '+639179999999', message: 'free load' });
      assert.equal(r.status, 200);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].phone, MINE.phone);
      assert.ok(sent[0].text.startsWith('SAKAY Update: Magandang araw, Jose!'));
      assert.ok(sent[0].text.includes('Balite TODA (BTODA)'));
      assert.ok(!sent[0].text.includes('free load'));
    } finally { await srv.close(); }
  });

  it('a driver of ANOTHER TODA is treated as not found, and nothing is sent', async () => {
    const { srv, sent } = await todaApp(todaWorld('Endorsed'));
    try {
      assert.equal((await send(srv.url, { driverId: THEIRS.id, kind: 'endorsed' })).status, 404);
      assert.deepEqual(sent, []);
    } finally { await srv.close(); }
  });

  it('PER AFFILIATION: a driver whose driver.toda_id is ANOTHER TODA can still be told what MY TODA decided, whatever the other TODA decided', async () => {
    const { srv, sent } = await todaApp(todaWorld(null, { multiMine: 'Endorsed', multiOther: 'Rejected' }));
    try {
      const r = await send(srv.url, { driverId: MULTI.id, kind: 'endorsed' });
      assert.equal(r.status, 200);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].phone, MULTI.phone);
      assert.ok(sent[0].text.includes('Balite TODA (BTODA)'));
    } finally { await srv.close(); }
  });

  it('PER AFFILIATION: the other TODA\'s decision does not stand in for mine (it endorsed, mine is still Submitted -> refused)', async () => {
    const { srv, sent } = await todaApp(todaWorld(null, { multiMine: 'Submitted', multiOther: 'Endorsed' }));
    try {
      assert.equal((await send(srv.url, { driverId: MULTI.id, kind: 'endorsed' })).status, 409);
      assert.deepEqual(sent, []);
    } finally { await srv.close(); }
  });

  it('the message must match the TODA stage of the affiliation: endorsed needs Endorsed, returned needs Resubmission Required, rejected needs Rejected', async () => {
    const cases: [string, string | null][] = [['endorsed', 'Submitted'], ['endorsed', 'Rejected'], ['returned', 'Endorsed'], ['rejected', 'Endorsed'], ['endorsed', null]];
    for (const [kind, status] of cases) {
      const { srv, sent } = await todaApp(todaWorld(status));
      try {
        // no affiliation with this TODA at all is "not found" (404), exactly like a driver who does not exist; a wrong stage is a 409
        assert.equal((await send(srv.url, { driverId: MINE.id, kind, reason: 'x' })).status, status === null ? 404 : 409, `${kind} when ${status}`);
        assert.deepEqual(sent, []);
      } finally { await srv.close(); }
    }
  });

  it('returned and rejected carry the cleaned, limited reason', async () => {
    const ret = await todaApp(todaWorld('Resubmission Required'));
    try {
      assert.equal((await send(ret.srv.url, { driverId: MINE.id, kind: 'returned', reason: `Blurry\r\nphoto${'?'.repeat(400)}` })).status, 200);
      assert.ok(ret.sent[0].text.includes('Dahilan: Blurry photo'));
      assert.ok(ret.sent[0].text.length < 450);
    } finally { await ret.srv.close(); }
    const rej = await todaApp(todaWorld('Rejected'));
    try {
      assert.equal((await send(rej.srv.url, { driverId: MINE.id, kind: 'rejected', reason: 'Not on the roster' })).status, 200);
      assert.ok(rej.sent[0].text.includes('hindi naaprubahan ng TODA. Dahilan: Not on the roster'));
    } finally { await rej.srv.close(); }
  });

  it('only an active TODA administrator may use it (a driver, a passenger, a stranger, a suspended administrator)', async () => {
    for (const [who, token, adminStatus] of [['driver', tokens.drv, 'Active'], ['passenger', tokens.pax, 'Active'], ['stranger', tokens.nobody, 'Active'], ['suspended TODA admin', todaToken, 'Suspended']] as const) {
      const { srv, sent } = await todaApp(todaWorld('Endorsed', { adminStatus }));
      try {
        assert.equal((await send(srv.url, { driverId: MINE.id, kind: 'endorsed' }, token)).status, 403, who);
        assert.deepEqual(sent, []);
      } finally { await srv.close(); }
    }
  });

  it('refuses malformed requests, and reports a gateway failure as a 502', async () => {
    const { srv, sent } = await todaApp(todaWorld('Endorsed'));
    try {
      assert.equal((await send(srv.url, { driverId: 'nope', kind: 'endorsed' })).status, 400);
      assert.equal((await send(srv.url, { driverId: MINE.id, kind: 'approved' })).status, 400);
      assert.deepEqual(sent, []);
    } finally { await srv.close(); }
    const down = await todaApp(todaWorld('Endorsed'), async (p) => ({ success: false, error: 'gateway down', formattedPhone: p }));
    try {
      const r = await send(down.srv.url, { driverId: MINE.id, kind: 'endorsed' });
      assert.equal(r.status, 502);
      assert.equal(r.json.success, false);
    } finally { await down.srv.close(); }
  });
});

describe('helpers', () => {
  it('phone numbers: one subscriber however it is written', () => {
    for (const a of ['+639171234567', '639171234567', '09171234567', '9171234567', '0917 123 4567', '+63 (917) 123-4567']) {
      assert.equal(subscriberOf(a), '9171234567', a);
      assert.equal(normalizePhone(a), '+639171234567', a);
      assert.ok(samePhone(a, '+639171234567'));
    }
    assert.ok(!samePhone('+639171234567', '+639171234568'));
    assert.ok(!samePhone('', ''), 'two empty values are not the same subscriber');
    assert.ok(!samePhone(null, undefined));
    assert.ok(isPhMobile('09171234567') && !isPhMobile('0217123456') && !isPhMobile('12345') && !isPhMobile(null));
    assert.equal(maskPhone('+639171234567'), '+63917*****67');
    assert.equal(maskPhone('x'), '(invalid number)');
  });

  it('age: completed years, strict date format, no future or absurd dates', () => {
    const today = new Date('2026-10-04T00:00:00Z');
    assert.equal(calcAge('2014-10-04', today), 12);
    assert.equal(calcAge('2014-10-05', today), 11);
    assert.equal(calcAge('2000-01-01', today), 26);
    for (const bad of ['', 'x', '2000/01/01', '01-01-2000', '2027-01-01', '1800-01-01', null, 20000101, '2000-13-45']) assert.equal(calcAge(bad as any, today), null, String(bad));
  });
});
