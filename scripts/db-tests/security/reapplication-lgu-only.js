// Re-application after a rejection (20261010000004): LGU administrators only, with a reason that is written to the audit log.
// Whole migration chain, local emulator only (never Supabase).
//
//   BEFORE (chain through 20261010000003): the TODA administrator can undo its own rejection.
//   AFTER:  only the LGU can, with a reason of at least 10 characters; everything else is refused and nothing changes.
const { setup, ID, attempt, check, summary, asUser } = require('../b4fixtures');

const BEFORE = '20261010000003_permanent_rejection_reasons.sql';
const mk = (n) => ({ AUTH: `22000000-0000-0000-0000-0000000000${n}`, ID: `b2000000-0000-0000-0000-0000000000${n}` });
const apps = (...ids) => JSON.stringify(ids.map((toda_id) => ({ toda_id })));

async function world(until) {
  const t = await setup(until);
  const { db, internal, one } = t;
  const rpc = (uid, name, args = []) => asUser(db, { uid }, (tx) => {
    const ph = args.map((_, i) => `$${i + 1}`).join(',');
    return tx.query(`SELECT public.${name}(${ph}) AS r`, args);
  }, { commit: true }).then((r) => r.rows[0].r);
  const D = [mk('f1'), mk('f2'), mk('f3')];   // f1: rejected by TODA1; f2: rejected and permanently disqualified; f3: still Submitted
  await internal(`
    INSERT INTO auth.users(id,email) VALUES ${D.map((d, i) => `('${d.AUTH}','q${i}@x.com')`).join(',')};
    INSERT INTO public.driver(driver_id,auth_user_id,full_name,contact_number,account_status,availability_status,toda_id) VALUES
      ${D.map((d, i) => `('${d.ID}','${d.AUTH}','Driver Q${i}','+63919000020${i}','Pending Verification','Offline','${ID.TODA1}')`).join(',')};
    INSERT INTO public.driver_verification(driver_id, submitted_license_number, submitted_franchise_number) VALUES
      ${D.map((d, i) => `('${d.ID}','L-Q${i}','F-Q${i}')`).join(',')};`);
  for (const d of D) await rpc(d.AUTH, 'apply_driver_toda_affiliations', [apps(ID.TODA1)]);
  const aff = async (d) => (await one(`SELECT affiliation_id FROM driver_toda_affiliation WHERE driver_id='${d.ID}' AND toda_id='${ID.TODA1}'`)).affiliation_id;
  const A = [await aff(D[0]), await aff(D[1]), await aff(D[2])];
  const rj = (a) => rpc(ID.T_AUTH, 'reject_driver_affiliation', [a, 'duplicate_identity', 'same person as an existing driver']);
  await rj(A[0]); await rj(A[1]);
  await internal(`UPDATE driver SET is_permanently_disqualified = TRUE WHERE driver_id='${D[1].ID}'`);
  const row = (a) => one(`SELECT toda_endorsement_status s, lgu_verification_status l, toda_rejection_reason tr FROM driver_toda_affiliation WHERE affiliation_id='${a}'`);
  return { t, rpc, D, A, row };
}

(async () => {
  console.log('BEFORE the migration');
  const b = await world(BEFORE);
  const bTry = await b.rpc(ID.T_AUTH, 'allow_driver_reapplication', [b.A[0], 'the TODA changed its mind']);
  check('VULNERABLE: the TODA administrator reopened its own rejection', bTry.success === true && (await b.row(b.A[0])).s === 'Submitted', bTry);
  await b.t.db.close();

  console.log('\nAFTER the migration (full chain)');
  const w = await world(null);
  const { t, rpc, D, A, row } = w;
  const { one } = t;
  const GOOD = 'Rejected in error: the applicant is a different person; verified with the LTO record.';

  console.log('R1 nobody but the LGU can reopen a rejection');
  for (const [who, uid] of [['the TODA administrator that rejected it', ID.T_AUTH], ["another TODA's administrator", ID.T2_AUTH], ['the driver themselves', D[0].AUTH], ['an ordinary passenger', ID.P_AUTH]]) {
    const r = await attempt(() => rpc(uid, 'allow_driver_reapplication', [A[0], GOOD]));
    check(`${who}: refused`, r.ok ? (r.value.success === false && /Access Denied/.test(r.value.error)) : /permission denied|Access Denied/.test(r.error), r.ok ? r.value : r.error);
  }
  const anon = await attempt(() => asUser(t.db, { role: 'anon' }, (tx) => tx.query(`SELECT public.allow_driver_reapplication('${A[0]}', '${GOOD}')`)));
  check('an anonymous caller: refused', !anon.ok && /permission denied/.test(anon.error), anon.ok ? 'allowed' : anon.error);
  // the driver's own routes back: re-applying to the same TODA, and answering a "return" that does not exist for a rejected application
  const reapply = await rpc(D[0].AUTH, 'apply_driver_toda_affiliations', [apps(ID.TODA1)]);
  const resub = await attempt(() => rpc(D[0].AUTH, 'resubmit_driver_documents', [null]));
  check('the driver cannot re-apply to that TODA, nor "resubmit" a rejected application', reapply.success === true && reapply.results[0].outcome === 'unchanged' && (await row(A[0])).s === 'Rejected', { reapply, resub: resub.ok ? resub.value : resub.error });
  const still = await row(A[0]);
  check('...and the application is still Rejected after all of that', still.s === 'Rejected' && /^duplicate_identity/.test(still.tr), still);

  console.log('\nR2 the reason is required');
  for (const bad of [null, '', '   ', 'ok', 'too short']) {
    const r = await rpc(ID.L_AUTH, 'allow_driver_reapplication', [A[0], bad]);
    check(`LGU with reason ${JSON.stringify(bad)}: refused`, r.success === false && /ERR_REASON_REQUIRED/.test(r.error), r);
  }
  check('...nothing changed', (await row(A[0])).s === 'Rejected');

  console.log('\nR3 other refusals');
  const pd = await rpc(ID.L_AUTH, 'allow_driver_reapplication', [A[1], GOOD]);
  check('a permanently disqualified driver can never be cleared', pd.success === false && /permanently disqualified/i.test(pd.error), pd);
  const live = await rpc(ID.L_AUTH, 'allow_driver_reapplication', [A[2], GOOD]);
  check('an application that was not rejected cannot be "cleared"', live.success === false && /Only rejected/.test(live.error), live);
  const ghost = await rpc(ID.L_AUTH, 'allow_driver_reapplication', ['00000000-0000-0000-0000-00000000dead', GOOD]);
  check('an unknown application is refused', ghost.success === false, ghost);

  console.log('\nR4 the LGU can, with a reason, and it is written to the audit log');
  const ok = await rpc(ID.L_AUTH, 'allow_driver_reapplication', [A[0], `  ${GOOD}  `]);
  const st = await row(A[0]);
  check('the LGU administrator reopens it', ok.success === true && st.s === 'Submitted' && st.l === 'Pending' && st.tr === null, { ok, st });
  const audit = await one(`SELECT actor_role, actor_id, details, before_state FROM audit_log WHERE action_type='DRIVER_REAPPLICATION_ALLOWED' AND target_id='${A[0]}'`);
  check('audit_log: one entry, by an lgu_admin, with the actor id', !!audit && audit.actor_role === 'lgu_admin' && audit.actor_id === ID.L_AUTH, audit);
  check('...containing the reason (trimmed)', audit && audit.details.includes(GOOD) && !audit.details.includes(`  ${GOOD}`), audit && audit.details);
  check('...and what was cleared (the earlier rejection)', audit && /duplicate_identity/.test(audit.details) && /duplicate_identity/.test(JSON.stringify(audit.before_state)), audit && audit.details);
  const cnt = await one(`SELECT count(*)::int n FROM audit_log WHERE action_type='DRIVER_REAPPLICATION_ALLOWED'`);
  check('...and refused attempts wrote nothing', cnt.n === 1, cnt);

  console.log('\nR5 afterwards the normal workflow carries on');
  const endorse = await rpc(ID.T_AUTH, 'endorse_driver_affiliation', [A[0], 'x']);
  check('the TODA can review (endorse) the reopened application', endorse.success === true, endorse);
  const again = await rpc(ID.L_AUTH, 'allow_driver_reapplication', [A[0], GOOD]);
  check('...and it cannot be "reopened" again while it is not rejected', again.success === false, again);

  await t.db.close();
  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
