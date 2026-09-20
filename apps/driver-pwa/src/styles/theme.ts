import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    primary: {
      main: '#FF6B00',
      light: '#FF8533',
      dark: '#E66000',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: '#0F172A',
      light: '#334155',
      dark: '#020617',
      contrastText: '#FFFFFF',
    },
    success: {
      main: '#1E8E3E',
      light: '#E6F4EA',
    },
    warning: {
      main: '#F59E0B',
      light: '#FEF3C7',
    },
    error: {
      main: '#DC2626',
      light: '#FEE2E2',
    },
    background: {
      default: '#F8FAFC',
      paper: '#FFFFFF',
    },
    text: {
      primary: '#0F172A',
      secondary: '#64748B',
    },
  },
  typography: {
    fontFamily: '"Poppins", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    h1: {
      fontWeight: 700,
      fontSize: '1.5rem', // 24px - Page title
      lineHeight: 1.2,
    },
    h2: {
      fontWeight: 600,
      fontSize: '1.125rem', // 18px - Section title
      lineHeight: 1.3,
    },
    body1: {
      fontWeight: 400,
      fontSize: '1rem', // 16px - Mobile primary body text
      lineHeight: 1.5,
    },
    body2: {
      fontWeight: 400,
      fontSize: '0.875rem', // 14px - Secondary text
      lineHeight: 1.4,
    },
    button: {
      textTransform: 'none',
      fontWeight: 600,
      fontSize: '0.9375rem', // 15px - Button text
      lineHeight: 1.2,
    },
    caption: {
      fontWeight: 400,
      fontSize: '0.75rem', // 12px - Caption / metadata
      lineHeight: 1.3,
    },
  },
  shape: {
    borderRadius: 14,
  },
});

export default theme;
