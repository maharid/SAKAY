// Migration 20261030000002 (driver_verification.face_verification_status): the default 'Passed' is gone, so a NEW row no longer claims a face check passed,
// while every EXISTING row keeps the value it holds. Built on the chain up to the migration before it, then the migration is applied on top of rows that
// already exist. Local emulator only (never Supabase).
const fs = require('fs');
const path = require('path');
const { freshDb, asUser, attempt, check, summary } = require('../tlib');
const { ID, seed } = require('../fixtures');
const { MIG_DIR } = require('../lib');

const MIGRATION = '20261030000002_face_verification_status_default.sql';

(async () => {
  const db = await freshDb('20261030000001_toda_resubmission_and_renewal.sql');
  await seed(db);
  const status = async (driverId) =>
    (await db.query(`SELECT face_verification_status AS s FROM public.driver_verification WHERE driver_id = $1`, [driverId])).rows[0].s;
  const columnDefault = async () =>
    (await db.query(`SELECT column_default AS d FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'driver_verification' AND column_name = 'face_verification_status'`)).rows[0].d;

  console.log('S1 before the migration');
  check('the column defaults to \'Passed\' (the old behaviour)', /Passed/.test(await columnDefault()), await columnDefault());
  await db.exec(`INSERT INTO public.driver_verification (driver_id) VALUES ('${ID.D1}')`);                                   // never written by the app
  await db.exec(`INSERT INTO public.driver_verification (driver_id, face_verification_status) VALUES ('${ID.D2}', 'Flagged')`); // written by the old app
  await db.exec(`INSERT INTO public.driver_verification (driver_id, face_verification_status) VALUES ('${ID.D3}', 'Passed')`);  // written by the old app
  const before = [await status(ID.D1), await status(ID.D2), await status(ID.D3)];
  check('set-up: three existing rows hold Passed (by default), Flagged and Passed', before.join() === 'Passed,Flagged,Passed', before);

  console.log('\nS2 apply the migration (and apply it a second time: it is safe to run twice)');
  const sql = fs.readFileSync(path.join(MIG_DIR, MIGRATION), 'utf8');
  check('the file uses LF line endings (the Supabase runner and these suites read it byte for byte)', !sql.includes('\r'));
  const first = await attempt(() => db.exec(sql));
  check('the migration applies', first.ok, first);
  const second = await attempt(() => db.exec(sql));
  check('applying it again changes nothing and raises nothing', second.ok, second);

  console.log('\nS3 existing rows are untouched');
  const after = [await status(ID.D1), await status(ID.D2), await status(ID.D3)];
  check('every existing row keeps exactly the value it had (Passed, Flagged, Passed)', after.join() === before.join(), after);
  check('the column is still there with its legacy rows', (await db.query(`SELECT count(*)::int AS n FROM public.driver_verification WHERE face_verification_status IS NOT NULL`)).rows[0].n === 3);

  console.log('\nS4 new rows no longer claim a face check passed');
  check('the column has no default any more', (await columnDefault()) === null, await columnDefault());
  await db.exec(`DELETE FROM public.driver_verification WHERE driver_id = '${ID.D1}'`);                                       // D1 applies again: a brand new row
  await db.exec(`INSERT INTO public.driver_verification (driver_id) VALUES ('${ID.D1}')`);
  check('a new row is NULL (no face check was made), not Passed', (await status(ID.D1)) === null, await status(ID.D1));
  await db.exec(`DELETE FROM public.driver_verification WHERE driver_id = '${ID.D2}'`);
  await db.exec(`INSERT INTO public.driver_verification (driver_id, face_verification_status) VALUES ('${ID.D2}', 'Flagged')`);
  check('a value written explicitly is still stored as written (the column still works)', (await status(ID.D2)) === 'Flagged', await status(ID.D2));

  console.log('\nS5 nothing else about the table changed');
  const own = await attempt(() => asUser(db, { uid: ID.D3_AUTH }, (tx) =>
    tx.query(`UPDATE public.driver_verification SET remarks = 'documents re-uploaded', face_photo_path = 'x/selfie.jpg' WHERE driver_id = '${ID.D3}'`), { commit: true }));
  check('a driver can still save the review copy path on their own row', own.ok && own.value.rowCount === 1, own);
  const decide = await attempt(() => asUser(db, { uid: ID.D3_AUTH }, (tx) =>
    tx.query(`UPDATE public.driver_verification SET verification_status = 'Approved' WHERE driver_id = '${ID.D3}'`)));
  check('and still cannot decide their own application', !decide.ok && /Drivers cannot modify verification status/.test(decide.error), decide);
  const comment = (await db.query(`SELECT col_description('public.driver_verification'::regclass, a.attnum) AS c FROM pg_attribute a
                                    WHERE a.attrelid = 'public.driver_verification'::regclass AND a.attname = 'face_verification_status'`)).rows[0].c;
  check('the column is marked LEGACY', /^LEGACY\./.test(comment || ''), comment);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
