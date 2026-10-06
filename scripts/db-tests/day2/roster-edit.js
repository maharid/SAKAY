// Day 2: a TODA administrator edits an entry of the TODA's master roster (migration 20261014000001), and an edit never rewrites history:
// the roster match counts an entry only from the moment its franchise / plate number was last set.
const { freshDb, asUser, attempt, check, summary } = require('../tlib');
const { ID, seed } = require('../fixtures');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const db = await freshDb();
  await seed(db);
  const as = (uid, fn) => asUser(db, { uid }, fn, { commit: true });
  const rows = async (sql) => (await db.query(sql)).rows;
  const internal = (sql) => db.exec(`SELECT set_config('sakay.internal_context','true',false); ${sql}; SELECT set_config('sakay.internal_context','',false);`);
  const edit = async (uid, entry, name, franchise, plate = null) =>
    (await as(uid, (tx) => tx.query(`SELECT public.update_toda_roster_entry($1,$2,$3,$4) AS r`, [entry, name, franchise, plate]))).rows[0].r;
  const matched = async (aff) => (await rows(`SELECT public.affiliation_roster_matched('${aff}') AS m`))[0].m;
  const entryRow = async (id) => (await rows(`SELECT * FROM toda_roster_entry WHERE entry_id='${id}'`))[0];

  // TODA 1 roster: two entries. TODA 2 roster: one entry.
  await internal(`
    UPDATE toda SET toda_status='Active', certificate_expiry = now() + interval '1 year';
    INSERT INTO toda_roster_entry(toda_id, member_name, franchise_number, plate_number) VALUES
      ('${ID.TODA1}', 'Juan Delacruz',  'FR-001', 'AAA 111'),
      ('${ID.TODA1}', 'Pedro Santos',   'FR-002', 'BBB 222'),
      ('${ID.TODA2}', 'Maria Other',    'FR-900', 'ZZZ 999')`);
  const E = {};
  for (const r of await rows(`SELECT entry_id, member_name FROM toda_roster_entry`)) E[r.member_name] = r.entry_id;
  const JUAN = E['Juan Delacruz'], PEDRO = E['Pedro Santos'], MARIA = E['Maria Other'];

  console.log('T1 who can edit');
  let r = await edit(ID.D_AUTH, JUAN, 'Juan X', 'FR-001');
  check('a driver cannot', r.success === false && r.error_code === 'ERR_NOT_TODA_ADMIN', r);
  r = await edit(ID.P_AUTH, JUAN, 'Juan X', 'FR-001');
  check('a passenger cannot', r.success === false && r.error_code === 'ERR_NOT_TODA_ADMIN', r);
  const anon = await asUser(db, { role: 'anon' }, async (tx) => { try { await tx.query(`SELECT public.update_toda_roster_entry('${JUAN}','x','y',NULL)`); return 'allowed'; } catch (e) { return e.message; } }, { commit: true });
  check('an anonymous caller cannot call it at all', /permission denied/i.test(anon), anon);
  r = await edit(ID.T2_AUTH, JUAN, 'Hacked', 'FR-001');
  check('the administrator of ANOTHER TODA cannot edit it (it looks missing)', r.success === false && r.error_code === 'ERR_ROSTER_NOT_FOUND', r);
  check('and nothing changed', (await entryRow(JUAN)).member_name === 'Juan Delacruz');
  r = await edit(ID.T_AUTH, MARIA, 'Hacked', 'FR-900');
  check('TODA 1 cannot edit an entry of TODA 2', r.success === false && r.error_code === 'ERR_ROSTER_NOT_FOUND', r);
  r = await edit(ID.T_AUTH, '00000000-0000-0000-0000-00000000ffff', 'Nobody', 'FR-1');
  check('an unknown entry is refused', r.success === false && r.error_code === 'ERR_ROSTER_NOT_FOUND', r);

  console.log('\nT2 input checks');
  r = await edit(ID.T_AUTH, JUAN, 'J', 'FR-001');
  check('a one-letter name is refused', r.success === false && r.error_code === 'ERR_ROSTER_TEXT', r);
  r = await edit(ID.T_AUTH, JUAN, 'Juan Delacruz', '   ');
  check('an empty franchise number is refused', r.success === false && r.error_code === 'ERR_ROSTER_TEXT', r);
  r = await edit(ID.T_AUTH, JUAN, 'Juan Delacruz', '---');
  check('a franchise number with no letters or digits is refused', r.success === false && r.error_code === 'ERR_ROSTER_TEXT', r);
  r = await edit(ID.T_AUTH, JUAN, 'x'.repeat(121), 'FR-001');
  check('a name over 120 characters is refused', r.success === false && r.error_code === 'ERR_ROSTER_TEXT', r);
  r = await edit(ID.T_AUTH, JUAN, 'Juan Delacruz', 'fr 002');
  check("another entry's franchise number (written differently) is refused", r.success === false && r.error_code === 'ERR_ROSTER_DUPLICATE', r);
  check('nothing changed by any refused call', (await entryRow(JUAN)).franchise_number === 'FR-001' && (await entryRow(JUAN)).updated_at === null);

  console.log('\nT3 a correction of the name only');
  r = await edit(ID.T_AUTH, JUAN, 'Juan dela Cruz', 'FR-001', 'AAA 111');
  check('the name is corrected', r.success === true && r.changed === true && (await entryRow(JUAN)).member_name === 'Juan dela Cruz', r);
  let e = await entryRow(JUAN);
  check('updated_at is stamped, but the identifiers did not change (identifiers_changed_at stays empty)', e.updated_at !== null && e.identifiers_changed_at === null, e);
  check('the normalized name followed', e.normalized_name === 'juandelacruz', e.normalized_name);
  r = await edit(ID.T_AUTH, JUAN, 'Juan dela Cruz', 'FR-001', 'AAA 111');
  check('saving the same values again says nothing changed', r.success === true && r.changed === false, r);
  const audits = await rows(`SELECT before_state, after_state FROM audit_log WHERE action_type='TODA_ROSTER_ENTRY_UPDATED' AND target_id='${ID.TODA1}'`);
  check('exactly one audit row, with the before and the after', audits.length === 1 && audits[0].before_state.member_name === 'Juan Delacruz' && audits[0].after_state.member_name === 'Juan dela Cruz', audits);

  console.log('\nT4 a correction of the franchise or plate number');
  await wait(20);
  r = await edit(ID.T_AUTH, PEDRO, 'Pedro Santos', 'FR-002A', 'BBB 222');
  e = await entryRow(PEDRO);
  check('the franchise number is corrected and its change time is recorded', r.success === true && e.franchise_number === 'FR-002A' && e.identifiers_changed_at !== null, e);
  check('created_at did not move (it is still the original date)', new Date(e.created_at) < new Date(e.identifiers_changed_at), e);

  console.log('\nT5 an edit cannot make an old application look "found on the roster"');
  // D1 applied to TODA 1 AFTER the roster entries were made; D1's own franchise number is NEW-9 (no entry has it).
  await wait(20);
  await internal(`UPDATE driver SET franchise_number='NEW-9', plate_number='QQQ 777' WHERE driver_id='${ID.D1}';
                  UPDATE driver SET franchise_number='FR-001', plate_number='AAA 111' WHERE driver_id='${ID.D2}';
                  INSERT INTO driver_toda_affiliation(driver_id,toda_id,toda_endorsement_status,lgu_verification_status) VALUES
                    ('${ID.D1}','${ID.TODA1}','Submitted','Pending'),
                    ('${ID.D2}','${ID.TODA1}','Submitted','Pending')`);
  const A1 = (await rows(`SELECT affiliation_id FROM driver_toda_affiliation WHERE driver_id='${ID.D1}' AND toda_id='${ID.TODA1}'`))[0].affiliation_id;
  const A2 = (await rows(`SELECT affiliation_id FROM driver_toda_affiliation WHERE driver_id='${ID.D2}' AND toda_id='${ID.TODA1}'`))[0].affiliation_id;
  check('D1 (franchise NEW-9) is not on the roster', (await matched(A1)) === false);
  check('D2 (franchise FR-001) is on the roster', (await matched(A2)) === true);
  await wait(20);
  r = await edit(ID.T_AUTH, PEDRO, 'Pedro Santos', 'NEW-9', 'QQQ 777');
  check('the administrator edits an old entry to carry D1\'s franchise and plate number', r.success === true, r);
  check('D1 is STILL not matched (the edit is newer than the application)', (await matched(A1)) === false);
  await wait(20);
  r = await edit(ID.T_AUTH, JUAN, 'Juan D. dela Cruz', 'FR-001', 'AAA 111');
  check('a name-only edit of the entry that matches D2 succeeds', r.success === true && r.changed === true, r);
  check('D2 still matches (a name correction does not break a real match)', (await matched(A2)) === true);

  console.log('\nT6 a direct table update cannot hide a change either');
  await wait(20);
  await as(ID.T_AUTH, (tx) => tx.query(`UPDATE toda_roster_entry SET franchise_number='FR-001', plate_number='AAA 111' WHERE entry_id='${PEDRO}'`));
  e = await entryRow(PEDRO);
  check('the trigger stamped the change although the function was bypassed', e.normalized_franchise === 'FR001' && new Date(e.identifiers_changed_at) > new Date(e.created_at), e);
  const move = await as(ID.T_AUTH, (tx) => attempt(() => tx.query(`UPDATE toda_roster_entry SET toda_id='${ID.TODA2}' WHERE entry_id='${PEDRO}'`)));
  check('an entry cannot be moved to another TODA', !move.ok, move);
  const back = await as(ID.T_AUTH, (tx) => attempt(() => tx.query(`UPDATE toda_roster_entry SET created_at = created_at - interval '90 days' WHERE entry_id='${PEDRO}'`)));
  check('and cannot be back-dated', !back.ok, back);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
