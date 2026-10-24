import React, { useState, useEffect } from 'react';
import { Box, useMediaQuery } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { Outlet } from 'react-router-dom';
import { TodaHeader } from './TodaHeader';
import { TodaSidebar } from './TodaSidebar';
import { fetchTodaProfile, onTodaProfileChanged } from '../../services/todaApiService';
import { AccreditationStatusBanner } from '../common/AccreditationStatusBanner';
import { TodaProfile } from '../../types/toda';
import { SHELL } from '../../styles/density';
import { createDensityTheme } from '../../styles/densityTheme';
import { useLanguage } from '../../hooks/useLanguage';

interface TodaLayoutProps {
  children?: React.ReactNode;
  pageTitle?: string;
  pageSubtitle?: string;
}

// Below this width the sidebar would take most of the screen, so it starts as the narrow icon strip and opens ON TOP of the page instead of pushing it.
const COMPACT_SHELL_QUERY = '(max-width: 899.95px)';
const SIDEBAR_RAIL_WIDTH = SHELL.sidebarRailWidth;

const TodaLayoutShell: React.FC<TodaLayoutProps> = ({
  children,
  pageTitle,
  pageSubtitle,
}) => {
  const isCompactShell = useMediaQuery(COMPACT_SHELL_QUERY, { noSsr: true });
  useLanguage(); // keeps the page's `lang` attribute equal to the chosen language
  const [sidebarCollapsed, setSidebarCollapsed] = useState(isCompactShell);
  const [profile, setProfile] = useState<TodaProfile | null>(null);

  useEffect(() => {
    const load = () => {
      fetchTodaProfile().then((p) => {
        if (p) setProfile(p);
      });
    };
    load();
    // a resubmission or a new document changes the status: show it without a reload
    return onTodaProfileChanged(load);
  }, []);

  // moving to a narrow window (or a phone turning sideways) folds the sidebar away; a wide window leaves the choice as it was
  useEffect(() => {
    if (isCompactShell) setSidebarCollapsed(true);
  }, [isCompactShell]);

  const sidebarOverlayOpen = isCompactShell && !sidebarCollapsed;

  // Escape closes the sidebar while it covers the page
  useEffect(() => {
    if (!sidebarOverlayOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarCollapsed(true);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [sidebarOverlayOpen]);

  const sidebar = (
    <TodaSidebar
      collapsed={sidebarCollapsed}
      onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
    />
  );

  return (
    <Box
      sx={{
        display: 'flex',
        width: '100%',
        height: '100vh',
        '@supports (height: 100dvh)': { height: '100dvh' },
        overflow: 'hidden',
        backgroundColor: '#FFF8F2',
      }}
    >
      {isCompactShell ? (
        <>
          {/* the icon strip keeps its place in the row; an open sidebar floats above everything except dialogs and popups */}
          <Box sx={{ width: SIDEBAR_RAIL_WIDTH, flexShrink: 0, position: 'relative', zIndex: 90 }}>
            <Box
              sx={
                sidebarOverlayOpen
                  ? { position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 1200, boxShadow: '0 0 48px rgba(15, 23, 42, 0.25)' }
                  : { height: '100%' }
              }
            >
              {sidebar}
            </Box>
          </Box>
          {sidebarOverlayOpen && (
            <Box
              aria-hidden
              onClick={() => setSidebarCollapsed(true)}
              sx={{ position: 'fixed', inset: 0, zIndex: 1190, backgroundColor: 'rgba(15, 23, 42, 0.35)' }}
            />
          )}
        </>
      ) : (
        sidebar
      )}

      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minWidth: 0,
          overflow: 'hidden',
          backgroundColor: '#FFF8F2',
        }}
      >
        <TodaHeader pageTitle={pageTitle} pageSubtitle={pageSubtitle} />

        <Box
          component="main"
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: SHELL.pagePadding,
            backgroundColor: '#FFF8F2',
          }}
        >
          <AccreditationStatusBanner profile={profile} />
          {children || <Outlet />}
        </Box>
      </Box>
    </Box>
  );
};

// Everything in the signed-in layout (header, sidebar, the page, and the popups and dialogs they open) is drawn at the compact density.
export const TodaLayout: React.FC<TodaLayoutProps> = (props) => (
  <ThemeProvider theme={createDensityTheme}>
    <TodaLayoutShell {...props} />
  </ThemeProvider>
);
