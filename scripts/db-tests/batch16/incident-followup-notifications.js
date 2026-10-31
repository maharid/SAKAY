// Migration 20261102000001 (Batch 2): the incident lifecycle from filing to the LGU's decision with role-addressed notices, the TODA's follow-up (who, when, cooldown),
// the overdue state and its notices (once per event), the accreditation reminders (7 days, expired; once per accreditation period), per-administrator read state, the
// notices of the LGU's decisions on drivers, and the emergency declaration change. Whole migration chain on the local emulator (never Supabase).
const { setup, ID, DRIVERS, attempt, check, summary } = require('../b11fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, as } = s;
  const TODA1 = `toda_${ID.TODA1}`;
  const TODA2 = `toda_${ID.TODA2}`;
  const rpc = (uid, sql, args = []) => attempt(() => s.rpcAs(uid, `public.${sql}`, args));
  const notices = (recipient, type, subject) => q(`SELECT * FROM notification WHERE recipient_id = '${recipient}'${type ? ` AND notification_type = '${type}'` : ''}${subject ? ` AND subject_id = '${subject}'` : ''} ORDER BY sent_at, threshold_days`);
  const followups = (id) => q(`SELECT * FROM incident_followup WHERE incident_id = '${id}' ORDER BY sequence_no`);
  const sweep = () => internal(`SELECT public._incident_overdue_sweep()`);
  const b1 = await s.finished('P1', 'D1');

  console.log('S1 a report is filed: the party that has to act is told, nobody else');
  const rude = (await s.file('P1', b1, 'Rude Behavior')).value;
  check('a standard report about a TODA1 driver: TODA1 is told, once', (await notices(TODA1, 'INCIDENT_NEW_TODA', rude.incident_id)).length === 1);
  check('...and neither the LGU nor TODA2 is', (await notices('lgu_admin', 'INCIDENT_NEW_LGU', rude.incident_id)).length === 0 && (await q(`SELECT 1 FROM notification WHERE recipient_id = '${TODA2}' AND notification_type LIKE 'INCIDENT%'`)).length === 0);
  const b2 = await s.finished('P1', 'D1');
  const serious = (await s.file('P1', b2, 'Harassment')).value;
  check('a serious report goes straight to the LGU: the LGU is told, the TODA is not', (await notices('lgu_admin', 'INCIDENT_NEW_LGU', serious.incident_id)).length === 1 && (await notices(TODA1, 'INCIDENT_NEW_TODA', serious.incident_id)).length === 0);

  console.log('\nS2 the TODA has nothing to follow up while the report is its own; after it escalates, it can');
  let r = await rpc(s.T1, 'incident_send_followup($1,$2)', [rude.incident_id, 'Please look at this.']);
  check('a report that is with the TODA cannot be followed up with the LGU (ERR_NOT_WITH_LGU): the TODA acts on it', r.ok && r.value.success === false && r.value.error_code === 'ERR_NOT_WITH_LGU', r);
  r = await s.escalate(s.T1, rude.incident_id, 'The driver has had three reports this month; this needs the LGU.');
  check('the TODA escalates it', r.ok && r.value.routing === 'LGU', r);
  check('the LGU is told it was escalated, with the reason', (await notices('lgu_admin', 'INCIDENT_ESCALATED', rude.incident_id)).length === 1 && /three reports/.test((await notices('lgu_admin', 'INCIDENT_ESCALATED', rude.incident_id))[0].message));
  r = await rpc(s.T2, 'incident_send_followup($1,$2)', [rude.incident_id, 'Not my report.']);
  check('another TODA cannot follow up on it', r.ok && r.value.success === false && r.value.error_code === 'ERR_NOT_YOUR_INCIDENT', r);
  r = await rpc(PAXUID(), 'incident_send_followup($1,$2)', [rude.incident_id, 'x']);
  check('a passenger cannot', r.ok && r.value.success === false && r.value.error_code === 'ERR_NOT_TODA_ADMIN', r);
  r = await rpc(s.T1, 'incident_send_followup($1,$2)', [rude.incident_id, 'Could the LGU decide this one? The driver is still working.']);
  let fu = await followups(rude.incident_id);
  check('the follow-up is accepted and recorded: who, when, which report, what was said, number 1', r.ok && r.value.success === true && r.value.sequence_no === 1 && fu.length === 1 && fu[0].sent_by_name === 'Toda1 Admin' && fu[0].sent_at !== null && /still working/.test(fu[0].message) && fu[0].toda_id === ID.TODA1, { r, fu });
  check('the LGU gets one notice about it and the follow-up is audited', (await notices('lgu_admin', 'INCIDENT_FOLLOWUP', rude.incident_id)).length === 1 && (await s.auditOf('INCIDENT_FOLLOWUP_SENT', rude.incident_id)).length === 1);
  r = await rpc(s.T1, 'incident_send_followup($1,$2)', [rude.incident_id, 'Again!']);
  check('a second follow-up straight away is refused (cooldown), with the time it is allowed again', r.ok && r.value.success === false && r.value.error_code === 'ERR_FOLLOWUP_TOO_SOON' && r.value.next_allowed_at, r);
  check('...and no second notice was written', (await notices('lgu_admin', 'INCIDENT_FOLLOWUP', rude.incident_id)).length === 1 && (await followups(rude.incident_id)).length === 1);
  await internal(`UPDATE incident_followup SET next_allowed_at = now() - interval '1 minute' WHERE incident_id = '${rude.incident_id}'`);
  r = await rpc(s.T1, 'incident_send_followup($1,$2)', [rude.incident_id, null]);
  check('after the cooldown another can be sent: number 2, with its own notice', r.ok && r.value.success === true && r.value.sequence_no === 2 && (await notices('lgu_admin', 'INCIDENT_FOLLOWUP', rude.incident_id)).length === 2, r);

  console.log('\nS3 the LGU answers: the TODA is told');
  r = await rpc(s.T1, 'incident_lgu_acknowledge($1)', [rude.incident_id]);
  check('a TODA administrator cannot take a report on the LGU\'s behalf', !r.ok && /Access Denied/.test(r.error), r);
  r = await rpc(s.LGU, 'incident_lgu_acknowledge($1)', [rude.incident_id]);
  check('the LGU takes the report in hand: it is responsible, the TODA is told once, it is audited', r.ok && r.value.success === true && (await s.report(rude.incident_id)).reviewed_by_lgu !== null && (await notices(TODA1, 'INCIDENT_LGU_REVIEWING', rude.incident_id)).length === 1 && (await s.auditOf('INCIDENT_LGU_ACKNOWLEDGED', rude.incident_id)).length === 1, r);
  r = await rpc(s.LGU, 'incident_lgu_acknowledge($1)', [rude.incident_id]);
  check('taking it again changes nothing (no second notice)', r.ok && r.value.unchanged === true && (await notices(TODA1, 'INCIDENT_LGU_REVIEWING', rude.incident_id)).length === 1, r);
  r = await s.decide(s.LGU, rude.incident_id, 'NOT_UPHELD', 'Both parties were heard; the findings do not support the report.');
  check('the LGU decides: the TODA is told once, with the outcome', r.ok && (await notices(TODA1, 'INCIDENT_LGU_DECIDED', rude.incident_id)).length === 1 && /Not upheld/.test((await notices(TODA1, 'INCIDENT_LGU_DECIDED', rude.incident_id))[0].message), r);
  r = await rpc(s.T1, 'incident_send_followup($1,$2)', [rude.incident_id, 'x']);
  check('a decided report cannot be followed up', r.ok && r.value.success === false && r.value.error_code === 'ERR_INCIDENT_CLOSED', r);

  console.log('\nS4 overdue: the state is recorded and each side is told ONCE per event, however often the sweep runs');
  const b3 = await s.finished('P1', 'D1');
  const late = (await s.file('P1', b3, 'Unsafe Driving')).value;
  await internal(`UPDATE incident_report SET first_action_due_at = now() - interval '2 hours' WHERE incident_id = '${late.incident_id}'`);
  await sweep();
  await sweep();
  let row = await s.report(late.incident_id);
  check('the report is marked overdue (first action) with the time it became overdue', row.overdue_kind === 'first_action' && row.overdue_since !== null, row);
  check('the TODA (which has to act) is told once, the LGU is told once (the TODA has not acted)', (await notices(TODA1, 'INCIDENT_OVERDUE_TODA', late.incident_id)).length === 1 && (await notices('lgu_admin', 'INCIDENT_OVERDUE_LGU', late.incident_id)).length === 1);
  r = await s.escalate(s.T1, late.incident_id, 'I cannot reach the driver and the passenger wants a decision.');
  await internal(`UPDATE incident_report SET decision_due_at = now() - interval '3 hours' WHERE incident_id = '${late.incident_id}'`);
  await sweep();
  await sweep();
  row = await s.report(late.incident_id);
  check('once escalated and past the decision time the state becomes decision-overdue', row.overdue_kind === 'decision', row);
  check('the LGU is told once more (decision), and the TODA is told it is overdue at the LGU, once', (await notices('lgu_admin', 'INCIDENT_OVERDUE_LGU', late.incident_id)).length === 2 && (await notices(TODA1, 'INCIDENT_OVERDUE_FYI', late.incident_id)).length === 1);
  r = await rpc(s.T1, 'incident_send_followup($1,$2)', [late.incident_id, null]);
  check('an overdue report is followed up as an escalation', r.ok && r.value.success === true && r.value.kind === 'escalation', r);
  const intact = await s.report(rude.incident_id);
  check('a report that was never overdue is left alone', intact.overdue_kind === null);

  console.log('\nS5 TODA accreditation reminders: 7 days before, and again when it has expired, once per accreditation period');
  await internal(`UPDATE toda SET toda_status = 'Active', certificate_number = 'CERT-2025-01', certificate_expiry = now() + interval '6 days' WHERE toda_id = '${ID.TODA1}'`);
  await internal(`UPDATE toda SET toda_status = 'Active', certificate_expiry = now() + interval '200 days' WHERE toda_id = '${ID.TODA2}'`);
  await sweep();
  await sweep();
  let soon = await notices(TODA1, 'TODA_ACCREDITATION_EXPIRING');
  check('6 days left: the TODA is told once (it has 7 days or fewer), with the certificate and the date', soon.length === 1 && /CERT-2025-01/.test(soon[0].message) && /Account & Accreditation/.test(soon[0].message), soon);
  check('a TODA that is not near expiry is told nothing', (await notices(TODA2, 'TODA_ACCREDITATION_EXPIRING')).length === 0);
  await internal(`UPDATE toda SET certificate_expiry = now() - interval '1 day' WHERE toda_id = '${ID.TODA1}'`);
  await sweep();
  await sweep();
  check('expired: the TODA is told once, and the LGU is told once', (await notices(TODA1, 'TODA_ACCREDITATION_EXPIRED')).length === 1 && (await notices('lgu_admin', 'TODA_ACCREDITATION_EXPIRED_LGU')).length === 1);
  await internal(`UPDATE toda SET certificate_expiry = now() + interval '365 days' WHERE toda_id = '${ID.TODA1}'`);
  await sweep();
  check('after a renewal nothing new is sent', (await notices(TODA1, 'TODA_ACCREDITATION_EXPIRING')).length === 1);
  await internal(`UPDATE toda SET certificate_expiry = now() + interval '5 days' WHERE toda_id = '${ID.TODA1}'`);
  await sweep();
  check('the NEXT accreditation period (a new expiry date) gets its own reminder', (await notices(TODA1, 'TODA_ACCREDITATION_EXPIRING')).length === 2);

  console.log('\nS6 each audience reads only its own notices; a notice that cannot be written is recorded, not raised');
  const seen = (uid) => attempt(() => as(uid, (tx) => tx.query(`SELECT recipient_id FROM notification WHERE recipient_id IN ('lgu_admin', '${TODA1}', '${TODA2}')`)));
  const t1 = (await seen(s.T1)).value.rows.map((x) => x.recipient_id);
  const t2 = (await seen(s.T2)).value.rows.map((x) => x.recipient_id);
  check('TODA1\'s administrator reads TODA1\'s notices only', t1.length > 0 && t1.every((x) => x === TODA1), t1.slice(0, 3));
  check('TODA2\'s administrator reads TODA2\'s only (none of TODA1\'s incident or accreditation notices)', t2.every((x) => x === TODA2), t2.slice(0, 3));
  const bad = await one(`SELECT public._portal_notify('driver-123', 'X_TEST', 'Title', 'Message', 's1', 1) AS ok`);
  check('a notice to an address that is neither the LGU nor a TODA is not written (and raises nothing)', bad.ok === false);

  console.log('\nS7 read state is kept per administrator');
  const t1ids = (await notices(TODA1, 'INCIDENT_NEW_TODA')).map((n) => n.notification_id);
  const lguIds = (await notices('lgu_admin', 'INCIDENT_ESCALATED')).map((n) => n.notification_id);
  r = await rpc(s.T1, 'mark_portal_notifications_read($1::uuid[])', [t1ids]);
  check('a TODA administrator marks its own notice as read', r.ok && Number(r.value) === t1ids.length, r);
  r = await rpc(s.T1, 'mark_portal_notifications_read($1::uuid[])', [lguIds]);
  check('...but cannot mark the LGU\'s notices', r.ok && Number(r.value) === 0, r);
  r = await rpc(s.LGU, 'mark_portal_notifications_read($1::uuid[])', [t1ids]);
  check('the LGU cannot mark a TODA\'s notices either', r.ok && Number(r.value) === 0, r);
  const mine = await attempt(() => as(s.T1, (tx) => tx.query(`SELECT notification_id FROM portal_notification_read`)));
  const theirs = await attempt(() => as(s.LGU, (tx) => tx.query(`SELECT notification_id FROM portal_notification_read`)));
  check('each administrator sees only their own read marks', mine.value.rows.length === t1ids.length && theirs.value.rows.length === 0, { mine: mine.value.rows.length, theirs: theirs.value.rows.length });

  console.log('\nS8 the LGU\'s decision on a driver reaches the TODA');
  await internal(`INSERT INTO driver_toda_affiliation (driver_id, toda_id, toda_endorsement_status, lgu_verification_status, is_active_selection)
                  VALUES ('${DRIVERS.D2.id}', '${ID.TODA1}', 'Endorsed', 'Pending', FALSE) ON CONFLICT DO NOTHING`);
  const aff = await one(`SELECT affiliation_id FROM driver_toda_affiliation WHERE driver_id = '${DRIVERS.D2.id}' AND toda_id = '${ID.TODA1}'`);
  await internal(`UPDATE driver_toda_affiliation SET lgu_verification_status = 'Pending' WHERE affiliation_id = '${aff.affiliation_id}'`);
  await internal(`UPDATE driver_toda_affiliation SET lgu_verification_status = 'Approved' WHERE affiliation_id = '${aff.affiliation_id}'`);
  const decisions = await notices(TODA1, 'TODA_DRIVER_LGU_DECISION', aff.affiliation_id);
  check('the TODA is told the LGU verified its applicant, once', decisions.length === 1 && /verified/.test(decisions[0].title), decisions);

  console.log('\nS9 the emergency declaration: only the LGU changes it, and it is audited');
  r = await rpc(s.LGU, 'declare_calamity($1,$2,$3,$4)', ['Typhoon', 'Typhoon warning signal 3', 'Stay safe. Some trips may be suspended while the typhoon lasts.', 'CANCEL_STALL_NOSHOW']);
  check('the LGU declares an emergency', r.ok && r.value.success === true, r);
  r = await rpc(s.T1, 'update_calamity($1,$2,$3)', ['Changed by a TODA', 'A TODA administrator must not be able to do this.', null]);
  check('a TODA administrator cannot change it', !r.ok && /Access Denied/.test(r.error), r);
  r = await rpc(s.LGU, 'update_calamity($1,$2,$3)', ['Typhoon warning signal 4', 'Stay indoors. Strikes for cancellations stay paused until the warning is lifted.', new Date(Date.now() + 36 * 3600 * 1000).toISOString()]);
  const active = await one(`SELECT public.get_active_calamity() AS c`);
  check('the LGU changes the title, the message and the expected end; the app reads the new values', r.ok && r.value.success === true && active.c.title === 'Typhoon warning signal 4' && active.c.expected_end_at && active.c.updated_at, active);
  check('the change is audited with the old and the new values', (await q(`SELECT * FROM audit_log WHERE action_type = 'CALAMITY_UPDATED'`)).length === 1);
  r = await rpc(s.LGU, 'update_calamity($1,$2,$3)', ['Typhoon warning signal 4', 'Stay indoors.', new Date(Date.now() - 3600 * 1000).toISOString()]);
  check('an expected end in the past is refused', !r.ok && /ERR_CALAMITY_END/.test(r.error), r);

  console.log('\nS10 an announcement stores the kind of event it is about, and a declared emergency is one');
  const calamityNotice = await one(`SELECT a.event_type, a.title FROM announcement a JOIN calamity_declaration c ON c.announcement_id = a.announcement_id WHERE c.ended_at IS NULL`);
  check('the announcement a declaration publishes is an Emergency', calamityNotice && calamityNotice.event_type === 'Emergency', calamityNotice);
  check('changing the declaration changes the announcement people read', calamityNotice && calamityNotice.title === 'Typhoon warning signal 4', calamityNotice);
  const insertAnn = (uid, sqlCols, sqlVals, args = []) =>
    attempt(() => as(uid, (tx) => tx.query(`INSERT INTO announcement (title, message, is_published${sqlCols}) VALUES ('Road work on Rizal Street', 'Expect delays all day.', TRUE${sqlVals}) RETURNING *`, args)));
  r = await insertAnn(s.LGU, ', target_audience, event_type', ", 'All', $1", ['Road Closure']);
  check('the LGU saves an announcement with its event type, and it is kept', r.ok && r.value.rows[0].event_type === 'Road Closure', r);
  r = await insertAnn(s.LGU, '', '');
  check('an announcement written without one is a General announcement (older rows too)', r.ok && r.value.rows[0].event_type === 'General', r);
  r = await insertAnn(s.LGU, ', event_type', ', $1', ['Pizza Party']);
  check('a kind that is not on the list is refused by the database', !r.ok && /announcement_event_type_check|check constraint/i.test(r.error), r);
  r = await insertAnn(s.T1, ', toda_id, event_type', `, '${ID.TODA1}', $1`, ['Safety Advisory']);
  check('a TODA administrator saves one for its own drivers with its event type', r.ok && r.value.rows[0].event_type === 'Safety Advisory' && r.value.rows[0].toda_id === ID.TODA1, r);
  const own = r.ok ? r.value.rows[0].announcement_id : null;
  r = await attempt(() => as(s.T1, (tx) => tx.query(`UPDATE announcement SET event_type = 'Meeting Notice' WHERE announcement_id = $1 RETURNING event_type`, [own])));
  check('and changes it later (the icon follows)', r.ok && r.value.rows.length === 1 && r.value.rows[0].event_type === 'Meeting Notice', r);

  function PAXUID() { return require('../b11fixtures').PAX.P1.uid; }
  summary();
})().catch((e) => { console.error(e); process.exit(1); });
