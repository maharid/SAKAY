import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import '@fontsource/poppins';
import App from './App';
import './styles/globals.css';

const theme = createTheme({
  typography: {
    fontFamily: '"Poppins", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif',
  },
  components: {
    MuiInputLabel: {
      styleOverrides: {
        root: {
          color: '#86868B',
          fontSize: '14px',
          transformOrigin: 'top left',
          transform: 'translate(14px, 16px) scale(1)',
          pointerEvents: 'none',
          '&.MuiInputLabel-shrink': {
            transform: 'translate(14px, 7px) scale(0.75)',
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
          borderRadius: '12px',
          backgroundColor: '#FFFFFF',
          fontSize: '14px',
          minHeight: '52px',
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: '#E5E5EA',
            borderWidth: '1.5px',
            '& legend': {
              display: 'none',
            },
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: '#C7C7CC',
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
          paddingTop: '18px !important',
          paddingBottom: '4px !important',
          paddingLeft: '14px',
          fontSize: '14px',
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
            color: '#86868B',
            fontSize: '14px',
            transformOrigin: 'top left',
            transform: 'translate(14px, 16px) scale(1)',
            pointerEvents: 'none',
            '&.MuiInputLabel-shrink': {
              transform: 'translate(14px, 7px) scale(0.75)',
              fontWeight: 600,
            },
            '&.Mui-focused': {
              color: '#FF6600',
            },
          },
          '& .MuiOutlinedInput-root': {
            borderRadius: '12px',
            backgroundColor: '#FFFFFF',
            fontSize: '14px',
            minHeight: '52px',
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: '#E5E5EA',
              borderWidth: '1.5px',
              '& legend': {
                display: 'none',
              },
            },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: '#C7C7CC',
            },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: '#FF6600',
              borderWidth: '1.5px',
            },
            '&.Mui-focused': {
              boxShadow: '0 0 0 3px rgba(255, 102, 0, 0.12)',
            },
            '& .MuiOutlinedInput-input': {
              paddingTop: '18px !important',
              paddingBottom: '4px !important',
              paddingLeft: '14px',
              fontSize: '14px',
            },
          },
        },
      },
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>
);
