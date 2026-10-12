// Batch 7 follow-up (20261022000001): the em dash of the passenger's "Connection lost - reconnecting..." title was damaged when 20261021000001 was applied to the
// hosted project (read as Windows-1252, saved again as UTF-8: hex c3a2 e282ac e2809d), so booking_timers_sweep() there differed from the repository's by that one
// character. This suite reproduces the hosted state on the emulator, applies the repair file, and proves it puts back exactly the repository's function (same
// fingerprint, same privileges), repairs the notifications already written, touches nothing else, does nothing where there is nothing to repair, and runs twice.
const fs = require('fs');
const path = require('path');
const { setup, ID, DRIVERS, check, summary } = require('../b6fixtures');

const REPAIR = path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261022000001_batch7_repair_notice_title_encoding.sql');
const DASH = '—';
const DAMAGED = 'â€”';        // what the dash became on the hosted project

(async () => {
  const s = await setup();
  const { db, q, one, internal } = s;
  const fn = async () => one(`SELECT md5(replace(p.prosrc, E'\\r', '')) AS fp, p.prosrc AS src, p.proacl::text AS acl, p.prosecdef AS secdef, p.proconfig::text AS cfg
                                FROM pg_proc p WHERE p.proname = 'booking_timers_sweep' AND p.pronamespace = 'public'::regnamespace`);

  console.log('S1 the repair file cannot be damaged the way the dash was');
  const bytes = fs.readFileSync(REPAIR);
  check('the repair migration contains only ASCII characters (its dashes are built with chr())', ![...bytes].some((b) => b > 0x7f));
  const sql = bytes.toString('utf8');

  console.log('\nS2 on a database built from the repository there is nothing to repair');
  const good = await fn();
  check('booking_timers_sweep() holds the real em dash (U+2014) in its notice title', good.src.includes('Connection lost ' + DASH + ' reconnecting...'), good.src.match(/Connection lost.{0,6}reconnecting/)?.[0]);
  check('...and no damaged text', !good.src.includes(DAMAGED));
  const clean = await db.exec(sql).then(() => true, (e) => e.message);
  const afterClean = await fn();
  check('running the repair on it raises nothing and changes nothing (same fingerprint, same privileges, same attributes)',
    clean === true && afterClean.fp === good.fp && afterClean.acl === good.acl && afterClean.secdef === good.secdef && afterClean.cfg === good.cfg, { clean, a: afterClean.fp, b: good.fp });

  console.log('\nS3 the hosted state, reproduced: the function holds the damaged dash and notifications were written with it');
  const def = (await one(`SELECT pg_get_functiondef('public.booking_timers_sweep()'::regprocedure) AS d`)).d;
  await db.exec(def.replace('Connection lost ' + DASH + ' reconnecting', 'Connection lost ' + DAMAGED + ' reconnecting'));
  const hosted = await fn();
  check('the function now differs from the repository\'s (this is what the fingerprint check reported)', hosted.fp !== good.fp && hosted.src.includes('Connection lost ' + DAMAGED + ' reconnecting'));
  check('...and its title in hex is the hosted one (20 c3a2 e282ac e2809d 20)',
    Buffer.from(hosted.src.match(/Connection lost(.{1,8})reconnecting/)[1], 'utf8').toString('hex') === '20c3a2e282ace2809d20');
  const damagedTitle = 'Connection lost ' + DAMAGED + ' reconnecting... (Nawalan ng koneksyon)';
  await internal(`SELECT public._notify_subject('passenger', '${ID.P1}', 'DRIVER_UNREACHABLE', $t$${damagedTitle}$t$, 'Your driver appears to be experiencing a connectivity issue.', 'ref-damaged', 1)`);
  await internal(`SELECT public._notify_subject('passenger', '${ID.P1}', 'DRIVER_UNREACHABLE', $t$Connection lost ${DASH} reconnecting... (Nawalan ng koneksyon)$t$, 'Your driver appears to be experiencing a connectivity issue.', 'ref-fine', 1)`);
  await internal(`SELECT public._notify_subject('passenger', '${ID.P1}', 'SOME_OTHER_NOTICE', $t$${damagedTitle}$t$, 'Not ours to touch.', 'ref-other', 1)`);

  console.log('\nS4 the repair puts back exactly the repository\'s function');
  const repaired = await db.exec(sql).then(() => true, (e) => e.message);
  const fixed = await fn();
  check('the repair runs without error', repaired === true, repaired);
  check('the function is byte for byte the repository\'s again (same fingerprint)', fixed.fp === good.fp);
  check('...with the same privileges, security definer and search path (CREATE OR REPLACE keeps them)', fixed.acl === good.acl && fixed.secdef === good.secdef && fixed.cfg === good.cfg, { fixed: [fixed.acl, fixed.secdef, fixed.cfg], good: [good.acl, good.secdef, good.cfg] });
  check('no signed-in user can call it (it is run by the sweep only)', (await one(`SELECT has_function_privilege('authenticated', 'public.booking_timers_sweep()', 'EXECUTE') a, has_function_privilege('anon', 'public.booking_timers_sweep()', 'EXECUTE') b`)).a === false);
  const notes = await q(`SELECT subject_id, notification_type, title FROM notification WHERE subject_id IN ('ref-damaged', 'ref-fine', 'ref-other') ORDER BY subject_id`);
  const byRef = Object.fromEntries(notes.map((n) => [n.subject_id, n]));
  check('the notification written with the damaged title is repaired', byRef['ref-damaged'].title === 'Connection lost ' + DASH + ' reconnecting... (Nawalan ng koneksyon)', byRef['ref-damaged']?.title);
  check('one that was already right is unchanged', byRef['ref-fine'].title === 'Connection lost ' + DASH + ' reconnecting... (Nawalan ng koneksyon)');
  check('a notification of another kind is not touched', byRef['ref-other'].title === damagedTitle);
  await db.exec(sql);
  check('running the repair a second time changes nothing', (await fn()).fp === good.fp);

  console.log('\nS5 and the repaired sweep really writes the right title');
  await s.online('D1', 300); await s.online('D2', 600);
  const b = await s.bookAs('P1');
  const offer = await s.pendingOffer(b.booking_id);
  const acc = await s.accept('D1', offer.attempt_id);
  await s.moveTo('D1', 200);
  await internal(`
    UPDATE driver SET last_location_update = last_location_update - interval '190 seconds' WHERE driver_id = '${DRIVERS.D1.id}';
    UPDATE booking SET accepted_at = accepted_at - interval '190 seconds', stall_anchor_at = stall_anchor_at - interval '190 seconds' WHERE booking_id = '${b.booking_id}'`);
  await s.sweep();
  const note = (await q(`SELECT title, message FROM notification WHERE recipient_id = '${ID.P1}' AND notification_type = 'DRIVER_UNREACHABLE' AND subject_id = '${b.booking_id}'`))[0];
  check('a driver silent for 3 minutes: the passenger gets "Connection lost — reconnecting..." with a real em dash and the exact Rule 9.2 text',
    acc.success === true && note && note.title === 'Connection lost ' + DASH + ' reconnecting... (Nawalan ng koneksyon)' && /Your driver appears to be experiencing a connectivity issue\. We'll keep trying to reach them\./.test(note.message), note);
  check('and none of the three damaged characters is anywhere in the title', note && ![...note.title].some((c) => 'â€”'.includes(c)));

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
