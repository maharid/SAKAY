// Shared helpers for the Batch 6 (dispatch) suites. They run the WHOLE migration chain on the Batch 5 fixtures (users, two TODAs with
// verified affiliations, an LGU administrator, the fare quote and booking helpers) and add: TODA terminals, drivers placed N metres from the
// pickup, the apps' RPC calls, and a clock that can be wound forward (the database holds the deadlines, so a test moves them instead of waiting).
const base = require('./b5fixtures');
const { AFF } = require('./b4fixtures');

const { ID, attempt, check, summary, asUser, PICKUP } = base;

// One degree of latitude is ~111.195 km: a driver `north(m)` metres north of the pickup is m metres away.
const DEG_PER_M = 1 / 111195;
const north = (m) => ({ lat: PICKUP.lat + m * DEG_PER_M, lng: PICKUP.lng });

const DRIVERS = {
  D1: { id: ID.D1, uid: ID.D_AUTH },
  D2: { id: ID.D2, uid: ID.D2_AUTH },
  D3: { id: ID.D3, uid: ID.D3_AUTH },
};
const PAX = {
  P1: { id: ID.P1, uid: ID.P_AUTH },
  P2: { id: ID.P2, uid: ID.P2_AUTH },
};

async function setup() {
  const t = await base.setup();
  const { db, as, svc, one, q, internal } = t;

  // TODA One's terminal is next to the pickup (so it is the Priority TODA); TODA Two's is far away. D3 gets a verified affiliation (TODA Two).
  await internal(`
    UPDATE toda SET terminal_latitude = ${PICKUP.lat + 0.0004}, terminal_longitude = ${PICKUP.lng} WHERE toda_id = '${ID.TODA1}';
    UPDATE toda SET terminal_latitude = ${PICKUP.lat + 0.2}, terminal_longitude = ${PICKUP.lng + 0.2} WHERE toda_id = '${ID.TODA2}';
    UPDATE driver_toda_affiliation SET toda_endorsement_status = 'Endorsed', lgu_verification_status = 'Approved' WHERE affiliation_id = '${AFF.D3_T2}'`);

  // D2 belongs to two TODAs: it must pick one before going Online.
  let d2Selected = false;
  const online = async (key, northM = 300, acc = 15) => {
    if (key === 'D2' && !d2Selected) {
      await t.rpc(DRIVERS.D2.uid, 'select_active_driver_affiliation', [AFF.D2_T1]);
      d2Selected = true;
    }
    const p = north(northM);
    return t.goOnline(DRIVERS[key].uid, p.lat, p.lng, acc);
  };
  // The driver's app publishes a new fix (the heartbeat is the only publisher).
  const moveTo = (key, northM, acc = 15) => {
    const p = north(northM);
    return t.rpc(DRIVERS[key].uid, 'driver_heartbeat', [p.lat, p.lng, acc]);
  };

  const quoteFor = async (km = 3.3) => ({ km, qt: await t.quote(ID.P_AUTH, km, 1) });
  let fareQuote;
  // A passenger books exactly as the app does (the insert); the database starts the search by itself.
  const bookAs = async (pax = 'P1', o = {}) => {
    fareQuote = fareQuote ?? (await quoteFor());
    return t.book(PAX[pax].uid, PAX[pax].id, { km: fareQuote.km, fare: fareQuote.qt.solo_fare, ...o });
  };

  const offers = (bookingId) => q(`SELECT * FROM dispatch_attempt WHERE booking_id='${bookingId}' ORDER BY cycle, driver_rank, notification_sent_at`);
  const pendingOffer = async (bookingId) => (await q(`SELECT * FROM dispatch_attempt WHERE booking_id='${bookingId}' AND response_status='Pending'`))[0];
  const booking = (id) => one(`SELECT * FROM booking WHERE booking_id='${id}'`);

  const rpcAs = async (uid, sql, args = []) => (await as(uid, (tx) => tx.query(`SELECT ${sql} AS r`, args))).rows[0].r;
  const accept = (key, attemptId) => rpcAs(DRIVERS[key].uid, 'public.accept_booking_offer($1)', [attemptId]);
  const decline = (key, attemptId, reason = 'other') => rpcAs(DRIVERS[key].uid, 'public.decline_booking_offer($1, $2)', [attemptId, reason]);
  const myOffer = (key) => rpcAs(DRIVERS[key].uid, 'public.get_my_pending_offer()');
  const statusOf = (pax, bookingId) => rpcAs(PAX[pax].uid, 'public.get_dispatch_status($1)', [bookingId]);
  const retry = (pax, bookingId) => rpcAs(PAX[pax].uid, 'public.retry_driver_search($1)', [bookingId]);
  const driverCancel = (key, bookingId, reason = 'personal_emergency', note = null) =>
    rpcAs(DRIVERS[key].uid, 'public.driver_cancel_booking($1, $2, $3)', [bookingId, reason, note]);
  const sweep = async () => (await svc((tx) => tx.query(`SELECT public.dispatch_sweep() AS n`))).rows[0].n;

  // Wind the search's clocks (and the open offer's) forward by `seconds`: what the database would see after that much waiting.
  const rewind = (bookingId, seconds) => internal(`
    UPDATE booking SET
        dispatch_cycle_started_at = dispatch_cycle_started_at - interval '${seconds} seconds',
        dispatch_tier_started_at = dispatch_tier_started_at - interval '${seconds} seconds',
        dispatch_pool_refreshed_at = dispatch_pool_refreshed_at - interval '${seconds} seconds',
        dispatch_next_action_at = dispatch_next_action_at - interval '${seconds} seconds'
      WHERE booking_id = '${bookingId}';
    UPDATE dispatch_attempt SET notification_sent_at = notification_sent_at - interval '${seconds} seconds',
        expires_at = expires_at - interval '${seconds} seconds'
      WHERE booking_id = '${bookingId}' AND response_status = 'Pending'`);
  // Make the open offer run out (the driver did nothing) and let the search notice.
  const expireOffer = async (bookingId) => {
    await rewind(bookingId, 25);       // the hard expiry is 20 s after the offer; the booking's next action moves with it, as it would in real time
    await sweep();
  };

  const cancelAs = (uid, bookingId, reason = 'Changed my mind') =>
    as(uid, (tx) => tx.query(`UPDATE booking SET booking_status='Cancelled', cancellation_reason=$2, cancelled_by='passenger' WHERE booking_id=$1 RETURNING *`, [bookingId, reason]));
  // End a booking so the passenger can book again.
  const finish = (bookingId) => internal(`UPDATE booking SET booking_status='Cancelled', cancelled_by='system' WHERE booking_id='${bookingId}' AND booking_status NOT IN ('Cancelled','Completed')`);
  const strikes = (subjectId) => q(`SELECT violation_code, status, points_active FROM strikes_ledger WHERE subject_id='${subjectId}' AND status <> 'VOIDED' ORDER BY issued_at`);

  return { ...t, DRIVERS, PAX, AFF, north, online, moveTo, bookAs, offers, pendingOffer, booking, rpcAs, accept, decline, myOffer, statusOf, retry,
           driverCancel, sweep, rewind, expireOffer, cancelAs, finish, strikes, ID, attempt, check, summary, asUser, PICKUP };
}

module.exports = { setup, ID, AFF, DRIVERS, PAX, north, attempt, check, summary, asUser, PICKUP };
