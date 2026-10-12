// Batch 7, Rule 17.5: "GPS accuracy issues that repeatedly cause false no-show or stall determinations for the same route / area should be reported by TODA
// Administrators to the LGU Administrator for possible service-zone boundary adjustment". This suite proves the reporting path (the shared review-flag
// mechanism) and the administrators' view of repeated determinations. It counts from zero, so it has its own database.
const { setup, ID, DRIVERS, attempt, check, summary } = require('../b6fixtures');

(async () => {
  const s = await setup();
  const { q, internal, as } = s;
  const A = { toda1: ID.T_AUTH, toda2: ID.T2_AUTH, lgu: ID.L_AUTH };
  const adminRpc = (uid, sql, args) => attempt(() => s.rpcAs(uid, sql, args));
  const age = (bookingId, sec) => internal(`UPDATE booking SET accepted_at = accepted_at - interval '${sec} seconds', stall_anchor_at = stall_anchor_at - interval '${sec} seconds' WHERE booking_id = '${bookingId}'`);
  const silence = (key, sec) => internal(`
    UPDATE driver SET last_location_update = last_location_update - interval '${sec} seconds' WHERE driver_id = '${DRIVERS[key].id}';
    UPDATE booking SET accepted_at = accepted_at - interval '${sec} seconds', stall_anchor_at = stall_anchor_at - interval '${sec} seconds'
      WHERE driver_id = '${DRIVERS[key].id}' AND booking_status NOT IN ('Cancelled', 'Completed')`);
  const bookAndAccept = async (key, pax) => {
    const b = await s.bookAs(pax);
    const o = await s.pendingOffer(b.booking_id);
    if (!o || o.driver_id !== DRIVERS[key].id) throw new Error(`expected an offer to ${key}, got ${JSON.stringify(o)}`);
    const r = await s.accept(key, o.attempt_id);
    if (!r.success) throw new Error('accept failed ' + JSON.stringify(r));
    return s.booking(b.booking_id);
  };
  const reset = async (bookingId) => { await s.finish(bookingId); await s.sweep(); for (const k of ['D1', 'D2', 'D3']) if ((await s.status(DRIVERS[k].id)) !== 'Offline') await s.goOffline(DRIVERS[k].uid); };

  console.log('S1 nothing yet: no area is listed');
  const none = await adminRpc(A.toda1, 'public.get_gps_determination_hotspots()');
  check('with no determination there is no area (and the reporting count is 3 in 30 days)', none.ok && none.value.areas.length === 0 && none.value.min_count === 3 && none.value.window_days === 30, none);

  console.log('\nS2 three stall cancellations at the same pickup are three determinations of one area');
  for (let i = 0; i < 3; i++) {
    await s.online('D1', 300); await s.online('D2', 600);
    const bk = await bookAndAccept('D1', 'P1');
    await age(bk.booking_id, 200); await s.moveTo('D1', 300); await s.sweep();                  // never moved: cancelled at 3 minutes (Rule 8.3)
    await reset(bk.booking_id);
  }
  check('the three stalls are three strikes of D1', (await q(`SELECT 1 FROM strikes_ledger WHERE subject_id='${ID.D1}' AND violation_code='DRV_STALL'`)).length === 3);
  const two = await adminRpc(A.toda1, 'public.get_gps_determination_hotspots()');
  check('the TODA Administrator of the driver sees ONE area with 3 determinations, all stalls', two.ok && two.value.areas.length === 1 && two.value.areas[0].determinations === 3 && two.value.areas[0].stalls === 3 && two.value.areas[0].connectivity === 0, two);
  const area = two.value.areas[0];
  check('the area has a centre for the map and is not reported yet', area.center_latitude > 13.41 && area.center_latitude < 13.42 && area.center_longitude > 121.18 && area.reported === false, area);
  await internal(`UPDATE strikes_ledger SET status = 'WAIVED', points_active = 0 WHERE strike_id = (SELECT strike_id FROM strikes_ledger WHERE subject_id='${ID.D1}' AND violation_code='DRV_STALL' ORDER BY issued_at LIMIT 1)`);
  check('a strike waived on review still counts (a waiver is exactly a determination that GPS got wrong)', (await adminRpc(A.toda1, 'public.get_gps_determination_hotspots()')).value.areas[0].determinations === 3);
  await internal(`UPDATE strikes_ledger SET status = 'VOIDED', points_active = 0 WHERE strike_id = (SELECT strike_id FROM strikes_ledger WHERE subject_id='${ID.D1}' AND violation_code='DRV_STALL' ORDER BY issued_at DESC LIMIT 1)`);
  check('a voided strike does not (2 left: below the reporting count)', (await adminRpc(A.toda1, 'public.get_gps_determination_hotspots()')).value.areas.length === 0);
  await internal(`UPDATE strikes_ledger SET status = 'ACTIVE', points_active = 1 WHERE status = 'VOIDED' AND violation_code = 'DRV_STALL'`);

  console.log('\nS3 a silence before the pickup is a determination too (counted by the last confirmed point of the driver)');
  await s.online('D1', 300); await s.online('D2', 600);
  const b4 = await bookAndAccept('D1', 'P1');
  await s.moveTo('D1', 200); await silence('D1', 190); await s.sweep();
  const four = await adminRpc(A.toda1, 'public.get_gps_determination_hotspots()');
  check('a fourth booking, this time a silence, joins the same area: 4 determinations (3 stalls and 1 connectivity)', four.ok && four.value.areas.length === 1 && four.value.areas[0].determinations === 4 && four.value.areas[0].stalls === 3 && four.value.areas[0].connectivity === 1, four);
  await reset(b4.booking_id);

  console.log('\nS4 who sees what');
  check('the Administrator of ANOTHER TODA sees none of it', (await adminRpc(A.toda2, 'public.get_gps_determination_hotspots()')).value.areas.length === 0);
  check('the LGU Administrator sees it', (await adminRpc(A.lgu, 'public.get_gps_determination_hotspots()')).value.areas.length === 1);
  check('a passenger cannot', /Access Denied/.test((await adminRpc(s.PAX.P1.uid, 'public.get_gps_determination_hotspots()')).error ?? ''));
  check('a driver cannot', /Access Denied/.test((await adminRpc(DRIVERS.D1.uid, 'public.get_gps_determination_hotspots()')).error ?? ''));
  check('the number of days is bounded (a huge or negative window is clamped, never an error)', (await adminRpc(A.toda1, 'public.get_gps_determination_hotspots($1)', [100000])).value.window_days === 365 && (await adminRpc(A.toda1, 'public.get_gps_determination_hotspots($1)', [-5])).value.window_days === 1);

  console.log('\nS5 the TODA Administrator reports the area to the LGU Administrator (the shared review-flag mechanism)');
  const key = area.cell_key;
  check('a note is required', /ERR_AREA_NOTE/.test((await adminRpc(A.toda1, 'public.report_gps_area_issue($1, $2)', [key, ' '])).error ?? ''));
  check('the area key must be well formed', /ERR_AREA:/.test((await adminRpc(A.toda1, 'public.report_gps_area_issue($1, $2)', ['not a key', 'x'])).error ?? ''));
  check('a quiet area cannot be reported', /ERR_AREA_NOT_REPEATED/.test((await adminRpc(A.toda1, 'public.report_gps_area_issue($1, $2)', ['1:1', 'x'])).error ?? ''));
  check('the Administrator of another TODA cannot report this area: the database sees none of its determinations', /ERR_AREA_NOT_REPEATED/.test((await adminRpc(A.toda2, 'public.report_gps_area_issue($1, $2)', [key, 'x'])).error ?? ''));
  check('a passenger cannot report', /Access Denied/.test((await adminRpc(s.PAX.P1.uid, 'public.report_gps_area_issue($1, $2)', [key, 'x'])).error ?? ''));
  const r1 = await adminRpc(A.toda1, 'public.report_gps_area_issue($1, $2)', [key, 'Drivers lose signal behind the market building every afternoon.']);
  const flag = await q(`SELECT * FROM admin_review_flag WHERE flag_id='${r1.value?.flag_id}'`);
  check('reported: ONE review flag for the LGU Administrator, subject "service area", with the DATABASE\'s own counts (not the client\'s) and the note',
    r1.ok && flag.length === 1 && flag[0].flag_type === 'GPS_AREA_REVIEW' && flag[0].subject_type === 'service_area' && flag[0].subject_id === key && flag[0].assigned_role === 'lgu_admin'
      && flag[0].details.determinations === 4 && flag[0].details.stalls === 3 && flag[0].details.connectivity === 1 && /market building/.test(flag[0].details.note) && flag[0].details.reported_by_role === 'toda_admin', { r1, flag });
  const r2 = await adminRpc(A.toda1, 'public.report_gps_area_issue($1, $2)', [key, 'a second report of the same area']);
  check('reporting it again returns the same open flag (no duplicate)', r2.ok && r2.value.flag_id === r1.value.flag_id && (await q(`SELECT 1 FROM admin_review_flag WHERE flag_type='GPS_AREA_REVIEW'`)).length === 1);
  check('the list now shows the area as reported', (await adminRpc(A.toda1, 'public.get_gps_determination_hotspots()')).value.areas[0].reported === true);
  const audit = await q(`SELECT actor_role FROM audit_log WHERE action_type='GPS_AREA_REPORTED' AND target_id='${key}'`);
  check('an audit row records the report and who made it', audit.length >= 1 && audit[0].actor_role === 'toda_admin', audit);
  const lguView = await attempt(() => as(A.lgu, (tx) => tx.query(`SELECT count(*)::int n FROM admin_review_flag WHERE flag_type='GPS_AREA_REVIEW' AND status='Open'`)));
  check('the LGU Administrator reads the open flag through the existing review-flag list', lguView.ok && lguView.value.rows[0].n === 1, lguView);
  const resolved = await adminRpc(A.lgu, 'public.resolve_admin_review_flag($1, $2, $3)', [r1.value.flag_id, 'Resolved', 'Reviewed with the City Planning Office; the boundary will be checked.']);
  check('and resolves it with the existing function (the report is not a new kind of work item)', resolved.ok && resolved.value.status === 'Resolved', resolved);
  check('once resolved the area can be reported again if it keeps happening', (await adminRpc(A.toda1, 'public.report_gps_area_issue($1, $2)', [key, 'still happening'])).value.flag_id !== r1.value.flag_id);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
