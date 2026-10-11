// Shared UI foundation (packages/shared): the peso formatter, the bottom-sheet drag decision, and the distance label.
//   run:  cd server && npx tsx --test test/*.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatPeso } from '../../packages/shared/src/utils/money';
import { resolveSheetDrag, SHEET_DRAG_THRESHOLD_PX } from '../../packages/shared/src/hooks/useSheetHandle';
import { formatDistance, needsFreshFix } from '../../packages/shared/src/utils/locationUtils';

describe('formatPeso', () => {
  it('shows whole pesos with their centavos', () => {
    assert.equal(formatPeso(63), '₱63.00');
    assert.equal(formatPeso(0), '₱0.00');
  });

  it('keeps centavos when an amount has them (it displays, never rounds to a whole peso)', () => {
    assert.equal(formatPeso(63.4), '₱63.40');
    assert.equal(formatPeso(71.6), '₱71.60');
    assert.equal(formatPeso(0.5), '₱0.50');
  });

  it('writes the thousands without a separator, so the amount is one unbroken token', () => {
    assert.equal(formatPeso(1250), '₱1250.00');
  });

  it('shows a dash for an amount that is not known yet', () => {
    assert.equal(formatPeso(null), '—');
    assert.equal(formatPeso(undefined), '—');
    assert.equal(formatPeso(Number.NaN), '—');
    assert.equal(formatPeso(Number.POSITIVE_INFINITY), '—');
  });
});

describe('resolveSheetDrag', () => {
  it('opens the sheet when it is dragged up by at least the threshold', () => {
    assert.equal(resolveSheetDrag(-SHEET_DRAG_THRESHOLD_PX), 'expand');
    assert.equal(resolveSheetDrag(-120), 'expand');
  });

  it('closes the sheet when it is dragged down by at least the threshold', () => {
    assert.equal(resolveSheetDrag(SHEET_DRAG_THRESHOLD_PX), 'collapse');
    assert.equal(resolveSheetDrag(120), 'collapse');
  });

  it('leaves the sheet alone for a short drag or none at all', () => {
    assert.equal(resolveSheetDrag(0), 'stay');
    assert.equal(resolveSheetDrag(SHEET_DRAG_THRESHOLD_PX - 1), 'stay');
    assert.equal(resolveSheetDrag(-(SHEET_DRAG_THRESHOLD_PX - 1)), 'stay');
  });

  it('uses the threshold it is given', () => {
    assert.equal(resolveSheetDrag(-20, 10), 'expand');
    assert.equal(resolveSheetDrag(20, 30), 'stay');
  });
});

describe('formatDistance', () => {
  it('writes metres under a kilometre and kilometres above, with one decimal', () => {
    assert.equal(formatDistance(0.23).replace(/\u00A0/g, ' '), '230 m');
    assert.equal(formatDistance(4.94).replace(/\u00A0/g, ' '), '4.9 km');
    assert.equal(formatDistance(1).replace(/\u00A0/g, ' '), '1.0 km');
  });

  it('joins the number and its unit with a no-break space so the label can never wrap between them', () => {
    for (const km of [0.23, 0.99, 1, 4.9, 12.34]) {
      const label = formatDistance(km);
      assert.ok(label.includes('\u00A0'), label);
      assert.ok(!label.includes(' '), `${label} contains a breaking space`);
    }
  });
});

describe('needsFreshFix (a driver standing still must keep a fresh position for the server)', () => {
  const now = 1_000_000;
  it('wants a position when there is none', () => {
    assert.equal(needsFreshFix(null, 45_000, now), true);
  });
  it('is content with a recent fix and asks again once it is older than the limit', () => {
    assert.equal(needsFreshFix({ latitude: 13.4, longitude: 121.1, timestamp: now - 10_000 }, 45_000, now), false);
    assert.equal(needsFreshFix({ latitude: 13.4, longitude: 121.1, timestamp: now - 45_000 }, 45_000, now), false);
    assert.equal(needsFreshFix({ latitude: 13.4, longitude: 121.1, timestamp: now - 45_001 }, 45_000, now), true);
  });
  it('does not guess about a fix with no time on it', () => {
    assert.equal(needsFreshFix({ latitude: 13.4, longitude: 121.1 }, 45_000, now), false);
  });
});
