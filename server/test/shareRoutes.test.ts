// Share Live Trip: GET /api/share/:token/driver-photo (Rule 26.1). The page has no account; what stands in for the sign-in is the link itself, checked by the
// database on every request (get_shared_trip_photo_path). What is checked HERE is the route: a bad token never reaches the database, a link the database does not
// vouch for gets the same empty 404 as a missing one, a good one is sent on to a file signed for a minute, and nothing is cached.
//   run:  cd server && npx tsx --test test/shareRoutes.test.ts
import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app';
import { createAuth } from '../src/middleware/auth';
import { listen, fakeSupabase } from './helpers';

const LIVE = 'a'.repeat(32);
const ENDED = 'b'.repeat(32);
const FOREIGN = 'c'.repeat(32);

function makeDb() {
  const base = fakeSupabase({
    rpc: {
      get_shared_trip_photo_path: (a) => {
        if (a.p_token === LIVE) return { data: 'driver-auth-id/avatar-1.jpg' };
        if (a.p_token === FOREIGN) return { data: '../someone-else/selfie.jpg' };
        return { data: null };        // ended, revoked or unknown: the database says nothing
      },
    },
  });
  const signed: { bucket: string; path: string; seconds: number }[] = [];
  const db: any = {
    ...base,
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, seconds: number) => {
          signed.push({ bucket, path, seconds });
          return { data: { signedUrl: `https://files.example/${bucket}/${path}?token=t` }, error: null };
        },
      }),
    },
  };
  return { db, signed, calls: base.calls };
}

describe('GET /api/share/:token/driver-photo', () => {
  let srv: Awaited<ReturnType<typeof listen>>;
  let ctx: ReturnType<typeof makeDb>;
  before(async () => {
    ctx = makeDb();
    srv = await listen(createApp({ supabase: ctx.db, auth: createAuth({ supabase: ctx.db }), env: { NODE_ENV: 'test' } }));
  });
  after(async () => { await srv.close(); });

  const get = (token: string) => fetch(`${srv.url}/api/share/${token}/driver-photo`, { redirect: 'manual' });

  it('needs no sign-in and sends a live link on to the file, signed for one minute from the profiles bucket', async () => {
    const res = await get(LIVE);
    assert.equal(res.status, 302);
    assert.match(String(res.headers.get('location')), /^https:\/\/files\.example\/profiles\/driver-auth-id\/avatar-1\.jpg\?token=/);
    assert.deepEqual(ctx.signed.at(-1), { bucket: 'profiles', path: 'driver-auth-id/avatar-1.jpg', seconds: 60 });
  });

  it('is never cached and may be shown by the page from another origin', async () => {
    const res = await get(LIVE);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');
  });

  it('answers a token the database does not vouch for (ended, revoked, unknown) with an empty 404', async () => {
    const res = await get(ENDED);
    assert.equal(res.status, 404);
    assert.equal(await res.text(), '');
  });

  it('refuses a path that leaves the driver\'s folder, and signs nothing', async () => {
    const before = ctx.signed.length;
    const res = await get(FOREIGN);
    assert.equal(res.status, 404);
    assert.equal(ctx.signed.length, before);
  });

  it('does not even ask the database about a token that is not 32 hex characters', async () => {
    const asked = ctx.calls.rpc.length;
    for (const bad of ['short', 'Z'.repeat(32), `${'a'.repeat(31)}%2F`, 'a'.repeat(33)]) {
      const res = await get(bad);
      assert.equal(res.status, 404, bad);
    }
    assert.equal(ctx.calls.rpc.length, asked);
  });

  it('does not open anything else without a sign-in: the default deny still holds', async () => {
    const res = await fetch(`${srv.url}/api/admin/todas`);
    assert.equal(res.status, 401);
  });
});
