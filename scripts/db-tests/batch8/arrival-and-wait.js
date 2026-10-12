// Batch 8 (20261023000001), part 1: the pickup zone, the Arrived gate, the passenger's wait and its pause, the No-Show, the first-name check.
// Rules 8.5, 10.1 - 10.5, 11.1, decisions PI-06 / D8-ZONE (25 m, 30 m of error, 45 s), D8-X1 (the wait pauses while the driver is away), D8-X9 / D8-X10
// (the trip cannot start before the driver has checked the passenger's first name; drivers see first names only).
// The database holds every deadline, so the suite moves the stored timestamps back (what the database would see after that much waiting) instead
// of waiting minutes. Whole migration chain on the local emulator (never Supabase).
const { setup, ID, DRIVERS, attempt, check, summary } = require('../b6fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, as } = s;
  const off = async (k) => { await s.goOffline(DRIVERS[k].uid); };
  const allOffline = async () => { for (const k of ['D1', 'D2', 'D3']) if ((await s.status(DRIVERS[k].id)) !== 'Offline') await off(k); };
  const reset = async (b) => { if (b) await s.finish(b.booking_id); await allOffline(); };
  // the driver writes the booking exactly as the Driver app does, WITHOUT the helper that puts him at the pickup first (these tests are about that gate)
  const rawSets = (key, bookingId, status) =>
    attempt(() => as(DRIVERS[key].uid, (tx) => tx.query(`UPDATE booking SET booking_status=$2 WHERE booking_id=$1 RETURNING *`, [bookingId, status])));
  const bookAndAccept = async (key = 'D1', pax = 'P1') => {
    const b = await s.bookAs(pax);
    const o = await s.pendingOffer(b.booking_id);
    if (!o || o.driver_id !== DRIVERS[key].id) throw new Error(`expected an offer to ${key}, got ${JSON.stringify(o)}`);
    const r = await s.accept(key, o.attempt_id);
    if (!r.success) throw new Error('accept failed ' + JSON.stringify(r));
    return s.booking(b.booking_id);
  };
  const ageArrival = (bookingId, sec) => internal(`UPDATE booking SET arrived_at = arrived_at - interval '${sec} seconds' WHERE booking_id = '${bookingId}'`);
  // what the sweep would see `sec` seconds after its last look at the driver's position
  const ageWait = (bookingId, sec) => internal(`UPDATE booking SET wait_sampled_at = wait_sampled_at - interval '${sec} seconds', wait_zone_left_at = wait_zone_left_at - interval '${sec} seconds' WHERE booking_id = '${bookingId}'`);
  const staleFix = (key, sec) => internal(`UPDATE driver SET last_location_update = last_location_update - interval '${sec} seconds' WHERE driver_id = '${DRIVERS[key].id}'`);
  const rpc = (key, sql, args) => s.rpcAs(DRIVERS[key].uid, sql, args);
  const paxRpc = (pax, sql, args) => s.rpcAs(s.PAX[pax].uid, sql, args);
  const strikeRows = (id, code) => q(`SELECT violation_code, status, points_active FROM strikes_ledger WHERE subject_id='${id}' AND violation_code='${code}' AND status <> 'VOIDED'`);
  const clearStrikes = () => internal(`UPDATE strikes_ledger SET status = 'VOIDED', points_active = 0`);
  const dist = async (key, bookingId) => (await one(`SELECT public._driver_pickup_distance_m('${DRIVERS[key].id}', '${bookingId}') AS d`)).d;
  const inZone = async (key, bookingId) => (await one(`SELECT public._driver_within_pickup_zone('${DRIVERS[key].id}', '${bookingId}') AS z`)).z;
  const parties = (uid, id) => as(uid, (tx) => tx.query(`SELECT * FROM public.get_booking_counterparties($1::uuid[])`, [[id]])).then((r) => r.rows);
  const near = (v, lo, hi) => typeof v === 'number' && v >= lo && v <= hi;

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('S1 PI-06 / D8-ZONE: one zone - a fix at most 45 s old, at most 30 m of error, plain distance at most 25 m (no credit for the fix\'s own error)');
  await s.online('D1', 300);
  let b = await bookAndAccept('D1', 'P1');
  await s.moveTo('D1', 24, 10);
  let d = await dist('D1', b.booking_id);
  check('24 m away on a fix with 10 m of error: the distance is read and the driver is IN the zone', near(d, 23.5, 24.5) && (await inZone('D1', b.booking_id)) === true, d);
  await s.moveTo('D1', 26, 10);
  check('26 m away: outside the 25 m zone', near(await dist('D1', b.booking_id), 25.5, 26.5) && (await inZone('D1', b.booking_id)) === false);
  await s.moveTo('D1', 30, 25);
  check('30 m away on a fix with 25 m of error is OUTSIDE (the old rule subtracted the error and let him pass at 15 m: no credit any more)', (await inZone('D1', b.booking_id)) === false, await dist('D1', b.booking_id));
  await s.moveTo('D1', 10, 31);
  check('a fix with 31 m of error is ignored altogether (no distance, no zone), even though it is only 10 m away', (await dist('D1', b.booking_id)) === null && (await inZone('D1', b.booking_id)) === false);
  await s.moveTo('D1', 5, 30);
  check('30 m of error is the limit: still usable', (await inZone('D1', b.booking_id)) === true);
  await s.moveTo('D1', 5, 10); await staleFix('D1', 60);
  check('a fix a minute old is not used', (await dist('D1', b.booking_id)) === null && (await inZone('D1', b.booking_id)) === false);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS2 Rule 10.1 / W2: Arrived means at the pickup - whichever screen sends it, the database looks at the driver\'s own fix');
  await s.moveTo('D1', 300, 15);
  let r = await rawSets('D1', b.booking_id, 'In Transit');
  check('"on my way" needs no position', r.ok === true, r);
  r = await rawSets('D1', b.booking_id, 'Driver Arrived');
  check('Arrived from 300 m away is refused (ERR_NOT_AT_PICKUP) and nothing is recorded', !r.ok && /ERR_NOT_AT_PICKUP/.test(r.error) && (await s.booking(b.booking_id)).booking_status === 'In Transit' && (await s.booking(b.booking_id)).arrived_at === null, r);
  r = await rawSets('D1', b.booking_id, 'Arrived at Pickup');
  check('the second spelling of Arrived (the other screen) is refused as well', !r.ok && /ERR_NOT_AT_PICKUP/.test(r.error), r);
  await s.moveTo('D1', 26, 10);
  r = await rawSets('D1', b.booking_id, 'Driver Arrived');
  check('26 m away: refused', !r.ok && /ERR_NOT_AT_PICKUP/.test(r.error), r);
  await s.moveTo('D1', 5, 40);
  r = await rawSets('D1', b.booking_id, 'Driver Arrived');
  check('at the pickup but on a fix with 40 m of error: refused (the fix proves nothing)', !r.ok && /ERR_NOT_AT_PICKUP/.test(r.error), r);
  await s.moveTo('D1', 5, 10); await staleFix('D1', 60);
  r = await rawSets('D1', b.booking_id, 'Driver Arrived');
  check('at the pickup but on a fix a minute old: refused', !r.ok && /ERR_NOT_AT_PICKUP/.test(r.error), r);
  check('the refusal is in plain words, in both languages', /pickup point/.test(r.error) && /pickup/i.test(r.error) && /Wala ka pa sa pickup point/.test(r.error), r.error);
  await s.moveTo('D1', 24, 10);
  r = await rawSets('D1', b.booking_id, 'Driver Arrived');
  let cur = await s.booking(b.booking_id);
  check('24 m away on a good fresh fix: Arrived is recorded, with the SERVER\'s time', r.ok === true && cur.booking_status === 'Driver Arrived' && cur.arrived_at !== null && Math.abs(Date.now() - new Date(cur.arrived_at).getTime()) < 60000, { r, cur: cur.arrived_at });
  const arrivedAt = cur.arrived_at;
  await s.moveTo('D1', 300, 15);
  r = await rawSets('D1', b.booking_id, 'Arrived at Pickup');
  check('once arrived, the other spelling needs no zone and changes nothing (the wait keeps its start)', r.ok === true && String((await s.booking(b.booking_id)).arrived_at) === String(arrivedAt), r);
  const early = await rawSets('D1', b.booking_id, 'Trip Ongoing');
  check('a trip cannot start before the first name is checked (see S3); from here it is refused', !early.ok, early);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS3 Rule 11.1: the driver sees the first name only, and the trip starts only after he has checked it');
  await reset(b);
  await s.online('D1', 300);
  const nb = await s.bookAs('P1');
  const offerView = await s.myOffer('D1');
  check('the offer shows the passenger\'s first name (passenger_first_name) and no full name', offerView.passenger_first_name === 'Pax' && offerView.passenger_name === undefined, offerView);
  const accepted = await s.accept('D1', (await s.pendingOffer(nb.booking_id)).attempt_id);
  check('the driver accepts the booking', accepted.success === true, accepted);
  let cp = await parties(DRIVERS.D1.uid, nb.booking_id);
  check('the driver of the booking gets the first name as passenger_name (and the phone while the trip is live)', cp.length === 1 && cp[0].passenger_name === 'Pax' && !!cp[0].passenger_phone, cp);
  cp = await parties(s.PAX.P1.uid, nb.booking_id);
  check('the passenger himself still gets his full name', cp.length === 1 && cp[0].passenger_name === 'Pax One', cp);
  cp = await parties(ID.L_AUTH, nb.booking_id);
  check('the LGU Administrator gets the full name', cp.length === 1 && cp[0].passenger_name === 'Pax One', cp);
  cp = await parties(ID.T_AUTH, nb.booking_id);
  check('the TODA Administrator of the driver gets the full name', cp.length === 1 && cp[0].passenger_name === 'Pax One', cp);
  await internal(`UPDATE passenger SET full_name = 'Ma. Cristina Santos' WHERE passenger_id = '${ID.P1}'`);
  cp = await parties(DRIVERS.D1.uid, nb.booking_id);
  check('"Ma. Cristina Santos" is shown as "Ma. Cristina"', cp[0].passenger_name === 'Ma. Cristina', cp);
  await internal(`UPDATE passenger SET full_name = 'Dela Cruz, Juan Carlos' WHERE passenger_id = '${ID.P1}'`);
  cp = await parties(DRIVERS.D1.uid, nb.booking_id);
  check('"Dela Cruz, Juan Carlos" is shown as "Juan"', cp[0].passenger_name === 'Juan', cp);
  await internal(`UPDATE passenger SET full_name = 'Pax One' WHERE passenger_id = '${ID.P1}'`);

  const tooSoon = await rpc('D1', 'public.driver_confirm_passenger($1)', [nb.booking_id]);
  check('the first name cannot be confirmed before the driver has arrived', tooSoon.success === false && tooSoon.error_code === 'ERR_NOT_ARRIVED', tooSoon);
  await s.driverSets('D1', nb.booking_id, 'In Transit'); await s.driverSets('D1', nb.booking_id, 'Driver Arrived');   // (the helper puts him at the pickup)
  const w0 = await rpc('D1', 'public.get_arrival_wait_status($1)', [nb.booking_id]);
  check('the driver\'s screen knows the first name has not been confirmed yet', w0.boarding_verified === false, w0);
  r = await rawSets('D1', nb.booking_id, 'Trip Ongoing');
  check('the trip cannot start: ERR_VERIFY_PASSENGER, in both languages', !r.ok && /ERR_VERIFY_PASSENGER/.test(r.error) && /first name/.test(r.error) && /unang pangalan/.test(r.error) && (await s.booking(nb.booking_id)).booking_status === 'Driver Arrived', r);
  const lock1 = await attempt(() => as(DRIVERS.D1.uid, (tx) => tx.query(`UPDATE booking SET boarding_verified_at = now() WHERE booking_id = $1 RETURNING *`, [nb.booking_id])));
  check('the driver cannot write the confirmation himself (a direct UPDATE is refused)', !lock1.ok && /ERR_DISPATCH_LOCKED/.test(lock1.error), lock1);
  const lock2 = await attempt(() => as(s.PAX.P1.uid, (tx) => tx.query(`UPDATE booking SET boarding_verified_at = now() WHERE booking_id = $1 RETURNING *`, [nb.booking_id])));
  check('nor can the passenger', !lock2.ok && /ERR_DISPATCH_LOCKED/.test(lock2.error), lock2);
  const byOther = await rpc('D2', 'public.driver_confirm_passenger($1)', [nb.booking_id]);
  check('another driver cannot confirm it', byOther.success === false && byOther.error_code === 'ERR_NOT_YOUR_BOOKING', byOther);
  const byPax = await paxRpc('P1', 'public.driver_confirm_passenger($1)', [nb.booking_id]);
  check('the passenger cannot confirm his own first name', byPax.success === false && byPax.error_code === 'ERR_NOT_A_DRIVER', byPax);
  const conf = await rpc('D1', 'public.driver_confirm_passenger($1)', [nb.booking_id]);
  check('the driver confirms the first name: recorded, with the name he checked', conf.success === true && conf.passenger_first_name === 'Pax' && (await s.booking(nb.booking_id)).boarding_verified_at !== null, conf);
  const conf2 = await rpc('D1', 'public.driver_confirm_passenger($1)', [nb.booking_id]);
  check('a double tap changes nothing', conf2.success === true && conf2.already_confirmed === true, conf2);
  check('the confirmation is audited', (await q(`SELECT 1 FROM audit_log WHERE action_type = 'PASSENGER_NAME_CONFIRMED' AND target_id = '${nb.booking_id}'`)).length === 1);
  check('and the screens read it from the wait status', (await rpc('D1', 'public.get_arrival_wait_status($1)', [nb.booking_id])).boarding_verified === true);
  r = await rawSets('D1', nb.booking_id, 'Trip Ongoing');
  check('now the trip starts', r.ok === true && (await s.booking(nb.booking_id)).booking_status === 'Trip Ongoing', r);
  await reset(await s.booking(nb.booking_id));

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS4 Rule 10.2 / D8-X1: the passenger\'s wait does not count while the driver is away (more than 25 + 5 m, or more than 25 m for more than 15 s)');
  await s.online('D1', 300);
  await clearStrikes();
  b = await bookAndAccept('D1', 'P1');
  await s.driverSets('D1', b.booking_id, 'In Transit'); await s.driverSets('D1', b.booking_id, 'Driver Arrived');
  await s.sweep();
  let w = await paxRpc('P1', 'public.get_arrival_wait_status($1)', [b.booking_id]);
  check('inside the zone nothing is written and the wait is the plain 5 minutes', w.waiting === true && w.paused_seconds === 0 && w.seconds_remaining >= 299 && (await s.booking(b.booking_id)).wait_zone_left_at === null, w);

  console.log('   (a) 28 m away for 10 s: inside the 5 m / 15 s tolerance - the clock does not pause');
  await s.moveTo('D1', 28, 10); await s.sweep();
  cur = await s.booking(b.booking_id);
  check('the first sample outside the zone opens an excursion and counts nothing', cur.wait_zone_left_at !== null && cur.wait_paused_seconds === 0, cur);
  await ageWait(b.booking_id, 10); await s.moveTo('D1', 28, 10); await s.sweep();
  cur = await s.booking(b.booking_id);
  check('10 seconds later, still 28 m away: still nothing is paused', cur.wait_paused_seconds === 0 && cur.wait_zone_left_at !== null, cur);
  check('his own screen says he is outside the zone, so the No-Show is not offered', (await rpc('D1', 'public.get_arrival_wait_status($1)', [b.booking_id])).driver_in_zone === false);
  await s.moveTo('D1', 5, 10); await s.sweep();
  cur = await s.booking(b.booking_id);
  check('back inside: the excursion is closed, nothing was paused', cur.wait_zone_left_at === null && cur.wait_paused_seconds === 0, cur);

  console.log('   (b) 28 m away for 40 s: only the part beyond the 15 s tolerance (25 s) does not count');
  await s.moveTo('D1', 28, 10); await s.sweep();
  await ageWait(b.booking_id, 40); await s.moveTo('D1', 28, 10); await s.sweep();
  cur = await s.booking(b.booking_id);
  check('25 seconds of the wait are paused', near(cur.wait_paused_seconds, 24.5, 26), cur.wait_paused_seconds);

  console.log('   (c) 45 m away (beyond the 30 m band) for 10 s: all 10 seconds do not count');
  await s.moveTo('D1', 5, 10); await s.sweep();
  await s.moveTo('D1', 45, 10); await s.sweep();
  await ageWait(b.booking_id, 10); await s.moveTo('D1', 45, 10); await s.sweep();
  cur = await s.booking(b.booking_id);
  check('10 more seconds are paused (35 in all)', near(cur.wait_paused_seconds, 34.5, 36), cur.wait_paused_seconds);

  console.log('   (d) a fix that is not good enough changes nothing');
  const before = (await s.booking(b.booking_id)).wait_paused_seconds;
  await ageWait(b.booking_id, 10); await s.moveTo('D1', 45, 45); await s.sweep();
  check('a fix with 45 m of error is ignored: nothing is added', (await s.booking(b.booking_id)).wait_paused_seconds === before, { before, now: (await s.booking(b.booking_id)).wait_paused_seconds });
  await s.moveTo('D1', 45, 10); await s.sweep();
  check('the next good fix counts the time since the last good one (nothing was lost)', near((await s.booking(b.booking_id)).wait_paused_seconds, before + 9, before + 12), (await s.booking(b.booking_id)).wait_paused_seconds);

  console.log('   (e) the deadline moves back by the paused time, and the No-Show waits for it');
  await s.moveTo('D1', 5, 10); await s.sweep();
  const paused = (await s.booking(b.booking_id)).wait_paused_seconds;
  w = await paxRpc('P1', 'public.get_arrival_wait_status($1)', [b.booking_id]);
  check('the passenger sees the longer wait and how much was paused', w.paused_seconds === Math.round(paused) && near(w.seconds_remaining, 300 + Math.round(paused) - 2, 300 + Math.round(paused) + 1), { w, paused });
  await ageArrival(b.booking_id, 310);
  let rep = await rpc('D1', 'public.driver_report_no_show($1)', [b.booking_id]);
  check('310 s after arriving the passenger still has the paused time: no no-show', rep.success === false && rep.error_code === 'ERR_WAIT_NOT_OVER' && rep.seconds_remaining > 15, rep);
  await ageArrival(b.booking_id, 40);
  await s.moveTo('D1', 40, 10);
  rep = await rpc('D1', 'public.driver_report_no_show($1)', [b.booking_id]);
  check('time is up but the driver is 40 m away: no no-show (he must be at the pickup)', rep.success === false && rep.error_code === 'ERR_NOT_AT_PICKUP', rep);
  await s.moveTo('D1', 26, 10);
  rep = await rpc('D1', 'public.driver_report_no_show($1)', [b.booking_id]);
  check('26 m away: still outside the 25 m zone', rep.success === false && rep.error_code === 'ERR_NOT_AT_PICKUP', rep);
  const lock3 = await attempt(() => as(DRIVERS.D1.uid, (tx) => tx.query(`UPDATE booking SET wait_paused_seconds = 9999 WHERE booking_id = $1 RETURNING *`, [b.booking_id])));
  check('the pause is the system\'s: the driver cannot write it', !lock3.ok && /ERR_DISPATCH_LOCKED/.test(lock3.error), lock3);
  const lock4 = await attempt(() => as(s.PAX.P1.uid, (tx) => tx.query(`UPDATE booking SET wait_zone_left_at = NULL, wait_sampled_at = NULL WHERE booking_id = $1 RETURNING *`, [b.booking_id])));
  check('nor the passenger', !lock4.ok && /ERR_DISPATCH_LOCKED/.test(lock4.error), lock4);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS5 Rules 10.3 - 10.5 (T3): "I\'m Almost There" once, the guarded No-Show, the 2 strikes, the credit, rebooking');
  await reset(b);
  await s.online('D2', 300); await s.online('D1', 300);
  b = await bookAndAccept('D2', 'P1');
  await s.driverSets('D2', b.booking_id, 'In Transit'); await s.driverSets('D2', b.booking_id, 'Driver Arrived');
  await ageArrival(b.booking_id, 200);
  const r0 = (await paxRpc('P1', 'public.get_arrival_wait_status($1)', [b.booking_id])).seconds_remaining;
  const ext = await paxRpc('P1', 'public.passenger_extend_wait($1)', [b.booking_id]);
  check('"I\'m Almost There" adds exactly 2 minutes (7 in all)', ext.success === true && ext.wait_total_seconds === 420 && near(ext.seconds_remaining - r0, 119, 121), { ext, r0 });
  const ext2 = await paxRpc('P1', 'public.passenger_extend_wait($1)', [b.booking_id]);
  check('and only once', ext2.success === false && ext2.error_code === 'ERR_ALREADY_EXTENDED', ext2);
  await ageArrival(b.booking_id, 110);
  rep = await rpc('D2', 'public.driver_report_no_show($1)', [b.booking_id]);
  check('310 s after arriving the extension is still running: refused', rep.success === false && rep.error_code === 'ERR_WAIT_NOT_OVER', rep);
  await ageArrival(b.booking_id, 115);
  await s.moveTo('D2', 26, 10);
  rep = await rpc('D2', 'public.driver_report_no_show($1)', [b.booking_id]);
  check('425 s: the wait is over but he is 26 m away: refused', rep.success === false && rep.error_code === 'ERR_NOT_AT_PICKUP', rep);
  await s.moveTo('D2', 24, 10);
  rep = await rpc('D2', 'public.driver_report_no_show($1)', [b.booking_id]);
  cur = await s.booking(b.booking_id);
  check('24 m away on a good fix: the no-show is recorded and the booking is cancelled by the driver for that reason', rep.success === true && cur.booking_status === 'Cancelled' && cur.cancellation_reason === 'PASSENGER_NO_SHOW' && cur.cancelled_by === 'driver', { rep, cur });
  const ps = await strikeRows(ID.P1, 'PAX_NO_SHOW');
  check('the passenger gets 2 strikes', ps.length === 1 && ps[0].points_active === 2, ps);
  check('the driver is not struck', (await s.strikes(ID.D2)).length === 0);
  check('the driver has the redispatch credit; the other driver has none', (await one(`SELECT redispatch_credit c FROM driver_online_session WHERE driver_id='${ID.D2}' AND ended_at IS NULL`)).c === true
    && (await one(`SELECT redispatch_credit c FROM driver_online_session WHERE driver_id='${ID.D1}' AND ended_at IS NULL`)).c === false);
  rep = await rpc('D2', 'public.driver_report_no_show($1)', [b.booking_id]);
  check('a double tap changes nothing (still 2 strikes)', rep.already_reported === true && (await strikeRows(ID.P1, 'PAX_NO_SHOW')).length === 1);
  const revive = await attempt(() => as(s.PAX.P1.uid, (tx) => tx.query(`UPDATE booking SET booking_status='Accepted' WHERE booking_id=$1 RETURNING *`, [b.booking_id])));
  check('a passenger arriving late cannot reinstate the booking (Rule 10.5)', !revive.ok && /ERR_BOOKING_TRANSITION/.test(revive.error), revive);
  const rebook = await attempt(() => s.bookAs('P1'));
  check('she can book again at once (a new booking)', rebook.ok === true && rebook.value.booking_id !== b.booking_id, rebook.error);
  if (rebook.ok) await s.finish(rebook.value.booking_id);
  await reset(null);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS6 a driver who is replaced starts the next one with a clean wait and a clean verification');
  await s.online('D1', 300);
  b = await bookAndAccept('D1', 'P1');
  await s.driverSets('D1', b.booking_id, 'In Transit'); await s.driverSets('D1', b.booking_id, 'Driver Arrived');
  await s.moveTo('D1', 45, 10); await s.sweep(); await ageWait(b.booking_id, 10); await s.moveTo('D1', 45, 10); await s.sweep();
  await s.moveTo('D1', 5, 10);
  await rpc('D1', 'public.driver_confirm_passenger($1)', [b.booking_id]);
  cur = await s.booking(b.booking_id);
  check('before the cancellation the booking carries a pause, a confirmation and an acceptance accuracy', cur.wait_paused_seconds > 0 && cur.boarding_verified_at !== null && cur.accept_accuracy_m !== null, cur);
  const cx = await s.driverCancel('D1', b.booking_id, 'personal_emergency');
  cur = await s.booking(b.booking_id);
  check('after the driver cancels the booking is back in the search with none of it', cx.success === true && cur.driver_id === null && cur.booking_status === 'Pending' && cur.wait_paused_seconds === 0
    && cur.wait_zone_left_at === null && cur.wait_sampled_at === null && cur.boarding_verified_at === null && cur.accept_accuracy_m === null && cur.arrived_at === null && cur.wait_extended_at === null, cur);
  await reset(cur);

  console.log('\nS7 the new columns are the system\'s: nobody edits them');
  await s.online('D1', 300);
  b = await bookAndAccept('D1', 'P1');
  for (const [who, uid] of [['the driver', DRIVERS.D1.uid], ['the passenger', s.PAX.P1.uid]]) {
    for (const col of ['accept_accuracy_m = 1', 'redispatch_priority_at = now()', 'wait_sampled_at = now()']) {
      const x = await attempt(() => as(uid, (tx) => tx.query(`UPDATE booking SET ${col} WHERE booking_id = $1 RETURNING *`, [b.booking_id])));
      check(`${who} cannot write ${col.split(' ')[0]}`, !x.ok && /ERR_DISPATCH_LOCKED/.test(x.error), x);
    }
  }
  const anon = await attempt(() => s.anon((tx) => tx.query(`SELECT public.driver_confirm_passenger('${b.booking_id}')`)));
  check('an anonymous caller cannot confirm a passenger', !anon.ok && /permission denied/.test(anon.error), anon);
  await reset(b);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
