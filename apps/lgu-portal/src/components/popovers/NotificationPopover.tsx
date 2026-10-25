import React from 'react';
import { Box, Button, ButtonBase, Popover, Typography } from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

import { NotificationItem } from '../../types/admin';
import { FONT } from '../../styles/density';
import { PAGE_BORDER, PAGE_DIVIDER, PAGE_TEXT, pageFocusRing } from '../../styles/pageTheme';

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

// A message that stands in for the list (nothing yet, still loading, could not load)
const ListMessage: React.FC<{ title: string; hint?: string; role?: 'status' | 'alert' }> = ({ title, hint, role }) => (
  <Box role={role} sx={{ p: '26px 16px', textAlign: 'center' }}>
    <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.primary }}>{title}</Typography>
    {hint && <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '2px' }}>{hint}</Typography>}
  </Box>
);

// The notification panel (laid out like the TODA portal's): it opens under the bell, is never wider or taller than the screen, and scrolls its list while the title row stays in view.
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
  const unreadCount = notifications.filter((n) => n.unread).length;

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{
        paper: {
          sx: {
            mt: '8px',
            width: 340,
            maxWidth: 'calc(100vw - 32px)',
            maxHeight: 'min(420px, calc(100dvh - 80px))',
            display: 'flex',
            flexDirection: 'column',
            borderRadius: '12px',
            border: `1px solid ${PAGE_BORDER}`,
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.14)',
            backgroundColor: '#FFFFFF',
            overflow: 'hidden',
          },
        },
      }}
    >
      <Box sx={{ p: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexShrink: 0, borderBottom: `1px solid ${PAGE_BORDER}` }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Typography component="h2" sx={{ fontSize: FONT.heading, fontWeight: 700, color: PAGE_TEXT.primary }}>Notifications</Typography>
          {unreadCount > 0 && (
            <Box component="span" sx={{ fontSize: FONT.caption, fontWeight: 700, color: '#FFFFFF', backgroundColor: '#C75000', borderRadius: '999px', px: '7px', py: '1px', lineHeight: 1.5 }}>
              {unreadCount} new
            </Box>
          )}
        </Box>
        {unreadCount > 0 && (
          <Button
            size="small"
            onClick={onMarkAllAsRead}
            sx={{
              fontSize: FONT.small,
              textTransform: 'none',
              color: PAGE_TEXT.brand,
              fontWeight: 600,
              p: '4px 8px',
              mr: '-8px',
              minWidth: 0,
              flexShrink: 0,
              '@media (pointer: coarse)': { minHeight: 44 },
              ...pageFocusRing,
            }}
          >
            Mark all as read
          </Button>
        )}
      </Box>

      {/* the list scrolls inside the panel; the title row above stays in view */}
      <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
        {loading && notifications.length === 0 ? (
          <ListMessage role="status" title="Loading notifications..." />
        ) : failed && notifications.length === 0 ? (
          <ListMessage role="alert" title="Notifications could not be loaded" hint="They will be tried again in a moment." />
        ) : notifications.length === 0 ? (
          <ListMessage title="No new notifications" hint="Driver and TODA activity is up to date." />
        ) : (
          notifications.map((item) => (
            <Box component="li" key={item.id} sx={{ '& + &': { borderTop: `1px solid ${PAGE_DIVIDER}` } }}>
              <ButtonBase
                onClick={() => {
                  if (onNotificationClick) onNotificationClick(item);
                  onClose();
                }}
                disableRipple
                sx={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  px: '16px',
                  py: '11px',
                  backgroundColor: item.unread ? 'rgba(255, 102, 0, 0.05)' : 'transparent',
                  '&:hover': { backgroundColor: item.unread ? 'rgba(255, 102, 0, 0.1)' : '#FAFAF8' },
                  '&:focus-visible': { outline: `2px solid ${PAGE_TEXT.brand}`, outlineOffset: '-2px' },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                  <Typography sx={{ fontSize: FONT.body, fontWeight: item.unread ? 700 : 500, color: PAGE_TEXT.primary, lineHeight: 1.35, overflowWrap: 'anywhere' }}>
                    {readable(item.title)}
                  </Typography>
                  {item.unread && <Box component="span" aria-label="Unread" sx={{ width: 8, height: 8, mt: '5px', borderRadius: '50%', backgroundColor: '#C75000', flexShrink: 0 }} />}
                </Box>
                {item.description && (
                  <Typography
                    sx={{
                      fontSize: FONT.small,
                      color: PAGE_TEXT.secondary,
                      lineHeight: 1.45,
                      mt: '2px',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {item.description}
                  </Typography>
                )}
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: '4px' }}>
                  <Typography sx={{ fontSize: FONT.caption, color: PAGE_TEXT.secondary }}>{item.time}</Typography>
                  {item.link && (
                    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', color: PAGE_TEXT.brand, fontSize: FONT.small, fontWeight: 600 }}>
                      View
                      <ChevronRightIcon aria-hidden sx={{ fontSize: 14 }} />
                    </Box>
                  )}
                </Box>
              </ButtonBase>
            </Box>
          ))
        )}
      </Box>
    </Popover>
  );
};
