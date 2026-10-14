// Batch 10: the TypeScript the apps use for ride-sharing (packages/shared/src/utils/sharedMatch.ts) against the REAL database functions.
// Proves that every call name and every parameter name the apps send exists in the database (the calls are made by NAME, as the apps make them), that the answers are read into
// the shapes the screens use, that the database's own sentences reach the screen, and that no screen reads the pairing table or keeps a consent on the phone.
// Whole migration chain on the local emulator (never Supabase).
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { setup, ID, check, summary } = require('../b10fixtures');

const ROOT = path.join(__dirname, '..', '..', '..');
const SHARED = path.join(ROOT, 'packages', 'shared', 'src');

function loadTs(file) {
  const code = esbuild.buildSync({ entryPoints: [file], bundle: true, write: false, format: 'cjs', platform: 'node', target: 'es2022', logLevel: 'silent' }).outputFiles[0].text;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
  return mod.exports;
}
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
};

(async () => {
  const tsPath = path.join(SHARED, 'utils', 'sharedMatch.ts');
  const tsSource = fs.readFileSync(tsPath, 'utf8');
  const api = loadTs(tsPath);
  const s = await setup();
  const { as, q, internal, at } = s;

  // a Supabase-shaped client whose rpc() calls the real function by NAME as the signed-in user (named notation: a wrong parameter name fails)
  const rpcAs = (uid) => ({
    rpc: async (fn, args) => {
      try {
        const names = Object.keys(args ?? {});
        const r = await as(uid, (tx) => tx.query(`SELECT public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) AS r`, names.map((n) => args[n])));
        return { data: r.rows[0].r, error: null };
      } catch (e) {
        return { data: null, error: { message: e.message } };
      }
    },
  });
  const PAX = (k) => rpcAs(s.ALL_PAX[k].uid);
  const DRV = (k) => rpcAs(s.DRIVERS[k].uid);

  console.log('S1 every call the TypeScript makes exists in the database, with exactly the parameters it sends');
  const calls = [...tsSource.matchAll(/(?:callRpc\(client,|client\.rpc\()\s*'([a-z_]+)',\s*\{([^}]*)\}/g)].map((m) => ({ fn: m[1], params: [...m[2].matchAll(/(p_[a-z_]+)\s*:/g)].map((x) => x[1]).sort() }));
  check('the five calls of the two apps are found in the source (state, request, two answers, the count report)', calls.map((c) => c.fn).sort().join() === 'driver_report_passenger_count,driver_respond_shared_request,get_my_shared_request,get_shared_match_state,passenger_respond_shared_match', calls.map((c) => c.fn));
  for (const c of calls) {
    const sig = await q(`SELECT pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = '${c.fn}'`);
    const dbParams = sig.length ? sig[0].args.split(',').map((x) => x.trim().split(' ')[0]).filter(Boolean).sort() : null;
    const onlyKnown = dbParams && c.params.every((p) => dbParams.includes(p));
    check(`${c.fn}(${c.params.join(', ')}) exists, and every parameter the app sends is one the function has`, !!dbParams && onlyKnown, { c, dbParams });
    check(`   ...it is callable by a signed-in user and by nobody anonymous`, (await q(`SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE') AS a, has_function_privilege('anon', p.oid, 'EXECUTE') AS n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = '${c.fn}'`))
      .every((r) => r.a === true && r.n === false));
  }

  console.log('\nS2 a whole pairing through the TypeScript the apps run');
  const A = await s.host();
  await s.online('D2', 400);
  const { b: B, m } = await s.propose();
  let req = await api.fetchMySharedRequest(DRV('D1'));
  check('the driver\'s request is read into the shape the modal uses', !!req && req.matchId === m.match_id && req.bookingId === B.booking_id && req.passengerFirstName === 'Pax' && req.passengerCount === 1
    && req.currentPartySize === 1 && req.windowSeconds === 15 && req.secondsRemaining > 0 && req.pickupGapM === 150, req);
  check('the other driver and the passengers read none', (await api.fetchMySharedRequest(DRV('D2'))) === null && (await api.fetchMySharedRequest(PAX('P2'))) === null);
  let v2 = await api.fetchSharedMatchState(PAX('P2'), B.booking_id);
  check('the second passenger reads "proposed" and nothing about anybody', v2 && v2.state === 'proposed' && v2.role === 'second' && v2.other === null && v2.driver === null, v2);
  let r = await api.respondSharedRequest(DRV('D1'), m.match_id, true);
  check('Accept (the driver): ok', r.ok === true && r.data.state === 'awaiting_passenger', r);
  const v1 = await api.fetchSharedMatchState(PAX('P1'), A.booking_id);
  check('the first passenger now reads the consent question with the permitted facts', v1 && v1.state === 'awaiting_my_consent' && v1.matchId === m.match_id && v1.secondsRemaining > 0
    && v1.other.partySize === 1 && v1.other.mobileVerified === true && v1.other.direction === 'N' && v1.driver.plateNumber === 'ABC-1234', v1);
  v2 = await api.fetchSharedMatchState(PAX('P2'), B.booking_id);
  check('the second passenger reads that the passenger on board has to agree, with the same permitted facts and the driver block', v2.state === 'awaiting_first_passenger' && v2.other.partySize === 1 && v2.driver.name === 'Driver One', v2);
  r = await api.respondSharedMatch(PAX('P2'), m.match_id, true);
  check('the wrong passenger\'s Accept is refused with the database\'s code and sentence', r.ok === false && r.code === 'ERR_MATCH_NOT_FOUND' && /does not exist/.test(r.error), r);
  r = await api.respondSharedMatch(PAX('P1'), m.match_id, true);
  check('Accept Shared Match: ok, matched', r.ok === true && r.data.state === 'matched', r);
  check('...and the screens read "matched" after it', (await api.fetchSharedMatchState(PAX('P1'), A.booking_id)).state === 'matched' && (await api.fetchSharedMatchState(PAX('P2'), B.booking_id)).state === 'matched');
  r = await api.respondSharedMatch(PAX('P1'), m.match_id, true);
  check('a second tap is ok and says it was already answered', r.ok === true && r.data.already_answered === true, r);

  console.log('\nS3 the refusals reach the screen in the database\'s own words');
  await s.reset();
  const A2 = await s.host();
  await s.online('D2', 400);
  const p2 = await s.propose();
  await s.matchAgo(p2.m.match_id, 25);
  r = await api.respondSharedRequest(DRV('D1'), p2.m.match_id, true);
  check('an answer after the window: ERR_REQUEST_EXPIRED with the sentence', r.ok === false && r.code === 'ERR_REQUEST_EXPIRED' && /time to answer/.test(r.error), r);
  r = await api.respondSharedMatch(PAX('P1'), p2.m.match_id, true);
  check('an answer to a pairing that has ended: ERR_MATCH_CLOSED', r.ok === false && r.code === 'ERR_MATCH_CLOSED', r);

  console.log('\nS4 the count report through the TypeScript');
  await s.reset();
  const solo = await s.startTrip('D1', 'P1');
  r = await api.reportPassengerCount(DRV('D1'), solo.booking_id, 3, 'two more got on');
  check('reportPassengerCount: ok, with the figures', r.ok === true && r.data.declared_count === 1 && r.data.actual_count === 3 && r.data.over_capacity === false, r);
  r = await api.reportPassengerCount(DRV('D1'), solo.booking_id, 3);
  check('the same count again: ERR_NO_MISMATCH', r.ok === false && r.code === 'ERR_NO_MISMATCH', r);
  r = await api.reportPassengerCount(PAX('P1'), solo.booking_id, 2);
  check('a passenger\'s call: ERR_NOT_A_DRIVER', r.ok === false && r.code === 'ERR_NOT_A_DRIVER', r);

  console.log('\nS5 what the screens may not do');
  const files = [...walk(path.join(ROOT, 'apps')), ...walk(SHARED)].filter((f) => !/node_modules/.test(f));
  const text = (f) => fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const readsTable = files.filter((f) => /from\(\s*['"`]shared_trip_match['"`]\s*\)/.test(text(f)));
  check('no screen reads or writes the pairing table directly (the disclosure function is the only door)', readsTable.length === 0, readsTable);
  const keepsConsent = files.filter((f) => /(localStorage|sessionStorage)[^\n]*(shared_?match|sharedMatch|shared_consent)/i.test(text(f)));
  check('no consent or match is kept on the phone (localStorage / sessionStorage)', keepsConsent.length === 0, keepsConsent);
  const panel = fs.readFileSync(path.join(SHARED, 'components', 'SharedMatchPanel.tsx'), 'utf8');
  check('the buttons are named exactly as the policy names them (Rule 14.5), in English and in Filipino', /accept: 'Accept Shared Match'/.test(panel) && /decline: 'Decline Shared Match'/.test(panel) && /accept: 'Tanggapin ang Shared Match'/.test(panel) && /decline: 'Tanggihan ang Shared Match'/.test(panel));
  check('Report Concern is not a consent: the consent panel never calls the incident pipeline', !/(submitIncident|createIncident|incident_report|incidentReports|fileIncident|report_concern|reportConcern\()/.test(text(path.join(SHARED, 'components', 'SharedMatchPanel.tsx'))));
  const dr = text(path.join(ROOT, 'apps', 'driver-pwa', 'src', 'common', 'components', 'DriverSharedRequestModal.tsx'));
  check('the driver\'s modal answers only through the database function (no direct table write)', /respondSharedRequest\(supabase/.test(dr) && !/\.from\(/.test(dr));
  const tm = text(path.join(ROOT, 'apps', 'passenger-pwa', 'src', 'features', 'trip-monitoring', 'components', 'TripMonitoring.tsx'));
  check('the trip screen asks about ride-sharing only for a Shared booking', /useSharedMatch\(supabase, activeBookingId,[^;]*is_shared_trip/.test(tm.replace(/\n\s*/g, ' ')), 'useSharedMatch(...)');

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
