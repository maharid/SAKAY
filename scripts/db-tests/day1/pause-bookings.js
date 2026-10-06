// Day 1: a driver can pause and resume new bookings while Online (migration 20261012000002).
const { freshDb, asUser, attempt, check, summary } = require('../tlib');
const { ID, seed } = require('../fixtures');

(async () => {
  const db = await freshDb();
  await seed(db);
  const svc = (fn) => asUser(db, { role: 'service_role' }, fn, { commit: true });
  const as = (uid, fn) => asUser(db, { uid }, fn, { commit: true });
  const internal = (sql) => db.exec(`SELECT set_config('sakay.internal_context','true',false); ${sql}; SELECT set_config('sakay.internal_context','',false);`);
  const call = async (uid, sql) => (await as(uid, (tx) => tx.query(`SELECT ${sql} AS r`))).rows[0].r;
  const driverRow = async (id) => (await db.query(`SELECT availability_status, bookings_paused_until FROM driver WHERE driver_id='${id}'`)).rows[0];
  const minutesAhead = (ts) => (new Date(ts).getTime() - Date.now()) / 60000;

  // D1 and D2 are verified and Online (Available). The Batch 4 online gate is switched off only to build this fixture.
  await db.exec(`ALTER TABLE public.driver DISABLE TRIGGER trigger_check_driver_online_eligibility`);
  await internal(`UPDATE driver SET availability_status='Available', current_latitude=13.4115, current_longitude=121.1803 WHERE driver_id IN ('${ID.D1}','${ID.D2}')`);
  await db.exec(`ALTER TABLE public.driver ENABLE TRIGGER trigger_check_driver_online_eligibility`);

  console.log('T1 who can pause');
  let r = await call(ID.D3_AUTH, `public.driver_pause_bookings(15)`);
  check('an Offline driver cannot pause (go Online first)', r.success === false && r.error_code === 'ERR_NOT_ONLINE', r);
  r = await call(ID.P_AUTH, `public.driver_pause_bookings(15)`);
  check('a passenger (not a driver) cannot pause', r.success === false && r.error_code === 'ERR_NOT_A_DRIVER', r);
  const anon = await asUser(db, { role: 'anon' }, (tx) => attempt(() => tx.query(`SELECT public.driver_pause_bookings(15)`)), { commit: true });
  check('an anonymous caller cannot call it at all', !anon.ok && /permission denied/i.test(anon.error), anon);

  console.log('\nT2 pause lengths (5 to 60 minutes, default 15)');
  r = await call(ID.D_AUTH, `public.driver_pause_bookings(4)`);
  check('4 minutes is refused', r.success === false && r.error_code === 'ERR_PAUSE_MINUTES', r);
  r = await call(ID.D_AUTH, `public.driver_pause_bookings(61)`);
  check('61 minutes is refused', r.success === false && r.error_code === 'ERR_PAUSE_MINUTES', r);
  check('a refused pause changes nothing', (await driverRow(ID.D1)).bookings_paused_until === null);
  r = await call(ID.D_AUTH, `public.driver_pause_bookings()`);
  check('no length given pauses for the default 15 minutes', r.success === true && Math.abs(minutesAhead(r.bookings_paused_until) - 15) < 0.5, r);
  r = await call(ID.D_AUTH, `public.driver_pause_bookings(60)`);
  check('60 minutes is accepted (the maximum)', r.success === true && Math.abs(minutesAhead(r.bookings_paused_until) - 60) < 0.5, r);
  r = await call(ID.D_AUTH, `public.driver_pause_bookings(5)`);
  check('5 minutes is accepted (the minimum) and replaces the earlier pause', r.success === true && Math.abs(minutesAhead(r.bookings_paused_until) - 5) < 0.5, r);
  check('the pause is stored on the driver and the driver stays Online', (await driverRow(ID.D1)).availability_status === 'Available' && (await driverRow(ID.D1)).bookings_paused_until !== null);
  const st = await call(ID.D_AUTH, `public.get_my_driver_presence()`);
  check('the presence state the app reads includes the pause', st.online === true && st.bookings_paused_until !== null && st.bookings_paused_until !== undefined, st);

  console.log('\nT3 dispatch skips a paused driver');
  const B = 'b2000000-0000-0000-0000-000000000001';
  await svc((tx) => tx.query(`
    INSERT INTO booking(booking_id,passenger_id,booking_status,passenger_count,pickup_address,pickup_latitude,pickup_longitude,
                        dropoff_address,dropoff_latitude,dropoff_longitude,estimated_distance_km,estimated_fare)
    VALUES ('${B}','${ID.P1}','Searching Driver',1,'A',13.4115,121.1803,'B',13.42,121.19,1.5,60)`));
  const cands = async () => (await as(ID.P_AUTH, (tx) => tx.query(`SELECT driver_id FROM public.find_candidate_drivers('${B}')`))).rows.map((x) => x.driver_id);
  let list = await cands();
  check('D2 (not paused) is a candidate; D1 (paused) is not', list.includes(ID.D2) && !list.includes(ID.D1), list);
  const offer = (driver) => svc((tx) => attempt(() => tx.query(
    `INSERT INTO dispatch_attempt(booking_id,driver_id,dispatch_method,driver_rank,response_status) VALUES ('${B}','${driver}','Sequential Tiered',1,'Pending')`)));
  let o = await offer(ID.D1);
  check('an offer to the paused driver is refused by the database whoever sends it', !o.ok && /ERR_DRIVER_PAUSED/.test(o.error), o);
  o = await offer(ID.D2);
  check('an offer to a driver who is not paused still works', o.ok, o);

  console.log('\nT4 resume, expiry and going Offline');
  r = await call(ID.D_AUTH, `public.driver_resume_bookings()`);
  check('resuming ends the pause at once', r.success === true && (r.bookings_paused_until === null || r.bookings_paused_until === undefined) && (await driverRow(ID.D1)).bookings_paused_until === null, r);
  await db.exec(`DELETE FROM dispatch_attempt`);
  list = await cands();
  check('after resuming D1 is a candidate again', list.includes(ID.D1), list);
  o = await offer(ID.D1);
  check('and can be offered a booking', o.ok, o);
  r = await call(ID.D_AUTH, `public.driver_resume_bookings()`);
  check('resuming when not paused is harmless', r.success === true, r);

  await call(ID.D2_AUTH, `public.driver_pause_bookings(30)`);
  await internal(`UPDATE driver SET bookings_paused_until = now() - interval '1 minute' WHERE driver_id='${ID.D2}'`);
  const exp = await call(ID.D2_AUTH, `public.get_my_driver_presence()`);
  check('a pause that has run out is not reported any more (no job needed)', exp.bookings_paused_until === null || exp.bookings_paused_until === undefined, exp);
  await db.exec(`DELETE FROM dispatch_attempt`);
  list = await cands();
  check('and the driver is a candidate again', list.includes(ID.D2), list);

  await call(ID.D_AUTH, `public.driver_pause_bookings(30)`);
  r = await call(ID.D_AUTH, `public.driver_go_offline()`);
  check('going Offline works while paused', r.success === true, r);
  const off = await driverRow(ID.D1);
  check('going Offline clears the pause', off.availability_status === 'Offline' && off.bookings_paused_until === null, off);
  await db.exec(`ALTER TABLE public.driver DISABLE TRIGGER trigger_check_driver_online_eligibility`);
  await internal(`UPDATE driver SET bookings_paused_until = now() + interval '20 minutes' WHERE driver_id='${ID.D1}'`);
  await internal(`UPDATE driver SET availability_status='Available' WHERE driver_id='${ID.D1}'`);
  await db.exec(`ALTER TABLE public.driver ENABLE TRIGGER trigger_check_driver_online_eligibility`);
  check('coming Online starts without a pause', (await driverRow(ID.D1)).bookings_paused_until === null);

  console.log('\nT5 the audit trail');
  const audit = (await db.query(`SELECT action_type, count(*)::int n FROM audit_log WHERE action_type IN ('DRIVER_BOOKINGS_PAUSED','DRIVER_BOOKINGS_RESUMED') GROUP BY action_type ORDER BY 1`)).rows;
  check('pauses and resumes are written to the audit log', audit.some((a) => a.action_type === 'DRIVER_BOOKINGS_PAUSED' && a.n >= 3) && audit.some((a) => a.action_type === 'DRIVER_BOOKINGS_RESUMED' && a.n >= 1), audit);

  console.log('\nT6 a pause is not "ignoring offers"');
  const inactivity = (await db.query(`SELECT count(*)::int n FROM driver_online_session WHERE driver_id='${ID.D1}' AND unanswered_streak > 0`)).rows[0].n;
  check('pausing does not touch the inactivity counters (no offer was ignored)', inactivity === 0, inactivity);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
