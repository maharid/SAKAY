import React from 'react';
import { Box, Typography, Popover, Button, List, ListItem, ListItemText, Divider } from '@mui/material';
import { NotificationItem } from '../../types/toda';
import { FONT } from '../../styles/density';

interface NotificationPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorEl: HTMLElement | null;
  notifications: NotificationItem[];
  onMarkAllAsRead: () => void;
}

export const NotificationPopover: React.FC<NotificationPopoverProps> = ({
  open,
  onClose,
  anchorEl,
  notifications,
  onMarkAllAsRead,
}) => {
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
        <Typography sx={{ fontSize: FONT.heading, fontWeight: 700, color: 'var(--mac-text-primary)' }}>
          TODA Notifications
        </Typography>
        <Button
          size="small"
          onClick={onMarkAllAsRead}
          sx={{
            fontSize: FONT.small,
            textTransform: 'none',
            color: '#B34700',
            fontWeight: 600,
            p: 0,
            minWidth: 0,
            flexShrink: 0,
          }}
        >
          Mark all as read
        </Button>
      </Box>

      {/* the list scrolls inside the popup; the title row above stays in view */}
      <List sx={{ p: 0, flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
        {notifications.length > 0 ? (
          notifications.map((n, idx) => (
            <React.Fragment key={n.id}>
              <ListItem
                sx={{
                  px: '16px',
                  py: '11px',
                  backgroundColor: n.unread ? 'rgba(255, 102, 0, 0.04)' : 'transparent',
                  '&:hover': { backgroundColor: 'var(--mac-canvas-bg)' },
                }}
              >
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: '3px' }}>
                      <Typography sx={{ fontSize: FONT.body, fontWeight: n.unread ? 700 : 500, color: 'var(--mac-text-primary)' }}>
                        {n.title}
                      </Typography>
                      {n.unread && (
                        <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'var(--sakay-orange)', flexShrink: 0, ml: '8px' }} />
                      )}
                    </Box>
                  }
                  secondary={
                    <Box>
                      <Typography sx={{ fontSize: FONT.small, color: 'var(--mac-text-secondary)', lineHeight: 1.4 }}>
                        {n.description}
                      </Typography>
                      <Typography sx={{ fontSize: FONT.caption, color: '#65656a', mt: '3px' }}>
                        {n.time}
                      </Typography>
                    </Box>
                  }
                />
              </ListItem>
              {idx < notifications.length - 1 && <Divider sx={{ borderColor: 'var(--mac-border-color)' }} />}
            </React.Fragment>
          ))
        ) : (
          <Box sx={{ p: '26px', textAlign: 'center' }}>
            <Typography sx={{ fontSize: FONT.body, color: '#65656a' }}>
              No notifications at this time.
            </Typography>
          </Box>
        )}
      </List>
    </Popover>
  );
};
