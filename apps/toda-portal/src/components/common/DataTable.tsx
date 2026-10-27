import React from 'react';
import { Avatar, Box, CircularProgress, Table, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import SearchOffOutlinedIcon from '@mui/icons-material/SearchOffOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ScheduleIcon from '@mui/icons-material/Schedule';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';

import { FONT } from '../../styles/density';
import { OPS_DIVIDER, OPS_TEXT, opsCardSx, opsFocusRing } from '../operations/operationsTheme';

export interface DataTableColumn {
  label: string;
  /** The last column (the action buttons) is usually aligned to the right */
  align?: 'right';
  /** A column of numbers lines up on the right in the wide table; in a stacked card it keeps its heading and reads like the other values */
  numeric?: boolean;
}

interface DataTableCardProps {
  /** Read out by a screen reader for the scrollable area, e.g. "Driver applications" */
  label: string;
  /** The column headings, in the same order as the cells of every row */
  columns: DataTableColumn[];
  /** On a wide card the table keeps this width (and scrolls sideways if the card is narrower). Under STACK_BELOW the rows stack instead. */
  minWidth: number;
  /** The rows: a <TableBody> */
  children: React.ReactNode;
}

/** A card narrower than this shows each row as a small stacked card (the column heading in front of every value) instead of a wide table. */
const STACK_BELOW = 760;

// a column heading as the text of a CSS `content:` value (quotes and backslashes escaped)
const cssText = (s: string) => `"${s.split('\\').join('\\\\').split('"').join('\\"')}"`;

// The frame of a full-page table: one white card, a thin line between rows, sentence-case column headings, text that wraps instead of being cut off.
// On a narrow card (a phone, a tablet beside the sidebar) every row turns into a small card with the column heading in front of each value, so nothing
// needs sideways scrolling. The card is measured by its own width, so this also works when the sidebar is open or closed.
export const DataTableCard: React.FC<DataTableCardProps> = ({ label, columns, minWidth, children }) => (
  <Box sx={{ containerType: 'inline-size' }}>
    <TableContainer
      role="region"
      aria-label={`${label}, scrollable`}
      tabIndex={0}
      sx={{
        ...opsCardSx,
        overflowX: 'auto',
        ...opsFocusRing,
        '& .MuiTable-root': { minWidth },
        '& .MuiTableCell-root': { fontSize: FONT.body, color: OPS_TEXT.primary, py: '12px', px: '16px', borderBottom: `1px solid ${OPS_DIVIDER}`, verticalAlign: 'middle' },
        '& .MuiTableCell-head': { fontSize: FONT.small, fontWeight: 600, color: OPS_TEXT.secondary, backgroundColor: '#FAFAF8', whiteSpace: 'nowrap', py: '10px', borderBottomColor: 'rgba(15, 23, 42, 0.14)' },
        '& .MuiTableBody-root .MuiTableRow-root:last-of-type .MuiTableCell-root': { borderBottom: 'none' },
        '& .MuiTableBody-root .MuiTableRow-root:hover': { backgroundColor: '#FAFAF8' },
        [`@container (min-width: ${STACK_BELOW}px)`]: Object.fromEntries(
          columns.flatMap((c, i) => (c.numeric ? [[`& .MuiTableCell-root:nth-of-type(${i + 1})`, { textAlign: 'right' }]] : []))
        ),
        [`@container (max-width: ${STACK_BELOW - 1}px)`]: {
          '& .MuiTable-root': { minWidth: 0, display: 'block' },
          '& .MuiTableHead-root': { display: 'none' },
          '& .MuiTableBody-root': { display: 'block' },
          '& .MuiTableBody-root .MuiTableRow-root': { display: 'block', py: '6px', borderBottom: `1px solid ${OPS_DIVIDER}` },
          '& .MuiTableBody-root .MuiTableRow-root:last-of-type': { borderBottom: 'none' },
          '& .MuiTableBody-root .MuiTableCell-root': {
            display: 'grid',
            gridTemplateColumns: 'minmax(96px, 38%) minmax(0, 1fr)',
            columnGap: '10px',
            alignItems: 'start',
            justifyItems: 'start',
            textAlign: 'left',
            border: 'none',
            px: '16px',
            py: '5px',
            '& > *': { gridColumn: 2 },
            '&::before': { gridColumn: 1, gridRow: 1, fontSize: FONT.small, fontWeight: 600, color: OPS_TEXT.secondary },
          },
          // the first cell (who or what the row is about) is the card's title; the action cell has no label
          '& .MuiTableBody-root .MuiTableCell-root:first-of-type, & .MuiTableBody-root .MuiTableCell-alignRight': {
            gridTemplateColumns: 'minmax(0, 1fr)',
            '& > *': { gridColumn: 1 },
            '&::before': { display: 'none' },
          },
          '& .MuiTableBody-root .MuiTableCell-root:first-of-type': { pt: '10px' },
          '& .MuiTableBody-root .MuiTableCell-alignRight': { pb: '10px' },
          // identifiers kept on one line in the wide table may wrap here, so a stacked card never needs sideways scrolling
          '& .MuiTableBody-root span[style*="white-space: nowrap"]': { whiteSpace: 'normal !important' },
          // the "loading" and "nothing here" row keeps its centred message
          '& .MuiTableBody-root .MuiTableCell-root[colspan]': { display: 'block', textAlign: 'center' },
          ...Object.fromEntries(
            columns.map((c, i) => [`& .MuiTableBody-root .MuiTableCell-root:nth-of-type(${i + 1})::before`, { content: c.align === 'right' ? '""' : cssText(c.label) }])
          ),
        },
      }}
    >
      <Table>
        <TableHead>
          <TableRow>
            {columns.map((c) => (
              <TableCell key={c.label} align={c.align}>{c.label}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        {children}
      </Table>
    </TableContainer>
  </Box>
);

type DataTableMessageKind = 'loading' | 'empty' | 'noResults';

interface DataTableMessageRowProps {
  colSpan: number;
  /** loading: reading the records; empty: there are none at all; noResults: there are some, but none match the search or filter */
  kind: DataTableMessageKind;
  title?: string;
  hint?: string;
  loadingText?: string;
}

// The one row that replaces the records when there is nothing to list. The three situations look different so nobody mistakes a search with no
// matches for an empty system, or a slow load for either.
export const DataTableMessageRow: React.FC<DataTableMessageRowProps> = ({ colSpan, kind, title, hint, loadingText = 'Loading...' }) => (
  <TableRow sx={{ '&:hover': { backgroundColor: 'transparent !important' } }}>
    <TableCell colSpan={colSpan} align="center" sx={{ py: '38px !important' }}>
      {kind === 'loading' ? (
        <Box role="status" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
          <CircularProgress size={21} sx={{ color: 'var(--sakay-orange)' }} />
          <Typography sx={{ fontSize: FONT.body, color: OPS_TEXT.secondary }}>{loadingText}</Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', maxWidth: 420, mx: 'auto' }}>
          {kind === 'noResults' ? (
            <SearchOffOutlinedIcon aria-hidden sx={{ fontSize: 26, color: '#8A8A90', mb: '4px' }} />
          ) : (
            <InboxOutlinedIcon aria-hidden sx={{ fontSize: 26, color: '#8A8A90', mb: '4px' }} />
          )}
          <Typography sx={{ fontSize: FONT.heading, fontWeight: 700, color: OPS_TEXT.primary }}>{title}</Typography>
          {hint && <Typography sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary, lineHeight: 1.5 }}>{hint}</Typography>}
        </Box>
      )}
    </TableCell>
  </TableRow>
);

type StatusPillTone = 'success' | 'danger' | 'warning' | 'neutral' | 'violet' | 'info';

const PILL_COLORS: Record<StatusPillTone, { background: string; color: string }> = {
  success: { background: '#DCFCE7', color: '#166534' },
  danger: { background: '#FEE2E2', color: '#991B1B' },
  warning: { background: '#FEF3C7', color: '#92400E' },
  neutral: { background: '#F1F3F4', color: '#4B5563' },
  violet: { background: '#EDE9FE', color: '#4C1D95' },
  info: { background: '#DBEAFE', color: '#1D4ED8' },
};

interface StatusPillProps {
  label: string;
  tone: StatusPillTone;
  /** A small icon in front, so the meaning does not depend on colour alone */
  icon?: React.ReactNode;
}

// A short status in a rounded pill: the words, a matching colour, and (for the ones that matter) an icon.
export const StatusPill: React.FC<StatusPillProps> = ({ label, tone, icon }) => (
  <Box
    component="span"
    sx={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      px: '10px',
      py: '3px',
      borderRadius: '999px',
      fontSize: FONT.small,
      fontWeight: 600,
      lineHeight: 1.4,
      whiteSpace: 'nowrap',
      backgroundColor: PILL_COLORS[tone].background,
      color: PILL_COLORS[tone].color,
    }}
  >
    {icon}
    {label}
  </Box>
);

interface ToneStatusPillProps {
  label: string;
  /** good news, waiting, a problem to fix, or just a fact (neutral, no icon) */
  tone: 'success' | 'warning' | 'danger' | 'neutral';
}

// A status pill whose icon follows its tone (a tick, a clock, an exclamation), so the meaning never depends on colour alone.
export const ToneStatusPill: React.FC<ToneStatusPillProps> = ({ label, tone }) => {
  if (tone === 'neutral') return <StatusPill label={label} tone={tone} />;
  const Icon = tone === 'success' ? CheckCircleIcon : tone === 'warning' ? ScheduleIcon : ErrorOutlineIcon;
  return <StatusPill label={label} tone={tone} icon={<Icon aria-hidden sx={{ fontSize: 13 }} />} />;
};

interface CellStackProps {
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  /** Secondary line in a smaller, quieter style (identifiers and references) */
  quiet?: boolean;
}

// Two lines in one cell: what it is, and a detail. Long words (e-mail, long identifiers) wrap instead of pushing the column wider.
export const CellStack: React.FC<CellStackProps> = ({ primary, secondary, quiet = false }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography component="div" sx={{ fontSize: FONT.body, fontWeight: 600, color: OPS_TEXT.primary, overflowWrap: 'anywhere' }}>{primary}</Typography>
    {secondary !== undefined && secondary !== null && secondary !== '' && (
      <Typography component="div" sx={{ fontSize: quiet ? FONT.caption : FONT.small, color: OPS_TEXT.secondary, mt: '1px', overflowWrap: 'anywhere' }}>{secondary}</Typography>
    )}
  </Box>
);

interface PersonCellProps {
  name: string;
  detail?: React.ReactNode;
}

// A person: the first letter in a circle, the name, and a line of details under it.
export const PersonCell: React.FC<PersonCellProps> = ({ name, detail }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
    <Avatar aria-hidden sx={{ width: 30, height: 30, flexShrink: 0, backgroundColor: 'var(--sakay-orange-soft)', color: OPS_TEXT.brand, fontSize: FONT.body, fontWeight: 700 }}>
      {name.charAt(0)}
    </Avatar>
    <CellStack primary={name} secondary={detail} />
  </Box>
);

