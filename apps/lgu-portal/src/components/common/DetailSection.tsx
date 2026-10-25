import React from 'react';
import { Box, Typography } from '@mui/material';

import { FONT } from '../../styles/density';
import { PAGE_BORDER, PAGE_TEXT } from '../../styles/pageTheme';

interface DetailSectionProps {
  title: string;
  /** A short count or note next to the title, e.g. "3 files" */
  note?: string;
  children: React.ReactNode;
}

// One block of a record's detail window (organization, officers, documents ...): a plain heading in sentence case and the content under it.
export const DetailSection: React.FC<DetailSectionProps> = ({ title, note, children }) => (
  <Box component="section" sx={{ mb: '20px', '&:last-child': { mb: 0 } }}>
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '8px', mb: '8px' }}>
      <Typography component="h3" sx={{ fontSize: FONT.heading, fontWeight: 700, color: PAGE_TEXT.primary }}>{title}</Typography>
      {note && <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary }}>{note}</Typography>}
    </Box>
    {children}
  </Box>
);

interface DetailGridProps {
  children: React.ReactNode;
}

// The facts of a record as labelled values in two columns (one column on a narrow window).
export const DetailGrid: React.FC<DetailGridProps> = ({ children }) => (
  <Box
    sx={{
      display: 'grid',
      gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' },
      gap: '12px 16px',
      p: '14px 16px',
      borderRadius: '12px',
      border: `1px solid ${PAGE_BORDER}`,
      backgroundColor: '#FAFAF8',
    }}
  >
    {children}
  </Box>
);

interface DetailFieldProps {
  label: string;
  children: React.ReactNode;
}

// A label with its value under it. The label is quiet, the value is what the eye should land on.
export const DetailField: React.FC<DetailFieldProps> = ({ label, children }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mb: '2px' }}>{label}</Typography>
    <Typography component="div" sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.primary, overflowWrap: 'anywhere' }}>{children}</Typography>
  </Box>
);
