// Rules 7.9, 7.10, 3.9 and PI-01: the TypeScript the portals use for the decline history, the Coverage Gap report, allowing a re-application / permanent disqualification
// and the service area (packages/shared/src/utils/{dispatchInsights,driverApplications,serviceAreaControls}.ts) against the REAL database functions and row security.
// Proves that every call and parameter name exists (the calls are made by NAME), that the screens' checks agree with the database on a table of inputs, that the answers
// are read into what the screens show, that each person gets only what the database lets them read, and that the database's own sentences reach the screen.
// Whole migration chain on the local emulator (never Supabase).
const path = require('path');
const esbuild = require('esbuild');
const { setup, ID, AFF, attempt, check, summary, asUser } = require('../b6fixtures');

const SHARED = path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'src', 'utils');
function loadTs(file) {
  const code = esbuild.buildSync({ entryPoints: [file], bundle: true, write: false, format: 'cjs', platform: 'node', target: 'es2022', logLevel: 'silent' }).outputFiles[0].text;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
  return mod.exports;
}

(async () => {
  const insights = loadTs(path.join(SHARED, 'dispatchInsights.ts'));
  const apps = loadTs(path.join(SHARED, 'driverApplications.ts'));
  const area = loadTs(path.join(SHARED, 'serviceAreaControls.ts'));
  const s = await setup();
  const { db, internal, one, q } = s;

  // a Supabase-shaped client acting as a signed-in user: rpc by NAME (so a wrong parameter name fails here as it would in the app)
  const clientAs = (uid) => ({
    rpc: async (fn, args) => {
      try {
        const names = Object.keys(args ?? {});
        const r = await asUser(db, { uid }, (tx) => tx.query(`SELECT public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) AS r`, names.map((n) => args[n])), { commit: true });
        return { data: r.rows[0].r, error: null };
      } catch (e) {
        return { data: null, error: { message: e.message } };
      }
    },
  });
  const lgu = clientAs(ID.L_AUTH);
  const toda = clientAs(ID.T_AUTH);
  const otherToda = clientAs(ID.T2_AUTH);
  const driver = clientAs(ID.D_AUTH);
  const passenger = clientAs(ID.P_AUTH);

  // ---------------------------------------------------------------------------------------------------------------------------------
  console.log('S1 Rule 7.9: the decline history reaches the screen');
  const mkBooking = async (n) => {
    const id = `c6000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    await internal(`INSERT INTO booking (booking_id, passenger_id, passenger_count, pickup_address, pickup_latitude, pickup_longitude, dropoff_address, dropoff_latitude, dropoff_longitude, booking_status)
                    VALUES ('${id}', '${ID.P1}', 1, 'A', 13.41, 121.18, 'B', 13.42, 121.19, 'Cancelled')`);
    return id;
  };
  const offer = async (n, status, reason, ago, extra = '') => {
    const b = await mkBooking(n);
    await internal(`INSERT INTO dispatch_attempt (booking_id, driver_id, dispatch_method, driver_rank, response_status, decline_reason, notification_sent_at, responded_at, tier, cycle, eta_seconds, distance_m ${extra ? ', unanswered' : ''})
                    VALUES ('${b}', '${ID.D1}', 'Nearest', 1, '${status}', ${reason ? `'${reason}'` : 'NULL'}, now() - interval '${ago}',
                            ${status === 'Pending' ? 'NULL' : `now() - interval '${ago}' + interval '5 seconds'`}, 1, 1, 240, 900 ${extra ? ', TRUE' : ''})`);
  };
  check('no offers yet: the history is empty, a rate of 0 (nothing invented)', await (async () => {
    const h = await insights.fetchDeclineHistory(toda, ID.D1);
    return h !== null && h.offers === 0 && h.declined === 0 && h.declines.length === 0 && insights.declineRatePercent(h) === 0;
  })());
  await offer(1, 'Declined', 'vehicle_issue', '3 hours');
  await offer(2, 'Declined', 'vehicle_issue', '2 hours');
  await offer(3, 'Declined', null, '1 hour');
  await offer(4, 'Accepted', null, '30 minutes');
  await offer(5, 'Expired', null, '20 minutes', 'x');
  let h = await insights.fetchDeclineHistory(toda, ID.D1);
  check('the TODA Administrator reads 5 offers: 1 accepted, 3 declined (60%), 1 not answered', h !== null && h.offers === 5 && h.accepted === 1 && h.declined === 3 && h.unanswered === 1 && insights.declineRatePercent(h) === 60, h);
  check('...by reason, the largest first, and a missing reason is "not_given" (which has a label)', h.byReason[0].reason === 'vehicle_issue' && h.byReason[0].count === 2 && h.byReason.some((r) => r.reason === 'not_given' && r.count === 1)
    && h.byReason.every((r) => insights.DECLINE_REASON_LABELS[r.reason]), h.byReason);
  check('...the latest declines come newest first, with the tier, the ETA and the distance as numbers', h.declines.length === 3 && Date.parse(h.declines[0].declinedAt) > Date.parse(h.declines[2].declinedAt)
    && h.declines[0].tier === 1 && h.declines[0].etaSeconds === 240 && h.declines[0].distanceM === 900 && h.declines[0].reason === 'not_given', h.declines);
  const rawAnswer = (await lgu.rpc('get_driver_decline_history', insights.declineHistoryArgs(ID.D1, 30))).data;
  check('...the raw answer carries no passenger id or name', !/passenger_id|passenger_name|full_name/.test(JSON.stringify(rawAnswer)), Object.keys(rawAnswer));
  const lguH = await insights.fetchDeclineHistory(lgu, ID.D1, 7);
  check('the LGU Administrator reads the same, for a window it chooses (7 days)', lguH !== null && lguH.offers === 5 && lguH.windowDays === 7, lguH);
  check('another TODA\'s administrator gets null (the database refuses), as does a driver, a passenger, and an unknown driver',
    (await insights.fetchDeclineHistory(otherToda, ID.D1)) === null && (await insights.fetchDeclineHistory(driver, ID.D1)) === null
    && (await insights.fetchDeclineHistory(passenger, ID.D1)) === null && (await insights.fetchDeclineHistory(lgu, '00000000-0000-4000-8000-00000000dead')) === null);
  await offer(6, 'Declined', 'safety_concern', '40 days');
  check('an offer older than the window is not counted (30 days, then widened to 60)', (await insights.fetchDeclineHistory(toda, ID.D1, 30)).declined === 3 && (await insights.fetchDeclineHistory(toda, ID.D1, 60)).declined === 4);
  const flag = (await one(`SELECT public._presence_flag('DRIVER_REPEATED_DECLINES', '${ID.D1}', 'Rule 7.9', '{"declines_in_window": 3, "window_hours": 24, "note": "x"}'::jsonb) AS f`)).f;
  check('an open pattern flag is counted in the history', (await insights.fetchDeclineHistory(toda, ID.D1)).openReviewFlags === 1 && flag !== null);

  // ---------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS2 Rule 7.10: the Coverage Gap report reaches the screen');
  await internal(`UPDATE toda SET barangay = 'Lumangbayan' WHERE toda_id = '${ID.TODA1}'; UPDATE toda SET barangay = 'Sta. Isabel' WHERE toda_id = '${ID.TODA2}'`);
  const gap = (zone, bookings, ago) => internal(
    `INSERT INTO audit_log (action_type, target_id, target_name, category, details, after_state, actor_role, performed_at)
     VALUES ('COVERAGE_GAP_INDICATOR', '${zone}', '${zone}', 'Dispatch', 'a gap', jsonb_build_object('zone', '${zone}', 'bookings', ${bookings}, 'threshold', 5, 'window_hours', 24), 'system', now() - interval '${ago}')`);
  check('nothing logged: an empty report, not an error', await (async () => {
    const g = await insights.fetchCoverageGaps(lgu, 30);
    return g !== null && g.zones.length === 0 && g.events.length === 0 && g.windowDays === 30;
  })());
  await gap('Lumangbayan', 5, '2 days');
  await gap('Lumangbayan', 8, '1 day');
  await gap('Sta. Isabel', 6, '3 hours');
  const all = await insights.fetchCoverageGaps(lgu, 30);
  check('the LGU Administrator reads both zones, the newest first, with the figures as numbers', all !== null && all.zones.length === 2 && all.zones[0].zone === 'Sta. Isabel'
    && all.zones[1].timesLogged === 2 && all.zones[1].mostBookings === 8 && typeof all.zones[1].lastLoggedAt === 'string' && all.events.length === 3 && all.events[0].threshold === 5 && all.events[0].windowHours === 24, all);
  const mine = await insights.fetchCoverageGaps(toda, 30);
  check('a TODA Administrator reads only its own zone', mine !== null && mine.zones.length === 1 && mine.zones[0].zone === 'Lumangbayan' && mine.events.length === 2, mine);
  check('...and another TODA\'s only its own', (await insights.fetchCoverageGaps(otherToda, 30)).zones[0].zone === 'Sta. Isabel');
  check('a driver and a passenger get null (the database refuses)', (await insights.fetchCoverageGaps(driver, 30)) === null && (await insights.fetchCoverageGaps(passenger, 30)) === null);
  check('a window of 1 day leaves out the older entries', (await insights.fetchCoverageGaps(lgu, 1)).events.length === 1);

  // ---------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS3 Rule 3.9: allowing a re-application and disqualifying for good');
  check('the check of the reason: 9 characters and blanks do not pass, 10 do', apps.applicationReasonProblem('012345678') !== null && apps.applicationReasonProblem('         ') !== null && apps.applicationReasonProblem('0123456789') === null && apps.applicationReasonProblem('  0123456789  ') === null);
  for (const reason of ['012345678', '   ', '0123456789', '  Papers checked again at the office  ']) {
    const screen = apps.applicationReasonProblem(reason) === null;
    const res = await attempt(() => asUser(db, { uid: ID.L_AUTH }, async (tx) => (await tx.query(`SELECT public.permanently_disqualify_driver(${Object.keys(apps.disqualifyDriverArgs('a', 'b')).map((n, i) => `${n} => $${i + 1}`).join(', ')}) AS r`, Object.values(apps.disqualifyDriverArgs(ID.D3, reason)))).rows[0].r, { commit: false }));
    check(`"${reason.trim().slice(0, 14)}": the screen ${screen ? 'allows' : 'blocks'} it and the database ${res.ok && res.value.success ? 'accepts' : 'refuses'} it`, screen === (res.ok && res.value.success === true), { screen, res });
  }
  await internal(`UPDATE driver_toda_affiliation SET toda_endorsement_status = 'Rejected', toda_rejection_reason = 'duplicate_identity' WHERE affiliation_id = '${AFF.D3_T2}'`);
  const aff = () => one(`SELECT toda_endorsement_status st FROM driver_toda_affiliation WHERE affiliation_id = '${AFF.D3_T2}'`);
  const short = await apps.allowDriverReapplication(lgu, AFF.D3_T2, 'short');
  check('a short reason is refused with the database\'s sentence, without its code', short !== null && /at least 10 characters/.test(short) && !/ERR_/.test(short) && (await aff()).st === 'Rejected', short);
  const byToda = await apps.allowDriverReapplication(toda, AFF.D3_T2, 'The TODA changed its mind about this one');
  check('the TODA Administrator cannot (the LGU\'s alone)', byToda !== null && /Only an LGU administrator/.test(byToda) && (await aff()).st === 'Rejected', byToda);
  const byDriver = await apps.allowDriverReapplication(driver, AFF.D3_T2, 'I want to apply again, please let me');
  check('a driver cannot either', byDriver !== null && (await aff()).st === 'Rejected', byDriver);
  const ok = await apps.allowDriverReapplication(lgu, AFF.D3_T2, '  The papers were corrected and checked  ');
  check('the LGU Administrator can: null (no problem), the application is back in review', ok === null && (await aff()).st === 'Submitted', ok);
  const again = await apps.allowDriverReapplication(lgu, AFF.D3_T2, 'The papers were corrected and checked');
  check('doing it again, for an application that is not rejected, says so', again !== null && /Only rejected applications/.test(again), again);
  const gone = await apps.allowDriverReapplication(lgu, '00000000-0000-4000-8000-00000000dead', 'A record that does not exist at all');
  check('an application that does not exist is an answer', gone !== null && /not found/i.test(gone), gone);
  const noOne = await apps.permanentlyDisqualifyDriver(toda, ID.D3, 'A TODA is not allowed to do this one');
  check('a TODA Administrator cannot disqualify for good', noOne !== null && /Only LGU Administrators/.test(noOne) && (await one(`SELECT is_permanently_disqualified f FROM driver WHERE driver_id = '${ID.D3}'`)).f === false, noOne);
  const dq = await apps.permanentlyDisqualifyDriver(lgu, ID.D3, '  Falsified franchise papers found at inspection  ');
  const d3 = await one(`SELECT is_permanently_disqualified f, disqualification_reason r, account_status st FROM driver WHERE driver_id = '${ID.D3}'`);
  check('the LGU Administrator can: null, the reason is kept trimmed, the account is Rejected', dq === null && d3.f === true && d3.r === 'Falsified franchise papers found at inspection' && d3.st === 'Rejected', { dq, d3 });
  await internal(`UPDATE driver_toda_affiliation SET toda_endorsement_status = 'Rejected', lgu_verification_status = 'Rejected' WHERE affiliation_id = '${AFF.D3_T2}'`);
  const never = await apps.allowDriverReapplication(lgu, AFF.D3_T2, 'Trying to clear a disqualified applicant');
  check('after that, re-application can never be allowed for this driver', never !== null && /Permanently disqualified/.test(never), never);

  // ---------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS4 PI-01: the service area');
  check('the limits of the screen are the function\'s: 0.5 and 15', area.PILOT_RADIUS_MIN_KM === 0.5 && area.PILOT_RADIUS_MAX_KM === 15);
  for (const [label, radius] of [['0.4 km', 0.4], ['0.5 km', 0.5], ['1.5 km', 1.5], ['15 km', 15], ['15.5 km', 15.5], ['0 km', 0], ['-2 km', -2], ['5000 km', 5000]]) {
    const screen = area.pilotAreaProblem(ID.TODA1, radius) === null;
    const res = await attempt(() => asUser(db, { uid: ID.L_AUTH }, async (tx) => (await tx.query(`SELECT public.set_pilot_service_area(${Object.keys(area.pilotAreaArgs('a', 1)).map((n, i) => `${n} => $${i + 1}`).join(', ')}) AS r`, Object.values(area.pilotAreaArgs(ID.TODA1, radius)))).rows[0].r, { commit: false }));
    check(`${label}: the screen ${screen ? 'allows' : 'blocks'} it and the database ${res.ok && res.value.success ? 'accepts' : 'refuses'} it`, screen === (res.ok && res.value.success === true), { screen, res });
  }
  check('no TODA chosen, no radius, or a radius that is not a number is blocked by the screen', area.pilotAreaProblem(null, 1.5) !== null && area.pilotAreaProblem(ID.TODA1, null) !== null && area.pilotAreaProblem(ID.TODA1, Number.NaN) !== null);
  const call = (uid, fn, args) => clientAs(uid).rpc(fn, args);
  const asLgu = await call(ID.L_AUTH, 'set_pilot_service_area', area.pilotAreaArgs(ID.TODA1, 2));
  check('the LGU Administrator narrows the area', asLgu.data.success === true, asLgu);
  const asToda = await call(ID.T_AUTH, 'set_pilot_service_area', area.pilotAreaArgs(ID.TODA1, 2));
  check('a TODA Administrator is refused', asToda.data.success === false && /Only LGU Administrators/.test(asToda.data.error), asToda);
  const rows = await asUser(db, { uid: ID.L_AUTH }, (tx) => tx.query(`SELECT config_id, area_name, boundary_geojson, radius_km, is_active, notes, updated_at FROM public.service_area_config`), { commit: true }).then((r) => r.rows);
  const mapped = area.mapServiceAreas(rows);
  check('the rows are read into what the screen shows: the pilot area is the active one, first, a circle of 2 km, not the whole city', mapped[0].active === true && mapped[0].radiusKm === 2 && mapped[0].isWholeCity === false && /Pilot Area/.test(mapped[0].name)
    && mapped.filter((m) => m.active).length === 1, mapped);
  check('...and the city\'s boundary is among the earlier settings, marked as the whole city', mapped.some((m) => !m.active && m.isWholeCity), mapped);
  const back = await call(ID.L_AUTH, 'use_city_service_area', {});
  const rows2 = await asUser(db, { uid: ID.L_AUTH }, (tx) => tx.query(`SELECT config_id, area_name, boundary_geojson, radius_km, is_active, notes, updated_at FROM public.service_area_config`), { commit: true }).then((r) => r.rows);
  const m2 = area.mapServiceAreas(rows2);
  check('the whole city can be put back: it is the active one again', back.data.success === true && m2[0].active && m2[0].isWholeCity, m2[0]);
  const anyoneRead = await asUser(db, { uid: ID.P_AUTH }, (tx) => tx.query(`SELECT count(*)::int n FROM public.service_area_config`), { commit: true }).then((r) => r.rows[0].n);
  check('(everyone signed in can read the configured areas: the booking screens use them)', anyoneRead >= 2, anyoneRead);

  // ---------------------------------------------------------------------------------------------------------------------------------
  console.log('\nThe builders send exactly the database\'s parameter names');
  const names = (fn) => db.query(`SELECT unnest(proargnames) AS n FROM pg_proc WHERE proname = $1 AND pronamespace = 'public'::regnamespace`, [fn]).then((r) => r.rows.map((x) => x.n));
  for (const [fn, args] of [
    ['get_driver_decline_history', insights.declineHistoryArgs('d', 7)],
    ['get_coverage_gaps', insights.coverageGapsArgs(30)],
    ['allow_driver_reapplication', apps.allowReapplicationArgs('a', 'reason')],
    ['permanently_disqualify_driver', apps.disqualifyDriverArgs('d', 'reason')],
    ['set_pilot_service_area', area.pilotAreaArgs('t', 1)],
  ]) {
    const have = await names(fn);
    check(`${fn}: the arguments sent are exactly the function's`, JSON.stringify(Object.keys(args).sort()) === JSON.stringify([...have].sort()), { sent: Object.keys(args), have });
  }

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
