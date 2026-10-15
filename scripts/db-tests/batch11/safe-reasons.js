// Batch 11 (Rules 15.1 - 15.5, 29.12 - 29.14, 29.21; T4; decision PI-11B): a breakdown, an accident, an emergency, a safety concern, a road closure, an unsafe or illegal
// request or a prohibited item is recorded as an AUTO_WAIVED event with no points, a TODA verification flag and a repeat-pattern flag (3 in 30 days); the TODA or LGU
// Administrator may confirm the strike later. Before the pickup the passenger is redispatched without penalty; during the trip the reason is required before the trip ends.
// Whole migration chain on the local emulator (never Supabase).
const { setup, ID, PAX, DRIVERS, attempt, check, summary } = require('../b11fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal } = s;
  const D1 = DRIVERS.D1.id, P1 = PAX.P1.id;
  const cancel = async (reason, o = {}) => {
    await s.online('D1', 300);
    const b = await s.bookAndAccept('D1', 'P1');
    if (o.travelled) await s.moveTo('D1', o.travelled, 5);
    const out = await s.drvCall('D1', 'driver_cancel_booking($1,$2,$3)', [b.booking_id, reason, o.note ?? null]);
    return { b, out };
  };
  const ledgerOf = (id) => q(`SELECT violation_code, status, points_active, exempt_reason, issued_by_role FROM strikes_ledger WHERE subject_id = '${id}' AND status <> 'VOIDED' ORDER BY issued_at`);

  console.log('S1 Rule 15.1 (T4): a Vehicle Breakdown before the pickup - the driver is not struck, the passenger is redispatched without penalty');
  let { b, out } = await cancel('vehicle_breakdown', { travelled: 220, note: 'tire burst' });
  check('the cancellation succeeds and says the event was waived for the breakdown (not provisional)', out.success === true && out.waived === true && out.exempt_reason === 'VEHICLE_BREAKDOWN' && out.provisional === false, out);
  let led = await ledgerOf(D1);
  check('the strike ledger holds ONE event: AUTO_WAIVED, no active points, the exempt reason, recorded by the system (history and analytics keep it)',
    led.length === 1 && led[0].status === 'AUTO_WAIVED' && led[0].points_active === 0 && led[0].exempt_reason === 'VEHICLE_BREAKDOWN' && led[0].violation_code === 'DRV_CANCEL_EN_ROUTE' && led[0].issued_by_role === 'system', led);
  check('the driver has no strike points', (await s.activeCount('driver', D1)) === 0);
  let bk = await s.booking(b.booking_id);
  check('the passenger is not struck, and the booking goes back to the search (redispatched, driver cleared)', (await s.strikesOf(P1)).length === 0 && bk.driver_id === null && bk.booking_status === 'Pending', bk);
  check('the passenger is told the driver was unable to proceed', (await s.noticesOf(P1, 'DRIVER_CANCELLED_REDISPATCH')).length === 1);
  let fl = await s.openFlags('DRIVER_SAFE_REASON_REVIEW', D1);
  check('ONE verification flag for the driver\'s TODA Administrator lists the event (booking and reason)',
    fl.length === 1 && fl[0].assigned_role === 'toda_admin' && fl[0].details.events.length === 1 && fl[0].details.events[0].booking_id === b.booking_id && fl[0].details.events[0].reason === 'vehicle_breakdown', fl);
  check('no repeat-pattern flag after one event', (await s.openFlags('DRIVER_SAFE_REASON_PATTERN', D1)).length === 0);
  await s.reset(); await s.clearAll();

  console.log('\nS2 which reasons are waived, and which still strike (Rules 15.3, 15.5, 29.13, 29.14, 26.4)');
  const map = [['personal_emergency', 'EMERGENCY'], ['safety_concern', 'SAFETY_INCIDENT_VICTIM'], ['accident', 'TRAFFIC_ACCIDENT'], ['road_closure_or_traffic', 'FORCE_MAJEURE'],
                ['unsafe_or_illegal_request', 'LAWFUL_REFUSAL'], ['prohibited_item', 'LAWFUL_REFUSAL']];
  for (const [reason, exempt] of map) {
    ({ b, out } = await cancel(reason));
    led = await ledgerOf(D1);
    check(`${reason}: waived as ${exempt}, no points`, out.success === true && out.exempt_reason === exempt && led.length === 1 && led[0].status === 'AUTO_WAIVED' && led[0].points_active === 0 && led[0].exempt_reason === exempt, { out, led });
    await s.reset(); await s.clearAll();
  }
  for (const reason of ['passenger_unreachable', 'wrong_pickup_location', 'other']) {
    ({ b, out } = await cancel(reason));
    led = await ledgerOf(D1);
    check(`${reason}: still an ordinary strike (ACTIVE, 1 point before travelling)`, out.success === true && out.waived === false && led.length === 1 && led[0].status === 'ACTIVE' && led[0].points_active === 1 && led[0].exempt_reason === null, { out, led });
    await s.reset(); await s.clearAll();
  }
  ({ b, out } = await cancel('bored'));
  check('a reason outside the list is refused', out.success === false && out.error_code === 'ERR_CANCEL_REASON_REQUIRED', out);
  await s.reset(); await s.clearAll();
  ({ b, out } = await cancel('unsafe_or_illegal_request'));
  check('Rule 29.14: refusing is not a Driver Refusal Violation (no DRV_REPEATED_REFUSAL strike, flag or event)',
    (await ledgerOf(D1)).every((x) => x.violation_code !== 'DRV_REPEATED_REFUSAL') && (await s.openFlags('DRIVER_REPEATED_REFUSALS', D1)).length === 0);
  await s.reset(); await s.clearAll();

  console.log('\nS3 the repeat pattern: 3 safe-reason events in 30 days raise a flag for the TODA Administrator (review only)');
  await internal(`UPDATE admin_review_flag SET status = 'Dismissed' WHERE status IN ('Open','Under Review')`);
  for (let i = 1; i <= 3; i++) {
    ({ b, out } = await cancel('vehicle_breakdown'));
    await s.reset();
    const pat = await s.openFlags('DRIVER_SAFE_REASON_PATTERN', D1);
    check(`after event ${i}: ${i < 3 ? 'no pattern flag' : 'ONE pattern flag (assigned to the TODA Administrator), 3 events counted'}`, i < 3 ? pat.length === 0 : pat.length === 1 && pat[0].assigned_role === 'toda_admin' && pat[0].details.events_in_window === 3, pat);
  }
  fl = await s.openFlags('DRIVER_SAFE_REASON_REVIEW', D1);
  check('the one verification flag lists all three events', fl.length === 1 && fl[0].details.events.length === 3, fl.map((f) => f.details.events.length));
  check('nothing is struck automatically (3 AUTO_WAIVED events, no points)', (await s.activeCount('driver', D1)) === 0 && (await ledgerOf(D1)).length === 3);

  console.log('\nS4 the TODA or LGU Administrator may confirm the strike later, for the booking of the event');
  const ev = fl[0].details.events;
  let conf = await attempt(() => s.todaCall('admin_confirm_flagged_violation($1,$2,$3,$4)', [fl[0].flag_id, ev[0].booking_id, 'The tire was fine; the TODA officer inspected the tricycle.', null], ID.T2_AUTH));
  check('the other TODA\'s Administrator cannot', !conf.ok && /Access Denied/.test(conf.error), conf);
  conf = await attempt(() => s.todaCall('admin_confirm_flagged_violation($1,$2,$3,$4)', [fl[0].flag_id, ID.P1, 'The tire was fine; the TODA officer inspected the tricycle.', null]));
  check('a booking that is not an event of the flag is refused', !conf.ok && /ERR_NOT_A_SAFE_REASON_EVENT/.test(conf.error), conf);
  conf = await attempt(() => s.todaCall('admin_confirm_flagged_violation($1,$2,$3,$4)', [fl[0].flag_id, ev[0].booking_id, 'short', null]));
  check('the confirmation needs a written reason', !conf.ok && /ERR_CONFIRM_REASON/.test(conf.error), conf);
  conf = await attempt(() => s.todaCall('admin_confirm_flagged_violation($1,$2,$3,$4)', [fl[0].flag_id, ev[0].booking_id, 'The tire was fine; the TODA officer inspected the tricycle.', null]));
  led = await ledgerOf(D1);
  const real = led.filter((x) => x.status === 'ACTIVE');
  check('the driver\'s TODA Administrator confirms: ONE real strike of the code the cancellation had, issued by the TODA Administrator, the flag resolved',
    conf.ok && real.length === 1 && real[0].issued_by_role === 'toda_admin' && /^DRV_CANCEL_/.test(real[0].violation_code) && (await s.openFlags('DRIVER_SAFE_REASON_REVIEW', D1)).length === 0, { conf, led });
  conf = await attempt(() => s.todaCall('admin_confirm_flagged_violation($1,$2,$3,$4)', [fl[0].flag_id, ev[0].booking_id, 'The tire was fine; the TODA officer inspected the tricycle.', null]));
  check('confirming again changes nothing (the flag is closed)', !conf.ok && /ERR_FLAG_NOT_OPEN/.test(conf.error) && (await ledgerOf(D1)).filter((x) => x.status === 'ACTIVE').length === 1, conf);
  await s.clearAll();

  console.log('\nS5 Rules 15.2, 26.3, 29.21, 29.23 (T4): during the trip the driver gives the reason before ending; no automatic strike; the event is recorded');
  const stop = async (reason, note = null) => {
    const t = await s.startTrip('D1', 'P1');
    const r = await s.drvCall('D1', 'driver_stop_trip_early($1,$2,$3)', [t.booking_id, reason, note]);
    return { t, r };
  };
  let st;
  st = await stop(null);
  check('the reason is required: no reason, no end', st.r.success === false && st.r.error_code === 'ERR_EARLY_REASON_REQUIRED' && (await s.bk(st.t.booking_id)).booking_status === 'Trip Ongoing', st.r);
  await s.reset();
  const expectations = [
    ['vehicle_breakdown', 'VEHICLE_BREAKDOWN', null, 'a flat tire (Rule 29.21)'],
    ['accident', 'TRAFFIC_ACCIDENT', 'Accident', 'an accident (Rule 26.3)'],
    ['emergency', 'EMERGENCY', 'Emergency', 'an emergency'],
    ['medical_emergency', 'EMERGENCY', 'Medical Emergency', 'a passenger who needs a doctor (Rules 19.7, 29.23)'],
    ['safety_concern', 'SAFETY_INCIDENT_VICTIM', 'Safety Concern', 'a safety concern'],
  ];
  for (const [reason, exempt, category, label] of expectations) {
    st = await stop(reason, 'a note');
    const bkNow = await s.bk(st.t.booking_id);
    led = await ledgerOf(D1);
    const inc = await s.reportsOf(st.t.booking_id);
    check(`${label}: the trip ends at the stop (actual-distance fare), the event is AUTO_WAIVED as ${exempt}, no points`,
      st.r.success === true && st.r.valid_reason === true && bkNow.booking_status === 'Arrived at Destination' && led.length === 1 && led[0].violation_code === 'DRV_EARLY_STOP' && led[0].status === 'AUTO_WAIVED' && led[0].points_active === 0 && led[0].exempt_reason === exempt, { r: st.r, led });
    check(`${label}: ${category ? `an incident "${category}" is recorded (the driver's, filed during the trip, prioritized, no automatic fault)` : 'no incident row (a breakdown has no incident category), the TODA verification flag is raised'}`,
      category ? inc.length === 1 && inc[0].category === category && inc[0].reported_by === 'Driver' && inc[0].source === 'SYSTEM' && inc[0].priority === 'Emergency' && inc[0].filed_during_trip === true && inc[0].subject_type === null && inc[0].routing === 'TODA'
               : inc.length === 0 && (await s.openFlags('DRIVER_SAFE_REASON_REVIEW', D1)).length === 1, { inc: inc.map((x) => x.category) });
    check(`${label}: the TODA review flag of the early stop (Rule 13.7) exists and the TODA cannot confirm DRV_EARLY_STOP for it`, (await s.openFlags('DRIVER_EARLY_STOP_REVIEW', D1)).length === 1);
    await s.reset(); await s.clearAll();
  }
  st = await stop('passenger_dispute', 'We argued');
  led = await ledgerOf(D1);
  check('a dispute with the passenger is not a safe reason: no event in the ledger, no incident, only the review flag', st.r.success === true && st.r.valid_reason === false && led.length === 0 && (await s.reportsOf(st.t.booking_id)).length === 0 && (await s.openFlags('DRIVER_EARLY_STOP_REVIEW', D1)).length === 1, { r: st.r, led });
  await s.reset(); await s.clearAll();

  console.log('\nS6 Rule 29.12: a police checkpoint is a reported delay, never a violation');
  await s.online('D1', 300);
  b = await s.bookAndAccept('D1', 'P1');
  await s.moveTo('D1', 200); await s.sweep();
  let rep = await s.drvCall('D1', 'driver_report_delay($1,$2)', [b.booking_id, 'police_checkpoint']);
  check('"police_checkpoint" is accepted like traffic (it restarts the stand-still clock)', rep.success === true && rep.reason === 'police_checkpoint' && (await s.bk(b.booking_id)).stall_delay_reason === 'police_checkpoint', rep);
  check('and it is audited with its own words', (await s.auditOf('DRIVER_DELAY_REPORTED', b.booking_id)).length === 1 && /police checkpoint or inspection/.test((await s.auditOf('DRIVER_DELAY_REPORTED', b.booking_id))[0].details));
  rep = await s.drvCall('D1', 'driver_report_delay($1,$2)', [b.booking_id, 'lunch']);
  check('another reason is still refused', rep.success === false && rep.error_code === 'ERR_DELAY_REASON', rep);
  check('a delay after the pickup is never judged: nothing in the sweep strikes a trip in progress (stall rules are for the approach, Rule 8.5)', (await ledgerOf(D1)).length === 0);
  await s.reset(); await s.clearAll();

  console.log('\nS7 the existing declared pause still wins and the safe reasons do not disturb Rule 12.7 (three cancellations in 24 hours are flagged whatever the reasons)');
  for (let i = 0; i < 3; i++) { await cancel('vehicle_breakdown'); await s.reset(); }
  check('three breakdown cancellations in a day: the Rule 12.7 flag still fires (it counts cancellations, not strikes)', (await s.openFlags('DRIVER_REPEATED_CANCELLATIONS', D1)).length === 1);

  const ok = summary();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
