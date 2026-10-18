import { EXEMPTION_REQUEST_WINDOW_HOURS } from '../config/policyConfig';
import type { ExemptionCauseCode } from '../config/policyConfig';
import { reportNetworkOutcome } from '../hooks/useConnectionStatus';

/**
 * Rules 20, 21, 22.3 and 25: a person's own strikes, and the way to appeal one. Used by the Passenger and the Driver app, so the two screens
 * cannot drift apart. The DATABASE decides everything (who may appeal which strike, the 48-hour window, where the request goes - the LGU
 * Administrator for a passenger (25.5), the TODA Administrator for a driver (25.4), how many times the same cause may be used (25.7)); this only
 * asks and carries the answer.
 */

export interface StrikeRow {
  strikeId: string;
  violationCode: string;
  description: string;
  sourceRule: string;
  status: string;
  pointsIssued: number;
  pointsActive: number;
  issuedAt: string;
  provisionalUntil: string | null;
  reason: string | null;
}

export interface AppealRow {
  requestId: string;
  strikeId: string;
  status: string;
  causeCode: string;
  requestedAt: string;
  /** Rule 25.6: when the decision is due (3 business days from the request) */
  decisionDueAt: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
}

export interface StrikeHistory {
  activeStrikes: number;
  windowDays: number;
  strikes: StrikeRow[];
}

export interface AppealResult {
  ok: boolean;
  /** What the database said when it refused (shown as is) */
  error: string | null;
  /** Who will decide: the TODA Administrator, or the LGU Administrator (always for a passenger, and for a serious strike of a driver) */
  assignedRole: string | null;
}

/** The part of a Supabase client these calls need. */
export interface StrikeAppealClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from(table: string): {
    select(columns: string): {
      order(column: string, opts: { ascending: boolean }): {
        limit(n: number): PromiseLike<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>;
      };
    };
  };
}

/** Statuses of a strike that still count and may still be waived. */
const APPEALABLE_STATUSES = new Set(['ACTIVE', 'PROVISIONAL', 'PARTIALLY_WAIVED']);
const OPEN_APPEAL_STATUSES = new Set(['Pending TODA Review', 'Pending LGU Review']);

/** The strike history of a subject (the database allows it only for the signed-in person's own record), newest first; null when it could not be read. */
export async function fetchStrikeHistory(client: StrikeAppealClient, subjectType: 'passenger' | 'driver', subjectId: string): Promise<StrikeHistory | null> {
  const { data, error } = await client.rpc('get_strike_history', { p_subject_type: subjectType, p_subject_id: subjectId });
  reportNetworkOutcome(error);
  const row = data as { active_strikes?: number; window_days?: number; strikes?: Array<Record<string, unknown>> } | null;
  if (error || !row) return null;
  return {
    activeStrikes: Number(row.active_strikes ?? 0),
    windowDays: Number(row.window_days ?? 90),
    strikes: (row.strikes ?? []).map((s) => ({
      strikeId: String(s.strike_id),
      violationCode: String(s.violation_code),
      description: String(s.description ?? s.violation_code),
      sourceRule: String(s.source_rule ?? ''),
      status: String(s.status),
      pointsIssued: Number(s.points_issued ?? 0),
      pointsActive: Number(s.points_active ?? 0),
      issuedAt: String(s.issued_at),
      provisionalUntil: (s.provisional_until as string | null) ?? null,
      reason: (s.reason as string | null) ?? null,
    })),
  };
}

/** The person's own appeals, newest first (row security shows them only their own). */
export async function fetchOwnAppeals(client: StrikeAppealClient): Promise<AppealRow[]> {
  const { data, error } = await client
    .from('exemption_request')
    .select('request_id, strike_id, status, cause_code, requested_at, decision_due_at, decision_reason, decided_at')
    .order('requested_at', { ascending: false })
    .limit(50);
  reportNetworkOutcome(error);
  if (error || !data) return [];
  return data.map((r) => ({
    requestId: String(r.request_id),
    strikeId: String(r.strike_id),
    status: String(r.status),
    causeCode: String(r.cause_code),
    requestedAt: String(r.requested_at),
    decisionDueAt: (r.decision_due_at as string | null) ?? null,
    decisionReason: (r.decision_reason as string | null) ?? null,
    decidedAt: (r.decided_at as string | null) ?? null,
  }));
}

/** Rule 25: asks for a strike to be waived. The database refuses a strike that is not theirs, not eligible, already waived, past its 48 hours or already pending. */
export async function submitStrikeAppeal(client: StrikeAppealClient, strikeId: string, cause: ExemptionCauseCode, justification: string): Promise<AppealResult> {
  const { data, error } = await client.rpc('submit_exemption_request', {
    p_strike_id: strikeId,
    p_cause_code: cause,
    p_justification: justification.trim(),
    p_evidence: [],
    p_toda_is_party: false,
  });
  reportNetworkOutcome(error);
  if (error) return { ok: false, error: error.message.replace(/^Access Denied:\s*/, ''), assignedRole: null };
  const row = data as { success?: boolean; assigned_role?: string } | null;
  return row?.success
    ? { ok: true, error: null, assignedRole: row.assigned_role ?? null }
    : { ok: false, error: 'The appeal could not be sent. Please try again.', assignedRole: null };
}

/** The newest appeal of each strike. */
export function newestAppealByStrike(appeals: AppealRow[]): Map<string, AppealRow> {
  const byStrike = new Map<string, AppealRow>();
  const sorted = [...appeals].sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt));
  for (const a of sorted) if (!byStrike.has(a.strikeId)) byStrike.set(a.strikeId, a);
  return byStrike;
}

/**
 * Whether the "Appeal" button is offered (Rule 25.1): the strike still counts, no appeal of it is waiting for a decision, and the 48 hours from
 * its issue have not passed. It is only an offer: the database decides again when the request arrives.
 */
export function canAppealStrike(strike: StrikeRow, newestAppeal: AppealRow | undefined, nowMs: number = Date.now()): boolean {
  if (!APPEALABLE_STATUSES.has(strike.status) || strike.pointsActive <= 0) return false;
  if (newestAppeal && OPEN_APPEAL_STATUSES.has(newestAppeal.status)) return false;
  const issued = Date.parse(strike.issuedAt);
  return Number.isFinite(issued) && nowMs <= issued + EXEMPTION_REQUEST_WINDOW_HOURS * 3_600_000;
}
