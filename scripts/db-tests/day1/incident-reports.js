// Day 1: the incident-report pipeline (migration 20261012000001).
//   A passenger or a driver files a report about a trip they were on; the TODA of the reported driver and the LGU review it.
//   The guard trigger derives driver / TODA / reporter role / status from the booking and the signed-in user, never from the request.
const { freshDb, asUser, attempt, check, summary } = require('../tlib');
const { ID, seed } = require('../fixtures');

(async () => {
  const db = await freshDb();
  await seed(db);
  const svc = (fn) => asUser(db, { role: 'service_role' }, fn, { commit: true });
  const as = (uid, fn) => asUser(db, { uid }, fn, { commit: true });
  const rows = async (sql) => (await db.query(sql)).rows;

  // Two completed trips of passenger P1: one driven by D1 (TODA 1), one that never had a driver.
  const B1 = 'b1000000-0000-0000-0000-000000000001';
  const B_NODRIVER = 'b1000000-0000-0000-0000-000000000002';
  await svc((tx) => tx.query(`
    INSERT INTO booking(booking_id,passenger_id,driver_id,toda_id,booking_status,passenger_count,pickup_address,pickup_latitude,pickup_longitude,
                        dropoff_address,dropoff_latitude,dropoff_longitude,estimated_distance_km,estimated_fare)
    VALUES ('${B1}','${ID.P1}','${ID.D1}','${ID.TODA1}','Completed',1,'A',13.4115,121.1803,'B',13.42,121.19,1.5,60),
           ('${B_NODRIVER}','${ID.P1}',NULL,NULL,'Completed',1,'A',13.4115,121.1803,'B',13.42,121.19,1.5,60)`));

  const file = (uid, n = 'a.jpg') => `${uid}/${n}`;
  const fileReport = (uid, over = {}) => as(uid, (tx) => attempt(async () => {
    const r = await tx.query(
      `INSERT INTO incident_report(booking_id,passenger_id,driver_id,reported_by,category,description,status,evidence_paths,reported_toda_id,reviewed_by_lgu,resolution)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING incident_id`,
      [over.booking ?? B1, over.passenger ?? ID.P1, over.driver ?? ID.D1, over.reportedBy ?? 'Passenger', over.category ?? 'Rude Behavior',
       over.description ?? 'The driver shouted at me.', over.status ?? 'Pending', over.evidence ?? [], over.toda ?? ID.TODA1,
       over.lgu ?? null, over.resolution ?? null]);
    return r.rows[0].incident_id;
  }));

  console.log('T1 a passenger files a report (forged fields are overwritten)');
  // The request lies about everything it can: another passenger, another driver, "Driver", already Resolved, another TODA, a reviewer.
  const lgu = (await rows(`SELECT admin_id FROM lgu_admin LIMIT 1`))[0].admin_id;
  const r1 = await fileReport(ID.P_AUTH, { passenger: ID.P2, driver: ID.D3, reportedBy: 'Driver', status: 'Resolved', toda: ID.TODA2,
    lgu, resolution: 'all good', evidence: [file(ID.P_AUTH)] });
  check('the passenger can file a report about their own trip', r1.ok, r1);
  const inc = (await rows(`SELECT * FROM incident_report WHERE incident_id='${r1.value}'`))[0];
  check('the passenger is the real reporter (not the forged one)', inc.passenger_id === ID.P1 && inc.reported_by === 'Passenger', inc);
  check('the driver and TODA come from the booking (D1 / TODA 1), not from the request', inc.driver_id === ID.D1 && inc.reported_toda_id === ID.TODA1, inc);
  check('the report starts Pending with no reviewer and no resolution, whatever was sent',
    inc.status === 'Pending' && inc.reviewed_by_lgu === null && inc.reviewed_by_toda === null && inc.resolution === null && inc.resolved_at === null, inc);
  check('the evidence path is kept', JSON.stringify(inc.evidence_paths) === JSON.stringify([file(ID.P_AUTH)]), inc.evidence_paths);

  console.log('\nT2 who may file');
  const other = await fileReport(ID.P2_AUTH, { passenger: ID.P2 });
  check('another passenger cannot report a trip that is not theirs', !other.ok, other);
  const noDrv = await fileReport(ID.P_AUTH, { booking: B_NODRIVER });
  check('a trip that never had a driver cannot be reported', !noDrv.ok && /ERR_INCIDENT_NO_DRIVER/.test(noDrv.error), noDrv);
  const drv = await fileReport(ID.D_AUTH, { passenger: ID.P1, driver: ID.D1, category: 'Passenger Misconduct' });
  check('the driver of the trip can report the passenger', drv.ok, drv);
  const drvRow = (await rows(`SELECT reported_by, passenger_id, driver_id FROM incident_report WHERE incident_id='${drv.value}'`))[0];
  check('a driver report is stamped reported_by = Driver with the passenger taken from the booking', drvRow.reported_by === 'Driver' && drvRow.passenger_id === ID.P1 && drvRow.driver_id === ID.D1, drvRow);
  const otherDrv = await fileReport(ID.D2_AUTH, { passenger: ID.P1, driver: ID.D2 });
  check('a driver who did not drive the trip cannot report it', !otherDrv.ok, otherDrv);
  const noCat = await fileReport(ID.P_AUTH, { category: '   ' });
  check('an empty category is refused', !noCat.ok && /ERR_INCIDENT_INVALID/.test(noCat.error), noCat);
  const longTxt = await fileReport(ID.P_AUTH, { description: 'x'.repeat(2001) });
  check('a description over 2000 characters is refused', !longTxt.ok && /ERR_INCIDENT_INVALID/.test(longTxt.error), longTxt);

  console.log('\nT3 evidence photos');
  const foreign = await fileReport(ID.P_AUTH, { evidence: [file(ID.P2_AUTH)] });
  check('a photo inside someone else\'s folder is refused', !foreign.ok && /ERR_INCIDENT_EVIDENCE/.test(foreign.error), foreign);
  const trav = await fileReport(ID.P_AUTH, { evidence: [`${ID.P_AUTH}/../${ID.P2_AUTH}/a.jpg`] });
  check('a path with ".." is refused', !trav.ok && /ERR_INCIDENT_EVIDENCE/.test(trav.error), trav);
  const four = await fileReport(ID.P_AUTH, { evidence: [1, 2, 3, 4].map((n) => file(ID.P_AUTH, `${n}.jpg`)) });
  check('more than 3 photos are refused', !four.ok && /ERR_INCIDENT_EVIDENCE/.test(four.error), four);
  const three = await fileReport(ID.P_AUTH, { evidence: [1, 2, 3].map((n) => file(ID.P_AUTH, `${n}.jpg`)) });
  check('3 photos in the reporter\'s own folder are accepted', three.ok, three);

  console.log('\nT4 who can see and review');
  const seeT1 = await as(ID.T_AUTH, (tx) => tx.query(`SELECT incident_id FROM incident_report WHERE incident_id='${r1.value}'`));
  check('the TODA administrator of the reported driver sees the report', seeT1.rows.length === 1, seeT1.rows);
  const seeT2 = await as(ID.T2_AUTH, (tx) => tx.query(`SELECT incident_id FROM incident_report WHERE incident_id='${r1.value}'`));
  check('the administrator of a different TODA does not', seeT2.rows.length === 0, seeT2.rows);
  const seeOther = await as(ID.P2_AUTH, (tx) => tx.query(`SELECT incident_id FROM incident_report WHERE incident_id='${r1.value}'`));
  check('another passenger does not', seeOther.rows.length === 0, seeOther.rows);

  console.log('\nT5 TODA review (the portal used to write `true` into a UUID column)');
  const tadmin = (await rows(`SELECT admin_id FROM toda_admin WHERE auth_user_id='${ID.T_AUTH}'`))[0].admin_id;
  const t2try = await as(ID.T2_AUTH, (tx) => attempt(() => tx.query(`UPDATE incident_report SET status='Resolved', resolution_notes='x' WHERE incident_id='${r1.value}'`)));
  check('a TODA administrator of another TODA cannot change it', t2try.ok && t2try.value.rowCount === 0, t2try);
  const tres = await as(ID.T_AUTH, (tx) => attempt(() => tx.query(
    `UPDATE incident_report SET status='Resolved', resolution='Talked to the driver', resolution_notes='Talked to the driver' WHERE incident_id='${r1.value}'`)));
  check('the TODA administrator resolves it', tres.ok && tres.value.rowCount === 1, tres);
  const after = (await rows(`SELECT status, reviewed_by_toda, reviewed_by_lgu, resolved_at, resolution FROM incident_report WHERE incident_id='${r1.value}'`))[0];
  check('the TODA administrator is stamped as reviewer; resolved_at is set; the LGU reviewer is untouched',
    after.status === 'Resolved' && after.reviewed_by_toda === tadmin && after.reviewed_by_lgu === null && after.resolved_at !== null, after);
  const edit = await as(ID.T_AUTH, (tx) => attempt(() => tx.query(`UPDATE incident_report SET description='changed' WHERE incident_id='${r1.value}'`)));
  check('an administrator cannot rewrite what the passenger wrote', !edit.ok && /ERR_INCIDENT_LOCKED/.test(edit.error), edit);
  const retarget = await as(ID.T_AUTH, (tx) => attempt(() => tx.query(`UPDATE incident_report SET driver_id='${ID.D3}' WHERE incident_id='${r1.value}'`)));
  check('nor point the report at another driver', !retarget.ok && /ERR_INCIDENT_LOCKED/.test(retarget.error), retarget);

  console.log('\nT6 LGU review');
  const lres = await as(ID.L_AUTH, (tx) => attempt(() => tx.query(`UPDATE incident_report SET status='Under Investigation', resolution_notes='Escalated' WHERE incident_id='${drv.value}'`)));
  check('the LGU administrator changes the status', lres.ok && lres.value.rowCount === 1, lres);
  const lrow = (await rows(`SELECT status, reviewed_by_lgu, reviewed_by_toda FROM incident_report WHERE incident_id='${drv.value}'`))[0];
  check('the LGU administrator is stamped as reviewer', lrow.status === 'Under Investigation' && lrow.reviewed_by_lgu === lgu && lrow.reviewed_by_toda === null, lrow);

  console.log('\nT7 the passenger can only withdraw a Pending report');
  const p2 = await fileReport(ID.P_AUTH, { description: 'Second report' });
  const noReason = await as(ID.P_AUTH, (tx) => attempt(() => tx.query(`UPDATE incident_report SET status='Cancelled' WHERE incident_id='${p2.value}'`)));
  check('withdrawing without a reason is refused', !noReason.ok && /ERR_INCIDENT_LOCKED/.test(noReason.error), noReason);
  const selfResolve = await as(ID.P_AUTH, (tx) => attempt(() => tx.query(`UPDATE incident_report SET status='Resolved' WHERE incident_id='${p2.value}'`)));
  check('the passenger cannot mark their own report Resolved', !selfResolve.ok && /ERR_INCIDENT_LOCKED/.test(selfResolve.error), selfResolve);
  const editOwn = await as(ID.P_AUTH, (tx) => attempt(() => tx.query(`UPDATE incident_report SET description='rewritten' WHERE incident_id='${p2.value}'`)));
  check('nor edit it after sending', !editOwn.ok && /ERR_INCIDENT_LOCKED/.test(editOwn.error), editOwn);
  const cancel = await as(ID.P_AUTH, (tx) => attempt(() => tx.query(`UPDATE incident_report SET status='Cancelled', cancellation_reason='Mistake' WHERE incident_id='${p2.value}'`)));
  check('with a reason the passenger can withdraw it', cancel.ok && cancel.value.rowCount === 1, cancel);
  const crow = (await rows(`SELECT status, cancellation_reason FROM incident_report WHERE incident_id='${p2.value}'`))[0];
  check('status Cancelled and the reason are saved', crow.status === 'Cancelled' && crow.cancellation_reason === 'Mistake', crow);
  const late = await as(ID.P_AUTH, (tx) => attempt(() => tx.query(`UPDATE incident_report SET status='Cancelled', cancellation_reason='too late' WHERE incident_id='${r1.value}'`)));
  check('a report that is already Resolved can no longer be withdrawn', late.ok && late.value.rowCount === 0, late);

  console.log('\nT8 evidence photo access');
  const cf = async (uid, name) => (await as(uid, (tx) => tx.query(`SELECT public.storage_can_read_incident_evidence($1) ok`, [name]))).rows[0].ok;
  check('the TODA administrator of the reported driver may read the photo', (await cf(ID.T_AUTH, file(ID.P_AUTH))) === true);
  check('the administrator of another TODA may not', (await cf(ID.T2_AUTH, file(ID.P_AUTH))) === false);
  check('a file that belongs to no report is not readable through it', (await cf(ID.T_AUTH, file(ID.P_AUTH, 'unknown.jpg'))) === false);
  const pol = await rows(`SELECT pg_get_expr(polqual, polrelid) q FROM pg_policy WHERE polname='perimeter_incident_evidence_select'`);
  check('the storage read policy now includes the helper', pol.length === 1 && /storage_can_read_incident_evidence/.test(pol[0].q), pol);

  console.log('\nT9 trusted callers are not blocked by the guard');
  const trusted = await svc((tx) => attempt(() => tx.query(
    `INSERT INTO incident_report(booking_id,passenger_id,driver_id,reported_by,category,description,status) VALUES ('${B1}','${ID.P1}','${ID.D1}','Passenger','Others','imported','Resolved') RETURNING status`)));
  check('the service role keeps what it sends (imports and repairs)', trusted.ok && trusted.value.rows[0].status === 'Resolved', trusted);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
