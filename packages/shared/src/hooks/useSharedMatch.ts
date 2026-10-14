import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchSharedMatchState, respondSharedMatch, type SharedMatchView } from '../utils/sharedMatch';
import { monotonicNow } from '../utils/serverDeadlineClock';
import type { RpcCapableClient } from '../utils/restrictionUtils';

/** How often a passenger's screen asks the database where the pairing of the booking stands (nothing is kept on the phone: the database is the only truth) */
const POLL_MS = 2500;

export interface LiveSharedMatch {
  view: SharedMatchView | null;
  /** Whole seconds left to answer the first passenger's consent (Rule 14.5), counted down from the database's figure; null while no answer is awaited */
  secondsLeft: number | null;
  /** Asks the database now (after an answer), and returns what it said (null when it could not be read) */
  refresh: () => Promise<SharedMatchView | null>;
  /** Accept Shared Match (true) / Decline Shared Match (false) for the match this booking is asked about; a second tap while one is being saved is ignored */
  respond: (accept: boolean) => Promise<void>;
  /** An answer is being saved */
  busy: boolean;
  /** The database's own sentence when the last answer was refused (too late, no longer open...), else null */
  error: string | null;
}

/**
 * Follows the ride-sharing state of ONE booking (Rules 14.2.1, 14.5, 6.5): whether matching is still open, whether a second passenger is being asked, and - only
 * while a match awaits consent or is confirmed - the limited facts about the other passenger. `active` turns it on while the booking is searching, assigned, at
 * the pickup or under way. The answer is the database's; this hook adds no rule.
 */
export function useSharedMatch(client: RpcCapableClient, bookingId: string | null | undefined, active: boolean): LiveSharedMatch {
  const [latest, setLatest] = useState<{ bookingId: string; view: SharedMatchView; receivedAt: number } | null>(null);
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const idRef = useRef<string | null | undefined>(bookingId);
  idRef.current = bookingId;
  const clientRef = useRef(client);
  clientRef.current = client;

  const read = useCallback(async (): Promise<SharedMatchView | null> => {
    const id = idRef.current;
    if (!id) return null;
    const view = await fetchSharedMatchState(clientRef.current, id);
    if (!view || idRef.current !== id) return null;          // a failed read changes nothing: the last answer stays on the screen
    setLatest({ bookingId: id, view, receivedAt: monotonicNow() });
    return view;
  }, []);

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

  const current = active && bookingId && latest?.bookingId === bookingId ? latest : null;
  const waiting = current !== null && current.view.secondsRemaining !== null && current.view.state === 'awaiting_my_consent';
  // one tick a second only while a consent is being awaited
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setTick((n) => (n + 1) % 1_000_000), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  const secondsLeft = waiting && current
    ? Math.max(0, Math.round((current.view.secondsRemaining as number) - (monotonicNow() - current.receivedAt) / 1000))
    : null;
  const matchId = current ? current.view.matchId : null;
  const respond = useCallback(
    async (accept: boolean): Promise<void> => {
      if (!matchId || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      const result = await respondSharedMatch(clientRef.current, matchId, accept);
      if (!result.ok) setError(result.error);
      await read();                                         // whatever the answer was, the database says where things stand now
      busyRef.current = false;
      setBusy(false);
    },
    [matchId, read]
  );
  return { view: current ? current.view : null, secondsLeft, refresh: read, respond, busy, error };
}
