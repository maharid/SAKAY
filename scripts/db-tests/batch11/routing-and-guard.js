// Batch 11 (Rules 16.5, 19.1 - 19.3, 19.8; T1): the category list, who a report goes to, the emergency exception, the evidence limits, the review clocks, the end of the
// portals' direct writes, and the review actions start / escalate. Whole migration chain on the local emulator (never Supabase).
const { setup, ID, PAX, DRIVERS, attempt, check, summary } = require('../b11fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal } = s;
  const D1 = DRIVERS.D1.id, P1 = PAX.P1.id;

  console.log('S1 Rule 19.1: the categories of the list are accepted, anything else is refused');
  const done = await s.finished('P1', 'D1');
  for (const c of ['Rude Behavior', 'Unsafe Driving', 'Reckless Driving', 'Route Deviation', 'Overcharging Attempt', 'Passenger Misconduct', 'Change Refusal', 'Counterfeit Currency', 'Others', 'Lost Item']) {
    const r = await s.file('P1', done, c);
    check(`${c}: accepted for a completed trip`, r.ok, r);
  }
  let r = await s.file('P1', done, 'Made Up Category');
  check('a category outside the list is refused', !r.ok && /ERR_INCIDENT_INVALID/.test(r.error), r);
  r = await s.file('P1', done, 'Others', '   ');
  check('the description is mandatory (Rule 19.1: Others needs one; every category does here)', !r.ok && /ERR_INCIDENT_INVALID/.test(r.error), r);
  await s.clearAll();

  console.log('\nS2 Rule 16.5 (PI-11A): during the trip only an emergency incident may be filed; after it, anything');
  await s.online('D1', 300);
  const trip = await s.startTrip('D1', 'P1');
  r = await s.file('P1', trip.booking_id, 'Rude Behavior');
  check('a standard report about a trip in progress is refused', !r.ok && /ERR_INCIDENT_AFTER_TRIP/.test(r.error), r);
  r = await s.file('P1', trip.booking_id, 'Lost Item');
  check('a lost item is refused while the trip is on', !r.ok && /ERR_INCIDENT_AFTER_TRIP/.test(r.error), r);
  for (const c of ['Emergency', 'Medical Emergency', 'Safety Concern', 'Accident', 'Physical Assault', 'Harassment', 'Threat', 'Criminal Activity']) {
    r = await s.file('P1', trip.booking_id, c);
    check(`${c}: accepted during the trip`, r.ok && r.value.filed_during_trip === true, r);
  }
  const emerg = (await s.reportsOf(trip.booking_id)).find((x) => x.category === 'Emergency');
  check('the vehicle\'s last known position is recorded with a report filed during the trip (a fresh, accurate fix: near the pickup)',
    emerg && Math.abs(emerg.incident_latitude - s.PICKUP.lat) < 0.001 && Math.abs(emerg.incident_longitude - s.PICKUP.lng) < 0.001, { lat: emerg && emerg.incident_latitude, lng: emerg && emerg.incident_longitude });
  await internal(`UPDATE driver SET last_location_update = clock_timestamp() - interval '10 minutes' WHERE driver_id = '${D1}'`);
  const stale = (await s.file('P1', trip.booking_id, 'Accident')).value;
  check('with no fresh fix the position is left empty (nothing is guessed)', stale && stale.incident_latitude === null && stale.incident_longitude === null, stale);
  r = await s.file('D1', trip.booking_id, 'Emergency');
  check('the driver of the trip may file an emergency incident too', r.ok && r.value.reported_by === 'Driver', r);
  await s.reset(); await s.clearAll();

  console.log('\nS3 Rules 19.3 and 19.8 (T1): a Rude Behavior report about a driver goes to that driver\'s TODA Administrator; assault goes straight to the LGU');
  const b1 = await s.finished('P1', 'D1');
  const rude = (await s.file('P1', b1, 'Rude Behavior')).value;
  const assault = (await s.file('P1', b1, 'Physical Assault', 'He hit me with a helmet at the corner of the market.')).value;
  check('Rude Behavior: routing TODA, priority Standard, the reported driver\'s TODA, about the driver',
    rude.routing === 'TODA' && rude.priority === 'Standard' && rude.reported_toda_id === ID.TODA1 && rude.subject_type === 'driver' && rude.reported_by === 'Passenger' && rude.status === 'Pending', rude);
  check('Physical Assault: routing LGU at once, priority Serious, escalated on arrival with the reason of Rule 19.8',
    assault.routing === 'LGU' && assault.priority === 'Serious' && assault.escalated_at !== null && /Rule 19\.8/.test(assault.escalation_reason), assault);
  const dr = (await s.file('D1', b1, 'Passenger Misconduct')).value;
  check('a driver\'s report about the passenger goes to the driver\'s TODA first (Rule 19.3: it involves a driver), about the passenger', dr.routing === 'TODA' && dr.subject_type === 'passenger' && dr.reported_by === 'Driver', dr);
  for (const c of ['Harassment', 'Threat', 'Criminal Activity']) {
    const x = (await s.file('P1', b1, c)).value;
    check(`${c} goes straight to the LGU`, x.routing === 'LGU' && x.priority === 'Serious', x);
  }
  const em = (await s.file('P1', b1, 'Safety Concern')).value;
  check('an emergency incident: routing TODA, priority Emergency, no party at fault (Rule 19.7)', em.routing === 'TODA' && em.priority === 'Emergency' && em.subject_type === null, em);
  const t1sees = await s.visibleTo(s.T1), t2sees = await s.visibleTo(s.T2), lguSees = await s.visibleTo(s.LGU);
  check('the driver\'s TODA Administrator sees the standard report AND the assault (read only: PI-11I), the other TODA sees neither, the LGU sees all',
    t1sees.includes(rude.incident_id) && t1sees.includes(assault.incident_id) && !t2sees.includes(rude.incident_id) && !t2sees.includes(assault.incident_id)
    && lguSees.includes(rude.incident_id) && lguSees.includes(assault.incident_id), { t1sees: t1sees.length, t2sees: t2sees.length, lguSees: lguSees.length });
  check('the reporter reads only their own reports (a passenger sees theirs, the driver their own)',
    (await s.visibleTo(PAX.P1.uid)).includes(rude.incident_id) && !(await s.visibleTo(PAX.P2.uid)).includes(rude.incident_id));

  console.log('\nS4 F11.1: the review clocks');
  const addBd = async (ts, n) => (await one(`SELECT public.add_business_days('${new Date(ts).toISOString()}'::timestamptz, ${n}) AS t`)).t;
  const created = (x) => new Date(x.created_at).getTime();
  const hours = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / 3600000;
  check('standard: first review due in 2 business days, no LGU decision clock yet',
    new Date(rude.first_action_due_at).getTime() === new Date(await addBd(rude.created_at, 2)).getTime() && rude.decision_due_at === null, rude);
  check('serious (Rule 19.8): first action due in 4 hours, decision in 3 business days',
    Math.abs(hours(assault.created_at, assault.first_action_due_at) - 4) < 0.01 && new Date(assault.decision_due_at).getTime() === new Date(await addBd(assault.created_at, 3)).getTime(), assault);
  check('emergency: the same safety clocks', Math.abs(hours(em.created_at, em.first_action_due_at) - 4) < 0.01 && em.decision_due_at !== null, em);
  const li = (await s.file('P1', b1, 'Lost Item')).value;
  check('lost item: the TODA contact is due in 1 business day and the lost-item status starts Open',
    new Date(li.first_action_due_at).getTime() === new Date(await addBd(li.created_at, 1)).getTime() && li.lost_item_status === 'Open', li);

  console.log('\nS5 F11.4: a lost item is filed within 7 days of the trip');
  const old6 = await s.finished('P1', 'D1', { completedAgo: '6 days' });
  const old8 = await s.finished('P1', 'D1', { completedAgo: '8 days' });
  r = await s.file('P1', old6, 'Lost Item');
  check('6 days after the trip: accepted', r.ok, r);
  r = await s.file('P1', old8, 'Lost Item');
  check('8 days after the trip: refused, and the message tells to contact the TODA', !r.ok && /ERR_INCIDENT_LOST_ITEM_WINDOW/.test(r.error), r);
  r = await s.file('P1', old8, 'Rude Behavior');
  check('the 7-day window is for lost items only: another report about the same old trip is accepted', r.ok, r);

  console.log('\nS6 F11.2 / Rule 19.2: evidence - at most 3 photos, in the reporter\'s own folder, JPEG / PNG / WebP');
  const own = (n) => `${PAX.P1.uid}/${n}`;
  r = await s.file('P1', b1, 'Others', 'Photos attached.', { evidence_paths: [own('a.jpg'), own('b.png'), own('c.webp')] });
  check('three photos of the three formats: accepted', r.ok && r.value.evidence_paths.length === 3, r);
  r = await s.file('P1', b1, 'Others', 'Photos attached.', { evidence_paths: [own('a.jpg'), own('b.jpg'), own('c.jpg'), own('d.jpg')] });
  check('four photos: refused', !r.ok && /ERR_INCIDENT_EVIDENCE/.test(r.error), r);
  r = await s.file('P1', b1, 'Others', 'Photos attached.', { evidence_paths: [`${PAX.P2.uid}/a.jpg`] });
  check('a photo in somebody else\'s folder: refused', !r.ok && /ERR_INCIDENT_EVIDENCE/.test(r.error), r);
  for (const bad of ['a.pdf', 'a.gif', 'a.mp4', 'a']) {
    r = await s.file('P1', b1, 'Others', 'Photos attached.', { evidence_paths: [own(bad)] });
    check(`${bad}: refused (JPEG, PNG or WebP only)`, !r.ok && /ERR_INCIDENT_EVIDENCE/.test(r.error), r);
  }
  r = await s.file('P1', b1, 'Others', 'Photos attached.', { evidence_paths: [own('../x.jpg')] });
  check('a path with .. is refused', !r.ok && /ERR_INCIDENT_EVIDENCE/.test(r.error), r);

  console.log('\nS7 the forged request is overwritten; a report about a trip you were not on is refused');
  r = await s.file('P1', b1, 'Rude Behavior', 'Forged fields.', { routing: 'LGU', priority: 'Serious', status: 'Resolved', outcome: 'UPHELD', decided_by_role: 'lgu_admin', strike_code: 'DRV_RUDE_UPHELD', first_action_at: new Date().toISOString() });
  check('routing, priority, status, outcome, decision and first action come from the database whatever the request says',
    r.ok && r.value.routing === 'TODA' && r.value.priority === 'Standard' && r.value.status === 'Pending' && r.value.outcome === null && r.value.decided_by_role === null
    && r.value.strike_code === null && r.value.first_action_at === null, r);
  r = await s.file('P2', b1, 'Rude Behavior');
  check('another passenger cannot report this trip', !r.ok && /ERR_INCIDENT_NOT_PARTICIPANT/.test(r.error), r);

  console.log('\nS8 the portals no longer write a report: every review action is a function');
  let w = await s.writeAs(s.T1, `UPDATE incident_report SET status = 'Resolved', resolution = 'done' WHERE incident_id = $1`, [rude.incident_id]);
  check('a TODA Administrator\'s direct UPDATE is refused', !w.ok && /ERR_INCIDENT_USE_REVIEW/.test(w.error), w);
  w = await s.writeAs(s.LGU, `UPDATE incident_report SET status = 'Resolved' WHERE incident_id = $1`, [rude.incident_id]);
  check('the LGU Administrator\'s direct UPDATE is refused too', !w.ok && /ERR_INCIDENT_USE_REVIEW/.test(w.error), w);
  w = await s.writeAs(PAX.P1.uid, `UPDATE incident_report SET routing = 'LGU' WHERE incident_id = $1`, [rude.incident_id]);
  check('the reporter cannot change the routing', !w.ok && /ERR_INCIDENT_LOCKED/.test(w.error), w);
  w = await s.writeAs(PAX.P1.uid, `UPDATE incident_report SET status = 'Cancelled', cancellation_reason = 'sent twice', outcome = 'NOT_UPHELD' WHERE incident_id = $1`, [rude.incident_id]);
  check('the reporter cannot withdraw AND write an outcome', !w.ok && /ERR_INCIDENT_LOCKED/.test(w.error), w);
  w = await s.writeAs(PAX.P1.uid, `UPDATE incident_report SET status = 'Cancelled', cancellation_reason = 'sent it twice by mistake' WHERE incident_id = $1`, [rude.incident_id]);
  check('the reporter can withdraw a report nobody has started to review', w.ok, w);
  await s.clearAll();

  console.log('\nS9 start review (Rule 19.3): the driver\'s TODA Administrator; read only for the TODA once it is with the LGU');
  const b2 = await s.finished('P1', 'D1');
  const a = (await s.file('P1', b2, 'Unsafe Driving')).value;
  const asLgu = (await s.file('P1', b2, 'Harassment', 'He kept making threats the whole way.')).value;
  r = await s.start(s.T2, a.incident_id);
  check('the other TODA\'s Administrator cannot start it', !r.ok && /Access Denied/.test(r.error), r);
  r = await s.start(s.T1, a.incident_id);
  let row = await s.report(a.incident_id);
  check('the driver\'s TODA Administrator starts the review: Under Investigation, the first action is stamped, the reviewer is recorded',
    r.ok && row.status === 'Under Investigation' && row.first_action_at !== null && row.reviewed_by_toda !== null, { r, row });
  check('the reporter is told (Abiso)', (await s.noticesOf(P1, 'INCIDENT_UNDER_REVIEW')).length === 1);
  check('the start is audited', (await s.auditOf('INCIDENT_REVIEW_STARTED', a.incident_id)).length === 1);
  r = await s.start(s.T1, a.incident_id);
  check('a second tap changes nothing (no second notice, no second audit)', r.ok && r.value.unchanged === true && (await s.noticesOf(P1, 'INCIDENT_UNDER_REVIEW')).length === 1 && (await s.auditOf('INCIDENT_REVIEW_STARTED', a.incident_id)).length === 1, r);
  r = await s.start(s.T1, asLgu.incident_id);
  check('a serious report is the LGU\'s alone: the TODA Administrator cannot start it', !r.ok && /Access Denied/.test(r.error), r);
  r = await s.start(s.LGU, asLgu.incident_id);
  check('the LGU Administrator can', r.ok && (await s.report(asLgu.incident_id)).status === 'Under Investigation', r);

  console.log('\nS10 escalation (Rule 19.3) and reclassifying as serious (PI-11J)');
  const c = (await s.file('P1', b2, 'Overcharging Attempt')).value;
  r = await s.escalate(s.T1, c.incident_id, 'short');
  check('a reason of at least 10 characters is required', !r.ok && /ERR_INCIDENT_REASON/.test(r.error), r);
  r = await s.escalate(s.T2, c.incident_id);
  check('the other TODA\'s Administrator cannot escalate it', !r.ok && /Access Denied/.test(r.error), r);
  r = await s.escalate(s.T1, c.incident_id, 'The driver says the fare was agreed; suspension may follow.');
  row = await s.report(c.incident_id);
  check('the TODA Administrator escalates: routing LGU, who / when / why recorded, Under Investigation, LGU decision due in 3 business days',
    r.ok && row.routing === 'LGU' && row.escalated_at !== null && row.escalated_by !== null && /suspension/.test(row.escalation_reason) && row.status === 'Under Investigation'
    && new Date(row.decision_due_at).getTime() === new Date(await addBd(row.escalated_at, 3)).getTime(), { r, row });
  check('the reporter is told, and the escalation is audited once', (await s.noticesOf(P1, 'INCIDENT_ESCALATED')).length === 1 && (await s.auditOf('INCIDENT_ESCALATED', c.incident_id)).length === 1);
  r = await s.escalate(s.T1, c.incident_id);
  check('now the report is read only for the TODA Administrator (it is with the LGU)', !r.ok && /Access Denied/.test(r.error), r);
  r = await s.escalate(s.LGU, c.incident_id);
  check('an LGU escalation of a report already with the LGU is a no-op', r.ok && r.value.unchanged === true, r);
  const d = (await s.file('P1', b2, 'Rude Behavior')).value;
  r = await s.escalate(s.T1, d.incident_id, 'Describes a threat with a weapon, not rudeness.', true);
  row = await s.report(d.incident_id);
  check('"reclassify as serious": the priority is Serious and it is with the LGU; the TODA keeps read-only sight',
    r.ok && row.priority === 'Serious' && row.routing === 'LGU' && (await s.visibleTo(s.T1)).includes(d.incident_id), { r, row });
  r = await s.start(s.T1, d.incident_id);
  check('and cannot act on it any more', !r.ok && /Access Denied/.test(r.error), r);
  const e = (await s.file('P1', b2, 'Route Deviation')).value;
  r = await s.escalate(s.LGU, e.incident_id, 'The TODA did not review it in time; the LGU takes it over.');
  check('the LGU Administrator can take a report over', r.ok && (await s.report(e.incident_id)).routing === 'LGU', r);

  const ok = summary();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
