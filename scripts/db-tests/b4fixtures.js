// Shared helpers for the Batch 4 (driver presence) suites.
const { freshDb, asUser, attempt, check, summary } = require('./tlib');
const { ID, seed } = require('./fixtures');

const AFF = {
  D1_T1: 'e1000000-0000-0000-0000-000000000001',   // D1: one verified affiliation (TODA1)
  D2_T1: 'e2000000-0000-0000-0000-000000000001',   // D2: two verified affiliations
  D2_T2: 'e2000000-0000-0000-0000-000000000002',
  D3_T2: 'e3000000-0000-0000-0000-000000000001',   // D3: only a Submitted / Pending application
};

const LAST = '20261005000002_batch4_presence_rpcs.sql';

async function setup() {
  const db = await freshDb(LAST);
  await seed(db);
  const internal = (sql) => db.exec(`SELECT set_config('sakay.internal_context','true',false); ${sql}; SELECT set_config('sakay.internal_context','',false);`);
  await internal(`
    UPDATE toda SET toda_status='Active', certificate_expiry = now() + interval '1 year';
    INSERT INTO driver_toda_affiliation(affiliation_id,driver_id,toda_id,toda_endorsement_status,lgu_verification_status) VALUES
      ('${AFF.D1_T1}','${ID.D1}','${ID.TODA1}','Endorsed','Approved'),
      ('${AFF.D2_T1}','${ID.D2}','${ID.TODA1}','Endorsed','Approved'),
      ('${AFF.D2_T2}','${ID.D2}','${ID.TODA2}','Endorsed','Approved'),
      ('${AFF.D3_T2}','${ID.D3}','${ID.TODA2}','Submitted','Pending')`);

  const as = (uid, fn) => asUser(db, { uid }, fn, { commit: true });
  const svc = (fn) => asUser(db, { role: 'service_role' }, fn, { commit: true });
  // Call a presence RPC as a driver and return its jsonb result.
  const rpc = async (uid, name, args = []) => {
    const ph = args.map((_, i) => `$${i + 1}`).join(',');
    const r = await as(uid, (tx) => tx.query(`SELECT public.${name}(${ph}) AS r`, args));
    return r.rows[0].r;
  };
  const goOnline = (uid, lat = 13.4115, lng = 121.1803, acc = 15, age = 500) => rpc(uid, 'driver_go_online', [lat, lng, acc, age]);
  const goOffline = (uid) => rpc(uid, 'driver_go_offline');
  const presence = (uid) => rpc(uid, 'get_my_driver_presence');
  const q = async (sql) => (await db.query(sql)).rows;
  const one = async (sql) => (await q(sql))[0];
  const openSession = (did) => one(`SELECT * FROM driver_online_session WHERE driver_id='${did}' AND ended_at IS NULL`);
  const lastSession = (did) => one(`SELECT * FROM driver_online_session WHERE driver_id='${did}' ORDER BY ended_at DESC NULLS FIRST, started_at DESC LIMIT 1`);
  const status = async (did) => (await one(`SELECT availability_status s FROM driver WHERE driver_id='${did}'`)).s;

  let bseq = 0;
  // A booking row (default: already finished, so Batch 2's one-open-booking guard is not involved).
  const mkBooking = async (passenger, st = 'Completed', driver = null) => {
    const id = `d4000000-0000-0000-0000-${String(++bseq).padStart(12, '0')}`;
    await internal(`INSERT INTO booking(booking_id,passenger_id,driver_id,passenger_count,pickup_address,pickup_latitude,pickup_longitude,dropoff_address,dropoff_latitude,dropoff_longitude,booking_status)
      VALUES ('${id}','${passenger}',${driver ? `'${driver}'` : 'NULL'},1,'A',13.4115,121.1803,'B',13.42,121.19,'${st}')`);
    return id;
  };
  // Offer a booking to a driver and return the attempt id.
  const offer = async (booking, driver) => {
    const r = await svc((tx) => tx.query(`INSERT INTO dispatch_attempt(booking_id,driver_id,dispatch_method) VALUES ('${booking}','${driver}','Tier 1') RETURNING attempt_id`));
    return r.rows[0].attempt_id;
  };
  // Timeouts are written WITHOUT responded_at (passenger dispatcher and driver countdown both do this).
  const timeout = (attemptId) => svc((tx) => tx.query(`UPDATE dispatch_attempt SET response_status='Declined' WHERE attempt_id='${attemptId}'`));
  const explicitDecline = (attemptId) => svc((tx) => tx.query(`UPDATE dispatch_attempt SET response_status='Declined', responded_at=now() WHERE attempt_id='${attemptId}'`));
  const accept = (attemptId) => svc((tx) => tx.query(`UPDATE dispatch_attempt SET response_status='Accepted', responded_at=now() WHERE attempt_id='${attemptId}'`));
  const unansweredOffers = async (driver, n) => {
    const b = await mkBooking(ID.P1);
    for (let i = 0; i < n; i++) await timeout(await offer(b, driver));
  };

  return { db, internal, as, svc, rpc, goOnline, goOffline, presence, q, one, openSession, lastSession, status, mkBooking, offer, timeout, explicitDecline, accept, unansweredOffers };
}

module.exports = { setup, AFF, ID, attempt, check, summary, asUser };
