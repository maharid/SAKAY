import React from 'react';
import { Box, Typography } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

import { FONT, SPACE } from '../../styles/density';
import { OPS_TEXT, opsCardSx } from './operationsTheme';

// A routine reminder, not an alert: a calm panel at the bottom of the page.
// It spans the page like the sections above it. The heading sits in a narrow column on the left and the two sentences of the policy sit side by side
// in the remaining width (each about 60-80 characters wide), so no line runs across the whole screen. On a narrow screen everything stacks.
export const FarePolicyNote: React.FC = () => (
  <Box component="aside" aria-labelledby="fare-policy-heading" sx={{ containerType: 'inline-size' }}>
    <Box
      sx={{
        ...opsCardSx,
        p: SPACE.card,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr)',
        gap: '10px 26px',
        alignItems: 'start',
        '@container (min-width: 608px)': { gridTemplateColumns: '141px minmax(0, 1fr)' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <InfoOutlinedIcon aria-hidden sx={{ color: OPS_TEXT.brand, fontSize: 18, flexShrink: 0 }} />
        <Typography id="fare-policy-heading" component="h2" sx={{ fontSize: FONT.heading, fontWeight: 700, color: OPS_TEXT.primary }}>Fare policy</Typography>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: '6px 32px',
          '@container (min-width: 784px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
        }}
      >
        <Typography sx={{ fontSize: FONT.body, lineHeight: 1.6, color: OPS_TEXT.secondary, maxWidth: '80ch' }}>
          SAKAY fares follow the approved city fare matrix (City Ordinance No. 110, Series of 2022): ₱15 minimum base fare for the first 2.0 km.
        </Typography>
        <Typography sx={{ fontSize: FONT.body, lineHeight: 1.6, color: OPS_TEXT.secondary, maxWidth: '80ch' }}>
          Charging a fare that does not follow the approved policy is subject to administrative review and sanctions.
        </Typography>
      </Box>
    </Box>
  </Box>
);
