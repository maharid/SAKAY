import React, { useState, useEffect } from 'react';
import { Alert, Box, Button, TableBody, TableCell, TableRow, TextField, Typography } from '@mui/material';

import { AuditLogRecord } from '../mockData/adminData';
import { FilterToolbar, FilterOption } from '../components/admin/FilterToolbar';
import { MacCenterModal } from '../components/admin/MacCenterModal';
import { CellStack, DataTableCard, DataTableMessageRow, FlagTag } from '../components/common/DataTable';
import { DetailField, DetailGrid, DetailSection } from '../components/common/DetailSection';
import { PageNotice } from '../components/common/PageNotice';
import { StatStrip } from '../components/common/StatStrip';
import { AUDIT_EXPORT_MAX_ROWS } from '@sakay/shared';
import { fetchAuditLogs, exportAuditLog } from '../services/adminApiService';
import { FONT, SPACE } from '../styles/density';
import { PAGE_BORDER, PAGE_TEXT, pageCardSx, rowActionSx, secondaryButtonSx } from '../styles/pageTheme';

/**
 * ============================================================================
 * AUDIT LOGGING PAGE (AuditLogPage.tsx)
 * ============================================================================
 * Checklist Scope:
 *   ● View Audit Logs
 *     ○ Real-time administrative activity ledger
 *     ○ Cryptographic timestamp & target entity tracking
 * ============================================================================
 */

// The category tag of a row: the colour only repeats what the words say
const categoryTone = (category: string): 'info' | 'danger' | 'success' | 'brand' => {
  switch (category) {
    case 'Verification':
      return 'info';
    case 'User Oversight':
      return 'danger';
    case 'Fare Matrix':
      return 'success';
    default:
      return 'brand';
  }
};

// "ANNOUNCEMENT_BROADCASTED" -> "Announcement broadcasted": the database's action name in words (the exact name stays in the event's details)
const readableAction = (actionType: string): string => {
  const words = actionType.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : actionType;
};

const FIELD_SX = { flex: '1 1 160px', minWidth: 150, maxWidth: 220 } as const;

export const AuditLogPage: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [selectedLog, setSelectedLog] = useState<AuditLogRecord | null>(null);
  // Rule 28.4: the day range (Asia/Manila) is asked of the database; the export takes the same range and search text
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);

  const loadLogs = async () => {
    setIsLoading(true);
    try {
      const data = await fetchAuditLogs({ fromDay, toDay });
      setLogs(data);
      setLoadError(null);
    } catch (err) {
      console.error('[AuditLogPage] Failed to fetch audit logs:', err);
      // the rows on screen belong to an earlier dates choice: do not leave them looking like the answer to this one
      setLogs([]);
      setLoadError(err instanceof Error && err.message ? err.message : 'The activity log could not be read.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDay, toDay]);

  const runExport = async (format: 'xlsx' | 'csv' | 'pdf') => {
    setExporting(format);
    setExportNote(null);
    try {
      const result = await exportAuditLog(format, { fromDay, toDay, search: searchQuery }, 'LGU Administrator');
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

  const filteredLogs = logs.filter((log) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      (log.action_type && log.action_type.toLowerCase().includes(q)) ||
      (log.actor_name && log.actor_name.toLowerCase().includes(q)) ||
      (log.target_name && log.target_name.toLowerCase().includes(q)) ||
      (log.details && log.details.toLowerCase().includes(q)) ||
      (log.log_id && log.log_id.toLowerCase().includes(q));

    const matchesCategory = categoryFilter === 'All' || log.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const totalLogs = logs.length;
  const verificationLogs = logs.filter((l) => l.category === 'Verification').length;
  const userOversightLogs = logs.filter((l) => l.category === 'User Oversight').length;
  const systemRateLogs = logs.filter(
    (l) => l.category === 'Fare Matrix' || l.category === 'Announcement' || l.category === 'System'
  ).length;

  const categoryOptions: FilterOption[] = [
    { label: 'All Action Categories', value: 'All' },
    { label: 'Verification & Accreditation', value: 'Verification' },
    { label: 'User Oversight & Policy', value: 'User Oversight' },
    { label: 'Fare Matrix Adjustments', value: 'Fare Matrix' },
    { label: 'System & Announcement', value: 'System' },
  ];

  const filtering = Boolean(searchQuery) || categoryFilter !== 'All';
  const exportDisabled = exporting !== null;

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 4.8 }}>
      {/* 1. How many events there are */}
      <StatStrip
        label="Audit log totals"
        stats={[
          { key: 'total', label: 'All events', value: totalLogs },
          { key: 'verification', label: 'Accreditation and verification', value: verificationLogs },
          { key: 'oversight', label: 'Strikes and suspensions', value: userOversightLogs },
          { key: 'system', label: 'Fare and system actions', value: systemRateLogs },
        ]}
      />

      {/* 2. Search and category */}
      <FilterToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search details, actor, target, or log ID"
        selectFilters={[
          {
            id: 'category',
            label: 'Action category',
            value: categoryFilter,
            options: categoryOptions,
            onChange: setCategoryFilter,
            width: 220,
          },
        ]}
        onResetFilters={() => {
          setSearchQuery('');
          setCategoryFilter('All');
        }}
      />

      {/* 2B. Date range and export (Rule 28.4: exportable to PDF / Excel for compliance review) */}
      <Box component="section" aria-label="Dates and export" sx={{ ...pageCardSx, p: '12px 16px', mb: SPACE.gapLarge }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 12px' }}>
          <TextField size="small" type="date" label="From (Manila)" value={fromDay} onChange={(e) => setFromDay(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} sx={FIELD_SX} />
          <TextField size="small" type="date" label="To (Manila)" value={toDay} onChange={(e) => setToDay(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} sx={FIELD_SX} />
          <Box role="group" aria-label="Export the log" sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', ml: { sm: 'auto' } }}>
            <Button disabled={exportDisabled} onClick={() => void runExport('xlsx')} sx={secondaryButtonSx}>
              {exporting === 'xlsx' ? 'Exporting...' : 'Export Excel'}
            </Button>
            <Button disabled={exportDisabled} onClick={() => void runExport('csv')} sx={secondaryButtonSx}>
              {exporting === 'csv' ? 'Exporting...' : 'Export CSV'}
            </Button>
            <Button disabled={exportDisabled} onClick={() => void runExport('pdf')} sx={secondaryButtonSx}>
              {exporting === 'pdf' ? 'Preparing...' : 'Save as PDF'}
            </Button>
          </Box>
        </Box>
        <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '8px' }}>
          The export follows the dates and the search text above. Every export is recorded in this log.
        </Typography>
      </Box>
      {exportNote && (
        <Alert severity={exportNote.severity} onClose={() => setExportNote(null)} sx={{ mb: SPACE.gapLarge, borderRadius: '10px' }}>
          {exportNote.text}
        </Alert>
      )}
      {loadError && (
        <PageNotice
          tone="danger"
          title="The activity log could not be loaded"
          action={
            <Button onClick={loadLogs} disabled={isLoading} sx={rowActionSx('neutral')}>
              Try again
            </Button>
          }
        >
          {loadError}
        </PageNotice>
      )}

      {/* 3. The events */}
      <DataTableCard
        label="Audit log events"
        minWidth={900}
        columns={[{ label: 'When' }, { label: 'Who' }, { label: 'Action' }, { label: 'Category' }, { label: 'Details' }, { label: 'Event', align: 'right' }]}
      >
        <TableBody>
          {isLoading ? (
            <DataTableMessageRow colSpan={6} kind="loading" loadingText="Loading activity logs..." />
          ) : filteredLogs.length > 0 ? (
            filteredLogs.map((log) => (
              <TableRow key={log.id}>
                <TableCell>
                  <CellStack primary={log.timestamp} secondary={`${log.id.slice(0, 16)}...`} quiet />
                </TableCell>
                <TableCell>
                  <CellStack primary={log.actor_name} secondary={log.actor_role} />
                </TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{readableAction(log.action_type)}</TableCell>
                <TableCell>
                  <FlagTag label={log.category} tone={categoryTone(log.category)} />
                </TableCell>
                <TableCell sx={{ maxWidth: 380 }}>
                  <Typography
                    title={log.details}
                    sx={{
                      fontSize: FONT.body,
                      color: PAGE_TEXT.secondary,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {log.details}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <Button aria-label={`View the event: ${readableAction(log.action_type)}${log.timestamp ? `, ${log.timestamp}` : ''}`} onClick={() => setSelectedLog(log)} sx={rowActionSx('neutral')}>
                    View event
                  </Button>
                </TableCell>
              </TableRow>
            ))
          ) : loadError ? (
            <DataTableMessageRow colSpan={6} kind="empty" title="The activity log could not be loaded" hint="Check the connection, then try again." onRefresh={loadLogs} isRefreshing={isLoading} />
          ) : (
            <DataTableMessageRow
              colSpan={6}
              kind={filtering ? 'noResults' : 'empty'}
              title={filtering ? 'No events match' : 'No activity log records found'}
              hint={filtering ? 'No events match your search or filter. Try clearing them.' : 'Administrative actions, approvals, and system events will be recorded and appear here.'}
              onRefresh={loadLogs}
              isRefreshing={isLoading}
            />
          )}
        </TableBody>
      </DataTableCard>

      {/* 4. One event in detail */}
      {selectedLog && (
        <MacCenterModal
          open={Boolean(selectedLog)}
          onClose={() => setSelectedLog(null)}
          title="Audit event"
          subtitle={`Log ID: ${selectedLog.id}`}
          badge={<FlagTag label={selectedLog.category} tone={categoryTone(selectedLog.category)} />}
          maxWidth={560}
        >
          <DetailSection title="What happened">
            <DetailGrid>
              <DetailField label="Action">{readableAction(selectedLog.action_type)}</DetailField>
              <DetailField label="Action code">
                <Box component="span" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{selectedLog.action_type}</Box>
              </DetailField>
              <DetailField label="Acting officer">{`${selectedLog.actor_name} (${selectedLog.actor_role})`}</DetailField>
              <DetailField label="When">{selectedLog.timestamp}</DetailField>
            </DetailGrid>
          </DetailSection>

          <DetailSection title="Details and remarks">
            <Box sx={{ backgroundColor: '#FAFAF8', padding: '12px 14px', borderRadius: '12px', border: `1px solid ${PAGE_BORDER}` }}>
              <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.primary, lineHeight: 1.55, overflowWrap: 'anywhere' }}>{selectedLog.details}</Typography>
            </Box>
          </DetailSection>

          {(selectedLog.before_state != null || selectedLog.after_state != null) && (
            <DetailSection title="Before and after">
              <Box sx={{ backgroundColor: '#FAFAF8', padding: '12px 14px', borderRadius: '12px', border: `1px solid ${PAGE_BORDER}`, overflowX: 'auto' }}>
                <Typography component="pre" sx={{ fontSize: FONT.small, color: PAGE_TEXT.primary, m: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'monospace' }}>
                  {JSON.stringify({ before: selectedLog.before_state ?? null, after: selectedLog.after_state ?? null }, null, 2)}
                </Typography>
              </Box>
            </DetailSection>
          )}
        </MacCenterModal>
      )}
    </Box>
  );
};
