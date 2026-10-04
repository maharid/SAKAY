// scripts/verifyPerimeter.js (the anonymous, black-box perimeter check) run against a LOCAL stand-in server that answers like the
// Supabase REST / Storage / Auth APIs and the Express server do: once as the LOCKED-DOWN project (must report nothing exposed) and once
// as the OPEN project of before the lockdown (must report the exposures). Proves the script classifies answers correctly.
// Nothing here connects to Supabase.
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { check, summary } = require('../tlib');

const script = path.join(__dirname, '..', '..', 'verifyPerimeter.js');
const BUCKETS = ['barangay-clearances', 'driver-licenses', 'incident-evidence', 'mtop-permits', 'profile-photos', 'profiles', 'reports', 'toda-accredited-driver-lists', 'toda-bylaws', 'tricycle-photos'];
const DIRECTORY_ROW = { toda_id: 'x', toda_name: 'T', toda_acronym: 'T', barangay: 'B', service_coverage_area: 'C', terminal_latitude: 1, terminal_longitude: 2 };

function standIn(mode) {
  const locked = mode === 'locked';
  return http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      // ---- Supabase REST
      if (req.method === 'GET' && url === '/rest/v1/') {
        return send(200, { paths: locked ? { '/': {}, '/rpc/list_accredited_todas': {} } : { '/': {}, '/passenger': {}, '/driver': {}, '/rpc/get_assigned_driver_details': {}, '/rpc/list_accredited_todas': {} } });
      }
      if (url === '/rest/v1/rpc/list_accredited_todas') return send(200, [DIRECTORY_ROW]);
      if (url.startsWith('/rest/v1/rpc/')) return locked ? send(404, { code: 'PGRST202' }) : send(200, []);
      if (url.startsWith('/rest/v1/')) {
        if (locked) return send(401, { code: '42501', message: 'permission denied' });
        return req.method === 'GET' ? send(200, [{ any: 'row' }]) : send(201, []);
      }
      // ---- Supabase Storage
      if (url.startsWith('/storage/v1/object/public/')) return locked ? send(400, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' }) : send(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
      if (url.startsWith('/storage/v1/object/list/')) return send(200, locked ? [] : [{ name: 'a.jpg' }]);
      // ---- Supabase Auth
      if (url === '/auth/v1/settings') return send(200, { disable_signup: false, mailer_autoconfirm: true, external: { phone: !locked, anonymous_users: false } });
      // ---- Express server
      if (url === '/api/health') return send(200, { status: 'healthy', timestamp: new Date().toISOString() });
      if (url === '/api/scheduler/run-sla-checks') return send(locked ? 503 : 200, {});
      if (url.startsWith('/api/')) return send(locked ? 401 : 200, {});
      return send(404, {});
    });
  });
}

const listen = (srv) => new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)));
const runScript = (port) => new Promise((resolve) => {
  const child = spawn(process.execPath, [script, '--url', `http://127.0.0.1:${port}`, '--key', 'eyJtest.test.test', '--server', `http://127.0.0.1:${port}`], { env: { ...process.env, DATABASE_URL: '' } });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('close', (status) => resolve({ status, out }));
});

(async () => {
  console.log('\nthe locked-down project');
  const lockedSrv = standIn('locked');
  const lockedPort = await listen(lockedSrv);
  const l = await runScript(lockedPort);
  lockedSrv.close();
  check('reports nothing exposed and exits 0', l.status === 0 && /NOTHING IS EXPOSED/.test(l.out), l.out.slice(-500));
  check('...the API root lists no table and only the directory function', /the API root lists no table to anon/.test(l.out) && /no function to anon except list_accredited_todas/.test(l.out));
  check('...every table of the repo is refused', /anon cannot read any of the \d+ tables/.test(l.out));
  check('...every bucket is private and cannot be listed', BUCKETS.every((b) => new RegExp(`bucket ${b} serves nothing by public address`).test(l.out)) && BUCKETS.every((b) => new RegExp(`bucket ${b} cannot be listed anonymously`).test(l.out)));
  check('...the directory still answers and returns only directory columns', /the TODA directory answers anon/.test(l.out) && /only directory columns/.test(l.out));
  check('...the server answers 401 to every other route', /every other route answers 401 without a token/.test(l.out) && /scheduler endpoint refuses/.test(l.out));
  check('...the settings report is informational (phone provider off)', /the phone provider is off/.test(l.out));
  check('...no key or token is echoed', !/eyJtest/.test(l.out));

  console.log('\nthe open project of before the lockdown');
  const openSrv = standIn('open');
  const openPort = await listen(openSrv);
  const o = await runScript(openPort);
  openSrv.close();
  check('reports the exposures and exits 1', o.status === 1 && /EXPOSURE\(S\) FOUND/.test(o.out), o.out.slice(-500));
  check('...tables listed to anon, readable tables, and the write to passenger', /FAIL  the API root lists \d+ table\(s\) to anon/.test(o.out) && /FAIL  anon can read \d+ table\(s\)/.test(o.out) && /FAIL  anon reached the passenger table with a write/.test(o.out));
  check('...functions callable by anon', /FAIL  anon could call get_assigned_driver_details/.test(o.out) && /FAIL  the API root lists \d+ function\(s\) to anon/.test(o.out));
  check('...public and listable buckets', /FAIL  bucket driver-licenses is PUBLIC/.test(o.out) && /FAIL  bucket driver-licenses can be LISTED anonymously/.test(o.out));
  check('...server routes open without a token', /FAIL  routes that answered something other than 401/.test(o.out));
  check('...and warns that the phone provider is on', /warn  the phone provider is ON/.test(o.out));

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
