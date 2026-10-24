/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { LANGUAGE_OPTIONS, readStoredLanguage, storeLanguage } from '../utils/language';
import type { LanguageOption, PortalLanguage } from '../utils/language';
import { translate } from '../utils/translations';
import type { TranslationKey } from '../utils/translations';

interface LanguageContextType {
  language: PortalLanguage;
  setLanguage: (next: PortalLanguage) => void;
  options: LanguageOption[];
  /** The text in the chosen language; English when that text has no Tagalog version. */
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

// One language for the whole portal, like the Driver App's LanguageProvider: the choice is read from the browser's storage (English when nothing valid is stored),
// shared by every screen, remembered when it changes, and kept equal to the page's own `lang` attribute so a screen reader pronounces the text correctly.
export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<PortalLanguage>(() => readStoredLanguage());

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((next: PortalLanguage) => {
    storeLanguage(next);
    setLanguageState(next);
  }, []);

  const value = useMemo<LanguageContextType>(
    () => ({ language, setLanguage, options: LANGUAGE_OPTIONS, t: (key) => translate(language, key) }),
    [language, setLanguage]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
