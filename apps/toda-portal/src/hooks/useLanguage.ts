import { useCallback, useEffect, useState } from 'react';

import { LANGUAGE_OPTIONS, readStoredLanguage, storeLanguage } from '../utils/language';
import type { PortalLanguage } from '../utils/language';

/**
 * The portal's language: read from the browser's storage (English when nothing valid is stored), kept in sync with the page's own `lang` attribute so a screen
 * reader pronounces the text correctly. setLanguage remembers the choice.
 */
export function useLanguage() {
  const [language, setLanguageState] = useState<PortalLanguage>(() => readStoredLanguage());

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((next: PortalLanguage) => {
    storeLanguage(next);
    setLanguageState(next);
  }, []);

  return { language, setLanguage, options: LANGUAGE_OPTIONS };
}
