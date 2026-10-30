// What an uploaded file really is, from its first bytes (panel comment 15, decision D-P7). The same functions run in the apps before an upload and in the server's upload scan.
//   run:  cd server && npx tsx --test test/fileSignature.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkUploadMatchesKind, detectFileKind, kindIsAllowed, mimeMatchesKind } from '../../packages/shared/src/utils/fileSignature';
import { UploadRejectedError, prepareUpload, uploadProblemMessage } from '../../packages/shared/src/utils/uploadGuard';

const bytes = (...v: number[]) => new Uint8Array(v);
const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d);
const WEBP = new Uint8Array([...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WEBPVP8 ')]);
const PDF = ascii('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n');
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0, 6, 0);
const OLE = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0);
const EXE = ascii('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00');
const SCRIPT = ascii('#!/bin/sh\nrm -rf /\n');
const CSV = ascii('Member Name,Franchise No.,Plate\nJuan Dela Cruz,F-001,ABC 123\n');

describe('detectFileKind', () => {
  it('recognises the kinds the apps accept from their first bytes', () => {
    assert.equal(detectFileKind(JPEG), 'jpeg');
    assert.equal(detectFileKind(PNG), 'png');
    assert.equal(detectFileKind(WEBP), 'webp');
    assert.equal(detectFileKind(PDF), 'pdf');
    assert.equal(detectFileKind(ZIP), 'zip');
    assert.equal(detectFileKind(OLE), 'ole');
    assert.equal(detectFileKind(ascii('GIF89a\x01\x00')), 'gif');
  });
  it('calls plain text "text" (a .csv has no signature) and refuses everything else', () => {
    assert.equal(detectFileKind(CSV), 'text');
    assert.equal(detectFileKind(EXE), 'unknown');           // a Windows program (it has control characters)
    assert.equal(detectFileKind(bytes(0, 1, 2, 3, 4, 5)), 'unknown');
    assert.equal(detectFileKind(new Uint8Array(0)), 'unknown');
  });
  it('does not take a RIFF file that is not WebP (a WAV sound, an AVI video) for an image', () => {
    assert.notEqual(detectFileKind(new Uint8Array([...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WAVEfmt ')])), 'webp');
  });
  it('a script is text, so a screen that accepts only photos or PDFs refuses it (text is allowed only where a .csv is)', () => {
    assert.equal(detectFileKind(SCRIPT), 'text');
    assert.equal(kindIsAllowed(detectFileKind(SCRIPT), ['image', 'pdf']), false);
  });
});

describe('kindIsAllowed and mimeMatchesKind', () => {
  it('maps what a screen accepts onto the kinds', () => {
    assert.equal(kindIsAllowed('jpeg', ['image']), true);
    assert.equal(kindIsAllowed('pdf', ['image']), false);
    assert.equal(kindIsAllowed('zip', ['spreadsheet']), true);
    assert.equal(kindIsAllowed('ole', ['spreadsheet']), true);
    assert.equal(kindIsAllowed('text', ['csv']), true);
    assert.equal(kindIsAllowed('gif', ['image']), false);
    assert.equal(kindIsAllowed('unknown', ['image', 'pdf', 'spreadsheet', 'csv']), false);
  });
  it('compares the declared file type with what the bytes are', () => {
    assert.equal(mimeMatchesKind('image/jpeg', 'jpeg'), true);
    assert.equal(mimeMatchesKind('image/jpeg; charset=binary', 'jpeg'), true);
    assert.equal(mimeMatchesKind('image/png', 'jpeg'), false);
    assert.equal(mimeMatchesKind('application/pdf', 'jpeg'), false);
    assert.equal(mimeMatchesKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'zip'), true);
    assert.equal(mimeMatchesKind('text/csv', 'text'), true);
    assert.equal(mimeMatchesKind('', 'jpeg'), false);
    assert.equal(mimeMatchesKind(null, 'pdf'), false);
  });
});

describe('checkUploadMatchesKind', () => {
  const file = (data: Uint8Array, type: string) => new Blob([data as BlobPart], { type });
  it('accepts a real photo that says so', async () => {
    assert.deepEqual(await checkUploadMatchesKind(file(JPEG, 'image/jpeg'), ['image']), { ok: true, kind: 'jpeg', reason: '' });
  });
  it('accepts a file whose browser type is empty (some phones leave it blank)', async () => {
    assert.deepEqual(await checkUploadMatchesKind(file(PDF, ''), ['pdf']), { ok: true, kind: 'pdf', reason: '' });
  });
  it('refuses a program renamed as a photo, in the screen\'s language', async () => {
    const en = await checkUploadMatchesKind(file(EXE, 'image/jpeg'), ['image']);
    assert.equal(en.ok, false);
    assert.match(en.reason, /not accepted/);
    const tl = await checkUploadMatchesKind(file(EXE, 'image/jpeg'), ['image'], 'tl');
    assert.match(tl.reason, /Hindi tanggap/);
  });
  it('refuses a file that is a real PDF but claims to be a photo (the type and the bytes disagree)', async () => {
    const r = await checkUploadMatchesKind(file(PDF, 'image/jpeg'), ['image', 'pdf']);
    assert.equal(r.ok, false);
    assert.match(r.reason, /does not match/);
  });
  it('refuses a real photo on a screen that wants a PDF', async () => {
    const r = await checkUploadMatchesKind(file(PNG, 'image/png'), ['pdf']);
    assert.equal(r.ok, false);
  });
  it('accepts an .xlsx and a .csv on a roster screen, and refuses a Windows program claiming to be a .csv', async () => {
    assert.equal((await checkUploadMatchesKind(file(ZIP, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), ['spreadsheet', 'csv'])).ok, true);
    assert.equal((await checkUploadMatchesKind(file(CSV, 'text/csv'), ['spreadsheet', 'csv'])).ok, true);
    assert.equal((await checkUploadMatchesKind(file(EXE, 'text/csv'), ['spreadsheet', 'csv'])).ok, false);
  });
  it('refuses an empty file', async () => {
    assert.equal((await checkUploadMatchesKind(file(new Uint8Array(0), 'image/jpeg'), ['image'])).ok, false);
  });
});

describe('prepareUpload', () => {
  const file = (data: Uint8Array, type: string) => new Blob([data as BlobPart], { type });
  it('returns the same file when it is fine and needs no changing (outside a browser a photo cannot be re-drawn, so it is returned as it is)', async () => {
    const f = file(PDF, 'application/pdf');
    assert.equal(await prepareUpload(f, ['pdf']), f);
    const photo = file(JPEG, 'image/jpeg');
    assert.equal(await prepareUpload(photo, ['image']), photo);
    assert.equal(await prepareUpload(photo, ['image'], { stripMetadata: false }), photo);
  });
  it('throws UploadRejectedError with a readable sentence for a refused file', async () => {
    await assert.rejects(() => prepareUpload(file(EXE, 'image/jpeg'), ['image'], { language: 'tl' }), (e: unknown) => e instanceof UploadRejectedError && /Hindi tanggap/.test(e.message));
  });
  it('says something readable for any other error', () => {
    assert.match(uploadProblemMessage(new Error('network down')), /could not be uploaded/);
    assert.match(uploadProblemMessage(new Error('network down'), 'tl'), /Hindi na-upload/);
    assert.equal(uploadProblemMessage(new UploadRejectedError('Nope.')), 'Nope.');
  });
});
