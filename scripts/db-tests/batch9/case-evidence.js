// 20261028000006 (Rules 25.2 and 18.4): photos for an appeal and for a fare dispute, on the local emulator (never Supabase).
//   1. the private bucket 'case-evidence' and the one test of what a path looks like
//   2. a statement in a fare dispute carries up to 3 photos (submit_fare_dispute_statement); the administrators' list returns the paths
//   3. who can open a photo: the one who sent it, the LGU, the TODA Administrator who reviews the case: nobody else, not even the other party of the dispute
//   4. an appeal carries at most 3 photos, each in the requester's own folder (the column took any text before)
const fs = require('fs');
const path = require('path');
const { setup, ID, PAX, DRIVERS, attempt, check, summary } = require('../b9fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, as, svc } = s;
  const canSee = async (uid, name) => (await attempt(() => as(uid, (tx) => tx.query(`SELECT 1 FROM storage.objects WHERE bucket_id = 'case-evidence' AND name = $1`, [name])))).value?.rows.length === 1;
  const putAs = (uid, name) => attempt(() => as(uid, (tx) => tx.query(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('case-evidence', $1, $2)`, [name, uid])));
  const photo = (uid, n = 1, ext = 'jpg') => `${uid}/17000000000${n}-${n}.${ext}`;
  const P1 = PAX.P1.uid, D1 = DRIVERS.D1.uid, P2 = PAX.P2.uid;

  console.log('S1 the bucket and what a path looks like');
  const bucket = await one(`SELECT public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'case-evidence'`);
  check('the bucket is private, 5 MB, JPEG / PNG / WebP', bucket && bucket.public === false && bucket.file_size_limit === 5242880 && JSON.stringify([...bucket.allowed_mime_types].sort()) === JSON.stringify(['image/jpeg', 'image/png', 'image/webp']), bucket);
  const ok = async (owner, p) => (await one(`SELECT public._is_case_evidence_path($1::uuid, $2) AS r`, [owner, p])).r;
  check('a time-number name in the owner\'s own folder passes (jpg, jpeg, png, webp)', (await ok(P1, photo(P1))) && (await ok(P1, photo(P1, 2, 'png'))) && (await ok(P1, photo(P1, 3, 'webp'))) && (await ok(P1, photo(P1, 4, 'jpeg'))));
  check('...another person\'s folder, a flat name, a traversal, a name the phone chose, another format, nothing: all refused',
    !(await ok(P1, photo(D1))) && !(await ok(P1, '1700000000-1.jpg')) && !(await ok(P1, `${P1}/../${D1}/1-1.jpg`)) && !(await ok(P1, `${P1}/holiday.jpg`)) && !(await ok(P1, photo(P1, 1, 'pdf'))) && !(await ok(P1, null)) && !(await ok(null, photo(P1))));
  const policies = (await q(`SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'case_evidence_%' ORDER BY policyname`)).map((p) => p.cmd);
  check('there is a policy to read, write, change and delete', JSON.stringify(policies.sort()) === JSON.stringify(['DELETE', 'INSERT', 'SELECT', 'UPDATE']), policies);

  console.log('\nS2 a statement in a fare dispute');
  const trip = await s.atDestination('D1', 'P1');
  const report = await s.paxCall('P1', 'passenger_report_fare_discrepancy($1,$2,$3)', [trip.booking_id, 90, 'The driver asked me for 90 pesos but the app says 65']);
  const d = await s.dispute(trip.booking_id);
  check('(set-up) a fare dispute is open', report.success === true && d.status === 'Open', report);
  const say = (call, text, paths) => attempt(() => call(`submit_fare_dispute_statement($1,$2,$3)`, [d.dispute_id, text, paths]));
  const paxSay = (text, paths) => say((sql, args) => s.paxCall('P1', sql, args), text, paths);
  const drvSay = (text, paths) => say((sql, args) => s.drvCall('D1', sql, args), text, paths);
  let r = await paxSay('Here is the receipt of the earlier trip', [photo(P1, 1), photo(P1, 2)]);
  check('the passenger adds a statement with 2 photos', r.ok && r.value.success === true, r);
  const note = await one(`SELECT party, note, evidence_paths FROM fare_dispute_note WHERE dispute_id = '${d.dispute_id}' AND party = 'passenger' ORDER BY created_at DESC LIMIT 1`);
  check('...the note keeps the words and both paths', note && note.note === 'Here is the receipt of the earlier trip' && note.evidence_paths.length === 2 && note.evidence_paths[0] === photo(P1, 1), note);
  check('...and the audit log says how many photos', (await s.audit('FARE_DISPUTE_NOTE', d.dispute_id)).some((a) => /2 photo/.test(a.details)));
  r = await paxSay('Words only, no photos', []);
  check('a statement without photos is fine (the older words-only call works too)', r.ok && r.value.success === true && (await s.paxCall('P1', 'submit_fare_dispute_note($1,$2)', [d.dispute_id, 'An older style note'])).success === true);
  for (const [label, paths, code] of [
    ['four photos', [photo(P1, 1), photo(P1, 2), photo(P1, 3), photo(P1, 4)], 'ERR_EVIDENCE'],
    ['a photo in somebody else\'s folder', [photo(D1)], 'ERR_EVIDENCE'],
    ['a link instead of a path', ['https://example.com/a.jpg'], 'ERR_EVIDENCE'],
    ['a traversal', [`${P1}/../x/1-1.jpg`], 'ERR_EVIDENCE'],
  ]) {
    r = await paxSay('Some supporting words here', paths);
    check(`${label} is refused (${code})`, r.ok && r.value.success === false && r.value.error_code === code, r);
  }
  r = await paxSay('no', [photo(P1, 1)]);
  check('words that are too short are refused, photos or not', r.ok && r.value.success === false && r.value.error_code === 'ERR_NOTE_TEXT', r);
  r = await attempt(() => s.paxCall('P2', `submit_fare_dispute_statement($1,$2,$3)`, [d.dispute_id, 'I was not on this trip at all', [photo(P2, 1)]]));
  check('a person who is not a party cannot add one', r.ok && r.value.success === false && r.value.error_code === 'ERR_NOT_YOUR_DISPUTE', r);
  r = await drvSay('I asked for the fare shown after the detour', [photo(D1, 1)]);
  check('the driver adds a statement with a photo of his own', r.ok && r.value.success === true, r);
  const asTodaOne = await s.todaCall('get_fare_disputes($1,$2)', [null, 100]);
  const notes = asTodaOne[0].notes;
  check('the TODA Administrator\'s list carries the paths of each note', notes.length >= 3 && notes.some((n) => n.party === 'passenger' && n.evidence_paths.length === 2) && notes.some((n) => n.party === 'driver' && n.evidence_paths[0] === photo(D1, 1)) && notes.every((n) => Array.isArray(n.evidence_paths)), notes);
  check('the LGU sees the same; the other TODA sees nothing', (await s.lguCall('get_fare_disputes($1,$2)', [null, 100]))[0].notes.length === notes.length && (await s.todaCall('get_fare_disputes($1,$2)', [null, 100], ID.T2_AUTH)).length === 0);

  console.log('\nS3 who can open a photo');
  const pPhoto = photo(P1, 1), dPhoto = photo(D1, 1);
  const up1 = await putAs(P1, pPhoto);
  check('a passenger uploads into her own folder', up1.ok, up1);
  check('...not into somebody else\'s, and not a flat name', !(await putAs(P1, photo(D1, 9))).ok && !(await putAs(P1, 'flat.jpg')).ok);
  const up2 = await putAs(D1, dPhoto);
  check('a driver uploads into his own folder', up2.ok, up2);
  check('the passenger\'s photo: she, the driver\'s TODA Administrator and the LGU open it', (await canSee(P1, pPhoto)) && (await canSee(ID.T_AUTH, pPhoto)) && (await canSee(ID.L_AUTH, pPhoto)));
  check('...not the other party (the driver), another passenger, the other TODA\'s Administrator', !(await canSee(D1, pPhoto)) && !(await canSee(P2, pPhoto)) && !(await canSee(ID.T2_AUTH, pPhoto)));
  check('the driver\'s photo: he, his TODA Administrator and the LGU; not the passenger', (await canSee(D1, dPhoto)) && (await canSee(ID.T_AUTH, dPhoto)) && (await canSee(ID.L_AUTH, dPhoto)) && !(await canSee(P1, dPhoto)) && !(await canSee(ID.T2_AUTH, dPhoto)));
  const orphan = photo(P1, 7);
  await putAs(P1, orphan);
  check('a photo that no statement mentions is the uploader\'s and the LGU\'s only', (await canSee(P1, orphan)) && (await canSee(ID.L_AUTH, orphan)) && !(await canSee(ID.T_AUTH, orphan)));
  await attempt(() => as(P1, (tx) => tx.query(`DELETE FROM storage.objects WHERE bucket_id = 'case-evidence' AND name = $1`, [pPhoto])));
  await attempt(() => as(ID.T_AUTH, (tx) => tx.query(`DELETE FROM storage.objects WHERE bucket_id = 'case-evidence' AND name = $1`, [pPhoto])));
  check('neither the sender nor the TODA can delete a submitted photo', await canSee(ID.L_AUTH, pPhoto));
  await attempt(() => as(ID.L_AUTH, (tx) => tx.query(`DELETE FROM storage.objects WHERE bucket_id = 'case-evidence' AND name = $1`, [orphan])));
  check('the LGU Administrator can', !(await canSee(P1, orphan)));
  const anon = await attempt(() => s.anon((tx) => tx.query(`SELECT 1 FROM storage.objects WHERE bucket_id = 'case-evidence'`)));
  check('and anon reads nothing', !anon.ok || anon.value.rows.length === 0, anon);
  await s.drvCall('D1', 'driver_confirm_payment_received($1)', [trip.booking_id]);   // the driver closes the trip; the administrator can then decide
  const decided = await attempt(() => s.todaCall('resolve_fare_dispute($1,$2,$3,$4,$5)', [d.dispute_id, 'FARE_CONFIRMED', null, 'Reviewed with both parties after the trip', null]));
  r = await paxSay('One more thing after the decision', [photo(P1, 5)]);
  const resolved = (await one(`SELECT status FROM fare_dispute WHERE dispute_id = '${d.dispute_id}'`)).status;
  check('(the administrator decided)', decided.ok && decided.value.success === true, decided);
  check('after the decision nothing can be added', resolved === 'Resolved' && r.ok && r.value.success === false && r.value.error_code === 'ERR_DISPUTE_RESOLVED', { resolved, r });

  console.log('\nS4 an appeal carries at most 3 photos, each in the requester\'s own folder');
  const strike = (type, id, code, key) => svc(async (tx) => (await tx.query('SELECT public.issue_strike($1,$2,$3,NULL,NULL,NULL,$4,NULL,NULL,NULL,NULL) r', [type, id, code, key])).rows[0].r);
  const sid = async (key) => (await one(`SELECT strike_id FROM strikes_ledger WHERE idempotency_key = $1`, [key])).strike_id;
  await strike('driver', ID.D1, 'DRV_STALL', 'ce-d1');
  const appeal = (uid, strikeId, evidence) => attempt(() => as(uid, async (tx) => (await tx.query(`SELECT public.submit_exemption_request($1, 'VEHICLE_BREAKDOWN', 'The tricycle broke down on the way', $2::jsonb, false) AS r`, [strikeId, JSON.stringify(evidence)])).rows[0].r));
  const dStrike = await sid('ce-d1');
  for (const [label, evidence] of [
    ['four photos', [photo(D1, 1), photo(D1, 2), photo(D1, 3), photo(D1, 4)]],
    ['a link', ['https://example.com/a.jpg']],
    ['somebody else\'s folder', [photo(P1, 1)]],
    ['not a list', { a: 1 }],
    ['a number in the list', [1]],
  ]) {
    r = await appeal(D1, dStrike, evidence);
    check(`${label} is refused (ERR_EVIDENCE)`, !r.ok && /ERR_EVIDENCE/.test(r.error), r);
  }
  check('...and no appeal was recorded by them', (await q(`SELECT 1 FROM exemption_request WHERE strike_id = '${dStrike}'`)).length === 0);
  const appealPhotos = [photo(D1, 21), photo(D1, 22)];   // not the files of the fare dispute: only the appeal mentions these
  r = await appeal(D1, dStrike, appealPhotos);
  await putAs(D1, appealPhotos[0]);
  check('two photos of his own: the appeal is recorded, with the paths', r.ok && r.value.success === true && JSON.stringify((await one(`SELECT evidence_urls FROM exemption_request WHERE strike_id = '${dStrike}'`)).evidence_urls) === JSON.stringify(appealPhotos), r);
  const seen = { toda1: await canSee(ID.T_AUTH, appealPhotos[0]), lgu: await canSee(ID.L_AUTH, appealPhotos[0]), toda2: await canSee(ID.T2_AUTH, appealPhotos[0]), pax: await canSee(P1, appealPhotos[0]), own: await canSee(D1, appealPhotos[0]) };
  check('the driver\'s TODA Administrator and the LGU can open them; the other TODA\'s Administrator and a passenger cannot', seen.toda1 && seen.lgu && !seen.toda2 && !seen.pax, seen);
  await strike('passenger', ID.P1, 'PAX_LATE_CANCEL', 'ce-p1');
  const pStrike = await sid('ce-p1');
  r = await appeal(P1, pStrike, [photo(P1, 8)]);
  await putAs(P1, photo(P1, 8));
  check('a passenger\'s appeal with a photo is recorded', r.ok && r.value.success === true && r.value.assigned_role === 'lgu_admin', r);
  check('...and only she and the LGU open it, not a TODA Administrator (Rule 25.5)', (await canSee(P1, photo(P1, 8))) && (await canSee(ID.L_AUTH, photo(P1, 8))) && !(await canSee(ID.T_AUTH, photo(P1, 8))) && !(await canSee(ID.T2_AUTH, photo(P1, 8))));

  console.log('\nThe migration file');
  const file = path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261028000006_case_evidence.sql');
  const sql = fs.readFileSync(file, 'utf8');
  check('it is pure ASCII with LF line endings', !/[^\x00-\x7F]/.test(sql) && !/\r/.test(sql) && sql.endsWith('\n'));
  const again = await attempt(() => s.db.exec(sql));
  check('running it a second time raises nothing', again.ok, again.error);
  check('...and changes nothing the tests above rely on', (await one(`SELECT count(*)::int n FROM storage.buckets WHERE id = 'case-evidence'`)).n === 1 && (await canSee(ID.T_AUTH, pPhoto)));

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
