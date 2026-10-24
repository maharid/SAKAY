import React from 'react';
import { AuthProvider } from './contexts/AuthContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { TodaRoutes } from './routes/todaRoutes';

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <TodaRoutes />
      </AuthProvider>
    </LanguageProvider>
  );
}
