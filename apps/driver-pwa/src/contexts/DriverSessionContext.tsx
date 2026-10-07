import React, { createContext, useContext, useState, useEffect, useMemo, useRef, ReactNode } from 'react';
import { supabase } from '../services/supabaseClient';
import type { BookingRecord } from '@sakay/shared';
import { DRIVER_OFFER_TIMEOUT_SECONDS, getCachedDevicePosition, type DispatchDeclineReason } from '@sakay/shared';
import type { DriverProfile } from '../mockData/driverMockData';
import { useDriverPresenceEngine } from '../hooks/useDriverPresenceEngine';
import type { PresenceOutcome, PresenceView } from '../hooks/useDriverPresenceEngine';
import type { PresenceEndReason } from '../services/driverPresenceService';

/** Fallback poll for new offers when the realtime channel misses an event (it also keeps the searches moving, see get_my_pending_offer). */
const OFFER_POLL_INTERVAL_MS = 3000;

/** While an offer is open the alert repeats this often: one beep in a pocket, or in a muted tab, can be missed (Rule 7.3). */
const OFFER_ALERT_REPEAT_MS = 5000;

/** What get_my_pending_offer answers (the database makes the offers; this app only shows the one the driver holds). */
interface PendingOfferRow {
  attempt_id: string;
  booking_id: string;
  passenger_name: string | null;
  passenger_count: number | null;
  is_shared_trip: boolean | null;
  pickup_address: string;
  pickup_latitude: number;
  pickup_longitude: number;
  dropoff_address: string;
  dropoff_latitude: number;
  dropoff_longitude: number;
  estimated_distance_km: number | null;
  estimated_fare: number | string | null;
  eta_seconds: number | null;
  distance_m: number | null;
  window_seconds: number;
  seconds_remaining: number;
  created_at: string;
}

/** How far the pickup is from the driver, as the database ranked the offer (an estimate, not a routing-engine figure). */
export interface OfferInfo {
  etaSeconds: number | null;
  distanceM: number | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DriverSessionContextType {
  profile: DriverProfile;
  setProfile: React.Dispatch<React.SetStateAction<DriverProfile>>;
  incomingRequest: BookingRecord | null;
  setIncomingRequest: React.Dispatch<React.SetStateAction<BookingRecord | null>>;
  currentAttemptId: string | null;
  setCurrentAttemptId: React.Dispatch<React.SetStateAction<string | null>>;
  countdown: number;
  setCountdown: React.Dispatch<React.SetStateAction<number>>;
  /** The pickup distance and estimated arrival the offer was ranked by. */
  offerInfo: OfferInfo | null;
  /** The driver declines with a reason (Rule 7.9): an ANSWER, never an ignored offer. False when the database could not be reached (the offer stays open). */
  handleDeclineRequest: (reason: DispatchDeclineReason) => Promise<boolean>;
  playIncomingAlert: () => void;

  // ── Presence (Batch 4): the server decides, the app only displays and requests ──
  presence: PresenceView;
  goOnline: () => Promise<PresenceOutcome>;
  goOffline: () => Promise<PresenceOutcome>;
  /** Stop receiving new booking offers for a while (Online only); the pause ends by itself. */
  pauseBookings: (minutes?: number) => Promise<PresenceOutcome>;
  resumeBookings: () => Promise<PresenceOutcome>;
  refreshPresence: () => Promise<void>;
  /** Tell the engine the driver granted location in the app's own prompt. */
  enableLocation: () => void;
  /** Location was revoked: show the re-authorization prompt before going Online again (Rule 17.7). */
  locationReauthRequired: boolean;
  /** No Supabase login session (e.g. the demo login): the database refuses Online until the driver signs in properly. */
  sessionMissing: boolean;
  /** Why the system ended the Online session (shown once). */
  offlineNotice: { reason: PresenceEndReason } | null;
  dismissOfflineNotice: () => void;
  /** The app was in the background while Online long enough that location updates probably paused (Rule 17.6). */
  backgroundNotice: { seconds: number } | null;
  dismissBackgroundNotice: () => void;
  /** Rule 7.6 reminder is due. */
  reminderOpen: boolean;
  dismissReminder: () => void;
}

const DriverSessionContext = createContext<DriverSessionContextType | undefined>(undefined);

function readStoredProfile(): DriverProfile {
  const cachedCoords = getCachedDevicePosition();
  const fallbackLat = cachedCoords ? cachedCoords.latitude : 13.4117;
  const fallbackLng = cachedCoords ? cachedCoords.longitude : 121.1803;

  const saved = localStorage.getItem('sakay_driver_profile');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      const savedLat = typeof parsed.currentLat === 'number' && parsed.currentLat !== 13.367554 ? parsed.currentLat : null;
      const savedLng = typeof parsed.currentLng === 'number' && parsed.currentLng !== 121.168617 ? parsed.currentLng : null;

      return {
        id: parsed.id || '',
        name: parsed.name || '',
        phone: parsed.phone || '',
        email: parsed.email || '',
        licenseNo: parsed.licenseNumber || parsed.licenseNo || '',
        licenseExpiry: parsed.licenseExpiry || '',
        avatarUrl: '',
        rating: typeof parsed.rating === 'number' ? parsed.rating : 5.0,
        totalTrips: typeof parsed.totalTrips === 'number' ? parsed.totalTrips : 0,
        accountStatus: parsed.accountStatus || 'Verified',
        selectedTodaId: parsed.selectedTodaId || '',
        selectedTodaIds: parsed.selectedTodaIds || (parsed.selectedTodaId ? [parsed.selectedTodaId] : []),
        selectedVehicleId: parsed.selectedVehicleId || '',
        vehiclePlate: parsed.vehiclePlate || '',
        franchiseNumber: parsed.franchiseNumber || '',
        todaName: parsed.todaName || '',
        // Never trusted from storage: the server says whether the driver is Online (see presence below).
        isOnline: false,
        isPaused: false,
        currentLat: savedLat ?? fallbackLat,
        currentLng: savedLng ?? fallbackLng,
      };
    } catch (e) {
      console.warn('Error parsing driver profile from storage:', e);
    }
  }
  return {
    id: '', name: '', phone: '', email: '', licenseNo: '', licenseExpiry: '', avatarUrl: '',
    rating: 5.0, totalTrips: 0, accountStatus: 'Verified', selectedTodaId: '', selectedTodaIds: [], selectedVehicleId: '',
    vehiclePlate: '', franchiseNumber: '', todaName: '', isOnline: false, isPaused: false,
    currentLat: fallbackLat, currentLng: fallbackLng,
  };
}

/**
 * `driverId` is the signed-in driver (null when nobody is signed in). The provider stays mounted for as long as
 * a driver is signed in, so navigating between screens never resets presence or the location watcher.
 */
export const DriverSessionProvider: React.FC<{
  driverId?: string | null;
  /** Called when the database says another device logged in after this one (Rule 29.1). */
  onSessionSuperseded?: () => void;
  children: ReactNode;
}> = ({ driverId = null, onSessionSuperseded, children }) => {
  const [profile, setProfile] = useState<DriverProfile>(readStoredProfile);

  const [incomingRequest, setIncomingRequest] = useState<BookingRecord | null>(null);
  const [currentAttemptId, setCurrentAttemptId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number>(DRIVER_OFFER_TIMEOUT_SECONDS);
  const [offerInfo, setOfferInfo] = useState<OfferInfo | null>(null);

  const engine = useDriverPresenceEngine(driverId, onSessionSuperseded);
  const { presence, fix } = engine;
  const isOnline = presence.status === 'online';

  // A different driver signed in (or out): start from that driver's stored profile.
  const lastDriverIdRef = useRef<string | null>(driverId);
  useEffect(() => {
    if (lastDriverIdRef.current === driverId) return;
    lastDriverIdRef.current = driverId;
    setProfile(readStoredProfile());
  }, [driverId]);

  // Save profile changes (only for a signed-in driver; the login screens must not get a stray profile)
  useEffect(() => {
    if (!driverId) return;
    localStorage.setItem('sakay_driver_profile', JSON.stringify(profile));
  }, [profile, driverId]);

  // "Online" shown anywhere in the app is the server's answer, whatever a screen writes with setProfile.
  // Paused is the server's answer too (the pause ends by itself, so a time already past counts as not paused).
  const isPaused = isOnline && !!presence.pausedUntil && Date.parse(presence.pausedUntil) > Date.now();
  const exposedProfile = useMemo<DriverProfile>(() => ({ ...profile, isOnline, isPaused }), [profile, isOnline, isPaused]);

  // The engine's single watcher feeds the map position (local state only; the heartbeat is the only publisher).
  useEffect(() => {
    if (!fix) return;
    setProfile((prev) => ({ ...prev, currentLat: fix.latitude, currentLng: fix.longitude }));
  }, [fix]);

  const playIncomingAlert = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime);
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      }
      if ('vibrate' in navigator) {
        navigator.vibrate([200, 100, 200]);
      }
    } catch {}
  };

  // ── Offers ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // The DATABASE makes the offers, times them out and moves on to the next driver. This screen only shows the one offer this driver holds
  // (get_my_pending_offer: one call, with the seconds that are really left) and sends the driver's answer. Nothing here writes an offer.
  const incomingRequestRef = useRef<BookingRecord | null>(incomingRequest);
  const currentAttemptIdRef = useRef<string | null>(currentAttemptId);
  useEffect(() => {
    incomingRequestRef.current = incomingRequest;
  }, [incomingRequest]);
  useEffect(() => {
    currentAttemptIdRef.current = currentAttemptId;
  }, [currentAttemptId]);

  /** The offer is over (answered, ran out, or taken back): clear it from the screen. */
  const clearOffer = () => {
    setIncomingRequest(null);
    setCurrentAttemptId(null);
    setOfferInfo(null);
  };

  // Explicit decline: the driver answers with a reason (Rule 7.9). The database records the answer, no strike, and offers the booking to the next driver at once.
  const handleDeclineRequest = async (reason: DispatchDeclineReason): Promise<boolean> => {
    const attemptId = currentAttemptId;
    if (!attemptId) return false;
    const { data, error } = await supabase.rpc('decline_booking_offer', { p_attempt_id: attemptId, p_reason: reason });
    if (error && !data) {
      console.warn('Failed to decline the offer:', error.message);
      return false;                       // the database could not be reached: the offer stays open and the driver can try again
    }
    // Declined, or the offer was already closed (it ran out, was taken or withdrawn): either way it is gone from this screen.
    clearOffer();
    engine.refresh();
    return true;
  };

  // The countdown on the screen. The database's number of seconds is the truth; at zero the offer simply leaves this screen (the database closes it).
  useEffect(() => {
    if (!incomingRequest) return;
    if (countdown <= 0) {
      clearOffer();
      engine.refresh();
      return;
    }
    const timer = setInterval(() => setCountdown((prev) => prev - 1), 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingRequest, countdown]);

  // Audible alert on a new offer (Rule 7.3), repeated while it is open, with vibration where the phone has it.
  useEffect(() => {
    if (!currentAttemptId) return;
    playIncomingAlert();
    const repeat = setInterval(playIncomingAlert, OFFER_ALERT_REPEAT_MS);
    return () => clearInterval(repeat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAttemptId]);

  const offerDriverId = UUID_PATTERN.test(profile.id) ? profile.id : (driverId && UUID_PATTERN.test(driverId) ? driverId : null);

  useEffect(() => {
    if (!isOnline || !offerDriverId) {
      if (incomingRequestRef.current) {
        setIncomingRequest(null);
        setCurrentAttemptId(null);
        setOfferInfo(null);
      }
      return;
    }

    let stopped = false;
    const fetchOffer = async () => {
      const { data, error } = await supabase.rpc('get_my_pending_offer');
      if (stopped) return;
      if (error) {
        console.warn('[DriverSessionContext] get_my_pending_offer note:', error.message);
        return;
      }
      const offer = data as PendingOfferRow | null;
      if (!offer) {
        // No offer is open for this driver any more (answered, ran out, withdrawn): make sure the screen agrees.
        if (incomingRequestRef.current) {
          setIncomingRequest(null);
          setCurrentAttemptId(null);
          setOfferInfo(null);
        }
        return;
      }
      if (currentAttemptIdRef.current === offer.attempt_id) return;          // the same offer: the countdown keeps running

      const mapped: BookingRecord = {
        booking_id: offer.booking_id,
        passenger_id: '',
        passenger_name: offer.passenger_name || 'Passenger',
        passenger_phone: '',                                                 // the phone stays hidden until the driver accepts
        booking_type: 'Immediate',
        is_shared_trip: Boolean(offer.is_shared_trip),
        passenger_count: offer.passenger_count || 1,
        pickup_address: offer.pickup_address,
        pickup_latitude: offer.pickup_latitude,
        pickup_longitude: offer.pickup_longitude,
        dropoff_address: offer.dropoff_address,
        dropoff_latitude: offer.dropoff_latitude,
        dropoff_longitude: offer.dropoff_longitude,
        estimated_distance_km: offer.estimated_distance_km || 1,
        estimated_fare: Number(offer.estimated_fare) || 0,
        booking_status: 'Pending',
        created_at: offer.created_at,
        updated_at: offer.created_at,
      };
      setCurrentAttemptId(offer.attempt_id);
      setIncomingRequest(mapped);
      setCountdown(Math.max(0, Number(offer.seconds_remaining)));
      setOfferInfo({ etaSeconds: offer.eta_seconds, distanceM: offer.distance_m });
    };

    fetchOffer();
    const interval = setInterval(fetchOffer, OFFER_POLL_INTERVAL_MS);

    // The offer row is pushed too (the table is in the realtime publication), so an offer reaches the phone at once; the poll recovers a missed event.
    const channel = supabase
      .channel(`driver_offers_${offerDriverId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dispatch_attempt', filter: `driver_id=eq.${offerDriverId}` }, () => {
        fetchOffer();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dispatch_attempt', filter: `driver_id=eq.${offerDriverId}` }, () => {
        fetchOffer();
      })
      .subscribe();

    return () => {
      stopped = true;
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [isOnline, offerDriverId]);

  return (
    <DriverSessionContext.Provider
      value={{
        profile: exposedProfile,
        setProfile,
        incomingRequest,
        setIncomingRequest,
        currentAttemptId,
        setCurrentAttemptId,
        countdown,
        setCountdown,
        offerInfo,
        handleDeclineRequest,
        playIncomingAlert,
        presence,
        goOnline: engine.goOnline,
        goOffline: engine.goOffline,
        pauseBookings: engine.pauseBookings,
        resumeBookings: engine.resumeBookings,
        refreshPresence: engine.refresh,
        enableLocation: engine.enableLocation,
        locationReauthRequired: engine.locationReauthRequired,
        sessionMissing: engine.sessionMissing,
        offlineNotice: engine.offlineNotice,
        dismissOfflineNotice: engine.dismissOfflineNotice,
        backgroundNotice: engine.backgroundNotice,
        dismissBackgroundNotice: engine.dismissBackgroundNotice,
        reminderOpen: engine.reminderOpen,
        dismissReminder: engine.dismissReminder,
      }}
    >
      {children}
    </DriverSessionContext.Provider>
  );
};

export const useDriverSession = () => {
  const context = useContext(DriverSessionContext);
  if (!context) {
    throw new Error('useDriverSession must be used within a DriverSessionProvider');
  }
  return context;
};
