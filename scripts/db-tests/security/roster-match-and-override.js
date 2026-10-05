// Roster Mismatch (20261010000005): ONE match for the endorsement and the TODA screen, and a required reason when the LGU approves
// an applicant who has an open Roster Mismatch flag (written to the flag and to the audit log).
// Whole migration chain, local emulator only (never Supabase).
//
//   BEFORE (chain through 20261010000004): the LGU approves an unmatched applicant with no reason, and the flag just disappears.
//   AFTER:  approval needs a reason; the screen's function and the endorsement agree on every case.
const { setup, ID, attempt, check, summary, asUser } = require('../b4fixtures');

const BEFORE = '20261010000004_reapplication_lgu_only.sql';
const mk = (n) => ({ AUTH: `22000000-0000-0000-0000-0000000000${n}`, ID: `b2000000-0000-0000-0000-0000000000${n}` });
const apps = (...ids) => JSON.stringify(ids.map((toda_id) => ({ toda_id })));

// name, franchise, plate as the driver SUBMITTED them
const CASES = [
  { key: 'franchise', name: 'Juan Franchise', fr: 'F-100', pl: 'XXX 111', expect: true,  why: 'franchise matches a roster entry (written differently: f 100)' },
  { key: 'plate',     name: 'Pedro Plate',    fr: '',      pl: 'ABC 123', expect: true,  why: 'plate matches a roster entry (written differently: abc-123)' },
  { key: 'nameonly',  name: 'Maria Roster',   fr: 'F-200', pl: 'DDD 222', expect: false, why: 'ONLY the name is on the roster: name alone never passes (the old screen said "found")' },
  { key: 'late',      name: 'Late Entry',     fr: 'F-300', pl: 'EEE 333', expect: false, why: 'the roster entry was created AFTER the application was submitted' },
  { key: 'othertoda', name: 'Other Roster',   fr: 'F-400', pl: 'FFF 444', expect: false, why: "the number is only on ANOTHER TODA's roster" },
  { key: 'nonumbers', name: 'No Numbers',     fr: '',      pl: '',        expect: false, why: 'no franchise and no plate to compare' },
];

async function world(until) {
  const t = await setup(until);
  const { db, internal, one } = t;
  const rpc = (uid, name, args = []) => asUser(db, { uid }, (tx) => {
    const ph = args.map((_, i) => `$${i + 1}`).join(',');
    return tx.query(`SELECT public.${name}(${ph}) AS r`, args);
  }, { commit: true }).then((r) => r.rows[0].r);
  const rows = (uid, sql, args = []) => asUser(db, { uid }, (tx) => tx.query(sql, args)).then((r) => r.rows);
  const D = Object.fromEntries(CASES.map((c, i) => [c.key, mk(`a${i}`)]));
  const all = CASES.map((c) => D[c.key]);
  await internal(`
    INSERT INTO auth.users(id,email) VALUES ${all.map((d, i) => `('${d.AUTH}','m${i}@x.com')`).join(',')};
    INSERT INTO public.driver(driver_id,auth_user_id,full_name,contact_number,account_status,availability_status,toda_id) VALUES
      ${CASES.map((c, i) => `('${D[c.key].ID}','${D[c.key].AUTH}','${c.name}','+63919000030${i}','Pending Verification','Offline','${ID.TODA1}')`).join(',')};
    INSERT INTO public.driver_verification(driver_id, submitted_license_number, submitted_franchise_number, submitted_plate_number) VALUES
      ${CASES.map((c, i) => `('${D[c.key].ID}','L-M${i}',${c.fr ? `'${c.fr}'` : 'NULL'},${c.pl ? `'${c.pl}'` : 'NULL'})`).join(',')};
    -- the roster of TODA1 as it was BEFORE the applications, a month ago
    INSERT INTO public.toda_roster_entry(toda_id, member_name, franchise_number, plate_number, created_at) VALUES
      ('${ID.TODA1}', 'Somebody Else', 'f 100', NULL, now() - interval '30 days'),
      ('${ID.TODA1}', 'Another Member', NULL, 'abc-123', now() - interval '30 days'),
      ('${ID.TODA1}', 'Maria Roster', 'ZZ-9', 'ZZZ 999', now() - interval '30 days'),
      ('${ID.TODA2}', 'Other Roster', 'F-400', 'FFF 444', now() - interval '30 days');`);
  for (const c of CASES) await rpc(D[c.key].AUTH, 'apply_driver_toda_affiliations', [apps(ID.TODA1)]);
  // the entry that is added AFTER the application (Requirement A5)
  await internal(`INSERT INTO public.toda_roster_entry(toda_id, member_name, franchise_number, plate_number) VALUES ('${ID.TODA1}', 'Late Entry', 'F-300', 'EEE 333')`);
  const A = {};
  for (const c of CASES) A[c.key] = (await one(`SELECT affiliation_id FROM driver_toda_affiliation WHERE driver_id='${D[c.key].ID}' AND toda_id='${ID.TODA1}'`)).affiliation_id;
  const flag = (a) => one(`SELECT status, resolution FROM admin_review_flag WHERE flag_type='ROSTER_MISMATCH' AND subject_id='${a}'`);
  return { t, rpc, rows, D, A, flag };
}

(async () => {
  console.log('BEFORE the migration');
  const b = await world(BEFORE);
  await b.rpc(ID.T_AUTH, 'endorse_driver_affiliation', [b.A.nameonly]);
  check('the unmatched applicant raised a Roster Mismatch flag', (await b.flag(b.A.nameonly))?.status === 'Open');
  const bv = await b.rpc(ID.L_AUTH, 'verify_driver_affiliation', [b.A.nameonly]);
  check('GAP: the LGU approved without any reason, and the flag was closed with a generic text', bv.success === true && /LGU Admin approved application\./.test((await b.flag(b.A.nameonly)).resolution), bv);
  await b.t.db.close();

  console.log('\nAFTER the migration (full chain)');
  const w = await world(null);
  const { t, rpc, rows, D, A, flag } = w;
  const { one, q } = t;

  console.log('M1 the screen\'s function and the endorsement agree on every case');
  const screen = Object.fromEntries((await rows(ID.T_AUTH, `SELECT * FROM public.get_affiliation_roster_matches($1::uuid[])`, [Object.values(A)])).map((r) => [r.affiliation_id, r.roster_matched]));
  for (const c of CASES) {
    check(`the screen: ${c.key} -> ${c.expect ? 'on the roster' : 'NOT on the roster'} (${c.why})`, screen[A[c.key]] === c.expect, screen[A[c.key]]);
  }
  for (const c of CASES) {
    const end = await rpc(ID.T_AUTH, 'endorse_driver_affiliation', [A[c.key]]);
    const f = await flag(A[c.key]);
    check(`the endorsement: ${c.key} -> roster_matched ${c.expect}, flag ${c.expect ? 'none' : 'Open'}`, end.success === true && end.roster_matched === c.expect && (c.expect ? !f : f && f.status === 'Open'), { end: end.roster_matched, f });
    check(`  ...and it is the SAME answer the screen gave`, end.roster_matched === screen[A[c.key]]);
  }

  console.log('\nM2 who may ask the screen function');
  const other = await rows(ID.T2_AUTH, `SELECT * FROM public.get_affiliation_roster_matches($1::uuid[])`, [Object.values(A)]);
  check("another TODA's administrator gets no row for TODA1's applications", other.length === 0, other);
  const lguSees = await rows(ID.L_AUTH, `SELECT * FROM public.get_affiliation_roster_matches($1::uuid[])`, [Object.values(A)]);
  check('the LGU administrator gets all of them', lguSees.length === CASES.length, lguSees.length);
  const drv = await rows(D.franchise.AUTH, `SELECT * FROM public.get_affiliation_roster_matches($1::uuid[])`, [Object.values(A)]);
  check('a driver gets nothing (not even their own)', drv.length === 0, drv);
  const pax = await rows(ID.P_AUTH, `SELECT * FROM public.get_affiliation_roster_matches(NULL)`);
  check('a passenger gets nothing', pax.length === 0, pax);
  const anon = await attempt(() => asUser(t.db, { role: 'anon' }, (tx) => tx.query(`SELECT * FROM public.get_affiliation_roster_matches(NULL)`)));
  check('an anonymous caller is refused', !anon.ok && /permission denied/.test(anon.error), anon.ok ? 'allowed' : anon.error);
  const internalFn = await attempt(() => asUser(t.db, { uid: ID.T_AUTH }, (tx) => tx.query(`SELECT public.affiliation_roster_matched('${A.franchise}')`)));
  check('the internal helper cannot be called directly by a signed-in user', !internalFn.ok && /permission denied/.test(internalFn.error), internalFn.ok ? 'allowed' : internalFn.error);

  console.log('\nM3 the LGU needs a reason to approve an applicant with an open Roster Mismatch flag');
  const v0 = await rpc(ID.L_AUTH, 'verify_driver_affiliation', [A.nameonly]);
  check('no reason: refused, and it says why', v0.success === false && v0.roster_override_required === true && /ERR_ROSTER_OVERRIDE_REQUIRED/.test(v0.error), v0);
  for (const bad of ['', '   ', 'ok', 'too short']) {
    const r = await rpc(ID.L_AUTH, 'verify_driver_affiliation', [A.nameonly, null, null, null, bad]);
    check(`reason ${JSON.stringify(bad)}: refused`, r.success === false && r.roster_override_required === true, r);
  }
  const unchanged = await one(`SELECT lgu_verification_status l FROM driver_toda_affiliation WHERE affiliation_id='${A.nameonly}'`);
  check('...the application is still waiting for the LGU, the flag still Open', unchanged.l === 'Pending' && (await flag(A.nameonly)).status === 'Open');
  const nAudit = await one(`SELECT count(*)::int n FROM audit_log WHERE action_type IN ('DRIVER_ROSTER_MISMATCH_OVERRIDDEN','DRIVER_AFFILIATION_STAGE2_VERIFIED') AND target_id='${A.nameonly}'`);
  check('...and the refusals wrote nothing to the audit log', nAudit.n === 0, nAudit);

  const REASON = 'Checked the LTO franchise record and the printed roster: the applicant is a member, the roster file is out of date.';
  const ok = await rpc(ID.L_AUTH, 'verify_driver_affiliation', [A.nameonly, null, null, null, `  ${REASON}  `]);
  check('with a reason: approved', ok.success === true && ok.roster_override_recorded === true, ok);
  const st = await one(`SELECT lgu_verification_status l FROM driver_toda_affiliation WHERE affiliation_id='${A.nameonly}'`);
  const drvRow = await one(`SELECT account_status s FROM driver WHERE driver_id='${D.nameonly.ID}'`);
  check('...the application is Approved and the driver Verified', st.l === 'Approved' && drvRow.s === 'Verified', { st, drvRow });
  const f = await flag(A.nameonly);
  check('...the flag is Resolved WITH the reason', f.status === 'Resolved' && f.resolution.includes(REASON) && /despite the roster mismatch/.test(f.resolution), f);
  const ov = await one(`SELECT actor_role, actor_id, details FROM audit_log WHERE action_type='DRIVER_ROSTER_MISMATCH_OVERRIDDEN' AND target_id='${A.nameonly}'`);
  check('...audit_log: DRIVER_ROSTER_MISMATCH_OVERRIDDEN by the LGU administrator, with the reason', !!ov && ov.actor_role === 'lgu_admin' && ov.actor_id === ID.L_AUTH && ov.details.includes(REASON), ov);
  const st2 = await one(`SELECT count(*)::int n FROM audit_log WHERE action_type='DRIVER_AFFILIATION_STAGE2_VERIFIED' AND target_id='${A.nameonly}'`);
  check('...next to the usual approval entry', st2.n === 1, st2);

  console.log('\nM4 an applicant who IS on the roster needs no reason, and a reason that is not needed is not recorded');
  const m = await rpc(ID.L_AUTH, 'verify_driver_affiliation', [A.franchise]);
  check('matched applicant: approved without a reason', m.success === true && m.roster_override_recorded === false, m);
  const m2 = await rpc(ID.L_AUTH, 'verify_driver_affiliation', [A.plate, null, null, null, 'a reason nobody asked for']);
  const ov2 = await one(`SELECT count(*)::int n FROM audit_log WHERE action_type='DRIVER_ROSTER_MISMATCH_OVERRIDDEN' AND target_id='${A.plate}'`);
  check('...a reason given anyway is ignored (no override entry)', m2.success === true && ov2.n === 0, { m2, ov2 });

  console.log('\nM5 nothing else about approval changed');
  const byToda = await rpc(ID.T_AUTH, 'verify_driver_affiliation', [A.late, null, null, null, REASON]);
  check('a TODA administrator still cannot approve, whatever reason they give', byToda.success === false && /Access Denied/.test(byToda.error), byToda);
  const old4 = await q(`SELECT count(*)::int n FROM pg_proc WHERE proname='verify_driver_affiliation' AND pronargs=4`);
  check('the old 4-argument version is gone (no way around the reason)', old4[0].n === 0, old4);
  const anonV = await attempt(() => asUser(t.db, { role: 'anon' }, (tx) => tx.query(`SELECT public.verify_driver_affiliation('${A.late}')`)));
  check('anon cannot call it', !anonV.ok && /permission denied/.test(anonV.error), anonV.ok ? 'allowed' : anonV.error);
  const late = await rpc(ID.L_AUTH, 'verify_driver_affiliation', [A.late]);
  check('a second unmatched applicant is also held (every flag needs its own reason)', late.success === false && late.roster_override_required === true, late);

  await t.db.close();
  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
