import React, { useEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import L from 'leaflet';
import {
  placePopupElement,
  terminalPinHtml,
  TERMINAL_PIN_ANCHOR,
  TERMINAL_PIN_HEIGHT,
  TERMINAL_PIN_WIDTH,
  TERMINAL_PIN_COLOR,
  PROPOSED_TERMINAL_PIN_COLOR,
  type ServiceAreaShape,
} from '@sakay/shared';

import { fetchServiceArea } from '../../services/serviceAreaService';
import { FONT } from '../../styles/density';
import { PAGE_BORDER, PAGE_TEXT } from '../../styles/pageTheme';

interface TodaZoneMapProps {
  /** The terminal in force */
  terminal: { lat: number; lng: number; label?: string } | null;
  /** The terminal the TODA asked to move to (waiting for the LGU), drawn joined to the current one by a dashed line */
  proposed?: { lat: number; lng: number; label?: string } | null;
  height?: number;
}

const isPoint = (p?: { lat: number; lng: number } | null): p is { lat: number; lng: number } =>
  Boolean(p) && Number.isFinite(p!.lat) && Number.isFinite(p!.lng) && !(p!.lat === 0 && p!.lng === 0);

const pinIcon = (color: string) =>
  L.divIcon({
    className: 'sakay-terminal-pin',
    html: terminalPinHtml(color),
    iconSize: [TERMINAL_PIN_WIDTH, TERMINAL_PIN_HEIGHT],
    iconAnchor: TERMINAL_PIN_ANCHOR,
  });

/**
 * A real map of a TODA's terminal: the pin on the exact place the LGU approved and, drawn on the same map, the boundary of the area SAKAY serves (the active service area,
 * Calapan City). A move the TODA asked for is a second, amber pin joined by a dashed line; the orange pin stays where it is until the LGU approves.
 */
export const TodaZoneMap: React.FC<TodaZoneMapProps> = ({ terminal, proposed, height = 260 }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [area, setArea] = useState<ServiceAreaShape | null | undefined>(undefined);

  useEffect(() => {
    let stopped = false;
    void fetchServiceArea().then((a) => { if (!stopped) setArea(a); });
    return () => { stopped = true; };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || area === undefined) return;

    const hasTerminal = isPoint(terminal);
    const centre: [number, number] = hasTerminal ? [terminal!.lat, terminal!.lng] : area ? [area.centerLat, area.centerLng] : [13.4115, 121.1803];
    const map = L.map(container, { center: centre, zoom: 15, zoomControl: true, attributionControl: true, scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);

    let boundaryLayer: L.GeoJSON | null = null;
    if (area?.boundary) {
      boundaryLayer = L.geoJSON(area.boundary as unknown as GeoJSON.GeoJsonObject, {
        style: { color: '#B45309', weight: 2, dashArray: '6 6', fillColor: '#FDBA74', fillOpacity: 0.06 },
        interactive: false,
      }).addTo(map);
    } else if (area) {
      L.circle([area.centerLat, area.centerLng], { radius: area.radiusKm * 1000, color: '#B45309', weight: 2, dashArray: '6 6', fillColor: '#FDBA74', fillOpacity: 0.06, interactive: false }).addTo(map);
    }

    const points: [number, number][] = [];
    if (hasTerminal) {
      points.push([terminal!.lat, terminal!.lng]);
      L.marker([terminal!.lat, terminal!.lng], { icon: pinIcon(TERMINAL_PIN_COLOR), title: 'Terminal', alt: 'Terminal', keyboard: true, zIndexOffset: 700 })
        .bindPopup(placePopupElement('Terminal', terminal!.label), { offset: [0, -(TERMINAL_PIN_HEIGHT - 4)] })
        .addTo(map);
    }
    if (isPoint(proposed)) {
      points.push([proposed.lat, proposed.lng]);
      if (hasTerminal) L.polyline([[terminal!.lat, terminal!.lng], [proposed.lat, proposed.lng]], { color: '#B45309', weight: 3, dashArray: '6 6' }).addTo(map);
      L.marker([proposed.lat, proposed.lng], { icon: pinIcon(PROPOSED_TERMINAL_PIN_COLOR), title: 'Requested terminal', alt: 'Requested terminal', keyboard: true, zIndexOffset: 650 })
        .bindPopup(placePopupElement('Requested terminal (waiting for you)', proposed.label), { offset: [0, -(TERMINAL_PIN_HEIGHT - 4)] })
        .addTo(map);
    }

    if (points.length > 1) map.fitBounds(points, { padding: [56, 56], maxZoom: 17 });
    else if (points.length === 0 && boundaryLayer) map.fitBounds(boundaryLayer.getBounds(), { padding: [12, 12] });

    // the window is still opening when the map is made: its size is read again once it has settled
    const timers = [60, 250, 600].map((ms) => setTimeout(() => map.invalidateSize(), ms));
    return () => {
      timers.forEach(clearTimeout);
      map.remove();
    };
  }, [area, terminal?.lat, terminal?.lng, terminal?.label, proposed?.lat, proposed?.lng, proposed?.label]);

  return (
    <Box>
      <Box sx={{ width: '100%', height, borderRadius: '12px', overflow: 'hidden', border: `1px solid ${PAGE_BORDER}`, position: 'relative', backgroundColor: '#E5E7EB' }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} role="img" aria-label="Map of the terminal and the service area" />
        {!isPoint(terminal) && area !== undefined && (
          <Box sx={{ position: 'absolute', inset: 'auto 12px 12px 12px', zIndex: 500, backgroundColor: 'rgba(255,255,255,0.95)', border: `1px solid ${PAGE_BORDER}`, borderRadius: '8px', p: '8px 12px' }}>
            <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary }}>This TODA has no terminal pin on record, so only the service area is shown.</Typography>
          </Box>
        )}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', mt: '8px', fontSize: FONT.small, color: PAGE_TEXT.secondary }}>
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <Box aria-hidden component="span" sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: TERMINAL_PIN_COLOR }} /> Terminal in force
        </Box>
        {isPoint(proposed) && (
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Box aria-hidden component="span" sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: PROPOSED_TERMINAL_PIN_COLOR }} /> Requested terminal
          </Box>
        )}
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <Box aria-hidden component="span" sx={{ width: 16, height: 0, borderTop: '2px dashed #B45309' }} /> Area SAKAY serves
        </Box>
      </Box>
    </Box>
  );
};
