// Rules 25.2 and 18.4: the TypeScript the apps and the portals use for photos on an appeal and on a fare-dispute statement (packages/shared/src/utils/caseEvidence.ts and
// strikeAppeals.ts) against the REAL database functions, storage policies and row security. Proves that every call and parameter name exists (the calls are made by NAME), that the
// screens' checks agree with the database on a table of inputs, that the photos are uploaded into the sender's own folder and arrive as the paths the database accepts, that the
// right people get a link and the others do not, that a person's own disputes are read into what the screen shows, and that the database's own sentences reach the screen.
// Whole migration chain on the local emulator (never Supabase).
const path = require('path');
const esbuild = require('esbuild');
const { setup, ID, PAX, DRIVERS, attempt, check, summary, asUser } = require('../b9fixtures');

const SHARED = path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'src', 'utils');
function loadTs(file) {
  const code = esbuild.buildSync({ entryPoints: [file], bundle: true, write: false, format: 'cjs', platform: 'node', target: 'es2022', logLevel: 'silent' }).outputFiles[0].text;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
  return mod.exports;
}

(async () => {
  const ce = loadTs(path.join(SHARED, 'caseEvidence.ts'));
  const sa = loadTs(path.join(SHARED, 'strikeAppeals.ts'));
  // signedStorageUrl remembers the links it made (one person per browser session), so every person here signs with a fresh copy of the module: otherwise the first person's links would be handed to the next
  const signAs = (client, paths) => loadTs(path.join(SHARED, 'caseEvidence.ts')).signCaseEvidence(client, paths);
  const s = await setup();
  const { db, internal, one, q, svc } = s;
  const P1 = PAX.P1.uid, P2 = PAX.P2.uid, D1 = DRIVERS.D1.uid;
  const jpeg = (size = 200000, name = 'photo.jpg') => ({ type: 'image/jpeg', size, name });

  // a Supabase-shaped client acting as a signed-in user: rpc by NAME, the selects the screens make, and the storage calls (upload and createSignedUrl obey the real policies)
  const clientAs = (uid, o = {}) => ({
    rpc: async (fn, args) => {
      try {
        const names = Object.keys(args ?? {});
        const cast = (n) => (n === 'p_evidence_paths' ? '::text[]' : n === 'p_evidence' ? '::jsonb' : '');
        const r = await asUser(db, { uid }, (tx) => tx.query(`SELECT public.${fn}(${names.map((n, i) => `${n} => $${i + 1}${cast(n)}`).join(', ')}) AS r`, names.map((n) => (n === 'p_evidence' ? JSON.stringify(args[n]) : args[n]))), { commit: true });
        return { data: r.rows[0].r, error: null };
      } catch (e) {
        return { data: null, error: { message: e.message } };
      }
    },
    auth: { getUser: async () => ({ data: { user: { id: uid } } }) },
    storage: {
      from: (bucket) => ({
        upload: async (p, _file, _opts) => {
          if (o.failUpload) return { error: { message: 'storage is down' } };
          try {
            await asUser(db, { uid }, (tx) => tx.query(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ($1, $2, $3)`, [bucket, p, uid]), { commit: true });
            return { error: null };
          } catch (e) {
            return { error: { message: e.message } };
          }
        },
        createSignedUrl: async (p, _ttl) => {
          const r = await asUser(db, { uid }, (tx) => tx.query(`SELECT 1 FROM storage.objects WHERE bucket_id = $1 AND name = $2`, [bucket, p]), { commit: true });
          return r.rows.length > 0 ? { data: { signedUrl: `https://signed.test/${bucket}/${p}` }, error: null } : { data: null, error: { message: 'not found' } };
        },
      }),
    },
    from: (table) => ({
      select: (columns) => ({
        order: (column, opts) => ({
          limit: async (n) => {
            try {
              const r = await asUser(db, { uid }, (tx) => tx.query(`SELECT ${columns} FROM public.${table} ORDER BY ${column} ${opts.ascending ? 'ASC' : 'DESC'} LIMIT ${Number(n)}`), { commit: true });
              return { data: r.rows, error: null };
            } catch (e) {
              return { data: null, error: { message: e.message } };
            }
          },
        }),
        in: async (column, values) => {
          try {
            const r = await asUser(db, { uid }, (tx) => tx.query(`SELECT ${columns} FROM public.${table} WHERE ${column}::text = ANY($1::text[])`, [values]), { commit: true });
            return { data: r.rows, error: null };
          } catch (e) {
            return { data: null, error: { message: e.message } };
          }
        },
      }),
    }),
  });
  const pax = clientAs(P1);
  const drv = clientAs(D1);
  const pax2 = clientAs(P2);
  const toda = clientAs(ID.T_AUTH);
  const toda2 = clientAs(ID.T2_AUTH);
  const lgu = clientAs(ID.L_AUTH);

  // an open dispute: the passenger reports the fare at the end of a trip
  const trip = await s.atDestination('D1', 'P1');
  await s.paxCall('P1', 'passenger_report_fare_discrepancy($1,$2,$3)', [trip.booking_id, 90, 'The driver asked me for 90 pesos but the app says 65']);
  const d = await s.dispute(trip.booking_id);

  console.log('S1 the screens\' checks agree with the database');
  const textCases = [['2 characters', 'ab'], ['3 characters', 'abc'], ['1000 characters', 'x'.repeat(1000)], ['1001 characters', 'x'.repeat(1001)], ['blank', '     '], ['padded to 3', '  abc  ']];
  for (const [label, text] of textCases) {
    const screen = ce.fareStatementProblem(text) === null;
    const res = await attempt(() => asUser(db, { uid: P1 }, async (tx) => (await tx.query(`SELECT public.submit_fare_dispute_statement(${Object.keys(ce.fareStatementArgs('a', 'b', [])).map((n, i) => `${n} => $${i + 1}${n === 'p_evidence_paths' ? '::text[]' : ''}`).join(', ')}) AS r`, Object.values(ce.fareStatementArgs(d.dispute_id, text, [])))).rows[0].r, { commit: false }));
    check(`${label}: the screen ${screen ? 'allows' : 'blocks'} it and the database ${res.ok && res.value.success ? 'accepts' : 'refuses'} it`, screen === (res.ok && res.value.success === true), { screen, res });
  }
  check('the photo check: 3 pass; 4, a PDF, and 6 MB do not (the same limits as the bucket)', ce.caseEvidenceProblem([jpeg(), jpeg(), jpeg()]) === null && ce.caseEvidenceProblem([jpeg(), jpeg(), jpeg(), jpeg()]) !== null
    && ce.caseEvidenceProblem([{ type: 'application/pdf', size: 1000 }]) !== null && ce.caseEvidenceProblem([jpeg(6 * 1024 * 1024)]) !== null && ce.caseEvidenceProblem([]) === null);

  console.log('\nS2 a statement with photos, through the shared call');
  let r = await ce.addFareDisputeStatement(pax, d.dispute_id, '  Here is the receipt of the earlier trip  ', [jpeg(), jpeg(150000, 'b.jpg')]);
  check('the passenger adds it (null = no problem)', r === null, r);
  const note = await one(`SELECT note, evidence_paths FROM fare_dispute_note WHERE dispute_id = '${d.dispute_id}' AND party = 'passenger' ORDER BY created_at DESC LIMIT 1`);
  check('...the words are trimmed, and the 2 photos are in her own folder with the names the database accepts', note.note === 'Here is the receipt of the earlier trip' && note.evidence_paths.length === 2
    && note.evidence_paths.every((p) => new RegExp(`^${P1}/[0-9]+-[0-9]+\\.jpg$`).test(p)), note);
  check('...and the files exist in the bucket', (await q(`SELECT 1 FROM storage.objects WHERE bucket_id = 'case-evidence' AND name = ANY($1::text[])`, [note.evidence_paths])).length === 2);
  r = await ce.addFareDisputeStatement(pax, d.dispute_id, 'ab', [jpeg()]);
  check('words that are too short are refused on the screen, and nothing was uploaded', r !== null && /3 hanggang 1000/.test(r) && (await q(`SELECT 1 FROM storage.objects WHERE bucket_id = 'case-evidence'`)).length === 2, r);
  r = await ce.addFareDisputeStatement(pax, d.dispute_id, 'Four photos is too many', [jpeg(), jpeg(), jpeg(), jpeg()]);
  check('four photos are refused before anything is sent', r !== null && /Hanggang 3/.test(r) && (await q(`SELECT 1 FROM storage.objects WHERE bucket_id = 'case-evidence'`)).length === 2, r);
  const notesBefore = (await q(`SELECT 1 FROM fare_dispute_note WHERE dispute_id = '${d.dispute_id}'`)).length;
  r = await ce.addFareDisputeStatement(clientAs(P1, { failUpload: true }), d.dispute_id, 'The upload will fail now', [jpeg()]);
  check('an upload that fails comes back as the sentence to show, and the statement is not sent', r !== null && /could not be uploaded/.test(r) && (await q(`SELECT 1 FROM fare_dispute_note WHERE dispute_id = '${d.dispute_id}'`)).length === notesBefore, r);
  r = await ce.addFareDisputeStatement(pax2, d.dispute_id, 'I was not on this trip at all', []);
  check('a person who is not a party gets the database\'s sentence, without its code', r !== null && /not yours/.test(r) && !/ERR_/.test(r), r);
  r = await ce.addFareDisputeStatement(drv, d.dispute_id, 'I asked for the fare shown after the detour', [jpeg()]);
  check('the driver adds a statement with a photo', r === null, r);

  console.log('\nS3 a person\'s own disputes');
  const own = await ce.fetchOwnFareDisputes(pax);
  check('the passenger reads her dispute with the trip\'s addresses, the fares as numbers, and the statements oldest first', own && own.length === 1 && own[0].disputeId === d.dispute_id && own[0].status === 'Open'
    && own[0].claimedAmount === 90 && own[0].systemFare === 65 && own[0].pickup !== null && own[0].dropoff !== null && own[0].notes.length >= 3
    && Date.parse(own[0].notes[0].createdAt) <= Date.parse(own[0].notes[own[0].notes.length - 1].createdAt), own);
  check('...each statement carries its photo paths as a list', own[0].notes.every((n) => Array.isArray(n.evidencePaths)) && own[0].notes.some((n) => n.party === 'passenger' && n.evidencePaths.length === 2) && own[0].notes.some((n) => n.party === 'driver' && n.evidencePaths.length === 1));
  check('the driver reads the same dispute', (await ce.fetchOwnFareDisputes(drv))?.[0]?.disputeId === d.dispute_id);
  check('another passenger reads none (an empty list, not an error)', JSON.stringify(await ce.fetchOwnFareDisputes(pax2)) === '[]');

  console.log('\nS4 who gets a link');
  const paxPaths = note.evidence_paths;
  const drvPath = (await one(`SELECT evidence_paths FROM fare_dispute_note WHERE dispute_id = '${d.dispute_id}' AND party = 'driver' ORDER BY created_at DESC LIMIT 1`)).evidence_paths;
  check('the passenger gets links for her own photos', (await signAs(pax, paxPaths)).length === 2 && (await signAs(pax, paxPaths))[0].url.startsWith('https://signed.test/case-evidence/'));
  check('the driver\'s TODA Administrator and the LGU get them for both parties\' photos', (await signAs(toda, [...paxPaths, ...drvPath])).length === 3 && (await signAs(lgu, [...paxPaths, ...drvPath])).length === 3);
  const crossed = { drvOnPax: (await signAs(drv, paxPaths)).length, paxOnDrv: (await signAs(pax, drvPath)).length, toda2: (await signAs(toda2, [...paxPaths, ...drvPath])).length };
  check('the driver gets none of the passenger\'s, the passenger none of the driver\'s, the other TODA none at all', crossed.drvOnPax === 0 && crossed.paxOnDrv === 0 && crossed.toda2 === 0, crossed);
  check('empty and missing lists give no links and no error', (await signAs(pax, [])).length === 0 && (await signAs(pax, null)).length === 0 && (await signAs(pax, ['', null])).length === 0);

  console.log('\nS5 an appeal with photos');
  await svc(async (tx) => tx.query('SELECT public.issue_strike($1,$2,$3,NULL,NULL,NULL,$4,NULL,NULL,NULL,NULL)', ['driver', ID.D1, 'DRV_STALL', 'cec-d1']));
  const strikeId = (await one(`SELECT strike_id FROM strikes_ledger WHERE idempotency_key = 'cec-d1'`)).strike_id;
  let a = await sa.submitStrikeAppealWithPhotos(drv, strikeId, 'VEHICLE_BREAKDOWN', 'The tricycle broke down on the way', [jpeg(), jpeg()]);
  check('the driver appeals with 2 photos: sent, to his TODA Administrator (25.4)', a.ok === true && a.assignedRole === 'toda_admin', a);
  const req = await one(`SELECT evidence_urls FROM exemption_request WHERE strike_id = '${strikeId}'`);
  check('...the request holds the 2 paths of his own folder', req.evidence_urls.length === 2 && req.evidence_urls.every((p) => new RegExp(`^${D1}/[0-9]+-[0-9]+\\.jpg$`).test(p)), req);
  const appealSeen = { toda: (await signAs(toda, req.evidence_urls)).length, lgu: (await signAs(lgu, req.evidence_urls)).length, toda2: (await signAs(toda2, req.evidence_urls)).length, pax: (await signAs(pax, req.evidence_urls)).length };
  check('...his TODA Administrator and the LGU open them, the other TODA and a passenger do not', appealSeen.toda === 2 && appealSeen.lgu === 2 && appealSeen.toda2 === 0 && appealSeen.pax === 0, appealSeen);
  await internal(`DELETE FROM exemption_request WHERE strike_id = '${strikeId}'`);
  const objectsBefore = (await q(`SELECT 1 FROM storage.objects`)).length;
  a = await sa.submitStrikeAppealWithPhotos(drv, strikeId, 'VEHICLE_BREAKDOWN', 'Too many photos for one appeal', [jpeg(), jpeg(), jpeg(), jpeg()]);
  check('four photos: the error is shown and nothing is uploaded or sent', a.ok === false && /Hanggang 3/.test(a.error) && (await q(`SELECT 1 FROM storage.objects`)).length === objectsBefore && (await q(`SELECT 1 FROM exemption_request WHERE strike_id = '${strikeId}'`)).length === 0, a);
  a = await sa.submitStrikeAppealWithPhotos(clientAs(D1, { failUpload: true }), strikeId, 'VEHICLE_BREAKDOWN', 'The upload will fail for this one', [jpeg()]);
  check('an upload that fails: the error is shown and no appeal is recorded', a.ok === false && /could not be uploaded/.test(a.error) && (await q(`SELECT 1 FROM exemption_request WHERE strike_id = '${strikeId}'`)).length === 0, a);
  a = await sa.submitStrikeAppealWithPhotos(pax, strikeId, 'VEHICLE_BREAKDOWN', 'This is not even my strike to appeal', [jpeg()]);
  check('somebody else\'s strike: the database\'s sentence is shown', a.ok === false && /your own strike/.test(a.error), a);
  a = await sa.submitStrikeAppealWithPhotos(drv, strikeId, 'VEHICLE_BREAKDOWN', 'No photos at all is fine too', []);
  check('and an appeal without photos still works', a.ok === true && (await one(`SELECT evidence_urls FROM exemption_request WHERE strike_id = '${strikeId}'`)).evidence_urls.length === 0, a);

  console.log('\nThe builders send exactly the database\'s parameter names');
  const names = (fn) => db.query(`SELECT unnest(proargnames) AS n FROM pg_proc WHERE proname = $1 AND pronamespace = 'public'::regnamespace`, [fn]).then((x) => x.rows.map((y) => y.n));
  const have = await names('submit_fare_dispute_statement');
  check('submit_fare_dispute_statement: the arguments sent are exactly the function\'s', JSON.stringify(Object.keys(ce.fareStatementArgs('d', 't', [])).sort()) === JSON.stringify([...have].sort()), { have });
  check('the appeal call still sends p_evidence', (await names('submit_exemption_request')).includes('p_evidence'));

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
