// Batch 5: the TypeScript client in packages/shared/src/utils/fareCalculator.ts, run against the REAL database
// functions (PGlite). Proves the field names and types the apps rely on are exactly what quote_fare() and the
// booking guards produce, and that every fare error the apps must explain is recognised.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { setup, check, summary } = require('../b5fixtures');

// Load a .ts file the way the apps' bundler would (types erased), without writing anything to disk.
function loadTs(file) {
  const code = esbuild.transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
  return mod.exports;
}

(async () => {
  const t = await setup();
  const { as, book, attempt, num, ID, getBooking } = t;
  const client = loadTs(path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'src', 'utils', 'fareCalculator.ts'));

  // A Supabase-shaped client whose rpc() calls the real function as a signed-in passenger.
  const rpcAs = (uid) => ({
    rpc: async (fn, args) => {
      try {
        const names = Object.keys(args);
        const r = await as(uid, (tx) => tx.query(`SELECT public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) AS r`, names.map((n) => args[n])));
        return { data: r.rows[0].r, error: null };
      } catch (e) {
        return { data: null, error: { message: e.message } };
      }
    },
  });

  console.log('fetchFareQuote against the real quote_fare()');
  const q = await client.fetchFareQuote(rpcAs(ID.P_AUTH), 5, 1);
  check('5 km, 1 passenger: seat 18, Solo 72, matched estimate 36, Maximum Unmatched Fare 72',
    q.seat_fare === 18 && q.solo_fare === 72 && q.shared_matched_estimate === 36 && q.max_unmatched_fare === 72 && q.minimum_fare === 15 && q.seat_capacity === 4, q);
  check('the rule snapshot has the typed fields the apps read', typeof q.rule.fare_matrix_id === 'string' && q.rule.base_fare === 15 && q.rule.base_distance_km === 2 && q.rule.succeeding_rate === 1 && q.rule.seat_capacity === 4 && /110/.test(q.rule.ordinance_reference), q.rule);
  check('estimatedFareFor picks the right figure per trip type', client.estimatedFareFor(q, 'Solo') === 72 && client.estimatedFareFor(q, 'Shared') === 36);
  check('componentsFor: Solo is 60 + 12; Shared is half of that', client.componentsFor(q, 'Solo').base === 60 && client.componentsFor(q, 'Solo').distance === 12 && client.componentsFor(q, 'Shared').base === 30 && client.componentsFor(q, 'Shared').distance === 6);
  const two = await client.fetchFareQuote(rpcAs(ID.P_AUTH), 5, 2);
  check('2 passengers: the Solo fare does not change (72); the matched estimate does (2/3 of 72 = 48)', two.solo_fare === 72 && two.shared_matched_estimate === 48, two);

  let a = await attempt(() => client.fetchFareQuote(rpcAs(ID.P_AUTH), 0, 1));
  check('a bad distance throws the database message, which parseFareError recognises', !a.ok && client.parseFareError(a.error)?.code === 'ERR_INVALID_DISTANCE', a);

  console.log('\nA booking made from that quote, and the breakdown the apps read back');
  const row = await book(ID.P_AUTH, ID.P1, { km: 5, fare: client.estimatedFareFor(q, 'Solo') });
  const fb = (await getBooking(row.booking_id)).fare_breakdown;
  check('booking.fare_breakdown has version, rule, estimate (with trip_type and estimated_fare) and no final yet',
    fb.version === 1 && fb.rule.fare_matrix_id === q.rule.fare_matrix_id && fb.estimate.trip_type === 'Solo' && fb.estimate.estimated_fare === 72 && fb.estimate.max_unmatched_fare === 72 && fb.final === null, fb);
  await t.svc((tx) => tx.query(`UPDATE public.booking SET booking_status = 'Completed' WHERE booking_id = $1`, [row.booking_id]));
  const finalRow = await getBooking(row.booking_id);
  const fin = finalRow.fare_breakdown.final;
  check('after the trip the breakdown carries the final block with every field the receipt prints',
    fin.actual_fare === 72 && fin.basis === 'solo' && fin.distance_basis === 'estimate_no_track' && fin.billed_distance_km === 5 && fin.deviation === false
      && fin.components.base === 60 && fin.components.distance === 12 && typeof fin.finalized_at === 'string' && fin.track.fixes_total === 0 && fin.seat_capacity === 4, fin);

  console.log('\nparseFareError / describeFareError cover every error the guards raise');
  const errs = {
    ERR_FARE_MISMATCH: await attempt(() => book(ID.P2_AUTH, ID.P2, { km: 5, fare: 1 })),
    ERR_DISTANCE_REQUIRED: await attempt(() => book(ID.P2_AUTH, ID.P2, { noDistance: true, fare: 72 })),
    ERR_DISTANCE_IMPLAUSIBLE: await attempt(() => book(ID.P2_AUTH, ID.P2, { km: 0.3, fare: 60 })),
    ERR_SCHEDULED_BOOKING_NOT_SUPPORTED: await attempt(() => book(ID.P2_AUTH, ID.P2, { km: 5, type: 'Scheduled' })),
    ERR_FUTURE_BOOKING_NOT_SUPPORTED: await attempt(() => book(ID.P2_AUTH, ID.P2, { km: 5, extra: { requested_at: new Date(Date.now() + 86400000).toISOString() } })),
    ERR_BOOKING_LOCKED: await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`UPDATE public.booking SET pickup_latitude = 13.0 WHERE booking_id = $1`, [row.booking_id]))),
    ERR_FARE_LOCKED: await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`UPDATE public.booking SET actual_fare = 1 WHERE booking_id = $1`, [row.booking_id]))),
  };
  for (const [code, res] of Object.entries(errs)) {
    const parsed = !res.ok ? client.parseFareError(res.error) : null;
    check(`${code}: raised, recognised, and explained in Tagalog and English`,
      parsed && parsed.code === code && client.describeFareError(parsed, 'tl').length > 10 && client.describeFareError(parsed, 'en').length > 10, res.ok ? 'no error' : res.error);
  }
  check('ERR_FARE_MISMATCH tells the app what fare the database expected (72)', client.parseFareError(errs.ERR_FARE_MISMATCH.error).expectedFare === 72);
  check('an unrelated database error is not mistaken for a fare error', client.parseFareError('duplicate key value violates unique constraint') === null && client.parseFareError(null) === null);
  check('the SQL-side fare errors the apps explain are all in the TypeScript list (no code on one side only)',
    ['ERR_FARE_MISMATCH', 'ERR_DISTANCE_IMPLAUSIBLE', 'ERR_DISTANCE_REQUIRED', 'ERR_SCHEDULED_BOOKING_NOT_SUPPORTED', 'ERR_FUTURE_BOOKING_NOT_SUPPORTED', 'ERR_BOOKING_LOCKED', 'ERR_FARE_LOCKED'].every((c) => num(client.parseFareError(`${c}: x`) ? 1 : 0) === 1));

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
