import React from 'react';
import { Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { PEAK_HOURS_CORE_END, PEAK_HOURS_CORE_START } from '@sakay/shared';
import type { GroupPeakRow } from '@sakay/shared';

interface PeakHoursByGroupTableProps {
  /** "TODA" or "Barangay" */
  groupLabel: string;
  rows: GroupPeakRow[];
}

const HOURS = Array.from({ length: PEAK_HOURS_CORE_END - PEAK_HOURS_CORE_START + 1 }, (_, i) => PEAK_HOURS_CORE_START + i);
const hourShort = (h: number): string => `${h % 12 === 0 ? 12 : h % 12}${h >= 12 ? 'p' : 'a'}`;

/**
 * Checklist A9.6: when each TODA (or barangay) is busiest and quietest. The strip shades each hour from 6 AM to 9 PM by its share of that group's busiest hour, so the
 * patterns of the groups can be read side by side.
 */
export const PeakHoursByGroupTable: React.FC<PeakHoursByGroupTableProps> = ({ groupLabel, rows }) => {
  if (rows.length === 0) {
    return <Typography sx={{ fontSize: '11.3px', color: 'var(--mac-text-muted)' }}>No bookings match the filter.</Typography>;
  }
  return (
    <TableContainer>
      <Table size="small">
        <TableHead sx={{ backgroundColor: '#FAFAFC' }}>
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>{groupLabel.toUpperCase()}</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>BOOKINGS</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>BUSIEST HOUR</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>QUIETEST HOUR (6 AM - 9 PM)</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>BY HOUR (6 AM - 9 PM)</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => {
            const top = Math.max(1, ...r.hours.slice(PEAK_HOURS_CORE_START, PEAK_HOURS_CORE_END + 1));
            return (
              <TableRow key={r.group}>
                <TableCell sx={{ fontWeight: 600 }}>{r.group}</TableCell>
                <TableCell>{r.total}</TableCell>
                <TableCell>{r.peakHour ? `${r.peakHour} (${r.peakCount})` : '-'}</TableCell>
                <TableCell>{r.quietHour ? `${r.quietHour} (${r.quietCount})` : '-'}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: '2px' }}>
                    {HOURS.map((h) => (
                      <Box
                        key={h}
                        title={`${hourShort(h)}: ${r.hours[h]} booking${r.hours[h] === 1 ? '' : 's'}`}
                        sx={{ width: 14, height: 18, borderRadius: '3px', backgroundColor: r.hours[h] > 0 ? 'var(--sakay-orange)' : '#F0F0F2', opacity: r.hours[h] > 0 ? 0.25 + 0.75 * (r.hours[h] / top) : 1 }}
                      />
                    ))}
                  </Box>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
};
