// Keyboard activation and tap-area helpers (packages/shared/src/utils/a11y.ts) used by the passenger and driver apps for cards and
// controls that cannot be a native <button>.
//   run:  cd server && npx tsx --test test/*.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { KeyboardEvent } from 'react';
import { activateWithKeyboard, extendTapArea } from '../../packages/shared/src/utils/a11y';

/** A stand-in for the React keyboard event: only the members activateWithKeyboard reads. */
function fakeKeyEvent(key: string, sameTarget = true) {
  const calls = { prevented: 0, clicked: 0 };
  const element = { click: () => { calls.clicked += 1; } };
  const event = {
    key,
    target: sameTarget ? element : { click: () => { calls.clicked += 100; } },
    currentTarget: element,
    preventDefault: () => { calls.prevented += 1; },
  };
  return { event: event as unknown as KeyboardEvent<HTMLElement>, calls };
}

describe('activateWithKeyboard', () => {
  it('clicks the element on Enter and stops the page from handling the key', () => {
    const { event, calls } = fakeKeyEvent('Enter');
    activateWithKeyboard(event);
    assert.equal(calls.clicked, 1);
    assert.equal(calls.prevented, 1);
  });

  it('clicks the element on Space and stops the page from scrolling', () => {
    const { event, calls } = fakeKeyEvent(' ');
    activateWithKeyboard(event);
    assert.equal(calls.clicked, 1);
    assert.equal(calls.prevented, 1);
  });

  it('ignores every other key', () => {
    for (const key of ['Tab', 'Escape', 'a', 'ArrowDown', 'Shift']) {
      const { event, calls } = fakeKeyEvent(key);
      activateWithKeyboard(event);
      assert.equal(calls.clicked, 0, key);
      assert.equal(calls.prevented, 0, key);
    }
  });

  it('leaves keys alone when they come from a field inside the element (typing a space in an input)', () => {
    const { event, calls } = fakeKeyEvent(' ', false);
    activateWithKeyboard(event);
    assert.equal(calls.clicked, 0);
    assert.equal(calls.prevented, 0);
  });
});

describe('extendTapArea', () => {
  it('grows the tappable area by the same amount on every side, drawn over the control', () => {
    const sx = extendTapArea(6);
    assert.equal(sx.position, 'relative');
    assert.deepEqual(sx['&::after'], { content: '""', position: 'absolute', top: -6, right: -6, bottom: -6, left: -6 });
  });

  it('defaults to 8px', () => {
    assert.equal(extendTapArea()['&::after'].top, -8);
  });
});
