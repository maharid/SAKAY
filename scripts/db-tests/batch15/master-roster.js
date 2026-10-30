// Migration 20261031000005 (owner's request, decisions D-P9 / D11 - D13): the Master Roster is the one living record of a TODA's members, changed only through logged functions;
// the roster file submitted at registration stays as the evidence it is. Add / edit / mark as left / reinstate, one active entry per franchise number, no direct table writes,
// the source of every entry, "20 at registration, 22 now", file versions, and the roster check that knows who has left (the timing rule of Requirement A5 is unchanged).
// Whole migration chain on the local emulator (never Supabase).
const { setup, ID, AFF, attempt, check, summary, asUser } = require('../b4fixtures');

(async () => {
  const t = await setup(null);
  const { db, internal, one, q } = t;
  const T1 = ID.T_AUTH;
  const T2 = ID.T2_AUTH;
  const call = (uid, sql, args = []) => attempt(() => asUser(db, { uid }, (tx) => tx.query(`SELECT public.${sql} AS r`, args), { commit: true }).then((r) => r.rows[0].r));
  const asRows = (uid, sql, args = []) => attempt(() => asUser(db, { uid }, (tx) => tx.query(sql, args), { commit: true }));
  const roster = (toda) => q(`SELECT * FROM toda_roster_entry WHERE toda_id = '${toda}' ORDER BY created_at, member_name`);
  const entryOf = (toda, fr) => one(`SELECT * FROM toda_roster_entry WHERE toda_id = '${toda}' AND normalized_franchise = '${fr}' ORDER BY created_at DESC LIMIT 1`);
  const audits = (action, toda) => q(`SELECT * FROM audit_log WHERE action_type = '${action}'${toda ? ` AND target_id = '${toda}'` : ''} ORDER BY performed_at`);
  const add = (uid, name, fr, pl = 'PLT 001', mem = null) => call(uid, 'add_toda_roster_entry($1,$2,$3,$4)', [name, fr, pl, mem]);

  await internal(`DELETE FROM toda_roster_entry`);
  await internal(`UPDATE toda SET toda_status = 'Active', account_status = 'Active' WHERE toda_id IN ('${ID.TODA1}', '${ID.TODA2}')`);
  await internal(`UPDATE toda_admin SET account_status = 'Active'`);

  console.log('M1 adding a member: the database checks it and writes the audit entry');
  let r = await add(T1, '  Juan   dela Cruz ', ' fr-cal 001 ', 'abc 123', 'MEM-0007');
  check('a TODA administrator adds a member to their own roster', r.ok && r.value.success === true && r.value.entry.member_name === 'Juan dela Cruz', r);
  let e = await entryOf(ID.TODA1, 'FRCAL001');
  check('spaces are tidied; the franchise number is normalised for matching; the membership number, source and who added it are kept',
    e.franchise_number === 'fr-cal 001' && e.normalized_franchise === 'FRCAL001' && e.membership_number === 'MEM-0007' && e.source === 'manual' && e.added_by === T1 && e.status === 'Active' && e.left_at === null, e);
  check('the audit entry is written BY THE DATABASE, with the actor', (await audits('TODA_ROSTER_ENTRY_ADDED', ID.TODA1)).length === 1 && (await audits('TODA_ROSTER_ENTRY_ADDED', ID.TODA1))[0].actor_id === T1);
  const refuse = async (label, p, code) => { const x = await p; check(label, x.ok && x.value.success === false && x.value.error_code === code, x); };
  await refuse('the same franchise number written another way (FRCAL-001) is refused as a duplicate', add(T1, 'Someone Else', 'FRCAL-001'), 'ERR_ROSTER_DUPLICATE');
  await refuse('the plate number is required for a member you add yourself', add(T1, 'No Plate', 'FR-2', ''), 'ERR_ROSTER_PLATE');
  await refuse('the franchise number is required', add(T1, 'No Franchise', '---'), 'ERR_ROSTER_FRANCHISE');
  await refuse('a name of one letter is refused', add(T1, 'X', 'FR-3'), 'ERR_ROSTER_NAME');
  await refuse('a plate longer than 20 characters is refused', add(T1, 'Long Plate', 'FR-4', 'P'.repeat(21)), 'ERR_ROSTER_PLATE');
  await refuse('a membership number longer than 40 characters is refused', add(T1, 'Long Member', 'FR-5', 'PLT 5', 'M'.repeat(41)), 'ERR_ROSTER_MEMBERSHIP');
  await refuse('a passenger cannot add', add(ID.P_AUTH, 'Nobody', 'FR-6'), 'ERR_NOT_TODA_ADMIN');
  await refuse('the LGU administrator cannot add either (the TODA vouches for its members)', add(ID.L_AUTH, 'Nobody', 'FR-6'), 'ERR_NOT_TODA_ADMIN');
  r = await add(T2, 'Same Franchise Other TODA', 'FRCAL001');
  check('the same franchise number in ANOTHER TODA is allowed (the number is unique within a TODA)', r.ok && r.value.success === true && (await roster(ID.TODA2)).length === 1, r);
  await internal(`UPDATE toda SET toda_status = 'Suspended' WHERE toda_id = '${ID.TODA2}'`);
  await refuse('a TODA that is not Active cannot change its roster', add(T2, 'Suspended Member', 'FR-9'), 'ERR_TODA_NOT_ACTIVE');
  await internal(`UPDATE toda SET toda_status = 'Active' WHERE toda_id = '${ID.TODA2}'`);

  console.log('\nM2 no direct writes any more');
  const ins = await asRows(T1, `INSERT INTO toda_roster_entry(toda_id, member_name, franchise_number) VALUES ('${ID.TODA1}', 'Sneaky Insert', 'SNK-1')`);
  check('a TODA administrator cannot INSERT a roster row directly (no policy: the database refuses)', !ins.ok, ins.ok ? 'inserted' : ins.error);
  const upd = await asRows(T1, `UPDATE toda_roster_entry SET member_name = 'Sneaky Edit' WHERE toda_id = '${ID.TODA1}'`);
  const del = await asRows(T1, `DELETE FROM toda_roster_entry WHERE toda_id = '${ID.TODA1}'`);
  check('... nor UPDATE or DELETE one (no row is affected)', (!upd.ok || upd.value.rowCount === 0) && (!del.ok || del.value.rowCount === 0), { upd: upd.ok ? upd.value.rowCount : upd.error, del: del.ok ? del.value.rowCount : del.error });
  const lguIns = await asRows(ID.L_AUTH, `DELETE FROM toda_roster_entry`);
  check('... and the LGU administrator cannot delete rows either', !lguIns.ok || lguIns.value.rowCount === 0);
  const still = await roster(ID.TODA1);
  check('the roster is exactly as it was', still.length === 1 && still[0].member_name === 'Juan dela Cruz', still.map((x) => x.member_name));
  const own = await asRows(T1, `SELECT member_name FROM toda_roster_entry`);
  const other = await asRows(T1, `SELECT member_name FROM toda_roster_entry WHERE toda_id = '${ID.TODA2}'`);
  check('a TODA administrator still READS only their own roster', own.ok && own.value.rows.length === 1 && other.ok && other.value.rows.length === 0);

  console.log('\nM3 editing, with the membership number');
  const id1 = (await entryOf(ID.TODA1, 'FRCAL001')).entry_id;
  r = await call(T1, 'update_toda_roster_entry($1,$2,$3,$4)', [id1, 'Juan P. dela Cruz', 'FR-CAL-001', 'ABC 123']);
  e = await entryOf(ID.TODA1, 'FRCAL001');
  check('the 4-argument call of the earlier app still works, and leaves the membership number alone (NULL = unchanged)', r.ok && r.value.success === true && r.value.changed === true && e.member_name === 'Juan P. dela Cruz' && e.membership_number === 'MEM-0007', r);
  r = await call(T1, 'update_toda_roster_entry($1,$2,$3,$4,$5)', [id1, 'Juan P. dela Cruz', 'FR-CAL-001', 'ABC 123', 'MEM-0009']);
  check('a new membership number is saved', r.ok && r.value.success === true && (await entryOf(ID.TODA1, 'FRCAL001')).membership_number === 'MEM-0009', r);
  r = await call(T1, 'update_toda_roster_entry($1,$2,$3,$4,$5)', [id1, 'Juan P. dela Cruz', 'FR-CAL-001', 'ABC 123', '']);
  check('an empty text clears it', r.ok && r.value.success === true && (await entryOf(ID.TODA1, 'FRCAL001')).membership_number === null, r);
  await add(T1, 'Pedro Penduko', 'FR-CAL-002', 'XYZ 987');
  await refuse('editing a franchise number into another member\'s is refused', call(T1, 'update_toda_roster_entry($1,$2,$3,$4)', [id1, 'Juan P. dela Cruz', 'frcal002', 'ABC 123']), 'ERR_ROSTER_DUPLICATE');
  await refuse('another TODA\'s administrator cannot edit this entry (it looks missing)', call(T2, 'update_toda_roster_entry($1,$2,$3,$4)', [id1, 'Hijack', 'FR-CAL-001', 'ABC 123']), 'ERR_ROSTER_NOT_FOUND');
  r = await call(T1, 'update_toda_roster_entry($1,$2,$3,$4)', [id1, 'Juan P. dela Cruz', 'FR-CAL-001', 'ABC 123']);
  check('saving without a change says so and writes nothing', r.ok && r.value.success === true && r.value.changed === false);
  check('real changes are audited with before and after', (await audits('TODA_ROSTER_ENTRY_UPDATED', ID.TODA1)).length >= 2 && (await audits('TODA_ROSTER_ENTRY_UPDATED', ID.TODA1))[0].before_state.member_name === 'Juan dela Cruz');

  console.log('\nM4 a member who has left');
  const pedro = (await entryOf(ID.TODA1, 'FRCAL002')).entry_id;
  await refuse('marking as left needs a reason of at least 10 characters', call(T1, 'mark_toda_roster_entry_left($1,$2)', [pedro, 'left']), 'ERR_ROSTER_REASON');
  await refuse('another TODA\'s administrator cannot mark him', call(T2, 'mark_toda_roster_entry_left($1,$2)', [pedro, 'Not his TODA to change.']), 'ERR_ROSTER_NOT_FOUND');
  r = await call(T1, 'mark_toda_roster_entry_left($1,$2)', [pedro, 'Transferred to another TODA in Naujan.']);
  e = await one(`SELECT * FROM toda_roster_entry WHERE entry_id = '${pedro}'`);
  check('he is marked as left: status, when, why and by whom are kept; the row is NOT deleted', r.ok && r.value.success === true && e.status === 'Left' && e.left_at !== null && /Naujan/.test(e.left_reason) && e.left_by === T1, e);
  check('it is audited', (await audits('TODA_ROSTER_ENTRY_LEFT', ID.TODA1)).length === 1);
  await refuse('marking him again is refused', call(T1, 'mark_toda_roster_entry_left($1,$2)', [pedro, 'Marked twice by mistake here.']), 'ERR_ROSTER_LEFT');
  await refuse('a member who has left cannot be edited', call(T1, 'update_toda_roster_entry($1,$2,$3,$4)', [pedro, 'Pedro Penduko', 'FR-CAL-002', 'XYZ 987']), 'ERR_ROSTER_LEFT');
  r = await add(T1, 'Pedro Penduko (new unit)', 'FR-CAL-002', 'NEW 555');
  check('his franchise number can be given to a new member now (the uniqueness is among ACTIVE entries)', r.ok && r.value.success === true, r);
  await refuse('reinstating the old entry while another active member holds the number is refused', call(T1, 'reinstate_toda_roster_entry($1)', [pedro]), 'ERR_ROSTER_DUPLICATE');
  const newPedro = (await entryOf(ID.TODA1, 'FRCAL002'));
  await call(T1, 'mark_toda_roster_entry_left($1,$2)', [newPedro.entry_id, 'The unit was sold to somebody else.']);
  r = await call(T1, 'reinstate_toda_roster_entry($1)', [pedro]);
  const afterReinstate = await q(`SELECT entry_id, status, created_at FROM toda_roster_entry WHERE toda_id = '${ID.TODA1}' AND normalized_franchise = 'FRCAL002' ORDER BY created_at`);
  check('reinstating makes a NEW active entry and keeps the old one as history (so he counts from now, like any new entry)',
    r.ok && r.value.success === true && r.value.entry.status === 'Active' && r.value.entry.entry_id !== pedro && afterReinstate.filter((x) => x.status === 'Active').length === 1 && afterReinstate.some((x) => x.entry_id === pedro && x.status === 'Left'), afterReinstate);
  await refuse('an entry that is not marked as left cannot be reinstated', call(T1, 'reinstate_toda_roster_entry($1)', [r.value.entry.entry_id]), 'ERR_ROSTER_NOT_LEFT');

  console.log('\nM5 the import records where entries come from; "20 at registration, 22 now"');
  const rows20 = Array.from({ length: 20 }, (_, i) => ({ member_name: `Driver Number ${i + 1}`, franchise_number: `XENTRO-2026-${String(i + 1).padStart(3, '0')}` }));
  const imp = (uid, rows, source = null) => call(uid, 'import_toda_roster($1::jsonb,$2)', [JSON.stringify(rows), source]);
  await internal(`DELETE FROM toda_roster_entry WHERE toda_id = '${ID.TODA2}'`);
  r = await imp(T2, rows20);
  check('the FIRST import of a TODA is its registration file: 20 added, source registration_file', r.ok && r.value.success === true && r.value.added === 20 &&
    (await q(`SELECT 1 FROM toda_roster_entry WHERE toda_id = '${ID.TODA2}' AND source = 'registration_file'`)).length === 20, r);
  await add(T2, 'New Member One', 'XENTRO-2026-021', 'NEW 021');
  await add(T2, 'New Member Two', 'XENTRO-2026-022', 'NEW 022');
  let sum = await call(T2, 'get_toda_roster_summary()', []);
  check('the summary says "20 at registration, 22 now (+2 added later, 0 left)"', sum.ok && sum.value.from_registration_file === 20 && sum.value.active === 22 && sum.value.added_later === 2 && sum.value.left === 0, sum);
  const joe = (await entryOf(ID.TODA2, 'XENTRO2026003')).entry_id;
  await call(T2, 'mark_toda_roster_entry_left($1,$2)', [joe, 'Retired from driving this year.']);
  sum = await call(T2, 'get_toda_roster_summary()', []);
  check('after one member leaves: still 20 from the registration file, 21 active, 1 left', sum.value.from_registration_file === 20 && sum.value.active === 21 && sum.value.left === 1, sum);
  r = await imp(T2, [{ member_name: 'Imported Later', franchise_number: 'XENTRO-2026-023' }, { member_name: 'Driver Number 1', franchise_number: 'xentro-2026-001' }]);
  check('a LATER import is an updated file: source file_update, a franchise already active is skipped, nothing is edited or removed',
    r.ok && r.value.added === 1 && r.value.skipped_duplicate === 1 && (await entryOf(ID.TODA2, 'XENTRO2026023')).source === 'file_update', r);
  r = await imp(T2, [{ member_name: 'Joe Again', franchise_number: 'XENTRO-2026-003' }]);
  check('an import can bring back a franchise number whose member had left (a new entry)', r.ok && r.value.added === 1, r);
  r = await imp(T2, [{ member_name: 'Bad Source', franchise_number: 'BS-1' }], 'whatever');
  check('an unknown source is refused', r.ok && r.value.success === false && r.value.error_code === 'ERR_ROSTER_SOURCE', r);
  const other2 = await call(T1, 'get_toda_roster_summary($1)', [ID.TODA2]);
  check('another TODA\'s administrator cannot read this roster\'s summary; the LGU can', other2.ok && other2.value.found === false && (await call(ID.L_AUTH, 'get_toda_roster_summary($1)', [ID.TODA2])).value.active >= 21);

  console.log('\nM6 the registration file stays; a later file is a new version');
  await internal(`UPDATE toda SET accredited_drivers_url = '${T2}/reg_roster.csv' WHERE toda_id = '${ID.TODA2}'`);
  await internal(`DELETE FROM toda_roster_file_version WHERE toda_id = '${ID.TODA2}'`);
  await internal(`INSERT INTO toda_roster_file_version (toda_id, kind, file_path, file_name) VALUES ('${ID.TODA2}', 'registration', '${T2}/reg_roster.csv', 'reg_roster.csv')`);
  r = await call(T2, 'toda_submit_compliance_document($1,$2,$3,$4)', ['Driver Roster', `${T2}/new_roster.csv`, 'new_roster.csv', null]);
  const toda2 = await one(`SELECT accredited_drivers_url FROM toda WHERE toda_id = '${ID.TODA2}'`);
  const versions = await q(`SELECT kind, file_name FROM toda_roster_file_version WHERE toda_id = '${ID.TODA2}' ORDER BY uploaded_at`);
  check('an ACTIVE TODA\'s new roster file is a new version: the registration file stays as it is', r.ok && r.value.success === true && toda2.accredited_drivers_url === `${T2}/reg_roster.csv`
    && versions.length === 2 && versions[0].kind === 'registration' && versions[1].kind === 'update' && versions[1].file_name === 'new_roster.csv', { r, toda2, versions });
  check('the LGU is told it arrived (a flag for information) and it is audited', (await q(`SELECT 1 FROM admin_review_flag WHERE flag_type = 'TODA_ROSTER_UPDATED' AND subject_id = '${ID.TODA2}' AND status = 'Open'`)).length === 1);
  const swap = await asRows(T2, `UPDATE toda SET accredited_drivers_url = '${T2}/swapped.csv' WHERE toda_id = '${ID.TODA2}'`);
  check('the registration file cannot be swapped with a table update', !swap.ok && /Access Denied/.test(swap.error), swap.ok ? 'swapped' : swap.error);
  await internal(`UPDATE toda SET toda_status = 'Resubmission Required' WHERE toda_id = '${ID.TODA2}'`);
  r = await call(T2, 'toda_submit_compliance_document($1,$2,$3,$4)', ['Driver Roster', `${T2}/corrected.csv`, 'corrected.csv', null]);
  const afterFix = await q(`SELECT kind, file_name, superseded_at FROM toda_roster_file_version WHERE toda_id = '${ID.TODA2}' AND kind = 'registration' ORDER BY uploaded_at`);
  check('while the application is returned for correction the registration file IS replaced, and the earlier one is marked superseded',
    r.ok && r.value.success === true && (await one(`SELECT accredited_drivers_url FROM toda WHERE toda_id = '${ID.TODA2}'`)).accredited_drivers_url === `${T2}/corrected.csv`
    && afterFix.length === 2 && afterFix[0].superseded_at !== null && afterFix[1].file_name === 'corrected.csv', { r, afterFix });
  await internal(`UPDATE toda SET toda_status = 'Active' WHERE toda_id = '${ID.TODA2}'`);
  const reg = (await call(ID.L_AUTH, 'get_toda_roster_summary($1)', [ID.TODA2])).value;
  check('the summary lists the versions, newest first', reg.versions.length >= 3 && reg.versions[0].file_name === 'corrected.csv');

  console.log('\nM7 the roster check knows who has left (Requirement A5 unchanged: an entry counts only if it was there before the application)');
  await internal(`DELETE FROM driver_verification WHERE driver_id = '${ID.D1}'`);
  await internal(`INSERT INTO driver_verification(driver_id, submitted_license_number, submitted_franchise_number) VALUES ('${ID.D1}', 'L-D1', 'CHK-100')`);
  await add(T1, 'Check Member', 'CHK-100', 'CHK 100');
  const chk = (await entryOf(ID.TODA1, 'CHK100'));
  const verdict = async (submittedAt) => {
    await internal(`UPDATE driver_toda_affiliation SET submitted_at = '${submittedAt}' WHERE affiliation_id = '${AFF.D1_T1}'`);
    return (await one(`SELECT roster_matched, reason_code FROM public.affiliation_roster_check('${AFF.D1_T1}')`));
  };
  const iso = (d) => new Date(d).toISOString();
  const plus = (d, ms) => iso(new Date(d).getTime() + ms);
  check('an application made after he was added: on the roster (matched)', (await verdict(plus(chk.created_at, 1000))).reason_code === 'matched');
  check('an application made BEFORE he was added: added later (does not count)', (await verdict(plus(chk.created_at, -1000))).reason_code === 'entry_added_later');
  await call(T1, 'mark_toda_roster_entry_left($1,$2)', [chk.entry_id, 'Left the TODA and sold his tricycle.']);
  const left = await one(`SELECT left_at FROM toda_roster_entry WHERE entry_id = '${chk.entry_id}'`);
  const between = iso((new Date(chk.created_at).getTime() + new Date(left.left_at).getTime()) / 2);          // after he was added, before he left
  check('an application made while he was still a member STILL counts after he left (matched)', (await verdict(between)).reason_code === 'matched');
  const v = await verdict(plus(left.left_at, 1000));
  check('an application made after he left: entry_left (the franchise number is on the roster, but the member left)', v.roster_matched === false && v.reason_code === 'entry_left', v);
  check('an application made before he was ever added is still "added later", even though he has left since', (await verdict(plus(chk.created_at, -1000))).reason_code === 'entry_added_later');
  check('the screen\'s reader gives the same answers (get_affiliation_roster_matches)', (await asRows(T1, `SELECT reason_code FROM public.get_affiliation_roster_matches($1::uuid[])`, [[AFF.D1_T1]])).value.rows[0].reason_code === 'entry_added_later');
  await call(T1, 'reinstate_toda_roster_entry($1)', [chk.entry_id]);
  const back = await one(`SELECT created_at FROM toda_roster_entry WHERE toda_id = '${ID.TODA1}' AND normalized_franchise = 'CHK100' AND status = 'Active'`);
  const whileAway = iso((new Date(left.left_at).getTime() + new Date(back.created_at).getTime()) / 2);           // after he left, before he came back
  check('after he is reinstated an application made while he was away does NOT become "found" (he is a new entry, added after it)', (await verdict(whileAway)).reason_code === 'entry_added_later');

  console.log('\nM8 one active entry per franchise number, whatever path writes');
  const dup = await attempt(() => db.query(`INSERT INTO toda_roster_entry(toda_id, member_name, franchise_number, plate_number) VALUES ('${ID.TODA1}', 'Duplicate By Service', 'chk-100', 'DUP 1')`));
  check('even a service-level insert cannot create a second ACTIVE entry (unique index)', !dup.ok && /uq_toda_roster_active_franchise|duplicate key/.test(dup.error), dup.ok ? 'inserted' : dup.error);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
