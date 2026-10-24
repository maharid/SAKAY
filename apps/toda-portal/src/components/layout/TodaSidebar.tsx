import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Box, Typography, Avatar, ButtonBase, IconButton, Popover, Divider, Button } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DashboardIcon from '@mui/icons-material/Dashboard';
import AssignmentIcon from '@mui/icons-material/Assignment';
import PeopleIcon from '@mui/icons-material/People';
import CampaignIcon from '@mui/icons-material/Campaign';
import AssessmentIcon from '@mui/icons-material/Assessment';
import SecurityIcon from '@mui/icons-material/Security';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import CloseIcon from '@mui/icons-material/Close';

import appIcon from '@sakay/shared/assets/icons/app-icon.webp';
import logoTextOrange from '@sakay/shared/assets/images/webp/logo-text-orange.webp';
import { MacTooltip } from '../common/MacTooltip';
import { ToneStatusPill } from '../common/DataTable';
import { primaryButtonSx } from '../common/pageButtons';
import { OPS_BORDER, OPS_TEXT, opsFocusRing } from '../operations/operationsTheme';
import { TodaProfile } from '../../types/toda';
import { fetchTodaProfile, fetchDriverApplicants, onTodaProfileChanged } from '../../services/todaApiService';
import { accreditationChip, accreditationTone, isTodaLocked } from '../../utils/accreditation';
import { CONTROL, FONT, SHELL } from '../../styles/density';

interface TodaSidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: React.ReactNode;
  badge?: number | string;
  disabled?: boolean;
}

interface NavGroup {
  groupTitle: string;
  items: NavItem[];
}

// the moves of the sidebar are quick and plain: no sliding or growing on hover
const SLOW = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const ITEM_HEIGHT = 38;
// the deep orange of the main buttons: white text on it stays readable (4.9:1); the bright brand orange is for the logo and the accents
const ACTIVE_BACKGROUND = '#C75000';

// sidebar layout with collapsible width and fixed app icon header
export const TodaSidebar: React.FC<TodaSidebarProps> = ({ collapsed, onToggleCollapse }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [profileAnchor, setProfileAnchor] = useState<HTMLElement | null>(null);
  const [profile, setProfile] = useState<TodaProfile | null>(null);
  const [applicantCount, setApplicantCount] = useState<number>(0);

  useEffect(() => {
    const loadProfile = () => {
      fetchTodaProfile().then((p) => {
        if (p) setProfile(p);
      });
    };
    loadProfile();
    fetchDriverApplicants().then((apps) => {
      setApplicantCount(apps ? apps.length : 0);
    });
    return onTodaProfileChanged(loadProfile);
  }, []);

  const locked = isTodaLocked(profile?.accreditationStatus);
  const navGroups: NavGroup[] = [
    {
      groupTitle: 'Main',
      items: [
        { id: 'operations', label: 'Operations Monitoring', path: '/operations', icon: <DashboardIcon /> },
      ],
    },
    {
      groupTitle: 'Drivers',
      items: [
        { id: 'driver-verification', label: 'Driver Verification', path: '/driver-verification', icon: <AssignmentIcon />, badge: applicantCount > 0 ? applicantCount : undefined, disabled: locked },
        { id: 'drivers', label: 'Driver Membership', path: '/drivers', icon: <PeopleIcon />, disabled: locked },
      ],
    },
    {
      groupTitle: 'Communications',
      items: [
        { id: 'announcements', label: 'Announcements', path: '/announcements', icon: <CampaignIcon />, disabled: locked },
      ],
    },
    {
      groupTitle: 'Performance & Audit',
      items: [
        { id: 'reports', label: 'TODA Reports & Incidents', path: '/reports', icon: <AssessmentIcon />, disabled: locked },
        { id: 'audit-logs', label: 'Audit Logs', path: '/audit-logs', icon: <SecurityIcon />, disabled: locked },
      ],
    },
    {
      groupTitle: 'Organization',
      items: [
        { id: 'account', label: 'Account & Accreditation', path: '/account', icon: <ManageAccountsIcon /> },
        { id: 'settings', label: 'Settings', path: '/settings', icon: <SettingsOutlinedIcon /> },
      ],
    },
  ];

  const presidentName = profile?.officers.president || 'TODA Officer';
  const initial = presidentName.charAt(0).toUpperCase();
  const profileOpen = Boolean(profileAnchor);

  const closeProfile = () => setProfileAnchor(null);

  const renderItem = (item: NavItem) => {
    const isActive = location.pathname === item.path || (item.path === '/operations' && location.pathname === '/');

    const button = (
      <ButtonBase
        onClick={() => { if (!item.disabled) navigate(item.path); }}
        aria-current={isActive ? 'page' : undefined}
        aria-disabled={item.disabled || undefined}
        aria-label={collapsed ? item.label : undefined}
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
          cursor: item.disabled ? 'not-allowed' : 'pointer',
          opacity: item.disabled ? 0.55 : 1,
          color: isActive ? '#FFFFFF' : OPS_TEXT.primary,
          backgroundColor: isActive ? ACTIVE_BACKGROUND : 'transparent',
          transition: `background-color 0.18s ${SLOW}`,
          '& .MuiSvgIcon-root': { fontSize: 18, flexShrink: 0, color: isActive ? '#FFFFFF' : OPS_TEXT.secondary },
          '&:hover': { backgroundColor: isActive ? '#A84300' : item.disabled ? 'transparent' : 'rgba(17, 24, 39, 0.06)' },
          '@media (pointer: coarse)': { height: CONTROL.touchHeight },
          ...opsFocusRing,
        }}
      >
        {item.icon}
        {!collapsed && (
          <>
            <Typography
              component="span"
              sx={{ flex: 1, minWidth: 0, fontSize: FONT.body, fontWeight: isActive ? 700 : 500, color: 'inherit', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {item.label}
            </Typography>
            {item.badge !== undefined && (
              <Box
                component="span"
                aria-label={`${item.badge} waiting`}
                sx={{
                  flexShrink: 0,
                  minWidth: 22,
                  px: '6px',
                  py: '1px',
                  borderRadius: '999px',
                  fontSize: FONT.caption,
                  fontWeight: 700,
                  textAlign: 'center',
                  backgroundColor: isActive ? 'rgba(255, 255, 255, 0.24)' : 'var(--sakay-orange-soft)',
                  color: isActive ? '#FFFFFF' : OPS_TEXT.brand,
                }}
              >
                {item.badge}
              </Box>
            )}
          </>
        )}
        {/* in the narrow strip the badge is only a dot (the number is in the tooltip) */}
        {collapsed && item.badge !== undefined && (
          <Box aria-hidden sx={{ position: 'absolute', top: 7, right: 9, width: 8, height: 8, borderRadius: '50%', backgroundColor: isActive ? '#FFFFFF' : 'var(--sakay-orange)' }} />
        )}
      </ButtonBase>
    );

    const tip = item.disabled
      ? `${item.label}: available once the LGU accredits your TODA`
      : collapsed
      ? item.badge !== undefined ? `${item.label} (${item.badge} waiting)` : item.label
      : '';
    return tip ? (
      <MacTooltip key={item.id} title={tip} placement="right">
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
          color: OPS_TEXT.secondary,
          zIndex: 100,
          '@media (pointer: coarse)': { width: 32, height: 32, right: -16, top: 'calc(var(--mac-header-height) / 2 - 16px)' },
          '&:hover': {
            backgroundColor: 'var(--sakay-orange-soft)',
            color: OPS_TEXT.brand,
            borderColor: 'var(--sakay-orange-border)',
          },
          ...opsFocusRing,
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
            <Typography sx={{ fontSize: '9.5px', fontWeight: 700, color: OPS_TEXT.brand, letterSpacing: '0.06em', textTransform: 'uppercase', mt: '2px', lineHeight: 1 }}>
              TODA Admin
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
              groupIdx > 0 && <Box aria-hidden sx={{ width: 24, height: '1px', backgroundColor: OPS_BORDER, margin: '0 auto 8px' }} />
            ) : (
              <Typography component="h2" sx={{ fontSize: FONT.small, fontWeight: 700, color: OPS_TEXT.secondary, padding: '4px 10px 6px', whiteSpace: 'nowrap' }}>
                {group.groupTitle}
              </Typography>
            )}
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: collapsed ? 'center' : 'stretch', gap: '3px', width: '100%' }}>
              {group.items.map(renderItem)}
            </Box>
          </Box>
        ))}
      </Box>

      {/* The signed-in officer: opens the account popup */}
      <ButtonBase
        onClick={(e) => setProfileAnchor(e.currentTarget)}
        aria-haspopup="dialog"
        aria-expanded={profileOpen}
        aria-label={collapsed ? `Account of ${presidentName}` : undefined}
        disableRipple
        sx={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: '10px',
          width: '100%',
          minHeight: 58,
          px: collapsed ? 0 : '12px',
          borderTop: '1px solid var(--mac-border-color)',
          backgroundColor: profileOpen ? 'var(--sakay-orange-soft)' : 'rgba(250, 250, 252, 0.9)',
          textAlign: 'left',
          '&:hover': { backgroundColor: 'var(--sakay-orange-soft)' },
          ...opsFocusRing,
          '&:focus-visible': { outline: `2px solid ${OPS_TEXT.brand}`, outlineOffset: '-3px' },
        }}
      >
        <Avatar sx={{ width: 30, height: 30, flexShrink: 0, fontSize: FONT.body, fontWeight: 700, color: '#FFFFFF', backgroundColor: ACTIVE_BACKGROUND }}>{initial}</Avatar>
        {!collapsed && (
          <>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontWeight: 700, fontSize: FONT.body, color: OPS_TEXT.primary, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {presidentName}
              </Typography>
              <Typography sx={{ fontSize: FONT.caption, color: OPS_TEXT.brand, fontWeight: 600, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {profile?.acronym || 'TODA'} • President
              </Typography>
            </Box>
            <UnfoldMoreIcon aria-hidden sx={{ fontSize: 18, color: OPS_TEXT.secondary, flexShrink: 0 }} />
          </>
        )}
      </ButtonBase>

      {/* Account popup: who is signed in and which TODA, then the one thing to do next */}
      <Popover
        open={profileOpen}
        anchorEl={profileAnchor}
        onClose={closeProfile}
        // opens above the profile area; beside the narrow strip it opens to the right so it never covers the strip's own icons
        anchorOrigin={collapsed ? { vertical: 'bottom', horizontal: 'right' } : { vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{
          paper: {
            role: 'dialog',
            'aria-label': 'Your account',
            sx: {
              ml: collapsed ? '8px' : '10px',
              mt: collapsed ? 0 : '-8px',
              width: 316,
              maxWidth: 'calc(100vw - 24px)',
              borderRadius: '13px',
              border: `1px solid ${OPS_BORDER}`,
              boxShadow: '0 12px 32px rgba(15, 23, 42, 0.16)',
              backgroundColor: '#FFFFFF',
              overflow: 'hidden',
            },
          },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '12px', p: '14px 14px 12px' }}>
          <Avatar aria-hidden sx={{ width: 40, height: 40, flexShrink: 0, fontSize: FONT.cardTitle, fontWeight: 700, color: '#FFFFFF', backgroundColor: ACTIVE_BACKGROUND }}>{initial}</Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: FONT.heading, fontWeight: 700, color: OPS_TEXT.primary, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{profile?.officers.president || 'TODA President'}</Typography>
            <Typography sx={{ fontSize: FONT.body, color: OPS_TEXT.brand, fontWeight: 600, lineHeight: 1.35, overflowWrap: 'anywhere' }}>
              TODA President — {profile?.name || 'TODA Association'}
            </Typography>
            {profile && (
              <Box sx={{ mt: '6px' }}>
                <ToneStatusPill label={accreditationChip(profile.accreditationStatus).label} tone={accreditationTone(profile.accreditationStatus)} />
              </Box>
            )}
          </Box>
          <IconButton size="small" aria-label="Close" onClick={closeProfile} sx={{ mt: '-4px', mr: '-6px', color: OPS_TEXT.secondary, ...opsFocusRing }}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>

        <Divider />

        <Box component="dl" sx={{ m: 0, display: 'grid', gap: '10px', p: '12px 14px' }}>
          {[
            { label: 'TODA organization', value: `${profile?.name || 'Your TODA'}${profile?.acronym ? ` (${profile.acronym})` : ''}` },
            { label: 'Official email', value: profile?.email || 'Not provided' },
            { label: 'Accreditation permit number', value: profile?.accreditationNo ? `#${profile.accreditationNo}` : 'Not issued yet' },
            { label: 'Terminal', value: profile?.terminalLocation ? `${profile.terminalLocation}${profile.barangay ? ` (${profile.barangay})` : ''}` : 'Not provided' },
          ].map((row) => (
            <Box key={row.label} sx={{ minWidth: 0 }}>
              <Typography component="dt" sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary }}>{row.label}</Typography>
              <Typography component="dd" sx={{ m: 0, fontSize: FONT.body, fontWeight: 600, color: OPS_TEXT.primary, overflowWrap: 'anywhere' }}>{row.value}</Typography>
            </Box>
          ))}
        </Box>

        <Divider />

        <Box sx={{ p: '10px 14px 12px' }}>
          <Button
            fullWidth
            variant="contained"
            disableElevation
            autoFocus
            onClick={() => {
              closeProfile();
              navigate('/account');
            }}
            sx={primaryButtonSx}
          >
            View Organization Details
          </Button>
        </Box>
      </Popover>
    </Box>
  );
};
