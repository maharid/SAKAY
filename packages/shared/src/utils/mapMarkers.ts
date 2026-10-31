/**
 * The two live markers, drawn the same way in the Passenger and the Driver app so a person learns them once:
 *
 *   passenger   a BLUE circle with a white person (the colour maps use for "you / someone on foot")
 *   driver      an ORANGE circle with a white tricycle (the SAKAY colour), plus a small arrow around its edge that points the way it is
 *               travelling when a heading is known. The tricycle itself stays upright; only the arrow turns.
 *
 * Leaflet-free: these return the HTML for an `L.divIcon`, and `applyMarkerState` updates an element that is already on the map (turn the
 * arrow, dim a position that has gone stale) without rebuilding it. The icon shapes are the Material "Person" and "ElectricRickshaw"
 * glyphs. Inline styles only, so they look right without any stylesheet; the pulse is a CSS class each app defines (see animations.css).
 */

import appIconToto from '../assets/icons/app-icon-toto.webp';

const PERSON_PATH =
  'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4m0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4';

export const PASSENGER_MARKER_COLOR = '#FF6600';
export const DRIVER_MARKER_COLOR = '#FF6600';

/** `divIcon` size and anchor for each marker (the anchor is the centre: the marker sits ON its position) */
export const PASSENGER_MARKER_SIZE = 44;
export const DRIVER_MARKER_SIZE = 52;

const svg = (path: string, size: number) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="#FFFFFF" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;

export function passengerMarkerHtml(): string {
  const s = PASSENGER_MARKER_SIZE;
  return `
    <div class="sakay-marker sakay-passenger-marker" style="position:relative;width:${s}px;height:${s}px;">
      <div class="sakay-marker-pulse" style="position:absolute;inset:2px;border-radius:50%;background:${PASSENGER_MARKER_COLOR};opacity:0.22;"></div>
      <div class="sakay-marker-body" style="position:absolute;left:4px;top:4px;width:30px;height:30px;border-radius:50%;background:${PASSENGER_MARKER_COLOR};border:3px solid #FFFFFF;box-shadow:0 3px 10px rgba(255,102,0,0.45);display:flex;align-items:center;justify-content:center;box-sizing:content-box;">
        ${svg(PERSON_PATH, 18)}
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
//   pickup        a GREEN round badge with a white ring and centre (the start of the trip), centred on its position
//   destination   a RED map pin (the classic location pin) whose point is on its position
//
// They differ in colour AND in shape, so they cannot be mistaken for each other or for the orange person / tricycle (the live markers above).
// Both are SVG with a white outline and a soft shadow, drawn at a fixed pixel size, so they stay sharp and readable at every zoom; when the two
// places are close the destination is drawn on top (see DESTINATION_MARKER_Z_OFFSET). Pressing either opens a small popup naming the place.
// ---------------------------------------------------------------------------------------------------------------------------------------

export const PICKUP_MARKER_COLOR = '#15803D';
export const DESTINATION_MARKER_COLOR = '#DC2626';

/** `divIcon` size and anchor: the pickup badge is anchored at its centre, the destination pin at the tip of its point */
export const PICKUP_MARKER_SIZE = 34;
export const DESTINATION_MARKER_WIDTH = 34;
export const DESTINATION_MARKER_HEIGHT = 46;
export const PICKUP_MARKER_ANCHOR: [number, number] = [PICKUP_MARKER_SIZE / 2, PICKUP_MARKER_SIZE / 2];
export const DESTINATION_MARKER_ANCHOR: [number, number] = [DESTINATION_MARKER_WIDTH / 2, DESTINATION_MARKER_HEIGHT];
/** Where a popup opens relative to the anchor: above the marker, clear of it */
export const PICKUP_POPUP_OFFSET: [number, number] = [0, -(PICKUP_MARKER_SIZE / 2) - 2];
export const DESTINATION_POPUP_OFFSET: [number, number] = [0, -(DESTINATION_MARKER_HEIGHT - 4)];
/** Leaflet draws a higher offset on top: the destination wins where the two overlap, and both stay above the route line */
export const PICKUP_MARKER_Z_OFFSET = 600;
export const DESTINATION_MARKER_Z_OFFSET = 700;

export function pickupMarkerHtml(): string {
  const s = PICKUP_MARKER_SIZE;
  return `
    <div class="sakay-marker sakay-pickup-marker" role="img" aria-label="Pickup" style="position:relative;width:${s}px;height:${s}px;cursor:pointer;filter:drop-shadow(0 3px 5px rgba(15,23,42,0.35));">
      <svg width="${s}" height="${s}" viewBox="0 0 34 34" aria-hidden="true" focusable="false">
        <circle cx="17" cy="17" r="15" fill="#FFFFFF"/>
        <circle cx="17" cy="17" r="12" fill="${PICKUP_MARKER_COLOR}"/>
        <circle cx="17" cy="17" r="4.6" fill="#FFFFFF"/>
      </svg>
    </div>`;
}

export function destinationMarkerHtml(): string {
  const w = DESTINATION_MARKER_WIDTH;
  const h = DESTINATION_MARKER_HEIGHT;
  return `
    <div class="sakay-marker sakay-destination-marker" role="img" aria-label="Destination" style="position:relative;width:${w}px;height:${h}px;cursor:pointer;filter:drop-shadow(0 4px 6px rgba(15,23,42,0.4));">
      <svg width="${w}" height="${h}" viewBox="0 0 34 46" aria-hidden="true" focusable="false">
        <path d="M17 1.5C8.2 1.5 1.5 8.2 1.5 17c0 11.6 13.4 25.8 14.5 26.9a1.9 1.9 0 0 0 2 0C19.1 42.8 32.5 28.6 32.5 17 32.5 8.2 25.8 1.5 17 1.5Z" fill="${DESTINATION_MARKER_COLOR}" stroke="#FFFFFF" stroke-width="2.5" stroke-linejoin="round"/>
        <circle cx="17" cy="17" r="6.4" fill="#FFFFFF"/>
      </svg>
    </div>`;
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
export const TERMINAL_PIN_WIDTH = DESTINATION_MARKER_WIDTH;
export const TERMINAL_PIN_HEIGHT = DESTINATION_MARKER_HEIGHT;
export const TERMINAL_PIN_ANCHOR: [number, number] = DESTINATION_MARKER_ANCHOR;

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
