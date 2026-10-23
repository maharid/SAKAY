import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Alert,
} from '@mui/material';
import GavelIcon from '@mui/icons-material/Gavel';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import ScheduleIcon from '@mui/icons-material/Schedule';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { APPEAL_CAUSE_LABELS, isPendingAppeal } from '@sakay/shared';
import type { AppealRecord } from '@sakay/shared';

import { FilterToolbar, FilterOption } from '../components/admin/FilterToolbar';
import { StatusBadge } from '../components/common/StatusBadge';
import { ActionButton } from '../components/admin/ActionButton';
import { AppealDetailModal } from '../components/admin/AppealDetailModal';
import { TableEmptyState } from '../components/common/TableEmptyState';
import { fetchAppeals } from '../services/adminApiService';

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

  const cards = [
    { key: 'Waiting for the LGU', label: 'Waiting for the LGU', count: waiting.length, note: 'Passenger appeals, and driver appeals escalated to you', color: 'var(--sakay-orange)', Icon: HourglassEmptyIcon },
    { key: 'Overdue', label: 'Overdue', count: overdue.length, note: 'Past the three business days', color: '#B91C1C', Icon: ScheduleIcon },
    { key: 'With a TODA', label: 'With a TODA', count: withToda.length, note: 'Drivers\' appeals the TODA is still reviewing', color: '#1565C0', Icon: GavelIcon },
    { key: 'Decided', label: 'Decided', count: decided.length, note: 'Full or partial waiver, or denied', color: '#2E7D32', Icon: CheckCircleIcon },
  ];

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 6 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2.5, mb: 4 }}>
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
            <CardContent sx={{ p: '20px 22px !important' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                <Typography sx={{ fontSize: '10px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase' }}>{label}</Typography>
                <Icon sx={{ color, fontSize: 16 }} />
              </Box>
              <Typography sx={{ fontSize: '22.4px', fontWeight: 700, color: count > 0 && key === 'Overdue' ? color : 'var(--mac-text-primary)', mb: 0.5 }}>{count}</Typography>
              <Typography sx={{ fontSize: '10px', color: 'var(--mac-text-muted)' }}>{note}</Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      <FilterToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search name, violation, or what the person wrote..."
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

      {loadError && <Alert severity="error" sx={{ mb: 2, borderRadius: '10px' }}>{loadError}</Alert>}

      <TableContainer
        component={Paper}
        elevation={0}
        sx={{ borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', boxShadow: 'var(--mac-shadow-card)', overflow: 'hidden', backgroundColor: '#FFFFFF' }}
      >
        <Table>
          <TableHead sx={{ backgroundColor: '#FAFAFC' }}>
            <TableRow>
              {['Person', 'Strike', 'Cause', 'Requested', 'Decision due', 'Status'].map((h) => (
                <TableCell key={h} sx={{ fontWeight: 600, fontSize: '13px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>{h}</TableCell>
              ))}
              <TableCell align="right" sx={{ fontWeight: 600, fontSize: '13px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 8 }}>
                  <CircularProgress size={32} sx={{ color: 'var(--sakay-orange)', mb: 1.5 }} />
                  <Typography sx={{ fontSize: '11.3px', color: 'var(--mac-text-muted)' }}>Loading strike appeals...</Typography>
                </TableCell>
              </TableRow>
            ) : filtered.length > 0 ? (
              filtered.map((a) => (
                <TableRow key={a.requestId} sx={{ transition: 'var(--mac-transition-fast)', '&:hover': { backgroundColor: 'var(--mac-canvas-bg)' } }}>
                  <TableCell sx={{ py: 2.2, px: 3 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: '11.6px', color: 'var(--mac-text-primary)' }}>{a.subjectName}</Typography>
                    <Typography sx={{ fontSize: '10px', color: 'var(--sakay-orange)', fontWeight: 600, mt: '3px' }}>{a.subjectType === 'passenger' ? 'Passenger' : 'Driver'}</Typography>
                  </TableCell>
                  <TableCell sx={{ py: 2.2, px: 3 }}>
                    <Typography sx={{ fontSize: '11.3px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{a.violation}</Typography>
                    <Typography sx={{ fontSize: '10.5px', color: 'var(--mac-text-muted)' }}>{a.pointsActive} of {a.pointsIssued} point(s) active</Typography>
                  </TableCell>
                  <TableCell sx={{ py: 2.2, px: 3 }}>
                    <Typography sx={{ fontSize: '11.3px', color: 'var(--mac-text-primary)' }}>{APPEAL_CAUSE_LABELS[a.causeCode] ?? a.causeCode}</Typography>
                  </TableCell>
                  <TableCell sx={{ py: 2.2, px: 3 }}>
                    <Typography sx={{ fontSize: '10.8px', color: 'var(--mac-text-primary)' }}>{stamp(a.requestedAt)}</Typography>
                  </TableCell>
                  <TableCell sx={{ py: 2.2, px: 3 }}>
                    <Typography sx={{ fontSize: '10.8px', color: a.overdue ? '#B91C1C' : 'var(--mac-text-primary)', fontWeight: a.overdue ? 700 : 400 }}>
                      {isPendingAppeal(a.status) ? stamp(a.decisionDueAt) : '-'}
                    </Typography>
                    {a.overdue && <Typography sx={{ fontSize: '10px', fontWeight: 700, color: '#B91C1C' }}>OVERDUE</Typography>}
                  </TableCell>
                  <TableCell sx={{ py: 2.2, px: 3 }}>
                    <StatusBadge status={a.status} />
                    {a.status === 'Pending LGU Review' && a.subjectType === 'driver' && (
                      <Typography sx={{ fontSize: '10px', color: 'var(--mac-text-muted)', mt: '3px' }}>Escalated by the TODA</Typography>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ py: 2.2, px: 3 }}>
                    <ActionButton label={a.status === 'Pending LGU Review' ? 'Review' : 'View'} onClick={() => setSelectedId(a.requestId)} />
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmptyState
                colSpan={7}
                icon={<GavelIcon />}
                title="No strike appeals found"
                description={
                  searchQuery || typeFilter !== 'All' || statusFilter !== 'Waiting for the LGU'
                    ? 'No appeals match your search or filter.'
                    : 'Nothing is waiting for you. A passenger\'s appeal of a strike, and a driver\'s that the TODA escalates, will appear here.'
                }
                onRefresh={load}
                isRefreshing={isLoading}
              />
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {selected && <AppealDetailModal open onClose={() => setSelectedId(null)} appeal={selected} onChanged={load} />}
    </Box>
  );
};
