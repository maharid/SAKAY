import React from 'react';

import { AppearancePanel } from './AppearancePanel';
import { LanguageSelector } from '../common/LanguageSelector';
import { SettingRow } from '../common/SettingRow';
import { useLanguage } from '../../hooks/useLanguage';

// Preferences: what the person can set for themselves. Language: English or Tagalog, the portal's language mechanism (contexts/LanguageContext.tsx, utils/language.ts, the
// same as the TODA portal's): the choice is kept in this browser under the key the Driver and Passenger apps also use, and it changes every text that has a Tagalog
// version. Then how the portal looks (the accent colour, kept in ThemeContext and saved with the administrator's record).
export const PreferencesPanel: React.FC = () => {
  const { t } = useLanguage();

  return (
    <>
      <SettingRow title={t('language.title')} description={t('language.description')} control={<LanguageSelector label={t('language.title')} />} />
      <AppearancePanel />
    </>
  );
};
