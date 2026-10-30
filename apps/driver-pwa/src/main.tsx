import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource/poppins/latin-400.css';
import '@fontsource/poppins/latin-500.css';
import '@fontsource/poppins/latin-600.css';
import '@fontsource/poppins/latin-700.css';
import './styles/globals.css';
import './styles/responsive.css';
import './styles/animations.css';
import App from './App';
import { installBrowserLockdown } from '@sakay/shared';

// Panel comment (D-P7): in a production build the developer-tools shortcuts and the right-click menu are blocked (a deterrent; see browserLockdown.ts).
installBrowserLockdown({ enabled: import.meta.env.PROD && import.meta.env.VITE_ALLOW_DEVTOOLS !== '1' });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
