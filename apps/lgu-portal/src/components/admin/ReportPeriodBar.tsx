import React from 'react';
import { Box, Button, IconButton, Typography } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

import { DateField } from '../common/DateField';
import { SegmentedToggle } from '../common/SegmentedToggle';
import type { SegmentedOption } from '../common/SegmentedToggle';
import type { ReportPeriodState } from '../../hooks/useReportPeriod';
import { FONT } from '../../styles/density';
import { PAGE_TEXT, rowActionSx } from '../../styles/pageTheme';
import type { ReportScope } from '@sakay/shared';

const OPTIONS: SegmentedOption<ReportScope>[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'custom', label: 'Custom range' },
];

/**
 * Decision D-P6: Day shows ONE day, Week ONE week, Month ONE month; the arrows move to the period before or after, and a date can be jumped to. "Custom range" shows
 * the From / To dates of the filter bar instead.
 */
export const ReportPeriodBar: React.FC<{ period: ReportPeriodState }> = ({ period }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 12px' }}>
    <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.primary }}>Report period</Typography>
    <SegmentedToggle label="Report period" value={period.scope} options={OPTIONS} onChange={period.setScope} />
    {period.range && (
      <>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          <IconButton size="small" aria-label={`Previous ${period.scope}`} onClick={() => period.step(-1)}>
            <ChevronLeftIcon fontSize="small" />
          </IconButton>
          <Typography role="status" sx={{ fontSize: FONT.body, fontWeight: 700, color: PAGE_TEXT.primary, minWidth: 150, textAlign: 'center' }}>{period.range.label}</Typography>
          <IconButton size="small" aria-label={`Next ${period.scope}`} disabled={!period.canStepForward} onClick={() => period.step(1)}>
            <ChevronRightIcon fontSize="small" />
          </IconButton>
        </Box>
        <DateField label="Go to date (Manila)" value={period.anchor} onChange={(v) => v && period.setAnchor(v)} sx={{ width: 180 }} />
        <Button onClick={period.today} sx={rowActionSx('neutral')}>
          Today
        </Button>
      </>
    )}
  </Box>
);
