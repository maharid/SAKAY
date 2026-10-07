import { useCallback, useEffect, useRef, useState } from 'react';

import { extendArrivalWait, getArrivalWait, type ArrivalWait } from '../../../services/arrivalWaitService';

/** The waiting time, plus the moment (on THIS phone's clock) it will run out, computed from the seconds the database reported. */
export interface LiveArrivalWait extends ArrivalWait {
  endsAt: number;
}

const POLL_MS = 3000;

/**
 * Follows the passenger's waiting time while the driver is at the pickup. Asks the database every few seconds (so a second phone, a restart
 * or a clock that is wrong changes nothing: the database counted the seconds) and returns the extension action. `active` = the driver has arrived.
 */
export const useArrivalWait = (bookingId: string | undefined, active: boolean): { wait: LiveArrivalWait | null; extend: () => Promise<string | null> } => {
  const [latest, setLatest] = useState<{ bookingId: string; wait: LiveArrivalWait | null } | null>(null);
  const idRef = useRef<string | undefined>(undefined);

  const apply = useCallback((id: string, answer: ArrivalWait | null) => {
    setLatest({ bookingId: id, wait: answer ? { ...answer, endsAt: Date.now() + answer.secondsRemaining * 1000 } : null });
  }, []);

  useEffect(() => {
    idRef.current = bookingId;
    if (!bookingId || !active) return;
    let stopped = false;
    const tick = async () => {
      const answer = await getArrivalWait(bookingId);
      if (!stopped && idRef.current === bookingId) apply(bookingId, answer);
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [bookingId, active, apply]);

  /** Returns an error message to show, or null when the two minutes were added. */
  const extend = useCallback(async (): Promise<string | null> => {
    const id = idRef.current;
    if (!id) return null;
    const result = await extendArrivalWait(id);
    if (result.error) return result.error;
    apply(id, result.wait);
    return null;
  }, [apply]);

  return { wait: active && bookingId && latest?.bookingId === bookingId ? latest.wait : null, extend };
};
