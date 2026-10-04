// Perimeter Lockdown S1 (20261008000002): the new RPCs, the policy helpers and the guards. Whole migration chain, local emulator only.
// Every assertion here holds both on the S1-only database and on the fully locked-down chain (S2-S4), so this suite keeps proving the
// behaviour after the doors are shut.
const { setup, ID, attempt, check, summary, asUser } = require('../b5fixtures');
const { AFF } = require('../b4fixtures');

(async () => {
  const t = await setup();
  const { db, as, svc, q, one, book, assign, setStatus, PICKUP, internal, offer } = t;
  const asRole = (role, fn) => asUser(db, { uid: null, role }, fn, { commit: true });
  const rpc = (uid, sql, args = []) => as(uid, (tx) => tx.query(sql, args));
  const err = (r) => (r.ok ? null : String(r.error).slice(0, 140));
  // a refused write: an error, or a statement that touched no row
  const refused = (r) => !r.ok || (r.value && r.value.rowCount === 0);

  // ---- world: P1/P2 passengers; D1 and D2 (both TODA1, both verified) are Available: D1 ~0.1 km from the pickup, D2 ~2 km away.
  //      TODA1 is accredited (Active), TODA2 is still Pending.
  await internal(`UPDATE toda SET toda_status='Active', account_status='Active' WHERE toda_id = '${ID.TODA1}';
                  UPDATE toda SET toda_status='Pending Verification', account_status='Pending Verification' WHERE toda_id = '${ID.TODA2}'`);
  await t.rpc(ID.D2_AUTH, 'select_active_driver_affiliation', [AFF.D2_T1]);      // D2 has two affiliations: pick TODA1
  const on1 = await t.goOnline(ID.D_AUTH, PICKUP.lat + 0.001, PICKUP.lng);
  const on2 = await t.goOnline(ID.D2_AUTH, PICKUP.lat + 0.018, PICKUP.lng);
  check('set-up: D1 and D2 went Available through driver_go_online',
    (await q(`SELECT driver_id FROM public.driver WHERE availability_status = 'Available' ORDER BY driver_id`)).map((r) => r.driver_id).join() === [ID.D1, ID.D2].join(), { on1, on2 });
  const B1 = await book(ID.P_AUTH, ID.P1);                         // P1's open booking
  const B2 = await book(ID.P2_AUTH, ID.P2, { km: 4 });             // P2's open booking

  console.log('\nS1-1 policy helpers');
  const h = async (uid, fn, id) => (await rpc(uid, `SELECT public.${fn}($1::uuid) AS r`, [id])).rows[0].r;
  check('rls_booking_is_mine: true for the owner, false for another passenger and for a driver',
    (await h(ID.P_AUTH, 'rls_booking_is_mine', B1.booking_id)) === true && (await h(ID.P2_AUTH, 'rls_booking_is_mine', B1.booking_id)) === false
    && (await h(ID.D_AUTH, 'rls_booking_is_mine', B1.booking_id)) === false);
  check('rls_booking_open_and_mine: true while Pending', (await h(ID.P_AUTH, 'rls_booking_open_and_mine', B1.booking_id)) === true);
  await offer(B1.booking_id, ID.D1);
  check('rls_driver_has_pending_offer: only the driver who was offered it', (await h(ID.D_AUTH, 'rls_driver_has_pending_offer', B1.booking_id)) === true
    && (await h(ID.D2_AUTH, 'rls_driver_has_pending_offer', B1.booking_id)) === false);
  check('rls_driver_can_claim_booking: the offered driver can, another driver cannot', (await h(ID.D_AUTH, 'rls_driver_can_claim_booking', B1.booking_id)) === true
    && (await h(ID.D2_AUTH, 'rls_driver_can_claim_booking', B1.booking_id)) === false);
  const helperAnon = await attempt(() => asRole('anon', (tx) => tx.query(`SELECT public.rls_booking_is_mine('${B1.booking_id}') r`)));
  check('the helpers are not callable by anon', !helperAnon.ok && /permission denied/.test(helperAnon.error), err(helperAnon));

  console.log('\nS1-2 list_accredited_todas (the one function the public may call)');
  const dir = await asRole('anon', (tx) => tx.query(`SELECT * FROM public.list_accredited_todas()`));
  check('anon sees only Active TODAs', dir.rows.length === 1 && dir.rows[0].toda_id === ID.TODA1, dir.rows.map((r) => r.toda_id));
  check('...and only directory columns (no documents, certificate data, officers, contacts)',
    JSON.stringify(Object.keys(dir.rows[0]).sort()) === JSON.stringify(['barangay', 'service_coverage_area', 'terminal_latitude', 'terminal_longitude', 'toda_acronym', 'toda_id', 'toda_name']), Object.keys(dir.rows[0]));

  console.log('\nS1-3 find_candidate_drivers');
  const cands = (uid, id, extra = '') => rpc(uid, `SELECT * FROM public.find_candidate_drivers($1::uuid${extra})`, [id]);
  const cp = await cands(ID.P2_AUTH, B2.booking_id);                // B2 has no offers yet: both drivers qualify
  check('the passenger gets only driver id, TODA and distance', JSON.stringify(Object.keys(cp.rows[0] || {}).sort()) === JSON.stringify(['distance_km', 'driver_id', 'toda_id']), Object.keys(cp.rows[0] || {}));
  check('candidates come nearest first', cp.rows.map((r) => r.driver_id).join() === [ID.D1, ID.D2].join(), cp.rows);
  check('distances are measured from the booking pickup and rounded to 0.1 km', cp.rows.every((r) => Math.abs(r.distance_km * 10 - Math.round(r.distance_km * 10)) < 1e-6) && cp.rows[0].distance_km < 0.5 && cp.rows[1].distance_km > 1.5 && cp.rows[1].distance_km < 2.5, cp.rows);
  const cpB1 = await cands(ID.P_AUTH, B1.booking_id);               // D1 already holds an offer for B1
  check('a driver who already holds an offer for this booking is left out', cpB1.rows.map((r) => r.driver_id).join() === [ID.D2].join(), cpB1.rows);
  const cmax1 = await cands(ID.P_AUTH, B1.booking_id, ', 1');
  const cmax3 = await cands(ID.P_AUTH, B1.booking_id, ', 3');
  check('p_max_km limits the radius', cmax1.rows.length === 0 && cmax3.rows.map((r) => r.driver_id).join() === [ID.D2].join(), { cmax1: cmax1.rows, cmax3: cmax3.rows });
  const notMine = await attempt(() => cands(ID.P2_AUTH, B1.booking_id));
  check('asking about somebody else\'s booking is refused', !notMine.ok && /ERR_NOT_YOUR_BOOKING/.test(notMine.error), err(notMine));
  const asDriver = await attempt(() => cands(ID.D_AUTH, B1.booking_id));
  check('a driver cannot use it', !asDriver.ok && /ERR_NOT_A_PASSENGER/.test(asDriver.error), err(asDriver));
  const asAnon = await attempt(() => asRole('anon', (tx) => tx.query(`SELECT * FROM public.find_candidate_drivers('${B1.booking_id}')`)));
  check('anon cannot use it', !asAnon.ok && /permission denied/.test(asAnon.error), err(asAnon));
  await assign(B2.booking_id, ID.D1);
  const closed = await cands(ID.P2_AUTH, B2.booking_id);
  check('once the booking is no longer open it answers with nothing', closed.rows.length === 0, closed.rows);

  console.log('\nS1-4 get_booking_counterparties');
  const cpt = async (uid, ids) => (await rpc(uid, `SELECT * FROM public.get_booking_counterparties($1::uuid[])`, [ids])).rows;
  const row = (rows, id) => rows.find((r) => r.booking_id === id);
  // B2 is accepted by D1 (live); B1 only has a pending offer for D1
  const asPax = row(await cpt(ID.P2_AUTH, [B2.booking_id]), B2.booking_id);
  check('the passenger of a live trip sees the driver\'s name, TODA and phone',
    asPax && asPax.driver_name === 'Driver One' && asPax.driver_phone === '+639180000001' && asPax.toda_name === 'Toda One', asPax);
  const asDrv = row(await cpt(ID.D_AUTH, [B2.booking_id]), B2.booking_id);
  check('the driver of a live trip sees the passenger\'s name and phone', asDrv && asDrv.passenger_name === 'Pax Two' && asDrv.passenger_phone === '+639170000002', asDrv);
  const offerOnly = row(await cpt(ID.D_AUTH, [B1.booking_id]), B1.booking_id);
  check('a driver holding only an offer sees the passenger\'s name but NOT the phone, and no driver data', offerOnly && offerOnly.passenger_name === 'Pax One' && offerOnly.passenger_phone === null && offerOnly.driver_id === null, offerOnly);
  check('a driver with no offer and no trip gets nothing', (await cpt(ID.D2_AUTH, [B1.booking_id, B2.booking_id])).length === 0);
  check('another passenger gets nothing about a booking that is not theirs', (await cpt(ID.P_AUTH, [B2.booking_id])).length === 0);
  const staff = await cpt(ID.T_AUTH, [B2.booking_id, B1.booking_id]);
  check('the TODA administrator of the driver sees both parties with phones (incident handling)', staff.length === 1 && staff[0].passenger_phone === '+639170000002' && staff[0].driver_phone === '+639180000001', staff);
  check('a TODA administrator of another TODA gets nothing', (await cpt(ID.T2_AUTH, [B2.booking_id])).length === 0);
  check('the LGU administrator sees everything', (await cpt(ID.L_AUTH, [B1.booking_id, B2.booking_id])).length === 2);
  await svc((tx) => tx.query(`UPDATE public.booking SET booking_status = 'Completed' WHERE booking_id = '${B2.booking_id}'`));
  const done = row(await cpt(ID.P2_AUTH, [B2.booking_id]), B2.booking_id);
  const doneDrv = row(await cpt(ID.D_AUTH, [B2.booking_id]), B2.booking_id);
  check('after the trip the names stay but the phones are no longer shared', done.driver_name === 'Driver One' && done.driver_phone === null && doneDrv.passenger_name === 'Pax Two' && doneDrv.passenger_phone === null, { done, doneDrv });
  const many = await attempt(() => cpt(ID.L_AUTH, Array.from({ length: 201 }, () => B1.booking_id)));
  check('more than 200 ids is refused', !many.ok && /ERR_TOO_MANY_BOOKINGS/.test(many.error), err(many));

  console.log('\nS1-5 get_assigned_driver_details');
  await svc((tx) => tx.query(`UPDATE public.booking SET driver_id = '${ID.D1}', booking_status = 'Accepted' WHERE booking_id = '${B1.booking_id}'`));
  await internal(`UPDATE driver SET current_latitude = ${PICKUP.lat + 0.002}, current_longitude = ${PICKUP.lng + 0.001}, last_location_update = now() WHERE driver_id = '${ID.D1}'`);
  const add = (uid, id) => rpc(uid, `SELECT * FROM public.get_assigned_driver_details($1::uuid)`, [id]);
  const live = (await add(ID.P_AUTH, B1.booking_id)).rows[0];
  check('the passenger of a live trip gets the driver\'s details and live position',
    live && live.full_name === 'Driver One' && live.toda_name === 'Toda One' && Number(live.current_latitude) > 0 && live.last_location_update !== null, live);
  check('another passenger gets an empty answer (not an error that reveals the booking exists)', (await add(ID.P2_AUTH, B1.booking_id)).rows.length === 0);
  check('a driver who is not on the booking gets an empty answer', (await add(ID.D2_AUTH, B1.booking_id)).rows.length === 0);
  check('the assigned driver does not use this function either (they have the passenger side)', (await add(ID.D_AUTH, B1.booking_id)).rows.length === 0);
  check('the TODA administrator of the driver and the LGU administrator can read it', (await add(ID.T_AUTH, B1.booking_id)).rows.length === 1 && (await add(ID.L_AUTH, B1.booking_id)).rows.length === 1);
  const addAnon = await attempt(() => asRole('anon', (tx) => tx.query(`SELECT * FROM public.get_assigned_driver_details('${B1.booking_id}')`)));
  check('anon cannot call it (it used to hand the live coordinates to anybody with a booking id)', !addAnon.ok && /permission denied/.test(addAnon.error), err(addAnon));
  await svc((tx) => tx.query(`UPDATE public.booking SET booking_status = 'Completed' WHERE booking_id = '${B1.booking_id}'`));
  const after = (await add(ID.P_AUTH, B1.booking_id)).rows[0];
  check('after the trip the position is no longer shared (name and vehicle stay)', after.full_name === 'Driver One' && after.current_latitude === null && after.current_longitude === null && after.last_location_update === null, after);

  console.log('\nS1-5b get_my_toda_affiliations (the driver\'s affiliation picker: the toda table itself is closed to drivers)');
  const mine = (uid) => rpc(uid, `SELECT * FROM public.get_my_toda_affiliations()`);
  const mineD2 = (await mine(ID.D2_AUTH)).rows;
  const d2t1 = mineD2.find((r) => r.affiliation_id === AFF.D2_T1);
  const d2t2 = mineD2.find((r) => r.affiliation_id === AFF.D2_T2);
  check('a driver gets their OWN affiliations (two for D2), each with the TODA\'s name, acronym and status',
    mineD2.length === 2 && d2t1 && d2t2 && d2t1.toda_name === 'Toda One' && d2t1.toda_status === 'Active' && d2t1.toda_endorsement_status === 'Endorsed'
    && d2t1.lgu_verification_status === 'Approved' && d2t1.is_active_selection === true && d2t2.toda_status === 'Pending Verification' && d2t2.is_active_selection === false, mineD2);
  check('...with the accreditation expiry and coverage fields the picker needs, and nothing else about the TODA',
    JSON.stringify(Object.keys(mineD2[0]).sort()) === JSON.stringify(['affiliation_id', 'barangay', 'certificate_expiry', 'is_active_selection', 'lgu_verification_status', 'service_coverage_area', 'submitted_at',
      'toda_acronym', 'toda_endorsement_status', 'toda_id', 'toda_name', 'toda_status']), Object.keys(mineD2[0]));
  const mineD1 = (await mine(ID.D_AUTH)).rows;
  check('another driver sees only their own affiliation (never D2\'s)', mineD1.length === 1 && mineD1[0].affiliation_id === AFF.D1_T1, mineD1);
  const mineD3 = (await mine(ID.D3_AUTH)).rows;
  check('an applicant sees their pending affiliation with its review status', mineD3.length === 1 && mineD3[0].affiliation_id === AFF.D3_T2 && mineD3[0].toda_endorsement_status === 'Submitted' && mineD3[0].lgu_verification_status === 'Pending', mineD3);
  check('a passenger and a TODA administrator (no driver record) get nothing', (await mine(ID.P_AUTH)).rows.length === 0 && (await mine(ID.T_AUTH)).rows.length === 0);
  const mineAnon = await attempt(() => asRole('anon', (tx) => tx.query(`SELECT * FROM public.get_my_toda_affiliations()`)));
  check('anon cannot call it', !mineAnon.ok && /permission denied/.test(mineAnon.error), err(mineAnon));

  console.log('\nS1-6 register_toda_with_admin');
  const newUid = (await one(`INSERT INTO auth.users (email) VALUES ('registrar@x.test') RETURNING id`)).id;
  const reg = (uid, authId = null, extra = {}) => as(uid, (tx) => tx.query(
    `SELECT public.register_toda_with_admin($1,$2,$3,$4::date,$5::int,$6::int,$7::float8,$8::float8,$9,$10,$11,$12,$13,$14,$15,$16,$17::uuid) AS id`,
    [extra.name ?? 'New TODA', extra.acr ?? 'NEWT', 'REG-1', '2020-01-01', 10, 5, 13.41, 121.18, 'Terminal', 'Brgy X', 'Corridor', 'Pres Ident', extra.email ?? 'new-admin@x.test', '+639171234567', 'path/clearance.pdf', 'path/list.csv', authId]));
  const regOther = await attempt(() => reg(newUid, ID.T_AUTH));
  check('a caller cannot name somebody else as the administrator (p_auth_user_id)', !regOther.ok && /ERR_IDENTITY_MISMATCH/.test(regOther.error), err(regOther));
  const hijack = await attempt(() => reg(ID.T_AUTH));
  check('an existing TODA administrator cannot register another TODA (and is not re-pointed)', !hijack.ok && /ERR_ALREADY_TODA_ADMIN/.test(hijack.error)
    && (await one(`SELECT toda_id FROM public.toda_admin WHERE auth_user_id = '${ID.T_AUTH}'`)).toda_id === ID.TODA1, err(hijack));
  const okReg = await attempt(() => reg(newUid, newUid));
  check('a signed-in new user can register a TODA (own id passed explicitly)', okReg.ok && okReg.value.rows[0].id, err(okReg));
  const regRow = okReg.ok ? await one(`SELECT t.account_status ta, a.account_status aa, a.auth_user_id FROM public.toda t JOIN public.toda_admin a ON a.toda_id = t.toda_id WHERE t.toda_id = '${okReg.value.rows[0].id}'`) : null;
  check('...the TODA is Pending Verification and the caller is its administrator', regRow && regRow.ta === 'Pending Verification' && regRow.aa === 'Active' && regRow.auth_user_id === newUid, regRow);
  const aud = okReg.ok ? await one(`SELECT actor_id, actor_role FROM public.audit_log WHERE action_type = 'TODA_REGISTRATION_SUBMITTED' AND target_id = '${okReg.value.rows[0].id}'`) : null;
  check('...the audit entry carries the caller', aud && aud.actor_id === newUid && aud.actor_role === 'toda_admin', aud);
  const again = await attempt(() => reg(newUid, null, { acr: 'NEWT2', email: 'other@x.test' }));
  check('the same account cannot register a second TODA', !again.ok && /ERR_ALREADY_TODA_ADMIN/.test(again.error), err(again));
  check('the policy-engine flag is not left switched on', (await one(`SELECT current_setting('sakay.internal_context', true) v`)).v !== 'true');
  const regAnon = await attempt(() => asRole('anon', (tx) => tx.query(`SELECT public.register_toda_with_admin('A','B','C','2020-01-01',1,1,1,1,'t','b','s','p','e@x.y','+639',NULL,NULL,NULL)`)));
  check('anon cannot register a TODA', !regAnon.ok && /permission denied/.test(regAnon.error), err(regAnon));

  console.log('\nS1-7 insert guards: a registrant can only create a Pending record');
  const u1 = (await one(`INSERT INTO auth.users (email) VALUES ('g1@x.test') RETURNING id`)).id;
  const pActive = await attempt(() => as(u1, (tx) => tx.query(`INSERT INTO public.passenger (auth_user_id, full_name, contact_number, account_status) VALUES ('${u1}', 'G One', '+639171110001', 'Active')`)));
  check('a new passenger cannot insert themselves Active', !pActive.ok && /ERR_PASSENGER_PENDING_ONLY|row-level security/.test(pActive.error), err(pActive));
  const pPend = await attempt(() => as(u1, (tx) => tx.query(`INSERT INTO public.passenger (auth_user_id, full_name, contact_number, account_status, strikes_count, failed_otp_attempts, otp_daily_count)
                                                           VALUES ('${u1}', 'G One', '+639171110001', 'Pending OTP Verification', 4, 9, 9) RETURNING strikes_count, failed_otp_attempts, otp_daily_count`)));
  check('a Pending passenger insert works and the engine counters are reset to zero', pPend.ok && pPend.value.rows[0].strikes_count === 0 && pPend.value.rows[0].failed_otp_attempts === 0 && pPend.value.rows[0].otp_daily_count === 0, pPend.ok ? pPend.value.rows[0] : err(pPend));
  const u2 = (await one(`INSERT INTO auth.users (email) VALUES ('g2@x.test') RETURNING id`)).id;
  const dVer = await attempt(() => as(u2, (tx) => tx.query(`INSERT INTO public.driver (auth_user_id, full_name, contact_number, account_status) VALUES ('${u2}', 'G Two', '+639181110002', 'Verified')`)));
  check('a new driver cannot insert themselves Verified', !dVer.ok && /ERR_DRIVER_PENDING_ONLY|row-level security/.test(dVer.error), err(dVer));
  const dPend = await attempt(() => as(u2, (tx) => tx.query(`INSERT INTO public.driver (auth_user_id, full_name, contact_number, account_status, availability_status, weighted_average_rating, strikes_count, is_permanently_disqualified, endorsed_at, lgu_approved_at, current_latitude)
                                                           VALUES ('${u2}', 'G Two', '+639181110002', 'Pending Verification', 'Available', 1.0, 3, false, now(), now(), 13.4) RETURNING availability_status, weighted_average_rating, strikes_count, endorsed_at, lgu_approved_at, current_latitude`)));
  check('a Pending driver insert works; availability, rating, strikes, endorsement and position are normalised', dPend.ok && dPend.value.rows[0].availability_status === 'Offline' && Number(dPend.value.rows[0].weighted_average_rating) === 4
    && dPend.value.rows[0].strikes_count === 0 && dPend.value.rows[0].endorsed_at === null && dPend.value.rows[0].lgu_approved_at === null && dPend.value.rows[0].current_latitude === null, dPend.ok ? dPend.value.rows[0] : err(dPend));
  const d2 = (await one(`SELECT driver_id FROM public.driver WHERE auth_user_id = '${u2}'`));
  const vIns = d2 ? await attempt(() => as(u2, (tx) => tx.query(`INSERT INTO public.driver_verification (driver_id, verification_status, endorsed_at, lgu_approved_at, reviewed_by_lgu, rejection_reason)
                                                                VALUES ('${d2.driver_id}', 'Approved', now(), now(), '${ID.L_AUTH}', 'x') RETURNING verification_status, endorsed_at, lgu_approved_at, reviewed_by_lgu, rejection_reason`))) : { ok: false, error: 'no driver' };
  check('a driver\'s own verification insert is forced to Pending with no reviewer, endorsement or approval (self-approval was possible)',
    vIns.ok && vIns.value.rows[0].verification_status === 'Pending' && vIns.value.rows[0].endorsed_at === null && vIns.value.rows[0].lgu_approved_at === null && vIns.value.rows[0].reviewed_by_lgu === null && vIns.value.rows[0].rejection_reason === null, vIns.ok ? vIns.value.rows[0] : err(vIns));
  const vTodaIns = await attempt(() => as(ID.T_AUTH, (tx) => tx.query(`INSERT INTO public.driver_verification (driver_id, verification_status) VALUES ('${ID.D2}', 'Approved') RETURNING verification_status`)));
  check('the TODA administrator of that driver may insert a reviewed verification', vTodaIns.ok && vTodaIns.value.rows[0].verification_status === 'Approved', err(vTodaIns));

  console.log('\nS1-8 driver verification: the owner can save documents but not decide');
  await db.exec(`INSERT INTO public.driver_verification (driver_id) VALUES ('${ID.D3}')`);
  const own = await attempt(() => as(ID.D3_AUTH, (tx) => tx.query(`UPDATE public.driver_verification SET remarks = 'documents re-uploaded', face_photo_path = 'x/selfie.jpg' WHERE driver_id = '${ID.D3}'`)));
  check('the driver can update the document fields of their own row (this failed with "record new has no field" before S1)', own.ok && own.value.rowCount === 1, err(own));
  for (const [what, set] of [['verification_status', `verification_status = 'Approved'`], ['endorsed_at', `endorsed_at = now()`], ['lgu_approved_at', `lgu_approved_at = now()`], ['reviewed_by_lgu', `reviewed_by_lgu = '${ID.L_AUTH}'`]]) {
    const r = await attempt(() => as(ID.D3_AUTH, (tx) => tx.query(`UPDATE public.driver_verification SET ${set} WHERE driver_id = '${ID.D3}'`)));
    check(`the driver cannot change ${what}`, !r.ok && /Drivers cannot modify verification status/.test(r.error), err(r));
  }
  const toda3 = await attempt(() => as(ID.T2_AUTH, (tx) => tx.query(`UPDATE public.driver_verification SET verification_status = 'Approved' WHERE driver_id = '${ID.D3}'`)));
  check('the TODA administrator of the driver can decide', toda3.ok && toda3.value.rowCount === 1, err(toda3));

  console.log('\nS1-9 booking guard');
  const nb = await attempt(() => book(ID.P_AUTH, ID.P1, { extra: { accepted_at: new Date().toISOString(), cancelled_by: 'driver', cancellation_reason: 'x' } }));
  check('a new booking starts clean: accepted / cancelled fields supplied by the client are dropped', nb.ok && nb.value.accepted_at === null && nb.value.cancelled_by === null && nb.value.cancellation_reason === null, nb.ok ? nb.value : err(nb));
  const NB = nb.ok ? nb.value : B1;
  await assign(NB.booking_id, ID.D1);
  const swapPax = await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`UPDATE public.booking SET passenger_id = '${ID.P2}' WHERE booking_id = '${NB.booking_id}'`)));
  check('the passenger of a booking cannot be changed', refused(swapPax) && (swapPax.ok || /ERR_BOOKING_OWNER_LOCKED/.test(swapPax.error)), err(swapPax));
  const swapDrv = await attempt(() => as(ID.D_AUTH, (tx) => tx.query(`UPDATE public.booking SET driver_id = '${ID.D2}' WHERE booking_id = '${NB.booking_id}'`)));
  check('an assigned driver cannot hand the booking to another driver', refused(swapDrv), err(swapDrv));
  const swapToda = await attempt(() => as(ID.P_AUTH, (tx) => tx.query(`UPDATE public.booking SET toda_id = '${ID.TODA2}' WHERE booking_id = '${NB.booking_id}'`)));
  check('the TODA of a booking cannot be changed by the people on it', refused(swapToda), err(swapToda));
  const stat = await attempt(() => setStatus(ID.D_AUTH, NB.booking_id, 'Arrived at Pickup'));
  check('the assigned driver can still move their own booking along', stat.ok && stat.value && stat.value.booking_status === 'Arrived at Pickup', err(stat));

  console.log('\nS1-10 administrators cannot move or reinstate themselves');
  for (const [label, sql] of [['re-point their own TODA', `UPDATE public.toda_admin SET toda_id = '${ID.TODA2}' WHERE auth_user_id = '${ID.T_AUTH}'`],
                              ['change their own status', `UPDATE public.toda_admin SET account_status = 'Suspended' WHERE auth_user_id = '${ID.T_AUTH}'`],
                              ['change their own login', `UPDATE public.toda_admin SET auth_user_id = '${ID.P_AUTH}' WHERE auth_user_id = '${ID.T_AUTH}'`]]) {
    const r = await attempt(() => as(ID.T_AUTH, (tx) => tx.query(sql)));
    check(`a TODA administrator cannot ${label}`, !r.ok && /cannot change their own account, TODA or status/.test(r.error), err(r));
  }
  const nm = await attempt(() => as(ID.T_AUTH, (tx) => tx.query(`UPDATE public.toda_admin SET full_name = 'Renamed Admin' WHERE auth_user_id = '${ID.T_AUTH}'`)));
  check('...but can edit their own name', nm.ok && nm.value.rowCount === 1, err(nm));
  const lgu = await attempt(() => as(ID.L_AUTH, (tx) => tx.query(`UPDATE public.toda_admin SET account_status = 'Suspended' WHERE auth_user_id = '${ID.T2_AUTH}' RETURNING account_status`)));
  check('the LGU administrator can still suspend a TODA administrator', lgu.ok && lgu.value.rowCount === 1, err(lgu));
  const self = await attempt(() => as(ID.L_AUTH, (tx) => tx.query(`UPDATE public.lgu_admin SET account_status = 'Suspended' WHERE auth_user_id = '${ID.L_AUTH}'`)));
  check('an LGU administrator cannot change the status of their own account', !self.ok && /cannot change the status of their own account/.test(self.error), err(self));
  const lname = await attempt(() => as(ID.L_AUTH, (tx) => tx.query(`UPDATE public.lgu_admin SET full_name = 'LGU Renamed' WHERE auth_user_id = '${ID.L_AUTH}'`)));
  check('...but can edit their own name', lname.ok && lname.value.rowCount === 1, err(lname));
  await internal(`UPDATE toda SET toda_status='Pending Verification', account_status='Pending Verification' WHERE toda_id = '${ID.TODA1}'`);
  const accr = await attempt(() => as(ID.T_AUTH, (tx) => tx.query(`UPDATE public.toda SET account_status = 'Active' WHERE toda_id = '${ID.TODA1}'`)));
  check('a TODA administrator cannot mark their own TODA accredited (account_status)', !accr.ok && /can only be modified by LGU Administrators/.test(accr.error), err(accr));
  const prof = await attempt(() => as(ID.T_AUTH, (tx) => tx.query(`UPDATE public.toda SET president_name = 'New President' WHERE toda_id = '${ID.TODA1}'`)));
  check('...but can edit the profile of their TODA', prof.ok && prof.value.rowCount === 1, err(prof));
  const accrLgu = await attempt(() => as(ID.L_AUTH, (tx) => tx.query(`UPDATE public.toda SET account_status = 'Active', toda_status = 'Active' WHERE toda_id = '${ID.TODA1}'`)));
  check('the LGU administrator can still accredit a TODA', accrLgu.ok && accrLgu.value.rowCount === 1, err(accrLgu));

  console.log('\nS1-11 audit_log: the actor is stamped from the signed-in user');
  const fakeAdmin = (await one(`SELECT admin_id FROM public.toda_admin WHERE auth_user_id = '${ID.T2_AUTH}'`)).admin_id;
  const aT = await attempt(() => as(ID.T_AUTH, (tx) => tx.query(`INSERT INTO public.audit_log (action_type, details, toda_admin_id, lgu_admin_id, actor_id, actor_role) VALUES ('TEST', 'forged', '${fakeAdmin}', NULL, '${ID.L_AUTH}', 'lgu_admin') RETURNING toda_admin_id, lgu_admin_id, actor_id, actor_role`)));
  const myAdmin = (await one(`SELECT admin_id FROM public.toda_admin WHERE auth_user_id = '${ID.T_AUTH}'`)).admin_id;
  check('a TODA administrator cannot forge the actor of an audit row', aT.ok && aT.value.rows[0].toda_admin_id === myAdmin && aT.value.rows[0].lgu_admin_id === null && aT.value.rows[0].actor_id === ID.T_AUTH && aT.value.rows[0].actor_role === 'toda_admin', aT.ok ? aT.value.rows[0] : err(aT));
  const aL = await attempt(() => as(ID.L_AUTH, (tx) => tx.query(`INSERT INTO public.audit_log (action_type, details) VALUES ('TEST', 'lgu') RETURNING lgu_admin_id, actor_role`)));
  check('an LGU administrator\'s audit row carries their admin id and role', aL.ok && aL.value.rows[0].lgu_admin_id !== null && aL.value.rows[0].actor_role === 'lgu_admin', aL.ok ? aL.value.rows[0] : err(aL));
  const aS = await attempt(() => svc((tx) => tx.query(`INSERT INTO public.audit_log (action_type, details, actor_id, actor_role) VALUES ('TEST', 'server', '${ID.L_AUTH}', 'system') RETURNING actor_id, actor_role`)));
  check('the server (service role) keeps whatever actor it writes', aS.ok && aS.value.rows[0].actor_id === ID.L_AUTH && aS.value.rows[0].actor_role === 'system', aS.ok ? aS.value.rows[0] : err(aS));

  console.log('\nS1-12 privileges of the new objects');
  const priv = await one(`SELECT
      has_function_privilege('authenticated', 'public.passenger_insert_guard()', 'EXECUTE') g1,
      has_function_privilege('authenticated', 'public.is_trusted_session()', 'EXECUTE') g2,
      has_function_privilege('anon', 'public.list_accredited_todas()', 'EXECUTE') a1,
      has_function_privilege('authenticated', 'public.find_candidate_drivers(uuid, double precision, integer)', 'EXECUTE') a2,
      has_function_privilege('service_role', 'public.get_booking_counterparties(uuid[])', 'EXECUTE') a3,
      has_function_privilege('authenticated', 'public.get_my_toda_affiliations()', 'EXECUTE') a4,
      has_function_privilege('anon', 'public.get_my_toda_affiliations()', 'EXECUTE') a5`);
  check('guards and the trusted-session helper are not callable by clients; the RPCs are callable by signed-in users', !priv.g1 && !priv.g2 && priv.a1 && priv.a2 && priv.a3 && priv.a4 && !priv.a5, priv);

  await db.close();
  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
