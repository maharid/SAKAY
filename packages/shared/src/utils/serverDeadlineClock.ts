/**
 * A countdown to a moment the SERVER decided (an absolute deadline), drawn on a phone.
 *
 * The passenger's arrival wait (Rule 10) used to restart its end time from "seconds remaining" on every 3-second poll. The server rounds that
 * figure up, a poll can overtake an older one, and a late answer re-opened a countdown that had already ended, so the card flickered between
 * "Time is up" and "0:01". This clock instead keeps ONE end time per deadline:
 *
 *   - the end is mapped once onto the phone's MONOTONIC clock (performance.now) from the server's own `deadline` and `server_time`, so the
 *     phone's wall clock (wrong, or changed by the user) cannot move it, and a slow network is corrected by half the round trip;
 *   - an answer to an OLDER request than one already applied is ignored (overlapping or reordered polls), and so is one that carries an older
 *     server time;
 *   - for the same deadline only a measurement with a faster round trip may refine the end, never after the countdown has ended;
 *   - once ended, a countdown stays ended until the server names a LATER deadline (a genuine extension, e.g. "I'm Almost There");
 *   - within one deadline the seconds shown never go up, and never below zero.
 *
 * Pure (the clock is injected), so it is unit-tested without React or a browser: server/test/serverDeadlineClock.test.ts.
 */

export interface DeadlineSample {
  /** Increases with every request issued; an answer to a request older than one already applied is ignored */
  sequence: number;
  /** The phone's monotonic clock (ms) just before the request was sent, and when the answer arrived */
  sentAt: number;
  receivedAt: number;
  /** The server's end moment and the server's own clock when it answered (both ms since epoch, the SERVER's clock) */
  deadlineMs?: number | null;
  serverNowMs?: number | null;
  /** Seconds left as the server reported them (rounded up). Used only when the server did not give an absolute deadline */
  secondsRemaining?: number | null;
}

export interface CountdownSnapshot {
  /** false until the first usable sample */
  hasValue: boolean;
  expired: boolean;
  /** Whole seconds left, rounded up (never negative; 0 only once expired) */
  remainingSeconds: number;
  /** Identifies the deadline this snapshot belongs to (changes when the server names a different one) */
  episodeKey: string | null;
}

export const EMPTY_COUNTDOWN: CountdownSnapshot = { hasValue: false, expired: false, remainingSeconds: 0, episodeKey: null };

/** The phone's monotonic clock in ms (immune to wall-clock changes); Date.now() where performance.now() does not exist. */
export const monotonicNow = (): number => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

const RELATIVE_KEY = 'relative';
/** Without an absolute deadline, a new figure this much later than the current end is an extension, not measurement noise */
const RELATIVE_EXTENSION_THRESHOLD_MS = 2000;

export class ServerDeadlineClock {
  private lastSequence = -Infinity;
  private lastServerNowMs: number | null = null;
  private episodeKey: string | null = null;
  private endAt: number | null = null;
  private bestRoundTrip = Infinity;
  private expiredLatched = false;
  private lastSeconds = Infinity;
  private readonly now: () => number;

  constructor(now: () => number = monotonicNow) {
    this.now = now;
  }

  /** Forgets everything (the wait this clock followed is over, or another booking is shown). */
  reset(): void {
    this.lastSequence = -Infinity;
    this.lastServerNowMs = null;
    this.episodeKey = null;
    this.endAt = null;
    this.bestRoundTrip = Infinity;
    this.expiredLatched = false;
    this.lastSeconds = Infinity;
  }

  /** Takes in one server answer. Returns true when it changed the end this clock counts to. */
  apply(sample: DeadlineSample): boolean {
    if (!Number.isFinite(sample.sequence) || sample.sequence <= this.lastSequence) return false;
    const hasServerNow = typeof sample.serverNowMs === 'number' && Number.isFinite(sample.serverNowMs);
    if (hasServerNow && this.lastServerNowMs !== null && (sample.serverNowMs as number) < this.lastServerNowMs) return false;

    const roundTrip = Math.max(0, sample.receivedAt - sample.sentAt);
    const absolute = typeof sample.deadlineMs === 'number' && Number.isFinite(sample.deadlineMs) && hasServerNow;
    let toGoMs: number;
    let key: string;
    if (absolute) {
      toGoMs = (sample.deadlineMs as number) - (sample.serverNowMs as number);
      key = String(sample.deadlineMs);
    } else if (typeof sample.secondsRemaining === 'number' && Number.isFinite(sample.secondsRemaining)) {
      // the server rounds up: the true time left lies in (s - 1, s], so count to the middle
      toGoMs = sample.secondsRemaining <= 0 ? 0 : sample.secondsRemaining * 1000 - 500;
      key = RELATIVE_KEY;
    } else {
      return false;
    }

    this.lastSequence = sample.sequence;
    if (hasServerNow) this.lastServerNowMs = Math.max(this.lastServerNowMs ?? -Infinity, sample.serverNowMs as number);

    // The server answered about halfway through the round trip.
    const end = sample.sentAt + roundTrip / 2 + toGoMs;

    const sameEpisode =
      this.episodeKey === key && !(key === RELATIVE_KEY && this.endAt !== null && end > this.endAt + RELATIVE_EXTENSION_THRESHOLD_MS);
    if (sameEpisode) {
      if (this.expiredLatched) return false; // an ended countdown never re-opens for the same deadline
      if (roundTrip < this.bestRoundTrip) {
        this.endAt = end;
        this.bestRoundTrip = roundTrip;
        return true;
      }
      return false;
    }

    // First sample, or the server names a different deadline (an extension): a fresh episode.
    this.episodeKey = key;
    this.endAt = end;
    this.bestRoundTrip = roundTrip;
    this.expiredLatched = false;
    this.lastSeconds = Infinity;
    return true;
  }

  snapshot(): CountdownSnapshot {
    if (this.endAt === null || this.episodeKey === null) return EMPTY_COUNTDOWN;
    const remainingMs = this.endAt - this.now();
    if (this.expiredLatched || remainingMs <= 0) {
      this.expiredLatched = true;
      return { hasValue: true, expired: true, remainingSeconds: 0, episodeKey: this.episodeKey };
    }
    const seconds = Math.min(Math.ceil(remainingMs / 1000), this.lastSeconds);
    this.lastSeconds = seconds;
    return { hasValue: true, expired: false, remainingSeconds: seconds, episodeKey: this.episodeKey };
  }
}

/**
 * Remembers which deadlines have already been announced as ended, so that each is announced ONCE: a screen that re-renders, or is closed and
 * opened again while the countdown stays ended, does not trigger "the time is up" a second time.
 */
export class ExpiryAnnouncer {
  private readonly seen = new Set<string>();
  private readonly limit: number;

  constructor(limit = 100) {
    this.limit = limit;
  }

  /** true the first time this id is announced, false every time after */
  announce(id: string): boolean {
    if (this.seen.has(id)) return false;
    if (this.seen.size >= this.limit) this.seen.clear();
    this.seen.add(id);
    return true;
  }
}

/** "4:07" */
export const formatCountdown = (totalSeconds: number): string => {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
