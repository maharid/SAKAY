// Batch 11 (Rules 26.2, 26.3, 26.4, 29.20 - 29.23, 13.5; T5; decisions PI-11C, PI-11D): the Urgent Safety Report, End Trip (Early) for a Safety Concern (provisional fare, the
// safety incident, review, the victim not struck), and the administrator who ends a trip for safety (a detained or incapacitated driver, an accident, a passenger in danger).
// Whole migration chain on the local emulator (never Supabase).
const { setup, ID, PAX, DRIVERS, attempt, check, summary } = require('../b11fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal } = s;
  const D1 = DRIVERS.D1.id, P1 = PAX.P1.id;
  const track = async (b, n = 21) => { await s.track(b.booking_id, 'D1', n); };

  console.log('S1 Rule 26.2: the Urgent Safety Report - one tap, details optional, filed through the same guard, a second tap returns the same report');
  const t = await s.startTrip('D1', 'P1');
  let r = await s.urgent('P1', t.booking_id);
  check('one tap with no text: the report is filed with the default text, priority Emergency, routing TODA, filed during the trip',
    r.ok && r.value.success === true && r.value.existing === false && r.value.priority === 'Emergency' && r.value.routing === 'TODA', r);
  let inc = await s.report(r.value.incident_id);
  check('it is a report of the passenger about the trip (category Safety Concern), user-filed, the vehicle position recorded, the safety clocks set',
    inc.category === 'Safety Concern' && inc.reported_by === 'Passenger' && inc.source === 'USER' && inc.filed_during_trip === true && inc.incident_latitude !== null && inc.first_action_due_at !== null && /Urgent Safety Report/.test(inc.description), inc);
  const id1 = r.value.incident_id;
  r = await s.urgent('P1', t.booking_id);
  check('a second tap within two minutes returns the same report (no duplicate)', r.ok && r.value.existing === true && r.value.incident_id === id1 && (await s.reportsOf(t.booking_id)).length === 1, r);
  r = await s.urgent('P1', t.booking_id, 'Threat', 'He said he would hurt me if I told anyone where we are going.');
  check('"somebody is threatening me" is a serious allegation: straight to the LGU Administrator (Rule 19.8), priority Serious', r.ok && r.value.routing === 'LGU' && r.value.priority === 'Serious', r);
  r = await s.urgent('P2', t.booking_id);
  check('another passenger cannot file about this trip', r.ok && r.value.success === false && r.value.error_code === 'ERR_INCIDENT_NOT_PARTICIPANT', r);
  r = await s.urgent('P1', t.booking_id, 'Rude Behavior');
  check('only an emergency or a serious category is an Urgent Safety Report', r.ok && r.value.success === false && r.value.error_code === 'ERR_URGENT_CATEGORY', r);
  r = await s.urgent('D1', t.booking_id, 'Accident', 'The tricycle slid on the wet road and hit the curb.');
  check('the driver of the trip can file one too', r.ok && r.value.success === true && (await s.report(r.value.incident_id)).reported_by === 'Driver', r);
  check('the audit records the urgent reports', (await s.auditOf('URGENT_SAFETY_REPORT_FILED')).length === 3);
  await s.reset(); await s.clearAll();

  console.log('\nS2 Rules 13.5, 26.2, 26.4 (T5): Urgent Safety Report, then End Trip (Early) - provisional actual-distance fare, a safety incident for the review, the victim not struck');
  const t2 = await s.startTrip('D1', 'P1');
  await track(t2);
  const u = (await s.urgent('P1', t2.booking_id)).value;
  r = await attempt(() => s.paxCall('P1', 'passenger_request_early_end($1,$2,$3)', [t2.booking_id, 'safety_concern', 'He is driving too fast']));
  check('End Trip (Early) with a Safety Concern is accepted', r.ok && r.value.success === true && r.value.kind === 'SAFETY', r);
  check('the passenger had filed the Urgent Safety Report: End Trip (Early) adds no second one (PI-11D)', (await s.reportsOf(t2.booking_id)).length === 1 && (await s.reportsOf(t2.booking_id))[0].incident_id === u.incident_id);
  const end = await s.drvCall('D1', 'get_trip_end_state($1)', [t2.booking_id]).catch(() => null);
  r = await attempt(() => s.driverSets('D1', t2.booking_id, 'Arrived at Destination'));
  let bk = await s.bk(t2.booking_id);
  check('the driver ends the trip: early_end_kind SAFETY, the fare is the distance travelled (provisional: the ledger says Safety Early Termination)',
    bk.booking_status === 'Arrived at Destination' && bk.early_end_kind === 'SAFETY' && (await s.ledger(t2.booking_id)).some((x) => x.reason_code === 'SAFETY_EARLY_TERMINATION'), { bk: bk.booking_status, kind: bk.early_end_kind });
  r = await attempt(() => s.paxCall('P1', 'request_safety_fare_review($1,$2)', [t2.booking_id, 'The driver was going too fast and would not slow down.']));
  check('the passenger can ask for the administrative review of the provisional fare (Rule 13.5)', r.ok && r.value.success === true && (await s.dispute(t2.booking_id)).kind === 'SAFETY_REVIEW', r);
  check('the victim is not struck: no strike for the passenger from the early end, and the driver is not struck either', (await s.strikesOf(P1)).length === 0 && (await s.strikesOf(D1)).length === 0);
  await s.reset(); await s.clearAll();

  console.log('   End Trip (Early) for safety WITHOUT an earlier report: the system files the Urgent Safety Report (PI-11D: no hard gate)');
  const t3 = await s.startTrip('D1', 'P1');
  r = await attempt(() => s.paxCall('P1', 'passenger_request_early_end($1,$2,$3)', [t3.booking_id, 'safety_concern', null]));
  let rows = await s.reportsOf(t3.booking_id);
  check('one safety incident is created for the review: category Safety Concern, the passenger\'s, filed by the system during the trip, priority Emergency, routing TODA',
    r.ok && rows.length === 1 && rows[0].category === 'Safety Concern' && rows[0].reported_by === 'Passenger' && rows[0].source === 'SYSTEM' && rows[0].filed_during_trip === true && rows[0].priority === 'Emergency' && rows[0].routing === 'TODA', rows.map((x) => x.category));
  await s.paxCall('P1', 'passenger_request_early_end($1,$2,$3)', [t3.booking_id, 'safety_concern', null]);
  check('asking twice adds nothing', (await s.reportsOf(t3.booking_id)).length === 1);
  await s.reset(); await s.clearAll();
  const t4 = await s.startTrip('D1', 'P1');
  await s.paxCall('P1', 'passenger_request_early_end($1,$2,$3)', [t4.booking_id, 'changed_plans', null]);
  check('a personal early end is not a safety incident (no report)', (await s.reportsOf(t4.booking_id)).length === 0);
  await s.reset(); await s.clearAll();

  console.log('\nS3 Rules 29.20 - 29.22, 26.3 (PI-11C): an administrator ends the trip for safety');
  const ongoing = async () => { const x = await s.startTrip('D1', 'P1'); await track(x); return x; };
  let x = await ongoing();
  r = await s.endForSafety(PAX.P1.uid, x.booking_id, 'driver_detained');
  check('a passenger cannot', !r.ok && /Access Denied/.test(r.error), r);
  r = await s.endForSafety(s.T2, x.booking_id, 'driver_detained');
  check('the other TODA\'s Administrator cannot', !r.ok && /Access Denied/.test(r.error), r);
  r = await s.endForSafety(s.T1, x.booking_id, 'lunch break');
  check('the reason must be from the list', !r.ok && /ERR_SAFETY_END_REASON/.test(r.error), r);
  r = await s.endForSafety(s.T1, x.booking_id, 'driver_detained', 'short');
  check('a written note is required (how the situation was confirmed)', !r.ok && /ERR_SAFETY_END_NOTE/.test(r.error), r);
  r = await s.endForSafety(s.T1, x.booking_id, 'driver_detained', 'The passenger called the TODA; the police confirmed the arrest at the checkpoint.', 'Waived');
  bk = await s.bk(x.booking_id);
  check('Rule 29.20: the trip is ended AND closed at once: Completed, payment Waived, fare 0 (the TODA Administrator decides the fare, Rule 26.3), the ledger says why',
    r.ok && r.value.result === 'ended_and_closed' && bk.booking_status === 'Completed' && bk.payment_status === 'Waived' && Number(bk.actual_fare) === 0 && bk.early_end_kind === 'DRIVER'
    && (await s.ledger(x.booking_id)).some((l) => l.reason_code === 'ADMIN_CORRECTION' && Number(l.new_fare) === 0), { r, bk: { st: bk.booking_status, pay: bk.payment_status, fare: bk.actual_fare } });
  const rep = await s.reportsOf(x.booking_id);
  check('a safety incident is recorded (Emergency, by the system, no fault) and the passenger is told', rep.length === 1 && rep[0].category === 'Emergency' && rep[0].reported_by === 'System' && rep[0].source === 'SYSTEM' && rep[0].priority === 'Emergency'
    && (await s.noticesOf(P1, 'TRIP_ENDED_FOR_SAFETY')).length === 1, rep.map((y) => y.category));
  check('the driver is held for investigation (suspended, open-ended) and BOTH reviews are open: the TODA\'s and the LGU\'s', (await s.restriction('driver', D1)).kind === 'INVESTIGATION'
    && (await s.openFlags('DRIVER_DETENTION_TODA_REVIEW', D1)).length === 1 && (await s.openFlags('DRIVER_DETENTION_LGU_REVIEW', D1)).length === 1
    && (await s.openFlags('DRIVER_DETENTION_TODA_REVIEW', D1))[0].assigned_role === 'toda_admin' && (await s.openFlags('DRIVER_DETENTION_LGU_REVIEW', D1))[0].assigned_role === 'lgu_admin');
  check('no strike for anybody (Rules 29.20, 29.22)', (await s.strikesOf(D1)).length === 0 && (await s.strikesOf(P1)).length === 0);
  check('one audit entry names the action, the role and the result', (await s.auditOf('TRIP_ENDED_FOR_SAFETY', x.booking_id)).length === 1 && (await s.auditOf('TRIP_ENDED_FOR_SAFETY', x.booking_id))[0].actor_role === 'toda_admin');
  r = await s.endForSafety(s.T1, x.booking_id, 'driver_detained', 'The passenger called the TODA; the police confirmed the arrest at the checkpoint.', 'Waived');
  check('a second call changes nothing (already ended)', r.ok && r.value.result === 'already_ended' && (await s.openFlags('DRIVER_DETENTION_TODA_REVIEW', D1)).length === 1 && (await s.auditOf('TRIP_ENDED_FOR_SAFETY', x.booking_id)).length === 2, r);

  console.log('   Rule 29.20: the account does not resume before both reviews are done');
  let re = await attempt(() => s.rpcAs(s.LGU, `public.admin_reinstate_account('driver', $1, 'The driver was released without charge.', FALSE)`, [D1]));
  check('the LGU cannot reinstate while the reviews are open', !re.ok && /ERR_REVIEW_PENDING/.test(re.error), re);
  const todaFlag = (await s.openFlags('DRIVER_DETENTION_TODA_REVIEW', D1))[0];
  await attempt(() => s.todaCall('resolve_admin_review_flag($1,$2,$3)', [todaFlag.flag_id, 'Resolved', 'The TODA interviewed the driver and the officer.']));
  re = await attempt(() => s.rpcAs(s.LGU, `public.admin_reinstate_account('driver', $1, 'The driver was released without charge.', FALSE)`, [D1]));
  check('with only the TODA review done it is still refused', !re.ok && /ERR_REVIEW_PENDING/.test(re.error), re);
  const lguFlag = (await s.openFlags('DRIVER_DETENTION_LGU_REVIEW', D1))[0];
  await attempt(() => s.rpcAs(s.LGU, `public.resolve_admin_review_flag($1, 'Resolved', 'The LGU reviewed the police clearance.')`, [lguFlag.flag_id]));
  re = await attempt(() => s.rpcAs(s.LGU, `public.admin_reinstate_account('driver', $1, 'The driver was released without charge; both reviews are complete.', FALSE)`, [D1]));
  check('after BOTH reviews the LGU Administrator reinstates the driver', re.ok && (await s.restriction('driver', D1)).restricted !== true, re);
  await s.reset(); await s.clearAll();

  console.log('   a driver who became ill: a review flag, no suspension; leave the trip open with the actual-distance fare');
  x = await ongoing();
  r = await s.endForSafety(s.LGU, x.booking_id, 'driver_incapacitated', 'The passenger reported the driver fainted; the barangay health worker came.');
  bk = await s.bk(x.booking_id);
  check('Rule 29.22: the trip is ended at the destination stage (the passenger may still confirm the fare), not closed; a TODA review flag, no suspension, no strike',
    r.ok && r.value.result === 'ended' && bk.booking_status === 'Arrived at Destination' && (await s.openFlags('DRIVER_INCAPACITATED_REVIEW', D1)).length === 1 && (await s.restriction('driver', D1)).restricted !== true && (await s.strikesOf(D1)).length === 0, { r, bk: bk.booking_status });
  await s.reset(); await s.clearAll();

  console.log('   an accident, closed as Paid; a passenger in danger');
  x = await ongoing();
  r = await s.endForSafety(s.T1, x.booking_id, 'accident', 'The tricycle hit a pole; both are unhurt, the passenger paid the driver.', 'Paid');
  bk = await s.bk(x.booking_id);
  check('closed as Paid: Completed, payment Paid, the payment moment recorded', r.ok && bk.booking_status === 'Completed' && bk.payment_status === 'Paid' && bk.payment_received_at !== null, r);
  check('the incident is an Accident', (await s.reportsOf(x.booking_id))[0].category === 'Accident');
  await s.reset(); await s.clearAll();
  x = await ongoing();
  r = await s.endForSafety(s.LGU, x.booking_id, 'passenger_in_danger', 'The passenger texted that the driver would not stop; the TODA reached the driver.');
  check('a passenger in danger: ended, the incident is a Safety Concern', r.ok && (await s.reportsOf(x.booking_id))[0].category === 'Safety Concern');
  await s.reset(); await s.clearAll();

  console.log('   before the pickup: back to the search, no penalty');
  await s.online('D1', 300);
  const pre = await s.bookAndAccept('D1', 'P1');
  r = await s.endForSafety(s.T1, pre.booking_id, 'emergency', 'The driver\'s family called the TODA: he must go to the hospital now.');
  bk = await s.bk(pre.booking_id);
  check('the booking is redispatched (no driver, searching again); neither party is struck', r.ok && r.value.result === 'redispatched' && bk.driver_id === null && bk.booking_status === 'Pending' && (await s.strikesOf(D1)).length === 0 && (await s.strikesOf(P1)).length === 0, { r, st: bk.booking_status });
  await s.reset(); await s.clearAll();
  r = await s.endForSafety(s.T1, (await s.finished('P1', 'D1', { status: 'Cancelled' })), 'emergency');
  check('a trip that is not active is refused', !r.ok, r);

  const ok = summary();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
