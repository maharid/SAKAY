import { useEffect } from 'react';

/**
 * Ask the phone to keep the screen on while `active` (the driver is Online) and the page is visible.
 *
 * A browser suspends a page whose screen has locked: no location is published, no offer is fetched, no sound plays (Rule 17.6 already tells the
 * driver so). Keeping the screen on while Online is what lets an offer reach the driver (Rule 7.3). The lock is released by the browser when the
 * page is hidden, so it is asked for again when the page is shown. Where the phone refuses (a low battery) or has no Wake Lock, nothing
 * happens: the driver is no worse off than before.
 */
export function useScreenWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || sentinel || document.visibilityState !== 'visible') return;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (cancelled) {
          await lock.release().catch(() => undefined);
          return;
        }
        sentinel = lock;
        lock.addEventListener('release', () => {
          if (sentinel === lock) sentinel = null;
        });
      } catch {
        // refused (low battery, power saver): try again the next time the page is shown
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      const held = sentinel;
      sentinel = null;
      if (held) void held.release().catch(() => undefined);
    };
  }, [active]);
}
