// Batch 10 / the fare of a matched leg (Rules 14.7, 6.1.3 - 6.1.5, 6.5; PI-04 Option B; decisions D10-3 and N9).
//   S1  a trip carried by two bookings (A boards at 0 km, B at 3 km, both off at 8 km): each leg is settled by allocate_shared_fares() from the vehicle's route;
//       the leg that ends first is locked with the other's remaining estimated distance, the second from the whole actual route
//   S2  the split follows the declared head-count (1 and 2 passengers share one route 1 : 2)
//   S3  never more than the booking's own Solo (Maximum Unmatched) fare; a leg that rode alone pays the vehicle fare of its route
//   S4  nothing measurable: the Batch 5 matched estimate stands (never more than the passenger accepted)
//   S5  a booking cannot borrow a pairing that is not its own (the fare of a matched trip depends on it)
//   S6  N9: a matched leg ended early is settled for the distance travelled; the remaining leg's share is recomputed
// The vehicle's route is a recorded GPS track: 100 m and 5 s between fixes (see track() in b10fixtures.js).
const { setup, ID, DRIVERS, check, summary } = require('../b10fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, at } = s;
  const near = (v, target, tol) => typeof v === 'number' && Math.abs(v - target) <= tol;
  const legsOf = (leg, thisId, otherId) => [
    { booking_id: thisId, passenger_count: leg.passenger_count, board_km: leg.board_km, alight_km: leg.alight_km },
    { booking_id: otherId, passenger_count: leg.other_passenger_count, board_km: leg.other_board_km, alight_km: leg.other_alight_km }];
  const fareOf = async (leg, thisId, otherId) => {
    const r = await s.allocate(legsOf(leg, thisId, otherId));
    return r.bookings.find((x) => x.booking_id === thisId);
  };
  const soloFare = async (b) => Number((await s.fare(Number(b.estimated_distance_km), 'Solo', 1)).solo_fare);
  const finalOf = (b) => b.fare_breakdown && b.fare_breakdown.final;

  // The trip of the Rule 6.1.6 Scenario 3: A boards at the pickup, B joins 3 km on, both get off at 8 km. Returns the two bookings (both ongoing).
  const twoOnBoard = async ({ countB = 1, joinFix = 30, endFix = 80, track = true, destM = 8000 } = {}) => {
    const A0 = await s.host({ stage: 'ongoing', o: { dropoff: at(destM) } });
    await s.startedAt(A0.booking_id, s.trackTime(0));
    if (track) await s.track([A0.booking_id], 'D1', 0, joinFix);
    await s.driverIsAt('D1', joinFix * 100);
    await s.online('D2', 400);
    const p = await s.propose({ count: countB, pickupNorth: joinFix * 100, dropNorth: destM });
    if (!p.m) throw new Error('twoOnBoard: no proposal');
    await s.agree(p.m);
    for (const st of ['In Transit', 'Driver Arrived', 'Trip Ongoing']) { const r = await s.driverSets('D1', p.b.booking_id, st); if (!r.ok) throw new Error('B ' + st + ': ' + r.error); }
    await s.startedAt(p.b.booking_id, s.trackTime(joinFix));
    if (track) await s.track([A0.booking_id, p.b.booking_id], 'D1', joinFix + 1, endFix);
    return { A: await s.bk(A0.booking_id), B: await s.bk(p.b.booking_id), m: p.m };
  };

  console.log('S1 Scenario 3 on a real route: A boards at 0 km, B at 3 km, both get off at 8 km');
  let t = await twoOnBoard();
  check('(precondition) both bookings are on board, one pairing, one driver, 8 km recorded', t.A.booking_status === 'Trip Ongoing' && t.B.booking_status === 'Trip Ongoing' && t.A.shared_trip_match_id === t.B.shared_trip_match_id && t.B.driver_id === ID.D1);
  let r = await s.driverEnds('D1', t.A.booking_id);
  check('(A ends the trip first)', r.ok, r.error);
  const a = await s.bk(t.A.booking_id);
  const fa = finalOf(a);
  check('the first leg to end is settled by the allocation model: basis "shared_allocated"', fa.basis === 'shared_allocated' && !!fa.shared_leg, fa);
  const la = fa.shared_leg;
  check('A rode from km 0 to about km 8 of the vehicle\'s route; B boarded at about km 3', near(la.board_km, 0, 0.01) && near(la.alight_km, 8.0, 0.15) && near(la.other_board_km, 3.0, 0.15), la);
  check('B was still on board: its end is PROJECTED from its remaining estimated distance (the first leg is locked with the second leg\'s remaining estimate)', la.other_projected === true && near(la.other_alight_km, 8.6, 0.25), la);
  const expectA = await fareOf(la, t.A.booking_id, t.B.booking_id);
  check('A pays what allocate_shared_fares() gives for those legs, to the peso', Number(a.actual_fare) === Math.min(expectA.fare, await soloFare(a)) && Number(a.actual_fare) === Number(fa.actual_fare), { paid: a.actual_fare, expected: expectA.fare, raw: expectA.raw_fare });
  check('A pays alone for the first 3 km, shares the rest: well under the Solo fare of its own distance', Number(a.actual_fare) < await soloFare(a) && Number(a.actual_fare) > 40, { paid: a.actual_fare, solo: await soloFare(a) });
  check('the fare\'s lines add up to the fare (base + distance + adjustment)', near(Number(fa.components.base) + Number(fa.components.distance) + Number(fa.components.adjustment), Number(a.actual_fare), 0.011), fa.components);

  r = await s.driverEnds('D1', t.B.booking_id);
  check('(B ends the trip second)', r.ok, r.error);
  const b = await s.bk(t.B.booking_id);
  const fb = finalOf(b);
  const lb = fb.shared_leg;
  check('the second leg to end is settled from the WHOLE actual route: nothing projected, A\'s stored figures used', fb.basis === 'shared_allocated' && lb.other_projected === false && near(lb.other_alight_km, la.alight_km, 0.001) && near(lb.other_board_km, 0, 0.001), lb);
  check('B boarded at km 3 and got off at about km 8', near(lb.board_km, 3.0, 0.15) && near(lb.alight_km, 8.0, 0.15), lb);
  const expectB = await fareOf(lb, t.B.booking_id, t.A.booking_id);
  check('B pays what allocate_shared_fares() gives for those legs', Number(b.actual_fare) === Math.min(expectB.fare, await soloFare(b)), { paid: b.actual_fare, expected: expectB.fare });
  check('B shares only 5 km of the route: about half of the cost of those kilometres (about PHP 26)', near(Number(b.actual_fare), 26, 3), b.actual_fare);
  const pool = Number((await s.fare(8.0, 'Solo', 1)).solo_fare);
  check('together the two legs cover about the vehicle fare of the whole 8 km route (the projection of the first leg costs the driver at most a few pesos)', near(Number(a.actual_fare) + Number(b.actual_fare), pool, 6), { a: a.actual_fare, b: b.actual_fare, pool });
  check('neither pays more than its own Solo fare, nor less than the PHP 15 base fare', Number(a.actual_fare) <= await soloFare(a) && Number(b.actual_fare) <= await soloFare(b) && Number(a.actual_fare) >= 15 && Number(b.actual_fare) >= 15);
  check('both fares are locked once, with the route they were computed from (audit of the figures)', !!a.fare_locked_at && !!b.fare_locked_at && fb.shared_leg.segments.length >= 1);
  await s.reset();

  console.log('\nS2 the split by declared head-count (Rule 14.7): 1 and 2 passengers on one route share it 1 : 2');
  t = await twoOnBoard({ countB: 2, joinFix: 1, endFix: 60, destM: 6000 });
  r = await s.driverEnds('D1', t.A.booking_id);
  r = await s.driverEnds('D1', t.B.booking_id);
  const a2 = await s.bk(t.A.booking_id); const b2 = await s.bk(t.B.booking_id);
  check('the two-passenger booking pays about twice what the one-passenger booking pays for the shared route', Number(b2.actual_fare) >= 1.8 * Number(a2.actual_fare) - 3 && Number(b2.actual_fare) <= 2.2 * Number(a2.actual_fare) + 3, { a: a2.actual_fare, b: b2.actual_fare });
  check('the legs carry the declared head-counts', finalOf(b2).shared_leg.passenger_count === 2 && finalOf(b2).shared_leg.other_passenger_count === 1, finalOf(b2).shared_leg);
  await s.reset();

  console.log('\nS3 never more than Solo; a leg that rode alone pays the vehicle fare of its route');
  // A is matched with B, but B has not boarded when A arrives: A rode alone. The route A drove (3.4 km) is a little longer than the estimate it was billed on (3.3 km)
  const A3 = await s.host({ stage: 'ongoing', o: { km: 3.3 } });
  await s.startedAt(A3.booking_id, s.trackTime(0));
  await s.online('D2', 400);
  const p3 = await s.propose({ pickupNorth: 150 });
  await s.agree(p3.m);
  await s.track([A3.booking_id], 'D1', 0, 34);                     // the trip is driven AFTER the pairing was made (matching is closed from 50% on)
  await s.driverIsAt('D1', 3400);
  r = await s.driverEnds('D1', A3.booking_id);
  const a3 = await s.bk(A3.booking_id);
  const f3 = finalOf(a3);
  check('B has not boarded: A is settled alone, over the route it drove: the vehicle fare of 3.4 km (66) capped at its own Solo fare (65)', r.ok && f3.basis === 'shared_allocated' && f3.shared_leg.capped_at_solo === true && Number(a3.actual_fare) === 65 && f3.shared_leg.allocated_fare === 66, { fare: a3.actual_fare, leg: f3.shared_leg });
  await s.reset();

  console.log('\nS4 nothing measurable: the Batch 5 estimate stands');
  t = await twoOnBoard({ track: false });
  const noTrack = await s.attempt(() => s.driverEnds('D1', t.A.booking_id));
  const a4 = await s.bk(t.A.booking_id);
  check('no usable track: the matched leg is billed the Matched Shared Fare Estimate, as before Batch 10, never more than it accepted', a4.booking_status === 'Arrived at Destination' && finalOf(a4).basis === 'matched_estimate_pending_segments' && finalOf(a4).shared_leg === undefined
    && Number(a4.actual_fare) <= Number(a4.fare_breakdown.estimate.max_unmatched_fare ?? 1e9), { st: a4.booking_status, basis: finalOf(a4) && finalOf(a4).basis, noTrack });
  await s.reset();

  console.log('\nS5 a booking cannot borrow a pairing that is not its own (the fare of a matched trip depends on it)');
  t = await twoOnBoard({ joinFix: 1, endFix: 30, destM: 3000 });
  const loner = await s.soloBook('P3', {});
  await internal(`UPDATE booking SET is_shared_trip = TRUE, shared_trip_match_id = '${t.m.match_id}' WHERE booking_id = '${loner.booking_id}'`);
  const lo = await s.bk(loner.booking_id);
  check('(precondition) the server pointed a third Shared booking at the pairing of two others', lo.shared_trip_match_id === t.m.match_id && lo.is_shared_trip === true);
  await internal(`UPDATE booking SET booking_status = 'Trip Ongoing', trip_started_at = clock_timestamp(), driver_id = '${ID.D2}' WHERE booking_id = '${loner.booking_id}'`);
  await s.track([loner.booking_id], 'D2', 0, 30);
  const endedLone = await s.attempt(() => s.driverSets('D2', loner.booking_id, 'Arrived at Destination'));
  const bl = await s.bk(loner.booking_id);
  check('...its fare is NOT a matched fare: the pairing lists two other bookings, so it is billed as an unmatched Solo trip', endedLone.ok && finalOf(bl) && finalOf(bl).basis === 'unmatched_solo' && finalOf(bl).shared_leg === undefined, finalOf(bl) && finalOf(bl).basis);
  await s.reset();

  console.log('\nS6 N9: a matched leg ended early is settled for the distance travelled; the remaining leg\'s share is recomputed');
  t = await twoOnBoard({ endFix: 50 });                                  // both on board; the vehicle is at km 5
  await s.driverIsAt('D1', 5000);
  r = await s.paxCall('P2', 'passenger_request_early_end($1,$2,$3)', [t.B.booking_id, 'safety_concern', null]);
  check('(B asks to end the trip early: a Safety Concern)', r.success === true, r);
  const ended = await s.driverSets('D1', t.B.booking_id, 'Arrived at Destination');
  const bE = await s.bk(t.B.booking_id);
  const fe = finalOf(bE);
  check('B\'s leg is settled for what it travelled (km 3 to km 5): it shares 2 km, so the PHP 15 minimum applies; recorded as a Safety Concern end', ended.ok && fe.basis === 'shared_allocated' && near(fe.shared_leg.alight_km, 5.0, 0.15) && Number(bE.actual_fare) === 15 && bE.early_end_kind === 'SAFETY', { ok: ended.ok, err: ended.error, fare: bE.actual_fare, leg: fe && fe.shared_leg });
  check('...and the ledger row of the early end exists for B', (await s.ledger(t.B.booking_id)).some((x) => x.reason_code === 'SAFETY_EARLY_TERMINATION'));
  await s.track([t.A.booking_id], 'D1', 51, 80);                         // A goes on alone to the destination
  r = await s.driverEnds('D1', t.A.booking_id);
  const aE = await s.bk(t.A.booking_id);
  const fae = finalOf(aE);
  check('A, the remaining leg, is recomputed with B\'s ACTUAL end (nothing projected): A pays alone from km 5 on', r.ok && fae.shared_leg.other_projected === false && near(fae.shared_leg.other_alight_km, fe.shared_leg.alight_km, 0.001), fae.shared_leg);
  const expectAe = await fareOf(fae.shared_leg, t.A.booking_id, t.B.booking_id);
  check('...and pays what the allocation gives for those legs, never above its Solo fare', Number(aE.actual_fare) === Math.min(expectAe.fare, await soloFare(aE)) && Number(aE.actual_fare) <= await soloFare(aE), { paid: aE.actual_fare, exp: expectAe.fare });
  await s.reset();
  // a PERSONAL end keeps Rule 13.4: the GREATER of the accepted estimate and the fare of the distance travelled
  t = await twoOnBoard({ endFix: 50 });
  await s.driverIsAt('D1', 5000);
  await s.paxCall('P2', 'passenger_request_early_end($1,$2,$3)', [t.B.booking_id, 'changed_plans', null]);
  const endedP = await s.driverSets('D1', t.B.booking_id, 'Arrived at Destination');
  const bP = await s.bk(t.B.booking_id);
  const estimateFare = Number((await s.fare(Number(bP.estimated_distance_km), 'Shared', 1)).shared_matched_estimate);
  check('a PERSONAL early end of a matched leg is billed the greater of the accepted Matched Shared Fare Estimate and the share of the distance travelled (Rule 13.4)', endedP.ok && Number(bP.actual_fare) === estimateFare && Number(bP.actual_fare) <= await soloFare(bP), { fare: bP.actual_fare, estimateFare });
  await s.reset();

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
