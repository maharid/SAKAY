// Shared helpers for the Batch 12 (ratings, fraud and system integrity, data privacy, audit and recordkeeping) suites. They run the WHOLE migration chain on the Batch 11
// fixtures (users, two TODAs, drivers, an LGU administrator and one TODA administrator per TODA, trips built to any stage) and add: finished trips, ratings written the way a
// trusted session writes them (with any time) and the way the apps write them (a plain INSERT as the signed-in user), the cached Average Rating of a driver or passenger, and
// readers of the flags, audit entries and notices. Nothing here touches the repository or Supabase.
const base = require('./b11fixtures');

const { ID, DRIVERS, PAX, attempt, check, summary, asUser, north } = base;

async function setup(until = null) {
  const s = await base.setup(until);
  const { q, one, internal, as, db } = s;

  // a Completed trip of passenger `pax` with driver `key` (rows written directly: the trip itself is not what these suites test)
  const trip = (pax = 'P1', key = 'D1', o = {}) => s.finished(pax, key, o);
  // a trip that has only arrived (a rating may be given, but it does not count until the trip is Completed)
  const arrivedTrip = (pax = 'P1', key = 'D1') => s.finished(pax, key, { status: 'Arrived at Destination' });
  const complete = (bookingId) => internal(`UPDATE booking SET booking_status = 'Completed' WHERE booking_id = '${bookingId}'`);
  // a rating written by a trusted session (the time can be chosen): who rates whom follows the booking
  const rate = (bookingId, role, stars, at = null) => internal(`
    INSERT INTO rating (booking_id, rater_id, ratee_id, rater_role, stars, created_at)
    SELECT b.booking_id, ${role === 'Passenger' ? 'b.passenger_id' : 'b.driver_id'}, ${role === 'Passenger' ? 'b.driver_id' : 'b.passenger_id'}, '${role}', ${stars},
           ${at ? `'${at}'::timestamptz` : 'clock_timestamp()'}
      FROM booking b WHERE b.booking_id = '${bookingId}'`);
  // a rating the way the apps write it: a plain INSERT as the signed-in rater, the arbiter of the app's upsert
  // o.createdAt / o.isExcluded: what a hostile client would send along (the database must ignore them)
  const rateAs = (who, bookingId, stars, o = {}) => {
    const isDriver = who.startsWith('D');
    const uid = isDriver ? DRIVERS[who].uid : PAX[who].uid;
    const cols = ['booking_id', 'rater_id', 'ratee_id', 'rater_role', 'stars'];
    const vals = ['b.booking_id', isDriver ? 'b.driver_id' : 'b.passenger_id', isDriver ? 'b.passenger_id' : 'b.driver_id', `'${isDriver ? 'Driver' : 'Passenger'}'`, String(stars)];
    if (o.createdAt) { cols.push('created_at'); vals.push(`'${o.createdAt}'::timestamptz`); }
    if (o.isExcluded !== undefined) { cols.push('is_excluded'); vals.push(String(o.isExcluded)); }
    return attempt(() => as(uid, (tx) => tx.query(
      `INSERT INTO rating (${cols.join(', ')}) SELECT ${vals.join(', ')} FROM booking b WHERE b.booking_id = $1
       ON CONFLICT (booking_id, rater_role) DO NOTHING RETURNING rating_id, created_at, is_excluded`, [bookingId])));
  };
  const drv = (key) => one(`SELECT weighted_average_rating AS avg, rating_count AS n FROM driver WHERE driver_id = '${DRIVERS[key].id}'`);
  const pax = (key) => one(`SELECT average_rating AS avg, rating_count AS n FROM passenger WHERE passenger_id = '${PAX[key].id}'`);
  const summaryOf = (type, id) => one(`SELECT * FROM public.rating_summary('${type}', '${id}')`);
  const ratingOf = (bookingId, role) => one(`SELECT * FROM rating WHERE booking_id = '${bookingId}' AND rater_role = '${role}'`);
  const flagsOf = (type, subjectId) => q(`SELECT * FROM admin_review_flag WHERE flag_type = '${type}'${subjectId ? ` AND subject_id = '${subjectId}'` : ''} ORDER BY created_at`);
  const openFlags = (type, subjectId) => q(`SELECT * FROM admin_review_flag WHERE flag_type = '${type}'${subjectId ? ` AND subject_id = '${subjectId}'` : ''} AND status IN ('Open','Under Review')`);
  const auditOf = (action, target) => q(`SELECT * FROM audit_log WHERE action_type = '${action}'${target ? ` AND target_id = '${target}'` : ''} ORDER BY performed_at, log_id`);
  const lguCall = (sql, args = []) => s.rpcAs(ID.L_AUTH, `public.${sql}`, args);
  const T1 = ID.T_AUTH, T2 = ID.T2_AUTH, LGU = ID.L_AUTH;
  // the whole migration file again on the same database (it must be safe to run twice)
  const fs = require('fs');
  const path = require('path');
  const migrationFile = path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261027000001_batch12_ratings_integrity_privacy_audit.sql');
  const migrationSql = () => fs.readFileSync(migrationFile, 'utf8');

  return { ...s, trip, arrivedTrip, complete, rate, rateAs, drv, pax, summaryOf, ratingOf, flagsOf, openFlags, auditOf, lguCall, T1, T2, LGU, migrationFile, migrationSql,
           ID, DRIVERS, PAX, north, attempt, check, summary, asUser };
}

module.exports = { setup, ID, DRIVERS, PAX, north, attempt, check, summary, asUser };
