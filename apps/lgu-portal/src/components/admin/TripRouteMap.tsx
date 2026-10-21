import React, { useEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { fetchTripTrack } from '../../services/adminApiService';

interface TripRouteMapProps {
  bookingId: string;
  pickupLat: number;
  pickupLng: number;
  destLat: number;
  destLng: number;
}

type Track = Array<{ lat: number; lng: number; at: string }>;

/**
 * The route a trip really took (Rule 6.2.4): the positions the driver's phone published while the booking was open, drawn over the map with the pickup (green),
 * the destination (red) and the last recorded position (blue). Read from gps_log, which the LGU Administrator may read.
 */
export const TripRouteMap: React.FC<TripRouteMapProps> = ({ bookingId, pickupLat, pickupLng, destLat, destLng }) => {
  const container = useRef<HTMLDivElement>(null);
  const [track, setTrack] = useState<Track | null>(null);

  // 1. read the recorded positions
  useEffect(() => {
    let cancelled = false;
    setTrack(null);
    fetchTripTrack(bookingId).then((rows) => {
      if (!cancelled) setTrack(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  // 2. draw them once the box is on screen with its height
  useEffect(() => {
    if (!track || track.length < 2 || !container.current) return;
    const map = L.map(container.current, { zoomControl: true, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    const pickup: L.LatLngTuple = [pickupLat, pickupLng];
    const destination: L.LatLngTuple = [destLat, destLng];
    const points: L.LatLngTuple[] = track.map((t) => [t.lat, t.lng]);
    const line = L.polyline(points, { color: '#1565C0', weight: 4, opacity: 0.85 }).addTo(map);
    L.circleMarker(pickup, { radius: 7, color: '#FFFFFF', weight: 2, fillColor: '#1E8E3E', fillOpacity: 1 }).bindTooltip('Pickup').addTo(map);
    L.circleMarker(destination, { radius: 7, color: '#FFFFFF', weight: 2, fillColor: '#D93025', fillOpacity: 1 }).bindTooltip('Destination').addTo(map);
    L.circleMarker(points[points.length - 1], { radius: 6, color: '#FFFFFF', weight: 2, fillColor: '#1565C0', fillOpacity: 1 }).bindTooltip('Last recorded position').addTo(map);
    map.fitBounds(line.getBounds().extend(pickup).extend(destination), { padding: [24, 24] });
    // the window animates open: measure again once it has settled
    const timer = setTimeout(() => {
      map.invalidateSize();
      map.fitBounds(line.getBounds().extend(pickup).extend(destination), { padding: [24, 24] });
    }, 300);

    return () => {
      clearTimeout(timer);
      map.remove();
    };
  }, [track, pickupLat, pickupLng, destLat, destLng]);

  const fixes = track ? track.length : null;
  return (
    <Box>
      <div ref={container} style={{ width: '100%', height: fixes !== null && fixes >= 2 ? 240 : 0, borderRadius: 10, overflow: 'hidden' }} />
      {fixes === null && <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>Loading the recorded route...</Typography>}
      {fixes !== null && fixes < 2 && (
        <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>
          {fixes === 0 ? 'No GPS positions were recorded for this booking.' : 'Only one GPS position was recorded, so there is no route to draw.'}
        </Typography>
      )}
      {fixes !== null && fixes >= 2 && (
        <Typography sx={{ fontSize: '10px', color: 'var(--mac-text-muted)', mt: 0.8 }}>{fixes} GPS positions recorded by the driver's phone.</Typography>
      )}
    </Box>
  );
};
