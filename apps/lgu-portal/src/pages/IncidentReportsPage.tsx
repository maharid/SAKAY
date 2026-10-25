import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Card,
  CardContent,
  CircularProgress,
  Button,
} from '@mui/material';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import FileDownloadIcon from '@mui/icons-material/FileDownload';

import { INCIDENT_CATEGORIES, downloadCsv, reportFileName } from '@sakay/shared';
import { IncidentReportRecord } from '../mockData/adminData';
import { FilterToolbar, FilterOption } from '../components/admin/FilterToolbar';
import { StatusBadge } from '../components/common/StatusBadge';
import { ActionButton } from '../components/admin/ActionButton';
import { IncidentDetailModal } from '../components/admin/IncidentDetailModal';
import { TableEmptyState } from '../components/common/TableEmptyState';
import { fetchIncidents, recordAdminAuditAction } from '../services/adminApiService';
import { CONTROL, FONT } from '../styles/density';

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
    { label: 'All Incident Statuses', value: 'All' },
    { label: 'Pending Review', value: 'Pending Review' },
    { label: 'Under Investigation', value: 'Under Investigation' },
    { label: 'Resolved', value: 'Resolved' },
    { label: 'Dismissed', value: 'Dismissed' },
  ];

  // Rule 19.1 and the ones of Batches 9 and 11: the one shared list (the database stores exactly these)
  const categoryOptions: FilterOption[] = [
    { label: 'All Incident Categories', value: 'All' },
    ...INCIDENT_CATEGORIES.map((c) => ({ label: c.value, value: c.value })),
  ];
  const priorityOptions: FilterOption[] = [
    { label: 'All Priorities', value: 'All' },
    { label: 'Serious', value: 'Serious' },
    { label: 'Emergency', value: 'Emergency' },
    { label: 'Standard', value: 'Standard' },
  ];
  const routingOptions: FilterOption[] = [
    { label: 'Everything', value: 'All' },
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

  const cards = [
    { key: 'Pending Review', label: 'Pending Review', count: pendingCount, note: `Not reviewed yet${overdueCount ? ` · ${overdueCount} overdue` : ''}`, color: 'var(--sakay-orange)', Icon: ReportProblemIcon },
    { key: 'Under Investigation', label: 'Under Investigation', count: investigationCount, note: 'Being reviewed by a TODA or by the LGU', color: '#1565C0', Icon: HourglassEmptyIcon },
    { key: 'Resolved', label: 'Resolved Reports', count: resolvedCount, note: 'Outcome recorded, sanctions finalized', color: '#2E7D32', Icon: CheckCircleIcon },
    { key: 'Dismissed', label: 'Dismissed', count: dismissedCount, note: 'Not upheld, or withdrawn by the reporter', color: '#757575', Icon: CancelIcon },
  ];

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 4.8 }}>
      {/* 1. Summary Cards */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
          gap: 2,
          mb: 3.2,
        }}
      >
        {cards.map(({ key, label, count, note, color, Icon }) => (
          <Card
            key={key}
            onClick={() => setStatusFilter(statusFilter === key ? 'All' : key)}
            sx={{
              cursor: 'pointer',
              borderRadius: 'var(--mac-radius-lg)',
              border: statusFilter === key ? '2px solid var(--sakay-orange)' : '1px solid var(--mac-border-color)',
              boxShadow: 'var(--mac-shadow-card)',
              backgroundColor: '#FFFFFF',
            }}
          >
            <CardContent sx={{ p: '16px 18px !important' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.2 }}>
                <Typography sx={{ fontSize: FONT.caption, fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase' }}>{label}</Typography>
                <Icon sx={{ color, fontSize: '16px' }} />
              </Box>
              <Typography sx={{ fontSize: '22px', fontWeight: 700, color: key === 'Pending Review' ? 'var(--mac-text-primary)' : color, mb: 0.4 }}>{count}</Typography>
              <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)' }}>{note}</Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      {/* 2. Filter Toolbar */}
      <FilterToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search incident ID, driver name, complainant, or category..."
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
          <Button
            onClick={exportCsv}
            disabled={filteredIncidents.length === 0}
            startIcon={<FileDownloadIcon />}
            sx={{ textTransform: 'none', fontWeight: 600, fontSize: FONT.body, height: CONTROL.height, '@media (pointer: coarse)': { height: CONTROL.touchHeight }, borderRadius: '10px', border: '1px solid var(--mac-border-color)', color: 'var(--mac-text-secondary)', px: 1.6 }}
          >
            Export (CSV)
          </Button>
        }
      />

      {/* 3. Incidents Table */}
      <TableContainer
        component={Paper}
        elevation={0}
        sx={{
          borderRadius: 'var(--mac-radius-lg)',
          border: '1px solid var(--mac-border-color)',
          boxShadow: 'var(--mac-shadow-card)',
          overflow: 'hidden',
          backgroundColor: '#FFFFFF',
        }}
      >
        <Table>
          <TableHead sx={{ backgroundColor: '#FAFAFC' }}>
            <TableRow>
              {['Incident ID & Category', 'Reported Entity / Driver', 'Complainant', 'Submitted Date', 'Status'].map((h) => (
                <TableCell key={h} sx={{ fontWeight: 600, fontSize: FONT.small, color: 'var(--mac-text-muted)', py: 1.6, px: 2.4 }}>{h}</TableCell>
              ))}
              <TableCell align="right" sx={{ fontWeight: 600, fontSize: FONT.small, color: 'var(--mac-text-muted)', py: 1.6, px: 2.4 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 6.4 }}>
                  <CircularProgress size={32} sx={{ color: 'var(--sakay-orange)', mb: 1.2 }} />
                  <Typography sx={{ fontSize: FONT.small, color: 'var(--mac-text-muted)' }}>Loading incident reports...</Typography>
                </TableCell>
              </TableRow>
            ) : filteredIncidents.length > 0 ? (
              filteredIncidents.map((inc) => (
                <TableRow
                  key={inc.id}
                  sx={{
                    transition: 'var(--mac-transition-fast)',
                    '&:hover': { backgroundColor: 'var(--mac-canvas-bg)' },
                  }}
                >
                  <TableCell sx={{ py: 2.2, px: 2.4 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: FONT.body, color: 'var(--mac-text-primary)' }}>{inc.id}</Typography>
                    <Typography sx={{ fontSize: FONT.caption, color: 'var(--sakay-orange)', fontWeight: 600, mt: '2px' }}>{inc.category}</Typography>
                    {inc.priority && inc.priority !== 'Standard' && (
                      <Typography sx={{ fontSize: FONT.caption, fontWeight: 700, mt: '2px', color: inc.priority === 'Serious' ? '#991B1B' : '#9A3412' }}>
                        {inc.priority === 'Serious' ? 'SERIOUS' : 'EMERGENCY'}
                      </Typography>
                    )}
                    {inc.overdue && <Typography sx={{ fontSize: FONT.caption, fontWeight: 700, mt: '2px', color: '#B91C1C' }}>OVERDUE</Typography>}
                  </TableCell>
                  <TableCell sx={{ py: 2.2, px: 2.4 }}>
                    <Typography sx={{ fontSize: FONT.small, fontWeight: 600, color: 'var(--mac-text-primary)' }}>{inc.driverName}</Typography>
                    <Typography sx={{ fontSize: FONT.body, color: 'var(--mac-text-muted)' }}>{inc.todaName}</Typography>
                  </TableCell>
                  <TableCell sx={{ py: 2.2, px: 2.4 }}>
                    <Typography sx={{ fontSize: FONT.small, color: 'var(--mac-text-primary)' }}>
                      {inc.reporterName} ({inc.reportedBy})
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ py: 2.2, px: 2.4 }}>
                    <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-primary)' }}>{inc.submittedDate}</Typography>
                    <Typography sx={{ fontSize: FONT.body, color: 'var(--mac-text-muted)' }}>{inc.submittedTime}</Typography>
                  </TableCell>
                  <TableCell sx={{ py: 2.2, px: 2.4 }}>
                    <StatusBadge status={inc.status as any} />
                    <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)', mt: '2px' }}>{inc.routing === 'LGU' ? 'With the LGU' : 'With the TODA'}</Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ py: 2.2, px: 2.4 }}>
                    <ActionButton
                      label="Investigate"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedId(inc.id);
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmptyState
                colSpan={6}
                icon={<ReportProblemIcon />}
                title="No incident reports found"
                description={
                  searchQuery || statusFilter !== 'All' || priorityFilter !== 'All' || routingFilter !== 'All' || todaFilter !== 'All' || categoryFilter !== 'All'
                    ? 'No reports match your active search or filter criteria.'
                    : 'Incident reports submitted by passengers or drivers (or recorded by the system for a safety stop) will appear here for review.'
                }
                onRefresh={loadIncidents}
                isRefreshing={isLoading}
              />
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* 4. Centered Widescreen Incident Detail & Review Modal */}
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
