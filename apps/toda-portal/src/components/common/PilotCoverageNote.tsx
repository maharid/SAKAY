import React from 'react';
import { Typography } from '@mui/material';

/** What every TODA report covers, said where the figures are shown (checklist B5): this TODA's own SAKAY bookings, in the pilot. */
export const PILOT_COVERAGE_TEXT =
  "These figures cover only your TODA's own SAKAY bookings. The pilot covers one TODA in one barangay, so they are not figures for all tricycle trips in Calapan City. Descriptive only: nothing here predicts future demand.";

export const PilotCoverageNote: React.FC = () => (
  <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)', lineHeight: 1.5 }}>{PILOT_COVERAGE_TEXT}</Typography>
);
