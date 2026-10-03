// Security patch 20261007000004: trust checks must fail CLOSED, in a FRESH database session.
//
// Batch 3's is_service_context() answered NULL (not FALSE) in a session that had never set sakay.internal_context, and
// "IF NOT NULL" skips a guard. Every other suite runs in sessions where that setting is already defined, so none could
// see it. Here each probe runs on its own BRAND-NEW backend (the populated database is dumped and loaded into a new
// PGlite instance), which is what a freshly opened pooled connection on the hosted database is.
//
//   BEFORE the patch (the chain through Batch 5): every attack below must SUCCEED (the flaw is real and reproducible).
//   AFTER the patch (the full chain):             every attack must be REFUSED, and the legitimate paths must still work.
const { PGlite } = require('@electric-sql/pglite');
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const { setup, AFF } = require('../b4fixtures');
const { asUser, attempt, check, summary } = require('../tlib');
const { applyFile } = require('../lib');
const { ID } = require('../fixtures');

const BEFORE = '20261007000003_batch5_booking_fare_guards.sql';
const PATCH = '20261007000004_security_null_safe_service_context.sql';

// A transaction with JWT claims but WITHOUT switching the database role: used for the two service-only sweeps, whose
// EXECUTE privilege is revoked from clients, so the only thing left to test is the check inside them.
async function asClaims(db, { uid = null, role = 'authenticated' }, fn) {
  let out;
  try {
    await db.transaction(async (tx) => {
      await tx.query(`SELECT set_config('request.jwt.claim.role', $1, true)`, [role]);
      await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [uid || '']);
      out = await fn(tx);
      throw new Error('__ROLLBACK__');
    });
  } catch (e) {
    if (e.message !== '__ROLLBACK__') throw e;
  }
  return out;
}

// The state the probes need, built with trusted helpers, then dumped so each probe can start from a new backend.
async function build(until) {
  const t = await setup(until);
  await t.rpc(ID.D2_AUTH, 'select_active_driver_affiliation', [AFF.D2_T1]);   // D2 is eligible (an active affiliation is selected)
  await t.goOnline(ID.D_AUTH);                                        // D1 is Online ...
  await t.mkBooking(ID.P1, 'Accepted', ID.D1);                        // ... with an open accepted booking (Rule 5.5)
  const done = await t.mkBooking(ID.P2, 'Completed');                 // a finished booking to hang an offer on
  const attemptId = await t.offer(done, ID.D2);                       // an offer to D2 that is still Pending
  const dump = await t.db.dumpDataDir();
  return { t, dump, attemptId };
}

// One brand-new backend per probe; refuses to run a probe on a session that already defined the setting.
async function onFresh(dump, run) {
  const db = new PGlite({ loadDataDir: dump, extensions: { uuid_ossp, pgcrypto } });
  try {
    const fresh = (await db.query(`SELECT current_setting('sakay.internal_context', true) IS NULL AS fresh`)).rows[0].fresh;
    if (!fresh) throw new Error('the probe session is not fresh: the setting is already defined');
    return await run(db);
  } finally {
    await db.close();
  }
}

(async () => {
  const before = await build(BEFORE);
  const after = await build(null);
  const A = after.attemptId;

  // ---- the attacks -------------------------------------------------------------------------------------------------
  // open(v): the attack worked (the write stuck / the call was accepted). refused: what the patched guard says.
  const attacks = [
    { name: 'a passenger edits their own strike count', who: { uid: ID.P_AUTH }, refused: /policy engine/,
      run: async (tx) => { await tx.query(`UPDATE public.passenger SET strikes_count = 7 WHERE passenger_id = $1`, [ID.P1]);
        await tx.query('RESET ROLE'); return (await tx.query(`SELECT strikes_count v FROM public.passenger WHERE passenger_id = $1`, [ID.P1])).rows[0].v; },
      open: (v) => v === 7 },
    { name: 'an ANONYMOUS caller edits any passenger\'s strike count', who: { uid: null, role: 'anon' }, refused: /policy engine/,
      run: async (tx) => { await tx.query(`UPDATE public.passenger SET strikes_count = 9 WHERE passenger_id = $1`, [ID.P2]);
        await tx.query('RESET ROLE'); return (await tx.query(`SELECT strikes_count v FROM public.passenger WHERE passenger_id = $1`, [ID.P2])).rows[0].v; },
      open: (v) => v === 9 },
    { name: 'a driver gives themselves a suspension end date', who: { uid: ID.D2_AUTH }, refused: /policy engine/,
      run: async (tx) => { await tx.query(`UPDATE public.driver SET suspended_until = now() + interval '30 days' WHERE driver_id = $1`, [ID.D2]);
        await tx.query('RESET ROLE'); return (await tx.query(`SELECT suspended_until v FROM public.driver WHERE driver_id = $1`, [ID.D2])).rows[0].v; },
      open: (v) => v !== null },
    { name: 'a driver changes the plate number of the verified vehicle', who: { uid: ID.D_AUTH }, refused: /ERR_VEHICLE_LOCKED/,
      run: async (tx) => { await tx.query(`UPDATE public.driver SET plate_number = 'HACK-123' WHERE driver_id = $1`, [ID.D1]);
        await tx.query('RESET ROLE'); return (await tx.query(`SELECT plate_number v FROM public.driver WHERE driver_id = $1`, [ID.D1])).rows[0].v; },
      open: (v) => v === 'HACK-123' },
    { name: 'a driver flips themselves Available without driver_go_online()', who: { uid: ID.D2_AUTH }, refused: /ERR_USE_GO_ONLINE/,
      run: async (tx) => { await tx.query(`UPDATE public.driver SET availability_status = 'Available' WHERE driver_id = $1`, [ID.D2]);
        await tx.query('RESET ROLE'); return (await tx.query(`SELECT availability_status v FROM public.driver WHERE driver_id = $1`, [ID.D2])).rows[0].v; },
      open: (v) => v === 'Available' },
    { name: 'a driver with an open accepted booking goes Offline with a plain write (Rule 5.5)', who: { uid: ID.D_AUTH }, refused: /ERR_OPEN_BOOKING/,
      run: async (tx) => { await tx.query(`UPDATE public.driver SET availability_status = 'Offline' WHERE driver_id = $1`, [ID.D1]);
        await tx.query('RESET ROLE'); return (await tx.query(`SELECT availability_status v FROM public.driver WHERE driver_id = $1`, [ID.D1])).rows[0].v; },
      open: (v) => v === 'Offline' },
    { name: 'a driver rewrites the unanswered / resolved columns of an offer', who: { uid: ID.D2_AUTH }, refused: null,
      run: async (tx, attemptId) => { await tx.query(`UPDATE public.dispatch_attempt SET unanswered = TRUE, resolved_at = now() WHERE attempt_id = $1`, [attemptId]);
        await tx.query('RESET ROLE'); return (await tx.query(`SELECT unanswered, resolved_at FROM public.dispatch_attempt WHERE attempt_id = $1`, [attemptId])).rows[0]; },
      open: (v) => v.unanswered === true || v.resolved_at !== null,
      safeValue: (v) => v.unanswered !== true && v.resolved_at === null },
    { name: 'the LGU administrator flips the strike pause switch directly (outside its audited function)', who: { uid: ID.L_AUTH }, refused: /only be changed through set_strike_accrual_pause/,
      run: async (tx) => (await tx.query(`UPDATE public.system_policy_config SET config_value = config_value WHERE config_key = 'strike_accrual_paused'`)).affectedRows,
      open: (v) => v === 1 },
    { name: 'a passenger creates an administrative review flag', who: { uid: ID.P_AUTH }, refused: /Only administrators or the system can create review flags/,
      run: async (tx) => (await tx.query(`SELECT public.create_admin_review_flag('DRIVER_INACTIVITY_REVIEW', 'driver', $1, 'Rule 7.8', 'lgu_admin', NULL) AS v`, [ID.D2])).rows[0].v,
      open: (v) => !!v },
  ];
  const sweeps = [
    { name: 'a passenger runs the strike sweep (service-only function)', refused: /service role only/,
      run: async (tx) => (await tx.query(`SELECT public.sweep_strike_state() AS v`)).rows[0].v },
    { name: 'a passenger runs the presence sweep (service-only function)', refused: /only the system may run the presence sweep/,
      run: async (tx) => (await tx.query(`SELECT public.sweep_driver_presence() AS v`)).rows[0].v },
  ];

  const go = (dump, attemptId, a) => onFresh(dump, (db) => attempt(() => asUser(db, a.who, (tx) => a.run(tx, attemptId))));
  const goSweep = (dump, s) => onFresh(dump, (db) => attempt(() => asClaims(db, { uid: ID.P_AUTH }, (tx) => s.run(tx))));

  // ---- 0. the root cause ----------------------------------------------------------------------------------------------
  console.log('The helper itself, first statement of a brand-new session');
  const helperBefore = await onFresh(before.dump, async (db) => (await db.query(`SELECT public.is_service_context() AS v`)).rows[0].v);
  check('BEFORE the patch: is_service_context() answers NULL (not FALSE)', helperBefore === null, helperBefore);
  const helperAfter = await onFresh(after.dump, async (db) => (await db.query(`SELECT public.is_service_context() AS v`)).rows[0].v);
  check('AFTER the patch: it answers FALSE', helperAfter === false, helperAfter);
  const asSvc = await onFresh(after.dump, (db) => asUser(db, { role: 'service_role' }, async (tx) => (await tx.query(`SELECT public.is_service_context() AS v`)).rows[0].v));
  check('...TRUE for the service role', asSvc === true, asSvc);
  const asInternal = await onFresh(after.dump, (db) => asUser(db, { uid: ID.P_AUTH }, async (tx) => {
    await tx.query(`SELECT set_config('sakay.internal_context', 'true', true)`);
    return (await tx.query(`SELECT public.is_service_context() AS v`)).rows[0].v; }));
  check('...TRUE inside a policy-engine function (internal context)', asInternal === true, asInternal);
  const asUserCtx = await onFresh(after.dump, (db) => asUser(db, { uid: ID.P_AUTH }, async (tx) => (await tx.query(`SELECT public.is_service_context() AS v`)).rows[0].v));
  check('...FALSE for a signed-in passenger', asUserCtx === false, asUserCtx);

  // ---- 1. BEFORE: the flaw is real ----------------------------------------------------------------------------------
  console.log('\nBEFORE the patch (chain through Batch 5), each attack on a brand-new session: it must work');
  for (const a of attacks) {
    const r = await go(before.dump, before.attemptId, a);
    check(`VULNERABLE: ${a.name}`, r.ok && a.open(r.value), r.ok ? r.value : r.error);
  }
  for (const s of sweeps) {
    const r = await goSweep(before.dump, s);
    check(`VULNERABLE: ${s.name}`, r.ok && r.value !== null, r.ok ? r.value : r.error);
  }
  // Why every earlier test passed: in a session where the setting is already defined the old guard holds.
  const warm = await attempt(() => asUser(before.t.db, { uid: ID.P_AUTH }, (tx) => tx.query(`UPDATE public.passenger SET strikes_count = 7 WHERE passenger_id = $1`, [ID.P1])));
  check('(why the tests missed it) in a session that had already defined the setting, the old guard refuses', !warm.ok && /policy engine/.test(warm.error), warm.ok ? 'no error' : warm.error);

  // ---- 2. AFTER: closed -----------------------------------------------------------------------------------------------
  console.log('\nAFTER the patch (full chain), the same attacks on a brand-new session: all refused');
  for (const a of attacks) {
    const r = await go(after.dump, A, a);
    const refusedOk = a.refused ? (!r.ok && a.refused.test(r.error)) : (r.ok && a.safeValue(r.value));
    check(`PROTECTED: ${a.name}`, refusedOk, r.ok ? r.value : r.error);
  }
  for (const s of sweeps) {
    const r = await goSweep(after.dump, s);
    check(`PROTECTED: ${s.name}`, !r.ok && s.refused.test(r.error), r.ok ? r.value : r.error);
  }

  // ---- 3. AFTER: the legitimate paths still work ------------------------------------------------------------------------
  console.log('\nAFTER the patch, the legitimate paths still work (fresh session each)');
  let r = await onFresh(after.dump, (db) => attempt(() => asUser(db, { role: 'service_role' }, async (tx) => (await tx.query(`SELECT public.sweep_strike_state() AS v`)).rows[0].v)));
  check('the service role can run the strike sweep', r.ok && r.value !== null, r.ok ? r.value : r.error);
  r = await onFresh(after.dump, (db) => attempt(() => asUser(db, { role: 'service_role' }, async (tx) => (await tx.query(`SELECT public.sweep_driver_presence() AS v`)).rows[0].v)));
  check('the service role can run the presence sweep', r.ok && r.value !== null, r.ok ? r.value : r.error);
  r = await onFresh(after.dump, (db) => attempt(() => asUser(db, { uid: ID.L_AUTH }, async (tx) => (await tx.query(`SELECT public.create_admin_review_flag('DRIVER_INACTIVITY_REVIEW', 'driver', $1, 'Rule 7.8', 'lgu_admin', NULL) AS v`, [ID.D2])).rows[0].v)));
  check('the LGU administrator can create a review flag', r.ok && !!r.value, r.ok ? r.value : r.error);
  r = await onFresh(after.dump, (db) => attempt(() => asUser(db, { uid: ID.T_AUTH }, async (tx) => (await tx.query(`SELECT public.create_admin_review_flag('DRIVER_INACTIVITY_REVIEW', 'driver', $1, 'Rule 7.8', 'toda_admin', NULL) AS v`, [ID.D1])).rows[0].v)));
  check('a TODA administrator can flag a driver of their own TODA', r.ok && !!r.value, r.ok ? r.value : r.error);
  r = await onFresh(after.dump, (db) => attempt(() => asUser(db, { uid: ID.L_AUTH }, async (tx) => {
    const on = (await tx.query(`SELECT public.set_strike_accrual_pause(true, 'ALL', 'verification') AS v`)).rows[0].v;
    await tx.query('RESET ROLE');
    const cfg = (await tx.query(`SELECT config_value FROM public.system_policy_config WHERE config_key = 'strike_accrual_paused'`)).rows[0].config_value;
    return { on, cfg: JSON.stringify(cfg) }; })));
  check('the LGU administrator can still pause strikes through the audited function', r.ok && r.value.on && /true/.test(r.value.cfg), r.ok ? r.value : r.error);
  r = await onFresh(after.dump, (db) => attempt(() => asUser(db, { role: 'service_role' }, async (tx) => {
    await tx.query(`SELECT public.issue_strike('passenger', $1, 'PAX_LATE_CANCEL')`, [ID.P1]);
    return (await tx.query(`SELECT strikes_count v FROM public.passenger WHERE passenger_id = $1`, [ID.P1])).rows[0].v; })));
  check('the strike engine can still change strike columns (internal context)', r.ok && r.value >= 1, r.ok ? r.value : r.error);
  r = await onFresh(after.dump, (db) => attempt(() => asUser(db, { uid: ID.P_AUTH }, async (tx) => {
    await tx.query(`UPDATE public.passenger SET full_name = 'Renamed By Owner' WHERE passenger_id = $1`, [ID.P1]);
    await tx.query('RESET ROLE');
    return (await tx.query(`SELECT full_name v FROM public.passenger WHERE passenger_id = $1`, [ID.P1])).rows[0].v; })));
  check('an account holder can still edit harmless columns of their own record', r.ok && r.value === 'Renamed By Owner', r.ok ? r.value : r.error);
  r = await onFresh(after.dump, (db) => attempt(() => asUser(db, { uid: ID.L_AUTH }, async (tx) => {
    await tx.query(`UPDATE public.driver SET plate_number = 'LGU-FIX-1' WHERE driver_id = $1`, [ID.D1]);
    await tx.query('RESET ROLE');
    return (await tx.query(`SELECT plate_number v FROM public.driver WHERE driver_id = $1`, [ID.D1])).rows[0].v; })));
  check('the LGU administrator can still change a verified vehicle', r.ok && r.value === 'LGU-FIX-1', r.ok ? r.value : r.error);
  r = await onFresh(after.dump, (db) => attempt(() => asUser(db, { uid: ID.D2_AUTH }, async (tx) => {
    const tok = (await tx.query(`SELECT session_id FROM public.driver WHERE driver_id = $1`, [ID.D2])).rows[0].session_id;
    const on = (await tx.query(`SELECT public.driver_go_online(13.4115, 121.1803, 15, 500, $1) AS v`, [tok])).rows[0].v;
    await tx.query('RESET ROLE');
    return { on, st: (await tx.query(`SELECT availability_status v FROM public.driver WHERE driver_id = $1`, [ID.D2])).rows[0].v }; })));
  check('a driver can still go Online through driver_go_online()', r.ok && r.value.on && r.value.on.success === true && r.value.st === 'Available', r.ok ? r.value : r.error);

  // ---- 4. the patch is safe to run twice ----------------------------------------------------------------------------------
  console.log('\nRe-running the patch');
  const again = await attempt(() => applyFile(after.t.db, PATCH));
  check('the migration can be applied a second time without error', again.ok, again.ok ? 'ok' : again.error);
  const stillNull = (await after.t.db.query(`SELECT public.is_service_context() IS NULL AS n`)).rows[0].n;
  check('...and the helper still never answers NULL', stillNull === false, stillNull);

  await before.t.db.close();
  await after.t.db.close();
  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
