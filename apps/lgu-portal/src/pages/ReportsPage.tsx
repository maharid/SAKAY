import React, { useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Card,
  CardContent,
  Button,
  Tabs,
  Tab,
  CircularProgress,
  LinearProgress,
  Alert,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import AssessmentIcon from '@mui/icons-material/Assessment';
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import ScheduleIcon from '@mui/icons-material/Schedule';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import GroupsIcon from '@mui/icons-material/Groups';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import PieChartIcon from '@mui/icons-material/PieChart';
import TimelineIcon from '@mui/icons-material/Timeline';
import MapIcon from '@mui/icons-material/Map';
import CancelIcon from '@mui/icons-material/Cancel';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import { exportReportCsv, exportReportXlsx, printReportPdf } from '@sakay/shared';
import type { VolumePeriod, XlsxLike } from '@sakay/shared';

import { AnalyticsFilterBar } from '../components/admin/AnalyticsFilterBar';
import { PeakHoursByGroupTable } from '../components/admin/PeakHoursByGroupTable';
import { PilotCoverageNote } from '../components/admin/PilotCoverageNote';
import { ReportTableView } from '../components/admin/ReportTableView';
import { useOperationalReports } from '../hooks/useOperationalReports';
import { recordAdminAuditAction } from '../services/adminApiService';
import { reportTableFor } from '../utils/reportTables';
import type { ReportKind } from '../utils/reportTables';

/**
 * ============================================================================
 * TRANSPORTATION REPORTS GENERATOR PAGE (ReportsPage.tsx)
 * ============================================================================
 * Checklist Scope (A9):
 *   ● View and generate reports, each exportable as Excel (.xlsx), CSV and PDF
 *     ○ Booking reports (with the estimated gross fare value)
 *     ○ Booking trend report (daily, weekly, monthly, with the change from the period before)
 *     ○ Participating-driver utilization report
 *     ○ TODA performance report
 *     ○ Peak-hour report (all bookings and by TODA)
 *     ○ SAKAY Booking Activity Hotspot report (pickups, drop-offs, weekdays against weekends)
 *     ○ Barangay demand report
 *     ○ Service utilization report
 *     ○ Cancellation summary report
 *     ○ Incident summary report
 *   ● Every report follows the date range, TODA and barangay filter.
 * The PDF is the browser's print dialog ("Save as PDF"); the Excel file is a real .xlsx workbook.
 * ============================================================================
 */

type ExportFormat = 'xlsx' | 'csv' | 'pdf';

const NO_RECORDS: Record<ReportKind, string> = {
  Bookings: 'No booking requests match the filter.',
  Trend: 'No periods to show.',
  Drivers: 'No driver records match the filter.',
  TODA: 'No accredited TODA associations match the filter.',
  PeakHours: 'No booking requests match the filter.',
  Hotspots: 'No booking with a pickup or drop-off location matches the filter.',
  Barangay: 'No booking requests match the filter.',
  Service: 'No booking requests match the filter.',
  Cancellations: 'No booking requests match the filter.',
  Incidents: 'No incident reports match the filter.',
};

const cardSx = { borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', boxShadow: 'var(--mac-shadow-card)', backgroundColor: '#FFFFFF' };

interface KpiCardProps {
  title: string;
  value: string | number;
  caption: string;
  color: string;
}

const KpiCard: React.FC<KpiCardProps> = ({ title, value, caption, color }) => (
  <Card sx={cardSx}>
    <CardContent sx={{ p: '20px 22px !important' }}>
      <Typography sx={{ fontSize: '10px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', mb: 1 }}>{title}</Typography>
      <Typography sx={{ fontSize: '22.4px', fontWeight: 700, color, mb: 0.5 }}>{value}</Typography>
      <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)' }}>{caption}</Typography>
    </CardContent>
  </Card>
);

export const ReportsPage: React.FC = () => {
  const { data: reportsData, filter, setFilter, isLoading, loadError, reload } = useOperationalReports();
  const [activeReportTab, setActiveReportTab] = useState<ReportKind>('Bookings');
  const [trendPeriod, setTrendPeriod] = useState<VolumePeriod>('week');
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [exportNote, setExportNote] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);

  const table = reportsData ? reportTableFor(activeReportTab, reportsData, trendPeriod) : null;

  const runExport = async (format: ExportFormat) => {
    if (!table || !reportsData) return;
    setExporting(format);
    setExportNote(null);
    try {
      if (format === 'xlsx') {
        exportReportXlsx((await import('xlsx')) as unknown as XlsxLike, table);
      } else if (format === 'csv') {
        exportReportCsv(table);
      } else if (!printReportPdf(table, 'LGU Administrator')) {
        throw new Error('The browser blocked the PDF window. Allow pop-ups for this site and try again.');
      }
      // who exported which report, for which filter (the report itself is never changed by this)
      await recordAdminAuditAction({
        actionType: 'REPORT_EXPORTED',
        targetName: table.title,
        details: `Exported '${table.title}' as ${format === 'xlsx' ? 'Excel' : format === 'csv' ? 'CSV' : 'PDF'} (${table.rows.length} rows). ${reportsData.filterText}.`,
        category: 'System',
      });
      setExportNote({ severity: 'success', text: `${table.title}: ${table.rows.length} row${table.rows.length === 1 ? '' : 's'} exported (${reportsData.filterText}).` });
    } catch (err) {
      setExportNote({ severity: 'error', text: err instanceof Error ? err.message : 'The report could not be exported.' });
    } finally {
      setExporting(null);
    }
  };

  const summary = reportsData?.summary || {
    totalBookings: 0,
    completedTrips: 0,
    cancelledTrips: 0,
    totalRevenue: 0,
    averageFare: 0,
    activeDrivers: 0,
    accreditedTodas: 0,
  };

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 6 }}>
      {/* 1. Header Toolbar with Export Actions */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2.5, flexWrap: 'wrap', gap: 2 }}>
        <Box sx={{ maxWidth: 900 }}>
          <Typography sx={{ fontSize: '16px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>Official Municipal Transportation Reports</Typography>
          <Typography sx={{ fontSize: '10.8px', color: 'var(--mac-text-muted)', mt: '3px', mb: 0.5 }}>
            Reporting for tricycle public transit operations in Calapan City
          </Typography>
          <PilotCoverageNote />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Button
            onClick={() => void reload()}
            startIcon={<RefreshIcon />}
            variant="outlined"
            size="small"
            sx={{ textTransform: 'none', borderColor: 'var(--mac-border-color)', color: 'var(--mac-text-primary)' }}
          >
            Refresh
          </Button>
          <Button
            onClick={() => void runExport('xlsx')}
            disabled={!table || exporting !== null}
            startIcon={<DownloadIcon />}
            variant="contained"
            size="small"
            sx={{ textTransform: 'none', backgroundColor: 'var(--sakay-orange)', fontWeight: 600 }}
          >
            {exporting === 'xlsx' ? 'Exporting...' : 'Export Excel (.xlsx)'}
          </Button>
          <Button onClick={() => void runExport('csv')} disabled={!table || exporting !== null} variant="outlined" size="small" sx={{ textTransform: 'none', fontWeight: 600 }}>
            {exporting === 'csv' ? 'Exporting...' : 'Export CSV'}
          </Button>
          <Button onClick={() => void runExport('pdf')} disabled={!table || exporting !== null} variant="outlined" size="small" sx={{ textTransform: 'none', fontWeight: 600 }}>
            {exporting === 'pdf' ? 'Preparing...' : 'Save as PDF'}
          </Button>
        </Box>
      </Box>

      {loadError && <Alert severity="error" sx={{ mb: 2 }}>{loadError}</Alert>}
      {exportNote && <Alert severity={exportNote.severity} onClose={() => setExportNote(null)} sx={{ mb: 2 }}>{exportNote.text}</Alert>}

      {reportsData && <AnalyticsFilterBar filter={filter} onChange={setFilter} todaOptions={reportsData.todaOptions} barangayOptions={reportsData.barangayOptions} />}

      {/* 2. Top Summary KPI Cards */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2.5, mb: 4 }}>
        <KpiCard title="Total Completed Trips" value={summary.completedTrips} caption={`Out of ${summary.totalBookings} total bookings`} color="#2E7D32" />
        <KpiCard title="Estimated Gross Fare Value" value={`₱${summary.totalRevenue.toLocaleString()}`} caption={`Average ₱${summary.averageFare.toFixed(2)} / completed trip`} color="var(--sakay-orange)" />
        <KpiCard title="Verified Driver Workforce" value={summary.activeDrivers} caption="Verified drivers in this selection" color="#1565C0" />
        <KpiCard title="Accredited TODAs" value={summary.accreditedTodas} caption="Authorized transport associations in this selection" color="var(--mac-text-primary)" />
      </Box>

      {/* 3. Report Category Tabs */}
      <Box sx={{ mb: 3, borderBottom: '1px solid var(--mac-border-color)' }}>
        <Tabs
          value={activeReportTab}
          onChange={(_, val: ReportKind) => setActiveReportTab(val)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            '& .MuiTabs-indicator': { backgroundColor: 'var(--sakay-orange)', height: 3 },
            '& .MuiTab-root': { textTransform: 'none', fontWeight: 600, fontSize: '11.3px', minHeight: 48 },
            '& .Mui-selected': { color: 'var(--sakay-orange) !important' },
          }}
        >
          <Tab icon={<AssessmentIcon fontSize="small" />} iconPosition="start" label="1. Booking Reports" value="Bookings" />
          <Tab icon={<TimelineIcon fontSize="small" />} iconPosition="start" label="2. Booking Trend" value="Trend" />
          <Tab icon={<DirectionsCarIcon fontSize="small" />} iconPosition="start" label="3. Driver Utilization" value="Drivers" />
          <Tab icon={<GroupsIcon fontSize="small" />} iconPosition="start" label="4. TODA Performance" value="TODA" />
          <Tab icon={<ScheduleIcon fontSize="small" />} iconPosition="start" label="5. Peak-Hour Reports" value="PeakHours" />
          <Tab icon={<MapIcon fontSize="small" />} iconPosition="start" label="6. Booking Activity Hotspots" value="Hotspots" />
          <Tab icon={<LocationOnIcon fontSize="small" />} iconPosition="start" label="7. Barangay Demand" value="Barangay" />
          <Tab icon={<PieChartIcon fontSize="small" />} iconPosition="start" label="8. Service Utilization" value="Service" />
          <Tab icon={<CancelIcon fontSize="small" />} iconPosition="start" label="9. Cancellations" value="Cancellations" />
          <Tab icon={<ReportProblemIcon fontSize="small" />} iconPosition="start" label="10. Incidents" value="Incidents" />
        </Tabs>
      </Box>

      {/* 4. Tab Content Panels */}
      {isLoading && !reportsData ? (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <CircularProgress size={32} sx={{ color: 'var(--sakay-orange)', mb: 1.5 }} />
          <Typography sx={{ fontSize: '11.3px', color: 'var(--mac-text-muted)' }}>Generating report...</Typography>
        </Box>
      ) : (
        reportsData &&
        table && (
          <Paper elevation={0} sx={{ ...cardSx, overflow: 'hidden', p: 3 }}>
            <Typography sx={{ fontSize: '10.4px', color: 'var(--mac-text-muted)', mb: 2 }}>Showing: {reportsData.filterText}</Typography>

            {activeReportTab === 'Trend' && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                <ToggleButtonGroup size="small" exclusive value={trendPeriod} onChange={(_, v: VolumePeriod | null) => v && setTrendPeriod(v)}>
                  <ToggleButton value="day" sx={{ textTransform: 'none', px: 2 }}>Daily</ToggleButton>
                  <ToggleButton value="week" sx={{ textTransform: 'none', px: 2 }}>Weekly</ToggleButton>
                  <ToggleButton value="month" sx={{ textTransform: 'none', px: 2 }}>Monthly</ToggleButton>
                </ToggleButtonGroup>
                {(() => {
                  const c = reportsData.comparison[trendPeriod];
                  if (!c) return <Typography sx={{ fontSize: '10.8px', color: 'var(--mac-text-muted)' }}>Fewer than two complete periods: nothing to compare yet.</Typography>;
                  return (
                    <Alert severity={c.direction === 'decline' ? 'warning' : c.direction === 'growth' ? 'success' : 'info'} sx={{ py: 0, '& .MuiAlert-message': { fontSize: '11.3px' } }}>
                      {c.direction === 'growth' ? 'Growth' : c.direction === 'decline' ? 'Decline' : 'No change'}: {c.current.label} had {c.current.total} booking{c.current.total === 1 ? '' : 's'} against {c.previous.total} in {c.previous.label}
                      {c.changePct === null ? '' : ` (${c.change > 0 ? '+' : ''}${c.changePct}%)`}.
                    </Alert>
                  );
                })()}
              </Box>
            )}

            {activeReportTab === 'PeakHours' && (
              <Box sx={{ mb: 4 }}>
                <Typography sx={{ fontSize: '12.8px', fontWeight: 700, color: 'var(--mac-text-primary)', mb: 2 }}>
                  Peak Travel Hours (when SAKAY bookings are created, Asia/Manila time)
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  {reportsData.peakHourDistribution.map((h) => (
                    <Box key={h.hour} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Typography sx={{ width: 100, fontSize: '10.8px', fontWeight: 600, color: 'var(--mac-text-secondary)' }}>{h.hour}</Typography>
                      <Box sx={{ flex: 1 }}>
                        <LinearProgress
                          variant="determinate"
                          value={(h.count / Math.max(1, ...reportsData.peakHourDistribution.map((x) => x.count))) * 100}
                          sx={{ height: 12, borderRadius: 6, backgroundColor: '#F0F0F2', '& .MuiLinearProgress-bar': { backgroundColor: 'var(--sakay-orange)', borderRadius: 6 } }}
                        />
                      </Box>
                      <Typography sx={{ width: 80, fontSize: '10.8px', fontWeight: 700, textAlign: 'right', color: 'var(--mac-text-primary)' }}>
                        {h.count} {h.count === 1 ? 'Trip' : 'Trips'}
                      </Typography>
                    </Box>
                  ))}
                </Box>
                <Typography sx={{ fontSize: '12.8px', fontWeight: 700, color: 'var(--mac-text-primary)', mt: 4, mb: 1.5 }}>Peak hours of each TODA</Typography>
                <PeakHoursByGroupTable groupLabel="TODA" rows={reportsData.peakHoursByToda} />
                <Typography sx={{ fontSize: '12.8px', fontWeight: 700, color: 'var(--mac-text-primary)', mt: 4, mb: 1.5 }}>Peak hours of each barangay (pickup)</Typography>
                <PeakHoursByGroupTable groupLabel="Barangay (pickup)" rows={reportsData.peakHoursByBarangay} />
                <Typography sx={{ fontSize: '12.8px', fontWeight: 700, color: 'var(--mac-text-primary)', mt: 4, mb: 1.5 }}>The exported table</Typography>
              </Box>
            )}

            {activeReportTab === 'Barangay' && (
              <Box sx={{ mb: 4 }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  {reportsData.barangayDemand.map((b) => (
                    <Box key={b.barangay} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Typography sx={{ width: 190, fontSize: '10.8px', fontWeight: 600, color: 'var(--mac-text-secondary)' }}>{b.barangay}</Typography>
                      <LinearProgress variant="determinate" value={b.percentage} sx={{ flex: 1, height: 8, borderRadius: 4, '& .MuiLinearProgress-bar': { backgroundColor: '#1565C0' } }} />
                      <Typography sx={{ width: 110, fontSize: '10.4px', fontWeight: 600, color: 'var(--mac-text-secondary)', textAlign: 'right' }}>
                        {b.count} pickup{b.count === 1 ? '' : 's'} · {b.percentage}%
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}

            <ReportTableView table={table} emptyText={NO_RECORDS[activeReportTab]} />
          </Paper>
        )
      )}
    </Box>
  );
};
