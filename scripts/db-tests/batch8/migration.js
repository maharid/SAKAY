// Batch 8 (20261023000001): the migration file itself. It is ASCII only (a hand-applied file cannot be re-encoded: the Batch 7 em dash was), safe to run twice
// (every function keeps its exact code and its privileges, the new columns keep their data), and the sweep it replaces still writes the real em dash in the
// passenger's "Connection lost" title (the dash is a Unicode escape now). Whole migration chain on the local emulator (never Supabase).
const fs = require('fs');
const path = require('path');
const { setup, ID, DRIVERS, check, summary } = require('../b6fixtures');

const FILE = path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261023000001_batch8_arrival_noshow_cancellation.sql');

(async () => {
  const bytes = fs.readFileSync(FILE);
  const sql = bytes.toString('utf8');
  console.log('S1 the file');
  check('the migration contains only ASCII characters', ![...bytes].some((b) => b > 0x7f));
  check('it is a forward-only file: no DROP of a table or column, no edit of an earlier migration is needed to run it', !/DROP\s+(TABLE|COLUMN)/i.test(sql));
  const names = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\s*\(/gi)].map((m) => m[1].toLowerCase());
  const unique = [...new Set(names)].sort();
  check(`it defines ${unique.length} functions, each once`, unique.length === names.length, names.filter((n, i) => names.indexOf(n) !== i));

  const s = await setup();
  const { q, one, internal, db } = s;
  const fingerprints = async () => Object.fromEntries((await q(`SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS fn,
      md5(replace(p.prosrc, E'\\r', '')) || ':' || COALESCE(p.proacl::text, '') AS fp FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1::text[])`, [unique])).map((r) => [r.fn, r.fp]));

  console.log('\nS2 safe to run twice');
  // some data in the new columns that a second run must not touch
  await s.online('D1', 300);
  const b = await s.bookAs('P1');
  const o = await s.pendingOffer(b.booking_id);
  await s.accept('D1', o.attempt_id);
  await internal(`UPDATE booking SET wait_paused_seconds = 12.5, boarding_verified_at = '2026-01-01T00:00:00Z' WHERE booking_id = '${b.booking_id}'`);
  const before = await fingerprints();
  const again = await db.exec(sql).then(() => true, (e) => e.message);
  const after = await fingerprints();
  check('the file runs a second time without error', again === true, again);
  check(`all ${Object.keys(before).length} functions keep exactly their code and privileges`, JSON.stringify(before) === JSON.stringify(after), Object.keys(after).filter((k) => before[k] !== after[k]));
  const row = await s.booking(b.booking_id);
  check('the data in the new columns is untouched', Number(row.wait_paused_seconds) === 12.5 && row.boarding_verified_at !== null, row);

  console.log('\nS3 who may call what');
  const can = async (role, fn) => (await one(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE') AS c`)).c;
  check('signed-in users can call exactly the two new calls: driver_confirm_passenger and passenger_update_pickup', (await can('authenticated', 'public.driver_confirm_passenger(uuid)')) && (await can('authenticated', 'public.passenger_update_pickup(uuid, double precision, double precision, text, numeric, numeric)')));
  check('anonymous callers can call neither', !(await can('anon', 'public.driver_confirm_passenger(uuid)')) && !(await can('anon', 'public.passenger_update_pickup(uuid, double precision, double precision, text, numeric, numeric)')));
  const helpers = ['public._cancellation_decision(public.booking, text, text)', 'public._check_repeat_cancellations(text, uuid)', 'public._booking_wait_track(public.booking, timestamp with time zone)',
    'public._driver_progress_toward_pickup_m(public.booking)', 'public._driver_pickup_distance_m(uuid, uuid)', 'public._driver_within_pickup_zone(uuid, uuid)', 'public.passenger_first_name(text)',
    'public.booking_shared_partner_on_cancel()', 'public.booking_timers_sweep()', 'public.dispatch_sweep()'];
  const open = [];
  for (const f of helpers) if ((await can('authenticated', f)) || (await can('anon', f))) open.push(f);
  check('the helpers and the sweeps are closed to signed-in and anonymous users', open.length === 0, open);

  console.log('\nS4 the sweep it replaces still writes the real em dash');
  const src = (await one(`SELECT prosrc FROM pg_proc WHERE proname = 'booking_timers_sweep' AND pronamespace = 'public'::regnamespace`)).prosrc;
  check('the function source holds the dash as an escape (ASCII), not as a character', src.includes("U&'Connection lost \\2014 reconnecting...") && ![...src].some((c) => c.charCodeAt(0) > 127));
  await s.moveTo('D1', 200);
  await internal(`UPDATE driver SET last_location_update = last_location_update - interval '190 seconds' WHERE driver_id = '${DRIVERS.D1.id}';
                  UPDATE booking SET accepted_at = accepted_at - interval '190 seconds', stall_anchor_at = stall_anchor_at - interval '190 seconds' WHERE booking_id = '${b.booking_id}'`);
  await s.sweep();
  const note = (await q(`SELECT title FROM notification WHERE recipient_id = '${ID.P1}' AND notification_type = 'DRIVER_UNREACHABLE' AND subject_id = '${b.booking_id}'`))[0];
  check('a driver silent for 3 minutes: the passenger\'s title holds a real em dash (U+2014) and none of the three damaged characters',
    note && note.title === 'Connection lost — reconnecting... (Nawalan ng koneksyon)' && ![...note.title].some((c) => 'â€”'.includes(c)), note);
  await s.finish(b.booking_id);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
