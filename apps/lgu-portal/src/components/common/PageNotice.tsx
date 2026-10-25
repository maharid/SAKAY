import React from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

import { FONT, SPACE } from '../../styles/density';
import { PAGE_BORDER, PAGE_TEXT, pageFocusRing } from '../../styles/pageTheme';

interface PageNoticeProps {
  /** info: a rule or reminder that is always true (calm). warning: something needs attention. danger: something is overdue or at risk. */
  tone?: 'info' | 'warning' | 'danger';
  /** The bold first line. Leave it out when the message is a single sentence. */
  title?: string;
  /** The button that takes the reader to where the problem is handled. On a narrow notice it moves under the text instead of squeezing it. */
  action?: React.ReactNode;
  /** Shows a close button; the page decides what hiding the notice means */
  onDismiss?: () => void;
  children: React.ReactNode;
}

const LOOK = {
  info: { border: PAGE_BORDER, background: '#FFFFFF', icon: PAGE_TEXT.brand },
  warning: { border: '#FCD34D', background: '#FFFBEB', icon: '#92400E' },
  danger: { border: '#FCA5A5', background: '#FEF2F2', icon: '#B91C1C' },
} as const;

const ICON = { info: InfoOutlinedIcon, warning: WarningAmberIcon, danger: ErrorOutlineIcon } as const;

// A short notice on a page (the same as the TODA portal's): an icon, a heading and one or two sentences, and the button that handles it on the right.
// The same look for every alert on the Dashboard, so none of them shouts louder than the others. The layout follows the width of the notice itself (not the
// screen), so it also works when the sidebar is open or closed: icon | text | button on a wide notice; the button under the text on a narrow one.
export const PageNotice: React.FC<PageNoticeProps> = ({ tone = 'info', title, action, onDismiss, children }) => {
  const look = LOOK[tone];
  const Icon = ICON[tone];
  const hasSide = Boolean(action) || Boolean(onDismiss);
  return (
    <Box
      role={tone === 'info' ? 'note' : 'status'}
      sx={{
        containerType: 'inline-size',
        mb: SPACE.gapLarge,
        borderRadius: SPACE.cardRadius,
        border: `1px solid ${look.border}`,
        backgroundColor: look.background,
      }}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'auto minmax(0, 1fr)',
          alignItems: 'start',
          columnGap: '10px',
          rowGap: '10px',
          p: SPACE.card,
          '@container (min-width: 640px)': { gridTemplateColumns: hasSide ? 'auto minmax(0, 1fr) auto' : 'auto minmax(0, 1fr)', columnGap: '12px', alignItems: 'center' },
        }}
      >
        <Icon aria-hidden sx={{ color: look.icon, fontSize: 18, mt: '1px' }} />
        <Box sx={{ minWidth: 0 }}>
          {title && <Typography component="h2" sx={{ fontSize: FONT.heading, fontWeight: 700, color: PAGE_TEXT.primary }}>{title}</Typography>}
          <Typography component="div" sx={{ fontSize: FONT.body, lineHeight: 1.55, color: PAGE_TEXT.secondary, mt: title ? '2px' : 0 }}>{children}</Typography>
        </Box>
        {hasSide && (
          <Box
            sx={{
              gridColumn: 2,
              justifySelf: 'start',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              '@container (min-width: 640px)': { gridColumn: 3, justifySelf: 'end' },
            }}
          >
            {action}
            {onDismiss && (
              <IconButton
                onClick={onDismiss}
                aria-label={title ? `Hide notice: ${title}` : 'Hide this notice'}
                size="small"
                sx={{ width: 32, height: 32, color: PAGE_TEXT.secondary, '@media (pointer: coarse)': { width: 44, height: 44 }, ...pageFocusRing, '&:hover': { backgroundColor: 'rgba(15, 23, 42, 0.06)' } }}
              >
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};
