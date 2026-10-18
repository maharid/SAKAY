// Rules 4.5 and 29.1 (20261028000002): one active login session per passenger, enforced by the DATABASE for the thing the rule exists to
// protect, creating a booking. The login token carries the id of the auth session it belongs to (`session_id`); register_passenger_session() records
// the newest login's id; a booking made with any other session is refused. Whole migration chain on the local emulator (never Supabase).
const fs = require('fs');
const path = require('path');
const { setup, ID, attempt, check, summary, PICKUP } = require('../b6fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, svc, db } = s;
  const A = '11111111-1111-4111-8111-111111111111';          // the passenger's phone A (the older login)
  const B = '22222222-2222-4222-8222-222222222222';          // the passenger's phone B (the newer login)
  const C = '33333333-3333-4333-8333-333333333333';          // a stranger's login
  const { asUser } = require('../tlib');

  // Run fn exactly as a signed-in user whose login token carries `sessionId` (null = a token with no session claim).
  const withSession = (uid, sessionId, fn, commit = true) => asUser(db, { uid }, async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated', ...(sessionId ? { session_id: sessionId } : {}) })]);
    return fn(tx);
  }, { commit });
  const register = (uid, sessionId) => withSession(uid, sessionId, async (tx) => (await tx.query(`SELECT public.register_passenger_session() AS r`)).rows[0].r);
  const book = async (uid, passengerId, sessionId) => {
    const dropoff = { lat: PICKUP.lat + 0.03, lng: PICKUP.lng };
    const qt = await s.quote(uid, 3.3, 1);
    return attempt(() => withSession(uid, sessionId, async (tx) => (await tx.query(
      `INSERT INTO public.booking (passenger_id, booking_type, is_shared_trip, passenger_count, pickup_address, pickup_latitude, pickup_longitude,
                                   dropoff_address, dropoff_latitude, dropoff_longitude, estimated_distance_km, estimated_fare)
       VALUES ($1, 'Immediate', FALSE, 1, 'A', $2, $3, 'B', $4, $5, 3.3, $6) RETURNING booking_id`,
      [passengerId, PICKUP.lat, PICKUP.lng, dropoff.lat, dropoff.lng, qt.solo_fare])).rows[0]));
  };
  const finishAll = () => internal(`UPDATE booking SET booking_status = 'Cancelled', cancelled_by = 'system' WHERE booking_status IN ('Pending', 'Searching Driver')`);

  console.log('A passenger who has not registered a session is not locked out (an older app keeps working)');
  let r = await book(ID.P_AUTH, ID.P1, A);
  check('before any registration a booking is accepted whatever the login token says', r.ok === true, r.error);
  await finishAll();

  console.log('\nRegistering the current login');
  const regA = await register(ID.P_AUTH, A);
  check('register_passenger_session() succeeds, rotates the token and says it is enforced', regA.success === true && !!regA.session_token && regA.enforced === true, regA);
  let row = await one(`SELECT session_id, auth_session_id FROM passenger WHERE passenger_id = $1`, [ID.P1]);
  check('the database now holds the app token and the auth session of this login', row.session_id === regA.session_token && row.auth_session_id === A, row);
  r = await book(ID.P_AUTH, ID.P1, A);
  check('a booking from the current login is accepted', r.ok === true, r.error);
  await finishAll();

  console.log('\nA second login ends the first (Rule 4.5)');
  const regB = await register(ID.P_AUTH, B);
  row = await one(`SELECT session_id, auth_session_id FROM passenger WHERE passenger_id = $1`, [ID.P1]);
  check('phone B logs in: it becomes the current login and the app token changes', regB.success === true && row.auth_session_id === B && row.session_id === regB.session_token && regB.session_token !== regA.session_token, { regB, row });
  r = await book(ID.P_AUTH, ID.P1, A);
  check('phone A (the older login), still holding a valid token, can no longer create a booking', !r.ok && /ERR_SESSION_SUPERSEDED/.test(r.error), r.ok ? 'booking was accepted' : r.error);
  check('...and the message is in Tagalog and English', /Nag-login ang iyong account sa ibang device/.test(r.error || '') && /signed in on another device/.test(r.error || ''), r.error);
  r = await book(ID.P_AUTH, ID.P1, B);
  check('phone B books normally', r.ok === true, r.error);
  await finishAll();
  r = await book(ID.P_AUTH, ID.P1, null);
  check('a login token with no session claim is not refused (the database cannot tell; nothing is invented)', r.ok === true, r.error);
  await finishAll();

  console.log('\nOthers are not affected, and the column cannot be forged');
  await register(ID.P2_AUTH, C);
  r = await book(ID.P2_AUTH, ID.P2, C);
  check('another passenger\'s own current login books normally', r.ok === true, r.error);
  await finishAll();
  r = await book(ID.P_AUTH, ID.P1, C);
  check('a session registered for someone else is no use to this passenger (and she cannot book as someone else anyway)', !r.ok, r.error);
  const forge = await attempt(() => withSession(ID.P_AUTH, A, (tx) => tx.query(`UPDATE passenger SET auth_session_id = $1 WHERE passenger_id = $2`, [A, ID.P1])));
  check('the passenger cannot write auth_session_id herself to take her place back', !forge.ok && /ERR_SESSION_LOCKED|permission denied|row-level/.test(forge.error), forge.error);
  row = await one(`SELECT auth_session_id FROM passenger WHERE passenger_id = $1`, [ID.P1]);
  check('...it is still phone B\'s', row.auth_session_id === B, row);
  const notPax = await register(s.DRIVERS.D1.uid, A);
  check('a driver has no passenger session to register', notPax.success === false && notPax.error_code === 'ERR_NOT_A_PASSENGER', notPax);
  const anon = await attempt(() => s.anon((tx) => tx.query(`SELECT public.register_passenger_session()`)));
  check('an anonymous caller cannot register a session', !anon.ok && /permission denied/i.test(anon.error), anon.error);

  console.log('\nTrusted server code is not stopped (support, migrations, the seed)');
  const trusted = await attempt(() => svc((tx) => tx.query(
    `INSERT INTO public.booking (passenger_id, booking_type, is_shared_trip, passenger_count, pickup_address, pickup_latitude, pickup_longitude,
                                 dropoff_address, dropoff_latitude, dropoff_longitude, estimated_distance_km, estimated_fare)
     VALUES ($1, 'Immediate', FALSE, 1, 'A', $2, $3, 'B', $4, $5, 3.3, 65) RETURNING booking_id`, [ID.P1, PICKUP.lat, PICKUP.lng, PICKUP.lat + 0.03, PICKUP.lng])));
  check('the service role can still insert a booking for her', trusted.ok === true || /fare|estimate/i.test(trusted.error || ''), trusted.error);
  await finishAll();

  console.log('\nThe migration file');
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261028000002_passenger_session_in_database.sql'), 'utf8');
  check('it is pure ASCII with LF line endings', !/[^\x00-\x7F]/.test(sql) && !/\r/.test(sql) && sql.endsWith('\n'));
  void q;

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
