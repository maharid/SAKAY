// Rules 5.3 / 5.7: the TypeScript the portals and the Passenger app use to REPORT a driver (queue conflict, availability violation) and to CONFIRM a report
// (packages/shared/src/utils/availabilityReports.ts) against the REAL database functions. Proves that the call and every parameter name exist (the calls are made by
// NAME), that the kinds and the flag types the screens know are exactly the ones the database uses, that the screen's check agrees with the database about a report
// (a description is required), and that a report is a flag only: the strike comes with the confirmation, under the confirming administrator's name.
// Whole migration chain on the local emulator (never Supabase).
const path = require('path');
const esbuild = require('esbuild');
const { setup, ID, attempt, check, summary, asUser } = require('../b4fixtures');

const SHARED = path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'src', 'utils');
function loadTs(file) {
  const code = esbuild.buildSync({ entryPoints: [file], bundle: true, write: false, format: 'cjs', platform: 'node', target: 'es2022', logLevel: 'silent' }).outputFiles[0].text;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
  return mod.exports;
}

(async () => {
  const ar = loadTs(path.join(SHARED, 'availabilityReports.ts'));
  const t = await setup();
  const { db, one, q, mkBooking } = t;

  const named = (fn, args) => `SELECT public.${fn}(${Object.keys(args).map((n, i) => `${n} => $${i + 1}`).join(', ')}) AS r`;
  const call = (uid, fn, args, commit = true) => attempt(() => asUser(db, { uid }, async (tx) => (await tx.query(named(fn, args), Object.values(args))).rows[0].r, { commit }));
  const strikes = async (driver) => (await one(`SELECT count(*)::int n FROM strikes_ledger WHERE subject_id = '${driver}'`)).n;

  console.log('The kinds and the flag types the screens know are the database\'s');
  check('the two kinds', JSON.stringify(ar.AVAILABILITY_KINDS.map((k) => k.kind).sort()) === JSON.stringify(['AVAILABILITY_VIOLATION', 'QUEUE_CONFLICT']), ar.AVAILABILITY_KINDS);
  const unknown = await call(ID.T_AUTH, 'report_driver_availability_violation', ar.reportAvailabilityArgs(ID.D1, 'SOMETHING_ELSE', null, 'x'), false);
  check('a kind the screens do not offer is refused by the database', !unknown.ok && /Unknown report kind/.test(unknown.error), unknown);

  console.log('\nThe screen\'s check agrees with the database about a report');
  for (const [label, description] of [['a description', 'Seen in the terminal queue while accepting an app booking.'], ['a blank description', '   '], ['an empty description', '']]) {
    const screen = ar.reportProblem(ID.D1, description);
    const db1 = await call(ID.T_AUTH, 'report_driver_availability_violation', ar.reportAvailabilityArgs(ID.D1, 'QUEUE_CONFLICT', null, description), false);
    check(`${label}: the screen ${screen === null ? 'allows' : 'blocks'} it and the database ${db1.ok ? 'accepts' : 'refuses'} it`, (screen === null) === db1.ok, { screen, db: db1.ok ? 'ok' : db1.error });
  }
  check('no driver chosen is blocked before anything is sent', ar.reportProblem(null, 'something') !== null && ar.reportProblem('', 'something') !== null);

  console.log('\nReporting is a flag only; confirming records the strike');
  const filed = await call(ID.T_AUTH, 'report_driver_availability_violation', ar.reportAvailabilityArgs(ID.D1, 'QUEUE_CONFLICT', null, '  Seen in the terminal queue while accepting an app booking.  '));
  check('the TODA Administrator\'s report is filed', filed.ok && !!filed.value.flag_id, filed);
  const flag = await one(`SELECT flag_type, status, assigned_role, details FROM admin_review_flag WHERE flag_id = '${filed.value.flag_id}'`);
  check('...as a flag of the type the screens list, with the description trimmed, for the driver\'s TODA', ar.isAvailabilityFlag(flag.flag_type) && flag.assigned_role === 'toda_admin' && flag.details.description === 'Seen in the terminal queue while accepting an app booking.' && flag.details.reported_by === 'toda_admin', flag);
  check('...and nobody is struck yet', (await strikes(ID.D1)) === 0);
  const otherToda = await call(ID.T2_AUTH, 'confirm_driver_availability_violation', ar.confirmAvailabilityArgs(filed.value.flag_id, 'Not my driver at all'), false);
  check('another TODA\'s administrator cannot confirm it', !otherToda.ok, otherToda);
  const confirmed = await call(ID.T_AUTH, 'confirm_driver_availability_violation', ar.confirmAvailabilityArgs(filed.value.flag_id, '  Confirmed by the terminal marshal and the dispatch log.  '));
  const row = await one(`SELECT violation_code, points_active FROM strikes_ledger WHERE subject_id = '${ID.D1}'`);
  const audit = await one(`SELECT actor_id, actor_role FROM audit_log WHERE action_type = 'STRIKE_ISSUED' AND target_id = '${ID.D1}' ORDER BY performed_at DESC LIMIT 1`);
  check('confirming records exactly one DRV_QUEUE_CONFLICT strike, under the confirming administrator\'s name', confirmed.ok && row.violation_code === 'DRV_QUEUE_CONFLICT' && row.points_active === 1 && (await strikes(ID.D1)) === 1 && (!audit || audit.actor_id === ID.T_AUTH), { confirmed, row, audit });
  check('...and the flag is resolved (so it leaves the list)', (await one(`SELECT status FROM admin_review_flag WHERE flag_id = '${filed.value.flag_id}'`)).status === 'Resolved');

  console.log('\nA passenger reports the driver of her own trip (Rule 5.7)');
  const trip = await mkBooking(ID.P1, 'Completed', ID.D1);
  const paxRep = await call(ID.P_AUTH, 'report_driver_availability_violation', ar.reportAvailabilityArgs(ID.D1, 'AVAILABILITY_VIOLATION', trip, 'The driver already had two passengers and still took my booking.'));
  check('the passenger of a trip this driver served can report it', paxRep.ok, paxRep);
  const paxFlag = await one(`SELECT flag_type, details FROM admin_review_flag WHERE flag_id = '${paxRep.value.flag_id}'`);
  check('...it is an availability-violation flag naming her trip, reported by a passenger', paxFlag.flag_type === 'DRIVER_AVAILABILITY_VIOLATION_REPORT' && ar.isAvailabilityFlag(paxFlag.flag_type) && paxFlag.details.reported_by === 'passenger' && paxFlag.details.booking_id === trip, paxFlag);
  const stranger = await call(ID.P2_AUTH, 'report_driver_availability_violation', ar.reportAvailabilityArgs(ID.D1, 'AVAILABILITY_VIOLATION', trip, 'It was not my trip.'), false);
  check('a passenger who was not on that trip cannot', !stranger.ok && /cannot report this driver/.test(stranger.error), stranger);
  const noTrip = await call(ID.P_AUTH, 'report_driver_availability_violation', ar.reportAvailabilityArgs(ID.D1, 'AVAILABILITY_VIOLATION', null, 'No trip named.'), false);
  check('and a passenger must name the trip', !noTrip.ok, noTrip);
  check('the flag type list is exactly the two the database creates', JSON.stringify([...ar.AVAILABILITY_FLAG_TYPES].sort()) === JSON.stringify(['DRIVER_AVAILABILITY_VIOLATION_REPORT', 'DRIVER_QUEUE_CONFLICT_REPORT']));

  console.log('\nThe builders send exactly the database\'s parameter names');
  const names = (fn) => db.query(`SELECT unnest(proargnames) AS n FROM pg_proc WHERE proname = $1 AND pronamespace = 'public'::regnamespace`, [fn]).then((r) => r.rows.map((x) => x.n));
  for (const [fn, args] of [
    ['report_driver_availability_violation', ar.reportAvailabilityArgs('d', 'QUEUE_CONFLICT', null, 'x')],
    ['confirm_driver_availability_violation', ar.confirmAvailabilityArgs('f', 'reason')],
  ]) {
    const have = await names(fn);
    check(`${fn}: the arguments sent are exactly the function's`, JSON.stringify(Object.keys(args).sort()) === JSON.stringify([...have].sort()), { sent: Object.keys(args), have });
  }
  void q;

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
