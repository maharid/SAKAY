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
        <svg width="${s}" height="${s}" viewBox="0 0 52 52" aria-hidden="true" focusable="false"><path d="M26 1 L35 13 L26 9.5 L17 13 Z" fill="#C2410C" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round"/></svg>
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
