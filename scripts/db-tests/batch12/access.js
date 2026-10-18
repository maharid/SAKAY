// Batch 12 (Rule 28.1, watch-out W8; T6): a TODA Administrator cannot read another TODA's documents or incident evidence, and a TODA that REJECTED a driver (at its own stage or the
// LGU's) no longer reads that driver's documents; the LGU keeps full read; nothing a TODA Administrator reads crosses into another TODA's trips, reports or ratings.
// Whole migration chain on the local emulator.
const { setup, ID, DRIVERS, PAX, attempt, check, summary } = require('../b12fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, as } = s;
  const D1 = DRIVERS.D1.id, D3 = DRIVERS.D3.id, P1 = PAX.P1.id;
  const canSee = async (uid, bucket, name) => (await attempt(() => as(uid, (tx) => tx.query(`SELECT 1 FROM storage.objects WHERE bucket_id = $1 AND name = $2`, [bucket, name])))).value?.rows.length === 1;
  const put = (bucket, name, owner) => internal(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('${bucket}', '${name}', ${owner ? `'${owner}'` : 'NULL'})`);
  for (const b of ['driver-licenses', 'mtop-permits', 'tricycle-photos', 'incident-evidence', 'barangay-clearances', 'toda-bylaws']) await internal(`INSERT INTO storage.buckets (id, name, public) VALUES ('${b}', '${b}', FALSE) ON CONFLICT DO NOTHING`);

  console.log('S1 a driver\'s documents: their own TODA, the LGU, nobody else');
  const lic = `${ID.D_AUTH}/license_front.jpg`, mtop = `${ID.D_AUTH}/mtop.jpg`, other = `${ID.D3_AUTH}/license_front.jpg`;
  await put('driver-licenses', lic, ID.D_AUTH); await put('mtop-permits', mtop, ID.D_AUTH); await put('driver-licenses', other, ID.D3_AUTH);
  check('the driver, their TODA One Administrator (the current TODA) and the LGU read the license', (await canSee(ID.D_AUTH, 'driver-licenses', lic)) && (await canSee(ID.T_AUTH, 'driver-licenses', lic)) && (await canSee(ID.L_AUTH, 'driver-licenses', lic)));
  check('TODA Two\'s Administrator cannot read a TODA One driver\'s license or MTOP (T6)', !(await canSee(ID.T2_AUTH, 'driver-licenses', lic)) && !(await canSee(ID.T2_AUTH, 'mtop-permits', mtop)));
  check('TODA One\'s Administrator cannot read a TODA Two driver\'s license', !(await canSee(ID.T_AUTH, 'driver-licenses', other)) && (await canSee(ID.T2_AUTH, 'driver-licenses', other)));
  check('a passenger and another driver cannot read it', !(await canSee(ID.P_AUTH, 'driver-licenses', lic)) && !(await canSee(ID.D2_AUTH, 'driver-licenses', lic)));

  console.log('\nS2 a TODA the driver applied to reads the documents only while that application is alive');
  await internal(`INSERT INTO driver_toda_affiliation (driver_id, toda_id) VALUES ('${D1}', '${ID.TODA2}')`);
  check('TODA Two (a Submitted application from the driver) can read the documents to review them', await canSee(ID.T2_AUTH, 'driver-licenses', lic));
  await internal(`UPDATE driver_toda_affiliation SET toda_endorsement_status = 'Resubmission Required' WHERE driver_id = '${D1}' AND toda_id = '${ID.TODA2}'`);
  check('...also while it is returned for correction', await canSee(ID.T2_AUTH, 'driver-licenses', lic));
  await internal(`UPDATE driver_toda_affiliation SET toda_endorsement_status = 'Endorsed' WHERE driver_id = '${D1}' AND toda_id = '${ID.TODA2}'`);
  check('...and when it is endorsed and waits for the LGU', await canSee(ID.T2_AUTH, 'driver-licenses', lic));
  await internal(`UPDATE driver_toda_affiliation SET toda_endorsement_status = 'Rejected' WHERE driver_id = '${D1}' AND toda_id = '${ID.TODA2}'`);
  check('TODA Two REJECTED the driver: it can no longer read the driver\'s documents (T6)', !(await canSee(ID.T2_AUTH, 'driver-licenses', lic)) && !(await canSee(ID.T2_AUTH, 'mtop-permits', mtop)));
  await internal(`UPDATE driver_toda_affiliation SET toda_endorsement_status = 'Endorsed', lgu_verification_status = 'Rejected' WHERE driver_id = '${D1}' AND toda_id = '${ID.TODA2}'`);
  check('the LGU rejected that application: still no access for TODA Two', !(await canSee(ID.T2_AUTH, 'driver-licenses', lic)));
  check('TODA One (the driver\'s current TODA) and the LGU are unaffected', (await canSee(ID.T_AUTH, 'driver-licenses', lic)) && (await canSee(ID.L_AUTH, 'driver-licenses', lic)));
  await internal(`UPDATE driver_toda_affiliation SET toda_endorsement_status = 'Submitted', lgu_verification_status = 'Approved' WHERE driver_id = '${D1}' AND toda_id = '${ID.TODA2}'`);
  check('an application alive at the LGU stage (approved) reads again', await canSee(ID.T2_AUTH, 'driver-licenses', lic));
  await internal(`DELETE FROM driver_toda_affiliation WHERE driver_id = '${D1}' AND toda_id = '${ID.TODA2}'`);
  check('no application at all: no access', !(await canSee(ID.T2_AUTH, 'driver-licenses', lic)));

  console.log('\nS3 incident evidence: the reporter, the LGU, and the TODA of the reported driver - not another TODA');
  const ev = `${ID.P_AUTH}/evidence-1.jpg`, ev2 = `${ID.P2_AUTH}/evidence-9.jpg`;
  await put('incident-evidence', ev, ID.P_AUTH); await put('incident-evidence', ev2, ID.P2_AUTH);
  const trip = await s.trip('P1', 'D1');
  await internal(`INSERT INTO incident_report (booking_id, passenger_id, driver_id, reported_by, category, description, status, reported_toda_id, evidence_paths)
                  VALUES ('${trip}', '${P1}', '${D1}', 'Passenger', 'Rude Behavior', 'The driver shouted at me.', 'Pending', '${ID.TODA1}', ARRAY['${ev}'])`);
  check('the passenger who uploaded it, the LGU and TODA One (the reported driver\'s TODA) can read it', (await canSee(ID.P_AUTH, 'incident-evidence', ev)) && (await canSee(ID.L_AUTH, 'incident-evidence', ev)) && (await canSee(ID.T_AUTH, 'incident-evidence', ev)));
  check('TODA Two\'s Administrator cannot read TODA One\'s incident evidence (T6)', !(await canSee(ID.T2_AUTH, 'incident-evidence', ev)));
  check('another passenger, the reported driver and the other TODA cannot', !(await canSee(ID.P2_AUTH, 'incident-evidence', ev)) && !(await canSee(ID.D_AUTH, 'incident-evidence', ev)) && !(await canSee(ID.D3_AUTH, 'incident-evidence', ev)));
  check('a photo that is not attached to any report is the uploader\'s and the LGU\'s only', !(await canSee(ID.T_AUTH, 'incident-evidence', ev2)) && !(await canSee(ID.T2_AUTH, 'incident-evidence', ev2)) && (await canSee(ID.P2_AUTH, 'incident-evidence', ev2)) && (await canSee(ID.L_AUTH, 'incident-evidence', ev2)));
  const rows = async (uid, sql) => (await attempt(() => as(uid, (tx) => tx.query(sql)))).value?.rows.length ?? -1;
  check('the report itself: TODA One reads it, TODA Two does not', (await rows(ID.T_AUTH, `SELECT 1 FROM incident_report`)) === 1 && (await rows(ID.T2_AUTH, `SELECT 1 FROM incident_report`)) === 0);

  console.log('\nS4 a TODA\'s own registration documents, GPS trails and ratings');
  await internal(`UPDATE toda SET barangay_clearance_url = '${ID.T_AUTH}/clearance.pdf', bylaws_url = '${ID.T_AUTH}/bylaws.pdf' WHERE toda_id = '${ID.TODA1}'`);
  await put('barangay-clearances', `${ID.T_AUTH}/clearance.pdf`, ID.T_AUTH); await put('toda-bylaws', `${ID.T_AUTH}/bylaws.pdf`, ID.T_AUTH);
  check('TODA One\'s clearance and by-laws: TODA One and the LGU read them, TODA Two does not', (await canSee(ID.T_AUTH, 'barangay-clearances', `${ID.T_AUTH}/clearance.pdf`)) && (await canSee(ID.L_AUTH, 'toda-bylaws', `${ID.T_AUTH}/bylaws.pdf`))
    && !(await canSee(ID.T2_AUTH, 'barangay-clearances', `${ID.T_AUTH}/clearance.pdf`)) && !(await canSee(ID.T2_AUTH, 'toda-bylaws', `${ID.T_AUTH}/bylaws.pdf`)));
  const t1trip = await s.trip('P1', 'D1'), t2trip = await s.trip('P2', 'D3');
  await internal(`INSERT INTO gps_log (booking_id, driver_id, latitude, longitude, accuracy) VALUES ('${t1trip}', '${D1}', 13.41, 121.18, 10), ('${t2trip}', '${D3}', 13.42, 121.19, 10)`);
  check('GPS fixes: TODA One reads only its own trips\' fixes, TODA Two only its own, the LGU all', (await rows(ID.T_AUTH, `SELECT 1 FROM gps_log WHERE booking_id = '${t2trip}'`)) === 0 && (await rows(ID.T_AUTH, `SELECT 1 FROM gps_log WHERE booking_id = '${t1trip}'`)) === 1
    && (await rows(ID.T2_AUTH, `SELECT 1 FROM gps_log WHERE booking_id = '${t1trip}'`)) === 0 && (await rows(ID.L_AUTH, `SELECT 1 FROM gps_log`)) === 2);
  await s.rate(t1trip, 'Passenger', 4);
  check('ratings: no TODA Administrator reads a rating row (they read the driver\'s average); the LGU does', (await rows(ID.T_AUTH, `SELECT 1 FROM rating`)) === 0 && (await rows(ID.T2_AUTH, `SELECT 1 FROM rating`)) === 0 && (await rows(ID.L_AUTH, `SELECT 1 FROM rating`)) === 1);
  check('the driver\'s own average is readable by their TODA (the driver row), not by the other TODA', (await rows(ID.T_AUTH, `SELECT 1 FROM driver WHERE driver_id = '${D1}'`)) === 1 && (await rows(ID.T2_AUTH, `SELECT 1 FROM driver WHERE driver_id = '${D1}'`)) === 0);
  check('the passenger average is not readable by a driver or a TODA Administrator (only the passenger and the LGU)', (await rows(ID.D_AUTH, `SELECT average_rating FROM passenger WHERE passenger_id = '${P1}'`)) === 0 && (await rows(ID.T_AUTH, `SELECT 1 FROM passenger WHERE passenger_id = '${P1}'`)) === 0 && (await rows(ID.P_AUTH, `SELECT 1 FROM passenger WHERE passenger_id = '${P1}'`)) === 1 && (await rows(ID.L_AUTH, `SELECT 1 FROM passenger WHERE passenger_id = '${P1}'`)) === 1);
  check('the review flags: TODA One sees its driver\'s flags, TODA Two does not', await (async () => {
    await internal(`INSERT INTO admin_review_flag (flag_type, subject_type, subject_id, source_rule, assigned_role) VALUES ('DRIVER_LOW_RATING_REVIEW', 'driver', '${D1}', 'Rule 23.3', 'toda_admin')`);
    return (await rows(ID.T_AUTH, `SELECT 1 FROM admin_review_flag`)) === 1 && (await rows(ID.T2_AUTH, `SELECT 1 FROM admin_review_flag`)) === 0;
  })());

  console.log('\nS5 the consent record is written by the person\'s own call and nothing else');
  const acc = await attempt(() => s.rpcAs(ID.P_AUTH, 'public.record_privacy_acceptance($1)', ['2026-10-18']));
  const row = await one(`SELECT privacy_notice_version AS v, privacy_accepted_at AS at FROM passenger WHERE passenger_id = '${P1}'`);
  check('a passenger records the notice version they accepted; the database stores it with its own time', acc.ok && acc.value.success === true && acc.value.recorded === 1 && row.v === '2026-10-18' && Math.abs(Date.now() - new Date(row.at).getTime()) < 120000, { acc, row });
  const again = await s.rpcAs(ID.P_AUTH, 'public.record_privacy_acceptance($1)', ['2026-10-18']);
  check('recording the same version again changes nothing', again.recorded === 0, again);
  const badV = await attempt(() => s.rpcAs(ID.P_AUTH, 'public.record_privacy_acceptance($1)', ['yesterday']));
  check('a version that is not a date is refused', !badV.ok && /ERR_PRIVACY_VERSION/.test(badV.error), badV);
  const direct = await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`UPDATE passenger SET privacy_notice_version = '2099-01-01', privacy_accepted_at = now() + interval '1 year' WHERE passenger_id = '${P1}'`)));
  check('a person cannot write the consent record with a table update', !direct.ok && /written by the system/i.test(direct.error), direct);
  const other2 = await s.rpcAs(ID.P2_AUTH, 'public.record_privacy_acceptance($1)', ['2026-10-18']);
  check('another person\'s record is untouched by the first call (only the caller\'s own row)', other2.recorded === 1 && (await one(`SELECT count(*)::int n FROM passenger WHERE privacy_notice_version IS NOT NULL`)).n === 2);
  const drvAcc = await s.rpcAs(ID.D_AUTH, 'public.record_privacy_acceptance($1)', ['2026-10-18']);
  check('a driver\'s acceptance lands on the driver row', drvAcc.recorded === 1 && (await one(`SELECT privacy_notice_version AS v FROM driver WHERE driver_id = '${D1}'`)).v === '2026-10-18');
  const anon = await attempt(() => s.asUser(s.db, { uid: null, role: 'anon' }, (tx) => tx.query(`SELECT public.record_privacy_acceptance('2026-10-18')`), { commit: true }));
  check('a visitor without an account cannot record anything', !anon.ok, anon);

  const ok = summary();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
