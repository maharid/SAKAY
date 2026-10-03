// Batch 5 / T1 + T2: the one fare function (Rules 6.1.1 - 6.1.6, 6.5).
//   T1  boundary distances, Solo x4, rounding .49 / .50, exact arithmetic
//   T2  Scenarios 1-5 of Rule 6.1.6 under the approved model (PI-04 Option B, decisions D2 / D2a-c)
const { setup, check, summary } = require('../b5fixtures');

(async () => {
  const t = await setup();
  const { one, fare, allocate, num, attempt } = t;
  const solo = async (km, pax = 1, rule) => num((await fare(km, 'Solo', pax, rule)).solo_fare);

  console.log('T1  Seat Fare = 15 + excess x 1; Solo = Seat x 4 (Rules 6.1.1 / 6.1.2)');
  let r = await fare(0);
  check('0 km: seat fare 15, Solo 60', num(r.seat_fare) === 15 && num(r.solo_fare) === 60, r);
  check('1.99 km: still inside the base distance (excess 0), Solo 60', (await solo(1.99)) === 60 && num((await fare(1.99)).excess_km) === 0);
  check('2.00 km exactly: excess 0, Solo 60', (await solo(2.00)) === 60 && num((await fare(2.00)).excess_km) === 0);
  r = await fare(2.01);
  check('2.01 km: seat fare 15.01, Solo 60.04 rounds to 60', num(r.seat_fare) === 15.01 && num(r.solo_fare) === 60, r);
  r = await fare(7);
  check('7 km: seat fare 20, Solo 80', num(r.seat_fare) === 20 && num(r.solo_fare) === 80, r);
  r = await fare(10);
  check('10 km: seat fare 23, Solo 92', num(r.seat_fare) === 23 && num(r.solo_fare) === 92, r);
  check('1.5 km Solo is 60 (Q1)', (await solo(1.5)) === 60);
  check('2.5 km: 15.5 x 4 = 62', (await solo(2.5)) === 62);

  console.log('\nSolo is the whole tricycle: headcount never changes it (Rule 6.1.2)');
  const bypax = [];
  for (const pax of [1, 2, 3, 4]) bypax.push(await solo(7, pax));
  check('7 km Solo with 1, 2, 3 and 4 passengers is 80 every time', bypax.every((v) => v === 80), bypax);
  check('a Solo booking is billed Solo whatever the trip type argument says about the estimate', num((await fare(7, 'Solo', 2)).estimated_fare) === 80);

  console.log('\nT1  Rounding: nearest whole peso, .50 and above rounds up (Rule 6.1.5 e)');
  // Solo raw = 60 + 4 x (km - 2). 2.1225 km -> 60.49 ; 2.125 km -> 60.50 ; 2.1275 km -> 60.51
  check('60.49 rounds DOWN to 60 (2.1225 km)', (await solo(2.1225)) === 60);
  check('60.50 rounds UP to 61 (2.125 km)', (await solo(2.125)) === 61);
  check('60.51 rounds up to 61 (2.1275 km)', (await solo(2.1275)) === 61);
  check('61.50 rounds up to 62 (2.375 km)', (await solo(2.375)) === 62);
  check('64.50 rounds up to 65 (3.125 km)', (await solo(3.125)) === 65);
  check('2.12 km (60.48) and 2.13 km (60.52): 60 and 61 (Q1)', (await solo(2.12)) === 60 && (await solo(2.13)) === 61);

  console.log('\nT1  Exact arithmetic: no floating-point drift');
  // At 2.05 per km, 24.5 km is exactly 244.50 -> 245. In JavaScript doubles it is 244.4999999... -> 244.
  // (Found by an exhaustive search of 2-decimal tariffs; the old client-side calculator used doubles.)
  const jsFloat = Math.round((15 + (24.5 - 2) * 2.05) * 4);
  check('(precondition) plain floating point gets 24.5 km @2.05/km WRONG (244 instead of 245)', jsFloat === 244, jsFloat);
  check('the database gets it right: 245', (await solo(24.5, 1, { rate: 2.05 })) === 245);
  check('...and a non-integer base fare too (base 10.20, 1.25/km, 15.54 km: exact 108.50 -> 109)', (await solo(15.54, 1, { base: 10.2, rate: 1.25 })) === 109);
  check('4.1 km: 17.1 x 4 = 68.4 -> 68', (await solo(4.1)) === 68);
  check('a changed tariff flows through (base 20, 2 km, 2 per km, 5 km): seat 26, Solo 104', (await solo(5, 1, { base: 20, rate: 2 })) === 104);
  check('the base distance is a parameter too (3 km base, 5 km): excess 2, seat 17, Solo 68', (await solo(5, 1, { baseKm: 3 })) === 68);

  console.log('\nRule 6.5  Matched Shared Fare Estimate and Maximum Unmatched Fare');
  r = await fare(10, 'Shared', 1);
  check('10 km, 1 passenger: matched estimate 46 (half the 92 vehicle fare), Maximum Unmatched Fare 92 (= Solo)',
    num(r.shared_matched_estimate) === 46 && num(r.max_unmatched_fare) === 92 && num(r.solo_fare) === 92 && num(r.estimated_fare) === 46, r);
  r = await fare(10, 'Shared', 2);
  check('10 km, 2 passengers: 2/3 of 92 = 61.33 -> 61', num(r.shared_matched_estimate) === 61, r);
  r = await fare(10, 'Shared', 3);
  check('10 km, 3 passengers: 3/4 of 92 = 69', num(r.shared_matched_estimate) === 69, r);
  r = await fare(10, 'Shared', 4);
  check('10 km, 4 passengers: the tricycle is full, nobody can join -> the estimate is the whole vehicle fare (92)', num(r.shared_matched_estimate) === 92, r);
  r = await fare(6, 'Shared', 1);
  check('6 km, 1 passenger: 38 matched, 76 unmatched', num(r.shared_matched_estimate) === 38 && num(r.max_unmatched_fare) === 76, r);
  check('the matched estimate is never above the Maximum Unmatched Fare',
    (await Promise.all([1, 3, 5, 8, 13].flatMap((km) => [1, 2, 3, 4].map(async (p) => { const x = await fare(km, 'Shared', p); return num(x.shared_matched_estimate) <= num(x.max_unmatched_fare); })))).every(Boolean));
  r = await fare(5, 'Shared', 1);
  check('components add up to the fare (Solo: 60 + 12 = 72 at 5 km)', num((await fare(5)).solo_components.base) === 60 && num((await fare(5)).solo_components.distance) === 12 && num((await fare(5)).solo_components.adjustment) === 0);

  console.log('\nInput guard');
  let a = await attempt(() => fare(-1));
  check('a negative distance is refused', !a.ok && /ERR_INVALID_DISTANCE/.test(a.error), a);
  a = await attempt(() => fare(5, 'Solo', 5));
  check('more passengers than seats is refused', !a.ok && /ERR_INVALID_PASSENGER_COUNT/.test(a.error), a);
  a = await attempt(() => fare(5, 'Charter', 1));
  check('an unknown trip type is refused', !a.ok && /ERR_INVALID_TRIP_TYPE/.test(a.error), a);

  console.log('\nT2  Rule 6.1.6 scenarios (1 passenger each, km along the vehicle route) - approved model B');
  const legs = (...l) => l.map(([id, pax, b, a]) => ({ booking_id: id, passenger_count: pax, board_km: b, alight_km: a }));
  const pair = (res) => [num(res.bookings[0].fare), num(res.bookings[1].fare)];

  r = await allocate(legs(['A', 1, 0, 6], ['B', 1, 0, 6]));
  check('S1 same pickup, same destination (6 km): 38 / 38, whole vehicle fare 76 shared in two', pair(r).join('/') === '38/38' && num(r.pool_fare) === 76 && num(r.route_km) === 6, r);
  r = await allocate(legs(['A', 1, 0, 10], ['B', 1, 0, 10]));
  check('S1 at 10 km (the PI-04 example): 46 / 46, sum 92 = the Solo fare', pair(r).join('/') === '46/46', r);
  r = await allocate(legs(['A', 1, 0, 4], ['B', 1, 0, 9]));
  check('S2 same pickup, A off at 4, B continues to 9: 20 / 68 (sum 88 = vehicle fare of 9 km)', pair(r).join('/') === '20/68' && num(r.pool_fare) === 88, r);
  check('S2 B pays for the 5 km it travels alone (exclusive segment) and shares the first 4', r.bookings[1].segments.map((s) => s.type).join(',') === 'common,exclusive', r.bookings[1].segments);
  r = await allocate(legs(['A', 1, 0, 8], ['B', 1, 3, 8]));
  check('S3 B boards at 3, both off at 8: 58 / 26 (sum 84)', pair(r).join('/') === '58/26' && num(r.pool_fare) === 84, r);
  check('S3 the km before B boards are charged to A only', r.bookings[0].segments.map((s) => s.type).join(',') === 'exclusive,common' && r.bookings[1].segments.length === 1, r.bookings);
  r = await allocate(legs(['A', 1, 0, 6], ['B', 1, 2, 10]));
  check('S4 B boards at 2, A off at 6, B to 10: 37 / 55 (sum 92)', pair(r).join('/') === '37/55' && num(r.pool_fare) === 92, r);
  check('S4 A pays alone for 0-2, B pays alone for 6-10, both share 2-6', r.bookings[0].segments.map((s) => s.type).join(',') === 'exclusive,common' && r.bookings[1].segments.map((s) => s.type).join(',') === 'common,exclusive', r.bookings);
  r = await allocate(legs(['A', 1, 0, 6], ['B', 2, 0, 6]));
  check('S5 1 passenger vs 2 passengers (6 km): 25 / 51 - the two-seat booking pays the larger share', pair(r).join('/') === '25/51', r);
  check('S5 shares are exactly 1/3 and 2/3 of the vehicle fare', num(r.bookings[0].raw_fare) === 25.3333 && num(r.bookings[1].raw_fare) === 50.6667, r.bookings.map((b) => b.raw_fare));

  // docs/policy-decisions.md (PI-04 walkthrough): A rides 5 km (2 km alone, then 3 km with B), B boards at km 2.
  // The first code never matched this document (it charged B 32); the engine does.
  r = await allocate(legs(['A', 1, 0, 5], ['B', 1, 2, 5]));
  check('the decisions-document walkthrough: A 50.40 -> 50, B 21.60 -> 22, total 72 (the whole 5 km vehicle fare)',
    pair(r).join('/') === '50/22' && num(r.bookings[0].raw_fare) === 50.4 && num(r.bookings[1].raw_fare) === 21.6 && num(r.pool_fare) === 72, r);

  console.log('\nThe estimate shown before booking equals what a same-route 1-passenger partner produces');
  for (const km of [3, 6, 10, 15]) {
    for (const pax of [1, 2, 3]) {
      const est = num((await fare(km, 'Shared', pax)).shared_matched_estimate);
      const res = await allocate(legs(['A', pax, 0, km], ['B', 1, 0, km]));
      check(`${km} km, ${pax} passenger(s): estimate ${est} = settlement ${num(res.bookings[0].fare)}`, est === num(res.bookings[0].fare), { est, res: res.bookings[0] });
    }
  }

  console.log('\nRule 6.1.5 d  minimum fare, and other allocation edges');
  r = await allocate(legs(['A', 1, 0, 10], ['B', 1, 9, 10]));
  check('a booking that rides 1 km with someone: 4.6 raw -> 5, lifted to the 15 minimum; the other pays the rest alone',
    num(r.bookings[1].raw_fare) === 4.6 && num(r.bookings[1].fare) === 15 && r.bookings[1].minimum_applied === true && num(r.bookings[0].fare) === 87, r.bookings);
  r = await allocate(legs(['A', 1, 0, 4], ['B', 1, 6, 10]));
  check('legs that never overlap: the empty stretch 4-6 costs nobody anything (route = 8 km occupied)', num(r.route_km) === 8 && num(r.pool_fare) === 84, r);
  r = await allocate(legs(['A', 2, 0, 6], ['B', 2, 0, 6]));
  check('2 + 2 passengers fill the tricycle: each pays half of 76 = 38', pair(r).join('/') === '38/38', r);
  r = await allocate(legs(['A', 1, 0, 6], ['B', 1, 0, 6], ['C', 1, 0, 6]));
  check('three bookings on one route split the 76 pool exactly in thirds (25 each, 25.33 raw)', r.bookings.every((b) => num(b.fare) === 25) && num(r.bookings[0].raw_fare) === 25.3333, r);
  a = await attempt(() => allocate(legs(['A', 3, 0, 6], ['B', 2, 0, 6])));
  check('5 passengers on board at once exceeds the tricycle (ERR_CAPACITY_EXCEEDED)', !a.ok && /ERR_CAPACITY_EXCEEDED/.test(a.error), a);
  a = await attempt(() => allocate(legs(['A', 1, 5, 5])));
  check('a leg that does not move is refused', !a.ok && /ERR_INVALID_LEGS/.test(a.error), a);
  a = await attempt(() => allocate([]));
  check('an empty list is refused', !a.ok && /ERR_INVALID_LEGS/.test(a.error), a);
  r = await allocate(legs(['A', 1, 0, 6], ['B', 1, 0, 6]), { base: 20, rate: 2 });
  check('a changed tariff changes the settlement too (base 20, 2/km, 6 km: pool (20+8)x4 = 112, 56 each)', pair(r).join('/') === '56/56' && num(r.pool_fare) === 112, r);
  check('the seat capacity is the single constant 4', (await one(`SELECT public.fare_policy_constant('seat_capacity') v`)).v === 4);
  check('an unknown fare constant is NULL (a typo cannot silently become 0)', (await one(`SELECT public.fare_policy_constant('nope') v`)).v === null);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
