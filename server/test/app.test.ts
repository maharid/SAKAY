// The assembled application: default deny, role gates, body limits, CORS, headers, scheduler secret, error handling.
import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApp } from '../src/app';
import { createAuth } from '../src/middleware/auth';
import { limiter } from '../src/middleware/rateLimits';
import { errorHandler } from '../src/middleware/errorHandler';
import { call, fakeJwt, fakeSupabase, listen, quiet, uuid } from './helpers';

const U = { lgu: uuid(1), toda1: uuid(2), toda2: uuid(3), drv: uuid(4), pax: uuid(5), none: uuid(6) };
const T1 = uuid(900), T2 = uuid(901);
const tok = { lgu: fakeJwt(), toda1: fakeJwt(), toda2: fakeJwt(), drv: fakeJwt(), pax: fakeJwt(), none: fakeJwt() };

function makeDb() {
  return fakeSupabase({
    users: Object.fromEntries((Object.keys(tok) as (keyof typeof tok)[]).map((k) => [tok[k], { id: U[k] }])),
    tables: {
      lgu_admin: [{ auth_user_id: U.lgu, admin_id: uuid(11), account_status: 'Active' }],
      toda_admin: [
        { auth_user_id: U.toda1, admin_id: uuid(12), toda_id: T1, account_status: 'Active' },
        { auth_user_id: U.toda2, admin_id: uuid(13), toda_id: T2, account_status: 'Active' },
      ],
      driver: [{ auth_user_id: U.drv, driver_id: uuid(14), account_status: 'Verified', contact_number: '+639170000004', toda_id: T1, full_name: 'Driver' }],
      passenger: [{ auth_user_id: U.pax, passenger_id: uuid(15), account_status: 'Active', contact_number: '+639170000005' }],
    },
  });
}

describe('default deny', () => {
  let srv: Awaited<ReturnType<typeof listen>>;
  before(async () => { srv = await listen(createApp({ auth: createAuth({ supabase: makeDb() as any }), env: { NODE_ENV: 'test' } })); });
  after(async () => { await srv.close(); });

  it('/api/health is public and says nothing about the environment', async () => {
    const r = await call(`${srv.url}/api/health`);
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json).sort(), ['status', 'timestamp']);
  });

  for (const [method, path] of [
    ['GET', '/api/admin/todas/applications'], ['GET', '/api/admin/dashboard/stats'], ['GET', '/api/admin/drivers'], ['GET', '/api/admin/passengers'],
    ['POST', '/api/communication/send-sms'], ['POST', '/api/ocr/mtop'], ['POST', '/api/ocr/license'], ['POST', '/api/auth/send-otp'], ['POST', '/api/auth/verify-otp'],
    ['GET', '/api/admin/todas/' + T1 + '/roster'], ['POST', '/api/admin/todas/' + T1 + '/roster'],
    ['GET', '/api/toda/profile'], ['GET', '/api/does-not-exist'], ['DELETE', '/api/admin/announcements/' + uuid(7)],
    ['POST', '/api/admin/notify/driver'], ['POST', '/api/toda-admin/notify/driver'],
  ] as const) {
    it(`${method} ${path.replace(/[0-9a-f-]{36}/, ':id')} without a token answers 401, never the data`, async () => {
      const r = await call(`${srv.url}${path}`, { method, body: method === 'GET' ? undefined : {} });
      assert.equal(r.status, 401);
      assert.equal(r.json.success, false);
    });
  }

  it('an unknown route is a 404 only for signed-in users (a stranger cannot map the API)', async () => {
    assert.equal((await call(`${srv.url}/api/nope`, { token: tok.pax })).status, 404);
  });

  it('the old mock TODA portal API is not mounted at all', async () => {
    assert.equal((await call(`${srv.url}/api/toda/profile`, { token: tok.toda1 })).status, 404);
  });
});

describe('role gates', () => {
  let srv: Awaited<ReturnType<typeof listen>>;
  before(async () => { srv = await listen(createApp({ auth: createAuth({ supabase: makeDb() as any }), env: { NODE_ENV: 'test' } })); });
  after(async () => { await srv.close(); });

  it('/api/admin/* is for the LGU administrator only', async () => {
    for (const t of [tok.pax, tok.drv, tok.toda1, tok.none]) assert.equal((await call(`${srv.url}/api/admin/dashboard/stats`, { token: t })).status, 403);
  });
  it('the LGU administrator gets past the gate (the route itself then needs the database: 5xx here, not 401 / 403)', async () => {
    const r = await quiet(() => call(`${srv.url}/api/admin/announcements`, { token: tok.lgu }));
    assert.ok(r.status !== 401 && r.status !== 403, `status ${r.status}`);
  });
  it('the disabled account-action routes still answer 403 (for the LGU too)', async () => {
    assert.equal((await call(`${srv.url}/api/admin/drivers/${uuid(9)}/verify`, { method: 'POST', token: tok.lgu, body: {} })).status, 403);
    assert.equal((await call(`${srv.url}/api/admin/fare-matrix`, { method: 'POST', token: tok.lgu, body: {} })).status, 403);
  });

  it('SMS relay: only drivers; a passenger and a stranger are refused', async () => {
    for (const t of [tok.pax, tok.none, tok.toda1, tok.lgu]) assert.equal((await call(`${srv.url}/api/communication/send-sms`, { token: t, body: { phone: '+639171234567', message: 'hi' } })).status, 403);
  });
  it('driver notifications (SMS about the outcome of an application): the LGU administrator only', async () => {
    for (const t of [tok.pax, tok.drv, tok.toda1, tok.none]) assert.equal((await call(`${srv.url}/api/admin/notify/driver`, { token: t, body: { driverId: uuid(9), kind: 'approved' } })).status, 403);
    // the LGU passes the gate; this request has no valid driver id, so the route itself answers 400
    assert.equal((await call(`${srv.url}/api/admin/notify/driver`, { token: tok.lgu, body: { kind: 'approved' } })).status, 400);
  });
  it('TODA notifications: the TODA administrator only (the LGU administrator, drivers and passengers are refused)', async () => {
    for (const t of [tok.pax, tok.drv, tok.lgu, tok.none]) assert.equal((await call(`${srv.url}/api/toda-admin/notify/driver`, { token: t, body: { driverId: uuid(9), kind: 'endorsed' } })).status, 403);
    // the TODA administrator passes the gate; this request has no valid driver id, so the route itself answers 400
    assert.equal((await call(`${srv.url}/api/toda-admin/notify/driver`, { token: tok.toda1, body: { kind: 'endorsed' } })).status, 400);
  });
  it('OCR: only drivers', async () => {
    for (const t of [tok.pax, tok.none, tok.toda1]) assert.equal((await call(`${srv.url}/api/ocr/mtop`, { token: t, body: { imageBase64: 'AAAA' } })).status, 403);
  });
  it('OCR: a driver reaches the handler, which validates the image before spending any money', async () => {
    const r = await call(`${srv.url}/api/ocr/mtop`, { token: tok.drv, body: { imageBase64: 'not base64 at all !!!' } });
    assert.equal(r.status, 400);
    const r2 = await call(`${srv.url}/api/ocr/mtop`, { token: tok.drv, body: { imageBase64: 'AAAA', mimeType: 'application/x-msdownload' } });
    assert.equal(r2.status, 400);
    assert.match(r2.json.error, /Unsupported image type/);
  });

  it('roster: the administrator of ANOTHER TODA is refused, the LGU and the TODA\'s own administrator pass the gate', async () => {
    assert.equal((await call(`${srv.url}/api/admin/todas/${T1}/roster`, { token: tok.toda2 })).status, 403);
    assert.equal((await call(`${srv.url}/api/admin/todas/${T1}/roster`, { token: tok.pax })).status, 403);
    for (const t of [tok.toda1, tok.lgu]) {
      const r = await quiet(() => call(`${srv.url}/api/admin/todas/${T1}/roster`, { token: t }));
      assert.equal(r.status, 503, 'passed the gate; this test app has no database');
    }
  });
  it('roster: the TODA id in the address must be a UUID', async () => {
    assert.equal((await call(`${srv.url}/api/admin/todas/not-a-uuid/roster`, { token: tok.lgu })).status, 400);
  });
});

describe('body limits are enforced after sign-in', () => {
  let srv: Awaited<ReturnType<typeof listen>>;
  before(async () => { srv = await listen(createApp({ auth: createAuth({ supabase: makeDb() as any }), env: { NODE_ENV: 'test' } })); });
  after(async () => { await srv.close(); });

  it('an unauthenticated 3 MB body gets 401 and is never parsed', async () => {
    const r = await call(`${srv.url}/api/auth/send-otp`, { rawBody: JSON.stringify({ x: 'a'.repeat(3_000_000) }) });
    assert.equal(r.status, 401);
  });
  it('a signed-in caller cannot post more than 100 kB to an ordinary route', async () => {
    const r = await call(`${srv.url}/api/auth/send-otp`, { token: tok.pax, rawBody: JSON.stringify({ x: 'a'.repeat(200_000) }) });
    assert.equal(r.status, 413);
  });
  it('the OCR path takes a photo-sized body (several hundred kB)', async () => {
    const r = await call(`${srv.url}/api/ocr/mtop`, { token: tok.drv, rawBody: JSON.stringify({ imageBase64: 'A'.repeat(600_000) }) });
    assert.notEqual(r.status, 413);
  });
  it('but not more than 12 MB', async () => {
    const r = await call(`${srv.url}/api/ocr/mtop`, { token: tok.drv, rawBody: JSON.stringify({ imageBase64: 'A'.repeat(13_000_000) }) });
    assert.equal(r.status, 413);
  });
  it('malformed JSON is a 400 with no stack trace', async () => {
    const r = await quiet(() => call(`${srv.url}/api/auth/send-otp`, { token: tok.pax, rawBody: '{"phone": ' }));
    assert.equal(r.status, 400);
    assert.doesNotMatch(r.text, /at .*\.(js|ts)/);
  });
});

describe('headers and CORS', () => {
  it('sends security headers and does not announce Express', async () => {
    const srv = await listen(createApp({ auth: createAuth({ supabase: makeDb() as any }), env: { NODE_ENV: 'test' } }));
    try {
      const r = await call(`${srv.url}/api/health`);
      assert.equal(r.headers.get('x-powered-by'), null);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      assert.ok(r.headers.get('strict-transport-security'));
    } finally { await srv.close(); }
  });

  it('production: only the origins in CORS_ORIGIN; localhost and dev tunnels are refused', async () => {
    const srv = await listen(createApp({ auth: createAuth({ supabase: makeDb() as any }), env: { NODE_ENV: 'production', CORS_ORIGIN: 'https://app.example.ph, https://admin.example.ph' } }));
    try {
      const ok = await call(`${srv.url}/api/health`, { headers: { Origin: 'https://app.example.ph' } });
      assert.equal(ok.status, 200);
      assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app.example.ph');
      for (const bad of ['https://evil.example', 'http://localhost:5173', 'https://x.devtunnels.ms']) {
        const r = await quiet(() => call(`${srv.url}/api/health`, { headers: { Origin: bad } }));
        assert.equal(r.status, 403, bad);
      }
      const noOrigin = await call(`${srv.url}/api/health`);
      assert.equal(noOrigin.status, 200, 'a request without an Origin is not a cross-origin browser request');
      assert.equal(ok.headers.get('access-control-allow-credentials'), null, 'no cookies are used, so no credentialed CORS');
    } finally { await srv.close(); }
  });

  it('production with CORS_ORIGIN unset refuses every browser origin', async () => {
    const srv = await listen(createApp({ auth: createAuth({ supabase: makeDb() as any }), env: { NODE_ENV: 'production' } }));
    try {
      assert.equal((await quiet(() => call(`${srv.url}/api/health`, { headers: { Origin: 'http://localhost:5173' } }))).status, 403);
    } finally { await srv.close(); }
  });

  it('development: localhost and dev tunnels are allowed', async () => {
    const srv = await listen(createApp({ auth: createAuth({ supabase: makeDb() as any }), env: { NODE_ENV: 'development' } }));
    try {
      for (const o of ['http://localhost:5173', 'http://localhost:9999', 'https://abc-5173.asse.devtunnels.ms']) {
        assert.equal((await call(`${srv.url}/api/health`, { headers: { Origin: o } })).status, 200, o);
      }
      assert.equal((await quiet(() => call(`${srv.url}/api/health`, { headers: { Origin: 'https://evil.example' } }))).status, 403);
    } finally { await srv.close(); }
  });

  it('a pre-flight request is answered before any sign-in check', async () => {
    const srv = await listen(createApp({ auth: createAuth({ supabase: makeDb() as any }), env: { NODE_ENV: 'development' } }));
    try {
      const r = await fetch(`${srv.url}/api/admin/dashboard/stats`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
      assert.equal(r.status, 204);
      assert.match(r.headers.get('access-control-allow-headers') ?? '', /Authorization/i);
    } finally { await srv.close(); }
  });
});

describe('scheduler endpoint', () => {
  const path = '/api/scheduler/run-sla-checks';
  it('is disabled (503) for EVERYONE while SCHEDULER_SECRET is not set: the old built-in default secret no longer works', async () => {
    const srv = await listen(createApp({ auth: createAuth({ supabase: makeDb() as any }), env: { NODE_ENV: 'test' } }));
    process.env.SCHEDULER_SECRET = '';
    try {
      for (const headers of [{}, { 'X-Scheduler-Secret': 'sakay-internal-scheduler-secret' }, { Authorization: 'Bearer sakay-internal-scheduler-secret' }]) {
        const r = await quiet(() => call(`${srv.url}${path}`, { method: 'POST', headers, body: {} }));
        assert.equal(r.status, 503);
      }
    } finally { await srv.close(); }
  });
  it('a secret shorter than 16 characters is treated as not configured', async () => {
    const srv = await listen(createApp({ auth: createAuth({ supabase: makeDb() as any }), env: { NODE_ENV: 'test' } }));
    process.env.SCHEDULER_SECRET = 'short';
    try {
      assert.equal((await quiet(() => call(`${srv.url}${path}`, { method: 'POST', headers: { 'X-Scheduler-Secret': 'short' }, body: {} }))).status, 503);
    } finally { process.env.SCHEDULER_SECRET = ''; await srv.close(); }
  });
  it('with a real secret: wrong or missing secret 401, right secret passes the guard', async () => {
    const srv = await listen(createApp({ auth: createAuth({ supabase: makeDb() as any }), env: { NODE_ENV: 'test' } }));
    process.env.SCHEDULER_SECRET = 'a-long-random-scheduler-secret-123';
    try {
      assert.equal((await quiet(() => call(`${srv.url}${path}`, { method: 'POST', body: {} }))).status, 401);
      assert.equal((await quiet(() => call(`${srv.url}${path}`, { method: 'POST', headers: { 'X-Scheduler-Secret': 'a-long-random-scheduler-secret-124' }, body: {} }))).status, 401);
      assert.equal((await quiet(() => call(`${srv.url}${path}`, { method: 'POST', token: tok.lgu, body: {} }))).status, 401, 'a user token is not the scheduler secret');
      const ok = await quiet(() => call(`${srv.url}${path}`, { method: 'POST', headers: { 'X-Scheduler-Secret': 'a-long-random-scheduler-secret-123' }, body: {} }));
      assert.equal(ok.status, 503, 'passed the guard; this test app has no database');
      const ok2 = await quiet(() => call(`${srv.url}${path}`, { method: 'POST', headers: { Authorization: 'Bearer a-long-random-scheduler-secret-123' }, body: {} }));
      assert.equal(ok2.status, 503);
    } finally { process.env.SCHEDULER_SECRET = ''; await srv.close(); }
  });
});

describe('error handling and rate limits', () => {
  it('a failing route returns a generic message in production and the real one in development', async () => {
    for (const [env, expectGeneric] of [['production', true], ['development', false]] as const) {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = env;
      const app = express();
      app.get('/boom', () => { throw new Error('relation "secret_table" does not exist'); });
      app.use(errorHandler);
      const srv = await listen(app);
      try {
        const r = await quiet(() => call(`${srv.url}/boom`));
        assert.equal(r.status, 500);
        assert.equal(/secret_table/.test(r.text), !expectGeneric);
        assert.doesNotMatch(r.text, /\bat \w+.*\(/, 'no stack trace');
      } finally { process.env.NODE_ENV = prev; await srv.close(); }
    }
  });

  it('limiter: the 4th request in a window is a 429 with Retry-After, counted per user', async () => {
    const app = express();
    app.use((req, _res, next) => { const id = req.headers['x-user']; if (typeof id === 'string') req.auth = { userId: id, email: null }; next(); });
    app.use(limiter({ name: 't', perUser: true, windowMs: 60_000, limit: 3, message: 'slow down' }));
    app.get('/x', (_req, res) => res.json({ ok: true }));
    const srv = await listen(app);
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) statuses.push((await call(`${srv.url}/x`, { headers: { 'x-user': 'alice' } })).status);
      assert.deepEqual(statuses, [200, 200, 200, 429]);
      const limited = await call(`${srv.url}/x`, { headers: { 'x-user': 'alice' } });
      assert.equal(limited.json.error, 'slow down');
      assert.ok(Number(limited.headers.get('retry-after')) >= 1);
      assert.equal((await call(`${srv.url}/x`, { headers: { 'x-user': 'bob' } })).status, 200, 'another user has their own allowance');
    } finally { await srv.close(); }
  });
});
