import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, TableBody, TableCell, TableRow, Typography } from '@mui/material';
import { APPEAL_CAUSE_LABELS, isPendingAppeal } from '@sakay/shared';
import type { AppealRecord } from '@sakay/shared';

import { FilterToolbar, FilterOption } from '../components/admin/FilterToolbar';
import { StatusBadge } from '../components/common/StatusBadge';
import { AppealDetailModal } from '../components/admin/AppealDetailModal';
import { CellStack, DataTableCard, DataTableMessageRow, FlagTag } from '../components/common/DataTable';
import { StatStrip } from '../components/common/StatStrip';
import { fetchAppeals } from '../services/adminApiService';
import { FONT } from '../styles/density';
import { PAGE_TEXT, rowActionSx } from '../styles/pageTheme';

const stamp = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-';

/**
 * ============================================================================
 * STRIKE APPEALS PAGE (AppealsPage.tsx)
 * ============================================================================
 * Rules 22.3 and 25:
 *   ● A passenger's appeal of a strike comes to the LGU Administrator directly (25.5); a driver's goes to the TODA first and comes here when the TODA
 *     escalates it, when it involves a suspension or deactivation, or when the TODA is a party (25.4)
 *   ● Each is decided within three business days: Full waiver, Partial waiver or Denied, always with a reason (25.6, 25.8)
 *   ● A strike that should never have been issued can be voided from the appeal
 *   ● Every decision is a database function with its own audit entry
 * ============================================================================
 */
export const AppealsPage: React.FC = () => {
  const [appeals, setAppeals] = useState<AppealRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('Waiting for the LGU');
  const [typeFilter, setTypeFilter] = useState('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // read from the list, so the dialog shows what the database says after every action
  const selected = appeals.find((a) => a.requestId === selectedId) ?? null;

  const load = async () => {
    setIsLoading(true);
    try {
      setAppeals(await fetchAppeals());
      setLoadError(null);
    } catch (err) {
      console.error('[AppealsPage] Failed to fetch appeals:', err);
      setLoadError('The appeals could not be loaded. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const waiting = appeals.filter((a) => a.status === 'Pending LGU Review');
  const withToda = appeals.filter((a) => a.status === 'Pending TODA Review');
  const overdue = appeals.filter((a) => a.overdue);
  const decided = appeals.filter((a) => !isPendingAppeal(a.status));

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return appeals
      .filter((a) => {
        const matchesStatus =
          statusFilter === 'All' ||
          (statusFilter === 'Waiting for the LGU' && a.status === 'Pending LGU Review') ||
          (statusFilter === 'With a TODA' && a.status === 'Pending TODA Review') ||
          (statusFilter === 'Overdue' && a.overdue) ||
          (statusFilter === 'Decided' && !isPendingAppeal(a.status));
        const matchesType = typeFilter === 'All' || a.subjectType === typeFilter;
        const matchesSearch = !q || a.subjectName.toLowerCase().includes(q) || a.violation.toLowerCase().includes(q) || a.justification.toLowerCase().includes(q);
        return matchesStatus && matchesType && matchesSearch;
      })
      // the ones waiting longest first, then the decided ones newest first
      .sort((a, b) => {
        const pa = isPendingAppeal(a.status) ? 0 : 1;
        const pb = isPendingAppeal(b.status) ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return pa === 0 ? Date.parse(a.requestedAt) - Date.parse(b.requestedAt) : Date.parse(b.requestedAt) - Date.parse(a.requestedAt);
      });
  }, [appeals, statusFilter, typeFilter, searchQuery]);

  const statusOptions: FilterOption[] = [
    { label: 'Waiting for the LGU', value: 'Waiting for the LGU' },
    { label: 'Overdue', value: 'Overdue' },
    { label: 'With a TODA (read only)', value: 'With a TODA' },
    { label: 'Decided', value: 'Decided' },
    { label: 'All appeals', value: 'All' },
  ];
  const typeOptions: FilterOption[] = [
    { label: 'Passengers and drivers', value: 'All' },
    { label: 'Passengers', value: 'passenger' },
    { label: 'Drivers', value: 'driver' },
  ];

  // each number is also a button: it shows that group of appeals in the list below (pressing it again shows all)
  const pick = (key: string) => () => setStatusFilter(statusFilter === key ? 'All' : key);
  const filtering = Boolean(searchQuery) || typeFilter !== 'All' || statusFilter !== 'Waiting for the LGU';

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 4.8 }}>
      <StatStrip
        label="Appeal totals (press one to show those appeals)"
        stats={[
          { key: 'waiting', label: 'Waiting for the LGU', value: waiting.length, tone: waiting.length > 0 ? 'brand' : 'neutral', note: 'Passenger appeals, and driver appeals escalated to you', onSelect: pick('Waiting for the LGU'), selected: statusFilter === 'Waiting for the LGU' },
          { key: 'overdue', label: 'Overdue', value: overdue.length, tone: overdue.length > 0 ? 'danger' : 'neutral', note: 'Past the 3 business days', onSelect: pick('Overdue'), selected: statusFilter === 'Overdue' },
          { key: 'toda', label: 'With a TODA', value: withToda.length, note: "Driver appeals the TODA is still reviewing", onSelect: pick('With a TODA'), selected: statusFilter === 'With a TODA' },
          { key: 'decided', label: 'Decided', value: decided.length, tone: 'success', note: 'Waived in full or in part, or denied', onSelect: pick('Decided'), selected: statusFilter === 'Decided' },
        ]}
      />

      <FilterToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search name, strike, or what they wrote"
        selectFilters={[
          { id: 'status', label: 'Show', value: statusFilter, options: statusOptions, onChange: setStatusFilter },
          { id: 'type', label: 'Who', value: typeFilter, options: typeOptions, onChange: setTypeFilter },
        ]}
        onResetFilters={() => {
          setSearchQuery('');
          setStatusFilter('Waiting for the LGU');
          setTypeFilter('All');
        }}
      />

      {loadError && (
        <Alert severity="error" sx={{ mb: 1.6, borderRadius: '10px' }} action={<Button onClick={load} sx={rowActionSx('danger')}>Try again</Button>}>
          {loadError}
        </Alert>
      )}

      <DataTableCard
        label="Strike appeals"
        minWidth={900}
        columns={[{ label: 'Person' }, { label: 'Strike' }, { label: 'Cause' }, { label: 'Requested' }, { label: 'Decision due' }, { label: 'Status' }, { label: 'Action', align: 'right' }]}
      >
        <TableBody>
          {isLoading ? (
            <DataTableMessageRow colSpan={7} kind="loading" loadingText="Loading strike appeals..." />
          ) : filtered.length > 0 ? (
            filtered.map((a) => (
              <TableRow key={a.requestId}>
                <TableCell>
                  <CellStack primary={a.subjectName} secondary={a.subjectType === 'passenger' ? 'Passenger' : 'Driver'} />
                </TableCell>
                <TableCell>
                  <CellStack primary={a.violation} secondary={`${a.pointsActive} of ${a.pointsIssued} point(s) active`} />
                </TableCell>
                <TableCell>{APPEAL_CAUSE_LABELS[a.causeCode] ?? a.causeCode}</TableCell>
                <TableCell sx={{ color: PAGE_TEXT.secondary }}>{stamp(a.requestedAt)}</TableCell>
                <TableCell>
                  <Typography sx={{ fontSize: FONT.body, color: a.overdue ? PAGE_TEXT.danger : PAGE_TEXT.primary, fontWeight: a.overdue ? 700 : 400 }}>
                    {isPendingAppeal(a.status) ? stamp(a.decisionDueAt) : '-'}
                  </Typography>
                  {a.overdue && <Box sx={{ mt: '3px' }}><FlagTag label="Overdue" tone="danger" /></Box>}
                </TableCell>
                <TableCell>
                  <StatusBadge status={a.status} />
                  {a.status === 'Pending LGU Review' && a.subjectType === 'driver' && (
                    <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '3px' }}>Escalated by the TODA</Typography>
                  )}
                </TableCell>
                <TableCell align="right">
                  <Button aria-label={`${a.status === 'Pending LGU Review' ? 'Review' : 'View'} the appeal of ${a.subjectName}`} onClick={() => setSelectedId(a.requestId)} sx={rowActionSx('neutral')}>
                    {a.status === 'Pending LGU Review' ? 'Review' : 'View'}
                  </Button>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <DataTableMessageRow
              colSpan={7}
              kind={filtering ? 'noResults' : 'empty'}
              title={filtering ? 'No appeals match' : 'Nothing is waiting for you'}
              hint={
                filtering
                  ? 'Nothing matches your search or filter. Try clearing them.'
                  : "A passenger's appeal of a strike, and a driver's that the TODA escalates, will appear here."
              }
              onRefresh={load}
            />
          )}
        </TableBody>
      </DataTableCard>

      {selected && <AppealDetailModal open onClose={() => setSelectedId(null)} appeal={selected} onChanged={load} />}
    </Box>
  );
};
