// Batch 5: the recorded trip distance (Rule 6.2, figures F5.1 / F5.2) and the route-deviation ledger (6.2.3 / 6.2.4).
//   A  replaying the GPS track: accuracy, teleports, jitter, crawling, gaps, duplicates
//   B  driver_heartbeat logs the driver's fixes while a passenger is on board, and nothing else writes the track
//   C  the final fare from the track: within tolerance -> the estimate; beyond it -> the actual distance + a ledger row;
//      a shorter distance is only believed when the track is complete
const { setup, check, summary } = require('../b5fixtures');

(async () => {
  const t = await setup();
  const { as, anon, svc, q, one, book, assign, setStatus, getBooking, logTrack, rpc, goOnline, attempt, num, ID, PICKUP, DROPOFF, db } = t;
  const err = (a) => (a.ok ? 'no error' : a.error);
  const done = (id) => svc((tx) => tx.query(`UPDATE public.booking SET booking_status = 'Completed' WHERE booking_id = $1`, [id]));
  const trackOf = async (id, dest = null) => (await one(`SELECT public._trip_track_summary($1, $2, $3) AS r`, [id, dest ? dest.lat : null, dest ? dest.lng : null])).r;
  const STEP = 0.00045;                                   // degrees of latitude = about 50.04 m
  const LEG = 99 * 50.038 / 1000;                         // a 100-fix track is about 4.954 km
  const endOf = (n) => ({ lat: PICKUP.lat + STEP * (n - 1), lng: PICKUP.lng });
  // A booking row to hang a track on (trusted insert; the track tests do not need the fare flow).
  const holder = async () => {
    const id = (await one(`SELECT gen_random_uuid() AS id`)).id;
    await svc((tx) => tx.query(`INSERT INTO public.booking (booking_id, passenger_id, driver_id, passenger_count, pickup_address, pickup_latitude, pickup_longitude, dropoff_address, dropoff_latitude, dropoff_longitude, booking_status) VALUES ($1, $2, $3, 1, 'A', 13.4115, 121.1803, 'B', 13.4415, 121.1803, 'Completed')`, [id, ID.P1, ID.D1]));
    return id;
  };
  const near = (v, expected, tolKm = 0.012) => Math.abs(num(v) - expected) <= tolKm;

  console.log('A  Replaying the GPS track (figure F5.1)');
  let h = await holder();
  await logTrack(h, ID.D1, { n: 100 });
  let s = await trackOf(h);
  check(`a clean 100-fix track along a road: about ${LEG.toFixed(3)} km, every fix used`, near(s.distance_km, LEG) && s.fixes_usable === 100 && s.rejected_accuracy === 0 && s.rejected_speed === 0 && s.gap_flag === false, s);
  const again = await trackOf(h);
  check('replaying twice gives the identical answer (a pure function of the rows)', JSON.stringify(again) === JSON.stringify(s));

  h = await holder();
  await db.query(`INSERT INTO public.gps_log (booking_id, driver_id, latitude, longitude, accuracy, recorded_at)
    SELECT $1, $2, $3::float8 + CASE WHEN i % 2 = 0 THEN 0.0001 ELSE -0.0001 END, $4::float8, 20, '2026-10-07T01:00:00Z'::timestamptz + (i * 5) * interval '1 second'
    FROM generate_series(0, 119) AS i`, [h, ID.D1, PICKUP.lat, PICKUP.lng]);
  s = await trackOf(h);
  check('10 minutes standing still with the position wandering +-11 m (accuracy 20): 0 km, not 100s of metres', num(s.distance_km) === 0 && s.fixes_usable === 120, s);

  h = await holder();
  // pseudo-random jitter, up to +-11 m on each axis, accuracy 15 (the same sequence gives 772 m with a dead-band
  // measured against the fix's own accuracy alone; two overlapping error circles cannot show movement)
  await db.query(`INSERT INTO public.gps_log (booking_id, driver_id, latitude, longitude, accuracy, recorded_at)
    SELECT $1, $2,
           $3::float8 + ((sin(i * 12.9898 + 78.233) * 43758.5453) - floor(sin(i * 12.9898 + 78.233) * 43758.5453) - 0.5) * 2 * 0.0001,
           $4::float8 + ((sin(i * 39.346 + 11.135) * 43758.5453) - floor(sin(i * 39.346 + 11.135) * 43758.5453) - 0.5) * 2 * 0.0001,
           15, '2026-10-07T01:00:00Z'::timestamptz + (i * 5) * interval '1 second'
    FROM generate_series(0, 119) AS i`, [h, ID.D1, PICKUP.lat, PICKUP.lng]);
  s = await trackOf(h);
  check('10 minutes standing still with random jitter (accuracy 15): under 50 m of phantom distance (the naive dead-band gives 772 m)', num(s.distance_km) < 0.05 && s.fixes_usable === 120, s);

  h = await holder();
  await logTrack(h, ID.D1, { n: 100, stepDeg: 0.00006295, accuracy: 5 });   // 7 m per 5 s = 5 km/h crawl: 693 m
  s = await trackOf(h);
  check('a 5 km/h crawl (7 m per beat) is still measured, in dead-band chunks: 0.67 - 0.70 km (true 0.693)', num(s.distance_km) >= 0.67 && num(s.distance_km) <= 0.70, s);

  h = await holder();
  await logTrack(h, ID.D1, { n: 20, skip: [10] });
  await db.query(`INSERT INTO public.gps_log (booking_id, driver_id, latitude, longitude, accuracy, recorded_at) VALUES ($1, $2, $3, $4, 10, '2026-10-07T01:00:00Z'::timestamptz + 50 * interval '1 second')`, [h, ID.D1, PICKUP.lat + STEP * 10 + 0.045, PICKUP.lng]);
  s = await trackOf(h);
  check('one fix that jumps 5 km in 5 s is discarded as a teleport; the trip distance is unchanged (19 steps = 0.951 km)', s.rejected_speed === 1 && near(s.distance_km, 0.9507), s);

  h = await holder();
  // fixes 0-9 near the pickup, then the "reference" itself turns out wrong: everything from 10 on is 5 km away
  await db.query(`INSERT INTO public.gps_log (booking_id, driver_id, latitude, longitude, accuracy, recorded_at)
    SELECT $1, $2, $3::float8 + i * $4::float8 + CASE WHEN i >= 10 THEN 0.045 ELSE 0 END, $5::float8, 10, '2026-10-07T01:00:00Z'::timestamptz + (i * 5) * interval '1 second'
    FROM generate_series(0, 29) AS i`, [h, ID.D1, PICKUP.lat, STEP, PICKUP.lng]);
  s = await trackOf(h);
  check('after 3 teleports in a row the reference point is replaced, so the track recovers; the 5 km jump is never billed (0.45 + 0.85 km)', s.rejected_speed === 3 && near(s.distance_km, 1.3009, 0.02), s);

  h = await holder();
  await db.query(`INSERT INTO public.gps_log (booking_id, driver_id, latitude, longitude, accuracy, recorded_at)
    SELECT $1, $2, $3::float8 + i * $4::float8, $5::float8, CASE WHEN i % 2 = 0 THEN 80 ELSE 10 END, '2026-10-07T01:00:00Z'::timestamptz + (i * 5) * interval '1 second'
    FROM generate_series(0, 39) AS i`, [h, ID.D1, PICKUP.lat, STEP, PICKUP.lng]);
  s = await trackOf(h);
  check('fixes with accuracy worse than 50 m are ignored (20 of 40); the rest are used', s.rejected_accuracy === 20 && s.fixes_usable === 20, s);

  h = await holder();
  await logTrack(h, ID.D1, { n: 40, skip: [10, 11, 12, 13, 14] });
  s = await trackOf(h);
  check('a 30 s silence is not yet a gap', s.gap_flag === false && num(s.max_gap_seconds) === 30, s);
  h = await holder();
  await logTrack(h, ID.D1, { n: 40, skip: [10, 11, 12, 13, 14, 15] });
  s = await trackOf(h);
  check('a 35 s silence flags the track', s.gap_flag === true && num(s.max_gap_seconds) === 35, s);

  h = await holder();
  await logTrack(h, ID.D1, { n: 30 });
  await logTrack(h, ID.D1, { n: 30 });                    // every row sent twice (a repeated heartbeat / double tap)
  s = await trackOf(h);
  check('duplicate rows add nothing (29 steps = 1.451 km)', near(s.distance_km, 1.4511), s);

  h = await holder();
  await logTrack(h, ID.D1, { n: 30 });
  const fwd = await trackOf(h);
  h = await holder();
  await db.query(`INSERT INTO public.gps_log (booking_id, driver_id, latitude, longitude, accuracy, recorded_at)
    SELECT $1, $2, $3::float8 + i * $4::float8, $5::float8, 10, '2026-10-07T01:00:00Z'::timestamptz + (i * 5) * interval '1 second'
    FROM generate_series(29, 0, -1) AS i`, [h, ID.D1, PICKUP.lat, STEP, PICKUP.lng]);
  const rev = await trackOf(h);
  check('rows that arrive out of order give the same distance (they are replayed by time)', JSON.stringify(rev) === JSON.stringify(fwd), { fwd, rev });

  s = await trackOf(await holder());
  check('a booking with no fixes: 0 usable fixes, 0 km', s.fixes_total === 0 && s.fixes_usable === 0 && num(s.distance_km) === 0, s);

  h = await holder();
  await logTrack(h, ID.D1, { n: 60 });
  s = await trackOf(h, endOf(100));
  check('the track reports how far from the destination it ended (60 of 100 fixes = about 2.0 km short)', near(s.end_distance_to_destination_m, 1982, 30), s);

  console.log('\nB  The track is written by the database only');
  const Bk = await book(ID.P_AUTH, ID.P1, { km: 5 });
  await assign(Bk.booking_id, ID.D1);
  let r = await goOnline(ID.D_AUTH);
  check('(setup) the driver is Online', r.success === true, r);
  const logged = async () => (await q(`SELECT * FROM public.gps_log WHERE booking_id = $1 ORDER BY recorded_at`, [Bk.booking_id]));
  r = await rpc(ID.D_AUTH, 'driver_heartbeat', [13.4120, 121.1805, 12]);
  check('(before the passenger boards: status Accepted) the heartbeat publishes the position but logs no trip point', r.success === true && r.location_accepted === true && (await logged()).length === 0, r);
  await setStatus(ID.D_AUTH, Bk.booking_id, 'Trip Ongoing');
  r = await rpc(ID.D_AUTH, 'driver_heartbeat', [13.4125, 121.1806, 12]);
  let rows = await logged();
  check('with the passenger on board (Trip Ongoing) every published fix is logged against the booking, with its accuracy',
    r.location_accepted === true && rows.length === 1 && rows[0].driver_id === ID.D1 && num(rows[0].accuracy) === 12 && num(rows[0].latitude) === 13.4125, rows);
  r = await rpc(ID.D_AUTH, 'driver_heartbeat', [13.4130, 121.1807, 80]);
  check('a fix between 50 and 100 m accuracy is published and logged (the replay will ignore it)', r.location_accepted === true && (await logged()).length === 2 && num((await logged())[1].accuracy) === 80, r);
  r = await rpc(ID.D_AUTH, 'driver_heartbeat', [13.4135, 121.1808, 120]);
  check('a fix worse than 100 m is not published and not logged (Batch 4 rule unchanged)', r.location_accepted === false && r.location_rejected_reason === 'low_accuracy' && (await logged()).length === 2, r);
  r = await rpc(ID.D_AUTH, 'driver_heartbeat', []);
  check('a heartbeat with no position still proves presence and logs nothing', r.success === true && (await logged()).length === 2, r);

  const direct = [
    ['INSERT', `INSERT INTO public.gps_log (booking_id, driver_id, latitude, longitude, accuracy) VALUES ('${Bk.booking_id}', '${ID.D1}', 13.4, 121.1, 5)`],
    ['UPDATE', `UPDATE public.gps_log SET latitude = 0`],
    ['DELETE', `DELETE FROM public.gps_log`],
  ];
  for (const [label, uid, isAnon] of [['the driver', ID.D_AUTH], ['the passenger', ID.P_AUTH], ['the LGU administrator', ID.L_AUTH], ['an anonymous caller', null, true]]) {
    const bad = [];
    for (const [verb, sql] of direct) {
      const a = await attempt(() => (isAnon ? anon((tx) => tx.query(sql)) : as(uid, (tx) => tx.query(sql))));
      if (a.ok || !/permission denied/.test(a.error)) bad.push({ verb, got: err(a) });
    }
    check(`${label} cannot forge, edit or delete track points`, bad.length === 0, bad);
  }
  const seen = async (uid) => (await as(uid, (tx) => tx.query(`SELECT count(*)::int n FROM public.gps_log WHERE booking_id = $1`, [Bk.booking_id]))).rows[0].n;
  check('the passenger and the driver see the trip\'s points; another passenger sees none',
    (await seen(ID.P_AUTH)) === 2 && (await seen(ID.D_AUTH)) === 2 && (await seen(ID.P2_AUTH)) === 0);
  check('an unrelated driver and a TODA administrator see none; the LGU administrator sees them', (await seen(ID.D2_AUTH)) === 0 && (await seen(ID.T_AUTH)) === 0 && (await seen(ID.L_AUTH)) === 2);
  const an = await attempt(() => anon((tx) => tx.query(`SELECT count(*) FROM public.gps_log`)));
  check('an anonymous caller cannot read the tracks at all (they used to be public)', !an.ok && /permission denied/.test(an.error), err(an));

  const arrivedB = await setStatus(ID.D_AUTH, Bk.booking_id, 'Arrived at Destination');
  await rpc(ID.D_AUTH, 'driver_heartbeat', [13.4140, 121.1809, 12]);
  check('once the fare is locked the heartbeat stops logging for that booking', (await logged()).length === 2 && arrivedB.fare_locked_at !== null);
  await done(Bk.booking_id);
  await rpc(ID.D_AUTH, 'driver_go_offline', []);

  console.log('\nC  The final fare from the track (figure F5.2): estimate unless the trip really differs');
  // A full flow for one booking: book -> accept -> board -> (track) -> arrive. Returns the arrived row and the ledger.
  const flow = async ({ km, dropoff = DROPOFF, track = null, custom = null }) => {
    const b = await book(ID.P_AUTH, ID.P1, { km, dropoff });
    await assign(b.booking_id, ID.D1);
    await setStatus(ID.D_AUTH, b.booking_id, 'Trip Ongoing');
    if (track) await logTrack(b.booking_id, ID.D1, track);
    if (custom) await custom(b.booking_id);
    const fin = await setStatus(ID.D_AUTH, b.booking_id, 'Arrived at Destination');
    const ledger = await q(`SELECT * FROM public.fare_adjustment_history WHERE booking_id = $1`, [b.booking_id]);
    await done(b.booking_id);
    return { b, fin, ledger, f: fin.fare_breakdown.final };
  };

  let x = await flow({ km: 5, dropoff: endOf(100), track: { n: 100 } });
  check('A track within the tolerance (4.95 km recorded vs 5.0 estimated): the estimate stands, 72, no deviation, no ledger row',
    num(x.fin.actual_fare) === 72 && x.f.distance_basis === 'estimate_within_tolerance' && x.f.deviation === false && x.ledger.length === 0, x.f);
  check('...and the recorded distance is stored (about 4.95 km) for the trip history', near(x.fin.actual_distance_km, LEG), x.fin.actual_distance_km);
  check('tolerance for a 5 km trip is 0.75 km (15% beats the 0.5 km floor)', num(x.f.tolerance_km) === 0.75, x.f);

  x = await flow({ km: 3.5, track: { n: 100 } });
  check('A driver who covered 4.95 km on a 3.5 km route (tolerance 0.525): the fare follows the ACTUAL distance, 72 instead of 66',
    num(x.b.estimated_fare) === 66 && num(x.fin.actual_fare) === 72 && x.f.distance_basis === 'actual_distance' && x.f.deviation === true, { est: x.b.estimated_fare, fin: x.fin.actual_fare, f: x.f });
  check('the estimate on the booking is untouched (what the passenger accepted stays on record)', num((await getBooking(x.b.booking_id)).estimated_fare) === 66);
  check('Rule 6.2.4: the deviation is recorded - previous 66, new 72, estimated 3.5, actual about 4.95, direction longer, written by the system',
    x.ledger.length === 1 && x.ledger[0].reason_code === 'ROUTE_DEVIATION' && num(x.ledger[0].previous_fare) === 66 && num(x.ledger[0].new_fare) === 72
      && num(x.ledger[0].estimated_distance_km) === 3.5 && near(x.ledger[0].actual_distance_km, LEG) && x.ledger[0].details.direction === 'longer' && x.ledger[0].actor_role === 'system', x.ledger);
  const ledgerId = x.ledger[0].adjustment_id;
  const lv = async (run) => (await run((tx) => tx.query(`SELECT count(*)::int n FROM public.fare_adjustment_history WHERE adjustment_id = $1`, [ledgerId]))).rows[0].n;
  check('the passenger, the driver and the LGU administrator can read that ledger row; another passenger and an unrelated driver cannot',
    (await lv((fn) => as(ID.P_AUTH, fn))) === 1 && (await lv((fn) => as(ID.D_AUTH, fn))) === 1 && (await lv((fn) => as(ID.L_AUTH, fn))) === 1
      && (await lv((fn) => as(ID.P2_AUTH, fn))) === 0 && (await lv((fn) => as(ID.D2_AUTH, fn))) === 0);
  const lbad = [];
  for (const [label, run] of [['passenger', (fn) => as(ID.P_AUTH, fn)], ['driver', (fn) => as(ID.D_AUTH, fn)], ['LGU administrator', (fn) => as(ID.L_AUTH, fn)], ['anonymous', (fn) => anon(fn)]]) {
    for (const sql of [`UPDATE public.fare_adjustment_history SET new_fare = 1`, `DELETE FROM public.fare_adjustment_history`, `INSERT INTO public.fare_adjustment_history (booking_id, reason_code, previous_fare, new_fare) VALUES ('${x.b.booking_id}', 'ADMIN_CORRECTION', 1, 1)`]) {
      const a = await attempt(() => run((tx) => tx.query(sql)));
      if (a.ok || !/permission denied/.test(a.error)) lbad.push({ label, sql: sql.slice(0, 30), got: err(a) });
    }
  }
  check('nobody can write, edit or delete the ledger from a client', lbad.length === 0, lbad);

  x = await flow({ km: 6.5, dropoff: endOf(100), track: { n: 100 } });
  check('A shorter trip than estimated (4.95 vs 6.5 km) whose track REACHES the destination is believed: 72 instead of 78, recorded as a deviation',
    num(x.b.estimated_fare) === 78 && num(x.fin.actual_fare) === 72 && x.f.distance_basis === 'actual_distance' && x.ledger.length === 1 && x.ledger[0].details.direction === 'shorter' && num(x.ledger[0].previous_fare) === 78, { fin: x.fin.actual_fare, f: x.f, ledger: x.ledger });

  x = await flow({ km: 6.5, dropoff: endOf(100), track: { n: 100, skip: [40, 41, 42, 43, 44, 45, 46, 47] } });
  check('...but with a hole in the track (45 s without a fix) it cannot prove the trip was shorter: the estimate is kept, 78, no ledger row',
    num(x.fin.actual_fare) === 78 && x.f.distance_basis === 'estimate_kept_incomplete_track' && x.f.track.gap_flag === true && x.ledger.length === 0, x.f);

  x = await flow({ km: 6.5, dropoff: endOf(100), track: { n: 60 } });
  check('...or when the track stops 2 km short of the destination (early end is Batch 9\'s to rule on): the estimate is kept, 78',
    num(x.fin.actual_fare) === 78 && x.f.distance_basis === 'estimate_kept_incomplete_track' && x.ledger.length === 0 && num(x.f.track.end_distance_to_destination_m) > 1500, x.f);

  x = await flow({ km: 5, dropoff: endOf(100), custom: (id) => db.query(`INSERT INTO public.gps_log (booking_id, driver_id, latitude, longitude, accuracy, recorded_at)
      SELECT $1, $2, $3::float8 + CASE WHEN i % 2 = 0 THEN 0.0001 ELSE -0.0001 END, $4::float8, 20, '2026-10-07T01:00:00Z'::timestamptz + (i * 5) * interval '1 second' FROM generate_series(0, 119) AS i`, [id, ID.D1, PICKUP.lat, PICKUP.lng]) });
  check('A driver who never moved (GPS jitter only, 3.3 km short of the destination) is not billed a 0 km fare: the estimate is kept, 72',
    num(x.fin.actual_fare) === 72 && x.f.distance_basis === 'estimate_kept_incomplete_track' && num(x.f.recorded_distance_km) === 0, x.f);

  x = await flow({ km: 5, dropoff: endOf(100) });
  check('No track at all (app closed, no GPS): the estimate stands, 72, nothing invented', num(x.fin.actual_fare) === 72 && x.f.distance_basis === 'estimate_no_track' && x.fin.actual_distance_km === null, x.f);
  x = await flow({ km: 5, dropoff: endOf(100), track: { n: 1 } });
  check('One lonely fix is not a track: the estimate stands', num(x.fin.actual_fare) === 72 && x.f.distance_basis === 'estimate_no_track', x.f);
  x = await flow({ km: 5, dropoff: endOf(100), track: { n: 100, accuracy: 80 } });
  check('A whole trip at 80 m accuracy (unusable): the estimate stands, and the log shows why (100 rejected for accuracy)', num(x.fin.actual_fare) === 72 && x.f.distance_basis === 'estimate_no_track' && x.f.track.rejected_accuracy === 100, x.f);

  console.log('\nThe fare is computed once');
  const Z = await book(ID.P_AUTH, ID.P1, { km: 3.5 });
  await assign(Z.booking_id, ID.D1);
  await setStatus(ID.D_AUTH, Z.booking_id, 'Trip Ongoing');
  await logTrack(Z.booking_id, ID.D1, { n: 100 });
  const first = await setStatus(ID.D_AUTH, Z.booking_id, 'Arrived at Destination');
  await logTrack(Z.booking_id, ID.D1, { n: 100, startAt: '2026-10-07T02:00:00Z', stepDeg: 0.001 });   // more rows after the fact
  const second = await setStatus(ID.P_AUTH, Z.booking_id, 'Completed');
  check('rows that arrive after finalization (or a second status change) do not change the billed fare, the distance or the ledger',
    num(second.actual_fare) === num(first.actual_fare) && second.actual_distance_km === first.actual_distance_km
      && (await q(`SELECT 1 FROM public.fare_adjustment_history WHERE booking_id = $1`, [Z.booking_id])).length === 1);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
