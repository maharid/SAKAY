import { useEffect, useMemo, useRef, useState } from 'react';

import { isPlausibleFix, stepShownProgress, TRIP_PROGRESS_REJECTED_FIXES_BEFORE_BELIEVING, type FixSample } from '../utils/tripProgress';

/**
 * The percentage a trip screen draws. `target` is the figure the shared formula gives for the latest position; the value returned moves toward
 * it a little at a time (see stepShownProgress), so the bar and the number advance smoothly and a single odd fix cannot make them leap.
 * A different `resetKey` (another trip) starts from where that trip really is. Arrival (target 100) is shown at once.
 */
export function useShownTripProgress(target: number, resetKey: string): number {
  const [shown, setShown] = useState<number>(() => stepShownProgress(null, target, 0));
  const targetRef = useRef(target);
  targetRef.current = target;
  const lastTickRef = useRef(Date.now());
  // The first real figure of a screen (a trip that is already under way when the screen opens, the booking still loading until then) is shown as it is, not climbed to from 0
  const startedRef = useRef(target > 0);

  useEffect(() => {
    lastTickRef.current = Date.now();
    startedRef.current = targetRef.current > 0;
    setShown(stepShownProgress(null, targetRef.current, 0));
  }, [resetKey]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastTickRef.current;
      lastTickRef.current = now;
      if (!startedRef.current) return;
      setShown((current) => {
        const next = stepShownProgress(current, targetRef.current, elapsed);
        return next === current ? current : next;
      });
    }, 400);
    return () => window.clearInterval(id);
  }, []);

  // arrival, and the first real figure, do not wait for the next tick
  useEffect(() => {
    if (target >= 100) setShown(100);
    else if (!startedRef.current && target > 0) {
      startedRef.current = true;
      setShown(target);
    }
  }, [target]);

  // the fraction is kept inside, so the pace is exact; only the figure that is drawn is a whole percent
  return Math.round(shown);
}

/**
 * The driver's position as the progress should read it: a position no tricycle could have reached since the last good one (a GPS error, a bad
 * first fix) is held back, so it cannot drag the progress to the end of the trip. Null while there is no real position (never a guessed one).
 * Time is measured on this device, when each position arrived.
 */
export function usePlausibleDriverPoint(
  lat: number | null | undefined,
  lng: number | null | undefined,
  resetKey: string,
): { lat: number; lng: number } | null {
  const lastGoodRef = useRef<FixSample | null>(null);
  const rejectedRef = useRef(0);
  const keyRef = useRef(resetKey);

  return useMemo(() => {
    if (keyRef.current !== resetKey) {
      keyRef.current = resetKey;
      lastGoodRef.current = null;
      rejectedRef.current = 0;
    }
    const previous = lastGoodRef.current;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return previous ? { lat: previous.lat, lng: previous.lng } : null;
    }
    const sample: FixSample = { lat, lng, atMs: Date.now() };
    if (!previous || (previous.lat === lat && previous.lng === lng)) {
      lastGoodRef.current = previous ? { ...previous, atMs: sample.atMs } : sample;
      rejectedRef.current = 0;
      return { lat, lng };
    }
    if (isPlausibleFix(previous, sample) || rejectedRef.current + 1 >= TRIP_PROGRESS_REJECTED_FIXES_BEFORE_BELIEVING) {
      lastGoodRef.current = sample;
      rejectedRef.current = 0;
      return { lat, lng };
    }
    rejectedRef.current += 1;
    return { lat: previous.lat, lng: previous.lng };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, resetKey]);
}
