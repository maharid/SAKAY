import React from 'react';
import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import type { ReportTable } from '@sakay/shared';

interface ReportTableViewProps {
  table: ReportTable;
  emptyText: string;
}

/** A report table as the page shows it; the exports contain exactly the same headers and rows. */
export const ReportTableView: React.FC<ReportTableViewProps> = ({ table, emptyText }) => (
  <>
    <Typography sx={{ fontSize: '12.8px', fontWeight: 700, color: 'var(--mac-text-primary)', mb: 0.5 }}>{table.title}</Typography>
    {table.notes.map((n) => (
      <Typography key={n} sx={{ fontSize: '10.4px', color: 'var(--mac-text-muted)', mb: 0.5 }}>{n}</Typography>
    ))}
    <TableContainer sx={{ mt: 1.5 }}>
      <Table size="small">
        <TableHead sx={{ backgroundColor: '#FAFAFC' }}>
          <TableRow>
            {table.headers.map((h) => (
              <TableCell key={h} sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '11px' }}>{h}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {table.rows.length > 0 ? (
            table.rows.map((row, i) => (
              <TableRow key={i}>
                {row.map((cell, j) => (
                  <TableCell key={j} sx={j === 0 ? { fontWeight: 600 } : undefined}>{cell === null || cell === undefined ? '' : String(cell)}</TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={table.headers.length} align="center" sx={{ py: 4, color: 'var(--mac-text-muted)' }}>{emptyText}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  </>
);
