import React from 'react';
import { Box, Button, Divider, List, ListItem, ListItemButton, Popover, Typography } from '@mui/material';

import { notificationPanelText } from '@sakay/shared';

import { NotificationItem } from '../../types/admin';
import { useLanguage } from '../../hooks/useLanguage';
import { FONT } from '../../styles/density';

interface NotificationPopoverProps {
  open: boolean;
  /** the bell the panel opens under */
  anchorEl: HTMLElement | null;
  onClose: () => void;
  notifications: NotificationItem[];
  onMarkAllAsRead: () => void;
  onNotificationClick?: (item: NotificationItem) => void;
  /** the first reading of the notices has not finished yet */
  loading?: boolean;
  /** the notices could not be read */
  failed?: boolean;
}

// Some notices arrive in ALL CAPITALS (they are written from a database action name): shown in normal sentence case so they are easy to read.
const readable = (title: string): string =>
  /[A-Z]/.test(title) && title === title.toUpperCase() ? title.charAt(0) + title.slice(1).toLowerCase() : title;

// A message that stands in for the list (nothing yet, still loading, could not load), in the same spot and type as the TODA portal's empty state
const ListMessage: React.FC<{ title: string; hint?: string; role?: 'status' | 'alert' }> = ({ title, hint, role }) => (
  <Box role={role} sx={{ p: '26px', textAlign: 'center' }}>
    <Typography sx={{ fontSize: FONT.body, color: '#65656a' }}>{title}</Typography>
    {hint && <Typography sx={{ fontSize: FONT.small, color: '#65656a', mt: '2px' }}>{hint}</Typography>}
  </Box>
);

// The notification panel, the same as the TODA portal's (layout, width, spacing, type, borders, shadow, rows and the read control). It opens under the bell, is never wider or
// taller than the screen, and scrolls its list while the title row stays in view. What stays LGU: a row is a button that opens the notice's page (onNotificationClick).
export const NotificationPopover: React.FC<NotificationPopoverProps> = ({
  open,
  anchorEl,
  onClose,
  notifications,
  onMarkAllAsRead,
  onNotificationClick,
  loading = false,
  failed = false,
}) => {
  const { language } = useLanguage();
  const text = notificationPanelText(language);
  return (
  <Popover
    open={open}
    anchorEl={anchorEl}
    onClose={onClose}
    anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
    transformOrigin={{ vertical: 'top', horizontal: 'right' }}
    slotProps={{
      paper: {
        className: 'mac-glass-popover',
        sx: {
          mt: '8px',
          // never wider or taller than the screen: 320 x 368 on a desktop, shrinking on a phone or a short window
          width: 320,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'min(368px, calc(100dvh - 80px))',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 'var(--mac-radius-lg)',
          boxShadow: 'var(--mac-shadow-popover)',
          overflow: 'hidden',
        },
      },
    }}
  >
    <Box sx={{ p: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, flexShrink: 0, borderBottom: '1px solid var(--mac-border-color)' }}>
      <Typography component="h2" sx={{ fontSize: FONT.heading, fontWeight: 700, color: 'var(--mac-text-primary)' }}>
        {text.lguTitle}
      </Typography>
      <Button
        size="small"
        onClick={onMarkAllAsRead}
        sx={{
          fontSize: FONT.small,
          textTransform: 'none',
          color: '#B34700',
          fontWeight: 600,
          p: '4px 8px',
          mr: '-8px',
          minWidth: 0,
          flexShrink: 0,
          '@media (pointer: coarse)': { minHeight: 44 },
          '&:focus-visible': { outline: '2px solid #B34700', outlineOffset: '1px' },
        }}
      >
        {text.markAll}
      </Button>
    </Box>

    {/* the list scrolls inside the panel; the title row above stays in view */}
    <List sx={{ p: 0, flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
      {loading && notifications.length === 0 ? (
        <ListMessage role="status" title={text.loading} />
      ) : failed && notifications.length === 0 ? (
        <ListMessage role="alert" title={text.failed} hint={text.failedHint} />
      ) : notifications.length === 0 ? (
        <ListMessage title={text.empty} />
      ) : (
        notifications.map((item, idx) => (
          <React.Fragment key={item.id}>
            <ListItem disablePadding>
              <ListItemButton
                disableRipple
                onClick={() => {
                  if (onNotificationClick) onNotificationClick(item);
                  onClose();
                }}
                sx={{
                  display: 'block',
                  px: '16px',
                  py: '11px',
                  backgroundColor: item.unread ? 'rgba(255, 102, 0, 0.04)' : 'transparent',
                  '&:hover': { backgroundColor: 'var(--mac-canvas-bg)' },
                  '&:focus-visible': { outline: '2px solid #B34700', outlineOffset: '-2px' },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: '3px' }}>
                  <Typography sx={{ fontSize: FONT.body, fontWeight: item.unread ? 700 : 500, color: 'var(--mac-text-primary)', overflowWrap: 'anywhere' }}>
                    {readable(item.title)}
                  </Typography>
                  {item.unread && (
                    <Box component="span" role="img" aria-label={text.unread} sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'var(--sakay-orange)', flexShrink: 0, ml: '8px' }} />
                  )}
                </Box>
                {item.description && (
                  <Typography sx={{ fontSize: FONT.small, color: 'var(--mac-text-secondary)', lineHeight: 1.4, overflowWrap: 'anywhere' }}>
                    {item.description}
                  </Typography>
                )}
                <Typography sx={{ fontSize: FONT.caption, color: '#65656a', mt: '3px' }}>{item.time}</Typography>
              </ListItemButton>
            </ListItem>
            {idx < notifications.length - 1 && <Divider sx={{ borderColor: 'var(--mac-border-color)' }} />}
          </React.Fragment>
        ))
      )}
    </List>
  </Popover>
  );
};
