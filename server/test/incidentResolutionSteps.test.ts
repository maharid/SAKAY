// The LGU Administrator's four-step incident resolution (packages/shared/src/utils/incidentResolutionSteps.ts): what each step needs before the person may go on, and that the Next
// button, the stepper and the final button all use the same rules. A step is complete only when its requirements are done, never because it was opened.
//   run:  cd server && npx tsx --test test/*.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { INCIDENT_NOTE_MIN, NO_STRIKE, STRIKE_UNSET, firstOpenStep, investigationSaved, pointsProblem, stepComplete, stepRequirements } from '../../packages/shared/src/utils/incidentResolutionSteps';
import type { StepValues } from '../../packages/shared/src/utils/incidentResolutionSteps';

const STRIKES = [{ code: 'DRV_RUDE', min: 1, max: 3 }, { code: 'DRV_SUSPEND', min: 5, max: 5, lguOnly: true }];
const FINDINGS = 'The driver admitted raising his voice at the passenger.';

/** A report the LGU has just taken, nothing written yet */
const base = (over: Partial<StepValues> = {}): StepValues => ({
  closed: false,
  taken: true,
  pending: false,
  notes: '',
  contacted: [],
  saved: { notes: '', contacted: [] },
  outcome: '',
  strike: STRIKE_UNSET,
  points: '',
  decisionNote: '',
  strikeOptions: [],
  confirmed: false,
  ...over,
});
const withSaved = (over: Partial<StepValues> = {}): StepValues => base({ notes: FINDINGS, saved: { notes: FINDINGS, contacted: [] }, ...over });
const ready = (over: Partial<StepValues> = {}): StepValues => withSaved({ outcome: 'NOT_UPHELD', decisionNote: FINDINGS, ...over });
const missing = (step: number, v: StepValues) => stepRequirements(step, v).filter((r) => !r.done).map((r) => r.label);

describe('step 1: Review', () => {
  it('is not complete until the report is accepted or taken, and says which', () => {
    assert.equal(stepComplete(0, base({ taken: false, pending: true })), false);
    assert.deepEqual(missing(0, base({ taken: false, pending: true })), ['Accept the report for review']);
    assert.match(missing(0, base({ taken: false, pending: false }))[0], /^Take the report/);
    assert.equal(stepComplete(0, base()), true);
  });
});

describe('step 2: Investigate', () => {
  it('needs findings of at least ten characters, and says how many more', () => {
    assert.equal(stepComplete(1, base()), false);
    assert.match(missing(1, base({ notes: 'seen' }))[0], new RegExp(`${INCIDENT_NOTE_MIN} characters; 6 more`));
    assert.equal(stepComplete(1, base({ notes: '         ' })), false);
  });
  it('needs the findings to be SAVED on the report, not only typed', () => {
    const typed = base({ notes: FINDINGS });
    assert.deepEqual(missing(1, typed), ['Save the findings on the report']);
    assert.equal(stepComplete(1, withSaved()), true);
  });
  it('is incomplete again when the saved findings or the contacts are changed afterwards', () => {
    assert.equal(stepComplete(1, withSaved({ notes: `${FINDINGS} And more.` })), false);
    assert.equal(stepComplete(1, withSaved({ contacted: ['Driver'] })), false);
    assert.equal(investigationSaved(withSaved({ contacted: ['Driver'], saved: { notes: FINDINGS, contacted: ['Driver'] } })), true);
    assert.equal(investigationSaved(withSaved({ notes: `  ${FINDINGS}  ` })), true, 'spaces around the text are not a change');
  });
});

describe('step 3: Decide', () => {
  it('needs the outcome and the findings', () => {
    assert.deepEqual(missing(2, withSaved()), ['Choose the outcome', 'Write the findings and the reason for the decision (at least 10 characters)']);
    assert.equal(stepComplete(2, ready()), true);
    assert.equal(stepComplete(2, ready({ decisionNote: 'too short' })), false);
  });
  it('an upheld or fabricated report needs an explicit choice: a strike, or "No strike"', () => {
    const upheld = ready({ outcome: 'UPHELD', strikeOptions: STRIKES });
    assert.equal(stepComplete(2, upheld), false);
    assert.ok(missing(2, upheld).some((l) => /whether a strike applies/.test(l)));
    assert.equal(stepComplete(2, { ...upheld, strike: NO_STRIKE }), true, 'an explicit "No strike" is a choice');
    assert.equal(stepComplete(2, { ...upheld, strike: 'DRV_RUDE' }), true);
  });
  it('an outcome that carries no strike does not ask for one', () => {
    assert.equal(stepComplete(2, ready({ outcome: 'NOT_UPHELD', strike: STRIKE_UNSET, strikeOptions: [] })), true);
  });
  it('points outside the strike\'s range are refused with a sentence; empty means the default; the LGU-only strike has none', () => {
    const rude = ready({ outcome: 'UPHELD', strikeOptions: STRIKES, strike: 'DRV_RUDE' });
    assert.equal(pointsProblem(rude), null);
    assert.equal(pointsProblem({ ...rude, points: '2' }), null);
    assert.match(pointsProblem({ ...rude, points: '9' }) ?? '', /from 1 to 3/);
    assert.match(pointsProblem({ ...rude, points: '1.5' }) ?? '', /whole points/);
    assert.equal(stepComplete(2, { ...rude, points: '9' }), false);
    assert.equal(pointsProblem({ ...rude, strike: 'DRV_SUSPEND', points: '99' }), null);
  });
});

describe('step 4: Finalize', () => {
  it('needs the confirmation, and every earlier step complete', () => {
    assert.equal(stepComplete(3, ready()), false);
    assert.deepEqual(missing(3, ready()), ['Confirm that you have read the report and your findings']);
    assert.equal(stepComplete(3, ready({ confirmed: true })), true);
  });
  it('a confirmation does not make up for an earlier step that is not complete', () => {
    const done = stepComplete(3, withSaved({ confirmed: true }));
    assert.equal(done, false, 'no outcome yet');
    assert.ok(missing(3, withSaved({ confirmed: true })).includes('Steps 1 to 3 are complete'));
    assert.equal(stepComplete(3, ready({ confirmed: true, taken: false })), false, 'not taken');
  });
});

describe('where the window opens, and a closed report', () => {
  it('opens at the first step that is not complete', () => {
    assert.equal(firstOpenStep(base({ taken: false })), 0);
    assert.equal(firstOpenStep(base()), 1);
    assert.equal(firstOpenStep(withSaved()), 2);
    assert.equal(firstOpenStep(ready()), 3);
  });
  it('a step is never complete just because it was visited: nothing but the values decides', () => {
    assert.equal(stepComplete(1, base()), false);
    assert.equal(stepComplete(2, base()), false);
    assert.equal(stepComplete(3, base()), false);
  });
  it('a decided or withdrawn report has nothing left to do', () => {
    for (const step of [0, 1, 2, 3]) assert.equal(stepComplete(step, base({ closed: true, taken: false })), true);
  });
});
