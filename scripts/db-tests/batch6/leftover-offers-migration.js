// Batch 6 follow-up (20261020000001): a project that has Phase B (20261019000001) as it was first applied, WITHOUT the leftover-offer fix, is brought in
// line by the follow-up migration alone. The hosted project was in exactly that state on 2026-10-12 (a changed migration file does not run again).
// The emulator is put back into that state first (the original eligibility function of 20261015000002, a leftover offer in the table), the bug is
// shown, THEN the follow-up migration is run on it. Local emulator, never Supabase.
const fs = require('fs');
const path = require('path');
const { setup, ID, check, summary } = require('../b6fixtures');

(async () => {
  const s = await setup();
  const { db, q, one, internal } = s;
  const MIGRATIONS = path.join(__dirname, '..', '..', '..', 'supabase', 'migrations');
  const followUp = fs.readFileSync(path.join(MIGRATIONS, '20261020000001_batch6_leftover_offers_fix.sql'), 'utf8');
  const base = fs.readFileSync(path.join(MIGRATIONS, '20261015000002_batch6_dispatch_engine.sql'), 'utf8');
  const hasFix = async () => (await one(`SELECT pg_get_functiondef('public.dispatch_eligible_drivers(uuid, integer)'::regprocedure) LIKE '%yb.booking_status%' AS fixed`)).fixed;

  console.log('F1 the project as it was: the original eligibility function and a leftover offer');
  const start = base.indexOf('CREATE OR REPLACE FUNCTION public.dispatch_eligible_drivers');
  await db.exec(base.slice(start, base.indexOf('\n$$;', start) + 4));
  check('(set-up) the eligibility function is the original one, without the fix', (await hasFix()) === false);
  await s.online('D1', 300);
  const old = await s.bookAs('P1');
  await s.finish(old.booking_id);
  await internal(`INSERT INTO dispatch_attempt (booking_id, driver_id, dispatch_method, driver_rank, response_status, notification_sent_at)
                  VALUES ('${old.booking_id}', '${ID.D1}', 'Nearest', 1, 'Pending', now() - interval '40 days')`);
  const stuck = await s.bookAs('P1');
  check('the bug, as it was: the driver (300 m away, fresh position) is NOT offered the new booking, and nothing says why',
    (await s.offers(stuck.booking_id)).length === 0 && (await s.statusOf('P1', stuck.booking_id)).phase !== 'nearby');
  check('(the leftover is Pending on a finished booking)',
    (await q(`SELECT 1 FROM dispatch_attempt a JOIN booking b ON b.booking_id = a.booking_id WHERE a.response_status = 'Pending' AND b.booking_status = 'Cancelled'`)).length === 1);

  console.log('\nF2 the follow-up migration alone brings it in line');
  const run = await db.exec(followUp).then(() => ({ ok: true }), (e) => ({ ok: false, error: e.message }));
  check('it runs without an error', run.ok, run.error);
  check('the eligibility function now has the fix', (await hasFix()) === true);
  const left = await q(`SELECT response_status, responded_at FROM dispatch_attempt WHERE booking_id = '${old.booking_id}' AND dispatch_method = 'Nearest'`);   // the leftover planted above (the engine's own offer of that booking was withdrawn when it ended)
  check('the leftover is closed (Expired, with an answer time)', left.length === 1 && left[0].response_status === 'Expired' && left[0].responded_at !== null, left);
  check('an offer that is really being answered is untouched: none is Pending on a finished booking, and the running search was not changed',
    (await q(`SELECT 1 FROM dispatch_attempt a JOIN booking b ON b.booking_id = a.booking_id WHERE a.response_status = 'Pending' AND b.booking_status NOT IN ('Pending', 'Searching Driver')`)).length === 0
    && (await s.booking(stuck.booking_id)).booking_status === 'Pending');
  await s.finish(stuck.booking_id);
  const fresh = await s.bookAs('P1');
  const offers = await s.offers(fresh.booking_id);
  check('the next booking is offered to the driver at once', offers.length === 1 && offers[0].driver_id === ID.D1, offers);
  check('the search that was stuck on the wide ring was not offered anything late: the old booking stays closed', (await s.booking(stuck.booking_id)).booking_status === 'Cancelled');

  console.log('\nF3 safe to run twice, and the doors stay closed');
  const again = await db.exec(followUp).then(() => ({ ok: true }), (e) => ({ ok: false, error: e.message }));
  check('running it a second time raises nothing', again.ok, again.error);
  check('a signed-in user still cannot run the eligibility function (it returns driver positions)',
    (await one(`SELECT has_function_privilege('authenticated', 'public.dispatch_eligible_drivers(uuid, integer)', 'EXECUTE') AS p`)).p === false);
  check('the offer of the running search is still there, unchanged by the second run', (await s.offers(fresh.booking_id)).length === 1);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
