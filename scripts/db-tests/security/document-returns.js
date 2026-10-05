// Return for correction, per document (20261010000001): which documents, why, for which affiliation; resubmission; what each side sees.
// Whole migration chain, local emulator only (never Supabase).
const { setup, ID, attempt, check, summary, asUser } = require('../b4fixtures');
// the SAME function the Driver app uses to decide what its status screen says
const { classifyApplication } = require('../../../packages/shared/src/utils/applicationReview.ts');

const X = { AUTH: '22000000-0000-0000-0000-0000000000b1', ID: 'b2000000-0000-0000-0000-0000000000b1' };   // registers under TODA1 + TODA2
const Y = { AUTH: '22000000-0000-0000-0000-0000000000b2', ID: 'b2000000-0000-0000-0000-0000000000b2' };   // TODA1 only (separate returns)
const err = (r) => (r.ok ? null : String(r.error).slice(0, 170));
const doc = (document_type, reason_code, reason) => ({ document_type, reason_code, reason });

(async () => {
  const t = await setup(null);
  const { db, internal, as, svc, q, one } = t;
  const rpc = (uid, name, args = []) => asUser(db, { uid }, (tx) => {
    const ph = args.map((_, i) => `$${i + 1}`).join(',');
    return tx.query(`SELECT public.${name}(${ph}) AS r`, args);
  }, { commit: true }).then((r) => r.rows[0].r);
  const rows = (uid, sql, args = []) => asUser(db, { uid }, (tx) => tx.query(sql, args)).then((r) => r.rows);
  const T1 = ID.T_AUTH, T2 = ID.T2_AUTH, LGU = ID.L_AUTH;
  const apps = (...ids) => JSON.stringify(ids.map((toda_id) => ({ toda_id })));

  // ---- world: X applied to both TODAs, Y to TODA1 only; both have a verification record with data
  await internal(`
    INSERT INTO auth.users(id,email) VALUES ('${X.AUTH}','x@x.com'),('${Y.AUTH}','y@x.com');
    INSERT INTO public.driver(driver_id,auth_user_id,full_name,contact_number,account_status,availability_status,toda_id) VALUES
      ('${X.ID}','${X.AUTH}','Driver X','+639190000011','Pending Verification','Offline','${ID.TODA1}'),
      ('${Y.ID}','${Y.AUTH}','Driver Y','+639190000012','Pending Verification','Offline','${ID.TODA1}');
    INSERT INTO public.driver_verification(driver_id, submitted_license_number, submitted_franchise_number) VALUES
      ('${X.ID}','L-1','F-1'),('${Y.ID}','L-2','F-2');`);
  await rpc(X.AUTH, 'apply_driver_toda_affiliations', [apps(ID.TODA1, ID.TODA2)]);
  await rpc(Y.AUTH, 'apply_driver_toda_affiliations', [apps(ID.TODA1)]);
  const aff = async (driver, toda) => (await one(`SELECT affiliation_id FROM driver_toda_affiliation WHERE driver_id='${driver}' AND toda_id='${toda}'`)).affiliation_id;
  const aX1 = await aff(X.ID, ID.TODA1), aX2 = await aff(X.ID, ID.TODA2), aY1 = await aff(Y.ID, ID.TODA1);
  const stage = async (a) => one(`SELECT toda_endorsement_status e, lgu_verification_status l, resubmitted_at, toda_return_notes tn, lgu_return_notes ln FROM driver_toda_affiliation WHERE affiliation_id='${a}'`);
  const review = async (uid, ids) => (await rows(uid, `SELECT * FROM public.get_affiliation_document_reviews($1::uuid[])`, [ids])).reduce((m, r) => ({ ...m, [`${r.affiliation_id}:${r.document_type}`]: r }), {});

  console.log('R0 (control) the old client writes are refused: this is why the status never changed');
  await internal(`UPDATE driver_verification SET verification_status='Resubmission Required' WHERE driver_id='${Y.ID}'; UPDATE driver SET account_status='Resubmission Required' WHERE driver_id='${Y.ID}'`);
  const old1 = await attempt(() => as(Y.AUTH, (tx) => tx.query(`UPDATE driver_verification SET verification_status='Pending', rejection_reason=NULL, rejection_comment=NULL, rejected_at=NULL WHERE driver_id='${Y.ID}'`)));
  const old2 = await attempt(() => as(Y.AUTH, (tx) => tx.query(`UPDATE driver SET account_status='Pending Verification', rejection_reason=NULL WHERE driver_id='${Y.ID}'`)));
  check('a driver cannot write verification_status / rejection_* on their verification record', !old1.ok && /Drivers cannot modify verification status/.test(old1.error), err(old1));
  check('a driver cannot write account_status on their own driver record', !old2.ok && /Only LGU Administrators can modify driver account_status/.test(old2.error), err(old2));
  await internal(`UPDATE driver_verification SET verification_status='Pending' WHERE driver_id='${Y.ID}'; UPDATE driver SET account_status='Pending Verification' WHERE driver_id='${Y.ID}'`);

  console.log('\nR1 the TODA returns ONE document (license) with a reason');
  const bad = [
    ['no documents', []], ['an unknown document', [doc('passport', 'blurry', 'x')]], ['the same document twice', [doc('license', 'blurry', 'a'), doc('license', 'expired', 'b')]],
    ['a missing free-text reason', [doc('license', 'blurry', '   ')]], ['an unknown preset reason', [doc('license', 'smudged', 'x')]],
  ];
  for (const [name, docs] of bad) {
    const r = await rpc(T1, 'return_driver_documents', [aX1, JSON.stringify(docs)]);
    check(`refused: ${name}`, r.success === false && /ERR_/.test(r.error), r);
  }
  check('nothing changed after the refusals', (await stage(aX1)).e === 'Submitted' && (await q(`SELECT 1 FROM document_review_history WHERE driver_id='${X.ID}'`)).length === 0);
  const t2try = await rpc(T2, 'return_driver_documents', [aX1, JSON.stringify([doc('license', 'blurry', 'x')])]);
  const drvTry = await rpc(X.AUTH, 'return_driver_documents', [aX1, JSON.stringify([doc('license', 'blurry', 'x')])]);
  const lguEarly = await rpc(LGU, 'return_driver_documents', [aX1, JSON.stringify([doc('license', 'blurry', 'x')])]);
  const anon = await attempt(() => asUser(db, { uid: null, role: 'anon' }, (tx) => tx.query(`SELECT public.return_driver_documents('${aX1}', '[]'::jsonb)`), { commit: true }));
  check('another TODA\'s administrator cannot return it', t2try.success === false && /Access Denied/.test(t2try.error), t2try);
  check('the driver cannot return their own application', drvTry.success === false && /Access Denied/.test(drvTry.error), drvTry);
  check('the LGU cannot return it before the TODA endorsed it (sequential review)', lguEarly.success === false && /Sequential violation/.test(lguEarly.error), lguEarly);
  check('anon cannot call it', !anon.ok && /permission denied/.test(anon.error), err(anon));
  const oldRet = await rpc(T1, 'return_driver_affiliation', [aX1, 'Blurry licence', null]);
  check('the old return_driver_affiliation (no document named) is refused with an explanation', oldRet.success === false && /ERR_DOCUMENTS_REQUIRED/.test(oldRet.error), oldRet);

  const r1 = await rpc(T1, 'return_driver_documents', [aX1, JSON.stringify([doc('license', 'blurry', '  Front photo is blurry,\nplease retake in daylight  ')])]);
  check('TODA1 returns the LICENSE only', r1.success === true && r1.stage === 'TODA' && JSON.stringify(r1.documents) === '["license"]', r1);
  let s1 = await stage(aX1), s2 = await stage(aX2);
  check('that affiliation is "Resubmission Required"; the other TODA\'s affiliation of the same driver is untouched',
    s1.e === 'Resubmission Required' && /License/i.test(s1.tn) && s2.e === 'Submitted' && s2.l === 'Pending' && s2.resubmitted_at === null, { s1, s2 });
  const dd = await q(`SELECT document_type, document_status FROM driver_document WHERE driver_id='${X.ID}' ORDER BY document_type`);
  check('driver_document: only the license is "Resubmission Required" (no row for the others)', dd.length === 1 && dd[0].document_type === 'license' && dd[0].document_status === 'Resubmission Required', dd);
  const h1 = await q(`SELECT * FROM document_review_history WHERE driver_id='${X.ID}'`);
  check('history: one "Returned" row with the affiliation, the actor, the preset code and the cleaned free text',
    h1.length === 1 && h1[0].event_type === 'Returned' && h1[0].affiliation_id === aX1 && h1[0].actor_role === 'toda_admin' && h1[0].review_stage === 'TODA'
    && h1[0].reason_code === 'blurry' && h1[0].reason === 'Front photo is blurry, please retake in daylight', h1[0]);
  const vr = await one(`SELECT verification_status, rejection_comment FROM driver_verification WHERE driver_id='${X.ID}'`);
  const cj = JSON.parse(vr.rejection_comment);
  check('the shared record (older screens) lists exactly the returned document', vr.verification_status === 'Resubmission Required' && JSON.stringify(cj.faultyDocuments) === '["license"]' && cj.issues.length === 1 && cj.issues[0].documentType === 'license', cj);
  const au = await q(`SELECT action_type, toda_admin_id, details FROM audit_log WHERE action_type='DRIVER_DOCUMENTS_RETURNED' AND target_id='${aX1}'`);
  check('audit_log: a DRIVER_DOCUMENTS_RETURNED entry tagged for that TODA\'s administrator, naming the document and the reason', au.length === 1 && au[0].toda_admin_id && /License/.test(au[0].details) && /blurry/i.test(au[0].details), au);
  const nd = await q(`SELECT title, notification_type, recipient_id FROM notification WHERE driver_id='${X.ID}' AND notification_type='DOCUMENT_RETURNED'`);
  check('the driver gets an in-app notification', nd.length === 1 && nd[0].recipient_id === X.ID, nd);
  const again = await rpc(T1, 'return_driver_documents', [aX1, JSON.stringify([doc('mtop', 'expired', 'x')])]);
  check('an application that is already returned cannot be returned again', again.success === false && /not waiting for TODA review/.test(again.error), again);

  console.log('\nR2 what each side can see');
  const drv = await rpc(X.AUTH, 'get_my_application_review');
  const dA1 = drv.affiliations.find((a) => a.affiliation_id === aX1), dA2 = drv.affiliations.find((a) => a.affiliation_id === aX2);
  const dDoc = (a, type) => a.documents.find((d) => d.document_type === type);
  check('the driver\'s screen data: TODA1 returned the license with its reason; the other documents are not returned',
    dA1.toda_stage === 'Resubmission Required' && dDoc(dA1, 'license').state === 'returned' && dDoc(dA1, 'license').reason_code === 'blurry'
    && /blurry/.test(dDoc(dA1, 'license').reason) && dDoc(dA1, 'mtop').state === 'not_returned' && dDoc(dA1, 'tricycle').state === 'not_returned', dA1);
  check('...and for TODA2 the same shared license shows as returned ELSEWHERE, without the other TODA\'s reason',
    dA2.toda_stage === 'Submitted' && dDoc(dA2, 'license').state === 'returned_elsewhere' && dDoc(dA2, 'license').reason === null, dA2);
  check('the shared document list shows the license as Resubmission Required', drv.documents.length === 1 && drv.documents[0].document_status === 'Resubmission Required');
  const rv1 = await review(T1, [aX1, aX2]), rv2 = await review(T2, [aX1, aX2]);
  check('TODA1\'s administrator sees its own return with the reason, and nothing of TODA2\'s affiliation',
    rv1[`${aX1}:license`].state === 'returned' && /blurry/.test(rv1[`${aX1}:license`].reason) && !Object.keys(rv1).some((k) => k.startsWith(aX2)), rv1);
  check('TODA2\'s administrator sees "returned elsewhere" with NO reason, and nothing of TODA1\'s affiliation',
    rv2[`${aX2}:license`].state === 'returned_elsewhere' && rv2[`${aX2}:license`].reason === null && !Object.keys(rv2).some((k) => k.startsWith(aX1)), rv2);
  const hc = async (uid) => (await rows(uid, `SELECT count(*)::int n FROM document_review_history WHERE driver_id='${X.ID}'`))[0].n;
  check('row security: the return row is visible to its TODA, the driver and the LGU, not to the other TODA', (await hc(T1)) === 1 && (await hc(X.AUTH)) === 1 && (await hc(LGU)) === 1 && (await hc(T2)) === 0);
  const ddc = async (uid) => (await rows(uid, `SELECT count(*)::int n FROM driver_document WHERE driver_id='${X.ID}'`))[0].n;
  check('the shared document STATE is visible to both TODAs and the driver, but not to a TODA the driver never applied to', (await ddc(T1)) === 1 && (await ddc(T2)) === 1 && (await ddc(X.AUTH)) === 1
    && (await rows(T2, `SELECT count(*)::int n FROM driver_document WHERE driver_id='${ID.D1}'`))[0].n === 0);
  const w1 = await attempt(() => as(X.AUTH, (tx) => tx.query(`INSERT INTO document_review_history(driver_id, document_type, event_type, reason_code, reason) VALUES ('${X.ID}','mtop','Returned','other','forged')`)));
  const w2 = await attempt(() => as(X.AUTH, (tx) => tx.query(`UPDATE driver_document SET document_status='Submitted' WHERE driver_id='${X.ID}'`)));
  const w3 = await attempt(() => as(T1, (tx) => tx.query(`DELETE FROM document_review_history WHERE driver_id='${X.ID}'`)));
  check('nobody can write the tables directly: a driver cannot forge a return or clear a flag, a TODA cannot erase the history',
    !w1.ok && !w2.ok && !w3.ok && /permission denied/.test(err(w1) + err(w2) + err(w3)), [err(w1), err(w2), err(w3)]);
  const upd = await attempt(() => svc((tx) => tx.query(`UPDATE document_review_history SET reason='edited' WHERE driver_id='${X.ID}'`)));
  check('the history is append-only even for the service role', !upd.ok && /append-only/.test(err(upd)), err(upd));

  console.log('\nR3 TODA2 is not blocked or altered by TODA1\'s return');
  const e2 = await rpc(T2, 'endorse_driver_affiliation', [aX2]);
  s1 = await stage(aX1); s2 = await stage(aX2);
  check('TODA2 endorses its own affiliation while TODA1\'s return is still open', e2.success === true && s2.e === 'Endorsed' && s1.e === 'Resubmission Required', { s1, s2 });
  check('TODA2\'s clock was never restarted by TODA1\'s return', s2.resubmitted_at === null);

  console.log('\nR4 the driver resubmits: only the returned document, only that affiliation moves, the clock restarts');
  // make the first cycle old: the reminder and overdue state are what must start over
  await internal(`UPDATE driver_toda_affiliation SET submitted_at = now() - interval '9 days' WHERE affiliation_id='${aX1}'`);
  await internal(`INSERT INTO notification(recipient_id, subject_id, driver_id, title, message, notification_type, threshold_days)
                  VALUES ('toda_${ID.TODA1}','${aX1}','${X.ID}','SLA Reminder','old','SLA_REMINDER_STAGE1',3)`);
  await internal(`INSERT INTO admin_review_flag(flag_type, subject_type, subject_id, source_rule, assigned_role) VALUES ('APPLICATION_OVERDUE','driver_application','${aX1}','Rule 3.7','lgu_admin')`);
  // a driver can still update the DATA columns of the verification record (the new license number), just not the decision columns
  const dataUp = await attempt(() => as(X.AUTH, (tx) => tx.query(`UPDATE driver_verification SET submitted_license_number='L-1-NEW', remarks='Resubmitted by driver applicant' WHERE driver_id='${X.ID}'`)));
  check('the driver can update the data of the returned document (not the decision columns)', dataUp.ok && dataUp.value.rowCount === 1, err(dataUp));
  const none = await rpc(Y.AUTH, 'resubmit_driver_documents', [null]);
  check('a driver with nothing returned has nothing to resubmit', none.success === false && /Nothing to resubmit/.test(none.error), none);
  const sub = await rpc(X.AUTH, 'resubmit_driver_documents', [null]);
  s1 = await stage(aX1); s2 = await stage(aX2);
  check('resubmission: license resubmitted, ONLY the TODA1 affiliation goes back to TODA review', sub.success === true && JSON.stringify(sub.resubmitted) === '["license"]'
    && sub.back_in_review.length === 1 && sub.back_in_review[0].affiliation_id === aX1 && sub.back_in_review[0].stage === 'TODA' && sub.still_returned.length === 0, sub);
  check('TODA1: Submitted again with the return text cleared and resubmitted_at = now (the 5-calendar-day clock restarts)',
    s1.e === 'Submitted' && s1.l === 'Pending' && s1.tn === null && s1.resubmitted_at && (Date.now() - new Date(s1.resubmitted_at).getTime()) < 60_000, s1);
  check('TODA2 stays Endorsed and untouched', s2.e === 'Endorsed' && s2.resubmitted_at === null, s2);
  const dd2 = await one(`SELECT document_status, resubmission_count, resubmitted_at FROM driver_document WHERE driver_id='${X.ID}' AND document_type='license'`);
  const hh = await q(`SELECT event_type, affiliation_id FROM document_review_history WHERE driver_id='${X.ID}' ORDER BY event_seq`);
  check('driver_document: Resubmitted (count 1); history: Returned then Resubmitted', dd2.document_status === 'Resubmitted' && dd2.resubmission_count === 1
    && hh.length === 2 && hh[0].event_type === 'Returned' && hh[1].event_type === 'Resubmitted' && hh[1].affiliation_id === null, { dd2, hh });
  const vr2 = await one(`SELECT d.account_status, v.verification_status, v.rejection_reason, v.rejection_comment FROM driver d JOIN driver_verification v USING (driver_id) WHERE d.driver_id='${X.ID}'`);
  check('the shared record: no longer "Resubmission Required"; TODA2 had endorsed, so it reads Approved; the return text is cleared',
    vr2.verification_status === 'Approved' && vr2.rejection_comment === null && vr2.rejection_reason === null && vr2.account_status === 'Pending Verification', vr2);
  const fl = await one(`SELECT count(*)::int n FROM admin_review_flag WHERE subject_id='${aX1}' AND flag_type='APPLICATION_OVERDUE' AND status IN ('Open','Under Review')`);
  const rm = await one(`SELECT count(*)::int n FROM notification WHERE subject_id='${aX1}' AND notification_type IN ('SLA_REMINDER_STAGE1','SLA_REMINDER_STAGE2')`);
  check('the overdue flag is closed and the previous cycle\'s reminder rows are gone (the reminder can fire again)', fl.n === 0 && rm.n === 0, { fl, rm });
  const nt = await q(`SELECT title, recipient_id FROM notification WHERE notification_type='DRIVER_RESUBMITTED' AND subject_id='${aX1}'`);
  const ntSee = async (uid) => (await rows(uid, `SELECT count(*)::int n FROM notification WHERE notification_type='DRIVER_RESUBMITTED'`))[0].n;
  check('the TODA1 administrator is notified (recipient toda_<id>); TODA2\'s administrator is not', nt.length === 1 && nt[0].recipient_id === `toda_${ID.TODA1}` && (await ntSee(T1)) === 1 && (await ntSee(T2)) === 0, nt);
  const ra = await q(`SELECT toda_admin_id, details FROM audit_log WHERE action_type='DRIVER_APPLICATION_RESUBMITTED' AND target_id='${aX1}'`);
  const auSee = async (uid) => (await rows(uid, `SELECT count(*)::int n FROM audit_log WHERE target_id='${aX1}' AND action_type IN ('DRIVER_DOCUMENTS_RETURNED','DRIVER_APPLICATION_RESUBMITTED')`))[0].n;
  check('audit_log: the resubmission is recorded; TODA1 sees both the return and the resubmission, TODA2 sees neither', ra.length === 1 && /Driver's License/.test(ra[0].details) && (await auSee(T1)) === 2 && (await auSee(T2)) === 0, ra);
  const rvr = await review(T1, [aX1]), rvr2 = await review(T2, [aX2]);
  check('TODA1 sees the license as "resubmitted" with the PREVIOUS reason and both dates',
    rvr[`${aX1}:license`].state === 'resubmitted' && /blurry/.test(rvr[`${aX1}:license`].reason) && rvr[`${aX1}:license`].returned_at && rvr[`${aX1}:license`].resubmitted_at, rvr);
  check('TODA2 sees only that the shared license was replaced after its application (no reason)', rvr2[`${aX2}:license`].state === 'replaced_elsewhere' && rvr2[`${aX2}:license`].reason === null, rvr2);
  const drv2 = await rpc(X.AUTH, 'get_my_application_review');
  const d2A1 = drv2.affiliations.find((a) => a.affiliation_id === aX1);
  check('the driver\'s screen data: TODA1 is back in TODA review, resubmitted_at set, license "resubmitted", mtop / tricycle "not_returned"',
    d2A1.toda_stage === 'Submitted' && d2A1.resubmitted_at && dDoc(d2A1, 'license').state === 'resubmitted' && dDoc(d2A1, 'mtop').state === 'not_returned'
    && dDoc(d2A1, 'tricycle').state === 'not_returned', d2A1);

  console.log('\nR5 the 5-day clock and the 3-day reminder really start over (the scheduled job, on the same data)');
  const sla = () => svc((tx) => tx.query(`SELECT public.run_scheduled_sla_and_expiry_cascade() r`));
  const slaState = async () => ({
    overdue: (await one(`SELECT count(*)::int n FROM admin_review_flag WHERE subject_id='${aX1}' AND flag_type='APPLICATION_OVERDUE' AND status IN ('Open','Under Review')`)).n,
    reminders: (await one(`SELECT count(*)::int n FROM notification WHERE subject_id='${aX1}' AND notification_type='SLA_REMINDER_STAGE1'`)).n,
  });
  await sla();
  check('right after the resubmission: no reminder, no overdue flag (old submitted_at was 9 days ago, but the clock restarted)', JSON.stringify(await slaState()) === '{"overdue":0,"reminders":0}', await slaState());
  await internal(`UPDATE driver_toda_affiliation SET resubmitted_at = now() - interval '3 days' WHERE affiliation_id='${aX1}'`);
  await sla();
  check('3 calendar days after the resubmission the reminder fires AGAIN (it would have been swallowed by the old row)', JSON.stringify(await slaState()) === '{"overdue":0,"reminders":1}', await slaState());
  await internal(`UPDATE driver_toda_affiliation SET resubmitted_at = now() - interval '6 days' WHERE affiliation_id='${aX1}'`);
  await sla();
  check('6 days after it, the overdue flag is raised again (more than 5 calendar days)', (await slaState()).overdue === 1, await slaState());
  await internal(`UPDATE driver_toda_affiliation SET resubmitted_at = now() WHERE affiliation_id='${aX1}'`);

  console.log('\nR6 separate returns: MTOP only, tricycle only, and two documents at once');
  const cycle = async (label, docs, A = aY1, AUTH = Y.AUTH, DID = Y.ID) => {
    const r = await rpc(T1, 'return_driver_documents', [A, JSON.stringify(docs)]);
    const types = docs.map((d) => d.document_type);
    const view = (await rpc(AUTH, 'get_my_application_review')).affiliations.find((a) => a.affiliation_id === A);
    const returned = view.documents.filter((d) => d.state === 'returned').map((d) => d.document_type);
    const notReturned = view.documents.filter((d) => d.state === 'not_returned').map((d) => d.document_type);
    const cmt = JSON.parse((await one(`SELECT rejection_comment c FROM driver_verification WHERE driver_id='${DID}'`)).c);
    check(`${label}: returned = ${types.join(' + ')}; the driver is asked for exactly those`, r.success === true && JSON.stringify(returned) === JSON.stringify(types.slice().sort((a, b) => ['license', 'mtop', 'tricycle', 'selfie'].indexOf(a) - ['license', 'mtop', 'tricycle', 'selfie'].indexOf(b)))
      && notReturned.length === 4 - types.length && JSON.stringify(cmt.faultyDocuments) === JSON.stringify(returned) && view.toda_stage === 'Resubmission Required', { r, returned, cmt });
    check(`${label}: each document keeps ITS OWN reason`, docs.every((d) => (view.documents.find((x) => x.document_type === d.document_type) || {}).reason === d.reason), view.documents);
    return view;
  };
  await cycle('MTOP only', [doc('mtop', 'expired', 'The franchise expired on 2026-09-30')]);
  let p = await rpc(Y.AUTH, 'resubmit_driver_documents', [['mtop']]);
  check('MTOP resubmitted -> back to TODA review', p.success === true && p.back_in_review.length === 1 && (await stage(aY1)).e === 'Submitted', p);
  await cycle('Tricycle only', [doc('tricycle', 'wrong_document', 'This is a photo of a motorcycle, not the tricycle')]);
  p = await rpc(Y.AUTH, 'resubmit_driver_documents', [['tricycle']]);
  check('tricycle resubmitted -> back to TODA review', p.success === true && p.back_in_review.length === 1 && (await stage(aY1)).e === 'Submitted', p);
  await cycle('Two at once', [doc('license', 'mismatch', 'Name differs from the franchise'), doc('tricycle', 'incomplete', 'Plate number is cut off')]);
  const vOnly = (await rpc(Y.AUTH, 'get_my_application_review')).affiliations[0];
  check('only the latest return is shown: the earlier, finished MTOP and tricycle returns do not reappear beside it',
    vOnly.documents.filter((d) => d.state === 'returned').length === 2 && vOnly.documents.find((d) => d.document_type === 'mtop').state === 'not_returned', vOnly.documents.map((d) => d.document_type + ':' + d.state));
  p = await rpc(Y.AUTH, 'resubmit_driver_documents', [['license']]);
  s1 = await stage(aY1);
  const open1 = JSON.parse((await one(`SELECT rejection_comment c FROM driver_verification WHERE driver_id='${Y.ID}'`)).c);
  check('resubmitting only ONE of the two: the application stays returned and still asks for the other', p.success === true && p.back_in_review.length === 0 && p.still_returned.length === 1
    && s1.e === 'Resubmission Required' && JSON.stringify(open1.faultyDocuments) === '["tricycle"]', { p, s1, open1 });
  p = await rpc(Y.AUTH, 'resubmit_driver_documents', [['tricycle']]);
  const vY = (await rpc(Y.AUTH, 'get_my_application_review')).affiliations[0];
  check('...and goes back to review once the second one is replaced; both show as resubmitted', p.success === true && p.back_in_review.length === 1 && (await stage(aY1)).e === 'Submitted'
    && vY.documents.filter((d) => d.state === 'resubmitted').map((d) => d.document_type).join() === 'license,tricycle', vY.documents.map((d) => d.document_type + ':' + d.state));

  console.log('\nR7 two TODAs return DIFFERENT documents: each affiliation waits for its own');
  // X: TODA1 is Submitted again (R4); TODA2 is Endorsed (R3), so the LGU stage is TODA2's; use TODA1 for the TODA stage and the LGU for TODA2
  const rA = await rpc(T1, 'return_driver_documents', [aX1, JSON.stringify([doc('license', 'expired', 'The licence expired last month')])]);
  const rB = await rpc(LGU, 'return_driver_documents', [aX2, JSON.stringify([doc('mtop', 'blurry', 'Cannot read the franchise number')]), null, ['license']]);
  const sB = await stage(aX2);
  check('TODA1 returns the license (TODA stage) and the LGU returns the MTOP of TODA2 (LGU stage)', rA.success === true && rB.success === true && rB.stage === 'LGU'
    && sB.e === 'Endorsed' && sB.l === 'Resubmission Required', { rA, rB, sB });
  const cmt = JSON.parse((await one(`SELECT rejection_comment c FROM driver_verification WHERE driver_id='${X.ID}'`)).c);
  check('the shared record lists the UNION of both returns (a second return never hides the first)', JSON.stringify(cmt.faultyDocuments) === '["license","mtop"]' && cmt.issues.length === 2 && JSON.stringify(cmt.verifiedDocuments) === '["license"]', cmt);
  check('an LGU return puts the driver account into Resubmission Required (the LGU screen reads it)', (await one(`SELECT account_status a FROM driver WHERE driver_id='${X.ID}'`)).a === 'Resubmission Required');
  const screenX = async () => classifyApplication((await rpc(X.AUTH, 'get_my_application_review')).affiliations);
  let cx = await screenX();
  check('the status screen: while any application waits for the driver the headline is "resubmission required" with BOTH documents, each with its own TODA / LGU',
    cx.kind === 'resubmission_required' && JSON.stringify(cx.documentsToResubmit) === '["license","mtop"]'
    && cx.returnedDocuments.find((r) => r.document_type === 'license').stage === 'TODA' && cx.returnedDocuments.find((r) => r.document_type === 'mtop').stage === 'LGU', cx);
  const mid = await rpc(X.AUTH, 'resubmit_driver_documents', [['mtop']]);
  check('resubmitting the MTOP sends TODA2 back to the LGU and leaves TODA1 waiting for the license',
    mid.success === true && mid.back_in_review.length === 1 && mid.back_in_review[0].toda_id === ID.TODA2 && mid.back_in_review[0].stage === 'LGU'
    && (await stage(aX1)).e === 'Resubmission Required' && (await stage(aX2)).l === 'Pending' && (await stage(aX2)).e === 'Endorsed', mid);
  cx = await screenX();
  check('the status screen after replacing only the MTOP: it still asks for the license (TODA1 waits), and only for the license',
    cx.kind === 'resubmission_required' && JSON.stringify(cx.documentsToResubmit) === '["license"]' && cx.returnedDocuments[0].toda_acronym === 'Toda One', cx);
  check('the LGU is notified of its own resubmission (recipient lgu_admin)', (await q(`SELECT 1 FROM notification WHERE notification_type='DRIVER_RESUBMITTED' AND subject_id='${aX2}' AND recipient_id='lgu_admin'`)).length === 1);
  check('the driver account stays Resubmission Required while TODA1 still waits', (await one(`SELECT account_status a FROM driver WHERE driver_id='${X.ID}'`)).a === 'Resubmission Required');
  const fin = await rpc(X.AUTH, 'resubmit_driver_application', [aX1]);
  check('the old resubmit_driver_application(affiliation) still works: it resubmits what THAT affiliation asked for', fin.success === true && fin.back_in_review.length === 1 && (await stage(aX1)).e === 'Submitted', fin);
  check('...and now nothing is outstanding: the driver account is Pending Verification again', (await one(`SELECT account_status a FROM driver WHERE driver_id='${X.ID}'`)).a === 'Pending Verification');

  cx = await screenX();
  check('the status screen: TODA1 is back in TODA review (resubmitted, awaiting TODA) and that wins over the LGU resubmission',
    cx.kind === 'resubmitted_awaiting_toda' && cx.affiliationIds[0] === aX1 && cx.documentStates.license === 'resubmitted', cx);
  await rpc(T1, 'endorse_driver_affiliation', [aX1]);
  cx = await screenX();
  check('once TODA1 endorses, only the LGU-stage resubmission is left: "resubmitted, awaiting LGU" for TODA2 alone (TODA1 older resubmitted_at does not count)',
    cx.kind === 'resubmitted_awaiting_lgu' && JSON.stringify(cx.affiliationIds) === JSON.stringify([aX2]) && cx.documentStates.mtop === 'resubmitted', cx);

  console.log('\nR8 an application returned before this migration (no history rows) can still be resubmitted');
  await internal(`UPDATE driver_toda_affiliation SET toda_endorsement_status='Resubmission Required', toda_rejection_reason='Pekeng dokumento' WHERE affiliation_id='${aX1}'`);
  const legacyView = await screenX();
  check('the status screen for such a return: the licence is asked for (as before) with the reviewer own words, flagged as legacy',
    legacyView.kind === 'resubmission_required' && JSON.stringify(legacyView.documentsToResubmit) === '["license"]'
    && legacyView.returnedDocuments[0].legacy === true && legacyView.returnedDocuments[0].reason === 'Pekeng dokumento', legacyView);
  const legacy = await rpc(X.AUTH, 'resubmit_driver_documents', [['license']]);
  check('it goes back to review when the driver answers (so nothing stays stuck)', legacy.success === true && legacy.back_in_review.length === 1 && (await stage(aX1)).e === 'Submitted', legacy);

  console.log('\nR9 deleting an affiliation or a driver keeps the history consistent');
  await internal(`DELETE FROM driver_toda_affiliation WHERE affiliation_id='${aY1}'`);
  const orphan = await q(`SELECT affiliation_id FROM document_review_history WHERE driver_id='${Y.ID}' AND event_type='Returned'`);
  check('deleting an affiliation keeps its history rows (the link becomes NULL)', orphan.length === 4 && orphan.every((r) => r.affiliation_id === null), orphan);
  const delDrv = await attempt(() => internal(`DELETE FROM driver WHERE driver_id='${Y.ID}'`));
  check('deleting the driver removes the document rows and the history', delDrv.ok && (await q(`SELECT 1 FROM document_review_history WHERE driver_id='${Y.ID}'`)).length === 0
    && (await q(`SELECT 1 FROM driver_document WHERE driver_id='${Y.ID}'`)).length === 0, err(delDrv));

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
