// Batch 9: the TypeScript the apps and the portals use for the end of the trip (packages/shared/src/utils/tripEnd.ts, incidentReports.ts) against the REAL database functions.
// Proves that every call name and every parameter name the apps send exists in the database (the calls are made by NAME, as the apps make them), that the reason lists the
// screens offer are exactly the lists the functions accept, that the answers are read into the shapes the screens use, and that the database's own sentences reach the screen.
// Whole migration chain on the local emulator (never Supabase).
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { setup, ID, attempt, check, summary } = require('../b9fixtures');

const SHARED = path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'src', 'utils');
const MIGRATION = path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261024000001_batch9_trip_end_payment_disputes.sql');

function loadTs(file) {
  // bundled, so the file's own imports of the shared package (the policy constants) resolve exactly as they do in the apps
  const code = esbuild.buildSync({ entryPoints: [file], bundle: true, write: false, format: 'cjs', platform: 'node', target: 'es2022', logLevel: 'silent' }).outputFiles[0].text;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
  return mod.exports;
}

(async () => {
  const tsSource = fs.readFileSync(path.join(SHARED, 'tripEnd.ts'), 'utf8');
  const sql = fs.readFileSync(MIGRATION, 'utf8').replace(/\r\n/g, '\n');
  const client = loadTs(path.join(SHARED, 'tripEnd.ts'));
  const s = await setup();
  const { as, q } = s;

  // a Supabase-shaped client whose rpc() calls the real function by NAME as the signed-in user (named notation: a wrong parameter name fails)
  const rpcAs = (uid) => ({
    rpc: async (fn, args) => {
      try {
        const names = Object.keys(args ?? {});
        const r = await as(uid, (tx) => tx.query(`SELECT public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) AS r`, names.map((n) => args[n])));
        return { data: r.rows[0].r, error: null };
      } catch (e) {
        return { data: null, error: { message: e.message } };
      }
    },
  });
  const fnBody = (name) => {
    const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    const j = sql.indexOf('\n$$;', i);
    if (i < 0 || j < 0) throw new Error('function not found in the migration: ' + name);
    return sql.slice(i, j);
  };
  const sqlList = (text, re) => [...(text.match(re)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  const tsCodes = (name, withFlag) => {
    const m = tsSource.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const;`));
    return [...(m?.[1] ?? '').matchAll(new RegExp(`code: '([a-z_]+)'${withFlag ? `[^}]*${withFlag}: (true|false)` : ''}`, 'g'))].map((x) => (withFlag ? [x[1], x[2] === 'true'] : x[1]));
  };

  console.log('S1 every call the TypeScript makes exists in the database, with exactly the parameters it sends');
  const calls = [...tsSource.matchAll(/(?:call\(client,|client\.rpc\()\s*'([a-z_]+)',\s*\{([^}]*)\}/g)].map((m) => ({ fn: m[1], params: [...m[2].matchAll(/(p_[a-z_]+)\s*:/g)].map((x) => x[1]).sort() }));
  const helpers = [
    ['fareDisputesArgs', 'get_fare_disputes'], ['escalateFareDisputeArgs', 'escalate_fare_dispute'], ['resolveFareDisputeArgs', 'resolve_fare_dispute'], ['confirmFlaggedViolationArgs', 'admin_confirm_flagged_violation'],
  ].map(([helper, fn]) => {
    const m = tsSource.match(new RegExp(`export const ${helper} = [\\s\\S]*?\\(\\{([\\s\\S]*?)\\}\\);?`));
    return { fn, params: [...(m?.[1] ?? '').matchAll(/(p_[a-z_]+)\s*:/g)].map((x) => x[1]).sort() };
  });
  // the 10 calls of the two apps (state, 4 passenger buttons + the safety review, 3 driver buttons, the dispute note) and the 4 argument helpers of the portals
  check(`the TypeScript names ${calls.length} database calls and ${helpers.length} argument helpers`, calls.length === 10 && helpers.length === 4 && helpers.every((h) => h.params.length > 0), { calls: calls.map((c) => c.fn), helpers });
  for (const c of [...calls, ...helpers]) {
    const row = (await q(`SELECT proargnames FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = '${c.fn}'`))[0];
    const dbNames = row ? [...row.proargnames].filter((n) => n.startsWith('p_')).sort() : null;
    check(`${c.fn}: the parameters sent (${c.params.join(', ')}) are exactly the function's`, dbNames !== null && JSON.stringify(dbNames) === JSON.stringify(c.params), { sent: c.params, db: dbNames });
  }

  console.log('\nS2 the reason lists on the screens are the lists the functions accept');
  const paxTs = tsCodes('PASSENGER_EARLY_END_REASONS').sort();
  const paxSql = sqlList(fnBody('passenger_request_early_end'), /p_reason_code NOT IN \(([^)]*)\)/);
  check('End Trip (Early): the passenger\'s reasons', paxTs.length === 4 && JSON.stringify(paxTs) === JSON.stringify(paxSql), { paxTs, paxSql });
  const drvTs = tsCodes('DRIVER_EARLY_STOP_REASONS').sort();
  const drvSql = sqlList(fnBody('driver_stop_trip_early'), /p_reason_code NOT IN \(([^)]*)\)/);
  check('the driver\'s early-stop reasons', drvTs.length === 5 && JSON.stringify(drvTs) === JSON.stringify(drvSql), { drvTs, drvSql });
  const validTs = tsCodes('DRIVER_EARLY_STOP_REASONS', 'valid').filter(([, v]) => v).map(([c]) => c).sort();
  const validSql = sqlList(fnBody('_early_stop_reason_is_valid'), /IN \(([^)]*)\)/);
  check('the reasons that are never struck (a breakdown, a safety concern, an emergency) are the same on both sides', JSON.stringify(validTs) === JSON.stringify(validSql) && validTs.length === 3, { validTs, validSql });
  const safetyTs = tsCodes('PASSENGER_EARLY_END_REASONS', 'safety').filter(([, v]) => v).map(([c]) => c);
  check('only safety_concern is the Safety Concern exception (the function turns that one code into the SAFETY kind)', JSON.stringify(safetyTs) === JSON.stringify(['safety_concern']) && /p_reason_code = 'safety_concern' THEN 'SAFETY'/.test(fnBody('passenger_request_early_end')), safetyTs);
  const emergencyTs = [...(fs.readFileSync(path.join(SHARED, 'incidentReports.ts'), 'utf8').match(/EMERGENCY_INCIDENT_CATEGORIES = \[([^\]]*)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  const emergencySql = sqlList(fnBody('incident_report_guard'), /NEW\.category NOT IN \(([^)]*)\)/);
  check('Rule 16.5: the emergency categories the forms allow during a trip are the ones the incident guard allows', emergencyTs.length === 3 && JSON.stringify(emergencyTs) === JSON.stringify(emergencySql), { emergencyTs, emergencySql });
  const resolveBody = fnBody('resolve_fare_dispute');
  const outcomesTs = JSON.stringify(Object.fromEntries([...tsSource.match(/export const FARE_DISPUTE_OUTCOMES = \{([\s\S]*?)\} as const;/)[1].matchAll(/(\w+): \[([^\]]*)\]/g)].map((m) => [m[1], [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort()])));
  const sqlFare = sqlList(resolveBody, /v_d\.kind IN \('FARE_DISCREPANCY', 'SAFETY_REVIEW'\) AND p_outcome IN \(([^)]*)\)/);
  const sqlNon = sqlList(resolveBody, /v_d\.kind = 'NON_PAYMENT' AND p_outcome IN \(([^)]*)\)/);
  check('the decisions the panel offers are the ones the function accepts, for each kind of dispute',
    outcomesTs === JSON.stringify({ FARE_DISCREPANCY: sqlFare, SAFETY_REVIEW: sqlFare, NON_PAYMENT: sqlNon }), { outcomesTs, sqlFare, sqlNon });
  const strikeCodes = [...tsSource.matchAll(/code: '((?:DRV|PAX)_[A-Z_]+)'/g)].map((m) => m[1]);
  const catalog = await q(`SELECT violation_code, applies_to, confirmation_mode FROM violation_catalog WHERE violation_code = ANY($1::text[])`.replace('$1', `ARRAY[${strikeCodes.map((c) => `'${c}'`).join(',')}]`));
  check('every strike the panel can confirm exists in the violation catalog, administrator-confirmed, for the right person',
    strikeCodes.length === 3 && catalog.length === 3 && catalog.every((c) => c.confirmation_mode === 'ADMIN_CONFIRMATION' && (c.violation_code.startsWith('PAX_') ? c.applies_to === 'passenger' : c.applies_to === 'driver')), catalog);

  console.log('\nS3 the answers are read into the shapes the screens use, and the database\'s own sentences reach the screen');
  const b = await s.atDestination('D1', 'P1');
  const pax = rpcAs(ID.P_AUTH), drv = rpcAs(ID.D_AUTH);
  const st = await client.fetchTripEndState(pax, b.booking_id);
  check('fetchTripEndState reads the state at the destination (fare, timer, who can do what)',
    st && st.bookingId === b.booking_id && st.actualFare === 65 && st.paymentStatus === 'Unpaid' && st.canConfirmFare === true && st.canReceivePayment === false && st.timeoutSeconds === 120
    && st.secondsLeft > 100 && typeof st.confirmDeadline === 'string' && typeof st.serverNow === 'string' && st.earlyEnd === null && st.dispute === null, st);
  check('the driver reads the same fare from the same place', (await client.fetchTripEndState(drv, b.booking_id)).actualFare === st.actualFare);
  check('a stranger gets nothing (null), never a half-filled state', (await client.fetchTripEndState(rpcAs(ID.P2_AUTH), b.booking_id)) === null && client.parseTripEndState({ success: false }) === null && client.parseTripEndState(null) === null);
  let r = await client.confirmPaymentReceived(drv, b.booking_id);
  check('Payment Received too early: the database\'s sentence and its code reach the screen', r.ok === false && r.code === 'ERR_WAIT_FOR_PASSENGER' && /Hintayin/.test(r.error) && r.data.seconds_left > 100, r);
  r = await client.reportFareDiscrepancy(pax, b.booking_id, 90, 'short');
  check('a discrepancy without a real explanation: the database\'s sentence, without its ERR_ prefix in the message', r.ok === false && r.code === 'ERR_DISCREPANCY_REASON' && !/^ERR_/.test(r.error), r);
  r = await client.confirmFare(pax, b.booking_id);
  check('confirmFare', r.ok === true && r.code === null && r.data.success === true, r);
  const st2 = await client.fetchTripEndState(drv, b.booking_id);
  check('the driver now reads that Payment Received is open', st2.canReceivePayment === true && st2.confirmFareAt !== null, st2);
  r = await client.confirmPaymentReceived(drv, b.booking_id);
  check('confirmPaymentReceived: Paid and Completed', r.ok === true && r.data.payment_status === 'Paid', r);
  check('describePayment names it for the receipt, in both languages', client.describePayment({ paymentStatus: 'Paid', fareUnconfirmed: false }, 'en') === 'Paid'
    && client.describePayment({ paymentStatus: 'Paid', fareUnconfirmed: true }, 'en') === 'Paid - fare unconfirmed' && client.describePayment({ paymentStatus: 'Payment Disputed', fareUnconfirmed: false }, 'tl').length > 5);
  const bad = await client.requestEarlyEnd({ rpc: async () => ({ data: null, error: { message: 'ERR_TRIP_NOT_ONGOING: The trip has ended.' } }) }, b.booking_id, 'changed_plans');
  check('a refused call that arrives as an exception message is read the same way (code and sentence)', bad.ok === false && bad.code === 'ERR_TRIP_NOT_ONGOING' && bad.error === 'The trip has ended.', bad);
  const down = await client.confirmFare({ rpc: async () => { throw new Error('offline'); } }, b.booking_id);
  check('no network: ok is false with the code NETWORK, nothing thrown', down.ok === false && down.code === 'NETWORK', down);
  await s.reset();

  const late = await s.atDestination('D1', 'P1');
  await s.lockedAgo(late.booking_id, 130);
  await client.confirmPaymentReceived(drv, late.booking_id);
  const open = await client.fetchTripEndState(pax, late.booking_id);
  check('after a timeout finish the state says Paid - fare unconfirmed and that the late report is open', open.fareUnconfirmed === true && open.lateDisputeOpen === true && open.canReportDiscrepancy === true && open.canConfirmFare === false, open);
  r = await client.reportFareDiscrepancy(pax, late.booking_id, 100, 'The driver took 100 pesos from me');
  const disputed = await client.fetchTripEndState(pax, late.booking_id);
  check('the late report is read back as a dispute with its target date', r.ok === true && disputed.paymentStatus === 'Payment Disputed' && disputed.dispute && disputed.dispute.kind === 'FARE_DISCREPANCY' && disputed.dispute.status === 'Open' && typeof disputed.dispute.dueAt === 'string', disputed);
  r = await client.addFareDisputeNote(drv, disputed.dispute.disputeId, 'The passenger asked me to carry two sacks.');
  check('the driver adds his side', r.ok === true, r);
  const queue = await s.todaCall('get_fare_disputes($1,$2)', [null, 100]);
  const parsed = client.parseFareDisputes(queue);
  check('the administrators\' queue is read into rows with every field the panel uses', parsed.length === 1 && parsed[0].dispute_id === disputed.dispute.disputeId && parsed[0].passenger_name === 'Pax One' && parsed[0].notes.length === 2 && typeof parsed[0].overdue === 'boolean' && parsed[0].kind === 'FARE_DISCREPANCY', parsed[0]);
  check('anything else is an empty queue', client.parseFareDisputes(null).length === 0 && client.parseFareDisputes({}).length === 0);
  await s.reset();

  // W10: no payment state stays in a phone and nothing about the payment is broadcast: the code of the apps and the shared package (comments removed) holds no
  // payment_confirmed_* key, no localStorage / sessionStorage key about a payment or a fare confirmation, and no realtime channel about one.
  const ROOT = path.join(__dirname, '..', '..', '..');
  const sources = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) sources.push(p);
    }
  };
  for (const app of fs.readdirSync(path.join(ROOT, 'apps'))) {
    const src = path.join(ROOT, 'apps', app, 'src');
    if (fs.existsSync(src)) walk(src);
  }
  walk(path.join(ROOT, 'packages', 'shared', 'src'));
  const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
  const FORBIDDEN = [/payment_confirmed/i, /(local|session)Storage\s*\.\s*\w+\s*\(\s*[`'"][^`'"]*(payment|paid|fare_confirm)/i, /\.channel\s*\(\s*[`'"][^`'"]*(payment|paid)/i];
  const offenders = sources.filter((f) => FORBIDDEN.some((re) => re.test(stripComments(fs.readFileSync(f, 'utf8'))))).map((f) => path.relative(ROOT, f));
  check('no payment flag is kept in a phone and no payment news is broadcast: the apps and the shared package read the state from the database only (' + sources.length + ' source files read)',
    sources.length > 100 && offenders.length === 0, offenders);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
