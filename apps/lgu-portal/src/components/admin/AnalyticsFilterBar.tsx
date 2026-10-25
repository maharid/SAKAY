import React from 'react';
import { Box, Button, MenuItem, TextField, Typography } from '@mui/material';
import { NO_ANALYTICS_FILTER, filterProblem, isFiltered } from '@sakay/shared';
import type { AnalyticsFilter } from '@sakay/shared';

import { FONT, SPACE } from '../../styles/density';
import { PAGE_TEXT, pageCardSx, rowActionSx } from '../../styles/pageTheme';

interface AnalyticsFilterBarProps {
  filter: AnalyticsFilter;
  onChange: (next: AnalyticsFilter) => void;
  todaOptions: Array<{ id: string; name: string }>;
  barangayOptions: string[];
  /** Buttons that belong with the filters on the right (a Refresh button) */
  actions?: React.ReactNode;
}

// The fields share the row: each is at least 150px wide and grows to fill the space, so the bar also works beside an open sidebar
const FIELD_SX = { flex: '1 1 160px', minWidth: 150, maxWidth: 260 } as const;

/**
 * Checklist A9.22 - A9.24: the date range (Asia/Manila), the participating TODA and the barangay that every analytics figure and every report follows. The
 * filter is applied to the records the page already holds, so changing it is instant; "All" means no limit.
 */
export const AnalyticsFilterBar: React.FC<AnalyticsFilterBarProps> = ({ filter, onChange, todaOptions, barangayOptions, actions }) => {
  const problem = filterProblem(filter);
  const set = (patch: Partial<AnalyticsFilter>) => onChange({ ...filter, ...patch });

  return (
    <Box component="section" aria-label="Filters" sx={{ ...pageCardSx, p: '12px 16px', mb: SPACE.gapLarge }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 12px' }}>
        <TextField size="small" type="date" label="From (Manila)" value={filter.from} onChange={(e) => set({ from: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} sx={FIELD_SX} />
        <TextField size="small" type="date" label="To (Manila)" value={filter.to} onChange={(e) => set({ to: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} sx={FIELD_SX} />
        <TextField select size="small" label="Participating TODA" value={filter.todaId} onChange={(e) => set({ todaId: e.target.value })} sx={FIELD_SX}>
          <MenuItem value="">All TODAs</MenuItem>
          {todaOptions.map((t) => (
            <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="Barangay (pickup)" value={filter.barangay} onChange={(e) => set({ barangay: e.target.value })} sx={FIELD_SX}>
          <MenuItem value="">All barangays</MenuItem>
          {barangayOptions.map((b) => (
            <MenuItem key={b} value={b}>{b}</MenuItem>
          ))}
        </TextField>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', ml: { sm: 'auto' } }}>
          <Button disabled={!isFiltered(filter)} onClick={() => onChange(NO_ANALYTICS_FILTER)} sx={rowActionSx('neutral')}>
            Clear filters
          </Button>
          {actions}
        </Box>
      </Box>
      {problem && (
        <Typography role="alert" sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.warning, mt: '10px' }}>{problem}</Typography>
      )}
    </Box>
  );
};
