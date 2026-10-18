// D-SEC-13 (closed by decision G-4): nothing travels on a public realtime BROADCAST channel any more. A broadcast channel is open to anyone who knows
// its name; the driver's live position used to go out on `passenger_trip_<booking id>`, so anyone who learned a booking id could watch the driver or
// send a false position. The position now reaches the passenger only through get_driver_live_status(), which the database limits to the people on the
// booking. This suite reads the source of the apps and the shared package and fails if a broadcast comes back. (No database is needed.)
const fs = require('fs');
const path = require('path');
const { check, summary } = require('../tlib');

const ROOT = path.join(__dirname, '..', '..', '..');
const SKIP = new Set(['node_modules', 'dist', '.git']);
const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
};
for (const base of ['apps', 'packages', 'server/src']) walk(path.join(ROOT, base));
const offenders = (re) => files.filter((f) => re.test(fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))).map((f) => path.relative(ROOT, f));

console.log(`Scanned ${files.length} source files`);
check('no code sends on a realtime broadcast channel (type: "broadcast")', offenders(/type:\s*['"]broadcast['"]/).length === 0, offenders(/type:\s*['"]broadcast['"]/));
check('no code listens on a realtime broadcast channel (.on("broadcast", ...))', offenders(/\.on\(\s*['"]broadcast['"]/).length === 0, offenders(/\.on\(\s*['"]broadcast['"]/));
check('the old driver-position topic passenger_trip_<id> is not used anywhere', offenders(/[`'"]passenger_trip_\$\{/).length === 0, offenders(/[`'"]passenger_trip_\$\{/));
check('the passenger still reads the driver position from the database (get_driver_live_status)', files.some((f) => /useDriverLiveStatus\.ts$/.test(f) && /get_driver_live_status/.test(fs.readFileSync(f, 'utf8'))));
process.exit(summary() ? 0 : 1);
