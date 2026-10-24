import React from 'react';
import { Box, Typography } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

import { FONT, SPACE } from '../../styles/density';
import { OPS_BORDER, OPS_TEXT } from '../operations/operationsTheme';

interface PageNoticeProps {
  /** info: a rule or reminder that is always true (calm). warning: something needs attention now. success: something you just did worked. */
  tone?: 'info' | 'warning' | 'success';
  /** The bold first line. Leave it out when the message is a single sentence. */
  title?: string;
  /** A short pill on the right (a deadline, a count). On a narrow notice it moves under the text instead of squeezing it. */
  badge?: React.ReactNode;
  children: React.ReactNode;
}

const LOOK = {
  info: { border: OPS_BORDER, background: '#FFFFFF', icon: OPS_TEXT.brand },
  warning: { border: '#FCD34D', background: '#FFFBEB', icon: '#92400E' },
  success: { border: '#86EFAC', background: '#F0FDF4', icon: '#166534' },
} as const;

const ICON = { info: InfoOutlinedIcon, warning: WarningAmberIcon, success: CheckCircleOutlineIcon } as const;

// A short notice at the top of a page: an icon, a heading and one or two sentences, and optionally a pill on the right. Always visible, never louder than it needs to be.
// The text takes all the width the notice has. The layout follows the width of the notice itself (not the screen), so it also works when the sidebar is open or closed:
// icon | text | pill on a wide notice; icon | text with the pill under the text on a narrow one.
export const PageNotice: React.FC<PageNoticeProps> = ({ tone = 'info', title, badge, children }) => {
  const look = LOOK[tone];
  const Icon = ICON[tone];
  return (
    <Box
      role={tone === 'success' ? 'status' : 'note'}
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
          '@container (min-width: 700px)': { gridTemplateColumns: badge ? 'auto minmax(0, 1fr) auto' : 'auto minmax(0, 1fr)', columnGap: '12px' },
        }}
      >
        <Icon aria-hidden sx={{ color: look.icon, fontSize: 18, mt: '1px' }} />
        <Box sx={{ minWidth: 0 }}>
          {title && <Typography component="h2" sx={{ fontSize: FONT.heading, fontWeight: 700, color: OPS_TEXT.primary }}>{title}</Typography>}
          <Typography component="div" sx={{ fontSize: FONT.body, lineHeight: 1.55, color: OPS_TEXT.secondary, mt: title ? '2px' : 0 }}>{children}</Typography>
        </Box>
        {badge && (
          <Box sx={{ gridColumn: 2, justifySelf: 'start', '@container (min-width: 700px)': { gridColumn: 3, justifySelf: 'end', alignSelf: 'center' } }}>{badge}</Box>
        )}
      </Box>
    </Box>
  );
};
