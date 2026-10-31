// Migration 20261103000001 (Batch 3): the findings of an investigation are saved on the incident report by the database (who, when, audited), and the database - not the screen -
// refuses what the resolution steps forbid: findings before the report is taken, too-short findings and reasons, a person who is not the report's administrator, a report that is
// already decided, an outcome or a strike that does not fit. Whole migration chain on the local emulator (never Supabase).
const { setup, ID, attempt, check, summary, PAX } = require('../b11fixtures');

(async () => {
  const s = await setup();
  const { q, one } = s;
  const rpc = (uid, sql, args = []) => attempt(() => s.rpcAs(uid, `public.${sql}`, args));
  const record = (uid, id, notes, contacted = []) => rpc(uid, 'incident_record_investigation($1,$2,$3)', [id, notes, contacted]);
  const row = (id) => one(`SELECT * FROM incident_report WHERE incident_id = '${id}'`);
  const P1 = PAX.P1.uid;

  const b1 = await s.finished('P1', 'D1');
  const serious = (await s.file('P1', b1, 'Harassment')).value;
  const b2 = await s.finished('P1', 'D1');
  const standard = (await s.file('P1', b2, 'Rude Behavior')).value;

  console.log('S1 step 1 comes first: findings cannot be written on a report nobody has taken');
  let r = await record(s.LGU, serious.incident_id, 'Called the passenger and the driver; both agree on the time.');
  check('the LGU Administrator cannot record findings before taking the report (ERR_INCIDENT_NOT_TAKEN)', !r.ok && /ERR_INCIDENT_NOT_TAKEN/.test(r.error), r);
  check('...and nothing was written', (await row(serious.incident_id)).investigation_notes === null);
  r = await record(s.T1, standard.incident_id, 'The driver says the passenger was rude first.');
  check('the same for a TODA Administrator on a report still waiting for review', !r.ok && /ERR_INCIDENT_NOT_TAKEN/.test(r.error), r);

  console.log('\nS2 who may record');
  await rpc(s.LGU, 'incident_lgu_acknowledge($1)', [serious.incident_id]);
  r = await record(s.T1, serious.incident_id, 'A TODA must not write on an LGU report.');
  check('a TODA Administrator cannot write on a serious report: it is the LGU\'s (read only for the TODA)', !r.ok && /Access Denied/.test(r.error), r);
  r = await record(s.T2, standard.incident_id, 'Another TODA must not write on this report.');
  check('another TODA\'s administrator cannot write on a TODA1 report', !r.ok && /not assigned to you/.test(r.error), r);
  r = await record(P1, serious.incident_id, 'A passenger must not be able to do this.');
  check('a passenger cannot', !r.ok && /not assigned to you|Access Denied/.test(r.error), r);

  console.log('\nS3 what is refused, and what is saved');
  r = await record(s.LGU, serious.incident_id, 'too short');
  check('findings of fewer than 10 characters are refused (ERR_INCIDENT_NOTE)', !r.ok && /ERR_INCIDENT_NOTE/.test(r.error), r);
  r = await record(s.LGU, serious.incident_id, 'x'.repeat(4001));
  check('and more than 4000', !r.ok && /ERR_INCIDENT_NOTE/.test(r.error), r);
  r = await record(s.LGU, serious.incident_id, 'Spoke to the driver by phone.', ['Driver', 'The Mayor']);
  check('somebody who is not on the list of contacts is refused (ERR_INCIDENT_CONTACT)', !r.ok && /ERR_INCIDENT_CONTACT/.test(r.error), r);
  const beforeSave = await row(serious.incident_id);
  r = await record(s.LGU, serious.incident_id, '  Spoke to the driver and the passenger by phone; the driver confirmed the time.  ', ['Driver', 'Passenger']);
  let after = await row(serious.incident_id);
  check('the LGU Administrator who took the report saves its findings', r.ok && r.value.success === true, r);
  check('they are on the report: trimmed, who was contacted, who saved them and when', after.investigation_notes === 'Spoke to the driver and the passenger by phone; the driver confirmed the time.' && after.investigation_contacted.length === 2 && after.investigation_recorded_by !== null && after.investigation_recorded_at !== null, after);
  check('saving changes no status, outcome or clock', after.outcome === null && after.status === beforeSave.status && String(after.first_action_at) === String(beforeSave.first_action_at) && String(after.decision_due_at) === String(beforeSave.decision_due_at));
  let audit = await s.auditOf('INCIDENT_INVESTIGATION_RECORDED', serious.incident_id);
  check('the save is in the audit log', audit.length === 1, audit);
  await record(s.LGU, serious.incident_id, 'Second visit: the passenger sent a screenshot of the trip receipt.', ['Passenger']);
  audit = await s.auditOf('INCIDENT_INVESTIGATION_RECORDED', serious.incident_id);
  check('saving again replaces the findings, and the audit entry keeps what they were before', audit.length === 2 && JSON.stringify(audit.map((a) => a.before_state)).includes('confirmed the time'), audit.map((a) => a.before_state));

  console.log('\nS4 a TODA Administrator on its own report');
  await rpc(s.T1, 'incident_start_review($1)', [standard.incident_id]);
  r = await record(s.T1, standard.incident_id, 'The driver says the passenger was rude first; two other drivers agree.', ['Driver']);
  check('once the TODA has started the review it saves its findings', r.ok && r.value.success === true, r);

  console.log('\nS5 the database refuses the decisions the steps forbid (not only the screen)');
  r = await s.decide(s.LGU, serious.incident_id, 'UPHELD', 'short', null, null);
  check('a decision with findings under 10 characters is refused (ERR_INCIDENT_NOTE)', !r.ok && /ERR_INCIDENT_NOTE/.test(r.error), r);
  r = await s.decide(s.LGU, serious.incident_id, 'MAYBE', 'The investigation found the complaint to be true.', null, null);
  check('an outcome that is not on the list is refused (ERR_INCIDENT_OUTCOME)', !r.ok && /ERR_INCIDENT_OUTCOME/.test(r.error), r);
  r = await s.decide(s.LGU, serious.incident_id, 'NOT_UPHELD', 'The investigation did not find the complaint to be true.', 'DRV_FABRICATED_REPORT', null);
  check('a strike with an outcome that carries none is refused (ERR_INCIDENT_STRIKE_NOT_ALLOWED)', !r.ok && /ERR_INCIDENT_STRIKE_NOT_ALLOWED/.test(r.error), r);
  r = await s.decide(s.T1, serious.incident_id, 'UPHELD', 'A TODA must not decide a serious report.', null, null);
  check('a TODA Administrator cannot decide the LGU\'s report', !r.ok && /Access Denied/.test(r.error), r);
  r = await s.decide(s.LGU, serious.incident_id, 'UPHELD', 'The investigation found the complaint to be true; the driver admitted it.', null, null);
  check('the LGU decides it with findings', r.ok && r.value.success === true && r.value.outcome === 'UPHELD', r);
  r = await s.decide(s.LGU, serious.incident_id, 'NOT_UPHELD', 'Changing my mind is not allowed once decided.', null, null);
  check('a decided report cannot be decided again with another outcome (ERR_INCIDENT_ALREADY_DECIDED)', !r.ok && /ERR_INCIDENT_ALREADY_DECIDED/.test(r.error), r);
  r = await record(s.LGU, serious.incident_id, 'Findings added after the decision must be refused.');
  const decided = await row(serious.incident_id);
  check('findings cannot be changed after the decision', !r.ok && /ERR_INCIDENT_ALREADY_DECIDED/.test(r.error) && /passenger sent a screenshot/.test(decided.investigation_notes), { r, notes: decided.investigation_notes });

  summary();
})().catch((e) => { console.error(e); process.exit(1); });
