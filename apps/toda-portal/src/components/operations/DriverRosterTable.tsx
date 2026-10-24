import React from 'react';
import { Box, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';

import { StatusBadge } from '../common/StatusBadge';
import { OperationsTable, TableMessageRow } from './OperationsTableParts';
import { FONT } from '../../styles/density';
import { OPS_TEXT } from './operationsTheme';
import type { TodaDriverMember } from '../../types/toda';

interface DriverRosterTableProps {
  drivers: TodaDriverMember[];
  isLoading: boolean;
  /** The page decides who is online, paused and how many trips a driver completed; this table only shows it */
  isOnlineNow: (driver: TodaDriverMember) => boolean;
  isPausedNow: (driver: TodaDriverMember) => boolean;
  completedTrips: (driver: TodaDriverMember) => number;
}

// Each state has its own word AND colour, so nobody has to tell them apart by colour alone.
const AVAILABILITY_STYLES = {
  offline: { background: '#F1F3F4', color: '#4B5563' },
  paused: { background: '#FEF9C3', color: '#854D0E' },
  onTrip: { background: '#FFEDD5', color: '#9A3412' },
  online: { background: '#DCFCE7', color: '#166534' },
} as const;

const AvailabilityPill: React.FC<{ label: string; styleKey: keyof typeof AVAILABILITY_STYLES }> = ({ label, styleKey }) => (
  <Box
    sx={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      px: '10px',
      py: '3px',
      borderRadius: '999px',
      fontSize: FONT.small,
      fontWeight: 600,
      whiteSpace: 'nowrap',
      backgroundColor: AVAILABILITY_STYLES[styleKey].background,
      color: AVAILABILITY_STYLES[styleKey].color,
    }}
  >
    <Box aria-hidden sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'currentColor' }} />
    {label}
  </Box>
);

export const DriverRosterTable: React.FC<DriverRosterTableProps> = ({ drivers, isLoading, isOnlineNow, isPausedNow, completedTrips }) => (
  <OperationsTable label="Driver roster" minWidth={512}>
    <TableHead>
      <TableRow>
        <TableCell>Driver name</TableCell>
        <TableCell>Franchise no.</TableCell>
        <TableCell>Account status</TableCell>
        <TableCell>Availability</TableCell>
        <TableCell align="right">Trips completed</TableCell>
      </TableRow>
    </TableHead>
    <TableBody>
      {isLoading ? (
        <TableMessageRow colSpan={5} loading loadingText="Loading drivers..." emptyTitle="" emptyHint="" />
      ) : drivers.length === 0 ? (
        <TableMessageRow
          colSpan={5}
          loading={false}
          loadingText=""
          emptyTitle="No drivers yet"
          emptyHint="No registered drivers are affiliated with this TODA at the moment."
        />
      ) : (
        drivers.map((d) => {
          const availability = !isOnlineNow(d)
            ? { label: 'Offline', styleKey: 'offline' as const }
            : isPausedNow(d)
            ? { label: 'Paused', styleKey: 'paused' as const }
            : d.availabilityStatus === 'Busy'
            ? { label: 'On a trip', styleKey: 'onTrip' as const }
            : { label: 'Online', styleKey: 'online' as const };
          return (
            <TableRow key={d.id}>
              <TableCell sx={{ fontWeight: 600 }}>{d.name}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                <Typography component="span" sx={{ fontSize: 'inherit', color: d.franchiseNo ? OPS_TEXT.primary : OPS_TEXT.secondary }}>
                  {d.franchiseNo || 'N/A'}
                </Typography>
              </TableCell>
              <TableCell>
                <StatusBadge status={d.accountStatus} highContrast sx={{ height: '24px', fontSize: FONT.small }} />
              </TableCell>
              <TableCell>
                <AvailabilityPill label={availability.label} styleKey={availability.styleKey} />
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {completedTrips(d)}
              </TableCell>
            </TableRow>
          );
        })
      )}
    </TableBody>
  </OperationsTable>
);
