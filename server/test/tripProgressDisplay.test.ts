// What a trip screen DRAWS for the progress (packages/shared/src/utils/tripProgress.ts): the figure moves toward the one the database checks at a pace a tricycle can
// explain, never goes back, shows arrival at once, and a position no tricycle could have reached is held back instead of dragging the bar to the end of the trip.
// Also the shared document viewer's kind detection and the pickup / destination marker markup.
//   run:  cd server && npx tsx --test test/*.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  calculateTripProgressPercent,
  isPlausibleFix,
  stepShownProgress,
  TRIP_PROGRESS_MAX_PLAUSIBLE_SPEED_MPS,
  TRIP_PROGRESS_MAX_RISE_POINTS_PER_SECOND,
} from '../../packages/shared/src/utils/tripProgress';

// mapMarkers.ts imports an image (the tricycle icon); this runner cannot read one, so the image import is answered with a plain string before the module loads
const nodeRequire = createRequire(import.meta.url) as NodeJS.Require & { extensions: Record<string, (m: { exports: unknown }) => void> };
nodeRequire.extensions['.webp'] = (m) => { m.exports = 'icon.webp'; };
const markers = nodeRequire('../../packages/shared/src/utils/mapMarkers') as typeof import('../../packages/shared/src/utils/mapMarkers');
const { destinationMarkerHtml, pickupMarkerHtml, placePopupElement, DESTINATION_MARKER_COLOR, PICKUP_MARKER_COLOR } = markers;

describe('stepShownProgress', () => {
  it('starts a screen at the figure it is given (no climb from zero when a trip is already under way)', () => {
    assert.equal(stepShownProgress(null, 64, 0), 64);
  });

  it('rises toward the target at most MAX points a second, so 64% does not leap to 95%', () => {
    let shown = 64;
    // one odd position says 95%; four seconds later the bar has only moved a few points
    for (let i = 0; i < 10; i += 1) shown = stepShownProgress(shown, 95, 400);
    assert.equal(Math.round(shown), 64 + Math.round(TRIP_PROGRESS_MAX_RISE_POINTS_PER_SECOND * 4));
    assert.ok(shown < 95);
  });

  it('never passes the target and reaches it', () => {
    let shown = 90;
    for (let i = 0; i < 40; i += 1) shown = stepShownProgress(shown, 93, 1000);
    assert.equal(shown, 93);
  });

  it('never goes back, however the target moves', () => {
    assert.equal(stepShownProgress(70, 40, 5000), 70);
  });

  it('shows arrival (100) at once: the status says so, not a position', () => {
    assert.equal(stepShownProgress(64, 100, 0), 100);
  });

  it('ignores a target that is not a number', () => {
    assert.equal(stepShownProgress(55, Number.NaN, 1000), 55);
    assert.equal(stepShownProgress(null, Number.NaN, 1000), 0);
    assert.equal(stepShownProgress(70, 40, 5000), 70);
  });
});

describe('isPlausibleFix', () => {
  const here = { lat: 13.4115, lng: 121.1803, atMs: 1_000_000 };
  it('believes the first position', () => {
    assert.equal(isPlausibleFix(null, here), true);
  });
  it('believes a tricycle that moved 40 m in 5 s', () => {
    assert.equal(isPlausibleFix(here, { lat: 13.4115 + 0.00036, lng: 121.1803, atMs: 1_005_000 }), true);
  });
  it('holds back a position 600 m away 5 s later (more than a tricycle can do)', () => {
    const jump = { lat: 13.4115 + 0.0054, lng: 121.1803, atMs: 1_005_000 };
    assert.equal(isPlausibleFix(here, jump), false);
    assert.ok((600 / 5) > TRIP_PROGRESS_MAX_PLAUSIBLE_SPEED_MPS);
  });
  it('believes a far position after a long silence (the phone slept)', () => {
    assert.equal(isPlausibleFix(here, { lat: 13.4115 + 0.0054, lng: 121.1803, atMs: 1_000_000 + 120_000 }), true);
  });
});

describe('the progress formula the figure comes from', () => {
  it('leaves the previous figure alone when the distance cannot be read (no position is invented)', () => {
    assert.equal(calculateTripProgressPercent({ totalKm: 2, driverToDestinationKm: Number.NaN, previousPercent: 40 }), 40);
  });
});

describe('the two places of a trip', () => {
  it('differ in colour and shape, and are SVG (sharp at every zoom)', () => {
    assert.notEqual(PICKUP_MARKER_COLOR, DESTINATION_MARKER_COLOR);
    const pickup = pickupMarkerHtml();
    const destination = destinationMarkerHtml();
    assert.ok(pickup.includes(PICKUP_MARKER_COLOR) && pickup.includes('<svg'));
    assert.ok(destination.includes(DESTINATION_MARKER_COLOR) && destination.includes('<svg') && destination.includes('<path'));
    assert.ok(!pickup.includes('<path'), 'the pickup is a badge, not a pin');
  });

  it('builds a popup from text only: an address can never inject markup', () => {
    const created: Array<{ textContent: string; children: unknown[] }> = [];
    const doc = {
      createElement: () => {
        const el = { textContent: '', style: { cssText: '' }, children: [] as unknown[], appendChild(child: unknown) { this.children.push(child); } };
        created.push(el);
        return el;
      },
    };
    (globalThis as unknown as { document: unknown }).document = doc;
    placePopupElement('Destination', '<img src=x onerror=alert(1)>');
    const texts = created.map((e) => e.textContent);
    assert.ok(texts.includes('<img src=x onerror=alert(1)>'), 'the address is set as text');
    assert.ok(!created.some((e) => 'innerHTML' in e), 'innerHTML is never used');
    delete (globalThis as unknown as { document?: unknown }).document;
  });
});
