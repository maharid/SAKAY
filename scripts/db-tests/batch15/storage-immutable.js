// Migration 20261031000007 (panel comment 15, decision D-P7): a document the TODA or the LGU has already approved cannot be overwritten or deleted by whoever uploaded it.
// Whole migration chain on the local emulator (never Supabase). storage.objects here is the emulator's stand-in: (id, bucket_id, name, owner) with the real row policies.
const { setup, ID, PAX, attempt, check, summary } = require('../b11fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, as } = s;
  const put = (uid, bucket, name) => attempt(() => as(uid, (tx) => tx.query(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ($1, $2, $3) RETURNING id`, [bucket, name, uid])));
  // an overwrite or a delete that a policy refuses changes NO row (it is not an error): count the rows it touched
  const touched = async (uid, sql) => {
    const r = await attempt(() => as(uid, (tx) => tx.query(sql)));
    return r.ok ? r.value.rows.length : -1;
  };
  const overwrite = (uid, bucket, name) => touched(uid, `UPDATE storage.objects SET owner = owner WHERE bucket_id = '${bucket}' AND name = '${name}' RETURNING id`);
  const remove = (uid, bucket, name) => touched(uid, `DELETE FROM storage.objects WHERE bucket_id = '${bucket}' AND name = '${name}' RETURNING id`);
  const exists = async (bucket, name) => Number((await one(`SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id = '${bucket}' AND name = '${name}'`)).n) === 1;
  const LGU = ID.L_AUTH;

  console.log('S1 driver documents: free to replace until the LGU has accepted them, then locked');
  const lic = `${ID.D_AUTH}/license_front.jpg`;
  await internal(`UPDATE driver SET account_status = 'Pending Verification' WHERE driver_id = '${ID.D1}'`);
  check('the driver uploads a licence photo into their own folder', (await put(ID.D_AUTH, 'driver-licenses', lic)).ok);
  check('while the documents are Pending Verification the driver can replace the file (an overwrite touches the row)', (await overwrite(ID.D_AUTH, 'driver-licenses', lic)) === 1);
  await internal(`UPDATE driver SET account_status = 'Resubmission Required' WHERE driver_id = '${ID.D1}'`);
  check('...and when the LGU returned them for correction', (await overwrite(ID.D_AUTH, 'driver-licenses', lic)) === 1);
  await internal(`UPDATE driver SET account_status = 'Verified' WHERE driver_id = '${ID.D1}'`);
  check('once the driver is Verified the same overwrite changes nothing', (await overwrite(ID.D_AUTH, 'driver-licenses', lic)) === 0);
  check('...and the driver cannot delete the approved file either', (await remove(ID.D_AUTH, 'driver-licenses', lic)) === 0 && (await exists('driver-licenses', lic)));
  check('the same for the MTOP permit and the tricycle photo', (await put(ID.D_AUTH, 'mtop-permits', `${ID.D_AUTH}/mtop.jpg`)).ok && (await overwrite(ID.D_AUTH, 'mtop-permits', `${ID.D_AUTH}/mtop.jpg`)) === 0
    && (await put(ID.D_AUTH, 'tricycle-photos', `${ID.D_AUTH}/trike.jpg`)).ok && (await remove(ID.D_AUTH, 'tricycle-photos', `${ID.D_AUTH}/trike.jpg`)) === 0);
  await internal(`UPDATE driver SET account_status = 'Suspended' WHERE driver_id = '${ID.D1}'`);
  check('a suspended driver cannot swap a document either (only the early stages can)', (await overwrite(ID.D_AUTH, 'driver-licenses', lic)) === 0);
  await internal(`UPDATE driver SET account_status = 'Verified' WHERE driver_id = '${ID.D1}'`);
  check('another driver still cannot touch it (as before)', (await overwrite(ID.D2_AUTH, 'driver-licenses', lic)) === 0 && (await remove(ID.D2_AUTH, 'driver-licenses', lic)) === 0);
  check('the LGU Administrator can still remove a file (a wrong or harmful upload)', (await remove(LGU, 'driver-licenses', lic)) === 1 && !(await exists('driver-licenses', lic)));
  check('a name that is not in a driver folder is not "locked" for the rule, and the insert policy refuses it anyway',
    (await one(`SELECT public.storage_object_is_locked('driver-licenses', 'flat.jpg') AS l`)).l === false && !(await put(ID.D_AUTH, 'driver-licenses', 'flat.jpg')).ok);

  console.log('\nS2 TODA documents are never changed by the uploader (a correction is a new file)');
  const bylaws = `${ID.T_AUTH}/1790000000000_bylaws.pdf`;
  check('the TODA administrator uploads a document under a new name', (await put(ID.T_AUTH, 'toda-bylaws', bylaws)).ok && (await put(ID.T_AUTH, 'barangay-clearances', `${ID.T_AUTH}/1790000000000_clearance.pdf`)).ok);
  check('...and cannot overwrite it', (await overwrite(ID.T_AUTH, 'toda-bylaws', bylaws)) === 0);
  check('...nor delete it', (await remove(ID.T_AUTH, 'toda-bylaws', bylaws)) === 0 && (await exists('toda-bylaws', bylaws)));
  check('a new upload under another name is fine (that is how a renewal or a correction goes)', (await put(ID.T_AUTH, 'toda-bylaws', `${ID.T_AUTH}/1790000000999_bylaws.pdf`)).ok);
  check('the other TODA\'s administrator cannot touch it', (await overwrite(ID.T2_AUTH, 'toda-bylaws', bylaws)) === 0 && (await remove(ID.T2_AUTH, 'toda-bylaws', bylaws)) === 0);
  check('the LGU Administrator can remove a file', (await remove(LGU, 'toda-bylaws', bylaws)) === 1);

  console.log('\nS3 incident evidence is added, never changed');
  const ev = `${PAX.P1.uid}/photo1.jpg`;
  check('the passenger adds evidence to their own folder', (await put(PAX.P1.uid, 'incident-evidence', ev)).ok);
  check('...and cannot overwrite it', (await overwrite(PAX.P1.uid, 'incident-evidence', ev)) === 0);
  check('...nor delete it (as before: only the LGU)', (await remove(PAX.P1.uid, 'incident-evidence', ev)) === 0 && (await exists('incident-evidence', ev)));
  check('the LGU Administrator can remove it', (await remove(LGU, 'incident-evidence', ev)) === 1);

  console.log('\nS4 profile photos are meant to be replaced');
  const pp = `${PAX.P1.uid}/avatar.jpg`;
  check('the passenger uploads a profile photo', (await put(PAX.P1.uid, 'profiles', pp)).ok);
  check('...and replaces it, and removes it (nothing locks a profile photo)', (await overwrite(PAX.P1.uid, 'profiles', pp)) === 1 && (await remove(PAX.P1.uid, 'profiles', pp)) === 1);

  console.log('\nS5 the function');
  const row = await one(`SELECT public.storage_object_is_locked('barangay-clearances', 'a/b.pdf') AS a, public.storage_object_is_locked('toda-accredited-driver-lists', 'a/b.xlsx') AS b,
                                public.storage_object_is_locked('incident-evidence', 'a/b.jpg') AS c, public.storage_object_is_locked('profile-photos', 'a/b.jpg') AS d,
                                public.storage_object_is_locked('reports', 'a/b.csv') AS e, has_function_privilege('anon', 'public.storage_object_is_locked(text, text)', 'EXECUTE') AS anon_can`);
  check('TODA documents and evidence are locked; profile photos and reports are not', row.a && row.b && row.c && !row.d && !row.e, row);
  check('the function is not open to anon', row.anon_can === false, row);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
