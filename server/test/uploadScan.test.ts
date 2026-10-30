// The server's check of what is already stored (panel comment 15, decision D-P7): a file whose first bytes are not what its bucket accepts, or not what its stored type says, is moved to
// the bucket's _quarantine folder. Nothing is deleted; only the first bytes are read. Also: the server's file signature code agrees with the apps', and the endpoint is for the scheduler only.
//   run:  cd server && npx tsx --test test/uploadScan.test.ts
import './env';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app';
import { createAuth } from '../src/middleware/auth';
import { QUARANTINE_FOLDER, SCAN_BUCKETS, describeScan, scanUploads } from '../src/services/uploadScanService';
import * as server from '../src/utils/fileSignature';
import * as shared from '../../packages/shared/src/utils/fileSignature';
import { call, fakeSupabase, listen, quiet } from './helpers';

const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const PDF = ascii('%PDF-1.7\n%abc\n');
const XLSX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 6, 0]);
const EXE = ascii('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00');
const CSV = ascii('Member Name,Franchise No.\nJuan,F-1\n');

interface Stored { bytes: Uint8Array; mimetype: string | null; updated: string; size?: number }

/** A storage API in memory: buckets of "folder/name" files, listing one level at a time, signed links, and move */
function fakeStorage(buckets: Record<string, Record<string, Stored>>) {
  const moves: Array<{ bucket: string; from: string; to: string }> = [];
  const failMove = new Set<string>();
  const listFailures = new Set<string>();
  const db = {
    storage: {
      from: (bucket: string) => ({
        list: async (prefix: string, opts: { limit: number; offset: number }) => {
          if (listFailures.has(bucket)) return { data: null, error: { message: 'bucket unavailable' } };
          const files = buckets[bucket] ?? {};
          const names = Object.keys(files);
          let entries: Array<Record<string, unknown>>;
          if (prefix === '') {
            entries = [...new Set(names.map((n) => n.split('/')[0]))].sort().map((name) => ({ name, id: null }));
          } else {
            entries = names.filter((n) => n.startsWith(prefix + '/')).sort().map((n) => ({
              name: n.slice(prefix.length + 1), id: 'obj-' + n, created_at: files[n].updated, updated_at: files[n].updated,
              metadata: { mimetype: files[n].mimetype, size: files[n].size ?? files[n].bytes.length },
            }));
          }
          return { data: entries.slice(opts.offset, opts.offset + opts.limit), error: null };
        },
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://storage.test/${bucket}/${path}` }, error: null }),
        move: async (from: string, to: string) => {
          if (failMove.has(from)) return { data: null, error: { message: 'move refused' } };
          const files = buckets[bucket];
          files[to] = files[from];
          delete files[from];
          moves.push({ bucket, from, to });
          return { data: { message: 'Successfully moved' }, error: null };
        },
      }),
    },
  };
  const fetchImpl = (async (url: string, init?: { headers?: Record<string, string> }) => {
    const m = String(url).match(/^https:\/\/storage\.test\/([^/]+)\/(.+)$/);
    const file = m ? buckets[m[1]]?.[m[2]] : undefined;
    assert.equal(init?.headers?.Range, 'bytes=0-511', 'only the first 512 bytes are asked for');
    if (!file) return new Response('not found', { status: 404 });
    return new Response(file.bytes.slice(0, 512) as BodyInit, { status: 206 });
  }) as unknown as typeof fetch;
  return { db: db as never, moves, failMove, listFailures, fetchImpl, buckets };
}

const NOW = new Date('2026-10-31T12:00:00Z');
const recent = '2026-10-31T09:00:00Z';
const old = '2026-09-01T09:00:00Z';

describe('scanUploads', () => {
  it('leaves files that are what they say alone, in every bucket', async () => {
    const s = fakeStorage({
      'driver-licenses': { 'u1/front.jpg': { bytes: JPEG, mimetype: 'image/jpeg', updated: recent } },
      'barangay-clearances': { 'u2/1_clearance.pdf': { bytes: PDF, mimetype: 'application/pdf', updated: recent }, 'u2/2_clearance.png': { bytes: PNG, mimetype: 'image/png', updated: recent } },
      'toda-accredited-driver-lists': {
        'u2/1_drivers.xlsx': { bytes: XLSX, mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', updated: recent },
        'u2/2_drivers.csv': { bytes: CSV, mimetype: 'text/csv', updated: recent },
      },
    });
    const r = await scanUploads(s.db, { now: NOW, fetchImpl: s.fetchImpl });
    assert.equal(r.checked, 5);
    assert.deepEqual(r.findings, []);
    assert.deepEqual(r.errors, []);
    assert.equal(s.moves.length, 0);
  });

  it('moves a program renamed as a photo to the quarantine folder, and says why', async () => {
    const s = fakeStorage({ 'profiles': { 'u1/avatar-1.jpg': { bytes: EXE, mimetype: 'image/jpeg', updated: recent } } });
    const r = await scanUploads(s.db, { now: NOW, fetchImpl: s.fetchImpl });
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].bucket, 'profiles');
    assert.equal(r.findings[0].path, 'u1/avatar-1.jpg');
    assert.equal(r.findings[0].quarantined, true);
    assert.match(r.findings[0].reason, /content is unknown/);
    assert.deepEqual(s.moves, [{ bucket: 'profiles', from: 'u1/avatar-1.jpg', to: `${QUARANTINE_FOLDER}/u1/avatar-1.jpg` }]);
    assert.ok(s.buckets.profiles[`${QUARANTINE_FOLDER}/u1/avatar-1.jpg`], 'the file is kept, not deleted');
    assert.equal(s.buckets.profiles['u1/avatar-1.jpg'], undefined);
  });

  it('a real PDF stored as an image is found (the type and the bytes disagree), and so is a PDF in a bucket that accepts only photos', async () => {
    const s = fakeStorage({
      'barangay-clearances': { 'u1/1.pdf': { bytes: PDF, mimetype: 'image/jpeg', updated: recent } },
      'tricycle-photos': { 'u1/trike.jpg': { bytes: PDF, mimetype: 'application/pdf', updated: recent } },
    });
    const r = await scanUploads(s.db, { now: NOW, fetchImpl: s.fetchImpl });
    assert.equal(r.findings.length, 2);
    assert.match(r.findings.find((f) => f.bucket === 'barangay-clearances')!.reason, /stored type is image\/jpeg, but its content is pdf/);
    assert.match(r.findings.find((f) => f.bucket === 'tricycle-photos')!.reason, /accepts image/);
  });

  it('an Excel file is fine in the roster bucket and not in a photo bucket', async () => {
    const s = fakeStorage({
      'toda-accredited-driver-lists': { 'u1/d.xlsx': { bytes: XLSX, mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', updated: recent } },
      'mtop-permits': { 'u1/mtop.jpg': { bytes: XLSX, mimetype: 'image/jpeg', updated: recent } },
    });
    const r = await scanUploads(s.db, { now: NOW, fetchImpl: s.fetchImpl });
    assert.deepEqual(r.findings.map((f) => f.bucket), ['mtop-permits']);
  });

  it('an empty file is found without being read', async () => {
    const s = fakeStorage({ 'incident-evidence': { 'u1/1-1.jpg': { bytes: new Uint8Array(0), mimetype: 'image/jpeg', updated: recent, size: 0 } } });
    const r = await scanUploads(s.db, { now: NOW, fetchImpl: s.fetchImpl });
    assert.equal(r.findings.length, 1);
    assert.match(r.findings[0].reason, /empty/);
  });

  it('only looks at files added or changed in the window, and never at the quarantine folder', async () => {
    const s = fakeStorage({
      'profiles': {
        'u1/old.jpg': { bytes: EXE, mimetype: 'image/jpeg', updated: old },
        [`${QUARANTINE_FOLDER}/u1/earlier.jpg`]: { bytes: EXE, mimetype: 'image/jpeg', updated: recent },
        'u1/new.jpg': { bytes: EXE, mimetype: 'image/jpeg', updated: recent },
      },
    });
    const r = await scanUploads(s.db, { now: NOW, fetchImpl: s.fetchImpl });
    assert.equal(r.checked, 1);
    assert.equal(r.skipped, 1);
    assert.deepEqual(r.findings.map((f) => f.path), ['u1/new.jpg']);
    // u1/new.jpg is now in the quarantine folder (which is never scanned again); a wider window finds the older file the first run did not look at
    const wide = await scanUploads(s.db, { now: NOW, fetchImpl: s.fetchImpl, sinceHours: 24 * 90, quarantine: false });
    assert.deepEqual(wide.findings.map((f) => f.path), ['u1/old.jpg']);
  });

  it('with quarantine off it only reports', async () => {
    const s = fakeStorage({ 'profiles': { 'u1/a.jpg': { bytes: EXE, mimetype: 'image/jpeg', updated: recent } } });
    const r = await scanUploads(s.db, { now: NOW, fetchImpl: s.fetchImpl, quarantine: false });
    assert.equal(r.findings[0].quarantined, false);
    assert.equal(s.moves.length, 0);
  });

  it('a file that cannot be moved is still reported, with the error, and the run goes on', async () => {
    const s = fakeStorage({ 'profiles': { 'u1/a.jpg': { bytes: EXE, mimetype: 'image/jpeg', updated: recent }, 'u1/b.jpg': { bytes: EXE, mimetype: 'image/jpeg', updated: recent } } });
    s.failMove.add('u1/a.jpg');
    const r = await scanUploads(s.db, { now: NOW, fetchImpl: s.fetchImpl });
    assert.equal(r.findings.length, 2);
    assert.equal(r.findings.find((f) => f.path === 'u1/a.jpg')!.quarantined, false);
    assert.equal(r.findings.find((f) => f.path === 'u1/b.jpg')!.quarantined, true);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /could not be moved to quarantine/);
  });

  it('a bucket that cannot be listed, and a file that cannot be read, are errors and do not stop the others', async () => {
    const s = fakeStorage({
      'driver-licenses': { 'u1/front.jpg': { bytes: EXE, mimetype: 'image/jpeg', updated: recent } },
      'mtop-permits': { 'u1/mtop.jpg': { bytes: JPEG, mimetype: 'image/jpeg', updated: recent } },
      'profiles': { 'u1/a.jpg': { bytes: EXE, mimetype: 'image/jpeg', updated: recent } },
    });
    s.listFailures.add('driver-licenses');
    const failing = (async (url: string, init?: RequestInit) => (String(url).includes('/mtop-permits/') ? new Response('boom', { status: 500 }) : s.fetchImpl(url, init))) as unknown as typeof fetch;
    const r = await scanUploads(s.db, { now: NOW, fetchImpl: failing });
    assert.ok(r.errors.some((e) => /driver-licenses/.test(e) && /bucket unavailable/.test(e)));
    assert.ok(r.errors.some((e) => /mtop-permits\/u1\/mtop\.jpg/.test(e) && /HTTP 500/.test(e)));
    assert.deepEqual(r.findings.map((f) => f.bucket), ['profiles']);
  });

  it('stops at maxObjects', async () => {
    const files: Record<string, Stored> = {};
    for (let i = 0; i < 5; i++) files[`u1/${i}.jpg`] = { bytes: JPEG, mimetype: 'image/jpeg', updated: recent };
    const s = fakeStorage({ 'profiles': files });
    const r = await scanUploads(s.db, { now: NOW, fetchImpl: s.fetchImpl, maxObjects: 3 });
    assert.equal(r.checked, 3);
    assert.equal(r.skipped, 2);
  });

  it('can be limited to some buckets', async () => {
    const s = fakeStorage({ 'profiles': { 'u1/a.jpg': { bytes: EXE, mimetype: 'image/jpeg', updated: recent } }, 'mtop-permits': { 'u1/m.jpg': { bytes: EXE, mimetype: 'image/jpeg', updated: recent } } });
    const r = await scanUploads(s.db, { now: NOW, fetchImpl: s.fetchImpl }, ['mtop-permits']);
    assert.deepEqual(r.findings.map((f) => f.bucket), ['mtop-permits']);
  });

  it('describes a run for the audit log without ever saying what was inside a file', async () => {
    const s = fakeStorage({ 'profiles': { 'u1/a.jpg': { bytes: EXE, mimetype: 'image/jpeg', updated: recent } } });
    const text = describeScan(await scanUploads(s.db, { now: NOW, fetchImpl: s.fetchImpl }));
    assert.match(text, /1 file checked in 10 buckets, 1 not what it says\./);
    assert.match(text, /profiles\/u1\/a\.jpg .* moved to quarantine/);
  });

  it('covers the ten private buckets of the perimeter plus the case-evidence bucket', () => {
    assert.deepEqual(Object.keys(SCAN_BUCKETS).sort(), ['barangay-clearances', 'case-evidence', 'driver-licenses', 'incident-evidence', 'mtop-permits', 'profile-photos', 'profiles', 'toda-accredited-driver-lists', 'toda-bylaws', 'tricycle-photos']);
  });
});

describe('the server and the apps agree on what a file is', () => {
  const samples: Record<string, Uint8Array> = { JPEG, PNG, PDF, XLSX, EXE, CSV, EMPTY: new Uint8Array(0), GIF: ascii('GIF89a\x01\x00'), OLE: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), RIFF_WAV: new Uint8Array([...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WAVEfmt ')]) };
  it('detects the same kind for every sample', () => {
    for (const [name, bytes] of Object.entries(samples)) assert.equal(server.detectFileKind(bytes), shared.detectFileKind(bytes), name);
  });
  it('allows and matches the same way', () => {
    const kinds = ['jpeg', 'png', 'webp', 'gif', 'pdf', 'zip', 'ole', 'text', 'unknown'] as const;
    const ups = ['image', 'pdf', 'spreadsheet', 'csv'] as const;
    for (const k of kinds) {
      for (const u of ups) assert.equal(server.kindIsAllowed(k, [u]), shared.kindIsAllowed(k, [u]), `${k}/${u}`);
      for (const m of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/csv', 'application/vnd.ms-excel', 'application/octet-stream', '']) assert.equal(server.mimeMatchesKind(m, k), shared.mimeMatchesKind(m, k), `${k}/${m}`);
    }
    assert.equal(server.SIGNATURE_BYTES, shared.SIGNATURE_BYTES);
  });
});

describe('POST /api/scheduler/run-upload-scan', () => {
  const path = '/api/scheduler/run-upload-scan';
  const makeApp = async () => listen(createApp({ auth: createAuth({ supabase: fakeSupabase() as never }), env: { NODE_ENV: 'test' } }));
  it('is disabled (503) while SCHEDULER_SECRET is not set', async () => {
    const srv = await makeApp();
    process.env.SCHEDULER_SECRET = '';
    try {
      assert.equal((await quiet(() => call(`${srv.url}${path}`, { method: 'POST', body: {} }))).status, 503);
    } finally { await srv.close(); }
  });
  it('with a secret: no secret and a wrong secret are 401; the right one passes the guard (then 503 here: no database in the test)', async () => {
    const srv = await makeApp();
    process.env.SCHEDULER_SECRET = 'a-long-random-scheduler-secret-123';
    try {
      assert.equal((await quiet(() => call(`${srv.url}${path}`, { method: 'POST', body: {} }))).status, 401);
      assert.equal((await quiet(() => call(`${srv.url}${path}`, { method: 'POST', headers: { 'X-Scheduler-Secret': 'a-long-random-scheduler-secret-124' }, body: {} }))).status, 401);
      assert.equal((await quiet(() => call(`${srv.url}${path}`, { method: 'POST', headers: { 'X-Scheduler-Secret': 'a-long-random-scheduler-secret-123' }, body: {} }))).status, 503);
    } finally { process.env.SCHEDULER_SECRET = ''; await srv.close(); }
  });
});
