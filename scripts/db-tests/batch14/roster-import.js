// Migration 20261030000004 (import_toda_roster): a TODA administrator fills the master roster from the rows of the roster file in one step.
//   * only their own TODA, a franchise number is required, a franchise already on the roster is never added twice or edited, at most 500 rows
//   * an import is dated when it happens (never back-dated), so it cannot make an earlier application look "found" (Requirement A5)
//   * one audit entry with the counts
// Whole migration chain on the local emulator (never Supabase).
const { setup, ID, attempt, check, summary, asUser } = require('../b4fixtures');
const { AFF } = require('../b4fixtures');

(async () => {
  const t = await setup(null);
  const { db, internal, one, q } = t;
  const imp = (uid, rowsOrJson) => asUser(db, { uid }, (tx) => tx.query(`SELECT public.import_toda_roster($1::jsonb) AS r`, [JSON.stringify(rowsOrJson)]), { commit: true }).then((r) => r.rows[0].r);
  const asRows = (uid, sql, args = []) => asUser(db, { uid }, (tx) => tx.query(sql, args)).then((r) => r.rows);
  const roster = (toda) => q(`SELECT member_name, franchise_number, plate_number, normalized_franchise, created_at, identifiers_changed_at FROM toda_roster_entry WHERE toda_id = '${toda}' ORDER BY member_name`);
  const T2 = ID.T2_AUTH;     // the administrator of TODA2
  const T1 = ID.T_AUTH;      // the administrator of TODA1
  const started = new Date(Date.now() - 5_000);

  await internal(`DELETE FROM toda_roster_entry`);
  await internal(`INSERT INTO toda_roster_entry(toda_id, member_name, franchise_number, plate_number) VALUES ('${ID.TODA2}', 'Already Here', 'T2-10', 'AAA 100')`);

  console.log('R1 an import adds the rows that can be used and says what it skipped');
  const first = await imp(T2, [
    { member_name: 'Juan Dela Cruz', franchise_number: 'T2-77', plate_number: 'JDC 777' },
    { member_name: '  Maria  Santos ', franchise_number: ' t2 78 ' },
    { member_name: 'Same As Existing', franchise_number: 't2-10' },                 // already on the roster (written differently)
    { member_name: 'Twice In File', franchise_number: 'T2-77' },                    // repeated inside the same upload
    { member_name: 'No Franchise', franchise_number: '' },
    { member_name: 'Punctuation Only', franchise_number: '---' },
    { member_name: 'X', franchise_number: 'T2-99' },                                // name too short
    { member_name: 'Long Plate', franchise_number: 'T2-98', plate_number: 'P'.repeat(21) },
    'not an object',
    { franchise_number: 'T2-97' },                                                  // no name
  ]);
  check('success, 2 added, 2 already on the roster, 6 skipped as unusable', first.success === true && first.added === 2 && first.skipped_duplicate === 2 && first.skipped_invalid === 6, first);
  const t2rows = await roster(ID.TODA2);
  check('TODA2\'s roster now holds the old entry and the two new ones, nothing else', t2rows.map((r) => r.member_name).join('|') === 'Already Here|Juan Dela Cruz|Maria Santos', t2rows.map((r) => r.member_name));
  const maria = t2rows.find((r) => r.member_name === 'Maria Santos');
  check('spaces are tidied and the franchise number is normalised for matching (" t2 78 " -> T278)', maria.franchise_number === 't2 78' && maria.normalized_franchise === 'T278' && maria.plate_number === null, maria);
  const old = t2rows.find((r) => r.member_name === 'Already Here');
  check('the entry that was already there is untouched (no second entry, no edit)', old.franchise_number === 'T2-10' && old.plate_number === 'AAA 100' && old.identifiers_changed_at === null, old);
  check('imported entries are dated NOW (the date-stamp trigger is not bypassed: nothing is back-dated)', t2rows.every((r) => new Date(r.created_at) >= started || r.member_name === 'Already Here'), t2rows.map((r) => r.created_at));
  check('TODA1\'s roster stays empty (the TODA comes from the signed-in administrator, never from the request)', (await roster(ID.TODA1)).length === 0);
  const audit = await q(`SELECT actor_role, details, after_state FROM audit_log WHERE action_type = 'TODA_ROSTER_IMPORTED' AND target_id = '${ID.TODA2}'`);
  check('ONE audit entry, by the TODA administrator, with the counts', audit.length === 1 && audit[0].actor_role === 'toda_admin' && audit[0].after_state.added === 2 && audit[0].after_state.skipped_duplicate === 2 && audit[0].after_state.skipped_invalid === 6, audit);

  console.log('\nR2 importing the same rows again changes nothing');
  const again = await imp(T2, [{ member_name: 'Juan Dela Cruz', franchise_number: 'T2-77' }, { member_name: 'Maria Santos', franchise_number: 'T2-78' }]);
  check('0 added, both already there', again.success === true && again.added === 0 && again.skipped_duplicate === 2 && again.skipped_invalid === 0, again);
  check('and no second audit entry is written for an import that added nothing', (await q(`SELECT 1 FROM audit_log WHERE action_type = 'TODA_ROSTER_IMPORTED'`)).length === 1);

  console.log('\nR3 only a TODA administrator, only the rows given');
  const row = [{ member_name: 'Someone Else', franchise_number: 'ZZ-1' }];
  for (const [who, uid] of [['the LGU administrator', ID.L_AUTH], ['a passenger', ID.P_AUTH], ['a driver', ID.D_AUTH]]) {
    const r = await imp(uid, row);
    check(`${who} is refused: ERR_NOT_TODA_ADMIN`, r.success === false && r.error_code === 'ERR_NOT_TODA_ADMIN', r);
  }
  const anon = await attempt(() => asUser(db, { role: 'anon' }, (tx) => tx.query(`SELECT public.import_toda_roster('[]'::jsonb)`)));
  check('an anonymous caller is refused', !anon.ok && /permission denied/.test(anon.error), anon.ok ? 'allowed' : anon.error);
  for (const [what, payload, code] of [['an empty list', [], 'ERR_ROSTER_IMPORT_EMPTY'], ['an object instead of a list', { member_name: 'x' }, 'ERR_ROSTER_IMPORT_EMPTY'],
    ['null', null, 'ERR_ROSTER_IMPORT_EMPTY'], ['501 rows', Array.from({ length: 501 }, (_, i) => ({ member_name: `Member ${i}`, franchise_number: `N-${i}` })), 'ERR_ROSTER_IMPORT_TOO_MANY']]) {
    const r = await asUser(db, { uid: T2 }, (tx) => tx.query(`SELECT public.import_toda_roster($1::jsonb) AS r`, [payload === null ? null : JSON.stringify(payload)]), { commit: true }).then((x) => x.rows[0].r);
    check(`${what}: ${code}`, r.success === false && r.error_code === code, r);
  }
  check('...and none of those refusals added anything', (await roster(ID.TODA2)).length === 3 && (await roster(ID.TODA1)).length === 0);
  const big = await imp(T1, Array.from({ length: 500 }, (_, i) => ({ member_name: `Member ${i}`, franchise_number: `N-${i}` })));
  check('500 rows is the limit and it is allowed', big.success === true && big.added === 500, big);

  console.log('\nR4 what an import means for an application (the roster check is by FRANCHISE; an entry counts only if it was there before the application)');
  await internal(`DELETE FROM toda_roster_entry WHERE toda_id = '${ID.TODA1}'`);
  await internal(`INSERT INTO driver_verification(driver_id, submitted_franchise_number) VALUES ('${ID.D3}', 'T2-77') ON CONFLICT DO NOTHING`);
  await internal(`UPDATE driver_verification SET submitted_franchise_number = 'T2-77' WHERE driver_id = '${ID.D3}'`);
  const reason = async () => (await asRows(T2, `SELECT * FROM public.get_affiliation_roster_matches($1::uuid[])`, [[AFF.D3_T2]]))[0];
  let r0 = await reason();
  check('D3 applied to TODA2 BEFORE the import, so the imported entry is "added later" and does not make the application look found',
    r0.roster_matched === false && r0.reason_code === 'entry_added_later' && r0.entry_member_name === 'Juan Dela Cruz', r0);
  await internal(`UPDATE driver_toda_affiliation SET submitted_at = clock_timestamp() + interval '1 minute' WHERE affiliation_id = '${AFF.D3_T2}'`);
  r0 = await reason();
  check('an application submitted after the import is matched by that entry', r0.roster_matched === true && r0.reason_code === 'matched' && r0.entry_member_name === 'Juan Dela Cruz', r0);

  await t.db.close();
  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
