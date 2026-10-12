import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchTripEndState, type TripEndState } from '../utils/tripEnd';
import { monotonicNow } from '../utils/serverDeadlineClock';
import type { RpcCapableClient } from '../utils/restrictionUtils';
import { useServerCountdown } from './useServerCountdown';

/** How often the screens ask the database for the state of the end of the trip (nothing is kept on the phone: a second phone, a restart or a wrong clock change nothing) */
const POLL_MS = 2500;

export interface LiveTripEndState {
  state: TripEndState | null;
  /** Whole seconds of the passenger's confirmation time left, drawn from the database's deadline; null while that time is not running */
  secondsLeft: number | null;
  /** The confirmation time has ended: the driver's Payment Received is open (Rule 16.6, one timer for the fare confirmation) */
  expired: boolean;
  /** Asks the database now, and returns what it answered (null when it could not be read) */
  refresh: () => Promise<TripEndState | null>;
}

/**
 * Follows the end of the trip for ONE booking (Rules 16.6 / 18.2 / 18.3): the fare, who has answered, the payment, the dispute and the countdown of the
 * passenger's confirmation time. The countdown has one end per deadline (ServerDeadlineClock): a late or overlapping answer cannot restart it.
 *
 *   `active`   the trip is at the destination or has just ended (the screens turn it on from the booking status they already read)
 *   `onExpire` called once when the confirmation time ends (the driver's screen asks the database for the next state at once)
 */
export function useTripEndState(client: RpcCapableClient, bookingId: string | null | undefined, active: boolean, onExpire?: () => void): LiveTripEndState {
  const live = Boolean(bookingId) && active;
  const countdown = useServerCountdown(bookingId, live, onExpire);
  const { beginRequest, apply } = countdown;
  const [latest, setLatest] = useState<{ bookingId: string; state: TripEndState } | null>(null);
  const idRef = useRef<string | null | undefined>(bookingId);
  idRef.current = bookingId;
  const clientRef = useRef(client);
  clientRef.current = client;

  const read = useCallback(async (): Promise<TripEndState | null> => {
    const id = idRef.current;
    if (!id) return null;
    const request = beginRequest();
    const state = await fetchTripEndState(clientRef.current, id);
    if (!state || idRef.current !== id) return null; // a failed read changes nothing: the countdown keeps running from what is known
    setLatest({ bookingId: id, state });
    const deadlineMs = state.confirmDeadline ? Date.parse(state.confirmDeadline) : NaN;
    const serverNowMs = state.serverNow ? Date.parse(state.serverNow) : NaN;
    if (state.canConfirmFare && Number.isFinite(deadlineMs) && Number.isFinite(serverNowMs)) {
      apply({ sequence: request.sequence, sentAt: request.sentAt, receivedAt: monotonicNow(), deadlineMs, serverNowMs, secondsRemaining: state.secondsLeft });
    }
    return state;
  }, [beginRequest, apply]);

  useEffect(() => {
    if (!bookingId || !active) return;
    let stopped = false;
    const poll = () => {
      if (!stopped) void read();
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [bookingId, active, read]);

  const state = live && bookingId && latest?.bookingId === bookingId ? latest.state : null;
  const running = Boolean(state?.canConfirmFare) && countdown.hasValue;
  return { state, secondsLeft: running ? countdown.remainingSeconds : null, expired: running ? countdown.expired : false, refresh: read };
}
