import React from 'react';
import { Alert, Box, Button, MenuItem, TextField } from '@mui/material';
import { NO_ANALYTICS_FILTER, filterProblem, isFiltered } from '@sakay/shared';
import type { AnalyticsFilter } from '@sakay/shared';

interface AnalyticsFilterBarProps {
  filter: AnalyticsFilter;
  onChange: (next: AnalyticsFilter) => void;
  todaOptions: Array<{ id: string; name: string }>;
  barangayOptions: string[];
}

/**
 * Checklist A9.22 - A9.24: the date range (Asia/Manila), the participating TODA and the barangay that every analytics figure and every report follows. The
 * filter is applied to the records the page already holds, so changing it is instant; "All" means no limit.
 */
export const AnalyticsFilterBar: React.FC<AnalyticsFilterBarProps> = ({ filter, onChange, todaOptions, barangayOptions }) => {
  const problem = filterProblem(filter);
  const set = (patch: Partial<AnalyticsFilter>) => onChange({ ...filter, ...patch });

  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}>
        <TextField size="small" type="date" label="From (Manila)" value={filter.from} onChange={(e) => set({ from: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} sx={{ width: 180 }} />
        <TextField size="small" type="date" label="To (Manila)" value={filter.to} onChange={(e) => set({ to: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} sx={{ width: 180 }} />
        <TextField select size="small" label="Participating TODA" value={filter.todaId} onChange={(e) => set({ todaId: e.target.value })} sx={{ width: 240 }}>
          <MenuItem value="">All TODAs</MenuItem>
          {todaOptions.map((t) => (
            <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="Barangay (pickup)" value={filter.barangay} onChange={(e) => set({ barangay: e.target.value })} sx={{ width: 240 }}>
          <MenuItem value="">All barangays</MenuItem>
          {barangayOptions.map((b) => (
            <MenuItem key={b} value={b}>{b}</MenuItem>
          ))}
        </TextField>
        <Button size="small" variant="text" disabled={!isFiltered(filter)} onClick={() => onChange(NO_ANALYTICS_FILTER)} sx={{ textTransform: 'none', fontWeight: 600 }}>
          Clear filters
        </Button>
      </Box>
      {problem && <Alert severity="warning" sx={{ mt: 1.5 }}>{problem}</Alert>}
    </Box>
  );
};
