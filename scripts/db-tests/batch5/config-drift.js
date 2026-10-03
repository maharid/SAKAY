// Batch 5: the fare constants mirrored in packages/shared/src/config/policyConfig.ts (section 8) must equal what the
// database enforces (fare_policy_constant), and the seeded ordinance row must equal DEFAULT_TARIFF.
// Fails if either side changes alone, or if a constant exists on one side only.
const fs = require('fs');
const path = require('path');
const { freshDb, check, summary } = require('../tlib');

const PAIRS = {
  seat_capacity: 'FARE_SEAT_CAPACITY',
  partner_assumption_pax: 'FARE_PARTNER_ASSUMPTION_PASSENGERS',
  deviation_tolerance_m: 'FARE_DEVIATION_TOLERANCE_METERS',
  deviation_tolerance_pct: 'FARE_DEVIATION_TOLERANCE_PERCENT',
  gps_max_accuracy_m: 'FARE_GPS_MAX_ACCURACY_METERS',
  gps_max_speed_kmh: 'FARE_GPS_MAX_SPEED_KMH',
  gps_deadband_m: 'FARE_GPS_DEADBAND_METERS',
  gps_gap_flag_seconds: 'FARE_GPS_GAP_FLAG_SECONDS',
  gps_reanchor_after_rejects: 'FARE_GPS_REANCHOR_AFTER_REJECTS',
  gps_arrival_radius_m: 'FARE_GPS_ARRIVAL_RADIUS_METERS',
  distance_min_pct_of_straight: 'FARE_DISTANCE_MIN_PERCENT_OF_STRAIGHT',
  distance_min_slack_m: 'FARE_DISTANCE_MIN_SLACK_METERS',
  distance_max_factor: 'FARE_DISTANCE_MAX_FACTOR',
  distance_max_slack_m: 'FARE_DISTANCE_MAX_SLACK_METERS',
  future_request_slack_seconds: 'FUTURE_REQUEST_SLACK_SECONDS',
  rate_backdate_slack_seconds: 'RATE_BACKDATE_SLACK_SECONDS',
};

(async () => {
  const db = await freshDb();
  const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'src', 'config', 'policyConfig.ts'), 'utf8');
  const ts = (name) => {
    const m = src.match(new RegExp(`export const ${name} = (\\d+);`));
    return m ? Number(m[1]) : undefined;
  };

  for (const [key, tsName] of Object.entries(PAIRS)) {
    const dbVal = (await db.query(`SELECT public.fare_policy_constant('${key}') v`)).rows[0].v;
    check(`${tsName} (${ts(tsName)}) equals fare_policy_constant('${key}') (${dbVal})`, ts(tsName) === dbVal, { ts: ts(tsName), db: dbVal });
  }

  const fn = (await db.query(`SELECT prosrc FROM pg_proc WHERE proname = 'fare_policy_constant'`)).rows[0].prosrc;
  const dbKeys = [...fn.matchAll(/WHEN '(\w+)'/g)].map((m) => m[1]).sort();
  check('every constant in the database has a mirror in policyConfig.ts, and the reverse (no constant on one side only)',
    JSON.stringify(dbKeys) === JSON.stringify(Object.keys(PAIRS).sort()), { dbKeys, mirrored: Object.keys(PAIRS).sort() });
  check('an unknown constant name is NULL (typos cannot silently become 0)', (await db.query(`SELECT public.fare_policy_constant('nope') v`)).rows[0].v === null);

  // DEFAULT_TARIFF is the mirror of the seeded ordinance row.
  const block = src.match(/export const DEFAULT_TARIFF: TariffConfig = \{([\s\S]*?)\};/)[1];
  const field = (name) => Number(block.match(new RegExp(`${name}:\\s*([\\d.]+)`))[1]);
  const seed = (await db.query(`SELECT base_fare, base_distance_km, succeeding_rate FROM public.fare_matrix ORDER BY effective_timestamp LIMIT 1`)).rows[0];
  check('DEFAULT_TARIFF equals the seeded fare_matrix row (15 / 2 km / 1 per km)',
    field('baseFare') === Number(seed.base_fare) && field('baseDistanceKm') === Number(seed.base_distance_km) && field('succeedingRate') === Number(seed.succeeding_rate), { block, seed });
  check('DEFAULT_TARIFF.capacity equals the seat-capacity constant', field('capacity') === ts('FARE_SEAT_CAPACITY'));
  check('the ride-sharing cutoff shown to passengers is 50 % (PI-10; display only, Batch 10 enforces it)', ts('RIDE_SHARING_CUTOFF_PERCENT') === 50);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
