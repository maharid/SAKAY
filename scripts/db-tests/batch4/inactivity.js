// Batch 4 / T5: unanswered offers -> reminder (7.6) -> automatic Offline with NO strike (7.7)
// -> TODA review flag after 3 automatic Offlines in 30 days (7.8); offline-after-decline monitoring (29.7).
const { setup, AFF, ID, attempt, check, summary } = require('../b4fixtures');

(async () => {
  const t = await setup();
  const { db, internal, goOnline, goOffline, one, q, openSession, lastSession, status, mkBooking, offer, timeout, explicitDecline, accept, unansweredOffers } = t;
  const strikes = async (id) => (await one(`SELECT (SELECT count(*)::int FROM strikes_ledger WHERE subject_id='${id}') ledger, (SELECT strikes_count FROM driver WHERE driver_id='${id}') cached`));
  const streak = async (id) => (await openSession(id)).unanswered_streak;

  console.log('T5: 3 unanswered -> reminder, 5 unanswered -> automatic Offline, no strike');
  await goOnline(ID.D_AUTH);
  const b = await mkBooking(ID.P1);
  const a1 = await offer(b, ID.D1), a2 = await offer(b, ID.D1), a3 = await offer(b, ID.D1), a4 = await offer(b, ID.D1), a5 = await offer(b, ID.D1);

  await timeout(a1); await timeout(a2);
  check('two unanswered offers: streak 2, no reminder yet', (await streak(ID.D1)) === 2 && (await openSession(ID.D1)).reminder_sent_at === null);
  await timeout(a3);
  let s = await openSession(ID.D1);
  const rem = await q(`SELECT title, message FROM notification WHERE driver_id='${ID.D1}' AND notification_type='DRIVER_INACTIVITY_REMINDER'`);
  check('the third unanswered offer sends the reminder (once)', s.unanswered_streak === 3 && s.reminder_sent_at !== null && rem.length === 1, { s, rem });
  check('the reminder carries the exact Rule 7.6 wording', /You appear to be unavailable\. Please switch to Offline if you are no longer accepting bookings\./.test(rem[0].message), rem[0]);
  check('...plus a Filipino line', /Mukhang hindi ka available/.test(rem[0].message));
  await timeout(a4);
  check('four unanswered: still Online, no second reminder', (await status(ID.D1)) === 'Available' && (await q(`SELECT 1 FROM notification WHERE driver_id='${ID.D1}' AND notification_type='DRIVER_INACTIVITY_REMINDER'`)).length === 1);
  await timeout(a5);
  const last = await lastSession(ID.D1);
  check('the fifth consecutive unanswered offer sets the driver Offline automatically', (await status(ID.D1)) === 'Offline' && last.end_reason === 'auto_inactivity' && last.unanswered_streak === 5, last);
  const st = await strikes(ID.D1);
  check('NO strike is applied for the automatic Offline (ledger empty, counter 0)', st.ledger === 0 && st.cached === 0, st);
  check('the driver is told, in English and Filipino', (await q(`SELECT 1 FROM notification WHERE driver_id='${ID.D1}' AND notification_type='DRIVER_AUTO_OFFLINE'`)).length === 1);
  check('the automatic Offline is audited with actor system', (await q(`SELECT 1 FROM audit_log WHERE action_type='DRIVER_AUTO_OFFLINE_INACTIVITY' AND target_id='${ID.D1}' AND actor_role='system'`)).length === 1);
  check('...and no review flag yet (only one automatic Offline)', (await q(`SELECT 1 FROM admin_review_flag WHERE subject_id='${ID.D1}'`)).length === 0);

  console.log('\nWhat resets the streak (PI-B4-3)');
  await goOnline(ID.D_AUTH);
  await unansweredOffers(ID.D1, 2);
  check('new online session starts at 0, then 2 unanswered', (await streak(ID.D1)) === 2);
  const e1 = await offer(b, ID.D1);
  await explicitDecline(e1);
  s = await openSession(ID.D1);
  check('an explicit decline (responded_at set) resets the streak and clears the reminder', s.unanswered_streak === 0 && s.reminder_sent_at === null, s);
  await unansweredOffers(ID.D1, 2);
  check('two more unanswered after that are 2, not 4 -> still Online', (await streak(ID.D1)) === 2 && (await status(ID.D1)) === 'Available');
  await unansweredOffers(ID.D1, 1);
  const w1 = await offer(b, ID.D1);
  await t.svc((tx) => tx.query(`UPDATE dispatch_attempt SET response_status='Expired', responded_at=now() WHERE attempt_id='${w1}'`));
  check('an offer withdrawn by the system (booking cancelled while pending) neither counts nor resets the run', (await streak(ID.D1)) === 3 && (await one(`SELECT unanswered u FROM dispatch_attempt WHERE attempt_id='${w1}'`)).u === false, await openSession(ID.D1));
  const e2 = await offer(b, ID.D1);
  await accept(e2);
  check('accepting an offer resets the streak', (await streak(ID.D1)) === 0);
  await unansweredOffers(ID.D1, 3);
  check('reminder fires again in the same session after a reset', (await openSession(ID.D1)).reminder_sent_at !== null);
  await goOffline(ID.D_AUTH);
  await goOnline(ID.D_AUTH);
  check('a new online session starts the count again', (await streak(ID.D1)) === 0 && (await openSession(ID.D1)).reminder_sent_at === null);

  console.log('\nThe unanswered / answered distinction cannot be forged by the driver');
  const e3 = await offer(b, ID.D1);
  const pre = await t.as(ID.D_AUTH, (tx) => tx.query(`UPDATE dispatch_attempt SET responded_at = now() WHERE attempt_id='${e3}'`));
  const afterPre = await one(`SELECT responded_at, response_status FROM dispatch_attempt WHERE attempt_id='${e3}'`);
  check('setting responded_at on a still-Pending offer is ignored', afterPre.responded_at === null && afterPre.response_status === 'Pending', afterPre);
  await timeout(e3);
  check('...so when it times out it still counts as unanswered', (await one(`SELECT unanswered u FROM dispatch_attempt WHERE attempt_id='${e3}'`)).u === true && (await streak(ID.D1)) === 1);
  await t.as(ID.D_AUTH, (tx) => tx.query(`UPDATE dispatch_attempt SET unanswered = FALSE, resolved_at = NULL WHERE attempt_id='${e3}'`));
  check('and a driver cannot edit the unanswered flag afterwards', (await one(`SELECT unanswered u FROM dispatch_attempt WHERE attempt_id='${e3}'`)).u === true);
  await timeout(e3);   // already Declined -> not a transition
  check('re-writing a finished offer does not count twice', (await streak(ID.D1)) === 1);
  const e4 = await offer(b, ID.D1);
  await t.as(ID.D_AUTH, (tx) => tx.query(`UPDATE dispatch_attempt SET response_status='Declined', responded_at = now() - interval '1 day' WHERE attempt_id='${e4}'`));
  const e4r = await one(`SELECT responded_at, unanswered FROM dispatch_attempt WHERE attempt_id='${e4}'`);
  check('an explicit decline is stamped with the server clock, not the device clock', Math.abs(Date.now() - new Date(e4r.responded_at).getTime()) < 60_000 && e4r.unanswered === false, e4r);
  await goOffline(ID.D_AUTH);

  console.log('\nRule 7.8: 3 automatic Offlines in a rolling 30 days -> TODA review flag, still no strike');
  const autoN = async () => (await one(`SELECT count(*)::int n FROM driver_online_session WHERE driver_id='${ID.D1}' AND end_reason='auto_inactivity' AND ended_at > now() - interval '30 days'`)).n;
  check('so far one automatic Offline (from T5 above)', (await autoN()) === 1);
  await goOnline(ID.D_AUTH);
  await unansweredOffers(ID.D1, 5);
  check('after two automatic Offlines there is still no flag', (await autoN()) === 2 && (await q(`SELECT 1 FROM admin_review_flag WHERE subject_id='${ID.D1}' AND flag_type='DRIVER_INACTIVITY_REVIEW'`)).length === 0);
  await goOnline(ID.D_AUTH);
  await unansweredOffers(ID.D1, 5);
  const autoCount = (await one(`SELECT count(*)::int n FROM driver_online_session WHERE driver_id='${ID.D1}' AND end_reason='auto_inactivity' AND ended_at > now() - interval '30 days'`)).n;
  const flag = await one(`SELECT flag_type, subject_type, source_rule, assigned_role, status, details FROM admin_review_flag WHERE subject_id='${ID.D1}' AND flag_type='DRIVER_INACTIVITY_REVIEW'`);
  check('the third automatic Offline creates ONE review flag for the TODA administrator', autoCount >= 3 && !!flag && flag.assigned_role === 'toda_admin' && flag.status === 'Open' && flag.source_rule === 'Rule 7.8', { autoCount, flag });
  check('the flag says no strike is applied automatically', /No strike/.test(flag.details.note), flag.details);
  const st2 = await strikes(ID.D1);
  check('no strike was issued by the review flag', st2.ledger === 0 && st2.cached === 0, st2);
  await goOnline(ID.D_AUTH);
  await unansweredOffers(ID.D1, 5);
  check('a fourth automatic Offline does not create a duplicate flag', (await q(`SELECT 1 FROM admin_review_flag WHERE subject_id='${ID.D1}' AND flag_type='DRIVER_INACTIVITY_REVIEW'`)).length === 1);

  console.log('\n...only sessions inside the rolling 30 days count');
  await t.rpc(ID.D2_AUTH, 'select_active_driver_affiliation', [AFF.D2_T1]);
  for (let i = 0; i < 2; i++) {
    await goOnline(ID.D2_AUTH);
    await unansweredOffers(ID.D2, 5);
  }
  await internal(`UPDATE driver_online_session SET ended_at = now() - interval '40 days', started_at = now() - interval '41 days' WHERE driver_id='${ID.D2}' AND end_reason='auto_inactivity'`);
  await goOnline(ID.D2_AUTH);
  await unansweredOffers(ID.D2, 5);
  check('two automatic Offlines older than 30 days + one new = 1 in the window -> no flag', (await q(`SELECT 1 FROM admin_review_flag WHERE subject_id='${ID.D2}'`)).length === 0);

  console.log('\nA driver on a booking is busy, not unavailable: ignored offers are not inactivity (found in manual test T5)');
  await goOnline(ID.D2_AUTH);
  const open = await mkBooking(ID.P2, 'In Transit', ID.D2);
  await unansweredOffers(ID.D2, 8);
  let d2 = await openSession(ID.D2);
  check('eight ignored offers during a trip do not set the driver Offline', (await status(ID.D2)) === 'Available');
  check('...and they are not counted: streak stays 0 and no "You appear to be unavailable" reminder is sent', d2.unanswered_streak === 0 && d2.reminder_sent_at === null && (await q(`SELECT 1 FROM notification WHERE driver_id='${ID.D2}' AND notification_type='DRIVER_INACTIVITY_REMINDER' AND subject_id='${d2.session_id}'`)).length === 0, d2);
  await internal(`UPDATE booking SET booking_status='Completed' WHERE booking_id='${open}'`);
  await unansweredOffers(ID.D2, 4);
  d2 = await openSession(ID.D2);
  check('once the trip is over the count starts fresh: 4 ignored offers = streak 4, still Online', d2.unanswered_streak === 4 && (await status(ID.D2)) === 'Available', d2);
  await unansweredOffers(ID.D2, 1);
  const d2end = await one(`SELECT end_reason, unanswered_streak FROM driver_online_session WHERE driver_id='${ID.D2}' ORDER BY ended_at DESC NULLS FIRST LIMIT 1`);
  check('the 5th ignored offer after the trip sets the driver Offline automatically', (await status(ID.D2)) === 'Offline' && d2end.end_reason === 'auto_inactivity' && d2end.unanswered_streak === 5, d2end);
  check('...with no strike', (await strikes(ID.D2)).ledger === 0);

  console.log('\nRule 29.7: going Offline right after declining, 3+ times in a login session -> monitoring flag only');
  const flagN = async () => (await q(`SELECT 1 FROM admin_review_flag WHERE subject_id='${ID.D1}' AND flag_type='DRIVER_AVAILABILITY_MONITORING' AND status IN ('Open','Under Review')`)).length;
  await goOffline(ID.D_AUTH).catch(() => {});
  const lid = '77777777-7777-7777-7777-777777777771';
  await internal(`UPDATE driver SET session_id='${lid}' WHERE driver_id='${ID.D1}'`);
  const declineThenOffline = async (secondsAgo = 0) => {
    await goOnline(ID.D_AUTH);
    const at = await offer(b, ID.D1);
    await explicitDecline(at);
    if (secondsAgo) {
      // The decline happened `secondsAgo` seconds ago, inside a session that is older than that.
      await internal(`UPDATE dispatch_attempt SET resolved_at = now() - interval '1 hour' WHERE driver_id='${ID.D1}' AND attempt_id <> '${at}' AND resolved_at IS NOT NULL`);
      await internal(`UPDATE dispatch_attempt SET resolved_at = now() - interval '${secondsAgo} seconds' WHERE attempt_id='${at}'`);
      await internal(`UPDATE driver_online_session SET started_at = now() - interval '${secondsAgo + 600} seconds' WHERE driver_id='${ID.D1}' AND ended_at IS NULL`);
    }
    await goOffline(ID.D_AUTH);
  };
  await declineThenOffline(); await declineThenOffline();
  check('twice: no flag yet', (await flagN()) === 0);
  await declineThenOffline(120);
  const late = await lastSession(ID.D1);
  check('going Offline 2 minutes after a decline is NOT the pattern', (await flagN()) === 0 && late.offline_after_decline === false, { flags: await flagN(), late });
  await declineThenOffline();
  const f2 = await one(`SELECT assigned_role, source_rule, details FROM admin_review_flag WHERE subject_id='${ID.D1}' AND flag_type='DRIVER_AVAILABILITY_MONITORING'`);
  check('the third time (within 60 s each time) creates a monitoring flag for the TODA admin', !!f2 && f2.assigned_role === 'toda_admin' && f2.source_rule === 'Rule 29.7', f2);
  check('...with no strike (monitoring, not punishment)', (await strikes(ID.D1)).ledger === 0);
  await internal(`UPDATE driver SET session_id='77777777-7777-7777-7777-777777777772' WHERE driver_id='${ID.D3}'`);

  console.log('\nThe pattern is counted per login session');
  await internal(`UPDATE admin_review_flag SET status='Dismissed', resolved_at=now() WHERE subject_id='${ID.D1}' AND flag_type='DRIVER_AVAILABILITY_MONITORING'`);
  await internal(`UPDATE driver SET session_id='77777777-7777-7777-7777-777777777773' WHERE driver_id='${ID.D1}'`);
  await declineThenOffline(); await declineThenOffline();
  check('a new login session starts counting from zero (2 in the new session: no new flag)', (await flagN()) === 0);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
