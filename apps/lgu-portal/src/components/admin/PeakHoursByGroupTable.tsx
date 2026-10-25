import React from 'react';
import { Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { PEAK_HOURS_CORE_END, PEAK_HOURS_CORE_START } from '@sakay/shared';
import type { GroupPeakRow } from '@sakay/shared';

import { ChartEmpty } from '../common/ChartEmpty';
import { ChartTooltip } from '../common/ChartTooltip';
import { FONT } from '../../styles/density';
import { PAGE_TEXT, innerTableSx } from '../../styles/pageTheme';

interface PeakHoursByGroupTableProps {
  /** "TODA" or "Barangay" */
  groupLabel: string;
  rows: GroupPeakRow[];
  /** the figures could not be read (the empty message then says so) */
  failed?: boolean;
}

const HOURS = Array.from({ length: PEAK_HOURS_CORE_END - PEAK_HOURS_CORE_START + 1 }, (_, i) => PEAK_HOURS_CORE_START + i);
const hourLong = (h: number): string => `${h % 12 === 0 ? 12 : h % 12} ${h >= 12 ? 'PM' : 'AM'}`;

/**
 * Checklist A9.6: when each TODA (or barangay) is busiest and quietest. The strip shades each hour from 6 AM to 9 PM by its share of that group's busiest hour, so the
 * patterns of the groups can be read side by side. Each hour of the strip has a tooltip with its number of bookings.
 */
export const PeakHoursByGroupTable: React.FC<PeakHoursByGroupTableProps> = ({ groupLabel, rows, failed = false }) => {
  if (rows.length === 0) {
    return <ChartEmpty failed={failed} title="No bookings match the filter" hint="Try a wider date range, or clear the filters." minHeight={120} />;
  }
  return (
    <>
      <TableContainer role="region" aria-label={`Peak hours by ${groupLabel}, scrollable`} tabIndex={0} sx={innerTableSx}>
        <Table size="small" sx={{ minWidth: 620 }}>
          <TableHead>
            <TableRow>
              <TableCell>{groupLabel}</TableCell>
              <TableCell>Bookings</TableCell>
              <TableCell>Busiest hour</TableCell>
              <TableCell>Quietest hour (6 AM - 9 PM)</TableCell>
              <TableCell>By hour (6 AM - 9 PM)</TableCell>
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
                    <Box role="img" aria-label={`${r.group}, bookings by hour: ${HOURS.map((h) => `${hourLong(h)} ${r.hours[h]}`).join(', ')}`} sx={{ display: 'flex', gap: '2px' }}>
                      {HOURS.map((h) => (
                        <ChartTooltip key={h} title={`${r.group}, ${hourLong(h)}`} lines={[`${r.hours[h]} booking${r.hours[h] === 1 ? '' : 's'}`]}>
                          <Box
                            sx={{ width: 14, height: 18, borderRadius: '3px', backgroundColor: r.hours[h] > 0 ? 'var(--sakay-orange)' : '#EEEEF0', opacity: r.hours[h] > 0 ? 0.25 + 0.75 * (r.hours[h] / top) : 1 }}
                          />
                        </ChartTooltip>
                      ))}
                    </Box>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '8px' }}>In the hour strip, a darker hour has more bookings. Point at an hour to see its number.</Typography>
    </>
  );
};
