// Permanent rejection reasons (20261010000003): the TODA rejects with one of five fixed grounds (+ an optional note); rejection is final.
// Whole migration chain, local emulator only (never Supabase).
//
//   BEFORE the migration (chain through 20261010000002): only 'ineligible' and 'fraudulent' are accepted.
//   AFTER:  the five grounds are accepted and nothing else; the LGU's two old categories still work; one affiliation at a time; final.
const { setup, ID, attempt, check, summary, asUser } = require('../b4fixtures');

const BEFORE = '20261010000002_otp_failed_attempt_window.sql';
const CODES = ['fraudulent', 'license_mtop_revoked', 'ineligible', 'duplicate_identity', 'failed_background_check'];
const mk = (n) => ({ AUTH: `22000000-0000-0000-0000-0000000000${n}`, ID: `b2000000-0000-0000-0000-0000000000${n}` });
const apps = (...ids) => JSON.stringify(ids.map((toda_id) => ({ toda_id })));

async function world(until) {
  const t = await setup(until);
  const { db, internal, one } = t;
  const rpc = (uid, name, args = []) => asUser(db, { uid }, (tx) => {
    const ph = args.map((_, i) => `$${i + 1}`).join(',');
    return tx.query(`SELECT public.${name}(${ph}) AS r`, args);
  }, { commit: true }).then((r) => r.rows[0].r);
  const drivers = [mk('d1'), mk('d2'), mk('d3'), mk('d4'), mk('d5'), mk('d6'), mk('d7'), mk('d8')];   // 5 reasons, legacy TODA, legacy LGU, two-TODA driver
  const X = mk('e1');   // applies to TODA1 and TODA2
  const all = [...drivers, X];
  await internal(`
    INSERT INTO auth.users(id,email) VALUES ${all.map((d, i) => `('${d.AUTH}','r${i}@x.com')`).join(',')};
    INSERT INTO public.driver(driver_id,auth_user_id,full_name,contact_number,account_status,availability_status,toda_id) VALUES
      ${all.map((d, i) => `('${d.ID}','${d.AUTH}','Driver R${i}','+63919000010${i}','Pending Verification','Offline','${ID.TODA1}')`).join(',')};
    INSERT INTO public.driver_verification(driver_id, submitted_license_number, submitted_franchise_number) VALUES
      ${all.map((d, i) => `('${d.ID}','L-R${i}','F-R${i}')`).join(',')};`);
  for (const d of drivers) await rpc(d.AUTH, 'apply_driver_toda_affiliations', [apps(ID.TODA1)]);
  await rpc(X.AUTH, 'apply_driver_toda_affiliations', [apps(ID.TODA1, ID.TODA2)]);
  const aff = async (driver, toda = ID.TODA1) => (await one(`SELECT affiliation_id FROM driver_toda_affiliation WHERE driver_id='${driver.ID}' AND toda_id='${toda}'`)).affiliation_id;
  const row = (a) => one(`SELECT toda_endorsement_status s, lgu_verification_status l, toda_rejection_reason tr, lgu_rejection_reason lr FROM driver_toda_affiliation WHERE affiliation_id='${a}'`);
  return { t, rpc, drivers, X, aff, row };
}

(async () => {
  console.log('BEFORE the migration');
  const b = await world(BEFORE);
  const bA = await b.aff(b.drivers[0]);
  const bNew = await b.rpc(ID.T_AUTH, 'reject_driver_affiliation', [bA, 'duplicate_identity', null]);
  check('only two categories existed: a new ground is refused', bNew.success === false && /ERR_INVALID_REJECTION_REASON/.test(bNew.error), bNew);
  await b.t.db.close();

  console.log('\nAFTER the migration (full chain)');
  const w = await world(null);
  const { t, rpc, drivers, X, aff, row } = w;
  const { one, q } = t;

  console.log('R1 each of the five grounds is accepted for the TODA stage and stored as its code');
  for (let i = 0; i < CODES.length; i++) {
    const a = await aff(drivers[i]);
    const note = i % 2 === 0 ? 'checked against the LTO record' : null;     // the note is optional
    const r = await rpc(ID.T_AUTH, 'reject_driver_affiliation', [a, CODES[i], note]);
    const st = await row(a);
    check(`${CODES[i]}${note ? ' (with a note)' : ' (no note)'}: accepted, the TODA stage is Rejected`, r.success === true && st.s === 'Rejected', r);
    check(`  ...stored as "${CODES[i]}: ..." for the screens to translate`, typeof st.tr === 'string' && st.tr.startsWith(`${CODES[i]}:`) && (!note || st.tr.includes(note)), st.tr);
    const audit = await one(`SELECT details FROM audit_log WHERE action_type='DRIVER_AFFILIATION_REJECTED' AND target_id='${a}'`);
    check('  ...and written to the audit log with the actor and the reason', !!audit && audit.details.includes(CODES[i]), audit);
  }

  console.log('\nR2 anything else is refused, and the application stays where it was');
  const fresh = drivers[5];
  const aFresh = await aff(fresh);
  for (const bad of ['other', 'blurry', 'expired', 'Fraudulent Documents/Information', 'Hindi kwalipikado (Ineligible per City Ordinance or Regulation)', 'FRAUDULENT', '', null]) {
    const r = await rpc(ID.T_AUTH, 'reject_driver_affiliation', [aFresh, bad, 'x']);
    check(`refused: ${JSON.stringify(bad)}`, r.success === false && /ERR_INVALID_REJECTION_REASON/.test(r.error), r);
  }
  check('...the application is still Submitted after all those refusals', (await row(aFresh)).s === 'Submitted');

  console.log('\nR3 the LGU keeps its two old categories');
  const lg = await rpc(ID.L_AUTH, 'reject_driver_affiliation', [aFresh, 'ineligible', 'no franchise']);
  check('the LGU administrator rejects with the old category "ineligible"', lg.success === true && (await row(aFresh)).l === 'Rejected', lg);
  const aOld = await aff(drivers[6]);
  const lg2 = await rpc(ID.L_AUTH, 'reject_driver_affiliation', [aOld, 'fraudulent', null]);
  check('...and with "fraudulent"', lg2.success === true, lg2);

  console.log('\nR4 one application at a time');
  const aX1 = await aff(X, ID.TODA1), aX2 = await aff(X, ID.TODA2);
  const wrongToda = await rpc(ID.T2_AUTH, 'reject_driver_affiliation', [aX1, 'duplicate_identity', null]);
  check("another TODA's administrator cannot reject this TODA's application", wrongToda.success === false && /Access Denied/.test(wrongToda.error), wrongToda);
  const rx = await rpc(ID.T_AUTH, 'reject_driver_affiliation', [aX1, 'duplicate_identity', 'same person as an existing driver']);
  check("TODA1 rejects X's application", rx.success === true && (await row(aX1)).s === 'Rejected', rx);
  check("...X's application to TODA2 is untouched (still Submitted)", (await row(aX2)).s === 'Submitted');
  const dx = await one(`SELECT account_status s FROM driver WHERE driver_id='${X.ID}'`);
  check("...and X's account is not rejected (another application is alive)", dx.s !== 'Rejected', dx);

  console.log('\nR5 rejection is final');
  const again = await rpc(X.AUTH, 'apply_driver_toda_affiliations', [apps(ID.TODA1)]);
  check('the applicant cannot re-apply to the TODA that rejected them: nothing changes', again.success === true && again.results[0].outcome === 'unchanged' && (await row(aX1)).s === 'Rejected', again);
  const endorse = await rpc(ID.T_AUTH, 'endorse_driver_affiliation', [aX1, 'x']);
  check('the TODA cannot endorse it afterwards (it is no longer Submitted)', endorse.success === false, endorse);
  const back = await rpc(ID.T_AUTH, 'return_driver_documents', [aX1, JSON.stringify([{ document_type: 'license', reason_code: 'blurry', reason: 'x' }])]);
  check('...and cannot "return" a rejected application for correction either', back.success === false, back);

  console.log('\nR6 returning for correction is a different action and still works on a live application');
  const aLive = await aff(drivers[7]);
  const ret = await rpc(ID.T_AUTH, 'return_driver_documents', [aLive, JSON.stringify([{ document_type: 'license', reason_code: 'blurry', reason: 'the photo is too dark to read' }])]);
  check('return_driver_documents on a Submitted application succeeds', ret.success === true && (await row(aLive)).s === 'Resubmission Required', ret);

  console.log('\nR7 the function is still not open to anonymous callers');
  const anon = await attempt(() => asUser(t.db, { role: 'anon' }, (tx) => tx.query(`SELECT public.reject_driver_affiliation('${aLive}', 'ineligible', NULL)`)));
  check('anon is refused', !anon.ok && /permission denied/.test(anon.error), anon.ok ? 'allowed' : anon.error);

  await t.db.close();
  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
