import type { HistoryTrip } from "../../services/tripService";

/**
 * What the Trip History and Trip Details screens say about a trip, in one place (no React in this file): the same words, colours and rebooking data on both screens.
 * Nothing here decides a status, a fare or a driver: it only words what the trip record already holds.
 */

export type Lang = "en" | "tl";

export function tripTypeLabel(type: HistoryTrip["type"] | undefined, lang: Lang): string {
  void lang; // the two names are the same in both languages, as they always were on these screens
  return type === "Share" ? "Shared Trip" : "Solo Trip";
}

export interface DriverSummary {
  /** a driver was assigned (a trip cancelled before a driver accepted has none) */
  hasDriver: boolean;
  name: string;
  todaName: string;
  /** "Plate ABC 123 · DWCC2025", only the parts the record has */
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
    vehicleLine: [plate && (lang === "tl" ? `Plaka ${plate}` : `Plate ${plate}`), body].filter(Boolean).join(" · "),
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
