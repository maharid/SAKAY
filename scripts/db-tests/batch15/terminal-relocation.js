// Migration 20261031000004 (panel comment, decision D-P4): the terminal is a pin on the map, inside Calapan City and not in the sea; moving it is a request the LGU
// decides in its own words. Registration refuses an unusable terminal, a TODA asks to move with a reason, the LGU approves or rejects with a reason, and the request
// and decision columns change only through those functions. Whole migration chain on the local emulator (never Supabase).
// This suite needs the sea layer (migration 20261031000003), which the shared fixtures otherwise remove: see fixtures.js.
process.env.KEEP_SEA_LAYER = '1';
const { setup, ID, PAX, attempt, check, summary } = require('../b11fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, as } = s;
  const LGU = ID.L_AUTH;
  const rpc = (uid, sql, args = []) => attempt(() => s.rpcAs(uid, `public.${sql}`, args));
  const toda = () => one(`SELECT * FROM toda WHERE toda_id = '${ID.TODA1}'`);
  const audits = (action) => q(`SELECT * FROM audit_log WHERE action_type = '${action}' AND target_id = '${ID.TODA1}' ORDER BY performed_at`);
  const CITY_HALL = { lat: 13.4115, lng: 121.1803 };
  const SOUTH_700M = { lat: 13.4052, lng: 121.1803 };          // inland, south of City Hall
  const SOUTH_1_5KM = { lat: 13.3980, lng: 121.1803 };
  const BAY = { lat: 13.45, lng: 121.19 };                     // Calapan Bay
  const PUERTO_GALERA = { lat: 13.5018, lng: 120.9546 };
  const request = (uid, p, name = 'Terminal beside the market, Brgy. Ilaya', reason = 'The old terminal lot was sold; we queue at the new lot now.') =>
    rpc(uid, 'request_terminal_relocation($1,$2,$3,$4,$5)', [ID.TODA1, p?.lat ?? null, p?.lng ?? null, name, reason]);

  await internal(`UPDATE toda SET toda_status = 'Active', account_status = 'Active', terminal_latitude = ${CITY_HALL.lat}, terminal_longitude = ${CITY_HALL.lng},
                                  terminal_relocation_status = 'Approved' WHERE toda_id = '${ID.TODA1}'`);
  await internal(`UPDATE toda_admin SET account_status = 'Active' WHERE toda_id = '${ID.TODA1}'`);

  console.log('S1 a usable terminal is a point inside the city and not in the sea');
  const problem = async (p) => (await one(`SELECT public._terminal_point_problem($1::float8, $2::float8) AS r`, [p?.lat ?? null, p?.lng ?? null])).r;
  check('City Hall and a point south of it are usable (no problem reported)', (await problem(CITY_HALL)) === null && (await problem(SOUTH_700M)) === null);
  check('a point in Calapan Bay is refused, with the reason in words', /sea|outside/i.test((await problem(BAY)) || ''), await problem(BAY));
  check('Puerto Galera (another municipality) is refused', /outside/i.test((await problem(PUERTO_GALERA)) || ''));
  check('no coordinates, or impossible ones, are refused: the terminal has to be a pin', /Pin on Map/.test((await problem(null)) || '') && /Pin on Map/.test((await problem({ lat: 95, lng: 121 })) || ''));

  console.log('\nS2 the TODA asks to move the terminal');
  let r = await request(ID.T_AUTH, SOUTH_700M);
  check('the TODA\'s own administrator can ask (a new place, 700 m away, with a reason)', r.ok && r.value.success === true, r);
  let t = await toda();
  check('the request is kept as pending, with the place, the reason and the time; the CURRENT terminal is untouched',
    t.terminal_relocation_status === 'Pending LGU Re-approval' && Number(t.pending_terminal_latitude) === SOUTH_700M.lat && /new lot/.test(t.pending_terminal_reason)
    && /market/.test(t.pending_terminal_location) && t.terminal_relocation_requested_at !== null && Number(t.terminal_latitude) === CITY_HALL.lat, t);
  check('the request is audited with who asked and why', (await audits('TODA_TERMINAL_RELOCATION_REQUESTED')).length === 1 && /new lot/.test((await audits('TODA_TERMINAL_RELOCATION_REQUESTED'))[0].details));
  r = await request(ID.T_AUTH, SOUTH_1_5KM, 'Terminal at the bus stop, Brgy. Sta. Isabel', 'The lot beside the market was also sold.');
  t = await toda();
  check('a newer request REPLACES the open one (one open request at a time)', r.ok && r.value.success === true && Number(t.pending_terminal_latitude) === SOUTH_1_5KM.lat && /bus stop/.test(t.pending_terminal_location), t);

  console.log('\nS3 what is refused');
  const refuse = async (label, call, code) => { const x = await call; check(label, x.ok && x.value.success === false && x.value.error_code === code, x); };
  await refuse('another TODA\'s administrator cannot move this TODA\'s terminal', request(ID.T2_AUTH, SOUTH_700M), 'ERR_NOT_YOUR_TODA');
  await refuse('a passenger cannot', request(PAX.P1.uid, SOUTH_700M), 'ERR_NOT_YOUR_TODA');
  await refuse('a pin in the bay is refused (ERR_TERMINAL_LOCATION)', request(ID.T_AUTH, BAY), 'ERR_TERMINAL_LOCATION');
  await refuse('a pin outside the city is refused', request(ID.T_AUTH, PUERTO_GALERA), 'ERR_TERMINAL_LOCATION');
  await refuse('no pin at all is refused', request(ID.T_AUTH, null), 'ERR_TERMINAL_LOCATION');
  await refuse('a pin 10 m from the current terminal is "the same place" (nothing to move)', request(ID.T_AUTH, { lat: CITY_HALL.lat + 0.00009, lng: CITY_HALL.lng }), 'ERR_RELOCATION_SAME_PLACE');
  await refuse('a reason under 10 characters is refused', request(ID.T_AUTH, SOUTH_700M, 'Terminal beside the market', 'moving'), 'ERR_RELOCATION_REASON');
  await refuse('no name for the new place is refused', request(ID.T_AUTH, SOUTH_700M, ' ', 'The old terminal lot was sold.'), 'ERR_RELOCATION_LOCATION_NAME');
  await internal(`UPDATE toda SET toda_status = 'Suspended' WHERE toda_id = '${ID.TODA1}'`);
  await refuse('a TODA that is not Active (here: suspended) cannot ask', request(ID.T_AUTH, SOUTH_700M), 'ERR_TODA_NOT_ACTIVE');
  await internal(`UPDATE toda SET toda_status = 'Active' WHERE toda_id = '${ID.TODA1}'`);

  console.log('\nS4 the request and the decision change only through the functions');
  for (const [label, sql] of [
    ['the pending place', `UPDATE toda SET pending_terminal_latitude = 13.40 WHERE toda_id = '${ID.TODA1}'`],
    ['the relocation status (a TODA cannot approve itself)', `UPDATE toda SET terminal_relocation_status = 'Approved' WHERE toda_id = '${ID.TODA1}'`],
    ['the LGU\'s decision note', `UPDATE toda SET terminal_relocation_decision_note = 'Approved by the LGU' WHERE toda_id = '${ID.TODA1}'`],
    ['the current terminal', `UPDATE toda SET terminal_latitude = 13.40 WHERE toda_id = '${ID.TODA1}'`],
  ]) {
    const d = await attempt(() => as(ID.T_AUTH, (tx) => tx.query(sql)));
    check(`a table update from the TODA's app cannot change ${label}`, !d.ok && /Access Denied/.test(d.error), d);
  }

  console.log('\nS5 the LGU decides, in its own words');
  r = await rpc(ID.T_AUTH, 'approve_terminal_relocation($1,$2)', [ID.TODA1, 'Approved by me, the TODA.']);
  check('a TODA administrator cannot approve (only the LGU)', r.ok && r.value.success === false && /Access Denied/.test(r.value.error) && (await toda()).terminal_relocation_status === 'Pending LGU Re-approval', r);
  r = await rpc(LGU, 'approve_terminal_relocation($1,$2)', [ID.TODA1, 'ok']);
  check('approving without the LGU\'s own words (under 10 characters) is refused: ERR_DECISION_NOTE', r.ok && r.value.success === false && r.value.error_code === 'ERR_DECISION_NOTE', r);
  check('...and the request is still open', (await toda()).terminal_relocation_status === 'Pending LGU Re-approval');
  r = await rpc(LGU, 'reject_terminal_relocation($1,$2)', [ID.TODA1, 'no']);
  check('rejecting without a reason is refused the same way', r.ok && r.value.success === false && r.value.error_code === 'ERR_DECISION_NOTE', r);
  r = await rpc(LGU, 'approve_terminal_relocation($1,$2)', [ID.TODA1, 'The new lot is on a public road and near the old terminal.']);
  t = await toda();
  check('the LGU approves with its reason: the terminal is now the requested place, the request is cleared',
    r.ok && r.value.success === true && Number(t.terminal_latitude) === SOUTH_1_5KM.lat && /bus stop/.test(t.service_coverage_area) && t.pending_terminal_latitude === null
    && t.pending_terminal_reason === null && t.terminal_relocation_status === 'Approved', t);
  check('the LGU\'s words and the time are kept on the TODA (the TODA reads them)', /public road/.test(t.terminal_relocation_decision_note) && t.terminal_relocation_decided_at !== null);
  check('the approval is audited with the old and the new place', (await audits('TODA_TERMINAL_RELOCATION_APPROVED')).length === 1 && /public road/.test((await audits('TODA_TERMINAL_RELOCATION_APPROVED'))[0].details));
  r = await rpc(LGU, 'approve_terminal_relocation($1,$2)', [ID.TODA1, 'Approving a second time, which must do nothing.']);
  check('approving again finds nothing pending', r.ok && r.value.success === false && /No pending/.test(r.value.error), r);

  r = await request(ID.T_AUTH, SOUTH_700M, 'Back at the first lot, Brgy. Ilaya', 'We could not keep the new lot.');
  r = await rpc(LGU, 'reject_terminal_relocation($1,$2)', [ID.TODA1, 'The first lot is on a private road with no tricycle access.']);
  t = await toda();
  check('the LGU rejects with its reason: the terminal stays, the request is cleared, the status says Rejected and the reason is kept',
    r.ok && r.value.success === true && Number(t.terminal_latitude) === SOUTH_1_5KM.lat && t.pending_terminal_latitude === null && t.terminal_relocation_status === 'Rejected' && /private road/.test(t.terminal_relocation_decision_note), t);
  check('the rejection is audited', (await audits('TODA_TERMINAL_RELOCATION_REJECTED')).length === 1);
  r = await rpc(LGU, 'reject_terminal_relocation($1,$2)', [ID.TODA1, 'Rejecting with nothing pending must do nothing.']);
  check('rejecting when nothing is pending is refused', r.ok && r.value.success === false && /No pending/.test(r.value.error), r);
  r = await request(ID.T_AUTH, SOUTH_700M, 'Back at the first lot, Brgy. Ilaya', 'A new request after a rejection is allowed.');
  t = await toda();
  check('after a rejection the TODA can ask again, and the old decision note is cleared', r.ok && r.value.success === true && t.terminal_relocation_decision_note === null && t.terminal_relocation_status === 'Pending LGU Re-approval', t);

  console.log('\nS6 registration refuses an unusable terminal');
  const newUid = (await one(`INSERT INTO auth.users (email) VALUES ('registrar@x.test') RETURNING id`)).id;
  const reg = (lat, lng, extra = {}) => attempt(() => as(newUid, (tx) => tx.query(
    `SELECT public.register_toda_with_admin($1,$2,$3,$4::date,$5::int,$6::int,$7::float8,$8::float8,$9,$10,$11,$12,$13,$14,$15,$16,$17::uuid) AS id`,
    [extra.name ?? 'New TODA', extra.acr ?? 'NEWT', 'REG-1', '2020-01-01', 10, 5, lat, lng, 'Terminal', 'Brgy X', 'Corridor', 'Pres Ident', 'new-admin@x.test', '+639171234567', 'path/clearance.pdf', 'path/list.csv', newUid])));
  let g = await reg(BAY.lat, BAY.lng);
  check('a terminal in the bay is refused at registration (ERR_TERMINAL_LOCATION)', !g.ok && /ERR_TERMINAL_LOCATION/.test(g.error), g.ok ? 'accepted' : g.error);
  g = await reg(PUERTO_GALERA.lat, PUERTO_GALERA.lng);
  check('so is one in another municipality', !g.ok && /ERR_TERMINAL_LOCATION/.test(g.error), g.ok ? 'accepted' : g.error);
  g = await reg(null, null);
  check('so are missing coordinates (the apps used to send a default city-centre pin when none was given)', !g.ok && /ERR_TERMINAL_LOCATION/.test(g.error), g.ok ? 'accepted' : g.error);
  check('nothing was created by the refused attempts', (await q(`SELECT 1 FROM toda WHERE toda_acronym = 'NEWT'`)).length === 0);
  g = await reg(SOUTH_700M.lat, SOUTH_700M.lng);
  check('a pin on land inside the city registers', g.ok && g.value.rows[0].id, g.ok ? '' : g.error);
  check('the policy-engine flag is not left switched on', (await one(`SELECT current_setting('sakay.internal_context', true) v`)).v !== 'true');

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
