// Perimeter Lockdown S2 + S3 + S4 (20261008000003 .. 05): who can reach what, on the WHOLE migration chain. Local emulator only.
//   S2 function grants   S3 row policies and table privileges   S4 storage
// Actors: anon, a stranger (signed in, no role row: anybody can sign up), passengers P1/P2, drivers D1/D2/D3 (D1, D2 in TODA1; D3 in TODA2),
// TODA administrators T1/T2 and the LGU administrator L.
const { freshDb, asUser, attempt, check, summary } = require('../tlib');
const { setup, ID, asUser: asUserB5 } = require('../b5fixtures');
const { AFF } = require('../b4fixtures');
const fs = require('fs');
const path = require('path');

(async () => {
  const t = await setup();
  const { db, as, svc, q, one, book, assign, internal, offer } = t;
  const asRole = (role, fn) => asUserB5(db, { uid: null, role }, fn, { commit: true });
  const err = (r) => (r.ok ? null : String(r.error).slice(0, 150));
  const denied = (r) => !r.ok || (r.value.rows ? r.value.rows.length === 0 : r.value.rowCount === 0);
  const permDenied = (r) => !r.ok && /permission denied/.test(r.error);
  const idsOf = (r, col) => (r.ok ? r.value.rows.map((x) => x[col]).sort() : null);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // ---------------------------------------------------------------- world
  const stranger = (await one(`INSERT INTO auth.users (email) VALUES ('stranger@x.test') RETURNING id`)).id;
  await internal(`UPDATE toda SET toda_status='Active', account_status='Active' WHERE toda_id = '${ID.TODA1}';
                  UPDATE toda SET toda_status='Pending Verification', account_status='Pending Verification' WHERE toda_id = '${ID.TODA2}'`);
  const B1 = await book(ID.P_AUTH, ID.P1);                              // P1's open booking, offered to D2
  await offer(B1.booking_id, ID.D2);
  const B2 = await book(ID.P2_AUTH, ID.P2, { km: 4 });                  // P2's booking, taken by D1 (TODA1)
  await assign(B2.booking_id, ID.D1);
  await db.exec(`INSERT INTO public.driver_verification (driver_id) VALUES ('${ID.D1}'), ('${ID.D3}')`);
  await internal(`INSERT INTO public.notification (driver_id, title, message, notification_type) VALUES ('${ID.D1}', 'for D1', 'm', 'T');
                  INSERT INTO public.notification (recipient_id, title, message, notification_type) VALUES ('toda_${ID.TODA1}', 'for TODA1', 'm', 'T');
                  INSERT INTO public.notification (passenger_id, title, message, notification_type) VALUES ('${ID.P1}', 'for P1', 'm', 'T')`);
  const todaAdmin1 = (await one(`SELECT admin_id FROM public.toda_admin WHERE auth_user_id = '${ID.T_AUTH}'`)).admin_id;

  console.log('\nL1 anon has no table privilege and no function, apart from the TODA directory');
  const rels = await q(`SELECT c.relname, c.relkind, (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum LIMIT 1) AS firstcol FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v', 'p') ORDER BY 1`);
  const leaks = [];
  for (const r of rels) {
    for (const [op, sql] of [['select', `SELECT * FROM public."${r.relname}" LIMIT 1`], ['insert', `INSERT INTO public."${r.relname}" DEFAULT VALUES`],
                             ['update', `UPDATE public."${r.relname}" SET "${r.firstcol}" = "${r.firstcol}" WHERE FALSE`], ['delete', `DELETE FROM public."${r.relname}" WHERE FALSE`]]) {
      if (r.relkind === 'v' && op !== 'select') continue;
      const res = await attempt(() => asRole('anon', (tx) => tx.query(sql)));
      if (!permDenied(res)) leaks.push(`${r.relname}:${op}:${err(res)}`);
    }
  }
  check(`anon is refused (permission denied) for select / insert / update / delete on all ${rels.length} relations in public`, leaks.length === 0, leaks.slice(0, 6));
  const anonFns = (await q(`SELECT p.proname FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f','p')
                             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e') AND has_function_privilege('anon', p.oid, 'EXECUTE')`)).map((r) => r.proname);
  check('the only function anon can execute is list_accredited_todas', same(anonFns, ['list_accredited_todas']), anonFns);
  const publicFns = (await q(`SELECT p.proname FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f','p')
                               AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
                               AND EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')`)).map((r) => r.proname);
  check('no function carries the implicit PUBLIC grant any more', publicFns.length === 0, publicFns);
  const dir = await attempt(() => asRole('anon', (tx) => tx.query(`SELECT toda_id FROM public.list_accredited_todas()`)));
  check('...and that one works for anon (the registration picker)', dir.ok && same(idsOf(dir, 'toda_id'), [ID.TODA1]), err(dir));
  const pol = await q(`SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' AND roles && ARRAY['anon', 'public']::name[]`);
  check('no policy in public names anon or public', pol.length === 0, pol);
  const trueOnes = (await q(`SELECT tablename || '.' || policyname AS p FROM pg_policies WHERE schemaname = 'public' AND cmd IN ('SELECT','ALL') AND qual = 'true' ORDER BY 1`)).map((r) => r.p);
  check('the only policies that let every signed-in user read everything are the reference tables',
    same(trueOnes, ['announcement.announcement_select_policy', 'service_area_config.service_area_config_select', 'system_policy_config.system_policy_config_select', 'violation_catalog.violation_catalog_select']), trueOnes);
  const writeTrue = (await q(`SELECT tablename || '.' || policyname AS p FROM pg_policies WHERE schemaname = 'public' AND cmd IN ('INSERT','UPDATE','DELETE','ALL') AND (with_check = 'true' OR (cmd <> 'INSERT' AND qual = 'true'))`)).map((r) => r.p);
  check('no policy lets every signed-in user write', writeTrue.length === 0, writeTrue);
  const noRls = (await q(`SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p') AND NOT relrowsecurity`)).map((r) => r.relname);
  check('row security is on for every table in public', noRls.length === 0, noRls);
  const trunc = (await q(`SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p') AND (has_table_privilege('authenticated', oid, 'TRUNCATE') OR has_table_privilege('authenticated', oid, 'REFERENCES') OR has_table_privilege('authenticated', oid, 'TRIGGER'))`)).map((r) => r.relname);
  check('signed-in users hold no TRUNCATE / REFERENCES / TRIGGER (TRUNCATE ignores row security)', trunc.length === 0, trunc);

  console.log('\nL2 function grants: signed-in users lose only the five server-only functions');
  const pre = await freshDb('20261008000002_perimeter_expand.sql');                 // the database as it was before S2
  const authFns = async (d) => (await d.query(`SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS f FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f','p')
                                                AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e') AND has_function_privilege('authenticated', p.oid, 'EXECUTE')`)).rows.map((r) => r.f);
  const before = new Set(await authFns(pre));
  const afterSet = new Set(await authFns(db));
  // 20261010000005 replaced verify_driver_affiliation(uuid, text, date, date) by a version with one more (defaulted) argument on purpose:
  // the old signature disappears and the new one appears, so a changed signature is not a function "taken" from signed-in users.
  // Batch 6 (20261015000003) DROPPED three functions of the old offer model on purpose (they are gone for everybody, not taken by a grant): the
  // passenger-callable list of nearby drivers and the two row-policy helpers of the old "passenger writes offers / driver claims" design.
  const lost = [...before].filter((f) => !afterSet.has(f) && !/^(verify_driver_affiliation|find_candidate_drivers|rls_booking_open_and_mine|rls_driver_can_claim_booking)\(/.test(f)).sort();
  const gained = [...afterSet].filter((f) => !before.has(f)).sort();
  check('exactly the five server-only functions were taken from signed-in users', same(lost.map((f) => f.split('(')[0]), ['activate_passenger_otp', 'check_otp_lockout', 'check_toda_excess_incidents', 'increment_failed_otp', 'reset_failed_otp']), lost);
  // 20261009000002 (multi-TODA registration) and 20261010000001 (return for correction per document) add functions on purpose.
  // 20261012000002 (Day 1) adds driver_pause_bookings / driver_resume_bookings: the signed-in driver calls them from the app.
  // 20261013000001 (Day 2) adds send_toda_driver_reminder: the signed-in TODA administrator calls it from the portal.
  // 20261013000002 (Day 2) adds get_assigned_driver_photo: the passenger of a live trip calls it from the trip screen.
  // 20261014000001 (Day 2) adds update_toda_roster_entry: the signed-in TODA administrator edits a roster entry from the portal.
  // 20261014000002 adds retry_driver_search: the passenger restarts the search for their own booking from the trip screen.
  // 20261015000002 / 20261015000003 (Batch 6) add the calls of the server-side dispatch: the driver accepts / declines / cancels and reads his
  // offer, the passenger reads the state of the search, anybody's poll may run the sweep, and the LGU administrator reads / sets two settings.
  check('...and nothing was added for them (the S3 / S4 helpers and the 20261009 / 20261010 affiliation, document-return and roster-match functions, and the Day 1 / Day 2 functions, aside)',
    gained.every((f) => /^storage_can_read_/.test(f) || /^(apply_driver_toda_affiliations|toda_admin_has_affiliation_with_driver|return_driver_documents|resubmit_driver_documents|get_affiliation_document_reviews|get_my_application_review|rls_affiliation_in_my_toda|get_affiliation_roster_matches|verify_driver_affiliation|driver_pause_bookings|driver_resume_bookings|send_toda_driver_reminder|get_assigned_driver_photo|update_toda_roster_entry|retry_driver_search|accept_booking_offer|decline_booking_offer|get_my_pending_offer|get_dispatch_status|dispatch_sweep|driver_cancel_booking|get_dispatch_settings|set_dispatch_setting|driver_report_delay|get_arrival_wait_status|passenger_extend_wait|driver_report_no_show|use_city_service_area)\(/.test(f)), gained);
  check(`signed-in users keep ${afterSet.size} functions (policy helpers, RPCs, workflow functions)`, afterSet.size > 60, afterSet.size);
  const serverOnly = await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`SELECT public.activate_passenger_otp('+639170000001')`)));
  check('a signed-in passenger cannot activate an account (activate_passenger_otp)', permDenied(serverOnly), err(serverOnly));
  const lockPoke = await attempt(() => as(ID.P2_AUTH, (tx) => tx.query(`SELECT public.increment_failed_otp('${ID.P1}')`)));
  check('...nor lock somebody out (increment_failed_otp)', permDenied(lockPoke), err(lockPoke));
  const svcOtp = await attempt(() => svc((tx) => tx.query(`SELECT public.check_otp_lockout('+639170000001') AS r`)));
  check('the server (service role) still can', svcOtp.ok && svcOtp.value.rows[0].r.is_locked === false, err(svcOtp));
  await internal(`CREATE FUNCTION public.zz_probe_fn() RETURNS int LANGUAGE sql AS 'SELECT 1'; CREATE TABLE public.zz_probe_t (id int)`);
  const nf = await one(`SELECT has_function_privilege('anon', 'public.zz_probe_fn()', 'EXECUTE') a, has_function_privilege('authenticated', 'public.zz_probe_fn()', 'EXECUTE') u, has_function_privilege('service_role', 'public.zz_probe_fn()', 'EXECUTE') s,
                               has_table_privilege('anon', 'public.zz_probe_t', 'SELECT') ta, has_table_privilege('authenticated', 'public.zz_probe_t', 'SELECT') tu, has_table_privilege('authenticated', 'public.zz_probe_t', 'TRUNCATE') tt`);
  check('a function created from now on is closed to anon and signed-in users until a migration opens it', !nf.a && !nf.u && nf.s, nf);
  check('a table created from now on has no anon grant and no TRUNCATE for signed-in users', !nf.ta && nf.tu && !nf.tt, nf);
  await db.exec(`DROP FUNCTION public.zz_probe_fn(); DROP TABLE public.zz_probe_t`);
  await pre.close();

  console.log('\nL3 passenger');
  const seeP = async (a) => idsOf(await attempt(() => a((tx) => tx.query(`SELECT passenger_id FROM public.passenger`))), 'passenger_id');
  check('a passenger sees only their own record', same(await seeP((f) => as(ID.P_AUTH, f)), [ID.P1]));
  check('a stranger, a driver and a TODA administrator see no passenger at all', same(await seeP((f) => as(stranger, f)), []) && same(await seeP((f) => as(ID.D_AUTH, f)), []) && same(await seeP((f) => as(ID.T_AUTH, f)), []));
  check('the LGU administrator sees all passengers', same(await seeP((f) => as(ID.L_AUTH, f)), [ID.P1, ID.P2].sort()));
  const upOther = await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`UPDATE public.passenger SET full_name = 'Hijack' WHERE passenger_id = '${ID.P2}'`)));
  check('a passenger cannot edit another passenger (no row is touched)', denied(upOther), err(upOther));
  const upOwn = await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`UPDATE public.passenger SET full_name = 'Pax One Renamed' WHERE passenger_id = '${ID.P1}'`)));
  check('...but can edit their own', upOwn.ok && upOwn.value.rowCount === 1, err(upOwn));
  const ins = await attempt(() => as(stranger, (tx) => tx.query(`INSERT INTO public.passenger (auth_user_id, full_name, contact_number) VALUES ('${stranger}', 'Stranger', '+639175550001') RETURNING account_status`)));
  check('a stranger can register themselves: the record is Pending OTP Verification', ins.ok && ins.value.rows[0].account_status === 'Pending OTP Verification', err(ins));
  const insOther = await attempt(() => as(stranger, (tx) => tx.query(`INSERT INTO public.passenger (auth_user_id, full_name, contact_number) VALUES ('${ID.D_AUTH}', 'Fake', '+639175550002')`)));
  check('...but cannot create a passenger record for somebody else', !insOther.ok && /row-level security/.test(insOther.error), err(insOther));
  const selfActive = await attempt(() => as(stranger, (tx) => tx.query(`UPDATE public.passenger SET account_status = 'Active' WHERE auth_user_id = '${stranger}'`)));
  check('a Pending passenger cannot activate themselves any more (no OTP, no activation)', !selfActive.ok && /cannot modify their own account_status/.test(selfActive.error), err(selfActive));
  const srvActive = await attempt(() => svc((tx) => tx.query(`UPDATE public.passenger SET account_status = 'Active' WHERE auth_user_id = '${stranger}' RETURNING account_status`)));
  check('the server (service role) activates it after the OTP check', srvActive.ok && srvActive.value.rows[0].account_status === 'Active', err(srvActive));

  console.log('\nL4 driver and driver_verification');
  const seeD = async (a) => idsOf(await attempt(() => a((tx) => tx.query(`SELECT driver_id FROM public.driver`))), 'driver_id');
  check('a driver sees only their own record', same(await seeD((f) => as(ID.D_AUTH, f)), [ID.D1]));
  check('a passenger and a stranger see no driver', same(await seeD((f) => as(ID.P_AUTH, f)), []) && same(await seeD((f) => as(stranger, f)), []));
  // 20261009000002: a TODA administrator also sees a driver who has an AFFILIATION with their TODA (D2 applied to both TODAs), read only.
  check('a TODA administrator sees the drivers of their own TODA and the drivers who applied to it (read only), nobody else',
    same(await seeD((f) => as(ID.T_AUTH, f)), [ID.D1, ID.D2].sort()) && same(await seeD((f) => as(ID.T2_AUTH, f)), [ID.D2, ID.D3].sort()));
  check('the LGU administrator sees all drivers', same(await seeD((f) => as(ID.L_AUTH, f)), [ID.D1, ID.D2, ID.D3].sort()));
  const dUpOther = await attempt(() => as(ID.D2_AUTH, (tx) => tx.query(`UPDATE public.driver SET assigned_terminal = 'x' WHERE driver_id = '${ID.D1}'`)));
  check('a driver cannot edit another driver', denied(dUpOther), err(dUpOther));
  const dUpToda = await attempt(() => as(ID.T2_AUTH, (tx) => tx.query(`UPDATE public.driver SET assigned_terminal = 'x' WHERE driver_id = '${ID.D1}'`)));
  check('a TODA administrator cannot edit a driver of another TODA', denied(dUpToda), err(dUpToda));
  const dSelfVer = await attempt(() => as(stranger, (tx) => tx.query(`INSERT INTO public.driver (auth_user_id, full_name, contact_number, account_status) VALUES ('${stranger}', 'S', '+639185550001', 'Verified')`)));
  check('a stranger cannot insert themselves as a Verified driver', !dSelfVer.ok, err(dSelfVer));
  const vSee = async (a) => idsOf(await attempt(() => a((tx) => tx.query(`SELECT driver_id FROM public.driver_verification`))), 'driver_id');
  check('a driver sees only their own verification; another driver sees nothing of it', same(await vSee((f) => as(ID.D_AUTH, f)), [ID.D1]) && same(await vSee((f) => as(ID.D2_AUTH, f)), []));
  check('the TODA administrator sees their drivers\' verifications, not another TODA\'s', same(await vSee((f) => as(ID.T_AUTH, f)), [ID.D1]) && same(await vSee((f) => as(ID.T2_AUTH, f)), [ID.D3]));
  check('the LGU administrator sees both', same(await vSee((f) => as(ID.L_AUTH, f)), [ID.D1, ID.D3].sort()));
  const vForOther = await attempt(() => as(ID.D2_AUTH, (tx) => tx.query(`INSERT INTO public.driver_verification (driver_id) VALUES ('${ID.D1}')`)));
  check('a driver cannot file a verification for somebody else\'s driver record', !vForOther.ok && /row-level security/.test(vForOther.error), err(vForOther));

  console.log('\nL5 booking, dispatch_attempt');
  const seeB = async (a) => idsOf(await attempt(() => a((tx) => tx.query(`SELECT booking_id FROM public.booking`))), 'booking_id');
  check('a passenger sees only their own bookings', same(await seeB((f) => as(ID.P_AUTH, f)), [B1.booking_id]) && same(await seeB((f) => as(ID.P2_AUTH, f)), [B2.booking_id]));
  check('a stranger sees none', same(await seeB((f) => as(stranger, f)), []));
  check('a driver sees the booking they are on, and the one they hold an offer for, nothing else',
    same(await seeB((f) => as(ID.D_AUTH, f)), [B2.booking_id]) && same(await seeB((f) => as(ID.D2_AUTH, f)), [B1.booking_id]) && same(await seeB((f) => as(ID.D3_AUTH, f)), []));
  check('a TODA administrator sees the bookings of their drivers; the other TODA sees none', same(await seeB((f) => as(ID.T_AUTH, f)), [B2.booking_id]) && same(await seeB((f) => as(ID.T2_AUTH, f)), []));
  check('the LGU administrator sees all', same(await seeB((f) => as(ID.L_AUTH, f)), [B1.booking_id, B2.booking_id].sort()));
  const bInsOther = await attempt(() => book(stranger, ID.P1));
  check('somebody who is not the passenger cannot book in their name', !bInsOther.ok, err(bInsOther));
  const upOtherB = await attempt(() => as(ID.P2_AUTH, (tx) => tx.query(`UPDATE public.booking SET booking_status = 'Cancelled', cancelled_by = 'passenger' WHERE booking_id = '${B1.booking_id}'`)));
  check('another passenger cannot cancel a booking that is not theirs', denied(upOtherB), err(upOtherB));
  const claimNoOffer = await attempt(() => as(ID.D3_AUTH, (tx) => tx.query(`UPDATE public.booking SET driver_id = '${ID.D3}', booking_status = 'Accepted' WHERE booking_id = '${B1.booking_id}' RETURNING driver_id`)));
  check("a driver with no offer cannot take an open booking", denied(claimNoOffer), err(claimNoOffer));
  const claimWrongId = await attempt(() => as(ID.D2_AUTH, (tx) => tx.query(`UPDATE public.booking SET driver_id = '${ID.D3}', booking_status = 'Accepted' WHERE booking_id = '${B1.booking_id}' RETURNING driver_id`)));
  check("a driver holding an offer cannot assign the booking to somebody else", denied(claimWrongId), err(claimWrongId));
  const claimSelf = await attempt(() => as(ID.D2_AUTH, (tx) => tx.query(`UPDATE public.booking SET driver_id = '${ID.D2}', booking_status = 'Accepted', accepted_at = now() WHERE booking_id = '${B1.booking_id}' RETURNING driver_id`)));
  check("not even a driver holding the offer can attach himself with a plain UPDATE: the only way is accept_booking_offer (Batch 6)", denied(claimSelf), err(claimSelf));
  const offerId = (await q(`SELECT attempt_id FROM public.dispatch_attempt WHERE booking_id = '${B1.booking_id}' AND driver_id = '${ID.D2}' AND response_status = 'Pending' LIMIT 1`))[0]?.attempt_id;
  await t.rpc(ID.D2_AUTH, 'select_active_driver_affiliation', ['e2000000-0000-0000-0000-000000000001']);   // D2 has two TODAs: it picks TODA One, then goes Online (accepting needs an Online driver)
  await t.goOnline(ID.D2_AUTH);
  const acceptOk = await attempt(() => as(ID.D2_AUTH, (tx) => tx.query(`SELECT public.accept_booking_offer($1) AS r`, [offerId])));
  check("the driver holding the offer takes the booking through accept_booking_offer (exactly what the app does)", acceptOk.ok && acceptOk.value.rows[0].r.success === true && (await one(`SELECT driver_id FROM public.booking WHERE booking_id = '${B1.booking_id}'`)).driver_id === ID.D2, err(acceptOk));
  const claimTwice = await attempt(() => as(ID.D3_AUTH, (tx) => tx.query(`UPDATE public.booking SET driver_id = '${ID.D3}' WHERE booking_id = '${B1.booking_id}' RETURNING driver_id`)));
  check("once taken, nobody else can take it", denied(claimTwice), err(claimTwice));

  await svc((tx) => tx.query(`UPDATE public.booking SET booking_status = 'Completed' WHERE booking_id = '${B2.booking_id}'`));
  const B4 = await book(ID.P2_AUTH, ID.P2, { km: 3 });
  await offer(B4.booking_id, ID.D3);
  const attIns = await attempt(() => as(ID.P2_AUTH, (tx) => tx.query(`INSERT INTO public.dispatch_attempt (booking_id, driver_id, dispatch_method, response_status) VALUES ('${B4.booking_id}', '${ID.D3}', 'Sequential Tiered', 'Pending') RETURNING attempt_id`)));
  check("a passenger can no longer write offers (the database makes them): permission denied", !attIns.ok && /permission denied/.test(attIns.error), err(attIns));
  const attOther = await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`INSERT INTO public.dispatch_attempt (booking_id, driver_id, dispatch_method, response_status) VALUES ('${B4.booking_id}', '${ID.D3}', 'Sequential Tiered', 'Pending')`)));
  check("...for anybody's booking", !attOther.ok && /permission denied/.test(attOther.error), err(attOther));
  const seeA = async (a) => idsOf(await attempt(() => a((tx) => tx.query(`SELECT driver_id FROM public.dispatch_attempt WHERE booking_id = '${B4.booking_id}'`))), 'driver_id');
  check("an offer is visible to the driver it was made to and to the LGU, and to nobody else (not even the passenger: which drivers were asked is not theirs to know)",
    same(await seeA((f) => as(ID.D3_AUTH, f)), [ID.D3]) && same(await seeA((f) => as(ID.P2_AUTH, f)), []) && same(await seeA((f) => as(ID.P_AUTH, f)), [])
    && same(await seeA((f) => as(ID.D2_AUTH, f)), []) && same(await seeA((f) => as(ID.T2_AUTH, f)), []) && same(await seeA((f) => as(ID.L_AUTH, f)), [ID.D3]));
  const attAnswer = await attempt(() => as(ID.D3_AUTH, (tx) => tx.query(`UPDATE public.dispatch_attempt SET response_status = 'Declined', responded_at = now() WHERE booking_id = '${B4.booking_id}' AND driver_id = '${ID.D3}' RETURNING response_status`)));
  check("a driver can no longer answer an offer by writing it: he declines through decline_booking_offer", !attAnswer.ok && /permission denied/.test(attAnswer.error), err(attAnswer));
  const attMeddle = await attempt(() => as(ID.D2_AUTH, (tx) => tx.query(`UPDATE public.dispatch_attempt SET response_status = 'Declined' WHERE booking_id = '${B4.booking_id}'`)));
  check("and another driver cannot touch it", !attMeddle.ok && /permission denied/.test(attMeddle.error), err(attMeddle));

  console.log('\nL6 notification, incident_report, rating, cancellation_record, audit_log');
  const seeN = async (a) => (await attempt(() => a((tx) => tx.query(`SELECT title FROM public.notification ORDER BY title`)))).value?.rows.map((r) => r.title) ?? null;
  check('notifications: a driver sees theirs, a passenger theirs, the TODA administrator the TODA\'s, a stranger none, the LGU all',
    same(await seeN((f) => as(ID.D_AUTH, f)), ['for D1']) && same(await seeN((f) => as(ID.P_AUTH, f)), ['for P1']) && same(await seeN((f) => as(ID.T_AUTH, f)), ['for TODA1'])
    && same(await seeN((f) => as(stranger, f)), []) && same(await seeN((f) => as(ID.L_AUTH, f)), ['for D1', 'for P1', 'for TODA1']));
  const nIns = await attempt(() => as(ID.D_AUTH, (tx) => tx.query(`INSERT INTO public.notification (driver_id, title, message, notification_type) VALUES ('${ID.D1}', 'mine', 'm', 'Driver Resubmission')`)));
  check('a driver can leave a note about their own application', nIns.ok, err(nIns));
  const nInsOther = await attempt(() => as(ID.D_AUTH, (tx) => tx.query(`INSERT INTO public.notification (driver_id, title, message, notification_type) VALUES ('${ID.D2}', 'spam', 'm', 'T')`)));
  check('...but cannot write into another driver\'s notifications', !nInsOther.ok && /row-level security/.test(nInsOther.error), err(nInsOther));
  const nInsPax = await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`INSERT INTO public.notification (passenger_id, title, message, notification_type) VALUES ('${ID.P2}', 'spam', 'm', 'T')`)));
  check('a passenger cannot write notifications for anybody', !nInsPax.ok, err(nInsPax));

  const incOwn = await attempt(() => as(ID.P2_AUTH, (tx) => tx.query(`INSERT INTO public.incident_report (booking_id, passenger_id, driver_id, reported_by, category, description) VALUES ('${B2.booking_id}', '${ID.P2}', '${ID.D1}', 'Passenger', 'Overcharging', 'x') RETURNING incident_id`)));
  check('a passenger can file an incident about their own booking', incOwn.ok, err(incOwn));
  const incOther = await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`INSERT INTO public.incident_report (booking_id, passenger_id, reported_by, category, description) VALUES ('${B2.booking_id}', '${ID.P1}', 'Passenger', 'Overcharging', 'x')`)));
  // Refused either by the row policy or, since Day 1 (20261012000001), by the incident guard that runs first.
  check('...but not about a booking they were not on', !incOther.ok && /row-level security|ERR_INCIDENT_NOT_PARTICIPANT/.test(incOther.error), err(incOther));
  const seeI = async (a) => (await attempt(() => a((tx) => tx.query(`SELECT incident_id FROM public.incident_report`)))).value?.rows.length ?? null;
  check('the incident is visible to the passenger, the driver on the booking, their TODA administrator and the LGU; not to others',
    (await seeI((f) => as(ID.P2_AUTH, f))) === 1 && (await seeI((f) => as(ID.D_AUTH, f))) === 1 && (await seeI((f) => as(ID.T_AUTH, f))) === 1 && (await seeI((f) => as(ID.L_AUTH, f))) === 1
    && (await seeI((f) => as(ID.P_AUTH, f))) === 0 && (await seeI((f) => as(ID.T2_AUTH, f))) === 0 && (await seeI((f) => as(stranger, f))) === 0);

  await internal(`INSERT INTO public.rating (booking_id, rater_id, ratee_id, rater_role, stars) VALUES ('${B2.booking_id}', '${ID.P2}', '${ID.D1}', 'Passenger', 5)`);
  const seeR = async (a) => (await attempt(() => a((tx) => tx.query(`SELECT rating_id FROM public.rating`)))).value?.rows.length ?? null;
  check('a rating is visible to the two people it is between and the LGU, not to others',
    (await seeR((f) => as(ID.P2_AUTH, f))) === 1 && (await seeR((f) => as(ID.D_AUTH, f))) === 1 && (await seeR((f) => as(ID.L_AUTH, f))) === 1 && (await seeR((f) => as(ID.P_AUTH, f))) === 0 && (await seeR((f) => as(stranger, f))) === 0);
  const rIns = await attempt(() => as(stranger, (tx) => tx.query(`INSERT INTO public.rating (booking_id, rater_id, ratee_id, rater_role, stars) VALUES ('${B2.booking_id}', '${ID.P2}', '${ID.D1}', 'Passenger', 1)`)));
  check('a stranger cannot rate a driver', !rIns.ok, err(rIns));

  const cIns = await attempt(() => as(ID.P2_AUTH, (tx) => tx.query(`INSERT INTO public.cancellation_record (booking_id, cancelled_by) VALUES ('${B2.booking_id}', 'passenger')`)));
  check('nobody writes a cancellation record from a browser', !cIns.ok, err(cIns));
  const sIns = await attempt(() => as(ID.P2_AUTH, (tx) => tx.query(`INSERT INTO public.shared_trip_match (primary_booking_id) VALUES ('${B2.booking_id}')`)));
  check('nobody writes a shared-trip match from a browser', !sIns.ok, err(sIns));

  const aIns = await attempt(() => as(stranger, (tx) => tx.query(`INSERT INTO public.audit_log (action_type, details) VALUES ('X', 'forged')`)));
  check('a stranger cannot write the audit log', !aIns.ok && /row-level security/.test(aIns.error), err(aIns));
  const aPax = await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`INSERT INTO public.audit_log (action_type, details) VALUES ('X', 'forged')`)));
  check('a passenger cannot write the audit log', !aPax.ok, err(aPax));
  const aToda = await attempt(() => as(ID.T_AUTH, (tx) => tx.query(`INSERT INTO public.audit_log (action_type, details) VALUES ('TODA_TEST', 'ok') RETURNING toda_admin_id`)));
  check('a TODA administrator can, and the row is stamped with their admin id', aToda.ok && aToda.value.rows[0].toda_admin_id === todaAdmin1, err(aToda));
  const seeAudit = async (a) => (await attempt(() => a((tx) => tx.query(`SELECT 1 FROM public.audit_log`)))).value?.rows.length ?? null;
  check('audit log: the LGU reads it all, a TODA administrator only their own rows, others nothing',
    (await seeAudit((f) => as(ID.L_AUTH, f))) >= 1 && (await seeAudit((f) => as(ID.T_AUTH, f))) === 1 && (await seeAudit((f) => as(ID.T2_AUTH, f))) === 0 && (await seeAudit((f) => as(ID.P_AUTH, f))) === 0);

  console.log('\nL7 toda, toda_admin');
  const seeT = async (a) => idsOf(await attempt(() => a((tx) => tx.query(`SELECT toda_id FROM public.toda`))), 'toda_id');
  check('a TODA administrator sees their own TODA; a stranger, a passenger and a driver see no TODA row (they use list_accredited_todas)',
    same(await seeT((f) => as(ID.T_AUTH, f)), [ID.TODA1]) && same(await seeT((f) => as(stranger, f)), []) && same(await seeT((f) => as(ID.P_AUTH, f)), []) && same(await seeT((f) => as(ID.D_AUTH, f)), []));
  check('the LGU administrator sees both TODAs', same(await seeT((f) => as(ID.L_AUTH, f)), [ID.TODA1, ID.TODA2].sort()));
  const tIns = await attempt(() => as(stranger, (tx) => tx.query(`INSERT INTO public.toda (toda_name, account_status) VALUES ('Fake TODA', 'Pending Verification')`)));
  check('nobody but the LGU inserts a TODA with a table insert (registration is an RPC)', !tIns.ok && /row-level security/.test(tIns.error), err(tIns));
  const taIns = await attempt(() => as(stranger, (tx) => tx.query(`INSERT INTO public.toda_admin (auth_user_id, toda_id, full_name, email, account_status) VALUES ('${stranger}', '${ID.TODA1}', 'Mallory', 'm@x.test', 'Active')`)));
  check('a stranger cannot make themselves a TODA administrator', !taIns.ok && /row-level security/.test(taIns.error), err(taIns));
  const taSee = async (a) => (await attempt(() => a((tx) => tx.query(`SELECT 1 FROM public.toda_admin`)))).value?.rows.length ?? null;
  check('TODA administrators see their own TODA\'s administrators only; a stranger none', (await taSee((f) => as(ID.T_AUTH, f))) === 1 && (await taSee((f) => as(ID.T2_AUTH, f))) === 1 && (await taSee((f) => as(stranger, f))) === 0 && (await taSee((f) => as(ID.L_AUTH, f))) === 2);
  const refData = await attempt(() => as(stranger, (tx) => tx.query(`SELECT (SELECT count(*) FROM public.service_area_config) a, (SELECT count(*) FROM public.system_policy_config) b`)));
  check('reference data (service area, policy constants) is readable by a signed-in user', refData.ok && Number(refData.value.rows[0].a) >= 0, err(refData));

  console.log('\nL8 storage');
  // The hosted project also has the hand-made public 'profiles' bucket (no migration creates it): add it as it is there, run S4 again, and see it flip.
  await internal(`INSERT INTO storage.buckets (id, name, public) VALUES ('profiles', 'profiles', TRUE)`);
  const s4sql = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261008000005_perimeter_storage.sql'), 'utf8');
  const reS4 = await attempt(() => db.exec(s4sql));
  const buckets = await q(`SELECT id, public FROM storage.buckets ORDER BY id`);
  check('all 10 buckets exist and every one is private (including the hand-made profiles bucket)', reS4.ok && buckets.length === 10 && buckets.every((b) => b.public === false), buckets.length + ' buckets; ' + buckets.filter((b) => b.public).map((b) => b.id));
  const putS = (uid, bucket, name) => attempt(() => as(uid, (tx) => tx.query(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ($1, $2, $3) RETURNING id`, [bucket, name, uid])));
  const canSee = async (uid, bucket, name) => (await attempt(() => as(uid, (tx) => tx.query(`SELECT 1 FROM storage.objects WHERE bucket_id = $1 AND name = $2`, [bucket, name])))).value?.rows.length === 1;
  const anonSee = async (bucket, name) => { const r = await attempt(() => asRole('anon', (tx) => tx.query(`SELECT 1 FROM storage.objects WHERE bucket_id = $1 AND name = $2`, [bucket, name]))); return r.ok ? r.value.rows.length === 1 : false; };

  const lic = `${ID.D_AUTH}/license_front.jpg`;
  check('a driver uploads into their own folder of driver-licenses and mtop-permits', (await putS(ID.D_AUTH, 'driver-licenses', lic)).ok && (await putS(ID.D_AUTH, 'mtop-permits', `${ID.D_AUTH}/mtop.jpg`)).ok);
  const putOther = await putS(ID.D2_AUTH, 'driver-licenses', `${ID.D_AUTH}/evil.jpg`);
  check('...but not into somebody else\'s folder, and not into a flat name', !putOther.ok && /row-level security/.test(putOther.error) && !(await putS(ID.D2_AUTH, 'driver-licenses', 'flat.jpg')).ok, err(putOther));
  const putAnon = await attempt(() => asRole('anon', (tx) => tx.query(`INSERT INTO storage.objects (bucket_id, name) VALUES ('driver-licenses', 'anon/x.jpg')`)));
  check('anon cannot upload anywhere', !putAnon.ok, err(putAnon));
  const over = await attempt(() => as(ID.D2_AUTH, (tx) => tx.query(`UPDATE storage.objects SET name = name WHERE bucket_id = 'driver-licenses' AND name = '${lic}'`)));
  check('another driver cannot overwrite a driver\'s file (it used to be possible for anybody)', denied(over), err(over));
  const del = await attempt(() => as(ID.D2_AUTH, (tx) => tx.query(`DELETE FROM storage.objects WHERE bucket_id = 'driver-licenses' AND name = '${lic}'`)));
  check('...nor delete it', denied(del), err(del));
  check('read: the driver, their TODA administrator and the LGU can; another TODA\'s administrator, a passenger, a stranger and anon cannot',
    (await canSee(ID.D_AUTH, 'driver-licenses', lic)) && (await canSee(ID.T_AUTH, 'driver-licenses', lic)) && (await canSee(ID.L_AUTH, 'driver-licenses', lic))
    && !(await canSee(ID.T2_AUTH, 'driver-licenses', lic)) && !(await canSee(ID.P_AUTH, 'driver-licenses', lic)) && !(await canSee(stranger, 'driver-licenses', lic)) && !(await anonSee('driver-licenses', lic)));
  check('a driver cannot see another driver\'s documents', !(await canSee(ID.D2_AUTH, 'driver-licenses', lic)));

  const myDoc = `${stranger}/clearance.pdf`;
  check('a TODA registrant (signed up, no role yet) uploads into their own folder of the TODA buckets', (await putS(stranger, 'barangay-clearances', myDoc)).ok && (await putS(stranger, 'toda-bylaws', `${stranger}/bylaws.pdf`)).ok && (await putS(stranger, 'toda-accredited-driver-lists', `${stranger}/list.csv`)).ok);
  check('...a flat file name is refused', !(await putS(stranger, 'toda-bylaws', 'bylaws-flat.pdf')).ok);
  check('...the uploader and the LGU read it; other users do not', (await canSee(stranger, 'barangay-clearances', myDoc)) && (await canSee(ID.L_AUTH, 'barangay-clearances', myDoc)) && !(await canSee(ID.T_AUTH, 'barangay-clearances', myDoc)) && !(await canSee(ID.P_AUTH, 'barangay-clearances', myDoc)));
  await internal(`INSERT INTO storage.objects (bucket_id, name) VALUES ('toda-bylaws', 'legacy-bylaws.pdf'); UPDATE public.toda SET bylaws_url = 'legacy-bylaws.pdf' WHERE toda_id = '${ID.TODA1}'`);
  check('an older flat-named file is read through the TODA record that points at it (administrator of that TODA, LGU), and by nobody else',
    (await canSee(ID.T_AUTH, 'toda-bylaws', 'legacy-bylaws.pdf')) && (await canSee(ID.L_AUTH, 'toda-bylaws', 'legacy-bylaws.pdf')) && !(await canSee(ID.T2_AUTH, 'toda-bylaws', 'legacy-bylaws.pdf')) && !(await canSee(ID.D_AUTH, 'toda-bylaws', 'legacy-bylaws.pdf')) && !(await anonSee('toda-bylaws', 'legacy-bylaws.pdf')));

  const pPhoto = `${ID.P2_AUTH}/avatar.jpg`;
  await putS(ID.P2_AUTH, 'profiles', pPhoto);
  await assign(B4.booking_id, ID.D1);                                       // D1 is now on P2's live trip
  check('a profile photo is read by its owner and by the other party of a live trip', (await canSee(ID.P2_AUTH, 'profiles', pPhoto)) && (await canSee(ID.D_AUTH, 'profiles', pPhoto)));
  check('...not by another driver, another passenger or anon', !(await canSee(ID.D2_AUTH, 'profiles', pPhoto)) && !(await canSee(ID.P_AUTH, 'profiles', pPhoto)) && !(await anonSee('profiles', pPhoto)));
  await svc((tx) => tx.query(`UPDATE public.booking SET booking_status = 'Completed' WHERE booking_id = '${B4.booking_id}'`));
  check('...and not by the driver once the trip is over', !(await canSee(ID.D_AUTH, 'profiles', pPhoto)));
  const evid = await putS(ID.P_AUTH, 'incident-evidence', `${ID.P_AUTH}/photo.jpg`);
  check('incident evidence: the uploader and the LGU read it; a TODA administrator does not (until evidence upload ships)', evid.ok && (await canSee(ID.P_AUTH, 'incident-evidence', `${ID.P_AUTH}/photo.jpg`)) && (await canSee(ID.L_AUTH, 'incident-evidence', `${ID.P_AUTH}/photo.jpg`)) && !(await canSee(ID.T_AUTH, 'incident-evidence', `${ID.P_AUTH}/photo.jpg`)));
  check('reports: a passenger cannot write to the reports bucket; a TODA administrator writes into their own folder; the LGU reads it',
    !(await putS(ID.P_AUTH, 'reports', `${ID.P_AUTH}/r.pdf`)).ok && (await putS(ID.T_AUTH, 'reports', `${ID.T_AUTH}/r.pdf`)).ok && (await canSee(ID.L_AUTH, 'reports', `${ID.T_AUTH}/r.pdf`)) && !(await canSee(ID.T2_AUTH, 'reports', `${ID.T_AUTH}/r.pdf`)));
  const nPol = await one(`SELECT count(*)::int n FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND (roles && ARRAY['anon','public']::name[])`);
  check('no storage.objects policy names anon or public', nPol.n === 0, nPol);

  console.log('\nL9 stored public URLs become storage paths (the migration run again over rows that still hold URLs)');
  await internal(`UPDATE public.toda SET bylaws_url = 'https://abc.supabase.co/storage/v1/object/public/toda-bylaws/My%20Bylaws%20%281%29.pdf?download=1',
                                           barangay_clearance_url = 'https://abc.supabase.co/storage/v1/object/public/barangay-clearances/1724-clearance.pdf',
                                           accredited_drivers_url = 'https://abc.supabase.co/storage/v1/object/public/some-other-bucket/list.csv'
                   WHERE toda_id = '${ID.TODA2}'`);
  const mig = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261008000005_perimeter_storage.sql'), 'utf8');
  const rerun = await attempt(() => db.exec(mig));
  const t2 = await one(`SELECT bylaws_url, barangay_clearance_url, accredited_drivers_url FROM public.toda WHERE toda_id = '${ID.TODA2}'`);
  check('the migration can run again over existing data', rerun.ok, err(rerun));
  check('a public URL becomes the storage path (query string dropped, %XX decoded)', t2.bylaws_url === 'My Bylaws (1).pdf' && t2.barangay_clearance_url === '1724-clearance.pdf', t2);
  check('a URL that points into a different bucket is left alone, not guessed at', t2.accredited_drivers_url.includes('some-other-bucket'), t2);

  await db.close();
  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
