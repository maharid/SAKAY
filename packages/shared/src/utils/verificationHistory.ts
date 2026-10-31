/**
 * The verification history of one driver, as the database gives it (get_driver_verification_history): what happened to the application and its documents, when, who did it (the TODA, the
 * City LGU, or the driver) and with what outcome. Every row comes from a record the workflow already writes (audit log, document return history, the application, the Master Roster);
 * nothing here is estimated, so an event that was never recorded is simply not listed.
 */

export type VerificationActorRole = 'driver' | 'toda_admin' | 'lgu_admin';

export interface VerificationHistoryEvent {
  /** the exact time the workflow recorded (ISO) */
  at: string;
  /** registered, submitted, endorsed, verified, verified_override, returned, rejected, resubmitted, doc_returned, doc_replaced, renewal_submitted, renewal_decided, roster_added, roster_decided */
  key: string;
  label: string;
  actorRole: VerificationActorRole | string | null;
  actorName: string | null;
  todaId: string | null;
  todaName: string | null;
  outcome: string | null;
  detail: string | null;
}

/** The rows of get_driver_verification_history, as events. */
export function mapVerificationHistoryRows(rows: ReadonlyArray<Record<string, unknown>> | null | undefined): VerificationHistoryEvent[] {
  return (rows ?? []).map((r) => ({
    at: String(r.event_at ?? ''),
    key: String(r.event_key ?? ''),
    label: String(r.label ?? ''),
    actorRole: (r.actor_role as string | null) ?? null,
    actorName: (r.actor_name as string | null) ?? null,
    todaId: (r.toda_id as string | null) ?? null,
    todaName: (r.toda_name as string | null) ?? null,
    outcome: (r.outcome as string | null) ?? null,
    detail: (r.detail as string | null) ?? null,
  }));
}

/** Who did it, in words: "TODA · Maria Santos · Toda Two", "LGU · Ana Reyes", "Driver · Juan Cruz". The name is left out when the record has none. */
export function verificationActorLine(e: Pick<VerificationHistoryEvent, 'actorRole' | 'actorName' | 'todaName'>): string {
  const role = e.actorRole === 'toda_admin' ? 'TODA' : e.actorRole === 'lgu_admin' ? 'LGU' : e.actorRole === 'driver' ? 'Driver' : 'System';
  return [role, e.actorName, e.actorRole === 'toda_admin' ? e.todaName : null].filter(Boolean).join(' · ');
}

/** The exact time of an event, in Philippine time: "Oct 31, 2026, 2:35:04 PM". An unreadable value is shown as it came. */
export function formatHistoryTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Manila' });
}

export type VerificationOutcomeTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

/** The colour of an outcome: green for what moved the driver forward, red for a refusal, amber for a return, blue for the driver's own acts. */
export function verificationOutcomeTone(outcome: string | null | undefined): VerificationOutcomeTone {
  const o = (outcome ?? '').toLowerCase();
  if (/^(verified|approved|endorsed)/.test(o)) return 'success';
  if (/^(rejected|not approved)/.test(o)) return 'danger';
  if (/^(returned|awaiting)/.test(o)) return 'warning';
  if (/^(submitted|resubmitted|registered)/.test(o)) return 'info';
  return 'neutral';
}
