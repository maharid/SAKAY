/**
 * The markers of the Passenger and the Driver map, drawn the same way in both apps so a person learns them once:
 *
 *   you (passenger)  an ORANGE circle with a white ring showing the person's own profile picture (or the first letter of their name), on a short pointer whose tip is the position
 *   pickup           a BLACK circle with a white ring and a white "P" on a thin stem; close up it opens into a black label that says "Pickup"
 *   destination      the same with a "D", and the label "Destination"
 *   driver           an ORANGE circle with a white tricycle, plus a small arrow around its edge that points the way it is travelling when a heading is known.
 *                    The tricycle itself stays upright; only the arrow turns.
 *
 * Every pin is anchored at the bottom of its stem or pointer, so the tip is the exact place on the map. Leaflet-free: these return the HTML for an `L.divIcon` (and its size and
 * anchor), and `applyMarkerState` updates an element that is already on the map (turn the arrow, dim a position that has gone stale) without rebuilding it. Inline styles only, so
 * they look right without any stylesheet.
 */

import appIconToto from '../assets/icons/app-icon-toto.webp';

const PERSON_PATH =
  'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4m0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4';

export const PASSENGER_MARKER_COLOR = '#FF6600';
export const DRIVER_MARKER_COLOR = '#FF6600';

/** `divIcon` size and anchor. The driver's marker sits ON its position (anchored at its centre); the passenger's pin stands ON it (anchored at the tip of its pointer). */
export const DRIVER_MARKER_SIZE = 52;
export const PASSENGER_MARKER_WIDTH = 40;
export const PASSENGER_MARKER_HEIGHT = 48;
export const PASSENGER_MARKER_ANCHOR: [number, number] = [PASSENGER_MARKER_WIDTH / 2, PASSENGER_MARKER_HEIGHT - 2];

const svg = (path: string, size: number) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="#FFFFFF" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;

/** Text that came from a person (a name, an address, a picture address) is only ever put into the markup escaped */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** A small flat shadow on the ground at the tip of a pin (the same under every pin) */
const GROUND_SHADOW = 'position:absolute;left:50%;bottom:0;width:12px;height:5px;margin-left:-6px;border-radius:50%;background:rgba(15,23,42,0.32);filter:blur(1px);';

export interface OwnMarkerProfile {
  /** The person's name: its first letter is shown when there is no picture (or the picture cannot be loaded) */
  name?: string | null;
  /** The profile picture, when the account has one */
  photoUrl?: string | null;
}

/**
 * The person's own position on the map: their profile picture in an orange circle with a white ring, on a short pointer. Without a picture the circle shows the first letter of
 * the name (or the person glyph when even that is unknown); a picture that cannot be loaded leaves the letter showing, since the picture is drawn over it.
 */
export function passengerMarkerHtml(profile: OwnMarkerProfile = {}): string {
  const w = PASSENGER_MARKER_WIDTH;
  const h = PASSENGER_MARKER_HEIGHT;
  const initial = (profile.name ?? '').trim().charAt(0).toUpperCase();
  const photo = (profile.photoUrl ?? '').trim();
  const face = initial
    ? `<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#FFFFFF;font:700 17px/1 Poppins,sans-serif;">${escapeHtml(initial)}</span>`
    : `<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">${svg(PERSON_PATH, 22)}</span>`;
  const picture = photo
    ? `<img src="${escapeHtml(photo)}" alt="" draggable="false" referrerpolicy="no-referrer" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;" />`
    : '';
  return `
    <div class="sakay-marker sakay-passenger-marker" role="img" aria-label="Your location" style="position:relative;width:${w}px;height:${h}px;">
      <div style="${GROUND_SHADOW}"></div>
      <div style="position:absolute;left:50%;top:31px;width:12px;height:12px;margin-left:-6px;background:#FFFFFF;transform:rotate(45deg);border-radius:2px;box-shadow:1px 2px 3px rgba(15,23,42,0.28);"></div>
      <div class="sakay-marker-body" style="position:absolute;left:0;top:0;width:${w}px;height:${w}px;box-sizing:border-box;border-radius:50%;background:${PASSENGER_MARKER_COLOR};border:3px solid #FFFFFF;overflow:hidden;box-shadow:0 3px 8px rgba(255,102,0,0.45);">
        ${face}${picture}
      </div>
    </div>`;
}

export function driverMarkerHtml(): string {
  const s = DRIVER_MARKER_SIZE;
  return `
    <div class="sakay-marker sakay-driver-marker" style="position:relative;width:${s}px;height:${s}px;">
      <div class="sakay-marker-heading" style="position:absolute;inset:0;opacity:0;transition:transform 0.35s linear, opacity 0.2s ease;transform-origin:50% 50%;">
        <svg width="${s}" height="${s}" viewBox="0 0 52 52" aria-hidden="true" focusable="false"><path d="M26 1 L35 13 L26 9.5 L17 13 Z" fill="#FF6600" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round"/></svg>
      </div>
      <div class="sakay-marker-body" style="position:absolute;left:7px;top:7px;width:32px;height:32px;border-radius:50%;background:${DRIVER_MARKER_COLOR};border:3px solid #FFFFFF;box-shadow:0 4px 14px rgba(255,102,0,0.55);display:flex;align-items:center;justify-content:center;box-sizing:content-box;">
        <img src="${appIconToto}" alt="Driver" style="width:26px;height:26px;object-fit:contain;display:block;" />
      </div>
    </div>`;
}

export interface MarkerState {
  /** Degrees to draw the arrow at (it may leave [0, 360): it keeps counting so it turns the short way); null hides the arrow */
  rotation?: number | null;
  /** A position that has not been refreshed lately is drawn dimmer, so nobody trusts it as live */
  stale?: boolean;
}

/** Updates a marker element already on the map. Safe to call with null (a marker that is not there yet). */
export function applyMarkerState(root: HTMLElement | null | undefined, state: MarkerState): void {
  if (!root) return;
  const heading = root.querySelector<HTMLElement>('.sakay-marker-heading');
  if (heading && state.rotation !== undefined) {
    if (state.rotation === null) {
      heading.style.opacity = '0';
    } else {
      heading.style.opacity = '1';
      heading.style.transform = `rotate(${state.rotation}deg)`;
    }
  }
  if (state.stale !== undefined) {
    const body = root.querySelector<HTMLElement>('.sakay-marker-body');
    if (body) body.style.opacity = state.stale ? '0.55' : '1';
    root.setAttribute('data-stale', state.stale ? 'true' : 'false');
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// The two PLACES of a trip, drawn the same way in the Passenger and the Driver app:
//
//   pickup        a black circle with a white ring and a "P" on a thin white stem, or, close up, a black label that says "Pickup"
//   destination   the same with a "D", and "Destination"
//
// The tip of the stem is the place. Far away the small circle keeps the map readable; close up the label says which is which. When the two places are too near each other on the
// screen for two labels, both stay circles (see placeLabelsShown). Both are drawn at a fixed pixel size with a white ring, so they stay sharp on any map colour and at every zoom.
// ---------------------------------------------------------------------------------------------------------------------------------------

export type PlaceKind = 'pickup' | 'destination';

export const PLACE_MARKER_COLOR = '#111111';
const PLACE_HEAD = 34;
const PLACE_STEM = 16;
const PLACE_HEIGHT = PLACE_HEAD + PLACE_STEM;
const PLACE_LABEL_MAX_WIDTH = 190;

/** Leaflet draws a higher offset on top: the destination wins where the two overlap, and both stay above the route line */
export const PICKUP_MARKER_Z_OFFSET = 600;
export const DESTINATION_MARKER_Z_OFFSET = 700;

/** The labels show from this zoom on (street level), and only when the two places are at least this far apart on the screen, in pixels */
export const PLACE_LABEL_MIN_ZOOM = 15;
export const PLACE_LABEL_MIN_GAP_PX = 140;

/** Whether the places are drawn with their word ("Pickup") instead of their letter. `gapPx` is the distance between the two places on the screen, null when only one is on the map. */
export function placeLabelsShown(zoom: number, gapPx: number | null): boolean {
  if (!(zoom >= PLACE_LABEL_MIN_ZOOM)) return false;
  return gapPx === null || !Number.isFinite(gapPx) || gapPx >= PLACE_LABEL_MIN_GAP_PX;
}

export interface PlaceIconSpec {
  html: string;
  /** `divIcon` iconSize, iconAnchor (the tip of the stem) and popupAnchor (just above the head, so the popup opens clear of the marker) */
  size: [number, number];
  anchor: [number, number];
  popupAnchor: [number, number];
}

/** The icon of a place: the letter in a circle, or, when `labelled`, the word in a label (`title` is the word, in the screen's language). */
export function placeIconSpec(kind: PlaceKind, labelled: boolean, title?: string): PlaceIconSpec {
  const letter = kind === 'pickup' ? 'P' : 'D';
  const word = (title || (kind === 'pickup' ? 'Pickup' : 'Destination')).trim();
  const label = labelled ? word : letter;
  // a label is as wide as its text (about 8.5 px a letter at this size) and never wider than the cap: the text then ends with an ellipsis
  const width = labelled ? Math.min(PLACE_LABEL_MAX_WIDTH, Math.max(PLACE_HEAD, Math.round(label.length * 8.5) + 34)) : PLACE_HEAD;
  const head = labelled
    ? `position:absolute;left:50%;top:0;transform:translateX(-50%);max-width:${PLACE_LABEL_MAX_WIDTH}px;height:${PLACE_HEAD}px;box-sizing:border-box;padding:0 13px;border-radius:999px;font:700 14px/28px Poppins,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`
    : `position:absolute;left:0;top:0;width:${PLACE_HEAD}px;height:${PLACE_HEAD}px;box-sizing:border-box;border-radius:50%;font:700 15px/28px Poppins,sans-serif;text-align:center;`;
  const html = `
    <div class="sakay-marker sakay-${kind}-marker" role="img" aria-label="${kind === 'pickup' ? 'Pickup' : 'Destination'}" style="position:relative;width:${width}px;height:${PLACE_HEIGHT}px;cursor:pointer;">
      <div style="${GROUND_SHADOW}"></div>
      <div style="position:absolute;left:50%;top:${PLACE_HEAD - 6}px;width:3px;height:${PLACE_STEM + 6}px;margin-left:-1.5px;border-radius:2px;background:#FFFFFF;box-shadow:0 1px 3px rgba(15,23,42,0.4);"></div>
      <div style="${head}background:${PLACE_MARKER_COLOR};color:#FFFFFF;border:3px solid #FFFFFF;box-shadow:0 2px 6px rgba(15,23,42,0.4);">${escapeHtml(label)}</div>
    </div>`;
  return { html, size: [width, PLACE_HEIGHT], anchor: [width / 2, PLACE_HEIGHT], popupAnchor: [0, -(PLACE_HEIGHT - 2)] };
}

/**
 * The content of the popup a place's marker opens: a heading ("Pickup" / "Destination") and, when the booking has one, the address.
 * Built as DOM text, never as HTML, so an address typed by a person can never inject markup.
 */
export function placePopupElement(heading: string, address?: string | null): HTMLElement {
  const root = document.createElement('div');
  root.style.cssText = 'min-width:140px;max-width:240px;font-family:inherit;line-height:1.35;';
  const title = document.createElement('div');
  title.textContent = heading;
  title.style.cssText = 'font-size:13px;font-weight:700;color:#0F172A;';
  root.appendChild(title);
  const text = (address || '').trim();
  if (text) {
    const detail = document.createElement('div');
    detail.textContent = text;
    detail.style.cssText = 'margin-top:2px;font-size:12px;font-weight:500;color:#475569;overflow-wrap:anywhere;';
    root.appendChild(detail);
  }
  return root;
}

// A TODA's terminal on a map (the LGU portal): the same pin shape as the destination, in the SAKAY orange (or amber for a place the TODA asked to move to), with a square
// in the middle so it is never taken for a trip's destination.
export const TERMINAL_PIN_COLOR = '#C75000';
export const PROPOSED_TERMINAL_PIN_COLOR = '#B45309';
export const TERMINAL_PIN_WIDTH = 34;
export const TERMINAL_PIN_HEIGHT = 46;
export const TERMINAL_PIN_ANCHOR: [number, number] = [TERMINAL_PIN_WIDTH / 2, TERMINAL_PIN_HEIGHT];

export function terminalPinHtml(color: string = TERMINAL_PIN_COLOR): string {
  const w = TERMINAL_PIN_WIDTH;
  const h = TERMINAL_PIN_HEIGHT;
  return `
    <div class="sakay-marker sakay-terminal-pin" role="img" aria-label="Terminal" style="position:relative;width:${w}px;height:${h}px;cursor:pointer;filter:drop-shadow(0 4px 6px rgba(15,23,42,0.4));">
      <svg width="${w}" height="${h}" viewBox="0 0 34 46" aria-hidden="true" focusable="false">
        <path d="M17 1.5C8.2 1.5 1.5 8.2 1.5 17c0 11.6 13.4 25.8 14.5 26.9a1.9 1.9 0 0 0 2 0C19.1 42.8 32.5 28.6 32.5 17 32.5 8.2 25.8 1.5 17 1.5Z" fill="${color}" stroke="#FFFFFF" stroke-width="2.5" stroke-linejoin="round"/>
        <rect x="11.5" y="11.5" width="11" height="11" rx="2" fill="#FFFFFF"/>
      </svg>
    </div>`;
}
