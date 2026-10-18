// Batch 12 (Rules 27.1 - 27.7; decision F12.6, F12.7): the detectors raise review FLAGS and nothing else - never a strike, never a restriction - they are quiet on honest data
// (a tunnel, a long silence, a loyal commuter), they raise a case once, and the LGU Administrator's confirmation records the violation against the accounts the flag names.
// Whole migration chain on the local emulator.
const { setup, ID, DRIVERS, PAX, attempt, check, summary } = require('../b12fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, as, svc } = s;
  const D1 = DRIVERS.D1.id, D2 = DRIVERS.D2.id, D3 = DRIVERS.D3.id, P1 = PAX.P1.id, P2 = PAX.P2.id;
  const LAT = 13.4115, LNG = 121.1803, STEP = 30 / 111195;       // 30 m of latitude
  const sweep = async () => (await svc((tx) => tx.query(`SELECT public.run_integrity_sweep() AS r`))).rows[0].r;
  const flagsFor = (type, subject) => s.flagsOf(type, subject);
  const confirm = (uid, flagId, reason = 'Reviewed the evidence with the TODA and the LGU.') => attempt(() => s.rpcAs(uid, 'public.admin_confirm_integrity_flag($1, $2)', [flagId, reason]));
  const strikesBefore = Number((await one(`SELECT count(*)::int n FROM strikes_ledger`)).n);

  // a track of `good` fixes 30 m apart every 5 s (21 km/h), with `teleports` fixes between them that jump 5 km at once
  const track = async (bookingId, driverId, good, teleports = 0, o = {}) => {
    const rows = [];
    const t0 = Date.now() - 3600 * 1000;
    let lat = LAT;
    const every = Math.max(1, Math.floor(good / (teleports + 1)));
    let sec = 0, tele = 0;
    for (let i = 0; i < good; i++) {
      lat += STEP;
      sec += o.gapAt === i ? 300 : 5;
      rows.push(`('${bookingId}', '${driverId}', ${lat}, ${LNG}, ${o.accuracy ?? 10}, '${new Date(t0 + sec * 1000).toISOString()}')`);
      if (tele < teleports && i > 0 && i % every === 0) {
        sec += 5;
        rows.push(`('${bookingId}', '${driverId}', ${lat + 0.045}, ${LNG}, ${o.teleAccuracy ?? 10}, '${new Date(t0 + sec * 1000).toISOString()}')`);
        tele++;
      }
    }
    await internal(`INSERT INTO gps_log (booking_id, driver_id, latitude, longitude, accuracy, recorded_at) VALUES ${rows.join(',')}`);
  };
  const completed = (pax, key, quoted = null) => s.trip(pax, key).then(async (id) => { if (quoted !== null) await internal(`UPDATE booking SET estimated_distance_km = ${quoted} WHERE booking_id = '${id}'`); return id; });

  console.log('S1 GPS spoofing / falsified distance (Rule 27.1): a flag, only on repeated evidence');
  const a = await completed('P1', 'D1', 1.0), b = await completed('P2', 'D1', 1.0);
  await track(a, D1, 40, 3);                 // 3 jumps: a suspect trip
  await track(b, D1, 40, 2);                 // 2 jumps: not suspect
  let r = await sweep();
  const sumA = await one(`SELECT public._trip_track_summary('${a}') AS r`).then((x) => x.r);
  check('the fare\'s own filter counts the jumps: trip A has 3 rejected-speed fixes, trip B 2', Number(sumA.rejected_speed) === 3 && Number((await one(`SELECT public._trip_track_summary('${b}') AS r`)).r.rejected_speed) === 2, sumA);
  check('one suspect trip among the last ten: NO flag (the repeat rule needs two)', (await flagsFor('GPS_SPOOFING_REVIEW', D1)).length === 0, r);
  const c = await completed('P1', 'D1', 1.0);
  await track(c, D1, 40, 3);
  r = await sweep();
  let fl = await s.openFlags('GPS_SPOOFING_REVIEW', D1);
  check('a second suspect trip: ONE flag for the driver, Rule 27.1, assigned to the LGU Administrator', fl.length === 1 && fl[0].source_rule === 'Rule 27.1' && fl[0].assigned_role === 'lgu_admin' && fl[0].subject_type === 'driver', fl);
  check('the flag lists the suspect trips with their jumps and names the driver as the account concerned', fl[0].details.suspect_count === 2 && fl[0].details.suspect_trips.every((x) => x.teleport_fixes === 3) && fl[0].details.parties[0].id === D1, fl[0].details);
  r = await sweep();
  check('a second sweep over the same evidence raises nothing more', (await flagsFor('GPS_SPOOFING_REVIEW', D1)).length === 1);
  check('a detector never punishes: no strike was issued and the driver is not restricted', Number((await one(`SELECT count(*)::int n FROM strikes_ledger`)).n) === strikesBefore && (await s.restriction('driver', D1)).restricted === false);

  const heavy = await completed('P1', 'D2', 1.0);
  await track(heavy, D2, 60, 10);
  await sweep();
  fl = await s.openFlags('GPS_SPOOFING_REVIEW', D2);
  check('one trip with ten jumps is enough on its own', fl.length === 1 && fl[0].details.suspect_count === 1, fl);

  const t1 = await completed('P1', 'D3', 1.0), t2 = await completed('P2', 'D3', 1.0), t3 = await completed('P1', 'D3', 1.0);
  await track(t1, D3, 40, 4, { teleAccuracy: 120 });              // wild fixes with a bad accuracy: the fare filter ignores them
  await track(t2, D3, 40, 0, { gapAt: 20 });                       // five minutes of silence, then the next fix: a tunnel, not a teleport
  await track(t3, D3, 40, 2);
  await sweep();
  check('honest data stays quiet: bad-accuracy fixes, a long silence and two jumps are not a flag', (await flagsFor('GPS_SPOOFING_REVIEW', D3)).length === 0);
  // a distance far from the route that was quoted: more than 40 percent AND more than 1 km, in two trips
  const m1 = await completed('P1', 'D3', 3.0), m2 = await completed('P2', 'D3', 3.0);
  await track(m1, D3, 170, 0);                                     // about 5.1 km tracked against 3.0 km quoted
  await track(m2, D3, 170, 0);
  await sweep();
  fl = await s.openFlags('GPS_SPOOFING_REVIEW', D3);
  check('a tracked distance (5.1 km) far from the quoted route (3.0 km) on two trips raises the flag', fl.length === 1 && fl[0].details.suspect_trips.every((x) => x.distance_mismatch === true), fl[0]?.details);
  const shortTrack = await completed('P1', 'D1', 4.0);
  await track(shortTrack, D1, 40, 0);                              // 1.2 km tracked against 4.0 km quoted but the flag for D1 is already open
  check('a single suspect distance alone (the other trip clean) is not enough: D1 still has exactly its one open flag', (await s.openFlags('GPS_SPOOFING_REVIEW', D1)).length === 1);

  console.log('\nS2 the LGU Administrator decides (Rule 27.1: DRV_GPS_SPOOFING suspends the driver pending the investigation)');
  fl = await s.openFlags('GPS_SPOOFING_REVIEW', D1);
  let cf = await confirm(ID.T_AUTH, fl[0].flag_id);
  check('a TODA Administrator cannot confirm', !cf.ok && /Access Denied/.test(cf.error), cf);
  cf = await confirm(ID.P_AUTH, fl[0].flag_id);
  check('a passenger cannot confirm', !cf.ok && /Access Denied/.test(cf.error), cf);
  cf = await confirm(ID.L_AUTH, fl[0].flag_id, 'short');
  check('the LGU Administrator must write the reason (10 characters)', !cf.ok && /ERR_CONFIRM_REASON/.test(cf.error), cf);
  const odd = await s.openFlags('DRIVER_LOW_RATING_REVIEW');
  cf = await confirm(ID.L_AUTH, '00000000-0000-4000-8000-00000000f1a9', 'There is no such flag at all.');
  check('an unknown flag is refused', !cf.ok && /ERR_FLAG_NOT_OPEN/.test(cf.error), cf);
  cf = await confirm(ID.L_AUTH, fl[0].flag_id);
  const dstate = await s.restriction('driver', D1);
  check('confirmed: the driver is suspended PENDING INVESTIGATION (no end date), the strike is DRV_GPS_SPOOFING with no points', cf.ok && cf.value.success === true && dstate.kind === 'INVESTIGATION' && (await s.strikesOf(D1)).some((x) => x.violation_code === 'DRV_GPS_SPOOFING' && x.issued_by_role === 'lgu_admin'), { cf, dstate });
  check('the flag is Resolved and the confirmation is in the audit log with the actor and the flag', (await flagsFor('GPS_SPOOFING_REVIEW', D1))[0].status === 'Resolved' && (await s.auditOf('INTEGRITY_FLAG_CONFIRMED', D1)).length === 1 && (await s.auditOf('INTEGRITY_FLAG_CONFIRMED', D1))[0].actor_id === ID.L_AUTH);
  cf = await confirm(ID.L_AUTH, fl[0].flag_id);
  check('confirming the same flag again is refused (already closed): no second strike', !cf.ok && /ERR_FLAG_NOT_OPEN/.test(cf.error) && (await s.strikesOf(D1)).filter((x) => x.violation_code === 'DRV_GPS_SPOOFING').length === 1, cf);
  // dismissal: the same evidence is not raised again, new evidence is
  const d3flag = (await s.openFlags('GPS_SPOOFING_REVIEW', D3))[0];
  await attempt(() => s.rpcAs(ID.L_AUTH, 'public.resolve_admin_review_flag($1, $2, $3)', [d3flag.flag_id, 'Dismissed', 'Reviewed the road works on that route; the quote was short.']));
  await sweep();
  check('a dismissed flag is not raised again for the SAME evidence', (await s.openFlags('GPS_SPOOFING_REVIEW', D3)).length === 0);
  const m3 = await completed('P2', 'D3', 3.0);
  await track(m3, D3, 170, 0);
  await sweep();
  check('...but new evidence (a third trip with the same pattern) is a new flag', (await s.openFlags('GPS_SPOOFING_REVIEW', D3)).length === 1);

  console.log('\nS3 rating manipulation (Rule 27.5; F12.7): reciprocal top ratings, concentration, burst');
  await internal(`DELETE FROM rating`);
  const at = (i) => new Date(Date.now() - (i + 1) * 2 * 3600 * 1000).toISOString();     // ratings two hours apart: ordinary use, never a burst
  const mine = [];
  for (let i = 0; i < 5; i++) mine.push(await s.trip('P1', 'D2'));
  for (let i = 0; i < 4; i++) { await s.rate(mine[i], 'Passenger', 5, at(i)); await s.rate(mine[i], 'Driver', 5, at(i)); }
  await s.rate(mine[4], 'Passenger', 5, at(4)); await s.rate(mine[4], 'Driver', 4, at(4));                // the driver gave 4: not a top rating
  await sweep();
  check('four mutual 5-star trips and a fifth that is not mutual: NO flag (a loyal commuter is normal)', (await flagsFor('RATING_MANIPULATION_REVIEW', D2)).length === 0);
  const fifth = await s.trip('P1', 'D2');
  await s.rate(fifth, 'Passenger', 5, at(5)); await s.rate(fifth, 'Driver', 5, at(5));
  await sweep();
  fl = await s.openFlags('RATING_MANIPULATION_REVIEW', D2);
  check('five mutual 5-star trips of the same pair in 30 days: a flag, pattern RECIPROCAL_FIVE_STAR, naming the driver and the passenger and the 10 ratings',
    fl.length === 1 && fl[0].details.pattern === 'RECIPROCAL_FIVE_STAR' && fl[0].details.rating_ids.length === 10 && fl[0].details.parties.length === 2 && fl[0].source_rule === 'Rule 27.5', fl[0]?.details);
  const before = await s.drv('D2');
  cf = await confirm(ID.L_AUTH, fl[0].flag_id, 'Both accounts traded top ratings on short trips with no passenger.');
  const after = await s.drv('D2');
  const rat = await q(`SELECT is_excluded FROM rating WHERE rating_id = ANY($1::uuid[])`, [fl[0].details.rating_ids]);
  check('confirmed: all 10 ratings are excluded, both accounts get 2 strikes (DRV_ / PAX_RATING_MANIPULATION), and the average follows',
    cf.ok && rat.length === 10 && rat.every((x) => x.is_excluded) && (await s.strikesOf(D2)).some((x) => x.violation_code === 'DRV_RATING_MANIPULATION' && x.points_active === 2)
      && (await s.strikesOf(P1)).some((x) => x.violation_code === 'PAX_RATING_MANIPULATION' && x.points_active === 2) && Number(before.n) === 6 && Number(after.n) === 1, { cf: cf.value, before, after });
  check('each exclusion is in the audit log', (await q(`SELECT 1 FROM audit_log WHERE action_type = 'RATING_EXCLUDED'`)).length === 10);

  await internal(`DELETE FROM rating`);
  for (let i = 0; i < 7; i++) { const t = await s.trip('P1', 'D3'); await s.rate(t, 'Passenger', 5, at(i)); }
  for (let i = 0; i < 2; i++) { const t = await s.trip('P2', 'D3'); await s.rate(t, 'Passenger', 5, at(7 + i)); }
  await sweep();
  check('nine ratings, almost all from two passengers, average 5.0: NO flag yet (fewer than ten ratings)', (await flagsFor('RATING_MANIPULATION_REVIEW', D3)).filter((x) => x.details.pattern === 'CONCENTRATION').length === 0);
  { const t = await s.trip('P2', 'D3'); await s.rate(t, 'Passenger', 5, at(9)); }
  await sweep();
  fl = (await s.openFlags('RATING_MANIPULATION_REVIEW', D3)).filter((x) => x.details.pattern === 'CONCENTRATION');
  check('ten ratings in 30 days, all from the two top passengers, mean 5.0: a CONCENTRATION flag', fl.length === 1 && fl[0].details.ratings === 10 && Number(fl[0].details.mean) >= 4.8, fl[0]?.details);
  await internal(`DELETE FROM rating`);
  await internal(`UPDATE admin_review_flag SET status = 'Dismissed' WHERE status IN ('Open', 'Under Review')`);
  for (let i = 0; i < 10; i++) { const t = await s.trip(i % 2 ? 'P1' : 'P2', 'D1'); await s.rate(t, 'Passenger', i % 2 ? 4 : 3, at(i)); }
  await sweep();
  check('the same ten ratings with an ordinary average (3.5): NO flag', (await s.openFlags('RATING_MANIPULATION_REVIEW', D1)).length === 0);

  await internal(`DELETE FROM rating`);
  const now = Date.now();
  const five = [];
  for (let i = 0; i < 5; i++) five.push(await s.trip('P2', ['D1', 'D2', 'D3'][i % 3]));
  for (let i = 0; i < 4; i++) await s.rate(five[i], 'Passenger', 5, new Date(now - (4 - i) * 60000).toISOString());
  await sweep();
  check('four ratings by one account inside ten minutes: NO flag', (await s.openFlags('RATING_MANIPULATION_REVIEW', P2)).length === 0);
  await s.rate(five[4], 'Passenger', 5, new Date(now - 30000).toISOString());
  await sweep();
  fl = await s.openFlags('RATING_MANIPULATION_REVIEW', P2);
  check('five ratings by one account inside ten minutes: a BURST flag naming that passenger', fl.length === 1 && fl[0].details.pattern === 'BURST' && fl[0].subject_type === 'passenger' && fl[0].details.ratings >= 5, fl[0]?.details);

  console.log('\nS4 collusive Shared Trip matching (Rule 27.4)');
  const mk = async (n) => {
    for (let i = 0; i < n; i++) {
      const prim = await s.trip('P1', 'D1'), add = await s.trip('P2', 'D1');
      await internal(`UPDATE booking SET is_shared_trip = TRUE WHERE booking_id IN ('${prim}', '${add}')`);
      await internal(`INSERT INTO shared_trip_match (primary_booking_id, additional_booking_id, host_driver_id, match_status, driver_response_status, matched_at)
                      VALUES ('${prim}', '${add}', '${D1}', 'Matched', 'Accepted', clock_timestamp())`);
    }
  };
  await mk(3);
  await sweep();
  check('three Matched pairings of one driver and one joining passenger in 30 days: NO flag', (await flagsFor('COLLUSIVE_MATCHING_REVIEW', D1)).length === 0);
  await mk(1);
  await sweep();
  fl = await s.openFlags('COLLUSIVE_MATCHING_REVIEW', D1);
  check('four: a flag for the driver naming the passenger, Rule 27.4', fl.length === 1 && fl[0].details.matches === 4 && fl[0].details.passenger_id === P2 && fl[0].details.parties.length === 2, fl[0]?.details);
  await internal(`UPDATE driver SET account_status = 'Verified', suspended_until = NULL, suspension_kind = NULL, suspended_at = NULL WHERE driver_id = '${D1}'`);
  cf = await confirm(ID.L_AUTH, fl[0].flag_id, 'The same two people matched four times with no real route in common.');
  const rd = await s.restriction('driver', D1), rp = await s.restriction('passenger', P2);
  check('confirmed: DRV_COLLUSIVE_MATCH and PAX_COLLUSIVE_MATCH deactivate BOTH accounts for review (closing them for good stays the separate, audited action)', cf.ok && rd.kind === 'DEACTIVATED' && rp.kind === 'DEACTIVATED', { cf: cf.value, rd, rp });

  console.log('\nS5 re-registration after a sanction (Rules 27.3, 27.6): the signals the system already holds');
  const mkPax = async (n, name, dob, ageDays = 0) => {
    await internal(`INSERT INTO auth.users (id, email) VALUES ('60000000-0000-0000-0000-0000000000${n}', 'rp${n}@x.com')`);
    await internal(`INSERT INTO passenger (passenger_id, auth_user_id, full_name, contact_number, account_status, date_of_birth, created_at)
                    VALUES ('d0000000-0000-0000-0000-0000000000${n}', '60000000-0000-0000-0000-0000000000${n}', '${name}', '+63917000${n}00', 'Active', '${dob}', now() - interval '${ageDays} days')`);
    return `d0000000-0000-0000-0000-0000000000${n}`;
  };
  const oldPax = await mkPax(11, 'Juan Dela Cruz', '1990-05-05', 400);
  await internal(`UPDATE passenger SET account_status = 'Deactivated', closed_at = now() - interval '30 days', deactivated_at = now() - interval '30 days' WHERE passenger_id = '${oldPax}'`);
  const sameNameOtherDob = await mkPax(12, 'Juan Dela Cruz', '1991-01-01');
  const stalePax = await mkPax(13, 'Juan Dela Cruz', '1990-05-05', 40);
  const goodStanding = await mkPax(14, 'Maria Santos', '1985-02-02', 400);
  const sameAsGood = await mkPax(15, 'maria  SANTOS', '1985-02-02');
  await sweep();
  check('a different birth date is not a match, and neither is a new account that is older than the look-back (14 days)', (await flagsFor('POSSIBLE_REREGISTRATION_REVIEW', sameNameOtherDob)).length === 0 && (await flagsFor('POSSIBLE_REREGISTRATION_REVIEW', stalePax)).length === 0);
  check('the same name and birth date as an account in good standing is not a flag', (await flagsFor('POSSIBLE_REREGISTRATION_REVIEW', sameAsGood)).length === 0);
  const newPax = await mkPax(16, 'JUAN  dela cruz', '1990-05-05');
  await sweep();
  fl = await s.openFlags('POSSIBLE_REREGISTRATION_REVIEW', newPax);
  check('a new account with the name and birth date of a CLOSED one (spelling, case and spaces aside): a flag naming the linked account, assigned to the LGU',
    fl.length === 1 && fl[0].details.basis.includes('name_and_birth_date') && fl[0].details.linked.some((x) => x.id === oldPax && x.state === 'CLOSED') && fl[0].assigned_role === 'lgu_admin', fl[0]?.details);
  cf = await confirm(ID.L_AUTH, fl[0].flag_id, 'Same person: the LGU checked the photo on the new account against the old file.');
  const stNew = await s.restriction('passenger', newPax), stOld = await s.restriction('passenger', oldPax);
  check('confirmed: the NEW account is deactivated for review (PAX_MULTI_ACCOUNT); the already closed one is left as it is', cf.ok && stNew.kind === 'DEACTIVATED' && stOld.kind === 'CLOSED' && (await s.strikesOf(newPax)).some((x) => x.violation_code === 'PAX_MULTI_ACCOUNT'), { cf: cf.value, stNew, stOld });
  // a driver coming back under another phone number with the same license
  await internal(`UPDATE driver SET license_number = 'N03-12-123456', plate_number = 'ABC 123', closed_at = now() - interval '10 days', deactivated_at = now() - interval '10 days', account_status = 'Deactivated' WHERE driver_id = '${D2}'`);
  await internal(`INSERT INTO auth.users (id, email) VALUES ('60000000-0000-0000-0000-0000000000aa', 'newdrv@x.com')`);
  await internal(`INSERT INTO driver (driver_id, auth_user_id, full_name, contact_number, account_status, license_number, plate_number, toda_id)
                  VALUES ('e0000000-0000-0000-0000-0000000000aa', '60000000-0000-0000-0000-0000000000aa', 'Another Name', '+639189990077', 'Pending Verification', 'N0312-123456', 'ABC123', '${ID.TODA1}')`);
  await sweep();
  fl = await s.openFlags('POSSIBLE_REREGISTRATION_REVIEW', 'e0000000-0000-0000-0000-0000000000aa');
  check('a new driver account with the same license and plate (dashes and spaces aside) as a closed driver: a flag with both bases', fl.length === 1 && fl[0].details.basis.includes('license_number') && fl[0].details.basis.includes('plate_number') && fl[0].details.linked.some((x) => x.id === D2), fl[0]?.details);
  check('no device identifier is used or kept: the flag holds only account ids, the basis and a state', Object.keys(fl[0].details).every((k) => ['basis', 'linked', 'parties', 'note', 'signature'].includes(k)), Object.keys(fl[0].details));

  console.log('\nS6 who may run what');
  const asUserSweep = await attempt(() => as(ID.L_AUTH, (tx) => tx.query(`SELECT public.run_integrity_sweep()`)));
  const asAnon = await attempt(() => s.asUser(s.db, { uid: null, role: 'anon' }, (tx) => tx.query(`SELECT public.run_integrity_sweep()`), { commit: true }));
  check('no signed-in user and no visitor can run the sweep (the scheduled job and the service role do)', !asUserSweep.ok && /permission denied/i.test(asUserSweep.error) && !asAnon.ok, [asUserSweep.error, asAnon.error]);
  const notConfirmable = await q(`INSERT INTO admin_review_flag (flag_type, subject_type, subject_id, source_rule, assigned_role) VALUES ('ROSTER_MISMATCH', 'toda', '${ID.TODA1}', 'Rule 2.4', 'lgu_admin') RETURNING flag_id`);
  cf = await confirm(ID.L_AUTH, notConfirmable[0].flag_id);
  check('a flag that is not a detector flag cannot be "confirmed" here', !cf.ok && /ERR_FLAG_NOT_CONFIRMABLE/.test(cf.error), cf);
  void odd;

  console.log('\nS7 an unregistered person driving the vehicle (Rule 27.2): a SERIOUS incident category');
  await s.clearAll();
  await internal(`UPDATE driver SET account_status = 'Verified', closed_at = NULL, deactivated_at = NULL, is_permanently_disqualified = FALSE WHERE driver_id IN ('${D1}', '${D2}', '${D3}')`);
  await internal(`UPDATE passenger SET account_status = 'Active', closed_at = NULL, deactivated_at = NULL WHERE passenger_id IN ('${P1}', '${P2}')`);
  const done = await s.trip('P1', 'D1');
  const rep = await s.file('P1', done, 'Unregistered Person Driving', 'The person driving was not the driver in the photo of the app; he said he was the driver\'s cousin.');
  check('the passenger can file it: class SERIOUS, straight to the LGU Administrator, Serious priority', rep.ok && rep.value.routing === 'LGU' && rep.value.priority === 'Serious' && rep.value.reported_by === 'Passenger', rep);
  const bad = await s.decide(ID.L_AUTH, rep.value.incident_id, 'UPHELD', 'The vehicle was driven by an unaccredited man.', 'DRV_RUDE_UPHELD');
  check('only DRV_SUBSTITUTE_DRIVER may follow this report', !bad.ok, bad);
  const up = await s.decide(ID.L_AUTH, rep.value.incident_id, 'UPHELD', 'The LGU checked the franchise holder: an unaccredited man drove the vehicle.', 'DRV_SUBSTITUTE_DRIVER');
  const st = await s.restriction('driver', D1);
  check('upheld: DRV_SUBSTITUTE_DRIVER suspends the driver immediately pending the LGU investigation (no end date, no points)', up.ok && st.kind === 'INVESTIGATION' && (await s.strikesOf(D1)).some((x) => x.violation_code === 'DRV_SUBSTITUTE_DRIVER'), { up, st });

  const strikesAfter = await q(`SELECT violation_code FROM strikes_ledger WHERE issued_by_role IS NOT NULL AND issued_by_role = 'system'`);
  check('the sweeps themselves never issued a strike (every strike here has a named administrator behind it)', strikesAfter.length === 0, strikesAfter);

  const ok = summary();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
