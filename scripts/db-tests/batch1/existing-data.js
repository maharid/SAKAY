// Regression: the Batch 1 migration must apply on a database that ALREADY has drivers.
// Supabase's preview database and the live project both have driver rows when Batch 1 runs;
// an empty database hides the problem (the affiliation backfill inserts nothing, so the
// insert trigger never fires). Also checks that the Batch 3 migrations apply on top of it.
const { newDb, applyFile, listMigrations } = require('../lib');
const { asUser, attempt, check, summary } = require('../tlib');

const BEFORE_BATCH1 = '20260927020000_fix_all_security_advisor_red_notices.sql';

(async () => {
  const db = await newDb();
  const files = listMigrations();
  for (const f of files) {
    if (f > BEFORE_BATCH1) break;
    await applyFile(db, f);
  }

  // Existing production-like data: drivers in different states, in an Active and a pending TODA.
  await db.exec(`
    INSERT INTO auth.users(id, email) VALUES
      ('20000000-0000-0000-0000-00000000000a','a@x.com'), ('20000000-0000-0000-0000-00000000000b','b@x.com'),
      ('20000000-0000-0000-0000-00000000000c','c@x.com'), ('20000000-0000-0000-0000-00000000000d','d@x.com'),
      ('20000000-0000-0000-0000-00000000000e','e@x.com');
    INSERT INTO public.toda(toda_id, toda_name, toda_status) VALUES
      ('c0000000-0000-0000-0000-00000000000a', 'Active TODA', 'Active'),
      ('c0000000-0000-0000-0000-00000000000b', 'Pending TODA', 'Pending Verification');
    INSERT INTO public.driver(driver_id, auth_user_id, full_name, contact_number, account_status, toda_id) VALUES
      ('b0000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-00000000000a','Verified Driver','+639180000011','Verified','c0000000-0000-0000-0000-00000000000a'),
      ('b0000000-0000-0000-0000-00000000000b','20000000-0000-0000-0000-00000000000b','Pending Driver','+639180000012','Pending Verification','c0000000-0000-0000-0000-00000000000b'),
      ('b0000000-0000-0000-0000-00000000000c','20000000-0000-0000-0000-00000000000c','Rejected Driver','+639180000013','Rejected','c0000000-0000-0000-0000-00000000000a'),
      ('b0000000-0000-0000-0000-00000000000d','20000000-0000-0000-0000-00000000000d','Suspended Driver','+639180000014','Suspended','c0000000-0000-0000-0000-00000000000a'),
      ('b0000000-0000-0000-0000-00000000000e','20000000-0000-0000-0000-00000000000e','No TODA Driver','+639180000015','Pending Verification', NULL);
    UPDATE public.driver SET endorsed_at = now() - interval '10 days', lgu_approved_at = now() - interval '9 days'
      WHERE driver_id IN ('b0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-00000000000d');
  `);

  let failedAt = null;
  let error = null;
  for (const f of files) {
    if (f <= BEFORE_BATCH1) continue;
    try {
      await applyFile(db, f);
    } catch (e) {
      failedAt = f;
      error = e.message;
      break;
    }
  }
  check('every migration after the first 21 applies on a database that already has drivers', failedAt === null,
    failedAt ? `${failedAt}: ${error}` : undefined);

  if (failedAt === null) {
    const aff = (await db.query(`SELECT driver_id, toda_endorsement_status s, lgu_verification_status l, is_active_selection a FROM driver_toda_affiliation ORDER BY driver_id`)).rows;
    check('one affiliation backfilled per driver that has a TODA (4 of 5)', aff.length === 4, aff);
    const byId = Object.fromEntries(aff.map((r) => [r.driver_id.slice(-1), r]));
    check('an approved driver is backfilled as Endorsed / Approved and active', byId.a?.s === 'Endorsed' && byId.a?.l === 'Approved' && byId.a?.a === true, byId.a);
    check('a pending driver is backfilled as Submitted / Pending', byId.b?.s === 'Submitted' && byId.b?.l === 'Pending', byId.b);
    check('a rejected driver is backfilled as Rejected', byId.c?.s === 'Rejected', byId.c);
    check('a driver without a TODA gets no affiliation', byId.e === undefined);

    const cols = (await db.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='driver' AND column_name IN ('is_permanently_disqualified','strikes_count','suspended_until')`)).rows[0].n;
    const cat = (await db.query('SELECT count(*)::int n FROM violation_catalog')).rows[0].n;
    check('Batch 1 and Batch 3 objects exist afterwards', cols === 3 && cat === 39, { cols, cat });

    // The new-application guard must still be active for real requests after the backfill.
    let blocked = null;
    try {
      await db.exec(`INSERT INTO public.driver_toda_affiliation(driver_id, toda_id, toda_endorsement_status, lgu_verification_status, is_active_selection)
        VALUES ('b0000000-0000-0000-0000-00000000000e','c0000000-0000-0000-0000-00000000000a','Endorsed','Approved',TRUE)`);
    } catch (e) { blocked = e.message; }
    check('new affiliation applications are still validated after the backfill (guard not left open)', blocked !== null && /Submitted and Pending|not Active|disqualified/i.test(blocked), blocked);

    // Batch 1 reads and writes toda.certificate_number / certificate_expiry (accreditation,
    // expiry cascade, the toda protection trigger, seed.sql). 20260828000003 drops them.
    const certCols = (await db.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name='toda' AND column_name IN ('certificate_number','certificate_expiry')`)).rows[0].n;
    check('toda has certificate_number and certificate_expiry (Batch 1 depends on them)', certCols === 2, certCols);

    const L_AUTH = '30000000-0000-0000-0000-000000000001';
    await db.exec(`INSERT INTO auth.users(id,email) VALUES ('${L_AUTH}','lgu@x.com');
      INSERT INTO public.lgu_admin(auth_user_id, full_name, email) VALUES ('${L_AUTH}','LGU Admin','lgu@x.com')`);
    const asLgu = (fn) => asUser(db, { uid: L_AUTH }, fn, { commit: true });

    const upd = await asLgu((tx) => attempt(() => tx.query(`UPDATE public.toda SET toda_name = 'Renamed' WHERE toda_id = 'c0000000-0000-0000-0000-00000000000a'`)));
    check('an LGU administrator can update a TODA (the toda protection trigger reads certificate_expiry)', upd.ok, upd);

    const approve = await asLgu((tx) => attempt(() => tx.query(
      `SELECT public.approve_toda_accreditation('c0000000-0000-0000-0000-00000000000b','CERT-2026-001', now() + interval '1 year', 'ok') r`)));
    check('approve_toda_accreditation works (writes certificate_number / certificate_expiry)', approve.ok, approve);

    const restricted = await attempt(() => db.query(`SELECT public.is_driver_documentarily_restricted('b0000000-0000-0000-0000-00000000000a') r`));
    check('is_driver_documentarily_restricted runs for a backfilled driver (gates going online)', restricted.ok, restricted);

    // Supabase's preview and `db reset` run supabase/seed.sql after the migrations.
    let seedError = null;
    try {
      await db.exec(require('fs').readFileSync(require('path').join(__dirname, '..', '..', '..', 'supabase', 'seed.sql'), 'utf8'));
    } catch (e) { seedError = e.message; }
    check('supabase/seed.sql applies after the migrations (as in Supabase preview / db reset)', seedError === null, seedError);
    if (seedError === null) {
      const seeded = (await db.query(`SELECT
        (SELECT count(*) FROM public.toda WHERE toda_status = 'Active')::int AS todas,
        (SELECT count(*) FROM public.lgu_admin)::int AS lgu,
        (SELECT count(*) FROM public.toda_admin)::int AS toda_admins,
        (SELECT count(*) FROM auth.users WHERE email IN ('admin@gmail.com', 'cctoda@toda.sakay.internal', 'bltoda@toda.sakay.internal',
                                                         'svtoda@toda.sakay.internal', 'lptoda@toda.sakay.internal'))::int AS seeded_logins,
        (SELECT count(*) FROM public.fare_matrix)::int AS fares`)).rows[0];
      // Perimeter lockdown (D-SEC-5): the seed holds master data only. It used to create an LGU administrator and TODA administrators
      // with passwords written in the file; no login account comes from it any more.
      check('the seed leaves 3 Active TODAs and a fare matrix, and creates NO login account (no administrator, nothing in auth.users)',
        seeded.todas === 3 && seeded.lgu === 0 && seeded.toda_admins === 0 && seeded.seeded_logins === 0 && seeded.fares >= 1, seeded);
    }
  }

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
