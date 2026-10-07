// Batch 6: the dispatch / booking-lifecycle numbers mirrored in packages/shared/src/config/policyConfig.ts must equal what the database
// enforces (dispatch_constant, dispatch_tier3_radius_m), and the decline / cancellation reason lists the apps offer must be exactly the ones
// the database accepts. Fails if either side changes alone, or if a constant exists on one side only.
const fs = require('fs');
const path = require('path');
const { setup, ID, DRIVERS, attempt, check, summary } = require('../b6fixtures');

const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'src', 'config', 'policyConfig.ts'), 'utf8');
const tsNumber = (name) => {
  const m = src.match(new RegExp(`export const ${name} = ([\\d.]+);`));
  return m ? Number(m[1]) : undefined;
};
const tsList = (name) => {
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*\\[([^\\]]*)\\]`));
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
};
const tsSteps = () => {
  const m = src.match(/export const DISPATCH_TIER3_RADIUS_STEPS = \[([\s\S]*?)\] as const;/);
  return m ? [...m[1].matchAll(/fromSecond:\s*(\d+),\s*radiusKm:\s*([\d.]+)/g)].map((x) => ({ from: Number(x[1]), km: Number(x[2]) })) : [];
};

// DB key -> [TypeScript name, multiplier to the database's unit]
const PAIRS = {
  offer_window_seconds: ['DRIVER_OFFER_TIMEOUT_SECONDS', 1],
  offer_grace_seconds: ['DISPATCH_OFFER_GRACE_SECONDS', 1],
  tier1_radius_m: ['DISPATCH_TIER1_RADIUS_KM', 1000],
  tier2_radius_m: ['DISPATCH_TIER2_RADIUS_KM', 1000],
  tier3_refresh_seconds: ['DISPATCH_TIER3_REFRESH_SECONDS', 1],
  tier3_max_seconds: ['DISPATCH_TIER3_MAX_SECONDS', 1],
  accepted_cancel_limit: ['DISPATCH_ACCEPTED_CANCEL_LIMIT', 1],
  eta_speed_kmh: ['DISPATCH_ETA_SPEED_KMH', 1],
  eta_winding_percent: ['DISPATCH_ETA_WINDING_PERCENT', 1],
  passenger_cancel_grace_seconds: ['PASSENGER_CANCEL_GRACE_SECONDS', 1],
  driver_travel_threshold_m: ['DRIVER_CANCEL_TRAVEL_THRESHOLD_METERS', 1],
  completion_confirm_timeout_seconds: ['COMPLETION_CONFIRM_TIMEOUT_SECONDS', 1],
  repeat_cancel_flag_count: ['REPEAT_CANCEL_FLAG_COUNT', 1],
  repeat_cancel_window_hours: ['REPEAT_CANCEL_WINDOW_HOURS', 1],
  decline_flag_count: ['DISPATCH_DECLINE_FLAG_COUNT', 1],
  decline_flag_window_hours: ['DISPATCH_DECLINE_FLAG_WINDOW_HOURS', 1],
  stall_warn_seconds: ['DRIVER_STALL_WARN_SECONDS', 1],
  stall_cancel_seconds: ['DRIVER_STALL_CANCEL_SECONDS', 1],
  stall_min_movement_m: ['DRIVER_STALL_MIN_MOVEMENT_METERS', 1],
  stall_en_route_seconds: ['DRIVER_STALL_EN_ROUTE_SECONDS', 1],
  unreachable_warn_seconds: ['DRIVER_UNREACHABLE_WARN_SECONDS', 1],
  unreachable_cancel_seconds: ['DRIVER_UNREACHABLE_CANCEL_SECONDS', 1],
  ongoing_reconcile_seconds: ['TRIP_RECONCILE_SECONDS', 1],
  no_show_wait_seconds: ['NO_SHOW_WAIT_SECONDS', 1],
  no_show_extension_seconds: ['NO_SHOW_EXTENSION_SECONDS', 1],
  no_show_radius_m: ['PICKUP_ZONE_RADIUS_METERS', 1],
  zone_max_accuracy_m: ['PICKUP_ZONE_MAX_ACCURACY_METERS', 1],
};
const DB_ONLY = ['sweep_batch_limit'];            // how many searches one sweep advances: an implementation detail, not a policy number

(async () => {
  const s = await setup();
  const { q, one, as } = s;

  for (const [key, [tsName, mult]] of Object.entries(PAIRS)) {
    const db = (await one(`SELECT public.dispatch_constant('${key}') v`)).v;
    const ts = tsNumber(tsName);
    check(`${tsName} (${ts}${mult !== 1 ? ' x ' + mult : ''}) equals dispatch_constant('${key}') (${db})`, ts !== undefined && Math.round(ts * mult) === db, { ts, db });
  }

  const def = (await one(`SELECT pg_get_functiondef('public.dispatch_constant(text)'::regprocedure) AS d`)).d;
  const dbKeys = [...def.matchAll(/WHEN '(\w+)'/g)].map((m) => m[1]).sort();
  const mirrored = [...Object.keys(PAIRS), ...DB_ONLY, 'tier3_max_seconds', 'offer_window_seconds'].filter((k, i, a) => a.indexOf(k) === i).sort();
  check('every constant in the database has a mirror in policyConfig.ts, and the reverse (none on one side only)', JSON.stringify(dbKeys) === JSON.stringify(mirrored), { dbKeys, mirrored });
  check('an unknown constant name is NULL (a typo cannot silently become 0)', (await one(`SELECT public.dispatch_constant('nope') v`)).v === null);

  const steps = tsSteps();
  check('the live-search schedule is the specification\'s four steps in the app config', steps.map((x) => `${x.from}:${x.km}`).join() === '0:2,90:2.5,180:3,270:3.5', steps);
  for (let i = 0; i < steps.length; i++) {
    const at = (await one(`SELECT public.dispatch_tier3_radius_m(${steps[i].from}) v`)).v;
    check(`from ${steps[i].from} s the database radius is ${steps[i].km} km`, at === steps[i].km * 1000, at);
    if (i > 0) {
      const before = (await one(`SELECT public.dispatch_tier3_radius_m(${steps[i].from - 1}) v`)).v;
      check(`one second earlier it is still ${steps[i - 1].km} km`, before === steps[i - 1].km * 1000, before);
    }
  }

  // The reason lists: the screens' choices must be what the database accepts, nothing more and nothing less.
  const declineReasons = tsList('DISPATCH_DECLINE_REASONS');
  const cancelReasons = tsList('DRIVER_CANCEL_REASONS');
  const call = async (sql, args) => (await as(DRIVERS.D1.uid, (tx) => tx.query(`SELECT ${sql} AS r`, args))).rows[0].r;
  const unknownAttempt = '00000000-0000-0000-0000-0000000000aa';
  for (const r of declineReasons) {
    const x = await call('public.decline_booking_offer($1, $2)', [unknownAttempt, r]);
    check(`decline reason "${r}" is accepted by the database`, x.error_code === 'ERR_OFFER_NOT_FOUND', x);
  }
  check('an unknown decline reason is refused', (await call('public.decline_booking_offer($1, $2)', [unknownAttempt, 'because'])).error_code === 'ERR_DECLINE_REASON_REQUIRED');
  for (const r of cancelReasons) {
    const x = await call('public.driver_cancel_booking($1, $2, NULL)', [unknownAttempt, r]);
    check(`cancellation reason "${r}" is accepted by the database`, x.error_code === 'ERR_NOT_YOUR_BOOKING', x);
  }
  check('an unknown cancellation reason is refused', (await call('public.driver_cancel_booking($1, $2, NULL)', [unknownAttempt, 'because'])).error_code === 'ERR_CANCEL_REASON_REQUIRED');
  const delayReasons = tsList('DRIVER_DELAY_REASONS');
  for (const r of delayReasons) {
    const x = await call('public.driver_report_delay($1, $2)', [unknownAttempt, r]);
    check(`delay reason "${r}" is accepted by the database`, x.error_code === 'ERR_NOT_ON_THE_WAY', x);
  }
  check('an unknown delay reason is refused', (await call('public.driver_report_delay($1, $2)', [unknownAttempt, 'because'])).error_code === 'ERR_DELAY_REASON');
  const dbDelay = (await one(`SELECT pg_get_functiondef('public.driver_report_delay(uuid,text)'::regprocedure) AS d`)).d;
  const delayList = (() => { const m = dbDelay.match(/NOT IN \(([^)]*)\)/); return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort() : []; })();
  check('the database accepts exactly the delay reasons the screens offer', JSON.stringify(delayList) === JSON.stringify([...delayReasons].sort()), delayList);
  const dbDecline = (await one(`SELECT pg_get_functiondef('public.decline_booking_offer(uuid,text)'::regprocedure) AS d`)).d;
  const dbCancel = (await one(`SELECT pg_get_functiondef('public.driver_cancel_booking(uuid,text,text)'::regprocedure) AS d`)).d;
  const listIn = (text, marker) => { const m = text.match(new RegExp(`${marker}[^(]*\\(([^)]*)\\)`)); return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort() : []; };
  check('the database accepts exactly the five decline reasons (no reason the screens do not offer)', JSON.stringify(listIn(dbDecline, 'NOT IN')) === JSON.stringify([...declineReasons].sort()), listIn(dbDecline, 'NOT IN'));
  check('the database accepts exactly the cancellation reasons the screens offer', JSON.stringify(listIn(dbCancel, 'NOT IN')) === JSON.stringify([...cancelReasons].sort()), listIn(dbCancel, 'NOT IN'));
  const chk = (await one(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'dispatch_attempt_decline_reason_check'`)).d;
  check('and the column\'s own constraint lists the same decline reasons', JSON.stringify([...chk.matchAll(/'([^']+)'/g)].map((x) => x[1]).sort()) === JSON.stringify([...declineReasons].sort()), chk);

  // The statuses that count as an OPEN booking (Rule 4.4): the list the passenger app uses to find the booking it must show must equal the
  // database's own (a search that is running, or a driver committed and the trip not finished).
  const utils = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'src', 'utils', 'bookingUtils.ts'), 'utf8');
  const openMatch = utils.match(/export const BOOKING_OPEN_STATUSES = \[([\s\S]*?)\] as const;/);
  const tsOpen = openMatch ? [...openMatch[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort() : [];
  const fnText = async (sig) => (await one(`SELECT pg_get_functiondef('${sig}'::regprocedure) AS d`)).d;
  const quoted = (text) => [...text.matchAll(/'([^']+)'/g)].map((x) => x[1]);
  const dbOpen = [...new Set([...quoted((await fnText('public._booking_is_open_accepted(text)')).split('p_status IN')[1] || ''),
                              ...quoted((await fnText('public._booking_is_searching(text)')).split('p_status IN')[1] || '')])].sort();
  check('the app\'s list of open booking statuses equals the database\'s (searching + accepted and not finished)', JSON.stringify(tsOpen) === JSON.stringify(dbOpen) && tsOpen.length === 13, { tsOpen, dbOpen });
  for (const st of ['Completed', 'Cancelled', 'No Driver Found']) {
    const open = (await one(`SELECT (public._booking_is_searching('${st}') OR public._booking_is_open_accepted('${st}')) v`)).v;
    check(`"${st}" is not an open booking in the database (the passenger may book again), nor in the app's list`, open === false && !tsOpen.includes(st), open);
  }
  const unknownPhase = (await one(`SELECT public._booking_phase('Nonsense') v`)).v;
  const phases = await q(`SELECT s, public._booking_phase(s) p FROM unnest(ARRAY['Pending','Accepted','Driver Arrived','Trip Ongoing','Arrived at Destination','Completed','Cancelled','No Driver Found']) s`);
  check('every status of the booking lifecycle has a phase and a made-up one has none', unknownPhase === null && phases.every((r) => r.p !== null), phases);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
