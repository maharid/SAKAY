// Rules 20, 22, 25: the TypeScript the Passenger / Driver apps and the LGU / TODA portals use for strike appeals
// (packages/shared/src/utils/strikeAppeals.ts and exemptionReview.ts) against the REAL database functions and row security.
// Proves that every call and every parameter name exists (the calls are made by NAME, as the apps make them), that a passenger can read and appeal only her own
// strikes and the appeal goes to the LGU Administrator, that what the screens offer ("Appeal") matches what the database accepts, that the review records are read
// correctly from real rows, and that decide / escalate / void / close arrive as the database expects. Whole migration chain on the local emulator (never Supabase).
const path = require('path');
const esbuild = require('esbuild');
const { freshDb, asUser, attempt, check, summary } = require('../tlib');
const { ID, seed } = require('../fixtures');

const SHARED = path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'src', 'utils');

function loadTs(file) {
  const code = esbuild.buildSync({ entryPoints: [file], bundle: true, write: false, format: 'cjs', platform: 'node', target: 'es2022', logLevel: 'silent' }).outputFiles[0].text;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
  return mod.exports;
}

(async () => {
  const appeals = loadTs(path.join(SHARED, 'strikeAppeals.ts'));
  const review = loadTs(path.join(SHARED, 'exemptionReview.ts'));
  const { adminActionMessage } = loadTs(path.join(SHARED, 'tripReconciliation.ts'));

  const db = await freshDb();
  await seed(db);
  const svc = (fn) => asUser(db, { role: 'service_role' }, fn, { commit: true });
  const as = (uid, fn) => asUser(db, { uid }, fn, { commit: true });
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const strike = (type, id, code, key) => svc(async (tx) => (await tx.query('SELECT public.issue_strike($1,$2,$3,NULL,NULL,NULL,$4,NULL,NULL,NULL,NULL) r', [type, id, code, key])).rows[0].r);
  const sid = async (key) => (await q(`SELECT strike_id FROM strikes_ledger WHERE idempotency_key = $1`, [key]))[0].strike_id;

  // a Supabase-shaped client acting as a signed-in user: rpc by NAME (a wrong parameter name fails) and the one table query the screens make
  const clientAs = (uid) => ({
    rpc: async (fn, args) => {
      try {
        const names = Object.keys(args ?? {});
        const r = await as(uid, (tx) => tx.query(`SELECT public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) AS r`, names.map((n) => (typeof args[n] === 'object' && args[n] !== null ? JSON.stringify(args[n]) : args[n]))));
        return { data: r.rows[0].r, error: null };
      } catch (e) {
        return { data: null, error: { message: e.message } };
      }
    },
    from: (table) => ({
      select: (columns) => ({
        order: (column, opts) => ({
          limit: async (n) => {
            try {
              const r = await as(uid, (tx) => tx.query(`SELECT ${columns} FROM public.${table} ORDER BY ${column} ${opts.ascending ? 'ASC' : 'DESC'} LIMIT ${Number(n)}`));
              return { data: r.rows, error: null };
            } catch (e) {
              return { data: null, error: { message: e.message } };
            }
          },
        }),
      }),
    }),
  });
  const pax = clientAs(ID.P_AUTH);
  const pax2 = clientAs(ID.P2_AUTH);
  const lgu = clientAs(ID.L_AUTH);
  const toda = clientAs(ID.T_AUTH);

  console.log('G7 a passenger reads her own strikes');
  await strike('passenger', ID.P1, 'PAX_LATE_CANCEL', 'p1-lc');
  const own = await appeals.fetchStrikeHistory(pax, 'passenger', ID.P1);
  check('her history arrives in the shape the screen uses', own && own.activeStrikes === 1 && own.windowDays > 0 && own.strikes.length === 1, own);
  const s1 = own.strikes[0];
  check('...with the catalog description, the rule, the points and the issue time', s1.description.length > 5 && /Rule/.test(s1.sourceRule) && s1.pointsActive === 1 && s1.pointsIssued === 1 && Number.isFinite(Date.parse(s1.issuedAt)), s1);
  const strangerView = await appeals.fetchStrikeHistory(pax2, 'passenger', ID.P1);
  check('another passenger cannot read it (null: "could not load", not an empty list)', strangerView === null);
  check('"Appeal" is offered for a fresh strike', appeals.canAppealStrike(s1, undefined) === true);

  console.log('\nG7 she appeals; the database routes it to the LGU Administrator (Rule 25.5)');
  const sent = await appeals.submitStrikeAppeal(pax, s1.strikeId, 'NETWORK_OUTAGE', '  The signal was out all morning.  ');
  check('the appeal is accepted and says the LGU Administrator will decide', sent.ok === true && sent.assignedRole === 'lgu_admin', sent);
  const mine = await appeals.fetchOwnAppeals(pax);
  check('she sees her appeal, waiting for the LGU, with the decision date three business days out', mine.length === 1 && mine[0].status === 'Pending LGU Review' && mine[0].causeCode === 'NETWORK_OUTAGE' && Date.parse(mine[0].decisionDueAt) > Date.now() + 2.5 * 86400000, mine);
  const stored = (await q(`SELECT justification FROM exemption_request WHERE strike_id = $1`, [s1.strikeId]))[0];
  check('the words were trimmed', stored.justification === 'The signal was out all morning.', stored);
  check('"Appeal" is no longer offered while it waits', appeals.canAppealStrike(s1, mine[0]) === false);
  const twice = await appeals.submitStrikeAppeal(pax, s1.strikeId, 'OTHER', 'again');
  check('a second appeal of the same strike is refused with the database\'s sentence', !twice.ok && /already pending/.test(twice.error), twice);
  const others = await appeals.fetchOwnAppeals(pax2);
  check('another passenger sees none of it', others.length === 0, others);
  const theirs = await appeals.submitStrikeAppeal(pax2, s1.strikeId, 'OTHER', 'it is mine now');
  check('and cannot appeal it, the message without the "Access Denied:" prefix', !theirs.ok && /own strike/.test(theirs.error) && !/Access Denied/.test(theirs.error), theirs);
  const emptyWords = await appeals.submitStrikeAppeal(pax, s1.strikeId, 'OTHER', '   ');
  check('an appeal with no words is refused', !emptyWords.ok && /justification/i.test(emptyWords.error), emptyWords);

  console.log('\nG7 the 48 hours (Rule 25.1)');
  await strike('passenger', ID.P1, 'PAX_NO_SHOW', 'p1-ns');
  await db.query(`UPDATE strikes_ledger SET issued_at = now() - interval '49 hours' WHERE idempotency_key = 'p1-ns'`);
  const aged = (await appeals.fetchStrikeHistory(pax, 'passenger', ID.P1)).strikes.find((x) => x.violationCode === 'PAX_NO_SHOW');
  check('the screen no longer offers "Appeal" after 48 hours', appeals.canAppealStrike(aged, undefined) === false, aged);
  const late = await appeals.submitStrikeAppeal(pax, aged.strikeId, 'OTHER', 'too late');
  check('the database refuses it too, naming the window', !late.ok && /48 hour window/.test(late.error), late);
  await db.query(`UPDATE strikes_ledger SET issued_at = now() - interval '1 hour' WHERE idempotency_key = 'p1-ns'`);

  console.log('\nG8 the LGU Administrator reads the appeals');
  const asLguRows = async () => {
    const requests = (await as(ID.L_AUTH, (tx) => tx.query(`SELECT request_id, strike_id, subject_type, subject_id, cause_code, justification, evidence_urls, status, assigned_role, requested_at, decision_due_at, escalation_reason, auto_denied, decided_at, decision_reason, points_waived FROM exemption_request ORDER BY requested_at DESC`))).rows;
    const strikes = (await as(ID.L_AUTH, (tx) => tx.query(`SELECT strike_id, violation_code, source_rule, status, points_active, points_issued FROM strikes_ledger`))).rows;
    const catalog = (await as(ID.L_AUTH, (tx) => tx.query(`SELECT violation_code, description FROM violation_catalog`))).rows;
    const people = [
      ...(await as(ID.L_AUTH, (tx) => tx.query(`SELECT passenger_id AS id, full_name AS name FROM passenger`))).rows.map((p) => ({ ...p, type: 'passenger' })),
      ...(await as(ID.L_AUTH, (tx) => tx.query(`SELECT driver_id AS id, full_name AS name FROM driver`))).rows.map((p) => ({ ...p, type: 'driver' })),
    ];
    return { requests, strikes, catalog, people };
  };
  let rows = review.mapAppealRows(await asLguRows());
  check('one waiting appeal: the passenger, her strike, the cause, her words', rows.length === 1 && rows[0].subjectType === 'passenger' && rows[0].subjectName === 'Pax One' && rows[0].status === 'Pending LGU Review' && rows[0].assignedRole === 'lgu_admin' && rows[0].causeCode === 'NETWORK_OUTAGE' && /signal/.test(rows[0].justification), rows);
  check('...the violation reads "description (rule)", with the points', /Rule/.test(rows[0].violation) && rows[0].pointsActive === 1 && rows[0].overdue === false, rows[0]);
  await db.query(`UPDATE exemption_request SET decision_due_at = now() - interval '1 hour' WHERE status = 'Pending LGU Review'`);
  rows = review.mapAppealRows(await asLguRows());
  check('past its due date and still waiting it is OVERDUE', rows[0].overdue === true, rows[0]);
  const todaSees = await as(ID.T_AUTH, (tx) => tx.query(`SELECT count(*)::int n FROM exemption_request`));
  check('a TODA administrator does not see a passenger\'s appeal (row security)', todaSees.rows[0].n === 0, todaSees.rows);

  console.log('\nG8 the decision arrives as the database expects');
  const reqId = rows[0].requestId;
  const noReason = await lgu.rpc('decide_exemption', review.decideExemptionArgs(reqId, 'FULL', '    '));
  check('a blank reason is refused by the database (the screen checks first)', noReason.error && /reason is required/.test(noReason.error.message) && review.decisionProblem('FULL', '   ', null, 1) !== null, noReason);
  const toLate = await lgu.rpc('decide_exemption', review.decideExemptionArgs(reqId, 'FULL', '  The signal outage is confirmed by the telco advisory.  '));
  check('Full waiver by the LGU Administrator is recorded', toLate.error === null && toLate.data.status === 'Full Waiver', toLate);
  rows = review.mapAppealRows(await asLguRows());
  const decided = rows.find((r) => r.requestId === reqId);
  check('...the record now reads as decided, with the trimmed reason, and is no longer overdue', decided.status === 'Full Waiver' && decided.decisionReason === 'The signal outage is confirmed by the telco advisory.' && decided.overdue === false && decided.pointsWaived !== null, decided);
  const afterWaiver = await appeals.fetchStrikeHistory(pax, 'passenger', ID.P1);
  check('...and the passenger sees the decision, her late-cancellation strike waived, and only the other strike counting',
    (await appeals.fetchOwnAppeals(pax)).find((a) => a.requestId === reqId).status === 'Full Waiver' && afterWaiver.strikes.find((x) => x.violationCode === 'PAX_LATE_CANCEL').status === 'WAIVED' && afterWaiver.activeStrikes === 2, afterWaiver);

  // a two-point strike: partial waiver
  await strike('passenger', ID.P2, 'PAX_NO_SHOW', 'p2-ns');
  const p2s = (await appeals.fetchStrikeHistory(pax2, 'passenger', ID.P2)).strikes[0];
  const p2sent = await appeals.submitStrikeAppeal(pax2, p2s.strikeId, 'OTHER', 'The driver was at the wrong place.');
  const p2req = (await asLguRows()).requests.find((r) => r.strike_id === p2s.strikeId).request_id;
  check('(precondition) a no-show is two points', p2sent.ok && p2s.pointsActive === 2, p2s);
  check('the screen refuses a partial waiver of 0 or of all the points before sending', review.decisionProblem('PARTIAL', 'ok reason', 0, 2) !== null && review.decisionProblem('PARTIAL', 'ok reason', 2, 2) !== null && review.decisionProblem('PARTIAL', 'ok reason', 1, 2) === null);
  const partial = await lgu.rpc('decide_exemption', review.decideExemptionArgs(p2req, 'PARTIAL', 'Partly justified: the pickup pin was wrong', 1));
  const p2after = (await q(`SELECT status, points_active FROM strikes_ledger WHERE strike_id = $1`, [p2s.strikeId]))[0];
  check('a partial waiver of one point leaves one', partial.error === null && p2after.points_active === 1 && p2after.status === 'PARTIALLY_WAIVED', { partial, p2after });

  console.log('\nG8 escalate, void, close');
  // a clean driver of TODA One: the appeal goes to the TODA first
  await db.exec(`INSERT INTO auth.users(id,email) VALUES ('20000000-0000-0000-0000-000000000004','d4@x.com');
    INSERT INTO public.driver(driver_id,auth_user_id,full_name,contact_number,account_status,toda_id)
    VALUES ('b0000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000004','Driver Four','+639180000004','Verified','${ID.TODA1}')`);
  const D4 = 'b0000000-0000-0000-0000-000000000004';
  await strike('driver', D4, 'DRV_STALL', 'd4-stall');
  const drv = clientAs('20000000-0000-0000-0000-000000000004');
  const d4s = (await appeals.fetchStrikeHistory(drv, 'driver', D4)).strikes[0];
  const d4sent = await appeals.submitStrikeAppeal(drv, d4s.strikeId, 'VEHICLE_BREAKDOWN', 'The front tyre burst.');
  check('a driver\'s appeal goes to the TODA Administrator first (Rule 25.4)', d4sent.ok && d4sent.assignedRole === 'toda_admin', d4sent);
  const d4req = (await q(`SELECT request_id FROM exemption_request WHERE strike_id = $1`, [d4s.strikeId]))[0].request_id;
  const lguFirst = review.mapAppealRows(await asLguRows()).find((r) => r.requestId === d4req);
  check('the LGU sees it as with the TODA (read only on the screen)', lguFirst.status === 'Pending TODA Review' && lguFirst.assignedRole === 'toda_admin' && lguFirst.subjectType === 'driver' && lguFirst.subjectName === 'Driver Four', lguFirst);
  const emptyEsc = await toda.rpc('escalate_exemption_request', review.escalateExemptionArgs(d4req, '   '));
  check('passing it on needs a reason', emptyEsc.error && /escalation reason is required/.test(emptyEsc.error.message), emptyEsc);
  const esc = await toda.rpc('escalate_exemption_request', review.escalateExemptionArgs(d4req, '  The TODA operator is the other party.  '));
  const afterEsc = review.mapAppealRows(await asLguRows()).find((r) => r.requestId === d4req);
  check('the TODA Administrator passes it to the LGU, which then holds it with the reason', esc.error === null && afterEsc.status === 'Pending LGU Review' && afterEsc.assignedRole === 'lgu_admin' && afterEsc.escalationReason === 'The TODA operator is the other party.', { esc, afterEsc });

  const voided = await lgu.rpc('admin_void_strike', review.voidStrikeArgs(d4s.strikeId, '  Issued against the wrong driver.  '));
  const d4ledger = (await q(`SELECT status, points_active FROM strikes_ledger WHERE strike_id = $1`, [d4s.strikeId]))[0];
  const d4closed = review.mapAppealRows(await asLguRows()).find((r) => r.requestId === d4req);
  check('voiding the strike removes it and closes its open appeal', voided.error === null && d4ledger.status === 'VOIDED' && d4ledger.points_active === 0 && d4closed.status === 'Denied' && /voided/i.test(d4closed.decisionReason), { voided, d4ledger, d4closed });
  const voidAsToda = await toda.rpc('admin_void_strike', review.voidStrikeArgs(p2s.strikeId, 'not allowed'));
  check('a TODA administrator cannot void a strike (LGU only)', voidAsToda.error && /Only LGU Administrators/.test(voidAsToda.error.message) && adminActionMessage(voidAsToda.error.message, 'x').startsWith('Only LGU'), voidAsToda);

  const notReviewed = await lgu.rpc('admin_close_account', review.closeAccountArgs('passenger', ID.P2, 'Repeated abuse of drivers over many weeks', false));
  check('closing an account without the history review is refused', notReviewed.error && /full violation history was reviewed/.test(notReviewed.error.message), notReviewed);
  const closed = await lgu.rpc('admin_close_account', review.closeAccountArgs('passenger', ID.P2, '  Repeated abuse of drivers over many weeks  ', true));
  const p2row = (await q(`SELECT closed_at, account_status FROM passenger WHERE passenger_id = $1`, [ID.P2]))[0];
  check('with the review confirmed the account is closed for good', closed.error === null && p2row.closed_at !== null && p2row.account_status === 'Deactivated', { closed, p2row });
  const closeAsPax = await pax.rpc('admin_close_account', review.closeAccountArgs('passenger', ID.P1, 'I want to close mine as admin', true));
  check('a passenger cannot call it', closeAsPax.error && /Only LGU Administrators|permission denied/.test(closeAsPax.error.message), closeAsPax);

  console.log('\nThe builders send exactly the database\'s parameter names');
  const names = (fn) => q(`SELECT unnest(proargnames) AS n FROM pg_proc WHERE proname = $1 AND pronamespace = 'public'::regnamespace`, [fn]).then((r) => r.map((x) => x.n));
  for (const [fn, args] of [
    ['decide_exemption', review.decideExemptionArgs('r', 'FULL', 'reason')],
    ['escalate_exemption_request', review.escalateExemptionArgs('r', 'reason')],
    ['admin_void_strike', review.voidStrikeArgs('s', 'reason')],
    ['admin_close_account', review.closeAccountArgs('passenger', 'id', 'reason', true)],
    ['submit_exemption_request', { p_strike_id: 1, p_cause_code: 1, p_justification: 1, p_evidence: 1, p_toda_is_party: 1 }],
    ['get_strike_history', { p_subject_type: 1, p_subject_id: 1 }],
  ]) {
    const have = await names(fn);
    check(`${fn}: every argument the app sends exists`, Object.keys(args).every((k) => have.includes(k)), { sent: Object.keys(args), have });
  }
  void attempt;

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
