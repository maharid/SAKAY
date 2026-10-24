import React from 'react';

import { LanguageSelector } from '../common/LanguageSelector';
import { SettingRow } from '../common/SettingRow';
import { useLanguage } from '../../hooks/useLanguage';

// Language: English or Tagalog. It uses the portal's language mechanism (contexts/LanguageContext.tsx, utils/language.ts): the choice is kept in this browser under
// the key the Driver and Passenger apps also use, and it changes every text that has a Tagalog version.
export const PreferencesPanel: React.FC = () => {
  const { t } = useLanguage();

  return <SettingRow title={t('language.title')} description={t('language.description')} control={<LanguageSelector label={t('language.title')} />} />;
};
