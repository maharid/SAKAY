// Incident reporting, the Urgent Safety Report, Share Live Trip and the calamity on the screens (Batch 11; packages/shared/src/utils/incidentReports.ts, incidentReview.ts, tripSafety.ts).
//   run:  cd server && npx tsx --test test/*.test.ts
// The rules themselves are the database's (scripts/db-tests/batch11/*, which also proves these lists and numbers equal the database's); this file checks what the apps do with them:
// what each party is offered, what can never be attached, the clocks they show, the words and the exact calls they make.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMERGENCY_INCIDENT_CATEGORIES,
  INCIDENT_CATEGORIES,
  evidenceFileProblem,
  incidentCategoriesFor,
  incidentCategoryClass,
  incidentRoutingOf,
  isEmergencyIncident,
  uploadIncidentEvidenceFiles,
  type IncidentUploadClient,
} from '../../packages/shared/src/utils/incidentReports';
import {
  fabricatedStrikeOption,
  incidentClocks,
  incidentOutcomesFor,
  incidentStrikeOptions,
  startIncidentReview,
  decideIncident,
} from '../../packages/shared/src/utils/incidentReview';
import {
  CALAMITY_KINDS,
  CALAMITY_SCOPES,
  SHARE_TOKEN_PATTERN,
  URGENT_REPORT_OPTIONS,
  createTripShare,
  declareCalamity,
  updateCalamity,
  fetchActiveCalamity,
  fetchSharedTripView,
  fileUrgentSafetyReport,
  shareLifetimeText,
  shareMessage,
  shareUrl,
} from '../../packages/shared/src/utils/tripSafety';
import {
  DRIVER_CANCEL_REASONS,
  DRIVER_CANCEL_SAFE_REASONS,
  DRIVER_DELAY_REASONS,
  INCIDENT_EVIDENCE_MAX_BYTES,
  INCIDENT_EVIDENCE_MAX_FILES,
  SHARE_LINK_BUFFER_MINUTES,
  SHARE_LINK_MAX_HOURS,
} from '../../packages/shared/src/config/policyConfig';

type Call = { fn: string; args: Record<string, unknown> | undefined };
const fakeClient = (answer: unknown, error: unknown = null) => {
  const calls: Call[] = [];
  return { calls, client: { rpc: async (fn: string, args?: Record<string, unknown>) => { calls.push({ fn, args }); return { data: answer, error }; } } };
};
// a photo as the phone gives it: a name, a type, a size and (since decision D-P7 the first bytes are checked too) real first bytes for the format
const MAGIC: Record<string, number[]> = {
  'image/jpeg': [0xff, 0xd8, 0xff, 0xe0, 0, 0x10],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/webp': [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
};
const photo = (type: string, size: number) => ({ type, size, name: 'IMG_0001.HEIC', slice: () => new Blob([Uint8Array.from(MAGIC[type] ?? [0])]) } as unknown as File);

describe('the categories each party is offered (decisions PI-11A, PI-11K)', () => {
  it('lists every category once, each with a class', () => {
    const values = INCIDENT_CATEGORIES.map((c) => c.value);
    assert.equal(new Set(values).size, values.length);
    assert.ok(INCIDENT_CATEGORIES.every((c) => ['SERIOUS', 'EMERGENCY', 'LOST_ITEM', 'STANDARD'].includes(c.class)));
  });
  it('offers the emergency and serious categories to both parties and keeps the rest to the role they fit', () => {
    const pax = incidentCategoriesFor('Passenger').map((c) => c.value);
    const drv = incidentCategoriesFor('Driver').map((c) => c.value);
    for (const shared of ['Emergency', 'Medical Emergency', 'Safety Concern', 'Accident', 'Physical Assault', 'Harassment', 'Threat', 'Criminal Activity', 'Lost Item', 'Rude Behavior']) {
      assert.ok(pax.includes(shared) && drv.includes(shared), shared);
    }
    assert.ok(pax.includes('Overcharging Attempt') && !drv.includes('Overcharging Attempt'));
    assert.ok(drv.includes('Passenger Misconduct') && !pax.includes('Passenger Misconduct'));
  });
  it('is a superset of what the apps sent before this batch (an old phone with a cached app still files)', () => {
    const before = ['Emergency', 'Safety Concern', 'Accident', 'Overcharging Attempt', 'Rude Behavior', 'Unsafe Driving', 'Reckless Driving', 'Route Deviation', 'Passenger Misconduct', 'Change Refusal', 'Counterfeit Currency', 'Lost Item', 'Others'];
    for (const c of before) assert.notEqual(incidentCategoryClass(c), null, c);
  });
  it('Rule 16.5: only the emergency and serious categories may name a trip in progress; a lost item and a rude driver wait for the trip to end', () => {
    assert.ok(isEmergencyIncident('Accident') && isEmergencyIncident('Medical Emergency') && isEmergencyIncident('Threat') && isEmergencyIncident('Physical Assault'));
    assert.ok(!isEmergencyIncident('Rude Behavior') && !isEmergencyIncident('Lost Item') && !isEmergencyIncident('Others') && !isEmergencyIncident('Not a category'));
    assert.equal(EMERGENCY_INCIDENT_CATEGORIES.length, 9, 'the eight of Batch 11 and Unregistered Person Driving (Rule 27.2, Batch 12)');
  });
  it('Rule 27.2 (Batch 12): "Unregistered Person Driving" is a serious category only a passenger can file, goes straight to the LGU and may carry DRV_SUBSTITUTE_DRIVER', () => {
    assert.equal(incidentCategoryClass('Unregistered Person Driving'), 'SERIOUS');
    assert.ok(incidentCategoriesFor('Passenger').some((c) => c.value === 'Unregistered Person Driving') && !incidentCategoriesFor('Driver').some((c) => c.value === 'Unregistered Person Driving'));
    assert.equal(incidentRoutingOf('Unregistered Person Driving'), 'LGU');
    assert.ok(isEmergencyIncident('Unregistered Person Driving'));
    assert.deepEqual(incidentStrikeOptions('Unregistered Person Driving', 'Passenger').map((o) => o.code), ['DRV_SUBSTITUTE_DRIVER']);
    assert.deepEqual(incidentStrikeOptions('Unregistered Person Driving', 'Driver'), []);
  });
  it('Rules 19.3, 19.8: the sentence on the screen sends the serious ones to the LGU and the rest to the TODA', () => {
    assert.equal(incidentRoutingOf('Threat'), 'LGU');
    assert.equal(incidentRoutingOf('Criminal Activity'), 'LGU');
    assert.equal(incidentRoutingOf('Rude Behavior'), 'TODA');
    assert.equal(incidentRoutingOf('Lost Item'), 'TODA');
    assert.equal(incidentRoutingOf('Accident'), 'TODA');
  });
});

describe('the photos (F11.2)', () => {
  const uploaded: Array<{ bucket: string; path: string; type: string }> = [];
  const fake = (uid: string | null): IncidentUploadClient => ({
    auth: { getUser: async () => ({ data: { user: uid ? { id: uid } : null } }) },
    storage: { from: (bucket: string) => ({ upload: async (path: string, _f: File, o: { contentType: string }) => { uploaded.push({ bucket, path, type: o.contentType }); return { error: null }; } }) },
  });
  const MB = 1024 * 1024;

  it('the limits are three photos of 5 MB, JPEG, PNG or WebP', () => {
    assert.equal(INCIDENT_EVIDENCE_MAX_FILES, 3);
    assert.equal(INCIDENT_EVIDENCE_MAX_BYTES, 5 * MB);
  });
  it('names the problem in Filipino and English before anything is uploaded', () => {
    assert.match(evidenceFileProblem({ type: 'video/mp4', size: 10 }) ?? '', /JPEG, PNG o WebP.*Only JPEG, PNG or WebP/);
    assert.match(evidenceFileProblem({ type: 'image/jpeg', size: 5 * MB + 1 }) ?? '', /5 MB/);
    assert.equal(evidenceFileProblem({ type: 'image/webp', size: 5 * MB }), null);
    assert.equal(evidenceFileProblem({ type: 'image/gif', size: 1 }) !== null, true);
  });
  it('refuses a fourth photo, a bad photo and a missing sign-in without uploading anything', async () => {
    uploaded.length = 0;
    await assert.rejects(() => uploadIncidentEvidenceFiles(fake('u1'), [photo('image/png', 1), photo('image/png', 1), photo('image/png', 1), photo('image/png', 1)]), /3/);
    await assert.rejects(() => uploadIncidentEvidenceFiles(fake('u1'), [photo('image/png', 1), photo('application/pdf', 1)]), /JPEG/);
    await assert.rejects(() => uploadIncidentEvidenceFiles(fake(null), [photo('image/png', 1)]), /naka-login/);
    assert.equal(uploaded.length, 0);
    assert.deepEqual(await uploadIncidentEvidenceFiles(fake('u1'), []), []);
  });
  it('refuses a file that says it is a photo but whose first bytes are a program, and uploads nothing (decision D-P7)', async () => {
    uploaded.length = 0;
    const program = { type: 'image/jpeg', size: 100, name: 'IMG_0002.jpg', slice: () => new Blob([Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00])]) } as unknown as File;
    await assert.rejects(() => uploadIncidentEvidenceFiles(fake('u1'), [photo('image/jpeg', 100), program]), /Hindi tanggap/);
    assert.equal(uploaded.length, 0, 'nothing was uploaded, not even the good photo before it');
    const pdfAsPhoto = { type: 'image/png', size: 100, name: 'scan.png', slice: () => new Blob([new TextEncoder().encode('%PDF-1.7')]) } as unknown as File;
    await assert.rejects(() => uploadIncidentEvidenceFiles(fake('u1'), [pdfAsPhoto]), /not accepted/);
    const pngAsJpeg = { type: 'image/jpeg', size: 100, name: 'a.jpg', slice: () => new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]) } as unknown as File;
    await assert.rejects(() => uploadIncidentEvidenceFiles(fake('u1'), [pngAsJpeg]), /does not match/);
  });
  it('stores three photos in the reporter\'s own folder under a name it makes (never the phone\'s), with the extension of the format', async () => {
    uploaded.length = 0;
    const paths = await uploadIncidentEvidenceFiles(fake('user-1'), [photo('image/jpeg', 100), photo('image/png', 100), photo('image/webp', 100)]);
    assert.equal(paths.length, 3);
    assert.ok(paths.every((p) => p.startsWith('user-1/')));
    assert.deepEqual(paths.map((p) => p.split('.').pop()), ['jpg', 'png', 'webp']);
    assert.ok(!paths.some((p) => /IMG_0001|HEIC/i.test(p)));
    assert.ok(uploaded.every((u) => u.bucket === 'incident-evidence'));
  });
});

describe('the strikes an upheld report may carry (decisions PI-11G, PI-11H) and the outcomes offered', () => {
  const codes = (c: string, by: string) => incidentStrikeOptions(c, by).map((o) => o.code);
  it('a rude driver or a rude passenger: the strike of the reported party', () => {
    assert.deepEqual(codes('Rude Behavior', 'Passenger'), ['DRV_RUDE_UPHELD']);
    assert.deepEqual(codes('Rude Behavior', 'Driver'), ['PAX_ABUSIVE_UPHELD']);
  });
  it('assault and harassment suspend pending the LGU\'s investigation: a range of zero points, LGU only', () => {
    for (const [cat, code] of [['Physical Assault', 'DRV_PHYSICAL_ALTERCATION'], ['Harassment', 'DRV_HARASSMENT'], ['Threat', 'DRV_HARASSMENT']] as const) {
      const [o] = incidentStrikeOptions(cat, 'Passenger');
      assert.equal(o.code, code);
      assert.equal(o.lguOnly, true);
      assert.equal(o.min, 0);
    }
  });
  it('a driver\'s report about a passenger\'s misconduct can carry abuse, damage or contamination, each with the catalog\'s range', () => {
    const o = incidentStrikeOptions('Passenger Misconduct', 'Driver');
    assert.deepEqual(o.map((x) => [x.code, x.min, x.max]), [['PAX_ABUSIVE_UPHELD', 2, 2], ['PAX_VEHICLE_DAMAGE', 3, 3], ['PAX_CONTAMINATION', 1, 1]]);
  });
  it('a lost item, an emergency, a safety concern, an accident and a system report carry no strike (Rules 19.6, 19.7, 26.4)', () => {
    for (const c of ['Lost Item', 'Emergency', 'Medical Emergency', 'Safety Concern', 'Accident', 'Others', 'Counterfeit Currency']) {
      assert.deepEqual(codes(c, 'Passenger'), [], c);
      assert.deepEqual(codes(c, 'Driver'), [], c);
    }
    assert.deepEqual(codes('Rude Behavior', 'System'), []);
  });
  it('Rule 19.5: a fabricated report is struck on the REPORTER, 2 strikes, whoever filed it', () => {
    assert.deepEqual([fabricatedStrikeOption('Passenger')?.code, fabricatedStrikeOption('Passenger')?.subject, fabricatedStrikeOption('Passenger')?.min], ['PAX_FABRICATED_REPORT', 'passenger', 2]);
    assert.deepEqual([fabricatedStrikeOption('Driver')?.code, fabricatedStrikeOption('Driver')?.subject], ['DRV_FABRICATED_REPORT', 'driver']);
    assert.equal(fabricatedStrikeOption('System'), null);
  });
  it('the outcomes: a lost item can only be "not upheld" (the contact is recorded separately); an emergency may be "resolved, no fault"; a system report cannot be fabricated', () => {
    assert.deepEqual(incidentOutcomesFor('Lost Item', 'Passenger'), ['NOT_UPHELD']);
    assert.ok(incidentOutcomesFor('Accident', 'Passenger').includes('RESOLVED'));
    assert.ok(!incidentOutcomesFor('Rude Behavior', 'Driver').includes('RESOLVED'));
    assert.ok(!incidentOutcomesFor('Rude Behavior', 'System').includes('FABRICATED'));
    assert.ok(incidentOutcomesFor('Rude Behavior', 'Passenger').includes('FABRICATED'));
  });
});

describe('the clocks of F11.1 are shown, never acted on', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  const hoursAgo = (h: number) => new Date(now - h * 3600e3).toISOString();
  const inHours = (h: number) => new Date(now + h * 3600e3).toISOString();
  it('a report nobody touched past its first-action time is overdue', () => {
    const c = incidentClocks({ status: 'Pending', outcome: null, first_action_at: null, first_action_due_at: hoursAgo(1), decision_due_at: inHours(48) }, now);
    assert.deepEqual([c.firstActionOverdue, c.decisionOverdue, c.overdue], [true, false, true]);
  });
  it('once acted on, only the decision clock runs', () => {
    const c = incidentClocks({ status: 'Under Investigation', outcome: null, first_action_at: hoursAgo(2), first_action_due_at: hoursAgo(10), decision_due_at: inHours(24) }, now);
    assert.deepEqual([c.firstActionOverdue, c.decisionOverdue, c.nextDue !== null], [false, false, true]);
    const late = incidentClocks({ status: 'Under Investigation', outcome: null, first_action_at: hoursAgo(80), first_action_due_at: hoursAgo(90), decision_due_at: hoursAgo(1) }, now);
    assert.equal(late.decisionOverdue, true);
  });
  it('a decided, cancelled or dismissed report has nothing overdue and no next deadline', () => {
    for (const status of ['Resolved', 'Dismissed', 'Cancelled']) {
      const c = incidentClocks({ status, outcome: null, first_action_at: null, first_action_due_at: hoursAgo(100), decision_due_at: hoursAgo(50) }, now);
      assert.deepEqual([c.overdue, c.nextDue], [false, null], status);
    }
    assert.equal(incidentClocks({ status: 'Under Investigation', outcome: 'UPHELD', first_action_at: null, first_action_due_at: hoursAgo(5), decision_due_at: hoursAgo(5) }, now).overdue, false);
  });
  it('a report with no deadline recorded (an old one) is never overdue', () => {
    assert.equal(incidentClocks({ status: 'Pending', outcome: null, first_action_at: null, first_action_due_at: null, decision_due_at: null }, now).overdue, false);
  });
});

describe('the calls the screens make (the database checks the rest)', () => {
  it('the review calls send exactly the parameters the functions have', async () => {
    const f = fakeClient({ success: true });
    await startIncidentReview(f.client, 'inc-1');
    await decideIncident(f.client, { incidentId: 'inc-1', outcome: 'UPHELD', note: 'Findings written down.', strikeCode: 'DRV_RUDE_UPHELD', points: 2 });
    assert.deepEqual(f.calls, [
      { fn: 'incident_start_review', args: { p_incident_id: 'inc-1' } },
      { fn: 'incident_decide', args: { p_incident_id: 'inc-1', p_outcome: 'UPHELD', p_note: 'Findings written down.', p_strike_code: 'DRV_RUDE_UPHELD', p_points: 2 } },
    ]);
  });
  it('the Urgent Safety Report is one tap: the default category is Safety Concern, the text optional and trimmed', async () => {
    const f = fakeClient({ success: true, incident_id: 'i1' });
    await fileUrgentSafetyReport(f.client, 'b1');
    await fileUrgentSafetyReport(f.client, 'b1', 'Threat', '  He said he would hurt me.  ');
    await fileUrgentSafetyReport(f.client, 'b1', 'Accident', '   ');
    assert.deepEqual(f.calls.map((c) => c.args), [
      { p_booking_id: 'b1', p_category: 'Safety Concern', p_description: null },
      { p_booking_id: 'b1', p_category: 'Threat', p_description: 'He said he would hurt me.' },
      { p_booking_id: 'b1', p_category: 'Accident', p_description: null },
    ]);
    assert.ok(URGENT_REPORT_OPTIONS.every((o) => incidentCategoryClass(o.category) === 'EMERGENCY' || incidentCategoryClass(o.category) === 'SERIOUS'));
    assert.deepEqual(URGENT_REPORT_OPTIONS.filter((o) => o.serious).map((o) => incidentRoutingOf(o.category)), ['LGU', 'LGU', 'LGU']);
  });
  it('the database\'s own sentence reaches the screen without its ERR_ code', async () => {
    const f = fakeClient(null, { message: 'ERR_URGENT_CATEGORY: Pumili ng uri ng insidente. (Choose an urgent category.)' });
    const r = await fileUrgentSafetyReport(f.client, 'b1', 'Safety Concern');
    assert.deepEqual([r.ok, r.code, r.error], [false, 'ERR_URGENT_CATEGORY', 'Pumili ng uri ng insidente. (Choose an urgent category.)']);
  });
  it('a failed call is a result, never a throw', async () => {
    const r = await createTripShare({ rpc: async () => { throw new Error('offline'); } }, 'b1');
    assert.equal(r.ok, false);
  });
});

describe('Share Live Trip (Rule 26.1, F11.3)', () => {
  it('the link is an address of the Passenger app that needs no sign-in, made from the origin and the token', () => {
    const token = 'a'.repeat(32);
    assert.equal(shareUrl('https://sakay.example/', token), `https://sakay.example/share/${token}`);
    assert.equal(shareUrl('https://sakay.example', token), `https://sakay.example/share/${token}`);
    assert.ok(SHARE_TOKEN_PATTERN.test(token) && !SHARE_TOKEN_PATTERN.test('A'.repeat(32)) && !SHARE_TOKEN_PATTERN.test('a'.repeat(31)) && !SHARE_TOKEN_PATTERN.test('a'.repeat(33)));
  });
  it('the message is one short line with the link (no addresses, nothing about the person or the fare), in both languages', () => {
    assert.equal(shareMessage('en', { url: 'https://x/share/t' }), 'View my SAKAY Trip! You can follow my trip here: https://x/share/t');
    assert.equal(shareMessage('tl', { url: 'https://x/share/t' }), 'Tingnan ang aking SAKAY Trip! Masusubaybayan mo ang biyahe ko dito: https://x/share/t');
    for (const lang of ['en', 'tl'] as const) {
      const m = shareMessage(lang, { pickup: 'Market', dropoff: 'Terminal', url: 'https://x/share/t' });
      assert.ok(m.includes('https://x/share/t') && !m.includes('Market') && !m.includes('Terminal'));
      assert.ok(!/fare|pamasahe|PHP|\+63/i.test(m));
    }
  });
  it('the line under the share button states the 15-minute buffer and the 4-hour cap from the central configuration', () => {
    assert.equal(SHARE_LINK_BUFFER_MINUTES, 15);
    assert.equal(SHARE_LINK_MAX_HOURS, 4);
    assert.ok(shareLifetimeText('en').includes('15 minutes') && shareLifetimeText('en').includes('4 hours'));
    assert.ok(shareLifetimeText('tl').includes('15 minuto') && shareLifetimeText('tl').includes('4 oras'));
  });
  it('the page treats an invalid, expired or revoked link as nothing (null), whatever the reason', async () => {
    assert.equal(await fetchSharedTripView(fakeClient({ found: false }).client, 'x'), null);
    assert.equal(await fetchSharedTripView(fakeClient(null, { message: 'boom' }).client, 'x'), null);
    assert.equal(await fetchSharedTripView({ rpc: async () => { throw new Error('offline'); } }, 'x'), null);
    const f = fakeClient({ found: true, state: 'ongoing', ended: false });
    const v = await fetchSharedTripView(f.client, 'tok');
    assert.equal(v?.state, 'ongoing');
    assert.deepEqual(f.calls, [{ fn: 'get_shared_trip_view', args: { p_token: 'tok' } }]);
  });
});

describe('the calamity (Rules 15.3, 15.4, 29.6)', () => {
  it('reads "no calamity" for anything but an active declaration', async () => {
    assert.deepEqual(await fetchActiveCalamity(fakeClient({ active: false }).client), { active: false });
    assert.deepEqual(await fetchActiveCalamity(fakeClient(null, { message: 'x' }).client), { active: false });
    assert.deepEqual(await fetchActiveCalamity({ rpc: async () => { throw new Error('offline'); } }), { active: false });
  });
  it('reads an active one into what the banner shows', async () => {
    const c = await fetchActiveCalamity(fakeClient({ active: true, declaration_id: 'd1', kind: 'Typhoon', title: 'Typhoon', message: 'Signal No. 2', scope: 'ALL', declared_at: '2026-10-15T01:00:00Z' }).client);
    assert.deepEqual(c, { active: true, declarationId: 'd1', kind: 'Typhoon', title: 'Typhoon', message: 'Signal No. 2', scope: 'ALL', declaredAt: '2026-10-15T01:00:00Z', expectedEndAt: undefined, updatedAt: undefined });
  });
  it('reads the expected end and the last change of the declaration (Batch 2), and changing it is ONE call', async () => {
    const c = await fetchActiveCalamity(fakeClient({ active: true, declaration_id: 'd1', kind: 'Typhoon', title: 'Typhoon', message: 'Signal No. 3', scope: 'ALL', declared_at: '2026-10-15T01:00:00Z', expected_end_at: '2026-10-17T15:59:00Z', updated_at: '2026-10-15T09:00:00Z' }).client);
    assert.equal(c.expectedEndAt, '2026-10-17T15:59:00Z');
    assert.equal(c.updatedAt, '2026-10-15T09:00:00Z');
    const f = fakeClient({ success: true });
    await updateCalamity(f.client, { title: 'Typhoon warning 3', message: 'Stay indoors.', expectedEndAt: '2026-10-17T15:59:00Z' });
    assert.deepEqual(f.calls, [{ fn: 'update_calamity', args: { p_title: 'Typhoon warning 3', p_message: 'Stay indoors.', p_expected_end: '2026-10-17T15:59:00Z' } }]);
  });
  it('declaring is ONE call with the four parameters (the announcement and the pause are the database\'s one action)', async () => {
    const f = fakeClient({ success: true });
    await declareCalamity(f.client, { kind: 'Flood', title: 'Flood in Barangay 1', message: 'Avoid the river road.', scope: 'CANCEL_STALL_NOSHOW' });
    assert.deepEqual(f.calls, [{ fn: 'declare_calamity', args: { p_kind: 'Flood', p_title: 'Flood in Barangay 1', p_message: 'Avoid the river road.', p_scope: 'CANCEL_STALL_NOSHOW' } }]);
    assert.deepEqual([...CALAMITY_KINDS], ['Typhoon', 'Flood', 'Earthquake', 'Road Closure', 'Declared Emergency', 'Other']);
    assert.deepEqual(CALAMITY_SCOPES.map((s) => s.code), ['CANCEL_STALL_NOSHOW', 'ALL']);
  });
});

describe('the reason lists of the driver\'s screens (PI-11B, PI-11L)', () => {
  it('the safe reasons are a subset of the cancellation reasons the driver is offered', () => {
    assert.ok(DRIVER_CANCEL_SAFE_REASONS.every((r) => (DRIVER_CANCEL_REASONS as readonly string[]).includes(r)));
    assert.ok(['vehicle_breakdown', 'accident', 'unsafe_or_illegal_request', 'prohibited_item'].every((r) => (DRIVER_CANCEL_SAFE_REASONS as readonly string[]).includes(r)));
    assert.ok(!(DRIVER_CANCEL_SAFE_REASONS as readonly string[]).includes('other') && !(DRIVER_CANCEL_SAFE_REASONS as readonly string[]).includes('passenger_unreachable'));
  });
  it('a police checkpoint is a delay reason (Rule 29.12)', () => {
    assert.deepEqual([...DRIVER_DELAY_REASONS], ['traffic', 'road_closure', 'police_checkpoint']);
  });
});
