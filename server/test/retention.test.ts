// Batch 12 (Rules 28.1 - 28.4): the server's part of the retention schedule (the identity images the database says are due are deleted through the Storage API and confirmed),
// the scheduler endpoint's secret guard, and the retired Express routes (the audit log and the TODA decisions belong to the database and answer 403 for everyone).
import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app';
import { createAuth } from '../src/middleware/auth';
import { IDENTITY_IMAGE_BUCKETS, purgeIdentityImages, storagePathOf } from '../src/services/retentionService';
import { call, fakeJwt, fakeSupabase, listen, quiet, uuid } from './helpers';

describe('storagePathOf', () => {
  it('a stored path is returned as it is, without a leading slash, and names no bucket', () => {
    assert.deepEqual(storagePathOf('driver-1/license-front.jpg'), { bucket: null, path: 'driver-1/license-front.jpg' });
    assert.deepEqual(storagePathOf('/driver-1/license-front.jpg'), { bucket: null, path: 'driver-1/license-front.jpg' });
  });
  it('an older row that holds a full storage URL gives the bucket and the object path (query string and encoding removed)', () => {
    assert.deepEqual(storagePathOf('https://abc.supabase.co/storage/v1/object/public/mtop-permits/d%201/permit.jpg'), { bucket: 'mtop-permits', path: 'd 1/permit.jpg' });
    assert.deepEqual(storagePathOf('https://abc.supabase.co/storage/v1/object/sign/driver-licenses/d1/front.jpg?token=eyJ'), { bucket: 'driver-licenses', path: 'd1/front.jpg' });
    assert.deepEqual(storagePathOf('https://abc.supabase.co/storage/v1/object/authenticated/tricycle-photos/d1/t.jpg'), { bucket: 'tricycle-photos', path: 'd1/t.jpg' });
  });
  it('nothing, or whitespace, is an empty path (never removed, never confirmed)', () => {
    assert.deepEqual(storagePathOf(undefined as unknown as string), { bucket: null, path: '' });
    assert.deepEqual(storagePathOf('   '), { bucket: null, path: '' });
  });
  it('the three private identity buckets are the ones searched', () => {
    assert.deepEqual([...IDENTITY_IMAGE_BUCKETS], ['driver-licenses', 'mtop-permits', 'tricycle-photos']);
  });
});

interface Due { retention_id: string; storage_path: string; reason: string }

/** A stand-in for the service-role client: the queue the database holds (rows come back until they are confirmed), the buckets, and a record of every call. */
function fakeStorageDb(rows: Due[], o: { failBuckets?: string[]; failPaths?: string[]; fetchError?: string; confirmError?: string } = {}) {
  const confirmedIds = new Set<string>();
  const log = { fetches: [] as number[], removed: [] as { bucket: string; path: string }[], confirms: [] as string[][] };
  const db = {
    rpc: async (name: string, args: Record<string, any>) => {
      if (name === 'get_expired_identity_documents') {
        log.fetches.push(args.p_limit);
        if (o.fetchError) return { data: null, error: { message: o.fetchError } };
        return { data: rows.filter((r) => !confirmedIds.has(r.retention_id)).slice(0, args.p_limit), error: null };
      }
      if (name === 'confirm_identity_documents_purged') {
        log.confirms.push(args.p_ids);
        if (o.confirmError) return { data: null, error: { message: o.confirmError } };
        for (const id of args.p_ids) confirmedIds.add(id);
        return { data: args.p_ids.length, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          for (const path of paths) log.removed.push({ bucket, path });
          const bad = (o.failBuckets ?? []).includes(bucket) || paths.some((p) => (o.failPaths ?? []).includes(p));
          return { error: bad ? { message: 'bucket refused' } : null };
        },
      }),
    },
  };
  return { db: db as any, log, confirmedIds };
}
const due = (n: number, path = `d${n}/front.jpg`): Due => ({ retention_id: uuid(1000 + n), storage_path: path, reason: 'SUPERSEDED' });

describe('purgeIdentityImages', () => {
  it('removes each due image from the private buckets and confirms exactly those to the database', async () => {
    const { db, log, confirmedIds } = fakeStorageDb([due(1), due(2)]);
    const r = await purgeIdentityImages(db);
    assert.deepEqual(r, { due: 2, removed: 2, failed: 0 });
    assert.equal(log.removed.length, 2 * IDENTITY_IMAGE_BUCKETS.length, 'a bare path is removed from every identity bucket (a stored path does not say which one)');
    assert.deepEqual([...confirmedIds].sort(), [uuid(1001), uuid(1002)]);
    assert.equal(log.confirms.length, 1, 'one confirmation for the batch');
  });
  it('a full URL names its bucket: only that bucket is touched', async () => {
    const { db, log } = fakeStorageDb([due(1, 'https://x.supabase.co/storage/v1/object/public/mtop-permits/d1/permit.jpg')]);
    const r = await purgeIdentityImages(db);
    assert.equal(r.removed, 1);
    assert.deepEqual(log.removed, [{ bucket: 'mtop-permits', path: 'd1/permit.jpg' }]);
  });
  it('an image a bucket refuses to remove is NOT confirmed (it stays in the queue for the next run); the others are', async () => {
    const { db, log, confirmedIds } = fakeStorageDb([due(1), due(2), due(3)], { failPaths: ['d2/front.jpg'] });
    const r = await purgeIdentityImages(db);
    assert.deepEqual(r, { due: 3, removed: 2, failed: 1 });
    assert.ok(!confirmedIds.has(uuid(1002)) && confirmedIds.has(uuid(1001)) && confirmedIds.has(uuid(1003)));
    assert.deepEqual(log.confirms.flat().sort(), [uuid(1001), uuid(1003)]);
  });
  it('a refused image that the database returns again is not retried in the same run, and the run ends (no endless loop)', async () => {
    const { db, log } = fakeStorageDb([due(1), due(2), due(3)], { failPaths: ['d2/front.jpg'] });
    const r = await purgeIdentityImages(db, 2, 10);
    assert.deepEqual(r, { due: 3, removed: 2, failed: 1 });
    assert.equal(log.removed.filter((x) => x.path === 'd2/front.jpg').length, 1, 'tried once (the first bucket refused, so the others were not tried), not again in the next batch');
    assert.ok(log.fetches.length <= 3);
  });
  it('an empty stored path is never removed and never confirmed', async () => {
    const { db, log, confirmedIds } = fakeStorageDb([due(1, '   ')]);
    const r = await purgeIdentityImages(db);
    assert.deepEqual(r, { due: 1, removed: 0, failed: 1 });
    assert.equal(log.removed.length, 0);
    assert.equal(confirmedIds.size, 0);
  });
  it('nothing due: nothing removed, nothing confirmed, one look at the queue', async () => {
    const { db, log } = fakeStorageDb([]);
    assert.deepEqual(await purgeIdentityImages(db), { due: 0, removed: 0, failed: 0 });
    assert.equal(log.confirms.length, 0);
    assert.equal(log.fetches.length, 1);
  });
  it('works through a long queue in batches and stops at the per-run limit (2 batches of 2 = 4 of 5)', async () => {
    const { db, log } = fakeStorageDb([due(1), due(2), due(3), due(4), due(5)]);
    const r = await purgeIdentityImages(db, 2, 2);
    assert.deepEqual(r, { due: 4, removed: 4, failed: 0 });
    assert.deepEqual(log.fetches, [2, 2]);
  });
  it('a database error is thrown with the function name (the scheduler answers 500, nothing is half-confirmed silently)', async () => {
    await assert.rejects(purgeIdentityImages(fakeStorageDb([due(1)], { fetchError: 'permission denied' }).db), /get_expired_identity_documents: permission denied/);
    await assert.rejects(purgeIdentityImages(fakeStorageDb([due(1)], { confirmError: 'boom' }).db), /confirm_identity_documents_purged: boom/);
  });
});

const U = { lgu: uuid(1), toda1: uuid(2), pax: uuid(5) };
const T1 = uuid(900);
const tok = { lgu: fakeJwt(), toda1: fakeJwt(), pax: fakeJwt() };
function makeDb() {
  return fakeSupabase({
    users: Object.fromEntries((Object.keys(tok) as (keyof typeof tok)[]).map((k) => [tok[k], { id: U[k] }])),
    tables: {
      lgu_admin: [{ auth_user_id: U.lgu, admin_id: uuid(11), account_status: 'Active' }],
      toda_admin: [{ auth_user_id: U.toda1, admin_id: uuid(12), toda_id: T1, account_status: 'Active' }],
      passenger: [{ auth_user_id: U.pax, passenger_id: uuid(15), account_status: 'Active', contact_number: '+639170000005' }],
    },
  });
}

describe('the audit log and the TODA decisions are the database\'s, not Express\'s (Rule 28.4)', () => {
  let srv: Awaited<ReturnType<typeof listen>>;
  before(async () => { srv = await listen(createApp({ auth: createAuth({ supabase: makeDb() as any }), env: { NODE_ENV: 'test' } })); });
  after(async () => { await srv.close(); });

  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
    it(`${method} /api/admin/audit-logs answers 403 for the LGU Administrator: no invented sample entries, no entry written with the service-role key`, async () => {
      const r = await quiet(() => call(`${srv.url}/api/admin/audit-logs`, { method, token: tok.lgu, body: method === 'GET' ? undefined : { action_type: 'FORGED', admin_name: 'Somebody' } }));
      assert.equal(r.status, 403);
      assert.match(r.json.error, /get_audit_log/);
    });
  }
  it('/api/admin/audit-logs/export and any sub-path answer 403 too', async () => {
    assert.equal((await quiet(() => call(`${srv.url}/api/admin/audit-logs/export`, { token: tok.lgu }))).status, 403);
  });
  it('a TODA Administrator and a passenger never reach it (403 from the role gate), and a visitor gets 401', async () => {
    assert.equal((await quiet(() => call(`${srv.url}/api/admin/audit-logs`, { token: tok.toda1 }))).status, 403);
    assert.equal((await quiet(() => call(`${srv.url}/api/admin/audit-logs`, { token: tok.pax }))).status, 403);
    assert.equal((await quiet(() => call(`${srv.url}/api/admin/audit-logs`))).status, 401);
  });
  for (const action of ['approve', 'return-correction', 'reject', 'decline']) {
    it(`POST /api/admin/todas/:id/${action} answers 403 for the LGU Administrator (the decision is made by the database function, which checks the caller and writes the audit entry)`, async () => {
      const r = await quiet(() => call(`${srv.url}/api/admin/todas/${T1}/${action}`, { method: 'POST', token: tok.lgu, body: { adminName: 'Somebody', remarks: 'x' } }));
      assert.equal(r.status, 403);
      assert.match(r.json.error, /approve_toda_accreditation|return_toda_accreditation|deactivate_toda_accreditation/);
    });
  }
  it('the same decisions are refused to a TODA Administrator of that TODA', async () => {
    assert.equal((await quiet(() => call(`${srv.url}/api/admin/todas/${T1}/approve`, { method: 'POST', token: tok.toda1, body: {} }))).status, 403);
  });
});

describe('POST /api/scheduler/run-retention', () => {
  const path = '/api/scheduler/run-retention';
  it('is disabled (503) while SCHEDULER_SECRET is not set, for everyone', async () => {
    const srv = await listen(createApp({ auth: createAuth({ supabase: makeDb() as any }), env: { NODE_ENV: 'test' } }));
    process.env.SCHEDULER_SECRET = '';
    try {
      for (const headers of [{}, { 'X-Scheduler-Secret': 'sakay-internal-scheduler-secret' }]) {
        assert.equal((await quiet(() => call(`${srv.url}${path}`, { method: 'POST', headers, body: {} }))).status, 503);
      }
    } finally { await srv.close(); }
  });
  it('with a real secret: no secret, a wrong secret and a user\'s token are 401; the right secret passes the guard', async () => {
    const srv = await listen(createApp({ auth: createAuth({ supabase: makeDb() as any }), env: { NODE_ENV: 'test' } }));
    process.env.SCHEDULER_SECRET = 'a-long-random-scheduler-secret-123';
    try {
      assert.equal((await quiet(() => call(`${srv.url}${path}`, { method: 'POST', body: {} }))).status, 401);
      assert.equal((await quiet(() => call(`${srv.url}${path}`, { method: 'POST', headers: { 'X-Scheduler-Secret': 'a-long-random-scheduler-secret-124' }, body: {} }))).status, 401);
      assert.equal((await quiet(() => call(`${srv.url}${path}`, { method: 'POST', token: tok.lgu, body: {} }))).status, 401, 'an LGU token is not the scheduler secret');
      assert.equal((await quiet(() => call(`${srv.url}${path}`, { method: 'POST', headers: { 'X-Scheduler-Secret': 'a-long-random-scheduler-secret-123' }, body: {} }))).status, 503, 'passed the guard; this test app has no database');
    } finally { process.env.SCHEDULER_SECRET = ''; await srv.close(); }
  });
  it('only POST is answered', async () => {
    const srv = await listen(createApp({ auth: createAuth({ supabase: makeDb() as any }), env: { NODE_ENV: 'test' } }));
    process.env.SCHEDULER_SECRET = 'a-long-random-scheduler-secret-123';
    try {
      const r = await quiet(() => call(`${srv.url}${path}`, { method: 'GET', headers: { 'X-Scheduler-Secret': 'a-long-random-scheduler-secret-123' } }));
      assert.ok(r.status >= 400 && !r.json?.success, `GET answered ${r.status}: the job is not run by a GET`);
    } finally { process.env.SCHEDULER_SECRET = ''; await srv.close(); }
  });
});
