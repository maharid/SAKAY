import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, Button, IconButton, Badge, Popover, MenuList, MenuItem, ListItemIcon, ListItemText, Divider } from '@mui/material';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import LogoutIcon from '@mui/icons-material/Logout';

import { NotificationPopover } from '../popovers/NotificationPopover';
import { NotificationItem } from '../../types/admin';
import { useAuth } from '../../contexts/AuthContext';
import { LogoutConfirmModal } from '../admin/LogoutConfirmModal';
import { supabase } from '../../services/supabaseClient';
import { FONT } from '../../styles/density';
import { PAGE_TEXT } from '../../styles/pageTheme';

// The header's buttons: 30px tall for a mouse, 40px for a finger (the same as the TODA portal's header)
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

interface AdminHeaderProps {
  pageTitle?: string;
  pageSubtitle?: string;
}

export const AdminHeader: React.FC<AdminHeaderProps> = ({
  pageTitle = 'Dashboard',
  pageSubtitle = 'Overview of SAKAY operations in Calapan City',
}) => {
  const navigate = useNavigate();
  const { adminProfile, user, signOut } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notifAnchor, setNotifAnchor] = useState<HTMLElement | null>(null);
  // the first reading of the notices, and whether the last one failed (shown in the panel, so an empty list is not mistaken for "nothing new")
  const [notifLoading, setNotifLoading] = useState(true);
  const [notifFailed, setNotifFailed] = useState(false);

  // Helper: Format relative timestamp
  const formatRelativeTime = (dateStr?: string | null): string => {
    if (!dateStr) return 'Recent';
    const date = new Date(dateStr);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    const diffDays = Math.floor(diffHour / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Helper: Read IDs cache from localStorage
  const getReadNotifIds = (): Set<string> => {
    try {
      const raw = localStorage.getItem('sakay_lgu_read_notifs');
      if (raw) return new Set(JSON.parse(raw));
    } catch {}
    return new Set();
  };

  const saveReadNotifIds = (ids: string[]) => {
    try {
      const current = getReadNotifIds();
      ids.forEach((id) => current.add(id));
      localStorage.setItem('sakay_lgu_read_notifs', JSON.stringify(Array.from(current)));
    } catch {}
  };

  // Load real dynamic notifications from live database and operational tables
  useEffect(() => {
    let isMounted = true;
    const fetchNotifications = async () => {
      try {
        const readSet = getReadNotifIds();

        // The applications waiting for the LGU (TODA endorsed, LGU not decided), from the applications themselves. Whether one of them came back
        // from an LGU correction is read from the documents it returned (below), never from a remark on the shared verification record: a remark
        // outlives the correction it described and then mislabels later applications.
        const [awaitingLgu, pendingTodas, notifsRes, logsRes] = await Promise.all([
          supabase
            .from('driver_toda_affiliation')
            .select('affiliation_id, driver_id, resubmitted_at, toda_endorsed_at, submitted_at, updated_at, driver:driver_id(full_name)')
            .eq('toda_endorsement_status', 'Endorsed')
            .eq('lgu_verification_status', 'Pending')
            .order('updated_at', { ascending: false })
            .limit(15),
          supabase
            .from('toda')
            .select('toda_id, toda_name, toda_acronym, toda_status, account_status, created_at')
            .in('toda_status', ['Pending', 'Pending Accreditation', 'Under Review'])
            .order('created_at', { ascending: false })
            .limit(5),
          supabase
            .from('notification')
            .select('*')
            .order('sent_at', { ascending: false })
            .limit(10),
          supabase
            .from('audit_log')
            .select('*')
            .order('performed_at', { ascending: false })
            .limit(5),
        ]);

        // a failed read comes back as an error value, not as an exception, and would look like an empty list: when every read failed, say so instead of "nothing new"
        if ([awaitingLgu, pendingTodas, notifsRes, logsRes].every((res) => res.error)) throw new Error(notifsRes.error?.message || 'The notices could not be read.');

        const awaitingRows = (awaitingLgu.data || []) as any[];
        const resubmittedToLgu = new Set<string>();
        if (awaitingRows.length > 0) {
          try {
            const { data: docRows } = await supabase.rpc('get_affiliation_document_reviews', {
              p_affiliation_ids: awaitingRows.map((a) => a.affiliation_id),
            });
            for (const r of (docRows || []) as any[]) {
              if (r.state === 'resubmitted' && r.returned_by_stage === 'LGU') resubmittedToLgu.add(r.affiliation_id);
            }
          } catch {
            // without the document reviews every row is simply an endorsement, never a guessed resubmission
          }
        }
        const nameOf = (a: any): string => (Array.isArray(a.driver) ? a.driver[0] : a.driver)?.full_name || 'Driver applicant';
        const resubVerifs = {
          data: awaitingRows.filter((a) => resubmittedToLgu.has(a.affiliation_id)).slice(0, 10).map((a) => ({
            id: a.affiliation_id, name: nameOf(a), ts: a.resubmitted_at || a.updated_at,
          })),
        };
        const endorsedVerifs = {
          data: awaitingRows.filter((a) => !resubmittedToLgu.has(a.affiliation_id)).slice(0, 5).map((a) => ({
            id: a.affiliation_id, name: nameOf(a), ts: a.toda_endorsed_at || a.submitted_at,
          })),
        };

        const items: NotificationItem[] = [];
        const seenIds = new Set<string>();

        // 1. Direct database notifications
        (notifsRes.data || []).forEach((n: any) => {
          const id = `db-${n.notification_id || n.id}`;
          if (!seenIds.has(id)) {
            seenIds.add(id);
            const isRead = n.is_read || readSet.has(id);
            items.push({
              id,
              title: n.title,
              description: n.message,
              time: formatRelativeTime(n.sent_at),
              rawTimestamp: n.sent_at,
              category: n.notification_type?.toLowerCase().includes('resubmission') ? 'resubmission' : 'general',
              link: '/drivers',
              read: isRead,
              unread: !isRead,
              type: n.notification_type || 'alert',
            });
          }
        });

        // 2. Resubmitted driver applications
        resubVerifs.data.forEach((v) => {
          const id = `resub-${v.id}`;
          if (!seenIds.has(id)) {
            seenIds.add(id);
            const ts = v.ts;
            const isRead = readSet.has(id);
            items.push({
              id,
              title: 'Driver Resubmitted Documents',
              description: `${v.name} resubmitted updated documents for Stage 2 review.`,
              time: formatRelativeTime(ts),
              rawTimestamp: ts,
              category: 'resubmission',
              link: '/drivers',
              read: isRead,
              unread: !isRead,
              type: 'resubmission',
            });
          }
        });

        // 3. TODA Endorsements awaiting LGU review
        endorsedVerifs.data.forEach((v) => {
          const id = `endorse-${v.id}`;
          if (!seenIds.has(id)) {
            seenIds.add(id);
            const ts = v.ts;
            const isRead = readSet.has(id);
            items.push({
              id,
              title: 'Driver Application Endorsed',
              description: `${v.name} endorsed by TODA for Stage 2 LGU inspection.`,
              time: formatRelativeTime(ts),
              rawTimestamp: ts,
              category: 'endorsement',
              link: '/drivers',
              read: isRead,
              unread: !isRead,
              type: 'endorsement',
            });
          }
        });

        // 4. Pending TODA accreditation applications
        (pendingTodas.data || []).forEach((t: any) => {
          const id = `toda-${t.toda_id}`;
          if (!seenIds.has(id)) {
            seenIds.add(id);
            const isRead = readSet.has(id);
            items.push({
              id,
              title: 'TODA Accreditation Pending',
              description: `${t.toda_name || t.toda_acronym} submitted an application for LGU accreditation.`,
              time: formatRelativeTime(t.created_at),
              rawTimestamp: t.created_at,
              category: 'toda',
              link: '/toda',
              read: isRead,
              unread: !isRead,
              type: 'toda',
            });
          }
        });

        // 5. Recent audit activity
        (logsRes.data || []).forEach((log: any) => {
          const id = `log-${log.log_id}`;
          if (!seenIds.has(id)) {
            seenIds.add(id);
            const timeVal = log.performed_at || log.created_at;
            const isRead = readSet.has(id);
            items.push({
              id,
              title: log.action_type ? log.action_type.replace(/_/g, ' ') : 'Administrative Activity',
              description: log.details || '',
              time: formatRelativeTime(timeVal),
              rawTimestamp: timeVal,
              category: 'system',
              link: '/audit-logs',
              read: isRead,
              unread: !isRead,
              type: (log.category || 'System').toLowerCase(),
            });
          }
        });

        items.sort((a, b) => new Date(b.rawTimestamp || 0).getTime() - new Date(a.rawTimestamp || 0).getTime());

        if (isMounted) {
          setNotifications(items);
          setNotifFailed(false);
          setNotifLoading(false);
        }
      } catch (err) {
        console.warn('[AdminHeader] Could not load notifications:', err);
        if (isMounted) {
          setNotifFailed(true);
          setNotifLoading(false);
        }
      }
    };

    fetchNotifications();
    const interval = setInterval(fetchNotifications, 15000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Account Popover State
  const [accountAnchorEl, setAccountAnchorEl] = useState<null | HTMLElement>(null);
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);
  const accountMenuRef = useRef<HTMLUListElement>(null);

  const adminName = adminProfile?.full_name || 'City Administrator';
  const adminEmail = adminProfile?.email || user?.email || '';

  const handleSignOutConfirm = async () => {
    setLogoutModalOpen(false);
    setAccountAnchorEl(null);
    await signOut();
    navigate('/login', { replace: true });
  };

  const unreadCount = notifications.filter((n) => n.unread).length;

  const handleMarkAllAsRead = () => {
    const allIds = notifications.map((n) => n.id);
    saveReadNotifIds(allIds);
    setNotifications((prev) => prev.map((n) => ({ ...n, unread: false, read: true })));
  };

  const handleNotificationClick = (item: NotificationItem) => {
    saveReadNotifIds([item.id]);
    setNotifications((prev) =>
      prev.map((n) => (n.id === item.id ? { ...n, unread: false, read: true } : n))
    );
    if (item.link) {
      navigate(item.link);
    }
  };

  // When the account menu has finished opening, the keyboard lands on its first item (arrow keys then move between the items)
  const focusFirstAccountItem = () => {
    const menu = accountMenuRef.current;
    if (menu && !menu.contains(document.activeElement)) (menu.querySelector('[role="menuitem"]') as HTMLElement | null)?.focus();
  };

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
      {/* Left: Primary Page Title & Subtitle */}
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
              color: PAGE_TEXT.secondary,
              lineHeight: 1.35,
              mt: '2px',
            }}
          >
            {pageSubtitle}
          </Typography>
        )}
      </Box>

      {/* Right: Global Sticky Header Controls */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', position: 'relative', flexShrink: 0 }}>
        {/* Notifications Icon Button */}
        <Box sx={{ position: 'relative' }}>
          <IconButton
            size="small"
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
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
            <Badge badgeContent={unreadCount} color="error" max={99}>
              <NotificationsNoneIcon fontSize="small" sx={{ fontSize: 16 }} />
            </Badge>
          </IconButton>
          <NotificationPopover
            open={Boolean(notifAnchor)}
            anchorEl={notifAnchor}
            onClose={() => setNotifAnchor(null)}
            loading={notifLoading}
            failed={notifFailed}
            notifications={notifications}
            onMarkAllAsRead={handleMarkAllAsRead}
            onNotificationClick={handleNotificationClick}
          />
        </Box>

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
              maxWidth: { xs: 'none', sm: 260 },
              '&:hover': {
                backgroundColor: 'var(--mac-canvas-bg)',
                borderColor: 'var(--mac-border-color)',
              },
            }}
          >
            <Box
              sx={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                backgroundColor: 'var(--sakay-orange-soft)',
                color: 'var(--sakay-orange)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: FONT.overline,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {adminName.charAt(0).toUpperCase()}
            </Box>
            <Typography
              sx={{
                fontSize: FONT.caption,
                fontWeight: 600,
                color: 'var(--mac-text-primary)',
                lineHeight: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                // on a phone only the initial shows; the name is still in the menu
                display: { xs: 'none', sm: 'block' },
              }}
            >
              {adminName}
            </Typography>
            <KeyboardArrowDownIcon fontSize="small" sx={{ fontSize: 15, color: 'var(--mac-text-muted)', ml: '-2px', flexShrink: 0 }} />
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
                  width: 'max-content',
                  minWidth: 248,
                  maxWidth: 'min(400px, calc(100vw - 32px))',
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
              <Box
                aria-hidden
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: FONT.heading,
                  fontWeight: 700,
                  color: '#FFFFFF',
                  background: 'linear-gradient(135deg, var(--sakay-orange) 0%, #ff8a47 100%)',
                }}
              >
                {adminName.charAt(0).toUpperCase()}
              </Box>
              <Box sx={{ minWidth: 0, flex: '1 1 auto' }}>
                <Typography sx={{ fontSize: FONT.body, fontWeight: 700, color: 'var(--mac-text-primary)', lineHeight: 1.25, overflowWrap: 'anywhere' }}>
                  {adminName}
                </Typography>
                <Typography sx={{ fontSize: FONT.caption, fontWeight: 600, color: PAGE_TEXT.brand, lineHeight: 1.3 }}>
                  LGU Admin
                </Typography>
                {adminEmail && (
                  <Typography title={adminEmail} sx={{ fontSize: FONT.caption, color: PAGE_TEXT.secondary, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
                  '&:focus-visible': { outline: `2px solid ${PAGE_TEXT.brand}`, outlineOffset: '-2px' },
                },
                '& .MuiListItemIcon-root': { minWidth: 0, color: 'inherit' },
                '& .MuiListItemText-primary': { fontSize: FONT.body, fontWeight: 600 },
              }}
            >
              <MenuItem
                onClick={() => {
                  setAccountAnchorEl(null);
                  navigate('/settings');
                }}
                sx={{
                  color: 'var(--mac-text-primary)',
                  '&:hover, &.Mui-focusVisible': { backgroundColor: 'var(--sakay-orange-soft)', color: PAGE_TEXT.brand },
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
                  color: PAGE_TEXT.danger,
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
