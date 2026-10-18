// Batch 12 (Rule 28.4; T3, T4): the audit log is append-only for EVERY role (the service role and the owner's session included), the server stamps who and when, a TODA
// Administrator reads only their own entries, the log is paged and exported through the database (the export is itself audited), the two TODA decisions that wrote no audit entry
// now write one, and every administrative action of Batches 1 - 12 writes its entry with the acting administrator. Whole migration chain on the local emulator.
const { setup, ID, DRIVERS, PAX, attempt, check, summary } = require('../b12fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, as, svc, db } = s;
  const P1 = PAX.P1.id, P2 = PAX.P2.id, D1 = DRIVERS.D1.id;
  const lgu = (sql, args) => s.lguCall(sql, args);
  const lastAudit = async (action, target) => (await s.auditOf(action, target)).pop();

  console.log('S1 nobody changes or removes an entry (T3)');
  await internal(`SELECT public.record_policy_audit('TEST_ENTRY', 'T-1', 'Test entry', 'Test', 'An entry that must never change.', NULL, '{"a":1}'::jsonb)`);
  const entry = await one(`SELECT * FROM audit_log WHERE action_type = 'TEST_ENTRY'`);
  const total0 = Number((await one(`SELECT count(*)::int n FROM audit_log`)).n);
  const roles = [['the LGU Administrator', ID.L_AUTH], ['a TODA Administrator', ID.T_AUTH], ['a passenger', ID.P_AUTH], ['a driver', ID.D_AUTH]];
  for (const [who, uid] of roles) {
    const u = await attempt(() => as(uid, (tx) => tx.query(`UPDATE audit_log SET details = 'rewritten' WHERE log_id = '${entry.log_id}'`)));
    const dl = await attempt(() => as(uid, (tx) => tx.query(`DELETE FROM audit_log WHERE log_id = '${entry.log_id}'`)));
    const tr = await attempt(() => as(uid, (tx) => tx.query(`TRUNCATE audit_log`)));
    check(`${who} cannot UPDATE, DELETE or TRUNCATE the audit log`, !u.ok && !dl.ok && !tr.ok, { u: u.error, dl: dl.error, tr: tr.error });
  }
  const svcU = await attempt(() => svc((tx) => tx.query(`UPDATE audit_log SET details = 'rewritten' WHERE log_id = '${entry.log_id}'`)));
  const svcD = await attempt(() => svc((tx) => tx.query(`DELETE FROM audit_log WHERE log_id = '${entry.log_id}'`)));
  const svcT = await attempt(() => svc((tx) => tx.query(`TRUNCATE audit_log`)));
  check('the SERVICE ROLE cannot either (ERR_AUDIT_APPEND_ONLY)', [svcU, svcD, svcT].every((x) => !x.ok && /ERR_AUDIT_APPEND_ONLY/.test(x.error)), [svcU.error, svcD.error, svcT.error]);
  const ownU = await attempt(() => internal(`UPDATE audit_log SET details = 'rewritten' WHERE log_id = '${entry.log_id}'`));
  const ownD = await attempt(() => internal(`DELETE FROM audit_log WHERE log_id = '${entry.log_id}'`));
  const ownT = await attempt(() => internal(`TRUNCATE audit_log CASCADE`));
  check('...nor the owner\'s own database session: changing the log is a migration, on purpose', [ownU, ownD, ownT].every((x) => !x.ok && /ERR_AUDIT_APPEND_ONLY/.test(x.error)), [ownU.error, ownD.error, ownT.error]);
  const entry2 = await one(`SELECT * FROM audit_log WHERE log_id = '${entry.log_id}'`);
  check('the entry is exactly as written and no row was lost', entry2.details === entry.details && JSON.stringify(entry2.after_state) === JSON.stringify(entry.after_state) && Number((await one(`SELECT count(*)::int n FROM audit_log`)).n) === total0, entry2);
  check('the LGU\'s "FOR ALL" policy is gone and signed-in users hold no UPDATE / DELETE / TRUNCATE', (await q(`SELECT 1 FROM pg_policies WHERE tablename = 'audit_log' AND policyname = 'audit_log_manage_lgu'`)).length === 0
    && !(await one(`SELECT has_table_privilege('authenticated','public.audit_log','UPDATE') u, has_table_privilege('authenticated','public.audit_log','DELETE') d, has_table_privilege('authenticated','public.audit_log','TRUNCATE') t, has_table_privilege('anon','public.audit_log','SELECT') a`).then((x) => x.u || x.d || x.t || x.a)));
  // the one change that is let through: an administrator account is deleted and the foreign key sets the reference to NULL
  const adm = await one(`SELECT admin_id FROM toda_admin WHERE auth_user_id = '${ID.T2_AUTH}'`);
  await internal(`INSERT INTO audit_log (action_type, target_id, details, toda_admin_id) VALUES ('FK_TEST', 'fk-1', 'entry that names an administrator', '${adm.admin_id}')`);
  const del = await attempt(() => internal(`DELETE FROM toda_admin WHERE admin_id = '${adm.admin_id}'`));
  const fk = await one(`SELECT toda_admin_id, details FROM audit_log WHERE action_type = 'FK_TEST'`);
  check('deleting an administrator account still works: the entry stays, only the reference to the deleted administrator becomes NULL', del.ok && fk && fk.toda_admin_id === null && fk.details === 'entry that names an administrator', { del, fk });
  await internal(`INSERT INTO toda_admin (admin_id, auth_user_id, toda_id, full_name, email) VALUES ('${adm.admin_id}', '${ID.T2_AUTH}', '${ID.TODA2}', 'Toda2 Admin', 't2@x.com')`);

  console.log('\nS2 the server says who and when');
  const forged = await attempt(() => as(ID.T_AUTH, (tx) => tx.query(
    `INSERT INTO audit_log (action_type, target_id, details, actor_id, actor_role, lgu_admin_id, performed_at, created_at)
     VALUES ('FORGED_BY_TODA', 'x', 'I claim to be the LGU', '${ID.L_AUTH}', 'lgu_admin', (SELECT admin_id FROM lgu_admin LIMIT 1), '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z') RETURNING *`)));
  const fr = forged.value.rows[0];
  check('a TODA Administrator who sends another actor and a back-dated time: the stored actor is THEM and the time is the server\'s now',
    forged.ok && fr.actor_id === ID.T_AUTH && fr.actor_role === 'toda_admin' && fr.lgu_admin_id === null && Math.abs(Date.now() - new Date(fr.performed_at).getTime()) < 120000 && Math.abs(Date.now() - new Date(fr.created_at).getTime()) < 120000, fr);
  const pIns = await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`INSERT INTO audit_log (action_type, details) VALUES ('BY_PASSENGER', 'nope')`)));
  check('a passenger cannot write to the audit log at all', !pIns.ok, pIns);
  // the shape the portals send (recordAdminAuditAction): no actor, no time
  const portal = await attempt(() => as(ID.L_AUTH, (tx) => tx.query(`INSERT INTO audit_log (action_type, target_id, target_name, category, details) VALUES ('ANNOUNCEMENT_BROADCASTED', 'a-1', 'Road works', 'Announcement', 'Broadcast a notice.') RETURNING *`)));
  check('the portals\' note carries the signed-in LGU Administrator and the server\'s time without sending either', portal.ok && portal.value.rows[0].actor_id === ID.L_AUTH && portal.value.rows[0].actor_role === 'lgu_admin' && portal.value.rows[0].performed_at !== null, portal);

  console.log('\nS3 get_audit_log: the LGU reads everything, a TODA Administrator their own entries, nobody else anything');
  const call = (uid, args = []) => attempt(() => as(uid, (tx) => tx.query(`SELECT public.get_audit_log(${args.map((_, i) => '$' + (i + 1)).join(', ')}) AS r`, args)));
  const all = (await call(ID.L_AUTH)).value.rows[0].r;
  check('the LGU Administrator gets a page with a total, the rows newest first, and the real actor name', all.total >= 4 && all.rows.length === Math.min(all.total, 200) && new Date(all.rows[0].performed_at) >= new Date(all.rows[all.rows.length - 1].performed_at), { total: all.total });
  const mine = (await call(ID.T_AUTH)).value.rows[0].r;
  check('the TODA One Administrator gets only entries that carry their own administrator id', mine.rows.length >= 1 && mine.rows.every((x) => x.actor_role === 'toda_admin' && x.actor_name === 'Toda1 Admin'), mine.rows.map((x) => x.actor_name));
  const other = (await call(ID.T2_AUTH)).value.rows[0].r;
  check('the TODA Two Administrator sees none of TODA One\'s entries', other.rows.every((x) => !mine.rows.some((m) => m.log_id === x.log_id)) && other.total === 0, other.total);
  const pax = await call(ID.P_AUTH);
  const drv = await call(ID.D_AUTH);
  const anon = await attempt(() => s.asUser(db, { uid: null, role: 'anon' }, (tx) => tx.query(`SELECT public.get_audit_log()`), { commit: true }));
  check('a passenger, a driver and a visitor cannot read it', !pax.ok && /Access Denied/.test(pax.error) && !drv.ok && !anon.ok, [pax.error, drv.error, anon.error]);
  const row = all.rows.find((x) => x.actor_role === 'lgu_admin' && x.actor_name === 'LGU Admin');
  check('an LGU entry names the administrator by the account (LGU Admin), carries the Asia/Manila time as text and the UTC instant', Boolean(row) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.performed_at_manila), row);
  const manilaCheck = await one(`SELECT to_char('2026-10-16T16:30:00Z'::timestamptz AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD HH24:MI:SS') AS t`);
  check('(Asia/Manila is UTC+8: 16:30 UTC reads 00:30 the next day)', manilaCheck.t === '2026-10-17 00:30:00', manilaCheck);
  const byAction = (await call(ID.L_AUTH, [null, null, 'FORGED_BY_TODA'])).value.rows[0].r;
  check('the action filter narrows to that action', byAction.total === 1 && byAction.rows[0].action_type === 'FORGED_BY_TODA', byAction.total);
  const lit = (await call(ID.L_AUTH, [null, null, null, '%'])).value.rows[0].r;
  check('a search for "%" matches only text that really contains a percent sign (no wildcard)', lit.total === 0, lit.total);
  const found = (await call(ID.L_AUTH, [null, null, null, 'ROAD WORKS'])).value.rows[0].r;
  check('the search is case-insensitive over action, target and details', found.total === 1, found.total);
  const range = (await call(ID.L_AUTH, ['2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z'])).value.rows[0].r;
  check('a day range in the past finds nothing (the back-dated forgery was not kept)', range.total === 0, range.total);
  const paged = (await call(ID.L_AUTH, [null, null, null, null, 2, 1])).value.rows[0].r;
  check('paging: limit 2 offset 1 returns 2 rows and the same total', paged.rows.length === 2 && paged.total === all.total && paged.rows[0].log_id === all.rows[1].log_id, paged.total);
  const cap = (await call(ID.L_AUTH, [null, null, null, null, 100000, 0])).value.rows[0].r;
  check('a page is capped at 1000 rows', cap.limit === 1000, cap.limit);

  console.log('\nS4 an export is itself audited (and exports to PDF / Excel / CSV only)');
  let ex = await attempt(() => as(ID.L_AUTH, (tx) => tx.query(`SELECT public.record_audit_export('xlsx', 120, '{"search":"fare"}'::jsonb) AS r`)));
  const exAudit = await lastAudit('AUDIT_LOG_EXPORTED', 'AUDIT_LOG');
  check('the LGU Administrator\'s export is recorded: who, when, format, rows, filters', ex.ok && exAudit && exAudit.actor_id === ID.L_AUTH && exAudit.actor_role === 'lgu_admin' && exAudit.after_state.format === 'xlsx' && exAudit.after_state.rows === 120 && exAudit.after_state.filters.search === 'fare', exAudit);
  ex = await attempt(() => as(ID.T_AUTH, (tx) => tx.query(`SELECT public.record_audit_export('pdf', 3, NULL) AS r`)));
  check('a TODA Administrator\'s export is recorded too', ex.ok && (await s.auditOf('AUDIT_LOG_EXPORTED', 'AUDIT_LOG')).pop().actor_role === 'toda_admin', ex);
  ex = await attempt(() => as(ID.L_AUTH, (tx) => tx.query(`SELECT public.record_audit_export('docx', 3, NULL)`)));
  check('another format is refused', !ex.ok && /ERR_AUDIT_EXPORT_FORMAT/.test(ex.error), ex);
  ex = await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`SELECT public.record_audit_export('csv', 3, NULL)`)));
  check('a passenger cannot record an export', !ex.ok && /Access Denied/.test(ex.error), ex);

  console.log('\nS5 the two TODA decisions now check the caller and write their own audit entry');
  await internal(`UPDATE toda SET toda_acronym = 'ONETODA' WHERE toda_id = '${ID.TODA1}'`);
  let r = await attempt(() => as(ID.T_AUTH, (tx) => tx.query(`SELECT public.deactivate_toda_accreditation('${ID.TODA1}', 'I decline my own TODA')`)));
  check('a TODA Administrator cannot decline a TODA (the caller is checked inside)', !r.ok && /Access Denied/.test(r.error), r);
  r = await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`SELECT public.return_toda_accreditation('${ID.TODA1}', 'x')`)));
  check('a passenger cannot return a TODA application', !r.ok && /Access Denied/.test(r.error), r);
  r = await lgu(`deactivate_toda_accreditation('%', 'A wildcard must not match every TODA')`);
  check('a "%" no longer matches (the old ILIKE hit every TODA): "TODA record not found"', r.success === false && /not found/i.test(r.error), r);
  check('...and both TODAs are still Active', (await q(`SELECT toda_status FROM toda WHERE toda_id IN ('${ID.TODA1}','${ID.TODA2}')`)).every((x) => x.toda_status === 'Active'));
  r = await lgu(`return_toda_accreditation('onetoda', 'The barangay clearance is blurred; send a new photo.')`);
  const ret = await lastAudit('TODA_APPLICATION_RETURNED_FOR_CORRECTION', ID.TODA1);
  check('the LGU Administrator returns a TODA by its acronym: one entry with the actor, the reason, the status before and after', r.success === true && ret && ret.actor_id === ID.L_AUTH && ret.actor_role === 'lgu_admin' && ret.before_state.toda_status === 'Active' && ret.after_state.toda_status === 'Resubmission Required' && /blurred/.test(ret.details), { r, ret });
  r = await lgu(`deactivate_toda_accreditation('${ID.TODA1}', 'The accreditation was withdrawn by ordinance.')`);
  const dea = await lastAudit('TODA_APPLICATION_REJECTED', ID.TODA1);
  check('declining a TODA writes its entry as well', r.success === true && dea && dea.actor_id === ID.L_AUTH && dea.after_state.account_status === 'Deactivated', { r, dea });
  await internal(`UPDATE toda SET toda_status = 'Active', account_status = 'Active' WHERE toda_id = '${ID.TODA1}'; UPDATE toda_admin SET account_status = 'Active' WHERE toda_id = '${ID.TODA1}'`);
  r = await lgu(`approve_toda_accreditation('${ID.TODA1}', 'CERT-2026-777', now() + interval '2 years', 'Documents complete.')`);
  const appr = await lastAudit('TODA_ACCREDITATION_APPROVED', ID.TODA1);
  check('approving writes ONE entry with the actor and the before / after state', r.success === true && appr && appr.actor_id === ID.L_AUTH && appr.before_state && appr.after_state && (await s.auditOf('TODA_ACCREDITATION_APPROVED', ID.TODA1)).length === 1, appr);

  console.log('\nS6 every administrative action of Batches 1 - 12 writes its entry with the acting administrator (T4)');
  const stamped = (e, role = 'lgu_admin') => e && e.actor_id === ID.L_AUTH && e.actor_role === role && e.performed_at !== null && Math.abs(Date.now() - new Date(e.performed_at).getTime()) < 300000;
  r = await lgu(`admin_suspend_account('passenger', $1, 3, 'Repeated abusive language reviewed by the LGU.')`, [P1]);
  check('suspension: ACCOUNT_SUSPENDED_BY_ADMIN with the administrator, before and after', r.success === true && stamped(await lastAudit('ACCOUNT_SUSPENDED_BY_ADMIN', P1)) && (await lastAudit('ACCOUNT_SUSPENDED_BY_ADMIN', P1)).before_state !== null, r);
  r = await lgu(`admin_reinstate_account('passenger', $1, 'The appeal was granted after the review.', TRUE)`, [P1]);
  check('reinstatement: ACCOUNT_REINSTATED', r.success === true && stamped(await lastAudit('ACCOUNT_REINSTATED', P1)), r);
  r = await lgu(`issue_strike('passenger', $1, 'PAX_VEHICLE_DAMAGE', NULL, NULL, NULL, NULL, NULL, 'The photographs and the repair bill were reviewed.')`, [P2]);
  check('a strike: STRIKE_ISSUED', r.success === true && stamped(await lastAudit('STRIKE_ISSUED', P2)), r);
  r = await lgu(`admin_close_account('driver', $1, 'Permanent closure after the full review.', TRUE)`, [DRIVERS.D3.id]);
  check('closure (deactivation for good): ACCOUNT_PERMANENTLY_CLOSED', r.success === true && stamped(await lastAudit('ACCOUNT_PERMANENTLY_CLOSED', DRIVERS.D3.id)), r);
  const rt = await s.trip('P1', 'D1');
  await s.rate(rt, 'Passenger', 1);
  const rr = await s.ratingOf(rt, 'Passenger');
  await lgu(`admin_exclude_rating($1, TRUE, 'Retaliation found by the investigation.')`, [rr.rating_id]);
  check('rating exclusion: RATING_EXCLUDED', stamped(await lastAudit('RATING_EXCLUDED', rr.rating_id)));
  await lgu(`place_legal_hold('driver', $1, 'CASE-001', 'An investigation about the driver is open.')`, [D1]);
  check('a legal hold: LEGAL_HOLD_PLACED', stamped(await lastAudit('LEGAL_HOLD_PLACED', D1)));
  r = await lgu(`set_dispatch_setting('tier3_max_seconds', 420)`);
  const dsAudit = await q(`SELECT * FROM audit_log WHERE action_type = 'DISPATCH_SETTING_CHANGED' ORDER BY performed_at DESC LIMIT 1`);
  check('a dispatch setting: DISPATCH_SETTING_CHANGED', dsAudit.length === 1 && stamped(dsAudit[0]), r);
  // static: the newest definition of every administrative action reaches the audit writer (directly or through a helper)
  const fns = await q(`SELECT proname, prosrc FROM pg_proc WHERE pronamespace = 'public'::regnamespace`);
  const body = new Map(); for (const f of fns) body.set(f.proname, f.prosrc);
  const writes = (n) => /record_policy_audit\s*\(|INSERT\s+INTO\s+(public\.)?audit_log/i.test(body.get(n) || '');
  const calls = (n) => [...new Set([...(body.get(n) || '').matchAll(/(?:PERFORM|SELECT|:=|RETURN)\s+(?:public\.)?([a-z_0-9]+)\s*\(/gi)].map((m) => m[1].toLowerCase()))];
  const memo = {};
  const audited = (n, depth = 0) => { if (n in memo) return memo[n]; if (!body.has(n)) return (memo[n] = false); memo[n] = writes(n); if (!memo[n] && depth < 3) memo[n] = calls(n).some((c) => c !== n && body.has(c) && audited(c, depth + 1)); return memo[n]; };
  const adminActions = ['admin_close_account', 'admin_close_unfinished_trip', 'admin_confirm_flagged_violation', 'admin_confirm_integrity_flag', 'admin_correct_completed_trip', 'admin_end_trip_for_safety',
    'admin_exclude_rating', 'admin_reconcile_trip', 'admin_reinstate_account', 'admin_send_conduct_warning', 'admin_suspend_account', 'admin_void_strike', 'approve_terminal_relocation',
    'approve_toda_accreditation', 'deactivate_toda_accreditation', 'decide_exemption', 'declare_calamity', 'end_calamity', 'enact_fare_matrix', 'incident_decide', 'incident_escalate',
    'incident_lost_item_update', 'incident_start_review', 'issue_strike', 'place_legal_hold', 'release_legal_hold', 'reject_driver_affiliation', 'reject_terminal_relocation',
    'resolve_admin_review_flag', 'resolve_fare_dispute', 'return_driver_documents', 'return_toda_accreditation', 'send_toda_driver_reminder', 'set_dispatch_setting', 'set_strike_accrual_pause',
    'update_toda_roster_entry', 'verify_driver_affiliation', 'verify_driver_renewal', 'record_audit_export', 'confirm_deliberate_offline', 'report_deliberate_offline', 'escalate_fare_dispute'];
  const missing = adminActions.filter((n) => !body.has(n) || !audited(n));
  check(`all ${adminActions.length} administrative actions reach the audit writer in the same transaction (static check of the newest definitions)`, missing.length === 0, missing);
  const clientOnly = (await q(`SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosrc ~* 'INSERT\\s+INTO\\s+(public\\.)?audit_log' AND proname NOT IN ('record_policy_audit')`)).map((x) => x.proname);
  check('every direct INSERT into audit_log inside a function stamps its actor (or runs as the system)', clientOnly.every((n) => /actor_id|actor_role|system/i.test(body.get(n))), clientOnly.filter((n) => !/actor_id|actor_role|system/i.test(body.get(n))));

  const ok = summary();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
