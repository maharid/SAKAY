// Batch 12: what the screens and the shared package say must be what the database enforces. integrity_constant() and retention_constant() against policyConfig.ts (a constant on one
// side only fails the test), the incident category list against INCIDENT_CATEGORIES (the new "Unregistered Person Driving"), and the figures the privacy notice prints against the
// retention schedule. Fails if either side changes alone. Whole migration chain on the local emulator.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { setup, check, summary } = require('../b12fixtures');

const ROOT = path.join(__dirname, '..', '..', '..');
const SHARED = path.join(ROOT, 'packages', 'shared', 'src');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
function loadTs(file) {
  const code = esbuild.buildSync({ entryPoints: [file], bundle: true, write: false, format: 'cjs', platform: 'node', target: 'es2022', logLevel: 'silent' }).outputFiles[0].text;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
  return mod.exports;
}

// DB key -> TypeScript name
const INTEGRITY = {
  rating_review_min_trips: 'INTEGRITY_RATING_REVIEW_MIN_TRIPS', rating_review_floor_x100: 'INTEGRITY_RATING_REVIEW_FLOOR_X100', rating_reflag_trips: 'INTEGRITY_RATING_REFLAG_TRIPS',
  gps_spoof_teleport_fixes: 'INTEGRITY_GPS_SPOOF_TELEPORT_FIXES', gps_spoof_heavy_fixes: 'INTEGRITY_GPS_SPOOF_HEAVY_FIXES', gps_spoof_repeat_trips: 'INTEGRITY_GPS_SPOOF_REPEAT_TRIPS',
  gps_spoof_repeat_window_trips: 'INTEGRITY_GPS_SPOOF_REPEAT_WINDOW_TRIPS', gps_distance_mismatch_pct: 'INTEGRITY_GPS_DISTANCE_MISMATCH_PCT', gps_distance_mismatch_m: 'INTEGRITY_GPS_DISTANCE_MISMATCH_M',
  rm_pair_trips: 'INTEGRITY_RM_PAIR_TRIPS', rm_pair_window_days: 'INTEGRITY_RM_PAIR_WINDOW_DAYS', rm_conc_min_ratings: 'INTEGRITY_RM_CONC_MIN_RATINGS', rm_conc_share_pct: 'INTEGRITY_RM_CONC_SHARE_PCT',
  rm_conc_max_raters: 'INTEGRITY_RM_CONC_MAX_RATERS', rm_conc_mean_x10: 'INTEGRITY_RM_CONC_MEAN_X10', rm_conc_window_days: 'INTEGRITY_RM_CONC_WINDOW_DAYS', rm_burst_count: 'INTEGRITY_RM_BURST_COUNT',
  rm_burst_minutes: 'INTEGRITY_RM_BURST_MINUTES', coll_matches: 'INTEGRITY_COLL_MATCHES', coll_window_days: 'INTEGRITY_COLL_WINDOW_DAYS', rereg_lookback_days: 'INTEGRITY_REREG_LOOKBACK_DAYS',
};
const RETENTION = {
  gps_log_days: 'RETENTION_GPS_LOG_DAYS', session_days: 'RETENTION_SESSION_DAYS', closed_records_years: 'RETENTION_CLOSED_RECORDS_YEARS', doc_superseded_days: 'RETENTION_DOC_SUPERSEDED_DAYS',
  doc_rejected_days: 'RETENTION_DOC_REJECTED_DAYS', doc_closed_months: 'RETENTION_DOC_CLOSED_MONTHS', purge_batch_rows: 'RETENTION_PURGE_BATCH_ROWS',
};
// constants the screens use that have no database twin (display and export only)
const TS_ONLY = ['RATING_MIN_COUNT_TO_DISPLAY', 'PRIVACY_NOTICE_VERSION', 'AUDIT_LOG_PAGE_SIZE', 'AUDIT_EXPORT_MAX_ROWS'];

(async () => {
  const s = await setup();
  const { one, q } = s;
  const cfg = loadTs(path.join(SHARED, 'config', 'policyConfig.ts'));
  const migration = read('supabase', 'migrations', '20261027000001_batch12_ratings_integrity_privacy_audit.sql');

  console.log('S1 integrity_constant() and retention_constant() equal policyConfig.ts');
  const dbVal = async (fn, key) => (await one(`SELECT public.${fn}('${key}') AS v`)).v;
  const mismatches = [];
  for (const [key, name] of Object.entries(INTEGRITY)) { const v = await dbVal('integrity_constant', key); if (Number(v) !== cfg[name]) mismatches.push([key, v, name, cfg[name]]); }
  check(`all ${Object.keys(INTEGRITY).length} integrity constants have the same value in the database and in policyConfig.ts`, mismatches.length === 0, mismatches);
  const m2 = [];
  for (const [key, name] of Object.entries(RETENTION)) { const v = await dbVal('retention_constant', key); if (Number(v) !== cfg[name]) m2.push([key, v, name, cfg[name]]); }
  check(`all ${Object.keys(RETENTION).length} retention constants have the same value in the database and in policyConfig.ts`, m2.length === 0, m2);
  const dbKeys = (fn) => [...migration.matchAll(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(p_key TEXT\\)[\\s\\S]*?\\$\\$;`, 'g'))][0][0].match(/WHEN '([a-z0-9_]+)'/g).map((x) => x.slice(6, -1));
  const iKeys = dbKeys('integrity_constant'), rKeys = dbKeys('retention_constant');
  check('no constant exists on one side only: every database key is mapped here and every mapped key exists', JSON.stringify([...iKeys].sort()) === JSON.stringify(Object.keys(INTEGRITY).sort()) && JSON.stringify([...rKeys].sort()) === JSON.stringify(Object.keys(RETENTION).sort()), { iKeys, rKeys });
  const batch12Names = Object.keys(cfg).filter((n) => /^(INTEGRITY_|RETENTION_)/.test(n));
  check('...and every INTEGRITY_ / RETENTION_ constant of policyConfig.ts has a database twin', batch12Names.every((n) => [...Object.values(INTEGRITY), ...Object.values(RETENTION)].includes(n)), batch12Names.filter((n) => ![...Object.values(INTEGRITY), ...Object.values(RETENTION)].includes(n)));
  check('the TypeScript-only constants (display, export, notice version) are present and sensible', TS_ONLY.every((n) => cfg[n] !== undefined) && cfg.RATING_MIN_COUNT_TO_DISPLAY === 1 && /^\d{4}-\d{2}-\d{2}$/.test(cfg.PRIVACY_NOTICE_VERSION) && cfg.AUDIT_LOG_PAGE_SIZE <= 1000 && cfg.AUDIT_EXPORT_MAX_ROWS >= 1000);
  const unified = cfg.POLICY_CONSTANTS.RATINGS_INTEGRITY_PRIVACY;
  check('POLICY_CONSTANTS carries the whole group', [...Object.values(INTEGRITY), ...Object.values(RETENTION), ...TS_ONLY].every((n) => unified[n] === cfg[n]));
  check('the GPS accuracy and speed limits of the detectors are the FARE\'s, not a second copy (the migration reads fare_policy_constant)', /fare_policy_constant\('gps_max_accuracy_m'\)|_trip_track_summary/.test(migration) && !/'gps_max_speed_kmh'\s+THEN/.test(migration) && !/'gps_max_accuracy_m'\s+THEN/.test(migration));

  console.log('\nS2 the approved decisions are the defaults of the code');
  check('F12.1: under 3.00 (300 / 100) after 20 completed trips', cfg.INTEGRITY_RATING_REVIEW_MIN_TRIPS === 20 && cfg.INTEGRITY_RATING_REVIEW_FLOOR_X100 === 300);
  check('F12.2 / F12.5: 90 days for routine GPS and for sessions; F12.3: 5 years; F12.4: 30 days superseded, 30 days rejected, 12 months closed', cfg.RETENTION_GPS_LOG_DAYS === 90 && cfg.RETENTION_SESSION_DAYS === 90 && cfg.RETENTION_CLOSED_RECORDS_YEARS === 5
    && cfg.RETENTION_DOC_SUPERSEDED_DAYS === 30 && cfg.RETENTION_DOC_REJECTED_DAYS === 30 && cfg.RETENTION_DOC_CLOSED_MONTHS === 12);
  check('F12.6: 3 teleports in a trip, 2 of the last 10 trips, 40 percent and 1 km; F12.7: 5 mutual 5-star trips in 30 days, 60 percent of 10 ratings from 2 passengers with a mean of 4.8, 5 ratings in 10 minutes',
    cfg.INTEGRITY_GPS_SPOOF_TELEPORT_FIXES === 3 && cfg.INTEGRITY_GPS_SPOOF_REPEAT_TRIPS === 2 && cfg.INTEGRITY_GPS_SPOOF_REPEAT_WINDOW_TRIPS === 10 && cfg.INTEGRITY_GPS_DISTANCE_MISMATCH_PCT === 40 && cfg.INTEGRITY_GPS_DISTANCE_MISMATCH_M === 1000
    && cfg.INTEGRITY_RM_PAIR_TRIPS === 5 && cfg.INTEGRITY_RM_PAIR_WINDOW_DAYS === 30 && cfg.INTEGRITY_RM_CONC_MIN_RATINGS === 10 && cfg.INTEGRITY_RM_CONC_SHARE_PCT === 60 && cfg.INTEGRITY_RM_CONC_MAX_RATERS === 2 && cfg.INTEGRITY_RM_CONC_MEAN_X10 === 48
    && cfg.INTEGRITY_RM_BURST_COUNT === 5 && cfg.INTEGRITY_RM_BURST_MINUTES === 10);

  console.log('\nS3 the incident category list: the database and INCIDENT_CATEGORIES agree');
  const incidents = loadTs(path.join(SHARED, 'utils', 'incidentReports.ts'));
  const tsCats = incidents.INCIDENT_CATEGORIES;
  const dbCats = await q(`SELECT c, public._incident_category_class(c) AS k FROM unnest(ARRAY[${tsCats.map((c) => `'${c.value}'`).join(',')}, 'Not A Category']) c`);
  check('every category of the screens has the same class in the database, and an invented one has none', tsCats.every((c) => dbCats.find((x) => x.c === c.value)?.k === c.class) && dbCats.find((x) => x.c === 'Not A Category').k === null, dbCats);
  const unreg = tsCats.find((c) => c.value === 'Unregistered Person Driving');
  check('"Unregistered Person Driving" is offered to passengers only and is SERIOUS (routed to the LGU) on the screens too', unreg && unreg.class === 'SERIOUS' && JSON.stringify(unreg.by) === '["Passenger"]' && incidents.incidentRoutingOf('Unregistered Person Driving') === 'LGU' && incidents.isEmergencyIncident('Unregistered Person Driving'));
  const review = loadTs(path.join(SHARED, 'utils', 'incidentReview.ts'));
  const tsOptions = review.incidentStrikeOptions ? review.incidentStrikeOptions('Unregistered Person Driving', 'Passenger') : null;
  const dbOptions = (await one(`SELECT public._incident_strike_options('Unregistered Person Driving', 'Passenger') AS o`)).o;
  check('the strike an upheld report may carry is the same in the screens and in the database (DRV_SUBSTITUTE_DRIVER)', tsOptions === null || JSON.stringify(tsOptions.map((x) => x.code ?? x)) === JSON.stringify(dbOptions), { tsOptions, dbOptions });

  console.log('\nS4 the privacy notice prints the retention schedule that the database enforces');
  const notice = loadTs(path.join(SHARED, 'config', 'privacyNotice.ts'));
  for (const role of ['driver', 'passenger']) {
    for (const lang of ['en', 'tl']) {
      const items = notice.privacyNoticeExtraItems(role, lang);
      const ret = items.find((i) => i.id === 'G');
      check(`${role}/${lang}: items F, G, H, I exist (purposes, retention, recipients, rights)`, items.map((i) => i.id).join('') === 'FGHI' && items.every((i) => i.title && i.desc.length > 60), items.map((i) => i.id));
      check(`${role}/${lang}: the retention item prints ${cfg.RETENTION_GPS_LOG_DAYS} days of GPS, ${cfg.RETENTION_SESSION_DAYS} days of sessions, ${cfg.RETENTION_CLOSED_RECORDS_YEARS} years after closure`,
        ret.desc.includes(String(cfg.RETENTION_GPS_LOG_DAYS)) && ret.desc.includes(String(cfg.RETENTION_SESSION_DAYS)) && ret.desc.includes(String(cfg.RETENTION_CLOSED_RECORDS_YEARS)) && /OTP/.test(ret.desc), ret.desc.slice(0, 120));
      if (role === 'driver') check('driver: the notice names the OCR provider and the retention of the document photos (30 days, 30 days, 12 months)', items.find((i) => i.id === 'H').desc.includes('Google') && ret.desc.includes(String(cfg.RETENTION_DOC_SUPERSEDED_DAYS)) && ret.desc.includes(String(cfg.RETENTION_DOC_CLOSED_MONTHS)));
      else check('passenger: no mention of a provider or document photos that the passenger never meets', !items.find((i) => i.id === 'H').desc.includes('Google') && !/larawan ng dokumento|Document photos/.test(ret.desc));
    }
  }
  check('the notice version the apps record is a date that the database accepts', await one(`SELECT '${cfg.PRIVACY_NOTICE_VERSION}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AS ok`).then((x) => x.ok));

  const ok = summary();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
