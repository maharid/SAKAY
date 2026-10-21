// Migration 20261029000001 (LGU portal fixes, checklist Part A): the publication times of an announcement, the Barangay Clearance check at TODA approval, the LGU
// referral of an incident back to a TODA, and the two renewal reminders. Whole migration chain on the local emulator (never Supabase).
const { setup, ID, PAX, DRIVERS, attempt, check, summary } = require('../b11fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, as } = s;
  const LGU = ID.L_AUTH;
  const rpc = (uid, sql, args = []) => attempt(() => s.rpcAs(uid, `public.${sql}`, args));
  const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString();
  const t = (x) => new Date(x).getTime();

  console.log('S1 announcements: the database stamps when each one was published and unpublished');
  const ins = await attempt(async () => (await as(LGU, (tx) => tx.query(
    `INSERT INTO announcement (title, message, target_audience, urgency, is_published, toda_id, published_at, unpublished_at)
     VALUES ('Road work', 'Rizal St. is closed on Saturday.', 'All', 'Normal', TRUE, NULL, now() - interval '5 years', now() - interval '5 years') RETURNING *`))).rows[0]);
  const a1 = ins.value;
  check('an LGU administrator can publish a city-wide announcement', ins.ok && a1.toda_id === null, ins);
  check('published_at is the database\'s time (a time sent by the browser is ignored); unpublished_at is empty; updated_at is set',
    Date.now() - t(a1.published_at) < 60_000 && a1.unpublished_at === null && a1.updated_at !== null, a1);
  const un = (await as(LGU, (tx) => tx.query(`UPDATE announcement SET is_published = FALSE WHERE announcement_id = $1 RETURNING *`, [a1.announcement_id]))).rows[0];
  check('unpublishing stamps unpublished_at and keeps published_at', un.is_published === false && un.unpublished_at !== null && t(un.published_at) === t(a1.published_at), un);
  const ed = (await as(LGU, (tx) => tx.query(`UPDATE announcement SET title = 'Road work (moved)', published_at = now() - interval '9 years', unpublished_at = NULL WHERE announcement_id = $1 RETURNING *`, [a1.announcement_id]))).rows[0];
  check('editing the text changes updated_at only: the two publication times cannot be rewritten from the browser', ed.title === 'Road work (moved)' && ed.unpublished_at !== null && t(ed.published_at) === t(a1.published_at), ed);
  const re = (await as(LGU, (tx) => tx.query(`UPDATE announcement SET is_published = TRUE WHERE announcement_id = $1 RETURNING *`, [a1.announcement_id]))).rows[0];
  check('publishing again stamps a new published_at and clears unpublished_at', re.is_published === true && re.unpublished_at === null && t(re.published_at) >= t(a1.published_at), re);
  const draft = (await as(LGU, (tx) => tx.query(`INSERT INTO announcement (title, message, target_audience, is_published, toda_id) VALUES ('Draft', 'Not yet.', 'Driver', FALSE, NULL) RETURNING *`))).rows[0];
  check('a draft (saved unpublished) has no publication time yet', draft.published_at === null && draft.unpublished_at === null, draft);
  const pax = await attempt(() => as(PAX.P1.uid, (tx) => tx.query(`UPDATE announcement SET is_published = FALSE WHERE announcement_id = $1`, [a1.announcement_id])));
  const hidden = await q(`SELECT is_published FROM announcement WHERE announcement_id = '${a1.announcement_id}'`);
  check('a passenger cannot unpublish an announcement (no row changes)', hidden[0].is_published === true, { pax, hidden });

  console.log('\nS2 approving a TODA: a Barangay Clearance must be on file, the expiry must be in the future, only the LGU may approve');
  await internal(`UPDATE toda SET toda_status = 'Pending Verification', account_status = 'Pending Verification', barangay_clearance_url = NULL WHERE toda_id = '${ID.TODA1}'`);
  let r = await rpc(LGU, 'approve_toda_accreditation($1,$2,$3,$4)', [ID.TODA1, 'CERT-2026-001', day(365), 'ok']);
  check('no clearance on file: refused with ERR_CLEARANCE_MISSING and nothing changes', r.ok && r.value.success === false && r.value.error_code === 'ERR_CLEARANCE_MISSING', r);
  check('... the TODA stays pending and has no certificate number', (await one(`SELECT toda_status, certificate_number FROM toda WHERE toda_id = '${ID.TODA1}'`)).toda_status === 'Pending Verification');
  await internal(`UPDATE toda SET barangay_clearance_url = '${ID.TODA1}/clearance.pdf' WHERE toda_id = '${ID.TODA1}'`);
  r = await rpc(LGU, 'approve_toda_accreditation($1,$2,$3,$4)', [ID.TODA1, 'CERT-2026-001', day(-3), 'ok']);
  check('a clearance valid until a past date is refused', r.ok && r.value.success === false && /future/i.test(r.value.error), r);
  r = await rpc(LGU, 'approve_toda_accreditation($1,$2,$3,$4)', [ID.TODA1, '   ', day(365), 'ok']);
  check('a blank certificate number is refused', r.ok && r.value.success === false, r);
  r = await rpc(ID.T_AUTH, 'approve_toda_accreditation($1,$2,$3,$4)', [ID.TODA1, 'CERT-2026-001', day(365), 'ok']);
  check('a TODA administrator cannot approve its own TODA', r.ok && r.value.success === false && /Access Denied/.test(r.value.error), r);
  r = await rpc(LGU, 'approve_toda_accreditation($1,$2,$3,$4)', [ID.TODA1, 'CERT-2026-001', day(365), 'Documents complete.']);
  const toda = await one(`SELECT toda_status, certificate_number, certificate_expiry FROM toda WHERE toda_id = '${ID.TODA1}'`);
  check('with a clearance on file and a future valid-until date the approval works and stores the typed number and date',
    r.ok && r.value.success === true && toda.toda_status === 'Active' && toda.certificate_number === 'CERT-2026-001' && t(toda.certificate_expiry) > Date.now(), { r, toda });
  check('the approval is in the audit log with the acting administrator', (await q(`SELECT 1 FROM audit_log WHERE action_type = 'TODA_ACCREDITATION_APPROVED' AND target_id = '${ID.TODA1}' AND actor_id = '${LGU}'`)).length === 1);

  console.log('\nS3 incidents: the LGU Administrator refers a report back to the involved TODA (never a serious one)');
  const done = await s.finished('P1', 'D1');
  const rude = (await s.file('P1', done, 'Rude Behavior')).value;
  check('a Rude Behavior report starts with the driver\'s TODA', rude.routing === 'TODA' && rude.reported_toda_id === ID.TODA1, rude);
  r = await rpc(LGU, 'incident_refer_to_toda($1,$2)', [rude.incident_id, 'Already with the TODA, nothing to change.']);
  check('referring a report that is already with the TODA changes nothing', r.ok && r.value.unchanged === true, r);
  r = await s.escalate(LGU, rude.incident_id, 'The LGU takes this one over for now.');
  check('the LGU takes the report over (routing LGU)', r.ok && (await s.report(rude.incident_id)).routing === 'LGU', r);
  r = await rpc(ID.T_AUTH, 'incident_refer_to_toda($1,$2)', [rude.incident_id, 'A TODA administrator must not be able to do this.']);
  check('a TODA administrator cannot refer a report', !r.ok && /Access Denied/.test(r.error), r);
  r = await rpc(PAX.P1.uid, 'incident_refer_to_toda($1,$2)', [rude.incident_id, 'A passenger must not be able to do this either.']);
  check('a passenger cannot', !r.ok && /Access Denied/.test(r.error), r);
  r = await rpc(LGU, 'incident_refer_to_toda($1,$2)', [rude.incident_id, 'too short']);
  check('a reason shorter than 10 characters is refused', !r.ok && /ERR_INCIDENT_REASON/.test(r.error), r);
  r = await rpc(LGU, 'incident_refer_to_toda($1,$2)', ['00000000-0000-0000-0000-000000000099', 'There is no such report anywhere.']);
  check('an unknown report is refused', !r.ok && /ERR_INCIDENT_NOT_FOUND/.test(r.error), r);
  r = await rpc(LGU, 'incident_refer_to_toda($1,$2)', [rude.incident_id, 'The TODA can review the driver first; they know him.']);
  const after = await s.report(rude.incident_id);
  check('the referral puts the report back with the TODA: routing TODA, status Pending, a fresh first-action clock, no first action yet',
    r.ok && r.value.routing === 'TODA' && after.routing === 'TODA' && after.status === 'Pending' && after.first_action_at === null && after.first_action_due_at !== null && after.reported_toda_id === ID.TODA1, { r, after });
  check('the driver\'s TODA Administrator sees the report again, and may now decide it',
    (await s.visibleTo(s.T1)).includes(rude.incident_id) && (await s.decide(s.T1, rude.incident_id, 'NOT_UPHELD')).ok);
  check('the reporter is told, and the referral is in the audit log with the reason',
    (await s.noticesOf(PAX.P1.id, 'INCIDENT_REFERRED', rude.incident_id)).length === 1 && (await s.auditOf('INCIDENT_REFERRED_TO_TODA', rude.incident_id)).length === 1);
  r = await rpc(LGU, 'incident_refer_to_toda($1,$2)', [rude.incident_id, 'It was decided already, so this must be refused.']);
  check('a decided (closed) report cannot be referred', !r.ok && /ERR_INCIDENT_CLOSED/.test(r.error), r);
  const assault = (await s.file('P1', done, 'Physical Assault', 'He hit me with a helmet at the corner of the market.')).value;
  r = await rpc(LGU, 'incident_refer_to_toda($1,$2)', [assault.incident_id, 'Try to send an assault report to the TODA.']);
  check('a report of assault stays with the LGU (Rule 19.8)', !r.ok && /ERR_INCIDENT_SERIOUS/.test(r.error), r);

  console.log('\nS4 renewal reminders: a real notice, throttled, LGU only');
  await internal(`UPDATE driver SET license_expiry = CURRENT_DATE + 20, mtop_expiry = CURRENT_DATE + 40 WHERE driver_id = '${DRIVERS.D1.id}'`);
  r = await rpc(PAX.P1.uid, 'admin_send_driver_renewal_reminder($1)', [DRIVERS.D1.id]);
  check('a passenger cannot send a driver reminder', r.ok && r.value.success === false && r.value.error_code === 'ERR_NOT_LGU_ADMIN', r);
  r = await rpc(ID.T_AUTH, 'admin_send_driver_renewal_reminder($1)', [DRIVERS.D1.id]);
  check('a TODA administrator cannot either', r.ok && r.value.success === false && r.value.error_code === 'ERR_NOT_LGU_ADMIN', r);
  r = await rpc(LGU, 'admin_send_driver_renewal_reminder($1)', ['00000000-0000-0000-0000-000000000099']);
  check('an unknown driver is refused', r.ok && r.value.success === false && r.value.error_code === 'ERR_NOT_FOUND', r);
  r = await rpc(LGU, 'admin_send_driver_renewal_reminder($1)', [DRIVERS.D1.id]);
  const note = (await q(`SELECT title, message FROM notification WHERE driver_id = '${DRIVERS.D1.id}' AND notification_type = 'LGU_RENEWAL_REMINDER'`));
  check('the driver really receives a notice that names the two expiry dates', r.ok && r.value.success === true && note.length === 1 && /Driver's License valid until/.test(note[0].message) && /MTOP valid until/.test(note[0].message), { r, note });
  check('it is in the audit log', (await q(`SELECT 1 FROM audit_log WHERE action_type = 'DRIVER_RENEWAL_REMINDER_SENT' AND target_id = '${DRIVERS.D1.id}'`)).length === 1);
  r = await rpc(LGU, 'admin_send_driver_renewal_reminder($1)', [DRIVERS.D1.id]);
  check('a second reminder within 10 minutes is refused', r.ok && r.value.success === false && r.value.error_code === 'ERR_REMINDER_TOO_SOON', r);
  check('... and only one notice exists', (await q(`SELECT 1 FROM notification WHERE driver_id = '${DRIVERS.D1.id}' AND notification_type = 'LGU_RENEWAL_REMINDER'`)).length === 1);
  const driverNoteSeenByOtherDriver = await attempt(() => as(DRIVERS.D2.uid, (tx) => tx.query(`SELECT 1 FROM notification WHERE driver_id = '${DRIVERS.D1.id}'`)));
  check('another driver cannot read that notice', driverNoteSeenByOtherDriver.ok && driverNoteSeenByOtherDriver.value.rows.length === 0, driverNoteSeenByOtherDriver);

  r = await rpc(ID.T_AUTH, 'admin_send_toda_renewal_reminder($1)', [ID.TODA1]);
  check('a TODA administrator cannot send the TODA reminder', r.ok && r.value.success === false && r.value.error_code === 'ERR_NOT_LGU_ADMIN', r);
  r = await rpc(LGU, 'admin_send_toda_renewal_reminder($1)', [ID.TODA1]);
  const tnote = await q(`SELECT recipient_id, subject_id, message FROM notification WHERE notification_type = 'LGU_RENEWAL_REMINDER' AND recipient_id = 'toda_${ID.TODA1}'`);
  check('the TODA receives a notice (addressed to its administrators) that names the valid-until date', r.ok && r.value.success === true && tnote.length === 1 && /valid until/.test(tnote[0].message), { r, tnote });
  r = await rpc(LGU, 'admin_send_toda_renewal_reminder($1)', [ID.TODA1]);
  check('a second TODA reminder within 10 minutes is refused', r.ok && r.value.success === false && r.value.error_code === 'ERR_REMINDER_TOO_SOON', r);
  r = await rpc(LGU, 'admin_send_toda_renewal_reminder($1)', ['00000000-0000-0000-0000-000000000099']);
  check('an unknown TODA is refused', r.ok && r.value.success === false && r.value.error_code === 'ERR_NOT_FOUND', r);

  console.log('\nS5 closed to the anonymous role');
  for (const fn of ['incident_refer_to_toda(uuid,text)', 'admin_send_driver_renewal_reminder(uuid)', 'admin_send_toda_renewal_reminder(uuid)']) {
    const x = (await one(`SELECT has_function_privilege('anon', 'public.${fn}', 'EXECUTE') AS ok`)).ok;
    check(`${fn} cannot be executed by anon`, x === false, x);
  }

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
