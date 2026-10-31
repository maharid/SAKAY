import React, { useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import L from 'leaflet';
import type { Hotspot } from '@sakay/shared';

import { FONT } from '../../styles/density';
import { PAGE_BORDER, PAGE_TEXT } from '../../styles/pageTheme';

interface HotspotMapProps {
  /** The areas to draw: each is a circle at its place, larger when it has more bookings (these are the real coordinates of the bookings, grouped in areas of about 550 m) */
  spots: Hotspot[];
  /** pickups are drawn in orange and drop-offs in blue; the words say which, so colour is not the only clue */
  kind: 'pickup' | 'dropoff';
  height?: number;
}

const COLORS = { pickup: '#C75000', dropoff: '#1D5FA8' } as const;
const CALAPAN: [number, number] = [13.4117, 121.1803];

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The booking activity hotspots on a map of Calapan City: one circle per area, its size says how many bookings began (or ended) there. The map fits itself to the areas it draws.
 * Pointing at a circle (or focusing it) says the area, the number of bookings and the share. Nothing here is invented: the areas come from the bookings' own coordinates.
 */
export const HotspotMap: React.FC<HotspotMapProps> = ({ spots, kind, height = 340 }) => {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!holder.current || mapRef.current) return;
    const map = L.map(holder.current, { center: CALAPAN, zoom: 13, zoomControl: false, attributionControl: true, scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
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
    const top = Math.max(1, ...spots.map((s) => s.count));
    const bounds: L.LatLngTuple[] = [];
    spots.forEach((s) => {
      // the area of a circle follows the number of bookings (radius 9 - 26 px)
      const radius = 9 + 17 * Math.sqrt(s.count / top);
      const marker = L.circleMarker([s.lat, s.lng], { radius, color: COLORS[kind], weight: 2, fillColor: COLORS[kind], fillOpacity: 0.35 });
      marker.bindTooltip(`<strong>${escapeHtml(s.label)}</strong><br>${s.count} ${kind === 'pickup' ? 'pickup' : 'drop-off'}${s.count === 1 ? '' : 's'} (${s.share}%)`, { direction: 'top', opacity: 0.97 });
      marker.addTo(layer);
      bounds.push([s.lat, s.lng]);
    });
    // the map measures its box first, so the frame fits every area whatever the size the page gave it
    map.invalidateSize();
    if (bounds.length > 0) map.fitBounds(L.latLngBounds(bounds), { padding: [36, 36], maxZoom: 16 });
    else map.setView(CALAPAN, 13);
    // the map was drawn while its tab was settling: ask it to measure itself again
    window.setTimeout(() => map.invalidateSize(), 60);
  }, [spots, kind]);

  return (
    <Box>
      <Box sx={{ position: 'relative', height, borderRadius: '10px', overflow: 'hidden', border: `1px solid ${PAGE_BORDER}`, '& .leaflet-container': { borderRadius: '10px', fontFamily: 'inherit' } }}>
        <div ref={holder} role="region" aria-label={`Map of the busiest ${kind === 'pickup' ? 'pickup' : 'drop-off'} areas`} style={{ width: '100%', height: '100%' }} />
      </Box>
      <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '6px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <Box component="span" aria-hidden sx={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: COLORS[kind], opacity: 0.55, display: 'inline-block' }} />
        Each circle is an area of about 550 m. A larger circle means more {kind === 'pickup' ? 'pickups' : 'drop-offs'}. Point at one for the numbers.
      </Typography>
    </Box>
  );
};
