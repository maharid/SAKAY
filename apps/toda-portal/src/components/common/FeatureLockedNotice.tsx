import React from 'react';
import { Box, Typography } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';

import { FONT, SPACE } from '../../styles/density';
import { OPS_TEXT, opsCardSx } from '../operations/operationsTheme';

// What a page shows while the TODA is not yet accredited and the feature cannot be used. The words are the same ones the pages used before.
export const FeatureLockedNotice: React.FC = () => (
  <Box role="status" sx={{ ...opsCardSx, textAlign: 'center', p: SPACE.cardLarge, py: '38px', mt: '13px' }}>
    <LockOutlinedIcon aria-hidden sx={{ fontSize: 30, color: '#8A8A90', mb: '8px' }} />
    <Typography component="h2" sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: OPS_TEXT.primary }}>Feature Unavailable</Typography>
    <Typography sx={{ fontSize: FONT.body, color: OPS_TEXT.secondary, mt: '4px', maxWidth: 400, mx: 'auto', lineHeight: 1.55 }}>
      This feature will become available once your TODA has been approved and accredited by the LGU.
    </Typography>
  </Box>
);
