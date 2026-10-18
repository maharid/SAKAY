// 20261028000005: four small gaps between the policy and the database, on the local emulator (never Supabase).
//   1. Rule 7.10  the Coverage Gap Indicator can be READ: an LGU Administrator reads every zone, a TODA Administrator its own zone only
//   2. Rule 7.9   a DRIVER_REPEATED_DECLINES flag can be CONFIRMED (the strike needs the administrator's confirmation), by the driver's own TODA Administrator or the LGU
//   3. Rule 3.9   permanently_disqualify_driver needs a real reason
//   4. PI-01      set_pilot_service_area checks the radius and writes an audit entry
const fs = require('fs');
const path = require('path');
const { setup, ID, DRIVERS, attempt, check, summary } = require('../b6fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, as } = s;
  const call = (uid, sql, params = []) => as(uid, (tx) => attempt(async () => (await tx.query(`SELECT ${sql} AS r`, params)).rows[0].r));

  console.log('S1 Rule 7.10: reading the Coverage Gap indicators');
  await internal(`UPDATE toda SET barangay = 'Lumangbayan' WHERE toda_id = '${ID.TODA1}'; UPDATE toda SET barangay = 'Sta. Isabel' WHERE toda_id = '${ID.TODA2}'`);
  const log = (zone, bookings, ago) => internal(
    `INSERT INTO audit_log (action_type, target_id, target_name, category, details, after_state, actor_role, performed_at)
     VALUES ('COVERAGE_GAP_INDICATOR', '${zone}', '${zone}', 'Dispatch', 'a gap',
             jsonb_build_object('zone', '${zone}', 'bookings', ${bookings}, 'threshold', 5, 'window_hours', 24), 'system', now() - interval '${ago}')`);
  await log('Lumangbayan', 5, '2 days');
  await log('Lumangbayan', 7, '1 day');
  await log('Sta. Isabel', 5, '3 hours');
  await log('Lumangbayan', 6, '60 days');
  let r = await call(ID.L_AUTH, `public.get_coverage_gaps(30)`);
  check('the LGU Administrator reads every zone of the last 30 days: two zones, the older entry (60 days) left out',
    r.ok && r.value.success === true && r.value.zones.length === 2 && r.value.events.length === 3 && r.value.window_days === 30, r);
  const lum = r.value.zones.find((z) => z.zone === 'Lumangbayan');
  check('...Lumangbayan was logged twice, the most bookings in a day 7; the newest zone first', lum && lum.times_logged === 2 && lum.most_bookings === 7 && r.value.zones[0].zone === 'Sta. Isabel', r.value.zones);
  check('...each event carries the count, the threshold and the window', r.value.events.every((e) => e.threshold === 5 && e.window_hours === 24 && e.bookings >= 5), r.value.events);
  r = await call(ID.T_AUTH, `public.get_coverage_gaps(30)`);
  check('a TODA Administrator reads only the zone of its own TODA (Lumangbayan)', r.ok && r.value.zones.length === 1 && r.value.zones[0].zone === 'Lumangbayan' && r.value.events.length === 2, r);
  r = await call(ID.T2_AUTH, `public.get_coverage_gaps(30)`);
  check('the other TODA\'s Administrator reads only its own (Sta. Isabel), not the first zone', r.ok && r.value.zones.length === 1 && r.value.zones[0].zone === 'Sta. Isabel', r);
  r = await call(ID.L_AUTH, `public.get_coverage_gaps(90)`);
  check('a longer window reads the older entry too, and the window is capped at 180 days', r.ok && r.value.events.length === 4 && (await call(ID.L_AUTH, `public.get_coverage_gaps(9999)`)).value.window_days === 180, r);
  for (const [who, uid] of [['a passenger', ID.P_AUTH], ['a driver', ID.D_AUTH]]) {
    r = await call(uid, `public.get_coverage_gaps(30)`);
    check(`${who} is refused`, !r.ok && /Access Denied/.test(r.error), r);
  }
  const anon = await attempt(() => s.anon((tx) => tx.query(`SELECT public.get_coverage_gaps(30)`)));
  check('and an anonymous caller', !anon.ok && /permission denied/i.test(anon.error), anon.error);

  console.log('\nS2 Rule 7.9: a pattern of declined offers can be confirmed, only by an administrator, only for the driver\'s own TODA');
  const flagId = async () => (await one(`SELECT public._presence_flag('DRIVER_REPEATED_DECLINES', '${ID.D1}', 'Rule 7.9', '{"declines_in_window": 5, "window_hours": 24, "note": "x"}'::jsonb) AS f`)).f;
  let f = await flagId();
  const strikes = async () => (await q(`SELECT violation_code, points_active FROM strikes_ledger WHERE subject_id = '${ID.D1}'`));
  r = await call(ID.T2_AUTH, `public.admin_confirm_flagged_violation($1, NULL, 'The reasons were weighed and found unjustified')`, [f]);
  check('another TODA\'s administrator cannot confirm it', !r.ok && /Access Denied/.test(r.error) && (await strikes()).length === 0, r);
  r = await call(ID.T_AUTH, `public.admin_confirm_flagged_violation($1, NULL, 'short')`, [f]);
  check('a short reason is refused', !r.ok && /ERR_CONFIRM_REASON/.test(r.error), r);
  r = await call(ID.P_AUTH, `public.admin_confirm_flagged_violation($1, NULL, 'I am the passenger and I want a strike')`, [f]);
  check('a passenger cannot', !r.ok, r);
  r = await call(ID.T_AUTH, `public.admin_confirm_flagged_violation($1, NULL, 'The reasons were weighed and found unjustified')`, [f]);
  const st = await strikes();
  check('the driver\'s TODA Administrator confirms: one DRV_REPEATED_REFUSAL strike, the flag resolved', r.ok && st.length === 1 && st[0].violation_code === 'DRV_REPEATED_REFUSAL' && (await one(`SELECT status FROM admin_review_flag WHERE flag_id = '${f}'`)).status === 'Resolved', { r, st });
  const who = await one(`SELECT actor_role FROM audit_log WHERE target_id = '${ID.D1}' AND action_type ILIKE 'STRIKE%' ORDER BY performed_at DESC LIMIT 1`);
  check('...recorded under the TODA Administrator\'s name', !who || who.actor_role === 'toda_admin', who);
  r = await call(ID.T_AUTH, `public.admin_confirm_flagged_violation($1, NULL, 'Clicked twice by mistake here')`, [f]);
  check('confirming twice does not strike twice', !r.ok && /ERR_FLAG_NOT_OPEN/.test(r.error) && (await strikes()).length === 1, r);
  f = await flagId();
  r = await call(ID.L_AUTH, `public.admin_confirm_flagged_violation($1, NULL, 'The LGU reviewed the offers and the reasons given')`, [f]);
  check('the LGU Administrator can confirm one too', r.ok && (await strikes()).length === 2, r);
  f = await flagId();
  r = await call(ID.L_AUTH, `public.resolve_admin_review_flag($1, 'Dismissed', 'The reasons given were genuine')`, [f]);
  check('dismissing a pattern flag issues no strike', r.ok && (await strikes()).length === 2, r);

  console.log('\nS3 Rule 3.9: permanent disqualification needs a real reason');
  for (const [label, reason] of [['no reason', null], ['a blank reason', '   '], ['a 9-character reason', '012345678']]) {
    r = await call(ID.L_AUTH, `public.permanently_disqualify_driver($1, $2)`, [ID.D3, reason]);
    check(`${label} is refused`, r.ok && r.value.success === false && /ERR_REASON_REQUIRED/.test(r.value.error), r);
  }
  check('...and the driver was not touched', (await one(`SELECT is_permanently_disqualified f FROM driver WHERE driver_id = '${ID.D3}'`)).f === false);
  r = await call(ID.T_AUTH, `public.permanently_disqualify_driver($1, 'A TODA is not allowed to do this one')`, [ID.D3]);
  check('a TODA Administrator is refused', r.ok && r.value.success === false && /Only LGU Administrators/.test(r.value.error), r);
  r = await call(ID.L_AUTH, `public.permanently_disqualify_driver('00000000-0000-4000-8000-00000000dead', 'A driver that does not exist at all')`);
  check('a driver that does not exist is an answer, not a silent no-op', r.ok && r.value.success === false && /not found/i.test(r.value.error), r);
  r = await call(ID.L_AUTH, `public.permanently_disqualify_driver($1, '  Falsified franchise papers found at inspection  ')`, [ID.D3]);
  const d3 = await one(`SELECT is_permanently_disqualified f, disqualification_reason r, account_status st, availability_status av FROM driver WHERE driver_id = '${ID.D3}'`);
  check('with a reason (trimmed) it works: disqualified, Rejected, Offline', r.ok && r.value.success === true && d3.f === true && d3.r === 'Falsified franchise papers found at inspection' && d3.st === 'Rejected' && d3.av === 'Offline', { r, d3 });
  check('...and it is audited under the LGU Administrator', (await q(`SELECT actor_role FROM audit_log WHERE action_type = 'DRIVER_PERMANENTLY_DISQUALIFIED' AND target_id = '${ID.D3}'`)).some((a) => a.actor_role === 'lgu_admin'));

  console.log('\nS4 PI-01: the pilot service area checks its radius and is audited');
  for (const [label, radius] of [['0 km', 0], ['0.4 km', 0.4], ['15.5 km', 15.5], ['5000 km', 5000], ['no radius', null]]) {
    r = await call(ID.L_AUTH, `public.set_pilot_service_area($1, $2)`, [ID.TODA1, radius]);
    check(`${label} is refused`, r.ok && r.value.success === false && /ERR_RADIUS/.test(r.value.error), r);
  }
  const before = (await one(`SELECT count(*)::int n FROM service_area_config`)).n;
  check('...and nothing was changed', (await one(`SELECT count(*)::int n FROM service_area_config`)).n === before);
  r = await call(ID.T_AUTH, `public.set_pilot_service_area($1, 1.5)`, [ID.TODA1]);
  check('a TODA Administrator is refused', r.ok && r.value.success === false && /Only LGU Administrators/.test(r.value.error), r);
  for (const radius of [0.5, 15, 1.5]) {
    r = await call(ID.L_AUTH, `public.set_pilot_service_area($1, $2)`, [ID.TODA1, radius]);
    check(`${radius} km is accepted`, r.ok && r.value.success === true, r);
  }
  const active = await one(`SELECT area_name, radius_km, is_active FROM service_area_config WHERE is_active`);
  check('the pilot area is the one active area', active.radius_km === 1.5 && /Pilot Area/.test(active.area_name) && (await one(`SELECT count(*)::int n FROM service_area_config WHERE is_active`)).n === 1, active);
  const audits = await q(`SELECT actor_role, details FROM audit_log WHERE action_type = 'SERVICE_AREA_CHANGED' AND details LIKE 'The service area was narrowed%' ORDER BY performed_at`);
  check('every change is in the audit log under the LGU Administrator, with the radius', audits.length === 3 && audits.every((a) => a.actor_role === 'lgu_admin') && /1\.5 km/.test(audits[2].details), audits);
  r = await call(ID.L_AUTH, `public.use_city_service_area()`);
  check('and the whole city can be put back', r.ok && r.value.success === true && (await one(`SELECT area_name FROM service_area_config WHERE is_active`)).area_name === 'Calapan City (city limits)', r);

  console.log('\nThe migration file');
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261028000005_insights_and_controls.sql'), 'utf8');
  check('it is pure ASCII with LF line endings', !/[^\x00-\x7F]/.test(sql) && !/\r/.test(sql) && sql.endsWith('\n'));
  void DRIVERS;

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
