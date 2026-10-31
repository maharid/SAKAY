import React from 'react';
import { Box, Typography, Popover, Button, List, ListItem, Divider } from '@mui/material';
import { PortalNoticeRow, notificationPanelText } from '@sakay/shared';
import { NotificationItem } from '../../types/toda';
import { useLanguage } from '../../hooks/useLanguage';
import { FONT } from '../../styles/density';

interface NotificationPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorEl: HTMLElement | null;
  notifications: NotificationItem[];
  onMarkAllAsRead: () => void;
  /** Opens the page or the record a notice is about (and marks it read) */
  onNotificationClick?: (item: NotificationItem) => void;
}

export const NotificationPopover: React.FC<NotificationPopoverProps> = ({
  open,
  onClose,
  anchorEl,
  notifications,
  onMarkAllAsRead,
  onNotificationClick,
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
            // never wider or taller than the screen: 352 wide and tall enough for about three notices (the rest scrolls), shrinking on a phone or a short window
            width: 352,
            maxWidth: 'calc(100vw - 32px)',
            maxHeight: 'min(432px, calc(100dvh - 80px))',
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
        <Typography sx={{ fontSize: FONT.heading, fontWeight: 700, color: 'var(--mac-text-primary)' }}>
          {text.todaTitle}
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

      {/* the list scrolls inside the popup; the title row above stays in view */}
      <List sx={{ p: 0, flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
        {notifications.length > 0 ? (
          notifications.map((n, idx) => (
            <React.Fragment key={n.id}>
              <ListItem disablePadding>
                <PortalNoticeRow
                  type={n.type}
                  title={n.title}
                  description={n.description}
                  time={n.time}
                  unread={n.unread}
                  unreadLabel={text.unread}
                  onOpen={() => {
                    onNotificationClick?.(n);
                    onClose();
                  }}
                />
              </ListItem>
              {idx < notifications.length - 1 && <Divider sx={{ borderColor: 'var(--mac-border-color)' }} />}
            </React.Fragment>
          ))
        ) : (
          <Box sx={{ p: '26px', textAlign: 'center' }}>
            <Typography sx={{ fontSize: FONT.body, color: '#65656a' }}>
              {text.empty}
            </Typography>
          </Box>
        )}
      </List>
    </Popover>
  );
};
