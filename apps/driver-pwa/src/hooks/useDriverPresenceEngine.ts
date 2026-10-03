import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ACTIVE_TRIP_GPS_INTERVAL_MS,
  DRIVER_IDLE_LOCATION_INTERVAL_MS,
  LOCATION_MAX_AGE_MS,
  LOCATION_MAX_ACCURACY_METERS,
  getCurrentDevicePosition,
  watchDevicePosition,
} from '@sakay/shared';
import type { LocationCoords } from '@sakay/shared';

import {
  fetchMyPresence,
  reportLocationUnavailable,
  requestGoOffline,
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
  };
}

function toFix(coords: LocationCoords | null): PositionFix | null {
  if (!coords) return null;
  const age = coords.timestamp ? Date.now() - coords.timestamp : 0;
  // A stale fix must not be published as if it were fresh: the server stamps "now" on whatever it stores.
  if (age > LOCATION_MAX_AGE_MS) return null;
  return { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy ?? LOCATION_MAX_ACCURACY_METERS + 1, timestamp: coords.timestamp };
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

export function useDriverPresenceEngine(driverId: string | null) {
  const [presence, setPresence] = useState<PresenceView>(INITIAL_VIEW);
  const [fix, setFix] = useState<LocationCoords | null>(null);
  const [locationEnabled, setLocationEnabled] = useState<boolean>(hasStoredLocationConsent);
  const [locationReauthRequired, setLocationReauthRequired] = useState(false);
  const [offlineNotice, setOfflineNotice] = useState<{ reason: PresenceEndReason } | null>(null);
  const [dismissedReminderAt, setDismissedReminderAt] = useState<string | null>(null);

  const fixRef = useRef<LocationCoords | null>(null);
  const presenceRef = useRef<PresenceView>(INITIAL_VIEW);
  const wasOnlineRef = useRef(false);
  const reportingLossRef = useRef(false);

  useEffect(() => {
    presenceRef.current = presence;
  }, [presence]);

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
    setPresence(next);
  }, []);

  const refresh = useCallback(async () => {
    if (!driverId) return;
    const res = await fetchMyPresence();
    if (res.success) {
      applyResult(res);
    } else if (res.error_code === 'ERR_NOT_A_DRIVER') {
      // No real driver login (e.g. a demo session): never Online.
      wasOnlineRef.current = false;
      setPresence({ ...INITIAL_VIEW, status: 'offline' });
    }
  }, [driverId, applyResult]);

  // ── 1. Hydrate from the server: open, reload, return to foreground, reconnect ────────────────
  useEffect(() => {
    if (!driverId) {
      wasOnlineRef.current = false;
      setPresence(INITIAL_VIEW);
      return;
    }
    refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', refresh);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
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
        if (!stopped) applyResult(res);
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
  }, [driverId, presence.status, presence.sessionId, presence.openBooking, applyResult]);

  // ── Actions ─────────────────────────────────────────────────────────────────────────────────
  const goOnline = useCallback(async (): Promise<PresenceOutcome> => {
    if (!driverId) return { ok: false, code: 'ERR_NOT_SIGNED_IN', message: 'Not signed in.' };

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
    if (!res.success) return { ok: false, code: res.error_code || 'ERR_UNKNOWN', message: res.error || 'Could not go online.' };

    setLocationReauthRequired(false);
    setOfflineNotice(null);
    applyResult(res);
    return OK;
  }, [driverId, applyResult]);

  const goOffline = useCallback(async (): Promise<PresenceOutcome> => {
    const res = await requestGoOffline();
    if (!res.success) return { ok: false, code: res.error_code || 'ERR_UNKNOWN', message: res.error || 'Could not go offline.' };
    applyResult(res);
    return OK;
  }, [applyResult]);

  /** Called after the driver grants location in the app's own prompt. */
  const enableLocation = useCallback(() => {
    setLocationEnabled(true);
    setLocationReauthRequired(false);
  }, []);

  const dismissReminder = useCallback(() => {
    setDismissedReminderAt(presenceRef.current.reminderSentAt);
  }, []);

  const dismissOfflineNotice = useCallback(() => setOfflineNotice(null), []);

  const reminderOpen = presence.status === 'online' && !!presence.reminderSentAt && presence.reminderSentAt !== dismissedReminderAt;

  return {
    presence,
    fix,
    refresh,
    goOnline,
    goOffline,
    enableLocation,
    locationReauthRequired,
    offlineNotice,
    dismissOfflineNotice,
    reminderOpen,
    dismissReminder,
  };
}
