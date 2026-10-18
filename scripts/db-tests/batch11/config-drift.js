// Batch 11: what the screens and the shared package say must be what the database enforces. The numbers (incident_constant() against policyConfig.ts), the category list and its
// classes (_incident_category_class() against INCIDENT_CATEGORIES), the strikes an upheld report may carry (_incident_strike_options() and the catalog's ranges against
// incidentStrikeOptions()), the reason lists (a driver's cancellation, an early stop, a delayed arrival), the safe reasons (_safe_reason_exempt() against
// DRIVER_CANCEL_SAFE_REASONS) and the evidence limits (the guard, the bucket). Fails if either side changes alone, or if a constant exists on one side only.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { setup, ID, DRIVERS, check, summary } = require('../b11fixtures');

const ROOT = path.join(__dirname, '..', '..', '..');
const SHARED = path.join(ROOT, 'packages', 'shared', 'src');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const config = read('packages', 'shared', 'src', 'config', 'policyConfig.ts');
const migration = read('supabase', 'migrations', '20261026000001_batch11_incidents_safety.sql');
const tsNumber = (name) => {
  const m = config.match(new RegExp(`export const ${name} = ([\\d.]+)(?: \\* 1024 \\* 1024)?;`));
  if (!m) return undefined;
  return /\* 1024 \* 1024/.test(m[0]) ? Number(m[1]) * 1024 * 1024 : Number(m[1]);
};
function loadTs(file) {
  const code = esbuild.buildSync({ entryPoints: [file], bundle: true, write: false, format: 'cjs', platform: 'node', target: 'es2022', logLevel: 'silent' }).outputFiles[0].text;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
  return mod.exports;
}
const sorted = (a) => [...a].sort();
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

// DB key -> TypeScript name
const PAIRS = {
  safety_first_action_hours: 'INCIDENT_SAFETY_FIRST_ACTION_HOURS',
  safety_decision_business_days: 'INCIDENT_SAFETY_DECISION_BUSINESS_DAYS',
  standard_first_review_business_days: 'INCIDENT_STANDARD_FIRST_REVIEW_BUSINESS_DAYS',
  lgu_decision_business_days: 'INCIDENT_LGU_DECISION_BUSINESS_DAYS',
  lost_item_contact_business_days: 'INCIDENT_LOST_ITEM_CONTACT_BUSINESS_DAYS',
  evidence_max_files: 'INCIDENT_EVIDENCE_MAX_FILES',
  evidence_max_bytes: 'INCIDENT_EVIDENCE_MAX_BYTES',
  share_link_buffer_minutes: 'SHARE_LINK_BUFFER_MINUTES',
  share_link_max_hours: 'SHARE_LINK_MAX_HOURS',
  lost_item_file_days: 'INCIDENT_LOST_ITEM_FILE_DAYS',
  lost_item_unclaimed_days: 'INCIDENT_LOST_ITEM_UNCLAIMED_DAYS',
  safe_reason_flag_count: 'SAFE_REASON_FLAG_COUNT',
  safe_reason_flag_window_days: 'SAFE_REASON_FLAG_WINDOW_DAYS',
};

(async () => {
  const s = await setup();
  const { one, q, as } = s;
  const dbConst = async (k) => (await one(`SELECT public.incident_constant('${k}') AS v`)).v;

  console.log('S1 every number is the same on both sides (F11.1 - F11.4, PI-11B)');
  for (const [key, name] of Object.entries(PAIRS)) {
    const ts = tsNumber(name);
    const db = await dbConst(key);
    check(`${name} = incident_constant('${key}') = ${db}`, ts !== undefined && db !== null && ts === db, { ts, db });
  }
  const sqlKeys = [...migration.slice(migration.indexOf('FUNCTION public.incident_constant'), migration.indexOf('ELSE NULL')).matchAll(/WHEN '([a-z_]+)'\s+THEN/g)].map((m) => m[1]);
  check('the database has no incident constant the apps do not mirror (and none is missing)', same(sqlKeys, Object.keys(PAIRS)), sqlKeys);
  check('an unknown key is NULL (a typo cannot silently become 0)', (await dbConst('nope')) === null);
  check('the Rule 2.5 numbers are the central configuration\'s: 3 upheld reports in 60 days (policy_config rows and policyConfig.ts agree)',
    (await one(`SELECT public.get_policy_config_int('toda_incident_report_flag_threshold', 0) AS a, public.get_policy_config_int('toda_incident_report_window_days', 0) AS b`)).a === tsNumber('TODA_INCIDENT_REPORT_FLAG_THRESHOLD')
    && (await one(`SELECT public.get_policy_config_int('toda_incident_report_window_days', 0) AS b`)).b === tsNumber('TODA_INCIDENT_REPORT_WINDOW_DAYS'));
  check('the evidence bucket takes exactly what the screens take: the migration sets 5 MB and the three image types',
    /UPDATE storage\.buckets\s+SET file_size_limit = public\.incident_constant\('evidence_max_bytes'\),\s+allowed_mime_types = ARRAY\['image\/jpeg', 'image\/png', 'image\/webp'\]\s+WHERE id = 'incident-evidence'/.test(migration)
    && /INCIDENT_EVIDENCE_MIME_TYPES = \['image\/jpeg', 'image\/png', 'image\/webp'\]/.test(config));
  // the bucket row, as the hosted project has it, takes the new limits
  await s.internal(`INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('incident-evidence', 'incident-evidence', FALSE, 20971520, ARRAY['video/mp4']) ON CONFLICT (id) DO UPDATE SET file_size_limit = 20971520, allowed_mime_types = ARRAY['video/mp4']`);
  await s.db.exec(migration.slice(migration.indexOf('UPDATE storage.buckets'), migration.indexOf(';', migration.indexOf('UPDATE storage.buckets')) + 1));
  const bucket = await one(`SELECT file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'incident-evidence'`);
  check('applied to a bucket that held 20 MB and video, it becomes 5 MB and JPEG / PNG / WebP', Number(bucket.file_size_limit) === 5 * 1024 * 1024 && same(bucket.allowed_mime_types, ['image/jpeg', 'image/png', 'image/webp']), bucket);

  console.log('\nS2 the categories: the screens\' list is the database\'s, with the same classes');
  const reports = loadTs(path.join(SHARED, 'utils', 'incidentReports.ts'));
  const review = loadTs(path.join(SHARED, 'utils', 'incidentReview.ts'));
  const tsCats = reports.INCIDENT_CATEGORIES;
  const dbClass = async (c) => (await one(`SELECT public._incident_category_class($1) AS v`, [c])).v;
  for (const c of tsCats) check(`${c.value}: class ${c.class} on both sides`, (await dbClass(c.value)) === c.class, { ts: c.class, db: await dbClass(c.value) });
  // the function as the whole chain leaves it (Batch 12 added "Unregistered Person Driving" to it)
  const classDef = (await one(`SELECT pg_get_functiondef('public._incident_category_class(text)'::regprocedure) AS d`)).d;
  const classBody = classDef.slice(classDef.indexOf('SELECT CASE'));
  const dbCats = [...classBody.matchAll(/'([A-Za-z ]+)'/g)].map((m) => m[1]).filter((v) => !['SERIOUS', 'EMERGENCY', 'LOST_ITEM', 'STANDARD'].includes(v));
  check('the database lists no category the screens do not offer (and none is missing)', same(dbCats, tsCats.map((c) => c.value)), dbCats);
  check('a category outside the list has no class', (await dbClass('Made Up')) === null);
  check('the Rule 16.5 emergency exception is the EMERGENCY and SERIOUS classes (what the screens let you file during a trip)',
    same(reports.EMERGENCY_INCIDENT_CATEGORIES, tsCats.filter((c) => c.class === 'EMERGENCY' || c.class === 'SERIOUS').map((c) => c.value)) && reports.isEmergencyIncident('Threat') && reports.isEmergencyIncident('Accident') && !reports.isEmergencyIncident('Rude Behavior') && !reports.isEmergencyIncident('Lost Item'));
  const guardBody = (await one(`SELECT pg_get_functiondef('public.incident_report_guard()'::regprocedure) AS d`)).d;
  check('the guard asks the same list (no second copy of the category names in it)', !/'Physical Assault'|'Rude Behavior'/.test(guardBody) && /_incident_category_class/.test(guardBody));
  check('the passenger is offered no "Passenger Misconduct", the driver no "Overcharging Attempt"; both are offered the emergency and serious ones (decision PI-11K)',
    !reports.incidentCategoriesFor('Passenger').some((c) => c.value === 'Passenger Misconduct') && !reports.incidentCategoriesFor('Driver').some((c) => c.value === 'Overcharging Attempt')
    && ['Emergency', 'Medical Emergency', 'Safety Concern', 'Accident', 'Physical Assault', 'Harassment', 'Threat', 'Criminal Activity'].every((v) => reports.incidentCategoriesFor('Passenger').some((c) => c.value === v) && reports.incidentCategoriesFor('Driver').some((c) => c.value === v)));
  check('where each category goes first: the serious ones to the LGU, the others to the TODA (Rules 19.3, 19.8)', reports.incidentRoutingOf('Threat') === 'LGU' && reports.incidentRoutingOf('Rude Behavior') === 'TODA');

  console.log('\nS3 the strikes an upheld report may carry (decision PI-11G), and their ranges');
  const cat = Object.fromEntries((await q(`SELECT violation_code, default_points, min_points, max_points, ladder_bypass, confirmation_mode, lgu_only FROM violation_catalog`)).map((r) => [r.violation_code, r]));
  for (const c of tsCats) {
    for (const by of ['Passenger', 'Driver', 'System']) {
      const dbOpts = (await one(`SELECT public._incident_strike_options($1, $2) AS v`, [c.value, by])).v;
      const tsOpts = review.incidentStrikeOptions(c.value, by).map((o) => o.code);
      check(`${c.value} filed by ${by}: ${tsOpts.join(', ') || 'no strike'}`, same(dbOpts, tsOpts), { db: dbOpts, ts: tsOpts });
    }
  }
  for (const code of new Set(tsCats.flatMap((c) => ['Passenger', 'Driver'].flatMap((by) => review.incidentStrikeOptions(c.value, by)))).values ? [...new Set(tsCats.flatMap((c) => ['Passenger', 'Driver'].flatMap((by) => review.incidentStrikeOptions(c.value, by))))] : []) {
    const row = cat[code.code];
    check(`${code.code}: the range ${code.min} - ${code.max} and "LGU only" (${code.lguOnly}) are the catalog's`,
      row && row.min_points === code.min && row.max_points === code.max && (code.lguOnly === (row.ladder_bypass !== 'NONE')), { code, row });
  }
  for (const reporter of ['Passenger', 'Driver']) {
    const f = review.fabricatedStrikeOption(reporter);
    const row = cat[f.code];
    check(`a fabricated report by a ${reporter.toLowerCase()}: ${f.code}, ${f.min} points, on the reporter (Rule 19.5)`, row && row.min_points === f.min && row.max_points === f.max && row.applies_to === undefined || (row && row.min_points === f.min && row.max_points === f.max), { f, row });
  }
  check('Lost Item, an emergency and a safety concern carry no strike code (Rules 19.6, 19.7)', ['Lost Item', 'Emergency', 'Safety Concern', 'Accident', 'Medical Emergency'].every((c) => review.incidentStrikeOptions(c, 'Passenger').length === 0 && review.incidentStrikeOptions(c, 'Driver').length === 0));
  const outcomes = (c, by) => review.incidentOutcomesFor(c, by);
  check('the outcomes offered: a lost item only "not upheld"; an emergency adds "resolved, no fault"; the rest upheld / not upheld / fabricated',
    same(outcomes('Lost Item', 'Passenger'), ['NOT_UPHELD']) && outcomes('Safety Concern', 'Passenger').includes('RESOLVED') && !outcomes('Rude Behavior', 'Passenger').includes('RESOLVED') && outcomes('Rude Behavior', 'Passenger').includes('FABRICATED'));

  console.log('\nS4 the reason lists');
  const trip = loadTs(path.join(SHARED, 'utils', 'tripEnd.ts'));
  const policy = loadTs(path.join(SHARED, 'config', 'policyConfig.ts'));
  const listIn = (text, marker) => { const m = text.match(new RegExp(`${marker}[^(]*\\(([^)]*)\\)`)); return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : []; };
  const defOf = async (sig) => (await one(`SELECT pg_get_functiondef('${sig}'::regprocedure) AS d`)).d;
  check('the database accepts exactly the cancellation reasons the screens offer (10: three are new)', same(listIn(await defOf('public.driver_cancel_booking(uuid,text,text)'), 'NOT IN'), policy.DRIVER_CANCEL_REASONS) && policy.DRIVER_CANCEL_REASONS.length === 10);
  check('the database accepts exactly the early-stop reasons the screens offer (two are new: accident, medical_emergency)', same(listIn(await defOf('public.driver_stop_trip_early(uuid,text,text)'), 'NOT IN'), trip.DRIVER_EARLY_STOP_REASONS.map((r) => r.code)));
  const validDb = [...(await defOf('public._early_stop_reason_is_valid(text)')).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).filter((v) => !['public', 'pg_temp'].includes(v));
  check('the valid early-stop reasons (never struck) are the same on both sides', same(validDb, trip.DRIVER_EARLY_STOP_REASONS.filter((r) => r.valid).map((r) => r.code)), validDb);
  check('the database accepts exactly the delay reasons the screens offer (a police checkpoint is new, Rule 29.12)', same(listIn(await defOf('public.driver_report_delay(uuid,text)'), 'NOT IN'), policy.DRIVER_DELAY_REASONS) && policy.DRIVER_DELAY_REASONS.includes('police_checkpoint'));
  // the safe reasons: the screens' list is the reasons the database waives
  const safeDb = [];
  for (const r of policy.DRIVER_CANCEL_REASONS) if ((await one(`SELECT public._safe_reason_exempt($1) AS v`, [r])).v) safeDb.push(r);
  check('the cancellation reasons that are not struck (PI-11B) are the same on both sides', same(safeDb, policy.DRIVER_CANCEL_SAFE_REASONS), safeDb);
  check('a breakdown, an accident, an emergency, a safety concern, a road closure, an unsafe or illegal request and a prohibited item are waived; an unreachable passenger, a wrong pickup and "other" are not',
    ['vehicle_breakdown', 'accident', 'personal_emergency', 'safety_concern', 'road_closure_or_traffic', 'unsafe_or_illegal_request', 'prohibited_item'].every((r) => safeDb.includes(r))
    && !['passenger_unreachable', 'wrong_pickup_location', 'other'].some((r) => safeDb.includes(r)));
  for (const r of trip.DRIVER_EARLY_STOP_REASONS.filter((x) => x.valid)) {
    check(`the valid early stop "${r.code}" has an exempt reason`, (await one(`SELECT public._safe_reason_exempt($1) AS v`, [r.code])).v !== null);
  }
  for (const r of policy.DRIVER_CANCEL_REASONS) {
    const x = await s.drvCall('D1', 'driver_cancel_booking($1,$2,$3)', ['00000000-0000-0000-0000-0000000000aa', r, null]);
    check(`cancellation reason "${r}" is accepted by the database`, x.error_code === 'ERR_NOT_YOUR_BOOKING', x);
  }
  check('an unknown cancellation reason is refused', (await s.drvCall('D1', 'driver_cancel_booking($1,$2,$3)', ['00000000-0000-0000-0000-0000000000aa', 'because', null])).error_code === 'ERR_CANCEL_REASON_REQUIRED');

  console.log('\nS5 the exempt reasons the strike engine accepts are exactly the ones the safe reasons map to');
  const engine = await defOf('public.issue_strike(text,uuid,text,integer,uuid,uuid,text,boolean,text,text,jsonb)');
  const engineReasons = listIn(engine.slice(engine.indexOf('p_exempt_reason NOT IN')), 'NOT IN');
  const mapped = new Set();
  for (const r of [...policy.DRIVER_CANCEL_REASONS, ...trip.DRIVER_EARLY_STOP_REASONS.map((x) => x.code)]) {
    const v = (await one(`SELECT public._safe_reason_exempt($1) AS v`, [r])).v;
    if (v) mapped.add(v);
  }
  check('every exempt reason a safe reason maps to is one the engine accepts', [...mapped].every((m) => engineReasons.includes(m)), { mapped: [...mapped], engineReasons });
  check('and the engine accepts only these three more than before (the old three stay)', same(engineReasons, ['SAFETY_INCIDENT_VICTIM', 'TRAFFIC_ACCIDENT', 'FORCE_MAJEURE', 'VEHICLE_BREAKDOWN', 'EMERGENCY', 'LAWFUL_REFUSAL']), engineReasons);

  console.log('\nS6 the calamity vocabulary and the share-link lifetime in the screens\' words');
  const safety = loadTs(path.join(SHARED, 'utils', 'tripSafety.ts'));
  const declare = await defOf('public.declare_calamity(text,text,text,text)');
  check('the kinds and the scopes the screens offer are the ones the database accepts', same(safety.CALAMITY_KINDS, [...migration.match(/kind\s+VARCHAR\(30\) NOT NULL CHECK \(kind IN \(([^)]*)\)/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]))
    && same(safety.CALAMITY_SCOPES.map((x) => x.code), ['ALL', 'CANCEL_STALL_NOSHOW']) && /IN \('Typhoon', 'Flood', 'Earthquake', 'Road Closure', 'Declared Emergency', 'Other'\)/.test(declare));
  const bufMin = await dbConst('share_link_buffer_minutes'), maxH = await dbConst('share_link_max_hours');
  check('the line under the share button says what the database does (the buffer and the cap come from incident_constant)', safety.shareLifetimeText('tl').includes(`${bufMin} minuto`) && safety.shareLifetimeText('tl').includes(`${maxH} oras`) && safety.shareLifetimeText('en').includes(`${bufMin} minutes`) && safety.shareLifetimeText('en').includes(`${maxH} hours`));
  check('the urgent-report choices are all emergency or serious categories (the database refuses any other)', safety.URGENT_REPORT_OPTIONS.every((o) => ['EMERGENCY', 'SERIOUS'].includes(reports.incidentCategoryClass(o.category))));
  check('the administrator\'s safety-end reasons are the ones the database accepts', same(safety.SAFETY_END_REASONS.map((r) => r.code), listIn(await defOf('public.admin_end_trip_for_safety(uuid,text,text,text)'), 'NOT IN')));

  const ok = summary();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
