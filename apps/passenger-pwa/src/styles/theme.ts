import { createTheme } from '@mui/material/styles';
import { SAKAY_INPUT_COMPONENTS } from '@sakay/shared';

const theme = createTheme({
  palette: {
    primary: {
      main: '#FF6600',
      light: '#FF8533',
      dark: '#CC5200',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: '#1F1F1F',
      light: '#3D3D3D',
      dark: '#0A0A0A',
      contrastText: '#FFFFFF',
    },
    background: {
      default: '#F7F9FC',
      paper: '#FFFFFF',
    },
    text: {
      primary: '#1A1A1A',
      secondary: '#666666',
    },
  },
  typography: {
    fontFamily: '"Poppins", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: {
      fontWeight: 700,
      fontSize: '1.5rem', // 24px - Page title
      lineHeight: 1.2,
    },
    h2: {
      fontWeight: 600,
      fontSize: '1.125rem', // 18px - Section heading
      lineHeight: 1.3,
    },
    h3: {
      fontWeight: 600,
      fontSize: '1rem', // 16px - Sub-section / card title
      lineHeight: 1.3,
    },
    body1: {
      fontWeight: 400,
      fontSize: '1rem', // 16px - Mobile primary body text
      lineHeight: 1.5,
    },
    body2: {
      fontWeight: 400,
      fontSize: '0.875rem', // 14px - Secondary mobile body text
      lineHeight: 1.4,
    },
    button: {
      fontWeight: 600,
      fontSize: '0.9375rem', // 15px - Button text
      lineHeight: 1.2,
      textTransform: 'none',
    },
    caption: {
      fontWeight: 400,
      fontSize: '0.75rem', // 12px - Timestamps, metadata
      lineHeight: 1.3,
    },
  },
  shape: {
    borderRadius: 16,
  },
  components: {
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          borderRadius: 14,
          padding: '12px 24px',
          fontSize: '0.9375rem', // 15px
          lineHeight: 1.2,
          boxShadow: 'none',
          '&:hover': {
            boxShadow: 'none',
          },
          '&.MuiButton-containedPrimary': {
            backgroundColor: '#FF6600',
            color: '#FFFFFF',
            fontWeight: 700,
            boxShadow: 'none',
            '&:hover': {
              backgroundColor: '#E65C00',
              boxShadow: 'none',
            },
          },
        },
      },
    },
    ...SAKAY_INPUT_COMPONENTS,
  },
});

export default theme;
