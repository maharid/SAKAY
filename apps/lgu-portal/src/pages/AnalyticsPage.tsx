import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Paper,
  Card,
  CardContent,
  CircularProgress,
  Button,
  LinearProgress,
} from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TimelineIcon from '@mui/icons-material/Timeline';
import RefreshIcon from '@mui/icons-material/Refresh';
import MapIcon from '@mui/icons-material/Map';
import SpeedIcon from '@mui/icons-material/Speed';
import PeopleIcon from '@mui/icons-material/People';
import L from 'leaflet';
import { MAP_TILE_URL, MAP_TILE_OPTIONS } from '@sakay/shared';
import 'leaflet/dist/leaflet.css';

import { fetchOperationalReports, OperationalReportsData } from '../services/adminApiService';

/**
 * ============================================================================
 * TRANSPORTATION ANALYTICS DASHBOARD (AnalyticsPage.tsx)
 * ============================================================================
 * Checklist Scope:
 *   ● View Transportation Analytics
 *     ○ View booking trends          (14-day booking trend)
 *     ○ View peak travel periods     (busiest hour; the full hourly list is in Reports)
 *     ○ View demand hotspot maps     (clusters of real pickup coordinates)
 *     ○ View service utilization     (what happened to the booking requests)
 *     ○ View driver utilization      (verified drivers who carried passengers recently)
 *
 * Descriptive analytics only: every figure is computed from SAKAY bookings (packages/shared/src/utils/transportAnalytics.ts).
 * The pilot covers one TODA and one barangay, so these figures are not citywide transport demand.
 * ============================================================================
 */

const CALAPAN_CENTER: L.LatLngExpression = [13.4117, 121.1803];

const cardSx = {
  borderRadius: 'var(--mac-radius-lg)',
  border: '1px solid var(--mac-border-color)',
  boxShadow: 'var(--mac-shadow-card)',
  backgroundColor: '#FFFFFF',
};

interface MetricCardProps {
  title: string;
  value: string;
  caption: string;
  color: string;
  icon: React.ReactNode;
}

const MetricCard: React.FC<MetricCardProps> = ({ title, value, caption, color, icon }) => (
  <Card sx={cardSx}>
    <CardContent sx={{ p: '20px 22px !important' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        {icon}
        <Typography sx={{ fontSize: '10px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase' }}>{title}</Typography>
      </Box>
      <Typography sx={{ fontSize: '22.4px', fontWeight: 700, color, mb: 0.5 }}>{value}</Typography>
      <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)' }}>{caption}</Typography>
    </CardContent>
  </Card>
);

interface OutcomeBarProps {
  label: string;
  count: number;
  total: number;
  color: string;
}

const OutcomeBar: React.FC<OutcomeBarProps> = ({ label, count, total, color }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
    <Typography sx={{ width: 130, fontSize: '10.8px', fontWeight: 600, color: 'var(--mac-text-secondary)' }}>{label}</Typography>
    <Box sx={{ flex: 1 }}>
      <LinearProgress
        variant="determinate"
        value={total > 0 ? (count / total) * 100 : 0}
        sx={{ height: 10, borderRadius: 5, backgroundColor: '#F0F0F2', '& .MuiLinearProgress-bar': { backgroundColor: color, borderRadius: 5 } }}
      />
    </Box>
    <Typography sx={{ width: 90, fontSize: '10.8px', fontWeight: 700, textAlign: 'right', color: 'var(--mac-text-primary)' }}>
      {count} ({total > 0 ? Math.round((count / total) * 100) : 0}%)
    </Typography>
  </Box>
);

export const AnalyticsPage: React.FC = () => {
  const [data, setData] = useState<OperationalReportsData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const hotspotLayer = useRef<L.LayerGroup | null>(null);

  const loadAnalytics = async () => {
    setIsLoading(true);
    try {
      setData(await fetchOperationalReports());
    } catch (err) {
      console.error('[AnalyticsPage] Error loading analytics:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAnalytics();
  }, []);

  // The map is created once...
  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;
    const map = L.map(mapRef.current, { center: CALAPAN_CENTER, zoom: 14, zoomControl: true });
    L.tileLayer(MAP_TILE_URL, MAP_TILE_OPTIONS).addTo(map);
    hotspotLayer.current = L.layerGroup().addTo(map);
    leafletMap.current = map;
    return () => {
      map.remove();
      leafletMap.current = null;
      hotspotLayer.current = null;
    };
  }, []);

  // ...and the hotspots are redrawn from the data every time it loads. Each one is a cluster of real pickup coordinates.
  useEffect(() => {
    const map = leafletMap.current;
    const layer = hotspotLayer.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const spots = data?.hotspots ?? [];
    if (spots.length === 0) return;
    const maxCount = Math.max(...spots.map((s) => s.count));
    spots.forEach((spot) => {
      L.circle([spot.lat, spot.lng], {
        color: '#FF5500',
        fillColor: '#FF5500',
        fillOpacity: 0.25,
        radius: 200 + 500 * (spot.count / maxCount),
      })
        .bindPopup(`<b>${spot.label.replace(/</g, '&lt;')}</b><br/>${spot.count} pickup${spot.count === 1 ? '' : 's'} (${spot.share}% of located pickups)`)
        .addTo(layer);
    });
    map.fitBounds(L.latLngBounds(spots.map((s) => [s.lat, s.lng] as L.LatLngTuple)).pad(0.4), { maxZoom: 16 });
  }, [data]);

  const service = data?.serviceUtilization;
  const drivers = data?.driverUtilizationSummary;
  const trend = data?.bookingTrend ?? [];
  const trendMax = Math.max(1, ...trend.map((p) => p.total));
  const busiest = (data?.peakHourDistribution ?? []).reduce<{ hour: string; count: number } | null>(
    (best, h) => (h.count > 0 && (!best || h.count > best.count) ? h : best),
    null
  );
  const trendTotal = trend.reduce((sum, p) => sum + p.total, 0);

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 6 }}>
      {/* 1. Header Toolbar */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3.5, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography sx={{ fontSize: '16px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>Transportation Operations Analytics</Typography>
          <Typography sx={{ fontSize: '10.8px', color: 'var(--mac-text-muted)', mt: '3px' }}>
            Descriptive analytics from SAKAY bookings only (pilot: one TODA, one barangay). Not citywide transport demand.
          </Typography>
        </Box>
        <Button
          onClick={loadAnalytics}
          startIcon={<RefreshIcon />}
          variant="outlined"
          size="small"
          sx={{ textTransform: 'none', borderColor: 'var(--mac-border-color)', color: 'var(--mac-text-primary)' }}
        >
          Refresh Analytics
        </Button>
      </Box>

      {isLoading && !data ? (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <CircularProgress size={32} sx={{ color: 'var(--sakay-orange)' }} />
        </Box>
      ) : (
        <>
          {/* 2. Top Analytics Metrics */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(4, 1fr)' }, gap: 2.5, mb: 3.5 }}>
            <MetricCard
              title="Booking Completion Rate"
              value={service && service.requests > 0 ? `${service.completionRate}%` : '—'}
              caption={`${service?.completed ?? 0} of ${service?.requests ?? 0} booking requests were completed`}
              color="#2E7D32"
              icon={<TrendingUpIcon sx={{ color: '#2E7D32', fontSize: '16px' }} />}
            />
            <MetricCard
              title="Busiest Hour"
              value={busiest ? busiest.hour : '—'}
              caption={busiest ? `${busiest.count} booking${busiest.count === 1 ? '' : 's'} created in this hour (all time)` : 'No bookings yet'}
              color="var(--sakay-orange)"
              icon={<SpeedIcon sx={{ color: 'var(--sakay-orange)', fontSize: '16px' }} />}
            />
            <MetricCard
              title="Driver Utilization"
              value={drivers && drivers.verifiedDrivers > 0 ? `${drivers.rate}%` : '—'}
              caption={`${drivers?.activeDrivers ?? 0} of ${drivers?.verifiedDrivers ?? 0} verified drivers completed a trip in the last ${drivers?.windowDays ?? 30} days`}
              color="#1565C0"
              icon={<PeopleIcon sx={{ color: '#1565C0', fontSize: '16px' }} />}
            />
            <MetricCard
              title="Average Fare"
              value={service && service.completed > 0 ? `₱${service.averageFare.toFixed(2)}` : '—'}
              caption="Per completed trip (final fare)"
              color="#6A1B9A"
              icon={<TimelineIcon sx={{ color: '#6A1B9A', fontSize: '16px' }} />}
            />
          </Box>

          {/* 3. Booking trend + service utilization */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '3fr 2fr' }, gap: 2.5, mb: 3.5 }}>
            <Paper elevation={0} sx={{ ...cardSx, p: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TimelineIcon sx={{ color: 'var(--sakay-orange)', fontSize: '17.6px' }} />
                  <Typography sx={{ fontSize: '12.8px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>
                    Booking Trend (last {trend.length || 14} days)
                  </Typography>
                </Box>
                <Typography sx={{ fontSize: '10.4px', color: 'var(--mac-text-muted)' }}>{trendTotal} booking{trendTotal === 1 ? '' : 's'} in this period</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: 170, borderBottom: '1px solid var(--mac-border-color)' }}>
                {trend.map((p) => {
                  const other = p.total - p.completed - p.cancelled;
                  const scale = (n: number) => `${(n / trendMax) * 140}px`;
                  return (
                    <Box
                      key={p.date}
                      title={`${p.label}: ${p.total} booking(s), ${p.completed} completed, ${p.cancelled} cancelled`}
                      sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', minWidth: 0 }}
                    >
                      <Typography sx={{ fontSize: '9.6px', fontWeight: 700, color: 'var(--mac-text-secondary)', mb: '2px' }}>{p.total > 0 ? p.total : ''}</Typography>
                      <Box sx={{ width: '100%', maxWidth: 34, display: 'flex', flexDirection: 'column', borderRadius: '4px 4px 0 0', overflow: 'hidden' }}>
                        <Box sx={{ height: scale(other), backgroundColor: '#B0B7C3' }} />
                        <Box sx={{ height: scale(p.cancelled), backgroundColor: '#DC2626' }} />
                        <Box sx={{ height: scale(p.completed), backgroundColor: '#2E7D32' }} />
                      </Box>
                    </Box>
                  );
                })}
              </Box>
              <Box sx={{ display: 'flex', gap: '6px', mt: 0.75 }}>
                {trend.map((p) => (
                  <Typography key={p.date} sx={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: '8.8px', color: 'var(--mac-text-muted)', whiteSpace: 'nowrap' }}>
                    {p.label.replace(' ', ' ')}
                  </Typography>
                ))}
              </Box>
              <Box sx={{ display: 'flex', gap: 2, mt: 1.5 }}>
                {[
                  ['#2E7D32', 'Completed'],
                  ['#DC2626', 'Cancelled'],
                  ['#B0B7C3', 'Other (searching, no driver, in progress)'],
                ].map(([color, label]) => (
                  <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '2px', backgroundColor: color }} />
                    <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)' }}>{label}</Typography>
                  </Box>
                ))}
              </Box>
            </Paper>

            <Paper elevation={0} sx={{ ...cardSx, p: 3 }}>
              <Typography sx={{ fontSize: '12.8px', fontWeight: 700, color: 'var(--mac-text-primary)', mb: 2 }}>Service Utilization</Typography>
              {service && service.requests > 0 ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
                  <OutcomeBar label="Completed" count={service.completed} total={service.requests} color="#2E7D32" />
                  <OutcomeBar label="Cancelled" count={service.cancelled} total={service.requests} color="#DC2626" />
                  <OutcomeBar label="No driver found" count={service.noDriverFound} total={service.requests} color="#F59E0B" />
                  <OutcomeBar label="In progress / open" count={service.inProgress} total={service.requests} color="#1565C0" />
                  <Box sx={{ borderTop: '1px solid var(--mac-border-color)', pt: 1.5, mt: 0.5 }}>
                    <OutcomeBar label="Solo trips" count={service.soloTrips} total={service.requests} color="#6A1B9A" />
                    <Box sx={{ mt: 1.25 }}>
                      <OutcomeBar label="Shared trips" count={service.sharedTrips} total={service.requests} color="#00897B" />
                    </Box>
                  </Box>
                </Box>
              ) : (
                <Typography sx={{ fontSize: '11.3px', color: 'var(--mac-text-muted)' }}>No booking requests have been recorded yet.</Typography>
              )}
            </Paper>
          </Box>

        </>
      )}

      {/* 4. Demand Hotspot Map */}
      <Paper elevation={0} sx={{ ...cardSx, overflow: 'hidden' }}>
        <Box sx={{ p: '16px 20px', borderBottom: '1px solid var(--mac-border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <MapIcon sx={{ color: 'var(--sakay-orange)', fontSize: '17.6px' }} />
            <Typography sx={{ fontSize: '12.8px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>Demand Hotspot Map (pickup clusters)</Typography>
          </Box>
          <Typography sx={{ fontSize: '10.4px', color: 'var(--mac-text-muted)' }}>
            {data && data.hotspots.length > 0
              ? `Top ${data.hotspots.length} pickup areas of about 550 m, from the pickup coordinates of SAKAY bookings`
              : 'No booking with a pickup location yet. Hotspots appear as bookings are made.'}
          </Typography>
        </Box>
        <div ref={mapRef} style={{ width: '100%', height: '380px' }} />
      </Paper>
    </Box>
  );
};
