/**
 * Why the server is NOT using the driver's position (Rules 17.x, figures F4.6 / F4.7).
 *
 * Dispatch only sees a driver whose last position the server accepted is fresh (45 s) and accurate (100 m). Two things stop a position from
 * getting there, and both used to be silent: the driver stayed "Online" on the screen, waited for offers that could not come, and nothing said why.
 *   - The server answers but refuses the position (`location_accepted: false`: the phone's fix is worse than 100 m, or there is none). It keeps the
 *     LAST GOOD position, and 45 seconds later the driver is invisible to dispatch. A tester on a desktop browser (coarse Wi-Fi / IP location) hits this.
 *   - The heartbeat gets no answer at all (no network, a login the database refuses, a request that hangs): the server hears nothing, the last
 *     position ages past 45 seconds the same way.
 * This turns both into a notice the driver can act on.
 *
 * One refused or lost beat is harmless (the last good position is still valid for 45 s), so the notice appears at the second one in a row, about
 * 30 s after things went wrong at the 15 s idle heartbeat, and goes away at the first beat that is answered and accepted.
 */

export type LocationIssueReason = 'low_accuracy' | 'no_position' | 'no_connection';

export interface LocationIssue {
  reason: LocationIssueReason;
  /** The error circle the phone reported, in metres (low_accuracy only; null otherwise) */
  accuracyM: number | null;
  /** What the network or the database said, shortened (no_connection only; null otherwise) */
  detail: string | null;
}

export interface LocationWatch {
  /** Positions the server refused, in a row */
  rejectedBeats: number;
  /** Heartbeats in a row that got no answer from the server */
  failedBeats: number;
  issue: LocationIssue | null;
}

/** Refused positions in a row before the driver is told (the server's 45 s grace covers a single one) */
export const LOCATION_REJECTED_BEATS_BEFORE_NOTICE = 2;

/** Unanswered heartbeats in a row before the driver is told */
export const HEARTBEAT_FAILED_BEATS_BEFORE_NOTICE = 2;

export const INITIAL_LOCATION_WATCH: LocationWatch = { rejectedBeats: 0, failedBeats: 0, issue: null };

/** What the heartbeat answers (the fields of PresenceResult that matter here). */
export interface LocationAnswer {
  success?: boolean;
  error_code?: string;
  error?: string;
  location_accepted?: boolean;
  location_rejected_reason?: string | null;
}

const MAX_DETAIL_LENGTH = 120;

const shorten = (text: string | null | undefined): string | null => {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > MAX_DETAIL_LENGTH ? `${flat.slice(0, MAX_DETAIL_LENGTH - 1)}…` : flat;
};

/**
 * What one heartbeat answer does to the notice. An answer that says nothing about the position (an older server) changes nothing, except that
 * a server that answers ends any "cannot reach the server" notice.
 */
export const watchLocationAnswer = (previous: LocationWatch, answer: LocationAnswer, deviceAccuracyM: number | null): LocationWatch => {
  if (answer.success === false) {
    // This device was signed out by a newer login: the caller handles that, it is not a connection problem.
    if (answer.error_code === 'ERR_SESSION_SUPERSEDED') return previous;
    const failedBeats = previous.failedBeats + 1;
    if (failedBeats < HEARTBEAT_FAILED_BEATS_BEFORE_NOTICE) return { ...previous, failedBeats };
    return { ...previous, failedBeats, issue: { reason: 'no_connection', accuracyM: null, detail: shorten(answer.error || answer.error_code) } };
  }

  // The server answered: whatever was wrong with the connection is over.
  const heard: LocationWatch = previous.failedBeats === 0 && previous.issue?.reason !== 'no_connection'
    ? previous
    : { ...previous, failedBeats: 0, issue: previous.issue?.reason === 'no_connection' ? null : previous.issue };

  if (answer.location_accepted === true) return INITIAL_LOCATION_WATCH;
  if (answer.location_accepted !== false) return heard;

  const rejectedBeats = heard.rejectedBeats + 1;
  if (rejectedBeats < LOCATION_REJECTED_BEATS_BEFORE_NOTICE) return { ...heard, rejectedBeats };

  const reason: LocationIssueReason = answer.location_rejected_reason === 'low_accuracy' ? 'low_accuracy' : 'no_position';
  const accuracyM = reason === 'low_accuracy' && deviceAccuracyM !== null && Number.isFinite(deviceAccuracyM) ? Math.round(deviceAccuracyM) : null;
  return { rejectedBeats, failedBeats: 0, issue: { reason, accuracyM, detail: null } };
};
