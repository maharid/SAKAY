import React from 'react';
import { Typography } from '@mui/material';
import { FONT } from '../../styles/density';
import { PAGE_TEXT } from '../../styles/pageTheme';

interface PilotCoverageNoteProps {
  /** A shorter wording for a place where the note sits right under the numbers (the Dashboard) */
  compact?: boolean;
}

/** Chapter 1 scope, stated wherever a figure is shown: the numbers describe SAKAY bookings of the pilot, not Calapan's transport demand (checklist A9.25). */
export const PilotCoverageNote: React.FC<PilotCoverageNoteProps> = ({ compact = false }) =>
  compact ? (
    <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, lineHeight: 1.5 }}>
      Figures count SAKAY bookings only. The pilot covers one TODA in one barangay, so they describe the pilot, not all of Calapan City. They show past activity and do not predict future demand.
    </Typography>
  ) : (
    <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)', lineHeight: 1.5 }}>
      These figures come from SAKAY bookings only. The pilot covers one TODA in one barangay, so they describe the pilot, not the transport demand of Calapan City as a whole.
      Descriptive analytics only: nothing here predicts future demand.
    </Typography>
  );
