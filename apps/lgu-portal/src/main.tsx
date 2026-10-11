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
    MuiTextField: {
      defaultProps: {
        variant: 'outlined',
        fullWidth: true,
      },
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: '12px',
            backgroundColor: '#FFFFFF',
            fontSize: '14px',
            '& fieldset': {
              borderColor: '#E5E5EA',
            },
            '&:hover fieldset': {
              borderColor: '#C7C7CC',
            },
            '&.Mui-focused fieldset': {
              borderColor: '#FF6600',
            },
          },
          '& .MuiInputLabel-root': {
            color: '#86868B',
            fontSize: '14px',
            '&.Mui-focused': {
              color: '#FF6600',
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
