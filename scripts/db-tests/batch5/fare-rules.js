// Batch 5 / T3: the fare rule store (Rule 6.3).
//   * only the LGU Administrator can change the rate (RPC and direct table writes)
//   * a change is forward-only, audited (actor, before, after, reason), and never edits history
//   * a booking confirmed before the change keeps the old rate even if it completes afterwards;
//     a booking confirmed after it uses the new rate
const { setup, check, summary } = require('../b5fixtures');

const ORD = 'City Ordinance No. 110-A, Series of 2026';

(async () => {
  const t = await setup();
  const { as, anon, svc, q, one, quote, book, assign, setStatus, getBooking, attempt, num, ID } = t;

  const enact = (uid, args, asAnon = false) => {
    const run = (tx) => tx.query(
      `SELECT public.enact_fare_matrix($1::numeric, $2::numeric, $3::numeric, $4, $5, $6::timestamptz, $7) AS r`,
      [args.base ?? 20, args.baseKm ?? 2, args.rate ?? 2, args.ord === undefined ? ORD : args.ord, args.reason === undefined ? 'Annual review' : args.reason, args.at ?? null, args.notes ?? null]);
    return (asAnon ? anon(run) : as(uid, run)).then((r) => r.rows[0].r);
  };
  const rules = () => q(`SELECT * FROM public.fare_matrix ORDER BY effective_timestamp`);

  console.log('The seeded rule');
  let rows = await rules();
  check('one rule exists: 15 for the first 2 km, 1 per km, effective 2022-06-01', rows.length === 1 && num(rows[0].base_fare) === 15 && num(rows[0].base_distance_km) === 2 && num(rows[0].succeeding_rate) === 1 && new Date(rows[0].effective_timestamp).toISOString() === '2022-06-01T00:00:00.000Z', rows);
  check('its citation is Ordinance No. 110, s. 2022 (decision D4)', rows[0].ordinance_reference === 'City Ordinance No. 110, Series of 2022', rows[0]);
  const R1 = rows[0].fare_matrix_id;
  let inForce = await svc((tx) => tx.query(`SELECT (public.fare_rule_in_force()).fare_matrix_id AS id`));
  check('fare_rule_in_force() is that rule', inForce.rows[0].id === R1, inForce.rows);
  let qt = await quote(ID.P_AUTH, 5, 1);
  check('quote_fare(5 km): seat 18, Solo 72, matched estimate 36, Maximum Unmatched Fare 72, and the rule snapshot', num(qt.seat_fare) === 18 && num(qt.solo_fare) === 72 && num(qt.shared_matched_estimate) === 36 && num(qt.max_unmatched_fare) === 72 && qt.rule.fare_matrix_id === R1 && qt.rule.ordinance_reference.includes('110'), qt);

  console.log('\nOnly the LGU Administrator can change the rate (Rule 6.3)');
  for (const [label, uid, isAnon] of [['a passenger', ID.P_AUTH], ['a driver', ID.D_AUTH], ['a TODA administrator', ID.T_AUTH], ['an anonymous caller', null, true]]) {
    const a = await attempt(() => enact(uid, {}, isAnon));
    check(`${label} cannot enact a rule`, !a.ok && /ERR_NOT_LGU_ADMIN|permission denied/.test(a.error), a);
  }
  check('...and nothing was written', (await rules()).length === 1);
  const direct = [
    ['INSERT', `INSERT INTO public.fare_matrix(base_fare, succeeding_rate, effective_timestamp) VALUES (1, 0.1, now())`],
    ['UPDATE', `UPDATE public.fare_matrix SET base_fare = 1`],
    ['DELETE', `DELETE FROM public.fare_matrix`],
  ];
  for (const [label, uid, isAnon] of [['a passenger', ID.P_AUTH], ['a driver', ID.D_AUTH], ['a TODA administrator', ID.T_AUTH], ['the LGU Administrator', ID.L_AUTH], ['an anonymous caller', null, true]]) {
    for (const [verb, sql] of direct) {
      const run = (tx) => tx.query(sql);
      const a = await attempt(() => (isAnon ? anon(run) : as(uid, run)));
      check(`${label} cannot ${verb} the table directly (the only write path is enact_fare_matrix)`, !a.ok && /permission denied/.test(a.error), a);
    }
  }
  const upd = await attempt(() => svc((tx) => tx.query(`UPDATE public.fare_matrix SET base_fare = 99`)));
  check('even the service role cannot edit a rule version (append-only)', !upd.ok && /ERR_FARE_RULE_APPEND_ONLY/.test(upd.error), upd);
  const del = await attempt(() => svc((tx) => tx.query(`DELETE FROM public.fare_matrix`)));
  check('...or delete one', !del.ok && /ERR_FARE_RULE_APPEND_ONLY/.test(del.error), del);
  check('...so the rule is untouched', num((await rules())[0].base_fare) === 15);

  console.log('\nValidation, and forward-only changes (Rule 6.3)');
  const bad = async (label, args, re) => {
    const a = await attempt(() => enact(ID.L_AUTH, args));
    check(label, !a.ok && re.test(a.error), a);
  };
  await bad('a zero base fare is refused', { base: 0 }, /ERR_INVALID_FARE_RULE/);
  await bad('a negative per-km rate is refused', { rate: -1 }, /ERR_INVALID_FARE_RULE/);
  await bad('3 decimal places are refused (never silently rounded)', { base: 15.005 }, /ERR_INVALID_FARE_RULE/);
  await bad('the ordinance reference is required', { ord: '  ' }, /ERR_ORDINANCE_REQUIRED/);
  await bad('a reason is required', { reason: 'ok' }, /ERR_REASON_REQUIRED/);
  await bad('back-dating a rule by 2 days is refused', { at: new Date(Date.now() - 2 * 86400000).toISOString() }, /ERR_BACKDATED_RATE/);
  check('none of the refused changes wrote a rule or an audit row', (await rules()).length === 1 && (await one(`SELECT count(*)::int n FROM public.audit_log WHERE action_type = 'FARE_MATRIX_ENACTED'`)).n === 0);

  console.log('\nT3  The LGU changes the rate at time T');
  // R2 takes effect 3 seconds from now.
  const at = (await one(`SELECT (clock_timestamp() + interval '3 seconds') AS t`)).t;
  const res = await enact(ID.L_AUTH, { base: 20, baseKm: 2, rate: 2, at: new Date(at).toISOString(), notes: 'Pilot adjustment' });
  const R2 = res.rule.fare_matrix_id;
  check('the LGU Administrator enacts it', res.success === true && res.effective_immediately === false && num(res.rule.base_fare) === 20, res);
  rows = await rules();
  check('it is a new row; the old version is untouched', rows.length === 2 && rows[0].fare_matrix_id === R1 && num(rows[0].base_fare) === 15, rows);
  check('the new row records who configured it', rows[1].configured_by === (await one(`SELECT admin_id FROM lgu_admin WHERE auth_user_id = $1`, [ID.L_AUTH])).admin_id, rows[1]);

  const audit = await one(`SELECT * FROM public.audit_log WHERE action_type = 'FARE_MATRIX_ENACTED'`);
  check('audit_log has one row: actor, role, target, category, reason, before and after state',
    audit && audit.actor_id === ID.L_AUTH && audit.actor_role === 'lgu_admin' && audit.target_id === R2 && audit.category === 'Fare Matrix'
      && /Annual review/.test(audit.details) && num(audit.before_state.base_fare) === 15 && num(audit.after_state.base_fare) === 20, audit);

  let hist = await as(ID.L_AUTH, (tx) => tx.query(`SELECT * FROM public.fare_matrix_history()`));
  check('the history marks R1 "In force" and R2 "Scheduled" (status computed by the database)',
    hist.rows.find((h) => h.fare_matrix_id === R1).status === 'In force' && hist.rows.find((h) => h.fare_matrix_id === R2).status === 'Scheduled', hist.rows.map((h) => h.status));
  check('the history carries the Solo Trip base for each version (base x seats: 60 and 80), so no client multiplies',
    num(hist.rows.find((h) => h.fare_matrix_id === R1).solo_base_fare) === 60 && num(hist.rows.find((h) => h.fare_matrix_id === R2).solo_base_fare) === 80, hist.rows.map((h) => h.solo_base_fare));
  const hp = await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`SELECT * FROM public.fare_matrix_history()`)));
  check('the history is for the LGU Administrator only', !hp.ok && /ERR_NOT_LGU_ADMIN/.test(hp.error), hp);
  inForce = await svc((tx) => tx.query(`SELECT (public.fare_rule_in_force()).fare_matrix_id AS id`));
  check('before T the old rule is still the one in force', inForce.rows[0].id === R1, inForce.rows);

  // A booking confirmed BEFORE T.
  qt = await quote(ID.P_AUTH, 5, 1);
  check('before T the quote is still 72', num(qt.solo_fare) === 72 && qt.rule.fare_matrix_id === R1, qt);
  const X = await book(ID.P_AUTH, ID.P1, { km: 5 });
  check('booking X (confirmed before T): estimate 72 on rule R1, the rule snapshot is on the row',
    num(X.estimated_fare) === 72 && X.fare_matrix_id === R1 && num(X.fare_breakdown.rule.base_fare) === 15, X);

  await new Promise((r) => setTimeout(r, 3600));        // T has passed
  inForce = await svc((tx) => tx.query(`SELECT (public.fare_rule_in_force()).fare_matrix_id AS id`));
  check('after T the new rule is in force', inForce.rows[0].id === R2, inForce.rows);
  hist = await as(ID.L_AUTH, (tx) => tx.query(`SELECT * FROM public.fare_matrix_history()`));
  check('...and the history now says R2 "In force", R1 "Superseded"', hist.rows.find((h) => h.fare_matrix_id === R2).status === 'In force' && hist.rows.find((h) => h.fare_matrix_id === R1).status === 'Superseded');

  qt = await quote(ID.P2_AUTH, 5, 1);
  check('after T the quote uses the new rate: seat 26, Solo 104', num(qt.seat_fare) === 26 && num(qt.solo_fare) === 104 && qt.rule.fare_matrix_id === R2, qt);
  const stale = await attempt(() => book(ID.P2_AUTH, ID.P2, { km: 5, fare: 72 }));
  check('a passenger still holding the OLD fare on screen is refused and must re-quote (ERR_FARE_MISMATCH, expected=104)', !stale.ok && /ERR_FARE_MISMATCH/.test(stale.error) && /expected=104/.test(stale.error), stale);
  const Y = await book(ID.P2_AUTH, ID.P2, { km: 5 });
  check('booking Y (confirmed after T): estimate 104 on rule R2', num(Y.estimated_fare) === 104 && Y.fare_matrix_id === R2 && num(Y.fare_breakdown.rule.base_fare) === 20, Y);

  // Both complete AFTER T.
  await assign(X.booking_id, ID.D1);
  await assign(Y.booking_id, ID.D2);
  await setStatus(ID.D_AUTH, X.booking_id, 'Trip Ongoing');
  await setStatus(ID.D2_AUTH, Y.booking_id, 'Trip Ongoing');
  const Xdone = await setStatus(ID.D_AUTH, X.booking_id, 'Arrived at Destination');
  const Ydone = await setStatus(ID.D2_AUTH, Y.booking_id, 'Arrived at Destination');
  check('X, completed after T, is still billed at the OLD rate: 72', num(Xdone.actual_fare) === 72 && Xdone.fare_matrix_id === R1 && num(Xdone.fare_breakdown.final.actual_fare) === 72, Xdone);
  check('Y is billed at the NEW rate: 104', num(Ydone.actual_fare) === 104 && Ydone.fare_matrix_id === R2 && num(Ydone.fare_breakdown.final.actual_fare) === 104, Ydone);
  check('the rule each booking was billed on is recorded in its breakdown', Xdone.fare_breakdown.rule.fare_matrix_id === R1 && Ydone.fare_breakdown.rule.fare_matrix_id === R2);

  console.log('\nquote_fare is for signed-in users');
  const qa = await attempt(() => anon((tx) => tx.query(`SELECT public.quote_fare(5, 1)`)));
  check('an anonymous caller cannot ask for a quote', !qa.ok && /permission denied/.test(qa.error), qa);
  const q0 = await attempt(() => quote(ID.P_AUTH, 0, 1));
  check('a zero distance is refused', !q0.ok && /ERR_INVALID_DISTANCE/.test(q0.error), q0);
  const q5 = await attempt(() => quote(ID.P_AUTH, 5, 5));
  check('five passengers are refused', !q5.ok && /ERR_INVALID_PASSENGER_COUNT/.test(q5.error), q5);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
