// Batch 6: offers and assignment. Spec section 9 (no double assignment), TEST 9, Rule 7.3 (response window), Rule 7.9 (decline reasons and the
// repeat-decline review flag), the closed doors (the apps can no longer write offers or attach themselves to a booking), who may call what,
// and the two LGU-editable settings. Whole migration chain on the local emulator (never Supabase).
const fs = require('fs');
const path = require('path');
const { setup, ID, DRIVERS, attempt, check, summary } = require('../b6fixtures');

const SHARED_CONFIG = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'src', 'config', 'policyConfig.ts'), 'utf8');
// ['a', 'b'] from  export const NAME = ['a', 'b'] as const;
const tsList = (name) => {
  const m = SHARED_CONFIG.match(new RegExp(`export const ${name}\\s*=\\s*\\[([^\\]]*)\\]`));
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
};

(async () => {
  const s = await setup();
  const { q, one, internal, svc, as, asUser } = s;
  const call = async (uid, sql, args = [], role = 'authenticated') =>
    attempt(() => asUser(s.db, { uid, role }, (tx) => tx.query(`SELECT ${sql} AS r`, args), { commit: true }).then((r) => r.rows[0].r));
  const off = async (k) => { await s.goOffline(DRIVERS[k].uid); };
  const allOffline = async () => { for (const k of ['D1', 'D2', 'D3']) if ((await s.status(DRIVERS[k].id)) !== 'Offline') await off(k); };
  const reset = async (b) => { if (b) await s.finish(b.booking_id); await allOffline(); };

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('S1 accept: only the offered driver, only while the offer is open, atomic');
  await s.online('D1', 300); await s.online('D2', 500);
  let b = await s.bookAs('P1');
  let o = (await s.offers(b.booking_id))[0];
  check('a driver who was not offered the booking cannot accept it', (await s.accept('D2', o.attempt_id)).error_code === 'ERR_OFFER_NOT_FOUND');
  const asPax = await call(ID.P_AUTH, 'public.accept_booking_offer($1)', [o.attempt_id]);
  check('a passenger cannot accept (not a driver)', asPax.ok && asPax.value.error_code === 'ERR_NOT_A_DRIVER', asPax);
  const anonAcc = await call(null, 'public.accept_booking_offer($1)', [o.attempt_id], 'anon');
  check('an anonymous caller cannot call it at all', !anonAcc.ok && /permission denied/i.test(anonAcc.error), anonAcc);
  check('nothing changed after the refusals', (await s.booking(b.booking_id)).driver_id === null && (await s.pendingOffer(b.booking_id))?.attempt_id === o.attempt_id);
  const a1 = await s.accept('D1', o.attempt_id);
  const a2 = await s.accept('D1', o.attempt_id);
  check('accepting twice (a double tap) is harmless', a1.success === true && a2.success === true && a2.already_accepted === true, { a1, a2 });
  check('the offer is marked Accepted with the server time (an answer)', (await s.offers(b.booking_id))[0].response_status === 'Accepted' && (await s.offers(b.booking_id))[0].responded_at !== null);
  await reset(b);

  console.log('   an offer that ran out cannot be accepted, and the search has already moved on');
  await s.online('D1', 300); await s.online('D2', 500);
  b = await s.bookAs('P1');
  o = (await s.offers(b.booking_id))[0];
  await s.rewind(b.booking_id, 21);                                    // the hard expiry has passed; nobody has swept yet
  const late = await s.accept('D1', o.attempt_id);
  check('accepting after the offer expired is refused', late.success === false && late.error_code === 'ERR_OFFER_EXPIRED', late);
  const after = await s.offers(b.booking_id);
  check('the late attempt closed the offer as unanswered and the next driver (D2) was offered at once',
    after[0].response_status === 'Expired' && after[0].unanswered === true && after[1]?.driver_id === ID.D2 && after[1].response_status === 'Pending', after);
  check('the booking stays unassigned', (await s.booking(b.booking_id)).driver_id === null);
  await reset(b);

  console.log('   cancelled, taken, offline, suspended: each refused cleanly and nothing is changed');
  await s.online('D1', 300);
  b = await s.bookAs('P1');
  o = (await s.offers(b.booking_id))[0];
  await s.cancelAs(ID.P_AUTH, b.booking_id);
  const gone = await s.accept('D1', o.attempt_id);
  check('the passenger cancelled while the offer was open: "no longer available"', gone.success === false && gone.error_code === 'ERR_BOOKING_UNAVAILABLE', gone);
  await allOffline();

  await s.online('D1', 300);
  b = await s.bookAs('P1');
  o = (await s.offers(b.booking_id))[0];
  await off('D1');
  const offl = await s.accept('D1', o.attempt_id);
  check('a driver who is Offline cannot accept', offl.success === false && offl.error_code === 'ERR_NOT_ONLINE', offl);
  await reset(b);

  await s.online('D1', 300);
  b = await s.bookAs('P1');
  o = (await s.offers(b.booking_id))[0];
  await internal(`UPDATE driver SET suspended_until = now() + interval '2 days', suspension_kind = 'ADMIN', account_status = 'Suspended' WHERE driver_id = '${ID.D1}'`);
  const susp = await s.accept('D1', o.attempt_id);
  check('a driver suspended after the offer was made cannot accept, and the guard says why', susp.success === false && susp.error_code === 'ERR_ACCOUNT_SUSPENDED', susp);
  check('and the booking is untouched', (await s.booking(b.booking_id)).driver_id === null && (await s.booking(b.booking_id)).booking_status === 'Pending');
  await internal(`UPDATE driver SET suspended_until = NULL, suspension_kind = NULL, account_status = 'Verified' WHERE driver_id = '${ID.D1}'`);
  await reset(b);

  console.log('   a driver who became busy after the offer was made cannot take a second booking');
  await s.online('D1', 100);
  b = await s.bookAs('P1');
  const heldOffer = await s.pendingOffer(b.booking_id);
  const other = await s.bookAs('P2');
  await internal(`UPDATE booking SET driver_id = '${ID.D1}', booking_status = 'Accepted' WHERE booking_id = '${other.booking_id}'`);   // D1 is now on P2's trip, still holding P1's offer
  const busy = await s.accept('D1', heldOffer.attempt_id);
  check('refused with the guard message', busy.success === false && /ERR_DRIVER_HAS_OPEN_BOOKING|ERR_DRIVER_BUSY/.test(`${busy.error_code} ${busy.error}`), busy);
  check('the booking still has no driver and D1 still carries only the first trip', (await s.booking(b.booking_id)).driver_id === null
    && (await q(`SELECT 1 FROM booking WHERE driver_id='${ID.D1}' AND booking_status='Accepted'`)).length === 1);
  const forced = await attempt(() => internal(`INSERT INTO dispatch_attempt (booking_id, driver_id, dispatch_method, response_status, cycle, tier, expires_at)
                  VALUES ('${b.booking_id}', '${ID.D1}', 'forced', 'Pending', 1, 1, now() + interval '20 seconds')`));
  check('and even a forced second offer to a driver on a trip is refused by the database', !forced.ok && /ERR_DRIVER_BUSY/.test(forced.error), forced);
  await s.finish(other.booking_id); await reset(b);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS2 TEST 9: concurrent acceptance - only ONE driver is ever assigned');
  await s.online('D1', 300); await s.online('D2', 500);
  b = await s.bookAs('P1');
  const d1Offer = (await s.offers(b.booking_id))[0];
  // Simulate the race the specification worries about: a second offer for the same booking reached D2 as well (a duplicate event, a
  // realtime replay). The engine never does this on its own; the database must still hold.
  await internal(`INSERT INTO dispatch_attempt (booking_id, driver_id, dispatch_method, response_status, cycle, tier, expires_at)
                  VALUES ('${b.booking_id}', '${ID.D2}', 'forced duplicate', 'Pending', 1, 1, now() + interval '20 seconds')`);
  const d2Offer = (await q(`SELECT attempt_id FROM dispatch_attempt WHERE booking_id='${b.booking_id}' AND driver_id='${ID.D2}'`))[0];
  const win = await s.accept('D1', d1Offer.attempt_id);
  const lose = await s.accept('D2', d2Offer.attempt_id);
  b = await s.booking(b.booking_id);
  check('the first accept wins', win.success === true && b.driver_id === ID.D1 && b.booking_status === 'Accepted', { win, b });
  check('the second gets a clean rejection: already taken', lose.success === false && lose.error_code === 'ERR_BOOKING_UNAVAILABLE', lose);
  check('the booking has exactly one driver and the loser\'s offer was withdrawn (not counted as ignored)',
    (await q(`SELECT 1 FROM dispatch_attempt WHERE booking_id='${b.booking_id}' AND response_status='Accepted'`)).length === 1
    && (await one(`SELECT response_status, unanswered FROM dispatch_attempt WHERE attempt_id='${d2Offer.attempt_id}'`)).response_status === 'Expired');
  const fn = await one(`SELECT pg_get_functiondef('public.accept_booking_offer(uuid)'::regprocedure) AS def`);
  check('the decision is made under the booking\'s row lock (two transactions at once are serialized by the database, not the app)', /FOR UPDATE/.test(fn.def) && /SELECT \* INTO v_b FROM public.booking WHERE booking_id = v_booking_id FOR UPDATE/.test(fn.def));
  await reset(b);

  console.log('   a driver cannot attach himself to a booking, or write the search, by any other route');
  await s.online('D1', 300);
  b = await s.bookAs('P1');
  const self = await attempt(() => as(DRIVERS.D1.uid, (tx) => tx.query(`UPDATE booking SET driver_id=$2, booking_status='Accepted' WHERE booking_id=$1 RETURNING booking_id`, [b.booking_id, ID.D1])));
  check('a plain UPDATE that puts the driver on the booking changes nothing (the driver cannot even write a booking he is not on)', self.ok && self.value.rows.length === 0, self);
  const selfOnOwn = await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`UPDATE booking SET driver_id=$2 WHERE booking_id=$1`, [b.booking_id, ID.D1])));
  check('the passenger cannot assign a driver either', !selfOnOwn.ok && /ERR_BOOKING_DRIVER_LOCKED/.test(selfOnOwn.error), selfOnOwn);
  for (const [label, set] of [['move the search to Tier 3', 'dispatch_tier = 3'], ['push the next action far away', `dispatch_next_action_at = now() + interval '1 day'`],
                              ['choose the Priority TODA', `priority_toda_id = '${ID.TODA2}'`], ['change the cycle', 'dispatch_cycle = 9'],
                              ['change the accepted-driver cancellation count', 'accepted_driver_cancel_count = 2'], ['rewrite the acceptance time', `accepted_at = now()`]]) {
    const r = await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`UPDATE booking SET ${set} WHERE booking_id=$1`, [b.booking_id])));
    check(`the passenger cannot ${label}`, !r.ok && /ERR_DISPATCH_LOCKED|ERR_BOOKING_TIMES_LOCKED/.test(r.error), r);
  }
  await reset(b);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS3 the doors are closed: the apps cannot write offers, and a passenger cannot see who was offered what');
  await s.online('D1', 300);
  b = await s.bookAs('P1');
  o = (await s.offers(b.booking_id))[0];
  const ins = await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`INSERT INTO dispatch_attempt (booking_id, driver_id, dispatch_method, response_status) VALUES ($1,$2,'x','Pending')`, [b.booking_id, ID.D2])));
  check('a passenger cannot insert an offer', !ins.ok && /permission denied/i.test(ins.error), ins);
  const upd = await attempt(() => as(DRIVERS.D1.uid, (tx) => tx.query(`UPDATE dispatch_attempt SET response_status='Accepted' WHERE attempt_id=$1`, [o.attempt_id])));
  check('a driver cannot answer an offer by writing it', !upd.ok && /permission denied/i.test(upd.error), upd);
  const updP = await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`UPDATE dispatch_attempt SET response_status='Declined' WHERE attempt_id=$1`, [o.attempt_id])));
  check('and a passenger cannot mark an offer unanswered', !updP.ok && /permission denied/i.test(updP.error), updP);
  const seeP = await as(ID.P_AUTH, (tx) => tx.query(`SELECT 1 FROM dispatch_attempt WHERE booking_id=$1`, [b.booking_id]));
  check('a passenger cannot read the offers of their own booking (which drivers were asked, and when)', seeP.rows.length === 0, seeP.rows.length);
  const seeD = await as(DRIVERS.D1.uid, (tx) => tx.query(`SELECT 1 FROM dispatch_attempt WHERE attempt_id=$1`, [o.attempt_id]));
  const seeD2 = await as(DRIVERS.D2.uid, (tx) => tx.query(`SELECT 1 FROM dispatch_attempt WHERE attempt_id=$1`, [o.attempt_id]));
  check('a driver reads his own offer and nobody else\'s', seeD.rows.length === 1 && seeD2.rows.length === 0);
  const seeL = await as(ID.L_AUTH, (tx) => tx.query(`SELECT 1 FROM dispatch_attempt WHERE booking_id=$1`, [b.booking_id]));
  check('the LGU administrator can read them (audit)', seeL.rows.length === 1);
  await reset(b);

  console.log('   who may call what');
  const internalNames = ['dispatch_eligible_drivers(uuid, integer)', '_dispatch_advance(uuid)', '_dispatch_redispatch(uuid, uuid, text, text, text)', '_dispatch_offer_next(uuid, smallint, uuid, integer)'];
  for (const sig of internalNames) {
    const r = await call(ID.D_AUTH, `public.${sig.split('(')[0]}(${sig.includes('dispatch_eligible') ? "'" + ID.P1 + "'::uuid, 5000" : sig.startsWith('_dispatch_advance') ? "'" + ID.P1 + "'::uuid" : sig.startsWith('_dispatch_redispatch') ? `'${ID.P1}'::uuid, '${ID.D1}'::uuid, 'driver', 'x'` : `'${ID.P1}'::uuid, 1::smallint, NULL::uuid, 100`})`);
    check(`a signed-in driver cannot call ${sig.split('(')[0]}`, !r.ok && /permission denied/i.test(r.error), r);
  }
  for (const [name, args] of [['public.get_my_pending_offer()', []], ['public.dispatch_sweep()', []], ['public.get_dispatch_status($1)', [ID.P1]],
                              ['public.retry_driver_search($1)', [ID.P1]], ['public.decline_booking_offer($1, $2)', [ID.P1, 'other']],
                              ['public.driver_cancel_booking($1, $2, $3)', [ID.P1, 'other', null]], ['public.get_dispatch_settings()', []],
                              ['public.set_dispatch_setting($1, $2)', ['offer_window_seconds', 15]]]) {
    const r = await call(null, name, args, 'anon');
    check(`an anonymous caller cannot call ${name.split('(')[0]}`, !r.ok && /permission denied/i.test(r.error), r);
  }
  const statusOther = await s.statusOf('P2', (await s.bookAs('P1')).booking_id);
  check('a passenger cannot read another passenger\'s search', statusOther.success === false && statusOther.error_code === 'ERR_NOT_YOUR_BOOKING', statusOther);
  await s.finish((await q(`SELECT booking_id FROM booking WHERE passenger_id='${ID.P1}' AND booking_status = 'Pending'`))[0].booking_id);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS4 Rule 7.9: the decline reasons, and a pattern of refusals is flagged for the TODA administrator (a flag, never a strike)');
  const reasons = tsList('DISPATCH_DECLINE_REASONS');
  check('the app\'s list of decline reasons equals the five of the policy', reasons.join() === 'vehicle_issue,personal_emergency,safety_concern,end_of_shift,other', reasons);
  await s.online('D1', 300);
  for (let i = 0; i < reasons.length; i++) {
    const x = await s.bookAs('P1');
    const off1 = await s.pendingOffer(x.booking_id);
    const r = await s.decline('D1', off1.attempt_id, reasons[i]);
    check(`reason "${reasons[i]}" is accepted`, r.success === true, r);
    await s.finish(x.booking_id);
    if (i < reasons.length - 1) check('no flag yet', (await q(`SELECT 1 FROM admin_review_flag WHERE flag_type='DRIVER_REPEATED_DECLINES'`)).length === 0);
  }
  const flag = await q(`SELECT subject_id, assigned_role, status, source_rule FROM admin_review_flag WHERE flag_type='DRIVER_REPEATED_DECLINES'`);
  check('five explicit declines in a day raise one open review flag for the driver\'s TODA administrator', flag.length === 1 && flag[0].subject_id === ID.D1 && flag[0].assigned_role === 'toda_admin' && flag[0].status === 'Open' && flag[0].source_rule === 'Rule 7.9', flag);
  check('and no strike is issued', (await s.strikes(ID.D1)).length === 0);
  const tflag = await as(ID.T_AUTH, (tx) => tx.query(`SELECT 1 FROM admin_review_flag WHERE flag_type='DRIVER_REPEATED_DECLINES'`));
  check('the TODA administrator of that driver can see it', tflag.rows.length === 1);
  await allOffline();

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nS5 the two settings an LGU administrator may change (Batch 6 prompt B4)');
  const read = await call(ID.L_AUTH, 'public.get_dispatch_settings()');
  check('the LGU administrator reads the effective values, the defaults and the limits',
    read.ok && read.value.offer_window_seconds === 15 && read.value.tier3_max_seconds === 300 && read.value.defaults.tier3_max_seconds === 300, read);
  for (const [who, uid] of [['a passenger', ID.P_AUTH], ['a driver', ID.D_AUTH], ['a TODA administrator', ID.T_AUTH]]) {
    const r = await call(uid, `public.set_dispatch_setting('offer_window_seconds', 30)`);
    check(`${who} cannot change a setting`, !r.ok && /Access Denied/i.test(r.error), r);
    const g = await call(uid, 'public.get_dispatch_settings()');
    check(`${who} cannot read them either`, !g.ok && /Access Denied/i.test(g.error), g);
  }
  const direct = await attempt(() => as(ID.L_AUTH, (tx) => tx.query(`UPDATE dispatch_setting SET setting_value = 5`)));
  check('not even the LGU administrator can write the table directly', !direct.ok && /permission denied/i.test(direct.error), direct);
  check('out-of-range values are refused', (await call(ID.L_AUTH, `public.set_dispatch_setting('offer_window_seconds', 5)`)).value.error_code === 'ERR_OUT_OF_RANGE'
    && (await call(ID.L_AUTH, `public.set_dispatch_setting('tier3_max_seconds', 30)`)).value.error_code === 'ERR_OUT_OF_RANGE'
    && (await call(ID.L_AUTH, `public.set_dispatch_setting('tier3_max_seconds', 2000)`)).value.error_code === 'ERR_OUT_OF_RANGE'
    && (await call(ID.L_AUTH, `public.set_dispatch_setting('nonsense', 20)`)).value.error_code === 'ERR_UNKNOWN_SETTING');
  const set1 = await call(ID.L_AUTH, `public.set_dispatch_setting('offer_window_seconds', 30)`);
  const set2 = await call(ID.L_AUTH, `public.set_dispatch_setting('tier3_max_seconds', 600)`);
  check('the LGU administrator changes both', set1.value.success && set1.value.previous === 15 && set2.value.success && set2.value.previous === 300, { set1, set2 });
  check('and each change is in the audit log with before and after',
    (await q(`SELECT 1 FROM audit_log WHERE action_type='DISPATCH_SETTING_CHANGED' AND target_id IN ('offer_window_seconds','tier3_max_seconds')`)).length === 2);
  await s.online('D1', 300);
  b = await s.bookAs('P1');
  o = (await s.offers(b.booking_id))[0];
  check('a new offer now lasts the new window plus the grace (30 s + 5 s)', Math.abs((new Date(o.expires_at) - new Date(o.notification_sent_at)) / 1000 - 35) < 0.5, o);
  check('and the driver is shown the new window', (await s.myOffer('D1')).window_seconds === 30 && (await s.myOffer('D1')).seconds_remaining === 30);
  await reset(b);
  const r600 = await one(`SELECT public.dispatch_tier3_radius_m(299) a, public.dispatch_tier3_radius_m(599) b, public.dispatch_tier3_radius_m(600) c`);
  check('the live search now runs 10 minutes: still 3.5 km at 4:59 and 9:59, over at 10:00', r600.a === 3500 && r600.b === 3500 && r600.c === null, r600);
  await call(ID.L_AUTH, `public.set_dispatch_setting('offer_window_seconds', 15)`);
  await call(ID.L_AUTH, `public.set_dispatch_setting('tier3_max_seconds', 300)`);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
