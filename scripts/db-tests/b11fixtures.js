// Shared helpers for the Batch 11 (incident reporting, emergency and safety, breakdown, force majeure) suites. They run the WHOLE migration chain on the Batch 9 fixtures (users, two
// TODAs, drivers placed N metres from the pickup, an LGU administrator and one TODA administrator per TODA, trips built to any stage) and add: reports filed the way the apps
// file them (a plain INSERT into incident_report as the signed-in user), the review calls of the portals, finished trips for the reports that need one, and the audit / notice /
// flag readers. Nothing here touches the repository or Supabase.
const base = require('./b9fixtures');

const { ID, DRIVERS, PAX, attempt, check, summary, asUser, north } = base;

async function setup(until = null) {
  const s = await base.setup(until);
  const { q, one, internal, as, svc, db } = s;

  // a finished trip of passenger `pax` with driver `key` (rows written directly: the trip itself is not what these suites test)
  let seq = 0;
  const finished = async (pax = 'P1', key = 'D1', o = {}) => {
    const id = await s.mkBooking(PAX[pax].id, o.status ?? 'Completed', DRIVERS[key].id);
    await internal(`UPDATE booking SET toda_id = (SELECT toda_id FROM driver WHERE driver_id = '${DRIVERS[key].id}'),
                                       trip_completed_at = ${o.completedAgo ? `clock_timestamp() - interval '${o.completedAgo}'` : 'clock_timestamp()'} WHERE booking_id = '${id}'`);
    return id;
  };
  // a report filed as the app does: the signed-in user inserts a row naming the booking, the category and the text; everything else is the database's
  const file = (who, bookingId, category, description = 'It happened on the way, near the market.', extra = {}) => {
    const uid = who.startsWith('D') ? DRIVERS[who].uid : PAX[who].uid;
    const cols = { booking_id: bookingId, category, description, ...extra };
    const keys = Object.keys(cols);
    return attempt(async () => (await as(uid, (tx) => tx.query(
      `INSERT INTO incident_report (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, keys.map((k) => cols[k])))).rows[0]);
  };
  const report = (id) => one(`SELECT * FROM incident_report WHERE incident_id = '${id}'`);
  const reportsOf = (bookingId) => q(`SELECT * FROM incident_report WHERE booking_id = '${bookingId}' ORDER BY created_at`);
  // what an administrator can read
  const visibleTo = async (uid) => (await as(uid, (tx) => tx.query(`SELECT incident_id FROM incident_report`))).rows.map((r) => r.incident_id);
  // the review calls (the portals)
  const start = (uid, id) => attempt(() => s.rpcAs(uid, 'public.incident_start_review($1)', [id]));
  const escalate = (uid, id, reason = 'Needs the LGU Administrator to decide.', serious = false) => attempt(() => s.rpcAs(uid, 'public.incident_escalate($1,$2,$3)', [id, reason, serious]));
  const decide = (uid, id, outcome, note = 'Reviewed with both parties; findings written down.', code = null, points = null) =>
    attempt(() => s.rpcAs(uid, 'public.incident_decide($1,$2,$3,$4,$5)', [id, outcome, note, code, points]));
  const lost = (uid, id, status, note = 'Called the passenger and the driver, they will meet at the terminal.') =>
    attempt(() => s.rpcAs(uid, 'public.incident_lost_item_update($1,$2,$3)', [id, status, note]));
  const urgent = (who, bookingId, category = 'Safety Concern', description = null) => {
    const uid = who.startsWith('D') ? DRIVERS[who].uid : PAX[who].uid;
    return attempt(() => s.rpcAs(uid, 'public.file_urgent_safety_report($1,$2,$3)', [bookingId, category, description]));
  };
  const endForSafety = (uid, bookingId, reason, note = 'Reached the passenger by phone, the police confirmed it.', closeAs = null) =>
    attempt(() => s.rpcAs(uid, 'public.admin_end_trip_for_safety($1,$2,$3,$4)', [bookingId, reason, note, closeAs]));
  const T1 = ID.T_AUTH, T2 = ID.T2_AUTH, LGU = ID.L_AUTH;
  const noticesOf = (subjectId, type, ref) => q(`SELECT * FROM notification WHERE recipient_id = '${subjectId}' ${type ? `AND notification_type = '${type}'` : ''} ${ref ? `AND subject_id = '${ref}'` : ''} ORDER BY sent_at`);
  const auditOf = (action, target) => q(`SELECT * FROM audit_log WHERE action_type = '${action}'${target ? ` AND target_id = '${target}'` : ''} ORDER BY performed_at`);
  const strikesOf = (subjectId) => q(`SELECT strike_id, violation_code, status, points_active, points_issued, exempt_reason, issued_by_role, incident_id, booking_id FROM strikes_ledger WHERE subject_id = '${subjectId}' AND status <> 'VOIDED' ORDER BY issued_at`);
  const activeCount = async (type, id) => Number((await one(`SELECT public.get_active_strike_count('${type}', '${id}') AS n`)).n);
  const openFlags = (type, subjectId) => q(`SELECT * FROM admin_review_flag WHERE flag_type = '${type}'${subjectId ? ` AND subject_id = '${subjectId}'` : ''} AND status IN ('Open','Under Review')`);
  const age = (incidentId, interval) => internal(`UPDATE incident_report SET created_at = created_at - interval '${interval}' WHERE incident_id = '${incidentId}'`);
  const restriction = (type, id) => one(`SELECT public.account_restriction_state('${type}', '${id}') AS r`).then((x) => x.r);
  const clearAll = async () => {
    await internal(`UPDATE strikes_ledger SET status = 'VOIDED', points_active = 0`);
    // the ladder consequences of the strikes just voided (a suspension, a count) are cleared too
    await internal(`UPDATE passenger SET account_status = 'Active', suspended_until = NULL, suspension_kind = NULL, suspended_at = NULL, suspension_reason = NULL,
                           suspension_trigger_strike_id = NULL, suspension_threshold = NULL, deactivated_at = NULL, strikes_count = 0`);
    await internal(`UPDATE driver SET account_status = 'Verified', suspended_until = NULL, suspension_kind = NULL, suspended_at = NULL, suspension_reason = NULL,
                           suspension_trigger_strike_id = NULL, suspension_threshold = NULL, deactivated_at = NULL, strikes_count = 0`);
    await internal(`DELETE FROM incident_report`);
    await internal(`UPDATE admin_review_flag SET status = 'Dismissed' WHERE status IN ('Open','Under Review')`);
  };

  return { ...s, finished, file, report, reportsOf, visibleTo, start, escalate, decide, lost, urgent, endForSafety, T1, T2, LGU, noticesOf, auditOf, strikesOf, activeCount, openFlags, age, restriction, clearAll,
           ID, DRIVERS, PAX, north, attempt, check, summary, asUser };
}

module.exports = { setup, ID, DRIVERS, PAX, north, attempt, check, summary, asUser };
