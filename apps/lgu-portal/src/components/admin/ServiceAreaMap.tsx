import React, { useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import L from 'leaflet';
import type { ServiceAreaShapeOnMap, TerminalPin } from '../../services/adminApiService';

import { FONT } from '../../styles/density';
import { PAGE_BORDER, PAGE_TEXT } from '../../styles/pageTheme';


interface ServiceAreaMapProps {
  /** The area bookings may start and end in now */
  active: ServiceAreaShapeOnMap | null;
  /** The accredited TODAs' terminals, each a pin */
  terminals: TerminalPin[];
  /** The pilot area being set up in the form (a dashed circle), so its reach is seen before it is applied */
  preview?: { lat: number; lng: number; radiusKm: number } | null;
  /** The terminal chosen as the centre of the pilot (its pin is drawn larger) */
  highlightTerminalId?: string | null;
  height?: number;
}

const BRAND = '#C75000';
const CALAPAN: [number, number] = [13.4117, 121.1803];
const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const pin = (highlight: boolean): L.DivIcon =>
  L.divIcon({
    className: 'sakay-terminal-pin',
    html: `<div style="width:${highlight ? 26 : 20}px;height:${highlight ? 26 : 20}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${BRAND};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);"></div>`,
    iconSize: [highlight ? 26 : 20, highlight ? 26 : 20],
    iconAnchor: [highlight ? 13 : 10, highlight ? 26 : 20],
  });

/**
 * The service area on a map: the area in force (the city boundary, or a circle around one terminal), the terminals of the accredited TODAs as pins, and the pilot circle being
 * set up as a dashed outline. It draws what the database holds; nothing is invented. A booking must start AND end inside the shaded area.
 */
export const ServiceAreaMap: React.FC<ServiceAreaMapProps> = ({ active, terminals, preview, highlightTerminalId, height = 360 }) => {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedFor = useRef<string>('');

  useEffect(() => {
    if (!holder.current || mapRef.current) return;
    const map = L.map(holder.current, { center: CALAPAN, zoom: 12, zoomControl: false, scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    // the map is told when its box changes size (the side menu opens, the window is resized), so no tiles are left grey and nothing is cut off
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(holder.current);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const fit: L.LatLngBounds[] = [];

    if (active) {
      if (active.isWholeCity && active.boundary) {
        const shape = L.geoJSON(active.boundary as unknown as GeoJSON.GeoJsonObject, { style: { color: BRAND, weight: 2.5, fillColor: BRAND, fillOpacity: 0.1 } }).addTo(layer);
        shape.bindTooltip(`${escapeHtml(active.name)}: the city boundary`, { sticky: true });
        fit.push(shape.getBounds());
      } else {
        const circle = L.circle([active.centerLat, active.centerLng], { radius: active.radiusKm * 1000, color: BRAND, weight: 2.5, fillColor: BRAND, fillOpacity: 0.12 }).addTo(layer);
        circle.bindTooltip(`${escapeHtml(active.name)}: ${active.radiusKm} km around the terminal`, { sticky: true });
        fit.push(circle.getBounds());
      }
    }
    if (preview) {
      const dashed = L.circle([preview.lat, preview.lng], { radius: preview.radiusKm * 1000, color: '#1D5FA8', weight: 2, dashArray: '8 6', fillColor: '#1D5FA8', fillOpacity: 0.06 }).addTo(layer);
      dashed.bindTooltip(`The pilot area being set up: ${preview.radiusKm} km`, { sticky: true });
      fit.push(dashed.getBounds());
    }
    terminals.forEach((t) => {
      const marker = L.marker([t.lat, t.lng], { icon: pin(t.id === highlightTerminalId), keyboard: true, title: t.name }).addTo(layer);
      marker.bindTooltip(`<strong>${escapeHtml(t.name)}</strong><br>TODA terminal`, { direction: 'top', offset: [0, -14] });
    });
    if (fit.length === 0 && terminals.length > 0) fit.push(L.latLngBounds(terminals.map((t) => [t.lat, t.lng] as L.LatLngTuple)));

    // frame the map when the shape changes (not on every keystroke of the radius: the preview is allowed to grow past the frame)
    const key = `${active?.name ?? ''}|${active?.isWholeCity ? 'city' : active?.radiusKm ?? ''}|${preview ? `${preview.lat},${preview.lng}` : ''}`;
    if (fit.length > 0 && fittedFor.current !== key) {
      map.invalidateSize();
      const all = fit.reduce((a, b) => a.extend(b));
      map.fitBounds(all, { padding: [30, 30], maxZoom: 15 });
      fittedFor.current = key;
    }
  }, [active, terminals, preview, highlightTerminalId]);

  return (
    <Box>
      <Box sx={{ position: 'relative', isolation: 'isolate', height, borderRadius: '10px', overflow: 'hidden', border: `1px solid ${PAGE_BORDER}`, '& .leaflet-container': { borderRadius: '10px', fontFamily: 'inherit' } }}>
        <div ref={holder} role="region" aria-label="Map of the service area and the TODA terminals" style={{ width: '100%', height: '100%' }} />
      </Box>
      <Box component="ul" aria-label="Map key" sx={{ m: 0, mt: '8px', p: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: '4px 18px', fontSize: FONT.small, color: PAGE_TEXT.secondary }}>
        <Box component="li" sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Box aria-hidden sx={{ width: 14, height: 10, borderRadius: '2px', border: `2px solid ${BRAND}`, backgroundColor: 'rgba(199, 80, 0, 0.12)' }} />
          Where bookings may start and end
        </Box>
        <Box component="li" sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Box aria-hidden sx={{ width: 10, height: 10, borderRadius: '50% 50% 50% 0', transform: 'rotate(-45deg)', backgroundColor: BRAND }} />
          A TODA terminal
        </Box>
        {preview && (
          <Box component="li" sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Box aria-hidden sx={{ width: 14, height: 10, borderRadius: '2px', border: '2px dashed #1D5FA8' }} />
            The pilot area being set up
          </Box>
        )}
      </Box>
    </Box>
  );
};
