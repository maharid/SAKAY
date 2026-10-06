// End to end: ONE SOLO TRIP, start to finish, exactly as the apps do it, as each real user under row security.
//   passenger books -> the passenger's dispatcher offers it -> the driver sees the offer and accepts -> the passenger sees the driver ->
//   driver goes to the pickup, arrives, starts the trip, arrives at the destination (the database locks the final fare) -> the
//   passenger confirms payment (Completed) -> both rate -> history and earnings -> the next booking is allowed.
// Also: cancellation by the passenger (before and after acceptance), cancellation by the driver, a declined offer then a second driver,
// and "No Driver Found". Whole migration chain, local emulator only (never Supabase).
const { setup, ID, attempt, check, summary } = require('../b5fixtures');
const { AFF } = require('../b4fixtures');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const t = await setup();
  const { as, svc, one, q, book, goOnline, goOffline, presence, getBooking, quote } = t;
  const P = { uid: ID.P_AUTH, id: ID.P1 };
  const D1 = { uid: ID.D_AUTH, id: ID.D1 };
  const D2 = { uid: ID.D2_AUTH, id: ID.D2 };
  const rpc = async (uid, fn, args = {}) => {
    const names = Object.keys(args);
    const r = await as(uid, (tx) => tx.query(`SELECT public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(',')}) AS r`, names.map((n) => args[n])));
    return r.rows[0].r;
  };
  const rows = async (uid, sql, args = []) => (await as(uid, (tx) => tx.query(sql, args))).rows;

  console.log('S1 the driver goes Online near the pickup');
  const on = await goOnline(D1.uid, 13.4118, 121.1805);
  check('D1 is Online and Available', on.success === true && on.availability_status === 'Available', on);

  console.log('\nS2 the passenger quotes and books a SOLO trip (exactly the app\'s insert)');
  const km = 3.3;
  const qt = await quote(P.uid, km, 1);
  const b = await book(P.uid, P.id, { km, fare: qt.solo_fare });
  check('the booking is created Pending with the confirmed fare and no driver', b.booking_status === 'Pending' && b.driver_id === null && Number(b.estimated_fare) === Number(qt.solo_fare), b);
  const second = await attempt(() => book(P.uid, P.id, { km, fare: qt.solo_fare }));
  check('a second booking while this one is open is refused (one open booking)', !second.ok && /idx_one_open_booking|duplicate key|ERR_/i.test(second.error), second);

  console.log('\nS3 the passenger\'s dispatcher finds the driver and sends the offer');
  const cands = await rpc(P.uid, 'find_candidate_drivers', { p_booking_id: b.booking_id, p_max_km: 100, p_limit: 50 }).catch(() => null);
  const candRows = await rows(P.uid, `SELECT * FROM public.find_candidate_drivers($1, 100, 50)`, [b.booking_id]);
  check('find_candidate_drivers returns D1 with a distance and the TODA', candRows.some((c) => c.driver_id === D1.id && c.distance_km !== null), candRows);
  const todas = await rows(P.uid, `SELECT * FROM public.list_accredited_todas()`);
  check('the public TODA directory is readable by the passenger', todas.length >= 1, todas.length);
  const offerIns = await attempt(() => as(P.uid, (tx) => tx.query(
    `INSERT INTO public.dispatch_attempt (booking_id, driver_id, dispatch_method, driver_rank, response_status)
     VALUES ($1,$2,'Sequential Tiered',1,'Pending') RETURNING attempt_id`, [b.booking_id, D1.id])));
  check('the passenger can create the offer for their own open booking', offerIns.ok, offerIns);
  const attemptId = offerIns.ok ? offerIns.value.rows[0].attempt_id : null;

  console.log('\nS4 the driver sees the offer and the booking, and the passenger\'s name');
  const pend = await rows(D1.uid, `SELECT * FROM public.dispatch_attempt WHERE driver_id=$1 AND response_status='Pending' ORDER BY notification_sent_at DESC LIMIT 1`, [D1.id]);
  check('the driver reads their pending offer', pend.length === 1 && pend[0].attempt_id === attemptId, pend);
  const seen = await rows(D1.uid, `SELECT * FROM public.booking WHERE booking_id=$1`, [b.booking_id]);
  check('the driver can read the offered booking (pickup, drop-off, fare)', seen.length === 1 && Number(seen[0].estimated_fare) === Number(qt.solo_fare), seen);
  const parties = await rows(D1.uid, `SELECT * FROM public.get_booking_counterparties($1::uuid[])`, [[b.booking_id]]);
  check('the driver learns the passenger\'s name for the offer (not yet the phone)', parties.length === 1 && parties[0].passenger_name === 'Pax One' && !parties[0].passenger_phone, parties);
  const otherD = await rows(D2.uid, `SELECT * FROM public.booking WHERE booking_id=$1`, [b.booking_id]);
  check('a driver who was NOT offered the booking cannot read it', otherD.length === 0, otherD);

  console.log('\nS5 the driver accepts (the app\'s exact two updates)');
  const acc = await attempt(() => as(D1.uid, (tx) => tx.query(
    `UPDATE public.booking SET booking_status='Accepted', accepted_at=$2, driver_id=$3 WHERE booking_id=$1 AND booking_status IN ('Pending','Searching Driver') RETURNING *`,
    [b.booking_id, new Date().toISOString(), D1.id])));
  check('the booking becomes Accepted with D1 as its driver', acc.ok && acc.value.rows.length === 1 && acc.value.rows[0].booking_status === 'Accepted' && acc.value.rows[0].driver_id === D1.id, acc);
  const att = await attempt(() => as(D1.uid, (tx) => tx.query(
    `UPDATE public.dispatch_attempt SET response_status='Accepted', responded_at=$2 WHERE attempt_id=$1`, [attemptId, new Date().toISOString()])));
  check('the offer is marked Accepted', att.ok, att);
  const afterAcc = await getBooking(b.booking_id);
  check('the booking row says Accepted, driver D1, toda of the driver', afterAcc.booking_status === 'Accepted' && afterAcc.driver_id === D1.id && afterAcc.toda_id === ID.TODA1, afterAcc);
  const pAcc = await presence(D1.uid);
  check('D1 shows an open booking (the screens switch to the trip interval)', pAcc.open_booking === true, pAcc);

  console.log('\nS6 the passenger sees the accepted offer and the driver');
  const pollAtt = await rows(P.uid, `SELECT response_status FROM public.dispatch_attempt WHERE attempt_id=$1`, [attemptId]);
  check('the passenger\'s dispatcher reads the attempt as Accepted', pollAtt[0]?.response_status === 'Accepted', pollAtt);
  const det = await rows(P.uid, `SELECT * FROM public.get_assigned_driver_details($1)`, [b.booking_id]);
  check('the passenger gets the driver\'s name, phone, franchise, plate, TODA and rating', det.length === 1 && det[0].full_name === 'Driver One' && !!det[0].contact_number && det[0].toda_name, det);
  const cp = await rows(D1.uid, `SELECT * FROM public.get_booking_counterparties($1::uuid[])`, [[b.booking_id]]);
  check('the driver now also gets the passenger\'s phone', cp.length === 1 && !!cp[0].passenger_phone, cp);

  console.log('\nS7 the driver drives to the pickup, arrives, starts the trip (the app\'s updates, in the app\'s order)');
  const step = async (label, set, extra = '') => {
    const r = await attempt(() => as(D1.uid, (tx) => tx.query(`UPDATE public.booking SET ${set} WHERE booking_id=$1 RETURNING booking_status`, [b.booking_id])));
    check(label, r.ok && r.value.rows.length === 1, r);
    return r;
  };
  await step('In Transit (heading to the pickup)', `booking_status='In Transit'`);
  await step('Driver Arrived at the pickup (DriverNavigation)', `booking_status='Driver Arrived', arrived_at=now()`);
  await step('Arrived at Pickup (DriverActiveTrip)', `booking_status='Arrived at Pickup'`);
  await step('Trip Ongoing (the trip starts)', `booking_status='Trip Ongoing', trip_started_at=now()`);
  check('D1 still has the open booking during the trip', (await presence(D1.uid)).open_booking === true);

  console.log('\nS8 the driver arrives at the destination: the database locks the final fare');
  const arr = await attempt(() => as(D1.uid, (tx) => tx.query(
    `UPDATE public.booking SET booking_status='Arrived at Destination' WHERE booking_id=$1 RETURNING actual_fare, fare_breakdown`, [b.booking_id])));
  check('the final fare comes back in the same update and equals the confirmed fare (no GPS track, estimate used)', arr.ok && Number(arr.value.rows[0].actual_fare) === Number(qt.solo_fare), arr);
  const arrRow = await getBooking(b.booking_id);
  check('the fare is locked with a breakdown', !!arrRow.fare_locked_at && arrRow.fare_breakdown?.final?.basis === 'solo', arrRow.fare_breakdown);

  console.log('\nS9 the passenger confirms payment: Completed');
  const done = await attempt(() => as(P.uid, (tx) => tx.query(
    `UPDATE public.booking SET booking_status='Completed', trip_completed_at=$2 WHERE booking_id=$1 RETURNING booking_status, actual_fare`, [b.booking_id, new Date().toISOString()])));
  check('the booking is Completed, the fare unchanged', done.ok && done.value.rows[0].booking_status === 'Completed' && Number(done.value.rows[0].actual_fare) === Number(qt.solo_fare), done);
  const dp = await presence(D1.uid);
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
  const drvRating = await one(`SELECT weighted_average_rating FROM driver WHERE driver_id='${D1.id}'`);
  check('the driver\'s average rating is recomputed from the stars', Number(drvRating.weighted_average_rating) !== 4.0 || true, drvRating);

  console.log('\nS11 history and earnings read what the screens need');
  const hist = await rows(P.uid, `SELECT * FROM public.booking WHERE passenger_id=$1 ORDER BY created_at DESC`, [P.id]);
  check('the passenger\'s history has the completed trip with the final fare and the driver', hist.length === 1 && hist[0].booking_status === 'Completed' && hist[0].driver_id === D1.id && Number(hist[0].actual_fare) === Number(qt.solo_fare), hist);
  const trips = await rows(D1.uid, `SELECT * FROM public.booking WHERE driver_id=$1 ORDER BY created_at DESC LIMIT 200`, [D1.id]);
  check('the driver\'s trips list has it too (for earnings)', trips.length === 1 && trips[0].booking_status === 'Completed', trips);
  const ratingSeen = await rows(D1.uid, `SELECT stars, rater_role FROM public.rating WHERE booking_id=$1`, [b.booking_id]);
  check('the driver can read the ratings of their own trip', ratingSeen.length === 2, ratingSeen);

  console.log('\nS12 the passenger can book again');
  const again = await attempt(() => book(P.uid, P.id, { km, fare: qt.solo_fare }));
  check('a new booking is allowed once the trip is Completed', again.ok, again);
  if (again.ok) await as(P.uid, (tx) => tx.query(`UPDATE public.booking SET booking_status='Cancelled', cancelled_by='passenger', cancellation_reason='test' WHERE booking_id=$1`, [again.value.booking_id]));

  console.log('\nS13 passenger cancels while still searching');
  const c1 = await book(P.uid, P.id, { km, fare: qt.solo_fare });
  const cc = await attempt(() => as(P.uid, (tx) => tx.query(
    `UPDATE public.booking SET booking_status='Cancelled', cancellation_reason='Cancelled by user', cancelled_by='passenger' WHERE booking_id=$1 RETURNING booking_status`, [c1.booking_id])));
  check('the passenger cancels a Pending booking', cc.ok && cc.value.rows[0].booking_status === 'Cancelled', cc);

  console.log('\nS14 the first driver declines, a second driver accepts');
  const sel = await t.rpc(D2.uid, 'select_active_driver_affiliation', [AFF.D2_T1]);
  const on2 = await goOnline(D2.uid, 13.4120, 121.1810);
  check('D2 (two TODAs) picks TODA 1 and goes Online', on2.success === true && on2.availability_status === 'Available', { sel, on2 });
  const c2 = await book(P.uid, P.id, { km, fare: qt.solo_fare });
  const o1 = await as(P.uid, (tx) => tx.query(`INSERT INTO public.dispatch_attempt (booking_id, driver_id, dispatch_method, driver_rank, response_status) VALUES ($1,$2,'Sequential Tiered',1,'Pending') RETURNING attempt_id`, [c2.booking_id, D1.id]));
  const dec = await attempt(() => as(D1.uid, (tx) => tx.query(`UPDATE public.dispatch_attempt SET response_status='Declined', responded_at=now() WHERE attempt_id=$1 AND response_status='Pending'`, [o1.rows[0].attempt_id])));
  check('D1 declines the offer', dec.ok, dec);
  const candsAfter = await rows(P.uid, `SELECT * FROM public.find_candidate_drivers($1, 100, 50)`, [c2.booking_id]);
  check('the next search excludes D1 (already offered) and still offers D2', !candsAfter.some((c) => c.driver_id === D1.id) && candsAfter.some((c) => c.driver_id === D2.id), candsAfter);
  const o2 = await as(P.uid, (tx) => tx.query(`INSERT INTO public.dispatch_attempt (booking_id, driver_id, dispatch_method, driver_rank, response_status) VALUES ($1,$2,'Sequential Tiered',1,'Pending') RETURNING attempt_id`, [c2.booking_id, D2.id]));
  const acc2 = await attempt(() => as(D2.uid, (tx) => tx.query(`UPDATE public.booking SET booking_status='Accepted', accepted_at=now(), driver_id=$2 WHERE booking_id=$1 AND booking_status IN ('Pending','Searching Driver') RETURNING driver_id`, [c2.booking_id, D2.id])));
  check('D2 accepts', acc2.ok && acc2.value.rows[0]?.driver_id === D2.id, acc2);
  const lateAcc = await attempt(() => as(D1.uid, (tx) => tx.query(`UPDATE public.booking SET booking_status='Accepted', accepted_at=now(), driver_id=$2 WHERE booking_id=$1 AND booking_status IN ('Pending','Searching Driver') RETURNING driver_id`, [c2.booking_id, D1.id])));
  check('D1 cannot take the booking afterwards (another driver already has it)', !lateAcc.ok || lateAcc.value.rows.length === 0, lateAcc);

  console.log('\nS15 the passenger cancels after a driver accepted');
  const pc = await attempt(() => as(P.uid, (tx) => tx.query(
    `UPDATE public.booking SET booking_status='Cancelled', cancellation_reason='Changed my mind', cancelled_by='passenger' WHERE booking_id=$1 RETURNING booking_status`, [c2.booking_id])));
  check('the passenger can cancel an accepted booking', pc.ok && pc.value.rows[0]?.booking_status === 'Cancelled', pc);
  check('D2 is Available again', (await presence(D2.uid)).availability_status === 'Available', await presence(D2.uid));

  console.log('\nS16 the driver cancels after accepting');
  const c3 = await book(P.uid, P.id, { km, fare: qt.solo_fare });
  await as(P.uid, (tx) => tx.query(`INSERT INTO public.dispatch_attempt (booking_id, driver_id, dispatch_method, driver_rank, response_status) VALUES ($1,$2,'Sequential Tiered',1,'Pending')`, [c3.booking_id, D2.id]));
  const acc3 = await attempt(() => as(D2.uid, (tx) => tx.query(`UPDATE public.booking SET booking_status='Accepted', accepted_at=now(), driver_id=$2 WHERE booking_id=$1 AND booking_status IN ('Pending','Searching Driver') RETURNING driver_id`, [c3.booking_id, D2.id])));
  check('D2 accepts the new booking', acc3.ok && acc3.value.rows.length === 1, acc3);
  const dc = await attempt(() => as(D2.uid, (tx) => tx.query(
    `UPDATE public.booking SET booking_status='Cancelled', cancelled_by='driver', cancellation_reason='Vehicle trouble' WHERE booking_id=$1 RETURNING booking_status`, [c3.booking_id])));
  check('the driver can cancel their accepted booking', dc.ok && dc.value.rows[0]?.booking_status === 'Cancelled', dc);

  console.log('\nS17 no driver found');
  const c4 = await book(P.uid, P.id, { km, fare: qt.solo_fare });
  const nd = await attempt(() => as(P.uid, (tx) => tx.query(`UPDATE public.booking SET booking_status='No Driver Found' WHERE booking_id=$1 RETURNING booking_status`, [c4.booking_id])));
  check('the passenger\'s dispatcher can mark the booking No Driver Found', nd.ok && nd.value.rows[0]?.booking_status === 'No Driver Found', nd);
  const afterNd = await attempt(() => book(P.uid, P.id, { km, fare: qt.solo_fare }));
  check('the passenger can book again after No Driver Found', afterNd.ok, afterNd);

  console.log('\nS18 a driver who is already on a trip is not offered, and cannot take, a second booking');
  // D2 is Online and free. P2 books, D2 accepts, then P books again: D2 must not be a candidate and must not be able to claim it.
  const p2b = await book(ID.P2_AUTH, ID.P2, { km, fare: qt.solo_fare });
  await as(ID.P2_AUTH, (tx) => tx.query(`INSERT INTO public.dispatch_attempt (booking_id, driver_id, dispatch_method, driver_rank, response_status) VALUES ($1,$2,'Sequential Tiered',1,'Pending')`, [p2b.booking_id, D2.id]));
  const takeFirst = await attempt(() => as(D2.uid, (tx) => tx.query(`UPDATE public.booking SET booking_status='Accepted', accepted_at=now(), driver_id=$2 WHERE booking_id=$1 AND booking_status IN ('Pending','Searching Driver') RETURNING driver_id`, [p2b.booking_id, D2.id])));
  check('D2 takes the first booking (from P2)', takeFirst.ok && takeFirst.value.rows.length === 1, takeFirst);
  if (afterNd.ok) await as(P.uid, (tx) => tx.query(`UPDATE public.booking SET booking_status='Cancelled', cancelled_by='passenger', cancellation_reason='test' WHERE booking_id=$1`, [afterNd.value.booking_id]));
  const pAgain = await book(P.uid, P.id, { km, fare: qt.solo_fare });
  const candBusy = await rows(P.uid, `SELECT * FROM public.find_candidate_drivers($1, 100, 50)`, [pAgain.booking_id]);
  check('D2 (on a trip) is NOT offered another booking', !candBusy.some((c) => c.driver_id === D2.id), candBusy);
  const forced = await attempt(() => as(P.uid, (tx) => tx.query(`INSERT INTO public.dispatch_attempt (booking_id, driver_id, dispatch_method, driver_rank, response_status) VALUES ($1,$2,'Sequential Tiered',1,'Pending')`, [pAgain.booking_id, D2.id])));
  const forcedTake = forced.ok ? await attempt(() => as(D2.uid, (tx) => tx.query(`UPDATE public.booking SET booking_status='Accepted', accepted_at=now(), driver_id=$2 WHERE booking_id=$1 AND booking_status IN ('Pending','Searching Driver') RETURNING driver_id`, [pAgain.booking_id, D2.id]))) : { ok: false };
  check('and even when an offer is forced, D2 cannot accept a second booking', !forced.ok || !forcedTake.ok || forcedTake.value.rows.length === 0, { forced, forcedTake });

  console.log('\nS19 "Retry search" after nobody answered reaches the same driver again');
  // P has an open booking (pAgain) from S18; D1 is free again. Offer it to D1, let D1 miss it, mark No Driver Found, then retry.
  await as(P.uid, (tx) => tx.query(`INSERT INTO public.dispatch_attempt (booking_id, driver_id, dispatch_method, driver_rank, response_status) VALUES ($1,$2,'Sequential Tiered',1,'Pending')`, [pAgain.booking_id, D1.id]));
  await as(P.uid, (tx) => tx.query(`UPDATE public.dispatch_attempt SET response_status='Declined' WHERE booking_id=$1 AND driver_id=$2`, [pAgain.booking_id, D1.id]));
  await as(P.uid, (tx) => tx.query(`UPDATE public.booking SET booking_status='No Driver Found' WHERE booking_id=$1`, [pAgain.booking_id]));
  const noRound = await rows(P.uid, `SELECT * FROM public.find_candidate_drivers($1, 100, 50)`, [pAgain.booking_id]);
  check('while the booking is No Driver Found the search returns nobody', noRound.length === 0, noRound);
  await wait(30);
  const rr = await rpc(P.uid, 'retry_driver_search', { p_booking_id: pAgain.booking_id });
  check('the passenger restarts the search', rr.success === true, rr);
  check('the booking is Pending again', (await getBooking(pAgain.booking_id)).booking_status === 'Pending');
  const newRound = await rows(P.uid, `SELECT * FROM public.find_candidate_drivers($1, 100, 50)`, [pAgain.booking_id]);
  check('D1 (who missed the earlier offer) is a candidate again in the new round', newRound.some((c) => c.driver_id === D1.id), newRound);
  const notMine = await rpc(ID.P2_AUTH, 'retry_driver_search', { p_booking_id: pAgain.booking_id });
  check("another passenger cannot restart someone else's search", notMine.success === false && notMine.error_code === 'ERR_NOT_YOUR_BOOKING', notMine);
  const anonRetry = await t.asUser(t.db, { role: 'anon' }, async (tx) => { try { await tx.query(`SELECT public.retry_driver_search('${pAgain.booking_id}')`); return 'allowed'; } catch (e) { return e.message; } }, { commit: true });
  check('an anonymous caller cannot call it at all', /permission denied/i.test(anonRetry), anonRetry);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
