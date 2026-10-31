import React, { useState } from 'react';
import { Alert, Box, Button, CircularProgress, Tab, Tabs, Typography } from '@mui/material';
import AssessmentIcon from '@mui/icons-material/Assessment';
import CancelIcon from '@mui/icons-material/Cancel';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import GroupsIcon from '@mui/icons-material/Groups';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import MapIcon from '@mui/icons-material/Map';
import PieChartIcon from '@mui/icons-material/PieChart';
import RefreshIcon from '@mui/icons-material/Refresh';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import ScheduleIcon from '@mui/icons-material/Schedule';
import TimelineIcon from '@mui/icons-material/Timeline';
import { ExportToolbar, compareWithPrevious, scopeSeries } from '@sakay/shared';
import type { VolumePeriod } from '@sakay/shared';

import { AnalyticsFilterBar } from '../components/admin/AnalyticsFilterBar';
import { ReportPeriodBar } from '../components/admin/ReportPeriodBar';
import { HotspotsSection, PeakHoursSection, ReportChart } from '../components/admin/ReportCharts';
import { ReportTableView } from '../components/admin/ReportTableView';
import { PageNotice } from '../components/common/PageNotice';
import { SegmentedToggle } from '../components/common/SegmentedToggle';
import type { SegmentedOption } from '../components/common/SegmentedToggle';
import { StatStrip } from '../components/common/StatStrip';
import { useAuth } from '../contexts/AuthContext';
import { useOperationalReports } from '../hooks/useOperationalReports';
import { useReportPeriod } from '../hooks/useReportPeriod';
import { recordAdminAuditStrict } from '../services/adminApiService';
import { loadXlsx } from '../utils/loadXlsx';
import { reportTableFor } from '../utils/reportTables';
import type { ReportKind } from '../utils/reportTables';
import { FONT, SPACE } from '../styles/density';
import { PAGE_DIVIDER, PAGE_TEXT, pageCardSx, pageFocusRing, rowActionSx } from '../styles/pageTheme';

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

const TREND_PERIOD_OPTIONS: SegmentedOption<VolumePeriod>[] = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];

// The ten reports, in the order of the checklist
const REPORT_TABS: Array<{ value: ReportKind; label: string; icon: React.ReactElement }> = [
  { value: 'Bookings', label: 'Booking reports', icon: <AssessmentIcon fontSize="small" /> },
  { value: 'Trend', label: 'Booking trend', icon: <TimelineIcon fontSize="small" /> },
  { value: 'Drivers', label: 'Driver utilization', icon: <DirectionsCarIcon fontSize="small" /> },
  { value: 'TODA', label: 'TODA performance', icon: <GroupsIcon fontSize="small" /> },
  { value: 'PeakHours', label: 'Peak-hour reports', icon: <ScheduleIcon fontSize="small" /> },
  { value: 'Hotspots', label: 'Activity hotspots', icon: <MapIcon fontSize="small" /> },
  { value: 'Barangay', label: 'Barangay demand', icon: <LocationOnIcon fontSize="small" /> },
  { value: 'Service', label: 'Service utilization', icon: <PieChartIcon fontSize="small" /> },
  { value: 'Cancellations', label: 'Cancellations', icon: <CancelIcon fontSize="small" /> },
  { value: 'Incidents', label: 'Incidents', icon: <ReportProblemIcon fontSize="small" /> },
];

const tabId = (kind: ReportKind) => `report-tab-${kind}`;
const PANEL_ID = 'report-panel';

export const ReportsPage: React.FC = () => {
  const { data: reportsData, filter, setFilter, isLoading, loadError, reload } = useOperationalReports();
  const { adminProfile } = useAuth();
  const [activeReportTab, setActiveReportTab] = useState<ReportKind>('Bookings');
  const [trendPeriod, setTrendPeriod] = useState<VolumePeriod>('week');

  // Decision D-P6: the reports follow ONE day, week or month
  const reportPeriod = useReportPeriod(filter, setFilter, 'week');
  const singleScope = reportPeriod.scope !== 'custom' && reportPeriod.range ? reportPeriod.scope : null;
  const scopeInfo = singleScope && reportPeriod.range && reportsData
    ? { scope: singleScope, label: reportPeriod.range.label, rows: scopeSeries(reportsData.bookings, singleScope, reportPeriod.range.from, reportPeriod.range.to) }
    : undefined;
  const table = reportsData ? reportTableFor(activeReportTab, reportsData, trendPeriod, scopeInfo) : null;

  const summary = reportsData?.summary || {
    totalBookings: 0,
    completedTrips: 0,
    cancelledTrips: 0,
    totalRevenue: 0,
    averageFare: 0,
    activeDrivers: 0,
    accreditedTodas: 0,
  };

  const refreshButton = (
    <Button onClick={() => void reload()} startIcon={<RefreshIcon sx={{ fontSize: 16 }} />} sx={rowActionSx('neutral')}>
      Refresh
    </Button>
  );

  const trendRows = scopeInfo ? scopeInfo.rows : reportsData ? reportsData.volume[trendPeriod] : [];

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 4.8 }}>
      {loadError && (
        <PageNotice
          tone="danger"
          title="The reports could not be loaded"
          action={
            <Button onClick={() => void reload()} sx={rowActionSx('neutral')}>
              Try again
            </Button>
          }
        >
          {loadError}
        </PageNotice>
      )}
      {/* 2. Filters: every report follows them */}
      {reportsData && (
        <Box sx={{ mb: SPACE.gapLarge }}>
          <ReportPeriodBar period={reportPeriod} />
        </Box>
      )}
      {reportsData && <AnalyticsFilterBar filter={filter} onChange={setFilter} todaOptions={reportsData.todaOptions} barangayOptions={reportsData.barangayOptions} actions={refreshButton} hideDates={singleScope !== null} />}

      {/* 3. The key figures */}
      <StatStrip
        label="Report totals"
        minCellWidth={200}
        stats={[
          { key: 'completed', label: 'Completed trips', value: summary.completedTrips, note: `Out of ${summary.totalBookings} total bookings`, tone: 'success' },
          { key: 'gross', label: 'Estimated gross fare value', value: `₱${summary.totalRevenue.toLocaleString()}`, note: `Average ₱${summary.averageFare.toFixed(2)} / completed trip` },
          { key: 'drivers', label: 'Verified driver workforce', value: summary.activeDrivers, note: 'Verified drivers in this selection' },
          { key: 'todas', label: 'Accredited TODAs', value: summary.accreditedTodas, note: 'Authorized transport associations in this selection' },
        ]}
      />

      {/* 4. The ten reports */}
      <Box sx={{ ...pageCardSx, overflow: 'hidden' }}>
        <Box sx={{ borderBottom: `1px solid ${PAGE_DIVIDER}`, backgroundColor: '#FAFAF8' }}>
          <Tabs
            value={activeReportTab}
            onChange={(_, val: ReportKind) => setActiveReportTab(val)}
            variant="scrollable"
            scrollButtons="auto"
            aria-label="Reports"
            sx={{
              minHeight: 44,
              '& .MuiTabs-indicator': { backgroundColor: '#C75000', height: 3 },
              '& .MuiTab-root': { textTransform: 'none', fontWeight: 600, fontSize: FONT.body, minHeight: 44, color: PAGE_TEXT.secondary, px: '16px', ...pageFocusRing, '&:focus-visible': { outline: `2px solid ${PAGE_TEXT.brand}`, outlineOffset: '-2px' } },
              '& .MuiTab-root.Mui-selected': { color: `${PAGE_TEXT.brand} !important`, fontWeight: 700 },
              '& .MuiTabs-scrollButtons.Mui-disabled': { opacity: 0.3 },
            }}
          >
            {REPORT_TABS.map((t) => (
              <Tab key={t.value} id={tabId(t.value)} aria-controls={PANEL_ID} icon={t.icon} iconPosition="start" label={t.label} value={t.value} />
            ))}
          </Tabs>
        </Box>

        {/* 5. The chosen report */}
        <Box role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(activeReportTab)} sx={{ p: SPACE.cardLarge, minWidth: 0 }}>
          {isLoading && !reportsData ? (
            <Box role="status" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', py: '48px' }}>
              <CircularProgress size={21} sx={{ color: 'var(--sakay-orange)' }} />
              <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary }}>Generating report...</Typography>
            </Box>
          ) : (
            reportsData &&
            table && (
              <>
                {/* what the report follows, and how to take it away (Excel, CSV, PDF: the shared export toolbar; the confirmation is a toast) */}
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px 16px', mb: '16px' }}>
                  <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, minWidth: 0, overflowWrap: 'anywhere' }}>Showing: {reportsData.filterText}</Typography>
                  <ExportToolbar
                    getTable={() => table}
                    meta={() => ({ exportedBy: adminProfile?.full_name || 'LGU Administrator', role: 'LGU Administrator, City Transport Office', organisation: 'City Transport Office, Calapan City', scope: 'lgu' })}
                    loadXlsx={loadXlsx}
                    record={({ format, table: exported }) =>
                      recordAdminAuditStrict({
                        actionType: 'REPORT_EXPORTED',
                        targetName: exported.title,
                        details: `Exported '${exported.title}' as ${format} (${exported.rows.length} rows). ${reportsData.filterText}. Exported by ${adminProfile?.full_name || 'the LGU Administrator'}.`,
                        category: 'System',
                      })
                    }
                    disabled={!table}
                  />
                </Box>

                {activeReportTab === 'Trend' && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px 14px', flexWrap: 'wrap', mb: '16px' }}>
                    {!singleScope && <SegmentedToggle label="Trend period" value={trendPeriod} options={TREND_PERIOD_OPTIONS} onChange={setTrendPeriod} />}
                    {singleScope && scopeInfo && (() => {
                      const c = reportsData.previousWindowTotal === null ? null : compareWithPrevious(scopeInfo.rows.reduce((n, r) => n + r.total, 0), reportsData.previousWindowTotal, reportPeriod.range!.from, reportPeriod.range!.to);
                      if (!c) return null;
                      return (
                        <Alert severity={c.direction === 'decline' ? 'warning' : c.direction === 'growth' ? 'success' : 'info'} sx={{ py: '2px', borderRadius: '10px', '& .MuiAlert-message': { fontSize: FONT.body, lineHeight: 1.5 } }}>
                          {c.direction === 'growth' ? 'Growth' : c.direction === 'decline' ? 'Decline' : 'No change'}: {scopeInfo.label} had {c.current} booking{c.current === 1 ? '' : 's'} against {c.previous} in {c.previousLabel}{c.changePct === null ? '' : ` (${c.change > 0 ? '+' : ''}${c.changePct}%)`}.
                        </Alert>
                      );
                    })()}
                    {!singleScope && (() => {
                      const c = reportsData.comparison[trendPeriod];
                      if (!c) return <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary }}>Fewer than two complete periods: nothing to compare yet.</Typography>;
                      return (
                        <Alert severity={c.direction === 'decline' ? 'warning' : c.direction === 'growth' ? 'success' : 'info'} sx={{ py: '2px', borderRadius: '10px', '& .MuiAlert-message': { fontSize: FONT.body, lineHeight: 1.5 } }}>
                          {c.direction === 'growth' ? 'Growth' : c.direction === 'decline' ? 'Decline' : 'No change'}: {c.current.label} had {c.current.total} booking{c.current.total === 1 ? '' : 's'} against {c.previous.total} in {c.previous.label}
                          {c.changePct === null ? '' : ` (${c.change > 0 ? '+' : ''}${c.changePct}%)`}.
                        </Alert>
                      );
                    })()}
                  </Box>
                )}

                {/* the chart or the map first, the table under it */}
                {activeReportTab === 'PeakHours' ? (
                  <PeakHoursSection data={reportsData} table={table} failed={Boolean(loadError)} emptyText={loadError ? 'The records could not be loaded. Use Try again at the top of the page.' : NO_RECORDS.PeakHours} />
                ) : (
                  <>
                    {activeReportTab === 'Hotspots' ? (
                      <Box sx={{ mb: '22px' }}>
                        <HotspotsSection data={reportsData} emptyText={NO_RECORDS.Hotspots} />
                      </Box>
                    ) : (
                      <ReportChart kind={activeReportTab} data={reportsData} trendRows={trendRows} />
                    )}
                    <ReportTableView table={table} emptyText={loadError ? 'The records could not be loaded. Use Try again at the top of the page.' : NO_RECORDS[activeReportTab]} />
                  </>
                )}
              </>
            )
          )}
        </Box>
      </Box>
    </Box>
  );
};
