import { useCallback, useEffect, useState } from 'react';

import { getTripConnectivity, type TripConnectivity } from '../services/bookingClockService';

const POLL_MS = 3000;

const NOTHING: TripConnectivity = { needsReconfirm: false, connected: false, interruptedSince: null };

/**
 * Rule 9.5: does the trip wait for the driver to say what became of it after the connection was lost? Read from the database every few seconds
 * while the trip is in progress (`active`); a failed read changes nothing. The dialog opens only when he is connected again (the database checks
 * the same thing when he answers).
 */
export const useTripConnectivity = (bookingId: string, active: boolean): TripConnectivity & { refresh: () => void } => {
  const [state, setState] = useState<TripConnectivity>(NOTHING);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!bookingId || !active) {
      setState(NOTHING);
      return;
    }
    let stopped = false;
    const read = async () => {
      const answer = await getTripConnectivity(bookingId);
      if (!stopped && answer) {
        setState((prev) => (prev.needsReconfirm === answer.needsReconfirm && prev.connected === answer.connected && prev.interruptedSince === answer.interruptedSince ? prev : answer));
      }
    };
    read();
    const timer = setInterval(read, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [bookingId, active, tick]);

  return { ...state, refresh };
};
