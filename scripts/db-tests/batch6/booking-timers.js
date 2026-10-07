// Batch 6 part 5: the clocks of an accepted booking. Rules 8.2-8.5 (stall), 9.2 / 9.3 / 9.5 (unreachable), 10.1-10.5 (the arrival wait and
// the Passenger No-Show), 12.6 (a system cancellation never strikes the passenger) and the single-use redispatch credit (PI-02 = A).
// The database holds every deadline, so the suite moves the timestamps back (what the database would see after that much waiting) instead
// of waiting minutes. Whole migration chain on the local emulator (never Supabase).
const { setup, ID, DRIVERS, attempt, check, summary } = require('../b6fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, as, svc, north } = s;
  const off = async (k) => { await s.goOffline(DRIVERS[k].uid); };
  const allOffline = async () => { for (const k of ['D1', 'D2', 'D3']) if ((await s.status(DRIVERS[k].id)) !== 'Offline') await off(k); };
  const reset = async (b) => { if (b) await s.finish(b.booking_id); await allOffline(); };
  const driverSets = (key, bookingId, status) =>
    attempt(() => as(DRIVERS[key].uid, (tx) => tx.query(`UPDATE booking SET booking_status=$2 WHERE booking_id=$1 RETURNING *`, [bookingId, status])));
  const bookAndAccept = async (key = 'D1', pax = 'P1') => {
    const b = await s.bookAs(pax);
    const o = await s.pendingOffer(b.booking_id);
    if (!o || o.driver_id !== DRIVERS[key].id) throw new Error(`expected an offer to ${key}, got ${JSON.stringify(o)}`);
    const r = await s.accept(key, o.attempt_id);
    if (!r.success) throw new Error('accept failed ' + JSON.stringify(r));
    return s.booking(b.booking_id);
  };
  // What the database would see `sec` seconds after the driver accepted / arrived (the driver's own clocks included: his last fix ages too).
  const age = (bookingId, sec) => internal(`
    UPDATE booking SET accepted_at = accepted_at - interval '${sec} seconds',
        stall_anchor_at = stall_anchor_at - interval '${sec} seconds',
        arrived_at = arrived_at - interval '${sec} seconds',
        stall_delay_reported_at = stall_delay_reported_at - interval '${sec} seconds',
        driver_unreachable_since = driver_unreachable_since - interval '${sec} seconds'
      WHERE booking_id = '${bookingId}'`);
  // The driver has not been heard from for `sec` more seconds. Silence is counted from his last fix, but never from before he accepted, so
  // the acceptance (and the stall clock that starts with it) ages by the same amount.
  const silence = (key, sec) => internal(`
    UPDATE driver SET last_location_update = last_location_update - interval '${sec} seconds' WHERE driver_id = '${DRIVERS[key].id}';
    UPDATE booking SET accepted_at = accepted_at - interval '${sec} seconds', stall_anchor_at = stall_anchor_at - interval '${sec} seconds'
      WHERE driver_id = '${DRIVERS[key].id}' AND booking_status NOT IN ('Cancelled', 'Completed')`);
  const notes = (recipient, type) => q(`SELECT title, message FROM notification WHERE recipient_id = '${recipient}' AND notification_type = '${type}' ORDER BY sent_at`);
  const flagsFor = (driverId, type) => q(`SELECT * FROM admin_review_flag WHERE subject_id = '${driverId}' AND flag_type = '${type}' AND status IN ('Open','Under Review')`);
  const rpc = (key, sql, args) => s.rpcAs(DRIVERS[key].uid, sql, args);
  const paxRpc = (pax, sql, args) => s.rpcAs(s.PAX[pax].uid, sql, args);
  const strikeRows = (id, code) => q(`SELECT violation_code, status, points_active, provisional_until FROM strikes_ledger WHERE subject_id='${id}' AND violation_code='${code}' AND status <> 'VOIDED'`);
  const clearStrikes = () => internal(`UPDATE strikes_ledger SET status = 'VOIDED', points_active = 0`);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('S1 Rules 8.2 / 8.3: no movement toward the pickup - a warning at 2 minutes, cancelled on the driver\'s behalf at 3');
  await s.online('D1', 300); await s.online('D2', 600);
  let b = await bookAndAccept('D1', 'P1');
  check('the stall clock starts at the acceptance: the anchor is where the driver was, since the acceptance time',
    b.stall_anchor_at !== null && new Date(b.stall_anchor_at).getTime() === new Date(b.accepted_at).getTime() && b.stall_anchor_latitude === b.accept_latitude, b);
  await s.sweep();
  check('right after accepting nothing happens', (await s.booking(b.booking_id)).stall_warned_at === null && (await s.booking(b.booking_id)).booking_status === 'Accepted');
  await age(b.booking_id, 100); await s.moveTo('D1', 300); await s.sweep();
  check('after 100 seconds standing still there is no warning yet', (await s.booking(b.booking_id)).stall_warned_at === null);
  await age(b.booking_id, 25); await s.moveTo('D1', 300); await s.sweep();
  let cur = await s.booking(b.booking_id);
  check('after 2 minutes (125 s) the driver is warned (Rule 8.2), and the booking is still his', cur.stall_warned_at !== null && cur.driver_id === ID.D1 && cur.booking_status === 'Accepted', cur);
  let n1 = await notes(ID.D1, 'STALL_WARNING');
  check('the warning says exactly what the policy says', n1.length === 1 && /You have not started traveling toward the passenger\. Please proceed or cancel the booking\./.test(n1[0].message), n1);
  const warnedAt = cur.stall_warned_at;
  await s.moveTo('D1', 300); await s.sweep(); await s.sweep();
  cur = await s.booking(b.booking_id);
  check('running the sweep again changes nothing (one warning, the same time)', (await notes(ID.D1, 'STALL_WARNING')).length === 1 && String(cur.stall_warned_at) === String(warnedAt));
  await s.moveTo('D1', 260); await s.sweep();                       // 40 m closer, fix accuracy 15 m: 25 m of real movement
  cur = await s.booking(b.booking_id);
  check('the driver sets off (40 m, less the 15 m GPS error = 25 m): the warning is cleared and the clock restarts from here',
    cur.stall_warned_at === null && new Date(cur.stall_anchor_at) > new Date(cur.accepted_at) && cur.booking_status === 'Accepted', cur);
  await reset(b);

  console.log('\nS1b the cancellation at 3 minutes');
  await s.online('D1', 300); await s.online('D2', 600);
  await clearStrikes();
  b = await bookAndAccept('D1', 'P1');
  await age(b.booking_id, 150); await s.moveTo('D1', 300); await s.sweep();
  await s.moveTo('D1', 290);                                         // 10 m: inside the GPS error (accuracy 15), so it is NOT movement
  await age(b.booking_id, 35); await s.moveTo('D1', 290); await s.sweep();
  cur = await s.booking(b.booking_id);
  check('10 m of drift inside a 15 m GPS error is not movement: still stalled, so at 3 minutes the booking is taken from D1 and goes to the next driver',
    cur.driver_id === null && cur.booking_status === 'Pending' && cur.accepted_driver_cancel_count === 1, cur);
  let o = await s.offers(b.booking_id);
  check('D1 is excluded from this booking for this cycle; the next-ranked driver (D2) was offered at once', o.length === 2 && o[1].driver_id === ID.D2 && o[1].response_status === 'Pending' && o[1].cycle === 1, o);
  let st = await strikeRows(ID.D1, 'DRV_STALL');
  check('D1 got exactly 1 strike for a stall (Rule 8.3)', st.length === 1 && st[0].points_active === 1, st);
  const pn = await notes(ID.P1, 'DRIVER_CANCELLED_REDISPATCH');
  check('the passenger is told: "Your driver was unable to proceed. We\'re finding you another driver."', pn.length === 1 && /Your driver was unable to proceed\. We're finding you another driver\./.test(pn[0].message), pn);
  const dn = await notes(ID.D1, 'BOOKING_AUTO_CANCELLED');
  check('the driver is told his booking was cancelled and why', dn.length === 1 && /did not start traveling/.test(dn[0].message), dn);
  check('the passenger was not struck (Rule 12.6)', (await s.strikes(ID.P1)).length === 0, await s.strikes(ID.P1));
  check('an audit row records the system cancellation', (await q(`SELECT 1 FROM audit_log WHERE action_type='BOOKING_SYSTEM_CANCELLED' AND target_id='${b.booking_id}'`)).length === 1);
  const cr = await q(`SELECT cancelled_by, redispatch_triggered FROM cancellation_record WHERE booking_id='${b.booking_id}'`);
  check('the cancellation record says the system did it, and that the booking was redispatched', cr.length === 1 && cr[0].cancelled_by === 'system' && cr[0].redispatch_triggered === true, cr);
  await s.sweep(); await s.sweep();
  check('another sweep neither strikes D1 again nor takes the booking from D2 (idempotent)', (await strikeRows(ID.D1, 'DRV_STALL')).length === 1 && (await s.offers(b.booking_id)).length === 2);

  const acc2 = await s.accept('D2', o[1].attempt_id);
  check('D2 accepts the redispatched booking and gets a fresh stall clock', acc2.success === true && (await s.booking(b.booking_id)).stall_anchor_at !== null && (await s.booking(b.booking_id)).stall_warned_at === null);
  b = await s.booking(b.booking_id);
  await age(b.booking_id, 190); await s.moveTo('D2', 600); await s.sweep();
  cur = await s.booking(b.booking_id);
  check('D2 stalls too: the count of accepted drivers who failed this booking goes to 2 (Rule 12.8 counts system cancellations)', cur.accepted_driver_cancel_count === 2 && cur.driver_id === null, cur);
  await reset(cur);

  console.log('\nS1c a driver already at the pickup is not stalled; once he has arrived the stall rule no longer applies (Rule 8.5)');
  await s.online('D1', 300);
  await clearStrikes();
  b = await bookAndAccept('D1', 'P1');
  await s.moveTo('D1', 5, 10);                                       // 5 m from the pickup, accuracy 10 m
  await age(b.booking_id, 400); await s.moveTo('D1', 5, 10); await s.sweep();
  check('a driver sitting at the pickup is not cancelled for standing still (he only has to tap Arrived)', (await s.booking(b.booking_id)).driver_id === ID.D1 && (await strikeRows(ID.D1, 'DRV_STALL')).length === 0);
  check('he taps Arrived', (await driverSets('D1', b.booking_id, 'In Transit')).ok && (await driverSets('D1', b.booking_id, 'Driver Arrived')).ok);
  await s.moveTo('D1', 120, 15);                                     // wanders off: that is the no-show timer's business, not the stall rule's
  await age(b.booking_id, 900); await s.moveTo('D1', 120, 15); await s.sweep();
  check('after Arrived, 15 minutes of standing 120 m away is not a stall (Rule 8.5): no cancellation, no strike', (await s.booking(b.booking_id)).booking_status === 'Driver Arrived' && (await strikeRows(ID.D1, 'DRV_STALL')).length === 0);
  await reset(await s.booking(b.booking_id));

  console.log('\nS1d Rule 8.4: moved, then stood still for 5 minutes; a reported delay restarts the five minutes (twice at most)');
  await s.online('D1', 300);
  await clearStrikes();
  b = await bookAndAccept('D1', 'P1');
  const early = await rpc('D1', 'public.driver_report_delay($1, $2)', [b.booking_id, 'traffic']);
  check('a delay cannot be reported before the driver has set off (Rule 8.3 has no excuse)', early.success === false && early.error_code === 'ERR_NOT_STARTED', early);
  await s.moveTo('D1', 200); await s.sweep();                        // he sets off: 100 m closer
  check('he moved: the anchor is where he stands now', (await s.booking(b.booking_id)).stall_anchor_at > b.accepted_at);
  const bad = await rpc('D1', 'public.driver_report_delay($1, $2)', [b.booking_id, 'lunch']);
  check('only "traffic" and "road_closure" are accepted', bad.success === false && bad.error_code === 'ERR_DELAY_REASON', bad);
  await age(b.booking_id, 250); await s.moveTo('D1', 200); await s.sweep();
  check('4 minutes standing still on the way is not yet a stall', (await s.booking(b.booking_id)).driver_id === ID.D1);
  const r1 = await rpc('D1', 'public.driver_report_delay($1, $2)', [b.booking_id, 'traffic']);
  check('he reports traffic: accepted, one report left', r1.success === true && r1.reports === 1 && r1.reports_left === 1, r1);
  await age(b.booking_id, 280); await s.moveTo('D1', 200); await s.sweep();
  check('5 minutes after he first stopped, but 4.5 after he reported traffic: no stall', (await s.booking(b.booking_id)).driver_id === ID.D1);
  check('a second report is accepted', (await rpc('D1', 'public.driver_report_delay($1, $2)', [b.booking_id, 'road_closure'])).success === true);
  const r3 = await rpc('D1', 'public.driver_report_delay($1, $2)', [b.booking_id, 'traffic']);
  check('a third report is refused (the excuse cannot be used for ever)', r3.success === false && r3.error_code === 'ERR_TOO_MANY_DELAY_REPORTS', r3);
  const other = await rpc('D2', 'public.driver_report_delay($1, $2)', [b.booking_id, 'traffic']);
  check('another driver cannot report a delay on this booking', other.success === false && other.error_code === 'ERR_NOT_ON_THE_WAY', other);
  await age(b.booking_id, 320); await s.moveTo('D1', 200); await s.sweep();
  cur = await s.booking(b.booking_id);
  check('5 minutes after the last report he is stalled: cancelled, 1 strike, redispatched (Rule 8.4)', cur.driver_id === null && (await strikeRows(ID.D1, 'DRV_STALL')).length === 1, cur);
  check('the policy audit names Rule 8.4', (await q(`SELECT details FROM audit_log WHERE action_type='BOOKING_SYSTEM_CANCELLED' AND target_id='${b.booking_id}'`)).some((r) => /Rule 8\.4|stopped on the way/.test(r.details)));
  await reset(cur);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS1e a trip in flight when the migration is deployed is not judged from an acceptance long ago');
  await s.online('D1', 300);
  await clearStrikes();
  b = await bookAndAccept('D1', 'P1');
  await internal(`UPDATE booking SET stall_anchor_at = NULL, stall_anchor_latitude = NULL, stall_anchor_longitude = NULL, stall_warned_at = NULL,
                      accepted_at = accepted_at - interval '20 minutes' WHERE booking_id = '${b.booking_id}'`);
  await s.moveTo('D1', 300); await s.sweep();
  cur = await s.booking(b.booking_id);
  check('a booking accepted 20 minutes ago, before the clock existed, is not cancelled and nobody is struck: the clock starts at the first sweep',
    cur.driver_id === ID.D1 && cur.booking_status === 'Accepted' && cur.stall_anchor_at !== null && new Date(cur.stall_anchor_at) > new Date(cur.accepted_at)
    && (await strikeRows(ID.D1, 'DRV_STALL')).length === 0, cur);
  await age(b.booking_id, 310); await s.moveTo('D1', 300); await s.sweep();
  check('five minutes after that first sweep, standing still, he is stalled (the five-minute rule applies from there)', (await s.booking(b.booking_id)).driver_id === null && (await strikeRows(ID.D1, 'DRV_STALL')).length === 1);
  await reset(await s.booking(b.booking_id));

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS2 Rules 9.2 / 9.3: no location from an accepted driver');
  await s.online('D1', 300); await s.online('D2', 600);
  await clearStrikes();
  b = await bookAndAccept('D1', 'P1');
  await s.moveTo('D1', 250);
  await silence('D1', 170); await s.sweep();
  check('after 170 s without a location update nothing is flagged', (await s.booking(b.booking_id)).driver_unreachable_since === null);
  await silence('D1', 20); await s.sweep();
  cur = await s.booking(b.booking_id);
  check('after more than 3 minutes the booking is marked Driver Unreachable', cur.driver_unreachable_since !== null && cur.booking_status === 'Accepted' && cur.driver_id === ID.D1, cur);
  let un = await notes(ID.P1, 'DRIVER_UNREACHABLE');
  check('the passenger is told, in the policy\'s words', un.length === 1 && /Your driver appears to be experiencing a connectivity issue\. We'll keep trying to reach them\./.test(un[0].message), un);
  await s.sweep(); await s.sweep();
  check('the sweep repeating does not tell the passenger twice', (await notes(ID.P1, 'DRIVER_UNREACHABLE')).length === 1);
  await s.moveTo('D1', 250); await s.sweep();
  check('the driver is heard from again: the mark is cleared', (await s.booking(b.booking_id)).driver_unreachable_since === null);
  await silence('D1', 200); await s.sweep();
  check('silent again: marked again', (await s.booking(b.booking_id)).driver_unreachable_since !== null);
  await silence('D1', 120); await s.sweep();                         // 320 s in all
  cur = await s.booking(b.booking_id);
  check('after 5 minutes before arriving the booking is taken from the driver and goes to the next one (Rule 9.3)', cur.driver_id === null && cur.booking_status === 'Pending' && cur.accepted_driver_cancel_count === 1, cur);
  st = await strikeRows(ID.D1, 'DRV_CONNECTIVITY_FAILURE');
  check('the driver\'s strike is PROVISIONAL (it may be waived within 48 hours, Rule 9.4) - and it is 1 point',
    st.length === 1 && st[0].status === 'PROVISIONAL' && st[0].points_active === 1 && st[0].provisional_until !== null
    && Math.abs((new Date(st[0].provisional_until) - Date.now()) / 3600000 - 48) < 1, st);
  check('the driver is told what to do about it', (await notes(ID.D1, 'BOOKING_AUTO_CANCELLED')).some((r) => /waive/.test(r.message)));
  check('the passenger is told a new driver is being found, and was not struck (Rule 12.6)', (await q(`SELECT 1 FROM notification WHERE recipient_id='${ID.P1}' AND notification_type='DRIVER_CANCELLED_REDISPATCH' AND subject_id='${b.booking_id}'`)).length === 1 && (await s.strikes(ID.P1)).length === 0);
  check('the booking is out for D2 now', (await s.pendingOffer(b.booking_id))?.driver_id === ID.D2);
  await reset(cur);

  console.log('\nS2b silence after the driver has arrived or the trip has started (Rule 9.5: a boarded passenger is never stranded)');
  await s.online('D1', 300);
  await clearStrikes();
  b = await bookAndAccept('D1', 'P1');
  await s.moveTo('D1', 5, 10);
  await driverSets('D1', b.booking_id, 'In Transit'); await driverSets('D1', b.booking_id, 'Driver Arrived');
  await silence('D1', 600); await s.sweep();
  cur = await s.booking(b.booking_id);
  check('silent for 10 minutes after arriving: marked unreachable, but NOT cancelled (the policy cancels only before arrival)', cur.driver_unreachable_since !== null && cur.booking_status === 'Driver Arrived' && cur.driver_id === ID.D1, cur);
  await s.moveTo('D1', 5, 10);
  await driverSets('D1', b.booking_id, 'Trip Ongoing');
  await s.sweep();
  check('heard again: cleared, the trip starts', (await s.booking(b.booking_id)).driver_unreachable_since === null && (await s.booking(b.booking_id)).booking_status === 'Trip Ongoing');
  await silence('D1', 400); await s.sweep();
  cur = await s.booking(b.booking_id);
  check('silent for 6 minutes during the trip: flagged Connectivity Interrupted, the trip stays open (never auto-cancelled)', cur.driver_unreachable_since !== null && cur.booking_status === 'Trip Ongoing', cur);
  check('no reconciliation flag yet (30 minutes have not passed)', (await flagsFor(ID.D1, 'TRIP_MANUAL_RECONCILIATION')).length === 0);
  await age(b.booking_id, 1900); await silence('D1', 1900); await s.sweep();
  const fl = await flagsFor(ID.D1, 'TRIP_MANUAL_RECONCILIATION');
  check('after 30 minutes of silence the trip goes to the TODA administrator for manual reconciliation (Rule 9.5)',
    fl.length === 1 && fl[0].assigned_role === 'toda_admin' && fl[0].details.booking_id === b.booking_id && fl[0].details.last_known_latitude !== null, fl);
  await s.sweep(); await s.sweep();
  check('and only one flag, however often the sweep runs', (await flagsFor(ID.D1, 'TRIP_MANUAL_RECONCILIATION')).length === 1);
  check('the trip is still open and the driver still has it', (await s.booking(b.booking_id)).booking_status === 'Trip Ongoing' && (await s.booking(b.booking_id)).driver_id === ID.D1);
  await internal(`UPDATE admin_review_flag SET status='Resolved', resolution='test' WHERE flag_type='TRIP_MANUAL_RECONCILIATION'`);
  await reset(await s.booking(b.booking_id));

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS3 Rules 10.1 - 10.5: the arrival wait, "I\'m Almost There", and the Passenger No-Show');
  await s.online('D2', 300);                       // D2 has been Online the longer ...
  await s.online('D1', 300);                       // ... D1 came after it: with equal ETA and distance D2 would be offered first
  await clearStrikes();
  b = await bookAndAccept('D2', 'P1');
  await s.moveTo('D2', 5, 10);
  const wBefore = await paxRpc('P1', 'public.get_arrival_wait_status($1)', [b.booking_id]);
  check('before the driver arrives there is no wait to show', wBefore.success === true && wBefore.waiting === false, wBefore);
  const earlyReport = await rpc('D2', 'public.driver_report_no_show($1)', [b.booking_id]);
  check('a no-show cannot be reported before the driver has arrived', earlyReport.success === false && earlyReport.error_code === 'ERR_NOT_ARRIVED', earlyReport);
  await driverSets('D2', b.booking_id, 'In Transit'); await driverSets('D2', b.booking_id, 'Driver Arrived');
  await s.moveTo('D2', 5, 10);
  const wp = await paxRpc('P1', 'public.get_arrival_wait_status($1)', [b.booking_id]);
  check('the passenger sees a 5-minute wait counted from the arrival (server clock), can extend, and learns nothing about the driver\'s position',
    wp.waiting === true && wp.seconds_remaining >= 299 && wp.seconds_remaining <= 300 && wp.wait_total_seconds === 300 && wp.can_extend === true && wp.driver_in_zone === null && wp.can_report_no_show === false, wp);
  const wd = await rpc('D2', 'public.get_arrival_wait_status($1)', [b.booking_id]);
  check('the driver sees the same countdown, that he is at the pickup, and that he cannot report yet', wd.waiting === true && wd.driver_in_zone === true && wd.can_report_no_show === false && wd.can_extend === false, wd);
  const tooSoon = await rpc('D2', 'public.driver_report_no_show($1)', [b.booking_id]);
  check('reporting a no-show before the time is up is refused, with the time left', tooSoon.success === false && tooSoon.error_code === 'ERR_WAIT_NOT_OVER' && tooSoon.seconds_remaining > 290, tooSoon);
  const driverExt = await rpc('D2', 'public.passenger_extend_wait($1)', [b.booking_id]);
  check('the driver cannot extend the passenger\'s wait', driverExt.success === false && driverExt.error_code === 'ERR_NOT_A_PASSENGER', driverExt);
  const paxReport = await paxRpc('P1', 'public.driver_report_no_show($1)', [b.booking_id]);
  check('the passenger cannot report her own no-show', paxReport.success === false && paxReport.error_code === 'ERR_NOT_A_DRIVER', paxReport);
  const strangerReport = await rpc('D1', 'public.driver_report_no_show($1)', [b.booking_id]);
  check('another driver cannot report it either', strangerReport.success === false && strangerReport.error_code === 'ERR_NOT_YOUR_BOOKING', strangerReport);

  await age(b.booking_id, 200);                                     // the passenger has waited 200 s: "I'm Almost There"
  const ext = await paxRpc('P1', 'public.passenger_extend_wait($1)', [b.booking_id]);
  check('"I\'m Almost There" adds exactly 2 minutes: 7 minutes in all, 220 s left after 200 s', ext.success === true && ext.extended === true && ext.wait_total_seconds === 420 && ext.seconds_remaining >= 219 && ext.seconds_remaining <= 220 && ext.can_extend === false, ext);
  const ext2 = await paxRpc('P1', 'public.passenger_extend_wait($1)', [b.booking_id]);
  check('it can be used only once', ext2.success === false && ext2.error_code === 'ERR_ALREADY_EXTENDED', ext2);
  check('and it did not move the deadline a second time', (await paxRpc('P1', 'public.get_arrival_wait_status($1)', [b.booking_id])).wait_total_seconds === 420);
  await age(b.booking_id, 110); await s.moveTo('D2', 5, 10);        // 310 s since arriving: past the original 5 minutes, not past 7
  const still = await rpc('D2', 'public.driver_report_no_show($1)', [b.booking_id]);
  check('310 s after arriving the passenger still has her 2 extra minutes: a no-show is refused', still.success === false && still.error_code === 'ERR_WAIT_NOT_OVER' && still.seconds_remaining > 100 && still.seconds_remaining <= 110, still);
  await age(b.booking_id, 115); await s.moveTo('D2', 5, 10);        // 425 s: past 7 minutes
  const late = await paxRpc('P1', 'public.passenger_extend_wait($1)', [b.booking_id]);
  check('after the wait is over it can no longer be extended', late.success === false, late);

  // The driver must really be at the pickup, on a fix good enough to prove it (PI-06).
  await s.moveTo('D2', 200, 10);
  let rep = await rpc('D2', 'public.driver_report_no_show($1)', [b.booking_id]);
  check('the wait is over but the driver is 200 m away: no no-show (Rule 10.1: he must be at the pickup)', rep.success === false && rep.error_code === 'ERR_NOT_AT_PICKUP', rep);
  await s.moveTo('D2', 5, 80);
  rep = await rpc('D2', 'public.driver_report_no_show($1)', [b.booking_id]);
  check('a fix with 80 m of error proves nothing (limit 50 m): refused', rep.success === false && rep.error_code === 'ERR_NOT_AT_PICKUP', rep);
  await s.moveTo('D2', 5, 10); await silence('D2', 60);
  rep = await rpc('D2', 'public.driver_report_no_show($1)', [b.booking_id]);
  check('a fix a minute old is not used: refused', rep.success === false && rep.error_code === 'ERR_NOT_AT_PICKUP', rep);
  await s.moveTo('D2', 12, 10);                                      // 12 m north, accuracy 10: its accuracy circle reaches the 15 m zone
  const wd2 = await rpc('D2', 'public.get_arrival_wait_status($1)', [b.booking_id]);
  check('the driver\'s screen says he can report it now', wd2.can_report_no_show === true && wd2.seconds_remaining === 0, wd2);

  rep = await rpc('D2', 'public.driver_report_no_show($1)', [b.booking_id]);
  cur = await s.booking(b.booking_id);
  check('the driver reports the no-show: the booking is cancelled, with the reason, by the driver', rep.success === true && cur.booking_status === 'Cancelled' && cur.cancellation_reason === 'PASSENGER_NO_SHOW' && cur.cancelled_by === 'driver', { rep, cur });
  let ps = await strikeRows(ID.P1, 'PAX_NO_SHOW');
  check('the passenger gets 2 strikes (Rule 10.4)', ps.length === 1 && ps[0].points_active === 2, ps);
  check('and is told so, in plain words', (await notes(ID.P1, 'PASSENGER_NO_SHOW')).length === 1 && /2 strikes/.test((await notes(ID.P1, 'PASSENGER_NO_SHOW'))[0].message));
  const rep2 = await rpc('D2', 'public.driver_report_no_show($1)', [b.booking_id]);
  check('a double tap changes nothing: no second strike', rep2.success === true && rep2.already_reported === true && (await strikeRows(ID.P1, 'PAX_NO_SHOW')).length === 1, rep2);
  check('the driver was not struck for anything', (await s.strikes(ID.D2)).length === 0, await s.strikes(ID.D2));
  const revive = await attempt(() => as(s.PAX.P1.uid, (tx) => tx.query(`UPDATE booking SET booking_status='Accepted' WHERE booking_id=$1 RETURNING *`, [b.booking_id])));
  check('a passenger who arrives late cannot reinstate the booking (Rule 10.5)', !revive.ok && /ERR_BOOKING_TRANSITION/.test(revive.error), revive);
  const revive2 = await attempt(() => as(DRIVERS.D2.uid, (tx) => tx.query(`UPDATE booking SET booking_status='Driver Arrived' WHERE booking_id=$1 RETURNING *`, [b.booking_id])));
  check('nor can the driver', !revive2.ok && /ERR_BOOKING_TRANSITION/.test(revive2.error), revive2);
  check('the driver was given the redispatch credit; the other driver has none (Rule 10.4, PI-02)', (await one(`SELECT redispatch_credit c FROM driver_online_session WHERE driver_id='${ID.D2}' AND ended_at IS NULL`)).c === true
    && (await one(`SELECT redispatch_credit c FROM driver_online_session WHERE driver_id='${ID.D1}' AND ended_at IS NULL`)).c === false);
  const rebook = await attempt(() => s.bookAs('P1'));
  check('she can book again at once (a new booking)', rebook.ok === true, rebook.error);

  console.log('\nS3b the driver\'s redispatch credit (decision PI-02 = A): single use, session scoped, only a tie-breaker');
  const b2 = rebook.value;
  const o2 = await s.offers(b2.booking_id);
  check('the driver with the credit is offered the next booking', o2.length === 1 && o2[0].driver_id === ID.D2, o2);
  check('the credit was spent by that offer (single use)', (await one(`SELECT redispatch_credit c FROM driver_online_session WHERE driver_id='${ID.D2}' AND ended_at IS NULL`)).c === false);
  await s.decline('D2', o2[0].attempt_id, 'other'); await reset(await s.booking(b2.booking_id));

  // Prove it breaks a tie that availability would have decided the other way: give the credit to the driver who came Online LATER (D1).
  await s.online('D2', 300); await s.online('D1', 300);             // D2 Online first, D1 second; equal distance and ETA
  let b3 = await s.bookAs('P1');
  let o3 = await s.offers(b3.booking_id);
  check('without a credit the driver who has been available longer (D2) is offered first', o3[0].driver_id === ID.D2, o3);
  await s.decline('D2', o3[0].attempt_id, 'other'); await reset(await s.booking(b3.booking_id));
  await s.online('D2', 300); await s.online('D1', 300);
  await internal(`UPDATE driver_online_session SET redispatch_credit = TRUE WHERE driver_id='${ID.D1}' AND ended_at IS NULL`);
  b3 = await s.bookAs('P1');
  o3 = await s.offers(b3.booking_id);
  check('with the credit D1 is offered first although D2 has been available longer (the credit breaks the tie: first after ETA)', o3[0].driver_id === ID.D1, o3);
  await s.decline('D1', o3[0].attempt_id, 'other'); await reset(await s.booking(b3.booking_id));

  await s.online('D1', 300); await s.online('D2', 100);             // D2 is much closer: a shorter ETA always wins
  await internal(`UPDATE driver_online_session SET redispatch_credit = TRUE WHERE driver_id='${ID.D1}' AND ended_at IS NULL`);
  b3 = await s.bookAs('P1');
  o3 = await s.offers(b3.booking_id);
  check('the credit never beats a shorter ETA: the closer driver (D2) is offered first', o3[0].driver_id === ID.D2, o3);
  check('and a credit that did not decide anything is still there (it is spent only by the offer it ranked ahead for)', (await one(`SELECT redispatch_credit c FROM driver_online_session WHERE driver_id='${ID.D1}' AND ended_at IS NULL`)).c === true);
  await reset(await s.booking(b3.booking_id));
  await s.online('D1', 300);
  check('going Offline and Online again starts a new session without the credit', (await one(`SELECT redispatch_credit c FROM driver_online_session WHERE driver_id='${ID.D1}' AND ended_at IS NULL`)).c === false);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS4 closing the doors: the apps read these clocks, they cannot write them or run the internals');
  await s.online('D1', 300);
  b = await bookAndAccept('D1', 'P1');
  for (const col of ['stall_warned_at', 'stall_anchor_at', 'driver_unreachable_since', 'wait_extended_at', 'stall_delay_reports']) {
    const val = col === 'stall_delay_reports' ? '0' : 'now()';
    const rp = await attempt(() => as(s.PAX.P1.uid, (tx) => tx.query(`UPDATE booking SET ${col} = ${col === 'stall_delay_reports' ? '1' : val} WHERE booking_id=$1`, [b.booking_id])));
    const rd = await attempt(() => as(DRIVERS.D1.uid, (tx) => tx.query(`UPDATE booking SET ${col} = ${col === 'stall_delay_reports' ? '2' : val} WHERE booking_id=$1`, [b.booking_id])));
    check(`neither the passenger nor the driver can write ${col}`, !rp.ok && /ERR_DISPATCH_LOCKED/.test(rp.error) && !rd.ok && /ERR_DISPATCH_LOCKED/.test(rd.error), { rp: rp.error, rd: rd.error });
  }
  for (const [name, args] of [['public.booking_timers_sweep()', ''], ['public._driver_within_pickup_zone($1::uuid, $2::uuid)', `'${ID.D1}'::uuid, '${b.booking_id}'::uuid`]]) {
    const sql = name.includes('$1') ? name.replace('$1::uuid', `'${ID.D1}'::uuid`).replace('$2::uuid', `'${b.booking_id}'::uuid`) : name;
    const r = await attempt(() => as(DRIVERS.D1.uid, (tx) => tx.query(`SELECT ${sql}`)));
    check(`an app cannot call ${name.split('(')[0]}`, !r.ok && /permission denied/i.test(r.error), r.error);
  }
  const anon = await attempt(() => s.db.query(`SET ROLE anon; SELECT public.get_arrival_wait_status('${b.booking_id}'::uuid)`));
  check('an anonymous caller cannot ask for an arrival wait', !anon.ok, anon.error);
  await s.db.query(`RESET ROLE`).catch(() => {});
  const someoneElse = await paxRpc('P2', 'public.get_arrival_wait_status($1)', [b.booking_id]);
  check('another passenger cannot read this booking\'s wait', someoneElse.success === false && someoneElse.error_code === 'ERR_NOT_YOUR_BOOKING', someoneElse);
  await reset(b);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS5 the sweeps read the booking table through their partial indexes (a sweep that scans it gets slower with every trip ever made)');
  // The planner can use a partial index only when the query repeats its predicate as literals (a helper function, however simple, hides it).
  // With sequential scans switched off the planner uses an index whenever one can serve the query, so a Seq Scan left on `booking` is a sweep
  // that cannot. The query is taken from the function's own source, so this fails if either sweep is ever changed back.
  const nodesOf = (plan, out = []) => { if (plan && typeof plan === 'object') { if (plan['Node Type']) out.push(plan); for (const v of Object.values(plan)) nodesOf(v, out); } return out; };
  const planOf = async (signature) => {
    const def = (await one(`SELECT pg_get_functiondef('${signature}'::regprocedure) AS d`)).d;
    const m = def.match(/FOR r IN\s+([\s\S]*?)\s+LOOP/);
    if (!m) throw new Error(`no driving query found in ${signature}`);
    const plan = await s.db.query(`EXPLAIN (FORMAT JSON) ${m[1]}`);
    return nodesOf(plan.rows[0]['QUERY PLAN']);
  };
  await s.db.exec(`SET enable_seqscan = off`);
  const timers = await planOf('public.booking_timers_sweep()');
  check('the sweep of accepted bookings uses idx_booking_open_accepted and never scans booking', timers.some((n) => n['Index Name'] === 'idx_booking_open_accepted') && !timers.some((n) => n['Relation Name'] === 'booking' && n['Node Type'] === 'Seq Scan'), timers.map((n) => `${n['Node Type']} ${n['Relation Name'] || ''} ${n['Index Name'] || ''}`));
  const searches = await planOf('public.dispatch_sweep()');
  check('the sweep of searches uses idx_booking_dispatch_due and never scans booking', searches.some((n) => n['Index Name'] === 'idx_booking_dispatch_due') && !searches.some((n) => n['Relation Name'] === 'booking' && n['Node Type'] === 'Seq Scan'), searches.map((n) => `${n['Node Type']} ${n['Relation Name'] || ''} ${n['Index Name'] || ''}`));
  const control = nodesOf((await s.db.query(`EXPLAIN (FORMAT JSON) SELECT b.booking_id FROM public.booking b WHERE b.driver_id IS NOT NULL AND public._booking_phase(b.booking_status) IN ('assigned', 'arrived', 'ongoing')`)).rows[0]['QUERY PLAN']);
  check('control: the same question asked through the helper function cannot use the partial index (so the two checks above can fail)', !control.some((n) => n['Index Name'] === 'idx_booking_open_accepted'), control.map((n) => `${n['Node Type']} ${n['Relation Name'] || ''} ${n['Index Name'] || ''}`));
  await s.db.exec(`RESET enable_seqscan`);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
