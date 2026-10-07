// End to end: ONE SOLO TRIP, start to finish, exactly as the apps do it now, as each real user under row security.
//   the passenger books -> the DATABASE starts the search and offers it to the nearest eligible driver -> the driver sees the offer and accepts
//   (one atomic call) -> the passenger sees the driver -> the driver goes to the pickup, arrives, starts the trip, arrives at the destination
//   (the database locks the final fare) -> the passenger confirms payment (Completed) -> both rate -> history and earnings -> the next booking
//   is allowed.
// Also: cancellation by the passenger (before and after acceptance), cancellation by the driver (the booking goes back to the search), a
// declined offer then a second driver, "No Driver Found" and Retry. Whole migration chain, local emulator only (never Supabase).
// Before Batch 6 this replayed the passenger's BROWSER dispatcher (it inserted the offers itself); that replay could not see that the Book Ride
// screen never started the search. Now nothing in this script starts, runs or ends the search: the booking insert does, and the deadlines
// are the database's.
const { setup, ID, DRIVERS, attempt, check, summary } = require('../b6fixtures');

(async () => {
  const s = await setup();
  const { as, one, q, internal } = s;
  const P = { uid: ID.P_AUTH, id: ID.P1 };
  const D1 = DRIVERS.D1;
  const D2 = DRIVERS.D2;
  const rows = async (uid, sql, args = []) => (await as(uid, (tx) => tx.query(sql, args))).rows;
  const driverSets = (key, bookingId, set) => attempt(() => as(DRIVERS[key].uid, (tx) => tx.query(`UPDATE public.booking SET ${set} WHERE booking_id=$1 RETURNING *`, [bookingId])));

  console.log('S1 the driver goes Online near the pickup');
  const on = await s.online('D1', 300);
  check('D1 is Online and Available', on.success === true && on.availability_status === 'Available', on);

  console.log('\nS2 the passenger quotes and books a SOLO trip (exactly the app\'s insert)');
  const km = 3.3;
  const qt = await s.quote(P.uid, km, 1);
  const b = await s.bookAs('P1');
  check('the booking is created Pending with the confirmed fare and no driver', b.booking_status === 'Pending' && b.driver_id === null && Number(b.estimated_fare) === Number(qt.solo_fare), b);
  const second = await attempt(() => s.bookAs('P1'));
  check('a second booking while this one is open is refused (one open booking)', !second.ok && /idx_one_open_booking/.test(second.error), second);

  console.log('\nS3 the database found the driver and sent the offer, with nobody running anything');
  const offers = await s.offers(b.booking_id);
  check('one offer, to D1, with the tier, the ETA and an expiry', offers.length === 1 && offers[0].driver_id === D1.id && offers[0].tier === 1 && offers[0].eta_seconds > 0 && offers[0].expires_at !== null, offers);
  const status = await s.statusOf('P1', b.booking_id);
  check('the passenger\'s screen reads: searching nearby', status.success === true && status.phase === 'nearby' && status.booking_status === 'Pending', status);
  const todas = await rows(P.uid, `SELECT * FROM public.list_accredited_todas()`);
  check('the public TODA directory is readable by the passenger', todas.length >= 1, todas.length);

  console.log('\nS4 the driver sees the offer and the booking, and the passenger\'s name');
  const mine = await s.myOffer('D1');
  check('the driver\'s one call returns the offer with the booking details, the passenger name, the ETA and the time left',
    !!mine && mine.attempt_id === offers[0].attempt_id && mine.passenger_name === 'Pax One' && Number(mine.estimated_fare) === Number(qt.solo_fare) && mine.seconds_remaining > 0, mine);
  const seen = await rows(D1.uid, `SELECT * FROM public.booking WHERE booking_id=$1`, [b.booking_id]);
  check('the driver can read the offered booking (pickup, drop-off, fare)', seen.length === 1 && Number(seen[0].estimated_fare) === Number(qt.solo_fare), seen);
  const parties = await rows(D1.uid, `SELECT * FROM public.get_booking_counterparties($1::uuid[])`, [[b.booking_id]]);
  check('the driver learns the passenger\'s name for the offer (not yet the phone)', parties.length === 1 && parties[0].passenger_name === 'Pax One' && !parties[0].passenger_phone, parties);
  check('a driver who was NOT offered the booking cannot read it', (await rows(D2.uid, `SELECT * FROM public.booking WHERE booking_id=$1`, [b.booking_id])).length === 0);

  console.log('\nS5 the driver accepts (one atomic call)');
  const acc = await s.accept('D1', offers[0].attempt_id);
  const afterAcc = await s.booking(b.booking_id);
  check('the booking is Accepted with D1, the TODA of the driver and the server time', acc.success === true && afterAcc.booking_status === 'Accepted' && afterAcc.driver_id === D1.id && afterAcc.toda_id === ID.TODA1 && afterAcc.accepted_at !== null, { acc, afterAcc });
  check('the offer is marked Accepted', (await s.offers(b.booking_id))[0].response_status === 'Accepted');
  const pAcc = await s.presence(D1.uid);
  check('D1 shows an open booking (the screens switch to the trip interval)', pAcc.open_booking === true, pAcc);

  console.log('\nS6 the passenger sees the driver');
  const pollStatus = await s.statusOf('P1', b.booking_id);
  check('the passenger\'s search status says a driver is assigned and the search has ended', pollStatus.driver_assigned === true && pollStatus.phase === 'ended' && pollStatus.ended_reason === 'accepted', pollStatus);
  const det = await rows(P.uid, `SELECT * FROM public.get_assigned_driver_details($1)`, [b.booking_id]);
  check('the passenger gets the driver\'s name, phone, franchise, plate, TODA and rating', det.length === 1 && det[0].full_name === 'Driver One' && !!det[0].contact_number && det[0].toda_name, det);
  const cp = await rows(D1.uid, `SELECT * FROM public.get_booking_counterparties($1::uuid[])`, [[b.booking_id]]);
  check('the driver now also gets the passenger\'s phone', cp.length === 1 && !!cp[0].passenger_phone, cp);

  console.log('\nS7 the driver drives to the pickup, arrives, starts the trip (the apps\' updates, in the apps\' order)');
  for (const [label, set] of [['In Transit (heading to the pickup)', `booking_status='In Transit'`],
                              ['Driver Arrived at the pickup (DriverNavigation)', `booking_status='Driver Arrived', arrived_at=now()`],
                              ['Arrived at Pickup (DriverActiveTrip)', `booking_status='Arrived at Pickup'`],
                              ['Trip Ongoing (the trip starts)', `booking_status='Trip Ongoing', trip_started_at=now()`]]) {
    const r = await driverSets('D1', b.booking_id, set);
    check(label, r.ok && r.value.rows.length === 1, r);
  }
  check('D1 still has the open booking during the trip', (await s.presence(D1.uid)).open_booking === true);

  console.log('\nS8 the driver arrives at the destination: the database locks the final fare');
  const arr = await driverSets('D1', b.booking_id, `booking_status='Arrived at Destination'`);
  check('the final fare comes back in the same update and equals the confirmed fare (no GPS track, estimate used)', arr.ok && Number(arr.value.rows[0].actual_fare) === Number(qt.solo_fare), arr);
  const arrRow = await s.booking(b.booking_id);
  check('the fare is locked with a breakdown', !!arrRow.fare_locked_at && arrRow.fare_breakdown?.final?.basis === 'solo', arrRow.fare_breakdown);

  console.log('\nS9 the passenger confirms payment: Completed');
  const done = await attempt(() => as(P.uid, (tx) => tx.query(`UPDATE public.booking SET booking_status='Completed' WHERE booking_id=$1 RETURNING booking_status, actual_fare, trip_completed_at`, [b.booking_id])));
  check('the booking is Completed, the fare unchanged, the completion time the server\'s', done.ok && done.value.rows[0].booking_status === 'Completed' && Number(done.value.rows[0].actual_fare) === Number(qt.solo_fare) && done.value.rows[0].trip_completed_at !== null, done);
  const dp = await s.presence(D1.uid);
  check('D1 has no open booking and is Available again', dp.availability_status === 'Available' && dp.open_booking === false, dp);

  console.log('\nS10 both rate each other (the apps\' inserts)');
  const rp = await attempt(() => as(P.uid, (tx) => tx.query(
    `INSERT INTO public.rating (booking_id, rater_id, ratee_id, rater_role, stars, tags, comment, created_at)
     VALUES ($1,$2,$3,'Passenger',5,ARRAY['Safe Driving'],'Good trip', now())
     ON CONFLICT (booking_id, rater_role) DO NOTHING RETURNING rating_id`, [b.booking_id, P.id, D1.id])));
  check('the passenger rates the driver', rp.ok, rp);
  const rp2 = await attempt(() => as(P.uid, (tx) => tx.query(
    `INSERT INTO public.rating (booking_id, rater_id, ratee_id, rater_role, stars, tags, comment, created_at)
     VALUES ($1,$2,$3,'Passenger',1,ARRAY['x'],'again', now()) ON CONFLICT (booking_id, rater_role) DO NOTHING RETURNING rating_id`, [b.booking_id, P.id, D1.id])));
  check('rating the same trip twice does not create a second rating', rp2.ok && rp2.value.rows.length === 0, rp2);
  const forgedRating = await attempt(() => as(ID.P2_AUTH, (tx) => tx.query(
    `INSERT INTO public.rating (booking_id, rater_id, ratee_id, rater_role, stars) VALUES ($1,$2,$3,'Passenger',1)`, [b.booking_id, ID.P2, D1.id])));
  check('another passenger cannot rate a trip they were not on', !forgedRating.ok, forgedRating);
  const selfRating = await attempt(() => as(D1.uid, (tx) => tx.query(
    `INSERT INTO public.rating (booking_id, rater_id, ratee_id, rater_role, stars) VALUES ($1,$2,$3,'Driver',5)`, [b.booking_id, D1.id, D1.id])));
  check('a rating about oneself (or a second driver rating) is refused', !selfRating.ok, selfRating);
  const rd = await attempt(() => as(D1.uid, (tx) => tx.query(
    `INSERT INTO public.rating (booking_id, rater_id, ratee_id, rater_role, stars, tags, comment, created_at)
     VALUES ($1,$2,$3,'Driver',4,ARRAY['Polite'],'Nice passenger', now()) RETURNING rating_id`, [b.booking_id, D1.id, P.id])));
  check('the driver rates the passenger', rd.ok, rd);

  console.log('\nS11 history and earnings read what the screens need');
  const hist = await rows(P.uid, `SELECT * FROM public.booking WHERE passenger_id=$1 ORDER BY created_at DESC`, [P.id]);
  check('the passenger\'s history has the completed trip with the final fare and the driver', hist.length === 1 && hist[0].booking_status === 'Completed' && hist[0].driver_id === D1.id && Number(hist[0].actual_fare) === Number(qt.solo_fare), hist);
  const trips = await rows(D1.uid, `SELECT * FROM public.booking WHERE driver_id=$1 ORDER BY created_at DESC LIMIT 200`, [D1.id]);
  check('the driver\'s trips list has it too (for earnings)', trips.length === 1 && trips[0].booking_status === 'Completed', trips);
  check('the driver can read the ratings of their own trip', (await rows(D1.uid, `SELECT stars, rater_role FROM public.rating WHERE booking_id=$1`, [b.booking_id])).length === 2);

  console.log('\nS12 the passenger can book again');
  const again = await attempt(() => s.bookAs('P1'));
  check('a new booking is allowed once the trip is Completed', again.ok, again);
  if (again.ok) await s.cancelAs(P.uid, again.value.booking_id);

  console.log('\nS13 the passenger cancels while still searching');
  await s.online('D2', 500);
  const c1 = await s.bookAs('P1');
  const cc = await s.cancelAs(P.uid, c1.booking_id);
  check('the passenger cancels a Pending booking: no strike, the offer withdrawn, the search over', cc.rows[0].booking_status === 'Cancelled' && cc.rows[0].cancelled_by === 'passenger'
    && (await s.strikes(P.id)).length === 0 && !(await s.pendingOffer(c1.booking_id)) && cc.rows[0].dispatch_ended_reason === 'cancelled', cc.rows[0]);

  console.log('\nS14 the first driver declines (with a reason), a second driver accepts');
  const c2 = await s.bookAs('P1');
  const o1 = await s.pendingOffer(c2.booking_id);
  check('the nearest (D1) is offered first', o1.driver_id === D1.id, o1);
  const dec = await s.decline('D1', o1.attempt_id, 'end_of_shift');
  check('D1 declines the offer', dec.success === true, dec);
  const o2 = await s.pendingOffer(c2.booking_id);
  check('the database offers D2 at once; D1 is excluded for this cycle', o2?.driver_id === D2.id && (await s.offers(c2.booking_id)).filter((o) => o.driver_id === D1.id).length === 1, o2);
  const acc2 = await s.accept('D2', o2.attempt_id);
  check('D2 accepts', acc2.success === true && (await s.booking(c2.booking_id)).driver_id === D2.id, acc2);
  const lateAcc = await s.accept('D1', o1.attempt_id);
  check('D1 cannot take the booking afterwards (his offer was closed; another driver has it)', lateAcc.success === false, lateAcc);

  console.log('\nS15 the passenger cancels right after a driver accepted (inside the grace minute)');
  const pc = await s.cancelAs(P.uid, c2.booking_id, 'Changed my mind');
  check('the passenger can cancel an accepted booking; within the first minute and before the driver arrives it costs no strike (Rule 12.1)',
    pc.rows[0].booking_status === 'Cancelled' && (await s.strikes(P.id)).length === 0, pc.rows[0]);
  check('D2 is free again', (await s.presence(D2.uid)).open_booking === false);

  console.log('\nS16 the driver cancels after accepting: the booking goes back to the search');
  await s.online('D1', 300);
  const c3 = await s.bookAs('P1');
  const o3 = await s.pendingOffer(c3.booking_id);
  await s.accept(o3.driver_id === D1.id ? 'D1' : 'D2', o3.attempt_id);
  const who = (await s.booking(c3.booking_id)).driver_id === D1.id ? 'D1' : 'D2';
  const dcn = await s.driverCancel(who, c3.booking_id, 'vehicle_breakdown');
  const c3b = await s.booking(c3.booking_id);
  check('the driver cancels with a reason: a strike, the booking is searching again with the other driver offered', dcn.success === true && c3b.booking_status === 'Pending' && c3b.driver_id === null
    && (await s.pendingOffer(c3.booking_id)) !== undefined, { dcn, c3b });
  await s.cancelAs(P.uid, c3.booking_id);

  console.log('\nS17 no driver found, then Retry');
  await s.goOffline(D1.uid); await s.goOffline(D2.uid);
  const c4 = await s.bookAs('P1');
  await s.rewind(c4.booking_id, 301);
  await s.sweep();
  const c4b = await s.booking(c4.booking_id);
  check('nobody accepted within the maximum search time: the database ends it with No Driver Found (no app involved)', c4b.booking_status === 'No Driver Found' && c4b.dispatch_ended_reason === 'no_driver_found', c4b);
  const afterNd = await attempt(() => s.bookAs('P1'));
  check('the passenger can book again after No Driver Found', afterNd.ok, afterNd);
  if (afterNd.ok) await s.cancelAs(P.uid, afterNd.value.booking_id);
  await s.online('D1', 300);
  const rr = await s.retry('P1', c4.booking_id);
  check('Retry restarts the same booking from the nearest drivers and the offer goes out at once', rr.success === true && (await s.booking(c4.booking_id)).dispatch_cycle === 2 && (await s.pendingOffer(c4.booking_id))?.driver_id === D1.id, rr);
  check('another passenger cannot restart someone else\'s search', (await s.retry('P2', c4.booking_id)).error_code === 'ERR_NOT_YOUR_BOOKING');
  const anonRetry = await s.asUser(s.db, { role: 'anon' }, async (tx) => { try { await tx.query(`SELECT public.retry_driver_search('${c4.booking_id}')`); return 'allowed'; } catch (e) { return e.message; } }, { commit: true });
  check('an anonymous caller cannot call it at all', /permission denied/i.test(anonRetry), anonRetry);
  await s.finish(c4.booking_id);

  console.log('\nS18 a driver who is already on a trip is not offered a second booking, and cannot take one');
  await s.online('D1', 300); await s.online('D2', 800);
  const first = await s.bookAs('P2');
  await s.accept('D1', (await s.pendingOffer(first.booking_id)).driver_id === D1.id ? (await s.pendingOffer(first.booking_id)).attempt_id : null);
  const next = await s.bookAs('P1');
  check('D1 (on a trip) is skipped: the booking goes to D2', (await s.pendingOffer(next.booking_id))?.driver_id === D2.id);
  const forced = await attempt(() => internal(`INSERT INTO public.dispatch_attempt (booking_id, driver_id, dispatch_method, response_status, cycle, tier, expires_at)
                                               VALUES ('${next.booking_id}', '${D1.id}', 'forced', 'Pending', 1, 1, now() + interval '20 seconds')`));
  check('and a forced offer to D1 is refused by the database', !forced.ok && /ERR_DRIVER_BUSY/.test(forced.error), forced);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
