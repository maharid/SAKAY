import React, { useMemo } from 'react';
import {
  Box,
  Button,
  Card,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';

import { DRIVER_ACTIVITY_WINDOW_DAYS, driverActivity } from '@sakay/shared';
import type { BookingLike } from '@sakay/shared';

import { downloadCsv, reportFileName } from '../../utils/csvDownload';

/**
 * TODA reports: driver trip volume and activity (checklist: TODA Administrator > View Reports). One row per driver of the TODA:
 * completed and cancelled trips, kilometres, estimated gross fare, the latest trip, and whether the driver carried passengers in the
 * last 30 days. Computed from the TODA's bookings (shared transportAnalytics).
 */
export interface ActivityDriver {
  driver_id: string;
  full_name: string;
  plate_number?: string | null;
}

interface DriverActivityReportProps {
  trips: BookingLike[];
  drivers: ActivityDriver[];
  onExported: (reportName: string) => void;
}

const peso = (n: number): string => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cardSx = { borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', boxShadow: 'var(--mac-shadow-card)', backgroundColor: '#FFFFFF' };
const headCell = { fontWeight: 600, fontSize: '13px', color: 'var(--mac-text-muted)', py: 2, px: 2 };
const dayOf = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }) : 'No completed trip yet';

export const DriverActivityReport: React.FC<DriverActivityReportProps> = ({ trips, drivers, onExported }) => {
  const rows = useMemo(() => driverActivity(trips, drivers), [trips, drivers]);
  const active = rows.filter((r) => r.activeInWindow).length;
  const completed = rows.reduce((n, r) => n + r.completed, 0);
  const km = Math.round(rows.reduce((n, r) => n + r.km, 0) * 10) / 10;
  const rate = rows.length > 0 ? Math.round((active / rows.length) * 100) : 0;

  const exportCsv = () => {
    const name = 'Driver Trip Volume and Activity';
    downloadCsv(
      reportFileName(name),
      ['Driver', 'Plate / Franchise', 'Completed Trips', 'Cancelled', 'Distance (km)', 'Estimated Gross Fare (PHP)', 'Latest Completed Trip', `Active In Last ${DRIVER_ACTIVITY_WINDOW_DAYS} Days`],
      rows.map((r) => [r.name, r.plate, r.completed, r.cancelled, r.km, r.grossFare.toFixed(2), dayOf(r.lastTripAt), r.activeInWindow ? 'Yes' : 'No'])
    );
    onExported(name);
  };

  const kpis: Array<[string, string, string, string]> = [
    ['Registered Drivers', String(rows.length), 'Drivers of your TODA with a SAKAY account', 'var(--mac-text-primary)'],
    ['Driver Utilization', rows.length > 0 ? `${rate}%` : '-', `${active} of ${rows.length} completed a trip in the last ${DRIVER_ACTIVITY_WINDOW_DAYS} days`, '#1565C0'],
    ['Completed Trips', String(completed), 'All time', '#059669'],
    ['Distance Carried', `${km} km`, 'Road distance of completed trips', 'var(--sakay-orange)'],
  ];

  return (
    <>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2.5, mb: 3.5 }}>
        {kpis.map(([title, value, caption, color]) => (
          <Card key={title} sx={cardSx}>
            <Box sx={{ p: '20px 24px' }}>
              <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', mb: 1 }}>{title}</Typography>
              <Typography sx={{ fontSize: '30px', fontWeight: 700, color }}>{value}</Typography>
              <Typography sx={{ fontSize: '12.5px', color: 'var(--mac-text-muted)', mt: 0.5 }}>{caption}</Typography>
            </Box>
          </Card>
        ))}
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button
          onClick={exportCsv}
          startIcon={<DownloadIcon />}
          variant="contained"
          size="small"
          disabled={rows.length === 0}
          sx={{ textTransform: 'none', backgroundColor: 'var(--sakay-orange)', fontWeight: 600 }}
        >
          Export Driver Activity (CSV)
        </Button>
      </Box>

      <TableContainer component={Paper} elevation={0} sx={{ ...cardSx, overflow: 'hidden' }}>
        <Table>
          <TableHead sx={{ backgroundColor: '#FAFAFC' }}>
            <TableRow>
              <TableCell sx={headCell}>DRIVER</TableCell>
              <TableCell sx={headCell} align="right">COMPLETED</TableCell>
              <TableCell sx={headCell} align="right">CANCELLED</TableCell>
              <TableCell sx={headCell} align="right">DISTANCE</TableCell>
              <TableCell sx={headCell} align="right">EST. GROSS FARE</TableCell>
              <TableCell sx={headCell}>LATEST COMPLETED TRIP</TableCell>
              <TableCell sx={headCell} align="center">ACTIVE ({DRIVER_ACTIVITY_WINDOW_DAYS} DAYS)</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                  <Typography sx={{ fontSize: '15px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>No Registered Drivers Yet</Typography>
                  <Typography sx={{ fontSize: '13px', color: 'var(--mac-text-muted)', mt: 0.5 }}>Drivers appear here once their SAKAY application is endorsed and approved.</Typography>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.driverId} sx={{ '&:hover': { backgroundColor: 'var(--mac-canvas-bg)' } }}>
                  <TableCell sx={{ px: 2 }}>
                    <Typography sx={{ fontSize: '15px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{r.name}</Typography>
                    <Typography sx={{ fontSize: '13px', color: 'var(--mac-text-muted)' }}>{r.plate || 'No plate on record'}</Typography>
                  </TableCell>
                  <TableCell sx={{ px: 2, fontWeight: 600, color: '#059669' }} align="right">{r.completed}</TableCell>
                  <TableCell sx={{ px: 2, color: r.cancelled ? '#DC2626' : undefined }} align="right">{r.cancelled}</TableCell>
                  <TableCell sx={{ px: 2 }} align="right">{r.km} km</TableCell>
                  <TableCell sx={{ px: 2, fontWeight: 600 }} align="right">{peso(r.grossFare)}</TableCell>
                  <TableCell sx={{ px: 2 }}>{dayOf(r.lastTripAt)}</TableCell>
                  <TableCell sx={{ px: 2 }} align="center">
                    <Chip
                      size="small"
                      label={r.activeInWindow ? 'Active' : 'Inactive'}
                      sx={{ fontWeight: 600, backgroundColor: r.activeInWindow ? '#E6F4EA' : '#F1F3F4', color: r.activeInWindow ? '#1E8E3E' : '#5F6368' }}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
};

export default DriverActivityReport;
