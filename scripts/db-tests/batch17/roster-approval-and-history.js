// Migration 20261104000001 (Batch 4): (1) a member added to a TODA's Master Roster after the registration roster file counts only once the LGU approves the entry,
// (2) document statuses follow the endorsement and the LGU's verification and a replaced document is never shown as approved, (3) the verification history of a driver.
// Whole migration chain on the local emulator (never Supabase).
const { setup, ID, AFF, attempt, check, summary, asUser } = require('../b4fixtures');

(async () => {
  const t = await setup(null);
  const { db, internal, one, q } = t;
  const T1 = ID.T_AUTH;
  const T2 = ID.T2_AUTH;
  const LGU = ID.L_AUTH;
  const call = (uid, sql, args = []) => attempt(() => asUser(db, { uid }, (tx) => tx.query(`SELECT public.${sql} AS r`, args), { commit: true }).then((r) => r.rows[0].r));
  const rows = (uid, sql, args = []) => attempt(() => asUser(db, { uid }, (tx) => tx.query(sql, args), { commit: true }).then((r) => r.rows));
  const entryOf = (toda, fr) => one(`SELECT * FROM toda_roster_entry WHERE toda_id = '${toda}' AND normalized_franchise = '${fr}' ORDER BY created_at DESC LIMIT 1`);
  const notices = (recipient, type) => q(`SELECT * FROM notification WHERE recipient_id = '${recipient}' AND notification_type = '${type}' ORDER BY sent_at`);
  const audits = (action) => q(`SELECT * FROM audit_log WHERE action_type = '${action}' ORDER BY performed_at`);
  const decide = (uid, id, decision, reason = null) => call(uid, 'decide_toda_roster_entry($1,$2,$3)', [id, decision, reason]);
  const verdict = async (aff) => one(`SELECT roster_matched, reason_code FROM public.affiliation_roster_check('${aff}')`);

  await internal(`DELETE FROM toda_roster_entry`);
  await internal(`UPDATE toda SET toda_status = 'Active', account_status = 'Active' WHERE toda_id IN ('${ID.TODA1}', '${ID.TODA2}')`);
  await internal(`UPDATE toda_admin SET account_status = 'Active'`);

  console.log('A1 the registration roster file is the original roster: approved, never asked again');
  const first = (await call(T1, 'import_toda_roster($1::jsonb)', [JSON.stringify([
    { member_name: 'Original One', franchise_number: 'ORG-1', plate_number: 'O 1' },
    { member_name: 'Original Two', franchise_number: 'ORG-2', plate_number: 'O 2' },
  ])])).value;
  const org = await entryOf(ID.TODA1, 'ORG1');
  check('the first import of a TODA is the registration file: its entries are Approved (original_roster)', first.success === true && org.source === 'registration_file' && org.approval_status === 'Approved' && org.approval_basis === 'original_roster', org);
  let r = await decide(LGU, org.entry_id, 'approve');
  check('the LGU is not asked to approve an original-roster member again', r.ok && r.value.success === false && r.value.error_code === 'ERR_ROSTER_NOT_PENDING', r);
  check('no notice was sent to the LGU for the registration file', (await notices('lgu_admin', 'ROSTER_ENTRY_PENDING_LGU')).length === 0);

  console.log('\nA2 a member added later waits for the LGU');
  await internal(`DELETE FROM driver_verification WHERE driver_id = '${ID.D1}'`);
  await internal(`INSERT INTO driver_verification(driver_id, submitted_license_number, submitted_franchise_number) VALUES ('${ID.D1}', 'L-D1', 'NEW-1')`);
  r = await call(T1, 'add_toda_roster_entry($1,$2,$3,$4)', ['New Member', 'NEW-1', 'NEW 111', null]);
  const nm = await entryOf(ID.TODA1, 'NEW1');
  check('a member added by the TODA is Pending, with no decision recorded', r.ok && r.value.success === true && nm.approval_status === 'Pending' && nm.approval_decided_at === null && nm.approval_basis === null, nm);
  const lguNotices = await notices('lgu_admin', 'ROSTER_ENTRY_PENDING_LGU');
  check('the LGU is told once, and the notice names the TODA and the subject (the TODA, for the page it opens)', lguNotices.length === 1 && lguNotices[0].subject_id === ID.TODA1 && /Toda One/.test(lguNotices[0].title), lguNotices);
  await internal(`UPDATE driver_toda_affiliation SET submitted_at = clock_timestamp() + interval '1 minute' WHERE affiliation_id = '${AFF.D1_T1}'`);
  let v = await verdict(AFF.D1_T1);
  check('an application made AFTER he was added still does not count while the entry is Pending (entry_pending_lgu)', v.roster_matched === false && v.reason_code === 'entry_pending_lgu', v);
  const reader = await rows(T1, `SELECT reason_code, roster_matched FROM public.get_affiliation_roster_matches($1::uuid[])`, [[AFF.D1_T1]]);
  check('the screen\'s reader gives the same answer', reader.ok && reader.value[0].reason_code === 'entry_pending_lgu' && reader.value[0].roster_matched === false, reader);

  // an endorsed application with the roster-mismatch flag open, which the approval will settle
  await internal(`INSERT INTO admin_review_flag(flag_type, subject_type, subject_id, source_rule, assigned_role, details)
                  VALUES ('ROSTER_MISMATCH', 'driver_application', '${AFF.D1_T1}', 'Rule 2.4', 'lgu_admin', '{}'::jsonb)`);

  console.log('\nA3 who can decide, and the rules of a decision');
  r = await decide(T1, nm.entry_id, 'approve');
  check('a TODA administrator cannot approve their own member', r.ok && r.value.success === false && r.value.error_code === 'ERR_NOT_LGU_ADMIN', r);
  r = await decide(ID.P_AUTH, nm.entry_id, 'approve');
  check('a passenger cannot', r.ok && r.value.success === false && r.value.error_code === 'ERR_NOT_LGU_ADMIN', r);
  const anon = await attempt(() => asUser(db, { role: 'anon' }, (tx) => tx.query(`SELECT public.decide_toda_roster_entry('${nm.entry_id}','approve',NULL)`)));
  check('anon cannot call it at all', !anon.ok, anon.ok ? 'allowed' : anon.error);
  r = await decide(LGU, nm.entry_id, 'maybe');
  check('a decision must be approve or reject', r.ok && r.value.success === false && r.value.error_code === 'ERR_ROSTER_DECISION', r);
  r = await decide(LGU, nm.entry_id, 'reject');
  check('a rejection needs a reason', r.ok && r.value.success === false && r.value.error_code === 'ERR_ROSTER_REASON', r);
  r = await decide(LGU, nm.entry_id, 'reject', 'too short');
  check('... of at least 10 characters', r.ok && r.value.success === false && r.value.error_code === 'ERR_ROSTER_REASON', r);
  check('nothing changed by the refused attempts', (await entryOf(ID.TODA1, 'NEW1')).approval_status === 'Pending');

  console.log('\nA4 the LGU rejects; the TODA is told and can correct the entry');
  r = await decide(LGU, nm.entry_id, 'reject', 'The franchise number does not match the MTOP on file.');
  let after = await entryOf(ID.TODA1, 'NEW1');
  check('the entry is Rejected, with who decided, when and why', r.ok && r.value.success === true && after.approval_status === 'Rejected' && after.approval_basis === 'lgu_decision'
    && after.approval_decided_by === LGU && after.approval_decided_by_name === 'LGU Admin' && after.approval_decided_at !== null && /MTOP/.test(after.approval_reason), after);
  check('the decision is in the audit log, written by the database, with the LGU as the actor', (await audits('TODA_ROSTER_ENTRY_REJECTED')).length === 1 && (await audits('TODA_ROSTER_ENTRY_REJECTED'))[0].actor_id === LGU);
  const toda1 = await notices(`toda_${ID.TODA1}`, 'ROSTER_ENTRY_DECIDED');
  check('the TODA is told, with the reason', toda1.length === 1 && /not approved/i.test(toda1[0].title) && /MTOP/.test(toda1[0].message), toda1);
  v = await verdict(AFF.D1_T1);
  check('the roster check says entry_rejected_lgu', v.roster_matched === false && v.reason_code === 'entry_rejected_lgu', v);
  r = await decide(LGU, nm.entry_id, 'approve');
  check('a decided entry cannot be decided again', r.ok && r.value.success === false && r.value.error_code === 'ERR_ROSTER_NOT_PENDING', r);

  r = await call(T1, 'update_toda_roster_entry($1,$2,$3,$4,$5)', [nm.entry_id, 'New Member', 'NEW-1', 'NEW 112', null]);
  after = await entryOf(ID.TODA1, 'NEW1');
  check('correcting the rejected entry sends it back to the LGU: Pending again, the decision cleared', r.ok && r.value.success === true && after.approval_status === 'Pending' && after.approval_decided_at === null && after.approval_reason === null, after);
  const upd = (await audits('TODA_ROSTER_ENTRY_UPDATED')).pop();
  check('the audit entry keeps the earlier rejection (before) and says it went back to the LGU', upd.before_state.approval_status === 'Rejected' && /MTOP/.test(upd.before_state.approval_reason) && upd.after_state.approval_status === 'Pending' && /again/.test(upd.details), upd);
  check('the LGU is told again', (await notices('lgu_admin', 'ROSTER_ENTRY_PENDING_LGU')).length === 2);

  console.log('\nA5 the LGU approves; the roster check matches and a settled roster-mismatch flag is resolved');
  r = await decide(LGU, nm.entry_id, 'approve', 'Checked against the MTOP.');
  after = await entryOf(ID.TODA1, 'NEW1');
  check('Approved, by the LGU, with a time', r.ok && r.value.success === true && r.value.flags_resolved === 1 && after.approval_status === 'Approved' && after.approval_decided_by === LGU && after.approval_decided_at !== null && after.approval_reason === 'Checked against the MTOP.', { r, after });
  await internal(`UPDATE driver_toda_affiliation SET submitted_at = clock_timestamp() + interval '1 minute' WHERE affiliation_id = '${AFF.D1_T1}'`);
  v = await verdict(AFF.D1_T1);
  check('an application made after he was added now matches', v.roster_matched === true && v.reason_code === 'matched', v);
  const flag = await one(`SELECT status, resolution FROM admin_review_flag WHERE subject_id = '${AFF.D1_T1}' AND flag_type = 'ROSTER_MISMATCH'`);
  check('the roster-mismatch flag the approval settles is Resolved, with the reason on record', flag.status === 'Resolved' && /approved New Member/.test(flag.resolution), flag);
  check('the approval is in the audit log', (await audits('TODA_ROSTER_ENTRY_APPROVED')).length === 1);
  check('the timing rule is unchanged: an application made BEFORE he was added is still "added later"',
    await (async () => { await internal(`UPDATE driver_toda_affiliation SET submitted_at = '2020-01-01' WHERE affiliation_id = '${AFF.D1_T1}'`); return (await verdict(AFF.D1_T1)).reason_code === 'entry_added_later'; })());

  console.log('\nA6 an updated file, a changed franchise number, a member who left and came back');
  const up = (await call(T1, 'import_toda_roster($1::jsonb)', [JSON.stringify([{ member_name: 'From Update', franchise_number: 'UPD-1', plate_number: 'U 1' }])])).value;
  const fu = await entryOf(ID.TODA1, 'UPD1');
  check('the second import is an UPDATED file: its new members are Pending', up.success === true && fu.source === 'file_update' && fu.approval_status === 'Pending', fu);
  check('...and the LGU is told once for that file', (await notices('lgu_admin', 'ROSTER_ENTRY_PENDING_LGU')).length === 3);
  r = await call(T1, 'update_toda_roster_entry($1,$2,$3,$4,$5)', [org.entry_id, 'Original One (renamed)', 'ORG-1', 'O 1', null]);
  check('a name change of an approved entry keeps the approval', r.ok && r.value.success === true && (await entryOf(ID.TODA1, 'ORG1')).approval_status === 'Approved');
  r = await call(T1, 'update_toda_roster_entry($1,$2,$3,$4,$5)', [org.entry_id, 'Original One (renamed)', 'ORG-9', 'O 1', null]);
  const moved = await entryOf(ID.TODA1, 'ORG9');
  check('a changed FRANCHISE number is a different member: the original approval does not carry over (Pending)', r.ok && r.value.success === true && moved.approval_status === 'Pending' && moved.approval_basis === null, moved);
  const nm2 = await entryOf(ID.TODA1, 'NEW1');
  await call(T1, 'mark_toda_roster_entry_left($1,$2)', [nm2.entry_id, 'He transferred to another association.']);
  r = await decide(LGU, nm2.entry_id, 'approve');
  check('a member who left cannot be decided', r.ok && r.value.success === false && r.value.error_code === 'ERR_ROSTER_LEFT', r);
  await call(T1, 'reinstate_toda_roster_entry($1)', [nm2.entry_id]);
  const back = await one(`SELECT * FROM toda_roster_entry WHERE toda_id = '${ID.TODA1}' AND normalized_franchise = 'NEW1' AND status = 'Active'`);
  check('a member who left and came back keeps what the LGU decided before (Approved), his earlier decision date included', back.approval_status === 'Approved' && back.approval_decided_by === LGU && back.approval_decided_at !== null, back);
  const sum = (await call(LGU, 'get_toda_roster_summary($1)', [ID.TODA1])).value;
  check('the summary counts what waits for the LGU', sum.pending_lgu === 2 && sum.rejected_lgu === 0, sum);

  console.log('\nA7 a TODA cannot reach another TODA\'s decision, and a trusted insert is not a way round for the functions');
  const other = await call(T2, 'add_toda_roster_entry($1,$2,$3,$4)', ['Other Member', 'OTH-1', 'OTH 1', null]);
  const oth = await entryOf(ID.TODA2, 'OTH1');
  check('the other TODA\'s new member is Pending too', other.ok && other.value.success === true && oth.approval_status === 'Pending');
  const notMine = await call(T1, 'update_toda_roster_entry($1,$2,$3,$4,$5)', [oth.entry_id, 'Hijack', 'OTH-1', 'OTH 1', null]);
  check('TODA1 cannot touch TODA2\'s entry', notMine.ok && notMine.value.success === false && notMine.value.error_code === 'ERR_ROSTER_NOT_FOUND', notMine);

  console.log('\nB1 document statuses follow the decisions (get_affiliation_document_approvals)');
  // D3's application to TODA2: its franchise is on the original roster of TODA2
  await internal(`DELETE FROM toda_roster_entry WHERE toda_id = '${ID.TODA2}' AND normalized_franchise = 'OTH1'`);
  await internal(`INSERT INTO driver_verification(driver_id, submitted_franchise_number) VALUES ('${ID.D3}', 'T2-77') ON CONFLICT DO NOTHING`);
  await internal(`UPDATE driver_verification SET submitted_franchise_number = 'T2-77' WHERE driver_id = '${ID.D3}'`);
  await internal(`INSERT INTO toda_roster_entry(toda_id, member_name, franchise_number, plate_number, source, created_at)
                  VALUES ('${ID.TODA2}', 'Driver Three', 'T2-77', 'D3 777', 'registration_file', now() - interval '1 day')`);
  await internal(`UPDATE driver_toda_affiliation SET submitted_at = clock_timestamp() WHERE affiliation_id = '${AFF.D3_T2}'`);
  const states = async (uid) => { const x = await rows(uid, `SELECT document_type, approval_state, decided_stage, awaiting_stage FROM public.get_affiliation_document_approvals($1::uuid[])`, [[AFF.D3_T2]]); return x.ok ? x.value : null; };
  const all = (list, state) => list && list.length === 4 && list.every((d) => d.approval_state === state);
  let s = await states(T2);
  check('a submitted application: every document is pending, the TODA\'s turn', all(s, 'pending') && s.every((d) => d.awaiting_stage === 'TODA'), s);
  await internal(`INSERT INTO document_review_history(driver_id, document_type, event_type, actor_role) VALUES ('${ID.D3}', 'license', 'Resubmitted', 'driver')`);
  s = await states(T2);
  check('a document the driver replaced after the application: resubmitted (awaiting review); the others stay pending',
    s.find((d) => d.document_type === 'license').approval_state === 'resubmitted' && s.filter((d) => d.approval_state === 'pending').length === 3, s);

  // the real endorsement, by the TODA administrator
  const end = await call(T2, 'endorse_driver_affiliation($1)', [AFF.D3_T2]);
  check('the TODA endorses the application (the real function)', end.ok && end.value.success === true && end.value.roster_matched === true, end);
  s = await states(T2);
  check('after the endorsement the documents are endorsed (inspected by the TODA): "Resubmitted (Awaiting Review)" is gone for the replaced license too',
    all(s, 'endorsed') && s.every((d) => d.decided_stage === 'TODA' && d.awaiting_stage === 'LGU'), s);
  await internal(`INSERT INTO document_review_history(driver_id, document_type, event_type, actor_role) VALUES ('${ID.D3}', 'mtop', 'Resubmitted', 'driver')`);
  s = await states(LGU);
  check('a document replaced AFTER the endorsement is never shown as approved: resubmitted, waiting for the LGU',
    s.find((d) => d.document_type === 'mtop').approval_state === 'resubmitted' && s.find((d) => d.document_type === 'mtop').awaiting_stage === 'LGU'
    && s.filter((d) => d.approval_state === 'endorsed').length === 3, s);

  const ver = await call(LGU, 'verify_driver_affiliation($1)', [AFF.D3_T2]);
  check('the LGU verifies the application (the real function)', ver.ok && ver.value.success === true, ver);
  s = await states(LGU);
  check('after the LGU\'s verification every document is verified (the pending / resubmitted labels are gone), by the LGU', all(s, 'verified') && s.every((d) => d.decided_stage === 'LGU' && d.awaiting_stage === null), s);
  s = await states(T2);
  check('the TODA sees the same answer', all(s, 'verified'), s);
  await internal(`INSERT INTO document_review_history(driver_id, document_type, event_type, actor_role) VALUES ('${ID.D3}', 'selfie', 'Resubmitted', 'driver')`);
  s = await states(LGU);
  check('a document replaced AFTER the verification is NOT auto-approved: it goes back to resubmitted; the others stay verified',
    s.find((d) => d.document_type === 'selfie').approval_state === 'resubmitted' && s.filter((d) => d.approval_state === 'verified').length === 3, s);
  const otherToda = await rows(T1, `SELECT * FROM public.get_affiliation_document_approvals($1::uuid[])`, [[AFF.D3_T2]]);
  check('another TODA\'s administrator gets no rows for this application', otherToda.ok && otherToda.value.length === 0, otherToda);
  const anon2 = await attempt(() => asUser(db, { role: 'anon' }, (tx) => tx.query(`SELECT * FROM public.get_affiliation_document_approvals(NULL)`)));
  check('anon cannot read them', !anon2.ok, anon2.ok ? 'allowed' : anon2.error);

  console.log('\nC1 the verification history of a driver');
  await internal(`INSERT INTO document_review_history(driver_id, document_type, event_type, affiliation_id, toda_id, review_stage, actor_auth_id, actor_role, reason_code, reason)
                  VALUES ('${ID.D3}', 'tricycle', 'Returned', '${AFF.D3_T2}', '${ID.TODA2}', 'TODA', '${T2}', 'toda_admin', 'blurry', 'The photo of the tricycle is too dark to read the plate.')`);
  const hist = async (uid) => { const x = await rows(uid, `SELECT * FROM public.get_driver_verification_history($1)`, [ID.D3]); return x.ok ? x.value : null; };
  let h = await hist(LGU);
  const keys = h.map((e) => e.event_key);
  check('the LGU sees registration, application, the return of a document, the endorsement, the verification and the driver\'s replacements, oldest first',
    ['registered', 'submitted', 'doc_returned', 'doc_replaced', 'endorsed', 'verified'].every((k) => keys.includes(k)) && h.every((e, i) => i === 0 || new Date(e.event_at) >= new Date(h[i - 1].event_at)), keys);
  const endEv = h.find((e) => e.event_key === 'endorsed');
  const verEv = h.find((e) => e.event_key === 'verified');
  check('the endorsement is the TODA\'s, with the administrator\'s name and the TODA, and a real time',
    endEv.actor_role === 'toda_admin' && endEv.actor_name === 'Toda2 Admin' && endEv.toda_name === 'Toda Two' && endEv.outcome === 'Endorsed' && !Number.isNaN(Date.parse(endEv.event_at)), endEv);
  check('the verification is the LGU\'s, with the administrator\'s name', verEv.actor_role === 'lgu_admin' && verEv.actor_name === 'LGU Admin' && verEv.outcome === 'Verified', verEv);
  const retEv = h.find((e) => e.event_key === 'doc_returned');
  check('a returned document carries the stage (TODA), who and why', retEv.actor_role === 'toda_admin' && /tricycle/.test(retEv.label) && /too dark/.test(retEv.detail) && retEv.outcome === 'Returned', retEv);
  check('every endorsement / verification event is exactly the time the workflow wrote to the audit log',
    new Date(endEv.event_at).getTime() === new Date((await audits('DRIVER_AFFILIATION_STAGE1_ENDORSED'))[0].performed_at).getTime()
    && new Date(verEv.event_at).getTime() === new Date((await audits('DRIVER_AFFILIATION_STAGE2_VERIFIED'))[0].performed_at).getTime());
  h = await hist(T2);
  check('the driver\'s own TODA sees the history of its own application', h && h.some((e) => e.event_key === 'endorsed') && h.some((e) => e.event_key === 'verified'), h && h.map((e) => e.event_key));
  h = await hist(T1);
  check('another TODA\'s administrator sees nothing', h && h.length === 0, h);
  h = await hist(ID.P_AUTH);
  check('a passenger sees nothing', h && h.length === 0, h);
  const anon3 = await attempt(() => asUser(db, { role: 'anon' }, (tx) => tx.query(`SELECT * FROM public.get_driver_verification_history('${ID.D3}')`)));
  check('anon cannot call it', !anon3.ok, anon3.ok ? 'allowed' : anon3.error);

  // a member the TODA added after the registration file, and the LGU's decision, are part of the history of the driver with that franchise
  await call(T2, 'add_toda_roster_entry($1,$2,$3,$4)', ['Driver Three (new unit)', 'T2-88', 'D3 888', null]);
  await internal(`UPDATE driver_verification SET submitted_franchise_number = 'T2-88' WHERE driver_id = '${ID.D3}'`);
  const e88 = await entryOf(ID.TODA2, 'T288');
  await decide(LGU, e88.entry_id, 'approve', 'Same driver, new tricycle.');
  h = await hist(LGU);
  const ra = h.find((e) => e.event_key === 'roster_added');
  const rd = h.find((e) => e.event_key === 'roster_decided');
  check('a Master Roster addition and the LGU\'s decision appear in the history, each with its own real time',
    ra && rd && ra.actor_role === 'toda_admin' && ra.outcome === 'Awaiting LGU approval' && rd.actor_role === 'lgu_admin' && rd.outcome === 'Approved' && /new tricycle/.test(rd.detail) && new Date(rd.event_at) >= new Date(ra.event_at), { ra, rd });
  const mine = await hist(T1);
  check('...and TODA1\'s administrator still sees nothing of it', mine.length === 0);

  await t.db.close();
  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
