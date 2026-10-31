// Batch 11: the TypeScript the apps and the portals use for incident reports, the Urgent Safety Report, the administrator's safety end, Share Live Trip and the calamity
// (packages/shared/src/utils/incidentReview.ts, tripSafety.ts, incidentReports.ts) against the REAL database functions. Proves that every call name and every parameter name the apps
// send exists in the database (the calls are made by NAME, as the apps make them), that the answers are read into the shapes the screens use, that the columns the screens select exist,
// that the photo limits are applied before anything is uploaded, and that the database's own sentences reach the screen. Whole migration chain on the local emulator (never Supabase).
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { setup, ID, DRIVERS, PAX, check, summary, asUser } = require('../b11fixtures');

const ROOT = path.join(__dirname, '..', '..', '..');
const SHARED = path.join(ROOT, 'packages', 'shared', 'src', 'utils');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

function loadTs(file) {
  const code = esbuild.buildSync({ entryPoints: [file], bundle: true, write: false, format: 'cjs', platform: 'node', target: 'es2022', logLevel: 'silent' }).outputFiles[0].text;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
  return mod.exports;
}

(async () => {
  const reviewSrc = read('packages', 'shared', 'src', 'utils', 'incidentReview.ts');
  const safetySrc = read('packages', 'shared', 'src', 'utils', 'tripSafety.ts');
  const review = loadTs(path.join(SHARED, 'incidentReview.ts'));
  const safety = loadTs(path.join(SHARED, 'tripSafety.ts'));
  const reports = loadTs(path.join(SHARED, 'incidentReports.ts'));
  const s = await setup();
  const { q, one, as, db, internal } = s;

  // a Supabase-shaped client whose rpc() calls the real function by NAME as the signed-in user (named notation: a wrong parameter name fails), or as a visitor without an account
  const rpcClient = (uid) => ({
    rpc: async (fn, args) => {
      try {
        const names = Object.keys(args ?? {});
        const run = (tx) => tx.query(`SELECT public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) AS r`, names.map((n) => args[n]));
        const r = uid ? await as(uid, run) : await asUser(db, { uid: null, role: 'anon' }, run, { commit: true });
        return { data: r.rows[0].r, error: null };
      } catch (e) {
        return { data: null, error: { message: e.message } };
      }
    },
  });
  const LGU = rpcClient(ID.L_AUTH), TODA = rpcClient(ID.T_AUTH), P1 = rpcClient(PAX.P1.uid), VISITOR = rpcClient(null);

  console.log('S1 every call the TypeScript makes exists in the database, with exactly the parameters it sends');
  const calls = [...[reviewSrc, safetySrc].flatMap((src) => [...src.matchAll(/(?:callRpc\(client,|client\.rpc\()\s*'([a-z_]+)',\s*\{([^}]*)\}/g)])]
    .map((m) => ({ fn: m[1], params: [...m[2].matchAll(/(p_[a-z_]+)\s*:/g)].map((x) => x[1]).sort() }));
  check(`the TypeScript names ${calls.length} database calls`, calls.length === 17, calls.map((c) => c.fn));
  for (const c of calls) {
    const row = (await q(`SELECT proargnames FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = '${c.fn}'`))[0];
    const dbNames = row ? [...(row.proargnames ?? [])].filter((n) => n.startsWith('p_')).sort() : null;
    check(`${c.fn}: the parameters sent (${c.params.join(', ') || 'none'}) are exactly the function's`, dbNames !== null && JSON.stringify(dbNames) === JSON.stringify(c.params), { sent: c.params, db: dbNames });
  }
  // the two portals call the flag functions themselves
  for (const f of ['apps/toda-portal/src/services/todaApiService.ts', 'apps/lgu-portal/src/services/adminApiService.ts']) {
    const src = read(...f.split('/'));
    for (const m of src.matchAll(/rpc\('(resolve_admin_review_flag)',\s*\{([^}]*)\}/g)) {
      const sent = [...m[2].matchAll(/(p_[a-z_]+)\s*:/g)].map((x) => x[1]).sort();
      const dbNames = [...(await one(`SELECT proargnames FROM pg_proc WHERE proname = 'resolve_admin_review_flag'`)).proargnames].filter((n) => n.startsWith('p_')).sort();
      check(`${path.basename(f)}: ${m[1]} sends exactly the function's parameters`, JSON.stringify(sent) === JSON.stringify(dbNames), { sent, dbNames });
    }
  }
  const noParams = (await one(`SELECT pronargs FROM pg_proc WHERE proname = 'get_active_calamity'`)).pronargs === 0;
  check('get_active_calamity takes no parameter (the banner sends none)', noParams);

  console.log('\nS2 the columns the screens read exist');
  const cols = new Set((await q(`SELECT column_name FROM information_schema.columns WHERE table_name = 'incident_report'`)).map((r) => r.column_name));
  const recordBody = reviewSrc.slice(reviewSrc.indexOf('export interface IncidentRecord'), reviewSrc.indexOf('}', reviewSrc.indexOf('export interface IncidentRecord')));
  const recordCols = [...recordBody.matchAll(/^\s+([a-z_]+)\??:/gm)].map((m) => m[1]);
  check(`all ${recordCols.length} columns of IncidentRecord are columns of incident_report`, recordCols.length >= 30 && recordCols.every((c) => cols.has(c)), recordCols.filter((c) => !cols.has(c)));
  for (const f of ['apps/passenger-pwa/src/services/incidentService.ts', 'apps/driver-pwa/src/services/incidentService.ts']) {
    const src = read(...f.split('/'));
    const sel = src.match(/INCIDENT_COLUMNS =\s*'([^']*)'/)?.[1];
    if (!sel) continue;
    const wanted = sel.replace(/booking:booking_id\([^)]*\)/, '').split(',').map((x) => x.trim()).filter(Boolean);
    check(`${path.basename(path.dirname(path.dirname(f)))}: the ${wanted.length} columns the report list selects exist`, wanted.every((c) => cols.has(c)), wanted.filter((c) => !cols.has(c)));
  }
  const incCols = [...cols];
  check('the guard\'s columns are there: routing, priority, first_action_due_at, decision_due_at, lost_item_status, outcome, strike_code',
    ['routing', 'priority', 'first_action_due_at', 'decision_due_at', 'lost_item_status', 'outcome', 'strike_code'].every((c) => incCols.includes(c)));

  console.log('\nS3 the review calls, as the portals make them (T1, T2, T3)');
  const t0 = await s.finished('P1', 'D1');
  const filed = await s.file('P1', t0, 'Rude Behavior', 'The driver shouted at me when I asked him to slow down.', { evidence_paths: [] });
  check('the passenger\'s report is filed the way the app inserts it (booking, category, description, evidence paths)', filed.ok && filed.value.status === 'Pending' && filed.value.routing === 'TODA' && filed.value.reported_by === 'Passenger', filed);
  const id = filed.value.incident_id;
  let r = await review.startIncidentReview(P1, id);
  check('a passenger cannot start the review: ok=false and the database\'s own sentence reaches the screen', r.ok === false && typeof r.error === 'string' && /not assigned to you/.test(r.error) && !/^ERR_/.test(r.error), r);
  r = await review.startIncidentReview(TODA, id);
  check('the TODA Administrator starts the review: ok, the answer is read', r.ok === true && r.data && r.data.success === true, r);
  r = await review.decideIncident(TODA, { incidentId: id, outcome: 'UPHELD', note: 'short', strikeCode: 'DRV_RUDE_UPHELD', points: null });
  check('a note under ten characters is refused with the database\'s sentence', r.ok === false && typeof r.code === 'string', r);
  r = await review.decideIncident(TODA, { incidentId: id, outcome: 'UPHELD', note: 'Both were heard; the driver admitted shouting.', strikeCode: 'DRV_RUDE_UPHELD', points: 1 });
  check('Upheld with the catalog strike: ok, and the strike is on the driver (through the Batch 3 engine)', r.ok === true && (await s.strikesOf(DRIVERS.D1.id)).some((x) => x.violation_code === 'DRV_RUDE_UPHELD' && x.incident_id === id), r);
  const decided = await s.report(id);
  check('the row the screens read: outcome UPHELD, decided by the TODA Administrator, the strike code kept', decided.outcome === 'UPHELD' && decided.decided_by_role === 'toda_admin' && decided.strike_code === 'DRV_RUDE_UPHELD' && decided.status === 'Resolved', decided);
  const clocks = review.incidentClocks({ status: decided.status, outcome: decided.outcome, first_action_at: decided.first_action_at, first_action_due_at: decided.first_action_due_at, decision_due_at: decided.decision_due_at });
  const stillOpen = { status: 'Pending', outcome: null, first_action_at: null, first_action_due_at: new Date(Date.now() - 3600e3).toISOString(), decision_due_at: new Date(Date.now() + 86400e3).toISOString() };
  check('the clocks the screens show come from those columns: a decided report has nothing overdue; a report nobody touched past its first-action time is overdue (shown, never acted on)',
    clocks.overdue === false && clocks.nextDue === null && review.incidentClocks(stillOpen).firstActionOverdue === true && review.incidentClocks(stillOpen).decisionOverdue === false, clocks);
  await s.clearAll();

  const lostTrip = await s.finished('P1', 'D1');
  const lost = await s.file('P1', lostTrip, 'Lost Item', 'I left a blue umbrella on the seat.');
  r = await review.updateLostItem(TODA, lost.value.incident_id, 'Contact Arranged', 'Called both; they will meet at the terminal tomorrow.');
  check('Lost Item: the TODA records the contact (T3): ok, no strike on anybody', r.ok === true && (await s.strikesOf(DRIVERS.D1.id)).length === 0 && (await s.report(lost.value.incident_id)).lost_item_status === 'Contact Arranged', r);
  r = await review.updateLostItem(TODA, lost.value.incident_id, 'Open', 'x'.repeat(20));
  check('a status outside the list is refused by the database', r.ok === false, r);
  await s.clearAll();

  const route = await s.finished('P1', 'D1');
  const serious = await s.file('P1', route, 'Rude Behavior', 'He pulled a bolo from under the seat and told me to be quiet.');
  r = await review.escalateIncident(TODA, serious.value.incident_id, 'It describes a weapon and a threat, not rudeness.', true);
  check('the TODA Administrator reclassifies it as serious while escalating (the p_serious the portal sends): it goes to the LGU as Serious (PI-11J)', r.ok === true && (await s.report(serious.value.incident_id)).routing === 'LGU' && (await s.report(serious.value.incident_id)).priority === 'Serious', r);
  await s.clearAll();

  console.log('\nS4 the Urgent Safety Report and the administrator\'s safety end');
  const trip = await s.startTrip('D1', 'P1');
  r = await safety.fileUrgentSafetyReport(P1, trip.booking_id);
  check('one tap with the defaults the screen sends: ok, an incident id, priority Emergency', r.ok === true && typeof r.data.incident_id === 'string' && r.data.priority === 'Emergency', r);
  for (const o of safety.URGENT_REPORT_OPTIONS) {
    await s.clearAll();
    const x = await safety.fileUrgentSafetyReport(P1, trip.booking_id, o.category, null);
    check(`"${o.en}" (${o.category}): accepted; the screen\'s "serious" flag (${o.serious}) is the database\'s priority`, x.ok === true && (x.data.priority === 'Serious') === o.serious, x);
  }
  await s.clearAll();
  r = await safety.endTripForSafety(TODA, { bookingId: trip.booking_id, reason: 'passenger_in_danger', note: 'Reached the passenger; the police confirmed it.', closeAs: 'Waived' });
  check('the TODA Administrator ends the trip for safety (as the portal sends it): ok', r.ok === true, r);
  r = await safety.endTripForSafety(P1, { bookingId: trip.booking_id, reason: 'emergency', note: 'Trying it as a passenger.', closeAs: null });
  check('a passenger cannot: the database\'s sentence comes back, ok=false', r.ok === false && /Only the TODA Administrator of this driver, or the LGU Administrator/.test(r.error ?? ''), r);

  console.log('\nS5 Share Live Trip, as the Passenger app and the public page call it (T7)');
  const live = await s.startTrip('D1', 'P1');
  await internal(`UPDATE driver SET plate_number = 'ABC-1234' WHERE driver_id = '${DRIVERS.D1.id}'`);
  r = await safety.createTripShare(P1, live.booking_id);
  const token = r.data?.token;
  check('the link is made: ok, a token the page pattern accepts, the expiry', r.ok === true && safety.SHARE_TOKEN_PATTERN.test(token) && typeof r.data.expires_at === 'string', r);
  const my = await safety.fetchMyTripShare(P1, live.booking_id);
  check('fetchMyTripShare reads { active, expiresAt }', my.active === true && typeof my.expiresAt === 'string', my);
  const seen = await safety.fetchSharedTripView(VISITOR, token);
  check('a visitor without an account reads the view: found, ongoing, the whitelisted fields the screen shows',
    seen !== null && seen.state === 'ongoing' && seen.ended === false && seen.plate_number === 'ABC-1234' && seen.driver_first_name === 'Driver' && typeof seen.status_en === 'string' && typeof seen.server_now === 'string', seen);
  check('the share page\'s URL and message carry the token and the addresses', safety.shareUrl('https://app.example/', token) === `https://app.example/share/${token}` && safety.shareMessage('en', { pickup: 'A', dropoff: 'B', url: 'https://x/share/t' }).includes('https://x/share/t'));
  check('a wrong token is null for the page (not an error, not a hint)', (await safety.fetchSharedTripView(VISITOR, 'f'.repeat(32))) === null && (await safety.fetchSharedTripView(VISITOR, 'nope')) === null);
  r = await safety.revokeTripShare(P1, live.booking_id);
  check('the passenger switches it off: ok, and the link stops working at once', r.ok === true && (await safety.fetchSharedTripView(VISITOR, token)) === null && (await safety.fetchMyTripShare(P1, live.booking_id)).active === false, r);
  r = await safety.createTripShare(VISITOR, live.booking_id);
  check('a visitor cannot make a link (the database refuses; the screen gets ok=false)', r.ok === false, r);
  await s.reset();

  console.log('\nS6 the calamity, as the LGU portal and both apps call it (T6)');
  const before = await safety.fetchActiveCalamity(P1);
  check('no calamity: { active: false }', before.active === false);
  r = await safety.declareCalamity(TODA, { kind: 'Typhoon', title: 'Typhoon warning', message: 'Signal No. 2 is raised over the city.', scope: 'CANCEL_STALL_NOSHOW' });
  check('a TODA Administrator cannot declare it', r.ok === false && /Only the LGU Administrator/.test(r.error ?? ''), r);
  r = await safety.declareCalamity(LGU, { kind: 'Typhoon', title: 'Typhoon warning', message: 'Signal No. 2 is raised over the city.', scope: 'CANCEL_STALL_NOSHOW' });
  check('the LGU Administrator declares it: ok', r.ok === true, r);
  const now = await safety.fetchActiveCalamity(P1);
  check('any signed-in user reads it as the banner needs it: active, the kind, title, message, scope and time', now.active === true && now.kind === 'Typhoon' && now.title === 'Typhoon warning' && now.scope === 'CANCEL_STALL_NOSHOW' && typeof now.declaredAt === 'string' && now.declarationId !== '', now);
  check('ONE audit entry for the whole action (announcement and strike pause together)', (await s.auditOf('CALAMITY_DECLARED')).length === 1);
  r = await safety.declareCalamity(LGU, { kind: 'Flood', title: 'Second one', message: 'Another declaration while one is in force.', scope: 'ALL' });
  check('a second declaration while one is in force is not made twice: the answer names the one in force, no second announcement, no second audit entry (a double tap is one action)',
    r.ok === true && r.data.already_active === true && r.data.declaration_id === now.declarationId && (await s.auditOf('CALAMITY_DECLARED')).length === 1
    && (await q(`SELECT 1 FROM announcement WHERE title IN ('Typhoon warning', 'Second one')`)).length === 1, r);
  r = await safety.endCalamity(LGU, '  The roads are open again.  ');
  check('ending it: ok, and the banner is gone', r.ok === true && (await safety.fetchActiveCalamity(P1)).active === false, r);
  check('and strikes count again', (await one(`SELECT public.get_policy_config_text('strike_accrual_paused', 'false') AS v`).catch(() => ({ v: 'false' }))).v !== 'true');

  console.log('\nS7 the photos: the limits are applied before anything is uploaded (F11.2)');
  const uploaded = [];
  const fake = (uid) => ({
    auth: { getUser: async () => ({ data: { user: uid ? { id: uid } : null } }) },
    storage: { from: (bucket) => ({ upload: async (p, f, o) => { uploaded.push({ bucket, p, type: o.contentType }); return { error: null }; } }) },
  });
  // a photo as the phone gives it; since decision D-P7 the upload also checks the first bytes, so the stand-in carries the real header of its format
  const MAGIC = { 'image/jpeg': [0xff, 0xd8, 0xff, 0xe0, 0, 0x10], 'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/webp': [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50] };
  const file = (type, size) => ({ type, size, name: 'phone name.heic', slice: () => new Blob([Uint8Array.from(MAGIC[type] ?? [0])]) });
  const tryUpload = async (client, files) => { try { return { ok: true, value: await reports.uploadIncidentEvidenceFiles(client, files) }; } catch (e) { return { ok: false, error: e.message }; } };
  let u = await tryUpload(fake(PAX.P1.uid), [file('image/jpeg', 1), file('image/png', 2), file('image/webp', 3), file('image/jpeg', 4)]);
  check('four photos: refused, nothing uploaded', !u.ok && /3/.test(u.error) && uploaded.length === 0, u);
  u = await tryUpload(fake(PAX.P1.uid), [file('image/jpeg', 5 * 1024 * 1024 + 1)]);
  check('a photo over 5 MB: refused with the sentence, nothing uploaded', !u.ok && /5 MB/.test(u.error) && uploaded.length === 0, u);
  u = await tryUpload(fake(PAX.P1.uid), [file('video/mp4', 1000)]);
  check('a video: refused (JPEG, PNG or WebP only)', !u.ok && /JPEG/.test(u.error) && uploaded.length === 0, u);
  u = await tryUpload(fake(null), [file('image/jpeg', 1000)]);
  check('without a signed-in user: refused', !u.ok && uploaded.length === 0, u);
  u = await tryUpload(fake(PAX.P1.uid), [file('image/jpeg', 5 * 1024 * 1024), file('image/png', 10), file('image/webp', 10)]);
  check('three photos of the right type, one of exactly 5 MB: uploaded, in the reporter\'s own folder, with the extension of the format (never the phone\'s name)',
    u.ok && u.value.length === 3 && u.value.every((p) => p.startsWith(`${PAX.P1.uid}/`)) && u.value.map((p) => p.split('.').pop()).join() === 'jpg,png,webp' && uploaded.every((x) => x.bucket === 'incident-evidence') && !u.value.some((p) => /phone|heic/.test(p)), u);
  check('the first problem found names the file (evidenceFileProblem) and a good file has none', reports.evidenceFileProblem(file('image/gif', 10)) !== null && reports.evidenceFileProblem(file('image/jpeg', 10)) === null);
  // the same list reaches the database as the photo paths of a report: three paths in the reporter's own folder are accepted, four are not
  const t9 = await s.finished('P1', 'D1');
  const paths = (n) => Array.from({ length: n }, (_, i) => `${PAX.P1.uid}/${1000 + i}-${i + 1}.jpg`);
  const three = await s.file('P1', t9, 'Rude Behavior', 'He was rude and loud the whole way.', { evidence_paths: paths(3) });
  check('three photo paths in the reporter\'s own folder: the report is filed', three.ok, three);
  await s.clearAll();
  const four = await s.file('P1', t9, 'Rude Behavior', 'He was rude and loud the whole way.', { evidence_paths: paths(4) });
  check('four photo paths: the database refuses (the screen and the database apply the same limit)', !four.ok && /ERR_/.test(four.error), four);

  const ok = summary();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
