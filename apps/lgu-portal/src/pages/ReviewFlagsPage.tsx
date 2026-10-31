import React, { useState } from 'react';
import { Box } from '@mui/material';

import { ReviewFlagsPanel } from '../components/dashboard/ReviewFlagsPanel';
import { SegmentedToggle } from '../components/common/SegmentedToggle';
import type { SegmentedOption } from '../components/common/SegmentedToggle';
import { SPACE } from '../styles/density';

const VIEW_OPTIONS: SegmentedOption<'open' | 'resolved'>[] = [
  { value: 'open', label: 'Waiting for a decision' },
  { value: 'resolved', label: 'Resolved' },
];

/** Every review flag, not only the first five of the Dashboard: the ones waiting for an administrator, and the ones already resolved */
export const ReviewFlagsPage: React.FC = () => {
  const [view, setView] = useState<'open' | 'resolved'>('open');
  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 4.8 }}>
      <Box sx={{ mb: SPACE.gap }}>
        <SegmentedToggle label="Which flags" value={view} options={VIEW_OPTIONS} onChange={setView} />
      </Box>
      <ReviewFlagsPanel key={view} view={view} showWhenEmpty />
    </Box>
  );
};
