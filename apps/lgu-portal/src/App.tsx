import React from 'react';
import { AuthProvider } from './contexts/AuthContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { AdminRoutes } from './routes/adminRoutes';

export const App: React.FC = () => {
  return (
    <LanguageProvider>
      <AuthProvider>
        <ThemeProvider>
          <AdminRoutes />
        </ThemeProvider>
      </AuthProvider>
    </LanguageProvider>
  );
};

export default App;
