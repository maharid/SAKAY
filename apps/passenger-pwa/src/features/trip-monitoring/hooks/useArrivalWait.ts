import { useCallback, useEffect, useRef, useState } from 'react';
import { monotonicNow, useServerCountdown } from '@sakay/shared';

import { extendArrivalWait, readArrivalWait, type ArrivalWait } from '../../../services/arrivalWaitService';

/** The waiting time, plus the countdown drawn from the database's deadline (never from a figure restarted on each poll). */
export interface LiveArrivalWait extends ArrivalWait {
  remainingSeconds: number;
  expired: boolean;
}

const POLL_MS = 3000;

/**
 * Follows the passenger's waiting time while the driver is at the pickup. Asks the database every few seconds (so a second phone, a restart
 * or a clock that is wrong changes nothing: the database holds the deadline) and returns the extension action.
 *
 * The countdown has ONE end time per deadline (see ServerDeadlineClock in @sakay/shared): a late or overlapping answer cannot restart it, it
 * never shows a negative value, and once it has ended it stays ended until the database names a later deadline (an extension).
 *
 *   `active`   the driver has arrived
 *   `onExpire` called once when this countdown ends (the screen asks the database for the next state at once instead of waiting for its poll)
 */
export const useArrivalWait = (
  bookingId: string | undefined,
  active: boolean,
  onExpire?: () => void
): { wait: LiveArrivalWait | null; extend: () => Promise<string | null> } => {
  const live = Boolean(bookingId) && active;
  const countdown = useServerCountdown(bookingId, live, onExpire);
  const { beginRequest, apply } = countdown;
  const [latest, setLatest] = useState<{ bookingId: string; wait: ArrivalWait } | null>(null);
  const idRef = useRef<string | undefined>(undefined);

  const take = useCallback(
    (id: string, wait: ArrivalWait, request: { sequence: number; sentAt: number }) => {
      setLatest({ bookingId: id, wait });
      apply({
        sequence: request.sequence,
        sentAt: request.sentAt,
        receivedAt: monotonicNow(),
        deadlineMs: wait.deadlineMs,
        serverNowMs: wait.serverNowMs,
        secondsRemaining: wait.secondsRemaining,
      });
    },
    [apply]
  );

  useEffect(() => {
    idRef.current = bookingId;
    // (Not watching: nothing to follow. What was read before is never shown while `live` is false, and the countdown starts over when it is.)
    if (!bookingId || !active) return;
    let stopped = false;
    const poll = async () => {
      const request = beginRequest();
      const reading = await readArrivalWait(bookingId);
      if (stopped || idRef.current !== bookingId) return;
      if (reading.state === 'unavailable') return; // a failed read changes nothing: the countdown keeps running from what is known
      if (reading.state === 'idle') {
        setLatest(null); // the database says the driver is no longer waiting here (the trip started, or the booking ended)
        return;
      }
      take(bookingId, reading.wait, request);
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [bookingId, active, beginRequest, take]);

  /** Returns an error message to show, or null when the two minutes were added. */
  const extend = useCallback(async (): Promise<string | null> => {
    const id = idRef.current;
    if (!id) return null;
    const request = beginRequest();
    const result = await extendArrivalWait(id);
    if (result.error) return result.error;
    if (result.wait && idRef.current === id) take(id, result.wait, request);
    return null;
  }, [beginRequest, take]);

  const wait: LiveArrivalWait | null =
    live && bookingId && latest?.bookingId === bookingId && countdown.hasValue
      ? { ...latest.wait, remainingSeconds: countdown.remainingSeconds, expired: countdown.expired }
      : null;
  return { wait, extend };
};
