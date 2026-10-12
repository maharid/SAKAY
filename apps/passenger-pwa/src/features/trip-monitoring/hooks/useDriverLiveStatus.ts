import { useEffect, useRef, useState } from 'react';
import { reportNetworkOutcome } from '@sakay/shared';

import { supabase } from '../../../services/supabaseClient';

const POLL_MS = 2500;

export interface DriverLivePosition {
  lat: number;
  lng: number;
}

export interface DriverLiveStatus {
  /** The driver's position as the DATABASE has it (null until it has one, or while the trip is not live) */
  position: DriverLivePosition | null;
  /** When the database received that position (Rule 17.9: the time shown to the passenger) */
  lastFixAt: string | null;
  /**
   * How old that position is, in seconds: the database's own count at its last answer plus the time this phone has waited since (a stopwatch, never a
   * comparison of two wall clocks). Null when there is no position.
   */
  ageSeconds: number | null;
  /** Rule 9.2: no position has reached the database for 3 minutes (the passenger is told; cleared the moment the driver is heard again) */
  unreachable: boolean;
  /** Rule 9.5: the same silence during the trip (the trip stays open; the driver must re-confirm it) */
  interrupted: boolean;
  /** The database has answered at least once */
  loaded: boolean;
}

const NOTHING: DriverLiveStatus = { position: null, lastFixAt: null, ageSeconds: null, unreachable: false, interrupted: false, loaded: false };

interface LiveAnswer {
  success?: boolean;
  driver_assigned?: boolean;
  live?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  last_fix_at?: string | null;
  age_seconds?: number | null;
  unreachable_since?: string | null;
  interrupted?: boolean;
}

/**
 * The driver's position and how fresh it is, from the database (Rules 17.1, 17.9, 9.2). The driver's app also broadcasts its position every couple of
 * seconds for a smooth marker, but a broadcast says nothing about when the position was TAKEN (a frozen GPS repeats the same place with a new send
 * time) and it stops with the channel: this poll is the passenger's source for "how old is it" and the fallback for the position itself.
 * Every answer also tells the "Connection lost" notice whether this phone reaches the server.
 */
export const useDriverLiveStatus = (bookingId: string, active: boolean): DriverLiveStatus => {
  const [answer, setAnswer] = useState<DriverLiveStatus>(NOTHING);
  const [, setTick] = useState(0);
  const answeredAtRef = useRef<number>(0);          // performance.now() of the last answer
  const ageAtAnswerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!bookingId || !active) {
      setAnswer(NOTHING);
      ageAtAnswerRef.current = null;
      return;
    }
    let stopped = false;
    const read = async () => {
      const { data, error } = await supabase.rpc('get_driver_live_status', { p_booking_id: bookingId });
      reportNetworkOutcome(error);
      const row = data as LiveAnswer | null;
      if (stopped || error || !row || row.success === false) return;
      const live = Boolean(row.live);
      const hasPosition = live && typeof row.latitude === 'number' && typeof row.longitude === 'number';
      answeredAtRef.current = performance.now();
      ageAtAnswerRef.current = hasPosition && typeof row.age_seconds === 'number' ? row.age_seconds : null;
      setAnswer((prev) => {
        const sameSpot = hasPosition && prev.position && prev.position.lat === row.latitude && prev.position.lng === row.longitude;
        return {
          position: hasPosition ? (sameSpot ? prev.position : { lat: row.latitude as number, lng: row.longitude as number }) : null,
          lastFixAt: hasPosition ? row.last_fix_at ?? null : null,
          ageSeconds: ageAtAnswerRef.current,
          unreachable: live && Boolean(row.unreachable_since),
          interrupted: live && Boolean(row.interrupted),
          loaded: true,
        };
      });
    };
    read();
    const poll = setInterval(read, POLL_MS);
    // the age keeps growing between answers
    const stopwatch = setInterval(() => setTick((n) => (n + 1) % 1_000_000), 1000);
    return () => {
      stopped = true;
      clearInterval(poll);
      clearInterval(stopwatch);
    };
  }, [bookingId, active]);

  const age = answer.ageSeconds === null ? null : Math.round(answer.ageSeconds + (performance.now() - answeredAtRef.current) / 1000);
  return age === answer.ageSeconds ? answer : { ...answer, ageSeconds: age };
};
