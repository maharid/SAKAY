import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ACTIVE_TRIP_GPS_INTERVAL_MS,
  DRIVER_BACKGROUND_WARNING_AFTER_SECONDS,
  DRIVER_IDLE_LOCATION_INTERVAL_MS,
  LOCATION_MAX_AGE_MS,
  LOCATION_MAX_ACCURACY_METERS,
  getCurrentDevicePosition,
  watchDevicePosition,
} from '@sakay/shared';
import type { LocationCoords } from '@sakay/shared';

import { supabase } from '../services/supabaseClient';
import {
  fetchMyPresence,
  reportLocationUnavailable,
  requestGoOffline,
  requestPauseBookings,
  requestResumeBookings,
  requestGoOnline,
  sendHeartbeat,
} from '../services/driverPresenceService';
import type { PositionFix, PresenceEndReason, PresenceResult } from '../services/driverPresenceService';

/**
 * Driver presence engine (Batch 4).
 *
 * The server is the only source of truth for "Online". This hook:
 *  - hydrates the state from the server on open, on return to the foreground and on reconnect;
 *  - keeps exactly ONE location watcher for the whole app session;
 *  - publishes position through ONE timer (the heartbeat) and only while Online;
 *  - reacts to location permission being revoked (Rule 17.7);
 *  - exposes the Rule 7.6 reminder and the reason a session was ended by the system.
 */

export type PresenceStatus = 'unknown' | 'online' | 'offline';

export interface PresenceView {
  status: PresenceStatus;
  sessionId: string | null;
  openBooking: boolean;
  unansweredStreak: number;
  reminderSentAt: string | null;
  pendingOfflineReason: string | null;
  lastEnd: { reason: PresenceEndReason; endedAt: string } | null;
  activeTodaId: string | null;
  activeAffiliationId: string | null;
  /** When the driver's pause on new bookings ends (null = receiving bookings) */
  pausedUntil: string | null;
}

/** Flat on purpose: the driver app compiles with strict off, where a true/false union does not narrow. */
export interface PresenceOutcome {
  ok: boolean;
  /** Empty on success; otherwise the database's error code (ERR_*) or ERR_NETWORK. */
  code: string;
  message: string;
}

const OK: PresenceOutcome = { ok: true, code: '', message: '' };

const INITIAL_VIEW: PresenceView = {
  status: 'unknown',
  sessionId: null,
  openBooking: false,
  unansweredStreak: 0,
  reminderSentAt: null,
  pendingOfflineReason: null,
  lastEnd: null,
  activeTodaId: null,
  activeAffiliationId: null,
  pausedUntil: null,
};

const PERMISSION_DENIED_CODE = 1;
const REPORT_RETRY_DELAY_MS = 3000;
const REPORT_MAX_ATTEMPTS = 3;

function toView(res: PresenceResult): PresenceView {
  return {
    status: res.online ? 'online' : 'offline',
    sessionId: res.session?.session_id ?? null,
    openBooking: !!res.open_booking,
    unansweredStreak: res.session?.unanswered_streak ?? 0,
    reminderSentAt: res.session?.reminder_sent_at ?? null,
    pendingOfflineReason: res.session?.offline_pending_reason ?? null,
    lastEnd: res.last_session_end ? { reason: res.last_session_end.reason, endedAt: res.last_session_end.ended_at } : null,
    activeTodaId: res.active_toda_id ?? null,
    activeAffiliationId: res.active_affiliation_id ?? null,
    pausedUntil: res.bookings_paused_until ?? null,
  };
}

function toFix(coords: LocationCoords | null): PositionFix | null {
  if (!coords) return null;
  const age = coords.timestamp ? Date.now() - coords.timestamp : 0;
  // A stale fix must not be published as if it were fresh: the server stamps "now" on whatever it stores.
  if (age > LOCATION_MAX_AGE_MS) return null;
  return { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy ?? LOCATION_MAX_ACCURACY_METERS + 1, timestamp: coords.timestamp };
}

/**
 * Which reminder the driver already dismissed (its timestamp), kept for the browser tab so a page reload does not
 * show the same Rule 7.6 reminder again. A NEW reminder has a new timestamp and is shown.
 */
const REMINDER_DISMISSED_KEY = 'sakay_driver_reminder_dismissed';

function readDismissedReminder(): string | null {
  try {
    return sessionStorage.getItem(REMINDER_DISMISSED_KEY);
  } catch {
    return null;
  }
}

function writeDismissedReminder(reminderSentAt: string | null): void {
  try {
    if (reminderSentAt) sessionStorage.setItem(REMINDER_DISMISSED_KEY, reminderSentAt);
  } catch {
    // Storage unavailable: the reminder simply reappears after a reload.
  }
}

function hasStoredLocationConsent(): boolean {
  try {
    const stored = localStorage.getItem('sakay_driver_location_permission');
    const prompted = localStorage.getItem('sakay_driver_location_prompted') === 'true';
    if (stored === 'denied') return false;
    return stored === 'always' || stored === 'once' || prompted;
  } catch {
    return false;
  }
}

/**
 * `onSessionSuperseded` is called when the database says another device has logged in since this one
 * (Rule 29.1); the caller signs this device out.
 */
export function useDriverPresenceEngine(driverId: string | null, onSessionSuperseded?: () => void) {
  const [presence, setPresence] = useState<PresenceView>(INITIAL_VIEW);
  const [fix, setFix] = useState<LocationCoords | null>(null);
  const [locationEnabled, setLocationEnabled] = useState<boolean>(hasStoredLocationConsent);
  const [locationReauthRequired, setLocationReauthRequired] = useState(false);
  const [offlineNotice, setOfflineNotice] = useState<{ reason: PresenceEndReason } | null>(null);
  const [dismissedReminderAt, setDismissedReminderAt] = useState<string | null>(readDismissedReminder);
  // True when the app has no Supabase login session (e.g. the demo login): the database refuses every presence call.
  const [sessionMissing, setSessionMissing] = useState(false);

  // Set when the app returns from the background after long enough that location updates were probably paused (17.6).
  const [backgroundNotice, setBackgroundNotice] = useState<{ seconds: number } | null>(null);

  const fixRef = useRef<LocationCoords | null>(null);
  const presenceRef = useRef<PresenceView>(INITIAL_VIEW);
  const wasOnlineRef = useRef(false);
  const reportingLossRef = useRef(false);
  const hiddenAtRef = useRef<number | null>(null);
  const onSupersededRef = useRef(onSessionSuperseded);

  useEffect(() => {
    presenceRef.current = presence;
  }, [presence]);
  useEffect(() => {
    onSupersededRef.current = onSessionSuperseded;
  }, [onSessionSuperseded]);

  // Apply a server answer. Only successful answers change the view; a network failure keeps the last known state.
  const applyResult = useCallback((res: PresenceResult) => {
    if (!res.success) return;
    const next = toView(res);
    const online = next.status === 'online';
    if (wasOnlineRef.current && !online) {
      const reason = next.lastEnd?.reason;
      if (reason && reason !== 'manual') setOfflineNotice({ reason });
      if (reason === 'location_permission_revoked') setLocationReauthRequired(true);
    }
    wasOnlineRef.current = online;
    presenceRef.current = next;
    setPresence(next);
  }, []);

  // Another device logged in after this one (Rule 29.1): this device may no longer act. Stop showing Online here
  // (the driver's real state on the server is untouched) and let the caller sign this device out.
  const handleSuperseded = useCallback(() => {
    wasOnlineRef.current = false;
    presenceRef.current = { ...INITIAL_VIEW, status: 'offline' };
    setPresence(presenceRef.current);
    onSupersededRef.current?.();
  }, []);

  const refresh = useCallback(async () => {
    if (!driverId) return;
    const res = await fetchMyPresence();
    if (res.success) {
      setSessionMissing(false);
      applyResult(res);
    } else if (res.error_code === 'ERR_SESSION_SUPERSEDED') {
      handleSuperseded();
    } else if (res.error_code === 'ERR_NOT_A_DRIVER') {
      // Signed in, but not as a driver: never Online.
      wasOnlineRef.current = false;
      setPresence({ ...INITIAL_VIEW, status: 'offline' });
    } else {
      // Refused or unreachable. Without a login session the database answers 401 to every presence call, so say so
      // instead of leaving the screen waiting forever. A real network failure keeps the last known state.
      const { data } = await supabase.auth.getSession();
      if (!data?.session) {
        wasOnlineRef.current = false;
        setSessionMissing(true);
        setPresence({ ...INITIAL_VIEW, status: 'offline' });
      }
    }
  }, [driverId, applyResult, handleSuperseded]);

  // ── 1. Hydrate from the server: open, reload, return to foreground, reconnect ────────────────
  // Also Rule 17.6: the page is suspended while it is hidden, so the driver can only be warned on return.
  useEffect(() => {
    if (!driverId) {
      wasOnlineRef.current = false;
      setPresence(INITIAL_VIEW);
      return;
    }
    refresh();
    const onVisibilityChange = async () => {
      if (document.visibilityState === 'hidden') {
        if (presenceRef.current.status === 'online') hiddenAtRef.current = Date.now();
        return;
      }
      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      await refresh();
      // Only warn if the server still has the driver Online (otherwise the "set Offline" notice already explains).
      if (hiddenAt && presenceRef.current.status === 'online') {
        const seconds = Math.round((Date.now() - hiddenAt) / 1000);
        if (seconds >= DRIVER_BACKGROUND_WARNING_AFTER_SECONDS) setBackgroundNotice({ seconds });
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', refresh);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', refresh);
    };
  }, [driverId, refresh]);

  // ── 2. Permission loss (Rule 17.7) ──────────────────────────────────────────────────────────
  const handlePermissionLost = useCallback(async (detail: string) => {
    setLocationReauthRequired(true);
    if (presenceRef.current.status !== 'online' || reportingLossRef.current) return;
    reportingLossRef.current = true;
    try {
      for (let attempt = 0; attempt < REPORT_MAX_ATTEMPTS; attempt++) {
        const res = await reportLocationUnavailable(detail);
        if (res.success) {
          applyResult(res);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, REPORT_RETRY_DELAY_MS));
      }
    } finally {
      reportingLossRef.current = false;
    }
  }, [applyResult]);

  useEffect(() => {
    if (!driverId || !navigator.permissions?.query) return;
    let status: PermissionStatus | null = null;
    let cancelled = false;
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((result) => {
        if (cancelled) return;
        status = result;
        if (result.state === 'granted') setLocationEnabled(true);
        result.onchange = () => {
          if (result.state === 'denied') handlePermissionLost('Browser location permission was changed to denied');
          else if (result.state === 'granted') setLocationEnabled(true);
        };
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (status) status.onchange = null;
    };
  }, [driverId, handlePermissionLost]);

  // ── 3. The one location watcher for the app session (local state only; it never writes to the database) ─
  useEffect(() => {
    if (!driverId || !locationEnabled) return;
    const watchId = watchDevicePosition(
      (coords) => {
        fixRef.current = coords;
        setFix(coords);
      },
      (err) => {
        if (err.code === PERMISSION_DENIED_CODE) handlePermissionLost('Location watch reported permission denied');
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
    );
    return () => {
      if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    };
  }, [driverId, locationEnabled, handlePermissionLost]);

  // ── 4. The one publisher: a heartbeat timer that exists only while Online ───────────────────
  useEffect(() => {
    if (!driverId || presence.status !== 'online') return;
    const intervalMs = presence.openBooking ? ACTIVE_TRIP_GPS_INTERVAL_MS : DRIVER_IDLE_LOCATION_INTERVAL_MS;
    let stopped = false;
    let inFlight = false;

    const beat = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const res = await sendHeartbeat(toFix(fixRef.current));
        if (stopped) return;
        if (res.error_code === 'ERR_SESSION_SUPERSEDED') handleSuperseded();
        else applyResult(res);
      } finally {
        inFlight = false;
      }
    };

    beat();
    const timer = setInterval(beat, intervalMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [driverId, presence.status, presence.sessionId, presence.openBooking, applyResult, handleSuperseded]);

  // ── Actions ─────────────────────────────────────────────────────────────────────────────────
  const goOnline = useCallback(async (): Promise<PresenceOutcome> => {
    if (!driverId) return { ok: false, code: 'ERR_NOT_SIGNED_IN', message: 'Not signed in.' };
    const { data: auth } = await supabase.auth.getSession();
    if (!auth?.session) {
      setSessionMissing(true);
      return { ok: false, code: 'ERR_NO_SESSION', message: 'No login session.' };
    }

    try {
      const perm = await navigator.permissions?.query({ name: 'geolocation' });
      if (perm?.state === 'denied') {
        setLocationReauthRequired(true);
        return { ok: false, code: 'ERR_LOCATION_DENIED', message: 'Location permission is off.' };
      }
    } catch {
      // Permissions API not available: the position request below decides.
    }

    // Prefer the watcher's latest fix when it is fresh and accurate; otherwise ask for a new one.
    let coords = fixRef.current;
    const usable = coords !== null && toFix(coords) !== null && (coords.accuracy ?? Infinity) <= LOCATION_MAX_ACCURACY_METERS;
    if (!usable) {
      try {
        coords = await getCurrentDevicePosition();
        fixRef.current = coords;
        setFix(coords);
        setLocationEnabled(true);
      } catch (err) {
        const denied = (err as { code?: number }).code === PERMISSION_DENIED_CODE;
        if (denied) setLocationReauthRequired(true);
        return {
          ok: false,
          code: denied ? 'ERR_LOCATION_DENIED' : 'ERR_LOCATION_REQUIRED',
          message: err instanceof Error ? err.message : 'Could not get your location.',
        };
      }
    }
    if (!coords) return { ok: false, code: 'ERR_LOCATION_REQUIRED', message: 'Could not get your location.' };

    const res = await requestGoOnline({
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy ?? LOCATION_MAX_ACCURACY_METERS + 1,
      timestamp: coords.timestamp,
    });
    if (!res.success) {
      if (res.error_code === 'ERR_SESSION_SUPERSEDED') handleSuperseded();
      return { ok: false, code: res.error_code || 'ERR_UNKNOWN', message: res.error || 'Could not go online.' };
    }

    setLocationReauthRequired(false);
    setOfflineNotice(null);
    applyResult(res);
    return OK;
  }, [driverId, applyResult, handleSuperseded]);

  const goOffline = useCallback(async (): Promise<PresenceOutcome> => {
    const res = await requestGoOffline();
    if (!res.success) return { ok: false, code: res.error_code || 'ERR_UNKNOWN', message: res.error || 'Could not go offline.' };
    applyResult(res);
    return OK;
  }, [applyResult]);

  // Pause / resume new bookings (checklist: Manage Availability). The database decides; the view takes its answer.
  const pauseBookings = useCallback(async (minutes?: number): Promise<PresenceOutcome> => {
    const res = await requestPauseBookings(minutes);
    if (!res.success) return { ok: false, code: res.error_code || 'ERR_UNKNOWN', message: res.error || 'Could not pause bookings.' };
    applyResult(res);
    return OK;
  }, [applyResult]);

  const resumeBookings = useCallback(async (): Promise<PresenceOutcome> => {
    const res = await requestResumeBookings();
    if (!res.success) return { ok: false, code: res.error_code || 'ERR_UNKNOWN', message: res.error || 'Could not resume bookings.' };
    applyResult(res);
    return OK;
  }, [applyResult]);

  /** Called after the driver grants location in the app's own prompt. */
  const enableLocation = useCallback(() => {
    setLocationEnabled(true);
    setLocationReauthRequired(false);
  }, []);

  const dismissReminder = useCallback(() => {
    const sentAt = presenceRef.current.reminderSentAt;
    writeDismissedReminder(sentAt);
    setDismissedReminderAt(sentAt);
  }, []);

  const dismissOfflineNotice = useCallback(() => setOfflineNotice(null), []);
  const dismissBackgroundNotice = useCallback(() => setBackgroundNotice(null), []);

  // Not during a booking: a driver on a trip is busy, not "unavailable" (the database does not count offers then either).
  const reminderOpen = presence.status === 'online' && !presence.openBooking
    && !!presence.reminderSentAt && presence.reminderSentAt !== dismissedReminderAt;

  return {
    presence,
    fix,
    refresh,
    goOnline,
    goOffline,
    pauseBookings,
    resumeBookings,
    enableLocation,
    locationReauthRequired,
    sessionMissing,
    offlineNotice,
    dismissOfflineNotice,
    backgroundNotice,
    dismissBackgroundNotice,
    reminderOpen,
    dismissReminder,
  };
}
