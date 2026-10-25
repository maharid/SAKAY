import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

import { FONT, SPACE } from '../../styles/density';
import { PAGE_DIVIDER, PAGE_TEXT, pageCardSx, rowActionSx } from '../../styles/pageTheme';

interface DashboardCardAction {
  label: string;
  /** The screen the button opens */
  to: string;
  /** Read out by a screen reader when the visible label alone would be unclear ("View all" of what?) */
  ariaLabel?: string;
}

interface DashboardCardProps {
  title: string;
  /** One quiet line under the title, only when the title alone is not enough */
  description?: string;
  action?: DashboardCardAction;
  /** Any other control that belongs in the corner of the card (a Refresh button); used when the card's one button does not just open a screen */
  actions?: React.ReactNode;
  /** A little extra next to the title (a count, a pill) */
  titleAdornment?: React.ReactNode;
  children: React.ReactNode;
}

// The frame every Dashboard card shares: a white card with the title on the left and the one button that opens the full screen on the right.
// The content fills the rest of the card, so cards in the same row end at the same line.
export const DashboardCard: React.FC<DashboardCardProps> = ({ title, description, action, actions, titleAdornment, children }) => (
  <Box component="section" aria-label={title} sx={{ ...pageCardSx, p: SPACE.cardLarge, display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, overflow: 'hidden' }}>
    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', mb: '14px' }}>
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <Typography component="h2" sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: PAGE_TEXT.primary }}>{title}</Typography>
          {titleAdornment}
        </Box>
        {description && <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '2px' }}>{description}</Typography>}
      </Box>
      {action && (
        <Button component={RouterLink} to={action.to} aria-label={action.ariaLabel} sx={rowActionSx('neutral')}>
          {action.label}
        </Button>
      )}
      {actions}
    </Box>
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</Box>
  </Box>
);

interface DashboardListProps {
  children: React.ReactNode;
}

// A short list inside a Dashboard card: one thin line between the rows, nothing else.
export const DashboardList: React.FC<DashboardListProps> = ({ children }) => (
  <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', '& > li + li': { borderTop: `1px solid ${PAGE_DIVIDER}` } }}>{children}</Box>
);

interface DashboardListItemProps {
  /** The screen the row opens */
  to: string;
  /** A small icon in front of the text (only where it tells the kind of record apart) */
  leading?: React.ReactNode;
  title: string;
  detail?: string;
  /** What is on the right of the row (a status) */
  trailing?: React.ReactNode;
}

// One row of a Dashboard list. The whole row is a link, so it can be reached and opened with the keyboard.
export const DashboardListItem: React.FC<DashboardListItemProps> = ({ to, leading, title, detail, trailing }) => (
  <Box component="li">
    <Box
      component={RouterLink}
      to={to}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        py: '10px',
        px: '8px',
        mx: '-8px',
        borderRadius: '8px',
        color: 'inherit',
        textDecoration: 'none',
        '&:hover': { backgroundColor: '#FAFAF8' },
        '&:focus-visible': { outline: `2px solid ${PAGE_TEXT.brand}`, outlineOffset: '-2px' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
        {leading}
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.primary, overflowWrap: 'anywhere' }}>{title}</Typography>
          {detail && <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '1px', overflowWrap: 'anywhere' }}>{detail}</Typography>}
        </Box>
      </Box>
      {trailing && <Box sx={{ flexShrink: 0 }}>{trailing}</Box>}
    </Box>
  </Box>
);

interface DashboardEmptyProps {
  icon: React.ReactNode;
  title: string;
  hint?: string;
}

// What a Dashboard card shows when it has nothing to list yet: a small icon, one line, and at most one line of explanation.
export const DashboardEmpty: React.FC<DashboardEmptyProps> = ({ icon, title, hint }) => (
  <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: '3px', py: '24px', '& > svg': { fontSize: 26, color: '#8A8A90', mb: '4px' } }}>
    {icon}
    <Typography sx={{ fontSize: FONT.heading, fontWeight: 700, color: PAGE_TEXT.primary }}>{title}</Typography>
    {hint && <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, lineHeight: 1.5, maxWidth: 320 }}>{hint}</Typography>}
  </Box>
);
