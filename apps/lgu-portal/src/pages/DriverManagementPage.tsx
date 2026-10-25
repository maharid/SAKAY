import React, { useState, useEffect } from 'react';
import { Box, Button, TableBody, TableCell, TableRow, Typography } from '@mui/material';

import { DriverRecord } from '../mockData/adminData';
import { FilterToolbar, FilterOption } from '../components/admin/FilterToolbar';
import { StatusBadge } from '../components/common/StatusBadge';
import { DriverDetailModal } from '../components/admin/DriverDetailModal';
import { CellStack, DataTableCard, DataTableMessageRow, FlagTag, PersonCell } from '../components/common/DataTable';
import { fetchDrivers } from '../services/adminApiService';
import { FONT } from '../styles/density';
import { PAGE_TEXT, rowActionSx } from '../styles/pageTheme';

/**
 * ============================================================================
 * DRIVER MANAGEMENT PAGE COMPONENT
 * ============================================================================
 * Purpose:
 *   Allows LGU Transport Officers to review driver credentials, monitor
 *   dual-gate verification statuses, track online sessions, investigate
 *   policy strikes, and enact administrative suspensions.
 *   Connected 100% directly to the live Supabase database.
 * ============================================================================
 */
export const DriverManagementPage: React.FC = () => {
  // State: Driver roster and active filters
  const [drivers, setDrivers] = useState<DriverRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [verificationFilter, setVerificationFilter] = useState('All');
  const [onlineFilter, setOnlineFilter] = useState('All');
  const [selectedDriver, setSelectedDriver] = useState<DriverRecord | null>(null);

  /**
   * Load real drivers from database
   */
  const loadDrivers = async () => {
    setIsLoading(true);
    try {
      const data = await fetchDrivers();
      setDrivers(data);
    } catch (err) {
      console.error('[DriverManagementPage] Failed to fetch drivers:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDrivers();
  }, []);

  // Filter logic: Search by name, license number, plate number, franchise number, or TODA
  const filteredDrivers = drivers.filter((d) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      d.name.toLowerCase().includes(q) ||
      d.licenseNo.toLowerCase().includes(q) ||
      d.mtopNo.toLowerCase().includes(q) ||
      d.todaName.toLowerCase().includes(q) ||
      d.vehiclePlate.toLowerCase().includes(q) ||
      d.barangay.toLowerCase().includes(q);

    const matchesVerification =
      verificationFilter === 'All' ||
      (verificationFilter === 'Resubmitted' || verificationFilter === 'Resubmitted (Awaiting Review)'
        ? (Boolean(d.isResubmitted) || d.verificationStatus === 'Resubmitted (Awaiting Review)')
        : verificationFilter === 'Pending'
        ? (d.verificationStatus === 'Pending' || d.verificationStatus === 'Endorsed to LGU' || Boolean(d.actionAffiliationId))
        : d.verificationStatus === verificationFilter);
    const matchesOnline = onlineFilter === 'All' || d.onlineStatus === onlineFilter;

    return matchesSearch && matchesVerification && matchesOnline;
  });

  const verificationOptions: FilterOption[] = [
    { label: 'All Verifications', value: 'All' },
    { label: 'Resubmitted (Awaiting Review)', value: 'Resubmitted' },
    { label: 'Endorsed to LGU', value: 'Endorsed to LGU' },
    { label: 'Resubmission Required', value: 'Resubmission Required' },
    { label: 'Verified', value: 'Verified' },
    { label: 'Pending Verification', value: 'Pending' },
    { label: 'Suspended', value: 'Suspended' },
    { label: 'Rejected', value: 'Rejected' },
  ];

  const onlineOptions: FilterOption[] = [
    { label: 'All Sessions', value: 'All' },
    { label: 'Online', value: 'Online' },
    { label: 'Offline', value: 'Offline' },
  ];

  const handleDriverUpdated = (updatedDriver: DriverRecord) => {
    setDrivers((prev) =>
      prev.map((d) => (d.id === updatedDriver.id ? updatedDriver : d))
    );
    setSelectedDriver(updatedDriver);
  };

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 4.8 }}>
      {/* 1. Search and filters */}
      <FilterToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search driver, license, plate, TODA"
        selectFilters={[
          {
            id: 'verification',
            label: 'Verification',
            value: verificationFilter,
            options: verificationOptions,
            onChange: setVerificationFilter,
          },
          {
            id: 'online',
            label: 'Online Status',
            value: onlineFilter,
            options: onlineOptions,
            onChange: setOnlineFilter,
          },
        ]}
        onResetFilters={() => {
          setSearchQuery('');
          setVerificationFilter('All');
          setOnlineFilter('All');
        }}
      />

      {/* 2. The drivers */}
      <DataTableCard
        label="Drivers"
        minWidth={940}
        columns={[
          { label: 'Driver' },
          { label: 'TODA' },
          { label: 'Franchise and plate' },
          { label: 'Online' },
          { label: 'Verification' },
          { label: 'Account' },
          { label: 'Action', align: 'right' },
        ]}
      >
        <TableBody>
          {isLoading ? (
            <DataTableMessageRow colSpan={7} kind="loading" loadingText="Loading drivers..." />
          ) : filteredDrivers.length > 0 ? (
            filteredDrivers.map((driver) => (
              <TableRow key={driver.id}>
                <TableCell>
                  <PersonCell name={driver.name} detail={`License ${driver.licenseNo} · ${driver.phone}`} />
                </TableCell>
                <TableCell>
                  <CellStack primary={driver.todaName} secondary={`Brgy. ${driver.barangay}`} />
                </TableCell>
                <TableCell>
                  <CellStack primary={`MTOP ${driver.mtopNo}`} secondary={`Plate ${driver.vehiclePlate}`} />
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Box aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: driver.onlineStatus === 'Online' ? '#34A853' : '#9AA0A6' }} />
                    <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary }}>{driver.onlineStatus}</Typography>
                  </Box>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 6px' }}>
                    <StatusBadge status={driver.verificationStatus as any} />
                    {driver.isResubmitted && <FlagTag label="Resubmitted" tone="warning" />}
                    {driver.isOverdue5Days && <FlagTag label="Overdue (over 5 days)" tone="danger" />}
                  </Box>
                </TableCell>
                <TableCell>
                  <StatusBadge status={driver.accountStatus as any} />
                </TableCell>
                <TableCell align="right">
                  <Button aria-label={`Review driver ${driver.name}`} onClick={() => setSelectedDriver(driver)} sx={rowActionSx('neutral')}>
                    Review
                  </Button>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <DataTableMessageRow
              colSpan={7}
              kind={drivers.length > 0 ? 'noResults' : 'empty'}
              title={drivers.length > 0 ? 'No drivers match' : 'No drivers registered yet'}
              hint={
                drivers.length > 0
                  ? 'Nothing matches your search or filter. Try clearing them.'
                  : 'Drivers appear here once accredited TODAs start registering them.'
              }
              onRefresh={loadDrivers}
            />
          )}
        </TableBody>
      </DataTableCard>

      {/* 3. Driver review window */}
      {selectedDriver && (
        <DriverDetailModal
          open={Boolean(selectedDriver)}
          onClose={() => {
            setSelectedDriver(null);
            loadDrivers();
          }}
          driver={selectedDriver}
          onDriverUpdated={handleDriverUpdated}
        />
      )}
    </Box>
  );
};
