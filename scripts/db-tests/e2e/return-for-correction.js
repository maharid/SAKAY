// END-TO-END SCENARIO: register -> the TODA returns specific documents with reasons -> the driver sees the reason and is asked for ONLY those
// -> the driver resubmits -> the status says "Resubmitted, awaiting TODA review" (never "passed") -> the TODA sees the Resubmitted state,
// the previous reason and the restarted clock -> the TODA endorses -> the LGU approves.
// Run once for: licence only, MTOP only, tricycle photo only, and two documents at once. Local emulator only (never Supabase).
// The screen wording comes from classifyApplication() in packages/shared: the SAME function the Driver app uses.
const { setup, ID, attempt, check, summary, asUser } = require('../b4fixtures');
const { classifyApplication } = require('../../../packages/shared/src/utils/applicationReview.ts');

const doc = (document_type, reason_code, reason) => ({ document_type, reason_code, reason });
const CASES = [
  { name: 'LICENSE only', docs: [doc('license', 'blurry', 'The licence photo is blurry, the number cannot be read')] },
  { name: 'MTOP only', docs: [doc('mtop', 'expired', 'The MTOP expired on 30 September 2026')] },
  { name: 'TRICYCLE PHOTO only', docs: [doc('tricycle', 'wrong_document', 'This is a photo of another vehicle')] },
  { name: 'TWO documents at once (license + tricycle)', docs: [doc('license', 'mismatch', 'Name differs from the MTOP'), doc('tricycle', 'incomplete', 'The plate number is cut off')] },
];

(async () => {
  const t = await setup(null);
  const { db, internal, q, one } = t;
  const rpc = (uid, name, args = []) => asUser(db, { uid }, (tx) => {
    const ph = args.map((_, i) => `$${i + 1}`).join(',');
    return tx.query(`SELECT public.${name}(${ph}) AS r`, args);
  }, { commit: true }).then((r) => r.rows[0].r);
  const rows = (uid, sql, args = []) => asUser(db, { uid }, (tx) => tx.query(sql, args)).then((r) => r.rows);
  const TODA_ADMIN = ID.T_AUTH, LGU = ID.L_AUTH;
  const screen = async (auth) => classifyApplication((await rpc(auth, 'get_my_application_review')).affiliations);
  const ORDER = ['license', 'mtop', 'tricycle', 'selfie'];

  let n = 0;
  for (const c of CASES) {
    n++;
    const AUTH = `23000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`, DID = `b3000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
    const types = c.docs.map((d) => d.document_type).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    console.log(`\n=== ${c.name} ===`);

    // 1. register: the login, the driver, the documents' data, one application to TODA1
    await internal(`
      INSERT INTO auth.users(id,email) VALUES ('${AUTH}','e2e${n}@x.com');
      INSERT INTO public.driver(driver_id,auth_user_id,full_name,contact_number,account_status,availability_status,toda_id)
        VALUES ('${DID}','${AUTH}','E2E Driver ${n}','+63919000010${n}','Pending Verification','Offline','${ID.TODA1}');
      INSERT INTO public.driver_verification(driver_id, submitted_license_number, submitted_franchise_number, submitted_plate_number)
        VALUES ('${DID}','LIC-${n}','FRN-${n}','PLATE-${n}');
      -- a normal applicant: on the TODA's master roster (entry made before the application), so approval needs no roster override
      INSERT INTO public.toda_roster_entry(toda_id, member_name, franchise_number, created_at)
        VALUES ('${ID.TODA1}','E2E Driver ${n}','FRN-${n}', now() - interval '1 day'),
               ('${ID.TODA1}','E2E Driver ${n}','FRN-NEW-${n}', now() - interval '1 day')`);   // ...and so is the corrected franchise number of the MTOP case
    const reg = await rpc(AUTH, 'apply_driver_toda_affiliations', [JSON.stringify([{ toda_id: ID.TODA1, toda_membership_number: `M-${n}` }])]);
    const A = reg.results[0].affiliation_id;
    let st = await screen(AUTH);
    check('register: one Submitted application; the screen is a plain "under review"', reg.success === true && st.kind === 'under_review' && st.returnedDocuments.length === 0, st);

    // 2. the TODA returns the documents, each with a preset reason and free text
    const ret = await rpc(TODA_ADMIN, 'return_driver_documents', [A, JSON.stringify(c.docs)]);
    check(`the TODA returns ${types.join(' + ')} with a reason for each`, ret.success === true && JSON.stringify(ret.documents.slice().sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))) === JSON.stringify(types), ret);

    // 3. the driver sees the reasons and is asked for ONLY those documents (not "the licence" by default)
    st = await screen(AUTH);
    check('the driver\'s screen: "Resubmission Required", asked for exactly the returned document(s)', st.kind === 'resubmission_required' && JSON.stringify(st.documentsToResubmit) === JSON.stringify(types), st);
    check('...with the TODA\'s reason for each document, word for word',
      c.docs.every((d) => st.returnedDocuments.some((r) => r.document_type === d.document_type && r.reason === d.reason && r.reason_code === d.reason_code)), st.returnedDocuments);
    check('...and every other document is shown as NOT returned', ORDER.every((d) => types.includes(d) ? st.documentStates[d] === 'returned' : st.documentStates[d] === 'not_returned'), st.documentStates);

    // 4. the driver replaces them: the DATA of the returned documents only, then the resubmission
    const before = await one(`SELECT submitted_license_number l, submitted_franchise_number f, submitted_plate_number p FROM driver_verification WHERE driver_id='${DID}'`);
    const colFor = { license: `submitted_license_number='LIC-NEW-${n}'`, mtop: `submitted_franchise_number='FRN-NEW-${n}'`, tricycle: `submitted_plate_number='PLATE-NEW-${n}'` };
    const sets = types.map((x) => colFor[x]).filter(Boolean).join(', ');
    const upd = await attempt(() => asUser(db, { uid: AUTH }, (tx) => tx.query(`UPDATE driver_verification SET ${sets}, remarks='Resubmitted by driver applicant' WHERE driver_id='${DID}'`), { commit: true }));
    check('the driver\'s own update of the returned documents\' data is accepted', upd.ok && upd.value.rowCount === 1, upd.ok ? null : upd.error);
    const sub = await rpc(AUTH, 'resubmit_driver_documents', [null]);
    const after = await one(`SELECT submitted_license_number l, submitted_franchise_number f, submitted_plate_number p FROM driver_verification WHERE driver_id='${DID}'`);
    check('resubmitted: the application is back in TODA review', sub.success === true && sub.back_in_review.length === 1 && sub.back_in_review[0].affiliation_id === A && sub.back_in_review[0].stage === 'TODA', sub);
    check('the documents that were NOT returned were not touched',
      (types.includes('license') || before.l === after.l) && (types.includes('mtop') || before.f === after.f) && (types.includes('tricycle') || before.p === after.p), { before, after });

    // 5. the status screen: "Resubmitted, awaiting TODA review", the date, per-document state; it does NOT say anything passed
    st = await screen(AUTH);
    check('the status says "resubmitted, awaiting TODA review" with the date', st.kind === 'resubmitted_awaiting_toda' && st.resubmittedAt && (Date.now() - new Date(st.resubmittedAt).getTime()) < 120_000, st);
    check('per document: the replaced ones are "resubmitted", the others "not returned" (nothing is marked as passed)',
      ORDER.every((d) => types.includes(d) ? st.documentStates[d] === 'resubmitted' : st.documentStates[d] === 'not_returned') && st.resubmittedDocuments.map((d) => d.document_type).join() === types.join(), st.documentStates);
    check('the return reason is no longer an open request (it will show as history only)', st.returnedDocuments.length === 0 && st.documentsToResubmit.length === 0);

    // 6. the TODA sees it: the Resubmitted state, the previous reason, the restarted clock, the notification, the audit trail
    const rv = await rows(TODA_ADMIN, `SELECT * FROM public.get_affiliation_document_reviews($1::uuid[])`, [[A]]);
    const aff = (await rows(TODA_ADMIN, `SELECT toda_endorsement_status e, resubmitted_at, submitted_at FROM driver_toda_affiliation WHERE affiliation_id='${A}'`))[0];
    check('TODA: each replaced document is "resubmitted" and still carries the PREVIOUS reason and both dates',
      c.docs.every((d) => { const r = rv.find((x) => x.document_type === d.document_type); return r && r.state === 'resubmitted' && r.reason === d.reason && r.returned_at && r.resubmitted_at; }), rv.map((r) => r.document_type + ':' + r.state));
    check('TODA: the application is Submitted again and the 5-calendar-day clock restarted at the resubmission', aff.e === 'Submitted' && new Date(aff.resubmitted_at) > new Date(aff.submitted_at), aff);
    const note = await rows(TODA_ADMIN, `SELECT title, message FROM notification WHERE notification_type='DRIVER_RESUBMITTED' AND subject_id='${A}'`);
    check('TODA: it was notified that the returned application came back', note.length === 1 && c.docs.every((d) => note[0].message.includes({ license: "Driver's License", mtop: 'MTOP', tricycle: 'Tricycle photo' }[d.document_type])), note);
    const trail = await rows(TODA_ADMIN, `SELECT action_type FROM audit_log WHERE target_id='${A}' AND action_type IN ('DRIVER_DOCUMENTS_RETURNED','DRIVER_APPLICATION_RESUBMITTED') ORDER BY performed_at, log_id`);
    const hist = await q(`SELECT event_type FROM document_review_history WHERE driver_id='${DID}' ORDER BY event_seq`);
    check('audit_log and the document history record both the return and the resubmission', trail.length === 2 && hist.filter((h) => h.event_type === 'Returned').length === types.length && hist.filter((h) => h.event_type === 'Resubmitted').length === types.length, { trail, hist });

    // 7. the TODA endorses; 8. the LGU approves
    const end = await rpc(TODA_ADMIN, 'endorse_driver_affiliation', [A]);
    st = await screen(AUTH);
    check('the TODA endorses: the "resubmitted" state ends and the application waits for the LGU', end.success === true && st.kind === 'endorsed_awaiting_lgu' && st.resubmittedAt === null, st);
    const ver = await rpc(LGU, 'verify_driver_affiliation', [A]);
    const fin = await one(`SELECT d.account_status, a.is_active_selection FROM driver d JOIN driver_toda_affiliation a USING (driver_id) WHERE d.driver_id='${DID}'`);
    check('the LGU approves: the driver is Verified and that TODA is the active one', ver.success === true && fin.account_status === 'Verified' && fin.is_active_selection === true, fin);
  }

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
