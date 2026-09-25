/**
 * SAKAY Trip & Booking Service
 * Clean service layer isolating trip history & booking queries
 */

import { supabase } from "./supabaseClient";

export interface HistoryTrip {
  id: string;
  pickup: string;
  pickupLat: number;
  pickupLng: number;
  dropoff: string;
  dropoffLat: number;
  dropoffLng: number;
  price: string;
  type: "Solo" | "Share";
  distanceKm?: number;
  time: string;
  dateGroup: "NGAYONG ARAW" | "NAKARAANG ARAW";
  driverName?: string;
  bodyNumber?: string;
  dateString?: string;
  isLiveRecord: boolean;
  status?: "Completed" | "Cancelled";
}

// UI Demo reference data matching PASSENGER HISTORY.png
export const DEMO_HISTORY_TRIPS: HistoryTrip[] = [
  {
    id: "TRIP-2026-0813-01",
    pickup: "Calapan Port",
    pickupLat: 13.4248,
    pickupLng: 121.1812,
    dropoff: "Xentro Mall Calapan",
    dropoffLat: 13.4130,
    dropoffLng: 121.1790,
    price: "₱66.40",
    type: "Solo",
    distanceKm: 3.6,
    time: "2:30 PM",
    dateGroup: "NGAYONG ARAW",
    driverName: "Aurelio Bautista",
    bodyNumber: "CAL-2025-0773",
    dateString: "August 13, 2026",
    isLiveRecord: false,
    status: "Completed",
  },
  {
    id: "TRIP-2026-0813-02",
    pickup: "Calapan City Hall",
    pickupLat: 13.3980,
    pickupLng: 121.1824,
    dropoff: "Filipiniana Hotel Calapan",
    dropoffLat: 13.4100,
    dropoffLng: 121.1780,
    price: "₱64.40",
    type: "Solo",
    distanceKm: 3.1,
    time: "9:15 AM",
    dateGroup: "NGAYONG ARAW",
    driverName: "Pedro Penduko",
    bodyNumber: "TODA-088",
    dateString: "August 13, 2026",
    isLiveRecord: false,
    status: "Completed",
  },
  {
    id: "TRIP-2026-0812-01",
    pickup: "Puregold -Calapan",
    pickupLat: 13.4120,
    pickupLng: 121.1800,
    dropoff: "Santo Niño Cathedral (Dioc...",
    dropoffLat: 13.4128,
    dropoffLng: 121.1830,
    price: "₱20.00",
    type: "Share",
    distanceKm: 1.2,
    time: "5:45 PM",
    dateGroup: "NAKARAANG ARAW",
    driverName: "Mario Reyes",
    bodyNumber: "TODA-215",
    dateString: "August 12, 2026",
    isLiveRecord: false,
    status: "Completed",
  },
];

const LOCAL_HISTORY_KEY = "sakay_passenger_trip_history";

export const getLocalTripHistory = (): HistoryTrip[] => {
  try {
    const raw = localStorage.getItem(LOCAL_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn("Failed to parse local trip history:", err);
    return [];
  }
};

export const saveTripToHistory = (trip: HistoryTrip) => {
  try {
    const existing = getLocalTripHistory();
    // Filter out duplicates
    const filtered = existing.filter((item) => item.id !== trip.id);
    const updated = [trip, ...filtered];
    localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn("Failed to save trip to local history:", err);
  }
};

/**
 * Fetches passenger trip history from Supabase database and local storage,
 * falling back to structured demo data if no records exist.
 */
export const fetchTripHistory = async (): Promise<HistoryTrip[]> => {
  const dbTrips: HistoryTrip[] = [];

  try {
    const { data: { user } } = await supabase.auth.getUser();

    let passengerId: string | null = null;
    if (user?.id) {
      const { data: profile } = await supabase
        .from("passenger")
        .select("passenger_id")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (profile?.passenger_id) {
        passengerId = profile.passenger_id;
      }
    }

    let query = supabase
      .from("booking")
      .select(`
        booking_id,
        pickup_address,
        pickup_latitude,
        pickup_longitude,
        dropoff_address,
        dropoff_latitude,
        dropoff_longitude,
        estimated_fare,
        actual_fare,
        route_distance_km,
        estimated_distance_km,
        is_shared_trip,
        booking_status,
        created_at
      `)
      .in("booking_status", ["Completed", "Cancelled"])
      .order("created_at", { ascending: false });

    if (passengerId) {
      query = query.eq("passenger_id", passengerId);
    } else {
      query = query.limit(20);
    }

    const { data: bookings } = await query;

    if (bookings && bookings.length > 0) {
      bookings.forEach((b: any) => {
        const createdDate = new Date(b.created_at);
        const isToday = new Date().toDateString() === createdDate.toDateString();
        const fare = b.actual_fare || b.estimated_fare || 0;

        dbTrips.push({
          id: b.booking_id,
          pickup: b.pickup_address || "Calapan City",
          pickupLat: Number(b.pickup_latitude) || 13.4124,
          pickupLng: Number(b.pickup_longitude) || 121.1834,
          dropoff: b.dropoff_address || "Calapan City Public Market",
          dropoffLat: Number(b.dropoff_latitude) || 13.4150,
          dropoffLng: Number(b.dropoff_longitude) || 121.1810,
          price: `₱${parseFloat(fare).toFixed(2)}`,
          type: b.is_shared_trip ? "Share" : "Solo",
          distanceKm: Number(b.route_distance_km || b.estimated_distance_km) || 1.5,
          time: createdDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          dateGroup: isToday ? "NGAYONG ARAW" : "NAKARAANG ARAW",
          dateString: createdDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
          isLiveRecord: true,
          status: b.booking_status,
        });
      });
    }
  } catch (err) {
    console.warn("Trip history database fetch note:", err);
  }

  // Retrieve locally saved trips (e.g. from session or guest mode)
  const localTrips = getLocalTripHistory();

  // Combine DB trips, Local trips, and Demo trips
  const combinedMap = new Map<string, HistoryTrip>();

  // 1. Add Local trips (highest priority for current session)
  localTrips.forEach((t) => combinedMap.set(t.id, t));

  // 2. Add DB trips
  dbTrips.forEach((t) => {
    if (!combinedMap.has(t.id)) combinedMap.set(t.id, t);
  });

  // 3. Fallback: if no user-generated trips exist, include demo trips
  if (combinedMap.size === 0) {
    DEMO_HISTORY_TRIPS.forEach((t) => combinedMap.set(t.id, t));
  }

  const result = Array.from(combinedMap.values());
  return result;
};
