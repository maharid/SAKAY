// Authentication middleware: token verification, caching, roles, fail-closed behaviour.
//   run:  cd server && npx tsx --test test/*.test.ts
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAuth } from '../src/middleware/auth';
import { call, fakeJwt, fakeSupabase, listen, quiet, uuid } from './helpers';

const U_LGU = uuid(1), U_TODA = uuid(2), U_DRV = uuid(3), U_PAX = uuid(4), U_NONE = uuid(5), U_SUSP = uuid(6), U_ANON = uuid(7);

function world() {
  const tLgu = fakeJwt(), tToda = fakeJwt(), tDrv = fakeJwt(), tPax = fakeJwt(), tNone = fakeJwt(), tSusp = fakeJwt(), tAnon = fakeJwt();
  const db = fakeSupabase({
    users: {
      [tLgu]: { id: U_LGU }, [tToda]: { id: U_TODA }, [tDrv]: { id: U_DRV }, [tPax]: { id: U_PAX }, [tNone]: { id: U_NONE }, [tSusp]: { id: U_SUSP },
      [tAnon]: { id: U_ANON, is_anonymous: true },
    },
    tables: {
      lgu_admin: [{ auth_user_id: U_LGU, admin_id: uuid(101), account_status: 'Active' }, { auth_user_id: U_SUSP, admin_id: uuid(102), account_status: 'Suspended' }],
      toda_admin: [{ auth_user_id: U_TODA, admin_id: uuid(201), toda_id: uuid(900), account_status: 'Active' }],
      driver: [{ auth_user_id: U_DRV, driver_id: uuid(301), account_status: 'Pending Verification', contact_number: '+639170000003', toda_id: null, full_name: 'D' }],
      passenger: [{ auth_user_id: U_PAX, passenger_id: uuid(401), account_status: 'Active', contact_number: '+639170000004' }],
    },
  });
  return { db, tokens: { tLgu, tToda, tDrv, tPax, tNone, tSusp, tAnon } };
}

function appWith(auth: ReturnType<typeof createAuth>) {
  const app = express();
  app.use(express.json());
  app.get('/open', (_req, res) => res.json({ ok: true }));
  app.get('/who', auth.requireAuth, (req, res) => res.json({ auth: req.auth }));
  app.get('/lgu', auth.requireAuth, auth.requireRole('lgu'), (_req, res) => res.json({ ok: true }));
  app.get('/toda', auth.requireAuth, auth.requireRole('toda'), (_req, res) => res.json({ ok: true }));
  app.get('/driver', auth.requireAuth, auth.requireRole('driver'), (_req, res) => res.json({ ok: true }));
  app.get('/staff', auth.requireAuth, auth.requireRole('lgu', 'toda'), (_req, res) => res.json({ ok: true }));
  app.post('/identity', auth.requireAuth, (req, res) => res.json({ fromToken: req.auth?.userId, fromBody: (req.body as any).auth_user_id }));
  app.get('/no-auth-first', auth.requireRole('lgu'), (_req, res) => res.json({ ok: true }));
  return app;
}

describe('requireAuth', () => {
  const { db, tokens } = world();
  const auth = createAuth({ supabase: db as any });
  let srv: Awaited<ReturnType<typeof listen>>;
  before(async () => { srv = await listen(appWith(auth)); });
  after(async () => { await srv.close(); });

  it('refuses a request with no Authorization header', async () => {
    const r = await call(`${srv.url}/who`);
    assert.equal(r.status, 401);
    assert.equal(r.json.success, false);
    assert.equal(db.calls.getUser, 0, 'must not even ask Supabase');
  });

  for (const [name, header] of [
    ['a Basic header', 'Basic abc'],
    ['a bare token without "Bearer"', 'abc.def.ghi'],
    ['a token that is not JWT-shaped', 'Bearer not-a-jwt'],
    ['two tokens', 'Bearer aaaaaaaa.bbbbbbbb.cccccccc dddddddd.eeeeeeee.ffffffff'],
    ['an empty bearer', 'Bearer '],
    ['a 10 kB token', `Bearer ${'a'.repeat(10_000)}.bbbbbbbb.cccccccc`],
  ] as const) {
    it(`refuses ${name} without calling Supabase`, async () => {
      const before = db.calls.getUser;
      const r = await call(`${srv.url}/who`, { headers: { Authorization: header } });
      assert.equal(r.status, 401);
      assert.equal(db.calls.getUser, before);
    });
  }

  it('refuses a well-formed token that Supabase Auth rejects', async () => {
    const r = await call(`${srv.url}/who`, { token: fakeJwt() });
    assert.equal(r.status, 401);
  });

  it('refuses an expired token without calling Supabase', async () => {
    const before = db.calls.getUser;
    const r = await call(`${srv.url}/who`, { token: fakeJwt(-60) });
    assert.equal(r.status, 401);
    assert.equal(db.calls.getUser, before);
  });

  it('accepts a valid token and exposes the verified identity', async () => {
    const r = await call(`${srv.url}/who`, { token: tokens.tPax });
    assert.equal(r.status, 200);
    assert.equal(r.json.auth.userId, U_PAX);
  });

  it('refuses an anonymous (guest) sign-in', async () => {
    const r = await call(`${srv.url}/who`, { token: tokens.tAnon });
    assert.equal(r.status, 401);
  });

  it('never takes the identity from the request body', async () => {
    const r = await call(`${srv.url}/identity`, { token: tokens.tPax, body: { auth_user_id: U_LGU, userId: U_LGU } });
    assert.equal(r.json.fromToken, U_PAX);
    assert.notEqual(r.json.fromToken, r.json.fromBody);
  });

  it('a role check without a sign-in check in front of it refuses (it cannot be mounted wrongly)', async () => {
    const r = await call(`${srv.url}/no-auth-first`, { token: tokens.tLgu });
    assert.equal(r.status, 401);
  });
});

describe('caching', () => {
  it('verifies a token once per ttl, then again after it', async () => {
    const { db, tokens } = world();
    let t = 1_000_000;
    const auth = createAuth({ supabase: db as any, ttlMs: 30_000, now: () => t });
    const srv = await listen(appWith(auth));
    try {
      await call(`${srv.url}/who`, { token: tokens.tPax });
      await call(`${srv.url}/who`, { token: tokens.tPax });
      assert.equal(db.calls.getUser, 1, 'second call served from cache');
      t += 31_000;
      await call(`${srv.url}/who`, { token: tokens.tPax });
      assert.equal(db.calls.getUser, 2, 'verified again after the ttl');
    } finally { await srv.close(); }
  });

  it('remembers a refused token only briefly', async () => {
    const { db } = world();
    let t = 5_000_000;
    const auth = createAuth({ supabase: db as any, negativeTtlMs: 5_000, now: () => t });
    const srv = await listen(appWith(auth));
    const bad = fakeJwt();
    try {
      await call(`${srv.url}/who`, { token: bad });
      await call(`${srv.url}/who`, { token: bad });
      assert.equal(db.calls.getUser, 1);
      t += 6_000;
      await call(`${srv.url}/who`, { token: bad });
      assert.equal(db.calls.getUser, 2);
    } finally { await srv.close(); }
  });

  it('the cache is bounded', async () => {
    const { db } = world();
    const auth = createAuth({ supabase: db as any, maxEntries: 5 });
    const srv = await listen(appWith(auth));
    try {
      for (let i = 0; i < 40; i++) await call(`${srv.url}/who`, { token: fakeJwt() });
      assert.ok(auth._caches.tokens.size <= 5, `cache holds ${auth._caches.tokens.size}`);
    } finally { await srv.close(); }
  });

  it('never keeps a token past its own expiry', async () => {
    const { db } = world();
    let t = Date.now();
    const short = fakeJwt(10);
    (db as any).auth.getUser = async (tok: string) => ({ data: { user: tok === short ? { id: U_PAX } : null }, error: tok === short ? null : { status: 401, message: 'x' } });
    const auth = createAuth({ supabase: db as any, ttlMs: 30_000, now: () => t });
    const srv = await listen(appWith(auth));
    try {
      assert.equal((await call(`${srv.url}/who`, { token: short })).status, 200);
      t += 11_000;                       // 11 s later the token has expired, though the ttl (30 s) has not
      assert.equal((await call(`${srv.url}/who`, { token: short })).status, 401);
    } finally { await srv.close(); }
  });
});

describe('failing closed', () => {
  it('answers 503 (not "let through", not 401) when Supabase Auth cannot be reached', async () => {
    const { db, tokens } = world();
    const down = fakeSupabase({ authDown: true, users: {} });
    const auth = createAuth({ supabase: down as any });
    const srv = await listen(appWith(auth));
    try {
      const r = await quiet(() => call(`${srv.url}/who`, { token: tokens.tPax }));
      assert.equal(r.status, 503);
      void db;
    } finally { await srv.close(); }
  });

  it('answers 503 when the server has no Supabase connection configured', async () => {
    const auth = createAuth({ supabase: null });
    const srv = await listen(appWith(auth));
    try {
      const r = await quiet(() => call(`${srv.url}/who`, { token: fakeJwt() }));
      assert.equal(r.status, 503);
    } finally { await srv.close(); }
  });

  it('answers 503 when the role lookup fails', async () => {
    const t = fakeJwt();
    const db = fakeSupabase({ users: { [t]: { id: U_LGU } }, fail: { 'lgu_admin:select': 'connection reset' } });
    const auth = createAuth({ supabase: db as any });
    const srv = await listen(appWith(auth));
    try {
      const r = await quiet(() => call(`${srv.url}/lgu`, { token: t }));
      assert.equal(r.status, 503);
    } finally { await srv.close(); }
  });
});

describe('requireRole', () => {
  const { db, tokens } = world();
  const auth = createAuth({ supabase: db as any });
  let srv: Awaited<ReturnType<typeof listen>>;
  before(async () => { srv = await listen(appWith(auth)); });
  after(async () => { await srv.close(); });

  it('lets an Active LGU administrator in and nobody else', async () => {
    assert.equal((await call(`${srv.url}/lgu`, { token: tokens.tLgu })).status, 200);
    for (const t of [tokens.tToda, tokens.tDrv, tokens.tPax, tokens.tNone]) assert.equal((await call(`${srv.url}/lgu`, { token: t })).status, 403);
  });
  it('refuses a SUSPENDED LGU administrator', async () => {
    assert.equal((await call(`${srv.url}/lgu`, { token: tokens.tSusp })).status, 403);
  });
  it('an account with no role row at all (anybody can sign up) gets 403 everywhere', async () => {
    for (const p of ['lgu', 'toda', 'driver', 'staff']) assert.equal((await call(`${srv.url}/${p}`, { token: tokens.tNone })).status, 403, p);
  });
  it('lets a TODA administrator in to toda and staff routes, not to the LGU ones', async () => {
    assert.equal((await call(`${srv.url}/toda`, { token: tokens.tToda })).status, 200);
    assert.equal((await call(`${srv.url}/staff`, { token: tokens.tToda })).status, 200);
    assert.equal((await call(`${srv.url}/lgu`, { token: tokens.tToda })).status, 403);
  });
  it('driver role: any driver record qualifies (routes add their own status rules)', async () => {
    assert.equal((await call(`${srv.url}/driver`, { token: tokens.tDrv })).status, 200);
    assert.equal((await call(`${srv.url}/driver`, { token: tokens.tPax })).status, 403);
  });
  it('a role change shows up once the short cache expires', async () => {
    const { db: d2, tokens: t2 } = world();
    let t = 9_000_000;
    const a2 = createAuth({ supabase: d2 as any, ttlMs: 30_000, now: () => t });
    const s2 = await listen(appWith(a2));
    try {
      assert.equal((await call(`${s2.url}/lgu`, { token: t2.tLgu })).status, 200);
      d2.tables.lgu_admin[0].account_status = 'Suspended';
      assert.equal((await call(`${s2.url}/lgu`, { token: t2.tLgu })).status, 200, 'still cached');
      t += 31_000;
      assert.equal((await call(`${s2.url}/lgu`, { token: t2.tLgu })).status, 403, 'suspension takes effect within the ttl');
    } finally { await s2.close(); }
  });
});
