import { STRIKE_LADDER } from '../config/policyConfig';

/**
 * Account restriction helpers (Batch 3 - Sections 1, 20, 21, 22).
 * The database decides whether an account is restricted (public.account_restriction_state);
 * these helpers only describe that decision to the user in Tagalog / English.
 */

/** SELF_DEACTIVATED: the account holder paused their own account (decision D-P5); they can reactivate it by signing in. The others are decided by the system or the LGU. */
export type RestrictionKind = 'SUSPENDED' | 'INVESTIGATION' | 'DEACTIVATED' | 'CLOSED' | 'SELF_DEACTIVATED';

export interface AccountRestriction {
  restricted: boolean;
  kind?: RestrictionKind | null;
  /** ISO timestamp (UTC) when a time-bound suspension ends; null for open-ended states */
  until?: string | null;
  reason?: string | null;
  /** ISO timestamp (UTC) when the account holder deactivated their own account (SELF_DEACTIVATED only) */
  since?: string | null;
}

export type NoticeLanguage = 'tl' | 'en';

/** The only part of a Supabase client the restriction lookup needs. */
export interface RpcCapableClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

/**
 * Asks the database whether the signed-in user is suspended or deactivated
 * (public.get_my_account_restriction). The database also lifts a suspension whose period
 * has ended, so nobody is kept out by a background job that has not run yet.
 * Returns null when the check cannot be made; callers then fall back to the status column.
 */
export async function fetchOwnAccountRestriction(
  client: RpcCapableClient,
  role: 'passenger' | 'driver'
): Promise<AccountRestriction | null> {
  try {
    const { data, error } = await client.rpc('get_my_account_restriction', { p_role: role });
    const row = data as { found?: boolean; restricted?: boolean; kind?: RestrictionKind | null; until?: string | null; reason?: string | null; since?: string | null } | null;
    if (error || !row || row.found === false) return null;
    return { restricted: Boolean(row.restricted), kind: row.kind ?? null, until: row.until ?? null, reason: row.reason ?? null, since: row.since ?? null };
  } catch {
    return null;
  }
}

/** Formats an ISO timestamp for display in Asia/Manila (storage stays UTC). */
export function formatManilaDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })} (PHT)`;
}

/** Plain-language notice for a restriction, in the user's language. */
export function describeRestriction(restriction: AccountRestriction, language: NoticeLanguage): string {
  const until = formatManilaDateTime(restriction.until);
  switch (restriction.kind) {
    case 'SELF_DEACTIVATED':
      return language === 'tl'
        ? 'Na-deactivate ninyo ang inyong account. Piliin ang Reactivate para magamit itong muli.'
        : 'You deactivated your account. Choose Reactivate to use it again.';
    case 'DEACTIVATED':
    case 'CLOSED':
      return language === 'tl'
        ? 'Na-deactivate ang inyong account at nangangailangan ng pagsusuri ng LGU.'
        : 'Your account is deactivated and requires LGU review.';
    case 'INVESTIGATION':
      return language === 'tl'
        ? 'Pansamantalang sinuspinde ang inyong account habang may imbestigasyon.'
        : 'Your account is suspended pending investigation.';
    case 'SUSPENDED':
    default:
      if (until) {
        return language === 'tl'
          ? `Suspendido ang inyong account hanggang ${until}.`
          : `Your account is suspended until ${until}.`;
      }
      return language === 'tl' ? 'Suspendido ang inyong account.' : 'Your account is suspended.';
  }
}

/**
 * Recovers the restriction from a database error raised by the enforcement guards
 * (messages start with ERR_ACCOUNT_SUSPENDED / ERR_ACCOUNT_DEACTIVATED and end with
 * "[kind=... until=...]"). Returns null for any other error.
 */
export function parseRestrictionError(message: string | null | undefined): AccountRestriction | null {
  if (!message) return null;
  if (!message.includes('ERR_ACCOUNT_SUSPENDED') && !message.includes('ERR_ACCOUNT_DEACTIVATED') && !message.includes('ERR_ACCOUNT_SELF_DEACTIVATED')) return null;
  const kindMatch = message.match(/kind=([A-Z_]+)/);
  const untilMatch = message.match(/until=([0-9T:\-Z.]+)/);
  const kind = (kindMatch?.[1] as RestrictionKind | undefined) ??
    (message.includes('ERR_ACCOUNT_SELF_DEACTIVATED') ? 'SELF_DEACTIVATED' : message.includes('ERR_ACCOUNT_DEACTIVATED') ? 'DEACTIVATED' : 'SUSPENDED');
  return { restricted: true, kind, until: untilMatch?.[1] ?? null };
}

/** The result of deactivating or reactivating your own account: what happened, in the user's language when it did not */
export interface SelfServiceResult {
  ok: boolean;
  /** the database's error code, e.g. ERR_OPEN_BOOKING */
  code?: string;
  message?: string;
  /** after a reactivation: what still restricts the account (a penalty the person did not choose), if anything */
  restriction?: AccountRestriction | null;
}

const SELF_SERVICE_MESSAGES: Record<string, { tl: string; en: string }> = {
  ERR_OPEN_BOOKING: {
    tl: 'May booking o biyahe pa kayong hindi tapos. Tapusin o kanselahin muna ito bago i-deactivate ang account.',
    en: 'You have a booking or trip in progress. Finish or cancel it first, then deactivate your account.',
  },
  ERR_OPEN_CASE: {
    tl: 'May bukas pa kayong reklamo, dispute o review. Maaari kayong mag-deactivate kapag naisara na ito.',
    en: 'You have an open dispute, report or review. Your account can be deactivated once it is closed.',
  },
  ERR_ALREADY_RESTRICTED: {
    tl: 'Na-deactivate o suspendido na ang inyong account.',
    en: 'Your account is already deactivated or suspended.',
  },
};

async function callSelfService(client: RpcCapableClient, fn: string, args: Record<string, unknown>, language: NoticeLanguage): Promise<SelfServiceResult> {
  const failed = language === 'tl' ? 'Hindi naisagawa. Pakisubukang muli.' : 'It could not be done. Please try again.';
  try {
    const { data, error } = await client.rpc(fn, args);
    const row = data as { success?: boolean; error_code?: string; error?: string; restriction?: AccountRestriction | null } | null;
    if (error || !row) return { ok: false, message: failed };
    if (row.success === true) return { ok: true, restriction: row.restriction ?? null };
    const known = row.error_code ? SELF_SERVICE_MESSAGES[row.error_code] : undefined;
    return { ok: false, code: row.error_code, message: known ? known[language] : row.error || failed };
  } catch {
    return { ok: false, message: failed };
  }
}

/** Deactivates the signed-in user's own account (decision D-P5). The database refuses while a booking, trip or dispute is open; nothing is deleted. */
export function deactivateOwnAccount(client: RpcCapableClient, role: 'passenger' | 'driver', reason: string | null, language: NoticeLanguage): Promise<SelfServiceResult> {
  return callSelfService(client, 'deactivate_my_account', { p_role: role, p_reason: reason }, language);
}

/** Brings the signed-in user's own deactivated account back. A penalty or suspension that applies is NOT lifted: the result says what still restricts the account. */
export function reactivateOwnAccount(client: RpcCapableClient, role: 'passenger' | 'driver', language: NoticeLanguage): Promise<SelfServiceResult> {
  return callSelfService(client, 'reactivate_my_account', { p_role: role }, language);
}

/** The TODA a driver works under is suspended by the LGU (decision D-P5) */
export interface TodaSuspension {
  suspended: boolean;
  todaName?: string;
  reason?: string | null;
  /** ISO: when it ends by itself; null = until the LGU reinstates the TODA */
  until?: string | null;
  since?: string | null;
}

/** Asks the database whether the driver's TODA is suspended (public.get_my_toda_suspension). Null when it cannot be checked. */
export async function fetchOwnTodaSuspension(client: RpcCapableClient): Promise<TodaSuspension | null> {
  try {
    const { data, error } = await client.rpc('get_my_toda_suspension', {});
    const row = data as { suspended?: boolean; toda_name?: string; reason?: string | null; until?: string | null; since?: string | null } | null;
    if (error || !row) return null;
    if (!row.suspended) return { suspended: false };
    return { suspended: true, todaName: row.toda_name, reason: row.reason ?? null, until: row.until ?? null, since: row.since ?? null };
  } catch {
    return null;
  }
}

/** Plain-language notice for a suspended TODA, in the driver's language */
export function describeTodaSuspension(s: TodaSuspension, language: NoticeLanguage): string {
  const until = formatManilaDateTime(s.until);
  const name = s.todaName || (language === 'tl' ? 'inyong TODA' : 'your TODA');
  // the sentence below ends with its own full stop: a reason the LGU wrote with one must not show two
  const reason = (s.reason || '').trim().replace(/[.!?\s]+$/, '') || (language === 'tl' ? 'walang naitalang dahilan' : 'no reason recorded');
  if (language === 'tl') {
    return `Suspendido ng LGU ang ${name}${until ? ` hanggang ${until}` : ''}. Hindi muna kayo makakapag-Online o makakatanggap ng biyahe; matatapos ninyo ang biyaheng natanggap na. Dahilan: ${reason}.`;
  }
  return `The LGU suspended ${name}${until ? ` until ${until}` : ' until it is reinstated'}. You cannot go Online or take new trips; a trip you already accepted can be finished. Reason: ${reason}.`;
}

export interface StrikeLadderTier {
  /** 0 = compliant ... 5 = deactivation */
  tier: 0 | 1 | 2 | 3 | 4 | 5;
  label: string;
}

/** Ladder tier for an active-strike total (Sections 20/21), with lengths from policyConfig. */
export function getStrikeLadderTier(activeStrikes: number): StrikeLadderTier {
  const n = Math.max(0, Math.floor(activeStrikes));
  const L = STRIKE_LADDER;
  if (n >= L.DEACTIVATION_AT) return { tier: 5, label: `Permanent Deactivation Review (${n} / ${L.DEACTIVATION_AT})` };
  if (n >= L.SUSPENSION_2_AT) return { tier: 4, label: `${L.SUSPENSION_2_DAYS}-Day Suspension (${n} / ${L.DEACTIVATION_AT})` };
  if (n >= L.SUSPENSION_1_AT) return { tier: 3, label: `${L.SUSPENSION_1_DAYS}-Day Suspension (${n} / ${L.DEACTIVATION_AT})` };
  if (n >= L.ADMIN_REVIEW_AT) return { tier: 2, label: `Administrative Review (${n} / ${L.DEACTIVATION_AT})` };
  if (n >= L.WARNING_AT) return { tier: 1, label: `Warning Issued (${n} / ${L.DEACTIVATION_AT})` };
  return { tier: 0, label: `Compliant (0 / ${L.DEACTIVATION_AT})` };
}
