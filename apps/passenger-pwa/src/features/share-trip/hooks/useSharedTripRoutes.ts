import { useEffect, useRef, useState } from "react";
import { calculateDistanceKm, getOSRMRoute, type SharedTripView } from "@sakay/shared";

/** The driver has to move this far (km) before the arrival time is asked for again */
const ETA_MIN_MOVE_KM = 0.15;
/** ... or this long (ms) must pass */
const ETA_MAX_AGE_MS = 60_000;
/** A position older than this (seconds) is not live: no arrival time is worked out from it */
export const LIVE_POSITION_MAX_AGE_SECONDS = 90;

const valid = (p: { lat: number | null; lng: number | null } | null | undefined): p is { lat: number; lng: number } =>
  Boolean(p) && typeof p!.lat === "number" && typeof p!.lng === "number" && Number.isFinite(p!.lat) && Number.isFinite(p!.lng) && !(p!.lat === 0 && p!.lng === 0);

export interface SharedTripRoutes {
  /** The road from the pickup to the destination; null when the routing service gave no real road (a straight line is never drawn in its place) */
  road: [number, number][] | null;
  /** Minutes to the next stop (the pickup on the way to it, the destination once the trip is on); null when it cannot be told honestly */
  etaMinutes: number | null;
  etaTarget: "pickup" | "destination" | null;
}

/**
 * What the public trip page needs from the routing service, asked for as little as possible:
 *  - the road between the pickup and the destination, once per trip;
 *  - the time to the next stop, from the driver's real position, again only when the driver has moved or a minute has passed, and never from a position that is no
 *    longer live or for a trip that has ended. Only a real road answer counts: the service's straight-line estimate is not shown as a time or a route.
 */
export function useSharedTripRoutes(trip: SharedTripView | null): SharedTripRoutes {
  const [road, setRoad] = useState<[number, number][] | null>(null);
  const [eta, setEta] = useState<{ minutes: number | null; target: "pickup" | "destination" | null }>({ minutes: null, target: null });
  const lastEta = useRef<{ lat: number; lng: number; at: number; target: string } | null>(null);

  const pickup = trip && valid(trip.pickup) ? trip.pickup : null;
  const dropoff = trip && valid(trip.dropoff) ? trip.dropoff : null;
  const pickupKey = pickup ? `${pickup.lat},${pickup.lng}` : "";
  const dropoffKey = dropoff ? `${dropoff.lat},${dropoff.lng}` : "";

  useEffect(() => {
    if (!pickup || !dropoff) {
      setRoad(null);
      return undefined;
    }
    let alive = true;
    void getOSRMRoute(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng).then((result) => {
      if (alive) setRoad(result.source === "osrm" && result.coordinates.length >= 2 ? result.coordinates : null);
    });
    return () => {
      alive = false;
    };
    // the two ends are what matters, not the objects
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupKey, dropoffKey]);

  const state = trip?.state ?? "";
  const target: "pickup" | "destination" | null = state === "assigned" ? "pickup" : state === "ongoing" ? "destination" : null;
  const driver = trip?.driver_position ?? null;
  const live = Boolean(trip && !trip.ended && driver && driver.age_seconds <= LIVE_POSITION_MAX_AGE_SECONDS);
  const goal = target === "pickup" ? pickup : target === "destination" ? dropoff : null;

  // Only the newest question may answer: `latest` counts them, and an answer to an older one (or one that arrives after the page is gone) is dropped.
  // (The effect does not cancel a question in flight when the driver moves a little: that one is still the newest, and its answer is still good.)
  const latest = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!live || !driver || !goal || !target) {
      latest.current += 1;
      lastEta.current = null;
      setEta({ minutes: null, target: null });
      return;
    }
    const previous = lastEta.current;
    const moved = previous ? calculateDistanceKm(previous.lat, previous.lng, driver.lat, driver.lng) : Infinity;
    const stale = previous ? Date.now() - previous.at > ETA_MAX_AGE_MS : true;
    if (previous && previous.target === target && moved < ETA_MIN_MOVE_KM && !stale) return;
    lastEta.current = { lat: driver.lat, lng: driver.lng, at: Date.now(), target };
    const mine = ++latest.current;
    void getOSRMRoute(driver.lat, driver.lng, goal.lat, goal.lng).then((result) => {
      if (!mounted.current || mine !== latest.current) return;
      setEta(result.source === "osrm" ? { minutes: result.durationMin, target } : { minutes: null, target: null });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, driver?.lat, driver?.lng, target, goal?.lat, goal?.lng]);

  return { road, etaMinutes: eta.minutes, etaTarget: eta.target };
}
