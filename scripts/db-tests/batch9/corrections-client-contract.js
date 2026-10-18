// Rule 16.3 and PI-15: the TypeScript the LGU and TODA portals use to correct a completed trip and to close a trip left at the destination
// (packages/shared/src/utils/tripCorrections.ts) against the REAL database functions. Proves that the call and every parameter name exist (the calls are
// made by NAME, as the portals make them) and, above all, that the screen's own check agrees with the database on a table of inputs: the screen blocks exactly what
// the database refuses, no more (nobody is stopped from a valid correction) and no less (nothing the database would refuse is offered).
// Whole migration chain on the local emulator (never Supabase).
const path = require('path');
const esbuild = require('esbuild');
const { setup, ID, attempt, check, summary, asUser } = require('../b9fixtures');

const SHARED = path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'src', 'utils');
function loadTs(file) {
  const code = esbuild.buildSync({ entryPoints: [file], bundle: true, write: false, format: 'cjs', platform: 'node', target: 'es2022', logLevel: 'silent' }).outputFiles[0].text;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
  return mod.exports;
}

(async () => {
  const tc = loadTs(path.join(SHARED, 'tripCorrections.ts'));
  const s = await setup();
  const { db, one } = s;
  const REASON = 'The driver and the passenger were reached by phone';

  // the database's verdict for named arguments, as the LGU Administrator; `commit: false` rolls it back so one trip serves every case
  const named = (fn, args) => {
    const names = Object.keys(args);
    return `SELECT public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) AS r`;
  };
  const run = (uid, fn, args, commit = false) => attempt(() => asUser(db, { uid }, async (tx) => (await tx.query(named(fn, args), Object.values(args))).rows[0].r, { commit }));

  console.log('S1 correcting a completed trip: the screen agrees with the database');
  const trip = await s.atDestination('D1', 'P1');
  await s.paxCall('P1', 'passenger_confirm_fare($1)', [trip.booking_id]);
  await s.drvCall('D1', 'driver_confirm_payment_received($1)', [trip.booking_id]);
  const before = await s.bk(trip.booking_id);
  const fare = Number(before.actual_fare);
  check('(setup) a completed, paid trip with a system fare', before.booking_status === 'Completed' && before.payment_status === 'Paid' && fare > 0, before);
  const cases = [
    ['a reason that is too short', fare - 5, null, 'short'],
    ['nothing to change given', null, null, REASON],
    ['a payment status that does not exist', null, 'Refunded', REASON],
    ['a fare above the system\'s', fare + 5, null, REASON],
    ['a negative fare', -1, null, REASON],
    ['the same fare and no other change', fare, null, REASON],
    ['the same payment status and no other change', null, 'Paid', REASON],
    ['a lower fare', fare - 15, null, REASON],
    ['a fare of 0 (becomes Waived by itself)', 0, null, REASON],
    ['only the payment status: Waived', null, 'Waived', REASON],
    ['only the payment status: Payment Disputed', null, 'Payment Disputed', REASON],
    ['only the payment status: Unpaid', null, 'Unpaid', REASON],
    ['a lower fare and a payment status', fare - 10, 'Payment Disputed', REASON],
    ['a fare of a few centavos less', fare - 0.01, null, REASON],
    ['a reason of exactly 10 characters', fare - 5, null, '0123456789'],
    ['a reason of 9 characters', fare - 5, null, '012345678'],
    ['a reason with spaces around it that is too short after trimming', fare - 5, null, '   short    '],
  ];
  for (const [label, newFare, payment, reason] of cases) {
    const screen = tc.correctionProblem({ currentFare: fare, currentPayment: 'Paid', newFare, paymentStatus: payment, reason });
    const db1 = await run(ID.L_AUTH, 'admin_correct_completed_trip', tc.correctCompletedTripArgs(trip.booking_id, newFare, payment, reason));
    check(`${label}: the screen ${screen === null ? 'allows' : 'blocks'} it and the database ${db1.ok ? 'accepts' : 'refuses'} it`, (screen === null) === db1.ok, { screen, db: db1.ok ? 'ok' : db1.error });
  }
  const nan = tc.correctionProblem({ currentFare: fare, currentPayment: 'Paid', newFare: Number.NaN, paymentStatus: null, reason: REASON });
  check('a fare that is not a number never leaves the screen', nan !== null, nan);

  console.log('\nS2 the correction really made through the builders');
  const fixed = await run(ID.L_AUTH, 'admin_correct_completed_trip', tc.correctCompletedTripArgs(trip.booking_id, fare - 15, null, `  ${REASON}  `), true);
  const after = await s.bk(trip.booking_id);
  check('the LGU Administrator\'s correction is recorded: the new fare, the reason trimmed in the audit entry', fixed.ok && Number(after.actual_fare) === fare - 15 && (await s.audit('COMPLETED_TRIP_CORRECTED', trip.booking_id))[0].details.endsWith(REASON), fixed);
  const asToda = await run(ID.T_AUTH, 'admin_correct_completed_trip', tc.correctCompletedTripArgs(trip.booking_id, fare - 20, null, REASON));
  check('a TODA Administrator cannot (the screen is the LGU\'s)', !asToda.ok && /Only the LGU Administrator/.test(asToda.error), asToda);
  const nowFare = Number(after.actual_fare);
  check('and the screen now checks against the new fare (the ceiling is what the system holds)', tc.correctionProblem({ currentFare: nowFare, currentPayment: after.payment_status, newFare: nowFare + 1, paymentStatus: null, reason: REASON }) !== null
    && (await run(ID.L_AUTH, 'admin_correct_completed_trip', tc.correctCompletedTripArgs(trip.booking_id, nowFare + 1, null, REASON))).ok === false);
  await s.reset();

  console.log('\nS3 closing a trip left at the destination: the screen agrees with the database');
  const stuck = await s.atDestination('D1', 'P1');
  const closeCases = [
    ['Paid with a reason', 'Paid', REASON],
    ['Waived with a reason', 'Waived', REASON],
    ['Payment Disputed', 'Payment Disputed', REASON],
    ['Unpaid', 'Unpaid', REASON],
    ['no payment status', null, REASON],
    ['Paid with a short reason', 'Paid', 'short'],
    ['Waived with a reason of 10 characters', 'Waived', '0123456789'],
    ['Paid with a reason of 9 characters', 'Paid', '012345678'],
  ];
  for (const [label, payment, reason] of closeCases) {
    const screen = tc.closeProblem(payment, reason);
    const db1 = await run(ID.L_AUTH, 'admin_close_unfinished_trip', payment === null ? { p_booking_id: stuck.booking_id, p_payment_status: null, p_reason: reason } : tc.closeUnfinishedTripArgs(stuck.booking_id, payment, reason));
    check(`${label}: the screen ${screen === null ? 'allows' : 'blocks'} it and the database ${db1.ok ? 'accepts' : 'refuses'} it`, (screen === null) === db1.ok, { screen, db: db1.ok ? 'ok' : db1.error });
  }
  const closed = await run(ID.L_AUTH, 'admin_close_unfinished_trip', tc.closeUnfinishedTripArgs(stuck.booking_id, 'Waived', `  ${REASON}  `), true);
  const done = await s.bk(stuck.booking_id);
  check('closed through the builder as Waived: Completed, the fare 0', closed.ok && done.booking_status === 'Completed' && done.payment_status === 'Waived' && Number(done.actual_fare) === 0, { closed, done });

  console.log('\nThe builders send exactly the database\'s parameter names');
  const names = (fn) => db.query(`SELECT unnest(proargnames) AS n FROM pg_proc WHERE proname = $1 AND pronamespace = 'public'::regnamespace`, [fn]).then((r) => r.rows.map((x) => x.n));
  for (const [fn, args] of [
    ['admin_correct_completed_trip', tc.correctCompletedTripArgs('b', 1, 'Paid', 'reason')],
    ['admin_close_unfinished_trip', tc.closeUnfinishedTripArgs('b', 'Paid', 'reason')],
  ]) {
    const have = await names(fn);
    check(`${fn}: the arguments sent are exactly the function's`, JSON.stringify(Object.keys(args).sort()) === JSON.stringify([...have].sort()), { sent: Object.keys(args), have });
  }
  void one;

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
