// Batch 4: the [DB] constants mirrored in packages/shared/src/config/policyConfig.ts must equal
// the values the database actually enforces (driver_presence_constant). Fails if either side changes alone.
const fs = require('fs');
const path = require('path');
const { setup, check, summary } = require('../b4fixtures');

(async () => {
  // Whole chain: the pause constants (Day 1) are added after Batch 4's own last migration.
  const t = await setup(null);
  const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'src', 'config', 'policyConfig.ts'), 'utf8');
  const ts = (name) => {
    const m = src.match(new RegExp(`export const ${name} = (\\d+);`));
    return m ? Number(m[1]) : undefined;
  };
  const pairs = {
    reminder_after_unanswered: 'DRIVER_INACTIVITY_REMINDER_AFTER_UNANSWERED',
    auto_offline_after_unanswered: 'DRIVER_AUTO_OFFLINE_AFTER_UNANSWERED',
    review_window_days: 'DRIVER_AUTO_OFFLINE_REVIEW_WINDOW_DAYS',
    review_auto_offline_count: 'DRIVER_AUTO_OFFLINE_REVIEW_COUNT',
    offline_after_decline_seconds: 'DRIVER_OFFLINE_AFTER_DECLINE_SECONDS',
    offline_after_decline_count: 'DRIVER_OFFLINE_AFTER_DECLINE_COUNT',
    heartbeat_stale_seconds: 'DRIVER_HEARTBEAT_STALE_SECONDS',
    location_max_accuracy_m: 'LOCATION_MAX_ACCURACY_METERS',
    location_max_age_seconds: 'LOCATION_MAX_AGE_SECONDS',
    // Day 1 (migration 20261012000002): pause bookings
    pause_min_minutes: 'DRIVER_PAUSE_MIN_MINUTES',
    pause_default_minutes: 'DRIVER_PAUSE_DEFAULT_MINUTES',
    pause_max_minutes: 'DRIVER_PAUSE_MAX_MINUTES',
  };
  for (const [key, tsName] of Object.entries(pairs)) {
    const db = (await t.one(`SELECT public.driver_presence_constant('${key}') v`)).v;
    check(`${tsName} (${ts(tsName)}) equals driver_presence_constant('${key}') (${db})`, ts(tsName) === db, { ts: ts(tsName), db });
  }
  check('an unknown constant name is NULL (typos cannot silently become 0)', (await t.one(`SELECT public.driver_presence_constant('nope') v`)).v === null);
  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
