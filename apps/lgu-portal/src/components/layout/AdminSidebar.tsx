import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Box, Typography, ButtonBase, IconButton } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DashboardIcon from '@mui/icons-material/Dashboard';
import AssignmentIcon from '@mui/icons-material/Assignment';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import BadgeIcon from '@mui/icons-material/Badge';
import PeopleIcon from '@mui/icons-material/People';
import NavigationIcon from '@mui/icons-material/Navigation';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import AssessmentIcon from '@mui/icons-material/Assessment';
import BarChartIcon from '@mui/icons-material/BarChart';
import SecurityIcon from '@mui/icons-material/Security';
import CampaignIcon from '@mui/icons-material/Campaign';
import StarRateIcon from '@mui/icons-material/StarRate';
import PaidIcon from '@mui/icons-material/Paid';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import GavelIcon from '@mui/icons-material/Gavel';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import MapIcon from '@mui/icons-material/Map';

import appIcon from '@sakay/shared/assets/icons/app-icon.webp';
import logoTextOrange from '@sakay/shared/assets/images/webp/logo-text-orange.webp';
import { MacTooltip } from '../common/MacTooltip';
import { fetchTodaApplications, fetchDrivers, countPendingLguAppeals, countPendingLguSubstitutions } from '../../services/adminApiService';
import { CONTROL, FONT, SHELL } from '../../styles/density';
import { PAGE_BORDER, PAGE_TEXT, pageFocusRing } from '../../styles/pageTheme';

// the height of one menu item, and the deep orange of the open page (the same as the TODA portal's sidebar: white text on it stays readable)
const ITEM_HEIGHT = 38;
const ACTIVE_BACKGROUND = '#C75000';

interface AdminSidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: React.ReactNode;
  badge?: number | string;
}

interface NavGroup {
  groupTitle: string;
  items: NavItem[];
}

export const AdminSidebar: React.FC<AdminSidebarProps> = ({ collapsed, onToggleCollapse }) => {
  const location = useLocation();
  const navigate = useNavigate();

  const [pendingTodaCount, setPendingTodaCount] = useState<number>(0);
  const [pendingDriverCount, setPendingDriverCount] = useState<number>(0);
  const [pendingAppealCount, setPendingAppealCount] = useState<number>(0);
  const [pendingVehicleCount, setPendingVehicleCount] = useState<number>(0);

  useEffect(() => {
    Promise.all([
      fetchTodaApplications(),
      fetchDrivers({ status: 'Pending Verification' }),
    ])
      .then(([todas, drivers]) => {
        const pendingTodas = todas.filter(
          (t) => t.status === 'Pending' || t.status === 'Under Review'
        ).length;
        setPendingTodaCount(pendingTodas);
        setPendingDriverCount(drivers.length);
      })
      .catch((err) => {
        console.warn('[AdminSidebar] Error fetching pending counts:', err);
      });
  }, []);

  // Rule 25.5 / 25.6: the strike appeals waiting for the LGU Administrator (a decision is due in three business days)
  useEffect(() => {
    countPendingLguAppeals().then(setPendingAppealCount).catch(() => undefined);
    countPendingLguSubstitutions().then(setPendingVehicleCount).catch(() => undefined);
  }, [location.pathname]);

  const navGroups: NavGroup[] = [
    {
      groupTitle: 'Main',
      items: [
        { id: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: <DashboardIcon /> },
      ],
    },
    {
      groupTitle: 'Management',
      items: [
        { id: 'toda-applications', label: 'TODA Applications', path: '/toda-applications', icon: <AssignmentIcon />, badge: pendingTodaCount > 0 ? pendingTodaCount : undefined },
        { id: 'accredited-todas', label: 'Accredited TODAs', path: '/accredited-todas', icon: <VerifiedUserIcon /> },
        { id: 'drivers', label: 'Drivers', path: '/drivers', icon: <BadgeIcon />, badge: pendingDriverCount > 0 ? pendingDriverCount : undefined },
        { id: 'passengers', label: 'Passengers', path: '/passengers', icon: <PeopleIcon /> },
        { id: 'vehicle-substitutions', label: 'Vehicle Substitutions', path: '/vehicle-substitutions', icon: <SwapHorizIcon />, badge: pendingVehicleCount > 0 ? pendingVehicleCount : undefined },
        { id: 'feedback', label: 'Passenger Feedback', path: '/feedback', icon: <StarRateIcon /> },
      ],
    },
    {
      groupTitle: 'Operations',
      items: [
        { id: 'live-trips', label: 'Live Trips', path: '/live-trips', icon: <NavigationIcon /> },
        { id: 'incident-reports', label: 'Incident Reports', path: '/incident-reports', icon: <ReportProblemIcon /> },
        { id: 'appeals', label: 'Strike Appeals', path: '/appeals', icon: <GavelIcon />, badge: pendingAppealCount > 0 ? pendingAppealCount : undefined },
        { id: 'announcements', label: 'Announcements', path: '/announcements', icon: <CampaignIcon /> },
      ],
    },
    {
      groupTitle: 'Municipal Policy',
      items: [
        { id: 'fare-configuration', label: 'Fare Configuration', path: '/fare-configuration', icon: <PaidIcon /> },
        { id: 'service-area', label: 'Service Area', path: '/service-area', icon: <MapIcon /> },
      ],
    },
    {
      groupTitle: 'Analytics & Reports',
      items: [
        { id: 'reports', label: 'Reports', path: '/reports', icon: <AssessmentIcon /> },
        { id: 'analytics', label: 'Analytics', path: '/analytics', icon: <BarChartIcon /> },
      ],
    },
    {
      groupTitle: 'System',
      items: [
        { id: 'settings', label: 'Account Management', path: '/settings', icon: <ManageAccountsIcon /> },
        { id: 'audit-logs', label: 'Audit Logs', path: '/audit-logs', icon: <SecurityIcon /> },
      ],
    },
  ];

  const isActiveItem = (item: NavItem) => location.pathname === item.path || (item.path === '/dashboard' && location.pathname === '/');

  const renderItem = (item: NavItem) => {
    const isActive = isActiveItem(item);
    const hasBadge = item.badge !== undefined && item.badge !== 0 && item.badge !== '0';

    const button = (
      <ButtonBase
        onClick={() => navigate(item.path)}
        aria-current={isActive ? 'page' : undefined}
        aria-label={collapsed ? (hasBadge ? `${item.label}, ${item.badge} waiting` : item.label) : undefined}
        focusRipple={false}
        disableRipple
        sx={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: '8px',
          width: collapsed ? 40 : '100%',
          height: ITEM_HEIGHT,
          px: collapsed ? 0 : '9px',
          borderRadius: '10px',
          textAlign: 'left',
          overflow: 'hidden',
          flexShrink: 0,
          color: isActive ? '#FFFFFF' : PAGE_TEXT.primary,
          backgroundColor: isActive ? ACTIVE_BACKGROUND : 'transparent',
          transition: 'background-color 0.18s cubic-bezier(0.2, 0.8, 0.2, 1)',
          '& .MuiSvgIcon-root': { fontSize: 18, flexShrink: 0, color: isActive ? '#FFFFFF' : PAGE_TEXT.secondary },
          '&:hover': { backgroundColor: isActive ? '#A84300' : 'rgba(17, 24, 39, 0.06)' },
          '@media (pointer: coarse)': { height: CONTROL.touchHeight },
          ...pageFocusRing,
        }}
      >
        {item.icon}
        {!collapsed && (
          <>
            <Typography
              component="span"
              sx={{ flex: 1, minWidth: 0, fontSize: FONT.body, fontWeight: isActive ? 700 : 500, letterSpacing: '-0.01em', color: 'inherit', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {item.label}
            </Typography>
            {hasBadge && (
              <Box
                component="span"
                aria-label={`${item.badge} waiting`}
                sx={{
                  flexShrink: 0,
                  minWidth: 20,
                  px: '5px',
                  py: '1px',
                  borderRadius: '999px',
                  fontSize: FONT.caption,
                  fontWeight: 700,
                  textAlign: 'center',
                  backgroundColor: isActive ? 'rgba(255, 255, 255, 0.24)' : 'var(--sakay-orange-soft)',
                  color: isActive ? '#FFFFFF' : PAGE_TEXT.brand,
                }}
              >
                {item.badge}
              </Box>
            )}
          </>
        )}
        {/* in the narrow strip the badge is only a dot (the number is in the tooltip) */}
        {collapsed && hasBadge && (
          <Box aria-hidden sx={{ position: 'absolute', top: 7, right: 9, width: 8, height: 8, borderRadius: '50%', backgroundColor: isActive ? '#FFFFFF' : 'var(--sakay-orange)' }} />
        )}
      </ButtonBase>
    );

    return collapsed ? (
      <MacTooltip key={item.id} title={hasBadge ? `${item.label} (${item.badge} waiting)` : item.label}>
        {button}
      </MacTooltip>
    ) : (
      <React.Fragment key={item.id}>{button}</React.Fragment>
    );
  };

  return (
    <Box
      component="aside"
      sx={{
        width: collapsed ? SHELL.sidebarRailWidth : SHELL.sidebarWidth,
        // fills the row it sits in (100vh is taller than the visible screen on a phone with a moving address bar)
        height: '100%',
        background: 'rgba(255, 255, 255, 0.92)',
        borderRight: '1px solid var(--mac-border-color)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        flexShrink: 0,
        transition: 'var(--mac-sidebar-transition)',
        zIndex: 90,
        userSelect: 'none',
      }}
    >
      {/* Collapse / expand: sits on the edge of the sidebar, level with the logo */}
      <IconButton
        onClick={onToggleCollapse}
        size="small"
        aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
        aria-expanded={!collapsed}
        sx={{
          position: 'absolute',
          top: 'calc(var(--mac-header-height) / 2 - 12px)',
          right: -12,
          width: 24,
          height: 24,
          backgroundColor: '#FFFFFF',
          border: '1px solid var(--mac-border-color)',
          boxShadow: 'var(--mac-shadow-subtle)',
          color: PAGE_TEXT.secondary,
          zIndex: 100,
          '@media (pointer: coarse)': { width: 32, height: 32, right: -16, top: 'calc(var(--mac-header-height) / 2 - 16px)' },
          '&:hover': {
            backgroundColor: 'var(--sakay-orange-soft)',
            color: PAGE_TEXT.brand,
            borderColor: 'var(--sakay-orange-border)',
          },
          ...pageFocusRing,
        }}
      >
        {collapsed ? <ChevronRightIcon sx={{ fontSize: 16 }} /> : <ChevronLeftIcon sx={{ fontSize: 16 }} />}
      </IconButton>

      {/* Logo row: the app icon always, the name when the sidebar is open */}
      <Box
        sx={{
          height: 'var(--mac-header-height)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          padding: collapsed ? 0 : '0 14px 0 16px',
          borderBottom: '1px solid var(--mac-border-color)',
          overflow: 'hidden',
          width: '100%',
        }}
      >
        <Box component="img" src={appIcon} alt="SAKAY" sx={{ width: 22, height: 22, minWidth: 22, objectFit: 'contain', flexShrink: 0 }} />
        {!collapsed && (
          <Box sx={{ display: 'flex', flexDirection: 'column', ml: '8px', minWidth: 0 }}>
            <Box component="img" src={logoTextOrange} alt="" sx={{ height: 18, width: 'auto', objectFit: 'contain', alignSelf: 'flex-start' }} />
            <Typography sx={{ fontSize: FONT.overline, fontWeight: 700, color: PAGE_TEXT.brand, letterSpacing: '0.06em', textTransform: 'uppercase', mt: '2px', lineHeight: 1 }}>
              LGU Admin
            </Typography>
          </Box>
        )}
      </Box>

      {/* Navigation: the groups, each with its title (the titles hide in the narrow strip, where a thin line separates the groups) */}
      <Box
        component="nav"
        aria-label="Main navigation"
        sx={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          alignItems: collapsed ? 'center' : 'stretch',
          padding: collapsed ? '12px 0' : '12px 8px',
        }}
      >
        {navGroups.map((group, groupIdx) => (
          <Box key={group.groupTitle} component="section" aria-label={group.groupTitle} sx={{ display: 'flex', flexDirection: 'column', alignItems: collapsed ? 'center' : 'stretch', width: '100%', mb: '14px' }}>
            {collapsed ? (
              groupIdx > 0 && <Box aria-hidden sx={{ width: 24, height: '1px', backgroundColor: PAGE_BORDER, margin: '0 auto 8px' }} />
            ) : (
              <Typography component="h2" sx={{ fontSize: FONT.small, fontWeight: 700, color: PAGE_TEXT.secondary, padding: '4px 10px 6px', whiteSpace: 'nowrap' }}>
                {group.groupTitle}
              </Typography>
            )}
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: collapsed ? 'center' : 'stretch', gap: '3px', width: '100%' }}>
              {group.items.map(renderItem)}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
};
