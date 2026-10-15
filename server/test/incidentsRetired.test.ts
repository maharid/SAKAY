// Batch 11: the in-memory sample "incident" route is no longer mounted: the LGU administrator gets a 404, not sample reports, and the reviews happen in the database.
import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/app';
import { createAuth } from '../src/middleware/auth';
import { call, fakeJwt, fakeSupabase, listen, uuid } from './helpers';

const LGU = uuid(1);
const token = fakeJwt();

describe('the mock incident route is gone', () => {
  let srv: Awaited<ReturnType<typeof listen>>;
  before(async () => {
    const db = fakeSupabase({ users: { [token]: { id: LGU } }, tables: { lgu_admin: [{ auth_user_id: LGU, admin_id: uuid(11), account_status: 'Active' }] } });
    srv = await listen(createApp({ auth: createAuth({ supabase: db as any }), env: { NODE_ENV: 'test' } }));
  });
  after(async () => { await srv.close(); });

  it('GET /api/admin/incidents answers 404 for the LGU administrator (no sample reports)', async () => {
    assert.equal((await call(`${srv.url}/api/admin/incidents`, { token })).status, 404);
  });
  it('PATCH /api/admin/incidents/:id/status answers 404 too (nothing real was ever written by it)', async () => {
    assert.equal((await call(`${srv.url}/api/admin/incidents/INC-2026-001/status`, { method: 'PATCH', token, body: { status: 'Resolved' } })).status, 404);
  });
  it('app.ts does not import or mount the route file', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src', 'app.ts'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.ok(!/incidentRoutes/.test(src), 'app.ts must not mention incidentRoutes outside comments');
  });
});
