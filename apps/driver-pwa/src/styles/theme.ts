import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    primary: {
      main: '#FF6600',
      light: '#FF8533',
      dark: '#E65C00',
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
  components: {
    MuiInputLabel: {
      styleOverrides: {
        root: {
          color: '#64748B',
          fontSize: '15px',
          transformOrigin: 'top left',
          transform: 'translate(16px, 18px) scale(1)',
          pointerEvents: 'none',
          '&.MuiInputLabel-shrink': {
            transform: 'translate(16px, 8px) scale(0.75)',
            fontWeight: 600,
          },
          '&.Mui-focused': {
            color: '#FF6600',
          },
        },
      },
    },
    MuiOutlinedInput: {
      defaultProps: {
        notched: false,
      },
      styleOverrides: {
        root: {
          borderRadius: 14,
          backgroundColor: '#F8FAFC',
          fontSize: '15px',
          minHeight: '56px',
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: '#E2E8F0',
            borderWidth: '1.5px',
            '& legend': {
              display: 'none',
            },
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: '#CBD5E1',
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: '#FF6600',
            borderWidth: '1.5px',
          },
          '&.Mui-focused': {
            boxShadow: '0 0 0 3px rgba(255, 102, 0, 0.12)',
          },
        },
        input: {
          paddingTop: '20px !important',
          paddingBottom: '4px !important',
          paddingLeft: '16px',
          fontSize: '15px',
          fontWeight: 500,
          color: '#0F172A',
        },
        notchedOutline: {
          '& legend': {
            display: 'none',
          },
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        variant: 'outlined',
        fullWidth: true,
      },
      styleOverrides: {
        root: {
          '& .MuiInputLabel-root': {
            color: '#64748B',
            fontSize: '15px',
            transformOrigin: 'top left',
            transform: 'translate(16px, 18px) scale(1)',
            pointerEvents: 'none',
            '&.MuiInputLabel-shrink': {
              transform: 'translate(16px, 8px) scale(0.75)',
              fontWeight: 600,
            },
            '&.Mui-focused': {
              color: '#FF6600',
            },
          },
          '& .MuiOutlinedInput-root': {
            borderRadius: 14,
            backgroundColor: '#F8FAFC',
            fontSize: '15px',
            minHeight: '56px',
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: '#E2E8F0',
              borderWidth: '1.5px',
              '& legend': {
                display: 'none',
              },
            },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: '#CBD5E1',
            },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: '#FF6600',
              borderWidth: '1.5px',
            },
            '&.Mui-focused': {
              boxShadow: '0 0 0 3px rgba(255, 102, 0, 0.12)',
            },
            '& .MuiOutlinedInput-input': {
              paddingTop: '20px !important',
              paddingBottom: '4px !important',
              paddingLeft: '16px',
              fontSize: '15px',
              fontWeight: 500,
              color: '#0F172A',
            },
          },
        },
      },
    },
  },
});

export default theme;
