// Batch 11 (Rules 19.6, 29.19; T3; F11.4): a Lost Item report creates a TODA-facilitated contact and no strike; the unclaimed report is shown to the TODA after 14 days and closed
// by the administrator, never by the job. Whole migration chain on the local emulator (never Supabase).
const { setup, ID, PAX, DRIVERS, attempt, check, summary } = require('../b11fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal, svc } = s;
  const D1 = DRIVERS.D1.id, P1 = PAX.P1.id;
  const sweep = async () => (await svc((tx) => tx.query(`SELECT public.check_toda_excess_incidents() AS n`))).rows[0].n;

  console.log('S1 T3: the passenger reports a lost item; the TODA Administrator facilitates the contact; nobody is struck');
  const trip = await s.finished('P1', 'D1');
  const li = (await s.file('P1', trip, 'Lost Item', 'My umbrella and a blue bag were left under the seat.')).value;
  check('the report is Open, with the TODA contact due in 1 business day', li.lost_item_status === 'Open' && li.first_action_due_at !== null && li.outcome === null && li.subject_type === null, li);
  const counterparties = await s.todaCall('get_booking_counterparties($1)', [[trip]]);
  check('the TODA Administrator of the driver can read both parties\' names and phone numbers for the booking (to arrange the contact)',
    JSON.stringify(counterparties).includes('+639170000001') || JSON.stringify(counterparties).includes('Pax One'), counterparties);
  let r = await s.lost(s.T2, li.incident_id, 'Contact Arranged');
  check('the other TODA\'s Administrator cannot', !r.ok && /Access Denied/.test(r.error), r);
  r = await s.lost(s.T1, li.incident_id, 'Contact Arranged', 'short');
  check('a note of at least 10 characters (who was contacted, what was agreed)', !r.ok && /ERR_LOST_ITEM_NOTE/.test(r.error), r);
  r = await s.lost(s.T1, li.incident_id, 'Unknown');
  check('the status must be one of the four', !r.ok && /ERR_LOST_ITEM_STATUS/.test(r.error), r);
  r = await s.lost(s.T1, li.incident_id, 'Contact Arranged');
  let row = await s.report(li.incident_id);
  check('Contact Arranged: Under Investigation, the contact time is stamped, the first action recorded, no outcome yet',
    r.ok && row.lost_item_status === 'Contact Arranged' && row.status === 'Under Investigation' && row.lost_item_contact_at !== null && row.first_action_at !== null && row.outcome === null, { r, row });
  check('BOTH parties are told (Abiso): the passenger that the TODA connects them, the driver that a lost item was reported on his trip',
    (await s.noticesOf(P1, 'LOST_ITEM_CONTACT')).length === 1 && (await s.noticesOf(D1, 'LOST_ITEM_CONTACT')).length === 1);
  r = await s.lost(s.T1, li.incident_id, 'Contact Arranged');
  check('a second tap changes nothing (no second notice)', r.ok && r.value.unchanged === true && (await s.noticesOf(P1, 'LOST_ITEM_CONTACT')).length === 1, r);
  check('no strike for either party (Rule 19.6)', (await s.strikesOf(P1)).length === 0 && (await s.strikesOf(D1)).length === 0);
  r = await s.lost(s.T1, li.incident_id, 'Returned', 'The driver handed the bag back at the terminal at 4 pm.');
  row = await s.report(li.incident_id);
  check('Returned: Resolved, outcome RESOLVED, closed with the note, both told, audited; still no strike',
    r.ok && row.status === 'Resolved' && row.outcome === 'RESOLVED' && row.lost_item_status === 'Returned' && row.resolved_at !== null && row.decided_by_role === 'toda_admin'
    && (await s.noticesOf(P1, 'LOST_ITEM_CLOSED')).length === 1 && (await s.noticesOf(D1, 'LOST_ITEM_CLOSED')).length === 1
    && (await s.auditOf('INCIDENT_LOST_ITEM_UPDATED', li.incident_id)).length === 2 && (await s.strikesOf(D1)).length === 0, { r, row });
  r = await s.lost(s.T1, li.incident_id, 'Not Found');
  check('a closed report cannot become something else', !r.ok && /ERR_INCIDENT_ALREADY_DECIDED/.test(r.error), r);
  r = await s.lost(s.T1, li.incident_id, 'Returned', 'The driver handed the bag back at the terminal at 4 pm.');
  check('but repeating the same closure is a no-op', r.ok && r.value.unchanged === true, r);
  r = await s.decide(s.T1, (await s.file('P1', trip, 'Lost Item', 'A phone charger was left.')).value.incident_id, 'UPHELD', 'The charger belongs to the passenger.');
  check('the decision function refuses a lost item (it is closed as Returned, Not Found or Unclaimed)', !r.ok && /ERR_INCIDENT_USE_LOST_ITEM/.test(r.error), r);

  console.log('\nS2 F11.4: Not Found, and the driver\'s side (a driver reports an item left by the passenger)');
  await s.clearAll();
  const li2 = (await s.file('P1', trip, 'Lost Item', 'A wallet with my school ID and some cash.')).value;
  r = await s.lost(s.LGU, li2.incident_id, 'Not Found', 'The driver searched the tricycle with the TODA officer: nothing there.');
  check('the LGU Administrator can close it too: Not Found', r.ok && (await s.report(li2.incident_id)).lost_item_status === 'Not Found' && (await s.report(li2.incident_id)).outcome === 'RESOLVED', r);
  const li3 = (await s.file('D1', trip, 'Lost Item', 'The passenger left a jacket on the back seat.')).value;
  r = await s.lost(s.T1, li3.incident_id, 'Contact Arranged', 'Called the passenger; she will pick it up at the terminal.');
  check('a report from the driver: the PASSENGER is the other party told', r.ok && (await s.noticesOf(P1, 'LOST_ITEM_CONTACT', li3.incident_id)).length === 1 && (await s.noticesOf(D1, 'LOST_ITEM_CONTACT', li3.incident_id)).length === 1, r);
  const withdrawn = (await s.file('P1', trip, 'Lost Item', 'Found it myself, sorry.')).value;
  await s.writeAs(PAX.P1.uid, `UPDATE incident_report SET status = 'Cancelled', cancellation_reason = 'found the item at home' WHERE incident_id = $1`, [withdrawn.incident_id]);
  r = await s.lost(s.T1, withdrawn.incident_id, 'Contact Arranged');
  check('a withdrawn report is closed to the administrator', !r.ok && /ERR_INCIDENT_WITHDRAWN/.test(r.error), r);

  console.log('\nS3 F11.4: unclaimed after 14 days - shown to the TODA by the job, closed by the administrator, never by the job');
  await s.clearAll();
  const un = (await s.file('P1', trip, 'Lost Item', 'A scarf, left a while ago.')).value;
  check('a fresh report raises nothing', (await sweep()) === 0 && (await s.openFlags('LOST_ITEM_UNCLAIMED_REVIEW')).length === 0);
  await s.age(un.incident_id, '13 days');
  check('13 days: still nothing', (await sweep()) === 0 && (await s.openFlags('LOST_ITEM_UNCLAIMED_REVIEW')).length === 0);
  r = await s.lost(s.T1, un.incident_id, 'Unclaimed', 'Nobody answered for two weeks.');
  check('and the TODA cannot close it as Unclaimed yet', !r.ok && /ERR_LOST_ITEM_TOO_EARLY/.test(r.error), r);
  await s.age(un.incident_id, '2 days');
  check('14 days: the job shows it to the driver\'s TODA Administrator as ONE review flag', (await sweep()) === 1 && (await s.openFlags('LOST_ITEM_UNCLAIMED_REVIEW', D1)).length === 1
    && (await s.openFlags('LOST_ITEM_UNCLAIMED_REVIEW', D1))[0].assigned_role === 'toda_admin' && (await s.openFlags('LOST_ITEM_UNCLAIMED_REVIEW', D1))[0].details.incident_id === un.incident_id);
  check('the job does not close it (never auto-resolved)', (await s.report(un.incident_id)).outcome === null && (await s.report(un.incident_id)).status === 'Pending');
  check('running the job again adds no second flag', (await sweep()) === 0 && (await s.openFlags('LOST_ITEM_UNCLAIMED_REVIEW')).length === 1);
  r = await s.lost(s.T1, un.incident_id, 'Unclaimed', 'Nobody answered for two weeks; the TODA officer tried both numbers.');
  row = await s.report(un.incident_id);
  check('the TODA Administrator closes it as Unclaimed: outcome UNCLAIMED, the flag resolved, the reporter told',
    r.ok && row.outcome === 'UNCLAIMED' && row.lost_item_status === 'Unclaimed' && (await s.openFlags('LOST_ITEM_UNCLAIMED_REVIEW')).length === 0 && (await s.noticesOf(P1, 'LOST_ITEM_CLOSED', un.incident_id)).length === 1, { r, row });
  await s.clearAll();
  const un2 = (await s.file('P1', trip, 'Lost Item', 'A water bottle.')).value;
  await s.lost(s.T1, un2.incident_id, 'Contact Arranged', 'The TODA has called the driver already.');
  await s.age(un2.incident_id, '15 days');
  check('a report where contact WAS arranged is not flagged as unclaimed', (await sweep()) === 0 && (await s.openFlags('LOST_ITEM_UNCLAIMED_REVIEW')).length === 0);

  const ok = summary();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
