import React, { useState, useEffect } from 'react';
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
  Avatar,
  Chip,
  Button,
  Alert,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import RefreshIcon from '@mui/icons-material/Refresh';

import { TodaAuditLog } from '../types/toda';
import { FilterToolbar, FilterOption } from '../components/admin/FilterToolbar';
import { MacCenterModal } from '../components/admin/MacCenterModal';
import { AUDIT_EXPORT_MAX_ROWS } from '@sakay/shared';
import { fetchTodaAuditLogs, exportTodaAuditLog } from '../services/todaApiService';

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

  const getCategoryBadgeStyle = (category: TodaAuditLog['category']) => {
    switch (category) {
      case 'Driver Verification':
        return { bg: 'rgba(21, 101, 192, 0.12)', color: '#1565C0', border: 'rgba(21, 101, 192, 0.3)' };
      case 'Membership':
        return { bg: 'rgba(234, 67, 53, 0.12)', color: '#D93025', border: 'rgba(234, 67, 53, 0.3)' };
      case 'Incident':
        return { bg: 'rgba(255, 102, 0, 0.12)', color: 'var(--sakay-orange)', border: 'rgba(255, 102, 0, 0.3)' };
      case 'Announcement':
        return { bg: 'rgba(46, 125, 50, 0.12)', color: '#2E7D32', border: 'rgba(46, 125, 50, 0.3)' };
      case 'Account':
        return { bg: 'rgba(106, 27, 154, 0.12)', color: '#6A1B9A', border: 'rgba(106, 27, 154, 0.3)' };
      default:
        return { bg: '#F1F3F4', color: '#5F6368', border: '#DADCE0' };
    }
  };

  return (
    <Box sx={{ maxWidth: 1280, margin: '0 auto', pb: '38px' }}>
      {/* 1. Floating Card Filter Toolbar with Date Filtering */}
      <FilterToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search TODA audit action, actor, target entity, or log ID..."
        selectFilters={[
          {
            id: 'date',
            label: 'Filter by Date',
            value: dateFilter,
            options: dateOptions,
            onChange: setDateFilter,
          },
          {
            id: 'category',
            label: 'Category',
            value: categoryFilter,
            options: categoryOptions,
            onChange: setCategoryFilter,
          },
        ]}
        onResetFilters={() => {
          setSearchQuery('');
          setCategoryFilter('All');
          setDateFilter('All');
        }}
      />

      {/* 1B. Export (Rule 28.4: exportable to PDF / Excel for compliance review) */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', mb: '13px' }}>
        <Button variant="outlined" size="small" disabled={exporting !== null} onClick={() => void runExport('xlsx')} sx={{ textTransform: 'none', fontWeight: 600 }}>
          {exporting === 'xlsx' ? 'Exporting...' : 'Export Excel'}
        </Button>
        <Button variant="outlined" size="small" disabled={exporting !== null} onClick={() => void runExport('csv')} sx={{ textTransform: 'none', fontWeight: 600 }}>
          {exporting === 'csv' ? 'Exporting...' : 'Export CSV'}
        </Button>
        <Button variant="outlined" size="small" disabled={exporting !== null} onClick={() => void runExport('pdf')} sx={{ textTransform: 'none', fontWeight: 600 }}>
          {exporting === 'pdf' ? 'Preparing...' : 'Save as PDF'}
        </Button>
      </Box>
      {exportNote && <Alert severity={exportNote.severity} onClose={() => setExportNote(null)} sx={{ mb: '13px' }}>{exportNote.text}</Alert>}

      {/* 2. Audit Trail Log Table */}
      <TableContainer
        component={Paper}
        elevation={0}
        sx={{
          borderRadius: '14px',
          border: '1px solid var(--mac-border-color)',
          boxShadow: 'var(--mac-shadow-card)',
          overflow: 'hidden',
        }}
      >
        <Table>
          <TableHead sx={{ backgroundColor: '#FAFAFC' }}>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, fontSize: '11px', color: 'var(--mac-text-muted)', py: '13px', px: '19px' }}>Timestamp & Log ID</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '11px', color: 'var(--mac-text-muted)', py: '13px', px: '19px' }}>TODA Officer</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '11px', color: 'var(--mac-text-muted)', py: '13px', px: '19px' }}>Category</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '11px', color: 'var(--mac-text-muted)', py: '13px', px: '19px' }}>Target Entity</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '11px', color: 'var(--mac-text-muted)', py: '13px', px: '19px' }}>Details of Modification</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600, fontSize: '11px', color: 'var(--mac-text-muted)', py: '13px', px: '19px' }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredLogs.map((log) => {
              const catBadge = getCategoryBadgeStyle(log.category);
              return (
                <TableRow
                  key={log.id}
                  sx={{
                    transition: 'var(--mac-transition-fast)',
                    '&:hover': { backgroundColor: 'var(--mac-canvas-bg)' },
                  }}
                >
                  <TableCell sx={{ py: '14px', px: '19px' }}>
                    <Typography sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-primary)' }}>
                      {log.performed_at}
                    </Typography>
                    <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)', fontFamily: 'monospace' }}>
                      {log.log_id}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ py: '14px', px: '19px' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Avatar sx={{ width: 29, height: 29, backgroundColor: 'var(--sakay-orange-soft)', color: 'var(--sakay-orange)', fontSize: '11.5px', fontWeight: 700 }}>
                        {log.actor_name.charAt(0)}
                      </Avatar>
                      <Box>
                        <Typography sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-primary)' }}>
                          {log.actor_name}
                        </Typography>
                        <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>
                          TODA Administration
                        </Typography>
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell sx={{ py: '14px', px: '19px' }}>
                    <Chip
                      label={log.category}
                      size="small"
                      sx={{
                        fontSize: '11px',
                        fontWeight: 600,
                        backgroundColor: catBadge.bg,
                        color: catBadge.color,
                        border: `1px solid ${catBadge.border}`,
                        height: 21,
                      }}
                    />
                  </TableCell>
                  <TableCell sx={{ py: '14px', px: '19px' }}>
                    <Typography sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-primary)' }}>
                      {log.target_name}
                    </Typography>
                    <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)', fontFamily: 'monospace' }}>
                      {log.target_id}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ py: '14px', px: '19px', maxWidth: 304 }}>
                    <Typography sx={{ fontSize: '11.5px', color: 'var(--mac-text-secondary)', lineHeight: 1.4 }}>
                      {log.details}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ py: '14px', px: '19px' }}>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<VisibilityIcon fontSize="small" />}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedLog(log);
                      }}
                      sx={{
                        height: 27,
                        px: '13px',
                        borderRadius: '6.5px',
                        fontSize: '11px',
                        fontWeight: 600,
                        textTransform: 'none',
                        color: 'var(--sakay-orange)',
                        borderColor: 'var(--sakay-orange-border)',
                        backgroundColor: 'var(--sakay-orange-soft)',
                      }}
                    >
                      Inspect
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {/* 3. Event Inspection Modal */}
      {selectedLog && (
        <MacCenterModal
          open={Boolean(selectedLog)}
          onClose={() => setSelectedLog(null)}
          title={`TODA Audit Trail Event — ${selectedLog.log_id}`}
          subtitle={`Action Type: ${selectedLog.action_type}`}
          badge={<Chip label={selectedLog.category} size="small" sx={{ ...getCategoryBadgeStyle(selectedLog.category), fontWeight: 700 }} />}
          maxWidth={528}
        >
          <Box sx={{ mb: '19px' }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '13px', backgroundColor: '#F8F9FA', p: '16px', borderRadius: '10px', mb: '19px' }}>
              <Box>
                <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>Timestamp</Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{selectedLog.performed_at}</Typography>
              </Box>
              <Box>
                <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>Acting Officer</Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{selectedLog.actor_name}</Typography>
              </Box>
              <Box>
                <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>Target Entity ID</Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 600, color: 'var(--sakay-orange)', fontFamily: 'monospace' }}>{selectedLog.target_id}</Typography>
              </Box>
              <Box>
                <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>Target Entity Name</Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{selectedLog.target_name}</Typography>
              </Box>
            </Box>

            <Typography sx={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--mac-text-muted)', textTransform: 'uppercase', mb: '6px' }}>
              Full Log Payload Details
            </Typography>
            <Box sx={{ p: '13px', borderRadius: '8px', backgroundColor: '#FAFAFC', border: '1px solid var(--mac-border-color)' }}>
              <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-primary)', lineHeight: 1.6 }}>
                {selectedLog.details}
              </Typography>
            </Box>
          </Box>
        </MacCenterModal>
      )}
    </Box>
  );
};
