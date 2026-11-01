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
const { ownPinSpec, OWN_PIN_HEAD, placeIconSpec, placeLabelsShown, placePopupElement, PLACE_LABEL_MIN_GAP_PX, PLACE_LABEL_MIN_ZOOM, PLACE_MARKER_COLOR } = markers;

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
  it('are a black circle with the letter P or D, anchored at the tip of their stem', () => {
    const pickup = placeIconSpec('pickup', false);
    const destination = placeIconSpec('destination', false);
    assert.ok(pickup.html.includes(PLACE_MARKER_COLOR) && pickup.html.includes('>P</div>') && pickup.html.includes('sakay-pickup-marker'));
    assert.ok(destination.html.includes(PLACE_MARKER_COLOR) && destination.html.includes('>D</div>') && destination.html.includes('sakay-destination-marker'));
    // the anchor is the bottom centre of the marker: the stem's tip is the place
    for (const spec of [pickup, destination]) {
      assert.deepEqual(spec.anchor, [spec.size[0] / 2, spec.size[1]]);
      assert.ok(spec.popupAnchor[1] < 0, 'the popup opens above the marker');
    }
    assert.ok(pickup.size[0] <= 40 && pickup.size[1] <= 56, 'not oversized');
  });

  it('open into a label with the word, centred on the same tip, and never wider than the cap', () => {
    const label = placeIconSpec('pickup', true, 'Pickup');
    assert.ok(label.html.includes('>Pickup</div>'));
    assert.deepEqual(label.anchor, [label.size[0] / 2, label.size[1]]);
    const word = placeIconSpec('destination', true, 'Destinasyon');
    assert.ok(word.html.includes('>Destinasyon</div>'));
    assert.ok(word.size[0] > label.size[0], 'a longer word is a wider label');
    assert.equal(placeIconSpec('destination', true, 'x'.repeat(200)).size[0], 190);
    assert.ok(placeIconSpec('pickup', true).html.includes('>Pickup</div>'), 'the default word');
  });

  it('write the word as text only: a title can never inject markup', () => {
    const spec = placeIconSpec('pickup', true, '<img src=x onerror=alert(1)>');
    assert.ok(!spec.html.includes('<img'), 'no element is made from the title');
    assert.ok(spec.html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  });

  it('show their words only close up, and only when the two places have room for two labels', () => {
    assert.equal(placeLabelsShown(PLACE_LABEL_MIN_ZOOM - 1, null), false);
    assert.equal(placeLabelsShown(PLACE_LABEL_MIN_ZOOM, null), true, 'a single place has no neighbour to crowd');
    assert.equal(placeLabelsShown(17, PLACE_LABEL_MIN_GAP_PX), true);
    assert.equal(placeLabelsShown(17, PLACE_LABEL_MIN_GAP_PX - 1), false, 'two labels would overlap: both stay circles');
    assert.equal(placeLabelsShown(Number.NaN, null), false, 'no zoom yet: the small circles');
    assert.equal(placeLabelsShown(undefined as unknown as number, 500), false);
  });

  it('builds the person\'s own pin from their picture or the first letter of their name', () => {
    const withPhoto = ownPinSpec({ face: 'profile', profile: { name: 'alma santos', photoUrl: 'https://example.test/me.jpg?x=1&y=2' } }).html;
    assert.ok(withPhoto.includes('<img src="https://example.test/me.jpg?x=1&amp;y=2"'), 'the picture, with its address escaped');
    assert.ok(withPhoto.includes('>A</span>'), 'the letter sits under the picture, so a picture that fails to load leaves it showing');
    const withoutPhoto = ownPinSpec({ face: 'profile', profile: { name: 'Bea' } }).html;
    assert.ok(!withoutPhoto.includes('<img') && withoutPhoto.includes('>B</span>'));
    const unknown = ownPinSpec({ face: 'profile' }).html;
    assert.ok(!unknown.includes('<img') && unknown.includes('<svg'), 'no name: the person glyph');
    assert.ok(withPhoto.includes('sakay-marker-body'), 'the circle can be dimmed when its position is stale');
  });

  it('shows the SAKAY tricycle (app-icon-toto) instead of the profile during a booking', () => {
    const tricycle = ownPinSpec({ face: 'tricycle', profile: { name: 'Alma', photoUrl: 'https://example.test/me.jpg' }, heading: true }).html;
    assert.ok(tricycle.includes('src="icon.webp"'), 'the app icon');
    assert.ok(!tricycle.includes('me.jpg') && !tricycle.includes('>A</span>'), 'not the profile');
  });

  it('draws the direction arrow only when asked, and anchors every own pin at the tip of its pointer', () => {
    assert.ok(ownPinSpec({ face: 'tricycle', heading: true }).html.includes('sakay-marker-heading'));
    assert.ok(!ownPinSpec({ face: 'profile' }).html.includes('sakay-marker-heading'));
    for (const heading of [false, true]) {
      const spec = ownPinSpec({ face: 'profile', heading });
      assert.equal(spec.anchor[0], spec.size[0] / 2, 'the tip is the middle of the marker');
      assert.ok(spec.anchor[1] < spec.size[1] && spec.anchor[1] > OWN_PIN_HEAD, 'the tip is under the circle, at the bottom');
    }
  });

  it('never lets a name or a picture address break out of the markup', () => {
    const html = ownPinSpec({ face: 'profile', profile: { name: '<script>alert(1)</script>', photoUrl: 'x" onerror="alert(1)' } }).html;
    assert.ok(!html.includes('<script>') && !html.includes('" onerror="'));
    assert.ok(html.includes('&lt;') && html.includes('&quot; onerror=&quot;'));
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
