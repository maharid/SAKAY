// Batch 6, Rule 7.2.1 and specification section 7: who is offered FIRST inside a tier, and the tie-breakers in their exact order:
//   1 shortest ETA  2 shortest road distance  3 longest continuous available time  4a earliest account approval  4b lowest driver id
// (PI-02's single-use redispatch credit sits between 1 and 2 and is covered by booking-timers.js S3b; ratings never count.)
// Two Priority TODA drivers stand where the ranking can only be decided by the criterion under test. Local emulator, never Supabase.
// A fresh database: no earlier trips, so a driver's "available since" is the start of the Online session.
const { setup, ID, DRIVERS, check, summary } = require('../b6fixtures');

(async () => {
  const s = await setup();
  const { q, internal } = s;
  const day = (n) => `2026-01-0${n}T00:00:00Z`;
  const ids = (rows) => rows.map((r) => (r.driver_id === ID.D1 ? 'D1' : r.driver_id === ID.D2 ? 'D2' : r.driver_id));
  const allOffline = async () => { for (const k of ['D1', 'D2']) if ((await s.status(DRIVERS[k].id)) !== 'Offline') await s.goOffline(DRIVERS[k].uid); };

  // Both drivers Online, everything the ranking reads set explicitly; a booking is made and the first offer is read back.
  const rank = async ({ m1 = 300, m2 = 300, longerD1 = 0, longerD2 = 0, approved1 = day(1), approved2 = day(1), order = ['D1', 'D2'], rating1 = 5, rating2 = 5 }) => {
    await allOffline();
    for (const k of order) await s.online(k, k === 'D1' ? m1 : m2);
    const base = Date.now();
    await internal(`
      UPDATE driver_online_session SET started_at = '${new Date(base - longerD1 * 1000).toISOString()}' WHERE driver_id = '${ID.D1}' AND ended_at IS NULL;
      UPDATE driver_online_session SET started_at = '${new Date(base - longerD2 * 1000).toISOString()}' WHERE driver_id = '${ID.D2}' AND ended_at IS NULL;
      UPDATE driver_toda_affiliation SET lgu_verified_at = '${approved1}' WHERE affiliation_id = '${s.AFF.D1_T1}';
      UPDATE driver_toda_affiliation SET lgu_verified_at = '${approved2}' WHERE affiliation_id = '${s.AFF.D2_T1}';
      UPDATE driver SET weighted_average_rating = ${rating1} WHERE driver_id = '${ID.D1}';
      UPDATE driver SET weighted_average_rating = ${rating2} WHERE driver_id = '${ID.D2}'`);
    const b = await s.bookAs('P1');
    const offers = await s.offers(b.booking_id);
    // The driver who was offered the booking is no longer a candidate for it, so the only one left is the OTHER driver: what the two were ranked by.
    const rest = await q(`SELECT eta_seconds, distance_m FROM dispatch_eligible_drivers('${b.booking_id}'::uuid, NULL)`);
    await s.finish(b.booking_id);
    return {
      first: ids(offers)[0], offered: offers.length, tier: offers[0] && offers[0].tier,
      winner: offers[0] ? { eta: offers[0].eta_seconds, m: offers[0].distance_m } : null,
      other: rest[0] ? { eta: rest[0].eta_seconds, m: rest[0].distance_m } : null,
    };
  };
  const sameEta = (r) => r.winner && r.other && r.winner.eta === r.other.eta;

  console.log('R1 criterion 1: the shortest ETA wins over everything else');
  let r = await rank({ m1: 400, m2: 300, longerD1: 7200, approved1: day(1), approved2: day(9) });
  check('D2 (300 m, ETA shorter) is offered first although D1 has been available 2 hours longer and was approved first', r.first === 'D2' && r.offered === 1 && r.tier === 1, r);

  console.log('\nR2 criterion 2: equal ETA, the shorter road distance wins over availability and approval');
  r = await rank({ m1: 301, m2: 300, longerD1: 7200, approved1: day(1), approved2: day(9) });
  check('(set-up) the two ETAs really are equal while the distances differ by 1 m', sameEta(r) && r.winner.m === 300 && r.other.m === 301, r);
  check('D2 (1 m nearer) is offered first although D1 has been available longer and was approved first', r.first === 'D2', r);

  console.log('\nR3 criterion 3: equal ETA and distance, the longest continuous available time wins over approval');
  r = await rank({ longerD1: 3600, approved1: day(9), approved2: day(1) });
  check('(set-up) equal ETA and equal distance', sameEta(r) && r.winner.m === r.other.m, r);
  check('D1 (available an hour longer) is offered first although D2 was approved earlier', r.first === 'D1', r);
  r = await rank({ longerD2: 3600, approved1: day(1), approved2: day(9) });
  check('and the other way round: D2 (available longer) first although D1 was approved earlier', r.first === 'D2', r);

  console.log('\nR4 criterion 4a: everything equal, the earliest account approval wins');
  r = await rank({ approved1: day(2), approved2: day(1) });
  check('D2 (approved on 1 January) is offered before D1 (2 January)', r.first === 'D2', r);
  r = await rank({ approved1: day(1), approved2: day(2) });
  check('and the other way round: D1 first', r.first === 'D1', r);

  console.log('\nR5 criterion 4b: everything equal, the lowest driver identifier wins; and the rating plays no part');
  const lowest = ID.D1 < ID.D2 ? 'D1' : 'D2';
  r = await rank({ order: ['D1', 'D2'] });
  check(`the lowest identifier (${lowest}) is offered first`, r.first === lowest, r);
  r = await rank({ order: ['D2', 'D1'] });
  check('...whichever driver went Online first', r.first === lowest, r);
  r = await rank({ rating1: 1, rating2: 5 });
  const flipped = await rank({ rating1: 5, rating2: 1 });
  check('a driver rated 1.0 against one rated 5.0 changes nothing, either way round (ratings are never used in dispatch)', r.first === lowest && flipped.first === lowest, { r: r.first, flipped: flipped.first });

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
