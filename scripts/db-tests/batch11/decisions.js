// Batch 11 (Rules 19.4, 19.5, 26.4, 2.5; T2): the outcome of a report. A report alone never strikes; an UPHELD report may carry the strike its category allows, issued
// through issue_strike() as the confirming administrator; a FABRICATED report strikes the reporter; a NOT_UPHELD report nobody; a confirmed victim is not struck; the TODA that
// reaches 3 upheld reports in 60 days is flagged. Whole migration chain on the local emulator (never Supabase).
const { setup, ID, PAX, DRIVERS, attempt, check, summary } = require('../b11fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, svc } = s;
  const D1 = DRIVERS.D1.id, P1 = PAX.P1.id;
  const strike = (type, subject, code, booking, key) => svc((tx) => tx.query(
    `SELECT public.issue_strike($1, $2, $3, NULL, $4, NULL, $5, NULL, 'event', NULL, NULL) AS r`, [type, subject, code, booking, key])).then((x) => x.rows[0].r);

  console.log('S1 Rule 19.4 (T2): filing a report strikes nobody; the TODA Administrator upholds it and the strike follows through the engine');
  const b1 = await s.finished('P1', 'D1');
  const rude = (await s.file('P1', b1, 'Rude Behavior')).value;
  check('a filed report is not a strike (nothing is automatic)', (await s.strikesOf(D1)).length === 0 && (await s.strikesOf(P1)).length === 0);
  let r = await s.decide(s.T2, rude.incident_id, 'UPHELD', 'Reviewed by somebody else.', 'DRV_RUDE_UPHELD');
  check('the other TODA\'s Administrator cannot decide it', !r.ok && /Access Denied/.test(r.error), r);
  r = await s.decide(s.T1, rude.incident_id, 'UPHELD', 'short', 'DRV_RUDE_UPHELD');
  check('the findings must be written (10 characters)', !r.ok && /ERR_INCIDENT_NOTE/.test(r.error), r);
  r = await s.decide(s.T1, rude.incident_id, 'UPHELD', 'Heard both sides; the driver shouted at the passenger.', 'PAX_ABUSIVE_UPHELD');
  check('a strike code that does not fit the category and the reporter is refused', !r.ok && /ERR_INCIDENT_STRIKE_CODE/.test(r.error), r);
  r = await s.decide(s.T1, rude.incident_id, 'UPHELD', 'Heard both sides; the driver shouted at the passenger.', 'DRV_RUDE_UPHELD', 3);
  check('points outside the catalog range (1 - 2) are refused, and the whole decision rolls back', !r.ok && /outside the allowed range/.test(r.error) && (await s.report(rude.incident_id)).outcome === null && (await s.strikesOf(D1)).length === 0, r);
  r = await s.decide(s.T1, rude.incident_id, 'UPHELD', 'Heard both sides; the driver shouted at the passenger.', 'DRV_RUDE_UPHELD');
  let row = await s.report(rude.incident_id);
  let st = await s.strikesOf(D1);
  check('UPHELD with DRV_RUDE_UPHELD: ONE strike for the driver, the minimum (1 point), issued by the TODA Administrator, linked to the report and the trip',
    r.ok && st.length === 1 && st[0].violation_code === 'DRV_RUDE_UPHELD' && st[0].points_active === 1 && st[0].status === 'ACTIVE' && st[0].issued_by_role === 'toda_admin'
    && st[0].incident_id === rude.incident_id && st[0].booking_id === b1, { r, st });
  check('the report records the outcome: Resolved, UPHELD, who and in what role, the strike and its code, the written findings',
    row.status === 'Resolved' && row.outcome === 'UPHELD' && row.decided_by_role === 'toda_admin' && row.strike_id === st[0].strike_id && row.strike_code === 'DRV_RUDE_UPHELD'
    && /shouted/.test(row.resolution_notes) && row.resolved_at !== null && row.first_action_at !== null, row);
  check('the reporter is told, the driver is told of the strike, and the decision is audited once with before and after',
    (await s.noticesOf(P1, 'INCIDENT_DECIDED')).length === 1 && (await s.noticesOf(D1, 'STRIKE_ISSUED')).length === 1
    && (await s.auditOf('INCIDENT_DECIDED', rude.incident_id)).length === 1 && (await s.auditOf('INCIDENT_DECIDED', rude.incident_id))[0].after_state.strike_code === 'DRV_RUDE_UPHELD');
  r = await s.decide(s.T1, rude.incident_id, 'UPHELD', 'Heard both sides; the driver shouted at the passenger.', 'DRV_RUDE_UPHELD');
  check('a second tap is a no-op: still ONE strike, one audit entry', r.ok && r.value.already_decided === true && (await s.strikesOf(D1)).length === 1 && (await s.auditOf('INCIDENT_DECIDED', rude.incident_id)).length === 1, r);
  r = await s.decide(s.T1, rude.incident_id, 'NOT_UPHELD', 'Changed my mind about the findings.');
  check('a decision cannot be flipped afterwards', !r.ok && /ERR_INCIDENT_ALREADY_DECIDED/.test(r.error), r);
  r = await s.start(s.T1, rude.incident_id);
  check('a decided report cannot be started again', r.ok && r.value.unchanged === true, r);

  console.log('\nS2 Rule 19.4: a dismissed report, and a no-fault resolution, carry no strike');
  const dismissed = (await s.file('P1', b1, 'Route Deviation')).value;
  r = await s.decide(s.T1, dismissed.incident_id, 'NOT_UPHELD', 'The route was the faster one; no deviation.', 'DRV_ROUTE_DEVIATION_FARE');
  check('NOT_UPHELD with a strike code is refused', !r.ok && /ERR_INCIDENT_STRIKE_NOT_ALLOWED/.test(r.error), r);
  r = await s.decide(s.T1, dismissed.incident_id, 'NOT_UPHELD', 'The route was the faster one; no deviation.');
  row = await s.report(dismissed.incident_id);
  check('NOT_UPHELD: status Dismissed, outcome recorded, no strike; the reporter is told it was not upheld',
    r.ok && row.status === 'Dismissed' && row.outcome === 'NOT_UPHELD' && row.strike_id === null && (await s.strikesOf(D1)).length === 1, { r, row });
  r = await s.decide(s.T1, (await s.file('P1', b1, 'Overcharging Attempt')).value.incident_id, 'RESOLVED', 'Everything agreed between them.');
  check('Resolved (no fault) is for an emergency only', !r.ok && /ERR_INCIDENT_OUTCOME/.test(r.error), r);

  console.log('\nS3 Rule 19.5 (T2): a fabricated or malicious report strikes the REPORTER, never the reported party');
  const fab = (await s.file('P1', b1, 'Unsafe Driving', 'He drove on the wrong side the entire way, nearly hit a jeepney.')).value;
  r = await s.decide(s.T1, fab.incident_id, 'FABRICATED', 'The GPS track and the passenger count show the trip as ordinary.', 'DRV_RUDE_UPHELD');
  check('a fabricated report cannot strike the reported driver', !r.ok && /ERR_INCIDENT_STRIKE_CODE/.test(r.error), r);
  r = await s.decide(s.T1, fab.incident_id, 'FABRICATED', 'The GPS track and the passenger count show the trip as ordinary.', 'PAX_FABRICATED_REPORT');
  st = await s.strikesOf(P1);
  check('FABRICATED by a passenger: PAX_FABRICATED_REPORT on the passenger (2 points), issued by the TODA Administrator; the driver keeps his single earlier strike',
    r.ok && st.length === 1 && st[0].violation_code === 'PAX_FABRICATED_REPORT' && st[0].points_active === 2 && st[0].issued_by_role === 'toda_admin' && (await s.strikesOf(D1)).length === 1, { r, st });
  const dfab = (await s.file('D1', b1, 'Passenger Misconduct', 'The passenger damaged the seat and refused to pay for it.')).value;
  r = await s.decide(s.LGU, dfab.incident_id, 'FABRICATED', 'The vehicle was inspected: no damage.', 'DRV_FABRICATED_REPORT');
  st = await s.strikesOf(D1);
  check('FABRICATED by a driver: DRV_FABRICATED_REPORT on the driver (2 points); the passenger is not struck for it',
    r.ok && st.some((x) => x.violation_code === 'DRV_FABRICATED_REPORT' && x.points_active === 2) && (await s.strikesOf(P1)).length === 1, { r, st });
  const nofab = (await s.file('P1', b1, 'Others', 'A complaint I cannot prove.')).value;
  r = await s.decide(s.T1, nofab.incident_id, 'FABRICATED', 'Could not be substantiated; reporter was confused, not malicious.');
  check('FABRICATED without a strike is allowed (the administrator\'s call: "may result in a strike")', r.ok && (await s.report(nofab.incident_id)).outcome === 'FABRICATED' && (await s.strikesOf(P1)).length === 1, r);

  console.log('\nS4 PI-11E: the TODA Administrator confirms a strike on a PASSENGER through the decision function; no other way');
  const dmg = (await s.file('D1', b1, 'Passenger Misconduct', 'The passenger put a cigarette out on the seat; the cover is burned.')).value;
  r = await s.decide(s.T2, dmg.incident_id, 'UPHELD', 'Photographed the seat myself.', 'PAX_VEHICLE_DAMAGE');
  check('the other TODA\'s Administrator cannot', !r.ok && /Access Denied/.test(r.error), r);
  r = await s.decide(s.T1, dmg.incident_id, 'UPHELD', 'Photographed the seat; the driver and the TODA officer inspected it.', 'DRV_RUDE_UPHELD');
  check('a driver code on a report about the passenger is refused', !r.ok && /ERR_INCIDENT_STRIKE_CODE/.test(r.error), r);
  r = await s.decide(s.T1, dmg.incident_id, 'UPHELD', 'Photographed the seat; the driver and the TODA officer inspected it.', 'PAX_VEHICLE_DAMAGE');
  st = (await s.strikesOf(P1)).filter((x) => x.violation_code === 'PAX_VEHICLE_DAMAGE');
  check('UPHELD with PAX_VEHICLE_DAMAGE (Rule 29.15): 3 points on the passenger, issued by the TODA Administrator, the report linked', r.ok && st.length === 1 && st[0].points_active === 3 && st[0].issued_by_role === 'toda_admin' && st[0].incident_id === dmg.incident_id, { r, st });
  const direct = await attempt(() => s.rpcAs(s.T1, `public.issue_strike('passenger', $1, 'PAX_VEHICLE_DAMAGE', NULL, NULL, NULL, 'direct-1', NULL, 'direct', NULL, NULL)`, [P1]));
  check('a TODA Administrator calling the strike engine on a passenger directly is still refused (the confirmation is only inside the decision function)', !direct.ok && /Access Denied/.test(direct.error), direct);
  const cont = (await s.file('D1', b1, 'Passenger Misconduct', 'The passenger vomited on the floor and the seats.')).value;
  r = await s.decide(s.T1, cont.incident_id, 'UPHELD', 'Cleaning took an hour; the driver showed me.', 'PAX_CONTAMINATION');
  check('Passenger Misconduct as contamination (Rule 29.16): PAX_CONTAMINATION, 1 point, only after the confirmation', r.ok && (await s.strikesOf(P1)).some((x) => x.violation_code === 'PAX_CONTAMINATION' && x.points_active === 1), r);

  console.log('\nS5 Rule 19.8 / 19.3: the LGU decides the serious ones; a sanction that suspends an account is the LGU\'s');
  const ass = (await s.file('P1', b1, 'Physical Assault', 'He struck me with a helmet when I asked him to stop.')).value;
  r = await s.decide(s.T1, ass.incident_id, 'UPHELD', 'I saw the injury myself.', 'DRV_PHYSICAL_ALTERCATION');
  check('the TODA Administrator cannot decide a serious report (read only)', !r.ok && /Access Denied/.test(r.error), r);
  r = await s.decide(s.T1, ass.incident_id, 'NOT_UPHELD', 'I think it did not happen; I called the driver.');
  check('...not even to dismiss it, with no strike at all: a report with the LGU is read only for the TODA Administrator (PI-11I)', !r.ok && /read only for the TODA Administrator/.test(r.error) && (await s.report(ass.incident_id)).outcome === null, r);
  r = await s.decide(s.LGU, ass.incident_id, 'UPHELD', 'The police report and the medical certificate confirm it.', 'DRV_PHYSICAL_ALTERCATION');
  const drvState = await s.restriction('driver', D1);
  check('the LGU upholds Physical Assault: DRV_PHYSICAL_ALTERCATION bypasses the ladder - the driver is suspended pending the investigation, no points',
    r.ok && drvState.kind === 'INVESTIGATION' && (await s.strikesOf(D1)).some((x) => x.violation_code === 'DRV_PHYSICAL_ALTERCATION'), { r, drvState });
  check('the TODA is shown a read-only copy and the LGU\'s decision is recorded with its role', (await s.visibleTo(s.T1)).includes(ass.incident_id) && (await s.report(ass.incident_id)).decided_by_role === 'lgu_admin');
  await internal(`UPDATE driver SET account_status = 'Verified', suspended_until = NULL, suspension_kind = NULL, suspended_at = NULL WHERE driver_id = '${D1}'`);
  await s.clearAll();

  console.log('\nS6 Rule 26.4 (T5): a confirmed victim of a safety incident is never struck for it');
  const trip = await s.finished('P1', 'D1', { status: 'Cancelled' });
  const other = await s.finished('P1', 'D1');
  await strike('passenger', P1, 'PAX_NO_SHOW', trip, 'victim-1');
  await strike('passenger', P1, 'PAX_LATE_CANCEL', other, 'victim-2');
  check('before the report: P1 has 3 strike points (2 for the no-show on this trip, 1 elsewhere)', (await s.activeCount('passenger', P1)) === 3);
  const saf = (await s.file('P1', trip, 'Safety Concern', 'The driver was drunk, I got out and ran, so I never boarded.')).value;
  r = await s.decide(s.LGU, saf.incident_id, 'NOT_UPHELD', 'Could not confirm; the driver was sober.');
  check('a safety report that is NOT upheld removes nothing', r.ok && (await s.activeCount('passenger', P1)) === 3);
  const saf2 = (await s.file('P1', trip, 'Safety Concern', 'The driver was drunk, I got out and ran, so I never boarded.')).value;
  r = await s.decide(s.T1, saf2.incident_id, 'UPHELD', 'The TODA officer smelled it at the terminal; the driver admits drinking.');
  const left = await s.strikesOf(P1);
  check('UPHELD: the no-show on THIS trip is waived (no points), the other trip\'s strike stands, the passenger is told, one audit entry names the waiver',
    r.ok && r.value.victim_strikes_waived === 1 && (await s.activeCount('passenger', P1)) === 1 && left.some((x) => x.violation_code === 'PAX_NO_SHOW' && x.status === 'WAIVED' && x.points_active === 0)
    && left.some((x) => x.violation_code === 'PAX_LATE_CANCEL' && x.status === 'ACTIVE') && (await s.noticesOf(P1, 'STRIKE_WAIVED_SAFETY_VICTIM')).length === 1
    && (await s.auditOf('VICTIM_STRIKES_WAIVED', saf2.incident_id)).length === 1, { r, left, active: await s.activeCount('passenger', P1), notices: (await s.noticesOf(P1, 'STRIKE_WAIVED_SAFETY_VICTIM')).map((n) => n.subject_id + ':' + n.threshold_days), audit: (await s.auditOf('VICTIM_STRIKES_WAIVED', saf2.incident_id)).length });
  const un = (await s.file('P1', other, 'Rude Behavior')).value;
  await s.decide(s.T1, un.incident_id, 'UPHELD', 'Heard both sides; the driver was rude.');
  check('an ordinary (non-safety) upheld report waives nothing', (await s.activeCount('passenger', P1)) === 1);
  const medical = await s.finished('P1', 'D1', { status: 'Cancelled' });
  await strike('passenger', P1, 'PAX_NO_SHOW', medical, 'victim-3');
  const med = (await s.file('P1', medical, 'Medical Emergency', 'I felt faint and went to the clinic, so I missed the pickup.')).value;
  r = await s.decide(s.T1, med.incident_id, 'RESOLVED', 'The clinic certificate confirms it; no fault on anybody.');
  check('Rule 19.7: a medical emergency is resolved with no fault, and the reporter\'s strike on that trip is waived too (the circumstance is verified)',
    r.ok && (await s.report(med.incident_id)).outcome === 'RESOLVED' && (await s.activeCount('passenger', P1)) === 1, r);
  r = await s.decide(s.T1, (await s.file('P1', medical, 'Accident', 'The tricycle hit a pothole, my arm hurts.')).value.incident_id, 'UPHELD', 'The accident is confirmed by the barangay blotter.', 'DRV_UNSAFE_DRIVING');
  check('an emergency incident carries no strike code (no automatic fault)', !r.ok && /ERR_INCIDENT_STRIKE_CODE/.test(r.error), r);
  await s.clearAll();

  console.log('\nS7 Rule 2.5: the TODA that reaches 3 UPHELD reports in 60 days is flagged for the LGU (the Batch 1 stub returned 0)');
  const run = async () => (await svc((tx) => tx.query(`SELECT public.check_toda_excess_incidents() AS n`))).rows[0].n;
  const upheld = async (n, after) => {
    const ids = [];
    for (let i = 0; i < n; i++) {
      const b = await s.finished('P1', 'D1');
      const x = (await s.file('P1', b, 'Rude Behavior')).value;
      await s.decide(s.T1, x.incident_id, 'UPHELD', 'Heard both sides; it was rude behavior.');
      if (after) await internal(`UPDATE incident_report SET resolved_at = clock_timestamp() - interval '${after}' WHERE incident_id = '${x.incident_id}'`);
      ids.push(x.incident_id);
    }
    return ids;
  };
  await upheld(2);
  check('two upheld reports: no flag', (await run()) === 0 && (await s.openFlags('TODA_EXCESS_INCIDENTS')).length === 0);
  const [third] = await upheld(1);
  check('the third creates ONE review flag for the LGU Administrator, subject the TODA', (await run()) === 1 && (await s.openFlags('TODA_EXCESS_INCIDENTS', ID.TODA1)).length === 1
    && (await s.openFlags('TODA_EXCESS_INCIDENTS', ID.TODA1))[0].assigned_role === 'lgu_admin' && (await s.openFlags('TODA_EXCESS_INCIDENTS', ID.TODA1))[0].details.upheld_reports === 3);
  check('running the job again creates no second flag', (await run()) === 0 && (await s.openFlags('TODA_EXCESS_INCIDENTS')).length === 1);
  await s.clearAll();
  await upheld(2); await upheld(1, '61 days');
  check('a report decided more than 60 days ago is not counted', (await run()) === 0 && (await s.openFlags('TODA_EXCESS_INCIDENTS')).length === 0);
  await s.clearAll();
  for (let i = 0; i < 3; i++) {
    const b = await s.finished('P1', 'D1');
    const x = (await s.file('P1', b, 'Rude Behavior')).value;
    await s.decide(s.T1, x.incident_id, i === 0 ? 'NOT_UPHELD' : 'FABRICATED', 'Not substantiated by the evidence.');
  }
  check('dismissed and fabricated reports are not counted', (await run()) === 0 && (await s.openFlags('TODA_EXCESS_INCIDENTS')).length === 0);
  const asTodaAdmin = await attempt(() => s.rpcAs(s.T1, 'public.check_toda_excess_incidents()'));
  check('the job is the server\'s: a signed-in administrator cannot run it', !asTodaAdmin.ok, asTodaAdmin);

  const ok = summary();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
