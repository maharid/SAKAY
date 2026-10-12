// Batch 6: get_dispatch_status() reports the radius the search is really using (radius_m), for the passenger's map.
// Runs the WHOLE migration chain on the local emulator (never Supabase). Read-only feature: this suite also proves the search itself did not
// change (the same offers, the same tiers) and that the passenger still sees no tier numbers.
const { setup, ID, check, summary } = require('../b6fixtures');

(async () => {
  const s = await setup();
  const { q, one } = s;
  const radiusOf = async (b) => (await s.statusOf('P1', b.booking_id)).radius_m;

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('R1: Tier 1 - the radius is the Priority TODA geofence (600 m)');
  await s.online('D1', 300);
  let b = await s.bookAs('P1');
  let st = await s.statusOf('P1', b.booking_id);
  check('a search in Tier 1 reports 600 m', st.success === true && st.phase === 'nearby' && st.radius_m === 600, st);
  check('the radius is the database constant, not a number typed in the app', st.radius_m === (await one(`SELECT public.dispatch_constant('tier1_radius_m') AS v`)).v, st);
  check('the passenger is still shown a distance only: no tier number in the answer', !('tier' in st) && !('dispatch_tier' in st), Object.keys(st));
  check('the search itself is unchanged: one offer, to D1, in Tier 1', (await s.offers(b.booking_id)).length === 1 && (await s.booking(b.booking_id)).dispatch_tier === 1);
  const acc = await s.accept('D1', (await s.offers(b.booking_id))[0].attempt_id);
  st = await s.statusOf('P1', b.booking_id);
  check('once a driver has accepted there is no search, so no radius', acc.success === true && st.phase === 'ended' && st.radius_m === null, st);
  await s.finish(b.booking_id);
  await s.goOffline(s.DRIVERS.D1.uid);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nR2: Tier 2 - any accredited TODA within 2 km');
  await s.online('D3', 400);            // TODA Two: not the Priority TODA, so Tier 1 has nobody
  b = await s.bookAs('P1');
  st = await s.statusOf('P1', b.booking_id);
  check('a search in Tier 2 reports 2000 m', st.phase === 'nearby' && st.radius_m === 2000, st);
  check('...which is the Tier 2 constant', st.radius_m === (await one(`SELECT public.dispatch_constant('tier2_radius_m') AS v`)).v);
  await s.finish(b.booking_id);
  await s.goOffline(s.DRIVERS.D3.uid);

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nR3: Tier 3 - the radius follows the live-search schedule, measured from when Tier 3 began');
  await s.online('D1', 3400);           // farther than 2 km: nobody is eligible until the radius grows
  b = await s.bookAs('P1');
  st = await s.statusOf('P1', b.booking_id);
  check('the live search starts at 2000 m', st.phase === 'widening' && st.radius_m === 2000, st);
  await s.rewind(b.booking_id, 95);
  check('1:35 into Tier 3 the radius is 2500 m', (await radiusOf(b)) === 2500);
  await s.rewind(b.booking_id, 90);
  check('3:05 the radius is 3000 m', (await radiusOf(b)) === 3000);
  await s.rewind(b.booking_id, 90);
  st = await s.statusOf('P1', b.booking_id);
  check('4:35 the radius is 3500 m, still searching', st.phase === 'widening' && st.radius_m === 3500, st);
  const expected = await q(`SELECT public.dispatch_tier3_radius_m(${st.widening_seconds}) AS r`);
  check('every one of those equals what the engine itself applies for the elapsed time (dispatch_tier3_radius_m)', expected[0].r === st.radius_m, { expected, st });

  // ------------------------------------------------------------------------------------------------------------------------------
  console.log('\nR4: when the search ends there is no radius');
  await s.rewind(b.booking_id, 330);                 // 4:35 + 5:30 = 10:05 into the live search: past the 10-minute maximum
  await s.sweep();
  st = await s.statusOf('P1', b.booking_id);
  check('past the maximum time the booking is No Driver Found and no radius is reported', st.booking_status === 'No Driver Found' && st.phase === 'ended' && st.radius_m === null, st);
  await s.finish(b.booking_id);

  console.log('\nR5: another passenger cannot read this status');
  const other = await s.statusOf('P2', b.booking_id);
  check('a different passenger gets the same refusal as before', other.success === false && other.error_code === 'ERR_NOT_YOUR_BOOKING', other);

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
