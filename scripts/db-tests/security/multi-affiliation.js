// Multi-TODA driver registration (20261009000002) and the booking.passenger_id fix (20261009000001), plus the phone clean-up script.
// Whole migration chain, local emulator only (never Supabase).
const fs = require('fs');
const path = require('path');
const { setup, AFF, ID, attempt, check, summary, asUser } = require('../b4fixtures');
const { freshDb } = require('../tlib');

// This world has an empty TODA roster, so the applicants are "not on the roster" and, since 20261010000005, the LGU needs a reason to approve
// them. These approvals are about the per-affiliation workflow, so they give one (the override itself is tested in roster-match-and-override.js).
const ROSTER_OVERRIDE = 'workflow test: roster is empty in this world';

const U = {
  DX_AUTH: '21000000-0000-0000-0000-0000000000a1', DX: 'b1000000-0000-0000-0000-0000000000a1',   // registers under TODA1 + TODA2
  DY_AUTH: '21000000-0000-0000-0000-0000000000a2', DY: 'b1000000-0000-0000-0000-0000000000a2',   // one Submitted application (sequence check)
  DZ_AUTH: '21000000-0000-0000-0000-0000000000a3', DZ: 'b1000000-0000-0000-0000-0000000000a3',   // two applications (rejection check)
  TODA3: 'c0000000-0000-0000-0000-000000000003',                                                // not accredited (Pending)
};
const err = (r) => (r.ok ? null : String(r.error).slice(0, 160));

(async () => {
  const t = await setup(null);                               // the whole chain
  const { db, internal, as, svc, q, one } = t;
  const rpcAs = (uid, name, args = [], opts = {}) => asUser(db, { uid, ...opts }, (tx) => {
    const ph = args.map((_, i) => `$${i + 1}`).join(',');
    return tx.query(`SELECT public.${name}(${ph}) AS r`, args);
  }, { commit: true }).then((r) => r.rows[0].r);
  const asRows = (uid, sql, args = []) => asUser(db, { uid }, (tx) => tx.query(sql, args)).then((r) => r.rows);

  // ---- world: three new, Pending drivers (their logins exist, as after registration step 1) and a third TODA that is NOT accredited
  await internal(`
    INSERT INTO auth.users(id,email) VALUES
      ('${U.DX_AUTH}','dx@x.com'),('${U.DY_AUTH}','dy@x.com'),('${U.DZ_AUTH}','dz@x.com');
    INSERT INTO public.driver(driver_id,auth_user_id,full_name,contact_number,account_status,availability_status,toda_id) VALUES
      ('${U.DX}','${U.DX_AUTH}','Driver X','+639190000001','Pending Verification','Offline','${ID.TODA1}'),
      ('${U.DY}','${U.DY_AUTH}','Driver Y','+639190000002','Pending Verification','Offline','${ID.TODA1}'),
      ('${U.DZ}','${U.DZ_AUTH}','Driver Z','+639190000003','Pending Verification','Offline','${ID.TODA1}');
    INSERT INTO public.driver_verification(driver_id) VALUES ('${U.DX}'),('${U.DY}'),('${U.DZ}');
    INSERT INTO public.toda(toda_id,toda_name,toda_status) VALUES ('${U.TODA3}','Toda Three','Pending Verification');`);

  console.log('M1 registration: one call, one affiliation per selected TODA');
  const r1 = await rpcAs(U.DX_AUTH, 'apply_driver_toda_affiliations', [JSON.stringify([
    { toda_id: ID.TODA1, toda_membership_number: ' A-100 ', assigned_terminal: 'Terminal One', barangay_service_area: 'Brgy Uno' },
    { toda_id: ID.TODA2, toda_membership_number: 'B-200', assigned_terminal: 'Terminal Two', barangay_service_area: 'Brgy Dos' },
    { toda_id: ID.TODA2, toda_membership_number: 'duplicate in the same call' },
  ])]);
  const rowsX = await q(`SELECT * FROM driver_toda_affiliation WHERE driver_id='${U.DX}' ORDER BY toda_id`);
  check('success, two applied (the duplicate TODA in the same call counts once)', r1.success === true && r1.applied === 2 && r1.results.length === 2, r1);
  check('exactly one row per selected TODA, all Submitted / Pending and not active',
    rowsX.length === 2 && rowsX.every((a) => a.toda_endorsement_status === 'Submitted' && a.lgu_verification_status === 'Pending' && a.is_active_selection === false));
  check('each row keeps its OWN membership number, terminal and barangay (trimmed)',
    rowsX[0].toda_id === ID.TODA1 && rowsX[0].toda_membership_number === 'A-100' && rowsX[0].assigned_terminal === 'Terminal One' && rowsX[0].barangay_service_area === 'Brgy Uno'
    && rowsX[1].toda_id === ID.TODA2 && rowsX[1].toda_membership_number === 'B-200' && rowsX[1].assigned_terminal === 'Terminal Two' && rowsX[1].barangay_service_area === 'Brgy Dos', rowsX);
  const dup = await attempt(() => internal(`INSERT INTO driver_toda_affiliation(driver_id,toda_id) VALUES ('${U.DX}','${ID.TODA1}')`));
  check('UNIQUE (driver_id, toda_id): a second row for the same pair is refused by the database', !dup.ok && /duplicate key|unique/i.test(dup.error), err(dup));

  const r2 = await rpcAs(U.DX_AUTH, 'apply_driver_toda_affiliations', [JSON.stringify([{ toda_id: ID.TODA1, toda_membership_number: 'A-101' }])]);
  const rowsX2 = await q(`SELECT * FROM driver_toda_affiliation WHERE driver_id='${U.DX}' ORDER BY toda_id`);
  check('registering again is idempotent: still one row per TODA, only the description of a waiting application is refreshed',
    r2.success === true && r2.results[0].outcome === 'updated' && rowsX2.length === 2 && rowsX2[0].toda_membership_number === 'A-101'
    && rowsX2[0].assigned_terminal === 'Terminal One' && rowsX2[0].toda_endorsement_status === 'Submitted', { r2, rowsX2 });

  const bad = await rpcAs(U.DY_AUTH, 'apply_driver_toda_affiliations', [JSON.stringify([{ toda_id: U.TODA3 }])]);
  check('a TODA that is not accredited / active is refused with a clear error and creates nothing',
    bad.success === false && bad.results[0].success === false && /ERR_TODA_NOT_ACTIVE/.test(bad.results[0].error)
    && (await q(`SELECT 1 FROM driver_toda_affiliation WHERE driver_id='${U.DY}'`)).length === 0, bad);
  const mixed = await rpcAs(U.DY_AUTH, 'apply_driver_toda_affiliations', [JSON.stringify([{ toda_id: U.TODA3 }, { toda_id: ID.TODA1 }, { toda_id: 'not-a-uuid' }])]);
  check('a mixed request applies the valid TODA and reports the others',
    mixed.success === true && mixed.applied === 1 && mixed.results.length === 3 && mixed.results.filter((x) => x.success).length === 1, mixed);
  check('none of this ever creates an Endorsed / Approved / active row',
    (await q(`SELECT 1 FROM driver_toda_affiliation WHERE driver_id IN ('${U.DX}','${U.DY}') AND (toda_endorsement_status <> 'Submitted' OR lgu_verification_status <> 'Pending' OR is_active_selection)`)).length === 0);
  const empty = await rpcAs(U.DZ_AUTH, 'apply_driver_toda_affiliations', ['[]']);
  const notArr = await rpcAs(U.DZ_AUTH, 'apply_driver_toda_affiliations', ['{"toda_id":"x"}']);
  const tooMany = await rpcAs(U.DZ_AUTH, 'apply_driver_toda_affiliations', [JSON.stringify(Array.from({ length: 11 }, () => ({ toda_id: ID.TODA1 })))]);
  check('an empty list, a non-list and more than 10 entries are refused', empty.success === false && notArr.success === false && tooMany.success === false, { empty, notArr, tooMany });
  const pax = await rpcAs(ID.P_AUTH, 'apply_driver_toda_affiliations', [JSON.stringify([{ toda_id: ID.TODA1 }])]);
  check('a login without a driver record (a passenger) cannot apply', pax.success === false && /Driver profile not found/.test(pax.error), pax);
  const anon = await attempt(() => asUser(db, { uid: null, role: 'anon' }, (tx) => tx.query(`SELECT public.apply_driver_toda_affiliations('[]'::jsonb)`), { commit: true }));
  check('anon cannot call it (no EXECUTE)', !anon.ok && /permission denied/.test(anon.error), err(anon));
  const forge = await attempt(() => as(U.DX_AUTH, (tx) => tx.query(
    `INSERT INTO driver_toda_affiliation(driver_id,toda_id,toda_endorsement_status,lgu_verification_status) VALUES ('${U.DX}','${U.TODA3}','Endorsed','Approved')`)));
  check('a driver still cannot insert an Endorsed / Approved affiliation by hand (policy unchanged)', !forge.ok, err(forge));

  console.log('\nM2 each TODA sees and reviews only ITS affiliation');
  const aT1 = rowsX2.find((a) => a.toda_id === ID.TODA1).affiliation_id;
  const aT2 = rowsX2.find((a) => a.toda_id === ID.TODA2).affiliation_id;
  const seeX = (uid) => asRows(uid, `SELECT (SELECT count(*) FROM driver WHERE driver_id='${U.DX}')::int AS drv, (SELECT count(*) FROM driver_verification WHERE driver_id='${U.DX}')::int AS ver, (SELECT array_agg(toda_id ORDER BY toda_id) FROM driver_toda_affiliation WHERE driver_id='${U.DX}') AS affs`).then((r) => r[0]);
  const sx1 = await seeX(ID.T_AUTH), sx2 = await seeX(ID.T2_AUTH);
  check('TODA1 administrator sees the driver, the verification record and ONLY the TODA1 affiliation', sx1.drv === 1 && sx1.ver === 1 && sx1.affs.length === 1 && sx1.affs[0] === ID.TODA1, sx1);
  check('TODA2 administrator (not the driver.toda_id pointer) sees the driver, the verification record and ONLY the TODA2 affiliation', sx2.drv === 1 && sx2.ver === 1 && sx2.affs.length === 1 && sx2.affs[0] === ID.TODA2, sx2);
  const dOther = await asRows(ID.T2_AUTH, `SELECT count(*)::int n FROM driver WHERE driver_id='${ID.D1}'`);
  check('...and a TODA administrator still sees nothing of a driver who never applied to their TODA', dOther[0].n === 0, dOther);
  const w1 = await asUser(db, { uid: ID.T2_AUTH }, (tx) => tx.query(`UPDATE driver_verification SET remarks='x' WHERE driver_id='${U.DX}'`));
  const w2 = await asUser(db, { uid: ID.T2_AUTH }, (tx) => tx.query(`UPDATE driver SET full_name='x' WHERE driver_id='${U.DX}'`));
  check('read access only: the TODA2 administrator cannot WRITE the driver or its verification record', w1.rowCount === 0 && w2.rowCount === 0, { w1: w1.rowCount, w2: w2.rowCount });
  const stor = async (uid, folder) => (await asRows(uid, `SELECT public.storage_can_read_driver_folder($1) AS r`, [folder]))[0].r;
  check('documents: both TODAs\' administrators may read the applicant\'s folder, an unrelated TODA\'s administrator may not',
    (await stor(ID.T_AUTH, U.DX_AUTH)) === true && (await stor(ID.T2_AUTH, U.DX_AUTH)) === true && (await stor(ID.T_AUTH, ID.D3_AUTH)) === false);

  console.log('\nM3 TODA stage, per affiliation');
  const e2 = await rpcAs(ID.T2_AUTH, 'endorse_driver_affiliation', [aT2]);
  const crossT1 = await rpcAs(ID.T_AUTH, 'endorse_driver_affiliation', [aT2]);
  const st = async () => (await q(`SELECT toda_id, toda_endorsement_status e, lgu_verification_status l, is_active_selection a FROM driver_toda_affiliation WHERE driver_id='${U.DX}'`)).reduce((m, r) => ({ ...m, [r.toda_id]: r }), {});
  let s = await st();
  check('TODA2 endorses ITS affiliation; TODA1\'s affiliation is untouched and still waiting', e2.success === true && s[ID.TODA2].e === 'Endorsed' && s[ID.TODA1].e === 'Submitted', { e2, s });
  check('TODA1 cannot decide TODA2\'s affiliation', crossT1.success === false && /Access Denied/.test(crossT1.error), crossT1);
  const ret1 = await rpcAs(ID.T_AUTH, 'return_driver_documents', [aT1, JSON.stringify([{ document_type: 'license', reason_code: 'blurry', reason: 'Blurry licence, please retake' }])]);
  s = await st();
  check('TODA1 returning ITS affiliation does not change TODA2\'s endorsement', ret1.success === true && s[ID.TODA1].e === 'Resubmission Required' && s[ID.TODA2].e === 'Endorsed', s);
  const res1 = await rpcAs(U.DX_AUTH, 'resubmit_driver_application', [aT1]);
  s = await st();
  check('the driver resubmits for TODA1 only; TODA2 stays Endorsed', res1.success === true && s[ID.TODA1].e === 'Submitted' && s[ID.TODA2].e === 'Endorsed', { res1, s });
  const e1 = await rpcAs(ID.T_AUTH, 'endorse_driver_affiliation', [aT1]);
  s = await st();
  check('TODA1 then endorses its own affiliation independently', e1.success === true && s[ID.TODA1].e === 'Endorsed', s);

  console.log('\nM4 LGU stage, per affiliation, after the TODA stage (sequential)');
  const [aY] = (await q(`SELECT affiliation_id FROM driver_toda_affiliation WHERE driver_id='${U.DY}'`)).map((r) => r.affiliation_id);
  const early = await rpcAs(ID.L_AUTH, 'verify_driver_affiliation', [aY]);
  check('the LGU cannot verify an affiliation its TODA has not endorsed yet', early.success === false && /Sequential violation/.test(early.error), early);
  const v2 = await rpcAs(ID.L_AUTH, 'verify_driver_affiliation', [aT2, null, null, null, ROSTER_OVERRIDE]);
  s = await st();
  const dX = await one(`SELECT account_status, toda_id FROM driver WHERE driver_id='${U.DX}'`);
  check('LGU verifies the TODA2 affiliation: that one is Approved and active, the TODA1 affiliation is still Pending',
    v2.success === true && s[ID.TODA2].l === 'Approved' && s[ID.TODA2].a === true && s[ID.TODA1].l === 'Pending' && s[ID.TODA1].a === false, s);
  check('...the driver becomes Verified and the legacy pointer follows the active affiliation', dX.account_status === 'Verified' && dX.toda_id === ID.TODA2, dX);
  const v1 = await rpcAs(ID.L_AUTH, 'verify_driver_affiliation', [aT1, null, null, null, ROSTER_OVERRIDE]);
  s = await st();
  check('LGU verifies the TODA1 affiliation too: both verified, still exactly ONE active selection (TODA2)',
    v1.success === true && s[ID.TODA1].l === 'Approved' && s[ID.TODA1].a === false && s[ID.TODA2].a === true, s);

  console.log('\nM5 going Online uses only the verified, ACTIVE affiliation');
  let on = await t.goOnline(U.DX_AUTH);
  check('with two verified affiliations and TODA2 active he goes Online under TODA2', on.success === true, on);
  const sess = await t.openSession(U.DX);
  check('the Online session is tied to the ACTIVE affiliation only', !!sess && sess.toda_id === ID.TODA2 && sess.affiliation_id === aT2, sess);
  check('a driver with no verified affiliation still cannot go Online (DY: Submitted only)', (await t.goOnline(U.DY_AUTH)).success === false);
  const sw = await rpcAs(U.DX_AUTH, 'select_active_driver_affiliation', [aT1]);
  check('switching the active affiliation while Online is refused (must be Offline first)', sw.success === false && /ERR_MUST_BE_OFFLINE/.test(sw.error), sw);
  await t.goOffline(U.DX_AUTH);
  const sw2 = await rpcAs(U.DX_AUTH, 'select_active_driver_affiliation', [aT1]);
  const dX2 = await one(`SELECT toda_id FROM driver WHERE driver_id='${U.DX}'`);
  check('offline, he can switch; the pointer used by dispatch follows the new active affiliation', sw2.success === true && dX2.toda_id === ID.TODA1, { sw2, dX2 });

  console.log('\nM6 a rejection of ONE affiliation does not reject the driver while another is alive');
  await rpcAs(U.DZ_AUTH, 'apply_driver_toda_affiliations', [JSON.stringify([{ toda_id: ID.TODA1 }, { toda_id: ID.TODA2 }])]);
  const zs = await q(`SELECT affiliation_id, toda_id FROM driver_toda_affiliation WHERE driver_id='${U.DZ}'`);
  const zA = zs.find((x) => x.toda_id === ID.TODA1).affiliation_id, zB = zs.find((x) => x.toda_id === ID.TODA2).affiliation_id;
  const rj1 = await rpcAs(ID.T_AUTH, 'reject_driver_affiliation', [zA, 'ineligible', 'not a member']);
  let dz = await one(`SELECT d.account_status, v.verification_status FROM driver d JOIN driver_verification v USING (driver_id) WHERE d.driver_id='${U.DZ}'`);
  check('TODA1 rejects its affiliation: the driver and the shared verification record are NOT rejected (TODA2 is still open)',
    rj1.success === true && dz.account_status === 'Pending Verification' && dz.verification_status !== 'Rejected', dz);
  const e2z = await rpcAs(ID.T2_AUTH, 'endorse_driver_affiliation', [zB]);
  const rj2 = await rpcAs(ID.L_AUTH, 'reject_driver_affiliation', [zB, 'ineligible', 'no franchise']);
  dz = await one(`SELECT d.account_status, v.verification_status FROM driver d JOIN driver_verification v USING (driver_id) WHERE d.driver_id='${U.DZ}'`);
  check('when the LGU rejects the LAST live affiliation the driver is Rejected', e2z.success === true && rj2.success === true && dz.account_status === 'Rejected' && dz.verification_status === 'Rejected', dz);
  const again = await rpcAs(U.DZ_AUTH, 'apply_driver_toda_affiliations', [JSON.stringify([{ toda_id: ID.TODA1 }])]);
  check('a rejected driver cannot simply re-apply (an administrator must allow it)', again.success === false, again);

  console.log('\nF1 booking.passenger_id: NOT NULL + ON DELETE SET NULL no longer contradict');
  const col = await one(`SELECT attnotnull FROM pg_attribute WHERE attrelid='public.booking'::regclass AND attname='passenger_id'`);
  check('the column is nullable', col.attnotnull === false, col);
  const contradictions = await q(`SELECT c.conrelid::regclass::text t, a.attname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
                                   WHERE c.contype='f' AND c.confdeltype='n' AND a.attnotnull AND c.connamespace='public'::regnamespace`);
  check('no foreign key in the schema is NOT NULL + ON DELETE SET NULL', contradictions.length === 0, contradictions);
  const bk = await t.mkBooking(ID.P2, 'Completed', ID.D1);
  const delP2 = await attempt(() => internal(`DELETE FROM passenger WHERE passenger_id='${ID.P2}'`));
  const kept = await one(`SELECT passenger_id, driver_id, booking_status FROM booking WHERE booking_id='${bk}'`);
  check('deleting a passenger who has trips now works: the trip stays for the driver, without the passenger', delP2.ok && kept && kept.passenger_id === null && kept.driver_id === ID.D1, { err: err(delP2), kept });
  const bk2 = await t.mkBooking(ID.P1, 'Completed', ID.D1);
  const own = await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`UPDATE booking SET passenger_id=NULL WHERE booking_id='${bk2}'`)));
  const steal = await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`UPDATE booking SET passenger_id='${ID.P1}' WHERE booking_id='${bk}'`)));
  check('the guard still refuses a passenger who nulls the owner of an existing passenger\'s booking', (!own.ok && /ERR_BOOKING_OWNER_LOCKED/.test(own.error)) || (own.ok && own.value.rowCount === 0), err(own));
  check('...and nobody can re-attach an anonymised trip to a passenger from a client session', (!steal.ok) || (steal.ok && steal.value.rowCount === 0), err(steal));
  const lguDel = await attempt(() => asUser(db, { uid: ID.L_AUTH }, (tx) => tx.query(`DELETE FROM passenger WHERE passenger_id='${ID.P1}'`), { commit: true }));
  const kept2 = await one(`SELECT passenger_id FROM booking WHERE booking_id='${bk2}'`);
  check('an LGU administrator deleting a passenger through the API also works (the guard lets the foreign key null the link)', lguDel.ok && kept2 && kept2.passenger_id === null, { err: err(lguDel), kept2 });

  // the same delete on the PRE-fix database fails, which is what happened to you
  const pre = await freshDb('20261008000005_perimeter_storage.sql');
  await pre.exec(`SELECT set_config('sakay.internal_context','true',false);
                  INSERT INTO auth.users(id,email) VALUES ('${ID.P2_AUTH}','p@x.com');
                  INSERT INTO public.passenger(passenger_id,auth_user_id,full_name,contact_number,account_status) VALUES ('${ID.P2}','${ID.P2_AUTH}','P','+639170000002','Active');
                  INSERT INTO public.booking(passenger_id,passenger_count,pickup_address,pickup_latitude,pickup_longitude,dropoff_address,dropoff_latitude,dropoff_longitude,booking_status)
                  VALUES ('${ID.P2}',1,'A',13.4,121.1,'B',13.5,121.2,'Completed');
                  SELECT set_config('sakay.internal_context','',false)`);
  const preDel = await attempt(() => pre.exec(`DELETE FROM public.passenger WHERE passenger_id='${ID.P2}'`));
  check('(control) on the database BEFORE the migration the same delete fails with the NOT NULL violation', !preDel.ok && /not-null|null value/i.test(preDel.error), err(preDel));

  console.log('\nC1 supabase/scripts/safe_test_data_cleanup.sql PART 4 (delete one number)');
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'supabase', 'scripts', 'safe_test_data_cleanup.sql'), 'utf8');
  const m = sql.match(/\nDO \$\$[\s\S]*?\nEND \$\$;/);
  check('the DO block is found in the script', !!m);
  const run = (block, sub, role, apply) => block
    .replace(/v_sub   CONSTANT TEXT    := '9XXXXXXXXX'/, `v_sub   CONSTANT TEXT    := '${sub}'`)
    .replace(/v_role  CONSTANT TEXT    := 'both'/, `v_role  CONSTANT TEXT    := '${role}'`)
    .replace(/v_apply CONSTANT BOOLEAN := FALSE/, `v_apply CONSTANT BOOLEAN := ${apply ? 'TRUE' : 'FALSE'}`);

  // a fresh world for the script: P1-like test passenger + test driver with the SAME number, trips, ratings, strikes, flags, an ORPHAN login, and an unrelated passenger
  const c = await setup(null);
  const cq = c.q, ci = c.internal;
  const SUBJ = '9171234567';
  const CP = { A: '31000000-0000-0000-0000-0000000000c1', P: 'a1000000-0000-0000-0000-0000000000c1',
               DA: '31000000-0000-0000-0000-0000000000c2', D: 'b1000000-0000-0000-0000-0000000000c2',
               OA: '31000000-0000-0000-0000-0000000000c3', AF: 'e1000000-0000-0000-0000-0000000000c1' };
  await ci(`
    INSERT INTO auth.users(id,email,phone) VALUES
      ('${CP.A}','passenger_63${SUBJ}@sakay.ph', NULL), ('${CP.DA}','driver_63${SUBJ}@sakay.ph', NULL), ('${CP.OA}','driver_0${SUBJ}@driver.sakay.internal', NULL);
    INSERT INTO auth.identities(user_id,provider_id,provider,identity_data) VALUES ('${CP.A}','x','email','{}'),('${CP.DA}','y','email','{}');
    INSERT INTO public.passenger(passenger_id,auth_user_id,full_name,contact_number,account_status) VALUES ('${CP.P}','${CP.A}','Test Pax','+63${SUBJ}','Active');
    INSERT INTO public.driver(driver_id,auth_user_id,full_name,contact_number,account_status,availability_status,toda_id) VALUES ('${CP.D}','${CP.DA}','Test Drv','0${SUBJ}','Pending Verification','Offline','${ID.TODA1}');
    INSERT INTO public.driver_verification(driver_id) VALUES ('${CP.D}');
    INSERT INTO public.driver_toda_affiliation(affiliation_id,driver_id,toda_id) VALUES ('${CP.AF}','${CP.D}','${ID.TODA1}');`);
  const b1 = await c.mkBooking(CP.P, 'Completed', ID.D1);          // test passenger with a REAL driver
  const b2 = await c.mkBooking(ID.P1, 'Completed', CP.D);          // REAL passenger with the test driver (must be kept)
  await ci(`
    INSERT INTO public.rating(booking_id,rater_id,ratee_id,rater_role,stars) VALUES ('${b1}','${CP.P}','${ID.D1}','passenger',5),('${b2}','${ID.P1}','${CP.D}','passenger',4);
    INSERT INTO public.notification(passenger_id,title,message,notification_type) VALUES ('${CP.P}','t','m','x');
    INSERT INTO public.notification(recipient_id,driver_id,title,message,notification_type) VALUES ('${CP.D}','${CP.D}','t','m','x');
    INSERT INTO public.admin_review_flag(flag_type,subject_type,subject_id,source_rule,assigned_role) VALUES ('ROSTER_MISMATCH','driver_application','${CP.AF}','Rule 2.4','lgu_admin');`);
  const cnt = async () => (await cq(`SELECT
      (SELECT count(*) FROM public.passenger WHERE passenger_id='${CP.P}')::int p, (SELECT count(*) FROM public.driver WHERE driver_id='${CP.D}')::int d,
      (SELECT count(*) FROM auth.users WHERE id IN ('${CP.A}','${CP.DA}','${CP.OA}'))::int au, (SELECT count(*) FROM public.booking WHERE booking_id IN ('${b1}','${b2}'))::int bk,
      (SELECT count(*) FROM public.rating)::int rt, (SELECT count(*) FROM public.lgu_admin)::int lgu, (SELECT count(*) FROM public.toda_admin)::int tadm, (SELECT count(*) FROM public.toda)::int toda,
      (SELECT count(*) FROM public.passenger WHERE passenger_id='${ID.P1}')::int realp`))[0];
  const before = await cnt();
  const dry = await attempt(() => c.db.exec(run(m[0], SUBJ, 'both', false)));
  const afterDry = await cnt();
  check('DRY RUN: ends with the deliberate error that lists the counts, and nothing is deleted',
    !dry.ok && /DRY RUN/.test(dry.error) && JSON.stringify(before) === JSON.stringify(afterDry), { err: err(dry), before, afterDry });
  const apply = await attempt(() => c.db.exec(run(m[0], SUBJ, 'both', true)));
  const after = await cnt();
  const keptB = await cq(`SELECT booking_id, driver_id FROM public.booking WHERE booking_id IN ('${b1}','${b2}')`);
  check('APPLY: the passenger, the driver and ALL THREE logins (including the orphan alias) are gone', apply.ok && after.p === 0 && after.d === 0 && after.au === 0, { err: err(apply), after });
  check('...their trip with a real driver is deleted; a real passenger\'s trip with the test driver is KEPT, without the driver link',
    after.bk === 1 && keptB.length === 1 && keptB[0].booking_id === b2 && keptB[0].driver_id === null, keptB);
  check('...the test ratings are gone, an unrelated passenger, the LGU / TODA administrators and the TODAs are untouched',
    after.rt === 0 && after.realp === 1 && after.lgu === before.lgu && after.tadm === before.tadm && after.toda === before.toda, { before, after });
  const none = await attempt(() => c.db.exec(run(m[0], SUBJ, 'both', true)));
  check('running it again for a number that no longer exists is harmless', none.ok, err(none));
  const badSub = await attempt(() => c.db.exec(run(m[0], '12345', 'both', false)));
  check('a malformed number is refused', !badSub.ok && /ten digits/.test(badSub.error), err(badSub));

  // administrators are never deleted: a login that is an LGU administrator and matches the number must stop the whole thing
  const AD = '31000000-0000-0000-0000-0000000000d1', ADP = 'a1000000-0000-0000-0000-0000000000d1';
  await ci(`INSERT INTO auth.users(id,email) VALUES ('${AD}','passenger_639181112222@sakay.ph');
            INSERT INTO public.lgu_admin(auth_user_id,full_name,email) VALUES ('${AD}','Boss','boss@x.com');
            INSERT INTO public.passenger(passenger_id,auth_user_id,full_name,contact_number,account_status) VALUES ('${ADP}','${AD}','Boss Pax','+639181112222','Active')`);
  const adm = await attempt(() => c.db.exec(run(m[0], '9181112222', 'both', true)));
  const admLeft = await cq(`SELECT (SELECT count(*) FROM public.lgu_admin WHERE auth_user_id='${AD}')::int a, (SELECT count(*) FROM public.passenger WHERE passenger_id='${ADP}')::int p`);
  check('REFUSED when a matching login is an LGU administrator: nothing is deleted', !adm.ok && /REFUSED/.test(adm.error) && admLeft[0].a === 1 && admLeft[0].p === 1, { err: err(adm), admLeft });

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
