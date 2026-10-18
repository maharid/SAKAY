// Batch 12 (Rules 23.1 - 23.5; T1, T2): the Average Rating is sum / n over the account's whole history from the source rows; "Not Yet Rated" is NULL, never a default; excluded
// ratings leave BOTH sum and count and only the LGU Administrator excludes one; a rating is an immutable fact; only ratings of Completed trips count; a driver under 3.00 after 20
// completed trips is flagged for the TODA (a passenger for the LGU); ratings never reach dispatch. Whole migration chain on the local emulator.
const { setup, ID, DRIVERS, PAX, attempt, check, summary } = require('../b12fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, as } = s;
  const D1 = DRIVERS.D1.id, D2 = DRIVERS.D2.id, D3 = DRIVERS.D3.id, P1 = PAX.P1.id, P2 = PAX.P2.id;
  const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.0001;

  console.log('S1 a new account is "Not Yet Rated" (T1)');
  let d = await s.drv('D1'), p = await s.pax('P1');
  check('a driver with no rating has NO average (NULL) and a count of 0 - not 4.00, not 5.0', d.avg === null && Number(d.n) === 0, d);
  check('a passenger with no rating has NO average (NULL) and a count of 0', p.avg === null && Number(p.n) === 0, p);
  const col = await one(`SELECT is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'driver' AND column_name = 'weighted_average_rating'`);
  check('the column has no NOT NULL and no default any more', col.is_nullable === 'YES' && col.column_default === null, col);
  check('the sign-up guard no longer writes 4.00 (it writes NULL)', !/:=\s*4\.00/.test((await one(`SELECT prosrc FROM pg_proc WHERE proname = 'driver_insert_guard'`)).prosrc) && /weighted_average_rating := NULL/.test((await one(`SELECT prosrc FROM pg_proc WHERE proname = 'driver_insert_guard'`)).prosrc));
  await internal(`INSERT INTO auth.users (id, email) VALUES ('50000000-0000-0000-0000-0000000000a1', 'reg@x.com')`);
  const reg = await attempt(() => as('50000000-0000-0000-0000-0000000000a1', (tx) => tx.query(
    `INSERT INTO driver (auth_user_id, full_name, contact_number, account_status, weighted_average_rating) VALUES ('50000000-0000-0000-0000-0000000000a1', 'New Registrant', '+639189990001', 'Pending Verification', 5) RETURNING weighted_average_rating, rating_count`)));
  check('a registrant who sends a rating of 5 gets none (NULL)', reg.ok && reg.value.rows[0].weighted_average_rating === null && Number(reg.value.rows[0].rating_count) === 0, reg);

  console.log('\nS2 the mean over every rating, shown from the first one');
  const t1 = await s.trip('P1', 'D1'), t2 = await s.trip('P2', 'D1'), t3 = await s.trip('P1', 'D1');
  let r = await s.rateAs('P1', t1, 4);
  check('the passenger rates the trip the way the app does (an INSERT as the passenger)', r.ok && r.value.rows.length === 1, r);
  d = await s.drv('D1');
  check('after ONE rating the average is shown: that rating (4.00, n = 1)', near(d.avg, 4) && Number(d.n) === 1, d);
  await s.rateAs('P2', t2, 5);
  d = await s.drv('D1');
  check('two ratings: (4 + 5) / 2 = 4.50', near(d.avg, 4.5) && Number(d.n) === 2, d);
  await s.rateAs('P1', t3, 1);
  d = await s.drv('D1');
  check('three ratings: (4 + 5 + 1) / 3 = 3.33 - a plain arithmetic mean, no weighting, no time window', near(d.avg, 3.33) && Number(d.n) === 3, d);
  const sum = await s.summaryOf('driver', D1);
  check('rating_summary() (the one source of truth) says sum 10, n 3', Number(sum.sum_stars) === 10 && Number(sum.n) === 3 && near(sum.average, 3.33), sum);
  const old = await s.trip('P2', 'D1', { completedAgo: '400 days' });
  await s.rate(old, 'Passenger', 5, new Date(Date.now() - 400 * 86400000).toISOString());
  d = await s.drv('D1');
  check('a rating from 400 days ago still counts (the whole history): (10 + 5) / 4 = 3.75', near(d.avg, 3.75) && Number(d.n) === 4, d);

  console.log('\nS3 a driver rates the passenger: the passenger has a mean too');
  await s.rateAs('D1', t1, 2);
  p = await s.pax('P1');
  check('the passenger P1 is rated 2.00 by a driver, n = 1', near(p.avg, 2) && Number(p.n) === 1, p);
  check('the driver rating did not touch the driver\'s own average', near((await s.drv('D1')).avg, 3.75));

  console.log('\nS4 the rating is a fact: nobody edits or deletes it, the server stamps its time');
  const row = await s.ratingOf(t1, 'Passenger');
  for (const [who, uid] of [['the rating party', ID.P_AUTH], ['the rated driver', ID.D_AUTH], ['the LGU Administrator', ID.L_AUTH], ['the TODA Administrator', ID.T_AUTH]]) {
    const u = await attempt(() => as(uid, (tx) => tx.query(`UPDATE rating SET stars = 5 WHERE rating_id = '${row.rating_id}'`)));
    const dl = await attempt(() => as(uid, (tx) => tx.query(`DELETE FROM rating WHERE rating_id = '${row.rating_id}'`)));
    check(`${who} cannot UPDATE or DELETE a rating`, !u.ok && !dl.ok && /permission denied|row-level/i.test(u.error + dl.error), { u: u.error, dl: dl.error });
  }
  const tamper = await attempt(() => internal(`UPDATE rating SET stars = 5 WHERE rating_id = '${row.rating_id}'`));
  check('even a trusted session cannot change the stars of a rating (ERR_RATING_IMMUTABLE)', !tamper.ok && /ERR_RATING_IMMUTABLE/.test(tamper.error), tamper);
  check('the stars are unchanged', Number((await s.ratingOf(t1, 'Passenger')).stars) === 4);
  const hostile = await s.rateAs('D1', t2, 5, { createdAt: '2020-01-01T00:00:00Z', isExcluded: true });
  const hostileRow = await s.ratingOf(t2, 'Driver');
  check('a rating sent with a back-dated time and is_excluded = true: the server\'s time is stored and it is not excluded',
    hostile.ok && Math.abs(Date.now() - new Date(hostileRow.created_at).getTime()) < 120000 && hostileRow.is_excluded === false, hostileRow);
  const dup = await s.rateAs('D1', t2, 1);
  check('rating the same trip again changes nothing (one rating per rater per trip)', dup.ok && dup.value.rows.length === 0 && Number((await s.ratingOf(t2, 'Driver')).stars) === 5, dup);
  const cacheWrite = await attempt(() => as(ID.D_AUTH, (tx) => tx.query(`UPDATE driver SET weighted_average_rating = 5, rating_count = 99 WHERE driver_id = '${D1}'`)));
  check('a driver cannot write their own average or count', !cacheWrite.ok, cacheWrite);
  const cacheWrite2 = await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`UPDATE passenger SET average_rating = 5, rating_count = 99 WHERE passenger_id = '${P1}'`)));
  check('a passenger cannot write their own average or count', !cacheWrite2.ok && /written by the system/i.test(cacheWrite2.error), cacheWrite2);
  const stranger = await s.rateAs('P2', t1, 1);
  check('a passenger who was not on the trip cannot rate it (the insert is refused)', !stranger.ok || stranger.value.rows.length === 0, stranger);

  console.log('\nS5 exclusion (Rule 23.5): only the LGU Administrator, with a reason; sum and count both change (T1)');
  const target = await s.ratingOf(t3, 'Passenger');       // the 1-star
  let ex = await attempt(() => s.rpcAs(ID.T_AUTH, 'public.admin_exclude_rating($1, TRUE, $2)', [target.rating_id, 'The passenger retaliated after a complaint.']));
  check('the TODA Administrator cannot exclude a rating', !ex.ok && /Access Denied/.test(ex.error), ex);
  ex = await attempt(() => s.rpcAs(ID.P_AUTH, 'public.admin_exclude_rating($1, TRUE, $2)', [target.rating_id, 'The passenger retaliated after a complaint.']));
  check('a passenger cannot exclude a rating', !ex.ok && /Access Denied/.test(ex.error), ex);
  ex = await attempt(() => s.lguCall('admin_exclude_rating($1, TRUE, $2)', [target.rating_id, 'short']));
  check('the LGU Administrator must give a reason of at least 10 characters', !ex.ok && /ERR_RATING_EXCLUDE_REASON/.test(ex.error), ex);
  ex = await attempt(() => s.lguCall('admin_exclude_rating($1, TRUE, $2)', ['00000000-0000-4000-8000-00000000dead', 'Retaliation found by the investigation.']));
  check('an unknown rating is refused', !ex.ok && /ERR_RATING_NOT_FOUND/.test(ex.error), ex);
  const before = await s.summaryOf('driver', D1);
  ex = await attempt(() => s.lguCall('admin_exclude_rating($1, TRUE, $2)', [target.rating_id, 'Retaliation found by the investigation of 2026-10-14.']));
  check('the LGU Administrator excludes the 1-star rating', ex.ok && ex.value.success === true && ex.value.changed === true, ex);
  const after = await s.summaryOf('driver', D1);
  check('the sum drops by 1 AND the count drops by 1 (15 / 4 becomes 14 / 3)', Number(before.sum_stars) - Number(after.sum_stars) === 1 && Number(before.n) - Number(after.n) === 1, { before, after });
  d = await s.drv('D1');
  check('the cached average follows at once: (4 + 5 + 5) / 3 = 4.67 from 3 ratings', near(d.avg, 4.67) && Number(d.n) === 3, d);
  const audit = await s.auditOf('RATING_EXCLUDED', target.rating_id);
  check('the exclusion is in the audit log with the acting LGU Administrator, the reason, before and after',
    audit.length === 1 && audit[0].actor_role === 'lgu_admin' && audit[0].actor_id === ID.L_AUTH && /Retaliation found/.test(audit[0].details) && audit[0].before_state.is_excluded === false && audit[0].after_state.is_excluded === true && audit[0].performed_at !== null, audit);
  ex = await s.lguCall('admin_exclude_rating($1, TRUE, $2)', [target.rating_id, 'Retaliation found by the investigation of 2026-10-14.']);
  check('doing it twice is harmless (idempotent) and writes no second entry', ex.success === true && ex.changed === false && (await s.auditOf('RATING_EXCLUDED', target.rating_id)).length === 1, ex);
  const exRow = await s.ratingOf(t3, 'Passenger');
  check('the row stays (history) and says it is excluded, with the time', exRow.is_excluded === true && exRow.excluded_at !== null && Number(exRow.stars) === 1, exRow);
  ex = await s.lguCall('admin_exclude_rating($1, FALSE, $2)', [target.rating_id, 'The appeal was granted: the rating counts again.']);
  d = await s.drv('D1');
  check('counting it again restores the mean: 3.75 from 4 ratings', ex.changed === true && near(d.avg, 3.75) && Number(d.n) === 4, { ex, d });
  await s.lguCall('admin_exclude_rating($1, TRUE, $2)', [target.rating_id, 'Excluded again after the second review.']);

  console.log('\nS6 a deleted rating leaves the mean too (no stale cache), and only Completed trips count');
  const t5 = await s.trip('P2', 'D3');
  await s.rate(t5, 'Passenger', 2);
  check('D3 has one rating of 2', near((await s.drv('D3')).avg, 2) && Number((await s.drv('D3')).n) === 1);
  await internal(`DELETE FROM rating WHERE booking_id = '${t5}' AND rater_role = 'Passenger'`);
  d = await s.drv('D3');
  check('after the row is deleted the cache says Not Yet Rated again (NULL, 0)', d.avg === null && Number(d.n) === 0, d);
  const a1 = await s.arrivedTrip('P2', 'D3');
  await s.rateAs('P2', a1, 1);
  d = await s.drv('D3');
  check('a rating given when the trip has only ARRIVED does not count yet', d.avg === null && Number(d.n) === 0, d);
  await s.complete(a1);
  d = await s.drv('D3');
  check('it counts the moment the trip becomes Completed (the cache follows the booking too)', near(d.avg, 1) && Number(d.n) === 1, d);
  const trg = await one(`SELECT pg_get_triggerdef(t.oid) AS def FROM pg_trigger t WHERE t.tgname = 'trigger_booking_rating_refresh'`);
  check('the booking trigger also fires when a trip stops being Completed (OLD status), so the cache cannot keep a rating that no longer counts', /old\.booking_status\)::text = 'Completed'/i.test(trg.def) && /new\.booking_status\)::text = 'Completed'/i.test(trg.def), trg);

  console.log('\nS7 under 3.00 after 20 completed trips: 19 trips no flag, the 20th trip a flag for the TODA (T2)');
  // driver D2: 19 completed trips, every one rated by its passenger: 19 ratings with a sum of 55 (mean 2.89, under 3.00)
  const stars19 = [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2];     // sum 55
  const trips = [];
  for (let i = 0; i < 19; i++) {
    const b = await s.arrivedTrip(i % 2 ? 'P1' : 'P2', 'D2');
    await s.rate(b, 'Passenger', stars19[i]);
    await s.complete(b);
    trips.push(b);
  }
  d = await s.drv('D2');
  check('after 19 completed trips the mean is 2.89 from 19 ratings', near(d.avg, 2.89) && Number(d.n) === 19, d);
  check('19 completed trips with a mean of 2.89: NO flag (the review waits for 20 trips, Rule 23.3)', (await s.flagsOf('DRIVER_LOW_RATING_REVIEW', D2)).length === 0);
  const b20 = await s.arrivedTrip('P1', 'D2');
  await s.rate(b20, 'Passenger', 3);
  check('the 20th trip has only arrived: still no flag', (await s.flagsOf('DRIVER_LOW_RATING_REVIEW', D2)).length === 0);
  await s.complete(b20);
  d = await s.drv('D2');
  check('the 20th trip completes: the mean is 2.90 from 20 ratings', near(d.avg, 2.9) && Number(d.n) === 20, d);
  const flags = await s.openFlags('DRIVER_LOW_RATING_REVIEW', D2);
  check('the driver is FLAGGED for review: one flag, source Rule 23.3, assigned to the TODA Administrator', flags.length === 1 && flags[0].source_rule === 'Rule 23.3' && flags[0].assigned_role === 'toda_admin', flags);
  check('the flag carries the evidence: 20 trips, 20 ratings, sum 58, average 2.90', flags[0].details.completed_trips === 20 && flags[0].details.rating_count === 20 && flags[0].details.sum_stars === 58 && near(flags[0].details.average, 2.9), flags[0].details);
  const seen1 = await as(ID.T_AUTH, (tx) => tx.query(`SELECT flag_id FROM admin_review_flag WHERE flag_type = 'DRIVER_LOW_RATING_REVIEW'`));
  const seen2 = await as(ID.T2_AUTH, (tx) => tx.query(`SELECT flag_id FROM admin_review_flag WHERE flag_type = 'DRIVER_LOW_RATING_REVIEW'`));
  const seenL = await as(ID.L_AUTH, (tx) => tx.query(`SELECT flag_id FROM admin_review_flag WHERE flag_type = 'DRIVER_LOW_RATING_REVIEW'`));
  check('TODA One\'s administrator sees it (the driver is theirs), TODA Two\'s does not, the LGU does', seen1.rows.length === 1 && seen2.rows.length === 0 && seenL.rows.length === 1, { a: seen1.rows.length, b: seen2.rows.length, c: seenL.rows.length });
  const more = await s.trip('P2', 'D2');
  await s.rate(more, 'Passenger', 1);
  check('more trips and ratings while the flag is open: still ONE open flag (idempotent)', (await s.openFlags('DRIVER_LOW_RATING_REVIEW', D2)).length === 1);
  check('the flag is a flag only: the driver is not struck, suspended or restricted', (await s.strikesOf(D2)).length === 0 && (await s.restriction('driver', D2)).restricted === false);
  const resolved = await attempt(() => as(ID.T_AUTH, (tx) => tx.query(`SELECT public.resolve_admin_review_flag($1, 'Resolved', 'Counselled the driver on 2026-10-16.') AS r`, [flags[0].flag_id])));
  check('the TODA Administrator resolves it with a note', resolved.ok && resolved.value.rows[0].r.success === true, resolved);
  await s.complete(await s.arrivedTrip('P1', 'D2'));
  check('a reviewed driver is not flagged again at the very next trip', (await s.openFlags('DRIVER_LOW_RATING_REVIEW', D2)).length === 0);
  for (let i = 0; i < 20; i++) {
    const b = await s.arrivedTrip('P1', 'D2');
    await s.complete(b);
  }
  check('...only after 20 MORE completed trips, if the average is still under 3.00', (await s.openFlags('DRIVER_LOW_RATING_REVIEW', D2)).length === 1);

  console.log('\nS8 the comparison is exact: sum x 100 < 300 x n, not the rounded figure');
  await internal(`DELETE FROM rating WHERE ratee_id = '${D3}'`);
  check('D3 is unrated again before this section', (await s.drv('D3')).avg === null);
  const e = [];
  for (let i = 0; i < 20; i++) {
    const b = await s.arrivedTrip(i % 2 ? 'P1' : 'P2', 'D3');
    await s.complete(b);
    e.push(b);
  }
  for (const stars of [3, 3, 3]) await s.rate(e.shift(), 'Passenger', stars);
  check('D3: 20 trips, three ratings of 3: mean exactly 3.00 - no flag', (await s.flagsOf('DRIVER_LOW_RATING_REVIEW', D3)).length === 0);
  const heavy = [];
  for (let i = 0; i < 3; i++) heavy.push(await s.trip('P1', 'D3'));
  for (const [b, stars] of [[heavy[0], 4], [heavy[1], 2]]) await s.rate(b, 'Passenger', stars);
  check('D3: ratings 3,3,3,4,2 - the mean is still exactly 3.00: no flag', (await s.flagsOf('DRIVER_LOW_RATING_REVIEW', D3)).length === 0 && near((await s.drv('D3')).avg, 3));
  await s.rate(heavy[2], 'Passenger', 2);
  const d3 = await s.drv('D3');
  check('D3: one more rating of 2 (3,3,3,4,2,2: 17 / 6 = 2.83) - flagged', near(d3.avg, 2.83) && (await s.openFlags('DRIVER_LOW_RATING_REVIEW', D3)).length === 1, d3);
  const nearMiss = await one(`SELECT (59 * 100 < 300 * 20) AS under, (60 * 100 < 300 * 20) AS equal`);
  check('59 / 20 is under 3.00 and 60 / 20 is not, in integers', nearMiss.under === true && nearMiss.equal === false, nearMiss);

  console.log('\nS9 a passenger under 3.00 after 20 completed trips: a flag for the LGU, and the LGU may send a warning (Rule 23.4)');
  await internal(`DELETE FROM rating WHERE ratee_id = '${P2}'`);
  // passenger P2: rated 2 by drivers on 20 trips (7 with D1, 7 with D2, 6 with D3)
  const pt = [];
  for (let i = 0; i < 20; i++) {
    const b = await s.arrivedTrip('P2', ['D1', 'D2', 'D3'][i % 3]);
    await s.rate(b, 'Driver', 2);
    await s.complete(b);
    pt.push(b);
  }
  const pf = await s.openFlags('PASSENGER_LOW_RATING_REVIEW', P2);
  check('the passenger is flagged: one flag, Rule 23.4, assigned to the LGU Administrator', pf.length === 1 && pf[0].source_rule === 'Rule 23.4' && pf[0].assigned_role === 'lgu_admin' && pf[0].details.completed_trips >= 20, pf);
  check('no TODA Administrator sees a passenger\'s flag', (await as(ID.T_AUTH, (tx) => tx.query(`SELECT 1 FROM admin_review_flag WHERE flag_type = 'PASSENGER_LOW_RATING_REVIEW'`))).rows.length === 0);
  check('the passenger is not blocked: booking eligibility is untouched (no restriction, no strike)', (await s.restriction('passenger', P2)).restricted === false && (await s.strikesOf(P2)).length === 0);
  let w = await attempt(() => as(ID.T_AUTH, (tx) => tx.query(`SELECT public.admin_send_conduct_warning($1, 'Please keep the conduct we ask of every rider.')`, [pf[0].flag_id])));
  check('a TODA Administrator cannot send the warning', !w.ok && /Access Denied/.test(w.error), w);
  w = await attempt(() => s.lguCall('admin_send_conduct_warning($1, $2)', [pf[0].flag_id, 'short']));
  check('the warning needs a real message', !w.ok && /ERR_WARNING_MESSAGE/.test(w.error), w);
  w = await s.lguCall('admin_send_conduct_warning($1, $2)', [pf[0].flag_id, 'Several drivers rated your trips low. Please keep to our rules of conduct.']);
  const notes = await q(`SELECT * FROM notification WHERE passenger_id = '${P2}' AND notification_type = 'CONDUCT_WARNING'`);
  check('the LGU Administrator sends the warning: a notice reaches the passenger, the flag is resolved, the audit says who', w.success === true && notes.length === 1 && (await s.openFlags('PASSENGER_LOW_RATING_REVIEW', P2)).length === 0 && (await s.auditOf('PASSENGER_WARNING_SENT', P2)).length === 1, { w, notes: notes.length });

  console.log('\nS10 ratings never reach dispatch or booking eligibility (Rule 23.2)');
  const readers = await q(`SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace
      AND prosrc ~* 'weighted_average_rating|average_rating|rating_summary|rating_count'
      AND proname !~ '^(rating|_rating|_refresh_rating|admin_exclude|_set_rating|booking_rating|protect_rating|driver_insert_guard|protect_read_only|get_assigned_driver_details|list_drivers|_integrity|run_integrity|admin_send_conduct)'`);
  const allowed = new Set(['protect_read_only_columns', 'get_assigned_driver_details', 'anonymize_closed_accounts']);
  const stray = readers.map((x) => x.proname).filter((n) => !allowed.has(n));
  check('no dispatch, offer, eligibility or booking function reads a rating', stray.length === 0, stray);
  const dispatchFns = (await q(`SELECT proname, prosrc FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname ~ '(dispatch|eligib|offer|booking_identity|accept_booking)'`));
  check('(' + dispatchFns.length + ' dispatch functions inspected) none mentions a rating', dispatchFns.length > 5 && dispatchFns.every((f) => !/rating/i.test(f.prosrc.replace(/rating-?\s*(changes|is)/ig, ''))), dispatchFns.filter((f) => /rating/i.test(f.prosrc)).map((f) => f.proname));
  await s.online('D1', 300);
  await s.online('D2', 600);
  const b = await s.bookAs('P1');
  const offer = await s.pendingOffer(b.booking_id);
  check('D1 (3.75) is nearer than D2 (under 3.00, flagged): D1 is offered the trip first', offer && offer.driver_id === D1, offer);
  await s.finish(b.booking_id);
  await s.moveTo('D1', 600);
  await s.moveTo('D2', 300);
  const b2 = await s.bookAs('P1');
  const offer2 = await s.pendingOffer(b2.booking_id);
  check('with the distances swapped the LOWER-rated, flagged D2 is offered first: the nearer driver wins, the rating plays no part', offer2 && offer2.driver_id === D2, offer2);

  const ok = summary();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
