// Batch 11 (Rule 26.1; T7; F11.3): Share Live Trip. A 128-bit token stored hashed; one anonymous read that returns a whitelist (no passenger name or phone, no fare, no account); the
// link lives until the trip ends + 15 minutes and never longer than 4 hours; the passenger can revoke it; one live link per trip. Whole migration chain on the local emulator.
const { setup, ID, PAX, DRIVERS, attempt, check, summary, asUser } = require('../b11fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, db } = s;
  const D1 = DRIVERS.D1.id, P1 = PAX.P1.id;
  const anon = (fn) => asUser(db, { uid: null, role: 'anon' }, fn, { commit: true });
  const view = async (token) => (await anon((tx) => tx.query(`SELECT public.get_shared_trip_view($1) AS r`, [token]))).rows[0].r;
  const create = (who, bookingId, reuse = null) => s.rpcAs(PAX[who].uid, 'public.create_trip_share($1,$2)', [bookingId, reuse]);
  const sha = async (t) => (await one(`SELECT encode(sha256(convert_to('${t}', 'UTF8')), 'hex') AS h`)).h;

  await internal(`UPDATE driver SET plate_number = 'ABC-1234' WHERE driver_id = '${D1}'`);
  console.log('S1 the passenger of a trip in progress makes the link');
  const t = await s.startTrip('D1', 'P1');
  let r = await create('P2', t.booking_id);
  check('another passenger cannot share this trip', r.success === false && r.error_code === 'ERR_NOT_YOUR_BOOKING', r);
  r = await attempt(() => s.rpcAs(DRIVERS.D1.uid, 'public.create_trip_share($1,$2)', [t.booking_id, null]));
  check('the driver cannot (Share Live Trip is the passenger\'s)', r.ok && r.value.success === false && r.value.error_code === 'ERR_NOT_A_PASSENGER', r);
  r = await attempt(() => anon((tx) => tx.query(`SELECT public.create_trip_share($1, NULL)`, [t.booking_id])));
  check('a visitor without an account cannot', !r.ok && /permission denied/i.test(r.error), r);
  r = await create('P1', t.booking_id);
  const token = r.token;
  check('the link is made: a 128-bit token (32 hex characters), the expiry returned', r.success === true && /^[0-9a-f]{32}$/.test(token) && r.reused === false && new Date(r.expires_at).getTime() > Date.now(), r);
  const rows = await q(`SELECT * FROM trip_share_link WHERE booking_id = '${t.booking_id}'`);
  check('the database keeps only the SHA-256 hash of the token (never the token): a leaked table gives no working link', rows.length === 1 && rows[0].token_hash === (await sha(token)) && !JSON.stringify(rows[0]).includes(token) && rows[0].revoked_at === null, rows);
  check('nobody can read or write the table from the app (a passenger, a driver, a visitor)',
    !(await s.writeAs(PAX.P1.uid, `SELECT * FROM trip_share_link`)).ok && !(await s.writeAs(DRIVERS.D1.uid, `SELECT * FROM trip_share_link`)).ok
    && !(await attempt(() => anon((tx) => tx.query(`SELECT * FROM trip_share_link`)))).ok && !(await s.writeAs(PAX.P1.uid, `UPDATE trip_share_link SET revoked_at = NULL`)).ok);
  check('the creation is audited (who, what; not the token)', (await s.auditOf('TRIP_SHARE_CREATED', t.booking_id)).length === 1 && !JSON.stringify(await s.auditOf('TRIP_SHARE_CREATED', t.booking_id)).includes(token));
  check('the passenger sees that a link is live (but never the token again)', (await s.rpcAs(PAX.P1.uid, 'public.get_my_trip_share($1)', [t.booking_id])).active === true && !JSON.stringify(await s.rpcAs(PAX.P1.uid, 'public.get_my_trip_share($1)', [t.booking_id])).includes(token));
  const again = await create('P1', t.booking_id, token);
  check('sharing again with the token this phone holds returns the SAME link (one live link per trip)', again.success && again.token === token && again.reused === true && (await q(`SELECT 1 FROM trip_share_link WHERE booking_id = '${t.booking_id}'`)).length === 1, again);

  console.log('\nS2 T7: the person who receives the link - no account, no sign-in - sees the whitelist and nothing else');
  const v = await view(token);
  check('found, in progress, with the addresses, the driver\'s FIRST name, the plate and the vehicle position with its age',
    v.found === true && v.state === 'ongoing' && v.ended === false && v.pickup_address === 'A' && v.dropoff_address === 'B' && v.driver_first_name === 'Driver' && v.plate_number === 'ABC-1234'
    && v.driver_position && typeof v.driver_position.lat === 'number' && typeof v.driver_position.age_seconds === 'number' && /progress/.test(v.status_en), v);
  const keys = Object.keys(v).sort().join(',');
  check('exactly the whitelisted fields', keys === 'driver_first_name,driver_position,dropoff,dropoff_address,ended,expires_at,found,pickup,pickup_address,plate_number,progress_pct,server_now,state,status_en,status_tl', keys);
  const text = JSON.stringify(v);
  check('no passenger name, no phone number, no fare, no id of a person or of the booking', !/Pax One|Driver One|\+63|fare|passenger_id|driver_id|booking_id|contact/i.test(text), text);

  console.log('\nS3 a guess learns nothing: every bad token gets the same answer');
  const bad = [null, '', 'abc', token.toUpperCase(), token.slice(1), token + '0', '0'.repeat(32), 'f'.repeat(32), "' OR 1=1 --"];
  const answers = [];
  for (const b of bad) answers.push(JSON.stringify(await view(b)));
  check('malformed, unknown and SQL-ish tokens all get {"found":false}', answers.every((a) => a === '{"found":false}'), answers);

  console.log('\nS4 revoking, and one live link per trip');
  r = await s.rpcAs(PAX.P2.uid, 'public.revoke_trip_share($1)', [t.booking_id]);
  check('another passenger cannot revoke it', r.success === false && (await view(token)).found === true, r);
  const second = await create('P1', t.booking_id);
  check('making a NEW link (no token given) replaces the old one: the new works, the old stops', second.success && second.token !== token && (await view(second.token)).found === true && (await view(token)).found === false
    && (await q(`SELECT 1 FROM trip_share_link WHERE booking_id = '${t.booking_id}' AND revoked_at IS NULL`)).length === 1, second);
  const stale = await create('P1', t.booking_id, token);
  check('a revoked token cannot be "reused" (a new link is made)', stale.success && stale.reused === false && stale.token !== token && stale.token !== second.token, stale);
  r = await s.rpcAs(PAX.P1.uid, 'public.revoke_trip_share($1)', [t.booking_id]);
  check('the passenger switches it off: the link stops working at once, and it is audited', r.success === true && r.revoked === 1 && (await view(stale.token)).found === false
    && (await s.auditOf('TRIP_SHARE_REVOKED', t.booking_id)).length === 1 && (await s.rpcAs(PAX.P1.uid, 'public.get_my_trip_share($1)', [t.booking_id])).active === false, r);

  console.log('\nS5 F11.3 (T7): the link stops working after expiry - the trip ends plus 15 minutes, and never longer than 4 hours');
  const link = await create('P1', t.booking_id);
  const age = (mins) => internal(`UPDATE trip_share_link SET created_at = clock_timestamp() - interval '${mins} minutes' WHERE booking_id = '${t.booking_id}' AND revoked_at IS NULL`);
  await age(239);
  check('a trip still in progress, link 3 h 59 min old: works', (await view(link.token)).found === true);
  await age(241);
  check('a trip still in progress, link 4 h 01 min old: GONE (the hard cap)', (await view(link.token)).found === false);
  check('and the passenger is shown that no link is live', (await s.rpcAs(PAX.P1.uid, 'public.get_my_trip_share($1)', [t.booking_id])).active === false);
  const link2 = await create('P1', t.booking_id);
  await internal(`UPDATE booking SET booking_status = 'Completed', trip_completed_at = clock_timestamp() - interval '10 minutes', payment_status = 'Paid', payment_received_at = clock_timestamp() - interval '10 minutes', fare_unconfirmed = TRUE WHERE booking_id = '${t.booking_id}'`);
  let ended = await view(link2.token);
  check('10 minutes after the trip ended: still works, shown as ended (the contact sees "the trip has ended"), no vehicle position any more', ended.found === true && ended.state === 'completed' && ended.ended === true && ended.driver_position === null && /ended/.test(ended.status_en), ended);
  await internal(`UPDATE booking SET trip_completed_at = clock_timestamp() - interval '16 minutes' WHERE booking_id = '${t.booking_id}'`);
  check('16 minutes after the trip ended: GONE', (await view(link2.token)).found === false);
  r = await create('P1', t.booking_id);
  check('a finished trip cannot be shared any more', r.success === false && r.error_code === 'ERR_SHARE_NOT_ACTIVE', r);
  await s.reset(); await s.clearAll();

  console.log('\nS6 a trip that is cancelled ends its link too; a trip nobody has accepted cannot be shared');
  await s.online('D1', 300);
  const b = await s.bookAndAccept('D1', 'P1');
  const l3 = await create('P1', b.booking_id);
  check('on the way to the pickup: the link works and shows the driver, with no progress figure yet', l3.success && (await view(l3.token)).state === 'assigned' && (await view(l3.token)).progress_pct === null);
  await internal(`UPDATE booking SET booking_status = 'Cancelled', cancelled_by = 'system', cancelled_at = clock_timestamp() - interval '20 minutes' WHERE booking_id = '${b.booking_id}'`);
  check('a trip cancelled 20 minutes ago: the link is gone', (await view(l3.token)).found === false);
  const searching = await s.bookAs('P2');
  r = await create('P2', searching.booking_id);
  check('a booking still searching for a driver cannot be shared', r.success === false && r.error_code === 'ERR_SHARE_NOT_ACTIVE', r);

  const ok = summary();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
