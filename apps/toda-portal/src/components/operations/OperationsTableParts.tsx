import React from 'react';
import { Box, CircularProgress, Table, TableCell, TableContainer, TableRow, Typography } from '@mui/material';

import { FONT } from '../../styles/density';
import { OPS_DIVIDER, OPS_TEXT, opsFocusRing } from './operationsTheme';

interface OperationsTableProps {
  /** Read out by a screen reader for the scrollable area, e.g. "Driver roster" */
  label: string;
  /** The table keeps this width and the area scrolls sideways on a narrow screen instead of squeezing the text */
  minWidth: number;
  children: React.ReactNode;
}

// Rows are about 45px with only a thin line between them. The header stays in view while the list scrolls.
// The scrollable area can be focused with the keyboard so the arrow keys can scroll it.
export const OperationsTable: React.FC<OperationsTableProps> = ({ label, minWidth, children }) => (
  <TableContainer
    role="region"
    aria-label={`${label}, scrollable`}
    tabIndex={0}
    sx={{
      maxHeight: 416,
      overflow: 'auto',
      borderTop: `1px solid ${OPS_DIVIDER}`,
      ...opsFocusRing,
      '& .MuiTable-root': { minWidth },
      '& .MuiTableCell-root': { fontSize: FONT.body, color: OPS_TEXT.primary, py: '11px', px: '13px', borderBottom: `1px solid ${OPS_DIVIDER}` },
      '& .MuiTableCell-head': { fontSize: FONT.small, fontWeight: 600, color: OPS_TEXT.secondary, backgroundColor: '#FFFFFF', whiteSpace: 'nowrap', borderBottomColor: 'rgba(15, 23, 42, 0.16)' },
      '& .MuiTableBody-root .MuiTableRow-root:last-of-type .MuiTableCell-root': { borderBottom: 'none' },
      '& .MuiTableBody-root .MuiTableRow-root:hover': { backgroundColor: '#FAFAF8' },
    }}
  >
    <Table stickyHeader>{children}</Table>
  </TableContainer>
);

interface TableMessageRowProps {
  colSpan: number;
  loading: boolean;
  loadingText: string;
  /** Shown when there is nothing to list */
  emptyTitle: string;
  emptyHint: string;
}

// The "loading" and "nothing here yet" rows of both tables.
export const TableMessageRow: React.FC<TableMessageRowProps> = ({ colSpan, loading, loadingText, emptyTitle, emptyHint }) => (
  <TableRow sx={{ '&:hover': { backgroundColor: 'transparent' } }}>
    <TableCell colSpan={colSpan} align="center" sx={{ py: '32px' }}>
      {loading ? (
        <Box role="status" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
          <CircularProgress size={21} sx={{ color: 'var(--sakay-orange)' }} />
          <Typography sx={{ fontSize: FONT.body, color: OPS_TEXT.secondary }}>{loadingText}</Typography>
        </Box>
      ) : (
        <>
          <Typography sx={{ fontSize: FONT.heading, fontWeight: 600, color: OPS_TEXT.primary }}>{emptyTitle}</Typography>
          <Typography sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary, mt: '3px' }}>{emptyHint}</Typography>
        </>
      )}
    </TableCell>
  </TableRow>
);
