import type L from 'leaflet';
import { separatePins } from './markerSeparation';
import type { PinGroups } from './markerSeparation';
import { DESTINATION_MARKER_Z_OFFSET, PICKUP_MARKER_Z_OFFSET, placeIconSpec, placeLabelsShown, placePopupElement } from './mapMarkers';
import type { PlaceKind } from './mapMarkers';

/**
 * The pickup and the destination of a trip on a Leaflet map, the same in the Passenger and the Driver app (and the shared trip view): a circle with the letter on a stem when the map
 * is far away or the pins are crowded, and a label with the word ("Pickup", "Destination") when the map is close up and there is room. The marker is swapped when the zoom changes;
 * pressing it opens a popup that names the place and its address. Leaflet itself is handed in by the app, so the app's own copy of it draws the markers.
 *
 * Pins that stand almost on the same spot (the person at the pickup, the driver arriving there) are kept apart: their heads lean sideways while the tips stay on the true positions
 * (see markerSeparation.ts). The places lean themselves; for the other pins (the person's own, the driver's) the app is told how far to lean through \`onLean\`.
 */

export interface PlaceInput {
  lat: number;
  lng: number;
  /** the word on the label and the popup's heading, in the screen's language ("Pickup", "Destinasyon") */
  title: string;
  address?: string | null;
}

/** A pin that is not a place but may stand on one: where it is now (null when it is not on the map) */
export interface OtherPin {
  id: string;
  point: () => { lat: number; lng: number } | null;
}

export interface PlaceMarkersOptions {
  pins?: OtherPin[];
  /** An other pin's head must lean this far now (pixels, positive: right; 0: straight). Told whenever it changes, and once at the start. */
  onLean?: (id: string, lean: number) => void;
}

export interface PlaceMarkersHandle {
  /** Stops watching the map; call it when the markers are redrawn or the map goes away */
  stop: () => void;
  /** Works out the spacing again: call it when one of the other pins has moved */
  refresh: () => void;
}

interface PlaceItem {
  kind: PlaceKind;
  place: PlaceInput;
  marker: L.Marker;
  labelled: boolean | null;
  lean: number | null;
}

/** Adds the markers to `layer` and keeps them right as the zoom and the other pins change. */
export function addPlaceMarkers(
  leaflet: typeof L,
  map: L.Map,
  layer: L.LayerGroup,
  places: { pickup?: PlaceInput | null; destination?: PlaceInput | null },
  options: PlaceMarkersOptions = {}
): PlaceMarkersHandle {
  const iconFor = (kind: PlaceKind, labelled: boolean, title: string, lean: number) => {
    const spec = placeIconSpec(kind, labelled, title, lean);
    return leaflet.divIcon({
      className: kind === 'pickup' ? 'leaflet-pickup-marker' : 'leaflet-destination-marker',
      html: spec.html,
      iconSize: spec.size,
      iconAnchor: spec.anchor,
      popupAnchor: spec.popupAnchor,
    });
  };

  const screenPoint = (p: { lat: number; lng: number }): { x: number; y: number } | null => {
    try {
      const point = map.latLngToContainerPoint([p.lat, p.lng]);
      return { x: point.x, y: point.y };
    } catch {
      return null; // the map has no view yet; the first zoom brings the answer
    }
  };

  const items: PlaceItem[] = [];
  const add = (kind: PlaceKind, place: PlaceInput | null | undefined) => {
    if (!place) return;
    const marker = leaflet.marker([place.lat, place.lng], {
      icon: iconFor(kind, false, place.title, 0),
      title: place.address ? `${place.title}: ${place.address}` : place.title,
      alt: place.title,
      keyboard: true,
      zIndexOffset: kind === 'pickup' ? PICKUP_MARKER_Z_OFFSET : DESTINATION_MARKER_Z_OFFSET,
    });
    marker.bindPopup(placePopupElement(place.title, place.address), { className: 'sakay-place-popup', autoPanPadding: [24, 24] });
    marker.addTo(layer);
    items.push({ kind, place, marker, labelled: false, lean: 0 });
  };
  add('pickup', places.pickup);
  add('destination', places.destination);

  let groups: PinGroups = [];
  const toldLean = new Map<string, number>();

  const refresh = () => {
    // 1. Where every pin's tip is on the screen now
    const pins: Array<{ id: string; x: number; y: number }> = [];
    for (const item of items) {
      const at = screenPoint(item.place);
      if (at) pins.push({ id: item.kind, ...at });
    }
    for (const other of options.pins ?? []) {
      const where = other.point();
      const at = where ? screenPoint(where) : null;
      if (at) pins.push({ id: other.id, ...at });
    }
    const separation = separatePins(pins, groups);
    groups = separation.groups;

    // 2. Words close up when the two places have room (and nothing crowds them); a leaning place is always the small circle
    const pickup = items.find((i) => i.kind === 'pickup');
    const destination = items.find((i) => i.kind === 'destination');
    const a = pickup ? screenPoint(pickup.place) : null;
    const b = destination ? screenPoint(destination.place) : null;
    const gap = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
    const wordsFit = placeLabelsShown(map.getZoom?.() ?? Number.NaN, gap);
    for (const item of items) {
      const crowded = item.kind in separation.leans;
      const lean = separation.leans[item.kind] ?? 0;
      const labelled = wordsFit && !crowded;
      if (item.labelled === labelled && item.lean === lean) continue;
      item.labelled = labelled;
      item.lean = lean;
      item.marker.setIcon(iconFor(item.kind, labelled, item.place.title, lean));
    }

    // 3. The other pins are told how to lean (the app redraws them)
    for (const other of options.pins ?? []) {
      const lean = separation.leans[other.id] ?? 0;
      if (toldLean.get(other.id) === lean) continue;
      toldLean.set(other.id, lean);
      options.onLean?.(other.id, lean);
    }
  };

  refresh();
  map.on('zoomend', refresh);
  return {
    stop: () => {
      map.off('zoomend', refresh);
    },
    refresh,
  };
}
