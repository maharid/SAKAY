// Batch 4 / W12 (Rule 29.1): one active driver login session, enforced by the presence functions;
// and the entry point pg_cron calls for the presence sweep.
const { setup, AFF, ID, attempt, check, summary, asUser } = require('../b4fixtures');

const S_OLD = '55555555-5555-5555-5555-555555555501';   // the device that gets signed out
const S_NEW = '55555555-5555-5555-5555-555555555502';   // the device that logged in last

(async () => {
  const t = await setup();
  const { db, internal, rpcRaw, one, openSession, status } = t;
  const fn = (uid, name, args) => rpcRaw(uid, name, args);
  const online = (uid, token) => fn(uid, 'driver_go_online', [13.4115, 121.1803, 12, 200, token]);
  const beat = (uid, token, lat = 13.4120, lng = 121.1810, acc = 15) => fn(uid, 'driver_heartbeat', [lat, lng, acc, token]);
  const presence = (uid, token) => fn(uid, 'get_my_driver_presence', [token]);

  console.log('The old function signatures are gone (no overloads for the API to confuse)');
  const old = await one(`SELECT to_regprocedure('public.driver_go_online(double precision,double precision,double precision,integer)') a,
    to_regprocedure('public.driver_heartbeat(double precision,double precision,double precision)') b,
    to_regprocedure('public.get_my_driver_presence()') c`);
  check('the 4-argument go-online, 3-argument heartbeat and 0-argument presence read no longer exist', old.a === null && old.b === null && old.c === null, old);

  console.log('\nA device holding the current token');
  await internal(`UPDATE driver SET session_id='${S_OLD}' WHERE driver_id='${ID.D1}'`);
  let r = await online(ID.D_AUTH, S_OLD);
  check('can go Online', r.success === true && (await status(ID.D1)) === 'Available', r);
  r = await beat(ID.D_AUTH, S_OLD);
  check('can send heartbeats and publish a position', r.success === true && r.location_accepted === true, r);

  console.log('\nA newer login rotates the token (Batch 2 does this at every login)');
  await internal(`UPDATE driver SET session_id='${S_NEW}' WHERE driver_id='${ID.D1}'`);
  const snap = () => one(`SELECT d.current_latitude lat, s.last_heartbeat_at hb FROM driver d JOIN driver_online_session s ON s.driver_id=d.driver_id AND s.ended_at IS NULL WHERE d.driver_id='${ID.D1}'`);
  const before = await snap();
  await new Promise((res) => setTimeout(res, 30));
  r = await beat(ID.D_AUTH, S_OLD, 10.0, 10.0, 5);
  check('the old device is refused (ERR_SESSION_SUPERSEDED) and learns why', r.success === false && r.error_code === 'ERR_SESSION_SUPERSEDED', r);
  const after = await snap();
  check('...and its refused heartbeat changed nothing: no position published, presence not refreshed', after.lat === before.lat && JSON.stringify(after.hb) === JSON.stringify(before.hb), { before, after });
  r = await presence(ID.D_AUTH, S_OLD);
  check('the old device cannot read the presence state either', r.success === false && r.error_code === 'ERR_SESSION_SUPERSEDED', r);
  r = await beat(ID.D_AUTH, null);
  check('a missing token is refused too once a login session exists (same as the app shell)', r.success === false && r.error_code === 'ERR_SESSION_SUPERSEDED', r);

  console.log('\nThe new device simply continues the same Online session');
  r = await presence(ID.D_AUTH, S_NEW);
  const open = await openSession(ID.D1);
  check('it sees the driver still Online with the same open session', r.success === true && r.online === true && r.session.session_id === open.session_id, r);
  r = await beat(ID.D_AUTH, S_NEW, 13.4125, 121.1815, 12);
  check('its heartbeats work and publish a position', r.success === true && r.location_accepted === true && (await one(`SELECT current_latitude lat FROM driver WHERE driver_id='${ID.D1}'`)).lat === 13.4125, r);

  console.log('\nGoing Offline is allowed from any device (Rule 5.5)');
  r = await fn(ID.D_AUTH, 'driver_go_offline', []);
  check('a device with a stale token can still go Offline', r.success === true && (await status(ID.D1)) === 'Offline', r);
  r = await online(ID.D_AUTH, S_OLD);
  check('...but cannot go Online again with the stale token', r.success === false && r.error_code === 'ERR_SESSION_SUPERSEDED' && (await status(ID.D1)) === 'Offline', r);
  r = await online(ID.D_AUTH, S_NEW);
  check('with the current token it can', r.success === true, r);
  await fn(ID.D_AUTH, 'driver_go_offline', []);

  console.log('\nA driver whose session was never rotated (no stored session id) is not checked');
  const d2 = await one(`SELECT (session_id IS NULL) AS none FROM driver WHERE driver_id='${ID.D2}'`);
  check('(precondition) D2 has no session id', d2.none === true);
  r = await online(ID.D2_AUTH, null);
  check('with no token, D2 is judged on the normal rules (two verified affiliations -> must select), not refused for the session', r.error_code === 'ERR_SELECT_AFFILIATION', r);
  await t.rpc(ID.D2_AUTH, 'select_active_driver_affiliation', [AFF.D2_T1]);
  r = await online(ID.D2_AUTH, null);
  check('after selecting an affiliation, D2 goes Online with no token', r.success === true && (await status(ID.D2)) === 'Available', r);
  await fn(ID.D2_AUTH, 'driver_go_offline', []);

  console.log('\nOther callers');
  r = await presence('99999999-9999-9999-9999-999999999999', S_NEW);
  check('a login that is not a driver still gets ERR_NOT_A_DRIVER', r.error_code === 'ERR_NOT_A_DRIVER', r);
  const anon = await asUser(db, { role: 'anon' }, (tx) => attempt(() => tx.query(`SELECT public.driver_heartbeat(1,1,1,NULL)`)), { commit: true });
  check('the anonymous role still cannot call the presence functions', !anon.ok, anon);

  console.log('\npg_cron entry point: run_presence_sweep_job()');
  await online(ID.D_AUTH, S_NEW);
  await db.exec(`UPDATE driver_online_session SET last_heartbeat_at = now() - interval '9 minutes' WHERE driver_id='${ID.D1}' AND ended_at IS NULL`);
  const client = await asUser(db, { uid: ID.D_AUTH }, (tx) => attempt(() => tx.query(`SELECT public.run_presence_sweep_job()`)), { commit: true });
  check('a driver cannot call the job function', !client.ok, client);
  const direct = await asUser(db, { uid: ID.D_AUTH }, (tx) => attempt(() => tx.query(`SELECT public.sweep_driver_presence()`)), { commit: true });
  check('...nor the sweep itself', !direct.ok, direct);
  check('(precondition) the silent driver is still Online before the job runs', (await status(ID.D1)) === 'Available');
  // The job runs as the database owner with no login claims at all, exactly like pg_cron does.
  const job = (await db.query(`SELECT public.run_presence_sweep_job() AS r`)).rows[0].r;
  const last = await one(`SELECT end_reason FROM driver_online_session WHERE driver_id='${ID.D1}' ORDER BY ended_at DESC NULLS FIRST LIMIT 1`);
  check('run as the database owner (like pg_cron) it sets the silent driver Offline', job.success === true && job.set_offline === 1 && (await status(ID.D1)) === 'Offline' && last.end_reason === 'stale_heartbeat', { job, last });
  const again = (await db.query(`SELECT public.run_presence_sweep_job() AS r`)).rows[0].r;
  check('running it again changes nothing (idempotent)', again.set_offline === 0, again);
  const flag = (await db.query(`SELECT current_setting('sakay.internal_context', true) AS v`)).rows[0].v;
  check('it leaves no system context behind for the next statement', flag === '' || flag === null, flag);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
