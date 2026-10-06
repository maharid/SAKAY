/**
 * SAKAY Trip & Booking Service
 * Clean service layer isolating trip history & booking queries
 */

import { supabase } from "./supabaseClient";
import type { FareBreakdown } from "@sakay/shared";

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
  /** What the database stored for the fare: rule snapshot, estimate, final (Rule 6.2). Absent on demo / older records. */
  fareBreakdown?: FareBreakdown | null;
  time: string;
  dateGroup: "NGAYONG ARAW" | "NAKARAANG ARAW";
  driverName?: string;
  bodyNumber?: string;
  dateString?: string;
  isLiveRecord: boolean;
  status?: "Completed" | "Cancelled";
}

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
 * The signed-in passenger's finished trips (Completed and Cancelled), straight from the database: the fare is the final fare once the
 * trip arrived, and the driver's name and franchise number come from the function that discloses only the driver of THIS passenger's own
 * booking. Nothing is read from the device (another account's trips on the same phone) and nothing is made up (no sample trips).
 */
export const fetchTripHistory = async (): Promise<HistoryTrip[]> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return [];

    const { data: profile } = await supabase
      .from("passenger")
      .select("passenger_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!profile?.passenger_id) return [];

    const { data: bookings, error } = await supabase
      .from("booking")
      .select(`
        booking_id,
        driver_id,
        pickup_address,
        pickup_latitude,
        pickup_longitude,
        dropoff_address,
        dropoff_latitude,
        dropoff_longitude,
        estimated_fare,
        actual_fare,
        actual_distance_km,
        estimated_distance_km,
        fare_breakdown,
        is_shared_trip,
        booking_status,
        created_at
      `)
      .eq("passenger_id", profile.passenger_id)
      .in("booking_status", ["Completed", "Cancelled"])
      .order("created_at", { ascending: false })
      .limit(100);
    if (error || !bookings) return [];

    // Who drove each trip (a cancelled booking may have no driver)
    const drivers = new Map<string, { full_name?: string; franchise_number?: string }>();
    await Promise.all(
      bookings
        .filter((b: any) => b.driver_id)
        .map(async (b: any) => {
          const { data } = await supabase.rpc("get_assigned_driver_details", { p_booking_id: b.booking_id });
          const row = Array.isArray(data) ? data[0] : data;
          if (row) drivers.set(b.booking_id, row);
        })
    );

    return bookings.map((b: any) => {
      const createdDate = new Date(b.created_at);
      const isToday = new Date().toDateString() === createdDate.toDateString();
      // The final fare once the trip arrived (written by the database), otherwise the estimate
      const fare = b.actual_fare ?? b.estimated_fare ?? 0;
      const driver = drivers.get(b.booking_id);
      return {
        id: b.booking_id,
        pickup: b.pickup_address || "Calapan City",
        pickupLat: Number(b.pickup_latitude) || 13.4124,
        pickupLng: Number(b.pickup_longitude) || 121.1834,
        dropoff: b.dropoff_address || "Calapan City",
        dropoffLat: Number(b.dropoff_latitude) || 13.4150,
        dropoffLng: Number(b.dropoff_longitude) || 121.1810,
        price: `₱${parseFloat(fare).toFixed(2)}`,
        type: b.is_shared_trip ? "Share" : "Solo",
        distanceKm: Number(b.actual_distance_km ?? b.estimated_distance_km) || undefined,
        fareBreakdown: b.fare_breakdown ?? null,
        time: createdDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        dateGroup: isToday ? "NGAYONG ARAW" : "NAKARAANG ARAW",
        dateString: createdDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
        driverName: driver?.full_name || "",
        bodyNumber: driver?.franchise_number || "",
        isLiveRecord: true,
        status: b.booking_status,
      } as HistoryTrip;
    });
  } catch (err) {
    console.warn("Trip history database fetch note:", err);
    return [];
  }
};
