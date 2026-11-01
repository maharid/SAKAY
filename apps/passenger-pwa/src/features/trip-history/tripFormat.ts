import type { HistoryTrip } from "../../services/tripService";

/**
 * What the Trip History and Trip Details screens say about a trip, in one place (no React in this file): the same words, colours and rebooking data on both screens.
 * Nothing here decides a status, a fare or a driver: it only words what the trip record already holds.
 */

export type Lang = "en" | "tl";

const MANILA = "Asia/Manila";

/** "10 Oct 2025, 8:22 AM" in Philippine time; a record without a timestamp falls back to the date and time it was stored with, never to an invented one. */
export function formatTripWhen(trip: Pick<HistoryTrip, "createdAt" | "dateString" | "time">): string {
  const t = trip.createdAt ? Date.parse(trip.createdAt) : NaN;
  if (Number.isFinite(t)) {
    const d = new Date(t);
    const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: MANILA });
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: MANILA });
    return `${day}, ${time}`;
  }
  return [trip.dateString, trip.time].filter(Boolean).join(", ");
}

/** The status in the passenger's language. Only the two statuses a finished trip can have are translated; any other status is shown as the database wrote it. */
export function tripStatusLabel(status: string | undefined, lang: Lang): string {
  if (status === "Completed") return lang === "tl" ? "Nakumpleto" : "Completed";
  if (status === "Cancelled") return lang === "tl" ? "Kinansela" : "Cancelled";
  return status ?? "";
}

/** Green only for a completed trip, red for a cancelled one, neutral for anything else (white text keeps 4.5:1 contrast on all three): the colours the detail screen always used. */
export function tripStatusColors(status: string | undefined): { background: string; color: string } {
  return { background: status === "Completed" ? "#15803D" : status === "Cancelled" ? "#B91C1C" : "#475569", color: "#FFFFFF" };
}

export function tripTypeLabel(type: HistoryTrip["type"] | undefined, lang: Lang): string {
  void lang; // the two names are the same in both languages, as they always were on these screens
  return type === "Share" ? "Shared Trip" : "Solo Trip";
}

export interface DriverSummary {
  /** a driver was assigned (a trip cancelled before a driver accepted has none) */
  hasDriver: boolean;
  name: string;
  todaName: string;
  /** "Plate ABC 123 · Body no. 1673", only the parts the record has */
  vehicleLine: string;
}

export function driverSummary(trip: Pick<HistoryTrip, "driverName" | "todaName" | "plateNumber" | "bodyNumber">, lang: Lang): DriverSummary {
  const name = (trip.driverName ?? "").trim();
  const plate = (trip.plateNumber ?? "").trim();
  const body = (trip.bodyNumber ?? "").trim();
  return {
    hasDriver: name !== "",
    name: name || (lang === "tl" ? "Walang drayber" : "No driver assigned"),
    todaName: (trip.todaName ?? "").trim(),
    vehicleLine: [plate && (lang === "tl" ? `Plaka ${plate}` : `Plate ${plate}`), body && (lang === "tl" ? `Body no. ${body}` : `Body no. ${body}`)].filter(Boolean).join(" · "),
  };
}

export interface RebookPoint {
  address: string;
  lat: number;
  lng: number;
}

/** The pickup and drop-off of THIS trip, as the new-trip screen reads them. Nothing is submitted: the passenger still confirms the booking and the fare is worked out again. */
export function rebookPoints(trip: Pick<HistoryTrip, "pickup" | "pickupLat" | "pickupLng" | "dropoff" | "dropoffLat" | "dropoffLng">): { pickup: RebookPoint; dropoff: RebookPoint } {
  return {
    pickup: { address: trip.pickup, lat: trip.pickupLat, lng: trip.pickupLng },
    dropoff: { address: trip.dropoff, lat: trip.dropoffLat, lng: trip.dropoffLng },
  };
}

interface KeyValueStore {
  setItem(key: string, value: string): void;
}

/** Hands the historical route to the new-trip screen (the same two keys it has always read). */
export function stashRebook(trip: Parameters<typeof rebookPoints>[0], store: KeyValueStore = sessionStorage): void {
  const { pickup, dropoff } = rebookPoints(trip);
  store.setItem("trip_pickup", JSON.stringify(pickup));
  store.setItem("trip_dropoff", JSON.stringify(dropoff));
}
