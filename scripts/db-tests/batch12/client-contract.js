// Batch 12: the TypeScript the apps, the portals and the server use for ratings, the audit log, the privacy notice and the retention job against the REAL database. Proves that every
// call name and parameter name that is sent exists in the database (the calls are made by NAME, as the apps make them), that the shared helpers read the answers into the shapes the
// screens use, that no screen invents a rating or sends a time or an actor of its own, that the OCR asks for nothing it should not keep, and that the server never holds the service-role
// key in an app. Whole migration chain on the local emulator (never Supabase).
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { setup, ID, DRIVERS, PAX, attempt, check, summary, asUser } = require('../b12fixtures');

const ROOT = path.join(__dirname, '..', '..', '..');
const SHARED = path.join(ROOT, 'packages', 'shared', 'src');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
function loadTs(file) {
  const code = esbuild.buildSync({ entryPoints: [file], bundle: true, write: false, format: 'cjs', platform: 'node', target: 'es2022', logLevel: 'silent' }).outputFiles[0].text;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
  return mod.exports;
}
function sourceFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'test') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

(async () => {
  const appFiles = ['driver-pwa', 'passenger-pwa', 'lgu-portal', 'toda-portal'].flatMap((a) => sourceFiles(path.join(ROOT, 'apps', a, 'src')));
  const sharedFiles = sourceFiles(SHARED);
  const serverFiles = sourceFiles(path.join(ROOT, 'server', 'src'));
  const clientFiles = [...appFiles, ...sharedFiles];
  const text = new Map([...clientFiles, ...serverFiles].map((f) => [f, fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')]));
  const grep = (files, re) => files.flatMap((f) => [...text.get(f).matchAll(re)].map((m) => `${rel(f)}: ${m[0].slice(0, 90)}`));

  console.log('S1 no screen invents a rating, writes an actor or a time, or changes a rating or the audit log');
  const rateFallback = grep(clientFiles, /(average_rating|weighted_average_rating|averageRating|[rR]ating)[^\n]{0,40}(\|\||\?\?)\s*[345](\.0)?\b/g);
  check('no rating falls back to 3, 4 or 5 (an account without a rating is "Not Yet Rated", Rule 23.1)', rateFallback.length === 0, rateFallback);
  const auditInserts = clientFiles.flatMap((f) => [...text.get(f).matchAll(/from\('audit_log'\)\s*\.insert\(([\s\S]*?)\]\)/g)].map((m) => ({ f, body: m[1] })));
  check(`the ${auditInserts.length} audit writes of the portals send no time, no actor and no administrator reference (the database stamps them)`,
    auditInserts.length >= 2 && auditInserts.every((a) => !/performed_at|created_at|actor_id|actor_role|actor_name|lgu_admin_id|toda_admin_id|admin_name/.test(a.body)), auditInserts.map((a) => rel(a.f)));
  const ratingWrites = clientFiles.flatMap((f) => [...text.get(f).matchAll(/from\('rating'\)\s*\.(?:upsert|insert)\(([\s\S]*?)\{ onConflict/g)].map((m) => ({ f, body: m[1] })));
  check(`the ${ratingWrites.length} rating writes of the apps send no time and no exclusion flag, and ignore a second rating of the same trip`,
    ratingWrites.length === 2 && ratingWrites.every((r) => !/created_at|is_excluded|excluded_at/.test(r.body)) && appFiles.every((f) => !/from\('rating'\)\s*\.upsert\([\s\S]{0,700}?onConflict: 'booking_id,rater_role'(?!, ignoreDuplicates: true)/.test(text.get(f))), ratingWrites.map((r) => rel(r.f)));
  check('no app updates or deletes a rating or an audit entry (the database refuses it too)', grep(clientFiles, /from\('(?:rating|audit_log)'\)\s*\.(?:update|delete)\(/g).length === 0);
  check('no app reads the audit log or decides a TODA application through the retired Express routes', grep(appFiles, /\/api\/admin\/audit-logs|\/api\/toda\/[^'"`]*\/(?:approve|return-correction|reject|decline)/g).length === 0);
  check('no app source holds the service-role key', grep(appFiles, /service_role|SERVICE_ROLE/gi).length === 0);

  console.log('\nS2 data minimization: the OCR asks for, and the apps keep, only what the verification needs (Rule 28.1)');
  const gemini = text.get(path.join(ROOT, 'server', 'src', 'services', 'geminiOcrService.ts'));
  const prompts = [...gemini.matchAll(/const prompt = `([\s\S]*?)`;/g)].map((m) => m[1]);
  check('both Gemini prompts ask for the approved fields only', prompts.length === 2
    && /operatorName/.test(prompts[0]) && /franchiseNumber/.test(prompts[0]) && /plateNumber/.test(prompts[0]) && /expirationDate/.test(prompts[0])
    && /licenseNumber/.test(prompts[1]) && /fullName/.test(prompts[1]) && /expirationDate/.test(prompts[1]) && /dlCodes/.test(prompts[1]) && /birthDate/.test(prompts[1]), prompts.map((p) => p.slice(0, 60)));
  const keysAsked = prompts.flatMap((p) => [...p.matchAll(/^\s*"([A-Za-z]+)":/gm)].map((m) => m[1]));
  check('...and neither names the address, the nationality, the engine, the chassis or the make as a key to return', keysAsked.length === 9 && !keysAsked.some((k) => /address|nationality|engine|chassis|make|motor/i.test(k)), keysAsked);
  const interfaces = [...gemini.matchAll(/export interface (?:Mtop|License)ParsedData \{([\s\S]*?)\}/g)].map((m) => m[1]).join('\n');
  check('the parsed-data types hold no address, nationality, engine, chassis or make', !/address|nationality|engine|chassis|vehicleMake|motorNumber/i.test(interfaces), interfaces);
  const driverWrites = grep(appFiles.filter((f) => f.includes('driver-pwa')), /(?:residential_address|ocr_address|submitted_address|submitted_chassis_number|submitted_motor_number|submitted_make|chassis_number|motor_number)\s*:/g);
  check('the Driver app no longer writes the address, chassis, motor or make columns', driverWrites.length === 0, driverWrites);
  const mtopOcr = text.get(path.join(ROOT, 'apps', 'driver-pwa', 'src', 'services', 'mtopOcrService.ts'));
  const parsedBlock = mtopOcr.slice(mtopOcr.indexOf('const parsedData: MtopExtractedData'), mtopOcr.indexOf('const missingFields: string[] = [];', mtopOcr.indexOf('const parsedData: MtopExtractedData')));
  check('the on-device fallback keeps no chassis number, make, motor number or OR number either, and does not ask the driver for a chassis number', /chassisNumber: ''/.test(parsedBlock) && /vehicleMake: ''/.test(parsedBlock) && /motorNumber: ''/.test(parsedBlock) && /orNumber: ''/.test(parsedBlock) && !/Chassis Number'\)/.test(mtopOcr));

  console.log('\nS3 every call the clients and the server make exists in the database, with exactly the parameters they send');
  const s = await setup();
  const { q, one, internal, as, db } = s;
  const nativeArgs = async (fn) => {
    const row = (await q(`SELECT proargnames, pronargs, pronargdefaults FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = '${fn}'`))[0];
    return row ? [...(row.proargnames ?? [])].filter((n) => n.startsWith('p_')).sort() : null;
  };
  const NEW_CLIENT_CALLS = ['admin_exclude_rating', 'admin_confirm_integrity_flag', 'admin_send_conduct_warning', 'place_legal_hold', 'release_legal_hold', 'record_audit_export', 'record_privacy_acceptance',
    'get_expired_identity_documents', 'confirm_identity_documents_purged'];
  const found = {};
  for (const f of [...clientFiles, ...serverFiles]) {
    for (const m of text.get(f).matchAll(/rpc\('([a-z_]+)',\s*\{([^}]*)\}/g)) {
      if (!NEW_CLIENT_CALLS.includes(m[1])) continue;
      (found[m[1]] ??= []).push({ file: rel(f), params: [...m[2].matchAll(/(p_[a-z_]+)\s*:/g)].map((x) => x[1]).sort() });
    }
  }
  for (const fn of NEW_CLIENT_CALLS) {
    const calls = found[fn] ?? [];
    const dbNames = await nativeArgs(fn);
    check(`${fn}: called from ${calls.length ? calls.map((c) => c.file.split('/').pop()).join(', ') : 'NOWHERE'} with exactly the function's parameters (${(dbNames ?? []).join(', ')})`,
      calls.length >= 1 && dbNames !== null && calls.every((c) => JSON.stringify(c.params) === JSON.stringify(dbNames)), { calls, dbNames });
  }
  const auditSrc = text.get(path.join(SHARED, 'utils', 'auditLog.ts'));
  const sentAudit = [...auditSrc.slice(auditSrc.indexOf('const argsOf')).matchAll(/(p_[a-z_]+):/g)].map((m) => m[1]).slice(0, 6).sort();
  check('get_audit_log: the shared helper sends exactly the six parameters of the function', JSON.stringify(sentAudit) === JSON.stringify(await nativeArgs('get_audit_log')), sentAudit);
  check('run_retention_job takes no parameter (the scheduler endpoint calls it with none)', JSON.stringify(await nativeArgs('run_retention_job')) === '[]' && /rpc\('run_retention_job'\)/.test(text.get(path.join(ROOT, 'server', 'src', 'routes', 'schedulerRoutes.ts'))));
  // the columns the screens read exist
  const cols = async (t) => (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${t}'`)).map((c) => c.column_name);
  const need = { driver: ['weighted_average_rating', 'rating_count'], passenger: ['average_rating', 'rating_count'], rating: ['rating_id', 'booking_id', 'ratee_id', 'stars', 'tags', 'comment', 'created_at', 'is_excluded'],
    driver_rating: ['rating_id', 'stars', 'comment', 'created_at', 'passenger_name', 'driver_name', 'toda_name', 'is_excluded'] };
  for (const [t, wanted] of Object.entries(need)) { const have = await cols(t); check(`${t}: the screens' columns exist (${wanted.join(', ')})`, wanted.every((c) => have.includes(c)), wanted.filter((c) => !have.includes(c))); }

  // a Supabase-shaped rpc() that calls the real function by NAME as the signed-in user (named notation: a wrong parameter name fails)
  const rpcFor = (uid, spy = []) => async (fn, args) => {
    spy.push(fn);
    try {
      const names = Object.keys(args ?? {});
      const vals = names.map((n) => (args[n] !== null && typeof args[n] === 'object' ? JSON.stringify(args[n]) : args[n]));
      const run = (tx) => tx.query(`SELECT public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) AS r`, vals);
      const r = uid ? await as(uid, run) : await asUser(db, { uid: null, role: 'anon' }, run, { commit: true });
      return { data: r.rows[0].r, error: null };
    } catch (e) {
      return { data: null, error: { message: e.message } };
    }
  };

  console.log('\nS4 ratingDisplay.ts: "Not Yet Rated" before the first rating, the mean after (T1), read from the database');
  const rd = loadTs(path.join(SHARED, 'utils', 'ratingDisplay.ts'));
  check('no rating, a zero, an empty string and a missing value are all "Not Yet Rated" (Filipino: "Wala pang rating")', [null, undefined, '', 0, '0'].every((v) => rd.formatAverageRating(v) === 'Not Yet Rated' && rd.displayedAverageRating(v) === null) && rd.formatAverageRating(null, 0, 'tl') === 'Wala pang rating');
  check('4.6 from 3 ratings shows "4.6"; two digits when asked; a count of 0 hides any number', rd.formatAverageRating(4.6, 3) === '4.6' && rd.formatAverageRating('3.5', 2, 'en', 2) === '3.50' && rd.formatAverageRating(4.6, 0) === 'Not Yet Rated');
  const D2 = DRIVERS.D2.id, P1 = PAX.P1.id;
  const fresh = await one(`SELECT weighted_average_rating AS a, rating_count AS n FROM driver WHERE driver_id = '${D2}'`);
  check('a driver with no rating, as the database holds it, reads "Not Yet Rated" on the screen', rd.formatAverageRating(fresh.a, fresh.n) === 'Not Yet Rated', fresh);
  const t1 = await s.trip('P1', 'D2');
  await s.rate(t1, 'Passenger', 4);
  const one1 = await one(`SELECT weighted_average_rating AS a, rating_count AS n FROM driver WHERE driver_id = '${D2}'`);
  check('after one rating of 4 the screen shows 4.0', rd.formatAverageRating(one1.a, one1.n) === '4.0', one1);
  const t2 = await s.trip('P2', 'D2');
  await s.rate(t2, 'Passenger', 5, new Date(Date.now() + 1000).toISOString().replace('Z', '+00'));
  const two = await one(`SELECT weighted_average_rating AS a, rating_count AS n FROM driver WHERE driver_id = '${D2}'`);
  check('after a second rating of 5 it shows the mean 4.5', rd.formatAverageRating(two.a, two.n) === '4.5', two);
  const target = await one(`SELECT rating_id FROM rating WHERE booking_id = '${t2}' AND rater_role = 'Passenger'`);
  const LGU = rpcFor(ID.L_AUTH);
  const ex = await LGU('admin_exclude_rating', { p_rating_id: target.rating_id, p_exclude: true, p_reason: 'Test: contract check of the exclusion.' });
  const exd = await one(`SELECT weighted_average_rating AS a, rating_count AS n FROM driver WHERE driver_id = '${D2}'`);
  check('excluding it through the same call the LGU portal makes recalculates the mean (4.0 from 1 rating)', ex.error === null && rd.formatAverageRating(exd.a, exd.n) === '4.0' && Number(exd.n) === 1, { ex, exd });

  console.log('\nS5 auditLog.ts: paging, filters in Asia/Manila days, the export (audited FIRST), against the real get_audit_log');
  const al = loadTs(path.join(SHARED, 'utils', 'auditLog.ts'));
  const cfg = loadTs(path.join(SHARED, 'config', 'policyConfig.ts'));
  for (let i = 1; i <= 7; i++) await internal(`SELECT public.record_policy_audit('CT_ENTRY', 'CT-${i}', 'Contract ${i}', 'Contract', 'Contract entry ${i} {"x":"y"}', NULL, '{"i":${i}}'::jsonb)`);
  check('a typed day is a day in Asia/Manila: 18 Oct starts at 16:00 UTC on the 17th, and its end is the next day', al.manilaDayStartIso('2026-10-18') === '2026-10-17T16:00:00.000Z' && al.manilaNextDayStartIso('2026-10-18') === '2026-10-18T16:00:00.000Z' && al.manilaDayStartIso('18/10/2026') === null && al.manilaDayStartIso('') === null);
  const lguRpc = rpcFor(ID.L_AUTH);
  const page1 = await al.fetchAuditLogPage(lguRpc, { action: 'CT_ENTRY' }, 3, 0);
  const page2 = await al.fetchAuditLogPage(lguRpc, { action: 'CT_ENTRY' }, 3, 3);
  check('the first page has 3 of the 7 entries with the fields the screen needs, the second page has the next 3 (no overlap)', page1.total === 7 && page1.rows.length === 3 && page2.rows.length === 3 && page1.rows.every((r) => !page2.rows.some((x) => x.log_id === r.log_id))
    && ['log_id', 'performed_at', 'performed_at_manila', 'action_type', 'target_id', 'details', 'actor_name'].every((k) => k in page1.rows[0]), { total: page1.total, first: page1.rows[0] });
  const todayManila = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const inDay = await al.fetchAuditLogPage(lguRpc, { action: 'CT_ENTRY', from: al.manilaDayStartIso(todayManila), to: al.manilaNextDayStartIso(todayManila) });
  const nextDay = await al.fetchAuditLogPage(lguRpc, { action: 'CT_ENTRY', from: al.manilaNextDayStartIso(todayManila) });
  check('the date filters: today\'s entries are in today\'s Manila day, none are tomorrow', inDay.total === 7 && nextDay.total === 0, { inDay: inDay.total, nextDay: nextDay.total });
  const searched = await al.fetchAuditLogPage(lguRpc, { search: 'Contract entry 3' });
  check('search is literal text (the braces and quotes in the details do not break it)', searched.total === 1 && (await al.fetchAuditLogPage(lguRpc, { search: '{"x":"y"}' })).total === 7, searched.total);
  const exportAll = await al.fetchAuditLogForExport(lguRpc, { action: 'CT_ENTRY' });
  const exportCap = await al.fetchAuditLogForExport(lguRpc, { action: 'CT_ENTRY' }, 3);
  check('the export fetches every entry (7), or stops at the cap and says it was cut (3 of 7, truncated)', exportAll.rows.length === 7 && !exportAll.truncated && exportCap.rows.length === 3 && exportCap.truncated && exportCap.total === 7, { exportAll: exportAll.rows.length, exportCap });
  const matrix = al.auditLogExportMatrix(exportAll.rows);
  check('every export row has one cell per header, the actor and both times', matrix.length === 7 && matrix.every((r) => r.length === al.AUDIT_EXPORT_HEADERS.length && r.every((c) => typeof c === 'string') && r[0] && r[1] && r[2]) && al.AUDIT_EXPORT_HEADERS.length === 12, matrix[0]);
  check('the file name carries the date: audit_log_2026-10-18.xlsx / .csv / .pdf', al.auditLogFileName('xlsx', new Date('2026-10-18T05:00:00Z')) === 'audit_log_2026-10-18.xlsx' && al.auditLogFileName('csv', new Date('2026-10-18T05:00:00Z')).endsWith('.csv') && al.auditLogFileName('pdf', new Date('2026-10-18T05:00:00Z')).endsWith('.pdf'));
  const order = [];
  const fakeXlsx = { utils: { aoa_to_sheet: (d) => { order.push(`sheet:${d.length}`); return {}; }, book_new: () => ({}), book_append_sheet: () => {} }, writeFile: (_b, name) => order.push(`file:${name}`) };
  const auditedBefore = Number((await one(`SELECT count(*)::int n FROM audit_log WHERE action_type = 'AUDIT_LOG_EXPORTED'`)).n);
  const exported = await al.exportAuditLogFile({ rpc: rpcFor(ID.L_AUTH, order), format: 'xlsx', filters: { action: 'CT_ENTRY' }, generatedBy: 'LGU Admin', title: 'Audit log', loadXlsx: async () => fakeXlsx });
  const auditedAfter = await q(`SELECT * FROM audit_log WHERE action_type = 'AUDIT_LOG_EXPORTED' ORDER BY performed_at DESC`);
  check('the Excel export wrote 7 rows + the header, wrote its audit entry, and the entry came BEFORE the file was handed over', exported.count === 7 && !exported.truncated && order.indexOf('record_audit_export') >= 0 && order.indexOf('record_audit_export') < order.findIndex((x) => x.startsWith('file:')) && order.includes('sheet:8')
    && auditedAfter.length === auditedBefore + 1 && auditedAfter[0].actor_id === ID.L_AUTH, { order, exported });
  const order2 = [];
  const failing = async (fn, args) => { order2.push(fn); return fn === 'record_audit_export' ? { data: null, error: { message: 'ERR_TEST: the entry could not be written' } } : rpcFor(ID.L_AUTH)(fn, args); };
  const failedExport = await attempt(() => al.exportAuditLogFile({ rpc: failing, format: 'xlsx', filters: { action: 'CT_ENTRY' }, generatedBy: 'x', title: 'x', loadXlsx: async () => { order2.push('loadXlsx'); return fakeXlsx; } }));
  check('when the export cannot be written to the audit log, nothing is handed over (no file, the workbook is not even loaded)', !failedExport.ok && /ERR_TEST/.test(failedExport.error) && !order2.includes('loadXlsx'), { failedExport, order2 });
  const todaPage = await al.fetchAuditLogPage(rpcFor(ID.T_AUTH), { action: 'CT_ENTRY' });
  check('a TODA Administrator reading through the same helper sees only their own entries (none of these system entries)', todaPage.total === 0 && todaPage.rows.length === 0, todaPage.total);
  const visitor = await attempt(() => al.fetchAuditLogPage(rpcFor(null), {}));
  const player = await attempt(() => al.fetchAuditLogPage(rpcFor(PAX.P1.uid), {}));
  check('a visitor and a passenger get an error, not a page (the helper throws the database\'s message)', !visitor.ok && !player.ok && /permission denied|ERR_/i.test(visitor.error + ' ' + player.error), { visitor: visitor.error, player: player.error });
  check('the page size and the export cap are what the screens use and below the database cap', cfg.AUDIT_LOG_PAGE_SIZE === 200 && cfg.AUDIT_EXPORT_MAX_ROWS === 20000);

  console.log('\nS6 privacyNotice.ts: "I Agree" is recorded on the account with the version and the server\'s time');
  const pn = loadTs(path.join(SHARED, 'config', 'privacyNotice.ts'));
  const mem = new Map();
  global.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const before = await one(`SELECT privacy_notice_version AS v, privacy_accepted_at AS at FROM passenger WHERE passenger_id = '${P1}'`);
  const spy1 = [];
  await pn.acceptPrivacyNotice(rpcFor(PAX.P1.uid, spy1));
  const afterP = await one(`SELECT privacy_notice_version AS v, privacy_accepted_at AS at FROM passenger WHERE passenger_id = '${P1}'`);
  check('the passenger\'s acceptance: nothing before, the notice version and a server time after, and the device remembers it', before.v === null && before.at === null && afterP.v === cfg.PRIVACY_NOTICE_VERSION && afterP.at !== null && Math.abs(Date.now() - new Date(afterP.at).getTime()) < 120000
    && mem.get(pn.PRIVACY_ACCEPTED_STORAGE_KEY) === cfg.PRIVACY_NOTICE_VERSION, { before, afterP });
  mem.clear();
  const spy2 = [];
  await pn.syncPrivacyAcceptance(rpcFor(DRIVERS.D1.uid, spy2));
  check('syncing with nothing remembered makes no call', spy2.length === 0);
  mem.set(pn.PRIVACY_ACCEPTED_STORAGE_KEY, cfg.PRIVACY_NOTICE_VERSION);
  await pn.syncPrivacyAcceptance(rpcFor(DRIVERS.D1.uid, spy2));
  const drv = await one(`SELECT privacy_notice_version AS v, privacy_accepted_at AS at FROM driver WHERE driver_id = '${DRIVERS.D1.id}'`);
  check('...and with an acceptance remembered on the device it is recorded on the driver\'s row once the row exists', spy2.length === 1 && drv.v === cfg.PRIVACY_NOTICE_VERSION && drv.at !== null, { spy2, drv });
  const throwing = async () => { throw new Error('offline'); };
  const noThrow = await attempt(async () => { await pn.acceptPrivacyNotice(throwing); await pn.syncPrivacyAcceptance(throwing); });
  check('a failing network never throws out of the acceptance (the flow continues, it is recorded next time)', noThrow.ok, noThrow);
  const bad = await rpcFor(PAX.P1.uid)('record_privacy_acceptance', { p_version: 'whenever' });
  check('a made-up version string is refused by the database', bad.error !== null && /ERR_/.test(bad.error.message), bad);
  delete global.localStorage;

  const ok = summary();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
