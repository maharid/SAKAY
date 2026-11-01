import type L from 'leaflet';
import { DESTINATION_MARKER_Z_OFFSET, PICKUP_MARKER_Z_OFFSET, placeIconSpec, placeLabelsShown, placePopupElement } from './mapMarkers';
import type { PlaceKind } from './mapMarkers';

/**
 * The pickup and the destination of a trip on a Leaflet map, the same in the Passenger and the Driver app (and the shared trip view): a circle with the letter on a stem when the map
 * is far away or the two places are close together, and a label with the word ("Pickup", "Destination") when the map is close up and there is room. The marker is swapped when the
 * zoom changes; pressing it opens a popup that names the place and its address. Leaflet itself is handed in by the app, so the app's own copy of it draws the markers.
 */

export interface PlaceInput {
  lat: number;
  lng: number;
  /** the word on the label and the popup's heading, in the screen's language ("Pickup", "Destinasyon") */
  title: string;
  address?: string | null;
}

interface PlaceItem {
  kind: PlaceKind;
  place: PlaceInput;
  marker: L.Marker;
  labelled: boolean;
}

/** Adds the markers to `layer` and returns the function that stops watching the zoom (call it when the markers are redrawn or the map goes away). */
export function addPlaceMarkers(
  leaflet: typeof L,
  map: L.Map,
  layer: L.LayerGroup,
  places: { pickup?: PlaceInput | null; destination?: PlaceInput | null }
): () => void {
  const iconFor = (kind: PlaceKind, labelled: boolean, title: string) => {
    const spec = placeIconSpec(kind, labelled, title);
    return leaflet.divIcon({
      className: kind === 'pickup' ? 'leaflet-pickup-marker' : 'leaflet-destination-marker',
      html: spec.html,
      iconSize: spec.size,
      iconAnchor: spec.anchor,
      popupAnchor: spec.popupAnchor,
    });
  };

  // How far apart the two places are on the screen now (null when there is only one)
  const gapPx = (): number | null => {
    if (!places.pickup || !places.destination) return null;
    try {
      const a = map.latLngToContainerPoint([places.pickup.lat, places.pickup.lng]);
      const b = map.latLngToContainerPoint([places.destination.lat, places.destination.lng]);
      return a.distanceTo(b);
    } catch {
      return null; // the map has no view yet; the first zoom brings the answer
    }
  };
  const labelledNow = (): boolean => placeLabelsShown(map.getZoom?.() ?? Number.NaN, gapPx());

  const items: PlaceItem[] = [];
  const start = labelledNow();
  const add = (kind: PlaceKind, place: PlaceInput | null | undefined) => {
    if (!place) return;
    const marker = leaflet.marker([place.lat, place.lng], {
      icon: iconFor(kind, start, place.title),
      title: place.address ? `${place.title}: ${place.address}` : place.title,
      alt: place.title,
      keyboard: true,
      zIndexOffset: kind === 'pickup' ? PICKUP_MARKER_Z_OFFSET : DESTINATION_MARKER_Z_OFFSET,
    });
    marker.bindPopup(placePopupElement(place.title, place.address), { className: 'sakay-place-popup', autoPanPadding: [24, 24] });
    marker.addTo(layer);
    items.push({ kind, place, marker, labelled: start });
  };
  add('pickup', places.pickup);
  add('destination', places.destination);

  const refresh = () => {
    const labelled = labelledNow();
    for (const item of items) {
      if (item.labelled === labelled) continue;
      item.labelled = labelled;
      item.marker.setIcon(iconFor(item.kind, labelled, item.place.title));
    }
  };
  map.on('zoomend', refresh);
  return () => {
    map.off('zoomend', refresh);
  };
}
