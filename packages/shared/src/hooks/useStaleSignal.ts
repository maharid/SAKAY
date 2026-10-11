import { useEffect, useRef, useState } from 'react';

/**
 * True when `token` has not changed for `staleAfterMs`: use it with a value that is replaced every time a new position arrives (the position
 * object itself), so the map can draw a position that has stopped refreshing dimmer instead of letting it pass for live.
 *
 * Time is measured on THIS device from when the token last changed, never from a timestamp the sender wrote (a wrong clock must not matter).
 * A null / undefined token means there is nothing to judge, so it is never stale. The check runs every few seconds, not every frame, and
 * the state changes only when the answer does.
 */
export function useStaleSignal(token: unknown, staleAfterMs: number, enabled = true): boolean {
  const [stale, setStale] = useState(false);
  const changedAtRef = useRef<number>(Date.now());
  const lastTokenRef = useRef<unknown>(token);

  if (lastTokenRef.current !== token) {
    lastTokenRef.current = token;
    changedAtRef.current = Date.now();
  }

  useEffect(() => {
    changedAtRef.current = Date.now();
    setStale((prev) => (prev ? false : prev));
  }, [token]);

  useEffect(() => {
    if (!enabled || token === null || token === undefined) {
      setStale((prev) => (prev ? false : prev));
      return;
    }
    const check = () => {
      const isStale = Date.now() - changedAtRef.current > staleAfterMs;
      setStale((prev) => (prev === isStale ? prev : isStale));
    };
    const timer = setInterval(check, 5000);
    return () => clearInterval(timer);
    // The token is read through the ref: a new position resets the clock above, it does not need to restart the interval
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, staleAfterMs, token === null || token === undefined]);

  return enabled && stale;
}
