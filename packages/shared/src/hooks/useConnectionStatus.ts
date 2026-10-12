import { useSyncExternalStore } from 'react';

import { CONNECTION_LOST_AFTER_FAILED_CALLS } from '../config/policyConfig';

// Rule 17.4: both apps show a persistent notice while the connection is lost, so that nobody mistakes a stalled screen for a finished or cancelled trip.
//
// "Lost" is judged from what the app really experiences, not from one signal: the browser says it is offline, OR the last few calls to the server
// failed at the network level (a phone can show a Wi-Fi bar and still reach nothing). The calls the apps already make every few seconds (the
// driver's heartbeat, the passenger's trip poll) report their outcome here with reportNetworkResult(); nothing extra is sent to the server.
// It is the connection of THIS phone. (The other person's phone losing theirs is the server's business: Rule 9.2, Driver Unreachable.)
// No offline mode and no queue (Rules 9.1 / 17.2): the notice only says what is true.

type Listener = () => void;

let consecutiveFailures = 0;
let browserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
let lost = browserOffline;
const listeners = new Set<Listener>();
let listening = false;

const recompute = () => {
  const next = browserOffline || consecutiveFailures >= CONNECTION_LOST_AFTER_FAILED_CALLS;
  if (next !== lost) {
    lost = next;
    listeners.forEach((l) => l());
  }
};

const ensureBrowserListeners = () => {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('offline', () => {
    browserOffline = true;
    recompute();
  });
  // The network came back: believe it until a call proves otherwise (the next failed call counts again from zero)
  window.addEventListener('online', () => {
    browserOffline = false;
    consecutiveFailures = 0;
    recompute();
  });
};

/** What a failed call looks like when the NETWORK is at fault (as opposed to the server answering "no"). */
export function isNetworkFailure(error: unknown): boolean {
  if (error === null || error === undefined) return false;
  const e = error as { message?: unknown; name?: unknown; status?: unknown; code?: unknown };
  const status = typeof e.status === 'number' ? e.status : undefined;
  if (status === 0 || (status !== undefined && status >= 502 && status <= 504)) return true;
  const text = `${typeof e.name === 'string' ? e.name : ''} ${typeof e.message === 'string' ? e.message : String(error)}`;
  return /failed to fetch|networkerror|network request failed|load failed|err_internet_disconnected|err_network|timeout|timed out|aborted|econn|enotfound/i.test(text);
}

/** A call to the server has finished: ok = it reached the server (whatever the server answered), false = it did not get there. */
export function reportNetworkResult(ok: boolean): void {
  ensureBrowserListeners();
  if (ok) consecutiveFailures = 0;
  else consecutiveFailures += 1;
  recompute();
}

/** Reports the outcome of a Supabase-style `{ error }` answer: only a network-level error counts as a failure. */
export function reportNetworkOutcome(error: unknown): void {
  reportNetworkResult(!isNetworkFailure(error));
}

const subscribe = (listener: Listener) => {
  ensureBrowserListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getSnapshot = () => lost;
const getServerSnapshot = () => false;

/** True while this phone has no usable connection (Rule 17.4). */
export function useConnectionLost(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** For tests: forget everything this module has seen. */
export function resetConnectionStatusForTests(offline = false): void {
  consecutiveFailures = 0;
  browserOffline = offline;
  lost = offline;
  listeners.forEach((l) => l());
}
