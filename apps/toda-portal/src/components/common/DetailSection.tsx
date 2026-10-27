import React from 'react';
import { Box, Typography } from '@mui/material';

import { FONT } from '../../styles/density';
import { OPS_TEXT } from '../operations/operationsTheme';

interface DetailSectionProps {
  /** A small icon in the brand colour, in front of the title */
  icon: React.ReactNode;
  title: string;
  /** Something at the right of the title (a count, a hint) */
  aside?: React.ReactNode;
  children: React.ReactNode;
}

// A titled block of a details window: an orange icon, the title, then the content. The same look as the LGU Portal's driver window.
export const DetailSection: React.FC<DetailSectionProps> = ({ icon, title, aside, children }) => (
  <Box component="section">
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', mb: '10px' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <Box aria-hidden sx={{ display: 'inline-flex', color: 'var(--sakay-orange)', '& svg': { fontSize: 19 } }}>{icon}</Box>
        <Typography component="h3" sx={{ fontSize: FONT.heading, fontWeight: 700, color: OPS_TEXT.primary }}>{title}</Typography>
      </Box>
      {aside}
    </Box>
    {children}
  </Box>
);

// Label and value pairs on a soft grey card, two to a row (one on a narrow window).
export const DetailGrid: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box
    sx={{
      display: 'grid',
      gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' },
      gap: '14px 16px',
      backgroundColor: '#F5F5F7',
      p: '16px',
      borderRadius: '12px',
    }}
  >
    {children}
  </Box>
);

interface DetailFieldProps {
  label: string;
  /** The text; empty shows "Not recorded" */
  value?: string | null;
  /** Shown after the value (a status pill, a hint) */
  children?: React.ReactNode;
  /** Spans the whole row */
  wide?: boolean;
}

export const DetailField: React.FC<DetailFieldProps> = ({ label, value, children, wide }) => {
  const missing = !value || value === 'N/A' || value === 'Not recorded';
  return (
    <Box sx={{ minWidth: 0, gridColumn: wide ? { sm: '1 / -1' } : undefined }}>
      <Typography sx={{ fontSize: FONT.small, color: 'var(--mac-text-muted)', mb: '3px' }}>{label}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 8px' }}>
        {(value !== undefined || !children) && (
          <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: missing ? OPS_TEXT.secondary : 'var(--mac-text-primary)', overflowWrap: 'anywhere' }}>
            {missing ? 'Not recorded' : value}
          </Typography>
        )}
        {children}
      </Box>
    </Box>
  );
};
