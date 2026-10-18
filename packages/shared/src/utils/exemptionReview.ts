/**
 * Rules 22, 25: what an administrator needs to review strike appeals (exemption requests), void a strike and close an account, in ONE place for
 * the LGU portal and the TODA portal: the call arguments (checked against the database by scripts/db-tests/batch3/appeals-client-contract.js), the
 * check of a decision before it is sent, and the reading of the database's rows into what a screen shows.
 * The DATABASE decides who may do what (an LGU Administrator decides anything; a TODA Administrator only the requests routed to their TODA; only the
 * LGU voids a strike or closes an account) and writes the audit entry; none of that is repeated here.
 */

export type ExemptionOutcome = 'FULL' | 'PARTIAL' | 'DENIED';
export type AppealSubjectType = 'passenger' | 'driver';

// ── call arguments ───────────────────────────────────────────────────────────

/** decide_exemption: Full waiver / Partial waiver (the points to waive) / Denied, always with the reason (Rules 25.6, 25.8). */
export const decideExemptionArgs = (requestId: string, outcome: ExemptionOutcome, reason: string, pointsToWaive?: number | null) => ({
  p_request_id: requestId,
  p_outcome: outcome,
  p_reason: reason.trim(),
  p_points_to_waive: outcome === 'PARTIAL' ? pointsToWaive ?? null : null,
});

/** escalate_exemption_request: a request pending TODA review goes to the LGU Administrator (Rule 25.4). */
export const escalateExemptionArgs = (requestId: string, reason: string) => ({ p_request_id: requestId, p_reason: reason.trim() });

/** admin_void_strike: the one way to remove a strike that should never have been issued (LGU Administrator). */
export const voidStrikeArgs = (strikeId: string, reason: string) => ({ p_strike_id: strikeId, p_reason: reason.trim() });

/** admin_close_account: permanent closure, after the whole violation history was reviewed (Rule 22.2). */
export const closeAccountArgs = (subjectType: AppealSubjectType, subjectId: string, reason: string, historyReviewed: boolean) => ({
  p_subject_type: subjectType,
  p_subject_id: subjectId,
  p_reason: reason.trim(),
  p_history_reviewed: historyReviewed,
});

// ── checks before sending (the database checks again) ────────────────────────

export const MIN_DECISION_REASON_LENGTH = 5;

/**
 * Why a decision cannot be sent yet, or null when it can. A reason is required for every outcome (25.6 / 25.8); a partial waiver needs a whole
 * number of points that is at least 1 and less than the strike's active points (all of them would be a full waiver).
 */
export function decisionProblem(outcome: ExemptionOutcome | null, reason: string, pointsToWaive: number | null, pointsActive: number): string | null {
  if (!outcome) return 'Choose the outcome of the review.';
  if (reason.trim().length < MIN_DECISION_REASON_LENGTH) return 'Write the reason for the decision: it is kept in the audit log and shown to the person.';
  if (outcome === 'PARTIAL') {
    if (pointsActive < 2) return 'A strike of one point can only be waived in full or denied.';
    if (pointsToWaive === null || !Number.isInteger(pointsToWaive) || pointsToWaive < 1 || pointsToWaive >= pointsActive) {
      return `Choose how many points to waive: from 1 to ${pointsActive - 1}.`;
    }
  }
  return null;
}

// ── what a screen shows ──────────────────────────────────────────────────────

export interface AppealRecord {
  requestId: string;
  subjectType: AppealSubjectType;
  subjectId: string;
  subjectName: string;
  strikeId: string;
  /** "Late cancellation (Rule 12.2)" */
  violation: string;
  strikeStatus: string;
  pointsActive: number;
  pointsIssued: number;
  causeCode: string;
  justification: string;
  evidenceUrls: string[];
  /** Pending TODA Review | Pending LGU Review | Full Waiver | Partial Waiver | Denied */
  status: string;
  assignedRole: string;
  requestedAt: string;
  /** Rule 25.6: three business days from the request */
  decisionDueAt: string | null;
  /** still waiting and past its due date */
  overdue: boolean;
  escalationReason: string | null;
  /** denied by the system because of the same cause three times in 30 days (Rule 25.7) */
  autoDenied: boolean;
  decidedAt: string | null;
  decisionReason: string | null;
  pointsWaived: number | null;
}

export const isPendingAppeal = (status: string): boolean => status === 'Pending TODA Review' || status === 'Pending LGU Review';

export const APPEAL_CAUSE_LABELS: Record<string, string> = {
  FORCE_MAJEURE: 'Force majeure (storm, flood, road closure)',
  VEHICLE_BREAKDOWN: 'Vehicle breakdown',
  NETWORK_OUTAGE: 'Signal or network outage',
  MEDICAL_EMERGENCY: 'Medical emergency',
  ACCIDENT_DOCUMENTED: 'Documented traffic accident',
  DEVICE_FAILURE: 'Phone or GPS failure',
  OTHER: 'Other cause',
};

type Row = Record<string, unknown>;

/** Reads the database's rows (exemption_request, with the strikes, the people and the violation catalog) into the records a review screen lists. */
export function mapAppealRows(
  input: { requests: Row[]; strikes: Row[]; people: Array<{ id: string; type: AppealSubjectType; name: string }>; catalog: Row[] },
  nowMs: number = Date.now()
): AppealRecord[] {
  const strikeById = new Map(input.strikes.map((s) => [String(s.strike_id), s]));
  const nameOf = new Map(input.people.map((p) => [`${p.type}:${p.id}`, p.name]));
  const described = new Map(input.catalog.map((c) => [String(c.violation_code), String(c.description)]));
  return input.requests.map((r) => {
    const strike = strikeById.get(String(r.strike_id));
    const type: AppealSubjectType = r.subject_type === 'driver' ? 'driver' : 'passenger';
    const status = String(r.status);
    const due = r.decision_due_at ? String(r.decision_due_at) : null;
    return {
      requestId: String(r.request_id),
      subjectType: type,
      subjectId: String(r.subject_id),
      subjectName: nameOf.get(`${type}:${String(r.subject_id)}`) ?? (type === 'driver' ? 'Driver' : 'Passenger'),
      strikeId: String(r.strike_id),
      violation: strike ? `${described.get(String(strike.violation_code)) ?? String(strike.violation_code)}${strike.source_rule ? ` (${String(strike.source_rule)})` : ''}` : 'Strike',
      strikeStatus: strike ? String(strike.status) : '',
      pointsActive: strike ? Number(strike.points_active ?? 0) : 0,
      pointsIssued: strike ? Number(strike.points_issued ?? 0) : 0,
      causeCode: String(r.cause_code),
      justification: String(r.justification ?? ''),
      evidenceUrls: Array.isArray(r.evidence_urls) ? (r.evidence_urls as unknown[]).map(String) : [],
      status,
      assignedRole: String(r.assigned_role ?? ''),
      requestedAt: String(r.requested_at),
      decisionDueAt: due,
      overdue: isPendingAppeal(status) && due !== null && Date.parse(due) < nowMs,
      escalationReason: r.escalation_reason ? String(r.escalation_reason) : null,
      autoDenied: Boolean(r.auto_denied),
      decidedAt: r.decided_at ? String(r.decided_at) : null,
      decisionReason: r.decision_reason ? String(r.decision_reason) : null,
      pointsWaived: r.points_waived === null || r.points_waived === undefined ? null : Number(r.points_waived),
    };
  });
}
