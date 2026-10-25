import React, { useState, useEffect, useMemo } from 'react';
import { Box, Button, TableBody, TableCell, TableRow, Typography } from '@mui/material';
import FileDownloadIcon from '@mui/icons-material/FileDownload';

import { INCIDENT_CATEGORIES, downloadCsv, reportFileName } from '@sakay/shared';
import { IncidentReportRecord } from '../mockData/adminData';
import { FilterToolbar, FilterOption } from '../components/admin/FilterToolbar';
import { StatusBadge } from '../components/common/StatusBadge';
import { IncidentDetailModal } from '../components/admin/IncidentDetailModal';
import { CellStack, DataTableCard, DataTableMessageRow, FlagTag } from '../components/common/DataTable';
import { StatStrip } from '../components/common/StatStrip';
import { fetchIncidents, recordAdminAuditAction } from '../services/adminApiService';
import { FONT } from '../styles/density';
import { PAGE_TEXT, rowActionSx, secondaryButtonSx } from '../styles/pageTheme';

const PRIORITY_RANK: Record<string, number> = { Serious: 0, Emergency: 1, Standard: 2 };

/**
 * ============================================================================
 * INCIDENT REPORTS PAGE COMPONENT (IncidentReportsPage.tsx)
 * ============================================================================
 * Checklist Scope:
 *   ● Manage Incident Reports
 *     ○ View submitted incident reports (the serious ones, Rule 19.8, and the escalated ones come to the LGU; the others are with the driver's TODA, Rule 19.3)
 *     ○ Review incident details, the evidence photos, the trip, the review timeline
 *     ○ Record the outcome: upheld (with the strike), not upheld, fabricated; every action is a database function with its own audit entry
 *     ○ Filter by type, status, priority, who has it, TODA; export (CSV)
 * ============================================================================
 */
export const IncidentReportsPage: React.FC = () => {
  const [incidents, setIncidents] = useState<IncidentReportRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [routingFilter, setRoutingFilter] = useState('All');
  const [todaFilter, setTodaFilter] = useState('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // read from the list, so the detail screen shows what the database says after every action
  const selectedIncident = incidents.find((i) => i.id === selectedId) ?? null;

  const loadIncidents = async () => {
    setIsLoading(true);
    try {
      const data = await fetchIncidents();
      setIncidents(data);
    } catch (err) {
      console.error('[IncidentReportsPage] Failed to fetch incidents:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadIncidents();
  }, []);

  // The most urgent first: serious, then emergency, then the overdue, then the newest
  const sorted = useMemo(
    () =>
      [...incidents].sort((a, b) => {
        const open = (x: IncidentReportRecord) => (x.status === 'Resolved' || x.status === 'Dismissed' ? 1 : 0);
        return (
          open(a) - open(b) ||
          (PRIORITY_RANK[a.priority ?? 'Standard'] ?? 2) - (PRIORITY_RANK[b.priority ?? 'Standard'] ?? 2) ||
          Number(Boolean(b.overdue)) - Number(Boolean(a.overdue)) ||
          Date.parse(b.record?.created_at ?? '') - Date.parse(a.record?.created_at ?? '')
        );
      }),
    [incidents]
  );

  // Filter logic
  const filteredIncidents = sorted.filter((inc) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      inc.id.toLowerCase().includes(q) ||
      inc.bookingId.toLowerCase().includes(q) ||
      inc.driverName.toLowerCase().includes(q) ||
      inc.reporterName.toLowerCase().includes(q) ||
      inc.category.toLowerCase().includes(q);

    const matchesStatus = statusFilter === 'All' || inc.status === statusFilter;
    const matchesCategory = categoryFilter === 'All' || inc.category === categoryFilter;
    const matchesPriority = priorityFilter === 'All' || inc.priority === priorityFilter;
    const matchesRouting = routingFilter === 'All' || (routingFilter === 'Overdue' ? Boolean(inc.overdue) : inc.routing === routingFilter);
    const matchesToda = todaFilter === 'All' || inc.todaName === todaFilter;

    return matchesSearch && matchesStatus && matchesCategory && matchesPriority && matchesRouting && matchesToda;
  });

  const pendingCount = incidents.filter((i) => i.status === 'Pending Review').length;
  const investigationCount = incidents.filter((i) => i.status === 'Under Investigation').length;
  const resolvedCount = incidents.filter((i) => i.status === 'Resolved').length;
  const dismissedCount = incidents.filter((i) => i.status === 'Dismissed').length;
  const overdueCount = incidents.filter((i) => i.overdue).length;

  const statusOptions: FilterOption[] = [
    { label: 'All Statuses', value: 'All' },
    { label: 'Pending Review', value: 'Pending Review' },
    { label: 'Under Investigation', value: 'Under Investigation' },
    { label: 'Resolved', value: 'Resolved' },
    { label: 'Dismissed', value: 'Dismissed' },
  ];

  // Rule 19.1 and the ones of Batches 9 and 11: the one shared list (the database stores exactly these)
  const categoryOptions: FilterOption[] = [
    { label: 'All Categories', value: 'All' },
    ...INCIDENT_CATEGORIES.map((c) => ({ label: c.value, value: c.value })),
  ];
  const priorityOptions: FilterOption[] = [
    { label: 'All Priorities', value: 'All' },
    { label: 'Serious', value: 'Serious' },
    { label: 'Emergency', value: 'Emergency' },
    { label: 'Standard', value: 'Standard' },
  ];
  const routingOptions: FilterOption[] = [
    { label: 'With anyone', value: 'All' },
    { label: 'With the LGU Administrator', value: 'LGU' },
    { label: 'With a TODA Administrator', value: 'TODA' },
    { label: 'Overdue (a clock ran out)', value: 'Overdue' },
  ];
  const todaOptions: FilterOption[] = [
    { label: 'All TODAs', value: 'All' },
    ...Array.from(new Set(incidents.map((i) => i.todaName).filter((n) => n && n !== 'N/A'))).sort().map((n) => ({ label: n, value: n })),
  ];

  const exportCsv = () => {
    const name = 'Incident Reports';
    downloadCsv(
      reportFileName(name),
      ['Incident ID', 'Trip', 'Category', 'Priority', 'With', 'Status', 'Outcome', 'Strike', 'Reported by', 'Reporter', 'Driver', 'TODA', 'Plate', 'Submitted', 'Findings'],
      filteredIncidents.map((i) => [
        i.id, i.tripId, i.category, i.priority ?? '', i.routing ?? '', i.status, i.record?.outcome ?? '', i.record?.strike_code ?? '', i.reportedBy, i.reporterName, i.driverName, i.todaName, i.vehiclePlate,
        `${i.submittedDate} ${i.submittedTime}`, i.findings ?? '',
      ])
    );
    void recordAdminAuditAction({ actionType: 'REPORT_EXPORTED', targetId: 'REPORT', targetName: name, details: `Exported ${name} (CSV): ${filteredIncidents.length} report(s).`, category: 'Operations' });
  };

  // each number is also a button: it shows those reports in the list below (pressing it again shows all)
  const pick = (key: string) => () => setStatusFilter(statusFilter === key ? 'All' : key);
  const filtering = Boolean(searchQuery) || statusFilter !== 'All' || priorityFilter !== 'All' || routingFilter !== 'All' || todaFilter !== 'All' || categoryFilter !== 'All';

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 4.8 }}>
      {/* 1. How many reports are in each state (press one to show them) */}
      <StatStrip
        label="Report totals (press one to show those reports)"
        stats={[
          { key: 'Pending Review', label: 'Pending review', value: pendingCount, tone: pendingCount > 0 ? 'brand' : 'neutral', note: `Not reviewed yet${overdueCount ? ` · ${overdueCount} overdue` : ''}`, onSelect: pick('Pending Review'), selected: statusFilter === 'Pending Review' },
          { key: 'Under Investigation', label: 'Under investigation', value: investigationCount, note: 'Being reviewed by a TODA or by the LGU', onSelect: pick('Under Investigation'), selected: statusFilter === 'Under Investigation' },
          { key: 'Resolved', label: 'Resolved', value: resolvedCount, tone: 'success', note: 'Outcome recorded, sanctions finalized', onSelect: pick('Resolved'), selected: statusFilter === 'Resolved' },
          { key: 'Dismissed', label: 'Dismissed', value: dismissedCount, note: 'Not upheld, or withdrawn by the reporter', onSelect: pick('Dismissed'), selected: statusFilter === 'Dismissed' },
        ]}
      />

      {/* 2. Search and filters */}
      <FilterToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search incident, driver, complainant"
        selectFilters={[
          { id: 'status', label: 'Incident Status', value: statusFilter, options: statusOptions, onChange: setStatusFilter },
          { id: 'category', label: 'Category', value: categoryFilter, options: categoryOptions, onChange: setCategoryFilter },
          { id: 'priority', label: 'Priority', value: priorityFilter, options: priorityOptions, onChange: setPriorityFilter },
          { id: 'routing', label: 'Who has it', value: routingFilter, options: routingOptions, onChange: setRoutingFilter },
          { id: 'toda', label: 'TODA', value: todaFilter, options: todaOptions, onChange: setTodaFilter },
        ]}
        onResetFilters={() => {
          setSearchQuery('');
          setStatusFilter('All');
          setCategoryFilter('All');
          setPriorityFilter('All');
          setRoutingFilter('All');
          setTodaFilter('All');
        }}
        actionButton={
          <Button onClick={exportCsv} disabled={filteredIncidents.length === 0} startIcon={<FileDownloadIcon sx={{ fontSize: 16 }} />} sx={secondaryButtonSx}>
            Export CSV
          </Button>
        }
      />

      {/* 3. The incident reports */}
      <DataTableCard
        label="Incident reports"
        minWidth={900}
        columns={[{ label: 'Incident' }, { label: 'Driver' }, { label: 'Complainant' }, { label: 'Submitted' }, { label: 'Status' }, { label: 'Action', align: 'right' }]}
      >
        <TableBody>
          {isLoading ? (
            <DataTableMessageRow colSpan={6} kind="loading" loadingText="Loading incident reports..." />
          ) : filteredIncidents.length > 0 ? (
            filteredIncidents.map((inc) => (
              <TableRow key={inc.id}>
                <TableCell>
                  <Typography component="div" sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.primary, overflowWrap: 'anywhere' }}>{inc.id}</Typography>
                  <Typography component="div" sx={{ fontSize: FONT.small, color: PAGE_TEXT.brand, fontWeight: 600, mt: '1px' }}>{inc.category}</Typography>
                  {((inc.priority && inc.priority !== 'Standard') || inc.overdue) && (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '4px', mt: '4px' }}>
                      {inc.priority && inc.priority !== 'Standard' && <FlagTag label={inc.priority} tone={inc.priority === 'Serious' ? 'danger' : 'warning'} />}
                      {inc.overdue && <FlagTag label="Overdue" tone="danger" />}
                    </Box>
                  )}
                </TableCell>
                <TableCell>
                  <CellStack primary={inc.driverName} secondary={inc.todaName} />
                </TableCell>
                <TableCell>
                  <CellStack primary={inc.reporterName} secondary={inc.reportedBy} />
                </TableCell>
                <TableCell>
                  <CellStack primary={inc.submittedDate} secondary={inc.submittedTime} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={inc.status as any} />
                  <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '3px' }}>{inc.routing === 'LGU' ? 'With the LGU' : 'With the TODA'}</Typography>
                </TableCell>
                <TableCell align="right">
                  <Button aria-label={`Review incident ${inc.id}`} onClick={() => setSelectedId(inc.id)} sx={rowActionSx('neutral')}>
                    Review
                  </Button>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <DataTableMessageRow
              colSpan={6}
              kind={filtering ? 'noResults' : 'empty'}
              title={filtering ? 'No reports match' : 'No incident reports yet'}
              hint={
                filtering
                  ? 'Nothing matches your search or filter. Try clearing them.'
                  : 'Reports from passengers and drivers (and the ones the system records for a safety stop) appear here for review.'
              }
              onRefresh={loadIncidents}
            />
          )}
        </TableBody>
      </DataTableCard>

      {/* 4. Incident details and review window */}
      {selectedIncident && (
        <IncidentDetailModal
          open={Boolean(selectedIncident)}
          onClose={() => setSelectedId(null)}
          incident={selectedIncident}
          onChanged={loadIncidents}
        />
      )}
    </Box>
  );
};
