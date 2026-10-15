// Batch 11 (Rules 15.3, 15.4, 29.6; T6): the LGU declares a calamity: ONE administrative action = the platform-wide announcement + the strike pause (cancellations, stalls and
// no-shows), recorded by ONE audit entry; serious violations are never paused; the LGU ends it with one more action. Whole migration chain on the local emulator.
const { setup, ID, PAX, DRIVERS, attempt, check, summary } = require('../b11fixtures');

(async () => {
  const s = await setup();
  const { q, one, internal } = s;
  const D1 = DRIVERS.D1.id, P1 = PAX.P1.id;
  const cfg = async () => (await one(`SELECT config_value AS v FROM system_policy_config WHERE config_key = 'strike_accrual_paused'`)).v;
  const declare = (uid, kind = 'Typhoon', title = 'Typhoon Paeng: bookings may be cancelled', msg = 'Heavy rain and flooding in Calapan. Drivers and passengers: stay safe. Cancellations, stalls and no-shows will not be struck while this lasts.', scope = 'CANCEL_STALL_NOSHOW') =>
    attempt(() => s.rpcAs(uid, 'public.declare_calamity($1,$2,$3,$4)', [kind, title, msg, scope]));
  const endIt = (uid, note = 'The weather cleared; roads are open again.') => attempt(() => s.rpcAs(uid, 'public.end_calamity($1)', [note]));
  const lateCancel = async () => {
    await s.online('D1', 300);
    const b = await s.bookAndAccept('D1', 'P1');
    await internal(`UPDATE booking SET accepted_at = clock_timestamp() - interval '90 seconds' WHERE booking_id = '${b.booking_id}'`);
    await s.cancelAs(PAX.P1.uid, b.booking_id);
    await s.reset();
    return b;
  };

  console.log('S1 Rule 29.6 (T6): only the LGU Administrator declares; the input is checked');
  let r = await declare(s.T1);
  check('a TODA Administrator cannot', !r.ok && /Access Denied/.test(r.error), r);
  r = await declare(PAX.P1.uid);
  check('a passenger cannot', !r.ok && /Access Denied/.test(r.error), r);
  r = await declare(s.LGU, 'Picnic');
  check('the kind must be from the list', !r.ok && /ERR_CALAMITY_KIND/.test(r.error), r);
  r = await declare(s.LGU, 'Typhoon', 'Hi', 'Heavy rain in Calapan today and tomorrow.');
  check('a title and a message are required', !r.ok && /ERR_CALAMITY_TEXT/.test(r.error), r);
  r = await declare(s.LGU, 'Typhoon', 'Typhoon Paeng', 'Heavy rain in Calapan today and tomorrow.', 'EVERYTHING');
  check('the scope must be ALL or CANCEL_STALL_NOSHOW', !r.ok && /ERR_CALAMITY_SCOPE/.test(r.error), r);

  console.log('\nS2 T6: LGU declares a calamity - strikes stop accruing, the announcement is visible, ONE audit entry');
  check('before: strikes accrue (a late cancellation is a strike)', (await lateCancel(), (await s.strikesOf(P1)).length === 1 && (await s.strikesOf(P1))[0].status === 'ACTIVE'));
  await s.clearAll();
  r = await declare(s.LGU);
  const decl = r.value;
  check('the LGU declares it', r.ok && decl.success === true && decl.scope === 'CANCEL_STALL_NOSHOW' && decl.declaration_id && decl.announcement_id && decl.pause_id, r);
  const c = await cfg();
  check('the pause switch is on for the cancellations / stalls / no-shows, with the reason and the pause id the declaration names', c.paused === true && c.scope === 'CANCEL_STALL_NOSHOW' && c.pause_id === decl.pause_id && /Typhoon/.test(c.reason), c);
  const ann = await one(`SELECT * FROM announcement WHERE announcement_id = '${decl.announcement_id}'`);
  check('the announcement is published to everybody, urgent, platform-wide (no TODA): visible to every app that lists announcements',
    ann.is_published === true && ann.target_audience === 'All' && ann.urgency === 'Urgent' && ann.toda_id === null && /Heavy rain/.test(ann.message), ann);
  check('the passenger app and the driver app can read it (the row policy lets a signed-in passenger and driver read announcements)',
    (await s.as(PAX.P1.uid, (tx) => tx.query(`SELECT 1 FROM announcement WHERE announcement_id = $1`, [decl.announcement_id]))).rows.length === 1
    && (await s.as(DRIVERS.D1.uid, (tx) => tx.query(`SELECT 1 FROM announcement WHERE announcement_id = $1`, [decl.announcement_id]))).rows.length === 1);
  const act = await s.rpcAs(PAX.P1.uid, 'public.get_active_calamity()');
  const actD = await s.rpcAs(DRIVERS.D1.uid, 'public.get_active_calamity()');
  check('every signed-in user reads the active calamity for the banner (kind, title, message, scope)', act.active === true && act.kind === 'Typhoon' && /Paeng/.test(act.title) && actD.active === true && act.scope === 'CANCEL_STALL_NOSHOW', act);
  const au = await s.auditOf('CALAMITY_DECLARED');
  check('ONE audit entry for the whole action (announcement + pause), by the LGU Administrator, naming the declaration, the kind and the announcement, with before and after',
    au.length === 1 && au[0].target_id === decl.declaration_id && au[0].actor_role === 'lgu_admin' && /Typhoon/.test(au[0].details) && au[0].after_state.calamity.announcement_id === decl.announcement_id && au[0].before_state.paused === false
    && (await s.auditOf('STRIKE_ACCRUAL_PAUSED')).length === 0, au.map((x) => x.action_type));
  r = await declare(s.LGU);
  check('declaring again while one is active changes nothing (a double tap): same declaration, no second announcement, no second audit',
    r.ok && r.value.already_active === true && r.value.declaration_id === decl.declaration_id && (await q(`SELECT 1 FROM announcement WHERE urgency = 'Urgent'`)).length === 1 && (await s.auditOf('CALAMITY_DECLARED')).length === 1, r);

  console.log('\n   during the calamity: cancellations, stalls and no-shows are recorded but not struck; serious violations are never paused');
  await lateCancel();
  let led = await s.strikesOf(P1);
  check('the passenger\'s late cancellation is an AUTO_WAIVED event with no points (recorded for the analytics)', led.length === 1 && led[0].status === 'AUTO_WAIVED' && led[0].points_active === 0 && (await s.activeCount('passenger', P1)) === 0, led);
  await s.online('D1', 300);
  const b2 = await s.bookAndAccept('D1', 'P1');
  const dc = await s.drvCall('D1', 'driver_cancel_booking($1,$2,$3)', [b2.booking_id, 'passenger_unreachable', null]);
  await s.reset();
  led = await s.strikesOf(D1);
  check('the driver\'s ordinary cancellation is waived too (the pause, not a safe reason)', dc.success === true && led.length === 1 && led[0].status === 'AUTO_WAIVED' && led[0].points_active === 0 && led[0].exempt_reason === null, { dc, led });
  const done = await s.finished('P1', 'D1');
  const assault = (await s.file('P1', done, 'Physical Assault', 'He hit me with a helmet when I asked him to stop the tricycle.')).value;
  r = await s.decide(s.LGU, assault.incident_id, 'UPHELD', 'The police report confirms the assault on the passenger.', 'DRV_PHYSICAL_ALTERCATION');
  check('serious violations are NOT paused: the upheld assault still suspends the driver pending the investigation', r.ok && (await s.restriction('driver', D1)).kind === 'INVESTIGATION', r);
  const rude = (await s.file('D1', done, 'Passenger Misconduct', 'The passenger insulted me and refused to leave the vehicle.')).value;
  await s.decide(s.LGU, rude.incident_id, 'UPHELD', 'Witnesses at the terminal confirm the insults.', 'PAX_ABUSIVE_UPHELD');
  check('a conduct strike is not pausable either (PAX_ABUSIVE_UPHELD counts)', (await s.activeCount('passenger', P1)) === 2);
  await s.clearAll();

  console.log('\nS3 ending the calamity: ONE more audit entry, strikes count again, a "normal operations" announcement');
  r = await endIt(s.T1);
  check('only the LGU Administrator can end it', !r.ok && /Access Denied/.test(r.error), r);
  r = await endIt(s.LGU);
  const ended = await one(`SELECT * FROM calamity_declaration WHERE declaration_id = '${decl.declaration_id}'`);
  check('the LGU ends it: the declaration is closed with who, when and the note; the pause is off', r.ok && ended.ended_at !== null && ended.ended_by !== null && /weather/.test(ended.end_note) && (await cfg()).paused === false, { r, ended });
  const au2 = await s.auditOf('CALAMITY_ENDED');
  check('ONE audit entry for the end', au2.length === 1 && au2[0].target_id === decl.declaration_id && au2[0].actor_role === 'lgu_admin' && (await s.auditOf('STRIKE_ACCRUAL_RESUMED')).length === 0, au2.map((x) => x.action_type));
  check('a "normal operations resumed" announcement is published', (await q(`SELECT 1 FROM announcement WHERE title LIKE 'Normal operations resumed%' AND is_published`)).length === 1);
  check('the banner is gone', (await s.rpcAs(PAX.P1.uid, 'public.get_active_calamity()')).active === false);
  r = await endIt(s.LGU);
  check('ending it twice is a no-op', r.ok && r.value.no_active_calamity === true && (await s.auditOf('CALAMITY_ENDED')).length === 1, r);
  await lateCancel();
  check('strikes accrue again (a late cancellation is ACTIVE)', (await s.strikesOf(P1)).length === 1 && (await s.strikesOf(P1))[0].status === 'ACTIVE');
  await s.clearAll();

  console.log('\nS4 the old switch still works (the same function underneath), and a manual pause is not silently taken over');
  r = await attempt(() => s.rpcAs(s.LGU, `public.set_strike_accrual_pause(TRUE, 'ALL', 'A manual pause for the test')`));
  check('set_strike_accrual_pause: same answers, its own audit names (STRIKE_ACCRUAL_PAUSED, once)', r.ok && r.value.success === true && (await s.auditOf('STRIKE_ACCRUAL_PAUSED')).length === 1, r);
  r = await declare(s.LGU);
  check('declaring a calamity while strikes are paused by hand is refused (resume it first)', !r.ok && /ERR_ALREADY_PAUSED/.test(r.error), r);
  r = await attempt(() => s.rpcAs(s.T1, `public.set_strike_accrual_pause(FALSE)`));
  check('a TODA Administrator still cannot switch it', !r.ok && /Access Denied/.test(r.error), r);
  r = await attempt(() => s.rpcAs(s.LGU, `public.set_strike_accrual_pause(FALSE)`));
  check('the LGU resumes it: STRIKE_ACCRUAL_RESUMED, once', r.ok && (await s.auditOf('STRIKE_ACCRUAL_RESUMED')).length === 1 && (await cfg()).paused === false, r);
  const direct = await s.writeAs(s.LGU, `UPDATE system_policy_config SET config_value = '{"paused": true}'::jsonb WHERE config_key = 'strike_accrual_paused'`);
  check('the switch cannot be written directly', !direct.ok && /set_strike_accrual_pause/.test(direct.error), direct);
  const tbl = await s.writeAs(s.LGU, `INSERT INTO calamity_declaration (kind, title, message, scope) VALUES ('Flood', 'x', 'y', 'ALL')`);
  check('the declaration table is written only by the functions', !tbl.ok, tbl);

  const ok = summary();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
