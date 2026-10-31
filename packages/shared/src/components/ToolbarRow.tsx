import React from 'react';
import { Box } from '@mui/material';

export interface ToolbarRowProps {
  /** The search and filter card (a FilterToolbar with its bottom margin off). It takes the width that is left and the full height of the row. */
  children: React.ReactNode;
  /** A card of its own beside it: the export, or the page's actions (a ToolbarSideCard, or an ExportToolbar with appearance="panel") */
  side: React.ReactNode;
  /** Space under the row, in pixels */
  marginBottom?: number;
}

/**
 * The search and filter card with a second card BESIDE it (the export, or Send reminders and New announcement), the same height, with the same gap on every page. When the page is too narrow for both
 * (a phone), the second card goes under the first. The two cards keep their own look: this only lays them out.
 */
export const ToolbarRow: React.FC<ToolbarRowProps> = ({ children, side, marginBottom = 22 }) => (
  <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', gap: '14px', mb: `${marginBottom}px` }}>
    <Box sx={{ flex: '1 1 460px', minWidth: 0, display: 'flex', flexDirection: 'column', '& > *': { flex: 1, mb: '0 !important' } }}>{children}</Box>
    <Box sx={{ flex: '0 0 auto', maxWidth: '100%', display: 'flex', '& > *': { flex: 1 } }}>{side}</Box>
  </Box>
);

export interface ToolbarSideCardProps {
  children: React.ReactNode;
  /** Names the group for assistive technology ("Export", "Announcement actions") */
  label: string;
}

/** The card beside the filter card: the same border, radius, shadow and padding as the filter card, its controls in one row that wraps. */
export const ToolbarSideCard: React.FC<ToolbarSideCardProps> = ({ children, label }) => (
  <Box
    component="section"
    aria-label={label}
    sx={{
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: '10px 14px',
      p: 1.6,
      borderRadius: 'var(--mac-radius-lg, 14px)',
      border: '1px solid var(--mac-border-color, rgba(15, 23, 42, 0.12))',
      backgroundColor: '#FFFFFF',
      boxShadow: 'var(--mac-shadow-card, 0 1px 3px rgba(15, 23, 42, 0.08))',
    }}
  >
    {children}
  </Box>
);
