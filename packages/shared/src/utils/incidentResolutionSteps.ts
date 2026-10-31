/**
 * What each step of the LGU Administrator's incident resolution needs (Review, Investigate, Decide, Finalize), in ONE place: the Next button, the stepper, the checklist and the last
 * check before finalizing all read it, so they cannot disagree. A step is complete only when what it needs is done (never because it was opened). Pure rules, no screen.
 */
import type { IncidentDecision } from './incidentReview';

/** The shortest findings or reason the database accepts (ERR_INCIDENT_NOTE) */
export const INCIDENT_NOTE_MIN = 10;
/** The strike box before the person has chosen: a real choice ("No strike" or a strike) is required, so the box is never answered by leaving it alone */
export const STRIKE_UNSET = '__unset';
export const NO_STRIKE = '';

export interface StepRequirement {
  label: string;
  done: boolean;
}
export interface SavedInvestigation {
  notes: string;
  contacted: string[];
}
export interface StepValues {
  /** the report is decided or withdrawn: nothing is left to do */
  closed: boolean;
  /** the administrator has accepted / taken the report */
  taken: boolean;
  /** the report is still waiting for review (so the first step says "Accept", not "Take") */
  pending: boolean;
  notes: string;
  contacted: string[];
  /** what is saved on the report */
  saved: SavedInvestigation;
  outcome: IncidentDecision['outcome'] | '';
  strike: string;
  points: string;
  /** the findings and reason of the decision */
  decisionNote: string;
  strikeOptions: Array<{ code: string; lguOnly?: boolean; min: number; max: number }>;
  confirmed: boolean;
}

const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

/** The findings are written and are the ones saved on the report (a changed text is not yet the saved one) */
export const investigationSaved = (v: StepValues): boolean =>
  v.saved.notes.trim().length >= INCIDENT_NOTE_MIN && v.notes.trim() === v.saved.notes.trim() && sameSet(v.contacted, v.saved.contacted);

/** A sentence when the points typed do not fit the strike's range, else null (empty means the default) */
export function pointsProblem(v: StepValues): string | null {
  const chosen = v.strikeOptions.find((o) => o.code === v.strike);
  if (!chosen || chosen.lguOnly || chosen.max <= chosen.min || v.points.trim() === '') return null;
  const n = Number(v.points);
  return Number.isInteger(n) && n >= chosen.min && n <= chosen.max ? null : `Enter whole points from ${chosen.min} to ${chosen.max}, or leave the box empty for ${chosen.min}.`;
}

/** What a step needs, each item done or not (step 0 Review, 1 Investigate, 2 Decide, 3 Finalize) */
export function stepRequirements(step: number, v: StepValues): StepRequirement[] {
  if (step === 0) return [{ label: v.pending ? 'Accept the report for review' : 'Take the report, so you are recorded as responsible for it', done: v.taken }];
  if (step === 1) {
    const length = v.notes.trim().length;
    return [
      { label: length >= INCIDENT_NOTE_MIN ? 'Write your investigation findings' : `Write your investigation findings (at least ${INCIDENT_NOTE_MIN} characters; ${INCIDENT_NOTE_MIN - length} more)`, done: length >= INCIDENT_NOTE_MIN },
      { label: 'Save the findings on the report', done: investigationSaved(v) },
    ];
  }
  if (step === 2) {
    const needsStrike = (v.outcome === 'UPHELD' || v.outcome === 'FABRICATED') && v.strikeOptions.length > 0;
    const out: StepRequirement[] = [{ label: 'Choose the outcome', done: Boolean(v.outcome) }];
    if (needsStrike) out.push({ label: 'Choose whether a strike applies (or "No strike")', done: v.strike !== STRIKE_UNSET });
    const problem = pointsProblem(v);
    if (problem) out.push({ label: problem, done: false });
    out.push({ label: `Write the findings and the reason for the decision (at least ${INCIDENT_NOTE_MIN} characters)`, done: v.decisionNote.trim().length >= INCIDENT_NOTE_MIN });
    return out;
  }
  return [
    { label: 'Steps 1 to 3 are complete', done: [0, 1, 2].every((s) => stepRequirements(s, v).every((r) => r.done)) },
    { label: 'Confirm that you have read the report and your findings', done: v.confirmed },
  ];
}

/** A step is complete when everything it needs is done (a closed report has nothing left to do) */
export const stepComplete = (step: number, v: StepValues): boolean => v.closed || stepRequirements(step, v).every((r) => r.done);

/** The first of the three working steps that is not complete (3 = all done, ready to finalize): where the window opens, and the furthest a draft may open */
export function firstOpenStep(v: StepValues): number {
  for (let s = 0; s < 3; s += 1) if (!stepComplete(s, v)) return s;
  return 3;
}
