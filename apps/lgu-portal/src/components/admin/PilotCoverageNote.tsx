import React from 'react';
import { Typography } from '@mui/material';

/** Chapter 1 scope, stated wherever a figure is shown: the numbers describe SAKAY bookings of the pilot, not Calapan's transport demand (checklist A9.25). */
export const PilotCoverageNote: React.FC = () => (
  <Typography sx={{ fontSize: '10.8px', color: 'var(--mac-text-muted)', lineHeight: 1.5 }}>
    These figures come from SAKAY bookings only. The pilot covers one TODA in one barangay, so they describe the pilot, not the transport demand of Calapan City as a whole.
    Descriptive analytics only: nothing here predicts future demand.
  </Typography>
);
