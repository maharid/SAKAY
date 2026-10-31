import React from 'react';
import Box from '@mui/material/Box';
import ListItemButton from '@mui/material/ListItemButton';
import Typography from '@mui/material/Typography';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

import { PortalNoticeIcon } from './PortalNoticeIcon';

export interface PortalNoticeRowProps {
  /** The notice's type: it decides the icon */
  type: string | null | undefined;
  title: string;
  description?: string;
  /** "5 min ago" / the date: already written in the selected language */
  time?: string;
  unread?: boolean;
  /** The accessible name of the unread mark ("Unread") */
  unreadLabel?: string;
  /** Opens the record the notice is about (it also marks the notice as read) */
  onOpen: () => void;
}

/**
 * One notice in the bell panel of the LGU and the TODA portal: the icon of its kind on the left, the title, the text and the time, and at the UPPER RIGHT the unread dot and a
 * right-facing arrow that says the row opens something. Everything is aligned to the top of the row, so a long notice does not push the icons to its middle.
 * Pressing the row opens the page or the record the notice is about.
 */
export const PortalNoticeRow: React.FC<PortalNoticeRowProps> = ({ type, title, description, time, unread = false, unreadLabel = 'Unread', onOpen }) => (
  <ListItemButton
    disableRipple
    onClick={onOpen}
    sx={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: '12px',
      px: '16px',
      py: '11px',
      backgroundColor: unread ? 'rgba(255, 102, 0, 0.04)' : 'transparent',
      '&:hover': { backgroundColor: 'var(--mac-canvas-bg, #F5F5F7)' },
      '&:focus-visible': { outline: '2px solid #B34700', outlineOffset: '-2px' },
    }}
  >
    <PortalNoticeIcon type={type} />
    <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
      <Typography component="div" sx={{ fontSize: '12.5px', fontWeight: unread ? 700 : 500, color: 'var(--mac-text-primary, #1d1d1f)', overflowWrap: 'anywhere', lineHeight: 1.35, mb: '2px' }}>
        {title}
      </Typography>
      {description && (
        <Typography component="div" sx={{ fontSize: '12px', color: 'var(--mac-text-secondary, #4d4d52)', lineHeight: 1.4, overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {description}
        </Typography>
      )}
      {time && (
        <Typography component="div" sx={{ fontSize: '11.5px', color: '#65656a', mt: '3px' }}>
          {time}
        </Typography>
      )}
    </Box>
    <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '6px', alignSelf: 'flex-start', height: 34 }}>
      {unread && <Box component="span" role="img" aria-label={unreadLabel} sx={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: 'var(--sakay-orange, #FF6600)' }} />}
      <ChevronRightIcon aria-hidden sx={{ color: '#94A3B8', fontSize: 22 }} />
    </Box>
  </ListItemButton>
);
