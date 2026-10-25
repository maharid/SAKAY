/**
 * Which notices are worth a person's attention, and how long ago one was sent.
 *
 * A notification is shown when it tells the person something new that they may have to act on or should know: a booking, a payment, a strike or a suspension, a decision
 * on a report or an appeal, a document that came back, an announcement. It is NOT shown when it only repeats what the screen they were on already said (the moment
 * of a live trip, long after the moment has passed), thanks them for what they did, or is a record of work somebody else did (an audit trail). The policy is applied
 * where the notices are read (the Driver and Passenger apps, the LGU and TODA portals); nothing is deleted from the database, the rows are just not listed.
 */

export interface NotificationCandidate {
  type?: string | null;
  title?: string | null;
  message?: string | null;
  /** ISO time the notice was sent */
  sentAt?: string | null;
}

const MINUTE = 60 * 1000;

/** A notice that only matters while the moment lasts (the driver went offline on a trip, a passenger may share a ride): listed for this long, then dropped. */
export const LIVE_NOTICE_WINDOW_MS = 30 * MINUTE;

/** The same notice sent again within this time is the same notice (a repeated write, a second poll) and is listed once. */
export const DUPLICATE_WINDOW_MS = 10 * MINUTE;

const LIVE_ONLY_TYPES = new Set(['DRIVER_UNREACHABLE', 'STALL_WARNING', 'SHARED_MATCH_REQUEST', 'EARLY_END_REQUESTED', 'FARE_CONFIRMED']);

// Work records and background jobs: they belong in the audit log, not in somebody's notifications.
const AUDIT_TYPE = /(AUDIT|RETENTION|PURGED|SCRUBBED|EXPORTED|JOB_RUN|CASCADE_EXECUTED|TABLE_CLEARED|_REMINDER_SENT)/;

// "Thank you for riding with SAKAY. (Salamat sa pagsakay sa SAKAY.)": the trip-completed notice that has nothing else in it. The ones about a disputed or a
// late-confirmed fare say something more and are kept.
const THANK_YOU_ONLY = /thank you for riding/i;

export function isImportantNotification(n: NotificationCandidate, now: number = Date.now()): boolean {
  const type = (n.type || '').toUpperCase().trim();
  if (AUDIT_TYPE.test(type)) return false;
  if (type === 'PAYMENT_RECEIVED' && THANK_YOU_ONLY.test(n.message || '')) return false;
  if (LIVE_ONLY_TYPES.has(type)) {
    const sent = n.sentAt ? new Date(n.sentAt).getTime() : NaN;
    // with no valid time the notice cannot be shown to be fresh
    if (!Number.isFinite(sent) || now - sent > LIVE_NOTICE_WINDOW_MS) return false;
  }
  return true;
}

// What belongs under "Trips": the notices about a booking, a trip, its fare or its payment. Everything else (strikes, account, documents, reports, announcements) is "advisories".
const TRIP_NOTICE_TYPE = /^(BOOKING_|TRIP_|DRIVER_|NO_DRIVER|DISPATCH_|STALL_|EARLY_END|FARE_|NON_PAYMENT|PAYMENT_|PASSENGER_|SHARED_)/;

export function notificationCategory(type: string | null | undefined): 'trips' | 'advisories' {
  return TRIP_NOTICE_TYPE.test((type || '').toUpperCase().trim()) ? 'trips' : 'advisories';
}

const normalise = (text: string | null | undefined): string => (text || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The notices worth listing, in their original order: the unimportant ones are left out and a notice that repeats another one (same type, title and text) sent
 * within ten minutes of it is listed once, as the newest.
 */
export function selectImportantNotifications<T>(items: readonly T[], pick: (item: T) => NotificationCandidate, now: number = Date.now()): T[] {
  const timeOf = (item: T): number => {
    const t = pick(item).sentAt ? new Date(pick(item).sentAt as string).getTime() : NaN;
    return Number.isFinite(t) ? t : 0;
  };
  const candidates = items.map((item, index) => ({ item, index })).filter(({ item }) => isImportantNotification(pick(item), now));

  const keptTimeByKey = new Map<string, number[]>();
  const keep = new Set<number>();
  for (const { item, index } of [...candidates].sort((a, b) => timeOf(b.item) - timeOf(a.item))) {
    const c = pick(item);
    const key = `${normalise(c.type)}|${normalise(c.title)}|${normalise(c.message)}`;
    const t = timeOf(item);
    const earlier = keptTimeByKey.get(key) ?? [];
    if (earlier.some((k) => Math.abs(k - t) <= DUPLICATE_WINDOW_MS)) continue;
    earlier.push(t);
    keptTimeByKey.set(key, earlier);
    keep.add(index);
  }
  return candidates.filter(({ index }) => keep.has(index)).map(({ item }) => item);
}

/**
 * How long ago a notice was sent, in the selected language ("5m ago", "Yesterday"; "5m ang nakalipas", "Kahapon"), and from a week on the date. The Tagalog words are
 * the ones the Driver App has always used for this.
 */
export function formatNotificationTime(iso: string | null | undefined, language: 'tl' | 'en', now: number = Date.now()): string {
  const tl = language === 'tl';
  const sent = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(sent)) return tl ? 'Kamakailan' : 'Recent';
  const minutes = Math.floor(Math.max(0, now - sent) / MINUTE);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (minutes < 1) return tl ? 'Ngayon' : 'Just now';
  if (minutes < 60) return tl ? `${minutes}m ang nakalipas` : `${minutes}m ago`;
  if (hours < 24) return tl ? `${hours}h ang nakalipas` : `${hours}h ago`;
  if (days === 1) return tl ? 'Kahapon' : 'Yesterday';
  if (days < 7) return tl ? `${days}d ang nakalipas` : `${days}d ago`;
  return new Date(sent).toLocaleDateString(tl ? 'fil-PH' : 'en-PH', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });
}
