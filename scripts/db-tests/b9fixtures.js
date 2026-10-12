// Shared helpers for the Batch 9 (end of the trip) suites. They run the WHOLE migration chain on the Batch 6 fixtures (users, two TODAs, drivers placed
// N metres from the pickup, an LGU administrator and one TODA administrator per TODA) and add: a trip built to any stage (ongoing, ended at the
// destination, ended early), the calls the apps make at the end of a trip, and clocks that can be wound back (the database holds every deadline).
const base = require('./b6fixtures');

const { ID, DRIVERS, PAX, attempt, check, summary, asUser, north } = base;

async function setup(until = null) {
  const s = await base.setup(until);
  const { q, one, internal, as, svc, db } = s;

  const offAll = async () => { for (const k of ['D1', 'D2', 'D3']) if ((await s.status(DRIVERS[k].id)) !== 'Offline') await s.goOffline(DRIVERS[k].uid); };
  const bookAndAccept = async (key = 'D1', pax = 'P1', opts) => {
    const b = await s.bookAs(pax, opts);
    const offer = await s.pendingOffer(b.booking_id);
    if (!offer || offer.driver_id !== DRIVERS[key].id) throw new Error(`expected an offer to ${key}, got ${JSON.stringify(offer)}`);
    const r = await s.accept(key, offer.attempt_id);
    if (!r.success) throw new Error('accept failed ' + JSON.stringify(r));
    return s.booking(b.booking_id);
  };
  const walkToTrip = async (key, bookingId) => {
    for (const st of ['In Transit', 'Driver Arrived', 'Trip Ongoing']) {
      const r = await s.driverSets(key, bookingId, st);
      if (!r.ok) throw new Error(`walk to ${st}: ${r.error}`);
    }
  };
  // The passenger is on board (Trip Ongoing) with the driver 300 m from the pickup at the start.
  const startTrip = async (key = 'D1', pax = 'P1', opts) => {
    await s.online(key, 300);
    const b = await bookAndAccept(key, pax, opts);
    await walkToTrip(key, b.booking_id);
    return s.booking(b.booking_id);
  };
  // The driver ends the trip at the destination exactly as the app does (a plain UPDATE; the destination gate is the database's).
  const driverEnds = async (key, bookingId) => {
    await s.reachDestination(bookingId);
    return s.driverSets(key, bookingId, 'Arrived at Destination');
  };
  const atDestination = async (key = 'D1', pax = 'P1', opts) => {
    const b = await startTrip(key, pax, opts);
    const r = await driverEnds(key, b.booking_id);
    if (!r.ok) throw new Error('the driver could not end the trip: ' + r.error);
    return s.booking(b.booking_id);
  };
  // What the apps call (the JSON result; an exception raised by the database is thrown, wrap it with attempt()).
  const paxCall = (pax, sql, args = []) => s.rpcAs(PAX[pax].uid, `public.${sql}`, args);
  const drvCall = (key, sql, args = []) => s.rpcAs(DRIVERS[key].uid, `public.${sql}`, args);
  const lguCall = (sql, args = []) => s.rpcAs(ID.L_AUTH, `public.${sql}`, args);
  const todaCall = (sql, args = [], uid = ID.T_AUTH) => s.rpcAs(uid, `public.${sql}`, args);
  // a plain table write as a user (the way an old or a hostile app would do it)
  const writeAs = (uid, sql, args = []) => attempt(() => as(uid, (tx) => tx.query(sql, args)));

  // The database holds the clocks: wind the fare lock (the passenger's confirmation time runs from it) back, or the payment moment, or the whole trip.
  const lockedAgo = (bookingId, sec) => internal(`UPDATE booking SET fare_locked_at = fare_locked_at - interval '${sec} seconds' WHERE booking_id = '${bookingId}'`);
  const paidAgo = (bookingId, sec) => internal(`UPDATE booking SET payment_received_at = payment_received_at - interval '${sec} seconds', trip_completed_at = trip_completed_at - interval '${sec} seconds' WHERE booking_id = '${bookingId}'`);
  const ledger = (bookingId) => q(`SELECT reason_code, previous_fare, new_fare, actual_distance_km, details FROM fare_adjustment_history WHERE booking_id = '${bookingId}' ORDER BY created_at, adjustment_id`);
  const audit = (action, target) => q(`SELECT * FROM audit_log WHERE action_type = '${action}' AND target_id = '${target}' ORDER BY performed_at`);
  const notices = (type, ref) => q(`SELECT * FROM notification WHERE notification_type = '${type}'${ref ? ` AND subject_id = '${ref}'` : ''}`);
  const flags = (type, subjectId) => q(`SELECT * FROM admin_review_flag WHERE flag_type = '${type}'${subjectId ? ` AND subject_id = '${subjectId}'` : ''} AND status IN ('Open','Under Review')`);
  const ledgerStrikes = (subjectId) => q(`SELECT violation_code, status, points_active, issued_by_role FROM strikes_ledger WHERE subject_id = '${subjectId}' AND status <> 'VOIDED' ORDER BY issued_at`);
  const clearStrikes = () => internal(`UPDATE strikes_ledger SET status = 'VOIDED', points_active = 0`);
  // The driver's app has published a fix `northM` metres from the pickup (the heartbeat logs it against the trip while the passenger is on board).
  const driverAt = (key, northM, acc = 10) => s.moveTo(key, northM, acc);
  // A recorded track from the pickup northwards: n fixes 50 m apart (n = 21 is 1.0 km, n = 100 is 4.95 km), accuracy 10 m
  const track = (bookingId, key, n, o = {}) => s.logTrack(bookingId, DRIVERS[key].id, { n, accuracy: 10, ...o });
  const dispute = (bookingId) => one(`SELECT * FROM fare_dispute WHERE booking_id = '${bookingId}' ORDER BY created_at DESC LIMIT 1`);
  const bk = (id) => one(`SELECT * FROM booking WHERE booking_id = '${id}'`);
  const reset = async () => {
    await internal(`UPDATE booking SET booking_status = 'Cancelled', cancelled_by = 'system' WHERE booking_status NOT IN ('Cancelled', 'Completed')`);
    await offAll();
  };

  return { ...s, offAll, bookAndAccept, walkToTrip, startTrip, driverEnds, atDestination, paxCall, drvCall, lguCall, todaCall, writeAs, lockedAgo, paidAgo, ledger, audit,
           notices, flags, ledgerStrikes, clearStrikes, driverAt, track, dispute, bk, reset, ID, DRIVERS, PAX, north, attempt, check, summary, asUser };
}

module.exports = { setup, ID, DRIVERS, PAX, north, attempt, check, summary, asUser };
