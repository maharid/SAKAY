// Shared helpers for the Batch 5 (fare) suites. They run the WHOLE migration chain and reuse the
// Batch 4 fixtures (users, TODAs, an LGU admin, verified drivers, presence helpers).
const { setup: setupBase, ID, attempt, check, summary, asUser } = require('./b4fixtures');

// Pickup / destination ~3.3 km apart along one meridian, inside the service area.
const PICKUP = { lat: 13.4115, lng: 121.1803 };
const DROPOFF = { lat: 13.4415, lng: 121.1803 };

// `until`: the last migration to apply (default: the whole chain)
async function setup(until = null) {
  const base = await setupBase(until);
  const { db, as, svc } = base;
  // (the Batch 4 q / one take no parameters; these do)
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const one = async (sql, args) => (await q(sql, args))[0];
  const anon = (fn) => asUser(db, { uid: null, role: 'anon' }, fn, { commit: true });
  const num = (v) => Number(v);

  // The calculator exactly as the database exposes it, with the seeded tariff unless told otherwise.
  const fare = async (km, type = 'Solo', pax = 1, rule = {}) => {
    const { base: b = 15, baseKm = 2, rate = 1, cap = null } = rule;
    return (await one(
      `SELECT public.calculate_fare($1::numeric, $2, $3, $4::numeric, $5::numeric, $6::numeric, $7::integer) AS r`,
      [km, type, pax, b, baseKm, rate, cap]
    )).r;
  };
  const allocate = async (legs, rule = {}) => {
    const { base: b = 15, baseKm = 2, rate = 1, cap = null } = rule;
    return (await one(
      `SELECT public.allocate_shared_fares($1::jsonb, $2::numeric, $3::numeric, $4::numeric, $5::integer) AS r`,
      [JSON.stringify(legs), b, baseKm, rate, cap]
    )).r;
  };

  // quote_fare() as a signed-in user.
  const quote = async (uid, km, pax = 1) =>
    (await as(uid, (tx) => tx.query(`SELECT public.quote_fare($1::numeric, $2::integer) AS r`, [km, pax]))).rows[0].r;

  // Insert a booking the way the app does. `fare` defaults to the fare the database quotes for it.
  const book = async (uid, passengerId, o = {}) => {
    const km = o.km ?? 5;
    const pax = o.pax ?? 1;
    const shared = o.shared ?? false;
    const pickup = o.pickup ?? PICKUP;
    const dropoff = o.dropoff ?? DROPOFF;
    let fare_ = o.fare;
    if (fare_ === undefined) {
      const qt = await quote(uid, km, pax);
      fare_ = shared ? qt.shared_matched_estimate : qt.solo_fare;
    }
    const cols = {
      passenger_id: passengerId,
      booking_type: o.type ?? 'Immediate',
      is_shared_trip: shared,
      passenger_count: pax,
      pickup_address: 'A',
      pickup_latitude: pickup.lat,
      pickup_longitude: pickup.lng,
      dropoff_address: 'B',
      dropoff_latitude: dropoff.lat,
      dropoff_longitude: dropoff.lng,
      estimated_distance_km: km,
      estimated_fare: fare_,
      ...(o.extra ?? {}),
    };
    if (o.noDistance) delete cols.estimated_distance_km;
    const keys = Object.keys(cols);
    const res = await as(uid, (tx) =>
      tx.query(`INSERT INTO public.booking (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, keys.map((k) => cols[k])));
    return res.rows[0];
  };

  const getBooking = (id) => one(`SELECT * FROM public.booking WHERE booking_id = $1`, [id]);
  // The trusted server assigns the driver (Batch 6 owns dispatch; this is only test plumbing).
  const assign = (bookingId, driverId) =>
    svc((tx) => tx.query(`UPDATE public.booking SET driver_id = $2, booking_status = 'Accepted' WHERE booking_id = $1`, [bookingId, driverId]));
  // The driver moves the booking along, exactly as the Driver app does (plain UPDATE of booking_status). Since Batch 6 the database refuses
  // a jump (a trip cannot start before the driver has arrived), so a request for a later step walks through each step before it, as the app does.
  const STEPS = ['Accepted', 'In Transit', 'Driver Arrived', 'Trip Ongoing', 'Arrived at Destination'];
  // Since 20261023000001 (Batch 8) the database refuses Arrived from outside the pickup zone (a fresh fix of at most 30 m of error within 25 m of
  // the pickup) and refuses to start the trip before the driver has confirmed the passenger's first name. A real driver at the pickup has both, so
  // before such a step the helper gives the driver exactly that (a fix 5 m from the pickup, 10 m of error; the confirmation through the same RPC the
  // app calls). It leaves the driver where he arrived. A suite that tests those two refusals writes the status itself.
  const ASSIGNED_STATUSES = ['Accepted', 'Assigned', 'Driver Assigned', 'Driver En Route', 'Heading to Passenger', 'In Transit'];
  const ARRIVED_STATUSES = ['Driver Arrived', 'Arrived at Pickup'];
  const ONGOING_STATUSES = ['Trip Ongoing', 'Ongoing'];
  const prepareDriverStep = async (uid, bookingId, status) => {
    const b = await one(`SELECT driver_id, booking_status, pickup_latitude AS lat, pickup_longitude AS lng FROM public.booking WHERE booking_id = $1`, [bookingId]);
    if (!b || !b.driver_id) return;
    if (ARRIVED_STATUSES.includes(status) && ASSIGNED_STATUSES.includes(b.booking_status)) {
      await base.internal(`UPDATE public.driver SET current_latitude = ${Number(b.lat) + 5 / 111195}, current_longitude = ${Number(b.lng)},
                                  last_location_update = clock_timestamp(), last_location_accuracy_m = 10 WHERE driver_id = '${b.driver_id}'`);
    } else if (ONGOING_STATUSES.includes(status) && ARRIVED_STATUSES.includes(b.booking_status)) {
      const confirmed = await attempt(() => as(uid, (tx) => tx.query(`SELECT public.driver_confirm_passenger($1)`, [bookingId])));
      // (booking-guards.js ends with a fail-closed section that makes is_service_context() answer NULL on purpose: the RPC then refuses, as it should, and
      // the confirmation is written directly, as a trusted direct session would. The RPC itself is tested in batch8/arrival-and-wait.js.)
      if (!confirmed.ok) await base.internal(`UPDATE public.booking SET boarding_verified_at = COALESCE(boarding_verified_at, clock_timestamp()) WHERE booking_id = '${bookingId}'`);
    }
  };
  const writeStatus = async (uid, bookingId, status) => {
    await prepareDriverStep(uid, bookingId, status);
    return as(uid, (tx) => tx.query(`UPDATE public.booking SET booking_status = $2 WHERE booking_id = $1 RETURNING *`, [bookingId, status])).then((r) => r.rows[0]);
  };
  // Since 20261017000001 the database lets the driver arrive only once the trip's recorded fixes reach 90% progress. A real trip has them (the
  // heartbeat logs each published fix), so before the driver arrives this gives the trip one published fix AT the destination - unless the test
  // already recorded a track that gets there. Its accuracy (90 m) is worse than the 50 m the fare track accepts, so the fare suites that mean
  // "no usable GPS track" still mean it, and better than the 100 m a heartbeat needs to publish, so the finish gate counts it.
  const arrivalFix = async (bookingId) => {
    const have = (await one(`SELECT public._trip_progress_pct($1::uuid) AS p`, [bookingId])).p;
    if (have !== null && have >= 90) return;
    await db.query(
      `INSERT INTO public.gps_log (booking_id, driver_id, latitude, longitude, accuracy, recorded_at)
       SELECT b.booking_id, b.driver_id, b.dropoff_latitude, b.dropoff_longitude, 90, clock_timestamp()
       FROM public.booking b WHERE b.booking_id = $1 AND b.driver_id IS NOT NULL`,
      [bookingId]
    );
  };
  const setStatus = async (uid, bookingId, status) => {
    const to = STEPS.indexOf(status);
    if (to > 1) {
      const from = STEPS.indexOf((await one(`SELECT booking_status FROM public.booking WHERE booking_id = $1`, [bookingId])).booking_status);
      for (let i = Math.max(from, 0) + 1; i < to; i++) await writeStatus(uid, bookingId, STEPS[i]);
    }
    if (status === 'Arrived at Destination') await arrivalFix(bookingId);
    return writeStatus(uid, bookingId, status);
  };

  // A straight track along the meridian: n fixes, `stepDeg` apart, 5 s apart, from PICKUP northwards.
  const logTrack = (bookingId, driverId, { n = 100, stepDeg = 0.00045, accuracy = 10, skip = [], startAt = '2026-10-07T01:00:00Z', lngDeg = 0 } = {}) =>
    db.query(
      `INSERT INTO public.gps_log (booking_id, driver_id, latitude, longitude, accuracy, recorded_at)
       SELECT $1, $2, $3::float8 + i * $4::float8, $5::float8 + i * $6::float8, $7::float8, $8::timestamptz + (i * 5) * interval '1 second'
       FROM generate_series(0, $9::int - 1) AS i
       WHERE NOT (i = ANY($10::int[]))`,
      [bookingId, driverId, PICKUP.lat, stepDeg, PICKUP.lng, lngDeg, accuracy, startAt, n, skip]
    );

  return { ...base, q, one, anon, num, fare, allocate, quote, book, getBooking, assign, setStatus, prepareDriverStep, arrivalFix, logTrack, PICKUP, DROPOFF, ID, attempt, check, summary, asUser };
}

module.exports = { setup, ID, attempt, check, summary, asUser, PICKUP, DROPOFF };
