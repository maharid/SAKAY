import React, { useState, useEffect } from 'react';
import { Box, Typography, TableBody, TableCell, TableRow, Avatar, Button, Alert } from '@mui/material';

import { TodaAuditLog } from '../types/toda';
import { FilterToolbar, FilterOption } from '../components/admin/FilterToolbar';
import { MacCenterModal } from '../components/admin/MacCenterModal';
import { DataTableCard, DataTableMessageRow, StatusPill } from '../components/common/DataTable';
import { rowActionSx, secondaryButtonSx } from '../components/common/pageButtons';
import { OPS_TEXT } from '../components/operations/operationsTheme';
import { FONT, SHELL, SPACE } from '../styles/density';
import { AUDIT_EXPORT_MAX_ROWS } from '@sakay/shared';
import { fetchTodaAuditLogs, exportTodaAuditLog } from '../services/todaApiService';

// The time zone is said once in the column heading, so each row only needs the date and the time
const MANILA_SUFFIX = ' (Asia/Manila)';
const withoutZone = (stamp: string): string => (stamp.endsWith(MANILA_SUFFIX) ? stamp.slice(0, -MANILA_SUFFIX.length) : stamp);
// A long identifier is shortened in the table (the whole value is in its tooltip and in the details window)
const shortId = (id: string): string => (id.length > 14 ? `${id.slice(0, 8)}…` : id);

export const TodaAuditLogsPage: React.FC = () => {
  const [logs, setLogs] = useState<TodaAuditLog[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [dateFilter, setDateFilter] = useState('All');
  const [selectedLog, setSelectedLog] = useState<TodaAuditLog | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);

  // Days are Asia/Manila days (the database stores UTC)
  const manilaDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const dayRange = (): { fromDay?: string; toDay?: string } => {
    const now = Date.now();
    if (dateFilter === 'Today') return { fromDay: manilaDay(new Date(now)), toDay: manilaDay(new Date(now)) };
    if (dateFilter === 'Yesterday') return { fromDay: manilaDay(new Date(now - 86400000)), toDay: manilaDay(new Date(now - 86400000)) };
    if (dateFilter === 'Last 7 Days') return { fromDay: manilaDay(new Date(now - 7 * 86400000)), toDay: manilaDay(new Date(now)) };
    if (dateFilter === 'Last 30 Days') return { fromDay: manilaDay(new Date(now - 30 * 86400000)), toDay: manilaDay(new Date(now)) };
    return {};
  };

  const runExport = async (format: 'xlsx' | 'csv' | 'pdf') => {
    setExporting(format);
    setExportNote(null);
    try {
      const result = await exportTodaAuditLog(format, { ...dayRange(), search: searchQuery }, 'TODA Administrator');
      setExportNote({
        severity: 'success',
        text: `${result.count} entries exported${result.truncated ? ` (the first ${AUDIT_EXPORT_MAX_ROWS}; narrow the dates to export the rest)` : ''}. The export was recorded in the audit log.`,
      });
    } catch (err) {
      setExportNote({ severity: 'error', text: (err as Error).message });
    } finally {
      setExporting(null);
    }
  };

  const loadLogs = () => {
    setIsLoading(true);
    fetchTodaAuditLogs()
      .then((data) => setLogs(data || []))
      .catch((err) => {
        console.error('[TodaAuditLogs] Error fetching logs from database:', err);
        setLogs([]);
      })
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    loadLogs();
  }, []);

  // Filter Logic with Date Filter
  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      log.action_type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.actor_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.target_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.details.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.log_id.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory = categoryFilter === 'All' || log.category === categoryFilter;

    let matchesDate = true;
    if (dateFilter !== 'All' && log.performed_at_iso) {
      const when = new Date(log.performed_at_iso);
      const ageDays = (Date.now() - when.getTime()) / 86400000;
      if (dateFilter === 'Today') matchesDate = manilaDay(when) === manilaDay(new Date());
      else if (dateFilter === 'Yesterday') matchesDate = manilaDay(when) === manilaDay(new Date(Date.now() - 86400000));
      else if (dateFilter === 'Last 7 Days') matchesDate = ageDays <= 7;
      else if (dateFilter === 'Last 30 Days') matchesDate = ageDays <= 30;
    }

    return matchesSearch && matchesCategory && matchesDate;
  });

  const categoryOptions: FilterOption[] = [
    { label: 'All Categories', value: 'All' },
    { label: 'Driver Verification', value: 'Driver Verification' },
    { label: 'Membership Governance', value: 'Membership' },
    { label: 'Incident Triage', value: 'Incident' },
    { label: 'Announcements', value: 'Announcement' },
    { label: 'Account & Terminal', value: 'Account' },
    { label: 'Operations', value: 'Operations' },
  ];

  const dateOptions: FilterOption[] = [
    { label: 'All Dates (Full Log)', value: 'All' },
    { label: 'Today', value: 'Today' },
    { label: 'Yesterday', value: 'Yesterday' },
    { label: 'Last 7 Days', value: 'Last 7 Days' },
    { label: 'Last 30 Days', value: 'Last 30 Days' },
  ];

  // Why the list is empty, in words: nothing was recorded, or nothing matches the search and filters
  const hasActiveFilter = searchQuery.trim() !== '' || categoryFilter !== 'All' || dateFilter !== 'All';

  const exportButtons = (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
      <Button variant="outlined" disabled={exporting !== null} onClick={() => void runExport('xlsx')} sx={secondaryButtonSx}>
        {exporting === 'xlsx' ? 'Exporting...' : 'Export Excel'}
      </Button>
      <Button variant="outlined" disabled={exporting !== null} onClick={() => void runExport('csv')} sx={secondaryButtonSx}>
        {exporting === 'csv' ? 'Exporting...' : 'Export CSV'}
      </Button>
      <Button variant="outlined" disabled={exporting !== null} onClick={() => void runExport('pdf')} sx={secondaryButtonSx}>
        {exporting === 'pdf' ? 'Preparing...' : 'Save as PDF'}
      </Button>
    </Box>
  );

  return (
    <Box sx={{ maxWidth: SHELL.contentMaxWidth, margin: '0 auto', pb: '38px' }}>
      {/* 1. Search, filters and the export buttons (the export covers what the date filter and the search show) */}
      <FilterToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search action, officer, record or log ID"
        selectFilters={[
          {
            id: 'date',
            label: 'Filter by Date',
            value: dateFilter,
            options: dateOptions,
            onChange: setDateFilter,
            width: 188,
          },
          {
            id: 'category',
            label: 'Category',
            value: categoryFilter,
            options: categoryOptions,
            onChange: setCategoryFilter,
            width: 188,
          },
        ]}
        onResetFilters={() => {
          setSearchQuery('');
          setCategoryFilter('All');
          setDateFilter('All');
        }}
        actionButton={exportButtons}
      />

      {exportNote && (
        <Alert severity={exportNote.severity} onClose={() => setExportNote(null)} sx={{ mb: SPACE.gapLarge, borderRadius: '8px', fontSize: FONT.body }}>
          {exportNote.text}
        </Alert>
      )}

      {/* 2. The record, newest first */}
      <DataTableCard
        label="Audit log"
        minWidth={960}
        columns={[
          { label: 'Date and time (Philippine time)' },
          { label: 'Officer' },
          { label: 'Category' },
          { label: 'Record affected' },
          { label: 'Details' },
          { label: 'Action', align: 'right' },
        ]}
      >
        <TableBody>
          {isLoading ? (
            <DataTableMessageRow colSpan={6} kind="loading" loadingText="Loading the audit log..." />
          ) : filteredLogs.length > 0 ? (
            filteredLogs.map((log) => (
              <TableRow key={log.id}>
                <TableCell>
                  <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: OPS_TEXT.primary }}>{withoutZone(log.performed_at)}</Typography>
                  <Typography title={log.log_id} sx={{ fontSize: FONT.caption, color: OPS_TEXT.secondary, fontFamily: 'monospace' }}>
                    Log {shortId(log.log_id)}
                  </Typography>
                </TableCell>

                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <Avatar aria-hidden sx={{ width: 28, height: 28, flexShrink: 0, backgroundColor: 'var(--sakay-orange-soft)', color: OPS_TEXT.brand, fontSize: FONT.body, fontWeight: 700 }}>
                      {log.actor_name.charAt(0)}
                    </Avatar>
                    <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: OPS_TEXT.primary, overflowWrap: 'anywhere' }}>{log.actor_name}</Typography>
                  </Box>
                </TableCell>

                <TableCell>
                  <StatusPill label={log.category} tone="neutral" />
                </TableCell>

                <TableCell>
                  <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: OPS_TEXT.primary, overflowWrap: 'anywhere' }}>{log.target_name}</Typography>
                  <Typography title={log.target_id} sx={{ fontSize: FONT.caption, color: OPS_TEXT.secondary, fontFamily: 'monospace' }}>
                    {shortId(log.target_id)}
                  </Typography>
                </TableCell>

                <TableCell sx={{ maxWidth: 340 }}>
                  <Typography sx={{ fontSize: FONT.body, color: OPS_TEXT.primary, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{log.details}</Typography>
                </TableCell>

                <TableCell align="right">
                  <Button variant="outlined" onClick={() => setSelectedLog(log)} sx={rowActionSx('neutral')}>
                    View details
                  </Button>
                </TableCell>
              </TableRow>
            ))
          ) : logs.length === 0 ? (
            <DataTableMessageRow colSpan={6} kind="empty" title="Nothing has been recorded yet" hint="What you and your officers do in this portal will be listed here." />
          ) : (
            <DataTableMessageRow
              colSpan={6}
              kind="noResults"
              title="No entries match"
              hint={hasActiveFilter ? 'Try other words or another date or category, or press Reset to see the whole log.' : 'Press Reset to see the whole log.'}
            />
          )}
        </TableBody>
      </DataTableCard>

      {/* 3. One entry in full */}
      {selectedLog && (
        <MacCenterModal
          open={Boolean(selectedLog)}
          onClose={() => setSelectedLog(null)}
          title="Audit entry"
          subtitle={`Action: ${selectedLog.action_type}`}
          badge={<StatusPill label={selectedLog.category} tone="neutral" />}
          maxWidth={528}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: SPACE.gap }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '13px 16px', backgroundColor: '#FAFAF8', border: '1px solid rgba(15, 23, 42, 0.12)', p: '16px', borderRadius: '10px' }}>
              {[
                { label: 'Date and time (Philippine time)', value: withoutZone(selectedLog.performed_at), mono: false },
                { label: 'Officer', value: selectedLog.actor_name, mono: false },
                { label: 'Record affected', value: selectedLog.target_name, mono: false },
                { label: 'Record ID', value: selectedLog.target_id, mono: true },
                { label: 'Log ID', value: selectedLog.log_id, mono: true },
              ].map((field) => (
                <Box key={field.label} sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary }}>{field.label}</Typography>
                  <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: OPS_TEXT.primary, overflowWrap: 'anywhere', fontFamily: field.mono ? 'monospace' : undefined }}>{field.value}</Typography>
                </Box>
              ))}
            </Box>

            <Box>
              <Typography sx={{ fontSize: FONT.small, fontWeight: 600, color: OPS_TEXT.secondary, mb: '6px' }}>Details</Typography>
              <Typography sx={{ fontSize: FONT.body, color: OPS_TEXT.primary, lineHeight: 1.6, overflowWrap: 'anywhere', border: '1px solid rgba(15, 23, 42, 0.12)', borderRadius: '8px', p: '13px 16px' }}>
                {selectedLog.details}
              </Typography>
            </Box>
          </Box>
        </MacCenterModal>
      )}
    </Box>
  );
};
