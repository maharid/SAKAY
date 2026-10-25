import React, { useState, useEffect } from 'react';
import { Box, Button, TableBody, TableCell, TableRow, Typography } from '@mui/material';

import { AccreditedTodaRecord } from '../mockData/adminData';
import { FilterToolbar, FilterOption } from '../components/admin/FilterToolbar';
import { StatusBadge } from '../components/common/StatusBadge';
import { TodaDetailModal } from '../components/admin/TodaDetailModal';
import { CellStack, DataTableCard, DataTableMessageRow, FlagTag } from '../components/common/DataTable';
import { fetchAccreditedTodas } from '../services/adminApiService';
import { FONT } from '../styles/density';
import { PAGE_TEXT, rowActionSx } from '../styles/pageTheme';

/**
 * ============================================================================
 * ACCREDITED TODAS DIRECTORY PAGE
 * ============================================================================
 * Purpose:
 *   Displays the official municipal registry of accredited Tricycle Operators
 *   and Drivers Associations (TODAs) authorized to operate in Calapan City.
 *   Connected directly to the live Supabase database.
 * ============================================================================
 */
export const AccreditedTodasPage: React.FC = () => {
  const [todas, setTodas] = useState<AccreditedTodaRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [driverCountFilter, setDriverCountFilter] = useState('All');

  // Selected TODA for Driver Directory Modal
  const [selectedToda, setSelectedToda] = useState<AccreditedTodaRecord | null>(null);

  const loadTodas = async () => {
    setIsLoading(true);
    try {
      const data = await fetchAccreditedTodas();
      setTodas(data);
    } catch (err) {
      console.error('[AccreditedTodasPage] Failed to fetch accredited TODAs:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTodas();
  }, []);

  const filteredTodas = todas.filter((t) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      t.name.toLowerCase().includes(q) ||
      (t.acronym && t.acronym.toLowerCase().includes(q)) ||
      t.representative.toLowerCase().includes(q) ||
      t.barangay.toLowerCase().includes(q) ||
      t.accreditationNo.toLowerCase().includes(q);

    const matchesStatus = statusFilter === 'All' || t.status === statusFilter;

    let matchesDriverCount = true;
    if (driverCountFilter === 'Small') matchesDriverCount = t.registeredDrivers < 25;
    if (driverCountFilter === 'Medium') matchesDriverCount = t.registeredDrivers >= 25 && t.registeredDrivers <= 50;
    if (driverCountFilter === 'Large') matchesDriverCount = t.registeredDrivers > 50;

    return matchesSearch && matchesStatus && matchesDriverCount;
  });

  const statusOptions: FilterOption[] = [
    { label: 'All Statuses', value: 'All' },
    { label: 'Active', value: 'Active' },
    { label: 'Suspended', value: 'Suspended' },
    { label: 'Inactive', value: 'Inactive' },
  ];

  const driverCountOptions: FilterOption[] = [
    { label: 'All Roster Sizes', value: 'All' },
    { label: 'Small (under 25 units)', value: 'Small' },
    { label: 'Medium (25 to 50 units)', value: 'Medium' },
    { label: 'Large (over 50 units)', value: 'Large' },
  ];

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 4.8 }}>
      {/* 1. Search and filters */}
      <FilterToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search TODA, barangay, permit number"
        selectFilters={[
          {
            id: 'status',
            label: 'Status',
            value: statusFilter,
            options: statusOptions,
            onChange: setStatusFilter,
          },
          {
            id: 'driverCount',
            label: 'Roster Size',
            value: driverCountFilter,
            options: driverCountOptions,
            onChange: setDriverCountFilter,
          },
        ]}
        onResetFilters={() => {
          setSearchQuery('');
          setStatusFilter('All');
          setDriverCountFilter('All');
        }}
      />

      {/* 2. The registry */}
      <DataTableCard
        label="Accredited TODAs"
        minWidth={900}
        columns={[
          { label: 'TODA' },
          { label: 'Representative' },
          { label: 'Service zone' },
          { label: 'Barangay Clearance' },
          { label: 'Fleet' },
          { label: 'Status' },
          { label: 'Action', align: 'right' },
        ]}
      >
        <TableBody>
          {isLoading ? (
            <DataTableMessageRow colSpan={7} kind="loading" loadingText="Loading accredited TODAs..." />
          ) : filteredTodas.length > 0 ? (
            filteredTodas.map((toda) => (
              <TableRow key={toda.id}>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: '6px', rowGap: '2px' }}>
                    <Typography component="div" sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.primary, overflowWrap: 'anywhere' }}>{toda.name}</Typography>
                    {toda.acronym && <FlagTag label={toda.acronym} tone="brand" />}
                    {toda.flaggedForReview && <FlagTag label={`Flagged (${toda.confirmedIncidents} ${toda.confirmedIncidents === 1 ? 'incident' : 'incidents'})`} tone="warning" />}
                  </Box>
                  <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '1px' }}>Permit / cert. no. {toda.accreditationNo}</Typography>
                </TableCell>
                <TableCell>{toda.representative}</TableCell>
                <TableCell sx={{ color: PAGE_TEXT.secondary }}>{toda.barangay}</TableCell>
                <TableCell>
                  <Typography
                    sx={{
                      fontSize: FONT.body,
                      fontWeight: 600,
                      color: toda.clearanceStatus === 'Expired' ? PAGE_TEXT.danger : toda.clearanceStatus === 'Expiring Soon' ? PAGE_TEXT.warning : PAGE_TEXT.primary,
                    }}
                  >
                    Expires {toda.barangayClearanceExpiry}
                  </Typography>
                  <Box sx={{ mt: '3px' }}>
                    <StatusBadge status={toda.clearanceStatus as any} />
                  </Box>
                  {toda.renewalSubmittedAt && (
                    <Typography sx={{ fontSize: FONT.small, fontWeight: 700, color: PAGE_TEXT.warning, mt: '3px' }}>
                      Renewal received: record it
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <CellStack primary={`${toda.registeredDrivers} ${toda.registeredDrivers === 1 ? 'driver' : 'drivers'}`} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={toda.status as any} />
                </TableCell>
                <TableCell align="right">
                  <Button aria-label={`View details of ${toda.name}`} onClick={() => setSelectedToda(toda)} sx={rowActionSx('neutral')}>
                    View details
                  </Button>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <DataTableMessageRow
              colSpan={7}
              kind={todas.length > 0 ? 'noResults' : 'empty'}
              title={todas.length > 0 ? 'No TODAs match' : 'No accredited TODAs yet'}
              hint={
                todas.length > 0
                  ? 'Nothing matches your search or filter. Try clearing them.'
                  : 'TODAs appear here once they are approved for municipal accreditation.'
              }
              onRefresh={loadTodas}
            />
          )}
        </TableBody>
      </DataTableCard>

      {/* 3. Window with the TODA's details and driver directory */}
      {selectedToda && (
        <TodaDetailModal
          open={Boolean(selectedToda)}
          onClose={() => setSelectedToda(null)}
          toda={selectedToda}
          onChanged={loadTodas}
        />
      )}
    </Box>
  );
};
