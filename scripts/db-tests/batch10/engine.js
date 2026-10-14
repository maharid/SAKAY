// Batch 10 / the engine: a Shared booking that is searching is tried against the Shared Trips under way (Rules 14.1, 14.2, 6.5).
//   S1  a proposal: who gets it, what holds the booking, what is audited
//   S2  T1  capacity: 2+3 cannot match (total 5); 1+3 and 2+2 can; a booking of 4 never matches; the pairing table refuses it for every writer
//   S3  F10.3 - F10.5  pickup separation, bearing, added detour (boundaries on both sides)
//   S4  Rule 14.1 / decision N5  at most two bookings, never the same passenger, one open pairing per booking
//   S5  deterministic ranking, and a driver is not asked about the same booking twice in a search cycle
//   S6  Rule 14.2  the sweep keeps looking, a repeated sweep proposes nothing twice
const { setup, ID, check, summary } = require('../b10fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, DRIVERS, at } = s;
  const bookingCols = 'booking_status, driver_id, dispatch_next_action_at';

  console.log('S1 a proposal: the second booking is offered to the driver of the Shared Trip under way, and held while it is out');
  let A = await s.host();
  check('(precondition) the host is a Shared booking that has a driver and is on its way', A.is_shared_trip && A.driver_id === ID.D1 && A.booking_status === 'Accepted', A.booking_status);
  await s.online('D2', 400);                        // another driver is Online and eligible: the standard search would offer him the second booking
  let { b: B, m: M } = await s.propose();
  check('the engine proposed the pairing at once, as the booking was made ("dispatched immediately")', !!M && M.match_status === 'Awaiting Driver' && M.primary_booking_id === A.booking_id && M.additional_booking_id === B.booking_id, M);
  check('the proposal goes to the driver of the trip under way, with the figures it was decided on', M.host_driver_id === ID.D1 && Number(M.pickup_gap_m) === 150 && M.first_added_m === 0 && M.stop_order === 'AP>BP>AD>BD' && M.driver_response_status === 'Pending', M);
  const held = await s.bk(B.booking_id);
  check('the second booking is HELD: still searching, no standard offer to anybody (D2 is Online and eligible)', ['Pending', 'Searching Driver'].includes(held.booking_status) && (await s.offers(B.booking_id)).length === 0, await s.offers(B.booking_id));
  check('...its next search step waits for the proposal to end (the driver\'s window)', Math.abs(new Date(held.dispatch_next_action_at) - new Date(M.driver_expires_at)) < 1000, { next: held.dispatch_next_action_at, exp: M.driver_expires_at });
  const win = (new Date(M.driver_expires_at) - new Date(M.created_at)) / 1000;
  check('the driver\'s window is the dispatch offer window + grace (15 s + 5 s): one source', win >= 19.5 && win <= 20.5, win);
  const req = await s.myRequest('D1');
  check('the host driver sees the Additional Shared Passenger Request: first name only, the party size, the pickup and destination he must drive to',
    req && req.match_id === M.match_id && req.passenger_first_name === 'Pax' && req.passenger_count === 1 && req.pickup_address === B.pickup_address && req.current_party_size === 1 && req.window_seconds === 15, req);
  check('nobody else sees it (another driver, a passenger)', (await s.myRequest('D2')) === null && (await s.rpc(ID.P2_AUTH, 'get_my_shared_request()')) === null);
  const aud = await q(`SELECT * FROM audit_log WHERE action_type = 'SHARED_MATCH_PROPOSED' AND target_id = '${M.match_id}'`);
  check('the proposal is audited (who, which trips, the figures)', aud.length === 1, aud.length);
  check('nothing is struck for anybody', (await s.strikesOf(ID.P1)).length === 0 && (await s.strikesOf(ID.P2)).length === 0 && (await s.strikesOf(ID.D1)).length === 0);
  await s.reset();

  console.log('\nS2 T1 capacity: the combined head-count is at most 4, validated by the database, not by the screen');
  const pairs = [[1, 1, true], [2, 2, true], [1, 3, true], [3, 1, true], [2, 3, false], [3, 2, false], [3, 3, false], [4, 1, false], [1, 4, false]];
  for (const [a, b, ok] of pairs) {
    await s.reset();
    const h = await s.host({ count: a });
    const p = await s.propose({ count: b });
    check(`host of ${a} + second booking of ${b} (total ${a + b}): ${ok ? 'a proposal' : 'no proposal'}`, ok ? !!p.m && p.m.match_status === 'Awaiting Driver' : !p.m, p.m);
    if (!ok) check(`   (the unmatched booking of ${b} carries on with the standard search)`, ['Pending', 'Searching Driver', 'No Driver Found'].includes((await s.bk(p.b.booking_id)).booking_status));
  }
  await s.reset();
  // the pairing table itself refuses an overload, whoever writes it
  const x2 = await s.sharedBook('P1', { pax: 2 });
  const y3 = await s.sharedBook('P2', { pax: 3 });
  let w = await s.attempt(() => internal(`INSERT INTO shared_trip_match (primary_booking_id, additional_booking_id, match_status) VALUES ('${x2.booking_id}', '${y3.booking_id}', 'Matched')`));
  check('a direct write of 2 + 3 passengers is refused by the pairing table (ERR_SHARED_CAPACITY_EXCEEDED), even for the server', !w.ok && /ERR_SHARED_CAPACITY_EXCEEDED/.test(w.error), w);
  const y2 = await s.sharedBook('P3', { pax: 2 });
  w = await s.attempt(() => internal(`INSERT INTO shared_trip_match (primary_booking_id, additional_booking_id, match_status) VALUES ('${x2.booking_id}', '${y2.booking_id}', 'Cancelled')`));
  check('2 + 2 is allowed by the table (a Cancelled row, so it does not hold the bookings)', w.ok, w);
  await s.reset();

  console.log('\nS3 F10.3 - F10.5: what is compatible (each boundary on both sides)');
  const compat = async (label, o, expectProposal, hostOpts = {}, after = null) => {
    await s.reset();
    await s.host(hostOpts);
    if (after) await after();
    const p = await s.propose(o);
    check(`${label}: ${expectProposal ? 'a proposal' : 'no proposal'}`, expectProposal ? !!p.m && p.m.match_status === 'Awaiting Driver' : !p.m, p.m && { gap: p.m.pickup_gap_m });
    return p;
  };
  await compat('F10.3 the second pickup 590 m from the first (inside 600 m)', { pickupNorth: 590 }, true);
  await compat('F10.3 the second pickup 610 m from the first (beyond 600 m)', { pickupNorth: 610 }, false);
  await compat('F10.3 the second pickup 600 m the other way (south), still on the way', { pickupNorth: -590 }, true);
  // F10.5: bearings. The host goes north (pickup -> destination). The second trip goes south: 180 degrees apart.
  await compat('F10.5 the second trip goes the opposite way (bearing difference 180 degrees)', { pickupNorth: 100, dropNorth: -3000 }, false);
  await compat('F10.5 the same direction (bearing difference 0)', { pickupNorth: 100, dropNorth: 2500 }, true);
  await compat('F10.5 bearings 355 and 5 degrees: only 10 degrees apart ACROSS north, so compatible', { pickupNorth: 100, o: { dropoff: at(3300, 300) } }, true, { o: { dropoff: at(3300, -300) } });
  // at right angles (90 degrees) the DETOUR test alone would accept this pair (the first passenger's ride grows by about 900 m, under the 1 km cap): only the bearing test refuses it
  await compat('F10.5 a second trip at right angles (east) that the detour test alone would accept: the bearing refuses it', { pickupNorth: 1500, o: { dropoff: at(1500, 600) } }, false, { stage: 'ongoing' }, () => s.driverIsAt('D1', 1500));
  await compat('F10.5   (control: the same pair with a destination 600 m further NORTH instead of east is compatible)', { pickupNorth: 1500, o: { dropoff: at(2100) } }, true, { stage: 'ongoing' }, () => s.driverIsAt('D1', 1500));
  // a short second trip (under 500 m straight line): the bearing is not judged, the detour is
  await compat('F10.5 a trip under 500 m: its bearing is not judged (going south 300 m from a point on the way)', { pickupNorth: 1500, dropNorth: 1200 }, false);
  // F10.4: bearings 42 degrees apart (inside 45) but a second trip far off the route: the added detour decides
  const e = await compat('F10.4 a destination off to the east: bearing 42 degrees (inside 45) but the detour is too long', { pickupNorth: 0, dropNorth: 3300, o: { dropoff: at(3300, 3000) } }, false);
  const eastOnly = await compat('F10.4 a destination 400 m to the east: bearing and detour are fine', { pickupNorth: 0, o: { dropoff: at(3300, 400) } }, true);
  check('the figures of a proposal are stored with it (they explain it)', eastOnly.m.bearing_diff_deg !== null && eastOnly.m.first_added_m !== null && eastOnly.m.second_added_m !== null, eastOnly.m);
  // the vehicle's position decides once the first passenger is on board (the next stop is the vehicle, not the pickup)
  const vehicleAt300 = () => s.driverIsAt('D1', 300);       // after boarding at the pickup the vehicle has moved 300 m on
  await compat('F10.3 the first passenger is on board and the vehicle is 700 m from the second pickup', { pickupNorth: 1000 }, false, { stage: 'ongoing' }, vehicleAt300);
  await compat('F10.3 the first passenger is on board and the vehicle is 400 m from the second pickup', { pickupNorth: 700 }, true, { stage: 'ongoing' }, vehicleAt300);

  console.log('\nS4 Rule 14.1: two bookings, one open pairing per booking, never the same passenger (decision N5)');
  await s.reset();
  A = await s.host();
  ({ b: B, m: M } = await s.propose());
  check('(precondition) A and B are in an open pairing', !!M && M.match_status === 'Awaiting Driver');
  // a third booking: it finds no host (A is taken: at most two bookings per trip)
  let c = await s.sharedBook('P3', { pickup: at(100) });
  check('a THIRD booking is never added: the host already has an open pairing, so there is no proposal for it', (await s.matchOf(c.booking_id)) === undefined, await s.matchOf(c.booking_id));
  w = await s.attempt(() => internal(`INSERT INTO shared_trip_match (primary_booking_id, additional_booking_id, match_status) VALUES ('${A.booking_id}', '${c.booking_id}', 'Awaiting Driver')`));
  check('...and the table refuses it for every writer (ERR_SHARED_ALREADY_PAIRED)', !w.ok && /ERR_SHARED_ALREADY_PAIRED/.test(w.error), w);
  w = await s.attempt(() => internal(`INSERT INTO shared_trip_match (primary_booking_id, additional_booking_id, match_status) VALUES ('${c.booking_id}', '${B.booking_id}', 'Awaiting Driver')`));
  check('...and a booking cannot be in two open pairings, whichever role it plays', !w.ok && /ERR_SHARED_ALREADY_PAIRED|duplicate key/.test(w.error), w);
  const d4 = await s.sharedBook('P4', { pickup: at(5000) });
  w = await s.attempt(() => internal(`INSERT INTO shared_trip_match (primary_booking_id, additional_booking_id, match_status) VALUES ('${B.booking_id}', '${d4.booking_id}', 'Awaiting Driver')`));
  check('...a booking that is the SECOND of one pairing cannot be the FIRST of another (ERR_SHARED_ALREADY_PAIRED)', !w.ok && /ERR_SHARED_ALREADY_PAIRED/.test(w.error), w);
  w = await s.attempt(() => internal(`INSERT INTO shared_trip_match (primary_booking_id, additional_booking_id, match_status) VALUES ('${c.booking_id}', '${c.booking_id}', 'Matched')`));
  check('a booking cannot be paired with itself', !w.ok && /ERR_SHARED_SAME_BOOKING/.test(w.error), w);
  await s.reset();

  // N5: the same passenger. Rule 4.4 keeps a passenger's second booking out (the apps and the server alike); the engine and the table refuse the pairing as
  // well, so the one-open-booking trigger is switched off for the precondition only.
  A = await s.host();
  await internal(`ALTER TABLE booking DISABLE TRIGGER trg_one_open_booking`);
  const mine = await one(`INSERT INTO booking (passenger_id, booking_type, is_shared_trip, passenger_count, pickup_address, pickup_latitude, pickup_longitude, dropoff_address, dropoff_latitude, dropoff_longitude, estimated_distance_km, estimated_fare, booking_status)
    SELECT passenger_id, booking_type, TRUE, 1, pickup_address, pickup_latitude + 0.0009, pickup_longitude, dropoff_address, dropoff_latitude, dropoff_longitude, estimated_distance_km, estimated_fare, 'Searching Driver'
      FROM booking WHERE booking_id = '${A.booking_id}' RETURNING *`).catch((err) => ({ error: err.message }));
  await internal(`ALTER TABLE booking ENABLE TRIGGER trg_one_open_booking`);
  check('(precondition) the server holds a second Shared booking of the SAME passenger', !!mine && !mine.error, mine && mine.error);
  if (mine && !mine.error) {
    await sweepTwice(s);
    check('the same passenger\'s two bookings are never paired by the engine, however good the fit', (await s.matchesOf(mine.booking_id)).length === 0, await s.matchesOf(mine.booking_id));
    w = await s.attempt(() => internal(`INSERT INTO shared_trip_match (primary_booking_id, additional_booking_id, match_status) VALUES ('${A.booking_id}', '${mine.booking_id}', 'Awaiting Driver')`));
    check('...and the table refuses it (ERR_SHARED_SAME_PASSENGER)', !w.ok && /ERR_SHARED_SAME_PASSENGER/.test(w.error), w);
  }
  await s.reset();

  console.log('\nS5 the best host wins (deterministic), and the same driver is not asked about the same booking twice in a search cycle');
  // two Shared Trips under way, made without a driver and assigned afterwards (so neither is offered to the other's passenger): A1 on the line the new trip is
  // on, A2 on a parallel line 300 m east. A2 was accepted FIRST, so only the detour (not the order) can make A1 win.
  const hostPair = async (geo1, geo2) => {
    await s.reset();
    const a1 = await s.sharedBook('P1', geo1);
    const a2 = await s.sharedBook('P3', geo2);
    await s.online('D1', 300); await s.online('D2', 300);
    await s.assign(a2.booking_id, ID.D2);
    await s.assign(a1.booking_id, ID.D1);
    return { a1: await s.bk(a1.booking_id), a2: await s.bk(a2.booking_id) };
  };
  let hp = await hostPair({ pickup: at(0), dropoff: at(3300) }, { pickup: at(0, 300), dropoff: at(3300, 300) });
  ({ b: B, m: M } = await s.propose({ pax: 'P2', pickupNorth: 100, dropNorth: 3300 }));
  check('with two Shared Trips under way the proposal goes to the one with the smallest added detour (A1, on the line), although A2 was accepted first', !!M && M.primary_booking_id === hp.a1.booking_id && M.host_driver_id === ID.D1, M);
  const ev = async (hostId) => (await one(`SELECT public._shared_evaluate(a, b, d.current_latitude, d.current_longitude) AS e FROM booking a, booking b, driver d WHERE a.booking_id = '${hostId}' AND b.booking_id = '${B.booking_id}' AND d.driver_id = a.driver_id`)).e;
  const e1 = await ev(hp.a1.booking_id); const e2 = await ev(hp.a2.booking_id);
  check('(both were compatible; the one chosen has the smaller added detour)', e1.ok && e2.ok && e1.first_added_m + e1.second_added_m < e2.first_added_m + e2.second_added_m, { e1, e2 });
  const declined = await s.driverAnswer('D1', M.match_id, false);
  check('(D1 declines)', declined.success === true && declined.state === 'declined', declined);
  const second = await s.matchesOf(B.booking_id);
  check('the same booking is then offered to the OTHER trip (D2), not again to D1 in this cycle', second.length === 2 && second[1].host_driver_id === ID.D2 && second[1].match_status === 'Awaiting Driver', second.map((x) => [x.host_driver_id, x.match_status]));
  await s.driverAnswer('D2', second[1].match_id, false);
  await sweepTwice(s);
  check('and once both have declined, no further proposal in this cycle: the booking is on the standard search', (await s.matchesOf(B.booking_id)).length === 2);
  // a tie goes to the host accepted first, then the lowest id
  hp = await hostPair({ pickup: at(0), dropoff: at(3300) }, { pickup: at(0), dropoff: at(3300) });
  ({ b: B, m: M } = await s.propose({ pax: 'P2', pickupNorth: 100, dropNorth: 3300 }));
  check('identical detours: the Shared Trip accepted FIRST (A2 here) is chosen', !!M && new Date(hp.a2.accepted_at) < new Date(hp.a1.accepted_at) && M.primary_booking_id === hp.a2.booking_id, { a1: hp.a1.accepted_at, a2: hp.a2.accepted_at, m: M && M.primary_booking_id });
  await s.reset();

  console.log('\nS6 Rule 14.2 "actively searching": the sweep keeps looking; a repeated sweep proposes nothing twice');
  await s.reset();
  const late = await s.sharedBook('P2', { pickup: at(120) });           // a Shared booking with NO trip under way: no proposal now
  check('with no Shared Trip under way the booking is just on the standard search', (await s.matchesOf(late.booking_id)).length === 0);
  await s.online('D1', 300);
  const hostLate = await s.sharedBook('P1', { pickup: at(0) });         // the trip under way appears AFTER the booking
  const offer = await s.pendingOffer(hostLate.booking_id);
  const acc = await s.accept('D1', offer.attempt_id);
  check('(a Shared Trip is now under way)', acc.success === true, acc);
  await sweepTwice(s);
  const found = await s.matchesOf(late.booking_id);
  check('the next sweep finds it and proposes the pairing (the booking was searching all along)', found.length === 1 && found[0].match_status === 'Awaiting Driver' && found[0].primary_booking_id === hostLate.booking_id, found);
  await sweepTwice(s);
  check('...and sweeping again does not propose it a second time', (await s.matchesOf(late.booking_id)).length === 1 && (await q(`SELECT 1 FROM audit_log WHERE action_type = 'SHARED_MATCH_PROPOSED' AND target_id = '${found[0].match_id}'`)).length === 1);

  console.log('\nS7 T2 (PI-10 A): matching runs while the on-board progress is STRICTLY LESS than 50% - just below, at and just above the cutoff');
  for (const pct of [0, 49, 50, 51, 95]) {
    await s.reset();
    const h = await s.host({ stage: 'ongoing' });
    const got = pct === 0 ? 0 : await s.setProgress(h.booking_id, 'D1', pct);
    if (pct === 0) await s.driverIsAt('D1', 5);
    const p = await s.propose({ pickupNorth: Math.round((pct / 100) * 3336) + 100 });
    const open = pct < 50;
    check(`progress ${got}%: ${open ? 'a proposal is made' : 'no proposal'}`, got === pct && (open ? p.m?.match_status === 'Awaiting Driver' : !p.m), { got, m: p.m && p.m.match_status });
    const st = await s.state('P1', h.booking_id);
    check(`   ...and the first passenger's screen says matching is ${open ? 'still open (or being answered)' : 'over'}`, open ? st.progress_pct === pct : st.matching_open === false && st.progress_pct === pct, st);
  }
  await s.reset();
  const pre = await s.host({ stage: 'arrived' });
  const prePropose = await s.propose({ pickupNorth: 120 });
  check('before the first passenger boards the progress is 0, so matching is open through the approach and the wait at the pickup (decision N3)', prePropose.m?.match_status === 'Awaiting Driver' && (await s.state('P1', pre.booking_id)).progress_pct === 0, prePropose.m);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });

async function sweepTwice(s) { await s.sweep(); await s.sweep(); return true; }
