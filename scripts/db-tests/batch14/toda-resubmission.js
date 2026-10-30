// Migration 20261030000001 (TODA side of the accreditation cycle): a TODA that the LGU returned for correction can resubmit, an Active TODA can submit a renewed
// Barangay Clearance, the TODA declares the clearance validity, the clearance file only changes through the RPCs, and a duplicate franchise number is flagged.
// Whole migration chain on the local emulator (never Supabase).
const { setup, ID, DRIVERS, PAX, attempt, check, summary } = require('../b11fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, as } = s;
  const LGU = ID.L_AUTH;
  const rpc = (uid, sql, args = []) => attempt(() => s.rpcAs(uid, `public.${sql}`, args));
  const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const own = (uid, name) => `${uid}/${name}`;
  const ymd = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
  const toda = () => one(`SELECT * FROM toda WHERE toda_id = '${ID.TODA1}'`);
  const admin = () => one(`SELECT account_status FROM toda_admin WHERE toda_id = '${ID.TODA1}'`);
  await internal(`UPDATE toda SET toda_status = 'Pending Verification', account_status = 'Pending Verification', barangay_clearance_url = '${own(ID.T_AUTH, 'first.pdf')}', certificate_number = NULL, certificate_expiry = NULL WHERE toda_id = '${ID.TODA1}'`);
  await internal(`UPDATE toda_admin SET account_status = 'Active' WHERE toda_id = '${ID.TODA1}'`);

  console.log('S1 the TODA declares what its Barangay Clearance is valid until');
  let r = await rpc(ID.T_AUTH, 'toda_declare_clearance_validity($1)', [day(200)]);
  check('the TODA\'s own administrator can declare a future date', r.ok && r.value.success === true && ymd((await toda()).declared_clearance_valid_until) === day(200), r);
  r = await rpc(ID.T_AUTH, 'toda_declare_clearance_validity($1)', [day(-2)]);
  check('a date in the past is refused with ERR_VALIDITY_DATE', r.ok && r.value.success === false && r.value.error_code === 'ERR_VALIDITY_DATE', r);
  r = await rpc(ID.T_AUTH, 'toda_declare_clearance_validity($1)', [null]);
  check('an empty date is refused', r.ok && r.value.success === false && r.value.error_code === 'ERR_VALIDITY_DATE', r);
  r = await rpc(PAX.P1.uid, 'toda_declare_clearance_validity($1)', [day(100)]);
  check('a passenger is refused: ERR_NOT_TODA_ADMIN', r.ok && r.value.success === false && r.value.error_code === 'ERR_NOT_TODA_ADMIN', r);
  r = await rpc(LGU, 'toda_declare_clearance_validity($1)', [day(100)]);
  check('so is the LGU Administrator (it records the real date at approval instead)', r.ok && r.value.success === false && r.value.error_code === 'ERR_NOT_TODA_ADMIN', r);
  check('the declaration is in the audit log with the TODA administrator', (await q(`SELECT 1 FROM audit_log WHERE action_type = 'TODA_CLEARANCE_VALIDITY_DECLARED' AND target_id = '${ID.TODA1}' AND actor_id = '${ID.T_AUTH}'`)).length === 1);

  console.log('\nS2 the clearance file, its dates and the status change only through the RPCs');
  let d = await attempt(() => as(ID.T_AUTH, (tx) => tx.query(`UPDATE toda SET barangay_clearance_url = '${own(ID.T_AUTH, 'sneaky.pdf')}' WHERE toda_id = '${ID.TODA1}'`)));
  check('a TODA administrator can no longer replace the clearance file with a direct table update', !d.ok && /Access Denied/.test(d.error), d);
  d = await attempt(() => as(ID.T_AUTH, (tx) => tx.query(`UPDATE toda SET renewal_submitted_at = now() WHERE toda_id = '${ID.TODA1}'`)));
  check('... nor mark a renewal as submitted', !d.ok && /Access Denied/.test(d.error), d);
  d = await attempt(() => as(ID.T_AUTH, (tx) => tx.query(`UPDATE toda SET toda_status = 'Active' WHERE toda_id = '${ID.TODA1}'`)));
  check('... nor approve itself', !d.ok && /Access Denied/.test(d.error), d);
  d = await attempt(() => as(ID.T_AUTH, (tx) => tx.query(`UPDATE toda SET president_name = 'Pres. Reyes', declared_clearance_valid_until = '${day(300)}' WHERE toda_id = '${ID.TODA1}' RETURNING president_name`)));
  check('ordinary profile fields and the declared date can still be edited directly', d.ok && d.value.rows[0].president_name === 'Pres. Reyes', d);

  console.log('\nS3 submitting a document while the application is pending');
  r = await rpc(ID.T_AUTH, 'toda_submit_compliance_document($1,$2,$3,$4)', ['Barangay Clearance', own(ID.T_AUTH, 'clearance-2026.pdf'), 'clearance-2026.pdf', day(180)]);
  let t = await toda();
  check('a new clearance replaces the file, stamps when it arrived, stores the declared date and leaves the status alone',
    r.ok && r.value.success === true && r.value.renewal === false && t.barangay_clearance_url === own(ID.T_AUTH, 'clearance-2026.pdf') && t.barangay_clearance_submitted_at !== null && ymd(t.declared_clearance_valid_until) === day(180) && t.toda_status === 'Pending Verification' && t.renewal_submitted_at === null, { r, t });
  r = await rpc(ID.T_AUTH, 'toda_submit_compliance_document($1,$2,$3,$4)', ['Barangay Clearance', own(ID.T_AUTH, 'x.pdf'), 'x.pdf', null]);
  check('a clearance without its valid-until date is refused', r.ok && r.value.success === false && r.value.error_code === 'ERR_VALIDITY_DATE', r);
  r = await rpc(ID.T_AUTH, 'toda_submit_compliance_document($1,$2,$3,$4)', ['Barangay Clearance', own(ID.T_AUTH, 'x.pdf'), 'x.pdf', day(-1)]);
  check('... or with a past date', r.ok && r.value.success === false && r.value.error_code === 'ERR_VALIDITY_DATE', r);
  r = await rpc(ID.T_AUTH, 'toda_submit_compliance_document($1,$2,$3,$4)', ['Driver Roster', own(ID.T_AUTH, 'roster.xlsx'), 'roster.xlsx', null]);
  check('the driver roster needs no date', r.ok && r.value.success === true && (await toda()).accredited_drivers_url === own(ID.T_AUTH, 'roster.xlsx'), r);
  r = await rpc(ID.T_AUTH, 'toda_submit_compliance_document($1,$2,$3,$4)', ['Internal Bylaws', own(ID.T_AUTH, 'bylaws.pdf'), 'bylaws.pdf', null]);
  check('nor do the bylaws', r.ok && r.value.success === true && (await toda()).bylaws_url === own(ID.T_AUTH, 'bylaws.pdf'), r);
  r = await rpc(ID.T_AUTH, 'toda_submit_compliance_document($1,$2,$3,$4)', ['Business Permit', own(ID.T_AUTH, 'p.pdf'), 'p.pdf', null]);
  check('an unknown category is refused', r.ok && r.value.success === false && r.value.error_code === 'ERR_CATEGORY', r);
  for (const [why, path] of [['another login\'s folder', own(ID.P_AUTH, 'c.pdf')], ['a path that climbs out of the folder', own(ID.T_AUTH, '../' + ID.P_AUTH + '/c.pdf')], ['an empty path', ''], ['a bare file name', 'c.pdf']]) {
    r = await rpc(ID.T_AUTH, 'toda_submit_compliance_document($1,$2,$3,$4)', ['Barangay Clearance', path, 'c.pdf', day(100)]);
    check(`a file in ${why} is refused: ERR_FILE`, r.ok && r.value.success === false && r.value.error_code === 'ERR_FILE', r);
  }
  r = await rpc(PAX.P1.uid, 'toda_submit_compliance_document($1,$2,$3,$4)', ['Driver Roster', own(PAX.P1.uid, 'r.csv'), 'r.csv', null]);
  check('a passenger is refused: ERR_NOT_TODA_ADMIN', r.ok && r.value.success === false && r.value.error_code === 'ERR_NOT_TODA_ADMIN', r);
  r = await rpc(ID.T2_AUTH, 'toda_submit_compliance_document($1,$2,$3,$4)', ['Driver Roster', own(ID.T2_AUTH, 'other.csv'), 'other.csv', null]);
  check('the other TODA\'s administrator changes only the other TODA\'s own data: TODA2 is Active, so its file is a new VERSION (the registration file is never replaced after accreditation, D-P9) and TODA1\'s row is untouched',
    r.ok && r.value.success === true && (await toda()).accredited_drivers_url === own(ID.T_AUTH, 'roster.xlsx')
    && (await one(`SELECT accredited_drivers_url FROM toda WHERE toda_id = '${ID.TODA2}'`)).accredited_drivers_url === null
    && (await q(`SELECT 1 FROM toda_roster_file_version WHERE toda_id = '${ID.TODA2}' AND kind = 'update' AND file_path = '${own(ID.T2_AUTH, 'other.csv')}'`)).length === 1, r);

  console.log('\nS4 an application the LGU returned for correction: view the reason, correct, resubmit');
  r = await rpc(ID.T_AUTH, 'toda_resubmit_application($1)', ['Nothing was returned.']);
  check('a TODA that was not returned has nothing to resubmit: ERR_NOT_RETURNED', r.ok && r.value.success === false && r.value.error_code === 'ERR_NOT_RETURNED', r);
  r = await rpc(LGU, 'return_toda_accreditation($1,$2)', [ID.TODA1, '[Barangay Clearance] The photo is blurred; send a clear copy.']);
  t = await toda();
  check('the LGU returns the application with a reason (existing behaviour)', r.ok && r.value.success === true && t.toda_status === 'Resubmission Required' && /blurred/.test(t.resubmission_reason) && (await admin()).account_status === 'Resubmission Required', { r, t });
  r = await rpc(ID.T_AUTH, 'toda_submit_compliance_document($1,$2,$3,$4)', ['Barangay Clearance', own(ID.T_AUTH, 'clearance-clear.pdf'), 'clearance-clear.pdf', day(220)]);
  t = await toda();
  check('the corrected clearance replaces the file; the application is NOT resubmitted yet (the TODA may still fix other documents)', r.ok && r.value.success === true && t.barangay_clearance_url === own(ID.T_AUTH, 'clearance-clear.pdf') && t.toda_status === 'Resubmission Required', { r, t });
  r = await rpc(PAX.P1.uid, 'toda_resubmit_application($1)', ['A passenger tries.']);
  check('a passenger cannot resubmit', r.ok && r.value.success === false && r.value.error_code === 'ERR_NOT_TODA_ADMIN', r);
  r = await rpc(ID.T2_AUTH, 'toda_resubmit_application($1)', ['The other TODA tries.']);
  check('the other TODA\'s administrator is refused (its own application was not returned)', r.ok && r.value.success === false && r.value.error_code === 'ERR_NOT_RETURNED', r);
  await internal(`UPDATE toda SET barangay_clearance_url = NULL WHERE toda_id = '${ID.TODA1}'`);
  r = await rpc(ID.T_AUTH, 'toda_resubmit_application($1)', ['No clearance on file.']);
  check('resubmitting without a Barangay Clearance on file is refused', r.ok && r.value.success === false && r.value.error_code === 'ERR_CLEARANCE_MISSING', r);
  await internal(`UPDATE toda SET barangay_clearance_url = '${own(ID.T_AUTH, 'clearance-clear.pdf')}' WHERE toda_id = '${ID.TODA1}'`);
  r = await rpc(ID.T_AUTH, 'toda_resubmit_application($1)', ['Replaced the blurred clearance with a clear scan.']);
  t = await toda();
  check('the TODA\'s administrator resubmits: Pending Verification again, the correction reason is cleared, the administrator account follows',
    r.ok && r.value.success === true && t.toda_status === 'Pending Verification' && t.account_status === 'Pending Verification' && t.resubmission_reason === null && (await admin()).account_status === 'Pending Verification', { r, t });
  const au = await q(`SELECT actor_id, actor_role, before_state, after_state, details FROM audit_log WHERE action_type = 'TODA_APPLICATION_RESUBMITTED' AND target_id = '${ID.TODA1}'`);
  check('one audit entry: the TODA administrator, the reason it was returned for, the new status and the note to the LGU',
    au.length === 1 && au[0].actor_id === ID.T_AUTH && au[0].before_state.toda_status === 'Resubmission Required' && /blurred/.test(au[0].before_state.resubmission_reason) && au[0].after_state.toda_status === 'Pending Verification' && /clear scan/.test(au[0].details), au);
  r = await rpc(ID.T_AUTH, 'toda_resubmit_application($1)', ['Again.']);
  check('a second resubmission is refused', r.ok && r.value.success === false && r.value.error_code === 'ERR_NOT_RETURNED', r);
  r = await rpc(LGU, 'approve_toda_accreditation($1,$2,$3,$4)', [ID.TODA1, 'BC-2026-014', new Date(Date.now() + 200 * 86_400_000).toISOString(), 'Clear copy checked.']);
  check('the resubmitted application is approvable by the LGU (it is back in the queue)', r.ok && r.value.success === true && (await toda()).toda_status === 'Active', r);

  console.log('\nS5 renewal: an Active TODA submits a renewed Barangay Clearance');
  r = await rpc(ID.T_AUTH, 'toda_submit_compliance_document($1,$2,$3,$4)', ['Barangay Clearance', own(ID.T_AUTH, 'renewed-2027.pdf'), 'renewed-2027.pdf', day(400)]);
  t = await toda();
  check('the new clearance is stored and marked as a renewal; the accreditation, certificate number and expiry are NOT touched',
    r.ok && r.value.success === true && r.value.renewal === true && t.renewal_submitted_at !== null && t.toda_status === 'Active' && t.certificate_number === 'BC-2026-014' && t.barangay_clearance_url === own(ID.T_AUTH, 'renewed-2027.pdf'), { r, t });
  let flags = await q(`SELECT status, details FROM admin_review_flag WHERE flag_type = 'TODA_RENEWAL_SUBMITTED' AND subject_id = '${ID.TODA1}'`);
  check('the LGU Dashboard gets ONE open flag that names the file and the declared date', flags.length === 1 && flags[0].status === 'Open' && flags[0].details.file_name === 'renewed-2027.pdf' && flags[0].details.declared_valid_until === day(400), flags);
  r = await rpc(ID.T_AUTH, 'toda_submit_compliance_document($1,$2,$3,$4)', ['Barangay Clearance', own(ID.T_AUTH, 'renewed-2027-b.pdf'), 'renewed-2027-b.pdf', day(420)]);
  flags = await q(`SELECT status, details FROM admin_review_flag WHERE flag_type = 'TODA_RENEWAL_SUBMITTED' AND subject_id = '${ID.TODA1}'`);
  check('uploading another copy updates that flag instead of adding a second one', flags.length === 1 && flags[0].details.file_name === 'renewed-2027-b.pdf', flags);
  r = await rpc(ID.T_AUTH, 'toda_submit_compliance_document($1,$2,$3,$4)', ['Driver Roster', own(ID.T_AUTH, 'roster2.xlsx'), 'roster2.xlsx', null]);
  check('a roster upload by an Active TODA is not a renewal and raises no flag', r.ok && r.value.renewal === false && (await q(`SELECT 1 FROM admin_review_flag WHERE flag_type = 'TODA_RENEWAL_SUBMITTED' AND subject_id = '${ID.TODA1}'`)).length === 1, r);
  check('the renewal is in the audit log with the actor and the unchanged-accreditation wording',
    (await q(`SELECT 1 FROM audit_log WHERE action_type = 'TODA_CLEARANCE_RENEWAL_SUBMITTED' AND target_id = '${ID.TODA1}' AND actor_id = '${ID.T_AUTH}' AND details LIKE '%accreditation is unchanged%'`)).length === 2);
  r = await rpc(LGU, 'approve_toda_accreditation($1,$2,$3,$4)', [ID.TODA1, 'BC-2027-003', new Date(Date.now() + 400 * 86_400_000).toISOString(), 'Renewal recorded.']);
  t = await toda();
  flags = await q(`SELECT status, resolution FROM admin_review_flag WHERE flag_type = 'TODA_RENEWAL_SUBMITTED' AND subject_id = '${ID.TODA1}'`);
  check('the LGU records the renewal: the new certificate and expiry are stored, the marker is cleared and the flag is resolved',
    r.ok && r.value.success === true && t.certificate_number === 'BC-2027-003' && t.renewal_submitted_at === null && flags.length === 1 && flags[0].status === 'Resolved' && /BC-2027-003/.test(flags[0].resolution), { r, t, flags });
  await rpc(ID.T_AUTH, 'toda_submit_compliance_document($1,$2,$3,$4)', ['Barangay Clearance', own(ID.T_AUTH, 'renewed-2028.pdf'), 'renewed-2028.pdf', day(700)]);
  check('a later renewal opens a NEW flag (the resolved one stays resolved)', (await q(`SELECT status FROM admin_review_flag WHERE flag_type = 'TODA_RENEWAL_SUBMITTED' AND subject_id = '${ID.TODA1}' ORDER BY created_at`)).map((x) => x.status).join(',') === 'Resolved,Open');

  console.log('\nS6 a deactivated or suspended TODA cannot submit anything');
  r = await rpc(LGU, 'deactivate_toda_accreditation($1,$2)', [ID.TODA1, 'The accreditation was withdrawn by ordinance.']);
  r = await rpc(ID.T_AUTH, 'toda_submit_compliance_document($1,$2,$3,$4)', ['Driver Roster', own(ID.T_AUTH, 'r3.xlsx'), 'r3.xlsx', null]);
  check('a deactivated TODA is refused: ERR_TODA_STATUS', r.ok && r.value.success === false && r.value.error_code === 'ERR_TODA_STATUS', r);
  r = await rpc(ID.T_AUTH, 'toda_declare_clearance_validity($1)', [day(100)]);
  check('... and cannot declare a date either', r.ok && r.value.success === false && r.value.error_code === 'ERR_TODA_STATUS', r);
  await internal(`UPDATE toda SET toda_status = 'Active', account_status = 'Active' WHERE toda_id = '${ID.TODA1}'`);
  await internal(`UPDATE toda_admin SET account_status = 'Suspended' WHERE toda_id = '${ID.TODA1}'`);
  r = await rpc(ID.T_AUTH, 'toda_submit_compliance_document($1,$2,$3,$4)', ['Driver Roster', own(ID.T_AUTH, 'r4.xlsx'), 'r4.xlsx', null]);
  check('a suspended administrator account is refused as if it administered nothing', r.ok && r.value.success === false && r.value.error_code === 'ERR_NOT_TODA_ADMIN', r);
  await internal(`UPDATE toda_admin SET account_status = 'Active' WHERE toda_id = '${ID.TODA1}'`);

  console.log('\nS7 a duplicate franchise / MTOP number is flagged for the LGU (Rule 3.2)');
  const v1 = await one(`SELECT count(*)::int AS n FROM driver_verification WHERE driver_id = '${DRIVERS.D1.id}'`);
  const v2 = await one(`SELECT count(*)::int AS n FROM driver_verification WHERE driver_id = '${DRIVERS.D2.id}'`);
  if (v1.n === 0) await internal(`INSERT INTO driver_verification (driver_id, submitted_franchise_number, verification_status) VALUES ('${DRIVERS.D1.id}', 'MTOP-2024-0001', 'Pending')`);
  else await internal(`UPDATE driver_verification SET submitted_franchise_number = 'MTOP-2024-0001' WHERE driver_id = '${DRIVERS.D1.id}'`);
  check('the first driver with that number is not flagged', (await q(`SELECT 1 FROM admin_review_flag WHERE flag_type = 'DUPLICATE_MTOP' AND subject_id = '${DRIVERS.D1.id}'`)).length === 0);
  if (v2.n === 0) await internal(`INSERT INTO driver_verification (driver_id, submitted_franchise_number, verification_status) VALUES ('${DRIVERS.D2.id}', 'mtop 2024 0001', 'Pending')`);
  else await internal(`UPDATE driver_verification SET submitted_franchise_number = 'mtop 2024 0001' WHERE driver_id = '${DRIVERS.D2.id}'`);
  const dup = await one(`SELECT scan_status, is_duplicate_mtop, is_duplicate_license FROM driver_verification WHERE driver_id = '${DRIVERS.D2.id}'`);
  const flag = await q(`SELECT assigned_role, details FROM admin_review_flag WHERE flag_type = 'DUPLICATE_MTOP' AND subject_id = '${DRIVERS.D2.id}'`);
  check('the same number written differently (case, spaces, dashes) on another driver is flagged: scan Flagged, is_duplicate_mtop, a DUPLICATE_MTOP flag for the LGU',
    dup.scan_status === 'Flagged' && dup.is_duplicate_mtop === true && flag.length === 1 && flag[0].assigned_role === 'lgu_admin' && flag[0].details.conflicting_driver_id === DRIVERS.D1.id, { dup, flag });
  check('a duplicate plate no longer sets the franchise flag by mistake', (await one(`SELECT is_duplicate_license FROM driver_verification WHERE driver_id = '${DRIVERS.D2.id}'`)).is_duplicate_license === false);

  console.log('\nS8 closed to the anonymous role, and the helper is not callable by users');
  for (const fn of ['toda_declare_clearance_validity(date)', 'toda_submit_compliance_document(text,text,text,date)', 'toda_resubmit_application(text)']) {
    const x = await one(`SELECT has_function_privilege('anon', 'public.${fn}', 'EXECUTE') AS a, has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') AS u`);
    check(`${fn}: not anon, but signed-in users`, x.a === false && x.u === true, x);
  }
  const h = await one(`SELECT has_function_privilege('anon', 'public._toda_of_caller()', 'EXECUTE') AS a, has_function_privilege('authenticated', 'public._toda_of_caller()', 'EXECUTE') AS u`);
  check('_toda_of_caller() is not callable by anon or signed-in users', h.a === false && h.u === false, h);

  console.log('\nS9 announcements: the author is stamped by the database, and each person reads only what is meant for them');
  await internal(`UPDATE toda_admin SET account_status = 'Active' WHERE toda_id IN ('${ID.TODA1}','${ID.TODA2}')`);
  const ins = (uid, toda, published, extra = '') => attempt(() => as(uid, (tx) => tx.query(
    `INSERT INTO announcement (title, message, urgency, is_published, toda_id${extra ? ', created_by' : ''}) VALUES ($1, 'Text of the notice.', 'Normal', ${published}, ${toda ? `'${toda}'` : 'NULL'}${extra ? `, '${extra}'` : ''}) RETURNING announcement_id, created_by`, ['notice ' + Math.random().toString(36).slice(2, 7)])));
  const t1admin = (await one(`SELECT admin_id FROM toda_admin WHERE toda_id = '${ID.TODA1}'`)).admin_id;
  let a = await ins(ID.T_AUTH, ID.TODA1, true, ID.T_AUTH);
  check('a TODA administrator can post (the login id the browser used to send no longer breaks the foreign key); the database writes the administrator id',
    a.ok && a.value.rows[0].created_by === t1admin, a);
  const todaPub = a.value.rows[0].announcement_id;
  a = await ins(ID.T_AUTH, ID.TODA1, false);
  const todaDraft = a.value.rows[0].announcement_id;
  a = await ins(LGU, null, true);
  check('an LGU Administrator\'s city-wide notice has no author id', a.ok && a.value.rows[0].created_by === null, a);
  const cityPub = a.value.rows[0].announcement_id;
  a = await ins(LGU, null, false);
  const cityDraft = a.value.rows[0].announcement_id;
  a = await ins(LGU, ID.TODA1, true);
  const lguToToda1 = a.value.rows[0].announcement_id;
  const seen = async (uid) => (await as(uid, (tx) => tx.query(`SELECT announcement_id FROM announcement`))).rows.map((x) => x.announcement_id);
  const mine = [todaPub, todaDraft, cityPub, cityDraft, lguToToda1];
  const only = (list) => mine.filter((id) => list.includes(id)).sort().join() ;
  const set = (...ids) => ids.sort().join();
  check('the LGU Administrator reads all five', only(await seen(LGU)) === set(...mine));
  check('the TODA\'s own administrator reads its published notice, its own draft, the city-wide published one and the LGU notice for it; not the city-wide draft',
    only(await seen(ID.T_AUTH)) === set(todaPub, todaDraft, cityPub, lguToToda1));
  check('the other TODA\'s administrator reads only the city-wide published notice', only(await seen(ID.T2_AUTH)) === set(cityPub));
  check('a driver of the first TODA reads its published notices and the city-wide one, not the draft', only(await seen(DRIVERS.D1.uid)) === set(todaPub, cityPub, lguToToda1));
  check('a driver of the other TODA reads only the city-wide published notice', only(await seen(DRIVERS.D3.uid)) === set(cityPub));
  check('a passenger reads only the city-wide published notice (a passenger belongs to no TODA)', only(await seen(PAX.P1.uid)) === set(cityPub));
  await as(ID.T_AUTH, (tx) => tx.query(`UPDATE announcement SET is_published = TRUE WHERE announcement_id = '${todaDraft}'`));
  check('publishing the draft makes it readable by that TODA\'s drivers', (await seen(DRIVERS.D1.uid)).includes(todaDraft));
  const anonRead = await attempt(() => s.anon(`SELECT 1 FROM announcement`));
  check('the anonymous role still reads nothing', !anonRead.ok || (anonRead.value.rows ?? []).length === 0, anonRead);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
