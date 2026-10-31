// Migration 20261101000001 (owner's request, Batch 1 section D): a change to an ACCREDITED TODA that the LGU approved (its identity fields, the name of its terminal place and its
// Internal Bylaws) is a request the LGU decides; the record in force is untouched until then, every step is audited, and a table update from the TODA's app cannot get around it.
// What stays the TODA's own (officer contacts, the roster) stays so. Whole migration chain on the local emulator (never Supabase).
const { setup, ID, PAX, attempt, check, summary } = require('../b11fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, as } = s;
  const LGU = ID.L_AUTH;
  const rpc = (uid, sql, args = []) => attempt(() => s.rpcAs(uid, `public.${sql}`, args));
  const toda = () => one(`SELECT * FROM toda WHERE toda_id = '${ID.TODA1}'`);
  const audits = (action) => q(`SELECT * FROM audit_log WHERE action_type = '${action}' AND target_id = '${ID.TODA1}' ORDER BY performed_at`);
  const requests = (kind) => q(`SELECT * FROM toda_change_request WHERE toda_id = '${ID.TODA1}' AND kind = '${kind}' ORDER BY requested_at, request_id`);
  const flags = (type, subject = ID.TODA1) => q(`SELECT * FROM admin_review_flag WHERE flag_type = '${type}' AND subject_id = '${subject}'`);
  const propose = (uid, changes, reason = null) => rpc(uid, 'request_toda_profile_change($1::jsonb,$2)', [JSON.stringify(changes), reason]);
  const refuse = async (label, call, code) => { const x = await call; check(label, x.ok && x.value.success === false && x.value.error_code === code, x); };

  await internal(`UPDATE toda SET toda_status = 'Pending Verification', account_status = 'Pending', toda_name = 'Toda One', toda_acronym = 'TOD1', barangay = 'Ilaya',
                                  date_established = '2015-03-01', service_coverage_area = 'Terminal beside the old market', bylaws_url = '${ID.T_AUTH}/bylaws-v1.pdf'
                   WHERE toda_id = '${ID.TODA1}'`);
  await internal(`UPDATE toda SET toda_acronym = 'TOD2' WHERE toda_id = '${ID.TODA2}'`);
  await internal(`UPDATE toda_admin SET account_status = 'Active' WHERE toda_id = '${ID.TODA1}'`);

  console.log('S1 while the application is still under review the details are the applicant\'s own');
  let r = await propose(ID.T_AUTH, { toda_name: 'Toda One Association', barangay: 'San Vicente' });
  let t = await toda();
  check('the change is applied at once and recorded (nothing is accredited yet)', r.ok && r.value.success === true && r.value.applied === true && t.toda_name === 'Toda One Association' && t.barangay === 'San Vicente', r);
  check('...and no request is made', (await requests('profile')).length === 0);
  check('...and it is audited with the old and the new values', (await audits('TODA_PROFILE_UPDATED')).length === 1);

  console.log('\nS2 an ACCREDITED TODA proposes new details: the record in force is untouched');
  await internal(`UPDATE toda SET toda_status = 'Active', account_status = 'Active', toda_name = 'Toda One', toda_acronym = 'TOD1', barangay = 'Ilaya' WHERE toda_id = '${ID.TODA1}'`);
  r = await propose(ID.T_AUTH, { toda_name: 'Toda One Tricycle Association', toda_acronym: 'tod1a', barangay: 'San Vicente', date_established: '2015-03-01' }, 'We registered under the new name with the barangay.');
  t = await toda();
  check('the request is accepted as pending', r.ok && r.value.success === true && r.value.pending === true && r.value.request_id, r);
  check('the name, acronym and barangay in force are NOT changed', t.toda_name === 'Toda One' && t.toda_acronym === 'TOD1' && t.barangay === 'Ilaya', t);
  let reqs = await requests('profile');
  check('the request keeps what is in force, what is proposed, who asked and why',
    reqs.length === 1 && reqs[0].status === 'Pending' && reqs[0].previous.toda_name === 'Toda One' && reqs[0].proposed.toda_name === 'Toda One Tricycle Association'
    && reqs[0].proposed.toda_acronym === 'TOD1A' && reqs[0].requested_by === ID.T_AUTH && reqs[0].requested_by_name === 'Toda1 Admin' && /new name/.test(reqs[0].reason), reqs[0]);
  check('an unchanged field (the date established) is not part of the request', !('date_established' in reqs[0].proposed));
  check('the LGU gets a review flag', (await flags('TODA_PROFILE_CHANGE_REQUESTED')).length === 1);
  check('the request is audited with the old and the new values', (await audits('TODA_PROFILE_CHANGE_REQUESTED')).length === 1);
  r = await propose(ID.T_AUTH, { toda_name: 'Toda One Tricycle Operators and Drivers Association' });
  reqs = await requests('profile');
  check('a newer request REPLACES the open one (the first is kept as Superseded)', r.ok && r.value.pending === true && reqs.filter((x) => x.status === 'Pending').length === 1 && reqs.filter((x) => x.status === 'Superseded').length === 1, reqs);
  check('only one review flag stays open', (await flags('TODA_PROFILE_CHANGE_REQUESTED')).filter((f) => f.status === 'Open').length === 1);
  r = await propose(ID.T_AUTH, { toda_name: 'Toda One' });
  check('proposing what is already in force changes nothing and makes no request', r.ok && r.value.success === true && r.value.changed === false, r);

  console.log('\nS3 what is refused');
  await refuse('a passenger cannot', propose(PAX.P1.uid, { toda_name: 'Hijacked' }), 'ERR_NOT_TODA_ADMIN');
  await refuse('another TODA\'s administrator changes only THEIR TODA (this call has no way to name another)', propose(ID.T2_AUTH, { toda_name: 'Toda One Hijacked' }).then(async (x) => { check('...their own TODA got the request, the first one is untouched', (await toda()).toda_name === 'Toda One'); return { ok: true, value: { success: false, error_code: 'ERR_NOT_TODA_ADMIN' } }; }), 'ERR_NOT_TODA_ADMIN');
  await refuse('a field that is not an identity field (the terminal pin) cannot be sent', propose(ID.T_AUTH, { terminal_latitude: 13.4 }), 'ERR_FIELD');
  await refuse('an acronym another TODA already uses is refused', propose(ID.T_AUTH, { toda_acronym: 'tod2' }), 'ERR_ACRONYM_TAKEN');
  await refuse('a name that is too short is refused', propose(ID.T_AUTH, { toda_name: 'ab' }), 'ERR_FIELD');
  await refuse('a date established in the future is refused', propose(ID.T_AUTH, { date_established: '2099-01-01' }), 'ERR_FIELD');

  console.log('\nS4 the identity of an accredited TODA changes only through the request (a table update from the TODA\'s app is refused)');
  for (const [label, sql] of [
    ['the name', `UPDATE toda SET toda_name = 'Renamed Quietly' WHERE toda_id = '${ID.TODA1}'`],
    ['the acronym', `UPDATE toda SET toda_acronym = 'QUIET' WHERE toda_id = '${ID.TODA1}'`],
    ['the barangay', `UPDATE toda SET barangay = 'Somewhere Else' WHERE toda_id = '${ID.TODA1}'`],
    ['the name of the terminal place (it used to be rewritten on every profile save)', `UPDATE toda SET service_coverage_area = 'A new place nobody approved' WHERE toda_id = '${ID.TODA1}'`],
    ['the bylaws file', `UPDATE toda SET bylaws_url = '${ID.T_AUTH}/quiet.pdf' WHERE toda_id = '${ID.TODA1}'`],
  ]) {
    const d = await attempt(() => as(ID.T_AUTH, (tx) => tx.query(sql)));
    check(`a table update cannot change ${label}`, !d.ok && /Access Denied/.test(d.error), d);
  }
  const contact = await attempt(() => as(ID.T_AUTH, (tx) => tx.query(`UPDATE toda SET vice_president_name = 'Vice Person', president_contact = '+639171112222' WHERE toda_id = '${ID.TODA1}'`)));
  check('officer names and contact numbers stay the TODA\'s own (no approval): the update is allowed', contact.ok, contact);
  t = await toda();
  check('nothing in force moved', t.toda_name === 'Toda One' && t.toda_acronym === 'TOD1' && t.barangay === 'Ilaya' && t.service_coverage_area === 'Terminal beside the old market');

  console.log('\nS5 the LGU decides, in its own words');
  const open = (await requests('profile')).find((x) => x.status === 'Pending');
  let d = await rpc(ID.T_AUTH, 'decide_toda_change_request($1,$2,$3)', [open.request_id, true, 'Approving my own request.']);
  check('a TODA administrator cannot approve (only the LGU)', d.ok && d.value.success === false && d.value.error_code === 'ERR_NOT_LGU' && (await toda()).toda_name === 'Toda One', d);
  d = await rpc(LGU, 'decide_toda_change_request($1,$2,$3)', [open.request_id, true, 'ok']);
  check('deciding without the LGU\'s own words (under 10 characters) is refused', d.ok && d.value.success === false && d.value.error_code === 'ERR_DECISION_NOTE' && (await toda()).toda_name === 'Toda One', d);
  d = await rpc(LGU, 'decide_toda_change_request($1,$2,$3)', [open.request_id, true, 'The association papers show the new name.']);
  t = await toda();
  check('the LGU approves with its reason: the proposed values are now in force', d.ok && d.value.success === true && t.toda_name === 'Toda One Tricycle Operators and Drivers Association', d);
  const decided = (await requests('profile')).find((x) => x.request_id === open.request_id);
  check('the decision, its words, who decided and when are kept on the request', decided.status === 'Approved' && /association papers/.test(decided.decision_note) && decided.decided_by === LGU && decided.decided_by_name === 'LGU Admin' && decided.decided_at !== null, decided);
  check('the approval is audited and the review flag is resolved', (await audits('TODA_CHANGE_APPROVED')).length === 1 && (await flags('TODA_PROFILE_CHANGE_REQUESTED')).every((f) => f.status === 'Resolved'));
  d = await rpc(LGU, 'decide_toda_change_request($1,$2,$3)', [open.request_id, true, 'Approving the same request twice.']);
  check('deciding it again finds nothing pending', d.ok && d.value.success === false && d.value.error_code === 'ERR_NOT_PENDING', d);

  r = await propose(ID.T_AUTH, { barangay: 'Sto. Nino' });
  const second = r.value.request_id;
  d = await rpc(LGU, 'decide_toda_change_request($1,$2,$3)', [second, false, 'The barangay does not match the clearance.']);
  t = await toda();
  check('a rejection leaves the record exactly as it was and says why', d.ok && d.value.success === true && d.value.approved === false && t.barangay === 'Ilaya'
    && (await requests('profile')).find((x) => x.request_id === second).status === 'Rejected' && (await audits('TODA_CHANGE_REJECTED')).length === 1, d);

  console.log('\nS6 the Internal Bylaws of an accredited TODA wait for the LGU');
  const submit = (uid, path, name) => rpc(uid, 'toda_submit_compliance_document($1,$2,$3,$4)', ['Internal Bylaws', path, name, null]);
  r = await submit(ID.T_AUTH, `${ID.T_AUTH}/bylaws-v2.pdf`, 'bylaws-v2.pdf');
  t = await toda();
  check('the new bylaws are a pending request: the file in force is NOT replaced', r.ok && r.value.success === true && r.value.pending === true && t.bylaws_url === `${ID.T_AUTH}/bylaws-v1.pdf`, r);
  let by = await requests('bylaws');
  check('the request keeps the file in force, the proposed file and its name', by.length === 1 && by[0].status === 'Pending' && by[0].previous.bylaws_url.endsWith('bylaws-v1.pdf') && by[0].proposed.bylaws_url.endsWith('bylaws-v2.pdf') && by[0].file_name === 'bylaws-v2.pdf', by);
  check('the LGU gets a review flag and the audit says the bylaws in force stay', (await flags('TODA_BYLAWS_CHANGE_REQUESTED')).length === 1 && (await audits('COMPLIANCE_DOCUMENT_UPDATED')).some((a) => /Proposed new Internal Bylaws/.test(a.details)));
  await submit(ID.T_AUTH, `${ID.T_AUTH}/bylaws-v3.pdf`, 'bylaws-v3.pdf');
  by = await requests('bylaws');
  check('a newer file replaces the open request (the older one is Superseded)', by.filter((x) => x.status === 'Pending').length === 1 && by.filter((x) => x.status === 'Superseded').length === 1 && by.find((x) => x.status === 'Pending').file_name === 'bylaws-v3.pdf');
  d = await rpc(LGU, 'decide_toda_change_request($1,$2,$3)', [by.find((x) => x.status === 'Pending').request_id, true, 'The bylaws were read and are acceptable.']);
  check('the LGU approves: the new file is now in force', d.ok && d.value.success === true && (await toda()).bylaws_url === `${ID.T_AUTH}/bylaws-v3.pdf`, d);

  console.log('\nS7 the TODA can take its own request back');
  r = await submit(ID.T_AUTH, `${ID.T_AUTH}/bylaws-v4.pdf`, 'bylaws-v4.pdf');
  const mine = (await requests('bylaws')).find((x) => x.status === 'Pending');
  d = await rpc(ID.T2_AUTH, 'withdraw_toda_change_request($1)', [mine.request_id]);
  check('another TODA cannot take it back', d.ok && d.value.success === false, d);
  d = await rpc(ID.T_AUTH, 'withdraw_toda_change_request($1)', [mine.request_id]);
  check('the TODA takes it back: the request is Withdrawn and the flag is dismissed, the file in force is unchanged',
    d.ok && d.value.success === true && (await requests('bylaws')).find((x) => x.request_id === mine.request_id).status === 'Withdrawn' && (await toda()).bylaws_url === `${ID.T_AUTH}/bylaws-v3.pdf`
    && (await flags('TODA_BYLAWS_CHANGE_REQUESTED')).filter((f) => f.status === 'Open').length === 0, d);

  console.log('\nS8 a verified member leaves the roster: the roster change is the TODA\'s, the LGU is asked to look');
  await internal(`UPDATE driver SET franchise_number = 'MTOP-7788' WHERE driver_id = '${ID.D1}'`);
  await internal(`INSERT INTO driver_toda_affiliation (driver_id, toda_id, toda_endorsement_status, lgu_verification_status, is_active_selection)
                  VALUES ('${ID.D1}', '${ID.TODA1}', 'Endorsed', 'Approved', TRUE) ON CONFLICT DO NOTHING`).catch(() => null);
  const added = await rpc(ID.T_AUTH, 'add_toda_roster_entry($1,$2,$3,$4)', ['Driver One', 'MTOP-7788', 'ABC 1234', 'M-001']);
  const entry = added.ok && added.value.entry ? added.value.entry.entry_id : null;
  check('a member is added by the TODA (no approval needed for a roster insert)', added.ok && added.value.success === true && entry, added);
  const left = await rpc(ID.T_AUTH, 'mark_toda_roster_entry_left($1,$2)', [entry, 'He transferred to another association last month.']);
  check('marking him as left works without the LGU (it is the TODA\'s own roster)', left.ok && left.value.success === true, left);
  const fl = await flags('TODA_ROSTER_MEMBER_LEFT', ID.D1);
  const aff = await q(`SELECT lgu_verification_status FROM driver_toda_affiliation WHERE driver_id = '${ID.D1}' AND toda_id = '${ID.TODA1}'`);
  check('the LGU gets a review request for the verified driver, who stays verified until it decides', fl.length === 1 && fl[0].status === 'Open' && aff[0]?.lgu_verification_status === 'Approved', { fl, aff });

  summary();
})().catch((e) => { console.error(e); process.exit(1); });
