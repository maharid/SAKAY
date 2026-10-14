// Batch 10 / Rule 14.2.1 and T3: what the Passenger PWA may know about the other passenger before the pairing, and what it may NEVER know.
// Permitted: Mobile-Verified status, declared party size, approximate pickup area, general destination direction, the assigned driver's name, vehicle details
// and plate number. Forbidden: names, contact numbers, exact pickup or destination addresses (and so coordinates and ids). The check is on the API: the
// whole JSON the database answers, not a screen.
const { setup, ID, check, summary } = require('../b10fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, at } = s;

  const A_PICKUP = 'Blk 7 Lot 3 Rizal Street, Brgy. Ilaya, Calapan City';
  const A_DROP = 'Corner Mabini and Luna Streets, Brgy. Lumangbayan, Calapan City';
  const B_PICKUP = 'Purok 5, 22 Sampaguita Lane, Brgy. San Vicente Central, Calapan City';
  const B_DROP = 'Gate 3 Calapan Central School, Brgy. Guinobatan, Calapan City';

  const A = await s.host({ o: { extra: { pickup_address: A_PICKUP, dropoff_address: A_DROP } } });
  await s.online('D2', 400);
  const { b: B, m: M } = await s.propose({ o: { extra: { pickup_address: B_PICKUP, dropoff_address: B_DROP } } });
  const keys = (o) => Object.keys(o || {}).sort();
  const TOP = ['booking_id', 'closed_reason', 'cutoff_pct', 'driver', 'expires_at', 'is_shared_trip', 'match_id', 'matching_open', 'other', 'progress_pct', 'role', 'seconds_remaining', 'server_time', 'state', 'success'];
  const OTHER = ['direction', 'mobile_verified', 'party_size', 'pickup_area'];
  const DRIVER = ['franchise_number', 'name', 'plate_number', 'vehicle'];
  // everything a screen must never receive about the OTHER party
  const secrets = (other) => other === 'B'
    ? ['Pax Two', '+639170000002', '9170000002', 'Sampaguita', 'Purok 5', 'Gate 3', 'Calapan Central School', 'Guinobatan', B.booking_id, ID.P2, ID.P2_AUTH]
    : ['Pax One', '+639170000001', '9170000001', 'Rizal Street', 'Blk 7', 'Lot 3', 'Mabini', 'Luna Street', 'Lumangbayan', A.booking_id, ID.P1, ID.P_AUTH];
  const leaks = (json, list) => list.filter((x) => json.includes(x));
  const lat = (o) => [String(o.pickup_latitude), String(o.dropoff_latitude)];

  console.log('S1 before the driver has agreed nothing about the other passenger is shown to anybody');
  let st1 = await s.state('P1', A.booking_id);
  let st2 = await s.state('P2', B.booking_id);
  check('the first passenger is not disturbed yet: state "none", no data', st1.state === 'none' && st1.other === null && st1.driver === null && st1.match_id === null, st1);
  check('the second passenger only learns that a shared ride is being arranged: state "proposed", still no data about the other party or the driver', st2.state === 'proposed' && st2.other === null && st2.driver === null, st2);
  check('the top-level fields are exactly the documented ones', JSON.stringify(keys(st1)) === JSON.stringify(TOP) && JSON.stringify(keys(st2)) === JSON.stringify(TOP), { st1: keys(st1), st2: keys(st2) });

  console.log('\nS2 the first passenger is asked to Accept / Decline: only the permitted facts about the second passenger and the driver block');
  await s.driverAnswer('D1', M.match_id, true);
  await internal(`UPDATE passenger SET account_status = 'Active' WHERE passenger_id = '${ID.P2}'`);
  st1 = await s.state('P1', A.booking_id);
  const j1 = JSON.stringify(st1);
  check('state awaiting_my_consent, with the match id and the seconds left', st1.state === 'awaiting_my_consent' && st1.role === 'first' && st1.match_id === M.match_id && st1.seconds_remaining > 0, st1);
  check('"other" has EXACTLY the four permitted fields', JSON.stringify(keys(st1.other)) === JSON.stringify(OTHER), keys(st1.other));
  check('Mobile-Verified: true; the declared party size (1); the approximate pickup area is the BARANGAY only; the direction is one of eight compass points',
    st1.other.mobile_verified === true && st1.other.party_size === 1 && st1.other.pickup_area === 'San Vicente Central' && st1.other.direction === 'N', st1.other);
  check('the driver block has EXACTLY the permitted fields: name, vehicle details, plate number (and the franchise number of the tricycle)', JSON.stringify(keys(st1.driver)) === JSON.stringify(DRIVER)
    && st1.driver.name === 'Driver One' && st1.driver.plate_number === 'ABC-1234' && st1.driver.vehicle === 'Tricycle', st1.driver);
  const bRow = await s.bk(B.booking_id);
  const found = leaks(j1, secrets('B').concat(lat(bRow)));
  check('T3: the answer contains NOTHING else about the second passenger: no name, no phone number, no address, no coordinate, no id', found.length === 0, found);

  console.log('\nS3 the second passenger sees the same about the FIRST passenger, with the driver block, once the driver has agreed');
  st2 = await s.state('P2', B.booking_id);
  const j2 = JSON.stringify(st2);
  check('state awaiting_first_passenger', st2.state === 'awaiting_first_passenger' && st2.role === 'second' && st2.match_id === M.match_id, st2);
  check('"other" has exactly the four permitted fields; the area is the first pickup\'s barangay', JSON.stringify(keys(st2.other)) === JSON.stringify(OTHER) && st2.other.pickup_area === 'Ilaya' && st2.other.party_size === 1 && st2.other.direction === 'N', st2.other);
  check('the driver block is the same permitted set', JSON.stringify(keys(st2.driver)) === JSON.stringify(DRIVER) && st2.driver.plate_number === 'ABC-1234', st2.driver);
  const aRow = await s.bk(A.booking_id);
  check('nothing else about the FIRST passenger leaves the database (no name, phone, address, coordinate, id)', leaks(j2, secrets('A').concat(lat(aRow))).length === 0, leaks(j2, secrets('A').concat(lat(aRow))));
  await internal(`UPDATE passenger SET account_status = 'Suspended' WHERE passenger_id = '${ID.P2}'`);
  check('"Mobile-Verified" is read from the account, not assumed: an account that is not Active shows false', (await s.state('P1', A.booking_id)).other.mobile_verified === false);
  await internal(`UPDATE passenger SET account_status = 'Active' WHERE passenger_id = '${ID.P2}'`);
  check('an area the address does not name is null (never the address)', await (async () => {
    await internal(`UPDATE booking SET pickup_address = 'Somewhere near the old mango tree' WHERE booking_id = '${B.booking_id}'`);
    const x = await s.state('P1', A.booking_id);
    return x.other.pickup_area === null && !JSON.stringify(x).includes('mango');
  })());

  console.log('\nS4 after the match both keep the same limited view; a closed pairing shows nothing');
  await s.paxAnswer('P1', M.match_id, true);
  st1 = await s.state('P1', A.booking_id); st2 = await s.state('P2', B.booking_id);
  check('matched: both see state "matched" with the permitted facts only', st1.state === 'matched' && st2.state === 'matched' && JSON.stringify(keys(st1.other)) === JSON.stringify(OTHER) && JSON.stringify(keys(st2.other)) === JSON.stringify(OTHER), { st1, st2 });
  check('...and still no leak in either answer', leaks(JSON.stringify(st1), secrets('B').concat(lat(bRow))).length === 0 && leaks(JSON.stringify(st2), secrets('A').concat(lat(aRow))).length === 0);
  check('the cutoff screen: the first booking reports that matching is over for it (it has its passenger), and the figures', st1.matching_open === false && st1.cutoff_pct === 50, st1);

  console.log('\nS5 nothing else lets a passenger read the other: the tables, the counterparties call, the driver\'s request');
  let w = await s.attempt(() => s.as(ID.P2_AUTH, (tx) => tx.query(`SELECT booking_id, passenger_id, pickup_address FROM booking WHERE booking_id = '${A.booking_id}'`)));
  check('the second passenger cannot read the first booking\'s row', w.ok && w.value.rows.length === 0, w);
  w = await s.attempt(() => s.as(ID.P2_AUTH, (tx) => tx.query(`SELECT full_name, contact_number FROM passenger WHERE passenger_id = '${ID.P1}'`)));
  check('...nor the first passenger\'s name or phone number', w.ok && w.value.rows.length === 0, w);
  w = await s.attempt(() => s.as(ID.P2_AUTH, (tx) => tx.query(`SELECT * FROM public.get_booking_counterparties(ARRAY['${A.booking_id}']::uuid[])`)));
  check('...nor through the counterparties call', (w.ok && w.value.rows.length === 0) || !w.ok, w);
  w = await s.attempt(() => s.as(ID.P_AUTH, (tx) => tx.query(`SELECT * FROM public.get_booking_counterparties(ARRAY['${B.booking_id}']::uuid[])`)));
  check('...and the first passenger gets nothing of the second\'s through it either', (w.ok && w.value.rows.length === 0) || !w.ok, w);
  const req = JSON.stringify(await s.myRequest('D1') ?? {});
  check('the driver\'s request never carried the passenger\'s surname or phone number (first name only, Rule 11.1)', !/Two|9170000002/.test(req), req);
  const third = await s.state('P3', A.booking_id);
  check('a stranger gets nothing about anybody\'s match', third.success === false && third.error_code === 'ERR_NOT_YOUR_BOOKING', third);
  const anon = await s.attempt(() => s.anon((tx) => tx.query(`SELECT public.get_shared_match_state('${A.booking_id}')`)));
  check('an anonymous caller is refused', !anon.ok, anon);
  await s.reset();

  console.log('\nS6 a pairing that ended shows no data about anybody (only why, to the first passenger)');
  const A2 = await s.host();
  const p2 = await s.propose();
  await s.driverAnswer('D1', p2.m.match_id, true);
  await s.paxAnswer('P1', p2.m.match_id, false);
  const closed1 = await s.state('P1', A2.booking_id);
  const closed2 = await s.state('P2', p2.b.booking_id);
  check('closed: no "other", no driver block; the first passenger sees the reason (their own decision)', closed1.state === 'closed' && closed1.other === null && closed1.driver === null && closed1.closed_reason === 'passenger_declined', closed1);
  check('the second passenger (back on the standard search) sees nothing of it', closed2.state === 'closed' && closed2.other === null && closed2.driver === null && closed2.closed_reason === null && closed2.match_id === null, closed2);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
