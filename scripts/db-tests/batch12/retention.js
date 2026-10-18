// Batch 12 (Rules 28.1 - 28.3; T5; decisions F12.2 - F12.5): the retention job removes or anonymizes ONLY expired records that are not held; a record tied to an open incident,
// dispute, exemption, review flag, unreconciled trip or a manual legal hold survives until the case is closed; the identity images are queued and handed to the server only
// when due, unused and unheld; accounts closed five years ago lose their names and keep their strike records. Whole migration chain on the local emulator.
const { setup, ID, DRIVERS, PAX, attempt, check, summary } = require('../b12fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, as, svc, db } = s;
  const D1 = DRIVERS.D1.id, D2 = DRIVERS.D2.id, D3 = DRIVERS.D3.id, P1 = PAX.P1.id, P2 = PAX.P2.id;
  const LAT = 13.4115, LNG = 121.1803;
  const daysAgo = (d) => `now() - interval '${d} days'`;
  const fixes = async (bookingId, driverId, ageDays, n = 5) => {
    const vals = [];
    for (let i = 0; i < n; i++) vals.push(`(${bookingId ? `'${bookingId}'` : 'NULL'}, '${driverId}', ${LAT + i * 0.0001}, ${LNG}, 10, ${daysAgo(ageDays)} + interval '${i * 5} seconds')`);
    await internal(`INSERT INTO gps_log (booking_id, driver_id, latitude, longitude, accuracy, recorded_at) VALUES ${vals.join(',')}`);
  };
  const countGps = async (bookingId) => Number((await one(`SELECT count(*)::int n FROM gps_log WHERE ${bookingId ? `booking_id = '${bookingId}'` : 'booking_id IS NULL'}`)).n);
  const purgeGps = async () => (await svc((tx) => tx.query(`SELECT public.purge_expired_gps_logs() AS r`))).rows[0].r;
  const job = async () => (await svc((tx) => tx.query(`SELECT public.run_retention_job() AS r`))).rows[0].r;

  console.log('S1 routine GPS fixes: removed after 90 days unless the trip is held (T5)');
  const old = await s.trip('P1', 'D1'), recent = await s.trip('P2', 'D1');
  const hInc = await s.trip('P1', 'D1'), hDis = await s.trip('P2', 'D1'), hFlag = await s.trip('P1', 'D1'), hManual = await s.trip('P2', 'D1'), hRecon = await s.trip('P1', 'D1');
  for (const b of [old, hInc, hDis, hFlag, hManual, hRecon]) await fixes(b, D1, 100);
  await fixes(recent, D1, 30);
  await fixes(null, D1, 120, 3);                                        // fixes that belong to no trip
  await internal(`INSERT INTO incident_report (booking_id, passenger_id, driver_id, reported_by, category, description, status)
                  VALUES ('${hInc}', '${P1}', '${D1}', 'Passenger', 'Rude Behavior', 'An open complaint about this trip.', 'Under Investigation')`);
  await internal(`INSERT INTO fare_dispute (booking_id, kind, opened_by, opened_by_id, status, due_at) VALUES ('${hDis}', 'FARE_DISCREPANCY', 'passenger', '${P2}', 'Open', now() + interval '2 days')`);
  await internal(`INSERT INTO admin_review_flag (flag_type, subject_type, subject_id, source_rule, assigned_role, details)
                  VALUES ('DRIVER_EARLY_STOP_REVIEW', 'driver', '${D1}', 'Rule 13.7', 'toda_admin', '{"booking_id": "${hFlag}"}'::jsonb)`);
  const hold = await s.lguCall('place_legal_hold($1, $2, $3, $4)', ['booking', hManual, 'CASE-2026-14', 'The police asked the LGU to keep this trip\'s route.'.replace("'", "''")]);
  await internal(`INSERT INTO trip_connectivity_event (booking_id, driver_id, phase, started_at, reconcile_flagged_at) VALUES ('${hRecon}', '${D1}', 'ongoing', ${daysAgo(100)}, ${daysAgo(99)})`);
  let r = await purgeGps();
  check('an old trip with no case: its fixes are removed', await countGps(old) === 0, r);
  check('a trip from 30 days ago is kept (routine fixes live 90 days)', await countGps(recent) === 5);
  check('fixes that belong to no trip and are old are removed too', await countGps(null) === 0);
  check('an OPEN incident report holds the trip\'s fixes', await countGps(hInc) === 5);
  check('an OPEN fare dispute holds them', await countGps(hDis) === 5);
  check('an OPEN review flag that names the trip holds them', await countGps(hFlag) === 5);
  check('a manual legal hold placed by the LGU Administrator holds them', hold.success === true && await countGps(hManual) === 5, hold);
  check('a trip that was never reconciled (silent for 30 minutes) holds them', await countGps(hRecon) === 5);
  check('the run reports what it removed and how many trips it held', Number(r.gps_rows_removed) === 8 && Number(r.trips_held) === 5, r);
  r = await purgeGps();
  check('running it again removes nothing more (idempotent)', Number(r.gps_rows_removed) === 0, r);
  // the cases close
  await internal(`UPDATE incident_report SET status = 'Resolved', outcome = 'NOT_UPHELD' WHERE booking_id = '${hInc}'`);
  await internal(`UPDATE fare_dispute SET status = 'Resolved' WHERE booking_id = '${hDis}'`);
  await internal(`UPDATE admin_review_flag SET status = 'Resolved' WHERE flag_type = 'DRIVER_EARLY_STOP_REVIEW'`);
  await internal(`UPDATE trip_connectivity_event SET reconciled_at = now() WHERE booking_id = '${hRecon}'`);
  await s.lguCall('release_legal_hold($1, $2)', [hold.hold_id, 'The case is closed; the police no longer need the route.']);
  r = await purgeGps();
  check('once each case is closed (and the hold released) the next run removes their fixes', (await countGps(hInc)) + (await countGps(hDis)) + (await countGps(hFlag)) + (await countGps(hManual)) + (await countGps(hRecon)) === 0 && Number(r.gps_rows_removed) === 25, r);
  check('the recent trip is still there', await countGps(recent) === 5);
  check('a hold on the DRIVER holds all of the driver\'s trips', await (async () => {
    const t = await s.trip('P1', 'D2');
    await fixes(t, D2, 100);
    const h = await s.lguCall('place_legal_hold($1, $2, $3, $4)', ['driver', D2, null, 'An investigation about this driver is open.']);
    await purgeGps();
    const kept = await countGps(t);
    await s.lguCall('release_legal_hold($1, $2)', [h.hold_id, 'The investigation of the driver ended.']);
    await purgeGps();
    return h.success === true && kept === 5 && await countGps(t) === 0;
  })());

  console.log('\nS2 ended sessions and connectivity events: 90 days');
  await internal(`INSERT INTO driver_online_session (driver_id, started_at, last_heartbeat_at, ended_at, end_reason) VALUES
      ('${D3}', ${daysAgo(120)}, ${daysAgo(120)}, ${daysAgo(119)}, 'manual'),
      ('${D3}', ${daysAgo(10)}, ${daysAgo(10)}, ${daysAgo(9)}, 'manual')`);
  await internal(`INSERT INTO driver_online_session (driver_id, started_at, last_heartbeat_at) VALUES ('${D2}', ${daysAgo(200)}, ${daysAgo(200)})`);
  const oldEv = await s.trip('P1', 'D3'), keepEv = await s.trip('P2', 'D3'), heldEv = await s.trip('P1', 'D3');
  await internal(`INSERT INTO trip_connectivity_event (booking_id, driver_id, phase, started_at) VALUES ('${oldEv}', '${D3}', 'assigned', ${daysAgo(100)}), ('${keepEv}', '${D3}', 'assigned', ${daysAgo(20)}), ('${heldEv}', '${D3}', 'assigned', ${daysAgo(100)})`);
  await s.lguCall('place_legal_hold($1, $2, $3, $4)', ['booking', heldEv, null, 'Held for the open complaint about this trip.']);
  r = (await svc((tx) => tx.query(`SELECT public.purge_expired_sessions() AS r`))).rows[0].r;
  check('an ended session from 120 days ago goes, one from 10 days ago stays, and a session still OPEN stays however old', Number(r.sessions_removed) === 1 && Number((await one(`SELECT count(*)::int n FROM driver_online_session WHERE driver_id = '${D3}'`)).n) === 1 && Number((await one(`SELECT count(*)::int n FROM driver_online_session WHERE driver_id = '${D2}' AND ended_at IS NULL`)).n) === 1, r);
  check('connectivity events: the old one goes (and the long-closed reconciliation of section 1), the recent one and the held one stay', Number(r.connectivity_events_removed) === 2 && (await q(`SELECT booking_id FROM trip_connectivity_event WHERE driver_id = '${D3}'`)).map((x) => x.booking_id).sort().join() === [keepEv, heldEv].sort().join(), r);

  console.log('\nS3 identity document images: queued with a date, handed to the server only when due, unused and unheld');
  const verif = async (driverId, paths = {}) => internal(`INSERT INTO driver_verification (${['driver_id', ...Object.keys(paths)].join(', ')}) VALUES (${[`'${driverId}'`, ...Object.values(paths).map((v) => `'${v}'`)].join(', ')})`);
  const due = (path) => internal(`UPDATE identity_document_retention SET due_at = now() - interval '1 minute' WHERE storage_path = '${path}'`);
  const expired = async () => (await svc((tx) => tx.query(`SELECT * FROM public.get_expired_identity_documents(500)`))).rows;
  await verif(D1, { license_front_photo_path: 'u1/lic-front-old.jpg', mtop_photo_path: 'u1/mtop.jpg' });
  await internal(`UPDATE driver_verification SET license_front_photo_path = 'u1/lic-front-new.jpg' WHERE driver_id = '${D1}'`);
  let queued = await q(`SELECT * FROM identity_document_retention WHERE storage_path = 'u1/lic-front-old.jpg'`);
  check('a REPLACED image is queued as superseded, due 30 days later', queued.length === 1 && queued[0].reason === 'superseded' && Math.abs(new Date(queued[0].due_at).getTime() - (Date.now() + 30 * 86400000)) < 5 * 60000, queued);
  check('...and is not handed over before it is due', (await expired()).length === 0);
  await due('u1/lic-front-old.jpg');
  check('...once due, nobody uses it any more: handed over', (await expired()).some((x) => x.storage_path === 'u1/lic-front-old.jpg' && x.reason === 'superseded'));
  await verif(D3, { license_front_photo_path: 'u1/lic-front-old.jpg' });
  check('...but an image another record still points at is NOT handed over', !(await expired()).some((x) => x.storage_path === 'u1/lic-front-old.jpg'));
  await internal(`DELETE FROM driver_verification WHERE driver_id = '${D3}'`);
  // a rejected application: 30 days after the rejection
  await verif(D2, { license_front_photo_path: 'u2/lic.jpg', face_photo_path: 'u2/face.jpg' });
  await internal(`UPDATE driver SET account_status = 'Rejected', rejected_at = ${daysAgo(40)} WHERE driver_id = '${D2}'`);
  await internal(`SELECT public.queue_identity_documents()`);
  let ex = await expired();
  check('a rejected application\'s images are due 30 days after the rejection (rejected 40 days ago: both handed over)', ex.filter((x) => x.reason === 'rejected').map((x) => x.storage_path).sort().join() === 'u2/face.jpg,u2/lic.jpg', ex);
  await internal(`UPDATE driver SET account_status = 'Pending Verification' WHERE driver_id = '${D2}'`);
  check('a driver the LGU allowed to apply again keeps them (no longer rejected: not handed over)', !(await expired()).some((x) => x.reason === 'rejected'));
  await internal(`UPDATE driver SET account_status = 'Rejected' WHERE driver_id = '${D2}'`);
  await s.lguCall('place_legal_hold($1, $2, $3, $4)', ['driver', D2, 'CASE-FAKE-DOC', 'The documents may be falsified: held until the case is closed.']);
  check('a HELD driver\'s images are not handed over (falsified documents: held until the case closes)', !(await expired()).some((x) => x.reason === 'rejected'));
  // a closed account: 12 months after the closure
  await verif(D3, { license_front_photo_path: 'u3/lic.jpg' });
  await internal(`UPDATE driver SET closed_at = now() - interval '13 months', account_status = 'Deactivated' WHERE driver_id = '${D3}'`);
  await internal(`INSERT INTO auth.users (id, email) VALUES ('50000000-0000-0000-0000-0000000000b1', 'c2@x.com')`);
  await internal(`INSERT INTO driver (driver_id, auth_user_id, full_name, contact_number, account_status, closed_at, toda_id) VALUES ('e0000000-0000-0000-0000-0000000000b1', '50000000-0000-0000-0000-0000000000b1', 'Closed Recently', '+639189990088', 'Deactivated', now() - interval '6 months', '${ID.TODA1}')`);
  await verif('e0000000-0000-0000-0000-0000000000b1', { license_front_photo_path: 'u4/lic.jpg' });
  await internal(`SELECT public.queue_identity_documents()`);
  ex = await expired();
  check('a closed account\'s images: closed 13 months ago is due, closed 6 months ago is queued but not due', ex.some((x) => x.storage_path === 'u3/lic.jpg' && x.reason === 'closed') && !ex.some((x) => x.storage_path === 'u4/lic.jpg')
    && (await q(`SELECT 1 FROM identity_document_retention WHERE storage_path = 'u4/lic.jpg'`)).length === 1, ex);
  // Rule 27.7 / F12.4: the documents of a driver confirmed to have submitted false ones are held until the case is closed (the entry is voided)
  const F = 'e0000000-0000-0000-0000-0000000000b2';
  await internal(`INSERT INTO auth.users (id, email) VALUES ('50000000-0000-0000-0000-0000000000b2', 'c3@x.com')`);
  await internal(`INSERT INTO driver (driver_id, auth_user_id, full_name, contact_number, account_status, closed_at, toda_id) VALUES ('${F}', '50000000-0000-0000-0000-0000000000b2', 'False Documents', '+639189990077', 'Deactivated', now() - interval '14 months', '${ID.TODA1}')`);
  await verif(F, { license_front_photo_path: 'u5/altered-lic.jpg' });
  await internal(`SELECT public.queue_identity_documents()`);
  check('a driver closed 14 months ago: the image is due and handed over (control for the next check)', (await expired()).some((x) => x.storage_path === 'u5/altered-lic.jpg'));
  await internal(`INSERT INTO strikes_ledger (subject_type, subject_id, violation_code, source_rule, status, points_issued, points_active, reason) VALUES ('driver', '${F}', 'DRV_FALSE_DOCUMENTS', 'Rule 27.7', 'ACTIVE', 0, 0, 'The license was shown to be altered.')`);
  check('...once the false-documents violation is on the ledger, the same image is HELD (evidence until the case is closed)', !(await expired()).some((x) => x.storage_path === 'u5/altered-lic.jpg'));
  await internal(`UPDATE strikes_ledger SET status = 'VOIDED', resolved_at = now() WHERE subject_id = '${F}' AND violation_code = 'DRV_FALSE_DOCUMENTS'`);
  check('...and is handed over again when the LGU voids the entry (the case is closed)', (await expired()).some((x) => x.storage_path === 'u5/altered-lic.jpg'));
  await internal(`DELETE FROM driver_verification WHERE driver_id = '${F}'`);
  await internal(`DELETE FROM identity_document_retention WHERE driver_id = '${F}'`);
  const ids = ex.filter((x) => x.storage_path === 'u3/lic.jpg' || x.storage_path === 'u1/lic-front-old.jpg').map((x) => x.retention_id);
  const c1 = await svc((tx) => tx.query(`SELECT public.confirm_identity_documents_purged($1::uuid[]) AS r`, [ids]));
  const c2 = await svc((tx) => tx.query(`SELECT public.confirm_identity_documents_purged($1::uuid[]) AS r`, [ids]));
  check('the server confirms the files are gone: rows stamped, once (a second confirmation changes nothing)', c1.rows[0].r.purged === 2 && c2.rows[0].r.purged === 0, [c1.rows[0].r, c2.rows[0].r]);
  check('the stored path of a deleted image is cleared (no screen points at a deleted file); an image still in use is untouched',
    (await one(`SELECT license_front_photo_path AS p FROM driver_verification WHERE driver_id = '${D3}'`)).p === null && (await one(`SELECT license_front_photo_path AS p FROM driver_verification WHERE driver_id = '${D1}'`)).p === 'u1/lic-front-new.jpg');
  const pa = await s.auditOf('IDENTITY_DOCUMENTS_PURGED', 'IDENTITY_DOCUMENTS');
  check('ONE audit entry for the deletion with the counts by reason (no file names, no person)', pa.length === 1 && pa[0].actor_role === 'system' && pa[0].after_state.images === 2 && !/u3\//.test(JSON.stringify(pa[0])), pa);
  for (const fn of ['get_expired_identity_documents(10)', 'confirm_identity_documents_purged(ARRAY[]::uuid[])', 'queue_identity_documents()', 'anonymize_closed_accounts()', 'purge_expired_gps_logs()', 'purge_expired_sessions()', 'run_retention_job()', 'scrub_unneeded_identity_fields()']) {
    const x = await attempt(() => as(ID.L_AUTH, (tx) => tx.query(`SELECT public.${fn}`)));
    if (x.ok || !/permission denied/i.test(x.error)) { check(`${fn} is not callable by a signed-in user (not even the LGU Administrator)`, false, x); }
  }
  check('none of the retention functions is callable by a signed-in user (not even the LGU Administrator)', true);
  check('no signed-in user can read or write the retention queue', !(await attempt(() => as(ID.L_AUTH, (tx) => tx.query(`SELECT * FROM identity_document_retention`)))).ok);

  console.log('\nS4 closed accounts: anonymized five years after the closure; the strike records stay');
  await internal(`INSERT INTO auth.users (id, email) VALUES ('50000000-0000-0000-0000-0000000000c1', 'c3@x.com'), ('50000000-0000-0000-0000-0000000000c2', 'c4@x.com'), ('50000000-0000-0000-0000-0000000000c3', 'c5@x.com'), ('50000000-0000-0000-0000-0000000000c4', 'c6@x.com')`);
  await internal(`INSERT INTO passenger (passenger_id, auth_user_id, full_name, contact_number, email, date_of_birth, residential_address, account_status, closed_at) VALUES
      ('d0000000-0000-0000-0000-0000000000c1', '50000000-0000-0000-0000-0000000000c1', 'Old Closed Pax', '+639170009001', 'oldpax@x.com', '1980-01-01', 'Brgy. Somewhere', 'Deactivated', now() - interval '6 years'),
      ('d0000000-0000-0000-0000-0000000000c2', '50000000-0000-0000-0000-0000000000c2', 'Younger Closed Pax', '+639170009002', NULL, '1982-01-01', NULL, 'Deactivated', now() - interval '4 years'),
      ('d0000000-0000-0000-0000-0000000000c3', '50000000-0000-0000-0000-0000000000c3', 'Held Closed Pax', '+639170009003', NULL, '1983-03-03', NULL, 'Deactivated', now() - interval '7 years')`);
  await internal(`INSERT INTO driver (driver_id, auth_user_id, full_name, contact_number, email, date_of_birth, license_number, plate_number, account_status, closed_at, toda_id)
                  VALUES ('e0000000-0000-0000-0000-0000000000c4', '50000000-0000-0000-0000-0000000000c4', 'Old Closed Driver', '+639189009004', 'olddrv@x.com', '1975-05-05', 'N01-11-111111', 'ZZZ 999', 'Deactivated', now() - interval '6 years', '${ID.TODA1}')`);
  await verif('e0000000-0000-0000-0000-0000000000c4', {});
  await internal(`UPDATE driver_verification SET submitted_full_name = 'Old Closed Driver', submitted_dob = '1975-05-05', submitted_address = 'Brgy. Elsewhere', submitted_license_number = 'N01-11-111111' WHERE driver_id = 'e0000000-0000-0000-0000-0000000000c4'`);
  await internal(`INSERT INTO strikes_ledger (subject_type, subject_id, violation_code, source_rule, status, points_issued, points_active, reason) VALUES
      ('passenger', 'd0000000-0000-0000-0000-0000000000c1', 'PAX_NO_SHOW', 'Rule 10.4', 'ACTIVE', 2, 0, 'old strike'),
      ('driver', 'e0000000-0000-0000-0000-0000000000c4', 'DRV_STALL', 'Rule 8.3', 'ACTIVE', 1, 0, 'old driver strike')`);
  await internal(`INSERT INTO admin_review_flag (flag_type, subject_type, subject_id, source_rule, assigned_role) VALUES ('DEACTIVATION_REVIEW', 'passenger', 'd0000000-0000-0000-0000-0000000000c3', 'Rule 22.5', 'lgu_admin')`);
  const ledgerBefore = Number((await one(`SELECT count(*)::int n FROM strikes_ledger`)).n), auditBefore = Number((await one(`SELECT count(*)::int n FROM audit_log`)).n);
  r = (await svc((tx) => tx.query(`SELECT public.anonymize_closed_accounts() AS r`))).rows[0].r;
  const ap = await one(`SELECT * FROM passenger WHERE passenger_id = 'd0000000-0000-0000-0000-0000000000c1'`);
  check('a passenger closed 6 years ago: name, number, e-mail, birth date and address are gone, the account id stays, anonymized_at is set',
    ap.full_name === 'Closed account' && ap.contact_number === 'closed-0000000000c1' && ap.contact_number.length <= 20 && ap.email === null && ap.date_of_birth === null && ap.residential_address === null && ap.anonymized_at !== null, ap);
  const ad = await one(`SELECT d.*, v.submitted_full_name, v.submitted_dob, v.submitted_address, v.submitted_license_number FROM driver d JOIN driver_verification v ON v.driver_id = d.driver_id WHERE d.driver_id = 'e0000000-0000-0000-0000-0000000000c4'`);
  check('a driver closed 6 years ago: the same, and the license, plate and the verification record\'s personal fields too', ad.full_name === 'Closed account' && ad.license_number === null && ad.plate_number === null && ad.date_of_birth === null && ad.submitted_full_name === null && ad.submitted_dob === null && ad.submitted_address === null && ad.submitted_license_number === null && ad.anonymized_at !== null, ad);
  check('closed 4 years ago: untouched (the period is 5 years)', (await one(`SELECT full_name FROM passenger WHERE passenger_id = 'd0000000-0000-0000-0000-0000000000c2'`)).full_name === 'Younger Closed Pax');
  check('closed 7 years ago but with an OPEN case about the account: left alone (held)', (await one(`SELECT full_name FROM passenger WHERE passenger_id = 'd0000000-0000-0000-0000-0000000000c3'`)).full_name === 'Held Closed Pax' && Number(r.held) === 1, r);
  check('the strike records are kept, whole (the ledger has the same rows: anonymizing removes the person, not the record)', Number((await one(`SELECT count(*)::int n FROM strikes_ledger`)).n) === ledgerBefore && (await q(`SELECT 1 FROM strikes_ledger WHERE reason IN ('old strike', 'old driver strike')`)).length === 2);
  const an = await s.auditOf('ACCOUNT_ANONYMIZED');
  check('each anonymization is audited by id, with no name, and nothing else in the audit log changed', an.length === 2 && an.every((x) => !/Old Closed/.test(JSON.stringify(x))) && Number((await one(`SELECT count(*)::int n FROM audit_log`)).n) === auditBefore + 2, an.length);
  r = (await svc((tx) => tx.query(`SELECT public.anonymize_closed_accounts() AS r`))).rows[0].r;
  check('a second run changes nothing', Number(r.drivers_anonymized) === 0 && Number(r.passengers_anonymized) === 0, r);

  console.log('\nS5 the daily job: one audit entry for a run that did something, none for a run that did nothing');
  await fixes(await s.trip('P2', 'D1'), D1, 120);
  const jobsBefore = (await s.auditOf('RETENTION_JOB_RUN')).length;
  r = await job();
  check('a run that removed fixes returns the counts of every part and writes ONE RETENTION_JOB_RUN entry (system)', Number(r.gps.gps_rows_removed) === 5 && (await s.auditOf('RETENTION_JOB_RUN')).length === jobsBefore + 1 && (await s.auditOf('RETENTION_JOB_RUN')).pop().actor_role === 'system', r);
  r = await job();
  check('...and an idle run writes none', (await s.auditOf('RETENTION_JOB_RUN')).length === jobsBefore + 1, r);

  console.log('\nS6 the legal hold belongs to the LGU Administrator');
  const tryHold = async (uid) => attempt(() => as(uid, (tx) => tx.query(`SELECT public.place_legal_hold('driver', '${D1}', NULL, 'A hold that nobody may place but the LGU.')`)));
  check('a TODA Administrator, a driver and a passenger cannot place a hold', (await Promise.all([ID.T_AUTH, ID.D_AUTH, ID.P_AUTH].map(tryHold))).every((x) => !x.ok && /Access Denied/.test(x.error)));
  let h = await attempt(() => s.lguCall('place_legal_hold($1, $2, NULL, $3)', ['driver', D1, 'short']));
  check('a hold needs a real reason', !h.ok && /ERR_HOLD_REASON/.test(h.error), h);
  h = await attempt(() => s.lguCall('place_legal_hold($1, $2, NULL, $3)', ['vehicle', D1, 'A hold on something that is not a record.']));
  check('only a booking, a driver or a passenger can be held', !h.ok && /ERR_HOLD_SUBJECT/.test(h.error), h);
  const h1 = await s.lguCall('place_legal_hold($1, $2, NULL, $3)', ['passenger', P1, 'An investigation about this passenger is open.']);
  const h2 = await s.lguCall('place_legal_hold($1, $2, NULL, $3)', ['passenger', P1, 'The same hold placed twice must not duplicate.']);
  check('placing the same hold twice is harmless (one open hold)', h1.success && h2.success && h2.idempotent === true && h1.hold_id === h2.hold_id);
  check('only the LGU Administrator reads the holds', (await as(ID.L_AUTH, (tx) => tx.query(`SELECT * FROM legal_hold`))).rows.length >= 1 && (await as(ID.T_AUTH, (tx) => tx.query(`SELECT * FROM legal_hold`))).rows.length === 0);
  const direct = await attempt(() => as(ID.L_AUTH, (tx) => tx.query(`INSERT INTO legal_hold (subject_type, subject_id, reason) VALUES ('driver', '${D2}', 'An insert that skips the audited function.')`)));
  check('not even the LGU Administrator inserts a hold directly (only place_legal_hold, which audits)', !direct.ok, direct);
  const rel = await attempt(() => s.lguCall('release_legal_hold($1, $2)', [h1.hold_id, 'short']));
  check('releasing needs a reason as well', !rel.ok && /ERR_HOLD_REASON/.test(rel.error), rel);
  await s.lguCall('release_legal_hold($1, $2)', [h1.hold_id, 'The investigation ended without a case.']);
  check('placing and releasing are audited with the administrator', (await s.auditOf('LEGAL_HOLD_PLACED', P1)).length === 1 && (await s.auditOf('LEGAL_HOLD_RELEASED', P1)).length === 1 && (await s.auditOf('LEGAL_HOLD_PLACED', P1))[0].actor_id === ID.L_AUTH);

  console.log('\nS7 unneeded identity fields are removed only on request (service role), never silently');
  await internal(`UPDATE driver SET residential_address = 'Brgy. X', chassis_number = 'CH123', motor_number = 'MO123', vehicle_make = 'HONDA' WHERE driver_id = '${D1}'`);
  const sc = await attempt(() => as(ID.L_AUTH, (tx) => tx.query(`SELECT public.scrub_unneeded_identity_fields()`)));
  check('a signed-in user cannot run it', !sc.ok && /permission denied/i.test(sc.error), sc);
  check('this migration did not run it (the stored value is still there)', (await one(`SELECT residential_address AS a FROM driver WHERE driver_id = '${D1}'`)).a === 'Brgy. X');
  r = (await svc((tx) => tx.query(`SELECT public.scrub_unneeded_identity_fields() AS r`))).rows[0].r;
  const after = await one(`SELECT residential_address a, chassis_number c, motor_number m, vehicle_make k FROM driver WHERE driver_id = '${D1}'`);
  check('run on request: the address, chassis, motor number and make are removed and the run is audited', after.a === null && after.c === null && after.m === null && after.k === null && Number(r.drivers) >= 1 && (await s.auditOf('UNNEEDED_IDENTITY_FIELDS_SCRUBBED')).length === 1, { r, after });

  const ok = summary();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
