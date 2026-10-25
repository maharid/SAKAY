import React, { useState } from 'react';
import { Box } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { AdminSidebar } from './AdminSidebar';
import { AdminHeader } from './AdminHeader';
import { FONT, SHELL } from '../../styles/density';
import { createDensityTheme } from '../../styles/densityTheme';

interface AdminLayoutProps {
  children: React.ReactNode;
  pageTitle?: string;
  pageSubtitle?: string;
}

const AdminLayoutShell: React.FC<AdminLayoutProps> = ({ children, pageTitle, pageSubtitle }) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <Box
      sx={{
        display: 'flex',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: '#FFF8F2',
        // text that sets no size of its own reads at the normal size of the compact scale (the page default is a roomier 14px)
        fontSize: FONT.body,
      }}
    >
      <AdminSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          minWidth: 0,
          overflow: 'hidden',
          backgroundColor: '#FFF8F2',
        }}
      >
        <AdminHeader pageTitle={pageTitle} pageSubtitle={pageSubtitle} />

        <Box
          component="main"
          sx={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: SHELL.pagePadding,
            backgroundColor: '#FFF8F2',
          }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
};

// Everything in the signed-in layout (header, sidebar, the page, and the popups and dialogs they open) is drawn at the compact density of styles/density.ts, the same
// as the TODA portal; the sign-in page and the registration flow are outside this layout and keep their own sizes.
export const AdminLayout: React.FC<AdminLayoutProps> = (props) => (
  <ThemeProvider theme={createDensityTheme}>
    <AdminLayoutShell {...props} />
  </ThemeProvider>
);
