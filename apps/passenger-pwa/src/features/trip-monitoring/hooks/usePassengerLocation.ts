import { useCallback, useEffect, useRef, useState } from "react";
import { distanceMeters, watchDevicePosition, type GlideFix } from "@sakay/shared";

/**
 * off          not watching (the trip is not live yet, or nobody has allowed location and nobody asked for it)
 * locating     watching, no usable position yet
 * ok           there is a position
 * denied       the browser / the person said no
 * unavailable  the device cannot give a position right now (no signal, no GPS)
 */
export type PassengerLocationStatus = "off" | "locating" | "ok" | "denied" | "unavailable";

/** A fix less accurate than this (m) is not drawn: a dot placed 400 m off would be worse than none */
export const PASSENGER_FIX_MAX_ACCURACY_METERS = 150;
/** A position older than this (ms) is shown as stale */
export const PASSENGER_FIX_STALE_MS = 30_000;
/** A new fix that moved less than this (m) and is newer than MIN_UPDATE_MS changes nothing on screen */
const MIN_MOVE_METERS = 3;
const MIN_UPDATE_MS = 2000;
const STALE_CHECK_MS = 5000;
const PERMISSION_DENIED = 1;

export interface PassengerLocation {
  /** The passenger's current position, for the map's blue marker (null until there is a usable one) */
  fix: GlideFix | null;
  status: PassengerLocationStatus;
  /** There was a position, but nothing newer has arrived for a while */
  stale: boolean;
  /** Called when the person presses "center on me" and there is nothing to show yet: asks the browser (this press is the consent) and tries again */
  request: () => void;
}

const storedConsent = (): "granted" | "denied" | "unknown" => {
  try {
    const v = localStorage.getItem("gps_permission");
    return v === "true" ? "granted" : v === "false" ? "denied" : "unknown";
  } catch {
    return "unknown";
  }
};

/**
 * The passenger's own position while a trip is live: only so the map can show where THEY are and centre on them. It never leaves the phone
 * (nothing is sent to the database), watches only while `enabled`, and stops when the screen goes away.
 *
 * It does not ask the browser for permission by itself: it starts when the app already has the passenger's consent (the location prompt
 * earlier in the app) or when the passenger presses the control, which is consent for exactly this.
 */
export function usePassengerLocation(enabled: boolean): PassengerLocation {
  const [fix, setFix] = useState<GlideFix | null>(null);
  const [status, setStatus] = useState<PassengerLocationStatus>("locating");
  const [stale, setStale] = useState(false);
  const [requested, setRequested] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const lastRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const receivedRef = useRef<number>(0);

  const consent = storedConsent();
  const mayWatch = enabled && (requested || consent === "granted");

  useEffect(() => {
    if (!mayWatch || typeof navigator === "undefined" || !navigator.geolocation) return;
    receivedRef.current = Date.now();

    const watchId = watchDevicePosition(
      (coords) => {
        const now = Date.now();
        receivedRef.current = now;
        setStale((prev) => (prev ? false : prev));
        if (typeof coords.accuracy === "number" && coords.accuracy > PASSENGER_FIX_MAX_ACCURACY_METERS) {
          setStatus((prev) => (lastRef.current ? prev : "locating"));
          return;
        }
        const last = lastRef.current;
        const here = { lat: coords.latitude, lng: coords.longitude };
        if (last && now - last.at < MIN_UPDATE_MS && distanceMeters(last, here) < MIN_MOVE_METERS) return;
        lastRef.current = { ...here, at: now };
        setStatus("ok");
        setFix({ ...here, at: coords.timestamp ?? now, heading: coords.heading ?? null, speed: coords.speed ?? null });
      },
      (err) => {
        setStatus(err.code === PERMISSION_DENIED ? "denied" : "unavailable");
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
    );

    const staleTimer = setInterval(() => {
      const isStale = lastRef.current !== null && Date.now() - receivedRef.current > PASSENGER_FIX_STALE_MS;
      setStale((prev) => (prev === isStale ? prev : isStale));
    }, STALE_CHECK_MS);

    return () => {
      clearInterval(staleTimer);
      if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    };
  }, [mayWatch, attempt]);

  const request = useCallback(() => {
    setRequested(true);
    setStatus((prev) => (prev === "ok" ? prev : "locating"));
    setAttempt((n) => n + 1);
  }, []);

  // "denied" means the BROWSER said no to an attempt. A "no" the passenger gave the app's own prompt earlier is not that: the map control
  // asks again when it is pressed, and the browser has the last word.
  const shown: PassengerLocationStatus = !enabled || !mayWatch ? "off" : status;

  return { fix: enabled ? fix : null, status: shown, stale: enabled && stale, request };
}
