// Re-applying the Batch 4 migrations (e.g. `supabase db push` replaying a database where they were already
// run by hand) must succeed and must not disturb real data: an Online driver keeps their open session,
// counters, closed sessions and flags.
const { setup, check, summary, ID } = require('../b4fixtures');
const { applyFile } = require('../lib');

const BATCH4 = [
  '20261005000001_batch4_presence_foundation.sql',
  '20261005000002_batch4_presence_rpcs.sql',
  '20261006000001_batch4_login_session_check.sql',
  '20261006000002_batch4_presence_sweep_cron.sql',
  '20261006000003_batch4_inactivity_ignores_open_booking.sql',
];

(async () => {
  const t = await setup();
  const { db, goOnline, goOffline, unansweredOffers, one, openSession } = t;

  // Real-looking state: D1 had one closed session, then went Online and has 3 unanswered offers (reminder sent);
  // D2 is mid-way through a different state.
  await goOnline(ID.D_AUTH);
  await goOffline(ID.D_AUTH);
  await goOnline(ID.D_AUTH);
  await unansweredOffers(ID.D1, 3);

  const snap = async () => ({
    open: await openSession(ID.D1),
    sessions: (await one(`SELECT count(*)::int n FROM driver_online_session`)).n,
    notifications: (await one(`SELECT count(*)::int n FROM notification WHERE notification_type LIKE 'DRIVER_%'`)).n,
    status: (await one(`SELECT availability_status s FROM driver WHERE driver_id='${ID.D1}'`)).s,
  });
  const before = await snap();
  check('precondition: D1 is Online with streak 3 and the reminder sent', before.status === 'Available' && before.open.unanswered_streak === 3 && before.open.reminder_sent_at !== null, before);

  let error = null;
  try {
    for (const f of BATCH4) await applyFile(db, f);
  } catch (e) {
    error = e.message;
  }
  check('re-applying both Batch 4 migrations succeeds', error === null, error);

  const after = await snap();
  check('the open session is untouched (same id, streak, reminder, heartbeat)',
    after.open.session_id === before.open.session_id && after.open.unanswered_streak === 3
    && JSON.stringify(after.open.reminder_sent_at) === JSON.stringify(before.open.reminder_sent_at)
    && JSON.stringify(after.open.last_heartbeat_at) === JSON.stringify(before.open.last_heartbeat_at), { before: before.open, after: after.open });
  check('no session or notification was added, no driver status changed', after.sessions === before.sessions && after.notifications === before.notifications && after.status === before.status, { before, after });

  // The behaviour still works after the replay.
  await unansweredOffers(ID.D1, 2);
  check('the 5th unanswered offer still sets the driver Offline after the replay', (await snap()).status === 'Offline');

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
