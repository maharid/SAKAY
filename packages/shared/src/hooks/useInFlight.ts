import { useCallback, useRef, useState } from 'react';

export interface InFlight {
  /** True while a task started through `run` has not finished (for disabling / showing a spinner on the control) */
  busy: boolean;
  /**
   * Runs `task` unless one is already running, in which case the call is ignored and `undefined` is returned. The guard is a ref, so a
   * second tap in the same frame (before React re-renders the disabled button) is still refused.
   */
  run: <T>(task: () => Promise<T>) => Promise<T | undefined>;
}

/**
 * One request at a time for an action whose repeat would write twice (finish, pay, cancel, submit). Pair `busy` with the control's
 * `disabled` / `loading` so the person sees that the tap was taken.
 */
export function useInFlight(): InFlight {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async <T,>(task: () => Promise<T>): Promise<T | undefined> => {
    if (running.current) return undefined;
    running.current = true;
    setBusy(true);
    try {
      return await task();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, run };
}
