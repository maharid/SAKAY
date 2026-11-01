// Pins that stand almost on the same spot lean their heads apart while every tip stays on its true position (packages/shared/src/utils/markerSeparation.ts).
//   run:  cd server && npx tsx --test test/markerSeparation.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SEPARATE_ENTER_PX, SEPARATE_EXIT_PX, SEPARATE_SPACING_PX, separatePins } from '../../packages/shared/src/utils/markerSeparation';

const pin = (id: string, x: number, y = 0) => ({ id, x, y });
const half = SEPARATE_SPACING_PX / 2;

describe('pins that are apart', () => {
  it('stay straight: nothing is in a group', () => {
    const r = separatePins([pin('own', 0), pin('pickup', 200), pin('destination', 500)]);
    assert.deepEqual(r.leans, {});
    assert.deepEqual(r.groups, []);
  });
  it('a lone pin, or none, is straight', () => {
    assert.deepEqual(separatePins([pin('own', 0)]).leans, {});
    assert.deepEqual(separatePins([]).leans, {});
  });
});

describe('two pins on the same spot', () => {
  it('lean apart by one spacing, half each way, in the order they were given when their tips are level', () => {
    const r = separatePins([pin('own', 100, 100), pin('pickup', 100, 100)]);
    assert.deepEqual(r.leans, { own: -half, pickup: half });
    assert.deepEqual(r.groups, [['own', 'pickup']]);
  });
  it('put the one whose tip is further left on the left', () => {
    const r = separatePins([pin('own', 130, 100), pin('pickup', 100, 100)]);
    assert.deepEqual(r.leans, { pickup: -half, own: half });
  });
  it('are far enough apart afterwards that two heads (about 40 px wide) cannot touch', () => {
    const r = separatePins([pin('own', 100, 100), pin('pickup', 100, 100)]);
    assert.ok(r.leans.pickup - r.leans.own >= 40);
  });
  it('keep the true positions: only the lean is reported, the points are not changed', () => {
    const input = [pin('own', 100, 100), pin('pickup', 103, 99)];
    const copy = JSON.parse(JSON.stringify(input));
    separatePins(input);
    assert.deepEqual(input, copy);
  });
  it('two pins above one another (the same x) are spread sideways too', () => {
    const r = separatePins([pin('own', 100, 90), pin('pickup', 100, 120)]);
    assert.deepEqual(Object.values(r.leans).sort((a, b) => a - b), [-half, half]);
  });
});

describe('three pins on the same spot', () => {
  it('spread in a row: left, middle (straight), right', () => {
    const r = separatePins([pin('own', 50), pin('pickup', 50), pin('driver', 50)]);
    assert.deepEqual(r.leans, { own: -SEPARATE_SPACING_PX, pickup: 0, driver: SEPARATE_SPACING_PX });
    assert.deepEqual(r.groups[0].length, 3);
  });
});

describe('a group does not flicker or jump', () => {
  it('forms below the enter distance, and breaks up only beyond the exit distance', () => {
    const near = [pin('own', 0), pin('pickup', SEPARATE_ENTER_PX - 1)];
    const between = [pin('own', 0), pin('pickup', (SEPARATE_ENTER_PX + SEPARATE_EXIT_PX) / 2)];
    const far = [pin('own', 0), pin('pickup', SEPARATE_EXIT_PX + 1)];
    assert.deepEqual(separatePins(between).leans, {}, 'not a group on its own at this distance');
    const formed = separatePins(near);
    assert.equal(Object.keys(formed.leans).length, 2);
    assert.equal(Object.keys(separatePins(between, formed.groups).leans).length, 2, 'still a group between the two distances');
    assert.deepEqual(separatePins(far, formed.groups).leans, {}, 'broken up beyond the exit distance');
  });
  it('keeps the heads in the order they were first spread when a tip drifts past another', () => {
    const first = separatePins([pin('own', 90), pin('pickup', 100)]);
    assert.ok(first.leans.own < first.leans.pickup);
    const drifted = separatePins([pin('own', 112), pin('pickup', 100)], first.groups);
    assert.ok(drifted.leans.own < drifted.leans.pickup, 'own stays on the left even though its tip is now further right');
  });
  it('puts a pin that joins where its tip lies among the others', () => {
    const first = separatePins([pin('own', 100), pin('pickup', 100)]);
    const joined = separatePins([pin('own', 100), pin('pickup', 100), pin('driver', 60)], first.groups);
    const row = joined.groups[0];
    assert.deepEqual(row, ['driver', 'own', 'pickup']);
  });
  it('forgets a group that is gone, so the next meeting is ordered by the tips again', () => {
    const first = separatePins([pin('own', 90), pin('pickup', 100)]);
    const apart = separatePins([pin('own', 0), pin('pickup', 400)], first.groups);
    assert.deepEqual(apart.groups, []);
    const again = separatePins([pin('own', 130), pin('pickup', 100)], apart.groups);
    assert.ok(again.leans.pickup < again.leans.own);
  });
});

describe('bad input', () => {
  it('ignores a pin whose position is not a number instead of spreading everything', () => {
    const r = separatePins([pin('own', Number.NaN), pin('pickup', 10), pin('destination', 10)]);
    assert.deepEqual(Object.keys(r.leans).sort(), ['destination', 'pickup']);
  });
});
