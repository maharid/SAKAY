import React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Paper,
  ButtonBase,
  Typography,
  Badge,
} from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import NotificationsIcon from '@mui/icons-material/Notifications';
import HistoryIcon from '@mui/icons-material/History';
import SettingsIcon from '@mui/icons-material/Settings';

import { useLanguage } from '../../utils/LanguageContext';
import { supabase } from '../../services/supabaseClient';
import { fetchDriverNotifications } from '../../services/driverApiService';
import { DriverSessionProvider } from '../../contexts/DriverSessionContext';
import { ConnectionLostBanner } from '@sakay/shared';
import { DriverIncomingRequestModal } from '../components/DriverIncomingRequestModal';
import { DriverSharedRequestModal } from '../components/DriverSharedRequestModal';
import DriverPresenceNotices from '../components/DriverPresenceNotices';
import SakayToast from '../components/SakayToast';

interface NavTabItem {
  key: string;
  label: string;
  path: string;
  icon: React.ReactNode;
}

export const DriverMobileAppShell: React.FC = () => {
  const { language } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname;

  // ── Global single-device session guard (Batch 2) ─────────────────────────
  const [sessionToastOpen, setSessionToastOpen] = React.useState(false);
  const [sessionToastMsg, setSessionToastMsg] = React.useState('');

  // AUTHENTICATED_PATHS: only guard routes where a driver should be logged in.
  const GUARDED_PATHS = [
    '/driver/home', '/driver/earnings', '/driver/notifications',
    '/driver/history', '/driver/profile', '/driver/settings',
    '/driver/navigation', '/driver/active-trip', '/driver/status',
    '/settings', '/profile', '/trip-history', '/trip-detail',
  ];

  // Signs this device out because the account logged in on another device (Rule 29.1). Used by the check below
  // (on navigation) and by the presence engine, whose database calls are refused for a superseded device.
  const invalidateLocalSession = React.useCallback(async () => {
    await supabase.auth.signOut();
    localStorage.removeItem('sakay_driver_session_token');
    localStorage.removeItem('sakay_driver_id');
    localStorage.removeItem('sakay_driver_profile');
    localStorage.removeItem('sakay_driver_phone');
    const msg = language === 'tl'
      ? 'Natapos ang inyong session dahil nag-login ang account sa ibang device. Mag-login muli.'
      : 'Your session was invalidated because the account logged in on another device. Please log in again.';
    setSessionToastMsg(msg);
    setSessionToastOpen(true);
    navigate('/driver/login', { replace: true });
  }, [language, navigate]);

  React.useEffect(() => {
    const isGuarded = GUARDED_PATHS.some((p) => currentPath.startsWith(p));
    if (!isGuarded) return;

    const checkSessionMismatch = async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess?.session?.user) return;

      const localToken = localStorage.getItem('sakay_driver_session_token');
      const { data: dbProfile } = await supabase
        .from('driver')
        .select('session_id')
        .eq('auth_user_id', sess.session.user.id)
        .maybeSingle();

      // If DB has a session_id and it doesn't match the local one → another device logged in
      if (dbProfile?.session_id && dbProfile.session_id !== localToken) {
        await invalidateLocalSession();
      }
    };

    checkSessionMismatch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath]);
  // ─────────────────────────────────────────────────────────────────────────

  // Routes where the bottom tab navigation should be permanently visible
  const showBottomNav = [
    '/driver/home',
    '/driver/earnings',
    '/driver/notifications',
    '/driver/history',
    '/driver/settings',
    '/settings',
    '/driver/profile',
    '/profile',
  ].includes(currentPath);

  // The offer screen and the presence notices (the Rule 7.6 reminder, why the system set the driver Offline) belong to the signed-in DRIVER, not to a list
  // of routes: an offer can reach a driver who is Online on ANY screen (trip details, change password, terms...). With a list, a route that was missing
  // left the offer invisible while its alert still rang, and the unanswered offer counted toward Rules 7.6 / 7.7. Nothing shows without a signed-in
  // driver, and nothing shows unless the database holds an offer or a notice for them. Re-read on every render, so signing in or out (which navigates)
  // is picked up immediately.
  const signedInDriverId = localStorage.getItem('sakay_driver_id');
  const isDriverPortal = Boolean(signedInDriverId);

  // The red dot means there IS something unread: a notice the database holds for this driver that this phone has not opened yet. With
  // nothing to read there is no dot (it used to be on until two sample notices had been opened).
  const [serverUnreadIds, setServerUnreadIds] = React.useState<string[]>([]);
  const [hasUnread, setHasUnread] = React.useState<boolean>(false);

  React.useEffect(() => {
    if (!localStorage.getItem('sakay_driver_id')) {
      setServerUnreadIds([]);
      return;
    }
    let stopped = false;
    const load = () => {
      fetchDriverNotifications()
        .then((items) => {
          if (!stopped) setServerUnreadIds((items || []).filter((n) => n.read !== true).map((n) => String(n.id)));
        })
        .catch(() => {});
    };
    load();
    const refresh = setInterval(load, 60000);
    return () => {
      stopped = true;
      clearInterval(refresh);
    };
  }, [location.pathname]);

  React.useEffect(() => {
    const checkUnread = () => {
      let localReadIds: string[] = [];
      try {
        const stored = localStorage.getItem('sakay_driver_read_notifications');
        localReadIds = stored ? JSON.parse(stored) : [];
      } catch {
        // storage unavailable: nothing is known to be read
      }
      const unreadExists = serverUnreadIds.some((id) => !localReadIds.includes(id));
      setHasUnread((prev) => (prev === unreadExists ? prev : unreadExists));
    };

    checkUnread();
    const interval = setInterval(checkUnread, 1000);
    return () => clearInterval(interval);
  }, [serverUnreadIds, location.pathname]);

  const tabs: NavTabItem[] = [
    {
      key: 'home',
      label: 'Home',
      path: '/driver/home',
      icon: <HomeIcon sx={{ fontSize: 22 }} />,
    },
    {
      key: 'earnings',
      label: language === 'tl' ? 'Kita' : 'Earnings',
      path: '/driver/earnings',
      icon: <AccountBalanceWalletIcon sx={{ fontSize: 22 }} />,
    },
    {
      key: 'notifications',
      label: language === 'tl' ? 'Abiso' : 'Alerts',
      path: '/driver/notifications',
      icon: (
        <Badge badgeContent={hasUnread ? 1 : 0} invisible={!hasUnread} color="error" variant="dot">
          <NotificationsIcon sx={{ fontSize: 22 }} />
        </Badge>
      ),
    },
    {
      key: 'history',
      label: language === 'tl' ? 'Biyahe' : 'Trips',
      path: '/driver/history',
      icon: <HistoryIcon sx={{ fontSize: 22 }} />,
    },
    {
      key: 'settings',
      label: language === 'tl' ? 'Mga Setting' : 'Settings',
      path: '/driver/settings',
      icon: <SettingsIcon sx={{ fontSize: 22 }} />,
    },
  ];

  const content = (
    <Box className="app-container">
      {/* Global Session-Invalidation Toast */}
      <SakayToast
        open={sessionToastOpen}
        message={sessionToastMsg}
        severity="error"
        onClose={() => setSessionToastOpen(false)}
      />
      <Box
        component="main"
        className="phone-simulator hide-scrollbar"
        id="driver-app-shell"
      >
        <Box
          sx={{
            width: '100%',
            height: '100%',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            backgroundColor: '#F8FAFC',
          }}
        >
          {/* Rule 17.4: while this phone cannot reach the server, every screen says so (a stalled screen is not a finished or cancelled trip) */}
          <ConnectionLostBanner language={language} />

          {/* Main Content Area */}
          <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <Outlet />
          </Box>

          {/* Persistent Bottom Tab Navigation Bar */}
          {showBottomNav && (
            <Paper
              elevation={8}
              sx={{
                width: '100%',
                backgroundColor: '#FFFFFF',
                borderTop: '1px solid #E2E8F0',
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
                paddingTop: '8px',
                paddingBottom: 'calc(var(--safe-area-bottom) + 8px)',
                paddingLeft: '6px',
                paddingRight: '6px',
                zIndex: 50,
                flexShrink: 0,
                boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.06)',
              }}
            >
              {tabs.map((tab) => {
                const isActive = currentPath === tab.path;
                return (
                  <ButtonBase
                    key={tab.key}
                    onClick={() => navigate(tab.path)}
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '4px 0',
                      minHeight: '48px',
                      borderRadius: '12px',
                      color: isActive ? '#FF6600' : '#64748B',
                      transition: 'all 0.18s ease-in-out',
                      '&:hover': {
                        backgroundColor: 'rgba(255, 102, 0, 0.04)',
                      },
                    }}
                  >
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transform: isActive ? 'scale(1.12)' : 'scale(1.0)',
                        transition: 'transform 0.18s ease',
                        color: isActive ? '#FF6600' : '#64748B',
                      }}
                    >
                      {tab.icon}
                    </Box>
                    <Typography
                      sx={{
                        fontSize: '12px',
                        fontWeight: isActive ? 700 : 500,
                        color: isActive ? '#FF6600' : '#64748B',
                        marginTop: '2px',
                        lineHeight: 1.2,
                      }}
                    >
                      {tab.label}
                    </Typography>
                  </ButtonBase>
                );
              })}
            </Paper>
          )}

          {/* Global Incoming Request Modal */}
          {isDriverPortal && <DriverIncomingRequestModal />}

          {/* Rule 14.3: an Additional Shared Passenger Request, while a Shared Trip is under way */}
          {isDriverPortal && <DriverSharedRequestModal />}

          {/* Rule 7.6 reminder, and why the system set the driver Offline (7.7, 17.7) */}
          {isDriverPortal && <DriverPresenceNotices />}
        </Box>
      </Box>
    </Box>
  );

  // The provider stays mounted for as long as a driver is signed in, on every screen. Mounting it only on
  // some routes reset the Online state and restarted GPS each time the driver opened another page.
  return (
    <DriverSessionProvider driverId={signedInDriverId} onSessionSuperseded={invalidateLocalSession}>
      {content}
    </DriverSessionProvider>
  );
};

export default DriverMobileAppShell;
