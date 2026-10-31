// Migration 20261103000001 (Batch 3): in-app feedback is stored by the database (who wrote it comes from the account, one press is one feedback, a flood is refused, only the LGU
// reads everything) and the LGU administrator edits their own profile through a validated, audited function that cannot touch the account's status or login.
// Whole migration chain on the local emulator (never Supabase).
const { setup, ID, attempt, check, summary, PAX } = require('../b11fixtures');

(async () => {
  const s = await setup();
  const { q, one, as } = s;
  const rpc = (uid, sql, args = []) => attempt(() => s.rpcAs(uid, `public.${sql}`, args));
  const token = () => require('crypto').randomUUID();
  const send = (uid, app, rating, comment, t = token()) => rpc(uid, 'submit_app_feedback($1,$2,$3,$4)', [app, rating, comment, t]);
  const feedbackRows = () => q(`SELECT * FROM app_feedback ORDER BY created_at`);

  console.log('S1 feedback: who may send it, and what is stored');
  let r = await send(s.LGU, 'lgu-portal', 5, '  The new reports page is much clearer.  ');
  let rows = await feedbackRows();
  check('the LGU administrator sends a rating and a comment', r.ok && r.value.success === true && r.value.already_saved === false, r);
  check('it is stored with the role and name from the account, the portal, the rating and the trimmed comment', rows.length === 1 && rows[0].submitter_role === 'LGU Administrator' && rows[0].app === 'lgu-portal' && rows[0].rating === 5 && rows[0].comment === 'The new reports page is much clearer.' && rows[0].submitter_name.length > 0 && rows[0].status === 'New', rows);
  const t = token();
  r = await send(s.LGU, 'lgu-portal', null, 'A comment sent twice by a double click.', t);
  const again = await send(s.LGU, 'lgu-portal', null, 'A comment sent twice by a double click.', t);
  check('the same press twice (the same reference) is saved once and says so', r.ok && again.ok && again.value.already_saved === true && again.value.feedback_id === r.value.feedback_id && (await feedbackRows()).length === 2, { r, again });

  console.log('\nS2 what is refused');
  r = await send(s.LGU, 'lgu-portal', null, '   ');
  check('nothing to say: no rating and no comment (ERR_FEEDBACK_EMPTY)', !r.ok && /ERR_FEEDBACK_EMPTY/.test(r.error), r);
  r = await send(s.LGU, 'lgu-portal', 6, 'Too many stars.');
  check('a rating outside 1 to 5 (ERR_FEEDBACK_RATING)', !r.ok && /ERR_FEEDBACK_RATING/.test(r.error), r);
  r = await send(s.LGU, 'lgu-portal', 3, 'x'.repeat(1001));
  check('a comment over 1000 characters (ERR_FEEDBACK_LONG)', !r.ok && /ERR_FEEDBACK_LONG/.test(r.error), r);
  r = await send(s.LGU, 'driver-app', 3, 'Not a portal.');
  check('an app that is not a portal (ERR_FEEDBACK_APP)', !r.ok && /ERR_FEEDBACK_APP/.test(r.error), r);
  r = await send(s.LGU, 'toda-portal', 3, 'The wrong portal for this account.');
  check('the LGU cannot send as the TODA portal (the portal must match the account)', !r.ok && /ERR_FEEDBACK_APP/.test(r.error), r);
  r = await rpc(s.LGU, 'submit_app_feedback($1,$2,$3,$4)', ['lgu-portal', 3, 'No reference.', null]);
  check('no reference (ERR_FEEDBACK_TOKEN)', !r.ok && /ERR_FEEDBACK_TOKEN/.test(r.error), r);
  r = await send(PAX.P1.uid, 'lgu-portal', 5, 'A passenger cannot use the portals feedback.');
  check('a passenger is refused', !r.ok && /Access Denied/.test(r.error), r);
  const before = (await feedbackRows()).length;
  check('nothing refused was stored', before === 2, before);

  console.log('\nS3 a TODA administrator, and who reads what');
  r = await send(s.T1, 'toda-portal', 4, 'The audit log export is useful.');
  rows = await feedbackRows();
  const todaRow = rows.find((x) => x.submitter_role === 'TODA Administrator');
  check('a TODA administrator sends from the TODA portal, and its TODA is recorded', r.ok && todaRow && todaRow.toda_id === ID.TODA1 && todaRow.app === 'toda-portal', todaRow);
  const todaSees = (await as(s.T1, (tx) => tx.query(`SELECT * FROM app_feedback`))).rows;
  check('a TODA administrator reads only their own feedback', todaSees.length === 1 && todaSees[0].submitter_role === 'TODA Administrator', todaSees.length);
  const lguSees = (await as(s.LGU, (tx) => tx.query(`SELECT * FROM app_feedback`))).rows;
  check('the LGU Administrator reads all of it', lguSees.length === 3, lguSees.length);
  const direct = await attempt(() => as(s.T1, (tx) => tx.query(`INSERT INTO app_feedback (auth_user_id, client_token, app, submitter_role, submitter_name, comment) VALUES ('${ID.T_AUTH}', gen_random_uuid(), 'toda-portal', 'TODA Administrator', 'X', 'Direct insert.')`)));
  check('nobody inserts a row directly', !direct.ok, direct);
  const edit = await attempt(() => as(s.LGU, (tx) => tx.query(`UPDATE app_feedback SET comment = 'Changed' WHERE true`)));
  check('and nobody edits one', !edit.ok || (await q(`SELECT 1 FROM app_feedback WHERE comment = 'Changed'`)).length === 0, edit);

  console.log('\nS4 not a flood');
  for (let i = 0; i < 2; i += 1) await send(s.LGU, 'lgu-portal', 4, `Another note number ${i + 1}.`);
  r = await send(s.LGU, 'lgu-portal', 4, 'The fifth in the hour is the last.');
  const sixth = await send(s.LGU, 'lgu-portal', 4, 'The sixth must wait.');
  check('five in an hour are accepted and the sixth waits (ERR_FEEDBACK_RATE)', r.ok && !sixth.ok && /ERR_FEEDBACK_RATE/.test(sixth.error), { r, sixth: sixth.error });

  console.log('\nS5 the LGU administrator edits their own profile');
  const before2 = await one(`SELECT * FROM lgu_admin WHERE auth_user_id = '${ID.L_AUTH}'`);
  r = await rpc(s.LGU, 'update_my_lgu_profile($1,$2,$3,$4)', ["Maria Dela Cruz-Santos", 'City Transport Officer', 'City Transport Office, Calapan City', '+639171234567']);
  const after = await one(`SELECT * FROM lgu_admin WHERE auth_user_id = '${ID.L_AUTH}'`);
  check('a valid profile is saved', r.ok && r.value.success === true && after.full_name === 'Maria Dela Cruz-Santos' && after.position === 'City Transport Officer' && after.office_name === 'City Transport Office, Calapan City' && after.contact_number === '+639171234567', after);
  check('the account itself is untouched: status, login and e-mail', after.account_status === before2.account_status && after.auth_user_id === before2.auth_user_id && after.email === before2.email && after.admin_id === before2.admin_id, after);
  const audit = await s.auditOf('LGU_PROFILE_UPDATED', String(before2.admin_id));
  check('the change is in the audit log with what it was and what it became', audit.length === 1 && JSON.stringify(audit[0].before_state).includes(before2.full_name) && JSON.stringify(audit[0].after_state).includes('Maria Dela Cruz-Santos'), audit);
  r = await rpc(s.LGU, 'update_my_lgu_profile($1,$2,$3,$4)', ['Maria Dela Cruz-Santos', '', '', '']);
  const cleared = await one(`SELECT * FROM lgu_admin WHERE auth_user_id = '${ID.L_AUTH}'`);
  check('an empty position, office and number are cleared (not kept as empty text)', r.ok && cleared.position === null && cleared.office_name === null && cleared.contact_number === null, cleared);

  console.log('\nS6 what the database refuses');
  r = await rpc(s.LGU, 'update_my_lgu_profile($1,$2,$3,$4)', ['R2-D2 99', null, null, null]);
  check('a name with digits (ERR_PROFILE_NAME)', !r.ok && /ERR_PROFILE_NAME/.test(r.error), r);
  r = await rpc(s.LGU, 'update_my_lgu_profile($1,$2,$3,$4)', ['M', null, null, null]);
  check('a name of one letter', !r.ok && /ERR_PROFILE_NAME/.test(r.error), r);
  r = await rpc(s.LGU, 'update_my_lgu_profile($1,$2,$3,$4)', ['Maria Santos', null, null, '09171234567']);
  check('a number not in +639XXXXXXXXX form (ERR_PROFILE_PHONE)', !r.ok && /ERR_PROFILE_PHONE/.test(r.error), r);
  r = await rpc(s.LGU, 'update_my_lgu_profile($1,$2,$3,$4)', ['Maria Santos', 'P'.repeat(101), null, null]);
  check('a position over 100 characters (ERR_PROFILE_POSITION)', !r.ok && /ERR_PROFILE_POSITION/.test(r.error), r);
  r = await rpc(s.LGU, 'update_my_lgu_profile($1,$2,$3,$4)', ['Maria Santos', null, 'O'.repeat(151), null]);
  check('an office over 150 characters (ERR_PROFILE_OFFICE)', !r.ok && /ERR_PROFILE_OFFICE/.test(r.error), r);
  r = await rpc(s.T1, 'update_my_lgu_profile($1,$2,$3,$4)', ['Not An Admin', null, null, null]);
  check('a TODA administrator cannot use it', !r.ok && /Access Denied/.test(r.error), r);
  r = await rpc(PAX.P1.uid, 'update_my_lgu_profile($1,$2,$3,$4)', ['Not An Admin', null, null, null]);
  check('a passenger cannot', !r.ok && /Access Denied/.test(r.error), r);
  const status = await attempt(() => as(s.LGU, (tx) => tx.query(`UPDATE lgu_admin SET account_status = 'Suspended' WHERE auth_user_id = '${ID.L_AUTH}'`)));
  check('an administrator cannot change their own status by a direct update either', !status.ok && /cannot change the status of their own account/.test(status.error), status);

  summary();
})().catch((e) => { console.error(e); process.exit(1); });
