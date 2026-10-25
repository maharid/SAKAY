import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, IconButton, Badge, Button, Popover, MenuList, MenuItem, ListItemIcon, ListItemText, Divider } from '@mui/material';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import VerifiedIcon from '@mui/icons-material/Verified';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import LogoutIcon from '@mui/icons-material/Logout';
import { ProfileAvatar, formatNotificationTime, localizeSystemNotification, selectImportantNotifications } from '@sakay/shared';

import { NotificationPopover } from '../popovers/NotificationPopover';
import { NotificationItem } from '../../types/toda';
import { fetchTodaProfile } from '../../services/todaApiService';
import { supabase } from '../../services/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../hooks/useLanguage';
import { LogoutConfirmModal } from '../admin/LogoutConfirmModal';
import { FONT } from '../../styles/density';

interface TodaHeaderProps {
  pageTitle?: string;
  pageSubtitle?: string;
}

// The header's buttons: 30px tall for a mouse, 40px for a finger
const HEADER_BUTTON_HEIGHT = 30;
const headerButtonSx = {
  height: HEADER_BUTTON_HEIGHT,
  borderRadius: '8px',
  border: '1px solid var(--mac-border-color)',
  backgroundColor: '#FFFFFF',
  transition: 'var(--mac-transition-fast)',
  '@media (pointer: coarse)': { height: 40 },
  '&:focus-visible': { outline: '2px solid #B34700', outlineOffset: '2px' },
} as const;

export const TodaHeader: React.FC<TodaHeaderProps> = ({
  pageTitle = 'Operations Monitoring',
  pageSubtitle = 'Your drivers, your trips, and what needs your attention',
}) => {
  const navigate = useNavigate();
  const { todaAdminProfile, user, signOut } = useAuth();
  const { language } = useLanguage();
  const [todaName, setTodaName] = useState<string>('Calapan Central TODA');
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notifAnchor, setNotifAnchor] = useState<HTMLElement | null>(null);

  // Which notices were read is kept on this device, so a notice read once stays read when the list is read again (every 30 seconds)
  const READ_KEY = 'sakay_toda_read_notifs';
  const readIds = (): Set<string> => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem(READ_KEY) || '[]'));
    } catch {
      return new Set<string>();
    }
  };
  const rememberRead = (ids: string[]) => {
    try {
      const all = readIds();
      ids.forEach((id) => all.add(id));
      localStorage.setItem(READ_KEY, JSON.stringify(Array.from(all)));
    } catch {
      /* the read state is just not remembered */
    }
  };

  // Account Popover & Logout State
  const [accountAnchorEl, setAccountAnchorEl] = useState<null | HTMLElement>(null);
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);
  const accountMenuRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      try {
        const p = await fetchTodaProfile();
        if (p && isMounted) {
          setTodaName(p.name);
          const todaId = p.id || todaAdminProfile?.toda_id;
          if (todaId) {
            const { data: notifs } = await supabase
              .from('notification')
              .select('*')
              .eq('recipient_id', `toda_${todaId}`)
              .order('sent_at', { ascending: false })
              .limit(10);

            if (isMounted && notifs) {
              const read = readIds();
              // only what is worth the administrator's attention (a repeated write is listed once)
              setNotifications(
                selectImportantNotifications(notifs as any[], (n) => ({ type: n.notification_type, title: n.title, message: n.message, sentAt: n.sent_at })).map((n: any) => {
                  const id = String(n.notification_id || n.id);
                  return {
                    id,
                    rawTitle: n.title,
                    rawMessage: n.message,
                    sentAt: n.sent_at,
                    title: n.title,
                    description: n.message,
                    read: read.has(id),
                    unread: !read.has(id),
                    type: n.notification_type?.toLowerCase().includes('expiry') ? 'alert' : 'info',
                    kind: n.notification_type,
                  };
                })
              );
            }
          }
        }
      } catch (err) {
        console.warn('[TodaHeader] Error loading notifications:', err);
      }
    };
    loadData();
    // every 30 seconds, quietly: "driver resubmitted" notices arrive without reloading the page
    const timer = setInterval(loadData, 30000);
    return () => { isMounted = false; clearInterval(timer); };
  }, [todaAdminProfile]);

  const adminName = todaAdminProfile?.full_name || 'TODA Administrator';
  const adminEmail = todaAdminProfile?.email || user?.email || '';
  const associationName = todaAdminProfile?.toda?.toda_name || todaName;

  const handleSignOutConfirm = async () => {
    setLogoutModalOpen(false);
    setAccountAnchorEl(null);
    await signOut();
    navigate('/login', { replace: true });
  };

  const unreadCount = notifications.filter((n) => n.unread).length;

  // When the account menu has finished opening, the keyboard lands on its first item (arrow keys then move between the items)
  const focusFirstAccountItem = () => {
    const menu = accountMenuRef.current;
    if (menu && !menu.contains(document.activeElement)) (menu.querySelector('[role="menuitem"]') as HTMLElement | null)?.focus();
  };

  const handleMarkAllAsRead = () => {
    rememberRead(notifications.map((n) => n.id));
    setNotifications(notifications.map((n) => ({ ...n, read: true, unread: false })));
  };

  // What is shown is written from the notice's own text in the selected language, so a change of language changes the open panel too
  const shownNotifications = useMemo<NotificationItem[]>(
    () =>
      notifications.map((n) => {
        const text = localizeSystemNotification(n.rawTitle || n.title, n.rawMessage || n.description || '', language, n.kind);
        return { ...n, title: text.title, description: text.message, time: formatNotificationTime(n.sentAt, language) };
      }),
    [notifications, language]
  );

  return (
    <Box
      component="header"
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: 80,
        // The header sits above the scrolling page area (the page scrolls under it, not the header). It keeps the same height as the sidebar's logo row,
        // and on a narrow screen it is allowed to grow into a second row instead of cutting its buttons off.
        minHeight: 'var(--mac-header-height)',
        flexShrink: 0,
        backgroundColor: '#FFFFFF',
        borderBottom: '1px solid var(--mac-border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '6px 13px',
        padding: { xs: '8px 13px', md: '0 29px' },
      }}
    >
      {/* Left: Primary Page Title & Subtitle inside Sticky Header */}
      <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: '1 1 160px', minWidth: 0 }}>
        <Typography
          variant="h1"
          sx={{
            fontSize: FONT.pageTitle,
            fontWeight: 700,
            color: 'var(--mac-text-primary)',
            letterSpacing: '-0.2px',
            lineHeight: 1.25,
          }}
        >
          {pageTitle}
        </Typography>
        {pageSubtitle && (
          <Typography
            sx={{
              fontSize: FONT.caption,
              fontWeight: 400,
              color: '#65656a',
              lineHeight: 1.35,
              mt: '2px',
            }}
          >
            {pageSubtitle}
          </Typography>
        )}
      </Box>

      {/* Right Controls: Notifications, TODA Chip & Account Menu */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', position: 'relative', flexShrink: 0 }}>
        {/* Notifications Icon Button */}
        <Box sx={{ position: 'relative' }}>
          <IconButton
            size="small"
            aria-label={unreadCount > 0 ? 'Notifications, you have unread notifications' : 'Notifications'}
            aria-haspopup="true"
            aria-expanded={Boolean(notifAnchor)}
            onClick={(e) => setNotifAnchor(e.currentTarget)}
            sx={{
              ...headerButtonSx,
              width: HEADER_BUTTON_HEIGHT,
              '@media (pointer: coarse)': { height: 40, width: 40 },
              color: 'var(--mac-text-secondary)',
              '&:hover': {
                backgroundColor: 'var(--sakay-orange-soft)',
                color: 'var(--sakay-orange)',
                borderColor: 'var(--sakay-orange-border)',
              },
            }}
          >
            <Badge badgeContent={unreadCount} color="error" variant="dot">
              <NotificationsNoneIcon fontSize="small" sx={{ fontSize: 16 }} />
            </Badge>
          </IconButton>
          <NotificationPopover
            open={Boolean(notifAnchor)}
            anchorEl={notifAnchor}
            onClose={() => setNotifAnchor(null)}
            notifications={shownNotifications}
            onMarkAllAsRead={handleMarkAllAsRead}
          />
        </Box>

        {/* TODA Organization Navigation Chip */}
        <Button
          onClick={() => navigate('/account')}
          startIcon={<VerifiedIcon fontSize="small" sx={{ fontSize: 14, color: '#1E8E3E' }} />}
          sx={{
            ...headerButtonSx,
            padding: '0 13px',
            color: 'var(--mac-text-primary)',
            fontSize: FONT.caption,
            fontWeight: 600,
            textTransform: 'none',
            boxShadow: 'var(--mac-shadow-subtle)',
            maxWidth: { xs: 150, sm: 200 },
            minWidth: 0,
            '&:hover': {
              backgroundColor: 'var(--sakay-orange-soft)',
              color: 'var(--sakay-orange)',
              borderColor: 'var(--sakay-orange-border)',
            },
          }}
        >
          <Typography
            sx={{
              fontSize: FONT.caption,
              fontWeight: 600,
              color: 'inherit',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            {associationName}
          </Typography>
        </Button>

        {/* Header Account Profile Control */}
        <Box>
          {/* A real button, so the keyboard can reach it and a screen reader announces it */}
          <Box
            component="button"
            type="button"
            aria-label="Account menu"
            aria-haspopup="true"
            aria-expanded={Boolean(accountAnchorEl)}
            onClick={(e: React.MouseEvent<HTMLElement>) => setAccountAnchorEl(e.currentTarget)}
            sx={{
              ...headerButtonSx,
              padding: { xs: '0 6px', sm: '0 10px 0 8px' },
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              boxShadow: 'var(--mac-shadow-subtle)',
              userSelect: 'none',
              font: 'inherit',
              color: 'inherit',
              '&:hover': {
                backgroundColor: 'var(--mac-canvas-bg)',
                borderColor: 'var(--mac-border-color)',
              },
            }}
          >
            <ProfileAvatar name={adminName} size={24} />
            <Typography
              sx={{
                fontSize: FONT.caption,
                fontWeight: 600,
                color: 'var(--mac-text-primary)',
                lineHeight: 1,
                // on a phone only the initial shows; the name is still in the menu
                display: { xs: 'none', sm: 'block' },
              }}
            >
              {adminName}
            </Typography>
            <KeyboardArrowDownIcon fontSize="small" sx={{ fontSize: 15, color: 'var(--mac-text-muted)', ml: '-2px' }} />
          </Box>

          {/* Account menu: who is signed in, then the two things they can do */}
          <Popover
            open={Boolean(accountAnchorEl)}
            anchorEl={accountAnchorEl}
            onClose={() => setAccountAnchorEl(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{
              transition: { onEntered: focusFirstAccountItem },
              paper: {
                sx: {
                  mt: '6px',
                  width: 248,
                  maxWidth: 'calc(100vw - 32px)',
                  borderRadius: '12px',
                  border: '1px solid var(--mac-border-color)',
                  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.14)',
                  backgroundColor: '#FFFFFF',
                  overflow: 'hidden',
                },
              },
            }}
          >
            {/* Identity: the initial, the name, the role and the e-mail the account was signed in with */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', p: '12px 14px' }}>
              <ProfileAvatar name={adminName} size={36} />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: FONT.body, fontWeight: 700, color: 'var(--mac-text-primary)', lineHeight: 1.25 }}>
                  {adminName}
                </Typography>
                <Typography sx={{ fontSize: FONT.caption, fontWeight: 600, color: '#B34700', lineHeight: 1.3 }}>
                  TODA Admin
                </Typography>
                {adminEmail && (
                  <Typography sx={{ fontSize: FONT.caption, color: '#65656a', lineHeight: 1.3, overflowWrap: 'anywhere' }}>
                    {adminEmail}
                  </Typography>
                )}
              </Box>
            </Box>

            <Divider />

            <MenuList
              ref={accountMenuRef}
              aria-label="Account"
              sx={{
                p: '6px',
                '& .MuiMenuItem-root': {
                  minHeight: 34,
                  borderRadius: '8px',
                  gap: '10px',
                  px: '10px',
                  fontSize: FONT.body,
                  fontWeight: 600,
                  '@media (pointer: coarse)': { minHeight: 44 },
                  '&:focus-visible': { outline: '2px solid #B34700', outlineOffset: '-2px' },
                },
                '& .MuiListItemIcon-root': { minWidth: 0, color: 'inherit' },
                '& .MuiListItemText-primary': { fontSize: FONT.body, fontWeight: 600 },
              }}
            >
              <MenuItem
                onClick={() => {
                  setAccountAnchorEl(null);
                  navigate('/account');
                }}
                sx={{
                  color: 'var(--mac-text-primary)',
                  '&:hover, &.Mui-focusVisible': { backgroundColor: 'var(--sakay-orange-soft)', color: '#B34700' },
                  '&:active': { backgroundColor: 'rgba(255, 102, 0, 0.16)' },
                }}
              >
                <ListItemIcon><ManageAccountsIcon sx={{ fontSize: 16 }} /></ListItemIcon>
                <ListItemText>Manage Account</ListItemText>
              </MenuItem>

              <MenuItem
                onClick={() => {
                  setAccountAnchorEl(null);
                  setLogoutModalOpen(true);
                }}
                sx={{
                  color: '#B91C1C',
                  '&:hover, &.Mui-focusVisible': { backgroundColor: '#FEF2F2' },
                  '&:active': { backgroundColor: '#FEE2E2' },
                }}
              >
                <ListItemIcon><LogoutIcon sx={{ fontSize: 16 }} /></ListItemIcon>
                <ListItemText>Log Out</ListItemText>
              </MenuItem>
            </MenuList>
          </Popover>
        </Box>
      </Box>

      {/* Logout Confirmation Modal */}
      <LogoutConfirmModal
        open={logoutModalOpen}
        onClose={() => setLogoutModalOpen(false)}
        onConfirm={handleSignOutConfirm}
      />
    </Box>
  );
};
