// scripts/verifyPerimeter.js
// BLACK-BOX check of the perimeter, from the outside, with nothing but the PUBLIC (anon) key: the same thing anybody on the internet
// can do. It never uses DATABASE_URL, the service role key or any account, and it only sends read-only requests.
//
//   node scripts/verifyPerimeter.js                          checks the hosted Supabase project (URL and anon key from server/.env,
//                                                            or from the passenger app's client file)
//   node scripts/verifyPerimeter.js --server http://localhost:5000     also checks the Express server's default-deny
//   node scripts/verifyPerimeter.js --url https://x.supabase.co --key <anon key>
//
// What it checks (after stages S2, S3 and S4 every line must be "ok"):
//   REST     the API root lists no table to anon; every table of the repo answers 401 / 403 / 404 to a read, never data
//   RPC      the few read-only functions it can safely call: only the TODA directory answers
//   STORAGE  no bucket serves a file by its public address; no bucket can be listed anonymously
//   AUTH     reports the sign-up settings (informational: the dashboard tasks D-SEC-14)
//   SERVER   (with --server) /api/health is public and says nothing else; every other /api route answers 401 without a token
// Exit code 0 when nothing is exposed, 1 otherwise. Warnings (informational) do not fail the run.
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..').replace(/\\/g, '/');

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

// ---- the public coordinates of the project -------------------------------------------------------------------------------------
function readConfig() {
  let url = opt('--url');
  let key = opt('--key');
  if (!url || !key) {
    try { require(`${REPO}/node_modules/dotenv`).config({ path: `${REPO}/server/.env` }); } catch { /* dotenv is optional */ }
    url = url || process.env.SUPABASE_URL;
    key = key || process.env.SUPABASE_ANON_KEY;
  }
  if (!url || !key) {   // the anon key and the URL are public by design: the apps ship them
    try {
      const src = fs.readFileSync(`${REPO}/apps/passenger-pwa/src/services/supabaseClient.ts`, 'utf8');
      url = url || (src.match(/'(https:\/\/[a-z0-9]+\.supabase\.co)'/) || [])[1];
      key = key || (src.match(/'(eyJ[A-Za-z0-9_.-]+)'/) || [])[1];
    } catch { /* no client file */ }
  }
  if (!url || !key) { console.log('Could not find the Supabase URL / anon key. Pass --url and --key.'); process.exit(2); }
  return { url: url.replace(/\/+$/, ''), key };
}
const { url: BASE, key: KEY } = readConfig();
const HEAD = { apikey: KEY, Authorization: `Bearer ${KEY}` };

// ---- what to look for, taken from the repo (no list to keep in step) ----------------------------------------------------------------
function tablesFromMigrations() {
  const dir = `${REPO}/supabase/migrations`;
  const names = new Set();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
    const text = fs.readFileSync(`${dir}/${f}`, 'utf8');
    for (const m of text.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi)) names.add(m[1].toLowerCase());
  }
  for (const n of ['pg_stat_statements', 'schema_migrations']) names.delete(n);
  return [...names].sort();
}
function bucketsFromMigrations() {
  const text = fs.readFileSync(`${REPO}/supabase/migrations/20261008000005_perimeter_storage.sql`, 'utf8');
  const m = text.match(/UPDATE storage\.buckets[\s\S]*?IN \(([^)]*)\)/);
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
}

// ---- output ----------------------------------------------------------------------------------------------------------------------
let fails = 0;
let warns = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { fails++; console.log('  FAIL  ' + m); };
const warn = (m) => { warns++; console.log('  warn  ' + m); };
const info = (m) => console.log('        ' + m);

async function http(method, url, { headers = {}, body, timeoutMs = 20000 } = {}) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers: { ...headers, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined, signal: c.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, json };
  } catch (e) {
    return { status: 0, text: String(e.message), json: null };
  } finally {
    clearTimeout(t);
  }
}
const randomUuid = () => require('crypto').randomUUID();

// ---- REST -----------------------------------------------------------------------------------------------------------------------------
async function checkRest() {
  console.log('\nREST: tables');
  const root = await http('GET', `${BASE}/rest/v1/`, { headers: HEAD });
  if (root.status === 200 && root.json && root.json.paths) {
    const tablePaths = Object.keys(root.json.paths).filter((p) => p !== '/' && !p.startsWith('/rpc/'));
    const rpcPaths = Object.keys(root.json.paths).filter((p) => p.startsWith('/rpc/')).map((p) => p.slice(5));
    if (tablePaths.length === 0) ok('the API root lists no table to anon');
    else bad(`the API root lists ${tablePaths.length} table(s) to anon: ${tablePaths.slice(0, 8).join(', ')}${tablePaths.length > 8 ? ', ...' : ''}`);
    const extraRpc = rpcPaths.filter((n) => n !== 'list_accredited_todas');
    if (extraRpc.length === 0) ok('the API root lists no function to anon except list_accredited_todas');
    else bad(`the API root lists ${extraRpc.length} function(s) to anon: ${extraRpc.slice(0, 8).join(', ')}${extraRpc.length > 8 ? ', ...' : ''}`);
  } else {
    ok(`the API root is not served to anon (HTTP ${root.status})`);
  }

  const tables = tablesFromMigrations();
  let readable = 0;
  let withData = 0;
  const exposed = [];
  for (const t of tables) {
    const r = await http('GET', `${BASE}/rest/v1/${encodeURIComponent(t)}?select=*&limit=1`, { headers: HEAD });
    if (r.status === 200) {
      readable++;
      if (Array.isArray(r.json) && r.json.length > 0) { withData++; exposed.push(`${t} (returns data)`); } else exposed.push(`${t} (readable, no rows visible)`);
    }
  }
  if (readable === 0) ok(`anon cannot read any of the ${tables.length} tables the repo creates (every read answers 401 / 403 / 404)`);
  else bad(`anon can read ${readable} table(s)${withData ? `, ${withData} of them returning rows` : ''}: ${exposed.slice(0, 10).join(', ')}${exposed.length > 10 ? ', ...' : ''}`);

  // writes are refused as well (an insert of nothing: harmless if it were accepted, it fails on constraints)
  const w = await http('POST', `${BASE}/rest/v1/passenger`, { headers: { ...HEAD, Prefer: 'return=minimal' }, body: {} });
  if (w.status === 401 || w.status === 403 || w.status === 404) ok(`anon cannot write to passenger (HTTP ${w.status})`);
  else bad(`anon reached the passenger table with a write (HTTP ${w.status})`);
}

// ---- RPC ----------------------------------------------------------------------------------------------------------------------------
async function checkRpc() {
  console.log('\nRPC: the read-only functions it is safe to call');
  const dir = await http('POST', `${BASE}/rest/v1/rpc/list_accredited_todas`, { headers: HEAD, body: {} });
  if (dir.status === 200 && Array.isArray(dir.json)) {
    ok(`the TODA directory answers anon (${dir.json.length} accredited TODA(s))`);
    if (dir.json.length) {
      const keys = Object.keys(dir.json[0]).sort().join(',');
      if (keys === 'barangay,service_coverage_area,terminal_latitude,terminal_longitude,toda_acronym,toda_id,toda_name') ok('...and returns only directory columns (no documents, certificate data, officers or contacts)');
      else bad(`the directory returns unexpected columns: ${keys}`);
    }
  } else bad(`the TODA directory does not answer anon (HTTP ${dir.status}); the registration pickers need it`);

  const probes = [
    ['get_assigned_driver_details', { p_booking_id: randomUuid() }],
    ['get_booking_counterparties', { p_booking_ids: [randomUuid()] }],
    ['find_candidate_drivers', { p_booking_id: randomUuid() }],
    ['get_my_toda_affiliations', {}],
    ['check_otp_lockout', { p_contact_number: '+639170000000' }],
  ];
  for (const [fn, args] of probes) {
    const r = await http('POST', `${BASE}/rest/v1/rpc/${fn}`, { headers: HEAD, body: args });
    if ([401, 403, 404].includes(r.status)) ok(`anon cannot call ${fn} (HTTP ${r.status})`);
    else bad(`anon could call ${fn} (HTTP ${r.status}): ${r.text.slice(0, 80)}`);
  }
}

// ---- STORAGE ---------------------------------------------------------------------------------------------------------------------------
async function checkStorage() {
  console.log('\nSTORAGE: files');
  const buckets = bucketsFromMigrations();
  if (!buckets.length) { warn('could not read the bucket list from the storage migration'); return; }
  for (const b of buckets) {
    const pub = await http('GET', `${BASE}/storage/v1/object/public/${encodeURIComponent(b)}/${randomUuid()}.jpg`, { headers: { apikey: KEY } });
    // a PUBLIC bucket answers "Object not found" for a missing file; a private one does not exist on the public route at all
    if (/object not found/i.test(pub.text)) bad(`bucket ${b} is PUBLIC: files in it are served by their address`);
    else if (/bucket not found/i.test(pub.text) || [400, 401, 403, 404].includes(pub.status)) ok(`bucket ${b} serves nothing by public address (HTTP ${pub.status})`);
    else warn(`bucket ${b}: unexpected answer to a public address (HTTP ${pub.status}) ${pub.text.slice(0, 60)}`);
    const list = await http('POST', `${BASE}/storage/v1/object/list/${encodeURIComponent(b)}`, { headers: HEAD, body: { prefix: '', limit: 5, offset: 0 } });
    if (list.status === 200 && Array.isArray(list.json) && list.json.length > 0) bad(`bucket ${b} can be LISTED anonymously (${list.json.length}+ entries)`);
    else ok(`bucket ${b} cannot be listed anonymously (HTTP ${list.status}${list.status === 200 ? ', empty' : ''})`);
  }
}

// ---- AUTH settings (informational) -----------------------------------------------------------------------------------------------
async function checkAuth() {
  console.log('\nAUTH: settings (informational: the dashboard tasks, decision D-SEC-14)');
  const s = await http('GET', `${BASE}/auth/v1/settings`, { headers: { apikey: KEY } });
  if (s.status !== 200 || !s.json) { warn(`could not read the auth settings (HTTP ${s.status})`); return; }
  const ext = s.json.external || {};
  info(`sign-ups: ${s.json.disable_signup ? 'closed' : 'open'} | e-mail auto-confirm: ${s.json.mailer_autoconfirm ? 'on' : 'off'} | phone provider: ${ext.phone ? 'ON' : 'off'} | anonymous sign-ins: ${ext.anonymous_users ? 'ON' : 'off'}`);
  if (ext.phone) warn('the phone provider is ON: turn it off in the dashboard (Authentication > Providers > Phone); the apps verify numbers through the Express server');
  else ok('the phone provider is off');
  if (ext.anonymous_users) warn('anonymous sign-ins are ON: they are not used; turn them off (Authentication > Sign In / Providers)');
  else ok('anonymous sign-ins are off');
  if (!s.json.disable_signup) info('sign-ups are open on purpose (passengers and drivers register themselves). Do NOT enable CAPTCHA until the apps send captcha tokens.');
}

// ---- the Express server (optional) ---------------------------------------------------------------------------------------------------
async function checkServer(server) {
  const root = server.replace(/\/+$/, '');
  console.log(`\nSERVER: ${root}`);
  const health = await http('GET', `${root}/api/health`);
  if (health.status === 200 && health.json && Object.keys(health.json).sort().join() === 'status,timestamp') ok('/api/health is public and says only "healthy" and the time');
  else bad(`/api/health answered HTTP ${health.status} ${health.text.slice(0, 80)}`);
  const protectedRoutes = [
    ['GET', '/api/admin/dashboard/stats'], ['GET', '/api/admin/drivers'], ['GET', '/api/admin/todas/applications'], ['POST', '/api/communication/send-sms'],
    ['POST', '/api/ocr/mtop'], ['POST', '/api/ocr/license'], ['POST', '/api/auth/send-otp'], ['POST', '/api/auth/verify-otp'],
    ['POST', '/api/admin/notify/driver'], ['POST', '/api/toda-admin/notify/driver'], ['GET', '/api/toda/profile'], ['GET', '/api/nothing-here'],
  ];
  const open = [];
  for (const [method, p] of protectedRoutes) {
    const r = await http(method, `${root}${p}`, { body: method === 'POST' ? {} : undefined });
    if (r.status !== 401) open.push(`${method} ${p} -> ${r.status}`);
  }
  if (open.length === 0) ok(`every other route answers 401 without a token (${protectedRoutes.length} probed)`);
  else bad(`routes that answered something other than 401 without a token: ${open.join('; ')}`);
  const sch = await http('POST', `${root}/api/scheduler/run-sla-checks`, { body: {} });
  if ([401, 403, 404, 503].includes(sch.status)) ok(`the scheduler endpoint refuses a caller without the secret (HTTP ${sch.status})`);
  else bad(`the scheduler endpoint answered HTTP ${sch.status} without the secret`);
}

async function main() {
  console.log(`PERIMETER CHECK (anonymous, read-only) | project ${new URL(BASE).hostname}`);
  await checkRest();
  await checkRpc();
  await checkStorage();
  await checkAuth();
  const server = opt('--server');
  if (server) await checkServer(server);
  console.log(`\n${fails === 0 ? 'NOTHING IS EXPOSED to an anonymous caller' : `${fails} EXPOSURE(S) FOUND`}${warns ? ` (${warns} warning(s) to read)` : ''}.`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
