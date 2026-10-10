import { useCallback, useEffect, useRef, useState } from 'react';

import { EMPTY_COUNTDOWN, ExpiryAnnouncer, ServerDeadlineClock, monotonicNow, type CountdownSnapshot, type DeadlineSample } from '../utils/serverDeadlineClock';

/** Deadlines whose expiry has already been announced (kept across remounts, so a screen that reopens does not announce it again). */
const ANNOUNCED = new ExpiryAnnouncer();

export interface ServerCountdown extends CountdownSnapshot {
  /** Call just before asking the server; pass the result back with the answer */
  beginRequest: () => { sequence: number; sentAt: number };
  /** Feed one server answer (see DeadlineSample) */
  apply: (sample: Omit<DeadlineSample, 'sequence' | 'sentAt' | 'receivedAt'> & { sequence: number; sentAt: number; receivedAt?: number }) => void;
}

/**
 * Follows a server deadline (see ServerDeadlineClock) and re-renders only when what is SHOWN changes (the whole second, or "ended").
 *
 *  - `episodeId` names what is counted (the booking); a different id, or `active` turning false, starts from nothing.
 *  - `onExpire` runs once per deadline when the countdown ends, even across remounts and re-renders: the screen asks the server for the
 *    next state at that moment instead of waiting for its next poll.
 */
export function useServerCountdown(episodeId: string | null | undefined, active: boolean, onExpire?: () => void): ServerCountdown {
  const clockRef = useRef<ServerDeadlineClock | null>(null);
  if (clockRef.current === null) clockRef.current = new ServerDeadlineClock(monotonicNow);
  const sequenceRef = useRef(0);
  const [snapshot, setSnapshot] = useState<CountdownSnapshot>(EMPTY_COUNTDOWN);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  const idRef = useRef(episodeId);
  idRef.current = episodeId;

  const refresh = useCallback(() => {
    const clock = clockRef.current as ServerDeadlineClock;
    const next = clock.snapshot();
    setSnapshot((prev) =>
      prev.hasValue === next.hasValue && prev.expired === next.expired && prev.remainingSeconds === next.remainingSeconds && prev.episodeKey === next.episodeKey
        ? prev
        : next
    );
    if (next.expired && next.episodeKey && idRef.current) {
      if (ANNOUNCED.announce(`${idRef.current}|${next.episodeKey}`)) onExpireRef.current?.();
    }
  }, []);

  useEffect(() => {
    (clockRef.current as ServerDeadlineClock).reset();
    setSnapshot(EMPTY_COUNTDOWN);
    if (!active || !episodeId) return;
    const timer = setInterval(refresh, 250);
    return () => clearInterval(timer);
  }, [episodeId, active, refresh]);

  const beginRequest = useCallback(() => {
    sequenceRef.current += 1;
    return { sequence: sequenceRef.current, sentAt: monotonicNow() };
  }, []);

  const apply = useCallback<ServerCountdown['apply']>(
    (sample) => {
      const changed = (clockRef.current as ServerDeadlineClock).apply({ ...sample, receivedAt: sample.receivedAt ?? monotonicNow() });
      if (changed) refresh();
    },
    [refresh]
  );

  return { ...snapshot, beginRequest, apply };
}
