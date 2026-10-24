import React from 'react';
import { Box, Typography } from '@mui/material';

import { FONT } from '../../styles/density';
import { OPS_DIVIDER, OPS_TEXT } from '../operations/operationsTheme';

interface SettingRowProps {
  title: string;
  /** One or two plain sentences under the title */
  description?: React.ReactNode;
  /** The one control of this setting (a drop-down, a switch, a button), kept on the right */
  control?: React.ReactNode;
  /** More under the row (a note after an action) */
  children?: React.ReactNode;
}

// One setting of a Settings panel: the name and what it does on the left, its control on the right, both centred on the same line.
// The row measures its own width: when it is narrow (a phone, a zoomed-in page) the control moves under the text instead of squeezing it.
export const SettingRow: React.FC<SettingRowProps> = ({ title, description, control, children }) => (
  <Box sx={{ containerType: 'inline-size', py: '16px' }}>
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr)',
        alignItems: 'center',
        gap: '12px 24px',
        '@container (min-width: 520px)': { gridTemplateColumns: control ? 'minmax(0, 1fr) auto' : 'minmax(0, 1fr)' },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography component="h3" sx={{ fontSize: FONT.heading, fontWeight: 700, color: OPS_TEXT.primary, lineHeight: 1.35 }}>{title}</Typography>
        {description && (
          <Typography component="div" sx={{ fontSize: FONT.body, color: OPS_TEXT.secondary, lineHeight: 1.5, mt: '2px', overflowWrap: 'anywhere' }}>{description}</Typography>
        )}
      </Box>
      {control && (
        <Box
          sx={{
            justifySelf: { xs: 'start' },
            '@container (min-width: 520px)': { justifySelf: 'end' },
            minWidth: 0,
            maxWidth: '100%',
            // a button with a long name wraps on a very narrow screen instead of sticking out of the card
            '& .MuiButton-root': { maxWidth: '100%', whiteSpace: 'normal', lineHeight: 1.3 },
          }}
        >
          {control}
        </Box>
      )}
    </Box>
    {children}
  </Box>
);

interface SettingFactProps {
  label: string;
  children: React.ReactNode;
}

// One fact of an information panel (About): a label and its value. Side by side when there is room, stacked when there is not.
export const SettingFact: React.FC<SettingFactProps> = ({ label, children }) => (
  <Box sx={{ containerType: 'inline-size', py: '14px' }}>
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '2px 24px', '@container (min-width: 520px)': { gridTemplateColumns: '160px minmax(0, 1fr)' } }}>
      <Typography component="dt" sx={{ fontSize: FONT.body, fontWeight: 600, color: OPS_TEXT.secondary }}>{label}</Typography>
      <Typography component="dd" sx={{ m: 0, fontSize: FONT.body, color: OPS_TEXT.primary, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{children}</Typography>
    </Box>
  </Box>
);

// The rows of a panel, with a thin line between them
export const settingsListSx = { '& > * + *': { borderTop: `1px solid ${OPS_DIVIDER}` } } as const;
