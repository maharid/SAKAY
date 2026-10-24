import React, { useMemo, useState } from 'react';
import { Box, TableBody, TableCell, TableRow, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';

import { serviceUtilization, volumeByPeriod } from '@sakay/shared';
import type { BookingLike, ReportTable, VolumePeriod } from '@sakay/shared';

import { PILOT_COVERAGE_TEXT } from '../common/PilotCoverageNote';
import { DataTableCard, DataTableMessageRow } from '../common/DataTable';
import { OperationsStatStrip } from '../operations/OperationsStatStrip';
import type { OperationsStat } from '../operations/OperationsStatStrip';
import { OPS_BORDER, OPS_TEXT, opsFocusRing } from '../operations/operationsTheme';
import { CONTROL, FONT, SPACE } from '../../styles/density';
import { ReportExportButtons } from './ReportExportButtons';
import type { ExportFormat } from './ReportExportButtons';

/**
 * TODA reports: daily, weekly and monthly booking reports, platform booking volume and estimated gross fare value (checklist:
 * TODA Administrator > View Reports). Every figure is computed from the TODA's own bookings (shared transportAnalytics), never typed in.
 * The estimated gross fare value is the sum of the final fares of the completed trips; fares are settled in cash.
 */
interface BookingVolumeReportProps {
  trips: BookingLike[];
  todaName: string;
  /** called after the file is saved, so the page can write the audit entry */
  onExported: (reportName: string, format: ExportFormat) => void;
}

const PERIOD_LABEL: Record<VolumePeriod, string> = { day: 'Daily', week: 'Weekly', month: 'Monthly' };
const PERIOD_COLUMN: Record<VolumePeriod, string> = { day: 'DAY', week: 'WEEK (MON-SUN)', month: 'MONTH' };
const peso = (n: number): string => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const BookingVolumeReport: React.FC<BookingVolumeReportProps> = ({ trips, todaName, onExported }) => {
  const [period, setPeriod] = useState<VolumePeriod>('day');

  const totals = useMemo(() => serviceUtilization(trips), [trips]);
  // The newest period first, the way a report is read.
  const rows = useMemo(() => [...volumeByPeriod(trips, period)].reverse(), [trips, period]);

  // The report as shown; the Excel, CSV and PDF files contain exactly this table
  const table: ReportTable = useMemo(
    () => ({
      title: `Booking Volume Report (${PERIOD_LABEL[period]})`,
      notes: [`${todaName}: bookings counted by the day they were created (Asia/Manila). Estimated gross fare value is the sum of the final fares of completed trips, paid in cash.`, PILOT_COVERAGE_TEXT],
      headers: [PERIOD_COLUMN[period], 'Booking Requests', 'Completed', 'Cancelled', 'No Driver Found', 'Shared Trips', 'Estimated Gross Fare (PHP)', 'Average Fare (PHP)', 'Completion Rate (%)'],
      rows: rows.map((r) => [r.label, r.total, r.completed, r.cancelled, r.noDriverFound, r.sharedTrips, r.grossFare.toFixed(2), r.averageFare.toFixed(2), r.completionRate]),
    }),
    [period, rows, todaName]
  );

  const stats: OperationsStat[] = [
    { key: 'volume', label: 'Platform booking volume', value: String(totals.requests), note: 'All booking requests recorded for your TODA' },
    { key: 'completed', label: 'Completed trips', value: String(totals.completed), note: `${totals.completionRate}% of requests`, tone: totals.completed > 0 ? 'success' : 'neutral' },
    { key: 'cancelled', label: 'Cancelled / no driver', value: `${totals.cancelled + totals.noDriverFound}`, note: `${totals.cancelled} cancelled, ${totals.noDriverFound} no driver found`, tone: totals.cancelled + totals.noDriverFound > 0 ? 'danger' : 'neutral' },
    { key: 'fare', label: 'Estimated gross fare value', value: peso(totals.grossFare), note: `Average ${peso(totals.averageFare)} per completed trip`, tone: 'brand' },
  ];

  return (
    <>
      <OperationsStatStrip stats={stats} />

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '13px', mb: SPACE.gap }}>
        <ToggleButtonGroup
          exclusive
          value={period}
          aria-label="Report period"
          onChange={(_, next: VolumePeriod | null) => next && setPeriod(next)}
          sx={{
            '& .MuiToggleButton-root': {
              textTransform: 'none',
              fontSize: FONT.body,
              fontWeight: 600,
              px: '16px',
              minHeight: CONTROL.height,
              color: OPS_TEXT.primary,
              backgroundColor: '#FFFFFF',
              border: `1px solid ${OPS_BORDER}`,
              '@media (pointer: coarse)': { minHeight: CONTROL.touchHeight },
              ...opsFocusRing,
              '&.Mui-selected': { color: OPS_TEXT.brand, backgroundColor: 'var(--sakay-orange-soft)', borderColor: 'var(--sakay-orange-border)' },
            },
          }}
        >
          {(Object.keys(PERIOD_LABEL) as VolumePeriod[]).map((p) => (
            <ToggleButton key={p} value={p}>{PERIOD_LABEL[p]}</ToggleButton>
          ))}
        </ToggleButtonGroup>
        <ReportExportButtons table={table} generatedBy={`${todaName} Administrator`} onExported={onExported} />
      </Box>

      <DataTableCard
        label="Booking volume"
        minWidth={820}
        columns={[
          { label: PERIOD_COLUMN[period] },
          { label: 'Requests', numeric: true },
          { label: 'Completed', numeric: true },
          { label: 'Cancelled', numeric: true },
          { label: 'No driver', numeric: true },
          { label: 'Shared', numeric: true },
          { label: 'Est. gross fare', numeric: true },
          { label: 'Completion', numeric: true },
        ]}
      >
        <TableBody>
          {rows.length > 0 ? (
            rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell sx={{ fontWeight: 600 }}>{r.label}</TableCell>
                <TableCell>{r.total}</TableCell>
                <TableCell sx={{ color: OPS_TEXT.success, fontWeight: 600 }}>{r.completed}</TableCell>
                <TableCell sx={{ color: r.cancelled ? OPS_TEXT.danger : undefined }}>{r.cancelled}</TableCell>
                <TableCell>{r.noDriverFound}</TableCell>
                <TableCell>{r.sharedTrips}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{peso(r.grossFare)}</TableCell>
                <TableCell>{r.total > 0 ? `${r.completionRate}%` : '-'}</TableCell>
              </TableRow>
            ))
          ) : (
            <DataTableMessageRow colSpan={8} kind="empty" title="No bookings yet" hint="Booking requests of your TODA are counted here by day, week or month." />
          )}
        </TableBody>
      </DataTableCard>
      <Typography sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary, mt: '10px', lineHeight: 1.5 }}>
        {todaName}: counted by the day the booking was created (Asia/Manila). Estimated gross fare value is the sum of the final fares of completed trips, paid in cash.
      </Typography>
    </>
  );
};

export default BookingVolumeReport;
