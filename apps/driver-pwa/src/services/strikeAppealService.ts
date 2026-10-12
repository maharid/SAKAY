import { reportNetworkOutcome } from '@sakay/shared';
import type { ExemptionCauseCode } from '@sakay/shared';

import { supabase } from './supabaseClient';

// Rules 8.6, 9.4 and 25: the driver reads his own strikes and appeals one. The database decides everything (who may appeal which strike, the 48-hour
// window, where the request goes, how many times the same cause may be used); this module only asks and shows the answer.

export interface DriverStrike {
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

export interface DriverAppeal {
  requestId: string;
  strikeId: string;
  status: string;
  causeCode: string;
  requestedAt: string;
  decisionReason: string | null;
  decidedAt: string | null;
}

export interface StrikeHistory {
  activeStrikes: number;
  windowDays: number;
  strikes: DriverStrike[];
}

const driverId = (): string | null => {
  try {
    return localStorage.getItem('sakay_driver_id');
  } catch {
    return null;
  }
};

/** The driver's own strike ledger, newest first (null when it could not be read). */
export const fetchMyStrikes = async (): Promise<StrikeHistory | null> => {
  const id = driverId();
  if (!id) return null;
  const { data, error } = await supabase.rpc('get_strike_history', { p_subject_type: 'driver', p_subject_id: id });
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
};

/** The driver's own appeals (row security shows him only his). */
export const fetchMyAppeals = async (): Promise<DriverAppeal[]> => {
  const { data, error } = await supabase
    .from('exemption_request')
    .select('request_id, strike_id, status, cause_code, requested_at, decision_reason, decided_at')
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
    decisionReason: (r.decision_reason as string | null) ?? null,
    decidedAt: (r.decided_at as string | null) ?? null,
  }));
};

export interface AppealResult {
  ok: boolean;
  /** What the database said when it refused (shown as is) */
  error: string | null;
  /** Who will decide: his TODA Administrator, or the LGU Administrator when the strike is serious enough */
  assignedRole: string | null;
}

/** Rule 25: asks for a strike to be waived. The database refuses a strike that is not his, not eligible, already waived, past its 48 hours or already pending. */
export const submitStrikeAppeal = async (strikeId: string, cause: ExemptionCauseCode, justification: string): Promise<AppealResult> => {
  const { data, error } = await supabase.rpc('submit_exemption_request', {
    p_strike_id: strikeId,
    p_cause_code: cause,
    p_justification: justification.trim(),
    p_evidence: [],
    p_toda_is_party: false,
  });
  reportNetworkOutcome(error);
  if (error) return { ok: false, error: error.message.replace(/^Access Denied:\s*/, ''), assignedRole: null };
  const row = data as { success?: boolean; assigned_role?: string } | null;
  return row?.success ? { ok: true, error: null, assignedRole: row.assigned_role ?? null } : { ok: false, error: 'The appeal could not be sent. Please try again.', assignedRole: null };
};
