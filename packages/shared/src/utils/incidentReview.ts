/**
 * Reviewing an incident report (Section 19): what the TODA and LGU portals call and read. Every rule is the DATABASE's (migration 20261026000001): an administrator never writes
 * a report any more; each action below is one audited function that checks who may do it, does everything at once, and answers with the database's own sentence when it refuses.
 * The call names and their parameter names are checked against the database by scripts/db-tests/batch11/client-contract.js, and the strike lists below against
 * _incident_strike_options() and the violation catalog, so the two sides cannot drift apart.
 */
import type { RpcCapableClient } from './restrictionUtils';
import { callRpc } from './tripEnd';
import type { TripEndResult } from './tripEnd';
import { incidentCategoryClass } from './incidentReports';
import type { IncidentClass, IncidentReporter } from './incidentReports';

export type IncidentOutcome = 'UPHELD' | 'NOT_UPHELD' | 'FABRICATED' | 'RESOLVED' | 'UNCLAIMED';
export type LostItemStatus = 'Open' | 'Contact Arranged' | 'Returned' | 'Not Found' | 'Unclaimed';
export type IncidentRouting = 'TODA' | 'LGU';
export type IncidentPriority = 'Standard' | 'Emergency' | 'Serious';
export type IncidentActor = 'toda_admin' | 'lgu_admin';

/** The columns of incident_report the portals read (the database fills every one of them; none is ever sent) */
export interface IncidentRecord {
  incident_id: string;
  booking_id: string;
  passenger_id: string | null;
  driver_id: string | null;
  reported_by: string;
  category: string;
  description: string;
  status: string;
  created_at: string;
  routing: IncidentRouting;
  priority: IncidentPriority;
  subject_type: 'driver' | 'passenger' | null;
  source: 'USER' | 'SYSTEM';
  filed_during_trip: boolean;
  incident_latitude: number | null;
  incident_longitude: number | null;
  first_action_due_at: string | null;
  first_action_at: string | null;
  decision_due_at: string | null;
  escalated_at: string | null;
  escalation_reason: string | null;
  outcome: IncidentOutcome | null;
  decided_by_role: IncidentActor | null;
  strike_code: string | null;
  lost_item_status: LostItemStatus | null;
  lost_item_contact_at: string | null;
  resolution_notes: string | null;
  cancellation_reason: string | null;
  evidence_paths: string[] | null;
  resolved_at: string | null;
  reported_toda_id: string | null;
  /** the LGU Administrator who took the report in hand (null until one does) */
  reviewed_by_lgu?: string | null;
  /** set by the hourly sweep once the report has passed its first-action or decision time (migration 20261102000001) */
  overdue_kind?: 'first_action' | 'decision' | null;
  overdue_since?: string | null;
  /** the findings of the investigation, saved on the report (migration 20261103000001), who was contacted, and when they were saved */
  investigation_notes?: string | null;
  investigation_contacted?: string[] | null;
  investigation_recorded_at?: string | null;
}

// ---- the calls (the answers are the database's: TripEndResult says ok, the ERR_ code, and its own sentence) ------------------------------------------------------
/** Pending -> Under Investigation: the driver's TODA Administrator for a report with the TODA, the LGU Administrator for any */
export const startIncidentReview = (client: RpcCapableClient, incidentId: string): Promise<TripEndResult> => callRpc(client, 'incident_start_review', { p_incident_id: incidentId });
/** Rule 19.3: what the TODA cannot resolve, or what could mean a suspension or deactivation, goes to the LGU Administrator; serious=true reclassifies the report as serious (decision PI-11J) */
export const escalateIncident = (client: RpcCapableClient, incidentId: string, reason: string, serious = false): Promise<TripEndResult> =>
  callRpc(client, 'incident_escalate', { p_incident_id: incidentId, p_reason: reason, p_serious: serious });

/** The LGU Administrator takes a report in hand without deciding it: who is responsible is recorded and the TODA is told (migration 20261102000001) */
export const acknowledgeIncident = (client: RpcCapableClient, incidentId: string): Promise<TripEndResult> => callRpc(client, 'incident_lgu_acknowledge', { p_incident_id: incidentId });
/** Who an administrator can say they contacted during an investigation (the database accepts only these) */
export const INCIDENT_CONTACT_OPTIONS = ['Reporter', 'Driver', 'Passenger', 'TODA Administrator', 'Witness or other'] as const;
export type IncidentContact = (typeof INCIDENT_CONTACT_OPTIONS)[number];
/** Saves the findings of an investigation (and who was contacted) on the report, under the administrator's name. It changes no status, outcome, clock or strike. */
export const recordIncidentInvestigation = (client: RpcCapableClient, incidentId: string, notes: string, contacted: string[]): Promise<TripEndResult> =>
  callRpc(client, 'incident_record_investigation', { p_incident_id: incidentId, p_notes: notes, p_contacted: contacted });
/** A TODA administrator asks the LGU to act on a report that is with the LGU. The database refuses a second one inside the cooldown and answers with the time it is allowed again (data.next_allowed_at). */
export const sendIncidentFollowup = (client: RpcCapableClient, incidentId: string, message: string | null): Promise<TripEndResult> =>
  callRpc(client, 'incident_send_followup', { p_incident_id: incidentId, p_message: message });

/** One follow-up a TODA sent the LGU (incident_followup): who, when, what, and when another may be sent */
export interface IncidentFollowupRow {
  followup_id: string;
  incident_id: string;
  kind: 'reminder' | 'escalation';
  sequence_no: number;
  message: string | null;
  sent_by_name: string | null;
  sent_at: string;
  next_allowed_at: string;
}

export interface IncidentDecision {
  incidentId: string;
  outcome: 'UPHELD' | 'NOT_UPHELD' | 'FABRICATED' | 'RESOLVED';
  /** the findings, at least 10 characters */
  note: string;
  /** the strike the deciding administrator confirms (never automatic), or null */
  strikeCode: string | null;
  /** within the catalog's range; null = the minimum */
  points: number | null;
}
/** Rules 19.4, 19.5, 26.4: the outcome; the strike, if any, is issued as the confirming administrator */
export const decideIncident = (client: RpcCapableClient, d: IncidentDecision): Promise<TripEndResult> =>
  callRpc(client, 'incident_decide', { p_incident_id: d.incidentId, p_outcome: d.outcome, p_note: d.note, p_strike_code: d.strikeCode, p_points: d.points });
/** Rules 19.6, 29.19: the TODA-facilitated contact for a lost item, and what came of it */
export const updateLostItem = (client: RpcCapableClient, incidentId: string, status: Exclude<LostItemStatus, 'Open'>, note: string): Promise<TripEndResult> =>
  callRpc(client, 'incident_lost_item_update', { p_incident_id: incidentId, p_status: status, p_note: note });

// ---- the strikes an upheld report may carry (decision PI-11G; _incident_strike_options() holds the same lists) ----------------------------------------------------
export interface IncidentStrikeOption {
  code: string;
  en: string;
  /** the catalog's range; the deciding administrator picks within it (default the minimum) */
  min: number;
  max: number;
  /** true: the sanction suspends the account pending the investigation, which only the LGU Administrator decides (Rule 19.3) */
  lguOnly: boolean;
  /** who is struck: the reported party (UPHELD) or the reporter (FABRICATED) */
  subject: 'driver' | 'passenger';
}
const OPT = (code: string, en: string, min: number, max: number, subject: 'driver' | 'passenger', lguOnly = false): IncidentStrikeOption => ({ code, en, min, max, lguOnly, subject });
const DRV_RUDE = OPT('DRV_RUDE_UPHELD', 'Driver: rude behavior (1 - 2 strikes)', 1, 2, 'driver');
const DRV_UNSAFE = OPT('DRV_UNSAFE_DRIVING', 'Driver: unsafe or reckless driving (2 - 3 strikes)', 2, 3, 'driver');
const DRV_OVERCHARGE = OPT('DRV_OVERCHARGING', 'Driver: overcharging attempt (2 strikes)', 2, 2, 'driver');
const DRV_ROUTE = OPT('DRV_ROUTE_DEVIATION_FARE', 'Driver: route deviation that raised the fare (1 strike)', 1, 1, 'driver');
const DRV_ASSAULT = OPT('DRV_PHYSICAL_ALTERCATION', 'Driver: physical altercation (suspended pending investigation)', 0, 0, 'driver', true);
const DRV_HARASS = OPT('DRV_HARASSMENT', 'Driver: harassment or threats (suspended pending investigation)', 0, 0, 'driver', true);
const DRV_SUBSTITUTE = OPT('DRV_SUBSTITUTE_DRIVER', 'Driver: someone else drove the tricycle (suspended pending investigation)', 0, 0, 'driver', true);
const PAX_ABUSE = OPT('PAX_ABUSIVE_UPHELD', 'Passenger: abusive behavior (2 strikes)', 2, 2, 'passenger');
const PAX_DAMAGE = OPT('PAX_VEHICLE_DAMAGE', 'Passenger: damage to the vehicle (3 strikes)', 3, 3, 'passenger');
const PAX_CONTAM = OPT('PAX_CONTAMINATION', 'Passenger: contamination of the vehicle (1 strike)', 1, 1, 'passenger');

export function incidentStrikeOptions(category: string, reportedBy: string): IncidentStrikeOption[] {
  const by = reportedBy as IncidentReporter;
  if (category === 'Rude Behavior') return by === 'Passenger' ? [DRV_RUDE] : by === 'Driver' ? [PAX_ABUSE] : [];
  if (category === 'Unsafe Driving' || category === 'Reckless Driving') return by === 'Passenger' ? [DRV_UNSAFE] : [];
  if (category === 'Overcharging Attempt') return by === 'Passenger' ? [DRV_OVERCHARGE] : [];
  if (category === 'Route Deviation') return by === 'Passenger' ? [DRV_ROUTE] : [];
  if (category === 'Passenger Misconduct') return by === 'Driver' ? [PAX_ABUSE, PAX_DAMAGE, PAX_CONTAM] : [];
  if (category === 'Physical Assault') return by === 'Passenger' ? [DRV_ASSAULT] : by === 'Driver' ? [PAX_ABUSE] : [];
  if (category === 'Harassment' || category === 'Threat') return by === 'Passenger' ? [DRV_HARASS] : by === 'Driver' ? [PAX_ABUSE] : [];
  if (category === 'Unregistered Person Driving') return by === 'Passenger' ? [DRV_SUBSTITUTE] : [];
  return [];
}
/** Rule 19.5: the strike of a fabricated or malicious report is on the REPORTER (2 strikes, decision PI-11H) */
export const fabricatedStrikeOption = (reportedBy: string): IncidentStrikeOption | null =>
  reportedBy === 'Passenger' ? OPT('PAX_FABRICATED_REPORT', 'Passenger: fabricated or malicious report (2 strikes)', 2, 2, 'passenger')
  : reportedBy === 'Driver' ? OPT('DRV_FABRICATED_REPORT', 'Driver: fabricated or malicious report (2 strikes)', 2, 2, 'driver') : null;

/** The outcomes an administrator may give a report of this kind (the database refuses the rest) */
export function incidentOutcomesFor(category: string, reportedBy: string): Array<'UPHELD' | 'NOT_UPHELD' | 'FABRICATED' | 'RESOLVED'> {
  const k: IncidentClass | null = incidentCategoryClass(category);
  const reporterOk = reportedBy === 'Passenger' || reportedBy === 'Driver';
  if (k === 'LOST_ITEM') return ['NOT_UPHELD'];
  if (k === 'EMERGENCY') return reporterOk ? ['RESOLVED', 'UPHELD', 'NOT_UPHELD', 'FABRICATED'] : ['RESOLVED', 'UPHELD', 'NOT_UPHELD'];
  return reporterOk ? ['UPHELD', 'NOT_UPHELD', 'FABRICATED'] : ['UPHELD', 'NOT_UPHELD'];
}
export const INCIDENT_OUTCOME_LABEL: Record<IncidentOutcome, string> = {
  UPHELD: 'Upheld',
  NOT_UPHELD: 'Not upheld (dismissed)',
  FABRICATED: 'Fabricated or malicious',
  RESOLVED: 'Resolved, no fault assigned',
  UNCLAIMED: 'Closed as unclaimed',
};

// ---- the clocks of figure F11.1: shown, never acted on by the database (nothing is resolved by a deadline) --------------------------------------------------------
export interface IncidentClocks {
  /** nobody has acted on it and the time for the first action has passed */
  firstActionOverdue: boolean;
  /** it is not decided and the time for the decision has passed */
  decisionOverdue: boolean;
  overdue: boolean;
  /** the next deadline that applies, or null */
  nextDue: string | null;
}
export function incidentClocks(i: Pick<IncidentRecord, 'status' | 'outcome' | 'first_action_at' | 'first_action_due_at' | 'decision_due_at'>, now: number = Date.now()): IncidentClocks {
  const closed = i.outcome !== null || i.status === 'Cancelled' || i.status === 'Dismissed' || i.status === 'Resolved';
  const firstDue = i.first_action_due_at ? Date.parse(i.first_action_due_at) : NaN;
  const decisionDue = i.decision_due_at ? Date.parse(i.decision_due_at) : NaN;
  const firstActionOverdue = !closed && i.first_action_at === null && Number.isFinite(firstDue) && now > firstDue;
  const decisionOverdue = !closed && Number.isFinite(decisionDue) && now > decisionDue;
  const nextDue = closed ? null : i.first_action_at === null && Number.isFinite(firstDue) ? i.first_action_due_at : Number.isFinite(decisionDue) ? i.decision_due_at : null;
  return { firstActionOverdue, decisionOverdue, overdue: firstActionOverdue || decisionOverdue, nextDue };
}

// ---- who has to act now (the TODA's list of reports separates "needs my action" from "monitoring") -------------------------------------------------------------------
export type IncidentHandling = 'action' | 'monitoring' | 'closed';
/** For the administrator looking: an open report with them needs their action; an open report with the other side is only monitored; a decided or withdrawn one is closed. */
export function incidentHandling(i: Pick<IncidentRecord, 'routing' | 'priority' | 'outcome' | 'status'>, role: IncidentActor): IncidentHandling {
  if (i.outcome !== null || i.status === 'Cancelled' || i.status === 'Dismissed' || i.status === 'Resolved') return 'closed';
  const withLgu = i.routing === 'LGU' || i.priority === 'Serious';
  return (role === 'lgu_admin') === withLgu ? 'action' : 'monitoring';
}

/** The state of a report in plain words, and who holds it */
export function incidentStateWords(i: Pick<IncidentRecord, 'routing' | 'priority' | 'outcome' | 'status' | 'decided_by_role' | 'reviewed_by_lgu' | 'first_action_at'>, todaName?: string): { state: string; holder: string } {
  if (i.status === 'Cancelled') return { state: 'Withdrawn by the reporter', holder: 'Nobody: it is closed' };
  if (i.outcome !== null) return { state: `Decided (${INCIDENT_OUTCOME_LABEL[i.outcome].toLowerCase()})`, holder: i.decided_by_role === 'lgu_admin' ? 'Decided by the LGU Administrator' : 'Decided by the TODA Administrator' };
  if (i.routing === 'LGU' || i.priority === 'Serious') {
    return { state: i.reviewed_by_lgu ? 'Under LGU review' : 'Waiting for the LGU', holder: 'LGU Administrator' };
  }
  return { state: i.first_action_at ? 'Under TODA review' : 'Waiting for the first review', holder: todaName ? `TODA Administrator (${todaName})` : 'TODA Administrator' };
}
