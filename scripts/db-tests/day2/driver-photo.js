// Day 2: the passenger of a live trip learns which file is the assigned driver's photo (migration 20261013000002).
//   Nobody else does, and nobody does after the trip is over.
const { freshDb, asUser, check, summary } = require('../tlib');
const { ID, seed } = require('../fixtures');

(async () => {
  const db = await freshDb();
  await seed(db);
  const svc = (fn) => asUser(db, { role: 'service_role' }, fn, { commit: true });
  const as = (uid, fn) => asUser(db, { uid }, fn, { commit: true });
  const photoOf = async (uid, booking) =>
    (await as(uid, (tx) => tx.query(`SELECT public.get_assigned_driver_photo($1) AS p`, [booking]))).rows[0].p;

  const LIVE = 'b2000000-0000-0000-0000-000000000001';
  const DONE = 'b2000000-0000-0000-0000-000000000002';
  const NO_DRIVER = 'b2000000-0000-0000-0000-000000000003';
  const path = `${ID.D_AUTH}/avatar-1.jpg`;

  await svc(async (tx) => {
    await tx.query(`UPDATE driver SET profile_photo_url = '${path}' WHERE driver_id = '${ID.D1}'`);
    await tx.query(`
      INSERT INTO booking(booking_id,passenger_id,driver_id,toda_id,booking_status,passenger_count,pickup_address,pickup_latitude,pickup_longitude,
                          dropoff_address,dropoff_latitude,dropoff_longitude,estimated_distance_km,estimated_fare)
      VALUES ('${LIVE}','${ID.P1}','${ID.D1}','${ID.TODA1}','Driver En Route',1,'A',13.4115,121.1803,'B',13.42,121.19,1.5,60),
             ('${DONE}','${ID.P1}','${ID.D1}','${ID.TODA1}','Completed',1,'A',13.4115,121.1803,'B',13.42,121.19,1.5,60),
             ('${NO_DRIVER}','${ID.P2}',NULL,NULL,'Pending',1,'A',13.4115,121.1803,'B',13.42,121.19,1.5,60)`);
  });

  console.log('T1 the passenger of a live trip gets the photo');
  check('the passenger gets the storage path of the assigned driver\'s photo', (await photoOf(ID.P_AUTH, LIVE)) === path);

  console.log('\nT2 nobody else does');
  check('another passenger gets nothing', (await photoOf(ID.P2_AUTH, LIVE)) === null);
  check('a driver (even the assigned one) gets nothing', (await photoOf(ID.D_AUTH, LIVE)) === null);
  const anon = await asUser(db, { role: 'anon' }, async (tx) => { try { await tx.query(`SELECT public.get_assigned_driver_photo('${LIVE}')`); return 'allowed'; } catch (e) { return e.message; } }, { commit: true });
  check('an anonymous caller cannot call it at all', /permission denied/i.test(anon), anon);

  console.log('\nT3 only while the trip is live');
  check('after the trip is completed the photo is no longer given', (await photoOf(ID.P_AUTH, DONE)) === null);
  check('a booking with no driver yet gives nothing (to its own passenger, who is the other one: Rule 4.4 allows one open booking each)', (await photoOf(ID.P2_AUTH, NO_DRIVER)) === null);
  check('an unknown booking gives nothing', (await photoOf(ID.P_AUTH, 'b2000000-0000-0000-0000-0000000000ff')) === null);

  console.log('\nT4 a driver without a photo');
  await svc((tx) => tx.query(`UPDATE driver SET profile_photo_url = NULL WHERE driver_id = '${ID.D1}'`));
  check('the answer is empty (the app shows the initial instead)', (await photoOf(ID.P_AUTH, LIVE)) === null);
  await svc((tx) => tx.query(`UPDATE driver SET profile_photo_url = '   ' WHERE driver_id = '${ID.D1}'`));
  check('a blank value is treated as no photo', (await photoOf(ID.P_AUTH, LIVE)) === null);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
