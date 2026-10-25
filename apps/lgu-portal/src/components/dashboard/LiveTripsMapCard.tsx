import React, { useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import L from 'leaflet';

import { DashboardCard } from './DashboardCard';
import { FONT } from '../../styles/density';
import { PAGE_BORDER, PAGE_TEXT } from '../../styles/pageTheme';

interface LiveTripsMapCardProps {
  ongoingTripsCount?: number;
}

export const LiveTripsMapCard: React.FC<LiveTripsMapCardProps> = ({ ongoingTripsCount = 0 }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || leafletInstanceRef.current) return;

    // Center on Calapan City
    const map = L.map(mapRef.current, {
      center: [13.4117, 121.1803],
      zoom: 14,
      zoomControl: false,
      attributionControl: false,
    });

    // OpenStreetMap Tile Layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);

    // Zoom control in bottom right
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    leafletInstanceRef.current = map;

    return () => {
      if (leafletInstanceRef.current) {
        leafletInstanceRef.current.remove();
        leafletInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <DashboardCard title="Live trips map" action={{ label: 'Open full map', to: '/live-trips' }}>
      <Box
        sx={{
          flex: 1,
          minHeight: 230,
          width: '100%',
          borderRadius: '8px',
          overflow: 'hidden',
          position: 'relative',
          border: `1px solid ${PAGE_BORDER}`,
          '& .leaflet-container': { borderRadius: '8px' },
        }}
      >
        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

        {/* Floating Active Trip Status Badge */}
        <Box
          role="status"
          sx={{
            position: 'absolute',
            bottom: 12,
            left: 12,
            backgroundColor: '#FFFFFF',
            borderRadius: '16px',
            padding: '4px 11px',
            boxShadow: 'var(--mac-shadow-popover)',
            display: 'flex',
            alignItems: 'center',
            gap: 0.8,
            zIndex: 400,
            border: `1px solid ${PAGE_BORDER}`,
          }}
        >
          <Box
            aria-hidden
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: ongoingTripsCount > 0 ? '#34A853' : '#9CA3AF',
            }}
          />
          <Typography sx={{ fontSize: FONT.small, fontWeight: 600, color: PAGE_TEXT.primary }}>
            {ongoingTripsCount > 0 ? `Active trips (${ongoingTripsCount})` : 'No active trips'}
          </Typography>
        </Box>
      </Box>
    </DashboardCard>
  );
};
