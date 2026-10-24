import React, { useMemo } from 'react';
import { Box, TableBody, TableCell, TableRow } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

import { DRIVER_ACTIVITY_WINDOW_DAYS, driverActivity } from '@sakay/shared';
import type { BookingLike, ReportTable } from '@sakay/shared';

import { PILOT_COVERAGE_TEXT } from '../common/PilotCoverageNote';
import { CellStack, DataTableCard, DataTableMessageRow, StatusPill } from '../common/DataTable';
import { OperationsStatStrip } from '../operations/OperationsStatStrip';
import type { OperationsStat } from '../operations/OperationsStatStrip';
import { OPS_TEXT } from '../operations/operationsTheme';
import { SPACE } from '../../styles/density';
import { ReportExportButtons } from './ReportExportButtons';
import type { ExportFormat } from './ReportExportButtons';

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
  onExported: (reportName: string, format: ExportFormat) => void;
  /** Who the PDF says generated it */
  generatedBy?: string;
}

const peso = (n: number): string => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dayOf = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }) : 'No completed trip yet';

export const DriverActivityReport: React.FC<DriverActivityReportProps> = ({ trips, drivers, onExported, generatedBy = 'TODA Administrator' }) => {
  const rows = useMemo(() => driverActivity(trips, drivers), [trips, drivers]);
  const active = rows.filter((r) => r.activeInWindow).length;
  const completed = rows.reduce((n, r) => n + r.completed, 0);
  const km = Math.round(rows.reduce((n, r) => n + r.km, 0) * 10) / 10;
  const rate = rows.length > 0 ? Math.round((active / rows.length) * 100) : 0;

  // The report as shown; the Excel, CSV and PDF files contain exactly this table
  const table: ReportTable | null = useMemo(
    () =>
      rows.length === 0
        ? null
        : {
            title: 'Driver Trip Volume and Activity Report',
            notes: [`One row per driver of your TODA. Active means a completed trip in the last ${DRIVER_ACTIVITY_WINDOW_DAYS} days.`, PILOT_COVERAGE_TEXT],
            headers: ['Driver', 'Plate / Franchise', 'Completed Trips', 'Cancelled', 'Distance (km)', 'Estimated Gross Fare (PHP)', 'Latest Completed Trip', `Active In Last ${DRIVER_ACTIVITY_WINDOW_DAYS} Days`],
            rows: rows.map((r) => [r.name, r.plate, r.completed, r.cancelled, r.km, r.grossFare.toFixed(2), dayOf(r.lastTripAt), r.activeInWindow ? 'Yes' : 'No']),
          },
    [rows]
  );

  const stats: OperationsStat[] = [
    { key: 'registered', label: 'Registered drivers', value: String(rows.length), note: 'Drivers of your TODA with a SAKAY account' },
    { key: 'utilization', label: 'Driver utilization', value: rows.length > 0 ? `${rate}%` : '-', note: `${active} of ${rows.length} completed a trip in the last ${DRIVER_ACTIVITY_WINDOW_DAYS} days` },
    { key: 'completed', label: 'Completed trips', value: String(completed), note: 'All time', tone: completed > 0 ? 'success' : 'neutral' },
    { key: 'distance', label: 'Distance carried', value: `${km} km`, note: 'Road distance of completed trips', tone: 'brand' },
  ];

  return (
    <>
      <OperationsStatStrip stats={stats} />

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: SPACE.gap }}>
        <ReportExportButtons table={table} generatedBy={generatedBy} onExported={onExported} />
      </Box>

      <DataTableCard
        label="Driver activity"
        minWidth={860}
        columns={[
          { label: 'Driver' },
          { label: 'Completed', numeric: true },
          { label: 'Cancelled', numeric: true },
          { label: 'Distance', numeric: true },
          { label: 'Est. gross fare', numeric: true },
          { label: 'Latest completed trip' },
          { label: `Active (last ${DRIVER_ACTIVITY_WINDOW_DAYS} days)` },
        ]}
      >
        <TableBody>
          {rows.length === 0 ? (
            <DataTableMessageRow colSpan={7} kind="empty" title="No registered drivers yet" hint="Drivers appear here once their SAKAY application is endorsed and approved." />
          ) : (
            rows.map((r) => (
              <TableRow key={r.driverId}>
                <TableCell>
                  <CellStack primary={r.name} secondary={r.plate || 'No plate on record'} />
                </TableCell>
                <TableCell sx={{ fontWeight: 600, color: OPS_TEXT.success }}>{r.completed}</TableCell>
                <TableCell sx={{ color: r.cancelled ? OPS_TEXT.danger : undefined }}>{r.cancelled}</TableCell>
                <TableCell>{r.km} km</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{peso(r.grossFare)}</TableCell>
                <TableCell>{dayOf(r.lastTripAt)}</TableCell>
                <TableCell>
                  {r.activeInWindow ? (
                    <StatusPill label="Active" tone="success" icon={<CheckCircleIcon aria-hidden sx={{ fontSize: 13 }} />} />
                  ) : (
                    <StatusPill label="Inactive" tone="neutral" />
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </DataTableCard>
    </>
  );
};

export default DriverActivityReport;
