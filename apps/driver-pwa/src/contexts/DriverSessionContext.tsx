import React, { createContext, useContext, useState, useEffect, useMemo, useRef, ReactNode } from 'react';
import { supabase } from '../services/supabaseClient';
import type { BookingRecord } from '@sakay/shared';
import { DRIVER_OFFER_TIMEOUT_SECONDS, getCachedDevicePosition } from '@sakay/shared';
import type { DriverProfile } from '../mockData/driverMockData';
import { useDriverPresenceEngine } from '../hooks/useDriverPresenceEngine';
import type { PresenceOutcome, PresenceView } from '../hooks/useDriverPresenceEngine';
import type { PresenceEndReason } from '../services/driverPresenceService';

/** Fallback poll for new offers when the realtime channel misses an event. */
const OFFER_POLL_INTERVAL_MS = 3000;

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
  declinedBookings: Set<string>;
  setDeclinedBookings: React.Dispatch<React.SetStateAction<Set<string>>>;
  /** The driver pressed Decline (counts as an answer). */
  handleDeclineRequest: () => void;
  /** The offer window ended with no answer (counts as unanswered, Rule 7.6). */
  handleOfferTimeout: () => void;
  playIncomingAlert: () => void;

  // ── Presence (Batch 4): the server decides, the app only displays and requests ──
  presence: PresenceView;
  goOnline: () => Promise<PresenceOutcome>;
  goOffline: () => Promise<PresenceOutcome>;
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
  const [declinedBookings, setDeclinedBookings] = useState<Set<string>>(new Set());

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
  const exposedProfile = useMemo<DriverProfile>(() => ({ ...profile, isOnline, isPaused: false }), [profile, isOnline]);

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

  const closeOffer = (bookingId: string) => {
    setDeclinedBookings((prev) => {
      const updated = new Set(prev);
      updated.add(bookingId);
      return updated;
    });
    setIncomingRequest(null);
    setCurrentAttemptId(null);
  };

  // Explicit decline: the driver answered. responded_at is what tells the database it was an answer.
  const handleDeclineRequest = async () => {
    if (!incomingRequest) return;
    const bookingId = incomingRequest.booking_id;
    const attemptId = currentAttemptId;
    closeOffer(bookingId);

    if (attemptId) {
      try {
        await supabase
          .from('dispatch_attempt')
          .update({ response_status: 'Declined', responded_at: new Date().toISOString() })
          .eq('attempt_id', attemptId)
          .eq('response_status', 'Pending');
      } catch (err) {
        console.warn('Failed to decline attempt:', err);
      }
    }
    engine.refresh();
  };

  // The window ended with no answer: recorded WITHOUT responded_at, so the database counts it as unanswered.
  const handleOfferTimeout = async () => {
    if (!incomingRequest) return;
    const bookingId = incomingRequest.booking_id;
    const attemptId = currentAttemptId;
    closeOffer(bookingId);

    if (attemptId) {
      try {
        await supabase
          .from('dispatch_attempt')
          .update({ response_status: 'Declined' })
          .eq('attempt_id', attemptId)
          .eq('response_status', 'Pending');
      } catch (err) {
        console.warn('Failed to record offer timeout:', err);
      }
    }
    engine.refresh();
  };

  // Countdown Timer
  useEffect(() => {
    if (!incomingRequest) return;
    if (countdown <= 0) {
      handleOfferTimeout();
      return;
    }
    const timer = setInterval(() => setCountdown((prev) => prev - 1), 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingRequest, countdown]);

  // Realtime Dispatch Listener (this driver's offers only)
  const incomingRequestRef = useRef<BookingRecord | null>(incomingRequest);
  const declinedBookingsRef = useRef<Set<string>>(declinedBookings);
  useEffect(() => {
    incomingRequestRef.current = incomingRequest;
  }, [incomingRequest]);
  useEffect(() => {
    declinedBookingsRef.current = declinedBookings;
  }, [declinedBookings]);

  const offerDriverId = UUID_PATTERN.test(profile.id) ? profile.id : (driverId && UUID_PATTERN.test(driverId) ? driverId : null);

  useEffect(() => {
    if (!isOnline || !offerDriverId) {
      if (incomingRequestRef.current) {
        setIncomingRequest(null);
        setCurrentAttemptId(null);
      }
      return;
    }

    const fetchPendingAttempt = async () => {
      const { data: attempt, error: attemptError } = await supabase
        .from('dispatch_attempt')
        .select('*')
        .eq('driver_id', offerDriverId)
        .eq('response_status', 'Pending')
        .order('notification_sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (attemptError) {
        console.warn('[DriverSessionContext] fetchPendingAttempt note:', attemptError.message);
        return;
      }

      if (attempt && !incomingRequestRef.current && !declinedBookingsRef.current.has(attempt.booking_id)) {
        // Fetch booking details
        const { data, error: bookingError } = await supabase
          .from('booking')
          .select('*, passenger:passenger_id(*)')
          .eq('booking_id', attempt.booking_id)
          .single();

        if (bookingError) {
          console.warn('[DriverSessionContext] fetchBooking note:', bookingError.message);
          return;
        }

        // Only pop up if booking is actually still pending/searching
        if (data && (data.booking_status === 'Pending' || data.booking_status === 'Searching Driver')) {
          const p = Array.isArray(data.passenger) ? data.passenger[0] : data.passenger;
          const mapped: BookingRecord = {
            booking_id: data.booking_id,
            passenger_id: data.passenger_id || 'passenger-demo',
            passenger_name: data.passenger_name || p?.full_name || 'Passenger',
            passenger_phone: p?.contact_number || data.passenger_phone || '+63 917 123 4567',
            booking_type: data.booking_type || 'Immediate',
            is_shared_trip: Boolean(data.is_shared_trip),
            passenger_count: data.passenger_count || 1,
            pickup_address: data.pickup_address,
            pickup_latitude: data.pickup_latitude,
            pickup_longitude: data.pickup_longitude,
            dropoff_address: data.dropoff_address,
            dropoff_latitude: data.dropoff_latitude,
            dropoff_longitude: data.dropoff_longitude,
            estimated_distance_km: data.estimated_distance_km || 1,
            estimated_fare: data.estimated_fare || 20,
            booking_status: 'Pending',
            created_at: data.created_at,
            updated_at: data.created_at,
          };

          setCurrentAttemptId(attempt.attempt_id);
          setIncomingRequest(mapped);
          setCountdown(DRIVER_OFFER_TIMEOUT_SECONDS);
          playIncomingAlert();
        } else if (data && data.booking_status !== 'Pending' && data.booking_status !== 'Searching Driver') {
          // Booking was cancelled or completed while attempt was in flight; mark attempt Expired
          await supabase.from('dispatch_attempt').update({ response_status: 'Expired', responded_at: new Date().toISOString() }).eq('attempt_id', attempt.attempt_id).eq('response_status', 'Pending');
        }
      }
    };

    fetchPendingAttempt();
    const interval = setInterval(fetchPendingAttempt, OFFER_POLL_INTERVAL_MS);

    const channel = supabase
      .channel(`driver_offers_${offerDriverId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'dispatch_attempt', filter: `driver_id=eq.${offerDriverId}` },
        () => {
          fetchPendingAttempt();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'dispatch_attempt', filter: `driver_id=eq.${offerDriverId}` },
        () => {
          fetchPendingAttempt();
        }
      )
      .subscribe();

    return () => {
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
        declinedBookings,
        setDeclinedBookings,
        handleDeclineRequest,
        handleOfferTimeout,
        playIncomingAlert,
        presence,
        goOnline: engine.goOnline,
        goOffline: engine.goOffline,
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
