import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';

import { serviceUtilization, volumeByPeriod } from '@sakay/shared';
import type { BookingLike, VolumePeriod } from '@sakay/shared';

import { downloadCsv, reportFileName } from '../../utils/csvDownload';

/**
 * TODA reports: daily, weekly and monthly booking reports, platform booking volume and estimated gross fare value (checklist:
 * TODA Administrator > View Reports). Every figure is computed from the TODA's own bookings (shared transportAnalytics), never typed in.
 * The estimated gross fare value is the sum of the final fares of the completed trips; fares are settled in cash.
 */
interface BookingVolumeReportProps {
  trips: BookingLike[];
  todaName: string;
  /** called after the file is saved, so the page can write the audit entry */
  onExported: (reportName: string) => void;
}

const PERIOD_LABEL: Record<VolumePeriod, string> = { day: 'Daily', week: 'Weekly', month: 'Monthly' };
const PERIOD_COLUMN: Record<VolumePeriod, string> = { day: 'DAY', week: 'WEEK (MON-SUN)', month: 'MONTH' };
const peso = (n: number): string => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const cardSx = { borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', boxShadow: 'var(--mac-shadow-card)', backgroundColor: '#FFFFFF' };
const headCell = { fontWeight: 600, fontSize: '13px', color: 'var(--mac-text-muted)', py: 2, px: 2 };

export const BookingVolumeReport: React.FC<BookingVolumeReportProps> = ({ trips, todaName, onExported }) => {
  const [period, setPeriod] = useState<VolumePeriod>('day');

  const totals = useMemo(() => serviceUtilization(trips), [trips]);
  // The newest period first, the way a report is read.
  const rows = useMemo(() => [...volumeByPeriod(trips, period)].reverse(), [trips, period]);

  const exportCsv = () => {
    const name = `Booking Volume ${PERIOD_LABEL[period]}`;
    downloadCsv(
      reportFileName(name),
      [PERIOD_COLUMN[period], 'Booking Requests', 'Completed', 'Cancelled', 'No Driver Found', 'Shared Trips', 'Estimated Gross Fare (PHP)', 'Average Fare (PHP)', 'Completion Rate (%)'],
      rows.map((r) => [r.label, r.total, r.completed, r.cancelled, r.noDriverFound, r.sharedTrips, r.grossFare.toFixed(2), r.averageFare.toFixed(2), r.completionRate])
    );
    onExported(name);
  };

  const kpis: Array<[string, string, string, string]> = [
    ['Platform Booking Volume', String(totals.requests), 'All booking requests recorded for your TODA', 'var(--mac-text-primary)'],
    ['Completed Trips', String(totals.completed), `${totals.completionRate}% of requests`, '#059669'],
    ['Cancelled / No Driver', `${totals.cancelled + totals.noDriverFound}`, `${totals.cancelled} cancelled, ${totals.noDriverFound} no driver found`, '#DC2626'],
    ['Estimated Gross Fare Value', peso(totals.grossFare), `Average ${peso(totals.averageFare)} per completed trip`, 'var(--sakay-orange)'],
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

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, mb: 2 }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={period}
          onChange={(_, next: VolumePeriod | null) => next && setPeriod(next)}
          sx={{ '& .MuiToggleButton-root': { textTransform: 'none', fontWeight: 600, px: 2 }, '& .Mui-selected': { color: 'var(--sakay-orange) !important' } }}
        >
          {(Object.keys(PERIOD_LABEL) as VolumePeriod[]).map((p) => (
            <ToggleButton key={p} value={p}>{PERIOD_LABEL[p]}</ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Button
          onClick={exportCsv}
          startIcon={<DownloadIcon />}
          variant="contained"
          size="small"
          sx={{ textTransform: 'none', backgroundColor: 'var(--sakay-orange)', fontWeight: 600 }}
        >
          Export {PERIOD_LABEL[period]} Report (CSV)
        </Button>
      </Box>

      <TableContainer component={Paper} elevation={0} sx={{ ...cardSx, overflow: 'hidden' }}>
        <Table>
          <TableHead sx={{ backgroundColor: '#FAFAFC' }}>
            <TableRow>
              <TableCell sx={headCell}>{PERIOD_COLUMN[period]}</TableCell>
              <TableCell sx={headCell} align="right">REQUESTS</TableCell>
              <TableCell sx={headCell} align="right">COMPLETED</TableCell>
              <TableCell sx={headCell} align="right">CANCELLED</TableCell>
              <TableCell sx={headCell} align="right">NO DRIVER</TableCell>
              <TableCell sx={headCell} align="right">SHARED</TableCell>
              <TableCell sx={headCell} align="right">EST. GROSS FARE</TableCell>
              <TableCell sx={headCell} align="right">COMPLETION</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key} sx={{ '&:hover': { backgroundColor: 'var(--mac-canvas-bg)' } }}>
                <TableCell sx={{ px: 2, fontWeight: 600 }}>{r.label}</TableCell>
                <TableCell sx={{ px: 2 }} align="right">{r.total}</TableCell>
                <TableCell sx={{ px: 2, color: '#059669', fontWeight: 600 }} align="right">{r.completed}</TableCell>
                <TableCell sx={{ px: 2, color: r.cancelled ? '#DC2626' : undefined }} align="right">{r.cancelled}</TableCell>
                <TableCell sx={{ px: 2 }} align="right">{r.noDriverFound}</TableCell>
                <TableCell sx={{ px: 2 }} align="right">{r.sharedTrips}</TableCell>
                <TableCell sx={{ px: 2, fontWeight: 600 }} align="right">{peso(r.grossFare)}</TableCell>
                <TableCell sx={{ px: 2 }} align="right">{r.total > 0 ? `${r.completionRate}%` : '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)', mt: 1.5 }}>
        {todaName}: counted by the day the booking was created (Asia/Manila). Estimated gross fare value is the sum of the final fares of completed trips, paid in cash.
      </Typography>
    </>
  );
};

export default BookingVolumeReport;
