// Shared helpers for the Batch 5 (fare) suites. They run the WHOLE migration chain and reuse the
// Batch 4 fixtures (users, TODAs, an LGU admin, verified drivers, presence helpers).
const { setup: setupBase, ID, attempt, check, summary, asUser } = require('./b4fixtures');

// Pickup / destination ~3.3 km apart along one meridian, inside the service area.
const PICKUP = { lat: 13.4115, lng: 121.1803 };
const DROPOFF = { lat: 13.4415, lng: 121.1803 };

async function setup() {
  const base = await setupBase(null);
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
  // The driver moves the booking along, exactly as DriverActiveTrip does (plain UPDATE of booking_status).
  const setStatus = (uid, bookingId, status) =>
    as(uid, (tx) => tx.query(`UPDATE public.booking SET booking_status = $2 WHERE booking_id = $1 RETURNING *`, [bookingId, status])).then((r) => r.rows[0]);

  // A straight track along the meridian: n fixes, `stepDeg` apart, 5 s apart, from PICKUP northwards.
  const logTrack = (bookingId, driverId, { n = 100, stepDeg = 0.00045, accuracy = 10, skip = [], startAt = '2026-10-07T01:00:00Z', lngDeg = 0 } = {}) =>
    db.query(
      `INSERT INTO public.gps_log (booking_id, driver_id, latitude, longitude, accuracy, recorded_at)
       SELECT $1, $2, $3::float8 + i * $4::float8, $5::float8 + i * $6::float8, $7::float8, $8::timestamptz + (i * 5) * interval '1 second'
       FROM generate_series(0, $9::int - 1) AS i
       WHERE NOT (i = ANY($10::int[]))`,
      [bookingId, driverId, PICKUP.lat, stepDeg, PICKUP.lng, lngDeg, accuracy, startAt, n, skip]
    );

  return { ...base, q, one, anon, num, fare, allocate, quote, book, getBooking, assign, setStatus, logTrack, PICKUP, DROPOFF, ID, attempt, check, summary, asUser };
}

module.exports = { setup, ID, attempt, check, summary, asUser, PICKUP, DROPOFF };
