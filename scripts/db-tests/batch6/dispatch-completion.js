// Batch 6, Phase B (2026-10-11): what the re-audit added to the Intelligent Driver Dispatch (migration 20261019000001), on the local emulator
// (never Supabase). D-1 the ETA from the routing engine with its fallback, D-2 the 10-minute default, D-3 / PI-11 the Coverage Gap Indicator,
// D-4 / M1 Retry, M2 hardening, M3 the audit snapshot and the decline history, H9 No Driver Found -> Cancelled, and the leftover offers of finished
// bookings (an unanswered offer that outlived its booking used to keep its driver out of every search).
//
// The emulator has no `http` extension, so the ONE function that talks to the network (_osrm_http_get) is replaced in this suite by a stub that
// answers like OSRM's `table` service, fails, or answers rubbish, as a test asks. The stub counts its calls with a SEQUENCE (a sequence is not
// rolled back, so a request that failed is still counted). What this suite therefore cannot prove is the `http` extension's own call inside
// _osrm_http_get (the curl options): that is checked on the hosted project after the extension is installed (docs/policy-decisions.md 12.1).
const fs = require('fs');
const path = require('path');
const { setup, ID, DRIVERS, attempt, check, summary, PICKUP } = require('../b6fixtures');

(async () => {
  let s = await setup();
  let { q, one, internal, svc, as, db } = s;
  const off = async (k) => { await s.goOffline(DRIVERS[k].uid); };
  const allOffline = async () => { for (const k of ['D1', 'D2', 'D3']) if ((await s.status(DRIVERS[k].id)) !== 'Offline') await off(k); };
  const reset = async (b) => { if (b) await s.finish(b.booking_id); await allOffline(); };
  const state = () => one(`SELECT * FROM osrm_eta_state WHERE singleton`);
  const sortedJson = (obj) => JSON.stringify(Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : 1))));

  // ---- the test seam: the only function that talks to the network ---------------------------------------------------------------------
  const realDef = (await one(`SELECT pg_get_functiondef('public._osrm_http_get(text)'::regprocedure) AS d`)).d;
  await db.exec(`
    CREATE SEQUENCE IF NOT EXISTS public.zz_osrm_calls;
    CREATE TABLE IF NOT EXISTS public.zz_osrm_urls (url TEXT, at TIMESTAMPTZ DEFAULT clock_timestamp());`);
  const stubSql = `
    CREATE OR REPLACE FUNCTION public._osrm_http_get(p_url TEXT) RETURNS TEXT LANGUAGE plpgsql AS $f$
    DECLARE v_mode TEXT := COALESCE(current_setting('sakay.test_osrm_mode', true), 'none');
    BEGIN
      IF v_mode = 'none' THEN RETURN NULL; END IF;
      PERFORM nextval('public.zz_osrm_calls');
      IF v_mode = 'fail' THEN RAISE EXCEPTION 'osrm_http_status_503'; END IF;
      IF v_mode = 'bad' THEN RETURN 'not json'; END IF;
      IF v_mode = 'fail_primary' AND p_url LIKE 'https://router.project-osrm.org/%' THEN RAISE EXCEPTION 'osrm_timeout'; END IF;
      INSERT INTO public.zz_osrm_urls(url) VALUES (p_url);
      RETURN current_setting('sakay.test_osrm_body', true);
    END $f$;`;
  const mode = async (m, body = '') => {
    await db.query(`SELECT set_config('sakay.test_osrm_mode', $1, false), set_config('sakay.test_osrm_body', $2, false)`, [m, body]);
  };
  const calls = async () => Number((await one(`SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS n FROM public.zz_osrm_calls`)).n);
  const lastUrl = async () => (await one(`SELECT url FROM public.zz_osrm_urls ORDER BY at DESC LIMIT 1`))?.url;
  const osrmBody = (durations, distances) => JSON.stringify({ code: 'Ok', durations: durations.map((d) => [d]), distances: distances.map((d) => [d]) });
  const ask = (bookingId, ids = [ID.D1, ID.D2]) => db.query(`SELECT public._dispatch_osrm_etas($1, $2::uuid[]) AS r`, [bookingId, `{${ids.join(',')}}`]);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('S1 D-1: without the `http` extension (this emulator) the ETA is the straight-line estimate, labelled as such, and nothing is asked');
  check('the default transport answers NULL ("I cannot make the request"), it does not raise', (await one(`SELECT public._osrm_http_get('https://router.project-osrm.org/x') AS v`)).v === null);
  await s.online('D1', 300); await s.online('D2', 500);
  let b = await s.bookAs('P1');
  let o = await s.offers(b.booking_id);
  check('the nearest driver is offered with the estimate: 300 m, 70 s, eta_source straight_line_estimate',
    o.length === 1 && o[0].driver_id === ID.D1 && o[0].eta_seconds === 70 && o[0].distance_m === 300 && o[0].eta_source === 'straight_line_estimate', o);
  const st0 = await state();
  check('nothing was asked of a routing engine: no cached ETA, and no failure counted against it (it is not down, it is not there)',
    (await q(`SELECT 1 FROM osrm_eta_cache`)).length === 0 && st0.consecutive_failures === 0 && st0.last_failure_at === null && st0.open_until === null, st0);
  await reset(b);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS2 D-1: with the routing engine the ETA and the road distance are its own, and the ranking follows them');
  await db.exec(stubSql);
  // D1 is nearer by straight line (300 m against 500 m) but 2.5 km away by road; D2 is 700 m by road (the order of the answer is the drivers' ids)
  await mode('ok', osrmBody([300, 90], [2500, 700]));
  await s.online('D1', 300); await s.online('D2', 500);
  const callsBefore = await calls();
  b = await s.bookAs('P1');
  o = await s.offers(b.booking_id);
  check('D2 (700 m by road, 90 s) is offered before D1 (nearer by straight line, 2.5 km by road): the ranking is the routing engine\'s',
    o.length === 1 && o[0].driver_id === ID.D2 && o[0].eta_seconds === 90 && o[0].distance_m === 700 && o[0].eta_source === 'osrm', o);
  check('ONE request for both drivers (a `table` request), not one per driver', (await calls()) === callsBefore + 1);
  const url = await lastUrl();
  check('the request: the primary server, drivers as sources 0..1 (ordered by driver id), the pickup as the one destination, duration and distance',
    url.startsWith('https://router.project-osrm.org/table/v1/driving/') && /\?sources=0;1&destinations=2&annotations=duration,distance$/.test(url)
    && url.split('/driving/')[1].split('?')[0].split(';').length === 3 && url.includes('121.180300,13.411500'), url);
  check('both answers were cached', (await q(`SELECT driver_id, eta_seconds, route_distance_m FROM osrm_eta_cache WHERE booking_id='${b.booking_id}' ORDER BY driver_id`))
    .map((r) => `${r.eta_seconds}/${r.route_distance_m}`).join() === '300/2500,90/700');
  const stOk = await state();
  check('the routing engine is recorded as healthy', stOk.consecutive_failures === 0 && stOk.last_success_at !== null && stOk.open_until === null, stOk);
  await s.decline('D2', o[0].attempt_id, 'other');
  const o2 = await s.offers(b.booking_id);
  check('D2 declines: D1 is offered at once with the engine\'s figures and WITHOUT another request (the cached answer, under 15 s old)',
    o2.length === 2 && o2[1].driver_id === ID.D1 && o2[1].eta_seconds === 300 && o2[1].eta_source === 'osrm' && (await calls()) === callsBefore + 1, o2);

  console.log('   the cache lives 15 s');
  await ask(b.booking_id);
  check('asked again straight away: answered from the cache, no request', (await calls()) === callsBefore + 1);
  await internal(`UPDATE osrm_eta_cache SET computed_at = computed_at - interval '20 seconds'`);
  await ask(b.booking_id);
  check('asked 20 s later: a fresh request', (await calls()) === callsBefore + 2);
  await reset(b);

  console.log('   a tie on the ETA goes to the shorter ROAD distance (Rule 7.2.1, second criterion)');
  await s.online('D1', 300); await s.online('D2', 500);
  await mode('ok', osrmBody([100, 100], [900, 400]));
  b = await s.bookAs('P1');
  o = await s.offers(b.booking_id);
  check('equal ETA: D2 (400 m by road) before D1 (900 m by road)', o.length === 1 && o[0].driver_id === ID.D2 && o[0].eta_source === 'osrm', o);
  await reset(b);

  console.log('   the shortest ETA wins over the shortest road distance when they disagree (criterion 1 before criterion 2)');
  await s.online('D1', 300); await s.online('D2', 500);
  await mode('ok', osrmBody([60, 90], [900, 400]));
  b = await s.bookAs('P1');
  o = await s.offers(b.booking_id);
  check('D1 (60 s, 900 m by road) is offered before D2 (90 s, 400 m by road): the ETA decides, the distance only breaks a tie',
    o.length === 1 && o[0].driver_id === ID.D1 && o[0].eta_seconds === 60 && o[0].eta_source === 'osrm', o);
  await reset(b);

  console.log('   everything equal: the lowest driver id wins, even though the other driver is nearer by straight line (criterion 4b)');
  await s.online('D1', 500); await s.online('D2', 300);
  await internal(`UPDATE driver_online_session SET started_at = now() - interval '1 hour' WHERE driver_id IN ('${ID.D1}', '${ID.D2}') AND ended_at IS NULL;
                  UPDATE driver_toda_affiliation SET lgu_verified_at = '2026-01-01T00:00:00Z' WHERE affiliation_id IN ('${s.AFF.D1_T1}', '${s.AFF.D2_T1}')`);
  await mode('ok', osrmBody([100, 100], [500, 500]));
  b = await s.bookAs('P1');
  o = await s.offers(b.booking_id);
  check('D1 (lower id, 500 m by straight line) is offered before D2 (300 m): equal ETA, road distance, available time and approval',
    o.length === 1 && ID.D1 < ID.D2 && o[0].driver_id === ID.D1 && o[0].eta_seconds === 100 && o[0].eta_source === 'osrm', o);
  await reset(b);

  console.log('   one driver the engine cannot route: the whole ranking uses the estimate (two scales are never mixed)');
  await s.online('D1', 300); await s.online('D2', 500);
  await mode('ok', JSON.stringify({ code: 'Ok', durations: [[120], [null]], distances: [[500], [null]] }));
  b = await s.bookAs('P1');
  o = await s.offers(b.booking_id);
  check('D1 (nearest by straight line) is offered with the estimate and the label says so',
    o.length === 1 && o[0].driver_id === ID.D1 && o[0].eta_source === 'straight_line_estimate' && o[0].eta_seconds === 70, o);
  await reset(b);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS3 D-1 / F6.10: a failing routing engine never stops a search; a second server, a budget and a circuit breaker');
  await s.online('D1', 300); await s.online('D2', 500);
  await mode('fail_primary', osrmBody([200, 50], [1500, 300]));
  await internal(`DELETE FROM osrm_eta_cache; UPDATE osrm_eta_state SET consecutive_failures = 0, open_until = NULL`);
  let c0 = await calls();
  b = await s.bookAs('P1');
  o = await s.offers(b.booking_id);
  check('the primary server times out: the request is retried once on the second server and its answer is used',
    (await calls()) === c0 + 2 && (await lastUrl()).startsWith('https://routing.openstreetmap.de/routed-car/table/v1/driving/') && o.length === 1 && o[0].driver_id === ID.D2 && o[0].eta_source === 'osrm', o);
  check('...and the engine is healthy again', (await state()).consecutive_failures === 0);
  await reset(b);

  await s.online('D1', 300); await s.online('D2', 500);
  await mode('fail');
  await internal(`DELETE FROM osrm_eta_cache; UPDATE osrm_eta_state SET consecutive_failures = 0, open_until = NULL`);
  const probe = await s.bookAs('P1');                 // a booking to ask about (its offer is made by the estimate, below)
  check('both servers fail: the search is NOT stopped: the nearest driver is offered with the labelled estimate',
    (await s.offers(probe.booking_id)).length === 1 && (await s.offers(probe.booking_id))[0].eta_source === 'straight_line_estimate' && (await s.offers(probe.booking_id))[0].driver_id === ID.D1);
  check('one failed ranking is counted (not one per server)', (await state()).consecutive_failures === 1, await state());
  c0 = await calls();
  await ask(probe.booking_id); await ask(probe.booking_id);
  check('two more failed rankings open the circuit breaker: 3 in a row, closed for 60 s',
    (await state()).consecutive_failures === 3 && new Date((await state()).open_until) > new Date(Date.now() + 50000) && (await calls()) === c0 + 4, await state());
  c0 = await calls();
  await ask(probe.booking_id);
  check('while the breaker is open nothing is asked of the routing engine', (await calls()) === c0);
  await internal(`UPDATE osrm_eta_state SET open_until = now() - interval '1 second'`);
  await mode('ok', osrmBody([200, 50], [1500, 300]));
  const healed = (await ask(probe.booking_id)).rows[0].r;
  check('after the 60 s one request is tried again; its success closes the breaker and clears the failures',
    (await calls()) === c0 + 1 && Object.keys(healed).length === 2 && (await state()).consecutive_failures === 0 && (await state()).open_until === null, { healed, st: await state() });
  await reset(probe);

  console.log('   a nonsense answer (not JSON, or a code that is not Ok) is a failure too, and one ranking asks at most twice');
  await s.online('D1', 300); await s.online('D2', 500);
  await mode('bad');
  await internal(`DELETE FROM osrm_eta_cache; UPDATE osrm_eta_state SET consecutive_failures = 0, open_until = NULL`);
  const bad = await s.bookAs('P2');
  check('not JSON: the estimate is used', (await s.offers(bad.booking_id))[0]?.eta_source === 'straight_line_estimate' && (await state()).consecutive_failures === 1);
  await mode('ok', JSON.stringify({ code: 'NoTable' }));
  await internal(`DELETE FROM osrm_eta_cache; UPDATE osrm_eta_state SET consecutive_failures = 0`);
  c0 = await calls();
  const budget = await db.exec(`
    SELECT public._dispatch_osrm_etas('${bad.booking_id}', ARRAY['${ID.D1}','${ID.D2}']::uuid[]);
    SELECT public._dispatch_osrm_etas('${bad.booking_id}', ARRAY['${ID.D1}','${ID.D2}']::uuid[]);
    SELECT public._dispatch_osrm_etas('${bad.booking_id}', ARRAY['${ID.D1}','${ID.D2}']::uuid[]);
    SELECT current_setting('sakay.osrm_calls', true) AS n;`);
  check('three rankings in ONE transaction make 2 requests in all (the budget), and only the first counts as a failure',
    (await calls()) === c0 + 2 && budget[budget.length - 1].rows[0].n === '2' && (await state()).consecutive_failures === 1, { n: await calls() - c0, st: await state() });
  await reset(bad);
  await mode('none');
  await internal(`UPDATE osrm_eta_state SET consecutive_failures = 0, open_until = NULL`);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS4 M1 / D-4 Retry: Rule 4.4 holds through Retry, and a search that ended long ago cannot be restarted');
  await s.online('D1', 300);
  const nd = await s.bookAs('P1');
  const ndOffer = (await s.offers(nd.booking_id))[0];
  await s.decline('D1', ndOffer.attempt_id, 'other');
  await allOffline();
  await s.rewind(nd.booking_id, 601); await s.sweep();
  let ndb = await s.booking(nd.booking_id);
  check('the live search ran 10 minutes: No Driver Found, with its end time stamped', ndb.booking_status === 'No Driver Found' && ndb.dispatch_ended_at !== null, ndb);
  const second = await s.bookAs('P1');
  check('the passenger may book again (No Driver Found is not open)', second.booking_status === 'Pending');
  const blocked = await s.retry('P1', nd.booking_id);
  ndb = await s.booking(nd.booking_id);
  check('Retry of the old booking is refused while the new one is open (the hole that left two open bookings)',
    blocked.success === false && blocked.error_code === 'ERR_OPEN_BOOKING_EXISTS' && ndb.booking_status === 'No Driver Found' && ndb.dispatch_cycle === 1, blocked);
  check('...and the passenger still holds exactly one open booking', (await q(`SELECT 1 FROM booking WHERE passenger_id='${ID.P1}' AND booking_status IN ('Pending','Searching Driver')`)).length === 1);
  await s.cancelAs(ID.P_AUTH, second.booking_id);
  await s.online('D1', 300);
  // a stale search
  await internal(`UPDATE booking SET dispatch_ended_at = now() - interval '61 minutes' WHERE booking_id = '${nd.booking_id}'`);
  const stale = await s.retry('P1', nd.booking_id);
  check('a search that ended 61 minutes ago cannot be restarted: make a new booking', stale.success === false && stale.error_code === 'ERR_RETRY_EXPIRED', stale);
  await internal(`UPDATE booking SET dispatch_ended_at = NULL, created_at = now() - interval '2 hours' WHERE booking_id = '${nd.booking_id}'`);
  check('an older booking without an end time is dated by when it was made',
    (await s.retry('P1', nd.booking_id)).error_code === 'ERR_RETRY_EXPIRED');
  await internal(`UPDATE booking SET dispatch_ended_at = now() - interval '59 minutes' WHERE booking_id = '${nd.booking_id}'`);
  const fresh = await s.retry('P1', nd.booking_id);
  ndb = await s.booking(nd.booking_id);
  check('59 minutes after it ended Retry works: the same booking, a new cycle from Tier 1, the end time cleared',
    fresh.success === true && ndb.booking_status === 'Pending' && ndb.dispatch_cycle === 2 && ndb.dispatch_tier === 1 && ndb.dispatch_ended_at === null, { fresh, ndb });
  check('a second Retry while it runs is harmless (no third cycle)', (await s.retry('P1', nd.booking_id)).already_searching === true && (await s.booking(nd.booking_id)).dispatch_cycle === 2);
  await reset(nd);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS5 M2 hardening: one unanswered offer per booking, the words of an offer, and who may run the sweep');
  const idx = await one(`SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_dispatch_attempt_one_pending_per_booking'`);
  check('one Pending offer per booking is a unique, partial index', idx && /UNIQUE/i.test(idx.indexdef) && /response_status/.test(idx.indexdef) && /Pending/.test(idx.indexdef), idx);
  await s.online('D1', 300);
  b = await s.bookAs('P1');
  const badStatus = await attempt(() => internal(`UPDATE dispatch_attempt SET response_status = 'Timed Out' WHERE booking_id = '${b.booking_id}'`));
  check('an offer cannot be given a word the engine does not use', !badStatus.ok && /dispatch_attempt_response_status_check/.test(badStatus.error), badStatus);
  const badSource = await attempt(() => internal(`UPDATE dispatch_attempt SET eta_source = 'guess' WHERE booking_id = '${b.booking_id}'`));
  check('nor an ETA source other than the two labels', !badSource.ok && /dispatch_attempt_eta_source_check/.test(badSource.error), badSource);
  for (const [who, uid] of [['a passenger', ID.P_AUTH], ['a driver', ID.D_AUTH], ['a TODA administrator', ID.T_AUTH], ['the LGU administrator', ID.L_AUTH]]) {
    const r = await attempt(() => as(uid, (tx) => tx.query(`SELECT public.dispatch_sweep() AS n`)));
    check(`${who} cannot run the sweep`, !r.ok && /permission denied/i.test(r.error), r);
  }
  const anon = await attempt(() => s.asUser(db, { role: 'anon' }, (tx) => tx.query(`SELECT public.dispatch_sweep()`), { commit: true }));
  check('nor can an anonymous caller', !anon.ok && /permission denied/i.test(anon.error), anon);
  const sv = await attempt(() => svc((tx) => tx.query(`SELECT public.dispatch_sweep() AS n`)));
  check('the scheduled job (service role) still can', sv.ok && typeof sv.value.rows[0].n === 'number', sv);
  await reset(b);
  console.log('   ...and the searches still move with nobody calling the sweep: a driver\'s own poll runs it');
  await s.online('D1', 300); await s.online('D2', 500);
  b = await s.bookAs('P1');
  const first = (await s.offers(b.booking_id))[0];
  await s.rewind(b.booking_id, 25);
  const polled = await s.myOffer('D2');
  const after = await s.offers(b.booking_id);
  check('the first offer ran out, and the OTHER driver\'s poll found the next offer made to him',
    first.driver_id === ID.D1 && polled && polled.booking_id === b.booking_id && after.length === 2 && after[1].driver_id === ID.D2, { polled, after });
  await reset(b);
  for (const [what, sqlText] of [['the cached ETAs', 'SELECT * FROM public.osrm_eta_cache'], ['the routing engine\'s health', 'SELECT * FROM public.osrm_eta_state'],
                                  ['the ETA lookup', `SELECT public._dispatch_osrm_etas('${ID.P1}', ARRAY[]::uuid[])`], ['the housekeeping', 'SELECT public.purge_dispatch_logs()'],
                                  ['the network call', `SELECT public._osrm_http_get('https://router.project-osrm.org/')`]]) {
    const r = await attempt(() => as(ID.P_AUTH, (tx) => tx.query(sqlText)));
    check(`a signed-in user cannot reach ${what}`, !r.ok && /permission denied/i.test(r.error), r);
  }

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS6 M3 / Rule 7.9: the ranking inputs are on the offer, the flag carries the reasons, and the TODA administrator can read the history');
  await mode('ok', osrmBody([300, 90], [2500, 700]));
  await s.online('D1', 300); await s.online('D2', 500, 25);
  b = await s.bookAs('P1');
  o = (await s.offers(b.booking_id))[0];
  const d2 = await one(`SELECT current_latitude lat, current_longitude lng, last_location_accuracy_m acc FROM driver WHERE driver_id='${ID.D2}'`);
  check('the offer records where the driver was, how accurate the fix was and how old it was when it was ranked',
    o.driver_id === ID.D2 && Math.abs(o.driver_lat - d2.lat) < 1e-9 && Math.abs(o.driver_lng - d2.lng) < 1e-9 && o.gps_accuracy_m === 25 && o.gps_age_seconds >= 0 && o.gps_age_seconds <= 5, o);
  await reset(b);
  await mode('none');

  await internal(`DELETE FROM dispatch_attempt; DELETE FROM admin_review_flag`);          // the history starts here: only this section's declines
  await s.online('D1', 300);
  const reasons = ['vehicle_issue', 'vehicle_issue', 'end_of_shift', 'end_of_shift', 'other'];
  for (const r of reasons) {
    const x = await s.bookAs('P1');
    await s.decline('D1', (await s.offers(x.booking_id))[0].attempt_id, r);
    await s.finish(x.booking_id);
  }
  const flag = await one(`SELECT details FROM admin_review_flag WHERE flag_type='DRIVER_REPEATED_DECLINES' AND subject_id='${ID.D1}'`);
  check('the fifth decline in 24 h raises the review flag, with the reasons broken down (a flag only: no strike)',
    flag && flag.details.declines_in_window === 5 && flag.details.latest_reason === 'other'
    && sortedJson(flag.details.reasons) === sortedJson({ end_of_shift: 2, other: 1, vehicle_issue: 2 }) && (await s.strikes(ID.D1)).length === 0, flag);
  const hist = (uid, driver, days = null) => s.rpcAs(uid, 'public.get_driver_decline_history($1, $2)', [driver, days]);
  const hT = await hist(ID.T_AUTH, ID.D1);
  check('the administrator of the driver\'s TODA reads the history: the reasons, the declines (newest first), the offers and the driver\'s circumstances',
    hT.success === true && hT.summary.declined === 5 && hT.by_reason.vehicle_issue === 2 && hT.by_reason.end_of_shift === 2 && hT.by_reason.other === 1
    && hT.declines.length === 5 && hT.declines[0].reason === 'other' && hT.open_review_flags === 1 && typeof hT.availability_status === 'string', hT);
  check('no passenger is named in it', !/Pax One|Pax Two|\+6391700/.test(JSON.stringify(hT)));
  check('the LGU administrator reads it too', (await hist(ID.L_AUTH, ID.D1)).success === true);
  for (const [who, uid, driver] of [['the administrator of ANOTHER TODA', ID.T2_AUTH, ID.D1], ['a passenger', ID.P_AUTH, ID.D1], ['another driver', ID.D2_AUTH, ID.D1], ['the driver himself', ID.D_AUTH, ID.D1],
                                     ['anybody, for a driver who does not exist', ID.L_AUTH, '00000000-0000-0000-0000-0000000000ee']]) {
    const r = await attempt(() => hist(uid, driver));
    check(`${who} is refused`, !r.ok && /Access Denied/i.test(r.error), r);
  }
  check('the administrator of a TODA the driver is AFFILIATED with (D2 applied to both) reads it as well',
    (await hist(ID.T2_AUTH, ID.D2)).success === true && (await hist(ID.T_AUTH, ID.D2)).success === true);
  check('a shorter window reads fewer days (the window is a parameter, 1 to 180)', (await hist(ID.T_AUTH, ID.D1, 0)).window_days === 1 && (await hist(ID.T_AUTH, ID.D1, 9999)).window_days === 180);
  await allOffline();

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS7 PI-11 / D-3 Coverage Gap Indicator: 5 bookings of a zone in 24 h that reach the live search or end as No Driver Found, logged once, analysis only');
  s = await setup();                                                          // a fresh database: every zone is counted from nothing
  ({ q, one, internal, svc, as, db } = s);
  const gapRows =(zone) => q(`SELECT * FROM audit_log WHERE action_type = 'COVERAGE_GAP_INDICATOR' ${zone ? `AND target_id = '${zone}'` : ''} ORDER BY performed_at`);
  const reach = async (n) => { const made = []; for (let i = 0; i < n; i++) { const x = await s.bookAs('P1'); await s.finish(x.booking_id); made.push(x.booking_id); } return made; };
  await internal(`UPDATE toda SET barangay = 'Lumangbayan' WHERE toda_id = '${ID.TODA1}'; UPDATE toda SET barangay = 'Sta. Isabel' WHERE toda_id = '${ID.TODA2}'`);
  check('nobody is Online: a new booking reaches the live search at once (the zone is its Priority TODA\'s barangay)',
    (await s.booking((await reach(1))[0])).dispatch_reached_tier3_at !== null);
  await reach(3);
  check('four bookings of the zone: no indicator yet', (await gapRows('Lumangbayan')).length === 0);
  const fifth = (await reach(1))[0];
  let gap = await gapRows('Lumangbayan');
  check('the fifth: ONE indicator for the zone, with the count, the window and the bookings (for analysis)',
    gap.length === 1 && gap[0].after_state.bookings === 5 && gap[0].after_state.threshold === 5 && gap[0].after_state.window_hours === 24
    && gap[0].after_state.booking_ids.length === 5 && gap[0].after_state.booking_ids.includes(fifth), gap);
  await reach(2);
  check('more bookings in the same 24 hours do not log it again', (await gapRows('Lumangbayan')).length === 1);
  check('it is analysis only: no strike, no review flag, no booking changed',
    (await q(`SELECT 1 FROM strikes_ledger`)).length === 0 && (await q(`SELECT 1 FROM admin_review_flag WHERE flag_type ILIKE '%COVERAGE%'`)).length === 0);

  console.log('   another zone is counted on its own');
  await internal(`UPDATE toda SET terminal_latitude = ${PICKUP.lat + 0.0004}, terminal_longitude = ${PICKUP.lng} WHERE toda_id = '${ID.TODA2}';
                  UPDATE toda SET terminal_latitude = ${PICKUP.lat + 0.2}, terminal_longitude = ${PICKUP.lng + 0.2} WHERE toda_id = '${ID.TODA1}'`);
  const zone2 = await reach(3);
  check('three bookings of the Sta. Isabel zone: no indicator for it, and the first zone\'s count is untouched',
    (await gapRows('Sta. Isabel')).length === 0 && (await gapRows('Lumangbayan')).length === 1);

  console.log('   a booking that reached the live search more than 24 hours ago is no longer counted (a rolling window)');
  await internal(`UPDATE booking SET dispatch_reached_tier3_at = now() - interval '25 hours' WHERE booking_id = ANY ('{${zone2.join(',')}}'::uuid[])`);
  await reach(4);
  check('the zone\'s three earlier bookings are now 25 hours old: with four new ones that is four in the window, not seven: no indicator',
    (await gapRows('Sta. Isabel')).length === 0, await gapRows('Sta. Isabel'));
  await reach(1);
  gap = await gapRows('Sta. Isabel');
  check('the fifth booking inside the window logs it, counting only those five', gap.length === 1 && gap[0].after_state.bookings === 5, gap);

  console.log('   No Driver Found counts, once, even though the booking also reached the live search');
  await internal(`UPDATE toda SET terminal_latitude = NULL, terminal_longitude = NULL`);
  const nd2 = [];
  for (let i = 0; i < 3; i++) { const x = await s.bookAs('P1'); await s.rewind(x.booking_id, 601); await s.sweep(); nd2.push(x.booking_id); }
  check('with no terminal at all there is no Priority TODA: the zone is "Unzoned" and three No Driver Found bookings are not enough',
    (await s.booking(nd2[2])).booking_status === 'No Driver Found' && (await s.booking(nd2[2])).priority_toda_id === null && (await gapRows('Unzoned')).length === 0);
  await s.cancelAs(ID.P_AUTH, nd2[0]); await s.cancelAs(ID.P_AUTH, nd2[1]);
  // (the insert trigger clears the search columns of every new booking, so these two are made and THEN ended the way the engine ends them)
  await internal(`INSERT INTO booking (booking_id, passenger_id, passenger_count, pickup_address, pickup_latitude, pickup_longitude, dropoff_address, dropoff_latitude, dropoff_longitude, booking_status)
                  VALUES ('d6000000-0000-0000-0000-000000000001', '${ID.P1}', 1, 'A', ${PICKUP.lat}, ${PICKUP.lng}, 'B', 13.42, 121.19, 'Cancelled'),
                         ('d6000000-0000-0000-0000-000000000002', '${ID.P2}', 1, 'A', ${PICKUP.lat}, ${PICKUP.lng}, 'B', 13.42, 121.19, 'Cancelled');
                  UPDATE booking SET booking_status = 'No Driver Found', dispatch_ended_reason = 'accepted_drivers_cancelled', dispatch_ended_at = now() WHERE booking_id = 'd6000000-0000-0000-0000-000000000001';
                  UPDATE booking SET booking_status = 'No Driver Found', dispatch_ended_reason = 'no_driver_found', dispatch_ended_at = now() WHERE booking_id = 'd6000000-0000-0000-0000-000000000002'`);
  await internal(`SELECT public._dispatch_check_coverage_gap('d6000000-0000-0000-0000-000000000002')`);
  gap = await gapRows('Unzoned');
  check('three + two more (one ended by Rule 12.8, one with the reason No Driver Found): five bookings, one indicator for "Unzoned"',
    gap.length === 1 && gap[0].after_state.bookings === 5, gap);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS8 H9 / Rule 7.4: the passenger may cancel a booking that is No Driver Found: no strike, never booking abuse');
  await internal(`UPDATE toda SET terminal_latitude = ${PICKUP.lat + 0.0004}, terminal_longitude = ${PICKUP.lng} WHERE toda_id = '${ID.TODA1}';
                  UPDATE toda SET terminal_latitude = ${PICKUP.lat + 0.2}, terminal_longitude = ${PICKUP.lng + 0.2} WHERE toda_id = '${ID.TODA2}';
                  DELETE FROM strikes_ledger; DELETE FROM admin_review_flag`);
  await internal(`UPDATE booking SET booking_status = 'Cancelled', cancelled_by = 'system' WHERE passenger_id IN ('${ID.P1}', '${ID.P2}') AND booking_status IN ('Pending','No Driver Found')`);
  const dismissed = [];
  for (let i = 0; i < 3; i++) {
    const x = await s.bookAs('P1');
    await s.rewind(x.booking_id, 601); await s.sweep();
    const r = await s.cancelAs(ID.P_AUTH, x.booking_id, 'No driver found');
    dismissed.push(r.rows[0]);
  }
  const d0 = dismissed[0];
  check('No Driver Found -> Cancelled by the passenger is allowed, and who closed it is recorded',
    dismissed.every((r) => r.booking_status === 'Cancelled' && r.cancelled_by === 'passenger'), dismissed);
  check('the reason the search ended stays No Driver Found (the Coverage Gap still sees it) and its end time is the search\'s, not the cancel\'s',
    d0.dispatch_ended_reason === 'no_driver_found' && d0.dispatch_ended_at !== null && new Date(d0.cancelled_at) >= new Date(d0.dispatch_ended_at), d0);
  check('no strike, whatever the count', (await s.strikes(ID.P1)).length === 0);
  check('three such cancellations in a day are NOT booking abuse: no review flag (Rule 12.9)', (await q(`SELECT 1 FROM admin_review_flag WHERE flag_type = 'PASSENGER_BOOKING_ABUSE_REVIEW'`)).length === 0);
  check('each leaves a cancellation record', (await q(`SELECT 1 FROM cancellation_record WHERE cancelled_by = 'passenger' AND reason = 'No driver found'`)).length === 3);
  check('a closed booking cannot be retried', (await s.retry('P1', d0.booking_id)).error_code === 'ERR_NOT_SEARCHING');
  const x4 = await s.bookAs('P1'); await s.rewind(x4.booking_id, 601); await s.sweep();
  const intruder = await s.cancelAs(ID.P2_AUTH, x4.booking_id);
  const driverTry = await attempt(() => as(ID.D_AUTH, (tx) => tx.query(`UPDATE booking SET booking_status = 'Cancelled' WHERE booking_id = $1 RETURNING booking_id`, [x4.booking_id])));
  check('another passenger and a driver cannot close somebody else\'s booking', intruder.rowCount === 0 && driverTry.ok && driverTry.value.rowCount === 0, { intruder: intruder.rowCount, driverTry });
  await s.cancelAs(ID.P_AUTH, x4.booking_id);
  console.log('   a screen that is out of date cannot close a booking that has moved on (the apps close it only WHERE the status is still No Driver Found)');
  const late = await s.bookAs('P1'); await s.rewind(late.booking_id, 601); await s.sweep();
  check('(set-up) the booking is No Driver Found', (await s.booking(late.booking_id)).booking_status === 'No Driver Found');
  await s.retry('P1', late.booking_id);                        // the passenger retried (another tab): the search runs again
  const lateClose = await as(ID.P_AUTH, (tx) => tx.query(
    `UPDATE booking SET booking_status = 'Cancelled', cancellation_reason = 'No driver found', cancelled_by = 'passenger' WHERE booking_id = $1 AND booking_status = 'No Driver Found' RETURNING booking_id`, [late.booking_id]));
  check('the conditional close touches nothing: the booking is still searching and nothing was struck', lateClose.rowCount === 0 && (await s.booking(late.booking_id)).booking_status === 'Pending' && (await s.strikes(ID.P1)).length === 0);
  await s.finish(late.booking_id);
  console.log('   the ordinary cancellations are still counted: three of them in 24 h raise the flag, and only those three');
  for (let i = 0; i < 3; i++) { const x = await s.bookAs('P1'); await s.cancelAs(ID.P_AUTH, x.booking_id); }
  const abuse = await one(`SELECT details FROM admin_review_flag WHERE flag_type = 'PASSENGER_BOOKING_ABUSE_REVIEW'`);
  check('the review flag counts the three ordinary cancellations, not the four No Driver Found closures', abuse && abuse.details.cancelled_bookings_in_window === 3, abuse);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS9 a leftover unanswered offer of a finished booking no longer keeps its driver out of every search');
  await allOffline(); await s.online('D1', 300);
  const gone = await s.bookAs('P1');
  await s.finish(gone.booking_id);
  // The old browser dispatcher's shape: Pending, no cycle, no expiry, a booking that ended long ago. Clients cannot write one any more (inserts are
  // revoked), so the internal context does here what that dispatcher did.
  await internal(`INSERT INTO dispatch_attempt (booking_id, driver_id, dispatch_method, driver_rank, response_status, notification_sent_at)
                  VALUES ('${gone.booking_id}', '${ID.D1}', 'Nearest', 1, 'Pending', now() - interval '40 days')`);
  const leftoverId = (await one(`SELECT attempt_id FROM dispatch_attempt WHERE booking_id = '${gone.booking_id}' AND response_status = 'Pending'`)).attempt_id;
  check('(set-up) the leftover is Pending, has no expiry, and its booking is finished',
    (await q(`SELECT 1 FROM dispatch_attempt a JOIN booking b ON b.booking_id = a.booking_id WHERE a.attempt_id = '${leftoverId}' AND a.expires_at IS NULL AND b.booking_status = 'Cancelled'`)).length === 1);
  const fresh9 = await s.bookAs('P1');
  const o9 = await s.offers(fresh9.booking_id);
  check('the driver is still offered a new booking: the leftover of a finished booking does not count as an unanswered offer',
    o9.length === 1 && o9[0].driver_id === ID.D1 && o9[0].response_status === 'Pending', o9);
  check('and the passenger\'s screen is on the nearby search, not stuck on the wide one', (await s.statusOf('P1', fresh9.booking_id)).phase === 'nearby');
  const eligibleFor = (booking) => q(`SELECT driver_id FROM dispatch_eligible_drivers('${booking.booking_id}'::uuid, NULL)`);
  const rival9 = await s.bookAs('P2');
  check('a driver who really holds an unanswered offer of a booking that is still being searched is NOT offered a second booking (the rule itself is intact)',
    (await s.offers(rival9.booking_id)).length === 0 && (await eligibleFor(rival9)).length === 0);
  await internal(`UPDATE dispatch_attempt SET expires_at = NULL WHERE booking_id = '${fresh9.booking_id}' AND response_status = 'Pending'`);
  check('an offer with no expiry recorded still holds its driver inside the offer window (20 s from when it was sent)', (await eligibleFor(rival9)).length === 0);
  await internal(`UPDATE dispatch_attempt SET notification_sent_at = now() - interval '30 seconds' WHERE booking_id = '${fresh9.booking_id}' AND response_status = 'Pending'`);
  check('... and no longer once that window has passed', (await eligibleFor(rival9)).map((r) => r.driver_id).includes(ID.D1));
  await s.finish(fresh9.booking_id); await s.finish(rival9.booking_id); await allOffline();

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS10 housekeeping: the daily purge, and the migration can be run twice');
  await internal(`INSERT INTO osrm_eta_cache (booking_id, driver_id, eta_seconds, route_distance_m, driver_lat, driver_lng, computed_at)
                  VALUES ('${x4.booking_id}', '${ID.D3}', 60, 400, 13.41, 121.18, now() - interval '3 days'),
                         ('${x4.booking_id}', '${ID.D2}', 60, 400, 13.41, 121.18, now())`);
  const purged = (await svc((tx) => tx.query(`SELECT public.purge_dispatch_logs() AS r`))).rows[0].r;
  check('the purge removes the old cached ETAs and keeps the recent ones; with no pg_cron here it has no run details to remove',
    purged.osrm_cache_rows_removed === 1 && purged.cron_run_details_removed === 0 && purged.kept_days === 2
    && (await q(`SELECT 1 FROM osrm_eta_cache WHERE driver_id = '${ID.D2}' AND booking_id = '${x4.booking_id}'`)).length === 1, purged);

  await db.exec(realDef);                                   // the real transport again
  check('the real transport is back (NULL: no `http` extension here)', (await one(`SELECT public._osrm_http_get('https://router.project-osrm.org/x') AS v`)).v === null);
  const migration = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261019000001_batch6_dispatch_completion.sql'), 'utf8');
  const FINISHED = 'd6000000-0000-0000-0000-000000000009';
  const dupBooking = await s.bookAs('P2');                  // still being searched (nobody is Online, so the engine has sent no offer)
  await internal(`DROP INDEX public.uq_dispatch_attempt_one_pending_per_booking;
                  INSERT INTO booking (booking_id, passenger_id, passenger_count, pickup_address, pickup_latitude, pickup_longitude, dropoff_address, dropoff_latitude, dropoff_longitude, booking_status)
                  VALUES ('${FINISHED}', '${ID.P2}', 1, 'A', ${PICKUP.lat}, ${PICKUP.lng}, 'B', 13.42, 121.19, 'Completed');
                  INSERT INTO dispatch_attempt (booking_id, driver_id, dispatch_method, response_status, notification_sent_at, cycle, tier, expires_at)
                  VALUES ('${FINISHED}', '${ID.D1}', 'old', 'Pending', now() - interval '1 minute', 1, 1, now() + interval '1 minute'),
                         ('${FINISHED}', '${ID.D2}', 'old', 'Pending', now(), 1, 1, now() + interval '1 minute'),
                         ('${dupBooking.booking_id}', '${ID.D1}', 'old', 'Pending', now() - interval '1 minute', 1, 1, now() + interval '1 minute'),
                         ('${dupBooking.booking_id}', '${ID.D2}', 'old', 'Pending', now(), 1, 1, now() + interval '1 minute')`);
  const rerun = await attempt(() => db.exec(migration));
  check('running the migration a second time raises nothing', rerun.ok, rerun.error);
  const closedLeftover = await one(`SELECT response_status, responded_at FROM dispatch_attempt WHERE attempt_id = '${leftoverId}'`);
  check('the migration closes a leftover offer of a finished booking (the one of S9)', closedLeftover.response_status === 'Expired' && closedLeftover.responded_at !== null, closedLeftover);
  const closedBoth = await q(`SELECT response_status FROM dispatch_attempt WHERE booking_id = '${FINISHED}'`);
  check('... and every unanswered offer of a finished booking, whatever its expiry', closedBoth.length === 2 && closedBoth.every((r) => r.response_status === 'Expired'), closedBoth);
  const left = await q(`SELECT driver_id, response_status, responded_at FROM dispatch_attempt WHERE booking_id = '${dupBooking.booking_id}' ORDER BY notification_sent_at`);
  check('a duplicate unanswered offer of a booking that is still being searched is closed (the newest of the booking is kept) before the unique index returns',
    left.length === 2 && left[0].response_status === 'Expired' && left[0].responded_at !== null && left[1].response_status === 'Pending', left);
  check('the unique index is back', (await q(`SELECT 1 FROM pg_indexes WHERE indexname = 'uq_dispatch_attempt_one_pending_per_booking'`)).length === 1);
  check('and the numbers are unchanged by the second run', (await one(`SELECT public.dispatch_constant('tier3_max_seconds') a, public.dispatch_constant('retry_max_age_minutes') b`)).a === 600);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
