import React from 'react';
import { TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';

import { StatusBadge } from '../common/StatusBadge';
import { OperationsTable, TableMessageRow } from './OperationsTableParts';
import { FONT } from '../../styles/density';
import { OPS_TEXT } from './operationsTheme';
import type { TodaBooking } from '../../types/toda';

interface BookingsTableProps {
  bookings: TodaBooking[];
  isLoading: boolean;
}

export const BookingsTable: React.FC<BookingsTableProps> = ({ bookings, isLoading }) => (
  <OperationsTable label="Bookings" minWidth={416}>
    <TableHead>
      <TableRow>
        <TableCell>Trip code</TableCell>
        <TableCell>Driver and plate</TableCell>
        <TableCell>Trip type</TableCell>
        <TableCell>Status</TableCell>
      </TableRow>
    </TableHead>
    <TableBody>
      {isLoading ? (
        <TableMessageRow colSpan={4} loading loadingText="Loading bookings..." emptyTitle="" emptyHint="" />
      ) : bookings.length === 0 ? (
        <TableMessageRow
          colSpan={4}
          loading={false}
          loadingText=""
          emptyTitle="No bookings yet"
          emptyHint="Rides taken by your drivers will show up here."
        />
      ) : (
        bookings.map((bkg) => (
          <TableRow key={bkg.id}>
            <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap', letterSpacing: '0.02em' }}>{bkg.bookingCode}</TableCell>
            <TableCell>
              <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: OPS_TEXT.primary }}>{bkg.driverName}</Typography>
              <Typography sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary }}>{bkg.vehiclePlate}</Typography>
            </TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>{bkg.tripMode}</TableCell>
            <TableCell>
              <StatusBadge status={bkg.status} highContrast sx={{ height: '24px', fontSize: FONT.small }} />
            </TableCell>
          </TableRow>
        ))
      )}
    </TableBody>
  </OperationsTable>
);
