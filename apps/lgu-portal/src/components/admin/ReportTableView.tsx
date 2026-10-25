import React from 'react';
import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import type { ReportTable } from '@sakay/shared';

import { FONT } from '../../styles/density';
import { PAGE_TEXT, innerTableSx } from '../../styles/pageTheme';

interface ReportTableViewProps {
  table: ReportTable;
  emptyText: string;
}

/** A report table as the page shows it; the exports contain exactly the same headers and rows. */
export const ReportTableView: React.FC<ReportTableViewProps> = ({ table, emptyText }) => (
  <>
    <Typography component="h3" sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: PAGE_TEXT.primary, mb: '2px' }}>{table.title}</Typography>
    {table.notes.map((n) => (
      <Typography key={n} sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, lineHeight: 1.5, mb: '2px' }}>{n}</Typography>
    ))}
    <TableContainer role="region" aria-label={`${table.title}, scrollable`} tabIndex={0} sx={{ ...innerTableSx, mt: '10px', border: '1px solid rgba(15, 23, 42, 0.12)', borderRadius: '10px' }}>
      {/* every cell is one line, so every row is the same height whatever the text is; the first column (the period, the driver, the TODA) is given the room it needs and a longer text in another column is cut with ... (the whole text is its tooltip) */}
      <Table size="small" sx={{ width: '100%', minWidth: 'max-content' }}>
        <TableHead>
          <TableRow>
            {table.headers.map((h) => (
              <TableCell key={h}>{h}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {table.rows.length > 0 ? (
            table.rows.map((row, i) => (
              <TableRow key={i}>
                {row.map((cell, j) => {
                  const text = cell === null || cell === undefined ? '' : String(cell);
                  return (
                    <TableCell key={j} title={text} sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: j === 0 ? 380 : 260, fontWeight: j === 0 ? 600 : undefined }}>
                      {text}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))
          ) : (
            <TableRow sx={{ '&:hover': { backgroundColor: 'transparent !important' } }}>
              <TableCell colSpan={table.headers.length} align="center" sx={{ py: '32px !important', color: PAGE_TEXT.secondary }}>{emptyText}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  </>
);
