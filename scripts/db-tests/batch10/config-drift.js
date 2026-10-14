// Batch 10: the ride-sharing numbers mirrored in packages/shared/src/config/policyConfig.ts must equal what the database enforces (shared_trip_constant), the numbers that
// have ONE source elsewhere (the 4 seats, the driver's response window) must not be repeated, the barangay list and the compass of the disclosure must be the apps', and the
// words must not drift from the comparator of PI-10 ("less than 50%"). Fails if either side changes alone, or if a constant exists on one side only.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { setup, ID, check, summary } = require('../b10fixtures');

const ROOT = path.join(__dirname, '..', '..', '..');
const SHARED = path.join(ROOT, 'packages', 'shared', 'src');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const config = read('packages', 'shared', 'src', 'config', 'policyConfig.ts');
const migration = read('supabase', 'migrations', '20261025000001_batch10_ride_sharing.sql');
const tsNumber = (name) => {
  const m = config.match(new RegExp(`export const ${name} = ([\\d.]+);`));
  return m ? Number(m[1]) : undefined;
};
function loadTs(file) {
  const code = esbuild.buildSync({ entryPoints: [file], bundle: true, write: false, format: 'cjs', platform: 'node', target: 'es2022', logLevel: 'silent' }).outputFiles[0].text;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
  return mod.exports;
}

// DB key -> TypeScript name
const PAIRS = {
  max_bookings: 'SHARED_TRIP_MAX_BOOKINGS',
  cutoff_progress_pct: 'RIDE_SHARING_CUTOFF_PERCENT',
  pickup_separation_m: 'SHARED_TRIP_PICKUP_SEPARATION_METERS',
  detour_max_pct: 'SHARED_TRIP_DETOUR_MAX_PERCENT',
  detour_max_m: 'SHARED_TRIP_DETOUR_MAX_METERS',
  bearing_max_deg: 'SHARED_TRIP_BEARING_MAX_DEGREES',
  bearing_min_trip_m: 'SHARED_TRIP_BEARING_MIN_TRIP_METERS',
  passenger_response_seconds: 'SHARED_TRIP_PASSENGER_RESPONSE_SECONDS',
  decline_flag_count: 'SHARED_TRIP_DECLINE_FLAG_COUNT',
  decline_flag_window_hours: 'SHARED_TRIP_DECLINE_FLAG_WINDOW_HOURS',
};

(async () => {
  const s = await setup();
  const { one, q } = s;
  const dbConst = async (k) => (await one(`SELECT public.shared_trip_constant('${k}') AS v`)).v;

  console.log('S1 every number is the same on both sides');
  for (const [key, name] of Object.entries(PAIRS)) {
    const ts = tsNumber(name);
    const db = await dbConst(key);
    check(`${name} = shared_trip_constant('${key}') = ${db}`, ts !== undefined && db !== null && ts === db, { ts, db });
  }
  const sqlKeys = [...migration.slice(migration.indexOf('FUNCTION public.shared_trip_constant'), migration.indexOf('ELSE NULL')).matchAll(/WHEN '([a-z_]+)'\s+THEN/g)].map((m) => m[1]).sort();
  check('the database has no shared-trip constant the apps do not mirror (and none is missing)', JSON.stringify(sqlKeys) === JSON.stringify(Object.keys(PAIRS).sort()), sqlKeys);
  const tsShared = [...config.matchAll(/export const (SHARED_TRIP_[A-Z_]+) = /g)].map((m) => m[1]).sort();
  check('...and the apps have no SHARED_TRIP_ constant the database does not enforce', JSON.stringify(tsShared) === JSON.stringify(Object.values(PAIRS).filter((n) => n.startsWith('SHARED_TRIP_')).sort()), tsShared);
  check('an unknown key is NULL (a typo cannot silently become 0)', (await dbConst('nope')) === null);

  console.log('\nS2 one source for the numbers that already have one');
  check('the tricycle\'s 4 seats: fare_policy_constant(\'seat_capacity\') = FARE_SEAT_CAPACITY = 4; the Shared booking size is one less (decision N4)',
    (await one(`SELECT public.fare_policy_constant('seat_capacity') AS v`)).v === 4 && tsNumber('FARE_SEAT_CAPACITY') === 4 && /export const SHARED_BOOKING_MAX_PASSENGERS = FARE_SEAT_CAPACITY - 1;/.test(config));
  check('the driver\'s response window is the dispatch offer window: dispatch_constant(\'offer_window_seconds\') = DRIVER_OFFER_TIMEOUT_SECONDS',
    (await one(`SELECT public.dispatch_constant('offer_window_seconds') AS v`)).v === tsNumber('DRIVER_OFFER_TIMEOUT_SECONDS'));
  check('...neither number is repeated inside shared_trip_constant()', !/WHEN 'seat_capacity'|WHEN 'max_passengers'|WHEN 'offer_window|WHEN 'driver_response/.test(migration));
  const fn = migration.slice(migration.indexOf('FUNCTION public.shared_trip_constant'), migration.indexOf('ELSE NULL'));
  check('no other file of the migration hard-codes the cutoff, the separation or the detour (they are read from shared_trip_constant)', !/>=\s*50\b|<\s*50\b/.test(migration.replace(fn, '')));

  console.log('\nS3 the disclosure: the barangays and the compass are the apps\'');
  const { CALAPAN_BARANGAYS } = loadTs(path.join(SHARED, 'config', 'calapanBarangays.ts'));
  const dbList = (await one(`SELECT public.calapan_barangays() AS v`)).v;
  check('the barangay list of the database is the list of the apps, name for name', JSON.stringify([...dbList].sort()) === JSON.stringify([...CALAPAN_BARANGAYS].sort()), { db: dbList.length, ts: CALAPAN_BARANGAYS.length });
  const { barangayOfAddress } = loadTs(path.join(SHARED, 'utils', 'transportAnalytics.ts'));
  const addresses = [
    'Blk 7 Lot 3 Rizal Street, Brgy. Ilaya, Calapan City', 'Purok 5, 22 Sampaguita Lane, Brgy. San Vicente Central, Calapan', 'San Vicente, Calapan', 'Gate 3 Calapan Central School, Brgy. Guinobatan',
    'Sta. Cruz, Calapan', 'Bayanan II and Bayanan I boundary', 'Somewhere near the old mango tree', '', 'Wawa', 'The Balitebite Street (not Balite)', 'sta. maria village road', 'Ibaba East',
  ];
  let same = 0; const diffs = [];
  for (const a of addresses) {
    const db = (await one(`SELECT public._area_of_address($1) AS v`, [a])).v;
    const ts = barangayOfAddress(a);
    if (db === ts) same++; else diffs.push({ a, db, ts });
  }
  check(`the barangay the database reads in an address is the one the analytics read (${addresses.length} addresses)`, same === addresses.length, diffs);
  const { bearingDegrees } = loadTs(path.join(SHARED, 'utils', 'heading.ts'));
  const pts = [[13.41, 121.18, 13.44, 121.18], [13.41, 121.18, 13.41, 121.2], [13.41, 121.18, 13.38, 121.15], [13.41, 121.18, 13.43, 121.22], [13.5, 121.1, 13.4, 121.2]];
  let maxDiff = 0;
  for (const [a, b, c, d] of pts) {
    const db = (await one(`SELECT public._bearing_deg($1::float8, $2::float8, $3::float8, $4::float8) AS v`, [a, b, c, d])).v;
    const ts = bearingDegrees({ lat: a, lng: b }, { lat: c, lng: d });
    maxDiff = Math.max(maxDiff, Math.abs(db - ts));
  }
  check('the bearing of the database is the apps\' bearingDegrees (to a millionth of a degree)', maxDiff < 1e-6, maxDiff);
  const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  let wrong = [];
  for (let b = 0; b < 360; b += 7.5) {
    const db = (await one(`SELECT public._compass_8($1::float8) AS v`, [b])).v;
    const want = compass[Math.floor((b + 22.5) / 45) % 8];
    if (db !== want) wrong.push({ b, db, want });
  }
  check('the eight compass points: 337.5 to 22.5 is N, then every 45 degrees', wrong.length === 0 && (await one(`SELECT public._compass_8(359.9::float8) AS v`)).v === 'N' && (await one(`SELECT public._compass_8(22.4::float8) AS v`)).v === 'N' && (await one(`SELECT public._compass_8(22.5::float8) AS v`)).v === 'NE', wrong);

  console.log('\nS4 the words keep the comparator of PI-10: "less than 50%", never "until 50%"');
  const words = [
    read('apps', 'passenger-pwa', 'src', 'common', 'components', 'SharedFareNotice.tsx'),
    read('packages', 'shared', 'src', 'components', 'TripDetailsPanel.tsx'),
    read('packages', 'shared', 'src', 'components', 'SharedMatchPanel.tsx'),
  ].join('\n');
  check('no screen says that matching runs "until" / "hanggang" the cutoff percent (it stops AT 50%, so the figure is "less than")', !/(until|hanggang)\s*\$\{RIDE_SHARING_CUTOFF_PERCENT\}%/.test(words));
  check('the screens read the cutoff from the one constant', (words.match(/\$\{RIDE_SHARING_CUTOFF_PERCENT\}/g) || []).length >= 4 && !/(trip|biyahe|match|kapares|kasabay)[^\n]*\b50%/i.test(words.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
  check('the Shared booking size the screens offer is the constant (no literal 2 or 3 left in the booking screens)',
    !/maxPassengers=\{tripType === "Shared" \? [23] :/.test(read('apps', 'passenger-pwa', 'src', 'features', 'ride-booking', 'components', 'NewTrip', 'NewTrip.tsx')) && !/is_shared_trip \? 3 : 4/.test(read('apps', 'passenger-pwa', 'src', 'services', 'bookingService.ts')));

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
