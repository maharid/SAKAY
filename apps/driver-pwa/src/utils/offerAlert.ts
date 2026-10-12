/**
 * The alert for a booking offer (Rule 7.3: "the Driver PWA shall provide an audible notification upon receipt of a booking request").
 *
 * A browser only lets a page make sound after the person has touched it, and on an iPhone an audio context that is created LATER, without a
 * touch (as every beep used to create its own), stays silent. So there is ONE audio context for the whole session of the app:
 *   - it is created and unlocked on the first touch anywhere, and again on the Go Online tap (installOfferAlertUnlock, unlockOfferAlert);
 *   - it is resumed whenever the page returns to the foreground (the phone may have suspended it);
 *   - every beep reuses it (the old code never closed the contexts it opened).
 * Where sound still cannot play (the phone is muted, or the page is in the background) the alert falls back to vibration where the phone
 * has it, and to the offer screen and the flashing page title: a page that is hidden or a screen that is locked cannot be woken by a
 * browser, so the Driver app also asks the phone to keep the screen on while the driver is Online (useScreenWakeLock).
 */

type AudioContextClass = typeof AudioContext;

let context: AudioContext | null = null;

const audioContextClass = (): AudioContextClass | null => {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext || null;
};

const getContext = (): AudioContext | null => {
  if (context && context.state !== 'closed') return context;
  const Ctor = audioContextClass();
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    context = null;
  }
  return context;
};

const resumeContext = (): void => {
  if (context && context.state !== 'running' && context.state !== 'closed') {
    void context.resume().catch(() => undefined);
  }
};

/** Create and resume the shared audio context. Call it from a touch, click or key handler (the Go Online tap does). */
export const unlockOfferAlert = (): void => {
  const ctx = getContext();
  if (!ctx) return;
  resumeContext();
  // An iPhone counts only audio that STARTS inside the touch: a silent one-sample buffer does that without making a sound.
  try {
    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 1, 22050);
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // nothing to unlock on this browser
  }
};

/** True once the page is allowed to make sound. */
export const isOfferAlertUnlocked = (): boolean => context !== null && context.state === 'running';

const chime = (ctx: AudioContext): void => {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(587.33, ctx.currentTime);
  osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.35);
};

/** One two-tone chime and a vibration. Returns whether the chime could play right now. */
export const playOfferAlert = (): boolean => {
  let audible = false;
  try {
    const ctx = getContext();
    if (ctx) {
      if (ctx.state === 'running') {
        chime(ctx);
        audible = true;
      } else {
        void ctx.resume().then(() => chime(ctx)).catch(() => undefined);
      }
    }
  } catch {
    // no sound on this phone: the vibration and the offer screen still tell the driver
  }
  try {
    // (a phone that has never been touched refuses to vibrate, and says so in the console on every call: ask first)
    const touched = typeof navigator !== 'undefined' && (navigator.userActivation ? navigator.userActivation.hasBeenActive : true);
    if (touched && 'vibrate' in navigator) navigator.vibrate([200, 100, 200]);
  } catch {
    // vibration refused
  }
  return audible;
};

/**
 * Unlock the audio on the first touch anywhere in the page and resume it when the page is shown again. Returns the cleanup (the listeners
 * stay until the context is really running, so a touch that arrives before the first one counts is not wasted).
 */
export const installOfferAlertUnlock = (): (() => void) => {
  if (typeof document === 'undefined') return () => undefined;
  const events = ['pointerdown', 'touchend', 'click', 'keydown'] as const;

  const removeGestureListeners = () => {
    events.forEach((name) => document.removeEventListener(name, onGesture, true));
  };
  function onGesture(): void {
    if (isOfferAlertUnlocked()) {
      removeGestureListeners();
      return;
    }
    unlockOfferAlert();
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') resumeContext();
  };

  events.forEach((name) => document.addEventListener(name, onGesture, true));
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    removeGestureListeners();
    document.removeEventListener('visibilitychange', onVisible);
  };
};

/** Release the audio context (the driver signed out). The next unlock creates a new one. */
export const closeOfferAlert = (): void => {
  const ctx = context;
  context = null;
  if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined);
};

/** Flash the page title while an offer is open (a second way to notice it on a desktop or a tablet). Returns the function that stops it. */
export const startOfferTitleFlash = (text: string): (() => void) => {
  if (typeof document === 'undefined') return () => undefined;
  const original = document.title;
  let showing = false;
  const timer = setInterval(() => {
    showing = !showing;
    document.title = showing ? text : original;
  }, 1000);
  return () => {
    clearInterval(timer);
    document.title = original;
  };
};
